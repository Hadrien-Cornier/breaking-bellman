const RLA = require('../src/sim/run.js');
const head = process.argv[2] || 'det', spread = +(process.argv[3] || 0.3);
const s = RLA.session({ world: 'fork', parts: { family: 'ac', source: 'fixed', demos: 'expert', critics: 'none', entropy: 'none', aim: 'copy', head }, seed: 101, hyper: { hidden: [64, 64] }, knobs: { spread } });
s.trainOffline(6000);
const L = s.learner, f = (v) => Array.from(v).map((x) => x.toFixed(2)).join(',');
for (const y of [-0.8, -0.7, -0.6]) console.log('y', y, [-0.2, -0.05, 0, 0.05, 0.2].map((x) => `x${x}:(${f(L.act(Float32Array.of(x, y, -x, 0.8 - y), false))})`).join(' '));
const w = RLA.worlds.fork.make({ maxSteps: 40, obstacle: 0.5, spread, actionNoise: 0 }, RLA.rng.make(9));
let o = w.reset(); const tr = [f(o.slice(0, 2))];
for (let t = 0; t < 40; t++) { const r = w.step(L.act(o, false)); o = r.obs; tr.push(f(o.slice(0, 2))); if (r.done) break; }
console.log(tr.join(' '));
