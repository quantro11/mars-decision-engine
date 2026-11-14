#!/usr/bin/env node
/**
 * tools/build_detail_tiles.mjs
 * Builds a zoom-dependent relief tile pyramid for the GLOBAL 2D map from the locally downloaded
 * MOLA-HRSC Blended DEM 200 m (USGS; Fergason, Hare & Laura 2018, v2).
 *
 * Why: the global map ships as one 4096x2048 image (~5.2 km/px). A full 200 m global image would
 * be ~5.7 gigapixels and cannot load in a browser. Instead we cut sharper 256x256 tiles that the
 * map only downloads for the part of Mars you are zoomed into (the "Google Maps" approach).
 *
 * Output (equirectangular, -180..+180 E, 90N..90S, same projection as the base map):
 *   web/tiles/relief/{z}/{x}_{y}.png   8-bit grayscale hillshade, 128 = flat (for soft-light blending)
 *   web/tiles/manifest.json            levels, tile size, km/px per level, provenance
 *
 * Levels (base map = level 3 = 4096 px wide):
 *   z4 =  8192 px wide  ~2.6 km/px  (2x sharper)     ~512 tiles
 *   z5 = 16384 px wide  ~1.3 km/px  (4x sharper)    ~2048 tiles   <- default max
 *   z6 = 32768 px wide  ~650 m/px   (8x sharper)    ~8192 tiles   (opt-in: --max-level 6, large)
 *
 * Usage (Windows PowerShell, from the project folder):
 *   node tools/build_detail_tiles.mjs
 *   node tools/build_detail_tiles.mjs --downloads "C:\Users\slmcn\Downloads" --max-level 5
 *   node tools/build_detail_tiles.mjs --dem path\to\dem.tif      (explicit file)
 *
 * Pure Node.js (no npm packages). Reads the uncompressed BigTIFF row by row; peak memory ~1 GB at z5.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'web', 'tiles');
const DEM_FILENAME = 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif';
const NODATA = -32768;
const R_MARS = 3396190.0;
const BASE_LEVEL = 3;
const BASE_W = 4096;
const TILE = 256;

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const downloadsDir = arg('--downloads', process.env.MDE_RASTER_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads'));
const demPath = arg('--dem', path.join(downloadsDir, DEM_FILENAME));
const maxLevel = Math.max(4, Math.min(6, parseInt(arg('--max-level', '5'), 10)));
const minLevel = 4;
const exaggeration = parseFloat(arg('--exaggeration', '5'));
const outDir = arg('--out', OUT_DIR);

// ---------------------------------------------------------------- minimal BigTIFF reader (uncompressed, RowsPerStrip=1)
class BigTiffReader {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, 'r');
    const hdr = this.read(0, 16);
    const bom = hdr.toString('ascii', 0, 2);
    const version = hdr.readUInt16LE(2);
    let tags;
    if (bom === 'II' && version === 43) { this.big = true; tags = this.readIfdBig(Number(hdr.readBigUInt64LE(8))); }
    else if (bom === 'II' && version === 42) { this.big = false; tags = this.readIfdClassic(hdr.readUInt32LE(4)); }
    else throw new Error(`Unsupported TIFF (bom=${bom} v=${version})`);
    this.width = tags[256].v[0];
    this.height = tags[257].v[0];
    this.bits = tags[258].v[0];
    const comp = tags[259] ? tags[259].v[0] : 1;
    const rps = tags[278] ? tags[278].v[0] : this.height;
    if (comp !== 1) throw new Error(`Compressed TIFF not supported (compression=${comp})`);
    if (this.bits !== 16) throw new Error(`Expected 16-bit DEM, got ${this.bits}-bit`);
    this.rps = rps;
    this.strips = tags[273];
  }
  read(off, len) {
    const b = Buffer.alloc(len);
    const n = fs.readSync(this.fd, b, 0, len, off);
    if (n !== len) throw new Error(`Short read at ${off}`);
    return b;
  }
  readIfdBig(off) {
    const n = Number(this.read(off, 8).readBigUInt64LE(0));
    const e = this.read(off + 8, n * 20);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8 };
    const tags = {};
    for (let i = 0; i < n; i++) {
      const o = i * 20, tag = e.readUInt16LE(o), type = e.readUInt16LE(o + 2), count = Number(e.readBigUInt64LE(o + 4));
      const total = count * (SZ[type] || 1);
      tags[tag] = { type, count, dataOffset: total > 8 ? Number(e.readBigUInt64LE(o + 12)) : null, inline: e.subarray(o + 12, o + 20), v: [] };
      if (tag !== 273 && tag !== 279 && total <= 64) tags[tag].v = this.decode(type, count, total > 8 ? this.read(tags[tag].dataOffset, total) : tags[tag].inline);
    }
    return tags;
  }
  readIfdClassic(off) {
    const n = this.read(off, 2).readUInt16LE(0);
    const e = this.read(off + 2, n * 12);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8 };
    const tags = {};
    for (let i = 0; i < n; i++) {
      const o = i * 12, tag = e.readUInt16LE(o), type = e.readUInt16LE(o + 2), count = e.readUInt32LE(o + 4);
      const total = count * (SZ[type] || 1);
      tags[tag] = { type, count, dataOffset: total > 4 ? e.readUInt32LE(o + 8) : null, inline: e.subarray(o + 8, o + 12), v: [] };
      if (tag !== 273 && tag !== 279 && total <= 64) tags[tag].v = this.decode(type, count, total > 4 ? this.read(tags[tag].dataOffset, total) : tags[tag].inline);
    }
    return tags;
  }
  decode(type, count, raw) {
    const out = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) out.push(raw.readUInt16LE(k * 2));
      else if (type === 4) out.push(raw.readUInt32LE(k * 4));
      else if (type === 16) out.push(Number(raw.readBigUInt64LE(k * 8)));
      else if (type === 1) out.push(raw.readUInt8(k));
    }
    return out;
  }
  stripOffset(strip) {
    const s = this.strips;
    if (s.count === 1) return this.big ? Number(s.inline.readBigUInt64LE(0)) : s.inline.readUInt32LE(0);
    const stride = s.type === 16 ? 8 : 4;
    const b = this.read(s.dataOffset + strip * stride, stride);
    return stride === 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  }
  /** Read one full row as Int16Array. */
  row(r) {
    const strip = Math.floor(r / this.rps);
    const within = r - strip * this.rps;
    const off = this.stripOffset(strip) + within * this.width * 2;
    const b = this.read(off, this.width * 2);
    return new Int16Array(b.buffer, b.byteOffset, this.width);
  }
}

