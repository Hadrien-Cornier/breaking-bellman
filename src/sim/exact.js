(function () {
  'use strict';
  const RLA = globalThis.RLA = globalThis.RLA || {};
  const typed = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
  function encode(x) {
    if (x === undefined) return { $bb: 'undefined' };
    if (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) return { $bb: 'number', value: Object.is(x, -0) ? '-0' : String(x) };
    if (ArrayBuffer.isView(x)) return { $bb: x.constructor.name, value: Array.from(x, encode) };
    if (Array.isArray(x)) return x.map(encode);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, encode(x[k])]));
    return x;
  }
  function decode(x) {
    if (Array.isArray(x)) return x.map(decode);
    if (x && typeof x === 'object') {
      if (x.$bb === 'undefined') return undefined;
      if (x.$bb === 'number') return x.value === '-0' ? -0 : Number(x.value);
      if (typed[x.$bb]) return new typed[x.$bb](x.value.map(decode));
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, decode(v)]));
    }
    return x;
  }
  const stringify = x => JSON.stringify(encode(x));
  function resolve(cfg, seeds, versions, C) {
    const family = C.famOf(cfg.parts), W = RLA.worlds[cfg.world];
    const knobs = Object.assign({}, RLA.knobDefaults(cfg.world), cfg.knobs);
    const steps = cfg.steps || 20000, every = cfg.evalEvery || Math.max(1, Math.round(steps / 40));
    return { schema: 'bb-exact-v1', versions, world: cfg.world, family, parts: C.cfg(cfg.parts), knobs,
      hyper: Object.assign({}, RLA[family].DEFAULT_HYPER, W.hyper, cfg.hyper), steps, seeds: seeds.slice(),
      evaluation: { every, episodes: cfg.evalEpisodes || W.evalEpisodes || 3, worldEvalHorizon: W.evalHorizon || null,
        trainingHorizon: knobs.maxSteps || 1, finalEpisodes: Math.max(20, cfg.finalEpisodes || 0), progressEvery: cfg.progressEvery || every } };
  }
  function runConfig(c, seed) {
    return { world: c.world, parts: c.parts, knobs: c.knobs, hyper: c.hyper, steps: c.steps, seed,
      evalEvery: c.evaluation.every, evalEpisodes: c.evaluation.episodes, finalEpisodes: c.evaluation.finalEpisodes, progressEvery: c.evaluation.progressEvery };
  }
  RLA.exact = { encode, decode, stringify, parse: s => decode(JSON.parse(s)), resolve, runConfig };
  if (typeof module === 'object' && module.exports) module.exports = RLA.exact;
})();
