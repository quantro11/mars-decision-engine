#!/usr/bin/env node
/**
 * tools/precut_16km2.mjs
 * Pure Node.js BigTIFF + PNG precut pipeline for the Tactical EVA 16 km² tab.
 *
 * Reads the two locally downloaded global Mars BigTIFF rasters:
 *   1. MOLA-HRSC Blended DEM 200 m (Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif)
 *      - Equirectangular, -180..+180° E, int16 meters, NoData = -32768
 *   2. THEMIS Day IR 100 m Global Mosaic v12 (Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif)
 *      - SimpleCylindrical, Central Meridian = 180° E (0..360° E layout), uint8 DN (1..255), NoData = 0
 *
 * Extracts 4 km × 4 km (+ 1 km padding collar -> 6 km × 6 km) cutouts for:
 *   - 4 existing preset zones (jezero_delta, gale_boxwork, nili_fossae, arcadia_ice)
 *     preserving existing HiRISE/CTX/TI/geology data and only filling missing fields
 *   - 5 balanced candidate zones from global candidate ranking
 *
 * Also samples 5 km coarse global baselines from web/layers/*.png so the UI
 * "Before (5 km) ↔ After (100–200 m)" toggle works offline.
 *
 * Usage:
 *   node tools/precut_16km2.mjs [--downloads "C:/Users/slmcn/Downloads"]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const LAYERS_DIR = path.join(ROOT, 'web', 'layers');
const CUTOUTS_JSON = path.join(LAYERS_DIR, 'eva_cutouts.json');
const CUTOUTS_JS = path.join(ROOT, 'web', 'eva_cutouts_data.js');

const DEFAULT_DOWNLOADS = process.env.MDE_RASTER_DIR
  || path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\slmcn', 'Downloads');

const DEM_FILENAME = 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif';
const THEMIS_FILENAME = 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif';

const R_MARS = 3396190.0;
const DEG_TO_M = (Math.PI * R_MARS) / 180.0; // 59274.69713 m/deg
const BOX_KM = 4;
const PAD_KM = 1; // 1 km padding collar -> 6 km × 6 km extraction window
const GRID_N = 40;
const CELL_M = 100;

const TARGET_ZONES = [
  { id: 'jezero_delta', name: 'Jezero Delta Front', lat: 18.38, lon: 77.58, isPresetCutout: true },
  { id: 'gale_boxwork', name: 'Gale Crater Boxwork', lat: -5.08, lon: 137.85, isPresetCutout: true },
  { id: 'nili_fossae', name: 'Nili Fossae', lat: 21.00, lon: 74.00, isPresetCutout: true },
  { id: 'arcadia_ice', name: 'Arcadia Planitia Ice', lat: 39.20, lon: -175.00, isPresetCutout: true },
  { id: 'cand_utopia_114', name: 'Utopia Planitia (114.2°E)', lat: 32.2998, lon: 114.2139, isPresetCutout: true, isCandidateCutout: true },
  { id: 'cand_cerberus_164', name: 'Cerberus Fossae (164.8°E)', lat: 22.1924, lon: 164.7510, isPresetCutout: true, isCandidateCutout: true },
  { id: 'cand_utopia_100', name: 'Utopia Planitia (100.1°E)', lat: 32.2998, lon: 100.0635, isPresetCutout: true, isCandidateCutout: true },
  { id: 'cand_elysium_136', name: 'Elysium Mons Flank (136.5°E)', lat: 32.2998, lon: 136.4502, isPresetCutout: true, isCandidateCutout: true },
  { id: 'cand_hellas_61', name: 'Hellas Planitia Floor (61.7°E)', lat: -36.4307, lon: 61.6553, isPresetCutout: true, isCandidateCutout: true },
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function norm180(lon) {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

function norm360(lon) {
  return ((lon % 360) + 360) % 360;
}

function computeBBox180(lat, lon180) {
  const halfBoxM = (BOX_KM * 1000) / 2;
  const dLat = halfBoxM / DEG_TO_M;
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const dLon = halfBoxM / (DEG_TO_M * cosLat);
  return [
    +(lon180 - dLon).toFixed(6),
    +clamp(lat - dLat, -90, 90).toFixed(6),
    +(lon180 + dLon).toFixed(6),
    +clamp(lat + dLat, -90, 90).toFixed(6),
  ];
}

/**
 * Minimal BigTIFF reader (little-endian `II`, version `43`, RowsPerStrip=1, uncompressed).
 */
class BigTiffReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, 'r');
    const hdr = Buffer.alloc(16);
    fs.readSync(this.fd, hdr, 0, 16, 0);
    const bom = hdr.toString('ascii', 0, 2);
    const version = hdr.readUInt16LE(2);
    const offsetSize = hdr.readUInt16LE(4);
    if (bom !== 'II' || version !== 43 || offsetSize !== 8) {
      throw new Error(`Unsupported TIFF header in ${filePath}: bom=${bom} v=${version} off=${offsetSize}`);
    }
    this.ifdOffset = Number(hdr.readBigUInt64LE(8));
    this.tags = this._readIfd(this.ifdOffset);
    this.width = this.tags[256][0];
    this.height = this.tags[257][0];
    this.bitsPerSample = this.tags[258][0];
    this.compression = this.tags[259] ? this.tags[259][0] : 1;
    this.rowsPerStrip = this.tags[278] ? this.tags[278][0] : this.height;
    this.sampleFormat = this.tags[339] ? this.tags[339][0] : 1;
    this.pixelScale = this.tags[33550] || [];
    this.tiepoint = this.tags[33922] || [];
    this.stripOffsetsEntry = this._rawEntries[273];
    if (this.compression !== 1 || this.rowsPerStrip !== 1) {
      throw new Error(`Expected uncompressed RowsPerStrip=1 in ${filePath}, got comp=${this.compression} rps=${this.rowsPerStrip}`);
    }
    this.bytesPerSample = this.bitsPerSample / 8;
  }

  _readAt(offset, length) {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(this.fd, buf, 0, length, Number(offset));
    if (n !== length) {
      throw new Error(`Short read in ${this.filePath} at ${offset}: ${n}/${length}`);
    }
    return buf;
  }

  _readIfd(ifdOffset) {
    const countBuf = this._readAt(ifdOffset, 8);
    const numEntries = Number(countBuf.readBigUInt64LE(0));
    const entryBuf = this._readAt(ifdOffset + 8, numEntries * 20);
    const tags = {};
    this._rawEntries = {};
    const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

    for (let i = 0; i < numEntries; i++) {
      const off = i * 20;
      const tag = entryBuf.readUInt16LE(off);
      const type = entryBuf.readUInt16LE(off + 2);
      const count = Number(entryBuf.readBigUInt64LE(off + 4));
      const valBytes = entryBuf.subarray(off + 12, off + 20);
      const elemSize = TYPE_SIZE[type] || 1;
      const totalBytes = count * elemSize;
      const dataOffset = totalBytes > 8 ? Number(valBytes.readBigUInt64LE(0)) : null;

      this._rawEntries[tag] = { tag, type, count, valBytes, dataOffset };

      // Skip huge arrays (e.g. StripOffsets / StripByteCounts) during IFD scan; read on demand
      if (tag === 273 || tag === 279) continue;

      const raw = totalBytes <= 8 ? valBytes : this._readAt(dataOffset, totalBytes);
      const arr = [];
      for (let k = 0; k < count; k++) {
        const p = k * elemSize;
        if (type === 1) arr.push(raw.readUInt8(p));
        else if (type === 3) arr.push(raw.readUInt16LE(p));
        else if (type === 4) arr.push(raw.readUInt32LE(p));
        else if (type === 12) arr.push(raw.readDoubleLE(p));
        else if (type === 16) arr.push(Number(raw.readBigUInt64LE(p)));
        else if (type === 2) { arr.push(raw.toString('ascii')); break; }
      }
      tags[tag] = arr;
    }
    return tags;
  }

  _getStripOffset(row) {
    const e = this.stripOffsetsEntry;
    const stride = e.type === 16 ? 8 : (e.type === 4 ? 4 : 8);
    const b = this._readAt(e.dataOffset + row * stride, stride);
    return stride === 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  }

  readWindow(rowStart, rowEnd, colStart, colEnd) {
    const r0 = clamp(rowStart, 0, this.height - 1);
    const r1 = clamp(rowEnd, r0, this.height - 1);
    const c0 = ((colStart % this.width) + this.width) % this.width;
    const w = colEnd - colStart + 1;
    const h = r1 - r0 + 1;
    const out = this.bitsPerSample === 16 ? new Int16Array(w * h) : new Uint8Array(w * h);

    for (let r = 0; r < h; r++) {
      const stripOff = this._getStripOffset(r0 + r);
      const endC = c0 + w;
      if (endC <= this.width) {
        const rowBuf = this._readAt(stripOff + c0 * this.bytesPerSample, w * this.bytesPerSample);
        for (let c = 0; c < w; c++) {
          out[r * w + c] = this.bitsPerSample === 16
            ? rowBuf.readInt16LE(c * 2)
            : rowBuf.readUInt8(c);
        }
      } else {
        // Horizontal wrap across seam
        const w1 = this.width - c0;
        const w2 = w - w1;
        const b1 = this._readAt(stripOff + c0 * this.bytesPerSample, w1 * this.bytesPerSample);
        const b2 = this._readAt(stripOff, w2 * this.bytesPerSample);
        for (let c = 0; c < w1; c++) {
          out[r * w + c] = this.bitsPerSample === 16 ? b1.readInt16LE(c * 2) : b1.readUInt8(c);
        }
        for (let c = 0; c < w2; c++) {
          out[r * w + w1 + c] = this.bitsPerSample === 16 ? b2.readInt16LE(c * 2) : b2.readUInt8(c);
        }
      }
    }
    return { width: w, height: h, rowStart: r0, colStart: c0, data: out };
  }

  close() {
    fs.closeSync(this.fd);
  }
}

