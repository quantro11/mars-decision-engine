// Sidebar panel renderers (presets, sliders, candidates, site inspection, traverse, crisis, screen-reader announcer).
(function (global) {
  'use strict';

  const PRESET_CODES = { landing: 'EDL-PRI', isru: 'ISRU-H2O', balanced: 'CREW-BAL' };
  const CRIT_TAGS = { elev: 'ELEV', slope: 'SLOP', ice: 'H2O', rough: 'ROUG', lat: 'LAT', ti: 'TES', rad: 'RAD', cave: 'CAVE' };

  /**
   * Announce status transitions concisely to assistive technologies (#sr-status).
   * @param {string} msg
   * @param {Document} [doc]
   */
  function announce(msg, doc = global.document) {
    const el = doc && doc.querySelector ? doc.querySelector('#sr-status') : null;
    if (el) el.textContent = msg;
  }

  /**
   * Render criteria suitability bars using native semantic <meter> (0 inline styles).
   * @param {Object} v Cell or block physical values
   * @param {Object} w Active criteria weights
   * @param {Object} [deps]
   * @returns {string} HTML fragment
   */
  function critRowsHTML(v, w, deps = {}) {
    const SCORING = deps.SCORING || global.SCORING;
    const escHtml = deps.escHtml || (global.MDE_FMT && global.MDE_FMT.escHtml) || ((s) => String(s ?? ''));
    const wn = SCORING.normalize(w);
    const fmt = {
      elev: `${(v.elev / 1000).toFixed(1)} km`,
      slope: `${v.slope.toFixed(1)}°`,
      ice: v.ice === null ? 'no data' : v.ice.toFixed(2),
      rough: `${v.rough.toFixed(0)} m`,
      lat: `${v.lat.toFixed(1)}°`,
      ti: v.ti === null ? 'no data' : `${v.ti.toFixed(0)} tiu`,
      rad: `${v.rad.toFixed(0)} mSv/yr`,
      cave: v.cave == null ? '> 1000 km' : `${v.cave.toFixed(0)} km`,
    };
    return SCORING.CRITERIA.map(c => {
      const f = c.key === 'rad' ? SCORING.F.rad(v.elev) : SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      const pct = Math.round(f * 100);
      const hiWeight = (wn[c.key] || 0) >= 0.2 ? ' crit-weighted' : '';
      return `<div class="crit"><span>${escHtml(c.label.split(' (')[0])}</span><meter class="crit-meter${hiWeight}" min="0" max="100" low="33" high="66" optimum="100" value="${pct}" aria-label="${escHtml(c.label)} ${pct}%"></meter><span class="v ${cls}">${escHtml(fmt[c.key])}</span></div>`;
    }).join('');
  }

  function createPanels(ctx) {
    const {
      doc = global.document, S, layers, SCORING, STORM, FMT, CHARTS,
      onRescore, onSelect, onUseRoute, onUseCrisis, onGlobeFly,
    } = ctx;
    const $ = (s) => doc.querySelector(s);
    const { candidateName, trekUrl, fmtLat, fmtLon, escHtml } = FMT;

    function buildPresets() {
      const el = $('#presets');
      if (!el) return;
      el.innerHTML = '';
      for (const k in SCORING.PRESETS) {
        const p = SCORING.PRESETS[k], b = doc.createElement('button');
        b.className = 'preset' + (S.preset === k ? ' active' : '');
        const code = PRESET_CODES[k] || k.toUpperCase();
        b.innerHTML = `<span class="p-code">${escHtml(code)}</span><span class="p-name">${escHtml(p.name)}</span><small>${Object.values(p.w).map(v => (v * 100).toFixed(0)).join('·')}</small>`;
        b.onclick = () => { S.preset = k; S.weights = { ...p.w }; buildPresets(); buildSliders(); onRescore(); };
        el.appendChild(b);
      }
    }

    function buildSliders() {
      const el = $('#sliders');
      if (!el) return;
      el.innerHTML = '';
      const wn = SCORING.normalize(S.weights);
      for (const c of SCORING.CRITERIA) {
        const d = doc.createElement('div'); d.className = 'slider';
        const tag = CRIT_TAGS[c.key] || c.key.toUpperCase();
        d.innerHTML = `<div class="lbl"><span class="lbl-left"><span class="crit-tag">${escHtml(tag)}</span><span>${escHtml(c.label)}</span></span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}" aria-label="${escHtml(c.label)} weight">`;
        d.querySelector('input').oninput = (e) => {
          S.weights[c.key] = +e.target.value / 100;
          S.preset = null;
          buildPresets();
          const n = SCORING.normalize(S.weights);
          el.querySelectorAll('.slider').forEach((s, i) => {
            s.querySelector('b').textContent = (n[SCORING.CRITERIA[i].key] * 100).toFixed(0) + '%';
          });
          onRescore();
        };
        el.appendChild(d);
      }
    }

    function renderCandidates() {
      const ol = $('#candidates');
      if (!ol) return;
      ol.innerHTML = '';
      if (!S.candidates.length) {
        ol.innerHTML = '<li class="help">No surface block satisfies active constraints.</li>';
        announce('No surface block satisfies active constraints.', doc);
        return;
      }
      S.candidates.forEach((c, i) => {
        const v = layers.blockValues(c.x, c.y, c.blockPx), nr = layers.nearestRegion(v.lat, v.lon);
        const name = candidateName(v.lat, v.lon, nr);
        const ice = SCORING.calcIceAccess(v.ice, S.iceBand), flat = layers.flatShare(c.x, c.y, c.blockPx);
        const li = doc.createElement('li');
        li.className = 'card' + (S.selected && S.selected.cand === i ? ' active' : '');
        li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">0${i + 1}</span><span class="name">${escHtml(name)}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">HLS-2015 EZ</span>' : ''}</div><span class="score">${c.score.toFixed(2)}</span></div>
          <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ice: <b>${escHtml(ice.status.toLowerCase().replace('_', ' '))}</b> · ≤5° cells: <b>${(flat * 100).toFixed(0)}%</b>${c.robust != null ? ` · <span class="robust ${c.robust >= 0.8 ? 'ok' : c.robust >= 0.5 ? 'warn' : 'bad'}">ROBUST ${(c.robust * 100).toFixed(0)}%</span>` : ''}</div>${critRowsHTML(v, S.weights, { SCORING, escHtml })}
          <a class="trek" href="${escHtml(trekUrl(v.lat, v.lon))}" target="_blank" rel="noopener">Inspect in NASA Mars Trek (HiRISE / CTX) →</a>`;
        const trekLink = li.querySelector('.trek');
        if (trekLink) trekLink.onclick = (e) => e.stopPropagation();
        li.onclick = () => {
          onSelect(c.x, c.y, i);
          if (onGlobeFly) onGlobeFly(v.lat, v.lon);
          if (S.mode === 'crisis') onUseCrisis(c.x, c.y);
        };
        ol.appendChild(li);
      });
    }

    function renderDetail(x, y) {
      const el = $('#detail');
      if (!el) return;
      const v = layers.cellValues(x, y), s = S.score[y * layers.W + x], nr = layers.nearestRegion(v.lat, v.lon);
      const passElev = v.elev <= SCORING.HARD.elevMax;
      const passSlope = v.slope <= SCORING.HARD.slopeMax;
      const passLat = Math.abs(v.lat) <= SCORING.HARD.latMax;
      const vetoed = S.hard && (!passElev || !passSlope || !passLat);
      const ice = SCORING.calcIceAccess(v.ice, S.iceBand);
      const sTemp = STORM.surfaceTempC(v.lat, S.crisis.ls);
      const pTherm = STORM.thermalDemandKw(v.lat, S.crisis.ls);
      const terrain = SCORING.calcTerrainClass(v.slope, v.rough);
      const spe = SCORING.calcSPE(v.elev, 1.5);
      const iceTab = $('#iceband .active') ? $('#iceband .active').textContent : S.iceBand;

      el.innerHTML = `
        <div class="detail-header">
          <div>
            <div class="hint">Composite suitability</div>
            <div class="big">${s.toFixed(3)}</div>
          </div>
          <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${vetoed ? 'Vetoed' : 'Within constraints'}</span>
        </div>
        <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${nr.distDeg < 6 ? escHtml(nr.region.name) : 'near ' + escHtml(nr.region.name)} · ${(nr.distDeg * 59.3).toFixed(0)} km</div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">Elevation ≤ +2 km</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? 'pass' : 'veto'}</b></div>
          <div class="hls-check"><span class="hint">Slope ≤ 15°</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? 'pass' : 'veto'}</b></div>
          <div class="hls-check"><span class="hint">Latitude ≤ 50°</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? 'pass' : 'veto'}</b></div>
        </div>
        ${critRowsHTML(v, S.weights, { SCORING, escHtml })}
        <table>
          <tr><td>MOLA Elevation</td><td>${v.elev.toFixed(0)} m</td></tr>
          <tr><td>MOLA 90th-pct Slope</td><td>${v.slope.toFixed(1)}°</td></tr>
          <tr><td>SWIM Ice (${escHtml(iceTab)})</td><td>${v.ice === null ? 'outside ±60°' : v.ice.toFixed(2)}</td></tr>
          <tr><td>Ice access (${escHtml(ice.depth)})</td><td><b>${escHtml(ice.label)}</b></td></tr>
          <tr><td>Excavation for crew water</td><td>${ice.regolithKgSol === null ? '—' : `~${ice.regolithKgSol} kg regolith/sol <small>(assumes ${escHtml(ice.assumption)}; SWIM does not measure concentration)</small>`}</td></tr>
          <tr><td>Sub-cell Roughness (σ)</td><td>${v.rough.toFixed(0)} m</td></tr>
          <tr><td>Regional terrain class</td><td><b class="${terrain.terrainClass === 'RUGGED' ? 'bad' : terrain.terrainClass === 'MODERATE' ? 'warn' : 'ok'}">${escHtml(terrain.label)}</b></td></tr>
          <tr><td>Ellipse-scale hazards</td><td><small>${escHtml(terrain.recommendation)}</small></td></tr>
          <tr><td>TES Thermal Inertia</td><td>${v.ti === null ? 'no data' : v.ti.toFixed(0) + ' J m⁻² K⁻¹ s⁻½'}</td></tr>
          <tr><td>TES Dust Abundance</td><td>${v.dust === null ? 'no data' : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
          <tr><td>Atmospheric Column</td><td>${SCORING.atmoColumnGcm2(v.elev).toFixed(1)} g/cm²</td></tr>
          <tr><td>Nearest cave candidate</td><td>${(() => { const nc = layers.nearestCave ? layers.nearestCave(v.lat, v.lon) : null; return nc ? `${escHtml(nc.distKm.toFixed(0) + ' km · ' + nc.type + (nc.diameter ? ' · ~' + nc.diameter + ' m' : ''))} <small>(unconfirmed candidate)</small>` : 'catalogue not loaded'; })()}</td></tr>
          <tr><td>GCR Dose (MSL-RAD)</td><td>${SCORING.radDoseMsvYr(v.elev).toFixed(0)} mSv/yr</td></tr>
          <tr><td>Design-basis SPE (assumption)</td><td>${spe.unshieldedDoseMsv} mSv on the surface · ${spe.requiredRegolithM} m regolith for ≤ 100 mSv</td></tr>
          <tr><td>Surface temp. (approx.)</td><td>night ${sTemp.night.toFixed(0)} °C · mean ${sTemp.mean.toFixed(0)} °C</td></tr>
          <tr><td>Habitat heat loss</td><td>${pTherm} kW (covered by waste heat of the electrical load first)</td></tr>
        </table>
        <div class="row">
          <button id="use-route" class="ghost">Start a route here</button>
          <button id="use-crisis" class="ghost">Use in storm model</button>
        </div>`;
      $('#use-route').onclick = () => onUseRoute(x, y);
      $('#use-crisis').onclick = () => onUseCrisis(x, y, true);
      announce(`Selected ${nr.region.name}, score ${s.toFixed(2)}, ${vetoed ? 'vetoed' : 'within constraints'}.`, doc);
    }

    function renderRoute() {
      const r = S.route, el = $('#route-stats');
      if (!el) return;
      if (!r.start) { el.innerHTML = '<div class="verdict">Choose a start point on the map.</div>'; return; }
      if (!r.goal) { el.innerHTML = '<div class="verdict">Now choose the destination.</div>'; return; }
      if (!r.safe || !r.safe.ok) {
        const msg = r.safe ? r.safe.reason : '';
        el.innerHTML = `<div class="verdict bad">No slope-safe route found (${escHtml(msg)}). Increase slope threshold or relocate target.</div>`;
        announce('No slope-safe rover route found.', doc);
        return;
      }
      const a = r.straight.stats, b = r.safe.stats, sols = (km) => (km / r.speed).toFixed(0);
      const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
      const havens = b.safeHavens || [];
      const havenStr = havens.length ? havens.map(h => `${h.name} (${h.km}km · sol ${Math.round(h.km / r.speed)})`).join(', ') : 'None detected';

      el.innerHTML = `<table class="stat-table"><tr><th>Metric</th><th class="straight">Direct</th><th class="safe">A* Safe</th></tr>
        <tr><td>Total Distance</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
        <tr><td>Peak Slope</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
        <tr><td>Mean Slope</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}°</td></tr>
        <tr><td>Distance &gt;10° Slope</td><td>${a.hazardKm.toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} km</td></tr>
        <tr><td>Low-TI Dust (&lt;100 tiu)</td><td>${(a.dustKm || 0).toFixed(0)} km</td><td>${(b.dustKm || 0).toFixed(0)} km</td></tr>
        <tr><td>Candidate rest stops</td><td>—</td><td><b>${havens.length}</b> (flat, smooth, firm)</td></tr>
        <tr><td>Traverse Duration</td><td>${sols(a.km)} sols</td><td>${sols(b.km)} sols</td></tr></table>
        <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? `Direct path crosses ${a.maxSlope.toFixed(1)}° terrain (limit ${r.maxSlope}° limit). The safe route adds ${(b.km - a.km).toFixed(0)} km.` : 'NOMINAL // Direct path satisfies maximum slope constraint.'}</div>
        ${havens.length ? `<div class="help haven-note"><b>REST STOPS (TERRAIN ONLY, NO SHELTER IMPLIED)</b>${escHtml(havenStr)}</div>` : ''}
        <div class="hint mt-sm">Elevation profile along the safe route · solved in ${(r.ms || 0).toFixed(0)} ms, ${r.safe.path.length} cells</div>${CHARTS.profileSVG(b.profile)}`;
      announce(`Safe traverse route computed: ${b.km.toFixed(0)} kilometers, peak slope ${b.maxSlope.toFixed(1)} degrees.`, doc);
    }

    function runCrisis() {
      const c = S.crisis, el = $('#crisis-summary');
      if (!el) return;
      if (!c.site) {
        if ($('#crisis-site')) $('#crisis-site').textContent = 'Choose a site on the map';
        el.innerHTML = '';
        return;
      }
      const v = layers.cellValues(c.site.x, c.site.y), nr = layers.nearestRegion(v.lat, v.lon);
      if ($('#crisis-site')) $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : 'near ' + nr.region.name} · ${fmtLat(v.lat)}, ${fmtLon(v.lon)}`;
      const res = STORM.simulate({
        lat: v.lat, ls: c.ls, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
        storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 },
      });
      const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, 0.5, c.ls);
      const peakSolar = c.area * 0.2 * STORM.dailySolar(v.lat, c.tauPeak, c.ls);
      const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
      const sTemp = STORM.surfaceTempC(v.lat, c.ls);
      const pTherm = STORM.thermalDemandKw(v.lat, c.ls);
      const spe = SCORING.calcSPE(v.elev, c.regolith ?? 1.5);

      const verdict = res.blackoutSol !== null
        ? `<div class="summary-big bad">Blackout on sol ${res.blackoutSol}</div><div class="help">Battery reserve exhausted ${res.blackoutSol - 20} sols after storm onset. Peak-storm generation ${(peakSolar + nuc).toFixed(0)} kWh/sol vs load ${c.cons} kWh/sol.</div>`
        : `<div class="summary-big ok">Survives the storm</div><div class="help">Minimum battery reserve ${res.minBatt.toFixed(0)} kWh (${(100 * res.minBatt / c.batt).toFixed(0)}%). Net balance at peak attenuation: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.</div>`;

      const thermVerdict = res.freezeSol !== null
        ? `<div class="summary-big bad mt-sm">Habitat interior below 0 °C on sol ${res.freezeSol}</div><div class="help">Not enough heat once power is short; interior falls toward ambient (minimum ${res.minHabTemp}°C).</div>`
        : `<div class="summary-big ok mt-sm">Thermal Life Support Maintained</div><div class="help">Internal habitat comfort (+20°C) sustained throughout storm (night ambient drops to ${sTemp.night}°C).</div>`;

      const liveSpace = global.MDE_LIVE_STATE && global.MDE_LIVE_STATE.space;
      const liveCmeRow = liveSpace && liveSpace.mode === 'live'
        ? `<div class="kv"><span>DONKI CMEs (30d · live)</span><b>${liveSpace.events.length} catalogued</b></div>`
        : '';

      el.innerHTML = `${verdict}
        ${thermVerdict}
        <div class="kv"><span>Season (L<sub>s</sub> = ${c.ls}°)</span><b>${escHtml(STORM.seasonName(c.ls))}</b></div>
        <div class="kv"><span>Surface temp. (approx.)</span><b>night ${sTemp.night}°C · mean ${sTemp.mean}°C</b></div>
        <div class="kv"><span>Habitat heat loss</span><b>${pTherm} kW · extra heaters ${Math.max(...res.rows.map(r => r.heater)).toFixed(0)} kWh/sol max</b></div>
        <div class="kv"><span>Clear-sky solar, τ 0.5</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
        <div class="kv"><span>Peak-storm solar, τ ${c.tauPeak.toFixed(1)}</span><b>${peakSolar.toFixed(0)} kWh/sol (−${res.peakSolarDropPct.toFixed(0)}%)</b></div>
        <div class="kv"><span>Panel dust after ${res.rows.length} sols</span><b>−${res.postStormSolarLossPct}% (no cleaning events assumed)</b></div>
        <div class="kv"><span>Kilopower baseload</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
        <div class="kv kv-top"><span>Design-basis SPE on surface</span><b>${spe.unshieldedDoseMsv} mSv</b></div>
        <div class="kv"><span>Shielded (${(c.regolith ?? 1.5).toFixed(1)}m regolith)</span><b class="${spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad'}">${spe.shieldedDoseMsv} mSv (${escHtml(spe.survivalStatus)})</b></div>
        <div class="kv"><span>Regolith for ≤ 100 mSv</span><b>${spe.requiredRegolithM} m</b></div>
        <div class="help note-sm">SPE figures use an assumed August-1972-class event (~1 Sv behind 5 g/cm²), not a forecast. Largest SPE measured on the surface so far (Sept 2017, MSL/RAD): ~0.4 mGy.</div>
        ${liveCmeRow}
        ${CHARTS.crisisSVG(res.rows, c.batt)}
        <div class="help mt-sm">Profile: Sol 20 onset · 10-sol ramp · 40-sol plateau · 30-sol decay. ${c.kp === 0 && res.blackoutSol !== null ? 'Add fission power (Kilopower-class, 10 kWe design target) to keep the load and heating running.' : ''}</div>`;
      announce(res.blackoutSol !== null ? `Storm simulation: blackout on sol ${res.blackoutSol}.` : `Storm simulation: base survives with ${res.minBatt.toFixed(0)} kilowatt-hours reserve.`, doc);
    }

    return { buildPresets, buildSliders, renderCandidates, renderDetail, renderRoute, runCrisis, announce };
  }

  global.MDE_PANELS = { createPanels, critRowsHTML, announce };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
