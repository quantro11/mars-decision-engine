# Methodology

All numbers shown in the app can be traced to this document.

## 1. Grid

Simple cylindrical, 2048 × 1024 px, lon −180…180 °E, lat 90…−90 (IAU-2000 volumetric mean radius $R = 3389.5\text{ km}$). One pixel = 0.1758° ≈ 10.4 km at the equator.
Slope and roughness are computed on the 8192 × 4096 source grid (≈ 2.6 km/px) and then aggregated 4 × 4 into the output grid.

## 2. Layers

| Layer | Source | Processing |
|---|---|---|
| Elevation `h` (m) | MOLA MEGDR via NASA Mars Trek, 8-bit product, zoom 4 tiles | `h = −8200 + v/255 · 29430` (linear stretch of the MOLA range; checked: Jezero −2660 m vs published −2600 m, InSight −2660 vs −2600, Olympus Mons 20 076 vs 21 229) |
| Slope `s` (°) | derived | `atan(|∇h|)` with metre-per-pixel scaled by `cos(lat)`; output = 90th percentile of the 16 source pixels in each cell (a pessimistic, safety-oriented statistic) |
| Roughness `r` (m) | derived | standard deviation of the 16 source elevations in each cell |
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

## 6. Multi-hazard route planner (A*)

A* on the 2048 × 1024 grid, 8-connected, longitude wrapping, search window = bounding box ± 160 px.
Edge cost integrates slope, sub-cell roughness ($r > 50\text{ m}$), and TES low-TI fine-dust sinkage ($I < 100\text{ tiu}$, e.g. Spirit-like dust traps):

```
cost(a → b) = d · [ 1 + k · (s_b + max(0, (r_b − 50)/50) + 6 · max(0, 1 − I_b/100)) ]
```

where `k` = 0.3 default, and `s_b > s_max` (15° default) is strictly impassable.
Heuristic = haversine distance (admissible, Mars radius 3389.5 km).
Reported: distance, max / mean slope, km on > 10° terrain, km across low-TI dust (< 100 tiu), mean sub-cell roughness (σ), travel time at user-set speed (default 20 km/sol — representing a crewed pressurised rover), and elevation profile.

## 7. Dust-storm & seasonal energy model

```
E_solar(kWh/sol) = A · η · 3.0 · S_season(φ, Ls) · exp(−0.35 (τ − 0.5))
E_nuclear        = n_Kilopower · 10 kW · 24.66 h
battery(t+1)     = clamp(battery(t) + E_solar + E_nuclear − consumption, 0, capacity)
```

* 3.0 kWh/m²/sol: clear-sky equatorial daily insolation (Appelbaum & Flood, *Solar radiation on Mars*, NASA TM-102299, 1989 — order of magnitude).
* `S_season(φ, Ls)` models Mars's axial obliquity ($\varepsilon = 25.19^\circ$, solar declination $\sin\delta = \sin\varepsilon\sin L_s$) and orbital eccentricity ($e = 0.0934$, perihelion at $L_s = 251^\circ$) via the diurnal insolation integral. When $L_s$ is omitted, it reduces to $\cos\phi$.
* `exp(−0.35 (τ − 0.5))` is an **empirical** attenuation normalised to a typical clear sky (τ = 0.5) and fitted so that τ ≈ 10.8 yields ≈ 3 % of clear-sky output, matching Opportunity's drop from ≈ 650 to ≈ 22 Wh/sol in June 2018.
* Storm timeline default: onset sol 20, 10-sol rise, 40-sol plateau, 30-sol decay (the 2018 storm lasted ≈ 100 sols at Opportunity's site).
* Kilopower: 10 kWe fission unit (NASA KRUSTY test 2018).

## 8. Atmospheric column & GCR surface radiation model

```
Σ(h)       = clamp(16.0 · exp(−h / 11100), 1.5, 38.0)   [g/cm²]
D_GCR(h)   = 155 + 245 · exp(−Σ(h) / 20.5)              [mSv/yr]
```

* Calibrated to MSL Curiosity Radiation Assessment Detector (RAD) surface measurements at Gale Crater ($h \approx -4500\text{ m}$, $\Sigma \approx 24\text{ g/cm}^2 \Rightarrow D_{\text{GCR}} \approx 231\text{ mSv/yr}$, matching Hassler et al., *Science* 343, 2014: $232 \pm 10\text{ mSv/yr}$).
* Because $D_{\text{GCR}}(h)$ is a monotonic function of elevation $h$ (already weighted in `S`), it is reported as an explicit diagnostic metric in the site inspector and Mission Brief rather than a separate weight slider, avoiding collinear double-counting.

## 9. Known limitations

1. 10 km/px cells cannot see individual boulders, small craters, dunes or scarps — output is a regional reconnaissance ranking, not a 100 m landing ellipse.
2. 8-bit elevation (≈ 115 m steps) makes slopes regional; local slopes are higher.
3. TES thermal inertia is a ~3 km binned product; dust abundance is informational only (28 % gaps).
4. SWIM coverage ends at ±60°.
5. The storm model has one empirical optical-depth constant; it is for comparing sites and power architectures, not for sizing flight hardware.
