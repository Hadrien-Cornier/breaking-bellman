// One-step Dyna-style backups on a given corridor table.
// The corridor below is executed by trueStep. The model is a separate table.
// Real steps never read the model. Model backups never call trueStep for the target.
// This file does not fit a dynamics model and does not import SuperMimic or replan.
(function () {
  'use strict';

  const ACTIONS = ['right', 'left'];
  const STATES = [0, 1, 2, 3];
  const NAMES = ['start', 'mid', 'far', 'goal'];
  const START = 0;
  const FAR = 2;
  const GOAL = 3;
  const REAL_BUDGET = 2;
  const FAR_TO_NEAR = 'far-to-near, right then left';
  const NEAR_TO_FAR = 'near-to-far, right then left';
  const LESSON = {
    gamma: 0.5,
    alpha: 1,
    realBudget: REAL_BUDGET,
    modelBudget: 6,
    order: FAR_TO_NEAR,
    farState: FAR,
    farAction: 'right',
    wrongReward: 0,
  };

  function fail(message) { throw new Error(message); }

  function finite(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(name + ' is not a finite number');
    return value;
  }

  function trueStep(state, action) {
    if (!STATES.includes(state)) fail('state is not on the corridor');
    if (!ACTIONS.includes(action)) fail('action is not left or right');
    if (state === GOAL) return { next: GOAL, reward: 0, terminal: true };
    if (action === 'right') {
      const next = state + 1;
      return { next: next, reward: state === FAR ? 1 : 0, terminal: next === GOAL };
    }
    const next = state === START ? START : state - 1;
    return { next: next, reward: 0, terminal: false };
  }

  function givenModel() {
    const rows = {};
    for (const state of STATES) {
      rows[state] = {};
      for (const action of ACTIONS) {
        const step = trueStep(state, action);
        rows[state][action] = { next: step.next, reward: step.reward };
      }
    }
    return { learned: false, rows: rows };
  }

  function cloneModel(model) {
    return JSON.parse(JSON.stringify(model));
  }

  function applyEdit(model, edit) {
    const copy = cloneModel(model);
    if (!edit) return copy;
    const row = copy.rows[edit.state] && copy.rows[edit.state][edit.action];
    if (!row) fail('edit is not a model cell');
    if (edit.reward != null) row.reward = finite('reward', edit.reward);
    if (edit.next != null) {
      if (!STATES.includes(edit.next)) fail('next is not a cell');
      row.next = edit.next;
    }
    return copy;
  }

  function emptyQ() {
    const q = {};
    for (const state of STATES) q[state] = { right: null, left: null };
    return q;
  }

  function snapshot(q) {
    const out = {};
    for (const state of STATES) out[state] = { right: q[state].right, left: q[state].left };
    return out;
  }

  function boot(q, state, action) {
    const value = q[state][action];
    return value == null ? 0 : value;
  }

  function stateValue(q, state) {
    if (state === GOAL) return 0;
    return Math.max(boot(q, state, 'right'), boot(q, state, 'left'));
  }

  function greedy(q, state) {
    return boot(q, state, 'right') >= boot(q, state, 'left') ? 'right' : 'left';
  }

  function backup(q, state, action, next, reward, gamma, alpha) {
    const terminal = next === GOAL;
    const bootstrap = terminal ? 0 : gamma * stateValue(q, next);
    const target = reward + bootstrap;
    const previous = q[state][action];
    const old = previous == null ? 0 : previous;
    const written = old + alpha * (target - old);
    q[state][action] = written;
    return { previous: previous, target: target, written: written, terminal: terminal };
  }

  function sweepPairs(order) {
    if (order !== FAR_TO_NEAR && order !== NEAR_TO_FAR) fail('unknown sweep order');
    const states = order === NEAR_TO_FAR ? [0, 1, 2] : [2, 1, 0];
    const pairs = [];
    for (const state of states) {
      for (const action of ACTIONS) pairs.push({ state: state, action: action });
    }
    return pairs;
  }

  function cell(q, state, action) {
    const value = q[state][action];
    return { state: state, action: action, value: value, empty: value == null };
  }

  function run(options) {
    const opts = options || {};
    const gamma = opts.gamma == null ? LESSON.gamma : finite('gamma', opts.gamma);
    const alpha = opts.alpha == null ? LESSON.alpha : finite('alpha', opts.alpha);
    const modelBudget = opts.modelBudget == null ? LESSON.modelBudget : opts.modelBudget;
    const order = opts.order || LESSON.order;
    if (gamma < 0 || gamma > 1) fail('gamma must be from 0 to 1');
    if (alpha < 0 || alpha > 1) fail('alpha must be from 0 to 1');
    if (!Number.isInteger(modelBudget) || modelBudget < 0 || modelBudget > 24) fail('model budget must be an integer from 0 to 24');
    const source = opts.model ? cloneModel(opts.model) : givenModel();
    if (source.learned) fail('this lesson does not accept a trained model');
    const model = applyEdit(source, opts.edit);
    const pairs = sweepPairs(order);
    const q = emptyQ();
    const initial = snapshot(q);
    const real = [];
    let state = START;
    for (let i = 0; i < REAL_BUDGET; i++) {
      const action = greedy(q, state);
      const env = trueStep(state, action);
      const modelRow = model.rows[state][action];
      const upd = backup(q, state, action, env.next, env.reward, gamma, alpha);
      real.push({
        source: 'environment',
        index: i + 1,
        state: state,
        action: action,
        next: env.next,
        reward: env.reward,
        terminal: env.terminal,
        modelNext: modelRow.next,
        modelReward: modelRow.reward,
        agrees: modelRow.next === env.next && modelRow.reward === env.reward,
        previous: upd.previous,
        target: upd.target,
        written: upd.written,
      });
      state = env.next;
      if (env.terminal) break;
    }
    const modelTrace = [];
    for (let i = 0; i < modelBudget; i++) {
      const pair = pairs[i % pairs.length];
      const row = model.rows[pair.state][pair.action];
      const env = trueStep(pair.state, pair.action);
      const upd = backup(q, pair.state, pair.action, row.next, row.reward, gamma, alpha);
      modelTrace.push({
        source: 'model',
        index: i + 1,
        sweep: Math.floor(i / pairs.length) + 1,
        state: pair.state,
        action: pair.action,
        next: row.next,
        reward: row.reward,
        envNext: env.next,
        envReward: env.reward,
        agrees: row.next === env.next && row.reward === env.reward,
        previous: upd.previous,
        target: upd.target,
        written: upd.written,
        terminal: upd.terminal,
      });
    }
    const farRow = model.rows[FAR].right;
    const envFar = trueStep(FAR, 'right');
    return {
      learnedModel: false,
      modelTrained: false,
      tieBreak: 'right',
      stepSize: alpha,
      gamma: gamma,
      alpha: alpha,
      order: order,
      sweepLength: pairs.length,
      realBudget: REAL_BUDGET,
      realSteps: real.length,
      modelBudget: modelBudget,
      modelUpdates: modelTrace.length,
      endState: state,
      initial: initial,
      values: snapshot(q),
      real: real,
      modelTrace: modelTrace,
      far: cell(q, FAR, 'right'),
      model: model,
      probe: {
        state: FAR,
        action: 'right',
        modelNext: farRow.next,
        modelReward: farRow.reward,
        envNext: envFar.next,
        envReward: envFar.reward,
        agrees: farRow.next === envFar.next && farRow.reward === envFar.reward,
      },
    };
  }

  const api = {
    ACTIONS: ACTIONS,
    STATES: STATES,
    NAMES: NAMES,
    START: START,
    FAR: FAR,
    GOAL: GOAL,
    REAL_BUDGET: REAL_BUDGET,
    FAR_TO_NEAR: FAR_TO_NEAR,
    NEAR_TO_FAR: NEAR_TO_FAR,
    LESSON: LESSON,
    trueStep: trueStep,
    givenModel: givenModel,
    run: run,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBDYNA = api;
})();
