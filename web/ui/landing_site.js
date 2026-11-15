// Left-click custom landing site setup, rover+environment range model, and suitability penalty breakdown.
(function (global) {
  'use strict';

  const DEFAULT_MARS_R_KM = 3389.5;
  const DEFAULT_MARS_G = 3.72076;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  function normLon180(lon) {
    let x = ((lon + 180) % 360 + 360) % 360 - 180;
    return x === -180 && lon > 0 ? 180 : x;
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pick(tr, key, args) {
    const i18n = global.MDE_I18N || (typeof require === 'function' ? (() => { try { return require('./i18n.js'); } catch (_) { return null; } })() : null);
    if (i18n && typeof i18n.pick === 'function') return i18n.pick(tr, key, args);
    return key;
  }

  /**
   * Compute spherical small-circle boundary points (lat, lon) around a Mars center.
   * Because points live in planetary coordinates (lat, lon) rather than screen pixels,
   * zooming or panning scales the circle proportionally to the Martian surface.
   */
  function circleLatLons(latDeg, lonDeg, radiusKm, planetRadiusKm = DEFAULT_MARS_R_KM, steps = 72) {
    if (!(radiusKm > 0)) return [];
    const rPlanet = planetRadiusKm > 0 ? planetRadiusKm : DEFAULT_MARS_R_KM;
    const ang = Math.min(Math.PI * 0.95, radiusKm / rPlanet);
    const lat1 = Math.max(-89.9, Math.min(89.9, latDeg)) * DEG2RAD;
    const lon1 = lonDeg * DEG2RAD;
    const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
    const sinAng = Math.sin(ang), cosAng = Math.cos(ang);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const brg = (i / steps) * Math.PI * 2;
      const sinLat2 = sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brg);
      const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
      const y = Math.sin(brg) * sinAng * cosLat1;
      const x = cosAng - sinLat1 * sinLat2;
      const lon2 = lon1 + Math.atan2(y, x);
      pts.push([lat2 * RAD2DEG, normLon180(lon2 * RAD2DEG)]);
    }
    return pts;
  }

  // Shared vehicle helpers (used by the range circle AND the Rover-route traverse estimate so the
  // two always agree).
  const DEFAULT_SOL_H = 24.66;

  function solHoursOf(PLANET) {
    return PLANET && PLANET.solHours && PLANET.solHours.value > 0 ? PLANET.solHours.value : DEFAULT_SOL_H;
  }

  // Heavier vehicles sink deeper into loose regolith. Same sub-linear mass law the Tactical EVA
  // engine uses: (totalMass / refMass)^exponent, parameters from vehicles.json (unverified assumption).
  function sinkageMassRatio(totalMassKg, eff) {
    const ref = eff.sinkageMassRefKg ? eff.sinkageMassRefKg.value : 1000;
    const ex = eff.sinkageMassExponent ? eff.sinkageMassExponent.value : 0.35;
    return Math.pow(Math.max(1, totalMassKg) / ref, ex);
  }

  function driveHoursOf(rover, override) {
    const dflt = rover.driveHoursPerSol && rover.driveHoursPerSol.default > 0 ? rover.driveHoursPerSol.default : 2;
    const h = override != null && override > 0 ? override : dflt;
    return Math.max(0.5, Math.min(12, h));
  }

  function computeRoverRange(cellValues, rover, opts) {
    const { VEHICLES, STORM, PLANET, ls = 251, tr = false } = opts;
    const eff = VEHICLES.effects || {};
    const gravity = PLANET && PLANET.gravityMs2 && PLANET.gravityMs2.value > 0 ? PLANET.gravityMs2.value : DEFAULT_MARS_G;
    const solH = solHoursOf(PLANET);
    const baseMass = rover.baseMassKg ? rover.baseMassKg.value : 1000;
    const extraMass = rover.extraLoadKg ? (rover.extraLoadKg.default || 0) : 0;
    const totalMassKg = baseMass + extraMass;
    const speedKmh = rover.speedKmh ? rover.speedKmh.default : 0.1;
    const driveH = driveHoursOf(rover);
    const slopeLimitDeg = rover.slopeLimitDeg ? rover.slopeLimitDeg.value : 15;
    const pwr = rover.power || {};
    const powerMode = pwr.defaultMode || (pwr.mode && pwr.mode.value) || 'battery';
    const hotelW = pwr.hotelPowerW ? pwr.hotelPowerW.value : 60;

    const slopeDeg = Math.max(0, cellValues.slope || 0);
    const roughM = Math.max(0, cellValues.rough || 0);
    const tiVal = cellValues.ti != null ? cellValues.ti : 220;
    const dustNorm = cellValues.dust != null ? cellValues.dust : 0.18;
    const localTau = +(0.5 + dustNorm * 1.4).toFixed(2);
    const temp = STORM && STORM.surfaceTempC
      ? STORM.surfaceTempC(cellValues.lat, ls, cellValues.ti, cellValues.elev, localTau)
      : { mean: -63, night: -90, day: -20 };
    const dailySolarKwhM2 = STORM && STORM.dailySolar
      ? STORM.dailySolar(cellValues.lat, localTau, ls)
      : 2.2;

    // Terrain and environmental resistance factors
    const tiLooseThresh = eff.tiLooseThreshold ? eff.tiLooseThreshold.value : 200;
    const looseBase = tiVal < 100 ? 1.9 : tiVal < tiLooseThresh ? 1.4 : 1.0;
    const massRatio = sinkageMassRatio(totalMassKg, eff);
    // Loose-soil drag scales with vehicle mass (a 11 kg micro-rover does not bog like a 5 t crew rover);
    // hard rock adds a small vibration/scuffing cost independent of mass.
    const tiMult = tiVal > 450 ? 1.15 : 1 + (looseBase - 1) * massRatio;
    const tiTag = tiVal < 100
      ? pick(tr, 'ls.tiDust')
      : tiVal < tiLooseThresh
        ? pick(tr, 'ls.tiSand')
        : tiVal > 450
          ? pick(tr, 'ls.tiRock')
          : pick(tr, 'ls.tiFirm');

    const slipDelta = tiVal < 100 ? -2.5 : tiVal < 150 ? -1.2 : 0;
    const effSlopeLimit = Math.max(5, +(slopeLimitDeg + slipDelta).toFixed(1));
    const slopeFactor = Math.max(0.25, 1 - 0.65 * (slopeDeg / effSlopeLimit));
    const tiMobility = 1 / Math.sqrt(tiMult);
    const roughFactor = 1 + Math.min(0.65, Math.max(0, roughM - 30) / 280);
    const roughMobility = 1 / roughFactor;
    const dustVisFactor = 1 - Math.min(0.28, Math.max(0, dustNorm - 0.15) * 0.40);
    // Terrain & hazard suitability factor slows ground progress and stretches avionics/heater burn per km
    const terrainMobility = Math.max(0.18, Math.min(1.0, slopeFactor * tiMobility * roughMobility * dustVisFactor));
    const effectiveSpeedKmh = speedKmh * terrainMobility;

    const massCoeff = eff.massEnergyCoeffWhPerKgKm ? eff.massEnergyCoeffWhPerKgKm.value : 0.28;
    const gradeEta = eff.gradeWorkEfficiency ? eff.gradeWorkEfficiency.value : 0.65;
    const climbWhKm = (totalMassKg * gravity * Math.sin(slopeDeg * DEG2RAD) * 1000) / (3600 * gradeEta);

    const heaterBase = eff.heaterBaseTempC ? eff.heaterBaseTempC.value : 0;
    const heaterCoeff = eff.nuclearHeaterWPerKgDegC ? eff.nuclearHeaterWPerKgDegC.value : 0.0018;
    const coldDelta = Math.max(0, heaterBase - temp.mean);
    const heaterW = coldDelta * heaterCoeff * totalMassKg;

    const tractionWhKm = (totalMassKg * massCoeff * tiMult + climbWhKm) * roughFactor;
    // Hotel + heater power is burned for as long as the vehicle is moving: Wh/km = W / (km/h).
    const hotelWhKm = (hotelW + heaterW) / Math.max(0.003, effectiveSpeedKmh);
    const effWhKm = tractionWhKm + hotelWhKm;

    const slopeBlocked = slopeDeg > effSlopeLimit;
    let rangeKm = 0;
    let basisLabel = '';
    let energyDetail = '';
    let kmPerSol = null;
    let limitedBy = null;
    let roundTripRadiusKm = null;

    if (!slopeBlocked) {
      if (powerMode === 'battery') {
        const capWh = (pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : 60) * 1000;
        rangeKm = +(capWh / Math.max(1, effWhKm)).toFixed(1);
        // A battery sortie has to come back: the return-capable radius is half the one-way distance.
        roundTripRadiusKm = +(rangeKm / 2).toFixed(1);
        basisLabel = pick(tr, 'ls.basisBattery', [(capWh / 1000).toFixed(0)]);
        energyDetail = `${Math.round(effWhKm)} Wh/km · ${pick(tr, 'ls.returnRadius', [roundTripRadiusKm.toFixed(1)])}`;
      } else if (powerMode === 'nuclear') {
        const genW = pwr.ratedPowerW ? pwr.ratedPowerW.value : 110;
        const campaignSols = 30;
        // Daily MMRTG energy minus the hotel load that keeps running while parked; the hotel load while
        // driving is already inside effWhKm, so it is not subtracted twice.
        const dailyGrossWh = genW * solH;
        const idleHotelWh = hotelW * Math.max(0, solH - driveH);
        const coldOverhead = Math.max(0, heaterW - hotelW * 0.5);
        const thermalDriveFactor = Math.max(0.40, 1 - coldOverhead / Math.max(120, genW * 3.5));
        const kinematicKmSol = effectiveSpeedKmh * driveH * thermalDriveFactor;
        const energyKmSol = Math.max(0, dailyGrossWh - idleHotelWh) / Math.max(1, effWhKm);
        kmPerSol = Math.min(energyKmSol, kinematicKmSol);
        limitedBy = energyKmSol < kinematicKmSol ? 'power' : 'drive';
        rangeKm = +(kmPerSol * campaignSols).toFixed(1);
        basisLabel = pick(tr, 'ls.basisNuclear', [campaignSols]);
        energyDetail = `${kmPerSol.toFixed(2)} km/sol (${pick(tr, limitedBy === 'power' ? 'ls.limPower' : 'ls.limDrive')}) · ${Math.round(effWhKm)} Wh/km`;
      } else {
        const solarArea = pwr.solarAreaM2 ? pwr.solarAreaM2.value : 0.22;
        const solarEta = eff.solarPanelEfficiency ? eff.solarPanelEfficiency.value : 0.26;
        const campaignSols = 30;
        const dailySolarWh = dailySolarKwhM2 * 1000 * solarArea * solarEta;
        const solarWindowFactor = Math.max(0.15, Math.min(1.15, dailySolarKwhM2 / 2.5));
        const kinematicKmSol = effectiveSpeedKmh * driveH * solarWindowFactor;
        // Hotel power while driving is part of effWhKm; the former extra "daytime hotel" deduction
        // counted the same watts twice and understated the energy-limited distance.
        const energyKmSol = dailySolarWh / Math.max(1, effWhKm);
        kmPerSol = Math.min(energyKmSol, kinematicKmSol);
        limitedBy = energyKmSol < kinematicKmSol ? 'power' : 'drive';
        rangeKm = +(kmPerSol * campaignSols).toFixed(1);
        basisLabel = pick(tr, 'ls.basisSolar', [campaignSols]);
        energyDetail = `${Math.round(dailySolarWh)} Wh/sol (τ ${localTau} · Ls ${Math.round(ls)}°) · ${kmPerSol.toFixed(2)} km/sol (${pick(tr, limitedBy === 'power' ? 'ls.limPower' : 'ls.limDrive')})`;
      }
    } else {
      basisLabel = pick(tr, 'ls.basisBlocked', [slopeDeg.toFixed(1), effSlopeLimit]);
      energyDetail = `${Math.round(effWhKm)} Wh/km`;
    }

    const envPenalties = [];
    if (slopeBlocked) {
      envPenalties.push(pick(tr, 'ls.envSlopeBlock', [slopeDeg.toFixed(1), effSlopeLimit]));
    } else if (slopeDeg > 4) {
      envPenalties.push(pick(tr, 'ls.envSlopeDrag', [slopeDeg.toFixed(1), Math.round(climbWhKm)]));
    }
    if (terrainMobility < 0.88) {
      const spdTxt = effectiveSpeedKmh < 0.1 ? effectiveSpeedKmh.toFixed(3) : effectiveSpeedKmh < 2 ? effectiveSpeedKmh.toFixed(2) : effectiveSpeedKmh.toFixed(1);
      envPenalties.push(pick(tr, 'ls.envMobility', [Math.round(terrainMobility * 100), spdTxt]));
    }
    if (tiMult > 1.05) {
      envPenalties.push(pick(tr, 'ls.envSinkage', [Math.round(tiVal), tiTag, tiMult.toFixed(2)]));
    }
    if (roughFactor > 1.04) {
      envPenalties.push(pick(tr, 'ls.envRough', [Math.round(roughM), Math.round((roughFactor - 1) * 100)]));
    }
    if (heaterW > hotelW * 0.08) {
      envPenalties.push(pick(tr, 'ls.envCold', [Math.round(temp.mean), Math.round(heaterW)]));
    }
    if (powerMode === 'solar' && (localTau > 0.7 || Math.abs(cellValues.lat) > 35)) {
      envPenalties.push(pick(tr, 'ls.envSolarLoss', [localTau, dailySolarKwhM2.toFixed(2)]));
    }

    return {
      roverId: rover.id,
      roverName: tr ? (rover.name_tr || rover.name) : rover.name,
      isConcept: !!rover.concept,
      slopeBlocked,
      slopeLimitDeg: effSlopeLimit,
      rangeKm,
      roundTripRadiusKm,
      kmPerSol: kmPerSol == null ? null : +kmPerSol.toFixed(3),
      limitedBy,
      driveHoursPerSol: driveH,
      lsDeg: Math.round(ls),
      basisLabel,
      energyDetail,
      effWhKm: +effWhKm.toFixed(1),
      localTau,
      tempMeanC: Math.round(temp.mean),
      dailySolarKwhM2: +dailySolarKwhM2.toFixed(2),
      tiMult,
      roughFactor: +roughFactor.toFixed(2),
      envPenalties,
    };
  }

  /**
   * Whole-route traverse estimate for one vehicle class (Rover route tab).
   * Uses the same per-km energy model as computeRoverRange, but fed with the A* route statistics
   * (distance, total ascent, mean slope, km on loose dust) instead of one map cell.
   * route: { km, totalAscentM, meanSlope, maxSlope, dustKm, meanElevM?, meanTi? }
   */
  function traverseEstimate(rover, route, opts) {
    const { VEHICLES, STORM, PLANET, ls = 251, lat = 0, tau = 0.6, driveHoursPerSol, tr = false } = opts;
    const eff = (VEHICLES && VEHICLES.effects) || {};
    const gravity = PLANET && PLANET.gravityMs2 && PLANET.gravityMs2.value > 0 ? PLANET.gravityMs2.value : DEFAULT_MARS_G;
    const solH = solHoursOf(PLANET);
    const km = Math.max(0, +route.km || 0);
    const totalMassKg = (rover.baseMassKg ? rover.baseMassKg.value : 1000) + (rover.extraLoadKg ? (rover.extraLoadKg.default || 0) : 0);
    const speedKmh = rover.speedKmh ? rover.speedKmh.default : 0.1;
    const driveH = driveHoursOf(rover, driveHoursPerSol);
    const slopeLimitDeg = rover.slopeLimitDeg ? rover.slopeLimitDeg.value : 15;
    const pwr = rover.power || {};
    const powerMode = pwr.defaultMode || (pwr.mode && pwr.mode.value) || 'battery';
    const hotelW = pwr.hotelPowerW ? pwr.hotelPowerW.value : 60;

    const looseFrac = km > 0 ? Math.max(0, Math.min(1, (route.dustKm || 0) / km)) : 0;
    const tiMult = 1 + 0.9 * sinkageMassRatio(totalMassKg, eff) * looseFrac; // 0.9 = loose-dust drag (1.9x) at full mass ratio
    const effSlopeLimit = Math.max(5, slopeLimitDeg - 2.5 * looseFrac);
    const meanSlope = Math.max(0, +route.meanSlope || 0);
    const slopeFactor = Math.max(0.25, 1 - 0.65 * (meanSlope / effSlopeLimit));
    const terrainMobility = Math.max(0.18, Math.min(1, slopeFactor / Math.sqrt(tiMult)));
    const effSpeedKmh = speedKmh * terrainMobility;

    const massCoeff = eff.massEnergyCoeffWhPerKgKm ? eff.massEnergyCoeffWhPerKgKm.value : 0.28;
    const gradeEta = eff.gradeWorkEfficiency ? eff.gradeWorkEfficiency.value : 0.65;
    // Exact climb work from the profile (m*g*dh/eta), not mean-slope * distance. Descent regeneration is ignored.
    const climbWhTotal = (totalMassKg * gravity * Math.max(0, route.totalAscentM || 0)) / (3600 * gradeEta);
    const climbWhKm = km > 0 ? climbWhTotal / km : 0;

    const temp = STORM && STORM.surfaceTempC
      ? STORM.surfaceTempC(lat, ls, route.meanTi != null ? route.meanTi : 215, route.meanElevM != null ? route.meanElevM : 0, tau)
      : { mean: -60 };
    const heaterBase = eff.heaterBaseTempC ? eff.heaterBaseTempC.value : 0;
    const heaterCoeff = eff.nuclearHeaterWPerKgDegC ? eff.nuclearHeaterWPerKgDegC.value : 0.0018;
    const heaterW = Math.max(0, heaterBase - temp.mean) * heaterCoeff * totalMassKg;

    const tractionWhKm = totalMassKg * massCoeff * tiMult + climbWhKm;
    const hotelWhKm = (hotelW + heaterW) / Math.max(0.003, effSpeedKmh);
    const effWhKm = tractionWhKm + hotelWhKm;
    const totalKwh = (effWhKm * km) / 1000;

    let kmPerSol = effSpeedKmh * driveH;
    let limitedBy = 'drive';
    let chargesRequired = null;
    const dailySolarKwhM2 = STORM && STORM.dailySolar ? STORM.dailySolar(lat, tau, ls) : 2.2;
    if (powerMode === 'nuclear') {
      const genW = pwr.ratedPowerW ? pwr.ratedPowerW.value : 110;
      const coldOverhead = Math.max(0, heaterW - hotelW * 0.5);
      const thermalDriveFactor = Math.max(0.40, 1 - coldOverhead / Math.max(120, genW * 3.5));
      const kin = effSpeedKmh * driveH * thermalDriveFactor;
      const energy = Math.max(0, genW * solH - hotelW * Math.max(0, solH - driveH)) / Math.max(1, effWhKm);
      kmPerSol = Math.min(kin, energy);
      limitedBy = energy < kin ? 'power' : 'drive';
    } else if (powerMode === 'solar') {
      const solarWh = dailySolarKwhM2 * 1000 * (pwr.solarAreaM2 ? pwr.solarAreaM2.value : 0.22) * (eff.solarPanelEfficiency ? eff.solarPanelEfficiency.value : 0.26);
      const kin = effSpeedKmh * driveH * Math.max(0.15, Math.min(1.15, dailySolarKwhM2 / 2.5));
      const energy = solarWh / Math.max(1, effWhKm);
      kmPerSol = Math.min(kin, energy);
      limitedBy = energy < kin ? 'power' : 'drive';
    } else {
      const capKwh = pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : 60;
      chargesRequired = km > 0 ? Math.max(1, Math.ceil(totalKwh / capKwh)) : 0;
    }
    kmPerSol = Math.max(1e-4, kmPerSol);
    const sols = km > 0 ? Math.max(1, Math.ceil(km / kmPerSol)) : 0;

    return {
      roverId: rover.id,
      roverName: tr ? (rover.name_tr || rover.name) : rover.name,
      isConcept: !!rover.concept,
      powerMode,
      driveHoursPerSol: driveH,
      kmPerSol: +(kmPerSol >= 1 ? kmPerSol.toFixed(1) : kmPerSol.toFixed(3)),
      sols,
      limitedBy,
      totalKwh: +totalKwh.toFixed(1),
      tractionKwh: +((totalMassKg * massCoeff * tiMult * km) / 1000).toFixed(1),
      climbKwh: +(climbWhTotal / 1000).toFixed(1),
      hotelKwh: +(((hotelW + heaterW) / Math.max(0.003, effSpeedKmh)) * km / 1000).toFixed(1),
      chargesRequired,
      batteryKwh: pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : null,
      terrainMobility: +terrainMobility.toFixed(2),
      effSpeedKmh: +effSpeedKmh.toFixed(3),
      slopeLimitDeg: +effSlopeLimit.toFixed(1),
      exceedsSlopeLimit: (+route.maxSlope || 0) > effSlopeLimit,
      lsDeg: Math.round(ls),
    };
  }

  /**
   * Simple survival power balance for one vehicle class during a dust storm (Dust-storm tab).
   * Survival load = hotel + survival heater, around the clock. Solar: clean panels at storm-peak tau
   * (optimistic: no dust-on-panel loss, no battery model). Nuclear: MMRTG output, independent of dust.
   * Battery-only: how many sols the pack lasts versus the storm length.
   * env: { lat, ls, tauPeak, storm: {riseSols, holdSols, decaySols}, VEHICLES, STORM, PLANET }
   */
  function roverStormPower(rover, env) {
    const { VEHICLES, STORM, PLANET, lat = 0, ls = 251, tauPeak = 8 } = env;
    const eff = (VEHICLES && VEHICLES.effects) || {};
    const solH = solHoursOf(PLANET);
    const pwr = rover.power || {};
    const mode = pwr.defaultMode || (pwr.mode && pwr.mode.value) || 'battery';
    const mass = (rover.baseMassKg ? rover.baseMassKg.value : 1000) + (rover.extraLoadKg ? (rover.extraLoadKg.default || 0) : 0);
    const hotelW = pwr.hotelPowerW ? pwr.hotelPowerW.value : 60;
    const st = env.storm || { riseSols: 10, holdSols: 40, decaySols: 30 };
    const stormSols = st.riseSols + st.holdSols + st.decaySols;
    const temp = STORM && STORM.surfaceTempC ? STORM.surfaceTempC(lat, ls, 215, 0, tauPeak) : { mean: -60 };
    const heaterBase = eff.heaterBaseTempC ? eff.heaterBaseTempC.value : 0;
    const heaterCoeff = eff.nuclearHeaterWPerKgDegC ? eff.nuclearHeaterWPerKgDegC.value : 0.0018;
    // An MMRTG rejects ~2 kW of heat that keeps the rover warm for free, so no electrical survival
    // heating is charged to it; solar and battery vehicles must pay for survival heat from their own power.
    const heaterW = mode === 'nuclear' ? 0 : Math.max(0, heaterBase - temp.mean) * heaterCoeff * mass;
    const loadW = hotelW + heaterW;
    const loadWhSol = loadW * solH;
    let genWhSol = 0;
    let autonomySols = null;
    if (mode === 'nuclear') {
      genWhSol = (pwr.ratedPowerW ? pwr.ratedPowerW.value : 110) * solH;
    } else if (mode === 'solar') {
      const area = pwr.solarAreaM2 ? pwr.solarAreaM2.value : 0.22;
      const eta = eff.solarPanelEfficiency ? eff.solarPanelEfficiency.value : 0.26;
      genWhSol = (STORM && STORM.dailySolar ? STORM.dailySolar(lat, tauPeak, ls) : 0) * 1000 * area * eta;
    } else {
      const capWh = (pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : 60) * 1000;
      autonomySols = loadWhSol > 0 ? capWh / loadWhSol : Infinity;
    }
    const survives = mode === 'battery' ? autonomySols >= stormSols : genWhSol >= loadWhSol;
    return {
      roverId: rover.id,
      roverName: rover.name,
      roverNameTr: rover.name_tr || rover.name,
      isConcept: !!rover.concept,
      mode,
      genWhSol: Math.round(genWhSol),
      loadWhSol: Math.round(loadWhSol),
      autonomySols: autonomySols == null ? null : +autonomySols.toFixed(1),
      stormSols,
      survives,
    };
  }

  /**
   * Compute full landing-site compatibility score, negative scoring factors, and rover+env range.
   */
  function analyzeSite(opts) {
    const {
      cellValues, roverId = 'manned_rover', weights, hard = true, ls = 251,
      regionName = '', SCORING, STORM, VEHICLES, PLANET, tr = false,
    } = opts;

    const classes = (VEHICLES && VEHICLES.classes) || {};
    const rover = classes[roverId] || classes.manned_rover || classes.lab_rover || Object.values(classes)[0];
    const wn = SCORING.normalize(weights || {});
    const rawScore = SCORING.scoreCell(cellValues, wn, false) * 100;

    const H = SCORING.HARD || { elevMax: 2000, slopeMax: 15, latMax: 50 };
    const vetoReasons = [];
    if (cellValues.elev > H.elevMax) vetoReasons.push(pick(tr, 'ls.vetoElev', [Math.round(cellValues.elev), H.elevMax]));
    if (cellValues.slope > H.slopeMax) vetoReasons.push(pick(tr, 'ls.vetoSlope', [cellValues.slope.toFixed(1), H.slopeMax]));
    if (Math.abs(cellValues.lat) > H.latMax) vetoReasons.push(pick(tr, 'ls.vetoLat', [Math.abs(cellValues.lat).toFixed(1), H.latMax]));
    const nasaVeto = !!(hard && vetoReasons.length > 0);
    const effectiveScore = nasaVeto ? 0 : +rawScore.toFixed(1);

    const critVal = (k) => {
      if (k === 'elev') return Math.round(cellValues.elev);
      if (k === 'slope') return +cellValues.slope.toFixed(1);
      if (k === 'ice') return cellValues.ice === null ? pick(tr, 'ls.noDataShort') : cellValues.ice.toFixed(2);
      if (k === 'rough') return Math.round(cellValues.rough);
      if (k === 'lat') return `${cellValues.lat.toFixed(1)}°`;
      if (k === 'ti') return cellValues.ti === null ? pick(tr, 'ls.noDataShort') : Math.round(cellValues.ti);
      if (k === 'rad') return Math.round(cellValues.rad);
      if (k === 'cave') return cellValues.cave === null ? '>1000' : Math.round(cellValues.cave);
      return '';
    };

    const critF = (k) => {
      if (k === 'rad') return SCORING.F.rad(cellValues.elev, cellValues.slope || 0);
      if (k === 'cave') return SCORING.F.cave(cellValues.cave != null ? cellValues.cave : null);
      return SCORING.F[k](cellValues[k]);
    };

    const critLabel = (c) => {
      const lbl = pick(tr, 'crit.' + c.key);
      return lbl !== 'crit.' + c.key ? lbl : c.label;
    };

    const negativeFactors = [];
    for (const c of SCORING.CRITERIA) {
      const w = wn[c.key] || 0;
      if (w <= 0) continue;
      const f = critF(c.key);
      const lossPts = (1 - f) * w * 100;
      if (lossPts >= 0.25) {
        negativeFactors.push({
          key: c.key,
          label: critLabel(c),
          valueText: `${critVal(c.key)}${c.unit ? ' ' + c.unit : ''}`.trim(),
          factorScore: +f.toFixed(2),
          weightPct: Math.round(w * 100),
          lossPts: +lossPts.toFixed(1),
        });
      }
    }
    negativeFactors.sort((a, b) => b.lossPts - a.lossPts);

    const rangeInfo = computeRoverRange(cellValues, rover, { VEHICLES, STORM, PLANET, ls, tr });
    const planetRadiusKm = PLANET && PLANET.radiusKm && PLANET.radiusKm.value > 0
      ? PLANET.radiusKm.value
      : DEFAULT_MARS_R_KM;

    return {
      lat: cellValues.lat,
      lon: cellValues.lon,
      regionName,
      rawScore: +rawScore.toFixed(1),
      effectiveScore,
      nasaVeto,
      vetoReasons,
      negativeFactors,
      rover: rangeInfo,
      rangeKm: rangeInfo.rangeKm,
      circlePts: circleLatLons(cellValues.lat, cellValues.lon, rangeInfo.rangeKm, planetRadiusKm, 72),
    };
  }

  /**
   * Bind the dedicated Landing Site Planner tab panel (#panel-landing).
   */
  function createController(opts) {
    const {
      doc = global.document, S, layers, SCORING, STORM, VEHICLES, PLANET, FMT,
      onDraw, onClose, onUseEva, onPlanMarswalk, onUseCrisis,
    } = opts;

    const card = doc.getElementById('landing-setup-card');
    const emptyEl = doc.getElementById('ls-empty');
    const closeBtn = doc.getElementById('ls-close-btn');
    const coordEl = doc.getElementById('ls-coord');
    const regionEl = doc.getElementById('ls-region');
    const roverSel = doc.getElementById('ls-rover-select');
    const roverSeg = doc.getElementById('ls-rover-seg');
    const rangeValEl = doc.getElementById('ls-range-val');
    const rangeBasisEl = doc.getElementById('ls-range-basis');
    const rangeEnvEl = doc.getElementById('ls-range-env');
    const compatScoreEl = doc.getElementById('ls-compat-score');
    const compatStatusEl = doc.getElementById('ls-compat-status');
    const factorsEl = doc.getElementById('ls-factors-list');
    const metricsKvEl = doc.getElementById('ls-metrics-kv');
    const summaryEl = doc.getElementById('ls-summary-body');
    const walkEl = doc.getElementById('ls-walk-body');
    const stormEl = doc.getElementById('ls-storm-body');
    const btnEva = doc.getElementById('ls-btn-eva');
    const btnWalk = doc.getElementById('ls-btn-walk');
    const btnStorm = doc.getElementById('ls-btn-storm');

    let roverId = 'manned_rover';

    const isTr = () => {
      const i18n = global.MDE_I18N;
      return i18n && i18n.getLang ? i18n.getLang() === 'tr' : false;
    };

    function syncRoverUI() {
      if (roverSel && roverSel.value !== roverId) roverSel.value = roverId;
      if (roverSeg) {
        roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
          const on = b.dataset.rover === roverId;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    }

    function populateRoverSelect() {
      if (!VEHICLES || !VEHICLES.classes) return;
      const tr = isTr();
      const prev = (roverSel && roverSel.value) || roverId;
      if (roverSel) {
        roverSel.innerHTML = '';
        for (const cls of Object.values(VEHICLES.classes)) {
          const opt = doc.createElement('option');
          opt.value = cls.id;
          const label = tr ? (cls.name_tr || cls.name) : cls.name;
          const spd = cls.speedKmh ? cls.speedKmh.default : '';
          opt.textContent = cls.concept
            ? `${label} (${spd} km/h · ${pick(tr, 'ls.conceptTag')})`
            : `${label} (${spd} km/h)`;
          roverSel.appendChild(opt);
        }
        if (VEHICLES.classes[prev]) roverSel.value = prev;
        roverId = roverSel.value || 'manned_rover';
      }
      if (roverSeg) {
        const segLabels = {
          manned_rover: pick(tr, 'ls.segManned'),
          lab_rover: pick(tr, 'ls.segLab'),
          mini_rover: pick(tr, 'ls.segMini'),
        };
        roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
          if (segLabels[b.dataset.rover]) b.textContent = segLabels[b.dataset.rover];
        });
      }
      syncRoverUI();
    }

    function buildSiteSummary(v, res, tr) {
      const ice = SCORING.calcIceAccess ? SCORING.calcIceAccess(v.ice, S.iceBand || 'ice15') : { status: 'NO_DATA' };
      const terrain = SCORING.calcTerrainClass ? SCORING.calcTerrainClass(v.slope, v.rough) : { terrainClass: 'MODERATE' };
      const terrainLbl = tr
        ? ({ SMOOTH: 'düzgün', MODERATE: 'orta engebeli', RUGGED: 'engebeli' }[terrain.terrainClass] || 'orta')
        : ({ SMOOTH: 'smooth', MODERATE: 'moderate', RUGGED: 'rugged' }[terrain.terrainClass] || 'moderate');
      const iceLbl = tr
        ? ({ LIKELY: 'buz muhtemel', POSSIBLE: 'buz olasılığı orta', UNLIKELY: 'buz zayıf', NO_DATA: 'SWIM kapsama dışı' }[ice.status] || '')
        : ({ LIKELY: 'subsurface ice likely', POSSIBLE: 'mixed ice signal', UNLIKELY: 'ice unlikely', NO_DATA: 'outside SWIM coverage' }[ice.status] || '');
      if (res.nasaVeto) {
        return pick(tr, 'ls.sumVetoed', [res.vetoReasons.join('; '), terrainLbl, iceLbl]);
      }
      return pick(tr, 'ls.sumOk', [terrainLbl, v.slope.toFixed(1), Math.round(v.elev), iceLbl]);
    }

    function render() {
      if (!S.customLanding || !card) return;
      const tr = isTr();
      const { x, y } = S.customLanding;
      const v = layers.cellValues(x, y);
      const nr = layers.nearestRegion ? layers.nearestRegion(v.lat, v.lon) : null;
      const regName = nr && nr.region
        ? (nr.distDeg < 6 ? nr.region.name : pick(tr, 'pn.nearRegion', [nr.region.name]))
        : '';

      const res = analyzeSite({
        cellValues: v,
        roverId,
        weights: S.weights,
        hard: S.hard,
        ls: S.crisis && S.crisis.ls != null ? S.crisis.ls : 251,
        regionName: regName,
        SCORING,
        STORM,
        VEHICLES,
        PLANET: PLANET || (global.PLANET_PROFILES && global.PLANET_PROFILES.get ? global.PLANET_PROFILES.get() : null),
        tr,
      });

      S.customLanding.roverId = roverId;
      S.customLanding.rangeKm = res.rangeKm;
      S.customLanding.circlePts = res.circlePts;
      S.customLanding.lat = v.lat;
      S.customLanding.lon = v.lon;
      S.customLanding.score = res.rawScore;
      S.customLanding.slopeBlocked = res.rover.slopeBlocked;

      if (coordEl) coordEl.textContent = (FMT && FMT.fmtLat && FMT.fmtLon) ? `${FMT.fmtLat(v.lat)} · ${FMT.fmtLon(v.lon)}` : `${v.lat.toFixed(2)}°, ${v.lon.toFixed(2)}°`;
      if (regionEl) regionEl.textContent = regName || pick(tr, 'ls.customCoords');

      if (rangeValEl) {
        rangeValEl.textContent = res.rover.slopeBlocked
          ? `0.0 km (${pick(tr, 'ls.blockedShort')})`
          : `${res.rangeKm.toFixed(1)} km`;
        rangeValEl.classList.toggle('is-blocked', !!res.rover.slopeBlocked);
      }
      if (rangeBasisEl) rangeBasisEl.textContent = `${res.rover.basisLabel} · ${res.rover.energyDetail}`;
      if (rangeEnvEl) {
        rangeEnvEl.innerHTML = res.rover.envPenalties.length
          ? res.rover.envPenalties.map((p) => `<div class="ls-env-chip">${escHtml(p)}</div>`).join('')
          : `<div class="ls-env-chip is-ok">${escHtml(pick(tr, 'ls.envNominal', [res.rover.tempMeanC, res.rover.localTau]))}</div>`;
      }

      if (compatScoreEl) {
        const displayScore = res.nasaVeto ? res.effectiveScore : res.rawScore;
        compatScoreEl.textContent = `${displayScore.toFixed(0)} / 100`;
        compatScoreEl.classList.toggle('is-good', !res.nasaVeto && res.rawScore >= 70);
        compatScoreEl.classList.toggle('is-warn', !res.nasaVeto && res.rawScore >= 45 && res.rawScore < 70);
        compatScoreEl.classList.toggle('is-bad', res.nasaVeto || res.rawScore < 45);
      }
      if (compatStatusEl) {
        compatStatusEl.textContent = res.nasaVeto
          ? `${pick(tr, 'ls.vetoTag')} (${pick(tr, 'ls.unweightedScore', [res.rawScore.toFixed(1)])})`
          : pick(tr, 'ls.withinNasa');
        compatStatusEl.className = res.nasaVeto ? 'ls-compat-status is-veto' : 'ls-compat-status is-ok';
      }

      if (factorsEl) {
        const parts = [];
        for (const vr of res.vetoReasons) {
          parts.push(`<div class="ls-factor-row is-veto"><span>${escHtml(vr)}</span><span class="ls-penalty-val">${escHtml(pick(tr, 'ls.vetoBadge'))}</span></div>`);
        }
        for (const nf of res.negativeFactors) {
          parts.push(
            `<div class="ls-factor-row"><span>${escHtml(nf.label)} <small>(${escHtml(nf.valueText)})</small></span>`
            + `<span class="ls-penalty-val">-${nf.lossPts.toFixed(1)}</span></div>`
          );
        }
        if (!parts.length) parts.push(`<div class="ls-factor-empty">${escHtml(pick(tr, 'ls.noNegatives'))}</div>`);
        factorsEl.innerHTML = parts.join('');
      }

      if (metricsKvEl) {
        const tiTxt = v.ti == null ? '—' : `${Math.round(v.ti)} tiu`;
        const iceTxt = v.ice == null ? pick(tr, 'ls.noDataShort') : v.ice.toFixed(2);
        metricsKvEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mElev'))}</span><b>${Math.round(v.elev)} m</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mSlope'))}</span><b>${v.slope.toFixed(1)}°</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mIce'))}</span><b>${escHtml(iceTxt)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mTi'))}</span><b>${escHtml(tiTxt)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mRad'))}</span><b>${Math.round(v.rad)} mSv/yr</b></div>`,
        ].join('');
      }

      if (summaryEl) summaryEl.textContent = buildSiteSummary(v, res, tr);

      if (walkEl) {
        const locTi = v.ti != null ? v.ti : 215;
        const locDust = v.dust != null ? v.dust : 0.25;
        const walkH = +(4.2 + v.slope * 0.11 + (v.rough / 180)).toFixed(1);
        const bio = SCORING.calcPandolfMars
          ? SCORING.calcPandolfMars({ slopeDeg: v.slope, ti: locTi, sandFrac: Math.max(0, locDust - 0.2) * 0.6, durationH: walkH, loadKg: 15, speedKmh: 2.4, buddyMode: 'buddy' })
          : { metabolicKcalH: 228, o2RemainPct: 72, waterUsedL: 1.35, co2ScrubberUsedPct: 38, walkbackRadiusM: 760 };
        const walkOk = walkH <= 8.0 && v.slope <= 15;
        walkEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wDuration'))}</span><b class="${walkOk ? 'ok' : 'warn'}">${walkH} h / 8.0 h</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wMetabolic'))}</span><b>${bio.metabolicKcalH} kcal/h · ${bio.waterUsedL} L H₂O</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wReserve'))}</span><b>O₂ ${bio.o2RemainPct}% · CO₂ ${bio.co2ScrubberUsedPct ?? 38}% · ${bio.walkbackRadiusM} m</b></div>`,
        ].join('');
      }

      if (stormEl && STORM && STORM.simulate) {
        const c = S.crisis || { ls: 251, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0, regolith: 1.5 };
        const st = STORM.simulate({
          lat: v.lat, ls: c.ls, ti: v.ti, elev: v.elev, panelArea: c.area, efficiency: 0.2,
          consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
          storm: (() => { const t0 = STORM.baselineTau ? STORM.baselineTau(v.lat, v.lon, c.ls, v.elev) : 0.5; return { tau0: t0, tauPeak: Math.max(c.tauPeak, t0), startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 }; })(),
        });
        const spe = SCORING.calcSPE ? SCORING.calcSPE(v.elev, c.regolith ?? 1.5) : { requiredRegolithM: 1.5 };
        const pwrStatus = st.blackoutSol !== null
          ? pick(tr, 'ls.stBlackout', [st.blackoutSol])
          : pick(tr, 'ls.stSurvives', [Math.round(st.minBatt), Math.round((100 * st.minBatt) / c.batt)]);
        const thermStatus = st.freezeSol !== null
          ? pick(tr, 'ls.stFreeze', [st.freezeSol])
          : pick(tr, 'ls.stWarm');
        stormEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stPower'))}</span><b class="${st.blackoutSol !== null ? 'bad' : 'ok'}">${escHtml(pwrStatus)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stTemp'))}</span><b class="${st.freezeSol !== null ? 'bad' : 'ok'}">${escHtml(thermStatus)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stSpe'))}</span><b>${spe.requiredRegolithM} m</b></div>`,
        ].join('');
      }

      if (emptyEl) emptyEl.classList.add('hidden');
      if (closeBtn) closeBtn.classList.remove('hidden');
      card.classList.remove('hidden');
      if (onDraw) onDraw();
    }

    function openAt(x, y) {
      if (!S) return;
      S.customLanding = { x, y, roverId, rangeKm: 0, circlePts: [] };
      populateRoverSelect();
      render();
    }

    function close() {
      if (!S) return;
      S.customLanding = null;
      if (card) card.classList.add('hidden');
      if (closeBtn) closeBtn.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (onDraw) onDraw();
      if (onClose) onClose();
    }

    function refresh() {
      if (S && S.customLanding) render();
    }

    function onLangChange() {
      populateRoverSelect();
      refresh();
    }

    populateRoverSelect();
    if (roverSeg) {
      roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
        b.addEventListener('click', () => {
          roverId = b.dataset.rover || 'manned_rover';
          syncRoverUI();
          refresh();
        });
      });
    }
    if (roverSel) {
      roverSel.addEventListener('change', () => {
        roverId = roverSel.value || 'manned_rover';
        syncRoverUI();
        refresh();
      });
    }
    if (btnEva) {
      btnEva.addEventListener('click', () => {
        if (!S.customLanding || !onUseEva) return;
        const { x, y } = S.customLanding;
        const v = layers.cellValues(x, y);
        const nr = layers.nearestRegion ? layers.nearestRegion(v.lat, v.lon) : null;
        onUseEva(x, y, v, nr && nr.region ? nr.region.name : '');
      });
    }
    if (btnWalk) {
      btnWalk.addEventListener('click', () => {
        if (S.customLanding && onPlanMarswalk) onPlanMarswalk(S.customLanding.x, S.customLanding.y);
      });
    }
    if (btnStorm) {
      btnStorm.addEventListener('click', () => {
        if (S.customLanding && onUseCrisis) onUseCrisis(S.customLanding.x, S.customLanding.y, true);
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', close);
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S && S.customLanding && S.mode === 'landing') close();
    });

    return { openAt, close, refresh, onLangChange };
  }

  const api = {
    circleLatLons,
    computeRoverRange,
    traverseEstimate,
    roverStormPower,
    analyzeSite,
    createController,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MDE_LANDING_SITE = api;
})(typeof window !== 'undefined' ? window : globalThis);
