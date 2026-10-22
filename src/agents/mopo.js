// Penalty on two fixed reward tables. No dynamics training and no new transitions.
// This file does not import another lesson.
(function () {
  'use strict';

  const IDS = ['home', 'hole', 'span'];
  const ENVIRONMENT = {
    home: { id: 'home', name: 'Home', inDataset: true, trueReward: 1 },
    hole: { id: 'hole', name: 'Hole', inDataset: false, trueReward: 0 },
    span: { id: 'span', name: 'Span', inDataset: false, trueReward: 3 },
  };
  const LESSON_MODELS = {
    home: { modelA: 1, modelB: 1 },
    hole: { modelA: 8, modelB: 0 },
    span: { modelA: 3, modelB: 3 },
  };
  const LESSON_COEFFICIENT = 1;
  const UNITS = {
    reward: 'reward points',
    disagreement: 'reward points',
    penalty: 'reward points',
    score: 'reward points',
    coefficient: 'reward points of penalty per reward point of absolute disagreement',
  };
  const FORMULA = 'mean reward points - coefficient * absolute disagreement reward points';
  const POLICIES = ['penalty', 'average', 'mask'];

  function fail(error) {
    return {
      ok: false,
      error: error,
      learnedDynamics: false,
      uncertaintyEstimator: null,
      comboLoss: false,
      fixedTables: true,
      datasetFrozen: true,
      canCollect: false,
      newTransitions: 0,
      plans: null,
      action: null,
    };
  }

  function parseNumber(value, label) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { error: label + ' is not a finite number' };
      return { value: value };
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { error: label + ' is not a finite number' };
      return { value: parsed };
    }
    return { error: label + ' is missing' };
  }

  function readModels(input) {
    const source = input || LESSON_MODELS;
    const models = {};
    for (const id of IDS) {
      const cell = source[id];
      if (!cell) return { error: 'missing model table for ' + id };
      const modelA = parseNumber(cell.modelA, id + ' model A');
      if (modelA.error) return modelA;
      const modelB = parseNumber(cell.modelB, id + ' model B');
      if (modelB.error) return modelB;
      models[id] = { modelA: modelA.value, modelB: modelB.value };
    }
    return { models: models };
  }

  function readEnvironment(input) {
    const environment = {};
    for (const id of IDS) {
      const base = ENVIRONMENT[id];
      const over = input && input[id] ? input[id] : {};
      const trueReward = parseNumber(over.trueReward == null ? base.trueReward : over.trueReward, id + ' true reward');
      if (trueReward.error) return trueReward;
      environment[id] = {
        id: id,
        name: base.name,
        inDataset: over.inDataset == null ? base.inDataset : !!over.inDataset,
        trueReward: trueReward.value,
      };
    }
    return { environment: environment };
  }

  function scoreRow(id, models, coefficient) {
    const modelA = models[id].modelA;
    const modelB = models[id].modelB;
    const mean = (modelA + modelB) / 2;
    const disagreement = Math.abs(modelA - modelB);
    return {
      id: id,
      modelA: modelA,
      modelB: modelB,
      mean: mean,
      disagreement: disagreement,
      penalty: coefficient * disagreement,
      score: mean - coefficient * disagreement,
      coefficient: coefficient,
    };
  }

  function decorate(row, environment) {
    const cell = environment[row.id];
    return {
      id: row.id,
      name: cell.name,
      inDataset: cell.inDataset,
      trueReward: cell.trueReward,
      modelA: row.modelA,
      modelB: row.modelB,
      mean: row.mean,
      disagreement: row.disagreement,
      penalty: row.penalty,
      score: row.score,
      coefficient: row.coefficient,
    };
  }

  function byId(a, b) {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  function comparePenalty(a, b) {
    if (a.score !== b.score) return b.score - a.score;
    if (a.disagreement !== b.disagreement) return a.disagreement - b.disagreement;
    if (a.mean !== b.mean) return b.mean - a.mean;
    return byId(a, b);
  }

  function compareMean(a, b) {
    if (a.mean !== b.mean) return b.mean - a.mean;
    return byId(a, b);
  }

  function summarize(rows, ranked) {
    const top = ranked[0] || null;
    return {
      chosen: top ? top.id : null,
      trueReward: top ? top.trueReward : null,
      mean: top ? top.mean : null,
      disagreement: top ? top.disagreement : null,
      score: top ? top.score : null,
      rows: rows,
    };
  }

  function plan(spec) {
    const input = spec || {};
    const policy = input.policy || 'penalty';
    if (POLICIES.indexOf(policy) < 0) return fail('policy must be penalty, average, or mask');
    const coefficient = parseNumber(input.coefficient == null ? LESSON_COEFFICIENT : input.coefficient, 'coefficient');
    if (coefficient.error) return fail(coefficient.error);
    if (coefficient.value < 0) return fail('coefficient must be 0 or greater');
    const models = readModels(input.models);
    if (models.error) return fail(models.error);
    const environment = readEnvironment(input.environment);
    if (environment.error) return fail(environment.error);

    const penaltyRows = IDS.map((id) => decorate(scoreRow(id, models.models, coefficient.value), environment.environment));
    const averageRows = IDS.map((id) => decorate(scoreRow(id, models.models, 0), environment.environment));
    const penalty = summarize(penaltyRows, penaltyRows.slice().sort(comparePenalty));
    const average = summarize(averageRows, averageRows.slice().sort(compareMean));
    const maskRows = averageRows.filter((row) => environment.environment[row.id].inDataset);
    const maskRanked = maskRows.slice().sort(compareMean);
    const mask = summarize(averageRows, maskRanked);
    mask.candidates = maskRows.map((row) => row.id);
    mask.refused = IDS.filter((id) => mask.candidates.indexOf(id) < 0);

    const plans = { penalty: penalty, average: average, mask: mask };
    return {
      ok: true,
      error: '',
      policy: policy,
      coefficient: coefficient.value,
      units: UNITS,
      formula: FORMULA,
      learnedDynamics: false,
      uncertaintyEstimator: null,
      comboLoss: false,
      fixedTables: true,
      datasetFrozen: true,
      canCollect: false,
      newTransitions: 0,
      models: models.models,
      environment: environment.environment,
      plans: plans,
      action: plans[policy],
    };
  }

  function dataset() {
    return {
      frozen: true,
      canCollect: false,
      newTransitions: 0,
      cells: IDS.map((id) => ({
        id: id,
        name: ENVIRONMENT[id].name,
        inDataset: ENVIRONMENT[id].inDataset,
        trueReward: ENVIRONMENT[id].trueReward,
      })),
    };
  }

  const api = {
    IDS: IDS,
    ENVIRONMENT: ENVIRONMENT,
    LESSON_MODELS: LESSON_MODELS,
    LESSON_COEFFICIENT: LESSON_COEFFICIENT,
    UNITS: UNITS,
    FORMULA: FORMULA,
    plan: plan,
    dataset: dataset,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBMOPO = api;
})();
