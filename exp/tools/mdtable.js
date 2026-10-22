// node exp/tools/mdtable.js out.json -> a Markdown table of every config: the numbers the page quotes
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const f = (x, d) => (typeof x === 'number' && isFinite(x) ? x.toFixed(d) : '-');
console.log('| Run | World | Final (eval) | Test | Worst seed | Success | Hits | Left | Dist (m) | Base test | KL | Symptoms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
for (const r of rows) {
  const c = cfg.find((x) => x.name === r.name) || {};
  const s = r.summary || {};
  console.log(`| ${r.name} | ${c.world}${c.knobs ? ' ' + JSON.stringify(c.knobs).replace(/"/g, '') : ''} | ${f(s.finalReturn, 1)} | ${f(s.testReturn, 1)} | ${f(s.worstSeed, 1)} | ${f(s.successRate, 2)} | ${f(s.crashRate, 1)} | ${f(s.leftRate, 2)} | ${f(s.meanDist, 3)} | ${f(s.baseRet, 1)} | ${f(s.kl, 3)} | ${(r.symptoms || []).join(' ')} |`);
}
