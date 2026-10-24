// Measured corridor states, retaining the engine's original output unchanged.
(function (root) {
  'use strict';
  const R = typeof module === 'object' && module.exports ? require('../src/agents/replan.js') : root.BBREPLAN;
  function create(scheduleName) {
    if (!Object.hasOwn(R.SCHEDULES, scheduleName)) throw Error('Unknown disturbance schedule');
    const comparison = R.compare(R.SCHEDULES[scheduleName]);
    const record = {
      id: 'replan-v2:' + scheduleName, level: 'replan', world: 'replan', source: 'live',
      settings: { schedule: scheduleName, horizon: R.HORIZON },
      policies: [{ name: 'open', label: 'Open-loop' }, { name: 'replan', label: 'Replan' }],
      data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 2 } },
      series: {}, terminal: {}, metrics: {}, comparison,
    };
    for (const { name } of record.policies) {
      const run = comparison[name === 'open' ? 'open' : 'closed'];
      record.series[name] = run.path.map((obs, t) => ({ t, obs, action: t ? run.actions[t - 1] : null,
        reward: t ? R.trueStep(run.path[t - 1], run.actions[t - 1], run.disturbance[t - 1]).reward : 0 }));
      record.terminal[name] = run.crashed ? 'wall' : 'horizon';
      record.metrics[name] = { trueReturn: run.trueReturn, predictedReturn: run.predictedReturn,
        plans: run.plans, modelSteps: run.modelSteps, steps: run.actions.length };
      record.data.fresh.steps += run.actions.length;
    }
    return record;
  }
  function frame(record, t) {
    const time = Math.max(0, Math.min(R.HORIZON, Math.floor(t)));
    return { t: time, disturbance: time ? record.comparison.disturbance[time - 1] : null,
      policies: record.policies.map(policy => {
        const run = record.comparison[policy.name === 'open' ? 'open' : 'closed'];
        const index = Math.min(time, run.path.length - 1);
        return { ...policy, ...record.series[policy.name][index], sampleTime: index,
          ended: time >= run.actions.length, terminal: record.terminal[policy.name],
          prediction: run.predictedPath[Math.min(time, run.predictedPath.length - 1)] };
      }) };
  }
  const api = { create, frame };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBReplanRecord = api;
})(typeof window === 'object' ? window : globalThis);
