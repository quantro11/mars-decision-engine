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
*Point at candidate card & detail panel.* "Each candidate explains human survival: −4 km elevation ✓, 0.9° slope ✓, SWIM ice consistency ✓, plus **SWIM ice-access classification & assumed-10 wt% excavation estimate**, 4-crew life support margin, MSL Curiosity RAD-calibrated GCR radiation dose, and nocturnal surface cold."

**1:15 — Demo 2: Post-Landing Map Builder — xGDS + TRN + AutoNav + MGL (35 s)**
*Click "Tactical EVA" (or "Zoom to Local EVA Zone" on any candidate card).* "Orbital data is a stale, coarse prior: it cannot see sub-metre boulders, migrated dunes or today's dust cover. So after touchdown the system **builds its own map**. On a 1 km × 1 km, 10 m/cell local micro-DEM, TRN shrinks the landing error, AutoNav progressively assimilates five domains — Topography, Geomorphology, Thermal, Radiation, Optical — and MGL locks pose against the skyline.
*Press "+1 Scan" / "Auto-Scan".* Confidence climbs from the orbital prior towards the assimilated value while orbital-vs-in-situ discrepancies appear. *Click the terrain* to dispatch an AutoNav spot-scan probe; *press "+ Inject Hazard"* and A* re-routes around a live rockfall; *press "SPE 30m Escape Sim"* and an emergency path back to the base is drawn with its time-to-shelter checked against 30 minutes. A VHF line-of-sight check along the terrain profile flags when the crew needs a relay, and planners can pick **Custom 5-Domain Weights**.
The xEMU/PLSS engine (`web/ui/eva.js`) computes 0.38 g Pandolf metabolic load (W, kcal/h), O₂ use against an 850 g budget, battery against 960 Wh, cooling water and the walkback radius — shown in the panel and the **Helmet Visor HUD (`#btn-open-hud`)**, and exported as GeoJSON (`xgds_eva_route`, `xgds_discrepancy`). Local terrain is procedurally synthesised from the orbital cell values, not real HiRISE data — it demonstrates the workflow, not ground truth."

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

* **How do you know the score means anything?** `tools/validate.js`: all nine successful landers rank at the 90th percentile of their latitude band (p < 0.005 against random sites). Exploration Zones only modestly — they were picked for science, often beside rough terrain.
* **Why not higher resolution?** Global reconnaissance comes first; a 100 m landing-ellipse study requires HiRISE DTM tiles. Our `data_pipeline/preprocess.py` ingests standard GeoTIFF/VICAR rasters directly.
* **Why 90th-percentile slope?** Safety-conservative: a 5 km cell is only as safe as its worst sub-kilometre corners.
* **How confident is the ice layer?** SWIM 2.0 "consistency" synthesises 5 independent datasets (neutron spectroscopy, SHARAD radar, thermal inertia, geomorphology, dielectric); we let planners switch between 0–1 m, 1–5 m, and > 5 m excavation horizons.
* **How do you avoid multicollinearity between Elevation (`01`) and GCR Radiation (`07`)?** Atmospheric column mass $\Sigma(h)$ is governed by elevation $h$, while our `radDose(h, slope)` model also incorporates **local topographic horizon sky-view shielding** ($\Omega = \cos^2(\theta/2)$, where canyon/crater walls block a fraction of isotropic GCR sky flux), and acute SPE shelter is tracked independently via **MGC3 cave skylight proximity (`08`)** and the 30-minute EVA shelter timer. Planners can also set `w.rad = 0` or enable non-compensatory geometric-mean scoring (`No compensation`).
* **What would you add with one more week?** Ingest real HiRISE DTM tiles in place of the procedural local micro-DEM, validate the local planner against a published Perseverance traverse, and size regolith shielding mass-balance dynamically.
