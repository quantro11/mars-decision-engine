"""Fetch TES thermal inertia and dust abundance (numeric VICAR) from the ASU JMARS WMS into raw/."""
import os, ssl, urllib.request
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw"); os.makedirs(RAW, exist_ok=True)
BASE = ("https://ms-mars.mars.asu.edu/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326"
        "&WIDTH=2048&HEIGHT=1024&BBOX=-180,-90,180,90&STYLES=&FORMAT=image/vicar&LAYERS=")
for layer, out in [("TES_Thermal_Inertia_numeric", "tes_ti_numeric.vic"), ("TES_Dust_numeric", "tes_dust_numeric.vic")]:
    dest = os.path.join(RAW, out)
    if os.path.exists(dest) and os.path.getsize(dest) == 8396800:
        print(out, "already complete"); continue
    r = urllib.request.urlopen(urllib.request.Request(BASE + layer, headers={"User-Agent": "Mozilla/5.0"}), timeout=600, context=ssl.create_default_context())
    data = r.read(); open(dest, "wb").write(data); print(out, len(data), "bytes")
