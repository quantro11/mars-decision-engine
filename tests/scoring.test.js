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
assert.ok(S.radDose(-2000, 14) < S.radDose(-2000, 0), 'Topographic horizon sky-view factor reduces GCR dose on sloped walls');
assert.ok(S.scoreCell({ ...flat, elev: -1000, slope: 12 }, { rad: 1 }, false) > S.scoreCell({ ...flat, elev: -1000, slope: 0 }, { rad: 1 }, false), 'scoreCell couples slope sky-view shielding into radiation suitability');
const tDust = T.surfaceTempC(0, 180, 55, -2000), tRock = T.surfaceTempC(0, 180, 500, -2000);
assert.ok((tDust.day - tDust.night) > (tRock.day - tRock.night) + 25, 'Low-TI dust exhibits larger diurnal temperature swing than high-TI bedrock');
assert.strictEqual(typeof A.smoothCellElev, 'function', 'Sub-pixel 3x3 Gaussian elevation smoothing exported on ASTAR');


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


// Suit metabolic model is calibrated to the Apollo 14-17 lunar EVA mean (234 kcal/h = 272 W; NASA TN D-7883)
const bioMoon = S.calcPandolfMars({ speedKmh: 2.4, loadKg: 15, gradePct: 2.0, terrainEta: 1.25, gravityMps2: 1.62 });
assert.ok(bioMoon.metabolicW >= 228 && bioMoon.metabolicW <= 352, 'lunar-gravity walk falls inside the Apollo per-EVA range (228-352 W)');
assert.ok(S.calcPandolfMars({ loadKg: 30 }).metabolicW > S.calcPandolfMars({ loadKg: 15 }).metabolicW, 'heavier load costs more energy');

// --- Monte Carlo 100-run Wilson CI, RAD uncertainty band, soil-adjusted slope limit, & Layer Provenance
const mcOut = S.sensitivity(L, S.PRESETS.balanced.w, true, [{ x: 10, y: 16 }], { mode: 'sum', runs: 100, spread: 0.2, n: 5, blockPx: 4, minSepPx: 10, matchPx: 6 }, S.mulberry32(2026));
assert.strictEqual(mcOut.runs, 100, 'Monte Carlo defaults to 100 perturbed runs');
assert.ok(Array.isArray(mcOut.ci95) && mcOut.ci95.length === 1 && mcOut.ci95[0][0] <= mcOut[0] && mcOut.ci95[0][1] >= mcOut[0], 'Wilson 95% binomial CI flanks observed stability rate');
const radB = S.radDoseBand(-4400, 0);
assert.ok(radB.uncMsvYr > 30 && radB.relUncPct === 18.8 && radB.min < radB.nominal && radB.max > radB.nominal, 'RAD global extrapolation includes ±18.8% uncertainty band');
assert.ok(S.effectiveSlopeLimit(15, 70).effectiveMaxDeg < 15 && S.effectiveSlopeLimit(15, 250).effectiveMaxDeg >= 15, '15° operational slope limit adapts to soil thermal inertia');
const bekkerFine = S.calcBekkerTerramechanics(70, 450, 0.25, 0.25);
const bekkerRock = S.calcBekkerTerramechanics(350, 450, 0.25, 0.25);
assert.ok(bekkerFine.sinkageMm > bekkerRock.sinkageMm && bekkerFine.slipRiskPct > bekkerRock.slipRiskPct, 'Bekker terramechanics correctly predicts higher sinkage and slip in loose dust');
assert.ok(Array.isArray(S.LAYER_PROVENANCE) && S.LAYER_PROVENANCE.length >= 7 && S.LAYER_PROVENANCE.every(p => p.name && p.productCode && p.crs && p.nativeRes && p.shippedRes && p.epoch), 'Full scientific layer provenance catalog exported');
assert.ok(typeof safe.stats.totalAscentM === 'number' && safe.stats.hazardZones && typeof safe.stats.hazardZones.steepKm === 'number' && safe.stats.returnRoute && safe.stats.returnRoute.returnKm > 0, 'ASTAR.plan exports ascent/descent, hazardZones, and returnRoute');
assert.ok(safe.stats.evaStats && typeof safe.stats.evaStats.co2ScrubberUsedPct === 'number' && safe.stats.evaStats.returnReserveProtected === true, 'ASTAR.plan evaStats includes CO2 RCA scrubber and return reserve protection');
assert.ok(safe.stats.safeHavens.every(h => h.vehicleScope === 'pressurized_rover_only'), '200 km rest stops explicitly restricted to pressurized rover traverses');

