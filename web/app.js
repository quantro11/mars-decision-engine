// UI + rendering for the Mars Base Decision Engine. Pure logic lives in scoring.js / astar.js / storm.js.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
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
  };

  const OVERLAY_NAMES = {
    score: 'SUITABILITY SCORE',
    ice: 'SWIM 2.0 SUBSURFACE ICE',
    slope: 'MOLA 90TH-PCT SLOPE',
    elev: 'MOLA MEGDR ELEVATION',
    ti: 'TES THERMAL INERTIA',
    dust: 'TES DUST ABUNDANCE',
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
      ti: L.ti[i] === 0 ? null : L.ti[i] * META.ti.scale,
      dust: L.dust[i] === 0 ? null : META.dust.offset + L.dust[i] * META.dust.scale,
      lat: L.latOfRow(y), lon: L.lonOfCol(x),
    };
  }

  // mean physical values over a square block (used for candidate cards)
  function blockValues(cx, cy, size) {
    const h = size >> 1; let n = 0, e = 0, sl = 0, r = 0, ic = 0, nIce = 0, t = 0, nT = 0, du = 0, nD = 0;
    for (let y = cy - h; y < cy + h; y++) for (let x = cx - h; x < cx + h; x++) {
      if (y < 0 || y >= H) continue; const v = cellValues(((x % W) + W) % W, y);
      e += v.elev; sl += v.slope; r += v.rough; n++; if (v.ice !== null) { ic += v.ice; nIce++; }
      if (v.ti !== null) { t += v.ti; nT++; } if (v.dust !== null) { du += v.dust; nD++; }
    }
    return { elev: e / n, slope: sl / n, rough: r / n, ice: nIce ? ic / nIce : null, ti: nT ? t / nT : null, dust: nD ? du / nD : null, lat: L.latOfRow(cy), lon: L.lonOfCol(cx) };
  }

  // ------------------------------------------------------------ state
  const S = {
    viewMode: '2d', // '2d' | '3d'
    mode: 'score', preset: 'balanced', weights: { ...SCORING.PRESETS.balanced.w }, hard: true, iceBand: 'ice15',
    overlay: 'score', opacity: 0.45, showRegions: true, showEZ: false,
    view: { scale: 1, tx: 0, ty: 0 }, score: new Float32Array(W * H), candidates: [], selected: null,
    route: { start: null, goal: null, safe: null, straight: null, maxSlope: 15, k: 0.3, speed: 20 },
    crisis: { site: null, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0 },
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
    score: [[0, 14, 19, 34], [0.3, 30, 64, 130], [0.55, 16, 155, 165], [0.78, 245, 158, 11], [1, 254, 249, 195]],
    ice: [[0, 32, 26, 22], [0.5, 45, 95, 135], [1, 145, 228, 255]],
    slope: [[0, 22, 55, 38], [0.33, 65, 175, 95], [0.66, 245, 180, 35], [1, 239, 55, 55]],
    elev: [[0, 18, 38, 88], [0.3, 52, 118, 142], [0.5, 168, 148, 88], [0.7, 148, 78, 48], [1, 252, 252, 255]],
    ti: [[0, 115, 38, 22], [0.15, 195, 115, 38], [0.4, 75, 168, 95], [0.7, 56, 135, 215], [1, 238, 244, 255]],
    dust: [[0, 35, 55, 85], [0.5, 185, 145, 85], [1, 255, 228, 155]],
  };
  const LUT = {};
  for (const k in CMAP) { LUT[k] = new Uint8ClampedArray(256 * 3); for (let i = 0; i < 256; i++) { const c = lerpStops(CMAP[k], i / 255); LUT[k].set(c.map(Math.round), i * 3); } }

  function buildOverlay() {
    const d = ovImg.data, lut = LUT[S.overlay] || LUT.score;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      let v, a = 255;
      if (S.overlay === 'score') {
        const sc = S.score[i];
        const norm = Math.max(0, Math.min(1, (sc - 0.35) / 0.65));
        v = Math.round(norm * 255);
        a = sc <= 0 ? 28 : Math.round(65 + 190 * Math.pow(norm, 0.75));
      }
      else if (S.overlay === 'ice') { const r = L.ice[i]; if (r === 0) { v = 0; a = 0; } else v = Math.round(Math.max(0, Math.min(255, (r - 28) * 1.275))); }
      else if (S.overlay === 'slope') v = Math.min(255, L.slope[i] * 2);
      else if (S.overlay === 'elev') v = L.elev[i];
      else if (S.overlay === 'ti') { const r = L.ti[i]; if (r === 0) { v = 0; a = 0; } else v = Math.min(255, Math.round(r * 4 / 700 * 255)); }
      else if (S.overlay === 'dust') { const r = L.dust[i]; if (r === 0) { v = 0; a = 0; } else v = Math.min(255, Math.round((r - 1) * 1.275)); }
      else { d[j + 3] = 0; continue; }
      d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = a;
    }
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
      globe.render({ opacity: S.opacity, showOverlay: S.overlay !== 'none' });
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
        ctx.fillStyle = r.mission ? '#38bdf8' : 'rgba(226, 232, 240, 0.78)';
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
    if (S.route.start) drawWaypoint(S.route.start.x, S.route.start.y, '#10b981', 'WP-A');
    if (S.route.goal) drawWaypoint(S.route.goal.x, S.route.goal.y, '#f59e0b', 'WP-B');

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
        ctx.fillText(`HLS LIMIT ${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`, canvas.width - 115 * dpr, y0 - 4 * dpr);
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

  function drawCandidateReticle(gx, gy, rank, score, active) {
    const [x, y, vis] = projectGrid(gx, gy);
    if (!vis) return;
    const dpr = window.devicePixelRatio || 1;
    const r = (active ? 11 : 9) * dpr;
    const primary = active ? '#38bdf8' : '#fc3d21';

    ctx.strokeStyle = primary;
    ctx.lineWidth = (active ? 2 : 1.5) * dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    const tIn = r + 2 * dpr, tOut = r + 6 * dpr;
    ctx.beginPath();
    ctx.moveTo(x - tOut, y); ctx.lineTo(x - tIn, y);
    ctx.moveTo(x + tIn, y); ctx.lineTo(x + tOut, y);
    ctx.moveTo(x, y - tOut); ctx.lineTo(x, y - tIn);
    ctx.moveTo(x, y + tIn); ctx.lineTo(x, y + tOut);
    ctx.stroke();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(x, y, 2 * dpr, 0, Math.PI * 2);
    ctx.fill();

    const tag = `0${rank}`;
    ctx.font = `700 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
    const bx = x + r + 5 * dpr, by = y - r - 2 * dpr;
    const bw = 20 * dpr, bh = 13 * dpr;
    ctx.fillStyle = active ? '#38bdf8' : 'rgba(8, 12, 18, 0.92)';
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1 * dpr;
    ctx.fillRect(bx, by - bh / 2, bw, bh);
    ctx.strokeRect(bx, by - bh / 2, bw, bh);
    ctx.fillStyle = active ? '#04070b' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, bx + bw / 2, by + 0.5 * dpr);
    ctx.textAlign = 'left';
  }

  function drawSelectionReticle(gx, gy) {
    const [x, y, vis] = projectGrid(gx, gy);
    if (!vis) return;
    const dpr = window.devicePixelRatio || 1;
    const s = 9 * dpr, c = 4 * dpr;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s + c); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + c, y - s);
    ctx.moveTo(x + s - c, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + c);
    ctx.moveTo(x + s, y + s - c); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - c, y + s);
    ctx.moveTo(x - s + c, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y + s - c);
    ctx.stroke();
  }

  function drawWaypoint(gx, gy, color, label) {
    const [x, y, vis] = projectGrid(gx, gy);
    if (!vis) return;
    const dpr = window.devicePixelRatio || 1;
    const r = 6.5 * dpr;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(6, 9, 15, 0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    ctx.font = `700 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 10 * dpr, y);
  }

  function drawStationBeacon(gx, gy) {
    const [x, y, vis] = projectGrid(gx, gy);
    if (!vis) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, 11 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 ${Math.round(9 * dpr)}px "JetBrains Mono", monospace`;
    ctx.fillText('STA-PWR', x + 14 * dpr, y);
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
    const fmt = {
      elev: `${(v.elev / 1000).toFixed(1)} km`,
      slope: `${v.slope.toFixed(1)}°`,
      ice: v.ice === null ? 'NO DATA' : v.ice.toFixed(2),
      rough: `${v.rough.toFixed(0)} m`,
      lat: `${v.lat.toFixed(1)}°`,
      ti: v.ti === null ? 'NO DATA' : `${v.ti.toFixed(0)} tiu`,
    };
    return SCORING.CRITERIA.map(c => {
      const f = SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      return `<div class="crit"><span>${c.label.split(' (')[0]}</span><div class="bar"><i style="width:${(f * 100).toFixed(0)}%;opacity:${0.35 + 0.65 * wn[c.key] / 0.5}"></i></div><span class="v ${cls}">${fmt[c.key]}</span></div>`;
    }).join('');
  }

  function renderCandidates() {
    const ol = $('#candidates'); ol.innerHTML = '';
    if (!S.candidates.length) { ol.innerHTML = '<li class="help">No surface block satisfies active constraints.</li>'; return; }
    S.candidates.forEach((c, i) => {
      const v = blockValues(c.x, c.y, c.blockPx), nr = nearestRegion(v.lat, v.lon);
      const name = candidateName(v.lat, v.lon, nr);
      const li = document.createElement('li');
      li.className = 'card' + (S.selected && S.selected.cand === i ? ' active' : '');
      li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">CAND-0${i + 1}</span><span class="name">${name}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">HLS-2015 EZ</span>' : ''}</div><span class="score">${c.score.toFixed(2)}</span></div>
        <div class="coord">${fmtLat(v.lat)}, ${fmtLon(v.lon)} · 2°×2° REGIONAL MEAN</div>${critRows(v, S.weights)}`;
      li.onclick = () => {
        select(c.x, c.y, i);
        if (S.viewMode === '3d' && globe) { globe.flyTo(v.lat, v.lon); schedule3D(); }
        if (S.mode === 'crisis') setCrisisSite(c.x, c.y);
      };
      ol.appendChild(li);
    });
  }
  // Distinct, readable candidate names: exact region if within 2 deg, otherwise a compass sector of the nearest region.
  function candidateName(lat, lon, nr) {
    if (nr.distDeg < 2) return nr.region.name;
    const r = nr.region; let dlon = lon - r.lon; if (dlon > 180) dlon -= 360; if (dlon < -180) dlon += 360;
    const dlat = lat - r.lat, ew = dlon * Math.cos(lat * Math.PI / 180);
    const dir = (Math.abs(dlat) > Math.abs(ew) * 2 ? '' : (ew > 0 ? 'E' : 'W')); const ns = (Math.abs(ew) > Math.abs(dlat) * 2 ? '' : (dlat > 0 ? 'N' : 'S'));
    return `${ns}${dir} of ${r.name.replace(/ \(.*\)$/, '')} · ${(nr.distDeg * 59.3).toFixed(0)} km`;
  }
  const fmtLat = (la) => `${Math.abs(la).toFixed(1)}°${la >= 0 ? 'N' : 'S'}`;
  const fmtLon = (lo) => `${Math.abs(lo).toFixed(1)}°${lo >= 0 ? 'E' : 'W'}`;

  function renderDetail(x, y, cand) {
    const v = cellValues(x, y), s = S.score[y * W + x], nr = nearestRegion(v.lat, v.lon);
    const passElev = v.elev <= SCORING.HARD.elevMax;
    const passSlope = v.slope <= SCORING.HARD.slopeMax;
    const passLat = Math.abs(v.lat) <= SCORING.HARD.latMax;
    const vetoed = S.hard && (!passElev || !passSlope || !passLat);

    $('#detail').innerHTML = `
      <div class="detail-header">
        <div>
          <div class="hint">COMPOSITE SUITABILITY INDEX</div>
          <div class="big">${s.toFixed(3)}</div>
        </div>
        <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${vetoed ? 'HLS HARD VETO' : 'NOMINAL CELL'}</span>
      </div>
      <div class="coord">${fmtLat(v.lat)}, ${fmtLon(v.lon)} · ${nr.distDeg < 6 ? nr.region.name : 'NEAR ' + nr.region.name.toUpperCase()} (${(nr.distDeg * 59.3).toFixed(0)} KM)</div>
      <div class="hls-checks">
        <div class="hls-check"><span class="hint">ELEV ≤ +2KM</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? 'PASS' : 'VETO'}</b></div>
        <div class="hls-check"><span class="hint">SLOPE ≤ 15°</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? 'PASS' : 'VETO'}</b></div>
        <div class="hls-check"><span class="hint">|LAT| ≤ 50°</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? 'PASS' : 'VETO'}</b></div>
      </div>
      ${critRows(v, S.weights)}
      <table>
        <tr><td>MOLA Elevation</td><td>${v.elev.toFixed(0)} m</td></tr>
        <tr><td>MOLA 90th-pct Slope</td><td>${v.slope.toFixed(1)}°</td></tr>
        <tr><td>SWIM Ice (${$('#iceband .active').textContent})</td><td>${v.ice === null ? 'OUTSIDE ±60°' : v.ice.toFixed(2)}</td></tr>
        <tr><td>Sub-cell Roughness (σ)</td><td>${v.rough.toFixed(0)} m</td></tr>
        <tr><td>TES Thermal Inertia</td><td>${v.ti === null ? 'NO DATA' : v.ti.toFixed(0) + ' J m⁻² K⁻¹ s⁻½'}</td></tr>
        <tr><td>TES Dust Abundance</td><td>${v.dust === null ? 'NO DATA' : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
      </table>
      <div class="row">
        <button id="use-route" class="ghost">Set Traverse Origin</button>
        <button id="use-crisis" class="ghost">Load in Power Sim</button>
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
    if (!r.start) { el.innerHTML = '<div class="verdict">STEP 01 // DESIGNATE ORIGIN WAYPOINT (WP-A) ON MAP</div>'; return; }
    if (!r.goal) { el.innerHTML = '<div class="verdict">STEP 02 // DESIGNATE TARGET WAYPOINT (WP-B) ON MAP</div>'; return; }
    if (!r.safe || !r.safe.ok) { el.innerHTML = `<div class="verdict bad">TRAVERSE BLOCKED // No slope-safe corridor (${r.safe ? r.safe.reason : ''}). Increase slope threshold or relocate target.</div>`; return; }
    const a = r.straight.stats, b = r.safe.stats, sols = (km) => (km / r.speed).toFixed(0);
    const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
    el.innerHTML = `<table class="stat-table"><tr><th>Metric</th><th class="straight">Direct</th><th class="safe">A* Safe</th></tr>
      <tr><td>Total Distance</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
      <tr><td>Peak Slope</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
      <tr><td>Mean Slope</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}°</td></tr>
      <tr><td>Distance &gt;10° Slope</td><td>${a.hazardKm.toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} km</td></tr>
      <tr><td>Traverse Duration</td><td>${sols(a.km)} sols</td><td>${sols(b.km)} sols</td></tr></table>
      <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? `HAZARD ALERT // Direct path intersects ${a.maxSlope.toFixed(1)}° grade (exceeds ${r.maxSlope}° limit). A* detour adds ${(b.km - a.km).toFixed(0)} km.` : 'NOMINAL // Direct path satisfies maximum slope constraint.'}</div>
      <div class="hint" style="margin-top:10px">MOLA ELEVATION PROFILE · A* SOLVED IN ${r.ms.toFixed(0)} MS (${r.safe.path.length} CELLS)</div>${profileSVG(b.profile)}`;
  }
  function profileSVG(p) {
    const w = 276, h = 118, pad = 32;
    const kmMax = p[p.length - 1].km || 1, eMin = Math.min(...p.map(q => q.elev)), eMax = Math.max(...p.map(q => q.elev)) + 1;
    const X = (km) => pad + (km / kmMax) * (w - pad - 8), Y = (e) => h - 18 - ((e - eMin) / (eMax - eMin)) * (h - 30);
    let d = '', segs = '';
    p.forEach((q, i) => { d += (i ? 'L' : 'M') + X(q.km).toFixed(1) + ',' + Y(q.elev).toFixed(1); });
    const areaD = `${d}L${X(kmMax).toFixed(1)},${h - 18}L${X(0).toFixed(1)},${h - 18}Z`;
    p.forEach((q, i) => { if (i && q.slope > 10) segs += `<line x1="${X(p[i - 1].km).toFixed(1)}" y1="${Y(p[i - 1].elev).toFixed(1)}" x2="${X(q.km).toFixed(1)}" y2="${Y(q.elev).toFixed(1)}" stroke="#f59e0b" stroke-width="2.8"/>`; });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">
      <line x1="${pad}" y1="12" x2="${w - 8}" y2="12" stroke="rgba(148,163,184,0.12)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${(h - 6) / 2}" x2="${w - 8}" y2="${(h - 6) / 2}" stroke="rgba(148,163,184,0.12)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${h - 18}" x2="${w - 8}" y2="${h - 18}" stroke="rgba(148,163,184,0.25)"/>
      <path d="${areaD}" fill="rgba(16, 185, 129, 0.12)"/>
      <path d="${d}" fill="none" stroke="#10b981" stroke-width="1.6"/>${segs}
      <text x="4" y="15" fill="#8b9bb4" font-size="8.5" font-family="JetBrains Mono, monospace">${(eMax / 1000).toFixed(1)}km</text>
      <text x="4" y="${h - 18}" fill="#8b9bb4" font-size="8.5" font-family="JetBrains Mono, monospace">${(eMin / 1000).toFixed(1)}km</text>
      <text x="${pad}" y="${h - 5}" fill="#56657e" font-size="8.5" font-family="JetBrains Mono, monospace">0 km</text>
      <text x="${w - 8}" y="${h - 5}" fill="#8b9bb4" font-size="8.5" font-family="JetBrains Mono, monospace" text-anchor="end">${kmMax.toFixed(0)} km</text>
    </svg>`;
  }

  // ------------------------------------------------------------ crisis
  function setCrisisSite(x, y) { S.crisis.site = { x, y }; runCrisis(); draw(); }
  function runCrisis() {
    const c = S.crisis, el = $('#crisis-summary');
    if (!c.site) { $('#crisis-site').textContent = '— SELECT COORDINATE ON MAP —'; el.innerHTML = ''; return; }
    const v = cellValues(c.site.x, c.site.y), nr = nearestRegion(v.lat, v.lon);
    $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : 'NEAR ' + nr.region.name} (${fmtLat(v.lat)}, ${fmtLon(v.lon)})`;
    const res = STORM.simulate({ lat: v.lat, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
      storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 } });
    const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, 0.5), peakSolar = c.area * 0.2 * STORM.dailySolar(v.lat, c.tauPeak);
    const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
    const verdict = res.blackoutSol !== null
      ? `<div class="summary-big bad">CRITICAL BLACKOUT // SOL ${res.blackoutSol}</div><div class="help">Battery reserve exhausted ${res.blackoutSol - 20} sols after storm onset. Peak-storm generation ${(peakSolar + nuc).toFixed(0)} kWh/sol vs load ${c.cons} kWh/sol.</div>`
      : `<div class="summary-big ok">NOMINAL // SURVIVES GLOBAL STORM</div><div class="help">Minimum battery reserve ${res.minBatt.toFixed(0)} kWh (${(100 * res.minBatt / c.batt).toFixed(0)}%). Net balance at peak attenuation: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.</div>`;
    el.innerHTML = `${verdict}
      <div class="kv"><span>Clear-Sky Solar (τ = 0.5)</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
      <div class="kv"><span>Peak-Storm Solar (τ = ${c.tauPeak.toFixed(1)})</span><b>${peakSolar.toFixed(0)} kWh/sol (−${res.peakSolarDropPct.toFixed(0)}%)</b></div>
      <div class="kv"><span>Kilopower Fission Baseload</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
      ${crisisSVG(res.rows, c.batt)}
      <div class="help" style="margin-top:6px">Profile: Sol 20 onset · 10-sol ramp · 40-sol plateau · 30-sol decay. ${c.kp === 0 && res.blackoutSol !== null ? 'Add Kilopower fission units (10 kWe each) to maintain life-support baseload.' : ''}</div>`;
  }
  function crisisSVG(rows, cap) {
    const w = 276, h = 118, pad = 26, n = rows.length;
    const X = (i) => pad + (i / (n - 1)) * (w - pad - 8), Yb = (b) => h - 18 - (b / cap) * (h - 30), Yt = (t) => h - 18 - (t / 12) * (h - 30);
    let db = '', dt = '';
    rows.forEach((r, i) => { db += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yb(r.batt).toFixed(1); dt += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yt(r.tau).toFixed(1); });
    const areaB = `${db}L${X(n - 1).toFixed(1)},${h - 18}L${X(0).toFixed(1)},${h - 18}Z`;
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">
      <line x1="${pad}" y1="12" x2="${w - 8}" y2="12" stroke="rgba(148,163,184,0.12)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${h - 18}" x2="${w - 8}" y2="${h - 18}" stroke="rgba(148,163,184,0.25)"/>
      <path d="${areaB}" fill="rgba(56, 189, 248, 0.10)"/>
      <path d="${dt}" fill="none" stroke="#fc3d21" stroke-width="1.2" stroke-dasharray="3 3"/>
      <path d="${db}" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
      <text x="${pad}" y="10" fill="#38bdf8" font-size="8.5" font-family="JetBrains Mono, monospace">BATTERY RESERVE</text>
      <text x="${w - 8}" y="10" fill="#fc3d21" font-size="8.5" font-family="JetBrains Mono, monospace" text-anchor="end">OPTICAL DEPTH τ (0–12)</text>
      <text x="${pad}" y="${h - 5}" fill="#56657e" font-size="8.5" font-family="JetBrains Mono, monospace">SOL 0</text>
      <text x="${w - 8}" y="${h - 5}" fill="#8b9bb4" font-size="8.5" font-family="JetBrains Mono, monospace" text-anchor="end">SOL ${n}</text>
    </svg>`;
  }

  // ------------------------------------------------------------ UI wiring
  function updateHudLayer() {
    const el = $('#hud-layer');
    if (el) el.textContent = `OVERLAY: ${OVERLAY_NAMES[S.overlay] || S.overlay.toUpperCase()}`;
  }

  function setViewMode(vm) {
    if (vm === '3d' && !globe) return;
    S.viewMode = vm;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === vm));
    if (globeCanvas) globeCanvas.classList.toggle('hidden', vm !== '3d');
    if ($('#globe-tools')) $('#globe-tools').classList.toggle('hidden', vm !== '3d');
    if ($('#hud-proj')) $('#hud-proj').textContent = vm === '3d' ? 'PROJ: 3D WEBGL MOLA SPHERICAL DEM' : 'PROJ: 2D EQUIRECTANGULAR IAU-2000';
    if ($('#hud-hint')) $('#hud-hint').textContent = vm === '3d' ? 'DRAG: ORBIT 3D · SCROLL: ZOOM · CLICK: DESIGNATE' : 'SCROLL: ZOOM · DRAG: PAN · CLICK: DESIGNATE';
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
      $('#btn-relief').textContent = `RELIEF: ${levels[idx]}×`;
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
    for (const k of ['score', 'route', 'crisis']) $('#panel-' + k).classList.toggle('hidden', k !== m);
    if (m === 'route') { S.overlay = 'slope'; } else if (m === 'score') { S.overlay = 'score'; }
    document.querySelectorAll('#overlay button').forEach(b => b.classList.toggle('active', b.dataset.ov === S.overlay));
    updateHudLayer();
    ovDirty = true; renderLegend(); if (m === 'route') renderRoute(); if (m === 'crisis') runCrisis(); draw();
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
  document.querySelectorAll('#iceband button').forEach(b => b.onclick = () => { document.querySelectorAll('#iceband button').forEach(x => x.classList.toggle('active', x === b)); S.iceBand = b.dataset.band; rescore(); });
  document.querySelectorAll('#overlay button').forEach(b => b.onclick = () => { document.querySelectorAll('#overlay button').forEach(x => x.classList.toggle('active', x === b)); S.overlay = b.dataset.ov; updateHudLayer(); ovDirty = true; renderLegend(); draw(); });
  $('#opacity').oninput = (e) => { S.opacity = +e.target.value / 100; const vEl = $('#opacity-v'); if (vEl) vEl.textContent = e.target.value + '%'; draw(); };
  $('#show-regions').onchange = (e) => { S.showRegions = e.target.checked; draw(); };
  $('#show-ez').onchange = (e) => { S.showEZ = e.target.checked; draw(); };
  const bindRange = (id, fmt, cb) => { const el = $('#' + id); const upd = () => { $('#' + id + '-v').textContent = fmt(+el.value); cb(+el.value); }; el.oninput = upd; upd(); };
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
  bindRange('tau', v => (v / 10).toFixed(1), v => { S.crisis.tauPeak = v / 10; runCrisis(); });
  bindRange('area', v => v + ' m²', v => { S.crisis.area = v; runCrisis(); });
  bindRange('cons', v => v + ' kWh/sol', v => { S.crisis.cons = v; runCrisis(); });
  bindRange('batt', v => v + ' kWh', v => { S.crisis.batt = v; runCrisis(); });
  bindRange('kp', v => String(v), v => { S.crisis.kp = v; runCrisis(); });
  $('#btn-about').onclick = () => $('#about').classList.remove('hidden');
  $('#about-close').onclick = () => $('#about').classList.add('hidden');
  $('#about').onclick = (e) => { if (e.target.id === 'about') $('#about').classList.add('hidden'); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#about').classList.add('hidden'); });

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
    const el = $('#legend'), lut = LUT[S.overlay];
    if (!lut) { el.innerHTML = ''; return; }
    const stops = []; for (let i = 0; i <= 10; i++) { const v = Math.round(i * 25.5); stops.push(`rgb(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]})`); }
    const ends = {
      score: ['≤0.35 VETO/POOR', '1.00 OPTIMAL'],
      ice: ['−1.0 NO ICE', '+1.0 HIGH ICE'],
      slope: ['0.0° FLAT', '≥16.0° STEEP'],
      elev: ['−8.2 KM', '+21.2 KM'],
      ti: ['0 FINE DUST', '≥700 BEDROCK'],
      dust: ['0% DUST', '100% DUST'],
    }[S.overlay];
    el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
  }

  // ------------------------------------------------------------ map interaction (2D & 3D)
  let drag = null, moved = false;
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
      if (globe.state.autoSpin) {
        globe.state.autoSpin = false;
        if ($('#btn-spin')) $('#btn-spin').classList.remove('active');
      }
      schedule3D();
    } else {
      S.view.tx = drag.tx + dx; S.view.ty = drag.ty + dy; wrapView(); draw();
    }
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
    tip.innerHTML = `<span class="tt-region">${nr.distDeg < 6 ? nr.region.name : 'Near ' + nr.region.name}</span><b>${fmtLat(v.lat)}, ${fmtLon(v.lon)}</b> · SCORE <b>${s.toFixed(2)}</b><br>ELEV ${v.elev.toFixed(0)} m · SLOPE ${v.slope.toFixed(1)}°<br>ICE ${v.ice === null ? '—' : v.ice.toFixed(2)} · ROUGH ${v.rough.toFixed(0)} m<br>TI ${v.ti === null ? '—' : v.ti.toFixed(0)} · DUST ${v.dust === null ? '—' : (v.dust * 100).toFixed(0) + '%'}`;
    const r = canvas.getBoundingClientRect();
    const tx = Math.min(r.width - 210, e.clientX - r.left + 14);
    const ty = Math.min(r.height - 95, e.clientY - r.top + 14);
    tip.style.left = Math.max(8, tx) + 'px';
    tip.style.top = Math.max(8, ty) + 'px';
    tip.classList.remove('hidden');
  });
  canvas.addEventListener('mouseleave', () => $('#tooltip').classList.add('hidden'));
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
  buildPresets(); buildSliders(); renderLegend(); renderRoute();
  Promise.all(['elev', 'slope', 'rough', 'ice01', 'ice15', 'ice5', 'ti', 'dust', 'base'].map(decode)).then(() => {
    L.ice = L[S.iceBand];
    if (globe) globe.setLayers(baseImg, L.elev, W, H);
    window.addEventListener('resize', resize); resize();
    rescore();
    $('#loading').classList.add('hidden');
    applyDemoLink();
  }).catch(err => { $('#loading').innerHTML = 'Failed to decode layers: ' + err; });

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
      if (q.get('tau')) { $('#tau').value = Math.round(+q.get('tau') * 10); $('#tau').oninput(); }
      if (q.get('kp')) { $('#kp').value = q.get('kp'); $('#kp').oninput(); }
      setMode('crisis'); setCrisisSite(L.colOfLon(a.lon), L.rowOfLat(a.lat));
    }
  }

  window.MDE = { L, S, globe, cellValues, rescore, setViewMode };
})();
