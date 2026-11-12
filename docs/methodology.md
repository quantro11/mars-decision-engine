# Methodology

All numbers shown in the app can be traced to this document.

## 1. Grid

Simple cylindrical, 2048 × 1024 px, lon −180…180 °E, lat 90…−90. One pixel = 0.1758° ≈ 10.4 km at the equator.
Slope and roughness are computed on the 8192 × 4096 source grid (≈ 2.6 km/px) and then aggregated 4 × 4 into the output grid.

## 2. Layers

| Layer | Source | Processing |
|---|---|---|
| Elevation `h` (m) | MOLA MEGDR via NASA Mars Trek, 8-bit product, zoom 4 tiles | `h = −8200 + v/255 · 29430` (linear stretch of the MOLA range; checked: Jezero −2660 m vs published −2600 m, InSight −2660 vs −2600, Olympus Mons 20 076 vs 21 229) |
| Slope `s` (°) | derived | `atan(|∇h|)` with metre-per-pixel scaled by `cos(lat)`; output = 90th percentile of the 16 source pixels in each cell (a pessimistic, safety-oriented statistic) |
| Roughness `r` (m) | derived | standard deviation of the 16 source elevations in each cell |
| Ice `c` (−1…1) | SWIM 2.0 composite ice consistency (0–1 m, 1–5 m, > 5 m) | box-resampled from 7200 × 2400 (3 km/px); rows outside ±60° = no data |
| Latitude | — | row centre |

## 3. Suitability functions

`ramp(x, x0, x1)` = 1 for x ≤ x0, 0 for x ≥ x1, linear between.

| Criterion | f | Justification |
|---|---|---|
| Elevation | `ramp(h, −2000, 2000)` | Entry-descent-landing needs atmosphere: NASA HLS workshop requires ≤ +2 km; every successful Mars lander to date touched down below about −1 km |
| Slope | `ramp(s, 5, 15)` | ≤ 5° landing ellipse, ≤ 15° rover traverse (MER/MSL planning limits; Perseverance static tip-over ≈ 45°, operational ≈ 30°, planning ≤ 15–20°) |
| Ice | `(c + 1) / 2`, 0 if unknown | SWIM consistency: +1 = all datasets agree ice is present |
| Roughness | `ramp(r, 30, 250)` | elevation σ inside a 10 km cell: < 30 m plains, > 250 m heavily cratered / mountainous |
| Thermal inertia | `<= 0.3*I/100` below 100; rises to 1 at 150; 1 for 150-400; `ramp(I, 400, 700)` above; 0.5 if no data | I < 100: thick fine dust - low bearing strength, panel dust loading, EDL radar ambiguity (MER site-selection rule: I > 100-150). 150-400: sand / duricrust, diggable. > 500: rock / bedrock - hazard, hard to excavate |
| Radiation | `ramp(D(h), 200, 290)` mSv/yr, see §3a | Lower ground = thicker atmospheric shield against galactic cosmic rays |
| Latitude | `(cos φ − cos 50°) / (1 − cos 50°)`, clipped to 0…1 | mean annual insolation ∝ cos φ; NASA HLS limit ±50° (thermal + solar) |

## 3a. Radiation (GCR dose) model

```
σ(h) = 16.4 g/cm² · exp(−h / 11.1 km)            atmospheric column (610 Pa datum, g = 3.71 m/s², H = 11.1 km)
D(h) = 0.64 mSv/day · exp(−(σ − 24.6) / 60) · 365.25   dose equivalent per Earth year
```

* Anchor: MSL/RAD at Gale crater, 0.64 ± 0.12 mSv/day (Hassler et al. 2014, *Science* 343) at ≈ −4.4 km (σ ≈ 24.6 g/cm²).
* The 60 g/cm² attenuation length is an empirical fit: secondary-particle build-up makes shielding much weaker than the column mass suggests.
* Range on Mars: ≈ 200 mSv/yr (Hellas floor) → ≈ 280 mSv/yr (+2 km) → ≈ 335 mSv/yr (Olympus Mons summit). A 1 Sv career limit is reached in ≈ 4–5 years at the best sites.
* Honest caveat: the layer is derived from elevation, so it is correlated with the elevation criterion. It is a separate criterion because it answers a different question (crew health vs. EDL), and its default weight is small (5 %). Solar particle events, regolith shielding and local horizon masking are not modelled.

## 4. Aggregation

`S = Σ wᵢ fᵢ`, weights normalised to Σ w = 1.
Hard constraints (toggle): `h > +2000 m`, `s > 15°`, `|φ| > 50°` ⇒ `S = 0`.

