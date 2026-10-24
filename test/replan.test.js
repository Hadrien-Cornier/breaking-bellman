'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/agents/replan.js');

function sequences(horizon) {
  let seqs = [[]];
  for (let t = 0; t < horizon; t++) {
    const next = [];
    for (const seq of seqs) for (const action of [-1, 0, 1]) next.push(seq.concat(action));
    seqs = next;
  }
  return seqs;
}

function independentScore(y0, sequence, stepReward) {
  let y = y0, total = 0;
  for (const action of sequence) {
    const next = y + action;
    if (Math.abs(next) >= 2) return total - 5;
    total += stepReward(next);
    y = next;
  }
  return total;
}

function independentBest(y0, stepReward) {
  let best = null, bestScore = -Infinity;
  for (const sequence of sequences(R.HORIZON)) {
    const score = independentScore(y0, sequence, stepReward);
    const bulk = sequence.reduce((sum, action) => sum + Math.abs(action), 0);
    const betterScore = score > bestScore;
    const sameScore = score === bestScore && best && (
      bulk < best.bulk || (bulk === best.bulk && sequence.join(',') < best.sequence.join(','))
    );
    if (!best || betterScore || sameScore) best = { sequence, score, bulk };
    if (betterScore) bestScore = score;
  }
  return best;
}

function trueRoll(actions, disturbance, stepReward) {
  let y = 0, total = 0, crashed = false;
  const path = [0];
  for (let t = 0; t < actions.length; t++) {
    const next = y + actions[t] + disturbance[t];
    path.push(next);
    if (Math.abs(next) >= 2) { total -= 5; crashed = true; break; }
    total += stepReward(next);
    y = next;
  }
  return { total, path, crashed };
}

test('the disturbance schedule is deterministic and is not rewritten by planning', () => {
  const schedule = R.SCHEDULES.lesson.slice();
  const once = R.compare(schedule);
  const twice = R.compare(schedule);
  assert.deepEqual(schedule, [1, 1, 0, 0]);
  assert.deepEqual(once.disturbance, twice.disturbance);
  assert.deepEqual(once.open.path, twice.open.path);
  assert.deepEqual(once.closed.actions, twice.closed.actions);
  assert.deepEqual(once.open.trueReturn, twice.open.trueReturn);
  assert.deepEqual(once.closed.trueReturn, twice.closed.trueReturn);
  assert.equal(once.learned, false);
  assert.equal(once.trainingData, null);
  assert.equal(once.open.model, 'mean-one-step');
  assert.equal(once.closed.model, 'mean-one-step');
});

test('the search maximizes the mean-model objective, including a reward it was not written for', () => {
  const center = (next) => 1 - Math.abs(next);
  const centerPlan = R.plan(0, { stepReward: center });
  const centerBest = independentBest(0, center);
  assert.equal(centerPlan.candidates, 81);
  assert.equal(centerPlan.horizon, 4);
  assert.equal(centerPlan.meanReturn, centerBest.score);
  assert.equal(independentScore(0, centerPlan.sequence, center), centerBest.score);
  assert.deepEqual(centerPlan.sequence, centerBest.sequence);
  assert.ok(centerPlan.meanReturn > independentScore(0, [1, 0, 0, 0], center));

  const preferLeft = (next) => next === -1 ? 1 : 0;
  const leftPlan = R.plan(0, { stepReward: preferLeft });
  const leftBest = independentBest(0, preferLeft);
  assert.equal(leftPlan.meanReturn, leftBest.score);
  assert.deepEqual(leftPlan.sequence, leftBest.sequence);
  assert.equal(leftPlan.firstAction, -1);
  assert.ok(leftPlan.meanReturn > independentScore(0, [0, 0, 0, 0], preferLeft));

  const driven = R.rollout('open', R.SCHEDULES.zero, { stepReward: preferLeft });
  const check = trueRoll(driven.actions, R.SCHEDULES.zero, preferLeft);
  assert.deepEqual(driven.actions, leftPlan.sequence.slice(0, driven.actions.length));
  assert.equal(driven.trueReturn, check.total);
  assert.equal(driven.actions[0], -1);
});

