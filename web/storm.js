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

  function fTau(tau) { return Math.exp(-0.35 * (tau - 0.5)); }

  // Seasonal & latitudinal geometry factor (normalised so equatorial equinox = 1.0).
  function seasonalFactor(lat, ls) {
    if (ls === undefined || ls === null) {
      return Math.max(0.05, Math.cos(lat * DEG));
    }
    const phi = lat * DEG;
    const lsRad = ls * DEG;
    const sinDec = Math.sin(OBLIQUITY) * Math.sin(lsRad);
    const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

    // Eccentricity distance modulation: ((1 + e cos(Ls - Lp)) / (1 - e^2))^2
    const rRatio = (1 + ECC * Math.cos((ls - LS_PERIHELION) * DEG)) / (1 - ECC * ECC);
    const distFactor = rRatio * rRatio;

    // Sunset hour angle H0
    const arg = -Math.tan(phi) * Math.tan(dec);
    const H0 = arg <= -1 ? Math.PI : arg >= 1 ? 0 : Math.acos(arg);

    // Diurnal integral normalised by equatorial equinox (1/pi -> 1)
    const geom = H0 * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(H0);
    return Math.max(0.03, distFactor * geom);
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

  function tauAt(sol, s) {
    if (sol < s.startSol) return s.tau0;
    const t = sol - s.startSol;
    if (t < s.riseSols) return s.tau0 + (s.tauPeak - s.tau0) * (t / s.riseSols);
    if (t < s.riseSols + s.holdSols) return s.tauPeak;
    const d = t - s.riseSols - s.holdSols;
    if (d < s.decaySols) return s.tauPeak - (s.tauPeak - s.tau0) * (d / s.decaySols);
    return s.tau0;
  }

  // cfg: {lat, ls, panelArea, efficiency, consumption(kWh/sol), capacity(kWh), kilopower(units), sols, storm:{...}}
  function simulate(cfg) {
    const rows = [];
    let batt = cfg.capacity;
    let blackoutSol = null, minBatt = batt;
    const ls0 = cfg.ls;
    for (let sol = 0; sol < cfg.sols; sol++) {
      const tau = tauAt(sol, cfg.storm);
      // Mars advances ~0.524 deg of Ls per sol
      const lsSol = (ls0 === undefined || ls0 === null) ? undefined : (ls0 + sol * 0.524) % 360;
      const solar = cfg.panelArea * cfg.efficiency * dailySolar(cfg.lat, tau, lsSol);
      const nuclear = cfg.kilopower * KILOPOWER_KW * SOL_H;
      const net = solar + nuclear - cfg.consumption;
      batt = Math.max(0, Math.min(cfg.capacity, batt + net));
      if (batt <= 0 && blackoutSol === null) blackoutSol = sol;
      minBatt = Math.min(minBatt, batt);
      rows.push({ sol, tau, solar, nuclear, net, batt, ls: lsSol });
    }
    const peakRow = rows.reduce((a, b) => (b.tau > a.tau ? b : a), rows[0]);
    return { rows, blackoutSol, minBatt, peakSolarDropPct: 100 * (1 - fTau(cfg.storm.tauPeak) / fTau(cfg.storm.tau0)), peakRow };
  }

  global.STORM = { fTau, seasonalFactor, seasonName, dailySolar, tauAt, simulate, SOL_H, KILOPOWER_KW };
})(typeof window !== 'undefined' ? window : module.exports);
