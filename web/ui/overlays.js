// Pure colour LUT tables, overlay RGBA rasterizer, and legend markup builder.
(function (global) {
  'use strict';

  function lerpStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, ...a] = stops[i - 1], [t1, ...b] = stops[i], u = (t - t0) / (t1 - t0 || 1);
      return a.map((v, k) => v + (b[k] - v) * u);
    }
    return stops[stops.length - 1].slice(1);
  }

  const CMAP = {
    score: [[0, 14, 19, 34], [0.3, 30, 64, 130], [0.55, 16, 155, 165], [0.78, 245, 158, 11], [1, 254, 249, 195]],
    ice: [[0, 32, 26, 22], [0.5, 45, 95, 135], [1, 145, 228, 255]],
    slope: [[0, 22, 55, 38], [0.33, 65, 175, 95], [0.66, 245, 180, 35], [1, 239, 55, 55]],
    elev: [[0, 18, 38, 88], [0.3, 52, 118, 142], [0.5, 168, 148, 88], [0.7, 148, 78, 48], [1, 252, 252, 255]],
    ti: [[0, 115, 38, 22], [0.15, 195, 115, 38], [0.4, 75, 168, 95], [0.7, 56, 135, 215], [1, 238, 244, 255]],
    dust: [[0, 35, 55, 85], [0.5, 185, 145, 85], [1, 255, 228, 155]],
    rad: [[0, 40, 120, 90], [0.5, 230, 200, 60], [1, 220, 40, 90]],
    cave: [[0, 250, 230, 160], [0.12, 200, 120, 60], [0.5, 70, 50, 70], [1, 20, 18, 30]],
  };

  const LEGEND_ENDS = {
    score: ['≤0.35 VETO/POOR', '1.00 OPTIMAL'],
    ice: ['−1.0 NO ICE', '+1.0 HIGH ICE'],
    slope: ['0.0° FLAT', '≥16.0° STEEP'],
    elev: ['−8.2 KM', '+21.2 KM'],
    ti: ['0 FINE DUST', '≥700 BEDROCK'],
    dust: ['0% DUST', '100% DUST'],
    rad: ['190 mSv/YR LOW', '340 mSv/YR HIGH'],
    cave: ['0 KM CAVE CANDIDATE', '≥1020 KM'],
  };

  const LUT = {};
  for (const k in CMAP) {
    LUT[k] = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const c = lerpStops(CMAP[k], i / 255);
      LUT[k].set(c.map(Math.round), i * 3);
    }
  }

  function buildRadLut(metaElev, scoringMod) {
    const sc = scoringMod || global.SCORING;
    const radLut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      radLut[i] = Math.max(0, Math.min(255, Math.round((sc.radDose(metaElev.offset + i * metaElev.scale) - 190) / 150 * 255)));
    }
    return radLut;
  }

  function fillOverlayBuffer(d, overlay, L, score, radLut) {
    const n = L.width * L.height;
    const lut = LUT[overlay] || LUT.score;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let v, a = 255;
      if (overlay === 'score') {
        const sc = score[i];
        const norm = Math.max(0, Math.min(1, (sc - 0.35) / 0.65));
        v = Math.round(norm * 255);
        a = sc <= 0 ? 28 : Math.round(65 + 190 * Math.pow(norm, 0.75));
      } else if (overlay === 'ice') {
        const r = L.ice[i];
        if (r === 0) { v = 0; a = 0; } else v = Math.round(Math.max(0, Math.min(255, (r - 28) * 1.275)));
      } else if (overlay === 'slope') {
        v = Math.min(255, L.slope[i] * 2);
      } else if (overlay === 'elev') {
        v = L.elev[i];
      } else if (overlay === 'ti') {
        const r = L.ti[i];
        if (r === 0) { v = 0; a = 0; } else v = Math.min(255, Math.round(r * 4 / 700 * 255));
      } else if (overlay === 'rad') {
        v = radLut[L.elev[i]];
      } else if (overlay === 'cave') {
        v = L.cave ? L.cave[i] : 255;
      } else if (overlay === 'dust') {
        const r = L.dust[i];
        if (r === 0) { v = 0; a = 0; } else v = Math.min(255, Math.round((r - 1) * 1.275));
      } else {
        d[j + 3] = 0;
        continue;
      }
      d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = a;
    }
  }

  function renderLegendHTML(overlay) {
    const lut = LUT[overlay], ends = LEGEND_ENDS[overlay];
    if (!lut || !ends) return '';
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const v = Math.round(i * 25.5);
      stops.push(`rgb(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]})`);
    }
    return `<div class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
  }

  global.MDE_OVERLAYS = { LUT, LEGEND_ENDS, lerpStops, buildRadLut, fillOverlayBuffer, renderLegendHTML };
})(typeof window !== 'undefined' ? window : module.exports);
