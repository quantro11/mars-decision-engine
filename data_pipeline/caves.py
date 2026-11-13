"""
Cave candidates as a shelter-access layer.

Source: Mars Global Cave Candidate Catalog v1 (MGC3; Cushing 2017, USGS Astrogeology / PDS), 1062 candidate
cave entrances, skylights and atypical pit craters identified in THEMIS / CTX / HiRISE imagery.
Candidates are NOT confirmed caves.

Writes:
    web/caves.js                 window.CAVES = [[lat, lonE(-180..180), type, diameter_m], ...]
    web/layers/cave.png          8-bit distance to the nearest candidate, 4 km per level (0..1020 km; 255 = >= 1020 km)
    web/layers/meta.json / meta.js   'cave' entry
    web/layers_data.js           'cave' entry (base64, for file:// use)

    python caves.py
"""
import base64
import csv
import io
import json
import os
import urllib.request
import zipfile

import numpy as np
from PIL import Image

URL = ("https://astrogeology.usgs.gov/ckan/dataset/c2960f77-ee20-4cc6-ac85-abbecc0fc7f6/resource/"
       "ccd54fb2-9a50-46bf-8971-80c241bb2f40/download/mars_cave_catalog.zip")
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
WEB = os.path.join(HERE, "..", "web")
LAYERS = os.path.join(WEB, "layers")
R = 3389.5
KM_PER_LEVEL = 4


def load_catalog():
    os.makedirs(RAW, exist_ok=True)
    zp = os.path.join(RAW, "mars_cave_catalog.zip")
    if not os.path.exists(zp):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        open(zp, "wb").write(urllib.request.urlopen(req, timeout=120).read())
    rows = zipfile.ZipFile(zp).read("data/Mars_Cave_Catalog.csv").decode("utf-8", "replace").splitlines()
    out = []
    # The header is shifted by one column; actual order: Label, lon (0..360 E), lat, TypeCode, Priority, Diameter, Depth, Comment
    for r in csv.reader(rows[1:]):
        try:
            lon, lat = float(r[1]), float(r[2])
        except (ValueError, IndexError):
            continue
        lon = lon - 360 if lon > 180 else lon
        diam = float(r[5]) if len(r) > 5 and r[5].replace('.', '', 1).isdigit() else None
        out.append((lat, lon, r[3].strip(), diam))
    return out


def distance_grid(caves, W, H):
    lat = np.radians(90 - (np.arange(H) + 0.5) * 180 / H)[:, None]
    lon = np.radians(-180 + (np.arange(W) + 0.5) * 360 / W)[None, :]
    best = np.full((H, W), np.inf, np.float32)
    clat = np.radians([c[0] for c in caves]); clon = np.radians([c[1] for c in caves])
    for la, lo in zip(clat, clon):
        a = np.sin((lat - la) / 2) ** 2 + np.cos(lat) * np.cos(la) * np.sin((lon - lo) / 2) ** 2
        np.minimum(best, (2 * R * np.arcsin(np.sqrt(np.clip(a, 0, 1)))).astype(np.float32), out=best)
    return best


def main():
    caves = load_catalog()
    print(len(caves), "cave candidates;", "types:", sorted({c[2] for c in caves}))
    with open(os.path.join(WEB, "caves.js"), "w", encoding="utf-8") as f:
        f.write("// Mars Global Cave Candidate Catalog v1 (Cushing 2017, USGS/PDS). Candidates, not confirmed caves.\n")
        f.write("// [lat, lonE, type, diameter_m]\nwindow.CAVES = " + json.dumps([[round(a, 4), round(b, 4), t, d] for a, b, t, d in caves]) + ";\n")
    meta0 = json.load(open(os.path.join(LAYERS, "meta.json"), encoding="utf-8"))
    W, H = meta0["width"], meta0["height"]
    d = distance_grid(caves, W, H)
    enc = np.clip(np.round(d / KM_PER_LEVEL), 0, 255).astype(np.uint8)
    im = Image.fromarray(enc, mode="L"); im.save(os.path.join(LAYERS, "cave.png"), optimize=True)
    buf = io.BytesIO(); im.save(buf, format="PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    entry = {"unit": "km", "scale": KM_PER_LEVEL, "offset": 0, "max": 255 * KM_PER_LEVEL,
             "source": f"distance to nearest of {len(caves)} cave candidates, Mars Global Cave Candidate Catalog v1 (Cushing 2017, USGS Astrogeology); candidates are unconfirmed"}
    mj = os.path.join(LAYERS, "meta.json")
    meta = json.load(open(mj, encoding="utf-8")); meta["cave"] = entry
    json.dump(meta, open(mj, "w", encoding="utf-8"), indent=2)
    with open(os.path.join(LAYERS, "meta.js"), "w", encoding="utf-8") as f:
        f.write("// Generated from layers/meta.json - layer scaling and provenance.\nwindow.LAYER_META = " + json.dumps(meta) + ";\n")
    js = os.path.join(WEB, "layers_data.js")
    lines = open(js, encoding="utf-8").read().split("\n")
    lmeta = json.loads(lines[1][len("window.LAYER_META = "):].rstrip(";")); lmeta["cave"] = entry
    data = json.loads(lines[2][len("window.LAYER_DATA = "):].rstrip(";")); data["cave"] = uri
    with open(js, "w", encoding="utf-8") as f:
        f.write(lines[0] + "\n")
        f.write("window.LAYER_META = " + json.dumps(lmeta) + ";\n")
        f.write("window.LAYER_DATA = " + json.dumps(data) + ";\n")
    print("median distance %.0f km, cells within 100 km: %.1f %%" % (np.median(d), 100 * (d <= 100).mean()))


if __name__ == "__main__":
    main()
