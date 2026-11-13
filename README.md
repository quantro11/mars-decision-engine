# Mars Base Decision Engine

**NASA Space Apps Challenge — "Interplanetary Survival Guide: Martian Map"**

A client-side planetary GIS and mission decision-support engine that fuses real NASA, USGS, PSI, and ASU orbital datasets into an actionable engineering planner answering *"Where should humans land and build a base on Mars, how do they traverse the surface safely, and how do they survive a global dust storm?"* — in both **2D Equirectangular** and **3D Interactive WebGL MOLA Topographic Globe** views.

![screenshot](docs/screenshot_score.png)

## Core Modules & Capabilities

| Module | Engineering Question Answered | Orbital Datasets & Physical Models |
|---|---|---|
| **01 // Site Selection** | Where is the optimal compromise between *safe EDL / landing* (low elevation, low slope, low roughness, moderate thermal inertia, equatorial insolation) and *sustainable ISRU* (shallow water ice)? Includes 3 mission presets, normalized sliders, NASA HLS-2015 vetoes, Top-5 candidate extraction, **ISRU Water Yield (L/sol) & 4-crew ECLSS mass balance**, and **MSL-RAD GCR radiation shielding**. | MGS MOLA DEM, MOLA 90th-pct slope & roughness, PSI SWIM 2.0 ice (3 depth bands), MGS TES thermal inertia & dust abundance, Viking MDIM 2.1 optical mosaic |
| **02 // Rover Traverse A\*** | Which corridor between surface coordinates avoids rover tip-over, boulder fields, and Spirit-like sand traps? Runs an 8-connected, spherical multi-hazard A* pathfinder on MOLA slope, roughness, and TES dust grids; automatically discovers **Emergency Safe Havens** (sheltered encampments) and compares distance, peak/mean slope, dust traps, and elevation profile against direct path. | MGS MOLA 90th-percentile slope, elevation & sub-cell roughness rasters, MGS TES thermal inertia |
| **03 // Dust-Storm & Thermal Power** | If a 2018-class global storm ($\tau \approx 8\text{–}11$) strikes at an **Areocentric Season ($L_s \in [0^\circ, 360^\circ]$)**, how many sols does the habitat survive before blackout or **Habitat Freeze-out ($0^\circ\text{C}$)** under nocturnal ambient temperatures (down to $-120^\circ\text{C}$)? Simulates post-storm dust fallout and 10 kWe Kilopower fission baseload units. | Site latitude, Mars obliquity & eccentricity ($L_s$), Opportunity 2018 empirical $\tau$-attenuation, nocturnal radiative temperature model, NASA KRUSTY Kilopower model |
| **04 // Live Habitability & Biosphere APIs** | What are the real-time space weather hazards, surface atmospheric conditions, and Earth vs. Mars biosphere habitability metrics? Queries NASA Open APIs (`api.nasa.gov`): the DONKI CME catalogue (live) and the InSight weather feed (archive only: the mission ended in Dec 2022). Every value is labelled LIVE / ARCHIVE / REFERENCE / OFFLINE; a failed request shows nothing rather than placeholder telemetry. Compares 6 Earth biosphere markers against Martian ECLSS countermeasures. | NASA DONKI CME API (live), NASA InSight Mars Weather API (archive), InSight climatology (Banfield et al. 2020) |
| **2D Map & 3D WebGL Globe** | Seamless switching between 2D Equirectangular map and hardware-accelerated **3D WebGL MOLA Displaced Globe** with 4K NASA Viking Orbiter MDIM 2.1 imagery, vertical relief exaggeration (`1×–15×`), directional solar hillshading, Rayleigh/dust limb scattering, and 3D raycast picking. | 4K NASA Viking MDIM 2.1 mosaic (`viking_4k.jpg`), 2048×1024 MOLA DEM vertex displacement & normal perturbation |
| **Mission Brief Export** | One-click **Export Brief** generates a structured **NASA-STD Mission Reconnaissance Dossier** with downloadable `.json` telemetry and a print/PDF-formatted engineering report. | Full synthesis of active weights, Top-5 candidates, A* traverse, Safe Havens, and storm/thermal simulation |

Everything runs 100% client-side with zero external runtime libraries, no server, and no API keys (works offline by opening `web/index.html` directly). Supports both desktop mouse/keyboard and mobile/tablet touch gestures (pinch-to-zoom, 1-finger pan/orbit, tap designation).

