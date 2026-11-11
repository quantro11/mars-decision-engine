// UI + rendering for the Mars Base Decision Engine. Pure logic lives in scoring.js / astar.js / storm.js.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const META = window.LAYER_META;
  const W = META.width, H = META.height;

  // ------------------------------------------------------------ layer decoding
  const L = {
    width: W, height: H, meta: META,
    latOfRow: (y) => 90 - (y + 0.5) * (180 / H),
    lonOfCol: (x) => -180 + (x + 0.5) * (360 / W),
    rowOfLat: (lat) => Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H))),
    colOfLon: (lon) => ((Math.floor((lon + 180) / 360 * W) % W) + W) % W,
  };
  let baseImg = null;

  function decode(key) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        if (key === 'base') { baseImg = im; return res(); }
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, W, H).data;
        const out = new Uint8Array(W * H);
        for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j];
        L[key] = out; res();
      };
      im.onerror = rej; im.src = window.LAYER_DATA[key];
    });
  }

  // physical values of a cell
  function cellValues(x, y) {
    const i = y * W + x;
    const iceRaw = L.ice[i];
    return {
      elev: META.elev.offset + L.elev[i] * META.elev.scale,
      slope: L.slope[i] * META.slope.scale,
      rough: L.rough[i] * META.rough.scale,
      ice: iceRaw === 0 ? null : META.ice.offset + iceRaw * META.ice.scale,
      lat: L.latOfRow(y), lon: L.lonOfCol(x),
    };
  }

  // mean physical values over a square block (used for candidate cards)
  function blockValues(cx, cy, size) {
    const h = size >> 1; let n = 0, e = 0, sl = 0, r = 0, ic = 0, nIce = 0;
    for (let y = cy - h; y < cy + h; y++) for (let x = cx - h; x < cx + h; x++) {
      if (y < 0 || y >= H) continue; const v = cellValues(((x % W) + W) % W, y);
      e += v.elev; sl += v.slope; r += v.rough; n++; if (v.ice !== null) { ic += v.ice; nIce++; }
    }
    return { elev: e / n, slope: sl / n, rough: r / n, ice: nIce ? ic / nIce : null, lat: L.latOfRow(cy), lon: L.lonOfCol(cx) };
  }

  // ------------------------------------------------------------ state
  const S = {
    mode: 'score', preset: 'balanced', weights: { ...SCORING.PRESETS.balanced.w }, hard: true, iceBand: 'ice15',
    overlay: 'score', opacity: 0.7, showRegions: true, showEZ: false,
    view: { scale: 1, tx: 0, ty: 0 }, score: new Float32Array(W * H), candidates: [], selected: null,
    route: { start: null, goal: null, safe: null, straight: null, maxSlope: 15, k: 0.3, speed: 20 },
    crisis: { site: null, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0 },
    hover: null,
  };

  // ------------------------------------------------------------ canvas setup
  const canvas = $('#map'), ctx = canvas.getContext('2d');
  const ovCanvas = document.createElement('canvas'); ovCanvas.width = W; ovCanvas.height = H;
  const ovCtx = ovCanvas.getContext('2d');
  const ovImg = ovCtx.createImageData(W, H);
  let ovDirty = true;

  let viewReady = false;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const cx = canvas.width / 2, cy = canvas.height / 2, [gx, gy] = toGrid(cx, cy);
    canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
    if (!viewReady) { fitView(); viewReady = true; }
    else { S.view.tx = canvas.width / 2 - gx * S.view.scale; S.view.ty = canvas.height / 2 - gy * S.view.scale; wrapView(); }
    draw();
  }
  function fitView() {
    const s = Math.min(canvas.width / W, canvas.height / H);
    S.view = { scale: s, tx: (canvas.width - W * s) / 2, ty: (canvas.height - H * s) / 2 };
  }
  const toScreen = (x, y) => [S.view.tx + x * S.view.scale, S.view.ty + y * S.view.scale];
  const toGrid = (sx, sy) => [(sx - S.view.tx) / S.view.scale, (sy - S.view.ty) / S.view.scale];

  // ------------------------------------------------------------ colour maps
  function lerpStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, ...a] = stops[i - 1], [t1, ...b] = stops[i], u = (t - t0) / (t1 - t0 || 1);
      return a.map((v, k) => v + (b[k] - v) * u);
    }
    return stops[stops.length - 1].slice(1);
  }
  const CMAP = {
    score: [[0, 20, 20, 40], [0.3, 70, 30, 110], [0.55, 200, 70, 70], [0.75, 250, 160, 40], [1, 255, 250, 180]],
    ice: [[0, 40, 30, 20], [0.5, 60, 90, 120], [1, 160, 230, 255]],
    slope: [[0, 30, 60, 30], [0.33, 90, 180, 60], [0.66, 250, 200, 40], [1, 255, 40, 40]],
    elev: [[0, 20, 40, 90], [0.3, 60, 120, 140], [0.5, 170, 150, 90], [0.7, 150, 80, 50], [1, 255, 255, 255]],
  };
  const LUT = {};
  for (const k in CMAP) { LUT[k] = new Uint8ClampedArray(256 * 3); for (let i = 0; i < 256; i++) { const c = lerpStops(CMAP[k], i / 255); LUT[k].set(c.map(Math.round), i * 3); } }

  function buildOverlay() {
    const d = ovImg.data, lut = LUT[S.overlay] || LUT.score;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      let v, a = 255;
      if (S.overlay === 'score') { const sc = S.score[i]; v = Math.round(Math.max(0, Math.min(1, (sc - 0.35) / 0.65)) * 255); a = sc <= 0 ? 170 : 255; }
      else if (S.overlay === 'ice') { const r = L.ice[i]; if (r === 0) { v = 0; a = 60; } else v = Math.round(Math.max(0, Math.min(255, (r - 28) * 1.275))); }
      else if (S.overlay === 'slope') v = Math.min(255, L.slope[i] * 2);          // 0..16 deg -> 0..255
      else if (S.overlay === 'elev') v = L.elev[i];
      else { d[j + 3] = 0; continue; }
      d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = a;
    }
    ovCtx.putImageData(ovImg, 0, 0); ovDirty = false;
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    if (!baseImg) return;
    if (ovDirty) buildOverlay();
    const { scale, tx, ty } = S.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = scale < 1;
    // draw base + overlay three times for horizontal wrap
    for (const off of [-W, 0, W]) {
      const sx = tx + off * scale;
      if (sx > canvas.width || sx + W * scale < 0) continue;
      ctx.drawImage(baseImg, sx, ty, W * scale, H * scale);
      if (S.overlay !== 'none') { ctx.globalAlpha = S.opacity; ctx.drawImage(ovCanvas, sx, ty, W * scale, H * scale); ctx.globalAlpha = 1; }
    }
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) { const [x0] = toScreen(L.colOfLon(Math.min(lon, 179.99)), 0); ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(x0, ty + H * scale); ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { const [, y0] = toScreen(0, L.rowOfLat(lat)); ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke(); }
    // HLS ±50° band
    ctx.strokeStyle = 'rgba(255,200,87,.35)'; ctx.setLineDash([6, 6]);
    for (const lat of [50, -50]) { const [, y0] = toScreen(0, L.rowOfLat(lat)); ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke(); }
    ctx.setLineDash([]);

    const fontPx = Math.max(10, Math.min(13, 9 + scale)) * devicePixelRatio;
    ctx.font = `${fontPx}px Inter, Segoe UI, sans-serif`; ctx.textBaseline = 'middle';
    if (S.showRegions || S.showEZ) for (const r of REGIONS) {
      if (S.showEZ && !r.ez && !S.showRegions) continue;
      if (!S.showEZ && !S.showRegions) break;
      if (!S.showEZ && scale < 1.6 && !r.mission && !r.ez) continue;   // declutter when zoomed out
      const [x, y] = toScreen(L.colOfLon(r.lon), L.rowOfLat(r.lat));
      const ez = S.showEZ && r.ez;
      ctx.fillStyle = ez ? '#5ad17a' : (r.mission ? '#4cc3ff' : 'rgba(255,255,255,.75)');
      ctx.beginPath(); ctx.arc(x, y, (ez ? 4 : 2.5) * devicePixelRatio, 0, 7); ctx.fill();
      if (ez || scale >= 1.6 || (r.mission && scale >= 1.2)) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(r.name, x + 7, y + 1); ctx.fillStyle = ez ? '#bff5cc' : '#fff'; ctx.fillText(r.name, x + 6, y); }
    }
    // routes
    const drawPath = (path, color, width, dash) => {
      if (!path) return; ctx.strokeStyle = color; ctx.lineWidth = width * devicePixelRatio; ctx.setLineDash(dash || []);
      ctx.beginPath(); let px = null;
      for (const n of path) { const y = (n / W) | 0, x = n - y * W; const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        if (px !== null && Math.abs(sx - px) > W * scale / 2) ctx.moveTo(sx, sy); else if (px === null) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); px = sx; }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (S.route.straight) drawPath(S.route.straight.path, '#ff5c5c', 2, [6, 5]);
    if (S.route.safe) drawPath(S.route.safe.path, '#5ad17a', 3);
    for (const [p, col, lab] of [[S.route.start, '#5ad17a', 'A'], [S.route.goal, '#ffc857', 'B']]) if (p) marker(p.x, p.y, col, lab);
    // candidates
    S.candidates.forEach((c, i) => marker(c.x, c.y, S.selected && S.selected.cand === i ? '#fff' : '#ff7a45', String(i + 1)));
    if (S.crisis.site) marker(S.crisis.site.x, S.crisis.site.y, '#4cc3ff', '⚡');
    if (S.selected && S.selected.cand == null) { const [x, y] = toScreen(S.selected.x + 0.5, S.selected.y + 0.5); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.strokeRect(x - 6, y - 6, 12, 12); }
  }
  function marker(gx, gy, color, label) {
    const [x, y] = toScreen(gx, gy), r = 10 * devicePixelRatio;
    ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = `bold ${11 * devicePixelRatio}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5); ctx.textAlign = 'left';
  }

  // ------------------------------------------------------------ scoring pipeline
  let rafScore = 0;
  function rescore() {
    cancelAnimationFrame(rafScore);
    rafScore = requestAnimationFrame(() => {
      L.ice = L[S.iceBand];
      const t0 = performance.now();
      SCORING.scoreMap(L, S.weights, S.hard, S.score);
      const blockPx = Math.round(2 / META.deg_per_px), sepPx = Math.round(800 / 59.3 / META.deg_per_px);
      S.candidates = SCORING.topCandidates(S.score, W, H, 5, blockPx, sepPx).map(c => ({ ...c, x: Math.round(c.x), y: Math.round(c.y), blockPx }));
      ovDirty = true; renderCandidates(); if (S.selected) renderDetail(S.selected.x, S.selected.y, S.selected.cand);
      draw();
      $('#hud-coord').dataset.t = (performance.now() - t0).toFixed(0);
    });
  }

  function critRows(v, w) {
    const wn = SCORING.normalize(w);
    const fmt = { elev: `${(v.elev / 1000).toFixed(1)} km`, slope: `${v.slope.toFixed(1)}°`, ice: v.ice === null ? 'no data' : v.ice.toFixed(2), rough: `${v.rough.toFixed(0)} m`, lat: `${v.lat.toFixed(1)}°` };
    return SCORING.CRITERIA.map(c => {
      const f = SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      return `<div class="crit"><span>${c.label.split(' (')[0]}</span><div class="bar"><i style="width:${(f * 100).toFixed(0)}%;opacity:${0.35 + 0.65 * wn[c.key] / 0.5}"></i></div><span class="v ${cls}">${fmt[c.key]}</span></div>`;
    }).join('');
  }

  function renderCandidates() {
    const ol = $('#candidates'); ol.innerHTML = '';
    if (!S.candidates.length) { ol.innerHTML = '<li class="help">No cell satisfies the constraints.</li>'; return; }
    S.candidates.forEach((c, i) => {
      const v = blockValues(c.x, c.y, c.blockPx), nr = nearestRegion(v.lat, v.lon);
      const name = nr.distDeg < 6 ? nr.region.name : `Unnamed terrain near ${nr.region.name}`;
      const li = document.createElement('li'); li.className = 'card' + (S.selected && S.selected.cand === i ? ' active' : '');
      li.innerHTML = `<div class="head"><span><span class="rank">#${i + 1}</span><span class="name">${name}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">HLS-2015 EZ</span>' : ''}</span><span class="score">${c.score.toFixed(2)}</span></div>
        <div class="coord">${fmtLat(v.lat)}, ${fmtLon(v.lon)} · 2°×2° block means</div>${critRows(v, S.weights)}`;
      li.onclick = () => { select(c.x, c.y, i); if (S.mode === 'crisis') setCrisisSite(c.x, c.y); };
      ol.appendChild(li);
    });
  }
  const fmtLat = (la) => `${Math.abs(la).toFixed(1)}°${la >= 0 ? 'N' : 'S'}`;
  const fmtLon = (lo) => `${Math.abs(lo).toFixed(1)}°${lo >= 0 ? 'E' : 'W'}`;

  function renderDetail(x, y, cand) {
    const v = cellValues(x, y), s = S.score[y * W + x], nr = nearestRegion(v.lat, v.lon);
    const vetoed = S.hard && (v.elev > SCORING.HARD.elevMax || v.slope > SCORING.HARD.slopeMax || Math.abs(v.lat) > SCORING.HARD.latMax);
    $('#detail').innerHTML = `<div class="big">${s.toFixed(3)}</div>
      <div class="coord">${fmtLat(v.lat)}, ${fmtLon(v.lon)} · ${nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name} (${(nr.distDeg * 59.3).toFixed(0)} km)</div>
      ${vetoed ? '<div class="verdict bad">⛔ Vetoed by hard constraint (elev &gt; +2 km, slope &gt; 15° or |lat| &gt; 50°)</div>' : ''}
      ${critRows(v, S.weights)}
      <table><tr><td>Elevation (MOLA)</td><td>${v.elev.toFixed(0)} m</td></tr><tr><td>Slope, 90th pct</td><td>${v.slope.toFixed(1)}°</td></tr>
      <tr><td>Ice consistency (${$('#iceband .active').textContent})</td><td>${v.ice === null ? 'outside SWIM' : v.ice.toFixed(2)}</td></tr><tr><td>Roughness σ</td><td>${v.rough.toFixed(0)} m</td></tr></table>
      <div class="row"><button id="use-route" class="ghost">Use as route start</button><button id="use-crisis" class="ghost">Use for crisis sim</button></div>`;
    $('#use-route').onclick = () => { setMode('route'); S.route.start = { x, y }; S.route.goal = null; S.route.safe = S.route.straight = null; renderRoute(); draw(); };
    $('#use-crisis').onclick = () => { setMode('crisis'); setCrisisSite(x, y); };
  }
  function select(x, y, cand) { S.selected = { x, y, cand }; renderDetail(x, y, cand); renderCandidates(); draw(); }

  // ------------------------------------------------------------ route
  function computeRoute() {
    const r = S.route; if (!r.start || !r.goal) return;
    const t0 = performance.now();
    r.safe = ASTAR.plan(L, r.start.x, r.start.y, r.goal.x, r.goal.y, { k: r.k, maxSlope: r.maxSlope });
    r.straight = ASTAR.straight(L, r.start.x, r.start.y, r.goal.x, r.goal.y);
    r.ms = performance.now() - t0; renderRoute(); draw();
  }
  function renderRoute() {
    const r = S.route, el = $('#route-stats');
    if (!r.start) { el.innerHTML = '<p class="help">Step 1 — click the start point.</p>'; return; }
    if (!r.goal) { el.innerHTML = '<p class="help">Step 2 — click the goal point.</p>'; return; }
    if (!r.safe || !r.safe.ok) { el.innerHTML = `<p class="help bad">No slope-safe route found (${r.safe ? r.safe.reason : ''}). Raise the slope limit or move the goal.</p>`; return; }
    const a = r.straight.stats, b = r.safe.stats, sols = (km) => (km / r.speed).toFixed(0);
    const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
    el.innerHTML = `<table class="stat-table"><tr><th></th><th class="straight">Straight</th><th class="safe">Safe (A*)</th></tr>
      <tr><td>Distance</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
      <tr><td>Max slope</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
      <tr><td>Mean slope</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}°</td></tr>
      <tr><td>km on &gt;10° terrain</td><td>${a.hazardKm.toFixed(0)}</td><td>${b.hazardKm.toFixed(0)}</td></tr>
      <tr><td>Travel time</td><td>${sols(a.km)} sols</td><td>${sols(b.km)} sols</td></tr></table>
      <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? `⚠ Straight line crosses ${a.maxSlope.toFixed(0)}° terrain — rover tip-over risk. Safe route adds ${(b.km - a.km).toFixed(0)} km.` : '✓ Straight line is already within the slope limit.'}</div>
      <div class="help" style="margin-top:6px">Elevation profile of safe route (A* ${r.ms.toFixed(0)} ms, ${r.safe.path.length} cells)</div>${profileSVG(b.profile)}`;
  }
  function profileSVG(p) {
    const w = 260, h = 110, pad = 24;
    const kmMax = p[p.length - 1].km || 1, eMin = Math.min(...p.map(q => q.elev)), eMax = Math.max(...p.map(q => q.elev)) + 1;
    const X = (km) => pad + (km / kmMax) * (w - pad - 6), Y = (e) => h - 16 - ((e - eMin) / (eMax - eMin)) * (h - 26);
    let d = '', segs = '';
    p.forEach((q, i) => { d += (i ? 'L' : 'M') + X(q.km).toFixed(1) + ',' + Y(q.elev).toFixed(1); });
    p.forEach((q, i) => { if (i && q.slope > 10) segs += `<line x1="${X(p[i - 1].km).toFixed(1)}" y1="${Y(p[i - 1].elev).toFixed(1)}" x2="${X(q.km).toFixed(1)}" y2="${Y(q.elev).toFixed(1)}" stroke="#ffc857" stroke-width="3"/>`; });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#5ad17a" stroke-width="1.5"/>${segs}
      <text x="${pad}" y="10" fill="#8d94a3" font-size="9">${(eMax / 1000).toFixed(1)} km</text><text x="${pad}" y="${h - 4}" fill="#8d94a3" font-size="9">${(eMin / 1000).toFixed(1)} km</text>
      <text x="${w - 6}" y="${h - 4}" fill="#8d94a3" font-size="9" text-anchor="end">${kmMax.toFixed(0)} km</text></svg>`;
  }

  // ------------------------------------------------------------ crisis
  function setCrisisSite(x, y) { S.crisis.site = { x, y }; runCrisis(); draw(); }
  function runCrisis() {
    const c = S.crisis, el = $('#crisis-summary');
    if (!c.site) { $('#crisis-site').textContent = '— click the map —'; el.innerHTML = ''; return; }
    const v = cellValues(c.site.x, c.site.y), nr = nearestRegion(v.lat, v.lon);
    $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name} · ${fmtLat(v.lat)}`;
    const res = STORM.simulate({ lat: v.lat, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
      storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
    const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, 0.5), peakSolar = c.area * 0.2 * STORM.dailySolar(v.lat, c.tauPeak);
    const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
    const verdict = res.blackoutSol !== null ? `<div class="summary-big bad">⛔ Blackout on sol ${res.blackoutSol}</div><div class="help">Battery depleted ${res.blackoutSol - 20} sols after storm onset. Peak-storm production ${(peakSolar + nuc).toFixed(0)} kWh/sol vs consumption ${c.cons} kWh/sol.</div>`
      : `<div class="summary-big ok">✓ Survives the storm</div><div class="help">Minimum battery ${res.minBatt.toFixed(0)} kWh (${(100 * res.minBatt / c.batt).toFixed(0)}%). Margin at peak storm: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.</div>`;
    el.innerHTML = `${verdict}
      <div class="kv"><span>Clear-sky solar (τ 0.5)</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
      <div class="kv"><span>Peak-storm solar (τ ${c.tauPeak.toFixed(1)})</span><b>${peakSolar.toFixed(0)} kWh/sol · −${res.peakSolarDropPct.toFixed(0)}%</b></div>
      <div class="kv"><span>Nuclear (Kilopower)</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
      ${crisisSVG(res.rows, c.batt)}
      <div class="help">Storm: onset sol 20, 10-sol rise, 40-sol plateau, 30-sol decay. ${c.kp === 0 && res.blackoutSol !== null ? 'Try adding a Kilopower reactor — NASA’s own conclusion for sustained surface power.' : ''}</div>`;
  }
  function crisisSVG(rows, cap) {
    const w = 260, h = 110, pad = 22, n = rows.length;
    const X = (i) => pad + (i / (n - 1)) * (w - pad - 6), Yb = (b) => h - 16 - (b / cap) * (h - 26), Yt = (t) => h - 16 - (t / 12) * (h - 26);
    let db = '', dt = '';
    rows.forEach((r, i) => { db += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yb(r.batt).toFixed(1); dt += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yt(r.tau).toFixed(1); });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}"><path d="${dt}" fill="none" stroke="#ff7a45" stroke-width="1" stroke-dasharray="3 3"/><path d="${db}" fill="none" stroke="#4cc3ff" stroke-width="1.8"/>
      <text x="${pad}" y="10" fill="#4cc3ff" font-size="9">battery</text><text x="${pad + 44}" y="10" fill="#ff7a45" font-size="9">τ (0–12)</text>
      <text x="${w - 6}" y="${h - 4}" fill="#8d94a3" font-size="9" text-anchor="end">${n} sols</text></svg>`;
  }

  // ------------------------------------------------------------ UI wiring
  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    for (const k of ['score', 'route', 'crisis']) $('#panel-' + k).classList.toggle('hidden', k !== m);
    if (m === 'route') { S.overlay = 'slope'; } else if (m === 'score') { S.overlay = 'score'; }
    document.querySelectorAll('#overlay button').forEach(b => b.classList.toggle('active', b.dataset.ov === S.overlay));
    ovDirty = true; renderLegend(); if (m === 'route') renderRoute(); if (m === 'crisis') runCrisis(); draw();
  }
  document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  function buildPresets() {
    const el = $('#presets'); el.innerHTML = '';
    for (const k in SCORING.PRESETS) {
      const p = SCORING.PRESETS[k], b = document.createElement('button');
      b.className = 'preset' + (S.preset === k ? ' active' : '');
      b.innerHTML = `<span>${p.icon}</span><span>${p.name}</span><small>${Object.values(p.w).map(v => (v * 100).toFixed(0)).join('/')}</small>`;
      b.onclick = () => { S.preset = k; S.weights = { ...p.w }; buildPresets(); buildSliders(); rescore(); };
      el.appendChild(b);
    }
  }
  function buildSliders() {
    const el = $('#sliders'); el.innerHTML = '';
    const wn = SCORING.normalize(S.weights);
    for (const c of SCORING.CRITERIA) {
      const d = document.createElement('div'); d.className = 'slider';
      d.innerHTML = `<div class="lbl"><span>${c.label}</span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}">`;
      d.querySelector('input').oninput = (e) => { S.weights[c.key] = +e.target.value / 100; S.preset = null; buildPresets();
        const n = SCORING.normalize(S.weights); el.querySelectorAll('.slider').forEach((s, i) => s.querySelector('b').textContent = (n[SCORING.CRITERIA[i].key] * 100).toFixed(0) + '%'); rescore(); };
      el.appendChild(d);
    }
  }
  $('#hard').onchange = (e) => { S.hard = e.target.checked; rescore(); };
  document.querySelectorAll('#iceband button').forEach(b => b.onclick = () => { document.querySelectorAll('#iceband button').forEach(x => x.classList.toggle('active', x === b)); S.iceBand = b.dataset.band; rescore(); });
  document.querySelectorAll('#overlay button').forEach(b => b.onclick = () => { document.querySelectorAll('#overlay button').forEach(x => x.classList.toggle('active', x === b)); S.overlay = b.dataset.ov; ovDirty = true; renderLegend(); draw(); });
  $('#opacity').oninput = (e) => { S.opacity = +e.target.value / 100; draw(); };
  $('#show-regions').onchange = (e) => { S.showRegions = e.target.checked; draw(); };
  $('#show-ez').onchange = (e) => { S.showEZ = e.target.checked; draw(); };
  const bindRange = (id, fmt, cb) => { const el = $('#' + id); const upd = () => { $('#' + id + '-v').textContent = fmt(+el.value); cb(+el.value); }; el.oninput = upd; upd(); };
  bindRange('maxslope', v => v + '°', v => { S.route.maxSlope = v; computeRoute(); });
  bindRange('kslope', v => (v / 100).toFixed(2), v => { S.route.k = v / 100; computeRoute(); });
  bindRange('speed', v => v + ' km/sol', v => { S.route.speed = v; renderRoute(); });
  $('#route-clear').onclick = () => { S.route.start = S.route.goal = S.route.safe = S.route.straight = null; renderRoute(); draw(); };
  bindRange('tau', v => (v / 10).toFixed(1), v => { S.crisis.tauPeak = v / 10; runCrisis(); });
  bindRange('area', v => v + ' m²', v => { S.crisis.area = v; runCrisis(); });
  bindRange('cons', v => v + ' kWh/sol', v => { S.crisis.cons = v; runCrisis(); });
  bindRange('batt', v => v + ' kWh', v => { S.crisis.batt = v; runCrisis(); });
  bindRange('kp', v => String(v), v => { S.crisis.kp = v; runCrisis(); });
  $('#btn-about').onclick = () => $('#about').classList.remove('hidden');
  $('#about-close').onclick = () => $('#about').classList.add('hidden');
  $('#about').onclick = (e) => { if (e.target.id === 'about') $('#about').classList.add('hidden'); };

  const fly = $('#flyto');
  REGIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(r => { const o = document.createElement('option'); o.value = r.name; o.textContent = (r.ez ? '★ ' : '') + r.name; fly.appendChild(o); });
  fly.onchange = () => { const r = REGIONS.find(q => q.name === fly.value); if (!r) return; const x = L.colOfLon(r.lon), y = L.rowOfLat(r.lat);
    S.view.scale = Math.max(S.view.scale, 3); S.view.tx = canvas.width / 2 - x * S.view.scale; S.view.ty = canvas.height / 2 - y * S.view.scale; select(x, y, null); fly.value = ''; };

  function renderLegend() {
    const el = $('#legend'), lut = LUT[S.overlay];
    if (!lut) { el.innerHTML = ''; return; }
    const stops = []; for (let i = 0; i <= 10; i++) { const v = Math.round(i * 25.5); stops.push(`rgb(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]})`); }
    const ends = { score: ['≤0.35 — unsuitable / vetoed', '1 — ideal'], ice: ['no ice evidence (−1)', 'strong ice evidence (+1)'], slope: ['0°', '≥16° (90th pct)'], elev: ['−8.2 km', '+21 km'] }[S.overlay];
    el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
  }

  // ------------------------------------------------------------ map interaction
  let drag = null, moved = false;
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty }; moved = false; });
  window.addEventListener('mousemove', (e) => {
    if (drag) { const dx = (e.clientX - drag.x) * devicePixelRatio, dy = (e.clientY - drag.y) * devicePixelRatio; if (Math.hypot(dx, dy) > 3) moved = true;
      S.view.tx = drag.tx + dx; S.view.ty = drag.ty + dy; wrapView(); draw(); }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('click', (e) => {
    if (moved) return;
    const g = gridAt(e); if (!g) return;
    const [x, y] = g;
    if (S.mode === 'route') { const r = S.route;
      if (!r.start || (r.start && r.goal)) { r.start = { x, y }; r.goal = null; r.safe = r.straight = null; } else { r.goal = { x, y }; }
      renderRoute(); if (r.goal) computeRoute(); draw(); return; }
    if (S.mode === 'crisis') { setCrisisSite(x, y); }
    select(x, y, null);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * devicePixelRatio, my = (e.clientY - r.top) * devicePixelRatio;
    const f = Math.exp(-e.deltaY * 0.0015), minS = Math.min(canvas.width / W, canvas.height / H) * 0.9, ns = Math.max(minS, Math.min(40, S.view.scale * f));
    const k = ns / S.view.scale; S.view.tx = mx - (mx - S.view.tx) * k; S.view.ty = my - (my - S.view.ty) * k; S.view.scale = ns; wrapView(); draw();
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    const g = gridAt(e), tip = $('#tooltip');
    if (!g) { tip.classList.add('hidden'); return; }
    const [x, y] = g, v = cellValues(x, y), s = S.score[y * W + x];
    $('#hud-coord').textContent = `${fmtLat(v.lat)} ${fmtLon(v.lon)} · elev ${v.elev.toFixed(0)} m · score ${s.toFixed(2)}` + ($('#hud-coord').dataset.t ? ` · rescored in ${$('#hud-coord').dataset.t} ms` : '');
    tip.innerHTML = `<b>${fmtLat(v.lat)}, ${fmtLon(v.lon)}</b><br>elev ${v.elev.toFixed(0)} m · slope ${v.slope.toFixed(1)}°<br>ice ${v.ice === null ? '—' : v.ice.toFixed(2)} · rough ${v.rough.toFixed(0)} m<br>score <b>${s.toFixed(2)}</b>`;
    const r = canvas.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; tip.classList.remove('hidden');
  });
  canvas.addEventListener('mouseleave', () => $('#tooltip').classList.add('hidden'));
  function gridAt(e) {
    const r = canvas.getBoundingClientRect();
    let [gx, gy] = toGrid((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
    gx = ((Math.floor(gx) % W) + W) % W; gy = Math.floor(gy);
    if (gy < 0 || gy >= H) return null; return [gx, gy];
  }
  function wrapView() { const span = W * S.view.scale; while (S.view.tx > span) S.view.tx -= span; while (S.view.tx < -span) S.view.tx += span;
    const maxTy = canvas.height * 0.5, minTy = canvas.height * 0.5 - H * S.view.scale; S.view.ty = Math.max(minTy, Math.min(maxTy, S.view.ty)); }

  // ------------------------------------------------------------ boot
  buildPresets(); buildSliders(); renderLegend(); renderRoute();
  Promise.all(['elev', 'slope', 'rough', 'ice01', 'ice15', 'ice5', 'base'].map(decode)).then(() => {
    L.ice = L[S.iceBand];
    window.addEventListener('resize', resize); resize();
    rescore();
    $('#loading').classList.add('hidden');
    applyDemoLink();
  }).catch(err => { $('#loading').innerHTML = 'Failed to decode layers: ' + err; });

  // Deep links for the demo / presentation:
  //   ?preset=isru            ?demo=route&from=Jezero&to=Nili   ?demo=crisis&site=Arcadia&tau=9&kp=1
  function applyDemoLink() {
    const q = new URLSearchParams(location.search);
    const find = (n) => n && REGIONS.find(r => r.name.toLowerCase().includes(n.toLowerCase()));
    if (q.get('preset') && SCORING.PRESETS[q.get('preset')]) { S.preset = q.get('preset'); S.weights = { ...SCORING.PRESETS[S.preset].w }; buildPresets(); buildSliders(); rescore(); }
    if (q.get('demo') === 'route') {
      const a = find(q.get('from')) || REGIONS[0], b = find(q.get('to')) || REGIONS[16];
      setMode('route'); S.route.start = { x: L.colOfLon(a.lon), y: L.rowOfLat(a.lat) }; S.route.goal = { x: L.colOfLon(b.lon), y: L.rowOfLat(b.lat) };
      S.view.scale = 4; S.view.tx = canvas.width / 2 - (S.route.start.x + S.route.goal.x) / 2 * 4; S.view.ty = canvas.height / 2 - (S.route.start.y + S.route.goal.y) / 2 * 4; wrapView();
      computeRoute();
    } else if (q.get('demo') === 'crisis') {
      const a = find(q.get('site')) || REGIONS[10];
      if (q.get('tau')) { $('#tau').value = Math.round(+q.get('tau') * 10); $('#tau').oninput(); }
      if (q.get('kp')) { $('#kp').value = q.get('kp'); $('#kp').oninput(); }
      setMode('crisis'); setCrisisSite(L.colOfLon(a.lon), L.rowOfLat(a.lat));
    }
  }

  window.MDE = { L, S, cellValues, rescore };   // console access for debugging / tests
})();
