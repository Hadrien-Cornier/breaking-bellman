// Illustrative conservative imagined backup.
// Lecture 18 heading: "COMBO: Conservative Model-Based RL".
// The COMBO paper loss is not computed here.
// This file does not import mopo. The dataset and the hole live here.
// A model sample has a Bellman target. The backup adds that target and subtracts
// the coefficient times the total variation between the sampled action's one-hot
// frequency and the action frequencies in the data.
// Coefficient 0 returns the target, including off the data. No mask and no clamp.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBCOMBO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTIONS = ['stay', 'leap'];
  const HEADING = 'COMBO: Conservative Model-Based RL';
  const LECTURE = 18;
  const DISTANCE = 'total variation between the sampled action one-hot and the action frequencies in the data';
  const UNITS = {
    reward: 'return',
    nextValue: 'return',
    gamma: 'dimensionless',
    target: 'return',
    distance: 'dimensionless total variation',
    coefficient: 'return per unit total variation',
    penalty: 'return',
    value: 'return',
  };

  function copySample(sample) {
    return {
      state: sample.state,
      action: sample.action,
      reward: sample.reward,
      next: sample.next,
      nextValue: sample.nextValue,
      gamma: sample.gamma,
      terminal: !!sample.terminal,
    };
  }

  // Given model. Stay continues on the lane at 2. Leap continues in the hole at 6.
  function lessonSamples() {
    return [
      { state: 'start', action: 'stay', reward: 0, next: 'lane', nextValue: 2, gamma: 1, terminal: false },
      { state: 'start', action: 'leap', reward: 0, next: 'hole', nextValue: 6, gamma: 1, terminal: false },
    ];
  }

  function dataset(stayCount, leapCount) {
    if (!Number.isInteger(stayCount) || !Number.isInteger(leapCount) || stayCount < 0 || leapCount < 0) {
      throw new Error('counts must be non-negative integers');
    }
    if (stayCount + leapCount < 1) throw new Error('data needs at least one transition');
    const rows = [];
    for (let i = 0; i < stayCount; i++) rows.push({ state: 'start', action: 'stay', reward: 0, next: 'lane' });
    for (let i = 0; i < leapCount; i++) rows.push({ state: 'start', action: 'leap', reward: 0, next: 'hole' });
    return rows;
  }

  // Four stay transitions. The leap frequency is 0. That absence is the hole.
  function lessonData() { return dataset(4, 0); }

  function frequencies(data) {
    if (!Array.isArray(data) || data.length < 1) throw new Error('data needs at least one transition');
    const counts = { stay: 0, leap: 0 };
    data.forEach((row) => {
      if (!Object.prototype.hasOwnProperty.call(counts, row.action)) throw new Error('action must be stay or leap');
      counts[row.action] += 1;
    });
    const share = {};
    ACTIONS.forEach((action) => { share[action] = counts[action] / data.length; });
    return { total: data.length, counts: counts, share: share };
  }

  // One transition puts frequency 1 on the sampled action and 0 on the other.
  function sampleFrequency(action) {
    if (ACTIONS.indexOf(action) < 0) throw new Error('action must be stay or leap');
    const share = {};
    ACTIONS.forEach((name) => { share[name] = name === action ? 1 : 0; });
    return share;
  }

  // Half the L1 gap. With two actions this equals |1 - data frequency of the sampled action|.
  function distance(action, freq) {
    if (!freq || !(freq.total > 0) || !freq.share) throw new Error('distance needs data frequencies');
    const sampled = sampleFrequency(action);
    let sum = 0;
    ACTIONS.forEach((name) => { sum += Math.abs(sampled[name] - freq.share[name]); });
    return sum / 2;
  }

  function bellmanTarget(sample) {
    if (!sample || typeof sample.reward !== 'number' || !Number.isFinite(sample.reward)) {
      throw new Error('sample reward must be a finite number');
    }
    if (sample.terminal) return sample.reward;
    if (typeof sample.gamma !== 'number' || !Number.isFinite(sample.gamma)) throw new Error('gamma must be a finite number');
    if (typeof sample.nextValue !== 'number' || !Number.isFinite(sample.nextValue)) {
      throw new Error('next value must be a finite number');
    }
    return sample.reward + sample.gamma * sample.nextValue;
  }

  function backup(sample, data, coefficient) {
    if (typeof coefficient !== 'number' || !Number.isFinite(coefficient)) throw new Error('coefficient must be a finite number');
    if (coefficient < 0) throw new Error('coefficient must be >= 0');
    if (ACTIONS.indexOf(sample.action) < 0) throw new Error('action must be stay or leap');
    const freq = frequencies(data);
    const target = bellmanTarget(sample);
    const dist = distance(sample.action, freq);
    const penalty = coefficient * dist;
    return {
      action: sample.action,
      state: sample.state,
      next: sample.next,
      reward: sample.reward,
      gamma: sample.terminal ? null : sample.gamma,
      nextValue: sample.terminal ? null : sample.nextValue,
      terminal: !!sample.terminal,
      target: target,
      sampleFrequency: sampleFrequency(sample.action),
      dataFrequency: freq.share,
      distance: dist,
      coefficient: coefficient,
      penalty: penalty,
      value: target - penalty,
      units: UNITS,
    };
  }

  function plan(samples, data, coefficient) {
    if (!samples || !samples.length) throw new Error('plan needs a model sample');
    const rows = samples.map((sample) => backup(sample, data, coefficient));
    let best = rows[0];
    let tie = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].value > best.value) { best = rows[i]; tie = false; }
      else if (rows[i].value === best.value) tie = true;
    }
    if (tie) return { action: null, reason: 'tie', rows: rows };
    return { action: best.action, reason: 'max', rows: rows };
  }

  // Coefficient where the two lesson-sample values meet. Null when the distances match.
  function crossover(data) {
    const samples = lessonSamples();
    const stay = backup(samples[0], data, 0);
    const leap = backup(samples[1], data, 0);
    const gap = leap.distance - stay.distance;
    if (gap === 0) return null;
    return (leap.target - stay.target) / gap;
  }

  function study(data, coefficient) {
    const decided = plan(lessonSamples(), data, coefficient);
    const rows = {};
    decided.rows.forEach((row) => { rows[row.action] = row; });
    return {
      coefficient: coefficient,
      frequencies: frequencies(data),
      rows: rows,
      plan: { action: decided.action, reason: decided.reason },
      crossover: crossover(data),
      heading: HEADING,
      lecture: LECTURE,
      paperLoss: 'open',
      illustrative: true,
      distanceDefinition: DISTANCE,
      units: UNITS,
    };
  }

  return {
    ACTIONS: ACTIONS,
    HEADING: HEADING,
    LECTURE: LECTURE,
    DISTANCE: DISTANCE,
    UNITS: UNITS,
    lessonSamples: lessonSamples,
    dataset: dataset,
    lessonData: lessonData,
    frequencies: frequencies,
    sampleFrequency: sampleFrequency,
    distance: distance,
    bellmanTarget: bellmanTarget,
    backup: backup,
    plan: plan,
    crossover: crossover,
    study: study,
    copySample: copySample,
  };
});