/**
 * Pure Node 8-bit grayscale PNG decoder for web/layers/*.png coarse baselines.
 */
function decodeGrayscalePng(filePath) {
  const buf = fs.readFileSync(filePath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 0) {
    throw new Error(`Expected 8-bit grayscale PNG for ${filePath}, got depth=${bitDepth} color=${colorType}`);
  }
  let pos = 8;
  const idatChunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const out = new Uint8Array(w * h);
  const stride = w + 1;

  for (let y = 0; y < h; y++) {
    const rowOff = y * stride;
    const filter = raw[rowOff];
    const outOff = y * w;
    for (let x = 0; x < w; x++) {
      const xVal = raw[rowOff + 1 + x];
      const a = x > 0 ? out[outOff + x - 1] : 0;
      const b = y > 0 ? out[(y - 1) * w + x] : 0;
      const c = (x > 0 && y > 0) ? out[(y - 1) * w + x - 1] : 0;
      let recon = xVal;
      if (filter === 1) recon = (xVal + a) & 0xff;
      else if (filter === 2) recon = (xVal + b) & 0xff;
      else if (filter === 3) recon = (xVal + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        recon = (xVal + pr) & 0xff;
      }
      out[outOff + x] = recon;
    }
  }
  return { width: w, height: h, data: out };
}

function loadGlobalCoarseLayers() {
  const meta = JSON.parse(fs.readFileSync(path.join(LAYERS_DIR, 'meta.json'), 'utf8'));
  const elev = decodeGrayscalePng(path.join(LAYERS_DIR, 'elev.png'));
  const slope = decodeGrayscalePng(path.join(LAYERS_DIR, 'slope.png'));
  const rough = decodeGrayscalePng(path.join(LAYERS_DIR, 'rough.png'));
  const ti = decodeGrayscalePng(path.join(LAYERS_DIR, 'ti.png'));
  const dust = decodeGrayscalePng(path.join(LAYERS_DIR, 'dust.png'));
  return { meta, elev, slope, rough, ti, dust };
}

function sampleCoarseAt(globalLayers, lat, lon180) {
  const { meta, elev, slope, rough, ti, dust } = globalLayers;
  const W = meta.width;
  const H = meta.height;
  const ix = clamp(Math.round(((norm180(lon180) + 180) / 360) * W), 0, W - 1);
  const iy = clamp(Math.round(((90 - lat) / 180) * H), 0, H - 1);
  const idx = iy * W + ix;
  const tiRaw = ti.data[idx];
  const dustRaw = dust.data[idx];
  return {
    elev: elev.data[idx] * meta.elev.scale + meta.elev.offset,
    slope: slope.data[idx] * meta.slope.scale + meta.slope.offset,
    rough: rough.data[idx] * meta.rough.scale + meta.rough.offset,
    ti: tiRaw === meta.ti.nodata ? 240 : tiRaw * meta.ti.scale + meta.ti.offset,
    dust: dustRaw === meta.dust.nodata ? 0.25 : dustRaw * meta.dust.scale + meta.dust.offset,
  };
}

