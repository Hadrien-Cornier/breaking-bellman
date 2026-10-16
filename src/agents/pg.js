(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); require('../core/nn.js'); }

  // Policy-gradient learner. The update rule is a sentence of words:
  //   batch    episodes per update (1, 4, 16); group: 'none' | 'same' (all episodes of a batch start from one prompt)
  //   credit   'total' (whole-episode return on every step) | 'togo' (rewards after this step)
  //   baseline 'none' | 'avg' (running average) | 'critic' (learned V(s)) | 'group' (mean return of the group)
  //   adv      with a critic: 'mc' (return - V) | 'td' (r + gamma V(s') - V) | 'gae' (blend, lambda 0.95)
  //   scale    'none' | 'std' (divide by the spread: the group's std, or the batch's std after centering)
  //   ratio    'plain' (ratio * A) | 'clip' (PPO: ratio limited to [1 - 0.2, 1 + 0.2])
  //   epochs   passes over each batch (1, 4, 10); lr: policy step size; bonus: entropy bonus weight
  const DEFAULT_PARTS = { family: 'pg', batch: 4, group: 'none', credit: 'togo', baseline: 'none', adv: 'gae', scale: 'none', ratio: 'plain', epochs: 1, lr: 0.003, bonus: 0 };
  const DEFAULT_HYPER = { hidden: [32, 32], act: 'tanh', lrCritic: 0.003, lambda: 0.95, clipEps: 0.2, logStdInit: -0.5, avgRate: 0.05 };

  function normalize(parts) {
    const P = Object.assign({}, DEFAULT_PARTS, parts || {});
    P.batch = Math.max(1, P.batch | 0); P.epochs = Math.max(1, P.epochs | 0);
    return P;
  }

  function make(parts, world, rng, hyperIn) {
    const P = normalize(parts), H = Object.assign({}, DEFAULT_HYPER, hyperIn || {});
    const spec = world.spec, D = spec.obsDim, cont = !!spec.continuous, A = cont ? spec.actDim : spec.nActions, gamma = spec.gamma;
    const notes = [];
    if (P.baseline === 'group' && P.group !== 'same') notes.push('"The mean of its group" needs every episode of a batch to start from the same prompt; here the episodes start from different prompts, so the baseline mixes easy and hard prompts.');
    if (P.baseline === 'group' && P.batch < 2) notes.push('A group of 1 episode has no spread: every advantage is 0, so nothing is learned.');
    if (P.ratio === 'clip' && P.epochs === 1) notes.push('With 1 pass the ratio starts at 1 and stays inside the clip range, so the clip does little.');
    const pol = RLA.nn.mlp({ sizes: [D].concat(H.hidden, [A]), act: H.act, rng, outScale: 0.01 });
    const popt = RLA.nn.adam(pol, { lr: P.lr });
    const logStd = cont ? new Float64Array(A).fill(H.logStdInit) : null;
    const lsM = cont ? new Float64Array(A) : null, lsV = cont ? new Float64Array(A) : null; let lsT = 0;
    const useCritic = P.baseline === 'critic';
    const crit = useCritic ? RLA.nn.mlp({ sizes: [D].concat(H.hidden, [1]), act: H.act, rng, outScale: 1 }) : null;
    const copt = useCritic ? RLA.nn.adam(crit, { lr: H.lrCritic }) : null;
    let avgB = 0, avgInit = false;
    let steps = 0, updates = 0, nZero = 0, last = { kl: 0, clipFrac: 0, entropy: 0, vloss: 0, zeroGroups: 0 };
    let ep = { s: [], a: [], r: [], done: false, sLast: null };
    let batch = [];
    let lastProbe = null;

    // ---- policy math
    function softmax(z, off, out) {
      let m = -Infinity; for (let j = 0; j < A; j++) m = Math.max(m, z[off + j]);
      let s = 0; for (let j = 0; j < A; j++) { out[j] = Math.exp(z[off + j] - m); s += out[j]; }
      for (let j = 0; j < A; j++) out[j] /= s;
      return out;
    }
    const pBuf = new Float64Array(A);
    function act(obs, explore) {
      const z = pol.forward(obs);
      if (!cont) {
        softmax(z, 0, pBuf);
        if (explore === false) { let b = 0; for (let j = 1; j < A; j++) if (pBuf[j] > pBuf[b]) b = j; return b; }
        let u = rng.next(), j = 0; for (; j < A - 1; j++) { u -= pBuf[j]; if (u < 0) break; }
        return j;
      }
      const a = new Float32Array(A);
      for (let j = 0; j < A; j++) a[j] = explore === false ? z[j] : z[j] + Math.exp(logStd[j]) * rng.normal();
      return a;
    }
    // log-probability of action a under outputs z (at offset), for the batch math
    function logp(z, off, a) {
      if (!cont) { softmax(z, off, pBuf); return Math.log(pBuf[a] + 1e-12); }
      let l = 0; for (let j = 0; j < A; j++) { const sd = Math.exp(logStd[j]), d = (a[j] - z[off + j]) / sd; l += -0.5 * d * d - logStd[j] - 0.9189385332; }
      return l;
    }

    // ---- collecting episodes
    function observe(t) {
      steps++;
      ep.s.push(Float32Array.from(t.obs)); ep.a.push(cont ? Float32Array.from(t.a) : t.a); ep.r.push(t.r);
      if (t.done || t.truncated) {
        ep.done = !!t.done; ep.sLast = Float32Array.from(t.obs2);
        batch.push(ep);
        ep = { s: [], a: [], r: [], done: false, sLast: null };
        if (batch.length >= P.batch) { update(batch); batch = []; }
      }
    }

    function vOf(states) {
      const n = states.length, X = new Float32Array(n * D);
      states.forEach((s, i) => X.set(s, i * D));
      return Array.from(crit.forwardBatch(X, n));
    }

    function update(eps) {
      // 1. per-step weights (advantages) and critic targets
      const S = [], Aa = [], Adv = [], Vt = [], epOf = [], W = [], Base = [];
      const totals = eps.map((e) => { let g = 0; for (let i = e.r.length - 1; i >= 0; i--) g = e.r[i] + gamma * g; return g; });
      const gMean = totals.reduce((s, x) => s + x, 0) / totals.length;
      const gStd = Math.sqrt(totals.reduce((s, x) => s + (x - gMean) * (x - gMean), 0) / totals.length);
      eps.forEach((e, ei) => {
        const T = e.r.length, togo = new Array(T);
        let g = 0; for (let i = T - 1; i >= 0; i--) { g = e.r[i] + gamma * g; togo[i] = g; }
        let adv, base, w;
        if (P.baseline === 'critic') {
          const v = vOf(e.s.concat([e.sLast])), vEnd = e.done ? 0 : v[T];
          adv = new Array(T); base = v.slice(0, T); w = togo.slice();
          if (P.adv === 'mc') for (let i = 0; i < T; i++) adv[i] = togo[i] - v[i];
          else {
            const lam = P.adv === 'td' ? 0 : H.lambda; let gae = 0;
            for (let i = T - 1; i >= 0; i--) {
              const vn = i === T - 1 ? vEnd : v[i + 1];
              const delta = e.r[i] + gamma * vn - v[i];
              gae = delta + gamma * lam * gae; adv[i] = gae;
            }
          }
          for (let i = 0; i < T; i++) Vt.push(P.adv === 'mc' ? togo[i] : adv[i] + v[i]);
        } else {
          w = P.baseline === 'group' || P.credit === 'total' ? new Array(T).fill(totals[ei]) : togo;
          let b = 0;
          if (P.baseline === 'avg') b = avgB;
          if (P.baseline === 'group') b = gMean;
          base = new Array(T).fill(b);
          adv = w.map((x) => x - b);
        }
        for (let i = 0; i < T; i++) { S.push(e.s[i]); Aa.push(e.a[i]); Adv.push(adv[i]); epOf.push(ei); W.push(w[i]); Base.push(base[i]); }
      });
      if (P.baseline === 'avg') {
        // the running average learns after this batch is weighted (so it never uses its own episode)
        for (const x of (P.credit === 'total' ? totals : W)) { if (!avgInit) { avgB = x; avgInit = true; } else avgB += H.avgRate * (x - avgB); }
      }
      const N = S.length;
      const raw = Adv.slice();
      if (P.scale === 'std') {
        if (P.baseline === 'group') { for (let i = 0; i < N; i++) Adv[i] = Adv[i] / (gStd + 1e-6); }
        else {
          const m = Adv.reduce((s, x) => s + x, 0) / N, sd = Math.sqrt(Adv.reduce((s, x) => s + (x - m) * (x - m), 0) / N);
          for (let i = 0; i < N; i++) Adv[i] = (Adv[i] - m) / (sd + 1e-6);
        }
      }
      last.zeroGroups = P.baseline === 'group' && gStd === 0 ? 1 : 0; nZero += last.zeroGroups;

      // 2. old log-probabilities
      const X = new Float32Array(N * D); S.forEach((s, i) => X.set(s, i * D));
      let z = pol.forwardBatch(X, N);
      const lpOld = new Float64Array(N); for (let i = 0; i < N; i++) lpOld[i] = logp(z, i * A, Aa[i]);
      const probOld = cont ? null : Array.from({ length: Math.min(N, eps[0].r.length) }, (_, i) => Array.from(softmax(z, i * A, new Float64Array(A))));

      // 3. policy passes
      let clipped = 0, ratios = new Float64Array(N), ent = 0;
      for (let ep2 = 0; ep2 < P.epochs; ep2++) {
        z = pol.forwardBatch(X, N);
        const dZ = new Float32Array(N * A);
        clipped = 0; ent = 0;
        const dLs = cont ? new Float64Array(A) : null;
        for (let i = 0; i < N; i++) {
          const lp = logp(z, i * A, Aa[i]), ratio = Math.exp(lp - lpOld[i]); ratios[i] = ratio;
          const adv = Adv[i];
          let g = -ratio * adv; // dLoss/dlogp
          if (P.ratio === 'clip' && ((adv > 0 && ratio > 1 + H.clipEps) || (adv < 0 && ratio < 1 - H.clipEps))) { g = 0; clipped++; }
          g /= N;
          if (!cont) {
            softmax(z, i * A, pBuf);
            let Hn = 0; for (let j = 0; j < A; j++) Hn -= pBuf[j] * Math.log(pBuf[j] + 1e-12);
            ent += Hn;
            for (let j = 0; j < A; j++) {
              dZ[i * A + j] = g * ((j === Aa[i] ? 1 : 0) - pBuf[j]);
              if (P.bonus) dZ[i * A + j] += (P.bonus / N) * pBuf[j] * (Math.log(pBuf[j] + 1e-12) + Hn);
            }
          } else {
            for (let j = 0; j < A; j++) {
              const sd = Math.exp(logStd[j]), d = Aa[i][j] - z[i * A + j];
              dZ[i * A + j] = g * (d / (sd * sd));
              dLs[j] += g * (d * d / (sd * sd) - 1) - (P.bonus || 0) / N;
              ent += logStd[j] + 1.4189385332;
            }
          }
        }
        pol.backwardBatch(dZ); popt.step();
        if (cont) {
          // Adam on the log standard deviations, same step size as the policy
          lsT++;
          for (let j = 0; j < A; j++) {
            lsM[j] = 0.9 * lsM[j] + 0.1 * dLs[j]; lsV[j] = 0.999 * lsV[j] + 0.001 * dLs[j] * dLs[j];
            logStd[j] -= P.lr * (lsM[j] / (1 - Math.pow(0.9, lsT))) / (Math.sqrt(lsV[j] / (1 - Math.pow(0.999, lsT))) + 1e-8);
            logStd[j] = Math.max(-3, Math.min(1, logStd[j]));
          }
        }
      }
      // 4. how far did the policy move? (mean old logp - new logp, an estimate of the KL)
      z = pol.forwardBatch(X, N);
      let kl = 0; const lpNew = new Float64Array(N);
      for (let i = 0; i < N; i++) { lpNew[i] = logp(z, i * A, Aa[i]); kl += lpOld[i] - lpNew[i]; }
      const probNew = cont ? null : Array.from({ length: Math.min(N, eps[0].r.length) }, (_, i) => Array.from(softmax(z, i * A, new Float64Array(A))));

      // 5. critic passes
      let vloss = 0;
      if (useCritic) {
        for (let k = 0; k < Math.max(1, P.epochs); k++) {
          const v = crit.forwardBatch(X, N), dV = new Float32Array(N);
          vloss = 0; for (let i = 0; i < N; i++) { const e = v[i] - Vt[i]; dV[i] = e / N; vloss += e * e / N; }
          crit.backwardBatch(dV); copt.step();
        }
      }
      updates++;
      last = { kl: kl / N, clipFrac: clipped / N, entropy: ent / N / (cont ? 1 : 1), vloss, zeroGroups: last.zeroGroups };

      // 6. the replay of this update: the first episode of the batch, step by step
      const T0 = eps[0].r.length, rows = [];
      for (let i = 0; i < Math.min(T0, 40); i++) {
        rows.push({ a: cont ? Array.from(Aa[i]) : Aa[i], r: eps[0].r[i], w: W[i], base: Base[i], adv: raw[i], advScaled: Adv[i],
          pOld: Math.exp(lpOld[i]), pNew: Math.exp(lpNew[i]), ratio: ratios[i],
          clipped: P.ratio === 'clip' && ((Adv[i] > 0 && ratios[i] > 1 + H.clipEps) || (Adv[i] < 0 && ratios[i] < 1 - H.clipEps)),
          probsOld: probOld ? probOld[i] : null, probsNew: probNew ? probNew[i] : null });
      }
      lastProbe = { rows, episodes: eps.length, totals, gMean, gStd, steps: N, kl: kl / N, clipFrac: clipped / N, cont, nActions: A, epochs: P.epochs, update: updates, avgB };
    }

    return {
      parts: P, hyper: H, notes,
      groupSize: P.group === 'same' ? P.batch : 1,
      act, observe, endEpisode() {},
      probe: () => lastProbe,
      value: useCritic ? (obs) => crit.forward(obs)[0] : null,
      probs: cont ? null : (obs) => Array.from(softmax(pol.forward(obs), 0, new Float64Array(A))),
      // the policy weights as plain arrays, so the page can play the trained policy outside the worker (fetch: throw the stick)
      policyNet: () => ({ sizes: pol.sizes.slice(), act: H.act, cont, params: pol.params.map((p) => Array.from(p)) }),
      diagnostics: () => ({ steps, updates, kl: last.kl, clipFrac: last.clipFrac, entropy: last.entropy, loss: last.vloss, zeroGroups: last.zeroGroups, zeroFrac: updates ? nZero / updates : 0, std: cont ? Array.from(logStd, Math.exp) : null }),
    };
  }

  RLA.pg = { make, normalize, DEFAULT_PARTS, DEFAULT_HYPER };
  if (typeof module === 'object' && module.exports) module.exports = RLA.pg;
})();
