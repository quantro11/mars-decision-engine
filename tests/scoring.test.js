// Run:  node tests/scoring.test.js
const assert = require('assert');
const S = require('../web/scoring.js').SCORING;
const A = require('../web/astar.js').ASTAR;
const T = require('../web/storm.js').STORM;

// --- suitability functions follow the NASA HLS thresholds
assert.strictEqual(S.F.elev(-3000), 1);
assert.strictEqual(S.F.elev(2500), 0);
assert.ok(Math.abs(S.F.elev(0) - 0.5) < 1e-9);
assert.strictEqual(S.F.slope(3), 1);
assert.strictEqual(S.F.slope(20), 0);
assert.strictEqual(S.F.ice(null), 0);
assert.strictEqual(S.F.ice(1), 1);
assert.strictEqual(S.F.ice(-1), 0);
assert.ok(S.F.lat(-20) > 0.7 && S.F.lat(-20) < 1 && S.F.lat(0) === 1);
assert.strictEqual(S.F.lat(55), 0);

// --- weights normalise, presets sum to 1
for (const k in S.PRESETS) assert.ok(Math.abs(Object.values(S.PRESETS[k].w).reduce((a, b) => a + b) - 1) < 1e-9, k);
const n = S.normalize({ a: 2, b: 2 }); assert.strictEqual(n.a, 0.5);

// --- hard constraints veto
const w = S.PRESETS.balanced.w;
const ideal = { elev: -3000, slope: 2, ice: 0.8, rough: 10, lat: 10, ti: 250 };
assert.strictEqual(S.F.ti(250), 1); assert.ok(S.F.ti(40) < 0.2, 'dust sea penalised'); assert.ok(S.F.ti(650) < 0.3, 'bedrock penalised'); assert.strictEqual(S.F.ti(null), 0.5);
assert.ok(S.scoreCell(ideal, w, true) > 0.9);
assert.strictEqual(S.scoreCell({ ...ideal, elev: 3000 }, w, true), 0);
assert.ok(S.scoreCell({ ...ideal, elev: 3000 }, w, false) > 0);
assert.strictEqual(S.scoreCell({ ...ideal, lat: 60 }, w, true), 0, 'latitude veto');

// --- ISRU preset must prefer the icy cell, landing preset the low/flat cell
const icy = { elev: -1000, slope: 6, ice: 0.9, rough: 60, lat: 42, ti: 250 };
const flat = { elev: -4000, slope: 1, ice: -0.5, rough: 10, lat: 5, ti: 250 };
assert.ok(S.scoreCell(icy, S.PRESETS.isru.w, true) > S.scoreCell(flat, S.PRESETS.isru.w, true), 'ISRU prefers ice');
assert.ok(S.scoreCell(flat, S.PRESETS.landing.w, true) > S.scoreCell(icy, S.PRESETS.landing.w, true), 'landing prefers flat');

// --- scoreMap + topCandidates on a synthetic grid
const W = 128, H = 32;
const meta = { elev: { scale: 115.4, offset: -8200 }, slope: { scale: 0.125 }, rough: { scale: 4 }, ice: { scale: 0.01, offset: -1.28 }, ti: { scale: 4 } };
const L = { width: W, height: H, meta, latOfRow: (y) => 90 - (y + 0.5) * 180 / H, lonOfCol: (x) => -180 + (x + 0.5) * 360 / W,
  elev: new Uint8Array(W * H).fill(50), slope: new Uint8Array(W * H).fill(8), rough: new Uint8Array(W * H).fill(5), ice: new Uint8Array(W * H).fill(128), ti: new Uint8Array(W * H).fill(60) };
