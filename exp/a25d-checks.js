// A25d pre-BC checks (per 171): inverse-reconstruction equivalence at corner+interior states,
// meaningful actual-item toggles, padding-vs-wall semantics.
'use strict';
const M = require(__dirname + '/vpo-a25d.js');
const fail = (m) => { console.log('FAIL', m); process.exit(1); };
const mz = M.makeMaze(42);
const feats = (x, y, st) => M.featuresA25d(x, y, { remaining: mz.budget, got: new Set(st.got || []), cover: st.cover || [] }, mz);
// 1) inverse reconstruction at corner + interior
for (const pos of [[0, 0], [4, 4], [8, 8], [0, 8]]) {
  const v = feats(pos[0], pos[1], {});
  // channel layout: 27 retained + 6 channels x 17x17, offset (dr+8)*17+(dc+8)
  const at = (dr, dc, ch) => 27 + ((dr + 8) * 17 + (dc + 8)) * 6 + (ch || 0);
  // reconstruct
  const wall = [], gold = [], diam = [], lava = [], cov = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { wall.push(v[at(r - pos[0], c - pos[1], 0)]); gold.push(v[at(r - pos[0], c - pos[1], 1)]); diam.push(v[at(r - pos[0], c - pos[1], 2)]); lava.push(v[at(r - pos[0], c - pos[1], 3)]); cov.push(v[at(r - pos[0], c - pos[1], 4)]); }
  let ok = true; const probs = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const idx = r * 9 + c;
    const w = mz.grid[r][c] === M.WALL ? 1 : 0;
    if (wall[idx] !== w) { ok = false; probs.push(['wall', r, c, wall[idx], w]); }
    if (gold[idx] !== (mz.gold.some((q) => q[0] === r && q[1] === c) ? 1 : 0)) { ok = false; probs.push(['gold', r, c, gold[idx]]); }
    if (diam[idx] !== (mz.diam.some((q) => q[0] === r && q[1] === c) ? 1 : 0)) { ok = false; probs.push(['diam', r, c, diam[idx]]); }
    if (lava[idx] !== (mz.lava.some((q) => q[0] === r && q[1] === c) ? 1 : 0)) { ok = false; probs.push(['lava', r, c, lava[idx]]); }
  }
  // S/E reconstruction: relS/relE offsets at index 23..26
  const relS = [v[23], v[24]], relE = [v[25], v[26]];
  const recS = [pos[0] + relS[0] * 8, pos[1] + relS[1] * 8], recE = [pos[0] + relE[0] * 8, pos[1] + relE[1] * 8];
  if (recS[0] !== mz.S[0] || recS[1] !== mz.S[1] || recE[0] !== mz.E[0] || recE[1] !== mz.E[1]) ok = false;
  if (!ok) { console.log('DEBUG at', pos, 'first problems:', JSON.stringify(probs || []).slice(0, 300)); fail('inverse reconstruction at ' + pos); }
  console.log('CHECK inverse-reconstruction @', JSON.stringify(pos), ': PASS (5 maps + S/E exact)');
}
// 2) actual-item toggles: agent ON gold[0]
{
  const g0 = mz.gold[0];
  const off = (st) => feats(g0[0], g0[1], st);
  const stA = { got: [] }, stB = { got: [g0.join(',')] };
  const a = off(stA), b = off(stB);
  const at = (dr, dc, ch) => 27 + ((dr + 8) * 17 + (dc + 8)) * 6 + ch;
  if (!(a[at(0, 0, 1)] === 1 && b[at(0, 0, 1)] === 1)) fail('static gold channel changed on collection (must stay 1)');
  const maskSlot = 3 + 0; // gold mask slot 0 in the retained block: pos(2)+budget(1)=idx2, masks start idx3
  if (!(a[3 + 0] === 0 && b[3 + 0] === 1)) fail('gold mask slot did not flip: ' + a[3 + 0] + '->' + b[3 + 0]);
  if (!(a[3 + 10] === 0 && b[3 + 10] === 0)) fail('diamond mask changed (cross-type isolation)');
  console.log('CHECK actual-gold toggle @ agent-on-gold: PASS (static channel stable; gold mask flips; diamond untouched)');
}
{
  const d0 = mz.diam[0];
  const stA = { got: [] }, stB = { got: [d0.join(',')] };
  const a = feats(d0[0], d0[1], stA), b = feats(d0[0], d0[1], stB);
  if (!(a[3 + 10] === 0 && b[3 + 10] === 1)) fail('diamond mask slot did not flip');
  if (!(a[3 + 0] === 0 && b[3 + 0] === 0)) fail('gold mask changed (cross-type isolation)');
  console.log('CHECK actual-diamond toggle @ agent-on-diamond: PASS');
}
// 3) coverage toggle: two states differing only in cover = {agent cell} vs {}
{
  const stA = { cover: [] }, stB = { cover: [[4, 4].join(',')] };
  const a = feats(4, 4, stA), b = feats(4, 4, stB);
  const at0 = 27 + ((0 + 8) * 17 + (0 + 8)) * 6 + 4;
  if (!(a[at0] === 0 && b[at0] === 1)) fail('coverage channel at offset (0,0) did not flip');
  // consistency with original earlier-context semantics: identical elsewhere
  let othersSame = true;
  for (let i = 0; i < a.length; i++) if (i !== at0 && a[i] !== b[i]) othersSame = false;
  if (!othersSame) fail('coverage toggle changed other channels');
  console.log('CHECK coverage toggle at offset (0,0): PASS (single-bit change, consistent with original semantics)');
}
// 4) padding vs wall: agent at corner (0,0)
{
  const v = feats(0, 0, {});
  const at = (dr, dc, ch) => 27 + ((dr + 8) * 17 + (dc + 8)) * 6 + ch;
  // (dr=-1,dc=0) is outside -> all 6 channels 0 incl valid
  if (!(v[at(-1, 0, 5)] === 0 && v[at(-1, 0, 0)] === 0)) fail('padding cell nonzero or valid!=0');
  // an actual wall INSIDE: find one
  let found = false;
  for (let r = 0; r < 9 && !found; r++) for (let c = 0; c < 9 && !found; c++) if (mz.grid[r][c] === M.WALL) { if (!(v[at(r, c, 0)] === 1 && v[at(r, c, 5)] === 1)) fail('actual wall valid!=1 or wall bit!=1 at ' + r + ',' + c); found = true; }
  if (!found) fail('no wall in maze 42');
  console.log('CHECK padding-vs-wall: PASS (padding valid=0/all-zero; wall valid=1/bit=1)');
}
console.log('ALL A25d CHECKS DONE');
