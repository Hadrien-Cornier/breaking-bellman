'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { RLA, exact, source, content } = require('../scripts/fast-source.js');
const records = require('../web/run-record.js');
const C = content();
function setup(id, patch = {}) {
  const l = C.levels.find(l => l.id === id);
  const config = exact.resolve({ world: l.world, parts: l.start, knobs: l.knobs, steps: 12,
    hyper: { ...C.hyperOf(l.start, l.world), ...l.hyper, hidden: [4], batch: 2, demoEpisodes: 2, pretrain: 2 }, ...patch }, [101], source().versions, C);
  const results = config.seeds.map(seed => RLA.run(exact.runConfig(config, seed)));
  return { level: id, config, results, source: 'live', label: 'Test policy' };
}
test('all 17 shared lessons retain ordered engine data, measured accounting and terminal reasons', async () => {
  for (const l of C.levels) {
    const input = setup(l.id), record = await records.create(input), r = input.results[0], key = record.policies[0].name;
    assert.deepEqual(record.policies, [{ name: 'current', label: 'Test policy' }]);
    assert.equal(record.level, l.id); assert.equal(record.world, l.world);
    assert.equal(record.results, input.results);
    assert.deepEqual(record.series[key].map(p => p.state), (r.trace || []).map(p => p.s));
    assert.deepEqual(record.series[key].map(p => p.action), (r.trace || []).map(p => p.a));
    assert.deepEqual(record.series[key].map(p => p.reward), (r.trace || []).map(p => p.r));
    if (r.bandit) {
      assert.deepEqual(record.events[key].map(e => e.action), Array.from(r.bandit.arm));
      assert.deepEqual(record.events[key].map(e => e.reward), Array.from(r.bandit.reward));
    } else assert.deepEqual(record.events[key], r.events);
    assert.equal(record.terminal[key], r.final.terminal);
    assert(record.events[key].every((e,i,a) => i === 0 || e.t > a[i-1].t));
    assert.equal(record.data.fresh.steps, l.start.source === 'fixed' ? 0 : input.config.steps);
    assert.equal(record.data.fresh.attempts, r.ep.len.length + (r.ep.len.reduce((s,n) => s+n, 0) < r.data.fresh.steps ? 1 : 0));
    assert.deepEqual(record.data.prior, { steps: r.dataset?.steps || 0, attempts: r.dataset?.episodes || 0 });
    if (['both', 'fixed'].includes(l.start.source)) assert(record.data.prior.steps > 0, l.id + ': measured demos are retained');
    if (r.trace) {
      assert(r.final.len >= r.trace.length); assert(r.data.evaluation.steps >= r.final.len);
      assert(r.trace.every(p => Array.isArray(p.obs) && typeof p.done === 'boolean'));
      if (r.final.len <= 600) assert(r.trace.at(-1).done || r.trace.at(-1).truncated);
    }
  }
});
test('actual observation before action agrees with the simulator, not post-action state', () => {
  const cfg = setup('cells').config, r = RLA.run(exact.runConfig(cfg, 101));
  // CartPole observation scales velocities; the state used for drawing must stay distinct.
  assert(r.trace.some(p => exact.stringify(p.obs) !== exact.stringify(p.s)));
  assert(['terminated', 'time-limit'].includes(r.final.terminal));
});
test('identity is stable for identical results/settings and distinguishes version, seeds, level and budget', async () => {
  const input = setup('slots'), a = await records.create(input);
  const cache = await records.create({ ...input, source: 'server' });
  assert.equal(a.id, cache.id); assert.equal(a.source, 'live'); assert.equal(cache.source, 'fast-cache');
  assert.equal((await records.create({ ...input, source: 'local' })).provenance, 'local');
  for (const patch of [{ level: 'another' }, { config: { ...input.config, versions: { ...input.config.versions, engine: 'changed' } } }]) {
    assert.notEqual((await records.create({ ...input, ...patch })).id, a.id);
  }
  assert.notEqual(records.identity(input.level, input.config), records.identity(input.level, { ...input.config, steps: 13 }));
  await assert.rejects(records.create({ ...input, config: { ...input.config, seeds: [202] } }), /seeds/);
  const state = records.state(); state.accept(a);
  assert.equal(state.change(input.level, input.config), false);
  assert.equal(state.change(input.level, { ...input.config, steps: 13 }), true);
  assert.equal(state.change(input.level, input.config), true, 'stale remains until rerun');
  state.accept(cache); assert.equal(state.stale, false);
  state.clear(); assert.equal(state.record, null); assert.equal(state.stale, false);
});

test('many seeds remain one named method, with all seed measurements retained', async () => {
  const input = setup('slots'); input.config.seeds = [101,202,303];
  input.results = input.config.seeds.map(seed => RLA.run(exact.runConfig(input.config, seed)));
  const record = await records.create({ ...input, name: 'greedy', label: 'Greedy policy' });
  assert.deepEqual(record.policies, [{ name: 'greedy', label: 'Greedy policy' }]);
  assert.deepEqual(record.metrics.greedy.seeds.map(s => s.seed), [101,202,303]);
  assert.equal(record.data.fresh.steps, 36); assert.equal(record.results.length, 3);
  assert.equal(record.replaySeed, 101);
});

test('terminal reason and evaluation count come from the actual end after the 600-frame recording cap', () => {
  const name = 'record-probe';
  RLA.worlds[name] = { knobs: [], evalHorizon: 700, make(k) {
    let t = 0; const limit = k.maxSteps || 3;
    return { spec: { maxSteps: 3, gamma: 1 }, reset() { t = 0; return [t]; }, getState: () => [t],
      step() { t++; return { obs: [t], reward: 1, done: t === 700, truncated: t >= limit && t !== 700 }; } };
  } };
  RLA[name] = { make: parts => ({ parts, notes: [], act: () => 0, observe() {}, endEpisode() {}, diagnostics: () => ({}) }) };
  try {
    const r = RLA.run({ world: name, parts: { family: name }, steps: 5, evalEvery: 2, evalEpisodes: 1 });
    assert.equal(r.trace.length, 600); assert.equal(r.final.len, 700);
    assert.equal(r.trace.at(-1).done, false); assert.equal(r.trace.at(-1).truncated, false);
    assert.equal(r.final.terminal, 'terminated');
    assert.deepEqual(r.data.fresh, { steps: 5, attempts: 2 });
    assert.deepEqual(r.data.evaluation, { steps: 2100, attempts: 3 });
    assert.deepEqual(r.events, [{ t: 3, kind: 'episode', reward: 3, steps: 3, left: null, terminal: 'time-limit' }]);
  } finally { delete RLA.worlds[name]; delete RLA[name]; }
});

test('a pinned comparison retains its own measured method, settings and provenance inside the next record', async () => {
  const input = setup('slots');
  const prior = await records.create({ ...input, name: 'greedy', label: 'Greedy', source: 'server' });
  const record = await records.create({ ...input, comparison: prior, name: 'current', label: 'Changed sentence' });
  assert.equal(record.comparison, prior);
  assert.deepEqual(record.policies.map(p => p.name), ['current', 'pinned:greedy']);
  assert.equal(record.events['pinned:greedy'], prior.events.greedy);
  assert.equal(record.metrics['pinned:greedy'], prior.metrics.greedy);
  assert.equal(record.comparison.provenance, 'server');
  assert.equal(record.comparison.settings, prior.settings);
  assert.notEqual(record.id, prior.id);
  const state = records.state(); state.accept(record);
  assert.equal(state.change(input.level, input.config), false);
});
