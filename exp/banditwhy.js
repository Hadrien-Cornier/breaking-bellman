// Why does UCB lose with a fixed share? Compare ucb+avg, ucb+const, ucb+opt+const, opt+const over 200 seeds of 1000 pulls.
// For each: late pulls (last 200) on the best machine, on the second best, and the error of the final estimates of those two machines. Simulation.
const RLA = require('../src/sim/run.js');
global.window = global; window.CONTENT = {}; const fs = require('fs'); eval(fs.readFileSync(__dirname + '/../web/content.js', 'utf8'));
const C = window.CONTENT, hyper = C.hyper.bandit, base = C.levels.find((l) => l.id === 'slots').start;
const combos = [['ucb avg', { ucb: true, step: 'avg' }], ['ucb const', { ucb: true, step: 'const' }], ['ucb opt const', { ucb: true, optimistic: true, step: 'const' }],
  ['opt const', { optimistic: true, step: 'const' }], ['opt avg', { optimistic: true, step: 'avg' }], ['greedy const', { step: 'const' }]];
for (const [name, o] of combos) {
  const parts = Object.assign({}, base, { eps: false, ucb: false, optimistic: false }, o);
  let best = 0, second = 0, errB = 0, errS = 0, gap = 0, switches = 0, firstHalfBest = 0; const N = 200;
  for (let i = 1; i <= N; i++) {
    const s = RLA.session({ world: 'bandit', parts, hyper, seed: i * 101 });
    const means = Array.from(s.world.means), order = means.map((m, k) => k).sort((a, b) => means[b] - means[a]);
    let prev = -1;
    for (let t = 0; t < 1000; t++) {
      const m = s.advance(1);
      if (t >= 800) { if (m.a === order[0]) best++; if (m.a === order[1]) second++; if (prev >= 0 && m.a !== prev) switches++; }
      prev = m.a;
    }
    const q = s.learner.q(s.world.reset());
    errB += Math.abs(q[order[0]] - means[order[0]]); errS += Math.abs(q[order[1]] - means[order[1]]); gap += means[order[0]] - means[order[1]];
  }
  const L = 200 * N;
  console.log(`${name.padEnd(14)} late pulls: best ${(100 * best / L).toFixed(1)}%, 2nd best ${(100 * second / L).toFixed(1)}%, machine changes per late pull ${(switches / L).toFixed(3)}; final |Q - true mean|: best ${(errB / N).toFixed(3)}, 2nd ${(errS / N).toFixed(3)}; mean gap best-2nd ${(gap / N).toFixed(3)}`);
}
