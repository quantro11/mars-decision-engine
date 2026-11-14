'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const vehiclesJson = JSON.parse(fs.readFileSync(path.join(WEB, 'vehicles.json'), 'utf8'));
const tacticalJson = JSON.parse(fs.readFileSync(path.join(WEB, 'tactical_config.json'), 'utf8'));
const vehiclesJs = require(path.join(WEB, 'vehicles_data.js'));
const tacticalJs = require(path.join(WEB, 'tactical_config_data.js'));
const cutoutsJson = JSON.parse(fs.readFileSync(path.join(WEB, 'layers', 'eva_cutouts.json'), 'utf8'));
const cutoutsJs = require(path.join(WEB, 'eva_cutouts_data.js'));

const MARS_TIME = require(path.join(WEB, 'mars_time.js'));
const SCORING_MOD = require(path.join(WEB, 'scoring.js'));
const SCORING = SCORING_MOD.SCORING || SCORING_MOD;
const STORM_MOD = require(path.join(WEB, 'storm.js'));
const STORM = STORM_MOD.STORM || STORM_MOD;
const ENGINE = require(path.join(WEB, 'tactical_eva_engine.js'));
const wmsProxy = require(path.join(ROOT, 'api', 'wms.js'));

let passed = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

// 1. Config sync & full source/verified coverage
check(JSON.stringify(vehiclesJson) === JSON.stringify(vehiclesJs), 'vehicles.json and vehicles_data.js match exactly');
check(JSON.stringify(tacticalJson) === JSON.stringify(tacticalJs), 'tactical_config.json and tactical_config_data.js match exactly');
check(JSON.stringify(cutoutsJson) === JSON.stringify(cutoutsJs), 'eva_cutouts.json and eva_cutouts_data.js match exactly');

for (const [k, eff] of Object.entries(vehiclesJson.effects)) {
  check(typeof eff.verified === 'boolean' && typeof eff.source === 'string' && eff.source.length > 5, `effect ${k} has verified & source`);
}
for (const cls of Object.values(vehiclesJson.classes)) {
  check(typeof cls.baseMassKg.verified === 'boolean' && cls.baseMassKg.source.length > 5, `${cls.id} baseMassKg documented`);
  check(typeof cls.speedKmh.verified === 'boolean' && cls.speedKmh.source.length > 5, `${cls.id} speedKmh documented`);
  check(typeof cls.extraLoadKg.verified === 'boolean' && cls.extraLoadKg.source.length > 5, `${cls.id} extraLoadKg documented`);
  check(typeof cls.slopeLimitDeg.verified === 'boolean' && cls.slopeLimitDeg.source.length > 5, `${cls.id} slopeLimitDeg documented`);
  if (cls.id === 'manned_rover') {
    check(cls.concept === true, 'manned_rover flagged concept=true');
    check(cls.baseMassKg.source.includes('CONCEPT'), 'manned_rover mass marked CONCEPT');
    check(cls.speedKmh.source.includes('CONCEPT'), 'manned_rover speed marked CONCEPT');
    check(cls.extraLoadKg.source.includes('CONCEPT'), 'manned_rover extraLoad marked CONCEPT');
    check(cls.slopeLimitDeg.source.includes('CONCEPT'), 'manned_rover slopeLimit marked CONCEPT');
  }
}
check(vehiclesJson.classes.mini_rover.slopeLimitDeg.verified === false, 'mini_rover ~20 deg seed explicitly marked unverified');
check(Object.keys(tacticalJson.geologySim3292.units).length === 44, 'all 44 official USGS SIM 3292 geologic units mapped');

// 2. Cutout bundles (all 4 preset zones offline, 40x40 = 1600 cells)
for (const zid of ['jezero_delta', 'gale_boxwork', 'nili_fossae', 'arcadia_ice']) {
  const z = cutoutsJson.zones[zid];
  check(z && z.gridN === 40 && z.elevM.length === 1600 && z.slopeDeg.length === 1600 && z.ti.length === 1600, `preset cutout ${zid} has 40x40=1600 cells`);
  check(typeof z.ctxImgDataUri === 'string' && z.ctxImgDataUri.startsWith('data:image/png;base64,'), `preset cutout ${zid} embeds real CTX PNG`);
  const eSpread = Math.max(...z.elevM) - Math.min(...z.elevM);
  check(eSpread > 1.0, `preset cutout ${zid} has non-flat real elevation variation (${eSpread.toFixed(1)} m)`);
}

