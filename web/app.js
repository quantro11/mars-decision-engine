// Coordinator for Mars Base Decision Engine.
// Delegates layer I/O (ui/layers.js), panel rendering (ui/panels.js), 2D/3D canvas control (ui/map2d.js),
// and offloads heavy compute to worker.js on HTTP(S) with transparent synchronous fallback on file://.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const on = (sel, prop, fn) => { const el = $(sel); if (el) el[prop] = fn; };
  const FMT = window.MDE_FMT;
  const CHARTS = window.MDE_CHARTS;
  const OVERLAYS = window.MDE_OVERLAYS;
  const { escHtml } = FMT;
  const { initHabitabilityAPI, renderHabitability } = window.MDE_HAB;
  const { buildBriefPayload, renderBriefHTML, downloadBriefJSON } = window.MDE_BRIEF;
  const META = window.LAYER_META;
  const W = META.width, H = META.height;
  const OVERLAY_NAMES = {
    score: 'SUITABILITY SCORE', ice: 'SWIM 2.0 SUBSURFACE ICE', slope: 'MOLA 90TH-PCT SLOPE',
    elev: 'MOLA MEGDR ELEVATION', ti: 'TES THERMAL INERTIA', dust: 'TES DUST ABUNDANCE',
    rad: 'GCR DOSE (MSL/RAD-ANCHORED)', cave: 'CAVE CANDIDATE PROXIMITY (UNCONFIRMED)', none: 'NASA VIKING MDIM 2.1 OPTICAL',
  };

  // ------------------------------------------------------------ theme
  function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    const btn = $('#btn-theme');
    if (btn) { btn.setAttribute('aria-pressed', String(light)); btn.textContent = light ? 'Dark theme' : 'Light theme'; }
    try { localStorage.setItem('mde_theme', light ? 'light' : 'dark'); } catch (e) { /* storage disabled */ }
  }
  try { applyTheme(localStorage.getItem('mde_theme') || 'dark'); } catch (e) { applyTheme('dark'); }
  on('#btn-theme', 'onclick', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

  // ------------------------------------------------------------ state & core services
  const S = {
    viewMode: '2d',
    mode: 'score', preset: 'balanced', weights: { ...SCORING.PRESETS.balanced.w }, hard: true, iceBand: 'ice15',
    overlay: 'score', opacity: 0.45, showRegions: true, showEZ: false, globeOverlay: false,
    view: { scale: 1, tx: 0, ty: 0 }, score: new Float32Array(W * H), candidates: [], selected: null,
    sensSpread: 0.2, agg: 'sum',
    route: { start: null, goal: null, safe: null, straight: null, maxSlope: 15, k: 0.3, speed: 20, ms: 0 },
    crisis: { site: null, ls: 251, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0, regolith: 1.5 },
  };

  const globeCanvas = $('#globe');
  const globe = (window.GLOBE3D && globeCanvas) ? window.GLOBE3D.createGlobe(globeCanvas) : null;
  let viewport = null, panels = null;

  const layers = window.MDE_LAYERS.createLayerStore({
    META, SCORING, REGIONS, ASTAR,
    onBaseUpdate: (img) => { try { if (globe && layers.L.elev) globe.setBaseTexture(img); } catch (e) { /* tainted fallback */ } },
  });
  const L = layers.L;

  // ------------------------------------------------------------ Worker RPC + fallback
  let computeWorker = null, workerReady = false, workerSeq = 0;
  const workerPending = new Map();

  function initWorker() {
    if (typeof Worker === 'undefined' || location.protocol === 'file:') return;
    try {
      computeWorker = new Worker('worker.js');
      computeWorker.onmessage = (e) => {
        const msg = e.data || {}, cb = workerPending.get(msg.id);
        if (!cb) return;
        workerPending.delete(msg.id);
        if (msg.ok) cb.resolve(msg);
        else cb.reject(new Error(msg.error || 'Worker error'));
      };
      computeWorker.onerror = () => {
        for (const cb of workerPending.values()) cb.reject(new Error('Worker failed'));
        workerPending.clear();
        workerReady = false;
        computeWorker = null;
      };
    } catch (e) {
      computeWorker = null;
    }
  }

  function workerCall(payload) {
    return new Promise((resolve, reject) => {
      if (!computeWorker) return reject(new Error('No worker'));
      const id = ++workerSeq;
      workerPending.set(id, { resolve, reject });
      computeWorker.postMessage({ ...payload, id });
    });
  }

  async function initWorkerLayers() {
    initWorker();
    if (!computeWorker) return;
    try {
      await workerCall({
        cmd: 'initLayers', width: W, height: H, meta: META,
        elev: L.elev, slope: L.slope, rough: L.rough,
        ice01: L.ice01 || null, ice15: L.ice15 || null, ice5: L.ice5 || null,
        ti: L.ti, dust: L.dust, cave: L.cave || null,
      });
      workerReady = true;
    } catch (e) {
      workerReady = false;
      computeWorker = null;
    }
  }

  function syncWorkerLayer(key) {
    if (workerReady && computeWorker && L[key]) {
      workerCall({ cmd: 'setLayer', key, data: L[key] }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ compute pipelines
  let scoreTicket = 0, routeTicket = 0;

  function applyScoreResult(scoreArr, candidates, elapsedMs, ticket) {
    if (ticket !== scoreTicket) return;
    S.score = scoreArr;
    S.candidates = candidates;
    if ($('#sens-result')) $('#sens-result').innerHTML = '';
    viewport.markOverlayDirty();
    panels.renderCandidates();
    if (S.selected) panels.renderDetail(S.selected.x, S.selected.y);
    viewport.draw();
    if ($('#hud-coord')) $('#hud-coord').dataset.t = elapsedMs.toFixed(0);
    if (candidates[0]) panels.announce(`Scoring ready: top candidate score ${candidates[0].score.toFixed(2)}.`);
  }

  function rescore() {
    const ticket = ++scoreTicket;
    const blockPx = Math.round(2 / META.deg_per_px), sepPx = Math.round(800 / 59.3 / META.deg_per_px);
    L.ice = L[S.iceBand];
    const runSyncScore = () => {
      const t0 = performance.now();
      SCORING.scoreMap(L, S.weights, S.hard, S.score, S.agg);
      const cands = SCORING.topCandidates(S.score, W, H, 5, blockPx, sepPx).map(c => ({ ...c, x: Math.round(c.x), y: Math.round(c.y), blockPx }));
      applyScoreResult(S.score, cands, performance.now() - t0, ticket);
    };
    if (workerReady) {
      workerCall({ cmd: 'score', weights: S.weights, hard: S.hard, agg: S.agg, iceBand: S.iceBand, blockPx, sepPx })
        .then(r => applyScoreResult(r.score, r.candidates, r.ms, ticket)).catch(runSyncScore);
      return;
    }
    requestAnimationFrame(() => { if (ticket === scoreTicket) runSyncScore(); });
  }

  function runSensitivity() {
    if (!S.candidates.length) return;
    const btn = $('#sens-run'), out = $('#sens-result');
    if (!btn || !out) return;
    btn.disabled = true; out.innerHTML = '<div class="help">Running 30 perturbed scorings…</div>';
    const blockPx = S.candidates[0].blockPx, sepPx = Math.round(800 / 59.3 / META.deg_per_px), matchPx = Math.round(400 / 59.3 / META.deg_per_px);
    const show = (rob) => {
      S.candidates.forEach((c, i) => { c.robust = rob[i]; });
      const mean = rob.reduce((a, b) => a + b, 0) / rob.length;
      out.innerHTML = `<div class="verdict ${mean >= 0.8 ? 'ok' : mean >= 0.5 ? '' : 'bad'}">Weights ±${Math.round(S.sensSpread * 100)}% × 30 runs: top-5 candidates stay in the top-5 (within 400 km) in ${(mean * 100).toFixed(0)}% of runs on average. ${mean >= 0.8 ? 'Ranking is ROBUST to weight uncertainty.' : 'Ranking DEPENDS on the chosen weights.'}</div>`;
      panels.renderCandidates(); btn.disabled = false;
    };
    const runSyncSens = () => {
      L.ice = L[S.iceBand];
      show(SCORING.sensitivity(L, S.weights, S.hard, S.candidates, { mode: S.agg, runs: 30, spread: S.sensSpread, n: 5, blockPx, minSepPx: sepPx, matchPx }, SCORING.mulberry32(2026)));
    };
    if (workerReady) {
      workerCall({ cmd: 'sensitivity', weights: S.weights, hard: S.hard, candidates: S.candidates, spread: S.sensSpread, agg: S.agg, iceBand: S.iceBand, blockPx, sepPx, matchPx })
        .then(r => show(r.robust)).catch(runSyncSens);
      return;
    }
    setTimeout(runSyncSens, 20);
  }

  function computeRoute() {
    const r = S.route;
    if (!r.start || !r.goal) return;
    const ticket = ++routeTicket;
    const finish = (safe, straight, ms) => { if (ticket === routeTicket) { r.safe = safe; r.straight = straight; r.ms = ms; panels.renderRoute(); viewport.draw(); } };
    const runSyncRoute = () => {
      const t0 = performance.now();
      finish(ASTAR.plan(L, r.start.x, r.start.y, r.goal.x, r.goal.y, { k: r.k, maxSlope: r.maxSlope }), ASTAR.straight(L, r.start.x, r.start.y, r.goal.x, r.goal.y), performance.now() - t0);
    };
    if (workerReady) {
      workerCall({ cmd: 'route', sx: r.start.x, sy: r.start.y, gx: r.goal.x, gy: r.goal.y, k: r.k, maxSlope: r.maxSlope })
        .then(res => finish(res.safe, res.straight, res.ms)).catch(runSyncRoute);
      return;
    }
    runSyncRoute();
  }

  // ------------------------------------------------------------ selection & views
  function select(x, y, cand) {
    S.selected = { x, y, cand };
    panels.renderDetail(x, y);
    panels.renderCandidates();
    viewport.draw();
  }
  function setCrisisSite(x, y, switchMode) {
    S.crisis.site = { x, y };
    if (switchMode) setMode('crisis');
    else { panels.runCrisis(); viewport.draw(); }
  }

  panels = window.MDE_PANELS.createPanels({
    doc: document, S, layers, SCORING, STORM, FMT, CHARTS,
    onRescore: rescore,
    onSelect: select,
    onUseRoute: (x, y) => { setMode('route'); S.route.start = { x, y }; S.route.goal = null; S.route.safe = S.route.straight = null; panels.renderRoute(); viewport.draw(); },
    onUseCrisis: setCrisisSite,
    onGlobeFly: (lat, lon) => { if (S.viewMode === '3d' && globe) { globe.flyTo(lat, lon); viewport.schedule3D(); } },
  });

  viewport = window.MDE_MAP2D.createViewport({
    doc: document, S, layers, SCORING, REGIONS, OVERLAYS, MARKERS: window.MDE_MARKERS, FMT, globe, globeCanvas,
    onStopSpin: () => { if (globe && globe.state.autoSpin) { globe.state.autoSpin = false; if ($('#btn-spin')) $('#btn-spin').classList.remove('active'); } },
    onPick: (x, y) => {
      if (S.mode === 'route') {
        const r = S.route;
        if (!r.start || (r.start && r.goal)) { r.start = { x, y }; r.goal = null; r.safe = r.straight = null; } else { r.goal = { x, y }; }
        panels.renderRoute(); if (r.goal) computeRoute(); viewport.draw(); return;
      }
      if (S.mode === 'crisis') setCrisisSite(x, y);
      select(x, y, null);
    },
  });

  function updateHudLayer() { if ($('#hud-layer')) $('#hud-layer').textContent = `Overlay · ${(OVERLAY_NAMES[S.overlay] || S.overlay).toLowerCase()}`; }
  function setHudHint(text, isWarn) { const el = $('#hud-hint'); if (el) { el.textContent = text; el.classList.toggle('warn', !!isWarn); } }
  function renderLegend() { if ($('#legend')) $('#legend').innerHTML = OVERLAYS.renderLegendHTML(S.overlay); }

  if (!globe && $('#btn-3d')) {
    $('#btn-3d').setAttribute('aria-disabled', 'true');
    $('#btn-3d').title = '3D Globe unavailable (WebGL disabled or unsupported)';
  }
  if (globe) {
    globe.state.onContextLost = () => setHudHint('WebGL context lost — restoring 3D globe…', true);
    globe.state.onContextRestored = () => {
      viewport.markOverlayDirty(); viewport.buildOverlay();
      setHudHint(S.viewMode === '3d' ? 'Drag to orbit · scroll to zoom · click to inspect' : 'Drag to pan · scroll to zoom · click to inspect', false);
      viewport.schedule3D();
    };
  }

  function setViewMode(vm) {
    if (vm === '3d' && !globe) { setHudHint('3D globe unavailable (WebGL disabled) — staying in 2D map view', true); return; }
    S.viewMode = vm;
    document.querySelectorAll('.view-btn').forEach(b => {
      const active = b.dataset.view === vm;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (globeCanvas) globeCanvas.classList.toggle('hidden', vm !== '3d');
    if ($('#globe-tools')) $('#globe-tools').classList.toggle('hidden', vm !== '3d');
    if ($('#hud-proj')) $('#hud-proj').textContent = vm === '3d' ? 'Globe · MOLA relief' : 'Map · equirectangular';
    setHudHint(vm === '3d' ? 'Drag to orbit · scroll to zoom · click to inspect' : 'Drag to pan · scroll to zoom · click to inspect', false);
    if (vm === '3d' && globe) {
      const target = S.selected || S.candidates[0];
      if (target) globe.flyTo(L.latOfRow(target.y), L.lonOfCol(target.x));
      viewport.schedule3D();
    }
    viewport.updateScaleBar(); viewport.draw();
    panels.announce(vm === '3d' ? 'Switched to 3D MOLA globe view.' : 'Switched to 2D map view.');
  }

  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('.mode-btn').forEach(b => {
      const active = b.dataset.mode === m;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    for (const k of ['score', 'route', 'crisis', 'habitability']) {
      if ($('#panel-' + k)) $('#panel-' + k).classList.toggle('hidden', k !== m);
    }
    if (m === 'route') S.overlay = 'slope'; else if (m === 'score') S.overlay = 'score';
    document.querySelectorAll('#overlay button').forEach(b => b.classList.toggle('active', b.dataset.ov === S.overlay));
    updateHudLayer(); viewport.markOverlayDirty(); renderLegend();
    if (m === 'route') panels.renderRoute();
    if (m === 'crisis') panels.runCrisis();
    if (m === 'habitability') renderHabitability();
    viewport.draw();
  }

  // ------------------------------------------------------------ wiring
  document.querySelectorAll('.view-btn').forEach(b => b.onclick = () => setViewMode(b.dataset.view));
  document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  if ($('#btn-relief') && globe) {
    const lvls = [1, 5, 8, 15];
    $('#btn-relief').onclick = () => { const v = lvls[(lvls.indexOf(globe.state.exaggeration) + 1) % lvls.length]; globe.state.exaggeration = v; $('#btn-relief').textContent = `Relief ${v}×`; viewport.draw(); };
  }
  if (globe) {
    on('#btn-ov3d', 'onclick', () => { S.globeOverlay = !S.globeOverlay; $('#btn-ov3d').classList.toggle('active', S.globeOverlay); $('#btn-ov3d').textContent = S.globeOverlay ? 'Overlay on' : 'Overlay off'; viewport.draw(); });
    on('#btn-sun', 'onclick', () => { globe.state.sunLight = !globe.state.sunLight; $('#btn-sun').classList.toggle('active', globe.state.sunLight); viewport.draw(); });
    on('#btn-spin', 'onclick', () => { globe.state.autoSpin = !globe.state.autoSpin; $('#btn-spin').classList.toggle('active', globe.state.autoSpin); if (globe.state.autoSpin) viewport.schedule3D(); });
  }
  on('#hard', 'onchange', (e) => { S.hard = e.target.checked; rescore(); });
  on('#agg-geo', 'onchange', (e) => { S.agg = e.target.checked ? 'geo' : 'sum'; rescore(); });
  document.querySelectorAll('#iceband button').forEach(b => b.onclick = async () => {
    document.querySelectorAll('#iceband button').forEach(x => x.classList.toggle('active', x === b));
    S.iceBand = b.dataset.band;
    if (!L[S.iceBand]) { await layers.decode(S.iceBand); syncWorkerLayer(S.iceBand); }
    rescore();
  });
  document.querySelectorAll('#overlay button').forEach(b => b.onclick = () => { document.querySelectorAll('#overlay button').forEach(x => x.classList.toggle('active', x === b)); S.overlay = b.dataset.ov; updateHudLayer(); viewport.markOverlayDirty(); renderLegend(); viewport.draw(); });
  on('#opacity', 'oninput', (e) => { S.opacity = +e.target.value / 100; if ($('#opacity-v')) $('#opacity-v').textContent = e.target.value + '%'; viewport.draw(); });
  on('#show-regions', 'onchange', (e) => { S.showRegions = e.target.checked; viewport.draw(); });
  on('#show-ez', 'onchange', (e) => { S.showEZ = e.target.checked; viewport.draw(); });

  const bindRange = (id, fmt, cb) => { const el = $('#' + id); if (!el) return; const upd = () => { if ($('#' + id + '-v')) $('#' + id + '-v').textContent = fmt(+el.value); cb(+el.value); }; el.oninput = upd; upd(); };
  on('#sens-run', 'onclick', runSensitivity);
  bindRange('sens', v => '±' + v + '%', v => { S.sensSpread = v / 100; });
  bindRange('maxslope', v => v + '°', v => { S.route.maxSlope = v; computeRoute(); });
  bindRange('kslope', v => (v / 100).toFixed(2), v => { S.route.k = v / 100; computeRoute(); });
  bindRange('speed', v => v + ' km/sol', v => { S.route.speed = v; panels.renderRoute(); });
  on('#route-clear', 'onclick', () => { S.route.start = S.route.goal = S.route.safe = S.route.straight = null; panels.renderRoute(); viewport.draw(); });
  on('#route-demo', 'onclick', () => {
    const a = REGIONS[0], b = REGIONS[16];
    S.route.start = { x: L.colOfLon(a.lon), y: L.rowOfLat(a.lat) };
    S.route.goal = { x: L.colOfLon(b.lon), y: L.rowOfLat(b.lat) };
    if (S.viewMode === '3d' && globe) { globe.flyTo((a.lat + b.lat) / 2, (a.lon + b.lon) / 2, 1.85); viewport.schedule3D(); }
    else {
      S.view.scale = Math.max(S.view.scale, 3.2);
      S.view.tx = viewport.canvas.width / 2 - (S.route.start.x + S.route.goal.x) / 2 * S.view.scale;
      S.view.ty = viewport.canvas.height / 2 - (S.route.start.y + S.route.goal.y) / 2 * S.view.scale;
      viewport.wrapView(); viewport.updateScaleBar();
    }
    computeRoute();
  });
  bindRange('ls', v => `${v}° · ${STORM.seasonName(v).split(' /')[0]}`, v => { S.crisis.ls = v; panels.runCrisis(); });
  bindRange('tau', v => (v / 10).toFixed(1), v => { S.crisis.tauPeak = v / 10; panels.runCrisis(); });
  bindRange('area', v => v + ' m²', v => { S.crisis.area = v; panels.runCrisis(); });
  bindRange('cons', v => v + ' kWh/sol', v => { S.crisis.cons = v; panels.runCrisis(); });
  bindRange('batt', v => v + ' kWh', v => { S.crisis.batt = v; panels.runCrisis(); });
  bindRange('kp', v => String(v), v => { S.crisis.kp = v; panels.runCrisis(); });
  bindRange('rego', v => (v / 10).toFixed(1) + ' m', v => { S.crisis.regolith = v / 10; panels.runCrisis(); });
  on('#zoom-in', 'onclick', () => viewport.zoomBy(1.4));
  on('#zoom-out', 'onclick', () => viewport.zoomBy(1 / 1.4));
  on('#zoom-reset', 'onclick', () => { viewport.fitView(); viewport.draw(); });

  const fly = $('#flyto');
  REGIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(r => { const o = document.createElement('option'); o.value = r.name; o.textContent = (r.ez ? '[EZ] ' : '') + r.name; fly.appendChild(o); });
  fly.onchange = () => {
    const r = REGIONS.find(q => q.name === fly.value); if (!r) return;
    const x = L.colOfLon(r.lon), y = L.rowOfLat(r.lat);
    if (S.viewMode === '3d' && globe) { globe.flyTo(r.lat, r.lon, Math.min(globe.state.targetDist, 1.95)); viewport.schedule3D(); }
    else { S.view.scale = Math.max(S.view.scale, 3.2); S.view.tx = viewport.canvas.width / 2 - x * S.view.scale; S.view.ty = viewport.canvas.height / 2 - y * S.view.scale; viewport.wrapView(); viewport.updateScaleBar(); }
    select(x, y, null); fly.value = '';
  };

  // Modals + focus trap + aria-expanded
  let activeModal = null, lastFocusedEl = null, activeTrigger = null;
  function openModal(modal, focusSel, trigger) {
    if (!modal) return;
    lastFocusedEl = document.activeElement; activeModal = modal; activeTrigger = trigger || null;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'true');
    modal.classList.remove('hidden');
    const target = focusSel ? modal.querySelector(focusSel) : modal.querySelector('.modal-close');
    if (target) target.focus();
  }
  function closeModal(modal) {
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (activeTrigger) { activeTrigger.setAttribute('aria-expanded', 'false'); activeTrigger = null; }
    if (activeModal === modal) activeModal = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
    lastFocusedEl = null;
  }
  const getBriefPayload = () => buildBriefPayload({ S, W, L, META, flatShare: layers.flatShare, cellValues: layers.cellValues, blockValues: layers.blockValues, nearestRegion: layers.nearestRegion });
  on('#btn-about', 'onclick', () => openModal($('#about'), '#about-close', $('#btn-about')));
  on('#about-close', 'onclick', () => closeModal($('#about')));
  on('#about', 'onclick', (e) => { if (e.target.id === 'about') closeModal($('#about')); });
  on('#btn-export', 'onclick', () => { if ($('#brief-body')) $('#brief-body').innerHTML = renderBriefHTML(getBriefPayload()); openModal($('#brief-modal'), '#brief-close', $('#btn-export')); });
  on('#brief-close', 'onclick', () => closeModal($('#brief-modal')));
  on('#brief-modal', 'onclick', (e) => { if (e.target.id === 'brief-modal') closeModal($('#brief-modal')); });
  on('#btn-dl-json', 'onclick', () => downloadBriefJSON(getBriefPayload()));
  on('#btn-print-brief', 'onclick', () => window.print());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal($('#about')); closeModal($('#brief-modal')); return; }
    if (e.key === 'Tab' && activeModal && !activeModal.classList.contains('hidden')) {
      const f = [...activeModal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function syncRanges(root) { root.querySelectorAll('input[type=range]').forEach(r => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%')); }
  document.addEventListener('input', (e) => { if (e.target.type === 'range') syncRanges(e.target.parentElement); });
  new MutationObserver(() => syncRanges(document)).observe(document.body, { childList: true, subtree: true });
  syncRanges(document);

  // ------------------------------------------------------------ boot & deep links
  function applyDemoLink() {
    const q = new URLSearchParams(location.search);
    const find = (n) => n && REGIONS.find(r => r.name.toLowerCase().includes(n.toLowerCase()));
    if (q.get('view') === '3d') setViewMode('3d');
    if (q.get('preset') && SCORING.PRESETS[q.get('preset')]) { S.preset = q.get('preset'); S.weights = { ...SCORING.PRESETS[S.preset].w }; panels.buildPresets(); panels.buildSliders(); rescore(); }
    if (q.get('demo') === 'route') {
      const a = find(q.get('from')) || REGIONS[0], b = find(q.get('to')) || REGIONS[16];
      setMode('route'); S.route.start = { x: L.colOfLon(a.lon), y: L.rowOfLat(a.lat) }; S.route.goal = { x: L.colOfLon(b.lon), y: L.rowOfLat(b.lat) };
      let dx = Math.abs(S.route.goal.x - S.route.start.x); if (dx > W / 2) dx = W - dx; const dy = Math.abs(S.route.goal.y - S.route.start.y);
      const sc = Math.max(1, Math.min(viewport.canvas.width / (dx + 160), viewport.canvas.height / (dy + 160), 8));
      let cx = (S.route.start.x + S.route.goal.x) / 2; if (Math.abs(S.route.goal.x - S.route.start.x) > W / 2) cx = (cx + W / 2) % W;
      S.view.scale = sc; S.view.tx = viewport.canvas.width / 2 - cx * sc; S.view.ty = viewport.canvas.height / 2 - (S.route.start.y + S.route.goal.y) / 2 * sc;
      viewport.wrapView(); viewport.updateScaleBar(); computeRoute();
    } else if (q.get('demo') === 'crisis') {
      const a = find(q.get('site')) || REGIONS[10];
      if (q.get('ls') && $('#ls')) { $('#ls').value = Math.max(0, Math.min(360, Math.round(+q.get('ls')))); $('#ls').oninput(); }
      if (q.get('tau')) { $('#tau').value = Math.round(+q.get('tau') * 10); $('#tau').oninput(); }
      if (q.get('kp')) { $('#kp').value = q.get('kp'); $('#kp').oninput(); }
      setMode('crisis'); setCrisisSite(L.colOfLon(a.lon), L.rowOfLat(a.lat));
    }
  }

  panels.buildPresets(); panels.buildSliders(); renderLegend(); panels.renderRoute();
  initHabitabilityAPI({ onLiveUpdate: () => { if (S.mode === 'crisis') panels.runCrisis(); } });

  layers.ensureFileDataBundle().then(() => {
    const isFile = location.protocol === 'file:' && !!window.LAYER_DATA;
    const coreKeys = ['elev', 'slope', 'rough', S.iceBand, 'ti', 'dust', 'cave'];
    if (isFile) {
      return Promise.all([...coreKeys, 'ice01', 'ice5', 'base'].map(layers.decode)).then(() => {
        if (globe) globe.setLayers(layers.getBaseImg(), L.elev, W, H);
        layers.loadVikingMosaic().then(() => viewport.draw()).catch(() => {});
      });
    }
    const basePromise = layers.loadVikingMosaic().catch(() => layers.decode('base'));
    return Promise.all([...coreKeys.map(layers.decode), basePromise]).then(() => {
      if (globe) globe.setLayers(layers.getBaseImg(), L.elev, W, H);
      setTimeout(() => { ['ice01', 'ice5'].forEach(k => { if (!L[k]) layers.decode(k).then(() => syncWorkerLayer(k)).catch(() => {}); }); }, 300);
    });
  }).then(async () => {
    L.ice = L[S.iceBand];
    await initWorkerLayers();
    window.addEventListener('resize', viewport.resize);
    viewport.resize();
    rescore();
    $('#loading').classList.add('hidden');
    applyDemoLink();
  }).catch(err => {
    if ($('#loading')) $('#loading').innerHTML = `<div class="loading-title">Failed to decode planetary layers</div><div class="loading-sub">${escHtml(err && err.message ? err.message : err)}</div>`;
  });

  window.MDE = { L, S, globe, cellValues: layers.cellValues, rescore, setViewMode };
})();
