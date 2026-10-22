// node exp/qgap.js -> after Q-planning training on the fork, the critic's values of 8 proposals at states along a test path:
// how far apart are they, compared with the temperature λ = 1 of the Q-weighted average?
const RLA = require('../src/sim/run.js');
const parts = { family: 'ac', source: 'both', demos: 'expert', head: 'flow', aim: 'none', critics: 'two', next: 'data', entropy: 'none', pick: 'qavg' };
const s = RLA.session({ world: 'fork', parts, hyper: { hidden: [64, 64], pretrain: 8000 }, seed: 101 });
s.advance(4000);
const L = s.learner, w = s.world;
let o = w.reset(); const gaps = [];
for (let t = 0; t < 40; t++) {
  const props = L.sample(o, 8), q = props.map((a) => L.qOf(o, a));
  const gap = Math.max(...q) - Math.min(...q), ws = q.map((x) => Math.exp(x)), z = ws.reduce((a, b) => a + b, 0);
  gaps.push(gap);
  if (t % 5 === 0) console.log('t', t, 'actions x', props.map((a) => a[0].toFixed(2)).join(' '), '| Q', q.map((x) => x.toFixed(2)).join(' '), '| max weight', (Math.max(...ws) / z).toFixed(2));
  const r = w.step(L.act(o, false)); o = r.obs; if (r.done || r.truncated) break;
}
gaps.sort((a, b) => a - b);
console.log('Q gap among 8 proposals: median', gaps[gaps.length >> 1].toFixed(3), 'max', gaps[gaps.length - 1].toFixed(3));
