'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../src/agents/ensemble.js');

function tables(overridesA, overridesB) {
  const A = Object.assign({}, E.LESSON_A, overridesA || {});
  const B = Object.assign({}, E.LESSON_B, overridesB || {});
  return { A, B };
}

function truthOf(overrides) {
  return Object.assign({}, E.LESSON_TRUTH, overrides || {});
}

function walkTruth(actions, truth, graph) {
  let state = graph.start;
  let total = 0;
  const edges = [];
  for (const action of actions) {
    const edge = state + '|' + action;
    assert.equal(typeof graph.transitions[edge], 'string', edge);
    total += truth[edge];
    edges.push(edge);
    state = graph.transitions[edge];
  }
  assert.equal(!!graph.terminal[state], true);
  return { total, state, edges };
}

function scoreOf(actions, A, B, coefficient, graph) {
  let state = graph.start;
  let score = 0;
  let mean = 0;
  for (const action of actions) {
    const edge = state + '|' + action;
    const cellMean = (A[edge] + B[edge]) / 2;
    const gap = Math.abs(A[edge] - B[edge]);
    score += cellMean - coefficient * gap;
    mean += cellMean;
    state = graph.transitions[edge];
  }
  return { score, mean };
}

test('the lesson average enters the disagreement and the penalty keeps the smaller true reward', () => {
  const { A, B } = tables();
  const truth = truthOf();
  const meanPlan = E.plan(A, B, 0, E.GRAPH);
  const penPlan = E.plan(A, B, E.LESSON_COEFFICIENT, E.GRAPH);
  const glareMean = (A['aisle|glare'] + B['aisle|glare']) / 2;
  const glareGap = Math.abs(A['aisle|glare'] - B['aisle|glare']);
  const shelfMean = (A['aisle|shelf'] + B['aisle|shelf']) / 2;
  assert.ok(glareGap > 0);
  assert.ok(glareMean > shelfMean);
  assert.ok(glareMean - E.LESSON_COEFFICIENT * glareGap < shelfMean);
  assert.equal(meanPlan.actions.join(','), 'walk,glare');
  assert.equal(penPlan.actions.join(','), 'walk,shelf');
  assert.equal(meanPlan.plannerScore, scoreOf(meanPlan.actions, A, B, 0, E.GRAPH).score);
  assert.equal(penPlan.plannerScore, scoreOf(penPlan.actions, A, B, E.LESSON_COEFFICIENT, E.GRAPH).score);
  assert.equal(meanPlan.meanReturn, glareMean);
  assert.ok(penPlan.plannerScore < meanPlan.plannerScore);
  const meanRun = E.rollout(meanPlan.actions, truth, E.GRAPH);
  const penRun = E.rollout(penPlan.actions, truth, E.GRAPH);
  assert.equal(meanRun.trueReturn, walkTruth(meanPlan.actions, truth, E.GRAPH).total);
  assert.equal(penRun.trueReturn, walkTruth(penPlan.actions, truth, E.GRAPH).total);
  assert.equal(meanRun.trueReturn, 0);
  assert.equal(penRun.trueReturn, truth['aisle|shelf']);
  assert.ok(penRun.trueReturn < meanPlan.plannerScore);
  assert.equal(meanPlan.learned, false);
  assert.equal(penPlan.fittedHere, false);
});

test('the planner does not read the true reward', () => {
  const { A, B } = tables();
  const lied = truthOf({ 'aisle|shelf': 100, 'aisle|glare': -50, 'start|walk': 9 });
  const planned = E.plan(A, B, 0, E.GRAPH);
  assert.equal(planned.actions.join(','), 'walk,glare');
  const ran = E.rollout(planned.actions, lied, E.GRAPH);
  assert.equal(ran.trueReturn, walkTruth(planned.actions, lied, E.GRAPH).total);
  assert.equal(ran.trueReturn, 9 + -50);
  assert.notEqual(ran.trueReturn, planned.plannerScore);
});

test('an unsupported door where both tables agree on a high reward is taken', () => {
  const { A, B } = tables({ 'aisle|vault': 5 }, { 'aisle|vault': 5 });
  const truth = truthOf({ 'aisle|vault': 5 });
  assert.equal(E.LESSON_SUPPORT['aisle|vault'], false);
  const planned = E.plan(A, B, 10, E.GRAPH);
  const vault = planned.steps.find((step) => step.action === 'vault');
  assert.equal(planned.actions.join(','), 'walk,vault');
  assert.equal(vault.disagreement, 0);
  assert.equal(vault.score, 5);
  const ran = E.rollout(planned.actions, truth, E.GRAPH);
  assert.equal(ran.trueReturn, 5);
  const supported = ['aisle|shelf'];
  let masked = null;
  let maskedScore = -Infinity;
  for (const edge of supported) {
    const action = edge.slice(edge.indexOf('|') + 1);
    const score = (A['start|walk'] + B['start|walk']) / 2 + (A[edge] + B[edge]) / 2;
    if (score > maskedScore) { maskedScore = score; masked = action; }
  }
  assert.equal(masked, 'shelf');
  assert.notEqual(planned.actions.at(-1), masked);
});

