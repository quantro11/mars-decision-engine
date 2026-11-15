// Left-click custom landing site setup, rover+environment range model, and suitability penalty breakdown.
(function (global) {
  'use strict';

  const DEFAULT_MARS_R_KM = 3389.5;
  const DEFAULT_MARS_G = 3.72076;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  function normLon180(lon) {
    let x = ((lon + 180) % 360 + 360) % 360 - 180;
    return x === -180 && lon > 0 ? 180 : x;
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pick(tr, key, args) {
    const i18n = global.MDE_I18N || (typeof require === 'function' ? (() => { try { return require('./i18n.js'); } catch (_) { return null; } })() : null);
    if (i18n && typeof i18n.pick === 'function') return i18n.pick(tr, key, args);
    return key;
  }

  /**
   * Compute spherical small-circle boundary points (lat, lon) around a Mars center.
   * Because points live in planetary coordinates (lat, lon) rather than screen pixels,
   * zooming or panning scales the circle proportionally to the Martian surface.
   */
  function circleLatLons(latDeg, lonDeg, radiusKm, planetRadiusKm = DEFAULT_MARS_R_KM, steps = 72) {
    if (!(radiusKm > 0)) return [];
    const rPlanet = planetRadiusKm > 0 ? planetRadiusKm : DEFAULT_MARS_R_KM;
    const ang = Math.min(Math.PI * 0.95, radiusKm / rPlanet);
    const lat1 = Math.max(-89.9, Math.min(89.9, latDeg)) * DEG2RAD;
    const lon1 = lonDeg * DEG2RAD;
    const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
    const sinAng = Math.sin(ang), cosAng = Math.cos(ang);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const brg = (i / steps) * Math.PI * 2;
      const sinLat2 = sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brg);
      const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
      const y = Math.sin(brg) * sinAng * cosLat1;
      const x = cosAng - sinLat1 * sinLat2;
      const lon2 = lon1 + Math.atan2(y, x);
      pts.push([lat2 * RAD2DEG, normLon180(lon2 * RAD2DEG)]);
    }
    return pts;
  }

  function computeRoverRange(cellValues, rover, opts) {
    const { VEHICLES, STORM, PLANET, ls = 251, tr = false } = opts;
    const eff = VEHICLES.effects || {};
    const gravity = PLANET && PLANET.gravityMs2 && PLANET.gravityMs2.value > 0 ? PLANET.gravityMs2.value : DEFAULT_MARS_G;
    const baseMass = rover.baseMassKg ? rover.baseMassKg.value : 1000;
    const extraMass = rover.extraLoadKg ? (rover.extraLoadKg.default || 0) : 0;
    const totalMassKg = baseMass + extraMass;
    const speedKmh = rover.speedKmh ? rover.speedKmh.default : 0.1;
    const slopeLimitDeg = rover.slopeLimitDeg ? rover.slopeLimitDeg.value : 15;
    const pwr = rover.power || {};
    const powerMode = pwr.defaultMode || (pwr.mode && pwr.mode.value) || 'battery';
    const hotelW = pwr.hotelPowerW ? pwr.hotelPowerW.value : 60;

    const slopeDeg = Math.max(0, cellValues.slope || 0);
    const roughM = Math.max(0, cellValues.rough || 0);
    const tiVal = cellValues.ti != null ? cellValues.ti : 220;
    const dustNorm = cellValues.dust != null ? cellValues.dust : 0.18;
    const localTau = +(0.5 + dustNorm * 1.4).toFixed(2);
    const temp = STORM && STORM.surfaceTempC
      ? STORM.surfaceTempC(cellValues.lat, ls, cellValues.ti, cellValues.elev, localTau)
      : { mean: -63, night: -90, day: -20 };
    const dailySolarKwhM2 = STORM && STORM.dailySolar
      ? STORM.dailySolar(cellValues.lat, localTau, ls)
      : 2.2;

    // Terrain and environmental resistance factors
    const tiLooseThresh = eff.tiLooseThreshold ? eff.tiLooseThreshold.value : 200;
    const tiMult = tiVal < 100 ? 1.9 : tiVal < tiLooseThresh ? 1.4 : tiVal > 450 ? 1.15 : 1.0;
    const tiTag = tiVal < 100
      ? pick(tr, 'ls.tiDust')
      : tiVal < tiLooseThresh
        ? pick(tr, 'ls.tiSand')
        : tiVal > 450
          ? pick(tr, 'ls.tiRock')
          : pick(tr, 'ls.tiFirm');

    const roughFactor = 1 + Math.min(0.65, Math.max(0, roughM - 30) / 280);
    const massCoeff = eff.massEnergyCoeffWhPerKgKm ? eff.massEnergyCoeffWhPerKgKm.value : 0.28;
    const gradeEta = eff.gradeWorkEfficiency ? eff.gradeWorkEfficiency.value : 0.65;
    const climbWhKm = (totalMassKg * gravity * Math.sin(slopeDeg * DEG2RAD) * 1000) / (3600 * gradeEta);

    const heaterBase = eff.heaterBaseTempC ? eff.heaterBaseTempC.value : 0;
    const heaterCoeff = eff.nuclearHeaterWPerKgDegC ? eff.nuclearHeaterWPerKgDegC.value : 0.0018;
    const coldDelta = Math.max(0, heaterBase - temp.mean);
    const heaterW = coldDelta * heaterCoeff * totalMassKg;

    const tractionWhKm = (totalMassKg * massCoeff * tiMult + climbWhKm) * roughFactor;
    const hotelWhKm = (hotelW + heaterW) / Math.max(0.01, speedKmh);
    const effWhKm = tractionWhKm + hotelWhKm;

    const slopeBlocked = slopeDeg > slopeLimitDeg;
    let rangeKm = 0;
    let basisLabel = '';
    let energyDetail = '';

    if (!slopeBlocked) {
      if (powerMode === 'battery') {
        const capWh = (pwr.batteryCapacityKwh ? pwr.batteryCapacityKwh.value : 60) * 1000;
        rangeKm = +(capWh / Math.max(1, effWhKm)).toFixed(1);
        basisLabel = pick(tr, 'ls.basisBattery', [(capWh / 1000).toFixed(0)]);
        energyDetail = `${Math.round(effWhKm)} Wh/km`;
      } else if (powerMode === 'nuclear') {
        const genW = pwr.ratedPowerW ? pwr.ratedPowerW.value : 110;
        const campaignSols = 30;
        // Daily MMRTG energy budget minus continuous cold survival heating; traverse limited by energy & speed.
        const dailyGrossWh = genW * 24.65;
        const dailyHotelWh = (hotelW + heaterW) * 8.0;
        const netDriveWhSol = Math.max(0, dailyGrossWh - dailyHotelWh);
        const driveWhKm = Math.max(1, tractionWhKm);
        const dailyDistKm = Math.min(netDriveWhSol / driveWhKm, speedKmh * 8.0);
        rangeKm = +(dailyDistKm * campaignSols).toFixed(1);
        basisLabel = pick(tr, 'ls.basisNuclear', [campaignSols]);
        energyDetail = `${dailyDistKm.toFixed(2)} km/sol · ${Math.round(effWhKm)} Wh/km`;
      } else {
        const solarArea = pwr.solarAreaM2 ? pwr.solarAreaM2.value : 0.22;
        const solarEta = eff.solarPanelEfficiency ? eff.solarPanelEfficiency.value : 0.26;
        const campaignSols = 30;
        const dailySolarWh = dailySolarKwhM2 * 1000 * solarArea * solarEta;
        const daytimeHotelWh = (hotelW + heaterW * 0.5) * 4.5;
        const netDriveWhSol = Math.max(0, dailySolarWh - daytimeHotelWh);
        const dailyDistKm = Math.min(netDriveWhSol / Math.max(0.5, tractionWhKm), speedKmh * 5.0);
        rangeKm = +(dailyDistKm * campaignSols).toFixed(1);
        basisLabel = pick(tr, 'ls.basisSolar', [campaignSols]);
        energyDetail = `${Math.round(dailySolarWh)} Wh/sol (τ ${localTau})`;
      }
    } else {
      basisLabel = pick(tr, 'ls.basisBlocked', [slopeDeg.toFixed(1), slopeLimitDeg]);
      energyDetail = `${Math.round(effWhKm)} Wh/km`;
    }

    const envPenalties = [];
    if (slopeBlocked) {
      envPenalties.push(pick(tr, 'ls.envSlopeBlock', [slopeDeg.toFixed(1), slopeLimitDeg]));
    } else if (slopeDeg > 4) {
      envPenalties.push(pick(tr, 'ls.envSlopeDrag', [slopeDeg.toFixed(1), Math.round(climbWhKm)]));
    }
    if (tiMult > 1.05) {
      envPenalties.push(pick(tr, 'ls.envSinkage', [Math.round(tiVal), tiTag, tiMult.toFixed(2)]));
    }
    if (roughFactor > 1.04) {
      envPenalties.push(pick(tr, 'ls.envRough', [Math.round(roughM), Math.round((roughFactor - 1) * 100)]));
    }
    if (heaterW > hotelW * 0.08) {
      envPenalties.push(pick(tr, 'ls.envCold', [Math.round(temp.mean), Math.round(heaterW)]));
    }
    if (powerMode === 'solar' && (localTau > 0.7 || Math.abs(cellValues.lat) > 35)) {
      envPenalties.push(pick(tr, 'ls.envSolarLoss', [localTau, dailySolarKwhM2.toFixed(2)]));
    }

    return {
      roverId: rover.id,
      roverName: tr ? (rover.name_tr || rover.name) : rover.name,
      isConcept: !!rover.concept,
      slopeBlocked,
      slopeLimitDeg,
      rangeKm,
      basisLabel,
      energyDetail,
      effWhKm: +effWhKm.toFixed(1),
      localTau,
      tempMeanC: Math.round(temp.mean),
      dailySolarKwhM2: +dailySolarKwhM2.toFixed(2),
      tiMult,
      roughFactor: +roughFactor.toFixed(2),
      envPenalties,
    };
  }

  /**
   * Compute full landing-site compatibility score, negative scoring factors, and rover+env range.
   */
  function analyzeSite(opts) {
    const {
      cellValues, roverId = 'manned_rover', weights, hard = true, ls = 251,
      regionName = '', SCORING, STORM, VEHICLES, PLANET, tr = false,
    } = opts;

    const classes = (VEHICLES && VEHICLES.classes) || {};
    const rover = classes[roverId] || classes.manned_rover || classes.lab_rover || Object.values(classes)[0];
    const wn = SCORING.normalize(weights || {});
    const rawScore = SCORING.scoreCell(cellValues, wn, false) * 100;

    const H = SCORING.HARD || { elevMax: 2000, slopeMax: 15, latMax: 50 };
    const vetoReasons = [];
    if (cellValues.elev > H.elevMax) vetoReasons.push(pick(tr, 'ls.vetoElev', [Math.round(cellValues.elev), H.elevMax]));
    if (cellValues.slope > H.slopeMax) vetoReasons.push(pick(tr, 'ls.vetoSlope', [cellValues.slope.toFixed(1), H.slopeMax]));
    if (Math.abs(cellValues.lat) > H.latMax) vetoReasons.push(pick(tr, 'ls.vetoLat', [Math.abs(cellValues.lat).toFixed(1), H.latMax]));
    const nasaVeto = !!(hard && vetoReasons.length > 0);
    const effectiveScore = nasaVeto ? 0 : +rawScore.toFixed(1);

    const critVal = (k) => {
      if (k === 'elev') return Math.round(cellValues.elev);
      if (k === 'slope') return +cellValues.slope.toFixed(1);
      if (k === 'ice') return cellValues.ice === null ? pick(tr, 'ls.noDataShort') : cellValues.ice.toFixed(2);
      if (k === 'rough') return Math.round(cellValues.rough);
      if (k === 'lat') return `${cellValues.lat.toFixed(1)}°`;
      if (k === 'ti') return cellValues.ti === null ? pick(tr, 'ls.noDataShort') : Math.round(cellValues.ti);
      if (k === 'rad') return Math.round(cellValues.rad);
      if (k === 'cave') return cellValues.cave === null ? '>1000' : Math.round(cellValues.cave);
      return '';
    };

    const critF = (k) => {
      if (k === 'rad') return SCORING.F.rad(cellValues.elev, cellValues.slope || 0);
      if (k === 'cave') return SCORING.F.cave(cellValues.cave != null ? cellValues.cave : null);
      return SCORING.F[k](cellValues[k]);
    };

    const critLabel = (c) => {
      const lbl = pick(tr, 'crit.' + c.key);
      return lbl !== 'crit.' + c.key ? lbl : c.label;
    };

    const negativeFactors = [];
    for (const c of SCORING.CRITERIA) {
      const w = wn[c.key] || 0;
      if (w <= 0) continue;
      const f = critF(c.key);
      const lossPts = (1 - f) * w * 100;
      if (lossPts >= 0.25) {
        negativeFactors.push({
          key: c.key,
          label: critLabel(c),
          valueText: `${critVal(c.key)}${c.unit ? ' ' + c.unit : ''}`.trim(),
          factorScore: +f.toFixed(2),
          weightPct: Math.round(w * 100),
          lossPts: +lossPts.toFixed(1),
        });
      }
    }
    negativeFactors.sort((a, b) => b.lossPts - a.lossPts);

    const rangeInfo = computeRoverRange(cellValues, rover, { VEHICLES, STORM, PLANET, ls, tr });
    const planetRadiusKm = PLANET && PLANET.radiusKm && PLANET.radiusKm.value > 0
      ? PLANET.radiusKm.value
      : DEFAULT_MARS_R_KM;

    return {
      lat: cellValues.lat,
      lon: cellValues.lon,
      regionName,
      rawScore: +rawScore.toFixed(1),
      effectiveScore,
      nasaVeto,
      vetoReasons,
      negativeFactors,
      rover: rangeInfo,
      rangeKm: rangeInfo.rangeKm,
      circlePts: circleLatLons(cellValues.lat, cellValues.lon, rangeInfo.rangeKm, planetRadiusKm, 72),
    };
  }

  /**
   * Bind the dedicated Landing Site Planner tab panel (#panel-landing).
   */
  function createController(opts) {
    const {
      doc = global.document, S, layers, SCORING, STORM, VEHICLES, PLANET, FMT,
      onDraw, onClose, onUseEva, onPlanMarswalk, onUseCrisis,
    } = opts;

    const card = doc.getElementById('landing-setup-card');
    const emptyEl = doc.getElementById('ls-empty');
    const closeBtn = doc.getElementById('ls-close-btn');
    const coordEl = doc.getElementById('ls-coord');
    const regionEl = doc.getElementById('ls-region');
    const roverSel = doc.getElementById('ls-rover-select');
    const roverSeg = doc.getElementById('ls-rover-seg');
    const rangeValEl = doc.getElementById('ls-range-val');
    const rangeBasisEl = doc.getElementById('ls-range-basis');
    const rangeEnvEl = doc.getElementById('ls-range-env');
    const compatScoreEl = doc.getElementById('ls-compat-score');
    const compatStatusEl = doc.getElementById('ls-compat-status');
    const factorsEl = doc.getElementById('ls-factors-list');
    const metricsKvEl = doc.getElementById('ls-metrics-kv');
    const summaryEl = doc.getElementById('ls-summary-body');
    const walkEl = doc.getElementById('ls-walk-body');
    const stormEl = doc.getElementById('ls-storm-body');
    const btnEva = doc.getElementById('ls-btn-eva');
    const btnWalk = doc.getElementById('ls-btn-walk');
    const btnStorm = doc.getElementById('ls-btn-storm');

    let roverId = 'manned_rover';

    const isTr = () => {
      const i18n = global.MDE_I18N;
      return i18n && i18n.getLang ? i18n.getLang() === 'tr' : false;
    };

    function syncRoverUI() {
      if (roverSel && roverSel.value !== roverId) roverSel.value = roverId;
      if (roverSeg) {
        roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
          const on = b.dataset.rover === roverId;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    }

    function populateRoverSelect() {
      if (!VEHICLES || !VEHICLES.classes) return;
      const tr = isTr();
      const prev = (roverSel && roverSel.value) || roverId;
      if (roverSel) {
        roverSel.innerHTML = '';
        for (const cls of Object.values(VEHICLES.classes)) {
          const opt = doc.createElement('option');
          opt.value = cls.id;
          const label = tr ? (cls.name_tr || cls.name) : cls.name;
          const spd = cls.speedKmh ? cls.speedKmh.default : '';
          opt.textContent = cls.concept
            ? `${label} (${spd} km/h · ${pick(tr, 'ls.conceptTag')})`
            : `${label} (${spd} km/h)`;
          roverSel.appendChild(opt);
        }
        if (VEHICLES.classes[prev]) roverSel.value = prev;
        roverId = roverSel.value || 'manned_rover';
      }
      if (roverSeg) {
        const segLabels = {
          manned_rover: pick(tr, 'ls.segManned'),
          lab_rover: pick(tr, 'ls.segLab'),
          mini_rover: pick(tr, 'ls.segMini'),
        };
        roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
          if (segLabels[b.dataset.rover]) b.textContent = segLabels[b.dataset.rover];
        });
      }
      syncRoverUI();
    }

    function buildSiteSummary(v, res, tr) {
      const ice = SCORING.calcIceAccess ? SCORING.calcIceAccess(v.ice, S.iceBand || 'ice15') : { status: 'NO_DATA' };
      const terrain = SCORING.calcTerrainClass ? SCORING.calcTerrainClass(v.slope, v.rough) : { terrainClass: 'MODERATE' };
      const terrainLbl = tr
        ? ({ SMOOTH: 'düzgün', MODERATE: 'orta engebeli', RUGGED: 'engebeli' }[terrain.terrainClass] || 'orta')
        : ({ SMOOTH: 'smooth', MODERATE: 'moderate', RUGGED: 'rugged' }[terrain.terrainClass] || 'moderate');
      const iceLbl = tr
        ? ({ LIKELY: 'buz muhtemel', POSSIBLE: 'buz olasılığı orta', UNLIKELY: 'buz zayıf', NO_DATA: 'SWIM kapsama dışı' }[ice.status] || '')
        : ({ LIKELY: 'subsurface ice likely', POSSIBLE: 'mixed ice signal', UNLIKELY: 'ice unlikely', NO_DATA: 'outside SWIM coverage' }[ice.status] || '');
      if (res.nasaVeto) {
        return pick(tr, 'ls.sumVetoed', [res.vetoReasons.join('; '), terrainLbl, iceLbl]);
      }
      return pick(tr, 'ls.sumOk', [terrainLbl, v.slope.toFixed(1), Math.round(v.elev), iceLbl]);
    }

    function render() {
      if (!S.customLanding || !card) return;
      const tr = isTr();
      const { x, y } = S.customLanding;
      const v = layers.cellValues(x, y);
      const nr = layers.nearestRegion ? layers.nearestRegion(v.lat, v.lon) : null;
      const regName = nr && nr.region
        ? (nr.distDeg < 6 ? nr.region.name : pick(tr, 'pn.nearRegion', [nr.region.name]))
        : '';

      const res = analyzeSite({
        cellValues: v,
        roverId,
        weights: S.weights,
        hard: S.hard,
        ls: S.crisis && S.crisis.ls != null ? S.crisis.ls : 251,
        regionName: regName,
        SCORING,
        STORM,
        VEHICLES,
        PLANET: PLANET || (global.PLANET_PROFILES && global.PLANET_PROFILES.get ? global.PLANET_PROFILES.get() : null),
        tr,
      });

      S.customLanding.roverId = roverId;
      S.customLanding.rangeKm = res.rangeKm;
      S.customLanding.circlePts = res.circlePts;
      S.customLanding.lat = v.lat;
      S.customLanding.lon = v.lon;
      S.customLanding.score = res.rawScore;
      S.customLanding.slopeBlocked = res.rover.slopeBlocked;

      if (coordEl) coordEl.textContent = (FMT && FMT.fmtLat && FMT.fmtLon) ? `${FMT.fmtLat(v.lat)} · ${FMT.fmtLon(v.lon)}` : `${v.lat.toFixed(2)}°, ${v.lon.toFixed(2)}°`;
      if (regionEl) regionEl.textContent = regName || pick(tr, 'ls.customCoords');

      if (rangeValEl) {
        rangeValEl.textContent = res.rover.slopeBlocked
          ? `0.0 km (${pick(tr, 'ls.blockedShort')})`
          : `${res.rangeKm.toFixed(1)} km`;
        rangeValEl.classList.toggle('is-blocked', !!res.rover.slopeBlocked);
      }
      if (rangeBasisEl) rangeBasisEl.textContent = `${res.rover.basisLabel} · ${res.rover.energyDetail}`;
      if (rangeEnvEl) {
        rangeEnvEl.innerHTML = res.rover.envPenalties.length
          ? res.rover.envPenalties.map((p) => `<div class="ls-env-chip">${escHtml(p)}</div>`).join('')
          : `<div class="ls-env-chip is-ok">${escHtml(pick(tr, 'ls.envNominal', [res.rover.tempMeanC, res.rover.localTau]))}</div>`;
      }

      if (compatScoreEl) {
        const displayScore = res.nasaVeto ? res.effectiveScore : res.rawScore;
        compatScoreEl.textContent = `${displayScore.toFixed(0)} / 100`;
        compatScoreEl.classList.toggle('is-good', !res.nasaVeto && res.rawScore >= 70);
        compatScoreEl.classList.toggle('is-warn', !res.nasaVeto && res.rawScore >= 45 && res.rawScore < 70);
        compatScoreEl.classList.toggle('is-bad', res.nasaVeto || res.rawScore < 45);
      }
      if (compatStatusEl) {
        compatStatusEl.textContent = res.nasaVeto
          ? `${pick(tr, 'ls.vetoTag')} (${pick(tr, 'ls.unweightedScore', [res.rawScore.toFixed(1)])})`
          : pick(tr, 'ls.withinNasa');
        compatStatusEl.className = res.nasaVeto ? 'ls-compat-status is-veto' : 'ls-compat-status is-ok';
      }

      if (factorsEl) {
        const parts = [];
        for (const vr of res.vetoReasons) {
          parts.push(`<div class="ls-factor-row is-veto"><span>${escHtml(vr)}</span><span class="ls-penalty-val">${escHtml(pick(tr, 'ls.vetoBadge'))}</span></div>`);
        }
        for (const nf of res.negativeFactors) {
          parts.push(
            `<div class="ls-factor-row"><span>${escHtml(nf.label)} <small>(${escHtml(nf.valueText)})</small></span>`
            + `<span class="ls-penalty-val">-${nf.lossPts.toFixed(1)}</span></div>`
          );
        }
        if (!parts.length) parts.push(`<div class="ls-factor-empty">${escHtml(pick(tr, 'ls.noNegatives'))}</div>`);
        factorsEl.innerHTML = parts.join('');
      }

      if (metricsKvEl) {
        const tiTxt = v.ti == null ? '—' : `${Math.round(v.ti)} tiu`;
        const iceTxt = v.ice == null ? pick(tr, 'ls.noDataShort') : v.ice.toFixed(2);
        metricsKvEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mElev'))}</span><b>${Math.round(v.elev)} m</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mSlope'))}</span><b>${v.slope.toFixed(1)}°</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mIce'))}</span><b>${escHtml(iceTxt)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mTi'))}</span><b>${escHtml(tiTxt)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.mRad'))}</span><b>${Math.round(v.rad)} mSv/yr</b></div>`,
        ].join('');
      }

      if (summaryEl) summaryEl.textContent = buildSiteSummary(v, res, tr);

      if (walkEl) {
        const locTi = v.ti != null ? v.ti : 215;
        const locDust = v.dust != null ? v.dust : 0.25;
        const walkH = +(4.2 + v.slope * 0.11 + (v.rough / 180)).toFixed(1);
        const bio = SCORING.calcPandolfMars
          ? SCORING.calcPandolfMars({ slopeDeg: v.slope, ti: locTi, sandFrac: Math.max(0, locDust - 0.2) * 0.6, durationH: walkH, loadKg: 15, speedKmh: 2.4, buddyMode: 'buddy' })
          : { metabolicKcalH: 228, o2RemainPct: 72, waterUsedL: 1.35, co2ScrubberUsedPct: 38, walkbackRadiusM: 760 };
        const walkOk = walkH <= 8.0 && v.slope <= 15;
        walkEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wDuration'))}</span><b class="${walkOk ? 'ok' : 'warn'}">${walkH} h / 8.0 h</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wMetabolic'))}</span><b>${bio.metabolicKcalH} kcal/h · ${bio.waterUsedL} L H₂O</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.wReserve'))}</span><b>O₂ ${bio.o2RemainPct}% · CO₂ ${bio.co2ScrubberUsedPct ?? 38}% · ${bio.walkbackRadiusM} m</b></div>`,
        ].join('');
      }

      if (stormEl && STORM && STORM.simulate) {
        const c = S.crisis || { ls: 251, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 0, regolith: 1.5 };
        const st = STORM.simulate({
          lat: v.lat, ls: c.ls, ti: v.ti, elev: v.elev, panelArea: c.area, efficiency: 0.2,
          consumption: c.cons, capacity: c.batt, kilopower: c.kp, sols: 120,
          storm: { tau0: 0.5, tauPeak: c.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 },
        });
        const spe = SCORING.calcSPE ? SCORING.calcSPE(v.elev, c.regolith ?? 1.5) : { requiredRegolithM: 1.5 };
        const pwrStatus = st.blackoutSol !== null
          ? pick(tr, 'ls.stBlackout', [st.blackoutSol])
          : pick(tr, 'ls.stSurvives', [Math.round(st.minBatt), Math.round((100 * st.minBatt) / c.batt)]);
        const thermStatus = st.freezeSol !== null
          ? pick(tr, 'ls.stFreeze', [st.freezeSol])
          : pick(tr, 'ls.stWarm');
        stormEl.innerHTML = [
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stPower'))}</span><b class="${st.blackoutSol !== null ? 'bad' : 'ok'}">${escHtml(pwrStatus)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stTemp'))}</span><b class="${st.freezeSol !== null ? 'bad' : 'ok'}">${escHtml(thermStatus)}</b></div>`,
          `<div class="kv"><span>${escHtml(pick(tr, 'ls.stSpe'))}</span><b>${spe.requiredRegolithM} m</b></div>`,
        ].join('');
      }

      if (emptyEl) emptyEl.classList.add('hidden');
      if (closeBtn) closeBtn.classList.remove('hidden');
      card.classList.remove('hidden');
      if (onDraw) onDraw();
    }

    function openAt(x, y) {
      if (!S) return;
      S.customLanding = { x, y, roverId, rangeKm: 0, circlePts: [] };
      populateRoverSelect();
      render();
    }

    function close() {
      if (!S) return;
      S.customLanding = null;
      if (card) card.classList.add('hidden');
      if (closeBtn) closeBtn.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (onDraw) onDraw();
      if (onClose) onClose();
    }

    function refresh() {
      if (S && S.customLanding) render();
    }

    function onLangChange() {
      populateRoverSelect();
      refresh();
    }

    populateRoverSelect();
    if (roverSeg) {
      roverSeg.querySelectorAll('button[data-rover]').forEach((b) => {
        b.addEventListener('click', () => {
          roverId = b.dataset.rover || 'manned_rover';
          syncRoverUI();
          refresh();
        });
      });
    }
    if (roverSel) {
      roverSel.addEventListener('change', () => {
        roverId = roverSel.value || 'manned_rover';
        syncRoverUI();
        refresh();
      });
    }
    if (btnEva) {
      btnEva.addEventListener('click', () => {
        if (!S.customLanding || !onUseEva) return;
        const { x, y } = S.customLanding;
        const v = layers.cellValues(x, y);
        const nr = layers.nearestRegion ? layers.nearestRegion(v.lat, v.lon) : null;
        onUseEva(x, y, v, nr && nr.region ? nr.region.name : '');
      });
    }
    if (btnWalk) {
      btnWalk.addEventListener('click', () => {
        if (S.customLanding && onPlanMarswalk) onPlanMarswalk(S.customLanding.x, S.customLanding.y);
      });
    }
    if (btnStorm) {
      btnStorm.addEventListener('click', () => {
        if (S.customLanding && onUseCrisis) onUseCrisis(S.customLanding.x, S.customLanding.y, true);
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', close);
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S && S.customLanding && S.mode === 'landing') close();
    });

    return { openAt, close, refresh, onLangChange };
  }

  const api = {
    circleLatLons,
    computeRoverRange,
    analyzeSite,
    createController,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MDE_LANDING_SITE = api;
})(typeof window !== 'undefined' ? window : globalThis);
