# Methodology

All numbers shown in the app can be traced to this document.

## 1. Grid

Simple cylindrical, 4096 × 2048 px, lon −180…180 °E, lat 90…−90 (IAU-2000 volumetric mean radius $R = 3389.5\text{ km}$). One pixel = 0.0879° ≈ 5.2 km at the equator.
Elevation, slope and roughness come from the **16-bit** MOLA MEGDR mosaic (1 m vertical resolution), sampled to 9216 × 4608 (≈ 2.3 km/px) and aggregated into the output grid (each output cell = 2.25 × 2.25 source px, evaluated as 81 equally weighted samples).

## 2. Layers

| Layer | Source | Processing |
|---|---|---|
| Elevation `h` (m) | USGS `Mars_MGS_MOLA_DEM_mosaic_global_463m` (int16 metres), every 5th row/column read by HTTP range requests (`download_mola16.py`) | cell mean; checked against published landing-site elevations: Curiosity −4500 vs −4501 m, Opportunity −1384 vs −1385, Spirit −1943 vs −1935, Viking 1 −3637 vs −3627. Stored in the browser as 8-bit (≈ 115 m/level) for scoring, which only needs ±2 km resolution |
| Slope `s` (°) | derived | `atan(|∇h|)` with metre-per-pixel scaled by `cos(lat)`; computed on the 16-bit 2.3 km grid; output = 90th percentile of the 81 samples in each cell (a pessimistic, safety-oriented statistic) |
| Roughness `r` (m) | derived | standard deviation of the 81 16-bit elevation samples in each cell |
| Ice `c` (−1…1) | SWIM 2.0 composite ice consistency (0–1 m, 1–5 m, > 5 m) | box-resampled from 7200 × 2400 (3 km/px); rows outside ±60° = no data |
| Thermal inertia `I` (tiu) | MGS TES (Christensen et al.; Putzig/Mellon) via ASU JMARS WMS | 2048 × 1024 numeric VICAR (`J m⁻² K⁻¹ s⁻½`), upsampled 2× to the 4096 grid (effective ≈ 10 km) |
| Dust abundance `d` (0…1) | MGS TES surface dust fraction (Bandfield 2002) via ASU JMARS WMS | 2048 × 1024 numeric VICAR, upsampled 2× (effective ≈ 10 km) |
| Optical basemap | NASA Viking Orbiter MDIM 2.1 global mosaic | 4096 × 2048 colour mosaic + MOLA directional hillshade |
| Latitude | — | row centre |

## 3. Suitability functions

`ramp(x, x0, x1)` = 1 for x ≤ x0, 0 for x ≥ x1, linear between.

| Criterion | f | Justification |
|---|---|---|
| Elevation | `ramp(h, −2000, 2000)` | Entry-descent-landing needs atmosphere: NASA HLS workshop requires ≤ +2 km; every successful lander sat below −1 km except Viking 2 (−4.5 km lower still) |
| Slope | `ramp(s, 5, 15)` | ≤ 5° landing ellipse; 15° is this model's operational planning boundary (scaled down automatically for loose dust `TI < 100` via `SCORING.effectiveSlopeLimit`), not a universal astronaut suit limit |
| Ice | `(c + 1) / 2`, 0 if unknown | SWIM 2.0 consistency index (−1…+1): probabilistic agreement metric, NOT a direct ice-core concentration measurement; outside ±60° is explicitly flagged `NO_DATA` (distinct from ice-free `UNLIKELY`) |
| Roughness | `ramp(r, 30, 250)` | elevation σ inside a ~5 km global cell: < 30 m plains, > 250 m heavily cratered / mountainous (cannot resolve sub-hectometer rocks; requires HiRISE 1–2 m/post for EVA) |
| Thermal inertia | `<= 0.3*I/100` below 100; rises to 1 at 150; 1 for 150-400; `ramp(I, 400, 700)` above; 0.5 if no data | Thermophysical particle-size and induration indicator ($\sqrt{k\rho c}$), NOT mechanical bearing capacity: `I < 100` indicates loose fine dust / saltation risk & radar scatter ambiguity; `150–400` indicates sand/duricrust; `> 500` indicates exposed rock/bedrock |
| Latitude | `(cos φ − cos 50°) / (1 − cos 50°)`, clipped to 0…1 | mean annual insolation ∝ cos φ; NASA HLS reference human limit ±50° |
| Radiation (GCR) | `ramp(D_GCR(h), 200, 290)` | annual surface cosmic-ray dose from atmospheric column shielding calibrated to Curiosity RAD at Gale Crater (`0.64 mSv/day`) with a **±18.8% (±44 mSv/yr)** global extrapolation uncertainty band (`SCORING.radDoseBand`) |

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