// make one wall of steep terrain and one icy patch
for (let y = 0; y < H; y++) L.slope[y * W + 30] = 200;          // 25 deg wall at column 30
for (let y = 14; y < 18; y++) for (let x = 40; x < 44; x++) L.ice[y * W + x] = 228;   // +1.0 ice
const out = S.scoreMap(L, S.PRESETS.isru.w, true, new Float32Array(W * H));
assert.strictEqual(out[10 * W + 30], 0, 'steep wall vetoed');
const top = S.topCandidates(out, W, H, 3, 4, 10);
assert.ok(top.length >= 1 && top[0].x >= 40 && top[0].x <= 44, 'icy patch is top candidate');

// --- A* goes around the wall, straight line goes through it
const safe = A.plan(L, 10, 16, 50, 16, { k: 0.3, maxSlope: 15, marginPx: 100 });
assert.ok(safe.ok, 'route found');
assert.ok(!safe.path.some(n => (n % W) === 30 && L.slope[n] * 0.125 > 15), 'route never crosses the wall');
const str = A.straight(L, 10, 16, 50, 16);
assert.ok(str.stats.maxSlope > 15 && safe.stats.maxSlope <= 15);
// wall now blocks everything except a gap -> path must use the gap
L.slope[5 * W + 30] = 8;
const viaGap = A.plan(L, 10, 16, 50, 16, { k: 0.3, maxSlope: 15, marginPx: 100 });
assert.ok(viaGap.ok && viaGap.path.includes(5 * W + 30), 'route uses the gap');

// --- A* multi-hazard avoidance: routes around low-TI fine-dust sinkage trap (<100 tiu)
for (let y = 12; y <= 20; y++) L.ti[y * W + 70] = 8; // 32 tiu deep dust pocket on direct line (60,16)->(80,16)
const dustAvoid = A.plan(L, 60, 16, 80, 16, { k: 0.3, maxSlope: 15, marginPx: 100 });
const dustDirect = A.straight(L, 60, 16, 80, 16);
assert.ok(dustAvoid.ok && dustAvoid.stats.dustKm === 0 && dustDirect.stats.dustKm > 0, 'A* avoids low-TI dust trap');

