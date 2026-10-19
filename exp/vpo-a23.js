// Base-policy crossover experiment (frozen protocol rev 3 in data/bb-vpo-design/base-regime-protocol.md).
// Variant (a): a navigation task distribution where the best route strategy varies by problem.
// Base = behavior cloning of a documented mixture of valid routes on TRAINING mazes only, including
// chain contexts (later candidates conditioned on earlier candidates' coverage).
// Arms: base (untouched clone), grpo-single (per-response scalar, one answer), vpo (chains, shared
// Dirichlet draws). Same fixed deployment score w* = uniform everywhere. best@k uses fresh chains
// and the FIRST k entries in chain order (paper Sec 4.3 style), never a sorted-pool shortcut.
// Policy: small MLP over a documented map representation (full item/lava maps + position + flags),
// so the problem context is available without any oracle regime label.
//
// Usage: node exp/vpo-base-regime.js frozen|smoke [outPath]
'use strict';
const fs = require('fs');
const path = require('path');
const RLA = globalThis.RLA = globalThis.RLA || {};
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
require(path.join(__dirname, '..', 'src', 'core', 'nn.js'));
const MODE = process.argv[2] || 'frozen';
const OUT = process.argv[3] || ('/tmp/vpo-br-' + MODE + '.json');

const rngMake = RLA.rng.make;
const N = 9, GOAL = [8, 8], GC = [8, 0], DC = [0, 8];
const HID = parseInt(process.env.VPO_HID || '64', 10); // A13: hidden width (was hard-coded 16)
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const dot = (w, v) => w.reduce((s, x, i) => s + x * v[i], 0);
const WSTAR = [0.25, 0.25, 0.25, 0.25];
// ---- pure production helpers (shared with exp/vpo-checks.js so the checker exercises THIS code)
const setRewardMean = (vecs, draws) => draws.map((w) => Math.max(...vecs.map((v) => dot(w, v)))).reduce((s, x) => s + x, 0) / draws.length;
const groupAdv = (vals) => { const m = vals.reduce((s, x) => s + x, 0) / vals.length; const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length); return vals.map((x) => (x - m) / (sd + 1e-6)); };
const mixProb = (pa, eps, nA) => (1 - eps) * pa + eps / nA;             // the eps-soft sampler's probability of action a
const mixIW = (pa, eps, nA) => (1 - eps) * pa / mixProb(pa, eps, nA);   // score weight of a mixture sample
const REWARD_CONTRACT = process.env.VPO_CONTRACT || 'legacy';           // 'legacy' | 'paper' (paper: no exit => all-zero vector, App A.1)
const rewardVec = (exit, gold, diam, lavaHit) => {
  if (REWARD_CONTRACT === 'paper' && !exit) return [0, 0, 0, 0];
  return [exit, Math.min(1, gold / 2), Math.min(1, diam / 2), 1 - lavaHit];
};
// A11b (per 051/052): production-faithful replay helper, shared by the planner and the guard.
// Distinct-cell collection (revisiting a collected item cell cannot inflate the reward vector),
// route truncated at the FIRST exit, fixed uniform deployment score w* = [0.25,0.25,0.25,0.25].
const replayVec = (mz, path) => {
  const gotGold = new Set(), gotDiam = new Set();
  let lavaHit = 0, exit = 0;
  for (const [r, c] of path) {
    if (mz.lava.some((l) => l[0] === r && l[1] === c)) { lavaHit = 1; break; }
    if (mz.gold.some((q) => q[0] === r && q[1] === c)) gotGold.add(r + ',' + c);
    if (mz.diam.some((q) => q[0] === r && q[1] === c)) gotDiam.add(r + ',' + c);
    if (r === GOAL[0] && c === GOAL[1]) { exit = 1; break; }
  }
  return rewardVec(exit, gotGold.size, gotDiam.size, lavaHit);
};
const truncExit = (path) => { // no route extends beyond the first exit
  const i = path.findIndex((c) => c[0] === GOAL[0] && c[1] === GOAL[1]);
  return i >= 0 ? path.slice(0, i + 1) : path;
};
const scoreOf = (mz, path) => dot(WSTAR, replayVec(mz, path)); // fixed uniform deployment score

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

