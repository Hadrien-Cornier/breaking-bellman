// node exp/batch.js configs.json [parallel]  -> runs each config (all seeds) in a child process, prints summaries.
const { execFile } = require('child_process');
const fs = require('fs');
const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const P = +(process.argv[3] || 8);
let next = 0, running = 0;
const outs = new Array(cfgs.length);
function launch() {
  while (running < P && next < cfgs.length) {
    const i = next++, c = cfgs[i]; running++;
    execFile('nice', ['node', __dirname + '/smoke.js', c.world, JSON.stringify(c.parts), String(c.steps), String(c.seeds), JSON.stringify(c.knobs || {}), JSON.stringify(c.hyper || {})],
      { maxBuffer: 1 << 24 }, (err, so, se) => {
        outs[i] = '== ' + (c.name || i) + '\n' + so + (err ? se : '');
        running--; if (next >= cfgs.length && running === 0) { console.log(outs.join('\n')); } else launch();
      });
  }
}
launch();
