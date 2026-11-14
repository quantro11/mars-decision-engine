// UI controller, ONLINE-ONLY orbital fetcher, and 16 km2 square canvas visualizer for Tactical EVA.
// Reuses MDE_TACTICAL_EVA_ENGINE, MDE_MARS_TIME, STORM, SCORING, and MDE_BRIEF.
(function (global) {
  'use strict';

  const LAYER_DEFS = [
    { key: 'optics',          label: 'Optics (imagery)',         labelTr: 'Optik (görüntü)',          unit: 'CTX / 0–100', defOn: true,  defOp: 90, lowRes: false, stops: ['#181c24', '#6d7888', '#d8dee8'] },
    { key: 'final',           label: 'Final landing score',      labelTr: 'Nihai iniş skoru',         unit: '0–100',       defOn: true,  defOp: 65, lowRes: false, stops: ['#9d2820', '#d88a2e', '#2ea35a'] },
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

    let analysis = null;
    let selectedCellIdx = null;
    let mapExpanded = false;
    let loadedCtxUrl = null;
    let loadedCtxImg = null;
    let resizeObs = null;

    function isTr() {
      return !!(global.MDE_I18N && typeof global.MDE_I18N.isTr === 'function' && global.MDE_I18N.isTr());
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
      if (cutout) {
        regEl.textContent = `${cutout.name}${nr ? ' · ' + nr.name + ' (' + nr.distKm + ' km)' : ''}`;
      } else if (nr) {
        regEl.textContent = `${nr.name} (~${nr.distKm} km)`;
      } else {
        regEl.textContent = isTr() ? 'Özel koordinat' : 'Custom site';
      }
    }

    function makeBadge(verified, concept, sourceText) {
      const cls = concept ? 'tac-badge tac-badge-concept' : (verified ? 'tac-badge tac-badge-ok' : 'tac-badge tac-badge-warn');
      const label = concept ? 'CONCEPT – not flight data' : (verified ? 'NASA verified' : '⚠ unverified');
      return `<span class="${cls}" title="${(sourceText || '').replace(/"/g, '&quot;')}">${label}</span>`;
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
        if (veh.concept) banner.textContent = 'CONCEPT – not flight data · All crewed rover specifications are architectural assumptions.';
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
          `<div class="tac-spec-row"><span>Base / Total mass</span><b>${veh.baseMassKg.value} / ${veh.totalMassKg} kg${massRange}</b> ${makeBadge(veh.baseMassKg.verified, veh.concept, veh.baseMassKg.source)}</div>` +
          `<div class="tac-spec-row"><span>Slope limit</span><b>${veh.slopeLimitDeg.value}°</b> ${makeBadge(veh.slopeLimitDeg.verified, veh.concept, veh.slopeLimitDeg.source)}</div>` +
          `<div class="tac-spec-row"><span>Power</span><b>${veh.powerMode.toUpperCase()} (${veh.power.ratedPowerW.value} W)</b> ${makeBadge(veh.power.ratedPowerW.verified, veh.concept, veh.power.ratedPowerW.source)}</div>`;
      }

      const fxEl = $('tac-veh-effects-note');
      if (fxEl) {
        fxEl.innerHTML =
          `<b>Vehicle rules ${makeBadge(false, veh.concept, veh.effects.massEnergyCoeffWhPerKgKm.source)}:</b> ` +
          `Higher mass raises energy/km and loose-sand (low-TI) sinkage; higher speed cuts traverse time but adds roughness risk; ` +
          (veh.powerMode === 'solar'
            ? 'Solar output tracks τ &amp; Ls via STORM dust model.'
            : 'Nuclear/Battery ignores τ, but cold rises trace-heater draw.');
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
          `<input type="range" min="0" max="100" step="1" value="${Math.round(inputs.weights[k] * 100)}" data-wkey="${k}">`;
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
      for (const def of LAYER_DEFS) {
        const st = layerState[def.key];
        const row = doc.createElement('div');
        row.className = 'tac-layer-row';
        const lowTag = def.lowRes ? ' <span class="tac-coarse-tag">coarse</span>' : '';
        row.innerHTML =
          `<label class="tac-layer-chk"><input type="checkbox" ${st.visible ? 'checked' : ''} data-lkey="${def.key}"> <span>${isTr() ? def.labelTr : def.label}</span>${lowTag}</label>` +
          `<div class="tac-layer-op-wrap"><input type="range" min="0" max="100" step="5" value="${Math.round(st.opacity * 100)}" data-opkey="${def.key}" aria-label="${def.label} opacity"><span class="tac-op-num">${Math.round(st.opacity * 100)}%</span></div>`;
        row.querySelector('[data-lkey]').onchange = (e) => {
          st.visible = e.target.checked;
          renderCanvasAndLegend();
        };
        row.querySelector('[data-opkey]').oninput = (e) => {
          st.opacity = Number(e.target.value) / 100;
          row.querySelector('.tac-op-num').textContent = `${Math.round(st.opacity * 100)}%`;
          renderCanvasAndLegend();
        };
        list.appendChild(row);
      }
    }

    function colorForLayerCell(defKey, idx) {
      const g = analysis.grids;
      if (defKey === 'final') {
        if (g.impassable[idx] || g.nasaVeto[idx]) return [145, 34, 28];
        return interpColor3(LAYER_DEFS[1].stops, g.final[idx] / 100);
      }
      if (defKey === 'optics') {
        if (analysis.ctxImgDataUri) return null; // Base CTX image drawn separately
        return interpColor3(LAYER_DEFS[0].stops, g.optics[idx] / 100);
      }
      if (defKey === 'topography') return interpColor3(LAYER_DEFS[2].stops, g.topography[idx] / 100);
      if (defKey === 'thermal') return interpColor3(LAYER_DEFS[3].stops, g.thermal[idx] / 100);
      if (defKey === 'radiation') return interpColor3(LAYER_DEFS[4].stops, g.radiation[idx] / 100);
      if (defKey === 'groundComp') {
        const kNorm = clamp((g.grsK[idx] - 0.1) / 0.5, 0, 1);
        return interpColor3(LAYER_DEFS[5].stops, kNorm);
      }
      if (defKey === 'geology') {
        const u = tacticalCfg.geologySim3292.units[g.geolUnits[idx]];
        return (u && GEOL_PALETTE[u.group]) || [140, 130, 118];
      }
      if (defKey === 'elevation') {
        const mn = analysis._elevMin, mx = analysis._elevMax;
        const t = mx > mn ? (g.elevM[idx] - mn) / (mx - mn) : 0.5;
        return interpColor3(LAYER_DEFS[7].stops, t);
      }
      if (defKey === 'slope') {
        const lim = analysis.vehicle.slopeLimitDeg.value;
        if (g.slopeDeg[idx] > lim) return [185, 35, 35];
        return interpColor3(LAYER_DEFS[8].stops, clamp(g.slopeDeg[idx] / Math.max(1, lim), 0, 1));
      }
      if (defKey === 'dust') return interpColor3(LAYER_DEFS[9].stops, g.dust[idx] / 100);
      if (defKey === 'confidence') return interpColor3(LAYER_DEFS[10].stops, g.confidence[idx] / 100);
      return [128, 128, 128];
    }

    function drawHatchedOverlay(c2d, w, h, labelText) {
      c2d.save();
      c2d.strokeStyle = 'rgba(255, 215, 130, 0.28)';
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
      const uri = analysis && analysis.ctxImgDataUri;
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
      if (optSt.visible && loadedCtxImg && loadedCtxImg.complete) {
        c2d.save();
        c2d.globalAlpha = optSt.opacity;
        c2d.drawImage(loadedCtxImg, 0, 0, W, H);
        // Dust haze veil proportional to tau if tau > 0.5
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
        if (def.key === 'optics' && analysis.ctxImgDataUri) continue;
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

      // Highlight impassable cells if final or slope visible
      if (layerState.final.visible || layerState.slope.visible) {
        c2d.save();
        c2d.strokeStyle = 'rgba(255, 95, 85, 0.72)';
        c2d.lineWidth = 1;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const i = r * n + c;
            if (analysis.grids.impassable[i]) {
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

      // Hatched low-resolution overlay when global coarse fallback OR active primary coarse layer
      const activeCoarseOnly = LAYER_DEFS.some((d) => d.lowRes && layerState[d.key].visible);
      if (analysis.isLowResGrid) {
        drawHatchedOverlay(c2d, W, H, 'LOW RESOLUTION OVERLAY (~5.2 km global offline fallback)');
      } else if (activeCoarseOnly && !layerState.final.visible && !layerState.elevation.visible && !layerState.slope.visible && !layerState.thermal.visible) {
        drawHatchedOverlay(c2d, W, H, 'LOW RESOLUTION ORBITAL LAYER (3.7–550 km footprint)');
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

    function renderLegend() {
      const leg = $('tac-legend');
      if (!leg || !analysis || !analysis.ok) return;
      leg.innerHTML = '';
      const active = LAYER_DEFS.filter((d) => layerState[d.key].visible && layerState[d.key].opacity > 0);
      if (!active.length) {
        leg.textContent = isTr() ? 'Görünür katman yok.' : 'No active layers toggled on.';
        return;
      }
      for (const def of active) {
        const row = doc.createElement('div');
        row.className = 'tac-leg-row';
        const sw = doc.createElement('span');
        sw.className = 'tac-leg-bar';
        sw.style.background = `linear-gradient(90deg, ${def.stops[0]}, ${def.stops[1]}, ${def.stops[2]})`;
        let rangeTxt = def.unit;
        if (def.key === 'elevation') {
          rangeTxt = `${analysis._elevMin.toFixed(0)} … ${analysis._elevMax.toFixed(0)} m`;
        } else if (def.key === 'slope') {
          rangeTxt = `0° … ${analysis.vehicle.slopeLimitDeg.value}° (>limit impassable)`;
        } else if (def.key === 'groundComp') {
          rangeTxt = `K wt% · Th ppm (coarse ~550 km)`;
        }
        const lbl = doc.createElement('span');
        lbl.className = 'tac-leg-lbl';
        lbl.innerHTML = `<b>${isTr() ? def.labelTr : def.label}</b> <small>${rangeTxt}</small>`;
        row.appendChild(sw);
        row.appendChild(lbl);
        leg.appendChild(row);
      }
    }

    function renderSummary() {
      const el = $('tac-summary');
      if (!el || !analysis || !analysis.ok) return;
      const sum = analysis.summary;
      const vt = analysis.vehicleTelemetry;
      const veh = analysis.vehicle;
      const badgeMode = analysis.dataMode === 'OFFLINE_PRECUT'
        ? '<span class="tac-badge tac-badge-ok">OFFLINE PRE-CUT</span>'
        : (analysis.dataMode === 'ONLINE_ORBITAL'
          ? '<span class="tac-badge tac-badge-ok">ONLINE-ONLY LIVE</span>'
          : '<span class="tac-badge tac-badge-warn">COARSE FALLBACK</span>');

      el.innerHTML =
        `<div class="tac-sum-head"><span>16 km² Compatibility Summary</span>${badgeMode}</div>` +
        `<div class="tac-sum-grid">` +
        `<div><small>Mean / Min / Max</small><b>${sum.meanScore} / ${sum.minScore} / ${sum.maxScore}</b></div>` +
        `<div><small>% Impassable (&gt;${veh.slopeLimitDeg.value}°)</small><b>${sum.impassablePct}%</b></div>` +
        `<div><small>Main limiting factor</small><b>${sum.limitingFactorLabel} (${sum.limitingFactorMean})</b></div>` +
        `<div><small>4 km traverse · Energy</small><b>${vt.traverse4KmHours} h · ${vt.energyPerKmWh} Wh/km</b></div>` +
        `</div>` +
        `<div class="tac-sum-note">${vt.powerNote} · Avg sinkage penalty: -${vt.avgSinkagePenalty} pts · Avg speed risk: -${vt.avgSpeedRiskPenalty} pts` +
        `${sum.nasaVetoPct > 0 ? ` · NASA HLS-2015 Veto: ${sum.nasaVetoPct}% cells = 0` : ''}</div>`;
    }

    function renderCellPopup(idx) {
      const el = $('tac-cell-popup');
      if (!el || !analysis || !analysis.ok) return;
      const p = engine.getCellPopup(analysis, idx);
      if (!p) return;
      const badgeHtml = (b) => {
        const cls = b === 'MEASURED' ? 'tac-badge tac-badge-ok' : (b === 'MODEL' ? 'tac-badge tac-badge-model' : 'tac-badge tac-badge-warn');
        return `<span class="${cls}">${b}</span>`;
      };
      const rows = p.domains.map((d) => {
        const sc = d.score == null ? '<i>Info only</i>' : `<b>${d.score}/100</b>`;
        return `<tr><td>${d.label}</td><td>${sc}</td><td>${d.raw}</td><td>${d.unit}</td><td>${badgeHtml(d.badge)} <small>${d.source}</small></td></tr>`;
      }).join('');
      const vetoStr = p.vetoReasons.length
        ? `<div class="tac-popup-veto">VETO / IMPASSABLE: ${p.vetoReasons.join(' · ')}</div>`
        : '';

      el.innerHTML =
        `<div class="tac-popup-head"><span>Cell (${p.row}, ${p.col}) · ${p.lat.toFixed(4)}°, ${fmtLonDisp(p.lon180, inputs.lonConvention)}</span>` +
        `<b>Final: ${p.finalScore}/100</b></div>` +
        vetoStr +
        `<div class="tac-popup-tbl-wrap"><table class="tbl tac-popup-tbl"><thead><tr><th>Domain</th><th>Score</th><th>Raw value</th><th>Unit</th><th>Badge &amp; Source</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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

      const resEl = $('tac-res-label');
      if (resEl) resEl.textContent = analysis.nativeResLabel;
      const pill = $('tac-mode-pill');
      if (pill) {
        const online = typeof navigator !== 'undefined' && navigator.onLine === false ? 'OFFLINE' : (inputs.onlineEnabled ? 'ONLINE-ONLY READY' : 'OFFLINE MODE');
        pill.textContent = `${analysis.dataMode} · ${online}`;
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
        ? Math.max(180, Math.min(340, Math.round(rect.width * 0.85)))
        : Math.max(200, Math.min(460, Math.round(Math.min(rect.width * 0.50, rect.height * 0.56))));
      box.style.width = `${target}px`;
      box.style.height = `${target}px`;
      const lineEl = $('tac-scale-line');
      if (lineEl) lineEl.style.width = `${Math.round(target * 0.25)}px`;
    }

    async function runAnalysis(skipOnlineFetch) {
      updateMarsClockReadout();
      updateRegionReadout();

      const loc = engine.validateLocation(inputs.lat, inputs.lonInput, inputs.lonConvention, tacticalCfg);
      if (!loc.valid) return;

      const btn = $('tac-generate-btn');
      const preset = engine.findPresetCutout(cutouts, loc.latDeg, loc.lon180);
      let onlineGrid = null;
      const canGoOnline = !skipOnlineFetch && !preset && inputs.onlineEnabled && (typeof navigator === 'undefined' || navigator.onLine !== false);
      if (canGoOnline) {
        if (btn) { btn.disabled = true; btn.textContent = 'Fetching orbital data (ONLINE-ONLY)…'; }
        const stPill = $('tac-mode-pill');
        if (stPill) stPill.textContent = 'ONLINE-ONLY · Fetching CTX + SIM 3292 + WMS…';
        try {
          onlineGrid = await fetchOnlineOrbitalGrid(loc, layers, tacticalCfg, engine, cutouts);
        } catch (_) {
          onlineGrid = null;
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Generate 16 km² analysis'; }
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
        dEl.onchange = () => { inputs.earthDateUtc = dEl.value; updateMarsClockReadout(); };
      }

      const ltstEl = $('tac-ltst');
      const ltstV = $('tac-ltst-v');
      if (ltstEl) {
        ltstEl.value = String(inputs.ltstHours);
        if (ltstV) ltstV.textContent = `${Number(inputs.ltstHours).toFixed(2)} h LTST`;
        ltstEl.oninput = () => {
          inputs.ltstHours = Number(ltstEl.value);
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
          if (tauV) tauV.textContent = `τ ${inputs.tau.toFixed(1)}`;
          updateTauButtons();
        };
      }
      doc.querySelectorAll('#tac-tau-presets button').forEach((b) => {
        b.onclick = () => {
          inputs.tau = Number(b.dataset.tau);
          if (tauEl) tauEl.value = String(inputs.tau);
          if (tauV) tauV.textContent = `τ ${inputs.tau.toFixed(1)}`;
          updateTauButtons();
        };
      });
      updateTauButtons();

      doc.querySelectorAll('#tac-solar-cycle button').forEach((b) => {
        b.onclick = () => {
          inputs.solarCycle = b.dataset.cycle;
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
        speEl.onchange = () => { inputs.speActive = speEl.checked; };
      }

      const clsSel = $('tac-veh-class');
      if (clsSel) {
        clsSel.value = inputs.vehicleClass;
        clsSel.onchange = () => {
          inputs.vehicleClass = clsSel.value;
          syncVehiclePanel(true); // Limit sliders to class range & reset
        };
      }
      const spEl = $('tac-veh-speed');
      if (spEl) {
        spEl.oninput = () => { inputs.speedKmh = Number(spEl.value); syncVehiclePanel(false); };
      }
      const ldEl = $('tac-veh-load');
      if (ldEl) {
        ldEl.oninput = () => { inputs.extraLoadKg = Number(ldEl.value); syncVehiclePanel(false); };
      }
      const pwSel = $('tac-veh-power-mode');
      if (pwSel) {
        pwSel.onchange = () => { inputs.powerMode = pwSel.value; syncVehiclePanel(false); };
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
          renderCanvasOnly();
          renderCellPopup(selectedCellIdx);
        };
      }

      const colBtn = $('tac-collapse-map-btn');
      if (colBtn) {
        colBtn.onclick = () => {
          mapExpanded = !mapExpanded;
          const ws = $('tac-workspace');
          if (ws) ws.classList.toggle('tac-compact', mapExpanded);
          colBtn.textContent = mapExpanded ? 'Expand 16 km²' : 'Compact';
          syncSquareViewportSize();
        };
      }

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
      if ($('tac-preset-zone')) $('tac-preset-zone').value = inputs.presetZoneId;
      if ($('tac-lat')) $('tac-lat').value = String(inputs.lat);
      if ($('tac-lon')) $('tac-lon').value = String(inputs.lonInput);
      updateRegionReadout();
      updateMarsClockReadout();
    }

    function onModeChange(mode) {
      const ws = $('tac-workspace');
      if (!ws) return;
      const show = mode === 'eva';
      ws.classList.toggle('hidden', !show);
      if (show) {
        syncSquareViewportSize();
        if (!analysis) runAnalysis(true);
      }
    }

    function init() {
      buildLayerControls();
      buildWeightSliders();
      syncVehiclePanel(false);
      bindEvents();
      updateMarsClockReadout();
      updateRegionReadout();
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
      onLangChange: () => { buildLayerControls(); buildWeightSliders(); updateRegionReadout(); renderLegend(); },
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
