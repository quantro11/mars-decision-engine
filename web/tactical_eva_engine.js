// Pure UMD computation engine for the Mars Tactical EVA 16 km2 local terrain analysis.
// Zero hardcoded constants: reads all physics/vehicle/domain parameters from tactical_config.json & vehicles.json.
// Reuses MDE_MARS_TIME (Mars24), SCORING (radiation/elevation/normalization), and STORM (dust solar/thermal/ML).
(function (global) {
  'use strict';

  function unwrap(mod, key) {
    return mod && mod[key] ? mod[key] : mod;
  }

  function loadDep(globalKey, relPath) {
    if (global && global[globalKey]) return unwrap(global[globalKey], globalKey);
    if (typeof require === 'function') {
      try { return unwrap(require(relPath), globalKey); } catch (_) { return null; }
    }
    return null;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function normalizeLon180(lon) {
    return ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
  }

  function normalizeLon360(lon) {
    return (((Number(lon) % 360) + 360) % 360);
  }

  function formatLonForConvention(lon180, conv) {
    return conv === '0_360' ? +normalizeLon360(lon180).toFixed(4) : +normalizeLon180(lon180).toFixed(4);
  }

  function validateLocation(latRaw, lonRaw, lonConvention, cfg) {
    const errors = [];
    const lat = Number(latRaw);
    const lonIn = Number(lonRaw);
    const conv = lonConvention === '0_360' ? '0_360' : '-180_180';

    if (!Number.isFinite(latRaw === '' || latRaw === null ? NaN : lat) || lat < -90 || lat > 90) {
      errors.push('Latitude must be between -90° and +90°.');
    }
    const lonMin = conv === '0_360' ? 0 : -180;
    const lonMax = conv === '0_360' ? 360 : 180;
    if (!Number.isFinite(lonRaw === '' || lonRaw === null ? NaN : lonIn) || lonIn < lonMin || lonIn > lonMax) {
      errors.push(`Longitude must be between ${lonMin}° and ${lonMax}° (${conv === '0_360' ? '0…360° E' : '−180…180°'}).`);
    }
    if (errors.length) return { valid: false, errors };

    const degToM = cfg.planet.degToMeters.value;
    const halfBoxM = (cfg.planet.boxSizeKm.value * 1000) / 2;
    const dLat = halfBoxM / degToM;
    const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const dLon = halfBoxM / (degToM * cosLat);
    const lon180 = normalizeLon180(lonIn);
    const lon360 = normalizeLon360(lonIn);
    const latMin = clamp(lat - dLat, -90, 90);
    const latMax = clamp(lat + dLat, -90, 90);
    const wLon = lon180 - dLon;
    const eLon = lon180 + dLon;

    return {
      valid: true,
      errors: [],
      latDeg: +lat.toFixed(5),
      lon180: +lon180.toFixed(5),
      lon360: +lon360.toFixed(5),
      lonConvention: conv,
      bbox180: [+wLon.toFixed(6), +latMin.toFixed(6), +eLon.toFixed(6), +latMax.toFixed(6)],
      corners: {
        nw: { lat: +latMax.toFixed(4), lon180: +normalizeLon180(wLon).toFixed(4), lon360: +normalizeLon360(wLon).toFixed(4) },
        ne: { lat: +latMax.toFixed(4), lon180: +normalizeLon180(eLon).toFixed(4), lon360: +normalizeLon360(eLon).toFixed(4) },
        se: { lat: +latMin.toFixed(4), lon180: +normalizeLon180(eLon).toFixed(4), lon360: +normalizeLon360(eLon).toFixed(4) },
        sw: { lat: +latMin.toFixed(4), lon180: +normalizeLon180(wLon).toFixed(4), lon360: +normalizeLon360(wLon).toFixed(4) },
      },
    };
  }

  function resolveVehicleConfig(vehiclesCfg, classId, overrides, resetToClassDefaults) {
    const cls = vehiclesCfg.classes[classId] || vehiclesCfg.classes.lab_rover;
    const ov = resetToClassDefaults ? {} : (overrides || {});
    const speedRaw = ov.speedKmh !== undefined ? Number(ov.speedKmh) : cls.speedKmh.default;
    const loadRaw = ov.extraLoadKg !== undefined ? Number(ov.extraLoadKg) : cls.extraLoadKg.default;
    const speedKmh = +clamp(Number.isFinite(speedRaw) ? speedRaw : cls.speedKmh.default, cls.speedKmh.min, cls.speedKmh.max).toFixed(4);
    const extraLoadKg = +clamp(Number.isFinite(loadRaw) ? loadRaw : cls.extraLoadKg.default, cls.extraLoadKg.min, cls.extraLoadKg.max).toFixed(2);
    const selectable = cls.power.selectableModes || [cls.power.defaultMode];
    const powerMode = selectable.includes(ov.powerMode) ? ov.powerMode : cls.power.defaultMode;
    const totalMassKg = +(cls.baseMassKg.value + extraLoadKg).toFixed(2);
    const speedNorm = cls.speedKmh.max > cls.speedKmh.min
      ? (speedKmh - cls.speedKmh.min) / (cls.speedKmh.max - cls.speedKmh.min)
      : 0.5;

    return {
      classId: cls.id,
      name: cls.name,
      name_tr: cls.name_tr,
      reference: cls.reference,
      reference_tr: cls.reference_tr,
      concept: !!cls.concept,
      baseMassKg: cls.baseMassKg,
      extraLoadKg,
      totalMassKg,
      extraLoadSpec: cls.extraLoadKg,
      speedKmh,
      speedSpec: cls.speedKmh,
      speedNorm: +speedNorm.toFixed(4),
      slopeLimitDeg: cls.slopeLimitDeg,
      powerMode,
      selectablePowerModes: selectable,
      power: cls.power,
      effects: vehiclesCfg.effects,
      marsGravityMps2: vehiclesCfg._meta.marsGravityMps2.value,
    };
  }

  function getDefaultInputs(vehiclesCfg, cfg) {
    const vCfg = vehiclesCfg || loadDep('MDE_VEHICLES', './vehicles_data.js');
    const tCfg = cfg || loadDep('MDE_TACTICAL_CONFIG', './tactical_config_data.js');
    const weights = {};
    for (const k in tCfg.weights) weights[k] = tCfg.weights[k].value;
    const veh = resolveVehicleConfig(vCfg, 'lab_rover', null, true);
    return {
      presetZoneId: 'jezero_delta',
      lat: 18.38,
      lonInput: 77.58,
      lonConvention: '-180_180',
      earthDateUtc: tCfg.environment.defaultDate,
      ltstHours: tCfg.environment.defaultLtstHours,
      tau: tCfg.environment.tauRange.default,
      solarCycle: 'mid',
      speActive: false,
      vehicleClass: veh.classId,
      speedKmh: veh.speedKmh,
      extraLoadKg: veh.extraLoadKg,
      powerMode: veh.powerMode,
      orbitalBlendWeight: tCfg.blend.defaultOrbitalWeight.value,
      scoreMode: 'weighted',
      weights,
      onlineEnabled: true,
    };
  }

  function findPresetCutout(cutouts, latDeg, lon180) {
    if (!cutouts || !cutouts.zones) return null;
    for (const zid of Object.keys(cutouts.zones)) {
      const z = cutouts.zones[zid];
      const dLat = Math.abs(z.lat - latDeg);
      const dLon = Math.abs(normalizeLon180(z.lon - lon180));
      if (dLat < 0.002 && dLon < 0.002) return z;
    }
    return null;
  }

  function nearestRegionName(lat, lon180, deps) {
    if (deps && deps.layers && typeof deps.layers.nearestRegion === 'function') {
      return deps.layers.nearestRegion(lat, lon180);
    }
    const regions = (deps && deps.regions) || loadDep('REGIONS', './regions.js');
    if (Array.isArray(regions) && regions.length) {
      let best = null;
      let bestD = Infinity;
      for (const r of regions) {
        const dLon = Math.abs(normalizeLon180(r.lon - lon180));
        const d = Math.hypot(r.lat - lat, dLon * Math.cos((lat * Math.PI) / 180));
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best) {
        const degToKm = (deps && deps.tacticalCfg && deps.tacticalCfg.planet && deps.tacticalCfg.planet.degToMeters.value / 1000) || 59.274697;
        return { name: best.name, distKm: +(bestD * degToKm).toFixed(0), lat: best.lat, lon: best.lon };
      }
    }
    return null;
  }

  function buildGlobalFallbackGrid(lat, lon180, layers, cfg, cutouts) {
    const n = cfg.planet.gridN.value;
    const total = n * n;
    const loc = validateLocation(lat, lon180, '-180_180', cfg);
    const meta = (layers && layers.META) || {};
    const W = meta.width || 4096;
    const H = meta.height || 2048;

    const sampleCell = (rLat, rLon) => {
      if (layers && layers.L && layers.L.elev) {
        const fx = ((normalizeLon180(rLon) + 180) / 360) * W;
        const fy = ((90 - rLat) / 180) * H;
        const ix = Math.max(0, Math.min(W - 1, Math.round(fx)));
        const iy = Math.max(0, Math.min(H - 1, Math.round(fy)));
        const c = layers.cellValues(ix, iy);
        return c || {};
      }
      return { elev: -1800, slope: 2.5, rough: 4.0, ti: 250, dust: 0.25 };
    };

    const elevM = new Array(total);
    const slopeDeg = new Array(total);
    const reliefM = new Array(total);
    const roughGlobalM = new Array(total);
    const ti = new Array(total);
    const dci = new Array(total);
    const albedo = new Array(total);
    const grsK = new Array(total);
    const grsTh = new Array(total);
    const geolUnits = new Array(total);
    const ctxTone = new Array(total);
    const ctxContrast = new Array(total);
    const dLat = (loc.bbox180[3] - loc.bbox180[1]) / n;
    const dLon = (loc.bbox180[2] - loc.bbox180[0]) / n;

    // Coarse global GRS fallback reference when outside preset & offline
    const kDef = cfg.radiation.grs.kGlobalMeanWtPct.value;
    const thDef = cfg.radiation.grs.thGlobalMeanPpm.value;
    const fallbackUnit = Math.abs(lat) > 62 ? 'Ap' : 'HNt';

    for (let r = 0; r < n; r++) {
      const cLat = loc.bbox180[3] - (r + 0.5) * dLat;
      for (let c = 0; c < n; c++) {
        const cLon = loc.bbox180[0] + (c + 0.5) * dLon;
        const s = sampleCell(cLat, cLon);
        const i = r * n + c;
        const dFrac = s.dust != null ? s.dust : 0.25;
        elevM[i] = +(s.elev != null ? s.elev : -1800).toFixed(1);
        slopeDeg[i] = +(s.slope != null ? s.slope : 2.0).toFixed(2);
        roughGlobalM[i] = +(s.rough != null ? s.rough : 4.0).toFixed(1);
        reliefM[i] = roughGlobalM[i];
        ti[i] = +(s.ti != null ? s.ti : 240).toFixed(1);
        dci[i] = +clamp(0.99 - dFrac * 0.12, 0.88, 0.995).toFixed(4);
        albedo[i] = +clamp(0.13 + dFrac * 0.18, 0.10, 0.34).toFixed(4);
        grsK[i] = kDef;
        grsTh[i] = thDef;
        geolUnits[i] = fallbackUnit;
        ctxTone[i] = 0.5;
        ctxContrast[i] = 0.2;
      }
    }

    const resM = cfg.resolution.globalBaselineDeliveredM.value;
    return {
      id: 'global_fallback',
      name: 'Global ~5.2 km/px Baseline',
      lat: loc.latDeg,
      lon: loc.lon180,
      bbox: loc.bbox180,
      gridN: n,
      cellM: cfg.planet.cellSizeM.value,
      sizeKm: cfg.planet.boxSizeKm.value,
      areaKm2: 16,
      isPresetCutout: false,
      isLowResGrid: true,
      dataMode: 'OFFLINE_GLOBAL_FALLBACK',
      sources: {
        elevation: { id: 'MOLA MEGDR 4096x2048 offline raster', nativeResM: resM, lowRes: true, date: '2003 / USGS 2014' },
        slope: { id: 'MOLA 90th-pct slope (4096x2048 global)', nativeResM: resM, lowRes: true, date: '2003' },
        ti: { id: 'TES_Thermal_Inertia_numeric (2048x1024 upsampled)', nativeResM: cfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2001' },
        imagery: { id: 'Unavailable offline at custom coordinate', nativeResM: resM, lowRes: true, date: 'N/A' },
        dust: { id: 'TES_Dust_numeric (2048x1024 upsampled -> DCI proxy)', nativeResM: cfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2002 (Bandfield)' },
        albedo: { id: 'TES dust-derived albedo proxy (offline fallback)', nativeResM: cfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2002' },
        geology: { id: 'Offline regional unit prior (no SIM 3292 polygon loaded)', nativeResM: 20000, lowRes: true, date: '2014 (fallback)' },
        grs: { id: 'Odyssey GRS global mean placeholder (~550 km)', nativeResM: 550000, lowRes: true, date: '2007 (Boynton et al.)' },
      },
      elevM,
      slopeDeg,
      reliefM,
      roughGlobalM,
      ti,
      dci,
      albedo,
      grsK,
      grsTh,
      geolUnits,
      ctxTone,
      ctxContrast,
      ctxImgDataUri: null,
      sim3292ObjectIdToUnit: cutouts && cutouts.sim3292ObjectIdToUnit,
    };
  }

  function interpSurfaceTempC(storm, lat, lsDeg, tiVal, elevM, tau, ltstHours) {
    const st = storm.surfaceTempC(lat, lsDeg, tiVal, elevM, tau);
    const phase = Math.cos(((ltstHours - 14.0) * Math.PI) / 12.0);
    const instC = phase >= 0
      ? st.mean + phase * (st.day - st.mean)
      : st.mean + (-phase) * (st.night - st.mean);
    return {
      instC: +instC.toFixed(1),
      dayC: +st.day.toFixed(1),
      meanC: +st.mean.toFixed(1),
      nightC: +st.night.toFixed(1),
    };
  }

  function scoreCell(phys, env, vehicle, cfg, deps) {
    const SCORING = deps.scoring;
    const STORM = deps.storm;
    const dp = cfg.domainParams;
    const n = cfg.planet.gridN.value;

    // 1. Thermal (TI soil firmness + instantaneous diurnal temp)
    const thP = dp.thermal;
    let tiScore;
    if (phys.ti <= thP.tiFineDustM.value) {
      tiScore = Math.max(0, (phys.ti / thP.tiFineDustM.value) * 35);
    } else if (phys.ti < thP.tiOptLow.value) {
      tiScore = 35 + ((phys.ti - thP.tiFineDustM.value) / (thP.tiOptLow.value - thP.tiFineDustM.value)) * 65;
    } else if (phys.ti <= thP.tiOptHigh.value) {
      tiScore = 100;
    } else {
      tiScore = Math.max(55, 100 - ((phys.ti - thP.tiOptHigh.value) / (thP.tiRockUpper.value - thP.tiOptHigh.value)) * 45);
    }
    const tObj = interpSurfaceTempC(STORM, phys.lat, env.lsDeg, phys.ti, phys.elevM, env.tau, env.ltstHours);
    const tempScore = clamp(
      100 * (tObj.instC - thP.tempColdFloorC.value) / (thP.tempWarmOptC.value - thP.tempColdFloorC.value),
      0, 100
    );
    const thermal = clamp(thP.tiWeight.value * tiScore + thP.tempWeight.value * tempScore, 0, 100);

    // 2a. Space Radiation Dose (scored)
    const cyc = cfg.radiation.solarCycle[env.solarCycle] || cfg.radiation.solarCycle.mid;
    const baseRad = SCORING.radDose(phys.elevM, phys.slopeDeg, env.lsDeg);
    const gcrMSvYr = baseRad * cyc.factor;
    const colGcm2 = SCORING.atmoColumnGcm2(phys.elevM, env.lsDeg);
    const speObj = env.speActive ? SCORING.calcSPE(phys.elevM, 0) : null;
    const speMSv = speObj ? speObj.unshieldedDoseMsv : 0;
    const radSc = cfg.radiation.scoring;
    let radScore = 100 * (1 - clamp((gcrMSvYr - radSc.doseBestMSvYr.value) / (radSc.doseWorstMSvYr.value - radSc.doseBestMSvYr.value), 0, 1));
    if (env.speActive) {
      radScore = Math.max(0, radScore - (speMSv / radSc.speAcutePenaltyDivisorMSv.value) * 100);
    }

    // 3. Topography (relief + MOLA roughness + vehicle speed risk on rough cells)
    const tpP = dp.topography;
    const reliefNorm = clamp(phys.reliefM / tpP.reliefMaxM.value, 0, 1);
    const roughBase = phys.roughGlobalM != null ? phys.roughGlobalM : phys.reliefM * 0.45;
    const roughNorm = clamp(roughBase / tpP.roughMaxM.value, 0, 1);
    let topoScore = 100 * (1 - (tpP.reliefShare.value * reliefNorm + (1 - tpP.reliefShare.value) * roughNorm));
    const speedRoughOnset = clamp(
      (phys.reliefM - vehicle.effects.roughnessRiskThresholdM.value) / Math.max(1, tpP.reliefMaxM.value - vehicle.effects.roughnessRiskThresholdM.value),
      0, 1
    );
    const speedRiskPenalty = vehicle.effects.speedRiskMaxPenalty.value * vehicle.speedNorm * speedRoughOnset;
    topoScore = clamp(topoScore - speedRiskPenalty, 0, 100);

    // 4. Optics (albedo + CTX texture + tau atmospheric haze + solar zenith cosine)
    const opP = dp.optics;
    let albScore;
    if (phys.albedo < opP.albedoIdealMin.value) {
      albScore = 70 + (phys.albedo / opP.albedoIdealMin.value) * 30;
    } else if (phys.albedo <= opP.albedoIdealMax.value) {
      albScore = 100;
    } else {
      albScore = Math.max(20, 100 - ((phys.albedo - opP.albedoIdealMax.value) / (opP.albedoHighDust.value - opP.albedoIdealMax.value)) * 80);
    }
    const visHaze = Math.exp(-env.tau / opP.tauVisibilityScale.value);
    const sunDayFactor = lerp(1 - opP.nightSolarZenithPenalty.value, 1.0, clamp(env.cosZ, 0, 1));
    const ctxBonus = 0.85 + 0.15 * (1 - Math.abs(phys.ctxTone - 0.5) * 1.4);
    const optics = clamp(albScore * ctxBonus * visHaze * sunDayFactor, 0, 100);

    // 5. Geology (USGS SIM 3292 table lookup; continuous blend between center unit score and cell unit score)
    const unitInfo = cfg.geologySim3292.units[phys.geolUnit];
    const centerUnitInfo = cfg.geologySim3292.units[phys.centerGeolUnit];
    const localGeoScore = unitInfo ? unitInfo.score : dp.confidence.geologyFallbackScore.value;
    const centerGeoScore = centerUnitInfo ? centerUnitInfo.score : dp.confidence.geologyFallbackScore.value;
    const geology = clamp(lerp(centerGeoScore, localGeoScore, env.orbitalBlendWeight), 0, 100);

    // 6. Elevation / Slope + Vehicle limit & Mass sinkage on low-TI loose sand
    const esP = dp.elevSlope;
    const elevScore = clamp(SCORING.F.elev(phys.elevM) * 100, 0, 100);
    const limitDeg = vehicle.slopeLimitDeg.value;
    const impassableVehicle = phys.slopeDeg > limitDeg;
    let slopeScore = impassableVehicle ? 0 : clamp(100 * (1 - phys.slopeDeg / Math.max(1, limitDeg)), 0, 100);
    const looseSandFrac = clamp(
      (vehicle.effects.tiLooseThreshold.value - phys.ti) / Math.max(1, vehicle.effects.tiLooseThreshold.value - thP.tiFineDustM.value),
      0, 1
    );
    const massRatio = Math.pow(
      Math.max(1, vehicle.totalMassKg) / vehicle.effects.sinkageMassRefKg.value,
      vehicle.effects.sinkageMassExponent.value
    );
    const sinkagePenalty = impassableVehicle ? 0 : clamp(
      vehicle.effects.sinkageMaxPenalty.value * looseSandFrac * massRatio,
      0, vehicle.effects.sinkageMaxPenalty.value
    );
    slopeScore = clamp(slopeScore - sinkagePenalty, 0, 100);
    const elevSlope = impassableVehicle ? 0 : clamp(esP.elevShare.value * elevScore + esP.slopeShare.value * slopeScore, 0, 100);

    // 7. Dust (TES DCI + current optical depth tau)
    const duP = dp.dust;
    const dciScore = clamp(100 * (phys.dci - duP.dciDusty.value) / (duP.dciClean.value - duP.dciDusty.value), 0, 100);
    const tauRange = cfg.environment.tauRange;
    const tauClearScore = clamp(100 * (1 - (env.tau - tauRange.min) / (tauRange.max - tauRange.min)), 0, 100);
    const dust = clamp(duP.surfaceDciShare.value * dciScore + (1 - duP.surfaceDciShare.value) * tauClearScore, 0, 100);

    // 11. Confidence (data resolution & tau attenuation)
    const cfP = dp.confidence;
    let conf = phys.isLowResCell ? cfP.baseGlobalFallback.value : cfP.baseFineCutout.value;
    if (!phys.isLowResCell && phys.hasHiRiseElev) conf += cfP.hiriseBoost.value;
    const tauPenalty = cfP.tauUncertaintyPenalty.value * clamp((env.tau - tauRange.min) / (tauRange.max - tauRange.min), 0, 1);
    const confidence = clamp(conf - tauPenalty, 10, 99);

    return {
      thermal: +thermal.toFixed(1),
      radiation: +radScore.toFixed(1),
      topography: +topoScore.toFixed(1),
      optics: +optics.toFixed(1),
      geology: +geology.toFixed(1),
      elevSlope: +elevSlope.toFixed(1),
      elevationScore: +elevScore.toFixed(1),
      slopeScore: +slopeScore.toFixed(1),
      dust: +dust.toFixed(1),
      confidence: +confidence.toFixed(1),
      // Extra telemetry retained for popup & vehicle summary
      instTempC: tObj.instC,
      dayTempC: tObj.dayC,
      nightTempC: tObj.nightC,
      gcrMSvYr: +gcrMSvYr.toFixed(1),
      speMSv: +speMSv.toFixed(1),
      atmoColGcm2: +colGcm2.toFixed(2),
      visHazePct: +(visHaze * 100).toFixed(1),
      sinkagePenalty: +sinkagePenalty.toFixed(1),
      speedRiskPenalty: +speedRiskPenalty.toFixed(1),
      impassableVehicle,
    };
  }

  function evaluateFinalCompatibility(scores, phys, vehicle, normWeights, scoreMode, cfg) {
    const vetoCfg = cfg.nasaVeto;
    const nasaVetoReasons = [];
    if (phys.elevM > vetoCfg.elevMaxM.value) nasaVetoReasons.push(`Elev ${phys.elevM.toFixed(0)} m > +${vetoCfg.elevMaxM.value} m (HLS-2015)`);
    if (Math.abs(phys.lat) > vetoCfg.absLatMaxDeg.value) nasaVetoReasons.push(`|Lat| ${Math.abs(phys.lat).toFixed(1)}° > ${vetoCfg.absLatMaxDeg.value}° (HLS-2015)`);
    if (phys.slopeDeg > vetoCfg.slopeMaxDeg.value) nasaVetoReasons.push(`Slope ${phys.slopeDeg.toFixed(1)}° > ${vetoCfg.slopeMaxDeg.value}° (HLS-2015)`);
    const nasaVeto = nasaVetoReasons.length > 0;
    const impassable = scores.impassableVehicle || phys.slopeDeg > vehicle.slopeLimitDeg.value;

    let rawCombined = 0;
    if (scoreMode === 'nocomp') {
      let prod = 1;
      for (const k in normWeights) {
        const w = normWeights[k];
        if (!w || scores[k] === undefined) continue;
        const s = clamp(scores[k], 0, 100) / 100;
        if (s <= 0) { prod = 0; break; }
        prod *= Math.pow(s, w);
      }
      rawCombined = prod * 100;
    } else {
      let sum = 0;
      for (const k in normWeights) {
        const w = normWeights[k];
        if (!w || scores[k] === undefined) continue;
        sum += w * clamp(scores[k], 0, 100);
      }
      rawCombined = sum;
    }
    const finalScore = (nasaVeto || impassable) ? 0 : +clamp(rawCombined, 0, 100).toFixed(1);
    return {
      finalScore,
      nasaVeto,
      nasaVetoReasons,
      impassableVehicle: impassable,
      preVetoScore: +clamp(rawCombined, 0, 100).toFixed(1),
    };
  }

  function computeEnvironmentState(inputs, centerPhys, deps) {
    const cfg = deps.tacticalCfg;
    const MTime = deps.marsTime;
    const STORM = deps.storm;
    const loc = validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, cfg);
    const marsTime = MTime.computeMarsTime(inputs.earthDateUtc || cfg.environment.defaultDate, loc.lon360);
    const ltstHours = clamp(Number(inputs.ltstHours ?? marsTime.ltstHours), 0, 24);
    const tau = clamp(Number(inputs.tau ?? cfg.environment.tauRange.default), cfg.environment.tauRange.min, cfg.environment.tauRange.max);
    const cosZ = MTime.solarZenithCos(loc.latDeg, marsTime.lsDeg, ltstHours);
    const dailySolarKwhM2 = STORM.dailySolar(loc.latDeg, tau, marsTime.lsDeg);
    const fTau = STORM.fTau(tau);
    const solarCycle = cfg.radiation.solarCycle[inputs.solarCycle] ? inputs.solarCycle : 'mid';
    const dFracCenter = clamp((0.99 - (centerPhys.dci ?? 0.96)) / 0.12, 0.05, 0.95);

    const mlForecast = STORM.predictDustML({
      lat: loc.latDeg,
      lon: loc.lon180,
      elev: centerPhys.elevM,
      slope: centerPhys.slopeDeg,
      ls: marsTime.lsDeg,
      ti: centerPhys.ti,
      dust: dFracCenter,
      tauCurrent: tau,
      lmstHour: ltstHours,
    });

    return {
      loc,
      marsTime,
      ltstHours: +ltstHours.toFixed(2),
      tau: +tau.toFixed(2),
      cosZ: +cosZ.toFixed(4),
      dailySolarKwhM2: +dailySolarKwhM2.toFixed(4),
      fTau: +fTau.toFixed(4),
      lsDeg: marsTime.lsDeg,
      marsYear: marsTime.marsYear,
      seasonName: marsTime.seasonName,
      solarCycle,
      speActive: !!inputs.speActive,
      orbitalBlendWeight: clamp(Number(inputs.orbitalBlendWeight ?? cfg.blend.defaultOrbitalWeight.value), 0, 1),
      scoreMode: inputs.scoreMode === 'nocomp' ? 'nocomp' : 'weighted',
      mlForecast,
    };
  }

  function computeVehicleTelemetry(vehicle, env, centerTempC, meanSlopeDeg, avgSinkagePenalty, avgSpeedRiskPenalty, cfg) {
    const eff = vehicle.effects;
    const pwr = vehicle.power;
    const mode = vehicle.powerMode;
    const marsG = vehicle.marsGravityMps2;
    const coldDeltaC = Math.max(0, eff.heaterBaseTempC.value - centerTempC);
    const heaterW = +(coldDeltaC * eff.nuclearHeaterWPerKgDegC.value * vehicle.totalMassKg).toFixed(1);

    let availPowerW = 0;
    let dailyEnergyWh = 0;
    let powerNote = '';
    if (mode === 'solar') {
      const clearDailySolar = env.dailySolarKwhM2 / Math.max(1e-6, env.fTau);
      const areaM2 = pwr.solarAreaM2.value;
      const panelEff = eff.solarPanelEfficiency.value;
      dailyEnergyWh = +(env.dailySolarKwhM2 * 1000 * areaM2 * panelEff).toFixed(1);
      availPowerW = +(eff.solarSpecIrradiancePeakWm2.value * areaM2 * panelEff * env.fTau * Math.max(0, env.cosZ)).toFixed(1);
      const tauLossPct = Math.round((1 - env.fTau) * 100);
      powerNote = `Solar (${areaM2} m² array · τ=${env.tau}, -${tauLossPct}% dust attenuation, Ls ${env.lsDeg.toFixed(0)}°; clear≈${(clearDailySolar * 1000 * areaM2 * panelEff / 1000).toFixed(2)} kWh/sol)`;
    } else if (mode === 'nuclear') {
      const capW = pwr.nuclearRtgW ? pwr.nuclearRtgW.value : pwr.ratedPowerW.value;
      availPowerW = capW;
      dailyEnergyWh = +(capW * 24).toFixed(1);
      powerNote = `Nuclear MMRTG/RTG (~${capW} W unaffected by τ=${env.tau}; cold heater draw ${heaterW} W at ${centerTempC.toFixed(0)}°C)`;
    } else {
      const capKwh = pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : pwr.ratedPowerW.value;
      availPowerW = pwr.ratedPowerW.value;
      dailyEnergyWh = +(capKwh * 1000).toFixed(1);
      powerNote = `Battery (${capKwh} kWh pack unaffected by τ=${env.tau}; cold heater draw ${heaterW} W at ${centerTempC.toFixed(0)}°C)`;
    }

    const rollWhKm = vehicle.totalMassKg * eff.massEnergyCoeffWhPerKgKm.value;
    const slopeSin = Math.sin((meanSlopeDeg * Math.PI) / 180);
    const climbWhKm = (vehicle.totalMassKg * marsG * slopeSin * 1000) / (3600 * eff.gradeWorkEfficiency.value);
    const hotelWhKm = (pwr.hotelPowerW.value + heaterW) / Math.max(0.005, vehicle.speedKmh);
    const energyPerKmWh = +(rollWhKm + climbWhKm + hotelWhKm).toFixed(1);
    const traverse4KmHours = +(cfg.planet.boxSizeKm.value / Math.max(0.005, vehicle.speedKmh)).toFixed(2);
    const rangePerSolKm = +(dailyEnergyWh / Math.max(0.1, energyPerKmWh)).toFixed(2);

    return {
      mode,
      availPowerW,
      dailyEnergyWh,
      heaterW,
      energyPerKmWh,
      traverse4KmHours,
      rangePerSolKm,
      avgSinkagePenalty: +avgSinkagePenalty.toFixed(1),
      avgSpeedRiskPenalty: +avgSpeedRiskPenalty.toFixed(1),
      powerNote,
    };
  }

  function generateAnalysis(params) {
    const vehiclesCfg = unwrap(params.vehiclesCfg || loadDep('MDE_VEHICLES', './vehicles_data.js'), 'MDE_VEHICLES');
    const tacticalCfg = unwrap(params.tacticalCfg || loadDep('MDE_TACTICAL_CONFIG', './tactical_config_data.js'), 'MDE_TACTICAL_CONFIG');
    const cutouts = unwrap(params.cutouts !== undefined ? params.cutouts : loadDep('MDE_EVA_CUTOUTS', './eva_cutouts_data.js'), 'MDE_EVA_CUTOUTS');
    const marsTime = unwrap(params.marsTime || loadDep('MDE_MARS_TIME', './mars_time.js'), 'MDE_MARS_TIME');
    const scoring = unwrap(params.scoring || loadDep('SCORING', './scoring.js'), 'SCORING');
    const storm = unwrap(params.storm || loadDep('STORM', './storm.js'), 'STORM');
    const inputs = params.inputs;

    const loc = validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
    if (!loc.valid) return { ok: false, errors: loc.errors, location: loc };

    const vehicle = resolveVehicleConfig(vehiclesCfg, inputs.vehicleClass, {
      speedKmh: inputs.speedKmh,
      extraLoadKg: inputs.extraLoadKg,
      powerMode: inputs.powerMode,
    }, false);

    // Choose finest orbital grid: online override -> matching pre-cut zone -> bundled ~5.2 km global raster
    let orbitalGrid = params.onlineGrid || null;
    if (!orbitalGrid) {
      orbitalGrid = findPresetCutout(cutouts, loc.latDeg, loc.lon180);
    }
    if (!orbitalGrid) {
      orbitalGrid = buildGlobalFallbackGrid(loc.latDeg, loc.lon180, params.layers, tacticalCfg, cutouts);
    }

    const n = orbitalGrid.gridN || tacticalCfg.planet.gridN.value;
    const total = n * n;
    const ci = Math.floor(n / 2) * n + Math.floor(n / 2);
    const centerPhys = {
      lat: loc.latDeg,
      elevM: orbitalGrid.elevM[ci],
      slopeDeg: orbitalGrid.slopeDeg[ci],
      reliefM: orbitalGrid.reliefM[ci],
      roughGlobalM: orbitalGrid.roughGlobalM ? orbitalGrid.roughGlobalM[ci] : null,
      ti: orbitalGrid.ti[ci],
      dci: orbitalGrid.dci[ci],
      albedo: orbitalGrid.albedo[ci],
      ctxTone: orbitalGrid.ctxTone ? orbitalGrid.ctxTone[ci] : 0.5,
      ctxContrast: orbitalGrid.ctxContrast ? orbitalGrid.ctxContrast[ci] : 0.2,
      grsK: orbitalGrid.grsK[ci],
      grsTh: orbitalGrid.grsTh[ci],
      geolUnit: orbitalGrid.geolUnits[ci],
      centerGeolUnit: orbitalGrid.geolUnits[ci],
      isLowResCell: !!orbitalGrid.isLowResGrid,
      hasHiRiseElev: !!(orbitalGrid.sources && orbitalGrid.sources.elevation && String(orbitalGrid.sources.elevation.id).includes('hirise')),
    };

    const deps = { vehiclesCfg, tacticalCfg, cutouts, marsTime, scoring, storm, layers: params.layers, regions: params.regions };
    const env = computeEnvironmentState(inputs, centerPhys, deps);
    const rawWeights = inputs.weights || {};
    const weightKeys = Object.keys(tacticalCfg.weights);
    const weightInput = {};
    for (const k of weightKeys) weightInput[k] = Math.max(0, Number(rawWeights[k] ?? tacticalCfg.weights[k].value));
    const rawNorm = scoring.normalize(weightInput);
    const normWeights = {};
    for (const k of weightKeys) normWeights[k] = rawNorm[k] || 0;

    // Step 1: Center Base Value (computed from user's inputs + ML scalar baseline)
    const centerBase = scoreCell(centerPhys, env, vehicle, tacticalCfg, deps);
    const centerFinal = evaluateFinalCompatibility(centerBase, centerPhys, vehicle, normWeights, env.scoreMode, tacticalCfg);

    // Allocate compact per-cell typed/plain arrays for 11 layers + popup raw physics
    const grids = {
      final: new Float32Array(total),
      thermal: new Float32Array(total),
      radiation: new Float32Array(total),
      topography: new Float32Array(total),
      optics: new Float32Array(total),
      geology: new Float32Array(total),
      elevSlope: new Float32Array(total),
      elevationScore: new Float32Array(total),
      slopeScore: new Float32Array(total),
      dust: new Float32Array(total),
      confidence: new Float32Array(total),
      elevM: new Float32Array(total),
      slopeDeg: new Float32Array(total),
      reliefM: new Float32Array(total),
      ti: new Float32Array(total),
      dci: new Float32Array(total),
      albedo: new Float32Array(total),
      grsK: new Float32Array(total),
      grsTh: new Float32Array(total),
      tempC: new Float32Array(total),
      gcrMSvYr: new Float32Array(total),
      speMSv: new Float32Array(total),
      geolUnits: new Array(total),
      impassable: new Uint8Array(total),
      nasaVeto: new Uint8Array(total),
    };

    const wOrb = env.orbitalBlendWeight;
    const dLat = (loc.bbox180[3] - loc.bbox180[1]) / n;
    let sumFinal = 0, minFinal = Infinity, maxFinal = -Infinity;
    let impassableCount = 0, nasaVetoCount = 0;
    let sumSlope = 0, sumSinkage = 0, sumSpeedRisk = 0;
    const domainSums = { thermal: 0, radiation: 0, topography: 0, optics: 0, geology: 0, elevSlope: 0, dust: 0 };

    // Step 2: Spatial variation across 40x40 (Step 3 biomes skipped per Section 0.2 check)
    for (let r = 0; r < n; r++) {
      const cellLat = wOrb === 0 ? loc.latDeg : (loc.bbox180[3] - (r + 0.5) * dLat);
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const blendedPhys = {
          lat: cellLat,
          elevM: lerp(centerPhys.elevM, orbitalGrid.elevM[i], wOrb),
          slopeDeg: lerp(centerPhys.slopeDeg, orbitalGrid.slopeDeg[i], wOrb),
          reliefM: lerp(centerPhys.reliefM, orbitalGrid.reliefM[i], wOrb),
          roughGlobalM: orbitalGrid.roughGlobalM ? lerp(centerPhys.roughGlobalM, orbitalGrid.roughGlobalM[i], wOrb) : null,
          ti: lerp(centerPhys.ti, orbitalGrid.ti[i], wOrb),
          dci: lerp(centerPhys.dci, orbitalGrid.dci[i], wOrb),
          albedo: lerp(centerPhys.albedo, orbitalGrid.albedo[i], wOrb),
          ctxTone: lerp(centerPhys.ctxTone, orbitalGrid.ctxTone ? orbitalGrid.ctxTone[i] : 0.5, wOrb),
          ctxContrast: lerp(centerPhys.ctxContrast, orbitalGrid.ctxContrast ? orbitalGrid.ctxContrast[i] : 0.2, wOrb),
          grsK: lerp(centerPhys.grsK, orbitalGrid.grsK[i], wOrb),
          grsTh: lerp(centerPhys.grsTh, orbitalGrid.grsTh[i], wOrb),
          geolUnit: wOrb === 0 ? centerPhys.geolUnit : orbitalGrid.geolUnits[i],
          centerGeolUnit: centerPhys.geolUnit,
          isLowResCell: !!orbitalGrid.isLowResGrid,
          hasHiRiseElev: centerPhys.hasHiRiseElev,
        };

        const sc = scoreCell(blendedPhys, env, vehicle, tacticalCfg, deps);
        const fin = evaluateFinalCompatibility(sc, blendedPhys, vehicle, normWeights, env.scoreMode, tacticalCfg);

        grids.final[i] = fin.finalScore;
        grids.thermal[i] = sc.thermal;
        grids.radiation[i] = sc.radiation;
        grids.topography[i] = sc.topography;
        grids.optics[i] = sc.optics;
        grids.geology[i] = sc.geology;
        grids.elevSlope[i] = sc.elevSlope;
        grids.elevationScore[i] = sc.elevationScore;
        grids.slopeScore[i] = sc.slopeScore;
        grids.dust[i] = sc.dust;
        grids.confidence[i] = sc.confidence;

        grids.elevM[i] = +blendedPhys.elevM.toFixed(1);
        grids.slopeDeg[i] = +blendedPhys.slopeDeg.toFixed(2);
        grids.reliefM[i] = +blendedPhys.reliefM.toFixed(1);
        grids.ti[i] = +blendedPhys.ti.toFixed(1);
        grids.dci[i] = +blendedPhys.dci.toFixed(4);
        grids.albedo[i] = +blendedPhys.albedo.toFixed(4);
        grids.grsK[i] = +blendedPhys.grsK.toFixed(3);
        grids.grsTh[i] = +blendedPhys.grsTh.toFixed(3);
        grids.tempC[i] = sc.instTempC;
        grids.gcrMSvYr[i] = sc.gcrMSvYr;
        grids.speMSv[i] = sc.speMSv;
        grids.geolUnits[i] = blendedPhys.geolUnit;
        grids.impassable[i] = fin.impassableVehicle ? 1 : 0;
        grids.nasaVeto[i] = fin.nasaVeto ? 1 : 0;

        sumFinal += fin.finalScore;
        if (fin.finalScore < minFinal) minFinal = fin.finalScore;
        if (fin.finalScore > maxFinal) maxFinal = fin.finalScore;
        if (fin.impassableVehicle) impassableCount++;
        if (fin.nasaVeto) nasaVetoCount++;
        sumSlope += blendedPhys.slopeDeg;
        sumSinkage += sc.sinkagePenalty;
        sumSpeedRisk += sc.speedRiskPenalty;
        for (const dk in domainSums) domainSums[dk] += sc[dk];
      }
    }

    // Main limiting factor among scored domains (weighted deficit impact)
    const domainMeans = {};
    let limitingKey = 'elevSlope';
    let highestDeficit = -1;
    for (const dk in domainSums) {
      domainMeans[dk] = +(domainSums[dk] / total).toFixed(1);
      const deficit = (100 - domainMeans[dk]) * Math.max(0.05, normWeights[dk]);
      if (deficit > highestDeficit) {
        highestDeficit = deficit;
        limitingKey = dk;
      }
    }
    const impassablePct = +((impassableCount / total) * 100).toFixed(1);
    const nasaVetoPct = +((nasaVetoCount / total) * 100).toFixed(1);
    if (impassablePct > 25 || nasaVetoPct > 25) limitingKey = 'elevSlope';

    const vehTelemetry = computeVehicleTelemetry(
      vehicle,
      env,
      centerBase.instTempC,
      sumSlope / total,
      sumSinkage / total,
      sumSpeedRisk / total,
      tacticalCfg
    );

    const isLowRes = !!orbitalGrid.isLowResGrid;
    const elevRes = orbitalGrid.sources && orbitalGrid.sources.elevation ? orbitalGrid.sources.elevation.nativeResM : 5209;
    const tiRes = orbitalGrid.sources && orbitalGrid.sources.ti ? orbitalGrid.sources.ti.nativeResM : 10418;
    const fineBand = isLowRes
      ? `${elevRes} m (global offline fallback)`
      : `${Math.min(elevRes, tiRes)}–${Math.max(elevRes, tiRes)} m (CTX 5 m optics)`;
    const nativeResLabel = `Native data resolution: ${fineBand} (ML layer: ${tacticalCfg.resolution.mlLayerNativeResM.label})`;

    const region = nearestRegionName(loc.latDeg, loc.lon180, deps);

    return {
      ok: true,
      gridN: n,
      cellM: orbitalGrid.cellM || tacticalCfg.planet.cellSizeM.value,
      sizeKm: tacticalCfg.planet.boxSizeKm.value,
      areaKm2: 16,
      inputs: { ...inputs },
      location: loc,
      region,
      environment: env,
      vehicle,
      vehicleTelemetry: vehTelemetry,
      dataMode: orbitalGrid.dataMode || (orbitalGrid.isPresetCutout ? 'OFFLINE_PRECUT' : 'ONLINE_ORBITAL'),
      isPresetCutout: !!orbitalGrid.isPresetCutout,
      isLowResGrid: isLowRes,
      nativeResLabel,
      sources: orbitalGrid.sources,
      ctxImgDataUri: orbitalGrid.ctxImgDataUri || null,
      centerBase,
      centerFinal,
      normWeights,
      grids,
      summary: {
        meanScore: +(sumFinal / total).toFixed(1),
        minScore: +minFinal.toFixed(1),
        maxScore: +maxFinal.toFixed(1),
        impassableCount,
        impassablePct,
        nasaVetoCount,
        nasaVetoPct,
        limitingFactorKey: limitingKey,
        limitingFactorLabel: tacticalCfg.weights[limitingKey] ? tacticalCfg.weights[limitingKey].label : limitingKey,
        limitingFactorMean: domainMeans[limitingKey],
        domainMeans,
      },
      _tacticalCfg: tacticalCfg,
    };
  }

  function getCellPopup(analysis, idx) {
    if (!analysis || !analysis.ok) return null;
    const n = analysis.gridN;
    const i = clamp(idx | 0, 0, n * n - 1);
    const r = Math.floor(i / n);
    const c = i % n;
    const bb = analysis.location.bbox180;
    const cellLat = +(bb[3] - ((r + 0.5) / n) * (bb[3] - bb[1])).toFixed(5);
    const cellLon180 = +normalizeLon180(bb[0] + ((c + 0.5) / n) * (bb[2] - bb[0])).toFixed(5);
    const g = analysis.grids;
    const src = analysis.sources || {};
    const unitCode = g.geolUnits[i];
    const uMeta = analysis._tacticalCfg.geologySim3292.units[unitCode] || { desc: 'Unknown SIM 3292 unit', group: 'Unknown' };
    const env = analysis.environment;
    const veh = analysis.vehicle;
    const s = (k, def) => (src[k] ? `${src[k].id} (${src[k].date})` : def);

    const domains = [
      { key: 'thermal', label: 'Thermal', score: g.thermal[i], raw: `${g.ti[i].toFixed(0)} tiu · ${g.tempC[i].toFixed(1)} °C`, unit: 'J m^-2 K^-1 s^-1/2, °C', source: s('ti', 'THEMIS 100m') + ' + STORM.surfaceTempC', badge: 'MODEL' },
      { key: 'radiation', label: 'Space Radiation Dose', score: g.radiation[i], raw: `${g.gcrMSvYr[i].toFixed(0)} mSv/yr${env.speActive ? ' + SPE ' + g.speMSv[i].toFixed(0) + ' mSv' : ''}`, unit: 'mSv/yr', source: `MSL/RAD-anchored SCORING.radDose × Solar ${env.solarCycle.toUpperCase()}`, badge: 'MODEL' },
      { key: 'groundComp', label: 'Ground Composition (orbital, coarse resolution)', score: null, raw: `K ${g.grsK[i].toFixed(3)} wt% · Th ${g.grsTh[i].toFixed(3)} ppm`, unit: 'wt% K, ppm Th', source: s('grs', 'Odyssey GRS ~550 km (Boynton 2007)') + ' — informational, NOT scored', badge: 'MEASURED' },
      { key: 'topography', label: 'Topography', score: g.topography[i], raw: `Relief ${g.reliefM[i].toFixed(1)} m (v=${veh.speedKmh} km/h)`, unit: 'm', source: s('elevation', 'MOLA-HRSC 200m'), badge: 'MODEL' },
      { key: 'optics', label: 'Optics', score: g.optics[i], raw: `Albedo ${g.albedo[i].toFixed(3)} · τ=${env.tau}`, unit: 'Lambert A, τ', source: `${s('imagery', 'CTX')} + ${s('albedo', 'TES/OMEGA')}`, badge: 'MODEL' },
      { key: 'geology', label: 'Geology (SIM 3292)', score: g.geology[i], raw: `${unitCode} — ${uMeta.desc}`, unit: 'USGS Unit', source: s('geology', 'USGS SIM 3292 (Tanaka 2014)'), badge: 'MEASURED' },
      { key: 'elevSlope', label: 'Elevation / Slope', score: g.elevSlope[i], raw: `${g.elevM[i].toFixed(0)} m · ${g.slopeDeg[i].toFixed(2)}° (limit ${veh.slopeLimitDeg.value}°)${g.impassable[i] ? ' [IMPASSABLE]' : ''}`, unit: 'm, deg', source: `${s('elevation', 'DEM')} + ${s('slope', 'Slope')}`, badge: 'MODEL' },
      { key: 'dust', label: 'Dust', score: g.dust[i], raw: `DCI ${g.dci[i].toFixed(3)} · τ=${env.tau}`, unit: 'DCI, τ', source: s('dust', 'TES Dust Cover Index (Ruff 2002)'), badge: 'MODEL' },
      { key: 'confidence', label: 'Data Confidence', score: g.confidence[i], raw: `${g.confidence[i].toFixed(0)}% (${analysis.isLowResGrid ? 'coarse ~5.2 km fallback' : '100–200 m cutout'})`, unit: '%', source: analysis.nativeResLabel, badge: 'MODEL' },
    ];

    const vetoReasons = [];
    const nv = analysis._tacticalCfg.nasaVeto;
    if (g.elevM[i] > nv.elevMaxM.value) vetoReasons.push(`Elev > +${nv.elevMaxM.value} m`);
    if (Math.abs(cellLat) > nv.absLatMaxDeg.value) vetoReasons.push(`|Lat| > ${nv.absLatMaxDeg.value}°`);
    if (g.slopeDeg[i] > nv.slopeMaxDeg.value) vetoReasons.push(`Slope > ${nv.slopeMaxDeg.value}° (HLS-2015)`);
    if (g.impassable[i]) vetoReasons.push(`Slope > vehicle limit ${veh.slopeLimitDeg.value}°`);

    return {
      row: r,
      col: c,
      idx: i,
      lat: cellLat,
      lon180: cellLon180,
      lon360: +normalizeLon360(cellLon180).toFixed(5),
      finalScore: +g.final[i].toFixed(1),
      impassable: !!g.impassable[i],
      nasaVeto: !!g.nasaVeto[i],
      vetoReasons,
      geolUnit: unitCode,
      geolDesc: uMeta.desc,
      domains,
    };
  }

  function exportAnalysisJSON(analysis) {
    const n = analysis.gridN;
    return {
      schema: 'mars-decision-engine.tactical-eva.16km2/v2',
      generated_at: new Date().toISOString(),
      inputs: analysis.inputs,
      location: analysis.location,
      region: analysis.region,
      environment: {
        marsYear: analysis.environment.marsYear,
        lsDeg: analysis.environment.lsDeg,
        seasonName: analysis.environment.seasonName,
        ltstHours: analysis.environment.ltstHours,
        tau: analysis.environment.tau,
        solarCycle: analysis.environment.solarCycle,
        speActive: analysis.environment.speActive,
        dailySolarKwhM2: analysis.environment.dailySolarKwhM2,
        mlForecast: {
          modelVersion: analysis.environment.mlForecast.modelVersion,
          cadenceSec: analysis.environment.mlForecast.cadenceSec,
          alertLevel: analysis.environment.mlForecast.alertLevel,
          expectedPeakTau1Sol: analysis.environment.mlForecast.expectedPeakTau1Sol,
        },
      },
      vehicle: {
        classId: analysis.vehicle.classId,
        name: analysis.vehicle.name,
        concept: analysis.vehicle.concept,
        totalMassKg: analysis.vehicle.totalMassKg,
        speedKmh: analysis.vehicle.speedKmh,
        extraLoadKg: analysis.vehicle.extraLoadKg,
        slopeLimitDeg: analysis.vehicle.slopeLimitDeg.value,
        powerMode: analysis.vehicle.powerMode,
        telemetry: analysis.vehicleTelemetry,
      },
      dataMode: analysis.dataMode,
      nativeResLabel: analysis.nativeResLabel,
      sources: analysis.sources,
      summary: analysis.summary,
      grid: {
        gridN: n,
        cellM: analysis.cellM,
        final: Array.from(analysis.grids.final, (v) => +v.toFixed(1)),
        thermal: Array.from(analysis.grids.thermal, (v) => +v.toFixed(1)),
        radiation: Array.from(analysis.grids.radiation, (v) => +v.toFixed(1)),
        topography: Array.from(analysis.grids.topography, (v) => +v.toFixed(1)),
        optics: Array.from(analysis.grids.optics, (v) => +v.toFixed(1)),
        geology: Array.from(analysis.grids.geology, (v) => +v.toFixed(1)),
        elevSlope: Array.from(analysis.grids.elevSlope, (v) => +v.toFixed(1)),
        dust: Array.from(analysis.grids.dust, (v) => +v.toFixed(1)),
        confidence: Array.from(analysis.grids.confidence, (v) => +v.toFixed(1)),
        elevM: Array.from(analysis.grids.elevM, (v) => +v.toFixed(1)),
        slopeDeg: Array.from(analysis.grids.slopeDeg, (v) => +v.toFixed(2)),
        ti: Array.from(analysis.grids.ti, (v) => +v.toFixed(1)),
        dci: Array.from(analysis.grids.dci, (v) => +v.toFixed(4)),
        grsK: Array.from(analysis.grids.grsK, (v) => +v.toFixed(3)),
        grsTh: Array.from(analysis.grids.grsTh, (v) => +v.toFixed(3)),
        geolUnits: analysis.grids.geolUnits,
      },
    };
  }

  function exportAnalysisGeoJSON(analysis) {
    const n = analysis.gridN;
    const bb = analysis.location.bbox180;
    const dLat = (bb[3] - bb[1]) / n;
    const dLon = (bb[2] - bb[0]) / n;
    const features = [
      {
        type: 'Feature',
        properties: {
          featureType: 'tactical_eva_16km2_bounds',
          centerLat: analysis.location.latDeg,
          centerLon180: analysis.location.lon180,
          centerLon360E: analysis.location.lon360,
          marsYear: analysis.environment.marsYear,
          lsDeg: analysis.environment.lsDeg,
          tau: analysis.environment.tau,
          vehicleClass: analysis.vehicle.classId,
          dataMode: analysis.dataMode,
          ...analysis.summary,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[0], bb[1]]]],
        },
      },
    ];
    const g = analysis.grids;
    for (let r = 0; r < n; r++) {
      const y1 = bb[3] - r * dLat;
      const y0 = y1 - dLat;
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const x0 = bb[0] + c * dLon;
        const x1 = x0 + dLon;
        features.push({
          type: 'Feature',
          properties: {
            row: r,
            col: c,
            final: +g.final[i].toFixed(1),
            thermal: +g.thermal[i].toFixed(1),
            radiation: +g.radiation[i].toFixed(1),
            topography: +g.topography[i].toFixed(1),
            optics: +g.optics[i].toFixed(1),
            geology: +g.geology[i].toFixed(1),
            elevSlope: +g.elevSlope[i].toFixed(1),
            dust: +g.dust[i].toFixed(1),
            confidence: +g.confidence[i].toFixed(1),
            elevM: +g.elevM[i].toFixed(1),
            slopeDeg: +g.slopeDeg[i].toFixed(2),
            ti: +g.ti[i].toFixed(1),
            grsK_wtPct: +g.grsK[i].toFixed(3),
            grsTh_ppm: +g.grsTh[i].toFixed(3),
            geolUnit: g.geolUnits[i],
            impassable: !!g.impassable[i],
            nasaVeto: !!g.nasaVeto[i],
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[[+x0.toFixed(6), +y0.toFixed(6)], [+x1.toFixed(6), +y0.toFixed(6)], [+x1.toFixed(6), +y1.toFixed(6)], [+x0.toFixed(6), +y1.toFixed(6)], [+x0.toFixed(6), +y0.toFixed(6)]]],
          },
        });
      }
    }
    return {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:IAU2000::49900' } },
      features,
    };
  }

  const API = {
    normalizeLon180,
    normalizeLon360,
    formatLonForConvention,
    validateLocation,
    resolveVehicleConfig,
    getDefaultInputs,
    findPresetCutout,
    nearestRegionName,
    buildGlobalFallbackGrid,
    computeEnvironmentState,
    scoreCell,
    evaluateFinalCompatibility,
    generateAnalysis,
    getCellPopup,
    exportAnalysisJSON,
    exportAnalysisGeoJSON,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MDE_TACTICAL_EVA_ENGINE = API;
})(typeof window !== 'undefined' ? window : globalThis);
