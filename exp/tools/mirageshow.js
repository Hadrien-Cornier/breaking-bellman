// What the mirage looks like, for the "What is the mirage?" drawer (16 Oct 2026, from a page comment).
// Q-learning, Expected Sarsa (sometimes at random, eps 0.1) and Double Q-learning on the mirage, 300 runs x 600 steps.
// For each: left-door share at the worst point (autopsy), mean max and mean of the 10 machine estimates Q(B,.)
// and Q(A, left) after episode 30, and the run time. Simulation.
const RLA = require('../../src/sim/run.js'); require('../../src/sim/autopsy.js');
global.window = global; window.CONTENT = {}; const fs = require('fs'); eval(fs.readFileSync(__dirname + '/../../web/content.js', 'utf8'));
const C = window.CONTENT, hyper = C.hyper.mirage, base = C.levels.find((l) => l.id === 'mirage').start;
const learners = [['Q-learning', {}], ['Expected Sarsa', { agg: 'mean', scorer: 'live' }], ['Expected Sarsa, never at random', { agg: 'mean', scorer: 'live', eps: false }], ['Double Q-learning', { agg: 'max', picker: 'live', scorer: 'second' }]];
const N = 300, SNAP = 30;
for (const [name, o] of learners) {
  const parts = Object.assign({}, base, o);
  const t0 = Date.now();
  const results = []; for (let i = 1; i <= N; i++) results.push(RLA.run({ world: 'mirage', parts, hyper, steps: 600, seed: i }));
  const ms = Date.now() - t0;
  const a = RLA.autopsy(results);
  let mx = 0, mn = 0, qa = 0;
  for (let i = 1; i <= N; i++) {
    const s = RLA.session({ world: 'mirage', parts, hyper, seed: i });
    let ep = 0; while (ep < SNAP) { const m = s.advance(1); if (m.done || m.truncated) ep++; }
    const qB = Array.from(s.learner.q(Float32Array.from([0, 1]))).slice(0, 10), qA = s.learner.q(Float32Array.from([1, 0]));
    mx += Math.max(...qB); mn += qB.reduce((x, y) => x + y, 0) / 10; qa += qA[1];
  }
  console.log(`${name.padEnd(32)} left at worst ${(100 * a.summary.leftPeak).toFixed(1)}%, at end ${(100 * a.summary.leftLate).toFixed(1)}%; after ${SNAP} episodes: max Q(B) ${(mx / N).toFixed(3)}, mean Q(B) ${(mn / N).toFixed(3)}, Q(A,left) ${(qa / N).toFixed(3)} (true -0.1); ${N} runs in ${ms} ms`);
}
