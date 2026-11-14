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

  // ---------------------------------------------------------------- Ice access (replaces the old "ISRU yield")
  // SWIM 2.0 "consistency" (-1..1) measures how strongly five independent datasets AGREE that ice is present
  // (Morgan et al. 2021, Nat. Astron. 5). It does NOT measure ice concentration, purity or extraction yield,
  // so no litres-per-sol number is derived from it. Classes use our thresholds: >= 0.5 likely, >= 0 possible.
  // The excavation figure is an explicit ASSUMPTION the user can see: ice-cemented regolith at ICE_WT_ASSUMED.
  const ICE_WT_ASSUMED = 0.10;          // 10 wt% water ice in regolith (assumption, not data)
  const CREW_WATER_L_SOL = 10;          // 4 crew, recycled ECLSS make-up water per sol (assumption)
  function calcIceAccess(c, depthBand) {
    const depth = depthBand === 'ice01' ? '0-1 m' : depthBand === 'ice15' ? '1-5 m' : '> 5 m';
    if (c === null || c === undefined) return { status: 'NO_DATA', label: 'Outside SWIM coverage', depth, consistency: null, regolithKgSol: null };
    const status = c >= 0.5 ? 'LIKELY' : c >= 0 ? 'POSSIBLE' : 'UNLIKELY';
    const label = { LIKELY: 'Ice likely (datasets agree)', POSSIBLE: 'Ice possible (mixed evidence)', UNLIKELY: 'Ice unlikely' }[status];
    // kg of regolith to excavate per sol for the crew make-up water IF the assumed concentration holds
    const regolithKgSol = status === 'UNLIKELY' ? null : Math.round(CREW_WATER_L_SOL / ICE_WT_ASSUMED);
    return { status, label, depth, consistency: c, regolithKgSol, assumption: `${ICE_WT_ASSUMED * 100}% ice by mass, ${CREW_WATER_L_SOL} L/sol crew make-up water` };
  }

  // ---------------------------------------------------------------- Solar particle event (SPE) shielding
  // One attenuation law for every shield (atmosphere, regolith, basalt): D = D_REF * exp(-(sigma - SIGMA_REF) / LAMBDA_SPE).
  // D_REF is a DESIGN-BASIS ASSUMPTION (an August-1972-class event, ~1 Sv behind 5 g/cm2), not a forecast.
  // LAMBDA_SPE = 15 g/cm2 reflects the soft proton spectrum of SPEs (much shorter than for GCR).
  // For scale: the largest SPE measured on the Martian surface so far (Sept 2017, MSL/RAD) added ~0.4 mGy (Guo et al. 2018, GRL 45).
  const SPE_D_REF = 1000, SPE_SIGMA_REF = 5, LAMBDA_SPE = 15;
  const RHO_REGOLITH = 1.5, RHO_BASALT = 2.9;    // g/cm3
  function speDose(sigma) { return SPE_D_REF * Math.exp(-(sigma - SPE_SIGMA_REF) / LAMBDA_SPE); }
  function calcSPE(elev_m, regolithCoverMeters) {
    const atm = atmoColumnGcm2(elev_m), cover = Math.max(0, regolithCoverMeters || 0);
    const unshieldedDoseMsv = Math.round(speDose(atm));
    const shieldedDoseMsv = Math.round(speDose(atm + cover * 100 * RHO_REGOLITH));
    const need = LAMBDA_SPE * Math.log(Math.max(1, unshieldedDoseMsv / 100)) / (100 * RHO_REGOLITH);   // metres for <= 100 mSv
    const requiredRegolithM = Math.ceil(need * 20) / 20;
    const lavaTubeMsv = +speDose(atm + 3.5 * 100 * RHO_BASALT).toExponential(1);
    const survivalStatus = shieldedDoseMsv <= 100 ? 'WITHIN_100_MSV' : shieldedDoseMsv <= 250 ? 'ABOVE_100_MSV' : 'ABOVE_250_MSV';
    return { unshieldedDoseMsv, shieldedDoseMsv, requiredRegolithM, survivalStatus, lavaTubeMsv, designBasis: true };
  }

  // ---------------------------------------------------------------- Regional terrain class (replaces "boulder risk %")
  // MOLA at ~2.3 km cannot see boulders. This only classifies regional relief using the same thresholds as the
  // slope / roughness criteria; certifying a landing ellipse always needs HiRISE imagery and rock-abundance data.
  function calcTerrainClass(slope_deg, rough_m) {
    const s = Math.max(0, slope_deg), r = Math.max(0, rough_m);
    const terrainClass = s <= 5 && r <= 30 ? 'SMOOTH' : s <= 10 && r <= 100 ? 'MODERATE' : 'RUGGED';
    return {
      terrainClass,
      label: { SMOOTH: 'Smooth regional relief', MODERATE: 'Moderate regional relief', RUGGED: 'Rugged regional relief' }[terrainClass],
      recommendation: 'Regional class from MOLA only. Boulders and small craters are not resolved: check HiRISE / CTX before selecting an ellipse.',
    };
  }

  const F = {
    // Lower is better: thick atmosphere for parachutes / retro-propulsion margin.
    elev(h_m) { return ramp(h_m, -2000, 2000); },
    // 90th-percentile slope inside the ~5 km cell (computed at 2.3 km baseline).
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
    // Shelter access: distance (km) to the nearest MGC3 cave candidate. <= 50 km = 1, >= 500 km = 0. null = >= 1020 km.
    cave(km) { return km === null ? 0 : ramp(km, 50, 500); },
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
    { key: 'cave',  label: 'Shelter (cave candidate)',   unit: 'km' },
  ];

  const PRESETS = {
    landing:  { name: 'Landing safety',          w: { elev: 0.25, slope: 0.25, ice: 0.05, rough: 0.15, lat: 0.10, ti: 0.15, rad: 0.05, cave: 0 } },
    isru:     { name: 'ISRU / sustainability',   w: { elev: 0.10, slope: 0.15, ice: 0.40, rough: 0.10, lat: 0.10, ti: 0.10, rad: 0.05, cave: 0 } },
    balanced: { name: 'Balanced crewed mission', w: { elev: 0.15, slope: 0.20, ice: 0.25, rough: 0.10, lat: 0.10, ti: 0.15, rad: 0.05, cave: 0 } },
  };

  const HARD = { elevMax: 2000, slopeMax: 15, latMax: 50 };

  function normalize(w) {
    const s = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const out = { elev: 0, slope: 0, ice: 0, rough: 0, lat: 0, ti: 0, rad: 0, cave: 0 };
    for (const k in w) out[k] = w[k] / s;
    return out;
  }

  // Score for a single cell given physical values.
  function scoreCell(v, w, hard) {
    if (hard && (v.elev > HARD.elevMax || v.slope > HARD.slopeMax || Math.abs(v.lat) > HARD.latMax)) return 0;
    return (w.elev || 0) * F.elev(v.elev) + (w.slope || 0) * F.slope(v.slope) + (w.ice || 0) * F.ice(v.ice)
         + (w.rough || 0) * F.rough(v.rough) + (w.lat || 0) * F.lat(v.lat) + (w.ti || 0) * F.ti(v.ti)
         + (w.rad || 0) * F.rad(v.elev) + (w.cave || 0) * F.cave(v.cave ?? null);
  }

  // Full-map scoring. layers: {elev, slope, rough, ice: Float32Array|null-coded, lat: Float32Array (per row)}
  // Writes into out (Float32Array of width*height). Returns out.
  // mode 'sum' (default): S = sum w_i f_i  - criteria can compensate each other.
  // mode 'geo': S = prod f_i^w_i (weighted geometric mean, f floored at 0.01) - a near-zero criterion drags the
  //             whole score down, so excellent ice cannot buy back unsafe slopes.
  function scoreMap(L, weights, hard, out, mode) {
    const w = normalize(weights), geo = mode === 'geo';
    const ln = (f) => Math.log(Math.max(0.01, f));
    const { width, height } = L;
    const fe = new Float32Array(256), fs = new Float32Array(256), fr = new Float32Array(256), fi = new Float32Array(256), ft = new Float32Array(256), fc = new Float32Array(256);
    const useCave = !!(L.cave && w.cave > 0);
    for (let i = 0; i < 256; i++) {
      const h = L.meta.elev.offset + i * L.meta.elev.scale;
      const fsv = F.slope(i * L.meta.slope.scale), frv = F.rough(i * L.meta.rough.scale);
      const fiv = i === 0 ? 0 : F.ice(L.meta.ice.offset + i * L.meta.ice.scale), ftv = i === 0 ? F.ti(null) : F.ti(i * L.meta.ti.scale);
      const fcv = i === 255 ? 0 : F.cave(i * (L.meta.cave ? L.meta.cave.scale : 4));
      fc[i] = geo ? w.cave * ln(fcv) : w.cave * fcv;
      if (geo) { fe[i] = w.elev * ln(F.elev(h)) + w.rad * ln(F.rad(h)); fs[i] = w.slope * ln(fsv); fr[i] = w.rough * ln(frv); fi[i] = w.ice * ln(fiv); ft[i] = w.ti * ln(ftv); }
      else { fe[i] = w.elev * F.elev(h) + w.rad * F.rad(h); fs[i] = w.slope * fsv; fr[i] = w.rough * frv; fi[i] = w.ice * fiv; ft[i] = w.ti * ftv; }
    }
    const elevHardIdx = (HARD.elevMax - L.meta.elev.offset) / L.meta.elev.scale;
    const slopeHardIdx = HARD.slopeMax / L.meta.slope.scale;
    for (let y = 0; y < height; y++) {
      const lat = L.latOfRow(y), row = y * width;
      if (hard && Math.abs(lat) > HARD.latMax) { out.fill(0, row, row + width); continue; }
      const fl = geo ? w.lat * ln(F.lat(lat)) : F.lat(lat) * w.lat;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const e = L.elev[i], s = L.slope[i];
        if (hard && (e > elevHardIdx || s > slopeHardIdx)) { out[i] = 0; continue; }
        const t = fe[e] + fs[s] + fi[L.ice[i]] + fr[L.rough[i]] + ft[L.ti[i]] + fl + (useCave ? fc[L.cave[i]] : 0);
        out[i] = geo ? Math.exp(t) : t;
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
      let sum = 0, valid = 0;
      for (let y = 0; y < blockPx; y++) {
        const row = (by * blockPx + y) * width + bx * blockPx;
        for (let x = 0; x < blockPx; x++) { const v = score[row + x]; sum += v; if (v > 0) valid++; }
      }
      const validFrac = valid / (blockPx * blockPx);
      // a block is a candidate only if >= 75 % of its cells pass the hard constraints (a mean must not hide vetoed ground)
      if (validFrac >= 0.75) blocks.push({ bx, by, s: sum / (blockPx * blockPx), validFrac });
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
      x: b.bx * blockPx + blockPx / 2, y: b.by * blockPx + blockPx / 2, score: b.s, validFrac: b.validFrac,
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
      scoreMap(L, w, hard, buf, o.mode);
      const top = topCandidates(buf, L.width, L.height, o.n || 5, o.blockPx, o.minSepPx);
      ref.forEach((c, i) => {
        if (top.some(t => { let dx = Math.abs(t.x - c.x); dx = Math.min(dx, L.width - dx); return Math.hypot(dx, t.y - c.y) <= o.matchPx; })) keep[i]++;
      });
    }
    return keep.map(k => k / runs);
  }

  /** Linearly interpolate an encoded layer array at fractional grid coordinates (wrapping horizontally).
   * @param {Uint8Array} arr
   * @param {number} width
   * @param {number} height
   * @param {number} fx
   * @param {number} fy
   * @param {number} scale
   * @param {number} [offset=0]
   * @param {number|null} [nodataVal=null] Value treated as missing data before decoding
   * @returns {number|null}
   */
  function sampleBilinear(arr, width, height, fx, fy, scale, offset = 0, nodataVal = null) {
    if (!arr) return null;
    const x0 = ((Math.floor(fx) % width) + width) % width;
    const x1 = (x0 + 1) % width;
    const yClamped = Math.max(0, Math.min(height - 1.0001, fy));
    const y0 = Math.floor(yClamped), y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - Math.floor(fx), ty = yClamped - y0;
    const raw = [arr[y0 * width + x0], arr[y0 * width + x1], arr[y1 * width + x0], arr[y1 * width + x1]];
    if (nodataVal !== null && raw.some(v => v === nodataVal)) {
      const center = arr[Math.round(yClamped) * width + (((Math.round(fx) % width) + width) % width)];
      return center === nodataVal ? null : offset + center * scale;
    }
    const a = offset + raw[0] * scale, b = offset + raw[1] * scale;
    const c = offset + raw[2] * scale, d = offset + raw[3] * scale;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  global.SCORING = { F, CRITERIA, PRESETS, HARD, normalize, scoreCell, scoreMap, topCandidates, ramp, atmoColumnGcm2, radDose, radDoseMsvYr, calcIceAccess, calcSPE, speDose, calcTerrainClass, sensitivity, sampleBilinear, mulberry32 };
})(typeof window !== 'undefined' ? window : module.exports);
