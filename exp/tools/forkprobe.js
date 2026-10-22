// Probe: is the fork test (20 episodes per seed) too small to tell flow from Gaussian? Same training, 200 test starts.
const RLA = require('../../src/sim/run.js');
const rng = require('../../src/core/rng.js');
for (const seed of [101]) {
  const xs = []; for (let k = 0; k < 20; k++) xs.push(rng.make(seed * 31 + 5 + 7919 * (k + 1)).uniform(-0.05, 0.05).toFixed(3));
  console.log('first start x, seed', seed, xs.join(' '));
}
const head = process.argv[2] || 'flow', n = +(process.argv[3] || 200);
for (const seed of [101, 202, 303]) {
  const r = RLA.run({ world: 'fork', parts: { family: 'ac', source: 'fixed', demos: 'expert', critics: 'none', entropy: 'none', aim: 'copy', head }, steps: 6000, seed, hyper: { hidden: [64, 64] }, finalEpisodes: n });
  console.log(head, seed, 'n', r.final.n, 'success', r.final.successRate.toFixed(3), 'crash', r.final.crashRate.toFixed(2));
}
