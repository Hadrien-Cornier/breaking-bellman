'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const M = require('../src/agents/supermimic.js');

test('one fitted learned model is deterministic and shared by both model-based methods', () => {
  const a = M.fitModel(178), b = M.fitModel(178);
  assert.equal(a.id, b.id);
  const result = M.compare(178, 0.4), ids = result.methods.map(x => x.modelId);
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0], result.model.id);
  assert.equal(result.methods[0].name, 'PPO in physics');
  assert.equal(result.methods[1].name, 'PPO in learned model');
  assert.equal(result.methods[2].name, 'Backprop through learned model');
});

test('short-horizon analytic policy gradient agrees with finite differences', () => {
  const checked = M.gradientCheck(M.fitModel(178));
  assert(checked.maxError < 1e-6, `maximum gradient error ${checked.maxError}`);
  assert(checked.analytic.some(x => Math.abs(x) > 1e-4));
});

test('reported main method scores are true-physics evaluations, separate from surrogate scores', () => {
  const result = M.compare(178, 0.4);
  for (const method of result.methods) {
    assert.equal(typeof method.physicsScore, 'number');
    assert.equal(typeof method.surrogateScore, 'number');
    assert.equal(method.surrogateMinusPhysics, method.surrogateScore - method.physicsScore);
    assert.equal(method.trueGainPer1000Steps, 1000 * (method.physicsScore - method.initialPhysicsScore) / method.trainingSteps);
  }
  assert.match(result.methods[2].optimizer, /horizon 12 \+ terminal critic/);
});

test('seeded support mismatch reproduces model-error exploitation', () => {
  const a = M.compare(178, 1), b = M.compare(178, 1);
  assert.deepEqual(a.methods.map(x => [x.physicsScore, x.surrogateScore, x.outsideSupport]),
    b.methods.map(x => [x.physicsScore, x.surrogateScore, x.outsideSupport]));
  assert.equal(a.exploit.method, 'Backprop through learned model');
  assert(a.exploit.gap > 0.02, `surrogate gap ${a.exploit.gap}`);
  assert(a.exploit.outsideSupport > 0.7, `outside-support share ${a.exploit.outsideSupport}`);
  assert.match(a.exploit.cause, /fitted only.*saturates/);
});

test('rollout throughput and gradient efficiency remain separate measured fields', () => {
  const result = M.compare(178, 0.4);
  assert(result.rollout.physicsMs > 0);
  assert(result.rollout.modelMs > 0);
  assert.equal(result.rollout.steps, 80000);
  for (const method of result.methods) {
    assert(method.trainingSteps > 0);
    assert(method.updates > 0);
    assert(Number.isFinite(method.trueGainPer1000Steps));
  }
});
