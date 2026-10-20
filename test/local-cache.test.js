'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { RLA, exact, hash, source, content } = require('../scripts/fast-source.js');
require('../src/sim/autopsy.js');
const { createLocal, createCache } = require('../web/fast.js');
const C = content(), versions = source().versions;
function fixture(id = 'cells') {
  const l = C.levels.find(l => l.id === id);
  const config = exact.resolve({ world: l.world, parts: l.start, knobs: l.knobs,
    hyper: { ...C.hyperOf(l.start, l.world), ...l.hyper }, steps: 30 }, [202, 101], versions, C);
  return { config, results: config.seeds.map(seed => RLA.run(exact.runConfig(config, seed))) };
}
// Small asynchronous IDB surface with transaction-completion semantics. Real browser
// persistence, reload and clear are covered by test/ui/local-cache.mjs.
function storage(fault) {
  const entries = new Map(); let closes = 0;
  const db = { close() { closes++; }, transaction() {
    if (fault === 'transaction') throw Error('disabled');
    let action = () => {}, aborted = false;
    const result = {}, tx = { abort() { aborted = true; }, objectStore() { return {
      get(key) { action = () => { result.result = entries.get(key); }; return result; },
      put(value, key) { action = () => entries.set(key, value); return result; },
      clear() { action = () => entries.clear(); return result; }
    }; } };
    if (fault !== 'silentTransaction') setImmediate(() => {
      if (fault === 'quota' || fault === 'error') { tx.error = Error('QuotaExceededError'); tx.onabort(); }
      else if (!aborted) { action(); tx.oncomplete(); }
    });
    return tx;
  } };
  return { entries, get closes() { return closes; }, open() {
    if (fault === 'throw') throw Error('SecurityError');
    const req = { result: db };
    if (fault !== 'silent') setImmediate(() => {
      if (fault === 'blocked') { req.onblocked(); setImmediate(() => req.onsuccess()); }
      else if (fault === 'openError') req.onerror();
      else req.onsuccess();
    });
    return req;
  } };
}
function client(store, options = {}) {
  return createLocal({ versions, storage: () => store, digest: async x => hash(x), timeout: 1500, ...options });
}
test('full exact records survive a new client, ordered seeds and every consumer input', async () => {
  const store = storage();
  for (const id of ['slots', 'cells', 'continuous', 'fetch', 'residual']) {
    const { config, results } = fixture(id);
    results[0].notes.push({ negativeZero: -0, nan: NaN, infinity: Infinity, missing: undefined,
      typed: new Float64Array([-0, NaN, Infinity, 1.2345678901234567]) });
    assert(await client(store).save(config, results), id);
    const hit = await client(store).lookup(config);
    assert.equal(hit.source, 'local');
    assert.equal(exact.stringify(hit.record.results), exact.stringify(results), id);
    assert.equal(exact.stringify(RLA.autopsy(hit.record.results)), exact.stringify(RLA.autopsy(results)), id);
    assert.equal(exact.stringify((await client(store).lookup(config)).record), exact.stringify(hit.record));
  }
  assert.equal(store.entries.size, 5);
  assert(store.closes >= 15);
});
test('canonical settings, typed values, ordered seeds and engine versions never collide', async () => {
  const store = storage(), local = client(store), { config, results } = fixture();
  assert(await local.save(config, results));
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  assert((await local.lookup(reordered)).record);
  for (const change of [c => c.parts.eps = !c.parts.eps, c => c.knobs.noise = .01,
    c => c.steps++, c => c.seeds.reverse(), c => c.seeds.pop(), c => c.hyper.lrTable = .2,
    c => c.parts.nstep = String(c.parts.nstep), c => c.versions.engine += 'new']) {
    const c = exact.parse(exact.stringify(config)); change(c);
    assert(!(await local.lookup(c)).record);
  }
  assert(!(await client(store, { versions: { ...versions, engine: 'new' } }).lookup(config)).record);
});
test('published server results take priority; local miss falls through to Live and save', async () => {
  const store = storage(), local = client(store), { config, results } = fixture();
  let localLookups = 0, liveRuns = 0;
  const cache = createCache({ server: { lookup: async () => ({}) }, local });
  async function visit() {
    const hit = await cache.lookup(config);
    if (hit.record) return hit;
    liveRuns++; await cache.save(config, results); return { source: 'live', results };
  }
  assert.equal((await visit()).source, 'live');
  assert.equal((await visit()).source, 'local'); assert.equal(liveRuns, 1);
  const server = createCache({ server: { lookup: async () => ({ record: { published: true } }) },
    local: { ...local, lookup: async () => { localLookups++; return local.lookup(config); } } });
  assert.equal((await server.lookup(config)).source, 'server'); assert.equal(localLookups, 0);
  const cancelled = new AbortController(); cancelled.abort();
  assert(!(await cache.lookup(config, cancelled.signal)).record);
});
test('malformed, incomplete and mismatched persisted entries are harmless misses', async () => {
  const store = storage(), local = client(store), { config, results } = fixture();
  const key = hash(exact.stringify(config));
  for (const value of [undefined, {}, '{bad json', 'null', exact.stringify({ schema: 'wrong' })]) {
    store.entries.set(key, value); assert(!(await local.lookup(config)).record);
  }
  for (const change of [r => r.config.steps++, r => r.results.reverse(), r => r.results.pop(),
    r => delete r.results[0].ep.ret, r => delete r.results[0].final, r => r.results[0] = null]) {
    const record = exact.parse(exact.stringify({ schema: 'bb-full-results-v1', config, key, results }));
    change(record); store.entries.set(key, exact.stringify(record)); assert(!(await local.lookup(config)).record);
  }
  assert.equal(await local.save(config, []), false);
});
test('missing/denied storage, open errors, blocked opens, timeout, transaction and quota failures settle safely', async () => {
  const { config, results } = fixture();
  for (const fault of ['throw', 'openError', 'blocked', 'silent', 'transaction', 'silentTransaction', 'quota', 'error']) {
    const store = storage(fault), local = client(store, { timeout: fault.startsWith('silent') ? 5 : 1500 });
    assert(!(await local.lookup(config)).record, fault);
    assert.equal(await local.save(config, results), false, fault);
    assert.equal(await local.clear(), false, fault);
    assert.equal(store.entries.size, 0, fault);
  }
  for (const options of [{ storage: () => undefined }, { storage: () => { throw Error('SecurityError'); } }]) {
    const local = client(null, options);
    assert(!(await local.lookup(config)).record); assert.equal(await local.save(config, results), false);
    assert.equal(await local.clear(), false);
  }
});
test('clear removes actual persisted records across clients and prevents an earlier pending save', async () => {
  const store = storage(), local = client(store), { config, results } = fixture();
  await local.save(config, results); assert.equal(store.entries.size, 1);
  assert(await local.clear()); assert.equal(store.entries.size, 0);
  assert(!(await client(store).lookup(config)).record);
  let release;
  const delayed = client(store, { digest: () => new Promise(r => { release = r; }) });
  const pending = delayed.save(config, results);
  await delayed.clear(); release(hash(exact.stringify(config)));
  assert.equal(await pending, false); assert.equal(store.entries.size, 0);
});
