// Attempt A9: four genuinely conflicting item dimensions.
// Same learner/update/eval machinery as the frozen A6 config (paper reward contract, mixture-weighted
// REINFORCE, shared Dirichlet draws), with the maze distribution changed to 4 item pockets: each maze
// opens a seeded subset of 2-3 pockets and lava-encloses the rest; the step budget fits at most ONE
// open pocket's full detour, so the reachable item dimensions genuinely conflict per problem.
// Reward vector r = [exit, item1, item2, item3, item4, noLava] (6 dims), uniform deployment score.
// Uses the production helpers from exp/vpo-base-regime.js (setRewardMean, groupAdv, mixIW, mixProb).
// Usage: node exp/vpo-a9.js frozen|smoke [outPath]
'use strict';
const fs = require('fs');
const path = require('path');
const RLA = globalThis.RLA = globalThis.RLA || {};
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
require(path.join(__dirname, '..', 'src', 'core', 'nn.js'));
const rngMake = RLA.rng.make;
const X = require(path.join(__dirname, 'vpo-base-regime.js'));
const setRewardMean = X.setRewardMean, groupAdv = X.groupAdv, mixIW = X.mixIW, mixProb = X.mixProb;
const dot = X.dot;
const N = 9, GOAL = [8, 8];
const DIST = 6; // reward dimensions
const WSTAR6 = Array(DIST).fill(1 / DIST);

function bfs(mz, from) {
  const D = Array.from({ length: N }, () => Array(N).fill(-1));
  if (mz.lava.some((l) => l[0] === from[0] && l[1] === from[1])) return D;
  D[from[0]][from[1]] = 0;
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = c[0] + dr, cc = c[1] + dc;
      if (r < 0 || r >= N || cc < 0 || cc >= N || D[r][cc] !== -1) continue;
      if (mz.lava.some((l) => l[0] === r && l[1] === cc)) continue;
      D[r][cc] = D[c[0]][c[1]] + 1; q.push([r, cc]);
    }
  }
  return D;
}
const traceDist = (mz, from, to) => { const D = bfs(mz, from); return D[to[0]][to[1]] >= 0 ? D[to[0]][to[1]] : Infinity; };