Mean score per 2° × 2° block (23 × 23 px). A block is only eligible if **≥ 75 % of its cells pass the hard constraints**, so a high mean cannot hide vetoed ground.
Greedy non-maximum suppression with 800 km minimum separation; the five best blocks are named after the nearest entry of a 46-region gazetteer.
Each card shows the block mean, the **share of cells whose 90th-percentile slope is ≤ 5°** (the landing limit), and the ice-access class (§8).

For robustness testing (`sensitivity`), every weight is perturbed independently by a uniform factor in `[1 − spread, 1 + spread]` (default ±20%) across **100 deterministic PRNG runs** (`mulberry32`), reporting the retention fraction together with **95% Wilson binomial confidence intervals** (`wilson95CI`) and rank standard deviation.

## 6. Multi-hazard route planner (A*) & mode-separated rest stops

A* on the 4096 × 2048 grid, 8-connected, longitude wrapping, search window = bounding box ± 320 px (≈ 28°, scales with grid width); expansion budget 6 × 10⁶ cells.
Note on spatial scale: global A* runs on the ~5 km/px MOLA grid and cannot resolve sub-hectometer boulders or craters — foot EVA routing must transition to Module III's local HiRISE 1.0–2.0 m/post terrain model.
Edge cost integrates slope, anisotropic directional grade ($\Delta z / \Delta s$: uphill climb traction penalty, steep downhill braking $>10\%$, and cross-slope lateral roll), sub-cell roughness ($r > 50\text{ m}$), and TES low-TI fine-dust sinkage ($I < 100\text{ tiu}$, e.g. Spirit-like Troy dust traps):

```
cost(a → b) = d · [ 1 + k · (s_b + P_grade(Δz/Δs, s_b) + max(0, (r_b − 50)/25) + 80 · max(0, 1 − I_b/100)) ]
```

where `k` = 0.3 default, and `s_b > s_max` (15° operational model planning limit, adjusted for soil class) is strictly impassable.
Heuristic = haversine distance (admissible, Mars radius 3389.5 km); direct comparison chord follows spherical great-circle `slerp` geodesics.
Reported: distance, elevation profile, total ascent/descent (`totalAscentM` / `totalDescentM`), max/mean slope, detected hazard zones (`hazardZones`), return route corridor (`returnRoute`), max uphill grade, mean cross-slope, km on > 10° terrain, km across low-TI dust (< 100 tiu), mean sub-cell roughness (σ), and mode-specific transit duration:

* **Pressurized Rover Mode (default 20 km/sol):** computes sol duration and places terrain rest stops (`requiresRover: true`) spaced ≥ 200 km apart on flat (`≤ 4°`), smooth (`σ ≤ 35 m`), firm (`TI ≥ 160 tiu`) ground (terrain statement only; no shelter implied).
* **Astronaut Foot EVA / Marswalk Mode (2.4 km/h nominal):** completely decouples calculations from 20 km/sol rover speeds and **disables** 200 km rover rest stops, replacing them with ~1.5 km EVA micro-rest checkpoints, mandatory 50% sortie turnaround bounds, $\text{CO}_2$ RCA scrubber saturation tracking, and a protected ≥25% return reserve.

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
* `T_mean(φ, Ls, I, h, τ)` comes from radiative balance with the same insolation model: `T = ((1 − A)·Q_eff / (ε σ))^¼`, A = 0.25 (TES global bolometric albedo), ε = 0.95, `Q_eff = ½ Q(φ, Ls) + ½ Q̄(φ)` (the annual-mean half stands in for seasonal thermal lag), floor 148 K (CO₂ frost), coupled to local MGS TES thermal inertia `I` (damping diurnal amplitude over bedrock vs. loose dust), MOLA elevation `h` (atmospheric IR greenhouse offset), and dust-storm optical depth `τ` (which cools daytime peaks via solar extinction while warming nocturnal lows by up to +16 K via suspended-dust thermal IR back-radiation, matching Viking/Curiosity REMS observations). Habitat UA = 0.09 kW/K is a design parameter, not a property of Mars.
* **Fission power:** 10 kWe is the *design target* of NASA's Kilopower / Fission Surface Power concept. The 2018 KRUSTY ground test demonstrated a ~1 kWe prototype; 10 kWe units have not flown.

