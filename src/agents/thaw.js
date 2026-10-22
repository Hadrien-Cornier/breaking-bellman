// One-joint reacher for a short offline-to-online comparison.
// A linear controller writes a frozen dataset at inertia 1. The scored arm has inertia 2.
// Learners never read that controller except through the recorded actions.
// The online step is a centered finite difference of the measured return, then a fixed-length step.
// It is not IDQL, FQL, SAC, or the OGBench project.
(function () {
  'use strict';
  const assumptions = Object.freeze({
    seed: 11,
    seedAffectsSampling: false,
    dt: 0.1,
    horizon: 50,
    damp: 0.02,
    target: 1,
    torqueLimit: 1,
    inertiaOld: 1,
    inertiaNew: 2,
    collector: Object.freeze([0.9, -0.45]),
    updates: 5,
    longUpdates: 20,
    probe: 0.05,
    stepLength: 0.3,
    probesPerUpdate: 4,
    objective: 'Undiscounted sum of -(angle - target)^2. Higher is better.',
    update: 'Centered finite difference of that return on the two policy weights, then a step of fixed length along the slope.',
  });

  function clip(u) {
    const limit = assumptions.torqueLimit;
    return Math.max(-limit, Math.min(limit, u));
  }

  function meanTorque(weights, state) {
    return weights[0] * (assumptions.target - state.th) + weights[1] * state.w;
  }

  function stepDynamics(state, command, inertia) {
    const torque = clip(command);
    const w = state.w + assumptions.dt * (torque / inertia - assumptions.damp * state.w);
    const th = state.th + assumptions.dt * w;
    return { th: th, w: w, torque: torque, reward: -((th - assumptions.target) ** 2) };
  }

  function rollout(weights, inertia) {
    let state = { th: 0, w: 0 };
    let totalReward = 0;
    const trace = [];
    const transitions = [];
    for (let t = 0; t < assumptions.horizon; t++) {
      const before = { th: state.th, w: state.w };
      const command = meanTorque(weights, before);
      const next = stepDynamics(before, command, inertia);
      trace.push(next.th);
      transitions.push({
        th: before.th,
        w: before.w,
        action: next.torque,
        thNext: next.th,
        wNext: next.w,
        reward: next.reward,
      });
      totalReward += next.reward;
      state = { th: next.th, w: next.w };
    }
    return {
      weights: weights.slice(),
      inertia: inertia,
      totalReward: totalReward,
      terminalError: Math.abs(state.th - assumptions.target),
      endAngle: state.th,
      trace: trace,
      transitions: transitions,
    };
  }

  function solve(matrix, target) {
    const n = target.length;
    const rows = matrix.map((row, i) => row.concat(target[i]));
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
      const swap = rows[col];
      rows[col] = rows[pivot];
      rows[pivot] = swap;
      const scale = rows[col][col];
      if (Math.abs(scale) < 1e-12) throw new Error('The frozen fit is singular.');
      for (let c = col; c <= n; c++) rows[col][c] /= scale;
      for (let row = 0; row < n; row++) if (row !== col) {
        const factor = rows[row][col];
        for (let c = col; c <= n; c++) rows[row][c] -= factor * rows[col][c];
      }
    }
    return rows.map((row) => row[n]);
  }

  function leastSquares(samples, width) {
    const gram = Array.from({ length: width }, () => Array(width).fill(0));
    const rhs = Array(width).fill(0);
    for (const sample of samples) {
      for (let i = 0; i < width; i++) {
        rhs[i] += sample.x[i] * sample.y;
        for (let j = 0; j < width; j++) gram[i][j] += sample.x[i] * sample.x[j];
      }
    }
    return solve(gram, rhs);
  }

  function collectFrozen() {
    const transitions = [];
    let state = { th: 0, w: 0 };
    for (let t = 0; t < assumptions.horizon; t++) {
      const before = { th: state.th, w: state.w };
      const command = meanTorque(assumptions.collector, before);
      const next = stepDynamics(before, command, assumptions.inertiaOld);
      transitions.push({
        th: before.th,
        w: before.w,
        action: next.torque,
        thNext: next.th,
        wNext: next.w,
        reward: next.reward,
      });
      state = { th: next.th, w: next.w };
    }
    let ahead = 0;
    for (let t = transitions.length - 1; t >= 0; t--) {
      ahead += transitions[t].reward;
      transitions[t].returnToGo = ahead;
    }
    return { transitions: transitions, inertia: assumptions.inertiaOld, steps: transitions.length };
  }

  function fitPolicy(transitions) {
    const weights = leastSquares(transitions.map((row) => ({
      x: [assumptions.target - row.th, row.w],
      y: row.action,
    })), 2);
    return { weights: weights, samples: transitions.length, usedForAction: true };
  }

  function fitModel(transitions) {
    const weights = leastSquares(transitions.map((row) => ({
      x: [1, row.w, row.action],
      y: (row.wNext - row.w) / assumptions.dt,
    })), 3);
    return {
      weights: weights,
      samples: transitions.length,
      torqueCoefficient: weights[2],
      usedForAction: false,
    };
  }

  function fitValue(transitions) {
    const weights = leastSquares(transitions.map((row) => ({
      x: [1, assumptions.target - row.th, row.w],
      y: row.returnToGo,
    })), 3);
    return { weights: weights, samples: transitions.length, usedForAction: false };
  }

  function evaluate(weights, inertia) {
    const roll = rollout(weights, inertia);
    return {
      weights: roll.weights,
      inertia: roll.inertia,
      totalReward: roll.totalReward,
      terminalError: roll.terminalError,
      endAngle: roll.endAngle,
      trace: roll.trace,
    };
  }

  function descend(weights, inertia) {
    const gradient = [0, 0];
    const transitions = [];
    for (let i = 0; i < 2; i++) {
      const up = weights.slice();
      const down = weights.slice();
      up[i] += assumptions.probe;
      down[i] -= assumptions.probe;
      const upRoll = rollout(up, inertia);
      const downRoll = rollout(down, inertia);
      transitions.push(...upRoll.transitions, ...downRoll.transitions);
      gradient[i] = (upRoll.totalReward - downRoll.totalReward) / (2 * assumptions.probe);
    }
    const norm = Math.hypot(gradient[0], gradient[1]) || 1;
    return {
      weights: [
        weights[0] + assumptions.stepLength * gradient[0] / norm,
        weights[1] + assumptions.stepLength * gradient[1] / norm,
      ],
      gradient: gradient,
      transitions: transitions,
    };
  }

  function online(weights, options) {
    const opts = options || {};
    const inertia = opts.inertia == null ? assumptions.inertiaNew : opts.inertia;
    const updates = opts.updates == null ? assumptions.updates : opts.updates;
    const apply = opts.apply !== false;
    let current = weights.slice();
    const start = current.slice();
    let onlineTransitions = 0;
    for (let k = 0; k < updates; k++) {
      const moved = descend(current, inertia);
      onlineTransitions += moved.transitions.length;
      if (apply) current = moved.weights;
    }
    const score = evaluate(current, inertia);
    return {
      weights: current,
      startWeights: start,
      inertia: inertia,
      updates: updates,
      apply: apply,
      onlineTransitions: onlineTransitions,
      changed: current[0] !== start[0] || current[1] !== start[1],
      totalReward: score.totalReward,
      terminalError: score.terminalError,
      endAngle: score.endAngle,
      trace: score.trace,
    };
  }

  function compare(seed) {
    const recordedSeed = seed == null ? assumptions.seed : seed;
    const frozen = collectFrozen();
    const count = frozen.transitions.length;
    const policy = fitPolicy(frozen.transitions);
    const model = fitModel(frozen.transitions);
    const value = fitValue(frozen.transitions);
    if (frozen.transitions.length !== count) throw new Error('The frozen fit collected new transitions.');
    const light = evaluate(policy.weights, assumptions.inertiaOld);
    const frozenPolicy = evaluate(policy.weights, assumptions.inertiaNew);
    const finetune = online(policy.weights, { inertia: assumptions.inertiaNew, updates: assumptions.updates, apply: true });
    const scratch = online([0, 0], { inertia: assumptions.inertiaNew, updates: assumptions.updates, apply: true });
    const held = online(policy.weights, { inertia: assumptions.inertiaNew, updates: assumptions.updates, apply: false });
    const longScratch = online([0, 0], { inertia: assumptions.inertiaNew, updates: assumptions.longUpdates, apply: true });
    return {
      seed: recordedSeed,
      seedAffectsSampling: assumptions.seedAffectsSampling,
      assumptions: assumptions,
      dataset: {
        transitions: count,
        inertia: frozen.inertia,
        policy: policy,
        model: model,
        value: value,
      },
      light: light,
      frozen: {
        weights: policy.weights.slice(),
        inertia: assumptions.inertiaNew,
        updates: 0,
        apply: false,
        onlineTransitions: 0,
        changed: false,
        totalReward: frozenPolicy.totalReward,
        terminalError: frozenPolicy.terminalError,
        endAngle: frozenPolicy.endAngle,
        trace: frozenPolicy.trace,
      },
      finetune: finetune,
      scratch: scratch,
      held: held,
      longScratch: longScratch,
    };
  }

  const api = {
    assumptions: assumptions,
    collectFrozen: collectFrozen,
    fitPolicy: fitPolicy,
    fitModel: fitModel,
    fitValue: fitValue,
    evaluate: evaluate,
    online: online,
    compare: compare,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBTHAW = api;
})();
