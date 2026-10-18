// Headless VPO validation experiment (predeclared): does scalar multi-answer training collapse
// the candidate pool while VPO training keeps it spread, with a fixed-score best-of-k gain?
// World: 9x9 open grid, start corner (0,0), exit (8,8), gold cluster near the free corner (8,0),
// diamonds near (0,8), lava cells in the interior. Step budget per route. No route can collect
// both corners and exit within the budget (checked); a collinear map places both clusters on one
// detour so one route can (the no-benefit condition).
// Learner: tabular softmax over (cell, goldSeen, diamSeen, candidate index). Candidate j of an
// episode is drawn CONDITIONED on what candidates 1..j-1 collected (the flags). Group-relative
// credit: the whole chain is pushed by the set reward minus the group mean. The scalar method
// scores the set with max_i (w* dot r_i), w* uniform; VPO with mean_k max_i (w_k dot r_i), the
// same Dirichlet(1) draws shared across the group. No anti-duplicate reward, no scripting.
//
// Usage: node exp/vpo-headless.js [updates] [out.json]
'use strict';
const fs = require('fs');

// mulberry32 (same as src/core/rng.js)
function rngMake(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n) };
}

const N = 9, GOAL = [8, 8], GC = [8, 0], DC = [0, 8]; // start (0,0), exit, gold corner, diamond corner
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// ---- maze construction (seeded). Trade-off map: budget fits one detour, never both.
function makeMaze(seed, collinear) {
  const rng = rngMake(seed);
  const lava = [];
  while (lava.length < 4) {
    const c = [1 + rng.int(7), 1 + rng.int(7)];
    if (lava.some((q) => q[0] === c[0] && q[1] === c[1])) continue;
    if (dist(c, GOAL) <= 2 || dist(c, GC) <= 2 || dist(c, DC) <= 2) continue; // keep corners usable
    lava.push(c);
  }
  const items = (corner, n) => {
    const cells = [];
    let guard = 0;
    while (cells.length < n && guard++ < 200) {
      const c = [corner[0] + (rng.int(5) - 2), corner[1] + (rng.int(5) - 2)];
      c[0] = Math.max(0, Math.min(N - 1, c[0])); c[1] = Math.max(0, Math.min(N - 1, c[1]));
      if (c[0] === GOAL[0] && c[1] === GOAL[1]) continue;
      if (lava.some((q) => q[0] === c[0] && q[1] === c[1])) continue;
      if (cells.some((q) => q[0] === c[0] && q[1] === c[1])) continue;
      cells.push(c);
    }
    return cells;
  };
  const gold = collinear ? items(GC, 3) : items(GC, 3);
  // one diamond cell sits as a short detour off the gold corridor, so a hybrid route (gold plus one
  // diamond) is the unique best route under the uniform weighting; the rest of the cluster stays far
  const diam = collinear ? items(GC, 3) : [[6, 3]].concat(items(DC, 2));
  const goldCorner = GC, diamCorner = collinear ? GC : DC;
  const viaG = dist([0, 0], goldCorner) + dist(goldCorner, GOAL);
  const viaD = dist([0, 0], diamCorner) + dist(diamCorner, GOAL);
  const viaBoth = collinear ? viaG : dist([0, 0], GC) + dist(GC, DC) + dist(DC, GOAL);
  // the hybrid detour (gold corridor plus the outlier diamond at (6,3)) must fit the budget
  const budget = Math.max(viaG, viaD) + 6; // slack 6: fits one corner detour with item pickups, still never both (via_both > budget, checked below)
  // a route may collect at most nGoldCluster items per cluster; cluster membership by distance<=2 of the corner
  const reachable = (from) => { // BFS avoiding lava, distances from 'from'
    const D = Array.from({ length: N }, () => Array(N).fill(-1)); D[from[0]][from[1]] = 0;
    const q = [from];
    while (q.length) {
      const c = q.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = c[0] + dr, cc = c[1] + dc;
        if (r < 0 || r >= N || cc < 0 || cc >= N || D[r][cc] !== -1) continue;
        if (lava.some((l) => l[0] === r && l[1] === cc)) continue;
        D[r][cc] = D[c[0]][c[1]] + 1; q.push([r, cc]);
      }
    }
    return D;
  };
  const D0 = reachable([0, 0]);
  const onRoute = (cells, corner) => cells.filter((c) => D0[c[0]][c[1]] >= 0 && dist(c, corner) <= 2).length;
  return { lava, gold, diam, budget, collinear, viaBoth, viaG, viaD, nGold: onRoute(gold, goldCorner), nDiam: onRoute(diam, diamCorner), D0 };
}

