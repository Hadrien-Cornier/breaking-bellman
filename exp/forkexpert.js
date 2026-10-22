// The fork demonstrator alone: success, steps to goal, closest approach to the obstacle.
const RLA = require('../src/sim/run.js');
for (const ro of [0.1, 0.2, 0.3, 0.5, 0.6]) {
  const rng = RLA.rng.make(5); let succ = 0, len = 0, mc = 9, hits = 0;
  for (let e = 0; e < 50; e++) {
    const w = RLA.worlds.fork.make({ maxSteps: 40, obstacle: ro, spread: +(process.argv[2] || 0.05), actionNoise: 0 }, rng);
    let o = w.reset(); const ctx = w.expertStart(rng);
    for (let t = 0; t < 40; t++) { const r = w.step(w.expert(o, ctx)); o = r.obs; mc = Math.min(mc, Math.hypot(o[0], o[1]) - ro); if (r.info.crash) hits++; if (r.done) { succ++; len += t + 1; break; } }
  }
  console.log('obstacle', ro, 'success', succ, '/50, mean steps', (len / Math.max(1, succ)).toFixed(1), 'closest', mc.toFixed(3), 'hits', hits);
}
