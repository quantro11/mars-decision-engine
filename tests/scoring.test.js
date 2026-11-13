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

// --- Interplanetary Survival Guide: Emergency Safe Havens on traverse
assert.ok(Array.isArray(safe.stats.safeHavens), 'safe havens list returned');

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

// --- data honesty: failed requests never produce fake telemetry
(async () => {
  const fail = async () => { throw new Error('net down'); };
  const w = await Live.fetchNASAWeather('DEMO_KEY', fail);
  assert.strictEqual(w.mode, 'reference'); assert.strictEqual(w.data, null, 'no invented sol / pressure');
  const sw = await Live.fetchSpaceWeather('DEMO_KEY', fail);
  assert.strictEqual(sw.mode, 'offline'); assert.strictEqual(sw.events.length, 0, 'no invented CME');
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  const arch = await Live.fetchNASAWeather('k', ok({ sol_keys: ['675'], '675': { AT: { mn: -90, mx: -20, av: -60 }, PRE: { av: 750 }, First_UTC: '2020-10-19T18:32:20Z' } }));
  assert.strictEqual(arch.mode, 'archive'); assert.strictEqual(arch.data.sol, 675); assert.strictEqual(arch.data.pressure_pa, 750);
  const live = await Live.fetchSpaceWeather('k', ok([{ activityID: 'A', startTime: '2026-11-01T00:00Z' }, { activityID: 'B', startTime: '2026-11-05T00:00Z' }]));
  assert.strictEqual(live.mode, 'live'); assert.strictEqual(live.events[0].id, 'B', 'newest CME first');
  console.log('All scoring / A* / storm / radiation / seasonal / ice-access / heating / SPE / terrain-class / aggregation / live-API / data-honesty tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
