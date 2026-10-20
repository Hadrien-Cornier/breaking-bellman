'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const RLA = require('../src/sim/run.js');
const exact = require('../src/sim/exact.js');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const engineFiles = ['src/core/rng.js', 'src/core/nn.js', ...['bandit','cliff','cartpole','mirage','goalgrid','pendulum','reach','fork','fetch'].map(x => `src/worlds/${x}.js`), ...['value','pg','ac'].map(x => `src/agents/${x}.js`), 'src/sim/run.js', 'src/sim/autopsy.js'];
const contentFiles = ['web/content.js','web/content2.js','web/content3.js','web/fetch-level.js'];
function source() {
  const files = Object.fromEntries([...engineFiles, ...contentFiles, 'web/rules.js'].map(f => [f, hash(fs.readFileSync(path.join(root, f)))]));
  const group = fs => hash(exact.stringify(Object.fromEntries(fs.map(f => [f, files[f]]))));
  return { files, versions: { engine: group(engineFiles), content: group(contentFiles), scoring: files['src/sim/autopsy.js'], rules: files['web/rules.js'], codec: hash(fs.readFileSync(path.join(root, 'src/sim/exact.js'))) } };
}
function content() {
  const vm = require('node:vm'), context = vm.createContext({ window: {} });
  for (const f of contentFiles) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context);
  return context.window.CONTENT;
}
module.exports = { root, RLA, exact, hash, source, content, engineFiles };
