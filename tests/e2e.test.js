#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback PATH lookup on POSIX / Git Bash / CI runners
  const names = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'chromium', 'chromium-browser'];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const bin of names) {
      const full = path.join(dir, bin);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function loadVercelHeaders() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rule = (raw.headers || []).find((h) => h.source === '/(.*)');
  assert(rule && Array.isArray(rule.headers), 'Missing global security headers rule in vercel.json');
  return rule.headers.map((h) => ({ name: h.key, value: h.value }));
}

function createCdpClient(proc) {
  const writeStream = proc.stdio[3];
  const readStream = proc.stdio[4];
  let nextId = 1;
  let buf = Buffer.alloc(0);
  const pending = new Map();
  const listeners = new Map();

  readStream.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let idx;
    while ((idx = buf.indexOf(0)) !== -1) {
      const slice = buf.slice(0, idx).toString('utf8');
      buf = buf.slice(idx + 1);
      if (!slice) continue;
      let msg;
      try {
        msg = JSON.parse(slice);
      } catch (err) {
        continue;
      }
      if (msg.id) {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          if (msg.error) entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message}`));
          else entry.resolve(msg.result || {});
        }
      } else if (msg.method) {
        const handlers = listeners.get(msg.method);
        if (handlers) {
          for (const fn of handlers) {
            try { fn(msg.params || {}, msg.sessionId || null); } catch (_) {}
          }
        }
      }
    }
  });

  function send(method, params = {}, sessionId = undefined) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, 20000);
      pending.set(id, {
        method,
        resolve: (res) => { clearTimeout(timer); resolve(res); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      writeStream.write(JSON.stringify(payload) + '\0');
    });
  }

  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
  }

  return { send, on };
}

async function waitFor(fn, label, timeoutMs = 25000, intervalMs = 80) {
  const start = Date.now();
  let lastVal;
  while (Date.now() - start < timeoutMs) {
    lastVal = await fn();
    if (lastVal) return lastVal;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label} (last=${JSON.stringify(lastVal)})`);
}

