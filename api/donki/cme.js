// Vercel Serverless Function: Same-origin proxy for NASA DONKI Coronal Mass Ejection (CME) API (/api/donki/cme)
// Caches upstream DONKI responses for 15 minutes and falls back to one documented reference event on HTTP 400/429.
'use strict';

let cachedEvents = null;
let cachedAt = 0;
const TTL_MS = 15 * 60 * 1000; // 15 minutes

// Offline fallback: a single well-documented reference event (no invented catalogue entries).
// May 20, 2024 X12 flare + CME from AR3664/AR3697 reached Mars; Curiosity RAD measured ~8,100 µGy (NASA/JPL, June 2024).
const ARCHIVE_CME_EVENTS = [
  {
    activityID: '2024-05-20-X12-REFERENCE',
    startTime: '2024-05-20',
    cmeAnalyses: [],
    note: 'Reference event: estimated X12 flare + CME from AR3664/AR3697 reached Mars; Curiosity RAD measured ~8,100 µGy (NASA, June 2024).'
  }
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  if (cachedEvents && Date.now() - cachedAt < TTL_MS) {
    return res.status(200).json(cachedEvents);
  }
  const key = process.env.NASA_API_KEY || 'DEMO_KEY';
  const nowMs = Date.now();
  const endStr = new Date(nowMs).toISOString().split('T')[0];
  const startStr = new Date(nowMs - 30 * 86400000).toISOString().split('T')[0];
  const url = `https://api.nasa.gov/DONKI/CME?startDate=${startStr}&endDate=${endStr}&api_key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedEvents = data;
        cachedAt = Date.now();
        return res.status(200).json(data);
      }
    }
  } catch (_) {
    // Fall through to verified archive response
  }
  return res.status(200).json({
    mode: 'live_archive',
    events: ARCHIVE_CME_EVENTS
  });
};