// 5. Heuristic dust-lifting risk index (hand-tuned, not a trained model)
assert.ok(Array.isArray(T.MDAD_CORRIDORS) && T.MDAD_CORRIDORS.length === 6, 'MDAD 6 historical storm corridors exported');
const mlVortex = T.predictDustML({ lat: 18.4, lon: 77.5, elev: -2500, slope: 3.5, ti: 160, dust: 0.72, ls: 255, tauPeak: 7.5, telemetryRegime: 'vortex_imminent' });
const mlCalm = T.predictDustML({ lat: 18.4, lon: 77.5, elev: -2500, slope: 3.5, ti: 320, dust: 0.25, ls: 70, tauPeak: 0.5, telemetryRegime: 'clear_calm' });
assert.strictEqual(mlVortex.cadenceSec, 60, 'risk index is evaluated on a 1-minute cadence');
assert.ok(mlVortex.horizons.h1m.prob > 0.85 && mlVortex.horizons.h6m.prob > 0.80, 'deep pressure-drop scenario gives a high +1 min and +6 min index');
assert.ok(mlCalm.horizons.h1m.prob < 0.20 && mlCalm.horizons.h6m.prob < 0.20, 'calm scenario keeps the +1 min and +6 min index low');
assert.ok(mlVortex.horizons.h1sol.prob > mlCalm.horizons.h1sol.prob + 0.40, 'perihelion storm corridor raises the +1-3 sol index above aphelion calm');
assert.strictEqual(mlVortex.validated, false, 'dust risk index is flagged as not validated');
assert.ok(!('overallAccuracyPct' in mlVortex) && !('overallRocAuc' in mlVortex), 'no accuracy claims are attached to the heuristic index');
assert.strictEqual(typeof T.validateDustMLBenchmarks, 'undefined', 'synthetic ML benchmark generator removed');
assert.ok(T.dustRiskSanityChecks().allPass, 'dust risk index responds in the physically expected direction');
// Measured dust climatology hook (web/dust_climatology_data.js). Placeholder ships as null -> heuristic fallback.
assert.strictEqual(T.dustClimAt(18, 77, 251, -2500), null, 'no climatology bundled -> null');
assert.strictEqual(T.baselineTau(18, 77, 251, -2500), 0.5, 'default pre-storm haze is tau 0.5 without climatology');
{
  const nLon = 60, nLat = 36, nLs = 12, n = nLon * nLat * nLs;
  const mean = new Array(n).fill(25), p90 = new Array(n).fill(40), fDust = new Array(n).fill(0);
  const bin = 8, cell = Math.floor((18 + 90) / 5) * nLon + Math.floor((77 + 180) / 6);   // Ls 240-270 at Jezero
  mean[bin * nLat * nLon + cell] = 75; fDust[bin * nLat * nLon + cell] = 100;
  global.MDE_DUST_CLIM = { meta: { grid: { dLon: 6, dLat: 5, nLon, nLat, lon0: -180, lat0: -90, nLs }, scale: { mean: 50, p90: 50, fDust: 250 }, marsYears: ['28', '34'], dustyTauThreshold: 1.5 }, mean, p90, fDust };
  const c = T.dustClimAt(18, 77, 251, 0);
  assert.ok(Math.abs(c.meanTau - 1.5) < 1e-9 && Math.abs(c.fDust - 0.4) < 1e-9 && c.years === 'MY 28–34', 'climatology lookup decodes the packed grid');
  assert.ok(T.dustClimAt(18, 77, 251, 5000).meanTau < c.meanTau, 'higher sites have less dust above them (pressure scaling)');
  assert.ok(T.dustClimAt(18, 77, 90, 0).meanTau < c.meanTau, 'season bins differ');
  assert.strictEqual(T.baselineTau(18, 77, 251, 0), 1.5, 'pre-storm haze comes from the climatology');
  const f = T.extractDustMLFeatures({ lat: 18, lon: 77, ls: 251, elev: 0 });
  assert.ok(/Montabone/.test(f.corridorName) && f.stormCorridorIndex > 0.8, 'storm-season index uses measured dusty-sol share');
  global.MDE_DUST_CLIM = null;
}

console.log('All scoring / A* / storm / radiation / seasonal / ice-access / heating / SPE / terrain-class / aggregation tests passed.');
