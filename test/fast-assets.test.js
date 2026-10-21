'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib'), vm = require('node:vm');
const { exact, hash, source, content } = require('../scripts/fast-source.js');
const { create } = require('../web/fast.js');

// Use the same first-match recognizer as the game, with the real content scripts.
const app = fs.readFileSync(path.resolve(__dirname, '../web/app.js'), 'utf8');
const recognizer = app.slice(app.indexOf('  function keysMatch('), app.indexOf('  const recipeOfCard ='));
assert(recognizer.includes('function recognize('), 'game recognizer must be present');
const C = content(), recognize = vm.runInNewContext(recognizer + '\nrecognize;', { C });

test('published corpus retains named policies with intact full ordered results', async t => {
  const root = path.resolve(__dirname, '../fast');
  for (const version of fs.readdirSync(root)) {
    const dir = path.join(root, version), indexPath = path.join(dir, 'index.json');
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath));
    assert.equal(index.schema, 'bb-fast-index-v1');
    assert.equal(hash(exact.stringify(index.versions)), version);
    const manifests = ['phase1', 'remaining-ac'].map(name => {
      const m = exact.parse(z.gunzipSync(fs.readFileSync(path.join(dir, 'manifests', name + '.json.gz'))).toString());
      assert.equal(m.schema, 'bb-campaign-v1');
      assert.deepEqual(m.versions, index.versions);
      assert.deepEqual(Object.keys(m).sort(), ['entries', 'schema', 'versions']);
      return m;
    });
    const configs = new Map();
    for (const m of manifests) for (const entry of m.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['config', 'key', 'levels']);
      assert.equal(hash(exact.stringify(entry.config)), entry.key);
      assert.deepEqual(entry.config.versions, index.versions);
      assert(!configs.has(entry.key), 'phase manifests must be disjoint');
      configs.set(entry.key, entry.config);
    }
    const keys = Object.keys(index.records).sort();
    assert.deepEqual(fs.readdirSync(path.join(dir, 'records')).sort(), keys.map(k => k + '.json.gz'));
    const current = exact.stringify(index.versions) === exact.stringify(source().versions);
    let raw, seeds = 0;
    // Exercise the production validator on every current shard without running training.
    const client = create({ versions: index.versions, base: dir, protocol: 'https:',
      digest: async bytes => hash(bytes),
      decompress: async bytes => (raw = z.gunzipSync(bytes).toString()),
      fetcher: async url => url === indexPath ? { ok: true, json: async () => index } :
        { ok: true, arrayBuffer: async () => fs.readFileSync(url) }
    });
    for (const key of keys) {
      const config = configs.get(key), ref = index.records[key];
      assert(config, 'published key outside the derived manifests: ' + key);
      if (current) {
        const recipe = recognize(config.parts, config.world);
        assert(recipe && recipe.card != null && C.cards[recipe.card], 'published key must link to a named policy card: ' + key);
      }
      assert.equal(ref.path, 'records/' + key + '.json.gz');
      let record;
      if (current) {
        const loaded = await client.lookup(config);
        assert(loaded.record, key + ': ' + loaded.reason);
        record = loaded.record;
      } else {
        // Archived versions remain valid assets while current Live settings miss them.
        const packed = fs.readFileSync(path.join(dir, ref.path));
        assert.equal(packed.length, ref.bytes); assert.equal(hash(packed), ref.sha256);
        raw = z.gunzipSync(packed).toString(); record = exact.parse(raw);
      }
      assert.equal(record.schema, 'bb-full-results-v1'); assert.equal(record.key, key);
      assert.deepEqual(Object.keys(record).sort(), ['config', 'key', 'results', 'schema']);
      assert.equal(exact.stringify(record.config), exact.stringify(config));
      assert.deepEqual(record.results.map(r => r.seed), config.seeds);
      // Includes all typed arrays, nonfinite values, policies, traces and curves.
      assert.equal(hash(exact.stringify(record)), hash(raw), key + ': lossless round trip');
      seeds += record.results.length;
    }
    t.diagnostic(version + ': ' + keys.length + ' full records, ' + seeds + ' ordered seeds; current consumer validation=' + current);
  }
});
