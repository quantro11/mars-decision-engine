// Module IV panel: NASA API key handling + live / archive / reference weather and DONKI space weather.
(function (global) {
  'use strict';
  const BADGE_MAP = {
    live: ['badge-live', 'LIVE'],
    archive: ['badge-archive', 'ARCHIVE'],
    reference: ['badge-ref', 'REFERENCE · NOT LIVE'],
    offline: ['badge-offline', 'OFFLINE'],
  };

  function getEsc() {
    if (global.MDE_FMT && global.MDE_FMT.escHtml) return global.MDE_FMT.escHtml;
    return (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function initHabitabilityAPI(opts) {
    const doc = (opts && opts.document) || document;
    const storage = (opts && opts.storage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const $ = (s) => doc.querySelector(s);
    const keyInput = $('#nasa-api-key');
    if (!keyInput) return;

    const savedKey = (storage && storage.getItem('nasa_api_key')) || 'DEMO_KEY';
    keyInput.value = savedKey;

    const btnToggle = $('#btn-toggle-key');
    if (btnToggle) {
      btnToggle.onclick = () => {
        const hidden = keyInput.type === 'password';
        keyInput.type = hidden ? 'text' : 'password';
        btnToggle.textContent = hidden ? 'Hide' : 'Show';
        btnToggle.setAttribute('aria-pressed', String(hidden));
      };
    }

    const btnSave = $('#btn-save-key');
    if (btnSave) {
      btnSave.onclick = () => {
        const val = keyInput.value.trim() || 'DEMO_KEY';
        if (storage) storage.setItem('nasa_api_key', val);
        const st = $('#live-api-status');
        if (st) st.textContent = 'Saved NASA API Key: ' + (val === 'DEMO_KEY' ? 'DEMO_KEY' : 'Custom (***' + val.slice(-4) + ')');
      };
    }

    const btnFetch = $('#btn-fetch-live');
    if (btnFetch) {
      btnFetch.onclick = () => renderHabitability(true, opts);
    }
  }

  async function renderHabitability(forceRefresh, opts) {
    const doc = (opts && opts.document) || document;
    const storage = (opts && opts.storage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const liveApi = (opts && opts.liveApi) || global.LIVE_API;
    const fetchFn = opts && opts.fetchFn;
    const $ = (s) => doc.querySelector(s);
    const el = $('#live-api-results'), st = $('#live-api-status'), btnFetch = $('#btn-fetch-live');
    if (!el || !liveApi) return;

    const apiKey = (storage && storage.getItem('nasa_api_key')) || 'DEMO_KEY';
    if (btnFetch) btnFetch.disabled = true;
    if (st) st.textContent = 'Querying NASA Open APIs (api.nasa.gov)…';

    try {
      const [weatherRes, spaceRes] = await Promise.all([
        liveApi.fetchNASAWeather(apiKey, fetchFn),
        liveApi.fetchSpaceWeather(apiKey, fetchFn)
      ]);
      global.MDE_LIVE_STATE = { weather: weatherRes, space: spaceRes, fetchedAt: new Date().toISOString() };
      if (opts && opts.onLiveUpdate) opts.onLiveUpdate(global.MDE_LIVE_STATE);

      const esc = getEsc();
      const badge = (m) => {
        const [cls, label] = BADGE_MAP[m] || ['badge-offline', String(m || 'UNKNOWN').toUpperCase()];
        return `<span class="badge-mode ${cls}">● ${label}</span>`;
      };

      if (st) st.innerHTML = `Weather: ${badge(weatherRes.mode)} · Space weather: ${badge(spaceRes.mode)} · Key: ${apiKey === 'DEMO_KEY' ? 'DEMO_KEY' : 'Custom'}`;

      const w = weatherRes.data, ref = weatherRes.reference;
      const weatherBlock = w
        ? `<div class="kv"><span>Last archived sol</span><b>Sol ${w.sol}${w.first_utc ? ' · ' + esc(w.first_utc.slice(0, 10)) : ''}</b></div>
           <div class="kv"><span>Air temperature (min / mean / max)</span><b>${w.air_temp_c ? `${w.air_temp_c.min.toFixed(0)} / ${w.air_temp_c.mean.toFixed(0)} / ${w.air_temp_c.max.toFixed(0)} °C` : 'not reported'}</b></div>
           <div class="kv"><span>Pressure</span><b>${w.pressure_pa ? w.pressure_pa.toFixed(0) + ' Pa' : 'not reported'}</b></div>
           <div class="kv"><span>Wind</span><b>${w.wind_mps ? w.wind_mps.toFixed(1) + ' m/s' : 'not reported'}</b></div>`
        : `<div class="kv"><span>Site</span><b>${esc(ref.site)}</b></div>
           <div class="kv"><span>Air temperature range</span><b>${ref.air_temp_c.min} … ${ref.air_temp_c.max} °C</b></div>
           <div class="kv"><span>Seasonal pressure range</span><b>${ref.pressure_pa.min} … ${ref.pressure_pa.max} Pa</b></div>
           <div class="help note-sm">Published climatology (${esc(ref.citation)}), not a current measurement.</div>`;

      const cme = spaceRes.events && spaceRes.events[0];
      const spaceBlock = spaceRes.mode === 'offline'
        ? `<div class="help">No data: ${esc(spaceRes.source)}. Nothing is shown rather than a placeholder.</div>`
        : `<div class="kv"><span>CMEs catalogued (30 days)</span><b>${spaceRes.events.length}</b></div>
           ${cme ? `<div class="kv"><span>Most recent</span><b>${esc(cme.startTime)}${cme.speed_kms ? ' · ' + Math.round(cme.speed_kms) + ' km/s' : ''}</b></div>` : ''}
           <div class="help note-sm">DONKI catalogues heliospheric CMEs; whether one reaches Mars depends on its direction and is not assessed here.</div>`;

      const critRows = liveApi.MARS_HABITABILITY_CRITERIA.map(c => `
        <div class="hab-card">
          <div class="hab-head">
            <b>${esc(c.marker)}</b>
            <span class="hab-deficit">${esc(c.deficit)}</span>
          </div>
          <div class="hab-grid">
            <div><span class="hab-earth">Earth</span> ${esc(c.earth)}</div>
            <div><span class="hab-mars">Mars</span> ${esc(c.mars)}</div>
          </div>
          <div class="hab-counter">
            <b>ECLSS</b> ${esc(c.eclss)}
          </div>
        </div>
      `).join('');

      el.innerHTML = `
        <div class="sec-head mt-sm"><h2>Mars Surface Weather</h2></div>
        <div class="live-card">
          <div class="help note-sm">${badge(weatherRes.mode)} ${esc(weatherRes.source)}</div>
          ${weatherBlock}
        </div>

        <div class="sec-head"><h2>Space Weather (NASA DONKI)</h2></div>
        <div class="live-card">
          <div class="help note-sm">${badge(spaceRes.mode)} ${esc(spaceRes.source)}</div>
          ${spaceBlock}
        </div>

        <div class="sec-head"><h2>Earth vs. Mars Biosphere Habitability Index</h2></div>
        <p class="help">Comparing fundamental planetary life parameters against Earth baseline standards (1.00 Index):</p>
        ${critRows}
      `;
    } finally {
      if (btnFetch) btnFetch.disabled = false;
    }
  }

  global.MDE_HAB = { initHabitabilityAPI, renderHabitability };
})(typeof window !== 'undefined' ? window : module.exports);
