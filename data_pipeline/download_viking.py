"""Fetch NASA Mars Trek Viking Orbiter MDIM 2.1 Colorized Global Mosaic (zoom 3 = 4096x2048 px)."""
import os
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
TILE_DIR = os.path.join(RAW, "viking_z3")
os.makedirs(TILE_DIR, exist_ok=True)

URL_TPL = (
    "https://trek.nasa.gov/tiles/Mars/EQ/"
    "Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/3/{y}/{x}.jpg"
)

CTX = ssl.create_default_context()


def fetch_tile(x, y):
    dest = os.path.join(TILE_DIR, f"{y}_{x}.jpg")
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return x, y, True
    url = URL_TPL.format(x=x, y=y)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            return x, y, True
        except Exception as exc:
            if attempt == 2:
                print(f"FAIL {url}: {exc}")
    return x, y, False


def main():
    tasks = [(x, y) for y in range(8) for x in range(16)]
    ok = 0
    with ThreadPoolExecutor(max_workers=16) as ex:
        futures = [ex.submit(fetch_tile, x, y) for x, y in tasks]
        for fut in as_completed(futures):
            _, _, success = fut.result()
            if success:
                ok += 1
    print(f"Viking MDIM 2.1 tiles (zoom 3, 4096x2048): {ok}/{len(tasks)} ok")

    mosaic = Image.new("RGB", (16 * 256, 8 * 256))
    for y in range(8):
        for x in range(16):
            p = os.path.join(TILE_DIR, f"{y}_{x}.jpg")
            tile = Image.open(p).convert("RGB")
            mosaic.paste(tile, (x * 256, y * 256))
    out_path = os.path.join(RAW, "viking_mdim21_4k.jpg")
    mosaic.save(out_path, quality=94, optimize=True)
    print("Saved stitched NASA Viking MDIM 2.1 mosaic ->", out_path)


if __name__ == "__main__":
    main()
