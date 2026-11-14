// Module IV panel: NASA API key handling + live / archive / reference weather and DONKI space weather.
(function (global) {
  'use strict';
  const BADGE_MAP = {
    live: ['badge-live', 'LIVE', 'CANLI'],
    live_archive: ['badge-live', 'LIVE ARCHIVE', 'CANLI ARŞİV'],
    archive: ['badge-archive', 'ARCHIVE', 'ARŞİV'],
    reference: ['badge-ref', 'REFERENCE · NOT LIVE', 'REFERANS · CANLI DEĞİL'],
    offline: ['badge-offline', 'OFFLINE', 'ÇEVRİMDIŞI'],
  };

  function getEsc() {
    if (global.MDE_FMT && global.MDE_FMT.escHtml) return global.MDE_FMT.escHtml;
    return (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const getI18N = () => global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
  const isTr = () => { const m = getI18N(); return !!(m && m.getLang && m.getLang() === 'tr'); };
  const t = (k, fb) => { const m = getI18N(); return (m && m.t(k) !== k) ? m.t(k) : fb; };
  const trHab = (c) => { const m = getI18N(); return (m && m.trHab) ? m.trHab(c) : c; };

  function initHabitabilityAPI(opts) {
    const doc = (opts && opts.document) || document;
    const storage = (opts && opts.storage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const $ = (s) => doc.querySelector(s);
    const keyInput = $('#nasa-api-key');
    if (!keyInput) return;

    // No silent DEMO_KEY default: empty means "use the same-origin proxy".
    const savedKey = (storage && storage.getItem('nasa_api_key')) || '';
    keyInput.value = savedKey;

    const btnToggle = $('#btn-toggle-key');
    if (btnToggle) {
      btnToggle.onclick = () => {
        const hidden = keyInput.type === 'password';
        keyInput.type = hidden ? 'text' : 'password';
        btnToggle.textContent = hidden ? t('apiHide', 'Hide') : t('apiShow', 'Show');
        btnToggle.setAttribute('aria-pressed', String(hidden));
      };
    }

    const btnSave = $('#btn-save-key');
    if (btnSave) {
      btnSave.onclick = () => {
        const val = keyInput.value.trim();
        if (storage) { if (val) storage.setItem('nasa_api_key', val); else storage.removeItem('nasa_api_key'); }
        const st = $('#live-api-status');
        if (st) st.textContent = val
          ? `${t('apiSaved', 'Saved NASA API Key')}: ${isTr() ? 'Özel' : 'Custom'} (***${val.slice(-4)})`
          : (isTr() ? 'Anahtar temizlendi: istekler sunucu proxy’si üzerinden gider.' : 'Key cleared: requests now use the server proxy.');
      };
    }

    const btnFetch = $('#btn-fetch-live');
    if (btnFetch) {
      btnFetch.onclick = () => renderHabitability(true, opts);
    }
  }

  function renderResultsMarkup(el, st, weatherRes, spaceRes, apiKey, liveApi) {
    const esc = getEsc(), tr = isTr();
    const badge = (m) => {
      const entry = BADGE_MAP[m];
      const cls = entry ? entry[0] : 'badge-offline';
      const label = entry ? (tr ? entry[2] : entry[1]) : String(m || 'UNKNOWN').toUpperCase();
      return `<span class="badge-mode ${cls}">● ${label}</span>`;
    };

    const keyLabel = !apiKey ? (tr ? 'proxy / yok' : 'proxy / none')
      : (apiKey === 'DEMO_KEY' ? 'DEMO_KEY' : (tr ? 'Özel' : 'Custom'));
    if (st) st.innerHTML = `${tr ? 'Hava' : 'Weather'}: ${badge(weatherRes.mode)} · ${tr ? 'Uzay havası' : 'Space weather'}: ${badge(spaceRes.mode)} · ${tr ? 'Anahtar' : 'Key'}: ${keyLabel}`;

    const w = weatherRes.data, ref = weatherRes.reference;
    const noneTxt = tr ? 'bildirilmedi' : 'not reported';
    const weatherBlock = w
      ? `<div class="kv"><span>${tr ? 'Son arşivlenen sol' : 'Last archived sol'}</span><b>Sol ${w.sol}${w.first_utc ? ' · ' + esc(w.first_utc.slice(0, 10)) : ''}</b></div>
         <div class="kv"><span>${tr ? 'Hava sıcaklığı (min / ort / maks)' : 'Air temperature (min / mean / max)'}</span><b>${w.air_temp_c ? `${w.air_temp_c.min.toFixed(0)} / ${w.air_temp_c.mean.toFixed(0)} / ${w.air_temp_c.max.toFixed(0)} °C` : noneTxt}</b></div>
         <div class="kv"><span>${tr ? 'Basınç' : 'Pressure'}</span><b>${w.pressure_pa ? w.pressure_pa.toFixed(0) + ' Pa' : noneTxt}</b></div>
         <div class="kv"><span>${tr ? 'Rüzgâr' : 'Wind'}</span><b>${w.wind_mps ? w.wind_mps.toFixed(1) + ' m/s' : noneTxt}</b></div>`
      : `<div class="kv"><span>${tr ? 'İstasyon' : 'Site'}</span><b>${esc(ref.site)}</b></div>
         <div class="kv"><span>${tr ? 'Hava sıcaklığı aralığı' : 'Air temperature range'}</span><b>${ref.air_temp_c.min} … ${ref.air_temp_c.max} °C</b></div>
         <div class="kv"><span>${tr ? 'Mevsimsel basınç aralığı' : 'Seasonal pressure range'}</span><b>${ref.pressure_pa.min} … ${ref.pressure_pa.max} Pa</b></div>
         <div class="help note-sm">${tr ? `Yayımlanmış klimatoloji (${esc(ref.citation)}); güncel ölçüm değildir.` : `Published climatology (${esc(ref.citation)}), not a current measurement.`}</div>`;

    const cme = spaceRes.events && spaceRes.events[0];
    const spaceBlock = spaceRes.mode === 'offline'
      ? `<div class="help">${tr ? `Veri yok: ${esc(spaceRes.source)}. Varsayım üretilmedi.` : `No data: ${esc(spaceRes.source)}. Nothing is shown rather than a placeholder.`}</div>`
      : `<div class="kv"><span>${tr ? 'Kataloglanan CME' : 'CMEs catalogued'}</span><b>${spaceRes.events.length}</b></div>
         ${cme ? `<div class="kv"><span>${tr ? 'En şiddetli / son olay' : 'Most recent / peak'}</span><b>${esc(cme.startTime)}${cme.speed_kms ? ' · ' + Math.round(cme.speed_kms) + ' km/s' : ''}</b></div>` : ''}
         ${cme && cme.note ? `<div class="help note-sm">${esc(cme.note)}</div>` : ''}
         <div class="help note-sm">${tr ? 'DONKI heliosferik CME kataloglar; Mars yüzey radyasyon etkisi MAVEN/MSL-RAD ölçümleriyle doğrulanır.' : 'DONKI catalogues heliospheric CMEs; Mars surface radiation impact is cross-referenced with MAVEN/MSL-RAD observations.'}</div>`;

    const critRows = liveApi.MARS_HABITABILITY_CRITERIA.map(rawC => {
      const c = trHab(rawC);
      return `<div class="hab-card">
        <div class="hab-head"><b>${esc(c.marker)}</b><span class="hab-deficit">${esc(c.deficit)}</span></div>
        <div class="hab-grid">
          <div><span class="hab-earth">${tr ? 'Dünya' : 'Earth'}</span> ${esc(c.earth)}</div>
          <div><span class="hab-mars">Mars</span> ${esc(c.mars)}</div>
        </div>
        <div class="hab-counter"><b>ECLSS</b> ${esc(c.eclss)}</div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="sec-head mt-sm"><h2>${tr ? 'Mars Yüzey Hava Durumu' : 'Mars Surface Weather'}</h2></div>
      <div class="live-card"><div class="help note-sm">${badge(weatherRes.mode)} ${esc(weatherRes.source)}</div>${weatherBlock}</div>
      <div class="sec-head"><h2>${tr ? 'Uzay Havası (NASA DONKI)' : 'Space Weather (NASA DONKI)'}</h2></div>
      <div class="live-card"><div class="help note-sm">${badge(spaceRes.mode)} ${esc(spaceRes.source)}</div>${spaceBlock}</div>
      <div class="sec-head"><h2>${tr ? 'Dünya vs. Mars Biyosfer Yaşanabilirlik İndeksi' : 'Earth vs. Mars Biosphere Habitability Index'}</h2></div>
      <p class="help">${tr ? 'Temel gezegensel yaşam parametrelerinin Dünya referans standardıyla (1.00 İndeks) karşılaştırması:' : 'Comparing fundamental planetary life parameters against Earth baseline standards (1.00 Index):'}</p>
      ${critRows}`;
  }

  async function renderHabitability(forceRefresh, opts) {
    const doc = (opts && opts.document) || document;
    const storage = (opts && opts.storage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const liveApi = (opts && opts.liveApi) || global.LIVE_API;
    const fetchFn = opts && opts.fetchFn;
    const $ = (s) => doc.querySelector(s);
    const el = $('#live-api-results'), st = $('#live-api-status'), btnFetch = $('#btn-fetch-live');
    if (!el || !liveApi) return;

    const apiKey = (storage && storage.getItem('nasa_api_key')) || '';
    const cached = global.MDE_LIVE_STATE || (typeof globalThis !== 'undefined' ? globalThis.MDE_LIVE_STATE : null);
    if (opts && opts.useCache && cached) {
      renderResultsMarkup(el, st, cached.weather, cached.space, apiKey, liveApi);
      return;
    }

    if (btnFetch) btnFetch.disabled = true;
    if (st) st.textContent = t('apiQuerying', 'Querying NASA Open APIs (api.nasa.gov)…');

    try {
      const [weatherRes, spaceRes] = await Promise.all([
        liveApi.fetchNASAWeather(apiKey, fetchFn),
        liveApi.fetchSpaceWeather(apiKey, fetchFn)
      ]);
      const nextState = { weather: weatherRes, space: spaceRes, fetchedAt: new Date().toISOString() };
      global.MDE_LIVE_STATE = nextState;
      if (typeof globalThis !== 'undefined') globalThis.MDE_LIVE_STATE = nextState;
      if (opts && opts.onLiveUpdate) opts.onLiveUpdate(nextState);
      renderResultsMarkup(el, st, weatherRes, spaceRes, apiKey, liveApi);
    } finally {
      if (btnFetch) btnFetch.disabled = false;
    }
  }

  global.MDE_HAB = { initHabitabilityAPI, renderHabitability };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