// ---- maze: 4 pockets, seeded open subset, budget fits at most one full pocket
const CORR = (() => { const cs = []; for (let i = 0; i < N; i++) { cs.push([i, 0]); cs.push([8, i]); cs.push([0, i]); cs.push([i, 8]); } return cs; })();
const onCorr = (c) => CORR.some((q) => q[0] === c[0] && q[1] === c[1]);
const POCKETS = [
  [[5, 2], [6, 2], [6, 3]],
  [[5, 6], [6, 6], [5, 5]],
  [[2, 2], [3, 2], [2, 3]],
  [[2, 6], [3, 6], [2, 5]],
];
function makeMaze(seed) {
  let lastErr = null;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { return makeMazeOnce(seed, attempt); } catch (e) { lastErr = e; }
  }
  throw new Error('no valid layout for seed ' + seed + ': ' + lastErr);
}
function makeMazeOnce(seed, attempt) {
  const rng = rngMake(seed * 131 + attempt * 7919 + 3);
  const lava = [];
  const tryLava = (c) => {
    if (lava.some((q) => q[0] === c[0] && q[1] === c[1])) return false;
    if (onCorr(c) || (c[0] === 0 && c[1] === 0) || (c[0] === GOAL[0] && c[1] === GOAL[1])) return false;
    lava.push(c); return true;
  };
  const size = 2 + (rng.next() < 0.4 ? 1 : 0); // 2 or 3 pockets open
  const pool = [0, 1, 2, 3];
  const open = [];
  while (open.length < size) open.push(pool.splice(rng.int(pool.length), 1)[0]);
  const items = POCKETS.map((p) => p.slice());
  const mz = { lava, pockets: items, open };
  const enclose = (cells) => {
    for (const c of cells) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = [c[0] + dr, c[1] + dc];
      if (q[0] < 0 || q[0] >= N || q[1] < 0 || q[1] >= N) continue;
      if (cells.some((z) => z[0] === q[0] && z[1] === q[1])) continue;
      if (!lava.some((l) => l[0] === q[0] && l[1] === q[1]) && !tryLava(q)) return false;
    }
    return true;
  };
  for (const p of pool) if (!enclose(items[p])) throw new Error('enclosure failed');
  const d0 = bfs(mz, [0, 0]);
  const pocketLen = (cells) => { // shortest route: start -> enough cells of the pocket (2 for full comp) -> exit
    const openCells = cells.filter((c) => d0[c[0]][c[1]] >= 0);
    if (openCells.length < 2) return Infinity;
    // try all pairs of cells in the pocket: min over orders of (start->a->b->exit) and (start->b->a->exit)
    let best = Infinity;
    for (const a of openCells) for (const b of openCells) {
      if (a === b) continue;
      const L = traceDist(mz, [0, 0], a) + traceDist(mz, a, b) + traceDist(mz, b, GOAL);
      if (L < best) best = L;
    }
    return best;
  };
  const lens = open.map((p) => ({ p, len: pocketLen(items[p]) }));
  if (lens.some((l) => l.len === Infinity)) throw new Error('open pocket unreachable');
  const maxLen = Math.max(...lens.map((l) => l.len));
  const budget = maxLen + 2;
  // conflict check (036/037-corrected): the minimum route collecting the FULL component (2 distinct
  // cells) of TWO open pockets, over all cell choices AND both visitation orders; pockets are 3 cells
  // so the search is tiny. Also check the same for pocket+joint via exact enumeration.
  const twoBest = (() => {
    let best = Infinity;
    const orders = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => orders([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
      const ca = items[open[i]], cb = items[open[j]];
      // choose 2 of 3 cells from each pocket (the component saturates at 2), visit all 4 in any order
      for (const sa of orders(ca)) for (const sb of orders(cb)) {
        for (const takeA of [2, 1]) for (const takeB of [2, 1]) {
          const seq = [...sa.slice(0, takeA), ...sb.slice(0, takeB)];
          for (const perm of orders(seq)) {
            let L = 0, cur = [0, 0], ok = true;
            for (const c of perm) { const d = traceDist(mz, cur, c); if (d === Infinity) { ok = false; break; } L += d; cur = c; }
            if (!ok) continue;
            const dExit = traceDist(mz, cur, GOAL);
            if (dExit === Infinity) continue;
            const total = L + dExit;
            if (total < best) best = total;
          }
        }
      }
    }
    return best;
  })();
  Object.assign(mz, { budget, lens, twoBest });
  if (twoBest <= budget) throw new Error('two pockets fit the budget, no conflict');
  if (budget > 40 || budget < 14) throw new Error('budget out of range');
  return mz;
}

// ---- reward vector: [exit, item1..item4, noLava], item comp = min(1, own/2); paper contract (no exit => all zeros)
function rewardVec9(exit, own, lavaHit) {
  if (!exit) return Array(DIST).fill(0);
  const v = [1];
  for (let p = 0; p < 4; p++) v.push(Math.min(1, own[p] / 2));
  v.push(1 - lavaHit);
  return v;
}