// ---------------------------------------------------------------- PNG encoder (8-bit grayscale)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodeGrayPng(w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w + 1);
    raw[o] = 2; // "Up" filter: hillshade rows correlate strongly
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      const up = y > 0 ? px[(y - 1) * w + x] : 0;
      raw[o + 1 + x] = (v - up) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- 1. stream DEM -> box-averaged elevation at max level
function buildMaxLevelElevation(reader, Wz, Hz) {
  const elev = new Float32Array(Wz * Hz).fill(NaN);
  const sum = new Float64Array(Wz), cnt = new Uint32Array(Wz);
  const colMap = new Int32Array(reader.width);
  for (let c = 0; c < reader.width; c++) colMap[c] = Math.min(Wz - 1, Math.floor((c * Wz) / reader.width));
  let outRow = 0;
  const t0 = Date.now();
  for (let r = 0; r < reader.height; r++) {
    const target = Math.min(Hz - 1, Math.floor((r * Hz) / reader.height));
    if (target !== outRow) {
      for (let x = 0; x < Wz; x++) elev[outRow * Wz + x] = cnt[x] ? sum[x] / cnt[x] : NaN;
      sum.fill(0); cnt.fill(0); outRow = target;
    }
    const row = reader.row(r);
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === NODATA) continue;
      const x = colMap[c]; sum[x] += v; cnt[x]++;
    }
    if (r % 2000 === 0) {
      const pct = ((r / reader.height) * 100).toFixed(1);
      const eta = r > 0 ? (((Date.now() - t0) / r) * (reader.height - r) / 1000).toFixed(0) : '?';
      process.stdout.write(`\r  reading DEM rows: ${pct}%  (eta ${eta}s)   `);
    }
  }
  for (let x = 0; x < Wz; x++) elev[outRow * Wz + x] = cnt[x] ? sum[x] / cnt[x] : NaN;
  process.stdout.write('\r  reading DEM rows: 100%                     \n');
  // Fill isolated NoData holes from neighbours (rare in the blended product)
  for (let i = 0; i < elev.length; i++) if (Number.isNaN(elev[i])) elev[i] = Number.isNaN(elev[i - 1]) ? 0 : elev[i - 1];
  return elev;
}

function downsample2x(src, W, H) {
  const w = W >> 1, h = H >> 1, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * W + 2 * x;
    out[y * w + x] = (src[i] + src[i + 1] + src[i + W] + src[i + W + 1]) * 0.25;
  }
  return out;
}

