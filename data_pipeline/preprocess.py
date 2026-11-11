"""
Mars Base Decision Engine - data pre-processing.

Reads the raw datasets fetched by download.ps1 and writes the browser layers:
    web/layers_data.js   (base64 PNGs, loaded without a web server)
    web/layers/*.png     (same layers as plain files, for inspection / GIS)
    web/layers/meta.json (value scaling and provenance)

Output grid: 2048 x 1024, simple cylindrical, lon -180..180 E, lat 90..-90.
One pixel = 0.1758 deg = ~10.4 km at the equator.

Layers
    elev   MOLA elevation (8-bit from NASA Mars Trek, rescaled to metres)
    slope  90th-percentile slope (deg) inside each output cell, computed on the 8192x4096 source grid
    rough  elevation standard deviation inside each output cell (m) - rock/roughness hazard proxy
    ice01  SWIM 2.0 ice consistency, 0-1 m depth      (-1..1)
    ice15  SWIM 2.0 ice consistency, 1-5 m depth      (-1..1)
    ice5   SWIM 2.0 ice consistency, >5 m depth       (-1..1)
    ti     TES thermal inertia (J m^-2 K^-1 s^-1/2), Christensen et al., via ASU JMARS WMS (numeric VICAR)
    dust   TES surface dust abundance 0..1 (Bandfield 2002), via ASU JMARS WMS (numeric VICAR)
    base   shaded-relief colour basemap (RGB), rendered from the same MOLA data
"""
import base64
import io
import json
import os

import numpy as np
from PIL import Image
import tifffile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
WEB = os.path.join(HERE, "..", "web")
LAYERS = os.path.join(WEB, "layers")
os.makedirs(LAYERS, exist_ok=True)

SRC_W, SRC_H = 8192, 4096          # zoom-4 Trek tiles
OUT_W, OUT_H = 2048, 1024          # browser grid
F = SRC_W // OUT_W                 # 4x4 source pixels per output cell
MARS_R = 3396190.0                 # m

