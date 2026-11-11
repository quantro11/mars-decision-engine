# Mars Base Decision Engine

**NASA Space Apps Challenge — "Interplanetary Survival Guide: Martian Map"**

A browser-based decision-support tool that turns real NASA / PSI Mars datasets into an answer to the question
*"Where should humans land and build a base, and how do they survive there?"* — instead of a map you look at,
a map that **decides** with you.

![screenshot](docs/screenshot_score.png)

## What it does

| Module | Question it answers | Data |
|---|---|---|
| **① Site score** | Where is the best compromise between *safe landing* (low, flat, smooth, firm, equatorial) and *sustainable living* (water ice for ISRU)? Weights are live sliders + 3 mission presets; hard constraints follow NASA's Human Landing Site workshop rules. Top-5 candidates are extracted and named. | MOLA elevation, MOLA-derived slope & roughness, SWIM 2.0 ice consistency (3 depth bands), TES thermal inertia, latitude (+ TES dust abundance as an inspection layer) |
| **② Rover route** | Which path between two points will not tip a rover over? A* on the slope grid vs. the straight line: distance, max slope, km on hazardous terrain, travel time, elevation profile. | MOLA slope |
| **③ Dust-storm crisis** | If a 2018-style global dust storm (τ ≈ 10) hits, how many sols does the base survive on batteries, and how many Kilopower reactors would fix it? | Site latitude + an explicit, cited energy model |

Everything runs client-side from one folder — no server, no API keys, works offline (judges can open `web/index.html` directly).

## Run it

```
web/index.html          # just open in a browser (Chrome / Edge / Firefox)
```

Demo deep links for the presentation:

```
index.html?preset=isru
index.html?demo=route&from=Jezero&to=Melas
index.html?demo=crisis&site=Arcadia&tau=9&kp=1
```

## Rebuild the data layers (optional, ~5 min)

```
cd data_pipeline
powershell -ExecutionPolicy Bypass -File download.ps1    # 512 MOLA tiles (Mars Trek) + 3 SWIM GeoTIFFs + 2 TES rasters (JMARS)
pip install numpy pillow tifffile imagecodecs
python preprocess.py                                      # -> web/layers_data.js + web/layers/*.png + meta.json
```

## Tests

```
node tests/scoring.test.js
```

Covers the suitability functions, preset behaviour (ISRU preset prefers the icy cell, landing preset the flat one),
hard-constraint vetoes, candidate extraction, A* (never crosses a > 15° wall, uses a gap when one exists) and the
storm model (reproduces Opportunity's 2018 ≈ 97 % power loss; two Kilopower units survive a τ = 8 storm).

## Repository layout

```
data_pipeline/   download.ps1, preprocess.py        raw NASA/PSI data -> browser layers
web/             index.html, app.js, scoring.js, astar.js, storm.js, regions.js, layers_data.js
tests/           scoring.test.js                    node unit tests (pure logic, no DOM)
docs/            methodology.md, pitch.md           formulas, sources, limitations, 3-minute pitch script
```

## Data sources

* **MOLA elevation** — Mars Global Surveyor MOLA MEGDR, served by NASA Mars Trek
  (`Mars_MGS_MOLA_DEM_mosaic_global_463m_8`, USGS Astrogeology). Used at 8192×4096 px (~2.6 km/px) for slope, delivered at 2048×1024.
* **SWIM 2.0** — Subsurface Water Ice Mapping, global composite ice-consistency maps at 0–1 m, 1–5 m and > 5 m depth,
  Planetary Science Institute for NASA (swim.psi.edu), 3 km/px, ±60° latitude.
* **TES thermal inertia & dust abundance** — Mars Global Surveyor TES (Christensen et al.; Bandfield 2002), served by ASU's JMARS WMS
  (`TES_Thermal_Inertia_numeric`, `TES_Dust_numeric`) as numeric VICAR rasters at 2048×1024.
* **Site-selection constraints** — NASA First Landing Site / Exploration Zone Workshop for Human Missions to Mars (2015):
  elevation ≤ +2 km, |latitude| ≤ 50°, access to ≥ 100 t of water, landing slopes ≤ 5°, traverse slopes ≤ 15°.
* **Dust-storm power loss** — NASA/JPL Opportunity status reports, June 2018 (τ ≈ 10.8; array output ≈ 650 → ≈ 22 Wh/sol).

See `docs/methodology.md` for every formula and every limitation.

## Limitations (we say them before the judges ask)

* 10 km/px grid: boulders, small craters and local hazards are **not** resolved — this selects *regions*, not landing ellipses.
* Elevation is quantised to ≈ 115 m levels (8-bit Trek product); slopes are therefore regional, not local.
* SWIM covers ±60° only; outside it ice is "unknown" and scored 0 (polar caps are excluded by the latitude rule anyway).
* Radiation, seasonal insolation, thermal cycling and dust-devil panel cleaning are not modelled.
* TES thermal inertia is a ~3 km binned product; dust abundance has 28 % no-data and is not scored separately.

## Team

Built in 27 hours for NASA Space Apps 2026 with real data, explicit formulas and unit tests.
