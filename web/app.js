// UI + rendering for the Mars Base Decision Engine. Pure logic lives in scoring.js / astar.js / storm.js.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { candidateName, trekUrl, fmtLat, fmtLon, escHtml } = window.MDE_FMT;
  const { profileSVG, crisisSVG } = window.MDE_CHARTS;
  const { initHabitabilityAPI, renderHabitability } = window.MDE_HAB;
  const { buildBriefPayload, renderBriefHTML, downloadBriefJSON } = window.MDE_BRIEF;
  const META = window.LAYER_META;
  const W = META.width, H = META.height;
  const MARS_R = 3389.5; // km

  const PRESET_CODES = {
    landing: 'EDL-PRI',
    isru: 'ISRU-H2O',
    balanced: 'CREW-BAL',
  };

  const CRIT_TAGS = {
    elev: 'ELEV',
    slope: 'SLOP',
    ice: 'H2O',
    rough: 'ROUG',
    lat: 'LAT',
    ti: 'TES',
    rad: 'RAD',
  };

  const OVERLAY_NAMES = {
    score: 'SUITABILITY SCORE',
    ice: 'SWIM 2.0 SUBSURFACE ICE',
    slope: 'MOLA 90TH-PCT SLOPE',
    elev: 'MOLA MEGDR ELEVATION',
    ti: 'TES THERMAL INERTIA',
    dust: 'TES DUST ABUNDANCE',
    rad: 'GCR DOSE (MSL/RAD-ANCHORED)',
    none: 'NASA VIKING MDIM 2.1 OPTICAL',
  };

  // ------------------------------------------------------------ layer decoding
  const L = {
    width: W, height: H, meta: META,
    latOfRow: (y) => 90 - (y + 0.5) * (180 / H),
    lonOfCol: (x) => -180 + (x + 0.5) * (360 / W),
    rowOfLat: (lat) => Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H))),
    colOfLon: (lon) => ((Math.floor((lon + 180) / 360 * W) % W) + W) % W,
  };
  let baseImg = null;

  const decodeInflight = {};
  function decode(key) {
    if (key === 'base' && baseImg) return Promise.resolve();
    if (key !== 'base' && L[key]) return Promise.resolve();
    if (decodeInflight[key]) return decodeInflight[key];
    decodeInflight[key] = new Promise((res, rej) => {
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
      im.onerror = () => {
        if (!im.src.includes('layers/')) {
          im.src = 'layers/' + key + '.png';
        } else {
          rej(new Error('Failed to load layer ' + key));
        }
      };
      im.src = (window.LAYER_DATA && window.LAYER_DATA[key]) ? window.LAYER_DATA[key] : ('layers/' + key + '.png');
    });
    return decodeInflight[key];
  }

  // physical values of a cell
  function cellValues(x, y) {
    const i = y * W + x;
    const iceRaw = L.ice[i];
    const out = {
      elev: META.elev.offset + L.elev[i] * META.elev.scale,
      slope: L.slope[i] * META.slope.scale,
      rough: L.rough[i] * META.rough.scale,
      ice: iceRaw === 0 ? null : META.ice.offset + iceRaw * META.ice.scale,
      ti: L.ti[i] === 0 ? null : L.ti[i] * META.ti.scale,
      dust: L.dust[i] === 0 ? null : META.dust.offset + L.dust[i] * META.dust.scale,
      lat: L.latOfRow(y), lon: L.lonOfCol(x),
    };
    out.rad = SCORING.radDose(out.elev);
    return out;
  }

  // mean physical values over a square block (used for candidate cards)
  function blockValues(cx, cy, size) {
    const h = size >> 1; let n = 0, e = 0, sl = 0, r = 0, ic = 0, nIce = 0, t = 0, nT = 0, du = 0, nD = 0;
    for (let y = cy - h; y < cy + h; y++) for (let x = cx - h; x < cx + h; x++) {
      if (y < 0 || y >= H) continue; const v = cellValues(((x % W) + W) % W, y);
      e += v.elev; sl += v.slope; r += v.rough; n++; if (v.ice !== null) { ic += v.ice; nIce++; }
      if (v.ti !== null) { t += v.ti; nT++; } if (v.dust !== null) { du += v.dust; nD++; }
    }
    return { rad: SCORING.radDose(e / n), elev: e / n, slope: sl / n, rough: r / n, ice: nIce ? ic / nIce : null, ti: nT ? t / nT : null, dust: nD ? du / nD : null, lat: L.latOfRow(cy), lon: L.lonOfCol(cx) };
  }

  // ------------------------------------------------------------ state
  const S = {
    viewMode: '2d', // '2d' | '3d'
    mode: 'score', preset: 'balanced', weights: { ...SCORING.PRESETS.balanced.w }, hard: true, iceBand: 'ice15',
    overlay: 'score', opacity: 0.45, showRegions: true, showEZ: false, globeOverlay: false,
    view: { scale: 1, tx: 0, ty: 0 }, score: new Float32Array(W * H), candidates: [], selected: null,
    sensSpread: 0.2, agg: 'sum',
    route: { start: null, goal: null, safe: null, straight: null, maxSlope: 15, k: 0.3, speed: 20 },
    crisis: { site: null, ls: 251, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0, regolith: 1.5 },
    hover: null,
  };

  // ------------------------------------------------------------ canvas & 3D globe setup
  const canvas = $('#map'), ctx = canvas.getContext('2d');
  const globeCanvas = $('#globe');
  const globe = (window.GLOBE3D && globeCanvas) ? window.GLOBE3D.createGlobe(globeCanvas) : null;

  const ovCanvas = document.createElement('canvas'); ovCanvas.width = W; ovCanvas.height = H;
  const ovCtx = ovCanvas.getContext('2d');
  const ovImg = ovCtx.createImageData(W, H);
  let ovDirty = true;

  let viewReady = false;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const cx = canvas.width / 2, cy = canvas.height / 2, [gx, gy] = toGrid(cx, cy);
    const cw = Math.max(1, Math.floor(r.width * devicePixelRatio));
    const ch = Math.max(1, Math.floor(r.height * devicePixelRatio));
    canvas.width = cw;
    canvas.height = ch;
    if (globeCanvas) { globeCanvas.width = cw; globeCanvas.height = ch; }
    if (!viewReady) { fitView(); viewReady = true; }
    else { S.view.tx = canvas.width / 2 - gx * S.view.scale; S.view.ty = canvas.height / 2 - gy * S.view.scale; wrapView(); }
    updateScaleBar();
    draw();
  }
  function fitView() {
    const s = Math.min(canvas.width / W, canvas.height / H);
    S.view = { scale: s, tx: (canvas.width - W * s) / 2, ty: (canvas.height - H * s) / 2 };
    if (globe && S.viewMode === '3d') {
      globe.state.targetDist = 2.55;
      schedule3D();
    }
    updateScaleBar();
  }
  const toScreen = (x, y) => [S.view.tx + x * S.view.scale, S.view.ty + y * S.view.scale];
  const toGrid = (sx, sy) => [(sx - S.view.tx) / S.view.scale, (sy - S.view.ty) / S.view.scale];

  // Unified grid-to-screen projection for both 2D and 3D modes
  const { drawCandidateReticle, drawSelectionReticle, drawWaypoint, drawStationBeacon } = window.MDE_MARKERS.createMarkers(ctx, projectGrid);
  function projectGrid(gx, gy) {
    if (S.viewMode === '3d' && globe) {
      return globe.project(L.latOfRow(gy), L.lonOfCol(gx), true);
    }
    const [sx, sy] = toScreen(gx, gy);
    return [sx, sy, true];
  }

  function updateScaleBar() {
    const elLbl = $('#scale-label'), elBar = $('#scale-bar');
    if (!elLbl || !elBar) return;
    let kmPerCssPx;
    if (S.viewMode === '3d' && globe) {
      kmPerCssPx = globe.equatorialKmPerCssPx();
    } else {
      const kmPerGridPx = (2 * Math.PI * MARS_R) / W;
      const cssPxPerGridPx = S.view.scale / (window.devicePixelRatio || 1);
      kmPerCssPx = kmPerGridPx / Math.max(0.05, cssPxPerGridPx);
    }
    const targetKm = kmPerCssPx * 72;
    const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    let niceKm = steps[0];
    for (const s of steps) { if (s <= targetKm * 1.35) niceKm = s; }
    const barPx = Math.max(28, Math.min(120, Math.round(niceKm / kmPerCssPx)));
    elLbl.textContent = `${niceKm} km`;
    elBar.style.width = `${barPx}px`;
  }

  // ------------------------------------------------------------ colour maps (delegated to ui/overlays.js)
  const { buildRadLut, fillOverlayBuffer, renderLegendHTML } = window.MDE_OVERLAYS;
  const radLut = buildRadLut(META.elev, SCORING);

  function buildOverlay() {
    fillOverlayBuffer(ovImg.data, S.overlay, L, S.score, radLut);
    ovCtx.putImageData(ovImg, 0, 0);
    if (globe) globe.updateOverlay(ovCanvas);
    ovDirty = false;
  }

  // ------------------------------------------------------------ 3D animation loop
  let raf3D = 0;
  function schedule3D() {
    if (S.viewMode !== '3d' || !globe || raf3D) return;
    raf3D = requestAnimationFrame(tick3D);
  }
  function tick3D() {
    raf3D = 0;
    if (S.viewMode !== '3d' || !globe) return;
    const moving = globe.stepPhysics();
    updateScaleBar();
    draw();
    if (moving) schedule3D();
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    if (!baseImg) return;
    if (ovDirty) buildOverlay();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (S.viewMode === '3d' && globe) {
      globe.render({ opacity: S.opacity, showOverlay: S.overlay !== 'none' && S.globeOverlay });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw3DGraticule(dpr);
    } else {
      const { scale, tx, ty } = S.view;
      ctx.fillStyle = '#030508';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = scale < 1.2;

      for (const off of [-W, 0, W]) {
        const sx = tx + off * scale;
        if (sx > canvas.width || sx + W * scale < 0) continue;
        ctx.drawImage(baseImg, sx, ty, W * scale, H * scale);
        if (S.overlay !== 'none') {
          ctx.globalAlpha = S.opacity;
          ctx.drawImage(ovCanvas, sx, ty, W * scale, H * scale);
          ctx.globalAlpha = 1;
        }
      }
      draw2DGraticule(dpr);
    }

    // Named regions & NASA Exploration Zones
    const effScale = S.viewMode === '3d' && globe ? (2.8 / Math.max(0.4, globe.state.camDist - 1.0)) : S.view.scale;
    const fontPx = Math.max(9.5, Math.min(12, 8.5 + effScale * 0.8)) * dpr;
    ctx.font = `500 ${fontPx}px "Inter", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    if (S.showRegions || S.showEZ) for (const r of REGIONS) {
      if (S.showEZ && !r.ez && !S.showRegions) continue;
      if (!S.showEZ && !S.showRegions) break;
      if (!S.showEZ && effScale < 1.5 && !r.mission && !r.ez) continue;
      const [x, y, vis] = projectGrid(L.colOfLon(r.lon), L.rowOfLat(r.lat));
      if (!vis || x < -80 || x > canvas.width + 80 || y < -30 || y > canvas.height + 30) continue;
      const ez = S.showEZ && r.ez;

      if (ez) {
        const s = 4.5 * dpr;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.3 * dpr;
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      } else {
        ctx.fillStyle = r.mission ? '#7f9bb3' : 'rgba(226, 232, 240, 0.78)';
        ctx.beginPath();
        ctx.arc(x, y, (r.mission ? 2.8 : 2) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (ez || effScale >= 1.5 || (r.mission && effScale >= 1.1)) {
        ctx.fillStyle = 'rgba(3, 5, 8, 0.82)';
        ctx.fillText(r.name, x + 7 * dpr, y + 1 * dpr);
        ctx.fillStyle = ez ? '#6ee7b7' : (r.mission ? '#bae6fd' : 'rgba(241, 245, 249, 0.92)');
        ctx.fillText(r.name, x + 6 * dpr, y);
      }
    }

    // Traverse paths
    const drawPath = (path, color, width, dash) => {
      if (!path) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      let px = null, wasVis = false;
      for (const n of path) {
        const y = (n / W) | 0, x = n - y * W;
        const [sx, sy, vis] = projectGrid(x + 0.5, y + 0.5);
        if (!vis) { wasVis = false; px = null; continue; }
        if (!wasVis || (S.viewMode === '2d' && px !== null && Math.abs(sx - px) > W * S.view.scale / 2)) {
          ctx.moveTo(sx, sy);
        } else {
          ctx.lineTo(sx, sy);
        }
        px = sx;
        wasVis = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (S.route.straight) drawPath(S.route.straight.path, '#ef4444', 1.8, [6 * dpr, 4 * dpr]);
    if (S.route.safe) drawPath(S.route.safe.path, '#10b981', 2.8);
    if (S.route.start) drawWaypoint(S.route.start.x, S.route.start.y, '#7fae8c', 'Start');
    if (S.route.goal) drawWaypoint(S.route.goal.x, S.route.goal.y, '#cfa25c', 'Goal');

    // Candidate reticles
    S.candidates.forEach((c, i) => {
      const isSel = S.selected && S.selected.cand === i;
      drawCandidateReticle(c.x, c.y, i + 1, c.score, isSel);
    });

    // Crisis surface station marker
    if (S.crisis.site) {
      drawStationBeacon(S.crisis.site.x, S.crisis.site.y);
    }

    // Selected cell precision target bracket
    if (S.selected && S.selected.cand == null) {
      drawSelectionReticle(S.selected.x + 0.5, S.selected.y + 0.5);
    }
  }

  function draw2DGraticule(dpr) {
    const { scale, tx, ty } = S.view;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
    ctx.lineWidth = 1;
    ctx.font = `500 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';

    for (let lon = -180; lon <= 180; lon += 30) {
      const [x0] = toScreen(L.colOfLon(Math.min(lon, 179.99)), 0);
      ctx.beginPath();
      ctx.moveTo(x0, Math.max(0, ty));
      ctx.lineTo(x0, Math.min(canvas.height, ty + H * scale));
      ctx.stroke();
      if (lon > -180 && lon < 180 && x0 > 30 * dpr && x0 < canvas.width - 30 * dpr) {
        const lbl = lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
        ctx.textAlign = 'center';
        ctx.fillText(lbl, x0, Math.max(46 * dpr, ty + 12 * dpr));
      }
    }

    ctx.textAlign = 'left';
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, y0] = toScreen(0, L.rowOfLat(lat));
      ctx.beginPath();
      ctx.moveTo(tx, y0);
      ctx.lineTo(tx + W * scale, y0);
      ctx.stroke();
      if (y0 > 48 * dpr && y0 < canvas.height - 40 * dpr) {
        const lbl = lat === 0 ? 'EQ 0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
        ctx.fillText(lbl, 12 * dpr, y0 - 4 * dpr);
      }
    }

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    for (const lat of [50, -50]) {
      const [, y0] = toScreen(0, L.rowOfLat(lat));
      ctx.beginPath();
      ctx.moveTo(tx, y0);
      ctx.lineTo(tx + W * scale, y0);
      ctx.stroke();
      if (y0 > 46 * dpr && y0 < canvas.height - 40 * dpr) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.72)';
        ctx.textAlign = 'right'; ctx.fillText(`${Math.abs(lat)}° ${lat > 0 ? 'N' : 'S'} · NASA latitude limit`, canvas.width - 16 * dpr, y0 - 4 * dpr); ctx.textAlign = 'left';
      }
    }
    ctx.setLineDash([]);
  }

  function draw3DGraticule(dpr) {
    if (!globe) return;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;

    // Meridians
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath();
      let open = false;
      for (let lat = -80; lat <= 80; lat += 5) {
        const [sx, sy, vis] = globe.project(lat, lon, false);
        if (!vis) { open = false; continue; }
        if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Parallels
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let open = false;
      for (let lon = -180; lon <= 180; lon += 5) {
        const [sx, sy, vis] = globe.project(lat, lon, false);
        if (!vis) { open = false; continue; }
        if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // NASA HLS ±50° operational envelope on 3D globe
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    for (const lat of [50, -50]) {
      ctx.beginPath();
      let open = false;
      for (let lon = -180; lon <= 180; lon += 4) {
        const [sx, sy, vis] = globe.project(lat, lon, false);
        if (!vis) { open = false; continue; }
        if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ------------------------------------------------------------ scoring pipeline
  let rafScore = 0;
  function rescore() {
    cancelAnimationFrame(rafScore);
    rafScore = requestAnimationFrame(() => {
      L.ice = L[S.iceBand];
      const t0 = performance.now();
      SCORING.scoreMap(L, S.weights, S.hard, S.score, S.agg);
      const blockPx = Math.round(2 / META.deg_per_px), sepPx = Math.round(800 / 59.3 / META.deg_per_px);
      S.candidates = SCORING.topCandidates(S.score, W, H, 5, blockPx, sepPx).map(c => ({ ...c, x: Math.round(c.x), y: Math.round(c.y), blockPx }));
      if ($('#sens-result')) $('#sens-result').innerHTML = '';
      ovDirty = true; renderCandidates(); if (S.selected) renderDetail(S.selected.x, S.selected.y, S.selected.cand);
      draw();
      $('#hud-coord').dataset.t = (performance.now() - t0).toFixed(0);
    });
  }

  function runSensitivity() {
    if (!S.candidates.length) return;
    const btn = $('#sens-run'), out = $('#sens-result');
    if (!btn || !out) return;
    btn.disabled = true; out.innerHTML = '<div class="help">Running 30 perturbed scorings…</div>';
    setTimeout(() => {
      const blockPx = S.candidates[0].blockPx, sepPx = Math.round(800 / 59.3 / META.deg_per_px);
      const rob = SCORING.sensitivity(L, S.weights, S.hard, S.candidates,
        { mode: S.agg, runs: 30, spread: S.sensSpread, n: 5, blockPx, minSepPx: sepPx, matchPx: Math.round(400 / 59.3 / META.deg_per_px) }, SCORING.mulberry32(2026));
      S.candidates.forEach((c, i) => { c.robust = rob[i]; });
      const mean = rob.reduce((a, b) => a + b, 0) / rob.length;
      out.innerHTML = `<div class="verdict ${mean >= 0.8 ? 'ok' : mean >= 0.5 ? '' : 'bad'}">Weights ±${Math.round(S.sensSpread * 100)}% × 30 runs: top-5 candidates stay in the top-5 (within 400 km) in ${(mean * 100).toFixed(0)}% of runs on average. ${mean >= 0.8 ? 'Ranking is ROBUST to weight uncertainty.' : 'Ranking DEPENDS on the chosen weights.'}</div>`;
      renderCandidates(); btn.disabled = false;
    }, 30);
  }

  function critRows(v, w) {
    const wn = SCORING.normalize(w);
    const fmt = {
      elev: `${(v.elev / 1000).toFixed(1)} km`,
      slope: `${v.slope.toFixed(1)}°`,
      ice: v.ice === null ? 'no data' : v.ice.toFixed(2),
      rough: `${v.rough.toFixed(0)} m`,
      lat: `${v.lat.toFixed(1)}°`,
      ti: v.ti === null ? 'no data' : `${v.ti.toFixed(0)} tiu`,
      rad: `${v.rad.toFixed(0)} mSv/yr`,
    };
    return SCORING.CRITERIA.map(c => {
      const f = c.key === 'rad' ? SCORING.F.rad(v.elev) : SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      return `<div class="crit"><span>${c.label.split(' (')[0]}</span><div class="bar"><i style="width:${(f * 100).toFixed(0)}%;opacity:${0.35 + 0.65 * wn[c.key] / 0.5}"></i></div><span class="v ${cls}">${fmt[c.key]}</span></div>`;
    }).join('');
  }

  // share of cells in a candidate block whose 90th-pct slope is within the 5 deg landing limit
  function flatShare(cx, cy, size) {
    const h = size >> 1, lim = 5 / META.slope.scale; let n = 0, ok = 0;
    for (let y = cy - h; y < cy + h; y++) for (let x = cx - h; x < cx + h; x++) {
      if (y < 0 || y >= H) continue; n++; if (L.slope[y * W + (((x % W) + W) % W)] <= lim) ok++;
    }
    return n ? ok / n : 0;
  }

  function renderCandidates() {
    const ol = $('#candidates'); ol.innerHTML = '';
    if (!S.candidates.length) { ol.innerHTML = '<li class="help">No surface block satisfies active constraints.</li>'; return; }
    S.candidates.forEach((c, i) => {
      const v = blockValues(c.x, c.y, c.blockPx), nr = nearestRegion(v.lat, v.lon);
      const name = candidateName(v.lat, v.lon, nr);
      const ice = SCORING.calcIceAccess(v.ice, S.iceBand), flat = flatShare(c.x, c.y, c.blockPx);
      const li = document.createElement('li');
      li.className = 'card' + (S.selected && S.selected.cand === i ? ' active' : '');
      li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">0${i + 1}</span><span class="name">${escHtml(name)}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">HLS-2015 EZ</span>' : ''}</div><span class="score">${c.score.toFixed(2)}</span></div>
        <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ice: <b>${escHtml(ice.status.toLowerCase().replace('_', ' '))}</b> · ≤5° cells: <b>${(flat * 100).toFixed(0)}%</b>${c.robust != null ? ` · <span class="robust ${c.robust >= 0.8 ? 'ok' : c.robust >= 0.5 ? 'warn' : 'bad'}">ROBUST ${(c.robust * 100).toFixed(0)}%</span>` : ''}</div>${critRows(v, S.weights)}
        <a class="trek" href="${escHtml(trekUrl(v.lat, v.lon))}" target="_blank" rel="noopener">Inspect in NASA Mars Trek (HiRISE / CTX) →</a>`;
      const trekLink = li.querySelector('.trek');
      if (trekLink) trekLink.onclick = (e) => e.stopPropagation();
      li.onclick = () => {
        select(c.x, c.y, i);
        if (S.viewMode === '3d' && globe) { globe.flyTo(v.lat, v.lon); schedule3D(); }
        if (S.mode === 'crisis') setCrisisSite(c.x, c.y);
      };
      ol.appendChild(li);
    });
  }
  function renderDetail(x, y, cand) {
    const v = cellValues(x, y), s = S.score[y * W + x], nr = nearestRegion(v.lat, v.lon);
    const passElev = v.elev <= SCORING.HARD.elevMax;
    const passSlope = v.slope <= SCORING.HARD.slopeMax;
    const passLat = Math.abs(v.lat) <= SCORING.HARD.latMax;
    const vetoed = S.hard && (!passElev || !passSlope || !passLat);
    const ice = SCORING.calcIceAccess(v.ice, S.iceBand);
    const sTemp = STORM.surfaceTempC(v.lat, S.crisis.ls);
    const pTherm = STORM.thermalDemandKw(v.lat, S.crisis.ls);
    const terrain = SCORING.calcTerrainClass(v.slope, v.rough);
    const spe = SCORING.calcSPE(v.elev, 1.5);

    $('#detail').innerHTML = `
      <div class="detail-header">
        <div>
          <div class="hint">Composite suitability</div>
          <div class="big">${s.toFixed(3)}</div>
        </div>
        <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${vetoed ? 'Vetoed' : 'Within constraints'}</span>
      </div>
      <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${nr.distDeg < 6 ? escHtml(nr.region.name) : 'near ' + escHtml(nr.region.name)} · ${(nr.distDeg * 59.3).toFixed(0)} km</div>
      <div class="hls-checks">
        <div class="hls-check"><span class="hint">Elevation ≤ +2 km</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? 'pass' : 'veto'}</b></div>
        <div class="hls-check"><span class="hint">Slope ≤ 15°</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? 'pass' : 'veto'}</b></div>
        <div class="hls-check"><span class="hint">Latitude ≤ 50°</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? 'pass' : 'veto'}</b></div>
      </div>
      ${critRows(v, S.weights)}
      <table>
        <tr><td>MOLA Elevation</td><td>${v.elev.toFixed(0)} m</td></tr>
        <tr><td>MOLA 90th-pct Slope</td><td>${v.slope.toFixed(1)}°</td></tr>
        <tr><td>SWIM Ice (${$('#iceband .active').textContent})</td><td>${v.ice === null ? 'outside ±60°' : v.ice.toFixed(2)}</td></tr>
        <tr><td>Ice access (${ice.depth})</td><td><b>${ice.label}</b></td></tr>
        <tr><td>Excavation for crew water</td><td>${ice.regolithKgSol === null ? '—' : `~${ice.regolithKgSol} kg regolith/sol <small>(assumes ${ice.assumption}; SWIM does not measure concentration)</small>`}</td></tr>
        <tr><td>Sub-cell Roughness (σ)</td><td>${v.rough.toFixed(0)} m</td></tr>
        <tr><td>Regional terrain class</td><td><b class="${terrain.terrainClass === 'RUGGED' ? 'bad' : terrain.terrainClass === 'MODERATE' ? 'warn' : 'ok'}">${terrain.label}</b></td></tr>
        <tr><td>Ellipse-scale hazards</td><td><small>${terrain.recommendation}</small></td></tr>
        <tr><td>TES Thermal Inertia</td><td>${v.ti === null ? 'no data' : v.ti.toFixed(0) + ' J m⁻² K⁻¹ s⁻½'}</td></tr>
        <tr><td>TES Dust Abundance</td><td>${v.dust === null ? 'no data' : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
        <tr><td>Atmospheric Column</td><td>${SCORING.atmoColumnGcm2(v.elev).toFixed(1)} g/cm²</td></tr>
        <tr><td>GCR Dose (MSL-RAD)</td><td>${SCORING.radDoseMsvYr(v.elev).toFixed(0)} mSv/yr</td></tr>
        <tr><td>Design-basis SPE (assumption)</td><td>${spe.unshieldedDoseMsv} mSv on the surface · ${spe.requiredRegolithM} m regolith for ≤ 100 mSv</td></tr>
        <tr><td>Surface temp. (approx.)</td><td>night ${sTemp.night.toFixed(0)} °C · mean ${sTemp.mean.toFixed(0)} °C</td></tr>
        <tr><td>Habitat heat loss</td><td>${pTherm} kW (covered by waste heat of the electrical load first)</td></tr>
      </table>
      <div class="row">
        <button id="use-route" class="ghost">Start a route here</button>
        <button id="use-crisis" class="ghost">Use in storm model</button>
      </div>`;
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
    if (!r.start) { el.innerHTML = '<div class="verdict">Choose a start point on the map.</div>'; return; }
    if (!r.goal) { el.innerHTML = '<div class="verdict">Now choose the destination.</div>'; return; }
    if (!r.safe || !r.safe.ok) { el.innerHTML = `<div class="verdict bad">No slope-safe route found (${r.safe ? r.safe.reason : ''}). Increase slope threshold or relocate target.</div>`; return; }
    const a = r.straight.stats, b = r.safe.stats, sols = (km) => (km / r.speed).toFixed(0);
    const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
    const havens = b.safeHavens || [];
    const havenStr = havens.length ? havens.map(h => `${h.name} (${h.km}km · sol ${Math.round(h.km / r.speed)})`).join(', ') : 'None detected';

    el.innerHTML = `<table class="stat-table"><tr><th>Metric</th><th class="straight">Direct</th><th class="safe">A* Safe</th></tr>
      <tr><td>Total Distance</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
      <tr><td>Peak Slope</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
      <tr><td>Mean Slope</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}°</td></tr>
      <tr><td>Distance &gt;10° Slope</td><td>${a.hazardKm.toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} km</td></tr>
      <tr><td>Low-TI Dust (&lt;100 tiu)</td><td>${(a.dustKm || 0).toFixed(0)} km</td><td>${(b.dustKm || 0).toFixed(0)} km</td></tr>
      <tr><td>Candidate rest stops</td><td>—</td><td><b>${havens.length}</b> (flat, smooth, firm)</td></tr>
      <tr><td>Traverse Duration</td><td>${sols(a.km)} sols</td><td>${sols(b.km)} sols</td></tr></table>
      <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? `Direct path crosses ${a.maxSlope.toFixed(1)}° terrain (limit ${r.maxSlope}° limit). The safe route adds ${(b.km - a.km).toFixed(0)} km.` : 'NOMINAL // Direct path satisfies maximum slope constraint.'}</div>
      ${havens.length ? `<div class="help haven-note"><b>REST STOPS (TERRAIN ONLY, NO SHELTER IMPLIED)</b>${escHtml(havenStr)}</div>` : ''}
      <div class="hint mt-sm">Elevation profile along the safe route · solved in ${r.ms.toFixed(0)} ms, ${r.safe.path.length} cells</div>${profileSVG(b.profile)}`;
  }
  // ------------------------------------------------------------ crisis
  function setCrisisSite(x, y) { S.crisis.site = { x, y }; runCrisis(); draw(); }
  function runCrisis() {
    const c = S.crisis, el = $('#crisis-summary');
    if (!c.site) { $('#crisis-site').textContent = 'Choose a site on the map'; el.innerHTML = ''; return; }
    const v = cellValues(c.site.x, c.site.y), nr = nearestRegion(v.lat, v.lon);
    $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name} · ${fmtLat(v.lat)}, ${fmtLon(v.lon)}`;
    const res = STORM.simulate({ lat: v.lat, ls: c.ls, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
      storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
    const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, 0.5, c.ls), peakSolar = c.area * 0.2 * STORM.dailySolar(v.lat, c.tauPeak, c.ls);
    const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
    const sTemp = STORM.surfaceTempC(v.lat, c.ls);
    const pTherm = STORM.thermalDemandKw(v.lat, c.ls);
    const spe = SCORING.calcSPE(v.elev, c.regolith || 1.5);

    const verdict = res.blackoutSol !== null
      ? `<div class="summary-big bad">Blackout on sol ${res.blackoutSol}</div><div class="help">Battery reserve exhausted ${res.blackoutSol - 20} sols after storm onset. Peak-storm generation ${(peakSolar + nuc).toFixed(0)} kWh/sol vs load ${c.cons} kWh/sol.</div>`
      : `<div class="summary-big ok">Survives the storm</div><div class="help">Minimum battery reserve ${res.minBatt.toFixed(0)} kWh (${(100 * res.minBatt / c.batt).toFixed(0)}%). Net balance at peak attenuation: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.</div>`;

    const thermVerdict = res.freezeSol !== null
      ? `<div class="summary-big bad mt-sm">Habitat interior below 0 °C on sol ${res.freezeSol}</div><div class="help">Not enough heat once power is short; interior falls toward ambient (minimum ${res.minHabTemp}°C).</div>`
      : `<div class="summary-big ok mt-sm">Thermal Life Support Maintained</div><div class="help">Internal habitat comfort (+20°C) sustained throughout storm (night ambient drops to ${sTemp.night}°C).</div>`;

    const liveSpace = window.MDE_LIVE_STATE && window.MDE_LIVE_STATE.space;
    const liveCmeRow = liveSpace && liveSpace.mode === 'live'
      ? `<div class="kv"><span>DONKI CMEs (30d · live)</span><b>${liveSpace.events.length} catalogued</b></div>`
      : '';

    el.innerHTML = `${verdict}
      ${thermVerdict}
      <div class="kv"><span>Season (L<sub>s</sub> = ${c.ls}°)</span><b>${escHtml(STORM.seasonName(c.ls))}</b></div>
      <div class="kv"><span>Surface temp. (approx.)</span><b>night ${sTemp.night}°C · mean ${sTemp.mean}°C</b></div>
      <div class="kv"><span>Habitat heat loss</span><b>${pTherm} kW · extra heaters ${Math.max(...res.rows.map(r => r.heater)).toFixed(0)} kWh/sol max</b></div>
      <div class="kv"><span>Clear-sky solar, τ 0.5</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
      <div class="kv"><span>Peak-storm solar, τ ${c.tauPeak.toFixed(1)}</span><b>${peakSolar.toFixed(0)} kWh/sol (−${res.peakSolarDropPct.toFixed(0)}%)</b></div>
      <div class="kv"><span>Panel dust after ${res.rows.length} sols</span><b>−${res.postStormSolarLossPct}% (no cleaning events assumed)</b></div>
      <div class="kv"><span>Kilopower baseload</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
      <div class="kv kv-top"><span>Design-basis SPE on surface</span><b>${spe.unshieldedDoseMsv} mSv</b></div>
      <div class="kv"><span>Shielded (${(c.regolith || 1.5).toFixed(1)}m regolith)</span><b class="${spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad'}">${spe.shieldedDoseMsv} mSv (${escHtml(spe.survivalStatus)})</b></div>
      <div class="kv"><span>Regolith for ≤ 100 mSv</span><b>${spe.requiredRegolithM} m</b></div>
      <div class="help note-sm">SPE figures use an assumed August-1972-class event (~1 Sv behind 5 g/cm²), not a forecast. Largest SPE measured on the surface so far (Sept 2017, MSL/RAD): ~0.4 mGy.</div>
      ${liveCmeRow}
      ${crisisSVG(res.rows, c.batt)}
      <div class="help mt-sm">Profile: Sol 20 onset · 10-sol ramp · 40-sol plateau · 30-sol decay. ${c.kp === 0 && res.blackoutSol !== null ? 'Add fission power (Kilopower-class, 10 kWe design target) to keep the load and heating running.' : ''}</div>`;
  }
  // ------------------------------------------------------------ UI wiring
  function updateHudLayer() {
    const el = $('#hud-layer');
    if (el) el.textContent = `Overlay · ${(OVERLAY_NAMES[S.overlay] || S.overlay).toLowerCase()}`;
  }

  function setHudHint(text, isWarn) {
    const el = $('#hud-hint');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('warn', !!isWarn);
  }
  if (!globe && $('#btn-3d')) {
    $('#btn-3d').setAttribute('aria-disabled', 'true');
    $('#btn-3d').title = '3D Globe unavailable (WebGL disabled or unsupported)';
  }
  if (globe) {
    globe.state.onContextLost = () => setHudHint('WebGL context lost — restoring 3D globe…', true);
    globe.state.onContextRestored = () => {
      ovDirty = true;
      buildOverlay();
      setHudHint(S.viewMode === '3d' ? 'Drag to orbit · scroll to zoom · click to inspect' : 'Drag to pan · scroll to zoom · click to inspect', false);
      schedule3D();
    };
  }

  function setViewMode(vm) {
    if (vm === '3d' && !globe) {
      setHudHint('3D globe unavailable (WebGL disabled) — staying in 2D map view', true);
      return;
    }
    S.viewMode = vm;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === vm));
    if (globeCanvas) globeCanvas.classList.toggle('hidden', vm !== '3d');
    if ($('#globe-tools')) $('#globe-tools').classList.toggle('hidden', vm !== '3d');
    if ($('#hud-proj')) $('#hud-proj').textContent = vm === '3d' ? 'Globe · MOLA relief' : 'Map · equirectangular';
    setHudHint(vm === '3d' ? 'Drag to orbit · scroll to zoom · click to inspect' : 'Drag to pan · scroll to zoom · click to inspect', false);
    if (vm === '3d' && globe) {
      if (S.selected) {
        globe.flyTo(L.latOfRow(S.selected.y), L.lonOfCol(S.selected.x));
      } else if (S.candidates.length) {
        const c = S.candidates[0];
        globe.flyTo(L.latOfRow(c.y), L.lonOfCol(c.x));
      }
      schedule3D();
    }
    updateScaleBar();
    draw();
  }
  document.querySelectorAll('.view-btn').forEach(b => b.onclick = () => setViewMode(b.dataset.view));

  if ($('#btn-relief') && globe) {
    const levels = [1, 5, 8, 15];
    $('#btn-relief').onclick = () => {
      const idx = (levels.indexOf(globe.state.exaggeration) + 1) % levels.length;
      globe.state.exaggeration = levels[idx];
      $('#btn-relief').textContent = `Relief ${levels[idx]}×`;
      draw();
    };
  }
  if ($('#btn-ov3d') && globe) {
    $('#btn-ov3d').onclick = () => {
      S.globeOverlay = !S.globeOverlay;
      $('#btn-ov3d').classList.toggle('active', S.globeOverlay);
      $('#btn-ov3d').textContent = S.globeOverlay ? 'Overlay on' : 'Overlay off';
      draw();
    };
  }
  if ($('#btn-sun') && globe) {
    $('#btn-sun').onclick = () => {
      globe.state.sunLight = !globe.state.sunLight;
      $('#btn-sun').classList.toggle('active', globe.state.sunLight);
      draw();
    };
  }
  if ($('#btn-spin') && globe) {
    $('#btn-spin').onclick = () => {
      globe.state.autoSpin = !globe.state.autoSpin;
      $('#btn-spin').classList.toggle('active', globe.state.autoSpin);
      if (globe.state.autoSpin) schedule3D();
    };
  }

  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    for (const k of ['score', 'route', 'crisis', 'habitability']) {
      const p = $('#panel-' + k);
      if (p) p.classList.toggle('hidden', k !== m);
    }
    if (m === 'route') { S.overlay = 'slope'; } else if (m === 'score') { S.overlay = 'score'; }
    document.querySelectorAll('#overlay button').forEach(b => b.classList.toggle('active', b.dataset.ov === S.overlay));
    updateHudLayer();
    ovDirty = true; renderLegend();
    if (m === 'route') renderRoute();
    if (m === 'crisis') runCrisis();
    if (m === 'habitability') renderHabitability();
    draw();
  }
  document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  function buildPresets() {
    const el = $('#presets'); el.innerHTML = '';
    for (const k in SCORING.PRESETS) {
      const p = SCORING.PRESETS[k], b = document.createElement('button');
      b.className = 'preset' + (S.preset === k ? ' active' : '');
      const code = PRESET_CODES[k] || k.toUpperCase();
      b.innerHTML = `<span class="p-code">${code}</span><span class="p-name">${p.name}</span><small>${Object.values(p.w).map(v => (v * 100).toFixed(0)).join('·')}</small>`;
      b.onclick = () => { S.preset = k; S.weights = { ...p.w }; buildPresets(); buildSliders(); rescore(); };
      el.appendChild(b);
    }
  }
  function buildSliders() {
    const el = $('#sliders'); el.innerHTML = '';
    const wn = SCORING.normalize(S.weights);
    for (const c of SCORING.CRITERIA) {
      const d = document.createElement('div'); d.className = 'slider';
      const tag = CRIT_TAGS[c.key] || c.key.toUpperCase();
      d.innerHTML = `<div class="lbl"><span class="lbl-left"><span class="crit-tag">${tag}</span><span>${c.label}</span></span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}">`;
      d.querySelector('input').oninput = (e) => { S.weights[c.key] = +e.target.value / 100; S.preset = null; buildPresets();
        const n = SCORING.normalize(S.weights); el.querySelectorAll('.slider').forEach((s, i) => s.querySelector('b').textContent = (n[SCORING.CRITERIA[i].key] * 100).toFixed(0) + '%'); rescore(); };
      el.appendChild(d);
    }
  }
  $('#hard').onchange = (e) => { S.hard = e.target.checked; rescore(); };
  if ($('#agg-geo')) $('#agg-geo').onchange = (e) => { S.agg = e.target.checked ? 'geo' : 'sum'; rescore(); };
  document.querySelectorAll('#iceband button').forEach(b => b.onclick = async () => {
    document.querySelectorAll('#iceband button').forEach(x => x.classList.toggle('active', x === b));
    S.iceBand = b.dataset.band;
    if (!L[S.iceBand]) await decode(S.iceBand);
    rescore();
  });
  document.querySelectorAll('#overlay button').forEach(b => b.onclick = () => { document.querySelectorAll('#overlay button').forEach(x => x.classList.toggle('active', x === b)); S.overlay = b.dataset.ov; updateHudLayer(); ovDirty = true; renderLegend(); draw(); });
  $('#opacity').oninput = (e) => { S.opacity = +e.target.value / 100; const vEl = $('#opacity-v'); if (vEl) vEl.textContent = e.target.value + '%'; draw(); };
  $('#show-regions').onchange = (e) => { S.showRegions = e.target.checked; draw(); };
  $('#show-ez').onchange = (e) => { S.showEZ = e.target.checked; draw(); };
  const bindRange = (id, fmt, cb) => { const el = $('#' + id); if (!el) return; const upd = () => { const vEl = $('#' + id + '-v'); if (vEl) vEl.textContent = fmt(+el.value); cb(+el.value); }; el.oninput = upd; upd(); };
  if ($('#sens-run')) $('#sens-run').onclick = runSensitivity;
  bindRange('sens', v => '±' + v + '%', v => { S.sensSpread = v / 100; });
  bindRange('maxslope', v => v + '°', v => { S.route.maxSlope = v; computeRoute(); });
  bindRange('kslope', v => (v / 100).toFixed(2), v => { S.route.k = v / 100; computeRoute(); });
  bindRange('speed', v => v + ' km/sol', v => { S.route.speed = v; renderRoute(); });
  $('#route-clear').onclick = () => { S.route.start = S.route.goal = S.route.safe = S.route.straight = null; renderRoute(); draw(); };
  const routeDemoBtn = $('#route-demo');
  if (routeDemoBtn) {
    routeDemoBtn.onclick = () => {
      const a = REGIONS[0], b = REGIONS[16];
      S.route.start = { x: L.colOfLon(a.lon), y: L.rowOfLat(a.lat) };
      S.route.goal = { x: L.colOfLon(b.lon), y: L.rowOfLat(b.lat) };
      if (S.viewMode === '3d' && globe) {
        globe.flyTo((a.lat + b.lat) / 2, (a.lon + b.lon) / 2, 1.85);
        schedule3D();
      } else {
        S.view.scale = Math.max(S.view.scale, 3.2);
        S.view.tx = canvas.width / 2 - (S.route.start.x + S.route.goal.x) / 2 * S.view.scale;
        S.view.ty = canvas.height / 2 - (S.route.start.y + S.route.goal.y) / 2 * S.view.scale;
        wrapView(); updateScaleBar();
      }
      computeRoute();
    };
  }
  if ($('#ls')) {
    bindRange('ls', v => `${v}° · ${STORM.seasonName(v).split(' /')[0]}`, v => { S.crisis.ls = v; runCrisis(); });
  }
  bindRange('tau', v => (v / 10).toFixed(1), v => { S.crisis.tauPeak = v / 10; runCrisis(); });
  bindRange('area', v => v + ' m²', v => { S.crisis.area = v; runCrisis(); });
  bindRange('cons', v => v + ' kWh/sol', v => { S.crisis.cons = v; runCrisis(); });
  bindRange('batt', v => v + ' kWh', v => { S.crisis.batt = v; runCrisis(); });
  bindRange('kp', v => String(v), v => { S.crisis.kp = v; runCrisis(); });
  if ($('#rego')) {
    bindRange('rego', v => (v / 10).toFixed(1) + ' m', v => { S.crisis.regolith = v / 10; runCrisis(); });
  }
  let activeModal = null, lastFocusedEl = null;
  function openModal(modal, focusSel) {
    if (!modal) return;
    lastFocusedEl = document.activeElement;
    activeModal = modal;
    modal.classList.remove('hidden');
    const target = focusSel ? modal.querySelector(focusSel) : modal.querySelector('.modal-close');
    if (target) target.focus();
  }
  function closeModal(modal) {
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (activeModal === modal) activeModal = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
    lastFocusedEl = null;
  }

  $('#btn-about').onclick = () => openModal($('#about'), '#about-close');
  $('#about-close').onclick = () => closeModal($('#about'));
  $('#about').onclick = (e) => { if (e.target.id === 'about') closeModal($('#about')); };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal($('#about'));
      closeModal($('#brief-modal'));
      return;
    }
    if (e.key === 'Tab' && activeModal && !activeModal.classList.contains('hidden')) {
      const focusables = [...activeModal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ------------------------------------------------------------ Mission Brief Exporter (delegated to ui/brief.js)
  const getBriefPayload = () => buildBriefPayload({ S, W, L, META, flatShare, cellValues, blockValues, nearestRegion });
  function openBriefModal() {
    const modal = $('#brief-modal'), body = $('#brief-body');
    if (!modal || !body) return;
    body.innerHTML = renderBriefHTML(getBriefPayload());
    openModal(modal, '#brief-close');
  }

  if ($('#btn-export')) $('#btn-export').onclick = openBriefModal;
  if ($('#brief-close')) $('#brief-close').onclick = () => closeModal($('#brief-modal'));
  if ($('#brief-modal')) $('#brief-modal').onclick = (e) => { if (e.target.id === 'brief-modal') closeModal($('#brief-modal')); };
  if ($('#btn-dl-json')) $('#btn-dl-json').onclick = () => downloadBriefJSON(getBriefPayload());
  if ($('#btn-print-brief')) $('#btn-print-brief').onclick = () => window.print();

  // Map zoom buttons
  const zoomBy = (factor) => {
    if (S.viewMode === '3d' && globe) {
      globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist / factor));
      schedule3D();
      return;
    }
    const mx = canvas.width / 2, my = canvas.height / 2;
    const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
    const ns = Math.max(minS, Math.min(40, S.view.scale * factor));
    const k = ns / S.view.scale;
    S.view.tx = mx - (mx - S.view.tx) * k;
    S.view.ty = my - (my - S.view.ty) * k;
    S.view.scale = ns;
    wrapView(); updateScaleBar(); draw();
  };
  if ($('#zoom-in')) $('#zoom-in').onclick = () => zoomBy(1.4);
  if ($('#zoom-out')) $('#zoom-out').onclick = () => zoomBy(1 / 1.4);
  if ($('#zoom-reset')) $('#zoom-reset').onclick = () => { fitView(); draw(); };

  const fly = $('#flyto');
  REGIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const o = document.createElement('option');
    o.value = r.name;
    o.textContent = (r.ez ? '[EZ] ' : '') + r.name;
    fly.appendChild(o);
  });
  fly.onchange = () => {
    const r = REGIONS.find(q => q.name === fly.value); if (!r) return;
    const x = L.colOfLon(r.lon), y = L.rowOfLat(r.lat);
    if (S.viewMode === '3d' && globe) {
      globe.flyTo(r.lat, r.lon, Math.min(globe.state.targetDist, 1.95));
      schedule3D();
    } else {
      S.view.scale = Math.max(S.view.scale, 3.2);
      S.view.tx = canvas.width / 2 - x * S.view.scale;
      S.view.ty = canvas.height / 2 - y * S.view.scale;
      wrapView(); updateScaleBar();
    }
    select(x, y, null);
    fly.value = '';
  };

  function renderLegend() {
    const el = $('#legend');
    if (el) el.innerHTML = renderLegendHTML(S.overlay);
  }

  // ------------------------------------------------------------ map interaction (2D & 3D)
  function stopAutoSpin() {
    if (globe && globe.state.autoSpin) {
      globe.state.autoSpin = false;
      if ($('#btn-spin')) $('#btn-spin').classList.remove('active');
    }
  }
  function pickAt(clientX, clientY) {
    const g = gridAt({ clientX, clientY }); if (!g) return;
    const [x, y] = g;
    if (S.mode === 'route') {
      const r = S.route;
      if (!r.start || (r.start && r.goal)) { r.start = { x, y }; r.goal = null; r.safe = r.straight = null; } else { r.goal = { x, y }; }
      renderRoute(); if (r.goal) computeRoute(); draw(); return;
    }
    if (S.mode === 'crisis') setCrisisSite(x, y);
    select(x, y, null);
  }

  let drag = null, moved = false, lastTouchTap = 0;
  canvas.addEventListener('mousedown', (e) => {
    drag = {
      x: e.clientX, y: e.clientY,
      tx: S.view.tx, ty: S.view.ty,
      rLat: globe ? globe.state.targetLat : 0,
      rLon: globe ? globe.state.targetLon : 0,
    };
    moved = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) * devicePixelRatio, dy = (e.clientY - drag.y) * devicePixelRatio;
    if (Math.hypot(dx, dy) > 3) moved = true;
    if (S.viewMode === '3d' && globe) {
      const sens = 0.14 * (globe.state.camDist - 0.85) / (window.devicePixelRatio || 1);
      globe.state.targetLon = drag.rLon - dx * sens;
      globe.state.targetLat = Math.max(-82, Math.min(82, drag.rLat + dy * sens));
      stopAutoSpin();
      schedule3D();
    } else {
      S.view.tx = drag.tx + dx; S.view.ty = drag.ty + dy; wrapView(); draw();
    }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('click', (e) => {
    if (moved || performance.now() - lastTouchTap < 450) return;
    pickAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (S.viewMode === '3d' && globe) {
      const f = Math.exp(e.deltaY * 0.0012);
      globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist * f));
      schedule3D();
      return;
    }
    const r = canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * devicePixelRatio, my = (e.clientY - r.top) * devicePixelRatio;
    const f = Math.exp(-e.deltaY * 0.0015), minS = Math.min(canvas.width / W, canvas.height / H) * 0.9, ns = Math.max(minS, Math.min(40, S.view.scale * f));
    const k = ns / S.view.scale; S.view.tx = mx - (mx - S.view.tx) * k; S.view.ty = my - (my - S.view.ty) * k; S.view.scale = ns; wrapView(); updateScaleBar(); draw();
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    const g = gridAt(e), tip = $('#tooltip');
    if (!g) { tip.classList.add('hidden'); return; }
    const [x, y] = g, v = cellValues(x, y), s = S.score[y * W + x], nr = nearestRegion(v.lat, v.lon);
    $('#hud-coord').textContent = `LAT ${fmtLat(v.lat)} · LON ${fmtLon(v.lon)} · ELEV ${v.elev.toFixed(0)} m · SLOPE ${v.slope.toFixed(1)}° · SCORE ${s.toFixed(2)}` + ($('#hud-coord').dataset.t ? ` · ${$('#hud-coord').dataset.t} ms` : '');
    tip.innerHTML = `<span class="tt-region">${escHtml(nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name)}</span><b>${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))}</b> · score <b>${s.toFixed(2)}</b><br>elev ${v.elev.toFixed(0)} m · slope ${v.slope.toFixed(1)}°<br>rad ${v.rad.toFixed(0)} mSv/yr · ice ${v.ice === null ? '—' : v.ice.toFixed(2)}<br>rough ${v.rough.toFixed(0)} m · TI ${v.ti === null ? '—' : v.ti.toFixed(0)} · dust ${v.dust === null ? '—' : (v.dust * 100).toFixed(0) + '%'}`;
    const r = canvas.getBoundingClientRect();
    const tx = Math.min(r.width - 210, e.clientX - r.left + 14);
    const ty = Math.min(r.height - 95, e.clientY - r.top + 14);
    tip.style.left = Math.max(8, tx) + 'px';
    tip.style.top = Math.max(8, ty) + 'px';
    tip.classList.remove('hidden');
  });
  canvas.addEventListener('mouseleave', () => $('#tooltip').classList.add('hidden'));

  function handleCanvasKey(e) {
    const panStep = 80 * (window.devicePixelRatio || 1);
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.3); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.3); return; }
    if (e.key === '0') { e.preventDefault(); fitView(); draw(); return; }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const dx = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (S.viewMode === '3d' && globe) {
      globe.state.targetLon -= dx * 12;
      globe.state.targetLat = Math.max(-82, Math.min(82, globe.state.targetLat - dy * 10));
      stopAutoSpin();
      schedule3D();
    } else {
      S.view.tx += dx * panStep;
      S.view.ty += dy * panStep;
      wrapView(); draw();
    }
  }
  canvas.addEventListener('keydown', handleCanvasKey);
  if (globeCanvas) globeCanvas.addEventListener('keydown', handleCanvasKey);

  // Touch gestures (1-finger pan/orbit & tap, 2-finger pinch-to-zoom)
  let touchState = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchState = {
        mode: 'drag', x: t.clientX, y: t.clientY, moved: false,
        tx: S.view.tx, ty: S.view.ty,
        rLat: globe ? globe.state.targetLat : 0, rLon: globe ? globe.state.targetLon : 0,
      };
    } else if (e.touches.length === 2) {
      const [t1, t2] = e.touches, rect = canvas.getBoundingClientRect();
      const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) * devicePixelRatio;
      const my = ((t1.clientY + t2.clientY) / 2 - rect.top) * devicePixelRatio;
      touchState = {
        mode: 'pinch', moved: true,
        dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1,
        scale: S.view.scale, tx: S.view.tx, ty: S.view.ty, mx, my,
        camDist: globe ? globe.state.targetDist : 2.55,
      };
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchState) return;
    e.preventDefault();
    if (touchState.mode === 'drag' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = (t.clientX - touchState.x) * devicePixelRatio, dy = (t.clientY - touchState.y) * devicePixelRatio;
      if (Math.hypot(dx, dy) > 6) touchState.moved = true;
      if (S.viewMode === '3d' && globe) {
        const sens = 0.14 * (globe.state.camDist - 0.85) / (window.devicePixelRatio || 1);
        globe.state.targetLon = touchState.rLon - dx * sens;
        globe.state.targetLat = Math.max(-82, Math.min(82, touchState.rLat + dy * sens));
        stopAutoSpin();
        schedule3D();
      } else {
        S.view.tx = touchState.tx + dx; S.view.ty = touchState.ty + dy; wrapView(); draw();
      }
    } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
      const [t1, t2] = e.touches, rect = canvas.getBoundingClientRect();
      const d = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
      const ratio = d / touchState.dist;
      if (S.viewMode === '3d' && globe) {
        globe.state.targetDist = Math.max(1.22, Math.min(4.6, touchState.camDist / ratio));
        schedule3D();
      } else {
        const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) * devicePixelRatio;
        const my = ((t1.clientY + t2.clientY) / 2 - rect.top) * devicePixelRatio;
        const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
        const ns = Math.max(minS, Math.min(40, touchState.scale * ratio));
        const k = ns / touchState.scale;
        S.view.scale = ns;
        S.view.tx = mx - (touchState.mx - touchState.tx) * k;
        S.view.ty = my - (touchState.my - touchState.ty) * k;
        wrapView(); updateScaleBar(); draw();
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (touchState && touchState.mode === 'drag' && !touchState.moved && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      lastTouchTap = performance.now();
      pickAt(t.clientX, t.clientY);
    }
    if (e.touches.length === 0) touchState = null;
  });
  function gridAt(e) {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * devicePixelRatio;
    const sy = (e.clientY - r.top) * devicePixelRatio;
    if (S.viewMode === '3d' && globe) {
      const hit = globe.unproject(sx, sy);
      return hit ? [hit[0], hit[1]] : null;
    }
    let [gx, gy] = toGrid(sx, sy);
    gx = ((Math.floor(gx) % W) + W) % W; gy = Math.floor(gy);
    if (gy < 0 || gy >= H) return null; return [gx, gy];
  }
  function wrapView() { const span = W * S.view.scale; while (S.view.tx > span) S.view.tx -= span; while (S.view.tx < -span) S.view.tx += span;
    const maxTy = canvas.height * 0.5, minTy = canvas.height * 0.5 - H * S.view.scale; S.view.ty = Math.max(minTy, Math.min(maxTy, S.view.ty)); }

  // range track fill (CSS --p) for every slider, now and whenever one changes
  function syncRanges(root) { root.querySelectorAll('input[type=range]').forEach(r => { const p = (r.value - r.min) / (r.max - r.min) * 100; r.style.setProperty('--p', p + '%'); }); }
  document.addEventListener('input', (e) => { if (e.target.type === 'range') syncRanges(e.target.parentElement); });
  new MutationObserver(() => syncRanges(document)).observe(document.body, { childList: true, subtree: true });
  syncRanges(document);

  // ------------------------------------------------------------ boot
  function ensureFileDataBundle() {
    if (window.LAYER_DATA || location.protocol !== 'file:') return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'layers_data.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('Failed to load offline bundle layers_data.js'));
      document.head.appendChild(s);
    });
  }

  function loadVikingMosaic() {
    return new Promise((res, rej) => {
      const hi = new Image();
      hi.onload = () => {
        baseImg = hi;
        try { if (globe && L.elev) globe.setBaseTexture(hi); } catch (e) { /* ignore tainted fallback */ }
        res(hi);
      };
      hi.onerror = () => rej(new Error('viking_4k.jpg unavailable'));
      hi.src = 'layers/viking_4k.jpg';
    });
  }

  function loadHiResBase() {
    loadVikingMosaic().then(() => draw()).catch(() => {});
  }

  buildPresets(); buildSliders(); renderLegend(); renderRoute();
  initHabitabilityAPI({ onLiveUpdate: () => { if (S.mode === 'crisis') runCrisis(); } });

  ensureFileDataBundle().then(() => {
    const isFile = location.protocol === 'file:' && !!window.LAYER_DATA;
    const coreKeys = ['elev', 'slope', 'rough', S.iceBand, 'ti', 'dust'];
    if (isFile) {
      return Promise.all([...coreKeys, 'ice01', 'ice5', 'base'].map(decode)).then(() => {
        if (globe) globe.setLayers(baseImg, L.elev, W, H);
        loadHiResBase();
      });
    }
    // HTTP(S): stream compact PNG grids + 4K Viking imagery directly without parsing 12 MB layers_data.js
    const basePromise = loadVikingMosaic().catch(() => decode('base'));
    return Promise.all([...coreKeys.map(decode), basePromise]).then(() => {
      if (globe) globe.setLayers(baseImg, L.elev, W, H);
      setTimeout(() => {
        ['ice01', 'ice5'].forEach(k => { if (!L[k]) decode(k).catch(() => {}); });
      }, 300);
    });
  }).then(() => {
    L.ice = L[S.iceBand];
    window.addEventListener('resize', resize); resize();
    rescore();
    $('#loading').classList.add('hidden');
    applyDemoLink();
  }).catch(err => {
    const el = $('#loading');
    if (el) el.innerHTML = `<div class="loading-title">Failed to decode planetary layers</div><div class="loading-sub">${escHtml(err && err.message ? err.message : err)}</div>`;
  });

  // Deep links for the demo / presentation:
  //   ?preset=isru  ?view=3d  ?demo=route&from=Jezero&to=Nili   ?demo=crisis&site=Arcadia&tau=9&kp=1
  function applyDemoLink() {
    const q = new URLSearchParams(location.search);
    const find = (n) => n && REGIONS.find(r => r.name.toLowerCase().includes(n.toLowerCase()));
    if (q.get('view') === '3d') setViewMode('3d');
    if (q.get('preset') && SCORING.PRESETS[q.get('preset')]) { S.preset = q.get('preset'); S.weights = { ...SCORING.PRESETS[S.preset].w }; buildPresets(); buildSliders(); rescore(); }
    if (q.get('demo') === 'route') {
      const a = find(q.get('from')) || REGIONS[0], b = find(q.get('to')) || REGIONS[16];
      setMode('route'); S.route.start = { x: L.colOfLon(a.lon), y: L.rowOfLat(a.lat) }; S.route.goal = { x: L.colOfLon(b.lon), y: L.rowOfLat(b.lat) };
      let dx = Math.abs(S.route.goal.x - S.route.start.x); if (dx > W / 2) dx = W - dx; const dy = Math.abs(S.route.goal.y - S.route.start.y);
      const sc = Math.max(1, Math.min(canvas.width / (dx + 160), canvas.height / (dy + 160), 8));
      let cx = (S.route.start.x + S.route.goal.x) / 2; if (Math.abs(S.route.goal.x - S.route.start.x) > W / 2) cx = (cx + W / 2) % W;
      S.view.scale = sc; S.view.tx = canvas.width / 2 - cx * sc; S.view.ty = canvas.height / 2 - (S.route.start.y + S.route.goal.y) / 2 * sc; wrapView(); updateScaleBar();
      computeRoute();
    } else if (q.get('demo') === 'crisis') {
      const a = find(q.get('site')) || REGIONS[10];
      if (q.get('ls') && $('#ls')) { $('#ls').value = Math.max(0, Math.min(360, Math.round(+q.get('ls')))); $('#ls').oninput(); }
      if (q.get('tau')) { $('#tau').value = Math.round(+q.get('tau') * 10); $('#tau').oninput(); }
      if (q.get('kp')) { $('#kp').value = q.get('kp'); $('#kp').oninput(); }
      setMode('crisis'); setCrisisSite(L.colOfLon(a.lon), L.rowOfLat(a.lat));
    }
  }

  window.MDE = { L, S, globe, cellValues, rescore, setViewMode };
})();
