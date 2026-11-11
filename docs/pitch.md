# 3-minute pitch script

**0:00 — Problem (20 s)**
"NASA's landing engineers want low, flat, equatorial ground — thick atmosphere, no tip-over.
NASA's life-support engineers want water ice — which sits under rough mid-latitude terrain.
Those two teams have argued about the same map since the 2015 Human Landing Site workshop.
We built the tool that turns that argument into a number."

**0:20 — What it is (20 s)**
"Mars Base Decision Engine. Six real NASA/PSI/ASU data layers — MOLA elevation, MOLA slope, roughness, SWIM 2.0 ice, TES thermal inertia, latitude —
scored by NASA's own landing-site rules, re-weighted live. No server, runs in a browser, every formula documented and unit-tested."

**0:40 — Demo 1: the conflict, visualised (35 s)**
*Click "Landing safety".* "Equatorial lowlands light up — Elysium, Isidis, Chryse."
*Click "ISRU".* "Watch the optimum migrate north: Arcadia, Utopia, Deuteronilus — exactly the regions NASA's SWIM team flagged for crewed missions.
The model was never told their names; it found them from data."
*Point at candidate card.* "Each candidate explains itself: −4 km elevation ✓, 0.9° slope ✓, ice consistency 0.72 ✓, 35° N ⚠."

**1:15 — Demo 2: rover route (35 s)**
*`?demo=route&from=Jezero&to=Melas`.* "Straight line from Jezero to Valles Marineris: 9 400 km, crosses 30° slopes — that rover is on its side.
A* on the slope grid: +10 % distance, max slope 14°, hazardous kilometres 911 → 43. Three hundred milliseconds."

**1:50 — Demo 3: dust storm (35 s)**
*`?demo=crisis&site=Arcadia&tau=9`.* "2018-style global storm, τ = 9. Solar output −95 %. A 1 000 m² array with 2 MWh of batteries goes dark on sol 31.
*Add one Kilopower.* Survives. That is the same conclusion NASA reached — now it's a slider the mission planner can move."

**2:25 — Validity (20 s)**
"Real data: MOLA via Mars Trek, SWIM 2.0 from PSI, thresholds from the 2015 HLS workshop, storm constant fitted to Opportunity's 2018 telemetry.
Limitations are on the Method page: 10 km cells, no radiation model, no thermal inertia yet."

**2:45 — Impact (15 s)**
"Swap the layers and the same engine ranks lunar south-pole sites. Add a layer and it ranks for a different crew.
It's not a map of Mars — it's a way to decide on Mars."

---

## Judge Q&A — likely questions

* **Why not higher resolution?** Global decision first; a landing-ellipse study needs HiRISE and a different tool. Our pipeline accepts any GeoTIFF.
* **Why 90th-percentile slope?** Safety-conservative: a cell is only as good as its bad corners.
* **How confident is the ice layer?** SWIM "consistency" is agreement across 5 datasets (neutron, radar, thermal, geomorphology, dielectric); we show the band (0–1 / 1–5 / > 5 m) the crew could actually excavate.
* **Is the storm model physical?** Semi-empirical, one fitted constant, cited; good for comparing architectures, not for hardware sizing — and we say so.
* **What would you add with one more week?** Seasonal insolation; radiation shielding by regolith depth; HiRISE-based local hazard maps for the top-5.
