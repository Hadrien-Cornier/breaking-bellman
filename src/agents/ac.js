(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); require('../core/nn.js'); }

  // Actor-critic learner for continuous actions in [-1, 1]^A. The update rule is a sentence of words:
  //   source   'own' (its own tries) | 'fixed' (a fixed dataset, no new tries) | 'both' (learn the dataset first, then try)
  //   demos    dataset quality: 'expert' | 'mixed' (half expert, half random) | 'noisy' (expert with large noise)
  //   base     'none' | 'classical' (the action is a classical controller's action plus a learned correction)
  //   head     'det' (one action, plus exploration noise) | 'gauss' (a squashed Gaussian) | 'flow' (noise turned into an action in 10 steps)
  //   aim      how the policy learns: 'q' (climb the critic) | 'qclose' (climb, but stay near the data) | 'copy' | 'copybest' (copy the best
  //            episodes) | 'weighted' (copy, weighted by exp(advantage)) | 'cond' (copy, told whether each action was better than usual) | 'none'
  //   critics  'none' | 'one' | 'two' (use the smaller of two estimates)
  //   target   'live' | 'slow' (a slowly following copy of the critic)
  //   next     the next action in the target: 'policy' | 'smooth' (policy plus clipped noise) | 'expectile' (no next action: an upper
  //            expectile of the data's own values)
  //   penalty  'none' | 'cql' (push down the values of actions the data never took)
  //   delay    critic updates per policy update (1, 2); entropy: 'none' | 'fixed' | 'auto'
  //   pick     how an action is chosen from the policy: 'one' | 'best' (best of N samples by the critic) | 'qavg' (Q-weighted average of
  //            N samples) | 'edit' (N samples and N edited samples, keep the best)
  //   chunk    actions per policy call (1, 3, 5, 10), played one after the other without looking (copy words only)
  //   wait     critic updates on its own tries before the policy may change (0, 3000): a "burn-in" (Silver et al. 2018)
  const DEFAULT_PARTS = { family: 'ac', source: 'own', demos: 'mixed', base: 'none', head: 'gauss', aim: 'q', critics: 'two', target: 'slow', next: 'policy', penalty: 'none', delay: 1, entropy: 'auto', pick: 'one', chunk: 1, wait: 0 };
  const DEFAULT_HYPER = {
    hidden: [32, 32], act: 'relu', lr: 1e-3, lrCritic: 1e-3, batch: 64, tau: 0.005, warmup: 1000, buffer: 50000,
    exploreStd: 0.1, smoothStd: 0.2, smoothClip: 0.5, alpha: 0.2, lrAlpha: 3e-3, bcAlpha: 2.5, expectile: 0.7,
    cqlWeight: 1, cqlN: 4, nSamples: 8, qavgTemp: 1, editScale: 0.3, flowSteps: 10, residualScale: 0.5,
    demoEpisodes: 100, pretrain: 2000, condTop: 0.3, condDrop: 0.3, maxWeight: 20, bestFrac: 0.25,
  };
  const clip1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);
  const LOG2PI_HALF = 0.9189385332;

  function normalize(parts) {
    const P = Object.assign({}, DEFAULT_PARTS, parts || {});
    P.delay = Math.max(1, P.delay | 0);
    P.wait = Math.max(0, P.wait | 0);
    return P;
  }

  function make(parts, world, rng, hyperIn) {
    const P = normalize(parts), H = Object.assign({}, DEFAULT_HYPER, hyperIn || {});
    const spec = world.spec, D = spec.obsDim, A = spec.actDim, gamma = H.gamma || spec.gamma;
    if (!spec.continuous) throw new Error('The actor-critic family needs a world with continuous actions');
    const notes = [];
    const nCrit = P.critics === 'two' ? 2 : P.critics === 'one' ? 1 : 0;
    const baseCtl = typeof world.base === 'function' ? world.base : null; // a classical controller of the world, if it has one
    const useBase = P.base === 'classical' && !!baseCtl && P.source !== 'fixed';
    if (P.base === 'classical' && !baseCtl) notes.push('This world has no classical controller to correct, so "plus a correction" does nothing here.');
    if (P.base === 'classical' && P.source === 'fixed') notes.push('A correction is learned from its own tries; with a fixed dataset the classical controller is not used.');
    let aim = P.aim;
    if ((aim === 'q' || aim === 'qclose') && !nCrit) { notes.push('The policy has no critic to climb: nothing tells it which way is better. Add a critic.'); aim = 'none'; }
    if ((aim === 'q' || aim === 'qclose') && P.head === 'flow') {
      notes.push('A flow policy makes its action in 10 small steps. The critic\'s slope would have to pass back through all 10; this lab does not do that, so the flow policy does not learn from the critic. Keep "copy" and let a picker use the critic.');
      aim = 'none';
    }
    if (useBase && aim !== 'q' && aim !== 'qclose' && aim !== 'none') { notes.push('A correction on top of a controller learns by climbing the critic; the copy words do nothing for it.'); aim = 'none'; }
    if (P.source === 'own' && aim === 'copy') notes.push('Copying its own tries: the policy can only become what it already does.');
    if ((aim === 'qclose' || aim === 'copy' || aim === 'copybest' || aim === 'weighted' || aim === 'cond') && P.source === 'own' && aim === 'qclose') notes.push('"Stay near the data" keeps the policy near its own old tries.');
    let pick = P.pick;
    if (pick !== 'one' && !nCrit) { notes.push('Choosing among samples needs a critic to score them. Add a critic.'); pick = 'one'; }
    if (P.next === 'expectile' && !nCrit) notes.push('The expectile target needs a critic.');
    if (P.penalty === 'cql' && !nCrit) notes.push('The penalty acts on a critic; there is none.');
    if (P.entropy !== 'none' && P.head !== 'gauss') notes.push('Only the Gaussian policy has an entropy bonus here; this word does nothing.');
    // action chunks: the policy outputs K actions at once and the robot plays them in order (copy words only)
    let K = Math.max(1, P.chunk | 0);
    if (K > 1 && (!['copy', 'copybest', 'weighted', 'cond', 'none'].includes(aim) || useBase || pick !== 'one')) {
      notes.push('This lab plays chunks of actions only for a policy that copies, acts alone and takes one sample; here each call gives 1 action.');
      K = 1;
    }
    const AK = A * K;
    const copyLike = !['q', 'qclose'].includes(aim); // a copying Gaussian is a bell curve around tanh(mu) in action units
    const useEntropy = P.entropy !== 'none' && P.head === 'gauss' && (aim === 'q' || aim === 'qclose');
    const needV = nCrit ? (P.next === 'expectile' || aim === 'weighted' || aim === 'cond') : (aim === 'weighted' || aim === 'cond');
    const offline = P.source === 'fixed';
    const withDemos = P.source !== 'own';

    // ---- networks
    const condIn = aim === 'cond' ? 2 : 0, baseIn = useBase ? A : 0;
    const PI = D + baseIn + condIn; // policy input: observation, the base action, the [told, better] flags
    const mk = (inN, outN, outScale) => RLA.nn.mlp({ sizes: [inN].concat(H.hidden, [outN]), act: H.act, rng, outScale });
    const actorOut = P.head === 'gauss' ? 2 * AK : AK;
    const actor = mk(PI + (P.head === 'flow' ? AK + 1 : 0), actorOut, useBase ? 0.01 : 0.1);
    if (P.head === 'gauss') { const b = actor.params[actor.params.length - 1]; for (let j = AK; j < 2 * AK; j++) b[j] = useBase ? -1.5 : 0; }
    const aopt = RLA.nn.adam(actor, { lr: H.lr });
    const actorT = P.head === 'det' && P.target === 'slow' ? actor.clone() : null;
    const crit = [], copt = [], critT = [];
    for (let i = 0; i < nCrit; i++) { const c = mk(D + A, 1, 1); crit.push(c); copt.push(RLA.nn.adam(c, { lr: H.lrCritic })); critT.push(P.target === 'slow' ? c.clone() : c); }
    const vnet = needV ? mk(D, 1, 1) : null, vopt = needV ? RLA.nn.adam(vnet, { lr: H.lrCritic }) : null;
    const editNet = pick === 'edit' ? mk(D + A, 2 * A, 0.01) : null, eopt = editNet ? RLA.nn.adam(editNet, { lr: H.lr }) : null;
    if (editNet) { const b = editNet.params[editNet.params.length - 1]; for (let j = A; j < 2 * A; j++) b[j] = -1; }
    let logAlpha = Math.log(H.alpha);
    const targetEnt = -A;

    // ---- memory: a fixed demo part [0, nDemo), then a ring for its own tries
    const cap = H.buffer;
    const mS = new Float32Array(cap * D), mA = new Float32Array(cap * A), mR = new Float32Array(cap), mS2 = new Float32Array(cap * D);
    const mD = new Uint8Array(cap), mG = new Float32Array(cap).fill(NaN), mEp = new Int32Array(cap);
    const mB = useBase ? new Float32Array(cap * A) : null, mB2 = useBase ? new Float32Array(cap * A) : null;
    const epRet = []; let nDemo = 0, ringPos = 0, ringN = 0, curStart = -1, curEp = -1;
    const size = () => nDemo + ringN;
    let bestCut = -Infinity;

    function put(s, a, r, s2, done, ep, bA, bA2) {
      let i;
      if (offline || (withDemos && nDemo < cap && !started)) i = nDemo++;
      else { i = nDemo + ringPos; ringPos = (ringPos + 1) % (cap - nDemo); ringN = Math.min(ringN + 1, cap - nDemo); }
      mS.set(s, i * D); mA.set(a, i * A); mR[i] = r; mS2.set(s2, i * D); mD[i] = done ? 1 : 0; mG[i] = NaN; mEp[i] = ep;
      if (mB) { mB.set(bA, i * A); mB2.set(bA2, i * A); }
      return i;
    }
    function closeEpisode(idx, ep) {
      // fill the discounted return-to-go backwards, and the episode's total
      let g = 0, tot = 0;
      for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; g = mR[i] + gamma * g * (mD[i] ? 0 : 1); mG[i] = g; tot += mR[i]; }
      epRet[ep] = tot;
    }
    function refreshBestCut() {
      const r = epRet.filter((x) => x !== undefined).slice().sort((a, b) => a - b);
      bestCut = r.length ? r[Math.floor((1 - H.bestFrac) * (r.length - 1))] : -Infinity;
    }

    // ---- datasets from the world's demonstrator
    let dataset = null;
    function makeDataset() {
      const n = H.demoEpisodes, rets = []; let succ = 0, steps = 0;
      for (let e = 0; e < n; e++) {
        const kind = P.demos === 'mixed' ? (e % 2 === 0 ? 'expert' : 'random') : P.demos;
        const noise = kind === 'expert' ? 0.1 : kind === 'noisy' ? 0.8 : 0;
        const ctx = world.expertStart(rng);
        let o = world.reset(), idx = [], ok = 0;
        const ep = epRet.length; epRet.push(undefined);
        for (;;) {
          let a;
          if (kind === 'random') { a = new Float32Array(A); for (let j = 0; j < A; j++) a[j] = rng.uniform(-1, 1); }
          else { a = Float32Array.from(world.expert(o, ctx, rng)); for (let j = 0; j < A; j++) a[j] = clip1(a[j] + noise * rng.normal()); }
          const r = world.step(a);
          idx.push(put(o, a, r.reward, r.obs, r.done, ep, null, null));
          if (r.info && r.info.success) ok = 1;
          o = r.obs; steps++;
          if (r.done || r.truncated) break;
        }
        closeEpisode(idx, ep); rets.push(epRet[ep]); succ += ok;
      }
      refreshBestCut();
      dataset = { episodes: n, steps, meanReturn: rets.reduce((s, x) => s + x, 0) / n, successRate: succ / n, quality: P.demos };
    }

    // ---- policy pieces
    function policyInput(s, bA, cond) {
      const x = new Float32Array(PI); x.set(s, 0);
      if (bA) x.set(bA, D);
      if (condIn) { x[D + baseIn] = cond ? 1 : 0; x[D + baseIn + 1] = cond ? 1 : 0; }
      return x;
    }
    function flowSample(xin, noise) {
      const a = new Float32Array(AK), x = new Float32Array(PI + AK + 1); x.set(xin, 0);
      for (let j = 0; j < AK; j++) a[j] = noise ? rng.normal() : 0;
      const NS = H.flowSteps;
      for (let k = 0; k < NS; k++) {
        x.set(a, PI); x[PI + AK] = k / NS;
        const v = actor.forward(x);
        for (let j = 0; j < AK; j++) a[j] += v[j] / NS;
      }
      for (let j = 0; j < AK; j++) a[j] = clip1(a[j]);
      return a;
    }
    // one action from the policy, in policy units ([-1, 1]^A; a correction if there is a base)
    function sampleOne(xin, explore, net) {
      if (P.head === 'flow') return flowSample(xin, true);
      const z = (net || actor).forward(xin), a = new Float32Array(AK);
      if (P.head === 'det') {
        for (let j = 0; j < AK; j++) a[j] = clip1(Math.tanh(z[j]) + (explore ? H.exploreStd * rng.normal() : 0));
      } else {
        for (let j = 0; j < AK; j++) {
          const ls = Math.max(-5, Math.min(2, z[AK + j]));
          if (copyLike) a[j] = clip1(Math.tanh(z[j]) + (explore ? Math.exp(ls) * rng.normal() : 0));
          else a[j] = Math.tanh(explore ? z[j] + Math.exp(ls) * rng.normal() : z[j]);
        }
      }
      return a;
    }
    const full = (a, bA) => { if (!bA) return a; const f = new Float32Array(A); for (let j = 0; j < A; j++) f[j] = clip1(bA[j] + H.residualScale * a[j]); return f; };
    function qMin(s, a, nets) {
      nets = nets || crit; let m = Infinity;
      const x = new Float32Array(D + A); x.set(s, 0); x.set(a, D);
      for (const c of nets) m = Math.min(m, c.forward(x)[0]);
      return m;
    }
    function editOf(s, a, explore) {
      const x = new Float32Array(D + A); x.set(s, 0); x.set(a, D);
      const z = editNet.forward(x), e = new Float32Array(A);
      for (let j = 0; j < A; j++) { const ls = Math.max(-5, Math.min(2, z[A + j])); e[j] = clip1(a[j] + H.editScale * Math.tanh(explore ? z[j] + Math.exp(ls) * rng.normal() : z[j])); }
      return e;
    }
    // choose a full action at state s with the pick word (the critic nets score candidates)
    function choose(s, bA, explore, nets, net) {
      const xin = policyInput(s, bA, true);
      if (pick === 'one') return full(sampleOne(xin, explore, net), bA);
      const cands = [];
      for (let n = 0; n < H.nSamples; n++) {
        const a = full(sampleOne(xin, P.head === 'flow' || P.head === 'gauss' || explore, net), bA);
        cands.push(a);
        if (pick === 'edit') cands.push(editOf(s, a, explore));
      }
      const qs = cands.map((a) => qMin(s, a, nets));
      if (pick === 'qavg') {
        const m = Math.max.apply(null, qs), w = qs.map((q) => Math.exp((q - m) / H.qavgTemp)), sw = w.reduce((x, y) => x + y, 0);
        const out = new Float32Array(A);
        cands.forEach((a, n) => { for (let j = 0; j < A; j++) out[j] += (w[n] / sw) * a[j]; });
        return out;
      }
      let b = 0; for (let n = 1; n < qs.length; n++) if (qs[n] > qs[b]) b = n;
      return cands[b];
    }

    let envSteps = 0, updates = 0, started = false;
    let last = { loss: 0, qData: 0, qPolicy: 0, entropy: 0, alpha: Math.exp(logAlpha), std: 0, tdAbs: 0, vloss: 0 };
    let lastProbe = null;
    const curIdx = [];

    let queue = [];
    function act(obs, explore) {
      const bA = useBase ? Float32Array.from(baseCtl(obs)) : null;
      if (explore !== false && P.source === 'own' && !useBase && envSteps < H.warmup) {
        const a = new Float32Array(A); for (let j = 0; j < A; j++) a[j] = rng.uniform(-1, 1);
        return a;
      }
      if (K === 1 && (pick !== 'one' || P.head === 'flow')) return chooseBatch(Float32Array.from(obs), bA, 1, explore !== false);
      if (K === 1) return choose(obs, bA, explore !== false);
      if (!queue.length) { const c = choose(obs, bA, explore !== false); for (let k = 0; k < K; k++) queue.push(c.slice(k * A, k * A + A)); }
      return queue.shift();
    }

    function observe(t) {
      if (offline) return;
      started = true; envSteps++;
      if (curEp < 0) { curEp = epRet.length; epRet.push(undefined); }
      const bA = useBase ? Float32Array.from(baseCtl(t.obs)) : null, bA2 = useBase ? Float32Array.from(baseCtl(t.obs2)) : null;
      curIdx.push(put(t.obs, Float32Array.from(t.a), t.r, t.obs2, t.done, curEp, bA, bA2));
      if (t.done || t.truncated) { closeEpisode(curIdx, curEp); curIdx.length = 0; curEp = -1; if (epRet.length % 5 === 0) refreshBestCut(); }
      if (size() >= H.batch) update();
    }

    // ---- one update
    function sampleIdx(B) {
      const idx = new Int32Array(B);
      for (let b = 0; b < B; b++) {
        if (P.source === 'both' && ringN > 0 && nDemo > 0) idx[b] = b % 2 === 0 ? rng.int(nDemo) : nDemo + rng.int(ringN);
        else idx[b] = rng.int(size());
      }
      return idx;
    }
    function gather(idx) {
      const B = idx.length, S = new Float32Array(B * D), Aa = new Float32Array(B * A), S2 = new Float32Array(B * D), R = new Float32Array(B), Dn = new Uint8Array(B), G = new Float32Array(B), E = new Int32Array(B);
      const Bs = mB ? new Float32Array(B * A) : null, Bs2 = mB ? new Float32Array(B * A) : null;
      for (let b = 0; b < B; b++) {
        const i = idx[b];
        S.set(mS.subarray(i * D, i * D + D), b * D); S2.set(mS2.subarray(i * D, i * D + D), b * D); Aa.set(mA.subarray(i * A, i * A + A), b * A);
        R[b] = mR[i]; Dn[b] = mD[i]; G[b] = mG[i]; E[b] = mEp[i];
        if (Bs) { Bs.set(mB.subarray(i * A, i * A + A), b * A); Bs2.set(mB2.subarray(i * A, i * A + A), b * A); }
      }
      let Ach = Aa;
      if (K > 1) {
        // the next K actions of the same episode (the last one repeats after the episode ends)
        Ach = new Float32Array(B * AK);
        for (let b = 0; b < B; b++) {
          let j = idx[b];
          for (let k = 0; k < K; k++) {
            if (k > 0 && j + 1 < size() && mEp[j + 1] === mEp[idx[b]] && !(k > 0 && mD[j])) j++;
            Ach.set(mA.subarray(j * A, j * A + A), b * AK + k * A);
          }
        }
      }
      // the action really taken next in memory (same episode), for the "next action in memory" target
      let A2 = null, has2 = null;
      if (P.next === 'data') {
        A2 = new Float32Array(B * A); has2 = new Uint8Array(B);
        for (let b = 0; b < B; b++) {
          const i = idx[b], j = i + 1;
          if (!mD[i] && j < size() && mEp[j] === mEp[i] && !Number.isNaN(mG[i]) && j !== nDemo + ringPos) { A2.set(mA.subarray(j * A, j * A + A), b * A); has2[b] = 1; }
        }
      }
      return { B, S, Aa, S2, R, Dn, G, E, Bs, Bs2, Ach, A2, has2 };
    }
    function qBatch(net, S, Aa, B) {
      const X = new Float32Array(B * (D + A));
      for (let b = 0; b < B; b++) { X.set(S.subarray(b * D, b * D + D), b * (D + A)); X.set(Aa.subarray(b * A, b * A + A), b * (D + A) + D); }
      return Array.from(net.forwardBatch(X, B));
    }
    // dQ/da for a batch through one critic (the critic's own grads are cleared afterwards)
    function dQda(net, S, Aa, B) {
      const q = qBatch(net, S, Aa, B);
      const dX = net.backwardBatch(new Float32Array(B).fill(1), true);
      net.zeroGrad();
      const g = new Float32Array(B * A);
      for (let b = 0; b < B; b++) for (let j = 0; j < A; j++) g[b * A + j] = dX[b * (D + A) + D + j];
      return { q, g };
    }
    function policyBatchInput(bt, condFlags) {
      const X = new Float32Array(bt.B * PI);
      for (let b = 0; b < bt.B; b++) {
        X.set(bt.S.subarray(b * D, b * D + D), b * PI);
        if (bt.Bs) X.set(bt.Bs.subarray(b * A, b * A + A), b * PI + D);
        if (condIn && condFlags) { X[b * PI + D + baseIn] = condFlags[b] === 0 ? 0 : 1; X[b * PI + D + baseIn + 1] = condFlags[b] === 1 ? 1 : 0; }
      }
      return X;
    }
    // ---- batched versions (one network call per layer for many states): used inside updates
    // Xp: n policy inputs -> n actions in policy units (n x AK)
    function sampleBatch(Xp, n, explore, net) {
      const out = new Float32Array(n * AK);
      if (P.head === 'flow') {
        const NS = H.flowSteps, w = PI + AK + 1, X = new Float32Array(n * w), a = new Float32Array(n * AK);
        for (let i = 0; i < n * AK; i++) a[i] = rng.normal();
        for (let b = 0; b < n; b++) X.set(Xp.subarray(b * PI, b * PI + PI), b * w);
        for (let k = 0; k < NS; k++) {
          for (let b = 0; b < n; b++) { X.set(a.subarray(b * AK, b * AK + AK), b * w + PI); X[b * w + PI + AK] = k / NS; }
          const v = actor.forwardBatch(X, n);
          for (let i = 0; i < n * AK; i++) a[i] += v[i] / NS;
        }
        for (let i = 0; i < n * AK; i++) out[i] = clip1(a[i]);
        return out;
      }
      const z = (net || actor).forwardBatch(Xp, n);
      for (let b = 0; b < n; b++) for (let j = 0; j < AK; j++) {
        if (P.head === 'det') out[b * AK + j] = clip1(Math.tanh(z[b * AK + j]) + (explore ? H.exploreStd * rng.normal() : 0));
        else {
          const m = z[b * 2 * AK + j], ls = Math.max(-5, Math.min(2, z[b * 2 * AK + AK + j]));
          out[b * AK + j] = copyLike ? clip1(Math.tanh(m) + (explore ? Math.exp(ls) * rng.normal() : 0)) : Math.tanh(explore ? m + Math.exp(ls) * rng.normal() : m);
        }
      }
      return out;
    }
    function inputsOf(S, Bs, n, rep) {
      const Xp = new Float32Array(n * rep * PI);
      for (let b = 0; b < n; b++) for (let r = 0; r < rep; r++) {
        const o = (b * rep + r) * PI; Xp.set(S.subarray(b * D, b * D + D), o);
        if (Bs) Xp.set(Bs.subarray(b * A, b * A + A), o + D);
        if (condIn) { Xp[o + D + baseIn] = 1; Xp[o + D + baseIn + 1] = 1; }
      }
      return Xp;
    }
    function fullBatch(a, Bs, n, rep) {
      if (!Bs) return a;
      const f = new Float32Array(n * rep * A);
      for (let b = 0; b < n; b++) for (let r = 0; r < rep; r++) for (let j = 0; j < A; j++) f[(b * rep + r) * A + j] = clip1(Bs[b * A + j] + H.residualScale * a[(b * rep + r) * A + j]);
      return f;
    }
    // full actions chosen with the pick word for n states (first action of a chunk only)
    function chooseBatch(S, Bs, n, explore, nets, net) {
      if (pick === 'one') {
        const a = sampleBatch(inputsOf(S, Bs, n, 1), n, explore, net);
        const first = new Float32Array(n * A); for (let b = 0; b < n; b++) first.set(a.subarray(b * AK, b * AK + A), b * A);
        return fullBatch(first, Bs, n, 1);
      }
      const N = H.nSamples, sampled = fullBatch(sampleBatch(inputsOf(S, Bs, n, N), n * N, P.head !== 'det' || explore, net), Bs, n, N);
      let M = N, cand = sampled;
      if (pick === 'edit') {
        M = 2 * N; cand = new Float32Array(n * M * A);
        const X = new Float32Array(n * N * (D + A));
        for (let b = 0; b < n; b++) for (let r = 0; r < N; r++) { const i = b * N + r; X.set(S.subarray(b * D, b * D + D), i * (D + A)); X.set(sampled.subarray(i * A, i * A + A), i * (D + A) + D); }
        const z = editNet.forwardBatch(X, n * N);
        for (let b = 0; b < n; b++) for (let r = 0; r < N; r++) {
          const i = b * N + r;
          for (let j = 0; j < A; j++) {
            const ls = Math.max(-5, Math.min(2, z[i * 2 * A + A + j])), u = z[i * 2 * A + j] + (explore ? Math.exp(ls) * rng.normal() : 0);
            cand[(b * M + r) * A + j] = sampled[i * A + j];
            cand[(b * M + N + r) * A + j] = clip1(sampled[i * A + j] + H.editScale * Math.tanh(u));
          }
        }
      }
      const Srep = new Float32Array(n * M * D);
      for (let b = 0; b < n; b++) for (let r = 0; r < M; r++) Srep.set(S.subarray(b * D, b * D + D), (b * M + r) * D);
      const qs = (nets || crit).map((c) => qBatch(c, Srep, cand, n * M));
      const out = new Float32Array(n * A);
      for (let b = 0; b < n; b++) {
        const q = []; for (let r = 0; r < M; r++) { let m = Infinity; for (const qq of qs) m = Math.min(m, qq[b * M + r]); q.push(m); }
        if (pick === 'qavg') {
          const mx = Math.max.apply(null, q), w = q.map((x) => Math.exp((x - mx) / H.qavgTemp)), sw = w.reduce((x, y) => x + y, 0);
          for (let r = 0; r < M; r++) for (let j = 0; j < A; j++) out[b * A + j] += (w[r] / sw) * cand[(b * M + r) * A + j];
        } else {
          let best = 0; for (let r = 1; r < M; r++) if (q[r] > q[best]) best = r;
          out.set(cand.subarray((b * M + best) * A, (b * M + best) * A + A), b * A);
        }
      }
      return out;
    }

    // next actions for the target, one per row of S2 (full actions)
    function nextActions(bt) {
      const B = bt.B, logp = new Float32Array(B);
      if (pick !== 'one' || P.head !== 'gauss') {
        const out = chooseBatch(bt.S2, bt.Bs2, B, false, critT, actorT || actor);
        if (P.next === 'smooth') for (let i = 0; i < B * A; i++) out[i] = clip1(out[i] + Math.max(-H.smoothClip, Math.min(H.smoothClip, H.smoothStd * rng.normal())));
        return { a2: out, logp };
      }
      const out = new Float32Array(B * A);
      for (let b = 0; b < B; b++) {
        const s2 = bt.S2.subarray(b * D, b * D + D), bA2 = bt.Bs2 ? bt.Bs2.subarray(b * A, b * A + A) : null;
        let a;
        if (P.head === 'gauss') {
          const z = actor.forward(policyInput(s2, bA2, true)); a = new Float32Array(A); let lp = 0;
          for (let j = 0; j < A; j++) {
            const ls = Math.max(-5, Math.min(2, z[A + j])), sd = Math.exp(ls), e = rng.normal(), u = z[j] + sd * e, th = Math.tanh(u);
            a[j] = th; lp += -0.5 * e * e - ls - LOG2PI_HALF - Math.log(1 - th * th + 1e-6);
          }
          logp[b] = lp; a = full(a, bA2);
        } else {
          const r = sampleOne(policyInput(s2, bA2, true), false, actorT || actor);
          if (P.next === 'smooth') for (let j = 0; j < A; j++) r[j] = clip1(r[j] + Math.max(-H.smoothClip, Math.min(H.smoothClip, H.smoothStd * rng.normal())));
          a = full(r, bA2);
        }
        out.set(a, b * A);
      }
      return { a2: out, logp };
    }

    function update() {
      const B = H.batch, bt = gather(sampleIdx(B));
      const alpha = useEntropy ? (P.entropy === 'auto' ? Math.exp(logAlpha) : H.alpha) : 0;
      const probe = { s: Array.from(bt.S.subarray(0, D)), a: Array.from(bt.Aa.subarray(0, A)), r: bt.R[0], s2: Array.from(bt.S2.subarray(0, D)), done: bt.Dn[0] };

      // 1. critic targets
      let y = null;
      if (nCrit) {
        y = new Float32Array(B);
        if (P.next === 'expectile') {
          const v2 = Array.from(vnet.forwardBatch(bt.S2, B));
          for (let b = 0; b < B; b++) y[b] = bt.R[b] + gamma * (bt.Dn[b] ? 0 : 1) * v2[b];
          probe.vNext = v2[0];
        } else if (P.next === 'data') {
          // the next action really taken in memory (the value of the policy that made the data); no next action: no guess
          const qn = critT.map((c) => qBatch(c, bt.S2, bt.A2, B));
          for (let b = 0; b < B; b++) {
            let m = Infinity; for (const q of qn) m = Math.min(m, q[b]);
            y[b] = bt.R[b] + (bt.has2[b] ? gamma * m : 0);
          }
          probe.a2 = Array.from(bt.A2.subarray(0, A)); probe.qNext = qn.map((q) => q[0]); probe.logpNext = null; probe.noNext = !bt.has2[0];
        } else {
          const { a2, logp } = nextActions(bt);
          const qn = critT.map((c) => qBatch(c, bt.S2, a2, B));
          for (let b = 0; b < B; b++) {
            let m = Infinity; for (const q of qn) m = Math.min(m, q[b]);
            y[b] = bt.R[b] + gamma * (bt.Dn[b] ? 0 : 1) * (m - (pick === 'one' && P.head === 'gauss' ? alpha * logp[b] : 0));
          }
          probe.a2 = Array.from(a2.subarray(0, A)); probe.qNext = qn.map((q) => q[0]); probe.logpNext = pick === 'one' && P.head === 'gauss' ? logp[0] : null;
        }
        probe.y = y[0]; probe.alpha = alpha;
        // 2. critic regression (+ conservative penalty)
        let loss = 0, td = 0, qd = 0;
        const M = P.penalty === 'cql' ? H.cqlN : 0;
        let cqlActs = null;
        if (M) {
          cqlActs = new Float32Array(B * 2 * M * A);
          const pa = sampleBatch(inputsOf(bt.S, bt.Bs, B, M), B * M, true), first = new Float32Array(B * M * A);
          for (let i = 0; i < B * M; i++) first.set(pa.subarray(i * AK, i * AK + A), i * A);
          const pol = fullBatch(first, bt.Bs, B, M);
          for (let b = 0; b < B; b++) for (let m = 0; m < M; m++) {
            for (let j = 0; j < A; j++) cqlActs[((b * 2 * M) + m) * A + j] = rng.uniform(-1, 1);
            cqlActs.set(pol.subarray((b * M + m) * A, (b * M + m + 1) * A), ((b * 2 * M) + M + m) * A);
          }
        }
        probe.qBefore = [];
        for (let i = 0; i < nCrit; i++) {
          const n = B * (1 + 2 * M), X = new Float32Array(n * (D + A));
          for (let b = 0; b < B; b++) { X.set(bt.S.subarray(b * D, b * D + D), b * (D + A)); X.set(bt.Aa.subarray(b * A, b * A + A), b * (D + A) + D); }
          for (let b = 0; b < B; b++) for (let m = 0; m < 2 * M; m++) {
            const row = B + b * 2 * M + m;
            X.set(bt.S.subarray(b * D, b * D + D), row * (D + A)); X.set(cqlActs.subarray((b * 2 * M + m) * A, (b * 2 * M + m + 1) * A), row * (D + A) + D);
          }
          const q = crit[i].forwardBatch(X, n), dq = new Float32Array(n);
          probe.qBefore.push(q[0]);
          for (let b = 0; b < B; b++) { const e = q[b] - y[b]; dq[b] = e / B; loss += e * e / B / nCrit; td += Math.abs(e) / B / nCrit; qd += q[b] / B / nCrit; }
          if (M) {
            for (let b = 0; b < B; b++) {
              let mx = -Infinity; for (let m = 0; m < 2 * M; m++) mx = Math.max(mx, q[B + b * 2 * M + m]);
              let se = 0; for (let m = 0; m < 2 * M; m++) se += Math.exp(q[B + b * 2 * M + m] - mx);
              for (let m = 0; m < 2 * M; m++) dq[B + b * 2 * M + m] = H.cqlWeight * Math.exp(q[B + b * 2 * M + m] - mx) / se / B;
              dq[b] -= H.cqlWeight / B;
            }
          }
          crit[i].backwardBatch(dq); copt[i].step();
        }
        probe.qAfter = crit.map((c) => qMin(probe.s, probe.a, [c]));
        last.loss = loss; last.tdAbs = td; last.qData = qd;
      }

      // 3. value of a state, V(s): an expectile of the critic's values for the data's actions, or the mean return that followed
      let V = null, Adv = null;
      if (vnet) {
        let tgt;
        if (nCrit) {
          const qs = critT.map((c) => qBatch(c, bt.S, bt.Aa, B)); tgt = new Float32Array(B);
          for (let b = 0; b < B; b++) { let m = Infinity; for (const q of qs) m = Math.min(m, q[b]); tgt[b] = m; }
        } else tgt = bt.G;
        const tau = P.next === 'expectile' ? H.expectile : 0.5;
        const v = vnet.forwardBatch(bt.S, B), dv = new Float32Array(B); let n = 0, vl = 0;
        V = Array.from(v);
        for (let b = 0; b < B; b++) {
          if (Number.isNaN(tgt[b])) continue;
          const u = tgt[b] - v[b], w = u < 0 ? 1 - tau : tau;
          dv[b] = -2 * w * u; vl += w * u * u; n++;
        }
        if (n) { for (let b = 0; b < B; b++) dv[b] /= n; vnet.backwardBatch(dv); vopt.step(); last.vloss = vl / n; }
        Adv = new Float32Array(B);
        for (let b = 0; b < B; b++) Adv[b] = Number.isNaN(tgt[b]) ? NaN : tgt[b] - V[b];
        probe.v = V[0]; probe.adv = Adv[0];
      }

      updates++;
      const waiting = !offline && updates <= P.wait;
      if (updates % P.delay === 0 && aim !== 'none' && !waiting) policyUpdate(bt, alpha, Adv, probe);
      if (updates % P.delay === 0 && editNet && !waiting) editUpdate(bt, alpha);
      if (updates % P.delay === 0 && P.target === 'slow') {
        for (let i = 0; i < nCrit; i++) critT[i].softUpdate(crit[i], H.tau);
        if (actorT) actorT.softUpdate(actor, H.tau);
      }
      // how good does the critic think the policy's own actions are? (compare with qData: the data's actions)
      if (nCrit && updates % 10 === 0) {
        const n = Math.min(B, 16), S16 = bt.S.subarray(0, n * D), B16 = bt.Bs ? bt.Bs.subarray(0, n * A) : null;
        const a16 = chooseBatch(S16, B16, n, false), qs = crit.map((c) => qBatch(c, S16, a16, n));
        let s = 0; for (let b = 0; b < n; b++) { let m = Infinity; for (const q of qs) m = Math.min(m, q[b]); s += m; }
        last.qPolicy = s / n;
      }
      lastProbe = probe;
    }

    function policyUpdate(bt, alpha, Adv, probe) {
      const B = bt.B;
      // weights and flags for the copy words
      let W = null, cond = null;
      if (aim === 'copy' || aim === 'copybest' || aim === 'weighted' || aim === 'cond' || aim === 'qclose') W = new Float32Array(B).fill(1);
      if (aim === 'copybest') for (let b = 0; b < B; b++) W[b] = epRet[bt.E[b]] !== undefined && epRet[bt.E[b]] >= bestCut ? 1 : 0;
      if (aim === 'weighted' && Adv) {
        const ok = Array.from(Adv).filter((x) => !Number.isNaN(x)), m = ok.reduce((s, x) => s + x, 0) / Math.max(1, ok.length);
        const sd = Math.sqrt(ok.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, ok.length)) + 1e-6;
        for (let b = 0; b < B; b++) W[b] = Number.isNaN(Adv[b]) ? 0 : Math.min(H.maxWeight, Math.exp(Adv[b] / sd));
      }
      if (aim === 'cond' && Adv) {
        // the top condTop share of the batch by advantage is "better than usual"; some rows are left untold
        const ok = Array.from(Adv).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
        const cut = ok.length ? ok[Math.floor((1 - H.condTop) * (ok.length - 1))] : 0;
        cond = new Int8Array(B);
        for (let b = 0; b < B; b++) cond[b] = Number.isNaN(Adv[b]) || rng.next() < H.condDrop ? 0 : Adv[b] > cut ? 1 : -1;
      }
      if (W) { probe.w = W[0]; }
      if (cond) probe.told = cond[0];
      const sw = W ? Math.max(1e-6, W.reduce((s, x) => s + x, 0)) : B;
      const before = Array.from(sampleOne(policyInput(probe.s, bt.Bs ? bt.Bs.subarray(0, A) : null, true), false));

      if (P.head === 'flow') {
        // flow matching: from a noise point a0 toward the data action a1, the velocity is a1 - a0; learn it at a random time tau
        const X = new Float32Array(B * (PI + AK + 1)), Ut = new Float32Array(B * AK), Xp = policyBatchInput(bt, cond), TA = bt.Ach;
        for (let b = 0; b < B; b++) {
          const tau = rng.next(); X.set(Xp.subarray(b * PI, b * PI + PI), b * (PI + AK + 1));
          for (let j = 0; j < AK; j++) {
            const a1 = TA[b * AK + j], a0 = rng.normal();
            X[b * (PI + AK + 1) + PI + j] = (1 - tau) * a0 + tau * a1; Ut[b * AK + j] = a1 - a0;
          }
          X[b * (PI + AK + 1) + PI + AK] = tau;
        }
        const v = actor.forwardBatch(X, B), dv = new Float32Array(B * AK);
        for (let b = 0; b < B; b++) for (let j = 0; j < AK; j++) dv[b * AK + j] = 2 * W[b] * (v[b * AK + j] - Ut[b * AK + j]) / sw;
        actor.backwardBatch(dv); aopt.step();
      } else {
        const X = policyBatchInput(bt, cond);
        let qGrad = null, qMinArr = null, aPol = null, eps = null, uArr = null, ls = null;
        const z = Float32Array.from(actor.forwardBatch(X, B));
        if (aim === 'q' || aim === 'qclose') {
          // the policy's own (reparameterized) actions, then the critic's slope at them
          aPol = new Float32Array(B * A); eps = new Float32Array(B * A); uArr = new Float32Array(B * A); ls = new Float32Array(B * A);
          for (let b = 0; b < B; b++) for (let j = 0; j < A; j++) {
            const k = b * A + j;
            if (P.head === 'det') { aPol[k] = Math.tanh(z[k]); }
            else { ls[k] = Math.max(-5, Math.min(2, z[b * 2 * A + A + j])); eps[k] = rng.normal(); uArr[k] = z[b * 2 * A + j] + Math.exp(ls[k]) * eps[k]; aPol[k] = Math.tanh(uArr[k]); }
          }
          const fullA = new Float32Array(B * A);
          for (let b = 0; b < B; b++) for (let j = 0; j < A; j++) fullA[b * A + j] = bt.Bs ? clip1(bt.Bs[b * A + j] + H.residualScale * aPol[b * A + j]) : aPol[b * A + j];
          const nets = P.head === 'det' ? [crit[0]] : crit;
          const gs = nets.map((c) => dQda(c, bt.S, fullA, B));
          qGrad = new Float32Array(B * A); qMinArr = new Float32Array(B);
          for (let b = 0; b < B; b++) {
            let k = 0; for (let i = 1; i < gs.length; i++) if (gs[i].q[b] < gs[k].q[b]) k = i;
            qMinArr[b] = gs[k].q[b];
            for (let j = 0; j < A; j++) qGrad[b * A + j] = gs[k].g[b * A + j] * (bt.Bs ? H.residualScale : 1);
          }
          probe.dQda = Array.from(qGrad.subarray(0, A));
        }
        let lam = 1;
        if (aim === 'qclose') { let s = 0; for (let b = 0; b < B; b++) s += Math.abs(qMinArr[b]); lam = H.bcAlpha / Math.max(1e-6, s / B); }
        const dz = new Float32Array(B * actorOut);
        let lpSum = 0, sdSum = 0;
        actor.forwardBatch(X, B); // restore the actor's cache for its backward pass
        const AD = AK, TA = bt.Ach; // with chunks (copy words only) each row has K actions; otherwise AD = A
        for (let b = 0; b < B; b++) {
          for (let j = 0; j < AD; j++) {
            const k = b * AD + j;
            if (P.head === 'det') {
              const a = Math.tanh(z[k]); let g = 0;
              if (aim === 'q' || aim === 'qclose') g += -lam * qGrad[k] / B;
              if (W) g += 2 * W[b] * (a - TA[k]) / sw;
              dz[k] = g * (1 - a * a);
            } else {
              const mu = z[b * 2 * AD + j], lsj = Math.max(-5, Math.min(2, z[b * 2 * AD + AD + j])), sd = Math.exp(lsj);
              let gm = 0, gs = 0;
              if (aim === 'q' || aim === 'qclose') {
                const th = aPol[k], e = eps[k], d1 = 1 - th * th;
                gm += lam * (alpha * 2 * th - qGrad[k] * d1) / B;
                gs += lam * (alpha * (-1 + 2 * th * sd * e) - qGrad[k] * d1 * sd * e) / B;
                lpSum += -0.5 * e * e - lsj - LOG2PI_HALF - Math.log(d1 + 1e-6);
              }
              if (W && aim === 'qclose') { const t = Math.tanh(mu); gm += 2 * W[b] * (t - TA[k]) * (1 - t * t) / sw; }
              else if (W) {
                // copying: a bell curve in action units around tanh(mu), so saturated actions (exactly -1 or 1) stay finite targets
                const t = Math.tanh(mu), d = (TA[k] - t) / sd;
                gm += -W[b] * d / sd * (1 - t * t) / sw; gs += W[b] * (1 - d * d) / sw;
              }
              const raw = z[b * 2 * AD + AD + j];
              dz[b * 2 * AD + j] = gm; dz[b * 2 * AD + AD + j] = raw > -5 && raw < 2 ? gs : 0;
              sdSum += sd;
            }
          }
        }
        actor.backwardBatch(dz); aopt.step();
        if (P.head === 'gauss') {
          last.std = sdSum / (B * AK);
          if (aim === 'q' || aim === 'qclose') {
            const meanLp = lpSum / B; last.entropy = -meanLp;
            if (P.entropy === 'auto') { logAlpha += H.lrAlpha * (meanLp + targetEnt); logAlpha = Math.max(-10, Math.min(2, logAlpha)); }
          }
        }
      }
      last.alpha = useEntropy ? (P.entropy === 'auto' ? Math.exp(logAlpha) : H.alpha) : 0;
      probe.aBefore = before;
      probe.aAfter = Array.from(sampleOne(policyInput(probe.s, bt.Bs ? bt.Bs.subarray(0, A) : null, true), false));
    }

    // EXPO-style edit policy: a small Gaussian change (at most editScale) that climbs the critic, with an entropy bonus
    function editUpdate(bt, alpha) {
      const B = bt.B, X = new Float32Array(B * (D + A));
      const pa = sampleBatch(inputsOf(bt.S, bt.Bs, B, 1), B, true), first = new Float32Array(B * A);
      for (let b = 0; b < B; b++) first.set(pa.subarray(b * AK, b * AK + A), b * A);
      const base = fullBatch(first, bt.Bs, B, 1);
      for (let b = 0; b < B; b++) { X.set(bt.S.subarray(b * D, b * D + D), b * (D + A)); X.set(base.subarray(b * A, b * A + A), b * (D + A) + D); }
      const z = Float32Array.from(editNet.forwardBatch(X, B));
      const aE = new Float32Array(B * A), eps = new Float32Array(B * A), ls = new Float32Array(B * A);
      for (let b = 0; b < B; b++) for (let j = 0; j < A; j++) {
        const k = b * A + j; ls[k] = Math.max(-5, Math.min(2, z[b * 2 * A + A + j])); eps[k] = rng.normal();
        aE[k] = clip1(base[k] + H.editScale * Math.tanh(z[b * 2 * A + j] + Math.exp(ls[k]) * eps[k]));
      }
      const gs = crit.map((c) => dQda(c, bt.S, aE, B));
      const ae = Math.max(alpha, 0.01);
      const dz = new Float32Array(B * 2 * A);
      for (let b = 0; b < B; b++) {
        let k0 = 0; for (let i = 1; i < gs.length; i++) if (gs[i].q[b] < gs[k0].q[b]) k0 = i;
        for (let j = 0; j < A; j++) {
          const k = b * A + j, sd = Math.exp(ls[k]), u = z[b * 2 * A + j] + sd * eps[k], th = Math.tanh(u), d1 = 1 - th * th;
          const g = gs[k0].g[k] * H.editScale;
          dz[b * 2 * A + j] = (ae * 2 * th - g * d1) / B;
          const raw = z[b * 2 * A + A + j];
          dz[b * 2 * A + A + j] = raw > -5 && raw < 2 ? (ae * (-1 + 2 * th * sd * eps[k]) - g * d1 * sd * eps[k]) / B : 0;
        }
      }
      editNet.forwardBatch(X, B); editNet.backwardBatch(dz); eopt.step();
    }

    // dataset first (fixed or both), then optional pretraining on it
    if (withDemos) {
      if (typeof world.expert !== 'function') { notes.push('This world has no demonstrator, so there is no dataset. The learner starts from nothing.'); }
      else {
        makeDataset();
        if (P.source === 'both') {
          const saved = aim; if (aim === 'none') aim = 'copy';
          for (let k = 0; k < H.pretrain; k++) update();
          aim = saved;
        }
      }
    }

    return {
      parts: P, hyper: H, notes, offline,
      act, observe, endEpisode() { queue = []; },
      train: update,
      probe: () => lastProbe,
      datasetInfo: () => dataset,
      qOf: nCrit ? (s, a) => qMin(s, a) : null,
      sample: (obs, n) => { const bA = useBase ? Float32Array.from(baseCtl(obs)) : null, xin = policyInput(obs, bA, true); return Array.from({ length: n }, () => Array.from(full(sampleOne(xin, true), bA))); },
      value: vnet ? (obs) => vnet.forward(obs)[0] : (nCrit ? (obs) => qMin(obs, choose(obs, useBase ? Float32Array.from(baseCtl(obs)) : null, false).slice(0, A)) : null),
      beginEpisode: () => { queue = []; },
      diagnostics: () => ({ steps: envSteps, updates, loss: last.loss, tdAbs: last.tdAbs, qData: last.qData, qPolicy: last.qPolicy, alpha: last.alpha, entropy: last.entropy, std: last.std }),
    };
  }

  RLA.ac = { make, normalize, DEFAULT_PARTS, DEFAULT_HYPER };
  if (typeof module === 'object' && module.exports) module.exports = RLA.ac;
})();
