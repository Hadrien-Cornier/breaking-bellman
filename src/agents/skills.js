// Two skills, two rooms. A smoothed count is q(skill|room). The reward is log q - log p.
// The policy gradient reads that reward. It does not store a room.
// This is a finite tabular analogue of the diversity reward. It is not SAC, and it is not a neural discriminator.
(function () {
  'use strict';
  const SKILLS = ['red', 'blue'];
  const ROOMS = ['west', 'east'];
  const ACTIONS = ['west', 'east'];
  const PRIOR = 0.5;
  const LESSON = {
    budgetPerSkill: 8,
    bias: 0.25,
    alpha: 1,
    prior: PRIOR,
    eta: 1,
    updates: 4,
    seed: 11,
  };

  function emptyCounts() {
    return { red: { west: 0, east: 0 }, blue: { west: 0, east: 0 } };
  }

  function cloneCounts(counts) {
    const out = emptyCounts();
    for (const skill of SKILLS) {
      for (const room of ROOMS) out[skill][room] = counts[skill][room];
    }
    return out;
  }

  function assertCounts(counts) {
    if (!counts) throw new Error('counts missing');
    for (const skill of SKILLS) {
      if (!counts[skill]) throw new Error('missing skill ' + skill);
      for (const room of ROOMS) {
        const n = counts[skill][room];
        if (!Number.isFinite(n) || n < 0) throw new Error('bad count ' + skill + ' ' + room);
      }
    }
  }

  function totalVisits(counts) {
    assertCounts(counts);
    let n = 0;
    for (const skill of SKILLS) for (const room of ROOMS) n += counts[skill][room];
    return n;
  }

  function swapSkills(counts) {
    assertCounts(counts);
    return { red: { west: counts.blue.west, east: counts.blue.east }, blue: { west: counts.red.west, east: counts.red.east } };
  }

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function exactPlanCounts(opts) {
    const budget = opts.budgetPerSkill;
    const bias = opts.bias;
    if (!Number.isInteger(budget) || budget <= 0) throw new Error('budget must be a positive integer');
    if (!Number.isFinite(bias) || bias < 0 || bias > 0.5) throw new Error('bias out of range');
    const counts = emptyCounts();
    const pWest = { red: 0.5 + bias, blue: 0.5 - bias };
    for (const skill of SKILLS) {
      const west = Math.round(budget * pWest[skill]);
      counts[skill].west = Math.max(0, Math.min(budget, west));
      counts[skill].east = budget - counts[skill].west;
    }
    return {
      counts, budgetPerSkill: budget, bias, source: 'exploration-plan',
      interactions: budget * SKILLS.length,
      pWest,
    };
  }

  function sampleCounts(opts) {
    const budget = opts.budgetPerSkill;
    const bias = opts.bias;
    const seed = opts.seed;
    if (!Number.isInteger(budget) || budget <= 0) throw new Error('budget must be a positive integer');
    if (!Number.isFinite(bias) || bias < 0 || bias > 0.5) throw new Error('bias out of range');
    if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
    const next = makeRng(seed);
    const counts = emptyCounts();
    const pWest = { red: 0.5 + bias, blue: 0.5 - bias };
    for (const skill of SKILLS) {
      for (let i = 0; i < budget; i++) {
        const room = next() < pWest[skill] ? 'west' : 'east';
        counts[skill][room] += 1;
      }
    }
    return {
      counts, budgetPerSkill: budget, bias, seed, source: 'seeded-sample',
      interactions: budget * SKILLS.length, pWest,
    };
  }

  function fitDiscriminator(counts, alpha) {
    assertCounts(counts);
    if (!Number.isFinite(alpha) || alpha < 0) throw new Error('smoothing must be a finite number >= 0');
    const rooms = {};
    for (const room of ROOMS) {
      const raw = {};
      let rawTotal = 0;
      for (const skill of SKILLS) {
        raw[skill] = counts[skill][room];
        rawTotal += raw[skill];
      }
      const denominator = rawTotal + alpha * SKILLS.length;
      const supported = denominator > 0;
      const q = {};
      if (supported) {
        for (const skill of SKILLS) q[skill] = (raw[skill] + alpha) / denominator;
      } else {
        for (const skill of SKILLS) q[skill] = null;
      }
      rooms[room] = { raw, rawTotal, denominator, supported, q };
    }
    return { alpha, skills: SKILLS.slice(), rooms };
  }

  function rewardTable(counts, mode, alpha, prior) {
    if (!(prior > 0) || prior > 1) throw new Error('prior must be in (0, 1]');
    const fit = mode === 'discriminator' ? fitDiscriminator(counts, alpha) : null;
    const table = {};
    for (const skill of SKILLS) {
      table[skill] = {};
      for (const room of ROOMS) {
        let value = null;
        let reason = '';
        if (mode === 'discriminator') {
          const q = fit.rooms[room].q[skill];
          if (q == null) reason = 'unsupported-room';
          else if (!(q > 0)) reason = 'nonpositive-q';
          else {
            value = Math.log(q) - Math.log(prior);
            reason = 'log q - log p';
          }
        } else if (mode === 'shared') {
          value = 1;
          reason = 'shared-1';
        } else if (mode === 'zero') {
          value = 0;
          reason = 'zero';
        } else if (mode === 'novelty') {
          const others = SKILLS.filter((s) => s !== skill).reduce((sum, s) => sum + counts[s][room], 0);
          value = counts[skill][room] > 0 && others === 0 ? 1 : 0;
          reason = 'unique-room-novelty';
        } else throw new Error('unknown reward mode ' + mode);
        if (value != null && !Number.isFinite(value)) {
          value = null;
          reason = 'non-finite';
        }
        table[skill][room] = { value, reason };
      }
    }
    return { mode, alpha, prior, fit, table };
  }

  function softmax(theta) {
    const m = Math.max(theta.west, theta.east);
    const west = Math.exp(theta.west - m);
    const east = Math.exp(theta.east - m);
    const z = west + east;
    return { west: west / z, east: east / z };
  }

  function higherRoom(pair) {
    const west = pair.west.value;
    const east = pair.east.value;
    if (!Number.isFinite(west) || !Number.isFinite(east)) return null;
    if (west > east) return 'west';
    if (east > west) return 'east';
    return null;
  }

  function policyGradientStep(theta, rewardWest, rewardEast, eta, tieBreak) {
    const pi = softmax(theta);
    const finite = Number.isFinite(rewardWest) && Number.isFinite(rewardEast);
    if (!finite) {
      return {
        theta: { west: theta.west, east: theta.east }, piBefore: pi, piAfter: pi,
        gradient: { west: 0, east: 0 }, objective: null, changed: false, tie: false, reason: 'non-finite reward',
      };
    }
    const objective = pi.west * rewardWest + pi.east * rewardEast;
    const equal = rewardWest === rewardEast;
    if (equal && tieBreak) {
      const next = { west: theta.west + eta, east: theta.east };
      return {
        theta: next, piBefore: pi, piAfter: softmax(next),
        gradient: { west: 0, east: 0 }, objective, changed: eta !== 0, tie: true, reason: 'tie-break-first-action',
      };
    }
    const gWest = pi.west * (rewardWest - objective);
    const gEast = pi.east * (rewardEast - objective);
    const next = { west: theta.west + eta * gWest, east: theta.east + eta * gEast };
    return {
      theta: next, piBefore: pi, piAfter: softmax(next),
      gradient: { west: gWest, east: gEast }, objective,
      changed: next.west !== theta.west || next.east !== theta.east,
      tie: equal, reason: equal ? 'equal-reward-zero-gradient' : 'policy-gradient',
    };
  }

  function greedy(pi) {
    if (pi.west > pi.east) return 'west';
    if (pi.east > pi.west) return 'east';
    return null;
  }

  function train(opts) {
    const counts = cloneCounts(opts.counts);
    const alpha = opts.alpha;
    const prior = opts.prior;
    const eta = opts.eta;
    const updates = opts.updates;
    const tieBreak = !!opts.tieBreak;
    if (!Number.isFinite(eta)) throw new Error('eta must be finite');
    if (!Number.isInteger(updates) || updates < 0) throw new Error('updates must be a non-negative integer');
    const rewards = rewardTable(counts, opts.mode, alpha, prior);
    const theta = { red: { west: 0, east: 0 }, blue: { west: 0, east: 0 } };
    const trace = [];
    for (let step = 0; step < updates; step++) {
      for (const skill of SKILLS) {
        const pair = rewards.table[skill];
        const moved = policyGradientStep(theta[skill], pair.west.value, pair.east.value, eta, tieBreak);
        theta[skill] = moved.theta;
        trace.push({ step, skill, reason: moved.reason, tie: moved.tie, gradient: moved.gradient, piBefore: moved.piBefore, piAfter: moved.piAfter, theta: { west: moved.theta.west, east: moved.theta.east } });
      }
    }
    const policies = {};
    for (const skill of SKILLS) {
      const pi = softmax(theta[skill]);
      const action = updates === 0 ? null : greedy(pi);
      const room = higherRoom(rewards.table[skill]);
      const objective = Number.isFinite(rewards.table[skill].west.value) && Number.isFinite(rewards.table[skill].east.value)
        ? pi.west * rewards.table[skill].west.value + pi.east * rewards.table[skill].east.value
        : null;
      policies[skill] = {
        theta: { west: theta[skill].west, east: theta[skill].east },
        pi, action, higherRoom: room, objective,
        matchesReward: action === room,
      };
    }
    const separated = !!(policies.red.action && policies.blue.action && policies.red.action !== policies.blue.action);
    return {
      counts, mode: opts.mode, alpha, prior, eta, updates, tieBreak,
      interactions: totalVisits(counts),
      rewards, policies, trace, separated,
      objectiveName: 'expected reward under the softmax policy',
      init: 'zero logits',
    };
  }

  function batchInformation(counts) {
    assertCounts(counts);
    const visits = totalVisits(counts);
    if (!(visits > 0)) return { defined: false, reason: 'no visits', visits: 0 };
    const pSkill = {};
    const pRoom = {};
    for (const skill of SKILLS) {
      pSkill[skill] = ROOMS.reduce((sum, room) => sum + counts[skill][room], 0) / visits;
    }
    for (const room of ROOMS) {
      pRoom[room] = SKILLS.reduce((sum, skill) => sum + counts[skill][room], 0) / visits;
    }
    let hSkill = 0;
    for (const skill of SKILLS) if (pSkill[skill] > 0) hSkill -= pSkill[skill] * Math.log(pSkill[skill]);
    let hCond = 0;
    for (const room of ROOMS) {
      if (!(pRoom[room] > 0)) continue;
      for (const skill of SKILLS) {
        const joint = counts[skill][room] / visits;
        if (!(joint > 0)) continue;
        hCond -= joint * Math.log(joint / pRoom[room]);
      }
    }
    const balanced = SKILLS.every((skill) => Math.abs(pSkill[skill] - 0.5) < 1e-12);
    return { defined: true, visits, hSkill, hCond, mutualInformation: hSkill - hCond, balanced, pSkill, pRoom };
  }

  function averageReward(counts, table) {
    assertCounts(counts);
    let visits = 0;
    let sum = 0;
    for (const skill of SKILLS) {
      for (const room of ROOMS) {
        const n = counts[skill][room];
        if (!n) continue;
        const value = table[skill][room].value;
        if (!Number.isFinite(value)) return { defined: false, reason: 'non-finite reward', visits: totalVisits(counts) };
        visits += n;
        sum += n * value;
      }
    }
    if (!(visits > 0)) return { defined: false, reason: 'no visits', visits: 0 };
    return { defined: true, visits, value: sum / visits };
  }

  function greedyVisits(policies, budgetPerSkill) {
    if (!Number.isInteger(budgetPerSkill) || budgetPerSkill <= 0) throw new Error('budget must be a positive integer');
    const counts = emptyCounts();
    const committed = {};
    for (const skill of SKILLS) {
      const action = policies[skill] && policies[skill].action;
      committed[skill] = action;
      if (action) counts[skill][action] = budgetPerSkill;
    }
    const complete = SKILLS.every((skill) => committed[skill]);
    return {
      counts, budgetPerSkill, committed, complete,
      interactions: complete ? budgetPerSkill * SKILLS.length : 0,
      source: 'greedy-follow-up',
    };
  }

  function compare() {
    const base = { alpha: LESSON.alpha, prior: LESSON.prior, eta: LESSON.eta, updates: LESSON.updates, tieBreak: false };
    const plan = exactPlanCounts({ budgetPerSkill: LESSON.budgetPerSkill, bias: LESSON.bias });
    const symmetric = exactPlanCounts({ budgetPerSkill: LESSON.budgetPerSkill, bias: 0 });
    const disc = train(Object.assign({}, base, { counts: plan.counts, mode: 'discriminator' }));
    const sym = train(Object.assign({}, base, { counts: symmetric.counts, mode: 'discriminator' }));
    const swapped = train(Object.assign({}, base, { counts: swapSkills(plan.counts), mode: 'discriminator' }));
    const shared = train(Object.assign({}, base, { counts: plan.counts, mode: 'shared' }));
    const sharedTie = train(Object.assign({}, base, { counts: plan.counts, mode: 'shared', tieBreak: true }));
    const novelty = train(Object.assign({}, base, { counts: plan.counts, mode: 'novelty' }));
    const heavy = train(Object.assign({}, base, { counts: plan.counts, mode: 'discriminator', alpha: 8 }));
    const follow = greedyVisits(sharedTie.policies, LESSON.budgetPerSkill);
    const afterTie = train(Object.assign({}, base, { counts: follow.counts, mode: 'discriminator' }));
    return {
      plan, symmetric, disc, sym, swapped, shared, sharedTie, novelty, heavy, follow, afterTie,
      interactions: plan.interactions, updates: LESSON.updates, eta: LESSON.eta, alpha: LESSON.alpha, prior: LESSON.prior,
    };
  }

  const api = {
    SKILLS, ROOMS, ACTIONS, PRIOR, LESSON,
    emptyCounts, cloneCounts, totalVisits, swapSkills,
    exactPlanCounts, sampleCounts, fitDiscriminator, rewardTable, softmax, higherRoom, policyGradientStep,
    train, batchInformation, averageReward, greedyVisits, compare,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBSKILLS = api;
})();
