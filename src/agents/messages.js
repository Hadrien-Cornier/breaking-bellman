// Finite-horizon backward messages for a known controlled line.
// Levine, 2018, arXiv:1805.00909, section 2.3, equation (6):
//   beta_t(s, a) = p(O_t | s, a) * sum_{s'} P(s' | s, a) * beta_{t+1}(s')
//   beta_t(s) = sum_a p(a | s) * beta_t(s, a)
//   pi_t(a | s, O) = p(a | s) * beta_t(s, a) / beta_t(s)
// The raw message beta_t(s, a) does not contain the action prior.
// The conditioned action probability does.
// This file does not learn a reward, a dynamics model, or a variational posterior.
(function () {
  'use strict';

  const ACTIONS = ['left', 'right'];
  const STATES = [0, 1, 2];

  // Goal likelihood after the last action. 1 on the goal cell, miss elsewhere.
  // miss is positive and finite so a left-biased prior is not wiped out.
  const LESSON = {
    states: STATES.slice(),
    actions: ACTIONS.slice(),
    start: 0,
    horizon: 2,
    goal: 2,
    miss: 0.05,
    prior: { left: 0.7, right: 0.3 },
    transitions: {
      0: { left: 0, right: 1 },
      1: { left: 0, right: 2 },
      2: { left: 1, right: 2 },
    },
  };

  const STRONG_PRIOR = { left: 0.95, right: 0.05 };
  const ZERO_RIGHT = { left: 1, right: 0 };

  function fail(message) { throw new Error(message); }

  function num(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(name + ' is not a finite number');
    return value;
  }

  function nonneg(name, value) {
    const x = num(name, value);
    if (x < 0) fail(name + ' is negative');
    return x;
  }

  function lessonModel(overrides) {
    const base = {
      states: LESSON.states.slice(),
      actions: LESSON.actions.slice(),
      start: LESSON.start,
      horizon: LESSON.horizon,
      goal: LESSON.goal,
      miss: LESSON.miss,
      prior: Object.assign({}, LESSON.prior),
      transitions: {
        0: Object.assign({}, LESSON.transitions[0]),
        1: Object.assign({}, LESSON.transitions[1]),
        2: Object.assign({}, LESSON.transitions[2]),
      },
      policy: 'conditioned',
    };
    if (!overrides) return base;
    const next = Object.assign({}, base, overrides);
    if (overrides.prior) next.prior = Object.assign({}, overrides.prior);
    if (overrides.priorByState) next.priorByState = JSON.parse(JSON.stringify(overrides.priorByState));
    if (overrides.transitions) next.transitions = JSON.parse(JSON.stringify(overrides.transitions));
    if (overrides.factors) next.factors = JSON.parse(JSON.stringify(overrides.factors));
    if (overrides.states) next.states = overrides.states.slice();
    if (overrides.actions) next.actions = overrides.actions.slice();
    return next;
  }

  function priorAt(model, state, action) {
    const table = model.priorByState && (model.priorByState[state] || model.priorByState[String(state)]);
    const row = table || model.prior;
    if (!row || row[action] == null) fail('missing prior for ' + state + ' ' + action);
    return nonneg('prior', row[action]);
  }

  function factorAt(model, t, state, action) {
    if (!model.factors) return 1;
    const byTime = model.factors[t] || model.factors[String(t)];
    if (!byTime) return 1;
    const byState = byTime[state] || byTime[String(state)];
    if (!byState || byState[action] == null) return 1;
    return nonneg('optimality factor', byState[action]);
  }

  function branches(model, state, action) {
    const table = model.transitions[state] || model.transitions[String(state)];
    if (!table || table[action] == null) fail('missing transition for ' + state + ' ' + action);
    const cell = table[action];
    if (typeof cell === 'number') {
      if (!model.states.includes(cell)) fail('transition leaves the state list');
      return [[cell, 1]];
    }
    const out = [];
    for (const key of Object.keys(cell)) {
      const next = Number(key);
      if (!model.states.includes(next)) fail('transition leaves the state list');
      out.push([next, nonneg('transition', cell[key])]);
    }
    return out;
  }

  function isDeterministic(model) {
    for (const state of model.states) {
      for (const action of model.actions) {
        const list = branches(model, state, action);
        if (list.length !== 1 || list[0][1] !== 1) return false;
      }
    }
    return true;
  }

  function modeOf(weights, actions) {
    if (!weights) return null;
    let best = null;
    for (const action of actions) {
      const w = weights[action];
      if (w == null || !Number.isFinite(w)) return null;
      if (best == null || w > weights[best]) best = action;
    }
    return best;
  }

  function solve(input) {
    const model = lessonModel(input);
    if (!model.states.length || !model.actions.length) fail('empty model');
    if (!model.states.includes(model.start)) fail('start is not a state');
    if (!model.states.includes(model.goal)) fail('goal is not a state');
    const horizon = model.horizon;
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 8) fail('horizon must be an integer from 1 to 8');
    nonneg('miss', model.miss);
    const policy = model.policy || 'conditioned';
    if (policy !== 'conditioned' && policy !== 'prior' && policy !== 'message') fail('unknown policy');

    const deterministic = isDeterministic(model);
    const betaState = [];
    const terminal = {};
    const events = [];
    betaState[horizon + 1] = {};
    for (const state of model.states) {
      terminal[state] = state === model.goal ? 1 : model.miss;
      betaState[horizon + 1][state] = terminal[state];
    }
    events.push({ kind: 'terminal', time: horizon + 1, values: Object.assign({}, terminal) });

    const rows = [];
    for (let t = horizon; t >= 1; t--) {
      const actionMessage = {};
      const stateMessage = {};
      const posterior = {};
      const defined = {};
      for (const state of model.states) {
        actionMessage[state] = {};
        let z = 0;
        for (const action of model.actions) {
          let expected = 0;
          const nexts = branches(model, state, action);
          for (const [next, prob] of nexts) expected += prob * betaState[t + 1][next];
          const beta = factorAt(model, t, state, action) * expected;
          if (!Number.isFinite(beta)) fail('message is not finite');
          actionMessage[state][action] = beta;
          z += priorAt(model, state, action) * beta;
        }
        if (!Number.isFinite(z)) fail('state message is not finite');
        stateMessage[state] = z;
        if (z > 0) {
          posterior[state] = {};
          defined[state] = true;
          for (const action of model.actions) {
            const pi = priorAt(model, state, action) * actionMessage[state][action] / z;
            if (!Number.isFinite(pi)) fail('conditioned probability is not finite');
            posterior[state][action] = pi;
          }
        } else {
          posterior[state] = null;
          defined[state] = false;
        }
      }
      betaState[t] = stateMessage;
      events.push({ kind: 'backup', time: t, actionMessage, stateMessage, posterior, defined });
      for (const state of model.states) {
        for (const action of model.actions) {
          const nexts = branches(model, state, action);
          rows.push({
            t,
            state,
            action,
            next: nexts.length === 1 ? nexts[0][0] : null,
            transition: nexts.map(([next, prob]) => ({ state: next, prob })),
            factor: factorAt(model, t, state, action),
            beta: actionMessage[state][action],
            prior: priorAt(model, state, action),
            betaState: stateMessage[state],
            posterior: posterior[state] ? posterior[state][action] : null,
            defined: defined[state],
          });
        }
      }
    }
    rows.sort((a, b) => a.t - b.t || a.state - b.state || model.actions.indexOf(a.action) - model.actions.indexOf(b.action));

    const normalizers = [];
    for (let t = 1; t <= horizon; t++) {
      for (const state of model.states) {
        const slice = rows.filter((row) => row.t === t && row.state === state);
        let sum = 0;
        let ok = slice.every((row) => row.defined);
        if (ok) {
          for (const row of slice) sum += row.posterior;
          if (!Number.isFinite(sum)) fail('normalizer is not finite');
        } else sum = null;
        normalizers.push({ t, state, sum, defined: ok });
      }
    }

    const steps = [];
    const path = [model.start];
    let impossible = false;
    let state = model.start;
    if (deterministic) {
      for (let t = 1; t <= horizon; t++) {
        const slice = rows.filter((row) => row.t === t && row.state === state);
        const weights = {};
        for (const row of slice) {
          if (policy === 'prior') weights[row.action] = row.prior;
          else if (policy === 'message') weights[row.action] = row.beta;
          else weights[row.action] = row.posterior;
        }
        const usable = policy === 'conditioned' ? slice.every((row) => row.defined) : slice.every((row) => Number.isFinite(weights[row.action]));
        if (!usable) {
          impossible = true;
          steps.push({ t, state, action: null, defined: false });
          events.push({ kind: 'undefined', time: t, state, action: null, defined: false });
          break;
        }
        const action = modeOf(weights, model.actions);
        const chosen = slice.find((row) => row.action === action);
        steps.push({
          t,
          state,
          action,
          defined: true,
          beta: chosen.beta,
          prior: chosen.prior,
          posterior: chosen.posterior,
          betaState: chosen.betaState,
        });
        state = chosen.next;
        path.push(state);
        events.push({ kind: 'move', time: t, ...steps[steps.length - 1], next: state });
      }
    }

    const reached = deterministic && !impossible && path[path.length - 1] === model.goal;
    let sequences = 1;
    for (let t = 0; t < horizon; t++) sequences *= model.actions.length;

    return {
      learned: false,
      trainingData: null,
      objective: 'p(actions | states, optimality) from the backward messages',
      deterministic,
      caveat: deterministic ? 'deterministic-dynamics' : 'stochastic-backup-is-optimistic',
      policy,
      horizon,
      start: model.start,
      goal: model.goal,
      miss: model.miss,
      prior: Object.assign({}, model.prior),
      terminal,
      rows,
      events,
      normalizers,
      steps,
      path: deterministic && !impossible ? path : null,
      end: deterministic && !impossible ? path[path.length - 1] : null,
      reached,
      impossible,
      sequences,
      stateMessageAtStart: betaState[1][model.start],
    };
  }

  const api = {
    LESSON, ACTIONS, STATES, STRONG_PRIOR, ZERO_RIGHT,
    lessonModel, solve, priorAt, branches,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBMESSAGES = api;
})();
