# Methodology

All numbers shown in the app can be traced to this document.

## 1. Grid

Simple cylindrical, 2048 × 1024 px, lon −180…180 °E, lat 90…−90 (IAU-2000 volumetric mean radius $R = 3389.5\text{ km}$). One pixel = 0.1758° ≈ 10.4 km at the equator.
Elevation, slope and roughness come from the **16-bit** MOLA MEGDR mosaic (1 m vertical resolution), sampled to 9216 × 4608 (≈ 2.3 km/px) and aggregated into the output grid (each output cell = 4.5 × 4.5 source px, evaluated as 81 equally weighted samples).

## 2. Layers

| Layer | Source | Processing |
|---|---|---|
| Elevation `h` (m) | USGS `Mars_MGS_MOLA_DEM_mosaic_global_463m` (int16 metres), every 5th row/column read by HTTP range requests (`download_mola16.py`) | cell mean; checked against published landing-site elevations: Curiosity −4500 vs −4501 m, Opportunity −1384 vs −1385, Spirit −1943 vs −1935, Viking 1 −3637 vs −3627. Stored in the browser as 8-bit (≈ 115 m/level) for scoring, which only needs ±2 km resolution |
| Slope `s` (°) | derived | `atan(|∇h|)` with metre-per-pixel scaled by `cos(lat)`; computed on the 16-bit 2.3 km grid; output = 90th percentile of the 81 samples in each cell (a pessimistic, safety-oriented statistic) |
| Roughness `r` (m) | derived | standard deviation of the 81 16-bit elevation samples in each cell |
| Ice `c` (−1…1) | SWIM 2.0 composite ice consistency (0–1 m, 1–5 m, > 5 m) | box-resampled from 7200 × 2400 (3 km/px); rows outside ±60° = no data |
| Thermal inertia `I` (tiu) | MGS TES (Christensen et al.; Putzig/Mellon) via ASU JMARS WMS | 2048 × 1024 numeric VICAR (`J m⁻² K⁻¹ s⁻½`) |
| Dust abundance `d` (0…1) | MGS TES surface dust fraction (Bandfield 2002) via ASU JMARS WMS | 2048 × 1024 numeric VICAR |
| Optical basemap | NASA Viking Orbiter MDIM 2.1 global mosaic | 4096 × 2048 colour mosaic + MOLA directional hillshade |
| Latitude | — | row centre |

## 3. Suitability functions

`ramp(x, x0, x1)` = 1 for x ≤ x0, 0 for x ≥ x1, linear between.

| Criterion | f | Justification |
|---|---|---|
| Elevation | `ramp(h, −2000, 2000)` | Entry-descent-landing needs atmosphere: NASA HLS workshop requires ≤ +2 km; every successful lander sat below −1 km except Viking 2 (−4.5 km lower still) |
| Slope | `ramp(s, 5, 15)` | ≤ 5° landing ellipse, ≤ 15° rover traverse (MER/MSL planning limits; Perseverance static tip-over ≈ 45°, operational ≈ 30°, planning ≤ 15–20°) |
| Ice | `(c + 1) / 2`, 0 if unknown | SWIM consistency: +1 = all datasets agree ice is present |
| Roughness | `ramp(r, 30, 250)` | elevation σ inside a 10 km cell: < 30 m plains, > 250 m heavily cratered / mountainous |
| Thermal inertia | `<= 0.3*I/100` below 100; rises to 1 at 150; 1 for 150-400; `ramp(I, 400, 700)` above; 0.5 if no data | I < 100: thick fine dust - low bearing strength, panel dust loading, EDL radar ambiguity (MER site-selection rule: I > 100-150). 150-400: sand / duricrust, diggable. > 500: rock / bedrock - hazard, hard to excavate |
| Latitude | `(cos φ − cos 50°) / (1 − cos 50°)`, clipped to 0…1 | mean annual insolation ∝ cos φ; NASA HLS limit ±50° (thermal + solar) |

## 4. Aggregation

`S = Σ wᵢ fᵢ`, weights normalised to Σ w = 1.
Hard constraints (toggle): `h > +2000 m`, `s > 15°`, `|φ| > 50°` ⇒ `S = 0`.

Presets (elev / slope / ice / rough / lat / thermal inertia):

* Landing safety 0.30 / 0.25 / 0.05 / 0.15 / 0.10 / 0.15
* ISRU / sustainability 0.10 / 0.15 / 0.45 / 0.10 / 0.10 / 0.10
* Balanced crewed mission 0.20 / 0.20 / 0.25 / 0.10 / 0.10 / 0.15

## 5. Candidate extraction

