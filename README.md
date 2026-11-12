# Mars Base Decision Engine

**NASA Space Apps Challenge — "Interplanetary Survival Guide: Martian Map"**

A client-side planetary GIS and mission decision-support engine that fuses real NASA, USGS, PSI, and ASU orbital datasets into an actionable engineering planner answering *"Where should humans land and build a base on Mars, how do they traverse the surface safely, and how do they survive a global dust storm?"* — in both **2D Equirectangular** and **3D Interactive WebGL MOLA Topographic Globe** views.

![screenshot](docs/screenshot_score.png)

## Core Modules & Capabilities

| Module | Engineering Question Answered | Orbital Datasets & Physical Models |
|---|---|---|
| **01 // Site Selection** | Where is the optimal compromise between *safe EDL / landing* (low elevation, low slope, low roughness, moderate thermal inertia, equatorial insolation) and *sustainable ISRU* (shallow water ice)? Includes 3 mission architecture presets, live normalized weight sliders, NASA HLS-2015 hard vetoes, Top-5 candidate extraction (2°×2° regional means, ≥800 km separation), and **MSL-RAD calibrated GCR radiation dose & atmospheric column shielding**. | MGS MOLA DEM, MOLA 90th-pct slope & sub-cell roughness, PSI SWIM 2.0 ice consistency (3 depth bands), MGS TES thermal inertia & dust abundance, Viking MDIM 2.1 optical mosaic |
| **02 // Rover Traverse A\*** | Which corridor between two surface coordinates avoids rover roll-over hazards? Runs an 8-connected, longitude-wrapping spherical A* pathfinder on the MOLA slope grid and compares total distance, peak/mean slope, km on >10° terrain, travel sols, and MOLA elevation profile against the direct great-circle path. | MGS MOLA 90th-percentile slope & elevation rasters |
| **03 // Dust-Storm Power** | If a 2018-class global dust storm ($\tau \approx 8\text{–}11$) strikes at a given **Areocentric Season ($L_s \in [0^\circ, 360^\circ]$)**, how many sols does the habitat survive on battery reserves, and how many 10 kWe Kilopower fission units are required for uninterrupted life support? | Site latitude, Mars $25.19^\circ$ obliquity & $e=0.0934$ orbital eccentricity ($L_s$), Opportunity 2018 empirical $\tau$-attenuation, NASA KRUSTY Kilopower baseload model |
| **2D Map & 3D WebGL Globe** | Seamless switching between a 2D IAU-2000 Equirectangular map and a hardware-accelerated **3D WebGL MOLA Displaced Globe** with 4K NASA Viking Orbiter MDIM 2.1 optical imagery, adjustable vertical relief exaggeration (`1×–15×`), directional solar hillshading, Rayleigh/dust atmospheric limb scattering, and full 3D raycast picking. | 4K NASA Viking MDIM 2.1 mosaic (`viking_4k.jpg`), 2048×1024 MOLA DEM vertex displacement & normal perturbation |
| **Mission Brief Export** | One-click **Export Brief** generates a structured **NASA-STD Mission Reconnaissance Dossier** with downloadable `.json` telemetry and a print/PDF-formatted engineering report. | Full synthesis of active weights, Top-5 candidates, A* traverse, and storm simulation |

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
```

## Automated Unit Tests

```bash
node tests/scoring.test.js
```

Verifies suitability transfer functions, preset ranking behaviour (ISRU vs. Landing Safety), NASA HLS-2015 hard constraint vetoes, non-maximum suppression candidate extraction, A* obstacle avoidance & gap traversal, Opportunity-calibrated dust-storm attenuation, MSL-RAD GCR radiation shielding, and seasonal $L_s$ insolation.

## Repository Layout

```
data_pipeline/   download.ps1, download_tes.py, download_viking.py, preprocess.py
web/             index.html, style.css, premium.css, app.js, globe3d.js, scoring.js, astar.js, storm.js, regions.js, layers_data.js
tests/           scoring.test.js                    Node unit test suite (pure logic, zero DOM dependency)
docs/            methodology.md, pitch.md           Full mathematical specification, citations, limitations & pitch script
```

## Primary Data Sources & Citations

* **MGS MOLA Elevation** — Mars Global Surveyor MOLA MEGDR via NASA Mars Trek (`Mars_MGS_MOLA_DEM_mosaic_global_463m_8`, USGS Astrogeology). Used at 8192×4096 px (~2.6 km/px) to derive 90th-percentile slope and sub-cell roughness, delivered at 2048×1024 (~10.3 km/px).
* **NASA Viking Orbiter MDIM 2.1 Optical Mosaic** — Global colorized optical mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`, NASA Mars Trek / USGS), 4096×2048 px.
* **SWIM 2.0 Subsurface Water Ice** — Subsurface Water Ice Mapping composite consistency maps at 0–1 m, 1–5 m, and >5 m depth (Planetary Science Institute / NASA, `swim.psi.edu`), 3 km/px, ±60° latitude.
* **MGS TES Thermal Inertia & Dust Abundance** — Mars Global Surveyor Thermal Emission Spectrometer (Christensen et al.; Bandfield 2002) via ASU JMARS WMS (`TES_Thermal_Inertia_numeric`, `TES_Dust_numeric`).
* **NASA HLS-2015 Constraints** — First Landing Site / Exploration Zone Workshop for Human Missions to Mars (2015): elevation ≤ +2 km, |latitude| ≤ 50°, landing/traverse slope limits ≤ 5° / ≤ 15°.
* **Surface GCR Radiation & Dust-Storm Calibration** — MSL Curiosity RAD surface dose measurements at Gale Crater (Hassler et al., *Science* 2014, ≈232 mSv/yr) and MER Opportunity June 2018 global storm telemetry ($\tau \approx 10.8$, ~97% solar array loss).
