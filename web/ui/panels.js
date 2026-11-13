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
  const t = (key, fb) => {
    if (global.MDE_I18N && typeof global.MDE_I18N.t === 'function') {
      const val = global.MDE_I18N.t(key);
      if (val && val !== key) return val;
    }
    return fb;
  };
  const isTr = () => !!(global.MDE_I18N && typeof global.MDE_I18N.getLang === 'function' && global.MDE_I18N.getLang() === 'tr');

  function critRowsHTML(v, w, deps = {}) {
    const SCORING = deps.SCORING || global.SCORING;
    const escHtml = deps.escHtml || (global.MDE_FMT && global.MDE_FMT.escHtml) || ((s) => String(s ?? ''));
    const wn = SCORING.normalize(w);
    const noData = isTr() ? 'veri yok' : 'no data';
    const fmt = {
      elev: `${(v.elev / 1000).toFixed(1)} km`,
      slope: `${v.slope.toFixed(1)}°`,
      ice: v.ice === null ? noData : v.ice.toFixed(2),
      rough: `${v.rough.toFixed(0)} m`,
      lat: `${v.lat.toFixed(1)}°`,
      ti: v.ti === null ? noData : `${v.ti.toFixed(0)} tiu`,
      rad: `${v.rad.toFixed(0)} mSv/yr`,
      cave: v.cave == null ? '> 1000 km' : `${v.cave.toFixed(0)} km`,
    };
    return SCORING.CRITERIA.map(c => {
      const f = c.key === 'rad' ? SCORING.F.rad(v.elev) : SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      const pct = Math.round(f * 100);
      const hiWeight = (wn[c.key] || 0) >= 0.2 ? ' crit-weighted' : '';
      const clabel = t('crit.' + c.key, c.label);
      return `<div class="crit"><span>${escHtml(clabel.split(' (')[0])}</span><meter class="crit-meter${hiWeight}" min="0" max="100" low="33" high="66" optimum="100" value="${pct}" aria-label="${escHtml(clabel)} ${pct}%"></meter><span class="v ${cls}">${escHtml(fmt[c.key])}</span></div>`;
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
        const pname = t('preset.' + k, p.name);
        b.innerHTML = `<span class="p-code">${escHtml(code)}</span><span class="p-name">${escHtml(pname)}</span><small>${Object.values(p.w).map(v => (v * 100).toFixed(0)).join('·')}</small>`;
        b.onclick = () => { S.preset = k; S.weights = { ...p.w }; buildPresets(); buildSliders(); onRescore(); };
        el.appendChild(b);
      }
    }

    function buildSliders() {
      const el = $('#sliders');
      if (!el) return;
      el.innerHTML = '';
      const wn = SCORING.normalize(S.weights);
      const tr = isTr();
      for (const c of SCORING.CRITERIA) {
        const d = doc.createElement('div'); d.className = 'slider';
        const tag = CRIT_TAGS[c.key] || c.key.toUpperCase();
        const clabel = t('crit.' + c.key, c.label);
        d.innerHTML = `<div class="lbl"><span class="lbl-left"><span class="crit-tag">${escHtml(tag)}</span><span>${escHtml(clabel)}</span></span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}" aria-label="${escHtml(clabel)} ${tr ? 'ağırlığı' : 'weight'}">`;
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
        const msg = t('noCands', 'No surface block satisfies active constraints.');
        ol.innerHTML = `<li class="help">${escHtml(msg)}</li>`;
        announce(msg, doc);
        return;
      }
      const tr = isTr();
      S.candidates.forEach((c, i) => {
        const v = layers.blockValues(c.x, c.y, c.blockPx), nr = layers.nearestRegion(v.lat, v.lon);
        const name = candidateName(v.lat, v.lon, nr);
        const ice = SCORING.calcIceAccess(v.ice, S.iceBand), flat = layers.flatShare(c.x, c.y, c.blockPx);
        const li = doc.createElement('li');
        li.className = 'card' + (S.selected && S.selected.cand === i ? ' active' : '');
        const robustTag = c.robust != null ? ` · <span class="robust ${c.robust >= 0.8 ? 'ok' : c.robust >= 0.5 ? 'warn' : 'bad'}">${tr ? 'SAĞLAM' : 'ROBUST'} ${(c.robust * 100).toFixed(0)}%</span>` : '';
        li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">0${i + 1}</span><span class="name">${escHtml(name)}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">HLS-2015 EZ</span>' : ''}</div><span class="score">${c.score.toFixed(2)}</span></div>
          <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${tr ? 'buz' : 'ice'}: <b>${escHtml(ice.status.toLowerCase().replace('_', ' '))}</b> · ≤5° ${tr ? 'hücre' : 'cells'}: <b>${(flat * 100).toFixed(0)}%</b>${robustTag}</div>${critRowsHTML(v, S.weights, { SCORING, escHtml })}
          <a class="trek" href="${escHtml(trekUrl(v.lat, v.lon))}" target="_blank" rel="noopener">${tr ? 'NASA Mars Trek’te incele (HiRISE / CTX) →' : 'Inspect in NASA Mars Trek (HiRISE / CTX) →'}</a>`;
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
      const tr = isTr();
      const passWord = tr ? 'geçer' : 'pass', vetoWord = tr ? 'veto' : 'veto';
      const nc = layers.nearestCave ? layers.nearestCave(v.lat, v.lon) : null;
      const caveStr = nc
        ? `${escHtml(nc.distKm.toFixed(0) + ' km · ' + nc.type + (nc.diameter ? ' · ~' + nc.diameter + ' m' : ''))} <small>(${tr ? 'doğrulanmamış aday' : 'unconfirmed candidate'})</small>`
        : (tr ? 'katalog yüklenmedi' : 'catalogue not loaded');

      el.innerHTML = `
        <div class="detail-header">
          <div>
            <div class="hint">${escHtml(t('compositeSuit', 'Composite suitability'))}</div>
            <div class="big">${s.toFixed(3)}</div>
          </div>
          <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${escHtml(vetoed ? t('vetoed', 'Vetoed') : t('withinConstraints', 'Within constraints'))}</span>
        </div>
        <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${nr.distDeg < 6 ? escHtml(nr.region.name) : (tr ? nr.region.name + ' yakını' : 'near ' + escHtml(nr.region.name))} · ${(nr.distDeg * 59.3).toFixed(0)} km</div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">${tr ? 'Rakım ≤ +2 km' : 'Elevation ≤ +2 km'}</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? passWord : vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Eğim ≤ 15°' : 'Slope ≤ 15°'}</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? passWord : vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Enlem ≤ 50°' : 'Latitude ≤ 50°'}</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? passWord : vetoWord}</b></div>
        </div>
        ${critRowsHTML(v, S.weights, { SCORING, escHtml })}
        <table>
          <tr><td>${tr ? 'MOLA Rakım' : 'MOLA Elevation'}</td><td>${v.elev.toFixed(0)} m</td></tr>
          <tr><td>${tr ? 'MOLA %90 Eğim' : 'MOLA 90th-pct Slope'}</td><td>${v.slope.toFixed(1)}°</td></tr>
          <tr><td>${tr ? 'SWIM Buzu' : 'SWIM Ice'} (${escHtml(iceTab)})</td><td>${v.ice === null ? (tr ? '±60° dışı' : 'outside ±60°') : v.ice.toFixed(2)}</td></tr>
          <tr><td>${tr ? 'Buz erişimi' : 'Ice access'} (${escHtml(ice.depth)})</td><td><b>${escHtml(ice.label)}</b></td></tr>
          <tr><td>${tr ? 'Mürettebat suyu için kazı' : 'Excavation for crew water'}</td><td>${ice.regolithKgSol === null ? '—' : `~${ice.regolithKgSol} kg ${tr ? 'regolit/sol' : 'regolith/sol'} <small>(${tr ? 'varsayım: ' : 'assumes '}${escHtml(ice.assumption)}${tr ? '; SWIM derişim ölçmez' : '; SWIM does not measure concentration'})</small>`}</td></tr>
          <tr><td>${tr ? 'Hücre-içi Pürüzlülük (σ)' : 'Sub-cell Roughness (σ)'}</td><td>${v.rough.toFixed(0)} m</td></tr>
          <tr><td>${tr ? 'Bölgesel arazi sınıfı' : 'Regional terrain class'}</td><td><b class="${terrain.terrainClass === 'RUGGED' ? 'bad' : terrain.terrainClass === 'MODERATE' ? 'warn' : 'ok'}">${escHtml(terrain.label)}</b></td></tr>
          <tr><td>${tr ? 'Elips-ölçekli tehlikeler' : 'Ellipse-scale hazards'}</td><td><small>${escHtml(terrain.recommendation)}</small></td></tr>
          <tr><td>${tr ? 'TES Termal Atalet' : 'TES Thermal Inertia'}</td><td>${v.ti === null ? (tr ? 'veri yok' : 'no data') : v.ti.toFixed(0) + ' J m⁻² K⁻¹ s⁻½'}</td></tr>
          <tr><td>${tr ? 'TES Toz Yoğunluğu' : 'TES Dust Abundance'}</td><td>${v.dust === null ? (tr ? 'veri yok' : 'no data') : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
          <tr><td>${tr ? 'Atmosferik Sütun' : 'Atmospheric Column'}</td><td>${SCORING.atmoColumnGcm2(v.elev).toFixed(1)} g/cm²</td></tr>
          <tr><td>${tr ? 'En yakın mağara adayı' : 'Nearest cave candidate'}</td><td>${caveStr}</td></tr>
          <tr><td>${tr ? 'GCR Dozu (MSL-RAD)' : 'GCR Dose (MSL-RAD)'}</td><td>${SCORING.radDoseMsvYr(v.elev).toFixed(0)} mSv/yr</td></tr>
          <tr><td>${tr ? 'Tasarım SPE dozu (varsayım)' : 'Design-basis SPE (assumption)'}</td><td>${spe.unshieldedDoseMsv} mSv ${tr ? 'yüzeyde' : 'on the surface'} · ${spe.requiredRegolithM} m ${tr ? 'regolit (≤100 mSv için)' : 'regolith for ≤ 100 mSv'}</td></tr>
          <tr><td>${tr ? 'Yüzey sıcaklığı (yakl.)' : 'Surface temp. (approx.)'}</td><td>${tr ? 'gece' : 'night'} ${sTemp.night.toFixed(0)} °C · ${tr ? 'ort' : 'mean'} ${sTemp.mean.toFixed(0)} °C</td></tr>
          <tr><td>${tr ? 'Habitat ısı kaybı' : 'Habitat heat loss'}</td><td>${pTherm} kW (${tr ? 'önce elektrik yükü atık ısısıyla karşılanır' : 'covered by waste heat of the electrical load first'})</td></tr>
        </table>
        <div class="row">
          <button id="use-route" class="ghost">${escHtml(t('startRouteHere', 'Start a route here'))}</button>
          <button id="use-crisis" class="ghost">${escHtml(t('useStormModel', 'Use in storm model'))}</button>
        </div>`;
      $('#use-route').onclick = () => onUseRoute(x, y);
      $('#use-crisis').onclick = () => onUseCrisis(x, y, true);
      announce(tr ? `Seçildi: ${nr.region.name}, skor ${s.toFixed(2)}.` : `Selected ${nr.region.name}, score ${s.toFixed(2)}, ${vetoed ? 'vetoed' : 'within constraints'}.`, doc);
    }

    function renderRoute() {
      const r = S.route, el = $('#route-stats');
      if (!el) return;
      const tr = isTr();
      if (!r.start) { el.innerHTML = `<div class="verdict">${escHtml(t('routeChooseStart', 'Choose a start point on the map.'))}</div>`; return; }
      if (!r.goal) { el.innerHTML = `<div class="verdict">${escHtml(t('routeChooseGoal', 'Now choose the destination.'))}</div>`; return; }
      if (!r.safe || !r.safe.ok) {
        const msg = r.safe ? r.safe.reason : '';
        el.innerHTML = `<div class="verdict bad">${escHtml(t('routeFail', 'No slope-safe route found'))} (${escHtml(msg)}). ${tr ? 'Eğim sınırını artırın veya hedefi değiştirin.' : 'Increase slope threshold or relocate target.'}</div>`;
        announce(tr ? 'Eğim sınırına uygun güvenli rota bulunamadı.' : 'No slope-safe rover route found.', doc);
        return;
      }
      const a = r.straight.stats, b = r.safe.stats, sols = (km) => (km / r.speed).toFixed(0);
      const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
      const havens = b.safeHavens || [];
      const havenStr = havens.length ? havens.map(h => `${h.name} (${h.km}km · sol ${Math.round(h.km / r.speed)})`).join(', ') : (tr ? 'Tespit edilmedi' : 'None detected');

      el.innerHTML = `<table class="stat-table"><tr><th>${tr ? 'Metrik' : 'Metric'}</th><th class="straight">${tr ? 'Doğrudan' : 'Direct'}</th><th class="safe">${tr ? 'A* Güvenli' : 'A* Safe'}</th></tr>
        <tr><td>${tr ? 'Toplam Mesafe' : 'Total Distance'}</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
        <tr><td>${tr ? 'Tepe Eğim' : 'Peak Slope'}</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
        <tr><td>${tr ? 'Ortalama Eğim' : 'Mean Slope'}</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}°</td></tr>
        <tr><td>${tr ? '&gt;10° Eğim Mesafesi' : 'Distance &gt;10° Slope'}</td><td>${a.hazardKm.toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} km</td></tr>
        <tr><td>${tr ? 'Düşük-TI Toz (&lt;100 tiu)' : 'Low-TI Dust (&lt;100 tiu)'}</td><td>${(a.dustKm || 0).toFixed(0)} km</td><td>${(b.dustKm || 0).toFixed(0)} km</td></tr>
        <tr><td>${tr ? 'Aday mola noktası' : 'Candidate rest stops'}</td><td>—</td><td><b>${havens.length}</b> (${tr ? 'düz, pürüzsüz, sert' : 'flat, smooth, firm'})</td></tr>
        <tr><td>${tr ? 'Geçiş Süresi' : 'Traverse Duration'}</td><td>${sols(a.km)} sols</td><td>${sols(b.km)} sols</td></tr></table>
        <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? (tr ? `Doğrudan hat ${a.maxSlope.toFixed(1)}° eğimi aşıyor (sınır ${r.maxSlope}°). Güvenli rota +${(b.km - a.km).toFixed(0)} km ekler.` : `Direct path crosses ${a.maxSlope.toFixed(1)}° terrain (limit ${r.maxSlope}° limit). The safe route adds ${(b.km - a.km).toFixed(0)} km.`) : (tr ? 'NOMİNAL // Doğrudan hat azami eğim sınırını sağlıyor.' : 'NOMINAL // Direct path satisfies maximum slope constraint.')}</div>
        ${havens.length ? `<div class="help haven-note"><b>${tr ? 'MOLA NOKTALARI (YALNIZCA ARAZİ, SIĞINAK ANLAMI TAŞIMAZ)' : 'REST STOPS (TERRAIN ONLY, NO SHELTER IMPLIED)'}</b>${escHtml(havenStr)}</div>` : ''}
        <div class="hint mt-sm">${tr ? 'Güvenli rota boyunca yükselti profili' : 'Elevation profile along the safe route'} · ${(r.ms || 0).toFixed(0)} ms, ${r.safe.path.length} ${tr ? 'hücre' : 'cells'}</div>${CHARTS.profileSVG(b.profile)}`;
      announce(tr ? `Güvenli rover rotası hesaplandı: ${b.km.toFixed(0)} kilometre, tepe eğim ${b.maxSlope.toFixed(1)} derece.` : `Safe traverse route computed: ${b.km.toFixed(0)} kilometers, peak slope ${b.maxSlope.toFixed(1)} degrees.`, doc);
    }

    function runCrisis() {
      const c = S.crisis, el = $('#crisis-summary');
      if (!el) return;
      const tr = isTr();
      if (!c.site) {
        if ($('#crisis-site')) $('#crisis-site').textContent = t('crisisChooseSite', 'Choose a site on the map');
        el.innerHTML = '';
        return;
      }
      const v = layers.cellValues(c.site.x, c.site.y), nr = layers.nearestRegion(v.lat, v.lon);
      if ($('#crisis-site')) $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : (tr ? nr.region.name + ' yakını' : 'near ' + nr.region.name)} · ${fmtLat(v.lat)}, ${fmtLon(v.lon)}`;
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
        ? `<div class="summary-big bad">${escHtml(t('stormBlackout', 'Blackout on sol'))} ${res.blackoutSol}</div><div class="help">${tr ? `Batarya rezervi fırtınadan ${res.blackoutSol - 20} sol sonra tükendi. Tepe üretim ${(peakSolar + nuc).toFixed(0)} kWh/sol vs yük ${c.cons} kWh/sol.` : `Battery reserve exhausted ${res.blackoutSol - 20} sols after storm onset. Peak-storm generation ${(peakSolar + nuc).toFixed(0)} kWh/sol vs load ${c.cons} kWh/sol.`}</div>`
        : `<div class="summary-big ok">${escHtml(t('stormSurvives', 'Survives the storm'))}</div><div class="help">${tr ? `Minimum batarya rezervi ${res.minBatt.toFixed(0)} kWh (%${(100 * res.minBatt / c.batt).toFixed(0)}). Tepe sönümde net denge: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.` : `Minimum battery reserve ${res.minBatt.toFixed(0)} kWh (${(100 * res.minBatt / c.batt).toFixed(0)}%). Net balance at peak attenuation: ${(peakSolar + nuc - c.cons).toFixed(0)} kWh/sol.`}</div>`;

      const thermVerdict = res.freezeSol !== null
        ? `<div class="summary-big bad mt-sm">${tr ? `Habitat içi sol ${res.freezeSol} gününde 0 °C altına düşer` : `Habitat interior below 0 °C on sol ${res.freezeSol}`}</div><div class="help">${tr ? `Güç kesilince ısıtma yetersiz kalır; iç sıcaklık ortama düşer (min ${res.minHabTemp}°C).` : `Not enough heat once power is short; interior falls toward ambient (minimum ${res.minHabTemp}°C).`}</div>`
        : `<div class="summary-big ok mt-sm">${tr ? 'Termal Yaşam Desteği Korundu' : 'Thermal Life Support Maintained'}</div><div class="help">${tr ? `İç konfor (+20°C) fırtına boyunca sürdü (gece dış ortam ${sTemp.night}°C).` : `Internal habitat comfort (+20°C) sustained throughout storm (night ambient drops to ${sTemp.night}°C).`}</div>`;

      const liveSpace = global.MDE_LIVE_STATE && global.MDE_LIVE_STATE.space;
      const liveCmeRow = liveSpace && liveSpace.mode === 'live'
        ? `<div class="kv"><span>${tr ? 'DONKI CME (30g · canlı)' : 'DONKI CMEs (30d · live)'}</span><b>${liveSpace.events.length} ${tr ? 'kataloglandı' : 'catalogued'}</b></div>`
        : '';

      el.innerHTML = `${verdict}
        ${thermVerdict}
        <div class="kv"><span>${tr ? 'Mevsim' : 'Season'} (L<sub>s</sub> = ${c.ls}°)</span><b>${escHtml(STORM.seasonName(c.ls))}</b></div>
        <div class="kv"><span>${tr ? 'Yüzey sıcaklığı (yakl.)' : 'Surface temp. (approx.)'}</span><b>${tr ? 'gece' : 'night'} ${sTemp.night}°C · ${tr ? 'ort' : 'mean'} ${sTemp.mean}°C</b></div>
        <div class="kv"><span>${tr ? 'Habitat ısı kaybı' : 'Habitat heat loss'}</span><b>${pTherm} kW · ${tr ? 'ek ısıtıcı' : 'extra heaters'} ${Math.max(...res.rows.map(r => r.heater)).toFixed(0)} kWh/sol max</b></div>
        <div class="kv"><span>${tr ? 'Açık gök güneş, τ 0.5' : 'Clear-sky solar, τ 0.5'}</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
        <div class="kv"><span>${tr ? 'Fırtına zirvesi, τ' : 'Peak-storm solar, τ'} ${c.tauPeak.toFixed(1)}</span><b>${peakSolar.toFixed(0)} kWh/sol (−${res.peakSolarDropPct.toFixed(0)}%)</b></div>
        <div class="kv"><span>${tr ? `${res.rows.length} sol sonrası toz kaybı` : `Panel dust after ${res.rows.length} sols`}</span><b>−${res.postStormSolarLossPct}% (${tr ? 'temizlik yok' : 'no cleaning events assumed'})</b></div>
        <div class="kv"><span>${tr ? 'Kilopower baz yük' : 'Kilopower baseload'}</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
        <div class="kv kv-top"><span>${tr ? 'Yüzeyde tasarım SPE dozu' : 'Design-basis SPE on surface'}</span><b>${spe.unshieldedDoseMsv} mSv</b></div>
        <div class="kv"><span>${tr ? `Siperli (${(c.regolith ?? 1.5).toFixed(1)}m regolit)` : `Shielded (${(c.regolith ?? 1.5).toFixed(1)}m regolith)`}</span><b class="${spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad'}">${spe.shieldedDoseMsv} mSv (${escHtml(spe.survivalStatus)})</b></div>
        <div class="kv"><span>${tr ? '≤ 100 mSv için regolit' : 'Regolith for ≤ 100 mSv'}</span><b>${spe.requiredRegolithM} m</b></div>
        <div class="help note-sm">${tr ? 'SPE değerleri varsayımsal Ağust-1972 benzeri olayı (~1 Sv / 5 g/cm²) esas alır; anlık tahmin değildir.' : 'SPE figures use an assumed August-1972-class event (~1 Sv behind 5 g/cm²), not a forecast. Largest SPE measured on the surface so far (Sept 2017, MSL/RAD): ~0.4 mGy.'}</div>
        ${liveCmeRow}
        ${CHARTS.crisisSVG(res.rows, c.batt)}
        <div class="help mt-sm">${tr ? 'Profil: Sol 20 başlangıç · 10-sol artış · 40-sol plato · 30-sol azalış.' : 'Profile: Sol 20 onset · 10-sol ramp · 40-sol plateau · 30-sol decay.'} ${c.kp === 0 && res.blackoutSol !== null ? (tr ? 'Yük ve ısıtmayı ayakta tutmak için fisyon (Kilopower, 10 kWe hedefi) ekleyin.' : 'Add fission power (Kilopower-class, 10 kWe design target) to keep the load and heating running.') : ''}</div>`;
      announce(res.blackoutSol !== null ? (tr ? `Fırtına simülasyonu: sol ${res.blackoutSol} kesintisi.` : `Storm simulation: blackout on sol ${res.blackoutSol}.`) : (tr ? `Fırtına simülasyonu: üs ${res.minBatt.toFixed(0)} kWh rezerv ile ayakta kalır.` : `Storm simulation: base survives with ${res.minBatt.toFixed(0)} kilowatt-hours reserve.`), doc);
    }

    return { buildPresets, buildSliders, renderCandidates, renderDetail, renderRoute, runCrisis, announce };
  }

  global.MDE_PANELS = { createPanels, critRowsHTML, announce };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