Mean score per 2° × 2° block (11 × 11 px); greedy non-maximum suppression with 800 km minimum separation; the five best blocks are named after the nearest entry of a 46-region gazetteer (within 6°; otherwise compass-sector offset from nearest region). Cards show block means.

## 6. Multi-hazard route planner (A*) & Emergency Safe Havens

A* on the 2048 × 1024 grid, 8-connected, longitude wrapping, search window = bounding box ± 160 px.
Edge cost integrates slope, sub-cell roughness ($r > 50\text{ m}$), and TES low-TI fine-dust sinkage ($I < 100\text{ tiu}$, e.g. Spirit-like Troy dust traps):

```
cost(a → b) = d · [ 1 + k · (s_b + max(0, (r_b − 50)/25) + 80 · max(0, 1 − I_b/100)) ]
```

where `k` = 0.3 default, and `s_b > s_max` (15° default) is strictly impassable.
Heuristic = haversine distance (admissible, Mars radius 3389.5 km).
Reported: distance, max / mean slope, km on > 10° terrain, km across low-TI dust (< 100 tiu), mean sub-cell roughness (σ), travel time at user-set speed (default 20 km/sol — representing a crewed pressurised rover), and elevation profile.

**Emergency Safe Havens along Traverse:**
For crew survival during multi-sol traverses, the pathfinder identifies natural encampment shelters where slope $\le 4.0^\circ$, sub-cell roughness $\le 35\text{ m}$, and firm bearing capacity ($I \ge 160\text{ tiu}$) provide safe parking and topography protection against localized dust winds.

## 7. Dust-storm, Thermal Life Support & ECLSS Energy Model

```
E_solar(kWh/sol) = A · η · 3.0 · S_season(φ, Ls) · exp(−0.35 (τ − 0.5)) · (1 − f_dust)
E_nuclear        = n_Kilopower · 10 kW · 24.66 h
battery(t+1)     = clamp(battery(t) + E_solar + E_nuclear − consumption, 0, capacity)
```

* 3.0 kWh/m²/sol: clear-sky equatorial daily insolation (Appelbaum & Flood, *Solar radiation on Mars*, NASA TM-102299, 1989).
* `S_season(φ, Ls)` models Mars's axial obliquity ($\varepsilon = 25.19^\circ$, solar declination $\sin\delta = \sin\varepsilon\sin L_s$) and orbital eccentricity ($e = 0.0934$, perihelion at $L_s = 251^\circ$) via the diurnal insolation integral. When $L_s$ is omitted, it reduces to $\cos\phi$.
* `exp(−0.35 (τ − 0.5))` is an **empirical** attenuation normalised to a typical clear sky (τ = 0.5) and fitted so that τ ≈ 10.8 yields ≈ 3 % of clear-sky output, matching Opportunity's drop from ≈ 650 to ≈ 22 Wh/sol in June 2018.
* **Post-Storm Permanent Dust Fallout:** During active storms, atmospheric dust settles on horizontal arrays at $\approx 0.2\%\text{ per sol}$ (MER Opportunity and InSight radiometer calibrated), causing permanent degradation unless active cleaning mechanisms (electrostatic or mechanical wipers) are deployed.
* **Thermal Life-Support & Habitat Freeze-out:** Mars nocturnal temperatures plummet to $-70^\circ\text{C}$ to $-125^\circ\text{C}$. Pressurized habitat insulation ($UA \approx 90\text{ W/K}$) and battery warmers require continuous thermal baseline heating:
  $$P_{\text{thermal}}(\text{kWe}) = 2.2 + 0.090 \cdot \max(0, 20^\circ\text{C} - T_{\text{mean}})$$
  When base power blacks out, habitat interior cools toward ambient ($\tau_{\text{thermal}} \approx 1.5\text{ sols}$). The engine detects and reports the exact `Freeze-out Sol` when interior temperatures drop below $0^\circ\text{C}$.
* Kilopower: 10 kWe fission unit (NASA KRUSTY test 2018).

## 8. ISRU Life-Support Water Yield & Mass Balance

```
Yield(H₂O L/sol) = c_norm · DepthFactor · 68.0 L/sol   (5 kWe thermal-drill baseline)
O₂ Production     = Yield · 0.888 kg O₂/L              (stoichiometric electrolysis)
Crew Margin       = Yield − 10.0 L/sol                (4-crew metabolic demand with 85% ECLSS recovery)
```

* Evaluates viability for human survival and Mars Ascent Vehicle (MAV) Sabatier propellant production (requiring $\ge 25\text{ L/sol}$ net surplus).

## 9. Atmospheric column & GCR surface radiation model

```
Σ(h)       = clamp(16.0 · exp(−h / 11100), 1.5, 38.0)   [g/cm²]
D_GCR(h)   = 155 + 245 · exp(−Σ(h) / 20.5)              [mSv/yr]
```

