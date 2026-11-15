#!/usr/bin/env python3
"""
Build web/dust_climatology_data.js from the Montabone et al. column dust optical depth (CDOD) maps.

Data (download manually, open access, CC BY-SA):
  https://www-mars.lmd.jussieu.fr/mars/dust_climatology/
  Either the per-year NetCDF files (e.g. MY28 ... MY36) or the "All MYs" tar.gz. Both the irregularly gridded
  maps and the complete kriged maps work; the kriged maps have no gaps and are preferred.

Usage:
  python data_pipeline/build_dust_climatology.py <file-or-folder> [<file-or-folder> ...]
  (folders are searched recursively for *.nc; .tar.gz archives are opened directly)

What it writes (one small JS file, ~200 KB):
  For a 6° lon × 5° lat grid and 12 seasonal bins of 30° Ls, across all Mars years found:
    mean  = mean visible dust optical depth (normalised to 610 Pa)
    p90   = 90th percentile of the same
    fDust = fraction of sols with visible tau(610 Pa) >= 1.5 (regional-storm-level haze)
  Visible extinction = 2.6 × the 9.3 µm absorption CDOD (Montabone et al. 2015, ratio used for MCD dust scenarios).

Readers: scipy (NetCDF classic) is tried first, then netCDF4 or h5py if installed (needed for NetCDF-4 files):
  pip install netCDF4
"""
import io
import json
import math
import os
import re
import sys
import tarfile

import numpy as np

VIS_PER_ABS = 2.6          # visible extinction / 9.3 µm absorption (Montabone et al. 2015)
DUSTY_TAU = 1.5            # visible tau(610 Pa) counted as "dusty sol"
D_LON, D_LAT = 6.0, 5.0    # output grid
N_LS = 12                  # 30° Ls bins
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'dust_climatology_data.js')


# ------------------------------------------------------------------ Mars orbit: Ls from sol-of-year (if no Ls variable)
def ls_from_soy(soy):
    """Areocentric longitude for sols counted from Ls = 0 (Kepler orbit, e = 0.0934, perihelion Ls = 251°)."""
    e, ls_p, year = 0.0934, math.radians(251.0), 668.6
    def m_of_ls(ls_deg):  # mean anomaly for a given Ls
        nu = math.radians(ls_deg) - ls_p
        ea = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * math.tan(nu / 2))
        return ea - e * math.sin(ea)
    m0 = m_of_ls(0.0)
    grid = np.linspace(0, 360, 3601)
    sols = np.array([((m_of_ls(l) - m0) % (2 * math.pi)) / (2 * math.pi) * year for l in grid])
    sols[-1] = year
    return np.interp(np.asarray(soy, dtype=float) % year, sols, grid)


# ------------------------------------------------------------------ NetCDF reading (scipy -> netCDF4 -> h5py)
def open_vars(path_or_bytes, name):
    errors = []
    try:
        from scipy.io import netcdf_file
        src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
        f = netcdf_file(src, 'r', mmap=False)
        return {k: (np.array(v.data), dict(v._attributes)) for k, v in f.variables.items()}
    except Exception as ex:  # noqa: BLE001
        errors.append(f'scipy: {ex}')
    try:
        import netCDF4
        ds = netCDF4.Dataset(name, memory=path_or_bytes) if isinstance(path_or_bytes, bytes) else netCDF4.Dataset(path_or_bytes)
        out = {}
        for k, v in ds.variables.items():
            arr = v[:]
            out[k] = (np.ma.filled(arr.astype(float), np.nan) if np.ma.isMaskedArray(arr) else np.array(arr), {a: v.getncattr(a) for a in v.ncattrs()})
        return out
    except Exception as ex:  # noqa: BLE001
        errors.append(f'netCDF4: {ex}')
    try:
        import h5py
        f = h5py.File(io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes, 'r')
        out = {}
        for k, v in f.items():
            if hasattr(v, 'shape'):
                out[k] = (np.array(v), {a: v.attrs[a] for a in v.attrs})
        return out
    except Exception as ex:  # noqa: BLE001
        errors.append(f'h5py: {ex}')
    raise RuntimeError(f'{name}: cannot read ({"; ".join(errors)}). If this is NetCDF-4, run: pip install netCDF4')


def pick(vars_, *cands):
    low = {k.lower(): k for k in vars_}
    for c in cands:
        if c.lower() in low:
            return low[c.lower()]
    return None


