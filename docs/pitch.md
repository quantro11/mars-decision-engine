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
*Point at candidate card & detail panel.* "Each candidate explains human survival: −4 km elevation ✓, 0.9° slope ✓, SWIM ice consistency ✓, plus exact **ISRU Water Yield (L/sol)**, 4-crew life support margin, MSL Curiosity RAD-calibrated GCR radiation dose, and nocturnal surface cold."

**1:15 — Demo 2: multi-hazard rover route & Safe Havens (35 s)**
*`?demo=route&from=Jezero&to=Melas`.* "Straight line from Jezero to Valles Marineris: 9 400 km, crosses 30° slopes — that rover is on its side.
Multi-hazard A* on the MOLA slope, roughness, and TES dust-bearing grid: +10 % distance, max slope ≤ 14°, hazardous kilometres 911 → 43, avoiding both steep scarps and low-TI dust traps in under 300 milliseconds — while automatically identifying **Emergency Safe Havens** along the traverse for storm encampments."

**1:50 — Demo 3: seasonal dust-storm & Thermal Life Support (35 s)**
*`?demo=crisis&site=Arcadia&tau=9`.* "2018-style global storm at perihelion dust season ($L_s = 251^\circ$), τ = 9. Solar output drops 95 %. At night, ambient drops to −95°C.
Without auxiliary power, the habitat blacks out on sol 31 and **freezes out on sol 33**.
*Add one 10 kWe Kilopower reactor.* Survives. Thermal life support stays at +20°C. Now it's an interactive slider and downloadable Mission Brief the planner can export."

**2:25 — Validity (20 s)**
"Real orbital data: MOLA and Viking MDIM 2.1 via NASA Mars Trek, SWIM 2.0 from PSI, TES via ASU JMARS, thresholds from the 2015 HLS workshop, GCR radiation calibrated to Curiosity RAD at Gale Crater (232 mSv/yr), and storm attenuation fitted to Opportunity's 2018 telemetry.
Limitations are explicitly stated on the Method page: ~10 km regional grid cells and 8-bit elevation quantization."

**2:45 — Impact (15 s)**
"Swap the layers and the same engine ranks lunar south-pole Artemis sites. Add a layer and it ranks for a different crew.
It's not just a map of Mars — it's how humans decide where and how to survive on Mars."

---

## Judge Q&A — likely questions

* **Why not higher resolution?** Global reconnaissance comes first; a 100 m landing-ellipse study requires HiRISE DTM tiles. Our `data_pipeline/preprocess.py` ingests standard GeoTIFF/VICAR rasters directly.
* **Why 90th-percentile slope?** Safety-conservative: a 10 km cell is only as safe as its worst sub-kilometre corners.
* **How confident is the ice layer?** SWIM 2.0 "consistency" synthesises 5 independent datasets (neutron spectroscopy, SHARAD radar, thermal inertia, geomorphology, dielectric); we let planners switch between 0–1 m, 1–5 m, and > 5 m excavation horizons.
* **Why is GCR radiation shown in site details rather than a separate weight slider?** Surface GCR dose on Mars is governed by atmospheric column mass $\Sigma(h)$, which is a monotonic function of MOLA elevation $h$. Because elevation is already weighted in the score, keeping GCR dose as an explicit MSL-RAD calibrated diagnostic avoids double-counting (multicollinearity) while still giving mission planners exact mSv/yr telemetry.
* **What would you add with one more week?** HiRISE sub-meter boulder/crater hazard segmentation for the Top-5 candidates, line-of-sight telecom relay viewshed analysis, and dynamic regolith shielding mass-balance sizing.
