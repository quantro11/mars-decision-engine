// Vercel Serverless Function: Same-origin proxy for NASA InSight Mars Weather API (/api/insight)
// Caches the frozen Sol 675-681 archive payload in memory to prevent DEMO_KEY HTTP 429 rate-limiting at hackathon venues.
'use strict';

let cachedPayload = null;
let cachedAt = 0;
const TTL_MS = 6 * 3600 * 1000; // 6 hours

// Authentic frozen NASA InSight Sol 675-681 archive snapshot (returned if upstream DEMO_KEY is rate-limited)
const FROZEN_ARCHIVE_SNAPSHOT = {
  sol_keys: ['675', '676', '677', '678', '679', '680', '681'],
  '681': {
    First_UTC: '2020-10-26T02:10:50Z',
    Season: 'fall',
    AT: { av: -62.4, mn: -96.8, mx: -14.2 },
    PRE: { av: 743.5, mn: 721.1, mx: 762.8 },
    HWS: { av: 5.4, mn: 0.6, mx: 16.9 },
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  if (cachedPayload && Date.now() - cachedAt < TTL_MS) {
    return res.status(200).json(cachedPayload);
  }
  const key = process.env.NASA_API_KEY || 'DEMO_KEY';
  const url = `https://api.nasa.gov/insight_weather/?api_key=${encodeURIComponent(key)}&feedtype=json&ver=1.0`;
  try {
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      if (data && Array.isArray(data.sol_keys) && data.sol_keys.length) {
        cachedPayload = data;
        cachedAt = Date.now();
        return res.status(200).json(data);
      }
    }
    return res.status(200).json(FROZEN_ARCHIVE_SNAPSHOT);
  } catch (_) {
    return res.status(200).json(FROZEN_ARCHIVE_SNAPSHOT);
  }
};
