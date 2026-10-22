'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/agents/messages.js');

function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), label || 'finite');
  assert.ok(Math.abs(actual - expected) <= 1e-9, (label || 'value') + ' ' + actual + ' vs ' + expected);
}

function model(overrides) {
  return M.lessonModel(overrides);
}

function factor(spec, t, state, action) {
  if (!spec.factors) return 1;
  const byTime = spec.factors[t] || spec.factors[String(t)];
  if (!byTime) return 1;
  const byState = byTime[state] || byTime[String(state)];
  if (!byState || byState[action] == null) return 1;
  return byState[action];
}

function prior(spec, state, action) {
  const table = spec.priorByState && (spec.priorByState[state] || spec.priorByState[String(state)]);
  return (table || spec.prior)[action];
}

function branchList(spec, state, action) {
  const cell = spec.transitions[state][action];
  if (typeof cell === 'number') return [[cell, 1]];
  return Object.keys(cell).map((key) => [Number(key), cell[key]]);
}

function terminal(spec, state) {
  return state === spec.goal ? 1 : spec.miss;
}

// Expand every action sequence and every transition branch. This is not the backward loop.
function futures(spec, t, state) {
  if (t > spec.horizon) return [{ weight: terminal(spec, state), actions: [] }];
  const out = [];
  for (const action of spec.actions) {
    const p = prior(spec, state, action);
    const f = factor(spec, t, state, action);
    for (const [next, prob] of branchList(spec, state, action)) {
      for (const fut of futures(spec, t + 1, next)) {
        out.push({ weight: p * prob * f * fut.weight, actions: [action].concat(fut.actions) });
      }
    }
  }
  return out;
}

function enumerated(spec) {
  const rows = [];
  for (let t = 1; t <= spec.horizon; t++) {
    for (const state of spec.states) {
      const byAction = {};
      for (const action of spec.actions) {
        let beta = 0;
        const f = factor(spec, t, state, action);
        for (const [next, prob] of branchList(spec, state, action)) {
          if (t === spec.horizon) beta += f * prob * terminal(spec, next);
          else {
            for (const fut of futures(spec, t + 1, next)) beta += f * prob * fut.weight;
          }
        }
        byAction[action] = beta;
      }
      let z = 0;
      for (const action of spec.actions) z += prior(spec, state, action) * byAction[action];
      for (const action of spec.actions) {
        rows.push({
          t, state, action,
          beta: byAction[action],
          betaState: z,
          posterior: z > 0 ? prior(spec, state, action) * byAction[action] / z : null,
        });
      }
    }
  }
  const startWeight = futures(spec, 1, spec.start).reduce((sum, row) => sum + row.weight, 0);
  return { rows, startWeight };
}

function row(result, t, state, action) {
  return result.rows.find((item) => item.t === t && item.state === state && item.action === action);
}

function noNan(value) {
  return !JSON.stringify(value).includes('NaN') && !JSON.stringify(value).includes('Infinity');
}

function goalChaser(spec) {
  const actions = [];
  let state = spec.start;
  for (let t = 0; t < spec.horizon; t++) {
    const action = spec.goal > state ? 'right' : 'left';
    actions.push(action);
    const cell = spec.transitions[state][action];
    state = typeof cell === 'number' ? cell : state;
  }
  return actions;
}

test('the lesson case is a finite deterministic line with a left-biased prior', () => {
  const spec = model();
  const result = M.solve(spec);
  assert.equal(result.learned, false);
  assert.equal(result.trainingData, null);
  assert.equal(result.deterministic, true);
  assert.equal(result.caveat, 'deterministic-dynamics');
  assert.equal(result.horizon, 2);
  assert.equal(result.sequences, 4);
  assert.equal(result.goal, 2);
  assert.equal(result.miss, 0.05);
  assert.deepEqual(result.prior, { left: 0.7, right: 0.3 });
  assert.equal(result.terminal[2], 1);
  assert.equal(result.terminal[0], 0.05);
  assert.equal(result.terminal[1], 0.05);
});

