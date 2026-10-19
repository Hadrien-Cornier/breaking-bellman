// A25c (per 168): A25 runner + ADDED local/relative feature channels. ALL 432 original global
// features are preserved unchanged (first 432 dims identical to vpo-a25.js); ADDED: axis-aligned
// 5x5 local channels (walls / uncollected-gold / uncollected-diamond / lava / earlier coverage,
// 25 cells each) + relative S and E offsets (2+2 scalars). NO heading/rotation.
// FDIM = 432 + 125 + 4 = 561 (frozen before run). Same learner/maps/BC rules; A25c preflight only.
'use strict';
const A25 = require('./vpo-a25.js');
const N = 9;
const LOCAL_R = 2; // 5x5 window (offsets -2..2)
const FDIM = A25.FDIM + 25 * 5 + 4;
function featuresA25c(x, y, st, mz) {
  const v = new Float32Array(FDIM);
  const base = A25.features(x, y, st, mz); // original 432, unchanged
  v.set(base, 0);
  let i = A25.FDIM;
  const local = (testFn, oobVal) => { for (let dr = -LOCAL_R; dr <= LOCAL_R; dr++) for (let dc = -LOCAL_R; dc <= LOCAL_R; dc++) { const r = x + dr, c = y + dc; const oob = r < 0 || r >= N || c < 0 || c >= N; v[i++] = oob ? (oobVal || 0) : testFn(r, c) ? 1 : 0; } };
  const isWall = (r, c) => mz.grid[r][c] === A25.WALL;
  const isGold = (r, c) => mz.gold.some((q) => q[0] === r && q[1] === c);
  const isDiam = (r, c) => mz.diam.some((q) => q[0] === r && q[1] === c);
  const isLava = (r, c) => mz.lava.some((q) => q[0] === r && q[1] === c);
  const covList = st.cover ? (typeof st.cover[Symbol.iterator] === 'function' && typeof st.cover !== 'string' ? [...st.cover] : [st.cover]) : [];
  const covSet = new Set(covList.map((k) => Array.isArray(k) ? k.join(',') : String(k)));
  const isCov = (r, c) => covSet.has(r + ',' + c);
  local(isWall, 1); // OOB reads as wall (frozen semantics)                       // local walls (OOB = wall)
  local((r, c) => isGold(r, c) && !st.got.has(r + ',' + c));  // uncollected gold
  local((r, c) => isDiam(r, c) && !st.got.has(r + ',' + c));  // uncollected diamond
  local((r, c) => isLava(r, c));               // lava
  local((r, c) => isCov(r, c));                // earlier-candidate coverage (local)
  v[i++] = (mz.S[0] - x) / 8; v[i++] = (mz.S[1] - y) / 8;   // relative S offset
  v[i++] = (mz.E[0] - x) / 8; v[i++] = (mz.E[1] - y) / 8;   // relative E offset
  return v;
}
// route/chain/replayVec wrappers with A25c features: reuse A25.route but swap the features fn.
// A25.route closes over A25.features; implement a thin routeA25c by monkey-patching via A25's
// exported route is NOT possible - replicate route with featuresA25c (kept minimal and identical
// otherwise). To avoid drift, copy the A25 route body here with the swapped features call.
const route = A25.routeWithFeatures(featuresA25c); // export added in vpo-a25.js (transport-only)
const chain = (mz, pol, rng, explore, eps, m) => A25.chainWith(route)(mz, pol, rng, explore, eps, m); // feat baked into route
const buildBase = A25.buildBaseWithFeatures(featuresA25c, FDIM);
module.exports = { FDIM, featuresA25c, route, chain, makeMaze: A25.makeMaze, buildBase, replayVec: A25.replayVec, A25, WALL: A25.WALL };
