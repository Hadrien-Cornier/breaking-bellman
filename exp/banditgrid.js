// All 16 combinations of the bandit words (eps, ucb, optimistic, step), 200 seeds of 1000 pulls each, as in level 1.
// Prints the share of late pulls on the best machine (optimalLast20) and the mean reward. Simulation.
const RLA = require('../src/sim/run.js'); require('../src/sim/autopsy.js');
global.window = global; window.CONTENT = {}; const fs = require('fs'); eval(fs.readFileSync(__dirname + '/../web/content.js', 'utf8'));
const C = window.CONTENT, hyper = C.hyper.bandit, base = C.levels.find((l) => l.id === 'slots').start;
const rows = [];
for (const eps of [false, true]) for (const ucb of [false, true]) for (const optimistic of [false, true]) for (const step of ['avg', 'const']) {
  const parts = Object.assign({}, base, { eps, ucb, optimistic, step });
  const res = []; for (let i = 1; i <= 200; i++) res.push(RLA.run({ world: 'bandit', parts, hyper, steps: 1000, seed: i * 101 }));
  const a = RLA.autopsy(res);
  const per = res.map((r) => RLA.autopsy([r]).summary.optimalLast20), m = per.reduce((s, x) => s + x, 0) / per.length;
  const se = Math.sqrt(per.reduce((s, x) => s + (x - m) ** 2, 0) / (per.length - 1) / per.length);
  rows.push({ eps, ucb, optimistic, step, best: a.summary.optimalLast20, se, keys: Object.keys(a.summary).join(',') });
}
rows.sort((x, y) => y.best - x.best);
for (const r of rows) console.log(`${r.eps ? 'eps ' : '    '} ${r.ucb ? 'ucb ' : '    '} ${r.optimistic ? 'opt ' : '    '} ${r.step.padEnd(5)}  best machine ${(100 * r.best).toFixed(1)}% ± ${(100 * r.se).toFixed(1)} (standard error over seeds)`);
console.log(rows[0].keys);
