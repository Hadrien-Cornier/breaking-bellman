// Discounted successor features for one known deterministic table.
// Barreto et al., Successor Features for Transfer in Reinforcement Learning,
// arXiv:1606.05312, equation (2): r(s, a, s') = phi(s, a, s') dot w.
// Equation (3): Q^pi(s, a) = psi^pi(s, a) dot w, where psi is the expected
// discounted sum of phi under pi starting from (s, a).
// This file evaluates that sum on a finite table. It does not learn psi,
// and it does not run generalized policy improvement.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBSUCCESSOR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GAMMA = 0.5;
  const HORIZON = 8;
  const FEATURES = ['step', 'door'];
  const WEIGHTS = {
    base: { step: -2, door: 2 },
    tradeoff: { step: -1, door: 8 },
    proportional: { step: -4, door: 4 },
    toll: { step: -1, door: -8 },
  };

  function weightsOf(w) {
    if (!w || typeof w !== 'object') throw new Error('weights need step and door');
    if (!Number.isFinite(w.step) || !Number.isFinite(w.door)) throw new Error('weights must be finite');
    return { step: w.step, door: w.door };
  }

  function gammaOf(gamma) {
    if (gamma === undefined) return GAMMA;
    if (!Number.isFinite(gamma) || gamma < 0) throw new Error('gamma must be finite and at least 0');
    return gamma;
  }

  function horizonOf(horizon) {
    if (horizon === undefined) return HORIZON;
    if (!Number.isInteger(horizon) || horizon < 0) throw new Error('horizon must be an integer of at least 0');
    return horizon;
  }

  function dot(phi, w) {
    return phi[0] * w.step + phi[1] * w.door;
  }

  function legal(s) {
    if (s === 'S') return ['door', 'alley'];
    if (s === 'D') return ['take', 'skip'];
    if (s === 'B' || s === 'A' || s === 'M') return ['go'];
    if (s === 'G') return [];
    throw new Error('unknown state ' + s);
  }

  function dynamicsOf(name) {
    if (name !== 'open' && name !== 'locked') throw new Error('unknown dynamics ' + name);
    return name;
  }

  function policyOf(name) {
    if (name !== 'take' && name !== 'skip' && name !== 'alley') throw new Error('unknown policy ' + name);
    return name;
  }

  // The door action enters Door while the door is open, and Alley when it is locked.
  function nextOf(dynamics, s, a) {
    dynamicsOf(dynamics);
    if (legal(s).indexOf(a) < 0) throw new Error('illegal action ' + a + ' at ' + s);
    if (s === 'S' && a === 'door') return dynamics === 'open' ? 'D' : 'A';
    if (s === 'S' && a === 'alley') return 'A';
    if (s === 'D' && a === 'take') return 'B';
    if (s === 'D' && a === 'skip') return 'G';
    if (s === 'B' && a === 'go') return 'G';
    if (s === 'A' && a === 'go') return 'M';
    if (s === 'M' && a === 'go') return 'G';
    throw new Error('missing transition');
  }

  function policyAction(policy, s) {
    policyOf(policy);
    if (s === 'G') throw new Error('the goal has no action');
    if (s === 'S') return policy === 'alley' ? 'alley' : 'door';
    if (s === 'D') return policy === 'take' ? 'take' : 'skip';
    return 'go';
  }

  // Reward features live on the transition. Step is 1 on every move.
  // Door is 1 only on Door, take, Bonus.
  function defaultPhi(step) {
    const door = step.s === 'D' && step.a === 'take' && step.sp === 'B' ? 1 : 0;
    return [1, door];
  }

  function discount(gamma, t) {
    return Math.pow(gamma, t);
  }

  function walk(opts) {
    const o = opts || {};
    const dynamics = dynamicsOf(o.dynamics || 'open');
    const policy = policyOf(o.policy || 'take');
    const gamma = gammaOf(o.gamma);
    const horizon = horizonOf(o.horizon);
    const phiOf = o.phi || defaultPhi;
    const state = o.state || 'S';
    legal(state);
    const steps = [];
    let s = state;
    for (let t = 0; t < horizon; t++) {
      if (s === 'G') break;
      const a = t === 0 && o.firstAction ? o.firstAction : policyAction(policy, s);
      const sp = nextOf(dynamics, s, a);
      const phi = phiOf({ s: s, a: a, sp: sp, t: t, dynamics: dynamics }).slice();
      if (phi.length !== 2 || !Number.isFinite(phi[0]) || !Number.isFinite(phi[1])) throw new Error('phi must be finite step and door');
      const terminal = sp === 'G';
      steps.push({ t: t, s: s, a: a, sp: sp, phi: phi, terminal: terminal, discount: discount(gamma, t) });
      s = sp;
      if (terminal) break;
    }
    return {
      steps: steps,
      modelReads: steps.length,
      envInteractions: 0,
      gamma: gamma,
      horizon: horizon,
      dynamics: dynamics,
      policy: policy,
      state: state,
      firstAction: o.firstAction || null,
    };
  }

  function successorOf(walked) {
    const psi = [0, 0];
    walked.steps.forEach((step) => {
      psi[0] += step.discount * step.phi[0];
      psi[1] += step.discount * step.phi[1];
    });
    return psi;
  }

  function returnOf(steps, weights) {
    const w = weightsOf(weights);
    let total = 0;
    const rewards = steps.map((step) => {
      const r = dot(step.phi, w);
      const discounted = step.discount * r;
      total += discounted;
      return { t: step.t, r: r, discounted: discounted };
    });
    return { total: total, rewards: rewards, modelReads: 0, envInteractions: 0 };
  }

  function build(opts) {
    const o = opts || {};
    const weights = weightsOf(o.weights || WEIGHTS.base);
    const walked = walk(o);
    const psi = successorOf(walked);
    const direct = returnOf(walked.steps, weights);
    const q = dot(psi, weights);
    const first = walked.steps[0] || null;
    return {
      psi: psi,
      q: q,
      direct: direct.total,
      rewards: direct.rewards,
      match: q === direct.total,
      steps: walked.steps,
      modelReads: walked.modelReads,
      envInteractions: 0,
      gamma: walked.gamma,
      horizon: walked.horizon,
      dynamics: walked.dynamics,
      policy: walked.policy,
      state: walked.state,
      firstAction: walked.firstAction,
      weights: weights,
      conditionedOn: {
        state: walked.state,
        action: first ? first.a : null,
        policy: walked.policy,
      },
      method: 'expectation from the known transition table',
      learned: false,
    };
  }

  function rescale(oldQ, oldWeights, newWeights, key) {
    const oldW = weightsOf(oldWeights);
    const newW = weightsOf(newWeights);
    if (key !== 'step' && key !== 'door') throw new Error('unknown scale key ' + key);
    if (oldW[key] === 0) return { defined: false, key: key, reason: 'the old ' + key + ' weight is 0' };
    const factor = newW[key] / oldW[key];
    return { defined: true, key: key, factor: factor, q: factor * oldQ };
  }

  // New weights on a psi that was already built. No transition is read again.
  function transfer(stored, weights) {
    if (!stored || !stored.psi || !stored.steps) throw new Error('transfer needs a built successor');
    const w = weightsOf(weights);
    const q = dot(stored.psi, w);
    const direct = returnOf(stored.steps, w);
    return {
      mode: 'weights',
      q: q,
      direct: direct.total,
      rewards: direct.rewards,
      match: q === direct.total,
      psi: stored.psi.slice(),
      steps: stored.steps,
      doorScale: rescale(stored.q, stored.weights, w, 'door'),
      stepScale: rescale(stored.q, stored.weights, w, 'step'),
      newModelReads: 0,
      newEnvInteractions: 0,
      originalModelReads: stored.modelReads,
      originalEnvInteractions: stored.envInteractions,
      weights: w,
      storedWeights: stored.weights,
      gamma: stored.gamma,
      policy: stored.policy,
      dynamics: stored.dynamics,
      horizon: stored.horizon,
      state: stored.state,
    };
  }

  function sameRepresentation(stored, spec) {
    return stored.policy === (spec.policy || stored.policy)
      && stored.dynamics === (spec.dynamics || stored.dynamics)
      && stored.gamma === gammaOf(spec.gamma === undefined ? stored.gamma : spec.gamma)
      && stored.horizon === horizonOf(spec.horizon === undefined ? stored.horizon : spec.horizon)
      && stored.state === (spec.state || stored.state)
      && (stored.firstAction || null) === (spec.firstAction || null)
      && !spec.phi;
  }

  // Weight edits reuse psi. A new policy, dynamics, discount, horizon, state, or feature map rebuilds it.
  function apply(stored, spec) {
    const o = spec || {};
    const w = weightsOf(o.weights || stored.weights);
    if (sameRepresentation(stored, o)) return transfer(stored, w);
    const fresh = build(Object.assign({}, o, { weights: w }));
    const staleQ = dot(stored.psi, w);
    return {
      mode: 'rebuild',
      q: fresh.q,
      direct: fresh.direct,
      rewards: fresh.rewards,
      match: fresh.match,
      psi: fresh.psi,
      steps: fresh.steps,
      staleQ: staleQ,
      staleMatch: staleQ === fresh.direct,
      newModelReads: fresh.modelReads,
      newEnvInteractions: 0,
      originalModelReads: stored.modelReads,
      originalEnvInteractions: stored.envInteractions,
      weights: w,
      gamma: fresh.gamma,
      policy: fresh.policy,
      dynamics: fresh.dynamics,
      horizon: fresh.horizon,
      state: fresh.state,
      modelReads: fresh.modelReads,
      envInteractions: 0,
      conditionedOn: fresh.conditionedOn,
    };
  }

  // Ranks three stored policies. This is not equation (7) of Barreto et al.
  function comparePolicies(opts) {
    const o = opts || {};
    const names = ['take', 'skip', 'alley'];
    const runs = {};
    let reads = 0;
    names.forEach((name) => {
      runs[name] = build(Object.assign({}, o, { policy: name }));
      reads += runs[name].modelReads;
    });
    let best = names[0];
    names.forEach((name) => { if (runs[name].q > runs[best].q) best = name; });
    return {
      runs: runs,
      best: best,
      modelReads: reads,
      envInteractions: 0,
      gpi: false,
    };
  }

  return {
    GAMMA: GAMMA,
    HORIZON: HORIZON,
    FEATURES: FEATURES,
    WEIGHTS: WEIGHTS,
    weightsOf: weightsOf,
    dot: dot,
    legal: legal,
    nextOf: nextOf,
    policyAction: policyAction,
    defaultPhi: defaultPhi,
    walk: walk,
    build: build,
    transfer: transfer,
    apply: apply,
    rescale: rescale,
    comparePolicies: comparePolicies,
  };
});
