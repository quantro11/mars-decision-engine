"""
Fetch a 16-bit MOLA elevation grid without downloading the full 2.1 GB mosaic.

Source: USGS Astrogeology "Mars MGS MOLA DEM 463m" (MOLA MEGDR mosaic, int16 metres, 46080 x 23040,
uncompressed, one row per strip), mirrored on the USGS PDS S3 bucket. We read every STEP-th row with HTTP
range requests and keep every STEP-th column -> raw/mola16_<W>x<H>.npy (int16, metres, lat 90..-90, lon -180..180).

    python download_mola16.py            # STEP = 5 -> 9216 x 4608 (~2.3 km/px), ~425 MB transferred
"""
import concurrent.futures as cf
import os
import struct
import sys
import urllib.request

import numpy as np

URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
STEP = int(sys.argv[1]) if len(sys.argv) > 1 else 5
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
os.makedirs(RAW, exist_ok=True)


def get(a, b):
    req = urllib.request.Request(URL, headers={"Range": f"bytes={a}-{b}"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == 4:
                raise


def main():
    hdr = get(0, 7)
    assert hdr[:4] == b"II*\x00", "expected little-endian classic TIFF"
    ifd = struct.unpack("<I", hdr[4:8])[0]
    n = struct.unpack("<H", get(ifd, ifd + 1))[0]
    ents = get(ifd + 2, ifd + 2 + 12 * n)
    tags = {}
    for i in range(n):
        t, ty, c, v = struct.unpack("<HHII", ents[12 * i:12 * i + 12])
        tags[t] = (ty, c, v)
    W, H = tags[256][2], tags[257][2]
    assert tags[258][2] == 16 and tags[259][2] == 1 and tags[339][2] == 2, "expected int16 uncompressed"
    assert tags[273][1] == H, "expected one row per strip"
    offs = np.frombuffer(get(tags[273][2], tags[273][2] + 4 * H - 1), "<u4")
    rows = list(range(STEP // 2, H, STEP))
    out = np.zeros((len(rows), W // STEP), np.int16)
    rowbytes = 2 * W

    def fetch(k):
        y = rows[k]
        line = np.frombuffer(get(int(offs[y]), int(offs[y]) + rowbytes - 1), "<i2")
        out[k] = line[STEP // 2::STEP][: W // STEP]
        return k

    done = 0
    with cf.ThreadPoolExecutor(24) as ex:
        for _ in ex.map(fetch, range(len(rows))):
            done += 1
            if done % 250 == 0:
                print(f"{done}/{len(rows)} rows", flush=True)
    path = os.path.join(RAW, f"mola16_{out.shape[1]}x{out.shape[0]}.npy")
    np.save(path, out)
    print("saved", path, out.shape, "min", out.min(), "max", out.max())


if __name__ == "__main__":
    main()
