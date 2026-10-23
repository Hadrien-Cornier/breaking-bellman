// Records for the two original comparison lessons. Independent of shared Fast inputs.
(function () {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  async function create(level, result, version) {
    const record = { level, world: level, source: 'live', version,
      settings: level === 'vpo' ? { seed: result.seed, generations: result.generations } : { seed: result.seed, scale: result.scale },
      policies: [], data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 0 } },
      series: {}, events: {}, terminal: {}, metrics: {}, results: clone(result) };
    if (level === 'vpo') {
      const V = typeof module === 'object' && module.exports ? require('../src/agents/vpo.js') : globalThis.BBVPO;
      record.data.unit = 'categorical route selections';
      record.data.evaluation = { steps: 0, attempts: 0 };
      for (const arm of [{ arm: 'base', evaluation: result.base, events: [], candidates: 0 }, ...result.arms]) {
        const name = arm.arm, series = [], events = clone(arm.events);
        record.policies.push({ name, label: name === 'base' ? 'Untrained base' : name.toUpperCase() });
        // Exactly the retained last evaluation pool, in sampled order, as in the inspector.
        arm.evaluation.pool.forEach((routeId, episode) => {
          const route = V.routes[routeId], replay = V.replay(route.path);
          replay.path.forEach((obs, step) => series.push({ t: series.length, episode, step, obs: obs.slice(),
            action: step ? obs.map((x, i) => x - replay.path[step - 1][i]) : null,
            reward: step === replay.path.length - 1 ? replay.reward.slice() : [0, 0, 0, 0],
            route: routeId, routeName: route.name, kind: step ? 'predefined route move' : 'sampled route start',
            terminal: step === replay.path.length - 1 ? (replay.exit ? 'exit reached' : 'move budget exhausted') : null }));
        });
        record.series[name] = series; record.events[name] = events;
        record.terminal[name] = series.at(-1).terminal;
        record.metrics[name] = { ...clone(arm.evaluation), training: { steps: arm.candidates, attempts: arm.candidates },
          evaluation: { steps: arm.evaluation.pools.flat().length, attempts: arm.evaluation.pools.length },
          replay: 'predefined routes from the final measured evaluation pool' };
        record.data.fresh.steps += arm.candidates; record.data.fresh.attempts += arm.candidates;
        record.data.evaluation.steps += arm.evaluation.pools.flat().length;
        record.data.evaluation.attempts += arm.evaluation.pools.length;
      }
    } else if (level === 'supermimic') {
      record.data.unit = 'true-physics transitions';
      record.data.prior = { steps: result.model.fitTransitions, attempts: Math.ceil(result.model.fitTransitions / 40), description: 'Model-fit data collected before policy training in this run' };
      record.data.evaluation = { steps: 0, attempts: 0 };
      record.data.diagnostics = { steps: 0, attempts: 0 };
      record.data.benchmark = { physicsSteps: result.rollout.steps, modelSteps: result.rollout.steps };
      result.methods.forEach((method, i) => {
        const name = ['physics', 'model', 'backprop'][i];
        record.policies.push({ name, label: method.name });
        record.series[name] = clone(method.evaluation.trace);
        record.events[name] = record.series[name].filter(x => x.kind === 'reset' || x.terminal);
        record.terminal[name] = record.series[name].at(-1).terminal;
        record.metrics[name] = clone(method);
        if (i === 0) record.data.fresh = clone(method.accounting.training);
        for (const key of ['evaluation', 'diagnostics']) for (const unit of ['steps', 'attempts']) record.data[key][unit] += method.accounting[key][unit];
      });
    } else throw Error('Unknown comparison lesson');
    // Hash semantic inputs and engine version. Timing noise is evidence, not a new identity.
    const identity = JSON.stringify({ level, settings: record.settings, version });
    record.id = typeof module === 'object' && module.exports
      ? require('node:crypto').createHash('sha256').update(identity).digest('hex')
      : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))), x => x.toString(16).padStart(2, '0')).join('');
    return record;
  }
  globalThis.BB = globalThis.BB || {};
  globalThis.BB.customRecord = { create };
  if (typeof module === 'object' && module.exports) module.exports = { create };
})();
