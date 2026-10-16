// node exp/one.js '<cfg json>' -> one JSON line: config, timing, final, curve (every 4th eval), diag summary
const RLA = require('../src/sim/run.js');
const cfg = JSON.parse(process.argv[2]);
const t0 = Date.now();
const r = RLA.run(cfg);
const fin = r.final ? Object.fromEntries(Object.entries(r.final).filter(([k]) => k !== 'paths' && k !== 'qA' && k !== 'qB')) : null;
const pick = (arr, f) => arr.filter((_, i) => i % 4 === 3 || i === arr.length - 1).map(f);
const rd = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : +(+x).toFixed(3));
console.log(JSON.stringify({ name: cfg.name, world: cfg.world, parts: cfg.parts, knobs: cfg.knobs, hyper: cfg.hyper, seed: cfg.seed, steps: cfg.steps, sec: (Date.now() - t0) / 1000,
  notes: r.notes, dataset: r.dataset, final: fin,
  curve: pick(r.evals, (e) => [e.t, rd(e.ret), rd(e.success), rd(e.dist), rd(e.pred), rd(e.disc)]),
  diag: pick(r.diag, (d) => [d.t, rd(d.loss), rd(d.kl), rd(d.clipFrac), rd(d.entropy), rd(d.alpha), rd(d.qData), rd(d.qPolicy)]),
  epTail: r.ep.ret.slice(-20).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(20, r.ep.ret.length)) }));