// ---- one route: greedy/sampled walk, returns reward vector [exit, gold, diamond, noLava]
function route(maze, pol, rng, explore, flags, candIdx) {
  let [r, c] = [0, 0];
  let gold = 0, diam = 0, lavaHit = 0, exit = 0;
  const trail = [[0, 0]];
  const cellKey = (x, y, f) => ((x * N + y) * 4 + f) * 4; // f: 0..3 coverage flags (real conditioning on earlier candidates)
  const take = (x, y) => {
    for (const q of maze.gold) if (q[0] === x && q[1] === y) gold++;
    for (const q of maze.D0 ? maze.gold : []) {} // no-op
    for (const q of maze.diam) if (q[0] === x && q[1] === y) diam++;
  };
  take(0, 0);
  const steps = [];
  for (let t = 0; t < maze.budget; t++) {
    const f = (gold > 0 ? 1 : 0) + (diam > 0 ? 2 : 0);
    const key = cellKey(r, c, f);
    const a = pol.act(key, explore, rng);
    steps.push([key, a]);
    const nr = r + (a === 0 ? 1 : a === 2 ? -1 : 0), nc = c + (a === 1 ? 1 : a === 3 ? -1 : 0);
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
    r = nr; c = nc; trail.push([r, c]);
    take(r, c);
    if (maze.lava.some((l) => l[0] === r && l[1] === c)) { lavaHit = 1; break; }
    if (r === GOAL[0] && c === GOAL[1]) { exit = 1; break; }
  }
  const vec = [exit, Math.min(1, gold / 2), Math.min(1, diam / 2), 1 - lavaHit];
  return { vec, steps, trail, flagsEnd: [(gold > 0 ? 1 : 0), (diam > 0 ? 1 : 0)] };
}

// ---- tabular softmax policy
const NST = N * N * 4 * 4; // cells x coverage flags x 4 actions
function makePolicy(rng) {
  const th = new Float64Array(NST);
  for (let i = 0; i < NST; i++) th[i] = (rng.next() - 0.5) * 0.01;
  const buf = new Float64Array(4);
  const probs = (key) => {
    let m = -Infinity; for (let j = 0; j < 4; j++) m = Math.max(m, th[key + j]);
    let s = 0; for (let j = 0; j < 4; j++) { buf[j] = Math.exp(th[key + j] - m); s += buf[j]; }
    for (let j = 0; j < 4; j++) buf[j] /= s;
    return buf;
  };
  return {
    act(key, explore, rng) {
      const p = probs(key);
      if (!explore) { let b = 0; for (let j = 1; j < 4; j++) if (p[j] > p[b]) b = j; return b; }
      const EPS = 0.15; // eps-soft sampling: keeps every move reachable while the chain reward is still far away
      if (rng.next() < EPS) return rng.int(4);
      let u = rng.next(), j = 0; for (; j < 3; j++) { u -= p[j]; if (u < 0) break; }
      return j;
    },
    probs,
    th,
  };
}

// ---- Dirichlet(1) draw: 4 iid exponentials normalized
function dirichlet(rng, d) {
  const w = []; let s = 0;
  for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; }
  return w.map((x) => x / s);
}
const dot = (w, v) => w.reduce((s, x, i) => s + x * v[i], 0);

// ---- training run
function train({ seed, method, updates, lr, m, K, trainMazes, testMazes, poolChains }) {
  const rng = rngMake(seed * 1000 + 3);
  const pol = makePolicy(rng);
  const wStar = [0.25, 0.25, 0.25, 0.25];
  const log = [];
  const chainsOf = (maze) => {
    // one episode = m candidates, each conditioned on the flags left by the earlier ones
    const routes = [];
    let flags = [0, 0];
    for (let j = 0; j < m; j++) {
      const rt = route(maze, pol, rng, true, flags, j);
      routes.push(rt);
      flags = [Math.max(flags[0], rt.flagsEnd[0]), Math.max(flags[1], rt.flagsEnd[1])];
    }
    return routes;
  };
  const setReward = (vecs, ws) => ws.map((w) => Math.max(...vecs.map((v) => dot(w, v))));
  for (let u = 1; u <= updates; u++) {
    const maze = trainMazes[u % trainMazes.length];
    const draws = method === 'vpo' ? Array.from({ length: K }, () => dirichlet(rng, 4)) : null;
    const group = [];
    for (let g = 0; g < 4; g++) {
      const routes = chainsOf(maze);
      const vecs = routes.map((r) => r.vec);
      const per = method === 'vpo' ? setReward(vecs, draws) : setReward(vecs, [wStar]);
      group.push({ routes, vecs, R: per.reduce((s, x) => s + x, 0) / per.length });
    }
    const mean = group.reduce((s, x) => s + x.R, 0) / 4;
    const std = Math.sqrt(group.reduce((s, x) => s + (x.R - mean) * (x.R - mean), 0) / 4);
    for (const ep of group) {
      const adv = (ep.R - mean) / (std + 1e-6);
      for (const rt of ep.routes) for (const [key, a] of rt.steps) {
        const p = pol.probs(key);
        let Hn = 0; for (let j = 0; j < 4; j++) Hn -= p[j] * Math.log(p[j] + 1e-12);
        for (let j = 0; j < 4; j++) pol.th[key + j] += lr * (adv * ((j === a ? 1 : 0) - p[j]) + BONUS * p[j] * (Math.log(p[j] + 1e-12) + Hn));
      }
    }
    if (u % 100 === 0 || u === updates) {
      log.push(measure(pol, { testMazes, poolChains, m, wStar, rng }));
    }
  }
  return { log, pol };
}

