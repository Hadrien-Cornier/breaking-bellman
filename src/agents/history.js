// Action counts at one junction. The previous room is part of the key, or it is not.
// Same demonstrated transitions either way. This is not a network and it does not import another lesson.
(function () {
  'use strict';

  const ACTIONS = ['west', 'east']; // equal counts pick the first action in this list
  const WEST_DOOR = 'west-door';
  const EAST_DOOR = 'east-door';
  const WEST_LANE = 'west-lane';
  const EAST_LANE = 'east-lane';
  const JUNCTION = 'junction';
  const WEST_EXIT = 'west-exit';
  const EAST_EXIT = 'east-exit';
  const ARRIVALS = [WEST_LANE, EAST_LANE];
  const CURRENTS = [WEST_LANE, EAST_LANE, JUNCTION];
  const PREVIOUS = [WEST_DOOR, EAST_DOOR, WEST_LANE, EAST_LANE];
  const PER_ARRIVAL = 2;

  const SOURCE = {
    slides: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-3.pdf',
    heading: 'How can we use the whole history?',
    note: 'That heading is used for a separate weight on each frame, and again for a sequence model with shared weights. This page is a count of one previous room.',
  };

  const LIMITS = [
    'One previous room suffices only for this toy junction.',
    'Erasing the previous room aliases the two arrivals into one tie.',
    'A longer hidden room can still alias under this one-room window.',
    'This count is not a recurrent network and not a pretrained network.',
    'Copying these notes is not meta-RL reward adaptation.',
    'This is not DAgger and not a requested goal.',
  ];

  function step(state, action) {
    if (!ACTIONS.includes(action)) throw new Error('unknown action ' + action);
    if (state === WEST_DOOR && action === 'east') return WEST_LANE;
    if (state === WEST_LANE && action === 'east') return JUNCTION;
    if (state === EAST_DOOR && action === 'west') return EAST_LANE;
    if (state === EAST_LANE && action === 'west') return JUNCTION;
    if (state === JUNCTION && action === 'west') return WEST_EXIT;
    if (state === JUNCTION && action === 'east') return EAST_EXIT;
    throw new Error('illegal ' + state + ' ' + action);
  }

  function episode(arrival) {
    if (arrival === 'west') {
      return [
        { previous: WEST_DOOR, current: WEST_LANE, action: 'east' },
        { previous: WEST_LANE, current: JUNCTION, action: 'west' },
      ];
    }
    if (arrival === 'east') {
      return [
        { previous: EAST_DOOR, current: EAST_LANE, action: 'west' },
        { previous: EAST_LANE, current: JUNCTION, action: 'east' },
      ];
    }
    throw new Error('unknown arrival ' + arrival);
  }

  function rowsFor(westEpisodes, eastEpisodes) {
    if (!Number.isInteger(westEpisodes) || westEpisodes < 0) throw new Error('west episodes');
    if (!Number.isInteger(eastEpisodes) || eastEpisodes < 0) throw new Error('east episodes');
    const rows = [];
    for (let i = 0; i < westEpisodes; i++) rows.push(...episode('west'));
    for (let i = 0; i < eastEpisodes; i++) rows.push(...episode('east'));
    return rows;
  }

  function lessonRows() { return rowsFor(PER_ARRIVAL, PER_ARRIVAL); }

  // Same previous room and junction, two earlier rooms, two actions. A one-room window ties.
  function longerAliasRows() {
    return [
      { earlier: 'north-door', previous: WEST_LANE, current: JUNCTION, action: 'west' },
      { earlier: 'south-door', previous: WEST_LANE, current: JUNCTION, action: 'east' },
    ];
  }

  function emptyCounts() {
    const counts = {};
    for (const action of ACTIONS) counts[action] = 0;
    return counts;
  }

  function modeOf(counts) {
    let max = null;
    for (const action of ACTIONS) {
      const n = counts[action] || 0;
      if (max === null || n > max) max = n;
    }
    const winners = ACTIONS.filter((action) => (counts[action] || 0) === max);
    return { action: winners[0], tie: winners.length > 1, winners: winners.slice() };
  }

  function swapActions(rows) {
    const map = {};
    map[ACTIONS[0]] = ACTIONS[1];
    map[ACTIONS[1]] = ACTIONS[0];
    return rows.map((row) => {
      if (!map[row.action]) throw new Error('unknown action ' + row.action);
      return Object.assign({}, row, { action: map[row.action] });
    });
  }

  function dropPrevious(rows) {
    return rows.map((row) => ({ current: row.current, action: row.action }));
  }

  function fit(rows, usePrevious) {
    const buckets = new Map();
    for (const row of rows) {
      if (!CURRENTS.includes(row.current)) throw new Error('unknown room ' + row.current);
      if (!ACTIONS.includes(row.action)) throw new Error('unknown action ' + row.action);
      if (usePrevious) {
        if (!row.previous) throw new Error('missing previous room');
        if (!PREVIOUS.includes(row.previous)) throw new Error('unknown previous ' + row.previous);
      }
      const key = usePrevious ? row.previous + ' | ' + row.current : row.current;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key: key,
          current: row.current,
          previous: usePrevious ? row.previous : null,
          counts: emptyCounts(),
        });
      }
      buckets.get(key).counts[row.action]++;
    }
    const table = [...buckets.values()].map((bucket) => {
      const total = ACTIONS.reduce((sum, action) => sum + bucket.counts[action], 0);
      const decided = modeOf(bucket.counts);
      return {
        key: bucket.key,
        current: bucket.current,
        previous: bucket.previous,
        counts: bucket.counts,
        total: total,
        mode: decided.action,
        tie: decided.tie,
      };
    });
    function lookup(current, previous) {
      const key = usePrevious ? previous + ' | ' + current : current;
      return table.find((row) => row.key === key) || {
        key: key,
        current: current,
        previous: usePrevious ? previous : null,
        counts: emptyCounts(),
        total: 0,
        mode: ACTIONS[0],
        tie: true,
      };
    }
    return {
      usePrevious: !!usePrevious,
      budget: rows.length,
      table: table,
      lookup: lookup,
      choose(current, previous) {
        const row = lookup(current, previous);
        return {
          action: row.mode,
          tie: row.tie,
          key: row.key,
          counts: Object.assign({}, row.counts),
          total: row.total,
          usePrevious: !!usePrevious,
        };
      },
    };
  }

  function demonstratedAction(rows, previous) {
    const hits = rows.filter((row) => row.previous === previous && row.current === JUNCTION);
    if (!hits.length) throw new Error('no demonstration from ' + previous);
    const counts = emptyCounts();
    for (const row of hits) counts[row.action]++;
    const decided = modeOf(counts);
    if (decided.tie) throw new Error('arrival demonstrations tie');
    return decided.action;
  }

  function follows(policy, rows, previous) {
    return policy.choose(JUNCTION, previous).action === demonstratedAction(rows, previous);
  }

  function constantPolicy(action) {
    if (!ACTIONS.includes(action)) throw new Error('unknown action ' + action);
    return {
      choose() {
        return { action: action, tie: false, key: 'constant', counts: null, total: 0, usePrevious: false };
      },
    };
  }

  function play(policy, previous) {
    const choice = policy.choose(JUNCTION, previous);
    return {
      previous: previous,
      current: JUNCTION,
      action: choice.action,
      end: step(JUNCTION, choice.action),
      tie: !!choice.tie,
      counts: choice.counts,
    };
  }

  const api = {
    ACTIONS, WEST_DOOR, EAST_DOOR, WEST_LANE, EAST_LANE, JUNCTION, WEST_EXIT, EAST_EXIT,
    ARRIVALS, PER_ARRIVAL, SOURCE, LIMITS,
    step, episode, rowsFor, lessonRows, longerAliasRows, modeOf, swapActions, dropPrevious,
    fit, demonstratedAction, follows, constantPolicy, play,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBHISTORY = api;
})();