## Run Locally

```
web/index.html          # open directly in any modern browser (Chrome / Edge / Firefox / Safari)
```

Deep links for interactive demos:

```
index.html?preset=isru
index.html?view=3d
index.html?demo=route&from=Jezero&to=Nili
index.html?demo=crisis&site=Arcadia&tau=9&kp=1
```

## Rebuild the Data Layers (Optional, ~5 min)

```powershell
cd data_pipeline
powershell -ExecutionPolicy Bypass -File download.ps1    # 512 MOLA tiles + 3 SWIM GeoTIFFs + 2 TES VICAR rasters + Viking MDIM 2.1 mosaic
pip install numpy pillow tifffile imagecodecs
python preprocess.py                                      # -> web/layers_data.js + web/layers/*.png + meta.json
python download_mola16.py                                 # 16-bit MOLA, every 5th row via HTTP range (~425 MB of 2.1 GB)
python mola16.py                                          # rebuild elev / slope / rough from 16-bit data
```

## Automated Unit Tests & Validation

```bash
node tests/scoring.test.js     # unit tests (also run in GitHub Actions)
node tools/validate.js         # validation against real landers + HLS-2015 zones -> docs/validation.md
```

**Validation result:** the nine successful Mars landers (Viking 1/2, Pathfinder, Spirit, Opportunity, Curiosity, InSight, Perseverance, Zhurong) rank in the **89th percentile** of their own latitude band under the Landing-safety preset (random terrain: 50th, p < 0.005) — the model was never told where they are. See [`docs/validation.md`](docs/validation.md).

Verifies suitability transfer functions, preset ranking behaviour (ISRU vs. Landing Safety), NASA HLS-2015 hard constraint vetoes, non-maximum suppression candidate extraction, A* obstacle avoidance & gap traversal, Opportunity-calibrated dust-storm attenuation, MSL-RAD GCR radiation shielding, and seasonal $L_s$ insolation.

## Repository Layout

```
data_pipeline/   download.ps1, download_tes.py, download_viking.py, preprocess.py, download_mola16.py, mola16.py
web/             index.html, style.css, premium.css, app.js, globe3d.js, scoring.js, astar.js, storm.js, regions.js, live_api.js, layers_data.js
web/ui/          format.js, charts.js, markers.js, habitability.js   UI modules split out of app.js
tools/           validate.js                         validation report generator
tests/           scoring.test.js                    Node unit test suite (pure logic, zero DOM dependency)
docs/            methodology.md, pitch.md           Full mathematical specification, citations, limitations & pitch script
```

## Primary Data Sources & Citations

* **MGS MOLA Elevation** — 16-bit MOLA MEGDR mosaic (USGS Astrogeology `Mars_MGS_MOLA_DEM_mosaic_global_463m`, int16 metres), sampled to 9216×4608 (~2.3 km/px) with HTTP range requests, used for elevation, 90th-percentile slope and sub-cell roughness; delivered at 2048×1024 (~10.3 km/px). Matches published landing-site elevations within 10 m.
* **NASA Viking Orbiter MDIM 2.1 Optical Mosaic** — Global colorized optical mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`, NASA Mars Trek / USGS), 4096×2048 px.
* **SWIM 2.0 Subsurface Water Ice** — Subsurface Water Ice Mapping composite consistency maps at 0–1 m, 1–5 m, and >5 m depth (Planetary Science Institute / NASA, `swim.psi.edu`), 3 km/px, ±60° latitude.
* **MGS TES Thermal Inertia & Dust Abundance** — Mars Global Surveyor Thermal Emission Spectrometer (Christensen et al.; Bandfield 2002) via ASU JMARS WMS (`TES_Thermal_Inertia_numeric`, `TES_Dust_numeric`).
* **NASA HLS-2015 Constraints** — First Landing Site / Exploration Zone Workshop for Human Missions to Mars (2015): elevation ≤ +2 km, |latitude| ≤ 50°, landing/traverse slope limits ≤ 5° / ≤ 15°.
* **Surface GCR Radiation & Dust-Storm Calibration** — MSL Curiosity RAD surface dose measurements at Gale Crater (Hassler et al., *Science* 2014, ≈232 mSv/yr) and MER Opportunity June 2018 global storm telemetry ($\tau \approx 10.8$, ~97% solar array loss).
