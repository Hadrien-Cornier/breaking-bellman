// Correctness checks requested by main080 (relay 022) - production-objective, sampler, and behavior.
// Usage: node exp/vpo-checks.js
'use strict';
const fs = require('fs');
const path = require('path');
const RLA = globalThis.RLA = globalThis.RLA || {};
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
const rngMake = RLA.rng.make;
const dot = (w, v) => w.reduce((s, x, i) => s + x * v[i], 0);
const WSTAR = [0.25, 0.25, 0.25, 0.25];
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : '')); if (!ok) failures++; };

// ---------- check 1: hand-built set reward + group advantage sign (documented vectors)
// A gold [1,1,0,0.8], B diamond [1,0,1,0.8], C direct [1,0.2,0.2,1]; draws w1,w2,w3 from the protocol report
const A = [1, 1, 0, 0.8], B = [1, 0, 1, 0.8], C = [1, 0.2, 0.2, 1];
const draws = [[0.1, 0.1, 0.7, 0.1], [0.1, 0.7, 0.1, 0.1], [0.1, 0.1, 0.1, 0.7]];
const setReward = (vecs, ws) => ws.map((w) => Math.max(...vecs.map((v) => dot(w, v)))).reduce((s, x) => s + x, 0) / ws.length;
const rABC = setReward([A, B, C], draws), rAAA = setReward([A, A, A], draws);
check('1a set reward {A,B,C} = 0.8666667', Math.abs(rABC - 0.8666666666666667) < 1e-9, 'got ' + rABC);
check('1b set reward {A,A,A} = 0.64', Math.abs(rAAA - 0.64) < 1e-9, 'got ' + rAAA);
check('1c ranking {A,B,C} > {A,A,A}', rABC > rAAA);
// group advantage sign: group of two chains, mean/std normalization as in production
const advOf = (vals) => { const m = vals.reduce((s, x) => s + x, 0) / vals.length; const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length); return vals.map((x) => (x - m) / (sd + 1e-6)); };
const adv = advOf([rABC, rAAA]);
check('1d advantage(ABC) > 0 > advantage(AAA)', adv[0] > 0 && adv[1] < 0, 'adv ' + adv.map((x) => x.toFixed(3)).join(','));

// ---------- check 5 (run before 2): finite-difference of the mixture score gradient
// production update per-sample direction for logits z: iw*(onehot(a)-p), iw = (1-eps)*p(a)/mu(a),
// mu(a) = (1-eps)*p(a) + eps/4. Verify against numeric d/dz_j log(mu(a)) at several z, eps, a.
function softmax(z) { let m = -Infinity; for (const x of z) m = Math.max(m, x); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }
function logmu(z, a, eps) { const p = softmax(z); return Math.log((1 - eps) * p[a] + eps / 4); }
function gradCheck(z, a, eps) {
  const p = softmax(z);
  const mu = (1 - eps) * p[a] + eps / 4;
  const iw = eps > 0 ? (1 - eps) * p[a] / mu : 1;
  const analytic = z.map((_, j) => iw * ((j === a ? 1 : 0) - p[j]));
  const h = 1e-6, numeric = z.map((_, j) => { const zp = z.slice(), zm = z.slice(); zp[j] += h; zm[j] -= h; return (logmu(zp, a, eps) - logmu(zm, a, eps)) / (2 * h); });
  const err = Math.max(...analytic.map((x, j) => Math.abs(x - numeric[j])));
  return { err, analytic, numeric };
}
for (const eps of [0, 0.15]) {
  for (const [label, z, a] of [['typical', [-0.2, 0.1, 0.3, -0.1], 2], ['rare action', [6.0, -1, -1, -1], 2], ['rare action b', [-1, -1, 6.0, -1], 0]]) {
    const r = gradCheck(z, a, eps);
    check(`5 fd-gradient eps=${eps} ${label}`, r.err < 1e-4, 'max abs err ' + r.err.toExponential(2) + ' (analytic ' + r.analytic.map((x) => x.toFixed(4)).join(',') + ')');
  }
}

