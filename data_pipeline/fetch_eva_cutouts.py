"""Fetch real 4 km x 4 km (40x40, 100 m/cell) pre-cut orbital bundles for the 4 preset Tactical EVA zones.

Sources queried (all public NASA / USGS / ASU / Caltech endpoints):
  - Elevation & slope (200 m): ASU JMARS WMS mola_hrsc_blend_topo_v2 & mola_hrsc_blend_slope_v2 (Fergason et al. 2018)
  - High-res Jezero DEM/ortho (2020): ASU JMARS WMS usgs_hirise_jezero_dtm_2020 & usgs_hirise_jezero_ortho_2020 (Fergason et al. 2020)
  - Thermal inertia (100 m): ASU JMARS WMS thm_ti_100m_32bit (Fergason, Christensen & Kieffer 2006 / 2014)
  - Surface dust cover index (~3.7 km): ASU JMARS WMS TES_dust_index_16ppd_numeric (Ruff & Christensen 2002)
  - Lambert albedo (~10 km & ~1-4 km): ASU JMARS WMS TES_Lambert_Albedo_numeric & omega_albedo_r1080
  - Elemental composition (~550 km): ASU JMARS WMS GRS_K_conc_numeric & GRS_Th_conc_numeric (Boynton et al. 2007)
  - Geologic map (~1:20M): ASU JMARS WMS mgs_geologic_map_mars_usgs_numeric + USGS Tanaka et al. (2014) SIM 3292 FeatureServer/3
  - Optical imagery (~5 m/px): Esri / Caltech Murray Lab Global CTX Mosaic OnMars/CTX LOD 12 (Dickson et al. 2023/2024)

Outputs:
  - web/layers/eva_cutouts.json (for HTTP & offline reference)
  - web/eva_cutouts_data.js      (UMD window.MDE_EVA_CUTOUTS for file:// & offline tests)
"""

import base64
import json
import math
import os
import re
import socket
import ssl
import struct
import sys
import time
import urllib.parse
import urllib.request
import zlib

sys.stdout.reconfigure(line_buffering=True)
socket.setdefaulttimeout(20)
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, "web", "layers", "eva_cutouts.json")
OUT_JS = os.path.join(ROOT, "web", "eva_cutouts_data.js")

MARS_RADIUS_M = 3396190.0
DEG_TO_M = math.pi * MARS_RADIUS_M / 180.0  # 59274.697 m/deg
GRID_N = 40
HALF_BOX_M = 2000.0
IMG_N = 200  # 20 m/px display mosaic for 4 km x 4 km (derived from ~5 m/px CTX)

ZONES = [
    {"id": "jezero_delta", "name": "Jezero Delta Front", "lat": 18.38, "lon": 77.58},
    {"id": "gale_boxwork", "name": "Gale Mt. Sharp Lower Slope", "lat": -5.08, "lon": 137.85},
    {"id": "nili_fossae", "name": "Nili Fossae Trough", "lat": 21.00, "lon": 74.00},
    {"id": "arcadia_ice", "name": "Arcadia Planitia Shallow Ice", "lat": 39.20, "lon": -175.00},
]

FS3_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer/3"
CTX_LOD = 12
CTX_RES_DEG = 8.58306884765625e-05
CTX_TILE_PX = 512


def fetch(url, timeout=20, retries=5):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MarsDecisionEngine/2.0"})
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return r.read()
        except Exception as e:
            last_err = e
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"Failed {url}: {last_err}")


def bbox_4km(lat, lon_deg):
    lon_180 = ((lon_deg + 180.0) % 360.0) - 180.0
    dlat = HALF_BOX_M / DEG_TO_M
    dlon = HALF_BOX_M / (DEG_TO_M * math.cos(math.radians(lat)))
    return (lon_180 - dlon, lat - dlat, lon_180 + dlon, lat + dlat)


def wms_url(layer, bbox, fmt="image/vicar", width=GRID_N, height=GRID_N):
    # Note: JMARS rejects percent-encoded image%2Fvicar, so pass literal FORMAT=image/vicar
    b = f"{bbox[0]:.6f},{bbox[1]:.6f},{bbox[2]:.6f},{bbox[3]:.6f}"
    return (
        f"https://ms-mars.mars.asu.edu/?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
        f"&LAYERS={layer}&STYLES=&SRS=EPSG:4326&BBOX={b}&WIDTH={width}&HEIGHT={height}&FORMAT={fmt}"
    )


