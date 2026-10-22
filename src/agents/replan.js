// Known mean model of a tiny corridor. Open-loop search versus replanning.
// No learning update, no ensemble, and no shared code with SuperMimic.
(function () {
  'use strict';
  const ACTIONS = [-1, 0, 1];
  const HORIZON = 4;
  const WALL = 2;
  const CRASH_REWARD = -5;
  const SCHEDULES = {
    lesson: [1, 1, 0, 0],
    zero: [0, 0, 0, 0],
    uncorrectable: [2, 0, 0, 0],
  };

  function defaultStepReward(next) {
    return 1 - Math.abs(next);
  }

  function candidates(horizon) {
    let seqs = [[]];
    for (let t = 0; t < horizon; t++) {
      const next = [];
      for (const seq of seqs) for (const a of ACTIONS) next.push(seq.concat(a));
      seqs = next;
    }
    return seqs;
  }

  function transition(y, action, disturbance, stepReward) {
    const next = y + action + disturbance;
    const crashed = Math.abs(next) >= WALL;
    return { y: next, crashed, reward: crashed ? CRASH_REWARD : stepReward(next) };
  }

  function meanStep(y, action, stepReward) {
    return transition(y, action, 0, stepReward || defaultStepReward);
  }

  function trueStep(y, action, disturbance, stepReward) {
    return transition(y, action, disturbance, stepReward || defaultStepReward);
  }

  function scoreSequence(y0, sequence, stepReward) {
    let y = y0, total = 0, modelSteps = 0;
    const path = [y0];
    for (const action of sequence) {
      const step = meanStep(y, action, stepReward);
      modelSteps += 1;
      total += step.reward;
      y = step.y;
      path.push(y);
      if (step.crashed) break;
    }
    return { meanReturn: total, meanPath: path, modelSteps };
  }

  // Higher mean-model return wins. Ties keep the sequence with fewer non-zero
  // actions, then the lexicographically smaller action list.
  function better(a, b) {
    if (a.meanReturn !== b.meanReturn) return a.meanReturn > b.meanReturn;
    const bulk = (seq) => seq.reduce((sum, action) => sum + Math.abs(action), 0);
    const aBulk = bulk(a.sequence), bBulk = bulk(b.sequence);
    if (aBulk !== bBulk) return aBulk < bBulk;
    for (let i = 0; i < a.sequence.length; i++) {
      if (a.sequence[i] !== b.sequence[i]) return a.sequence[i] < b.sequence[i];
    }
    return false;
  }

  function plan(y0, opts) {
    const horizon = (opts && opts.horizon) || HORIZON;
    const stepReward = (opts && opts.stepReward) || defaultStepReward;
    const list = candidates(horizon);
    let best = null, modelSteps = 0;
    for (const sequence of list) {
      const scored = scoreSequence(y0, sequence, stepReward);
      modelSteps += scored.modelSteps;
      const row = { sequence, meanReturn: scored.meanReturn, meanPath: scored.meanPath };
      if (!best || better(row, best)) best = row;
    }
    return {
      state: y0,
      sequence: best.sequence.slice(),
      firstAction: best.sequence[0],
      meanReturn: best.meanReturn,
      meanPath: best.meanPath.slice(),
      modelSteps,
      candidates: list.length,
      horizon,
      model: 'mean-one-step',
    };
  }

  function rollout(mode, disturbance, opts) {
    const horizon = (opts && opts.horizon) || HORIZON;
    const stepReward = (opts && opts.stepReward) || defaultStepReward;
    const observe = (opts && opts.observe) || ((y) => y);
    const list = Array.from(disturbance || []).slice(0, horizon);
    if (list.length < horizon) throw new Error('disturbance schedule is shorter than the horizon');
    let y = 0, trueReturn = 0, crashed = false, modelSteps = 0;
    const path = [0], actions = [], planLog = [];
    const pushPlan = (seen) => {
      const chosen = plan(seen, { horizon, stepReward });
      modelSteps += chosen.modelSteps;
      planLog.push({
        stateSeen: seen,
        sequence: chosen.sequence.slice(),
        firstAction: chosen.firstAction,
        meanReturn: chosen.meanReturn,
        meanPath: chosen.meanPath.slice(),
        candidates: chosen.candidates,
        horizon: chosen.horizon,
        modelSteps: chosen.modelSteps,
        model: chosen.model,
      });
      return chosen;
    };
    if (mode === 'open') {
      const chosen = pushPlan(observe(y, 0));
      for (let t = 0; t < horizon && !crashed; t++) {
        const step = trueStep(y, chosen.sequence[t], list[t], stepReward);
        actions.push(chosen.sequence[t]);
        trueReturn += step.reward;
        y = step.y;
        path.push(y);
        crashed = step.crashed;
      }
    } else if (mode === 'replan') {
      for (let t = 0; t < horizon && !crashed; t++) {
        const chosen = pushPlan(observe(y, t));
        const step = trueStep(y, chosen.firstAction, list[t], stepReward);
        actions.push(chosen.firstAction);
        trueReturn += step.reward;
        y = step.y;
        path.push(y);
        crashed = step.crashed;
      }
    } else {
      throw new Error('unknown mode ' + mode);
    }
    return {
      mode,
      model: 'mean-one-step',
      learned: false,
      trainingData: null,
      disturbance: list.slice(),
      plans: planLog.length,
      modelSteps,
      budgetPerPlan: { candidates: planLog[0].candidates, horizon: planLog[0].horizon, model: 'mean-one-step' },
      actions,
      path,
      trueReturn,
      predictedReturn: planLog[0].meanReturn,
      predictedPath: planLog[0].meanPath.slice(),
      crashed,
      planLog,
    };
  }

  function compare(disturbance, opts) {
    const open = rollout('open', disturbance, opts);
    const closed = rollout('replan', disturbance, opts);
    return {
      disturbance: open.disturbance.slice(),
      model: 'mean-one-step',
      learned: false,
      trainingData: null,
      objective: 'Sum of step rewards under the mean model. A wall pays ' + CRASH_REWARD + ' and stops that rollout.',
      budgetPerPlan: open.budgetPerPlan,
      open,
      closed,
      totalPlans: { open: open.plans, replan: closed.plans },
      totalModelSteps: { open: open.modelSteps, replan: closed.modelSteps },
      gaps: ['bootstrap ensembles', 'Dyna-style imagination', 'latent dynamics', 'iterative Gaussian cross-entropy refit'],
    };
  }

  const api = {
    ACTIONS, HORIZON, WALL, CRASH_REWARD, SCHEDULES,
    defaultStepReward, candidates, meanStep, trueStep, plan, rollout, compare,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBREPLAN = api;
})();