// ---------------------------------------------------------------- 2. hillshade (azimuth 315, altitude 45), 128 = flat
function hillshade(elev, W, H, exag) {
  const out = new Uint8Array(W * H);
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  const Lx = Math.sin(az) * Math.cos(alt), Ly = Math.cos(az) * Math.cos(alt), Lz = Math.sin(alt);
  const flat = Lz;
  const dyM = (Math.PI * R_MARS) / H;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    const dxM = Math.max(1, ((2 * Math.PI * R_MARS) / W) * Math.cos((lat * Math.PI) / 180));
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W, xr = (x + 1) % W; // wraps across 180E
      const dzdx = ((elev[y * W + xr] - elev[y * W + xl]) / (2 * dxM)) * exag;        // east-positive
      const dzdn = -((elev[yd * W + x] - elev[yu * W + x]) / ((yd - yu) * dyM)) * exag; // north-positive
      // Surface normal (-dz/dx, -dz/dn, 1) dotted with a light from azimuth 315 (NW), altitude 45
      const nl = Math.hypot(dzdx, dzdn, 1);
      const shade = (-dzdx * Lx - dzdn * Ly + Lz) / nl;
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(128 + (shade - flat) * 320)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. cut tiles
function writeTiles(shade, W, H, z) {
  const dir = path.join(outDir, 'relief', String(z));
  fs.mkdirSync(dir, { recursive: true });
  const nx = W / TILE, ny = H / TILE;
  const tile = new Uint8Array(TILE * TILE);
  let bytes = 0, files = 0;
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    for (let y = 0; y < TILE; y++) tile.set(shade.subarray((ty * TILE + y) * W + tx * TILE, (ty * TILE + y) * W + tx * TILE + TILE), y * TILE);
    const png = encodeGrayPng(TILE, TILE, tile);
    fs.writeFileSync(path.join(dir, `${tx}_${ty}.png`), png);
    bytes += png.length; files++;
  }
  return { files, bytes };
}

// ---------------------------------------------------------------- main
function main() {
  if (!fs.existsSync(demPath)) {
    console.error(`DEM not found: ${demPath}\nPass --downloads "<folder>" or --dem "<file>".`);
    process.exit(1);
  }
  const reader = new BigTiffReader(demPath);
  console.log(`DEM: ${reader.width}x${reader.height} 16-bit  (${demPath})`);
  const Wmax = BASE_W * 2 ** (maxLevel - BASE_LEVEL), Hmax = Wmax / 2;
  console.log(`Building levels z${minLevel}..z${maxLevel} (max ${Wmax}x${Hmax}), vertical exaggeration x${exaggeration}`);

  let elev = buildMaxLevelElevation(reader, Wmax, Hmax);
  const levels = [];
  let total = 0;
  for (let z = maxLevel, W = Wmax, H = Hmax; z >= minLevel; z--, W >>= 1, H >>= 1) {
    if (z !== maxLevel) elev = downsample2x(elev, W * 2, H * 2);
    // Shallower relief at coarser levels needs a bit more exaggeration to stay readable
    const shade = hillshade(elev, W, H, exaggeration * (1 + (maxLevel - z) * 0.35));
    const r = writeTiles(shade, W, H, z);
    const kmPerPx = (2 * Math.PI * R_MARS) / W / 1000;
    levels.push({ z, width: W, height: H, tilesX: W / TILE, tilesY: H / TILE, kmPerPx: +kmPerPx.toFixed(3), files: r.files, bytes: r.bytes });
    total += r.bytes;
    console.log(`  z${z}: ${W}x${H} ~${kmPerPx.toFixed(2)} km/px -> ${r.files} tiles, ${(r.bytes / 1e6).toFixed(1)} MB`);
  }
  levels.sort((a, b) => a.z - b.z);
  const manifest = {
    layer: 'relief',
    tileSize: TILE,
    baseLevel: BASE_LEVEL,
    baseWidth: BASE_W,
    projection: 'equirectangular -180..+180E, 90N..90S (same as base map)',
    encoding: '8-bit grayscale hillshade, 128 = flat; azimuth 315 deg, altitude 45 deg',
    exaggeration,
    levels,
    totalBytes: total,
    source: {
      id: 'Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2',
      citation: 'Fergason, R. L., Hare, T. M., & Laura, J. (2018). HRSC and MOLA Blended Digital Elevation Model at 200m v2. USGS Astrogeology PDS Annex.',
      nativeResM: 200,
      url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m',
    },
    generatedBy: 'tools/build_detail_tiles.mjs',
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Done: ${(total / 1e6).toFixed(1)} MB of tiles in ${path.relative(ROOT, outDir) || outDir}`);
  if (total > 150e6) console.log('Warning: > 150 MB. Consider --max-level 5 to keep the deployment small.');
}

main();