test('zero disagreement does not certify the true reward and the penalty does not veto it', () => {
  const { A, B } = tables({ 'aisle|glare': 6 }, { 'aisle|glare': 6 });
  const truth = truthOf({ 'aisle|glare': 0 });
  const penalized = E.plan(A, B, 4, E.GRAPH);
  const plain = E.plan(A, B, 0, E.GRAPH);
  const glare = penalized.steps.find((step) => step.action === 'glare');
  assert.equal(glare.disagreement, 0);
  assert.equal(glare.score, glare.mean);
  assert.equal(penalized.plannerScore, plain.plannerScore);
  assert.deepEqual(penalized.actions, plain.actions);
  assert.equal(penalized.actions.at(-1), 'glare');
  const ran = E.rollout(penalized.actions, truth, E.GRAPH);
  assert.equal(ran.trueReturn, 0);
  assert.ok(penalized.plannerScore > ran.trueReturn);
});

test('coefficient zero matches the average, and a higher difference changes the plan when the average does not', () => {
  const wide = tables({ 'aisle|glare': 6 }, { 'aisle|glare': 0 });
  const narrow = tables({ 'aisle|glare': 4 }, { 'aisle|glare': 2 });
  assert.equal((6 + 0) / 2, (4 + 2) / 2);
  assert.notEqual(Math.abs(6 - 0), Math.abs(4 - 2));
  const wideMean = E.plan(wide.A, wide.B, 0, E.GRAPH);
  const widePen = E.plan(wide.A, wide.B, 0.5, E.GRAPH);
  const narrowPen = E.plan(narrow.A, narrow.B, 0.5, E.GRAPH);
  assert.equal(wideMean.plannerScore, wideMean.meanReturn);
  assert.equal(wideMean.actions.at(-1), 'glare');
  assert.equal(widePen.actions.at(-1), 'shelf');
  assert.equal(narrowPen.actions.at(-1), 'glare');
  const wideCell = E.cellStats(6, 0, 0.5);
  const narrowCell = E.cellStats(4, 2, 0.5);
  assert.equal(wideCell.mean, narrowCell.mean);
  assert.ok(narrowCell.disagreement < wideCell.disagreement);
  assert.ok(narrowCell.score > wideCell.score);
  assert.equal(widePen.plannerScore, scoreOf(widePen.actions, wide.A, wide.B, 0.5, E.GRAPH).score);
  assert.equal(narrowPen.plannerScore, scoreOf(narrowPen.actions, narrow.A, narrow.B, 0.5, E.GRAPH).score);
});

test('swapping the two tables leaves the score and the plan unchanged', () => {
  const { A, B } = tables({ 'aisle|vault': 2, 'start|walk': 0.5 }, { 'aisle|glare': 3, 'aisle|vault': 7 });
  const forward = E.plan(A, B, 0.25, E.GRAPH);
  const backward = E.plan(B, A, 0.25, E.GRAPH);
  assert.deepEqual(backward.actions, forward.actions);
  assert.equal(backward.plannerScore, forward.plannerScore);
  assert.equal(backward.meanReturn, forward.meanReturn);
  for (let i = 0; i < forward.steps.length; i++) {
    assert.equal(backward.steps[i].mean, forward.steps[i].mean);
    assert.equal(backward.steps[i].disagreement, forward.steps[i].disagreement);
    assert.equal(backward.steps[i].score, forward.steps[i].score);
    assert.equal(backward.steps[i].modelA, forward.steps[i].modelB);
    assert.equal(backward.steps[i].modelB, forward.steps[i].modelA);
  }
});

