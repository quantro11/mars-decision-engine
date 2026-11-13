// 2D Equirectangular Canvas & Unified 2D/3D Pointer / Touch / Keyboard Viewport Controller.
(function (global) {
  'use strict';

  /**
   * Create the interactive 2D/3D viewport controller.
   * @param {Object} opts
   */
  function createViewport(opts) {
    const {
      doc = global.document, S, layers, SCORING, REGIONS, OVERLAYS, MARKERS, FMT, globe, globeCanvas,
      onPick, onStopSpin,
    } = opts;
    const $ = (s) => doc.querySelector(s);
    const canvas = $('#map');
    const ctx = canvas.getContext('2d');
    const W = layers.W, H = layers.H, L = layers.L, MARS_R = layers.MARS_R;
    const { fmtLat, fmtLon, escHtml } = FMT;

    const ovCanvas = doc.createElement('canvas'); ovCanvas.width = W; ovCanvas.height = H;
    const ovCtx = ovCanvas.getContext('2d');
    const ovImg = ovCtx.createImageData(W, H);
    const radLut = OVERLAYS.buildRadLut(layers.L.meta.elev, SCORING);
    let ovDirty = true, viewReady = false, raf3D = 0;

    const toScreen = (x, y) => [S.view.tx + x * S.view.scale, S.view.ty + y * S.view.scale];
    const toGrid = (sx, sy) => [(sx - S.view.tx) / S.view.scale, (sy - S.view.ty) / S.view.scale];

    function projectGrid(gx, gy) {
      if (S.viewMode === '3d' && globe) return globe.project(L.latOfRow(gy), L.lonOfCol(gx), true);
      const [sx, sy] = toScreen(gx, gy);
      return [sx, sy, true];
    }

    const { drawCandidateReticle, drawSelectionReticle, drawWaypoint, drawStationBeacon } = MARKERS.createMarkers(ctx, projectGrid);

    function wrapView() {
      const span = W * S.view.scale;
      while (S.view.tx > span) S.view.tx -= span;
      while (S.view.tx < -span) S.view.tx += span;
      const maxTy = canvas.height * 0.5, minTy = canvas.height * 0.5 - H * S.view.scale;
      S.view.ty = Math.max(minTy, Math.min(maxTy, S.view.ty));
    }

    function updateScaleBar() {
      const elLbl = $('#scale-label'), elBar = $('#scale-bar');
      if (!elLbl || !elBar) return;
      let kmPerCssPx;
      if (S.viewMode === '3d' && globe) {
        kmPerCssPx = globe.equatorialKmPerCssPx();
      } else {
        const kmPerGridPx = (2 * Math.PI * MARS_R) / W;
        const cssPxPerGridPx = S.view.scale / (global.devicePixelRatio || 1);
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

    function buildOverlay() {
      OVERLAYS.fillOverlayBuffer(ovImg.data, S.overlay, L, S.score, radLut);
      ovCtx.putImageData(ovImg, 0, 0);
      if (globe) globe.updateOverlay(ovCanvas);
      ovDirty = false;
    }

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

    function fitView() {
      const s = Math.min(canvas.width / W, canvas.height / H);
      S.view = { scale: s, tx: (canvas.width - W * s) / 2, ty: (canvas.height - H * s) / 2 };
      if (globe && S.viewMode === '3d') {
        globe.state.targetDist = 2.55;
        schedule3D();
      }
      updateScaleBar();
    }

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      const cx = canvas.width / 2, cy = canvas.height / 2, [gx, gy] = toGrid(cx, cy);
      const cw = Math.max(1, Math.floor(r.width * (global.devicePixelRatio || 1)));
      const ch = Math.max(1, Math.floor(r.height * (global.devicePixelRatio || 1)));
      canvas.width = cw;
      canvas.height = ch;
      if (globeCanvas) { globeCanvas.width = cw; globeCanvas.height = ch; }
      if (!viewReady) { fitView(); viewReady = true; }
      else { S.view.tx = canvas.width / 2 - gx * S.view.scale; S.view.ty = canvas.height / 2 - gy * S.view.scale; wrapView(); }
      updateScaleBar();
      draw();
    }

    function draw2DGraticule(dpr) {
      const { scale, tx, ty } = S.view;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
      ctx.lineWidth = 1;
      ctx.font = `500 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      for (let lon = -180; lon <= 180; lon += 30) {
        const [x0] = toScreen(L.colOfLon(Math.min(lon, 179.99)), 0);
        ctx.beginPath(); ctx.moveTo(x0, Math.max(0, ty)); ctx.lineTo(x0, Math.min(canvas.height, ty + H * scale)); ctx.stroke();
        if (lon > -180 && lon < 180 && x0 > 30 * dpr && x0 < canvas.width - 30 * dpr) {
          const lbl = lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
          ctx.textAlign = 'center'; ctx.fillText(lbl, x0, Math.max(46 * dpr, ty + 12 * dpr));
        }
      }
      ctx.textAlign = 'left';
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, y0] = toScreen(0, L.rowOfLat(lat));
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke();
        if (y0 > 48 * dpr && y0 < canvas.height - 40 * dpr) {
          const lbl = lat === 0 ? 'EQ 0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
          ctx.fillText(lbl, 12 * dpr, y0 - 4 * dpr);
        }
      }
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      for (const lat of [50, -50]) {
        const [, y0] = toScreen(0, L.rowOfLat(lat));
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke();
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
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath(); let open = false;
        for (let lat = -80; lat <= 80; lat += 5) {
          const [sx, sy, vis] = globe.project(lat, lon, false);
          if (!vis) { open = false; continue; }
          if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath(); let open = false;
        for (let lon = -180; lon <= 180; lon += 5) {
          const [sx, sy, vis] = globe.project(lat, lon, false);
          if (!vis) { open = false; continue; }
          if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      for (const lat of [50, -50]) {
        ctx.beginPath(); let open = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const [sx, sy, vis] = globe.project(lat, lon, false);
          if (!vis) { open = false; continue; }
          if (!open) { ctx.moveTo(sx, sy); open = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    function draw() {
      const baseImg = layers.getBaseImg();
      if (!baseImg) return;
      if (ovDirty) buildOverlay();
      const dpr = global.devicePixelRatio || 1;
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
          ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.3 * dpr; ctx.strokeRect(x - s, y - s, s * 2, s * 2);
        } else {
          ctx.fillStyle = r.mission ? '#7f9bb3' : 'rgba(226, 232, 240, 0.78)';
          ctx.beginPath(); ctx.arc(x, y, (r.mission ? 2.8 : 2) * dpr, 0, Math.PI * 2); ctx.fill();
        }
        if (ez || effScale >= 1.5 || (r.mission && effScale >= 1.1)) {
          ctx.fillStyle = 'rgba(3, 5, 8, 0.82)'; ctx.fillText(r.name, x + 7 * dpr, y + 1 * dpr);
          ctx.fillStyle = ez ? '#6ee7b7' : (r.mission ? '#bae6fd' : 'rgba(241, 245, 249, 0.92)'); ctx.fillText(r.name, x + 6 * dpr, y);
        }
      }

      const drawPath = (path, color, width, dash) => {
        if (!path) return;
        ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.setLineDash(dash || []); ctx.beginPath();
        let px = null, wasVis = false;
        for (const n of path) {
          const y = (n / W) | 0, x = n - y * W;
          const [sx, sy, vis] = projectGrid(x + 0.5, y + 0.5);
          if (!vis) { wasVis = false; px = null; continue; }
          if (!wasVis || (S.viewMode === '2d' && px !== null && Math.abs(sx - px) > W * S.view.scale / 2)) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
          px = sx; wasVis = true;
        }
        ctx.stroke(); ctx.setLineDash([]);
      };
      if (S.route.straight) drawPath(S.route.straight.path, '#ef4444', 1.8, [6 * dpr, 4 * dpr]);
      if (S.route.safe) drawPath(S.route.safe.path, '#10b981', 2.8);
      if (S.route.start) drawWaypoint(S.route.start.x, S.route.start.y, '#7fae8c', 'Start');
      if (S.route.goal) drawWaypoint(S.route.goal.x, S.route.goal.y, '#cfa25c', 'Goal');

      S.candidates.forEach((c, i) => {
        drawCandidateReticle(c.x, c.y, i + 1, c.score, !!(S.selected && S.selected.cand === i));
      });
      if (S.crisis.site) drawStationBeacon(S.crisis.site.x, S.crisis.site.y);
      if (S.selected && S.selected.cand == null) drawSelectionReticle(S.selected.x + 0.5, S.selected.y + 0.5);
    }

    function zoomBy(factor) {
      if (S.viewMode === '3d' && globe) {
        globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist / factor));
        schedule3D();
        return;
      }
      const mx = canvas.width / 2, my = canvas.height / 2;
      const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
      const ns = Math.max(minS, Math.min(40, S.view.scale * factor));
      const k = ns / S.view.scale;
      S.view.tx = mx - (mx - S.view.tx) * k; S.view.ty = my - (my - S.view.ty) * k;
      S.view.scale = ns; wrapView(); updateScaleBar(); draw();
    }

    function gridAt(e) {
      const r = canvas.getBoundingClientRect();
      const dpr = global.devicePixelRatio || 1;
      const sx = (e.clientX - r.left) * dpr, sy = (e.clientY - r.top) * dpr;
      if (S.viewMode === '3d' && globe) {
        const hit = globe.unproject(sx, sy);
        return hit ? [hit[0], hit[1]] : null;
      }
      let [gx, gy] = toGrid(sx, sy);
      gx = ((Math.floor(gx) % W) + W) % W; gy = Math.floor(gy);
      if (gy < 0 || gy >= H) return null;
      return [gx, gy];
    }

    let drag = null, moved = false, lastTouchTap = 0, touchState = null;
    canvas.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty, rLat: globe ? globe.state.targetLat : 0, rLon: globe ? globe.state.targetLon : 0 };
      moved = false;
    });
    global.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dpr = global.devicePixelRatio || 1;
      const dx = (e.clientX - drag.x) * dpr, dy = (e.clientY - drag.y) * dpr;
      if (Math.hypot(dx, dy) > 3) moved = true;
      if (S.viewMode === '3d' && globe) {
        const sens = 0.14 * (globe.state.camDist - 0.85) / dpr;
        globe.state.targetLon = drag.rLon - dx * sens;
        globe.state.targetLat = Math.max(-82, Math.min(82, drag.rLat + dy * sens));
        if (onStopSpin) onStopSpin();
        schedule3D();
      } else {
        S.view.tx = drag.tx + dx; S.view.ty = drag.ty + dy; wrapView(); draw();
      }
    });
    global.addEventListener('mouseup', () => { drag = null; });
    canvas.addEventListener('click', (e) => {
      if (moved || performance.now() - lastTouchTap < 450) return;
      const g = gridAt(e); if (g && onPick) onPick(g[0], g[1]);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (S.viewMode === '3d' && globe) {
        const f = Math.exp(e.deltaY * 0.0012);
        globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist * f));
        schedule3D();
        return;
      }
      const dpr = global.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
      const f = Math.exp(-e.deltaY * 0.0015), minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
      const ns = Math.max(minS, Math.min(40, S.view.scale * f)), k = ns / S.view.scale;
      S.view.tx = mx - (mx - S.view.tx) * k; S.view.ty = my - (my - S.view.ty) * k; S.view.scale = ns;
      wrapView(); updateScaleBar(); draw();
    }, { passive: false });
    canvas.addEventListener('mousemove', (e) => {
      const g = gridAt(e), tip = $('#tooltip');
      if (!g) { if (tip) tip.classList.add('hidden'); return; }
      const [x, y] = g, v = layers.cellValues(x, y), s = S.score[y * W + x], nr = layers.nearestRegion(v.lat, v.lon);
      if ($('#hud-coord')) $('#hud-coord').textContent = `LAT ${fmtLat(v.lat)} · LON ${fmtLon(v.lon)} · ELEV ${v.elev.toFixed(0)} m · SLOPE ${v.slope.toFixed(1)}° · SCORE ${s.toFixed(2)}` + ($('#hud-coord').dataset.t ? ` · ${$('#hud-coord').dataset.t} ms` : '');
      if (tip) {
        tip.innerHTML = `<span class="tt-region">${escHtml(nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name)}</span><b>${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))}</b> · score <b>${s.toFixed(2)}</b><br>elev ${v.elev.toFixed(0)} m · slope ${v.slope.toFixed(1)}°<br>rad ${v.rad.toFixed(0)} mSv/yr · ice ${v.ice === null ? '—' : v.ice.toFixed(2)}<br>rough ${v.rough.toFixed(0)} m · TI ${v.ti === null ? '—' : v.ti.toFixed(0)} · dust ${v.dust === null ? '—' : (v.dust * 100).toFixed(0) + '%'}`;
        const r = canvas.getBoundingClientRect();
        tip.style.left = Math.max(8, Math.min(r.width - 210, e.clientX - r.left + 14)) + 'px';
        tip.style.top = Math.max(8, Math.min(r.height - 95, e.clientY - r.top + 14)) + 'px';
        tip.classList.remove('hidden');
      }
    });
    canvas.addEventListener('mouseleave', () => { if ($('#tooltip')) $('#tooltip').classList.add('hidden'); });

    function handleCanvasKey(e) {
      const panStep = 80 * (global.devicePixelRatio || 1);
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
        if (onStopSpin) onStopSpin();
        schedule3D();
      } else {
        S.view.tx += dx * panStep; S.view.ty += dy * panStep; wrapView(); draw();
      }
    }
    canvas.addEventListener('keydown', handleCanvasKey);
    if (globeCanvas) globeCanvas.addEventListener('keydown', handleCanvasKey);

    canvas.addEventListener('touchstart', (e) => {
      const dpr = global.devicePixelRatio || 1;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchState = { mode: 'drag', x: t.clientX, y: t.clientY, moved: false, tx: S.view.tx, ty: S.view.ty, rLat: globe ? globe.state.targetLat : 0, rLon: globe ? globe.state.targetLon : 0 };
      } else if (e.touches.length === 2) {
        const [t1, t2] = e.touches, rect = canvas.getBoundingClientRect();
        touchState = { mode: 'pinch', moved: true, dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1, scale: S.view.scale, tx: S.view.tx, ty: S.view.ty, mx: ((t1.clientX + t2.clientX) / 2 - rect.left) * dpr, my: ((t1.clientY + t2.clientY) / 2 - rect.top) * dpr, camDist: globe ? globe.state.targetDist : 2.55 };
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!touchState) return;
      e.preventDefault();
      const dpr = global.devicePixelRatio || 1;
      if (touchState.mode === 'drag' && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = (t.clientX - touchState.x) * dpr, dy = (t.clientY - touchState.y) * dpr;
        if (Math.hypot(dx, dy) > 6) touchState.moved = true;
        if (S.viewMode === '3d' && globe) {
          const sens = 0.14 * (globe.state.camDist - 0.85) / dpr;
          globe.state.targetLon = touchState.rLon - dx * sens;
          globe.state.targetLat = Math.max(-82, Math.min(82, touchState.rLat + dy * sens));
          if (onStopSpin) onStopSpin();
          schedule3D();
        } else { S.view.tx = touchState.tx + dx; S.view.ty = touchState.ty + dy; wrapView(); draw(); }
      } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
        const [t1, t2] = e.touches, rect = canvas.getBoundingClientRect();
        const d = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1, ratio = d / touchState.dist;
        if (S.viewMode === '3d' && globe) {
          globe.state.targetDist = Math.max(1.22, Math.min(4.6, touchState.camDist / ratio));
          schedule3D();
        } else {
          const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) * dpr, my = ((t1.clientY + t2.clientY) / 2 - rect.top) * dpr;
          const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9, ns = Math.max(minS, Math.min(40, touchState.scale * ratio));
          const k = ns / touchState.scale;
          S.view.scale = ns; S.view.tx = mx - (touchState.mx - touchState.tx) * k; S.view.ty = my - (touchState.my - touchState.ty) * k;
          wrapView(); updateScaleBar(); draw();
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (touchState && touchState.mode === 'drag' && !touchState.moved && e.changedTouches.length === 1) {
        const t = e.changedTouches[0]; lastTouchTap = performance.now();
        const g = gridAt(t); if (g && onPick) onPick(g[0], g[1]);
      }
      if (e.touches.length === 0) touchState = null;
    });

    return {
      canvas,
      markOverlayDirty: () => { ovDirty = true; },
      buildOverlay,
      resize,
      fitView,
      wrapView,
      updateScaleBar,
      schedule3D,
      draw,
      zoomBy,
      toScreen,
      toGrid,
      gridAt,
    };
  }

  global.MDE_MAP2D = { createViewport };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
