// Discrete posterior over two payloads from a fitted observation table.
// Training records name the payload. A query is only a history of observations.
// This is not a neural state-space model and it does not replan a corridor.
(function () {
  'use strict';

  const PAYLOADS = ['copper', 'glass'];
  const MARK = 'sealed';
  const PROBES = ['red', 'blue', 'green'];

  function clone(records) {
    return records.map((rec) => ({ payload: rec.payload, observations: rec.observations.slice() }));
  }

  function pair(left, right) {
    return [
      { payload: 'copper', observations: ['sealed', left] },
      { payload: 'copper', observations: ['sealed', left] },
      { payload: 'glass', observations: ['sealed', right] },
      { payload: 'glass', observations: ['sealed', right] },
    ];
  }

  const LESSON_RECORDS = pair('red', 'blue');
  const AMBIGUOUS_RECORDS = pair('red', 'red');
  const UNSEEN_RECORDS = pair('blue', 'blue');

  function lessonRecords() { return clone(LESSON_RECORDS); }
  function ambiguousRecords() { return clone(AMBIGUOUS_RECORDS); }
  function unseenRecords() { return clone(UNSEEN_RECORDS); }

  function swapObservations(records, left, right) {
    return clone(records).map((rec) => ({
      payload: rec.payload,
      observations: rec.observations.map((obs) => (obs === left ? right : obs === right ? left : obs)),
    }));
  }

  function swapPayloadNames(records) {
    const names = [];
    for (const rec of records) if (!names.includes(rec.payload)) names.push(rec.payload);
    if (names.length < 2) throw new Error('need two payloads to swap');
    const map = {};
    map[names[0]] = names[1];
    map[names[1]] = names[0];
    return clone(records).map((rec) => ({ payload: map[rec.payload], observations: rec.observations }));
  }

  function fit(records) {
    if (!Array.isArray(records) || records.length === 0) throw new Error('need observation records');
    const payloads = [];
    const counts = {};
    const totals = {};
    for (const rec of records) {
      if (!rec || typeof rec.payload !== 'string' || rec.payload === '') throw new Error('record needs a payload');
      if (!Array.isArray(rec.observations) || rec.observations.length === 0) throw new Error('record needs observations');
      if (!payloads.includes(rec.payload)) payloads.push(rec.payload);
      if (!counts[rec.payload]) {
        counts[rec.payload] = {};
        totals[rec.payload] = 0;
      }
      totals[rec.payload] += 1;
      const seen = {};
      for (const obs of rec.observations) {
        if (typeof obs !== 'string' || obs === '') throw new Error('observation must be a string');
        if (seen[obs]) throw new Error('repeat an observation once per record');
        seen[obs] = true;
        counts[rec.payload][obs] = (counts[rec.payload][obs] || 0) + 1;
      }
    }
    if (payloads.length < 2) throw new Error('need at least two payloads');
    return { payloads, counts, totals };
  }

  function historyOf(probe) {
    if (probe == null || probe === MARK) return [MARK];
    if (typeof probe !== 'string' || probe === '') throw new Error('probe must be a string');
    return [MARK, probe];
  }

  // Uniform prior. An observation with count 0 on every payload is skipped.
  // The third argument is accepted and ignored: a payload id is not an input.
  function recommend(records, history, handed) {
    void handed;
    const table = records && records.payloads ? records : fit(records);
    if (!Array.isArray(history)) throw new Error('history must be a list of observations');
    const weights = {};
    for (const payload of table.payloads) weights[payload] = 1;
    const skipped = [];
    for (const obs of history) {
      if (typeof obs !== 'string' || obs === '') throw new Error('history observations must be strings');
      let supported = false;
      for (const payload of table.payloads) {
        if ((table.counts[payload][obs] || 0) > 0) supported = true;
      }
      if (!supported) {
        skipped.push(obs);
        continue;
      }
      for (const payload of table.payloads) {
        weights[payload] *= (table.counts[payload][obs] || 0) / table.totals[payload];
      }
    }
    let sum = 0;
    for (const payload of table.payloads) sum += weights[payload];
    const posterior = {};
    const mixed = !(sum > 0);
    for (const payload of table.payloads) {
      posterior[payload] = mixed ? 1 / table.payloads.length : weights[payload] / sum;
    }
    let best = -1;
    const winners = [];
    for (const payload of table.payloads) {
      const value = posterior[payload];
      if (value > best + 1e-12) {
        best = value;
        winners.length = 0;
        winners.push(payload);
      } else if (Math.abs(value - best) <= 1e-12) winners.push(payload);
    }
    const tie = winners.length !== 1;
    return {
      payloads: table.payloads.slice(),
      posterior,
      commit: tie ? null : winners[0],
      tie,
      history: history.slice(),
      skipped,
      mixed,
    };
  }

  function associated(records, observation) {
    const table = fit(records);
    let best = 0;
    const winners = [];
    for (const payload of table.payloads) {
      const count = table.counts[payload][observation] || 0;
      if (count > best) {
        best = count;
        winners.length = 0;
        winners.push(payload);
      } else if (count === best && count > 0) winners.push(payload);
    }
    if (winners.length !== 1) return null;
    return winners[0];
  }

  function copyMark(history) {
    if (!Array.isArray(history) || history.length === 0) return null;
    return history[history.length - 1];
  }

  // The failing planner. It names whatever payload it was handed.
  function oracleCommit(payload) {
    if (typeof payload !== 'string' || payload === '') return null;
    return payload;
  }

  function counts(records, observation) {
    const table = fit(records);
    const out = {};
    for (const payload of table.payloads) {
      out[payload] = {
        count: table.counts[payload][observation] || 0,
        total: table.totals[payload],
      };
    }
    return out;
  }

  const api = {
    PAYLOADS, MARK, PROBES,
    lessonRecords, ambiguousRecords, unseenRecords,
    swapObservations, swapPayloadNames, historyOf, fit, recommend, associated, copyMark, oracleCommit, counts,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBLATENT = api;
})();
