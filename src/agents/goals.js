// One-row hall. Two rooms. A count of the demonstrated action, with and without the room.
// This lesson does not participate in RLA.run. It does not import the lane / DAgger lesson.
(function () {
  'use strict';
  const LINE = ['west-room', 'west-hall', 'start', 'east-hall', 'east-room'];
  const ACTIONS = ['west', 'east']; // equal counts pick the first action, west
  const ROOMS = ['west-room', 'east-room'];

  function step(state, action) {
    const i = LINE.indexOf(state);
    if (i < 0) throw new Error('unknown state ' + state);
    if (action === 'west') {
      if (i === 0) throw new Error('west wall');
      return LINE[i - 1];
    }
    if (action === 'east') {
      if (i === LINE.length - 1) throw new Error('east wall');
      return LINE[i + 1];
    }
    throw new Error('unknown action ' + action);
  }

  function walk(goal, action) {
    if (!ROOMS.includes(goal)) throw new Error('unknown room ' + goal);
    if ((goal === 'west-room') !== (action === 'west')) throw new Error('demo action does not reach ' + goal);
    const rows = [];
    let state = 'start';
    for (let i = 0; i < 2; i++) {
      rows.push({ state, goal, action });
      state = step(state, action);
    }
    if (state !== goal) throw new Error('demo missed ' + goal);
    return rows;
  }

  function rowsFor(westEpisodes, eastEpisodes) {
    const rows = [];
    for (let i = 0; i < westEpisodes; i++) rows.push(...walk('west-room', 'west'));
    for (let i = 0; i < eastEpisodes; i++) rows.push(...walk('east-room', 'east'));
    return rows;
  }

  function lessonRows() { return rowsFor(3, 1); }

  // Two start rows, one of each action, plus the hall step that follows each.
  // The start counts tie. The hall rows do not.
  function tieRows() {
    return [
      { state: 'start', goal: 'west-room', action: 'west' },
      { state: 'west-hall', goal: 'west-room', action: 'west' },
      { state: 'start', goal: 'east-room', action: 'east' },
      { state: 'east-hall', goal: 'east-room', action: 'east' },
    ];
  }

  function emptyCounts() { return { west: 0, east: 0 }; }

  function modeAction(counts) {
    let best = ACTIONS[0];
    for (const action of ACTIONS) if (counts[action] > counts[best]) best = action;
    return best;
  }

  function logLikelihood(counts, probs) {
    let total = 0;
    for (const action of ACTIONS) {
      const n = counts[action] || 0;
      if (!n) continue;
      const p = probs[action];
      if (!(p > 0)) return -Infinity;
      total += n * Math.log(p);
    }
    return total;
  }

  function fit(rows, useGoal) {
    const buckets = new Map();
    for (const row of rows) {
      if (!LINE.includes(row.state)) throw new Error('unknown state ' + row.state);
      if (!ACTIONS.includes(row.action)) throw new Error('unknown action ' + row.action);
      if (useGoal && !ROOMS.includes(row.goal)) throw new Error('unknown room ' + row.goal);
      const key = useGoal ? row.state + ' | ' + row.goal : row.state;
      if (!buckets.has(key)) buckets.set(key, { key, state: row.state, goal: useGoal ? row.goal : null, counts: emptyCounts() });
      buckets.get(key).counts[row.action]++;
    }
    const table = [...buckets.values()].map((b) => {
      const total = b.counts.west + b.counts.east;
      const probs = {
        west: total ? b.counts.west / total : 0.5,
        east: total ? b.counts.east / total : 0.5,
      };
      return { ...b, total, probs, mode: modeAction(b.counts), logLikelihood: logLikelihood(b.counts, probs) };
    });
    function lookup(state, goal) {
      const key = useGoal ? state + ' | ' + goal : state;
      return table.find((r) => r.key === key) || {
        key, state, goal: useGoal ? goal : null, counts: emptyCounts(), total: 0,
        probs: { west: 0.5, east: 0.5 }, mode: ACTIONS[0], logLikelihood: 0,
      };
    }
    return {
      useGoal,
      table,
      choose(state, goal) {
        const row = lookup(state, goal);
        return { action: row.mode, key: row.key, counts: row.counts, probs: row.probs, total: row.total };
      },
    };
  }

  function rollout(fitted, goal) {
    if (!ROOMS.includes(goal)) throw new Error('unknown room ' + goal);
    const choices = [];
    const path = ['start'];
    let state = 'start';
    for (let i = 0; i < 2; i++) {
      const choice = fitted.choose(state, goal);
      choices.push({ state, goal, action: choice.action, counts: choice.counts, probs: choice.probs });
      state = step(state, choice.action);
      path.push(state);
    }
    return { path, choices, end: state, goal, arrived: state === goal, useGoal: fitted.useGoal };
  }

  const api = {
    LINE, ACTIONS, ROOMS, step, walk, rowsFor, lessonRows, tieRows,
    modeAction, logLikelihood, fit, rollout,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBGOALS = api;
})();
