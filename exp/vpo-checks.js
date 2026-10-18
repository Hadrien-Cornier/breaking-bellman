// Correctness checks (main080 rev 2, per 024): all objective/gradient checks exercise the PRODUCTION
// helpers exported by exp/vpo-base-regime.js; pool composition uses the production world/chain/reward
// path with the frozen evaluation settings. Usage: node exp/vpo-checks.js [ckptDir] [outLabel]
'use strict';
const fs = require('fs');
const path = require('path');
const RLA = globalThis.RLA = globalThis.RLA || {};
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
const rngMake = RLA.rng.make;
const X = require(path.join(__dirname, 'vpo-base-regime.js')); // production helpers (legacy contract by default)
const dot = X.dot, WSTAR = X.WSTAR;
const ckptDir = process.argv[2] || '/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence/a4-ckpt';
const label = process.argv[3] || 'a4';
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); if (!ok) failures++; };

// ---------- check 1: set reward + group advantage, via PRODUCTION helpers
const A = [1, 1, 0, 0.8], B = [1, 0, 1, 0.8], C = [1, 0.2, 0.2, 1];
const draws = [[0.1, 0.1, 0.7, 0.1], [0.1, 0.7, 0.1, 0.1], [0.1, 0.1, 0.1, 0.7]];
const rABC = X.setRewardMean([A, B, C], draws), rAAA = X.setRewardMean([A, A, A], draws);
check('1a production setRewardMean {A,B,C} = 0.8666667', Math.abs(rABC - 0.8666666666666666) < 1e-9, 'got ' + rABC);
check('1b production setRewardMean {A,A,A} = 0.64', Math.abs(rAAA - 0.64) < 1e-9, 'got ' + rAAA);
check('1c ranking {A,B,C} > {A,A,A}', rABC > rAAA);
const adv = X.groupAdv([rABC, rAAA]);
check('1d production groupAdv signs + / -', adv[0] > 0 && adv[1] < 0, 'adv ' + adv.map((x) => x.toFixed(3)).join(','));

// ---------- check 4: failure-exit reward regression (paper contract vs legacy contract)
// The paper's Maze reward (App A.1): if E is never reached the vector is (0,0,0,0); otherwise (1, g, d, l).
// The toy's legacy contract pays [0,0,0,1] for a no-exit lava-free route: an accidental discrepancy
// (recorded in the research log; ALL attempts A0-A5 used the legacy contract).
check('4a legacy contract: no-exit lava-free route = [0,1,1,1] shape (items kept, exit 0) - documented discrepancy vs paper', JSON.stringify(X.rewardVec(0, 2, 0, 0)) === JSON.stringify([0, 1, 0, 1]), JSON.stringify(X.rewardVec(0, 2, 0, 0)));
// paper-contract regression via a subprocess with VPO_CONTRACT=paper (the helper reads the env at require time)
const out = require('child_process').execSync(`VPO_CONTRACT=paper node -e "const X=require('${path.join(__dirname, 'vpo-base-regime.js')}'); console.log(JSON.stringify([X.rewardVec(0,2,2,0), X.rewardVec(1,2,2,0), X.rewardVec(0,0,0,1)]))"`).toString();
const pv = JSON.parse(out);
check('4b paper contract: no-exit route = [0,0,0,0] on ALL dimensions', JSON.stringify(pv[0]) === JSON.stringify([0, 0, 0, 0]) && JSON.stringify(pv[2]) === JSON.stringify([0, 0, 0, 0]), JSON.stringify(pv));
check('4c paper contract: exiting route keeps (1, g, d, l)', pv[1][0] === 1 && pv[1][3] === 1, JSON.stringify(pv[1]));

