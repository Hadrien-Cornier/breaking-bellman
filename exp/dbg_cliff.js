require('../src/sim/run.js');
const RLA = globalThis.RLA;
const r = RLA.run({ world: 'cliff', parts: { repr: 'table', target: process.argv[2] || 'td', explore: 'epsilon' }, steps: +(process.argv[3]||10000), seed: 101, hyper: { epsStart: 0.1, epsEnd: 0.1, lrTable: +(process.argv[4]||0.5) } });
console.log('episodes', r.ep.ret.length, 'last rets', r.ep.ret.slice(-10).join(' '));
const t = r.table, W = 12, ch = '^>v<';
for (let row = 0; row < 4; row++) { let s = ''; for (let c = 0; c < W; c++) { const i = (row * W + c) * 4; let b = 0; for (let a = 1; a < 4; a++) if (t[i + a] > t[i + b]) b = a; s += ch[b] + (t[i+b]).toFixed(0).padStart(5) + ' '; } console.log(s); }
console.log('trace', r.trace.slice(0, 20).map((x) => x.a + ':' + x.s).join(' '));
console.log('evals', r.evals.map((e) => e.ret.toFixed(0)).join(' '));
