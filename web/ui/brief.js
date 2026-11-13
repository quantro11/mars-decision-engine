// Mission Reconnaissance Brief payload builder, printable HTML formatter, and JSON exporter.
(function (global) {
  'use strict';

  function buildBriefPayload(ctx) {
    const { S, W, flatShare, cellValues, blockValues, nearestRegion } = ctx;
    const SCORING = ctx.SCORING || global.SCORING;
    const STORM = ctx.STORM || global.STORM;
    const FMT = ctx.FMT || global.MDE_FMT;
    const wn = SCORING.normalize(S.weights);

    const cands = S.candidates.map((c, i) => {
      const v = blockValues(c.x, c.y, c.blockPx), nr = nearestRegion(v.lat, v.lon);
      const ice = SCORING.calcIceAccess(v.ice, S.iceBand);
      const terrain = SCORING.calcTerrainClass(v.slope, v.rough);
      const flat = flatShare ? flatShare(c.x, c.y, c.blockPx) : 0;
      return {
        rank: i + 1,
        designation: FMT.candidateName(v.lat, v.lon, nr),
        hls2015_ez: !!(nr.region.ez && nr.distDeg < 6),
        lat_deg: +v.lat.toFixed(2),
        lon_deg: +v.lon.toFixed(2),
        suitability_score: +c.score.toFixed(3),
        robust_pct: c.robust != null ? Math.round(c.robust * 100) : null,
        elev_m: Math.round(v.elev),
        slope_p90_deg: +v.slope.toFixed(1),
        swim_ice_consistency: v.ice === null ? null : +v.ice.toFixed(2),
        ice_access: ice.status,
        landing_slope_share_le5deg: +flat.toFixed(2),
        roughness_m: Math.round(v.rough),
        regional_terrain_class: terrain.terrainClass,
        tes_thermal_inertia: v.ti === null ? null : Math.round(v.ti),
        atmo_column_gcm2: +SCORING.atmoColumnGcm2(v.elev).toFixed(1),
        gcr_dose_msv_yr: Math.round(SCORING.radDoseMsvYr(v.elev)),
        nocturnal_temp_c: STORM.surfaceTempC(v.lat, S.crisis.ls).night,
        thermal_heating_kw: STORM.thermalDemandKw(v.lat, S.crisis.ls),
        mars_trek_url: FMT.trekUrl(v.lat, v.lon),
      };
    });

    const selCell = S.selected ? (() => {
      const v = cellValues(S.selected.x, S.selected.y);
      const nr = nearestRegion(v.lat, v.lon);
      return {
        region: nr.region.name,
        lat_deg: +v.lat.toFixed(2),
        lon_deg: +v.lon.toFixed(2),
        score: +S.score[S.selected.y * W + S.selected.x].toFixed(3),
        elev_m: Math.round(v.elev),
        slope_deg: +v.slope.toFixed(1),
        ice: v.ice === null ? null : +v.ice.toFixed(2),
        ti: v.ti === null ? null : Math.round(v.ti),
        gcr_dose_msv_yr: Math.round(SCORING.radDoseMsvYr(v.elev)),
      };
    })() : null;

    const crisisSite = S.crisis.site || (S.candidates[0] ? { x: S.candidates[0].x, y: S.candidates[0].y } : { x: W >> 1, y: 512 });
    const cv = cellValues(crisisSite.x, crisisSite.y), cnr = nearestRegion(cv.lat, cv.lon);
    const spe = SCORING.calcSPE(cv.elev, S.crisis.regolith ?? 1.5);
    const sim = STORM.simulate({
      lat: cv.lat, ls: S.crisis.ls, panelArea: S.crisis.area, efficiency: 0.2,
      consumption: S.crisis.cons, capacity: S.crisis.batt, kilopower: S.crisis.kp, sols: 120,
      storm: { tau0: 0.5, tauPeak: S.crisis.tauPeak, startSol: 20, riseSols: 10, holdSols: 40, decaySols: 30 },
    });

    return {
      generated_at: new Date().toISOString(),
      system: 'Mars Base Decision Engine (MDE-2.4)',
      architecture_preset: S.preset || 'custom',
      scoring_aggregation: S.agg || 'sum',
      hard_constraints_hls2015: S.hard,
      swim_ice_horizon: S.iceBand,
      normalized_weights: Object.fromEntries(Object.entries(wn).map(([k, v]) => [k, +v.toFixed(3)])),
      top_candidates: cands,
      selected_site: selCell,
      traverse_plan: S.route.safe && S.route.safe.ok ? {
        direct_km: +S.route.straight.stats.km.toFixed(1),
        direct_max_slope_deg: +S.route.straight.stats.maxSlope.toFixed(1),
        astar_safe_km: +S.route.safe.stats.km.toFixed(1),
        astar_max_slope_deg: +S.route.safe.stats.maxSlope.toFixed(1),
        astar_dust_trap_km: +(S.route.safe.stats.dustKm || 0).toFixed(1),
        astar_mean_roughness_m: Math.round(S.route.safe.stats.meanRough || 0),
        candidate_rest_stops: S.route.safe.stats.safeHavens || [],
        speed_km_per_sol: S.route.speed,
      } : null,
      dust_storm_simulation: {
        station_region: cnr.region.name,
        lat_deg: +cv.lat.toFixed(2),
        season_ls_deg: S.crisis.ls,
        season_name: STORM.seasonName(S.crisis.ls),
        tau_peak: S.crisis.tauPeak,
        nocturnal_surface_cold_c: STORM.surfaceTempC(cv.lat, S.crisis.ls).night,
        hab_heating_baseline_kw: STORM.thermalDemandKw(cv.lat, S.crisis.ls),
        spe_design_basis_assumption: {
          unshielded_dose_msv: spe.unshieldedDoseMsv,
          regolith_cover_m: +(S.crisis.regolith ?? 1.5).toFixed(1),
          shielded_dose_msv: spe.shieldedDoseMsv,
          required_trench_depth_m: spe.requiredRegolithM,
          survival_status: spe.survivalStatus,
        },
        panel_area_m2: S.crisis.area,
        kilopower_units: S.crisis.kp,
        survives_blackout: sim.blackoutSol === null,
        blackout_sol: sim.blackoutSol,
        thermal_freeze_sol: sim.freezeSol,
        min_hab_interior_c: sim.minHabTemp,
        post_storm_dust_loss_pct: sim.postStormSolarLossPct,
        min_battery_kwh: Math.round(sim.minBatt),
      },
    };
  }

  function buildGeoJSON(ctx) {
    const { S, W, flatShare, cellValues, blockValues, nearestRegion } = ctx;
    const SCORING = ctx.SCORING || global.SCORING;
    const FMT = ctx.FMT || global.MDE_FMT;
    const L = ctx.L || {};
    const lonOf = ctx.lonOfCol || L.lonOfCol || ((x) => -180 + (x + 0.5) * 360 / W);
    const latOf = ctx.latOfRow || L.latOfRow || ((y) => 90 - (y + 0.5) * 180 / (L.height || (W / 2)));
    const features = [];

    (S.candidates || []).forEach((c, i) => {
      const v = blockValues(c.x, c.y, c.blockPx), nr = nearestRegion(v.lat, v.lon);
      const ice = SCORING.calcIceAccess(v.ice, S.iceBand);
      const flat = flatShare ? flatShare(c.x, c.y, c.blockPx) : 0;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+v.lon.toFixed(4), +v.lat.toFixed(4)] },
        properties: {
          feature_type: 'candidate_site',
          rank: i + 1,
          designation: FMT.candidateName(v.lat, v.lon, nr),
          hls2015_ez: !!(nr.region.ez && nr.distDeg < 6),
          suitability_score: +c.score.toFixed(3),
          robust_pct: c.robust != null ? Math.round(c.robust * 100) : null,
          elev_m: Math.round(v.elev),
          slope_p90_deg: +v.slope.toFixed(1),
          ice_access: ice.status,
          landing_slope_share_le5deg: +flat.toFixed(2),
          tes_thermal_inertia: v.ti === null ? null : Math.round(v.ti),
          gcr_dose_msv_yr: Math.round(SCORING.radDoseMsvYr(v.elev)),
          mars_trek_url: FMT.trekUrl(v.lat, v.lon),
        },
      });
    });

    if (S.selected) {
      const v = cellValues(S.selected.x, S.selected.y), nr = nearestRegion(v.lat, v.lon);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+v.lon.toFixed(4), +v.lat.toFixed(4)] },
        properties: {
          feature_type: 'selected_site',
          region: nr.region.name,
          score: S.score ? +S.score[S.selected.y * W + S.selected.x].toFixed(3) : null,
          elev_m: Math.round(v.elev),
          slope_deg: +v.slope.toFixed(1),
          ice: v.ice === null ? null : +v.ice.toFixed(2),
          ti: v.ti === null ? null : Math.round(v.ti),
          gcr_dose_msv_yr: Math.round(SCORING.radDoseMsvYr(v.elev)),
        },
      });
    }

    if (S.crisis && S.crisis.site) {
      const cv = cellValues(S.crisis.site.x, S.crisis.site.y), cnr = nearestRegion(cv.lat, cv.lon);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+cv.lon.toFixed(4), +cv.lat.toFixed(4)] },
        properties: {
          feature_type: 'crisis_station',
          region: cnr.region.name,
          tau_peak: S.crisis.tauPeak,
          panel_area_m2: S.crisis.area,
          kilopower_units: S.crisis.kp,
        },
      });
    }

    if (S.route && S.route.safe && S.route.safe.ok && Array.isArray(S.route.safe.path) && S.route.safe.path.length >= 2) {
      const pathW = (L && L.width) || W;
      const segments = [[]];
      let prevLon = null;
      for (const pt of S.route.safe.path) {
        let px, py;
        if (typeof pt === 'number') { py = (pt / pathW) | 0; px = pt - py * pathW; }
        else if (Array.isArray(pt)) { px = pt[0]; py = pt[1]; }
        else { px = pt.x; py = pt.y; }
        const lon = +lonOf(px).toFixed(4), lat = +latOf(py).toFixed(4);
        if (prevLon !== null && Math.abs(lon - prevLon) > 180) segments.push([]);
        segments[segments.length - 1].push([lon, lat]);
        prevLon = lon;
      }
      const cleanSegs = segments.filter(s => s.length >= 2);
      if (cleanSegs.length) {
        const st = S.route.safe.stats, dir = S.route.straight && S.route.straight.stats;
        features.push({
          type: 'Feature',
          geometry: cleanSegs.length === 1
            ? { type: 'LineString', coordinates: cleanSegs[0] }
            : { type: 'MultiLineString', coordinates: cleanSegs },
          properties: {
            feature_type: 'astar_safe_route',
            astar_safe_km: +st.km.toFixed(1),
            astar_max_slope_deg: +st.maxSlope.toFixed(1),
            astar_dust_trap_km: +(st.dustKm || 0).toFixed(1),
            direct_km: dir ? +dir.km.toFixed(1) : null,
            direct_max_slope_deg: dir ? +dir.maxSlope.toFixed(1) : null,
            speed_km_per_sol: S.route.speed,
          },
        });
      }
    }

    return {
      type: 'FeatureCollection',
      metadata: {
        system: 'Mars Base Decision Engine (MDE-2.4)',
        crs_note: 'IAU Mars 2000 planetocentric lon/lat mapped to RFC 7946 [lon, lat]',
        generated_at: new Date().toISOString(),
        preset: S.preset || 'custom',
      },
      features,
    };
  }

  function renderBriefHTML(p, fmt, langArg) {
    const FMT = fmt || global.MDE_FMT;
    const esc = FMT.escHtml || ((t) => String(t ?? ''));
    const i18n = global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
    const lang = langArg || (i18n && i18n.getLang ? i18n.getLang() : 'en');
    const tr = lang === 'tr';
    const trDom = (v) => (tr && i18n && i18n.trDomain ? i18n.trDomain(v, lang) : v);
    const top = p.top_candidates[0], ds = p.dust_storm_simulation;
    return `
      <div class="brief-meta">
        <div class="brief-kpi"><span>${tr ? 'Görev Profili' : 'Mission Profile'}</span><b>${esc(p.architecture_preset.toUpperCase())} (${p.scoring_aggregation === 'geo' ? 'GEO' : 'SUM'})</b></div>
        <div class="brief-kpi"><span>${tr ? 'Birincil Aday' : 'Primary Candidate'}</span><b>${top ? esc(top.designation.split(' ·')[0]) : 'N/A'}</b></div>
        <div class="brief-kpi"><span>${tr ? 'GCR Dozu / Buz Erişimi' : 'GCR Dose / Ice Access'}</span><b>${top ? `${top.gcr_dose_msv_yr} mSv/${tr ? 'yıl' : 'yr'} · ${esc(trDom(top.ice_access))}` : '—'}</b></div>
        <div class="brief-kpi"><span>${tr ? 'Fırtına Dayanımı' : 'Storm Survival'} (τ=${ds.tau_peak})</span><b class="${ds.survives_blackout ? 'ok' : 'bad'}">${ds.survives_blackout ? (tr ? 'NOMİNAL' : 'NOMINAL') : (tr ? 'KESİNTİ SOL ' : 'BLACKOUT SOL ') + ds.blackout_sol}</b></div>
      </div>
      <h3>${tr ? '01 // İlk 5 Keşif Adayı (2°×2° Bölge Ortalamaları, ≥800 km Ara)' : '01 // Top-5 Reconnaissance Candidates (2°×2° Regional Means, ≥800 km Sep)'}</h3>
      <table class="tbl">
        <thead>
          <tr><th>${tr ? 'Sıra' : 'Rank'}</th><th>${tr ? 'Bölge Adı' : 'Region Designation'}</th><th>${tr ? 'Koordinat' : 'Coordinates'}</th><th>${tr ? 'Skor' : 'Score'}</th><th>${tr ? 'Rakım' : 'Elev'}</th><th>${tr ? 'Eğim' : 'Slope'}</th><th>${tr ? '≤5° Hücre' : '≤5° Cells'}</th><th>${tr ? 'Buz Erişimi' : 'Ice Access'}</th><th>TES TI</th><th>${tr ? 'GCR Dozu' : 'GCR Dose'}</th><th>${tr ? 'Sağlamlık' : 'Robust'}</th></tr>
        </thead>
        <tbody>
          ${p.top_candidates.map(c => `<tr>
            <td><b>#0${c.rank}</b></td>
            <td><a href="${esc(c.mars_trek_url)}" target="_blank" rel="noopener">${esc(c.designation)}</a> ${c.hls2015_ez ? '<span class="flag ez">HLS-EZ</span>' : ''}</td>
            <td><code>${esc(FMT.fmtLat(c.lat_deg))}, ${esc(FMT.fmtLon(c.lon_deg))}</code></td>
            <td><b>${c.suitability_score.toFixed(2)}</b></td>
            <td>${c.elev_m} m</td>
            <td>${c.slope_p90_deg}°</td>
            <td>${Math.round((c.landing_slope_share_le5deg ?? 0) * 100)}%</td>
            <td>${esc(trDom(c.ice_access))}</td>
            <td>${c.tes_thermal_inertia === null ? '—' : c.tes_thermal_inertia + ' tiu'}</td>
            <td>${c.gcr_dose_msv_yr} mSv/${tr ? 'yıl' : 'yr'}</td>
            <td>${c.robust_pct === null ? '—' : c.robust_pct + '%'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="modal-grid mt-sm">
        <div>
          <h3>${tr ? '02 // Yüzey Geçiş Analizi (A*)' : '02 // Surface Traverse Analysis (A*)'}</h3>
          ${p.traverse_plan ? (tr
            ? `<p>A* çoklu-tehlike koridoru <b>${p.traverse_plan.astar_safe_km} km</b> (azami eğim <code>${p.traverse_plan.astar_max_slope_deg}°</code>, düşük-TI toz <code>${p.traverse_plan.astar_dust_trap_km} km</code>, ${p.traverse_plan.candidate_rest_stops.length} aday mola noktası) vs. kuş uçuşu <b>${p.traverse_plan.direct_km} km</b> (azami eğim <code>${p.traverse_plan.direct_max_slope_deg}°</code>).</p>`
            : `<p>A* multi-hazard corridor requires <b>${p.traverse_plan.astar_safe_km} km</b> (max grade <code>${p.traverse_plan.astar_max_slope_deg}°</code>, low-TI dust <code>${p.traverse_plan.astar_dust_trap_km} km</code>, ${p.traverse_plan.candidate_rest_stops.length} candidate rest stops — terrain only, no shelter implied) vs. direct great-circle <b>${p.traverse_plan.direct_km} km</b> (max grade <code>${p.traverse_plan.direct_max_slope_deg}°</code>).</p>`)
          : `<p class="help">${tr ? 'Etkin rota seçilmedi. Rota telemetrisi eklemek için Modül II (Rover rotası) sekmesini kullanın.' : 'No active traverse waypoints designated. Switch to Module II (Rover Route) to include path telemetry.'}</p>`}
        </div>
        <div>
          <h3>${tr ? '03 // Küresel Toz Fırtınası, Termal ve SPE Siperleme' : '03 // Global Dust-Storm, Thermal &amp; SPE Shielding'}</h3>
          <p>${tr
            ? `<b>${esc(ds.station_region)}</b> (<code>${esc(FMT.fmtLat(ds.lat_deg))}</code>) istasyonunda <b>L<sub>s</sub> = ${ds.season_ls_deg}°</b> (${esc(trDom(ds.season_name))}), tepe <code>τ = ${ds.tau_peak}</code>, ${ds.panel_area_m2} m² güneş paneli + ${ds.kilopower_units} Kilopower (10 kWe): <b>${ds.survives_blackout ? 'Üs hayatta kalır (min rezerv ' + ds.min_battery_kwh + ' kWh, min iç sıcaklık ' + ds.min_hab_interior_c + '°C)' : 'Sol ' + ds.blackout_sol + ' gününde kesinti' + (ds.thermal_freeze_sol !== null ? ' · 0°C altı Sol ' + ds.thermal_freeze_sol : '')}</b>. ${ds.spe_design_basis_assumption.regolith_cover_m} m regolit altında tasarım SPE dozu: <code>${ds.spe_design_basis_assumption.shielded_dose_msv} mSv</code> (${esc(trDom(ds.spe_design_basis_assumption.survival_status))}).`
            : `Simulated at <b>${esc(ds.station_region)}</b> (<code>${esc(FMT.fmtLat(ds.lat_deg))}</code>) during <b>L<sub>s</sub> = ${ds.season_ls_deg}°</b> (${esc(ds.season_name)}), peak <code>τ = ${ds.tau_peak}</code>, ${ds.panel_area_m2} m² array + ${ds.kilopower_units} Kilopower unit(s, 10 kWe design target): <b>${ds.survives_blackout ? 'Base survives (min reserve ' + ds.min_battery_kwh + ' kWh, min habitat temp ' + ds.min_hab_interior_c + '°C)' : 'Blackout on Sol ' + ds.blackout_sol + (ds.thermal_freeze_sol !== null ? ' · below 0°C Sol ' + ds.thermal_freeze_sol : '')}</b>. Design-basis SPE assumption behind ${ds.spe_design_basis_assumption.regolith_cover_m} m regolith: <code>${ds.spe_design_basis_assumption.shielded_dose_msv} mSv</code> (${esc(ds.spe_design_basis_assumption.survival_status)}).`}</p>
        </div>
      </div>
      <div class="help mt-sm">${tr
        ? '04 // Doğrulama ve Kapsam: 9 gerçek Mars iniş aracında ort. 90. yüzdelik (geometrik 89.) ve 39 NASA HLS-2015 keşif bölgesinde 71. yüzdelik (p < 0.005). 4096×2048 (~5 km/px) bölgesel eleme modelidir; iniş elipsleri için HiRISE / CTX incelemesi gerekir.'
        : '04 // Validation & Scope: Benchmark yields mean 90th percentile across 9 Mars landers (89th geom.) and 71st across 39 NASA HLS-2015 zones (p < 0.005) on a 4096×2048 (~5 km/px) regional grid; landing ellipses require HiRISE / CTX verification.'}</div>`;
  }

  function triggerDownload(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadBriefJSON(payload) {
    triggerDownload('mars-mission-brief.json', 'application/json', JSON.stringify(payload, null, 2));
  }

  function downloadBriefGeoJSON(ctx) {
    triggerDownload('mars-mission-sites.geojson', 'application/geo+json', JSON.stringify(buildGeoJSON(ctx), null, 2));
  }

  global.MDE_BRIEF = { buildBriefPayload, buildGeoJSON, renderBriefHTML, downloadBriefJSON, downloadBriefGeoJSON };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