test('illegal actions, terminals, and reset follow the graph', () => {
  const env = E.reset(E.GRAPH);
  assert.equal(env.state, 'start');
  assert.equal(env.trueReturn, 0);
  assert.equal(env.terminal, false);
  assert.throws(() => E.step(env, 'shelf', E.LESSON_TRUTH, E.GRAPH), /illegal/);
  assert.equal(env.state, 'start');
  E.step(env, 'walk', E.LESSON_TRUTH, E.GRAPH);
  assert.equal(env.state, 'aisle');
  E.step(env, 'shelf', truthOf({ 'aisle|shelf': 7 }), E.GRAPH);
  assert.equal(env.terminal, true);
  assert.equal(env.trueReturn, 7);
  assert.throws(() => E.step(env, 'glare', E.LESSON_TRUTH, E.GRAPH), /terminal/);
  const fresh = E.reset(E.GRAPH);
  assert.equal(fresh.state, 'start');
  assert.equal(fresh.trueReturn, 0);
  assert.deepEqual(fresh.path, ['start']);
  assert.throws(() => E.rollout(['shelf'], E.LESSON_TRUTH, E.GRAPH), /illegal/);
  assert.throws(() => E.rollout(['walk', 'shelf', 'glare'], E.LESSON_TRUTH, E.GRAPH), /terminal/);
  const graph = JSON.parse(JSON.stringify(E.GRAPH));
  graph.transitions['shelf|glare'] = 'glare';
  const planned = E.plan(E.LESSON_A, E.LESSON_B, E.LESSON_COEFFICIENT, graph);
  assert.deepEqual(planned.actions, ['walk', 'shelf']);
  assert.equal(planned.state, 'shelf');
  const noVault = JSON.parse(JSON.stringify(E.GRAPH));
  delete noVault.transitions['aisle|vault'];
  const high = tables({ 'aisle|vault': 9 }, { 'aisle|vault': 9 });
  const blocked = E.plan(high.A, high.B, 0, noVault);
  assert.notEqual(blocked.actions.at(-1), 'vault');
  assert.equal(blocked.actions.at(-1), 'glare');
});

test('a tie keeps the lexicographically smaller action list', () => {
  const { A, B } = tables({ 'aisle|shelf': 2, 'aisle|vault': 2, 'aisle|glare': 0 }, { 'aisle|shelf': 2, 'aisle|vault': 2, 'aisle|glare': 0 });
  const planned = E.plan(A, B, 0.5, E.GRAPH);
  assert.equal(planned.actions.join(','), 'walk,shelf');
  assert.equal(planned.tieBreak.includes('lexicographically'), true);
});

test('missing rewards and a negative coefficient are rejected', () => {
  const { A, B } = tables();
  delete A['aisle|glare'];
  assert.throws(() => E.plan(A, B, 0, E.GRAPH), /missing/);
  assert.throws(() => E.plan(E.LESSON_A, E.LESSON_B, -0.1, E.GRAPH), /coefficient/);
  assert.throws(() => E.plan(E.LESSON_A, E.LESSON_B, Number.NaN, E.GRAPH), /coefficient/);
  const stuck = { start: 'start', terminal: {}, transitions: {} };
  assert.throws(() => E.plan(E.LESSON_A, E.LESSON_B, 0, stuck), /no legal action/);
});

test('the cited limit is a lecture 15 penalty, not a fitted ensemble and not MOPO', () => {
  assert.equal(E.SOURCE.slides, 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-15.pdf');
  assert.equal(E.SOURCE.pages.penalty, 13);
  assert.equal(E.SOURCE.pages.bootstrap, 20);
  assert.ok(E.SOURCE.lines.some((line) => /pessimism/.test(line)));
  assert.ok(E.SOURCE.lines.some((line) => /high-variance/.test(line) && /mean is the same/.test(line)));
  assert.ok(E.SOURCE.lines.some((line) => /see if they agree/.test(line)));
  assert.ok(E.LIMITS.some((line) => /does not resample/.test(line)));
  assert.ok(E.LIMITS.some((line) => /not MOPO and not COMBO/.test(line)));
  assert.ok(E.LIMITS.some((line) => /does not mean the tables match/.test(line)));
  assert.equal(E.LIMITS.some((line) => /this page trains/.test(line)), false);
});

test('the lesson id mounts before replan and does not replace the other model lessons', () => {
  const context = vm.createContext({
    window: {
      CONTENT: {
        phases: [{ n: 8, title: 'Learning through a world model' }],
        levels: [{ id: 'supermimic', custom: true }, { id: 'replan', custom: true }, { id: 'elbo', custom: true }],
        worldNames: {},
      },
      BBENSEMBLE: E,
    },
  });
  vm.runInContext(fs.readFileSync('web/ensemble-level.js', 'utf8'), context);
  const ids = context.window.CONTENT.levels.map((level) => level.id);
  assert.deepEqual(ids, ['supermimic', 'ensemble', 'replan', 'elbo']);
  const lesson = context.window.CONTENT.levels[1];
  assert.equal(lesson.custom, true);
  assert.equal(lesson.phase, 8);
  assert.equal(lesson.world, 'ensemble');
  assert.equal(context.window.CONTENT.worldNames.ensemble.length > 0, true);
  assert.equal(typeof context.window.BBENSEMBLE_LEVEL.mount, 'function');
  assert.equal(typeof context.window.BBENSEMBLE_LEVEL.run, 'function');
  const ran = context.window.BBENSEMBLE_LEVEL.run();
  assert.equal(ran.meanRun.trueReturn, 0);
  assert.equal(ran.penRun.trueReturn, 1);
  assert.notEqual(ran.meanPlan.actions.at(-1), ran.penPlan.actions.at(-1));
});
