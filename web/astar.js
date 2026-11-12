// Multi-hazard A* path planning on the 2048x1024 grid (8-connected, longitude wraps).
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

  // L: {width,height, slope:Uint8Array, rough?:Uint8Array, ti?:Uint8Array, meta, latOfRow(y), lonOfCol(x)}
  // opts: {k, maxSlope, marginPx}
  function plan(L, sx, sy, gx, gy, opts) {
    const k = opts.k ?? 0.3, maxSlope = opts.maxSlope ?? 15;
    const W = L.width, H = L.height, sc = L.meta.slope.scale;
    const rScale = L.meta.rough ? L.meta.rough.scale : 0;
    const tiScale = L.meta.ti ? L.meta.ti.scale : 0;
    const hasRough = !!(L.rough && rScale), hasTi = !!(L.ti && tiScale);
    const kmRow = (Math.PI * MARS_R) / H;
    const kmCol = new Float32Array(H);
    for (let y = 0; y < H; y++) kmCol[y] = Math.max(0.05, (2 * Math.PI * MARS_R / W) * Math.cos(L.latOfRow(y) * Math.PI / 180));

    // search window: bounding box with margin (wraps in x)
    const margin = opts.marginPx ?? 160;
    let dxBox = Math.abs(gx - sx); const wrap = dxBox > W / 2; if (wrap) dxBox = W - dxBox;
    const y0 = Math.max(0, Math.min(sy, gy) - margin), y1 = Math.min(H - 1, Math.max(sy, gy) + margin);
    const xMin = wrap ? Math.max(sx, gx) : Math.min(sx, gx);
    const xSpan = dxBox + 2 * margin;
    const inBox = (x, y) => { if (y < y0 || y > y1) return false; let d = x - xMin + margin; d = ((d % W) + W) % W; return d < xSpan + margin; };

    const glat = L.latOfRow(gy), glon = L.lonOfCol(gx);
    const gScore = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const start = sy * W + sx, goal = gy * W + gx;
    gScore[start] = 0;
    const heap = new Heap();
    heap.push(start, haversineKm(L.latOfRow(sy), L.lonOfCol(sx), glat, glon));
    const N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let expanded = 0;
    while (heap.size) {
      const { n } = heap.pop();
      if (closed[n]) continue;
      closed[n] = 1; expanded++;
      if (n === goal) break;
      if (expanded > 1.5e6) return { ok: false, reason: 'search limit' };
      const y = (n / W) | 0, x = n - y * W;
      for (const [dx, dy] of N) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        const nx = (x + dx + W) % W;
        if (!inBox(nx, ny)) continue;
        const m = ny * W + nx; if (closed[m]) continue;
        const s = L.slope[m] * sc; if (s > maxSlope) continue;
        // Sub-cell roughness hazard (>50 m) and TES low-TI fine-dust sinkage hazard (<100 tiu)
        let rPen = 0, dPen = 0;
        if (hasRough) { const r = L.rough[m] * rScale; if (r > 50) rPen = (r - 50) / 25; }
        if (hasTi) { const tiRaw = L.ti[m]; if (tiRaw > 0) { const ti = tiRaw * tiScale; if (ti < 100) dPen = 15 * (1 - ti / 100); } }
        const dist = Math.hypot(dx * kmCol[ny], dy * kmRow);
        const c = gScore[n] + dist * (1 + k * (s + rPen + dPen));
        if (c < gScore[m]) { gScore[m] = c; came[m] = n; heap.push(m, c + haversineKm(L.latOfRow(ny), L.lonOfCol(nx), glat, glon)); }
      }
    }
    if (came[goal] < 0 && goal !== start) return { ok: false, reason: 'no slope-safe path inside search window' };
    const path = []; let cur = goal;
    while (cur >= 0) { path.push(cur); if (cur === start) break; cur = came[cur]; }
    path.reverse();
    return { ok: true, path, stats: pathStats(L, path, kmCol, kmRow) };
  }

  function pathStats(L, path, kmCol, kmRow) {
    const W = L.width, sc = L.meta.slope.scale;
    const rScale = L.meta.rough ? L.meta.rough.scale : 0;
    const tiScale = L.meta.ti ? L.meta.ti.scale : 0;
    let km = 0, maxS = 0, sumS = 0, hazardKm = 0, dustKm = 0, sumR = 0;
    const profile = [];
    for (let i = 0; i < path.length; i++) {
      const n = path[i], y = (n / W) | 0, x = n - y * W;
      const s = L.slope[n] * sc; maxS = Math.max(maxS, s); sumS += s;
      const r = L.rough ? L.rough[n] * rScale : 0; sumR += r;
      const ti = (L.ti && L.ti[n] > 0) ? L.ti[n] * tiScale : null;
      if (i) { const p = path[i - 1], py = (p / W) | 0, px = p - py * W;
        let dx = Math.abs(x - px); if (dx > W / 2) dx = W - dx;
        const d = Math.hypot(dx * kmCol[y], (y - py) * kmRow); km += d;
        if (s > 10) hazardKm += d;
        if (ti !== null && ti < 100) dustKm += d;
      }
      profile.push({ km, elev: L.meta.elev.offset + L.elev[n] * L.meta.elev.scale, slope: s, rough: r, ti });
    }
    return { km, maxSlope: maxS, meanSlope: sumS / path.length, hazardKm, dustKm, meanRough: sumR / path.length, profile };
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
