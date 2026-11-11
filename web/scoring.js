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
    // Solar energy and thermal budget: mean insolation ~ cos(lat), rescaled so 0 deg = 1 and 50 deg = 0.
    lat(deg) { const c = Math.cos(Math.abs(deg) * Math.PI / 180), c50 = Math.cos(50 * Math.PI / 180); return Math.max(0, Math.min(1, (c - c50) / (1 - c50))); },
  };

  const CRITERIA = [
    { key: 'elev',  label: 'Elevation (EDL safety)',   unit: 'm' },
    { key: 'slope', label: 'Slope (landing / rover)',   unit: '°' },
    { key: 'ice',   label: 'Water ice (ISRU)',          unit: '' },
    { key: 'rough', label: 'Terrain roughness',         unit: 'm' },
    { key: 'lat',   label: 'Latitude (solar / thermal)', unit: '°' },
    { key: 'ti',    label: 'Thermal inertia (surface)',  unit: 'tiu' },
  ];

  const PRESETS = {
    landing:  { name: 'Landing safety',       icon: '🛬', w: { elev: 0.30, slope: 0.25, ice: 0.05, rough: 0.15, lat: 0.10, ti: 0.15 } },
    isru:     { name: 'ISRU / sustainability', icon: '💧', w: { elev: 0.10, slope: 0.15, ice: 0.45, rough: 0.10, lat: 0.10, ti: 0.10 } },
    balanced: { name: 'Balanced crewed mission', icon: '⚖️', w: { elev: 0.20, slope: 0.20, ice: 0.25, rough: 0.10, lat: 0.10, ti: 0.15 } },
  };

  const HARD = { elevMax: 2000, slopeMax: 15, latMax: 50 };

  function normalize(w) {
    const s = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const out = {};
    for (const k in w) out[k] = w[k] / s;
    return out;
  }

  // Score for a single cell given physical values.
  function scoreCell(v, w, hard) {
    if (hard && (v.elev > HARD.elevMax || v.slope > HARD.slopeMax || Math.abs(v.lat) > HARD.latMax)) return 0;
    return w.elev * F.elev(v.elev) + w.slope * F.slope(v.slope) + w.ice * F.ice(v.ice)
         + w.rough * F.rough(v.rough) + w.lat * F.lat(v.lat) + w.ti * F.ti(v.ti);
  }

  // Full-map scoring. layers: {elev, slope, rough, ice: Float32Array|null-coded, lat: Float32Array (per row)}
  // Writes into out (Float32Array of width*height). Returns out.
  function scoreMap(L, weights, hard, out) {
    const w = normalize(weights);
    const { width, height } = L;
    const fe = new Float32Array(256), fs = new Float32Array(256), fr = new Float32Array(256), fi = new Float32Array(256), ft = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      fe[i] = F.elev(L.meta.elev.offset + i * L.meta.elev.scale);
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
        out[i] = w.elev * fe[e] + w.slope * fs[s] + w.ice * fi[L.ice[i]] + w.rough * fr[L.rough[i]] + w.ti * ft[L.ti[i]] + fl;
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

  global.SCORING = { F, CRITERIA, PRESETS, HARD, normalize, scoreCell, scoreMap, topCandidates, ramp };
})(typeof window !== 'undefined' ? window : module.exports);