Presets (elev / slope / ice / rough / lat / thermal inertia / radiation):

* Landing safety 0.25 / 0.25 / 0.05 / 0.15 / 0.10 / 0.15 / 0.05
* ISRU / sustainability 0.10 / 0.15 / 0.40 / 0.10 / 0.10 / 0.10 / 0.05
* Balanced crewed mission 0.15 / 0.20 / 0.25 / 0.10 / 0.10 / 0.15 / 0.05

## 5. Candidate extraction

Mean score per 2° × 2° block (11 × 11 px); greedy non-maximum suppression with 800 km minimum separation; the five best blocks are named after the nearest entry of a 46-region gazetteer (within 6°; otherwise "unnamed terrain near …"). Cards show block means.

## 5a. Weight sensitivity (robustness test)

Monte Carlo: 30 runs, each weight multiplied by an independent uniform factor in `[1 − u, 1 + u]` (u = 20 % default, user-set 5–50 %),
full map re-scored, top-5 re-extracted. A candidate "survives" a run if a new top-5 block lies within 400 km of it.
The card shows the survival fraction (ROBUST %). Seeded RNG (mulberry32, seed 2026) so the result is reproducible on stage.

Each candidate card also links to NASA Mars Trek at the candidate's coordinates, for inspecting HiRISE / CTX imagery at landing-ellipse scale.

## 6. Route planner

A* on the slope grid, 8-connected, longitude wrapping, search window = bounding box ± 160 px.
Edge cost `d · (1 + k · s_target)`, `k` = 0.3 default; `s > s_max` (15° default) is impassable.
Heuristic = haversine distance (admissible, Mars radius 3389.5 km).
Reported: distance, max / mean slope, km on > 10° terrain, travel time at a user-set speed (default 20 km/sol — Perseverance's best single-sol drives are ≈ 350 m, so 20 km/sol represents a crewed pressurised rover, not today's robots), elevation profile.

## 7. Dust-storm energy model

```
E_solar(kWh/sol) = A · η · 3.0 · G(φ, Ls) · exp(−0.35 (τ − 0.5))
E_nuclear        = n_Kilopower · 10 kW · 24.66 h
battery(t+1)     = clamp(battery(t) + E_solar + E_nuclear − consumption, 0, capacity)
```

* `G(φ, Ls) = Q_TOA(φ, Ls) / mean_Ls Q_TOA(0, Ls)`, the seasonal daily-mean top-of-atmosphere insolation relative to the
  equatorial mean: `Q = S0/π · (a/r)² · (h0 sin φ sin δ + cos φ cos δ sin h0)`, `sin δ = sin 25.19° · sin Ls`,
  `a/r = (1 + 0.0934 cos(Ls − 251°)) / (1 − 0.0934²)`, S0 = 586 W/m². Polar night gives 0. Ls advances 360/668.6 ° per sol from the
  user-set onset Ls (default 190°, close to the 2018 storm onset). Unticking "Seasonal" falls back to the annual-mean `cos φ`.
* 3.0 kWh/m²/sol: clear-sky equatorial daily insolation (Appelbaum & Flood, *Solar radiation on Mars*, NASA TM-102299, 1989 — order of magnitude).
* `exp(−0.35 (τ − 0.5))` is an **empirical** attenuation normalised to a typical clear sky (τ = 0.5) and fitted so that τ ≈ 10.8 yields ≈ 3 % of clear-sky output, matching Opportunity's drop from ≈ 650 to ≈ 22 Wh/sol in June 2018. It is intentionally simpler than a radiative-transfer model; diffuse light is why the decay is slower than Beer-Lambert.
* Storm timeline default: onset sol 20, 10-sol rise, 40-sol plateau, 30-sol decay (the 2018 storm lasted ≈ 100 sols at Opportunity's site).
* Kilopower: 10 kWe fission unit (NASA KRUSTY test 2018).

## 8. Known limitations

1. 10 km/px cells cannot see boulders, small craters, dunes or scarps — output is a region ranking, not a landing ellipse.
2. 8-bit elevation (≈ 115 m steps) makes slopes regional; local slopes are higher.
3. TES thermal inertia is a ~3 km binned product; dust abundance is informational only (28 % gaps).
4. Radiation is a one-anchor elevation model (MSL/RAD); no solar particle events, no regolith-shielding design.
5. Seasonal insolation is modelled (daily mean); no diurnal profile, thermal cycling, panel tilt or dust-devil cleaning.
6. SWIM coverage ends at ±60°.
7. The storm model has one empirical constant; it is for comparing sites and power architectures, not for sizing flight hardware.
