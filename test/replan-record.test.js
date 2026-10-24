'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/agents/replan.js');
const records = require('../web/replan-record.js');
for (const schedule of Object.keys(R.SCHEDULES)) test('replan record matches engine on ' + schedule, () => {
  const record = records.create(schedule);
  const snapshot = JSON.stringify(record);
  let steps = 0;
  for (const policy of record.policies) {
    const run = R.rollout(policy.name, R.SCHEDULES[schedule]);
    assert.deepEqual(record.series[policy.name].map(p => p.obs), run.path);
    assert.deepEqual(record.series[policy.name].slice(1).map(p => p.action), run.actions);
    assert.equal(record.series[policy.name].reduce((sum, p) => sum + p.reward, 0), run.trueReturn);
    assert.equal(record.terminal[policy.name], run.crashed ? 'wall' : 'horizon');
    assert.equal(record.metrics[policy.name].modelSteps, run.modelSteps);
    steps += run.actions.length;
    for (let t = 0; t <= R.HORIZON; t++) {
      const frame = records.frame(record, t).policies.find(p => p.name === policy.name);
      assert.equal(frame.obs, run.path[Math.min(t, run.actions.length)]);
      assert.equal(frame.prediction, run.predictedPath[t]);
      assert.equal(frame.sampleTime, Math.min(t, run.actions.length));
    }
  }
  assert.deepEqual(record.data, { prior: { steps: 0, attempts: 0 }, fresh: { steps, attempts: 2 } });
  assert.equal(JSON.stringify(record), snapshot, 'frame reads never mutate the source record');
});
test('lesson shared clock holds crashed open-loop while replan continues', () => {
  const record = records.create('lesson');
  const frame = records.frame(record, 3);
  assert.equal(frame.policies[0].sampleTime, 2);
  assert.equal(frame.policies[0].ended, true);
  assert.equal(frame.policies[1].sampleTime, 3);
  assert.equal(frame.policies[1].ended, false);
  assert.notEqual(records.create('zero').id, record.id);
  assert.throws(() => records.create('missing'), /Unknown/);
});
