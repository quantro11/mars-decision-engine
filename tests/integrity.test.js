// Run:  node tests/integrity.test.js
// Verifies bundle hygiene, asset references, metadata sync, syntax, DOM IDs, CSP, and zero global symbol collisions.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

// 1. Synchronous layers_data.js must NOT block HTTP page load (only loaded dynamically under file://)
assert.ok(!/<script[^>]+src=["']layers_data\.js["']/.test(html), 'index.html must not block-load 12 MB layers_data.js');
assert.ok(/<script[^>]+src=["']layers\/meta\.js["']/.test(html), 'index.html must load lightweight layers/meta.js');
assert.ok(!fs.existsSync(path.join(WEB, 'layers_meta.js')), 'duplicate web/layers_meta.js must not exist alongside web/layers/meta.js');

// 2. Unused legacy stylesheet premium.css must stay absent from active links and disk
assert.ok(!html.includes('premium.css'), 'index.html must not link premium.css');
assert.ok(!fs.existsSync(path.join(WEB, 'premium.css')), 'unused legacy web/premium.css must be removed');
const cssFiles = fs.readdirSync(WEB).filter(f => f.endsWith('.css'));
assert.deepStrictEqual(cssFiles, ['style.css'], 'only active stylesheet(s) should live in web/');

// 3. Every local script & stylesheet referenced in index.html must exist and compile cleanly
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
const styles = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"'http][^"']+)["']/g)].map(m => m[1]);
for (const s of [...scripts, ...styles]) {
  assert.ok(fs.existsSync(path.join(WEB, s)), `Missing asset referenced by index.html: ${s}`);
}

for (const s of [...scripts, 'worker.js']) {
  if (s === 'layers_data.js') continue;
  assert.ok(fs.existsSync(path.join(WEB, s)), `Missing worker/script asset: ${s}`);
  const code = fs.readFileSync(path.join(WEB, s), 'utf8');
  new vm.Script(code, { filename: s });
}

// 4. layers/meta.js must stay synchronized with layers/meta.json
const metaJson = JSON.parse(fs.readFileSync(path.join(WEB, 'layers/meta.json'), 'utf8'));
const metaSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(WEB, 'layers/meta.js'), 'utf8'), metaSandbox);
assert.deepStrictEqual(JSON.parse(JSON.stringify(metaSandbox.window.LAYER_META)), metaJson, 'layers/meta.js matches web/layers/meta.json');

// 5. No missing DOM IDs, zero duplicate top-level globals, & no calls to removed uncalibrated functions
const htmlIds = new Set([...html.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]));
const jsFiles = scripts.filter(s => s !== 'layers_data.js' && s !== 'layers/meta.js');
const topDecls = {};
for (const jf of jsFiles) {
  const code = fs.readFileSync(path.join(WEB, jf), 'utf8');
  for (const m of code.matchAll(/(?:\$|document\.getElementById)\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g)) {
    assert.ok(htmlIds.has(m[1]), `Missing DOM element #${m[1]} referenced in web/${jf}`);
  }
  for (const removed of ['calcISRU', 'calcMicroHazard', 'yieldLitersSol', 'boulderRiskPct']) {
    assert.ok(!code.includes(removed), `Removed uncalibrated symbol ${removed} still referenced in web/${jf}`);
  }
  for (const m of code.matchAll(/^(?:const|let|var|function)\s+([a-zA-Z_$][\w$]*)/gm)) {
    (topDecls[m[1]] ??= []).push(jf);
  }
}
const dups = Object.entries(topDecls).filter(([, files]) => files.length > 1);
assert.deepStrictEqual(dups, [], `Duplicate top-level declarations: ${JSON.stringify(dups)}`);

// 6. Accessibility, light/high-contrast theme, modular size, & design-system consistency
assert.ok(/<canvas[^>]+id=["']map["'][^>]+role=["']img["'][^>]+tabindex=["']0["'][^>]+aria-label=/.test(html), 'map canvas must be keyboard accessible');
assert.ok(html.includes('class="skip-link"') && html.includes('id="sr-status"') && html.includes('id="btn-theme"'), 'skip-link, sr-status live region, and theme switcher present');
assert.ok((html.match(/aria-modal=["']true["']/g) || []).length === 2, 'both modals must declare aria-modal="true"');
assert.ok(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').split(/\r?\n/).length <= 450, 'web/app.js coordinator stays compact (<= 450 lines)');
assert.ok(fs.existsSync(path.join(ROOT, 'CONTRIBUTING.md')), 'CONTRIBUTING.md exists');
for (const f of ['index.html', 'ui/habitability.js', 'ui/brief.js', 'ui/panels.js', 'ui/overlays.js', 'ui/map2d.js', 'ui/layers.js', 'app.js']) {
  const src = fs.readFileSync(path.join(WEB, f), 'utf8');
  assert.ok(!/style=/.test(src), `Inline HTML style= attribute found in web/${f} (strict style-src 'self' violation)`);
  for (const hex of ['#38bdf8', '#a3e635', '#f97316']) {
    assert.ok(!src.includes(hex), `Out-of-theme color ${hex} found in web/${f}`);
  }
}

// 7. Vercel deployment security (strict CSP with ZERO 'unsafe-inline' & worker-src 'self') & cache headers
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const hdrs = (vercel.headers || []).flatMap(h => h.headers || []);
const hdrKeys = new Set(hdrs.map(x => x.key));
const csp = (hdrs.find(x => x.key === 'Content-Security-Policy') || {}).value || '';
assert.ok(hdrKeys.has('Content-Security-Policy') && !csp.includes("'unsafe-inline'") && csp.includes("worker-src 'self'"), 'vercel.json enforces strict CSP without unsafe-inline and allows worker-src self');
assert.ok(hdrKeys.has('X-Content-Type-Options'), 'vercel.json sets X-Content-Type-Options');
assert.ok(hdrKeys.has('Cache-Control'), 'vercel.json sets asset Cache-Control');

console.log(`All integrity / sync / CSP / accessibility / asset tests passed (${scripts.length} scripts checked).`);
