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

    // ---- Zoom-dependent relief detail tiles (tools/build_detail_tiles.mjs, MOLA-HRSC 200 m DEM)
    // Base map = level 3 (4096 px wide, ~5.2 km/px). When zoomed in, sharper 256 px tiles for only the
    // visible area are fetched from tiles/relief/{z}/{x}_{y}.png and blended over the colour mosaic.
    const detail = { manifest: null, levels: [], cache: new Map(), pending: 0, enabled: true, activeKmPerPx: null };
    const DETAIL_MAX_CACHE = 600;
    function loadDetailManifest() {
      if (typeof fetch !== 'function' || (typeof location !== 'undefined' && location.protocol === 'file:')) return;
      fetch('tiles/manifest.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          if (!m || !Array.isArray(m.levels) || !m.levels.length) return;
          detail.manifest = m;
          detail.levels = m.levels.slice().sort((a, b) => a.z - b.z);
          updateScaleBar(); draw();
        })
        .catch(() => {});
    }
    function detailTile(z, x, y) {
      const key = z + '/' + x + '_' + y;
      let e = detail.cache.get(key);
      if (e) { detail.cache.delete(key); detail.cache.set(key, e); return e.ok ? e.img : null; }
      if (detail.pending > 24) return null;
      const img = new Image();
      e = { img, ok: false };
      detail.cache.set(key, e);
      detail.pending++;
      img.onload = () => { e.ok = true; detail.pending--; draw(); };
      img.onerror = () => { detail.pending--; };
      img.src = 'tiles/relief/' + key + '.png';
      if (detail.cache.size > DETAIL_MAX_CACHE) detail.cache.delete(detail.cache.keys().next().value);
      return null;
    }
    function pickDetailLevel(scale) {
      if (!detail.enabled || !detail.levels.length || scale < 1.4) return null;
      const base = detail.manifest.baseLevel || 3;
      const want = base + Math.ceil(Math.log2(scale));
      let lv = null;
      for (const l of detail.levels) if (l.z <= want) lv = l;
      return lv || null;
    }
    /** Draw visible relief tiles for one horizontal world copy starting at screen x = sx. */
    function drawDetailTiles(sx, ty, scale) {
      const lv = pickDetailLevel(scale);
      detail.activeKmPerPx = lv ? lv.kmPerPx : null;
      if (!lv) return;
      const T = detail.manifest.tileSize || 256;
      const k = lv.width / W;                 // tile pixels per base-grid pixel
      const tileScreen = (T / k) * scale;     // on-screen size of one tile
      const gx0 = Math.max(0, (0 - sx) / scale), gx1 = Math.min(W, (canvas.width - sx) / scale);
      const gy0 = Math.max(0, (0 - ty) / scale), gy1 = Math.min(H, (canvas.height - ty) / scale);
      if (gx1 <= gx0 || gy1 <= gy0) return;
      const tx0 = Math.floor((gx0 * k) / T), tx1 = Math.min(lv.tilesX - 1, Math.floor((gx1 * k) / T));
      const ty0 = Math.floor((gy0 * k) / T), ty1 = Math.min(lv.tilesY - 1, Math.floor((gy1 * k) / T));
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.95;
      for (let yy = ty0; yy <= ty1; yy++) {
        for (let xx = tx0; xx <= tx1; xx++) {
          let img = detailTile(lv.z, xx, yy);
          let srcLv = lv;
          if (!img) {
            // Fall back to the parent tile at a coarser level while the sharp one downloads
            const parent = detail.levels.filter((l) => l.z < lv.z).pop();
            if (parent) {
              const f = lv.width / parent.width;
              const pimg = detailTile(parent.z, Math.floor(xx / f), Math.floor(yy / f));
              if (pimg) {
                const ox = (xx % f) * (T / f), oy = (yy % f) * (T / f);
                ctx.drawImage(pimg, ox, oy, T / f, T / f, sx + xx * tileScreen, ty + yy * tileScreen, tileScreen + 0.5, tileScreen + 0.5);
              }
            }
            continue;
          }
          ctx.drawImage(img, sx + xx * tileScreen, ty + yy * tileScreen, tileScreen + 0.5, tileScreen + 0.5);
        }
      }
      ctx.restore();
    }

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
      const baseKm = (2 * Math.PI * MARS_R) / W;
      const lv = S.viewMode === '3d' ? null : pickDetailLevel(S.view.scale);
      const dataKm = lv ? lv.kmPerPx : baseKm;
      elLbl.textContent = `${niceKm} km · data ${dataKm < 1 ? Math.round(dataKm * 1000) + ' m' : dataKm.toFixed(1) + ' km'}/px`;
      elLbl.title = lv ? `Relief detail tiles z${lv.z} from MOLA-HRSC 200 m DEM (USGS 2018)` : 'Global base map (MOLA 463 m DEM averaged to 4096×2048)';
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
      if (viewReady && canvas.width === cw && canvas.height === ch) return;
      canvas.width = cw;
      canvas.height = ch;
      if (globeCanvas) { globeCanvas.width = cw; globeCanvas.height = ch; }
      if (!viewReady) { fitView(); viewReady = true; }
      else { S.view.tx = canvas.width / 2 - gx * S.view.scale; S.view.ty = canvas.height / 2 - gy * S.view.scale; wrapView(); }
      updateScaleBar();
      draw();
    }

    function getMapSafeBounds(dpr) {
      const wrap = canvas.parentElement;
      const topBar = wrap && wrap.querySelector ? wrap.querySelector('.map-top-bar') : null;
      const botHud = wrap && wrap.querySelector ? wrap.querySelector('.map-hud') : null;
      const topSafe = Math.max(40, (topBar ? topBar.getBoundingClientRect().height + 14 : 44)) * dpr;
      const botSafe = canvas.height - Math.max(36, (botHud ? botHud.getBoundingClientRect().height + 16 : 38)) * dpr;
      return { topSafe, botSafe };
    }

    function createLabelPlacer(dpr, bounds) {
      const boxes = [];
      const pad = 5 * dpr;
      return {
        reserve(x1, y1, x2, y2) { boxes.push([x1 - pad, y1 - pad, x2 + pad, y2 + pad]); },
        canPlace(x1, y1, x2, y2) {
          if (x1 < 6 * dpr || x2 > canvas.width - 6 * dpr || y1 < bounds.topSafe || y2 > bounds.botSafe) return false;
          for (const b of boxes) {
            if (x1 < b[2] && x2 > b[0] && y1 < b[3] && y2 > b[1]) return false;
          }
          boxes.push([x1 - pad, y1 - pad, x2 + pad, y2 + pad]);
          return true;
        },
      };
    }

    function draw2DGraticule(dpr, placer, bounds) {
      const { scale, tx, ty } = S.view;
      const cssW = canvas.width / dpr;
      const lonStep = cssW < 420 ? 90 : cssW < 680 ? 60 : 30;
      const fh = Math.round(9.5 * dpr);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
      ctx.lineWidth = 1;
      ctx.font = `500 ${fh}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
      ctx.textBaseline = 'middle';
      for (let lon = -180; lon <= 180; lon += 30) {
        const [x0] = toScreen(L.colOfLon(Math.min(lon, 179.99)), 0);
        ctx.beginPath(); ctx.moveTo(x0, Math.max(0, ty)); ctx.lineTo(x0, Math.min(canvas.height, ty + H * scale)); ctx.stroke();
        if (lon > -180 && lon < 180 && (Math.abs(lon) % lonStep === 0)) {
          const lbl = lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
          const tw = ctx.measureText(lbl).width;
          const ly = Math.max(bounds.topSafe + fh * 0.7, ty + 14 * dpr);
          if (placer.canPlace(x0 - tw / 2, ly - fh / 2, x0 + tw / 2, ly + fh / 2)) {
            ctx.textAlign = 'center'; ctx.fillText(lbl, x0, ly);
          }
        }
      }
      ctx.textAlign = 'left';
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, y0] = toScreen(0, L.rowOfLat(lat));
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke();
        const lbl = lat === 0 ? 'EQ 0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
        const tw = ctx.measureText(lbl).width;
        const ly = y0 - 7 * dpr;
        if (placer.canPlace(12 * dpr, ly - fh / 2, 12 * dpr + tw, ly + fh / 2)) {
          ctx.fillText(lbl, 12 * dpr, ly);
        }
      }
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      for (const lat of [50, -50]) {
        const [, y0] = toScreen(0, L.rowOfLat(lat));
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke();
        const lbl = cssW < 520 ? `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'} limit` : `${Math.abs(lat)}° ${lat > 0 ? 'N' : 'S'} NASA limit`;
        const tw = ctx.measureText(lbl).width;
        const ly = y0 - 7 * dpr;
        if (placer.canPlace(canvas.width - 14 * dpr - tw, ly - fh / 2, canvas.width - 14 * dpr, ly + fh / 2)) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.78)';
          ctx.textAlign = 'right'; ctx.fillText(lbl, canvas.width - 14 * dpr, ly); ctx.textAlign = 'left';
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
      const bounds = getMapSafeBounds(dpr);
      const placer = createLabelPlacer(dpr, bounds);

      if (S.viewMode === '3d' && globe) {
        globe.render({ opacity: S.opacity, showOverlay: S.overlay !== 'none' && S.globeOverlay });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        draw3DGraticule(dpr);
      } else {
        const { scale, tx, ty } = S.view;
        ctx.fillStyle = '#030508';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const useDetail = !!pickDetailLevel(scale);
        detail.activeKmPerPx = null;
        for (const off of [-W, 0, W]) {
          const sx = tx + off * scale;
          if (sx > canvas.width || sx + W * scale < 0) continue;
          // With relief tiles active, smooth the colour mosaic so 5 km blocks don't show through
          ctx.imageSmoothingEnabled = useDetail || scale < 1.2;
          ctx.drawImage(baseImg, sx, ty, W * scale, H * scale);
          if (useDetail) drawDetailTiles(sx, ty, scale);
          if (S.overlay !== 'none') {
            // Data overlays are 5 km cells; smooth them when zoomed in so they read as a field, not blocks
            ctx.imageSmoothingEnabled = useDetail || scale < 1.2;
            ctx.globalAlpha = S.opacity;
            ctx.drawImage(ovCanvas, sx, ty, W * scale, H * scale);
            ctx.globalAlpha = 1;
          }
        }
        ctx.imageSmoothingEnabled = scale < 1.2;
        draw2DGraticule(dpr, placer, bounds);
      }

      // Reserve candidate & pin label zones so place names never overwrite markers or numbers
      S.candidates.forEach((c) => {
        const [sx, sy, vis] = projectGrid(c.x, c.y);
        if (vis) placer.reserve(sx - 18 * dpr, sy - 18 * dpr, sx + 34 * dpr, sy + 18 * dpr);
      });
      if (S.route.start) {
        const [sx, sy, vis] = projectGrid(S.route.start.x, S.route.start.y);
        if (vis) placer.reserve(sx - 24 * dpr, sy - 24 * dpr, sx + 48 * dpr, sy + 16 * dpr);
      }
      if (S.route.goal) {
        const [sx, sy, vis] = projectGrid(S.route.goal.x, S.route.goal.y);
        if (vis) placer.reserve(sx - 24 * dpr, sy - 24 * dpr, sx + 48 * dpr, sy + 16 * dpr);
      }

      const effScale = S.viewMode === '3d' && globe ? (2.8 / Math.max(0.4, globe.state.camDist - 1.0)) : S.view.scale;
      const fontPx = Math.max(9.5, Math.min(12, 8.5 + effScale * 0.8)) * dpr;
      ctx.font = `500 ${fontPx}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
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
          const lx = x + 6 * dpr, tw = ctx.measureText(r.name).width;
          if (placer.canPlace(lx, y - fontPx * 0.6, lx + tw, y + fontPx * 0.6)) {
            ctx.fillStyle = 'rgba(3, 5, 8, 0.86)'; ctx.fillText(r.name, lx + 1 * dpr, y + 1 * dpr);
            ctx.fillStyle = ez ? '#6ee7b7' : (r.mission ? '#bae6fd' : 'rgba(241, 245, 249, 0.94)'); ctx.fillText(r.name, lx, y);
          }
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
      const i18n = global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
      const t = (k, fb) => (i18n && i18n.t(k) !== k ? i18n.t(k) : fb);
      if (S.route.straight) drawPath(S.route.straight.path, '#ef4444', 1.8, [6 * dpr, 4 * dpr]);
      if (S.route.safe) drawPath(S.route.safe.path, '#10b981', 2.8);
      if (S.route.safe && S.route.safe.stats && S.route.safe.stats.scienceWaypoints) {
        S.route.safe.stats.scienceWaypoints.forEach((wp) => {
          drawWaypoint(wp.x, wp.y, '#ea9662', `${wp.id} ${wp.code}`);
        });
      }
      if (S.route.start) drawWaypoint(S.route.start.x, S.route.start.y, '#7fae8c', t('startPin', 'Start'));
      if (S.route.goal) drawWaypoint(S.route.goal.x, S.route.goal.y, '#cfa25c', t('goalPin', 'Goal'));

      S.candidates.forEach((c, i) => {
        drawCandidateReticle(c.x, c.y, i + 1, c.score, !!(S.selected && S.selected.cand === i));
      });
      if (S.crisis.site) drawStationBeacon(S.crisis.site.x, S.crisis.site.y);
      if (S.selected && S.selected.cand == null) drawSelectionReticle(S.selected.x + 0.5, S.selected.y + 0.5);
      drawCustomLandingOverlay(dpr);
      // Legacy on-foot walkback ring ("EVA WALKBACK 0.80 km"): only meaningful for the legacy
      // astronaut demo, so draw it only while that collapsed section is open. The new 16 km²
      // rover analysis has no on-foot mode and the label was being misread as map resolution.
      const legacyEl = typeof document !== 'undefined' ? document.getElementById('eva-legacy-details') : null;
      const legacyOpen = !!(legacyEl && legacyEl.open);
      if (legacyOpen && global.MDE_EVA && global.MDE_EVA.drawGlobalWalkbackOverlay && (S.mode === 'eva' || S.mode === 'route' || S.selected)) {
        global.MDE_EVA.drawGlobalWalkbackOverlay(ctx, projectGrid, L, S, dpr);
      }
    }

    function drawCustomLandingOverlay(dpr) {
      const cl = S.customLanding;
      if (!cl) return;
      const cx = cl.x + 0.5, cy = cl.y + 0.5;
      const strokeCol = '#4da6ff';
      const fillCol = 'rgba(77, 166, 255, 0.16)';
      const pinCol = cl.slopeBlocked ? '#f06458' : '#4da6ff';
      ctx.save();
      if (S.viewMode === '3d' && globe) {
        if (cl.circlePts && cl.circlePts.length > 2) {
          ctx.beginPath();
          let started = false;
          for (const [ptLat, ptLon] of cl.circlePts) {
            const [sx, sy, vis] = globe.project(ptLat, ptLon, true);
            if (!vis) { started = false; continue; }
            if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
          }
          ctx.fillStyle = fillCol; ctx.fill();
          ctx.strokeStyle = strokeCol; ctx.lineWidth = 2 * dpr; ctx.stroke();
        }
        const [px, py, pvis] = projectGrid(cx, cy);
        if (pvis) drawLandingMarkerPin(px, py, pinCol, dpr, cl.rangeKm);
        ctx.restore();
        return;
      }
      for (const off of [-W, 0, W]) {
        const span = W * S.view.scale;
        const left = S.view.tx + off * S.view.scale;
        if (left > canvas.width + span * 0.25 || left + span < -span * 0.25) continue;
        if (cl.circlePts && cl.circlePts.length > 2) {
          ctx.beginPath();
          cl.circlePts.forEach(([ptLat, ptLon], idx) => {
            let gx = ((((ptLon + 180) % 360) + 360) % 360) / 360 * W;
            const gy = (90 - ptLat) / 180 * H;
            const d = gx - cx;
            if (d > W * 0.5) gx -= W;
            else if (d < -W * 0.5) gx += W;
            const sx = S.view.tx + (gx + off) * S.view.scale;
            const sy = S.view.ty + gy * S.view.scale;
            if (idx === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
          ctx.fillStyle = fillCol; ctx.fill();
          ctx.strokeStyle = strokeCol; ctx.lineWidth = 2 * dpr; ctx.stroke();
        }
        const px = S.view.tx + (cx + off) * S.view.scale;
        const py = S.view.ty + cy * S.view.scale;
        if (px >= -40 && px <= canvas.width + 40 && py >= -40 && py <= canvas.height + 40) {
          drawLandingMarkerPin(px, py, pinCol, dpr, cl.rangeKm);
        }
      }
      ctx.restore();
    }

    function drawLandingMarkerPin(px, py, col, dpr, rangeKm) {
      const r = 6 * dpr;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - r - 4 * dpr, py); ctx.lineTo(px + r + 4 * dpr, py);
      ctx.moveTo(px, py - r - 4 * dpr); ctx.lineTo(px, py + r + 4 * dpr);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
      const lbl = rangeKm > 0 ? `${rangeKm.toFixed(1)} km` : '0 km';
      ctx.font = `600 ${Math.round(10 * dpr)}px "IBM Plex Mono", monospace`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = 'rgba(12, 14, 18, 0.88)';
      ctx.fillRect(px - tw / 2 - 4 * dpr, py - r - 18 * dpr, tw + 8 * dpr, 13 * dpr);
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lbl, px, py - r - 11.5 * dpr);
    }

    function zoomBy(factor) {
      if (S.viewMode === '3d' && globe) {
        globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist / factor));
        schedule3D();
        return;
      }
      const mx = canvas.width / 2, my = canvas.height / 2;
      const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
      const ns = Math.max(minS, Math.min(detail.levels.length ? 96 : 40, S.view.scale * factor));
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
      if (e.button !== undefined && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty, rLat: globe ? globe.state.targetLat : 0, rLon: globe ? globe.state.targetLon : 0 };
      moved = false;
    });
    global.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dpr = global.devicePixelRatio || 1;
      const dx = (e.clientX - drag.x) * dpr, dy = (e.clientY - drag.y) * dpr;
      if (!moved) {
        if (Math.hypot(dx, dy) < 8 * dpr) return;
        moved = true;
      }
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
      const g = gridAt(e); if (g && onPick) onPick(g[0], g[1], e);
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
      const ns = Math.max(minS, Math.min(detail.levels.length ? 96 : 40, S.view.scale * f)), k = ns / S.view.scale;
      S.view.tx = mx - (mx - S.view.tx) * k; S.view.ty = my - (my - S.view.ty) * k; S.view.scale = ns;
      wrapView(); updateScaleBar(); draw();
    }, { passive: false });
    canvas.addEventListener('mousemove', (e) => {
      if (performance.now() - lastTouchTap < 500) return;
      const g = gridAt(e), tip = $('#tooltip');
      if (!g) { if (tip) tip.classList.add('hidden'); return; }
      const [x, y] = g, v = layers.cellValues(x, y), s = S.score[y * W + x], nr = layers.nearestRegion(v.lat, v.lon);
      const i18n = global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
      const tr = !!(i18n && i18n.getLang && i18n.getLang() === 'tr');
      if ($('#hud-coord')) $('#hud-coord').textContent = (tr
        ? `ENL ${fmtLat(v.lat)} · BOY ${fmtLon(v.lon)} · RAKIM ${v.elev.toFixed(0)} m · EĞİM ${v.slope.toFixed(1)}° · SKOR ${s.toFixed(2)}`
        : `LAT ${fmtLat(v.lat)} · LON ${fmtLon(v.lon)} · ELEV ${v.elev.toFixed(0)} m · SLOPE ${v.slope.toFixed(1)}° · SCORE ${s.toFixed(2)}`)
        + ($('#hud-coord').dataset.t ? ` · ${$('#hud-coord').dataset.t} ms` : '');
      if (tip) {
        if (global.matchMedia && global.matchMedia('(hover: none)').matches) { tip.classList.add('hidden'); return; }
        const locTxt = nr.distDeg < 6 ? escHtml(nr.region.name) : (tr ? escHtml(nr.region.name) + ' yakını' : 'near ' + escHtml(nr.region.name));
        tip.innerHTML = `<span class="tt-region">${locTxt}</span><b>${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))}</b> · ${tr ? 'skor' : 'score'} <b>${s.toFixed(2)}</b><br>${tr ? 'rakım' : 'elev'} ${v.elev.toFixed(0)} m · ${tr ? 'eğim' : 'slope'} ${v.slope.toFixed(1)}°<br>rad ${v.rad.toFixed(0)} mSv/${tr ? 'yıl' : 'yr'} · ${tr ? 'buz' : 'ice'} ${v.ice === null ? '—' : v.ice.toFixed(2)}<br>${tr ? 'pürüz' : 'rough'} ${v.rough.toFixed(0)} m · ${tr ? 'TA' : 'TI'} ${v.ti === null ? '—' : v.ti.toFixed(0)} · ${tr ? 'toz' : 'dust'} ${v.dust === null ? '—' : (v.dust * 100).toFixed(0) + '%'}`;
        const r = canvas.getBoundingClientRect();
        tip.classList.remove('hidden');
        const tipW = tip.offsetWidth || 210, tipH = tip.offsetHeight || 95;
        tip.style.left = Math.max(8, Math.min(Math.max(8, r.width - tipW - 8), e.clientX - r.left + 14)) + 'px';
        tip.style.top = Math.max(8, Math.min(Math.max(8, r.height - tipH - 8), e.clientY - r.top + 14)) + 'px';
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
          const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9, ns = Math.max(minS, Math.min(detail.levels.length ? 96 : 40, touchState.scale * ratio));
          const k = ns / touchState.scale;
          S.view.scale = ns; S.view.tx = mx - (touchState.mx - touchState.tx) * k; S.view.ty = my - (touchState.my - touchState.ty) * k;
          wrapView(); updateScaleBar(); draw();
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (touchState && touchState.mode === 'drag' && !touchState.moved && e.changedTouches.length === 1) {
        const t = e.changedTouches[0]; lastTouchTap = performance.now();
        if ($('#tooltip')) $('#tooltip').classList.add('hidden');
        const g = gridAt(t); if (g && onPick) onPick(g[0], g[1]);
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchState = { mode: 'drag', x: t.clientX, y: t.clientY, moved: true, tx: S.view.tx, ty: S.view.ty, rLat: globe ? globe.state.targetLat : 0, rLon: globe ? globe.state.targetLon : 0 };
      } else if (e.touches.length === 0) {
        touchState = null;
      }
    });

    loadDetailManifest();

    return {
      canvas,
      detail,
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