// --- storm model
assert.ok(Math.abs(T.fTau(0.5) - 1) < 1e-9);
const drop = T.fTau(10.8); assert.ok(drop > 0.02 && drop < 0.05, 'Opportunity-like 2018 drop ~3%');
const res = T.simulate({ lat: 20, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 0, sols: 120, storm: { tau0: 0.5, tauPeak: 8, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
assert.ok(res.blackoutSol !== null, 'solar-only base blacks out in a tau-8 storm');
const res2 = T.simulate({ lat: 20, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 2, sols: 120, storm: { tau0: 0.5, tauPeak: 8, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
assert.strictEqual(res2.blackoutSol, null, 'two Kilopower units survive');

// --- radiation shielding (MSL RAD calibration: Gale -4500m ~232 mSv/yr, higher elevation = higher dose)
const galeDose = S.radDoseMsvYr(-4500);
assert.ok(galeDose > 220 && galeDose < 245, 'MSL RAD Gale Crater ~232 mSv/yr');
assert.ok(S.radDoseMsvYr(2000) > galeDose, 'higher elevation receives higher GCR dose');

// --- seasonal solar longitude (Ls): perihelion southern summer > aphelion northern winter
assert.ok(T.dailySolar(-25, 0.5, 251) > T.dailySolar(-25, 0.5, 71), 'perihelion S. summer exceeds aphelion S. winter');
assert.ok(T.dailySolar(35, 0.5, 90) > T.dailySolar(35, 0.5, 270), 'northern summer solstice exceeds northern winter solstice at +35N');

// --- Ice access: SWIM consistency is classified, never turned into a litres-per-sol yield
assert.strictEqual(S.calcIceAccess(null, 'ice15').status, 'NO_DATA');
assert.strictEqual(S.calcIceAccess(-0.6, 'ice15').status, 'UNLIKELY');
assert.strictEqual(S.calcIceAccess(0.2, 'ice15').status, 'POSSIBLE');
const likely = S.calcIceAccess(0.8, 'ice01');
assert.strictEqual(likely.status, 'LIKELY'); assert.ok(!('yieldLitersSol' in likely), 'no invented yield');
assert.strictEqual(likely.regolithKgSol, 100, '10 L/sol at the stated 10 wt% assumption = 100 kg regolith');

// --- Thermal: electrical load is waste heat; heaters only cover the shortfall and are charged to the battery
const tempEq = T.surfaceTempC(0, 251);
assert.ok(tempEq.mean > -65 && tempEq.mean < -35, 'equatorial surface temp in the observed range');
const lossEq = T.thermalDemandKw(0, 251);
assert.ok(Math.abs(lossEq - 0.09 * (20 - tempEq.mean)) < 0.06, 'loss = UA x dT');
const cold = { lat: 45, ls: 90, panelArea: 1000, efficiency: 0.2, capacity: 2000, kilopower: 0, sols: 60, storm: { tau0: 0.5, tauPeak: 0.5, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } };
const lowLoad = T.simulate({ ...cold, lat: -45, consumption: 50 });
assert.ok(lowLoad.rows[30].heater > 0, 'small load in southern winter needs extra heaters');
const highLoad = T.simulate({ ...cold, lat: -45, consumption: 400 });
assert.strictEqual(highLoad.rows[30].heater, 0, 'a large electrical load already heats the habitat');
assert.ok(res.freezeSol !== null && res.freezeSol >= res.blackoutSol, 'interior freezes only after power runs out');
assert.strictEqual(res2.freezeSol, null, 'fission-powered base stays warm');
const sim = T.simulate({ ...cold, consumption: 100, sols: 120 });
assert.ok(sim.rows[100].dustLoss < sim.rows[10].dustLoss, 'dust accumulates even without a storm');

// --- Candidate rest stops on traverse (terrain only)
assert.ok(Array.isArray(safe.stats.safeHavens), 'rest-stop list returned');
assert.ok(safe.stats.safeHavens.every(h => h.km >= 200), 'no rest stop at the start point');

// --- SPE: one attenuation law for atmosphere, regolith and basalt (design-basis event, labelled as assumption)
const speLow = S.calcSPE(-6000, 0), speHigh = S.calcSPE(1500, 0);
assert.ok(speLow.unshieldedDoseMsv < speHigh.unshieldedDoseMsv, 'thicker atmosphere shields more');
assert.ok(speHigh.unshieldedDoseMsv < 1000, 'surface dose below the 5 g/cm2 reference');
const spe0 = S.calcSPE(-2000, 0), spe1 = S.calcSPE(-2000, 0.1);
assert.ok(Math.abs(spe1.shieldedDoseMsv - S.speDose(S.atmoColumnGcm2(-2000) + 15)) < 1, '0.1 m regolith = 15 g/cm2 under the same law');
assert.ok(S.calcSPE(-2000, spe0.requiredRegolithM).shieldedDoseMsv <= 100, 'required depth actually reaches 100 mSv');
assert.ok(spe0.lavaTubeMsv < 1e-3, '3.5 m basalt under the same law');
assert.strictEqual(spe0.designBasis, true);

// --- Terrain class: regional only, no boulder percentages
const smooth = S.calcTerrainClass(1.5, 12), rugged = S.calcTerrainClass(18, 180);
assert.strictEqual(smooth.terrainClass, 'SMOOTH'); assert.strictEqual(rugged.terrainClass, 'RUGGED');
assert.ok(!('boulderRiskPct' in smooth) && /HiRISE/.test(smooth.recommendation));

// --- Aggregation: geometric mean removes compensation; candidate blocks cannot hide vetoed ground
const steepIcy = { elev: -3000, slope: 14.5, ice: 1, rough: 10, lat: 10, ti: 250 };
const wIsru = S.normalize(S.PRESETS.isru.w);
const Lone = { width: 1, height: 1, meta, latOfRow: () => 10, lonOfCol: () => 0,
  elev: Uint8Array.of(Math.round((-3000 + 8200) / 115.4)), slope: Uint8Array.of(Math.round(14.5 / 0.125)), rough: Uint8Array.of(3), ice: Uint8Array.of(228), ti: Uint8Array.of(62) };
const sumScore = S.scoreMap(Lone, S.PRESETS.isru.w, false, new Float32Array(1))[0];
const geoScore = S.scoreMap(Lone, S.PRESETS.isru.w, false, new Float32Array(1), 'geo')[0];
assert.ok(geoScore < sumScore - 0.1, 'unsafe slope is not bought back by ice under geometric mean');
const blk = new Float32Array(16 * 16).fill(0.9); for (let i = 0; i < 16 * 8; i++) blk[i] = 0;   // half vetoed
assert.strictEqual(S.topCandidates(blk, 16, 16, 1, 16, 4).length, 0, 'half-vetoed block is not a candidate');

// --- Live Planetary APIs & Earth vs Mars Habitability Baseline
const Live = require('../web/live_api.js').LIVE_API;
assert.ok(Live.EARTH_BASELINE.pressure_kpa === 101.3);
assert.ok(Live.MARS_HABITABILITY_CRITERIA.length === 6, '6 vital biosphere habitability markers defined');
const waterCrit = Live.MARS_HABITABILITY_CRITERIA.find(c => /Water/i.test(c.marker));
assert.ok(waterCrit && /SWIM 2\.0/.test(waterCrit.eclss) && !/\bL\/sol\b/.test(waterCrit.eclss), 'Habitability water marker references SWIM 2.0 without invented L/sol claim');

// --- UI helper modules (pure, extracted from app.js)
const FMT = require('../web/ui/format.js').MDE_FMT, CH = require('../web/ui/charts.js').MDE_CHARTS;
assert.strictEqual(FMT.fmtLat(-5.44), '5.4°S'); assert.strictEqual(FMT.fmtLon(137.8), '137.8°E');
assert.ok(FMT.trekUrl(18.4, 77.6).includes('x=77.600&y=18.400'));
assert.strictEqual(FMT.candidateName(18.5, 77.5, { distDeg: 0.5, region: { name: 'Jezero', lat: 18.4, lon: 77.6 } }), 'Jezero');
assert.ok(FMT.candidateName(25, 77.6, { distDeg: 6.6, region: { name: 'Jezero Crater (Perseverance)', lat: 18.4, lon: 77.6 } }).startsWith('N of Jezero Crater'));
assert.ok(CH.profileSVG([{ km: 0, elev: -2000, slope: 2 }, { km: 50, elev: -1500, slope: 12 }]).includes('<svg'));
assert.ok(CH.crisisSVG([{ batt: 100, tau: 1 }, { batt: 50, tau: 8 }], 100).includes('<svg'));

// --- Surface temperature from radiative balance (same insolation model)
const tEq = T.surfaceTempC(0, null).mean, tV2w = T.surfaceTempC(47.6, 270).mean, tV2s = T.surfaceTempC(47.6, 90).mean;
assert.ok(tEq > -60 && tEq < -40, 'equatorial annual mean near the observed -50 C');
assert.ok(tV2w < tV2s - 20, 'Viking 2 latitude: winter much colder than summer');
assert.strictEqual(T.surfaceTempC(-80, 90).mean, Math.round((148 - 273.15) * 10) / 10, 'polar night floors at CO2 frost point');

// --- Shelter (cave candidate) criterion: weight 0 by default, so presets and validation are unchanged
for (const k in S.PRESETS) assert.strictEqual(S.PRESETS[k].w.cave, 0);
assert.strictEqual(S.F.cave(20), 1); assert.strictEqual(S.F.cave(600), 0); assert.strictEqual(S.F.cave(null), 0);
assert.ok(S.scoreCell({ ...ideal, cave: 30 }, { ...w, cave: 0.3 }, true) > S.scoreCell({ ...ideal, cave: 900 }, { ...w, cave: 0.3 }, true));

// --- data honesty & verified LIVE ARCHIVE fallback + xGDS + Perseverance (TRN + AutoNav + MGL) 5-Domain Surface Assimilation
const EVA = require('../web/ui/eva.js').MDE_EVA;
assert.strictEqual(EVA.DOMAINS.length, 5, '5 core surface assimilation domains (Topography, Geomorphology, Thermal, Radiation, Optical)');
assert.ok(EVA.SYSTEM_ARCH.TRN && EVA.SYSTEM_ARCH.AUTONAV && EVA.SYSTEM_ARCH.MGL && EVA.SYSTEM_ARCH.XGDS, 'TRN + AutoNav + MGL + xGDS architecture defined');
const simStep0 = EVA.simulateEVA(EVA.ZONES.gale_boxwork, { loadKg: 15, speedKmh: 2.4, maxSlope: 15, buddyMode: 'buddy', scanStep: 0, mglLocked: false });
const sim15 = EVA.simulateEVA(EVA.ZONES.gale_boxwork, { loadKg: 15, speedKmh: 2.4, maxSlope: 15, buddyMode: 'buddy', scanStep: 8, mglLocked: true });
const sim30 = EVA.simulateEVA(EVA.ZONES.gale_boxwork, { loadKg: 30, speedKmh: 2.4, maxSlope: 15, buddyMode: 'buddy', scanStep: 8, mglLocked: true });
assert.ok(sim15.maxSafeSlope <= 15 && sim15.directBoulderHits > 0, 'Local 1m/px AutoNav A* routes around boulders and steep scarps');
assert.ok(sim15.navStack.autonav.assimilatedPct > simStep0.navStack.autonav.assimilatedPct, 'Progressive AutoNav scan increases assimilated biome percentage');
assert.ok(sim15.assimilatedConfidencePct > simStep0.assimilatedConfidencePct, 'In-situ 5-domain assimilation raises confidence above coarse orbital prior');
assert.ok(sim15.orbitalHazardHits > 0 && sim15.orbitalSandM > sim15.safeSandM, 'Naive orbital-only route hits temporal-drift sand traps and sub-grid boulders avoided by AutoNav');
assert.ok(sim15.navStack.mgl.mglCorrectedErrorM < simStep0.navStack.mgl.mglCorrectedErrorM, 'MGL horizon correlation lock eliminates wheel/foot odometry drift');
assert.ok(sim15.domainScores.composite > 0 && sim15.domainScores.topography > 0 && sim15.domainScores.thermal > 0 && sim15.domainScores.radiation > 0 && sim15.domainScores.optical > 0 && sim15.domainScores.geomorphology > 0, 'All 5 domain scores computed');
assert.ok(sim30.metabolicKcalH > sim15.metabolicKcalH && sim30.o2UsedG > sim15.o2UsedG, 'Heavier sample load increases metabolic kcal/h and O2 consumption');
assert.ok(sim15.walkbackRadiusM > 300 && sim15.withinWalkback, 'Walkback safety radius computed and satisfied');
assert.ok(sim15.meanUphillGradePct >= 0 && sim15.meanDownhillGradePct >= 0, 'Signed uphill/downhill grade computed along EVA footpath');
assert.ok(EVA.ZONES.gale_boxwork.waypoints[0].x !== EVA.ZONES.jezero_delta.waypoints[0].x && EVA.ZONES.jezero_delta.waypoints[0].x !== EVA.ZONES.nili_fossae.waypoints[0].x, 'Distinct waypoint topologies across biomes');
const customZ1 = EVA.zoneFromCoords(-14.5, 175.4, { elev: -1900, slope: 6, rough: 42, ti: 210, ice: 0.1, rad: 255 }, 'Gusev');
const customZ2 = EVA.zoneFromCoords(22.3, -47.9, { elev: -3600, slope: 3, rough: 20, ti: 260, ice: 0.1, rad: 238 }, 'Chryse');
assert.ok(customZ1.base.x !== customZ2.base.x || customZ1.base.y !== customZ2.base.y, 'Coordinate-seeded custom EVA zones synthesize distinct geometries');
assert.ok(S.radDose(-2000, 14) < S.radDose(-2000, 0), 'Topographic horizon sky-view factor reduces GCR dose on sloped walls');
assert.ok(S.scoreCell({ ...flat, elev: -1000, slope: 12 }, { rad: 1 }, false) > S.scoreCell({ ...flat, elev: -1000, slope: 0 }, { rad: 1 }, false), 'scoreCell couples slope sky-view shielding into radiation suitability');
const tDust = T.surfaceTempC(0, 180, 55, -2000), tRock = T.surfaceTempC(0, 180, 500, -2000);
assert.ok((tDust.day - tDust.night) > (tRock.day - tRock.night) + 25, 'Low-TI dust exhibits larger diurnal temperature swing than high-TI bedrock');
assert.strictEqual(typeof A.smoothCellElev, 'function', 'Sub-pixel 3x3 Gaussian elevation smoothing exported on ASTAR');

// --- Interactive map-building: spot scans, dynamic hazards, SPE escape, VHF LoS, custom weights, honest chemistry
const zg = EVA.ZONES.gale_boxwork;
const simScan0 = EVA.simulateEVA(zg, { scanStep: 2 });
const simScan1 = EVA.simulateEVA(zg, { scanStep: 2, customScanPts: [{ x: 80, y: 15, r: 11 }, { x: 85, y: 80, r: 11 }], spotProbe: { x: 80, y: 15 } });
assert.ok(simScan1.navStack.autonav.assimilatedPct > simScan0.navStack.autonav.assimilatedPct, 'User spot scans expand AutoNav assimilated area');
assert.ok(simScan1.spotProbe && simScan1.spotProbe.xMeters === 800 && typeof simScan1.spotProbe.compositeScore === 'number', 'Spot probe returns local 5-domain cell readings');
const hzPt = sim15.safePath[Math.floor(sim15.safePath.length / 3)];
const simHz = EVA.simulateEVA(zg, { scanStep: 8, dynamicHazards: [{ x: hzPt[0], y: hzPt[1], r: 4 }] });
assert.ok(!simHz.safePath.some(([x, y]) => Math.hypot(x - hzPt[0], y - hzPt[1]) < 3), 'A* re-routes around injected dynamic hazard');
assert.ok(simHz.discrepancies.some(d => String(d.id).startsWith('DISC-DYN')), 'Dynamic hazard logged as xGDS discrepancy');
const simSpe = EVA.simulateEVA(zg, { scanStep: 4, speAlert: true });
assert.ok(simSpe.speAlert && simSpe.spePath.length > 1 && simSpe.speTimeToShelterMin > 0 && typeof simSpe.speWithin30Min === 'boolean', 'SPE emergency escape path + time-to-shelter computed');
assert.ok(simSpe.commsLos && typeof simSpe.commsLos.losClear === 'boolean' && typeof simSpe.commsLos.linkMarginDb === 'number', 'VHF line-of-sight terrain check computed');
const simCw = EVA.simulateEVA(zg, { scanStep: 8, scoreMode: 'custom', customWeights: { topography: 0, geomorphology: 0, thermal: 0, radiation: 0, optical: 100 } });
assert.ok(Math.abs(simCw.domainScores.composite - simCw.domainScores.optical) < 0.2, 'Custom 5-domain weights drive the composite score');
const zIce = EVA.zoneFromCoords(62, -30, { elev: -4000, slope: 2, ti: 240, ice: 0.6, rad: 240 }, 'Ice Plain');
const zBas = EVA.zoneFromCoords(-20, 20, { elev: 1000, slope: 5, ti: 420, ice: 0, rad: 270 }, 'Basalt Plain');
assert.ok(zIce.waypoints[0].chem.H2O > 20 && zBas.waypoints[0].chem.H2O < 6, 'Custom-site chemistry is conditioned on orbital ice/TI, not copied from Gale');
assert.ok(!/Boxwork/i.test(zBas.waypoints.map(w => w.rockType).join(' ')), 'Custom-site lithology does not inherit Gale boxwork labels');
const simIce = EVA.simulateEVA(zIce, { scanStep: 8 });
assert.ok(simIce.orbitalHazardHits > 0 && simIce.orbitalSandM > simIce.safeSandM, 'Custom zones still show orbital-vs-AutoNav discrepancy');

// --- Cross-module physics unification checks (GCR radiation, thermal elevation/TI, Pandolf bioenergetics, Great-Circle & A* evaStats)
assert.strictEqual(Math.round(S.radDose(safe.stats.profile[0].elev, safe.stats.profile[0].slope)), Math.round(safe.stats.profile[0].radMsvYr), 'ASTAR and SCORING use identical MSL-RAD + sky-view GCR radiation formula');
assert.ok(str.stats.evaStats.walkHours > safe.stats.evaStats.walkHours, 'Direct route across steep/dusty hazards takes more EVA walk hours than safe A* route');
assert.ok(str.stats.evaStats.metabolicW >= safe.stats.evaStats.metabolicW, 'Hazardous direct route requires higher metabolic power');
assert.ok(T.thermalDemandKw(0, 251, 200, 4000) > T.thermalDemandKw(0, 251, 200, -4000), 'Higher elevation increases habitat thermal demand via atmospheric lapse rate');
const simHighElev = T.simulate({ ...cold, lat: 0, elev: 4000, ti: 180, consumption: 40, sols: 40 });
const simLowElev = T.simulate({ ...cold, lat: 0, elev: -4500, ti: 180, consumption: 40, sols: 40 });
assert.ok(simHighElev.rows[20].heater > simLowElev.rows[20].heater, 'STORM.simulate couples elevation & TI into daily habitat heating budget');
const bioLight = S.calcPandolfMars({ slopeDeg: 2, ti: 250, loadKg: 10, durationH: 5 });
const bioHeavy = S.calcPandolfMars({ slopeDeg: 12, ti: 70, loadKg: 30, durationH: 5 });
assert.ok(bioHeavy.metabolicW > bioLight.metabolicW && bioHeavy.walkbackRadiusM < bioLight.walkbackRadiusM, 'SCORING.calcPandolfMars scales metabolic load and walkback envelope with slope, TI, and load');
const gcHighLat = A.straight(L, 10, 4, 60, 4);
assert.ok(gcHighLat.ok && gcHighLat.path.some(idx => Math.floor(idx / W) < 4), 'ASTAR.straight follows spherical great-circle arc poleward at high latitude');

// ---------------------------------------------------------------- Anisotropic A*, Dust-Storm IR Greenhouse, Seasonal CO2 Pressure & Phase 2 Benchmarks
// 1. Seasonal CO2 polar cap condensation/sublimation shifts atmospheric column & GCR dose across Ls
const colMin = S.atmoColumnGcm2(-4000, 148); // Late southern winter minimum
const colMax = S.atmoColumnGcm2(-4000, 250); // Perihelion CO2 sublimation maximum
assert.ok(colMax > colMin * 1.12 && S.radDose(-4000, 0, 250) < S.radDose(-4000, 0, 148), 'Seasonal CO2 cycle modulates atmospheric column and GCR dose between Ls=148 and Ls=250');

// 2. Dust storm optical depth tau warms nighttime low (IR greenhouse) and cools daytime peak
const tClear = T.surfaceTempC(18.4, 250, 220, -2500, 0.5);
const tStorm = T.surfaceTempC(18.4, 250, 220, -2500, 9.5);
assert.ok(tStorm.night > tClear.night + 8 && tStorm.day < tClear.day - 8 && (tStorm.day - tStorm.night) < (tClear.day - tClear.night), 'High dust optical depth warms nocturnal low (IR greenhouse) and damps diurnal swing');

// 3. Anisotropic A* directional grade cost & ascent/descent telemetry
const Lgrade = {
  width: 30, height: 15, meta: L.meta,
  elev: new Uint8Array(30 * 15), slope: new Uint8Array(30 * 15).fill(24),
  rough: new Uint8Array(30 * 15).fill(5), ti: new Uint8Array(30 * 15).fill(60),
  latOfRow: (y) => 90 - (y + 0.5) * 180 / 15, lonOfCol: (x) => -180 + (x + 0.5) * 360 / 30,
};
for (let y = 0; y < 15; y++) for (let x = 0; x < 30; x++) Lgrade.elev[y * 30 + x] = 40 + x * 4;
const rUp = A.plan(Lgrade, 2, 7, 20, 7, { maxSlope: 15, slopePenalty: 0.3 });
const rDn = A.plan(Lgrade, 20, 7, 2, 7, { maxSlope: 15, slopePenalty: 0.3 });
assert.ok(rUp.ok && rDn.ok && rUp.stats.totalAscentM > 5000 && rDn.stats.totalDescentM > 5000, 'ASTAR.plan reports directional totalAscentM and totalDescentM');

// 4. Phase 2 buildLocalGrid couples to orbital rasters & validatePhase2Benchmarks passes all rover/Apollo checks
const gCoupled = EVA.buildLocalGrid(EVA.ZONES.jezero_delta, L);
assert.ok(gCoupled.N === 100 && gCoupled.slope.length === 10000 && gCoupled.elev[0] !== 0, 'EVA.buildLocalGrid couples 1 km micro-DEM to orbital rasters and 2D finite-difference slopes');
const p2Bench = EVA.validatePhase2Benchmarks(L, S);
assert.ok(p2Bench.allPass && p2Bench.checks.length === 3, 'EVA.validatePhase2Benchmarks passes Perseverance Sol 0-420, Curiosity Boxwork, and Apollo/xEMU bioenergetics checks');

(async () => {
  const fail = async () => { throw new Error('net down'); };
  const w = await Live.fetchNASAWeather('DEMO_KEY', fail);
  assert.strictEqual(w.mode, 'reference'); assert.strictEqual(w.data, null, 'no invented sol / pressure');
  const sw = await Live.fetchSpaceWeather('DEMO_KEY', fail);
  assert.strictEqual(sw.mode, 'live_archive'); assert.strictEqual(sw.events.length, 4, 'verified May 2024 AR3664 DONKI archive fallback');
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  const arch = await Live.fetchNASAWeather('k', ok({ sol_keys: ['675'], '675': { AT: { mn: -90, mx: -20, av: -60 }, PRE: { av: 750 }, First_UTC: '2020-10-19T18:32:20Z' } }));
  assert.strictEqual(arch.mode, 'archive'); assert.strictEqual(arch.data.sol, 675); assert.strictEqual(arch.data.pressure_pa, 750);
  const live = await Live.fetchSpaceWeather('k', ok([{ activityID: 'A', startTime: '2026-11-01T00:00Z' }, { activityID: 'B', startTime: '2026-11-05T00:00Z' }]));
  assert.strictEqual(live.mode, 'live'); assert.strictEqual(live.events[0].id, 'B', 'newest CME first');
  console.log('All scoring / A* / storm / radiation / seasonal / ice-access / heating / SPE / terrain-class / aggregation / EVA / live-API tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
