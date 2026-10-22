// Two already-filled reward tables and a planning penalty.
// No bootstrap sample, no fit, and no shared code with SuperMimic.
(function () {
  'use strict';

  const SOURCE = {
    course: 'CS 285 lecture 15, Model-Based RL Part 1',
    slides: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-15.pdf',
    pages: { penalty: 13, highVariance: 14, pessimistic: 15, bootstrap: 20 },
    lines: [
      'Use penalty ("pessimism") in the face of model uncertainty',
      'expected reward under high-variance prediction is very low, even though mean is the same',
      'Expected value is not the same as pessimistic value',
      'Train multiple models and see if they agree',
    ],
  };

  const LIMITS = [
    'The two tables are already filled in. This page does not resample a dataset and does not fit a model.',
    'The planner reads the two tables, the coefficient, and the legal transitions. It does not read the true reward or the data-support column.',
    'The score of a transition is the average of the two tables minus the coefficient times their absolute difference.',
    'Absolute difference is not a standard deviation and it is not a calibrated interval.',
    'A coefficient of zero leaves the average. It does not remove a door.',
    'A difference of zero does not mean the tables match the aisle. The penalty then subtracts nothing.',
    'Bootstrap resampling, a fitted neural ensemble, and calibrated uncertainty are still open. This is not that training.',
    'This penalty is not MOPO and not COMBO. Those names belong to lecture 18.',
    'The aisle graph is fixed. Episodes end at a door. Reset returns to the start with return 0. There is no discount.',
    'Ties keep the lexicographically smaller action list. The search rejects a path longer than 8 actions.',
  ];

  const EDGES = ['start|walk', 'aisle|shelf', 'aisle|glare', 'aisle|vault'];
  const GRAPH = {
    start: 'start',
    terminal: { shelf: true, glare: true, vault: true },
    transitions: {
      'start|walk': 'aisle',
      'aisle|shelf': 'shelf',
      'aisle|glare': 'glare',
      'aisle|vault': 'vault',
    },
  };
  const LESSON_A = { 'start|walk': 0, 'aisle|shelf': 1, 'aisle|glare': 6, 'aisle|vault': 0 };
  const LESSON_B = { 'start|walk': 0, 'aisle|shelf': 1, 'aisle|glare': 0, 'aisle|vault': 0 };
  const LESSON_TRUTH = { 'start|walk': 0, 'aisle|shelf': 1, 'aisle|glare': 0, 'aisle|vault': 0 };
  const LESSON_SUPPORT = { 'start|walk': true, 'aisle|shelf': true, 'aisle|glare': false, 'aisle|vault': false };
  const LESSON_COEFFICIENT = 0.5;
  const MAX_DEPTH = 8;

  function readGraph(graph) {
    if (!graph || typeof graph.start !== 'string' || !graph.transitions || !graph.terminal) throw new Error('graph is missing');
    return graph;
  }

  function finiteNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(label);
    return value;
  }

  function readReward(table, edge, label) {
    if (!table || typeof table !== 'object') throw new Error(label + ' table is missing');
    if (!Object.prototype.hasOwnProperty.call(table, edge)) throw new Error(label + ' table is missing ' + edge);
    return finiteNumber(table[edge], label + ' reward is not finite at ' + edge);
  }

  function readCoefficient(coefficient) {
    if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient < 0) {
      throw new Error('coefficient must be a finite number and at least 0');
    }
    return coefficient;
  }

  function edgesFrom(state, graph) {
    const out = [];
    for (const key of Object.keys(graph.transitions)) {
      const cut = key.indexOf('|');
      if (cut < 0) continue;
      if (key.slice(0, cut) !== state) continue;
      const next = graph.transitions[key];
      if (typeof next !== 'string' || !next) continue;
      out.push({ edge: key, action: key.slice(cut + 1), next });
    }
    return out;
  }

  function enumerate(state, graph, depth) {
    if (depth > MAX_DEPTH) throw new Error('path is longer than 8');
    if (graph.terminal[state]) return [[]];
    const edges = edgesFrom(state, graph);
    if (!edges.length) throw new Error('no legal action from ' + state);
    const paths = [];
    for (const edge of edges) {
      for (const rest of enumerate(edge.next, graph, depth + 1)) paths.push([edge.action].concat(rest));
    }
    return paths;
  }

  function cellStats(modelA, modelB, coefficient) {
    const left = finiteNumber(modelA, 'model A reward is not finite');
    const right = finiteNumber(modelB, 'model B reward is not finite');
    const lambda = readCoefficient(coefficient);
    const mean = (left + right) / 2;
    const disagreement = Math.abs(left - right);
    return { modelA: left, modelB: right, mean, disagreement, score: mean - lambda * disagreement };
  }

  function scorePath(actions, modelA, modelB, coefficient, graph) {
    let state = graph.start;
    let plannerScore = 0;
    let meanReturn = 0;
    const steps = [];
    for (const action of actions) {
      if (graph.terminal[state]) throw new Error('action after terminal');
      const edge = state + '|' + action;
      const next = graph.transitions[edge];
      if (typeof next !== 'string' || !next) throw new Error('illegal ' + edge);
      const stats = cellStats(readReward(modelA, edge, 'model A'), readReward(modelB, edge, 'model B'), coefficient);
      plannerScore += stats.score;
      meanReturn += stats.mean;
      steps.push({
        edge, action, from: state, to: next,
        modelA: stats.modelA, modelB: stats.modelB,
        mean: stats.mean, disagreement: stats.disagreement, score: stats.score,
      });
      state = next;
    }
    if (!graph.terminal[state]) throw new Error('stopped before a door');
    return { actions: actions.slice(), steps, plannerScore, meanReturn, state };
  }

  function better(a, b) {
    if (a.plannerScore !== b.plannerScore) return a.plannerScore > b.plannerScore;
    return a.actions.join(',') < b.actions.join(',');
  }

  function plan(modelA, modelB, coefficient, graph) {
    const world = readGraph(graph);
    const lambda = readCoefficient(coefficient);
    const paths = enumerate(world.start, world, 0);
    let best = null;
    for (const actions of paths) {
      const scored = scorePath(actions, modelA, modelB, lambda, world);
      if (!best || better(scored, best)) best = scored;
    }
    return {
      actions: best.actions.slice(),
      steps: best.steps.map((step) => Object.assign({}, step)),
      plannerScore: best.plannerScore,
      meanReturn: best.meanReturn,
      state: best.state,
      coefficient: lambda,
      candidates: paths.length,
      learned: false,
      fittedHere: false,
      tieBreak: 'higher planner score, then lexicographically smaller action list',
    };
  }

  function reset(graph) {
    const world = readGraph(graph);
    return {
      state: world.start,
      trueReturn: 0,
      terminal: !!world.terminal[world.start],
      path: [world.start],
      rewards: [],
    };
  }

  function step(env, action, truth, graph) {
    const world = readGraph(graph);
    if (!env || typeof env.state !== 'string') throw new Error('environment is missing');
    if (env.terminal) throw new Error('terminal');
    const edge = env.state + '|' + action;
    const next = world.transitions[edge];
    if (typeof next !== 'string' || !next) throw new Error('illegal ' + edge);
    const reward = readReward(truth, edge, 'truth');
    env.trueReturn += reward;
    env.state = next;
    env.terminal = !!world.terminal[next];
    env.path.push(next);
    env.rewards.push(reward);
    return env;
  }

  function rollout(actions, truth, graph) {
    const world = readGraph(graph);
    const env = reset(world);
    for (const action of actions) {
      if (env.terminal) throw new Error('action after terminal');
      step(env, action, truth, world);
    }
    if (!env.terminal) throw new Error('stopped before a door');
    return {
      actions: Array.from(actions),
      path: env.path.slice(),
      rewards: env.rewards.slice(),
      trueReturn: env.trueReturn,
      terminal: env.terminal,
    };
  }

  function copyRewards(table) {
    const out = {};
    for (const edge of EDGES) out[edge] = readReward(table, edge, 'reward');
    return out;
  }

  const api = {
    SOURCE, LIMITS, EDGES, GRAPH, MAX_DEPTH,
    LESSON_A, LESSON_B, LESSON_TRUTH, LESSON_SUPPORT, LESSON_COEFFICIENT,
    cellStats, plan, reset, step, rollout, copyRewards,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBENSEMBLE = api;
})();
