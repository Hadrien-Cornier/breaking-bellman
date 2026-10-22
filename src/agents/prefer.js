// Two fixed replies, a fixed list of pairwise preferences, and a Bradley-Terry score fit.
// The policy step maximizes expected fitted score, with or without a KL penalty to an explicit reference.
// There is no language model and no sampled text. Only the two ids below are actions.
(function () {
  'use strict';

  const IDS = ['four', 'twenty'];
  const ANSWERS = [
    { id: 'four', text: '4' },
    { id: 'twenty', text: '22' },
  ];
  const PROMPT = 'Write the digits for two plus two.';
  const PREFERENCES = [
    { winner: 'four', loser: 'twenty' },
    { winner: 'four', loser: 'twenty' },
    { winner: 'four', loser: 'twenty' },
    { winner: 'twenty', loser: 'four' },
  ];
  const REFERENCE = Object.freeze({ four: 0.5, twenty: 0.5 });
  const HOLE = Object.freeze({ four: 0, twenty: 1 });

  function copyPi(pi) {
    return { four: pi.four, twenty: pi.twenty };
  }

  function assertPair(row) {
    if (!row || IDS.indexOf(row.winner) < 0 || IDS.indexOf(row.loser) < 0 || row.winner === row.loser) {
      throw new Error('A preference row must name the two different replies.');
    }
  }

  function countsOf(preferences) {
    const counts = { four: 0, twenty: 0 };
    for (let i = 0; i < preferences.length; i++) {
      assertPair(preferences[i]);
      counts[preferences[i].winner] += 1;
    }
    return counts;
  }

  function logSigmoid(d) {
    if (d >= 0) return -Math.log1p(Math.exp(-d));
    return d - Math.log1p(Math.exp(d));
  }

  function logLikelihood(scores, preferences) {
    if (!scores || !isFinite(scores.four) || !isFinite(scores.twenty)) return NaN;
    let sum = 0;
    for (let i = 0; i < preferences.length; i++) {
      const row = preferences[i];
      assertPair(row);
      sum += logSigmoid(scores[row.winner] - scores[row.loser]);
    }
    return sum;
  }

  // Gauge: the score of "22" is fixed at 0. Only the difference is identified.
  // Newton maximizes the Bradley-Terry log likelihood. A reply that never loses has no finite maximizer.
  function fitScores(preferences) {
    const rows = preferences || PREFERENCES;
    const counts = countsOf(rows);
    if (counts.four === 0 || counts.twenty === 0) {
      return {
        finite: false,
        counts: counts,
        scores: null,
        gap: null,
        logLikelihood: Infinity,
        gauge: 'twenty = 0',
        reason: 'A reply that never loses has no finite Bradley-Terry score. The likelihood keeps rising as that score rises.',
      };
    }
    let delta = 0;
    let iterations = 0;
    const n = counts.four;
    const m = counts.twenty;
    for (let i = 0; i < 40; i++) {
      iterations = i + 1;
      const p = 1 / (1 + Math.exp(-delta));
      const slope = n - (n + m) * p;
      const curve = -(n + m) * p * (1 - p);
      const step = slope / curve;
      delta -= step;
      if (Math.abs(step) < 1e-14) break;
    }
    const scores = { four: delta, twenty: 0 };
    return {
      finite: true,
      counts: counts,
      scores: scores,
      gap: delta,
      logLikelihood: logLikelihood(scores, rows),
      iterations: iterations,
      gauge: 'twenty = 0',
      reason: '',
    };
  }

  function scaleScores(scores, scale) {
    if (!isFinite(scale) || scale <= 0) throw new Error('Reward scale must be a positive finite number.');
    return { four: scores.four * scale, twenty: scores.twenty * scale };
  }

  function expectedReward(pi, scores) {
    return pi.four * scores.four + pi.twenty * scores.twenty;
  }

  // KL(pi || ref). The 0 log 0 term is 0. Mass outside the reference support is infinite.
  function klDivergence(pi, ref) {
    let sum = 0;
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i];
      const p = pi[id];
      const q = ref[id];
      if (p === 0) continue;
      if (!(p > 0) || !isFinite(p)) return NaN;
      if (!(q > 0)) return Infinity;
      sum += p * Math.log(p / q);
    }
    return sum;
  }

  function objectiveValue(pi, scores, ref, beta) {
    const reward = expectedReward(pi, scores);
    const kl = klDivergence(pi, ref);
    const penalized = beta > 0;
    return {
      expectedReward: reward,
      kl: kl,
      objective: penalized ? reward - beta * kl : reward,
      klInObjective: penalized,
    };
  }

  function assertRef(ref) {
    if (!ref || !isFinite(ref.four) || !isFinite(ref.twenty) || ref.four < 0 || ref.twenty < 0) {
      throw new Error('The reference must give each reply a finite nonnegative probability.');
    }
    if (Math.abs(ref.four + ref.twenty - 1) > 1e-9) throw new Error('The reference probabilities must sum to 1.');
  }

  // Positive finite beta: pi(a) proportional to ref(a) * exp(score(a) / beta).
  // Log-sum-exp keeps a large score ratio finite. A zero reference weight stays zero.
  function tiltedReference(scores, ref, beta) {
    assertRef(ref);
    if (!(beta > 0) || !isFinite(beta)) throw new Error('The tilted reference needs a positive finite beta.');
    const logs = IDS.map((id) => (ref[id] > 0 ? Math.log(ref[id]) + scores[id] / beta : -Infinity));
    const finite = logs.filter((x) => isFinite(x));
    if (!finite.length) throw new Error('The reference has empty support.');
    const top = Math.max.apply(null, finite);
    const weights = logs.map((x) => (isFinite(x) ? Math.exp(x - top) : 0));
    const z = weights[0] + weights[1];
    return { four: weights[0] / z, twenty: weights[1] / z };
  }

  function vertexPolicy(scores, ref) {
    const gap = scores.four - scores.twenty;
    if (Math.abs(gap) <= 1e-12) return copyPi(ref);
    const id = gap > 0 ? 'four' : 'twenty';
    return { four: id === 'four' ? 1 : 0, twenty: id === 'twenty' ? 1 : 0 };
  }

  function newtonPolicy(scores, ref, beta) {
    let p = ref.four > 0 && ref.four < 1 ? ref.four : 0.5;
    let iterations = 0;
    const gap = scores.four - scores.twenty;
    for (let i = 0; i < 60; i++) {
      iterations = i + 1;
      const logitGap = Math.log(p / ref.four) - Math.log((1 - p) / ref.twenty);
      const slope = gap - beta * logitGap;
      const curve = -beta * (1 / p + 1 / (1 - p));
      const step = slope / curve;
      const next = Math.min(1 - 1e-15, Math.max(1e-15, p - step));
      const moved = Math.abs(next - p);
      p = next;
      if (moved < 1e-14) break;
    }
    return { pi: { four: p, twenty: 1 - p }, iterations: iterations };
  }

  function optimizePolicy(scores, ref, beta) {
    if (!scores || !isFinite(scores.four) || !isFinite(scores.twenty)) throw new Error('Scores must be finite. An unbounded Bradley-Terry fit has no policy step.');
    assertRef(ref);
    if (!(beta === 0 || (beta > 0 && isFinite(beta)))) throw new Error('Beta must be 0 or a positive finite number.');
    let pi;
    let method;
    let iterations = 0;
    if (beta === 0) {
      pi = vertexPolicy(scores, ref);
      method = Math.abs(scores.four - scores.twenty) <= 1e-12 ? 'tie-keeps-reference' : 'vertex';
    } else if (!(ref.four > 0) || !(ref.twenty > 0)) {
      const id = ref.four > 0 ? 'four' : 'twenty';
      pi = { four: id === 'four' ? 1 : 0, twenty: id === 'twenty' ? 1 : 0 };
      method = 'support';
      const closed = tiltedReference(scores, ref, beta);
      if (Math.abs(closed.four - pi.four) > 1e-12) throw new Error('Support optimum disagreed with the tilted reference.');
    } else {
      const solved = newtonPolicy(scores, ref, beta);
      pi = solved.pi;
      iterations = solved.iterations;
      method = 'newton';
      const closed = tiltedReference(scores, ref, beta);
      if (Math.abs(closed.four - pi.four) > 1e-8) throw new Error('Newton optimum disagreed with the tilted reference.');
    }
    const value = objectiveValue(pi, scores, ref, beta);
    return {
      pi: pi,
      expectedReward: value.expectedReward,
      kl: value.kl,
      objective: value.objective,
      klInObjective: value.klInObjective,
      beta: beta,
      method: method,
      iterations: iterations,
      support: IDS.filter((id) => ref[id] > 0),
    };
  }

  const api = {
    IDS: IDS,
    ANSWERS: ANSWERS,
    PROMPT: PROMPT,
    PREFERENCES: PREFERENCES,
    REFERENCE: REFERENCE,
    HOLE: HOLE,
    languageModel: false,
    countsOf: countsOf,
    logLikelihood: logLikelihood,
    fitScores: fitScores,
    scaleScores: scaleScores,
    expectedReward: expectedReward,
    klDivergence: klDivergence,
    objectiveValue: objectiveValue,
    tiltedReference: tiltedReference,
    optimizePolicy: optimizePolicy,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  const root = typeof globalThis !== 'undefined' ? globalThis : this;
  root.BBPREFER = api;
  if (root.window) root.window.BBPREFER = api;
})();
