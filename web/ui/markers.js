// Canvas map markers. createMarkers(ctx, projectGrid) returns drawers bound to the map canvas.
(function (global) {
  'use strict';
  function createMarkers(ctx, projectGrid) {
    function drawCandidateReticle(gx, gy, rank, score, active) {
      const [x, y, vis] = projectGrid(gx, gy);
      if (!vis) return;
      const dpr = window.devicePixelRatio || 1;
      const r = (active ? 11 : 9) * dpr;
      const primary = active ? '#7f9bb3' : '#c8743c';

      ctx.strokeStyle = primary;
      ctx.lineWidth = (active ? 2 : 1.5) * dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      const tIn = r + 2 * dpr, tOut = r + 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(x - tOut, y); ctx.lineTo(x - tIn, y);
      ctx.moveTo(x + tIn, y); ctx.lineTo(x + tOut, y);
      ctx.moveTo(x, y - tOut); ctx.lineTo(x, y - tIn);
      ctx.moveTo(x, y + tIn); ctx.lineTo(x, y + tOut);
      ctx.stroke();

      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.arc(x, y, 2 * dpr, 0, Math.PI * 2);
      ctx.fill();

      const tag = `0${rank}`;
      ctx.font = `700 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
      const bx = x + r + 5 * dpr, by = y - r - 2 * dpr;
      const bw = 20 * dpr, bh = 13 * dpr;
      ctx.fillStyle = active ? '#7f9bb3' : 'rgba(8, 12, 18, 0.92)';
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1 * dpr;
      ctx.fillRect(bx, by - bh / 2, bw, bh);
      ctx.strokeRect(bx, by - bh / 2, bw, bh);
      ctx.fillStyle = active ? '#04070b' : '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, bx + bw / 2, by + 0.5 * dpr);
      ctx.textAlign = 'left';
    }

    function drawSelectionReticle(gx, gy) {
      const [x, y, vis] = projectGrid(gx, gy);
      if (!vis) return;
      const dpr = window.devicePixelRatio || 1;
      const s = 9 * dpr, c = 4 * dpr;
      ctx.strokeStyle = '#7f9bb3';
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s + c); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + c, y - s);
      ctx.moveTo(x + s - c, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + c);
      ctx.moveTo(x + s, y + s - c); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - c, y + s);
      ctx.moveTo(x - s + c, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y + s - c);
      ctx.stroke();
    }

    function drawWaypoint(gx, gy, color, label) {
      const [x, y, vis] = projectGrid(gx, gy);
      if (!vis) return;
      const dpr = window.devicePixelRatio || 1;
      const r = 6.5 * dpr;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(6, 9, 15, 0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      ctx.font = `700 ${Math.round(9.5 * dpr)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 10 * dpr, y);
    }

    function drawStationBeacon(gx, gy) {
      const [x, y, vis] = projectGrid(gx, gy);
      if (!vis) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.strokeStyle = '#7f9bb3';
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 11 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#7f9bb3';
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${Math.round(9 * dpr)}px "JetBrains Mono", monospace`;
      ctx.fillText('STA-PWR', x + 14 * dpr, y);
    }
    return { drawCandidateReticle, drawSelectionReticle, drawWaypoint, drawStationBeacon };
  }
  global.MDE_MARKERS = { createMarkers };
})(typeof window !== 'undefined' ? window : module.exports);