def parse_vicar(data):
    if not data.startswith(b"LBLSIZE="):
        raise ValueError(f"Expected VICAR, got: {data[:160]!r}")
    lblsize = int(re.match(rb"LBLSIZE=(\d+)", data).group(1))
    hdr = data[:lblsize].decode("latin1", "replace")
    fmt = re.search(r"FORMAT='([^']+)'", hdr).group(1)
    intfmt_m = re.search(r"INTFMT='([^']+)'", hdr)
    realfmt_m = re.search(r"REALFMT='([^']+)'", hdr)
    intfmt = intfmt_m.group(1) if intfmt_m else "HIGH"
    realfmt = realfmt_m.group(1) if realfmt_m else "IEEE"
    ns = int(re.search(r"\bNS=(\d+)", hdr).group(1))
    nl = int(re.search(r"\bNL=(\d+)", hdr).group(1))
    nbb = int(re.search(r"\bNBB=(\d+)", hdr).group(1)) if re.search(r"\bNBB=(\d+)", hdr) else 0
    nlb = int(re.search(r"\bNLB=(\d+)", hdr).group(1)) if re.search(r"\bNLB=(\d+)", hdr) else 0
    recsize = int(re.search(r"\bRECSIZE=(\d+)", hdr).group(1)) if re.search(r"\bRECSIZE=(\d+)", hdr) else ns * 4
    raw = data[lblsize + nlb * recsize:]
    out = []
    if fmt == "REAL":
        e = "<" if realfmt == "RIEEE" else ">"
        for r in range(nl):
            row = raw[r * recsize + nbb : r * recsize + nbb + ns * 4]
            out.extend(struct.unpack(f"{e}{ns}f", row))
    elif fmt == "DOUB":
        e = "<" if realfmt == "RIEEE" else ">"
        for r in range(nl):
            row = raw[r * recsize + nbb : r * recsize + nbb + ns * 8]
            out.extend(struct.unpack(f"{e}{ns}d", row))
    elif fmt == "HALF":
        e = "<" if intfmt == "LOW" else ">"
        for r in range(nl):
            row = raw[r * recsize + nbb : r * recsize + nbb + ns * 2]
            out.extend(struct.unpack(f"{e}{ns}h", row))
    elif fmt == "BYTE":
        for r in range(nl):
            row = raw[r * recsize + nbb : r * recsize + nbb + ns]
            out.extend(row)
    else:
        raise ValueError(f"Unsupported VICAR format {fmt}")
    return ns, nl, out


def decode_png_gray(png_bytes):
    """Minimal stdlib 8-bit PNG decoder returning (w, h, list_of_uint8_luminance)."""
    if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Not a PNG")
    pos = 8
    w = h = bd = ct = 0
    plte = None
    idat = bytearray()
    while pos < len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
        ctype = png_bytes[pos + 4 : pos + 8]
        chunk = png_bytes[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            w, h, bd, ct, comp, flt, inter = struct.unpack(">IIBBBBB", chunk)
            if bd != 8 or comp != 0 or inter != 0:
                raise ValueError(f"Unsupported PNG IHDR bd={bd} ct={ct} inter={inter}")
        elif ctype == b"PLTE":
            plte = [chunk[i : i + 3] for i in range(0, len(chunk), 3)]
        elif ctype == b"IDAT":
            idat.extend(chunk)
        elif ctype == b"IEND":
            break
    raw = zlib.decompress(bytes(idat))
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * bpp
    prev = bytearray(stride)
    gray = bytearray(w * h)

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)

    idx = 0
    for y in range(h):
        ftype = raw[idx]
        idx += 1
        row = bytearray(raw[idx : idx + stride])
        idx += stride
        if ftype == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + paeth(a, b, c)) & 0xFF
        prev = row
        out_off = y * w
        if ct == 0:
            gray[out_off : out_off + w] = row
        elif ct == 2:
            for x in range(w):
                r_, g_, b_ = row[x * 3], row[x * 3 + 1], row[x * 3 + 2]
                gray[out_off + x] = (77 * r_ + 150 * g_ + 29 * b_) >> 8
        elif ct == 3:
            for x in range(w):
                rgb = plte[row[x]]
                gray[out_off + x] = (77 * rgb[0] + 150 * rgb[1] + 29 * rgb[2]) >> 8
        elif ct == 4:
            for x in range(w):
                gray[out_off + x] = row[x * 2]
        elif ct == 6:
            for x in range(w):
                r_, g_, b_, a_ = row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]
                lum = (77 * r_ + 150 * g_ + 29 * b_) >> 8
                gray[out_off + x] = lum if a_ > 0 else 0
    return w, h, gray