# Trek's 8-bit MOLA product is a linear stretch of the MOLA range.
# We anchor it on the global extremes (Hellas floor / Olympus summit) and
# verify against known landing sites below.
ELEV_MIN_M, ELEV_MAX_M = -8200.0, 21230.0


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- MOLA
def load_mola():
    img = np.zeros((SRC_H, SRC_W), np.uint8)
    for y in range(16):
        for x in range(32):
            p = os.path.join(RAW, "mola_z4", f"{y}_{x}.png")
            t = np.array(Image.open(p).convert("LA"))[:, :, 0]
            img[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = t
    return img


def to_metres(v8):
    return ELEV_MIN_M + (v8.astype(np.float32) / 255.0) * (ELEV_MAX_M - ELEV_MIN_M)


def slope_deg(elev_m):
    lat = np.linspace(90, -90, SRC_H, endpoint=False) + 90.0 / SRC_H
    dy = np.pi * MARS_R / SRC_H                                     # m per row
    dx = (2 * np.pi * MARS_R / SRC_W) * np.cos(np.radians(lat))     # m per column, per row
    dx = np.maximum(dx, 1.0)[:, None]
    gy, gx = np.gradient(elev_m)
    gx = gx / dx
    gy = gy / dy
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def block(a, fn):
    """Reduce an (SRC_H, SRC_W) array to (OUT_H, OUT_W) with fn over FxF blocks."""
    b = a.reshape(OUT_H, F, OUT_W, F).transpose(0, 2, 1, 3).reshape(OUT_H, OUT_W, F * F)
    return fn(b)


def hillshade(elev_m, az=315, alt=45):
    gy, gx = np.gradient(elev_m)
    gx = gx / 10400.0          # approx metres per output pixel (equator)
    gy = gy / 10400.0
    slope = np.arctan(2.5 * np.hypot(gx, gy))   # 2.5x vertical exaggeration
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(az), np.radians(alt)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def colour_ramp(t):
    """Elevation colour ramp (t in 0..1): deep blue-grey lowlands -> ochre -> pale highlands."""
    stops = np.array([
        [0.00, 36, 44, 66],
        [0.22, 82, 74, 70],
        [0.35, 138, 92, 62],
        [0.50, 186, 124, 76],
        [0.65, 214, 160, 104],
        [0.80, 232, 200, 156],
        [1.00, 250, 244, 232],
    ], np.float32)
    r = np.interp(t, stops[:, 0], stops[:, 1])
    g = np.interp(t, stops[:, 0], stops[:, 2])
    b = np.interp(t, stops[:, 0], stops[:, 3])
    return np.stack([r, g, b], -1)


# ---------------------------------------------------------------- SWIM
def load_swim(name):
    """SWIM2 global composite: 7200x2400 float32, lon -180..180, lat 60..-60, values -1..1."""
    with tifffile.TiffFile(os.path.join(RAW, name)) as t:
        a = t.pages[0].asarray().astype(np.float32)
    a[a <= -30] = np.nan
    im = Image.fromarray(a, mode="F").resize((OUT_W, round(OUT_H * 120 / 180)), Image.BOX)
    a = np.array(im)
    out = np.full((OUT_H, OUT_W), np.nan, np.float32)
    top = round(OUT_H * 30 / 180)          # row of lat +60
    out[top:top + a.shape[0], :] = a
    return out


# ---------------------------------------------------------------- TES (JMARS WMS numeric VICAR)
def load_vicar(name, dtype):
    """2048x1024 VICAR from ms-mars.mars.asu.edu GetMap (LBLSIZE=8192, BSQ, little-endian)."""
    raw = open(os.path.join(RAW, name), "rb").read()
    lbl = raw[:8192].decode("latin1")
    lblsize = int(lbl.split("LBLSIZE=")[1].split()[0])
    a = np.frombuffer(raw[lblsize:], dtype=dtype).reshape(OUT_H, OUT_W)
    return a


# ---------------------------------------------------------------- IO
def png_b64(arr, mode="L"):
    im = Image.fromarray(arr, mode=mode)
    path = os.path.join(LAYERS, f"{png_b64.current}.png")
    im.save(path, optimize=True)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    log("MOLA: reading tiles")
    v8 = load_mola()
    elev = to_metres(v8)

    # sanity check against known sites (lat, lonE, published MOLA elevation m)
    checks = [("Jezero", 18.4, 77.6, -2600), ("Gale", -5.4, 137.8, -4500),
              ("Olympus Mons", 18.65, -133.8, 21200), ("Hellas floor", -42.4, 70.5, -7000),
              ("InSight", 4.5, 135.6, -2600)]
    for n, la, lo, ref in checks:
        r = int((90 - la) / 180 * SRC_H); c = int((lo + 180) / 360 * SRC_W)
        log(f"  check {n:13s} model={elev[r, c]:8.0f} m   published~{ref} m")

    log("MOLA: slope on 8192x4096 grid")
    sl = slope_deg(elev)
    slope_p90 = block(sl, lambda b: np.percentile(b, 90, axis=2)).astype(np.float32)
    rough = block(elev, lambda b: b.std(axis=2)).astype(np.float32)
    elev_out = block(elev, lambda b: b.mean(axis=2)).astype(np.float32)
    v8_out = np.clip(np.round((elev_out - ELEV_MIN_M) / (ELEV_MAX_M - ELEV_MIN_M) * 255), 0, 255).astype(np.uint8)

    log("SWIM: ice consistency layers")
    ice = {k: load_swim(f) for k, f in [("ice01", "SWIM2_c0_1.tif"), ("ice15", "SWIM2_c1_5.tif"), ("ice5", "SWIM2_c_5.tif")]}

    log("TES: thermal inertia + dust abundance (JMARS WMS)")
    ti = load_vicar("tes_ti_numeric.vic", "<i4").astype(np.float32)        # FORMAT='FULL' = int32
    dust = load_vicar("tes_dust_numeric.vic", "<f4").astype(np.float32)    # FORMAT='REAL', -1 = no data
    log(f"  TI nodata (<=0): {(ti <= 0).mean() * 100:.1f}%   dust nodata: {(dust < 0).mean() * 100:.1f}%")
    for n, la, lo in [("Jezero", 18.4, 77.6), ("Gale", -5.4, 137.8), ("Arabia", 20, 20)]:
        r = int((90 - la) / 180 * OUT_H); c = int((lo + 180) / 360 * OUT_W)
        log(f"  check {n:8s} TI={ti[r, c]:5.0f}  dust={dust[r, c]:.2f}")

    log("Basemap: shaded relief")
    t = (elev_out - ELEV_MIN_M) / (ELEV_MAX_M - ELEV_MIN_M)
    t = np.clip((t - 0.05) / 0.55, 0, 1) ** 0.9            # stretch so lowlands/highlands both show
    rgb = colour_ramp(t)
    hs = hillshade(elev_out)[..., None]
    rgb = np.clip(rgb * (0.45 + 0.75 * hs), 0, 255).astype(np.uint8)

    log("Writing PNG layers")
    data = {}
    png_b64.current = "elev";  data["elev"] = png_b64(v8_out)
    png_b64.current = "slope"; data["slope"] = png_b64(np.clip(np.round(slope_p90 * 8), 0, 255).astype(np.uint8))
    png_b64.current = "rough"; data["rough"] = png_b64(np.clip(np.round(rough / 4), 0, 255).astype(np.uint8))
    for k in ice:
        a = ice[k]
        enc = np.where(np.isnan(a), 0, np.clip(np.round(a * 100 + 128), 1, 255)).astype(np.uint8)  # 0 = no data
        png_b64.current = k; data[k] = png_b64(enc)
    png_b64.current = "ti";   data["ti"] = png_b64(np.where(ti <= 0, 0, np.clip(np.round(ti / 4), 1, 255)).astype(np.uint8))      # 0 = no data, 4 units/level
    png_b64.current = "dust"; data["dust"] = png_b64(np.where(dust < 0, 0, np.clip(np.round(dust * 200) + 1, 1, 255)).astype(np.uint8))  # 0 = no data
    png_b64.current = "base"; data["base"] = png_b64(rgb, "RGB")

    meta = {
        "width": OUT_W, "height": OUT_H,
        "lon0": -180, "lat0": 90, "deg_per_px": 360 / OUT_W,
        "elev": {"unit": "m", "scale": (ELEV_MAX_M - ELEV_MIN_M) / 255, "offset": ELEV_MIN_M,
                 "source": "MOLA MEGDR via NASA Mars Trek (Mars_MGS_MOLA_DEM_mosaic_global_463m_8), 8-bit linear stretch -8200..21230 m, ~115 m/level"},
        "slope": {"unit": "deg", "scale": 1 / 8, "offset": 0,
                  "source": "derived: 90th percentile of slope computed on 8192x4096 MOLA grid (~2.6 km/px) inside each 4x4 block"},
        "rough": {"unit": "m", "scale": 4, "offset": 0,
                  "source": "derived: std-dev of MOLA elevation inside each output cell (terrain roughness proxy)"},
        "ice": {"unit": "consistency -1..1", "scale": 0.01, "offset": -1.28, "nodata": 0, "lat_min": -60, "lat_max": 60,
                "source": "SWIM 2.0 global composite ice consistency (Planetary Science Institute / NASA), 3 km/px, swim.psi.edu"},
        "ti": {"unit": "J m^-2 K^-1 s^-1/2", "scale": 4, "offset": 0, "nodata": 0,
               "source": "MGS TES thermal inertia (Christensen et al.; Mellon/Putzig binned maps) via ASU JMARS WMS layer TES_Thermal_Inertia_numeric, 2048x1024"},
        "dust": {"unit": "fraction 0..1", "scale": 0.005, "offset": -0.005, "nodata": 0,
                 "source": "TES surface dust abundance (Bandfield 2002) via ASU JMARS WMS layer TES_Dust_numeric, 8 ppd"},
        "generated_by": "data_pipeline/preprocess.py",
    }
    with open(os.path.join(LAYERS, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    with open(os.path.join(WEB, "layers_data.js"), "w") as f:
        f.write("// Generated by data_pipeline/preprocess.py - do not edit by hand.\n")
        f.write("window.LAYER_META = " + json.dumps(meta) + ";\n")
        f.write("window.LAYER_DATA = " + json.dumps(data) + ";\n")
    log("Done ->", os.path.abspath(os.path.join(WEB, "layers_data.js")),
        f"({os.path.getsize(os.path.join(WEB, 'layers_data.js')) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
