// Dust-storm energy crisis model (deliberately simple and fully stated).
//
// Daily solar energy per m2 of horizontal panel (kWh/sol):
//   E = E0 * cos(lat) * f(tau)
//   E0   = 3.0 kWh/m2/sol  clear-sky equatorial daily insolation (Appelbaum & Flood 1990, order of magnitude)
//   f(tau) = exp(-0.35 * (tau - 0.5))   empirical: normalised to a typical clear sky tau=0.5 and fitted so
//            that tau~10.8 (2018 global storm) gives ~3% of clear-sky array output, matching Opportunity's
//            drop from ~650 Wh/sol to ~22 Wh/sol (NASA/JPL mission updates, June 2018).
// Base energy balance per sol:
//   production  = panelArea * efficiency * E + kilopowerUnits * 10 kW * 24.66 h
//   net         = production - consumption
//   battery(t+1)= clamp(battery(t) + net, 0, capacity)
// Seasons: if cfg.Ls0 (solar longitude at storm onset) is given, insolation follows latitude AND season
// (obliquity + eccentricity), advancing ~0.54 deg Ls per sol. Global storms start near Ls 180-260.
// Storm timeline: tau ramps from tau0 to tauPeak over riseSols, holds for holdSols, decays over decaySols.
(function (global) {
  'use strict';
  const SOL_H = 24.66, KILOPOWER_KW = 10;

  function fTau(tau) { return Math.exp(-0.35 * (tau - 0.5)); }

  // Seasonal daily-mean top-of-atmosphere insolation (W/m2) for latitude and solar longitude Ls (deg).
  // Obliquity 25.19 deg, eccentricity 0.0934, perihelion at Ls = 251 deg, S0 = 586 W/m2 at 1.524 AU.
  // Standard formula: Q = S0/pi * (a/r)^2 * (h0 sin(phi) sin(d) + cos(phi) cos(d) sin(h0)); polar night -> 0.
  const OBL = 25.19 * Math.PI / 180, ECC = 0.0934, LS_PERI = 251, S0 = 586;
  function insolationTOA(lat, Ls) {
    const d2r = Math.PI / 180, phi = lat * d2r;
    const dec = Math.asin(Math.sin(OBL) * Math.sin(Ls * d2r));
    const rf = (1 + ECC * Math.cos((Ls - LS_PERI) * d2r)) / (1 - ECC * ECC);   // a/r
    const x = -Math.tan(phi) * Math.tan(dec);
    const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
    return Math.max(0, S0 / Math.PI * rf * rf * (h0 * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(h0)));
  }
  // annual-mean equatorial TOA, used to keep the 3.0 kWh/m2/sol surface calibration
  let Q_EQ = 0; for (let l = 0; l < 360; l++) Q_EQ += insolationTOA(0, l) / 360;

  // kWh per m2 per sol. Without Ls: annual-mean cos(lat) approximation (original model).
  function dailySolar(lat, tau, Ls) {
    const geo = (Ls === undefined || Ls === null) ? Math.max(0.05, Math.cos(lat * Math.PI / 180)) : insolationTOA(lat, Ls) / Q_EQ;
    return 3.0 * geo * fTau(tau);
  }
  const LS_PER_SOL = 360 / 668.6;

  function tauAt(sol, s) {
    if (sol < s.startSol) return s.tau0;
    const t = sol - s.startSol;
    if (t < s.riseSols) return s.tau0 + (s.tauPeak - s.tau0) * (t / s.riseSols);
    if (t < s.riseSols + s.holdSols) return s.tauPeak;
    const d = t - s.riseSols - s.holdSols;
    if (d < s.decaySols) return s.tauPeak - (s.tauPeak - s.tau0) * (d / s.decaySols);
    return s.tau0;
  }

  // cfg: {lat, panelArea, efficiency, consumption(kWh/sol), capacity(kWh), kilopower(units), sols, storm:{...}}
  function simulate(cfg) {
    const rows = [];
    let batt = cfg.capacity;
    let blackoutSol = null, minBatt = batt;
    for (let sol = 0; sol < cfg.sols; sol++) {
      const tau = tauAt(sol, cfg.storm);
      const Ls = cfg.Ls0 === undefined || cfg.Ls0 === null ? null : (cfg.Ls0 + (sol - cfg.storm.startSol) * LS_PER_SOL + 360) % 360;
      const solar = cfg.panelArea * cfg.efficiency * dailySolar(cfg.lat, tau, Ls);
      const nuclear = cfg.kilopower * KILOPOWER_KW * SOL_H;
      const net = solar + nuclear - cfg.consumption;
      batt = Math.max(0, Math.min(cfg.capacity, batt + net));
      if (batt <= 0 && blackoutSol === null) blackoutSol = sol;
      minBatt = Math.min(minBatt, batt);
      rows.push({ sol, tau, Ls, solar, nuclear, net, batt });
    }
    const peakRow = rows.reduce((a, b) => (b.tau > a.tau ? b : a), rows[0]);
    return { rows, blackoutSol, minBatt, peakSolarDropPct: 100 * (1 - fTau(cfg.storm.tauPeak) / fTau(cfg.storm.tau0)), peakRow };
  }

  global.STORM = { fTau, dailySolar, insolationTOA, tauAt, simulate, SOL_H, KILOPOWER_KW, LS_PER_SOL };
})(typeof window !== 'undefined' ? window : module.exports);
