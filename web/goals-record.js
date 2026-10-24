// Goals-only measured records. This engine is deliberately outside shared Fast cache inputs.
(function (root) {
  'use strict';
  const G = typeof module === 'object' && module.exports ? require('../src/agents/goals.js') : root.BBGOALS;
  const VERSION = 'goals-replay-v1';
  const policies = [{ name: 'hidden', label: 'Hidden goal' }, { name: 'named', label: 'Named goal' }];
  async function create({ goal = 'east-room', majority = 'west' } = {}) {
    if (!G.ROOMS.includes(goal) || !G.ACTIONS.includes(majority)) throw Error('Unknown hallway setting');
    const rows = G.rowsFor(majority === 'west' ? 3 : 1, majority === 'east' ? 3 : 1);
    const settings = { goal, majority };
    const input = JSON.stringify({ version: VERSION, settings });
    const id = typeof module === 'object' && module.exports
      ? require('node:crypto').createHash('sha256').update(input).digest('hex')
      : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))), x => x.toString(16).padStart(2, '0')).join('');
    const record = { id, level: 'goals', world: 'goals', source: 'live', version: VERSION, settings,
      policies: policies.map(p => ({ ...p })),
      // One shared prior dataset, fitted twice. No additional training interactions.
      data: { prior: { steps: rows.length, attempts: rows.filter(r => r.state === 'start').length },
        fresh: { steps: 0, attempts: 0 }, evaluation: { steps: 0, attempts: 0 } },
      series: {}, terminal: {}, metrics: {}, results: {}, rows };
    for (const { name } of policies) {
      const fit = G.fit(rows, name === 'named'), walk = G.rollout(fit, goal);
      record.results[name] = { walk, table: fit.table };
      // t=0 is the measured starting state; later samples carry the action that arrived there.
      record.series[name] = walk.path.map((obs, t) => ({ t, obs, action: t ? walk.choices[t - 1].action : null,
        reward: null, goal, counts: t ? { ...walk.choices[t - 1].counts } : null }));
      record.terminal[name] = 'two-step limit';
      record.metrics[name] = { arrived: walk.arrived, end: walk.end, steps: walk.choices.length,
        score: Number(walk.arrived), evaluation: { steps: walk.choices.length, attempts: 1 } };
      record.data.evaluation.steps += walk.choices.length;
      record.data.evaluation.attempts++;
    }
    return record;
  }
  const api = { create, policies, VERSION };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBGOALS_RECORD = api;
})(globalThis);
