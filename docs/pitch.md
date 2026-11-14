# 3-minute pitch script (NASA Space Apps Challenge — "Interplanetary Survival Guide: Martian Map")

**0:00 — Problem (20 s)**
"NASA's landing engineers want low, flat, equatorial ground — thick atmosphere, no tip-over.
NASA's life-support engineers want water ice — which sits under rough mid-latitude terrain.
Those two teams have argued about the same map since the 2015 Human Landing Site workshop.
We built the tool that turns that argument into an actionable Interplanetary Survival Guide."

**0:20 — What it is (20 s)**
"Mars Base Decision Engine: A client-side planetary GIS and life-support survival engine. Six real NASA, USGS, PSI, and ASU orbital layers — MOLA elevation, 90th-percentile slope, sub-cell roughness, SWIM 2.0 subsurface ice across 3 depth bands, TES thermal inertia & dust abundance, and Viking MDIM 2.1 imagery —
scored by NASA's own HLS-2015 landing-site rules in both 2D Map and 3D WebGL MOLA Globe views. Zero external libraries, no server, runs offline in any browser, every formula documented and unit-tested."

**0:40 — Demo 1: the conflict, visualised (35 s)**
*Click "Landing safety".* "Equatorial lowlands light up — Elysium, Isidis, Chryse."
*Click "ISRU".* "Watch the optimum migrate north: Arcadia, Utopia, Deuteronilus — exactly the regions NASA's SWIM team flagged for crewed missions.
The model was never told their names; it found them from data."
*Point at candidate card & detail panel.* "Each candidate explains human survival: −4 km elevation ✓, 0.9° slope ✓, SWIM ice consistency ✓ (distinguishing `NO_DATA` from `UNLIKELY` non-core targets), plus **SWIM ice-access classification & nominal-water-equivalent excavation estimate**, 4-crew life support margin, MSL Curiosity RAD-calibrated GCR radiation dose (`0.64 mSv/day ±18.8%` site-extrapolation uncertainty), and nocturnal surface cold."

**1:15 — Demo 2: Post-Landing Map Builder — xGDS + TRN + AutoNav + MGL (35 s)**
*Click "Tactical EVA" (or press `#btn-eva-demo` for the offline end-to-end Marswalk jury walkthrough).* "Orbital ~5 km/px priors cannot see sub-metre boulders, migrated dunes or today's dust grain size. So after touchdown the system **builds its own local map** on a `1 km × 1 km`, `100 × 100` (`10 m/cell`) grid anchored by **HiRISE `1 m/px` DTM product metadata** and bilinear orbital priors. TRN shrinks the landing error, AutoNav progressively assimilates five domains, and MGL locks pose against the skyline (`±1.6 m`)."
*Press "+1 Scan" / "Auto-Scan".* Real-time tracking updates position and ETA while causal rerouting explains why hazard detours replace naive paths. *Click the terrain* to dispatch an AutoNav spot-scan probe; *press "+ Inject Hazard"* and A* re-routes around a live rockfall; *press "SPE 30m Escape Sim"* and an emergency path back to the base is drawn with its time-to-shelter checked against 30 minutes.
The Lunar-adapted **xEMU reference PLSS engine** (`web/ui/eva.js`, extrapolated to 0.38g Mars) tracks Pandolf metabolic load, O₂, battery, cooling water, **`CO₂ RCA` scrubber capacity, and ≥25% return reserve protection** — synchronized identically across the EVA panel, **Helmet Visor HUD (`#btn-open-hud`)**, and exported **Mission Brief (`mars-mission-brief`)** / GeoJSON (`xgds_eva_route`, `xgds_discrepancy`).

**1:50 — Demo 3: seasonal dust-storm & Thermal Life Support (35 s)**
*`?demo=crisis&site=Arcadia&tau=9`.* "2018-style global storm at perihelion dust season ($L_s = 251^\circ$), τ = 9. Solar output drops 95 %. At night, ambient drops to −95°C.
Without auxiliary power, the habitat blacks out on sol 31 and **freezes out on sol 33**.
*Add one 10 kWe Kilopower reactor.* Survives. Thermal life support stays at +20°C. Now it's an interactive slider and downloadable Mission Brief the planner can export."

**2:25 — Validity (20 s)**
"Real orbital data: MOLA and Viking MDIM 2.1 via NASA Mars Trek, SWIM 2.0 from PSI, TES via ASU JMARS, thresholds from the 2015 HLS workshop, GCR radiation calibrated to Curiosity RAD at Gale Crater (232 mSv/yr), and storm attenuation fitted to Opportunity's 2018 telemetry.
And it is validated: the nine real Mars landers sit in the 90th percentile of our landing score — we never told the model where they are. Limitations are on the Method page: ~5 km regional cells."

**2:45 — Impact (15 s)**
"Swap the layers and the same engine ranks lunar south-pole Artemis sites. Add a layer and it ranks for a different crew.
It's not just a map of Mars — it's how humans decide where and how to survive on Mars."

---

## Judge Q&A — likely questions

* **How do you know the score means anything?** `tools/validate.js`: all nine successful landers rank at the 90th percentile (p < 0.005, partly circular landing check), 39 HLS-2015 Exploration Zones rank at the 71st percentile (p < 0.005), **Test 3** independently validates EVA safety across all **4 biomes** (`Jezero Delta`, `Gale Boxwork`, `Nili Fossae`, `Arcadia Planitia`) plus 0.38g PLSS (`0` hazard hits vs. `13–21` naive orbital hits), and **N=100 Monte Carlo** reports 95% Wilson CIs on Top-5 stability.
* **Why not higher resolution globally?** Global reconnaissance uses ~5 km/px orbital priors, whereas tactical EVA consumes HiRISE `1 m/px` DTM product metadata & bilinear terrain synthesis in Phase 2 (`data_pipeline/preprocess.py` also ingests standard GeoTIFF/VICAR rasters directly).
* **Why 90th-percentile slope?** Safety-conservative: a 5 km cell is only as safe as its worst sub-kilometre corners.
* **How confident is the ice layer?** SWIM 2.0 "consistency" synthesises 5 independent datasets (neutron spectroscopy, SHARAD radar, thermal inertia, geomorphology, dielectric); we let planners switch between 0–1 m, 1–5 m, and > 5 m excavation horizons.
* **How do you avoid multicollinearity between Elevation (`01`) and GCR Radiation (`07`)?** Atmospheric column mass $\Sigma(h)$ is governed by elevation $h$, while our `radDose(h, slope)` model also incorporates **local topographic horizon sky-view shielding** ($\Omega = \cos^2(\theta/2)$, where canyon/crater walls block a fraction of isotropic GCR sky flux), and acute SPE shelter is tracked independently via **MGC3 cave skylight proximity (`08`)** and the 30-minute EVA shelter timer. Planners can also set `w.rad = 0` or enable non-compensatory geometric-mean scoring (`No compensation`).
* **What would you add with one more week?** Stream full-resolution HiRISE 1 m/px GeoTIFF tile pyramids dynamically via Range requests in Phase 2 (augmenting our resampled 10 m/cell HiRISE priors + 4-biome Traverse Validation) and couple 3D subsurface dielectric tomography directly to volatile mass-balance sizing.
