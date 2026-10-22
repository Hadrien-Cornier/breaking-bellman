'use strict';
// Seed aggregates keep the chart mean, the autopsy and the first seed's replay.
const { test } = require('node:test'), assert = require('node:assert/strict'), z = require('node:zlib');
const { RLA, exact, hash, source, content } = require('../scripts/fast-source.js');
require('../src/sim/autopsy.js');
const RLAGG = require('../web/aggregate.js');
const { create } = require('../web/fast.js');
const C = content(), versions = source().versions;

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function train(id, seeds, steps) {
  const lv = C.levels.find((l) => l.id === id);
  const config = exact.resolve({
    world: lv.world, parts: lv.start, knobs: lv.knobs,
    hyper: Object.assign({}, C.hyperOf(lv.start, lv.world), lv.hyper || {}), steps,
  }, seeds, versions, C);
  const key = hash(exact.stringify(config));
  const results = config.seeds.map((seed) => RLA.run(exact.runConfig(config, seed)));
  const full = { schema: 'bb-full-results-v1', key, config, results };
  return { config, key, results, full, agg: RLAGG.aggregateRecord(full) };
}
function handQuantile(sorted, p) {
  const x = p * (sorted.length - 1), i = Math.floor(x), f = x - i;
  return sorted[i] * (1 - f) + sorted[Math.min(sorted.length - 1, i + 1)] * f;
}

test('chart mean and linear quantile are the stored numbers', () => {
  const curve = RLAGG.meanCurve([[{ t: 1, v: 2 }, { t: 5, v: 8 }], [{ t: 1, v: 4 }, { t: 5, v: 0 }]]);
  assert.deepEqual(curve.xs, [1, 5]);
  assert.deepEqual(curve.ys, [3, 4]);
  const skipped = RLAGG.meanCurve([[{ t: 1, v: 1 }, { t: 2, v: NaN }], [{ t: 1, v: 3 }, { t: 2, v: 7 }]]);
  assert.equal(skipped.ys[0], 2);
  assert.equal(skipped.ys[1], 7);
  assert.equal(RLAGG.quantile([10, 20, 30, 40], 0), 10);
  assert.equal(RLAGG.quantile([10, 20, 30, 40], 1), 40);
  assert.equal(RLAGG.quantile([10, 20, 30, 40], 0.5), 25);
  assert.equal(RLAGG.quantile([10, 20, 30, 40], 0.25), 17.5);
  assert.equal(RLAGG.statsOf([2, 4]).std, Math.sqrt(2));
  assert.equal(RLAGG.statsOf([5]).std, 0);
});

