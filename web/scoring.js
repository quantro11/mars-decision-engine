// Pure scoring functions. No DOM. Unit-tested in tests/scoring.test.js.
//
// Every criterion maps a physical value to a suitability f in [0,1].
// Thresholds follow the NASA Human Landing Site / Exploration Zone workshop
// constraints (2015): elevation <= +2 km (EDL atmosphere), latitude within +-50 deg
// (solar power, thermal), slopes <= 5 deg for landing and <= 15 deg for rover ops,
// and ISRU water ice within reach of the base.
(function (global) {
  'use strict';

  const PLANET = (global.PLANET_PROFILES ||
    (typeof globalThis !== 'undefined' && globalThis.PLANET_PROFILES) ||
    (typeof require === 'function' ? require('./planet_profiles.js').PLANET_PROFILES : null)).get();

  function ramp(x, x0, x1) {           // 1 at x<=x0, 0 at x>=x1, linear between
    if (x <= x0) return 1;
    if (x >= x1) return 0;
    return 1 - (x - x0) / (x1 - x0);
  }

  // Atmospheric column mass sigma(h, Ls) = 16.4 g/cm2 * f_P(Ls) * exp(-h / 11.1 km) (610 Pa datum, g = 3.71, scale height 11.1 km).
  // Includes optional Viking/MSL REMS two-harmonic seasonal CO2 polar cap condensation/sublimation cycle (+-12% column shift).
  // Surface GCR dose D = 0.64 mSv/day * exp(-(sigma - 24.6) / 60) * 365.25 * Omega(slope), anchored on MSL Curiosity RAD at Gale Crater
  // (Hassler et al. 2014, Science 343: 0.64 +- 0.12 mSv/day at -4.4 km, sigma ~ 24.6 g/cm2).
  function atmoColumnGcm2(h_m, ls = null) {
    let fSeason = 1.0;
    if (ls !== null && ls !== undefined) {
      const sc = PLANET.atmosphere.seasonalColumn;
      const phi = ((ls - sc.phaseLsDeg) * Math.PI) / 180;
      fSeason = 1.0 + sc.a1 * Math.cos(phi) + sc.a2 * Math.cos(2 * phi);
    }
    return PLANET.atmosphere.columnDatumGcm2.value * fSeason * Math.exp(-h_m / PLANET.atmosphere.scaleHeightM.value);
  }
  function radDose(h_m, slopeDeg = 0, ls = null) {
    const sigma = atmoColumnGcm2(h_m, ls);
    const sDeg = Math.min(45, Math.max(0, slopeDeg || 0));
    const skyView = 1 - 0.5 * (1 - Math.cos(sDeg * Math.PI / 180));
    const geomFactor = Math.max(0.75, skyView - sDeg * 0.002);
    const R = PLANET.radiation;
    return R.anchorDoseMsvPerDay.value * Math.exp(-(sigma - R.anchorColumnGcm2.value) / R.eFoldColumnGcm2.value) * 365.25 * geomFactor;
  }
  const radDoseMsvYr = radDose;

  // Gale Crater MSL-RAD reference observation (Hassler et al. 2014, Science 343) is 0.64 +- 0.12 mSv/day (+-18.75% 1-sigma),
  // subject to heliospheric solar-cycle modulation and secondary neutron albedo variations across regolith composition.
  function radDoseBand(h_m, slopeDeg = 0, ls = null) {
    const nominal = radDose(h_m, slopeDeg, ls);
    const uncMsvYr = Math.round(nominal * 0.1875);
    return {
      nominal: Math.round(nominal),
      min: Math.round(nominal - uncMsvYr),
      max: Math.round(nominal + uncMsvYr),
      uncMsvYr,
      relUncPct: 18.8,
      refSite: 'MSL Curiosity RAD at Gale Crater (-4.59°N, 137.44°E, -4,400 m)',
      note: 'Extrapolated from Gale Crater 0.64 ± 0.12 mSv/day via barometric mass column Σ(h, Ls) and horizon sky-view Ω(θ)'
    };
  }

  // Operational slope limit contextualization: 15° is our engineering model baseline (MER/MSL planning rule),
  // not a universal physical human limit. Loose fine dust (TI < 100 tiu) lowers slip-safe limit; bedrock (TI >= 300) supports full limit.
  function effectiveSlopeLimit(nominalMaxDeg = 15, ti = 220) {
    const base = Math.max(5, Math.min(30, nominalMaxDeg || 15));
    const tiVal = ti === null || ti === undefined ? 215 : ti;
    let delta = 0;
    let soilRegime = 'consolidated_regolith';
    if (tiVal < 100) {
      delta = -3.5;
      soilRegime = 'loose_fine_dust';
    } else if (tiVal < 150) {
      delta = -1.8;
      soilRegime = 'unconsolidated_sand';
    } else if (tiVal >= 340) {
      delta = +1.5;
      soilRegime = 'indurated_bedrock';
    }
    const effectiveMaxDeg = +(Math.max(5, Math.min(28, base + delta))).toFixed(1);
    return {
      nominalMaxDeg: base,
      effectiveMaxDeg,
      deltaDeg: delta,
      soilRegime,
      note: '15° is the model operational baseline (not a universal human limit); adjusted locally by TES thermophysical grain/induration proxy'
    };
  }

  // Bekker-Wong Terramechanics formulation: Calculates vehicle ground sinkage, compaction resistance,
  // and tractive pull/slip safety factor based on soil regime (TI proxy), vehicle mass, and wheel geometry.
  function calcBekkerTerramechanics(ti = 220, wheelLoadN = 450, wheelWidthM = 0.25, wheelRadiusM = 0.25) {
    const tiVal = ti === null || ti === undefined ? 215 : ti;
    let kc = 15000.0, kphi = 1800000.0, n = 0.8, c_cohesion = 1.2, phi_deg = 33.0;
    let soilClass = 'consolidated_regolith';
    if (tiVal < 100) {
      kc = 1000.0; kphi = 350000.0; n = 1.1; c_cohesion = 0.15; phi_deg = 22.0; soilClass = 'loose_fine_dust';
    } else if (tiVal < 150) {
      kc = 3000.0; kphi = 950000.0; n = 0.95; c_cohesion = 0.4; phi_deg = 28.0; soilClass = 'unconsolidated_sand';
    } else if (tiVal >= 340) {
      kc = 80000.0; kphi = 6500000.0; n = 0.65; c_cohesion = 8.5; phi_deg = 40.0; soilClass = 'indurated_duricrust';
    }
    const b = Math.max(0.05, wheelWidthM);
    const r = Math.max(0.05, wheelRadiusM);
    const denom = (kc / b + kphi) * b * Math.sqrt(2 * r);
    // Rigid-wheel sinkage (Bekker/Wong): z = [3W / ((3 - n)(kc + b·kphi)·sqrt(D))]^(2/(2n+1)), D = 2r.
    // Soil constants per TI class are assumed values in the range published for lunar/Mars simulants, not Mars measurements.
    const z_sinkage_m = Math.min(r * 0.8, Math.pow((3 * Math.max(10, wheelLoadN)) / ((3 - n) * Math.max(10, denom)), 2.0 / (2.0 * n + 1.0)));
    const rc_compaction_n = (b * (kc / b + kphi) * Math.pow(z_sinkage_m, n + 1)) / (n + 1);
    const maxThrustN = wheelLoadN * Math.tan(phi_deg * Math.PI / 180.0) + (c_cohesion * b * Math.sqrt(2 * r * z_sinkage_m) * 1000.0);
    const drawbarPullN = Math.max(0, maxThrustN - rc_compaction_n);
    const slipRiskPct = Math.round(Math.min(100, Math.max(5, (z_sinkage_m / (r * 0.25)) * 100)));

    return {
      soilClass,
      sinkageMm: +(z_sinkage_m * 1000).toFixed(1),
      compactionResistanceN: +rc_compaction_n.toFixed(1),
      drawbarPullN: +drawbarPullN.toFixed(1),
      slipRiskPct,
      safeTraction: slipRiskPct < 45,
      model: 'Bekker-Wong Soil Mechanics (kc, kphi, n)'
    };
  }

  // ---------------------------------------------------------------- Ice access (replaces the old "ISRU yield")
  // SWIM 2.0 "consistency" (-1..1) measures how strongly five independent datasets AGREE that ice is present
  // (Morgan et al. 2021, Nat. Astron. 5). It does NOT measure ice concentration, purity or extraction yield,
  // so no litres-per-sol number is derived from it. Classes use our thresholds: >= 0.5 likely, >= 0 possible.
  // The excavation figure is an explicit ASSUMPTION the user can see: ice-cemented regolith at ICE_WT_ASSUMED.
  const ICE_WT_ASSUMED = 0.10;          // 10 wt% water ice in regolith (assumption, not data)
  const CREW_WATER_L_SOL = 10;          // 4 crew, recycled ECLSS make-up water per sol (assumption)
  function calcIceAccess(c, depthBand) {
    const depth = depthBand === 'ice01' ? '0-1 m' : depthBand === 'ice15' ? '1-5 m' : '> 5 m';
    const scientificNote = 'SWIM 2.0 consistency (-1..+1) is a multi-sensor dielectric/thermal/neutron agreement index, not confirmed ice volume or purity';
    if (c === null || c === undefined) {
      return {
        status: 'NO_DATA',
        isNoData: true,
        label: 'Outside SWIM coverage (±60° limit — not equivalent to ice-free)',
        depth,
        consistency: null,
        regolithKgSol: null,
        scientificNote
      };
    }
    const status = c >= 0.5 ? 'LIKELY' : c >= 0 ? 'POSSIBLE' : 'UNLIKELY';
    const label = {
      LIKELY: 'Ice likely (datasets agree — drill core verification required)',
      POSSIBLE: 'Ice possible (mixed sensor evidence — unconfirmed)',
      UNLIKELY: 'Ice unlikely (datasets agree ice absent)'
    }[status];
    // kg of regolith to excavate per sol for the crew make-up water IF the assumed concentration holds
    const regolithKgSol = status === 'UNLIKELY' ? null : Math.round(CREW_WATER_L_SOL / ICE_WT_ASSUMED);
    return {
      status,
      isNoData: false,
      label,
      depth,
      consistency: c,
      regolithKgSol,
      assumption: `${ICE_WT_ASSUMED * 100}% ice by mass, ${CREW_WATER_L_SOL} L/sol crew make-up water`,
      scientificNote
    };
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
    rad(h_m, slopeDeg = 0) { return ramp(radDose(h_m, slopeDeg), 200, 290); },
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
         + (w.rad || 0) * F.rad(v.elev, v.slope || 0) + (w.cave || 0) * F.cave(v.cave ?? null);
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
    const frad = new Float32Array(64 * 256);
    const useCave = !!(L.cave && w.cave > 0);
    for (let i = 0; i < 256; i++) {
      const h = L.meta.elev.offset + i * L.meta.elev.scale;
      const fsv = F.slope(i * L.meta.slope.scale), frv = F.rough(i * L.meta.rough.scale);
      const fiv = i === 0 ? 0 : F.ice(L.meta.ice.offset + i * L.meta.ice.scale), ftv = i === 0 ? F.ti(null) : F.ti(i * L.meta.ti.scale);
      const fcv = i === 255 ? 0 : F.cave(i * (L.meta.cave ? L.meta.cave.scale : 4));
      fc[i] = geo ? w.cave * ln(fcv) : w.cave * fcv;
      if (geo) { fe[i] = w.elev * ln(F.elev(h)); fs[i] = w.slope * ln(fsv); fr[i] = w.rough * ln(frv); fi[i] = w.ice * ln(fiv); ft[i] = w.ti * ln(ftv); }
      else { fe[i] = w.elev * F.elev(h); fs[i] = w.slope * fsv; fr[i] = w.rough * frv; fi[i] = w.ice * fiv; ft[i] = w.ti * ftv; }
      for (let sb = 0; sb < 64; sb++) {
        const sDeg = (sb === 0 ? 0 : sb * 4 + 2) * L.meta.slope.scale;
        const frvRad = F.rad(h, sDeg);
        frad[(sb << 8) + i] = geo ? w.rad * ln(frvRad) : w.rad * frvRad;
      }
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
        const t = fe[e] + frad[((s >> 2) << 8) + e] + fs[s] + fi[L.ice[i]] + fr[L.rough[i]] + ft[L.ti[i]] + fl + (useCave ? fc[L.cave[i]] : 0);
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
  // Default upgraded to 100 simulation runs with 95% Wilson binomial confidence intervals.
  function wilson95CI(k, n) {
    if (n <= 0) return [0, 0];
    const z = 1.95996, p = k / n, z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
    return [+Math.max(0, center - half).toFixed(3), +Math.min(1, center + half).toFixed(3)];
  }

  function sensitivity(L, weights, hard, ref, o, rng) {
    const runs = (o && o.runs) || 100, spread = (o && o.spread) ?? 0.2, keep = new Array(ref.length).fill(0);
    const rankSum = new Array(ref.length).fill(0), rankSq = new Array(ref.length).fill(0);
    const buf = new Float32Array(L.width * L.height);
    const topN = (o && o.n) || 5;
    for (let r = 0; r < runs; r++) {
      const w = {};
      for (const k in weights) w[k] = weights[k] * (1 - spread + 2 * spread * rng());
      scoreMap(L, w, hard, buf, o && o.mode);
      const top = topCandidates(buf, L.width, L.height, topN, o.blockPx, o.minSepPx);
      ref.forEach((c, i) => {
        const idx = top.findIndex(t => { let dx = Math.abs(t.x - c.x); dx = Math.min(dx, L.width - dx); return Math.hypot(dx, t.y - c.y) <= o.matchPx; });
        const rnk = idx >= 0 ? (idx + 1) : (topN + 1);
        if (idx >= 0) keep[i]++;
        rankSum[i] += rnk;
        rankSq[i] += rnk * rnk;
      });
    }
    const rates = keep.map(k => k / runs);
    rates.runs = runs;
    rates.ci95 = keep.map(k => wilson95CI(k, runs));
    rates.rankStd = keep.map((_, i) => {
      const m = rankSum[i] / runs;
      return +Math.sqrt(Math.max(0, rankSq[i] / runs - m * m)).toFixed(2);
    });
    return rates;
  }

  function sensitivityCI(L, weights, hard, ref, o, rng) {
    const rates = sensitivity(L, weights, hard, ref, o, rng);
    return ref.map((_, i) => ({
      rate: rates[i],
      runs: rates.runs,
      ci95Low: rates.ci95[i][0],
      ci95High: rates.ci95[i][1],
      rankStd: rates.rankStd[i]
    }));
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

  // ---------------------------------------------------------------- 0.38g Martian Pandolf-Santee EVA Bioenergetics & Mars-Adapted xEMU PLSS
  // Note on xEMU Architecture: NASA's xEMU is a Lunar/Artemis reference PLSS architecture (vacuum sublimator/SWME, 1/6g).
  // Here it is extrapolated to Martian surface EVA (0.38g, 6-10 mbar CO2 atmosphere convective heat leak, RCA CO2 scrubber).
  // Budgets: 850 g primary O2 (including 25% return + 13% 30-min emergency reserve), 960 Wh battery, 4.2 L cooling H2O, 920 g CO2 RCA scrubber.
  const MARS_G = PLANET.gravityMs2.value;
  const SUIT_O2_CAP_G = 850;
  const SUIT_BATT_CAP_WH = 960;
  const SUIT_WATER_CAP_L = 4.2;
  const SUIT_CO2_CAP_G = 920; // Rapid Cycle Amine (RCA) + backup LiOH CO2 scrubbing capacity per 8h sortie (g CO2)

  function calcPandolfMars(opts = {}) {
    const gLocal = opts.gravityMps2 ?? MARS_G;
    const slopeDeg = Math.max(0, opts.slopeDeg || 0);
    const rawSpeedKmh = Math.max(0.5, opts.speedKmh || 2.4);
    const loadKg = Math.max(0, opts.loadKg ?? 15);
    const buddyMode = opts.buddyMode || 'buddy';
    const durationH = Math.max(0.2, opts.durationH ?? 6.0);
    const ascentM = Math.max(0, opts.ascentM || 0);
    const ti = opts.ti !== undefined ? opts.ti : 215;
    const ambientTempC = opts.ambientTempC !== undefined ? opts.ambientTempC : -55;
    const tau = Math.max(0.1, opts.tau ?? 0.5);
    const sandFrac = Math.max(0, Math.min(1, opts.sandFrac ?? (ti !== null && ti < 100 ? (100 - ti) / 100 : 0)));

    // Environmental visibility & dust storm pace modulation
    const envSpeedFactor = tau > 1.5 ? Math.max(0.68, 1 - (tau - 1.5) * 0.035) : 1.0;
    const speedKmh = +(rawSpeedKmh * envSpeedFactor).toFixed(2);
    const vMps = Math.max(0.25, speedKmh / 3.6);

    const bodyKg = 80, suitKg = 82;
    const effLoadKg = buddyMode === 'rover_eva' ? loadKg * 0.55 : loadKg * 0.90;
    const effMassLocal = (bodyKg + suitKg + effLoadKg) * (gLocal / 9.81);
    const effGradePct = opts.gradePct !== undefined && opts.gradePct !== null
      ? opts.gradePct
      : Math.tan((slopeDeg * 0.48) * Math.PI / 180) * 100;
    const terrainEta = opts.terrainEta !== undefined ? opts.terrainEta : (1.32 + sandFrac * 0.85);
    const suitJointWorkW = 170; // calibrated so a lunar-gravity walk matches the Apollo 14-17 EVA mean (234 kcal/h ≈ 272 W; NASA TN D-7883)
    const climbWorkW = ascentM > 0 ? ((bodyKg + suitKg + effLoadKg) * gLocal * ascentM) / (durationH * 3600 * 0.25) : 0;
    const loadWorkW = effLoadKg * 2.8 + 2.5 * effMassLocal * Math.pow(effLoadKg / bodyKg, 2);
    const pandolfW = 1.5 * bodyKg * (gLocal / 9.81) +
                     loadWorkW +
                     terrainEta * effMassLocal * (1.5 * vMps * vMps + 0.35 * vMps * effGradePct) +
                     suitJointWorkW +
                     climbWorkW;
    const metabolicW = Math.round(Math.max(190, Math.min(680, pandolfW)));
    const metabolicKcalH = Math.round(metabolicW * 0.8598);
    const totalKcal = Math.round(metabolicKcalH * durationH);

    // O2 consumption & CO2 production (Respiratory Quotient RQ = 0.85 -> ~1.17 g CO2 per g O2)
    const o2UsedG = Math.round(0.255 * metabolicW * durationH);
    const o2UsedPct = Math.min(99, Math.round((o2UsedG / SUIT_O2_CAP_G) * 100));
    const o2RemainPct = Math.max(1, 100 - o2UsedPct);

    const co2ProducedG = Math.round(o2UsedG * 1.17);
    const co2ScrubberUsedPct = Math.min(99, Math.round((co2ProducedG / SUIT_CO2_CAP_G) * 100));
    const co2ScrubberRemainPct = Math.max(1, 100 - co2ScrubberUsedPct);

    // PLSS Electrical Battery (base 95 W avionics/fan/RCA + cold-environment glove/boot heaters in 6-10 mbar CO2 atmosphere)
    const coldHeaterW = ambientTempC < -60 ? Math.min(38, Math.round((-60 - ambientTempC) * 0.85)) : 0;
    const suitPowerW = 95 + 0.06 * metabolicW + coldHeaterW;
    const battUsedWh = Math.round(suitPowerW * durationH);
    const battUsedPct = Math.min(99, Math.round((battUsedWh / SUIT_BATT_CAP_WH) * 100));
    const battRemainPct = Math.max(1, 100 - battUsedPct);

    // LCVG Sublimator / SWME feedwater (modulated slightly by ambient temperature)
    const tempMod = ambientTempC > -35 ? 1.06 : (ambientTempC < -80 ? 0.92 : 1.0);
    const waterRateLh = Math.max(0.08, ((0.72 * metabolicW) / 675) * tempMod);
    const waterUsedL = +(waterRateLh * durationH).toFixed(2);
    const waterUsedPct = Math.min(99, Math.round((waterUsedL / SUIT_WATER_CAP_L) * 100));
    const waterRemainPct = Math.max(1, 100 - waterUsedPct);

    // Mandatory Return & 30-min Emergency Contingency Reserves (minimum 25% O2 / Battery / CO2 scrubber held for return + abort)
    const returnReserveTargetPct = 25;
    const emergencyReserveO2G = Math.round(0.255 * metabolicW * 0.5); // 30-min emergency reserve
    const returnLegO2G = Math.round(o2UsedG * 0.45) + emergencyReserveO2G;
    const returnReserveO2Pct = Math.min(95, Math.round((returnLegO2G / SUIT_O2_CAP_G) * 100));
    const minRemainPct = Math.min(o2RemainPct, battRemainPct, co2ScrubberRemainPct, waterRemainPct);
    const returnReserveProtected = minRemainPct >= returnReserveTargetPct;

    const buddyFactor = buddyMode === 'rover_eva' ? 1.24 : (buddyMode === 'solo' ? 0.86 : 1.0);
    const loadPenalty = Math.max(0.55, 1 - 0.0075 * effLoadKg);
    const slopePenalty = Math.max(0.7, 1 - Math.max(0, slopeDeg - 10) * 0.008);
    const paceFactor = Math.sqrt(Math.max(0.6, Math.min(1.25, speedKmh / 2.4)));
    const o2Factor = Math.max(0.55, Math.min(1, o2RemainPct / 80));
    const walkbackRadiusM = Math.round(Math.max(320, Math.min(980, 960 * loadPenalty * slopePenalty * paceFactor * o2Factor * buddyFactor)));

    return {
      metabolicW, metabolicKcalH, totalKcal,
      o2UsedG, o2UsedPct, o2RemainPct,
      co2ProducedG, co2ScrubberUsedPct, co2ScrubberRemainPct,
      battUsedWh, battUsedPct, battRemainPct, coldHeaterW,
      waterUsedL, waterUsedPct, waterRemainPct,
      returnLegO2G, emergencyReserveO2G, returnReserveO2Pct, returnReserveTargetPct, returnReserveProtected,
      envSpeedFactor, effectiveSpeedKmh: speedKmh,
      walkbackRadiusM,
      suitModelNote: 'Lunar xEMU reference PLSS architecture extrapolated to 0.38g Mars gravity & 6-10 mbar CO2 thermal environment (not flight-certified Mars hardware)'
    };
  }

  // Scientific Data Traceability Catalog (Item 18: Dataset, Product Code, CRS, Native/Shipped Resolution, Update Epoch)
  const LAYER_PROVENANCE = [
    { id: 'elev', name: 'MOLA Planetary Elevation', productCode: 'USGS_MGS_MOLA_DEM_MOSAIC_GLOBAL_463M (MEGDR)', crs: 'IAU-2000 Simple Cylindrical (R = 3389.5 km)', nativeRes: '463 m/px (16-bit int)', shippedRes: '5.2 km/px (4096×2048, 8-bit)', epoch: 'PDS3 Archive / Re-indexed 2024' },
    { id: 'slope', name: 'MOLA 90th-Percentile Slope', productCode: 'DERIVED_MOLA_16BIT_P90_SLOPE_81SAMPLES', crs: 'IAU-2000 Simple Cylindrical (cos φ corrected)', nativeRes: '2.3 km baseline (9216×4608)', shippedRes: '5.2 km/px (0.125°/level)', epoch: 'Derived from MOLA MEGDR (2024)' },
    { id: 'rough', name: 'MOLA Sub-Cell Roughness (σ)', productCode: 'DERIVED_MOLA_16BIT_STDDEV_81SAMPLES', crs: 'IAU-2000 Simple Cylindrical', nativeRes: '2.3 km sub-grid (81 pts/cell)', shippedRes: '5.2 km/px (4 m/level)', epoch: 'Derived from MOLA MEGDR (2024)' },
    { id: 'ice', name: 'SWIM 2.0 Subsurface Ice Consistency', productCode: 'PSI_SWIM_2.0_COMPOSITE_ICE_CONSISTENCY (0-1m, 1-5m, >5m)', crs: 'IAU-2000 Equirectangular (±60° lat)', nativeRes: '3.0 km/px (7200×2400)', shippedRes: '5.2 km/px (-1.0..+1.0 index)', epoch: 'Morgan et al. 2021 (Nature Astron. 5)' },
    { id: 'ti', name: 'MGS TES Thermal Inertia', productCode: 'ASU_JMARS_TES_THERMAL_INERTIA_NUMERIC (Putzig/Mellon)', crs: 'IAU-2000 Simple Cylindrical', nativeRes: '7.4 km/px (8 ppd numeric VICAR)', shippedRes: '5.2 km/px (4 tiu/level)', epoch: 'Christensen et al. / Putzig 2005 PDS' },
    { id: 'dust', name: 'MGS TES Surface Dust Index', productCode: 'ASU_JMARS_TES_DUST_NUMERIC (Bandfield 2002)', crs: 'IAU-2000 Simple Cylindrical', nativeRes: '7.4 km/px (8 ppd numeric VICAR)', shippedRes: '5.2 km/px (0.005/level)', epoch: 'Bandfield 2002 (JGR 107)' },
    { id: 'cave', name: 'Mars Global Cave Candidate Catalog (MGC³)', productCode: 'USGS_PDS_MGC3_V1_1062_CANDIDATES (Cushing 2017)', crs: 'IAU-2000 Planetocentric Lat/Lon', nativeRes: 'Point catalog (CTX 6 m / HiRISE 0.25 m)', shippedRes: '1062 point vectors + distance raster', epoch: 'Cushing 2017 (USGS Astrogeology)' },
    { id: 'basemap', name: 'Viking Orbiter Global Color Mosaic', productCode: 'USGS_MDIM_2.1_GLOBAL_COLOR_SHADED', crs: 'IAU-2000 Simple Cylindrical', nativeRes: '231 m/px global mosaic', shippedRes: '5.2 km/px (4096×2048 RGB)', epoch: 'USGS Astrogeology MDIM 2.1' },
    { id: 'eva_dtm', name: 'Phase 2 Tactical Surface DTM / Micro-DEM', productCode: 'UA_HIRISE_PDS_DTM (DTEEC_045994_1985 / DTEEC_023957_1745) + MOLA/TES Prior', crs: 'Local Metric Tangent Plane (1 km × 1 km)', nativeRes: '1.0–2.0 m/post (where stereo exists)', shippedRes: '10 m/cell (100×100) + 1 m HUD', epoch: 'PDS4 Mars 2020 / MSL Archive (2024–2026)' }
  ];

  global.SCORING = { F, CRITERIA, PRESETS, HARD, normalize, scoreCell, scoreMap, topCandidates, ramp, atmoColumnGcm2, radDose, radDoseMsvYr, radDoseBand, effectiveSlopeLimit, calcBekkerTerramechanics, calcIceAccess, calcSPE, speDose, calcTerrainClass, calcPandolfMars, sensitivity, sensitivityCI, wilson95CI, sampleBilinear, mulberry32, LAYER_PROVENANCE };
})(typeof window !== 'undefined' ? window : module.exports);
