// Lesson-local measured record. This engine is intentionally outside shared Fast inputs.
(function (root) {
  'use strict';
  const RF = typeof module === 'object' && module.exports ? require('../src/agents/rewardfit.js') : root.BBREWARDFIT;
  const VERSION = 'rewardfit-record-v1';
  function demonstrations(side) {
    return (side === 'south' ? RF.SOUTH_DEMOS : RF.NORTH_DEMOS).map(p => ({ ...p }));
  }
  function trips(demos) {
    const paths = [];
    for (const step of demos) {
      if (!paths.length || (step.x === RF.START.x && step.y === RF.START.y)) paths.push([{ x: step.x, y: step.y }]);
      paths.at(-1).push(RF.follow(step));
    }
    return paths;
  }
  async function createRecord(settings) {
    const config = { demonstrations: settings.demonstrations === 'south' ? 'south' : 'north', constraint: settings.constraint === 'hazard-zero' ? 'hazard-zero' : 'free' };
    const demos = demonstrations(config.demonstrations);
    const study = RF.study(demos);
    const fitted = config.constraint === 'hazard-zero' ? study.holeLocked : study.free;
    const identity = JSON.stringify({ version: VERSION, settings: config });
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const record = {
      id: Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''),
      version: VERSION, level: 'rewardfit', world: 'rewardfit', source: 'live', settings: config,
      policies: [{ name: 'closeness', label: 'Closeness only' }, { name: 'fitted', label: 'Fit from demonstrations' }],
      // Fitting uses existing demonstrations and a known transition model. Planning
      // is model computation, not newly collected environment interactions.
      data: { prior: { steps: demos.length, attempts: trips(demos).length }, fresh: { steps: 0, attempts: 0 } },
      demonstrations: demos, series: {}, events: {}, terminal: {}, metrics: {},
    };
    for (const [name, row] of [['closeness', study.proxy], ['fitted', fitted]]) {
      record.series[name] = row.path.map((p, t) => {
        const from = row.path[t - 1];
        const action = from ? RF.ACTIONS.find(a => from.x + a.dx === p.x && from.y + a.dy === p.y).id : null;
        const reward = t ? RF.featuresOf(p.x, p.y).reduce((sum, f, i) => sum + f * row.weights[i], 0) : 0;
        return { t, obs: { ...p }, action, reward };
      });
      record.terminal[name] = row.reachesGoal ? 'goal' : new Set(row.path.map(p => p.x + ',' + p.y)).size < row.path.length ? 'repeated-state' : 'step-limit';
      record.events[name] = record.series[name].map(p => ({ t: p.t, kind: p.t ? 'planned-move' : 'start', ...p }));
      record.metrics[name] = { weights: row.weights.slice(), logLikelihood: row.logLikelihood,
        entersHazard: row.entersHole, reachesGoal: row.reachesGoal, moves: row.path.length - 1,
        reward: record.series[name].reduce((sum, p) => sum + p.reward, 0),
        weightVectorsScored: row.evaluations || 0 };
    }
    return record;
  }
  Object.assign(RF, { createRecord, demonstrations, trips });
  if (typeof module === 'object' && module.exports) module.exports = { createRecord, demonstrations, trips };
})(typeof window === 'object' ? window : globalThis);
