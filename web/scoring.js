// Pure scoring functions. No DOM. Unit-tested in tests/scoring.test.js.
//
// Every criterion maps a physical value to a suitability f in [0,1].
// Thresholds follow the NASA Human Landing Site / Exploration Zone workshop
// constraints (2015): elevation <= +2 km (EDL atmosphere), latitude within +-50 deg
// (solar power, thermal), slopes <= 5 deg for landing and <= 15 deg for rover ops,
// and ISRU water ice within reach of the base.
(function (global) {
  'use strict';

  function ramp(x, x0, x1) {           // 1 at x<=x0, 0 at x>=x1, linear between
    if (x <= x0) return 1;
    if (x >= x1) return 0;
    return 1 - (x - x0) / (x1 - x0);
  }

  // Atmospheric column mass sigma(h) = 16.4 g/cm2 * exp(-h / 11.1 km) (610 Pa datum, g = 3.71, scale height 11.1 km).
  // Surface GCR dose D = 0.64 mSv/day * exp(-(sigma - 24.6) / 60) * 365.25, anchored on MSL Curiosity RAD at Gale Crater
  // (Hassler et al. 2014, Science 343: 0.64 +- 0.12 mSv/day at -4.4 km, sigma ~ 24.6 g/cm2).
  function atmoColumnGcm2(h_m) {
    return 16.4 * Math.exp(-h_m / 11100);
  }
  function radDose(h_m) {
    const sigma = atmoColumnGcm2(h_m);
    return 0.64 * Math.exp(-(sigma - 24.6) / 60) * 365.25;
  }
  const radDoseMsvYr = radDose;

  // NASA ECLSS & ISRU Mass Balance Model (Interplanetary Survival Guide)
  // Human metabolic life-support consumption (4-crew baseline):
  // ~10.0 L/sol potable water (drinking + food rehydration + hygiene with 85% urine processor recovery).
  // Stoichiometric water electrolysis produces 0.888 kg O2 per liter of H2O.
  // Sabatier propellant production (CH4 / LOX return fuel) requires >= 25 L/sol water extraction.
  function calcISRU(c, depthBand) {
    if (c === null || c < -0.2) {
      return { yieldLitersSol: 0, crewMargin: -10, loxKgSol: 0, status: 'DRY', label: 'Arid / No Extractable Ice' };
    }
    const cNorm = Math.max(0, Math.min(1, (c + 1) / 2));
    const depthFactor = depthBand === 'ice01' ? 1.0 : depthBand === 'ice15' ? 0.65 : 0.35;
    // Standard 5 kWe thermal-drill / sublimator ISRU pilot unit:
    const yieldLitersSol = Math.round(cNorm * depthFactor * 68.0 * 10) / 10;
    const crewDemand = 10.0;
    const crewMargin = Math.round((yieldLitersSol - crewDemand) * 10) / 10;
    const loxKgSol = Math.round(yieldLitersSol * 0.888 * 10) / 10;
    let status = 'DEFICIT', label = 'Sub-critical Yield';
    if (crewMargin >= 25) {
      status = 'SURPLUS_PROPELLANT';
      label = 'Full Crew & Propellant ISRU';
    } else if (crewMargin >= 0) {
      status = 'CREW_SUSTAINED';
      label = 'Sustains 4-Crew Life Support';
    }
    return { yieldLitersSol, crewMargin, loxKgSol, status, label };
  }

  const F = {
    // Lower is better: thick atmosphere for parachutes / retro-propulsion margin.
    elev(h_m) { return ramp(h_m, -2000, 2000); },
    // 90th-percentile slope inside the ~10 km cell.
    slope(deg) { return ramp(deg, 5, 15); },
    // SWIM ice consistency -1..1 -> 0..1. null = outside SWIM coverage (|lat| > 60).
    ice(c) { return c === null ? 0 : Math.max(0, Math.min(1, (c + 1) / 2)); },
    // Sub-cell elevation std-dev (m): proxy for rock/relief hazard.
    rough(m) { return ramp(m, 30, 250); },
    // TES thermal inertia: < 100 = thick fine dust (poor bearing strength, dusty panels, EDL radar issues);
    // 150-400 = sand / duricrust / cemented soil (ideal); > 500 = rock / bedrock (hazard, hard to dig). null = no data.
    ti(v) { if (v === null) return 0.5; if (v < 100) return Math.max(0, v / 100 * 0.3); if (v < 150) return 0.3 + 0.7 * (v - 100) / 50; if (v <= 400) return 1; return ramp(v, 400, 700); },
    // Radiation: lower dose is better. <= 200 mSv/yr (Hellas floor) = 1, >= 290 mSv/yr (above +2 km) = 0.
    rad(h_m) { return ramp(radDose(h_m), 200, 290); },
    // Solar energy and thermal budget: mean insolation ~ cos(lat), rescaled so 0 deg = 1 and 50 deg = 0.
    lat(deg) { const c = Math.cos(Math.abs(deg) * Math.PI / 180), c50 = Math.cos(50 * Math.PI / 180); return Math.max(0, Math.min(1, (c - c50) / (1 - c50))); },
  };

  const CRITERIA = [
    { key: 'elev',  label: 'Elevation (EDL safety)',     unit: 'm' },
    { key: 'slope', label: 'Slope (landing / rover)',    unit: '°' },
    { key: 'ice',   label: 'Water ice (ISRU)',           unit: '' },
    { key: 'rough', label: 'Terrain roughness',          unit: 'm' },
    { key: 'lat',   label: 'Latitude (solar / thermal)', unit: '°' },
    { key: 'ti',    label: 'Thermal inertia (surface)',  unit: 'tiu' },
    { key: 'rad',   label: 'Radiation (GCR dose)',       unit: 'mSv/yr' },
  ];

  const PRESETS = {
    landing:  { name: 'Landing safety',          icon: '🛬', w: { elev: 0.25, slope: 0.25, ice: 0.05, rough: 0.15, lat: 0.10, ti: 0.15, rad: 0.05 } },
    isru:     { name: 'ISRU / sustainability',   icon: '💧', w: { elev: 0.10, slope: 0.15, ice: 0.40, rough: 0.10, lat: 0.10, ti: 0.10, rad: 0.05 } },
    balanced: { name: 'Balanced crewed mission', icon: '⚖️', w: { elev: 0.15, slope: 0.20, ice: 0.25, rough: 0.10, lat: 0.10, ti: 0.15, rad: 0.05 } },
  };

  const HARD = { elevMax: 2000, slopeMax: 15, latMax: 50 };

  function normalize(w) {
    const s = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const out = { elev: 0, slope: 0, ice: 0, rough: 0, lat: 0, ti: 0, rad: 0 };
    for (const k in w) out[k] = w[k] / s;
    return out;
  }

  // Score for a single cell given physical values.
  function scoreCell(v, w, hard) {
    if (hard && (v.elev > HARD.elevMax || v.slope > HARD.slopeMax || Math.abs(v.lat) > HARD.latMax)) return 0;
    return (w.elev || 0) * F.elev(v.elev) + (w.slope || 0) * F.slope(v.slope) + (w.ice || 0) * F.ice(v.ice)
         + (w.rough || 0) * F.rough(v.rough) + (w.lat || 0) * F.lat(v.lat) + (w.ti || 0) * F.ti(v.ti)
         + (w.rad || 0) * F.rad(v.elev);
  }

  // Full-map scoring. layers: {elev, slope, rough, ice: Float32Array|null-coded, lat: Float32Array (per row)}
  // Writes into out (Float32Array of width*height). Returns out.
  function scoreMap(L, weights, hard, out) {
    const w = normalize(weights);
    const { width, height } = L;
    const fe = new Float32Array(256), fs = new Float32Array(256), fr = new Float32Array(256), fi = new Float32Array(256), ft = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const h = L.meta.elev.offset + i * L.meta.elev.scale;
      fe[i] = w.elev * F.elev(h) + w.rad * F.rad(h);
      fs[i] = F.slope(i * L.meta.slope.scale);
      fr[i] = F.rough(i * L.meta.rough.scale);
      fi[i] = i === 0 ? 0 : F.ice(L.meta.ice.offset + i * L.meta.ice.scale);
      ft[i] = i === 0 ? F.ti(null) : F.ti(i * L.meta.ti.scale);
    }
    const elevHardIdx = (HARD.elevMax - L.meta.elev.offset) / L.meta.elev.scale;
    const slopeHardIdx = HARD.slopeMax / L.meta.slope.scale;
    for (let y = 0; y < height; y++) {
      const lat = L.latOfRow(y), row = y * width;
      if (hard && Math.abs(lat) > HARD.latMax) { out.fill(0, row, row + width); continue; }
      const fl = F.lat(lat) * w.lat;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const e = L.elev[i], s = L.slope[i];
        if (hard && (e > elevHardIdx || s > slopeHardIdx)) { out[i] = 0; continue; }
        out[i] = fe[e] + w.slope * fs[s] + w.ice * fi[L.ice[i]] + w.rough * fr[L.rough[i]] + w.ti * ft[L.ti[i]] + fl;
      }
    }
    return out;
  }

  // Top-N candidate blocks with non-maximum suppression.
  // blockPx: aggregation block size in pixels; minSepPx: suppression radius in pixels.
  function topCandidates(score, width, height, n, blockPx, minSepPx) {
    const bw = Math.floor(width / blockPx), bh = Math.floor(height / blockPx);
    const blocks = [];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      for (let y = 0; y < blockPx; y++) {
        const row = (by * blockPx + y) * width + bx * blockPx;
        for (let x = 0; x < blockPx; x++) sum += score[row + x];
      }
      blocks.push({ bx, by, s: sum / (blockPx * blockPx) });
    }
    blocks.sort((a, b) => b.s - a.s);
    const picked = [];
    for (const b of blocks) {
      if (b.s <= 0) break;
      let ok = true;
      for (const p of picked) {
        let dx = Math.abs(p.bx - b.bx) * blockPx; dx = Math.min(dx, width - dx);
        const dy = Math.abs(p.by - b.by) * blockPx;
        if (Math.hypot(dx, dy) < minSepPx) { ok = false; break; }
      }
      if (ok) picked.push(b);
      if (picked.length >= n) break;
    }
    return picked.map(b => ({
      x: b.bx * blockPx + blockPx / 2, y: b.by * blockPx + blockPx / 2, score: b.s,
    }));
  }

  // Weight-sensitivity (Monte Carlo): perturb every weight by a uniform factor in [1-spread, 1+spread], re-score,
  // and report for each reference candidate the fraction of runs in which a top-N candidate lies within matchPx of it.
  function sensitivity(L, weights, hard, ref, o, rng) {
    const runs = o.runs || 30, spread = o.spread ?? 0.2, keep = new Array(ref.length).fill(0);
    const buf = new Float32Array(L.width * L.height);
    for (let r = 0; r < runs; r++) {
      const w = {};
      for (const k in weights) w[k] = weights[k] * (1 - spread + 2 * spread * rng());
      scoreMap(L, w, hard, buf);
      const top = topCandidates(buf, L.width, L.height, o.n || 5, o.blockPx, o.minSepPx);
      ref.forEach((c, i) => {
        if (top.some(t => { let dx = Math.abs(t.x - c.x); dx = Math.min(dx, L.width - dx); return Math.hypot(dx, t.y - c.y) <= o.matchPx; })) keep[i]++;
      });
    }
    return keep.map(k => k / runs);
  }

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  global.SCORING = { F, CRITERIA, PRESETS, HARD, normalize, scoreCell, scoreMap, topCandidates, ramp, atmoColumnGcm2, radDose, radDoseMsvYr, calcISRU, sensitivity, mulberry32 };
})(typeof window !== 'undefined' ? window : module.exports);
