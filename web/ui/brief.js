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

  function renderBriefHTML(p, fmt) {
    const FMT = fmt || global.MDE_FMT;
    const esc = FMT.escHtml || ((t) => String(t ?? ''));
    const top = p.top_candidates[0], ds = p.dust_storm_simulation;
    return `
      <div class="brief-meta">
        <div class="brief-kpi"><span>Mission Profile</span><b>${esc(p.architecture_preset.toUpperCase())} (${p.scoring_aggregation === 'geo' ? 'GEO' : 'SUM'})</b></div>
        <div class="brief-kpi"><span>Primary Candidate</span><b>${top ? esc(top.designation.split(' ·')[0]) : 'N/A'}</b></div>
        <div class="brief-kpi"><span>GCR Dose / Ice Access</span><b>${top ? `${top.gcr_dose_msv_yr} mSv/yr · ${esc(top.ice_access)}` : '—'}</b></div>
        <div class="brief-kpi"><span>Storm Survival (τ=${ds.tau_peak})</span><b class="${ds.survives_blackout ? 'ok' : 'bad'}">${ds.survives_blackout ? 'NOMINAL' : 'BLACKOUT SOL ' + ds.blackout_sol}</b></div>
      </div>
      <h3>01 // Top-5 Reconnaissance Candidates (2°×2° Regional Means, ≥800 km Sep)</h3>
      <table class="tbl">
        <thead>
          <tr><th>Rank</th><th>Region Designation</th><th>Coordinates</th><th>Score</th><th>Elev</th><th>Slope</th><th>≤5° Cells</th><th>Ice Access</th><th>TES TI</th><th>GCR Dose</th><th>Robust</th></tr>
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
            <td>${esc(c.ice_access)}</td>
            <td>${c.tes_thermal_inertia === null ? '—' : c.tes_thermal_inertia + ' tiu'}</td>
            <td>${c.gcr_dose_msv_yr} mSv/yr</td>
            <td>${c.robust_pct === null ? '—' : c.robust_pct + '%'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="modal-grid mt-sm">
        <div>
          <h3>02 // Surface Traverse Analysis (A*)</h3>
          ${p.traverse_plan ? `<p>A* multi-hazard corridor requires <b>${p.traverse_plan.astar_safe_km} km</b> (max grade <code>${p.traverse_plan.astar_max_slope_deg}°</code>, low-TI dust <code>${p.traverse_plan.astar_dust_trap_km} km</code>, ${p.traverse_plan.candidate_rest_stops.length} candidate rest stops — terrain only, no shelter implied) vs. direct great-circle <b>${p.traverse_plan.direct_km} km</b> (max grade <code>${p.traverse_plan.direct_max_slope_deg}°</code>).</p>` : '<p class="help">No active traverse waypoints designated. Switch to Module II (Rover Route) to include path telemetry.</p>'}
        </div>
        <div>
          <h3>03 // Global Dust-Storm, Thermal &amp; SPE Shielding</h3>
          <p>Simulated at <b>${esc(ds.station_region)}</b> (<code>${esc(FMT.fmtLat(ds.lat_deg))}</code>) during <b>L<sub>s</sub> = ${ds.season_ls_deg}°</b> (${esc(ds.season_name)}), peak <code>τ = ${ds.tau_peak}</code>, ${ds.panel_area_m2} m² array + ${ds.kilopower_units} Kilopower unit(s, 10 kWe design target): <b>${ds.survives_blackout ? 'Base survives (min reserve ' + ds.min_battery_kwh + ' kWh, min habitat temp ' + ds.min_hab_interior_c + '°C)' : 'Blackout on Sol ' + ds.blackout_sol + (ds.thermal_freeze_sol !== null ? ' · below 0°C Sol ' + ds.thermal_freeze_sol : '')}</b>. Design-basis SPE assumption behind ${ds.spe_design_basis_assumption.regolith_cover_m} m regolith: <code>${ds.spe_design_basis_assumption.shielded_dose_msv} mSv</code> (${esc(ds.spe_design_basis_assumption.survival_status)}).</p>
        </div>
      </div>`;
  }

  function downloadBriefJSON(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mars-mission-brief.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.MDE_BRIEF = { buildBriefPayload, renderBriefHTML, downloadBriefJSON };
})(typeof window !== 'undefined' ? window : module.exports);