// 3. Mars24 Date -> Ls / Mars Year algorithm verification
const percTime = MARS_TIME.computeMarsTime('2021-02-18T20:55:00Z', 77.45);
check(percTime.marsYear === 36 && Math.abs(percTime.lsDeg - 5.2) < 1.5, `Perseverance landing MY36 Ls ~5.2° (got MY${percTime.marsYear} Ls ${percTime.lsDeg.toFixed(2)}°)`);
const curTime = MARS_TIME.computeMarsTime('2012-08-06T05:17:00Z', 137.44);
check(curTime.marsYear === 31 && Math.abs(curTime.lsDeg - 150.7) < 1.5, `Curiosity landing MY31 Ls ~150.7° (got MY${curTime.marsYear} Ls ${curTime.lsDeg.toFixed(2)}°)`);

// 4. Location validation & longitude convention tests
const locGood360 = ENGINE.validateLocation(18.38, 355.0, '0_360', tacticalJson);
check(locGood360.valid && Math.abs(locGood360.lon180 - (-5)) < 1e-4, '0..360 E lon=355 normalizes to -5 in -180..180');
const locBadLat = ENGINE.validateLocation(95, 10, '-180_180', tacticalJson);
check(!locBadLat.valid, 'rejects lat > 90');
const locBadLon180 = ENGINE.validateLocation(0, 200, '-180_180', tacticalJson);
check(!locBadLon180.valid, 'rejects lon > 180 when -180..180 selected');
const boxSpanLatDeg = locGood360.bbox180[3] - locGood360.bbox180[1];
const boxSpanKmY = boxSpanLatDeg * tacticalJson.planet.degToMeters.value / 1000;
check(Math.abs(boxSpanKmY - 4.0) < 0.05, `4 km N-S box span verified (${boxSpanKmY.toFixed(3)} km)`);

// 5. Vehicle slider clamping + class reset rules
const clampedMini = ENGINE.resolveVehicleConfig(vehiclesJson, 'mini_rover', { speedKmh: 99, extraLoadKg: 500, powerMode: 'nuclear' }, false);
check(clampedMini.speedKmh === 0.04 && clampedMini.extraLoadKg === 5 && clampedMini.powerMode === 'solar', 'mini_rover clamps sliders & locks solar power');
const resetManned = ENGINE.resolveVehicleConfig(vehiclesJson, 'manned_rover', { speedKmh: 0.01, extraLoadKg: 1 }, true);
check(resetManned.speedKmh === 8 && resetManned.extraLoadKg === 400 && resetManned.selectablePowerModes.length === 3, 'manned_rover reset restores defaults and offers battery/nuclear/solar');

// 6. Grid generation: 100% User blend uniformity vs 50/50 real orbital variation
const baseInputs = ENGINE.getDefaultInputs(vehiclesJson, tacticalJson);
const uniformRes = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'jezero_delta', lat: 18.38, lonInput: 77.58, orbitalBlendWeight: 0 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
check(uniformRes.ok && uniformRes.summary.minScore === uniformRes.summary.maxScore, `orbitalBlendWeight=0 produces uniform grid (min=${uniformRes.summary.minScore}, max=${uniformRes.summary.maxScore})`);

const blendedRes = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'jezero_delta', lat: 18.38, lonInput: 77.58, orbitalBlendWeight: 0.5 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
check(blendedRes.ok && blendedRes.summary.maxScore > blendedRes.summary.minScore, `orbitalBlendWeight=0.5 blends real orbital variance (${blendedRes.summary.minScore}..${blendedRes.summary.maxScore})`);
check(blendedRes.nativeResLabel.includes('100') && blendedRes.nativeResLabel.includes('non-spatial'), 'resolution label honestly reports 100 m & non-spatial 60 s ML layer');

// 7. Qualitative vehicle effects (mass/sinkage/speed) & dust-storm solar vs nuclear
const miniClear = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, vehicleClass: 'mini_rover', tau: 0.5, ltstHours: 12 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
const miniStorm = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, vehicleClass: 'mini_rover', tau: 10.8, ltstHours: 12 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
check(
  miniStorm.vehicleTelemetry.availPowerW < miniClear.vehicleTelemetry.availPowerW * 0.05,
  `tau=10.8 collapses mini_rover solar output (${miniClear.vehicleTelemetry.availPowerW} W -> ${miniStorm.vehicleTelemetry.availPowerW} W)`
);

