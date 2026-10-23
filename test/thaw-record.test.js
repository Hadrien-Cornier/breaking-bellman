'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/agents/thaw.js');
const { create } = require('../web/thaw-record.js');
const fast = require('../scripts/fast-source.js');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
for (const inertia of [1, 2]) for (const updates of [5, 20]) test(`all Thaw samples match engine and dynamics at inertia ${inertia}, ${updates} updates`, async () => {
  const r = await create({ inertia, updates });
  assert.deepEqual(r.policies.map(p => p.label), ['Frozen', 'Fine-tune', 'From scratch']);
  assert.equal(r.source, 'live'); assert.equal(r.world, 'thaw');
  assert.deepEqual(r.data.prior, { steps: 50, attempts: 1 });
  assert.deepEqual(r.data.fresh, { steps: updates * 400, attempts: updates * 8 });
  assert.deepEqual(r.data.evaluation, { steps: 150, attempts: 3 });
  const fitted = T.fitPolicy(T.collectFrozen().transitions).weights;
  for (const { name } of r.policies) {
    const actual = r.results[name], s = r.series[name], m = r.metrics[name];
    const expected = name === 'frozen' ? T.evaluate(fitted, inertia) : T.online(name === 'scratch' ? [0, 0] : fitted, { inertia, updates });
    assert.deepEqual(actual, expected);
    assert.equal(s.length, 50);
    let angle = 0, speed = 0, total = 0;
    s.forEach((p, i) => {
      assert.equal(p.t, i + 1); assert.deepEqual(p.obs, { angle, speed });
      const torque = Math.max(-1, Math.min(1, m.weights[0] * (1 - angle) + m.weights[1] * speed));
      speed += 0.1 * (torque / inertia - 0.02 * speed); angle += 0.1 * speed;
      assert.equal(p.action, torque); assert.deepEqual(p.state, { angle, speed });
      assert.equal(p.reward, -((angle - 1) ** 2)); assert.equal(angle, actual.trace[i]);
      total += p.reward;
    });
    assert.equal(s.at(-1).state.angle, m.endAngle); assert.equal(total, m.totalReward);
    assert.equal(Math.abs(angle - 1), m.terminalError); assert.equal(r.terminal[name], 'horizon');
    assert.equal(r.data.policies[name].prior.steps, name === 'scratch' ? 0 : 50);
    const events = r.events[name]; assert.equal(events.length, name === 'frozen' ? 0 : updates * 200);
    events.forEach((e, i) => {
      assert.equal(e.t, i + 1); assert.equal(e.attempt, Math.floor(i / 50) + 1);
      if (i % 50 === 0) assert.deepEqual(e.obs, { angle: 0, speed: 0 });
      else assert.deepEqual(e.obs, events[i - 1].state);
    });
  }
  assert.equal((await create({ inertia, updates })).id, r.id);
});
test('settings change measurements and identity; long-budget final error differs from total return ranking', async () => {
  const short = await create({ inertia: 2, updates: 5 });
  const long = await create({ inertia: 2, updates: 20 });
  const light = await create({ inertia: 1, updates: 5 });
  assert.notEqual(short.id, long.id); assert.notEqual(short.id, light.id);
  assert.ok(short.metrics.finetune.totalReward > short.metrics.scratch.totalReward);
  assert.ok(long.metrics.finetune.totalReward > long.metrics.scratch.totalReward);
  assert.ok(long.metrics.finetune.terminalError > long.metrics.scratch.terminalError);
  assert.ok(Math.abs(long.metrics.finetune.totalReward - long.metrics.scratch.totalReward) < 0.1);
  await assert.rejects(create({ inertia: 3, updates: 5 }));
});
test('returning Thaw does not alter shared Fast semantic inputs', () => {
  const inputs = [...fast.engineFiles, 'web/content.js', 'web/content2.js', 'web/content3.js', 'web/fetch-level.js', 'web/rules.js', 'src/sim/exact.js'];
  // Pinned to exact slice5 base 6253255963cb6ad211822587921acdc84599db6e.
  // Hash file names and complete bytes so shallow CI needs no historical Git objects.
  const bytes = JSON.stringify(inputs.map(path => [path, fs.readFileSync(path, 'utf8')]));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '70a1bd78e53dd5eef92f448cb35bd6d07b1bb18fbfa3ab54bc9a6726363fa741');
});