function buildCoarseBaseline(globalLayers, lat, lon180) {
  const bbox = computeBBox180(lat, lon180);
  const dLat = (bbox[3] - bbox[1]) / GRID_N;
  const dLon = (bbox[2] - bbox[0]) / GRID_N;
  const total = GRID_N * GRID_N;
  const elevM = new Array(total);
  const slopeDeg = new Array(total);
  const reliefM = new Array(total);
  const ti = new Array(total);
  const dci = new Array(total);
  for (let r = 0; r < GRID_N; r++) {
    const cLat = bbox[3] - (r + 0.5) * dLat;
    for (let c = 0; c < GRID_N; c++) {
      const cLon = bbox[0] + (c + 0.5) * dLon;
      const s = sampleCoarseAt(globalLayers, cLat, cLon);
      const i = r * GRID_N + c;
      elevM[i] = +s.elev.toFixed(1);
      slopeDeg[i] = +s.slope.toFixed(1);
      reliefM[i] = +s.rough.toFixed(1);
      ti[i] = Math.round(s.ti);
      dci[i] = +clamp(0.99 - s.dust * 0.12, 0.88, 0.995).toFixed(4);
    }
  }
  return { elevM, slopeDeg, reliefM, ti, dci };
}

/**
 * Extract 4 km × 4 km (+ 1 km padding collar) from MOLA-HRSC 200 m DEM.
 * Computes Horn (1981) slope and 3×3 relief on the native 200 m grid (using 1 km collar),
 * then bilinearly samples elevation, slope, and relief onto the 40×40 (100 m) grid.
 */
function extractDemCutout(demReader, lat0, lon180) {
  const scaleX = demReader.pixelScale[0]; // deg/px (~0.00337412)
  const scaleY = demReader.pixelScale[1];
  const lonOrigin = demReader.tiepoint[3]; // -180.0
  const latOrigin = demReader.tiepoint[4]; // +90.0
  const NODATA = -32768;

  const halfTotalM = ((BOX_KM / 2) + PAD_KM) * 1000; // 3000 m around center (6 km × 6 km)
  const cosLat = Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
  const dLatPad = halfTotalM / DEG_TO_M;
  const dLonPad = halfTotalM / (DEG_TO_M * cosLat);

  const rowMin = clamp(Math.floor((latOrigin - (lat0 + dLatPad)) / scaleY) - 2, 0, demReader.height - 1);
  const rowMax = clamp(Math.ceil((latOrigin - (lat0 - dLatPad)) / scaleY) + 2, 0, demReader.height - 1);
  const colMin = Math.floor((norm180(lon180) - dLonPad - lonOrigin) / scaleX) - 2;
  const colMax = Math.ceil((norm180(lon180) + dLonPad - lonOrigin) / scaleX) + 2;

  const win = demReader.readWindow(rowMin, rowMax, colMin, colMax);
  const W = win.width;
  const H = win.height;
  const getZ = (r, c) => {
    const rr = clamp(r, 0, H - 1);
    const cc = clamp(c, 0, W - 1);
    const v = win.data[rr * W + cc];
    return v === NODATA ? null : v;
  };

  // Fill occasional NoData from valid neighbors
  const cleanZ = new Float64Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let v = getZ(r, c);
      if (v === null) {
        let sum = 0, cnt = 0;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nv = getZ(r + dr, c + dc);
            if (nv !== null) { sum += nv; cnt++; }
          }
        }
        v = cnt > 0 ? sum / cnt : -2000;
      }
      cleanZ[r * W + c] = v;
    }
  }

  // Native 200 m Horn (1981) slope & 3×3 relief over the padded window
  const slopeGrid = new Float64Array(W * H);
  const reliefGrid = new Float64Array(W * H);
  const dx = scaleX * DEG_TO_M * cosLat;
  const dy = scaleY * DEG_TO_M;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const rM = Math.max(0, r - 1), rP = Math.min(H - 1, r + 1);
      const cM = Math.max(0, c - 1), cP = Math.min(W - 1, c + 1);
      const a = cleanZ[rM * W + cM], b = cleanZ[rM * W + c], cc = cleanZ[rM * W + cP];
      const d = cleanZ[r * W + cM], e = cleanZ[r * W + c], f = cleanZ[r * W + cP];
      const g = cleanZ[rP * W + cM], h = cleanZ[rP * W + c], i = cleanZ[rP * W + cP];
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * dx);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * dy);
      const slpDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI);
      slopeGrid[r * W + c] = slpDeg;
      const mn = Math.min(a, b, cc, d, e, f, g, h, i);
      const mx = Math.max(a, b, cc, d, e, f, g, h, i);
      reliefGrid[r * W + c] = mx - mn;
    }
  }

  const bilinear = (arr, pxLat, pxLon) => {
    const gy = (latOrigin - pxLat) / scaleY - rowMin;
    const gx = (pxLon - lonOrigin) / scaleX - colMin;
    const r0 = clamp(Math.floor(gy), 0, H - 1);
    const c0 = clamp(Math.floor(gx), 0, W - 1);
    const r1 = clamp(r0 + 1, 0, H - 1);
    const c1 = clamp(c0 + 1, 0, W - 1);
    const ty = clamp(gy - r0, 0, 1);
    const tx = clamp(gx - c0, 0, 1);
    const v00 = arr[r0 * W + c0], v01 = arr[r0 * W + c1];
    const v10 = arr[r1 * W + c0], v11 = arr[r1 * W + c1];
    return (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
  };

  const bbox = computeBBox180(lat0, lon180);
  const dLatCell = (bbox[3] - bbox[1]) / GRID_N;
  const dLonCell = (bbox[2] - bbox[0]) / GRID_N;

  const elevM = new Array(GRID_N * GRID_N);
  const slopeDeg = new Array(GRID_N * GRID_N);
  const reliefM = new Array(GRID_N * GRID_N);

  for (let r = 0; r < GRID_N; r++) {
    const cLat = bbox[3] - (r + 0.5) * dLatCell;
    for (let c = 0; c < GRID_N; c++) {
      const cLon = bbox[0] + (c + 0.5) * dLonCell;
      const idx = r * GRID_N + c;
      elevM[idx] = +bilinear(cleanZ, cLat, cLon).toFixed(1);
      slopeDeg[idx] = +bilinear(slopeGrid, cLat, cLon).toFixed(1);
      reliefM[idx] = +bilinear(reliefGrid, cLat, cLon).toFixed(1);
    }
  }

  return {
    elevM,
    slopeDeg,
    reliefM,
    demResM: +(scaleY * DEG_TO_M).toFixed(0),
    paddedPixels: `${W}x${H}`,
  };
}

