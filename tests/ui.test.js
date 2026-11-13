// Run:  node tests/ui.test.js
// Tests extracted UI modules, edge-case A* wrapping/windowing, sensitivity determinism, and XSS safety.
const assert = require('assert');
const S = require('../web/scoring.js').SCORING;
const A = require('../web/astar.js').ASTAR;
const T = require('../web/storm.js').STORM;
const FMT = require('../web/ui/format.js').MDE_FMT;
const OV = require('../web/ui/overlays.js').MDE_OVERLAYS;
const MK = require('../web/ui/markers.js').MDE_MARKERS;
const BR = require('../web/ui/brief.js').MDE_BRIEF;
const HAB = require('../web/ui/habitability.js').MDE_HAB;
const Live = require('../web/live_api.js').LIVE_API;

// --- 1. Escaping & Formatting
assert.strictEqual(FMT.escHtml('<script>alert("x&\'1")</script>'), '&lt;script&gt;alert(&quot;x&amp;&#39;1&quot;)&lt;/script&gt;');
assert.strictEqual(FMT.escHtml(null), '');

// --- 2. Overlays LUT, radiation LUT & legend HTML
const radLut = OV.buildRadLut({ scale: 115.41, offset: -8200 }, S);
assert.strictEqual(radLut.length, 256);
assert.ok(radLut[200] > radLut[10], 'higher elevation index encodes higher GCR dose');
const W = 64, H = 16;
const L = {
  width: W, height: H,
  meta: { elev: { scale: 115.4, offset: -8200 }, slope: { scale: 0.125 }, rough: { scale: 4 }, ice: { scale: 0.01, offset: -1.28 }, ti: { scale: 4 } },
  latOfRow: (y) => 90 - (y + 0.5) * 180 / H,
  lonOfCol: (x) => -180 + (x + 0.5) * 360 / W,
  elev: new Uint8Array(W * H).fill(50),
  slope: new Uint8Array(W * H).fill(16),
  rough: new Uint8Array(W * H).fill(5),
  ice: new Uint8Array(W * H).fill(128),
  ti: new Uint8Array(W * H).fill(60),
  dust: new Uint8Array(W * H).fill(80),
};
const rgba = new Uint8ClampedArray(W * H * 4);
const score = S.scoreMap(L, S.PRESETS.balanced.w, true, new Float32Array(W * H));
for (const mode of ['score', 'ice', 'slope', 'elev', 'ti', 'rad', 'dust']) {
  OV.fillOverlayBuffer(rgba, mode, L, score, radLut);
  assert.ok(rgba[3] > 0 || mode === 'score', `overlay ${mode} sets pixel buffer`);
  assert.ok(OV.renderLegendHTML(mode).includes('linear-gradient'), `legend renders for ${mode}`);
}
OV.fillOverlayBuffer(rgba, 'none', L, score, radLut);
assert.strictEqual(rgba[3], 0, 'none overlay clears alpha');
assert.strictEqual(OV.renderLegendHTML('none'), '');

// --- 3. Canvas Markers (visible vs behind-globe horizon clipping)
global.window = { devicePixelRatio: 1 };
const calls = [];
const mockCtx = {
  beginPath() { calls.push('beginPath'); },
  arc(x, y, r) { calls.push(['arc', x, y, r]); },
  stroke() { calls.push('stroke'); },
  fill() { calls.push('fill'); },
  moveTo() {}, lineTo() {},
  fillRect() {}, strokeRect() {},
  fillText(t) { calls.push(['text', t]); },
  save() {}, restore() {}, translate() {}, rotate() {},
};
const mHidden = MK.createMarkers(mockCtx, () => [0, 0, false]);
mHidden.drawCandidateReticle(10, 10, 1, 0.9, true);
mHidden.drawSelectionReticle(10, 10);
mHidden.drawWaypoint(10, 10, '#fff', 'A');
mHidden.drawStationBeacon(10, 10);
assert.strictEqual(calls.length, 0, 'hidden 3D backface markers never draw');