test('replanning uses the observed cell, and a lied observation changes the action', () => {
  const center = (next) => 1 - Math.abs(next);
  assert.equal(R.plan(0).firstAction, independentBest(0, center).sequence[0]);
  assert.equal(R.plan(1).firstAction, independentBest(1, center).sequence[0]);
  assert.equal(R.plan(-1).firstAction, independentBest(-1, center).sequence[0]);
  assert.notEqual(R.plan(1).firstAction, R.plan(-1).firstAction);

  const open = R.rollout('open', R.SCHEDULES.lesson);
  const blind = R.rollout('replan', R.SCHEDULES.lesson, { observe: () => 0 });
  assert.deepEqual(blind.actions, open.actions);
  assert.deepEqual(blind.path, open.path);
  assert.ok(blind.planLog.every((row) => row.stateSeen === 0));

  const closed = R.rollout('replan', R.SCHEDULES.lesson);
  for (let t = 0; t < closed.planLog.length; t++) assert.equal(closed.planLog[t].stateSeen, closed.path[t]);
  assert.notDeepEqual(closed.actions, open.actions);
  assert.equal(closed.planLog[1].stateSeen, 1);
  assert.equal(closed.planLog[1].firstAction, R.plan(1).firstAction);

  const flipped = R.rollout('replan', R.SCHEDULES.lesson, { observe: (y) => -y });
  assert.equal(flipped.planLog[1].stateSeen, -closed.planLog[1].stateSeen);
  assert.equal(flipped.actions[1], R.plan(-1).firstAction);
  assert.equal(flipped.crashed, true);
  assert.notDeepEqual(flipped.path, closed.path);
});

test('the same schedule and the same per-plan budget show open-loop error and a limited replan recovery', () => {
  const center = (next) => 1 - Math.abs(next);
  const lesson = R.compare(R.SCHEDULES.lesson);
  const openCheck = trueRoll(lesson.open.actions, R.SCHEDULES.lesson, center);
  const closedCheck = trueRoll(lesson.closed.actions, R.SCHEDULES.lesson, center);
  assert.deepEqual(lesson.open.disturbance, lesson.closed.disturbance);
  assert.deepEqual(lesson.open.path, openCheck.path);
  assert.equal(lesson.open.trueReturn, openCheck.total);
  assert.equal(lesson.open.crashed, true);
  assert.deepEqual(lesson.closed.path, closedCheck.path);
  assert.equal(lesson.closed.trueReturn, closedCheck.total);
  assert.equal(lesson.closed.crashed, false);
  assert.ok(lesson.closed.trueReturn > lesson.open.trueReturn);
  assert.ok(lesson.open.predictedReturn > lesson.open.trueReturn);
  assert.equal(lesson.open.plans, 1);
  assert.equal(lesson.closed.plans, lesson.closed.actions.length);
  assert.ok(lesson.closed.plans > lesson.open.plans);
  for (const row of lesson.open.planLog.concat(lesson.closed.planLog)) {
    assert.equal(row.candidates, 81);
    assert.equal(row.horizon, 4);
    assert.equal(row.model, 'mean-one-step');
    assert.equal(row.meanReturn, independentScore(row.stateSeen, row.sequence, center));
  }
  assert.equal(lesson.budgetPerPlan.candidates, 81);
  assert.equal(lesson.budgetPerPlan.horizon, 4);
  assert.ok(lesson.totalModelSteps.replan > lesson.totalModelSteps.open);

  const calm = R.compare(R.SCHEDULES.zero);
  assert.equal(calm.open.crashed, false);
  assert.equal(calm.closed.crashed, false);
  assert.equal(calm.open.trueReturn, calm.closed.trueReturn);
  assert.equal(calm.open.trueReturn, trueRoll(calm.open.actions, R.SCHEDULES.zero, center).total);
  assert.ok(calm.open.trueReturn > lesson.open.trueReturn);

  const hard = R.compare(R.SCHEDULES.uncorrectable);
  assert.equal(hard.open.crashed, true);
  assert.equal(hard.closed.crashed, true);
  assert.equal(hard.closed.plans, 1);
  assert.equal(hard.open.trueReturn, hard.closed.trueReturn);
  assert.deepEqual(hard.open.path, hard.closed.path);
  assert.ok(lesson.gaps.includes('bootstrap ensembles'));
  assert.ok(lesson.gaps.includes('Dyna-style imagination'));
  assert.ok(lesson.gaps.includes('iterative Gaussian cross-entropy refit'));
});
