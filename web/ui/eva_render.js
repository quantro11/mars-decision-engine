// Legacy Phase-2 EVA rendering layer (canvas / SVG only, no simulation logic).
// Split out of ui/eva.js: domain colour ramps, 1 km tactical canvas, helmet ground-POV canvas,
// spectral SVG chart and the global-map walkback ring overlay.
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

  const getI18N = () => global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
  const isTr = () => { const m = getI18N(); return !!(m && m.getLang && m.getLang() === 'tr'); };

  function domainCellRgb(layerId, score, orbMode) {
    const t = Math.max(0, Math.min(1, score / 100));
    const dim = orbMode ? 0.55 : 1.0;
    if (layerId === 'thermal') {
      return [Math.round((42 + t * 175) * dim), Math.round((56 + t * 92) * dim), Math.round((130 - t * 82) * dim)];
    }
    if (layerId === 'radiation') {
      return [Math.round((135 - t * 80) * dim), Math.round((52 + t * 135) * dim), Math.round((125 - t * 40) * dim)];
    }
    if (layerId === 'optical') {
      return [Math.round((128 + t * 76) * dim), Math.round((78 + t * 94) * dim), Math.round((48 + t * 58) * dim)];
    }
    if (layerId === 'geomorphology') {
      return [Math.round((150 - t * 90) * dim), Math.round((58 + t * 124) * dim), Math.round((62 + t * 42) * dim)];
    }
    return [Math.round((54 + (1 - t) * 95) * dim), Math.round((46 + t * 112) * dim), Math.round((52 + t * 56) * dim)];
  }

  /**
   * Render 1 km x 1 km xGDS 5-domain heatmap, orbital-prior fog-of-war, TRN touchdown zone,
   * AutoNav scanned perimeter, Naive Orbital Route (red/amber) vs AutoNav Safe Route (emerald).
   */
  function drawLocalEvaCanvas(canvas, sim, activeWpIdx, laserOn) {
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const { grid, domainGrid, assimMask, zone, safePath, orbitalPath, walkbackRadiusM, maxRadiusFromBaseM, domainLayer } = sim;
    const N = grid.N;
    const sx = (x) => (x / N) * W;
    const sy = (y) => (y / N) * H;
    const tr = isTr();

    ctx.fillStyle = '#141110';
    ctx.fillRect(0, 0, W, H);
    const cellW = W / N, cellH = H / N;
    const layerArr = (domainGrid && domainGrid[domainLayer]) || (domainGrid && domainGrid.composite);

    for (let y = 0; y < N; y += 2) {
      for (let x = 0; x < N; x += 2) {
        const i = y * N + x;
        const known = assimMask && assimMask.mask[i] === 1;
        if (layerArr && domainLayer !== 'composite') {
          const val = known ? layerArr[i] : Math.max(25, Math.min(82, 64 - grid.orbSlope[i] * 2));
          const [r, g, b] = domainCellRgb(domainLayer, val, !known);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          const sl = known ? grid.slope[i] : grid.orbSlope[i];
          const hz = known ? grid.hazard[i] : 0;
          const shade = Math.max(16, Math.min(72, Math.round(32 + (grid.elev[i] - zone.elev) * 0.9 - sl * 0.8)));
          const boost = known ? 1.05 : 0.62;
          if (hz === 3) ctx.fillStyle = `rgb(${Math.round((shade + 26) * boost)},${Math.round((shade + 10) * boost)},${Math.round(Math.max(8, shade - 6) * boost)})`;
          else ctx.fillStyle = `rgb(${Math.round((shade + 14) * boost)},${Math.round((shade + 6) * boost)},${Math.round(Math.max(8, shade - 2) * boost)})`;
        }
        ctx.fillRect(x * cellW, y * cellH, cellW * 2 + 0.5, cellH * 2 + 0.5);
      }
    }

    // 100 m metric grid lines
    ctx.strokeStyle = 'rgba(237, 241, 247, 0.08)';
    ctx.lineWidth = 1;
    for (let g = 10; g < 100; g += 10) {
      ctx.beginPath(); ctx.moveTo(sx(g), 0); ctx.lineTo(sx(g), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, sy(g)); ctx.lineTo(W, sy(g)); ctx.stroke();
    }

    // Sand Traps (revealed strongly inside AutoNav mask, faint orbital estimate outside)
    for (const st of zone.sandTraps) {
      const idx = Math.max(0, Math.min(N * N - 1, Math.round(st.y) * N + Math.round(st.x)));
      const revealed = !assimMask || assimMask.mask[idx] === 1;
      ctx.save();
      ctx.fillStyle = revealed ? 'rgba(223, 179, 101, 0.24)' : 'rgba(223, 179, 101, 0.08)';
      ctx.strokeStyle = revealed ? 'rgba(223, 179, 101, 0.78)' : 'rgba(223, 179, 101, 0.28)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(sx(st.x), sy(st.y), (st.rx / N) * W, (st.ry / N) * H, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (revealed) {
        ctx.fillStyle = '#dfb365';
        ctx.font = '500 9.5px "Glacial Indifference", system-ui, sans-serif';
        ctx.fillText(st.label, sx(st.x) - 34, sy(st.y) + 3);
      }
      ctx.restore();
    }

    // Boulders & Steep Scarps
    for (const b of zone.boulders) {
      const idx = Math.max(0, Math.min(N * N - 1, Math.round(b.y) * N + Math.round(b.x)));
      const revealed = !assimMask || assimMask.mask[idx] === 1;
      if (!revealed) continue;
      const cx = sx(b.x), cy = sy(b.y), rad = (b.r / N) * W;
      ctx.save();
      ctx.fillStyle = 'rgba(222, 122, 107, 0.24)';
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 9.5px "Glacial Indifference", system-ui, sans-serif';
      ctx.fillText(b.label, cx - rad, cy - rad - 4);
      ctx.restore();
    }

    for (const w of zone.walls) {
      ctx.save();
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = ((w.w / N) * W) * 0.75;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(w.x1), sy(w.y1)); ctx.lineTo(sx(w.x2), sy(w.y2)); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 9.5px "Glacial Indifference", system-ui, sans-serif';
      ctx.fillText(w.label, sx((w.x1 + w.x2) / 2) - 42, sy((w.y1 + w.y2) / 2) - 7);
      ctx.restore();
    }

    // Walkback Safety Limit Circle
    const bx = sx(zone.base.x), by = sy(zone.base.y);
    const wbRadiusPx = Math.min(W * 0.92, (walkbackRadiusM / 1000) * W);
    ctx.save();
    ctx.fillStyle = sim.withinWalkback ? 'rgba(212, 173, 92, 0.08)' : 'rgba(223, 179, 101, 0.09)';
    ctx.beginPath(); ctx.arc(bx, by, wbRadiusPx, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sim.withinWalkback ? '#d4ad5c' : '#dfb365';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.arc(bx, by, wbRadiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = sim.withinWalkback ? '#adc7dd' : '#dfb365';
    ctx.font = '600 10px "Glacial Indifference", system-ui, sans-serif';
    const wbLabel = tr
      ? `WALKBACK SINIRI: ${walkbackRadiusM} m · SİNDİRİLEN: %${sim.navStack.autonav.assimilatedPct}`
      : `WALKBACK: ${walkbackRadiusM} m (Max ${maxRadiusFromBaseM} m) · ASSIM: ${sim.navStack.autonav.assimilatedPct}%`;
    ctx.fillText(wbLabel, 10, 17);
    ctx.restore();

    // Naive Orbital-Only Route (amber-red dashed) vs Live AutoNav A* Safe Route (emerald)
    if (orbitalPath && orbitalPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(222, 122, 107, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      orbitalPath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }
    if (safePath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      safePath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }

    // Dynamic User-Injected Anomalies (Rockfall / Sudden Dust Drift)
    if (Array.isArray(sim.dynamicHazards)) {
      for (const dh of sim.dynamicHazards) {
        const dx = sx(dh.x), dy = sy(dh.y), dr = ((dh.r || 5) / N) * W;
        ctx.save();
        ctx.fillStyle = 'rgba(222, 122, 107, 0.34)';
        ctx.strokeStyle = '#de7a6b';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#edf1f7';
        ctx.font = '600 9.5px "Glacial Indifference", system-ui, sans-serif';
        const i18n = getI18N();
        const anomalyTxt = (i18n && typeof i18n.pick === 'function')
          ? i18n.pick(tr, 'eva.anomalyLabel')
          : (tr ? '! DİNAMİK ENGEL' : '! ANOMALY');
        ctx.fillText(anomalyTxt, dx - dr, dy - dr - 4);
        ctx.restore();
      }
    }

    // Interactive User-Dispatched AutoNav Spot Scans & Probe Reticle
    if (Array.isArray(sim.customScanPts)) {
      for (const sp of sim.customScanPts) {
        ctx.save();
        ctx.strokeStyle = 'rgba(173, 199, 221, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx(sp.x), sy(sp.y), ((sp.r || 11) / N) * W, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    if (sim.spotProbe) {
      const px = sx(sim.spotProbe.x), py = sy(sim.spotProbe.y);
      ctx.save();
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py);
      ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6);
      ctx.stroke();
      ctx.restore();
    }

    // VHF Line-of-Sight Ray (Base Mast -> Rover/Crew Frontier)
    if (assimMask && sim.commsLos && sim.commsLos.distM >= 20) {
      ctx.save();
      ctx.strokeStyle = sim.commsLos.losClear ? 'rgba(125, 187, 142, 0.45)' : 'rgba(223, 179, 101, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(sx(assimMask.roverX), sy(assimMask.roverY));
      ctx.stroke();
      if (!sim.commsLos.losClear && sim.commsLos.blockPt) {
        const ox = sx(sim.commsLos.blockPt.x), oy = sy(sim.commsLos.blockPt.y);
        ctx.strokeStyle = '#dfb365';
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(ox - 4, oy - 4); ctx.lineTo(ox + 4, oy + 4); ctx.moveTo(ox + 4, oy - 4); ctx.lineTo(ox - 4, oy + 4); ctx.stroke();
      }
      ctx.restore();
    }

    // 30-Min SPE Emergency Return Escape Vector
    if (sim.speAlert && Array.isArray(sim.spePath) && sim.spePath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#dfb365';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      sim.spePath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }

    // Active AutoNav Sensor Cone & Real-Time Astronaut Position Marker
    if (assimMask) {
      const rx = sx(assimMask.roverX), ry = sy(assimMask.roverY);
      ctx.save();
      if (sim.scanStep < 8) {
        ctx.strokeStyle = 'rgba(212, 173, 92, 0.78)';
        ctx.fillStyle = 'rgba(212, 173, 92, 0.14)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rx, ry, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#7dbb8e';
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(rx, ry, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '600 9.5px "Glacial Indifference", system-ui, sans-serif';
      const rt = sim.realTimeTracking;
      const posLbl = rt ? `EVA (${rt.astronautXMeters}m,${rt.astronautYMeters}m · ETA ${rt.etaReturnBaseMin}m)` : 'EVA POS';
      ctx.fillText(posLbl, Math.min(W - 155, Math.max(8, rx - 35)), Math.max(28, ry - 9));
      ctx.restore();
    }

    // Astronaut Micro-Rest & Hydration Checkpoints (Item 6)
    if (sim.realTimeTracking && Array.isArray(sim.realTimeTracking.evaRestStops)) {
      sim.realTimeTracking.evaRestStops.forEach((rs, idx) => {
        const rx = sx(rs.x), ry = sy(rs.y);
        ctx.save();
        ctx.fillStyle = '#adc7dd';
        ctx.strokeStyle = '#181d26';
        ctx.lineWidth = 1.4;
        ctx.fillRect(rx - 3.5, ry - 3.5, 7, 7);
        ctx.strokeRect(rx - 3.5, ry - 3.5, 7, 7);
        ctx.fillStyle = '#adc7dd';
        ctx.font = '500 8.5px "Glacial Indifference", system-ui, sans-serif';
        ctx.fillText(`R${idx + 1}`, rx + 5, ry + 3);
        ctx.restore();
      });
    }

    // TRN Touchdown Pad Marker
    ctx.save();
    ctx.fillStyle = '#d4ad5c';
    ctx.strokeStyle = '#edf1f7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '600 10.5px "Glacial Indifference", system-ui, sans-serif';
    ctx.fillStyle = '#edf1f7';
    ctx.fillText(zone.base.label, bx + 10, by + 4);
    ctx.restore();

    // Waypoints
    zone.waypoints.forEach((wp, idx) => {
      const wx = sx(wp.x), wy = sy(wp.y);
      const isAct = idx === activeWpIdx;
      ctx.save();
      if (isAct) {
        ctx.strokeStyle = '#e27f91';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(wx, wy, 13, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = isAct ? '#cc5a70' : '#181d26';
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(wx, wy, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '600 10px "Glacial Indifference", system-ui, sans-serif';
      ctx.fillText(`${wp.id} · ${wp.code}`, wx + 10, wy + 3);
      ctx.restore();
    });

    // Bottom legend strip
    ctx.save();
    ctx.fillStyle = 'rgba(12, 15, 20, 0.86)';
    ctx.fillRect(8, H - 23, W - 16, 17);
    ctx.fillStyle = '#c9d1dc';
    ctx.font = '500 9.5px "Glacial Indifference", system-ui, sans-serif';
    ctx.fillText(
      tr
        ? `10m/hücre DEM · Yeşil=AutoNav | Kırmızı=Ham Uydu (${sim.orbitalHazardHits} risk)${sim.speAlert ? ' | Sarı=SPE Kaçış' : ''} · ${domainLayer.toUpperCase()}`
        : `10m/cell DEM · Green=AutoNav | Red=Orbital (${sim.orbitalHazardHits} haz)${sim.speAlert ? ' | Amber=SPE Escape' : ''} · ${domainLayer.toUpperCase()}`,
      12, H - 11
    );
    ctx.restore();
  }

  /**
   * Render Ground POV inside Helmet Visor HUD Canvas (#hud-pov-canvas) with MGL Pose Tie Points.
   * When opts.transparentBackdrop is true, only HUD reticle/telemetry overlays render so live NASA imagery shows through.
   */
  function drawGroundPovCanvas(canvas, sim, wp, laserOn, opts) {
    if (!canvas || !sim || !wp) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const tr = isTr();
    const o = opts || {};
    const transparentBackdrop = !!o.transparentBackdrop;
    const frameIdx = Number(o.frameIdx) || 0;
    const panPhase = frameIdx * 0.35;

    ctx.clearRect(0, 0, W, H);

    if (!transparentBackdrop) {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.46);
      if (wp.povTheme === 'ice') {
        sky.addColorStop(0, '#2a2423'); sky.addColorStop(0.55, '#684e42'); sky.addColorStop(1, '#b88c72');
      } else {
        sky.addColorStop(0, '#2d1c15'); sky.addColorStop(0.55, '#7c482b'); sky.addColorStop(1, '#c88355');
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H * 0.46);

      ctx.fillStyle = '#5c3724';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let x = 0; x <= W; x += 24) {
        const ridge = Math.sin(x * 0.012 + wp.heading + panPhase) * 18 + Math.cos(x * 0.027 - panPhase * 0.5) * 9;
        ctx.lineTo(x, H * 0.36 - ridge);
      }
      ctx.lineTo(W, H * 0.46); ctx.closePath(); ctx.fill();

      const gnd = ctx.createLinearGradient(0, H * 0.45, 0, H);
      gnd.addColorStop(0, '#6a3d26'); gnd.addColorStop(0.5, '#462819'); gnd.addColorStop(1, '#22140d');
      ctx.fillStyle = gnd;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);

      const shiftX = Math.sin(panPhase) * 28;
      ctx.save();
      if (wp.povTheme === 'ice') {
        ctx.fillStyle = 'rgba(173, 199, 221, 0.78)';
        ctx.strokeStyle = '#edf1f7';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(W * 0.5 + shiftX, H * 0.70, 125, 38, -0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(237, 241, 247, 0.45)';
        ctx.lineWidth = 1.2;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(W * 0.28 + shiftX, H * (0.70 + i * 0.025)); ctx.lineTo(W * 0.72 + shiftX, H * (0.68 + i * 0.025)); ctx.stroke();
        }
      } else if (wp.povTheme === 'boxwork') {
        ctx.fillStyle = 'rgba(90, 57, 38, 0.85)';
        ctx.beginPath(); ctx.moveTo(W * 0.16 + shiftX, H * 0.82); ctx.lineTo(W * 0.26 + shiftX, H * 0.56); ctx.lineTo(W * 0.74 + shiftX, H * 0.54); ctx.lineTo(W * 0.84 + shiftX, H * 0.82); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#d8b28e';
        ctx.lineWidth = 2.6;
        const ribs = [
          [0.24, 0.76, 0.42, 0.58], [0.42, 0.58, 0.61, 0.74], [0.36, 0.78, 0.56, 0.56],
          [0.56, 0.56, 0.75, 0.73], [0.28, 0.65, 0.71, 0.62], [0.22, 0.72, 0.78, 0.69]
        ];
        for (let r = 0; r < ribs.length; r++) {
          ctx.beginPath();
          ctx.moveTo(W * ribs[r][0] + shiftX, H * ribs[r][1]);
          ctx.lineTo(W * ribs[r][2] + shiftX, H * ribs[r][3]);
          ctx.stroke();
        }
      } else if (wp.povTheme === 'delta') {
        for (let l = 0; l < 6; l++) {
          ctx.strokeStyle = l % 2 === 0 ? '#9f5539' : '#733e2b';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(W * 0.20 + shiftX * 0.6, H * (0.56 + l * 0.04)); ctx.lineTo(W * 0.80 + shiftX * 0.6, H * (0.54 + l * 0.04)); ctx.stroke();
        }
        const spots = [[0.34, 0.64], [0.44, 0.71], [0.53, 0.62], [0.62, 0.69], [0.48, 0.66]];
        for (let s = 0; s < spots.length; s++) {
          const sxp = W * spots[s][0] + shiftX;
          const syp = H * spots[s][1];
          ctx.fillStyle = '#d8c2a6';
          ctx.beginPath(); ctx.arc(sxp, syp, 6.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#222936';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#3b483d';
          ctx.beginPath(); ctx.arc(sxp, syp, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        for (let l = 0; l < 6; l++) {
          ctx.strokeStyle = l % 2 === 0 ? '#b9855e' : '#855338';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(W * 0.22 + shiftX * 0.6, H * (0.56 + l * 0.04)); ctx.lineTo(W * 0.78 + shiftX * 0.6, H * (0.54 + l * 0.04)); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // MGL Horizon Silhouette Tie Points
    if (sim.navStack && sim.navStack.mgl && sim.navStack.mgl.locked) {
      ctx.save();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 1.4;
      for (let k = 1; k <= 5; k++) {
        const hx = Math.round((k / 6) * W);
        const hy = Math.round(H * 0.36 - (Math.sin(hx * 0.012 + wp.heading + panPhase) * 18 + Math.cos(hx * 0.027 - panPhase * 0.5) * 9));
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
      ctx.restore();
    }

    const tx = W * 0.5, ty = H * 0.67;
    ctx.save();
    ctx.strokeStyle = 'rgba(212, 173, 92, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    ctx.fillStyle = 'rgba(12, 15, 20, 0.80)';
    ctx.fillRect(W * 0.14, 14, W * 0.72, 24);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '600 10.5px "Glacial Indifference", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const mglTag = sim.navStack && sim.navStack.mgl && sim.navStack.mgl.locked
      ? `MGL ±${sim.navStack.mgl.mglCorrectedErrorM}m`
      : `VO DRIFT ±${sim.navStack.mgl.mglCorrectedErrorM}m`;
    const hdgVal = Math.round((wp.heading + frameIdx * 12) % 360);
    ctx.fillText(`HDG ${String(hdgVal).padStart(3, '0')}° ${wp.code} · ${mglTag} · ASSIM ${sim.navStack.autonav.assimilatedPct}%`, W * 0.5, 30);

    if (laserOn) {
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W * 0.85, H * 0.92); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#7dbb8e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(tx, ty, 22, 0, Math.PI * 2);
    ctx.moveTo(tx - 32, ty); ctx.lineTo(tx - 12, ty);
    ctx.moveTo(tx + 12, ty); ctx.lineTo(tx + 32, ty);
    ctx.moveTo(tx, ty - 32); ctx.lineTo(tx, ty - 12);
    ctx.moveTo(tx, ty + 12); ctx.lineTo(tx, ty + 32);
    ctx.stroke();

    // Target readout box: sized to its text (the fixed 250 px box used to clip "H2O x.x%")
    // and flipped to the left of the reticle when it would run past the visor edge.
    const line1 = `TARGET: ${wp.id} (${wp.code}) · ${laserOn ? 'LIBS PLASMA ACTIVE' : 'OPTICAL LOCK'}`;
    const line2 = `SiO2 ${wp.chem.SiO2}% · SO3 ${wp.chem.SO3}% · FeO ${wp.chem.FeO}% · H2O ${wp.chem.H2O}%`;
    ctx.font = '600 10px "Glacial Indifference", system-ui, sans-serif';
    ctx.textAlign = 'left';
    const boxW = Math.ceil(Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width)) + 12;
    let boxX = tx + 24;
    if (boxX + boxW > W - 12) boxX = Math.max(12, tx - 24 - boxW);
    ctx.fillStyle = 'rgba(12, 15, 20, 0.72)';
    ctx.fillRect(boxX, ty - 22, boxW, 38);
    ctx.fillStyle = '#7dbb8e';
    ctx.fillText(line1, boxX + 6, ty - 8);
    ctx.fillStyle = '#c9d1dc';
    ctx.fillText(line2, boxX + 6, ty + 8);

    ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
    ctx.fillRect(14, H - 34, W - 28, 22);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '500 10px "Glacial Indifference", system-ui, sans-serif';
    const camTag = (o.camLabel) || wp.cam;
    ctx.fillText(
      tr
        ? `xEMU HUD · ${camTag} · O2 %${sim.o2RemainPct} · BAT %${sim.battRemainPct} · ${sim.metabolicKcalH} kcal/h · ${mglTag}`
        : `xEMU HUD · ${camTag} · O2 ${sim.o2RemainPct}% · BATT ${sim.battRemainPct}% · ${sim.metabolicKcalH} kcal/h · ${mglTag}`,
      22, H - 19
    );
    ctx.restore();
  }

  function renderSpectralSVG(wp) {
    const chem = (wp && wp.chem) || {};
    const chemVal = (k, scale) => {
      const raw = chem[k] !== undefined ? chem[k] : chem[k.toLowerCase()];
      const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed / scale)) : 0;
    };
    const fe = chemVal('FeO', 24);
    const mg = chemVal('MgO', 20);
    const si = chemVal('SiO2', 58);
    const ca = chemVal('CaO', 14);
    const al = chemVal('Al2O3', 18);
    const so4 = chemVal('SO3', 26);
    const h2o = chemVal('H2O', 18);
    const hasChem = (fe + mg + si + ca + al + so4 + h2o) > 0.01;
    const basePeaks = (wp && wp.specPeaks) || [0.35, 0.65, 0.48, 0.82, 0.55, 0.72, 0.64, 0.88, 0.58, 0.75];
    const coupled = hasChem ? [
      0.16 + fe * 0.80,
      0.14 + mg * 0.78,
      0.22 + si * 0.68,
      0.18 + (fe + si) * 0.34,
      0.15 + ca * 0.76,
      0.14 + al * 0.72,
      0.18 + so4 * 0.80,
      0.16 + (so4 + fe) * 0.38,
      0.15 + h2o * 0.82,
      0.20 + (h2o + so4) * 0.36
    ] : basePeaks;
    const series = coupled.map((v, i) => {
      const b = basePeaks[i % basePeaks.length] || 0.5;
      const val = hasChem ? Math.max(0.08, Math.min(0.98, v * 0.78 + b * 0.22)) : b;
      const x = 16 + i * 28;
      const y = Math.round(78 - val * 54);
      return `${x},${y}`;
    }).join(' ');
    // Band markers sit on the series x positions (FeII=idx0, MgII=idx1, S=idx6, OH=idx8).
    // The two UV lines are only 28 px apart, so their labels go on two rows and the
    // left-most one is start-anchored instead of being centred on the chart edge.
    const bands = [
      { x: 16, lbl: '248nm FeII', anchor: 'start', row: 0 },
      { x: 44, lbl: '280nm MgII', anchor: 'start', row: 1 },
      { x: 184, lbl: '545nm S/SO4', anchor: 'middle', row: 0 },
      { x: 240, lbl: '656nm Ha/OH', anchor: 'middle', row: 1 }
    ];
    const markers = bands.map((b) =>
      `<line x1="${b.x}" y1="22" x2="${b.x}" y2="78" stroke="#2c3545" stroke-width="1" stroke-dasharray="2 2"/>` +
      `<text x="${b.x}" y="${b.row ? 98 : 89}" text-anchor="${b.anchor}" fill="#828c9c" font-size="7.5" font-family="Glacial Indifference, system-ui, sans-serif">${b.lbl}</text>`
    ).join('');
    const oxideSummary = hasChem
      ? `FeO ${chem.FeO ?? '-'} · MgO ${chem.MgO ?? '-'} · SO3 ${chem.SO3 ?? '-'} · H2O ${chem.H2O ?? '-'}`
      : 'LIBS + VNIR (0.25-2.5 um · Fe/Mg/Si/Ca/Al/SO4/OH)';
    return `<svg class="hud-spec-svg" viewBox="0 0 284 104" role="img" aria-label="LIBS and VNIR reflectance spectrum">
      <rect x="0" y="0" width="284" height="104" rx="4" fill="#12161d"/>
      <line x1="16" y1="78" x2="268" y2="78" stroke="#2c3545" stroke-width="1"/>
      ${markers}
      <polyline fill="none" stroke="#7dbb8e" stroke-width="2.2" points="${series}"/>
      <text x="14" y="13" fill="#adc7dd" font-size="8.2" font-family="Glacial Indifference, system-ui, sans-serif">${oxideSummary}</text>
    </svg>`;
  }

  function drawGlobalWalkbackOverlay(ctx, projectGrid, L, S, dpr = 1) {
    if (!ctx || !projectGrid || !L || !S) return;
    const evaSim = S.evaSim;
    if (S.mode === 'eva' && S.evaExpanded && evaSim && typeof document !== 'undefined' && document.createElement) {
      const cw = ctx.canvas ? ctx.canvas.width : 960;
      const ch = ctx.canvas ? ctx.canvas.height : 640;
      const pad = Math.round(26 * dpr);
      const boxW = Math.max(320, cw - pad * 2);
      const boxH = Math.max(240, ch - pad * 2 - Math.round(28 * dpr));
      const off = document.createElement('canvas');
      off.width = Math.min(960, Math.round(boxW));
      off.height = Math.min(720, Math.round(boxH));
      drawLocalEvaCanvas(off, evaSim, S.evaActiveWpIdx || 0, true);
      ctx.save();
      ctx.fillStyle = 'rgba(10, 12, 16, 0.92)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(off, pad, pad + Math.round(24 * dpr), boxW, boxH);
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(pad, pad + Math.round(24 * dpr), boxW, boxH);
      ctx.fillStyle = '#edf1f7';
      ctx.font = `600 ${Math.round(11 * dpr)}px "Glacial Indifference", system-ui, sans-serif`;
      const tr = isTr();
      const hdr = tr
        ? `FAZ 2 MERKEZ TAKTİK GÖRÜNÜM (1 km × 1 km @ 10m/hücre) · ${evaSim.zone.nameTr || evaSim.zone.name} · WALKBACK ${evaSim.walkbackRadiusM}m`
        : `PHASE 2 CENTER TACTICAL VIEWPORT (1 km × 1 km @ 10m/cell) · ${evaSim.zone.name} · WALKBACK ${evaSim.walkbackRadiusM}m`;
      ctx.fillText(hdr, pad + 6 * dpr, pad + Math.round(16 * dpr));
      ctx.restore();
      return;
    }
    const anchor = (S.mode === 'route' && S.route && S.route.goal)
      ? S.route.goal
      : (S.selected || (S.candidates && S.candidates[0]));
    if (!anchor) return;
    const [sx, sy, vis] = projectGrid(anchor.x + 0.5, anchor.y + 0.5);
    if (!vis) return;
    const walkbackKm = evaSim ? (evaSim.walkbackRadiusM / 1000) : 1.25;
    const radiusPx = Math.max(18 * dpr, Math.min(56 * dpr, (S.view ? S.view.scale : 2) * 5.5 * dpr));
    ctx.save();
    ctx.strokeStyle = '#7dbb8e';
    ctx.lineWidth = 1.8 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(12, 15, 20, 0.85)';
    const lbl = `EVA WALKBACK ${walkbackKm.toFixed(2)} km`;
    ctx.font = `600 ${Math.round(9.5 * dpr)}px "Glacial Indifference", system-ui, sans-serif`;
    const tw = ctx.measureText(lbl).width;
    ctx.fillRect(sx - tw / 2 - 4 * dpr, sy - radiusPx - 14 * dpr, tw + 8 * dpr, 13 * dpr);
    ctx.fillStyle = '#7dbb8e';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, sx, sy - radiusPx - 5 * dpr);
    ctx.restore();
  }


  global.MDE_EVA_RENDER = {
    domainCellRgb,
    drawLocalEvaCanvas,
    drawGroundPovCanvas,
    renderSpectralSVG,
    drawGlobalWalkbackOverlay,
  };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
