'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../src/agents/rare.js');

function bonus(n) {
  return 1 / Math.sqrt(n);
}

test('visit counts increase by one and 1/sqrt(n) falls on the real trace', () => {
  const run = M.run({ seed: 19, place: 'backup' });
  const seen = {};
  for (const step of run.trace) {
    assert.ok(Math.abs(step.visitBonus - bonus(step.nAfter)) < 1e-12);
    const list = seen[step.s2] || (seen[step.s2] = []);
    if (list.length) assert.equal(step.nAfter, list[list.length - 1] + 1);
    else assert.equal(step.nAfter, step.s2 === 0 ? 2 : 1);
    list.push(step.nAfter);
    if (list.length > 1) assert.ok(bonus(list[list.length - 1]) < bonus(list[list.length - 2]));
  }
  assert.ok(Object.values(seen).some((list) => list.length >= 3));
  assert.deepEqual(run.counts, run.counts.map((n, i) => (seen[i] ? seen[i][seen[i].length - 1] : (i === 0 ? 1 : 0))));
});

test('environment reward stays separate from the visit bonus', () => {
  const on = M.run({ seed: 19, place: 'backup' });
  const env = on.trace.reduce((sum, step) => sum + step.env, 0);
  const visits = on.trace.reduce((sum, step) => sum + step.visitBonus, 0);
  assert.equal(env, on.openings);
  assert.equal(on.discoveredReward, env);
  assert.ok(Math.abs(visits - on.visitBonusSum) < 1e-9);
  assert.ok(visits > 0);
  assert.notEqual(on.discoveredReward, env + visits);
  assert.ok(on.trace.some((step) => step.env === 0 && step.visitBonus > 0));
});

test('the locked budget shows a door with the bonus and none without it', () => {
  const pair = M.compare(19);
  assert.equal(pair.off.steps, pair.on.steps);
  assert.equal(pair.off.steps, 80);
  assert.equal(pair.off.eps, pair.on.eps);
  assert.equal(pair.off.random.length, pair.off.steps);
  assert.equal(pair.on.random.length, pair.off.random.length);
  assert.equal(typeof pair.off.random[0].u, 'number');
  assert.equal(typeof pair.off.random[0].j, 'number');
  for (const other of [pair.on, pair.local, pair.targetOnly, pair.optimism, pair.withheld]) {
    assert.equal(other.random.length, pair.off.random.length);
    for (let i = 0; i < pair.off.random.length; i++) {
      assert.equal(other.random[i].u, pair.off.random[i].u);
      assert.equal(other.random[i].j, pair.off.random[i].j);
    }
  }
  assert.equal(pair.off.openings, 0);
  assert.equal(pair.off.discoveredReward, 0);
  assert.equal(pair.off.qRightBeforeReward, 0);
  assert.ok(pair.off.farthest < pair.off.door);
  assert.equal(pair.off.counts[6], 0);
  assert.equal(pair.off.counts[7], 0);
  assert.equal(pair.off.greedyOpens, false);
  assert.ok(pair.on.openings > 0);
  assert.equal(pair.on.discoveredReward, pair.on.openings);
  assert.ok(pair.on.counts[6] > 0);
  assert.ok(pair.on.counts[7] > 0);
  assert.ok(pair.on.farthest > pair.off.farthest);
  assert.equal(pair.on.greedyOpens, true);
  assert.ok(pair.on.qRightBeforeReward > 0);
});

test('a side score can open the door without writing the bonus into Q', () => {
  const pair = M.compare(19);
  assert.ok(pair.local.openings > 0);
  assert.equal(pair.local.qRightBeforeReward, 0);
  assert.ok(pair.local.trace.some((step) => step.env === 0 && step.intrinsic === 0 && step.visitBonus > 0));
  assert.ok(pair.on.trace.every((step) => step.intrinsic === step.visitBonus));
  assert.equal(pair.targetOnly.openings, 0);
  assert.ok(pair.targetOnly.farthest < pair.targetOnly.door);
  assert.equal(pair.optimism.openings, 0);
  assert.ok(pair.optimism.farthest < pair.optimism.door);
  assert.ok(pair.optimism.qRightBeforeReward > 0);
  assert.ok(pair.on.openings > pair.optimism.openings);
  assert.ok(pair.on.qRightBeforeReward > 1);
  assert.equal(pair.withheld.discoveredReward, 0);
  assert.equal(pair.withheld.openings, 0);
  assert.ok(pair.withheld.crossings > 0);
  assert.equal(pair.withheld.greedyOpens, false);
  assert.equal(pair.withheld.steps, pair.on.steps);
});

test('the same contrast is not claimed for every seed and budget', () => {
  const table = M.sensitivity();
  assert.ok(table.lesson.length >= 5);
  for (const row of table.lesson) {
    assert.equal(row.steps, 80);
    assert.equal(row.eps, 0.05);
    assert.equal(row.sameDraws, true);
    assert.equal(row.offOpenings, 0);
    assert.ok(row.onOpenings > 0);
    assert.equal(row.offDiscovered, 0);
    assert.equal(row.onDiscovered, row.onOpenings);
  }
  assert.equal(table.stressProtocol.steps, 28);
  assert.equal(table.stressProtocol.eps, 0.2);
  assert.ok(table.stress.some((row) => row.onOpenings === 0));
  assert.ok(table.stress.some((row) => row.onOpenings > 0));
  assert.ok(table.stress.every((row) => row.offOpenings === 0 && row.sameDraws));
});

test('two calls with one seed repeat the measured trace', () => {
  const a = M.compare(19);
  const b = M.compare(19);
  assert.deepEqual(a.on.counts, b.on.counts);
  assert.deepEqual(a.on.trace.map((step) => [step.env, step.visitBonus, step.a]), b.on.trace.map((step) => [step.env, step.visitBonus, step.a]));
  assert.equal(a.off.openings, b.off.openings);
});

test('the rare level mounts as its own id after offline learning', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = vm.createContext({ window: { BBRARE: Object.create(M) } });
  for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/rare-level.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const levels = context.window.CONTENT.levels;
  const rare = levels.find((level) => level.id === 'rare');
  const mixed = levels.findIndex((level) => level.id === 'mixed');
  assert.ok(rare);
  assert.equal(rare.custom, true);
  assert.equal(rare.world, 'rare');
  assert.equal(rare.phase, 11);
  assert.equal(levels[mixed + 1].id, 'rare');
  assert.equal(levels[mixed + 2].id, 'twoways');
  assert.equal(typeof context.window.BBRARE.mount, 'function');
});
