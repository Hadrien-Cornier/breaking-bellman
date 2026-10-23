// The two inference experiments own these records; shared Fast sources are unchanged.
(function (root) {
  'use strict';
  const E = typeof module === 'object' ? require('../src/agents/elbo.js') : root.BBELBO;
  const M = typeof module === 'object' ? require('../src/agents/messages.js') : root.BBMESSAGES;
  const exact = typeof module === 'object' ? require('../src/sim/exact.js') : { stringify: value => root.RLA.exact.stringify(value), parse: value => root.RLA.exact.parse(value) };
  const VERSION = root.BB_INFERENCE_VERSION || 'inference-v1';
  const copy = value => exact.parse(exact.stringify(value));
  async function identity(value) {
    const input = exact.stringify({ version: VERSION, value });
    if (typeof module === 'object') return require('node:crypto').createHash('sha256').update(input).digest('hex');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))), x => x.toString(16).padStart(2, '0')).join('');
  }
  async function create(level, settings) {
    const record = { id: await identity({ level, settings }), level, world: level, source: 'live',
      version: VERSION, settings: copy(settings), policies: [], series: {}, events: {}, metrics: {}, terminal: {},
      data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 0 }, evaluation: { steps: 0, attempts: 0 } }, results: {} };
    if (level === 'elbo') {
      const q = E.distribution(settings.weights, E.CAUSES);
      record.model = copy(E.LESSON);
      record.data.prior.observations = 1;
      record.policies = [{ name: 'elbo', label: 'KL included' }, { name: 'reconstruction', label: 'Reconstruction only' }];
      for (const { name } of record.policies) {
        const run = E.optimize(E.LESSON, q, { step: settings.step, rounds: settings.rounds, objective: name });
        record.results[name] = run;
        record.events[name] = run.steps.map((measurement, t) => ({ t, kind: t ? 'update' : 'initial', measurement }));
        record.metrics[name] = { ...run.steps.at(-1), updates: run.rounds };
        record.terminal[name] = 'update-budget';
      }
    } else if (level === 'messages') {
      record.model = M.lessonModel(settings);
      record.policies = [{ name: 'prior', label: 'Prior only' }, { name: 'conditioned', label: 'Prior × backward message' }];
      for (const { name } of record.policies) {
        const run = M.solve({ ...record.model, policy: name });
        record.results[name] = run;
        record.events[name] = run.events.map((event, t) => ({ ...event, t }));
        record.series[name] = run.events.filter(e => e.kind === 'move').map(e => ({ t: e.time, obs: e.state, action: e.action, next: e.next, reward: null }));
        record.metrics[name] = { end: run.end, reached: run.reached, moves: record.series[name].length, startMessage: run.stateMessageAtStart };
        record.terminal[name] = run.impossible ? 'undefined-distribution' : !run.deterministic ? 'stochastic-no-path' : run.reached ? 'horizon-at-goal' : 'horizon-miss';
        // Known-model computation and its displayed mode path are not new environment data.
        record.data.evaluation.steps += record.series[name].length;
        record.data.evaluation.attempts += run.deterministic ? 1 : 0;
      }
    } else throw Error('Unknown inference lesson');
    return record;
  }
  function frame(record, t) {
    return record.policies.map(({ name, label }) => {
      const events = record.events[name];
      const index = Math.max(0, Math.min(events.length - 1, Math.floor(t)));
      return { name, label, index, event: events[index], terminal: index === events.length - 1 ? record.terminal[name] : null };
    });
  }
  const length = record => Math.max(...record.policies.map(p => record.events[p.name].length));
  const api = { create, frame, length, VERSION };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBInferenceRecord = api;
})(globalThis);
