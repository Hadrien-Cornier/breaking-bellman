// Tiny-grid reward fitting for the lecture 13 lesson.
// Linear features, soft-optimal action likelihood, then a planner that sees only weights.
// This is an independent teaching engine. It does not participate in RLA.run or Fast results.
(function () {
  'use strict';
  const WIDTH = 5, HEIGHT = 3, N = WIDTH * HEIGHT;
  const GAMMA = 0.9, BOUND = 4, MAX_ITERS = 300, TOL = 1e-9;
  const FEATURES = ['closeness', 'hole', 'lane', 'step'];
  const FEATURE = { closeness: 0, hole: 1, lane: 2, step: 3 };
  const ACTIONS = [
    { id: 'right', dx: 1, dy: 0 },
    { id: 'up', dx: 0, dy: -1 },
    { id: 'down', dx: 0, dy: 1 },
    { id: 'left', dx: -1, dy: 0 },
  ];
  const ACTION = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
  const LATTICE = [-4, -2, 0, 2, 4];
  const START = { x: 0, y: 1 };
  const GOAL = { x: 4, y: 1 };
  const HOLE = { x: 2, y: 1 };
  const PROXY_WEIGHTS = [1, 0, 0, 0];

  function index(x, y) { return y * WIDTH + x; }
  function cell(i) { return { x: i % WIDTH, y: (i / WIDTH) | 0 }; }
  const START_I = index(START.x, START.y);
  const GOAL_I = index(GOAL.x, GOAL.y);
  const HOLE_I = index(HOLE.x, HOLE.y);

  const PHI = [];
  for (let i = 0; i < N; i++) {
    const c = cell(i);
    const dist = Math.abs(c.x - GOAL.x) + Math.abs(c.y - GOAL.y);
    PHI.push([
      -dist,
      i === HOLE_I ? 1 : 0,
      c.y === 0 ? 1 : c.y === 2 ? -1 : 0,
      i === GOAL_I ? 0 : 1,
    ]);
  }
  const TRANS = [];
  for (let i = 0; i < N; i++) {
    const c = cell(i);
    const moves = [];
    if (i !== GOAL_I) {
      for (const a of ACTIONS) {
        const x = c.x + a.dx, y = c.y + a.dy;
        if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) moves.push({ id: a.id, to: index(x, y) });
      }
    }
    TRANS.push(moves);
  }

  function dot(phi, weights) {
    let s = 0;
    for (let i = 0; i < phi.length; i++) s += phi[i] * weights[i];
    return s;
  }
  function clamp(v) { return Math.max(-BOUND, Math.min(BOUND, v)); }
  function sameWeights(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function solve(weights, soft) {
    const reward = new Float64Array(N);
    for (let i = 0; i < N; i++) reward[i] = dot(PHI[i], weights);
    const V = new Float64Array(N);
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      let delta = 0;
      for (let s = 0; s < N; s++) {
        const moves = TRANS[s];
        if (!moves.length) { V[s] = 0; continue; }
        let best = -Infinity;
        const qs = new Array(moves.length);
        for (let k = 0; k < moves.length; k++) {
          const to = moves[k].to;
          const q = reward[to] + (to === GOAL_I ? 0 : GAMMA * V[to]);
          qs[k] = q;
          if (q > best) best = q;
        }
        let next = best;
        if (soft) {
          let sum = 0;
          for (let k = 0; k < qs.length; k++) sum += Math.exp(qs[k] - best);
          next = best + Math.log(sum);
        }
        delta = Math.max(delta, Math.abs(next - V[s]));
        V[s] = next;
      }
      if (delta < TOL) break;
    }
    return { reward, V };
  }

  function actionTable(weights) {
    const { reward, V } = solve(weights, true);
    const Q = new Array(N);
    const pi = new Array(N);
    for (let s = 0; s < N; s++) {
      const moves = TRANS[s];
      const q = {};
      const qs = [];
      for (let k = 0; k < moves.length; k++) {
        const to = moves[k].to;
        const value = reward[to] + (to === GOAL_I ? 0 : GAMMA * V[to]);
        q[moves[k].id] = value;
        qs.push(value);
      }
      let max = -Infinity;
      for (let k = 0; k < qs.length; k++) if (qs[k] > max) max = qs[k];
      let sum = 0;
      for (let k = 0; k < qs.length; k++) sum += Math.exp(qs[k] - max);
      const logZ = max + Math.log(sum);
      const p = {};
      for (const id in q) p[id] = Math.exp(q[id] - logZ);
      Q[s] = q;
      pi[s] = p;
    }
    return { Q, pi };
  }

  function actionLogLikelihood(weights, demos) {
    const { pi } = actionTable(weights);
    let ll = 0;
    for (let i = 0; i < demos.length; i++) {
      const step = demos[i];
      const p = pi[index(step.x, step.y)][step.a];
      if (!(p > 0)) return -Infinity;
      ll += Math.log(p);
    }
    return ll;
  }

  function actionValues(weights, x, y) {
    const hard = solve(weights, false);
    const out = {};
    for (let k = 0; k < TRANS[index(x, y)].length; k++) {
      const move = TRANS[index(x, y)][k];
      out[move.id] = hard.reward[move.to] + (move.to === GOAL_I ? 0 : GAMMA * hard.V[move.to]);
    }
    return out;
  }

  // Greedy plan on the hard Bellman backup. Tie break is action order: right, up, down, left.
  // Demonstration actions are not an argument.
  function plan(weights) {
    const { reward, V } = solve(weights, false);
    const path = [Object.assign({}, START)];
    const seen = new Set();
    for (let guard = 0; guard < N + 2; guard++) {
      const here = path[path.length - 1];
      const s = index(here.x, here.y);
      if (s === GOAL_I) break;
      if (seen.has(s)) break;
      seen.add(s);
      const moves = TRANS[s];
      let best = null, bestQ = -Infinity;
      for (let k = 0; k < moves.length; k++) {
        const to = moves[k].to;
        const q = reward[to] + (to === GOAL_I ? 0 : GAMMA * V[to]);
        if (q > bestQ + 1e-12) { bestQ = q; best = moves[k]; }
      }
      if (!best) break;
      path.push(cell(best.to));
    }
    return path;
  }

  function fitReward(demos, lock) {
    const key = demoKey(demos) + '|' + (lock ? lock.index + '=' + lock.value : 'free');
    const hit = fitReward.cache.get(key);
    if (hit) return hit;
    let evaluations = 0;
    let bestW = null, bestLl = -Infinity;
    function score(w) {
      evaluations += 1;
      const ll = actionLogLikelihood(w, demos);
      if (ll > bestLl) { bestLl = ll; bestW = w.slice(); }
      return ll;
    }
    const spans = FEATURES.map((_, i) => (lock && lock.index === i ? [lock.value] : LATTICE));
    const current = [0, 0, 0, 0];
    (function walk(i) {
      if (i === FEATURES.length) { score(current); return; }
      for (let k = 0; k < spans[i].length; k++) { current[i] = spans[i][k]; walk(i + 1); }
    })(0);
    let w = bestW.slice();
    for (const step of [1, 0.5, 0.25, 0.1]) {
      let improved = true, guard = 0;
      while (improved && guard++ < 48) {
        improved = false;
        for (let i = 0; i < w.length; i++) {
          if (lock && lock.index === i) continue;
          for (const dir of [-1, 1]) {
            const trial = w.slice();
            trial[i] = clamp(w[i] + dir * step);
            if (sameWeights(trial, w)) continue;
            score(trial);
            if (sameWeights(bestW, trial)) { w = bestW.slice(); improved = true; }
          }
        }
      }
    }
    const result = {
      weights: bestW.slice(),
      logLikelihood: bestLl,
      evaluations,
      lock: lock ? { index: lock.index, value: lock.value, feature: FEATURES[lock.index] } : null,
    };
    fitReward.cache.set(key, result);
    return result;
  }
  fitReward.cache = new Map();

  function entersHole(path) {
    return path.some((p) => p.x === HOLE.x && p.y === HOLE.y);
  }
  function reachesGoal(path) {
    const last = path[path.length - 1];
    return !!last && last.x === GOAL.x && last.y === GOAL.y;
  }
  function pack(id, weights, demos, extra) {
    const path = plan(weights);
    return Object.assign({
      id,
      weights: weights.slice(),
      logLikelihood: actionLogLikelihood(weights, demos),
      path,
      entersHole: entersHole(path),
      reachesGoal: reachesGoal(path),
      visitsNorth: path.some((p) => p.y === 0),
      visitsSouth: path.some((p) => p.y === 2),
    }, extra || {});
  }
  function finitePosterior(rows) {
    let max = -Infinity;
    for (let i = 0; i < rows.length; i++) if (rows[i].logLikelihood > max) max = rows[i].logLikelihood;
    const terms = rows.map((row) => Math.exp(row.logLikelihood - max));
    const z = terms.reduce((a, b) => a + b, 0);
    return rows.map((row, i) => Object.assign({}, row, { posterior: terms[i] / z }));
  }
  function demoKey(demos) {
    return demos.map((step) => step.x + ',' + step.y + ',' + step.a).join(';');
  }
  function follow(step) {
    const a = ACTION[step.a];
    return { x: step.x + a.dx, y: step.y + a.dy };
  }

  const NORTH_DEMOS = [
    { x: 0, y: 1, a: 'right' }, { x: 1, y: 1, a: 'up' }, { x: 1, y: 0, a: 'right' },
    { x: 2, y: 0, a: 'right' }, { x: 3, y: 0, a: 'right' }, { x: 4, y: 0, a: 'down' },
    { x: 0, y: 1, a: 'up' }, { x: 0, y: 0, a: 'right' }, { x: 1, y: 0, a: 'right' },
    { x: 2, y: 0, a: 'right' }, { x: 3, y: 0, a: 'down' }, { x: 3, y: 1, a: 'right' },
  ];
  const SOUTH_DEMOS = [
    { x: 0, y: 1, a: 'right' }, { x: 1, y: 1, a: 'down' }, { x: 1, y: 2, a: 'right' },
    { x: 2, y: 2, a: 'right' }, { x: 3, y: 2, a: 'right' }, { x: 4, y: 2, a: 'up' },
    { x: 0, y: 1, a: 'down' }, { x: 0, y: 2, a: 'right' }, { x: 1, y: 2, a: 'right' },
    { x: 2, y: 2, a: 'right' }, { x: 3, y: 2, a: 'up' }, { x: 3, y: 1, a: 'right' },
  ];

  const ASSUMPTIONS = [
    'The grid is 5 by 3 and deterministic. Actions are right, up, down, and left. A move off the grid is illegal.',
    'The start is the middle cell of the left column. The goal is the middle cell of the right column. The hole is the middle cell of the center column. The hole is walkable and does not end the episode. Entering the goal ends it.',
    'The reward of a move is paid on the cell you enter. It is a dot product of four features: closeness (minus the Manhattan distance to the goal), hole (1 only on the hole), lane (+1 on the north row, -1 on the south row, 0 in the middle), and step (1 off the goal).',
    'The soft policy is pi(a|s) proportional to exp(Q(s,a)), with discount 0.9 and temperature 1. Q comes from soft value iteration: the reward of the cell entered, plus 0.9 times the soft value of that cell, unless the cell is the goal.',
    'The fit maximizes the sum of log pi(a|s) over the demonstrated state-action pairs. That is the likelihood of those actions under the soft policy. It is not a sum of exp(reward) over whole trajectories. The search tries each weight on the lattice -4, -2, 0, 2, 4, then walks in steps of 1, 0.5, 0.25, and 0.1, and keeps every weight inside -4 to 4.',
    'The drawn route is a greedy plan on the same reward. Ties break in action order: right, then up, then down, then left. The planner does not read demonstration actions.',
    'The finite posterior uses a uniform prior over four candidates only: the hand-written proxy, the free fit, the fit with the hole weight locked at 0, and the fit with the lane weight locked at 0. It is not a posterior over every reward.',
    'Lecture 13 titles one method Inverse RL as a GAN. That heading is the adversarial version. This toy does not train a discriminator.',
  ];

  function study(demos) {
    const free = fitReward(demos, null);
    const holeLocked = fitReward(demos, { index: FEATURE.hole, value: 0 });
    const laneLocked = fitReward(demos, { index: FEATURE.lane, value: 0 });
    const rows = [
      pack('proxy', PROXY_WEIGHTS, demos, { story: 'Hand-written closeness only.' }),
      pack('free', free.weights, demos, { story: 'Free maximum of the demonstration likelihood.', evaluations: free.evaluations }),
      pack('hole-locked', holeLocked.weights, demos, { story: 'Hole weight locked at 0. The other weights are fit.', evaluations: holeLocked.evaluations }),
      pack('lane-locked', laneLocked.weights, demos, { story: 'Lane weight locked at 0. The other weights are fit.', evaluations: laneLocked.evaluations }),
    ];
    const posterior = finitePosterior(rows);
    const at = { x: 1, y: 1 };
    return {
      gamma: GAMMA,
      bound: BOUND,
      features: FEATURES.slice(),
      assumptions: ASSUMPTIONS.slice(),
      demoCount: demos.length,
      proxy: posterior[0],
      free: posterior[1],
      holeLocked: posterior[2],
      laneLocked: posterior[3],
      posterior,
      decision: {
        state: at,
        proxyQ: actionValues(PROXY_WEIGHTS, at.x, at.y),
        fittedQ: actionValues(free.weights, at.x, at.y),
      },
    };
  }

  const api = {
    WIDTH, HEIGHT, GAMMA, BOUND, FEATURES, FEATURE, ACTIONS, ACTION,
    START, GOAL, HOLE, PROXY_WEIGHTS, NORTH_DEMOS, SOUTH_DEMOS, ASSUMPTIONS,
    index, cell, follow, entersHole, reachesGoal, featuresOf: (x, y) => PHI[index(x, y)].slice(),
    actionLogLikelihood, actionValues, actionTable, plan, fitReward, study,
    cancel: () => {},
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (typeof window !== 'undefined' ? window : globalThis).BBREWARDFIT = api;
})();
