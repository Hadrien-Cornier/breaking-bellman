// Diagnose fork failures: where does a cloned policy hit the obstacle? Side flips, first-hit height, stuck time.
const RLA = require('../../src/sim/run.js');
const head = process.argv[2] || 'flow', ro = +(process.argv[3] || 0.5);
const s = RLA.session({ world: 'fork', parts: { family: 'ac', source: 'fixed', demos: 'expert', critics: 'none', entropy: 'none', aim: 'copy', head }, seed: 101, hyper: { hidden: [64, 64] }, knobs: { obstacle: ro } });
s.trainOffline(6000);
const W = RLA.worlds.fork; const rng = RLA.rng.make(77);
let succ = 0, flips = 0, hitY = [], stuck = 0, minClear = [];
for (let e = 0; e < 100; e++) {
  const w = W.make({ maxSteps: 40, obstacle: ro, spread: 0.05, actionNoise: 0 }, rng);
  let o = w.reset(), side = 0, f = 0, first = null, hits = 0, mc = 9;
  for (let t = 0; t < 40; t++) {
    const a = s.learner.act(o, false); const r = w.step(a); o = r.obs;
    const x = o[0], y = o[1]; mc = Math.min(mc, Math.hypot(x, y) - ro);
    if (y > -0.6 && y < 0.5) { const sd = Math.sign(x); if (side && sd !== side) f++; side = sd; }
    if (r.info.crash) { hits++; if (first === null) first = [x.toFixed(2), y.toFixed(2)]; }
    if (r.done) { succ++; break; }
  }
  flips += f > 0; if (first) hitY.push(first.join(',')); stuck += hits; minClear.push(mc);
}
minClear.sort((a, b) => a - b);
console.log(head, 'ro', ro, 'success', succ, '/100; episodes with a side flip', flips, '; hits/ep', (stuck / 100).toFixed(1), '; min clearance median', minClear[50].toFixed(3));
console.log('first hit points (x,y):', hitY.slice(0, 25).join(' '));
