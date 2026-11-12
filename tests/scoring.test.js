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

// --- Interplanetary Survival Guide: ISRU Life-Support Water Yield & Mass Balance
const dryIsru = S.calcISRU(-0.8, 'ice01');
assert.strictEqual(dryIsru.yieldLitersSol, 0);
assert.strictEqual(dryIsru.status, 'DRY');
const richIsru = S.calcISRU(0.9, 'ice01');
assert.ok(richIsru.yieldLitersSol >= 50, 'rich shallow ice yields >= 50 L/sol');
assert.ok(richIsru.crewMargin > 0 && richIsru.loxKgSol > 30, 'sustains 4-crew and propellant oxygen');
assert.strictEqual(richIsru.status, 'SURPLUS_PROPELLANT');

// --- Interplanetary Survival Guide: Thermal Life Support & Habitat Freeze-out Model
const tempEq = T.surfaceTempC(0, 251);
assert.ok(tempEq.mean > -65 && tempEq.mean < -35, 'equatorial summer surface temp sensible');
assert.ok(tempEq.night < -70, 'diurnal radiative drop below -70C');
const pTherm = T.thermalDemandKw(0, 251);
assert.ok(pTherm >= 5 && pTherm <= 15, 'habitat heating demand between 5 and 15 kW');
// Solar-only storm base experiences habitat freeze-out when batteries die
assert.ok(res.freezeSol !== null && res.freezeSol >= res.blackoutSol, 'habitat freezes out after blackout');
assert.strictEqual(res2.freezeSol, null, 'Kilopower base maintains habitable thermal life support');

// --- Interplanetary Survival Guide: Emergency Safe Havens on traverse
assert.ok(Array.isArray(safe.stats.safeHavens), 'safe havens list returned');

// --- Interplanetary Survival Guide: SPE Acute Radiation & Regolith Shielding
const speUnshielded = S.calcSPE(-2000, 0);
assert.ok(speUnshielded.unshieldedDoseMsv > 1200, 'severe unshielded SPE dose > 1200 mSv');
assert.strictEqual(speUnshielded.survivalStatus, 'LETHAL_ACUTE');
const speShielded = S.calcSPE(-2000, 2.0);
assert.ok(speShielded.shieldedDoseMsv <= 100, '2.0m regolith attenuates SPE to nominal safe <= 100 mSv');
assert.strictEqual(speShielded.survivalStatus, 'NOMINAL_SAFE');
assert.ok(speShielded.lavaTubeMsv < 1, 'lava tube provides >99.9% radiation attenuation');

// --- Interplanetary Survival Guide: Tactical Micro-Hazard Prediction (HiRISE 0.25 m/px proxy)
const smoothMicro = S.calcMicroHazard(1.5, 12);
assert.strictEqual(smoothMicro.tacticalGrade, 'NOMINAL_SMOOTH');
assert.ok(smoothMicro.boulderRiskPct < 20 && !smoothMicro.trnRequired);
const roughMicro = S.calcMicroHazard(18.0, 180);
assert.strictEqual(roughMicro.tacticalGrade, 'HIGH_HAZARD');
assert.ok(roughMicro.boulderRiskPct >= 50 && roughMicro.trnRequired);

console.log('All scoring / A* / storm / radiation / seasonal / ISRU / thermal / SPE / micro-hazard tests passed.');
