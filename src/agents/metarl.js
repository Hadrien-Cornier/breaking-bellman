// Tabular cross-task adaptation. Two doors, two episodes, one count.
// The hidden door is read only by reward(). The fit reads executed rewards.
// A recurrent network, a meta-gradient, and learned exploration are not in this file.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBMETARL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTIONS = ['L', 'R'];
  const PROBE = 'L'; // given. Not a learned exploration policy.
  const ALPHA = 0; // no pseudo-counts. A missing cell stays unknown.

  // Training tasks. Episode 2's action is a fixed collection schedule, not the learned policy.
  // Four tasks pay on the left and two pay on the right, so a memoryless count has a majority.
  const TRAIN = [
    { id: 'train-L1', pay: 'L', second: 'L' },
    { id: 'train-L2', pay: 'L', second: 'L' },
    { id: 'train-L3', pay: 'L', second: 'R' },
    { id: 'train-L4', pay: 'L', second: 'R' },
    { id: 'train-R1', pay: 'R', second: 'R' },
    { id: 'train-R2', pay: 'R', second: 'L' },
  ];
  // Held-out ids are new. One task for each door. They are not a training row.
  const HELD = [
    { id: 'hold-L', pay: 'L' },
    { id: 'hold-R', pay: 'R' },
  ];

  function copyTask(task) {
    return { id: task.id, pay: task.pay, second: task.second };
  }

  function taskList() { return TRAIN.map(copyTask); }
  function heldList() { return HELD.map(copyTask); }

  // pay is the hidden door. 'none' and 'both' are distribution changes, not training tasks.
  function reward(pay, action) {
    if (ACTIONS.indexOf(action) < 0) throw new Error('action must be L or R');
    if (pay === 'none') return 0;
    if (pay === 'both') return 1;
    if (ACTIONS.indexOf(pay) < 0) throw new Error('hidden door must be L, R, none, or both');
    return action === pay ? 1 : 0;
  }

  function historyOf(episode) {
    return episode.action + ':' + episode.reward;
  }

  // One action, then the episode ends. The next episode starts over.
  function openDoor(pay, action) {
    return { action: action, reward: reward(pay, action), terminal: true };
  }

  function executeTask(task, secondAction) {
    const ep1 = openDoor(task.pay, PROBE);
    const ep2 = openDoor(task.pay, secondAction);
    return {
      id: task.id,
      pay: task.pay,
      history: historyOf(ep1),
      ep1: ep1,
      ep2: ep2,
    };
  }

  function executeTasks(tasks) {
    return tasks.map((task) => executeTask(task, task.second));
  }

  function cloneRecords(records) {
    return records.map((rec) => ({
      id: rec.id,
      pay: rec.pay,
      history: rec.history,
      ep1: { action: rec.ep1.action, reward: rec.ep1.reward, terminal: true },
      ep2: { action: rec.ep2.action, reward: rec.ep2.reward, terminal: true },
    }));
  }

  // Edits the stored episode-2 reward. It does not open the door again.
  function withReward(records, id, nextReward) {
    if (nextReward !== 0 && nextReward !== 1) throw new Error('stored reward must be 0 or 1');
    let found = false;
    const out = cloneRecords(records).map((rec) => {
      if (rec.id !== id) return rec;
      found = true;
      rec.ep2.reward = nextReward;
      return rec;
    });
    if (!found) throw new Error('no training record ' + id);
    return out;
  }

  // Every training task pays on the left, then the episodes are executed again.
  function retargetLeft(tasks) {
    return tasks.map((task) => ({ id: task.id, pay: 'L', second: task.second }));
  }

  function fit(records, opts) {
    const alpha = opts && opts.alpha != null ? opts.alpha : ALPHA;
    if (alpha < 0 || alpha !== Math.floor(alpha)) throw new Error('alpha must be a non-negative integer');
    const conditionOnHistory = !opts || opts.conditionOnHistory !== false;
    const dropCounts = !!(opts && opts.dropCounts);
    const table = {};
    let updates = 0;
    if (!dropCounts) {
      records.forEach((rec) => {
        if (ACTIONS.indexOf(rec.ep2.action) < 0) throw new Error('episode-2 action must be L or R');
        if (rec.ep2.reward !== 0 && rec.ep2.reward !== 1) throw new Error('episode-2 reward must be 0 or 1');
        const history = conditionOnHistory ? rec.history : '*';
        const key = history + '|' + rec.ep2.action;
        if (!table[key]) table[key] = { history: history, action: rec.ep2.action, n: 0, s: 0 };
        table[key].n += 1;
        table[key].s += rec.ep2.reward;
        updates += 1;
      });
    }
    function rate(history, action) {
      const key = (conditionOnHistory ? history : '*') + '|' + action;
      const cell = table[key];
      const n = cell ? cell.n : 0;
      const s = cell ? cell.s : 0;
      if (alpha === 0 && n === 0) return null;
      return { s: s, n: n, alpha: alpha };
    }
    return {
      table: table,
      updates: updates,
      alpha: alpha,
      conditionOnHistory: conditionOnHistory,
      dropped: dropCounts,
      rate: rate,
    };
  }

  // Positive when the first rate is larger. Integer cross-multiply, including the Beta(alpha, alpha) prior.
  function cmpRate(a, b) {
    const denA = a.n + 2 * a.alpha;
    const denB = b.n + 2 * b.alpha;
    return (a.s + a.alpha) * denB - (b.s + b.alpha) * denA;
  }

  function decide(fitted, history) {
    const keyHistory = fitted.conditionOnHistory ? history : '*';
    const scored = ACTIONS.map((action) => ({ action: action, rate: fitted.rate(history, action) }));
    const known = scored.filter((row) => row.rate != null);
    if (!known.length) return { action: null, reason: 'unknown', history: keyHistory, scored: scored };
    let best = known[0];
    let tie = false;
    for (let i = 1; i < known.length; i++) {
      const cmp = cmpRate(known[i].rate, best.rate);
      if (cmp > 0) { best = known[i]; tie = false; }
      else if (cmp === 0) tie = true;
    }
    if (tie) return { action: null, reason: 'tie', history: keyHistory, scored: scored };
    return { action: best.action, reason: 'mode', history: keyHistory, scored: scored, rate: best.rate };
  }

  function evaluate(fitted, tasks) {
    const rows = tasks.map((task) => {
      const ep1 = openDoor(task.pay, PROBE);
      const history = historyOf(ep1);
      const choice = decide(fitted, history);
      const ep2 = choice.action == null ? null : openDoor(task.pay, choice.action);
      return { id: task.id, pay: task.pay, history: history, ep1: ep1, choice: choice, ep2: ep2 };
    });
    const decided = rows.filter((row) => row.ep2);
    const expectation = decided.length === rows.length && rows.length
      ? { successes: decided.reduce((sum, row) => sum + row.ep2.reward, 0), tasks: rows.length }
      : null;
    return {
      rows: rows,
      expectation: expectation,
      observations: rows.length,
      decisions: decided.length,
      updates: 0,
      interactions: rows.length + decided.length,
    };
  }

  // Exact average of every door on every listed task. No draw.
  function uniformExpectation(tasks) {
    let successes = 0;
    let trials = 0;
    tasks.forEach((task) => {
      ACTIONS.forEach((action) => {
        successes += reward(task.pay, action);
        trials += 1;
      });
    });
    return { successes: successes, trials: trials };
  }

  // Opens both doors on this task and keeps the one that paid. It does not read a fit.
  function tryBothCopyWinner(pay) {
    const scored = ACTIONS.map((action) => ({ action: action, reward: reward(pay, action) }));
    const best = Math.max.apply(null, scored.map((row) => row.reward));
    const winners = scored.filter((row) => row.reward === best);
    if (winners.length !== 1) return { action: null, reason: 'tie', readsCounts: false, queries: scored.length };
    return { action: winners[0].action, reason: 'heldout-reward', readsCounts: false, queries: scored.length };
  }

  function idMemory(records) {
    const table = {};
    records.forEach((rec) => {
      [rec.ep1, rec.ep2].forEach((episode) => {
        if (episode.reward === 1) table[rec.id] = episode.action;
      });
    });
    return table;
  }

  function snapshot(fitted, histories) {
    const rows = histories || (fitted.conditionOnHistory ? ['L:1', 'L:0'] : ['*']);
    return rows.map((history) => ({
      history: history,
      actions: ACTIONS.map((action) => {
        const cell = fitted.table[(fitted.conditionOnHistory ? history : '*') + '|' + action];
        return {
          action: action,
          n: cell ? cell.n : 0,
          s: cell ? cell.s : 0,
          rate: fitted.rate(history, action),
        };
      }),
      decision: decide(fitted, history),
    }));
  }

  function study(records, heldTasks) {
    const held = heldTasks || heldList();
    const history = fit(records, { conditionOnHistory: true, alpha: ALPHA });
    const memoryless = fit(records, { conditionOnHistory: false, alpha: ALPHA });
    const deleted = fit(records, { conditionOnHistory: true, alpha: ALPHA, dropCounts: true });
    const copyRows = held.map((task) => {
      const pick = tryBothCopyWinner(task.pay);
      return {
        id: task.id,
        action: pick.action,
        reward: pick.action == null ? null : reward(task.pay, pick.action),
        queries: pick.queries,
      };
    });
    return {
      probe: PROBE,
      alpha: ALPHA,
      init: 'zero counts',
      tie: 'equal rates return no action; a history with no counts is unknown',
      given: ['left-door probe', 'training second-action schedule', 'alpha 0', 'two-episode horizon'],
      learned: 'episode-2 success counts conditioned on the episode-1 record',
      open: ['a recurrent network', 'a meta-gradient', 'learned exploration'],
      trainingInteractions: records.length * 2,
      trainingUpdates: history.updates,
      heldoutObservations: held.length,
      heldoutUpdates: 0,
      history: history,
      memoryless: memoryless,
      deleted: deleted,
      heldHistory: evaluate(history, held),
      heldMemory: evaluate(memoryless, held),
      heldDeleted: evaluate(deleted, held),
      uniform: uniformExpectation(held),
      ids: idMemory(records),
      unsupported: decide(history, 'R:1'),
      none: evaluate(history, [{ id: 'hold-none', pay: 'none' }]),
      copy: {
        readsCounts: false,
        queries: copyRows.reduce((sum, row) => sum + row.queries, 0),
        successes: copyRows.reduce((sum, row) => sum + (row.reward || 0), 0),
        tasks: copyRows.length,
        rows: copyRows,
      },
    };
  }

  function collectDefault() {
    const tasks = taskList();
    const records = executeTasks(tasks);
    return {
      tasks: tasks,
      held: heldList(),
      records: records,
      study: study(records, heldList()),
    };
  }

  return {
    ACTIONS: ACTIONS,
    PROBE: PROBE,
    ALPHA: ALPHA,
    taskList: taskList,
    heldList: heldList,
    reward: reward,
    historyOf: historyOf,
    executeTask: executeTask,
    executeTasks: executeTasks,
    cloneRecords: cloneRecords,
    withReward: withReward,
    retargetLeft: retargetLeft,
    fit: fit,
    cmpRate: cmpRate,
    decide: decide,
    evaluate: evaluate,
    uniformExpectation: uniformExpectation,
    tryBothCopyWinner: tryBothCopyWinner,
    idMemory: idMemory,
    snapshot: snapshot,
    study: study,
    collectDefault: collectDefault,
  };
});
