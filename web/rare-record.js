// Rare's real sampled hallway interactions, independent of the shared Fast engine.
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('../src/agents/rare.js') : root.BBRARE;
  const VERSION = 'rare-record-v1';
  const samples = [19, 1, 7, 13, 23];
  const policies = [
    { name: 'off', label: 'No bonus', place: 'off' },
    { name: 'local', label: 'Action-score bonus only', place: 'local' },
    { name: 'targetOnly', label: 'Target bonus only', place: 'target' },
    { name: 'optimism', label: 'Optimism only', place: 'optimism' },
    { name: 'on', label: 'Optimism + target bonus', place: 'backup' },
    { name: 'withheld', label: 'Bonus with reward withheld', place: 'backup', reward: 'none' },
  ];
  async function create(settings = {}) {
    const config = { steps: settings.steps ?? 80, eps: settings.eps ?? 0.05 };
    if (![28, 80].includes(config.steps) || ![0.05, 0.2].includes(config.eps)) throw Error('Unsupported rare settings');
    const identity = JSON.stringify({ version: VERSION, settings: config, samples, policies });
    const id = typeof module === 'object' && module.exports
      ? require('node:crypto').createHash('sha256').update(identity).digest('hex')
      : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))), b => b.toString(16).padStart(2, '0')).join('');
    const record = { id, version: VERSION, level: 'rare', world: 'rare', source: 'live', settings: config,
      policies: policies.map(({ name, label }) => ({ name, label })),
      data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 0 }, evaluation: { steps: 0, attempts: 0 } },
      series: {}, events: {}, terminal: {}, metrics: {}, results: {} };
    for (const policy of policies) {
      const runs = samples.map(seed => M.run({ ...config, seed, place: policy.place, reward: policy.reward || 'env' }));
      record.results[policy.name] = runs;
      const replay = runs[0];
      record.series[policy.name] = replay.trace.map(e => ({ t: e.t + 1, obs: e.s, action: e.a, reward: e.env,
        state: e.s2, nAfter: e.nAfter, visitBonus: e.visitBonus, intrinsic: e.intrinsic, explored: e.explored,
        qBefore: e.qBefore, qAfter: e.qAfter, bootstrap: e.bootstrap, actionScore: e.actionScore, triedBefore: e.triedBefore }));
      record.events[policy.name] = replay.trace.map(e => ({ t: e.t + 1, kind: e.s === replay.door && e.a === 2 ? 'door-open' : e.s === replay.door + 1 ? 'reset' : 'move', from: e.s, to: e.s2 }));
      record.terminal[policy.name] = 'step-budget';
      record.metrics[policy.name] = {
        samples: runs.length,
        meanCrossings: runs.reduce((sum, r) => sum + r.crossings, 0) / runs.length,
        meanOpenings: runs.reduce((sum, r) => sum + r.openings, 0) / runs.length,
        observedExplorations: runs.reduce((sum, r) => sum + r.trace.filter(e => e.explored).length, 0),
        expectedExplorations: config.steps * config.eps * runs.length,
        fresh: { steps: config.steps * runs.length, attempts: runs.length },
      };
      record.data.fresh.steps += config.steps * runs.length;
      record.data.fresh.attempts += runs.length;
      record.data.evaluation.steps += runs.reduce((sum, r) => sum + r.greedyActions.length, 0);
      record.data.evaluation.attempts += runs.length;
    }
    return record;
  }
  // t is the number of actual interactions replayed. Start is counted once before t=1.
  function frame(record, name, t) {
    const counts = Array(8).fill(0); counts[0] = 1;
    const series = record ? record.series[name] : [];
    const time = Math.max(0, Math.min(series.length, Math.floor(t)));
    let reward = 0, visitBonus = 0;
    for (const e of series.slice(0, time)) { counts[e.state]++; reward += e.reward; visitBonus += e.visitBonus; }
    const last = series[time - 1] || null;
    return { time, state: last ? last.state : 0, counts, reward, visitBonus, last };
  }
  const api = { VERSION, policies, create, frame };
  root.BBRARE_RECORD = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