test('backward messages match an exhaustive sum of the same trajectory weights', () => {
  const specs = [
    model(),
    model({ goal: 0 }),
    model({ horizon: 1 }),
    model({ horizon: 3, miss: 0.2, prior: { left: 0.4, right: 0.6 } }),
    model({
      prior: { left: 0.2, right: 0.8 },
      transitions: {
        0: { left: { 0: 0.5, 1: 0.5 }, right: 1 },
        1: { left: 0, right: { 1: 0.25, 2: 0.75 } },
        2: { left: { 1: 1 }, right: { 2: 1 } },
      },
    }),
    model({
      factors: { 1: { 0: { left: 1, right: 0.25 }, 1: { left: 1, right: 0.25 }, 2: { left: 1, right: 0.25 } } },
    }),
  ];
  for (const spec of specs) {
    const got = M.solve(spec);
    const want = enumerated(spec);
    near(got.stateMessageAtStart, want.startWeight, 'start message');
    assert.equal(got.rows.length, want.rows.length);
    for (const expected of want.rows) {
      const actual = row(got, expected.t, expected.state, expected.action);
      near(actual.beta, expected.beta, 'beta ' + expected.t + ' ' + expected.state + ' ' + expected.action);
      near(actual.betaState, expected.betaState, 'beta state');
      if (expected.posterior == null) assert.equal(actual.posterior, null);
      else near(actual.posterior, expected.posterior, 'posterior');
    }
    for (const item of got.normalizers) {
      if (item.defined) near(item.sum, 1, 'normalizer');
      else assert.equal(item.sum, null);
    }
  }
});

test('the prior stays inside the conditioned probability and cancels only when it is uniform', () => {
  const biased = M.solve(model());
  const atStart = {
    left: row(biased, 1, 0, 'left'),
    right: row(biased, 1, 0, 'right'),
  };
  const priorRatio = atStart.right.prior / atStart.left.prior;
  const messageRatio = atStart.right.beta / atStart.left.beta;
  const posteriorRatio = atStart.right.posterior / atStart.left.posterior;
  near(posteriorRatio, priorRatio * messageRatio, 'posterior ratio');
  assert.ok(atStart.right.beta > atStart.left.beta);
  assert.ok(atStart.left.prior > atStart.right.prior);
  assert.ok(atStart.right.posterior > atStart.left.posterior);

  const flat = M.solve(model({ prior: { left: 0.5, right: 0.5 } }));
  const left = row(flat, 1, 1, 'left');
  const right = row(flat, 1, 1, 'right');
  near(left.posterior, left.beta / (left.beta + right.beta), 'uniform left');
  near(right.posterior, right.beta / (left.beta + right.beta), 'uniform right');
});

test('prior-only misses the right goal, the message mode reaches it, and a strong prior keeps the miss', () => {
  const priorOnly = M.solve(model({ policy: 'prior' }));
  const messages = M.solve(model({ policy: 'message' }));
  const conditioned = M.solve(model({ policy: 'conditioned' }));
  assert.deepEqual(priorOnly.path, [0, 0, 0]);
  assert.equal(priorOnly.reached, false);
  assert.equal(messages.reached, true);
  assert.equal(conditioned.reached, true);
  assert.ok(conditioned.path[conditioned.path.length - 1] === 2);
  assert.notDeepEqual(conditioned.steps.map((step) => step.action), priorOnly.steps.map((step) => step.action));

  const strong = M.solve(model({ prior: M.STRONG_PRIOR }));
  const strongMessage = M.solve(model({ prior: M.STRONG_PRIOR, policy: 'message' }));
  assert.equal(strong.reached, false);
  assert.equal(strongMessage.reached, true);
  assert.ok(row(strong, 1, 0, 'left').posterior > row(strong, 1, 0, 'right').posterior);
  assert.ok(row(strong, 1, 0, 'right').beta > row(strong, 1, 0, 'left').beta);
});

test('moving the goal from right to left changes the conditioned action where both goals are one step away', () => {
  const right = M.solve(model({ goal: 2 }));
  const left = M.solve(model({ goal: 0 }));
  const rightLast = row(right, 2, 1, 'right');
  const leftLast = row(left, 2, 1, 'left');
  assert.ok(rightLast.posterior > row(right, 2, 1, 'left').posterior);
  assert.ok(leftLast.posterior > row(left, 2, 1, 'right').posterior);
  assert.equal(M.solve(model({ goal: 2 })).steps[1].action, 'right');
  assert.notEqual(row(left, 2, 1, 'left').posterior, row(right, 2, 1, 'left').posterior);
});

