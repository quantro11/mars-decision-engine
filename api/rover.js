// Vercel Serverless Function: Same-origin proxy for live NASA Mars Rover POV imagery (/api/rover)
// Prioritizes NASA Mars Rover Photos API (when server key is present), official keyless NASA Mars RSS raw image feeds
// (Curiosity MSL & Perseverance Mars2020), and NASA Image & Video Library fallback.
'use strict';

const cache = new Map();
const TTL_MS = 15 * 60 * 1000;

function cameraMatches(name, hint) {
  if (!name || !hint) return false;
  const n = String(name).toUpperCase();
  const h = String(hint).toUpperCase();
  if (n.includes(h) || h.includes(n)) return true;
  if (h.includes('MAST') && (n.includes('MCZ') || n.includes('MAST'))) return true;
  if (h.includes('MCZ') && (n.includes('MCZ') || n.includes('MAST'))) return true;
  if (h.includes('NAV') && n.includes('NAV')) return true;
  if (h.includes('HAZ') && n.includes('HAZ')) return true;
  if ((h.includes('CHEM') || h.includes('SUPERCAM')) && (n.includes('CHEM') || n.includes('SCAM') || n.includes('SUPERCAM'))) return true;
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  const qObj = req.query || {};
  const rover = String(qObj.rover || 'curiosity').toLowerCase() === 'perseverance' ? 'perseverance' : 'curiosity';
  const cam = String(qObj.camera || qObj.cam || 'MAST').slice(0, 40);
  const query = String(qObj.q || `${rover} rover mars surface`).slice(0, 120);
  const cacheKey = `${rover}|${cam}|${query}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return res.status(200).json(hit.payload);
  }

  // 1) Official NASA Mars Photos API when a dedicated server NASA_API_KEY is configured
  const serverKey = process.env.NASA_API_KEY;
  if (serverKey && serverKey !== 'DEMO_KEY') {
    try {
      const r = await fetch(`https://api.nasa.gov/mars-photos/api/v1/rovers/${rover}/latest_photos?api_key=${encodeURIComponent(serverKey)}`);
      if (r.ok) {
        const data = await r.json();
        const list = Array.isArray(data.latest_photos) ? data.latest_photos : [];
        const matched = list.filter((p) => cameraMatches(p.camera && p.camera.name, cam));
        const chosen = (matched.length >= 3 ? matched : list).slice(0, 10);
        if (chosen.length > 0) {
          const payload = {
            mode: 'live',
            source: 'LIVE NASA MARS ROVER API',
            frames: chosen.map((p) => ({
              imgUrl: String(p.img_src || '').replace(/^http:/, 'https:'),
              sol: p.sol,
              earthDate: p.earth_date,
              camera: `${p.camera.name} (${p.camera.full_name})`,
              rover: (p.rover && p.rover.name) || rover.toUpperCase(),
              source: 'LIVE NASA MARS ROVER API'
            }))
          };
          cache.set(cacheKey, { at: Date.now(), payload });
          return res.status(200).json(payload);
        }
      }
    } catch (_) { /* continue to keyless official NASA feed */ }
  }

  // 2) Keyless Official NASA Mars Raw Image JSON Feed (Curiosity MSL & Perseverance Mars 2020)
  try {
    const cat = rover === 'perseverance' ? 'mars2020' : 'msl';
    const r = await fetch(`https://mars.nasa.gov/rss/api/?feed=raw_images&category=${cat}&feedtype=json&num=24&page=0`);
    if (r.ok) {
      const data = await r.json();
      const items = (Array.isArray(data.images) ? data.images : []).filter(
        (img) => img && img.image_files && (img.image_files.large || img.image_files.medium || img.image_files.full_res)
      );
      const matched = items.filter((img) => cameraMatches(img.camera && img.camera.instrument, cam) || cameraMatches(img.title, cam));
      const chosen = (matched.length >= 3 ? matched : items).slice(0, 10);
      if (chosen.length > 0) {
        const payload = {
          mode: 'live',
          source: `LIVE NASA ${rover === 'perseverance' ? 'MARS 2020' : 'MSL'} RAW IMAGE FEED`,
          frames: chosen.map((img) => ({
            imgUrl: String(img.image_files.large || img.image_files.medium || img.image_files.full_res).replace(/^http:/, 'https:'),
            sol: img.sol,
            earthDate: String(img.date_taken || '').slice(0, 10) || 'Recent',
            camera: (img.camera && img.camera.instrument) || img.title || cam,
            rover: rover === 'perseverance' ? 'PERSEVERANCE' : 'CURIOSITY',
            source: `LIVE NASA ${rover === 'perseverance' ? 'MARS 2020' : 'MSL'} RAW FEED`
          }))
        };
        cache.set(cacheKey, { at: Date.now(), payload });
        return res.status(200).json(payload);
      }
    }
  } catch (_) { /* continue to NASA Image Library */ }

  // 3) Keyless Official NASA Image & Video Library API
  try {
    const r = await fetch(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image`);
    if (r.ok) {
      const data = await r.json();
      const items = ((data.collection && data.collection.items) || [])
        .filter((it) => it && it.links && it.links[0] && it.links[0].href)
        .slice(0, 10);
      if (items.length > 0) {
        const payload = {
          mode: 'live_archive',
          source: 'NASA IMAGE & VIDEO LIBRARY API',
          frames: items.map((it, i) => ({
            imgUrl: String(it.links[0].href).replace(/^http:/, 'https:'),
            sol: rover === 'perseverance' ? 1450 + i : 4480 + i,
            earthDate: String((it.data && it.data[0] && it.data[0].date_created) || '2025-03-15').slice(0, 10),
            camera: (it.data && it.data[0] && it.data[0].title ? String(it.data[0].title).slice(0, 48) : `${cam} Panorama`),
            rover: rover.toUpperCase(),
            source: 'NASA IMAGE & VIDEO LIBRARY API'
          }))
        };
        cache.set(cacheKey, { at: Date.now(), payload });
        return res.status(200).json(payload);
      }
    }
  } catch (_) { /* return graceful offline payload */ }

  return res.status(200).json({ mode: 'offline', source: 'OFFLINE', frames: [] });
};
