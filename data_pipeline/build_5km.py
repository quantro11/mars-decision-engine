"""
Build the full browser layer set on a 4096 x 2048 grid (0.088 deg, ~5.2 km per pixel at the equator).

Inputs (data_pipeline/raw/):
    mola16_9216x4608.npy      16-bit MOLA (download_mola16.py)           -> elev, slope, rough at native ~2.3 km, aggregated
    SWIM2_c0_1.tif, SWIM2_c1_5.tif, SWIM2_c_5.tif   SWIM 2.0, 3 km/px      -> ice01, ice15, ice5 (box-resampled)
    mars_cave_catalog.zip     MGC3 cave candidates (caves.py)             -> cave distance
Existing 2048 x 1024 layers in web/layers/ (TES thermal inertia + dust come from ASU JMARS, which this
pipeline cannot re-download everywhere): ti, dust are upsampled 2x (nearest) - TES itself is a ~3 km binned
product delivered to us at 2048 x 1024, so these two layers stay at ~10 km effective resolution and say so in meta.

Writes web/layers/*.png, web/layers/meta.json + meta.js, web/layers_data.js (file:// bundle).

    python build_5km.py
"""
import base64
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
WEB = os.path.join(HERE, "..", "web")
LAYERS = os.path.join(WEB, "layers")
OUT_W, OUT_H = 4096, 2048
MARS_R = 3389500.0
ELEV_MIN_M, ELEV_MAX_M = -8200.0, 21230.0

sys.path.insert(0, HERE)
import caves as caves_mod  # noqa: E402


def log(*a):
    print(*a, flush=True)


def slope_deg(elev):
    H, W = elev.shape
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    dy = np.pi * MARS_R / H
    dx = np.maximum((2 * np.pi * MARS_R / W) * np.cos(np.radians(lat)), 1.0)[:, None]
    gx = (np.roll(elev, -1, 1) - np.roll(elev, 1, 1)) / (2 * dx)
    gy = np.gradient(elev, axis=0) / dy
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def reduce_rows(a, fn):
    """(4608, 9216) -> (2048, 4096): each output cell covers 2.25 x 2.25 source px.
    Duplicate each source px 4x4 so every output cell is exactly 9 x 9 equally weighted samples."""
    out = np.empty((OUT_H, OUT_W), np.float32)
    for y in range(OUT_H):
        r0 = (y * 9) // 4
        band = a[r0:r0 + 4]
        band = np.repeat(np.repeat(band, 4, axis=0), 4, axis=1)
        off = y * 9 - r0 * 4
        band = band[off:off + 9]
        out[y] = fn(band.reshape(9, OUT_W, 9).transpose(1, 0, 2).reshape(OUT_W, 81))
    return out


def load_swim(name):
    import tifffile
    with tifffile.TiffFile(os.path.join(RAW, name)) as t:
        a = t.pages[0].asarray().astype(np.float32)      # 7200 x 2400, lon -180..180, lat 60..-60
    a[a <= -30] = np.nan
    full = np.full((3600, 7200), np.nan, np.float32)     # pad to the whole globe (0.05 deg/px)
    full[600:3000] = a
    # area-average 7200x3600 -> 4096x2048 ignoring NaN: average values and validity separately
    valid = (~np.isnan(full)).astype(np.float32)
    vals = np.nan_to_num(full)
    s = np.array(Image.fromarray(vals, "F").resize((OUT_W, OUT_H), Image.BOX))
    w = np.array(Image.fromarray(valid, "F").resize((OUT_W, OUT_H), Image.BOX))
    out = np.where(w > 0.5, s / np.maximum(w, 1e-6), np.nan)
    return out


