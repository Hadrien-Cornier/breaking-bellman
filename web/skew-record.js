// Skew's measured request experiment. Kept outside the shared Fast source keys.
(function (root) {
  'use strict';
  const K = typeof module === 'object' && module.exports ? require('../src/agents/skew.js') : root.BBSKEW;
  const VERSION = 'skew-request-replay-v1';
  const policies = [
    { name: 'inverse', label: 'Inverse density' },
    { name: 'uniform', label: 'Uniform names' },
    { name: 'proportional', label: 'Follow density' },
  ];
  async function create(input) {
    const settings = { visits: { A: input.visits.A, B: input.visits.B, C: input.visits.C },
      smoothing: input.smoothing, sealed: input.sealed || null, budget: input.budget, seed: input.seed };
    const results = K.compare(settings);
    const identity = JSON.stringify({ version: VERSION, level: 'skew', settings });
    let id;
    if (typeof module === 'object' && module.exports) id = require('node:crypto').createHash('sha256').update(identity).digest('hex');
    else id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))), n => n.toString(16).padStart(2, '0')).join('');
    const record = { id, version: VERSION, level: 'skew', world: 'skew', source: 'live', settings,
      policies: policies.map(p => ({ ...p })), results, series: {}, events: {}, terminal: {}, metrics: {},
      data: { prior: { visits: Object.values(settings.visits).reduce((a, b) => a + b, 0), steps: null, attempts: null },
        fresh: { steps: 0, attempts: 0 } } };
    for (const { name } of policies) {
      const run = results[name];
      record.events[name] = run.events;
      record.terminal[name] = run.ok ? 'budget-exhausted' : run.reason;
      const attempts = run.events.filter(e => e.kind === 'outcome').length;
      record.metrics[name] = { requested: run.draw.observed, achieved: run.achieved,
        successes: Object.values(run.table).reduce((n, row) => n + row.successes, 0),
        fresh: { steps: attempts, attempts } };
      record.data.fresh.steps += attempts; record.data.fresh.attempts += attempts;
    }
    return record;
  }
  // Pure state projection; no interpolation or additional simulation during draw.
  function frame(record, name, t) {
    if (!record || record.world !== 'skew') return null;
    const events = record.events[name];
    if (!events) throw Error('Unknown Skew method');
    const time = Math.max(0, Math.min(events.length - 1, Math.floor(t)));
    const event = events[time] || null;
    const counts = { A: 0, B: 0, C: 0, Hall: 0 };
    const requests = { A: 0, B: 0, C: 0 };
    for (let i = 0; i <= time && i < events.length; i++) {
      if (events[i].kind === 'request') requests[events[i].goal]++;
      else counts[events[i].state]++;
    }
    return { event, counts, requests, time, terminal: record.terminal[name] };
  }
  K.records = { create, frame, VERSION, policies };
  if (typeof module === 'object' && module.exports) module.exports = K.records;
})(typeof window === 'object' ? window : globalThis);
