'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../src/core/rng.js');
const bandit = require('../src/worlds/bandit.js');
const cliff = require('../src/worlds/cliff.js');

test('bandit draws the same arms and rewards from the same seed', () => {
  const first = bandit.make({ arms: 5, noise: 1 }, rng.make(123));
  const second = bandit.make({ arms: 5, noise: 1 }, rng.make(123));

  assert.deepEqual(first.means, second.means);
  first.reset();
  second.reset();
  assert.deepEqual(first.step(2), second.step(2));
});

test('bandit reports zero regret for the current best arm', () => {
  const world = bandit.make({ noise: 0 }, rng.make(321));
  world.reset();

  const result = world.step(world.bestArm());

  assert.equal(result.info.optimal, true);
  assert.equal(result.info.regret, 0);
});

test('bandit drift changes the live arm means after a pull', () => {
  const world = bandit.make({ drift: 0.1 }, rng.make(456));
  const before = Array.from(world.means);
  world.reset();
  world.step(0);

  assert.notDeepEqual(Array.from(world.means), before);
});

test('cliff optimal safe path uses width plus one steps and returns minus thirteen', () => {
  const width = 12;
  const world = cliff.make({ width });
  world.reset();
  let totalReward = 0;
  let result = world.step(0);
  totalReward += result.reward;
  for (let i = 0; i < width - 1; i++) {
    result = world.step(1);
    totalReward += result.reward;
  }
  result = world.step(2);
  totalReward += result.reward;

  assert.equal(width + 1, 13);
  assert.equal(totalReward, -13);
  assert.equal(result.done, true);
  assert.equal(result.truncated, false);
});

test('cliff fall returns the agent to start with the configured penalty', () => {
  const world = cliff.make({ width: 12 });
  world.reset();

  const result = world.step(1);

  assert.equal(result.reward, -100);
  assert.equal(result.done, false);
  assert.deepEqual(result.info, { pos: [3, 0], fell: true });
});

test('cliff walls keep the agent in place', () => {
  const world = cliff.make({ width: 12 });
  world.reset();

  const result = world.step(3);

  assert.deepEqual(result.info, { pos: [3, 0], fell: false });
  assert.deepEqual(result.obs, new Float32Array([1, 0]));
});

test('cliff goal is terminal', () => {
  const world = cliff.make({ width: 5 });
  world.reset();
  world.step(0);
  for (let i = 0; i < 4; i++) { world.step(1); }

  const result = world.step(2);

  assert.equal(result.reward, -1);
  assert.equal(result.done, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.info, { pos: [3, 4], fell: false });
});

test('cliff truncates at the step limit', () => {
  const world = cliff.make({ maxSteps: 50 });
  world.reset();

  for (let i = 0; i < 49; i++) {
    const result = world.step(3);
    assert.equal(result.truncated, false);
  }
  const result = world.step(3);

  assert.equal(result.done, false);
  assert.equal(result.truncated, true);
});

test('cliff with zero slip follows actions deterministically without an RNG', () => {
  const first = cliff.make({ slip: 0 });
  const second = cliff.make({ slip: 0 });
  first.reset();
  second.reset();

  assert.deepEqual(first.step(1), second.step(1));
});
