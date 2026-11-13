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

  // InSight (Elysium Planitia, 4.5 N 135.6 E) ended on 21 Dec 2022, so this feed can only ever return archive sols.
  const INSIGHT_REFERENCE = {
    // Published InSight/TWINS + PS seasonal ranges (Banfield et al. 2020, Nature Geoscience 13).
    site: 'Elysium Planitia (InSight lander)',
    air_temp_c: { min: -95, max: -15 },
    pressure_pa: { min: 640, max: 760 },
    citation: 'Banfield et al. 2020, Nat. Geosci. 13, 190-198',
  };

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

  async function fetchNASAWeather(apiKey, fetchFn) {
    const key = apiKey || 'DEMO_KEY', f = fetchFn || fetch;
    try {
      const res = await f(`https://api.nasa.gov/insight_weather/?api_key=${encodeURIComponent(key)}&feedtype=json&ver=1.0`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const parsed = parseInsight(await res.json());
      if (parsed) return { mode: 'archive', source: 'NASA InSight Mars Weather API (mission ended Dec 2022)', data: parsed, reference: INSIGHT_REFERENCE };
      return { mode: 'reference', source: 'InSight feed returned no sols - showing published climatology', data: null, reference: INSIGHT_REFERENCE };
    } catch (err) {
      return { mode: 'reference', source: 'InSight feed unreachable (' + err.message + ') - showing published climatology', data: null, reference: INSIGHT_REFERENCE };
    }
  }

  async function fetchSpaceWeather(apiKey, fetchFn) {
    const key = apiKey || 'DEMO_KEY', f = fetchFn || fetch;
    try {
      const past = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const res = await f(`https://api.nasa.gov/DONKI/CME?startDate=${past}&api_key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const events = (Array.isArray(data) ? data : []).map(e => ({
        id: e.activityID, startTime: e.startTime,
        speed_kms: e.cmeAnalyses && e.cmeAnalyses[0] ? e.cmeAnalyses[0].speed : null,
        note: e.note || '',
      })).sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
      return { mode: 'live', source: 'NASA DONKI CME catalogue (last 30 days)', events };
    } catch (err) {
      return { mode: 'offline', source: 'NASA DONKI unreachable (' + err.message + ')', events: [] };
    }
  }

  global.LIVE_API = {
    EARTH_BASELINE,
    MARS_HABITABILITY_CRITERIA,
    fetchNASAWeather,
    fetchSpaceWeather,
    parseInsight,
    INSIGHT_REFERENCE
  };
})(typeof window !== 'undefined' ? window : module.exports);
