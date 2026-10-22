// node exp/full.js '<cfg json>' -> the full result of one run (for the autopsy), without the drawn paths
const RLA = require('../src/sim/run.js');
const cfg = JSON.parse(process.argv[2]);
const t0 = Date.now();
const r = RLA.run(cfg);
if (r.final) { delete r.final.paths; delete r.final.qA; delete r.final.qB; }
for (const e of r.evals || []) { delete e.trace; delete e.path; delete e.start; }
console.log(JSON.stringify(Object.assign(r, { name: cfg.name, sec: (Date.now() - t0) / 1000 })));