// ---------- check 2: tiny bandit - VPO keeps two distinct routes, scalar GRPO selects one
// Single state, two actions with fixed reward vectors (a gold route, a diamond route; gold slightly
// better under the fixed uniform score, so scalar has a unique optimum). Chain of m=2 candidates;
// the same candidate may repeat an action. eps-soft 0.15 sampling + the A5 mixture-gradient update,
// exactly as production. No injected diversity, no forced allocation.
// Frozen: seeds [1,3,5,7,9], updates 500, lr 0.003, m=2, K=8, G_chain=4, G_single=12, eps 0.15.
const R_GOLD = [1, 1, 0, 1], R_DIAM = [1, 0, 0.9, 1];
function dirichlet(rng, d) { const w = []; let s = 0; for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; } return w.map((x) => x / s); }
function bandit(seed, method, updates) {
  const rng = rngMake(seed * 331 + 7);
  const th = new Float64Array(2); // uniform start
  const probs = () => { let m = -Infinity; for (const x of th) m = Math.max(m, x); const e = [0, 1].map((j) => Math.exp(th[j] - m)); const s = e[0] + e[1]; return e.map((x) => x / s); };
  const eps = 0.15;
  const hist = [];
  for (let u = 1; u <= updates; u++) {
    const draws2 = method === 'vpo' ? Array.from({ length: 8 }, () => dirichlet(rng, 4)) : null;
    const group = [];
    for (let g = 0; g < (method === 'vpo' ? 4 : 12); g++) {
      if (method === 'vpo') {
        const acts = [];
        for (let j = 0; j < 2; j++) { const p = probs(); let a; if (rng.next() < eps) a = rng.int(2); else { let uu = rng.next(); a = uu < p[0] ? 0 : 1; } acts.push(a); }
        const vecs = acts.map((a) => (a === 0 ? R_GOLD : R_DIAM));
        const per = draws2.map((w) => Math.max(...vecs.map((v) => dot(w, v))));
        group.push({ acts, R: per.reduce((s, x) => s + x, 0) / per.length });
      } else {
        const p = probs(); let a; if (rng.next() < eps) a = rng.int(2); else { const uu = rng.next(); a = uu < p[0] ? 0 : 1; }
        group.push({ acts: [a], R: dot(WSTAR, a === 0 ? R_GOLD : R_DIAM) });
      }
    }
    const mean = group.reduce((s, x) => s + x.R, 0) / group.length;
    const std = Math.sqrt(group.reduce((s, x) => s + (x.R - mean) * (x.R - mean), 0) / group.length);
    const samples = [];
    for (const ep of group) { const adv = (ep.R - mean) / (std + 1e-6); for (const a of ep.acts) samples.push([a, adv]); }
    for (const [a, adv] of samples) {
      const p = probs();
      const mu = (1 - eps) * p[a] + eps / 4;
      const iw = (1 - eps) * p[a] / mu;
      for (let j = 0; j < 2; j++) th[j] += 0.003 * adv * iw * ((j === a ? 1 : 0) - p[j]);
    }
    if (u % 100 === 0) hist.push({ u, pGold: probs()[0] });
  }
  return { pGold: probs()[0], hist };
}
const bSeeds = [1, 3, 5, 7, 9];
const bV = bSeeds.map((s) => bandit(s, 'vpo', 500));
const bG = bSeeds.map((s) => bandit(s, 'grpo', 500));
const bothRoutes = (r) => r.pGold > 0.05 && r.pGold < 0.95;
const picksOne = (r) => r.pGold <= 0.05 || r.pGold >= 0.95;
check('2a VPO keeps two routes (all seeds, 0.05<P(gold)<0.95)', bV.every(bothRoutes), 'P(gold) ' + bV.map((r) => r.pGold.toFixed(3)).join(','));
check('2b GRPO selects one route (all seeds)', bG.every(picksOne), 'P(gold) ' + bG.map((r) => r.pGold.toFixed(3)).join(','));