def extract(vars_, name):
    lon_k = pick(vars_, 'longitude', 'lon')
    lat_k = pick(vars_, 'latitude', 'lat')
    if not lon_k or not lat_k:
        raise RuntimeError(f'{name}: no longitude/latitude variables (found {list(vars_)})')
    cands = [k for k, (a, _) in vars_.items() if 'cdod' in k.lower() and a.ndim == 3]
    if not cands:
        raise RuntimeError(f'{name}: no 3-D CDOD variable (found {list(vars_)})')
    cands.sort(key=lambda k: (0 if '610' in k else 1, 0 if 'err' not in k.lower() and 'std' not in k.lower() else 2))
    var_k = cands[0]
    data, attrs = vars_[var_k]
    data = data.astype(float)
    for fill_key in ('_FillValue', 'missing_value'):
        if fill_key in attrs:
            data[data == float(np.ravel(attrs[fill_key])[0])] = np.nan
    data[(data < 0) | (data > 50)] = np.nan
    lon = vars_[lon_k][0].astype(float).ravel()
    lat = vars_[lat_k][0].astype(float).ravel()
    ls_k = pick(vars_, 'Ls', 'ls', 'solar_longitude')
    t_k = pick(vars_, 'Time', 'time', 'sol', 'soy')
    t = vars_[t_k][0].astype(float).ravel() if t_k is not None and vars_[t_k][0].size == data.shape[0] else None
    if ls_k is not None and vars_[ls_k][0].size == data.shape[0]:
        ls = vars_[ls_k][0].astype(float).ravel() % 360
    elif t is not None:
        ls = ls_from_soy(t)
    else:
        raise RuntimeError(f'{name}: no Ls or Time variable')
    # one key per sol: integer sol-of-year when a Time axis exists, else 0.5° Ls steps (~1 sol)
    sol_key = np.floor(t + 1e-6).astype(int) if t is not None else np.round(ls / 0.5).astype(int)
    # put dimensions in (time, lat, lon) order
    shp = data.shape
    if shp[1] == lon.size and shp[2] == lat.size:
        data = data.transpose(0, 2, 1)
    elif not (shp[1] == lat.size and shp[2] == lon.size):
        raise RuntimeError(f'{name}: unexpected shape {shp} for lat {lat.size} / lon {lon.size}')
    lon = ((lon + 180) % 360) - 180
    return var_k, ls, sol_key, lat, lon, data * VIS_PER_ABS


def mars_year_of(name):
    m = re.search(r'MY[_-]?(\d{2})', name, re.I)
    return m.group(1) if m else None


def list_inputs(paths):
    """[(name, loader)] for every .nc file (directly, inside folders, or inside .tar/.tar.gz archives)."""
    items = []
    def add_tar(path):
        with tarfile.open(path) as tf:
            for m in tf.getmembers():
                if m.isfile() and m.name.endswith('.nc'):
                    items.append((os.path.basename(m.name), (lambda p=path, n=m.name: _read_member(p, n))))
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for fn in sorted(files):
                    full = os.path.join(root, fn)
                    if fn.endswith('.nc'):
                        items.append((fn, (lambda f=full: f)))
                    elif fn.endswith(('.tar.gz', '.tgz', '.tar')):
                        add_tar(full)
        elif p.endswith(('.tar.gz', '.tgz', '.tar')):
            add_tar(p)
        else:
            items.append((os.path.basename(p), (lambda f=p: f)))
    return items


def _read_member(tar_path, member):
    with tarfile.open(tar_path) as tf:
        return tf.extractfile(member).read()