## 8. Ice access (replaces an earlier "ISRU yield" estimate)

SWIM 2.0 *consistency* (−1…1) expresses how strongly five independent datasets agree that ice is present (Morgan et al. 2021, *Nature Astronomy* 5).
It does **not** measure ice concentration, purity or extractable yield, so the engine does not convert it into litres per sol.

* Classes (our thresholds): consistency ≥ 0.5 → *likely*, ≥ 0 → *possible*, < 0 → *unlikely*, outside ±60° → *no data*; reported for the selected depth band.
* Excavation figure, shown with its assumption: **if** the ground were ice-cemented regolith at 10 wt % water, 10 L/sol of crew make-up water needs ≈ 100 kg of regolith per sol. Both numbers are assumptions, not data.

## 8a. Shelter access (cave candidates)

Distance from every cell to the nearest of the 1062 entries of the **Mars Global Cave Candidate Catalog v1** (MGC³, Cushing 2017, USGS Astrogeology / PDS):
skylights, atypical pit craters, lava-tube and trough-end pits found in THEMIS / CTX / HiRISE images. `f = ramp(d, 50 km, 500 km)`.
Candidates are **unconfirmed**; most lie on the Tharsis volcanoes, so they rarely coincide with low, icy, landable ground (2.4 % of cells are within 100 km).
The criterion therefore has **weight 0 in every preset**; users can raise it to explore shelter-first architectures. Built by `data_pipeline/caves.py`.

## 9. Atmospheric column & GCR surface radiation model

```
Σ(h, Ls)      = 16.4 · f_CO2(Ls) · exp(−h / 11100)                            [g/cm²]
Ω(θ)          = max(0.75, cos²(θ / 2) − 0.002 · θ_deg)                        [topographic sky-view factor]
D_GCR(h,θ,Ls) = 0.64 · exp(−(Σ(h, Ls) − 24.6) / 60) · 365.25 · Ω(θ)           [mSv/yr]
```

* Calibrated to MSL Curiosity Radiation Assessment Detector (RAD) surface measurements at Gale Crater ($h \approx -4400\text{ m}$, $\Sigma \approx 24.4\text{ g/cm}^2 \Rightarrow 0.64\text{ mSv/day} \approx 234\text{ mSv/yr}$, matching Hassler et al., *Science* 343, 2014: $0.64 \pm 0.12\text{ mSv/day}$), with local horizon sky-view geometric shielding $\Omega(\theta)$ and the Viking/MSL REMS two-harmonic seasonal $\text{CO}_2$ polar cap condensation/sublimation cycle $f_{\text{CO}_2}(L_s)$ ($\pm 12\%$ global pressure modulation).
* Because surface cosmic-ray protection answers a distinct crew life-support question beyond atmospheric EDL braking, `rad` is exposed both as a suitability criterion slider (0.05 preset weight), a dedicated global map layer (`Radiation`), and explicit column/dose telemetry in the site inspector, traverse planner, and Mission Brief.

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

See [`docs/validation.md`](validation.md) (regenerate with `node tools/validate.js`; runs in CI).

* **Test 1 — landers (orbital suitability sanity check):** the nine successful landers rank in the **90th percentile** of their latitude band under Landing safety (random = 50, p < 0.005).
  Partly circular: those sites were chosen with MOLA slope / elevation, and orbital site suitability **does not** prove astronaut EVA path safety.
* **Test 2 — NASA HLS-2015 candidate sites (all 39 USGS-mosaicked sites):** **71st percentile** under Balanced (random = 49, p < 0.005).
* **Test 3 — Independent EVA Multi-Biome & PLSS Benchmark (4 biomes + Bioenergetics):** verifies 1 m/px A* obstacle avoidance, dynamic hazard rerouting, slope enforcement, $\text{CO}_2$ RCA saturation, and ≥25% return reserve protection independently across Jezero Delta, Gale Boxwork, Nili Fossae, and Arcadia Planitia.

## 13. Known limitations, Provenance & Operational Mitigations

1. Global 5 km/px cells (TES ≈ 10 km) cannot see boulders or small craters; HiRISE stereo DTM metadata (`DTEEC_*`, SOCET SET, `1.0–2.0 m/post`, <3% planetary coverage) is required for human EVA verification. Every layer's dataset code, CRS (`IAU_Mars_2000`), resolution, and epoch is exported in `SCORING.LAYER_PROVENANCE` and the Mission Brief.
2. MGC³ caves are **unconfirmed** orbital thermal/optical anomalies (Cushing et al. 2015) rather than verified shelter caverns.
3. SWIM coverage ends at ±60°; outside ±60° is strictly reported as `NO_DATA` rather than `UNLIKELY`.
6. The storm model has empirical optical-depth and dust-deposition constants; habitat heat loss (UA) and surface temperature are approximations.

