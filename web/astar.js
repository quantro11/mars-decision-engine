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
      const cy = y0 + ly, cx = (xMin + ox) % W;
      const curElev = L.elev ? (L.meta.elev.offset + L.elev[cy * W + cx] * L.meta.elev.scale) : 0;
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
        // Anisotropic directional grade (uphill traction vs downhill braking vs lateral cross-slope roll)
        const nextElev = L.elev ? (L.meta.elev.offset + L.elev[m] * L.meta.elev.scale) : 0;
        const dhM = nextElev - curElev;
        const longGradeDeg = dist > 0.01 ? (Math.atan2(dhM, dist * 1000) * 180) / Math.PI : 0;
        const upPen = longGradeDeg > 0 ? 0.55 * longGradeDeg : 0;
        const dnPen = longGradeDeg < -5 ? 0.22 * (-longGradeDeg - 5) : 0;
        const crossSlopeDeg = Math.sqrt(Math.max(0, s * s - longGradeDeg * longGradeDeg));
        const crossPen = 0.20 * crossSlopeDeg;
        const c = gScore[loc] + dist * (1 + k * (s + upPen + dnPen + crossPen + rPen + dPen));
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

  function smoothCellElev(L, x, y) {
    const W = L.width, H = L.height, off = L.meta.elev.offset, sc = L.meta.elev.scale;
    const kx = [1, 2, 1];
    let acc = 0, wsum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = Math.max(0, Math.min(H - 1, y + dy));
      const wy = kx[dy + 1];
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ((x + dx) % W + W) % W;
        const w = wy * kx[dx + 1];
        acc += (off + L.elev[ny * W + nx] * sc) * w;
        wsum += w;
      }
    }
    return acc / wsum;
  }

  function pathStats(L, path, kmCol, kmRow) {
    const W = L.width, sc = L.meta.slope.scale;
    const rScale = L.meta.rough ? L.meta.rough.scale : 0;
    const tiScale = L.meta.ti ? L.meta.ti.scale : 0;
    const iceScale = (L.meta.ice && L.meta.ice.scale) || 0.01;
    const iceOff = (L.meta.ice && L.meta.ice.offset) || -1.28;
    let km = 0, maxS = 0, sumS = 0, hazardKm = 0, dustKm = 0, sumR = 0;
    let totalAscentM = 0, totalDescentM = 0, maxUphillDeg = 0, sumCrossS = 0;
    let radWeightedKm = 0;
    const profile = [];
    for (let i = 0; i < path.length; i++) {
      const n = path[i], y = (n / W) | 0, x = n - y * W;
      const s = L.slope[n] * sc; maxS = Math.max(maxS, s); sumS += s;
      const r = L.rough ? L.rough[n] * rScale : 0; sumR += r;
      const ti = (L.ti && L.ti[n] > 0) ? L.ti[n] * tiScale : 215;
      const iceRaw = L.ice ? L.ice[n] : (L.ice15 ? L.ice15[n] : 0);
      const ice = iceRaw > 0 ? (iceOff + iceRaw * iceScale) : null;
      const elev = smoothCellElev(L, x, y);
      // MSL-RAD calibrated GCR dose rate (mSv/yr) with local topographic sky-view shielding (unified with SCORING.radDose)
      const atmo = 16.4 * Math.exp(-elev / 11100);
      const sDeg = Math.min(45, Math.max(0, s || 0));
      const skyView = 1 - 0.5 * (1 - Math.cos(sDeg * Math.PI / 180));
      const geomFactor = Math.max(0.75, skyView - sDeg * 0.002);
      const radMsvYr = 0.64 * Math.exp(-(atmo - 24.6) / 60) * 365.25 * geomFactor;
      if (i) { const p = path[i - 1], py = (p / W) | 0, px = p - py * W;
        let dx = Math.abs(x - px); if (dx > W / 2) dx = W - dx;
        const d = Math.hypot(dx * kmCol[y], (y - py) * kmRow); km += d;
        if (s > 10) hazardKm += d;
        if (ti !== null && ti < 100) dustKm += d;
        radWeightedKm += d * radMsvYr;
        const dh = elev - profile[i - 1].elev;
        if (dh > 0) totalAscentM += dh;
        else totalDescentM += -dh;
        const longG = d > 0.01 ? (Math.atan2(dh, d * 1000) * 180) / Math.PI : 0;
        if (longG > maxUphillDeg) maxUphillDeg = longG;
        sumCrossS += Math.sqrt(Math.max(0, s * s - longG * longG));
      }
      profile.push({ km, x, y, elev, slope: s, rough: r, ti, ice, radMsvYr });
    }

    const H = L.height || (L.elev ? (L.elev.length / W) | 0 : 2048);
    // Candidate rest stops along traverse: flat (<= 4 deg), smooth (sigma <= 35 m), firm (TI >= 160), >= 200 km apart (pressurized rover parking only; no shelter implied)
    const safeHavens = [];
    let lastHavenKm = 0;                       // first stop at least 200 km from the start
    for (let i = 0; i < profile.length; i++) {
      const q = profile[i];
      if (q.km - lastHavenKm >= 200 && q.slope <= 4.0 && q.rough <= 35 && (q.ti === null || q.ti >= 160)) {
        safeHavens.push({
          km: Math.round(q.km),
          elev: Math.round(q.elev),
          slope: q.slope.toFixed(1),
          name: `Rover Stop #${safeHavens.length + 1}`,
          vehicleScope: 'pressurized_rover_only',
          intervalRule: '≥ 200 km Pressurized Rover Parking / Recharge Haven',
          type: 'Flat, smooth, firm terrain for pressurized rover parking (no shelter implied)',
        });
        lastHavenKm = q.km;
      }
    }

    // Science stops along the route, picked only from the layers we actually have (no invented targets):
    // 1. highest SWIM 2.0 ice-consistency cell, 2. highest TES thermal inertia (rock / duricrust proxy),
    // 3. lowest TES thermal inertia (fine dust / sand). Each is searched in its own third of the route.
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
    const pIce = pickIdx(0.10, 0.36, (q) => (q.ice !== null ? q.ice : -9) - q.slope * 0.01);
    const pRock = pickIdx(0.37, 0.66, (q) => (q.ti !== null ? q.ti : -9e3) - q.slope * 2);
    const pFine = pickIdx(0.67, 0.92, (q) => (q.ti !== null ? -q.ti : -9e3) - q.slope * 2);
    const coordOf = (p) => ({
      lat: +(L.latOfRow ? L.latOfRow(p.y) : (90 - (p.y + 0.5) * 180 / H)).toFixed(2),
      lon: +(L.lonOfCol ? L.lonOfCol(p.x) : (-180 + (p.x + 0.5) * 360 / W)).toFixed(2),
    });
    const mkStop = (id, code, p, name, nameTr, dataset, target, targetTr) => {
      const c = coordOf(p);
      return {
        id, code, name, nameTr, dataset, target, targetTr,
        lat: c.lat, lon: c.lon, x: p.x, y: p.y, km: +p.km.toFixed(1), elev: Math.round(p.elev),
        slope: +p.slope.toFixed(1), ti: p.ti !== null ? Math.round(p.ti) : null,
        ice: p.ice !== null ? +p.ice.toFixed(2) : null,
      };
    };
    const scienceWaypoints = [
      mkStop('POI-1', 'ICE', pIce, 'Highest ice-consistency point on the route', 'Rotadaki en yüksek buz tutarlılığı noktası',
        'PSI SWIM 2.0 (Morgan et al. 2021)',
        pIce.ice !== null ? 'Candidate for ground-penetrating radar / drilling; SWIM is a consistency index, not proof of ice' : 'Outside SWIM coverage (±60°): no ice information here',
        pIce.ice !== null ? 'Radar / sondaj adayı; SWIM bir tutarlılık indeksidir, buzun kanıtı değildir' : 'SWIM kapsamı dışında (±60°): burada buz bilgisi yok'),
      mkStop('POI-2', 'ROCK', pRock, 'Highest thermal-inertia point (rock / crust proxy)', 'En yüksek termal atalet noktası (kaya / kabuk göstergesi)',
        'MGS TES thermal inertia (Putzig & Mellon 2007)',
        'Coarse or cemented surface: likely firm ground and a rock-sampling target', 'İri taneli veya çimentolu yüzey: muhtemelen sağlam zemin ve kaya örneği hedefi'),
      mkStop('POI-3', 'FINE', pFine, 'Lowest thermal-inertia point (fine dust / sand)', 'En düşük termal atalet noktası (ince toz / kum)',
        'MGS TES thermal inertia (Putzig & Mellon 2007)',
        'Fine-grained deposit: soil sample target, but a possible soft-ground hazard for wheels', 'İnce taneli birikinti: toprak örneği hedefi, ama tekerlekler için yumuşak zemin riski'),
    ];
    const meanS = sumS / path.length;

    // Spacesuit (Mars-adapted xEMU reference) Bioenergetics & Strict Separation of Rover (20 km/sol) vs. Foot EVA (2.4 km/h)
    const meanR = sumR / path.length;
    const dustFrac = dustKm / Math.max(1, km);
    const hazFrac = hazardKm / Math.max(1, km);
    const effWalkSpeedKmh = Math.max(1.15, 2.45 - 0.045 * meanS - 0.03 * Math.max(0, maxS - 10) - 0.45 * dustFrac - 0.0015 * meanR);
    const sortieKm = km < 14.4
      ? Math.max(4.8, km)
      : Math.min(16.8, 12.0 + hazFrac * 3.8 + dustFrac * 2.4 + Math.max(0, maxS - 12) * 0.14);
    const walkHours = +(sortieKm / effWalkSpeedKmh + 1.2).toFixed(1); // +1.2h for 3 Science POI sampling stops
    const maxEvaLimitH = 8.0;
    const totalEvaHoursAll = +(km / effWalkSpeedKmh + 1.2).toFixed(1);
    const evaSorties = Math.max(1, Math.ceil(totalEvaHoursAll / 6.5));
    const requiresRover = km > 10.0;
    const evaRestCount = Math.max(1, Math.floor(sortieKm / 1.5)); // 1.5 km astronaut hydration/thermal rest interval
    const MARS_G = 3.71, bodyKg = 80, suitKg = 82, effLoadKg = 15 * 0.90;
    const vMps = 2.4 / 3.6;
    const effMassMars = (bodyKg + suitKg + effLoadKg) * (MARS_G / 9.81);
    const effSlopeDeg = meanS * 0.65 + Math.max(0, maxS - meanS) * 0.35;
    const effGradePct = Math.tan((effSlopeDeg * 0.55) * Math.PI / 180) * 100 + hazFrac * 18;
    const terrainEta = 1.32 + dustFrac * 0.85 + hazFrac * 0.35;
    const loadWorkW = effLoadKg * 2.8 + 2.5 * effMassMars * Math.pow(effLoadKg / bodyKg, 2);
    const pandolfW = 1.5 * bodyKg * (MARS_G / 9.81) + loadWorkW + terrainEta * effMassMars * (1.5 * vMps * vMps + 0.35 * vMps * effGradePct) + 170; // suit overhead, same calibration as SCORING.calcPandolfMars
    const metabolicW = Math.round(Math.max(190, Math.min(680, pandolfW)));
    const metabolicKcalH = Math.round(metabolicW * 0.8598);
    const sortieKcal = Math.round(metabolicKcalH * walkHours);
    const o2UsedG = Math.round(0.255 * metabolicW * walkHours);
    const o2UsedPct = Math.min(99, Math.round((o2UsedG / 850) * 100));
    const o2RemainPct = Math.max(1, 100 - o2UsedPct);
    const co2ProducedG = Math.round(o2UsedG * 1.17);
    const co2ScrubberUsedPct = Math.min(99, Math.round((co2ProducedG / 920) * 100));
    const co2ScrubberRemainPct = Math.max(1, 100 - co2ScrubberUsedPct);
    const waterUsedL = +((Math.max(0.08, 0.72 * metabolicW / 675)) * walkHours).toFixed(2);
    const waterUsedPct = Math.min(99, Math.round((waterUsedL / 4.2) * 100));
    const waterRemainPct = Math.max(1, 100 - waterUsedPct);
    const meanRadMsvYr = km > 0 ? (radWeightedKm / km) : (profile[0] ? profile[0].radMsvYr : 235);
    const radDoseMsv = +((meanRadMsvYr / (365.25 * 24)) * walkHours).toFixed(3);
    const corridorRadDoseMsv = +((meanRadMsvYr / (365.25 * 24)) * totalEvaHoursAll).toFixed(2);
    const returnReserveProtected = Math.min(o2RemainPct, co2ScrubberRemainPct, waterRemainPct) >= 25;

    const evaStats = {
      sortieKm: +sortieKm.toFixed(1),
      walkHours,
      effWalkSpeedKmh: +effWalkSpeedKmh.toFixed(2),
      maxEvaLimitH,
      withinEvaLimit: walkHours <= maxEvaLimitH && !requiresRover,
      WithinSortieWindow: walkHours <= maxEvaLimitH,
      requiresRover,
      evaRestIntervalKm: 1.5,
      evaRestCount,
      evaSorties,
      totalEvaHoursAll,
      metabolicW,
      metabolicKcalH,
      sortieKcal,
      o2UsedG,
      o2UsedPct,
      o2RemainPct,
      co2ProducedG,
      co2ScrubberUsedPct,
      co2ScrubberRemainPct,
      waterUsedL,
      waterUsedPct,
      waterRemainPct,
      returnReserveProtected,
      meanRadMsvYr: Math.round(meanRadMsvYr),
      radUncMsvYr: Math.round(meanRadMsvYr * 0.1875),
      radDoseMsv,
      corridorRadDoseMsv,
    };

    const hazardZones = {
      steepKm: +hazardKm.toFixed(1),
      dustTrapKm: +dustKm.toFixed(1),
      roughMeanM: Math.round(meanR),
      summary: `${hazardKm.toFixed(0)} km >10° slope · ${dustKm.toFixed(0)} km low-TI (<100 tiu) dust · σ=${Math.round(meanR)} m`
    };
    const returnRoute = {
      returnKm: +km.toFixed(1),
      returnAscentM: Math.round(totalDescentM),
      returnDescentM: Math.round(totalAscentM),
      roundTripKm: +(km * 2).toFixed(1),
    };

    return {
      km, maxSlope: maxS, meanSlope: meanS, hazardKm, dustKm,
      totalAscentM: Math.round(totalAscentM), totalDescentM: Math.round(totalDescentM),
      maxUphillDeg: +maxUphillDeg.toFixed(1),
      meanCrossSlope: +(sumCrossS / Math.max(1, path.length - 1)).toFixed(1),
      meanRough: meanR, profile, safeHavens,
      hazardZones, returnRoute,
      scienceWaypoints, evaStats,
    };
  }

  // Direct spherical great-circle geodesic (slerp on unit sphere, with antimeridian wrap) for comparison.
  function straight(L, sx, sy, gx, gy) {
    const W = L.width, H = L.height;
    let dx = gx - sx; if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W;
    const dy = gy - sy;
    const lat1 = L.latOfRow(sy) * Math.PI / 180, lon1 = L.lonOfCol(sx) * Math.PI / 180;
    const lat2 = L.latOfRow(gy) * Math.PI / 180, lon2 = L.lonOfCol(gx) * Math.PI / 180;
    const u1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
    const u2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];
    const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]));
    const omega = Math.acos(dot), sinO = Math.sin(omega);
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const path = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x, y;
      if (sinO > 1e-5 && (sy !== gy || Math.abs(lat1) > 0.14)) {
        const a = Math.sin((1 - t) * omega) / sinO, b = Math.sin(t * omega) / sinO;
        const ux = a * u1[0] + b * u2[0], uy = a * u1[1] + b * u2[1], uz = a * u1[2] + b * u2[2];
        const latD = Math.asin(Math.max(-1, Math.min(1, uz))) * 180 / Math.PI;
        const lonD = Math.atan2(uy, ux) * 180 / Math.PI;
        x = ((Math.floor((lonD + 180) / 360 * W) % W) + W) % W;
        y = Math.max(0, Math.min(H - 1, Math.floor((90 - latD) / 180 * H)));
      } else {
        x = ((Math.round(sx + dx * t) % W) + W) % W;
        y = Math.round(sy + dy * t);
      }
      const cell = y * W + x;
      if (!path.length || path[path.length - 1] !== cell) path.push(cell);
    }
    const MR = MARS_R, kmRow = Math.PI * MR / H, kmCol = new Float32Array(H);
    for (let y = 0; y < H; y++) kmCol[y] = (2 * Math.PI * MR / W) * Math.cos(L.latOfRow(y) * Math.PI / 180);
    return { ok: true, path, stats: pathStats(L, path, kmCol, kmRow) };
  }

  const EARTH_R = 6371.0;

  function haversineEarthKm(lat1, lon1, lat2, lon2) {
    const d = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * d / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(a));
  }

  function planEarth(startLat, startLon, goalLat, goalLon, opts = {}) {
    const er = global.EARTH_ROADS || (typeof globalThis !== 'undefined' ? globalThis.EARTH_ROADS : null);
    if (er && er.planRoute) return er.planRoute(startLat, startLon, goalLat, goalLon, opts);
    const hazards = opts.hazards || [];
    const directKm = haversineEarthKm(startLat, startLon, goalLat, goalLon);
    if (directKm < 0.02) {
      return {
        ok: true,
        safePath: [{ lat: startLat, lon: startLon }, { lat: goalLat, lon: goalLon }],
        straightPath: [{ lat: startLat, lon: startLon }, { lat: goalLat, lon: goalLon }],
        stats: { distKm: directKm, straightKm: directKm, detourPct: 0, transitTimeMin: 1, ugvTimeMin: 1, pandolfW: 280, kcalH: 240, waterL: 0.5, waypoints: [] }
      };
    }

    const N_GRID = 64;
    const latSpan = Math.abs(goalLat - startLat);
    const lonSpan = Math.abs(goalLon - startLon);
    const padLat = Math.max(0.05, latSpan * 0.5);
    const padLon = Math.max(0.06, lonSpan * 0.5);
    const minLat = Math.min(startLat, goalLat) - padLat;
    const maxLat = Math.max(startLat, goalLat) + padLat;
    const minLon = Math.min(startLon, goalLon) - padLon;
    const maxLon = Math.max(startLon, goalLon) + padLon;

    const latOfI = (i) => minLat + (i / (N_GRID - 1)) * (maxLat - minLat);
    const lonOfJ = (j) => minLon + (j / (N_GRID - 1)) * (maxLon - minLon);
    const iOfLat = (lat) => Math.max(0, Math.min(N_GRID - 1, Math.round(((lat - minLat) / (maxLat - minLat)) * (N_GRID - 1))));
    const jOfLon = (lon) => Math.max(0, Math.min(N_GRID - 1, Math.round(((lon - minLon) / (maxLon - minLon)) * (N_GRID - 1))));

    const startLoc = iOfLat(startLat) * N_GRID + jOfLon(startLon);
    const goalLoc = iOfLat(goalLat) * N_GRID + jOfLon(goalLon);

    const gScore = new Float32Array(N_GRID * N_GRID).fill(Infinity);
    const came = new Int32Array(N_GRID * N_GRID).fill(-1);
    const closed = new Uint8Array(N_GRID * N_GRID);

    const heap = new Heap();
    gScore[startLoc] = 0;
    heap.push(startLoc, directKm);

    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (heap.size) {
      const { n: loc } = heap.pop();
      if (closed[loc]) continue;
      closed[loc] = 1;
      if (loc === goalLoc) break;

      const ci = (loc / N_GRID) | 0, cj = loc % N_GRID;
      const cLat = latOfI(ci), cLon = lonOfJ(cj);

      for (const [di, dj] of DIRS) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || ni >= N_GRID || nj < 0 || nj >= N_GRID) continue;
        const nLoc = ni * N_GRID + nj;
        if (closed[nLoc]) continue;

        const nLat = latOfI(ni), nLon = lonOfJ(nj);
        const stepDist = haversineEarthKm(cLat, cLon, nLat, nLon);

        let hazardPenalty = 0;
        for (const h of hazards) {
          const dH = haversineEarthKm(nLat, nLon, h.lat, h.lon);
          if (dH < h.rKm) {
            hazardPenalty += 85.0 * Math.pow(1.0 - dH / h.rKm, 2);
          }
        }

        const cost = gScore[loc] + stepDist * (1.0 + hazardPenalty);
        if (cost < gScore[nLoc]) {
          gScore[nLoc] = cost;
          came[nLoc] = loc;
          heap.push(nLoc, cost + haversineEarthKm(nLat, nLon, goalLat, goalLon));
        }
      }
    }

    const safePath = [];
    let cur = goalLoc;
    while (cur >= 0) {
      const ci = (cur / N_GRID) | 0, cj = cur % N_GRID;
      safePath.push({ lat: latOfI(ci), lon: lonOfJ(cj) });
      if (cur === startLoc) break;
      cur = came[cur];
    }
    safePath.reverse();
    if (!safePath.length || cur !== startLoc) {
      safePath.length = 0;
      safePath.push({ lat: startLat, lon: startLon }, { lat: goalLat, lon: goalLon });
    }

    const straightPath = [];
    const N_STR = 24;
    for (let s = 0; s <= N_STR; s++) {
      const t = s / N_STR;
      straightPath.push({
        lat: startLat + (goalLat - startLat) * t,
        lon: startLon + (goalLon - startLon) * t
      });
    }

    let distKm = 0;
    for (let p = 0; p < safePath.length - 1; p++) {
      distKm += haversineEarthKm(safePath[p].lat, safePath[p].lon, safePath[p + 1].lat, safePath[p + 1].lon);
    }
    distKm = +(Math.max(directKm, distKm)).toFixed(2);
    const straightKm = +directKm.toFixed(2);
    const detourPct = Math.round(Math.max(0, (distKm / Math.max(0.1, straightKm) - 1) * 100));

    const packKg = opts.packKg || 22;
    const vMps = 4.0 / 3.6;
    const W_body = 80;
    const pandolfW = Math.round(1.5 * W_body + 2.0 * (W_body + packKg) * Math.pow(packKg / W_body, 2) + 1.2 * (W_body + packKg) * (1.5 * vMps * vMps + 0.35 * vMps * 2.0));
    const kcalH = Math.round(pandolfW * 0.8604);
    const walkHours = distKm / 4.0;
    const ugvHours = distKm / 18.0;
    const transitTimeMin = Math.round(walkHours * 60);
    const ugvTimeMin = Math.round(ugvHours * 60);
    const waterL = +(walkHours * 0.85).toFixed(2);

    const waypoints = [];
    const stepSample = Math.max(1, Math.floor(safePath.length / 5));
    for (let w = 0; w < safePath.length; w += stepSample) {
      waypoints.push({ ...safePath[w], name: `WP-${waypoints.length + 1}` });
    }
    if (waypoints[waypoints.length - 1].lat !== goalLat) {
      waypoints.push({ lat: goalLat, lon: goalLon, name: `WP-${waypoints.length + 1} (Hedef)` });
    }

    return {
      ok: true,
      safePath,
      straightPath,
      stats: {
        distKm,
        straightKm,
        detourPct,
        transitTimeMin,
        ugvTimeMin,
        pandolfW,
        kcalH,
        waterL,
        waypoints
      }
    };
  }

  global.ASTAR = { plan, straight, haversineKm, smoothCellElev, planEarth, haversineEarthKm };
})(typeof window !== 'undefined' ? window : module.exports);
