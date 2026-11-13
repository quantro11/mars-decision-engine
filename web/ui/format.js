// Pure formatting helpers (no DOM, no app state).
(function (global) {
  'use strict';
  // Distinct, readable candidate names: exact region if within 2 deg, otherwise a compass sector of the nearest region.
  function candidateName(lat, lon, nr) {
    if (nr.distDeg < 2) return nr.region.name;
    const r = nr.region; let dlon = lon - r.lon; if (dlon > 180) dlon -= 360; if (dlon < -180) dlon += 360;
    const dlat = lat - r.lat, ew = dlon * Math.cos(lat * Math.PI / 180);
    const dir = (Math.abs(dlat) > Math.abs(ew) * 2 ? '' : (ew > 0 ? 'E' : 'W')); const ns = (Math.abs(ew) > Math.abs(dlat) * 2 ? '' : (dlat > 0 ? 'N' : 'S'));
    return `${ns}${dir} of ${r.name.replace(/ \(.*\)$/, '')} · ${(nr.distDeg * 59.3).toFixed(0)} km`;
  }
  const trekUrl = (lat, lon) => `https://trek.nasa.gov/mars/#v=0.1&x=${lon.toFixed(3)}&y=${lat.toFixed(3)}&z=7&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=`;
  const fmtLat = (la) => `${Math.abs(la).toFixed(1)}°${la >= 0 ? 'N' : 'S'}`;
  const fmtLon = (lo) => `${Math.abs(lo).toFixed(1)}°${lo >= 0 ? 'E' : 'W'}`;
  const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  global.MDE_FMT = { candidateName, trekUrl, fmtLat, fmtLon, escHtml };
})(typeof window !== 'undefined' ? window : module.exports);