// ---- regime-parameterized generator (pockets off-corridor; blocked pockets fully enclosed by lava)
const CORR = (() => { const cs = []; for (let i = 0; i < N; i++) { cs.push([i, 0]); cs.push([8, i]); cs.push([0, i]); cs.push([i, 8]); } return cs; })();
const onCorr = (c) => CORR.some((q) => q[0] === c[0] && q[1] === c[1]);
const GOLD_POOL = [[5, 2], [5, 3], [6, 2], [6, 3]];
const DIAM_POOL = [[2, 5], [3, 6], [4, 6]];
function makeMaze(seed) {
  // A22 named change (mechanism-led, per mechanism-note-a22.md): balanced two-task CONFLICT world.
  // Both pockets open in every maze; budget = twoBestSat - 1 (corrected saturation threshold), so
  // the candidate menu holds genuine tradeoffs. G (even seeds): A18-C-style gold-dominant geometry
  // (gold pool start-side, outlier diamond detour near the gold pocket). H (odd seeds): mirrored
  // geometry (diamond pool start-side, outlier gold detour near the diamond pocket; pools/outlier
  // mirrored across the main diagonal, barrier cells self-mirror). No enclosures, no D.
  const regime = seed % 2 === 0 ? 'G' : 'H';
  if (regime === 'H') { // A23: PHYSICAL main-diagonal cell mirror of the G maze for seed-1
    // (walls and items move to mirrored physical cells; gold/diamond LABELS kept). The transpose is
    // an exact graph isometry fixing START and GOAL, so budget/goldLen/diamLen/twoBestSat are
    // invariant. Unlike the A22 label swap, the two tasks' optimal routes are physically different
    // paths; the finite-menu joint-max evidence (a23-verify.out) shows no enumerated path jointly
    // achieves both maze tops - this rules out a shared fixed open-loop route among enumerated
    // candidates but does not prove no adaptive shared policy or no unenumerated route can solve both.
    const g = makeMaze(seed - 1); // even seed -> G
    const mir = (c) => [c[1], c[0]];
    return Object.assign({}, g, { lava: g.lava.map(mir), gold: g.gold.map(mir), diam: g.diam.map(mir), regime: 'H' });
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { return makeMazeOnce(seed, regime, attempt); } catch (e) { lastErr = e; }
  }
  throw new Error('no valid layout for seed ' + seed + ': ' + lastErr);
}
function makeMazeOnce(seed, regime, attempt) {
  const rng = rngMake(seed * 131 + attempt * 7919 + 3);
  const lava = [];
  const tryLava = (c) => {
    if (lava.some((q) => q[0] === c[0] && q[1] === c[1])) return false;
    if (onCorr(c) || (c[0] === 0 && c[1] === 0) || (c[0] === GOAL[0] && c[1] === GOAL[1])) return false;
    lava.push(c); return true;
  };
  if (regime !== 'D') for (let i = 2; i <= 4; i++) tryLava([i, 8 - i]); // anti-diagonal barrier: A/B/C and the A22 G/H conflict tasks (self-mirror cells)
  const pick = (pool, n) => { const p = pool.slice(); const out = []; while (out.length < n && p.length) out.push(p.splice(rng.int(p.length), 1)[0]); return out; };
  // H is a ROLE SWAP of G (not a cell mirror): the diamond pool takes G's start-side gold positions,
  // the gold pool takes G's far-side diamond positions, and the outlier GOLD sits at [6,4] - adjacent
  // to the start-side diamond pool exactly as G's outlier diamond sits adjacent to the gold pool.
  // This makes H's economical hybrid diamond-side ([1,0.5,1,1]@0.875), mirroring G's gold-side one.
  // A22 final construction (per 111): H is an EXACT LABEL SWAP of the corresponding G maze - the
  // same seeded layout with gold and diamond LABELS exchanged and all label-dependent derived fields
  // swapped consistently. Implementation: for odd seeds, build the G maze for seed-1, then swap the
  // gold/diam arrays (and only those labels; geometry, lava, budget, twoBestSat are identical by
  // construction). Every replayed path then exchanges reward components 1 and 2 with identical
  // exit/safety/length - asserted in the guard. No coordinate search.
  const gold = regime === 'H' ? pick(DIAM_POOL, 3) : pick(GOLD_POOL, 3);
  const diam = regime === 'G' ? [[6, 4]].concat(pick(DIAM_POOL, 2)) : regime === 'H' ? [[6, 4]].concat(pick(GOLD_POOL, 2)) : pick(DIAM_POOL, 3);
  const mz = { lava, gold, diam, regime };
  const enclose = (cells) => { // lava at every free neighbor; pockets never touch corridors by construction
    for (const c of cells) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = [c[0] + dr, c[1] + dc];
      if (q[0] < 0 || q[0] >= N || q[1] < 0 || q[1] >= N) continue;
      if (cells.some((z) => z[0] === q[0] && z[1] === q[1])) continue;
      if (!lava.some((l) => l[0] === q[0] && l[1] === q[1]) && !tryLava(q)) return false;
    }
    return true;
  };
  if (regime === 'A' && !enclose(diam)) throw new Error('A enclosure failed');
  if (regime === 'B' && !enclose(gold)) throw new Error('B enclosure failed');
  if (regime === 'D') { if (!enclose(gold) || !enclose(diam)) throw new Error('D enclosure failed'); }
  if (regime === 'D') { let extra = 2, gn = 0; while (extra > 0 && gn++ < 100) { const c = [rng.int(N), rng.int(N)]; if (tryLava(c)) extra--; } }
  const d0 = bfs(mz, [0, 0]);
  const routeLen = (cells) => { // exhaustive-min route collecting the FULL component (2 distinct cells)
    const open = cells.filter((c) => d0[c[0]][c[1]] >= 0);
    if (open.length < 2) return Infinity;
    const orders = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => orders([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
    let best = Infinity;
    for (const sa of orders(open)) for (const take of [2]) {
      const seq = sa.slice(0, take);
      for (const perm of orders(seq)) {
        let L = 0, cur = [0, 0], ok = true;
        for (const c of perm) { const d = traceDist(mz, cur, c); if (d === Infinity) { ok = false; break; } L += d; cur = c; }
        if (!ok) continue;
        const dExit = traceDist(mz, cur, GOAL);
        if (dExit === Infinity) continue;
        if (L + dExit < best) best = L + dExit;
      }
    }
    return best;
  };
  const goldLen = routeLen(gold), diamLen = routeLen(diam);
  const direct = traceDist(mz, [0, 0], GOAL);
  const bothLen = goldLen < Infinity && diamLen < Infinity ? routeLen(mz.gold.concat(mz.diam)) : Infinity; // full both-clusters chain
  const feasible = [goldLen, diamLen, direct].filter((x) => x < Infinity);
  const base = Math.max(...feasible);
  if ((regime === 'E' || regime === 'F') && !(goldLen === Infinity || diamLen === Infinity)) throw new Error('E/F requires exactly one closed family');
  // A10: corrected conflict threshold - the minimum route collecting the FULL component (2 distinct
  // cells) of BOTH pockets, over all 2-subsets and both visitation orders (the reward saturates at 2).
  const twoBestSat = regime === 'E' || regime === 'F' ? Infinity : (() => {
    let best = Infinity;
    const orders = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => orders([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
    for (const ca of [mz.gold, mz.diam]) {
      for (const cb of [mz.diam, mz.gold]) {
        if (ca === cb) continue;
        void cb;
      }
    }
    // proper enumeration over gold x diam pairs
    best = Infinity;
    for (const sa of orders(mz.gold)) for (const sb of orders(mz.diam)) {
      // both pockets at FULL component (2 distinct cells each): partial second-pocket pickup is the
      // intended C-regime hybrid, not a conflict violation (e.g. 2 gold + the outlier diamond).
      for (const takeA of [2]) for (const takeB of [2]) {
        const seq = [...sa.slice(0, takeA), ...sb.slice(0, takeB)];
        for (const perm of orders(seq)) {
          let L = 0, cur = [0, 0], ok = true;
          for (const c of perm) { const d = traceDist(mz, cur, c); if (d === Infinity) { ok = false; break; } L += d; cur = c; }
          if (!ok) continue;
          const dExit = traceDist(mz, cur, GOAL);
          if (dExit === Infinity) continue;
          if (L + dExit < best) best = L + dExit;
        }
      }
    }
    return best;
  })();
  const budget = Math.min(Math.min(base, 24) + 3, twoBestSat - 1); // keep the true conflict while maximizing slack
  Object.assign(mz, { goldLen, diamLen, bothLen, budget, direct, twoBestSat });
  const goldCells = mz.gold.filter((c) => d0[c[0]][c[1]] >= 0).length;
  const diamCells = mz.diam.filter((c) => d0[c[0]][c[1]] >= 0).length;
  if (direct === Infinity) throw new Error('exit unreachable');
  if (regime === 'A' && !(goldCells === 3 && diamCells === 0 && goldLen <= budget)) throw new Error('A constraints fail');
  if (regime === 'B' && !(diamCells === 3 && goldCells === 0 && diamLen <= budget)) throw new Error('B constraints fail');
  if (regime === 'C' && !(goldCells === 3 && diamCells === 3 && goldLen <= budget && diamLen <= budget && twoBestSat > budget)) throw new Error('C constraints fail (corrected threshold)');
  if ((regime === 'G' || regime === 'H') && !(goldCells === 3 && diamCells === 3 && goldLen <= budget && diamLen <= budget && twoBestSat > budget)) throw new Error((regime) + ' constraints fail (C-style corrected threshold)');
  if (regime === 'D' && !(goldCells === 0 && diamCells === 0)) throw new Error('D constraints fail');
  if (regime === 'E' && !(goldCells === 0 && diamCells === 3 && diamLen <= budget)) throw new Error('E constraints fail');
  if (regime === 'F' && !(diamCells === 0 && goldCells === 3 && goldLen <= budget)) throw new Error('F constraints fail');
  if (budget > 40 || budget < 18) throw new Error('budget out of range');
  return mz;
}

// ---- documented planner: route families on TRAINING mazes only (BFS legs + nearest-neighbor pickup)
function plan(mz) {
  const routes = [];
  const walkVec = (path) => replayVec(mz, path);
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
  const concat = (parts) => { const out = []; for (const p of parts) { if (!p) return null; for (const c of p) if (!out.length || out[out.length - 1][0] !== c[0] || out[out.length - 1][1] !== c[1]) out.push(c); } return out; };
  const viaCells = (cells, start, used0) => {
    const dStart = bfs(mz, start);
    const rem = cells.filter((c) => dStart[c[0]][c[1]] >= 0);
    const path = [start.slice()]; let cur = start.slice(), used = used0;
    while (rem.length) {
      rem.sort((a, b) => (dStart[a[0]][a[1]] + dist(a, GOAL)) - (dStart[b[0]][b[1]] + dist(b, GOAL)));
      const nxt = rem.shift();
      const seg = trace(bfs(mz, cur), cur, nxt);
      const dExit = traceDist(mz, nxt, GOAL);
      if (!seg || dExit === Infinity || used + (seg.length - 1) + dExit > mz.budget) break;
      path.push(...seg.slice(1)); used += seg.length - 1; cur = nxt;
    }
    const seg = trace(bfs(mz, cur), cur, GOAL);
    if (!seg) return null;
    path.push(...seg.slice(1));
    return path;
  };
  const d0 = bfs(mz, [0, 0]);
  const reachGold = mz.gold.filter((c) => d0[c[0]][c[1]] >= 0);
  const reachDiam = mz.diam.filter((c) => d0[c[0]][c[1]] >= 0);
  const direct = trace(d0, [0, 0], GOAL);
  if (direct) routes.push(direct);
  if (reachGold.length) { const p = viaCells(reachGold, [0, 0], 0); if (p && p.length - 1 <= mz.budget) routes.push(p); }
  if (reachDiam.length) { const p = viaCells(reachDiam, [0, 0], 0); if (p && p.length - 1 <= mz.budget) routes.push(p); }
  if (reachGold.length && reachDiam.length) { // gold first, then the nearest reachable diamond on the way out
    const g = viaCells(reachGold, [0, 0], 0);
    if (g && g.length - 1 <= mz.budget) {
      const cur = g[g.length - 1], used = g.length - 1;
      const dCur = bfs(mz, cur);
      const dets = reachDiam.map((c) => ({ c, d: dCur[c[0]][c[1]] >= 0 ? dCur[c[0]][c[1]] + traceDist(mz, c, GOAL) : Infinity })).sort((a, b) => a.d - b.d);
      if (dets.length && dets[0].d < Infinity && used + dets[0].d <= mz.budget) {
        const full = concat([g, trace(dCur, cur, dets[0].c), trace(bfs(mz, dets[0].c), dets[0].c, GOAL)]);
        if (full && full.length - 1 <= mz.budget) routes.push(full);
      }
    }
  }
  // A11 named change: augment the planner with the EXHAUSTIVE per-maze best routes (all orders over
  // reachable pocket cells, single-family full and the gold-then-diamond hybrid), train-only and
  // documented. Raises base competence so the crossover gate is tested against a stronger scalar.
  const exhaust = (() => {
    // A11b (per 051/052): deterministic scalar argmax over ALL enumerated candidates, each scored
    // by PRODUCTION replay (walkVec) with the fixed uniform deployment score. No alternate key,
    // no unseeded tie break: ties resolved by shorter route, then lexicographic cell key.
    const cands = [];
    const consider = (cellsA, cellsB) => {
      const orders = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => orders([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
      const seqsA = cellsA.length ? orders(cellsA) : [[]];
      const seqsB = cellsB.length ? orders(cellsB) : [[]];
      for (const sa of seqsA) for (const sb of seqsB) {
        const seq = [...sa, ...sb];
        for (const perm of orders(seq)) {
          let L = 0, cur = [0, 0], ok = true;
          const pts = [[0, 0]];
          for (const c of perm) { const d = traceDist(mz, cur, c); if (d === Infinity) { ok = false; break; } L += d; cur = c.slice(); pts.push(cur); }
          if (!ok) continue;
          const dExit = traceDist(mz, cur, GOAL);
          if (dExit === Infinity || L + dExit > mz.budget) continue;
          // rebuild full cell path via BFS traces
          const parts = []; let from = [0, 0];
          for (const c of [...perm, GOAL]) { const seg = trace(bfs(mz, from), from, c); if (!seg) { ok = false; break; } parts.push(seg); from = c.slice(); }
          if (!ok) continue;
          const full = truncExit(concat(parts));
          if (!full || full.length - 1 > mz.budget) continue;
          cands.push(full);
        }
      }
    };
    consider(reachGold, []); consider([], reachDiam); consider(reachGold, reachDiam);
    if (!cands.length) return null;
    let best = null, bestScore = -Infinity, bestKey = null;
    for (const p of cands) {
      const s = scoreOf(mz, p);
      const key = p.map((c) => c.join(',')).join('|');
      if (s > bestScore || (s === bestScore && ((p.length < best.length) || (p.length === best.length && key < bestKey)))) { bestScore = s; best = p; bestKey = key; }
    }
    // A11b guard: the selected route's replayed score equals the maximum over the enumerated set
    const maxScore = Math.max(...cands.map((p) => scoreOf(mz, p)));
    if (scoreOf(mz, best) !== maxScore) throw new Error('A11b planner guard: selected score ' + scoreOf(mz, best) + ' != enumerated max ' + maxScore);
    return best;
  })();
  if (exhaust) routes.push(exhaust);
  const seen = new Set();
  return routes.map(truncExit).filter((p) => p.length)
    .filter((p) => { const k = p.map((c) => c.join(',')).join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((p) => ({ path: p, vec: walkVec(p) }));
}

// ---- policy: MLP over a documented map representation (no oracle regime label)
// features: [x/N, y/N, goldSeen, diamSeen, goldMap(81 in {0,1}), diamMap(81), lavaMap(81)] = 247 dims
const FDIM = 4 + 81 * 3;
function features(x, y, flags, mz) {
  const v = new Float32Array(FDIM);
  v[0] = x / (N - 1); v[1] = y / (N - 1); v[2] = flags[0]; v[3] = flags[1];
  for (const c of mz.gold) v[4 + c[0] * N + c[1]] = 1;
  for (const c of mz.diam) v[4 + 81 + c[0] * N + c[1]] = 1;
  for (const c of mz.lava) v[4 + 162 + c[0] * N + c[1]] = 1;
  return v;
}
function makeNet(seed) {
  const rng = rngMake(seed);
  const net = RLA.nn.mlp({ sizes: [FDIM, HID, 4], act: 'tanh', rng, outScale: 0.01 });
  const opt = RLA.nn.adam(net, { lr: 0.003 });
  const logits = (obs) => Array.from(net.forward(obs));
  const probs = (obs) => {
    const z = logits(obs); let m = -Infinity; for (const x of z) m = Math.max(m, x);
    const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / s);
  };
  return { net, opt, logits, probs };
}

// one route: obs flags = (collected by earlier candidates OR by this route so far)
function route(mz, pol, rng, explore, eps, flagsIn) {
  let [r, c] = [0, 0];
  let lavaHit = 0, exit = 0;
  // A11b named correction: distinct-cell collection (per A9b semantics). Revisiting an already
  // collected item cell cannot inflate the reward vector; matches the planner's walkVec replay.
  const gotGold = new Set(), gotDiam = new Set();
  const take = (x, y) => { if (mz.gold.some((q) => q[0] === x && q[1] === y)) gotGold.add(x + ',' + y); if (mz.diam.some((q) => q[0] === x && q[1] === y)) gotDiam.add(x + ',' + y); };
  take(0, 0);
  const steps = [];
  for (let t = 0; t < mz.budget; t++) {
    const goldSeen = flagsIn[0] || gotGold.size > 0, diamSeen = flagsIn[1] || gotDiam.size > 0;
    const obs = features(r, c, [goldSeen ? 1 : 0, diamSeen ? 1 : 0], mz);
    const p = pol.probs(obs);
    let a;
    if (!explore) { a = 0; for (let j = 1; j < 4; j++) if (p[j] > p[a]) a = j; }
    else { if (rng.next() < eps) a = rng.int(4); else { let u = rng.next(), j = 0; for (; j < 3; j++) { u -= p[j]; if (u < 0) break; } a = j; } }
    steps.push({ obs, a, p: Array.from(p) });
    const nr = r + (a === 0 ? 1 : a === 2 ? -1 : 0), nc = c + (a === 1 ? 1 : a === 3 ? -1 : 0);
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
    r = nr; c = nc; take(r, c);
    if (mz.lava.some((l) => l[0] === r && l[1] === c)) { lavaHit = 1; break; }
    if (r === GOAL[0] && c === GOAL[1]) { exit = 1; break; }
  }
  return { vec: rewardVec(exit, gotGold.size, gotDiam.size, lavaHit), steps, flagsEnd: [gotGold.size > 0 ? 1 : 0, gotDiam.size > 0 ? 1 : 0] };
}
function chain(mz, pol, rng, explore, eps, m) {
  const out = []; let flags = [0, 0];
  for (let j = 0; j < m; j++) { const rt = route(mz, pol, rng, explore, eps, flags); out.push(rt); flags = [Math.max(flags[0], rt.flagsEnd[0]), Math.max(flags[1], rt.flagsEnd[1])]; }
  return out;
}
function dirichlet(rng, d) { const w = []; let s = 0; for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; } return w.map((x) => x / s); }

// ---- base: behavior cloning on the documented route mixture, INCLUDING chain contexts.
// For every training maze the planner emits its route families; demos are generated for every
// ordered pair (first route, second route) of distinct families plus the single-family routes, so
// candidate contexts with flags (1,0), (0,1), (1,1) are covered by real demonstrated behavior.
function buildBase(seed, trainMazes, bc) {
  const pol = makeNet(seed * 7 + 1);
  const demos = []; // {mz, path}
  for (const mz of trainMazes) for (const r of plan(mz)) demos.push({ mz, path: r.path });
  const data = []; // {obs, a}
  const walk = (mz, path, flagsIn) => {
    let [r, c] = [0, 0];
    const gotGold = new Set(), gotDiam = new Set(); // A11b: distinct-cell collection (per A9b)
    const take = (x, y) => { if (mz.gold.some((q) => q[0] === x && q[1] === y)) gotGold.add(x + ',' + y); if (mz.diam.some((q) => q[0] === x && q[1] === y)) gotDiam.add(x + ',' + y); };
    take(0, 0);
    const seq = [];
    for (let i = 1; i < path.length; i++) {
      const goldSeen = flagsIn[0] || gotGold.size > 0, diamSeen = flagsIn[1] || gotDiam.size > 0;
      seq.push({ obs: features(r, c, [goldSeen ? 1 : 0, diamSeen ? 1 : 0], mz), a: actionOf(path[i - 1], path[i]) });
      const [nr, nc] = path[i]; r = nr; c = nc; take(r, c);
      if (mz.lava.some((l) => l[0] === r && l[1] === c)) break;
      if (r === GOAL[0] && c === GOAL[1]) break;
    }
    return { seq, flagsEnd: [gotGold.size > 0 ? 1 : 0, gotDiam.size > 0 ? 1 : 0] };
  };
  const actionOf = (a, b) => (b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : 3);
  for (const { mz, path } of demos) {
    const w1 = walk(mz, path, [0, 0]);
    for (const s of w1.seq) data.push(s);
    // A12 named change: chain-context demos for EVERY distinct alternative route (all ordered pairs),
    // not just the first other family, so flags (1,0), (0,1), (1,1) contexts are fully covered.
    if (w1.flagsEnd[0] || w1.flagsEnd[1]) {
      for (const alt of demos.filter((d) => d.mz === mz && d.path !== path)) {
        const w2 = walk(mz, alt.path, w1.flagsEnd);
        for (const s of w2.seq) data.push(s);
      }
    }
  }
  for (let e = 0; e < bc.epochs; e++) {
    // one gradient pass over all demo steps (cross-entropy on the demonstrated action)
    const B = data.length;
    const X = new Float32Array(B * FDIM); const A = new Int32Array(B);
    data.forEach((d, i) => { X.set(d.obs, i * FDIM); A[i] = d.a; });
    const Z = pol.net.forwardBatch(X, B);
    const dZ = new Float32Array(B * 4);
    let loss = 0;
    for (let i = 0; i < B; i++) {
      let m = -Infinity; for (let j = 0; j < 4; j++) m = Math.max(m, Z[i * 4 + j]);
      const ex = []; let s = 0;
      for (let j = 0; j < 4; j++) { ex.push(Math.exp(Z[i * 4 + j] - m)); s += ex[j]; }
      for (let j = 0; j < 4; j++) ex[j] /= s;
      loss -= Math.log(ex[A[i]] + 1e-12);
      for (let j = 0; j < 4; j++) dZ[i * 4 + j] = (ex[j] - (j === A[i] ? 1 : 0)) / B;
    }
    pol.net.backwardBatch(dZ); pol.opt.step();
    if (e === bc.epochs - 1) var bcLoss = loss / B;
  }
  return { pol, nDemo: data.length, bcLoss };
}

// ---- fine-tuning arms from the SAME base tensor
function finetune(baseNet, seed, method, trainMazes, updates, lr, eps, m, K, G) {
  const rng = rngMake(seed * 1000 + 17);
  const net = RLA.nn.mlp({ sizes: [FDIM, HID, 4], act: 'tanh', rng: rngMake(1), outScale: 0 });
  net.params.forEach((p, i) => p.set(baseNet.params[i])); // clone the exact base weights
  const opt = RLA.nn.adam(net, { lr });
  const probs = (obs) => { const z = Array.from(net.forward(obs)); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  for (let u = 1; u <= updates; u++) {
    const mz = trainMazes[u % trainMazes.length];
    const draws = method === 'vpo' ? Array.from({ length: K }, () => dirichlet(rng, 4)) : null;
    const group = [];
    for (let g = 0; g < G; g++) {
      if (method === 'grpo-single') {
        const rt = route(mz, { probs }, rng, true, eps, [0, 0]);
        group.push({ routes: [rt], R: setRewardMean([rt.vec], [WSTAR]) });
      } else {
        const routes = chain(mz, { probs }, rng, true, eps, m);
        const vecs = routes.map((r) => r.vec);
        if (method === 'vpo') group.push({ routes, R: setRewardMean(vecs, draws) });
      }
    }
    // one batch gradient: REINFORCE log-prob gradient with the group-normalized whole-chain advantage
    const ADVs = groupAdv(group.map((x) => x.R));
    const S = [], A = [], ADV = [];
    for (let gi = 0; gi < group.length; gi++) {
      const adv = ADVs[gi];
      for (const rt of group[gi].routes) for (const st of rt.steps) { S.push(st.obs); A.push(st.a); ADV.push(adv); }
    }
    const B = S.length;
    const X = new Float32Array(B * FDIM); S.forEach((o, i) => X.set(o, i * FDIM));
    const Z = net.forwardBatch(X, B);
    const dZ = new Float32Array(B * 4);
    for (let i = 0; i < B; i++) {
      let m2 = -Infinity; for (let j = 0; j < 4; j++) m2 = Math.max(m2, Z[i * 4 + j]);
      const ex = []; let s = 0;
      for (let j = 0; j < 4; j++) { ex.push(Math.exp(Z[i * 4 + j] - m2)); s += ex[j]; }
      for (let j = 0; j < 4; j++) ex[j] /= s;
      // A5 validity fix (now via mixIW): the sampler is the eps-soft mixture, so the score of a
      // mixture sample is (1-eps)*p(a)*(onehot(a)-p)/mu(a); pre-A5 the pure-softmax score
      // mis-credited eps-random actions (research log validity fact 1).
      const iw = mixIW(ex[A[i]], eps, 4);
      for (let j = 0; j < 4; j++) dZ[i * 4 + j] = -ADV[i] * iw * ((j === A[i] ? 1 : 0) - ex[j]) / B;
    }
    net.backwardBatch(dZ); opt.step();
  }
  return { probs, net };
}

// ---- evaluation: fresh chains, FIRST k entries in chain order (paper Sec 4.3 style)
function evaluate(pol, testMazes, seed, m) {
  const rng = rngMake(seed * 7919 + 5);
  const eps = EVAL_EPS, REPS = PROTO.evalReps; // A18: evalReps 30 -> 6 (disclosed lower precision; 32x6=192 problem-reps per arm vs A17's 8x30=240) // EVAL_EPS: frozen per attempt (A3: 0.05, all arms identically)
  const ks = [1, 2, 4, 8, 16, 30];
  const perProblem = [];
  for (let pi = 0; pi < testMazes.length; pi++) {
    const mz = testMazes[pi];
    const sums = {}; ks.forEach((k) => sums[k] = 0);
    let L1 = 0, np = 0, nRoutes = 0;
    const lastPool = [];
    for (let rep = 0; rep < REPS; rep++) {
      const vecs = [];
      if (pol.single) { for (let i = 0; i < 30; i++) vecs.push(route(mz, pol, rng, true, eps, [0, 0]).vec); }
      else { const nChains = Math.ceil(30 / m); const got = []; for (let c2 = 0; c2 < nChains && got.length < 30; c2++) for (const rt of chain(mz, pol, rng, true, eps, m)) { if (got.length < 30) got.push(rt.vec); } vecs.push(...got); }
      for (const k of ks) { let mx = -1; for (let i = 0; i < k; i++) if (dot(WSTAR, vecs[i]) > mx) mx = dot(WSTAR, vecs[i]); sums[k] += mx; }
      for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { let d = 0; for (let q = 0; q < 4; q++) d += Math.abs(vecs[i][q] - vecs[j][q]); L1 += d; np++; }
      if (rep === REPS - 1) lastPool.push(...vecs);
      nRoutes += vecs.length;
    }
    const best = {}; for (const k of ks) best[k] = sums[k] / REPS;
    perProblem.push({ problem: pi, regime: mz.regime, best, spread: L1 / np });
  }
  const agg = {}; ks.forEach((k) => agg[k] = 0); let sp = 0;
  for (const p of perProblem) { for (const k of ks) agg[k] += p.best[k]; sp += p.spread; }
  for (const k of ks) agg[k] /= testMazes.length;
  return { perProblem, mean: agg, spread: sp / testMazes.length };
}

// ---- protocol (rev 3)
const EVAL_EPS = parseFloat(process.env.VPO_EVAL_EPS || '0.15');
const VPO_K = parseInt(process.env.VPO_K || '8', 10);
const CKPT_DIR = process.env.VPO_CKPT || null;
const PROTO = {
  mode: MODE,
  seeds: MODE === 'smoke' ? [2] : (process.env.VPO_SEEDS ? process.env.VPO_SEEDS.split(',').map((x) => parseInt(x, 10)) : [1, 3, 5, 7, 9]), // A22: runner-only seed-list override via VPO_SEEDS (same substitution as A21)
  updates: MODE === 'smoke' ? 300 : 12000,
  trainSeeds: Array.from({ length: 16 }, (_, i) => 1000 + i), // A11: written 16-maze protocol restored (A10's 96 was a disclosed deviation)
  testSeeds: Array.from({ length: 32 }, (_, i) => 2000 + i), // A18: 8 -> 32 test mazes (variable-problem axis)
  m: 3, K: VPO_K, G_single: 12, G_chain: 4,
  lr: 0.001, // A14: fine-tune Adam lr 0.003 -> 0.001 (both arms identically; VPO width-64 collapse hypothesis)
  lrNote: 'Adam lr for the MLP policy (nn.adam default family value used by the pg learner)',
  eps: 0.05, // A19 named change: TRAINING sampling eps 0.15 -> 0.05, BOTH arms identically (entropy-collapse mechanism test; eval eps stays 0)
  bc: { lr: 0.01, epochs: 1200 }, // A15 named change: BC epochs 400 -> 1200 (base-only; underfit hypothesis)
  net: { sizes: [FDIM, HID, 4], act: 'tanh', hid: HID },
  kValues: [1, 2, 4, 8, 16, 30],
  evalReps: 6,
  evalEps: EVAL_EPS,
  arms: ['base', 'grpo-single', 'vpo'],
  budgetNote: 'budget = min(max feasible single-family route, 24) + 3; both-pockets union chain excluded in C by check',
  rewardContract: REWARD_CONTRACT,
};

if (require.main !== module) { Object.assign(module.exports, { setRewardMean, groupAdv, mixProb, mixIW, rewardVec, WSTAR, dot, makeMaze, chain, route, features, FDIM, dirichlet, PROTO, buildBase, finetune, evaluate, replayVec, truncExit, scoreOf, plan }); }
else {
// Startup assertion (per 050): freeze the actual generated settings before launch.
if (PROTO.trainSeeds.length !== 16 || PROTO.trainSeeds[0] !== 1000 || PROTO.trainSeeds[PROTO.trainSeeds.length - 1] !== 1015) throw new Error('A11 protocol assertion failed: expected 16 training seeds 1000-1015, got ' + JSON.stringify(PROTO.trainSeeds));
const trainMazes = PROTO.trainSeeds.map(makeMaze);
const testMazes = PROTO.testSeeds.map(makeMaze);
const out = { protocol: PROTO, mazes: { train: trainMazes.map((m) => ({ regime: m.regime, budget: m.budget })), test: testMazes.map((m) => ({ regime: m.regime, budget: m.budget })) }, runs: [] };

const T_CAP = 40 * 60 * 1000, T0 = Date.now(); // A23 declared cap: 40 min per process (fm-box ~8 min/seed x 5)
for (const seed of PROTO.seeds) {
  if (Date.now() - T0 > T_CAP) { out.aborted = 'wall-time cap 30 min exceeded before seed ' + seed; console.error(out.aborted); fs.writeFileSync(OUT, JSON.stringify(out)); process.exit(2); }
  const t0 = Date.now();
  const b = buildBase(seed, trainMazes, PROTO.bc);
  const baseTh = b.pol.net.params;
  if (CKPT_DIR) { fs.mkdirSync(CKPT_DIR, { recursive: true }); fs.writeFileSync(CKPT_DIR + '/base-' + seed + '.json', JSON.stringify(baseTh.map((p) => Array.from(p)))); }
  const mkEval = (netParams, single) => {
    const net = RLA.nn.mlp({ sizes: [FDIM, HID, 4], act: 'tanh', rng: rngMake(1), outScale: 0 });
    net.params.forEach((p, i) => p.set(netParams[i]));
    const probs = (obs) => { const z = Array.from(net.forward(obs)); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b2) => a + b2, 0); return e.map((x) => x / s); };
    return single ? { probs, single: true } : { probs };
  };
  const arms = { base: mkEval(baseTh, false) };
  arms['grpo-single'] = (() => { const f = finetune(b.pol.net, seed, 'grpo-single', trainMazes, PROTO.updates, PROTO.lr, PROTO.eps, 1, PROTO.K, PROTO.G_single); if (CKPT_DIR) fs.writeFileSync(CKPT_DIR + '/grpo-' + seed + '.json', JSON.stringify(f.net.params.map((p) => Array.from(p)))); return { probs: f.probs, single: true }; })();
  arms['vpo'] = (() => { const f = finetune(b.pol.net, seed, 'vpo', trainMazes, PROTO.updates, PROTO.lr, PROTO.eps, PROTO.m, PROTO.K, PROTO.G_chain); if (CKPT_DIR) fs.writeFileSync(CKPT_DIR + '/vpo-' + seed + '.json', JSON.stringify(f.net.params.map((p) => Array.from(p)))); return { probs: f.probs }; })();
  const res = { seed, ms: Date.now() - t0, bc: { nDemo: b.nDemo, bcLoss: b.bcLoss }, arms: {} };
  for (const name of PROTO.arms) {
    const e = evaluate(arms[name], testMazes, seed, PROTO.m);
    res.arms[name] = { mean: e.mean, spread: e.spread, perProblem: e.perProblem };
  }
  out.runs.push(res);
  console.error('seed', seed, 'done in', ((Date.now() - t0) / 60000).toFixed(1), 'min');
  fs.writeFileSync(OUT, JSON.stringify(out));
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT);
for (const name of PROTO.arms) {
  const line = (k) => out.runs.map((r) => r.arms[name].mean[k].toFixed(3)).join(',');
  console.log(name, 'best1', line(1), 'best30', line(30), 'spread', out.runs.map((r) => r.arms[name].spread.toFixed(2)).join(','));
}
}