TAU_BIN = 0.05            # histogram step for percentiles (visible tau)
N_TAU = 241               # 0 .. 12 (last bin = 12+)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    n_lon, n_lat = int(360 / D_LON), int(180 / D_LAT)
    n_cell = n_lat * n_lon
    # streaming statistics per Ls bin x cell: sum, count, histogram (for p90), dusty count
    tsum = np.zeros((N_LS, n_cell)); tcnt = np.zeros((N_LS, n_cell))
    hist = np.zeros((N_LS, n_cell, N_TAU), dtype=np.uint32)
    used, years = [], []
    items = list_inputs(argv)
    groups = {}
    for name, loader in items:
        groups.setdefault(mars_year_of(name) or ('?' + name), []).append((name, loader))
    for my, files in sorted(groups.items()):
        # Several files for the same Mars year (e.g. gridded + kriged, or sub-daily maps) are first averaged per sol
        # and cell, so every Mars year and every sol counts exactly once.
        per_sol = {}   # sol_key -> [ls, sums(n_cell), counts(n_cell)]
        for name, loader in files:
            try:
                var_k, ls, sol_key, lat, lon, tau = extract(open_vars(loader(), name), name)
            except RuntimeError as ex:
                print('  skip:', ex)
                continue
            yi = np.clip(((lat + 90) // D_LAT).astype(int), 0, n_lat - 1)
            xi = np.clip(((lon + 180) // D_LON).astype(int), 0, n_lon - 1)
            cell = (yi[:, None] * n_lon + xi[None, :]).ravel()
            for k in range(tau.shape[0]):
                frame = tau[k].ravel()
                ok = ~np.isnan(frame)
                rec = per_sol.setdefault(int(sol_key[k]), [ls[k], np.zeros(n_cell), np.zeros(n_cell)])
                rec[1] += np.bincount(cell[ok], weights=frame[ok], minlength=n_cell)
                rec[2] += np.bincount(cell[ok], minlength=n_cell)
            used.append(f'{name} ({var_k}, {tau.shape[0]} maps)')
            print('  read', used[-1])
            del tau
        if not per_sol:
            continue
        years.append(my)
        for ls_k, sums, cnts in per_sol.values():
            b = int(ls_k // (360 / N_LS)) % N_LS
            ok = cnts > 0
            daily = np.zeros(n_cell); daily[ok] = sums[ok] / cnts[ok]
            tsum[b, ok] += daily[ok]; tcnt[b, ok] += 1
            hb = np.clip((daily / TAU_BIN).astype(int), 0, N_TAU - 1)
            idx = np.nonzero(ok)[0]
            hist[b, idx, hb[idx]] += 1
        print(f'  Mars year {my}: {len(per_sol)} sols')
    if not used:
        print('No usable CDOD files found.')
        return 1
    mean = np.where(tcnt >= 3, tsum / np.maximum(tcnt, 1), np.nan)
    cum = np.cumsum(hist, axis=2)
    tot = cum[:, :, -1:]
    p90_bin = np.argmax(cum >= 0.9 * np.maximum(tot, 1), axis=2)
    p90 = np.where(tcnt >= 3, (p90_bin + 0.5) * TAU_BIN, np.nan)
    dusty_from = int(round(DUSTY_TAU / TAU_BIN))
    fdust = np.where(tcnt >= 3, hist[:, :, dusty_from:].sum(axis=2) / np.maximum(tcnt, 1), np.nan)
    import warnings
    warnings.simplefilter('ignore', category=RuntimeWarning)
    for arr in (mean, p90, fdust):  # cells without data (polar night) take the zonal mean of their Ls bin
        g = arr.reshape(N_LS, n_lat, n_lon)
        zonal = np.nanmean(g, axis=2, keepdims=True)
        g[:] = np.where(np.isnan(g), np.broadcast_to(zonal, g.shape), g)
        g[np.isnan(g)] = 0.0
    q = lambda arr, s: [int(round(v * s)) for v in np.clip(arr, 0, 255 / s).ravel()]  # noqa: E731
    payload = {
        'meta': {
            'source': 'Montabone et al. column dust optical depth maps (LMD Mars Climate Database dust climatology)',
            'files': used,
            'marsYears': sorted(y for y in years if not y.startswith('?')),
            'solsPerYear': None,
            'units': 'visible dust optical depth normalised to 610 Pa (2.6 x 9.3 um absorption CDOD); daily means, each Mars year and sol counted once',
            'dustyTauThreshold': DUSTY_TAU,
            'grid': {'dLon': D_LON, 'dLat': D_LAT, 'nLon': n_lon, 'nLat': n_lat, 'lon0': -180, 'lat0': -90, 'nLs': N_LS},
            'scale': {'mean': 50, 'p90': 50, 'fDust': 250},
        },
        'mean': q(mean, 50), 'p90': q(p90, 50), 'fDust': q(fdust, 250),
    }
    del payload['meta']['solsPerYear']
    js = ('// Auto-generated by data_pipeline/build_dust_climatology.py from the Montabone et al. CDOD maps. Do not edit.\n'
          '(function (global) { global.MDE_DUST_CLIM = ' + json.dumps(payload, separators=(',', ':')) + '; })'
          "(typeof window !== 'undefined' ? window : module.exports);\n")
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(js)
    print(f'Wrote {os.path.relpath(OUT)} ({len(js) / 1024:.0f} KB) from {len(used)} file(s), Mars years {payload["meta"]["marsYears"]}.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
