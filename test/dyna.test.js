'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../src/agents/dyna.js');

function at(run, state, action) {
  return run.values[state][action];
}

test('the corridor and the given table are separate one-step facts', () => {
  assert.deepEqual(D.trueStep(0, 'right'), { next: 1, reward: 0, terminal: false });
  assert.deepEqual(D.trueStep(0, 'left'), { next: 0, reward: 0, terminal: false });
  assert.deepEqual(D.trueStep(1, 'right'), { next: 2, reward: 0, terminal: false });
  assert.deepEqual(D.trueStep(1, 'left'), { next: 0, reward: 0, terminal: false });
  assert.deepEqual(D.trueStep(2, 'right'), { next: 3, reward: 1, terminal: true });
  assert.deepEqual(D.trueStep(2, 'left'), { next: 1, reward: 0, terminal: false });
  assert.deepEqual(D.trueStep(3, 'right'), { next: 3, reward: 0, terminal: true });
  const model = D.givenModel();
  assert.equal(model.learned, false);
  assert.deepEqual(model.rows[2].right, { next: 3, reward: 1 });
  assert.deepEqual(model.rows[0].left, { next: 0, reward: 0 });
  const before = JSON.stringify(model);
  D.run({ model: model, modelBudget: 6, edit: { state: 2, action: 'right', reward: 4 } });
  assert.equal(JSON.stringify(model), before);
});

test('two real steps leave the far cell empty and an accurate sweep fills it', () => {
  const realOnly = D.run({ modelBudget: 0 });
  const accurate = D.run({});
  assert.equal(realOnly.realSteps, 2);
  assert.equal(realOnly.modelUpdates, 0);
  assert.equal(accurate.realSteps, 2);
  assert.equal(accurate.modelUpdates, 6);
  assert.equal(accurate.learnedModel, false);
  assert.equal(accurate.order, D.FAR_TO_NEAR);
  assert.deepEqual(realOnly.real.map((step) => [step.state, step.action, step.next, step.reward, step.written]), [
    [0, 'right', 1, 0, 0],
    [1, 'right', 2, 0, 0],
  ]);
  assert.deepEqual(accurate.real.map((step) => [step.action, step.next, step.reward]), realOnly.real.map((step) => [step.action, step.next, step.reward]));
  assert.equal(realOnly.far.empty, true);
  assert.equal(at(realOnly, 0, 'right'), 0);
  assert.equal(at(realOnly, 1, 'right'), 0);
  assert.equal(at(realOnly, 0, 'left'), null);
  assert.equal(at(realOnly, 2, 'left'), null);
  assert.equal(accurate.far.empty, false);
  assert.equal(accurate.far.value, 1);
  assert.equal(at(accurate, 2, 'left'), 0);
  assert.equal(at(accurate, 1, 'right'), 0.5);
  assert.equal(at(accurate, 1, 'left'), 0);
  assert.equal(at(accurate, 0, 'right'), 0.25);
  assert.equal(at(accurate, 0, 'left'), 0.125);
  assert.equal(at(accurate, 3, 'right'), null);
  assert.equal(accurate.modelTrace[0].state, 2);
  assert.equal(accurate.modelTrace[0].action, 'right');
  assert.equal(accurate.modelTrace[0].reward, 1);
  assert.equal(accurate.modelTrace[0].target, 1);
  assert.equal(accurate.probe.agrees, true);
});

test('model budget 0 matches real-only even when the model is wrong', () => {
  const wild = D.givenModel();
  for (const state of D.STATES) {
    for (const action of D.ACTIONS) wild.rows[state][action] = { next: 0, reward: 7 };
  }
  const plain = D.run({ modelBudget: 0 });
  const wrong = D.run({ modelBudget: 0, model: wild });
  assert.deepEqual(wrong.values, plain.values);
  assert.equal(wrong.far.empty, true);
  assert.deepEqual(wrong.real.map((step) => [step.next, step.reward]), [[1, 0], [2, 0]]);
  assert.equal(wrong.real[0].agrees, false);
});

test('a flipped model reward or transition changes the written value', () => {
  const zero = D.run({ edit: { state: 2, action: 'right', reward: 0 } });
  const four = D.run({ edit: { state: 2, action: 'right', reward: 4 } });
  const stay = D.run({ modelBudget: 12, edit: { state: 2, action: 'right', next: 2 } });
  const stayOnce = D.run({ edit: { state: 2, action: 'right', next: 2 } });
  assert.equal(zero.far.value, 0);
  assert.equal(zero.far.empty, false);
  assert.equal(zero.probe.modelReward, 0);
  assert.equal(zero.probe.envReward, 1);
  assert.equal(zero.probe.envNext, 3);
  assert.equal(zero.probe.agrees, false);
  assert.equal(at(zero, 1, 'right'), 0);
  assert.equal(at(zero, 0, 'right'), 0);
  assert.equal(four.far.value, 4);
  assert.equal(at(four, 1, 'right'), 2);
  assert.equal(at(four, 0, 'right'), 1);
  assert.equal(at(four, 0, 'left'), 0.5);
  assert.equal(D.trueStep(2, 'right').reward, 1);
  assert.equal(stayOnce.far.value, 1);
  assert.equal(stayOnce.probe.agrees, false);
  assert.equal(stayOnce.probe.modelNext, 2);
  assert.equal(stay.far.value, 1.5);
  assert.equal(at(stay, 1, 'right'), 0.75);
  assert.equal(at(stay, 0, 'right'), 0.375);
  assert.equal(stay.probe.envNext, 3);
  assert.equal(stay.modelUpdates, 12);
  assert.equal(stay.realSteps, 2);
});

