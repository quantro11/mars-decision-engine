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
| Radiation (GCR) | `ramp(D_GCR(h), 200, 290)` | annual surface cosmic-ray dose from atmospheric column shielding (1 at ≤ 200 mSv/yr on Hellas floor → 0 at ≥ 290 mSv/yr above +2 km) |

## 4. Aggregation

Two modes (UI toggle "No compensation"):

* **Weighted sum** (default): `S = Σ wᵢ fᵢ`, weights normalised to Σ w = 1. Criteria compensate each other.
* **Weighted geometric mean**: `S = Π fᵢ^wᵢ` (each `fᵢ` floored at 0.01). One near-zero criterion pulls the whole score down,
  so for example abundant ice cannot buy back an unsafe slope. Recommended when checking whether a candidate is acceptable on *every* axis.

Hard constraints (toggle): `h > +2000 m`, `s > 15°`, `|φ| > 50°` ⇒ `S = 0`.
The 15° veto is the traverse limit; the 5° landing limit is reported per candidate (share of cells ≤ 5°, §5).

Presets (elev / slope / ice / rough / lat / thermal inertia / radiation):

* Landing safety 0.25 / 0.25 / 0.05 / 0.15 / 0.10 / 0.15 / 0.05
* ISRU / sustainability 0.10 / 0.15 / 0.40 / 0.10 / 0.10 / 0.10 / 0.05
* Balanced crewed mission 0.15 / 0.20 / 0.25 / 0.10 / 0.10 / 0.15 / 0.05

Radiation is derived from elevation (§9), so "low ground" is rewarded twice for different reasons (EDL margin and crew dose); its weight is kept at 5 %.

## 5. Candidate extraction & Monte Carlo sensitivity

Mean score per 2° × 2° block (11 × 11 px). A block is only eligible if **≥ 75 % of its cells pass the hard constraints**, so a high mean cannot hide vetoed ground.
Greedy non-maximum suppression with 800 km minimum separation; the five best blocks are named after the nearest entry of a 46-region gazetteer.
Each card shows the block mean, the **share of cells whose 90th-percentile slope is ≤ 5°** (the landing limit), and the ice-access class (§8).

For robustness testing (`sensitivity`), every weight is perturbed independently by a uniform factor in `[1 − spread, 1 + spread]` (default ±20%) across 30 deterministic PRNG runs (`mulberry32`), reporting the fraction of runs where each Top-5 candidate remains in the Top-5 (within 400 km).

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

## 7. Dust-storm, habitat heating & energy model

```
E_solar(kWh/sol) = A · η · 3.0 · S_season(φ, Ls) · exp(−0.35 (τ − 0.5)) · dust(t)
E_nuclear        = n · 10 kW · 24.66 h
loss(kWh/sol)    = UA · max(0, 20 °C − T_mean(φ, Ls)) · 24.66 h        UA = 0.09 kW/K (assumption)
heater           = max(0, loss − consumption)                         electrical load is dissipated as heat inside
battery(t+1)     = clamp(battery(t) + E_solar + E_nuclear − consumption − heater, 0, capacity)
```

* 3.0 kWh/m²/sol: clear-sky equatorial daily insolation (Appelbaum & Flood, NASA TM-102299, 1989).
* `S_season(φ, Ls)`: daily-mean top-of-atmosphere insolation with obliquity 25.19° and eccentricity 0.0934 (perihelion Ls 251°), normalised to the equatorial annual mean; reduces to `cos φ` when Ls is omitted.
* `exp(−0.35 (τ − 0.5))`: empirical, fitted so τ ≈ 10.8 gives ≈ 3 % of clear-sky output (Opportunity, June 2018: ≈ 650 → ≈ 22 Wh/sol).
* **Panel dust:** output decreases by 0.28 %/sol (order of the MER Opportunity average) and 3× that while τ is elevated, floor 35 %. Wind cleaning events are **not** modelled (conservative); a "dust cleaning" option keeps panels clean.
* **Heating:** the heat loss is charged to the energy budget only beyond what the electrical load already dissipates. When generation plus battery cannot cover the loss, the interior relaxes toward the ambient mean in proportion to the heat deficit (1.5-sol time constant) and recovers the same way. "Below 0 °C" is reported.
* `T_mean(φ, Ls)` is a rough empirical approximation (equatorial diurnal mean ≈ −50 °C, colder with latitude, seasonal terms), not a climate model.
* **Fission power:** 10 kWe is the *design target* of NASA's Kilopower / Fission Surface Power concept. The 2018 KRUSTY ground test demonstrated a ~1 kWe prototype; 10 kWe units have not flown.

## 8. Ice access (replaces an earlier "ISRU yield" estimate)

SWIM 2.0 *consistency* (−1…1) expresses how strongly five independent datasets agree that ice is present (Morgan et al. 2021, *Nature Astronomy* 5).
It does **not** measure ice concentration, purity or extractable yield, so the engine does not convert it into litres per sol.

* Classes (our thresholds): consistency ≥ 0.5 → *likely*, ≥ 0 → *possible*, < 0 → *unlikely*, outside ±60° → *no data*; reported for the selected depth band.
* Excavation figure, shown with its assumption: **if** the ground were ice-cemented regolith at 10 wt % water, 10 L/sol of crew make-up water needs ≈ 100 kg of regolith per sol. Both numbers are assumptions, not data.

