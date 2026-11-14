// Raster decoding, HTTP PNG / 4K Viking streaming, file:// bundle loading, and physical cell queries.
(function (global) {
  'use strict';

  /**
   * Create the planetary raster store and physical value query helpers.
   * @param {Object} opts { META, SCORING, REGIONS, onBaseUpdate? }
   */
  function createLayerStore(opts) {
    const { META, SCORING, REGIONS, ASTAR, onBaseUpdate } = opts;
    const W = META.width, H = META.height;
    const MARS_R = 3389.5;
    const L = {
      width: W,
      height: H,
      meta: META,
      latOfRow: (y) => 90 - (y + 0.5) * (180 / H),
      lonOfCol: (x) => -180 + (x + 0.5) * (360 / W),
      rowOfLat: (lat) => Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H))),
      colOfLon: (lon) => ((Math.floor((lon + 180) / 360 * W) % W) + W) % W,
    };
    let baseImg = null;
    const decodeInflight = {};

    function decode(key) {
      if (key === 'base' && baseImg) return Promise.resolve();
      if (key !== 'base' && L[key]) return Promise.resolve();
      if (decodeInflight[key]) return decodeInflight[key];
      decodeInflight[key] = new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => {
          if (key === 'base') { baseImg = im; return res(); }
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0);
          const d = g.getImageData(0, 0, W, H).data;
          const out = new Uint8Array(W * H);
          for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j];
          L[key] = out;
          res(out);
        };
        im.onerror = () => {
          if (!im.src.includes('layers/')) {
            im.src = 'layers/' + key + (key === 'base' ? '.jpg' : '.png');
          } else {
            rej(new Error('Failed to load layer ' + key));
          }
        };
        im.src = (global.LAYER_DATA && global.LAYER_DATA[key]) ? global.LAYER_DATA[key] : ('layers/' + key + (key === 'base' ? '.jpg' : '.png'));
      });
      return decodeInflight[key];
    }

    function ensureFileDataBundle() {
      if (global.LAYER_DATA || typeof location === 'undefined' || location.protocol !== 'file:') return Promise.resolve();
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'layers_data.js';
        s.onload = () => res();
        s.onerror = () => rej(new Error('Failed to load offline bundle layers_data.js'));
        document.head.appendChild(s);
      });
    }

    function loadVikingMosaic() {
      return new Promise((res, rej) => {
        const hi = new Image();
        hi.onload = () => {
          baseImg = hi;
          if (onBaseUpdate) onBaseUpdate(hi);
          res(hi);
        };
        hi.onerror = () => rej(new Error('viking_4k.jpg unavailable'));
        hi.src = 'layers/viking_4k.jpg';
      });
    }

    function sampleValid(arr, x, y, scale, offset, fallback) {
      if (!arr) return fallback;
      const cx = ((x % W) + W) % W;
      const cy = Math.min(H - 1, Math.max(0, y));
      const direct = arr[cy * W + cx];
      if (direct > 0) return offset + direct * scale;
      const radii = [1, 2, 3, 5, 8, 12, 18, 26, 38, 52];
      for (const r of radii) {
        let sum = 0, wSum = 0;
        for (let dy = -r; dy <= r; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= H) continue;
          const step = (dy === -r || dy === r) ? 1 : (2 * r);
          for (let dx = -r; dx <= r; dx += step) {
            const nx = ((cx + dx) % W + W) % W;
            const raw = arr[ny * W + nx];
            if (raw > 0) {
              const w = 1 / Math.hypot(dx, dy);
              sum += raw * w;
              wSum += w;
            }
          }
        }
        if (wSum > 0) return offset + (sum / wSum) * scale;
      }
      return fallback;
    }

    function cellValues(x, y) {
      const i = y * W + x;
      const iceRaw = L.ice ? L.ice[i] : 0;
      const elev = SCORING.sampleBilinear
        ? SCORING.sampleBilinear(L.elev, W, H, x, y, META.elev.scale, META.elev.offset)
        : META.elev.offset + L.elev[i] * META.elev.scale;
      const out = {
        elev,
        slope: L.slope[i] * META.slope.scale,
        rough: L.rough[i] * META.rough.scale,
        ice: iceRaw === 0 ? null : META.ice.offset + iceRaw * META.ice.scale,
        ti: sampleValid(L.ti, x, y, META.ti.scale, 0, 215),
        cave: !L.cave || L.cave[i] === 255 ? null : L.cave[i] * (META.cave ? META.cave.scale : 4),
        dust: sampleValid(L.dust, x, y, META.dust.scale, META.dust.offset, 0.18),
        lat: L.latOfRow(y),
        lon: L.lonOfCol(x),
      };
      out.rad = SCORING.radDose(out.elev);
      return out;
    }

    function blockValues(cx, cy, size) {
      const h = size >> 1;
      let n = 0, e = 0, sl = 0, r = 0, ic = 0, nIce = 0, t = 0, nT = 0, du = 0, nD = 0;
      for (let y = cy - h; y < cy + h; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = cx - h; x < cx + h; x++) {
          const i = y * W + (((x % W) + W) % W);
          const elev = META.elev.offset + L.elev[i] * META.elev.scale;
          const slope = L.slope[i] * META.slope.scale;
          const rough = L.rough[i] * META.rough.scale;
          const iceRaw = L.ice ? L.ice[i] : 0;
          const ice = iceRaw === 0 ? null : META.ice.offset + iceRaw * META.ice.scale;
          const ti = L.ti[i] === 0 ? null : L.ti[i] * META.ti.scale;
          const dust = L.dust[i] === 0 ? null : META.dust.offset + L.dust[i] * META.dust.scale;
          e += elev; sl += slope; r += rough; n++;
          if (ice !== null) { ic += ice; nIce++; }
          if (ti !== null) { t += ti; nT++; }
          if (dust !== null) { du += dust; nD++; }
        }
      }
      const center = cellValues(((cx % W) + W) % W, Math.min(H - 1, Math.max(0, cy)));
      return {
        rad: SCORING.radDose(e / n),
        elev: e / n,
        slope: sl / n,
        rough: r / n,
        ice: nIce ? ic / nIce : null,
        ti: nT ? t / nT : center.ti,
        dust: nD ? du / nD : center.dust,
        cave: center.cave,
        lat: L.latOfRow(cy),
        lon: L.lonOfCol(cx),
      };
    }

    function flatShare(cx, cy, size) {
      const h = size >> 1, lim = 5 / META.slope.scale;
      let n = 0, ok = 0;
      for (let y = cy - h; y < cy + h; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = cx - h; x < cx + h; x++) {
          n++;
          if (L.slope[y * W + (((x % W) + W) % W)] <= lim) ok++;
        }
      }
      return n ? ok / n : 0;
    }

    function nearestRegion(lat, lon) {
      let best = REGIONS[0], bestD = 1e9;
      for (const r of REGIONS) {
        let dl = Math.abs(r.lon - lon);
        if (dl > 180) dl = 360 - dl;
        const d = Math.hypot(r.lat - lat, dl * Math.cos(lat * Math.PI / 180));
        if (d < bestD) { bestD = d; best = r; }
      }
      return { region: best, distDeg: bestD };
    }

    function nearestCave(lat, lon) {
      const caves = global.CAVES;
      if (!caves || !caves.length || !ASTAR || !ASTAR.haversineKm) return null;
      let best = null, bd = Infinity;
      for (const c of caves) {
        const d = ASTAR.haversineKm(lat, lon, c[0], c[1]);
        if (d < bd) { bd = d; best = c; }
      }
      const TYPES = { sky: 'skylight', APC: 'atypical pit crater', pit: 'pit', lat: 'lava-tube related', kst: 'karst-like', end: 'trough-end' };
      return best ? { distKm: bd, type: TYPES[best[2]] || best[2], diameter: best[3] || null } : null;
    }

    return {
      W, H, MARS_R, L,
      getBaseImg: () => baseImg,
      decode,
      ensureFileDataBundle,
      loadVikingMosaic,
      cellValues,
      blockValues,
      flatShare,
      nearestRegion,
      nearestCave,
    };
  }

  global.MDE_LAYERS = { createLayerStore };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
