// Dust-storm & seasonal energy crisis model (explicitly stated and cited).
//
// Daily solar energy per m2 of horizontal panel (kWh/sol):
//   E = E0 * S_season(lat, Ls) * f(tau)
//   E0   = 3.0 kWh/m2/sol  clear-sky equatorial daily insolation (Appelbaum & Flood 1990, NASA TM-102299)
//   S_season(lat, Ls):
//     - When Ls is null/undefined (annual mean mode): cos(lat)
//     - When Ls in [0..360] deg is given: accounts for Mars axial obliquity (25.19 deg) solar declination
//       and orbital eccentricity (e = 0.0934, perihelion Ls = 251 deg) diurnal insolation integral.
//   f(tau) = exp(-0.35 * (tau - 0.5))   empirical: normalised to a typical clear sky tau=0.5 and fitted so
//            that tau~10.8 (2018 global storm) gives ~3% of clear-sky array output, matching Opportunity's
//            drop from ~650 Wh/sol to ~22 Wh/sol (NASA/JPL mission updates, June 2018).
// Base energy balance per sol:
//   production  = panelArea * efficiency * E + kilopowerUnits * 10 kW * 24.66 h
//   net         = production - consumption
//   battery(t+1)= clamp(battery(t) + net, 0, capacity)
(function (global) {
  'use strict';
  const PLANET = (global.PLANET_PROFILES ||
    (typeof globalThis !== 'undefined' && globalThis.PLANET_PROFILES) ||
    (typeof require === 'function' ? require('./planet_profiles.js').PLANET_PROFILES : null)).get();
  const SOL_H = PLANET.solHours.value, KILOPOWER_KW = 10;
  const DEG = Math.PI / 180;
  const OBLIQUITY = PLANET.obliquityDeg.value * DEG;
  const ECC = PLANET.eccentricity.value;
  const LS_PERIHELION = PLANET.lsPerihelionDeg.value;
  const S0 = PLANET.solarConstantWm2.value;
  const LS_PER_SOL = 360 / PLANET.solsPerYear.value;

  function fTau(tau) { return Math.exp(-0.35 * (tau - 0.5)); }

  // Seasonal daily-mean top-of-atmosphere insolation (W/m2) for latitude and solar longitude Ls (deg).
  function insolationTOA(lat, Ls) {
    const phi = lat * DEG;
    const dec = Math.asin(Math.max(-1, Math.min(1, Math.sin(OBLIQUITY) * Math.sin(Ls * DEG))));
    const rf = (1 + ECC * Math.cos((Ls - LS_PERIHELION) * DEG)) / (1 - ECC * ECC);
    const x = -Math.tan(phi) * Math.tan(dec);
    const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
    return Math.max(0, S0 / Math.PI * rf * rf * (h0 * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(h0)));
  }

  let Q_EQ = 0; for (let l = 0; l < 360; l++) Q_EQ += insolationTOA(0, l) / 360;

  // Seasonal & latitudinal geometry factor (normalised so equatorial annual-mean = 1.0).
  function seasonalFactor(lat, ls) {
    if (ls === undefined || ls === null) {
      return Math.max(0.05, Math.cos(lat * DEG));
    }
    return insolationTOA(lat, ls) / Q_EQ;
  }

  function dailySolar(lat, tau, ls) {
    return 3.0 * seasonalFactor(lat, ls) * fTau(tau);
  }

  function seasonName(ls) {
    if (ls === undefined || ls === null) return 'Annual Mean';
    const v = ((ls % 360) + 360) % 360;
    if (v >= 235 && v <= 268) return 'Perihelion / S. Summer Dust Season';
    if (v < 45 || v >= 315) return 'N. Spring / S. Autumn Equinox';
    if (v < 135) return 'N. Summer / Aphelion';
    if (v < 225) return 'N. Autumn / S. Spring Equinox';
    return 'N. Winter / S. Summer Solstice';
  }

  // Returns { mean, night, day } surface temperatures in Celsius as a function of latitude and season (Ls).
  // Diurnal-mean surface temperature from radiative balance with the insolation model above:
  //   T = ((1 - A) * Q_eff / (eps * sigma))^(1/4),  A = 0.25 (TES global mean bolometric albedo), eps = 0.95
  //   Q_eff = 0.5 * Q(lat, Ls) + 0.5 * annual-mean Q(lat): the half-weight on the annual mean stands in for seasonal
  //   thermal lag of the regolith. Floor 148 K = CO2 frost point (seasonal caps). Day / night offsets (+28 / -36 C) are
  //   typical diurnal amplitudes for moderate thermal inertia (Viking / REMS / InSight range) - approximate.
  const ALBEDO = 0.25, EMISS = 0.95, SIGMA = 5.670e-8, T_FROST = 148;
  const annualQ = new Map();
  function annualMeanQ(lat) {
    const k = Math.round(lat * 2) / 2;
    if (!annualQ.has(k)) { let q = 0; for (let l = 0; l < 360; l += 5) q += insolationTOA(k, l) / 72; annualQ.set(k, q); }
    return annualQ.get(k);
  }
  function surfaceTempC(lat, ls, ti, elev, tau) {
    const qa = annualMeanQ(lat);
    const qNow = (ls === undefined || ls === null) ? null : insolationTOA(lat, ls);
    const q = qNow === null ? qa : 0.5 * qNow + 0.5 * qa;
    // polar night: the surface sits at the CO2 frost point (seasonal cap)
    const lapseK = (elev !== undefined && elev !== null) ? -0.0005 * elev : 0;
    const tK = qNow === 0 ? T_FROST : Math.max(T_FROST, Math.pow((1 - ALBEDO) * q / (EMISS * SIGMA), 0.25) + lapseK);
    const baseMean = tK - 273.15;
    const ampScale = (ti !== undefined && ti !== null)
      ? Math.max(0.55, Math.min(1.60, Math.sqrt(220 / Math.max(40, ti))))
      : 1.0;
    // Dust-storm infrared greenhouse effect (Viking / REMS / InSight TWINS): suspended dust cools daytime peak
    // while trapping thermal IR at night, damping diurnal amplitude and warming nocturnal surface temperatures.
    const tauExcess = (tau !== undefined && tau !== null && tau > 0.5) ? (tau - 0.5) : 0;
    const tauDamp = tauExcess > 0 ? Math.exp(-0.22 * tauExcess) : 1.0;
    const irNightWarmK = tauExcess > 0 ? 14.5 * (1 - Math.exp(-0.32 * tauExcess)) : 0;
    const swDayCoolK = tauExcess > 0 ? -18.0 * (1 - Math.exp(-0.32 * tauExcess)) : 0;
    const mean = baseMean + 0.5 * (irNightWarmK + swDayCoolK);
    return {
      mean: Math.round(mean * 10) / 10,
      night: Math.round((baseMean - 36 * ampScale * tauDamp + irNightWarmK) * 10) / 10,
      day: Math.round((baseMean + 28 * ampScale * tauDamp + swDayCoolK) * 10) / 10
    };
  }

  // Habitat heat loss: UA = 90 W/K (~220 m2 envelope, U ~ 0.4 W/m2K; assumption) to reach +20 C inside.
  // All electrical power used inside the habitat ends up as heat, so heaters only cover the shortfall
  // (see simulate: heater energy = max(0, loss - electrical load)).
  const UA_KW_PER_K = 0.090;
  function thermalDemandKw(lat, ls, ti, elev, tau) {
    const t = surfaceTempC(lat, ls, ti, elev, tau);
    return Math.round(UA_KW_PER_K * Math.max(0, 20.0 - t.mean) * 10) / 10;
  }

  function tauAt(sol, s) {
    if (sol < s.startSol) return s.tau0;
    const t = sol - s.startSol;
    if (t < s.riseSols) return s.tau0 + (s.tauPeak - s.tau0) * (t / s.riseSols);
    if (t < s.riseSols + s.holdSols) return s.tauPeak;
    const d = t - s.riseSols - s.holdSols;
    if (d < s.decaySols) return s.tauPeak - (s.tauPeak - s.tau0) * (d / s.decaySols);
    return s.tau0;
  }

  // cfg: {lat, ls|Ls0, ti?, elev?, panelArea, efficiency, consumption(kWh/sol), capacity(kWh), kilopower(units), sols, storm:{...}, dustCleaning?:bool}
  function simulate(cfg) {
    const rows = [];
    let batt = cfg.capacity;
    let blackoutSol = null, freezeSol = null, minBatt = batt;
    let habTemp = 20.0, minHabTemp = 20.0;
    const ls0 = cfg.ls !== undefined ? cfg.ls : cfg.Ls0;
    const dustCleaning = cfg.dustCleaning ?? false;
    let dustLoss = 1.0;

    for (let sol = 0; sol < cfg.sols; sol++) {
      const tau = tauAt(sol, cfg.storm);
      const lsSol = (ls0 === undefined || ls0 === null) ? null : (ls0 + sol * LS_PER_SOL + 360) % 360;
      const sTemp = surfaceTempC(cfg.lat, lsSol, cfg.ti, cfg.elev, tau);
      const lossKwh = thermalDemandKw(cfg.lat, lsSol, cfg.ti, cfg.elev, tau) * SOL_H;
      // Electrical load is dissipated inside the habitat; heaters only make up the remainder.
      const heaterKwh = Math.max(0, lossKwh - cfg.consumption);

      // Dust deposition on panels: ~0.28 %/sol (MER Opportunity average), 3x during a storm; no cleaning
      // events are modelled unless dustCleaning (then panels are kept clean). Floor at 35 % of clean output.
      if (!dustCleaning) dustLoss = Math.max(0.35, dustLoss - (tau > cfg.storm.tau0 ? 0.0084 : 0.0028));

      const solar = cfg.panelArea * cfg.efficiency * dailySolar(cfg.lat, tau, lsSol) * dustLoss;
      const nuclear = cfg.kilopower * KILOPOWER_KW * SOL_H;
      const totalGen = solar + nuclear;
      const load = cfg.consumption + heaterKwh;
      const net = totalGen - load;

      batt = Math.max(0, Math.min(cfg.capacity, batt + net));
      if (batt <= 0 && blackoutSol === null) blackoutSol = sol;
      minBatt = Math.min(minBatt, batt);

      // Heat actually delivered this sol: everything generated (or drawn from battery) up to the loss.
      const delivered = batt > 0 ? lossKwh : Math.min(lossKwh, totalGen);
      const deficitFrac = lossKwh > 0 ? 1 - delivered / lossKwh : 0;
      // Interior relaxes toward ambient in proportion to the heat deficit (1.5-sol time constant), recovers likewise.
      const target = 20.0 - deficitFrac * (20.0 - sTemp.mean);
      habTemp = target + (habTemp - target) * Math.exp(-1.0 / 1.5);
      minHabTemp = Math.min(minHabTemp, habTemp);
      if (habTemp <= 0.0 && freezeSol === null) freezeSol = sol;

      rows.push({
        sol, tau, solar, nuclear, heater: heaterKwh, net, batt, habTemp: Math.round(habTemp * 10) / 10,
        tempMean: sTemp.mean, tempNight: sTemp.night, dustLoss, ls: lsSol, Ls: lsSol
      });
    }
    const peakRow = rows.reduce((a, b) => (b.tau > a.tau ? b : a), rows[0]);
    const finalRow = rows[rows.length - 1];
    return {
      rows, blackoutSol, freezeSol, minBatt, minHabTemp: Math.round(minHabTemp * 10) / 10,
      peakSolarDropPct: 100 * (1 - fTau(cfg.storm.tauPeak) / fTau(cfg.storm.tau0)),
      postStormSolarLossPct: Math.round((1 - finalRow.dustLoss) * 100),
      peakRow
    };
  }

  // ---------------------------------------------------------------------------
  // Dust-lifting risk index (hand-tuned heuristic, NOT a trained or validated model)
  // ---------------------------------------------------------------------------
  // Four look-ahead horizons (+1 min, +6 min, +15 min, +1-3 sol) built from physically motivated
  // features (Bagnold saltation ratio, bulk Richardson number, convective phase, dust supply, storm-season
  // corridors). The rule thresholds and weights below were set by hand; they were never fitted to data and
  // have no measured accuracy. There is no live sensor feed: pressure/wind inputs are modelled from the site,
  // season and time of day unless the caller supplies them. Read the outputs as a relative 0-100 risk index.
  const MARS_G_ACCEL = PLANET.gravityMs2.value;
  const R_CO2 = 188.9;

  // Approximate storm-genesis regions, hand-placed as ellipses after the storm-track maps in MDAD
  // (Battalio & Wang 2021) and Montabone et al. (2015, 2020). Positions, sizes and weights are rough.
  const MDAD_CORRIDORS = [
    { id: 'acidalia_chryse', name: 'Acidalia-Chryse Baroclinic Channel', nameTr: 'Acidalia-Chryse Baroklinik Koridoru', lat: 32.0, lon: -35.0, rx: 32.0, ry: 22.0, weight: 0.96, lsPeak: 215 },
    { id: 'hellas_katabatic', name: 'Hellas Rim Katabatic Outflow', nameTr: 'Hellas Havzası Katabatik Çıkışı', lat: -38.0, lon: 70.0, rx: 35.0, ry: 22.0, weight: 0.98, lsPeak: 251 },
    { id: 'utopia_isidis', name: 'Utopia-Isidis Western Boundary', nameTr: 'Utopia-Isidis Batı Sınır Akıntısı', lat: 22.0, lon: 92.0, rx: 30.0, ry: 20.0, weight: 0.89, lsPeak: 235 },
    { id: 'noachis_solis', name: 'Noachis-Solis-Argyre Perihelion Belt', nameTr: 'Noachis-Solis-Argyre Günberi Kuşağı', lat: -32.0, lon: -48.0, rx: 42.0, ry: 22.0, weight: 0.95, lsPeak: 265 },
    { id: 'arcadia_cap_edge', name: 'Arcadia-Deuteronilus Cap-Edge Wave Belt', nameTr: 'Arcadia-Deuteronilus Kutup Sınırı Kuşağı', lat: 44.0, lon: -155.0, rx: 48.0, ry: 18.0, weight: 0.86, lsPeak: 195 },
    { id: 'elysium_gale', name: 'Elysium-Aeolis Equatorial Trough', nameTr: 'Elysium-Aeolis Ekvatoral Oluk', lat: 2.0, lon: 142.0, rx: 28.0, ry: 18.0, weight: 0.78, lsPeak: 245 }
  ];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-clamp(z, -20, 20))); }

  function evaluateCorridor(lat, lon, ls) {
    const lsVal = ((ls ?? 251) % 360 + 360) % 360;
    // Perihelion dust season envelope (Ls 180..330) + northern autumn baroclinic wave peak
    const perihelionBell = Math.exp(-0.5 * Math.pow(Math.sin((lsVal - 251) * DEG * 0.5) / 0.42, 2));
    const equinoxWave = 0.35 * Math.exp(-0.5 * Math.pow(Math.sin((lsVal - 195) * DEG * 0.5) / 0.28, 2));
    const capEdgeFactor = Math.abs(lat) >= 32 && Math.abs(lat) <= 62 ? 0.22 : 0.0;
    const seasonForcing = clamp(0.18 + 0.72 * perihelionBell + equinoxWave, 0.15, 1.0);

    let bestScore = 0.18 * seasonForcing;
    let bestCorridor = MDAD_CORRIDORS[0];
    for (const c of MDAD_CORRIDORS) {
      let dLon = Math.abs(lon - c.lon);
      if (dLon > 180) dLon = 360 - dLon;
      const distNorm = Math.hypot(dLon / c.rx, (lat - c.lat) / c.ry);
      const spatial = Math.exp(-0.55 * distNorm * distNorm);
      const lsMatch = 0.65 + 0.35 * Math.cos((lsVal - c.lsPeak) * DEG);
      const s = c.weight * spatial * (0.55 * seasonForcing + 0.45 * lsMatch) + capEdgeFactor * seasonForcing;
      if (s > bestScore) {
        bestScore = s;
        bestCorridor = c;
      }
    }
    return {
      corridorIndex: clamp(bestScore, 0.04, 0.99),
      seasonForcing: +seasonForcing.toFixed(3),
      corridorId: bestCorridor.id,
      corridorName: bestCorridor.name,
      corridorNameTr: bestCorridor.nameTr
    };
  }

  /**
   * Compute the physically motivated input features for the dust-lifting risk index.
   * @param {Object} opts
   */
  function extractDustMLFeatures(opts = {}) {
    const lat = +(opts.lat ?? 18.4);
    const lon = +(opts.lon ?? 77.5);
    const elev = +(opts.elev ?? -2200);
    const slope = Math.max(0, +(opts.slope ?? 3.2));
    const ls = ((opts.ls ?? 251) % 360 + 360) % 360;
    const ti = opts.ti !== null && opts.ti !== undefined ? Math.max(35, +opts.ti) : 210;
    const dust = opts.dust !== null && opts.dust !== undefined
      ? clamp(+opts.dust, 0.02, 0.98)
      : clamp((290 - ti) / 260, 0.08, 0.92);
    const tauCurrent = Math.max(0.2, +(opts.tauCurrent ?? (opts.tauPeak && opts.stormActive ? opts.tauPeak * 0.45 : 0.65)));
    const lmstHour = opts.lmstHour !== undefined ? (+opts.lmstHour % 24 + 24) % 24 : 13.25;

    // 1. Atmospheric column & density rho(h, Ls)
    const phiLs = (ls - 148) * DEG;
    const fSeasonP = 1.0 - 0.085 * Math.cos(phiLs) + 0.035 * Math.cos(2 * phiLs);
    const sigmaGcm2 = PLANET.atmosphere.columnDatumGcm2.value * fSeasonP * Math.exp(-elev / PLANET.atmosphere.scaleHeightM.value);
    const pressurePa = sigmaGcm2 * 10 * MARS_G_ACCEL; // ~608 Pa at datum
    const sTemp = surfaceTempC(lat, ls, ti, elev, tauCurrent);
    const tAirK = Math.max(150, sTemp.day + 273.15 - 16.0);
    const rhoAtmo = pressurePa / (R_CO2 * tAirK); // ~0.014 - 0.022 kg/m3

    // 2. Diurnal convective phase (peaks 11:00 - 15:30 LMST, center 13.25h)
    const lmstDiff = Math.abs(lmstHour - 13.25);
    const lmstConvective = lmstDiff <= 4.5 ? Math.pow(Math.cos((lmstDiff / 4.5) * (Math.PI / 2)), 1.2) : 0.04;

    // 3. Super-adiabatic surface-to-air thermal gradient dT_sa = T_surf - T_air(1.5m)
    const tiAmp = clamp(Math.sqrt(230 / ti), 0.65, 1.55);
    const tauAtten = Math.exp(-0.18 * Math.max(0, tauCurrent - 0.5));
    const regime = opts.telemetryRegime || 'auto';
    const defaultDeltaT = clamp((14.5 + 13.5 * tiAmp * tauAtten) * (0.22 + 0.78 * lmstConvective), 1.5, 34.0);
    const superAdiabaticGradK = opts.superAdiabaticGradK !== undefined
      ? +opts.superAdiabaticGradK
      : (regime === 'clear_calm' ? Math.min(defaultDeltaT, 9.0) : defaultDeltaT);

    // 4. Surface mobile dust reservoir index (TES dust abundance + low thermal inertia fine silt)
    const dustSourceIndex = clamp(0.58 * dust + 0.42 * clamp((225 - ti) / 170, 0, 1), 0.04, 0.99);

    // 5. Historical MDAD + Montabone storm corridor & seasonal forcing
    const corr = evaluateCorridor(lat, lon, ls);

    // 6. Wind speed, gust factor & Bagnold-Iversen saltation threshold ratio (u* / u*_t)
    const slopeKatabatic = 1 + 0.022 * Math.min(20, slope);
    const defaultWindMps = (6.8 + 7.5 * corr.corridorIndex + 4.2 * lmstConvective + (tauCurrent > 1.5 ? 5.2 : 0)) * slopeKatabatic;
    const regimeWindMps = regime === 'clear_calm'
      ? Math.min(defaultWindMps * 0.45, 5.8)
      : (regime === 'precursor' ? Math.min(defaultWindMps, 11.5 * slopeKatabatic) : defaultWindMps);
    const windSpeedMps = opts.windSpeedMps !== undefined ? Math.max(0.5, +opts.windSpeedMps) : regimeWindMps;
    const defaultGustFactor = regime === 'clear_calm'
      ? 1.12
      : (regime === 'precursor' ? 1.26 : (1.28 + 0.25 * lmstConvective));
    const gustFactor = opts.gustFactor !== undefined ? Math.max(1.0, +opts.gustFactor) : defaultGustFactor;
    // Threshold friction velocity u*_t (Iversen & White 1982; Kok 2012 low-rebound effective threshold)
    const uStarThreshold = 1.02 * Math.sqrt(0.0165 / Math.max(0.006, rhoAtmo));
    const uStar = 0.076 * windSpeedMps * gustFactor * (1 + 0.012 * Math.min(18, slope));
    const bagnoldRatio = clamp(uStar / uStarThreshold, 0.10, 2.40);

    // 7. Bulk Richardson Number Ri_b at z = 1.5 m
    const uEffSq = Math.max(2.0, windSpeedMps * windSpeedMps);
    const bulkRichardson = clamp(-(MARS_G_ACCEL / tAirK) * (superAdiabaticGradK * 1.5) / uEffSq, -1.50, 0.25);

    // 8. 1-Minute Barometric Vortex Precursor Index (InSight APSS / Perseverance MEDA 1 Hz dP & sigma_P)
    let deltaP1mPa = opts.deltaP1mPa;
    let sigmaP5mPa = opts.sigmaP5mPa;
    if (deltaP1mPa === undefined || sigmaP5mPa === undefined) {
      if (regime === 'vortex_imminent') {
        deltaP1mPa = deltaP1mPa ?? -(2.35 + 1.40 * corr.corridorIndex + 0.85 * dustSourceIndex);
        sigmaP5mPa = sigmaP5mPa ?? (0.92 + 0.45 * lmstConvective);
      } else if (regime === 'precursor') {
        deltaP1mPa = deltaP1mPa ?? -0.22;
        sigmaP5mPa = sigmaP5mPa ?? (0.56 + 0.24 * lmstConvective);
      } else if (regime === 'clear_calm') {
        deltaP1mPa = deltaP1mPa ?? -0.08;
        sigmaP5mPa = sigmaP5mPa ?? 0.09;
      } else {
        // 'auto': physics-driven from local boundary-layer instability & storm corridor
        const convDrive = clamp((-bulkRichardson / 0.28) * 0.55 + bagnoldRatio * 0.45, 0.05, 1.8);
        deltaP1mPa = deltaP1mPa ?? -(0.14 + Math.max(0, convDrive - 0.55) * 2.1 * lmstConvective + (tauCurrent > 2.0 ? 0.65 : 0));
        sigmaP5mPa = sigmaP5mPa ?? (0.10 + convDrive * 0.52 * lmstConvective + (tauCurrent > 2.0 ? 0.35 : 0));
      }
    }
    const vortexBaroIndex = clamp(
      Math.max(0, -deltaP1mPa - 0.16) / 1.45 * 0.65 +
      Math.max(0, sigmaP5mPa - 0.14) / 0.68 * 0.35,
      0, 2.5
    );

    // 9. Upwind optical depth advection rate (-v . grad tau, sol^-1)
    const tauAdvectionSol = opts.tauAdvectionSol !== undefined
      ? +opts.tauAdvectionSol
      : +(Math.max(0, corr.corridorIndex - 0.32) * 0.85 * dustSourceIndex + Math.max(0, tauCurrent - 0.8) * 0.22).toFixed(3);

    return {
      lat, lon, elev, slope, ls, ti, dust, lmstHour,
      pressurePa: +pressurePa.toFixed(1),
      rhoAtmo: +rhoAtmo.toFixed(5),
      lmstConvective: +lmstConvective.toFixed(3),
      superAdiabaticGradK: +superAdiabaticGradK.toFixed(2),
      bulkRichardson: +bulkRichardson.toFixed(3),
      windSpeedMps: +windSpeedMps.toFixed(1),
      gustFactor: +gustFactor.toFixed(2),
      uStar: +uStar.toFixed(2),
      uStarThreshold: +uStarThreshold.toFixed(2),
      bagnoldRatio: +bagnoldRatio.toFixed(3),
      deltaP1mPa: +deltaP1mPa.toFixed(2),
      sigmaP5mPa: +sigmaP5mPa.toFixed(2),
      vortexBaroIndex: +vortexBaroIndex.toFixed(3),
      dustSourceIndex: +dustSourceIndex.toFixed(3),
      stormCorridorIndex: +corr.corridorIndex.toFixed(3),
      seasonForcing: corr.seasonForcing,
      corridorId: corr.corridorId,
      corridorName: corr.corridorName,
      corridorNameTr: corr.corridorNameTr,
      primaryCorridor: corr.corridorName,
      tauCurrent: +tauCurrent.toFixed(2),
      tauAdvectionSol: +tauAdvectionSol.toFixed(3)
    };
  }

  // Hand-written rules for each of the 4 look-ahead horizons (thresholds set by hand, not fitted)
  function scoreRules1Min(f) {
    // Tree 1: Immediate Rankine barometric pressure well + turbulence
    const t1 = f.vortexBaroIndex >= 0.48
      ? (f.deltaP1mPa <= -0.85 ? 2.65 : 1.55)
      : (f.vortexBaroIndex >= 0.28 && f.bagnoldRatio >= 0.88 ? 0.85 : -2.35);
    // Tree 2: Bagnold threshold friction speed & gust shear
    const t2 = f.bagnoldRatio >= 0.92
      ? (f.gustFactor >= 1.32 ? 1.85 : 1.05)
      : (f.bagnoldRatio >= 0.76 && f.vortexBaroIndex >= 0.35 ? 0.65 : -1.65);
    // Tree 3: Boundary layer convective plume instability (Bulk Richardson + super-adiabatic dT)
    const t3 = (f.bulkRichardson <= -0.14 && f.superAdiabaticGradK >= 18.5)
      ? (f.vortexBaroIndex >= 0.32 ? 1.45 : 0.35)
      : (f.tauCurrent >= 2.2 && f.bagnoldRatio >= 0.85 ? 1.20 : -1.35);
    const contLogit = 1.95 * (f.vortexBaroIndex - 0.38) + 1.65 * (f.bagnoldRatio - 0.82) + 0.85 * (-f.bulkRichardson - 0.12);
    return sigmoid(0.75 * (t1 + t2 + t3) + contLogit);
  }

  function scoreRules6Min(f) {
    // Tree 1: Precursor 5-min pressure variance & approaching pressure trough
    const t1 = f.sigmaP5mPa >= 0.34
      ? (f.superAdiabaticGradK >= 19.0 ? 2.15 : 1.15)
      : (f.vortexBaroIndex >= 0.26 ? 0.95 : -2.05);
    // Tree 2: Convective trigger (Bulk Richardson + diurnal solar phase)
    const t2 = (f.bulkRichardson <= -0.13 && f.lmstConvective >= 0.45)
      ? (f.dustSourceIndex >= 0.42 ? 1.75 : 0.85)
      : (f.tauAdvectionSol >= 0.28 && f.bagnoldRatio >= 0.82 ? 1.25 : -1.55);
    // Tree 3: Aerodynamic saltation readiness + loose TES dust availability
    const t3 = (f.bagnoldRatio >= 0.84 && f.dustSourceIndex >= 0.45)
      ? 1.55
      : (f.bagnoldRatio < 0.65 ? -1.65 : -0.35);
    const contLogit = 1.60 * (f.vortexBaroIndex - 0.28) + 1.55 * (f.bagnoldRatio - 0.78) + 1.35 * ((f.superAdiabaticGradK - 18.0) / 8.0) + 1.10 * (f.dustSourceIndex - 0.45);
    return sigmoid(0.72 * (t1 + t2 + t3) + contLogit);
  }

  function scoreRules15Min(f) {
    // Tree 1: Planetary boundary layer instability buildup (15-min convective cell gestation)
    const t1 = (f.superAdiabaticGradK >= 18.5 && f.lmstConvective >= 0.42)
      ? (f.bulkRichardson <= -0.13 ? 1.95 : 0.90)
      : (f.tauAdvectionSol >= 0.25 ? 1.15 : -1.85);
    // Tree 2: Surface dust source + Bagnold saltation margin
    const t2 = (f.dustSourceIndex >= 0.44 && f.bagnoldRatio >= 0.78)
      ? (f.stormCorridorIndex >= 0.48 ? 1.70 : 0.95)
      : (f.vortexBaroIndex >= 0.30 ? 0.80 : -1.60);
    // Tree 3: Upwind mesoscale dust front advection + barometric variance
    const t3 = (f.sigmaP5mPa >= 0.28 || f.tauAdvectionSol >= 0.22)
      ? 1.25
      : -1.35;
    const contLogit = 1.45 * ((f.superAdiabaticGradK - 17.5) / 7.5) + 1.50 * (f.bagnoldRatio - 0.75) + 1.35 * (f.dustSourceIndex - 0.44) + 1.25 * (f.vortexBaroIndex - 0.24);
    return sigmoid(0.70 * (t1 + t2 + t3) + contLogit);
  }

  function scoreRules1Sol(f) {
    // Tree 1: Historical MDAD + Montabone storm corridor & seasonal perihelion/baroclinic forcing
    const t1 = f.stormCorridorIndex >= 0.52
      ? (f.seasonForcing >= 0.55 ? 2.25 : 1.20)
      : (f.stormCorridorIndex >= 0.38 && f.tauAdvectionSol >= 0.22 ? 0.85 : -2.10);
    // Tree 2: Surface mobile dust reservoir (TES dust + low TI) & topographic wind channeling
    const t2 = f.dustSourceIndex >= 0.46
      ? (f.bagnoldRatio >= 0.76 ? 1.85 : 0.80)
      : (f.tauCurrent >= 1.6 ? 1.10 : -1.75);
    // Tree 3: Upwind optical depth advection (-v . grad tau)
    const t3 = f.tauAdvectionSol >= 0.20
      ? (f.stormCorridorIndex >= 0.45 ? 1.65 : 0.75)
      : -1.45;
    const contLogit = 2.40 * (f.stormCorridorIndex - 0.48) + 1.85 * (f.dustSourceIndex - 0.45) + 2.10 * (f.tauAdvectionSol - 0.18) + 1.15 * (f.bagnoldRatio - 0.74);
    return sigmoid(0.72 * (t1 + t2 + t3) + contLogit);
  }

  function classifyRisk(prob) {
    if (prob >= 0.72) return { level: 'CRITICAL', cls: 'bad', labelEn: 'HIGH / IMMINENT', labelTr: 'YÜKSEK / ACİL TEHLİKE' };
    if (prob >= 0.42) return { level: 'ELEVATED', cls: 'warn', labelEn: 'MODERATE / WATCH', labelTr: 'ORTA / ERKEN İZLEME' };
    return { level: 'NOMINAL', cls: 'ok', labelEn: 'LOW / CLEAR', labelTr: 'DÜŞÜK / GÜVENLİ' };
  }

  /**
   * Evaluate the heuristic dust-lifting risk index for all 4 horizons (+1m, +6m, +15m, +1-3 sol).
   * @param {Object} opts Site & sensor parameters
   */
  function predictDustML(opts = {}) {
    const f = extractDustMLFeatures(opts);
    const p1m = scoreRules1Min(f);
    const p6m = scoreRules6Min(f);
    const p15m = scoreRules15Min(f);
    const p1sol = scoreRules1Sol(f);

    const r1m = classifyRisk(p1m);
    const r6m = classifyRisk(p6m);
    const r15m = classifyRisk(p15m);
    const r1sol = classifyRisk(p1sol);

    // Indicative magnitudes scaled by the risk index (illustrative, not forecasts)
    const expDeltaP1m = +(f.deltaP1mPa * (0.7 + 0.9 * p1m)).toFixed(2);
    const expGustMps = +(f.windSpeedMps * f.gustFactor * (0.85 + 0.45 * Math.max(p1m, p6m))).toFixed(1);
    const expTau6m = +(f.tauCurrent + p6m * (0.45 + 0.85 * f.dustSourceIndex)).toFixed(2);
    const expTau1Sol = +(Math.max(f.tauCurrent, 0.55 + p1sol * (3.8 + 4.6 * f.stormCorridorIndex * f.dustSourceIndex))).toFixed(2);
    const expSolarDropPct = Math.round(100 * (1 - fTau(expTau1Sol) / fTau(0.5)));

    const horizons = [
      {
        id: 'h1m',
        horizonEn: '+1 min Nowcast',
        horizonTr: '+1 dk Anlık Tahmin',
        leadMinutes: 1,
        prob: +p1m.toFixed(4),
        probPct: +(p1m * 100).toFixed(1),
        risk: r1m.level,
        cls: r1m.cls,
        statusEn: r1m.labelEn,
        statusTr: r1m.labelTr,
        phenomenonEn: 'Convective Vortex / Gust Front Strike',
        phenomenonTr: 'Konvektif Toz Vorteksi / Ani Rüzgâr Darbesi',
        keyMetric: `ΔP ${expDeltaP1m} Pa · Gust ${expGustMps} m/s`,
        actionEn: p1m >= 0.5 ? 'Lock solar arrays, brace posture & shield optics immediately' : 'Nominal 1-Hz barometric baseline; continue surface ops',
        actionTr: p1m >= 0.5 ? 'Güneş panellerini kilitle, optikleri koru ve sabit duruşa geç' : '1-Hz barometrik sensör normal; yüzey operasyonuna devam'
      },
      {
        id: 'h6m',
        horizonEn: '+6 min Short-Range',
        horizonTr: '+6 dk Kısa Vadeli',
        leadMinutes: 6,
        prob: +p6m.toFixed(4),
        probPct: +(p6m * 100).toFixed(1),
        risk: r6m.level,
        cls: r6m.cls,
        statusEn: r6m.labelEn,
        statusTr: r6m.labelTr,
        phenomenonEn: 'Local Saltation & Dust Devil Corridor',
        phenomenonTr: 'Yerel Toz Kalkışı & Vorteks Koridoru',
        keyMetric: `u*/u*t ${f.bagnoldRatio.toFixed(2)} · τ→${expTau6m}`,
        actionEn: p6m >= 0.5 ? 'Halt drill/sample collection; begin tactical return toward rover/hab' : 'Saltation ratio below threshold; safe for sample collection',
        actionTr: p6m >= 0.5 ? 'Numune sondajını durdur; rover/üs yönüne geri dönüşe başla' : 'Tuzlanma (saltation) eşik altında; numune alımı güvenli'
      },
      {
        id: 'h15m',
        horizonEn: '+15 min Walkback',
        horizonTr: '+15 dk EVA Dönüş',
        leadMinutes: 15,
        prob: +p15m.toFixed(4),
        probPct: +(p15m * 100).toFixed(1),
        risk: r15m.level,
        cls: r15m.cls,
        statusEn: r15m.labelEn,
        statusTr: r15m.labelTr,
        phenomenonEn: 'PBL Super-Adiabatic Instability Plume',
        phenomenonTr: 'Sınır Tabakası Termal Kararsızlık Plumu',
        keyMetric: `Ri_b ${f.bulkRichardson.toFixed(2)} · ΔT +${f.superAdiabaticGradK.toFixed(1)} K`,
        actionEn: p15m >= 0.5 ? 'Enforce 15-min EVA walkback envelope & switch HUD to thermal IR' : 'Boundary layer stable; full walkback radius authorized',
        actionTr: p15m >= 0.5 ? '15 dk EVA güvenli dönüş çemberini uygula & HUD termal moduna geç' : 'Sınır tabakası kararlı; tam Walkback yarıçapı aktif'
      },
      {
        id: 'h1sol',
        horizonEn: '+1–3 Sol Regional',
        horizonTr: '+1–3 Sol Bölgesel',
        leadMinutes: 1480,
        prob: +p1sol.toFixed(4),
        probPct: +(p1sol * 100).toFixed(1),
        risk: r1sol.level,
        cls: r1sol.cls,
        statusEn: r1sol.labelEn,
        statusTr: r1sol.labelTr,
        phenomenonEn: `Regional Storm Onset (${f.corridorName})`,
        phenomenonTr: `Bölgesel Fırtına Başlangıcı (${f.corridorNameTr})`,
        keyMetric: `τ→${expTau1Sol} (−${expSolarDropPct}% solar)`,
        actionEn: p1sol >= 0.5 ? 'Pre-charge habitat battery to 100% & engage Kilopower baseload' : 'Low regional storm genesis probability in current Ls window',
        actionTr: p1sol >= 0.5 ? 'Üs bataryasını %100 şarj et & Kilopower nükleer baz yükü devreye al' : 'Mevcut Ls penceresinde bölgesel fırtına başlangıç riski düşük'
      }
    ];

    horizons.h1m = horizons[0];
    horizons.h6m = horizons[1];
    horizons.h15m = horizons[2];
    horizons.h1sol = horizons[3];

    const peakHorizon = horizons.reduce((a, b) => (b.prob > a.prob ? b : a), horizons[0]);
    return {
      cadenceSec: 60,
      cadenceSeconds: 60,
      modelVersion: 'heuristic-dust-risk-v1',
      modelArch: 'Hand-tuned rule index on physically motivated features (not trained, not validated)',
      validated: false,
      inputsNote: 'Pressure, wind and gust inputs are modelled from site, season and local time (no live sensor feed).',
      alertLevel: peakHorizon.risk,
      features: f,
      horizons,
      peakHorizon,
      expectedPeakTau1Sol: expTau1Sol,
      expectedSolarDropPct: expSolarDropPct,
      expectedGustMps: expGustMps
    };
  }

  /**
   * Behaviour checks for the heuristic risk index. These are NOT accuracy tests (there is no labelled
   * data behind the index); they only confirm that the index responds in the physically expected direction.
   */
  function dustRiskSanityChecks() {
    const base = { lat: 18.4, lon: 77.5, elev: -2200, ls: 251, ti: 210, lmstHour: 13.25 };
    const calm = predictDustML({ ...base, telemetryRegime: 'clear_calm' });
    const auto = predictDustML(base);
    const vortex = predictDustML({ ...base, telemetryRegime: 'vortex_imminent' });
    const night = predictDustML({ ...base, lmstHour: 2 });
    const aphelion = predictDustML({ ...base, ls: 71 });
    const checks = [
      { id: 'calm_low', label: 'Calm air gives a low +1 min index', pass: calm.horizons.h1m.prob < 0.42 },
      { id: 'vortex_high', label: 'A deep pressure drop raises the +1 min index above calm', pass: vortex.horizons.h1m.prob > calm.horizons.h1m.prob + 0.3 },
      { id: 'night_lower', label: 'Night (stable air) gives a lower +15 min index than early afternoon', pass: night.horizons.h15m.prob < auto.horizons.h15m.prob },
      { id: 'season', label: 'Regional index is higher in the perihelion dust season than at aphelion', pass: auto.horizons.h1sol.prob > aphelion.horizons.h1sol.prob },
    ];
    return { allPass: checks.every((c) => c.pass), checks };
  }

  global.STORM = {
    fTau, insolationTOA, seasonalFactor, seasonName, dailySolar, tauAt, simulate,
    surfaceTempC, thermalDemandKw, SOL_H, KILOPOWER_KW, LS_PER_SOL,
    MDAD_CORRIDORS, extractDustMLFeatures, predictDustML, dustRiskSanityChecks
  };
})(typeof window !== 'undefined' ? window : module.exports);