// ---- measurement: greedy chain fixed score; pool spread and best-of-k from SAMPLED routes
function measure(pol, { testMazes, poolChains, m, wStar, rng }) {
  let greedy = 0;
  for (const maze of testMazes) {
    let flags = [0, 0];
    const vecs = [];
    for (let j = 0; j < m; j++) { const rt = route(maze, pol, rng, false, flags, j); vecs.push(rt.vec); flags = [Math.max(flags[0], rt.flagsEnd[0]), Math.max(flags[1], rt.flagsEnd[1])]; }
    greedy += Math.max(...vecs.map((v) => dot(wStar, v)));
  }
  greedy /= testMazes.length;
  // pool: sampled routes from independent chains, identical code for both methods
  const pool = [];
  for (let c = 0; c < poolChains; c++) {
    const maze = testMazes[c % testMazes.length];
    let flags = [0, 0];
    for (let j = 0; j < m; j++) { const rt = route(maze, pol, rng, true, flags, j); pool.push(rt.vec); flags = [Math.max(flags[0], rt.flagsEnd[0]), Math.max(flags[1], rt.flagsEnd[1])]; }
  }
  const scores = pool.map((v) => dot(wStar, v));
  const bestOf = (k) => { // E[max of k routes drawn from the pool], Monte Carlo over subsets
    let s = 0;
    const T = 200;
    for (let t = 0; t < T; t++) {
      let mx = -1;
      for (let q = 0; q < k; q++) { const v = scores[rng.int(scores.length)]; if (v > mx) mx = v; }
      s += mx;
    }
    return s / T;
  };
  // spread: mean pairwise L1 between route reward vectors in the pool
  let L1 = 0, np = 0;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) { let d = 0; for (let q = 0; q < 4; q++) d += Math.abs(pool[i][q] - pool[j][q]); L1 += d; np++; }
  return { greedy, best1: bestOf(1), best4: bestOf(4), best8: bestOf(8), spread: L1 / np };
}

// ---- predeclared protocol
const DBG = process.argv[6] === 'dbg';
const SEEDS = DBG ? [2, 4] : [1, 3, 5, 7, 9];
const UPDATES = parseInt(process.argv[2] || '2000', 10);
const M = 3, K = 8, LR = parseFloat(process.argv[4] || '0.08'), BONUS = parseFloat(process.argv[5] || '0'), POOL_CHAINS = 4;
const trainMazes = [11, 23, 37, 53].map((s) => makeMaze(s, false));
const testMazes = [101, 211, 307].map((s) => makeMaze(s, false));
// sanity: no route collects both clusters on a trade-off map
for (const mz of trainMazes.concat(testMazes)) {
  if (!mz.collinear && mz.viaBoth <= mz.budget) throw new Error('trade-off map allows both corners: seed ' + mz);
}
const collinearMaze = makeMaze(11, true);

const out = { protocol: { seeds: SEEDS, updates: UPDATES, m: M, K, lr: LR, poolChains: POOL_CHAINS, groupSize: 4, budget: 'max(viaG,viaD)+3' }, runs: {} };
for (const method of ['fixed', 'vpo']) {
  const runs = SEEDS.map((seed) => {
    const r = train({ seed, method, updates: UPDATES, lr: LR, m: M, K, trainMazes, testMazes, poolChains: POOL_CHAINS });
    const last = r.log[r.log.length - 1];
    const spreadStart = r.log[0].spread, spreadEnd = last.spread;
    return { seed, spreadStart, spreadEnd, last };
  });
  out.runs[method] = runs;
  const agg = (f) => runs.map(f);
  out.runs[method + '_agg'] = {
    spreadStart: agg((r) => r.spreadStart), spreadEnd: agg((r) => r.spreadEnd),
    best1: agg((r) => r.last.best1), best4: agg((r) => r.last.best4), best8: agg((r) => r.last.best8),
    greedy: agg((r) => r.last.greedy),
  };
}
// collinear no-benefit condition, one seed per method
out.collinear = {};
for (const method of ['fixed', 'vpo']) {
  const r = train({ seed: 1, method, updates: UPDATES, lr: LR, m: M, K, trainMazes: [collinearMaze], testMazes: [collinearMaze], poolChains: POOL_CHAINS });
  out.collinear[method] = r.log[r.log.length - 1];
}
const dst = process.argv[3] || 'exp/vpo-headless.out.json';
fs.writeFileSync(dst, JSON.stringify(out, null, 1));
console.log('wrote', dst);
for (const method of ['fixed', 'vpo']) {
  const a = out.runs[method + '_agg'];
  console.log(method, 'spread', a.spreadStart.map((x) => x.toFixed(2)).join(','), '->', a.spreadEnd.map((x) => x.toFixed(2)).join(','));
  console.log(method, 'best1', a.best1.map((x) => x.toFixed(3)).join(','), 'best4', a.best4.map((x) => x.toFixed(3)).join(','), 'best8', a.best8.map((x) => x.toFixed(3)).join(','), 'greedy', a.greedy.map((x) => x.toFixed(3)).join(','));
}