def encode_png_gray(w, h, gray_bytes):
    """Minimal stdlib 8-bit grayscale PNG encoder."""
    def chunk(ctype, payload):
        crc = zlib.crc32(ctype + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + ctype + payload + struct.pack(">I", crc)

    raw_lines = bytearray()
    for y in range(h):
        raw_lines.append(0)
        raw_lines.extend(gray_bytes[y * w : (y + 1) * w])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    idat = zlib.compress(bytes(raw_lines), level=9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def fetch_ctx_cutout(bbox, out_n=IMG_N):
    """Stitch OnMars/CTX LOD 12 tiles (~5 m/px) covering bbox -> (out_n x out_n PNG data URI, 40x40 tone, 40x40 contrast)."""
    lon_min, lat_min, lon_max, lat_max = bbox
    px_left = (lon_min + 180.0) / CTX_RES_DEG
    px_right = (lon_max + 180.0) / CTX_RES_DEG
    px_top = (90.0 - lat_max) / CTX_RES_DEG
    px_bottom = (90.0 - lat_min) / CTX_RES_DEG

    c0 = int(math.floor(px_left / CTX_TILE_PX))
    c1 = int(math.floor(px_right / CTX_TILE_PX))
    r0 = int(math.floor(px_top / CTX_TILE_PX))
    r1 = int(math.floor(px_bottom / CTX_TILE_PX))
    n_world_cols = int(round(360.0 / (CTX_RES_DEG * CTX_TILE_PX)))

    tiles = {}
    for tr in range(r0, r1 + 1):
        for tc in range(c0, c1 + 1):
            wc = ((tc % n_world_cols) + n_world_cols) % n_world_cols
            url = f"https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{CTX_LOD}/{tr}/{wc}"
            try:
                png_bytes = fetch(url, timeout=20, retries=5)
                tw, th, tgray = decode_png_gray(png_bytes)
                tiles[(tr, tc)] = (tw, th, tgray)
            except Exception as err:
                # Fallback to parent LOD 11 tile quadrant if Esri edge tile 500s
                pr, pc = tr >> 1, wc >> 1
                parent_url = f"https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{CTX_LOD - 1}/{pr}/{pc}"
                p_bytes = fetch(parent_url, timeout=20, retries=3)
                pw, ph, pgray = decode_png_gray(p_bytes)
                qx = (wc & 1) * (pw // 2)
                qy = (tr & 1) * (ph // 2)
                sub = bytearray(pw * ph)
                for yy in range(ph):
                    sy = qy + (yy >> 1)
                    for xx in range(pw):
                        sub[yy * pw + xx] = pgray[sy * pw + qx + (xx >> 1)]
                print(f"    LOD12 tile fallback ({err}) -> LOD11 {pr}/{pc}")
                tiles[(tr, tc)] = (pw, ph, sub)

    def sample_src(px, py):
        tc = int(math.floor(px / CTX_TILE_PX))
        tr = int(math.floor(py / CTX_TILE_PX))
        tw, th, tgray = tiles[(tr, tc)]
        lx = min(tw - 1, max(0, int(px - tc * CTX_TILE_PX)))
        ly = min(th - 1, max(0, int(py - tr * CTX_TILE_PX)))
        return tgray[ly * tw + lx]

    # Sample out_n x out_n image using 2x2 subpixel box average from ~5 m source
    img = bytearray(out_n * out_n)
    span_x = px_right - px_left
    span_y = px_bottom - px_top
    for oy in range(out_n):
        for ox in range(out_n):
            acc = 0
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    px = px_left + (ox + sx) / out_n * span_x
                    py = px_top + (oy + sy) / out_n * span_y
                    acc += sample_src(px, py)
            img[oy * out_n + ox] = acc >> 2

    png_out = encode_png_gray(out_n, out_n, img)
    data_uri = "data:image/png;base64," + base64.b64encode(png_out).decode("ascii")

    # Compute 40x40 block tone (mean / 255) & texture contrast (local std / 128)
    step = out_n // GRID_N
    tone_40 = []
    contrast_40 = []
    for gy in range(GRID_N):
        for gx in range(GRID_N):
            block = []
            for dy in range(step):
                row_off = (gy * step + dy) * out_n + gx * step
                block.extend(img[row_off : row_off + step])
            mean_v = sum(block) / len(block)
            var_v = sum((v - mean_v) ** 2 for v in block) / len(block)
            tone_40.append(round(mean_v / 255.0, 4))
            contrast_40.append(round(min(1.0, math.sqrt(var_v) / 64.0), 4))

    return data_uri, tone_40, contrast_40, len(png_out)


def fill_nodata(arr, valid_fn, n=GRID_N):
    """Fill missing/nodata cells using inverse-distance nearest valid neighbor."""
    valid_pts = [(r, c, arr[r * n + c]) for r in range(n) for c in range(n) if valid_fn(arr[r * n + c])]
    if not valid_pts:
        return [0.0] * (n * n)
    out = list(arr)
    for r in range(n):
        for c in range(n):
            v = out[r * n + c]
            if not valid_fn(v):
                best = min(valid_pts, key=lambda p: (p[0] - r) ** 2 + (p[1] - c) ** 2)
                out[r * n + c] = best[2]
    return out


def compute_horn_slope_deg(elev, cell_m=100.0, n=GRID_N):
    """3x3 Horn slope in degrees for any cell lacking valid measured slope."""
    slopes = [0.0] * (n * n)
    for r in range(n):
        rm = max(0, r - 1)
        rp = min(n - 1, r + 1)
        for c in range(n):
            cm = max(0, c - 1)
            cp = min(n - 1, c + 1)
            z00 = elev[rm * n + cm]
            z01 = elev[rm * n + c]
            z02 = elev[rm * n + cp]
            z10 = elev[r * n + cm]
            z12 = elev[r * n + cp]
            z20 = elev[rp * n + cm]
            z21 = elev[rp * n + c]
            z22 = elev[rp * n + cp]
            dzdx = ((z02 + 2 * z12 + z22) - (z00 + 2 * z10 + z20)) / (8.0 * cell_m)
            dzdy = ((z20 + 2 * z21 + z22) - (z00 + 2 * z01 + z02)) / (8.0 * cell_m)
            slopes[r * n + c] = round(math.degrees(math.atan(math.hypot(dzdx, dzdy))), 3)
    return slopes


def compute_relief_m(elev, n=GRID_N):
    """3x3 local topographic relief (max - min elev in m) & RMS deviation (m)."""
    relief = [0.0] * (n * n)
    for r in range(n):
        rm, rp = max(0, r - 1), min(n - 1, r + 1)
        for c in range(n):
            cm, cp = max(0, c - 1), min(n - 1, c + 1)
            win = [elev[rr * n + cc] for rr in range(rm, rp + 1) for cc in range(cm, cp + 1)]
            relief[r * n + c] = round(max(win) - min(win), 2)
    return relief


def fetch_sim3292_oid_map():
    """Fetch complete OBJECTID -> Unit symbol lookup across all 1,311 USGS SIM 3292 polygons."""
    oid_to_unit = {}
    for offset in (0, 1000):
        q = urllib.parse.urlencode({
            "where": "1=1",
            "outFields": "OBJECTID,Unit",
            "returnGeometry": "false",
            "resultOffset": str(offset),
            "resultRecordCount": "1000",
            "f": "json",
        })
        data = json.loads(fetch(f"{FS3_URL}/query?{q}"))
        for feat in data.get("features", []):
            attrs = feat["attributes"]
            oid_to_unit[str(attrs["OBJECTID"])] = attrs["Unit"]
    return oid_to_unit


def build():
    print("1/3 Fetching USGS SIM 3292 OBJECTID -> Unit lookup (1,311 features)...")
    oid_to_unit = fetch_sim3292_oid_map()
    print(f"    Loaded {len(oid_to_unit)} SIM 3292 polygon mappings.")

    zones_out = {}
    for z in ZONES:
        zid = z["id"]
        lat, lon = z["lat"], z["lon"]
        bb = bbox_4km(lat, lon)
        print(f"2/3 Fetching {zid} ({lat}, {lon}) bbox={[round(x, 5) for x in bb]}...")

        _, _, elev_blend = parse_vicar(fetch(wms_url("mola_hrsc_blend_topo_v2", bb)))
        _, _, slope_blend = parse_vicar(fetch(wms_url("mola_hrsc_blend_slope_v2", bb)))
        _, _, ti_raw = parse_vicar(fetch(wms_url("thm_ti_100m_32bit", bb)))
        _, _, dust_raw = parse_vicar(fetch(wms_url("TES_dust_index_16ppd_numeric", bb)))
        _, _, alb_tes = parse_vicar(fetch(wms_url("TES_Lambert_Albedo_numeric", bb)))
        _, _, alb_omega = parse_vicar(fetch(wms_url("omega_albedo_r1080", bb)))
        _, _, grs_k = parse_vicar(fetch(wms_url("GRS_K_conc_numeric", bb)))
        _, _, grs_th = parse_vicar(fetch(wms_url("GRS_Th_conc_numeric", bb)))
        _, _, geol_oid = parse_vicar(fetch(wms_url("mgs_geologic_map_mars_usgs_numeric", bb)))

        elev_clean = fill_nodata(elev_blend, lambda v: abs(v) < 25000)
        elev_source_id = "mola_hrsc_blend_topo_v2"
        elev_native_res_m = 200
        elev_date = "2018-01-31"

        elev_base = list(elev_clean)
        hi_mask = None
        hi_slope = None
        hi_relief = None
        if zid == "jezero_delta":
            try:
                _, _, hi_dtm = parse_vicar(fetch(wms_url("usgs_hirise_jezero_dtm_2020", bb)))
                cand_mask = [(-2695.0 < v < 0.0 and not math.isnan(v)) for v in hi_dtm]
                if sum(cand_mask) > 400:
                    hi_mask = cand_mask
                    hi_arr = [hi_dtm[i] if hi_mask[i] else 0.0 for i in range(GRID_N * GRID_N)]
                    hi_slope = compute_horn_slope_deg(hi_arr)
                    hi_relief = compute_relief_m(hi_arr)
                    elev_clean = [
                        round(hi_dtm[i], 2) if hi_mask[i] else elev_base[i]
                        for i in range(GRID_N * GRID_N)
                    ]
                    elev_source_id = "usgs_hirise_jezero_dtm_2020 + mola_hrsc_blend_topo_v2"
                    elev_native_res_m = 100  # 100 m analysis grid from 1 m HiRISE + 200 m MOLA-HRSC fill
                    elev_date = "2020-08 / 2018-01-31"
            except Exception as e:
                print(f"    Optional HiRISE DTM skipped: {e}")

        ti_clean = fill_nodata(ti_raw, lambda v: 5.0 < v < 3000.0 and not math.isnan(v))
        horn_slope = compute_horn_slope_deg(elev_base)
        base_relief = compute_relief_m(elev_base)
        slope_clean = []
        relief_m = []
        for r in range(GRID_N):
            for c in range(GRID_N):
                i = r * GRID_N + c
                use_hi = (
                    hi_mask is not None
                    and all(
                        hi_mask[max(0, min(GRID_N - 1, r + dr)) * GRID_N + max(0, min(GRID_N - 1, c + dc))]
                        for dr in (-1, 0, 1) for dc in (-1, 0, 1)
                    )
                )
                if use_hi:
                    slope_clean.append(hi_slope[i])
                    relief_m.append(hi_relief[i])
                else:
                    relief_m.append(base_relief[i])
                    if 0.0 <= slope_blend[i] < 89.0 and not math.isnan(slope_blend[i]):
                        slope_clean.append(round(slope_blend[i], 3))
                    else:
                        slope_clean.append(horn_slope[i])
        dust_clean = fill_nodata(dust_raw, lambda v: 0.5 < v <= 1.2 and not math.isnan(v))
        alb_clean = [
            round(alb_omega[i], 4) if (0.02 < alb_omega[i] < 0.8 and not math.isnan(alb_omega[i])) else round(alb_tes[i], 4)
            for i in range(GRID_N * GRID_N)
        ]
        alb_clean = fill_nodata(alb_clean, lambda v: 0.02 < v < 0.8 and not math.isnan(v))
        k_clean = fill_nodata(grs_k, lambda v: 0.0 <= v < 5.0 and not math.isnan(v))
        th_clean = fill_nodata(grs_th, lambda v: 0.0 <= v < 10.0 and not math.isnan(v))

        units = [oid_to_unit.get(str(int(oid)), "HNt") for oid in geol_oid]
        # Build run-length or compact unit list
        ctx_uri, ctx_tone, ctx_contrast, ctx_bytes = fetch_ctx_cutout(bb)

        zones_out[zid] = {
            "id": zid,
            "name": z["name"],
            "lat": lat,
            "lon": lon,
            "bbox": [round(x, 6) for x in bb],
            "gridN": GRID_N,
            "cellM": 100,
            "sizeKm": 4,
            "areaKm2": 16,
            "isPresetCutout": True,
            "sources": {
                "elevation": {"id": elev_source_id, "nativeResM": elev_native_res_m, "date": elev_date},
                "slope": {"id": "mola_hrsc_blend_slope_v2", "nativeResM": 200, "date": "2018-01-31"},
                "ti": {"id": "thm_ti_100m_32bit", "nativeResM": 100, "date": "2014-05-30"},
                "imagery": {"id": "OnMars/CTX (Caltech Murray Lab V01)", "nativeResM": 5, "displayResM": 20, "date": "2023-04"},
                "dust": {"id": "TES_dust_index_16ppd_numeric", "nativeResM": 3700, "lowRes": True, "date": "1999-2001 (Ruff & Christensen 2002)"},
                "albedo": {"id": "omega_albedo_r1080 + TES_Lambert_Albedo_numeric", "nativeResM": 3700, "lowRes": True, "date": "2004-2010 / 2001"},
                "geology": {"id": "USGS SIM 3292 (Tanaka et al. 2014)", "nativeResM": 20000, "lowRes": True, "date": "2014"},
                "grs": {"id": "GRS_K_conc_numeric + GRS_Th_conc_numeric (Odyssey GRS)", "nativeResM": 550000, "lowRes": True, "date": "2002-2006 (Boynton et al. 2007)"},
            },
            "elevM": [round(float(v), 1) for v in elev_clean],
            "slopeDeg": [round(float(v), 2) for v in slope_clean],
            "reliefM": relief_m,
            "ti": [round(float(v), 1) for v in ti_clean],
            "dci": [round(float(v), 4) for v in dust_clean],
            "albedo": [round(float(v), 4) for v in alb_clean],
            "grsK": [round(float(v), 3) for v in k_clean],
            "grsTh": [round(float(v), 3) for v in th_clean],
            "geolUnits": units,
            "ctxTone": ctx_tone,
            "ctxContrast": ctx_contrast,
            "ctxImgDataUri": ctx_uri,
        }
        print(
            f"    {zid}: elev=[{min(elev_clean):.1f},{max(elev_clean):.1f}]m "
            f"slope=[{min(slope_clean):.2f},{max(slope_clean):.2f}]deg "
            f"ti=[{min(ti_clean):.0f},{max(ti_clean):.0f}] "
            f"unit={units[GRID_N*(GRID_N//2)+GRID_N//2]} CTX={ctx_bytes} B"
        )

    payload = {
        "_meta": {
            "generated_by": "data_pipeline/fetch_eva_cutouts.py",
            "box_km": 4,
            "area_km2": 16,
            "grid_n": GRID_N,
            "cell_m": 100,
        },
        "sim3292ObjectIdToUnit": oid_to_unit,
        "zones": zones_out,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    js_src = (
        "(function (global) {\n"
        "  'use strict';\n"
        f"  var DATA = {json.dumps(payload, separators=(',', ':'))};\n"
        "  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;\n"
        "  else global.MDE_EVA_CUTOUTS = DATA;\n"
        "})(typeof window !== 'undefined' ? window : globalThis);\n"
    )
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js_src)
    print(f"3/3 Wrote {OUT_JSON} ({os.path.getsize(OUT_JSON)/1024:.1f} KB) and {OUT_JS} ({os.path.getsize(OUT_JS)/1024:.1f} KB)")


if __name__ == "__main__":
    build()
