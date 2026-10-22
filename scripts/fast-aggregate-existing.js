'use strict';
// One-time conversion of a published full-record corpus into seed-aggregate shards.
// Reads the archive, writes the destination records and index, and leaves manifests unchanged.
// node scripts/fast-aggregate-existing.js ARCHIVE_VERSION_DIR DEST_VERSION_DIR PROOF_DIR
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib');
const { exact, hash } = require('./fast-source.js');
require('../src/sim/autopsy.js');
const RLAGG = require('../web/aggregate.js');
const RLA = globalThis.RLA;

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function walk(dir) {
  let files = 0, bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name), st = fs.statSync(p);
    if (st.isDirectory()) { const w = walk(p); files += w.files; bytes += w.bytes; }
    else if (!name.endsWith('.tmp')) { files++; bytes += st.size; }
  }
  return { files, bytes };
}
function dirBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((sum, name) => {
    if (name.endsWith('.tmp')) return sum;
    return sum + fs.statSync(path.join(dir, name)).size;
  }, 0);
}
function manifestsEqual(archive, dest) {
  const left = path.join(archive, 'manifests'), right = path.join(dest, 'manifests');
  const names = fs.readdirSync(left).sort();
  if (names.join() !== fs.readdirSync(right).sort().join()) throw Error('manifest filenames differ');
  for (const name of names) {
    const a = fs.readFileSync(path.join(left, name)), b = fs.readFileSync(path.join(right, name));
    if (!a.equals(b)) throw Error('manifest bytes differ: ' + name);
  }
  return names.reduce((sum, name) => sum + fs.statSync(path.join(left, name)).size, 0);
}
function parity(full, agg) {
  const world = full.config.world, results = full.results;
  const fresh = RLA.autopsy(results);
  if (exact.stringify(agg.view.autopsy) !== exact.stringify(fresh)) return 'autopsy';
  const curves = RLAGG.curvesOf(results, world);
  for (const name of Object.keys(curves)) {
    if (!agg.view.curves[name] || !same(curves[name].xs, agg.view.curves[name].xs) || !same(curves[name].ys, agg.view.curves[name].ys)) return 'curve:' + name;
  }
  for (const name of RLAGG.expectedBands(full.config)) {
    const band = agg.view.bands[name];
    if (!band) return 'missing:' + name;
    if (name === 'ret' && !same(band.mean, curves.main.ys)) return 'mean:ret';
    if (name === 'pred' && !same(band.mean, curves.pred.ys)) return 'mean:pred';
    if (name === 'disc' && !same(band.mean, curves.disc.ys)) return 'mean:disc';
    if (name === 'maxQ' && !same(band.mean, curves.maxQ.ys)) return 'mean:maxQ';
    if (name === 'main' && !same(band.mean, curves.main.ys)) return 'mean:main';
  }
  if (exact.stringify(agg.view.playback) !== exact.stringify(RLAGG.playbackOf(results[0]))) return 'playback';
  if (agg.view.playback.seed !== full.config.seeds[0]) return 'playback-seed';
  if (!Object.is(agg.view.metric.v, RLAGG.metricOf(fresh, world).v)) return 'metric';
  if (agg.view.seedCount !== results.length || agg.view.seedCount !== full.config.seeds.length) return 'seeds';
  if (world === 'bandit' && agg.view.bands.main.xs.length !== full.config.steps) return 'eval-length';
  if (world === 'mirage' && agg.view.bands.main.xs.length !== 100) return 'eval-length';
  if (world !== 'bandit' && world !== 'mirage') {
    const longest = results.reduce((m, r) => Math.max(m, (r.evals || []).length), 0);
    if (agg.view.bands.ret.xs.length !== longest) return 'eval-length';
    if (full.config.family === 'pg') {
      const diag = results.reduce((m, r) => Math.max(m, (r.diag || []).length), 0);
      if (!agg.view.bands.kl || agg.view.bands.kl.xs.length !== diag) return 'diag-length';
    }
  }
  const encoded = exact.stringify(agg);
  if (exact.stringify(exact.parse(encoded)) !== encoded) return 'roundtrip';
  if (!RLAGG.validAggregateRecord(exact.parse(encoded), full.config, full.key)) return 'invalid';
  return null;
}

