'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const M = require('../src/agents/supermimic.js'), V = require('../src/agents/vpo.js');
const { create } = require('../web/custom-record.js');
const near = (a, b) => assert(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('every SuperMimic replay transition is true physics and reproduces its reported score', async () => {
  for (const scale of [0.4, 1]) {
    const result = M.compare(178, scale), record = await create('supermimic', result, 'test-v1');
    assert.equal(record.policies.length, 3);
    assert.equal(record.data.prior.steps, 2400);
    assert.equal(record.data.fresh.steps, result.methods[0].trainingSteps);
    assert.equal(record.data.evaluation.steps, 3600);
    assert.equal(record.data.evaluation.attempts, 36);
    for (const [i, policy] of record.policies.entries()) {
      const trace = record.series[policy.name], method = result.methods[i];
      assert.equal(trace.length, 1212);
      assert.equal(trace.filter(x => x.kind === 'reset').length, 12);
      assert.equal(trace.filter(x => x.terminal).length, 12);
      trace.forEach((x, t) => {
        assert.equal(x.t, t);
        assert.deepEqual(x.reference, M.reference(x.clock));
        if (x.kind === 'reset') { assert.equal(x.step, 0); assert.equal(x.action, null); return; }
        assert.deepEqual(x.before, trace[t - 1].obs);
        assert.deepEqual(x.obs, M.trueStep(x.before, x.action));
        assert.equal(x.reward, M.reward(x.obs, x.action, x.clock));
        assert.equal(x.terminal, x.step === 100 ? 'evaluation horizon' : null);
      });
      near(trace.reduce((s, x) => s + x.reward, 0) / 1200, method.physicsScore);
      assert.equal(record.terminal[policy.name], 'evaluation horizon');
      assert.deepEqual(record.metrics[policy.name].evaluation.trace, trace);
    }
    const firstStates = record.policies.map(p => record.series[p.name].filter(x => x.kind === 'reset').map(x => x.obs));
    assert.deepEqual(firstStates[0], firstStates[1]); assert.deepEqual(firstStates[1], firstStates[2]);
    // Source output remains independent of the record snapshot.
    result.methods[0].evaluation.trace[0].obs[0] = 123;
    assert.notEqual(record.series.physics[0].obs[0], 123);
  }
});

test('VPO measured selections link to exact predefined route moves and ordered search pools', async () => {
  const result = V.compare(101, 30), record = await create('vpo', result, 'test-v1');
  assert.deepEqual(record.data.fresh, { steps: 720, attempts: 720 });
  assert.deepEqual(record.data.prior, { steps: 0, attempts: 0 });
  for (const policy of record.policies) {
    const metric = record.metrics[policy.name], trace = record.series[policy.name];
    assert.equal(metric.pools.length, 64);
    assert.deepEqual(metric.pool, metric.pools.at(-1));
    assert.equal(record.events[policy.name].length, metric.training.steps);
    for (let episode = 0; episode < 30; episode++) {
      const route = V.routes[metric.pool[episode]], samples = trace.filter(x => x.episode === episode);
      assert.deepEqual(samples.map(x => x.obs), route.path);
      assert.deepEqual(samples.at(-1).reward, V.replay(route.path).reward);
      assert.equal(samples.at(-1).terminal, route.exit ? 'exit reached' : 'move budget exhausted');
      assert.equal(samples[0].action, null);
      samples.slice(1).forEach((x, i) => assert.deepEqual(x.action, x.obs.map((v, axis) => v - samples[i].obs[axis])));
    }
    for (const [i, k] of [1, 3, 5, 10, 30].entries()) {
      near(metric.curve[i], metric.pools.reduce((sum, pool) => sum + Math.max(...pool.slice(0, k).map(a => V.dot(V.uniform, V.routes[a].reward))) / 64, 0));
    }
  }
});

test('custom identity changes with actual settings or engine version, never benchmark wall time', async () => {
  const result = V.compare(101, 12), a = await create('vpo', result, 'v1');
  const b = await create('vpo', { ...result, milliseconds: 99999 }, 'v1');
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, (await create('vpo', V.compare(101, 24), 'v1')).id);
  assert.notEqual(a.id, (await create('vpo', result, 'v2')).id);
});