## 9. Atmospheric column & GCR surface radiation model

```
Σ(h)       = 16.4 · exp(−h / 11100)                     [g/cm²]
D_GCR(h)   = 0.64 · exp(−(Σ(h) − 24.6) / 60) · 365.25   [mSv/yr]
```

* Calibrated to MSL Curiosity Radiation Assessment Detector (RAD) surface measurements at Gale Crater ($h \approx -4400\text{ m}$, $\Sigma \approx 24.4\text{ g/cm}^2 \Rightarrow 0.64\text{ mSv/day} \approx 234\text{ mSv/yr}$, matching Hassler et al., *Science* 343, 2014: $0.64 \pm 0.12\text{ mSv/day}$).
* Because surface cosmic-ray protection answers a distinct crew life-support question beyond atmospheric EDL braking, `rad` is exposed both as a suitability criterion slider (0.05 preset weight), a dedicated global map layer (`Radiation`), and explicit column/dose telemetry in the site inspector and Mission Brief.

## 10. Solar particle event (SPE) shielding — design-basis assumption

One attenuation law is used for every shield (atmosphere, regolith, basalt):

```
D(σ) = D_ref · exp(−(σ − σ_ref) / λ)      D_ref = 1000 mSv at σ_ref = 5 g/cm²,  λ = 15 g/cm²
σ = atmospheric column (§9) + regolith depth · 1.5 g/cm³ (+ basalt 2.9 g/cm³ for a lava-tube ceiling)
```

* `D_ref` represents an **assumed** August-1972-class event behind thin spacecraft shielding; it is a planning scenario, not a forecast.
  For scale, the largest SPE measured on the Martian surface so far (September 2017, MSL/RAD) added only ≈ 0.4 mGy (Guo et al. 2018, *GRL* 45).
* `λ = 15 g/cm²` reflects the soft proton spectrum of SPEs (GCR, by contrast, needs ≈ 60 g/cm², §9).
* Outputs: surface dose with the local atmosphere, dose under the selected regolith cover, and the depth that brings it to ≤ 100 mSv.

## 11. Regional terrain class (replaces an earlier "boulder risk %")

MOLA at 2.3 km cannot resolve boulders or small craters, and no rock-abundance data is used, so the engine gives only a regional relief class
from the same slope / roughness values used in scoring: *smooth* (90th-pct slope ≤ 5° and σ ≤ 30 m), *moderate* (≤ 10°, ≤ 100 m), otherwise *rugged*.
Certifying a landing ellipse always requires HiRISE / CTX imagery; every candidate links to NASA Mars Trek for that.

## 12. Layer loading

* Over http(s) (GitHub Pages, Vercel, `npm start`) the app fetches the PNG layers in `web/layers/` directly: parallel, cacheable, and about 4× smaller than base64.
* Opened from `file://`, browsers taint canvases drawn from local files, so the app loads the inline base64 bundle `layers_data.js` instead.

## 12a. Validation

See [`docs/validation.md`](validation.md) (regenerate with `node tools/validate.js`).

* The nine successful Mars landers rank in the **89th percentile** of their latitude band under the Landing-safety preset (random = 50, p < 0.005).
  **Caveat:** this is partly circular — those sites were themselves selected using MOLA slope and elevation, so agreement shows the score
  reproduces engineering practice, not that it predicts anything new.
* The more independent test — NASA HLS-2015 Exploration Zones under the Balanced preset — is **not significant** (54 vs 48), which is expected
  because many zones were proposed for science next to rough terrain. There is no ground truth for "best human base site".

## 13. Known limitations & Operational Mitigations

1. 10 km/px cells cannot see boulders or small craters; the engine only reports a regional terrain class and links each candidate to HiRISE/CTX in NASA Mars Trek.
2. Slopes are computed at 2.3 km baselines (16-bit MOLA); slopes over shorter baselines (a lander footprint) are higher. Use the HiRISE/CTX link for ellipse-scale checks.
3. TES thermal inertia is a ~3 km binned product; dust abundance is informational only (28 % gaps).
4. SWIM coverage ends at ±60°.
5. The storm model has empirical optical-depth and dust-deposition constants; habitat heat loss (UA) and surface temperature are rough approximations. It compares architectures; it does not size hardware.
6. Ice access, SPE dose and excavation mass rest on stated assumptions (10 wt % ice, design-basis SPE); change the assumption and the number changes.

## Data honesty (Module IV)

Every externally fetched value carries one of four labels, shown in the UI next to the value:

| Label | Meaning |
|---|---|
| LIVE | fetched just now (NASA DONKI CME catalogue, last 30 days) |
| ARCHIVE | real measurement from an ended mission (InSight weather API; InSight ended 21 Dec 2022) |
| REFERENCE | published climatology, not a measurement of today (InSight seasonal ranges, Banfield et al. 2020) |
| OFFLINE | the request failed; nothing is shown |

No placeholder sol numbers, pressures or CME events are ever generated. DONKI catalogues heliospheric CMEs; whether one reaches Mars is not assessed. Unit tests assert both rules (`tests/scoring.test.js`, data-honesty block).

