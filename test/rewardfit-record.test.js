'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const RF = require('../src/agents/rewardfit.js');
const { createRecord, trips, demonstrations } = require('../web/rewardfit-record.js');

test('record preserves every engine cell, transition reward, terminal reason and demonstration across all settings', async () => {
  const ids = new Set();
  for (const side of ['north', 'south']) for (const constraint of ['free', 'hazard-zero']) {
    const settings = { demonstrations: side, constraint };
    const record = await createRecord(settings); ids.add(record.id);
    const study = RF.study(demonstrations(side));
    assert.deepEqual(record.policies.map(p => p.label), ['Closeness only', 'Fit from demonstrations']);
    assert.deepEqual(record.data, { prior: { steps: 12, attempts: 2 }, fresh: { steps: 0, attempts: 0 } });
    assert.equal(record.world, 'rewardfit'); assert.equal(record.level, 'rewardfit');
    assert.equal(record.source, 'live');
    assert.equal(record.id, (await createRecord(settings)).id);
    for (const [name, source] of [['closeness', study.proxy], ['fitted', constraint === 'free' ? study.free : study.holeLocked]]) {
      const series = record.series[name];
      assert.deepEqual(series.map(p => p.obs), source.path);
      assert.deepEqual(record.metrics[name].weights, source.weights);
      assert.equal(record.metrics[name].logLikelihood, source.logLikelihood);
      assert.equal(record.metrics[name].moves, source.path.length - 1);
      assert.equal(record.terminal[name], 'goal');
      series.forEach((p, t) => {
        assert.equal(p.t, t);
        if (!t) { assert.equal(p.action, null); assert.equal(p.reward, 0); return; }
        const prev = series[t - 1].obs;
        assert.deepEqual(RF.follow({ ...prev, a: p.action }), p.obs);
        assert.equal(p.reward, RF.featuresOf(p.obs.x, p.obs.y).reduce((sum, v, i) => sum + v * source.weights[i], 0));
      });
      assert.deepEqual(record.events[name].map(e => e.t), series.map(p => p.t));
    }
    const hazard = record.series.closeness.findIndex(p => p.obs.x === RF.HOLE.x && p.obs.y === RF.HOLE.y);
    assert.ok(hazard > 0 && hazard < record.series.closeness.length - 1, 'hazard is nonterminal');
    assert.equal(record.series.fitted.some(p => p.obs.y === (side === 'north' ? 0 : 2)), true);
    assert.deepEqual(trips(record.demonstrations).map(p => p.length), [7, 7]);
  }
  assert.equal(ids.size, 4, 'every result-changing setting is in the identity');
});

test('zero ignores the hazard feature and a negative term alone need not reroute', () => {
  assert.deepEqual(RF.plan([1, -4, 0, 0]), RF.plan([1, 0, 0, 0]));
  assert.ok(RF.entersHole(RF.plan([1, -4, 0, 0])));
});

test('scene replays exact recorded cells deterministically without invoking the planner', async () => {
  const record = await createRecord({ demonstrations: 'south', constraint: 'free' });
  const before = JSON.stringify(record);
  const calls = [];
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => k in o ? o[k] : (...args) => calls.push([k, ...args]), set: (o, k, v) => { calls.push([k, v]); return true; } });
  const canvas = { dataset: {}, getContext: () => context, setAttribute: (k, v) => calls.push([k, v]), width: 360, height: 250 };
  const scope = { BB: { sceneAdapter: require('../web/scene-adapter.js'), scenes: { robot: (...args) => calls.push(['robot', ...args.slice(1)]) } },
    window: { BBREWARDFIT: { ...RF, plan() { throw Error('draw called planner'); } } },
    getComputedStyle: () => ({ getPropertyValue: () => '#123456' }) };
  vm.runInNewContext(fs.readFileSync('web/rewardfit-scene.js', 'utf8'), scope);
  const adapter = scope.window.BBREWARDFIT.createSceneAdapter({ settings: record.settings, policy: 'fitted' });
  adapter.mount(canvas);
  assert.equal(canvas.dataset.cell, '0,1'); assert.equal(canvas.dataset.run, undefined);
  assert.equal(adapter.length(record), 7);
  for (const sample of record.series.fitted) {
    calls.length = 0; adapter.draw(record, sample.t); const first = JSON.stringify(calls);
    assert.equal(canvas.dataset.cell, sample.obs.x + ',' + sample.obs.y);
    calls.length = 0; adapter.draw(record, sample.t);
    assert.equal(JSON.stringify(calls), first);
  }
  assert.equal(JSON.stringify(record), before);
});
