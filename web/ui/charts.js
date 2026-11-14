// Inline SVG charts: elevation profile (route) and battery / optical depth (dust storm). Pure string builders.
(function (global) {
  'use strict';
  function profileSVG(p) {
    const w = 276, h = 118, pad = 42;
    const kmMax = p[p.length - 1].km || 1, eMin = Math.min(...p.map(q => q.elev)), eMax = Math.max(...p.map(q => q.elev)) + 1;
    const X = (km) => pad + (km / kmMax) * (w - pad - 8), Y = (e) => h - 18 - ((e - eMin) / (eMax - eMin)) * (h - 30);
    let d = '', segs = '';
    p.forEach((q, i) => { d += (i ? 'L' : 'M') + X(q.km).toFixed(1) + ',' + Y(q.elev).toFixed(1); });
    const areaD = `${d}L${X(kmMax).toFixed(1)},${h - 18}L${X(0).toFixed(1)},${h - 18}Z`;
    p.forEach((q, i) => { if (i && q.slope > 10) segs += `<line x1="${X(p[i - 1].km).toFixed(1)}" y1="${Y(p[i - 1].elev).toFixed(1)}" x2="${X(q.km).toFixed(1)}" y2="${Y(q.elev).toFixed(1)}" stroke="#f59e0b" stroke-width="2.8"/>`; });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">
      <line x1="${pad}" y1="12" x2="${w - 8}" y2="12" stroke="rgba(236,231,223,.08)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${(h - 6) / 2}" x2="${w - 8}" y2="${(h - 6) / 2}" stroke="rgba(236,231,223,.08)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${h - 18}" x2="${w - 8}" y2="${h - 18}" stroke="rgba(236,231,223,.16)"/>
      <path d="${areaD}" fill="rgba(16, 185, 129, 0.12)"/>
      <path d="${d}" fill="none" stroke="#10b981" stroke-width="1.6"/>${segs}
      <text x="${pad - 4}" y="15" text-anchor="end" fill="#9ca3af" font-size="8.5" font-family="IBM Plex Mono, monospace">${(eMax / 1000).toFixed(1)}km</text>
      <text x="${pad - 4}" y="${h - 18}" text-anchor="end" fill="#9ca3af" font-size="8.5" font-family="IBM Plex Mono, monospace">${(eMin / 1000).toFixed(1)}km</text>
      <text x="${pad}" y="${h - 5}" fill="#7f8998" font-size="8.5" font-family="IBM Plex Mono, monospace">0 km</text>
      <text x="${w - 8}" y="${h - 5}" fill="#9ca3af" font-size="8.5" font-family="IBM Plex Mono, monospace" text-anchor="end">${kmMax.toFixed(0)} km</text>
    </svg>`;
  }

  function crisisSVG(rows, cap) {
    const w = 276, h = 118, pad = 34, n = rows.length;
    const X = (i) => pad + (i / (n - 1)) * (w - pad - 8), Yb = (b) => h - 18 - (b / cap) * (h - 30), Yt = (t) => h - 18 - (t / 12) * (h - 30);
    let db = '', dt = '';
    rows.forEach((r, i) => { db += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yb(r.batt).toFixed(1); dt += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Yt(r.tau).toFixed(1); });
    const areaB = `${db}L${X(n - 1).toFixed(1)},${h - 18}L${X(0).toFixed(1)},${h - 18}Z`;
    const i18n = global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
    const tr = !!(i18n && i18n.getLang && i18n.getLang() === 'tr');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}">
      <line x1="${pad}" y1="12" x2="${w - 8}" y2="12" stroke="rgba(236,231,223,.08)" stroke-dasharray="2 2"/>
      <line x1="${pad}" y1="${h - 18}" x2="${w - 8}" y2="${h - 18}" stroke="rgba(236,231,223,.16)"/>
      <path d="${areaB}" fill="rgba(127,155,179,.14)"/>
      <path d="${dt}" fill="none" stroke="#c8743c" stroke-width="1.2" stroke-dasharray="3 3"/>
      <path d="${db}" fill="none" stroke="#7f9bb3" stroke-width="1.8"/>
      <text x="${pad}" y="10" fill="#7f9bb3" font-size="8.5" font-family="IBM Plex Mono, monospace">${tr ? 'batarya' : 'battery'}</text>
      <text x="${w - 8}" y="10" fill="#d47a3e" font-size="8.5" font-family="IBM Plex Mono, monospace" text-anchor="end">τ, 0–12</text>
      <text x="${pad}" y="${h - 5}" fill="#7f8998" font-size="8.5" font-family="IBM Plex Mono, monospace">sol 0</text>
      <text x="${w - 8}" y="${h - 5}" fill="#9ca3af" font-size="8.5" font-family="IBM Plex Mono, monospace" text-anchor="end">sol ${n}</text>
    </svg>`;
  }
  global.MDE_CHARTS = { profileSVG, crisisSVG };
})(typeof window !== 'undefined' ? window : module.exports);
