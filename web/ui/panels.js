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
  // All EN/TR copy lives in ui/i18n.js (STRINGS.en / STRINGS.tr, 'pn.*' keys).
  // L(flag, key, args) picks the TR text when flag is truthy, else EN, filling {0}, {1}, ... from args.
  const getI18NStrict = () => getI18N() || (typeof require === 'function' ? require('./i18n.js').MDE_I18N : null);
  const L = (flag, key, args) => getI18NStrict().pick(flag, key, args);
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
    const noData = L(isTr(), 'pn.noData');
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
    if (!passElev) fails.push(L(tr, 'pn.elevationTooHigh2Km'));
    if (!passSlope) fails.push(L(tr, 'pn.terrainTooSteep15'));
    if (!passLat) fails.push(L(tr, 'pn.tooFarFromEquator50'));
    const lead = vetoed
      ? (L(tr, 'pn.outsideLandingSafetyLimits', [fails.join(', ')]))
      : (L(tr, 'pn.thisAreaNearMeetsCore', [nr.region.name]));
    const elevNote = v.elev <= 0
      ? (L(tr, 'pn.lowElevationLeavesThickerAir'))
      : (L(tr, 'pn.higherGroundLeavesThinnerAir'));
    const slopeNote = v.slope <= 5
      ? (L(tr, 'pn.groundIsMostlyFlatFor'))
      : (L(tr, 'pn.slopeRequiresCarefulTargeting', [v.slope.toFixed(1)]));
    const iceSt = ice ? ice.status : 'NO_DATA';
    const iceNote = iceSt === 'LIKELY'
      ? (L(tr, 'pn.strongSignsOfBuriedWater'))
      : iceSt === 'POSSIBLE'
        ? (L(tr, 'pn.moderateSignsOfBuriedWater'))
        : iceSt === 'NO_DATA'
          ? (L(tr, 'pn.outsideSubsurfaceWaterIceMapping'))
          : (L(tr, 'pn.littleEvidenceOfShallowWater'));
    const radNote = L(tr, 'pn.cosmicRadiationMsvYr', [radMsv.toFixed(0)]);
    return `${lead} ${elevNote} ${slopeNote} ${iceNote} ${radNote}`;
  }

  function createPanels(ctx) {
    const {
      doc = global.document, S, layers, SCORING, STORM, FMT, CHARTS,
      onRescore, onSelect, onUseRoute, onUseCrisis, onUseEva, onPlanMarswalk, onGlobeFly,
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
        d.innerHTML = `<div class="lbl"><span class="lbl-left">${escHtml(clabel)}</span><b>${(wn[c.key] * 100).toFixed(0)}%</b></div><input type="range" min="0" max="100" value="${Math.round(S.weights[c.key] * 100)}" aria-label="${escHtml(clabel)} ${L(tr, 'pn.importance')}">`;
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
        li.setAttribute('aria-label', `${name}, ${L(tr, 'pn.score')} ${c.score.toFixed(2)}`);
        const robustCi = (c.robust != null && SCORING.wilson95CI)
          ? SCORING.wilson95CI(Math.round(c.robust * 100), 100)
          : null;
        const ciLo = robustCi ? (Array.isArray(robustCi) ? robustCi[0] : robustCi.low) : null;
        const ciHi = robustCi ? (Array.isArray(robustCi) ? robustCi[1] : robustCi.high) : null;
        const robustTag = c.robust != null
          ? ` · <span class="robust ${c.robust >= 0.8 ? 'ok' : c.robust >= 0.5 ? 'warn' : 'bad'}">${L(tr, 'pn.stable')} ${(c.robust * 100).toFixed(0)}%${ciLo != null ? ` (95% CI ${(ciLo * 100).toFixed(0)}–${(ciHi * 100).toFixed(0)}%, N=100)` : ''}</span>`
          : '';
        const iceDisplay = ice.status === 'NO_DATA'
          ? (L(tr, 'pn.noDataOutside60'))
          : trDom(ice.status).toLowerCase().replace(/_/g, ' ');
        const cutEng = global.MDE_TACTICAL_EVA_ENGINE;
        const cutDb = global.MDE_EVA_CUTOUTS;
        const hitCutout = (cutEng && cutDb && cutEng.findPresetCutout) ? cutEng.findPresetCutout(cutDb, v.lat, v.lon) : null;
        const resBadge = hitCutout
          ? `<span class="flag">${L(tr, 'pn.highRes100200M')}</span>`
          : `<span class="flag">${L(tr, 'pn.coarse5Km')}</span>`;
        li.innerHTML = `<div class="head"><div class="head-left"><span class="rank">0${i + 1}</span><span class="name">${escHtml(name)}</span>${nr.region.ez && nr.distDeg < 6 ? '<span class="flag ez">NASA EZ</span>' : ''}${resBadge}</div><span class="score">${c.score.toFixed(2)}</span></div>
          <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${L(tr, 'pn.iceConsistency')}: <b>${escHtml(iceDisplay)}</b> · ${(flat * 100).toFixed(0)}% ${L(tr, 'pn.flatGround')}${robustTag}</div>${critRowsHTML(v, S.weights, { SCORING, escHtml })}
          <div class="card-links">
            <button type="button" class="eva-card-btn">${L(tr, 'pn.open16Km2Analysis')}</button>
            <a class="trek" href="${escHtml(trekUrl(v.lat, v.lon))}" target="_blank" rel="noopener">${L(tr, 'pn.nasaMarsTrekHiriseCtx')}</a>
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
      const passWord = L(tr, 'pn.pass'), vetoWord = L(tr, 'pn.veto');
      const nc = layers.nearestCave ? layers.nearestCave(v.lat, v.lon) : null;
      const caveStr = nc
        ? `${escHtml(nc.distKm.toFixed(0) + ' km · ' + nc.type + (nc.diameter ? ' · ~' + nc.diameter + ' m' : ''))} <small>(${L(tr, 'pn.unconfirmedCandidate')})</small>`
        : (L(tr, 'pn.catalogueNotLoaded'));
      const radMsv = SCORING.radDoseMsvYr(v.elev, v.slope || 0);
      const radBand = SCORING.radDoseBand
        ? SCORING.radDoseBand(v.elev, v.slope || 0)
        : { nominal: radMsv, min: radMsv * 0.812, max: radMsv * 1.188, uncMsvYr: radMsv * 0.188, relUncPct: 18.8 };
      const locTi = v.ti !== null ? v.ti : 215, locDust = v.dust !== null ? v.dust : 0.25;
      const locWalkH = 6.5; // planned EVA length (assumption: typical ISS/Apollo EVA ≈ 6.5–7.5 h)
      const locBio = SCORING.calcPandolfMars({ slopeDeg: v.slope, ti: locTi, sandFrac: Math.max(0, locDust - 0.2) * 0.6, durationH: locWalkH, loadKg: 15, speedKmh: 2.4, buddyMode: 'buddy' });
      const locO2Rem = locBio.o2RemainPct;
      const locWaterL = locBio.waterUsedL;
      const locCo2Used = locBio.co2ScrubberUsedPct ?? 38;
      const locRsvOk = locBio.returnReserveProtected !== false;
      const locDoseMsv = (radMsv / (365.25 * 24) * locWalkH).toFixed(3);
      const plainSummary = buildPlainSummary(v, vetoed, passElev, passSlope, passLat, ice, nr, radMsv, tr);

      el.innerHTML = `
        <div class="detail-header">
          <div>
            <div class="hint">${escHtml(t('compositeSuit', 'Composite suitability'))}</div>
            <div class="big">${s.toFixed(3)}</div>
          </div>
          <span class="status-pill ${vetoed ? 'bad' : 'ok'}">${escHtml(vetoed ? t('vetoed', 'Vetoed') : t('withinConstraints', 'Within constraints'))}</span>
        </div>
        <div class="coord">${escHtml(fmtLat(v.lat))}, ${escHtml(fmtLon(v.lon))} · ${nr.distDeg < 6 ? escHtml(nr.region.name) : L(tr, 'pn.nearRegion', [escHtml(nr.region.name)])} · ${(nr.distDeg * 59.3).toFixed(0)} km</div>
        <div class="plain-verdict ${vetoed ? 'bad' : 'ok'}"><span class="plain-verdict-title">${L(tr, 'pn.plainSummary')}</span><p>${escHtml(plainSummary)}</p></div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">${L(tr, 'pn.elevation2Km')}</span><b class="${passElev ? 'ok' : 'bad'}">${passElev ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${L(tr, 'pn.slope15')}</span><b class="${passSlope ? 'ok' : 'bad'}">${passSlope ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
          <div class="hls-check"><span class="hint">${L(tr, 'pn.latitude50')}</span><b class="${passLat ? 'ok' : 'bad'}">${passLat ? '✓ ' + passWord : '✕ ' + vetoWord}</b></div>
        </div>
        ${critRowsHTML(v, S.weights, { SCORING, escHtml })}
        <table>
          <tr><td>${L(tr, 'pn.molaElevation')}</td><td>${v.elev.toFixed(0)} m</td></tr>
          <tr><td>${L(tr, 'pn.mola90thPctSlope')}</td><td>${v.slope.toFixed(1)}°</td></tr>
          <tr><td>${L(tr, 'pn.swimIceConsistency')} (${escHtml(iceTab)})</td><td>${v.ice === null ? (L(tr, 'pn.no_dataOutside60DistinctFrom')) : v.ice.toFixed(2) + ' <small>(' + (L(tr, 'pn.consistencyIndexNotIceCore')) + ')</small>'}</td></tr>
          <tr><td>${L(tr, 'pn.iceAccess')} (${escHtml(ice.depth)})</td><td><b>${escHtml(trDom(ice.label))}</b></td></tr>
          <tr><td>${L(tr, 'pn.excavationForCrewWater')}</td><td>${ice.regolithKgSol === null ? '—' : `~${ice.regolithKgSol} kg ${L(tr, 'pn.regolithSol')} <small>(${L(tr, 'pn.assumes')}${escHtml(trDom(ice.assumption))}${L(tr, 'pn.swimDoesNotMeasureConcentration')})</small>`}</td></tr>
          <tr><td>${L(tr, 'pn.subCellRoughness')}</td><td>${v.rough.toFixed(0)} m</td></tr>
          <tr><td>${L(tr, 'pn.regionalTerrainClass')}</td><td><b class="${terrain.terrainClass === 'RUGGED' ? 'bad' : terrain.terrainClass === 'MODERATE' ? 'warn' : 'ok'}">${escHtml(trDom(terrain.label))}</b></td></tr>
          <tr><td>${L(tr, 'pn.ellipseScaleHazards')}</td><td><small>${escHtml(trDom(terrain.recommendation))}</small></td></tr>
          <tr><td>${L(tr, 'pn.tesThermalInertia')}</td><td>${v.ti === null ? (L(tr, 'pn.noData')) : `${v.ti.toFixed(0)} J m⁻² K⁻¹ s⁻½ <small>(${L(tr, 'pn.thermophysicalGrainSizeIndurationProxy')})</small>`}</td></tr>
          <tr><td>${L(tr, 'pn.tesDustAbundance')}</td><td>${v.dust === null ? (L(tr, 'pn.noData')) : (v.dust * 100).toFixed(0) + ' %'}</td></tr>
          <tr><td>${L(tr, 'pn.atmosphericColumn')}</td><td>${SCORING.atmoColumnGcm2(v.elev).toFixed(1)} g/cm²</td></tr>
          <tr><td>${L(tr, 'pn.nearestCaveCandidate')}</td><td>${caveStr} <small>(${L(tr, 'pn.mgc3ThermalOpticalContrastUnconfirmed')})</small></td></tr>
          <tr><td>${L(tr, 'pn.gcrDoseMslRadGale')}</td><td><b>${radBand.nominal.toFixed(0)} ± ${radBand.uncMsvYr.toFixed(0)} mSv/yr</b> (±${radBand.relUncPct}%) <small>(${radBand.min.toFixed(0)}–${radBand.max.toFixed(0)} mSv/yr ${L(tr, 'pn.uncertaintyBand')})</small></td></tr>
          <tr><td>${L(tr, 'pn.designBasisSpeAssumption')}</td><td>${spe.unshieldedDoseMsv} mSv ${L(tr, 'pn.onTheSurface')} · ${spe.requiredRegolithM} m ${L(tr, 'pn.regolithFor100Msv')}</td></tr>
          <tr><td>${L(tr, 'pn.surfaceTempApprox')}</td><td>${L(tr, 'pn.night')} ${sTemp.night.toFixed(0)} °C · ${L(tr, 'pn.mean')} ${sTemp.mean.toFixed(0)} °C</td></tr>
          <tr><td>${L(tr, 'pn.habitatHeatLoss')}</td><td>${pTherm} kW (${L(tr, 'pn.coveredByWasteHeatOf')})</td></tr>
          <tr><td>${L(tr, 'pn.xemuRefLunarMarsWalkback')}</td><td><b>${locBio.walkbackRadiusM} m</b> · ${locBio.metabolicKcalH} kcal/h · O₂ ${locO2Rem}% · CO₂ RCA ${locCo2Used}% · RSV ${locRsvOk ? '✓ %25' : '⚠'}</td></tr>
          ${typeof STORM.predictDustML === 'function' ? (() => {
            const mp = STORM.predictDustML({ lat: v.lat, lon: v.lon, elev: v.elev, slope: v.slope, ti: v.ti, dust: v.dust, ls: S.crisis.ls });
            return `<tr><td>${L(tr, 'pn.pimlDustVortexForecast1')}</td><td>+1m <b>${Math.round(mp.horizons[0].probPct)}</b> · +6m <b>${Math.round(mp.horizons[1].probPct)}</b> · +1 sol <b class="${mp.horizons[3].cls}">${Math.round(mp.horizons[3].probPct)}</b> /100</td></tr>`;
          })() : ''}
        </table>
        <div class="marswalk-micro-card">
          <div class="marswalk-micro-head">
            <b>${L(tr, 'pn.localHiriseMarswalkMicroPlanning')}</b>
            <span class="badge-mode badge-archive">≤ 8 h EVA</span>
          </div>
          <div class="help note-sm">${L(tr, 'pn.footAstronautWalkCard', [escHtml(nr.region.name), v.ice === null ? L(tr, 'pn.noDataIceAnomaly') : v.ice.toFixed(2), v.ti === null ? '—' : v.ti.toFixed(0)])}</div>
          <div class="kv"><span>${L(tr, 'pn.estMarswalkDurationLimit')}</span><b class="${locWalkH <= 8.0 ? 'ok' : 'warn'}">${locWalkH} h / 8.0 h max EVA ${locWalkH <= 8.0 ? '✓' : '⚠'}</b></div>
          <div class="kv"><span>${L(tr, 'pn.plssO2CoolingCo2Rca')}</span><b>O₂ ${locO2Rem}% · ${locWaterL} L H₂O · CO₂ ${locCo2Used}% · RSV ${locRsvOk ? '✓ %25' : '⚠'} · ${locDoseMsv} ± ${(locDoseMsv * 0.188).toFixed(3)} mSv</b></div>
        </div>
        <div class="row">
          <button id="plan-marswalk-btn" class="btn-spec btn-full">${escHtml(L(tr, 'pn.planMarswalkAtThisSite'))}</button>
          <button id="use-eva" class="btn-spec btn-full">${escHtml(t('zoomLocalEva', L(tr, 'pn.open16Km2Analysis2')))}</button>
          <button id="use-route" class="ghost">${escHtml(t('startRouteHere', 'Start a route here'))}</button>
          <button id="use-crisis" class="ghost">${escHtml(t('useStormModel', 'Use in storm model'))}</button>
        </div>`;
      if ($('#plan-marswalk-btn')) $('#plan-marswalk-btn').onclick = () => { if (onPlanMarswalk) onPlanMarswalk(x, y, v, nr.region.name); else if (onUseRoute) onUseRoute(x, y); };
      if ($('#use-eva')) $('#use-eva').onclick = () => { if (onUseEva) onUseEva(x, y, v, nr.region.name); };
      $('#use-route').onclick = () => onUseRoute(x, y);
      $('#use-crisis').onclick = () => onUseCrisis(x, y, true);
      announce(L(tr, 'pn.selectedSiteAnnounce', [nr.region.name, s.toFixed(2), vetoed ? L(tr, 'pn.vetoedLower') : L(tr, 'pn.withinConstraintsLower')]), doc);
    }

    function renderRoute() {
      const r = S.route, el = $('#route-stats');
      if (!el) return;
      const tr = isTr();
      const VEH = global.MDE_VEHICLES;
      const vehCls = VEH && VEH.classes ? VEH.classes[r.vehicle || 'manned_rover'] : null;
      const noteEl = $('#route-vehicle-note');
      if (noteEl) {
        noteEl.textContent = vehCls
          ? `${tr ? (vehCls.reference_tr || vehCls.reference) : vehCls.reference} · ${vehCls.baseMassKg.value} kg · ${vehCls.power && vehCls.power.defaultMode} · ${vehCls.speedKmh.default} km/h${vehCls.concept ? ' · ' + L(tr, 'pn.rvConcept') : ''}`
          : '';
      }
      if (!r.start) { el.innerHTML = `<div class="verdict">${escHtml(t('routeChooseStart', 'Choose a start point on the map.'))}</div>`; return; }
      if (!r.goal) { el.innerHTML = `<div class="verdict">${escHtml(t('routeChooseGoal', 'Now choose the destination.'))}</div>`; return; }
      if (!r.safe || !r.safe.ok) {
        const msg = r.safe ? r.safe.reason : '';
        el.innerHTML = `<div class="verdict bad">${escHtml(t('routeFail', 'No slope-safe route found'))} (${escHtml(msg)}). ${L(tr, 'pn.increaseSlopeThresholdOrRelocate')}</div>`;
        announce(L(tr, 'pn.noSlopeSafeRoverRoute'), doc);
        return;
      }
      const a = r.straight.stats, b = r.safe.stats;
      // Vehicle-specific traverse estimate (distance, climb work, hotel/heater energy, km per sol).
      const rvMode = r.travelMode !== 'marswalk';
      const LSITE = global.MDE_LANDING_SITE;
      let est = null;
      if (rvMode && vehCls && LSITE && typeof LSITE.traverseEstimate === 'function') {
        const prof = b.profile || [];
        const mid = prof[Math.floor(prof.length / 2)] || prof[0];
        const cv = mid ? layers.cellValues(mid.x, mid.y) : null;
        const meanElevM = prof.length ? prof.reduce((acc, q) => acc + q.elev, 0) / prof.length : 0;
        const tiList = prof.filter((q) => q.ti != null);
        const meanTi = tiList.length ? tiList.reduce((acc, q) => acc + q.ti, 0) / tiList.length : 215;
        est = LSITE.traverseEstimate(vehCls, {
          km: b.km, totalAscentM: b.totalAscentM, meanSlope: b.meanSlope, maxSlope: b.maxSlope, dustKm: b.dustKm, meanElevM, meanTi,
        }, {
          VEHICLES: VEH, STORM, PLANET: global.PLANET_PROFILES && global.PLANET_PROFILES.get ? global.PLANET_PROFILES.get() : null,
          ls: S.crisis && S.crisis.ls != null ? S.crisis.ls : 251, lat: cv ? cv.lat : 0,
          tau: (cv && typeof STORM.baselineTau === 'function') ? STORM.baselineTau(cv.lat, cv.lon, S.crisis && S.crisis.ls != null ? S.crisis.ls : 251, meanElevM) : 0.5, driveHoursPerSol: r.driveH, tr,
        });
        r.speed = est.kmPerSol; // km per sol for the selected class (also used by the brief export)
      }
      const fmtTransit = (km, solsOverride) => {
        const n = solsOverride != null ? solsOverride : Math.max(1, Math.ceil(km / Math.max(1e-4, r.speed)));
        const yr = n > 668 ? ` (~${(n / 668.6).toFixed(1)} ${L(tr, 'pn.rvMarsYr')})` : '';
        return `${n.toLocaleString('en-US')} sols${yr} @ ${r.speed} km/sol`;
      };
      const sols = (km) => (km / r.speed).toFixed(0);
      const cls = (s) => s > r.maxSlope ? 'bad' : s > 10 ? 'warn' : 'ok';
      const havens = b.safeHavens || [];
      const ev = b.evaStats;
      const evDir = a.evaStats;
      const sciWps = b.scienceWaypoints || [];
      const isMarswalk = r.travelMode === 'marswalk';
      const evaSpeedKmh = +(ev.effWalkSpeedKmh || 2.4);
      const havenStr = !isMarswalk && havens.length
        ? havens.map(h => `${h.name} (${h.km} km · Sol ${Math.round(h.km / r.speed)} · ${L(tr, 'pn.rover200km')})`).join(', ')
        : isMarswalk
          ? L(tr, 'pn.footEvaStopsDisabled', [ev.evaRestCount || Math.max(1, Math.round(ev.sortieKm / 1.5)), ev.evaRestIntervalKm || 1.5, (ev.sortieKm * 0.5).toFixed(1)])
          : (L(tr, 'pn.noneDetected'));
      const hzSummary = b.hazardZones && b.hazardZones.summary ? b.hazardZones.summary : `${b.hazardKm.toFixed(0)} km >10° · ${(b.dustKm || 0).toFixed(0)} km <100 tiu`;
      const retInfo = b.returnRoute || { returnKm: b.km, returnAscentM: b.totalDescentM || 0, returnDescentM: b.totalAscentM || 0, roundTripKm: b.km * 2 };

      const sciRowsHtml = sciWps.map((wp, idx) => `
        <div class="eva-wp-card route-poi-card" data-poi-idx="${idx}">
          <div class="eva-wp-head">
            <b>${escHtml(wp.id)} · ${escHtml(tr ? wp.nameTr : wp.name)}</b>
            <span class="badge-mode badge-archive">km ${wp.km}</span>
          </div>
          <div class="help note-sm">${escHtml(tr ? wp.targetTr : wp.target)}</div>
          <div class="help note-sm">${wp.lat != null && wp.lon != null ? `Coord ${wp.lat.toFixed(2)}°, ${wp.lon.toFixed(2)}° · ` : ''}Elev ${wp.elev} m · Slope ${wp.slope}° · TI ${wp.ti === null ? '—' : wp.ti + ' tiu'} · SWIM ${wp.ice === null ? 'NO_DATA' : wp.ice}</div>
          ${wp.dataset ? `<div class="help note-sm"><b>${escHtml(wp.dataset)}</b>${wp.obsDate ? ` · ${escHtml(wp.obsDate)}` : ''}</div>` : ''}
        </div>`).join('');

      // Spacesuit / crew rows make no sense for a robotic rover (no astronaut aboard): hide them there.
      const hideCrew = !isMarswalk && !!vehCls && vehCls.id !== 'manned_rover';
      const crewRows = hideCrew ? '' : `
        <tr><td>${L(tr, 'pn.evaSortieTimeTurnaround')}</td><td>${evDir.walkHours} h/sortie</td><td class="${ev.withinEvaLimit ? 'ok' : 'warn'}"><b>${ev.walkHours} h / ${ev.maxEvaLimitH.toFixed(1)} h</b> (${ev.evaRestCount || 8} ${L(tr, 'pn.microRests')})</td></tr>
        <tr><td>${L(tr, 'pn.plssLifeSupportO2H2o')}</td><td>O₂ ${evDir.o2UsedPct}%</td><td class="${ev.returnReserveProtected !== false ? 'ok' : 'warn'}"><b>O₂ ${ev.o2UsedG}g (${ev.o2UsedPct}%) · ${ev.waterUsedL}L H₂O · CO₂ RCA ${ev.co2ScrubberUsedPct ?? 46}%</b> · RSV ${ev.returnReserveProtected !== false ? '✓ ≥25%' : '⚠'}</td></tr>
        <tr><td>${L(tr, 'pn.metabolicLoadWalkback')}</td><td>${evDir.metabolicKcalH} kcal/h</td><td class="ok"><b>${ev.metabolicKcalH} kcal/h</b> (${ev.metabolicW} W)</td></tr>
        <tr><td>${L(tr, 'pn.radiationDoseMslRad18')}</td><td>${evDir.radDoseMsv} mSv</td><td class="ok"><b>${ev.radDoseMsv} ± ${(ev.radDoseMsv * 0.188).toFixed(3)} mSv</b>/sortie (${ev.corridorRadDoseMsv} mSv tol)</td></tr>`;
      el.innerHTML = `
        <div class="marswalk-mode-banner ${isMarswalk ? 'active' : ''}">
          <b>${isMarswalk ? (L(tr, 'pn.activeModeAstronautFootEva', [evaSpeedKmh.toFixed(1)])) : (est ? L(tr, 'pn.rvBanner', [est.roverName, est.kmPerSol, est.driveHoursPerSol, L(tr, est.limitedBy === 'power' ? 'pn.rvLimPower' : est.limitedBy === 'drive' ? 'pn.rvLimDrive' : 'pn.rvLimBattery')]) : (L(tr, 'pn.activeModePressurizedRoverKm', [r.speed])))}</b>
          <span class="badge-mode badge-archive">${L(tr, 'pn.scienceGain100', [sciWps.length])}</span>
        </div>
        <div class="help note-sm">${L(tr, 'pn.globalARunsOnThe')}</div>
        <table class="stat-table"><tr><th>${L(tr, 'pn.metric')}</th><th class="straight">${L(tr, 'pn.direct')}</th><th class="safe">${L(tr, 'pn.aSafe')}</th></tr>
        <tr><td>${L(tr, 'pn.totalDistance')}</td><td>${a.km.toFixed(0)} km</td><td>${b.km.toFixed(0)} km <small>(+${(100 * (b.km / a.km - 1)).toFixed(0)}%)</small></td></tr>
        <tr><td>${L(tr, 'pn.totalAscentDescent')}</td><td>+${a.totalAscentM || 0} / -${a.totalDescentM || 0} m</td><td><b>+${b.totalAscentM || 0} m / -${b.totalDescentM || 0} m</b></td></tr>
        <tr><td>${L(tr, 'pn.peakSlopeModelLimit', [r.maxSlope])}</td><td class="${cls(a.maxSlope)}">${a.maxSlope.toFixed(1)}°</td><td class="${cls(b.maxSlope)}">${b.maxSlope.toFixed(1)}°</td></tr>
        <tr><td>${L(tr, 'pn.meanSlopeHazardSummary')}</td><td>${a.meanSlope.toFixed(1)}°</td><td>${b.meanSlope.toFixed(1)}° <small>(${escHtml(hzSummary)})</small></td></tr>
        <tr><td>${L(tr, 'pn.slope10LooseDust100')}</td><td>${a.hazardKm.toFixed(0)} / ${(a.dustKm || 0).toFixed(0)} km</td><td>${b.hazardKm.toFixed(0)} / ${(b.dustKm || 0).toFixed(0)} km</td></tr>
        <tr><td>${isMarswalk ? L(tr, 'pn.footEvaPaceTotalTime') : (est ? L(tr, 'pn.rvTransit', [est.roverName]) : L(tr, 'pn.pressurizedRoverTransit'))}</td><td>${isMarswalk ? `${(a.km / evaSpeedKmh).toFixed(1)} h @ ${evaSpeedKmh.toFixed(1)} km/h` : (est ? fmtTransit(a.km) : `${sols(a.km)} sols @ ${r.speed} km/sol`)}</td><td><b>${isMarswalk ? `${(b.km / evaSpeedKmh).toFixed(1)} h (${ev.evaSorties}×≤8h EVA)` : (est ? fmtTransit(b.km, est.sols) : `${sols(b.km)} sols @ ${r.speed} km/sol`)}</b></td></tr>
        ${est ? `<tr><td>${L(tr, 'pn.rvEnergy')}</td><td>—</td><td><b>${est.totalKwh} kWh</b> <small>(${L(tr, 'pn.rvEnergySplit', [est.tractionKwh, est.climbKwh, est.hotelKwh])}${est.chargesRequired != null ? L(tr, 'pn.rvCharges', [est.chargesRequired, est.batteryKwh]) : ''})</small></td></tr>
        <tr><td>${L(tr, 'pn.rvSlopeCheck')}</td><td>—</td><td class="${est.exceedsSlopeLimit ? 'bad' : 'ok'}"><b>${est.exceedsSlopeLimit ? L(tr, 'pn.rvSlopeBad', [b.maxSlope.toFixed(1), est.slopeLimitDeg]) : L(tr, 'pn.rvSlopeOk', [b.maxSlope.toFixed(1), est.slopeLimitDeg])}</b>${est.isConcept ? ` · <small>${L(tr, 'pn.rvConcept')}</small>` : ''}</td></tr>` : ''}
        ${crewRows}
        <tr><td>${L(tr, 'pn.returnRouteSafetyCorridor')}</td><td>—</td><td class="ok"><b>${retInfo.returnKm.toFixed(0)} km</b> (+${retInfo.returnAscentM} / -${retInfo.returnDescentM} m${hideCrew ? '' : ' · ≥25% RSV'})</td></tr>
        <tr><td>${L(tr, 'pn.routeScienceGainScore')}</td><td>—</td><td><b>${sciWps.length}</b></td></tr></table>
        <div class="verdict ${a.maxSlope > r.maxSlope ? 'bad' : 'ok'}">${a.maxSlope > r.maxSlope ? (L(tr, 'pn.directPathCrossesTerrainModel', [a.maxSlope.toFixed(1), r.maxSlope, (b.km - a.km).toFixed(0)])) : (L(tr, 'pn.directPathSatisfiesModelMaximum'))}</div>
        ${sciWps.length ? `<div class="sec-head mt-sm"><h2>${L(tr, 'pn.scienceWaypointsAlongRouteCoord')}</h2></div><div class="eva-wp-list">${sciRowsHtml}</div>` : ''}
        ${hideCrew ? '' : `<div class="help haven-note"><b>${isMarswalk ? (L(tr, 'pn.footEvaRestTurnaroundPlan')) : (L(tr, 'pn.rover200KmRestStops'))}: </b>${escHtml(havenStr)}</div>`}
        <div class="hint mt-sm">${L(tr, 'pn.elevationProfileAlongTheSafe')} · ${(r.ms || 0).toFixed(0)} ms, ${r.safe.path.length} ${L(tr, 'pn.cells')}</div>${CHARTS.profileSVG(b.profile)}`;
      announce(L(tr, 'pn.safeTraverseRouteComputedKilometers', [b.km.toFixed(0), b.maxSlope.toFixed(1)]), doc);
    }

    function runCrisis() {
      const c = S.crisis, el = $('#crisis-summary');
      if (!el) return;
      const tr = isTr();
      if (!c.site) {
        if ($('#crisis-site')) $('#crisis-site').textContent = t('crisisChooseSite', 'Choose a site on the map');
        el.innerHTML = '';
        const cvEmpty = $('#crisis-verdict');
        if (cvEmpty) { cvEmpty.className = 'crisis-verdict'; cvEmpty.textContent = L(tr, 'pn.cvPrompt'); }
        return;
      }
      const v = layers.cellValues(c.site.x, c.site.y), nr = layers.nearestRegion(v.lat, v.lon);
      if ($('#crisis-site')) $('#crisis-site').textContent = `${nr.distDeg < 6 ? nr.region.name : L(tr, 'pn.nearRegion', [nr.region.name])} · ${fmtLat(v.lat)}, ${fmtLon(v.lon)}`;
      const tau0 = typeof STORM.baselineTau === 'function' ? STORM.baselineTau(v.lat, v.lon, c.ls, v.elev) : 0.5;
      const clim = typeof STORM.dustClimAt === 'function' ? STORM.dustClimAt(v.lat, v.lon, c.ls, v.elev) : null;
      const stormCfg = { tau0, tauPeak: Math.max(c.tauPeak, tau0), startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 };
      const res = STORM.simulate({
        lat: v.lat, ls: c.ls, ti: v.ti, elev: v.elev, panelArea: c.area, efficiency: 0.2, consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
        storm: stormCfg,
      });
      const clearSolar = c.area * 0.2 * STORM.dailySolar(v.lat, tau0, c.ls);
      const nuc = c.kp * STORM.KILOPOWER_KW * STORM.SOL_H;
      // Every "peak storm" number below comes from the simulated sol with the weakest solar output at full
      // storm haze, so it includes the season at that sol, dust on the panels and the heaters, i.e. exactly
      // what decides survival (the old text re-derived it from the start season and clean panels).
      const peakRows = res.rows.filter((row) => row.tau >= c.tauPeak - 1e-9);
      const pk = (peakRows.length ? peakRows : res.rows).reduce((lo, row) => (row.solar < lo.solar ? row : lo));
      const peakSolar = pk.solar;
      const stormNightC = Math.min(...res.rows.map((row) => row.tempNight));
      const sTemp = STORM.surfaceTempC(v.lat, c.ls, v.ti, v.elev, 0.5);
      const pTherm = STORM.thermalDemandKw(v.lat, c.ls, v.ti, v.elev, 0.5);
      const spe = SCORING.calcSPE(v.elev, c.regolith ?? 1.5);

      // "What drives this result": once peak-storm solar falls well below demand the blackout sol is set by
      // battery autonomy + reactors, and τ / panel area / season stop moving the headline. Show that
      // explicitly, plus each slider's min→max effect, so an insensitive slider reads as physics, not a bug.
      const solarShare = c.cons > 0 ? peakSolar / c.cons : 0;
      const autonomySols = c.cons > 0 ? (c.batt / c.cons).toFixed(1) : '∞';
      const driverTxt = solarShare < 0.25
        ? L(tr, 'pn.driverSolarGone', [c.tauPeak.toFixed(1), peakSolar.toFixed(0), (100 * solarShare).toFixed(0), c.cons, autonomySols])
        : L(tr, 'pn.driverSolarMargin', [c.tauPeak.toFixed(1), peakSolar.toFixed(0), (100 * solarShare).toFixed(0), c.cons, autonomySols]);
      const simWith = (over) => STORM.simulate({
        lat: v.lat, ls: c.ls, ti: v.ti, elev: v.elev, panelArea: over.area ?? c.area, efficiency: 0.2,
        consumption: over.cons ?? c.cons, capacity: over.batt ?? c.batt, kilopower: over.kp ?? c.kp, sols: 120,
        storm: { ...stormCfg, tauPeak: over.tauPeak ?? c.tauPeak },
      }).blackoutSol;
      const bo = (sol) => (sol === null ? L(tr, 'pn.sensSurvives') : `sol ${sol}`);
      const sensRows = [
        [L(tr, 'pn.sensTau', [2, 12]), simWith({ tauPeak: 2 }), simWith({ tauPeak: 12 })],
        [L(tr, 'pn.sensArea', [100, 5000]), simWith({ area: 100 }), simWith({ area: 5000 })],
        [L(tr, 'pn.sensBatt', [100, 10000]), simWith({ batt: 100 }), simWith({ batt: 10000 })],
        [L(tr, 'pn.sensCons', [50, 1000]), simWith({ cons: 50 }), simWith({ cons: 1000 })],
        [L(tr, 'pn.sensKp', [0, 4]), simWith({ kp: 0 }), simWith({ kp: 4 })],
      ].map(([lbl, a, b]) => `<div class="kv"><span>${escHtml(lbl)}</span><b>${escHtml(bo(a))} → ${escHtml(bo(b))}</b></div>`).join('');
      const driverHtml = `
        <div class="marswalk-micro-card">
          <div class="marswalk-micro-head"><b>${L(tr, 'pn.whatDrivesResult')}</b><span class="badge-mode badge-archive">MODEL</span></div>
          <div class="help note-sm">${driverTxt}</div>
          <div class="help note-sm mt-sm"><b>${L(tr, 'pn.sensSliderRange')}</b></div>
          ${sensRows}
        </div>`;

      const verdict = res.blackoutSol !== null
        ? `<div class="summary-big bad">${escHtml(t('stormBlackout', 'Power blackout on sol'))} ${res.blackoutSol}</div><div class="help">${res.blackoutSol < stormCfg.startSol
            ? L(tr, 'pn.blackoutBeforeStorm', [res.blackoutSol, (clearSolar + nuc).toFixed(0), c.cons])
            : L(tr, 'pn.batteryReserveExhaustedSolsAfter', [res.blackoutSol - stormCfg.startSol, (peakSolar + nuc).toFixed(0), c.cons])}</div>`
        : `<div class="summary-big ok">${escHtml(t('stormSurvives', 'Base survives the storm'))}</div><div class="help">${L(tr, 'pn.minimumBatteryReserveKwhNet', [res.minBatt.toFixed(0), (100 * res.minBatt / c.batt).toFixed(0), pk.net.toFixed(0)])}</div>`;

      const thermVerdict = res.freezeSol !== null
        ? `<div class="summary-big bad mt-sm">${L(tr, 'pn.habitatInteriorBelow0C', [res.freezeSol])}</div><div class="help">${L(tr, 'pn.notEnoughHeatOncePower', [res.minHabTemp])}</div>`
        : `<div class="summary-big ok mt-sm">${L(tr, 'pn.thermalLifeSupportMaintained')}</div><div class="help">${L(tr, 'pn.internalHabitatComfort20C', [stormNightC])}</div>`;

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
            <b>${L(tr, 'pn.pimlMultiHorizonDustVortex')}</b>
            <span class="badge-mode badge-archive">${escHtml(tr ? 'Fizik-Temelli İndeks' : 'Physics Risk Index')}</span>
          </div>
          <div class="help note-sm">${tr
            ? `Elle ayarlanmış kurallar, doğrulanmamış; girdiler saha, mevsim ve saatten modellenir (canlı sensör yok). Koridor: <b>${escHtml(mlPred.features.corridorNameTr)}</b> (ΔP <code>${mlPred.features.deltaP1mPa} Pa/dk</code> · u*/u*t <code>${mlPred.features.bagnoldRatio}</code> · Ri<sub>b</sub> <code>${mlPred.features.bulkRichardson}</code>).`
            : `Hand-tuned rules, not validated; inputs are modelled from site, season and time of day (no live sensor). Corridor: <b>${escHtml(mlPred.features.corridorName)}</b> (ΔP <code>${mlPred.features.deltaP1mPa} Pa/min</code> · u*/u*t <code>${mlPred.features.bagnoldRatio}</code> · Ri<sub>b</sub> <code>${mlPred.features.bulkRichardson}</code>).`}</div>
          <div class="eva-sim-btns">
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'auto' ? 'btn-spec' : ''}" data-ml-regime="auto">${L(tr, 'pn.siteSeasonAuto')}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'vortex_imminent' ? 'btn-spec' : ''}" data-ml-regime="vortex_imminent">${L(tr, 'pn.1mVortexStrike')}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'precursor' ? 'btn-spec' : ''}" data-ml-regime="precursor">${L(tr, 'pn.615mPrecursor')}</button>
            <button type="button" class="ghost ml-regime-btn ${activeRegime === 'clear_calm' ? 'btn-spec' : ''}" data-ml-regime="clear_calm">${L(tr, 'pn.clearCalm')}</button>
          </div>
          ${mlPred.horizons.map(h => `
            <div class="kv">
              <span><b>${escHtml(tr ? h.horizonTr : h.horizonEn)}</b> <small>(${escHtml(h.keyMetric)})</small></span>
              <b class="${h.cls}">${Math.round(h.probPct)}/100 · ${escHtml(tr ? h.statusTr : h.statusEn)}</b>
            </div>`).join('')}
          <div class="help note-sm">${escHtml(tr ? mlPred.peakHorizon.actionTr : mlPred.peakHorizon.actionEn)}</div>
        </div>` : '';

      // Always-visible survive / not-survive strip directly under the sliders (sticky while scrolling).
      const cvEl = $('#crisis-verdict');
      if (cvEl) {
        const powerOk = res.blackoutSol === null, heatOk = res.freezeSol === null, baseOk = powerOk && heatOk;
        const doseCls = spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad';
        const mark = (ok) => (ok ? '✓' : '✕');
        const LSITE = global.MDE_LANDING_SITE, VEHS = global.MDE_VEHICLES;
        let roverHtml = '';
        if (LSITE && typeof LSITE.roverStormPower === 'function' && VEHS && VEHS.classes) {
          const planet = global.PLANET_PROFILES && global.PLANET_PROFILES.get ? global.PLANET_PROFILES.get() : null;
          roverHtml = Object.values(VEHS.classes).map((cls) => {
            const rp = LSITE.roverStormPower(cls, { VEHICLES: VEHS, STORM, PLANET: planet, lat: v.lat, ls: c.ls, tauPeak: c.tauPeak, storm: stormCfg });
            const detail = rp.mode === 'nuclear'
              ? L(tr, 'pn.cvRvNuclear', [rp.genWhSol, rp.loadWhSol])
              : rp.mode === 'solar'
                ? L(tr, 'pn.cvRvSolar', [rp.genWhSol, rp.loadWhSol])
                : L(tr, 'pn.cvRvBattery', [rp.autonomySols, rp.stormSols]);
            const nm = tr ? rp.roverNameTr : rp.roverName;
            return `<span class="cv-chip ${rp.survives ? 'ok' : 'bad'}"><b>${mark(rp.survives)} ${escHtml(nm)}</b> ${escHtml(detail)}${rp.isConcept ? ' *' : ''}</span>`;
          }).join('');
        }
        cvEl.className = `crisis-verdict ${baseOk ? 'ok' : 'bad'}`;
        cvEl.innerHTML = `
          <div class="cv-head">${mark(baseOk)} ${L(tr, baseOk ? 'pn.cvSurvives' : (res.blackoutSol !== null && res.blackoutSol < stormCfg.startSol ? 'pn.cvFailsBefore' : 'pn.cvFails'))}</div>
          <div class="cv-row">
            <span class="cv-chip ${powerOk ? 'ok' : 'bad'}"><b>${mark(powerOk)} ${L(tr, 'pn.cvPower')}</b> ${powerOk ? L(tr, 'pn.cvPowerOk', [res.minBatt.toFixed(0), (100 * res.minBatt / c.batt).toFixed(0)]) : L(tr, 'pn.cvPowerFail', [res.blackoutSol])}</span>
            <span class="cv-chip ${heatOk ? 'ok' : 'bad'}"><b>${mark(heatOk)} ${L(tr, 'pn.cvHeat')}</b> ${heatOk ? L(tr, 'pn.cvHeatOk') : L(tr, 'pn.cvHeatFail', [res.freezeSol])}</span>
            <span class="cv-chip ${doseCls}"><b>${mark(doseCls !== 'bad')} ${L(tr, 'pn.cvShelter')}</b> ${L(tr, 'pn.cvShelterTxt', [spe.shieldedDoseMsv < 1 ? '<1' : spe.shieldedDoseMsv, (c.regolith ?? 1.5).toFixed(1)])}</span>
          </div>
          <div class="cv-row"><span class="cv-lbl">${L(tr, 'pn.cvHaze')}</span><span class="cv-chip">${clim ? L(tr, 'pn.cvHazeClim', [clim.meanTau, clim.p90Tau, (100 * clim.fDust).toFixed(0), clim.years]) : L(tr, 'pn.cvHazeDefault', [tau0])}</span></div>
          ${roverHtml ? `<div class="cv-row"><span class="cv-lbl">${L(tr, 'pn.cvVehicles')}</span>${roverHtml}</div><div class="help note-sm cv-note">${L(tr, 'pn.cvModelNote')}</div>` : ''}`;
      }

      el.innerHTML = `${verdict}
        ${thermVerdict}
        ${driverHtml}
        ${mlCardHtml}
        <div class="kv"><span>${L(tr, 'pn.season')} (L<sub>s</sub> = ${c.ls}°)</span><b>${escHtml(trDom(STORM.seasonName(c.ls)))}</b></div>
        <div class="kv"><span>${L(tr, 'pn.surfaceTempApprox')}</span><b>${L(tr, 'pn.night')} ${sTemp.night}°C · ${L(tr, 'pn.mean')} ${sTemp.mean}°C</b></div>
        <div class="kv"><span>${L(tr, 'pn.habitatHeatLoss')}</span><b>${pTherm} kW · ${L(tr, 'pn.extraHeaters')} ${Math.max(...res.rows.map(r => r.heater)).toFixed(0)} kWh/sol max</b></div>
        <div class="kv"><span>${L(tr, 'pn.clearSkySolar05')}</span><b>${clearSolar.toFixed(0)} kWh/sol</b></div>
        <div class="kv"><span>${L(tr, 'pn.peakStormSolar')} ${c.tauPeak.toFixed(1)}</span><b>${peakSolar.toFixed(0)} kWh/sol (−${Math.max(0, 100 * (1 - peakSolar / Math.max(1e-9, clearSolar))).toFixed(0)}%)</b></div>
        <div class="kv"><span>${L(tr, 'pn.panelDustAfterSols', [res.rows.length])}</span><b>−${res.postStormSolarLossPct}% (${L(tr, 'pn.noCleaningEventsAssumed')})</b></div>
        <div class="kv"><span>${L(tr, 'pn.kilopowerBaseload')}</span><b>${nuc.toFixed(0)} kWh/sol</b></div>
        <div class="kv kv-top"><span>${L(tr, 'pn.designBasisSpeOnSurface')}</span><b>${spe.unshieldedDoseMsv} mSv</b></div>
        <div class="kv"><span>${L(tr, 'pn.shieldedMRegolith', [(c.regolith ?? 1.5).toFixed(1)])}</span><b class="${spe.shieldedDoseMsv <= 100 ? 'ok' : spe.shieldedDoseMsv <= 250 ? 'warn' : 'bad'}">${spe.shieldedDoseMsv < 1 ? '<1' : spe.shieldedDoseMsv} mSv (${escHtml(trDom(spe.survivalStatus))})</b></div>
        <div class="kv"><span>${L(tr, 'pn.regolithFor100Msv2')}</span><b>${spe.requiredRegolithM} m</b></div>
        <div class="help note-sm">${L(tr, 'pn.speFiguresUseAnAssumed')}</div>

        ${CHARTS.crisisSVG(res.rows, c.batt)}
        <div class="help mt-sm">${L(tr, 'pn.profileSol20Onset10')} ${c.kp === 0 && res.blackoutSol !== null ? (L(tr, 'pn.addFissionPowerKilopowerClass')) : ''}</div>`;
      el.querySelectorAll('.ml-regime-btn').forEach(btn => {
        btn.onclick = () => {
          c.mlRegime = btn.dataset.mlRegime;
          runCrisis();
        };
      });
      announce(res.blackoutSol !== null ? (L(tr, 'pn.stormSimulationBlackoutOnSol', [res.blackoutSol])) : (L(tr, 'pn.stormSimulationBaseSurvivesWith', [res.minBatt.toFixed(0)])), doc);
    }

    return { buildPresets, buildSliders, renderCandidates, renderDetail, renderRoute, runCrisis, announce };
  }

  global.MDE_PANELS = { createPanels, critRowsHTML, announce };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
