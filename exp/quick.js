// quick: node exp/quick.js '<json cfg>'  -> prints evals and timing
const RLA = require('../src/sim/run.js');
const cfg = JSON.parse(process.argv[2]);
const t0 = Date.now();
const res = RLA.run(cfg);
const ms = Date.now() - t0;
const ev = res.evals.map((e) => `${e.t}:${e.ret.toFixed(1)}${e.success !== undefined ? '/' + e.success.toFixed(2) : ''}`);
console.log(JSON.stringify({ world: cfg.world, parts: cfg.parts, seed: cfg.seed, ms, notes: res.notes, final: res.final && Object.fromEntries(Object.entries(res.final).filter(([k]) => k !== 'paths')), dataset: res.dataset, lastDiag: res.diag[res.diag.length - 1] }));
console.log(ev.join(' '));
