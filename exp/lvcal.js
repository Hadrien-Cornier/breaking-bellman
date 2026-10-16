// node exp/lvcal.js configs.json out.json [parallel] -> runs every config with the app's seeds (101, 202, ...), then the autopsy per config
const { execFile } = require('child_process');
const fs = require('fs');
const RLA = require('../src/sim/run.js'); require('../src/sim/autopsy.js');
const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3], P = +(process.argv[4] || 8);
const jobs = [];
for (const c of cfgs) for (let s = 1; s <= (c.seeds || 3); s++) jobs.push(Object.assign({}, c, { seed: s * 101, seeds: undefined }));
const res = {}; let next = 0, running = 0, done = 0; const t0 = Date.now();
const rd = (x) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(3) : x);
function finish() {
  const rows = [];
  for (const c of cfgs) {
    const rs = (res[c.name] || []).filter((r) => !r.error);
    if (!rs.length) { rows.push({ name: c.name, error: (res[c.name] || [])[0] }); continue; }
    const a = RLA.autopsy(rs);
    const s = {}; for (const k in a.summary) if (k !== 'dataset') s[k] = rd(a.summary[k]);
    rows.push({ name: c.name, sec: Math.max(...rs.map((r) => r.sec)), summary: s, symptoms: a.symptoms.map((x) => x.level + ':' + x.id), perSeed: rs.map((r) => rd(r.final ? (r.final.meanRet !== undefined ? r.final.meanRet : null) : null)), notes: rs[0].notes });
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(r.name.padEnd(28), r.error ? 'ERROR ' + JSON.stringify(r.error).slice(0, 300) : JSON.stringify(r.summary) + ' ' + r.symptoms.join(',') + ' ' + r.sec + 's');
}
function launch() {
  while (running < P && next < jobs.length) {
    const j = jobs[next++]; running++;
    execFile('nice', ['node', __dirname + '/full.js', JSON.stringify(j)], { maxBuffer: 1 << 28 }, (err, so, se) => {
      (res[j.name] = res[j.name] || []).push(err ? { error: (se || String(err)).slice(0, 2000) } : JSON.parse(so));
      running--; done++;
      process.stderr.write(`\r${done}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (done === jobs.length) { process.stderr.write('\n'); finish(); } else launch();
    });
  }
}
launch();
