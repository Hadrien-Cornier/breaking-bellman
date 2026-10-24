// Tabular visit-count bonus on a deterministic hallway.
// Exact n(s) is a table. It is not a density-model pseudo-count.
// This file does not participate in RLA.run or Fast results.
(function () {
  'use strict';
  const rngApi = typeof module === 'object' && module.exports ? require('../core/rng.js') : globalThis.RLA.rng;

  const PROTOCOL = {
    seed: 19,
    steps: 80,
    eps: 0.05,
    alpha: 0.5,
    gamma: 0.95,
    door: 6,
    actions: ['left', 'right', 'open'],
  };
  const LESSON_SEEDS = [1, 7, 13, 19, 23];
  const STRESS = { eps: 0.2, steps: 28, seeds: [1, 2, 3, 4, 5, 6, 7, 8] };
  const CELL_LABELS = ['Start', '1', '2', '3', '4', '5', 'Door', 'Gem'];
  const ASSUMPTIONS = [
    'The hallway is deterministic. Cells are Start, 1, 2, 3, 4, 5, Door, then Gem.',
    'Left, right, and open have fixed successors. The learner uses that map. It learns the reward only from steps it takes.',
    'Q-learning starts at 0. Alpha is 0.5. Gamma is 0.95. Epsilon is 0.05. Equal scores pick the lowest action index, which is left.',
    'The plain run and the backup run each take 80 environment steps. Each step draws the same two random numbers from the seed: one for epsilon, one for a random action.',
    'The environment reward is 1 only when Open is taken at the door. Every other step pays 0. Gem then returns to Start. The logged environment reward is that 0 or 1. It does not include 1/sqrt(n).',
    'Until an action has been taken, action choice and the bootstrap treat it as worth 1/(1 - gamma). At gamma 0.95 that value is 20. After the action is taken, the score is Q.',
    'The repair adds 1/sqrt(n(s\')) inside the TD target, then bootstraps. That writes the count bonus into Q so an earlier cell can learn it.',
    'A different run adds 1/sqrt(n(s\')) only to the action score and trains Q on the environment reward alone. On this short hall that side score can still reach the door, while Q(start, right) stays 0 until the environment reward arrives. That run is not the repair.',
    'n(s) is an integer visit count. A pseudo-count, as in the lecture 19 heading Exploring with pseudo-counts, is a stand-in from a density model. This lesson does not fit one.',
    'The known map, the untried-action value, and this eight-cell hall are toy choices. They are not a result about Atari or Montezuma\'s Revenge.',
  ];

  function succ(s, action, door) {
    const gem = door + 1;
    if (s === gem) return 0;
    if (action === 0) return Math.max(0, s - 1);
    if (action === 1) return Math.min(door, s + 1);
    if (s === door) return gem;
    return s;
  }

  function run(options) {
    const p = Object.assign({ place: 'off', reward: 'env' }, PROTOCOL, options || {});
    const door = p.door;
    const nStates = door + 2;
    const nActions = 3;
    const Q = Array.from({ length: nStates }, () => [0, 0, 0]);
    const nsa = Array.from({ length: nStates }, () => [0, 0, 0]);
    const counts = Array(nStates).fill(0);
    const rng = rngApi.make(p.seed);
    const trace = [];
    const random = [];
    const Vopt = 1 / (1 - p.gamma);
    const optimisticPlace = p.place === 'backup' || p.place === 'optimism';
    let s = 0;
    counts[0] = 1;
    let openings = 0;
    let crossings = 0;
    let firstOpen = null;
    let envSum = 0;
    let visitBonusSum = 0;
    let qRightBeforeReward = 0;
    function optimisticMax(state) {
      let mx = Q[state][0];
      if (nsa[state][0] === 0) mx = Vopt;
      for (let i = 1; i < nActions; i++) {
        const q = nsa[state][i] === 0 ? Vopt : Q[state][i];
        if (q > mx) mx = q;
      }
      return mx;
    }
    function actionScore(state, action) {
      if (p.place === 'local') {
        const next = succ(state, action, door);
        if (counts[next] <= 0) return Number.POSITIVE_INFINITY;
        return Q[state][action] + 1 / Math.sqrt(counts[next]);
      }
      if (optimisticPlace && nsa[state][action] === 0) return Vopt;
      return Q[state][action];
    }
    for (let t = 0; t < p.steps; t++) {
      const u = rng.next();
      const j = rng.int(nActions);
      random.push({ u, j });
      let a = 0;
      let best = actionScore(s, 0);
      for (let i = 1; i < nActions; i++) {
        const score = actionScore(s, i);
        if (score > best) { best = score; a = i; }
      }
      const explored = u < p.eps;
      if (explored) a = j;
      const qBefore = Q[s][a];
      const takenScore = actionScore(s, a);
      const s2 = succ(s, a, door);
      const crossed = s === door && a === 2;
      const env = p.reward === 'none' ? 0 : (crossed ? 1 : 0);
      counts[s2] += 1;
      nsa[s][a] += 1;
      const visitBonus = 1 / Math.sqrt(counts[s2]);
      const intrinsic = p.place === 'backup' || p.place === 'target' ? visitBonus : 0;
      let mx = Q[s2][0];
      for (let i = 1; i < nActions; i++) if (Q[s2][i] > mx) mx = Q[s2][i];
      if (optimisticPlace) mx = optimisticMax(s2);
      Q[s][a] += p.alpha * (env + intrinsic + p.gamma * mx - Q[s][a]);
      const qAfter = Q[s][a];
      if (env === 0 && openings === 0) qRightBeforeReward = Q[0][1];
      envSum += env;
      visitBonusSum += visitBonus;
      if (crossed) crossings += 1;
      if (env > 0) {
        openings += 1;
        if (firstOpen == null) firstOpen = t;
      }
      trace.push({
        t, s, a, s2, env, explored,
        nAfter: counts[s2],
        visitBonus,
        intrinsic,
        qBefore,
        qAfter,
        bootstrap: mx,
        actionScore: takenScore,
      });
      s = s2;
    }
    const playback = greedy(Q, door);
    let farthest = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) farthest = i;
    return {
      place: p.place,
      reward: p.reward,
      seed: p.seed,
      steps: p.steps,
      eps: p.eps,
      alpha: p.alpha,
      gamma: p.gamma,
      door,
      openings,
      crossings,
      firstOpen,
      envSum,
      discoveredReward: envSum,
      visitBonusSum,
      qRightBeforeReward,
      counts: counts.slice(),
      farthest,
      covered: counts.filter((n) => n > 0).length,
      trace,
      random,
      greedyOpens: playback.opens,
      greedyActions: playback.actions,
      qDoor: Q[door].slice(),
    };
  }

  function greedy(Q, door) {
    let s = 0;
    const actions = [];
    for (let t = 0; t < door + 4; t++) {
      let a = 0;
      for (let i = 1; i < 3; i++) if (Q[s][i] > Q[s][a]) a = i;
      actions.push(a);
      if (s === door && a === 2) return { opens: true, actions };
      const s2 = succ(s, a, door);
      if (s2 === s) return { opens: false, actions };
      s = s2;
    }
    return { opens: false, actions };
  }

  function compare(seed) {
    const chosen = seed == null ? PROTOCOL.seed : seed;
    const base = { seed: chosen, steps: PROTOCOL.steps, eps: PROTOCOL.eps };
    return {
      seed: chosen,
      protocol: Object.assign({}, PROTOCOL, { seed: chosen }),
      off: run(Object.assign({ place: 'off' }, base)),
      local: run(Object.assign({ place: 'local' }, base)),
      targetOnly: run(Object.assign({ place: 'target' }, base)),
      optimism: run(Object.assign({ place: 'optimism' }, base)),
      on: run(Object.assign({ place: 'backup' }, base)),
      withheld: run(Object.assign({ place: 'backup', reward: 'none' }, base)),
      assumptions: ASSUMPTIONS.slice(),
    };
  }

  function row(seed, extra) {
    const off = run(Object.assign({ seed, place: 'off' }, extra));
    const on = run(Object.assign({ seed, place: 'backup' }, extra));
    let sameDraws = off.random.length === on.random.length;
    for (let i = 0; sameDraws && i < off.random.length; i++) {
      sameDraws = off.random[i].u === on.random[i].u && off.random[i].j === on.random[i].j;
    }
    return {
      seed,
      steps: off.steps,
      eps: off.eps,
      offOpenings: off.openings,
      onOpenings: on.openings,
      offFarthest: off.farthest,
      onFarthest: on.farthest,
      offDiscovered: off.discoveredReward,
      onDiscovered: on.discoveredReward,
      sameDraws,
    };
  }

  function sensitivity() {
    return {
      lesson: LESSON_SEEDS.map((seed) => row(seed, { steps: PROTOCOL.steps, eps: PROTOCOL.eps })),
      stress: STRESS.seeds.map((seed) => row(seed, { steps: STRESS.steps, eps: STRESS.eps })),
      stressProtocol: { eps: STRESS.eps, steps: STRESS.steps, seeds: STRESS.seeds.slice() },
    };
  }

  const api = {
    PROTOCOL, LESSON_SEEDS, STRESS, CELL_LABELS, ASSUMPTIONS,
    succ, run, compare, sensitivity,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBRARE = api;
})();
