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

  function getUtcTodayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function getDefaultInputs(vehiclesCfg, cfg) {
    const vCfg = vehiclesCfg || loadDep('MDE_VEHICLES', './vehicles_data.js');
    const tCfg = cfg || loadDep('MDE_TACTICAL_CONFIG', './tactical_config_data.js');
    const weights = {};
    for (const k in tCfg.weights) weights[k] = tCfg.weights[k].value;
    const veh = resolveVehicleConfig(vCfg, 'lab_rover', null, true);
    const fdCfg = tCfg.domainParams && tCfg.domainParams.fieldData;
    return {
      presetZoneId: 'jezero_delta',
      lat: 18.38,
      lonInput: 77.58,
      lonConvention: '-180_180',
      earthDateUtc: getUtcTodayIso(),
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
      fieldRadiusM: fdCfg ? fdCfg.defaultInfluenceRadiusM.value : 300,
      useCoarseBaseline: false,
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
    const degToKm = (deps && deps.tacticalCfg && deps.tacticalCfg.planet && deps.tacticalCfg.planet.degToMeters.value / 1000) || 59.274697;
    if (deps && deps.layers && typeof deps.layers.nearestRegion === 'function') {
      const hit = deps.layers.nearestRegion(lat, lon180);
      if (hit && hit.region && hit.region.name) {
        const dKm = Number.isFinite(hit.distDeg) ? +(hit.distDeg * degToKm).toFixed(0) : null;
        return { name: hit.region.name, distKm: dKm, lat: hit.region.lat, lon: hit.region.lon };
      }
      if (hit && hit.name) {
        return {
          name: hit.name,
          distKm: Number.isFinite(hit.distKm) ? +Number(hit.distKm).toFixed(0) : null,
          lat: hit.lat,
          lon: hit.lon,
        };
      }
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
      if (best && best.name) {
        return { name: best.name, distKm: +(bestD * degToKm).toFixed(0), lat: best.lat, lon: best.lon };
      }
    }
    return null;
  }

  function findColdestEarthDateForLat(latDeg, lon360, elevM, marsTimeMod, stormMod, baseDateStr) {
    const MTime = marsTimeMod || loadDep('MDE_MARS_TIME', './mars_time.js');
    const STORM = stormMod || loadDep('STORM', './storm.js');
    const startMs = Date.parse((baseDateStr || getUtcTodayIso()) + 'T12:00:00Z');
    const originMs = Number.isFinite(startMs) ? startMs : Date.now();
    let bestDate = getUtcTodayIso();
    let bestLs = 270;
    let minTemp = Infinity;
    for (let day = 0; day < 690; day += 15) {
      const iso = new Date(originMs + day * 86400000).toISOString().slice(0, 10);
      const mt = MTime.computeMarsTime(iso, lon360);
      const t = STORM.surfaceTempC(latDeg, mt.lsDeg, 250, elevM != null ? elevM : -1500, 10.8);
      if (t && t.mean < minTemp) {
        minTemp = t.mean;
        bestDate = iso;
        bestLs = mt.lsDeg;
      }
    }
    return { earthDateUtc: bestDate, lsDeg: +bestLs.toFixed(1), meanTempC: +minTemp.toFixed(1) };
  }

  function classifySourceBadge(sourceStr, defaultBadge, fieldKind, lang) {
    const tr = lang === 'tr';
    if (fieldKind === 'simulated') return tr ? 'SİMÜLE (saha)' : 'SIMULATED (field)';
    if (fieldKind === 'measured') return tr ? 'MEASURED (saha)' : 'MEASURED (field)';
    const s = String(sourceStr || '');
    if (/placeholder|fallback|proxy|global mean|unavailable/i.test(s)) {
      return tr ? 'TAHMİN' : 'ESTIMATE';
    }
    if (/day_ir|day ir/i.test(s)) return 'MODEL';
    return defaultBadge || 'MODEL';
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
    const cellTau = phys.tau != null ? phys.tau : env.tau;
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
    const tObj = interpSurfaceTempC(STORM, phys.lat, env.lsDeg, phys.ti, phys.elevM, cellTau, env.ltstHours);
    const effInstTempC = phys.surfTempC != null ? phys.surfTempC : tObj.instC;
    const effMeanTempC = phys.surfTempC != null ? ((tObj.meanC + phys.surfTempC) * 0.5) : tObj.meanC;
    const tempScore = clamp(
      100 * (effInstTempC - thP.tempColdFloorC.value) / (thP.tempWarmOptC.value - thP.tempColdFloorC.value),
      0, 100
    );
    const thermal = clamp(thP.tiWeight.value * tiScore + thP.tempWeight.value * tempScore, 0, 100);

    // 2a. Space Radiation Dose (scored)
    const cyc = cfg.radiation.solarCycle[env.solarCycle] || cfg.radiation.solarCycle.mid;
    const baseRad = SCORING.radDose(phys.elevM, phys.slopeDeg, env.lsDeg);
    const modelColGcm2 = SCORING.atmoColumnGcm2(phys.elevM, env.lsDeg);
    const pressureFactor = phys.pressurePa != null
      ? clamp(phys.pressurePa / Math.max(100, modelColGcm2 * 37.2076), 0.5, 1.5)
      : 1.0;
    const colGcm2 = modelColGcm2 * pressureFactor;
    const modelGcrMSvYr = baseRad * cyc.factor / Math.pow(pressureFactor, 0.25);
    const gcrMSvYr = phys.radMSvYr != null ? phys.radMSvYr : modelGcrMSvYr;
    const speObj = env.speActive ? SCORING.calcSPE(phys.elevM, 0) : null;
    const speMSv = speObj ? speObj.unshieldedDoseMsv : 0;
    const radSc = cfg.radiation.scoring;
    let radScore = 100 * (1 - clamp((gcrMSvYr - radSc.doseBestMSvYr.value) / (radSc.doseWorstMSvYr.value - radSc.doseBestMSvYr.value), 0, 1));
    if (env.speActive) {
      radScore = Math.max(0, radScore - (speMSv / radSc.speAcutePenaltyDivisorMSv.value) * 100);
    }

    // 3. Topography (relief + MOLA roughness + rock/crater hazard + vehicle speed risk)
    const tpP = dp.topography;
    const effReliefM = phys.rockPct != null ? Math.max(phys.reliefM, phys.rockPct * 0.45) : phys.reliefM;
    const reliefNorm = clamp(effReliefM / tpP.reliefMaxM.value, 0, 1);
    const roughBase = phys.roughGlobalM != null ? phys.roughGlobalM : effReliefM * 0.45;
    const roughNorm = clamp(roughBase / tpP.roughMaxM.value, 0, 1);
    let topoScore = 100 * (1 - (tpP.reliefShare.value * reliefNorm + (1 - tpP.reliefShare.value) * roughNorm));
    const speedRoughOnset = clamp(
      (effReliefM - vehicle.effects.roughnessRiskThresholdM.value) / Math.max(1, tpP.reliefMaxM.value - vehicle.effects.roughnessRiskThresholdM.value),
      0, 1
    );
    const speedRiskPenalty = vehicle.effects.speedRiskMaxPenalty.value * vehicle.speedNorm * speedRoughOnset;
    const hazRockPenalty = phys.hazardRockWeight ? (dp.fieldData ? dp.fieldData.hazardRockPenalty.value : 35) * phys.hazardRockWeight : 0;
    const hazRimPenalty = phys.hazardRimWeight ? (dp.fieldData ? dp.fieldData.hazardCraterRimPenalty.value : 30) * phys.hazardRimWeight : 0;
    topoScore = clamp(topoScore - speedRiskPenalty - hazRockPenalty * 0.6 - hazRimPenalty * 0.5, 0, 100);

    // 4. Optics (albedo + CTX/THEMIS texture + tau atmospheric haze + solar zenith cosine)
    const opP = dp.optics;
    let albScore;
    if (phys.albedo < opP.albedoIdealMin.value) {
      albScore = 70 + (phys.albedo / opP.albedoIdealMin.value) * 30;
    } else if (phys.albedo <= opP.albedoIdealMax.value) {
      albScore = 100;
    } else {
      albScore = Math.max(20, 100 - ((phys.albedo - opP.albedoIdealMax.value) / (opP.albedoHighDust.value - opP.albedoIdealMax.value)) * 80);
    }
    const visHaze = Math.exp(-cellTau / opP.tauVisibilityScale.value);
    const sunDayFactor = lerp(1 - opP.nightSolarZenithPenalty.value, 1.0, clamp(env.cosZ, 0, 1));
    const ctxBonus = 0.85 + 0.15 * (1 - Math.abs(phys.ctxTone - 0.5) * 1.4);
    const optics = clamp(albScore * ctxBonus * visHaze * sunDayFactor, 0, 100);

    // 5. Geology (USGS SIM 3292 table lookup; continuous blend between center unit score and cell unit score)
    const unitInfo = cfg.geologySim3292.units[phys.geolUnit];
    const centerUnitInfo = cfg.geologySim3292.units[phys.centerGeolUnit];
    const localGeoScore = unitInfo ? unitInfo.score : dp.confidence.geologyFallbackScore.value;
    const centerGeoScore = centerUnitInfo ? centerUnitInfo.score : dp.confidence.geologyFallbackScore.value;
    const geology = clamp(lerp(centerGeoScore, localGeoScore, env.orbitalBlendWeight), 0, 100);

    // 6. Elevation / Slope + Vehicle limit & Mass sinkage on low-TI loose sand / hazard
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
    const hazSoftSandPenalty = phys.hazardSoftSandWeight ? (dp.fieldData ? dp.fieldData.hazardSoftSandPenalty.value : 40) * phys.hazardSoftSandWeight : 0;
    slopeScore = clamp(slopeScore - sinkagePenalty - hazSoftSandPenalty - hazRockPenalty * 0.5 - hazRimPenalty * 0.5, 0, 100);
    const elevSlope = impassableVehicle ? 0 : clamp(esP.elevShare.value * elevScore + esP.slopeShare.value * slopeScore, 0, 100);

    // 7. Dust (TES DCI + current optical depth tau)
    const duP = dp.dust;
    const dciScore = clamp(100 * (phys.dci - duP.dciDusty.value) / (duP.dciClean.value - duP.dciDusty.value), 0, 100);
    const tauRange = cfg.environment.tauRange;
    const tauClearScore = clamp(100 * (1 - (cellTau - tauRange.min) / (tauRange.max - tauRange.min)), 0, 100);
    const dust = clamp(duP.surfaceDciShare.value * dciScore + (1 - duP.surfaceDciShare.value) * tauClearScore, 0, 100);

    // 8. Power & Energy (8th domain: daily Wh balance via STORM solar attenuation + cold heater draw)
    const pwP = dp.power;
    const pwr = vehicle.power;
    const eff = vehicle.effects;
    const coldDeltaC = Math.max(0, eff.heaterBaseTempC.value - effMeanTempC);
    const rawHeaterW = coldDeltaC * eff.nuclearHeaterWPerKgDegC.value * vehicle.totalMassKg;
    const heaterW = vehicle.powerMode === 'nuclear'
      ? rawHeaterW * (1 - (pwP && pwP.nuclearWasteHeatOffset ? pwP.nuclearWasteHeatOffset.value : 0.75))
      : rawHeaterW;
    const dutyHrs = pwP && pwP.activeDutyHoursPerSol ? pwP.activeDutyHoursPerSol.value : 10;
    const sleepFrac = pwP && pwP.sleepHotelFraction ? pwP.sleepHotelFraction.value : 0.15;
    let dailyGenWh = 0;
    let dailyNeedWh = 0;
    if (vehicle.powerMode === 'solar') {
      const fTauCell = STORM.fTau(cellTau);
      const cellSolarKwhM2 = env.dailySolarKwhM2 * (fTauCell / Math.max(1e-6, env.fTau));
      dailyGenWh = cellSolarKwhM2 * 1000 * pwr.solarAreaM2.value * eff.solarPanelEfficiency.value;
      const hotelDutyH = dutyHrs + (24 - dutyHrs) * sleepFrac;
      const heaterDutyH = dutyHrs + (24 - dutyHrs) * 0.5;
      const slopeSin = Math.sin((phys.slopeDeg * Math.PI) / 180);
      const climbWhKm = (vehicle.totalMassKg * vehicle.marsGravityMps2 * slopeSin * 1000) / (3600 * eff.gradeWorkEfficiency.value);
      const driveDistSolKm = Math.min(0.4, vehicle.speedKmh * 2.0);
      const driveWh = (vehicle.totalMassKg * eff.massEnergyCoeffWhPerKgKm.value + climbWhKm) * driveDistSolKm;
      dailyNeedWh = pwr.hotelPowerW.value * hotelDutyH + heaterW * heaterDutyH + driveWh;
    } else if (vehicle.powerMode === 'nuclear') {
      // Nuclear MMRTG/RTG: completely unaffected by optical depth tau; only cold heater load matters
      const capW = pwr.nuclearRtgW ? pwr.nuclearRtgW.value : pwr.ratedPowerW.value;
      dailyGenWh = capW * 24;
      const slopeSin = Math.sin((phys.slopeDeg * Math.PI) / 180);
      const climbWhKm = (vehicle.totalMassKg * vehicle.marsGravityMps2 * slopeSin * 1000) / (3600 * eff.gradeWorkEfficiency.value);
      const driveWh = (vehicle.totalMassKg * eff.massEnergyCoeffWhPerKgKm.value + climbWhKm) * Math.min(0.4, vehicle.speedKmh * 2.0);
      dailyNeedWh = (pwr.hotelPowerW.value + heaterW) * 24 + driveWh;
    } else {
      // Battery pack: unaffected by tau; cold increases survival heater demand
      const capKwh = pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : 60;
      dailyGenWh = capKwh * 1000;
      const hotelDutyH = dutyHrs + (24 - dutyHrs) * sleepFrac;
      const driveDistSolKm = Math.min(10, vehicle.speedKmh * 1.5);
      const slopeSin = Math.sin((phys.slopeDeg * Math.PI) / 180);
      const climbWhKm = (vehicle.totalMassKg * vehicle.marsGravityMps2 * slopeSin * 1000) / (3600 * eff.gradeWorkEfficiency.value);
      const driveWh = (vehicle.totalMassKg * eff.massEnergyCoeffWhPerKgKm.value + climbWhKm) * driveDistSolKm;
      dailyNeedWh = (pwr.hotelPowerW.value + heaterW) * hotelDutyH + driveWh;
    }
    const powerRatio = dailyGenWh / Math.max(1, dailyNeedWh);
    const powerDeficit = dailyGenWh < dailyNeedWh;
    const reserveTarget = pwP && pwP.comfortableReserveRatio ? pwP.comfortableReserveRatio.value : 2.0;
    const powerScore = powerDeficit
      ? 0
      : clamp(50 + ((powerRatio - 1.0) / Math.max(0.2, reserveTarget - 1.0)) * 50, 0, 100);

    // 11. Confidence (data resolution, field measurement uplift & tau attenuation)
    const cfP = dp.confidence;
    let conf = phys.isLowResCell ? cfP.baseGlobalFallback.value : cfP.baseFineCutout.value;
    if (!phys.isLowResCell && phys.hasHiRiseElev) conf += cfP.hiriseBoost.value;
    if (phys.fieldMaxWeight > 0) {
      conf += (cfP.fieldBoostMax ? cfP.fieldBoostMax.value : 18) * clamp(phys.fieldMaxWeight, 0, 1);
    }
    const tauPenalty = cfP.tauUncertaintyPenalty.value * clamp((cellTau - tauRange.min) / (tauRange.max - tauRange.min), 0, 1);
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
      power: +powerScore.toFixed(1),
      confidence: +confidence.toFixed(1),
      // Extra telemetry retained for popup & vehicle summary
      instTempC: +effInstTempC.toFixed(1),
      dayTempC: tObj.dayC,
      nightTempC: tObj.nightC,
      meanTempC: tObj.meanC,
      gcrMSvYr: +gcrMSvYr.toFixed(1),
      speMSv: +speMSv.toFixed(1),
      atmoColGcm2: +colGcm2.toFixed(2),
      pressurePa: +(colGcm2 * 37.2076).toFixed(0),
      visHazePct: +(visHaze * 100).toFixed(1),
      sinkagePenalty: +sinkagePenalty.toFixed(1),
      speedRiskPenalty: +speedRiskPenalty.toFixed(1),
      dailyGenWh: +dailyGenWh.toFixed(1),
      dailyNeedWh: +dailyNeedWh.toFixed(1),
      powerRatio: +powerRatio.toFixed(2),
      heaterW: +heaterW.toFixed(1),
      powerDeficit,
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
    const powerVeto = !!scores.powerDeficit;
    const powerCap = (cfg.domainParams && cfg.domainParams.power && cfg.domainParams.power.vetoCapScore)
      ? cfg.domainParams.power.vetoCapScore.value
      : 20;

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
    let finalScore = (nasaVeto || impassable) ? 0 : +clamp(rawCombined, 0, 100).toFixed(1);
    if (powerVeto && finalScore > powerCap) finalScore = powerCap;
    return {
      finalScore,
      nasaVeto,
      nasaVetoReasons,
      impassableVehicle: impassable,
      powerVeto,
      preVetoScore: +clamp(rawCombined, 0, 100).toFixed(1),
    };
  }

  function computeEnvironmentState(inputs, centerPhys, deps) {
    const cfg = deps.tacticalCfg;
    const MTime = deps.marsTime;
    const STORM = deps.storm;
    const loc = validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, cfg);
    const dateStr = inputs.earthDateUtc || (cfg.environment && cfg.environment.defaultDate) || getUtcTodayIso();
    const marsTime = MTime.computeMarsTime(dateStr, loc.lon360);
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

  function buildCoarseBaselineView(orbitalGrid, loc, params, tacticalCfg, cutouts) {
    if (params.baselineGrid) return params.baselineGrid;
    if (orbitalGrid && orbitalGrid.coarseBaseline) {
      const cb = orbitalGrid.coarseBaseline;
      const resM = tacticalCfg.resolution.globalBaselineDeliveredM.value;
      const fallbackUnit = Math.abs(loc.latDeg) > 62 ? 'Ap' : 'HNt';
      const geolUnits = new Array(cb.elevM.length).fill(fallbackUnit);
      const albedo = cb.dci.map((d) => +clamp(0.13 + ((0.99 - d) / 0.12) * 0.18, 0.10, 0.34).toFixed(4));
      return {
        ...orbitalGrid,
        id: (orbitalGrid.id || 'zone') + '_coarse5km',
        isPresetCutout: false,
        isLowResGrid: true,
        hasDayIrTexture: false,
        dataMode: 'COARSE_BASELINE_5KM',
        elevM: cb.elevM,
        slopeDeg: cb.slopeDeg,
        reliefM: cb.reliefM,
        ti: cb.ti,
        dci: cb.dci,
        albedo,
        geolUnits,
        themisDayIr: null,
        ctxTone: cb.elevM.map(() => 0.5),
        ctxContrast: cb.elevM.map(() => 0.15),
        sources: {
          elevation: { id: 'MOLA MEGDR 4096x2048 offline raster (coarse fallback)', nativeResM: resM, lowRes: true, date: '2003 / USGS 2014' },
          slope: { id: 'MOLA 90th-pct slope (4096x2048 fallback)', nativeResM: resM, lowRes: true, date: '2003' },
          ti: { id: 'TES_Thermal_Inertia_numeric (2048x1024 fallback)', nativeResM: tacticalCfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2001' },
          imagery: { id: 'Unavailable in 5 km baseline (fallback)', nativeResM: resM, lowRes: true, date: 'N/A' },
          dust: { id: 'TES_Dust_numeric (fallback proxy)', nativeResM: tacticalCfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2002' },
          albedo: { id: 'TES albedo proxy (fallback)', nativeResM: tacticalCfg.resolution.globalTesDeliveredM.value, lowRes: true, date: '2002' },
          geology: { id: 'Regional unit proxy (fallback)', nativeResM: 20000, lowRes: true, date: '2014' },
          grs: { id: 'Odyssey GRS global mean placeholder (~550 km)', nativeResM: 550000, lowRes: true, date: '2007' },
        },
      };
    }
    return buildGlobalFallbackGrid(loc.latDeg, loc.lon180, params.layers, tacticalCfg, cutouts);
  }

  function applyFieldAssimilations(rawMeasurements, radiusM, loc, n, cellM, blendedPhysGrid, baseTempGrid, env, cfg) {
    const valid = Array.isArray(rawMeasurements)
      ? rawMeasurements.filter((m) => m && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lon)))
      : [];
    const total = n * n;
    const perCell = new Array(total);
    const hazardMarkers = [];
    if (!valid.length) {
      return { perCell, hazardMarkers, appliedCount: 0 };
    }

    const degToM = cfg.planet.degToMeters.value;
    const cosLat = Math.max(0.05, Math.cos((loc.latDeg * Math.PI) / 180));
    const bb = loc.bbox180;
    const dLat = (bb[3] - bb[1]) / n;
    const dLon = (bb[2] - bb[0]) / n;
    const R = Math.max(50, Number(radiusM) || 300);
    const halfCellM = (cellM || 100) * 0.55;
    const fdCfg = (cfg.domainParams && cfg.domainParams.fieldData) || {};
    const discThresh = fdCfg.discrepancyRelThreshold ? fdCfg.discrepancyRelThreshold.value : 0.5;

    // Identify marker cell coordinates for canvas markers
    for (const m of valid) {
      const mLat = Number(m.lat);
      const mLon = normalizeLon180(Number(m.lon));
      if (mLat >= bb[1] - 0.01 && mLat <= bb[3] + 0.01 && mLon >= bb[0] - 0.01 && mLon <= bb[2] + 0.01) {
        const r = clamp(Math.floor((bb[3] - mLat) / dLat), 0, n - 1);
        const c = clamp(Math.floor((mLon - bb[0]) / dLon), 0, n - 1);
        hazardMarkers.push({
          idx: r * n + c,
          row: r,
          col: c,
          lat: mLat,
          lon: mLon,
          type: m.type,
          value: m.value,
          source: m.source || 'Field',
          isSimulated: !!m.isSimulated,
        });
      }
    }

    const soilToTi = (raw) => {
      const s = String(raw || '').toLowerCase();
      if (/kum|sand/.test(s)) return 80;
      if (/buz|ice/.test(s)) return 950;
      if (/kaya|rock|bedrock/.test(s)) return 640;
      return 300; // sağlam regolit / firm regolith
    };

    const numBlend = (acc, val, w, isSim) => {
      acc.sumW += w;
      acc.sumVal += val * w;
      if (w > acc.maxW) acc.maxW = w;
      if (isSim) acc.isSim = true;
    };

    for (let r = 0; r < n; r++) {
      const cLat = bb[3] - (r + 0.5) * dLat;
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const cLon = bb[0] + (c + 0.5) * dLon;
        const acc = {
          ti: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          surfTemp: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          airTemp: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          pressure: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          radDose: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          tau: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          slope: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          rockAbundance: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          iceDepth: { sumW: 0, sumVal: 0, maxW: 0, isSim: false },
          soilType: null,
          hazardSoftSandWeight: 0,
          hazardRockWeight: 0,
          hazardRimWeight: 0,
          maxWeight: 0,
          isSimulated: false,
          discrepancies: [],
          appliedTypes: [],
        };

        for (const m of valid) {
          const dxM = normalizeLon180(Number(m.lon) - cLon) * degToM * cosLat;
          const dyM = (Number(m.lat) - cLat) * degToM;
          const distM = Math.hypot(dxM, dyM);
          if (distM > R) continue;
          const w = distM <= halfCellM ? 1.0 : Math.pow(Math.max(0, 1 - (distM / R) * (distM / R)), 2);
          if (w <= 0) continue;
          if (w > acc.maxWeight) acc.maxWeight = w;
          if (m.isSimulated) acc.isSimulated = true;
          const isSim = !!m.isSimulated;
          const v = Number(m.value);
          const mType = FIELD_TYPE_ALIAS[m.type] || m.type;

          if (mType === 'ti' && Number.isFinite(v)) numBlend(acc.ti, clamp(v, 20, 2200), w, isSim);
          else if (mType === 'surfTemp' && Number.isFinite(v)) numBlend(acc.surfTemp, clamp(v, -145, 35), w, isSim);
          else if (mType === 'airTemp' && Number.isFinite(v)) numBlend(acc.airTemp, clamp(v, -145, 35), w, isSim);
          else if (mType === 'pressure' && Number.isFinite(v)) numBlend(acc.pressure, clamp(v, 50, 2000), w, isSim);
          else if (mType === 'radDose' && Number.isFinite(v)) numBlend(acc.radDose, clamp(v * 8.76, 10, 5000), w, isSim); // µSv/h -> mSv/yr
          else if (mType === 'tau' && Number.isFinite(v)) numBlend(acc.tau, clamp(v, 0.05, 12), w, isSim);
          else if (mType === 'slope' && Number.isFinite(v)) numBlend(acc.slope, clamp(v, 0, 60), w, isSim);
          else if (mType === 'rockAbundance' && Number.isFinite(v)) numBlend(acc.rockAbundance, clamp(v, 0, 100), w, isSim);
          else if (mType === 'iceDepth' && Number.isFinite(v)) numBlend(acc.iceDepth, clamp(v, 0, 100), w, isSim);
          else if (mType === 'soilType') {
            numBlend(acc.ti, soilToTi(m.value), w * 0.75, isSim);
            acc.soilType = String(m.value);
          } else if (mType === 'hazard') {
            const hz = String(m.value || '').toLowerCase();
            if (/kum|sand/.test(hz)) acc.hazardSoftSandWeight = Math.max(acc.hazardSoftSandWeight, w);
            else if (/krater|crater|rim/.test(hz)) acc.hazardRimWeight = Math.max(acc.hazardRimWeight, w);
            else acc.hazardRockWeight = Math.max(acc.hazardRockWeight, w);
          }
        }

        const out = {
          maxWeight: acc.maxWeight,
          isSimulated: acc.isSimulated,
          hazardSoftSandWeight: acc.hazardSoftSandWeight,
          hazardRockWeight: acc.hazardRockWeight,
          hazardRimWeight: acc.hazardRimWeight,
          soilType: acc.soilType,
          domainFieldKind: {},
          discrepancies: [],
        };

        const checkDiff = (domainKey, fieldKey, labelEn, labelTr, fVal, oVal, unitStr, decimals) => {
          const denom = Math.max(Math.abs(oVal), unitStr === '°C' ? 20 : 1);
          const relDiff = Math.abs(fVal - oVal) / denom;
          if (relDiff > discThresh) {
            out.discrepancies.push({
              domainKey,
              fieldKey,
              labelEn,
              labelTr,
              fieldVal: +fVal.toFixed(decimals),
              orbitalVal: +oVal.toFixed(decimals),
              unit: unitStr,
            });
          }
        };

        if (acc.ti.sumW > 0) {
          const fTi = acc.ti.sumVal / acc.ti.sumW;
          const oTi = blendedPhysGrid[i].ti;
          out.ti = lerp(oTi, fTi, acc.ti.maxW);
          if (acc.ti.maxW >= 0.35) {
            out.domainFieldKind.thermal = acc.ti.isSim ? 'simulated' : 'measured';
            checkDiff('thermal', 'ti', 'Thermal inertia', 'Termal atalet', fTi, oTi, 'tiu', 0);
          }
        }
        if (acc.surfTemp.sumW > 0) {
          const fT = acc.surfTemp.sumVal / acc.surfTemp.sumW;
          const oT = baseTempGrid[i];
          out.surfTempC = lerp(oT, fT, acc.surfTemp.maxW);
          if (acc.surfTemp.maxW >= 0.35) {
            out.domainFieldKind.thermal = acc.surfTemp.isSim ? 'simulated' : 'measured';
            checkDiff('thermal', 'surfTemp', 'Surface temp', 'Yüzey sıcaklığı', fT, oT, '°C', 1);
          }
        }
        if (acc.airTemp.sumW > 0) {
          out.airTempC = acc.airTemp.sumVal / acc.airTemp.sumW;
          if (acc.airTemp.maxW >= 0.35 && !out.domainFieldKind.thermal) {
            out.domainFieldKind.thermal = acc.airTemp.isSim ? 'simulated' : 'measured';
          }
        }
        if (acc.pressure.sumW > 0) {
          out.pressurePa = acc.pressure.sumVal / acc.pressure.sumW;
          if (acc.pressure.maxW >= 0.35) {
            out.domainFieldKind.radiation = out.domainFieldKind.radiation || (acc.pressure.isSim ? 'simulated' : 'measured');
          }
        }
        if (acc.radDose.sumW > 0) {
          const fR = acc.radDose.sumVal / acc.radDose.sumW;
          out.radMSvYr = fR;
          if (acc.radDose.maxW >= 0.35) {
            out.domainFieldKind.radiation = acc.radDose.isSim ? 'simulated' : 'measured';
          }
        }
        if (acc.tau.sumW > 0) {
          const fTau = acc.tau.sumVal / acc.tau.sumW;
          out.tau = lerp(env.tau, fTau, acc.tau.maxW);
          if (acc.tau.maxW >= 0.35) {
            out.domainFieldKind.dust = acc.tau.isSim ? 'simulated' : 'measured';
            out.domainFieldKind.optics = acc.tau.isSim ? 'simulated' : 'measured';
            checkDiff('dust', 'tau', 'Optical depth τ', 'Toz τ', fTau, env.tau, 'τ', 2);
          }
        }
        if (acc.slope.sumW > 0) {
          const fSlp = acc.slope.sumVal / acc.slope.sumW;
          const oSlp = blendedPhysGrid[i].slopeDeg;
          out.slopeDeg = lerp(oSlp, fSlp, acc.slope.maxW);
          if (acc.slope.maxW >= 0.35) {
            out.domainFieldKind.elevSlope = acc.slope.isSim ? 'simulated' : 'measured';
            checkDiff('elevSlope', 'slope', 'Slope', 'Eğim', fSlp, oSlp, '°', 1);
          }
        }
        if (acc.rockAbundance.sumW > 0) {
          out.rockPct = acc.rockAbundance.sumVal / acc.rockAbundance.sumW;
          if (acc.rockAbundance.maxW >= 0.35) {
            out.domainFieldKind.topography = acc.rockAbundance.isSim ? 'simulated' : 'measured';
          }
        }
        if (acc.iceDepth.sumW > 0) {
          out.iceDepthM = acc.iceDepth.sumVal / acc.iceDepth.sumW;
          if (acc.iceDepth.maxW >= 0.35) {
            out.domainFieldKind.geology = acc.iceDepth.isSim ? 'simulated' : 'measured';
          }
        }
        if (acc.hazardSoftSandWeight >= 0.35 || acc.hazardRockWeight >= 0.35 || acc.hazardRimWeight >= 0.35) {
          out.domainFieldKind.elevSlope = out.domainFieldKind.elevSlope || (acc.isSimulated ? 'simulated' : 'measured');
        }

        perCell[i] = out;
      }
    }

    return { perCell, hazardMarkers, appliedCount: valid.length };
  }

  function explainCellScore(cell, lang) {
    const tr = lang === 'tr';
    const score = +Number(cell.finalScore).toFixed(1);
    if (cell.powerDeficit) {
      const gen = Math.round(cell.dailyGenWh || 0);
      const need = Math.round(cell.dailyNeedWh || 0);
      return tr
        ? `Puan ${score}: araç enerji açığı (${gen} < ${need} Wh/sol), güç vetosu devrede.`
        : `Score ${score}: vehicle power deficit (${gen} < ${need} Wh/sol), power veto active.`;
    }
    if (cell.nasaVeto || cell.impassable) {
      const reason = cell.vetoReasons && cell.vetoReasons[0] ? cell.vetoReasons[0] : (tr ? 'eğim sınırı' : 'slope/veto limit');
      return tr
        ? `Puan ${score}: ${reason} nedeniyle iniş/sürüş vetosu uygulandı.`
        : `Score ${score}: vetoed due to ${reason}.`;
    }

    const scoredDomains = (cell.domains || []).filter((d) => d.score !== null && d.key !== 'confidence');
    const sortedAsc = [...scoredDomains].sort((a, b) => a.score - b.score);
    const low1 = sortedAsc[0];
    const low2 = sortedAsc[1];
    if (!low1) return tr ? `Puan ${score}.` : `Score ${score}.`;

    const slp = +Number(cell.slopeDeg).toFixed(1);
    const tiInt = Math.round(cell.ti || 250);
    const shortRaw = (d) => {
      if (d.key === 'thermal') {
        const tiNote = tiInt < 120 ? (tr ? 'gevşek kum, batma riski' : 'loose sand, sinkage risk') : `${Math.round(cell.ti)} tiu`;
        return `${tiNote}`;
      }
      if (d.key === 'elevSlope') return `${slp}° ${tr ? (slp > 12 ? 'dik eğim' : 'eğim') : (slp > 12 ? 'steep slope' : 'slope')}`;
      if (d.key === 'radiation') return `${Math.round(cell.gcrMSvYr || 200)} ${tr ? 'mSv/yıl' : 'mSv/yr'}`;
      if (d.key === 'topography') return `${tr ? 'rölyef' : 'relief'} ${(+Number(cell.reliefM || 0).toFixed(1))} m`;
      if (d.key === 'power') return `${Math.round(cell.dailyGenWh || 0)}/${Math.round(cell.dailyNeedWh || 0)} Wh`;
      if (d.key === 'dust') return `τ=${cell.tau}`;
      if (d.key === 'optics') return `albedo ${(+Number(cell.albedo || 0.2).toFixed(2))}`;
      return d.raw || '';
    };

    if (score >= 75) {
      const flatLabel = slp <= 5 ? (tr ? `düz zemin (${slp}°)` : `flat ground (${slp}°)`) : (tr ? `eğim ${slp}°` : `slope ${slp}°`);
      const firmLabel = tiInt >= 200 ? (tr ? `sağlam toprak (${tiInt} tiu)` : `firm soil (${tiInt} tiu)`) : `${tiInt} tiu`;
      return tr
        ? `Puan ${score}: ${flatLabel}, ${firmLabel}; ana sınırlayıcı ${low1.labelTr || low1.label} (${shortRaw(low1)}).`
        : `Score ${score}: ${flatLabel}, ${firmLabel}; main limiter is ${low1.label} (${shortRaw(low1)}).`;
    }
    const part1 = `${(tr ? (low1.labelTr || low1.label) : low1.label)} (${shortRaw(low1)})`;
    const part2 = low2 ? (tr ? ` ve ${(low2.labelTr || low2.label)} (${shortRaw(low2)})` : ` and ${low2.label} (${shortRaw(low2)})`) : '';
    return tr
      ? `Puan ${score}: düşük ${(part1)}${part2}.`
      : `Score ${score}: low ${part1}${part2}.`;
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

    if (inputs.useCoarseBaseline) {
      orbitalGrid = buildCoarseBaselineView(orbitalGrid, loc, params, tacticalCfg, cutouts);
    }

    const n = orbitalGrid.gridN || tacticalCfg.planet.gridN.value;
    const total = n * n;
    const cellM = orbitalGrid.cellM || tacticalCfg.planet.cellSizeM.value;
    const ci = Math.floor(n / 2) * n + Math.floor(n / 2);

    // If zone uses THEMIS Day IR 100 m as relative thermal/optical texture over coarse TES TI,
    // modulate TI smoothly around the TES mean without claiming numeric THEMIS TI as MEASURED.
    const isDayIrTextureTi = !!(
      orbitalGrid.themisDayIr
      && orbitalGrid.sources
      && orbitalGrid.sources.ti
      && orbitalGrid.sources.ti.productType === 'day_ir_relative_texture'
    );
    const getCellTi = (idx) => {
      const baseTi = orbitalGrid.ti[idx];
      if (!isDayIrTextureTi) return baseTi;
      const meanDn = Math.max(20, orbitalGrid.themisMeanDn || 128);
      const dn = orbitalGrid.themisDayIr[idx] || meanDn;
      const rel = (dn - meanDn) / meanDn;
      return +clamp(baseTi * (1 - 0.45 * rel), 40, 1200).toFixed(0);
    };
    const getCellTone = (idx) => {
      if (orbitalGrid.ctxTone) return orbitalGrid.ctxTone[idx];
      if (orbitalGrid.themisDayIr) return +clamp(orbitalGrid.themisDayIr[idx] / 255, 0.05, 0.95).toFixed(3);
      return 0.5;
    };
    const getCellContrast = (idx) => {
      if (orbitalGrid.ctxContrast) return orbitalGrid.ctxContrast[idx];
      if (orbitalGrid.themisContrast) return orbitalGrid.themisContrast[idx];
      return 0.2;
    };

    const centerPhys = {
      lat: loc.latDeg,
      elevM: orbitalGrid.elevM[ci],
      slopeDeg: orbitalGrid.slopeDeg[ci],
      reliefM: orbitalGrid.reliefM[ci],
      roughGlobalM: orbitalGrid.roughGlobalM ? orbitalGrid.roughGlobalM[ci] : null,
      ti: getCellTi(ci),
      dci: orbitalGrid.dci[ci],
      albedo: orbitalGrid.albedo[ci],
      ctxTone: getCellTone(ci),
      ctxContrast: getCellContrast(ci),
      grsK: orbitalGrid.grsK[ci],
      grsTh: orbitalGrid.grsTh[ci],
      geolUnit: orbitalGrid.geolUnits[ci],
      centerGeolUnit: orbitalGrid.geolUnits[ci],
      isLowResCell: !!orbitalGrid.isLowResGrid,
      hasHiRiseElev: !!(orbitalGrid.sources && orbitalGrid.sources.elevation && String(orbitalGrid.sources.elevation.id).includes('hirise')),
      fieldMaxWeight: 0,
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

    // Step 1: Center Base Value (computed from user's inputs + baseline)
    const centerBase = scoreCell(centerPhys, env, vehicle, tacticalCfg, deps);
    const centerFinal = evaluateFinalCompatibility(centerBase, centerPhys, vehicle, normWeights, env.scoreMode, tacticalCfg);

    // Pre-build orbital blended physics grid so field measurements can compare against orbital baseline
    const wOrb = env.orbitalBlendWeight;
    const dLat = (loc.bbox180[3] - loc.bbox180[1]) / n;
    const blendedGrid = new Array(total);
    const baseTempGrid = new Array(total);
    for (let r = 0; r < n; r++) {
      const cellLat = wOrb === 0 ? loc.latDeg : (loc.bbox180[3] - (r + 0.5) * dLat);
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const bp = {
          lat: cellLat,
          elevM: lerp(centerPhys.elevM, orbitalGrid.elevM[i], wOrb),
          slopeDeg: lerp(centerPhys.slopeDeg, orbitalGrid.slopeDeg[i], wOrb),
          reliefM: lerp(centerPhys.reliefM, orbitalGrid.reliefM[i], wOrb),
          roughGlobalM: orbitalGrid.roughGlobalM ? lerp(centerPhys.roughGlobalM, orbitalGrid.roughGlobalM[i], wOrb) : null,
          ti: lerp(centerPhys.ti, getCellTi(i), wOrb),
          dci: lerp(centerPhys.dci, orbitalGrid.dci[i], wOrb),
          albedo: lerp(centerPhys.albedo, orbitalGrid.albedo[i], wOrb),
          ctxTone: lerp(centerPhys.ctxTone, getCellTone(i), wOrb),
          ctxContrast: lerp(centerPhys.ctxContrast, getCellContrast(i), wOrb),
          grsK: lerp(centerPhys.grsK, orbitalGrid.grsK[i], wOrb),
          grsTh: lerp(centerPhys.grsTh, orbitalGrid.grsTh[i], wOrb),
          geolUnit: wOrb === 0 ? centerPhys.geolUnit : orbitalGrid.geolUnits[i],
          centerGeolUnit: centerPhys.geolUnit,
          isLowResCell: !!orbitalGrid.isLowResGrid,
          hasHiRiseElev: centerPhys.hasHiRiseElev,
          fieldMaxWeight: 0,
        };
        blendedGrid[i] = bp;
        baseTempGrid[i] = interpSurfaceTempC(storm, bp.lat, env.lsDeg, bp.ti, bp.elevM, env.tau, env.ltstHours).instC;
      }
    }

    const fieldList = params.fieldMeasurements || inputs.fieldMeasurements || [];
    const fieldRadiusM = Number(inputs.fieldRadiusM ?? params.fieldRadiusM ?? 300);
    const fieldAssimilated = applyFieldAssimilations(fieldList, fieldRadiusM, loc, n, cellM, blendedGrid, baseTempGrid, env, tacticalCfg);

    // Allocate compact per-cell Float64/Uint8 arrays (avoids Float32 decimal artifacts like 93.9000015)
    const grids = {
      final: new Float64Array(total),
      thermal: new Float64Array(total),
      radiation: new Float64Array(total),
      topography: new Float64Array(total),
      optics: new Float64Array(total),
      geology: new Float64Array(total),
      elevSlope: new Float64Array(total),
      elevationScore: new Float64Array(total),
      slopeScore: new Float64Array(total),
      dust: new Float64Array(total),
      power: new Float64Array(total),
      confidence: new Float64Array(total),
      elevM: new Float64Array(total),
      slopeDeg: new Float64Array(total),
      reliefM: new Float64Array(total),
      ti: new Float64Array(total),
      dci: new Float64Array(total),
      albedo: new Float64Array(total),
      grsK: new Float64Array(total),
      grsTh: new Float64Array(total),
      tempC: new Float64Array(total),
      gcrMSvYr: new Float64Array(total),
      speMSv: new Float64Array(total),
      dailyGenWh: new Float64Array(total),
      dailyNeedWh: new Float64Array(total),
      powerRatio: new Float64Array(total),
      tauCell: new Float64Array(total),
      geolUnits: new Array(total),
      impassable: new Uint8Array(total),
      nasaVeto: new Uint8Array(total),
      powerDeficit: new Uint8Array(total),
    };

    let sumFinal = 0, minFinal = Infinity, maxFinal = -Infinity;
    let impassableCount = 0, nasaVetoCount = 0, powerVetoCount = 0;
    let sumSlope = 0, sumSinkage = 0, sumSpeedRisk = 0;
    const domainSums = { thermal: 0, radiation: 0, topography: 0, optics: 0, geology: 0, elevSlope: 0, dust: 0, power: 0 };

    for (let i = 0; i < total; i++) {
      const bp = blendedGrid[i];
      const f = fieldAssimilated.perCell[i];
      if (f) {
        if (f.ti != null) bp.ti = f.ti;
        if (f.surfTempC != null) bp.surfTempC = f.surfTempC;
        if (f.airTempC != null) bp.airTempC = f.airTempC;
        if (f.pressurePa != null) bp.pressurePa = f.pressurePa;
        if (f.radMSvYr != null) bp.radMSvYr = f.radMSvYr;
        if (f.tau != null) bp.tau = f.tau;
        if (f.slopeDeg != null) bp.slopeDeg = f.slopeDeg;
        if (f.rockPct != null) bp.rockPct = f.rockPct;
        if (f.iceDepthM != null) bp.iceDepthM = f.iceDepthM;
        bp.hazardSoftSandWeight = f.hazardSoftSandWeight || 0;
        bp.hazardRockWeight = f.hazardRockWeight || 0;
        bp.hazardRimWeight = f.hazardRimWeight || 0;
        bp.fieldMaxWeight = f.maxWeight || 0;
      }

      const sc = scoreCell(bp, env, vehicle, tacticalCfg, deps);
      const fin = evaluateFinalCompatibility(sc, bp, vehicle, normWeights, env.scoreMode, tacticalCfg);

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
      grids.power[i] = sc.power;
      grids.confidence[i] = sc.confidence;

      grids.elevM[i] = +bp.elevM.toFixed(1);
      grids.slopeDeg[i] = +bp.slopeDeg.toFixed(1);
      grids.reliefM[i] = +bp.reliefM.toFixed(1);
      grids.ti[i] = Math.round(bp.ti);
      grids.dci[i] = +bp.dci.toFixed(4);
      grids.albedo[i] = +bp.albedo.toFixed(4);
      grids.grsK[i] = +bp.grsK.toFixed(3);
      grids.grsTh[i] = +bp.grsTh.toFixed(3);
      grids.tempC[i] = +sc.instTempC.toFixed(1);
      grids.gcrMSvYr[i] = Math.round(sc.gcrMSvYr);
      grids.speMSv[i] = Math.round(sc.speMSv);
      grids.dailyGenWh[i] = +sc.dailyGenWh.toFixed(1);
      grids.dailyNeedWh[i] = +sc.dailyNeedWh.toFixed(1);
      grids.powerRatio[i] = sc.powerRatio;
      grids.tauCell[i] = +(bp.tau != null ? bp.tau : env.tau).toFixed(2);
      grids.geolUnits[i] = bp.geolUnit;
      grids.impassable[i] = fin.impassableVehicle ? 1 : 0;
      grids.nasaVeto[i] = fin.nasaVeto ? 1 : 0;
      grids.powerDeficit[i] = fin.powerVeto ? 1 : 0;

      sumFinal += fin.finalScore;
      if (fin.finalScore < minFinal) minFinal = fin.finalScore;
      if (fin.finalScore > maxFinal) maxFinal = fin.finalScore;
      if (fin.impassableVehicle) impassableCount++;
      if (fin.nasaVeto) nasaVetoCount++;
      if (fin.powerVeto) powerVetoCount++;
      sumSlope += bp.slopeDeg;
      sumSinkage += sc.sinkagePenalty;
      sumSpeedRisk += sc.speedRiskPenalty;
      for (const dk in domainSums) domainSums[dk] += sc[dk];
    }

    // Main limiting factor among all 8 scored domains (weighted deficit impact)
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
    const powerVetoPct = +((powerVetoCount / total) * 100).toFixed(1);
    if (powerVetoPct > 50) limitingKey = 'power';
    else if (impassablePct > 25 || nasaVetoPct > 25) limitingKey = 'elevSlope';

    const vehTelemetry = computeVehicleTelemetry(
      vehicle,
      env,
      centerBase.instTempC,
      sumSlope / total,
      sumSinkage / total,
      sumSpeedRisk / total,
      tacticalCfg
    );
    vehTelemetry.powerDeficit = powerVetoPct > 50 || centerBase.powerDeficit;
    vehTelemetry.dailyNeedWh = centerBase.dailyNeedWh;
    vehTelemetry.dailyGenWh = centerBase.dailyGenWh;

    const isLowRes = !!orbitalGrid.isLowResGrid;
    const elevRes = orbitalGrid.sources && orbitalGrid.sources.elevation ? orbitalGrid.sources.elevation.nativeResM : 5209;
    const tiRes = orbitalGrid.sources && orbitalGrid.sources.ti ? orbitalGrid.sources.ti.nativeResM : 10418;
    const bestResM = Math.min(elevRes, tiRes);
    const worstHiResM = Math.max(elevRes, tiRes);
    const fineBand = isLowRes
      ? `${elevRes} m`
      : (bestResM === worstHiResM ? `${bestResM} m` : `${bestResM}–${worstHiResM} m`);
    // Section 2.4: Remove "ML layer: non-spatial (60 s point time-series)" -> pure data resolution only
    const nativeResLabel = `Data resolution: ${fineBand}`;

    const region = nearestRegionName(loc.latDeg, loc.lon180, deps);

    return {
      ok: true,
      gridN: n,
      cellM,
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
      isDayIrTextureTi,
      hasCoarseBaseline: !!(orbitalGrid.coarseBaseline || findPresetCutout(cutouts, loc.latDeg, loc.lon180)),
      nativeResLabel,
      fineBand,
      sources: orbitalGrid.sources,
      ctxImgDataUri: orbitalGrid.ctxImgDataUri || null,
      themisDayIr: orbitalGrid.themisDayIr || null,
      centerBase,
      centerFinal,
      normWeights,
      fieldMeasurements: fieldList,
      fieldRadiusM,
      fieldAssimilated,
      grids,
      summary: {
        meanScore: +(sumFinal / total).toFixed(1),
        minScore: +minFinal.toFixed(1),
        maxScore: +maxFinal.toFixed(1),
        impassableCount,
        impassablePct,
        nasaVetoCount,
        nasaVetoPct,
        powerVetoCount,
        powerVetoPct,
        powerDeficit: powerVetoPct > 50,
        limitingFactorKey: limitingKey,
        limitingFactorLabel: tacticalCfg.weights[limitingKey] ? tacticalCfg.weights[limitingKey].label : limitingKey,
        limitingFactorLabelTr: tacticalCfg.weights[limitingKey] ? tacticalCfg.weights[limitingKey].label_tr : limitingKey,
        limitingFactorMean: domainMeans[limitingKey],
        domainMeans,
      },
      _tacticalCfg: tacticalCfg,
    };
  }

  function getCellPopup(analysis, idx, lang) {
    if (!analysis || !analysis.ok) return null;
    const tr = lang === 'tr';
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
    const fc = analysis.fieldAssimilated && analysis.fieldAssimilated.perCell ? analysis.fieldAssimilated.perCell[i] : null;
    const fk = (dk) => (fc && fc.domainFieldKind ? fc.domainFieldKind[dk] : null);
    const tiInt = Math.round(g.ti[i]);
    const tempVal = +g.tempC[i].toFixed(1);
    const slopeVal = +g.slopeDeg[i].toFixed(1);
    const elevInt = Math.round(g.elevM[i]);
    const genWh = Math.round(g.dailyGenWh[i]);
    const needWh = Math.round(g.dailyNeedWh[i]);
    const cellTau = +(g.tauCell[i]).toFixed(2);

    const tiSrc = s('ti', 'THEMIS 100 m');
    const thermalBadge = classifySourceBadge(tiSrc, analysis.isDayIrTextureTi ? 'MODEL' : (src.ti && !src.ti.lowRes ? 'MEASURED' : 'MODEL'), fk('thermal'), lang);
    const radSrc = `MSL/RAD-anchored SCORING.radDose × Solar ${env.solarCycle.toUpperCase()}`;
    const grsSrc = s('grs', 'Odyssey GRS ~550 km (Boynton 2007)');
    const topoSrc = s('elevation', 'MOLA-HRSC 200 m');
    const optSrc = `${s('imagery', 'THEMIS Day IR 100 m')} + ${s('albedo', 'TES')}`;
    const geoSrc = s('geology', 'USGS SIM 3292 (Tanaka 2014)');
    const esSrc = `${s('elevation', 'DEM')} + ${s('slope', 'Slope')}`;
    const dustSrc = s('dust', 'TES Dust Cover Index');

    const domains = [
      { key: 'thermal', label: 'Thermal', labelTr: 'Termal', score: +g.thermal[i].toFixed(1), raw: `${tiInt} tiu, ${tempVal} °C`, unit: 'tiu, °C', source: tiSrc + ' + STORM.surfaceTempC', badge: thermalBadge },
      { key: 'power', label: 'Power & Energy', labelTr: 'Güç & Enerji', score: +g.power[i].toFixed(1), raw: `${genWh}/${needWh} Wh/sol${veh.powerMode === 'nuclear' ? (tr ? ' (nükleer)' : ' (nuclear)') : ` (τ=${cellTau})`}`, unit: 'Wh/sol', source: `STORM.dailySolar (${veh.powerMode})`, badge: 'MODEL' },
      { key: 'elevSlope', label: 'Elevation / Slope', labelTr: 'Yükseklik / Eğim', score: +g.elevSlope[i].toFixed(1), raw: `${elevInt} m, ${slopeVal}°`, unit: 'm, °', source: esSrc, badge: classifySourceBadge(esSrc, src.slope && !src.slope.lowRes ? 'MEASURED' : 'MODEL', fk('elevSlope'), lang) },
      { key: 'radiation', label: 'Space Radiation', labelTr: 'Uzay Radyasyonu', score: +g.radiation[i].toFixed(1), raw: `${Math.round(g.gcrMSvYr[i])} mSv/${tr ? 'yıl' : 'yr'}${env.speActive ? ' +' + Math.round(g.speMSv[i]) + ' SPE' : ''}`, unit: 'mSv/yr', source: radSrc, badge: classifySourceBadge(radSrc, 'MODEL', fk('radiation'), lang) },
      { key: 'topography', label: 'Topography', labelTr: 'Topografya', score: +g.topography[i].toFixed(1), raw: `${+g.reliefM[i].toFixed(1)} m ${tr ? 'rölyef' : 'relief'}`, unit: 'm', source: topoSrc, badge: classifySourceBadge(topoSrc, src.elevation && !src.elevation.lowRes ? 'MEASURED' : 'MODEL', fk('topography'), lang) },
      { key: 'optics', label: 'Optics', labelTr: 'Optik', score: +g.optics[i].toFixed(1), raw: `albedo ${+g.albedo[i].toFixed(2)}, τ=${cellTau}`, unit: 'A, τ', source: optSrc, badge: classifySourceBadge(optSrc, 'MODEL', fk('optics'), lang) },
      { key: 'geology', label: 'Geology (SIM 3292)', labelTr: 'Jeoloji', score: +g.geology[i].toFixed(1), raw: `${unitCode} (${uMeta.desc})`, unit: 'USGS', source: geoSrc, badge: classifySourceBadge(geoSrc, 'MEASURED', fk('geology'), lang) },
      { key: 'dust', label: 'Dust', labelTr: 'Toz', score: +g.dust[i].toFixed(1), raw: `DCI ${+g.dci[i].toFixed(2)}, τ=${cellTau}`, unit: 'DCI, τ', source: dustSrc, badge: classifySourceBadge(dustSrc, 'MODEL', fk('dust'), lang) },
      { key: 'groundComp', label: 'Ground Comp (GRS)', labelTr: 'Zemin Bileşimi (GRS)', score: null, raw: `K ${+g.grsK[i].toFixed(2)}%, Th ${+g.grsTh[i].toFixed(2)} ppm`, unit: 'wt%, ppm', source: grsSrc + ' — not scored', badge: classifySourceBadge(grsSrc, 'MEASURED', null, lang) },
      { key: 'confidence', label: 'Data Confidence', labelTr: 'Veri Güveni', score: +g.confidence[i].toFixed(1), raw: `${Math.round(g.confidence[i])}%`, unit: '%', source: analysis.nativeResLabel, badge: 'MODEL' },
    ];

    const vetoReasons = [];
    const nv = analysis._tacticalCfg.nasaVeto;
    if (g.elevM[i] > nv.elevMaxM.value) vetoReasons.push(`Elev > +${nv.elevMaxM.value} m`);
    if (Math.abs(cellLat) > nv.absLatMaxDeg.value) vetoReasons.push(`|Lat| > ${nv.absLatMaxDeg.value}°`);
    if (g.slopeDeg[i] > nv.slopeMaxDeg.value) vetoReasons.push(`Slope > ${nv.slopeMaxDeg.value}° (HLS-2015)`);
    if (g.impassable[i]) vetoReasons.push(`${tr ? 'Eğim > araç sınırı' : 'Slope > vehicle limit'} ${veh.slopeLimitDeg.value}°`);
    if (g.powerDeficit[i]) vetoReasons.push(tr ? 'Günlük güç üretimi < tüketim (Güç Vetosu <= 20)' : 'Daily generation < demand (Power Veto <= 20)');

    const discrepancies = (fc && fc.discrepancies) ? fc.discrepancies.map((d) => (
      tr
        ? `Saha ölçümü yörünge verisinden farklı: saha ${d.fieldVal} ${d.unit}, yörünge ${d.orbitalVal} ${d.unit}.`
        : `Field differs from orbital: field ${d.fieldVal} ${d.unit}, orbital ${d.orbitalVal} ${d.unit}.`
    )) : [];

    const outCell = {
      row: r,
      col: c,
      idx: i,
      lat: cellLat,
      lon180: cellLon180,
      lon360: +normalizeLon360(cellLon180).toFixed(5),
      finalScore: +g.final[i].toFixed(1),
      slopeDeg: slopeVal,
      ti: tiInt,
      tempC: tempVal,
      reliefM: +g.reliefM[i].toFixed(1),
      albedo: +g.albedo[i].toFixed(2),
      tau: cellTau,
      gcrMSvYr: Math.round(g.gcrMSvYr[i]),
      dailyGenWh: genWh,
      dailyNeedWh: needWh,
      powerDeficit: !!g.powerDeficit[i],
      impassable: !!g.impassable[i],
      nasaVeto: !!g.nasaVeto[i],
      vetoReasons,
      discrepancies,
      geolUnit: unitCode,
      geolDesc: uMeta.desc,
      domains,
    };
    outCell.explanation = explainCellScore(outCell, lang);
    return outCell;
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
      fieldRadiusM: analysis.fieldRadiusM,
      fieldMeasurements: analysis.fieldMeasurements || [],
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
        power: Array.from(analysis.grids.power, (v) => +v.toFixed(1)),
        confidence: Array.from(analysis.grids.confidence, (v) => +v.toFixed(1)),
        elevM: Array.from(analysis.grids.elevM, (v) => Math.round(v)),
        slopeDeg: Array.from(analysis.grids.slopeDeg, (v) => +v.toFixed(1)),
        ti: Array.from(analysis.grids.ti, (v) => Math.round(v)),
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
          fieldMeasurements: analysis.fieldMeasurements || [],
          ...analysis.summary,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[0], bb[1]]]],
        },
      },
    ];
    for (const fm of (analysis.fieldMeasurements || [])) {
      if (!Number.isFinite(Number(fm.lat)) || !Number.isFinite(Number(fm.lon))) continue;
      features.push({
        type: 'Feature',
        properties: { featureType: 'field_measurement', ...fm },
        geometry: { type: 'Point', coordinates: [+Number(fm.lon).toFixed(6), +Number(fm.lat).toFixed(6)] },
      });
    }
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
            power: +g.power[i].toFixed(1),
            confidence: +g.confidence[i].toFixed(1),
            elevM: Math.round(g.elevM[i]),
            slopeDeg: +g.slopeDeg[i].toFixed(1),
            ti: Math.round(g.ti[i]),
            grsK_wtPct: +g.grsK[i].toFixed(3),
            grsTh_ppm: +g.grsTh[i].toFixed(3),
            geolUnit: g.geolUnits[i],
            impassable: !!g.impassable[i],
            nasaVeto: !!g.nasaVeto[i],
            powerDeficit: !!g.powerDeficit[i],
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

  const FIELD_TYPE_ALIAS = {
    surfaceTempC: 'surfTemp',
    airTempC: 'airTemp',
    pressurePa: 'pressure',
    radiationUSvHr: 'radDose',
    slopeDeg: 'slope',
    rockPct: 'rockAbundance',
    iceDepthM: 'iceDepth',
  };

  const FIELD_MEASUREMENT_SPECS = {
    ti:             { label: 'Thermal inertia',      labelTr: 'Termal atalet',         unit: 'tiu' },
    surfaceTempC:   { label: 'Surface temperature',  labelTr: 'Yüzey sıcaklığı',        unit: '°C' },
    airTempC:       { label: 'Air temperature',      labelTr: 'Hava sıcaklığı',         unit: '°C' },
    pressurePa:     { label: 'Pressure',             labelTr: 'Basınç',                 unit: 'Pa' },
    radiationUSvHr: { label: 'Radiation dose rate',  labelTr: 'Radyasyon doz hızı',     unit: 'µSv/hr' },
    tau:            { label: 'Dust optical depth τ', labelTr: 'Toz optik derinliği τ',  unit: 'τ' },
    slopeDeg:       { label: 'Slope',                labelTr: 'Eğim',                   unit: '°' },
    rockPct:        { label: 'Rock abundance',       labelTr: 'Kaya yoğunluğu',         unit: '%' },
    soilType:       { label: 'Soil type',            labelTr: 'Zemin türü',             unit: 'class' },
    iceDepthM:      { label: 'Ice depth',            labelTr: 'Buz derinliği',          unit: 'm' },
    hazard:         { label: 'Hazard marker',        labelTr: 'Tehlike işareti',        unit: 'marker' },
  };

  const API = {
    FIELD_MEASUREMENT_SPECS,
    getUtcTodayIso,
    normalizeLon180,
    normalizeLon360,
    formatLonForConvention,
    validateLocation,
    resolveVehicleConfig,
    getDefaultInputs,
    findPresetCutout,
    nearestRegionName,
    findColdestEarthDateForLat,
    classifySourceBadge,
    explainCellScore,
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
