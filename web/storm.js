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
  const SOL_H = 24.66, KILOPOWER_KW = 10;
  const DEG = Math.PI / 180;
  const OBLIQUITY = 25.19 * DEG;
  const ECC = 0.0934;
  const LS_PERIHELION = 251.0;
  const S0 = 586;
  const LS_PER_SOL = 360 / 668.6;

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
  function surfaceTempC(lat, ls) {
    const qa = annualMeanQ(lat);
    const qNow = (ls === undefined || ls === null) ? null : insolationTOA(lat, ls);
    const q = qNow === null ? qa : 0.5 * qNow + 0.5 * qa;
    // polar night: the surface sits at the CO2 frost point (seasonal cap)
    const tK = qNow === 0 ? T_FROST : Math.max(T_FROST, Math.pow((1 - ALBEDO) * q / (EMISS * SIGMA), 0.25));
    const mean = tK - 273.15;
    return { mean: Math.round(mean * 10) / 10, night: Math.round((mean - 36) * 10) / 10, day: Math.round((mean + 28) * 10) / 10 };
  }

  // Habitat heat loss: UA = 90 W/K (~220 m2 envelope, U ~ 0.4 W/m2K; assumption) to reach +20 C inside.
  // All electrical power used inside the habitat ends up as heat, so heaters only cover the shortfall
  // (see simulate: heater energy = max(0, loss - electrical load)).
  const UA_KW_PER_K = 0.090;
  function thermalDemandKw(lat, ls) {
    const t = surfaceTempC(lat, ls);
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

  // cfg: {lat, ls|Ls0, panelArea, efficiency, consumption(kWh/sol), capacity(kWh), kilopower(units), sols, storm:{...}, dustCleaning?:bool}
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
      const sTemp = surfaceTempC(cfg.lat, lsSol);
      const lossKwh = thermalDemandKw(cfg.lat, lsSol) * SOL_H;
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

  global.STORM = { fTau, insolationTOA, seasonalFactor, seasonName, dailySolar, tauAt, simulate, surfaceTempC, thermalDemandKw, SOL_H, KILOPOWER_KW, LS_PER_SOL };
})(typeof window !== 'undefined' ? window : module.exports);