// ---------- check 3: A4 VPO end-pool route composition from the saved checkpoints
const ckptDir = process.env.VPO_CKPT_DIR || '/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence/a4-ckpt';
// reuse the production world/pool code: extract it by evaluating the experiment's head with the
// requires stubbed out, then provide rng/nn from this module
const expSrc = fs.readFileSync(path.join(__dirname, 'vpo-base-regime.js'), 'utf8');
let head = expSrc.slice(0, expSrc.indexOf('// ---- base: behavior cloning'));
head = head
  .replace(/require\(path\.join\([^)]*\)\);/g, '')
  .replace(/const MODE = process.argv\[2\] \|\| 'frozen';/, '')
  .replace(/const OUT = process.argv\[3\][^;]*;/, '');
const NS_ = {};
const mod = new Function('rngMakeIn', `
  ${head.replace(/const RLA = globalThis[^;]*;/, '').replace(/const rngMake = RLA.rng.make;/, 'const rngMake = rngMakeIn;').replace(/const fs = require\('fs'\);/, 'const fs = { writeFileSync(){} };').replace(/const path = require\('path'\);/, 'const path = { join(){} };')}
  return { makeMaze, route, chain, features, FDIM: ${'FDIM'}, N: 9, GOAL, GC, DC, dist, bfs, traceDist, WSTAR: ${JSON.stringify(WSTAR)} };`)(rngMake);
// head defines FDIM below the slice point? ensure it exists
const { makeMaze, chain, features } = mod;
const FDIM = mod.FDIM;
const testMazes = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007].map(makeMaze);
const poolReport = [];
for (const seed of [1, 3, 5, 7, 9]) {
  const params = JSON.parse(fs.readFileSync(path.join(ckptDir, 'vpo-' + seed + '.json'), 'utf8')).map((p) => Float32Array.from(p));
  const sizes = [FDIM, 16, 4];
  const forward = (obs) => {
    let x = obs;
    for (let l = 0; l < sizes.length - 1; l++) {
      const W = params[l * 2], b2 = params[l * 2 + 1], out = new Float32Array(sizes[l + 1]);
      for (let o = 0; o < sizes[l + 1]; o++) { let s2 = b2[o]; for (let i = 0; i < sizes[l]; i++) s2 += x[i] * W[o * sizes[l] + i]; out[o] = l < sizes.length - 2 ? Math.tanh(s2) : s2; }
      x = out;
    }
    return Array.from(x);
  };
  const probs = (obs) => { const z = forward(obs); let m = -Infinity; for (const x2 of z) m = Math.max(m, x2); const e = z.map((x2) => Math.exp(x2 - m)); const s = e.reduce((a, b3) => a + b3, 0); return e.map((x2) => x2 / s); };
  const rng = rngMake(seed * 7919 + 5);
  const routes = [];
  for (const mz of testMazes) for (const rt of chain(mz, { probs }, rng, true, 0.05, 3)) routes.push(rt.vec);
  const scores = routes.map((v) => dot(WSTAR, v));
  let L1 = 0, np = 0;
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) { let d = 0; for (let q = 0; q < 4; q++) d += Math.abs(routes[i][q] - routes[j][q]); L1 += d; np++; }
  const uniq = {}; for (const v of routes) { const k = v.map((x) => x.toFixed(2)).join(','); uniq[k] = (uniq[k] || 0) + 1; }
  const exitRate = routes.filter((v) => v[0] === 1).length / routes.length;
  poolReport.push({ seed, n: routes.length, exitRate, spread: L1 / np, uniqueVecs: Object.keys(uniq).length, top: Object.entries(uniq).sort((a, b) => b[1] - a[1]).slice(0, 3) });
}
console.log('check 3 pool composition (A4 VPO checkpoints):');
for (const p of poolReport) console.log('  seed', p.seed, 'exitRate', p.exitRate.toFixed(2), 'spread', p.spread.toFixed(2), 'unique reward vectors', p.uniqueVecs, 'top', JSON.stringify(p.top));

// write machine-readable results
fs.writeFileSync('/Users/hcornier/Robotics/fm-homes/bellman/data/bb-vpo-design/evidence/checks-main080.json', JSON.stringify({ rABC, rAAA, adv, banditV: bV.map((r) => r.pGold), banditG: bG.map((r) => r.pGold), banditHist: { vpo: bV[0].hist, grpo: bG[0].hist }, poolReport }, null, 1));
console.log(failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
