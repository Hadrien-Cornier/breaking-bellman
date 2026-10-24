// Thaw's measured output adapted to the common RunRecord contract.
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('../src/agents/thaw.js') : root.BBTHAW;
  const policies = [{ name: 'frozen', label: 'Frozen' }, { name: 'finetune', label: 'Fine-tune' }, { name: 'scratch', label: 'From scratch' }];
  async function create(settings) {
    if (![1, 2].includes(settings.inertia) || ![5, 20].includes(settings.updates)) throw Error('Unsupported Thaw settings');
    const dataset = M.collectFrozen(), fitted = M.fitPolicy(dataset.transitions);
    const results = {
      frozen: M.evaluate(fitted.weights, settings.inertia),
      finetune: M.online(fitted.weights, settings),
      scratch: M.online([0, 0], settings),
    };
    const version = 'thaw-measured-v1:' + (root.BB_THAW_VERSION || 'engine-test');
    const identity = JSON.stringify({ version, settings, results });
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const record = {
      id: Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''),
      version, level: 'thaw', world: 'thaw', source: 'live', settings: { ...settings },
      policies: policies.map(p => ({ ...p })),
      data: { prior: { steps: dataset.transitions.length, attempts: 1 }, fresh: { steps: 0, attempts: 0 }, evaluation: { steps: 150, attempts: 3 }, policies: {} },
      series: {}, events: {}, terminal: {}, metrics: {}, results, dataset,
    };
    for (const { name } of policies) {
      const result = results[name];
      const steps = result.onlineTransitions || 0;
      const prior = { steps: name === 'scratch' ? 0 : dataset.steps, attempts: name === 'scratch' ? 0 : 1 };
      const fresh = { steps, attempts: steps / M.assumptions.horizon };
      record.data.policies[name] = { prior, fresh, evaluation: { steps: result.transitions.length, attempts: 1 } };
      record.data.fresh.steps += fresh.steps; record.data.fresh.attempts += fresh.attempts;
      record.series[name] = result.transitions.map((p, t) => ({ t: t + 1, obs: { angle: p.th, speed: p.w }, action: p.action, reward: p.reward, state: { angle: p.thNext, speed: p.wNext } }));
      record.events[name] = (result.practice || []).flatMap(update => update.transitions.map((p, i) => ({
        t: (update.update - 1) * 200 + i + 1, kind: 'practice', update: update.update,
        attempt: (update.update - 1) * 4 + Math.floor(i / 50) + 1, step: i % 50 + 1,
        obs: { angle: p.th, speed: p.w }, action: p.action, reward: p.reward, state: { angle: p.thNext, speed: p.wNext },
      })));
      record.terminal[name] = result.terminal;
      record.metrics[name] = { totalReward: result.totalReward, terminalError: result.terminalError, endAngle: result.endAngle,
        weights: result.weights.slice(), startWeights: name === 'scratch' ? [0, 0] : fitted.weights.slice() };
    }
    return record;
  }
  M.createRecord = create;
  if (typeof module === 'object' && module.exports) module.exports = { create, policies };
})(globalThis);