test('a goal-index walker disagrees when left is the transition that approaches the goal', () => {
  const reversed = model({
    prior: { left: 0.3, right: 0.7 },
    transitions: {
      0: { left: 1, right: 0 },
      1: { left: 2, right: 0 },
      2: { left: 2, right: 1 },
    },
  });
  const chased = goalChaser(reversed);
  assert.deepEqual(chased, ['right', 'right']);
  const solved = M.solve(reversed);
  const enumeratedMode = enumerated(reversed).rows.filter((item) => item.t === 1 && item.state === 0)
    .sort((a, b) => b.posterior - a.posterior)[0];
  assert.equal(solved.steps[0].action, enumeratedMode.action);
  assert.equal(solved.steps[0].action, 'left');
  assert.notEqual(solved.steps[0].action, chased[0]);
  assert.equal(solved.reached, true);
  assert.equal(M.solve(Object.assign({}, reversed, { policy: 'prior' })).reached, false);
});

test('horizon 1 from the left cell cannot reach the right cell, and a zero prior is not filled in', () => {
  const short = M.solve(model({ horizon: 1 }));
  assert.equal(row(short, 1, 0, 'left').beta, short.miss);
  assert.equal(row(short, 1, 0, 'right').beta, short.miss);
  assert.equal(row(short, 1, 1, 'right').beta, 1);
  assert.equal(row(short, 1, 0, 'left').beta, row(short, 1, 0, 'right').beta);
  assert.equal(short.reached, false);
  assert.deepEqual(short.path, [0, 0]);
  assert.equal(short.impossible, false);

  const blocked = M.solve(model({ prior: M.ZERO_RIGHT }));
  const midRight = row(blocked, 2, 1, 'right');
  const midLeft = row(blocked, 2, 1, 'left');
  assert.equal(midRight.prior, 0);
  assert.ok(midRight.beta > midLeft.beta);
  assert.equal(midRight.posterior, 0);
  assert.equal(blocked.reached, false);
  assert.equal(blocked.impossible, false);
  assert.ok(noNan(blocked));

  const empty = M.solve(model({ miss: 0, horizon: 1, goal: 2 }));
  assert.equal(row(empty, 1, 0, 'left').defined, false);
  assert.equal(row(empty, 1, 0, 'left').posterior, null);
  assert.equal(empty.impossible, true);
  assert.equal(empty.path, null);
  assert.equal(empty.reached, false);
  assert.ok(noNan(empty));

  const noSupport = M.solve(model({ miss: 0, prior: M.ZERO_RIGHT }));
  assert.equal(noSupport.impossible, true);
  assert.equal(row(noSupport, 2, 1, 'right').beta, 1);
  assert.equal(row(noSupport, 2, 1, 'right').posterior, null);
  assert.ok(noNan(noSupport));
});

test('changing the prior, the goal, the horizon, or a transition changes the backup', () => {
  const base = M.solve(model());
  const prior = M.solve(model({ prior: { left: 0.1, right: 0.9 } }));
  const goal = M.solve(model({ goal: 0 }));
  const horizon = M.solve(model({ horizon: 1 }));
  const dynamics = M.solve(model({
    transitions: {
      0: { left: 0, right: 0 },
      1: { left: 0, right: 2 },
      2: { left: 1, right: 2 },
    },
  }));
  assert.notEqual(row(base, 1, 0, 'right').posterior, row(prior, 1, 0, 'right').posterior);
  assert.notEqual(row(base, 2, 1, 'right').beta, row(goal, 2, 1, 'right').beta);
  assert.equal(horizon.rows.some((item) => item.t === 2), false);
  assert.equal(base.rows.some((item) => item.t === 2), true);
  assert.ok(row(dynamics, 1, 0, 'right').beta < row(base, 1, 0, 'right').beta);
  assert.equal(dynamics.reached, false);
});