def up2(name):
    a = np.array(Image.open(os.path.join(LAYERS, name + ".png")))
    if a.shape == (OUT_H, OUT_W):
        return a
    assert a.shape == (OUT_H // 2, OUT_W // 2), (name, a.shape)
    return np.repeat(np.repeat(a, 2, axis=0), 2, axis=1)


def hillshade(elev_m):
    gy, gx = np.gradient(elev_m)
    px = 2 * math.pi * MARS_R / OUT_W
    slope = np.arctan(2.5 * np.hypot(gx / px, gy / px))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(45)
    return np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


def main():
    meta = json.load(open(os.path.join(LAYERS, "meta.json"), encoding="utf-8"))
    out = {}

    log("MOLA 16-bit -> elev / slope / rough on 4096 x 2048")
    elev = np.load(os.path.join(RAW, "mola16_9216x4608.npy")).astype(np.float32)
    sl = slope_deg(elev)
    slope_p90 = reduce_rows(sl, lambda b: np.percentile(b, 90, axis=1)); del sl
    rough = reduce_rows(elev, lambda b: b.std(axis=1))
    elev_out = reduce_rows(elev, lambda b: b.mean(axis=1)); del elev
    out["elev"] = np.clip(np.round((elev_out - ELEV_MIN_M) / (ELEV_MAX_M - ELEV_MIN_M) * 255), 0, 255).astype(np.uint8)
    out["slope"] = np.clip(np.round(slope_p90 * 8), 0, 255).astype(np.uint8)
    out["rough"] = np.clip(np.round(rough / 4), 0, 255).astype(np.uint8)
    log(f"  slope p90 median {np.median(slope_p90):.2f} deg; rough median {np.median(rough):.0f} m")

    log("SWIM 2.0 -> ice layers")
    for k, f in [("ice01", "SWIM2_c0_1.tif"), ("ice15", "SWIM2_c1_5.tif"), ("ice5", "SWIM2_c_5.tif")]:
        a = load_swim(f)
        out[k] = np.where(np.isnan(a), 0, np.clip(np.round(a * 100 + 128), 1, 255)).astype(np.uint8)

    log("TES ti / dust: 2x nearest upsample of the 2048 x 1024 JMARS product")
    out["ti"], out["dust"] = up2("ti"), up2("dust")

    log("Cave candidate distance")
    cv = caves_mod.load_catalog()
    d = caves_mod.distance_grid(cv, OUT_W, OUT_H)
    out["cave"] = np.clip(np.round(d / caves_mod.KM_PER_LEVEL), 0, 255).astype(np.uint8)

    log("Basemap: Viking MDIM 2.1 4K + MOLA hillshade")
    vk = os.path.join(LAYERS, "viking_4k.jpg")
    rgb = np.array(Image.open(vk).convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS), np.float32)
    base = np.clip(rgb * (0.78 + 0.38 * hillshade(elev_out)[..., None]), 0, 255).astype(np.uint8)

    log("Writing")
    data = {}
    for k, a in out.items():
        im = Image.fromarray(a, "L")
        im.save(os.path.join(LAYERS, k + ".png"), optimize=True)
        buf = io.BytesIO(); im.save(buf, format="PNG", optimize=True)
        data[k] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    # photo-like basemap as JPEG (~1.5 MB instead of ~14 MB as PNG); used by the file:// bundle and as http fallback
    bim = Image.fromarray(base, "RGB")
    bim.save(os.path.join(LAYERS, "base.jpg"), quality=88, optimize=True)
    buf = io.BytesIO(); bim.save(buf, format="JPEG", quality=88, optimize=True)
    data["base"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    old = os.path.join(LAYERS, "base.png")
    if os.path.exists(old):
        os.remove(old)

    meta.update({"width": OUT_W, "height": OUT_H, "deg_per_px": 360 / OUT_W})
    meta["elev"]["source"] = ("MOLA MEGDR 16-bit mosaic (USGS Mars_MGS_MOLA_DEM_mosaic_global_463m) sampled to 9216x4608 (~2.3 km), "
                              "cell mean on 4096x2048; browser storage 8-bit -8200..21230 m (~115 m/level)")
    meta["slope"]["source"] = "derived: 90th percentile of slope on the 16-bit 9216x4608 MOLA grid inside each 4096x2048 cell (81 samples)"
    meta["rough"]["source"] = "derived: std-dev of 16-bit MOLA elevation inside each 4096x2048 cell (81 samples)"
    meta["ice"]["source"] = "SWIM 2.0 global composite ice consistency (PSI / NASA), 3 km/px, area-averaged to 4096x2048"
    meta["ti"]["source"] += "; delivered at 2048x1024 and upsampled 2x (effective ~10 km)"
    meta["dust"]["source"] += "; delivered at 2048x1024 and upsampled 2x (effective ~10 km)"
    meta["cave"]["source"] = meta["cave"]["source"].split(";")[0] + "; computed on 4096x2048"
    meta["generated_by"] = "data_pipeline/build_5km.py (4096x2048)"
    json.dump(meta, open(os.path.join(LAYERS, "meta.json"), "w", encoding="utf-8"), indent=2)
    with open(os.path.join(LAYERS, "meta.js"), "w", encoding="utf-8") as f:
        f.write("// Generated from layers/meta.json - layer scaling and provenance.\nwindow.LAYER_META = " + json.dumps(meta) + ";\n")
    with open(os.path.join(WEB, "layers_data.js"), "w", encoding="utf-8") as f:
        f.write("// Generated by data_pipeline/build_5km.py - do not edit by hand.\n")
        f.write("window.LAYER_META = " + json.dumps(meta) + ";\n")
        f.write("window.LAYER_DATA = " + json.dumps(data) + ";\n")
    log("layers_data.js %.1f MB" % (os.path.getsize(os.path.join(WEB, "layers_data.js")) / 1e6))


if __name__ == "__main__":
    main()
