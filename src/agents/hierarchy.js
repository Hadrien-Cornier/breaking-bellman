// Finite option: a goal-conditioned table trained on one doorway, then called again.
// The high-level subgoal list is given. Only the low-level table is updated from transitions.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBHIERARCHY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GAMMA = 0.5;
  const ALPHA = 1;
  const INIT = 0;
  const ACTIONS = ['L', 'R'];
  const BEHAVIOR = ['R', 'R', 'L'];
  const CELLS = 6;
  const DOOR = 2;
  const PRIZE = 4;
  const FAR = 5;
  const PIT = -1;
  const CAP = 8;
  const MAX_OPTION = 8;
  const BUDGET = 6;

  function lesson(over) {
    const base = {
      dynamics: 'repeat',
      representation: 'relative',
      budget: BUDGET,
      subgoals: [DOOR, PRIZE],
      phase: 0,
      pretrain: 0,
      cap: CAP,
      maxOption: MAX_OPTION,
    };
    const o = Object.assign({}, base, over || {});
    o.subgoals = (over && over.subgoals ? over.subgoals : base.subgoals).slice();
    return o;
  }

  function qGet(q, key) {
    return Object.prototype.hasOwnProperty.call(q, key) ? q[key] : INIT;
  }

  function keyOf(rep, pos, goal) {
    if (rep === 'relative') return String(goal - pos);
    if (rep === 'absolute') return pos + '@' + goal;
    throw new Error('unknown representation ' + rep);
  }

  function greedy(q, key) {
    let best = ACTIONS[0];
    let bestV = qGet(q, key + '|' + ACTIONS[0]);
    for (let i = 1; i < ACTIONS.length; i++) {
      const v = qGet(q, key + '|' + ACTIONS[i]);
      if (v > bestV) { best = ACTIONS[i]; bestV = v; }
    }
    return best;
  }

  function step(dynamics, pos, action) {
    if (ACTIONS.indexOf(action) < 0) throw new Error('illegal action ' + action);
    if (dynamics !== 'repeat' && dynamics !== 'pit') throw new Error('unknown dynamics ' + dynamics);
    if (pos === PIT) return PIT;
    if (dynamics === 'pit' && pos === 3 && action === 'R') return PIT;
    if (action === 'L') return Math.max(0, pos - 1);
    return Math.min(CELLS - 1, pos + 1);
  }

  function behaviorAction(index, phase) {
    return BEHAVIOR[(index + phase) % BEHAVIOR.length];
  }

  // Environment interaction only. The action comes from the fixed pattern, never from Q.
  function interact(opts) {
    const goal = opts.goal;
    const budget = opts.budget;
    const dynamics = opts.dynamics;
    const rep = opts.representation;
    const phase = opts.phase || 0;
    const cap = opts.cap;
    const shaping = !!opts.shaping;
    const moves = [];
    const log = [];
    let pos = 0;
    let steps = 0;
    let resets = 0;
    let ep = 0;
    while (steps + resets < budget) {
      if (pos === goal || pos === PIT || ep >= cap) {
        resets += 1;
        log.push({ kind: 'reset', from: pos, to: 0 });
        pos = 0;
        ep = 0;
        if (steps + resets >= budget) break;
        continue;
      }
      const action = behaviorAction(steps, phase);
      const next = step(dynamics, pos, action);
      const reached = next === goal;
      let doorBonus = 0;
      if (shaping && next === DOOR && pos !== DOOR) doorBonus = 1;
      const reward = (reached ? 1 : 0) + doorBonus;
      const terminal = reached || next === PIT;
      const sKey = keyOf(rep, pos, goal);
      const spKey = keyOf(rep, next, goal);
      const move = {
        kind: 'move', pos: pos, action: action, next: next, goal: goal,
        reached: reached, reward: reward, doorBonus: doorBonus, terminal: terminal,
        key: sKey, spKey: spKey, behavior: true,
      };
      moves.push(move);
      log.push(move);
      steps += 1;
      ep += 1;
      pos = next;
    }
    return { moves: moves, log: log, steps: steps, resets: resets, interactions: steps + resets, goal: goal, shaping: shaping };
  }

  function fold(moves, qInit) {
    const q = Object.assign({}, qInit || {});
    let updates = 0;
    moves.forEach((move) => {
      const id = move.key + '|' + move.action;
      const prev = qGet(q, id);
      const cont = move.terminal ? 0 : GAMMA * Math.max(qGet(q, move.spKey + '|L'), qGet(q, move.spKey + '|R'));
      const target = move.reward + cont;
      q[id] = prev + ALPHA * (target - prev);
      move.prev = prev;
      move.target = target;
      move.value = q[id];
      updates += 1;
    });
    return { q: q, updates: updates };
  }

  function learn(opts, qInit) {
    const rolled = interact(opts);
    const folded = fold(rolled.moves, qInit);
    return {
      q: folded.q,
      updates: folded.updates,
      moves: rolled.moves,
      log: rolled.log,
      steps: rolled.steps,
      resets: rolled.resets,
      interactions: rolled.interactions,
      goal: rolled.goal,
      shaping: rolled.shaping,
    };
  }

  function execute(q, opts) {
    const dynamics = opts.dynamics;
    const rep = opts.representation;
    const maxOption = opts.maxOption;
    const options = [];
    const moves = [];
    let pos = 0;
    let primitive = 0;
    opts.subgoals.forEach((goal) => {
      const atPrimitive = primitive;
      const optionMoves = [];
      let steps = 0;
      while (steps < maxOption && pos !== goal && pos !== PIT) {
        const sKey = keyOf(rep, pos, goal);
        const action = greedy(q, sKey);
        const next = step(dynamics, pos, action);
        const reached = next === goal;
        const move = {
          kind: 'move', pos: pos, action: action, next: next, goal: goal,
          reached: reached, reward: reached ? 1 : 0, doorBonus: 0,
          terminal: reached || next === PIT, key: sKey, spKey: keyOf(rep, next, goal),
          behavior: false,
        };
        optionMoves.push(move);
        moves.push(move);
        pos = next;
        steps += 1;
        primitive += 1;
      }
      options.push({
        goal: goal,
        atPrimitive: atPrimitive,
        steps: steps,
        reached: pos === goal,
        terminated: pos === goal,
        truncated: pos !== goal && pos !== PIT,
        fell: pos === PIT,
        final: pos,
        moves: optionMoves,
      });
    });
    const calls = options.length;
    return {
      options: options,
      moves: moves,
      primitive: primitive,
      calls: calls,
      H: primitive + calls,
      reachedPrize: opts.subgoals.length > 1 && options[options.length - 1].reached && options[options.length - 1].goal === opts.subgoals[opts.subgoals.length - 1],
      final: pos,
      updates: 0,
    };
  }

  function greedyRollout(q, opts, goal) {
    const dynamics = opts.dynamics;
    const rep = opts.representation;
    const moves = [];
    let pos = 0;
    while (moves.length < opts.maxOption && pos !== goal && pos !== PIT) {
      const sKey = keyOf(rep, pos, goal);
      const action = greedy(q, sKey);
      const next = step(dynamics, pos, action);
      moves.push({ pos: pos, action: action, next: next, goal: goal, reached: next === goal });
      pos = next;
    }
    return { moves: moves, steps: moves.length, reached: pos === goal, final: pos };
  }

  function trainPair(opts, budget, goal) {
    const plain = learn(Object.assign({}, opts, { budget: budget, goal: goal, shaping: false }), {});
    const shaped = learn(Object.assign({}, opts, { budget: budget, goal: goal, shaping: true }), {});
    return { plain: plain, shaped: shaped };
  }

  function compare(over) {
    const opts = lesson(over);
    let extraRun = null;
    let q = {};
    if (opts.pretrain > 0) {
      extraRun = learn(Object.assign({}, opts, { budget: opts.pretrain, goal: opts.subgoals[0], shaping: false }), {});
      q = extraRun.q;
    }
    const skill = learn(Object.assign({}, opts, { budget: opts.budget, goal: opts.subgoals[0], shaping: false }), q);
    const execution = execute(skill.q, opts);
    const S = skill.interactions;
    const H = execution.H;
    const flatGoal = opts.subgoals[opts.subgoals.length - 1];
    const flats = trainPair(opts, S + H, flatGoal);
    const flat = flats.plain;
    const shaped = flats.shaped;
    const flatGreedy = greedyRollout(flat.q, opts, flatGoal);
    const shapedGreedy = greedyRollout(shaped.q, opts, flatGoal);
    const none = execute({}, opts);
    const wiped = execute({}, opts);
    const goalEntries = (run) => run.moves.filter((m) => m.reached).length;
    return {
      opts: opts,
      gamma: GAMMA,
      alpha: ALPHA,
      init: INIT,
      behavior: BEHAVIOR.slice(),
      dynamics: opts.dynamics,
      representation: opts.representation,
      highLevel: { learned: false, source: 'given', subgoals: opts.subgoals.slice(), updates: 0 },
      skill: skill,
      execution: execution,
      S: S,
      H: H,
      total: S + H,
      extra: extraRun ? extraRun.interactions : 0,
      extraRun: extraRun,
      flat: {
        steps: flat.steps,
        resets: flat.resets,
        interactions: flat.interactions,
        updates: flat.updates,
        moves: flat.moves,
        log: flat.log,
        q: flat.q,
        goal: flat.goal,
        goalEntries: goalEntries(flat),
        greedy: flatGreedy,
        evalSteps: flatGreedy.steps,
      },
      shaped: {
        steps: shaped.steps,
        resets: shaped.resets,
        interactions: shaped.interactions,
        updates: shaped.updates,
        moves: shaped.moves,
        q: shaped.q,
        goal: shaped.goal,
        goalEntries: goalEntries(shaped),
        greedy: shapedGreedy,
        evalSteps: shapedGreedy.steps,
      },
      none: none,
      wiped: wiped,
      assumptions: {
        relative: opts.representation === 'relative',
        deterministic: true,
        repeatedDynamics: opts.dynamics === 'repeat',
        highLevelGiven: true,
        behaviorIgnoresTable: true,
      },
    };
  }

  return {
    GAMMA: GAMMA,
    ALPHA: ALPHA,
    INIT: INIT,
    ACTIONS: ACTIONS,
    BEHAVIOR: BEHAVIOR,
    CELLS: CELLS,
    DOOR: DOOR,
    PRIZE: PRIZE,
    FAR: FAR,
    PIT: PIT,
    BUDGET: BUDGET,
    lesson: lesson,
    step: step,
    greedy: greedy,
    keyOf: keyOf,
    behaviorAction: behaviorAction,
    interact: interact,
    fold: fold,
    learn: learn,
    execute: execute,
    greedyRollout: greedyRollout,
    compare: compare,
  };
});