const nucWarm = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'gale_boxwork', lat: -5.08, lonInput: 137.85, vehicleClass: 'lab_rover', tau: 0.5, ltstHours: 13 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
const nucStormCold = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'arcadia_ice', lat: 39.2, lonInput: -175.0, vehicleClass: 'lab_rover', tau: 10.8, ltstHours: 3 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
check(nucStormCold.vehicleTelemetry.availPowerW === nucWarm.vehicleTelemetry.availPowerW, 'MMRTG gross power unaffected by tau=10.8');
check(nucStormCold.vehicleTelemetry.heaterW > nucWarm.vehicleTelemetry.heaterW, `colder conditions raise nuclear heater draw (${nucWarm.vehicleTelemetry.heaterW} W -> ${nucStormCold.vehicleTelemetry.heaterW} W)`);

const galeLight = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'gale_boxwork', lat: -5.08, lonInput: 137.85, vehicleClass: 'manned_rover', extraLoadKg: 0, speedKmh: 8, orbitalBlendWeight: 1 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
const galeHeavy = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'gale_boxwork', lat: -5.08, lonInput: 137.85, vehicleClass: 'manned_rover', extraLoadKg: 1000, speedKmh: 8, orbitalBlendWeight: 1 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
const galeSlow = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'gale_boxwork', lat: -5.08, lonInput: 137.85, vehicleClass: 'manned_rover', extraLoadKg: 400, speedKmh: 2, orbitalBlendWeight: 1 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
const galeFast = ENGINE.generateAnalysis({
  inputs: { ...baseInputs, presetZoneId: 'gale_boxwork', lat: -5.08, lonInput: 137.85, vehicleClass: 'manned_rover', extraLoadKg: 400, speedKmh: 15, orbitalBlendWeight: 1 },
  cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM,
});
check(galeHeavy.vehicleTelemetry.energyPerKmWh > galeLight.vehicleTelemetry.energyPerKmWh, `higher payload increases energy/km (${galeLight.vehicleTelemetry.energyPerKmWh} -> ${galeHeavy.vehicleTelemetry.energyPerKmWh})`);
check(galeHeavy.vehicleTelemetry.avgSinkagePenalty > galeLight.vehicleTelemetry.avgSinkagePenalty, `higher mass increases sinkage penalty on low-TI loose regolith (${galeLight.vehicleTelemetry.avgSinkagePenalty} -> ${galeHeavy.vehicleTelemetry.avgSinkagePenalty})`);
check(galeFast.vehicleTelemetry.traverse4KmHours < galeSlow.vehicleTelemetry.traverse4KmHours, 'higher speed reduces traverse time');
check(galeFast.vehicleTelemetry.avgSpeedRiskPenalty > galeSlow.vehicleTelemetry.avgSpeedRiskPenalty, 'higher speed increases risk penalty on rough cells');

// 8. NASA HLS-2015 veto & vehicle slope limit = 0
const dummyVeh = ENGINE.resolveVehicleConfig(vehiclesJson, 'lab_rover', {}, true);
const normW = SCORING.normalize({ thermal: 1, radiation: 1, topography: 1, optics: 1, geology: 1, elevSlope: 1, dust: 1 });
const mockSc = { thermal: 85, radiation: 85, topography: 85, optics: 85, geology: 85, elevSlope: 85, dust: 85 };
check(ENGINE.evaluateFinalCompatibility(mockSc, { elevM: 2500, lat: 0, slopeDeg: 2 }, dummyVeh, normW, 'weighted', tacticalJson).finalScore === 0, 'NASA veto elev > +2000 m forces cell score 0');
check(ENGINE.evaluateFinalCompatibility(mockSc, { elevM: -500, lat: 55, slopeDeg: 2 }, dummyVeh, normW, 'weighted', tacticalJson).finalScore === 0, 'NASA veto |lat| > 50 deg forces cell score 0');
check(ENGINE.evaluateFinalCompatibility(mockSc, { elevM: -500, lat: 0, slopeDeg: 32 }, dummyVeh, normW, 'weighted', tacticalJson).finalScore === 0, 'Slope above vehicle limit forces cell score 0');

