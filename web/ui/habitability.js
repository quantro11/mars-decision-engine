// Module IV panel: NASA API key handling + live / archive / reference weather and DONKI space weather.
(function (global) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  // ------------------------------------------------------------ live habitability & space weather APIs
  function initHabitabilityAPI() {
    const keyInput = $('#nasa-api-key');
    if (!keyInput) return;
    const savedKey = localStorage.getItem('nasa_api_key') || 'DEMO_KEY';
    keyInput.value = savedKey;

    const btnSave = $('#btn-save-key');
    if (btnSave) {
      btnSave.onclick = () => {
        const val = keyInput.value.trim() || 'DEMO_KEY';
        localStorage.setItem('nasa_api_key', val);
        const st = $('#live-api-status');
        if (st) st.textContent = '✓ Saved NASA API Key: ' + (val === 'DEMO_KEY' ? 'DEMO_KEY' : 'Custom Key (***' + val.slice(-4) + ')');
      };
    }

    const btnFetch = $('#btn-fetch-live');
    if (btnFetch) {
      btnFetch.onclick = () => renderHabitability(true);
    }
  }

  async function renderHabitability(forceRefresh) {
    const el = $('#live-api-results'), st = $('#live-api-status');
    if (!el || !window.LIVE_API) return;
    const apiKey = localStorage.getItem('nasa_api_key') || 'DEMO_KEY';
    if (st) st.innerHTML = '⏳ Querying NASA Open APIs (api.nasa.gov)...';

    const [weatherRes, spaceRes] = await Promise.all([
      LIVE_API.fetchNASAWeather(apiKey),
      LIVE_API.fetchSpaceWeather(apiKey)
    ]);

    const BADGE = { live: ['#10b981', 'LIVE'], archive: ['#38bdf8', 'ARCHIVE'], reference: ['#f59e0b', 'REFERENCE · NOT LIVE'], offline: ['#ef4444', 'OFFLINE'] };
    const badge = (m) => `<span style="color:${BADGE[m][0]};font-weight:700">● ${BADGE[m][1]}</span>`;
    if (st) st.innerHTML = `Weather: ${badge(weatherRes.mode)} · Space weather: ${badge(spaceRes.mode)} · Key: ${apiKey === 'DEMO_KEY' ? 'DEMO_KEY' : 'Custom'}`;

    const w = weatherRes.data, ref = weatherRes.reference;
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const weatherBlock = w
      ? `<div class="kv"><span>Last archived sol</span><b>Sol ${w.sol}${w.first_utc ? ' · ' + esc(w.first_utc.slice(0, 10)) : ''}</b></div>
         <div class="kv"><span>Air temperature (min / mean / max)</span><b>${w.air_temp_c ? `${w.air_temp_c.min.toFixed(0)} / ${w.air_temp_c.mean.toFixed(0)} / ${w.air_temp_c.max.toFixed(0)} °C` : 'not reported'}</b></div>
         <div class="kv"><span>Pressure</span><b>${w.pressure_pa ? w.pressure_pa.toFixed(0) + ' Pa' : 'not reported'}</b></div>
         <div class="kv"><span>Wind</span><b>${w.wind_mps ? w.wind_mps.toFixed(1) + ' m/s' : 'not reported'}</b></div>`
      : `<div class="kv"><span>Site</span><b>${ref.site}</b></div>
         <div class="kv"><span>Air temperature range</span><b>${ref.air_temp_c.min} … ${ref.air_temp_c.max} °C</b></div>
         <div class="kv"><span>Seasonal pressure range</span><b>${ref.pressure_pa.min} … ${ref.pressure_pa.max} Pa</b></div>
         <div class="help" style="font-size:10px">Published climatology (${ref.citation}), not a current measurement.</div>`;
    const cme = spaceRes.events[0];
    const spaceBlock = spaceRes.mode === 'offline'
      ? `<div class="help">No data: ${esc(spaceRes.source)}. Nothing is shown rather than a placeholder.</div>`
      : `<div class="kv"><span>CMEs catalogued (30 days)</span><b>${spaceRes.events.length}</b></div>
         ${cme ? `<div class="kv"><span>Most recent</span><b>${esc(cme.startTime)}${cme.speed_kms ? ' · ' + Math.round(cme.speed_kms) + ' km/s' : ''}</b></div>` : ''}
         <div class="help" style="font-size:10px">DONKI catalogues heliospheric CMEs; whether one reaches Mars depends on its direction and is not assessed here.</div>`;

    const critRows = LIVE_API.MARS_HABITABILITY_CRITERIA.map(c => `
      <div style="background:rgba(255,255,255,.02);border:1px solid rgba(236,231,223,.08);border-radius:5px;padding:8px 10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <b style="color:#ece7df;font-size:12px">${c.marker}</b>
          <span style="font-size:10px;color:#f87171">${c.deficit}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;font-family:JetBrains Mono, monospace;margin-bottom:4px">
          <div><span style="color:#60a5fa">🌍 Earth:</span> ${c.earth}</div>
          <div><span style="color:#f97316">🔴 Mars:</span> ${c.mars}</div>
        </div>
        <div style="font-size:10.5px;color:#a3e635;border-top:1px dashed rgba(236,231,223,.08);padding-top:4px">
          🛡️ <b>ECLSS Countermeasure:</b> ${c.eclss}
        </div>
      </div>
    `).join('');

    el.innerHTML = `
      <div class="sec-head" style="margin-top:10px"><h2>Mars Surface Weather</h2></div>
      <div style="background:rgba(0,0,0,.25);border:1px solid rgba(236,231,223,.1);border-radius:6px;padding:10px;margin-bottom:12px">
        <div class="help" style="font-size:10px;margin-bottom:6px">${badge(weatherRes.mode)} ${esc(weatherRes.source)}</div>
        ${weatherBlock}
      </div>

      <div class="sec-head"><h2>Space Weather (NASA DONKI)</h2></div>
      <div style="background:rgba(0,0,0,.25);border:1px solid rgba(236,231,223,.1);border-radius:6px;padding:10px;margin-bottom:12px">
        <div class="help" style="font-size:10px;margin-bottom:6px">${badge(spaceRes.mode)} ${esc(spaceRes.source)}</div>
        ${spaceBlock}
      </div>

      <div class="sec-head"><h2>Earth vs. Mars Biosphere Habitability Index</h2></div>
      <p class="help">Comparing fundamental planetary life parameters against Earth baseline standards (1.00 Index):</p>
      ${critRows}
    `;
  }
  global.MDE_HAB = { initHabitabilityAPI, renderHabitability };
})(typeof window !== 'undefined' ? window : module.exports);