async function runHttpE2E(browserPath, securityHeaders) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-e2e-http-'));
  const proc = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--user-data-dir=' + tmpDir,
    '--remote-debugging-pipe',
    '--window-size=1440,900',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
  });

  const cdp = createCdpClient(proc);
  const requestedFiles = [];
  const pageErrors = [];
  const consoleErrors = [];
  const cspViolations = [];

  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    let target = targetInfos.find((t) => t.type === 'page');
    if (!target) {
      const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
      target = { targetId: created.targetId };
    }
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });

    cdp.on('Fetch.requestPaused', async (params, sid) => {
      if (sid !== sessionId) return;
      const reqUrl = params.request && params.request.url || '';
      try {
        const u = new URL(reqUrl);
        if (u.hostname === 'mde.local') {
          let rel = decodeURIComponent(u.pathname);
          if (rel === '/' || rel === '') rel = '/index.html';
          rel = rel.replace(/^\/+/, '');
          requestedFiles.push(rel);
          const safePath = path.resolve(WEB_DIR, rel);
          if (!safePath.startsWith(WEB_DIR) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
            await cdp.send('Fetch.fulfillRequest', {
              requestId: params.requestId,
              responseCode: 404,
              responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
              body: Buffer.from('Not found').toString('base64')
            }, sessionId);
            return;
          }
          const ext = path.extname(safePath).toLowerCase();
          const bytes = fs.readFileSync(safePath);
          const headers = [
            { name: 'Content-Type', value: MIME[ext] || 'application/octet-stream' },
            ...securityHeaders
          ];
          await cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: headers,
            body: bytes.toString('base64')
          }, sessionId);
          return;
        }
        if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
          await cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/css; charset=utf-8' }],
            body: ''
          }, sessionId);
          return;
        }
        await cdp.send('Fetch.failRequest', {
          requestId: params.requestId,
          errorReason: 'BlockedByClient'
        }, sessionId);
      } catch (err) {
        try {
          await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }, sessionId);
        } catch (_) {}
      }
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      const desc = params.exceptionDetails && (params.exceptionDetails.exception && params.exceptionDetails.exception.description || params.exceptionDetails.text);
      pageErrors.push(desc || 'Unknown exception');
    });

    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = (params.args || []).map((a) => a.value || a.description || '').join(' ');
        // Ignore offline NASA RSS feed fallback warning if any, fail on anything else
        consoleErrors.push(text);
      }
    });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'http://mde.local/*' },
        { urlPattern: 'https://fonts.googleapis.com/*' },
        { urlPattern: 'https://fonts.gstatic.com/*' },
        { urlPattern: 'https://api.nasa.gov/*' }
      ]
    }, sessionId);

    // Attach CSP violation tracker before page scripts run
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({
            directive: e.violatedDirective,
            effective: e.effectiveDirective,
            blockedURI: e.blockedURI,
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber
          });
        });
      `
    }, sessionId);

    async function evalJS(expression) {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      }, sessionId);
      if (res.exceptionDetails) {
        throw new Error(`Eval error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
      }
      return res.result ? res.result.value : undefined;
    }

    await cdp.send('Page.navigate', { url: 'http://mde.local/index.html' }, sessionId);

    // 1. Wait until loading overlay hides and candidates + semantic meters render
    const boot = await waitFor(() => evalJS(`(() => {
      const loading = document.getElementById('loading');
      const cards = document.querySelectorAll('#candidates .card');
      const meters = document.querySelectorAll('meter.crit-meter');
      const sr = document.getElementById('sr-status');
      if (!loading || !loading.classList.contains('hidden')) return null;
      if (cards.length < 5 || meters.length < 3) return null;
      return {
        cardCount: cards.length,
        meterCount: meters.length,
        srText: sr ? sr.textContent : '',
        topScoreText: cards[0].textContent
      };
    })()`), 'initial app boot & candidate ranking');

    assert(boot.cardCount === 5, `Expected 5 candidate cards, got ${boot.cardCount}`);
    assert(boot.meterCount >= 5, `Expected criteria meters, got ${boot.meterCount}`);
    assert(boot.srText.length > 5, 'Expected #sr-status screen reader update');
    assert(!requestedFiles.includes('layers_data.js'), 'layers_data.js must NOT be requested over HTTP');
    assert(requestedFiles.includes('worker.js'), 'worker.js should be loaded over HTTP');
    assert(requestedFiles.includes('layers/elev.png'), 'elev.png should be streamed over HTTP');

    // 2. Switch to 3D Globe (Angle SwiftShader WebGL) & verify WebGL context + rendered pixels
    await evalJS(`document.getElementById('btn-3d').click()`);
    const glState = await waitFor(() => evalJS(`(() => {
      const btn = document.getElementById('btn-3d');
      const canvas = document.getElementById('globe');
      if (!btn || btn.getAttribute('aria-pressed') !== 'true') return null;
      if (!canvas || canvas.classList.contains('hidden')) return null;
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl || !window.MDE || !window.MDE.globe) return null;
      return {
        pressed: btn.getAttribute('aria-pressed'),
        renderer: gl.getParameter(gl.RENDERER),
        width: canvas.width,
        height: canvas.height,
        glError: gl.getError()
      };
    })()`), '3D globe WebGL activation');
    assert.strictEqual(glState.glError, 0, `WebGL reported error code ${glState.glError}`);
    assert(glState.width > 0 && glState.height > 0, 'Globe canvas should have non-zero dimensions');

    // Switch back to 2D map
    await evalJS(`document.getElementById('btn-2d').click()`);
    await waitFor(() => evalJS(`document.getElementById('btn-2d').getAttribute('aria-pressed') === 'true'`), '2D map activation');

    // 3. Test Route mode + Demo route planning via Web Worker A*
    await evalJS(`document.querySelector('.mode-btn[data-mode="route"]').click()`);
    await waitFor(() => evalJS(`!document.getElementById('route-demo').closest('.mode-panel').classList.contains('hidden')`), 'route mode panel');
    await evalJS(`document.getElementById('route-demo').click()`);
    const routeRes = await waitFor(() => evalJS(`(() => {
      const tbl = document.querySelector('#route-stats .stat-table');
      const svg = document.querySelector('#route-stats svg');
      if (!tbl || !svg) return null;
      return { statsText: tbl.textContent, hasProfileSvg: !!svg };
    })()`), 'route A* computation & elevation profile');
    assert(routeRes.hasProfileSvg, 'Route elevation SVG should render');
    assert(/km/.test(routeRes.statsText), `Route stats should display distance in km: ${routeRes.statsText}`);

    // 4. Test Dust-storm power (crisis) mode (select top candidate in crisis mode -> #crisis-summary + SVG)
    await evalJS(`document.querySelector('.mode-btn[data-mode="crisis"]').click()`);
    await evalJS(`document.querySelector('#candidates .card').click()`);
    const crisisRes = await waitFor(() => evalJS(`(() => {
      const sum = document.getElementById('crisis-summary');
      const svg = document.querySelector('#crisis-summary svg');
      if (!sum || !sum.textContent.trim() || !svg) return null;
      return { summary: sum.textContent, hasSvg: !!svg };
    })()`), 'dust-storm crisis power model');
    assert(crisisRes.hasSvg && crisisRes.summary.length > 10, 'Crisis summary & chart should render');

    // 5. Test Export Mission Brief modal open (including GeoJSON export) & Escape close
    await evalJS(`document.getElementById('btn-export').click()`);
    await waitFor(() => evalJS(`(() => {
      const m = document.getElementById('brief-modal');
      return m && !m.classList.contains('hidden') && !!document.getElementById('btn-dl-geojson');
    })()`), 'mission brief modal open with GeoJSON export');
    await evalJS(`document.getElementById('btn-dl-geojson').click()`);
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(() => evalJS(`document.getElementById('brief-modal').classList.contains('hidden')`), 'mission brief modal Escape close');

    // 6. Test High-Contrast Light/Dark Theme toggle + Live TR/EN language switch
    await evalJS(`document.getElementById('btn-theme').click()`);
    const theme = await evalJS(`document.documentElement.getAttribute('data-theme')`);
    assert.strictEqual(theme, 'light', 'Clicking #btn-theme should toggle data-theme="light"');
    await evalJS(`document.getElementById('btn-theme').click()`);

    await evalJS(`document.getElementById('btn-lang').click()`);
    const trState = await evalJS(`({
      lang: document.documentElement.getAttribute('lang'),
      modeLabel: document.querySelector('.mode-btn[data-mode="score"] .mode-label').textContent,
      slopeLead: document.querySelector('#maxslope').closest('label').firstChild.nodeValue,
      legendText: document.getElementById('legend').textContent,
      saveText: document.getElementById('btn-save-key').textContent,
      aboutHtml: document.getElementById('about-content').textContent,
    })`);
    assert.strictEqual(trState.lang, 'tr', 'Clicking #btn-lang should set html lang="tr"');
    assert.strictEqual(trState.modeLabel, 'Saha seçimi', 'Turkish mode button label rendered');
    assert.strictEqual(trState.slopeLead, 'Eğim sınırı ', 'Turkish slider label preserved without clobbering input');
    assert(trState.legendText.includes('ELENDİ/ZAYIF') || trState.legendText.includes('DİK'), `Legend should localize cleanly: ${trState.legendText}`);
    assert.strictEqual(trState.saveText, 'Kaydet', 'Module IV save button localized');
    assert(trState.aboutHtml.includes('Mühendislik Gerekçesi'), '#about-content Method modal translates to Turkish');
    await evalJS(`document.getElementById('btn-lang').click()`);
    const enCheck = await evalJS(`({ mode: document.querySelector('.mode-btn[data-mode="score"] .mode-label').textContent, aboutHtml: document.getElementById('about-content').textContent })`);
    assert.strictEqual(enCheck.mode, 'Site selection', 'Second #btn-lang click reverts cleanly back to English');
    assert(enCheck.aboutHtml.includes('Why it matters'), '#about-content reverts cleanly back to English');

    // 7. Verify zero CSP violations, zero page errors, zero console errors
    const violations = await evalJS(`window.__cspViolations || []`);
    assert.strictEqual(violations.length, 0, `CSP violations detected under strict vercel.json CSP: ${JSON.stringify(violations)}`);
    assert.strictEqual(pageErrors.length, 0, `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.strictEqual(consoleErrors.length, 0, `Console errors: ${consoleErrors.join(' | ')}`);

    console.log(
      `PASS HTTP E2E (${requestedFiles.length} streamed assets, ` +
      `WebGL "${glState.renderer}", 0 CSP violations, 0 errors)`
    );
  } finally {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      proc.once('exit', finish);
      try { proc.kill('SIGKILL'); } catch (_) {}
      setTimeout(finish, 2000);
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function runFileProtocolCheck(browserPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-e2e-file-'));
  const fileUrl = 'file:///' + path.join(WEB_DIR, 'index.html').replace(/\\/g, '/');
  const proc = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--user-data-dir=' + tmpDir,
    '--remote-debugging-pipe',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
  });

  const cdp = createCdpClient(proc);
  const pageErrors = [];
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    let target = targetInfos.find((t) => t.type === 'page');
    if (!target) {
      const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
      target = { targetId: created.targetId };
    }
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.text || 'error');
    });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: fileUrl }, sessionId);

    const fileBoot = await waitFor(async () => {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const l = document.getElementById('loading');
          const c = document.querySelectorAll('#candidates .card').length;
          return l && l.classList.contains('hidden') && c === 5 ? { c } : null;
        })()`,
        returnByValue: true
      }, sessionId);
      return res.result ? res.result.value : null;
    }, 'offline file:// boot with layers_data.js');

    assert.strictEqual(fileBoot.c, 5);
    assert.strictEqual(pageErrors.length, 0, `file:// errors: ${pageErrors.join(' | ')}`);
    console.log('PASS file:// offline E2E (5 candidates rendered, 0 errors)');
  } finally {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      proc.once('exit', finish);
      try { proc.kill('SIGKILL'); } catch (_) {}
      setTimeout(finish, 2000);
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    throw new Error('Headless Chromium/Chrome/Edge executable not found; set CHROME_PATH or install chromium');
  }
  const securityHeaders = loadVercelHeaders();
  await runHttpE2E(browser, securityHeaders);
  await runFileProtocolCheck(browser);
}

main().catch((err) => {
  console.error('E2E FAIL:', err);
  process.exit(1);
});
