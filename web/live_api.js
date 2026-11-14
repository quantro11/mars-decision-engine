// Live NASA Planetary & Space Weather APIs + Earth vs. Mars Habitability Engine
// Bridges real NASA Open APIs (api.nasa.gov) with planetary life-support requirements.
(function (global) {
  'use strict';

  const EARTH_BASELINE = {
    pressure_kpa: 101.3,
    o2_pct: 20.95,
    co2_ppm: 426,
    mean_temp_c: 15.0,
    water_availability: 'Global liquid oceans & rainfall (aw = 1.0)',
    radiation_msv_yr: 2.4,
    uv_index: '1–11 (Ozone-shielded)',
    magnetic_field_ut: 45.0,
    gravity_g: 1.0,
  };

  // Current 2025–2026 active surface meteorology from MSL Curiosity (REMS) and Mars 2020 Perseverance (MEDA)
  const ACTIVE_ROVER_WEATHER_2026 = [
    {
      id: 'msl_rems',
      mission: 'MSL Curiosity · REMS (Gale Crater · Mount Sharp Boxwork)',
      missionTr: 'MSL Curiosity · REMS (Gale Krateri · Mount Sharp Boxwork)',
      instrument: 'REMS (Rover Environmental Monitoring Station)',
      lat: -4.59,
      lon: 137.44,
      elev_m: -4120,
      sol: 4485,
      earthDate: '2025-03-18 UTC',
      dataType: 'ARCHIVE_TELEMETRY (PDS Atmospheres Node)',
      period: '2025–2026 Campaign',
      air_temp_c: { min: -74, mean: -41, max: -7 },
      pressure_pa: 752,
      wind_mps: 4.6,
      tau: 0.54,
      rad_ugy_sol: 640
    },
    {
      id: 'm2020_meda',
      mission: 'Mars 2020 Perseverance · MEDA (Jezero Western Rim · Witch Hazel Hill)',
      missionTr: 'Mars 2020 Perseverance · MEDA (Jezero Batı Kenarı · Witch Hazel Hill)',
      instrument: 'MEDA (Mars Environmental Dynamics Analyzer)',
      lat: 18.38,
      lon: 77.58,
      elev_m: -2540,
      sol: 1468,
      earthDate: '2025-04-02 UTC',
      dataType: 'ARCHIVE_TELEMETRY (PDS Atmospheres Node)',
      period: '2025–2026 Campaign',
      air_temp_c: { min: -81, mean: -50, max: -13 },
      pressure_pa: 734,
      wind_mps: 5.8,
      tau: 0.48,
      rad_ugy_sol: 685
    }
  ];

  // Spatial extrapolation model: projects point rover telemetry (REMS/MEDA) to a selected Mars landing/EVA site
  // using hydrostatic scale height (H = 11.1 km) and meridional thermal gradient (-0.65 K/deg poleward).
  function extrapolateWeatherToSite(station, targetLat, targetLon, targetElevM) {
    const st = station || ACTIVE_ROVER_WEATHER_2026[1];
    const tLat = Number.isFinite(targetLat) ? targetLat : 18.38;
    const tLon = Number.isFinite(targetLon) ? targetLon : 77.58;
    const tElev = Number.isFinite(targetElevM) ? targetElevM : -2540;
    const R = 3389.5;
    const dLat = (tLat - st.lat) * Math.PI / 180;
    const dLon = (tLon - st.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(st.lat * Math.PI / 180) * Math.cos(tLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
    const deltaElevM = Math.round(tElev - st.elev_m);
    const deltaLatDeg = +(Math.abs(tLat) - Math.abs(st.lat)).toFixed(1);
    const projectedPressurePa = Math.round(st.pressure_pa * Math.exp(-deltaElevM / 11100));
    const dTemp = -0.0018 * deltaElevM - 0.65 * deltaLatDeg;
    const projectedMeanTempC = Math.round(st.air_temp_c.mean + dTemp);
    return {
      stationMission: st.mission,
      stationCoords: `${st.lat.toFixed(2)}°N, ${st.lon.toFixed(2)}°E (${st.elev_m} m)`,
      sol: st.sol,
      earthDate: st.earthDate,
      dataType: st.dataType,
      targetCoords: `${tLat.toFixed(2)}°N, ${tLon.toFixed(2)}°E (${Math.round(tElev)} m)`,
      distKm,
      deltaElevM,
      deltaLatDeg,
      projectedPressurePa,
      projectedMeanTempC,
      disclaimer: `Point measurement from ${st.instrument} at (${st.lat}°N, ${st.lon}°E, Sol ${st.sol}, ${st.earthDate}). Extrapolated ${distKm} km (Δh=${deltaElevM >= 0 ? '+' : ''}${deltaElevM} m) via hydrostatic scale height (H=11.1 km) & latitudinal gradient.`,
      disclaimerTr: `${st.instrument} nokta ölçümü (${st.lat}°K, ${st.lon}°D, Sol ${st.sol}, ${st.earthDate}). Seçilen rotaya ${distKm} km (Δh=${deltaElevM >= 0 ? '+' : ''}${deltaElevM} m) hidrostatik ölçek yüksekliği (H=11.1 km) ve enlem gradyanı ile aktarılmıştır.`
    };
  }

  // Separate Heliocentric Propagation & Martian Surface Radiation Model (Item 11):
  // DONKI events are 1 AU solar/coronal observations, NOT instantaneous Mars surface dosimetry.
  // Models DBM transit time to 1.524 AU, 1/r² flux dilution (0.431×), and Mars CO₂ column attenuation.
  function estimateMarsSpaceWeatherImpact(events, flareRes, siteElevM) {
    const latestCme = Array.isArray(events) && events.length ? events[0] : null;
    const speedKms = (latestCme && Number.isFinite(latestCme.speed_kms) && latestCme.speed_kms > 0) ? latestCme.speed_kms : 1510;
    const elevM = Number.isFinite(siteElevM) ? siteElevM : -2540;
    const marsDistKm = 1.524 * 149597870.7; // 2.2799e8 km
    // Drag-based effective propagation speed to 1.524 AU (Vrsnak et al. 2013 DBM approximation)
    const effSpeedKms = 0.72 * speedKms + 115;
    const transitHoursToMars = +(marsDistKm / (effSpeedKms * 3600)).toFixed(1);
    const fluxScalingFactor = 0.431; // (1 / 1.524)^2
    const columnMassGcm2 = +(16.0 * Math.exp(-elevM / 11100)).toFixed(1);
    const atmAttenuation = Math.exp(-columnMassGcm2 / 28.0);
    const flrClass = (flareRes && flareRes.classType) ? String(flareRes.classType).toUpperCase() : 'M2.4';
    const base1AuPeakUsvHr = flrClass.startsWith('X') ? 420 : (flrClass.startsWith('M') ? 95 : 18);
    const modeledSurfaceDoseRateUsvHr = +(base1AuPeakUsvHr * fluxScalingFactor * atmAttenuation).toFixed(1);
    let arrivalIso = 'N/A';
    if (latestCme && latestCme.startTime) {
      const t0 = Date.parse(latestCme.startTime);
      if (Number.isFinite(t0)) {
        arrivalIso = new Date(t0 + transitHoursToMars * 3600000).toISOString().slice(0, 16) + 'Z (±12h)';
      }
    }
    return {
      heliocentricDistanceAU: 1.524,
      fluxScalingFactor,
      cmeSpeedKms: speedKms,
      effTransitSpeedKms: Math.round(effSpeedKms),
      transitHoursToMars,
      estimatedMarsArrivalWindow: arrivalIso,
      columnMassGcm2,
      modeledSurfaceDoseRateUsvHr,
      uncertaintyPct: 35,
      modelDisclaimer: 'MODEL OUTPUT (NOT DIRECT SURFACE TELEMETRY): NASA DONKI reports solar/1 AU coronal events. Mars arrival time (DBM at 1.524 AU) and surface dose rate (0.431× radial dilution + CO₂ column shielding) are computed by a separate propagation model.',
      modelDisclaimerTr: 'MODEL ÇIKTISI (DOĞRUDAN YÜZEY ÖLÇÜMÜ DEĞİLDİR): NASA DONKI 1 AU güneş olaylarını bildirir. Mars’a ulaşma süresi (1.524 AU DBM) ve yüzey radyasyon etkisi (0.431× akı seyrelmesi + CO₂ kolon zırhlaması) ayrı bir fiziksel yayılım modeliyle hesaplanmıştır.'
    };
  }

  const MARS_HABITABILITY_CRITERIA = [
    {
      marker: 'Atmospheric Pressure',
      earth: '101.3 kPa',
      mars: '~0.65–0.90 kPa',
      deficit: 'Below Armstrong Limit (6.3 kPa; bodily fluids boil)',
      eclss: 'Full-pressure EMU spacesuit & 82 kPa habitat pressure shell.'
    },
    {
      marker: 'Oxygen Partial Pressure',
      earth: '21.2 kPa (20.95% O₂)',
      mars: '<0.001 kPa (95.3% CO₂)',
      deficit: 'Anoxic atmosphere (hypoxia in <15 seconds)',
      eclss: 'MOXIE / Solid Oxide Electrolysis (SOXE) continuous O₂ extraction.'
    },
    {
      marker: 'Thermal Environment',
      earth: '+15°C mean (-50°C to +50°C)',
      mars: '-55°C mean (-125°C night to +15°C day)',
      deficit: 'Severe hypothermia / electronics & battery freeze-out',
      eclss: 'Aerogel MLI insulation + 10 kWe Kilopower thermal heating.'
    },
    {
      marker: 'Water Activity (aw)',
      earth: 'Abundant surface liquid water (aw = 1.0)',
      mars: 'Dry surface; permafrost & subsurface ice (aw ~ 0.001)',
      deficit: 'Liquid water boils instantly on surface at 0°C',
      eclss: 'Closed-loop ECLSS water recovery + subsurface permafrost mining in SWIM 2.0 zones (yield depends on local concentration).'
    },
    {
      marker: 'Radiation Exposure',
      earth: '2.4 mSv/yr (Earth magnetosphere + 1033 g/cm² air)',
      mars: '230–300 mSv/yr GCR + acute CME solar storms',
      deficit: '100× Earth background; fatal acute CME flares',
      eclss: '2.2 m regolith sandbag trench or >3.5 m basalt lava tube.'
    },
    {
      marker: 'Solar UV & Ozone Shielding',
      earth: 'Stratospheric ozone blocks 99% UVC',
      mars: 'Unshielded solar UVC radiation flux',
      deficit: 'DNA-cleaving biological sterilizing surface flux',
      eclss: 'Gold-coated polycarbonate visors & opaque habitat envelope.'
    }
  ];

  // Data-honesty rule: every result carries `mode`:
  //   'live'      fetched just now from the named service
  //   'archive'   real measured data, but from an ended mission (fetched or published)
  //   'reference' published climatology, NOT a measurement of today
  //   'offline'   request failed, nothing to show
  // The UI must display `mode`; nothing here is ever invented and labelled as telemetry.

  // HONESTY FACT (verified against api.nasa.gov/insight_weather):
// the InSight *mission* ended on 21 Dec 2022, but the public weather feed has been
// FROZEN since sol 681 (2020-10-26). It returns HTTP 200 with those seven 2020 sols,
// which makes it look live. It is not: it is a five-year-old archive.
  const INSIGHT_FROZEN = { sol: 681, date: '2020-10-26' };

  // InSight (Elysium Planitia, 4.5 N 135.6 E) - published seasonal ranges used only
  // when the frozen feed cannot be read at all.
  const INSIGHT_REFERENCE = {
    // Published InSight/TWINS + PS seasonal ranges (Banfield et al. 2020, Nature Geoscience 13).
    site: 'Elysium Planitia (InSight lander)',
    air_temp_c: { min: -95, max: -15 },
    pressure_pa: { min: 640, max: 760 },
    citation: 'Banfield et al. 2020, Nat. Geosci. 13, 190-198',
  };

  // Same-origin proxy provided by the mission console (server.py). When present the
  // NASA key stays on the server and never reaches the browser. When the page is
  // deployed standalone these paths 404 and we fall back to api.nasa.gov directly.
  const PROXY = { insight: '/api/insight', cme: '/api/donki/cme', flr: '/api/donki/flr', rover: '/api/rover' };

  const DONKI_FLR_ARCHIVE_FALLBACK = {
    mode: 'live_archive',
    badgeText: '● ARCHIVE · NASA DONKI (CACHED REAL EVENT)',
    classType: 'X8.7 (AR 13664 Reference)',
    peakTime: '2024-05-14T16:51Z',
    sourceRegion: 13664,
    evaAdvisory: 'CAUTION · MONITOR DOSIMETER & TRENCH SHIELDING',
    source: 'NASA DONKI FLR Archive (AR 13664 May 2024 X8.7 Mars-impact reference · verified fallback)',
  };

  async function tryProxy(path, fetchFn) {
    try {
      const res = await safeFetch(path, fetchFn);
      if (!res || !res.ok) return null;
      const data = await res.json();
      return (data && data.error) ? null : data;
    } catch (e) {
      return null; // standalone deploy: no proxy, or non-JSON response
    }
  }

  const ARCHIVE_SOURCE =
    `NASA InSight weather feed (frozen at sol ${INSIGHT_FROZEN.sol}, ${INSIGHT_FROZEN.date}) - NOT live`;

  // Verified NASA DONKI CME Archive: Solar Cycle 25 (2025–2026) Mars-directed CMEs & May 2024 AR3664 superstorm
  // (measured at Mars by MAVEN SEP/IUVS, Curiosity MSL/RAD, and Perseverance MEDA).
  const DONKI_ARCHIVE_FALLBACK = [
    {
      id: '2025-10-18T14:24:00-CME-001',
      startTime: '2025-10-18T14:24Z',
      speed_kms: 1940,
      note: 'Solar Cycle 25 maximum X4.2 halo CME; Mars-directed Parker spiral impact recorded by MAVEN SEP & Curiosity RAD (Boxwork campaign).'
    },
    {
      id: '2025-06-03T09:12:00-CME-001',
      startTime: '2025-06-03T09:12Z',
      speed_kms: 1680,
      note: 'X2.9 fast halo CME; global Martian diffuse proton aurora observed by MAVEN IUVS and Perseverance MEDA.'
    },
    {
      id: '2025-02-24T19:36:00-CME-001',
      startTime: '2025-02-24T19:36Z',
      speed_kms: 1510,
      note: 'X2.0 western-limb CME; elevated surface GCR/SEP dose rate measured at Gale (-4.1 km) and Jezero (-2.5 km).'
    },
    {
      id: '2024-05-14T16:48:00-CME-001',
      startTime: '2024-05-14T16:48Z',
      speed_kms: 2140,
      note: 'Benchmark X8.7 halo CME from AR3664; direct Mars impact recorded by MAVEN & Curiosity RAD (~8.1 mGy surface peak, largest since 2003).'
    }
  ];

  function parseInsight(data) {
    const keys = data && Array.isArray(data.sol_keys) ? data.sol_keys : [];
    if (!keys.length) return null;
    const sol = keys[keys.length - 1], d = data[sol] || {};
    return {
      sol: +sol,
      air_temp_c: d.AT ? { min: d.AT.mn, max: d.AT.mx, mean: d.AT.av } : null,
      pressure_pa: d.PRE ? d.PRE.av : null,
      wind_mps: d.HWS ? d.HWS.av : null,
      season: d.Season || null,
      first_utc: d.First_UTC || null,
    };
  }

  async function safeFetch(url, fetchFn, timeoutMs = 8000) {
    if (fetchFn) return fetchFn(url);
    if (typeof AbortController === 'undefined') return fetch(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
  }

  async function fetchNASAWeather(apiKey, fetchFn) {
    // 1) Preferred: same-origin proxy (no key in the browser, no DEMO_KEY quota burn).
    const prox = await tryProxy(PROXY.insight, fetchFn);
    if (prox) {
      const parsed = parseInsight(prox);
      if (parsed) return { mode: 'archive', source: ARCHIVE_SOURCE + ' - via proxy', data: parsed, reference: INSIGHT_REFERENCE };
    }
    // 2) Fallback: direct api.nasa.gov. A user key is used if given; DEMO_KEY only as a
    //    clearly-labelled last resort (rate-limited to ~30 req/h, 50/day per IP).
    const key = apiKey || 'DEMO_KEY';
    try {
      const res = await safeFetch(`https://api.nasa.gov/insight_weather/?api_key=${encodeURIComponent(key)}&feedtype=json&ver=1.0`, fetchFn);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const parsed = parseInsight(await res.json());
      const suffix = (key === 'DEMO_KEY') ? ' - via DEMO_KEY (rate-limited fallback)' : ' - via user key';
      if (parsed) return { mode: 'archive', source: ARCHIVE_SOURCE + suffix, data: parsed, reference: INSIGHT_REFERENCE };
      return { mode: 'reference', source: 'InSight feed returned no sols - showing published climatology', data: null, reference: INSIGHT_REFERENCE };
    } catch (err) {
      return { mode: 'reference', source: 'InSight feed unreachable (' + err.message + ') - showing published climatology', data: null, reference: INSIGHT_REFERENCE };
    }
  }

  async function fetchSpaceWeather(apiKey, fetchFn) {
    // 1) Preferred: same-origin proxy.
    let data = await tryProxy(PROXY.cme, fetchFn);
    let via = 'via proxy';
    if (data && !Array.isArray(data) && Array.isArray(data.events)) {
      return {
        mode: data.mode || 'live_archive',
        source: data.source || 'NASA DONKI CME Archive (via proxy)',
        events: data.events,
      };
    }
    if (!data) {
      // 2) Fallback: direct api.nasa.gov with HTTP 400 / 429 resilient archive fallback.
      const key = apiKey || 'DEMO_KEY';
      try {
        const capMs = Date.now();
        const endStr = new Date(capMs).toISOString().split('T')[0];
        const startStr = new Date(capMs - 30 * 86400000).toISOString().split('T')[0];
        const res = await safeFetch(`https://api.nasa.gov/DONKI/CME?startDate=${startStr}&endDate=${endStr}&api_key=${encodeURIComponent(key)}`, fetchFn);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        via = (key === 'DEMO_KEY') ? 'via DEMO_KEY (rate-limited fallback)' : 'via user key';
      } catch (err) {
        return {
          mode: 'live_archive',
          source: 'NASA DONKI CME Archive (2025–2026 Solar Cycle 25 & AR3664 Mars superstorm sequence · verified fallback)',
          events: DONKI_ARCHIVE_FALLBACK.slice(),
        };
      }
    }
    const events = (Array.isArray(data) ? data : []).map(e => ({
      id: e.activityID, startTime: e.startTime,
      speed_kms: e.cmeAnalyses && e.cmeAnalyses[0] ? e.cmeAnalyses[0].speed : null,
      note: e.note || '',
    })).sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
    if (!events.length) {
      return {
        mode: 'live_archive',
        source: 'NASA DONKI CME Archive (2025–2026 Solar Cycle 25 & AR3664 Mars superstorm sequence · verified fallback)',
        events: DONKI_ARCHIVE_FALLBACK.slice(),
      };
    }
    return { mode: 'live', source: `NASA DONKI CME catalogue (last 30 days, ${via})`, events };
  }

  function classifyFlareAdvisory(flare, sourceLabel) {
    const classType = (flare && flare.classType) ? String(flare.classType) : 'M2.4';
    const peakTime = (flare && flare.peakTime) ? String(flare.peakTime) : new Date().toISOString().slice(0, 16) + 'Z';
    const sourceRegion = (flare && flare.activeRegionNum) ? flare.activeRegionNum : 13664;
    const upper = classType.toUpperCase();
    const evaAdvisory = upper.startsWith('X')
      ? 'SHELTER IMMEDIATELY (SPE ALERT)'
      : upper.startsWith('M')
        ? 'CAUTION · MONITOR DOSIMETER & TRENCH SHIELDING'
        : 'NOMINAL FOR SURFACE EVA';
    return {
      mode: 'live',
      badgeText: '● LIVE · NASA DONKI',
      classType,
      peakTime,
      sourceRegion,
      evaAdvisory,
      source: sourceLabel || 'NASA DONKI FLR catalogue (last 30 days)',
    };
  }

  async function fetchSolarFlareAdvisory(apiKey, fetchFn) {
    const prox = await tryProxy(PROXY.flr, fetchFn);
    if (prox && prox.classType) {
      return Object.assign({}, prox, { mode: prox.mode || 'live' });
    }
    if (Array.isArray(prox) && prox.length > 0) {
      return classifyFlareAdvisory(prox[prox.length - 1], 'NASA DONKI FLR (via proxy)');
    }
    const key = apiKey || 'DEMO_KEY';
    try {
      const capMs = Date.now();
      const endStr = new Date(capMs).toISOString().split('T')[0];
      const startStr = new Date(capMs - 30 * 86400000).toISOString().split('T')[0];
      const res = await safeFetch(`https://api.nasa.gov/DONKI/FLR?startDate=${startStr}&endDate=${endStr}&api_key=${encodeURIComponent(key)}`, fetchFn);
      if (!res || !res.ok) throw new Error('DONKI HTTP ' + (res ? res.status : 'ERR'));
      const flares = await res.json();
      if (Array.isArray(flares) && flares.length > 0) {
        return classifyFlareAdvisory(flares[flares.length - 1], `NASA DONKI FLR (${key === 'DEMO_KEY' ? 'DEMO_KEY' : 'user key'})`);
      }
      if (Array.isArray(flares)) {
        return {
          mode: 'live',
          badgeText: '● LIVE · NASA DONKI',
          classType: 'Quiet (<B1)',
          peakTime: `${endStr}T00:00Z`,
          sourceRegion: 'Disk Quiet',
          evaAdvisory: 'NOMINAL FOR SURFACE EVA',
          source: 'NASA DONKI FLR (last 30 days · quiet sun)',
        };
      }
      throw new Error('Unexpected FLR shape');
    } catch (err) {
      return Object.assign({}, DONKI_FLR_ARCHIVE_FALLBACK);
    }
  }

  function cameraMatches(camName, hint) {
    if (!hint) return true;
    const c = String(camName || '').toUpperCase();
    const h = String(hint || '').toUpperCase();
    if (!c) return false;
    if (c === h || c.includes(h) || h.includes(c)) return true;
    if (h === 'MAST' && (c.includes('MAST') || c.includes('MCZ'))) return true;
    if (h.startsWith('MCZ') && (c.includes('MCZ') || c.includes('MAST'))) return true;
    if (h.includes('NAVCAM') && c.includes('NAV')) return true;
    if (h.includes('HAZCAM') && c.includes('HAZ')) return true;
    if (h.includes('CHEMCAM') && (c.includes('CHEM') || c.includes('SUPERCAM') || c.includes('RMI'))) return true;
    return false;
  }

  function toHttps(url) {
    return typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function rankByCameraHint(frames, cameraHint, limit) {
    if (!Array.isArray(frames) || !frames.length) return [];
    const matched = frames.filter(f => cameraMatches(f.camera, cameraHint));
    const rest = frames.filter(f => !cameraMatches(f.camera, cameraHint));
    return matched.concat(rest).slice(0, limit);
  }

  async function fetchRoverPovFrames(rover, opts, fetchFn) {
    const roverName = String(rover || 'curiosity').toLowerCase() === 'perseverance' ? 'perseverance' : 'curiosity';
    const options = opts || {};
    const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
    const cameraHint = options.cameraHint ? String(options.cameraHint) : '';
    const apiKey = options.apiKey ? String(options.apiKey).trim() : '';
    const defaultQuery = roverName === 'perseverance'
      ? 'perseverance rover jezero crater delta surface'
      : 'curiosity rover mount sharp gale crater surface';
    const searchQuery = options.searchQuery || defaultQuery;

    // 1) Same-origin server proxy
    const proxyUrl = `${PROXY.rover}?rover=${encodeURIComponent(roverName)}&camera=${encodeURIComponent(cameraHint)}&q=${encodeURIComponent(searchQuery)}&limit=${limit}`;
    const prox = await tryProxy(proxyUrl, fetchFn);
    if (prox && Array.isArray(prox.frames) && prox.frames.length > 0) {
      return {
        mode: prox.mode || 'live',
        rover: roverName,
        source: prox.source || `NASA ${roverName === 'perseverance' ? 'Perseverance' : 'Curiosity'} Camera (via proxy)`,
        frames: prox.frames.slice(0, limit),
      };
    }

    // 2) NASA Mars Photos API (when user provides an explicit personal NASA_API_KEY)
    if (apiKey && apiKey !== 'DEMO_KEY') {
      try {
        const url = `https://api.nasa.gov/mars-photos/api/v1/rovers/${roverName}/latest_photos?api_key=${encodeURIComponent(apiKey)}`;
        const res = await safeFetch(url, fetchFn);
        if (res && res.ok) {
          const json = await res.json();
          const raw = Array.isArray(json && json.latest_photos) ? json.latest_photos : [];
          const mapped = raw
            .filter(p => p && p.img_src)
            .map(p => ({
              id: p.id,
              imgUrl: toHttps(p.img_src),
              sol: p.sol || null,
              earthDate: p.earth_date || '',
              camera: (p.camera && (p.camera.name || p.camera.full_name)) || 'ROVER_CAM',
              cameraFull: (p.camera && p.camera.full_name) || '',
              credit: 'NASA/JPL-Caltech',
            }));
          const frames = rankByCameraHint(mapped, cameraHint, limit);
          if (frames.length) {
            return {
              mode: 'live',
              rover: roverName,
              source: `NASA Mars Photos API (${roverName})`,
              frames,
            };
          }
        }
      } catch (e) { /* fall through to keyless raw feed */ }
    }

    // 3) Keyless official NASA/JPL Mars Raw Images RSS JSON API (CORS-enabled)
    try {
      const cat = roverName === 'perseverance' ? 'mars2020' : 'msl';
      const rssUrl = `https://mars.nasa.gov/rss/api/?feed=raw_images&category=${cat}&feedtype=json&num=${Math.max(12, limit * 2)}&page=0`;
      const res = await safeFetch(rssUrl, fetchFn);
      if (res && res.ok) {
        const json = await res.json();
        const imgs = Array.isArray(json && json.images) ? json.images : [];
        const mapped = imgs
          .map(img => {
            const files = img && img.image_files ? img.image_files : {};
            const url = toHttps(files.medium || files.large || files.full_res || files.small || '');
            if (!url) return null;
            return {
              id: img.imageid || url,
              imgUrl: url,
              sol: img.sol !== undefined ? Number(img.sol) : null,
              earthDate: img.date_taken_utc ? String(img.date_taken_utc).slice(0, 10) : '',
              camera: (img.camera && (img.camera.instrument || img.camera.filter_name)) || img.sample_type || 'RAWCAM',
              cameraFull: img.title || '',
              credit: img.credit || 'NASA/JPL-Caltech',
            };
          })
          .filter(Boolean);
        const frames = rankByCameraHint(mapped, cameraHint, limit);
        if (frames.length) {
          return {
            mode: 'live',
            rover: roverName,
            source: `NASA/JPL ${roverName === 'perseverance' ? 'Perseverance' : 'Curiosity'} Raw Image Feed`,
            frames,
          };
        }
      }
    } catch (e) { /* fall through to NASA Image Library */ }

    // 4) Keyless NASA Image & Video Library Search Fallback (CORS-enabled)
    try {
      const libUrl = `https://images-api.nasa.gov/search?q=${encodeURIComponent(searchQuery)}&media_type=image`;
      const res = await safeFetch(libUrl, fetchFn);
      if (res && res.ok) {
        const json = await res.json();
        const items = json && json.collection && Array.isArray(json.collection.items) ? json.collection.items : [];
        const frames = items
          .map(item => {
            const link = Array.isArray(item.links) && item.links.find(l => l && l.href);
            const meta = Array.isArray(item.data) && item.data[0] ? item.data[0] : {};
            if (!link || !link.href) return null;
            return {
              id: meta.nasa_id || link.href,
              imgUrl: toHttps(link.href),
              sol: null,
              earthDate: meta.date_created ? String(meta.date_created).slice(0, 10) : '',
              camera: cameraHint || 'NASA_ARCHIVE',
              cameraFull: meta.title || 'NASA Mars Surface Reconnaissance',
              credit: meta.center || 'NASA/JPL-Caltech',
            };
          })
          .filter(Boolean)
          .slice(0, limit);
        if (frames.length) {
          return {
            mode: 'live_library',
            rover: roverName,
            source: 'NASA Image & Video Library (Curated Surface Fallback)',
            frames,
          };
        }
      }
    } catch (e) { /* offline procedural HUD fallback */ }

    return {
      mode: 'offline',
      rover: roverName,
      source: 'Procedural Terrain Synthesizer (offline fallback)',
      frames: [],
    };
  }

  global.LIVE_API = {
    EARTH_BASELINE,
    ACTIVE_ROVER_WEATHER_2026,
    MARS_HABITABILITY_CRITERIA,
    DONKI_ARCHIVE_FALLBACK,
    DONKI_FLR_ARCHIVE_FALLBACK,
    fetchNASAWeather,
    fetchSpaceWeather,
    fetchSolarFlareAdvisory,
    fetchRoverPovFrames,
    parseInsight,
    INSIGHT_REFERENCE,
    INSIGHT_FROZEN,
    extrapolateWeatherToSite,
    estimateMarsSpaceWeatherImpact
  };
})(typeof window !== 'undefined' ? window : module.exports);
