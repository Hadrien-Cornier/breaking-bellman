// Probe: what lifts flow behavior cloning on the fork above 68 % success? 200 test starts per seed.
const RLA = require('../../src/sim/run.js');
const [tag, chunk, steps, hid] = [process.argv[2], +(process.argv[3] || 1), +(process.argv[4] || 6000), process.argv[5] || '64,64'];
const head = process.argv[6] || 'flow', spread = process.argv[7] === undefined ? 0.05 : +process.argv[7];
const out = [];
for (const seed of [101, 202, 303]) {
  const t0 = Date.now();
  const r = RLA.run({ world: 'fork', parts: { family: 'ac', source: 'fixed', demos: 'expert', critics: 'none', entropy: 'none', aim: 'copy', head, chunk }, steps, seed, hyper: { hidden: hid.split(',').map(Number) }, finalEpisodes: 200, knobs: { spread } });
  out.push(`${seed}: ${(r.final.successRate * 100).toFixed(0)}% / ${r.final.crashRate.toFixed(1)} hits (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
console.log(tag, head, 'spread', spread, 'chunk', chunk, 'steps', steps, 'hidden', hid, '|', out.join(' | '));
