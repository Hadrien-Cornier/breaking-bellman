(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); require('../core/nn.js'); }

  // One value learner whose update rule is a sentence of words. Every combination runs.
  //
  //   Store estimates in      store:  'table' | 'net'
  //   Act                     eps (random with prob epsilon), ucb (bonus for few tries), optimistic (start at +5)
  //   Learn from              data:   'latest' | 'replay'  (memory: size of the replay memory)
  //   Step size (tables)      step:   'avg' (1/n) | 'const'
  //   Move toward             nstep:  1, 2, 4, 8 or 0 (= all: the full return, no guess)
  //                           then gamma^n x value of the [agg] next action,
  //                           agg:    'max' (best) | 'taken' (the one taken next) | 'mean' (policy average) | 'min' (worst)
  //                           picked by  picker: 'live' | 'frozen' | 'second'
  //                           scored by  scorer: 'live' | 'frozen' | 'second' | 'minpair' (smaller of live and second)
  //                           frozen copy refreshed every `sync` updates
  const DEFAULT_PARTS = {
    store: 'table', eps: true, ucb: false, optimistic: false, data: 'latest', memory: 10000, step: 'const',
    nstep: 1, agg: 'max', picker: 'live', scorer: 'live', sync: 250,
  };
  const DEFAULT_HYPER = {
    lrTable: 0.1, lrNet: 1e-3, hidden: [32, 32], act: 'relu', clipNorm: 10,
    epsStart: 1.0, epsEnd: 0.05, epsDecaySteps: 5000, optimisticInit: 5, ucbC: 2,
    batch: 32, learnStart: 500, trainEvery: 1,
  };

  function normalize(parts) {
    const P = Object.assign({}, DEFAULT_PARTS, parts || {});
    P.nstep = P.nstep === 'all' || P.nstep === Infinity ? 0 : +P.nstep;
    return P;
  }

  function make(parts, world, rng, hyperIn) {
    const P = normalize(parts);
    const H = Object.assign({}, DEFAULT_HYPER, hyperIn || {});
    const spec = world.spec;
    const A = spec.nActions, gamma = spec.gamma, D = spec.obsDim;
    const isNet = P.store === 'net';
    const mc = P.nstep === 0;
    const usesSecond = !mc && (P.picker === 'second' || P.scorer === 'second' || P.scorer === 'minpair');
    const usesFrozen = !mc && (P.picker === 'frozen' || P.scorer === 'frozen');
    const notes = [];
    if (P.store === 'table' && !spec.nStates) throw new Error('This world has no table index.');
    if (mc && (P.agg !== 'max' || P.picker !== 'live' || P.scorer !== 'live')) notes.push('With all real rewards there is no guess, so the next-action words do nothing.');
    if (!mc && P.agg === 'taken' && P.picker !== 'live') notes.push('"The action taken next" is not picked by any estimate, so the picker word does nothing.');
    const nValid = world.validActions ? (o) => world.validActions(o) : () => A;

    // ---- estimators: est[0] = live, est[1] = second (twin); frozen copies fro[0], fro[1]
    function newEst() {
      if (!isNet) {
        const t = new Float64Array(spec.nStates * A);
        if (P.optimistic) t.fill(H.optimisticInit);
        return { t, n: new Float64Array(spec.nStates * A) };
      }
      const net = RLA.nn.mlp({ sizes: [D].concat(H.hidden, [A]), act: H.act, rng, outScale: 1 });
      if (P.optimistic) net.params[net.params.length - 1].fill(H.optimisticInit);
      return { net, opt: RLA.nn.adam(net, { lr: H.lrNet, clipNorm: H.clipNorm }) };
    }
    function copyEst(e) { return isNet ? { net: e.net.clone() } : { t: Float64Array.from(e.t) }; }
    function syncEst(dst, src) { if (isNet) dst.net.copyFrom(src.net); else dst.t.set(src.t); }
    const est = [newEst()];
    if (usesSecond) est.push(newEst());
    const fro = usesFrozen ? est.map(copyEst) : null;

    const qBuf = new Float64Array(A);
    function qOf(e, obs, out) {
      out = out || new Float64Array(A);
      if (!isNet) { const s = world.stateIndex(obs) * A; for (let a = 0; a < A; a++) out[a] = e.t[s + a]; }
      else { const o = e.net.forward(obs); for (let a = 0; a < A; a++) out[a] = o[a]; }
      return out;
    }
    function qAct(obs) {
      // acting uses the average of the twins, if there are two
      qOf(est[0], obs, qBuf);
      if (est.length > 1) { const q2 = qOf(est[1], obs); for (let a = 0; a < A; a++) qBuf[a] = 0.5 * (qBuf[a] + q2[a]); }
      return qBuf;
    }
    function argmax(q, n) {
      let best = 0, bv = -Infinity, ties = 0;
      for (let a = 0; a < (n || A); a++) {
        if (q[a] > bv) { bv = q[a]; best = a; ties = 1; }
        else if (q[a] === bv) { ties++; if (rng.next() * ties < 1) best = a; }
      }
      return best;
    }
    function argmin(q, n) { let b = 0; for (let a = 1; a < n; a++) if (q[a] < q[b]) b = a; return b; }

    // ---- acting
    let steps = 0, updates = 0, lastLoss = 0, lastTd = 0, lastGrad = 0;
    const counts = new Float64Array((isNet ? 1 : spec.nStates) * A);
    function epsilon() {
      if (!P.eps) return 0;
      const f = Math.min(1, steps / H.epsDecaySteps);
      return H.epsStart + f * (H.epsEnd - H.epsStart);
    }
    function act(obs, explore) {
      const n = nValid(obs);
      const q = qAct(obs);
      if (explore === false) return argmax(q, n);
      if (P.eps && rng.next() < epsilon()) return rng.int(n);
      if (P.ucb) {
        const s = isNet ? 0 : world.stateIndex(obs) * A;
        let tot = 0;
        for (let a = 0; a < n; a++) tot += counts[s + a];
        const u = new Float64Array(A);
        for (let a = 0; a < n; a++) { const c = counts[s + a]; u[a] = c === 0 ? Infinity : q[a] + H.ucbC * Math.sqrt(Math.log(tot + 1) / c); }
        return argmax(u, n);
      }
      return argmax(q, n);
    }

    // ---- memory of finished rows: (s, a, R, sN, aN, gk, end)
    //   R = discounted sum of the real rewards used, gk = gamma^k for the guess at sN, end = no guess
    const cap = P.data === 'replay' ? Math.max(100, P.memory | 0) : Math.max(64, spec.maxSteps + 2);
    const bS = new Float32Array(cap * D), bSN = new Float32Array(cap * D);
    const bA = new Int32Array(cap), bAN = new Int32Array(cap), bR = new Float64Array(cap), bG = new Float64Array(cap), bEnd = new Uint8Array(cap);
    let bN = 0, bHead = 0, lastRow = -1, lastRewards = null, hold = false;
    let recent = [];       // rows pushed by the latest observe(): { i, rewards, end }
    function pushRow(row) {
      const i = bHead;
      bS.set(row.s, i * D); if (row.sN) bSN.set(row.sN, i * D);
      bA[i] = row.a; bAN[i] = row.aN; bR[i] = row.R; bG[i] = row.gk; bEnd[i] = row.end ? 1 : 0;
      bHead = (bHead + 1) % cap; bN = Math.min(bN + 1, cap);
      lastRow = i; lastRewards = row.rewards;
      recent.push({ i, rewards: row.rewards, end: !!row.end });
      return i;
    }

    // ---- the target of one row, for the estimator L that learns (twins swap roles)
    function roles(L) {
      const live = est[L], second = est.length > 1 ? est[1 - L] : est[L];
      const frozen = fro ? fro[L] : live;
      return { live, second, frozen };
    }
    function estFor(name, r) { return name === 'live' ? r.live : name === 'frozen' ? r.frozen : r.second; }
    // value of the guess at sN; fills `detail` for the one-update replay
    function guess(i, r, detail) {
      const sN = bSN.subarray(i * D, i * D + D), n = nValid(sN);
      let aStar, pickQ = null;
      if (P.agg === 'taken' && bAN[i] >= 0) aStar = bAN[i];
      else if (P.agg === 'mean') aStar = -1;
      else {
        pickQ = qOf(estFor(P.agg === 'taken' ? 'live' : P.picker, r), sN);
        aStar = P.agg === 'min' ? argmin(pickQ, n) : argmax(pickQ, n);
      }
      let scoreQ;
      if (P.scorer === 'minpair') {
        const q1 = qOf(r.live, sN), q2 = qOf(r.second, sN);
        scoreQ = new Float64Array(A); for (let a = 0; a < A; a++) scoreQ[a] = Math.min(q1[a], q2[a]);
      } else scoreQ = qOf(estFor(P.scorer, r), sN);
      let v;
      if (aStar === -1) {
        // average under the epsilon-greedy policy of the picker
        const pq = qOf(estFor(P.picker, r), sN), b = argmax(pq, n), e = epsilon();
        let m = 0; for (let a = 0; a < n; a++) m += scoreQ[a];
        v = (1 - e) * scoreQ[b] + e * m / n;
        if (detail) { detail.pickQ = Array.from(pq.slice(0, n)); detail.aStar = b; detail.eps = e; }
      } else v = scoreQ[aStar];
      if (detail) {
        if (pickQ) detail.pickQ = Array.from(pickQ.slice(0, n));
        if (aStar >= 0) detail.aStar = aStar;
        detail.scoreQ = Array.from(scoreQ.slice(0, n)); detail.v = v;
      }
      return v;
    }
    function target(i, r, detail) {
      if (bEnd[i]) { if (detail) detail.v = null; return bR[i]; }
      return bR[i] + bG[i] * guess(i, r, detail);
    }

    // ---- learning on a set of rows
    function stepSize(e, j) { return P.step === 'avg' ? 1 / Math.max(1, e.n[j]) : H.lrTable; }
    function updateRows(rows, n, forceL) {
      const L = forceL != null ? forceL : est.length > 1 ? (rng.next() < 0.5 ? 0 : 1) : 0;
      const r = roles(L), e = est[L];
      const y = new Float64Array(n);
      for (let k = 0; k < n; k++) y[k] = target(rows[k], r);
      let se = 0, sa = 0;
      if (!isNet) {
        for (let k = 0; k < n; k++) {
          const i = rows[k], j = world.stateIndex(bS.subarray(i * D, i * D + D)) * A + bA[i];
          e.n[j] += 1;
          const err = y[k] - e.t[j];
          e.t[j] += stepSize(e, j) * err;
          se += err * err; sa += Math.abs(err);
        }
      } else {
        const X = new Float32Array(n * D);
        for (let k = 0; k < n; k++) X.set(bS.subarray(rows[k] * D, rows[k] * D + D), k * D);
        const out = e.net.forwardBatch(X, n);
        const dOut = new Float32Array(n * A);
        for (let k = 0; k < n; k++) {
          const err = out[k * A + bA[rows[k]]] - y[k];
          dOut[k * A + bA[rows[k]]] = err / n;
          se += err * err; sa += Math.abs(err);
        }
        e.net.backwardBatch(dOut);
        lastGrad = e.net.gradNorm();
        e.opt.step();
      }
      lastLoss = se / n; lastTd = sa / n;
      updates++;
      if (fro && updates % Math.max(1, P.sync | 0) === 0) for (let k = 0; k < est.length; k++) syncEst(fro[k], est[k]);
    }
    const idxBuf = new Int32Array(H.batch);
    function sampleRows() { const n = Math.min(H.batch, bN); for (let k = 0; k < n; k++) idxBuf[k] = rng.int(bN); return n; }
    function learnFrom(newRows) {
      if (!newRows.length || hold) return;
      if (P.data === 'latest') {
        for (let k = 0; k < newRows.length; k += H.batch) {
          const n = Math.min(H.batch, newRows.length - k);
          updateRows(Int32Array.from(newRows.slice(k, k + n)), n);
        }
      } else if (bN >= Math.min(H.learnStart, cap)) {
        const nUp = Math.max(1, Math.round(newRows.length / H.trainEvery));
        for (let u = 0; u < nUp; u++) updateRows(idxBuf, sampleRows());
      }
    }

    // ---- turning the stream of steps into rows (n-step returns, the action taken next)
    const win = [];        // this episode: { s, a, r }
    let waiting = [];      // rows that wait for the action taken at sN (agg 'taken')
    let made = 0;          // rows already made from this episode
    function makeRow(j, k, sN, end) {
      let R = 0, g = 1; const rewards = [];
      for (let m = 0; m < k; m++) { R += g * win[j + m].r; g *= gamma; rewards.push(win[j + m].r); }
      return { s: win[j].s, a: win[j].a, R, sN, aN: -1, gk: g, end, rewards };
    }
    function observe(t) {
      // t = { obs, a, r, obs2, done, truncated }
      steps++; recent = [];
      counts[(isNet ? 0 : world.stateIndex(t.obs) * A) + t.a] += 1;
      const fresh = [];
      if (waiting.length) { for (const row of waiting) { row.aN = t.a; fresh.push(pushRow(row)); } waiting = []; }
      win.push({ s: Float32Array.from(t.obs), a: t.a, r: t.r });
      const over = t.done || t.truncated;
      const finish = (row) => { if (!row.end && P.agg === 'taken' && !over) waiting.push(row); else fresh.push(pushRow(row)); };
      if (!mc) {
        const n = P.nstep;
        while (win.length - made >= n) { finish(makeRow(made, n, Float32Array.from(t.obs2), !!t.done && made + n === win.length)); made++; }
        if (over) while (made < win.length) { finish(makeRow(made, win.length - made, Float32Array.from(t.obs2), !!t.done)); made++; }
      } else if (over) {
        // the full return: no guess, even when a time limit cut the episode
        for (let j = 0; j < win.length; j++) fresh.push(pushRow(makeRow(j, win.length - j, null, true)));
      }
      if (over) { win.length = 0; made = 0; }
      learnFrom(fresh);
    }

    // ---- one-update replay: the pieces of the target for the latest row, the update, and what it moved
    function snap(r, s, sN) {
      return {
        qS: Array.from(qOf(r.live, s)),
        qN: sN ? { live: Array.from(qOf(r.live, sN)), frozen: fro ? Array.from(qOf(r.frozen, sN)) : null, second: est.length > 1 ? Array.from(qOf(r.second, sN)) : null } : null,
      };
    }
    // k: which row of the latest observe() to replay (default: the last one)
    function probe(k) {
      if (lastRow < 0) return null;
      const pick = recent.length ? recent[k == null ? recent.length - 1 : Math.max(0, Math.min(recent.length - 1, k))] : null;
      const i = pick ? pick.i : lastRow, r = roles(0);
      const s = bS.slice(i * D, i * D + D), sN = bEnd[i] ? null : bSN.slice(i * D, i * D + D);
      const d = {}; const y = target(i, r, d);
      const before = snap(r, s, sN);
      updateRows(Int32Array.of(i), 1, 0);
      const d2 = {}; const y2 = target(i, roles(0), d2);
      return {
        s: Array.from(s), a: bA[i], rewards: (pick ? pick.rewards : lastRewards) || [bR[i]], R: bR[i], gk: bG[i], end: !!bEnd[i],
        sN: sN ? Array.from(sN) : null, aN: bAN[i], detail: d, y, before, after: snap(roles(0), s, sN), yAfter: y2, detailAfter: d2,
        store: P.store, gamma, nValidN: sN ? nValid(sN) : 0,
      };
    }

    return {
      parts: P, hyper: H, notes,
      act, observe, endEpisode() {}, probe,
      // hold(true): the next observe() stores its rows but does not learn, so probe() can show that update from the start
      hold: (v) => { hold = !!v; },
      fresh: () => recent.map((x) => ({ end: x.end, n: x.rewards.length })),
      flushHeld: () => { hold = false; learnFrom(recent.map((x) => x.i)); },
      q: (obs) => Array.from(qAct(obs)),
      table: () => (isNet ? null : est.length > 1 ? est[0].t.map((v, k) => 0.5 * (v + est[1].t[k])) : est[0].t),
      diagnostics: () => ({ steps, updates, loss: lastLoss, tdAbs: lastTd, gradNorm: lastGrad, eps: epsilon() }),
    };
  }

  RLA.value = { make, normalize, DEFAULT_PARTS, DEFAULT_HYPER };
  if (typeof module === 'object' && module.exports) module.exports = RLA.value;
})();
