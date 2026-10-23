// Three-room density reweighting. This is not Skew-Fit's generative procedure.
// Dalal, Pong, Lin, Nair, Bahl, Levine, Skew-Fit (2019), Equation 2:
// weight w(s) = q(s)^alpha with alpha negative. Equation 3 keeps that weight
// only on states that were actually sampled. Alpha -1 is inverse density when
// q matches the state density. Alpha 0 does not skew. The paper then fits a
// generative model that is kept off zero (a beta-VAE) and trains a
// goal-conditioned policy (RIG). None of that is in this file.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBSKEW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROOMS = ['A', 'B', 'C'];
  const ANCHOR = Object.freeze({
    visits: Object.freeze({ A: 8, B: 0, C: 0 }),
    smoothing: 1,
    exponent: -1,
    budget: 627,
    seed: 23,
    sealed: 'C',
  });
  // B has historical visits and a sealed door. C has no visits and an open door.
  const SWAP = Object.freeze({
    visits: Object.freeze({ A: 5, B: 4, C: 0 }),
    smoothing: 1,
    exponent: 0,
    budget: 300,
    seed: 7,
    sealed: 'B',
  });

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  function copyVisits(visits, max) {
    const limit = max == null ? 20000 : max;
    if (!visits) return { ok: false, reason: 'Visit counts are missing.' };
    const out = {};
    for (const room of ROOMS) {
      const v = visits[room];
      if (!Number.isInteger(v) || v < 0 || v > limit) {
        return { ok: false, reason: 'Visit counts are integers from 0 to ' + limit + '.' };
      }
      out[room] = v;
    }
    return { ok: true, visits: out };
  }

  function reduced(num, den) {
    const g = gcd(num, den);
    return { num: num / g, den: den / g };
  }

  // Empirical density of achieved-room counts. Smoothing adds the same
  // pseudo-count to every room. That prior is not a visit.
  function fitDensity(visits, smoothing) {
    const read = copyVisits(visits);
    if (!read.ok) return { ok: false, defined: false, reason: read.reason };
    if (!Number.isInteger(smoothing) || smoothing < 0 || smoothing > 5) {
      return { ok: false, defined: false, reason: 'Smoothing is an integer from 0 to 5.' };
    }
    const counts = {};
    let total = 0;
    for (const room of ROOMS) {
      counts[room] = read.visits[room] + smoothing;
      total += counts[room];
    }
    const defined = total > 0;
    const p = {};
    if (defined) for (const room of ROOMS) p[room] = reduced(counts[room], total);
    return {
      ok: true,
      defined,
      visits: read.visits,
      smoothing,
      counts,
      total,
      p: defined ? p : null,
      reason: defined ? null : 'The counts sum to zero, so the density is undefined.',
    };
  }

  // Exponent -1: inverse, undefined on a zero count.
  // Exponent 0: uniform over the three room names. This is not 0^0.
  // Exponent +1: the density itself. A zero count stays weight 0, which is defined.
  function weights(density, exponent) {
    if (!density || !density.ok) return { defined: false, exponent, reason: density && density.reason || 'No density.' };
    if (exponent !== -1 && exponent !== 0 && exponent !== 1) {
      return { defined: false, exponent, reason: 'This toy only uses exponent -1, 0, or +1.' };
    }
    if (exponent === 0) {
      return {
        defined: true,
        exponent: 0,
        integers: { A: 1, B: 1, C: 1 },
        sum: 3,
        holes: [],
        note: 'Uniform over the three room names. A room with count zero is still named. This is not evidence it was visited, and it is not 0 raised to 0.',
      };
    }
    const holes = ROOMS.filter((room) => density.counts[room] === 0);
    if (exponent === -1) {
      if (!density.defined || holes.length) {
        return {
          defined: false,
          exponent: -1,
          holes,
          integers: null,
          sum: null,
          reason: 'Inverse weights are undefined where the count is zero'
            + (holes.length ? ': ' + holes.join(', ') : '')
            + '. Those rooms have no support. No goal is drawn from this weight.',
        };
      }
      let prod = 1;
      for (const room of ROOMS) prod *= density.counts[room];
      const integers = {};
      let sum = 0;
      for (const room of ROOMS) {
        integers[room] = density.total * (prod / density.counts[room]);
        sum += integers[room];
      }
      if (!Number.isSafeInteger(sum)) {
        return { defined: false, exponent: -1, holes: [], integers: null, sum: null, reason: 'These counts are too large for exact integer weights. No goal was drawn.' };
      }
      return {
        defined: true,
        exponent: -1,
        integers,
        sum,
        holes: [],
        note: 'Normalized inverse. Each unnormalized integer is total times the product of the counts, divided by that room\'s count.',
      };
    }
    if (!density.defined) {
      return { defined: false, exponent: 1, holes, reason: 'The density is undefined, so exponent +1 has nothing to copy.' };
    }
    return {
      defined: true,
      exponent: 1,
      integers: { A: density.counts.A, B: density.counts.B, C: density.counts.C },
      sum: density.total,
      holes: [],
      note: 'Exponent +1 samples proportional to the density, the high-density direction. It is the opposite of a negative exponent.',
    };
  }

  function expectation(probNum, probDen, budget) {
    const num = budget * probNum;
    const den = probDen;
    const g = gcd(num, den);
    const exact = num % den === 0;
    return { num: num / g, den: den / g, exact, whole: exact ? num / den : null };
  }

  function expectedCounts(weight, budget) {
    if (!weight || !weight.defined) return null;
    const out = {};
    for (const room of ROOMS) out[room] = expectation(weight.integers[room], weight.sum, budget);
    return out;
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

  function zeroObserved() { return { A: 0, B: 0, C: 0 }; }

  function sampleRequests(weight, budget, seed) {
    if (!weight || !weight.defined) {
      return { ok: false, requested: [], observed: zeroObserved(), reason: weight && weight.reason || 'Weights are undefined. No goal was drawn.' };
    }
    if (!Number.isInteger(budget) || budget < 1 || budget > 20000) {
      return { ok: false, requested: [], observed: zeroObserved(), reason: 'The budget is an integer from 1 to 20000.' };
    }
    if (!Number.isInteger(seed)) {
      return { ok: false, requested: [], observed: zeroObserved(), reason: 'The seed is an integer.' };
    }
    let check = 0;
    for (const room of ROOMS) check += weight.integers[room];
    if (check !== weight.sum || weight.sum < 1) {
      return { ok: false, requested: [], observed: zeroObserved(), reason: 'The weights do not sum to their normalizer. No goal was drawn.' };
    }
    const next = mulberry32(seed);
    const requested = [];
    const observed = zeroObserved();
    for (let i = 0; i < budget; i++) {
      const bucket = Math.floor(next() * weight.sum);
      let acc = 0;
      let pick = null;
      for (const room of ROOMS) {
        acc += weight.integers[room];
        if (bucket < acc) { pick = room; break; }
      }
      if (pick == null) {
        return { ok: false, requested: [], observed: zeroObserved(), reason: 'A sampler bucket fell outside the weights. No goal was kept.' };
      }
      requested.push(pick);
      observed[pick] += 1;
    }
    return { ok: true, requested, observed, reason: null };
  }

  function doorsOf(sealed) {
    const doors = { A: 'open', B: 'open', C: 'open' };
    if (sealed) doors[sealed] = 'sealed';
    return doors;
  }

  // Dynamics. The density is not an argument. A sealed room has no transition.
  // An open room is entered by a known reset, which is allocation, not search.
  function enter(goal, sealed, pretend) {
    if (ROOMS.indexOf(goal) < 0) {
      return { goal, achieved: 'Hall', success: false, kind: 'invalid', reason: 'That goal is not a room.' };
    }
    if (sealed && goal === sealed) {
      if (pretend) {
        return {
          goal, achieved: goal, success: true, kind: 'pretend',
          reason: 'Pretend reset. The door into ' + goal + ' is sealed. This success was written without a transition. It is not reachability.',
        };
      }
      return {
        goal, achieved: 'Hall', success: false, kind: 'sealed',
        reason: 'The door into ' + goal + ' is sealed. No transition enters that room. The attempt stays in the hall and is spent.',
      };
    }
    return {
      goal, achieved: goal, success: true, kind: 'reset',
      reason: 'Known-room reset. The door into ' + goal + ' is open, so the attempt is placed there. This is practice allocation, not a searched path and not a new dynamics model.',
    };
  }

  function emptyTable() {
    const table = {};
    for (const room of ROOMS) table[room] = { attempts: 0, successes: 0, achieved: {} };
    return table;
  }

  function claimsFor(pretend) {
    return {
      generativeModel: false,
      skewFitProcedure: false,
      robotResults: false,
      knownRoomReset: !pretend,
      pretendReachability: !!pretend,
    };
  }

  function assumptionsFor(pretend) {
    const lines = [
      'The density is the visit counts plus the smoothing pseudo-count, divided by their sum. A pseudo-count is not a visit and not a transition.',
      'Exponent -1 is undefined on a zero count. Exponent 0 is uniform over the three room names, not a power of zero. Exponent +1 copies the density.',
      'Requests are one seeded draw with a finite budget. An expected count is the budget times the probability. An observed count is what this seed drew.',
      'An open door uses a known-room reset. The attempt is placed in the requested room. That allocates practice. It does not search for a path and it does not learn dynamics.',
      'A sealed door has no transition. The attempt stays in the hall. Smoothing and reweighting do not open the door, and a changed histogram is not new coverage.',
      'The goal-conditioned table counts those attempt outcomes only. The no-update table is left empty. This is not a beta-VAE, not RIG, not hindsight relabeling, and not the paper\'s robot results.',
    ];
    if (pretend) lines.push('Pretend mode writes a success for the sealed room. That number is not reachability.');
    return lines;
  }

  function blankAchieved() { return { A: 0, B: 0, C: 0, Hall: 0 }; }

  function practice(opts) {
    const options = opts || {};
    const read = copyVisits(options.visits, 40);
    const pretend = !!options.pretend;
    const sealed = options.sealed == null || options.sealed === '' ? null : options.sealed;
    const baseFail = (reason) => ({
      ok: false,
      reason,
      visits: read.ok ? read.visits : null,
      smoothing: options.smoothing,
      exponent: options.exponent,
      sealed,
      budget: options.budget,
      seed: options.seed,
      pretend,
      doors: sealed && ROOMS.indexOf(sealed) >= 0 ? doorsOf(sealed) : null,
      density: null,
      weights: null,
      expected: null,
      draw: { ok: false, requested: [], observed: zeroObserved(), reason },
      events: [],
      achieved: blankAchieved(),
      table: emptyTable(),
      noUpdate: emptyTable(),
      failureReason: null,
      claims: claimsFor(pretend),
      assumptions: assumptionsFor(pretend),
    });
    if (!read.ok) return baseFail(read.reason);
    if (sealed != null && ROOMS.indexOf(sealed) < 0) return baseFail('The sealed room must be A, B, C, or none.');
    const density = fitDensity(read.visits, options.smoothing);
    if (!density.ok) return baseFail(density.reason);
    const weight = weights(density, options.exponent);
    const draw = sampleRequests(weight, options.budget, options.seed);
    const table = emptyTable();
    const noUpdate = emptyTable();
    const achieved = blankAchieved();
    const events = [];
    let failureReason = null;
    if (draw.ok) {
      for (const goal of draw.requested) {
        const attempt = events.length / 2 + 1;
        events.push({ t: events.length, kind: 'request', attempt, goal, state: 'Hall' });
        const outcome = enter(goal, sealed, pretend);
        events.push({ t: events.length, kind: 'outcome', attempt, goal,
          state: outcome.achieved, success: outcome.success, action: outcome.kind,
          reason: outcome.reason });
        achieved[outcome.achieved] += 1;
        const row = table[goal];
        row.attempts += 1;
        row.achieved[outcome.achieved] = (row.achieved[outcome.achieved] || 0) + 1;
        if (outcome.success) row.successes += 1;
        if (outcome.kind === 'sealed' && !failureReason) failureReason = outcome.reason;
        if (outcome.kind === 'pretend' && !failureReason) failureReason = outcome.reason;
      }
    }
    return {
      ok: draw.ok,
      reason: draw.ok ? null : draw.reason,
      visits: read.visits,
      smoothing: options.smoothing,
      exponent: options.exponent,
      sealed,
      budget: options.budget,
      seed: options.seed,
      pretend,
      doors: doorsOf(sealed),
      density,
      weights: weight,
      expected: weight.defined ? expectedCounts(weight, options.budget) : null,
      draw,
      events,
      achieved,
      table,
      noUpdate,
      failureReason,
      claims: claimsFor(pretend),
      assumptions: assumptionsFor(pretend),
    };
  }

  function compare(opts) {
    return {
      inverse: practice(Object.assign({}, opts, { exponent: -1, pretend: false })),
      uniform: practice(Object.assign({}, opts, { exponent: 0, pretend: false })),
      proportional: practice(Object.assign({}, opts, { exponent: 1, pretend: false })),
    };
  }

  function lesson() {
    const shared = {
      visits: { A: ANCHOR.visits.A, B: ANCHOR.visits.B, C: ANCHOR.visits.C },
      smoothing: ANCHOR.smoothing,
      sealed: ANCHOR.sealed,
      budget: ANCHOR.budget,
      seed: ANCHOR.seed,
    };
    return {
      unsmoothed: practice({
        visits: { A: ANCHOR.visits.A, B: ANCHOR.visits.B, C: ANCHOR.visits.C },
        smoothing: 0,
        exponent: -1,
        sealed: ANCHOR.sealed,
        budget: ANCHOR.budget,
        seed: ANCHOR.seed,
      }),
      arms: compare(shared),
      swap: practice({
        visits: { A: SWAP.visits.A, B: SWAP.visits.B, C: SWAP.visits.C },
        smoothing: SWAP.smoothing,
        exponent: SWAP.exponent,
        sealed: SWAP.sealed,
        budget: SWAP.budget,
        seed: SWAP.seed,
      }),
    };
  }

  // The action is the recorded outcome, not a path. No attempts means no action,
  // the same answer as the no-update table.
  function policy(table, goal) {
    const row = table && table[goal];
    if (!row || row.attempts === 0) {
      return { goal, action: null, attempts: 0, successes: 0, note: 'No labeled attempts for this goal. The no-update table says the same.' };
    }
    if (row.successes === 0) {
      return { goal, action: 'none', attempts: row.attempts, successes: 0, note: 'Requests were labeled. None entered ' + goal + '.' };
    }
    if (row.successes === row.attempts) {
      return { goal, action: 'reset-enter', attempts: row.attempts, successes: row.successes, note: 'Every labeled attempt entered by the known-room reset. This is not a searched path.' };
    }
    return { goal, action: 'mixed', attempts: row.attempts, successes: row.successes, note: 'Some labeled attempts entered and some did not.' };
  }

  return {
    ROOMS, ANCHOR, SWAP, gcd, fitDensity, weights, expectation, expectedCounts,
    sampleRequests, enter, emptyTable, practice, compare, lesson, policy,
  };
});
