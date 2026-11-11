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
// Storm timeline: tau ramps from tau0 to tauPeak over riseSols, holds for holdSols, decays over decaySols.
(function (global) {
  'use strict';
  const SOL_H = 24.66, KILOPOWER_KW = 10;

  function fTau(tau) { return Math.exp(-0.35 * (tau - 0.5)); }

  function dailySolar(lat, tau) { return 3.0 * Math.max(0.05, Math.cos(lat * Math.PI / 180)) * fTau(tau); }

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
      const solar = cfg.panelArea * cfg.efficiency * dailySolar(cfg.lat, tau);
      const nuclear = cfg.kilopower * KILOPOWER_KW * SOL_H;
      const net = solar + nuclear - cfg.consumption;
      batt = Math.max(0, Math.min(cfg.capacity, batt + net));
      if (batt <= 0 && blackoutSol === null) blackoutSol = sol;
      minBatt = Math.min(minBatt, batt);
      rows.push({ sol, tau, solar, nuclear, net, batt });
    }
    const peakRow = rows.reduce((a, b) => (b.tau > a.tau ? b : a), rows[0]);
    return { rows, blackoutSol, minBatt, peakSolarDropPct: 100 * (1 - fTau(cfg.storm.tauPeak) / fTau(cfg.storm.tau0)), peakRow };
  }

  global.STORM = { fTau, dailySolar, tauAt, simulate, SOL_H, KILOPOWER_KW };
})(typeof window !== 'undefined' ? window : module.exports);
