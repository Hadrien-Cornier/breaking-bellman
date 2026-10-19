// A25 (per 147): preserved paper-Maze prototype copying arXiv 2605.22817 Appendix A.1,
// in an isolated runner. Protocol frozen in data/bb-vpo-design/a25-protocol.md BEFORE this file.
// Key differences from the A2X runners (all per the frozen protocol):
//  - Lava is WALKABLE and COUNTED (fractional avoidance l = 1 - distinctLava/nLava); no termination.
//  - Generator: Prim spanning tree + Unif{18..28} cycles; endpoints uniformly {(0,0)->(8,8),(0,8)->(8,0)};
//    remaining corners = gold/diamond corners; items Unif{3..5} in Manhattan-radius-2 balls; lava
//    Unif{3..5} in the strict interior; budget = max(via_gold,via_diam)+7; reject unless
//    via_both > budget and a lava-avoiding S->E path exists.
//  - Reward r = [exit, goldFrac, diamFrac, lavaAvoidFrac]; all-zero if exit never reached.
//  - Fully observable features: walls, goal, start, remaining budget, item maps, within-route
//    collected masks, earlier-candidate coverage mask (per-cell).
//  - Learner: PPO-clip 0.2 (symmetric, dual-clip 3.0) + loss-side KL 1e-3 vs frozen BC reference,
//    no entropy bonus, on the set-reward/z-score core. Explicit implementation, not REINFORCE.
//  - Multi-RLVR: m=3 chains, FIXED scalar, per-candidate scalar = uniform mean of that candidate's
//    vector, chain reward = MEAN over the m candidates, group advantage over G groups. This is OUR
//    EXPLICIT ADAPTATION (paper does not specify sum/mean/max over m) - never labeled paper-verified.
// Usage: node exp/vpo-a25.js smoke|frozen [outPath]
'use strict';
const fs = require('fs');
const path = require('path');
const RLA = globalThis.RLA = globalThis.RLA || {};
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
require(path.join(__dirname, '..', 'src', 'core', 'nn.js'));
const MODE = process.argv[2] || 'smoke';
const SMOKE_BOUNDS = MODE === 'smoke-bounded' ? { generations: 60, evalMaps: 4, evalReps: 2 } : null; // bounded smoke ONLY via explicit mode name
const OUT = process.argv[3] || ('/tmp/vpo-a25-' + MODE + '.json');
const rngMake = RLA.rng.make;
const N = 9, W = 2 * N - 1;
const dot = (w, v) => w.reduce((s, x, i) => s + x * v[i], 0);
const WSTAR = [0.25, 0.25, 0.25, 0.25];
const setRewardMean = (vecs, draws) => draws.map((w) => Math.max(...vecs.map((v) => dot(w, v)))).reduce((s, x) => s + x, 0) / draws.length;
const groupAdv = (vals) => { const m = vals.reduce((s, x) => s + x, 0) / vals.length; const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length); return vals.map((x) => (x - m) / (sd + 1e-6)); };
const dirichlet = (rng, d) => { const w = []; let s = 0; for (let i = 0; i < d; i++) { const e = -Math.log(1 - rng.next()); w.push(e); s += e; } return w.map((x) => x / s); };

