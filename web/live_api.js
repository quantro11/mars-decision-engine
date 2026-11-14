// Live NASA Planetary & Space Weather APIs + Earth vs. Mars Habitability Engine
// Bridges real NASA Open APIs (api.nasa.gov) with planetary life-support requirements.
(function (global) {
  'use strict';

  const EARTH_BASELINE = {
    pressure_kpa: 101.3,
    o2_pct: 20.95,
    co2_ppm: 420,
    mean_temp_c: 15.0,
    water_availability: 'Global liquid oceans & rainfall (aw = 1.0)',
    radiation_msv_yr: 2.4,
    uv_index: '1–11 (Ozone-shielded)',
    magnetic_field_ut: 45.0,
    gravity_g: 1.0,
  };

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
      eclss: 'SWIM 2.0 permafrost thermal well (ISRU 45+ L/sol extraction).'
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
  const PROXY = { insight: '/api/insight', cme: '/api/donki/cme' };

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
    if (!data) {
      // 2) Fallback: direct api.nasa.gov (user key, else DEMO_KEY as last resort).
      const key = apiKey || 'DEMO_KEY';
      try {
        const past = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const res = await safeFetch(`https://api.nasa.gov/DONKI/CME?startDate=${past}&api_key=${encodeURIComponent(key)}`, fetchFn);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        via = (key === 'DEMO_KEY') ? 'via DEMO_KEY (rate-limited fallback)' : 'via user key';
      } catch (err) {
        return { mode: 'offline', source: 'NASA DONKI unreachable (' + err.message + ')', events: [] };
      }
    }
    const events = (Array.isArray(data) ? data : []).map(e => ({
      id: e.activityID, startTime: e.startTime,
      speed_kms: e.cmeAnalyses && e.cmeAnalyses[0] ? e.cmeAnalyses[0].speed : null,
      note: e.note || '',
    })).sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
    return { mode: 'live', source: `NASA DONKI CME catalogue (last 30 days, ${via})`, events };
  }

  global.LIVE_API = {
    EARTH_BASELINE,
    MARS_HABITABILITY_CRITERIA,
    fetchNASAWeather,
    fetchSpaceWeather,
    parseInsight,
    INSIGHT_REFERENCE,
    INSIGHT_FROZEN
  };
})(typeof window !== 'undefined' ? window : module.exports);
