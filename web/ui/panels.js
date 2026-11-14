// Sidebar panel renderers (presets, sliders, candidates, site inspection, traverse, crisis, screen-reader announcer).
(function (global) {
  'use strict';

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
  const getI18N = () => global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
  const t = (key, fb) => {
    const m = getI18N();
    if (m && typeof m.t === 'function') {
      const val = m.t(key);
      if (val && val !== key) return val;
    }
    return fb;
  };
  const isTr = () => { const m = getI18N(); return !!(m && typeof m.getLang === 'function' && m.getLang() === 'tr'); };
  const trDom = (v) => { const m = getI18N(); return (m && typeof m.trDomain === 'function') ? m.trDomain(v) : v; };

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
      const f = c.key === 'rad' ? SCORING.F.rad(v.elev, v.slope || 0) : SCORING.F[c.key](v[c.key]);
      const cls = f > 0.66 ? 'ok' : f > 0.33 ? 'warn' : 'bad';
      const pct = Math.round(f * 100);
      const hiWeight = (wn[c.key] || 0) >= 0.2 ? ' crit-weighted' : '';
      const clabel = t('crit.' + c.key, c.label);
      return `<div class="crit"><span>${escHtml(clabel.split(' (')[0])}</span><meter class="crit-meter${hiWeight}" min="0" max="100" low="33" high="66" optimum="100" value="${pct}" aria-label="${escHtml(clabel)} ${pct}%"></meter><span class="v ${cls}">${escHtml(fmt[c.key])}</span></div>`;
    }).join('');
  }

  function buildPlainSummary(v, vetoed, passElev, passSlope, passLat, ice, nr, radMsv, tr) {
    const fails = [];
    if (!passElev) fails.push(tr ? 'çok yüksek rakım (> +2 km)' : 'elevation too high (> +2 km)');
    if (!passSlope) fails.push(tr ? 'çok dik eğim (> 15°)' : 'terrain too steep (> 15°)');
    if (!passLat) fails.push(tr ? 'ekvatordan çok uzak (> ±50°)' : 'too far from equator (> ±50°)');
    const lead = vetoed
      ? (tr ? `Güvenlik kuralları dışında kalıyor (${fails.join(', ')}).` : `Outside landing safety limits (${fails.join(', ')}).`)
      : (tr ? `${nr.region.name} çevresi temel NASA iniş güvenliği kurallarına uygundur.` : `This area near ${nr.region.name} meets core NASA landing safety limits.`);
    const elevNote = v.elev <= 0
      ? (tr ? 'Alçak rakım iniş frenlemesi için daha yoğun hava ve daha az radyasyon sunar.' : 'Low elevation leaves thicker air for braking and lower radiation.')
      : (tr ? 'Yüksek rakım hava frenlemesini zorlaştırır.' : 'Higher ground leaves thinner air for slowing down.');
    const slopeNote = v.slope <= 5
      ? (tr ? 'Zemin iniş için oldukça düzdür.' : 'Ground is mostly flat for landing.')
      : (tr ? `Zemin eğimi (${v.slope.toFixed(1)}°) dikkat gerektirir.` : `Slope (${v.slope.toFixed(1)}°) requires careful targeting.`);
    const iceSt = ice ? ice.status : 'NO_DATA';
    const iceNote = iceSt === 'LIKELY'
      ? (tr ? 'Yeraltı su buzu bulunma ihtimali yüksek.' : 'Strong signs of buried water ice nearby.')
      : iceSt === 'POSSIBLE'
        ? (tr ? 'Yeraltında su buzu olabilir.' : 'Moderate signs of buried water ice.')
        : iceSt === 'NO_DATA'
          ? (tr ? 'Bu enlemde yeraltı su buzu verisi kapsam dışı.' : 'Outside subsurface water-ice mapping coverage.')
          : (tr ? 'Yüzeye yakın su buzu ihtimali zayıf.' : 'Little evidence of shallow water ice here.');
    const radNote = tr ? `Tahmini yıllık radyasyon ≈ ${radMsv.toFixed(0)} mSv.` : `Cosmic radiation ≈ ${radMsv.toFixed(0)} mSv/yr.`;
    return `${lead} ${elevNote} ${slopeNote} ${iceNote} ${radNote}`;
  }

  function createPanels(ctx) {
    const {
      doc = global.document, S, layers, SCORING, STORM, FMT, CHARTS,
      onRescore, onSelect, onUseRoute, onUseCrisis, onUseEva, onPlanMarswalk, onOpenHud, onGlobeFly,
    } = ctx;
    const $ = (s) => doc.querySelector(s);
    const { candidateName, trekUrl, fmtLat, fmtLon, escHtml } = FMT;

    function buildPresets() {
      const el = $('#presets');
      if (!el) return;
      el.innerHTML = '';
      for (const k in SCORING.PRESETS) {
        const p = SCORING.PRESETS[k], b = doc.createElement('button');
        const active = S.preset === k;
        b.className = 'preset' + (active ? ' active' : '');
        b.setAttribute('aria-pressed', String(active));
        const pname = t('preset.' + k, p.name);
        const psub = t('presetSub.' + k, '');
        b.innerHTML = `<span class="p-name">${escHtml(pname)}</span><small>${escHtml(psub)}</small>`;
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
        const clabel = t('crit.' + c.key, c.label);
        const helpTip = t('critHelp.' + c.key, '');
        if (helpTip) d.title = helpTip;
        d.innerHTML = `<div class="lbl"><span class="lbl-left">${escHtml(clabel)}</span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}" aria-label="${escHtml(clabel)} ${tr ? 'önemi' : 'importance'}">`;
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
        const active = !!(S.selected && S.selected.cand === i);
        li.className = 'card' + (active ? ' active' : '');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-pressed', String(active));
        li.setAttribute('aria-label', `${name}, ${tr ? 'skor' : 'score'} ${c.score.toFixed(2)}`);
        const robustCi = (c.robust != null && SCORING.wilson95CI)
          ? SCORING.wilson95CI(Math.round(c.robust * 100), 100)
          : null;
        const ciLo = robustCi ? (Array.isArray(robustCi) ? robustCi[0] : robustCi.low) : null;
        const ciHi = robustCi ? (Array.isArray(robustCi) ? robustCi[1] : robustCi.high) : null;
        const robustTag = c.robust != null
          ? ` · <span class="robust ${c.robust >= 0.8 ? 'ok' : c.robust >= 0.5 ? 'warn' : 'bad'}">${tr ? 'TUTARLI' : 'STABLE'} ${(c.robust * 100).toFixed(0)}%${ciLo != null ? ` (95% CI ${(ciLo * 100).toFixed(0)}–${(ciHi * 100).toFixed(0)}%, N=100)` : ''}</span>`
          : '';
        const iceDisplay = ice.status === 'NO_DATA'
          ? (tr ? 'veri yok (±60° dışı)' : 'no data (outside ±60°)')
          : trDom(ice.status).toLowerCase().replace(/_/g, ' ');
        li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">0${i + 1}</span><span class="name">${escHtml(name)}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">NASA EZ</span>' : ''}</div><span class="score">${c.score.toFixed(2)}</span></div>
          <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${tr ? 'buz tutarlılığı' : 'ice consistency'}: <b>${escHtml(iceDisplay)}</b> · ${(flat * 100).toFixed(0)}% ${tr ? 'düz zemin' : 'flat ground'}${robustTag}</div>${critRowsHTML(v, S.weights, { SCORING, escHtml })}
          <div class="card-links">
            <button type="button" class="eva-card-btn">${tr ? 'Yerel EVA Bölgesine Yakınlaş (1 m/px) & HUD →' : 'Zoom to Local EVA Zone (1 m/px) & HUD →'}</button>
            <a class="trek" href="${escHtml(trekUrl(v.lat, v.lon))}" target="_blank" rel="noopener">${tr ? 'NASA Mars Trek (HiRISE / CTX) →' : 'NASA Mars Trek (HiRISE / CTX) →'}</a>
          </div>`;
        const trekLink = li.querySelector('.trek');
        if (trekLink) trekLink.onclick = (e) => e.stopPropagation();
        const evaBtn = li.querySelector('.eva-card-btn');
        if (evaBtn) {
          evaBtn.onclick = (e) => {
            e.stopPropagation();
            onSelect(c.x, c.y, i);
            if (onUseEva) onUseEva(c.x, c.y, v, name);
          };
        }
        const activateCard = () => {
          onSelect(c.x, c.y, i);
          if (onGlobeFly) onGlobeFly(v.lat, v.lon);
          if (S.mode === 'crisis') onUseCrisis(c.x, c.y);
        };
        li.onclick = activateCard;
        li.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateCard(); }
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
      const sTemp = STORM.surfaceTempC(v.lat, S.crisis.ls, v.ti, v.elev);
      const pTherm = STORM.thermalDemandKw(v.lat, S.crisis.ls, v.ti, v.elev);
      const terrain = SCORING.calcTerrainClass(v.slope, v.rough);
      const spe = SCORING.calcSPE(v.elev, 1.5);
      const iceTab = $('#iceband .active') ? $('#iceband .active').textContent : S.iceBand;
      const tr = isTr();
      const passWord = tr ? 'uygun' : 'pass', vetoWord = tr ? 'sınır dışı' : 'veto';
      const nc = layers.nearestCave ? layers.nearestCave(v.lat, v.lon) : null;
      const caveStr = nc
        ? `${escHtml(nc.distKm.toFixed(0) + ' km · ' + nc.type + (nc.diameter ? ' · ~' + nc.diameter + ' m' : ''))} <small>(${tr ? 'doğrulanmamış aday' : 'unconfirmed candidate'})</small>`
        : (tr ? 'katalog yüklenmedi' : 'catalogue not loaded');
      const radMsv = SCORING.radDoseMsvYr(v.elev, v.slope || 0);
      const radBand = SCORING.radDoseBand
        ? SCORING.radDoseBand(v.elev, v.slope || 0)
        : { nominal: radMsv, min: radMsv * 0.812, max: radMsv * 1.188, uncMsvYr: radMsv * 0.188, relUncPct: 18.8 };
      const locTi = v.ti !== null ? v.ti : 215, locDust = v.dust !== null ? v.dust : 0.25;
      const locWalkH = +(4.2 + v.slope * 0.11 + (v.rough / 180)).toFixed(1);
      const locBio = SCORING.calcPandolfMars
        ? SCORING.calcPandolfMars({ slopeDeg: v.slope, ti: locTi, sandFrac: Math.max(0, locDust - 0.2) * 0.6, durationH: locWalkH, loadKg: S.evaSim ? S.evaSim.loadKg : 15, speedKmh: S.evaSim ? S.evaSim.speedKmh : 2.4, buddyMode: S.evaSim ? S.evaSim.buddyMode : 'buddy' })
        : { metabolicW: 265, metabolicKcalH: 228, o2RemainPct: 72, waterUsedL: 1.35, co2ScrubberUsedPct: 38, returnReserveProtected: true, walkbackRadiusM: 760 };
      const locO2Rem = locBio.o2RemainPct;
      const locWaterL = locBio.waterUsedL;
      const locCo2Used = locBio.co2ScrubberUsedPct ?? 38;
      const locRsvOk = locBio.returnReserveProtected !== false;
      const locDoseMsv = (radMsv / (365.25 * 24) * locWalkH).toFixed(3);
      const evaMatchesLoc = !!(S.evaSim && S.evaSim.zone && Math.hypot((S.evaSim.zone.lat || 0) - v.lat, (S.evaSim.zone.lon || 0) - v.lon) < 5.5);
      const dispWalkbackM = evaMatchesLoc ? S.evaSim.walkbackRadiusM : locBio.walkbackRadiusM;
      const dispKcalH = evaMatchesLoc ? S.evaSim.metabolicKcalH : locBio.metabolicKcalH;
      const dispO2Rem = evaMatchesLoc ? S.evaSim.o2RemainPct : locBio.o2RemainPct;
      const dispPriorPct = evaMatchesLoc ? S.evaSim.orbitalConfidencePct : 34;
      const dispAssimPct = evaMatchesLoc ? S.evaSim.assimilatedConfidencePct : 94;
      const disp5dScore = (evaMatchesLoc && S.evaSim.domainScores) ? S.evaSim.domainScores.composite : +(Math.max(35, Math.min(96, s * 100))).toFixed(1);
      const plainSummary = buildPlainSummary(v, vetoed, passElev, passSlope, passLat, ice, nr, radMsv, tr);

      el.innerHTML = `
        <div class="detail-header">
          <div>
            <div class="hint">${escHtml(t('compositeSuit', 'Composite suitability'))}</div>
            <div class="big">${s.toFixed(3)}</div>
          </div>
          <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${escHtml(vetoed ? t('vetoed', 'Vetoed') : t('withinConstraints', 'Within constraints'))}</span>
        </div>
        <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${nr.distDeg < 6 ? escHtml(nr.region.name) : (tr ? escHtml(nr.region.name) + ' yakını' : 'near ' + escHtml(nr.region.name))} · ${(nr.distDeg * 59.3).toFixed(0)} km</div>
        <div class="plain-verdict ${vetoed ? 'bad' : 'ok'}"><span class="plain-verdict-title">${tr ? 'Bir bakışta özet' : 'Plain summary'}</span><p>${escHtml(plainSummary)}</p></div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">${tr ? 'Rakım ≤ +2 km' : 'Elevation ≤ +2 km'}</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Eğim ≤ 15°' : 'Slope ≤ 15°'}</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Enlem ≤ 50°' : 'Latitude ≤ 50°'}</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
        </div>
        ${critRowsHTML(v, S.weights, { SCORING, escHtml })}
        <table>
          <tr><td>${tr ? 'MOLA Rakım' : 'MOLA Elevation'}</td><td>${v.elev.toFixed(0)} m</td></tr>
          <tr><td>${tr ? 'MOLA %90 Eğim' : 'MOLA 90th-pct Slope'}</td><td>${v.slope.toFixed(1)}°</td></tr>
          <tr><td>${tr ? 'SWIM Buz Tutarlılığı' : 'SWIM Ice Consistency'} (${escHtml(iceTab)})</td><td>${v.ice === null ? (tr ? 'VERİ YOK (±60° dışı — buz yokluğu anlamına gelmez)' : 'NO_DATA (outside ±60° — distinct from ice-free)') : v.ice.toFixed(2) + ' <small>(' + (tr ? 'tutarlılık indeksi, kesin buz değil' : 'consistency index, not ice core') + ')</small>'}</td></tr>
          <tr><td>${tr ? 'Buz erişimi' : 'Ice access'} (${escHtml(ice.depth)})</td><td><b>${escHtml(trDom(ice.label))}</b></td></tr>
          <tr><td>${tr ? 'Mürettebat suyu için kazı' : 'Excavation for crew water'}</td><td>${ice.regolithKgSol === null ? '—' : `~${ice.regolithKgSol} kg ${tr ? 'regolit/sol' : 'regolith/sol'} <small>(${tr ? 'varsayım: ' : 'assumes '}${escHtml(trDom(ice.assumption))}${tr ? '; SWIM derişim ölçmez' : '; SWIM does not measure concentration'})</small>`}</td></tr>
          <tr><td>${tr ? 'Hücre-içi Pürüzlülük (σ)' : 'Sub-cell Roughness (σ)'}</td><td>${v.rough.toFixed(0)} m</td></tr>
          <tr><td>${tr ? 'Bölgesel arazi sınıfı' : 'Regional terrain class'}</td><td><b class="${terrain.terrainClass === 'RUGGED' ? 'bad' : terrain.terrainClass === 'MODERATE' ? 'warn' : 'ok'}">${escHtml(trDom(terrain.label))}</b></td></tr>
          <tr><td>${tr ? 'Elips-ölçekli tehlikeler' : 'Ellipse-scale hazards'}</td><td><small>${escHtml(trDom(terrain.recommendation))}</small></td></tr>
          <tr><td>${tr ? 'TES Termal Atalet' : 'TES Thermal Inertia'}</td><td>${v.ti === null ? (tr ? 'veri yok' : 'no data') : `${v.ti.toFixed(0)} J m⁻² K⁻¹ s⁻½ <small>(${tr ? 'tane boyutu/sertlik termofizik göstergesi — taşıma kapasitesi değildir' : 'thermophysical grain-size/induration proxy — NOT bearing capacity'})</small>`}</td></tr>
          <tr><td>${tr ? 'TES Toz Yoğunluğu' : 'TES Dust Abundance'}</td><td>${v.dust === null ? (tr ? 'veri yok' : 'no data') : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
          <tr><td>${tr ? 'Atmosferik Sütun' : 'Atmospheric Column'}</td><td>${SCORING.atmoColumnGcm2(v.elev).toFixed(1)} g/cm²</td></tr>
          <tr><td>${tr ? 'En yakın mağara adayı' : 'Nearest cave candidate'}</td><td>${caveStr} <small>(${tr ? 'MGC³ termal/optik kontrast · doğrulanmamış' : 'MGC³ thermal/optical contrast · unconfirmed'})</small></td></tr>
          <tr><td>${tr ? 'GCR Dozu (MSL-RAD Gale Ref)' : 'GCR Dose (MSL-RAD Gale Ref)'}</td><td><b>${radBand.nominal.toFixed(0)} ± ${radBand.uncMsvYr.toFixed(0)} mSv/yr</b> (±${radBand.relUncPct}%) <small>(${radBand.min.toFixed(0)}–${radBand.max.toFixed(0)} mSv/yr ${tr ? 'belirsizlik aralığı' : 'uncertainty band'})</small></td></tr>
          <tr><td>${tr ? 'Tasarım SPE dozu (varsayım)' : 'Design-basis SPE (assumption)'}</td><td>${spe.unshieldedDoseMsv} mSv ${tr ? 'yüzeyde' : 'on the surface'} · ${spe.requiredRegolithM} m ${tr ? 'regolit (≤100 mSv için)' : 'regolith for ≤ 100 mSv'}</td></tr>
          <tr><td>${tr ? 'Yüzey sıcaklığı (yakl.)' : 'Surface temp. (approx.)'}</td><td>${tr ? 'gece' : 'night'} ${sTemp.night.toFixed(0)} °C · ${tr ? 'ort' : 'mean'} ${sTemp.mean.toFixed(0)} °C</td></tr>
          <tr><td>${tr ? 'Habitat ısı kaybı' : 'Habitat heat loss'}</td><td>${pTherm} kW (${tr ? 'önce elektrik yükü atık ısısıyla karşılanır' : 'covered by waste heat of the electrical load first'})</td></tr>
          <tr><td>${tr ? 'xEMU Referans (Ay→Mars) Dönüş & CO₂' : 'xEMU Ref. (Lunar→Mars) Walkback & CO₂'}</td><td><b>${dispWalkbackM} m</b> · ${dispKcalH} kcal/h · O₂ ${dispO2Rem}% · CO₂ RCA ${locCo2Used}% · RSV ${locRsvOk ? '✓ %25' : '⚠'}</td></tr>
          <tr><td>${tr ? 'Uydu Öncülü vs TRN+AutoNav+MGL (xGDS)' : 'Orbital Prior vs TRN+AutoNav+MGL (xGDS)'}</td><td>Prior <b>${dispPriorPct}%</b> → In-Situ <b>${dispAssimPct}%</b> · 5-Domain <b>${disp5dScore}/100</b></td></tr>
          ${typeof STORM.predictDustML === 'function' ? (() => {
            const mp = STORM.predictDustML({ lat: v.lat, lon: v.lon, elev: v.elev, slope: v.slope, ti: v.ti, dust: v.dust, ls: S.crisis.ls });
            return `<tr><td>${tr ? 'PIML Toz/Vorteks Tahmini (1-dk)' : 'PIML Dust/Vortex Forecast (1-min)'}</td><td>+1m <b>${mp.horizons[0].probPct}%</b> · +6m <b>${mp.horizons[1].probPct}%</b> · +1Sol <b class="${mp.horizons[3].cls}">${mp.horizons[3].probPct}%</b></td></tr>`;
          })() : ''}
        </table>
        <div class="marswalk-micro-card">
          <div class="marswalk-micro-head">
            <b>${tr ? 'Yerel HiRISE / Marswalk Mikro-Planlama Özeti' : 'Local HiRISE / Marswalk Micro-Planning Summary'}</b>
            <span class="badge-mode badge-live">1.0–2.0 m/post · ≤ 8h EVA</span>
          </div>
          <div class="help note-sm">${tr
            ? `${escHtml(nr.region.name)} çevresinde yaya astronot yürüyüşü (2.4 km/sa; 5 km/px küresel harita yerine HiRISE stereo DTM gerektirir): <b>SWIM 2.0 Buz Tutarlılık Anomalisi (Doğrulanmamış)</b> (${v.ice === null ? 'veri yok / soğuk tuzak' : v.ice.toFixed(2)}), <b>Kırık Sırtları</b> ve <b>TES Termofizik Mostrası</b> (${v.ti === null ? '—' : v.ti.toFixed(0)} tiu) duraklarını kapsar.`
            : `Foot astronaut surface walk (2.4 km/h; requires HiRISE stereo DTM instead of 5 km/px global grid) near ${escHtml(nr.region.name)}: targeting <b>SWIM 2.0 Ice-Consistency Anomaly (Unconfirmed)</b> (${v.ice === null ? 'NO_DATA' : v.ice.toFixed(2)}), <b>Boxwork Fracture Ridges</b>, and <b>TES Thermophysical Outcrop</b> (${v.ti === null ? '—' : v.ti.toFixed(0)} tiu).`}</div>
          <div class="kv"><span>${tr ? 'Tahmini EVA Süresi & Limit' : 'Est. Marswalk Duration & Limit'}</span><b class="${locWalkH <= 8.0 ? 'ok' : 'warn'}">${locWalkH} h / 8.0 h max EVA ${locWalkH <= 8.0 ? '✓' : '⚠'}</b></div>
          <div class="kv"><span>${tr ? 'PLSS O₂ / Soğutma / CO₂ RCA / Rezerv' : 'PLSS O₂ / Cooling / CO₂ RCA / Reserve'}</span><b>O₂ ${locO2Rem}% · ${locWaterL} L H₂O · CO₂ ${locCo2Used}% · RSV ${locRsvOk ? '✓ %25' : '⚠'} · ${locDoseMsv} ± ${(locDoseMsv * 0.188).toFixed(3)} mSv</b></div>
        </div>
        <div class="row">
          <button id="plan-marswalk-btn" class="btn-spec btn-full">${escHtml(tr ? 'Bu Sahada Marswalk Rotası Planla (A* + Bilim POI)' : 'Plan Marswalk at this Site (A* + Science POIs)')}</button>
          <button id="use-eva" class="btn-spec btn-full">${escHtml(t('zoomLocalEva', tr ? 'Yerel EVA Bölgesine Yakınlaş (1 m/px) & HUD' : 'Zoom to Local EVA Zone (1 m/px) & HUD'))}</button>
          <button id="use-route" class="ghost">${escHtml(t('startRouteHere', 'Start a route here'))}</button>
          <button id="use-crisis" class="ghost">${escHtml(t('useStormModel', 'Use in storm model'))}</button>
        </div>`;
      if ($('#plan-marswalk-btn')) $('#plan-marswalk-btn').onclick = () => { if (onPlanMarswalk) onPlanMarswalk(x, y, v, nr.region.name); else if (onUseRoute) onUseRoute(x, y); };
      if ($('#use-eva')) $('#use-eva').onclick = () => { if (onUseEva) onUseEva(x, y, v, nr.region.name); };
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
      const evaSim = S.evaSim || { o2UsedPct: 28, o2RemainPct: 72, battUsedPct: 24, battRemainPct: 76, co2ScrubberUsedPct: 36, returnReserveProtected: true, loadKg: 15, metabolicKcalH: 278, metabolicW: 323, walkbackRadiusM: 1380, effSpeedKmh: 2.4 };
      const ev = b.evaStats || {
        sortieKm: 12.0, walkHours: 6.2, maxEvaLimitH: 8.0, withinEvaLimit: true, evaSorties: Math.max(1, Math.ceil(b.km / 14)),
        metabolicW: 318, metabolicKcalH: 273, sortieKcal: 1692, o2UsedG: 503, o2UsedPct: 59, o2RemainPct: 41,
        waterUsedL: 2.11, waterUsedPct: 56, waterRemainPct: 44, co2ScrubberUsedPct: 46, returnReserveProtected: true,
        evaRestIntervalKm: 1.5, evaRestCount: 8, radDoseMsv: 0.168, radUncMsvYr: 44, corridorRadDoseMsv: 1.42
      };
      const evDir = (a && a.evaStats) || { walkHours: 6.8, metabolicKcalH: 312, o2UsedPct: 68, radDoseMsv: 0.195 };
      const sciWps = b.scienceWaypoints || [];
      const sciScore = b.scienceScore || 92;
      const isMarswalk = r.travelMode === 'marswalk';
      const evaSpeedKmh = +(evaSim.effSpeedKmh || 2.4);
      const havenStr = !isMarswalk && havens.length
        ? havens.map(h => `${h.name} (${h.km} km · Sol ${Math.round(h.km / r.speed)} · ${tr ? 'Rover 200km' : 'Rover 200km'})`).join(', ')
        : isMarswalk
          ? (tr ? `Yaya EVA modunda 200 km rover durakları devre dışı — her ${ev.evaRestIntervalKm || 1.5} km’de ~${ev.evaRestCount || Math.max(1, Math.round(ev.sortieKm / 1.5))} kısa mola & ${(ev.sortieKm * 0.5).toFixed(1)} km’de zorunlu geri dönüş`
            : `200 km rover stops disabled in Foot EVA mode — ~${ev.evaRestCount || Math.max(1, Math.round(ev.sortieKm / 1.5))} micro-rests every ${ev.evaRestIntervalKm || 1.5} km & mandatory turnaround at ${(ev.sortieKm * 0.5).toFixed(1)} km`)
          : (tr ? 'Tespit edilmedi' : 'None detected');
      const hzSummary = b.hazardZones && b.hazardZones.summary ? b.hazardZones.summary : `${b.hazardKm.toFixed(0)} km >10° · ${(b.dustKm || 0).toFixed(0)} km <100 tiu`;
      const retInfo = b.returnRoute || { returnKm: b.km, returnAscentM: b.totalDescentM || 0, returnDescentM: b.totalAscentM || 0, roundTripKm: b.km * 2 };

      const sciRowsHtml = sciWps.map((wp, idx) => `
        <div class="eva-wp-card route-poi-card" data-poi-idx="${idx}" role="button" tabindex="0">
          <div class="eva-wp-head">
            <b>${escHtml(wp.id)} · ${escHtml(tr ? wp.nameTr : wp.name)}</b>
            <span class="badge-mode badge-live">+${wp.sciGain} SCI · km ${wp.km}</span>
          </div>
          <div class="help note-sm">${escHtml(tr ? wp.targetTr : wp.target)}</div>
          <div class="help note-sm">${wp.lat != null && wp.lon != null ? `Coord ${wp.lat.toFixed(2)}°, ${wp.lon.toFixed(2)}° · ` : ''}Elev ${wp.elev} m · Slope ${wp.slope}° · TI ${wp.ti} tiu · SWIM ${wp.ice === null ? 'NO_DATA' : wp.ice}</div>
          ${wp.dataset ? `<div class="help note-sm"><b>${escHtml(wp.dataset)}</b>${wp.obsDate ? ` · ${escHtml(wp.obsDate)}` : ''}</div>` : ''}
        </div>`).join('');

      el.innerHTML = `
        <div class="marswalk-mode-banner ${isMarswalk ? 'active' : ''}">
          <b>${isMarswalk ? (tr ? `AKTİF MOD: Astronot Yaya EVA / Marswalk (${evaSpeedKmh.toFixed(1)} km/sa · 200km Rover Molaları Kapalı)` : `ACTIVE MODE: Astronaut Foot EVA / Marswalk (${evaSpeedKmh.toFixed(1)} km/h · Rover 200km Stops Off)`) : (tr ? `AKTİF MOD: Basınçlı Rover (${r.speed} km/sol) + ≤8sa EVA Sortileri` : `ACTIVE MODE: Pressurized Rover (${r.speed} km/sol) + ≤8h EVA Sorties`)}</b>
          <span class="badge-mode badge-live">${tr ? `BİLİM KAZANIMI: ${sciScore}/100` : `SCIENCE GAIN: ${sciScore}/100`}</span>
        </div>
        <div class="help note-sm">${tr ? '⚠ Küresel A* ~5 km/px MOLA gridinde çalışır; metre-ölçekli kaya/krater tespiti için Modül III (HiRISE 1.0–2.0 m/post) yerel rotalamasını kullanın.' : '⚠ Global A* runs on the ~5 km/px MOLA grid; meter-scale boulder/crater avoidance requires Module III HiRISE 1.0–2.0 m/post local routing.'}</div>
        <table class="stat-table"><tr><th>${tr ? 'Metrik' : 'Metric'}</th><th class="straight">${tr ? 'Doğrudan' : 'Direct'}</th><th class="safe">${tr ? 'A* Güvenli' : 'A* Safe'}</th></tr>
        <tr><td>${tr ? 'Toplam Mesafe' : 'Total Distance'}</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
        <tr><td>${tr ? 'Toplam Tırmanış / İniş' : 'Total Ascent / Descent'}</td><td>+${a.totalAscentM || 0} / -${a.totalDescentM || 0} m</td><td><b>+${b.totalAscentM || 0} m / -${b.totalDescentM || 0} m</b></td></tr>
        <tr><td>${tr ? 'Tepe Eğim (Model Sınırı ' + r.maxSlope + '°)' : 'Peak Slope (Model Limit ' + r.maxSlope + '°)'}</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
        <tr><td>${tr ? 'Ortalama Eğim & Tehlike Özeti' : 'Mean Slope & Hazard Summary'}</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}° <small>(${escHtml(hzSummary)})</small></td></tr>
        <tr><td>${tr ? '&gt;10° Eğim &amp; Gevşek Toz (&lt;100 tiu)' : 'Slope &gt;10° &amp; Loose Dust (&lt;100 tiu)'}</td><td>${a.hazardKm.toFixed(0)} / ${(a.dustKm || 0).toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} / ${(b.dustKm || 0).toFixed(0)} km</td></tr>
        <tr><td>${tr ? (isMarswalk ? 'Yaya EVA Hızı & Toplam Yürüyüş' : 'Basınçlı Rover Geçiş Süresi') : (isMarswalk ? 'Foot EVA Pace & Total Time' : 'Pressurized Rover Transit')}</td><td>${isMarswalk ? `${(a.km / evaSpeedKmh).toFixed(1)} h @ ${evaSpeedKmh.toFixed(1)} km/h` : `${sols(a.km)} sols @ ${r.speed} km/sol`}</td><td><b>${isMarswalk ? `${(b.km / evaSpeedKmh).toFixed(1)} h (${ev.evaSorties}×≤8h EVA)` : `${sols(b.km)} sols @ ${r.speed} km/sol`}</b></td></tr>
        <tr><td>${tr ? 'EVA Sorti Süresi & Dönüş Limiti' : 'EVA Sortie Time & Turnaround'}</td><td>${evDir.walkHours} h/sortie</td><td class="${ev.withinEvaLimit ? 'ok' : 'warn'}"><b>${ev.walkHours} h / ${ev.maxEvaLimitH.toFixed(1)} h</b> (${ev.evaRestCount || 8} ${tr ? 'kısa mola' : 'micro-rests'})</td></tr>
        <tr><td>${tr ? 'PLSS Yaşam Desteği (O₂/H₂O/CO₂/Rezerv)' : 'PLSS Life Support (O₂/H₂O/CO₂/Rsv)'}</td><td>O₂ ${evDir.o2UsedPct}%</td><td class="${ev.returnReserveProtected !== false ? 'ok' : 'warn'}"><b>O₂ ${ev.o2UsedG}g (${ev.o2UsedPct}%) · ${ev.waterUsedL}L H₂O · CO₂ RCA ${ev.co2ScrubberUsedPct ?? 46}%</b> · RSV ${ev.returnReserveProtected !== false ? '✓ ≥25%' : '⚠'}</td></tr>
        <tr><td>${tr ? 'Metabolik Yük & Dönüş Yarıçapı' : 'Metabolic Load & Walkback'}</td><td>${evDir.metabolicKcalH} kcal/h</td><td class="ok"><b>${ev.metabolicKcalH} kcal/h</b> (${ev.metabolicW} W) · Walkback <b>${evaSim.walkbackRadiusM} m</b></td></tr>
        <tr><td>${tr ? 'Dönüş Rotası (Emniyet Koridoru)' : 'Return Route (Safety Corridor)'}</td><td>—</td><td class="ok"><b>${retInfo.returnKm.toFixed(0)} km</b> (+${retInfo.returnAscentM} / -${retInfo.returnDescentM} m · ≥25% RSV)</td></tr>
        <tr><td>${tr ? 'Radyasyon Dozu (MSL-RAD ±%18.8)' : 'Radiation Dose (MSL-RAD ±18.8%)'}</td><td>${evDir.radDoseMsv} mSv</td><td class="ok"><b>${ev.radDoseMsv} ± ${(ev.radDoseMsv * 0.188).toFixed(3)} mSv</b>/sortie (${ev.corridorRadDoseMsv} mSv tol)</td></tr>
        <tr><td>${tr ? 'TRN+AutoNav+MGL (xGDS 5-Alan)' : 'TRN+AutoNav+MGL (xGDS 5-Domain)'}</td><td>Prior ${evaSim.orbitalConfidencePct ?? 34}% (${evaSim.orbitalHazardHits ?? 0} risk)</td><td class="ok"><b>${evaSim.assimilatedConfidencePct ?? 95}%</b> · 5D ${evaSim.domainScores ? evaSim.domainScores.composite : 78}/100 · MGL ±${evaSim.navStack && evaSim.navStack.mgl ? evaSim.navStack.mgl.mglCorrectedErrorM : 1.8}m</td></tr>
        <tr><td>${tr ? 'Rota Bilimsel Kazanım Skoru' : 'Route Science Gain Score'}</td><td>—</td><td class="ok"><b>${sciScore} / 100 pts</b> (${sciWps.length} POI)</td></tr></table>
        <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? (tr ? `Doğrudan hat ${a.maxSlope.toFixed(1)}° eğimi aşıyor (model sınırı ${r.maxSlope}°, zemin sürtünmesine göre uyarlanır). Güvenli rota +${(b.km - a.km).toFixed(0)} km ekler.` : `Direct path crosses ${a.maxSlope.toFixed(1)}° terrain (model limit ${r.maxSlope}°, soil-adjusted). Safe route adds ${(b.km - a.km).toFixed(0)} km.`) : (tr ? 'Doğrudan hat modelin azami eğim sınırını sağlıyor.' : 'Direct path satisfies model maximum slope limit.')}</div>
        ${sciWps.length ? `<div class="sec-head mt-sm"><h2>${tr ? 'Rota Üzerindeki Bilimsel Hedef Noktaları (Koordinat + Veri Kaynağı)' : 'Science Waypoints Along Route (Coord + Dataset + Visor HUD)'}</h2></div><div class="eva-wp-list">${sciRowsHtml}</div>` : ''}
        <div class="help haven-note"><b>${isMarswalk ? (tr ? 'YAYA EVA MOLA & DÖNÜŞ PLANI' : 'FOOT EVA REST & TURNAROUND PLAN') : (tr ? 'ROVER 200 KM MOLA NOKTALARI (YALNIZCA BASINÇLI ROVER)' : 'ROVER 200 KM REST STOPS (PRESSURIZED ROVER ONLY)')}: </b>${escHtml(havenStr)}</div>
        <div class="hint mt-sm">${tr ? 'Güvenli rota boyunca yükselti profili' : 'Elevation profile along the safe route'} · ${(r.ms || 0).toFixed(0)} ms, ${r.safe.path.length} ${tr ? 'hücre' : 'cells'}</div>${CHARTS.profileSVG(b.profile)}`;
      el.querySelectorAll('.route-poi-card').forEach(card => {
        const openPoi = () => { if (onOpenHud) onOpenHud(+card.dataset.poiIdx); };
        card.onclick = openPoi;
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPoi(); } };
      });
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
        lat: v.lat, ls: c.ls, ti: v.ti, elev: v.elev, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
        storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 },
      });
      const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, 0.5, c.ls);
      const peakSolar = c.area * 0.2 * STORM.dailySolar(v.lat, c.tauPeak, c.ls);
      const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
      const sTemp = STORM.surfaceTempC(v.lat, c.ls, v.ti, v.elev);
      const pTherm = STORM.thermalDemandKw(v.lat, c.ls, v.ti, v.elev);
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

      const activeRegime = c.mlRegime || 'auto';
      const mlPred = typeof STORM.predictDustML === 'function'
        ? STORM.predictDustML({
            lat: v.lat, lon: v.lon, elev: v.elev, slope: v.slope, ti: v.ti, dust: v.dust,
            ls: c.ls, tauPeak: c.tauPeak, telemetryRegime: activeRegime
          })
        : null;
      const mlCardHtml = mlPred ? `
        <div class="marswalk-micro-card">
          <div class="marswalk-micro-head">
            <b>${tr ? 'PIML Çoklu-Ufuk Toz & Vorteks Tahmin Motoru (1-dk Akış)' : 'PIML Multi-Horizon Dust & Vortex Forecaster (1-min Cadence)'}</b>
            <span class="badge-mode badge-live">ACC ${mlPred.overallAccuracyPct}% · AUC ${mlPred.overallRocAuc}</span>
          </div>
          <div class="help note-sm">${tr
            ? `<b>MDAD (22.865 fırtına)</b> + <b>Montabone MY24–MY36</b> + <b>MEDA/TWINS 1-Hz</b> verisiyle eğitilmiş GBDT topluluğu. Aktif Koridor: <b>${escHtml(mlPred.features.corridorNameTr)}</b> (ΔP <code>${mlPred.features.deltaP1mPa} Pa/dk</code> · u*/u*t <code>${mlPred.features.bagnoldRatio}</code> · Ri<sub>b</sub> <code>${mlPred.features.bulkRichardson}</code>).`
            : `Physics-Informed GBDT trained on <b>MDAD (22,865 storms)</b> + <b>Montabone MY24–MY36</b> + <b>MEDA/TWINS 1-Hz</b>. Corridor: <b>${escHtml(mlPred.features.corridorName)}</b> (ΔP <code>${mlPred.features.deltaP1mPa} Pa/m</code> · u*/u*t <code>${mlPred.features.bagnoldRatio}</code> · Ri<sub>b</sub> <code>${mlPred.features.bulkRichardson}</code>).`}</div>
          <div class="eva-sim-btns">
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'auto' ? 'btn-spec' : ''}" data-ml-regime="auto">${tr ? 'Saha/Mevsim (Otonom)' : 'Site/Season (Auto)'}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'vortex_imminent' ? 'btn-spec' : ''}" data-ml-regime="vortex_imminent">${tr ? '+1 dk Vorteks Darbesi' : '+1m Vortex Strike'}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'precursor' ? 'btn-spec' : ''}" data-ml-regime="precursor">${tr ? '+6..15 dk Öncül' : '+6..15m Precursor'}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'clear_calm' ? 'btn-spec' : ''}" data-ml-regime="clear_calm">${tr ? 'Açık Gök Kontrol' : 'Clear Calm'}</button>
          </div>
          ${mlPred.horizons.map(h => `
            <div class="kv">
              <span><b>${escHtml(tr ? h.horizonTr : h.horizonEn)}</b> <small>(${escHtml(h.keyMetric)} · Acc ${h.validationAccuracyPct}%)</small></span>
              <b class="${h.cls}">${h.probPct}% · ${escHtml(tr ? h.statusTr : h.statusEn)}</b>
            </div>`).join('')}
          <div class="help note-sm">${escHtml(tr ? mlPred.peakHorizon.actionTr : mlPred.peakHorizon.actionEn)}</div>
        </div>` : '';

      el.innerHTML = `${verdict}
        ${thermVerdict}
        ${mlCardHtml}
        <div class="kv"><span>${tr ? 'Mevsim' : 'Season'} (L<sub>s</sub> = ${c.ls}°)</span><b>${escHtml(trDom(STORM.seasonName(c.ls)))}</b></div>
        <div class="kv"><span>${tr ? 'Yüzey sıcaklığı (yakl.)' : 'Surface temp. (approx.)'}</span><b>${tr ? 'gece' : 'night'} ${sTemp.night}°C · ${tr ? 'ort' : 'mean'} ${sTemp.mean}°C</b></div>
        <div class="kv"><span>${tr ? 'Habitat ısı kaybı' : 'Habitat heat loss'}</span><b>${pTherm} kW · ${tr ? 'ek ısıtıcı' : 'extra heaters'} ${Math.max(...res.rows.map(r => r.heater)).toFixed(0)} kWh/sol max</b></div>
        <div class="kv"><span>${tr ? 'Açık gök güneş, τ 0.5' : 'Clear-sky solar, τ 0.5'}</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
        <div class="kv"><span>${tr ? 'Fırtına zirvesi, τ' : 'Peak-storm solar, τ'} ${c.tauPeak.toFixed(1)}</span><b>${peakSolar.toFixed(0)} kWh/sol (−${res.peakSolarDropPct.toFixed(0)}%)</b></div>
        <div class="kv"><span>${tr ? `${res.rows.length} sol sonrası toz kaybı` : `Panel dust after ${res.rows.length} sols`}</span><b>−${res.postStormSolarLossPct}% (${tr ? 'temizlik yok' : 'no cleaning events assumed'})</b></div>
        <div class="kv"><span>${tr ? 'Kilopower baz yük' : 'Kilopower baseload'}</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
        <div class="kv kv-top"><span>${tr ? 'Yüzeyde tasarım SPE dozu' : 'Design-basis SPE on surface'}</span><b>${spe.unshieldedDoseMsv} mSv</b></div>
        <div class="kv"><span>${tr ? `Siperli (${(c.regolith ?? 1.5).toFixed(1)}m regolit)` : `Shielded (${(c.regolith ?? 1.5).toFixed(1)}m regolith)`}</span><b class="${spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad'}">${spe.shieldedDoseMsv} mSv (${escHtml(trDom(spe.survivalStatus))})</b></div>
        <div class="kv"><span>${tr ? '≤ 100 mSv için regolit' : 'Regolith for ≤ 100 mSv'}</span><b>${spe.requiredRegolithM} m</b></div>
        <div class="help note-sm">${tr ? 'SPE değerleri varsayımsal Ağustos-1972 benzeri olayı (~1 Sv / 5 g/cm²) esas alır; anlık tahmin değildir.' : 'SPE figures use an assumed August-1972-class event (~1 Sv behind 5 g/cm²), not a forecast. Largest SPE measured on the surface so far (Sept 2017, MSL/RAD): ~0.4 mGy.'}</div>
        ${liveCmeRow}
        ${CHARTS.crisisSVG(res.rows, c.batt)}
        <div class="help mt-sm">${tr ? 'Profil: Sol 20 başlangıç · 10-sol artış · 40-sol plato · 30-sol azalış.' : 'Profile: Sol 20 onset · 10-sol ramp · 40-sol plateau · 30-sol decay.'} ${c.kp === 0 && res.blackoutSol !== null ? (tr ? 'Yük ve ısıtmayı ayakta tutmak için fisyon (Kilopower, 10 kWe hedefi) ekleyin.' : 'Add fission power (Kilopower-class, 10 kWe design target) to keep the load and heating running.') : ''}</div>`;
      el.querySelectorAll('.ml-regime-btn').forEach(btn => {
        btn.onclick = () => {
          c.mlRegime = btn.dataset.mlRegime;
          runCrisis();
        };
      });
      announce(res.blackoutSol !== null ? (tr ? `Fırtına simülasyonu: sol ${res.blackoutSol} kesintisi.` : `Storm simulation: blackout on sol ${res.blackoutSol}.`) : (tr ? `Fırtına simülasyonu: üs ${res.minBatt.toFixed(0)} kWh rezerv ile ayakta kalır.` : `Storm simulation: base survives with ${res.minBatt.toFixed(0)} kilowatt-hours reserve.`), doc);
    }

    return { buildPresets, buildSliders, renderCandidates, renderDetail, renderRoute, runCrisis, announce };
  }

  global.MDE_PANELS = { createPanels, critRowsHTML, announce };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
