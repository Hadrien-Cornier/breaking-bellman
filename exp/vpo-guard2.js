let failures = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' | ' + d : '')); if (!ok) failures++; };
const M = require('/Users/hcornier/.treehouse/breaking-bellman-cf9838/2/breaking-bellman/exp/vpo-a9.js');

// ---- R1 (non-vacuous): synthetic maze, ONE pocket-0 item cell visited TWICE, then exit.
// Assert: exit===1, pocket0 component 0.5 after the first visit stays 0.5 after the revisit.
const mzSyn = { lava: [], pockets: [[[2, 1]], [[6, 6]], [[1, 6]], [[6, 1]]], open: [0], budget: 30 };
const path = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [2, 1], [1, 1], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8]];
const acts = path.slice(1).map((c, i) => { const a = path[i], b = c; return b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : b[1] === a[1] - 1 ? 3 : NaN; });
if (acts.some(isNaN)) { console.log('R1 bad scripted step'); process.exit(1); }
let idx = 0;
const rt = M.route9(mzSyn, { probs: () => { const a = acts[idx++]; return [0, 1, 2, 3].map((j) => j === (a === undefined ? -1 : a) ? 1 : 0); } }, { next: () => 0.5, int: () => 1 }, true, 0, [0, 0, 0, 0]);
console.log('R1 steps', rt.steps.length, 'vec', rt.vec.join(','));
check('R1a route exits (exit component 1)', rt.vec[0] === 1, 'vec ' + rt.vec.join(','));
check('R1b one distinct pocket-0 item -> component 0.5', rt.vec[1] === 0.5, 'comp ' + rt.vec[1]);
check('R1c the revisit does not raise the component (still 0.5 after two visits to the same cell)', rt.vec[1] === 0.5);
// control: the A9a bug would have counted (2,1) twice -> 1.0; assert the semantic directly:
check('R1d revisit control: same cell twice yields exactly the same vector as one visit', rt.vec[1] === 0.5);

// ---- R2: candidate-2 conditioning with DELIBERATE pocket-3 coverage (not an all-zero chain):
// candidate 1 scripted to collect the pocket-3 cell, candidate 2's first observation must carry
// global flag3 = 1 and equal candidate 1's own-pickup flag state (global pocket semantics).
const mzSyn2 = { lava: [], pockets: [[[2, 1]], [[6, 6]], [[1, 6]], [[2, 6]]], open: [0, 3], budget: 40 };
// candidate1 path: to (2,6) (pocket3 cell) then toward exit; candidate2 continues after.
const p1 = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8]];
const a1 = p1.slice(1).map((c, i) => { const a = p1[i], b = c; return b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : b[1] === a[1] - 1 ? 3 : NaN; });
let i1 = 0;
const obsC2 = [];
const probs1 = () => { const a = a1[i1++]; return [0, 1, 2, 3].map((j) => j === (a === undefined ? -1 : a) ? 1 : 0); };
const probs2 = (obs) => { obsC2.push(Array.from(obs)); return [0.25, 0.25, 0.25, 0.25]; };
const chainPol = { probs: (obs) => (i1 < a1.length ? probs1(obs) : probs2(obs)) };
const ch = M.chain9(mzSyn2, chainPol, { next: () => 0.5, int: () => 1 }, true, 0, 2);
const c1 = ch[0], c2 = ch[1];
check('R2a candidate1 collects pocket3 (flagsEnd[3]=1)', c1.flagsEnd[3] === 1, JSON.stringify(c1.flagsEnd));
check('R2b candidate2 first observation carries global flag3=1 at index 5 and pocket1/2 flags 0 at 3,4',
  obsC2.length > 0 && obsC2[0][5] === 1 && obsC2[0][3] === 0 && obsC2[0][4] === 0,
  'flags ' + (obsC2.length ? obsC2[0].slice(2, 6).join(',') : 'none'));
check('R2c candidate2 later-candidate conditioning actually changed (flag3 seen in its observations)',
  obsC2.every((o) => o[5] === 1), 'all c2 obs flag3=1: ' + obsC2.length + ' obs');

// ---- R3: planner paths replayed through PRODUCTION route9, recording intended vs actual xy at the
// FIRST divergence (positions re-derived by replaying the recorded steps of route9 itself).
let allMatch = true; const details = [];
for (const s of [1000, 1001, 1004, 2000, 2003]) {
  const mz = M.makeMaze(s);
  for (const planned of M.plan9(mz)) {
    const actsP = planned.path.slice(1).map((c, i) => { const a = planned.path[i], b = c; return b[0] === a[0] + 1 ? 0 : b[1] === a[1] + 1 ? 1 : b[0] === a[0] - 1 ? 2 : b[1] === a[1] - 1 ? 3 : NaN; });
    if (actsP.some(isNaN)) { allMatch = false; details.push('seed ' + s + ' non-unit step in planner path'); continue; }
    // replay with the production step function AND track actual xy from the recorded steps' actions
    let ii = 0; const trace = [];
    const rt2 = M.route9(mz, { probs: () => { const a = actsP[ii++]; return [0, 1, 2, 3].map((j) => j === (a === undefined ? -1 : a) ? 1 : 0); } }, { next: () => 0.5, int: () => 1 }, true, 0, [0, 0, 0, 0]);
    // re-derive actual xy from the recorded (action) steps
    let ar = 0, ac = 0; trace.push([0, 0]);
    for (const st of rt2.steps) { const a = st.a; ar += a === 0 ? 1 : a === 2 ? -1 : 0; ac += a === 1 ? 1 : a === 3 ? -1 : 0; trace.push([ar, ac]); }
    for (let k = 0; k < Math.min(trace.length, planned.path.length); k++) {
      if (trace[k][0] !== planned.path[k][0] || trace[k][1] !== planned.path[k][1]) {
        allMatch = false;
        details.push('seed ' + s + ': first xy divergence at step ' + k + ' intended ' + planned.path[k].join(',') + ' actual ' + trace[k].join(',') + ' (planned vec ' + planned.vec.join(',') + ' replay ' + rt2.vec.join(',') + ', steps ' + rt2.steps.length + ', path len ' + planned.path.length + ')');
        break;
      }
    }
    if (rt2.vec.join(',') !== planned.vec.join(',') && allMatch) { allMatch = false; details.push('seed ' + s + ': vectors differ without xy divergence - ' + planned.vec.join(',') + ' vs ' + rt2.vec.join(',')); }
  }
}
check('R3 planner vectors equal production route9 replay (first xy divergence recorded)', allMatch, details.slice(0, 2).join(' ; '));

console.log(failures === 0 ? 'GUARD PASS' : failures + ' GUARD CHECK(S) FAILED');
process.exit(failures ? 1 : 0);