## Data honesty

The live weather / space-weather tab (NASA InSight, DONKI, REMS/MEDA) was removed to keep one clear flow. The only
optional network query left is the JMARS WMS proxy in Tactical EVA (off by default); with it off, every number comes from
the bundled layers and pre-cuts. Values that are assumptions rather than data are marked `verified: false` with a source
note in `web/vehicles.json` and `web/tactical_config.json`.

## 14. Tactical EVA (16 km²) and the suit energy model

**Tactical EVA grid.** For 9 sites (Jezero delta, Gale, Nili Fossae, Arcadia, and the five default Top-5 candidates) the
app ships pre-cut **4 km × 4 km boxes at 100 m/cell (40 × 40)** taken from the MOLA-HRSC blended DEM (200 m) and the
THEMIS day-IR mosaic (100 m), plus SIM 3292 geologic units (`tools/precut_16km2.mjs`, `data_pipeline/fetch_eva_cutouts.py`).
Each cell is scored across eight domains (topography, elevation/slope, thermal, radiation, dust, optics, geology, power) with the HLS-2015 veto rules; user field
measurements are blended into nearby cells within a configurable radius (`web/tactical_eva_engine.js`). Live JMARS WMS
queries are optional and off by default. Sub-100 m hazards (boulders, small craters) are still invisible at this scale —
certifying a traverse needs HiRISE stereo terrain models.

**Suit energy model** (`SCORING.calcPandolfMars`, Pandolf form scaled to local gravity):

```
P_met = 1.5 · m_body · g/g₀ + W_load + η_terrain · M_eff · (1.5 v² + 0.35 v G) + P_suit
M_eff = (m_body + m_suit + m_load) · g/g₀
```

with $m_{\text{body}} = 80$ kg, $m_{\text{suit}} = 82$ kg and $\eta_{\text{terrain}} = 1.32 + 0.85 f_{\text{sand}}$.
$P_{\text{suit}}$ (pressurised-suit overhead) is the one free constant: it is set to **170 W** so that a lunar-gravity walk
reproduces the Apollo 14–17 lunar EVA mean of 234 kcal/h ≈ 272 W (per-EVA range 822–1267 kJ/h ≈ 228–352 W; Waligora et al.
1975, NASA TN D-7883). Mars values are extrapolations — no one has walked on Mars. Consumables (850 g O₂, 960 Wh battery,
4.2 L cooling water, CO₂ scrubber) are assumed reference budgets with a ≥ 25 % return reserve and an 8 h EVA limit.

## 15. Dust-lifting / dust-devil risk index (heuristic, not validated)

`STORM.predictDustML` returns a **0–100 risk index** for four look-ahead horizons (+1 min, +6 min, +15 min, +1–3 sol). It
is a set of **hand-written rules** on physically motivated features; the thresholds were set by hand, never fitted to data,
and **no accuracy, ROC-AUC or Brier score is claimed**. The function name is historical.

Features (`STORM.extractDustMLFeatures`):

* **Bagnold saltation ratio** $u_*/u_{*t}$: air density from MOLA elevation and the seasonal CO₂ cycle; threshold friction
  speed after Iversen & White (1982) / Kok (2012); $u_*$ from a log-law estimate of near-surface wind.
* **Bulk Richardson number** and near-surface super-adiabatic gradient: midday convection (strongest ~11:00–15:30 local time).
* **Pressure-drop index** ($\Delta P$ per minute, 5-min $\sigma_P$): what a 1 Hz barometer (MEDA, InSight APSS) would see.
  **There is no live sensor feed** — unless the caller supplies them, these values are *modelled* from site, season and
  time of day, so the index describes a scenario, not a measurement.
* **Dust supply**: TES dust cover and low thermal inertia.
* **Storm-season regions**: six approximate ellipses hand-placed after the storm-track maps in MDAD (Battalio & Wang 2021)
  and Montabone et al. (2015, 2020); positions and weights are rough.

`STORM.dustRiskSanityChecks()` only verifies that the index moves in the expected direction (calm → low, deep pressure drop
→ high, night < afternoon, perihelion season > aphelion). Testing it properly would need labelled pressure-drop catalogues
(e.g. MEDA/InSight vortex detections), which we did not have time to assemble.
