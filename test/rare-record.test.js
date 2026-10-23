'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const records = require('../web/rare-record.js');
const engine = require('../src/agents/rare.js');

test('rare record replays every measured transition and count without changing the engine sample', async () => {
  for (const settings of [{ steps: 80, eps: 0.05 }, { steps: 28, eps: 0.2 }]) {
    const record = await records.create(settings);
    assert.equal(record.data.prior.steps, 0);
    assert.equal(record.data.fresh.steps, settings.steps * 30);
    assert.equal(record.data.fresh.attempts, 30);
    assert.equal(record.data.evaluation.attempts, 30);
    let evaluationSteps = 0;
    const encoded = JSON.stringify(record);
    for (const policy of records.policies) {
      const runs = record.results[policy.name];
      for (const run of runs) {
        assert.deepEqual(run, engine.run({ ...settings, seed: run.seed, place: policy.place, reward: policy.reward || 'env' }));
        evaluationSteps += run.greedyActions.length;
      }
      const run = runs[0], counts = Array(8).fill(0); counts[0] = 1;
      assert.deepEqual(records.frame(record, policy.name, 0).counts, counts);
      for (let i = 0; i < run.steps; i++) {
        const e = run.trace[i]; counts[e.s2]++;
        const frame = records.frame(record, policy.name, i + 1);
        assert.equal(frame.state, e.s2);
        assert.deepEqual(frame.counts, counts);
        assert.equal(frame.last.nAfter, counts[e.s2]);
        assert.equal(frame.last.action, e.a);
        assert.equal(frame.last.reward, e.env);
        assert.equal(frame.last.visitBonus, e.visitBonus);
        assert.equal(frame.last.intrinsic, e.intrinsic);
        assert.equal(record.events[policy.name][i].t, i + 1);
      }
      const end = records.frame(record, policy.name, run.steps);
      assert.deepEqual(end.counts, run.counts);
      assert.equal(end.reward, run.envSum);
      assert.equal(end.visitBonus, run.visitBonusSum);
      assert.equal(record.terminal[policy.name], 'step-budget');
      assert.equal(record.metrics[policy.name].expectedExplorations, settings.steps * settings.eps * 5);
      assert.equal(record.metrics[policy.name].observedExplorations, runs.reduce((n, r) => n + r.trace.filter(e => e.explored).length, 0));
    }
    assert.equal(record.data.evaluation.steps, evaluationSteps);
    assert.equal(JSON.stringify(record), encoded, 'replay is pure');
  }
});

test('settings change identities; seeds are samples of named methods; withheld reward stays zero', async () => {
  const a = await records.create(), b = await records.create(), c = await records.create({ steps: 28, eps: 0.2 });
  assert.equal(a.id, b.id); assert.notEqual(a.id, c.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a.policies.map(p => p.name), records.policies.map(p => p.name));
  assert.ok(a.results.withheld.some(r => r.crossings > 0));
  assert.ok(a.results.withheld.every(r => r.envSum === 0));
  for (const p of a.policies) a.results[p.name].forEach((run, i) => assert.deepEqual(run.random, a.results.off[i].random));
});
