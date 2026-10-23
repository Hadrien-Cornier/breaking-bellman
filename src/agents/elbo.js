// Finite categorical evidence lower bound for one observation.
// The lesson table is fixed and positive. Callers may pass other tables.
// This is not a variational autoencoder and it does not train a network.
(function () {
  'use strict';

  const CAUSES = ['hall', 'lamp', 'glare'];
  const LESSON = {
    name: 'bright',
    causes: CAUSES,
    prior: { hall: 0.5, lamp: 0.375, glare: 0.125 },
    likelihood: { hall: 0.25, lamp: 0.5, glare: 1 },
  };
  const REPAIR = { step: 0.5, rounds: 8, objective: 'elbo' };
  const RECONSTRUCTION_ONLY = { step: 0.5, rounds: 8, objective: 'reconstruction' };
  const LIMITS = [
    'One observation and three causes. The prior and the likelihood are a fixed finite table.',
    'The guess q is a table, not a neural network.',
    'The update multiplies that table by a power of the joint. It does not train a variational autoencoder.',
    'It does not use the reparameterization trick. It does not cover every lecture 11 notion.',
    'A zero weight stays zero under the update. The term 0 log 0 counts as 0.',
    'If q puts positive mass where the prior or the posterior is zero, that KL is infinite.',
  ];

  function copyTable(table, causes) {
    const out = {};
    for (const z of causes) out[z] = table[z];
    return out;
  }

  function model(spec) {
    const causes = spec.causes.slice();
    if (causes.length < 2) throw new Error('need at least two causes');
    const prior = {}, likelihood = {};
    let priorSum = 0;
    for (const z of causes) {
      const p = spec.prior[z], like = spec.likelihood[z];
      if (!(p >= 0) || p > 1 || !Number.isFinite(p)) throw new Error('prior must be in [0, 1]');
      if (!(like >= 0) || like > 1 || !Number.isFinite(like)) throw new Error('likelihood must be in [0, 1]');
      prior[z] = p;
      likelihood[z] = like;
      priorSum += p;
    }
    if (Math.abs(priorSum - 1) > 1e-9) throw new Error('prior must sum to 1');
    const positive = causes.every((z) => prior[z] > 0 && likelihood[z] > 0);
    return { name: spec.name || 'observation', causes, prior, likelihood, positive };
  }

  function weightsOf(map) { return copyTable(map, CAUSES); }

  function evenWeights() { return { hall: 1, lamp: 1, glare: 1 }; }
  function narrowWeights() { return { hall: 1, lamp: 1, glare: 30 }; }
  function hardGlareWeights() { return { hall: 0, lamp: 0, glare: 1 }; }

  function distribution(weights, causes) {
    let sum = 0;
    for (const z of causes) {
      const w = weights[z];
      if (!(w >= 0) || !Number.isFinite(w)) throw new Error('weight must be finite and nonnegative');
      sum += w;
    }
    if (!(sum > 0)) throw new Error('at least one weight must be positive');
    const q = {};
    for (const z of causes) q[z] = weights[z] / sum;
    return q;
  }

  function evidence(m) {
    let px = 0;
    for (const z of m.causes) px += m.prior[z] * m.likelihood[z];
    return { px, logPx: px > 0 ? Math.log(px) : -Infinity };
  }

  function posterior(m) {
    const { px } = evidence(m);
    const q = {};
    for (const z of m.causes) q[z] = px > 0 ? (m.prior[z] * m.likelihood[z]) / px : 0;
    return q;
  }

  // KL(left || right). A zero left term contributes 0, including 0 log 0.
  // A positive left term on a zero right term is infinite support.
  function kl(left, right, causes) {
    let value = 0;
    const zeros = [];
    let impossible = null;
    for (const z of causes) {
      const a = left[z], b = right[z];
      if (a === 0) { zeros.push(z); continue; }
      if (!(b > 0)) { impossible = z; value = Infinity; break; }
      value += a * Math.log(a / b);
    }
    return { value, zeros, impossible };
  }

  function reconstructionOf(m, q) {
    let value = 0;
    let impossible = null;
    for (const z of m.causes) {
      if (q[z] === 0) continue;
      if (!(m.likelihood[z] > 0)) { impossible = z; value = -Infinity; break; }
      value += q[z] * Math.log(m.likelihood[z]);
    }
    return { value, impossible };
  }

  function finitePair(a, b) {
    if (a === Infinity && b === Infinity) return true;
    if (a === -Infinity && b === -Infinity) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= 1e-9;
  }

  function evaluate(m, q) {
    for (const z of m.causes) {
      if (!(q[z] >= 0) || !Number.isFinite(q[z])) throw new Error('q must be finite and nonnegative');
    }
    const sum = m.causes.reduce((s, z) => s + q[z], 0);
    if (Math.abs(sum - 1) > 1e-8) throw new Error('q must sum to 1');
    const ev = evidence(m);
    const post = posterior(m);
    const recon = reconstructionOf(m, q);
    const toPrior = kl(q, m.prior, m.causes);
    const fromPrior = kl(m.prior, q, m.causes);
    const toPost = kl(q, post, m.causes);
    const fromPost = kl(post, q, m.causes);
    let elbo = recon.value - toPrior.value;
    if (recon.value === -Infinity || toPrior.value === Infinity) elbo = -Infinity;
    const gap = ev.logPx - elbo;
    const identity = finitePair(gap, toPost.value);
    const notes = [];
    if (toPrior.zeros.length) notes.push('A zero q term uses 0 log 0 = 0, so KL(q || prior) can stay finite.');
    if (toPrior.impossible) notes.push('Impossible support: q puts mass on ' + toPrior.impossible + ', where the prior is zero. KL(q || prior) is infinite.');
    if (recon.impossible) notes.push('Impossible support: q puts mass on ' + recon.impossible + ', where the likelihood is zero. The reconstruction is negative infinity.');
    if (fromPost.value === Infinity) notes.push('KL(posterior || q) is infinite because the posterior still has mass where q is zero. KL(q || posterior) is the other direction.');
    if (!m.positive) notes.push('This table is not the lesson table. A zero prior or likelihood is a boundary case.');
    return {
      q: copyTable(q, m.causes),
      prior: copyTable(m.prior, m.causes),
      likelihood: copyTable(m.likelihood, m.causes),
      posterior: copyTable(post, m.causes),
      px: ev.px,
      logPx: ev.logPx,
      reconstruction: recon.value,
      klPrior: toPrior.value,
      klPriorReverse: fromPrior.value,
      elbo,
      klPosterior: toPost.value,
      klPosteriorReverse: fromPost.value,
      gap,
      identity,
      zeroCauses: toPrior.zeros.slice(),
      notes,
    };
  }

  // One multiplicative step. stepSize 1 reaches the posterior when the objective is the ELBO
  // and q is positive wherever the joint is positive. A hard zero stays zero.
  // The reconstruction objective ignores the prior and is not the bound.
  function step(m, q, stepSize, objective) {
    if (!(stepSize >= 0) || stepSize > 1 || !Number.isFinite(stepSize)) throw new Error('step size must be in [0, 1]');
    if (objective !== 'elbo' && objective !== 'reconstruction') throw new Error('unknown objective ' + objective);
    const logs = [];
    for (const z of m.causes) {
      const qz = q[z];
      if (qz === 0) { logs.push(-Infinity); continue; }
      if (objective === 'elbo') {
        const joint = m.likelihood[z] * m.prior[z];
        if (!(joint > 0)) { logs.push(-Infinity); continue; }
        logs.push((1 - stepSize) * Math.log(qz) + stepSize * Math.log(joint));
      } else {
        if (!(m.likelihood[z] > 0)) { logs.push(-Infinity); continue; }
        logs.push(Math.log(qz) + stepSize * Math.log(m.likelihood[z]));
      }
    }
    let peak = -Infinity;
    for (const v of logs) if (v > peak) peak = v;
    if (peak === -Infinity) return copyTable(q, m.causes);
    const raw = logs.map((v) => (v === -Infinity ? 0 : Math.exp(v - peak)));
    const sum = raw.reduce((s, v) => s + v, 0);
    const next = {};
    m.causes.forEach((z, i) => { next[z] = raw[i] / sum; });
    return next;
  }

  function optimize(m, q, options) {
    const stepSize = options.step, rounds = options.rounds, objective = options.objective;
    if (!Number.isInteger(rounds) || rounds < 1) throw new Error('rounds must be a positive integer');
    const steps = [evaluate(m, q)];
    let current = copyTable(q, m.causes);
    for (let i = 0; i < rounds; i++) {
      current = step(m, current, stepSize, objective);
      steps.push(evaluate(m, current));
    }
    return { objective, step: stepSize, rounds, steps };
  }

  function isNarrow(q) {
    return q.glare >= 0.9 && q.hall > 0 && q.lamp > 0 && q.hall <= 0.05 && q.lamp <= 0.05;
  }

  function isHardGlare(q) {
    return q.hall === 0 && q.lamp === 0 && q.glare === 1;
  }

  const lesson = model(LESSON);
  const api = {
    CAUSES, LESSON: lesson, LIMITS, REPAIR, RECONSTRUCTION_ONLY,
    model, evenWeights, narrowWeights, hardGlareWeights, weightsOf,
    distribution, evidence, posterior, kl, evaluate, step, optimize,
    isNarrow, isHardGlare,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBELBO = api;
})();