function convert(archive, dest, proofDir) {
  const indexText = fs.readFileSync(path.join(archive, 'index.json'), 'utf8');
  const index = JSON.parse(indexText);
  if (JSON.stringify(index) !== indexText) throw Error('archive index is not compact JSON');
  if (index.schema !== 'bb-fast-index-v1') throw Error('unexpected index schema');
  const manifestBytes = manifestsEqual(archive, dest);
  fs.mkdirSync(path.join(dest, 'records'), { recursive: true });
  fs.mkdirSync(proofDir, { recursive: true });
  const repDir = path.join(proofDir, 'representatives');
  fs.mkdirSync(repDir, { recursive: true });
  const keys = Object.keys(index.records);
  const progressPath = path.join(proofDir, 'progress.jsonl');
  const done = new Map();
  if (fs.existsSync(progressPath)) {
    for (const line of fs.readFileSync(progressPath, 'utf8').split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line);
      done.set(row.key, row);
    }
  }
  const wantSeeds = new Set([1, 3, 5, 20, 50, 100, 200, 300]);
  const seen = new Set();
  for (const row of done.values()) if (row.representative) seen.add(row.world + '|' + row.family + '|' + row.seeds);
  let maxMirageGap = 0, t0 = Date.now();
  for (let n = 0; n < keys.length; n++) {
    const key = keys[n];
    const sourcePath = path.join(archive, 'records', key + '.json.gz');
    const target = path.join(dest, 'records', key + '.json.gz');
    const sourceStat = fs.statSync(sourcePath);
    const prior = done.get(key);
    if (prior && fs.existsSync(target) && fs.statSync(target).size === prior.bytes && hash(fs.readFileSync(target)) === prior.sha256) {
      if (prior.mirageGap > maxMirageGap) maxMirageGap = prior.mirageGap;
      continue;
    }
    const raw = z.gunzipSync(fs.readFileSync(sourcePath));
    const full = exact.parse(raw.toString());
    if (full.schema !== 'bb-full-results-v1' || full.key !== key) throw Error('archive record is not a full result: ' + key);
    const agg = RLAGG.aggregateRecord(full);
    const problem = parity(full, agg);
    if (problem) throw Error(problem + ' at ' + key);
    const encoded = exact.stringify(agg);
    const shard = z.gzipSync(encoded, { mtime: 0 });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, shard);
    fs.renameSync(tmp, target);
    const gap = full.config.world === 'mirage' ? RLAGG.takenMirageGap() : 0;
    if (gap > maxMirageGap) maxMirageGap = gap;
    const row = {
      key, sha256: hash(shard), bytes: shard.length, raw: Buffer.byteLength(encoded),
      sourceGzip: sourceStat.size, sourceRaw: raw.length,
      world: full.config.world, family: full.config.family, seeds: full.config.seeds.length,
      mirageGap: gap, representative: false,
    };
    const group = row.world + '|' + row.family + '|' + row.seeds;
    if (wantSeeds.has(row.seeds) && !seen.has(group)) {
      seen.add(group);
      const se = RLAGG.metricSE(full.results, row.world);
      if (!Object.is(se, agg.view.metric.se)) throw Error('metric se mismatch at ' + key);
      fs.writeFileSync(path.join(repDir, key + '.json'), exact.stringify({
        key, world: row.world, family: row.family, seedCount: row.seeds, seeds: full.config.seeds.slice(),
        gzipBefore: row.sourceGzip, gzipAfter: row.bytes, decodedBefore: row.sourceRaw, decodedAfter: row.raw,
        mirageGap: gap, metric: agg.view.metric, metricSeRecomputed: se,
        autopsyEqual: true, playbackEqual: true, playbackSeed: agg.view.playback.seed,
        bands: agg.view.bands, curves: agg.view.curves,
      }));
      row.representative = true;
    }
    fs.appendFileSync(progressPath, JSON.stringify(row) + '\n');
    done.set(key, row);
    if ((n + 1) % 25 === 0 || n + 1 === keys.length) {
      const sec = Math.round((Date.now() - t0) / 1000);
      console.log(JSON.stringify({ done: n + 1, of: keys.length, sec, last: row.world + '/' + row.family + '/' + row.seeds }));
    }
  }
  if (!keys.every((key) => done.has(key))) throw Error('progress is missing keys');
  let decodedBefore = 0, decodedAfter = 0, gzipBefore = 0, gzipAfter = 0, reps = 0;
  for (const key of keys) {
    const row = done.get(key);
    if (hash(fs.readFileSync(path.join(dest, 'records', key + '.json.gz'))) !== row.sha256) throw Error('written shard hash mismatch: ' + key);
    index.records[key].sha256 = row.sha256;
    index.records[key].bytes = row.bytes;
    decodedBefore += row.sourceRaw; decodedAfter += row.raw;
    gzipBefore += row.sourceGzip; gzipAfter += row.bytes;
    if (row.representative) reps++;
    if (row.mirageGap > maxMirageGap) maxMirageGap = row.mirageGap;
  }
  const indexBytes = JSON.stringify(index);
  if (JSON.parse(indexBytes).schema !== 'bb-fast-index-v1') throw Error('index schema changed');
  const indexPath = path.join(dest, 'index.json');
  fs.writeFileSync(indexPath + '.tmp', indexBytes);
  fs.renameSync(indexPath + '.tmp', indexPath);
  if (manifestsEqual(archive, dest) !== manifestBytes) throw Error('manifests changed during conversion');
  if (gzipBefore !== dirBytes(path.join(archive, 'records'))) throw Error('archive record bytes do not match the directory');
  if (gzipAfter !== dirBytes(path.join(dest, 'records'))) throw Error('written record bytes do not match the directory');
  if (fs.readdirSync(path.join(dest, 'records')).filter((name) => !name.endsWith('.tmp')).length !== keys.length) throw Error('record count mismatch');
  const beforeIndex = fs.statSync(path.join(archive, 'index.json')).size;
  const afterIndex = fs.statSync(indexPath).size;
  const summary = {
    label: 'Measured',
    archive: archive,
    archiveFiles: walk(archive),
    destination: dest,
    before: {
      records: gzipBefore, index: beforeIndex, manifests: manifestBytes,
      total: gzipBefore + beforeIndex + manifestBytes, keys: keys.length, decoded: decodedBefore,
    },
    after: {
      records: gzipAfter, index: afterIndex, manifests: manifestBytes,
      total: gzipAfter + afterIndex + manifestBytes, keys: keys.length, decoded: decodedAfter,
    },
    destinationFiles: walk(dest),
    parity: {
      keys: keys.length, autopsyMismatches: 0, curveMismatches: 0, playbackMismatches: 0,
      meanMismatches: 0, evalLengthMismatches: 0, maxMirageGap, representatives: reps,
    },
  };
  fs.writeFileSync(path.join(proofDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (require.main === module) {
  const [archive, dest, proofDir] = process.argv.slice(2);
  if (!archive || !dest || !proofDir) {
    console.error('usage: node scripts/fast-aggregate-existing.js ARCHIVE_VERSION_DIR DEST_VERSION_DIR PROOF_DIR');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(convert(archive, dest, proofDir), null, 2));
  } catch (error) {
    console.error(error && error.stack || error);
    process.exit(1);
  }
}
module.exports = { convert };
