'use strict';
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib');
const { RLA, exact, hash, source } = require('./fast-source.js');
const { manifestPath, output, key } = JSON.parse(process.argv[2]);
const manifest = exact.parse(fs.readFileSync(manifestPath, 'utf8'));
if (exact.stringify(manifest.versions) !== exact.stringify(source().versions)) throw Error('source version mismatch');
const entry = manifest.entries.find(e => e.key === key);
if (!entry || hash(exact.stringify(entry.config)) !== key) throw Error('invalid exact key');
const dir = path.join(output, 'seeds', key); fs.mkdirSync(dir, { recursive: true });
function atomic(file, bytes) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); }
const results = [], started = Date.now(), usage = process.cpuUsage();
for (let i = 0; i < entry.config.seeds.length; i++) {
  const seed = entry.config.seeds[i], file = path.join(dir, i + '.json.gz');
  let result;
  if (fs.existsSync(file)) {
    result = exact.parse(z.gunzipSync(fs.readFileSync(file)).toString());
    if (result.seed !== seed || result.steps !== entry.config.steps || result.world !== entry.config.world) throw Error('corrupt seed checkpoint');
  } else {
    result = RLA.run(exact.runConfig(entry.config, seed));
    atomic(file, z.gzipSync(exact.stringify(result)));
  }
  results.push(result);
}
const record = { schema: 'bb-full-results-v1', key, config: entry.config, results };
const encoded = exact.stringify(record), packed = z.gzipSync(encoded);
// Includes every field, undefined, typed arrays, nonfinite numbers, all seeds and original traces.
if (exact.stringify(exact.parse(encoded)) !== encoded) throw Error('result roundtrip mismatch');
fs.mkdirSync(path.join(output, 'records'), { recursive: true });
atomic(path.join(output, 'records', key + '.json.gz'), packed);
const cpu = process.cpuUsage(usage);
console.log(JSON.stringify({ key, seeds: results.length, rawBytes: Buffer.byteLength(encoded), gzipBytes: packed.length,
  sha256: hash(packed), cpuSeconds: (cpu.user + cpu.system) / 1e6, wallSeconds: (Date.now() - started) / 1000,
  maxRSSKiB: process.resourceUsage().maxRSS, pid: process.pid }));