test('discount, step size, and sweep order change the backup that actually runs', () => {
  const g0 = D.run({ gamma: 0 });
  const g1 = D.run({ gamma: 1 });
  const partial = D.run({ alpha: 0.5, gamma: 1 });
  const stopped = D.run({ alpha: 0 });
  const early = D.run({ order: D.NEAR_TO_FAR, modelBudget: 4 });
  const later = D.run({ order: D.NEAR_TO_FAR, modelBudget: 5 });
  const first = D.run({ modelBudget: 1 });
  assert.equal(g0.far.value, 1);
  assert.equal(at(g0, 0, 'right'), 0);
  assert.equal(at(g0, 1, 'right'), 0);
  assert.equal(g1.far.value, 1);
  assert.equal(at(g1, 1, 'right'), 1);
  assert.equal(at(g1, 1, 'left'), 0);
  assert.equal(at(g1, 0, 'right'), 1);
  assert.equal(at(g1, 0, 'left'), 1);
  assert.equal(partial.far.value, 0.5);
  assert.equal(at(partial, 1, 'right'), 0.25);
  assert.equal(at(partial, 0, 'right'), 0.125);
  assert.equal(at(partial, 0, 'left'), 0.0625);
  assert.equal(stopped.far.value, 0);
  assert.equal(stopped.far.empty, false);
  assert.equal(early.far.empty, true);
  assert.equal(early.modelUpdates, 4);
  assert.equal(at(early, 0, 'left'), 0);
  assert.equal(later.far.value, 1);
  assert.equal(at(later, 0, 'right'), 0);
  assert.equal(at(later, 2, 'left'), null);
  assert.equal(first.far.value, 1);
  assert.equal(first.modelUpdates, 1);
  assert.equal(at(first, 0, 'right'), 0);
  assert.equal(at(first, 2, 'left'), null);
  assert.equal(later.order, D.NEAR_TO_FAR);
});

test('one model sample follows the supplied row, not the corridor', () => {
  const wild = D.givenModel();
  for (const state of D.STATES) {
    for (const action of D.ACTIONS) wild.rows[state][action] = { next: 0, reward: 7 };
  }
  const farFirst = D.run({ model: wild, modelBudget: 1, order: D.FAR_TO_NEAR });
  const nearFirst = D.run({ model: wild, modelBudget: 1, order: D.NEAR_TO_FAR });
  assert.equal(farFirst.far.value, 7);
  assert.equal(at(farFirst, 0, 'right'), 0);
  assert.equal(farFirst.modelTrace[0].reward, 7);
  assert.equal(farFirst.modelTrace[0].envReward, 1);
  assert.equal(farFirst.modelTrace[0].agrees, false);
  assert.equal(nearFirst.far.empty, true);
  assert.equal(at(nearFirst, 0, 'right'), 7);
  assert.equal(nearFirst.realSteps, 2);
  assert.throws(() => D.run({ order: 'oracle' }), /unknown sweep order/);
});

test('the lesson registers before replan and keeps the neighboring levels', () => {
  function load(levels, phases) {
    const context = vm.createContext({
      window: { CONTENT: { phases: phases, levels: levels, worldNames: {} }, BBDYNA: D },
    });
    vm.runInContext(fs.readFileSync('web/dyna-level.js', 'utf8'), context);
    return context.window.CONTENT;
  }
  const between = load(
    [{ id: 'supermimic' }, { id: 'replan' }, { id: 'hindsight' }],
    [{ n: 8, title: 'Learning through a world model' }],
  );
  assert.deepEqual(between.levels.map((item) => item.id), ['supermimic', 'dyna', 'replan', 'hindsight']);
  assert.equal(between.levels[1].title, 'Two steps, then the model');
  assert.equal(between.levels[1].custom, true);
  assert.equal(between.levels[1].world, 'dyna');
  assert.equal(between.worldNames.dyna, 'Four-cell corridor');
  assert.equal(between.phases.length, 1);
  const afterModel = load([{ id: 'supermimic' }, { id: 'goals' }], []);
  assert.deepEqual(afterModel.levels.map((item) => item.id), ['supermimic', 'dyna', 'goals']);
  const alone = load([], []);
  assert.deepEqual(alone.levels.map((item) => item.id), ['dyna']);
});
