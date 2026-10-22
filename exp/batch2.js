// node exp/batch2.js configs.json out.jsonl [parallel]  -> every config x seed in its own child process
const { execFile } = require('child_process');
const fs = require('fs');
const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3], P = +(process.argv[4] || 8);
const jobs = [];
for (const c of cfgs) for (let s = 1; s <= (c.seeds || 3); s++) jobs.push(Object.assign({}, c, { seed: s * 101, seeds: undefined }));
fs.writeFileSync(out, '');
let next = 0, running = 0, done = 0;
const t0 = Date.now();
function launch() {
  while (running < P && next < jobs.length) {
    const j = jobs[next++]; running++;
    execFile('nice', ['node', __dirname + '/one.js', JSON.stringify(j)], { maxBuffer: 1 << 26 }, (err, so, se) => {
      fs.appendFileSync(out, err ? JSON.stringify({ name: j.name, seed: j.seed, error: (se || String(err)).slice(0, 2000) }) + '\n' : so);
      running--; done++;
      process.stderr.write(`\r${done}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (done === jobs.length) process.stderr.write('\n'); else launch();
    });
  }
}
launch();