const mVis = MK.createMarkers(mockCtx, (gx, gy) => [gx * 2, gy * 2, true]);
mVis.drawCandidateReticle(10, 10, 1, 0.9, true);
mVis.drawSelectionReticle(10, 10);
mVis.drawWaypoint(10, 10, '#fff', 'START');
mVis.drawStationBeacon(10, 10);
assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'text' && c[1] === '01'));
assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'text' && c[1] === 'STA-PWR'));

// --- 4. A* windowed memory optimization, unreachable cliff, and antimeridian wrap
const W2 = 512, H2 = 256;
const L2 = {
  width: W2, height: H2,
  meta: { elev: { scale: 115.4, offset: -8200 }, slope: { scale: 0.125 }, rough: { scale: 4 }, ti: { scale: 4 } },
  latOfRow: (y) => 90 - (y + 0.5) * 180 / H2,
  lonOfCol: (x) => -180 + (x + 0.5) * 360 / W2,
  elev: new Uint8Array(W2 * H2).fill(50),
  slope: new Uint8Array(W2 * H2).fill(10),
  rough: new Uint8Array(W2 * H2).fill(5),
  ti: new Uint8Array(W2 * H2).fill(60),
};
const localRoute = A.plan(L2, 100, 128, 120, 128, { marginPx: 30, maxSlope: 15, k: 0.3 });
assert.ok(localRoute.ok && localRoute.windowCells < W2 * H2 / 4, 'A* allocates compact local window instead of full globe');
const wrapRoute = A.plan(L2, W2 - 3, 128, 3, 128, { marginPx: 30, maxSlope: 15, k: 0.3 });
assert.ok(wrapRoute.ok && wrapRoute.path.length <= 10, 'A* wraps across antimeridian seamlessly');
for (let y = 0; y < H2; y++) L2.slope[y * W2 + 110] = 240; // 30 deg solid wall across full height
const blocked = A.plan(L2, 100, 128, 120, 128, { marginPx: 30, maxSlope: 15, k: 0.3 });
assert.strictEqual(blocked.ok, false, 'A* reports failure when no slope-safe path exists');

// --- 5. Monte Carlo sensitivity determinism
const refCands = [{ x: 20, y: 8, score: 0.8 }];
const r1 = S.sensitivity(L, S.PRESETS.balanced.w, true, refCands, { runs: 10, spread: 0.2, n: 3, blockPx: 4, minSepPx: 8, matchPx: 6 }, S.mulberry32(2026));
const r2 = S.sensitivity(L, S.PRESETS.balanced.w, true, refCands, { runs: 10, spread: 0.2, n: 3, blockPx: 4, minSepPx: 8, matchPx: 6 }, S.mulberry32(2026));
assert.deepStrictEqual(r1, r2, 'Monte Carlo sensitivity is reproducible with seeded PRNG');
assert.ok(r1[0] >= 0 && r1[0] <= 1);

// --- 6. Brief payload + HTML XSS escaping
const mockS = {
  preset: 'balanced', agg: 'geo', hard: true, iceBand: 'ice15', weights: { ...S.PRESETS.balanced.w },
  candidates: [{ x: 20, y: 8, blockPx: 2, score: 0.85, robust: 0.9 }],
  selected: { x: 20, y: 8 },
  score,
  route: { safe: wrapRoute, straight: wrapRoute, speed: 20 },
  crisis: { site: { x: 20, y: 8 }, ls: 251, tauPeak: 8, area: 1000, cons: 300, batt: 2000, kp: 2, regolith: 1.5 },
};
const payload = BR.buildBriefPayload({
  S: mockS, W, flatShare: () => 0.85,
  cellValues: () => ({ lat: 18, lon: 77, elev: -2500, slope: 2, ice: 0.5, rough: 15, ti: 250 }),
  blockValues: () => ({ lat: 18, lon: 77, elev: -2500, slope: 2, ice: 0.5, rough: 15, ti: 250 }),
  nearestRegion: () => ({ distDeg: 0.5, region: { name: 'Jezero Crater <img src=x onerror=alert(1)>', ez: true, lat: 18, lon: 77 } }),
  SCORING: S, STORM: T, FMT,
});
assert.strictEqual(payload.scoring_aggregation, 'geo');
assert.strictEqual(payload.top_candidates[0].ice_access, 'LIKELY');
assert.strictEqual(payload.top_candidates[0].regional_terrain_class, 'SMOOTH');
assert.strictEqual(payload.top_candidates[0].landing_slope_share_le5deg, 0.85);
assert.ok(Array.isArray(payload.traverse_plan.candidate_rest_stops));
assert.ok(payload.dust_storm_simulation.spe_design_basis_assumption.shielded_dose_msv <= 100);
assert.strictEqual(payload.dust_storm_simulation.survives_blackout, true);
assert.strictEqual(payload.top_candidates[0].robust_pct, 90);
const htmlOut = BR.renderBriefHTML(payload, FMT);
assert.ok(!htmlOut.includes('<img src=x'), 'Brief HTML escapes malicious tags');
assert.ok(htmlOut.includes('&lt;img src=x'), 'Escaped markup rendered safely');

