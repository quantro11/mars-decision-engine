// Background Web Worker for Mars Base Decision Engine heavy compute:
// map suitability scoring, Top-5 block extraction, Monte Carlo sensitivity, and A* traverse.
(function (global) {
  'use strict';

  const IS_WORKER = typeof importScripts === 'function';
  if (IS_WORKER) {
    global.window = global;
    importScripts('layers/meta.js', 'scoring.js', 'astar.js');
  }

  /**
   * Create a worker compute state container.
   * @param {{ SCORING?: Object, ASTAR?: Object, META?: Object }} [deps]
   */
  function createWorkerState(deps = {}) {
    return {
      layers: null,
      SCORING: deps.SCORING || global.SCORING,
      ASTAR: deps.ASTAR || global.ASTAR,
      META: deps.META || global.LAYER_META,
    };
  }

  /**
   * Dispatch a single RPC request against worker state.
   * @param {Object} msg
   * @param {Object} st
   * @returns {Object} Response payload
   */
  function handleWorkerMessage(msg, st) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { id, cmd } = msg;
    const L = st.layers;
    const S = st.SCORING;
    const A = st.ASTAR;

    if (cmd === 'initLayers') {
      const meta = msg.meta || st.META;
      const W = msg.width, H = msg.height;
      st.META = meta;
      st.layers = {
        width: W,
        height: H,
        meta,
        elev: msg.elev,
        slope: msg.slope,
        rough: msg.rough,
        ice01: msg.ice01 || null,
        ice15: msg.ice15 || null,
        ice5: msg.ice5 || null,
        ti: msg.ti,
        dust: msg.dust,
        cave: msg.cave || null,
        latOfRow: (y) => 90 - (y + 0.5) * (180 / H),
        lonOfCol: (x) => -180 + (x + 0.5) * (360 / W),
      };
      return { id, ok: true, cmd };
    }

    if (cmd === 'setLayer') {
      if (L && msg.key && msg.data) L[msg.key] = msg.data;
      return { id, ok: true, cmd };
    }

    if (!L) return { id, ok: false, cmd, error: 'Worker layers not initialized' };

    if (cmd === 'score') {
      const { weights, hard, agg, iceBand, blockPx, sepPx } = msg;
      L.ice = L[iceBand];
      if (!L.ice) return { id, ok: false, cmd, error: 'Missing ice band ' + iceBand };
      const score = S.scoreMap(L, weights, hard, new Float32Array(L.width * L.height), agg);
      const candidates = S.topCandidates(score, L.width, L.height, 5, blockPx, sepPx)
        .map(c => ({ ...c, x: Math.round(c.x), y: Math.round(c.y), blockPx }));
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { id, ok: true, cmd, score, candidates, ms };
    }

    if (cmd === 'sensitivity') {
      const { weights, hard, candidates, spread, agg, iceBand, blockPx, sepPx, matchPx } = msg;
      L.ice = L[iceBand];
      if (!L.ice) return { id, ok: false, cmd, error: 'Missing ice band ' + iceBand };
      const robust = S.sensitivity(L, weights, hard, candidates, {
        mode: agg,
        runs: 30,
        spread,
        n: 5,
        blockPx,
        minSepPx: sepPx,
        matchPx,
      }, S.mulberry32(2026));
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { id, ok: true, cmd, robust, ms };
    }

    if (cmd === 'route') {
      const { sx, sy, gx, gy, k, maxSlope, viaSciencePoi } = msg;
      const safe = A.plan(L, sx, sy, gx, gy, { k, maxSlope, viaSciencePoi });
      const straight = A.straight(L, sx, sy, gx, gy);
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { id, ok: true, cmd, safe, straight, ms };
    }

    return { id, ok: false, cmd, error: 'Unknown worker command: ' + cmd };
  }

  if (IS_WORKER) {
    const state = createWorkerState();
    global.onmessage = (e) => {
      try {
        const res = handleWorkerMessage(e.data, state);
        if (res.score instanceof Float32Array) {
          global.postMessage(res, [res.score.buffer]);
        } else {
          global.postMessage(res);
        }
      } catch (err) {
        global.postMessage({ id: e.data && e.data.id, ok: false, error: err && err.message ? err.message : String(err) });
      }
    };
  }

  global.MDE_WORKER = { createWorkerState, handleWorkerMessage };
})(typeof self !== 'undefined' ? self : module.exports);
