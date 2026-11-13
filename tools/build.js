// Build a clean HTTP CDN distribution in dist/ excluding the 25.63 MB offline file:// bundle.
// Keeps web/ untouched so opening web/index.html directly from disk (file://) stays 100% functional.
// Run: node tools/build.js  (or npm run build)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'web');
const DIST = path.join(ROOT, 'dist');

function copyTree(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  let files = 0, bytes = 0;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name === 'layers_data.js') continue; // Excluded from HTTP CDN build (PNGs stream faster & smaller)
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      const sub = copyTree(s, d);
      files += sub.files; bytes += sub.bytes;
    } else {
      fs.copyFileSync(s, d);
      files++; bytes += fs.statSync(d).size;
    }
  }
  return { files, bytes };
}

fs.rmSync(DIST, { recursive: true, force: true });
const res = copyTree(SRC, DIST);
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
fs.writeFileSync(path.join(DIST, 'build-manifest.json'), JSON.stringify({
  built_at: new Date().toISOString(),
  excluded_offline_bundle: 'layers_data.js',
  files: res.files,
  total_bytes: res.bytes,
  csp: (vercel.headers || []).flatMap(h => h.headers || []).find(h => h.key === 'Content-Security-Policy')?.value || null,
}, null, 2) + '\n');

console.log(`Built HTTP CDN bundle -> dist/ (${res.files} files, ${(res.bytes / 1e6).toFixed(2)} MB; excluded offline layers_data.js).`);
