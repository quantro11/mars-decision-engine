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

// --- storm model
assert.ok(Math.abs(T.fTau(0.5) - 1) < 1e-9);
const drop = T.fTau(10.8); assert.ok(drop > 0.02 && drop < 0.05, 'Opportunity-like 2018 drop ~3%');
const res = T.simulate({ lat: 20, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 0, sols: 120, storm: { tau0: 0.5, tauPeak: 8, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
assert.ok(res.blackoutSol !== null, 'solar-only base blacks out in a tau-8 storm');
const res2 = T.simulate({ lat: 20, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 2, sols: 120, storm: { tau0: 0.5, tauPeak: 8, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
assert.strictEqual(res2.blackoutSol, null, 'two Kilopower units survive');

// --- radiation: anchored on MSL/RAD at Gale (0.64 mSv/day = ~234 mSv per Earth year)
const gale = S.radDose(-4400);
assert.ok(Math.abs(gale / 365.25 - 0.64) < 0.02, 'Gale dose matches MSL/RAD 0.64 mSv/day');
assert.ok(S.radDose(-7000) < gale && S.radDose(20000) > gale, 'dose falls with depth, rises with altitude');
assert.ok(S.F.rad(-7000) > S.F.rad(1500), 'radiation criterion prefers low ground');

// --- seasonal insolation
const eqMean = (() => { let q = 0; for (let l = 0; l < 360; l++) q += T.insolationTOA(0, l); return q / 360; })();
assert.ok(eqMean > 170 && eqMean < 195, 'equatorial Ls-mean TOA ~ 180 W/m2 (S0/pi x cos dec)');
assert.strictEqual(T.insolationTOA(-80, 90), 0, 'southern polar night at Ls 90');
assert.ok(T.insolationTOA(-30, 270) > T.insolationTOA(30, 270), 'perihelic southern summer is brighter');
assert.ok(Math.abs(T.dailySolar(20, 0.5) - T.dailySolar(20, 0.5, null)) < 1e-12, 'no Ls = legacy model');
const winter = T.simulate({ lat: -40, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 0, sols: 120, Ls0: 70, storm: { tau0: 0.5, tauPeak: 0.5, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
const summer = T.simulate({ lat: -40, panelArea: 1000, efficiency: 0.2, consumption: 300, capacity: 2000, kilopower: 0, sols: 120, Ls0: 250, storm: { tau0: 0.5, tauPeak: 0.5, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
assert.ok(summer.rows[60].solar > winter.rows[60].solar * 1.5, 'southern winter (Ls~92) vs perihelic summer (Ls~272) at 40S');

// --- weight sensitivity
const L2 = { ...L, slope: new Uint8Array(W * H).fill(8) };
const out2 = S.scoreMap(L2, S.PRESETS.isru.w, true, new Float32Array(W * H));
const ref = S.topCandidates(out2, W, H, 1, 4, 10);
const rob = S.sensitivity(L2, S.PRESETS.isru.w, true, ref, { runs: 10, spread: 0.2, n: 1, blockPx: 4, minSepPx: 10, matchPx: 2 }, S.mulberry32(1));
assert.strictEqual(rob[0], 1, 'strong icy patch survives every weight perturbation');

console.log('All scoring / A* / storm / radiation / season / sensitivity tests passed.');
