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

    // ---- Earth Regional Ultra-HD Cutouts & Live Esri World Imagery Slippy-Map Tile Streamer
    const earthHD = {
      trImg: null, trLoading: false,
      hatayImg: null, hatayLoading: false,
      tileCache: new Map(), tilePending: 0, activeKmPerPx: null
    };
    function ensureEarthRegionalHD() {
      if (!earthHD.trImg && !earthHD.trLoading) {
        earthHD.trLoading = true;
        const im = new Image();
        im.onload = () => { earthHD.trImg = im; draw(); };
        im.onerror = () => {};
        im.src = 'layers/earth_tr_hd.jpg';
      }
      if (!earthHD.hatayImg && !earthHD.hatayLoading) {
        earthHD.hatayLoading = true;
        const im2 = new Image();
        im2.onload = () => { earthHD.hatayImg = im2; draw(); };
        im2.onerror = () => {};
        im2.src = 'layers/earth_hatay_hd.jpg';
      }
    }
    function getEarthSlippyTile(z, x, y) {
      const key = `${z}/${y}/${x}`;
      let e = earthHD.tileCache.get(key);
      if (e) {
        earthHD.tileCache.delete(key);
        earthHD.tileCache.set(key, e);
        return e.ok ? e.img : null;
      }
      if (earthHD.tilePending > 20) return null;
      if (typeof location !== 'undefined' && (location.protocol === 'file:' || location.hostname === 'mde.local')) return null;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      e = { img, ok: false };
      earthHD.tileCache.set(key, e);
      earthHD.tilePending++;
      img.onload = () => { e.ok = true; earthHD.tilePending--; updateScaleBar(); draw(); };
      img.onerror = () => { earthHD.tilePending--; };
      img.src = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      if (earthHD.tileCache.size > 420) earthHD.tileCache.delete(earthHD.tileCache.keys().next().value);
      return null;
    }
    function drawEarthPatchesAndTiles(sx, ty, scale) {
      ensureEarthRegionalHD();
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 1. Baked Turkey & Cyprus 4K HD Patch (lon 25..45, lat 34.5..42.5 -> ~480 m/px)
      if (earthHD.trImg) {
        const gx0 = L.colOfLon(25.0), gx1 = L.colOfLon(45.0);
        const gy0 = L.rowOfLat(42.5), gy1 = L.rowOfLat(34.5);
        ctx.drawImage(earthHD.trImg, sx + gx0 * scale, ty + gy0 * scale, (gx1 - gx0) * scale, (gy1 - gy0) * scale);
      }
      // 2. Baked Hatay / Kahramanmaraş / Gaziantep / Adana Ultra-HD Patch (lon 35.0..38.8, lat 35.6..38.4 -> ~140 m/px)
      if (earthHD.hatayImg) {
        const gx0 = L.colOfLon(35.0), gx1 = L.colOfLon(38.8);
        const gy0 = L.rowOfLat(38.4), gy1 = L.rowOfLat(35.6);
        ctx.drawImage(earthHD.hatayImg, sx + gx0 * scale, ty + gy0 * scale, (gx1 - gx0) * scale, (gy1 - gy0) * scale);
      }

      // 3. Live Multi-Zoom Esri World Imagery Satellite Tiles (z = 5..13, down to 19 m/px anywhere on Earth)
      const hdEnabled = !S.afad || !S.afad.layers || S.afad.layers.hdtiles !== false;
      if (!hdEnabled || scale < 1.8) {
        earthHD.activeKmPerPx = earthHD.hatayImg && scale >= 5 ? 0.14 : (earthHD.trImg && scale >= 2 ? 0.45 : 1.2);
        ctx.restore();
        return;
      }
      const z = Math.max(5, Math.min(13, Math.floor(4 + Math.log2(scale) + 0.6)));
      const n = 1 << z;
      earthHD.activeKmPerPx = (40075.0 / (n * 256)) * 0.8;

      const gxMin = Math.max(0, (0 - sx) / scale), gxMax = Math.min(W, (canvas.width - sx) / scale);
      const gyMin = Math.max(0, (0 - ty) / scale), gyMax = Math.min(H, (canvas.height - ty) / scale);
      if (gxMax <= gxMin || gyMax <= gyMin) { ctx.restore(); return; }

      const lonMin = Math.max(-179.9, L.lonOfCol(gxMin)), lonMax = Math.min(179.9, L.lonOfCol(gxMax));
      const latMax = Math.min(84.5, L.latOfRow(gyMin)), latMin = Math.max(-84.5, L.latOfRow(gyMax));
      if (latMax <= latMin || lonMax <= lonMin) { ctx.restore(); return; }

      const lon2tx = (lon) => Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
      const lat2ty = (lat) => {
        const rad = lat * Math.PI / 180;
        return Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n)));
      };
      const ty2lat = (t) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n)));

      const tx0 = lon2tx(lonMin), tx1 = lon2tx(lonMax);
      const ty0 = lat2ty(latMax), ty1 = lat2ty(latMin);
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 48) { ctx.restore(); return; }

      for (let tyIdx = ty0; tyIdx <= ty1; tyIdx++) {
        const latN = ty2lat(tyIdx), latS = ty2lat(tyIdx + 1);
        const py0 = ty + L.rowOfLat(latN) * scale, py1 = ty + L.rowOfLat(latS) * scale;
        for (let txIdx = tx0; txIdx <= tx1; txIdx++) {
          const lonW = (txIdx / n) * 360 - 180, lonE = ((txIdx + 1) / n) * 360 - 180;
          const px0 = sx + L.colOfLon(lonW) * scale, px1 = sx + L.colOfLon(lonE) * scale;
          const tImg = getEarthSlippyTile(z, txIdx, tyIdx);
          if (tImg) {
            ctx.drawImage(tImg, px0, py0, (px1 - px0) + 0.65, (py1 - py0) + 0.65);
          } else if (z > 5) {
            const pImg = getEarthSlippyTile(z - 1, txIdx >> 1, tyIdx >> 1);
            if (pImg) {
              const ox = (txIdx & 1) * 128, oy = (tyIdx & 1) * 128;
              ctx.drawImage(pImg, ox, oy, 128, 128, px0, py0, (px1 - px0) + 0.65, (py1 - py0) + 0.65);
            }
          }
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
      const isAfad = S.mode === 'afad';
      const planetR = isAfad ? 6371.0 : MARS_R;
      let kmPerCssPx;
      if (S.viewMode === '3d' && globe) {
        kmPerCssPx = globe.equatorialKmPerCssPx() * (isAfad ? (6371.0 / MARS_R) : 1);
      } else {
        const kmPerGridPx = (2 * Math.PI * planetR) / W;
        const cssPxPerGridPx = S.view.scale / (global.devicePixelRatio || 1);
        kmPerCssPx = kmPerGridPx / Math.max(0.05, cssPxPerGridPx);
      }
      const targetKm = kmPerCssPx * 72;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      let niceKm = steps[0];
      for (const s of steps) { if (s <= targetKm * 1.35) niceKm = s; }
      const barPx = Math.max(28, Math.min(120, Math.round(niceKm / kmPerCssPx)));
      const baseKm = (2 * Math.PI * planetR) / W;
      const lv = S.viewMode === '3d' ? null : pickDetailLevel(S.view.scale);
      const dataKm = isAfad
        ? (earthHD.activeKmPerPx || (baseKm / 8))
        : (lv ? lv.kmPerPx : baseKm);
      elLbl.textContent = `${niceKm} km · data ${dataKm < 1 ? Math.round(dataKm * 1000) + ' m' : dataKm.toFixed(1) + ' km'}/px`;
      elLbl.title = isAfad
        ? 'Esri World Imagery Ultra-HD Satellite Stream + NASA Blue Marble 8K (WGS-84)'
        : (lv ? `Relief detail tiles z${lv.z} from MOLA-HRSC 200 m DEM (USGS 2018)` : 'Global base map (MOLA 463 m DEM averaged to 4096×2048)');
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
      ctx.font = `500 ${fh}px "SF Mono", "IBM Plex Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
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
      ctx.strokeStyle = S.mode === 'afad' ? 'rgba(14, 165, 233, 0.35)' : 'rgba(245, 158, 11, 0.45)';
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      const bandLats = S.mode === 'afad' ? [23.44, -23.44] : [50, -50];
      for (const lat of bandLats) {
        const [, y0] = toScreen(0, L.rowOfLat(lat));
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx + W * scale, y0); ctx.stroke();
        const lbl = S.mode === 'afad'
          ? (lat > 0 ? '23.4°N Yengeç Dönencesi (WGS-84)' : '23.4°S Oğlak Dönencesi (WGS-84)')
          : (cssW < 520 ? `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'} limit` : `${Math.abs(lat)}° ${lat > 0 ? 'N' : 'S'} NASA limit`);
        const tw = ctx.measureText(lbl).width;
        const ly = y0 - 7 * dpr;
        if (placer.canPlace(canvas.width - 14 * dpr - tw, ly - fh / 2, canvas.width - 14 * dpr, ly + fh / 2)) {
          ctx.fillStyle = S.mode === 'afad' ? 'rgba(14, 165, 233, 0.78)' : 'rgba(245, 158, 11, 0.78)';
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
      ctx.strokeStyle = S.mode === 'afad' ? 'rgba(14, 165, 233, 0.4)' : 'rgba(245, 158, 11, 0.5)';
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      const band3D = S.mode === 'afad' ? [23.44, -23.44] : [50, -50];
      for (const lat of band3D) {
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
      const isAfad = S.mode === 'afad';
      const baseImg = (isAfad && layers.getEarthImg && layers.getEarthImg())
        ? layers.getEarthImg()
        : layers.getBaseImg();
      if (!baseImg) return;
      if (ovDirty) buildOverlay();
      const dpr = global.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const bounds = getMapSafeBounds(dpr);
      const placer = createLabelPlacer(dpr, bounds);

      if (S.viewMode === '3d' && globe) {
        globe.render({
          opacity: isAfad ? 0 : S.opacity,
          showOverlay: !isAfad && S.overlay !== 'none' && S.globeOverlay,
          relief: isAfad ? 0 : undefined,
        });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        draw3DGraticule(dpr);
      } else {
        const { scale, tx, ty } = S.view;
        ctx.fillStyle = '#030508';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const useDetail = !isAfad && !!pickDetailLevel(scale);
        detail.activeKmPerPx = null;
        for (const off of [-W, 0, W]) {
          const sx = tx + off * scale;
          if (sx > canvas.width || sx + W * scale < 0) continue;
          ctx.imageSmoothingEnabled = isAfad || useDetail || scale < 1.2;
          if (isAfad) ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(baseImg, sx, ty, W * scale, H * scale);
          if (isAfad) drawEarthPatchesAndTiles(sx, ty, scale);
          if (useDetail) drawDetailTiles(sx, ty, scale);
          if (!isAfad && S.overlay !== 'none') {
            ctx.imageSmoothingEnabled = useDetail || scale < 1.2;
            ctx.globalAlpha = S.opacity;
            ctx.drawImage(ovCanvas, sx, ty, W * scale, H * scale);
            ctx.globalAlpha = 1;
          }
        }
        ctx.imageSmoothingEnabled = isAfad || scale < 1.2;
        draw2DGraticule(dpr, placer, bounds);
      }

      if (!isAfad) {
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
        ctx.font = `500 ${fontPx}px "SF Mono", "IBM Plex Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
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
      }
      drawAFADOverlay(dpr);
    }

    function drawAFADOverlay(dpr) {
      if (S.mode !== 'afad' && (!S.afad || !S.afad.active)) return;
      const sc = (S.afad && S.afad.scenario) || null;
      if (!sc) return;

      ctx.save();
      const tr = (global.MDE_I18N && global.MDE_I18N.getLang && global.MDE_I18N.getLang() === 'tr');
      const scale = S.view.scale;
      const afLayers = (S.afad && S.afad.layers) || { hdtiles: true, roads: true, faults: true, cities: true };

      // 1. Tectonic Fault Systems (DAF, KAF)
      const FAULTS = afLayers.faults === false ? [] : [
        {
          id: 'daf-1', name: 'DAF · Pazarcık-Türkoğlu (2023 Mw 7.8)', major: true,
          pts: [[38.2, 37.9], [37.6, 37.8], [37.15, 37.35], [36.75, 37.2], [36.5, 36.9], [36.25, 36.4], [36.1, 36.1], [35.9, 35.8]]
        },
        {
          id: 'daf-2', name: 'Çardak Fayı · Elbistan (2023 Mw 7.5)', major: true,
          pts: [[37.9, 38.05], [37.25, 38.08], [36.6, 38.05], [36.1, 38.0]]
        },
        {
          id: 'daf-3', name: 'DAF · Sivrice-Palu-Karlıova', major: false,
          pts: [[41.0, 39.3], [40.5, 38.9], [39.9, 38.7], [39.3, 38.45], [38.8, 38.2], [38.2, 37.9]]
        },
        {
          id: 'kaf-1', name: 'KAF · Kuzey Marmara Segmenti', major: true,
          pts: [[30.5, 40.75], [29.9, 40.75], [29.1, 40.8], [28.2, 40.85], [27.3, 40.88], [26.4, 40.55]]
        },
        {
          id: 'kaf-2', name: 'KAF · Bolu-Düzce-Adapazarı', major: false,
          pts: [[35.5, 40.85], [33.5, 40.75], [31.5, 40.75], [30.5, 40.75]]
        },
        {
          id: 'kaf-3', name: 'KAF · Doğu Karadeniz Geçişi', major: false,
          pts: [[41.0, 39.3], [39.5, 39.75], [38.5, 40.05], [36.5, 40.7], [35.5, 40.85]]
        }
      ];

      for (const f of FAULTS) {
        ctx.beginPath();
        let started = false;
        for (const pt of f.pts) {
          const gx = L.colOfLon(pt[0]), gy = L.rowOfLat(pt[1]);
          const [sx, sy, vis] = projectGrid(gx, gy);
          if (!vis) { started = false; continue; }
          if (!started) { ctx.moveTo(sx, sy); started = true; } else { ctx.lineTo(sx, sy); }
        }
        ctx.strokeStyle = f.major ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.28)';
        ctx.lineWidth = (f.major ? 4.5 : 3.0) * dpr;
        ctx.stroke();
        ctx.strokeStyle = f.major ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = (f.major ? 2.0 : 1.4) * dpr;
        ctx.stroke();

        if (f.major && scale >= 3.5 && f.pts.length >= 3) {
          const mid = f.pts[Math.floor(f.pts.length / 2)];
          const [mx, my, mvis] = projectGrid(L.colOfLon(mid[0]), L.rowOfLat(mid[1]));
          if (mvis && mx > 40 && mx < canvas.width - 40 && my > 40 && my < canvas.height - 40) {
            ctx.font = `600 ${9.5 * dpr}px monospace`;
            ctx.fillStyle = '#ef4444';
            ctx.fillText(`⚡ ${f.name}`, mx + 8 * dpr, my - 6 * dpr);
          }
        }
      }

      // 2. ShakeMap & Sismik Şiddet Zonları (Isoseismals)
      if (afLayers.faults !== false && sc.id === 'maras') {
        const QUAKES = [
          { name: 'Mw 7.8 Pazarcık Odak Noktası', lat: 37.17, lon: 37.08, r9: 45, r8: 95, r7: 175 },
          { name: 'Mw 7.5 Elbistan Odak Noktası', lat: 38.08, lon: 37.24, r9: 35, r8: 80, r7: 145 }
        ];
        for (const q of QUAKES) {
          const qx = L.colOfLon(q.lon), qy = L.rowOfLat(q.lat);
          const [sx, sy, vis] = projectGrid(qx, qy);
          if (!vis) continue;

          const kmScale = (scale * 2.8) * dpr;
          const drawRing = (rKm, strokeCol, fillCol, dash, lbl) => {
            const rPx = rKm * kmScale;
            if (rPx < 6 || rPx > canvas.width * 1.5) return;
            ctx.beginPath();
            ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
            if (fillCol) { ctx.fillStyle = fillCol; ctx.fill(); }
            ctx.strokeStyle = strokeCol;
            ctx.lineWidth = 1.4 * dpr;
            ctx.setLineDash(dash ? [5 * dpr, 4 * dpr] : []);
            ctx.stroke();
            ctx.setLineDash([]);
            if (scale >= 4.0) {
              ctx.font = `500 ${8.5 * dpr}px monospace`;
              ctx.fillStyle = strokeCol;
              ctx.fillText(lbl, sx + rPx * 0.72, sy - rPx * 0.72);
            }
          };

          drawRing(q.r7, 'rgba(234, 179, 8, 0.45)', 'rgba(234, 179, 8, 0.04)', true, 'MMI VII (Orta)');
          drawRing(q.r8, 'rgba(245, 158, 11, 0.65)', 'rgba(245, 158, 11, 0.07)', true, 'MMI VIII (Ağır)');
          drawRing(q.r9, 'rgba(239, 68, 68, 0.85)', 'rgba(239, 68, 68, 0.12)', false, 'MMI IX (Yıkıcı)');

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(sx, sy, 7 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();

          ctx.font = `700 ${10.5 * dpr}px monospace`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(`★ ${q.name}`, sx + 10 * dpr, sy - 5 * dpr);
        }
      } else if (afLayers.faults !== false && sc.id === 'marmara') {
        const mx = L.colOfLon(29.1), my = L.rowOfLat(40.8);
        const [sx, sy, vis] = projectGrid(mx, my);
        if (vis) {
          const rPx = 42 * (scale * 2.8) * dpr;
          ctx.beginPath();
          ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
          ctx.lineWidth = 1.6 * dpr;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `600 ${10 * dpr}px monospace`;
          ctx.fillStyle = '#ef4444';
          ctx.fillText(`🌊 Marmara Tsunami & Sıvılaşma Tehdit Tamponu (Mw 7.6 Projeksiyonu)`, sx - rPx * 0.7, sy - rPx - 6 * dpr);
        }
      }

      // 3. Bölgesel Şehir, Liman ve Havalimanı Merkezleri (City & Port Beacons)
      const ER = global.EARTH_ROADS || null;
      const cityList = (ER && ER.NODES)
        ? Object.values(ER.NODES).map((n) => ({ name: n.name, lat: n.lat, lon: n.lon, hub: !!(n.port || n.airport), port: !!n.port }))
        : [
          { name: 'Kahramanmaraş', lat: 37.58, lon: 36.93, hub: true },
          { name: 'Gaziantep', lat: 37.06, lon: 37.38, hub: true },
          { name: 'Antakya (Hatay)', lat: 36.20, lon: 36.16, hub: true },
          { name: 'İskenderun Limanı', lat: 36.58, lon: 36.17, hub: true, port: true },
          { name: 'İstanbul', lat: 41.01, lon: 28.97, hub: true, port: true },
          { name: 'Ankara', lat: 39.93, lon: 32.85, hub: true }
        ];

      if (afLayers.cities !== false) {
        for (const ct of cityList) {
          const [cx, cy, vis] = projectGrid(L.colOfLon(ct.lon), L.rowOfLat(ct.lat));
          if (!vis || cx < 20 || cx > canvas.width - 20 || cy < 20 || cy > canvas.height - 20) continue;
          ctx.fillStyle = ct.port ? '#0ea5e9' : (ct.hub ? '#3b82f6' : 'rgba(226, 232, 240, 0.85)');
          ctx.beginPath();
          ctx.arc(cx, cy, (ct.hub ? 4.2 : 2.8) * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();

          if (scale >= 2.2 || ct.hub) {
            ctx.font = `600 ${Math.max(9, Math.min(12, 8 + scale * 0.4)) * dpr}px "SF Mono", monospace`;
            ctx.fillStyle = 'rgba(3, 5, 8, 0.88)';
            ctx.fillText(ct.name, cx + 7 * dpr + 1, cy + 3 * dpr + 1);
            ctx.fillStyle = ct.port ? '#7dd3fc' : (ct.hub ? '#93c5fd' : '#f1f5f9');
            ctx.fillText(ct.name, cx + 7 * dpr, cy + 3 * dpr);
          }
        }
      }

      // 3b. KGM / OSM Karayolu Ağı & Otonom Açık/Hasarlı/Kapalı Yol Durumu Çizimi
      if (afLayers.roads !== false && ER && ER.SEGMENTS) {
        for (const seg of ER.SEGMENTS) {
          const isClosed = seg.status === 'BLOCKED_COLLAPSE' || seg.status === 'CLOSED_WEATHER';
          const isDamaged = seg.status === 'DAMAGED_PARTIAL';
          ctx.beginPath();
          let started = false;
          for (const pt of seg.coords) {
            const [sx, sy, vis] = projectGrid(L.colOfLon(pt[1]), L.rowOfLat(pt[0]));
            if (!vis) { started = false; continue; }
            if (!started) { ctx.moveTo(sx, sy); started = true; } else { ctx.lineTo(sx, sy); }
          }
          ctx.strokeStyle = isClosed
            ? 'rgba(239, 68, 68, 0.85)'
            : isDamaged
              ? 'rgba(245, 158, 11, 0.82)'
              : 'rgba(148, 163, 184, 0.35)';
          ctx.lineWidth = (isClosed ? 2.6 : isDamaged ? 2.2 : 1.4) * dpr;
          ctx.setLineDash(isClosed ? [4 * dpr, 3 * dpr] : isDamaged ? [6 * dpr, 3 * dpr] : []);
          ctx.stroke();
          ctx.setLineDash([]);

          if ((isClosed || isDamaged) && scale >= 2.8 && seg.coords.length >= 2) {
            const mid = seg.coords[Math.floor(seg.coords.length / 2)];
            const [mx, my, mvis] = projectGrid(L.colOfLon(mid[1]), L.rowOfLat(mid[0]));
            if (mvis && mx > 25 && mx < canvas.width - 25 && my > 25 && my < canvas.height - 25) {
              ctx.font = `700 ${9 * dpr}px monospace`;
              ctx.fillStyle = isClosed ? '#ef4444' : '#f59e0b';
              const tag = isClosed ? `⛔ KAPALI: ${seg.name.split(' ')[0]}` : `⚠ HASARLI: ${seg.name.split(' ')[0]}`;
              ctx.fillText(tag, mx + 6 * dpr, my - 5 * dpr);
            }
          }
        }
      }

      // 4. Arama-Kurtarma (SAR) Multimodal A* Rota (Kara / Deniz / Hava) Çizimi
      const astarData = (S.afad && S.afad.astar) || null;
      if (astarData && astarData.ok && astarData.safePath && astarData.safePath.length >= 2) {
        // A) Doğrudan Kuş Uçuşu / Deniz Engeli Karşılaştırma Hattı
        if (astarData.straightPath && astarData.straightPath.length >= 2 && astarData.vehicle && astarData.vehicle.mode !== 'air') {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 1.8 * dpr;
          ctx.setLineDash([6 * dpr, 5 * dpr]);
          ctx.beginPath();
          let s0 = false;
          for (const pt of astarData.straightPath) {
            const [sx, sy, vis] = projectGrid(L.colOfLon(pt.lon), L.rowOfLat(pt.lat));
            if (!vis) { s0 = false; continue; }
            if (!s0) { ctx.moveTo(sx, sy); s0 = true; } else { ctx.lineTo(sx, sy); }
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // B) Çoklu-Etap (Kara / Deniz Ro-Ro / Hava Köprüsü) Çizimi
        const legs = (astarData.legs && astarData.legs.length)
          ? astarData.legs
          : [{ type: 'road', path: astarData.safePath }];

        for (const leg of legs) {
          if (!leg.path || leg.path.length < 2) continue;
          const isSea = leg.type === 'sea';
          const isAir = leg.type === 'air';
          const isBlocked = leg.type === 'blocked';

          ctx.strokeStyle = isBlocked
            ? 'rgba(239, 68, 68, 0.35)'
            : isSea
              ? 'rgba(14, 165, 233, 0.36)'
              : isAir
                ? 'rgba(96, 165, 250, 0.34)'
                : 'rgba(16, 185, 129, 0.38)';
          ctx.lineWidth = 8.0 * dpr;
          ctx.beginPath();
          let s1 = false;
          for (const pt of leg.path) {
            const [sx, sy, vis] = projectGrid(L.colOfLon(pt.lon), L.rowOfLat(pt.lat));
            if (!vis) { s1 = false; continue; }
            if (!s1) { ctx.moveTo(sx, sy); s1 = true; } else { ctx.lineTo(sx, sy); }
          }
          ctx.stroke();

          ctx.strokeStyle = isBlocked ? '#ef4444' : isSea ? '#0ea5e9' : isAir ? '#60a5fa' : '#10b981';
          ctx.lineWidth = 3.4 * dpr;
          ctx.setLineDash(isAir ? [10 * dpr, 5 * dpr] : isSea ? [8 * dpr, 4 * dpr] : []);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.lineWidth = 1.3 * dpr;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.stroke();
          ctx.setLineDash([]);

          if ((isSea || isAir) && leg.path.length >= 2) {
            const midPt = leg.path[Math.floor(leg.path.length / 2)];
            const [mx, my, mvis] = projectGrid(L.colOfLon(midPt.lon), L.rowOfLat(midPt.lat));
            if (mvis) {
              ctx.font = `700 ${10 * dpr}px monospace`;
              ctx.fillStyle = 'rgba(3, 5, 8, 0.92)';
              const mLbl = isSea ? '🚢 DENİZ RO-RO / LST KORİDORU' : '✈️ HAVA KÖPRÜSÜ (FL310)';
              ctx.fillText(mLbl, mx + 8 * dpr + 1, my - 6 * dpr + 1);
              ctx.fillStyle = isSea ? '#7dd3fc' : '#bfdbfe';
              ctx.fillText(mLbl, mx + 8 * dpr, my - 6 * dpr);
            }
          }
        }

        // Ara Noktalar & Liman Transfer Noktaları (Waypoints & Ports)
        const wps = (astarData.stats && astarData.stats.waypoints) || [];
        wps.forEach((wp, idx) => {
          const [sx, sy, vis] = projectGrid(L.colOfLon(wp.lon), L.rowOfLat(wp.lat));
          if (!vis) return;
          ctx.fillStyle = wp.port ? '#0ea5e9' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(sx, sy, (wp.port ? 5.2 : 3.6) * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 * dpr;
          ctx.stroke();
          if (wp.port || scale >= 2.8) {
            ctx.font = `600 ${(wp.port ? 9.5 : 8.5) * dpr}px monospace`;
            ctx.fillStyle = wp.port ? '#7dd3fc' : '#cbd5e1';
            ctx.fillText(wp.name || `WP-${idx + 1}`, sx + 7 * dpr, sy - 5 * dpr);
          }
        });
      } else if (sc.route && sc.route.length >= 2) {
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.lineWidth = 7 * dpr;
        ctx.beginPath();
        let s1 = false;
        for (const wp of sc.route) {
          const [sx, sy, vis] = projectGrid(L.colOfLon(wp.lon), L.rowOfLat(wp.lat));
          if (!vis) { s1 = false; continue; }
          if (!s1) { ctx.moveTo(sx, sy); s1 = true; } else { ctx.lineTo(sx, sy); }
        }
        ctx.stroke();

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3.2 * dpr;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 1.4 * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);

        sc.route.forEach((wp, idx) => {
          const [sx, sy, vis] = projectGrid(L.colOfLon(wp.lon), L.rowOfLat(wp.lat));
          if (!vis) return;
          ctx.fillStyle = idx === 0 ? '#3b82f6' : (idx === sc.route.length - 1 ? '#10b981' : '#f59e0b');
          ctx.beginPath();
          ctx.arc(sx, sy, 3.8 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
          if (scale >= 5.0) {
            ctx.font = `500 ${8.5 * dpr}px monospace`;
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(`WP-${idx + 1} (${wp.name})`, sx + 6 * dpr, sy - 5 * dpr);
          }
        });
      }

      // 5. AFAD Koordinasyon Merkezi (HQ)
      if (sc.hq) {
        const [sx, sy, vis] = projectGrid(L.colOfLon(sc.hq.lon), L.rowOfLat(sc.hq.lat));
        if (vis) {
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath();
          ctx.arc(sx, sy, 7 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.0 * dpr;
          ctx.stroke();

          ctx.font = `700 ${11 * dpr}px monospace`;
          ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
          ctx.fillText(`📍 ${tr ? 'AFAD KOORDİNASYON MERKEZİ' : 'AFAD HQ'}`, sx + 10 * dpr + 1, sy + 4 * dpr + 1);
          ctx.fillStyle = '#60a5fa';
          ctx.fillText(`📍 ${tr ? 'AFAD KOORDİNASYON MERKEZİ' : 'AFAD HQ'}`, sx + 10 * dpr, sy + 4 * dpr);
        }
      }

      // 6. Sahra Hastanesi Seçim ve Uygunluk Parseli (FS Değerlendirmesi)
      if (sc.hospital) {
        const [sx, sy, vis] = projectGrid(L.colOfLon(sc.hospital.lon), L.rowOfLat(sc.hospital.lat));
        if (vis) {
          const s = 16 * dpr;
          ctx.fillStyle = 'rgba(16, 185, 129, 0.24)';
          ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2.2 * dpr;
          ctx.strokeRect(sx - s, sy - s, s * 2, s * 2);

          const b = 4 * dpr;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(sx - s - b, sy - s); ctx.lineTo(sx - s, sy - s); ctx.lineTo(sx - s, sy - s - b);
          ctx.moveTo(sx + s + b, sy - s); ctx.lineTo(sx + s, sy - s); ctx.lineTo(sx + s, sy - s - b);
          ctx.moveTo(sx - s - b, sy + s); ctx.lineTo(sx - s, sy + s); ctx.lineTo(sx - s, sy + s + b);
          ctx.moveTo(sx + s + b, sy + s); ctx.lineTo(sx + s, sy + s); ctx.lineTo(sx + s, sy + s + b);
          ctx.stroke();

          ctx.font = `700 ${11.5 * dpr}px monospace`;
          ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
          ctx.fillText(`🏥 ${tr ? 'SAHRA HASTANESİ (FS = 2.45 · OPTİMAL)' : 'FIELD HOSPITAL (FS = 2.45 · OPTIMAL)'}`, sx + s + 8 * dpr + 1, sy + 4 * dpr + 1);
          ctx.fillStyle = '#6ee7b7';
          ctx.fillText(`🏥 ${tr ? 'SAHRA HASTANESİ (FS = 2.45 · OPTİMAL)' : 'FIELD HOSPITAL (FS = 2.45 · OPTIMAL)'}`, sx + s + 8 * dpr, sy + 4 * dpr);
        }
      }

      // 7. Tehlike / Hasar Alanı (Hazard Exclusion Zone)
      if (sc.hazard) {
        const [sx, sy, vis] = projectGrid(L.colOfLon(sc.hazard.lon), L.rowOfLat(sc.hazard.lat));
        if (vis) {
          const r = Math.max(18, sc.hazard.rKm * (scale * 3.5)) * dpr;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.8 * dpr;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
          ctx.fill();
          ctx.font = `600 ${10 * dpr}px monospace`;
          ctx.fillStyle = '#fca5a5';
          ctx.fillText(`⚠ ${sc.hazard.name}`, sx - r, sy - r - 6 * dpr);
        }
      }

      // 8. Taktik SAR Grid Çerçevesi (Arama-Kurtarma Sektörleme Grid'i)
      if (scale >= 5.0 && sc.hq && sc.hospital) {
        const [hx, hy] = projectGrid(L.colOfLon(sc.hq.lon), L.rowOfLat(sc.hq.lat));
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        for (let off = -120 * dpr; off <= 120 * dpr; off += 60 * dpr) {
          ctx.beginPath(); ctx.moveTo(hx + off, hy - 140 * dpr); ctx.lineTo(hx + off, hy + 140 * dpr); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(hx - 140 * dpr, hy + off); ctx.lineTo(hx + 140 * dpr, hy + off); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = `500 ${8.5 * dpr}px monospace`;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
        ctx.fillText('SEKTÖR A-1 (AFAD SAR)', hx - 110 * dpr, hy - 110 * dpr);
        ctx.fillText('SEKTÖR A-2 (İKA / UGV)', hx + 30 * dpr, hy - 110 * dpr);
      }

      // 9. Özel İnteraktif A* Başlangıç ve Hedef Pinleri (Map Click Pins)
      if (S.afad && S.afad.customStart) {
        const [sx, sy, vis] = projectGrid(L.colOfLon(S.afad.customStart.lon), L.rowOfLat(S.afad.customStart.lat));
        if (vis) {
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath();
          ctx.arc(sx, sy, 8 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2 * dpr;
          ctx.stroke();

          const lbl = S.afad.customGoal
            ? `📍 ${tr ? 'A* BAŞLANGIÇ (SAR Çıkış)' : 'A* START'}`
            : `📍 ${tr ? 'A* BAŞLANGIÇ (Hedef seçmek için haritaya tıklayın)' : 'A* START (Click for Goal)'}`;
          ctx.font = `700 ${11 * dpr}px monospace`;
          ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
          ctx.fillText(lbl, sx + 11 * dpr + 1, sy + 4 * dpr + 1);
          ctx.fillStyle = '#93c5fd';
          ctx.fillText(lbl, sx + 11 * dpr, sy + 4 * dpr);
        }
      }
      if (S.afad && S.afad.customGoal) {
        const [gx, gy, vis] = projectGrid(L.colOfLon(S.afad.customGoal.lon), L.rowOfLat(S.afad.customGoal.lat));
        if (vis) {
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(gx, gy, 8 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2 * dpr;
          ctx.stroke();

          const lbl = `🎯 ${tr ? 'A* HEDEF (Tahliye Noktası)' : 'A* GOAL'}`;
          ctx.font = `700 ${11 * dpr}px monospace`;
          ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
          ctx.fillText(lbl, gx + 11 * dpr + 1, gy + 4 * dpr + 1);
          ctx.fillStyle = '#6ee7b7';
          ctx.fillText(lbl, gx + 11 * dpr, gy + 4 * dpr);
        }
      }

      ctx.restore();
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
      // Rover-range label goes BELOW the pin: the legacy "EVA WALKBACK" label (when that demo
      // is open) sits above the same point, and at low zoom the two boxes used to overlap.
      const lbl = rangeKm > 0 ? `${rangeKm.toFixed(1)} km` : '0 km';
      ctx.font = `600 ${Math.round(10 * dpr)}px "SF Mono", "IBM Plex Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = 'rgba(12, 14, 18, 0.88)';
      ctx.fillRect(px - tw / 2 - 4 * dpr, py + r + 16 * dpr, tw + 8 * dpr, 13 * dpr);
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lbl, px, py + r + 22.5 * dpr);
    }

    function zoomBy(factor) {
      if (S.viewMode === '3d' && globe) {
        globe.state.targetDist = Math.max(1.22, Math.min(4.6, globe.state.targetDist / factor));
        schedule3D();
        return;
      }
      const mx = canvas.width / 2, my = canvas.height / 2;
      const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9;
      const ns = Math.max(minS, Math.min((S.mode === 'afad' || detail.levels.length) ? 96 : 40, S.view.scale * factor));
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
      const ns = Math.max(minS, Math.min((S.mode === 'afad' || detail.levels.length) ? 96 : 40, S.view.scale * f)), k = ns / S.view.scale;
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
      const isAfad = S.mode === 'afad';
      const ER = global.EARTH_ROADS || null;

      if (isAfad && ER) {
        const land = ER.isLand ? ER.isLand(v.lat, v.lon) : true;
        const mgrs = ER.latLonToMGRS ? ER.latLonToMGRS(v.lat, v.lon) : 'WGS-84';
        let bestCity = 'Anadolu / Akdeniz', bestDist = Infinity;
        if (ER.NODES) {
          for (const k in ER.NODES) {
            const nd = ER.NODES[k];
            const d = Math.hypot(v.lat - nd.lat, (v.lon - nd.lon) * Math.cos(v.lat * Math.PI / 180)) * 111.3;
            if (d < bestDist) { bestDist = d; bestCity = nd.name; }
          }
        }
        const surfTxt = land ? (tr ? 'KARA (Karayolu/Saha)' : 'LAND') : (tr ? 'DENİZ (Akdeniz/Karadeniz)' : 'SEA');
        if ($('#hud-coord')) {
          $('#hud-coord').textContent = `WGS-84: ${fmtLat(v.lat)} · ${fmtLon(v.lon)} · MGRS: ${mgrs} · ${surfTxt} · 1.0g (9.81 m/s²)`;
        }
        if (tip) {
          if (global.matchMedia && global.matchMedia('(hover: none)').matches) { tip.classList.add('hidden'); return; }
          const nearLbl = bestDist < 80 ? escHtml(bestCity) : `${escHtml(bestCity)} (${bestDist.toFixed(0)} km)`;
          const sum = ER.getRoadFeedSummary ? ER.getRoadFeedSummary().counts : { open: 50, damaged: 2, blocked: 1 };
          tip.innerHTML = `<span class="tt-region">${nearLbl} · ${surfTxt}</span><b>${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))}</b><br>MGRS: <b>${escHtml(mgrs)}</b> · Datum: WGS-84<br>KGM Ağ: ${sum.open} Açık · ${sum.damaged} Hasarlı · ${sum.blocked} Kapalı<br>${land ? 'Kara Taşıtı & İKA Uygun (1.0g · 1013 hPa)' : 'Deniz Koridoru (Ro-Ro / TCG Bayraktar / Hava)'}`;
          const r = canvas.getBoundingClientRect();
          tip.classList.remove('hidden');
          const tipW = tip.offsetWidth || 220, tipH = tip.offsetHeight || 95;
          tip.style.left = Math.max(8, Math.min(Math.max(8, r.width - tipW - 8), e.clientX - r.left + 14)) + 'px';
          tip.style.top = Math.max(8, Math.min(Math.max(8, r.height - tipH - 8), e.clientY - r.top + 14)) + 'px';
        }
        return;
      }

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
          const minS = Math.min(canvas.width / W, canvas.height / H) * 0.9, ns = Math.max(minS, Math.min((S.mode === 'afad' || detail.levels.length) ? 96 : 40, touchState.scale * ratio));
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
