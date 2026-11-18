// ONLINE Vercel Serverless Proxy for Autonomous Earth Disaster & Road Status Feeds (/api/earth_feed)
// Aggregates real-time USGS Earthquake epicenters, Open-Meteo precipitation, and OSRM road geometry.
'use strict';

function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  while (index < str.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    coordinates.push({ lat: +(lat / 1e5).toFixed(4), lon: +(lng / 1e5).toFixed(4) });
  }
  return coordinates;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'MartiapDecisionEngine/2.4 (AFAD-Earth-Logistics)' }
    });
    clearTimeout(timer);
    return resp;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function handler(req, res) {
  const mode = String((req.query && req.query.mode) || 'status');

  if (mode === 'osrm') {
    const sLat = parseFloat(req.query.sLat), sLon = parseFloat(req.query.sLon);
    const gLat = parseFloat(req.query.gLat), gLon = parseFloat(req.query.gLon);
    if (![sLat, sLon, gLat, gLon].every(Number.isFinite)) {
      return res.status(400).json({ ok: false, error: 'Invalid coordinates' });
    }
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${sLon.toFixed(4)},${sLat.toFixed(4)};${gLon.toFixed(4)},${gLat.toFixed(4)}?overview=simplified`;
      const r = await fetchWithTimeout(url, 7000);
      if (!r.ok) return res.status(502).json({ ok: false, error: `OSRM HTTP ${r.status}` });
      const data = await r.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
        return res.status(200).json({ ok: false, error: 'No OSRM route' });
      }
      const rt = data.routes[0];
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({
        ok: true,
        distKm: +(rt.distance / 1000).toFixed(2),
        durationMin: Math.round(rt.duration / 60),
        path: decodePolyline(rt.geometry)
      });
    } catch (err) {
      return res.status(502).json({ ok: false, error: err && err.message ? err.message : 'OSRM failed' });
    }
  }

  // Default: mode === 'status' (USGS Earthquakes + Open-Meteo Precipitation)
  const lat = Number.isFinite(parseFloat(req.query && req.query.lat)) ? parseFloat(req.query.lat) : 36.20;
  const lon = Number.isFinite(parseFloat(req.query && req.query.lon)) ? parseFloat(req.query.lon) : 36.16;

  const quakes = [];
  let precipitationMm = null, windKmH = null;

  await Promise.allSettled([
    (async () => {
      const usgsUrl = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=3.5&limit=15&minlatitude=30&maxlatitude=44&minlongitude=24&maxlongitude=46';
      const r = await fetchWithTimeout(usgsUrl, 6000);
      if (r.ok) {
        const gj = await r.json();
        for (const f of (gj.features || []).slice(0, 12)) {
          const c = (f.geometry && f.geometry.coordinates) || [];
          const p = f.properties || {};
          if (Number.isFinite(c[1]) && Number.isFinite(c[0])) {
            quakes.push({
              lat: +c[1].toFixed(3),
              lon: +c[0].toFixed(3),
              mag: +(p.mag || 0).toFixed(1),
              place: String(p.place || 'Anadolu / Akdeniz Sismik Kuşağı').slice(0, 60),
              time: p.time || Date.now()
            });
          }
        }
      }
    })(),
    (async () => {
      const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=precipitation,wind_speed_10m`;
      const r = await fetchWithTimeout(meteoUrl, 5000);
      if (r.ok) {
        const mj = await r.json();
        if (mj && mj.current) {
          precipitationMm = mj.current.precipitation;
          windKmH = mj.current.wind_speed_10m;
        }
      }
    })()
  ]);

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  return res.status(200).json({
    ok: true,
    syncedAt: new Date().toISOString(),
    quakes,
    precipitationMm,
    windKmH
  });
}

module.exports = handler;
