// Phase 2 legacy EVA UI controller (thin): wires buttons, modal HUD and panel HTML.
// Data lives in ui/eva_zones.js, physics in ui/eva_sim.js, drawing in ui/eva_render.js.
// window.MDE_EVA re-exports all three so app.js and existing tests keep working unchanged.
(function (global) {
  'use strict';

  const EVA_ZONES = global.MDE_EVA_ZONES ||
    (typeof globalThis !== 'undefined' && globalThis.MDE_EVA_ZONES) ||
    (typeof require === 'function' ? require('./eva_zones.js').MDE_EVA_ZONES : null);

  const SYSTEM_ARCH = EVA_ZONES.SYSTEM_ARCH;
  const DOMAINS = EVA_ZONES.DOMAINS;
  const SCORE_MODES = EVA_ZONES.SCORE_MODES;
  const resolveWeights = EVA_ZONES.resolveWeights;
  const ZONES = EVA_ZONES.ZONES;
  const BENCHMARK_TRAVERSES = EVA_ZONES.BENCHMARK_TRAVERSES;
  const makePrng = EVA_ZONES.makePrng;
  const synthesizeCustomWaypoints = EVA_ZONES.synthesizeCustomWaypoints;
  const zoneFromCoords = EVA_ZONES.zoneFromCoords;

  const EVA_SIM = global.MDE_EVA_SIM ||
    (typeof globalThis !== 'undefined' && globalThis.MDE_EVA_SIM) ||
    (typeof require === 'function' ? require('./eva_sim.js').MDE_EVA_SIM : null);
  const EVA_RENDER = global.MDE_EVA_RENDER ||
    (typeof globalThis !== 'undefined' && globalThis.MDE_EVA_RENDER) ||
    (typeof require === 'function' ? require('./eva_render.js').MDE_EVA_RENDER : null);

  const {
    MARS_G, SUIT_O2_CAP_G, SUIT_BATT_CAP_WH, SUIT_WATER_CAP_L, BASE_AVIONICS_W,
    buildLocalGrid, scoreLocalDomains, buildAssimilationMask, astarLeg, applyDynamicHazards,
    computeVhfLos, simulateEVA, validatePhase2Benchmarks,
  } = EVA_SIM;
  const { domainCellRgb, drawLocalEvaCanvas, drawGroundPovCanvas, renderSpectralSVG, drawGlobalWalkbackOverlay } = EVA_RENDER;

  function getEsc() {
    if (global.MDE_FMT && global.MDE_FMT.escHtml) return global.MDE_FMT.escHtml;
    return (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const getI18N = () => global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
  const isTr = () => { const m = getI18N(); return !!(m && m.getLang && m.getLang() === 'tr'); };
  const getScoring = () => global.SCORING ||
    (typeof globalThis !== 'undefined' && globalThis.SCORING) ||
    (typeof require === 'function' ? require('../scoring.js').SCORING : null);
  const getStorm = () => global.STORM ||
    (typeof globalThis !== 'undefined' && globalThis.STORM) ||
    (typeof require === 'function' ? require('../storm.js').STORM : null);

  function createEvaController(opts) {
    const doc = (opts && opts.doc) || global.document;
    const S = opts && opts.S;
    const layers = opts && opts.layers;
    const onSelectCoord = opts && opts.onSelectCoord;
    const onRedraw = opts && opts.onRedraw;
    const $ = (s) => (doc && doc.querySelector ? doc.querySelector(s) : null);

    const state = {
      zoneId: 'jezero_delta',
      customZone: null,
      loadKg: 15,
      speedKmh: 2.4,
      maxSlope: 15,
      buddyMode: 'buddy',
      scanStep: 4,
      mglLocked: true,
      speAlert: false,
      domainLayer: 'composite',
      scoreMode: 'balanced',
      customWeights: { topography: 24, geomorphology: 24, thermal: 16, radiation: 18, optical: 18 },
      customScanPts: [],
      dynamicHazards: [],
      spotProbe: null,
      playing: false,
      playTimer: null,
      povPlaying: false,
      povTimer: null,
      povFrameIdx: 0,
      povCache: {},
      hudReqId: 0,
      flareAdvisory: null,
      activeWpIdx: 0,
      laserOn: true,
      centerExpanded: false,
      sim: null,
    };

    function resolveRoverMeta(zone, wp) {
      const rover = zone.rover || (zone.id === 'jezero_delta' || zone.id === 'nili_fossae' ? 'perseverance' : 'curiosity');
      const cameraHint = (wp && wp.cameraHint) || 'MAST';
      const searchQuery = zone.searchQuery || `${rover} rover ${zone.name}`;
      return { rover, cameraHint, searchQuery };
    }

    function readStoredApiKey() {
      try {
        return (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem('nasa_api_key')) || '';
      } catch (e) {
        return '';
      }
    }

    function currentZone() {
      if (state.zoneId === 'custom_site' && state.customZone) return state.customZone;
      return ZONES[state.zoneId] || ZONES.jezero_delta;
    }

    function syncStepUi(sim) {
      const tr = isTr();
      const sl = $('#eva-scan-step');
      if (sl) sl.value = String(state.scanStep);
      const lbl = $('#eva-scan-step-v');
      if (lbl && sim) {
        lbl.textContent = tr
          ? `Adım ${state.scanStep}/8 · %${sim.navStack.autonav.assimilatedPct}`
          : `Step ${state.scanStep}/8 · ${sim.navStack.autonav.assimilatedPct}%`;
      }
      const mglBtn = $('#btn-eva-mgl');
      if (mglBtn) {
        mglBtn.textContent = state.mglLocked
          ? (tr ? 'MGL Ufuk Kilidi: AÇIK' : 'MGL Pose Lock: ON')
          : (tr ? 'MGL Ufuk Kilidi: KAPALI (VO Kayması)' : 'MGL Pose Lock: OFF (VO Drift)');
      }
      const speBtn = $('#btn-eva-spe');
      if (speBtn) {
        speBtn.textContent = state.speAlert
          ? (tr ? 'SPE 30dk Kaçış: AKTİF' : 'SPE 30m Escape: ACTIVE')
          : (tr ? 'SPE Fırtına Kaçışı (30dk)' : 'SPE 30m Escape Sim');
        speBtn.classList.toggle('active', state.speAlert);
      }
      const cwWrap = $('#eva-custom-weights');
      if (cwWrap) cwWrap.classList.toggle('hidden', state.scoreMode !== 'custom');
      const playBtn = $('#btn-eva-play');
      if (playBtn) {
        playBtn.textContent = state.playing ? (tr ? 'Duraklat' : 'Pause') : (tr ? 'Otomatik Tara' : 'Auto-Scan');
      }
    }

    function recompute() {
      const zone = currentZone();
      state.sim = simulateEVA(zone, {
        loadKg: state.loadKg,
        speedKmh: state.speedKmh,
        maxSlope: state.maxSlope,
        buddyMode: state.buddyMode,
        scanStep: state.scanStep,
        mglLocked: state.mglLocked,
        speAlert: state.speAlert,
        domainLayer: state.domainLayer,
        scoreMode: state.scoreMode,
        customWeights: state.customWeights,
        customScanPts: state.customScanPts,
        dynamicHazards: state.dynamicHazards,
        spotProbe: state.spotProbe,
        orbitalLayers: layers && layers.L,
      });
      if (S) {
        S.evaSim = state.sim;
        S.evaExpanded = state.centerExpanded;
        S.evaActiveWpIdx = state.activeWpIdx;
      }
      syncStepUi(state.sim);
      renderPanel();
      if (onRedraw) onRedraw();
      return state.sim;
    }

    function stopPlay() {
      state.playing = false;
      if (state.playTimer && typeof clearInterval === 'function') {
        clearInterval(state.playTimer);
      }
      state.playTimer = null;
      syncStepUi(state.sim);
    }

    function stopPovPlay() {
      state.povPlaying = false;
      if (state.povTimer && typeof clearInterval === 'function') {
        clearInterval(state.povTimer);
      }
      state.povTimer = null;
      const body = $('#hud-modal-body');
      const btn = body && body.querySelector ? body.querySelector('#hud-btn-pov-play') : null;
      if (btn) {
        const tr = isTr();
        btn.classList.remove('playing');
        btn.textContent = tr ? '▶ POV Yürüyüş Sekansını Oynat' : '▶ Play POV Walk Sequence';
      }
    }

    function togglePlay() {
      if (state.playing) {
        stopPlay();
        return;
      }
      if (state.scanStep >= 8) state.scanStep = 0;
      state.playing = true;
      syncStepUi(state.sim);
      if (typeof setInterval === 'function') {
        state.playTimer = setInterval(() => {
          if (state.scanStep >= 8) {
            stopPlay();
            return;
          }
          state.scanStep++;
          recompute();
        }, 550);
      }
    }

    function openHudModal(wpIdx) {
      if (typeof wpIdx === 'number') state.activeWpIdx = wpIdx;
      state.povFrameIdx = 0;
      stopPovPlay();
      const modal = $('#hud-modal');
      if (!modal || !state.sim) return;
      renderHudModal();
      modal.classList.remove('hidden');
      const closeBtn = $('#hud-close');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }

    function closeHudModal() {
      stopPovPlay();
      state.hudReqId++;
      const modal = $('#hud-modal');
      if (modal) modal.classList.add('hidden');
    }

    function renderHudModal() {
      const sim = state.sim || recompute();
      const zone = sim.zone;
      const wp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];
      const tr = isTr(), esc = getEsc();
      const reqId = ++state.hudReqId;
      const { rover, cameraHint, searchQuery } = resolveRoverMeta(zone, wp);
      const cacheKey = `${rover}:${cameraHint}`;
      const cachedPov = state.povCache[cacheKey] || null;
      const liveApi = global.LIVE_API || (typeof globalThis !== 'undefined' && globalThis.LIVE_API) || null;

      const titleEl = $('#hud-modal-title');
      if (titleEl) {
        titleEl.textContent = tr
          ? `xEMU Kask Vizörü (HUD) · ${wp.id}: ${wp.nameTr || wp.name}`
          : `xEMU Helmet Visor HUD · ${wp.id}: ${wp.name}`;
      }
      const subEl = $('#hud-modal-sub');
      if (subEl) {
        subEl.textContent = `${zone.name} · ${wp.cam} · HDG ${wp.heading}° · dElev +${wp.elevRel} m`;
      }

      const body = $('#hud-modal-body');
      if (!body) return;
      const chemRows = Object.entries(wp.chem).map(([ox, pct]) =>
        `<div class="hud-chem-cell"><span>${esc(ox)}</span><b>${pct.toFixed(1)} wt%</b></div>`
      ).join('');
      const wpTabs = zone.waypoints.map((w, idx) =>
        `<button type="button" class="ghost hud-wp-tab${idx === state.activeWpIdx ? ' active' : ''}" data-wp-idx="${idx}">${esc(w.id)} · ${esc(w.code)}</button>`
      ).join('');

      const mglStatus = sim.navStack.mgl.locked
        ? `LOCKED (±${sim.navStack.mgl.mglCorrectedErrorM}m)`
        : `VO DRIFT (±${sim.navStack.mgl.mglCorrectedErrorM}m)`;
      const flareTxt = state.flareAdvisory
        ? `${esc(state.flareAdvisory.classType)} (${esc(state.flareAdvisory.evaAdvisory)})`
        : (tr ? 'Senkronize ediliyor…' : 'Syncing DONKI…');
      const playLabel = state.povPlaying
        ? (tr ? '⏸ POV Akışını Duraklat' : '⏸ Pause POV Stream')
        : (tr ? '▶ POV Yürüyüş Sekansını Oynat' : '▶ Play POV Walk Sequence');

      body.innerHTML = `
        <div class="hud-visor-frame">
          <div class="hud-top-tape">
            <span><b>SUIT O2:</b> <b class="${sim.o2RemainPct >= sim.returnReserveO2Pct ? 'ok' : 'warn'}">${sim.o2RemainPct}%</b> (RSV ${sim.returnReserveO2Pct}%)</span>
            <span><b>CO2 RCA:</b> <b class="${sim.co2ScrubberRemainPct >= 25 ? 'ok' : 'warn'}">${sim.co2ScrubberRemainPct}%</b> (${sim.co2ProducedG}g)</span>
            <span><b>MGL POSE:</b> <b class="${sim.navStack.mgl.locked ? 'ok' : 'warn'}">${mglStatus}</b></span>
            <span><b>LCVG H2O:</b> <b class="ok">${(SUIT_WATER_CAP_L - sim.waterUsedL).toFixed(2)} L</b></span>
            <span><b>METABOLIC:</b> <b>${sim.metabolicKcalH} kcal/h</b> (${sim.metabolicW} W)</span>
            <span><b>DONKI 1AU:</b> <b id="hud-flare-chip" class="${state.flareAdvisory && String(state.flareAdvisory.classType).startsWith('X') ? 'warn' : 'ok'}">${flareTxt}</b></span>
          </div>
          <div class="hud-visor-stage">
            <img id="hud-pov-img" class="hud-pov-img hidden" alt="${esc(rover)} rover camera surface view at ${esc(wp.code)}">
            <canvas id="hud-pov-canvas" class="hud-pov-canvas" width="680" height="320" aria-label="Ground POV surface camera view inside astronaut helmet visor"></canvas>
            <div class="hud-visor-vignette" aria-hidden="true"></div>
          </div>
          <div class="hud-cam-status-bar">
            <span id="hud-cam-meta">${tr ? 'NASA Mars Rover Kamera Akışı bağlanıyor…' : 'Connecting NASA Mars Rover Camera feed…'}</span>
            <div class="hud-pov-controls">
              <button type="button" id="hud-btn-pov-prev" class="ghost" aria-label="${tr ? 'Önceki kare' : 'Previous POV frame'}">&#9664;</button>
              <button type="button" id="hud-btn-pov-play" class="btn-pov-play${state.povPlaying ? ' playing' : ''}">${playLabel}</button>
              <button type="button" id="hud-btn-pov-next" class="ghost" aria-label="${tr ? 'Sonraki kare' : 'Next POV frame'}">&#9654;</button>
            </div>
          </div>
          <div class="hud-rad-banner ${sim.withinWalkback && sim.returnReserveProtected ? 'ok' : 'warn'}">
            <span><b>MSL-RAD DOSE:</b> ${(zone.radMsvYr / 365.25).toFixed(2)}±0.12 mSv/sol (${sim.radDoseUsv}±${sim.radDoseUncUsv} uSv)</span>
            <span><b>WALKBACK LIMIT:</b> ${sim.walkbackRadiusM} m · <b>LIVE ETA:</b> ${sim.realTimeTracking.traveledDistM}/${sim.safeDistM}m · Base ${sim.realTimeTracking.etaReturnBaseMin} min</span>
            <span><b>RETURN RSV:</b> ${sim.returnReserveProtected ? (tr ? 'KORUNDU' : 'PROTECTED') : (tr ? 'KRİTİK' : 'LOW')}</span>
          </div>
        </div>
        <div class="hud-Action-row">
          <div class="hud-wp-tabs">${wpTabs}</div>
          <div class="hud-action-btns">
            <button type="button" id="hud-btn-laser" class="btn-spec">${state.laserOn ? (tr ? 'LIBS Lazer: AÇIK' : 'LIBS Laser: ON') : (tr ? 'LIBS Lazer: KAPALI' : 'LIBS Laser: OFF')}</button>
            <button type="button" id="hud-btn-sample" class="btn-spec">${tr ? `+${wp.sampleKg} kg Kaya Numunesi Al` : `Collect +${wp.sampleKg} kg Rock Sample`}</button>
          </div>
        </div>
        <div class="hud-telemetry-grid">
          <div class="live-card">
            <div class="sec-head"><h2>${tr ? 'Hedef Kaya & Mineraloji (Mastcam / PIXL)' : 'Target Lithology & Mineralogy (Mastcam / PIXL)'}</h2></div>
            <div class="kv"><span>${tr ? 'Koordinat & Tarih' : 'Coordinates & Obs Date'}</span><b>${wp.lat ?? zone.lat}°N, ${wp.lon ?? zone.lon}°E · ${esc(wp.obsDate || 'PDS')}</b></div>
            <div class="kv"><span>${tr ? 'NASA Veri Kaynağı' : 'NASA Dataset'}</span><b>${esc(wp.datasetId || wp.cam)}</b></div>
            <div class="kv"><span>${tr ? 'Kaya Türü' : 'Lithology'}</span><b>${esc(tr ? (wp.rockTypeTr || wp.rockType) : wp.rockType)}</b></div>
            <div class="kv"><span>${tr ? 'Mineral Fazı' : 'Mineral Phase'}</span><b>${esc(tr ? (wp.mineralogyTr || wp.mineralogy) : wp.mineralogy)}</b></div>
            <div class="kv"><span>${tr ? 'Astrobiyoloji & ISRU' : 'Astrobiology & ISRU'}</span><b>${esc(tr ? (wp.astrobioTr || wp.astrobio) : wp.astrobio)}</b></div>
            ${renderSpectralSVG(wp)}
          </div>
          <div class="live-card">
            <div class="sec-head"><h2>${tr ? 'Kimyasal Oksit Analizi & Görev Senkronu' : 'Chemical Composition & Mission Sync'}</h2></div>
            <div class="hud-chem-grid">${chemRows}</div>
            <div class="kv mt-sm"><span>${tr ? 'Toplam EVA Enerji & Süre' : 'Cumulative EVA Energy & Time'}</span><b>${sim.totalKcal} kcal (${sim.totalEvaH} h · +${sim.ascentM}m/-${sim.descentM}m)</b></div>
            <div class="kv"><span>${tr ? 'Otomatik Alternatif Rota' : 'AutoNav Reroute'}</span><b>${sim.safeDistM} m (0 risk) vs ${sim.orbitalDistM} m (${sim.orbitalHazardHits} iptal)</b></div>
            <div class="kv"><span>${tr ? 'Dönüş Durumu' : 'Return Status'}</span><b class="${sim.returnReserveProtected ? 'ok' : 'warn'}">${esc(tr ? sim.completionReport.returnStatusTr : sim.completionReport.returnStatus)}</b></div>
          </div>
        </div>`;

      const povCanvas = body.querySelector('#hud-pov-canvas');
      const povImg = body.querySelector('#hud-pov-img');
      const camMeta = body.querySelector('#hud-cam-meta');

      function activePov() {
        return state.povCache[cacheKey] || null;
      }

      function applyPovFrame(povRes) {
        if (state.hudReqId !== reqId) return;
        const frames = (povRes && Array.isArray(povRes.frames)) ? povRes.frames : [];
        if (frames.length > 0) {
          const idx = ((state.povFrameIdx % frames.length) + frames.length) % frames.length;
          const f = frames[idx];
          const roverTitle = rover === 'perseverance' ? 'Perseverance' : 'Curiosity';
          const solTag = f.sol !== null && f.sol !== undefined ? `Sol ${f.sol}` : (f.earthDate || 'Archive');
          if (camMeta) {
            camMeta.textContent = `● ${roverTitle} ${f.camera} · ${solTag} · ${tr ? 'Kare' : 'Frame'} ${idx + 1}/${frames.length} · ${povRes.source}`;
          }
          if (povImg && f.imgUrl) {
            povImg.onload = () => {
              if (state.hudReqId !== reqId) return;
              if (povImg.naturalWidth > 0) {
                povImg.classList.remove('hidden');
                if (povCanvas) {
                  drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                    transparentBackdrop: true,
                    frameIdx: idx,
                    camLabel: `${roverTitle} ${f.camera}`
                  });
                }
              }
            };
            povImg.onerror = () => {
              if (state.hudReqId !== reqId) return;
              povImg.classList.add('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: false,
                  frameIdx: state.povFrameIdx,
                  camLabel: wp.cam
                });
              }
            };
            if (povImg.getAttribute('src') !== f.imgUrl) {
              povImg.classList.add('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: false,
                  frameIdx: idx,
                  camLabel: `${roverTitle} ${f.camera}`
                });
              }
              povImg.setAttribute('src', f.imgUrl);
            } else if (povImg.complete && povImg.naturalWidth > 0) {
              povImg.classList.remove('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: true,
                  frameIdx: idx,
                  camLabel: `${roverTitle} ${f.camera}`
                });
              }
            }
            return;
          }
        }
        if (povImg) povImg.classList.add('hidden');
        if (povCanvas) {
          drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
            transparentBackdrop: false,
            frameIdx: state.povFrameIdx,
            camLabel: wp.cam
          });
        }
        if (camMeta) {
          camMeta.textContent = tr
            ? `● SENTETİK VİZÖR · ${rover.toUpperCase()} ${cameraHint} · Kare ${(Math.abs(state.povFrameIdx) % 6) + 1}/6`
            : `● PROCEDURAL VISOR · ${rover.toUpperCase()} ${cameraHint} · Frame ${(Math.abs(state.povFrameIdx) % 6) + 1}/6`;
        }
      }

      applyPovFrame(cachedPov);

      if (!cachedPov && liveApi && typeof liveApi.fetchRoverPovFrames === 'function') {
        liveApi.fetchRoverPovFrames(rover, {
          apiKey: readStoredApiKey(),
          cameraHint,
          searchQuery,
          limit: 6
        }).then((res) => {
          state.povCache[cacheKey] = res;
          if (state.hudReqId !== reqId) return;
          applyPovFrame(res);
        }).catch(() => {});
      }

      if (!state.flareAdvisory && liveApi && typeof liveApi.fetchSolarFlareAdvisory === 'function') {
        liveApi.fetchSolarFlareAdvisory(readStoredApiKey()).then((flr) => {
          state.flareAdvisory = flr;
          if (state.hudReqId !== reqId) return;
          const chip = body.querySelector('#hud-flare-chip');
          if (chip && flr) {
            chip.textContent = `${flr.classType} (${flr.evaAdvisory})`;
            chip.className = String(flr.classType).toUpperCase().startsWith('X') ? 'warn' : 'ok';
          }
        }).catch(() => {});
      }

      const btnPrev = body.querySelector('#hud-btn-pov-prev');
      if (btnPrev) {
        btnPrev.onclick = () => {
          stopPovPlay();
          state.povFrameIdx--;
          applyPovFrame(activePov());
        };
      }
      const btnNext = body.querySelector('#hud-btn-pov-next');
      if (btnNext) {
        btnNext.onclick = () => {
          stopPovPlay();
          state.povFrameIdx++;
          applyPovFrame(activePov());
        };
      }
      const btnPovPlay = body.querySelector('#hud-btn-pov-play');
      if (btnPovPlay) {
        btnPovPlay.onclick = () => {
          if (state.povPlaying) {
            stopPovPlay();
            return;
          }
          state.povPlaying = true;
          btnPovPlay.classList.add('playing');
          btnPovPlay.textContent = tr ? '⏸ POV Akışını Duraklat' : '⏸ Pause POV Stream';
          state.povFrameIdx++;
          applyPovFrame(activePov());
          if (typeof setInterval === 'function') {
            state.povTimer = setInterval(() => {
              if (state.hudReqId !== reqId) {
                stopPovPlay();
                return;
              }
              state.povFrameIdx++;
              applyPovFrame(activePov());
            }, 1650);
          }
        };
      }

      body.querySelectorAll('.hud-wp-tab').forEach(btn => {
        btn.onclick = () => {
          state.activeWpIdx = +btn.dataset.wpIdx;
          state.povFrameIdx = 0;
          stopPovPlay();
          renderHudModal();
          renderPanel();
        };
      });
      const btnLaser = body.querySelector('#hud-btn-laser');
      if (btnLaser) {
        btnLaser.onclick = () => {
          state.laserOn = !state.laserOn;
          renderHudModal();
        };
      }
      const btnSample = body.querySelector('#hud-btn-sample');
      if (btnSample) {
        btnSample.onclick = () => {
          state.loadKg = Math.min(35, +(state.loadKg + wp.sampleKg).toFixed(1));
          const loadSlider = $('#eva-load');
          if (loadSlider) loadSlider.value = String(Math.round(state.loadKg));
          if ($('#eva-load-v')) $('#eva-load-v').textContent = `${state.loadKg} kg`;
          recompute();
          renderHudModal();
        };
      }
    }

    function renderPanel() {
      const out = $('#eva-results');
      if (!out) return;
      const sim = state.sim || simulateEVA(currentZone(), state);
      syncStepUi(sim);
      const zone = sim.zone;
      const tr = isTr(), esc = getEsc();
      const activeWp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];

      const domainRows = DOMAINS.map(d => {
        const val = sim.domainScores[d.id];
        const cls = val >= 72 ? 'ok' : (val >= 52 ? 'warn' : 'bad');
        return `<div class="hls-check"><span class="hint">${esc(tr ? d.nameTr : d.name)}</span><b class="${cls}">${val}/100</b></div>`;
      }).join('');

      const discRows = sim.discrepancies.length
        ? sim.discrepancies.map(d =>
            `<div class="kv"><span>${esc(tr ? (d.titleTr || d.title) : d.title)}</span><b>${esc(d.delta)}</b></div>`
          ).join('')
        : `<div class="help note-sm">${tr ? 'Adım 0: Yalnızca ham uydu öncülü mevcut. Yüzey doğrulaması için taramayı başlatın.' : 'Step 0: Coarse Orbital Prior only. Step or Auto-Scan to assimilate live surface sensors.'}</div>`;

      const wpCards = zone.waypoints.map((wp, idx) => {
        const active = idx === state.activeWpIdx;
        return `<div class="eva-wp-card${active ? ' active' : ''}" data-wp="${idx}" role="button" tabindex="0">
          <div class="eva-wp-head">
            <b>${esc(wp.id)} · ${esc(tr ? (wp.nameTr || wp.name) : wp.name)}</b>
            <span class="badge-mode badge-live">${wp.lat ?? zone.lat}°N, ${wp.lon ?? zone.lon}°E</span>
          </div>
          <div class="help note-sm">${esc(wp.datasetId || wp.cam)} · ${esc(wp.obsDate || 'PDS')}</div>
          <div class="help note-sm">${esc(tr ? (wp.rockTypeTr || wp.rockType) : wp.rockType)} · SO3 ${wp.chem.SO3}% · H2O ${wp.chem.H2O}%</div>
          <div class="help note-sm">${esc(tr ? (wp.astrobioTr || wp.astrobio) : wp.astrobio)}</div>
        </div>`;
      }).join('');

      const hazLbl = (c) => c === 1 ? (tr ? 'Kaya Kümesi' : 'Boulders') : (c === 2 ? (tr ? 'Dik Yamaç' : 'Steep Scarp') : (c === 3 ? (tr ? 'Gevşek Kum/Toz' : 'Drift Sand') : (tr ? 'Temiz Zemin' : 'Clear Ground')));
      const probeHTML = sim.spotProbe ? `
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? 'Canlı AutoNav Nokta Sondajı (Harita Tıklaması)' : 'Live AutoNav Spot Probe (Canvas Click)'}</h2><span class="badge-mode badge-live">${sim.spotProbe.compositeScore}/100</span></div>
          <div class="kv"><span>${tr ? 'Yerel Hücre / Koordinat' : 'Local Metric Coords'}</span><b>(${sim.spotProbe.xMeters} m, ${sim.spotProbe.yMeters} m)</b></div>
          <div class="kv"><span>${tr ? 'Eğim / Termal Atalet' : 'Slope / Thermal Inertia'}</span><b>${sim.spotProbe.slope}° · TI ${sim.spotProbe.ti} tiu</b></div>
          <div class="kv"><span>${tr ? 'Zemin Sınıfı / GCR' : 'Surface Class / GCR'}</span><b>${esc(hazLbl(sim.spotProbe.hazardClass))} · ${sim.spotProbe.radMsvYr} mSv/${tr ? 'yıl' : 'yr'}</b></div>
        </div>` : '';

      const speTimeShown = sim.speAlert ? sim.speTimeToShelterMin : sim.speWorstCaseMin;
      const losOk = sim.commsLos && sim.commsLos.losClear;
      const losText = losOk
        ? (tr ? `Açık VHF Görüş (+${sim.commsLos.linkMarginDb} dB)` : `Direct VHF LoS (+${sim.commsLos.linkMarginDb} dB)`)
        : (tr ? `Arazi Gölgesi (${sim.commsLos.occludedSteps} adım → Röle)` : `Terrain Occluded (${sim.commsLos.occludedSteps} blk → Relay)`);
      const dtm = sim.dtmMetadata || zone.dtmMetadata || {};
      const rt = sim.realTimeTracking;
      const rr = sim.rerouteExplanation;
      const env = sim.envConditions;
      const ls = sim.lifeSupport;
      const cr = sim.completionReport;
      const restSummary = rt.evaRestStops.length
        ? rt.evaRestStops.map(r => `${r.id}@${r.atDistM}m (${r.durationMin}m)`).join(', ')
        : (tr ? 'Gerekmez (<600m)' : 'None (<600m)');

      out.innerHTML = `
        <div class="eva-zone-banner">
          <div class="eva-zone-title"><b>${esc(tr ? (zone.nameTr || zone.name) : zone.name)}</b></div>
          <div class="help note-sm">${esc(zone.hiRiseId)}</div>
          <div class="kv mt-sm"><span>${tr ? 'HiRISE DTM Ürünü & Çözünürlük' : 'HiRISE DTM Product & Post Spacing'}</span><b>${esc(dtm.productId || 'DTEEC_PDS')} · ${dtm.truePostSpacingM || 1.0} m/post -> 10 m/cell</b></div>
          <div class="kv"><span>${tr ? 'Stereo İşleme Yöntemi' : 'Stereo Processing Method'}</span><b>${esc(dtm.method || 'SOCET SET Photogrammetric Stereo')}</b></div>
          <p class="help note-sm">${esc(tr ? (dtm.coverageNoteTr || dtm.coverageNote || zone.summaryTr) : (dtm.coverageNote || zone.summary))}</p>
          <p class="help note-sm">${esc(tr ? sim.scaleSeparationNoteTr : sim.scaleSeparationNote)}</p>
        </div>
        <div class="row">
          <button type="button" id="btn-eva-demo" class="btn-spec btn-full">${tr ? '▶ Jüri Sunum Demosu (Tam Marswalk Senaryosu · Çevrimdışı Hazır)' : '▶ Run Jury Marswalk Demo (Full End-to-End Offline Scenario)'}</button>
        </div>
        <div class="eva-canvas-wrap">
          <canvas id="eva-local-canvas" class="eva-local-canvas" width="420" height="320" role="img" aria-label="1 km by 1 km xGDS 5-domain surface assimilation map; click terrain to probe and expand scan"></canvas>
        </div>
        <div class="help note-sm">${tr ? 'İpucu: Haritada herhangi bir noktaya tıklayarak anlık AutoNav sondajı yapın ve tarama alanını genişletin.' : 'Tip: Click any point on the local DEM to dispatch an AutoNav spot scan probe, or click a WP circle for HUD.'}</div>
        <div class="row">
          <button type="button" id="btn-open-hud" class="btn-spec btn-full">${tr ? `Kask Vizörü (HUD) & Yüzey Kamerasını Aç (${activeWp.id})` : `Open Helmet Visor HUD & Ground POV (${activeWp.id})`}</button>
        </div>
        <div class="row">
          <button type="button" id="btn-eva-expand" class="ghost btn-full">${state.centerExpanded ? (tr ? '⤡ Küresel Uydu Haritasına Dön' : '⤡ Restore Global Orbital Map') : (tr ? '⤢ 1 km Taktik Haritayı Merkez Ekranda Büyüt' : '⤢ Maximize 1 km Tactical Map in Center Viewport')}</button>
        </div>
        ${probeHTML}
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? '1. Gerçek Zamanlı Astronot Rota Takibi' : '1. Real-Time Astronaut Route Tracking'}</h2><span class="badge-mode badge-live">${rt.progressPct}%</span></div>
          <div class="kv"><span>${tr ? 'Anlık Astronot Konumu' : 'Live Astronaut Position'}</span><b>${rt.astronautLat}°N, ${rt.astronautLon}°E (${rt.astronautXMeters}m, ${rt.astronautYMeters}m)</b></div>
          <div class="kv"><span>${tr ? 'Yürünen / Kalan Mesafe' : 'Distance Walked / Remaining'}</span><b>${rt.traveledDistM} m / ${rt.remainDistM} m (Toplam ${sim.safeDistM} m)</b></div>
          <div class="kv"><span>${tr ? 'Aktif Segment & Sonraki Durak ETA' : 'Active Leg & Next WP ETA'}</span><b>${esc(rt.activeLegLabel)} · ${rt.distToNextWpM} m (${rt.etaNextWpMin} ${tr ? 'dk' : 'min'})</b></div>
          <div class="kv"><span>${tr ? 'Üsse Tahmini Varış (ETA) & Dönüş Noktası' : 'Base Return ETA & Turnaround'}</span><b class="ok">${rt.etaReturnBaseMin} ${tr ? 'dk' : 'min'} · Turnaround @ ${rt.turnaroundDistM} m</b></div>
          <div class="kv"><span>${tr ? 'Astronot Dinlenme Durakları (~600m)' : 'Astronot Micro-Rest Stops (~600m)'}</span><b>${esc(restSummary)}</b></div>
        </div>
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? '2–3. Dinamik Tehlike Algılama & Otomatik Alternatif Rota' : '2–3. Dynamic Hazard Detection & Auto-Reroute'}</h2><span class="badge-mode badge-live">0 HITS</span></div>
          <div class="kv"><span>${tr ? 'Önceki / Ham Uydu Rotası' : 'Previous / Naive Orbital Route'}</span><b class="bad">${esc(tr ? rr.cancelledRouteStatusTr : rr.cancelledRouteStatus)} (${rr.cancelledHazardHits} risk)</b></div>
          <div class="kv"><span>${tr ? 'Yeni AutoNav A* Rotası' : 'New AutoNav A* Safe Route'}</span><b class="ok">${esc(tr ? rr.newRouteStatusTr : rr.newRouteStatus)} (${sim.safeDistM} m)</b></div>
          <div class="kv"><span>${tr ? 'Yükselti Profili (Tırmanış / İniş / Eğim)' : 'Elevation Profile (Ascent / Descent / Max Slope)'}</span><b>+${sim.ascentM} m / -${sim.descentM} m · Max ${sim.maxSafeSlope}°</b></div>
          <p class="help note-sm">${esc(tr ? rr.reasonTr : rr.reasonEn)}</p>
        </div>
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? 'TRN + AutoNav + MGL Konum & Güven Kazancı' : 'TRN + AutoNav + MGL Localization & Confidence'}</h2></div>
          <div class="kv"><span>${tr ? 'TRN İniş Hassasiyeti' : 'TRN Touchdown'}</span><b class="ok">${sim.navStack.trn.touchdownErrorM} m (${tr ? 'uydu' : 'vs'} ${sim.navStack.trn.landingErrorEllipseOrbitalM} m)</b></div>
          <div class="kv"><span>${tr ? 'AutoNav Sindirim Alanı' : 'AutoNav Assimilation'}</span><b>%${sim.navStack.autonav.assimilatedPct} (${sim.navStack.autonav.hazardsMapped} ${tr ? 'engel hücresi' : 'hazard cells'})</b></div>
          <div class="kv"><span>${tr ? 'MGL Ufuk Kilidi' : 'MGL Horizon Lock'}</span><b class="${sim.navStack.mgl.locked ? 'ok' : 'warn'}">±${sim.navStack.mgl.mglCorrectedErrorM} m (VO ±${sim.navStack.mgl.uncorrectedOdometryDriftM} m)</b></div>
          <div class="kv"><span>${tr ? 'VHF Telsiz Görüş Hattı (LoS)' : 'VHF Radio Line-of-Sight'}</span><b class="${losOk ? 'ok' : 'warn'}">${esc(losText)}</b></div>
          <div class="kv"><span>${tr ? 'Uydu Öncülü -> Canlı xGDS Güveni' : 'Orbital Prior -> Live xGDS Confidence'}</span><b class="ok">${sim.orbitalConfidencePct}% -> ${sim.assimilatedConfidencePct}%</b></div>
        </div>
        <div class="sec-head"><h2>${tr ? 'xGDS 5-Alanlı Canlı Puanlama' : 'xGDS 5-Domain Dynamic Scoring'}</h2><span class="badge-mode badge-live">${sim.domainScores.composite}/100</span></div>
        <div class="hls-checks">${domainRows}</div>
        <div class="sec-head"><h2>${tr ? 'Uydu Öncülü vs Sahada Tespit Edilen Farklar (Δt Drift)' : 'Orbital Prior vs In-Situ Discrepancies (Δt Drift)'}</h2></div>
        ${discRows}
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? '4. Astronot Yaşam Destek (PLSS) & Dönüş Rezervi' : '4. Astronaut Life Support (PLSS) & Return Reserve'}</h2></div>
          <div class="hls-checks">
            <div class="hls-check"><span class="hint">${tr ? 'O2 Rezervi' : 'O2 Reserve'}</span><b class="${sim.o2RemainPct >= sim.returnReserveO2Pct ? 'ok' : 'warn'}">${sim.o2RemainPct}% (${tr ? 'Tüketim' : 'Used'} ${sim.o2UsedPct}%)</b></div>
            <div class="hls-check"><span class="hint">${tr ? 'CO2 Filtre (RCA)' : 'CO2 Scrubber'}</span><b class="${sim.co2ScrubberRemainPct >= 25 ? 'ok' : 'warn'}">${sim.co2ScrubberRemainPct}% (${sim.co2ProducedG}g)</b></div>
            <div class="hls-check"><span class="hint">${tr ? 'Batarya' : 'Suit Battery'}</span><b class="${sim.battRemainPct >= 30 ? 'ok' : 'warn'}">${sim.battRemainPct}%</b></div>
            <div class="hls-check"><span class="hint">${tr ? 'Soğutma H2O' : 'Cooling H2O'}</span><b class="${sim.waterRemainPct >= 30 ? 'ok' : 'warn'}">${sim.waterUsedL} L (${sim.waterRemainPct}%)</b></div>
          </div>
          <div class="kv"><span>${tr ? 'Dönüş + 30dk Acil Durum O2 Rezervi' : 'Return + 30m Emergency O2 Reserve'}</span><b class="${sim.returnReserveProtected ? 'ok' : 'bad'}">%${sim.returnReserveO2Pct} (${sim.returnReserveProtected ? (tr ? 'KORUNDU' : 'PROTECTED') : (tr ? 'RİSKLİ' : 'BREACHED')})</b></div>
          <div class="kv"><span>${tr ? 'Metabolik Yük & Yürüyüş Hızı' : 'Metabolic Rate & Effective Pace'}</span><b>${sim.metabolicKcalH} kcal/${tr ? 'sa' : 'h'} (${sim.metabolicW} W) · ${sim.effSpeedKmh} km/h</b></div>
          <div class="kv"><span>${tr ? 'Walkback Güvenli Geri Dönüş' : 'Walkback Safety Limit'}</span><b class="${sim.withinWalkback ? 'ok' : 'warn'}">${sim.walkbackRadiusM} m (${tr ? 'Azami' : 'Max'} ${sim.maxRadiusFromBaseM} m)</b></div>
          <div class="kv"><span>${tr ? 'SPE Sığınağa Acil Kaçış Süresi (≤30 dk)' : 'SPE Storm Time-to-Shelter (≤30m)'}</span><b class="${sim.speWithin30Min ? 'ok' : 'bad'}">${speTimeShown} ${tr ? 'dk' : 'min'} (${sim.speReturnDistM} m)</b></div>
          <p class="help note-sm">${esc(tr ? ls.xemuArchitectureNoteTr : ls.xemuArchitectureNote)}</p>
        </div>
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? '5. Çevresel Koşullar & Operasyonel Sınırlar' : '5. Environmental Conditions & Operational Limits'}</h2></div>
          <div class="kv"><span>${tr ? 'Yüzey Sıcaklığı & Giysi Isıtıcı Yükü' : 'Ambient Surface Temp & Suit Heater'}</span><b>${env.ambientTempC} °C · +${env.coldHeaterW} W</b></div>
          <div class="kv"><span>${tr ? 'Toz Optik Derinliği (τ) & Görüş Mesafesi' : 'Dust Optical Depth (τ) & Visibility'}</span><b>τ=${env.tau} · ${env.visibilityM} m (${Math.round(env.envSpeedFactor * 100)}% pace)</b></div>
          <div class="kv"><span>${tr ? 'Radyasyon Dozu & Gale Belirsizlik Aralığı' : 'Radiation Dose & Gale Uncertainty Band'}</span><b>${sim.radDoseUsv} ± ${sim.radDoseUncUsv} µSv (${sim.radBand.nominal} ± ${sim.radBand.uncMsvYr} mSv/yr · ±18.8%)</b></div>
          <div class="kv"><span>${tr ? 'Operasyonel Eğim Sınırı (Zemine Bağlı)' : 'Operational Slope Limit (Soil-Coupled)'}</span><b>${sim.maxSlope}° -> Etkin ${sim.slopeLimitInfo.effectiveMaxDeg}° (${esc(sim.slopeLimitInfo.soilClass)})</b></div>
          <p class="help note-sm">${esc(sim.slopeLimitInfo.note)}</p>
        </div>
        ${sim.dustMl ? `<div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? 'PIML 1-dk Toz & Vorteks Tahmini (MEDA/TWINS)' : 'PIML 1-min Vortex & Dust Nowcast (MEDA/TWINS)'}</h2><span class="badge-mode badge-live">ACC ${sim.dustMl.overallAccuracyPct}% · AUC ${sim.dustMl.overallRocAuc}</span></div>
          ${sim.dustMl.horizons.slice(0, 3).map(h => `<div class="kv"><span>${esc(tr ? h.horizonTr : h.horizonEn)} <small>(${esc(h.keyMetric)})</small></span><b class="${h.cls}">${h.probPct}% · ${esc(tr ? h.statusTr : h.statusEn)}</b></div>`).join('')}
        </div>` : ''}
        <div class="eva-drift-card" id="eva-completion-report">
          <div class="sec-head"><h2>${tr ? '6. Görev Tamamlanma Raporu (Mission Completion)' : '6. Mission Completion Report'}</h2><span class="badge-mode badge-live">${esc(cr.missionStatus)}</span></div>
          <div class="kv"><span>${tr ? 'Yürüyüş Süresi & Toplam Mesafe' : 'Walk Duration & Total Distance'}</span><b>${cr.durationH} ${tr ? 'saat' : 'h'} · ${cr.distanceM} m (+${cr.ascentM}m / -${cr.descentM}m)</b></div>
          <div class="kv"><span>${tr ? 'Tüketilen Kaynaklar (O2 / CO2 / Bat / H2O)' : 'Consumed Resources (O2 / CO2 / Batt / H2O)'}</span><b>${cr.consumed.o2G}g O2 (${cr.consumed.o2Pct}%) · ${cr.consumed.co2G}g CO2 (${cr.consumed.co2ScrubberPct}%) · ${cr.consumed.battPct}% Bat · ${cr.consumed.waterL}L H2O</b></div>
          <div class="kv"><span>${tr ? 'Karşılaşılan & Aşılan Tehlikeler' : 'Hazards Encountered & Bypassed'}</span><b>${cr.hazardsEncounteredAndBypassed} (${cr.reroutesExecuted} A* reroute)</b></div>
          <div class="kv"><span>${tr ? 'Toplanan Bilimsel Numune' : 'Collected Science Samples'}</span><b>${cr.samplesCollectedKg} kg (${cr.waypointsVisited} POI)</b></div>
          <div class="kv"><span>${tr ? 'Dönüş Durumu' : 'Return Status'}</span><b class="${sim.returnReserveProtected && sim.withinWalkback ? 'ok' : 'warn'}">${esc(tr ? cr.returnStatusTr : cr.returnStatus)}</b></div>
        </div>
        <div class="sec-head"><h2>${tr ? 'Bilimsel Hedef Noktaları (Science Waypoints)' : 'Science Waypoints (Click for HUD)'}</h2></div>
        <div class="eva-wp-list">${wpCards}</div>`;

      const localCanvas = out.querySelector('#eva-local-canvas');
      if (localCanvas) {
        drawLocalEvaCanvas(localCanvas, sim, state.activeWpIdx, state.laserOn);
        localCanvas.onclick = (e) => {
          const r = localCanvas.getBoundingClientRect();
          const gx = r.width ? ((e.clientX - r.left) / r.width) * 100 : 50;
          const gy = r.height ? ((e.clientY - r.top) / r.height) * 100 : 50;
          let bestIdx = state.activeWpIdx, bestD = 999;
          zone.waypoints.forEach((wp, i) => {
            const d = Math.hypot(wp.x - gx, wp.y - gy);
            if (d < bestD) { bestD = d; bestIdx = i; }
          });
          if (bestD < 11) {
            state.activeWpIdx = bestIdx;
            renderPanel();
            openHudModal(bestIdx);
          } else {
            const px = Math.max(2, Math.min(97, Math.round(gx)));
            const py = Math.max(2, Math.min(97, Math.round(gy)));
            state.customScanPts.push({ x: px, y: py, r: 11 });
            if (state.customScanPts.length > 12) state.customScanPts.shift();
            state.spotProbe = { x: px, y: py };
            recompute();
          }
        };
      }

      const btnDemo = out.querySelector('#btn-eva-demo');
      if (btnDemo) btnDemo.onclick = () => runJuryDemo();
      const btnHud = out.querySelector('#btn-open-hud');
      if (btnHud) btnHud.onclick = () => openHudModal(state.activeWpIdx);
      const btnExpand = out.querySelector('#btn-eva-expand');
      if (btnExpand) {
        btnExpand.onclick = () => {
          state.centerExpanded = !state.centerExpanded;
          if (S) S.evaExpanded = state.centerExpanded;
          renderPanel();
          if (onRedraw) onRedraw();
        };
      }

      out.querySelectorAll('.eva-wp-card').forEach(card => {
        const activate = () => {
          state.activeWpIdx = +card.dataset.wp;
          renderPanel();
          openHudModal(state.activeWpIdx);
        };
        card.onclick = activate;
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } };
      });
    }

    function runJuryDemo() {
      stopPlay();
      state.zoneId = 'jezero_delta';
      const sel = $('#eva-zone-select');
      if (sel) sel.value = 'jezero_delta';
      state.loadKg = 17.5;
      state.speedKmh = 2.4;
      state.maxSlope = 15;
      state.buddyMode = 'buddy';
      state.mglLocked = true;
      state.speAlert = false;
      state.activeWpIdx = 0;
      state.scanStep = 8;
      state.customScanPts = [{ x: 25, y: 36, r: 12 }, { x: 54, y: 26, r: 12 }];
      state.dynamicHazards = [{ x: 35, y: 58, r: 5, label: 'Jury Demo: Live Delta Scarp Rockfall' }];
      state.spotProbe = { x: 25, y: 36 };
      recompute();
    }

    function zoomToZone(zoneKeyOrCoords) {
      state.customScanPts = [];
      state.dynamicHazards = [];
      state.spotProbe = null;
      if (typeof zoneKeyOrCoords === 'string' && ZONES[zoneKeyOrCoords]) {
        state.zoneId = zoneKeyOrCoords;
      } else if (zoneKeyOrCoords && typeof zoneKeyOrCoords === 'object') {
        const { lat, lon, v, regionName } = zoneKeyOrCoords;
        const matched = zoneFromCoords(lat, lon, v, regionName);
        if (ZONES[matched.id]) {
          state.zoneId = matched.id;
        } else {
          state.zoneId = 'custom_site';
          state.customZone = matched;
        }
      }
      state.activeWpIdx = 0;
      const sel = $('#eva-zone-select');
      if (sel && ZONES[state.zoneId]) sel.value = state.zoneId;
      recompute();
      const z = currentZone();
      if (onSelectCoord && layers && layers.L) {
        onSelectCoord(layers.L.colOfLon(z.lon), layers.L.rowOfLat(z.lat), z.lat, z.lon);
      }
    }

    function bindControls() {
      const sel = $('#eva-zone-select');
      if (sel) sel.onchange = () => zoomToZone(sel.value);
      const domSel = $('#eva-domain-layer');
      if (domSel) domSel.onchange = () => { state.domainLayer = domSel.value; recompute(); };
      const scoreSel = $('#eva-score-mode');
      if (scoreSel) scoreSel.onchange = () => { state.scoreMode = scoreSel.value; recompute(); };
      const modeSel = $('#eva-buddy-mode');
      if (modeSel) modeSel.onchange = () => { state.buddyMode = modeSel.value; recompute(); };

      const scanSlider = $('#eva-scan-step');
      if (scanSlider) {
        scanSlider.oninput = () => {
          stopPlay();
          state.scanStep = +scanSlider.value;
          recompute();
        };
      }
      const btnReset = $('#btn-eva-reset');
      if (btnReset) {
        btnReset.onclick = () => {
          stopPlay();
          state.scanStep = 0;
          state.mglLocked = false;
          state.speAlert = false;
          state.customScanPts = [];
          state.dynamicHazards = [];
          state.spotProbe = null;
          recompute();
        };
      }
      const btnStep = $('#btn-eva-step');
      if (btnStep) btnStep.onclick = () => { stopPlay(); state.scanStep = Math.min(8, state.scanStep + 1); recompute(); };
      const btnPlay = $('#btn-eva-play');
      if (btnPlay) btnPlay.onclick = togglePlay;
      const btnScan = $('#btn-eva-scan');
      if (btnScan) btnScan.onclick = () => { stopPlay(); state.scanStep = 8; state.mglLocked = true; recompute(); };
      const btnMgl = $('#btn-eva-mgl');
      if (btnMgl) btnMgl.onclick = () => { state.mglLocked = !state.mglLocked; recompute(); };
      const btnSpe = $('#btn-eva-spe');
      if (btnSpe) btnSpe.onclick = () => { state.speAlert = !state.speAlert; recompute(); };
      const btnHazard = $('#btn-eva-hazard');
      if (btnHazard) {
        btnHazard.onclick = () => {
          const sim = state.sim || recompute();
          const path = sim.safePath || [];
          const pick = path.length > 6 ? path[Math.floor(path.length * (0.25 + (state.dynamicHazards.length * 0.23) % 0.6))] : [50, 50];
          state.dynamicHazards.push({ x: pick[0], y: pick[1], r: 5, label: 'Dynamic Rockfall / Drift Anomaly' });
          if (state.dynamicHazards.length > 4) state.dynamicHazards.shift();
          recompute();
        };
      }

      const bindWeight = (id, key) => {
        const el = $('#' + id);
        if (!el) return;
        el.oninput = () => {
          state.customWeights[key] = +el.value;
          if ($('#' + id + '-v')) $('#' + id + '-v').textContent = el.value + '%';
          recompute();
        };
      };
      bindWeight('eva-w-topo', 'topography');
      bindWeight('eva-w-geo', 'geomorphology');
      bindWeight('eva-w-therm', 'thermal');
      bindWeight('eva-w-rad', 'radiation');
      bindWeight('eva-w-opt', 'optical');

      const bindSlider = (id, fmt, fn) => {
        const el = $('#' + id);
        if (!el) return;
        const upd = () => {
          if ($('#' + id + '-v')) $('#' + id + '-v').textContent = fmt(+el.value);
          fn(+el.value);
        };
        el.oninput = upd;
        upd();
      };
      bindSlider('eva-load', v => v + ' kg', v => { state.loadKg = v; recompute(); });
      bindSlider('eva-speed', v => (v / 10).toFixed(1) + ' km/h', v => { state.speedKmh = v / 10; recompute(); });
      bindSlider('eva-maxslope', v => v + '°', v => { state.maxSlope = v; recompute(); });

      const closeBtn = $('#hud-close');
      if (closeBtn) closeBtn.onclick = closeHudModal;
      const modal = $('#hud-modal');
      if (modal) modal.onclick = (e) => { if (e.target.id === 'hud-modal') closeHudModal(); };
      recompute();
    }

    return {
      state,
      recompute,
      renderPanel,
      zoomToZone,
      openHudModal,
      closeHudModal,
      runJuryDemo,
      bindControls,
    };
  }

  global.MDE_EVA = {
    SYSTEM_ARCH,
    DOMAINS,
    SCORE_MODES,
    ZONES,
    BENCHMARK_TRAVERSES,
    buildLocalGrid,
    scoreLocalDomains,
    buildAssimilationMask,
    simulateEVA,
    validatePhase2Benchmarks,
    zoneFromCoords,
    drawLocalEvaCanvas,
    drawGroundPovCanvas,
    drawGlobalWalkbackOverlay,
    renderSpectralSVG,
    domainCellRgb,
    createEvaController,
    SIM: EVA_SIM,
    RENDER: EVA_RENDER,
  };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
