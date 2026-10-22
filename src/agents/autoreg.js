// Two-bit conditional counts. Lecture 3 names the headings
// "Can we discretize continuous action spaces?" and "Autoregressive discretization".
// This file is a table of pair counts. It is not a neural tokenizer,
// not a sequence model, and not a robot action-head study.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBAUTOREG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PAIRS = ['00', '01', '10', '11'];
  const LESSON = Object.freeze({
    counts: Object.freeze({ '00': 3, '01': 0, '10': 0, '11': 3 }),
    seed: 11,
    draws: 2000,
  });
  // Same marginals, opposite pairs. The product of the marginals cannot see the swap.
  const SWAP = Object.freeze({
    counts: Object.freeze({ '00': 0, '01': 3, '10': 3, '11': 0 }),
    seed: 29,
    draws: 2000,
  });
  // First bit 1 never appears. Asking for the second bit given 1 must not invent a row.
  const UNSUPPORTED = Object.freeze({
    counts: Object.freeze({ '00': 4, '01': 2, '10': 0, '11': 0 }),
    first: 1,
    seed: 3,
  });
  const CLAIMS = Object.freeze({
    neuralTokenizer: false,
    sequenceModel: false,
    pretraining: false,
    argmax: false,
    perBitTieBreak: false,
    actionHeadPaper: false,
  });

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  function frac(num, den) {
    if (den < 0) { num = -num; den = -den; }
    const g = gcd(num, den);
    return { num: num / g, den: den / g };
  }

  function mul(a, b) { return frac(a.num * b.num, a.den * b.den); }
  function add(a, b) { return frac(a.num * b.den + b.num * a.den, a.den * b.den); }

  function readCounts(counts) {
    if (!counts || typeof counts !== 'object') return { ok: false, reason: 'Action-pair counts are missing.' };
    const out = {};
    let total = 0;
    for (const pair of PAIRS) {
      const v = counts[pair];
      if (!Number.isInteger(v) || v < 0 || v > 10000) {
        return { ok: false, reason: 'Each pair count is an integer from 0 to 10000.' };
      }
      out[pair] = v;
      total += v;
    }
    return { ok: true, counts: out, total };
  }

  function emptyCounts() {
    return { '00': 0, '01': 0, '10': 0, '11': 0 };
  }

  // Marginals and conditionals come from one pair table. A prefix with count
  // zero has no conditional row. That row is not copied from the other prefix
  // and it is not filled with a coin flip.
  function fit(counts) {
    const read = readCounts(counts);
    if (!read.ok) return { ok: false, defined: false, counts: null, total: 0, marginal: null, conditional: null, reason: read.reason };
    const c = read.counts;
    const total = read.total;
    if (total === 0) {
      return {
        ok: true, defined: false, counts: c, total: 0, marginal: null, conditional: null,
        reason: 'The pair counts sum to zero, so the marginals are undefined. No bit was drawn.',
      };
    }
    const n1 = { 0: c['00'] + c['01'], 1: c['10'] + c['11'] };
    const n2 = { 0: c['00'] + c['10'], 1: c['01'] + c['11'] };
    const marginal = {
      first: {
        0: { count: n1[0], p: frac(n1[0], total) },
        1: { count: n1[1], p: frac(n1[1], total) },
      },
      second: {
        0: { count: n2[0], p: frac(n2[0], total) },
        1: { count: n2[1], p: frac(n2[1], total) },
      },
    };
    const conditional = {};
    for (const bit of [0, 1]) {
      const prefix = n1[bit];
      if (prefix === 0) {
        conditional[bit] = {
          defined: false,
          count: 0,
          0: null,
          1: null,
          reason: 'The first bit ' + bit + ' has count zero. The conditional count of the second bit is unsupported. No second bit was drawn.',
        };
      } else {
        conditional[bit] = {
          defined: true,
          count: prefix,
          0: { count: c['' + bit + '0'], p: frac(c['' + bit + '0'], prefix) },
          1: { count: c['' + bit + '1'], p: frac(c['' + bit + '1'], prefix) },
          reason: null,
        };
      }
    }
    return { ok: true, defined: true, counts: c, total, marginal, conditional, reason: null };
  }

  // Theoretical pair probabilities. Invalid mass is the sum over pairs whose count is zero.
  // It is computed from the fractions, not from later draws.
  function distribution(model, method) {
    if (!model || !model.defined) {
      return { ok: false, method, pairs: null, invalid: null, reason: model && model.reason || 'No counts.' };
    }
    if (method !== 'independent' && method !== 'conditional') {
      return { ok: false, method, pairs: null, invalid: null, reason: 'The method is independent or conditional.' };
    }
    const pairs = {};
    let invalid = frac(0, 1);
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        const key = '' + a + b;
        let p;
        if (method === 'independent') p = mul(model.marginal.first[a].p, model.marginal.second[b].p);
        else if (!model.conditional[a].defined) p = frac(0, 1);
        else p = mul(model.marginal.first[a].p, model.conditional[a][b].p);
        pairs[key] = p;
        if (model.counts[key] === 0) invalid = add(invalid, p);
      }
    }
    return { ok: true, method, pairs, invalid, reason: null };
  }

  // mulberry32, same recurrence as src/core/rng.js. Duplicated so this file
  // does not import the engine. Not a cryptographic generator.
  function mulberry32(seed) {
    let s = (seed >>> 0) || 1;
    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // One rule for every bit. A bucket in [0, total) lands on bit 0 when it
  // falls inside that bit's count. Equal counts are a fair coin. This is
  // sampling, not an argmax, and it does not prefer 0 on one bit and 1 on the other.
  function drawBit(count0, count1, next) {
    const total = count0 + count1;
    if (total <= 0) return null;
    const bucket = Math.floor(next() * total);
    if (bucket < 0 || bucket >= total) return null;
    return bucket < count0 ? 0 : 1;
  }

  function sampleIndependent(model, next) {
    if (!model || !model.defined) return { ok: false, pair: null, reason: model && model.reason || 'No counts.' };
    const b1 = drawBit(model.marginal.first[0].count, model.marginal.first[1].count, next);
    const b2 = drawBit(model.marginal.second[0].count, model.marginal.second[1].count, next);
    if (b1 == null || b2 == null) return { ok: false, pair: null, reason: 'A marginal has no count. No bit was drawn.' };
    return { ok: true, pair: '' + b1 + b2, first: b1, second: b2, reason: null };
  }

  function sampleConditional(model, next) {
    if (!model || !model.defined) return { ok: false, pair: null, reason: model && model.reason || 'No counts.' };
    const b1 = drawBit(model.marginal.first[0].count, model.marginal.first[1].count, next);
    if (b1 == null) return { ok: false, pair: null, reason: 'The first-bit marginal has no count. No bit was drawn.' };
    const row = model.conditional[b1];
    if (!row || !row.defined) {
      return { ok: false, pair: null, first: b1, second: null, reason: row && row.reason || 'That first bit is unsupported. No second bit was drawn.' };
    }
    const b2 = drawBit(row[0].count, row[1].count, next);
    if (b2 == null) return { ok: false, pair: null, first: b1, second: null, reason: row.reason };
    return { ok: true, pair: '' + b1 + b2, first: b1, second: b2, reason: null };
  }

  function failedDraw(reason) {
    return { ok: false, counts: emptyCounts(), samples: [], seed: null, draws: 0, method: null, reason: reason || 'No draw.' };
  }

  function drawMany(model, method, draws, seed) {
    if (method !== 'independent' && method !== 'conditional') return failedDraw('The method is independent or conditional.');
    if (!model || !model.defined) return failedDraw(model && model.reason || 'No counts.');
    if (!Number.isInteger(draws) || draws < 1 || draws > 20000) return failedDraw('The number of draws is an integer from 1 to 20000.');
    if (!Number.isInteger(seed)) return failedDraw('The seed is an integer.');
    const next = mulberry32(seed);
    const sample = method === 'independent' ? sampleIndependent : sampleConditional;
    const counts = emptyCounts();
    const samples = [];
    for (let i = 0; i < draws; i++) {
      const one = sample(model, next);
      if (!one.ok) return { ok: false, counts, samples, seed, draws, method, reason: one.reason };
      counts[one.pair] += 1;
      samples.push(one.pair);
    }
    return { ok: true, counts, samples, seed, draws, method, reason: null };
  }

  // Explicit query. A zero prefix returns no sample, even when a seed is given.
  function querySecond(model, first, seed) {
    if (first !== 0 && first !== 1) {
      return { ok: false, defined: false, sample: null, first, reason: 'The first bit must be 0 or 1. No second bit was drawn.' };
    }
    if (!model || !model.ok) {
      return { ok: false, defined: false, sample: null, first, reason: model && model.reason || 'No counts. No second bit was drawn.' };
    }
    if (!model.defined) {
      return { ok: false, defined: false, sample: null, first, reason: model.reason };
    }
    const row = model.conditional[first];
    if (!row || !row.defined) {
      return { ok: false, defined: false, sample: null, first, counts: null, p: null, reason: row && row.reason || 'That first bit is unsupported. No second bit was drawn.' };
    }
    const counts = { 0: row[0].count, 1: row[1].count };
    const p = { 0: row[0].p, 1: row[1].p };
    if (seed == null) return { ok: true, defined: true, sample: null, first, counts, p, reason: null };
    if (!Number.isInteger(seed)) return { ok: false, defined: true, sample: null, first, counts, p, reason: 'The seed is an integer. No second bit was drawn.' };
    const bit = drawBit(counts[0], counts[1], mulberry32(seed));
    if (bit == null) return { ok: false, defined: true, sample: null, first, counts, p, reason: 'The conditional row has no count. No second bit was drawn.' };
    return { ok: true, defined: true, sample: bit, first, counts, p, reason: null };
  }

  function compare(opts) {
    const options = opts || {};
    const model = fit(options.counts);
    const theoretical = {
      independent: distribution(model, 'independent'),
      conditional: distribution(model, 'conditional'),
    };
    const empirical = {
      independent: drawMany(model, 'independent', options.draws, options.seed),
      conditional: drawMany(model, 'conditional', options.draws, options.seed),
    };
    const reason = !model.defined ? model.reason : (empirical.independent.reason || empirical.conditional.reason);
    return {
      ok: !!(model.defined && empirical.independent.ok && empirical.conditional.ok),
      model,
      theoretical,
      empirical,
      claims: CLAIMS,
      reason: reason || null,
    };
  }

  function lesson() {
    const fitted = fit(UNSUPPORTED.counts);
    return {
      lesson: compare(LESSON),
      swap: compare(SWAP),
      unsupported: querySecond(fitted, UNSUPPORTED.first, UNSUPPORTED.seed),
      claims: CLAIMS,
    };
  }

  function cancel() {}

  return {
    PAIRS, LESSON, SWAP, UNSUPPORTED, CLAIMS,
    frac, fit, distribution, drawMany, querySecond, compare, lesson, cancel,
  };
});
