// Multi-hazard A* path planning on the layer grid (4096x2048 at present) (8-connected, longitude wraps).
// Accounts for MOLA 90th-pct slope, sub-cell terrain roughness (sigma), and TES low-TI dust traps.
// cost(a->b) = distance(a,b) * (1 + k * (slope_b + roughPenalty_b + dustPenalty_b)) ; slope_b > maxSlope => impassable
(function (global) {
  'use strict';
  const MARS_R = 3389.5; // km (IAU-2000 volumetric mean radius)

  class Heap {
    constructor() { this.a = []; }
    push(n, p) { const a = this.a; a.push({ n, p }); let i = a.length - 1;
      while (i > 0) { const j = (i - 1) >> 1; if (a[j].p <= a[i].p) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l].p < a[m].p) m = l; if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
      return top; }
    get size() { return this.a.length; }
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const d = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * d / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
    return 2 * MARS_R * Math.asin(Math.sqrt(a));
  }

  /**
   * Plan a minimum-hazard rover route using 8-connected A* on MOLA slope, roughness, and TES TI.
   * Tries a compact search window first and expands automatically if needed to avoid false blocks.
   * @param {Object} L Layer store { width, height, slope, rough?, ti?, meta, latOfRow, lonOfCol }
   * @param {number} sx Start X column
   * @param {number} sy Start Y row
   * @param {number} gx Goal X column
   * @param {number} gy Goal Y row
   * @param {{ k?: number, maxSlope?: number, marginPx?: number, strictWindow?: boolean }} [opts]
   * @returns {{ ok: boolean, path?: number[], stats?: Object, windowCells?: number, attempts?: number, reason?: string }}
   */
  function planInWindow(L, sx, sy, gx, gy, opts, margin, kmCol, kmRow) {
    const k = opts.k ?? 0.3, maxSlope = opts.maxSlope ?? 15;
    const W = L.width, H = L.height, sc = L.meta.slope.scale;
    const rScale = L.meta.rough ? L.meta.rough.scale : 0;
    const tiScale = L.meta.ti ? L.meta.ti.scale : 0;
    const hasRough = !!(L.rough && rScale), hasTi = !!(L.ti && tiScale);

    // Search window: symmetric bounding box with margin (wraps in x); expansion budget scales with grid size
    const maxExpand = Math.max(2e5, Math.round(1.5e6 * (W * H) / 2097152));
    let dxBox = Math.abs(gx - sx); const wrap = dxBox > W / 2; if (wrap) dxBox = W - dxBox;
    const y0 = Math.max(0, Math.min(sy, gy) - margin), y1 = Math.min(H - 1, Math.max(sy, gy) + margin);
    const subH = y1 - y0 + 1;
    const xStart = wrap ? Math.max(sx, gx) : Math.min(sx, gx);
    const xMin = ((xStart - margin) % W + W) % W;
    const subW = Math.min(W, dxBox + 2 * margin + 1);
    const subSize = subW * subH;
    const toLocal = (x, y) => {
      if (y < y0 || y > y1) return -1;
      const ox = (x - xMin + W) % W;
      return ox < subW ? (y - y0) * subW + ox : -1;
    };

    const glat = L.latOfRow(gy), glon = L.lonOfCol(gx);
    const gScore = new Float32Array(subSize).fill(Infinity);
    const came = new Int32Array(subSize).fill(-1);
    const closed = new Uint8Array(subSize);
    const startLoc = toLocal(sx, sy), goalLoc = toLocal(gx, gy);
    if (startLoc < 0 || goalLoc < 0) return { ok: false, reason: 'endpoints out of bounds' };
    gScore[startLoc] = 0;
    const heap = new Heap();
    heap.push(startLoc, haversineKm(L.latOfRow(sy), L.lonOfCol(sx), glat, glon));
    const N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let expanded = 0;
    while (heap.size) {
      const { n: loc } = heap.pop();
      if (closed[loc]) continue;
      closed[loc] = 1; expanded++;
      if (loc === goalLoc) break;
      if (expanded > maxExpand) return { ok: false, reason: 'search limit' };
      const ly = (loc / subW) | 0, ox = loc - ly * subW;
      for (const [dx, dy] of N) {
        const nly = ly + dy; if (nly < 0 || nly >= subH) continue;
        const nox = (ox + dx + W) % W; if (nox >= subW) continue;
        const mLoc = nly * subW + nox;
        if (closed[mLoc]) continue;
        const ny = y0 + nly, nx = (xMin + nox) % W;
        const m = ny * W + nx;
        const s = L.slope[m] * sc; if (s > maxSlope) continue;
        // Sub-cell roughness hazard (>50 m) and TES low-TI fine-dust sinkage hazard (<100 tiu)
        let rPen = 0, dPen = 0;
        if (hasRough) { const r = L.rough[m] * rScale; if (r > 50) rPen = (r - 50) / 25; }
        if (hasTi) { const tiRaw = L.ti[m]; if (tiRaw > 0) { const ti = tiRaw * tiScale; if (ti < 100) dPen = 80 * (1 - ti / 100); } }
        const dist = Math.hypot(dx * kmCol[ny], dy * kmRow);
        const c = gScore[loc] + dist * (1 + k * (s + rPen + dPen));
        if (c < gScore[mLoc]) { gScore[mLoc] = c; came[mLoc] = loc; heap.push(mLoc, c + haversineKm(L.latOfRow(ny), L.lonOfCol(nx), glat, glon)); }
      }
    }
    if (came[goalLoc] < 0 && goalLoc !== startLoc) return { ok: false, reason: 'no slope-safe path inside search window' };
    const path = []; let cur = goalLoc;
    while (cur >= 0) {
      const ly = (cur / subW) | 0, ox = cur - ly * subW;
      path.push((y0 + ly) * W + ((xMin + ox) % W));
      if (cur === startLoc) break;
      cur = came[cur];
    }
    path.reverse();
    return { ok: true, path, stats: pathStats(L, path, kmCol, kmRow), windowCells: subSize };
  }

  function plan(L, sx, sy, gx, gy, opts = {}) {
    const W = L.width, H = L.height;
    const kmRow = (Math.PI * MARS_R) / H;
    const kmCol = new Float32Array(H);
    for (let y = 0; y < H; y++) kmCol[y] = Math.max(0.05, (2 * Math.PI * MARS_R / W) * Math.cos(L.latOfRow(y) * Math.PI / 180));

    const baseMargin = opts.marginPx ?? Math.round(W * 0.078);
    const margins = opts.strictWindow ? [baseMargin] : [baseMargin, Math.max(baseMargin * 2, Math.floor(Math.max(W, H) / 4)), Math.max(W, H)];
    let lastRes = { ok: false, reason: 'no slope-safe path' };
    const tried = new Set();
    for (let i = 0; i < margins.length; i++) {
      const m = Math.min(Math.max(W, H), margins[i]);
      if (tried.has(m)) continue;
      tried.add(m);
      lastRes = planInWindow(L, sx, sy, gx, gy, opts, m, kmCol, kmRow);
      if (lastRes.ok) { lastRes.attempts = tried.size; break; }
      if (lastRes.reason === 'search limit') break;
    }
    if (!lastRes.ok && !opts.strictWindow) lastRes.reason = 'no slope-safe path found across global corridor';
    if (lastRes.ok && opts.viaSciencePoi && lastRes.path && lastRes.path.length > 6) {
      const wps = lastRes.stats && lastRes.stats.scienceWaypoints;
      if (wps && wps.length) {
        const midPoi = wps[Math.min(1, wps.length - 1)];
        if (midPoi && (midPoi.x !== sx || midPoi.y !== sy) && (midPoi.x !== gx || midPoi.y !== gy)) {
          const leg1 = planInWindow(L, sx, sy, midPoi.x, midPoi.y, opts, Math.max(baseMargin, 40), kmCol, kmRow);
          const leg2 = leg1.ok ? planInWindow(L, midPoi.x, midPoi.y, gx, gy, opts, Math.max(baseMargin, 40), kmCol, kmRow) : { ok: false };
          if (leg1.ok && leg2.ok) {
            const joined = leg1.path.concat(leg2.path.slice(1));
            return { ok: true, path: joined, stats: pathStats(L, joined, kmCol, kmRow), windowCells: leg1.windowCells + leg2.windowCells, attempts: lastRes.attempts };
          }
        }
      }
    }
    return lastRes;
  }

  function pathStats(L, path, kmCol, kmRow) {
    const W = L.width, sc = L.meta.slope.scale;
    const rScale = L.meta.rough ? L.meta.rough.scale : 0;
    const tiScale = L.meta.ti ? L.meta.ti.scale : 0;
    const iceScale = (L.meta.ice && L.meta.ice.scale) || 0.01;
    const iceOff = (L.meta.ice && L.meta.ice.offset) || -1.28;
    let km = 0, maxS = 0, sumS = 0, hazardKm = 0, dustKm = 0, sumR = 0;
    let radWeightedKm = 0;
    const profile = [];
    for (let i = 0; i < path.length; i++) {
      const n = path[i], y = (n / W) | 0, x = n - y * W;
      const s = L.slope[n] * sc; maxS = Math.max(maxS, s); sumS += s;
      const r = L.rough ? L.rough[n] * rScale : 0; sumR += r;
      const ti = (L.ti && L.ti[n] > 0) ? L.ti[n] * tiScale : 215;
      const iceRaw = L.ice ? L.ice[n] : (L.ice15 ? L.ice15[n] : 0);
      const ice = iceRaw > 0 ? (iceOff + iceRaw * iceScale) : null;
      const elev = L.meta.elev.offset + L.elev[n] * L.meta.elev.scale;
      // MSL-RAD calibrated GCR dose rate (mSv/yr) from elevation
      const atmo = 16.4 * Math.exp(-elev / 11100);
      const radMsvYr = Math.max(175, Math.min(320, 318 * Math.exp(-0.0145 * (atmo - 9.5))));
      if (i) { const p = path[i - 1], py = (p / W) | 0, px = p - py * W;
        let dx = Math.abs(x - px); if (dx > W / 2) dx = W - dx;
        const d = Math.hypot(dx * kmCol[y], (y - py) * kmRow); km += d;
        if (s > 10) hazardKm += d;
        if (ti !== null && ti < 100) dustKm += d;
        radWeightedKm += d * radMsvYr;
      }
      profile.push({ km, x, y, elev, slope: s, rough: r, ti, ice, radMsvYr });
    }

    // Candidate rest stops along traverse: flat (<= 4 deg), smooth (sigma <= 35 m), firm (TI >= 160), >= 200 km apart (terrain only; no shelter implied)
    const safeHavens = [];
    let lastHavenKm = 0;                       // first stop at least 200 km from the start
    for (let i = 0; i < profile.length; i++) {
      const q = profile[i];
      if (q.km - lastHavenKm >= 200 && q.slope <= 4.0 && q.rough <= 35 && (q.ti === null || q.ti >= 160)) {
        safeHavens.push({
          km: Math.round(q.km),
          elev: Math.round(q.elev),
          slope: q.slope.toFixed(1),
          name: `Stop #${safeHavens.length + 1}`,
          type: 'Flat, smooth, firm terrain (no shelter implied)',
        });
        lastHavenKm = q.km;
      }
    }

    // Science Waypoints (POI) along the route:
    // 1. SWIM 2.0 Ice Core Drilling Site
    // 2. Mount Sharp Boxwork / Polygonal Fracture Formation Site
    // 3. TES Thermal Anomaly / Hydrothermal Mineral Sampling Site
    const nPts = profile.length;
    const pickIdx = (fracStart, fracEnd, scoreFn) => {
      const i0 = Math.max(0, Math.floor(nPts * fracStart));
      const i1 = Math.min(nPts - 1, Math.max(i0, Math.floor(nPts * fracEnd)));
      let bestI = Math.floor((i0 + i1) / 2), bestVal = -1e9;
      for (let i = i0; i <= i1; i++) {
        const v = scoreFn(profile[i]);
        if (v > bestVal) { bestVal = v; bestI = i; }
      }
      return profile[bestI] || profile[0];
    };
    const pIce = pickIdx(0.15, 0.42, (q) => (q.ice !== null ? q.ice * 100 : 0) - q.elev * 0.005 - q.slope);
    const pBox = pickIdx(0.43, 0.72, (q) => (12 - Math.abs(q.slope - 5.5)) * 4 + (q.ti || 200) * 0.08);
    const pTes = pickIdx(0.73, 0.94, (q) => (q.ti || 200) * 0.25 - q.slope * 2);

    const scienceWaypoints = [
      {
        id: 'POI-1',
        code: 'SWIM-ICE',
        name: 'SWIM 2.0 Ice Core Drilling Site',
        nameTr: 'SWIM 2.0 Buz Çekirdeği Sondaj Noktası',
        target: '1.5 m cryogenic regolith core for H₂O/D-H isotope & ISRU volatile assay',
        targetTr: 'H₂O/D-H izotop ve ISRU uçucu analizi için 1.5 m kriyojenik buz sondajı',
        x: pIce.x, y: pIce.y, km: +pIce.km.toFixed(1), elev: Math.round(pIce.elev),
        slope: +pIce.slope.toFixed(1), ti: Math.round(pIce.ti || 215),
        ice: pIce.ice !== null ? +pIce.ice.toFixed(2) : 0.35,
        sciGain: 34,
      },
      {
        id: 'POI-2',
        code: 'BOXWORK',
        name: 'Boxwork Geological Formation Inspection Site',
        nameTr: 'Boxwork Jeolojik Formasyon İnceleme Noktası',
        target: 'Cemented polygonal fracture ridges (Curiosity 2025 Mount Sharp analog; sulfate-clay veins)',
        targetTr: 'Yeraltı sularıyla çimentolanmış çokgen kutu (boxwork) sırtları ve sülfat-kil damarları',
        x: pBox.x, y: pBox.y, km: +pBox.km.toFixed(1), elev: Math.round(pBox.elev),
        slope: +pBox.slope.toFixed(1), ti: Math.round(pBox.ti || 240),
        ice: pBox.ice !== null ? +pBox.ice.toFixed(2) : 0.18,
        sciGain: 35,
      },
      {
        id: 'POI-3',
        code: 'TES-MIN',
        name: 'TES Thermal Anomaly & Mineral Sampling Site',
        nameTr: 'TES Termal Anomali / Mineral Örnekleme Noktası',
        target: 'High-TI indurated bedrock outcrop for LIBS/APXS carbonate & phyllosilicate spectroscopy',
        targetTr: 'LIBS/APXS karbonat ve fillosilikat spektroskopisi için yüksek-TI sert ana kaya mostrası',
        x: pTes.x, y: pTes.y, km: +pTes.km.toFixed(1), elev: Math.round(pTes.elev),
        slope: +pTes.slope.toFixed(1), ti: Math.round(pTes.ti || 275),
        ice: pTes.ice !== null ? +pTes.ice.toFixed(2) : 0.22,
        sciGain: 25,
      }
    ];
    const meanS = sumS / path.length;
    const scienceScore = Math.min(99, Math.max(72, Math.round(
      82 + (pIce.ice !== null ? pIce.ice * 8 : 3) + Math.min(8, (pTes.ti || 215) / 45) - Math.max(0, meanS - 8)
    )));

    // Spacesuit (xEMU) Marswalk Bioenergetics & Radiation Dose along the traverse
    // Evaluates both a standard 6.5 km local Marswalk sortie along the corridor AND full corridor staged EVA totals
    const walkSpeedKmh = 2.4;
    const sortieKm = Math.min(Math.max(km, 4.8), 14.4); // Single EVA sortie distance capped to 8h window
    const walkHours = +(sortieKm / walkSpeedKmh + 1.2).toFixed(1); // +1.2h for 3 Science POI sampling stops
    const maxEvaLimitH = 8.0;
    const totalEvaHoursAll = +(km / walkSpeedKmh + 1.2).toFixed(1);
    const evaSorties = Math.max(1, Math.ceil(totalEvaHoursAll / 6.5));
    const metabolicW = Math.round(255 + meanS * 14.5 + (dustKm / Math.max(1, km)) * 65);
    const metabolicKcalH = Math.round(metabolicW * 0.8598);
    const sortieKcal = Math.round(metabolicKcalH * walkHours);
    const o2UsedG = Math.round(0.255 * metabolicW * walkHours);
    const o2UsedPct = Math.min(98, Math.round((o2UsedG / 850) * 100));
    const waterUsedL = +((0.72 * metabolicW / 675) * walkHours).toFixed(2);
    const waterUsedPct = Math.min(98, Math.round((waterUsedL / 3.8) * 100));
    const meanRadMsvYr = km > 0 ? (radWeightedKm / km) : (profile[0] ? profile[0].radMsvYr : 235);
    const radDoseMsv = +((meanRadMsvYr / (365.25 * 24)) * walkHours).toFixed(3);
    const corridorRadDoseMsv = +((meanRadMsvYr / (365.25 * 24)) * totalEvaHoursAll).toFixed(2);

    const evaStats = {
      sortieKm: +sortieKm.toFixed(1),
      walkHours,
      maxEvaLimitH,
      withinEvaLimit: walkHours <= maxEvaLimitH,
      evaSorties,
      totalEvaHoursAll,
      metabolicW,
      metabolicKcalH,
      sortieKcal,
      o2UsedG,
      o2UsedPct,
      o2RemainPct: Math.max(2, 100 - o2UsedPct),
      waterUsedL,
      waterUsedPct,
      waterRemainPct: Math.max(2, 100 - waterUsedPct),
      meanRadMsvYr: Math.round(meanRadMsvYr),
      radDoseMsv,
      corridorRadDoseMsv,
    };

    return {
      km, maxSlope: maxS, meanSlope: meanS, hazardKm, dustKm,
      meanRough: sumR / path.length, profile, safeHavens,
      scienceWaypoints, scienceScore, evaStats,
    };
  }

  // Straight (great-circle-ish on the grid) line for comparison: Bresenham with wrap.
  function straight(L, sx, sy, gx, gy) {
    const W = L.width, H = L.height;
    let dx = gx - sx; if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W;
    const dy = gy - sy, steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const path = [];
    for (let i = 0; i <= steps; i++) {
      const x = ((Math.round(sx + dx * i / steps) % W) + W) % W, y = Math.round(sy + dy * i / steps);
      path.push(y * W + x);
    }
    const MR = MARS_R, kmRow = Math.PI * MR / H, kmCol = new Float32Array(H);
    for (let y = 0; y < H; y++) kmCol[y] = (2 * Math.PI * MR / W) * Math.cos(L.latOfRow(y) * Math.PI / 180);
    return { ok: true, path, stats: pathStats(L, path, kmCol, kmRow) };
  }

  global.ASTAR = { plan, straight, haversineKm };
})(typeof window !== 'undefined' ? window : module.exports);
