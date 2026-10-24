// Tabular goal-conditioned Q-learning with one hindsight replay rule.
// The behavior episodes are fixed data. The policy is the strict argmax of the updated table.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBHINDSIGHT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GAMMA = 0.5;
  const ALPHA = 1;
  const INIT = -1 / (1 - GAMMA); // -2: fail forever under this discount
  const LEGAL = { S: ['stay', 'go'], M: ['L', 'R'], W: [], E: [] };
  const NEXT = { 'S|stay': 'S', 'S|go': 'M', 'M|L': 'W', 'M|R': 'E' };
  const HELD = ['W', 'E'];

  function legal(s) { return LEGAL[s] ? LEGAL[s].slice() : []; }
  function move(s, a) { return NEXT[s + '|' + a]; }

  // Section 4.1 binary reward, evaluated on the next state: 0 if it is the goal, -1 otherwise.
  // Reaching the goal ends the episode. A time limit that misses the goal is truncation, so the
  // backup may continue. The 2017 experiments used a fixed horizon; this split is the toy's.
  function outcome(sp, g, last) {
    const reached = sp === g;
    if (reached) return { reward: 0, terminated: true, truncated: false };
    return { reward: -1, terminated: false, truncated: !!last };
  }

  function transition(s, a, g, last) {
    const sp = move(s, a);
    return Object.assign({ s: s, a: a, sp: sp, g: g, last: !!last }, outcome(sp, g, last));
  }

  // Two scripted episodes. The commanded goal is Far, which these actions never reach.
  // This is the training data, not a learned policy.
  function episodes() {
    return [
      { id: 1, commanded: 'F', achieved: 'W', transitions: [transition('S', 'go', 'F', false), transition('M', 'L', 'F', true)] },
      { id: 2, commanded: 'F', achieved: 'E', transitions: [transition('S', 'go', 'F', false), transition('M', 'R', 'F', true)] },
    ];
  }

  function clone(tr, extra) { return Object.assign({}, tr, extra); }

  // Final-state strategy: the added goal is the last state of that same episode.
  // recompute true writes r(s, a, g') for the new goal. False keeps the commanded tuple's reward and flags.
  function relabel(eps, recompute) {
    const out = [];
    eps.forEach((ep) => {
      ep.transitions.forEach((tr) => {
        const flags = recompute ? outcome(tr.sp, ep.achieved, tr.last) : { reward: tr.reward, terminated: tr.terminated, truncated: tr.truncated };
        out.push(clone(tr, { g: ep.achieved, originalGoal: tr.g, relabeled: true, reward: flags.reward, terminated: flags.terminated, truncated: flags.truncated }));
      });
    });
    return out;
  }

  function flatten(eps) { return eps.reduce((all, ep) => all.concat(ep.transitions.map((tr) => clone(tr))), []); }

  function qLearn(transitions, opts) {
    const gamma = opts.gamma;
    const alpha = opts.alpha;
    const init = opts.init;
    const sweeps = opts.sweeps;
    const conditionOnGoal = opts.conditionOnGoal !== false;
    const Q = new Map();
    const key = (s, a, g) => conditionOnGoal ? s + '|' + a + '|' + g : s + '|' + a + '|';
    const get = (k) => Q.has(k) ? Q.get(k) : init;
    let updates = 0;
    for (let sweep = 0; sweep < sweeps; sweep++) {
      transitions.forEach((tr) => {
        const k = key(tr.s, tr.a, tr.g);
        let continuation = 0;
        if (!tr.terminated) {
          const actions = legal(tr.sp);
          const best = actions.length ? Math.max.apply(null, actions.map((a) => get(key(tr.sp, a, tr.g)))) : init;
          continuation = gamma * best;
        }
        const target = tr.reward + continuation;
        Q.set(k, get(k) + alpha * (target - get(k)));
        updates += 1;
      });
    }
    return { Q: Q, updates: updates, key: key, get: get, conditionOnGoal: conditionOnGoal, init: init };
  }

  function greedy(learned, s, g) {
    const actions = legal(s);
    if (!actions.length) return null;
    const scored = actions.map((a) => ({ a: a, q: learned.get(learned.key(s, a, g)) }));
    const best = Math.max.apply(null, scored.map((x) => x.q));
    const winners = scored.filter((x) => x.q === best);
    return winners.length === 1 ? winners[0].a : null;
  }

  function rollout(learned, g) {
    let s = 'S';
    const path = [s];
    const actions = [];
    for (let t = 0; t < 2; t++) {
      const a = greedy(learned, s, g);
      if (!a) return { success: false, path: path, actions: actions, stopped: s, reason: 'tie' };
      const sp = move(s, a);
      actions.push(a);
      s = sp;
      path.push(s);
      if (s === g) return { success: true, path: path, actions: actions, stopped: s, reason: 'reached' };
    }
    return { success: false, path: path, actions: actions, stopped: s, reason: 'miss' };
  }

  function plainQ(learned) {
    const out = {};
    learned.Q.forEach((v, k) => { out[k] = v; });
    return out;
  }

  function train(transitions, opts) {
    const learned = qLearn(transitions, {
      gamma: GAMMA, alpha: ALPHA, init: INIT,
      sweeps: opts.sweeps, conditionOnGoal: opts.conditionOnGoal,
    });
    const success = {};
    const rolls = {};
    ['W', 'E', 'F'].forEach((g) => { rolls[g] = rollout(learned, g); success[g] = rolls[g].success; });
    const policy = {};
    ['S', 'M'].forEach((s) => {
      policy[s] = {};
      ['W', 'E', 'F'].forEach((g) => { policy[s][g] = greedy(learned, s, g); });
    });
    const heldout = HELD.filter((g) => success[g]).length;
    return {
      updates: learned.updates,
      sweeps: opts.sweeps,
      conditionOnGoal: opts.conditionOnGoal !== false,
      Q: plainQ(learned),
      success: success,
      rolls: rolls,
      policy: policy,
      heldout: heldout,
      far: success.F,
    };
  }

  function compare(over) {
    const sweeps = over && over.sweeps != null ? over.sweeps : 2;
    if (![1, 2].includes(sweeps)) throw new Error('Expected one or two replay sweeps');
    const eps = episodes();
    const original = flatten(eps);
    const rewritten = relabel(eps, true);
    const stale = relabel(eps, false);
    const both = original.concat(rewritten);
    return {
      gamma: GAMMA,
      alpha: ALPHA,
      init: INIT,
      envSteps: original.length,
      commanded: 'F',
      heldoutGoals: HELD.slice(),
      episodes: eps,
      original: original,
      rewritten: rewritten,
      stale: stale,
      modes: {
        original: train(original, { sweeps: sweeps, conditionOnGoal: true }),
        stale: train(stale, { sweeps: sweeps, conditionOnGoal: true }),
        blind: train(rewritten, { sweeps: sweeps, conditionOnGoal: false }),
        once: train(both, { sweeps: 1, conditionOnGoal: true }),
        hindsight: train(both, { sweeps: sweeps, conditionOnGoal: true }),
      },
    };
  }

  return {
    GAMMA: GAMMA, ALPHA: ALPHA, INIT: INIT, LEGAL: LEGAL,
    legal: legal, move: move, outcome: outcome, episodes: episodes, relabel: relabel,
    qLearn: qLearn, greedy: greedy, rollout: rollout, train: train, compare: compare,
  };
});
