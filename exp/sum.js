// node exp/sum.js out.jsonl -> table per name: mean final metrics over seeds
const fs = require('fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const by = {};
for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
const m = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
for (const [name, rs] of Object.entries(by)) {
  const ok = rs.filter((r) => !r.error);
  if (ok.length < rs.length) console.log(name, 'ERRORS', rs.filter((r) => r.error).map((r) => r.error.split('\n').slice(0, 3).join(' | ')));
  if (!ok.length) continue;
  const fin = (k) => ok.map((r) => r.final && r.final[k]).filter((x) => typeof x === 'number');
  const last = (i) => ok.map((r) => r.diag.length ? r.diag[r.diag.length - 1][i] : null).filter((x) => typeof x === 'number');
  const curve = ok[0].curve.map((_, i) => m(ok.map((r) => (r.curve[i] || [])[1]).filter((x) => typeof x === 'number')));
  console.log(`${name.padEnd(28)} ret ${f(m(fin('meanRet')), 1).padStart(8)} [${fin('meanRet').map((x) => f(x, 0)).join(' ')}] succ ${f(m(fin('successRate')))} crash ${f(m(fin('crashRate')))} dist ${f(m(fin('meanDist')), 3)} | qData ${f(m(last(6)), 1)} qPol ${f(m(last(7)), 1)} kl ${f(m(last(2)), 3)} clip ${f(m(last(3)))} ent ${f(m(last(4)))} alpha ${f(m(last(5)), 3)} | ${f(m(ok.map((r) => r.sec)), 0)}s`);
  console.log('   curve', curve.map((x) => f(x, 0)).join(' '));
  if (ok[0].dataset) console.log('   dataset', JSON.stringify(ok[0].dataset));
  if (ok[0].notes && ok[0].notes.length) console.log('   notes', ok[0].notes.join(' / '));
}