// No compensation (geometric mean) drags down when one domain is near-zero
const weakDomainSc = { thermal: 95, radiation: 95, topography: 95, optics: 95, geology: 95, elevSlope: 95, dust: 2 };
const wSum = ENGINE.evaluateFinalCompatibility(weakDomainSc, { elevM: -500, lat: 0, slopeDeg: 2 }, dummyVeh, normW, 'weighted', tacticalJson).finalScore;
const nComp = ENGINE.evaluateFinalCompatibility(weakDomainSc, { elevM: -500, lat: 0, slopeDeg: 2 }, dummyVeh, normW, 'nocomp', tacticalJson).finalScore;
check(nComp < wSum - 15, `geometric mean (nocomp=${nComp}) strongly penalizes weak factor vs weighted sum (${wSum})`);

// 9. Radiation solar cycle / SPE, separated GRS K/Th, & zero fake instrument claims on Nili Fossae
const radMin = ENGINE.generateAnalysis({ inputs: { ...baseInputs, presetZoneId: 'nili_fossae', lat: 21, lonInput: 74, solarCycle: 'min', speActive: false }, cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM });
const radMax = ENGINE.generateAnalysis({ inputs: { ...baseInputs, presetZoneId: 'nili_fossae', lat: 21, lonInput: 74, solarCycle: 'max', speActive: false }, cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM });
const radSpe = ENGINE.generateAnalysis({ inputs: { ...baseInputs, presetZoneId: 'nili_fossae', lat: 21, lonInput: 74, solarCycle: 'max', speActive: true }, cutouts: cutoutsJson, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM });
check(radMin.grids.gcrMSvYr[0] > radMax.grids.gcrMSvYr[0], 'Solar min GCR dose exceeds Solar max');
check(radSpe.grids.radiation[0] < radMax.grids.radiation[0], 'Active SPE reduces Radiation suitability score');

const niliPopup = ENGINE.getCellPopup(radMin, 820);
const grsDom = niliPopup.domains.find((d) => d.key === 'groundComp');
check(grsDom && grsDom.score === null && /coarse/i.test(grsDom.label), 'GRS K/Th separated as unscored coarse orbital composition');
const popupTxt = JSON.stringify(niliPopup);
check(!/SuperCam|SHERLOC|PIXL|Mastcam|AutoNav|REMS/i.test(popupTxt), 'No rover instrument claims attributed to unvisited Nili Fossae');

// 10. Global fallback & JSON/GeoJSON exports
const fbRes = ENGINE.generateAnalysis({ inputs: { ...baseInputs, presetZoneId: 'custom', lat: 10.5, lonInput: -40.2 }, cutouts: cutoutsJson, layers: null, vehiclesCfg: vehiclesJson, tacticalCfg: tacticalJson, marsTime: MARS_TIME, scoring: SCORING, storm: STORM });
check(fbRes.ok && fbRes.isLowResGrid && fbRes.grids.final.length === 1600, 'Coarse offline fallback succeeds cleanly anywhere on Mars');
const expJson = ENGINE.exportAnalysisJSON(blendedRes);
const expGeo = ENGINE.exportAnalysisGeoJSON(blendedRes);
check(expJson.grid.final.length === 1600 && expGeo.features.length === 1601, 'JSON/GeoJSON export contains 16 km2 bounds + all 1600 cells');

// 11. /api/wms VICAR little-endian IEEE parser unit test
const vicarHdr = "LBLSIZE=128          FORMAT='REAL'  TYPE='IMAGE'  NS=2  NL=2  NBB=0  NLB=0  RECSIZE=8  INTFMT='LOW'  REALFMT='RIEEE'  ";
const hdrBuf = Buffer.alloc(128, ' ');
hdrBuf.write(vicarHdr, 0, 'latin1');
const pixBuf = Buffer.alloc(16);
pixBuf.writeFloatLE(-123.5, 0);
pixBuf.writeFloatLE(45.25, 4);
pixBuf.writeFloatLE(0.0, 8);
pixBuf.writeFloatLE(999.0, 12);
const parsedVicar = wmsProxy.parseVicar(Buffer.concat([hdrBuf, pixBuf]));
check(parsedVicar.width === 2 && parsedVicar.height === 2 && parsedVicar.values[0] === -123.5 && parsedVicar.values[3] === 999, 'api/wms VICAR little-endian REAL parser decodes cleanly');
check(wmsProxy.ALLOWED_LAYERS.has('thm_ti_100m_32bit'), 'api/wms whitelist includes thm_ti_100m_32bit');

console.log(`All ${passed} Tactical EVA 16 km2 unit/model/config/VICAR assertions passed.`);
