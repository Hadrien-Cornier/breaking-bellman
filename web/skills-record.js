// Skills-only records. Adding this engine does not change shared Fast cache inputs.
(function (root) {
  'use strict';
  const S = typeof require === 'function' ? require('../src/agents/skills.js') : root.BBSKILLS;
  const VERSION = 'skills-sampled-v1';
  const methods = [
    { name: 'discriminator', label: 'Identifiability reward', mode: 'discriminator', tieBreak: false },
    { name: 'shared', label: 'Shared reward 1', mode: 'shared', tieBreak: false },
    { name: 'tie', label: 'Shared reward with west tie', mode: 'shared', tieBreak: true },
    { name: 'novelty', label: 'Unique-room bonus', mode: 'novelty', tieBreak: false },
  ];
  function create(settings) {
    settings = Object.assign({ bias: 0.25, alpha: 1, updates: 4, budgetPerSkill: 8 }, settings);
    const sample = S.sampleCounts({ budgetPerSkill: settings.budgetPerSkill, bias: settings.bias, seed: S.LESSON.seed });
    // This is internal identity, never a learner-facing label. The engine sample is fixed internally.
    const identity = JSON.stringify({ version: VERSION, settings, seed: S.LESSON.seed });
    let hash = 2166136261;
    for (const c of identity) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    const record = {
      id: VERSION + '-' + hash.toString(16), version: VERSION, level: 'skills', world: 'skills', source: 'live',
      settings, policies: methods.map(({ name, label }) => ({ name, label })),
      data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: sample.interactions, attempts: sample.interactions } },
      series: {}, events: {}, terminal: {}, metrics: {}, sample,
    };
    for (const method of methods) {
      const result = S.train({ counts: sample.counts, mode: method.mode, alpha: settings.alpha, prior: S.PRIOR,
        eta: S.LESSON.eta, updates: settings.updates, tieBreak: method.tieBreak });
      record.series[method.name] = sample.events.map(e => ({ t: e.t, obs: { skill: e.skill, room: 'start' }, action: e.action,
        reward: e.reward, state: e.room, done: true, terminal: e.terminal }));
      // All methods reuse ONE fresh batch. Updates consume no additional environment interactions.
      record.events[method.name] = sample.events.concat(result.trace.map((e, i) => ({
        ...e, t: sample.events.length + i + 1, kind: 'policy-update',
      })));
      record.metrics[method.name] = result;
      record.terminal[method.name] = result.trace.some(e => e.reason === 'non-finite reward')
        ? 'unsupported reward; affected updates skipped' : 'update budget complete';
    }
    return record;
  }
  // A frame is an event, not an interpolation between rooms or between gradient steps.
  function frame(record, t, method = 'discriminator') {
    const events = record.events[method];
    const time = Math.max(0, Math.min(events.length, Math.floor(t)));
    const event = events[time - 1] || null;
    const visits = record.sample.events.slice(0, Math.min(time, record.sample.events.length));
    const policies = { red: { west: 0.5, east: 0.5 }, blue: { west: 0.5, east: 0.5 } };
    for (const e of events.slice(record.sample.events.length, time)) policies[e.skill] = e.piAfter;
    return { time, event, counts: visits.length ? visits.at(-1).counts : S.emptyCounts(), policies,
      // No robot movement is implied by an update event.
      room: event?.kind === 'visit' ? event.room : 'start', skill: event?.kind === 'visit' ? event.skill : null };
  }
  const api = { create, frame, methods, VERSION };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBSKILLS_RECORD = api;
})(globalThis);
