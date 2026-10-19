// A25d (per 171): supervisor-selected encoding. REPLACE ONLY the five 81-cell spatial blocks with
// six 17x17 agent-relative channels [wall, STATIC gold, STATIC diamond, lava, earlier-coverage,
// valid]; RETAIN original 2 position scalars + 1 budget + 20 collected masks; REPLACE the 4
// absolute S/E coordinate scalars with 4 relative S/E offsets /8. FDIM = 6*289+2+1+20+4 = 1761.
// Padding != wall: outside-maze cells valid=0 and all channel values 0; actual walls valid=1+bit 1.
'use strict';
const A25 = require('./vpo-a25.js');
const N = 9, W17 = 17, HALF = 8;
// layout of the retained prefix: pos(2) | budget(1) | masks(20) | relative S/E(4)  => 27
// (the original absolute blocks and absolute S/E scalars are REMOVED, per the selected design)
const RETAINED = 2 + 1 + 20 + 4;
const FDIM = 6 * 289 + RETAINED;
function featuresA25d(x, y, st, mz) {
  const v = new Float32Array(FDIM);
  let i = 0;
  v[i++] = x / (N - 1); v[i++] = y / (N - 1);          // 2 position scalars (retained as-is)
  v[i++] = st.remaining / mz.budget;                    // budget (retained)
  for (const c of mz.gold) v[i + mz.gold.indexOf(c)] = st.got.has(c.join(',')) ? 1 : 0; i += 10;  // collected masks (retained)
  for (const c of mz.diam) v[i + mz.diam.indexOf(c)] = st.got.has(c.join(',')) ? 1 : 0; i += 10;
  v[i++] = (mz.S[0] - x) / 8; v[i++] = (mz.S[1] - y) / 8;   // relative S
  v[i++] = (mz.E[0] - x) / 8; v[i++] = (mz.E[1] - y) / 8;   // relative E
  // six 17x17 agent-relative channels, indexed (x+dr+8, y+dc+8) for dr,dc in [-8,8]
  const covList = st.cover ? (typeof st.cover[Symbol.iterator] === 'function' && typeof st.cover !== 'string' ? [...st.cover] : [st.cover]) : [];
  const covSet = new Set(covList.map((k) => Array.isArray(k) ? k.join(',') : String(k)));
  const isGold = (r, c) => mz.gold.some((q) => q[0] === r && q[1] === c);
  const isDiam = (r, c) => mz.diam.some((q) => q[0] === r && q[1] === c);
  const isLava = (r, c) => mz.lava.some((q) => q[0] === r && q[1] === c);
  const isWall = (r, c) => mz.grid[r][c] === A25.WALL;
  for (let dr = -HALF; dr <= HALF; dr++) for (let dc = -HALF; dc <= HALF; dc++) {
    const r = x + dr, c = y + dc;
    const valid = r >= 0 && r < N && c >= 0 && c < N;
    if (!valid) { i += 6; continue; }            // padding: all six channel values 0 (incl. valid=0)
    v[i++] = isWall(r, c) ? 1 : 0;               // wall (valid=1 handled by the mask channel below)
    v[i++] = isGold(r, c) ? 1 : 0;               // STATIC gold
    v[i++] = isDiam(r, c) ? 1 : 0;               // STATIC diamond
    v[i++] = isLava(r, c) ? 1 : 0;               // lava
    v[i++] = covSet.has(r + ',' + c) ? 1 : 0;    // earlier coverage
    v[i++] = 1;                                  // valid
  }
  return v;
}
const route = A25.routeWithFeatures(featuresA25d);
const chain = A25.chainWith(route);
const buildBase = A25.buildBaseWithFeatures(featuresA25d, FDIM);
module.exports = { FDIM, featuresA25d, route, chain, buildBase, makeMaze: A25.makeMaze, replayVec: A25.replayVec, A25, WALL: A25.WALL };
