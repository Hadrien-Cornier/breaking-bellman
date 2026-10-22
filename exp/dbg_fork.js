// node exp/dbg_fork.js head chunk steps hidden -> sampled first actions at the start state, and test success
const RLA = require('../src/sim/run.js');
const [head, chunk, steps, hid] = [process.argv[2] || 'flow', +(process.argv[3] || 1), +(process.argv[4] || 6000), +(process.argv[5] || 32)];
const W = RLA.worlds.fork, knobs = Object.assign(RLA.knobDefaults('fork'), JSON.parse(process.argv[6] || '{}'));
const world = W.make(knobs, RLA.rng.make(7));
const L = RLA.ac.make({ family: 'ac', source: 'fixed', demos: 'expert', head, chunk, aim: 'copy', critics: 'none', entropy: 'none' }, world, RLA.rng.make(3), { hidden: [hid, hid] });
const t0 = Date.now();
for (let i = 0; i < steps; i++) L.train();
const o = Float32Array.of(0.05, -0.8, -0.05, 1.6);
const xs = L.sample(o, 200).map((a) => a[0]);
const bins = new Array(10).fill(0); for (const x of xs) bins[Math.min(9, Math.floor((x + 1) / 0.2))]++;
const line1 = [head, 'chunk', chunk, 'steps', steps, 'h', hid, process.argv[6] || '', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'vx hist:', bins.join(' ')].join(' ');
let succ = 0, cr = 0; const rng = RLA.rng.make(11);
for (let e = 0; e < 30; e++) {
  const w = W.make(knobs, rng); let ob = w.reset(); L.beginEpisode();
  for (;;) { const r = w.step(L.act(ob, false)); if (r.info.crash) cr++; if (r.info.success) succ++; ob = r.obs; if (r.done || r.truncated) break; }
}
console.log(line1, '| success', (succ / 30).toFixed(2), 'crashes/test', (cr / 30).toFixed(2));