// ---- one route with per-pocket pickups; obs flags: item coverage from earlier candidates or this route
// Feature layout (pinned, executable assertions below): [0]=x/(N-1), [1]=y/(N-1),
// [2..5]=GLOBAL pocket flags (pocket id order 0..3, NOT open-subset order),
// [6..86]=item map pocket0, [87..167]=pocket1, [168..248]=pocket2, [249..329]=pocket3,
// [330..410]=lava map. FDIM9 = 6 + 81*5 = 411. (A9a had maps at offset 4, overlapping flags - fixed.)
const FDIM9 = 6 + 81 * 5;
const MAP0 = 6;
function features9(x, y, flags, mz) {
  if (flags.length !== 4) throw new Error('flags must be global-indexed length 4');
  const v = new Float32Array(FDIM9);
  v[0] = x / (N - 1); v[1] = y / (N - 1);
  for (let p = 0; p < 4; p++) v[2 + p] = flags[p] ? 1 : 0;
  for (let p = 0; p < 4; p++) for (const c of mz.pockets[p]) v[MAP0 + p * 81 + c[0] * N + c[1]] = 1;
  for (const c of mz.lava) v[MAP0 + 4 * 81 + c[0] * N + c[1]] = 1;
  return v;
}
function route9(mz, pol, rng, explore, eps, flagsIn) {
  // flagsIn is indexed by GLOBAL pocket id (length 4), never by open-subset position
  let [r, c] = [0, 0];
  let lavaHit = 0, exit = 0;
  const own = [0, 0, 0, 0];
  const taken = new Set(); // distinct item cells collected this route (revisits do not re-count)
  const take = (x, y) => {
    const key = x * N + y;
    if (taken.has(key)) return;
    for (let p = 0; p < 4; p++) if (mz.pockets[p].some((q) => q[0] === x && q[1] === y)) { own[p]++; taken.add(key); }
  };
  take(0, 0);
  const steps = [];
  for (let t = 0; t < mz.budget; t++) {
    const f = [0, 1, 2, 3].map((p) => (flagsIn[p] || own[p] > 0) ? 1 : 0); // global pocket flags, fixed length 4
    const obs = features9(r, c, f, mz);
    const p = pol.probs(obs);
    let a;
    if (!explore) { a = 0; for (let j = 1; j < 4; j++) if (p[j] > p[a]) a = j; }
    else { if (rng.next() < eps) a = rng.int(4); else { let u = rng.next(), j = 0; for (; j < 3; j++) { u -= p[j]; if (u < 0) break; } a = j; } }
    steps.push({ obs, a });
    const nr = r + (a === 0 ? 1 : a === 2 ? -1 : 0), nc = c + (a === 1 ? 1 : a === 3 ? -1 : 0);
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
    r = nr; c = nc; take(r, c);
    if (mz.lava.some((l) => l[0] === r && l[1] === c)) { lavaHit = 1; break; }
    if (r === GOAL[0] && c === GOAL[1]) { exit = 1; break; }
  }
  return { vec: rewardVec9(exit, own, lavaHit), steps, flagsEnd: [0, 1, 2, 3].map((p) => (own[p] > 0 ? 1 : 0)) }; // global-indexed, length 4
}
function chain9(mz, pol, rng, explore, eps, m) {
  const out = []; const flags = [0, 0, 0, 0]; // global pocket flags
  for (let j = 0; j < m; j++) { const rt = route9(mz, pol, rng, explore, eps, flags); out.push(rt); for (let p = 0; p < 4; p++) flags[p] = Math.max(flags[p], rt.flagsEnd[p]); }
  return out;
}
function dirichlet(rng, d) { const w = []; let s = 0; for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; } return w.map((x) => x / s); }