/**
 * Extract 4 km × 4 km (+ 1 km padding collar -> 60×60 @ 100 m) from
 * Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif (SimpleCylindrical cm=180°E).
 */
function extractThemisDayIrCutout(themisReader, lat0, lon180) {
  const scaleX = themisReader.pixelScale[0]; // 100.0 m/px
  const scaleY = themisReader.pixelScale[1]; // 100.0 m/px
  const xOrigin = themisReader.tiepoint[3]; // -10669500.0 m
  const yOrigin = themisReader.tiepoint[4]; // +5334800.0 m

  const lon360 = norm360(lon180);
  const xCenter = (lon360 - 180.0) * DEG_TO_M;
  const yCenter = lat0 * DEG_TO_M;

  // Account for cos(lat) foreshortening in cylindrical lon meters to cover 6 km × 6 km ground area
  const halfGroundM = ((BOX_KM / 2) + PAD_KM) * 1000;
  const cosLat = Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
  const halfLonM = halfGroundM / cosLat;

  const colMin = Math.floor((xCenter - halfLonM - xOrigin) / scaleX) - 2;
  const colMax = Math.ceil((xCenter + halfLonM - xOrigin) / scaleX) + 2;
  const rowMin = clamp(Math.floor((yOrigin - (yCenter + halfGroundM)) / scaleY) - 2, 0, themisReader.height - 1);
  const rowMax = clamp(Math.ceil((yOrigin - (yCenter - halfGroundM)) / scaleY) + 2, 0, themisReader.height - 1);

  const win = themisReader.readWindow(rowMin, rowMax, colMin, colMax);
  const W = win.width;
  const H = win.height;

  // Fill NoData (0) with local 5×5 average or 128
  const clean = new Float64Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let v = win.data[r * W + c];
      if (v === 0) {
        let sum = 0, cnt = 0;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = clamp(r + dr, 0, H - 1);
            const cc = clamp(c + dc, 0, W - 1);
            const nv = win.data[rr * W + cc];
            if (nv > 0) { sum += nv; cnt++; }
          }
        }
        v = cnt > 0 ? sum / cnt : 128;
      }
      clean[r * W + c] = v;
    }
  }

  // Local 3×3 standard deviation on the padded 100 m mosaic (relative daytime thermal texture contrast)
  const localContrast = new Float64Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let sum = 0, sumSq = 0, cnt = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = clamp(r + dr, 0, H - 1);
          const cc = clamp(c + dc, 0, W - 1);
          const v = clean[rr * W + cc];
          sum += v;
          sumSq += v * v;
          cnt++;
        }
      }
      const mean = sum / cnt;
      const variance = Math.max(0, sumSq / cnt - mean * mean);
      localContrast[r * W + c] = clamp(Math.sqrt(variance) / 30, 0, 1);
    }
  }

  const bbox = computeBBox180(lat0, lon180);
  const dLatCell = (bbox[3] - bbox[1]) / GRID_N;
  const dLonCell = (bbox[2] - bbox[0]) / GRID_N;

  const sampleBilinear = (arr, pxLat, pxLon) => {
    const pxLon360 = norm360(pxLon);
    const xm = (pxLon360 - 180.0) * DEG_TO_M;
    const ym = pxLat * DEG_TO_M;
    const gx = (xm - xOrigin) / scaleX - colMin;
    const gy = (yOrigin - ym) / scaleY - rowMin;
    const r0 = clamp(Math.floor(gy), 0, H - 1);
    const c0 = clamp(Math.floor(gx), 0, W - 1);
    const r1 = clamp(r0 + 1, 0, H - 1);
    const c1 = clamp(c0 + 1, 0, W - 1);
    const ty = clamp(gy - r0, 0, 1);
    const tx = clamp(gx - c0, 0, 1);
    const v00 = arr[r0 * W + c0], v01 = arr[r0 * W + c1];
    const v10 = arr[r1 * W + c0], v11 = arr[r1 * W + c1];
    return (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
  };

  const themisDayIr = new Array(GRID_N * GRID_N);
  const themisContrast = new Array(GRID_N * GRID_N);
  let sumDn = 0;

  for (let r = 0; r < GRID_N; r++) {
    const cLat = bbox[3] - (r + 0.5) * dLatCell;
    for (let c = 0; c < GRID_N; c++) {
      const cLon = bbox[0] + (c + 0.5) * dLonCell;
      const idx = r * GRID_N + c;
      const dn = Math.round(clamp(sampleBilinear(clean, cLat, cLon), 1, 255));
      themisDayIr[idx] = dn;
      themisContrast[idx] = +sampleBilinear(localContrast, cLat, cLon).toFixed(3);
      sumDn += dn;
    }
  }

  return {
    themisDayIr,
    themisContrast,
    themisMeanDn: +(sumDn / themisDayIr.length).toFixed(1),
    themisResM: Math.round(scaleY),
    paddedPixels: `${W}x${H}`,
  };
}

