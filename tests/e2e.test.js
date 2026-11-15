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
  if (writeStream) writeStream.on('error', () => {});
  if (readStream) readStream.on('error', () => {});
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
      if (!gl || gl.isContextLost() || !window.MDE || !window.MDE.globe || window.MDE.globe.state.contextLost) return null;
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

    // 6. Test High-Contrast Light/Dark Theme toggle, keyboard card selection, plain-language summary, guide dismiss + TR/EN switch
    await evalJS(`document.getElementById('btn-theme').click()`);
    const themeCheck = await evalJS(`({
      theme: document.documentElement.getAttribute('data-theme'),
      hudBg: getComputedStyle(document.querySelector('.map-hud')).backgroundColor,
    })`);
    assert.strictEqual(themeCheck.theme, 'light', 'Clicking #btn-theme should toggle data-theme="light"');
    assert(!themeCheck.hudBg.startsWith('rgba(11, 12, 16') && !themeCheck.hudBg.startsWith('rgb(11, 12, 16'), `Light-theme .map-hud must use light translucent background, got: ${themeCheck.hudBg}`);
    await evalJS(`document.getElementById('btn-theme').click()`);

    // Keyboard activation of a ranked candidate card via Enter key -> active state + plain summary card
    await evalJS(`(() => {
      const card = document.querySelectorAll('#candidates .card')[1];
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    const kbState = await evalJS(`({
      pressed: document.querySelectorAll('#candidates .card')[1].getAttribute('aria-pressed'),
      summary: document.querySelector('#detail .plain-verdict') ? document.querySelector('#detail .plain-verdict').textContent : '',
      checksText: document.querySelector('#detail .hls-checks') ? document.querySelector('#detail .hls-checks').textContent : '',
    })`);
    assert.strictEqual(kbState.pressed, 'true', 'Pressing Enter on a candidate card should select it');
    assert(kbState.summary.includes('Plain summary') && kbState.summary.includes('mSv/yr'), `Plain summary card missing or incomplete: ${kbState.summary}`);
    assert(kbState.checksText.includes('✓') || kbState.checksText.includes('✕'), 'Constraint check badges must include non-color ✓/✕ indicator');

    // TES dust is interpolated (never 'no data'); the removed legacy demo leaves no fabricated confidence rows behind
    const detailText = await evalJS(`document.getElementById('detail').textContent`);
    assert(!/TES Dust Abundance\s*no data/i.test(detailText), `TES Dust Abundance should be interpolated, not 'no data': ${detailText}`);
    assert(!detailText.includes('TRN+AutoNav+MGL') && !detailText.includes('xGDS') && !detailText.includes('PIML'), `Detail panel must not show legacy demo / fake-ML rows: ${detailText}`);
    await evalJS(`document.getElementById('use-eva').click()`);
    await waitFor(() => evalJS(`(() => { const p = document.getElementById('panel-eva'); return p && !p.classList.contains('hidden') ? true : null; })()`), 'Tactical EVA panel opens from the candidate card');
    const legacyGone = await evalJS(`!document.getElementById('eva-legacy-details') && !document.getElementById('hud-modal') && !window.MDE_EVA`);
    assert(legacyGone, 'Legacy 1 km demo, HUD modal and MDE_EVA module are removed');

    // Verify rebuilt Tactical EVA 16 km2 UI & local analysis workflow (Sections A/B/C, 50% square map, 11 layers, popup, persistence)
    const tacInit = await evalJS(`(() => {
      const secField = document.getElementById('tac-sec-field');
      const secWeights = document.getElementById('tac-sec-weights');
      const ws = document.getElementById('tac-workspace');
      const clsOpts = Array.from(document.querySelectorAll('#tac-veh-class option')).map(o => o.value);
      const box = document.getElementById('tac-map-box').getBoundingClientRect();
      const wrap = document.querySelector('.map-wrap').getBoundingClientRect();
      return {
        fieldOpen: !!(secField && secField.open),
        weightsOpen: !!(secWeights && secWeights.open),
        wsVisible: !!(ws && !ws.classList.contains('hidden')),
        closeBtn: !!document.getElementById('tac-close-map-btn'),
        clsOpts,
        squareDiffPx: Math.abs(box.width - box.height),
        boxW: box.width,
        wrapW: wrap.width,
        layerCount: document.querySelectorAll('#tac-layer-list input[type="checkbox"]').length,
        resLabel: document.getElementById('tac-res-label').textContent,
      };
    })()`);
    assert.strictEqual(tacInit.fieldOpen, false, 'Section D Field Data must start collapsed by default');
    assert.strictEqual(tacInit.weightsOpen, false, 'Advanced weights must start collapsed by default');
    assert.strictEqual(tacInit.closeBtn, true, 'Red X close button must replace Compact button');
    assert.strictEqual(tacInit.wsVisible, true, '16 km2 tactical workspace must be visible on Tactical EVA tab');
    assert.deepStrictEqual(tacInit.clsOpts, ['mini_rover', 'lab_rover', 'manned_rover'], 'Only the 3 rover classes (no on-foot option) in #tac-veh-class');
    assert(tacInit.squareDiffPx <= 2 && tacInit.boxW >= 200 && tacInit.boxW <= tacInit.wrapW * 0.78, `16 km2 map must remain square and ~70% viewport size (box=${tacInit.boxW}, wrap=${tacInit.wrapW}, diff=${tacInit.squareDiffPx})`);
    assert.strictEqual(tacInit.layerCount, 12, '12 toggleable map layers (incl. Power & Energy) with opacity sliders expected');
    assert(tacInit.resLabel.includes('Data resolution'), `Data resolution label expected, got: ${tacInit.resLabel}`);

    await evalJS(`(() => {
      const d = document.getElementById('tac-date');
      d.value = '2021-02-18';
      d.dispatchEvent(new Event('change'));
    })()`);
    const percClock = await evalJS(`document.getElementById('tac-mars-time').textContent`);
    assert(percClock.includes('MY 36') && percClock.includes('Ls 5.'), `Mars24 clock should compute MY 36 Ls ~5 deg for 2021-02-18, got: ${percClock}`);

    await evalJS(`(() => {
      const vc = document.getElementById('tac-veh-class');
      vc.value = 'manned_rover';
      vc.dispatchEvent(new Event('change'));
    })()`);
    const mannedUi = await evalJS(`({
      bannerHidden: document.getElementById('tac-veh-concept-banner').classList.contains('hidden'),
      bannerTxt: document.getElementById('tac-veh-concept-banner').textContent,
      spMax: document.getElementById('tac-veh-speed').max,
      ldMax: document.getElementById('tac-veh-load').max,
      pwDisabled: document.getElementById('tac-veh-power-mode').disabled,
    })`);
    assert(!mannedUi.bannerHidden && mannedUi.bannerTxt.includes('CONCEPT – not flight data'), 'Manned rover shows CONCEPT – not flight data banner');
    assert.strictEqual(mannedUi.spMax, '15');
    assert.strictEqual(mannedUi.ldMax, '1000');
    assert.strictEqual(mannedUi.pwDisabled, false);

    await evalJS(`(() => {
      const vc = document.getElementById('tac-veh-class');
      vc.value = 'mini_rover';
      vc.dispatchEvent(new Event('change'));
      const on = document.getElementById('tac-online-toggle');
      on.checked = false;
      on.dispatchEvent(new Event('change'));
      const pz = document.getElementById('tac-preset-zone');
      pz.value = 'arcadia_ice';
      pz.dispatchEvent(new Event('change'));
      document.querySelector('#tac-tau-presets button[data-tau="10.8"]').click();
      document.getElementById('tac-generate-btn').click();
    })()`);
    const arcRes = await waitFor(() => evalJS(`(() => {
      const s = document.getElementById('tac-summary').textContent;
      const nw = document.getElementById('tac-corner-nw').textContent;
      const sp = document.getElementById('tac-veh-specs').textContent;
      return s.includes('High-res (100–200 m)') && nw.includes('39.2') ? { s, nw, sp } : null;
    })()`), 'Arcadia offline 16 km2 pre-cut analysis');
    assert(arcRes.sp.includes('⚠ unverified'), 'Mini rover displays ⚠ unverified badge on seed slope limit');
    assert(arcRes.s.includes('Mean / Min / Max') && arcRes.s.includes('Impassable') && arcRes.s.includes('cannot power itself'), 'Summary renders area stats and power-deficit alert on Mini Rover tau=10.8');

    await evalJS(`(() => {
      const cvs = document.getElementById('tac-canvas');
      const r = cvs.getBoundingClientRect();
      cvs.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 }));
    })()`);
    const popTxt = await evalJS(`document.getElementById('tac-cell-popup').textContent`);
    assert(
      popTxt.includes('Landing compatibility:') && popTxt.includes('Cell (') && popTxt.includes('Ground Comp') && popTxt.includes('MEASURED') && popTxt.includes('MODEL') && !/Mastcam|SuperCam|SHERLOC|PIXL/i.test(popTxt),
      `Cell popup renders hero score, rule explanation, badges, and no fake instruments on Arcadia: ${popTxt.slice(0, 240)}`
    );

    await evalJS(`document.getElementById('tac-close-map-btn').click()`);
    assert(await evalJS(`document.getElementById('tac-workspace').classList.contains('hidden')`), 'Clicking close X hides #tac-workspace');
    await evalJS(`document.getElementById('tac-generate-btn').click()`);
    assert(await evalJS(`!document.getElementById('tac-workspace').classList.contains('hidden')`), 'Clicking Generate reopens #tac-workspace');

    await evalJS(`document.getElementById('tac-worst-day-btn').click()`);
    const worstTxt = await evalJS(`document.getElementById('tac-summary').textContent`);
    assert(worstTxt.includes('Worst-day:') && worstTxt.includes('Normal:'), `Worst-day button shows Normal -> Worst-day comparison: ${worstTxt}`);
    await evalJS(`document.getElementById('tac-normal-day-btn').click()`);
    await evalJS(`(() => { document.querySelector('#tac-tau-presets button[data-tau="10.8"]').click(); })()`);

    await evalJS(`document.querySelector('.mode-btn[data-mode="score"]').click()`);
    const cardCoord = await evalJS(`(() => {
      const card = document.querySelector('#candidates .card');
      card.click();
      document.querySelector('.mode-btn[data-mode="eva"]').click();
      return {
        lat: document.getElementById('tac-lat').value,
        veh: document.getElementById('tac-veh-class').value,
        tau: document.getElementById('tac-tau').value,
      };
    })()`);
    assert.notStrictEqual(Number(cardCoord.lat), 39.2, 'Clicking candidate card updates Section A latitude');
    assert.strictEqual(cardCoord.veh, 'mini_rover', 'Vehicle class input persists across tab switches');
    assert.strictEqual(cardCoord.tau, '10.8', 'Dust tau input persists across tab switches');

    await evalJS(`document.querySelector('.mode-btn[data-mode="score"]').click()`);

    await evalJS(`document.getElementById('guide-dismiss').click()`);
    assert(await evalJS(`document.getElementById('welcome-guide').classList.contains('hidden')`), '#guide-dismiss should hide the quick-start guide');

    await evalJS(`document.getElementById('btn-lang').click()`);
    const trState = await evalJS(`({
      lang: document.documentElement.getAttribute('lang'),
      modeLabel: document.querySelector('.mode-btn[data-mode="score"] .mode-label').textContent,
      slopeLead: document.querySelector('#maxslope').closest('label').firstChild.nodeValue,
      legendText: document.getElementById('legend').textContent,
      saveText: document.getElementById('btn-save-key').textContent,
      aboutHtml: document.getElementById('about-content').textContent,
      plainTr: document.querySelector('#detail .plain-verdict') ? document.querySelector('#detail .plain-verdict').textContent : '',
    })`);
    assert.strictEqual(trState.lang, 'tr', 'Clicking #btn-lang should set html lang="tr"');
    assert.strictEqual(trState.modeLabel, 'Saha seçimi', 'Turkish mode button label rendered');
    assert.strictEqual(trState.slopeLead, 'Model eğim sınırı (zemin uyarlamalı) ', 'Turkish slider label preserved without clobbering input');
    assert(trState.legendText.includes('ELENDİ/ZAYIF') || trState.legendText.includes('DİK'), `Legend should localize cleanly: ${trState.legendText}`);
    assert.strictEqual(trState.saveText, 'Kaydet', 'Module IV save button localized');
    assert(trState.aboutHtml.includes('Mühendislik Gerekçesi'), '#about-content Method modal translates to Turkish');
    assert(trState.plainTr.includes('Bir bakışta özet'), `Turkish plain summary card missing: ${trState.plainTr}`);
    await evalJS(`document.getElementById('btn-lang').click()`);
    const enCheck = await evalJS(`({ mode: document.querySelector('.mode-btn[data-mode="score"] .mode-label').textContent, aboutHtml: document.getElementById('about-content').textContent })`);
    assert.strictEqual(enCheck.mode, 'Site selection', 'Second #btn-lang click reverts cleanly back to English');
    assert(enCheck.aboutHtml.includes('Why it matters'), '#about-content reverts cleanly back to English');

    // 7. Multi-device responsive layout & touch viewport verification (laptop, tablet, phone, small phone, landscape)
    const viewports = [
      { name: 'laptop-1280', width: 1280, height: 800, mobile: false, dpr: 1, stackMapFirst: false },
      { name: 'tablet-768', width: 768, height: 1024, mobile: true, dpr: 2, stackMapFirst: true },
      { name: 'mobile-390', width: 390, height: 844, mobile: true, dpr: 2, stackMapFirst: true },
      { name: 'mobile-360', width: 360, height: 740, mobile: true, dpr: 2, stackMapFirst: true },
      { name: 'landscape-667', width: 667, height: 375, mobile: true, dpr: 2, stackMapFirst: true },
    ];
    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.dpr,
        mobile: vp.mobile
      }, sessionId);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile }, sessionId);
      await evalJS(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      const layout = await evalJS(`(() => {
        const doc = document.documentElement;
        const map = document.querySelector('.map-wrap').getBoundingClientRect();
        const left = document.querySelector('.panel.left').getBoundingClientRect();
        const right = document.querySelector('.panel.right').getBoundingClientRect();
        const canvas = document.getElementById('map');
        const modes = document.querySelector('.modes').getBoundingClientRect();
        const brand = document.querySelector('.brand').getBoundingClientRect();
        const headerOverlap = !(modes.left >= brand.right - 2 || modes.top >= brand.bottom - 2 || modes.right <= brand.left + 2 || modes.bottom <= brand.top + 2);
        return {
          scrollW: doc.scrollWidth,
          innerW: window.innerWidth,
          mapTop: Math.round(map.top),
          mapH: Math.round(map.height),
          mapW: Math.round(map.width),
          leftTop: Math.round(left.top),
          rightTop: Math.round(right.top),
          canvasW: canvas.width,
          canvasH: canvas.height,
          modesRight: Math.round(modes.right),
          headerOverlap
        };
      })()`);
      assert(!layout.headerOverlap, `${vp.name}: .brand and .modes overlapped in topbar`);
      assert(layout.scrollW <= layout.innerW, `${vp.name}: horizontal overflow (${layout.scrollW} > ${layout.innerW})`);
      assert(layout.modesRight <= vp.width + 1, `${vp.name}: mode nav overflowed viewport (${layout.modesRight} > ${vp.width})`);
      assert(layout.mapW >= 280 && layout.mapH >= 240, `${vp.name}: map container too small (${layout.mapW}x${layout.mapH})`);
      assert(layout.canvasW >= vp.width * vp.dpr * 0.4, `${vp.name}: map canvas did not resize (${layout.canvasW}x${layout.canvasH})`);
      if (vp.stackMapFirst) {
        assert(layout.mapTop < layout.leftTop && layout.mapTop < layout.rightTop, `${vp.name}: map should render before panels (mapTop=${layout.mapTop}, leftTop=${layout.leftTop})`);
      }
      if (vp.name === 'mobile-360') {
        await evalJS(`document.getElementById('btn-lang').click()`);
        await evalJS(`document.querySelector('.mode-btn[data-mode="habitability"]').click()`);
        await evalJS(`document.getElementById('btn-export').click()`);
        await evalJS(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
        const mobileModal = await evalJS(`({
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          modalBoxW: document.querySelector('#brief-modal .modal-box').getBoundingClientRect().width
        })`);
        assert(mobileModal.scrollW <= mobileModal.innerW, `mobile-360 TR + brief modal horizontal overflow (${mobileModal.scrollW} > ${mobileModal.innerW})`);
        assert(mobileModal.modalBoxW <= 360, `mobile-360 modal box wider than viewport: ${mobileModal.modalBoxW}`);
        await evalJS(`document.getElementById('brief-close').click()`);
        await evalJS(`document.querySelector('.mode-btn[data-mode="score"]').click()`);
        await evalJS(`document.getElementById('btn-lang').click()`);
      }
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);

    // 7b. Landing site tab -> click map -> rover range blue circle, compatibility, summary, walk/EVA & storm tests -> red X clears
    await evalJS(`document.getElementById('btn-2d').click()`);
    const lsCheck = await evalJS(`(() => {
      document.querySelector('.mode-btn[data-mode="landing"]').click();
      const panel = document.getElementById('panel-landing');
      const empty = document.getElementById('ls-empty');
      const panelOpenedEmpty = !!(panel && !panel.classList.contains('hidden') && empty && !empty.classList.contains('hidden'));
      const canvas = document.getElementById('map');
      const r = canvas.getBoundingClientRect();
      // Include minor 4px pointer jitter to verify left-click still registers cleanly
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.5 + 4, clientY: r.top + r.height * 0.5 + 2 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.5 + 4, clientY: r.top + r.height * 0.5 + 2 }));
      canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0,
        clientX: r.left + r.width * 0.5 + 4, clientY: r.top + r.height * 0.5 + 2
      }));
      const card = document.getElementById('landing-setup-card');
      const r1 = window.MDE.S.customLanding ? window.MDE.S.customLanding.rangeKm : -1;
      const pt = window.MDE.S.customLanding && window.MDE.S.customLanding.circlePts ? window.MDE.S.customLanding.circlePts[0] : null;
      const scale1 = window.MDE.S.view.scale;
      document.getElementById('zoom-in').click();
      document.getElementById('zoom-in').click();
      const scale2 = window.MDE.S.view.scale;
      document.querySelector('#ls-rover-seg button[data-rover="mini_rover"]').click();
      const r2 = window.MDE.S.customLanding ? window.MDE.S.customLanding.rangeKm : -1;
      const compatTxt = document.getElementById('ls-compat-score').textContent;
      const sumTxt = document.getElementById('ls-summary-body').textContent;
      const walkTxt = document.getElementById('ls-walk-body').textContent;
      const stormTxt = document.getElementById('ls-storm-body').textContent;
      const opened = !!(card && !card.classList.contains('hidden') && empty.classList.contains('hidden'));
      document.getElementById('ls-close-btn').click();
      const closedAfterX = card.classList.contains('hidden') && !empty.classList.contains('hidden') && window.MDE.S.customLanding === null;
      document.querySelector('.mode-btn[data-mode="score"]').click();
      return {
        panelOpenedEmpty, opened, r1, r2,
        hasCirclePt: !!(pt && pt.length === 2),
        scaleRatio: scale2 / scale1,
        compatTxt, sumTxt, walkTxt, stormTxt,
        closedAfterX
      };
    })()`);
    assert(lsCheck.panelOpenedEmpty && lsCheck.opened, 'Landing site tab opens and clicking map populates analysis card');
    assert(lsCheck.r1 > 0 && lsCheck.r2 > 0 && lsCheck.r1 !== lsCheck.r2, `Landing site range reacts to rover class (r1=${lsCheck.r1}, r2=${lsCheck.r2})`);
    assert(lsCheck.hasCirclePt && lsCheck.scaleRatio > 1.2, `Range circle projects surface coords scaled by view.scale (scaleRatio=${lsCheck.scaleRatio})`);
    assert(lsCheck.compatTxt.includes('/ 100') && lsCheck.sumTxt.length > 10 && lsCheck.walkTxt.includes('kcal/h') && lsCheck.stormTxt.includes('m'), 'Compatibility, summary, walk/EVA, and dust-storm tests render in Landing site tab');
    assert(lsCheck.closedAfterX, 'Clicking red X clears landing site setup and blue circle');

    // 8. Verify zero CSP violations, zero page errors, zero console errors
    const violations = await evalJS(`window.__cspViolations || []`);
    assert.strictEqual(violations.length, 0, `CSP violations detected under strict vercel.json CSP: ${JSON.stringify(violations)}`);
    assert.strictEqual(pageErrors.length, 0, `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.strictEqual(consoleErrors.length, 0, `Console errors: ${consoleErrors.join(' | ')}`);

    console.log(
      `PASS HTTP E2E (${requestedFiles.length} streamed assets, ` +
      `WebGL "${glState.renderer}", 0 CSP violations, 0 errors)`
    );
  } catch (err) {
    console.error('HTTP E2E diagnostic -> pageErrors:', pageErrors, 'consoleErrors:', consoleErrors, 'lastRequests:', requestedFiles.slice(-8));
    throw err;
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
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
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
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        document.querySelector('.mode-btn[data-mode="eva"]').click();
        const on = document.getElementById('tac-online-toggle');
        on.checked = false;
        on.dispatchEvent(new Event('change'));
        document.getElementById('tac-generate-btn').click();
      })()`,
      returnByValue: true
    }, sessionId);
    const fileTac = await waitFor(async () => {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const ws = document.getElementById('tac-workspace');
          const s = document.getElementById('tac-summary');
          return ws && !ws.classList.contains('hidden') && s && s.textContent.includes('High-res (100–200 m)') ? s.textContent : null;
        })()`,
        returnByValue: true
      }, sessionId);
      return res.result ? res.result.value : null;
    }, 'offline file:// Tactical EVA 16 km2 analysis');
    assert(fileTac.includes('High-res (100–200 m)') && fileTac.includes('Mean / Min / Max'), 'file:// offline Tactical EVA preset renders cleanly');
    assert.strictEqual(pageErrors.length, 0, `file:// errors: ${pageErrors.join(' | ')}`);
    console.log('PASS file:// offline E2E (5 candidates + Tactical EVA 16 km2 pre-cut rendered, 0 errors)');
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