test('short runs keep every drawn curve, the autopsy and the first seed replay', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 101);
  const runs = [
    train('slots', [101, 202, 303], 24),
    train('cliff', [101, 202, 303, 404, 505], 24),
    train('cliff', twenty, 16),
    train('cells', [101, 202, 303], 40),
    train('credit', [101, 202, 303, 404, 505], 24),
    train('mirage', [101, 202, 303], 30),
    train('cells', [101], 20),
    train('continuous', [101, 202], 16),
    train('passfail', [101, 202], 16),
    train('offline', [101, 202], 12),
    train('twoways', [101, 202], 12),
    train('fetch', [101, 202, 303], 16),
  ];
  const one = runs.find((r) => r.config.seeds.length === 1);
  const three = runs.find((r) => r.config.world === 'cartpole' && r.config.family === 'value' && r.config.seeds.length === 3);
  assert.notEqual(one.key, three.key);
  const cells = C.levels.find((l) => l.id === 'cells');
  const keyFor = (seeds) => hash(exact.stringify(exact.resolve({
    world: cells.world, parts: cells.start, knobs: cells.knobs, hyper: C.hyperOf(cells.start, cells.world), steps: 40,
  }, seeds, versions, C)));
  assert.notEqual(keyFor([101]), keyFor([101, 202, 303]));
  assert.notEqual(keyFor([101, 202, 303]), keyFor([101, 202, 303, 404, 505]));
  assert.equal(one.agg.view.seedCount, 1);
  assert.equal(three.agg.view.seedCount, 3);
  for (const run of runs) {
    const { config, key, results, full, agg } = run;
    const world = config.world, label = world + '/' + config.family + '/' + config.seeds.length;
    assert.equal(RLAGG.validAggregateRecord(agg, config, key), true, label);
    const encoded = exact.stringify(agg);
    assert.equal(exact.stringify(exact.parse(encoded)), encoded, label + ' roundtrip');
    assert.equal(RLAGG.validAggregateRecord(exact.parse(encoded), config, key), true, label + ' parsed');
    assert.equal(exact.stringify(agg.view.autopsy), exact.stringify(RLA.autopsy(results)), label + ' autopsy');
    const curves = RLAGG.curvesOf(results, world);
    for (const name of Object.keys(curves)) {
      assert.equal(same(curves[name].xs, agg.view.curves[name].xs), true, label + ' xs ' + name);
      assert.equal(same(curves[name].ys, agg.view.curves[name].ys), true, label + ' ys ' + name);
    }
    const bands = agg.view.bands;
    if (bands.ret) assert.equal(same(bands.ret.mean, curves.main.ys), true, label + ' ret');
    if (bands.pred) assert.equal(same(bands.pred.mean, curves.pred.ys), true, label + ' pred');
    if (bands.disc) assert.equal(same(bands.disc.mean, curves.disc.ys), true, label + ' disc');
    if (bands.maxQ) assert.equal(same(bands.maxQ.mean, curves.maxQ.ys), true, label + ' maxQ');
    if (bands.main) assert.equal(same(bands.main.mean, curves.main.ys), true, label + ' main');
    for (const name of RLAGG.expectedBands(config)) assert.equal(bands[name] != null, true, label + ' missing ' + name);
    assert.equal(exact.stringify(agg.view.playback), exact.stringify(RLAGG.playbackOf(results[0])), label + ' playback');
    assert.equal(agg.view.playback.seed, config.seeds[0], label + ' seed');
    assert.equal(Object.is(agg.view.metric.v, RLAGG.metricOf(agg.view.autopsy, world).v), true, label + ' metric');
    if (world !== 'bandit' && world !== 'mirage') {
      const vals = results.map((r) => r.evals[0] && r.evals[0].ret).filter((x) => x != null && isFinite(x));
      const hand = vals.reduce((a, b) => a + b, 0) / vals.length;
      assert.equal(Object.is(bands.ret.mean[0], hand), true, label + ' hand mean');
      const sorted = vals.slice().sort((a, b) => a - b);
      const handQ = sorted.length === 1 ? sorted[0] : handQuantile(sorted, 0.25);
      assert.equal(Object.is(bands.ret.p25[0], handQ), true, label + ' hand quantile');
    }
    if (world === 'mirage') {
      assert.equal(typeof RLAGG.mirageGapOf(results), 'number', label + ' gap');
      assert.equal(same(bands.main.mean, curves.main.ys), true, label + ' drawn mean');
    }
  }
  assert.equal(Number.isNaN(one.agg.view.metric.se), true);
  assert.equal(Number.isNaN(exact.parse(exact.stringify(one.agg)).view.metric.se), true);
  const broken = exact.parse(exact.stringify(three.agg));
  broken.view.seedCount = 1;
  assert.equal(RLAGG.validAggregateRecord(broken, three.config, three.key), false);
  const dropped = exact.parse(exact.stringify(three.agg));
  delete dropped.view.bands.ret;
  assert.equal(RLAGG.validAggregateRecord(dropped, three.config, three.key), false);

  const sample = runs[0];
  const packedAgg = z.gzipSync(exact.stringify(sample.agg));
  const packedFull = z.gzipSync(exact.stringify(sample.full));
  function client(bytes) {
    const ref = { path: 'records/' + sample.key + '.json.gz', sha256: hash(bytes), bytes: bytes.length };
    const index = { schema: 'bb-fast-index-v1', versions, records: { [sample.key]: ref } };
    return create({
      versions, base: 'fast/test', protocol: 'https:', digest: async (x) => hash(x),
      decompress: async (b) => z.gunzipSync(b).toString(),
      fetcher: async (url) => url.endsWith('index.json')
        ? { ok: true, json: async () => index }
        : { ok: true, arrayBuffer: async () => bytes },
    });
  }
  return Promise.all([
    client(packedAgg).lookup(sample.config).then((hit) => {
      assert.equal(hit.record.schema, 'bb-seed-aggregate-v1');
      assert.equal(exact.stringify(hit.record), exact.stringify(sample.agg));
    }),
    client(packedFull).lookup(sample.config).then((hit) => {
      assert.equal(hit.record.schema, 'bb-full-results-v1');
      assert.equal(hit.record.results.length, sample.config.seeds.length);
    }),
  ]).then(() => {
    const bad = exact.parse(exact.stringify(sample.agg));
    bad.view.playback.seed = bad.view.playback.seed + 1;
    const bytes = z.gzipSync(exact.stringify(bad));
    return client(bytes).lookup(sample.config).then((hit) => assert.equal(hit.record, undefined));
  });
});