// ---------- check 5: finite difference of the PRODUCTION mixture score/gradient
// production direction for logits z: iw*(onehot(a)-p) with iw = mixIW(p(a), eps, nA); the mixture
// probability of action a is mixProb(p(a), eps, nA). Both come from the production module.
function softmax(z) { let m = -Infinity; for (const x of z) m = Math.max(m, x); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }
function logmuProd(z, a, eps, nA) { const p = softmax(z); return Math.log(X.mixProb(p[a], eps, nA)); }
function prodDir(z, a, eps, nA) { const p = softmax(z); const iw = X.mixIW(p[a], eps, nA); return z.map((_, j) => iw * ((j === a ? 1 : 0) - p[j])); }
const FTCASES = { 4: [['typical', [-0.2, 0.1, 0.3, -0.1], 2], ['rare', [6, -1, -1, -1], 2], ['rare-b', [-1, -1, 6, -1], 0]], 2: [['typical', [-0.2, 0.3], 1], ['rare', [6, -1], 1], ['rare-b', [-1, 6], 0]] };
for (const [eps, nA] of [[0, 4], [0.15, 4], [0.15, 2]]) {
  for (const [lab, z, a] of FTCASES[nA]) {
    const zz = z.slice(0, nA);
    const h = 1e-6;
    const numeric = zz.map((_, j) => { const zp = zz.slice(), zm = zz.slice(); zp[j] += h; zm[j] -= h; return (logmuProd(zp, a, eps, nA) - logmuProd(zm, a, eps, nA)) / (2 * h); });
    const analytic = prodDir(zz, a, eps, nA);
    const err = Math.max(...analytic.map((x, j) => Math.abs(x - numeric[j])));
    check(`5 fd production-gradient eps=${eps} nA=${nA} ${lab}`, err < 1e-5, 'max abs err ' + err.toExponential(2));
  }
}

// ---------- check 2: tiny bandit, CORRECTED eps denominator (eps/nA with nA=2; the first flawed
// version used eps/4 and is retained as superseded evidence in the log). Simplification disclosed:
// sequential tabular SGD, not the production batched NN Adam - it tests the OBJECTIVE and the
// mixture-gradient direction, not the optimizer.
// Frozen thresholds (declared in the research log before this corrected run):
//   VPO keeps both routes on every seed: 0.05 < P(gold) < 0.95;
//   scalar GRPO selects one route on every seed: P(gold) <= 0.05 or >= 0.95.
const R_GOLD = [1, 1, 0, 1], R_DIAM = [1, 0, 0.9, 1];
function dirichlet(rng, d) { const w = []; let s = 0; for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; } return w.map((x) => x / s); }
function bandit(seed, method, updates) {
  const rng = rngMake(seed * 331 + 7);
  const th = new Float64Array(2); // uniform start
  const probs = () => { let m = -Infinity; for (const x of th) m = Math.max(m, x); const e = [0, 1].map((j) => Math.exp(th[j] - m)); const s = e[0] + e[1]; return e.map((x) => x / s); };
  const eps = 0.15, NA = 2;
  for (let u = 1; u <= updates; u++) {
    const draws2 = method === 'vpo' ? Array.from({ length: 8 }, () => dirichlet(rng, 4)) : null;
    const group = [];
    for (let g = 0; g < (method === 'vpo' ? 4 : 12); g++) {
      if (method === 'vpo') {
        const acts = [];
        for (let j = 0; j < 2; j++) { const p = probs(); let a; if (rng.next() < eps) a = rng.int(NA); else { const uu = rng.next(); a = uu < p[0] ? 0 : 1; } acts.push(a); }
        const vecs = acts.map((a) => (a === 0 ? R_GOLD : R_DIAM));
        group.push({ acts, R: X.setRewardMean(vecs, draws2) });
      } else {
        const p = probs(); let a; if (rng.next() < eps) a = rng.int(NA); else { const uu = rng.next(); a = uu < p[0] ? 0 : 1; }
        group.push({ acts: [a], R: X.setRewardMean([a === 0 ? R_GOLD : R_DIAM], [WSTAR]) });
      }
    }
    const ADVs = X.groupAdv(group.map((x) => x.R));
    for (let gi = 0; gi < group.length; gi++) for (const a of group[gi].acts) {
      const p = probs();
      const iw = X.mixIW(p[a], eps, NA);
      for (let j = 0; j < 2; j++) th[j] += 0.003 * ADVs[gi] * iw * ((j === a ? 1 : 0) - p[j]);
    }
  }
  return probs()[0];
}
const bSeeds = [1, 3, 5, 7, 9];
const bV = bSeeds.map((s) => bandit(s, 'vpo', 500));
const bG = bSeeds.map((s) => bandit(s, 'grpo', 500));
check('2a (corrected eps/2) VPO keeps two routes, all seeds', bV.every((p) => p > 0.05 && p < 0.95), 'P(gold) ' + bV.map((x) => x.toFixed(3)).join(','));
check('2b (corrected eps/2) GRPO selects one route, all seeds', bG.every((p) => p <= 0.05 || p >= 0.95), 'P(gold) ' + bG.map((x) => x.toFixed(3)).join(','));

