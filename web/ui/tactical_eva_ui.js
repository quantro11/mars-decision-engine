// UI controller, ONLINE-ONLY orbital fetcher, and 16 km2 square canvas visualizer for Tactical EVA.
// Reuses MDE_TACTICAL_EVA_ENGINE, MDE_MARS_TIME, STORM, SCORING, and MDE_BRIEF.
(function (global) {
  'use strict';

  const LAYER_DEFS = [
    { key: 'optics',          label: 'Optics (imagery)',         labelTr: 'Optik (görüntü)',          unit: 'CTX / 0–100', defOn: true,  defOp: 90, lowRes: false, stops: ['#181c24', '#6d7888', '#d8dee8'] },
    { key: 'final',           label: 'Final landing score',      labelTr: 'Nihai iniş skoru',         unit: '0–100',       defOn: true,  defOp: 65, lowRes: false, stops: ['#9d2820', '#d88a2e', '#2ea35a'] },
    { key: 'power',           label: 'Power & Energy',           labelTr: 'Güç & Enerji',             unit: '0–100 / Wh',  defOn: false, defOp: 70, lowRes: false, stops: ['#8c2317', '#dfa13b', '#2eb369'] },
    { key: 'topography',      label: 'Topography',               labelTr: 'Topografya',               unit: '0–100 / m',   defOn: false, defOp: 70, lowRes: false, stops: ['#24303c', '#7fa2bf', '#e2b86d'] },
    { key: 'thermal',         label: 'Thermal',                  labelTr: 'Termal',                   unit: '0–100 / tiu', defOn: false, defOp: 70, lowRes: false, stops: ['#2b4c7e', '#3da36b', '#df8d3e'] },
    { key: 'radiation',       label: 'Radiation (space dose)',   labelTr: 'Radyasyon (uzay dozu)',    unit: '0–100 / mSv', defOn: false, defOp: 70, lowRes: false, stops: ['#8a2936', '#d6a33a', '#3aa884'] },
    { key: 'groundComp',      label: 'Ground composition (K/Th)',labelTr: 'Zemin bileşimi (K/Th)',    unit: 'wt% K, ppm Th',defOn: false, defOp: 70, lowRes: true,  stops: ['#2a528a', '#68a4ad', '#dfb85b'] },
    { key: 'geology',         label: 'Geology (SIM 3292)',       labelTr: 'Jeoloji (SIM 3292)',       unit: 'USGS unit',   defOn: false, defOp: 70, lowRes: true,  stops: ['#5b4b7a', '#8c9c5e', '#d6824b'] },
    { key: 'elevation',       label: 'Elevation',                labelTr: 'Yükseklik',                unit: 'm',           defOn: false, defOp: 70, lowRes: false, stops: ['#1f3a60', '#4f8f8c', '#e6b87d'] },
    { key: 'slope',           label: 'Slope',                    labelTr: 'Eğim',                     unit: 'deg',         defOn: false, defOp: 70, lowRes: false, stops: ['#2b8f55', '#e2b646', '#c9332b'] },
    { key: 'dust',            label: 'Dust',                     labelTr: 'Toz',                      unit: '0–100 / DCI', defOn: false, defOp: 70, lowRes: true,  stops: ['#b85e2a', '#d9a44b', '#4d9bb5'] },
    { key: 'confidence',      label: 'Confidence',               labelTr: 'Güven',                    unit: '%',           defOn: false, defOp: 70, lowRes: false, stops: ['#4c2f3b', '#9e7d3c', '#45b8b0'] },
  ];

  const GEOL_PALETTE = {
    'Lowland Units':    [92, 166, 128],
    'Basin Units':      [76, 138, 178],
    'Transition Units': [205, 146, 78],
    'Volcanic Units':   [182, 88, 72],
    'Highland Units':   [152, 114, 164],
    'Apron Units':      [196, 176, 98],
    'Impact Unit':      [192, 96, 142],
    'Polar Units':      [176, 212, 224],
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function interpColor3(stops, t) {
    const u = clamp(t, 0, 1);
    const c0 = hexToRgb(stops[0]);
    const c1 = hexToRgb(stops[1]);
    const c2 = hexToRgb(stops[2]);
    if (u < 0.5) {
      const f = u * 2;
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
    const f = (u - 0.5) * 2;
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * f),
      Math.round(c1[1] + (c2[1] - c1[1]) * f),
      Math.round(c1[2] + (c2[2] - c1[2]) * f),
    ];
  }

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // ONLINE-ONLY: stitch Caltech Murray Lab OnMars/CTX LOD 12 tiles (~5 m/px) in browser
  async function fetchOnlineCtx(bbox, gridN) {
    const CTX_RES_DEG = 8.58306884765625e-05;
    const TILE_PX = 512;
    const nWorldCols = Math.round(360 / (CTX_RES_DEG * TILE_PX));
    const [lonMin, latMin, lonMax, latMax] = bbox;
    const pxLeft = (lonMin + 180) / CTX_RES_DEG;
    const pxRight = (lonMax + 180) / CTX_RES_DEG;
    const pxTop = (90 - latMax) / CTX_RES_DEG;
    const pxBottom = (90 - latMin) / CTX_RES_DEG;
    const c0 = Math.floor(pxLeft / TILE_PX);
    const c1 = Math.floor(pxRight / TILE_PX);
    const r0 = Math.floor(pxTop / TILE_PX);
    const r1 = Math.floor(pxBottom / TILE_PX);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 9) return null;

    const loadTile = (tr, tc) => new Promise((resolve, reject) => {
      const wc = ((tc % nWorldCols) + nWorldCols) % nWorldCols;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => reject(new Error('CTX tile timeout')), 8000);
      img.onload = () => { clearTimeout(timer); resolve({ tr, tc, img }); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('CTX tile error')); };
      img.src = `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/12/${tr}/${wc}`;
    });

    const jobs = [];
    for (let tr = r0; tr <= r1; tr++) {
      for (let tc = c0; tc <= c1; tc++) jobs.push(loadTile(tr, tc));
    }
    const loaded = await Promise.all(jobs);
    const outN = 200;
    const cvs = document.createElement('canvas');
    cvs.width = outN;
    cvs.height = outN;
    const ctx2d = cvs.getContext('2d');
    const spanX = pxRight - pxLeft;
    const spanY = pxBottom - pxTop;
    for (const t of loaded) {
      const sx0 = t.tc * TILE_PX;
      const sy0 = t.tr * TILE_PX;
      const dx = ((sx0 - pxLeft) / spanX) * outN;
      const dy = ((sy0 - pxTop) / spanY) * outN;
      const dw = (TILE_PX / spanX) * outN;
      const dh = (TILE_PX / spanY) * outN;
      ctx2d.drawImage(t.img, dx, dy, dw, dh);
    }
    const dataUri = cvs.toDataURL('image/png');
    const px = ctx2d.getImageData(0, 0, outN, outN).data;
    const step = Math.floor(outN / gridN);
    const total = gridN * gridN;
    const ctxTone = new Array(total);
    const ctxContrast = new Array(total);
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        let sum = 0, sumSq = 0, cnt = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const p = ((gy * step + dy) * outN + (gx * step + dx)) * 4;
            const lum = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114);
            sum += lum;
            sumSq += lum * lum;
            cnt++;
          }
        }
        const mean = sum / cnt;
        const std = Math.sqrt(Math.max(0, sumSq / cnt - mean * mean));
        ctxTone[gy * gridN + gx] = +(mean / 255).toFixed(4);
        ctxContrast[gy * gridN + gx] = +Math.min(1, std / 64).toFixed(4);
      }
    }
    return { dataUri, ctxTone, ctxContrast };
  }

  // ONLINE-ONLY: query USGS SIM 3292 FeatureServer/3 polygons intersecting 4 km box
  async function fetchOnlineSim3292(bbox, gridN) {
    const [x0, y0, x1, y1] = bbox;
    const qs = new URLSearchParams({
      geometry: `${x0},${y0},${x1},${y1}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'Unit',
      returnGeometry: 'true',
      maxAllowableOffset: '0.0005',
      f: 'json',
    });
    const res = await fetchWithTimeout(
      `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer/3/query?${qs}`,
      8500
    );
    const json = await res.json();
    const feats = json.features || [];
    if (!feats.length) return null;
    const out = new Array(gridN * gridN);
    const defUnit = feats[0].attributes.Unit;
    const dLat = (y1 - y0) / gridN;
    const dLon = (x1 - x0) / gridN;
    for (let r = 0; r < gridN; r++) {
      const cy = y1 - (r + 0.5) * dLat;
      for (let c = 0; c < gridN; c++) {
        const cx = x0 + (c + 0.5) * dLon;
        let hit = defUnit;
        for (const f of feats) {
          const rings = (f.geometry && f.geometry.rings) || [];
          if (rings.length && pointInRing(cx, cy, rings[0])) {
            hit = f.attributes.Unit;
            break;
          }
        }
        out[r * gridN + c] = hit;
      }
    }
    return out;
  }

  // ONLINE-ONLY: query same-origin Vercel /api/wms proxy for numeric JMARS scientific layers
  async function fetchOnlineWmsLayer(layer, bbox, size) {
    const b = bbox.map((v) => v.toFixed(6)).join(',');
    const res = await fetchWithTimeout(`/api/wms?layer=${encodeURIComponent(layer)}&bbox=${b}&size=${size}`, 9500);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Proxy /api/wms unavailable');
    const json = await res.json();
    if (!json || !json.ok || !Array.isArray(json.values)) throw new Error('Bad /api/wms payload');
    return json.values;
  }

  function fillNodataArr(arr, validFn) {
    const out = arr.slice();
    let fallback = null;
    for (const v of out) {
      if (v != null && validFn(v)) { fallback = v; break; }
    }
    if (fallback === null) return null;
    for (let i = 0; i < out.length; i++) {
      if (out[i] == null || !validFn(out[i])) out[i] = fallback;
    }
    return out;
  }

  function computeRelief3x3(elev, n) {
    const out = new Array(n * n);
    for (let r = 0; r < n; r++) {
      const rm = Math.max(0, r - 1), rp = Math.min(n - 1, r + 1);
      for (let c = 0; c < n; c++) {
        const cm = Math.max(0, c - 1), cp = Math.min(n - 1, c + 1);
        let mn = Infinity, mx = -Infinity;
        for (let rr = rm; rr <= rp; rr++) {
          for (let cc = cm; cc <= cp; cc++) {
            const v = elev[rr * n + cc];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        out[r * n + c] = +(mx - mn).toFixed(2);
      }
    }
    return out;
  }

  async function fetchOnlineOrbitalGrid(loc, layers, tacticalCfg, engine, cutouts) {
    const base = engine.buildGlobalFallbackGrid(loc.latDeg, loc.lon180, layers, tacticalCfg, cutouts);
    const bb = loc.bbox180;
    const n = base.gridN;

    const jobs = await Promise.allSettled([
      fetchOnlineCtx(bb, n),
      fetchOnlineSim3292(bb, n),
      fetchOnlineWmsLayer('mola_hrsc_blend_topo_v2', bb, n),
      fetchOnlineWmsLayer('mola_hrsc_blend_slope_v2', bb, n),
      fetchOnlineWmsLayer('thm_ti_100m_32bit', bb, n),
      fetchOnlineWmsLayer('TES_dust_index_16ppd_numeric', bb, n),
      fetchOnlineWmsLayer('omega_albedo_r1080', bb, n),
      fetchOnlineWmsLayer('GRS_K_conc_numeric', bb, 8),
      fetchOnlineWmsLayer('GRS_Th_conc_numeric', bb, 8),
    ]);

    const val = (idx) => (jobs[idx].status === 'fulfilled' ? jobs[idx].value : null);
    let anyFineWms = false;
    let anyCtx = false;

    const ctx = val(0);
    if (ctx) {
      base.ctxImgDataUri = ctx.dataUri;
      base.ctxTone = ctx.ctxTone;
      base.ctxContrast = ctx.ctxContrast;
      base.sources.imagery = { id: 'OnMars/CTX LOD 12 (ONLINE-ONLY)', nativeResM: 5, displayResM: 20, date: '2023-04' };
      anyCtx = true;
    }

    const sim = val(1);
    if (sim) {
      base.geolUnits = sim;
      base.sources.geology = { id: 'USGS SIM 3292 FeatureServer/3 (ONLINE-ONLY)', nativeResM: 20000, lowRes: true, date: '2014' };
    }

    const elev = val(2) && fillNodataArr(val(2), (v) => Math.abs(v) < 25000);
    const slope = val(3) && fillNodataArr(val(3), (v) => v >= 0 && v < 89);
    const ti = val(4) && fillNodataArr(val(4), (v) => v > 5 && v < 3000);
    if (elev && ti) {
      base.elevM = elev;
      base.reliefM = computeRelief3x3(elev, n);
      base.ti = ti;
      base.sources.elevation = { id: 'mola_hrsc_blend_topo_v2 (ONLINE-ONLY)', nativeResM: 200, date: '2018-01-31' };
      base.sources.ti = { id: 'thm_ti_100m_32bit (ONLINE-ONLY)', nativeResM: 100, date: '2014-05-30' };
      anyFineWms = true;
    }
    if (slope) {
      base.slopeDeg = slope;
      base.sources.slope = { id: 'mola_hrsc_blend_slope_v2 (ONLINE-ONLY)', nativeResM: 200, date: '2018-01-31' };
    }

    const dci = val(5) && fillNodataArr(val(5), (v) => v > 0.5 && v <= 1.2);
    if (dci) {
      base.dci = dci;
      base.sources.dust = { id: 'TES_dust_index_16ppd_numeric (ONLINE-ONLY)', nativeResM: 3700, lowRes: true, date: '2002 (Ruff & Christensen)' };
    }
    const alb = val(6) && fillNodataArr(val(6), (v) => v > 0.02 && v < 0.8);
    if (alb) {
      base.albedo = alb;
      base.sources.albedo = { id: 'omega_albedo_r1080 (ONLINE-ONLY)', nativeResM: 1080, lowRes: true, date: '2004-2010' };
    }
    const grsK = val(7);
    if (grsK && grsK.some((v) => v >= 0 && v < 5)) {
      const kMean = grsK.filter((v) => v >= 0 && v < 5)[0];
      base.grsK = base.grsK.map(() => +kMean.toFixed(3));
      base.sources.grs = { id: 'Odyssey GRS K/Th (ONLINE-ONLY)', nativeResM: 550000, lowRes: true, date: '2007 (Boynton)' };
    }
    const grsTh = val(8);
    if (grsTh && grsTh.some((v) => v >= 0 && v < 10)) {
      const thMean = grsTh.filter((v) => v >= 0 && v < 10)[0];
      base.grsTh = base.grsTh.map(() => +thMean.toFixed(3));
    }

    base.isLowResGrid = !anyFineWms;
    base.dataMode = anyFineWms
      ? 'ONLINE_ORBITAL'
      : (anyCtx || sim ? 'ONLINE_CTX_GLOBAL_FALLBACK' : 'OFFLINE_GLOBAL_FALLBACK');
    return base;
  }

  const FIELD_STORE_KEY = 'mde_tac_field_data_v1';

  function escHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createTacticalEvaController(ctx) {
    const { doc = global.document, S, layers, onToast } = ctx;
    const engine = global.MDE_TACTICAL_EVA_ENGINE;
    const vehiclesCfg = global.MDE_VEHICLES;
    const tacticalCfg = global.MDE_TACTICAL_CONFIG;
    const cutouts = global.MDE_EVA_CUTOUTS || null;
    const marsTime = global.MDE_MARS_TIME;
    const brief = global.MDE_BRIEF;
    const scoring = global.SCORING;
    const storm = global.STORM;

    const $ = (id) => doc.getElementById(id);

    // Persistent inputs survive tab switching
    const inputs = S.tacticalInputs || engine.getDefaultInputs(vehiclesCfg, tacticalCfg);
    S.tacticalInputs = inputs;

    const layerState = {};
    for (const def of LAYER_DEFS) {
      layerState[def.key] = { visible: def.defOn, opacity: def.defOp / 100 };
    }

    let fieldMeasurements = [];
    try {
      const saved = global.localStorage && global.localStorage.getItem(FIELD_STORE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) fieldMeasurements = parsed;
      }
    } catch (_) {
      fieldMeasurements = [];
    }

    let analysis = null;
    let selectedCellIdx = null;
    let mapClosed = false;
    let editingFieldId = null;
    let lastNormalMean = null;
    let lastScenarioTag = null;
    let loadedCtxUrl = null;
    let loadedCtxImg = null;
    let resizeObs = null;

    function isTr() {
      return !!(global.MDE_I18N && global.MDE_I18N.getLang && global.MDE_I18N.getLang() === 'tr');
    }

    function saveFieldData() {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(FIELD_STORE_KEY, JSON.stringify(fieldMeasurements));
        }
      } catch (_) { /* ignore private-mode quota errors */ }
    }

    function fmtLonDisp(lon180, conv) {
      const v = engine.formatLonForConvention(lon180, conv);
      return conv === '0_360' ? `${v.toFixed(3)}° E` : `${v.toFixed(3)}°`;
    }

    function updateMarsClockReadout() {
      const el = $('tac-mars-time');
      const dEl = $('tac-date');
      if (!el || !dEl) return;
      const loc = engine.validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
      const lon360 = loc.valid ? loc.lon360 : 77.58;
      const mt = marsTime.computeMarsTime(dEl.value || inputs.earthDateUtc, lon360);
      el.textContent = `MY ${mt.marsYear} · Ls ${mt.lsDeg.toFixed(1)}° · ${mt.seasonName}`;
    }

    function updateRegionReadout() {
      const regEl = $('tac-region-name');
      const errEl = $('tac-loc-error');
      const lbl = $('tac-lon-range-lbl');
      if (lbl) lbl.textContent = inputs.lonConvention === '0_360' ? '0…360° E' : '−180…180°';
      const loc = engine.validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
      if (errEl) {
        errEl.textContent = loc.valid ? '' : loc.errors.join(' ');
        errEl.classList.toggle('hidden', loc.valid);
      }
      if (!regEl) return;
      if (!loc.valid) {
        regEl.textContent = '—';
        return;
      }
      const nr = engine.nearestRegionName(loc.latDeg, loc.lon180, { layers, regions: global.REGIONS });
      const cutout = engine.findPresetCutout(cutouts, loc.latDeg, loc.lon180);
      const featTxt = nr ? `${nr.name} (${nr.distKm} km)` : (isTr() ? 'Yakında isimli özellik yok' : 'No nearby named feature');
      if (cutout) {
        regEl.textContent = nr ? `${cutout.name} · ${featTxt}` : cutout.name;
      } else {
        regEl.textContent = featTxt;
      }
    }

    function makeBadge(verified, concept, sourceText) {
      const cls = concept ? 'tac-badge tac-badge-concept' : (verified ? 'tac-badge tac-badge-ok' : 'tac-badge tac-badge-warn');
      const label = concept ? 'CONCEPT – not flight data' : (verified ? 'NASA verified' : '⚠ unverified');
      return `<span class="${cls}" title="${escHtml(sourceText)}">${label}</span>`;
    }

    function syncVehiclePanel(resetSliders) {
      const veh = engine.resolveVehicleConfig(vehiclesCfg, inputs.vehicleClass, {
        speedKmh: inputs.speedKmh,
        extraLoadKg: inputs.extraLoadKg,
        powerMode: inputs.powerMode,
      }, !!resetSliders);

      if (resetSliders) {
        inputs.speedKmh = veh.speedKmh;
        inputs.extraLoadKg = veh.extraLoadKg;
        inputs.powerMode = veh.powerMode;
      }

      const spEl = $('tac-veh-speed');
      const ldEl = $('tac-veh-load');
      if (spEl) {
        spEl.min = String(veh.speedSpec.min);
        spEl.max = String(veh.speedSpec.max);
        spEl.step = String(veh.speedSpec.step);
        spEl.value = String(veh.speedKmh);
      }
      if (ldEl) {
        ldEl.min = String(veh.extraLoadSpec.min);
        ldEl.max = String(veh.extraLoadSpec.max);
        ldEl.step = String(veh.extraLoadSpec.step);
        ldEl.value = String(veh.extraLoadKg);
      }

      const spV = $('tac-veh-speed-v');
      if (spV) spV.innerHTML = `${veh.speedKmh} km/h ${makeBadge(veh.speedSpec.verified, veh.concept, veh.speedSpec.source)}`;
      const ldV = $('tac-veh-load-v');
      if (ldV) ldV.innerHTML = `${veh.extraLoadKg} kg ${makeBadge(veh.extraLoadSpec.verified, veh.concept, veh.extraLoadSpec.source)}`;

      const banner = $('tac-veh-concept-banner');
      if (banner) {
        banner.classList.toggle('hidden', !veh.concept);
        if (veh.concept) banner.textContent = isTr()
          ? 'CONCEPT – uçuş verisi değil · Mürettebatlı rover değerleri mühendislik kavramıdır.'
          : 'CONCEPT – not flight data · All crewed rover specifications are architectural assumptions.';
      }

      const pwWrap = $('tac-veh-power-wrap');
      const pwSel = $('tac-veh-power-mode');
      if (pwSel) {
        pwSel.innerHTML = '';
        for (const m of veh.selectablePowerModes) {
          const opt = doc.createElement('option');
          opt.value = m;
          opt.textContent = m === 'battery' ? 'Battery (60 kWh CONCEPT)' : (m === 'nuclear' ? (veh.concept ? 'RTG / Nuclear (CONCEPT)' : 'Nuclear MMRTG (~110 W)') : (veh.concept ? 'Deployable Solar (CONCEPT)' : 'Solar Array (~13 W)'));
          if (m === veh.powerMode) opt.selected = true;
          pwSel.appendChild(opt);
        }
        pwSel.disabled = veh.selectablePowerModes.length <= 1;
      }
      if (pwWrap) pwWrap.classList.toggle('tac-single-power', veh.selectablePowerModes.length <= 1);

      const specs = $('tac-veh-specs');
      if (specs) {
        const massRange = veh.baseMassKg.rangeMin ? ` (${veh.baseMassKg.rangeMin}–${veh.baseMassKg.rangeMax} kg)` : '';
        specs.innerHTML =
          `<div class="tac-spec-row"><span>${isTr() ? 'Boş / Toplam kütle' : 'Base / Total mass'}</span><b>${veh.baseMassKg.value} / ${veh.totalMassKg} kg${massRange}</b> ${makeBadge(veh.baseMassKg.verified, veh.concept, veh.baseMassKg.source)}</div>` +
          `<div class="tac-spec-row"><span>${isTr() ? 'Eğim sınırı' : 'Slope limit'}</span><b>${veh.slopeLimitDeg.value}°</b> ${makeBadge(veh.slopeLimitDeg.verified, veh.concept, veh.slopeLimitDeg.source)}</div>` +
          `<div class="tac-spec-row"><span>${isTr() ? 'Güç' : 'Power'}</span><b>${veh.powerMode.toUpperCase()} (${veh.power.ratedPowerW.value} W)</b> ${makeBadge(veh.power.ratedPowerW.verified, veh.concept, veh.power.ratedPowerW.source)}</div>`;
      }

      const fxEl = $('tac-veh-effects-note');
      if (fxEl) {
        fxEl.innerHTML =
          `<b>${isTr() ? 'Araç kuralları' : 'Vehicle rules'} ${makeBadge(false, veh.concept, veh.effects.massEnergyCoeffWhPerKgKm.source)}:</b> ` +
          (isTr()
            ? (veh.powerMode === 'solar'
              ? 'Yüksek kütle km başına enerjiyi ve gevşek kumda batmayı artırır; güneş üretimi τ ve Ls ile düşer.'
              : 'Nükleer/Batarya τ tozundan etkilenmez, ancak soğuk ısıtıcı çekişini artırır.')
            : (veh.powerMode === 'solar'
              ? 'Higher mass raises energy/km and loose-sand (low-TI) sinkage; solar output tracks τ & Ls via STORM dust model.'
              : 'Nuclear/Battery ignores τ, while cold raises trace-heater draw.'));
      }
    }

    function buildWeightSliders() {
      const box = $('tac-weights-box');
      if (!box) return;
      box.innerHTML = '';
      const norm = scoring.normalize(inputs.weights);
      for (const k in tacticalCfg.weights) {
        const wDef = tacticalCfg.weights[k];
        const row = doc.createElement('label');
        row.innerHTML = `${isTr() ? wDef.label_tr : wDef.label} <span id="tac-wval-${k}">${Math.round(norm[k] * 100)}%</span>` +
          `<input type="range" min="0" max="100" step="1" value="${Math.round((inputs.weights[k] ?? wDef.default) * 100)}" data-wkey="${k}">`;
        row.querySelector('input').oninput = (e) => {
          inputs.weights[k] = Number(e.target.value) / 100;
          const n = scoring.normalize(inputs.weights);
          for (const kk in tacticalCfg.weights) {
            const sp = $('tac-wval-' + kk);
            if (sp) sp.textContent = Math.round(n[kk] * 100) + '%';
          }
          if (analysis) runAnalysis(true);
        };
        box.appendChild(row);
      }
    }

    function buildLayerControls() {
      const list = $('tac-layer-list');
      if (!list) return;
      list.innerHTML = '';
      const tr = isTr();
      for (const def of LAYER_DEFS) {
        const st = layerState[def.key];
        const row = doc.createElement('div');
        row.className = 'tac-layer-row';
        row.innerHTML =
          `<label class="tac-layer-chk"><input type="checkbox" ${st.visible ? 'checked' : ''} data-lkey="${def.key}"> <span>${tr ? def.labelTr : def.label}</span></label>` +
          `<div class="tac-layer-op-wrap"><input type="range" min="0" max="100" step="5" value="${Math.round(st.opacity * 100)}" data-opkey="${def.key}" aria-label="${def.label} opacity"><span class="tac-op-num">%${Math.round(st.opacity * 100)}</span></div>`;
        row.querySelector('[data-lkey]').onchange = (e) => {
          st.visible = e.target.checked;
          renderCanvasAndLegend();
        };
        row.querySelector('[data-opkey]').oninput = (e) => {
          st.opacity = Number(e.target.value) / 100;
          row.querySelector('.tac-op-num').textContent = `%${Math.round(st.opacity * 100)}`;
          renderCanvasAndLegend();
        };
        list.appendChild(row);
      }
    }

    function getLayerDef(key) {
      return LAYER_DEFS.find((d) => d.key === key) || LAYER_DEFS[0];
    }

    function colorForLayerCell(defKey, idx) {
      const g = analysis.grids;
      const def = getLayerDef(defKey);
      if (defKey === 'final') {
        if (g.impassable[idx] || g.nasaVeto[idx] || g.powerDeficit[idx]) return [145, 34, 28];
        return interpColor3(def.stops, g.final[idx] / 100);
      }
      if (defKey === 'power') {
        if (g.powerDeficit[idx]) return [140, 35, 23];
        return interpColor3(def.stops, g.power[idx] / 100);
      }
      if (defKey === 'optics') {
        if (analysis.ctxImgDataUri && !inputs.useCoarseBaseline) return null;
        return interpColor3(def.stops, g.optics[idx] / 100);
      }
      if (defKey === 'topography') return interpColor3(def.stops, g.topography[idx] / 100);
      if (defKey === 'thermal') return interpColor3(def.stops, g.thermal[idx] / 100);
      if (defKey === 'radiation') return interpColor3(def.stops, g.radiation[idx] / 100);
      if (defKey === 'groundComp') {
        const kNorm = clamp((g.grsK[idx] - 0.1) / 0.5, 0, 1);
        return interpColor3(def.stops, kNorm);
      }
      if (defKey === 'geology') {
        const u = tacticalCfg.geologySim3292.units[g.geolUnits[idx]];
        return (u && GEOL_PALETTE[u.group]) || [140, 130, 118];
      }
      if (defKey === 'elevation') {
        const mn = analysis._elevMin, mx = analysis._elevMax;
        const t = mx > mn ? (g.elevM[idx] - mn) / (mx - mn) : 0.5;
        return interpColor3(def.stops, t);
      }
      if (defKey === 'slope') {
        const lim = analysis.vehicle.slopeLimitDeg.value;
        if (g.slopeDeg[idx] > lim) return [185, 35, 35];
        return interpColor3(def.stops, clamp(g.slopeDeg[idx] / Math.max(1, lim), 0, 1));
      }
      if (defKey === 'dust') return interpColor3(def.stops, g.dust[idx] / 100);
      if (defKey === 'confidence') return interpColor3(def.stops, g.confidence[idx] / 100);
      return [128, 128, 128];
    }

    function drawHatchedOverlay(c2d, w, h, labelText) {
      c2d.save();
      c2d.strokeStyle = 'rgba(205, 212, 222, 0.24)';
      c2d.lineWidth = 1.2;
      for (let d = -h; d < w + h; d += 12) {
        c2d.beginPath();
        c2d.moveTo(d, 0);
        c2d.lineTo(d + h, h);
        c2d.stroke();
      }
      c2d.fillStyle = 'rgba(12, 15, 20, 0.72)';
      c2d.fillRect(6, h - 24, w - 12, 18);
      c2d.fillStyle = '#dfb365';
      c2d.font = '600 10px "IBM Plex Mono", monospace';
      c2d.textAlign = 'center';
      c2d.fillText(labelText, w / 2, h - 11);
      c2d.restore();
    }

    function ensureLoadedCtxImage() {
      const uri = !inputs.useCoarseBaseline && analysis && analysis.ctxImgDataUri;
      if (!uri) { loadedCtxUrl = null; loadedCtxImg = null; return; }
      if (uri === loadedCtxUrl) return;
      loadedCtxUrl = uri;
      const img = new Image();
      img.onload = () => {
        loadedCtxImg = img;
        if (analysis && analysis.ctxImgDataUri === uri) renderCanvasOnly();
      };
      img.src = uri;
    }

    function renderCanvasOnly() {
      const cvs = $('tac-canvas');
      if (!cvs || !analysis || !analysis.ok) return;
      const c2d = cvs.getContext('2d');
      const W = cvs.width, H = cvs.height;
      c2d.clearRect(0, 0, W, H);
      c2d.fillStyle = '#141820';
      c2d.fillRect(0, 0, W, H);

      const n = analysis.gridN;
      const cw = W / n, ch = H / n;

      // Optics base raster imagery if loaded & toggled
      const optSt = layerState.optics;
      if (optSt.visible && !inputs.useCoarseBaseline && loadedCtxImg && loadedCtxImg.complete) {
        c2d.save();
        c2d.globalAlpha = optSt.opacity;
        c2d.drawImage(loadedCtxImg, 0, 0, W, H);
        if (analysis.environment.tau > 0.8) {
          const hazeA = clamp((analysis.environment.tau - 0.5) / 12, 0, 0.55) * optSt.opacity;
          c2d.fillStyle = `rgba(210, 142, 82, ${hazeA.toFixed(3)})`;
          c2d.fillRect(0, 0, W, H);
        }
        c2d.restore();
      }

      // Overlay each visible scientific layer in order
      for (const def of LAYER_DEFS) {
        const st = layerState[def.key];
        if (!st.visible || st.opacity <= 0) continue;
        if (def.key === 'optics' && !inputs.useCoarseBaseline && analysis.ctxImgDataUri) continue;
        c2d.save();
        c2d.globalAlpha = st.opacity;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const idx = r * n + c;
            const rgb = colorForLayerCell(def.key, idx);
            if (!rgb) continue;
            c2d.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            c2d.fillRect(Math.floor(c * cw), Math.floor(r * ch), Math.ceil(cw), Math.ceil(ch));
          }
        }
        c2d.restore();
      }

      // Highlight impassable cells if final, power or slope visible
      if (layerState.final.visible || layerState.slope.visible || layerState.power.visible) {
        c2d.save();
        c2d.strokeStyle = 'rgba(255, 95, 85, 0.72)';
        c2d.lineWidth = 1;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const i = r * n + c;
            if (analysis.grids.impassable[i] || analysis.grids.powerDeficit[i]) {
              const x = c * cw, y = r * ch;
              c2d.beginPath();
              c2d.moveTo(x, y);
              c2d.lineTo(x + cw, y + ch);
              c2d.stroke();
            }
          }
        }
        c2d.restore();
      }

      // Subtle 1 km grid lines
      c2d.save();
      c2d.strokeStyle = 'rgba(255,255,255,0.12)';
      c2d.lineWidth = 1;
      for (let km = 1; km < 4; km++) {
        const p = (km / 4) * W;
        c2d.beginPath(); c2d.moveTo(p, 0); c2d.lineTo(p, H); c2d.stroke();
        c2d.beginPath(); c2d.moveTo(0, p); c2d.lineTo(W, p); c2d.stroke();
      }
      c2d.restore();

      // Hatched low-resolution overlay when coarse global grid OR only coarse orbital layer visible
      const tr = isTr();
      const coarseNote = $('tac-coarse-note');
      const anyCoarseVisible = LAYER_DEFS.some((d) => d.lowRes && layerState[d.key].visible && layerState[d.key].opacity > 0);
      const fineVisible = ['final', 'power', 'elevation', 'slope', 'thermal', 'topography', 'optics'].some((k) => layerState[k].visible && layerState[k].opacity > 0);
      if (coarseNote) coarseNote.classList.toggle('hidden', !analysis.isLowResGrid && !anyCoarseVisible);

      if (analysis.isLowResGrid || inputs.useCoarseBaseline) {
        drawHatchedOverlay(c2d, W, H, tr ? 'KABA VERİ KATMANI (~5 km)' : 'COARSE DATA (~5 km global grid)');
      } else if (anyCoarseVisible && !fineVisible) {
        drawHatchedOverlay(c2d, W, H, tr ? 'KABA YÖRÜNGE KATMANI (>3.7 km)' : 'COARSE ORBITAL LAYER (>3.7 km)');
      }

      // Section D field measurement & hazard markers
      const fmPts = (analysis.fieldAssimilated && analysis.fieldAssimilated.hazardMarkers) || [];
      if (fmPts.length) {
        c2d.save();
        for (const p of fmPts) {
          const px = (p.col + 0.5) * cw;
          const py = (p.row + 0.5) * ch;
          if (p.type === 'hazard') {
            c2d.fillStyle = '#e04f44';
            c2d.strokeStyle = '#ffffff';
            c2d.lineWidth = 1.4;
            c2d.beginPath();
            c2d.moveTo(px, py - 6);
            c2d.lineTo(px + 6, py + 5);
            c2d.lineTo(px - 6, py + 5);
            c2d.closePath();
            c2d.fill();
            c2d.stroke();
          } else {
            c2d.fillStyle = (p.isSimulated || p.simulated) ? '#f5b971' : '#58d69c';
            c2d.strokeStyle = '#0c0f15';
            c2d.lineWidth = 1.5;
            c2d.beginPath();
            c2d.arc(px, py, 4.5, 0, Math.PI * 2);
            c2d.fill();
            c2d.stroke();
          }
        }
        c2d.restore();
      }

      // Center marker
      c2d.save();
      c2d.strokeStyle = '#ffffff';
      c2d.lineWidth = 1.6;
      const cx = W / 2, cy = H / 2;
      c2d.beginPath();
      c2d.arc(cx, cy, 5, 0, Math.PI * 2);
      c2d.moveTo(cx - 10, cy); c2d.lineTo(cx + 10, cy);
      c2d.moveTo(cx, cy - 10); c2d.lineTo(cx, cy + 10);
      c2d.stroke();
      c2d.restore();

      // Selected clicked cell outline
      if (selectedCellIdx !== null && selectedCellIdx >= 0 && selectedCellIdx < n * n) {
        const sr = Math.floor(selectedCellIdx / n);
        const sc = selectedCellIdx % n;
        c2d.save();
        c2d.strokeStyle = '#ffe066';
        c2d.lineWidth = 2;
        c2d.strokeRect(sc * cw, sr * ch, cw, ch);
        c2d.restore();
      }
    }

    function getTopVisibleLayerDef() {
      let top = null;
      for (const def of LAYER_DEFS) {
        if (layerState[def.key].visible && layerState[def.key].opacity > 0) top = def;
      }
      return top;
    }

    function renderLegend() {
      const leg = $('tac-legend');
      if (!leg || !analysis || !analysis.ok) return;
      leg.innerHTML = '';
      const def = getTopVisibleLayerDef();
      if (!def) {
        leg.textContent = isTr() ? 'Görünür katman yok.' : 'No active layers visible.';
        return;
      }
      const row = doc.createElement('div');
      row.className = 'tac-leg-row';
      const sw = doc.createElement('span');
      sw.className = 'tac-leg-bar';
      sw.style.background = `linear-gradient(90deg, ${def.stops[0]}, ${def.stops[1]}, ${def.stops[2]})`;
      let rangeTxt = def.unit;
      if (def.key === 'elevation') {
        rangeTxt = `${analysis._elevMin.toFixed(0)} … ${analysis._elevMax.toFixed(0)} m`;
      } else if (def.key === 'slope') {
        rangeTxt = `0° … ${analysis.vehicle.slopeLimitDeg.value}°`;
      } else if (def.key === 'groundComp') {
        rangeTxt = 'K wt% · Th ppm (~550 km)';
      }
      const lbl = doc.createElement('span');
      lbl.className = 'tac-leg-lbl';
      lbl.innerHTML = `<b>${isTr() ? def.labelTr : def.label}</b> <small>${rangeTxt}</small>`;
      row.appendChild(sw);
      row.appendChild(lbl);
      leg.appendChild(row);
    }

    function getPlainModeLabel() {
      const tr = isTr();
      const fieldCnt = (analysis && analysis.fieldAssimilated && analysis.fieldAssimilated.appliedCount) || 0;
      if (analysis && !analysis.isLowResGrid && !inputs.useCoarseBaseline) {
        return fieldCnt > 0
          ? (tr ? `Saha ölçümü + 100–200 m (${fieldCnt})` : `Field + 100–200 m (${fieldCnt})`)
          : (analysis.dataMode === 'ONLINE_ORBITAL'
            ? (tr ? 'Çevrimiçi veri' : 'Online data')
            : (tr ? 'Yüksek çözünürlük (100–200 m)' : 'High-res (100–200 m)'));
      }
      return fieldCnt > 0
        ? (tr ? 'Saha ölçümü + Kaba veri (5 km)' : 'Field + Coarse (5 km)')
        : (tr ? 'Kaba veri (5 km)' : 'Coarse data (5 km)');
    }

    function renderSummary() {
      const el = $('tac-summary');
      const sideEl = $('tac-panel-summary');
      if (!analysis || !analysis.ok) return;
      const sum = analysis.summary;
      const vt = analysis.vehicleTelemetry;
      const veh = analysis.vehicle;
      const tr = isTr();
      const modeLbl = getPlainModeLabel();
      const badgeCls = (!analysis.isLowResGrid && !inputs.useCoarseBaseline) ? 'tac-badge-ok' : 'tac-badge-warn';
      const badgeMode = `<span class="tac-badge ${badgeCls}" title="${escHtml(analysis.dataMode)}">${escHtml(modeLbl)}</span>`;

      const powerWarn = sum.powerDeficit
        ? `<div class="tac-power-alert">⚠ ${tr ? 'Araç bu koşullarda kendini besleyemiyor' : 'Vehicle cannot power itself under these conditions'}</div>`
        : '';

      const compareHtml = (lastNormalMean !== null && lastScenarioTag === 'worst')
        ? `<div class="tac-compare-badge">${tr ? `Normal: ${Math.round(lastNormalMean)} → En kötü gün: ${Math.round(sum.meanScore)}` : `Normal: ${Math.round(lastNormalMean)} → Worst-day: ${Math.round(sum.meanScore)}`}</div>`
        : '';

      const html =
        `<div class="tac-sum-head"><span>${tr ? '16 km² Uyumluluk Özeti' : '16 km² Compatibility Summary'}</span>${badgeMode}</div>` +
        powerWarn +
        compareHtml +
        `<div class="tac-sum-grid">` +
        `<div><small>Mean / Min / Max</small><b>${sum.meanScore} / ${sum.minScore} / ${sum.maxScore}</b></div>` +
        `<div><small>% ${tr ? 'Geçilmez' : 'Impassable'} (&gt;${veh.slopeLimitDeg.value}°)</small><b>${sum.impassablePct}%</b></div>` +
        `<div><small>${tr ? 'Ana sınırlayıcı faktör' : 'Main limiting factor'}</small><b>${escHtml(sum.limitingFactorLabel)} (${sum.limitingFactorMean})</b></div>` +
        `<div><small>${tr ? 'Güç ort · Üretim/İhtiyaç' : 'Power mean · Gen/Need'}</small><b>${Math.round(sum.domainMeans.power)} · ${Math.round(vt.dailyGenWh)}/${Math.round(vt.dailyNeedWh)} Wh</b></div>` +
        `</div>` +
        `<div class="tac-sum-note">${vt.powerNote} · ${vt.traverse4KmHours} h (4 km)${sum.nasaVetoPct > 0 ? ` · NASA HLS-2015 Veto: ${sum.nasaVetoPct}%` : ''}</div>`;

      if (el) el.innerHTML = html;
      if (sideEl) {
        sideEl.classList.remove('hidden');
        sideEl.innerHTML = html;
      }
    }

    function popupBadgeClass(badge) {
      if (String(badge).startsWith('MEASURED')) return 'tac-badge tac-badge-ok';
      if (badge === 'MODEL') return 'tac-badge tac-badge-model';
      return 'tac-badge tac-badge-warn';
    }

    function renderCellPopup(idx) {
      const el = $('tac-cell-popup');
      if (!el || !analysis || !analysis.ok) return;
      const tr = isTr();
      const p = engine.getCellPopup(analysis, idx, tr ? 'tr' : 'en');
      if (!p) return;

      const rowsHtml = p.domains.map((d) => {
        const lbl = tr ? (d.labelTr || d.label) : d.label;
        const scTxt = d.score == null ? (tr ? 'Bilgi' : 'Info') : `${d.score}/100`;
        let rawTxt = `${d.raw}${d.unit ? ' ' + d.unit : ''}`;
        if (d.key === 'thermal') rawTxt = `${p.ti} tiu, ${p.tempC} °C`;
        return `<div class="tac-popup-row"><span><b>${escHtml(lbl)}</b> — ${scTxt} · ${escHtml(rawTxt)}</span>` +
          `<span class="${popupBadgeClass(d.badge)}">${escHtml(d.badge)}</span></div>`;
      }).join('');

      const detailsHtml = p.domains.map((d) => {
        const lbl = tr ? (d.labelTr || d.label) : d.label;
        return `<div><b>${escHtml(lbl)}:</b> ${escHtml(d.source)}${d.date ? ' (' + escHtml(d.date) + ')' : ''}</div>`;
      }).join('');

      const vetoStr = p.vetoReasons.length
        ? `<div class="tac-popup-veto">VETO: ${escHtml(p.vetoReasons.join(' · '))}</div>`
        : '';

      const discStr = p.discrepancies && p.discrepancies.length
        ? `<div class="tac-popup-disc">⚠ ${tr ? 'Saha–yörünge farkı (>%50)' : 'Field–orbital difference (>50%)'}: ${escHtml(p.discrepancies.map((d) => (typeof d === 'string' ? d : `${d.type}`)).join(' · '))}</div>`
        : '';

      el.innerHTML =
        `<div class="tac-popup-hero">${tr ? 'İniş uyumluluğu' : 'Landing compatibility'}: ${p.finalScore}/100</div>` +
        `<div class="tac-popup-why">${escHtml(p.explanation)}</div>` +
        `<div class="tac-popup-head"><span>Cell (${p.row}, ${p.col}) · ${p.lat.toFixed(4)}°, ${fmtLonDisp(p.lon180, inputs.lonConvention)}</span><span>${p.elevM} m</span></div>` +
        vetoStr +
        discStr +
        `<div class="tac-popup-rows">${rowsHtml}</div>` +
        `<details class="tac-popup-det"><summary>${tr ? 'Detay (kaynak & tarih)' : 'Details (source & date)'}</summary>${detailsHtml}</details>`;
    }

    function formatHoverLayerValue(def, idx) {
      const g = analysis.grids;
      if (def.key === 'final') return `${g.final[idx].toFixed(1)}/100`;
      if (def.key === 'power') return `${g.power[idx].toFixed(0)}/100 (${Math.round(g.dailyGenWh[idx])}/${Math.round(g.dailyNeedWh[idx])} Wh)`;
      if (def.key === 'slope') return `${g.slopeDeg[idx].toFixed(1)}°`;
      if (def.key === 'elevation') return `${Math.round(g.elevM[idx])} m`;
      if (def.key === 'thermal') return `${Math.round(g.ti[idx])} tiu, ${g.tempC[idx].toFixed(1)} °C`;
      if (def.key === 'radiation') return `${g.gcrMSvYr[idx].toFixed(0)} mSv/yr`;
      if (def.key === 'confidence') return `${Math.round(g.confidence[idx])}%`;
      if (def.key === 'groundComp') return `K ${g.grsK[idx].toFixed(2)}%`;
      if (def.key === 'geology') return g.geolUnits[idx];
      if (def.key === 'dust') return `DCI ${g.dci[idx].toFixed(2)}`;
      if (def.key === 'topography') return `${Math.round(g.topography[idx])}/100 (Δ${g.reliefM[idx].toFixed(0)} m)`;
      return `${Math.round(g.optics[idx])}/100`;
    }

    function renderCanvasAndLegend() {
      ensureLoadedCtxImage();
      renderCanvasOnly();
      renderLegend();
    }

    function updateCornersAndLabels() {
      if (!analysis || !analysis.ok) return;
      const cn = analysis.location.corners;
      const conv = inputs.lonConvention;
      const setTxt = (id, pt) => {
        const e = $(id);
        if (e) e.textContent = `${pt.lat.toFixed(3)}°, ${fmtLonDisp(pt.lon180, conv)}`;
      };
      setTxt('tac-corner-nw', cn.nw);
      setTxt('tac-corner-ne', cn.ne);
      setTxt('tac-corner-se', cn.se);
      setTxt('tac-corner-sw', cn.sw);

      const tr = isTr();
      const resEl = $('tac-res-label');
      if (resEl) {
        const resNum = inputs.useCoarseBaseline || analysis.isLowResGrid ? '5 km' : '100–200 m';
        resEl.textContent = tr ? `Veri çözünürlüğü: ${resNum}` : `Data resolution: ${resNum}`;
        resEl.title = analysis.nativeResLabel || '';
      }

      const pill = $('tac-mode-pill');
      if (pill) {
        pill.textContent = getPlainModeLabel();
        const net = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : (inputs.onlineEnabled ? 'online-ready' : 'offline-bundle');
        pill.title = `${analysis.dataMode} · ${net}`;
      }

      const cmpBtn = $('tac-before-after-btn');
      if (cmpBtn) {
        cmpBtn.classList.toggle('hidden', !analysis.hasCoarseBaseline);
        cmpBtn.classList.toggle('active', !!inputs.useCoarseBaseline);
        cmpBtn.textContent = inputs.useCoarseBaseline
          ? (tr ? 'Önce: 5 km (Aktif) ↔ Sonra: 100–200 m' : 'Before: 5 km (Active) ↔ After: 100–200 m')
          : (tr ? 'Önce: 5 km ↔ Sonra: 100–200 m' : 'Before: 5 km ↔ After: 100–200 m');
      }

      const lineEl = $('tac-scale-line');
      const box = $('tac-map-box');
      if (lineEl && box) {
        const w = box.clientWidth || 320;
        lineEl.style.width = `${Math.round(w * 0.25)}px`;
      }
    }

    function syncSquareViewportSize() {
      const wrap = doc.querySelector('.map-wrap');
      const box = $('tac-map-box');
      if (!wrap || !box) return;
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const narrow = global.innerWidth <= 680;
      const target = narrow
        ? Math.max(180, Math.min(340, Math.round(rect.width * 0.86)))
        : Math.max(240, Math.min(620, Math.round(Math.min(rect.width * 0.70, rect.height * 0.72))));
      box.style.width = `${target}px`;
      box.style.height = `${target}px`;
      const lineEl = $('tac-scale-line');
      if (lineEl) lineEl.style.width = `${Math.round(target * 0.25)}px`;
    }

    function syncEnvInputsToDom() {
      if ($('tac-date')) $('tac-date').value = inputs.earthDateUtc;
      if ($('tac-ltst')) $('tac-ltst').value = String(inputs.ltstHours);
      if ($('tac-ltst-v')) $('tac-ltst-v').textContent = `${Number(inputs.ltstHours).toFixed(2)} h LTST`;
      if ($('tac-tau')) $('tac-tau').value = String(inputs.tau);
      if ($('tac-tau-v')) $('tac-tau-v').textContent = `τ ${Number(inputs.tau).toFixed(1)}`;
      doc.querySelectorAll('#tac-tau-presets button').forEach((b) => {
        const hit = Math.abs(Number(b.dataset.tau) - Number(inputs.tau)) < 0.05;
        b.classList.toggle('active', hit);
        b.setAttribute('aria-pressed', String(hit));
      });
      doc.querySelectorAll('#tac-solar-cycle button').forEach((b) => {
        const on = b.dataset.cycle === inputs.solarCycle;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      if ($('tac-spe-toggle')) $('tac-spe-toggle').checked = !!inputs.speActive;
      updateMarsClockReadout();
    }

    function computeBaselineNormalMean() {
      const normalInputs = {
        ...inputs,
        tau: 0.5,
        solarCycle: 'mid',
        speActive: false,
        ltstHours: 12,
        earthDateUtc: engine.getUtcTodayIso(),
      };
      const baseRes = engine.generateAnalysis({
        inputs: normalInputs,
        cutouts,
        layers,
        vehiclesCfg,
        tacticalCfg,
        marsTime,
        scoring,
        storm,
        fieldMeasurements,
        fieldRadiusM: inputs.fieldRadiusM,
      });
      return baseRes && baseRes.ok ? baseRes.summary.meanScore : null;
    }

    function renderFieldList() {
      const box = $('tac-fd-list');
      if (!box) return;
      const tr = isTr();
      if (!fieldMeasurements.length) {
        box.innerHTML = `<div class="help">${tr ? 'Henüz eklenen saha ölçümü yok.' : 'No field measurements added yet.'}</div>`;
        return;
      }
      box.innerHTML = fieldMeasurements.map((m, idx) => {
        const spec = engine.FIELD_MEASUREMENT_SPECS[m.type] || { unit: '' };
        const simTag = m.simulated ? `<span class="tac-badge tac-badge-warn">${tr ? 'SİMÜLE' : 'SIMULATED'}</span>` : `<span class="tac-badge tac-badge-ok">${tr ? 'ÖLÇÜLDÜ' : 'MEASURED'}</span>`;
        const valDisp = (m.type === 'soilType' || m.type === 'hazard') ? String(m.value) : `${m.value} ${spec.unit || m.unit || ''}`;
        return `<div class="tac-fd-item"><div><b>${escHtml(m.type)}</b>: ${escHtml(valDisp)} ${simTag}` +
          `<div class="tac-fd-item-meta">${Number(m.lat).toFixed(4)}°, ${Number(m.lon).toFixed(4)}° · ${escHtml(m.source || 'manual')}${m.date ? ' · ' + escHtml(m.date) : ''}${m.note ? ' · ' + escHtml(m.note) : ''}</div></div>` +
          `<div class="tac-fd-item-acts"><button type="button" class="ghost" data-fedit="${idx}">${tr ? 'Düzenle' : 'Edit'}</button>` +
          `<button type="button" class="ghost" data-fdel="${idx}">${tr ? 'Sil' : 'Del'}</button></div></div>`;
      }).join('');

      box.querySelectorAll('[data-fedit]').forEach((b) => {
        b.onclick = () => {
          const i = Number(b.dataset.fedit);
          const m = fieldMeasurements[i];
          if (!m) return;
          editingFieldId = i;
          if ($('tac-fd-lat')) $('tac-fd-lat').value = String(m.lat);
          if ($('tac-fd-lon')) $('tac-fd-lon').value = String(m.lon);
          if ($('tac-fd-type')) $('tac-fd-type').value = m.type;
          syncFieldTypeUi();
          if (m.type === 'soilType' && $('tac-fd-soil-val')) $('tac-fd-soil-val').value = String(m.value);
          else if (m.type === 'hazard' && $('tac-fd-hazard-val')) $('tac-fd-hazard-val').value = String(m.value);
          else if ($('tac-fd-val')) $('tac-fd-val').value = String(m.value);
          if ($('tac-fd-date')) $('tac-fd-date').value = m.date || '';
          if ($('tac-fd-source')) $('tac-fd-source').value = m.source || '';
          if ($('tac-fd-note')) $('tac-fd-note').value = m.note || '';
          if ($('tac-fd-add-btn')) $('tac-fd-add-btn').textContent = tr ? 'Kaydet' : 'Save';
          if ($('tac-fd-cancel-btn')) $('tac-fd-cancel-btn').classList.remove('hidden');
        };
      });

      box.querySelectorAll('[data-fdel]').forEach((b) => {
        b.onclick = () => {
          const i = Number(b.dataset.fdel);
          fieldMeasurements.splice(i, 1);
          if (editingFieldId === i) editingFieldId = null;
          saveFieldData();
          renderFieldList();
          runAnalysis(true);
        };
      });
    }

    function syncFieldTypeUi() {
      const sel = $('tac-fd-type');
      const type = sel ? sel.value : 'ti';
      const spec = engine.FIELD_MEASUREMENT_SPECS[type] || { unit: '' };
      if ($('tac-fd-unit')) $('tac-fd-unit').textContent = spec.unit || '—';
      if ($('tac-fd-num-wrap')) $('tac-fd-num-wrap').classList.toggle('hidden', type === 'soilType' || type === 'hazard');
      if ($('tac-fd-soil-wrap')) $('tac-fd-soil-wrap').classList.toggle('hidden', type !== 'soilType');
      if ($('tac-fd-hazard-wrap')) $('tac-fd-hazard-wrap').classList.toggle('hidden', type !== 'hazard');
    }

    function parseBulkRows(text, isJson) {
      let rows = [];
      let skipped = 0;
      if (isJson) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
        rows = parsed;
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) return { valid: [], skipped: lines.length };
        const hdr = lines[0].split(',').map((h) => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map((c) => c.trim());
          if (parts.length < 4) { skipped++; continue; }
          const obj = {};
          hdr.forEach((h, idx) => { obj[h] = parts[idx] ?? ''; });
          rows.push(obj);
        }
      }
      const valid = [];
      for (const r of rows) {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        const type = String(r.type || '').trim();
        const spec = engine.FIELD_MEASUREMENT_SPECS[type];
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || !spec) {
          skipped++;
          continue;
        }
        let value = r.value;
        if (type !== 'soilType' && type !== 'hazard') {
          value = Number(value);
          if (!Number.isFinite(value)) { skipped++; continue; }
        } else if (!value) {
          skipped++;
          continue;
        }
        valid.push({
          lat,
          lon,
          type,
          value,
          unit: String(r.unit || spec.unit || ''),
          date: String(r.date || ''),
          source: String(r.source || 'upload'),
          note: String(r.note || ''),
          simulated: !!r.simulated,
        });
      }
      return { valid, skipped };
    }

    function renderPerseveranceBenchmark() {
      const box = $('tac-benchmark-box');
      if (!box) return;
      const tr = isTr();
      const perc = engine.generateAnalysis({
        inputs: {
          ...engine.getDefaultInputs(vehiclesCfg, tacticalCfg),
          presetZoneId: 'jezero_delta',
          lat: 18.44,
          lonInput: 77.45,
          lonConvention: '-180_180',
          earthDateUtc: '2021-02-18',
          ltstHours: 14.0,
          tau: 0.6,
          solarCycle: 'min',
          speActive: false,
          vehicleClass: 'lab_rover',
        },
        cutouts,
        layers,
        vehiclesCfg,
        tacticalCfg,
        marsTime,
        scoring,
        storm,
      });
      const gale = engine.generateAnalysis({
        inputs: {
          ...engine.getDefaultInputs(vehiclesCfg, tacticalCfg),
          presetZoneId: 'gale_boxwork',
          lat: -5.08,
          lonInput: 137.85,
          lonConvention: '-180_180',
          earthDateUtc: '2021-02-18',
          ltstHours: 14.0,
          tau: 0.6,
          solarCycle: 'min',
          speActive: false,
          vehicleClass: 'lab_rover',
        },
        cutouts,
        layers,
        vehiclesCfg,
        tacticalCfg,
        marsTime,
        scoring,
        storm,
      });
      if (!perc.ok || !gale.ok) return;

      const cb = perc.centerBase;
      const mt = perc.environment;
      const tiMean = Math.round(perc.grids.ti.reduce((a, b) => a + b, 0) / perc.grids.ti.length);
      const jezeroGcr = Math.round(cb.gcrMSvYr);
      const galeGcr = Math.round(gale.centerBase.gcrMSvYr);

      const checks = [
        {
          name: 'Ls (2021-02-18)',
          model: `${mt.lsDeg.toFixed(1)}°`,
          ref: '≈ 5° (Harri et al. 2024)',
          ok: Math.abs(mt.lsDeg - 5) <= 2,
        },
        {
          name: tr ? 'Basınç' : 'Pressure',
          model: `${cb.pressurePa} Pa`,
          ref: '718 Pa (MEDA; 705–735 Pa)',
          ok: cb.pressurePa >= 705 && cb.pressurePa <= 735,
        },
        {
          name: tr ? 'Yüzey/Hava sıcaklığı' : 'Temp min / max',
          model: `${cb.nightTempC.toFixed(1)} °C … ${cb.dayTempC.toFixed(1)} °C`,
          ref: '−83 °C … −22 °C (MEDA sol 43–44)',
          ok: cb.nightTempC >= -92 && cb.nightTempC <= -75 && cb.dayTempC >= -32 && cb.dayTempC <= -12,
        },
        {
          name: tr ? 'Termal atalet' : 'Thermal inertia',
          model: `${tiMean} tiu`,
          ref: 'MEDA 180–605 / THEMIS 200–400',
          ok: tiMean >= 180 && tiMean <= 605,
        },
        {
          name: tr ? 'GCR Radyasyon' : 'GCR Radiation',
          model: `Jezero ${jezeroGcr} vs Gale ${galeGcr} mSv/yr`,
          ref: tr ? 'Jezero tabanı (−2.5 km) vs Gale Boxwork (+17 m)' : 'Jezero floor (−2.5 km) vs Gale Boxwork (+17 m)',
          ok: jezeroGcr > galeGcr,
        },
      ];

      box.innerHTML =
        `<b>${tr ? 'Doğrulama: Perseverance iniş yeri (18.44°N, 77.45°E, 2021-02-18)' : 'Benchmark: Perseverance landing site (18.44°N, 77.45°E, 2021-02-18)'}</b>` +
        `<table class="tbl mt-sm"><thead><tr><th>${tr ? 'Ölçüt' : 'Metric'}</th><th>${tr ? 'Uygulama Çıktısı' : 'Model Output'}</th><th>${tr ? 'Referans Ölçüm' : 'Mission Reference'}</th><th>${tr ? 'Durum' : 'Check'}</th></tr></thead><tbody>` +
        checks.map((c) => `<tr><td>${escHtml(c.name)}</td><td><code>${escHtml(c.model)}</code></td><td>${escHtml(c.ref)}</td><td>${c.ok ? '<span class="tac-badge tac-badge-ok">✓</span>' : '<span class="tac-badge tac-badge-warn">⚠</span>'}</td></tr>`).join('') +
        `</tbody></table>`;
    }

    async function runAnalysis(skipOnlineFetch) {
      updateMarsClockReadout();
      updateRegionReadout();

      const loc = engine.validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
      if (!loc.valid) return;

      if (!skipOnlineFetch) {
        mapClosed = false;
        const ws = $('tac-workspace');
        if (ws && S.mode === 'eva') ws.classList.remove('hidden');
      }

      const btn = $('tac-generate-btn');
      const preset = engine.findPresetCutout(cutouts, loc.latDeg, loc.lon180);
      let onlineGrid = null;
      const canGoOnline = !skipOnlineFetch && !preset && inputs.onlineEnabled && (typeof navigator === 'undefined' || navigator.onLine !== false);
      if (canGoOnline) {
        if (btn) { btn.disabled = true; btn.textContent = isTr() ? 'Çevrimiçi veri alınıyor…' : 'Fetching orbital data…'; }
        const stPill = $('tac-mode-pill');
        if (stPill) stPill.textContent = isTr() ? 'Çevrimiçi veri…' : 'Fetching online…';
        try {
          onlineGrid = await fetchOnlineOrbitalGrid(loc, layers, tacticalCfg, engine, cutouts);
        } catch (_) {
          onlineGrid = null;
        }
        if (btn) { btn.disabled = false; btn.textContent = isTr() ? 'Analizi Oluştur' : 'Generate 16 km² analysis'; }
      }

      const res = engine.generateAnalysis({
        inputs: { ...inputs },
        onlineGrid,
        cutouts,
        layers,
        vehiclesCfg,
        tacticalCfg,
        marsTime,
        scoring,
        storm,
        fieldMeasurements,
        fieldRadiusM: inputs.fieldRadiusM,
      });
      if (!res.ok) return;

      let eMin = Infinity, eMax = -Infinity;
      for (let i = 0; i < res.grids.elevM.length; i++) {
        if (res.grids.elevM[i] < eMin) eMin = res.grids.elevM[i];
        if (res.grids.elevM[i] > eMax) eMax = res.grids.elevM[i];
      }
      res._elevMin = eMin;
      res._elevMax = eMax;
      analysis = res;
      S.tacticalAnalysis = res;
      if (selectedCellIdx === null) selectedCellIdx = Math.floor(res.gridN / 2) * res.gridN + Math.floor(res.gridN / 2);

      syncSquareViewportSize();
      updateCornersAndLabels();
      renderCanvasAndLegend();
      renderSummary();
      renderCellPopup(selectedCellIdx);
    }

    function bindEvents() {
      const presetSel = $('tac-preset-zone');
      if (presetSel) {
        presetSel.onchange = () => {
          const id = presetSel.value;
          inputs.presetZoneId = id;
          if (cutouts && cutouts.zones && cutouts.zones[id]) {
            const z = cutouts.zones[id];
            inputs.lat = z.lat;
            inputs.lonInput = engine.formatLonForConvention(z.lon, inputs.lonConvention);
            if ($('tac-lat')) $('tac-lat').value = String(inputs.lat);
            if ($('tac-lon')) $('tac-lon').value = String(inputs.lonInput);
            updateRegionReadout();
            updateMarsClockReadout();
          }
        };
      }

      const latEl = $('tac-lat');
      if (latEl) {
        latEl.value = String(inputs.lat);
        latEl.oninput = () => {
          inputs.lat = latEl.value;
          inputs.presetZoneId = 'custom';
          if (presetSel) presetSel.value = 'custom';
          updateRegionReadout();
        };
      }

      const lonEl = $('tac-lon');
      const convEl = $('tac-lon-conv');
      if (lonEl) {
        lonEl.value = String(inputs.lonInput);
        lonEl.oninput = () => {
          inputs.lonInput = lonEl.value;
          inputs.presetZoneId = 'custom';
          if (presetSel) presetSel.value = 'custom';
          updateRegionReadout();
          updateMarsClockReadout();
        };
      }
      if (convEl) {
        convEl.value = inputs.lonConvention;
        convEl.onchange = () => {
          const prevConv = inputs.lonConvention;
          const nextConv = convEl.value === '0_360' ? '0_360' : '-180_180';
          const num = Number(inputs.lonInput);
          inputs.lonConvention = nextConv;
          if (Number.isFinite(num) && prevConv !== nextConv) {
            inputs.lonInput = engine.formatLonForConvention(num, nextConv);
            if (lonEl) lonEl.value = String(inputs.lonInput);
          }
          updateRegionReadout();
          updateMarsClockReadout();
          if (analysis) { updateCornersAndLabels(); renderCellPopup(selectedCellIdx); }
        };
      }

      const dEl = $('tac-date');
      if (dEl) {
        dEl.value = inputs.earthDateUtc;
        dEl.onchange = () => { inputs.earthDateUtc = dEl.value; lastScenarioTag = null; updateMarsClockReadout(); };
      }

      const ltstEl = $('tac-ltst');
      const ltstV = $('tac-ltst-v');
      if (ltstEl) {
        ltstEl.value = String(inputs.ltstHours);
        if (ltstV) ltstV.textContent = `${Number(inputs.ltstHours).toFixed(2)} h LTST`;
        ltstEl.oninput = () => {
          inputs.ltstHours = Number(ltstEl.value);
          lastScenarioTag = null;
          if (ltstV) ltstV.textContent = `${inputs.ltstHours.toFixed(2)} h LTST`;
        };
      }

      const tauEl = $('tac-tau');
      const tauV = $('tac-tau-v');
      const updateTauButtons = () => {
        doc.querySelectorAll('#tac-tau-presets button').forEach((b) => {
          const hit = Math.abs(Number(b.dataset.tau) - Number(inputs.tau)) < 0.05;
          b.classList.toggle('active', hit);
          b.setAttribute('aria-pressed', String(hit));
        });
      };
      if (tauEl) {
        tauEl.value = String(inputs.tau);
        if (tauV) tauV.textContent = `τ ${Number(inputs.tau).toFixed(1)}`;
        tauEl.oninput = () => {
          inputs.tau = Number(tauEl.value);
          lastScenarioTag = null;
          if (tauV) tauV.textContent = `τ ${inputs.tau.toFixed(1)}`;
          updateTauButtons();
        };
      }
      doc.querySelectorAll('#tac-tau-presets button').forEach((b) => {
        b.onclick = () => {
          inputs.tau = Number(b.dataset.tau);
          lastScenarioTag = null;
          if (tauEl) tauEl.value = String(inputs.tau);
          if (tauV) tauV.textContent = `τ ${inputs.tau.toFixed(1)}`;
          updateTauButtons();
        };
      });
      updateTauButtons();

      doc.querySelectorAll('#tac-solar-cycle button').forEach((b) => {
        b.onclick = () => {
          inputs.solarCycle = b.dataset.cycle;
          lastScenarioTag = null;
          doc.querySelectorAll('#tac-solar-cycle button').forEach((x) => {
            const on = x === b;
            x.classList.toggle('active', on);
            x.setAttribute('aria-pressed', String(on));
          });
        };
      });

      const speEl = $('tac-spe-toggle');
      if (speEl) {
        speEl.checked = !!inputs.speActive;
        speEl.onchange = () => { inputs.speActive = speEl.checked; lastScenarioTag = null; };
      }

      const worstBtn = $('tac-worst-day-btn');
      if (worstBtn) {
        worstBtn.onclick = () => {
          lastNormalMean = computeBaselineNormalMean();
          const loc = engine.validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
          const latDeg = loc.valid ? loc.latDeg : 18.38;
          const lon360 = loc.valid ? loc.lon360 : 77.58;
          const elevM = analysis ? analysis.centerBase.elevM : -2500;
          const cold = engine.findColdestEarthDateForLat(latDeg, lon360, elevM, marsTime, storm, engine.getUtcTodayIso());
          inputs.tau = 10.8;
          inputs.solarCycle = 'max';
          inputs.speActive = true;
          inputs.ltstHours = 3.0;
          inputs.earthDateUtc = cold.earthDateUtc;
          lastScenarioTag = 'worst';
          syncEnvInputsToDom();
          runAnalysis(false);
        };
      }

      const normBtn = $('tac-normal-day-btn');
      if (normBtn) {
        normBtn.onclick = () => {
          inputs.tau = 0.5;
          inputs.solarCycle = 'mid';
          inputs.speActive = false;
          inputs.ltstHours = 12.0;
          inputs.earthDateUtc = engine.getUtcTodayIso();
          lastScenarioTag = 'normal';
          syncEnvInputsToDom();
          runAnalysis(false);
        };
      }

      const clsSel = $('tac-veh-class');
      if (clsSel) {
        clsSel.value = inputs.vehicleClass;
        clsSel.onchange = () => {
          inputs.vehicleClass = clsSel.value;
          syncVehiclePanel(true);
        };
      }
      const spEl = $('tac-veh-speed');
      if (spEl) spEl.oninput = () => { inputs.speedKmh = Number(spEl.value); syncVehiclePanel(false); };
      const ldEl = $('tac-veh-load');
      if (ldEl) ldEl.oninput = () => { inputs.extraLoadKg = Number(ldEl.value); syncVehiclePanel(false); };
      const pwSel = $('tac-veh-power-mode');
      if (pwSel) pwSel.onchange = () => { inputs.powerMode = pwSel.value; syncVehiclePanel(false); };

      // Section D Field Data bindings
      const fdType = $('tac-fd-type');
      if (fdType) {
        syncFieldTypeUi();
        fdType.onchange = syncFieldTypeUi;
      }

      const fdAdd = $('tac-fd-add-btn');
      if (fdAdd) {
        fdAdd.onclick = () => {
          const type = fdType ? fdType.value : 'ti';
          const spec = engine.FIELD_MEASUREMENT_SPECS[type] || { unit: '' };
          const lat = Number($('tac-fd-lat') && $('tac-fd-lat').value);
          const lon = Number($('tac-fd-lon') && $('tac-fd-lon').value);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          let value;
          if (type === 'soilType') value = $('tac-fd-soil-val') ? $('tac-fd-soil-val').value : 'firm_regolith';
          else if (type === 'hazard') value = $('tac-fd-hazard-val') ? $('tac-fd-hazard-val').value : 'rock';
          else {
            value = Number($('tac-fd-val') && $('tac-fd-val').value);
            if (!Number.isFinite(value)) return;
          }
          const rec = {
            lat, lon, type, value,
            unit: spec.unit || '',
            date: $('tac-fd-date') ? $('tac-fd-date').value.trim() : '',
            source: ($('tac-fd-source') ? $('tac-fd-source').value.trim() : '') || 'field measurement',
            note: $('tac-fd-note') ? $('tac-fd-note').value.trim() : '',
            simulated: false,
          };
          if (editingFieldId !== null && fieldMeasurements[editingFieldId]) {
            fieldMeasurements[editingFieldId] = rec;
            editingFieldId = null;
            fdAdd.textContent = isTr() ? '+ Ölçüm Ekle' : '+ Add measurement';
            if ($('tac-fd-cancel-btn')) $('tac-fd-cancel-btn').classList.add('hidden');
          } else {
            fieldMeasurements.push(rec);
          }
          saveFieldData();
          renderFieldList();
          runAnalysis(true);
        };
      }

      const fdCancel = $('tac-fd-cancel-btn');
      if (fdCancel) {
        fdCancel.onclick = () => {
          editingFieldId = null;
          if (fdAdd) fdAdd.textContent = isTr() ? '+ Ölçüm Ekle' : '+ Add measurement';
          fdCancel.classList.add('hidden');
        };
      }

      const fdSample = $('tac-fd-sample-btn');
      if (fdSample) {
        fdSample.onclick = () => {
          fieldMeasurements = [
            { lat: 18.382, lon: 77.584, type: 'ti', value: 190, unit: 'tiu', date: 'Sol 45', source: 'MEDA (SIMULATED)', note: 'Soft ripple patch', simulated: true },
            { lat: 18.374, lon: 77.576, type: 'slopeDeg', value: 14.5, unit: '°', date: 'Sol 46', source: 'Navcam stereo (SIMULATED)', note: 'Delta scarp face', simulated: true },
            { lat: 18.388, lon: 77.590, type: 'radiationUSvHr', value: 26.2, unit: 'µSv/hr', date: 'Sol 46', source: 'RAD (SIMULATED)', note: 'Local sky exposure', simulated: true },
            { lat: 18.377, lon: 77.587, type: 'hazard', value: 'soft_sand', unit: '', date: 'Sol 47', source: 'Rover tracks (SIMULATED)', note: 'High slip hazard', simulated: true },
          ];
          saveFieldData();
          renderFieldList();
          runAnalysis(true);
        };
      }

      const fdTmpl = $('tac-fd-template-btn');
      if (fdTmpl) {
        fdTmpl.onclick = () => {
          const csv = 'lat,lon,type,value,unit,date,source,note\n18.382,77.584,ti,315,tiu,Sol 45,MEDA,Sample thermal reading\n';
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = 'mars-field-template.csv';
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
      }

      const fdUp = $('tac-fd-upload-input');
      if (fdUp) {
        fdUp.onchange = () => {
          const file = fdUp.files && fdUp.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const isJson = file.name.toLowerCase().endsWith('.json') || String(reader.result).trim().startsWith('[');
              const { valid, skipped } = parseBulkRows(String(reader.result || ''), isJson);
              fieldMeasurements.push(...valid);
              saveFieldData();
              renderFieldList();
              const msgEl = $('tac-fd-import-msg');
              if (msgEl) {
                msgEl.classList.remove('hidden');
                msgEl.textContent = isTr()
                  ? `${valid.length} ölçüm eklendi, ${skipped} hatalı satır atlandı.`
                  : `Loaded ${valid.length} measurements, skipped ${skipped} invalid rows.`;
              }
              if (valid.length) runAnalysis(true);
            } catch (_) {
              const msgEl = $('tac-fd-import-msg');
              if (msgEl) {
                msgEl.classList.remove('hidden');
                msgEl.textContent = isTr() ? 'Dosya biçimi okunamadı.' : 'Failed to parse file.';
              }
            }
          };
          reader.readAsText(file);
        };
      }

      const fdExp = $('tac-fd-export-btn');
      if (fdExp) {
        fdExp.onclick = () => {
          const blob = new Blob([JSON.stringify(fieldMeasurements, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = 'mars-field-measurements.json';
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
      }

      const fdClear = $('tac-fd-clear-btn');
      if (fdClear) {
        fdClear.onclick = () => {
          fieldMeasurements = [];
          editingFieldId = null;
          saveFieldData();
          renderFieldList();
          runAnalysis(true);
        };
      }

      const radEl = $('tac-field-radius');
      const radV = $('tac-field-radius-v');
      if (radEl) {
        radEl.value = String(inputs.fieldRadiusM || 300);
        if (radV) radV.textContent = `${radEl.value} m`;
        radEl.oninput = () => {
          inputs.fieldRadiusM = Number(radEl.value);
          if (radV) radV.textContent = `${inputs.fieldRadiusM} m`;
          if (analysis && fieldMeasurements.length) runAnalysis(true);
        };
      }

      const blendEl = $('tac-blend');
      const blendV = $('tac-blend-v');
      if (blendEl) {
        blendEl.value = String(Math.round(inputs.orbitalBlendWeight * 100));
        if (blendV) blendV.textContent = `${100 - Math.round(inputs.orbitalBlendWeight * 100)}% User ↔ ${Math.round(inputs.orbitalBlendWeight * 100)}% Orbital`;
        blendEl.oninput = () => {
          inputs.orbitalBlendWeight = Number(blendEl.value) / 100;
          const pct = Math.round(inputs.orbitalBlendWeight * 100);
          if (blendV) blendV.textContent = `${100 - pct}% User ↔ ${pct}% Orbital`;
          if (analysis) runAnalysis(true);
        };
      }

      doc.querySelectorAll('#tac-agg-mode button').forEach((b) => {
        b.onclick = () => {
          inputs.scoreMode = b.dataset.agg;
          doc.querySelectorAll('#tac-agg-mode button').forEach((x) => {
            const on = x === b;
            x.classList.toggle('active', on);
            x.setAttribute('aria-pressed', String(on));
          });
          if (analysis) runAnalysis(true);
        };
      });

      const onTog = $('tac-online-toggle');
      if (onTog) {
        onTog.checked = !!inputs.onlineEnabled;
        onTog.onchange = () => {
          inputs.onlineEnabled = onTog.checked;
          updateCornersAndLabels();
        };
      }

      const genBtn = $('tac-generate-btn');
      if (genBtn) genBtn.onclick = () => runAnalysis(false);

      const cmpBtn = $('tac-before-after-btn');
      if (cmpBtn) {
        cmpBtn.onclick = () => {
          inputs.useCoarseBaseline = !inputs.useCoarseBaseline;
          runAnalysis(true);
        };
      }

      const exJson = $('tac-export-json');
      if (exJson) exJson.onclick = () => {
        if (!analysis) { if (onToast) onToast('Generate an analysis first.'); return; }
        const json = engine.exportAnalysisJSON(analysis);
        if (brief && typeof brief.downloadBriefJSON === 'function') brief.downloadBriefJSON(json);
      };
      const exGeo = $('tac-export-geojson');
      if (exGeo) exGeo.onclick = () => {
        if (!analysis) { if (onToast) onToast('Generate an analysis first.'); return; }
        const geo = engine.exportAnalysisGeoJSON(analysis);
        const blob = new Blob([JSON.stringify(geo, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = 'mars-tactical-eva-16km2.geojson';
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      const cvs = $('tac-canvas');
      if (cvs) {
        cvs.onclick = (e) => {
          if (!analysis || !analysis.ok) return;
          const r = cvs.getBoundingClientRect();
          const gx = clamp(Math.floor(((e.clientX - r.left) / r.width) * analysis.gridN), 0, analysis.gridN - 1);
          const gy = clamp(Math.floor(((e.clientY - r.top) / r.height) * analysis.gridN), 0, analysis.gridN - 1);
          selectedCellIdx = gy * analysis.gridN + gx;
          const bb = analysis.location.bbox180;
          const cellLat = bb[3] - ((gy + 0.5) / analysis.gridN) * (bb[3] - bb[1]);
          const cellLon = engine.normalizeLon180(bb[0] + ((gx + 0.5) / analysis.gridN) * (bb[2] - bb[0]));
          if ($('tac-fd-lat')) $('tac-fd-lat').value = cellLat.toFixed(4);
          if ($('tac-fd-lon')) $('tac-fd-lon').value = cellLon.toFixed(4);
          renderCanvasOnly();
          renderCellPopup(selectedCellIdx);
        };
        cvs.onmousemove = (e) => {
          const tip = $('tac-hover-tip');
          if (!tip || !analysis || !analysis.ok) return;
          const r = cvs.getBoundingClientRect();
          const gx = clamp(Math.floor(((e.clientX - r.left) / r.width) * analysis.gridN), 0, analysis.gridN - 1);
          const gy = clamp(Math.floor(((e.clientY - r.top) / r.height) * analysis.gridN), 0, analysis.gridN - 1);
          const idx = gy * analysis.gridN + gx;
          const topDef = getTopVisibleLayerDef() || LAYER_DEFS[1];
          const topName = isTr() ? topDef.labelTr : topDef.label;
          tip.textContent = `${analysis.grids.final[idx].toFixed(1)}/100 · ${topName}: ${formatHoverLayerValue(topDef, idx)}`;
          tip.classList.remove('hidden');
          tip.style.left = `${clamp(Math.round(e.clientX - r.left + 10), 4, Math.max(4, Math.round(r.width - 170)))}px`;
          tip.style.top = `${clamp(Math.round(e.clientY - r.top - 24), 4, Math.max(4, Math.round(r.height - 26)))}px`;
        };
        cvs.onmouseleave = () => {
          const tip = $('tac-hover-tip');
          if (tip) tip.classList.add('hidden');
        };
      }

      const closeBtn = $('tac-close-map-btn');
      if (closeBtn) {
        closeBtn.onclick = () => {
          mapClosed = true;
          const ws = $('tac-workspace');
          if (ws) ws.classList.add('hidden');
        };
      }

      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && S.mode === 'eva') {
          const ws = $('tac-workspace');
          if (ws && !ws.classList.contains('hidden')) {
            mapClosed = true;
            ws.classList.add('hidden');
          }
        }
      });

      const wrap = doc.querySelector('.map-wrap');
      if (wrap && typeof ResizeObserver === 'function') {
        resizeObs = new ResizeObserver(() => syncSquareViewportSize());
        resizeObs.observe(wrap);
      } else {
        global.addEventListener('resize', syncSquareViewportSize);
      }
    }

    function setCenterFromCoords(lat, lon180) {
      inputs.lat = +Number(lat).toFixed(4);
      inputs.lonInput = engine.formatLonForConvention(lon180, inputs.lonConvention);
      const preset = engine.findPresetCutout(cutouts, inputs.lat, lon180);
      inputs.presetZoneId = preset ? preset.id : 'custom';
      inputs.useCoarseBaseline = false;
      mapClosed = false;
      if ($('tac-preset-zone')) $('tac-preset-zone').value = inputs.presetZoneId;
      if ($('tac-lat')) $('tac-lat').value = String(inputs.lat);
      if ($('tac-lon')) $('tac-lon').value = String(inputs.lonInput);
      updateRegionReadout();
      updateMarsClockReadout();
    }

    function onModeChange(mode) {
      const ws = $('tac-workspace');
      if (!ws) return;
      const show = mode === 'eva' && !mapClosed;
      ws.classList.toggle('hidden', !show);
      if (mode === 'eva' && !mapClosed) {
        syncSquareViewportSize();
        if (!analysis) runAnalysis(true);
      }
    }

    function init() {
      buildLayerControls();
      buildWeightSliders();
      syncVehiclePanel(false);
      renderFieldList();
      bindEvents();
      syncEnvInputsToDom();
      updateRegionReadout();
      renderPerseveranceBenchmark();
      // Pre-compute initial default 16 km2 grid synchronously using offline cutout so state is immediate
      const initRes = engine.generateAnalysis({
        inputs: { ...inputs },
        cutouts,
        layers,
        vehiclesCfg,
        tacticalCfg,
        marsTime,
        scoring,
        storm,
        fieldMeasurements,
        fieldRadiusM: inputs.fieldRadiusM,
      });
      if (initRes && initRes.ok) {
        let eMin = Infinity, eMax = -Infinity;
        for (let i = 0; i < initRes.grids.elevM.length; i++) {
          if (initRes.grids.elevM[i] < eMin) eMin = initRes.grids.elevM[i];
          if (initRes.grids.elevM[i] > eMax) eMax = initRes.grids.elevM[i];
        }
        initRes._elevMin = eMin;
        initRes._elevMax = eMax;
        analysis = initRes;
        S.tacticalAnalysis = initRes;
        selectedCellIdx = Math.floor(initRes.gridN / 2) * initRes.gridN + Math.floor(initRes.gridN / 2);
        updateCornersAndLabels();
        renderCanvasAndLegend();
        renderSummary();
        renderCellPopup(selectedCellIdx);
      }
    }

    return {
      init,
      runAnalysis,
      setCenterFromCoords,
      onModeChange,
      syncSquareViewportSize,
      onLangChange: () => {
        buildLayerControls();
        buildWeightSliders();
        syncVehiclePanel(false);
        renderFieldList();
        updateRegionReadout();
        updateCornersAndLabels();
        renderLegend();
        renderSummary();
        renderCellPopup(selectedCellIdx);
        renderPerseveranceBenchmark();
      },
      getAnalysis: () => analysis,
    };
  }

  let _singleton = null;
  global.MDE_TACTICAL_EVA = {
    LAYER_DEFS,
    createController(ctx) {
      _singleton = createTacticalEvaController(ctx);
      _singleton.init();
      return _singleton;
    },
    onGlobalSelect(lat, lon180) {
      if (_singleton) _singleton.setCenterFromCoords(lat, lon180);
    },
    onModeChange(mode) {
      if (_singleton) _singleton.onModeChange(mode);
    },
    onLangChange() {
      if (_singleton) _singleton.onLangChange();
    },
    getInstance() {
      return _singleton;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