// ---- App A.1 generator (literal 9x9 CELL carving per 149; no hidden 17x17 wall grid) ----
// Maze cells hold one of: EMPTY, WALL. Movement/BFS treat WALL cells as blocked directly.
const EMPTY = 0, WALL = 1;
function bfs9(grid, from, avoidLava, lavaSet) { // BFS on the 9x9 cell grid
  const D = Array.from({ length: N }, () => Array(N).fill(-1));
  if (grid[from[0]][from[1]] === WALL) return D;
  if (avoidLava && lavaSet.has(from.join(','))) return D;
  D[from[0]][from[1]] = 0; const q = [from];
  while (q.length) { const [r, c] = q.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N || D[nr][nc] !== -1) continue;
      if (grid[nr][nc] === WALL) continue;
      if (avoidLava && lavaSet.has(nr + ',' + nc)) continue;
      D[nr][nc] = D[r][c] + 1; q.push([nr, nc]); } }
  return D;
}
const tDist9 = (grid, from, to, avoidLava, lavaSet) => { const D = bfs9(grid, from, avoidLava, lavaSet); return D[to[0]][to[1]] >= 0 ? D[to[0]][to[1]] : Infinity; };
function makeMaze(seed) {
  const rng = rngMake(seed * 2654435761 % 2147483647 + 7);
  let internalRejects = 0;
  for (let attempt = 0; attempt < 200; attempt++) {
    // Stage 1: Prim carving on the 9x9 CELL grid (paper rule: pop a uniform random frontier cell and
    // carve it to empty if it has EXACTLY ONE empty neighbor - the standard wall-carving rule).
    const grid = Array.from({ length: N }, () => Array(N).fill(WALL));
    const sc = [rng.int(N), rng.int(N)];
    grid[sc[0]][sc[1]] = EMPTY;
    let front = [];
    const addNbrs = (r, c) => { for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === WALL) front.push([nr, nc]); } };
    addNbrs(sc[0], sc[1]);
    while (front.length) {
      const i = rng.int(front.length);
      const [r, c] = front.splice(i, 1)[0];
      if (grid[r][c] !== WALL) continue;
      let empty = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === EMPTY) empty++; }
      if (empty === 1) { grid[r][c] = EMPTY; addNbrs(r, c); }
    }
    // Stage 2: n_cycles ~ Unif{18..28} successful openings: keep converting eligible wall cells
    // (>= 2 empty neighbors) until n_cycles conversions have ACTUALLY happened.
    const ncyc = 18 + rng.int(11);
    let done = 0, guard = 0;
    while (done < ncyc && guard++ < 2000) {
      const r = rng.int(N), c = rng.int(N);
      if (grid[r][c] !== WALL) continue;
      let empty = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === EMPTY) empty++; }
      if (empty >= 2) { grid[r][c] = EMPTY; done++; }
    }
    if (done < ncyc) { internalRejects++; continue; }
    const endpoints = rng.next() < 0.5 ? { S: [0, 0], E: [8, 8] } : { S: [0, 8], E: [8, 0] };
    const corners = [[0, 0], [8, 8], [0, 8], [8, 0]];
    const others = corners.filter((c) => !(c[0] === endpoints.S[0] && c[1] === endpoints.S[1]) && !(c[0] === endpoints.E[0] && c[1] === endpoints.E[1]));
    const goldCorner = others[rng.int(2)], diamCorner = others.find((c) => c !== goldCorner);
    grid[endpoints.S[0]][endpoints.S[1]] = EMPTY; grid[endpoints.E[0]][endpoints.E[1]] = EMPTY;
    grid[goldCorner[0]][goldCorner[1]] = EMPTY; grid[diamCorner[0]][diamCorner[1]] = EMPTY;
    const ball = (corner) => { const cs = []; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { if (Math.abs(dr) + Math.abs(dc) > 2) continue; const r = corner[0] + dr, c = corner[1] + dc; if (r >= 0 && r < N && c >= 0 && c < N && grid[r][c] === EMPTY && !(r === endpoints.S[0] && c === endpoints.S[1]) && !(r === endpoints.E[0] && c === endpoints.E[1])) cs.push([r, c]); } return cs; };
    const gb = ball(goldCorner), db = ball(diamCorner);
    if (gb.length < 3 || db.length < 3) { internalRejects++; continue; } // exact item counts: reject if not enough eligible cells
    const pick = (pool, n) => { const p = pool.slice(); const out = []; while (out.length < n && p.length) out.push(p.splice(rng.int(p.length), 1)[0]); return out; };
    const nG = 3 + rng.int(3), nD = 3 + rng.int(3), nL = 3 + rng.int(3);
    if (gb.length < nG || db.length < nD) { internalRejects++; continue; }
    const gold = pick(gb, nG), diam = pick(db, nD);
    const goldSet = new Set(gold.map((c) => c.join(','))), diamSet = new Set(diam.map((c) => c.join(',')));
    const interior = []; for (let r = 2; r <= 6; r++) for (let c = 2; c <= 6; c++) if (grid[r][c] === EMPTY && !goldSet.has(r + ',' + c) && !diamSet.has(r + ',' + c)) interior.push([r, c]);
    if (interior.length < nL) { internalRejects++; continue; }
    const lava = pick(interior, nL); // exact count placed
    const lavaSet = new Set(lava.map((c) => c.join(',')));
    // via distances are measured BEFORE lava placement on the WALL GRAPH (paper order), via the
    // DESIGNATED CORNER with O(3) BFS: via_gold = d(S,goldC) + d(goldC,E); same for diamond;
    // via_both = d(S,goldC)+d(goldC,diamC)+d(diamC,E). NOT item permutations.
    const dNoLava = (a, b) => tDist9(grid, a, b, false, null);
    const viaG = dNoLava(endpoints.S, goldCorner) + dNoLava(goldCorner, endpoints.E);
    const viaD = dNoLava(endpoints.S, diamCorner) + dNoLava(diamCorner, endpoints.E);
    const viaB = dNoLava(endpoints.S, goldCorner) + dNoLava(goldCorner, diamCorner) + dNoLava(diamCorner, endpoints.E);
    if (![viaG, viaD, viaB].every(Number.isFinite)) { internalRejects++; continue; }
    const budget = Math.max(viaG, viaD) + 7;
    if (!(viaB > budget)) { internalRejects++; continue; }
    // final check AFTER lava: a lava-avoiding S->E path exists within budget
    const dExit = tDist9(grid, endpoints.S, endpoints.E, true, lavaSet);
    if (!Number.isFinite(dExit) || dExit > budget) { internalRejects++; continue; }
    return { grid, S: endpoints.S, E: endpoints.E, gold, diam, lava, budget, viaG, viaD, viaB, regime: 'A25', nLava: lava.length, nGold: gold.length, nDiam: diam.length, seed, internalRejects };
  }
  throw new Error('A25: no valid layout for seed ' + seed + ' after 200 internal attempts (internal rejections counted: ' + internalRejects + ')');
}
// ---- features (fully observable per protocol) ----
const FIXED_ITEMS = 10; // masks clipped to 10 gold + 10 diam slots (Unif{3..5} <= 5 per corner, ball<=13; 10 is safe)
const FDIM = 2 + 81 /*walls*/ + 4 /*goal+start*/ + 1 /*budget*/ + 3 * 81 /*gold,diam,lava maps*/ + 2 * FIXED_ITEMS /*collected masks*/ + 81 /*earlier-candidate coverage*/;
function features(x, y, st, mz) {
  const v = new Float32Array(FDIM); let i = 0;
  v[i++] = x / (N - 1); v[i++] = y / (N - 1);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) v[i++] = mz.grid[r][c] === WALL ? 1 : 0;
  v[i++] = mz.E[0] / (N - 1); v[i++] = mz.E[1] / (N - 1); v[i++] = mz.S[0] / (N - 1); v[i++] = mz.S[1] / (N - 1);
  v[i++] = st.remaining / mz.budget;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { let g = 0, d2 = 0, l = 0; if (mz.gold.some((q) => q[0] === r && q[1] === c)) g = 1; if (mz.diam.some((q) => q[0] === r && q[1] === c)) d2 = 1; if (mz.lava.some((q) => q[0] === r && q[1] === c)) l = 1; v[i++] = g; v[i++] = d2; v[i++] = l; }
  for (const c of mz.gold) v[i + mz.gold.indexOf(c)] = st.got.has(c.join(',')) ? 1 : 0; i += FIXED_ITEMS;
  for (const c of mz.diam) v[i + mz.diam.indexOf(c)] = st.got.has(c.join(',')) ? 1 : 0; i += FIXED_ITEMS;
  for (const cell of st.cover) { // canonical string representation 'r,c' (also accepts [r,c])
    const parts = Array.isArray(cell) ? cell : String(cell).split(',');
    v[i + Number(parts[0]) * N + Number(parts[1])] = 1; }
  i += 81;
  return v;
}
// ---- route: walkable counted lava, distinct-cell collection, all-zero on no-exit ----
function route(mz, pol, rng, explore, eps, coverIn) {
  let [r, c] = mz.S.slice();
  const got = new Set(), lavaStepped = new Set();
  const steps = [];
  let remaining = mz.budget;
  const cover = new Set(coverIn || []);
  const take = (x, y) => { const k = x + ',' + y; cover.add(k); if (mz.gold.some((q) => q[0] === x && q[1] === y)) got.add(k); if (mz.diam.some((q) => q[0] === x && q[1] === y)) got.add(k); };
  take(r, c);
  if (mz.lava.some((q) => q[0] === r && q[1] === c)) lavaStepped.add(r + ',' + c);
  for (let t = 0; t < mz.budget; t++) {
    remaining = mz.budget - t; // every attempt (incl. blocked/wall/border) costs exactly one step
    const obs = features(r, c, { remaining, got, cover }, mz);
    const p = pol.probs(obs);
    let a;
    if (!explore) { a = 0; for (let j = 1; j < 4; j++) if (p[j] > p[a]) a = j; }
    else { if (rng.next() < eps) a = rng.int(4); else { let u = rng.next(), j = 0; for (; j < 3; j++) { u -= p[j]; if (u < 0) break; } a = j; } }
    steps.push({ obs, a, p: Array.from(p) });
    const nr = r + (a === 0 ? 1 : a === 2 ? -1 : 0), nc = c + (a === 1 ? 1 : a === 3 ? -1 : 0);
    if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue; // walls/borders block (stay)
    if (mz.grid[nr][nc] === WALL) continue; // wall cell: stay in place
    r = nr; c = nc;
    take(r, c);
    if (mz.lava.some((q) => q[0] === r && q[1] === c)) lavaStepped.add(r + ',' + c); // WALKABLE: no break
    if (r === mz.E[0] && c === mz.E[1]) { return { vec: [1, Math.min(1, mz.gold.filter((q) => got.has(q.join(','))).length / mz.nGold), Math.min(1, mz.diam.filter((q) => got.has(q.join(','))).length / mz.nDiam), 1 - lavaStepped.size / mz.nLava], steps, cover: [...cover] }; }
  }
  return { vec: [0, 0, 0, 0], steps, cover: [...cover] }; // paper contract: no exit => all-zero
}
function chain(mz, pol, rng, explore, eps, m) {
  const out = []; let cover = [];
  for (let j = 0; j < m; j++) { const rt = route(mz, pol, rng, explore, eps, cover); out.push(rt); cover = rt.cover; }
  return out;
}
// ---- BC base: documented planner routes on the A25 maze ----
function plan(mz) {
  const orders = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => orders([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
  const trace = (from, to) => { const D = bfs9(mz.grid, from, false, null); if (D[to[0]][to[1]] < 0) return null; const p = []; let c = to.slice(); while (!(c[0] === from[0] && c[1] === from[1])) { p.push(c); let nb = null; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = c[0] + dr, nc = c[1] + dc; if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue; if (D[nr][nc] === D[c[0]][c[1]] - 1) { nb = [nr, nc]; break; } } if (!nb) return null; c = nb; } p.push(from.slice()); return p.reverse(); };
  const concat = (parts) => { const out = []; for (const p of parts) { for (const c of p) if (!out.length || out[out.length - 1][0] !== c[0] || out[out.length - 1][1] !== c[1]) out.push(c.slice()); } return out; };
  const reach = (cells) => cells.filter((c) => tDist9(mz.grid, mz.S, c, false, null) < Infinity);
  const best = (cellsets) => {
    let b = null, bs = -1, bk = null;
    for (const sa of cellsets.length ? orders(cellsets[0]) : [[]]) for (const sb of cellsets.length > 1 ? orders(cellsets[1]) : [[]]) {
      const seq = [...sa, ...sb]; if (!seq.length) continue;
      let L = 0, cur = mz.S, ok = true; const pts = [mz.S];
      for (const c of seq) { const dd = tDist9(mz.grid, cur, c, false, null); if (dd === Infinity) { ok = false; break; } L += dd; cur = c; pts.push(c); }
      if (!ok) continue;
      const de = tDist9(mz.grid, cur, mz.E, false, null); if (de === Infinity || L + de > mz.budget) continue;
      const full = concat([...seq.map((c) => [c]), [mz.E]].map((c, i) => trace(i === 0 ? mz.S : [...seq][i - 1] || mz.S, c)));
      if (!full) continue;
      const vec = replayVec(mz, full); const s = dot(WSTAR, vec);
      const key = full.map((c) => c.join(',')).join('|');
      if (s > bs || (s === bs && (full.length < (bk ? bk.length : 1e9) || (bk && full.length === bk.length && key < bk.join('|'))))) { bs = s; b = full; bk = full; }
    }
    return b;
  };
  const routes = [];
  const rg = reach(mz.gold), rd = reach(mz.diam);
  const single = (cells) => { let b = null, bs = -1; for (const perm of orders(cells)) { let L = 0, cur = mz.S, ok = true; for (const c of perm) { const d2 = tDist9(mz.grid, cur, c, false, null); if (d2 === Infinity) { ok = false; break; } L += d2; cur = c; } if (!ok) continue; const de = tDist9(mz.grid, cur, mz.E, false, null); if (de === Infinity || L + de > mz.budget) continue; const parts = []; let from = mz.S.slice(); for (const c of [...perm, mz.E]) { const seg = trace(from, c); if (!seg) { ok = false; break; } parts.push(seg); from = c.slice(); } if (!ok) continue; const full = concat(parts); if (full.length - 1 > mz.budget) continue; const s = dot(WSTAR, replayVec(mz, full)); if (s > bs) { bs = s; b = full; } } return b; };
  const g = single(rg), d2 = single(rd);
  if (g) routes.push(g); if (d2) routes.push(d2);
  const hyb = best([rg, rd]); if (hyb) routes.push(hyb);
  const seen = new Set();
  return routes.filter((p) => { const k = p.map((c) => c.join(',')).join('|'); if (seen.has(k) || !p.length) return false; seen.add(k); return true; });
}
function replayVec(mz, path) { // deterministic replay of an explicit cell path (production-faithful)
  const got = new Set(), lavaStepped = new Set();
  const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  for (let i = 0; i < path.length; i++) { const [r, c] = path[i]; if (!inBounds(r, c) || mz.grid[r][c] === WALL) return null; if (i > 0) { const [pr, pc] = path[i - 1]; if (Math.abs(r - pr) + Math.abs(c - pc) !== 1) return null; }
    if (mz.gold.some((q) => q[0] === r && q[1] === c)) got.add(r + ',' + c);
    if (mz.diam.some((q) => q[0] === r && q[1] === c)) got.add(r + ',' + c);
    if (mz.lava.some((q) => q[0] === r && q[1] === c)) lavaStepped.add(r + ',' + c);
    if (r === mz.E[0] && c === mz.E[1] && i < path.length - 1) return null; }
  if (!(path[path.length - 1][0] === mz.E[0] && path[path.length - 1][1] === mz.E[1])) return null;
  if (path.length - 1 > mz.budget) return null;
  return [1, Math.min(1, mz.gold.filter((q) => got.has(q.join(','))).length / mz.nGold), Math.min(1, mz.diam.filter((q) => got.has(q.join(','))).length / mz.nDiam), 1 - lavaStepped.size / mz.nLava];
}
// ---- BC + PPO/KL learner ----
// A25 production helper: PPO-clip + KL gradient at one timestep (used by finetune AND by the
// finite-difference checks so the tests exercise the SAME code, per 151).
function ppoKLdZ(Zrow, oldP, action, adv, refP, B) {
  const CLIP = 0.2, KL = 1e-3;
  let mx = -Infinity; for (let j = 0; j < 4; j++) mx = Math.max(mx, Zrow[j]);
  const ex = []; for (let j = 0; j < 4; j++) ex.push(Math.exp(Zrow[j] - mx));
  let s = 0; for (const x of ex) s += x; for (let j = 0; j < 4; j++) ex[j] /= s;
  const r = ex[action] / oldP[action]; // RAW ratio, never clamped in the objective
  // PPO surrogate (paper: standard PPO-clip, symmetric eps=0.2; dual-clip c=3.0 applies ONLY to
  // negative advantages as a floor): L = min(r*A, clip(r)*A) for A>=0;
  // L = max(min(r*A, clip(r)*A), 3*A) for A<0.
  const clipR = Math.min(Math.max(r, 1 - CLIP), 1 + CLIP);
  let L, active;
  if (adv >= 0) { L = Math.min(r * adv, clipR * adv); active = r <= 1 + CLIP; } // A>=0: r<lo -> rA active; interior active; r>hi -> clipA flat
  else { L = Math.max(Math.min(r * adv, clipR * adv), 3 * adv); active = r >= 1 - CLIP && r <= 3.0; } // A<0: min-form = rA for r>=lo (pessimism pushes r down); flat below lo; dual-clip floor 3A flat for r>3
  const dZ = new Float32Array(4);
  if (active) { // dL/dz_j = adv * pi_a ((a==j) - pi_j) / oldP_a (full softmax Jacobian)
    for (let j = 0; j < 4; j++) dZ[j] += -(ex[action] * ((j === action ? 1 : 0) - ex[j])) * adv / oldP[action] / B; }
  // loss-side KL: FORWARD KL(new || ref), exact sum (the paper's k3 ESTIMATOR targets the same
  // KL(new||ref); estimator difference DISCLOSED in the protocol). dKL/dz_j = pi_j (log(pi_j/ref_j) - KL).
  let klv = 0; for (let j = 0; j < 4; j++) klv += ex[j] * (Math.log(ex[j] + 1e-12) - Math.log(refP[j] + 1e-12));
  for (let j = 0; j < 4; j++) dZ[j] += KL * ex[j] * (Math.log(ex[j] + 1e-12) - Math.log(refP[j] + 1e-12) - klv) / B;
  return { dZ, ratio: r, active, ex, L };
}


const HID = 64;
function makeNet(seed) {
  const rng = rngMake(seed);
  const net = RLA.nn.mlp({ sizes: [FDIM, HID, 4], act: 'tanh', rng, outScale: 0.01 });
  const opt = RLA.nn.adam(net, { lr: 0.001, clipNorm: 1.0 }); // Adam (NO weight decay; not AdamW)
  return { net, opt };
}
function buildBase(seed, trainMazes) {
  const { net, opt } = makeNet(seed);
  const probs = (obs) => { const z = Array.from(net.forward(obs)); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  const data = [];
  for (const mz of trainMazes) {
    const rts = plan(mz);
    for (let i = 0; i < rts.length; i++) { data.push({ mz, path: rts[i], cover: [] }); for (let j = 0; j < rts.length; j++) if (i !== j) data.push({ mz, path: rts[j], cover: coverOf(mz, rts[i]) }); }
  }
  const EPOCHS = 8;
  const lossOf = () => { let L = 0, n = 0; for (const d0 of data) { const mz = d0.mz, p0 = d0.path; const acts = []; for (let i = 0; i + 1 < p0.length; i++) { const a = p0[i], b2 = p0[i + 1]; acts.push(b2[0] === a[0] + 1 ? 0 : b2[1] === a[1] + 1 ? 1 : b2[0] === a[0] - 1 ? 2 : 3); } const got = new Set(), cover = new Set(d0.cover); let remaining = mz.budget; for (let i = 0; i < p0.length && i < acts.length; i++) { const [r, c] = p0[i]; const k = r + ',' + c; cover.add(k); if (mz.gold.some((q) => q.join(',') === k)) got.add(k); if (mz.diam.some((q) => q.join(',') === k)) got.add(k); const z = Array.from(net.forward(features(r, c, { remaining: mz.budget - i, got, cover }, mz))); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const ex = z.map((x) => Math.exp(x - mx)); const sm = ex.reduce((a, b2) => a + b2, 0); L += -Math.log(ex[acts[i]] / sm + 1e-12); n++; remaining--; } } return L / Math.max(1, n); };
  const bcLossBefore = lossOf();
  for (let ep = 0; ep < EPOCHS; ep++) {
    for (const d0 of data) {
      const mz = d0.mz, p0 = d0.path;
      const acts = [];
      for (let i = 0; i + 1 < p0.length; i++) { const a = p0[i], b = p0[i + 1]; acts.push(b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : 3); }
      const got = new Set(), cover = new Set(d0.cover), lavaStepped = new Set();
      const S = [], A = [];
      let remaining = mz.budget;
      for (let i = 0; i < p0.length; i++) {
        const [r, c] = p0[i]; const k = r + ',' + c; cover.add(k);
        if (mz.gold.some((q) => q.join(',') === k)) got.add(k);
        if (mz.diam.some((q) => q.join(',') === k)) got.add(k);
        if (mz.lava.some((q) => q.join(',') === k)) lavaStepped.add(k);
        if (i < acts.length) { S.push(features(r, c, { remaining: mz.budget - i, got, cover }, mz)); A.push(acts[i]); }
      }
      if (!S.length) continue;
      const B = S.length;
      const X = new Float32Array(B * FDIM); S.forEach((o, i) => X.set(o, i * FDIM));
      const Z = net.forwardBatch(X, B);
      const dZ = new Float32Array(B * 4);
      for (let i = 0; i < B; i++) {
        let mx = -Infinity; for (let j = 0; j < 4; j++) mx = Math.max(mx, Z[i * 4 + j]);
        const ex = []; let sm = 0; for (let j = 0; j < 4; j++) { ex.push(Math.exp(Z[i * 4 + j] - mx)); sm += ex[j]; }
        for (let j = 0; j < 4; j++) ex[j] /= sm;
        for (let j = 0; j < 4; j++) dZ[i * 4 + j] = -((j === A[i] ? 1 : 0) - ex[j]) / B;
      }
      net.backwardBatch(dZ); opt.step();
    }
  }
  const bcLossAfter = lossOf();
  return { probs, net, nDemo: data.length, bcLossBefore, bcLossAfter };
}
function coverOf(mz, rt) { // canonical coverage from a route object OR a raw planner path (array)
  if (rt && rt.cover) return rt.cover;
  if (Array.isArray(rt)) return rt.map((c) => Array.isArray(c) ? c.join(',') : String(c));
  return []; }
function finetune(baseNet, baseRef, seed, method, trainMazes, updates, lr, eps, m, K, G) {
  const rng = rngMake(seed * 1000 + 17);
  const net = RLA.nn.mlp({ sizes: [FDIM, HID, 4], act: 'tanh', rng: rngMake(1), outScale: 0 });
  net.params.forEach((p, i) => p.set(baseNet.params[i]));
  const opt = RLA.nn.adam(net, { lr, clipNorm: 1.0 });
  const probs = (obs) => { const z = Array.from(net.forward(obs)); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  const refProbs = (obs) => { const z = Array.from(baseRef.forward(obs)); let mx = -Infinity; for (const x of z) mx = Math.max(mx, x); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  for (let u = 1; u <= updates; u++) {
    const mz = trainMazes[u % trainMazes.length];
    const draws = method === 'vpo' ? Array.from({ length: K }, () => dirichlet(rng, 4)) : null;
    const group = [];
    for (let g = 0; g < G; g++) {
      if (method === 'grpo-single') { const rt = route(mz, { probs }, rng, true, eps, []); group.push({ routes: [rt], R: dot(WSTAR, rt.vec) }); }
      else if (method === 'multi-rlvr') { const rts = chain(mz, { probs }, rng, true, eps, m); const R = rts.reduce((s, r) => s + dot(WSTAR, r.vec), 0) / rts.length; group.push({ routes: rts, R }); }
      else if (method === 'random-w') { const w = dirichlet(rng, 4); const rt = route(mz, { probs }, rng, true, eps, []); group.push({ routes: [rt], R: dot(w, rt.vec) }); }
      else { const rts = chain(mz, { probs }, rng, true, eps, m); group.push({ routes: rts, R: setRewardMean(rts.map((r) => r.vec), draws) }); }
    }
    // AMENDED per 155: two deterministic-shuffled minibatches of WHOLE rollouts, one epoch,
    // advantages fixed from the full group, logits recomputed after step 1, oldP frozen from
    // collection (clipping CAN activate within a generation). 12 candidates / 2 optimizer steps.
    const ADVs = groupAdv(group.map((x) => x.R));
    const rolls = [];
    for (let gi = 0; gi < group.length; gi++) rolls.push({ idx: gi, order: gi }); // whole-rollout units
    // deterministic shuffle of ROLLOUT units (Fisher-Yates with the update rng, fixed seed stream)
    for (let i = rolls.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = rolls[i]; rolls[i] = rolls[j]; rolls[j] = t; }
    // group rollouts into two halves of WHOLE routes (chain arms keep each m-chain intact)
    const half = Math.ceil(rolls.length / 2);
    const mb = [rolls.slice(0, half), rolls.slice(half)];
    for (const batch of mb) {
      if (!batch.length) continue;
      const S = [], A = [], P = [], ADV = [];
      for (const roll of batch) { const adv = ADVs[roll.idx]; for (const rt of group[roll.idx].routes) for (const st of rt.steps) { S.push(st.obs); A.push(st.a); P.push(st.p); ADV.push(adv); } }
      const B = S.length; if (!B) continue;
      const X = new Float32Array(B * FDIM); S.forEach((o, i) => X.set(o, i * FDIM));
      const Z = net.forwardBatch(X, B);
      const dZ = new Float32Array(B * 4);
      for (let i = 0; i < B; i++) {
        const Zrow = Array.from(Z.slice(i * 4, i * 4 + 4));
        const r = ppoKLdZ(Zrow, P[i], A[i], ADV[i], refProbs(S[i]), B); // oldP FROZEN from collection
        for (let j = 0; j < 4; j++) dZ[i * 4 + j] = r.dZ[j]; // timestep-mean per minibatch (1/B)
      }
      net.backwardBatch(dZ); opt.step(); // logits for the next minibatch are recomputed by forwardBatch
    }
  }
  return { probs, net };
}
// ---- evaluation: fresh chains, draw-order first-k (Sec 4.3); STOCHASTIC softmax sampling (explore=true, eps=0 => no uniform-epsilon mix), not greedy ----
const KVALUES = [1, 3, 5, 10, 30];
function evaluate(pol, testMazes, seed, m, single, REPS) {
  const rng = rngMake(seed * 7919 + 5);
  const eps = 0; REPS = REPS || 6; // stochastic softmax eval (explore=true, eps=0 => NO uniform mix), matching A23 and the paper's stochastic final eval
  const perProblem = [];
  let exits = 0, nAll = 0;
  for (let pi = 0; pi < testMazes.length; pi++) {
    const mz = testMazes[pi]; const sums = {}; KVALUES.forEach((k) => sums[k] = 0);
    let L1 = 0, np = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const vecs = [];
      if (single) { for (let i = 0; i < 30; i++) vecs.push(route(mz, pol, rng, true, eps, []).vec); }
      else { const nChains = Math.ceil(30 / m); const got = []; for (let c2 = 0; c2 < nChains && got.length < 30; c2++) for (const rt of chain(mz, pol, rng, true, eps, m)) if (got.length < 30) got.push(rt.vec); vecs.push(...got); }
      for (const k of KVALUES) { let mx = -1; for (let i = 0; i < k; i++) if (dot(WSTAR, vecs[i]) > mx) mx = dot(WSTAR, vecs[i]); sums[k] += mx; }
      for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { let d2 = 0; for (let q = 0; q < 4; q++) d2 += Math.abs(vecs[i][q] - vecs[j][q]); L1 += d2; np++; }
      exits += vecs.filter((v) => v[0] === 1).length; nAll += vecs.length;
    }
    const best = {}; for (const k of KVALUES) best[k] = sums[k] / REPS;
    perProblem.push({ problem: pi, best, spread: L1 / np });
  }
  const mean = {}; for (const k of KVALUES) mean[k] = perProblem.reduce((s, p) => s + p.best[k], 0) / perProblem.length;
  const spread = perProblem.reduce((s, p) => s + p.spread, 0) / perProblem.length;
  return { mean, spread, perProblem, exitFraction: exits / Math.max(1, nAll) };
}
// ---- frozen protocol ----
const UPDATES = MODE === 'smoke' ? 60 : 12000;
const PROTO = { mode: MODE, updates: UPDATES, discoverySeeds: [2, 4, 6, 8, 10], confirmationSeeds: [31, 33, 35, 37, 39, 41, 43, 45, 47, 49], trainMapSeeds: 'first 16 survivors from 42', testMapSeeds: 'first 32 survivors from 4242', m: 3, K: 8, G_single: 12, G_chain: 4, lr: 0.001, eps: 0, evalEps: 0, epsNote: 'pure stochastic softmax sampling at collection (155); oldP = pure policy prob; ratio old==new = 1 asserted', evalReps: 6, kValues: KVALUES, clip: 0.2, dualClip: 3.0, kl: 1e-3, entropyBonus: 0, contract: 'paper-appA1-walkable-lava', approximations: ['MLP vs LLM', 'coverage-mask context vs full text', '16/32 maps vs 1000/100', 'Adam lr 1e-3 (no weight decay) vs paper AdamW 1e-6', 'MultiRLVR mean aggregation = our adaptation'] };
function buildMapSplits() {
  const train = []; for (let s = 42; train.length < 16 && s < 42 + 400; s++) { try { train.push(makeMaze(s)); } catch (e) {} }
  const test = []; for (let s = 4242; test.length < 32 && s < 4242 + 800; s++) { try { test.push(makeMaze(s)); } catch (e) {} }
  if (train.length < 16 || test.length < 32) throw new Error('map split incomplete: train ' + train.length + ' test ' + test.length);
  return { train, test };
}
async function main() {
  const t0 = Date.now();
  const { train, test } = buildMapSplits();
  const bounded = MODE === 'smoke-bounded';
  const seeds = bounded ? [2] : PROTO.discoverySeeds;
  const testSet = bounded ? test.slice(0, 4) : test;
  const reps = bounded ? 2 : 6;
  const gens = bounded ? 60 : UPDATES;
  console.log('maps: train', train.length, 'test', testSet.length, '| mode', MODE, '| generations', gens, '| evalReps', reps);
  const arms = {};
  for (const seed of seeds) {
    const b = buildBase(seed, train);
    arms[seed] = { bc: { nDemo: b.nDemo, bcLossBefore: b.bcLossBefore, bcLossAfter: b.bcLossAfter } };
    arms[seed].grpo = finetune(b.net, b.net, seed, 'grpo-single', train, gens, PROTO.lr, PROTO.eps, 1, PROTO.K, PROTO.G_single);
    arms[seed].multi = finetune(b.net, b.net, seed, 'multi-rlvr', train, gens, PROTO.lr, PROTO.eps, PROTO.m, PROTO.K, PROTO.G_chain);
    arms[seed].vpo = finetune(b.net, b.net, seed, 'vpo', train, gens, PROTO.lr, PROTO.eps, PROTO.m, PROTO.K, PROTO.G_chain);
    arms[seed].randw = finetune(b.net, b.net, seed, 'random-w', train, gens, PROTO.lr, PROTO.eps, 1, PROTO.K, PROTO.G_single);
    for (const [name, pol] of [['grpo', arms[seed].grpo], ['multi', arms[seed].multi], ['vpo', arms[seed].vpo], ['randw', arms[seed].randw]]) arms[seed][name + '_eval'] = evaluate(pol, testSet, seed, PROTO.m, name === 'grpo' || name === 'randw', reps);
    console.log('seed', seed, 'done', Math.round((Date.now() - t0) / 1000) + 's');
  }
  fs.writeFileSync(OUT, JSON.stringify({ protocol: PROTO, arms }, null, 1));
  console.log('wrote', OUT);
}
if (require.main !== module) { module.exports = { makeMaze, features, route, chain, plan, replayVec, finetune, evaluate, buildMapSplits, setRewardMean, groupAdv, dirichlet, dot, WSTAR, FDIM, PROTO, ppoKLdZ, WALL, EMPTY, coverOf }; }
else main().catch((e) => { console.error('A25 FAIL', e); process.exit(1); });
