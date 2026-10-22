// Why does "the worst next action" still learn on CartPole, and why does it fail on the cliff? (16 Oct 2026, page comment)
// 1. CartPole: the fastest fall. From 200 start states, the fewest steps until the pole falls when every push is chosen to
//    make it fall (exhaustive search over push sequences, depth 14). Compare with Q at the start of DQN + worst next action.
// 2. Cliff: Q-learning with the worst next action, 20 runs x 10000 steps: how many greedy tests reach the goal, and where it stays.
const RLA = require('../../src/sim/run.js');
global.window = global; window.CONTENT = {}; const fs = require('fs');
for (const f of ['content.js', 'content2.js']) eval(fs.readFileSync(__dirname + '/../../web/' + f, 'utf8'));
const C = window.CONTENT;
// 1
const W = RLA.worlds.cartpole, K = RLA.knobDefaults('cartpole');
const w = W.make(K, RLA.rng.make(7));
function fastest(depth) { // fewest steps to a fall from the current state, or Infinity within depth
  if (depth === 0) return Infinity;
  const s0 = w.getState(); let best = Infinity;
  for (const a of [0, 1]) {
    w.setState(s0); const r = w.step(a);
    const n = r.done ? 1 : 1 + fastest(depth - 1);
    if (n < best) best = n;
    if (best === 1) break;
  }
  w.setState(s0); return best;
}
const falls = []; for (let i = 0; i < 200; i++) { w.reset(); falls.push(fastest(14)); }
const fin = falls.filter(isFinite), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, g = 0.99;
const val = mean(fin.map((n) => (1 - Math.pow(g, n)) / (1 - g)));
console.log(`CartPole fastest fall from the start: mean ${mean(fin).toFixed(2)} steps (min ${Math.min(...fin)}, max ${Math.max(...fin)}, ${falls.length - fin.length} of 200 deeper than 14). Discounted reward of that fall: ${val.toFixed(2)}.`);
// 2
const parts = C.cfg({ agg: 'min' }), hyper = C.hyperOf(parts, 'cliff');
let reach = 0, rets = [];
for (let s = 1; s <= 20; s++) {
  const r = RLA.run({ world: 'cliff', parts, hyper, steps: 10000, seed: s * 101, finalEpisodes: 1 });
  rets.push(r.final.ret); if (r.final.ret > -200) reach++;
}
console.log(`Cliff, worst next action: greedy test reaches the goal in ${reach} of 20 runs; mean greedy score ${mean(rets).toFixed(1)}.`);
// 3. Cliff, where the greedy policy goes: train with a session, then walk greedily 200 steps and count rows visited.
{
  const rows = [0, 0, 0, 0]; let cliffSide = 0, n = 0;
  for (let s = 1; s <= 20; s++) {
    const ss = RLA.session({ world: 'cliff', parts, hyper, seed: s * 101 }); ss.advance(10000);
    const wc = RLA.worlds.cliff.make(RLA.knobDefaults('cliff'), RLA.rng.make(1)); let o = wc.reset();
    for (let t = 0; t < 200; t++) { const r = wc.step(ss.learner.act(o, false)); const p = r.info.pos; rows[p[0]]++; n++; if (p[0] === 2) cliffSide++; if (r.done || r.truncated) break; o = r.obs; }
  }
  console.log('Cliff, worst next action, greedy walk: share of steps per row (row 0 top, row 3 bottom with the cliff):', rows.map((c) => (100 * c / n).toFixed(0) + '%').join(' '));
}
