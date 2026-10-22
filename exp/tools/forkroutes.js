// Dump demonstrator paths of the old (one waypoint) and new (two waypoints) fork routes, for the figure.
const out = {};
for (const [tag, file] of [['old', process.argv[2]], ['new', '../../src/worlds/fork.js']]) {
  const F = require(file);
  const rng = require('../../src/core/rng.js').make(5);
  out[tag] = [];
  let crashEp = 0;
  const w = F.make({ maxSteps: 40, obstacle: 0.5, spread: 0.05, actionNoise: 0 }, rng);
  for (let e = 0; e < 50; e++) {
    let o = w.reset(); const ctx = w.expertStart ? w.expertStart(rng) : { side: e % 2 ? 1 : -1 };
    let crashed = false;
    for (let t = 0; t < 40; t++) { const r = w.step(w.expert(o, ctx)); o = r.obs; if (r.info.crash) crashed = true; if (r.done) break; }
    if (crashed) crashEp++;
    if (e < 12) out[tag].push({ path: w.trail(), crashed });
  }
  out[tag + 'Crash'] = crashEp;
}
console.log(JSON.stringify(out));