// ---- planner: per-open-pocket routes (nearest-neighbor over the pocket's cells) + direct
function plan9(mz) {
  const routes = [];
  const walkVec = (path) => { // same collection semantics as route9: distinct cells counted once
    let lavaHit = 0, exit = 0; const own = [0, 0, 0, 0];
    const taken = new Set();
    for (const [r, c] of path) {
      if (mz.lava.some((l) => l[0] === r && l[1] === c)) { lavaHit = 1; break; }
      const key = r * N + c;
      if (!taken.has(key)) { for (let p = 0; p < 4; p++) if (mz.pockets[p].some((q) => q[0] === r && q[1] === c)) { own[p]++; taken.add(key); } }
      if (r === GOAL[0] && c === GOAL[1]) { exit = 1; break; }
    }
    return rewardVec9(exit, own, lavaHit);
  };
  const trace = (D, from, to) => {
    if (D[to[0]][to[1]] < 0) return null;
    const p = []; let c = to.slice();
    while (!(c[0] === from[0] && c[1] === from[1])) {
      p.push(c); let best = null;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const r = c[0] + dr, cc = c[1] + dc; if (r < 0 || r >= N || cc < 0 || cc >= N) continue; if (D[r][cc] === D[c[0]][c[1]] - 1) { best = [r, cc]; break; } }
      if (!best) return null; c = best;
    }
    p.push(from.slice());
    return p.reverse();
  };
  const direct = trace(bfs(mz, [0, 0]), [0, 0], GOAL);
  if (direct) routes.push(direct);
  for (const p of mz.open) {
    const cells = mz.pockets[p].filter((c) => bfs(mz, [0, 0])[c[0]][c[1]] >= 0);
    // best pair by total length (2 cells give the full component)
    let bestPath = null, bestL = Infinity;
    for (const a of cells) for (const b of cells) {
      if (a === b) continue;
      const p1 = trace(bfs(mz, [0, 0]), [0, 0], a), p2 = trace(bfs(mz, a), a, b), p3 = trace(bfs(mz, b), b, GOAL);
      if (!p1 || !p2 || !p3) continue;
      const L = p1.length + p2.length + p3.length - 3;
      if (L <= mz.budget && L < bestL) { bestL = L; bestPath = p1.concat(p2.slice(1), p3.slice(1)); } // (037 fix: slice(0,-0) is empty and dropped the start->pocket leg)
    }
    if (bestPath) routes.push(bestPath);
  }
  const seen = new Set();
  return routes.filter((p) => { const k = p.map((c) => c.join(',')).join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((p) => ({ path: p, vec: walkVec(p) }));
}

// ---- base BC (mixture incl. chain contexts), same recipe as A6 (Adam 0.01, 80 passes)
function buildBase9(seed, trainMazes, bc) {
  const net = RLA.nn.mlp({ sizes: [FDIM9, 16, 4], act: 'tanh', rng: rngMake(seed * 7 + 1), outScale: 0.01 });
  const opt = RLA.nn.adam(net, { lr: bc.lr });
  const probs = (obs) => { const z = Array.from(net.forward(obs)); let m = -Infinity; for (const x of z) m = Math.max(m, x); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  const data = [];
  const walkDemo = (mz, path, flagsIn) => { // flagsIn: global pocket flags (length 4)
    let [r, c] = [0, 0]; const own = [0, 0, 0, 0];
    const taken = new Set();
    const take = (x, y) => { const key = x * N + y; if (taken.has(key)) return; for (let p = 0; p < 4; p++) if (mz.pockets[p].some((q) => q[0] === x && q[1] === y)) { own[p]++; taken.add(key); } };
    take(0, 0);
    const seq = [];
    for (let i = 1; i < path.length; i++) {
      const f = [0, 1, 2, 3].map((p) => (flagsIn[p] || own[p] > 0) ? 1 : 0);
      seq.push({ obs: features9(r, c, f, mz), a: actionOf(path[i - 1], path[i]) });
      const [nr, nc] = path[i]; r = nr; c = nc; take(r, c);
      if (mz.lava.some((l) => l[0] === r && l[1] === c)) break;
      if (r === GOAL[0] && c === GOAL[1]) break;
    }
    return { seq, flagsEnd: [0, 1, 2, 3].map((p) => (own[p] > 0 ? 1 : 0)) };
  };
  const actionOf = (a, b) => (b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : 3);
  const demos = [];
  for (const mz of trainMazes) for (const r of plan9(mz)) demos.push({ mz, path: r.path });
  for (const { mz, path } of demos) {
    const w1 = walkDemo(mz, path, [0, 0, 0, 0]);
    for (const s of w1.seq) data.push(s);
    if (w1.flagsEnd.some((x) => x)) {
      const alt = plan9(mz).find((r) => r.path !== path);
      if (alt) { const w2 = walkDemo(mz, alt.path, w1.flagsEnd); for (const s of w2.seq) data.push(s); }
    }
  }
  let bcLoss = 0;
  for (let e = 0; e < bc.epochs; e++) {
    const B = data.length;
    const XX = new Float32Array(B * FDIM9); const AA = new Int32Array(B);
    data.forEach((d, i) => { XX.set(d.obs, i * FDIM9); AA[i] = d.a; });
    const Z = net.forwardBatch(XX, B);
    const dZ = new Float32Array(B * 4);
    bcLoss = 0;
    for (let i = 0; i < B; i++) {
      let m = -Infinity; for (let j = 0; j < 4; j++) m = Math.max(m, Z[i * 4 + j]);
      const ex = []; let s = 0;
      for (let j = 0; j < 4; j++) { ex.push(Math.exp(Z[i * 4 + j] - m)); s += ex[j]; }
      for (let j = 0; j < 4; j++) ex[j] /= s;
      bcLoss -= Math.log(ex[AA[i]] + 1e-12);
      for (let j = 0; j < 4; j++) dZ[i * 4 + j] = (ex[j] - (j === AA[i] ? 1 : 0)) / B;
    }
    net.backwardBatch(dZ); opt.step();
  }
  return { net, nDemo: data.length, bcLoss: bcLoss / data.length };
}

// ---- fine-tuning arms (same math as production finetune, adapted to the 6-dim world)
function finetune9(baseNet, seed, method, trainMazes, updates, lr, eps, m, K, G) {
  const rng = rngMake(seed * 1000 + 17);
  const net = RLA.nn.mlp({ sizes: [FDIM9, 16, 4], act: 'tanh', rng: rngMake(1), outScale: 0 });
  net.params.forEach((p, i) => p.set(baseNet.params[i]));
  const opt = RLA.nn.adam(net, { lr });
  const probs = (obs) => { const z = Array.from(net.forward(obs)); let m = -Infinity; for (const x of z) m = Math.max(m, x); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  for (let u = 1; u <= updates; u++) {
    const mz = trainMazes[u % trainMazes.length];
    const draws = method === 'vpo' ? Array.from({ length: K }, () => dirichlet(rng, DIST)) : null;
    const group = [];
    for (let g = 0; g < G; g++) {
      if (method === 'grpo-single') {
        const rt = route9(mz, { probs }, rng, true, eps, [0, 0, 0, 0]);
        group.push({ routes: [rt], R: setRewardMean([rt.vec], [WSTAR6]) });
      } else {
        const routes = chain9(mz, { probs }, rng, true, eps, m);
        group.push({ routes, R: setRewardMean(routes.map((r) => r.vec), draws) });
      }
    }
    const ADVs = groupAdv(group.map((x) => x.R));
    const S = [], A = [], ADV = [];
    for (let gi = 0; gi < group.length; gi++) {
      for (const rt of group[gi].routes) for (const st of rt.steps) { S.push(st.obs); A.push(st.a); ADV.push(ADVs[gi]); }
    }
    const B = S.length;
    const XX = new Float32Array(B * FDIM9); S.forEach((o, i) => XX.set(o, i * FDIM9));
    const Z = net.forwardBatch(XX, B);
    const dZ = new Float32Array(B * 4);
    for (let i = 0; i < B; i++) {
      let m2 = -Infinity; for (let j = 0; j < 4; j++) m2 = Math.max(m2, Z[i * 4 + j]);
      const ex = []; let s = 0;
      for (let j = 0; j < 4; j++) { ex.push(Math.exp(Z[i * 4 + j] - m2)); s += ex[j]; }
      for (let j = 0; j < 4; j++) ex[j] /= s;
      const iw = mixIW(ex[A[i]], eps, 4);
      for (let j = 0; j < 4; j++) dZ[i * 4 + j] = -ADV[i] * iw * ((j === A[i] ? 1 : 0) - ex[j]) / B;
    }
    net.backwardBatch(dZ); opt.step();
  }
  return probs;
}

// ---- evaluation: fresh chains, first-k in chain order (identical code for all arms)
function evaluate9(probs, testMazes, seed, m) {
  const rng = rngMake(seed * 7919 + 5);
  const eps = 0.05, REPS = 30;
  const ks = [1, 2, 4, 8, 16, 30];
  const perProblem = [];
  for (let pi = 0; pi < testMazes.length; pi++) {
    const mz = testMazes[pi];
    const sums = {}; ks.forEach((k) => sums[k] = 0);
    let L1 = 0, np = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const vecs = [];
      if (probs.single) { for (let i = 0; i < 30; i++) vecs.push(route9(mz, { probs }, rng, true, eps, [0, 0, 0, 0]).vec); }
      else { const nChains = Math.ceil(30 / m); const got = []; for (let c2 = 0; c2 < nChains && got.length < 30; c2++) for (const rt of chain9(mz, { probs }, rng, true, eps, m)) { if (got.length < 30) got.push(rt.vec); } vecs.push(...got); }
      for (const k of ks) { let mx = -1; for (let i = 0; i < k; i++) { const s = dot(WSTAR6, vecs[i]); if (s > mx) mx = s; } sums[k] += mx; }
      for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { let d = 0; for (let q = 0; q < DIST; q++) d += Math.abs(vecs[i][q] - vecs[j][q]); L1 += d; np++; }
    }
    const best = {}; for (const k of ks) best[k] = sums[k] / REPS;
    perProblem.push({ problem: pi, best, spread: L1 / np });
  }
  const agg = {}; ks.forEach((k) => agg[k] = 0); let sp = 0;
  for (const p of perProblem) { for (const k of ks) agg[k] += p.best[k]; sp += p.spread; }
  for (const k of ks) agg[k] /= testMazes.length;
  return { perProblem, mean: agg, spread: sp / testMazes.length };
}

// ---- protocol A9 (frozen)
const MODE9 = process.argv[2] || 'frozen';
const PROTO9 = {
  mode: MODE9,
  seeds: MODE9 === 'smoke' ? [2] : [1, 3, 5, 7, 9],
  updates: MODE9 === 'smoke' ? 3 : 12000,
  trainSeeds: Array.from({ length: 96 }, (_, i) => 1000 + i),
  testSeeds: Array.from({ length: 8 }, (_, i) => 2000 + i),
  m: 3, K: 8, G_single: 12, G_chain: 4,
  lr: 0.003, eps: 0.15, evalEps: 0.05,
  bc: { lr: 0.01, epochs: 80 },
  net: { sizes: [FDIM9, 16, 4], act: 'tanh' },
  kValues: [1, 2, 4, 8, 16, 30],
  evalReps: 30,
  arms: ['base', 'grpo-single', 'vpo'],
  dist: DIST, wstar: WSTAR6,
  contract: 'paper (no exit => all-zero vector)',
  note: 'A9 environment change: 4 item pockets, seeded open subset (2-3), budget fits at most one full pocket; all arms same observations/architecture, matched 12000x12 candidate budgets, fixed uniform deployment score',
};

const OUT = process.argv[3] || '/tmp/vpo-a9.json';
if (require.main !== module) { module.exports = { makeMaze, plan9, route9, chain9, features9, rewardVec9, FDIM9, buildBase9, finetune9, evaluate9, PROTO9, DIST, WSTAR6 }; }
else {
const T_CAP = 30 * 60 * 1000, T0 = Date.now();
const trainMazes = PROTO9.trainSeeds.map(makeMaze);
const testMazes = PROTO9.testSeeds.map(makeMaze);
const out = { protocol: PROTO9, mazes: { train: trainMazes.map((m) => ({ open: m.open, budget: m.budget })), test: testMazes.map((m) => ({ open: m.open, budget: m.budget })) }, runs: [] };
for (const seed of PROTO9.seeds) {
  if (Date.now() - T0 > T_CAP) { out.aborted = 'wall cap 30 min exceeded'; console.error(out.aborted); fs.writeFileSync(OUT, JSON.stringify(out)); process.exit(2); }
  const t0 = Date.now();
  const b = buildBase9(seed, trainMazes, PROTO9.bc);
  const mkEval = (netParams, single) => {
    const net = RLA.nn.mlp({ sizes: [FDIM9, 16, 4], act: 'tanh', rng: rngMake(1), outScale: 0 });
    net.params.forEach((p, i) => p.set(netParams[i]));
    const probs = (obs) => { const z = Array.from(net.forward(obs)); let m = -Infinity; for (const x of z) m = Math.max(m, x); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b2) => a + b2, 0); return e.map((x) => x / s); };
    return single ? { probs, single: true } : { probs };
  };
  const arms = { base: mkEval(b.net.params, false) };
  arms['grpo-single'] = { probs: finetune9(b.net, seed, 'grpo-single', trainMazes, PROTO9.updates, PROTO9.lr, PROTO9.eps, 1, PROTO9.K, PROTO9.G_single), single: true };
  arms['vpo'] = { probs: finetune9(b.net, seed, 'vpo', trainMazes, PROTO9.updates, PROTO9.lr, PROTO9.eps, PROTO9.m, PROTO9.K, PROTO9.G_chain) };
  const res = { seed, ms: Date.now() - t0, bc: { nDemo: b.nDemo, bcLoss: b.bcLoss }, arms: {} };
  for (const name of PROTO9.arms) {
    const e = evaluate9(arms[name].probs, testMazes, seed, PROTO9.m);
    res.arms[name] = { mean: e.mean, spread: e.spread, perProblem: e.perProblem };
  }
  out.runs.push(res);
  console.error('seed', seed, 'done in', ((Date.now() - t0) / 60000).toFixed(1), 'min');
  fs.writeFileSync(OUT, JSON.stringify(out));
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT);
for (const name of PROTO9.arms) {
  const line = (k) => out.runs.map((r) => r.arms[name].mean[k].toFixed(3)).join(',');
  console.log(name, 'best1', line('1'), 'best30', line('30'), 'spread', out.runs.map((r) => r.arms[name].spread.toFixed(2)).join(','));
}
}
