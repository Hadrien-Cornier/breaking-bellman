// One measured run shared by the scene, charts, results and evidence.
(function () {
  'use strict';
  const RLA = globalThis.RLA = globalThis.RLA || {};
  if (typeof require === 'function') require('../src/sim/exact.js');
  const VERSION = 'shared-run-v1';
  const copy = x => RLA.exact.parse(RLA.exact.stringify(x));
  const identity = (level, config) => RLA.exact.stringify({ version: VERSION, level, config });
  const digest = async value => {
    if (typeof require === 'function') return require('node:crypto').createHash('sha256').update(value).digest('hex');
    return globalThis.BB_DIGEST.sha256(value);
  };
  async function create({ level, config, results, source, label, name = 'current', comparison = null }) {
    if (!['live', 'server', 'local'].includes(source)) throw Error('Unknown run provenance');
    if (RLA.exact.stringify(results.map(r => r.seed)) !== RLA.exact.stringify(config.seeds)) throw Error('Incomplete or unordered run seeds');
    const record = {
      id: await digest(identity(level, config) + (comparison ? ':' + comparison.id : '')), level, world: config.world,
      source: source === 'live' ? 'live' : 'fast-cache', provenance: source,
      settings: copy(config), policies: [{ name, label }], replaySeed: results[0].seed, data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 0 } },
      series: {}, events: {}, terminal: {}, metrics: {},
      // Keep complete, lossless engine output. Existing renderers consume this through the record;
      // no rounded chart summaries or reconstructed paths become a second source of truth.
      results, comparison, version: VERSION,
    };
    for (const r of results) {
      if (!r.data || !r.events || !r.final.terminal) throw Error('Run lacks measured accounting or terminal events');
      if (r.world !== config.world || r.steps !== config.steps) throw Error('Run settings do not match its output');
      const series = (r.trace || []).map((p, t) => ({ t, obs: p.obs, action: p.a, reward: p.r, state: p.s,
        done: p.done, truncated: p.truncated }));
      const events = r.bandit ? Array.from(r.bandit.arm, (action, i) => ({ t: i + 1, kind: 'pull', action, reward: r.bandit.reward[i] })) : r.events;

      const prior = { steps: r.dataset ? r.dataset.steps : 0, attempts: r.dataset ? r.dataset.episodes : 0 };
      if (!record.metrics[name]) {
        // The named policy is one method, evaluated with ordered random seeds. The default
        // replay uses the first seed; every seed's full output remains in results.
        record.series[name] = series; record.events[name] = events; record.terminal[name] = r.final.terminal;
        record.metrics[name] = { seeds: [] };
      }
      record.metrics[name].seeds.push({ seed: r.seed, final: r.final, prior, fresh: r.data.fresh,
        evaluation: r.data.evaluation, replay: r.data.replay, evaluations: r.evals, diagnostics: r.diag });
      for (const k of ['steps', 'attempts']) {
        record.data.prior[k] += prior[k]; record.data.fresh[k] += r.data.fresh[k];
      }
    }
    if (comparison) {
      if (comparison.world !== record.world) throw Error('Comparison belongs to a different world');
      const policy = comparison.policies[0], key = 'pinned:' + policy.name;
      record.policies.push({ name: key, label: 'A: ' + policy.label });
      record.series[key] = comparison.series[policy.name]; record.events[key] = comparison.events[policy.name];
      record.terminal[key] = comparison.terminal[policy.name]; record.metrics[key] = comparison.metrics[policy.name];
    }
    return record;
  }
  function state() {
    let record = null, stale = false, request = null;
    return {
      get record() { return record; }, get stale() { return stale; },
      accept(value) { record = value; stale = false; request = identity(value.level, value.settings); },
      change(level, config) { if (record && identity(level, config) !== request) stale = true; return stale; },
      clear() { record = null; stale = false; request = null; },
    };
  }
  RLA.runRecord = { create, identity, state, VERSION };
  if (typeof module === 'object' && module.exports) module.exports = RLA.runRecord;
})();