* Calibrated to MSL Curiosity Radiation Assessment Detector (RAD) surface measurements at Gale Crater ($h \approx -4500\text{ m}$, $\Sigma \approx 24\text{ g/cm}^2 \Rightarrow D_{\text{GCR}} \approx 231\text{ mSv/yr}$, matching Hassler et al., *Science* 343, 2014: $232 \pm 10\text{ mSv/yr}$).
* Because $D_{\text{GCR}}(h)$ is a monotonic function of elevation $h$ (already weighted in `S`), it is reported as an explicit diagnostic metric in the site inspector and Mission Brief rather than a separate weight slider, avoiding collinear double-counting.

## 10. Solar Particle Event (SPE) Acute Radiation & Regolith Shielding

```
D_unshielded(mSv) = 1850 · exp(−Σ(h) / 85.0)
D_shielded(mSv)   = D_unshielded · exp(−d_regolith / 0.24)
d_safe(m)         = 0.24 · ln(D_unshielded / 100)
```

* Severe Coronal Mass Ejection (CME) / SPE events deliver $1200\text{--}1850\text{ mSv}$ acute unshielded surface dose over 48 hours, causing acute radiation sickness.
* With Martian regolith density $\rho \approx 1.5\text{ g/cm}^3$ and nuclear attenuation length $\lambda \approx 36.0\text{ g/cm}^2$ (mean free path $\approx 0.24\text{ m}$), safe human survival below the NASA $100\text{ mSv}$ threshold requires **$2.0\text{ to } 2.4\text{ meters}$ of regolith sandbag/trench cover**, or deep volcanic lava tube shelter ($>3.5\text{ m}$ basalt ceiling yields $<0.5\text{ mSv}$).

## 11. Tactical Micro-Hazard Prediction (HiRISE 0.25 m/px Proxy)

```
P_boulder(%) = clamp(round(r / 250 · 55 + s / 15 · 45), 4, 95)
```

* Bridges the gap between regional 10.4 km MOLA reconnaissance and 100 m landing ellipse safety by predicting sub-cell boulder frequency ($>1\text{ m}$ block distribution) and terrain relief.
* Flags when active **Terrain Relative Navigation (TRN)** and hazard detection divert maneuvers are mandatory ($P_{\text{boulder}} \ge 20\%$) and provides direct 0.25 m/px deep-links into NASA HiRISE PDS orbital tiles.

## 12. Dual-Mode Hybrid Storage Architecture

* **Zero-CORS Client-Side Portability:** Bundles lightweight compressed base64 layer streams for instant offline `file:///` double-click execution without cross-origin security blocks.
* **On-Demand Raster Streaming:** Automatically falls back to direct streaming from plain `/layers/*.png` assets when hosted on Vercel, GitHub Pages, or local web servers (`npm start`), avoiding memory inflation.

## 12a. Validation

See [`docs/validation.md`](validation.md) (regenerate with `node tools/validate.js`): the nine successful Mars landers rank in the **89th percentile** of their latitude band under the Landing-safety preset (random = 50, p < 0.005), without the model knowing where they are. HLS-2015 Exploration Zones score only modestly above random under the Balanced preset (54 vs 48, not significant), which is expected because many were chosen for science next to rough terrain.

## 13. Known limitations & Operational Mitigations

1. 10 km/px cells cannot see individual boulders directly; mitigated by the integrated sub-cell micro-hazard proxy and automated HiRISE DTM links.
2. Slopes are computed at 2.3 km baselines (16-bit MOLA); slopes over shorter baselines (a lander footprint) are higher. Use the HiRISE/CTX link for ellipse-scale checks.
3. TES thermal inertia is a ~3 km binned product; dust abundance is informational only (28 % gaps).
4. SWIM coverage ends at ±60°.
5. The storm model has empirical optical-depth and dust-deposition constants; it is designed for comparing mission architectures, not for flight avionics sizing.

## Data honesty (Module IV)

Every externally fetched value carries one of four labels, shown in the UI next to the value:

| Label | Meaning |
|---|---|
| LIVE | fetched just now (NASA DONKI CME catalogue, last 30 days) |
| ARCHIVE | real measurement from an ended mission (InSight weather API; InSight ended 21 Dec 2022) |
| REFERENCE | published climatology, not a measurement of today (InSight seasonal ranges, Banfield et al. 2020) |
| OFFLINE | the request failed; nothing is shown |

No placeholder sol numbers, pressures or CME events are ever generated. DONKI catalogues heliospheric CMEs; whether one reaches Mars is not assessed. Unit tests assert both rules (`tests/scoring.test.js`, data-honesty block).