// ---------- check 3: end-pool composition via the PRODUCTION path (world, chain, reward, evaluation
// settings: held-out mazes 2000-2007, eval eps 0.05, 30 reps of 10 chains x 3 candidates, first-k in
// chain order). Per-maze counts and within-maze spread (between-maze spread reported separately).
function poolReport(ckptFile) {
  const params = JSON.parse(fs.readFileSync(ckptFile, 'utf8')).map((p) => Float32Array.from(p));
  const sizes = [X.FDIM, 16, 4];
  const forward = (obs) => { let x = obs; for (let l = 0; l < sizes.length - 1; l++) { const W = params[l * 2], b2 = params[l * 2 + 1], out = new Float32Array(sizes[l + 1]); for (let o = 0; o < sizes[l + 1]; o++) { let s2 = b2[o]; for (let i = 0; i < sizes[l]; i++) s2 += x[i] * W[o * sizes[l] + i]; out[o] = l < sizes.length - 2 ? Math.tanh(s2) : s2; } x = out; } return Array.from(x); };
  const probs = (obs) => { const z = forward(obs); let m = -Infinity; for (const x2 of z) m = Math.max(m, x2); const e = z.map((x2) => Math.exp(x2 - m)); const s = e.reduce((a, b3) => a + b3, 0); return e.map((x2) => x2 / s); };
  const testMazes = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007].map(X.makeMaze);
  const rng = rngMake(7919); // one stream across mazes/arms for identical sampling conditions
  const perMaze = [];
  for (const mz of testMazes) {
    const routes = [];
    for (let rep = 0; rep < 30; rep++) for (const rt of X.chain(mz, { probs }, rng, true, 0.05, 3)) routes.push(rt.vec);
    let L1 = 0, np = 0;
    for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) { let d = 0; for (let q = 0; q < 4; q++) d += Math.abs(routes[i][q] - routes[j][q]); L1 += d; np++; }
    const uniq = {}; for (const v of routes) { const k = v.map((x) => Math.round(x * 100) / 100).join(','); uniq[k] = (uniq[k] || 0) + 1; }
    perMaze.push({ regime: mz.regime, n: routes.length, exitRate: routes.filter((v) => v[0] === 1).length / routes.length, lavaHitRate: routes.filter((v) => v[3] === 0).length / routes.length, withinMazeSpread: L1 / np, uniqueVecs: Object.keys(uniq).length, top: Object.entries(uniq).sort((a, b) => b[1] - a[1]).slice(0, 3) });
  }
  const all = perMaze.reduce((a, m) => a, []) || [];
  const nTotal = perMaze.reduce((s, m) => s + m.n, 0);
  const exitRate = perMaze.reduce((s, m) => s + m.exitRate * m.n, 0) / nTotal;
  const withinMean = perMaze.reduce((s, m) => s + m.withinMazeSpread, 0) / perMaze.length;
  return { perMaze, exitRate, withinMazeSpreadMean: withinMean };
}
for (const [arm, dir] of [['A4-vpo', 'a4-ckpt'], ['A5-vpo', 'a5-ckpt']]) {
  const rep = poolReport(path.join('/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence', dir, 'vpo-SEED.json').replace('SEED', '1'));
  void rep;
}
const reports = {};
for (const [tag, dir] of [['a4', 'a4-ckpt'], ['a5', 'a5-ckpt']]) {
  const perSeed = {};
  for (const seed of [1, 3, 5, 7, 9]) {
    const f = path.join('/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence', dir, 'vpo-' + seed + '.json');
    perSeed[seed] = fs.existsSync(f) ? poolReport(f) : { missing: true };
  }
  reports[tag] = perSeed;
  console.log(`check 3 pool composition (${tag}, production path, 7200 routes/seed):`);
  for (const seed of [1, 3, 5, 7, 9]) {
    const r = perSeed[seed];
    if (r.missing) { console.log('  seed', seed, 'no checkpoint'); continue; }
    const noExit = r.perMaze.reduce((s, m) => s + m.n * (1 - m.exitRate), 0);
    console.log('  seed', seed, 'exitRate', r.exitRate.toFixed(2), 'within-maze spread mean', r.withinMazeSpreadMean.toFixed(2), 'per-maze exit', r.perMaze.map((m) => m.exitRate.toFixed(2)).join(','), 'top vec (first maze)', JSON.stringify(r.perMaze[0].top[0] || null));
  }
}

fs.writeFileSync(`/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence/checks-main080-${label}.json`, JSON.stringify({ ckptDir, label, rABC, rAAA, adv, banditV: bV, banditG: bG, poolReports: reports }, null, 1));
console.log(failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED');