// --- 7. Habitability API DOM controller, key visibility toggle, & XSS safety
(async () => {
  const store = { nasa_api_key: 'SECRET_1234' };
  const mockStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  const els = {
    '#nasa-api-key': { value: '', type: 'password' },
    '#btn-toggle-key': { textContent: 'Show', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, onclick: null },
    '#btn-save-key': { onclick: null },
    '#btn-fetch-live': { disabled: false, onclick: null },
    '#live-api-status': { textContent: '', innerHTML: '' },
    '#live-api-results': { innerHTML: '' },
  };
  const mockDoc = { querySelector: (s) => els[s] || null };
  let liveStateUpdated = null;
  HAB.initHabitabilityAPI({ document: mockDoc, storage: mockStorage, liveApi: Live, onLiveUpdate: (st) => { liveStateUpdated = st; } });
  assert.strictEqual(els['#nasa-api-key'].value, 'SECRET_1234');
  els['#btn-toggle-key'].onclick();
  assert.strictEqual(els['#nasa-api-key'].type, 'text');
  assert.strictEqual(els['#btn-toggle-key'].textContent, 'Hide');
  els['#btn-toggle-key'].onclick();
  assert.strictEqual(els['#nasa-api-key'].type, 'password');

  const okXssFetch = async (url) => {
    if (url.includes('insight_weather')) return { ok: true, json: async () => ({ sol_keys: ['675'], '675': { PRE: { av: 750 }, First_UTC: '<script>10-19' } }) };
    return { ok: true, json: async () => [{ activityID: 'CME-1', startTime: '<svg onload=alert(1)>', cmeAnalyses: [{ speed: 950 }] }] };
  };
  await HAB.renderHabitability(true, {
    document: mockDoc, storage: mockStorage, liveApi: Live, fetchFn: okXssFetch,
    onLiveUpdate: (st) => { liveStateUpdated = st; },
  });
  assert.strictEqual(els['#btn-fetch-live'].disabled, false, 'fetch button re-enabled after completion');
  assert.ok(liveStateUpdated && liveStateUpdated.space.events.length === 1);
  assert.ok(!els['#live-api-results'].innerHTML.includes('<script'));
  assert.ok(!els['#live-api-results'].innerHTML.includes('<svg onload'));
  assert.ok(els['#live-api-results'].innerHTML.includes('&lt;script&gt;'));
  assert.ok(els['#live-api-results'].innerHTML.includes('&lt;svg onload=alert(1)&gt;'));

  // --- 8. 3D WebGL Globe engine: fallback, raycast project/unproject, context loss/restore
  const g3dMod = require('../web/globe3d.js');
  const GL = g3dMod.GLOBE3D || (global.window && global.window.GLOBE3D);
  assert.strictEqual(GL.createGlobe({ width: 300, height: 300, getContext: () => null, addEventListener() {} }), null, 'returns null gracefully when WebGL is disabled');

  const glListeners = {};
  let lostCount = 0, restoredCount = 0;
  let drawCalls = 0, ctxLost = false;
  const noop = () => {};
  const mockGl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, TEXTURE_2D: 8,
    TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, LINEAR: 11, LINEAR_MIPMAP_LINEAR: 12,
    TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, REPEAT: 15, CLAMP_TO_EDGE: 16,
    UNPACK_FLIP_Y_WEBGL: 17, RGBA: 18, UNSIGNED_BYTE: 19, LUMINANCE: 20, NO_ERROR: 0,
    COLOR_BUFFER_BIT: 21, DEPTH_BUFFER_BIT: 22, DEPTH_TEST: 23, CULL_FACE: 24, BACK: 25,
    FLOAT: 26, TRIANGLE_STRIP: 27, TRIANGLES: 28, UNSIGNED_SHORT: 29, TEXTURE0: 30, TEXTURE1: 31, TEXTURE2: 32,
    createShader: () => ({}), shaderSource: noop, compileShader: noop,
    getShaderParameter: () => true, deleteShader: noop,
    createProgram: () => ({}), attachShader: noop, linkProgram: noop,
    getProgramParameter: () => true, deleteProgram: noop,
    createBuffer: () => ({}), bindBuffer: noop, bufferData: noop,
    createTexture: () => ({}), bindTexture: noop, texParameteri: noop, texImage2D: noop,
    generateMipmap: noop, getExtension: () => null, pixelStorei: noop,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    getError: () => 0, isContextLost: () => ctxLost,
    viewport: noop, clearColor: noop, clear: noop, disable: noop, enable: noop, cullFace: noop,
    useProgram: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    uniform1i: noop, uniform1f: noop, uniform2f: noop, uniform3f: noop, uniformMatrix4fv: noop,
    activeTexture: noop,
    drawArrays: () => { drawCalls++; },
    drawElements: () => { drawCalls++; },
  };
  const mockCanvas = {
    width: 600, height: 600,
    getContext: (t) => (t === 'webgl' ? mockGl : null),
    addEventListener: (ev, fn) => { glListeners[ev] = fn; },
  };
  const globe = GL.createGlobe(mockCanvas);
  assert.ok(globe, 'creates 3D globe with WebGL context');
  globe.setLayers({ naturalWidth: 64, naturalHeight: 32 }, new Uint8Array(2048 * 1024), 2048, 1024);
  globe.updateOverlay({});
  globe.flyTo(18.4, 77.5, 2.5);
  for (let i = 0; i < 60; i++) globe.stepPhysics();
  assert.ok(Math.abs(globe.state.rotLat - 18.4) < 0.5 && Math.abs(globe.state.rotLon - 77.5) < 0.5, 'flyTo settles on target coords');
  const [px, py, vis] = globe.project(18.4, 77.5, false);
  assert.ok(vis && Math.abs(px - 300) < 2 && Math.abs(py - 300) < 2, 'projected camera target lands at canvas center');
  const hit = globe.unproject(300, 300);
  assert.ok(hit && Math.abs(hit[2] - 18.4) < 1 && Math.abs(hit[3] - 77.5) < 1, 'unproject raycast recovers lat/lon at center');
  assert.strictEqual(globe.unproject(0, 0), null, 'off-limb raycast returns null');
  globe.render({ opacity: 0.5, showOverlay: true });
  assert.strictEqual(drawCalls, 2, 'render executes background starfield + planetary mesh draw calls');

  globe.state.onContextLost = () => { lostCount++; };
  globe.state.onContextRestored = () => { restoredCount++; };
  let prevented = false;
  ctxLost = true;
  glListeners.webglcontextlost({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented && globe.state.contextLost && lostCount === 1, 'handles webglcontextlost cleanly');
  ctxLost = false;
  glListeners.webglcontextrestored();
  assert.ok(!globe.state.contextLost && restoredCount === 1, 'restores WebGL resources cleanly on webglcontextrestored');

  console.log('All UI module / A* window / brief / habitability XSS / markers / WebGL 3D tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
