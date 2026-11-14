// ONLINE-ONLY Vercel Serverless Proxy for ASU JMARS WMS numeric VICAR layers (/api/wms)
// Parses VICAR scientific rasters on the server into compact JSON for browser 16 km2 grid requests.
'use strict';

const ALLOWED_LAYERS = new Set([
  'thm_ti_100m_32bit',
  'mola_hrsc_blend_topo_v2',
  'mola_hrsc_blend_slope_v2',
  'TES_dust_index_16ppd_numeric',
  'TES_Lambert_Albedo_numeric',
  'omega_albedo_r1080',
  'GRS_K_conc_numeric',
  'GRS_Th_conc_numeric',
  'mgs_geologic_map_mars_usgs_numeric',
]);

function parseVicar(buf) {
  const headStr = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
  if (!headStr.startsWith('LBLSIZE=')) {
    throw new Error('Upstream did not return a VICAR raster');
  }
  const match = (re, def) => {
    const m = headStr.match(re);
    return m ? m[1] : def;
  };
  const lblSize = parseInt(match(/LBLSIZE=(\d+)/, '0'), 10);
  const hdr = buf.subarray(0, lblSize).toString('latin1');
  const mHdr = (re, def) => {
    const m = hdr.match(re);
    return m ? m[1] : def;
  };
  const fmt = mHdr(/FORMAT='([^']+)'/, '');
  const intFmt = mHdr(/INTFMT='([^']+)'/, 'HIGH');
  const realFmt = mHdr(/REALFMT='([^']+)'/, 'IEEE');
  const ns = parseInt(mHdr(/\bNS=(\d+)/, '0'), 10);
  const nl = parseInt(mHdr(/\bNL=(\d+)/, '0'), 10);
  const nbb = parseInt(mHdr(/\bNBB=(\d+)/, '0'), 10);
  const nlb = parseInt(mHdr(/\bNLB=(\d+)/, '0'), 10);
  const bpe = fmt === 'DOUB' ? 8 : fmt === 'REAL' ? 4 : fmt === 'HALF' ? 2 : 1;
  const recSize = parseInt(mHdr(/\bRECSIZE=(\d+)/, String(ns * bpe)), 10);
  const leReal = realFmt === 'RIEEE';
  const leInt = intFmt === 'LOW';
  const baseOff = lblSize + nlb * recSize;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const values = new Array(ns * nl);
  for (let r = 0; r < nl; r++) {
    const rowOff = baseOff + r * recSize + nbb;
    for (let c = 0; c < ns; c++) {
      const p = rowOff + c * bpe;
      let v = 0;
      if (fmt === 'REAL') v = dv.getFloat32(p, leReal);
      else if (fmt === 'DOUB') v = dv.getFloat64(p, leReal);
      else if (fmt === 'HALF') v = dv.getInt16(p, leInt);
      else if (fmt === 'BYTE') v = dv.getUint8(p);
      else throw new Error('Unsupported VICAR format: ' + fmt);
      values[r * ns + c] = Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
    }
  }
  return { width: ns, height: nl, fmt, values };
}

async function handler(req, res) {
  const layer = String(req.query.layer || '');
  if (!ALLOWED_LAYERS.has(layer)) {
    return res.status(400).json({ error: 'Unsupported WMS layer requested' });
  }
  const rawBox = String(req.query.bbox || '').split(',').map(Number);
  if (rawBox.length !== 4 || rawBox.some((x) => !Number.isFinite(x))) {
    return res.status(400).json({ error: 'Invalid bbox parameter' });
  }
  const [lon0, lat0, lon1, lat1] = rawBox;
  if (lat0 < -90 || lat1 > 90 || lat0 >= lat1 || lon0 >= lon1 || lon1 - lon0 > 5 || lat1 - lat0 > 5) {
    return res.status(400).json({ error: 'BBOX out of tactical range (max 5 deg span)' });
  }
  const size = Math.max(4, Math.min(80, parseInt(req.query.size || '40', 10) || 40));

  // JMARS rejects percent-encoded image%2Fvicar, so pass literal FORMAT=image/vicar
  const url =
    `https://ms-mars.mars.asu.edu/?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(layer)}&STYLES=&SRS=EPSG:4326` +
    `&BBOX=${lon0.toFixed(6)},${lat0.toFixed(6)},${lon1.toFixed(6)},${lat1.toFixed(6)}` +
    `&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/vicar`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    const upstream = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MarsDecisionEngine/2.0' } });
    clearTimeout(timer);
    if (!upstream.ok) {
      return res.status(502).json({ error: `JMARS WMS HTTP ${upstream.status}` });
    }
    const arrBuf = await upstream.arrayBuffer();
    const parsed = parseVicar(Buffer.from(arrBuf));
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ ok: true, layer, bbox: rawBox, ...parsed });
  } catch (err) {
    return res.status(502).json({ error: err && err.message ? err.message : 'JMARS WMS request failed' });
  }
}

module.exports = handler;
module.exports.parseVicar = parseVicar;
module.exports.ALLOWED_LAYERS = ALLOWED_LAYERS;
