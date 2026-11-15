# 3-minute pitch script (NASA Space Apps Challenge — "Interplanetary Survival Guide: Martian Map")

**0:00 — Problem (20 s)**
"Landing engineers want low, flat, equatorial ground. Life-support engineers want water ice, which sits under rougher
mid-latitude terrain. NASA's 2015 Human Landing Site workshop argued over exactly this map. Martiap turns that argument
into a decision a team can make and defend."

**0:20 — What it is (20 s)**
"Martiap runs in the browser on real orbital data — MOLA elevation, slope and roughness, SWIM 2.0 subsurface ice, TES
thermal inertia and dust, Viking imagery — scored with NASA's HLS-2015 landing rules. One flow: pick a site, see how far
you can travel from it, and test whether the base survives a dust storm."

**0:40 — Demo 1: Site selection (30 s)**
*Click "Landing safety".* "Equatorial lowlands light up — Elysium, Isidis, Chryse."
*Click "Water ice & resources".* "The optimum moves north to Arcadia and Utopia — regions NASA's SWIM team flagged. The
model was never told their names." *Open a candidate.* "Each pick explains itself: elevation, slope, ice consistency (we
separate 'no data' from 'unlikely'), radiation dose with its uncertainty, and how stable the ranking is under 100 random
weight changes."

**1:10 — Demo 2: Landing site → Tactical EVA (35 s)**
*Pin a site in "Landing site".* "Pick a rover class and its range circle updates — the small rover is limited by driving
hours, the crewed rover by its battery."
*Open "Tactical EVA · 16 km²".* "Now we zoom from 5 km pixels to a 4 × 4 km box at 100 m per cell, cut from the MOLA-HRSC
200 m terrain model and THEMIS 100 m thermal images. Every cell gets a compatibility score with NASA's veto rules, and
field measurements we add update the cells around them."

**1:45 — Demo 3: Rover route (20 s)**
*Open "Rover route", pick two points, switch Mini / Lab / Crewed.* "Same path, different answers: km per sol, sols needed,
energy and recharge stops, and whether any slope exceeds that rover's limit."

**2:05 — Demo 4: Dust storm (25 s)**
*`?demo=crisis&site=Arcadia&tau=9`.* "A 2018-class global storm. The strip under the sliders answers immediately: the base
loses power and heat on a named sol, and each rover gets its own survive/fail."
*Add one 10 kWe reactor.* "Now it survives, and the strip turns green."

**2:30 — Honesty and validity (20 s)**
"Real landers rank in the 90th percentile of our landing score and NASA's 39 HLS-2015 zones in the 71st — both
p < 0.005. Our suit energy model matches Apollo lunar EVA measurements. Where we only have a heuristic — the dust-devil
risk index — we label it as one, with no made-up accuracy."

**2:50 — Impact (10 s)**
"Swap the layers and the same engine ranks lunar south-pole sites. It's a map of where, and how, people can survive on Mars."

---

## Judge Q&A — likely questions

* **How do you know the score means anything?** `tools/validate.js`: the nine landers rank at the 90th percentile within their latitude band (partly circular — they were chosen from similar data), the 39 HLS-2015 zones at the 71st (more independent), both p < 0.005. Monte Carlo reports 95 % Wilson intervals on Top-5 stability.
* **Is the dust-devil forecast machine learning?** No. It is a hand-tuned risk index built from physical features (Bagnold saltation ratio, bulk Richardson number, convective time of day, dust supply, storm-season regions). Its inputs are modelled, not live sensors, and we report no accuracy because we have no labelled data to test it on.
* **Why not higher resolution everywhere?** Global screening uses ~5 km cells. The Tactical EVA tab uses real 100–200 m pre-cuts for 9 sites; global zoom tiles need the full 200 m DEM and are not deployed.
* **Why 90th-percentile slope?** A 5 km cell is only as safe as its worst parts.
* **How confident is the ice layer?** SWIM 2.0 is a consistency index from several instruments, not a concentration. Planners can choose the 0–1 m, 1–5 m or > 5 m band.
* **Where do rover numbers come from?** Drive hours per sol are calibrated to Curiosity and Perseverance drive records; crewed-rover values are concept assumptions and are labelled as such.
* **One more week?** Generate the 200 m zoom tiles, add more Tactical EVA pre-cut sites, and test the dust index against MEDA/InSight pressure-drop catalogues.