function main() {
  const args = process.argv.slice(2);
  let downloadsDir = DEFAULT_DOWNLOADS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--downloads' && args[i + 1]) downloadsDir = args[++i];
  }

  const demPath = path.join(downloadsDir, DEM_FILENAME);
  const themisPath = path.join(downloadsDir, THEMIS_FILENAME);
  if (!fs.existsSync(demPath) || !fs.existsSync(themisPath)) {
    throw new Error(`Missing raster file(s) in ${downloadsDir}:\n  DEM: ${demPath}\n  THEMIS: ${themisPath}`);
  }

  console.log('Opening BigTIFF rasters...');
  const demReader = new BigTiffReader(demPath);
  const themisReader = new BigTiffReader(themisPath);
  console.log(`  DEM:    ${demReader.width}x${demReader.height}, ${demReader.bitsPerSample}-bit, scale=${demReader.pixelScale[0]} deg/px`);
  console.log(`  THEMIS: ${themisReader.width}x${themisReader.height}, ${themisReader.bitsPerSample}-bit, scale=${themisReader.pixelScale[0]} m/px`);

  console.log('Decoding global 5 km coarse layers (web/layers/*.png)...');
  const globalLayers = loadGlobalCoarseLayers();

  const existing = fs.existsSync(CUTOUTS_JSON)
    ? JSON.parse(fs.readFileSync(CUTOUTS_JSON, 'utf8'))
    : { _meta: {}, sim3292ObjectIdToUnit: {}, zones: {} };

  const prevJsonBytes = fs.existsSync(CUTOUTS_JSON) ? fs.statSync(CUTOUTS_JSON).size : 0;
  const prevJsBytes = fs.existsSync(CUTOUTS_JS) ? fs.statSync(CUTOUTS_JS).size : 0;

  const zonesOut = { ...(existing.zones || {}) };

  for (const t of TARGET_ZONES) {
    const lon180 = norm180(t.lon);
    const bbox = computeBBox180(t.lat, lon180);
    const dem = extractDemCutout(demReader, t.lat, lon180);
    const themis = extractThemisDayIrCutout(themisReader, t.lat, lon180);
    const coarseBaseline = buildCoarseBaseline(globalLayers, t.lat, lon180);

    const prev = zonesOut[t.id];
    const hasExistingHighRes = Boolean(prev && Array.isArray(prev.elevM) && prev.elevM.length === GRID_N * GRID_N);

    if (hasExistingHighRes) {
      // Rule 5.4: Preserve existing HiRISE / CTX / TI cutouts; fill only missing/supplementary fields
      const mergedSources = {
        ...(prev.sources || {}),
        themisDayIr: {
          id: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12 (ASU/USGS)',
          nativeResM: 100,
          date: '2014 (Edwards et al. v12)',
          productType: 'day_ir_relative_texture',
        },
        dem200m: {
          id: 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2 (USGS; Fergason, Hare & Laura 2018)',
          nativeResM: 200,
          date: '2018-01-31',
        },
      };
      if (!prev.sources || !prev.sources.slope || /fallback|global/i.test(prev.sources.slope.id || '')) {
        mergedSources.slope = {
          id: 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2 (Horn 200 m)',
          nativeResM: 200,
          date: '2018-01-31',
        };
      }
      zonesOut[t.id] = {
        ...prev,
        paddingKm: PAD_KM,
        sources: mergedSources,
        themisDayIr: themis.themisDayIr,
        themisContrast: themis.themisContrast,
        themisMeanDn: themis.themisMeanDn,
        dem200ElevM: dem.elevM,
        dem200SlopeDeg: dem.slopeDeg,
        coarseBaseline,
      };
      console.log(`  [PRESERVE+ENRICH] ${t.id} (${t.lat}, ${lon180}): kept HiRISE/CTX/TI + added 100m THEMIS Day IR & 5km baseline`);
    } else {
      // Candidate zone: populate with 200 m MOLA-HRSC DEM + recomputed 200 m slope + 100 m THEMIS Day IR + coarse TI/dust/GRS
      const total = GRID_N * GRID_N;
      const albedo = new Array(total);
      const grsK = new Array(total);
      const grsTh = new Array(total);
      const geolUnits = new Array(total);
      const fallbackUnit = Math.abs(t.lat) > 62 ? 'Ap' : 'HNt';
      for (let i = 0; i < total; i++) {
        const roughDustFrac = clamp((0.99 - coarseBaseline.dci[i]) / 0.12, 0, 1);
        albedo[i] = +clamp(0.13 + roughDustFrac * 0.18, 0.10, 0.34).toFixed(4);
        grsK[i] = 0.36;
        grsTh[i] = 0.62;
        geolUnits[i] = fallbackUnit;
      }

      zonesOut[t.id] = {
        id: t.id,
        name: t.name,
        lat: t.lat,
        lon: lon180,
        bbox,
        gridN: GRID_N,
        cellM: CELL_M,
        sizeKm: BOX_KM,
        paddingKm: PAD_KM,
        areaKm2: BOX_KM * BOX_KM,
        isPresetCutout: true,
        isCandidateCutout: !!t.isCandidateCutout,
        sources: {
          elevation: {
            id: 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2 (USGS; Fergason, Hare & Laura 2018)',
            nativeResM: 200,
            date: '2018-01-31',
          },
          slope: {
            id: 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2 (Horn 200 m)',
            nativeResM: 200,
            date: '2018-01-31',
          },
          ti: {
            id: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12 (relative Day IR texture) + TES_Thermal_Inertia_numeric',
            nativeResM: 100,
            coarseBaseM: 10000,
            productType: 'day_ir_relative_texture',
            date: '2014 (THEMIS v12) + 2001 (TES)',
          },
          imagery: {
            id: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12 (ASU/USGS)',
            nativeResM: 100,
            displayResM: 100,
            productType: 'day_ir_relative_texture',
            date: '2014 (Edwards et al. v12)',
          },
          themisDayIr: {
            id: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12 (ASU/USGS)',
            nativeResM: 100,
            date: '2014 (Edwards et al. v12)',
            productType: 'day_ir_relative_texture',
          },
          dust: {
            id: 'TES_Dust_numeric (Bandfield 2002)',
            nativeResM: 3700,
            lowRes: true,
            date: '1999-2001',
          },
          albedo: {
            id: 'TES_Dust_numeric albedo proxy (coarse fallback)',
            nativeResM: 5200,
            lowRes: true,
            date: '2001',
          },
          geology: {
            id: 'Global latitude unit proxy (coarse fallback)',
            nativeResM: 20000,
            lowRes: true,
            date: '2014',
          },
          grs: {
            id: 'Odyssey GRS global mean fallback (Boynton et al. 2007)',
            nativeResM: 550000,
            lowRes: true,
            date: '2002-2006',
          },
        },
        elevM: dem.elevM,
        slopeDeg: dem.slopeDeg,
        reliefM: dem.reliefM,
        ti: coarseBaseline.ti,
        dci: coarseBaseline.dci,
        albedo,
        grsK,
        grsTh,
        geolUnits,
        themisDayIr: themis.themisDayIr,
        themisContrast: themis.themisContrast,
        themisMeanDn: themis.themisMeanDn,
        coarseBaseline,
      };
      const slpMin = Math.min(...dem.slopeDeg);
      const slpMax = Math.max(...dem.slopeDeg);
      const dnMin = Math.min(...themis.themisDayIr);
      const dnMax = Math.max(...themis.themisDayIr);
      console.log(
        `  [CUT 16km²+1km] ${t.id} (${t.lat}, ${lon180}): `
        + `DEM ${dem.paddedPixels} -> slope ${slpMin.toFixed(1)}..${slpMax.toFixed(1)}°, `
        + `THEMIS Day IR ${themis.paddedPixels} -> DN ${dnMin}..${dnMax}`
      );
    }
  }

  demReader.close();
  themisReader.close();

  const outObj = {
    _meta: {
      ...(existing._meta || {}),
      generated_by: 'tools/precut_16km2.mjs + data_pipeline/fetch_eva_cutouts.py',
      box_km: BOX_KM,
      padding_km: PAD_KM,
      area_km2: BOX_KM * BOX_KM,
      grid_n: GRID_N,
      cell_m: CELL_M,
      rasters: [DEM_FILENAME, THEMIS_FILENAME],
      coordinateConversion: 'MOLA-HRSC 200m DEM: -180..+180E Equirectangular (NoData=-32768 -> neighbor fill); THEMIS Day IR 100m v12: SimpleCylindrical cm=180E 0..360E uint8 (NoData=0 -> neighbor fill)',
    },
    sim3292ObjectIdToUnit: existing.sim3292ObjectIdToUnit || {},
    zones: zonesOut,
  };

  const jsonStr = JSON.stringify(outObj);
  fs.writeFileSync(CUTOUTS_JSON, jsonStr, 'utf8');
  const jsStr = `(function (global) {\n  'use strict';\n  var DATA = ${jsonStr};\n  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;\n  global.MDE_EVA_CUTOUTS = DATA;\n})(typeof globalThis !== 'undefined' ? globalThis : window);\n`;
  fs.writeFileSync(CUTOUTS_JS, jsStr, 'utf8');

  const newJsonBytes = fs.statSync(CUTOUTS_JSON).size;
  const newJsBytes = fs.statSync(CUTOUTS_JS).size;
  const addedMB = ((newJsonBytes - prevJsonBytes) + (newJsBytes - prevJsBytes)) / (1024 * 1024);
  console.log(`\nWrote ${CUTOUTS_JSON} (${(newJsonBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Wrote ${CUTOUTS_JS} (${(newJsBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Added size total: ${addedMB.toFixed(2)} MB (target < 20 MB)`);
}

main();
