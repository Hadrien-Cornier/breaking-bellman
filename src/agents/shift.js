// Deterministic lane for one behavioral-cloning failure and one DAgger round.
// No network, no seed, and no cached training result.
(function () {
  'use strict';

  const LANE = [-1, 0, 1];
  // The shared player script. The perturbation is the start at +1.
  // Extra shoves stay zero before and after aggregation.
  const PLAYER_SCHEDULE = Object.freeze({
    id: 'slip-start',
    start: 1,
    horizon: 4,
    slips: Object.freeze([0, 0, 0, 0]),
  });
  const CENTER_SCHEDULE = Object.freeze({
    id: 'center',
    start: 0,
    horizon: 4,
    slips: Object.freeze([0, 0, 0, 0]),
  });
  // Locked traces for slip-start. A different shove list is a different experiment.
  const OUTCOME = Object.freeze({
    demoSupport: Object.freeze([0]),
    centerPositions: Object.freeze([0, 0, 0, 0, 0]),
    beforePositions: Object.freeze([1, 1, 1, 1, 1]),
    beforeActions: Object.freeze([0, 0, 0, 0]),
    added: Object.freeze([Object.freeze({ state: 1, action: -1 })]),
    afterPositions: Object.freeze([1, 0, 0, 0, 0]),
    afterActions: Object.freeze([-1, 0, 0, 0]),
    unlabeledState: -1,
    unlabeledAction: 0,
  });

  function clamp(position) {
    return Math.max(-2, Math.min(2, position));
  }

  function expertAction(position) {
    if (position > 0) return -1;
    if (position < 0) return 1;
    return 0;
  }

  function step(position, action, slip) {
    const next = clamp(position + action + (slip || 0));
    return { position: next, failed: next === -2 || next === 2 };
  }

  function supportOf(pairs) {
    return [...new Set(pairs.map((pair) => pair.state))].sort((a, b) => a - b);
  }

  function countsOf(pairs) {
    const counts = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
    for (const pair of pairs) counts[String(pair.state)] = (counts[String(pair.state)] || 0) + 1;
    return counts;
  }

  function demonstrate() {
    const pairs = [];
    let position = 0;
    for (let t = 0; t < CENTER_SCHEDULE.horizon; t++) {
      const action = expertAction(position);
      pairs.push({ state: position, action });
      position = step(position, action, 0).position;
    }
    return { pairs, support: supportOf(pairs), counts: countsOf(pairs) };
  }

  // On a recorded state, play the recorded action. On any other state, hold.
  function clone(pairs) {
    const counts = new Map();
    for (const pair of pairs) {
      if (!counts.has(pair.state)) counts.set(pair.state, new Map());
      const actions = counts.get(pair.state);
      actions.set(pair.action, (actions.get(pair.action) || 0) + 1);
    }
    const known = {};
    for (const [state, actions] of counts) {
      let bestAction = null;
      let bestCount = -1;
      for (const [action, count] of actions) {
        if (count > bestCount || (count === bestCount && action < bestAction)) {
          bestAction = action;
          bestCount = count;
        }
      }
      known[state] = bestAction;
    }
    function action(state) {
      return Object.prototype.hasOwnProperty.call(known, state) ? known[state] : 0;
    }
    action.known = known;
    action.hold = 0;
    return action;
  }

  function sameSchedule(trace, schedule) {
    return !!trace && !!schedule
      && trace.start === schedule.start
      && trace.slips.length === schedule.horizon
      && schedule.slips.length === schedule.horizon
      && trace.slips.every((slip, index) => slip === schedule.slips[index]);
  }

  function rollout(policy, schedule) {
    if (!schedule || !schedule.slips || schedule.slips.length !== schedule.horizon) {
      throw new Error('slip schedule length must equal horizon');
    }
    const slips = schedule.slips.slice();
    const positions = [schedule.start];
    const actions = [];
    const queried = [];
    let position = schedule.start;
    let failedAt = position === -2 || position === 2 ? 0 : null;
    if (failedAt === null) {
      for (let t = 0; t < schedule.horizon; t++) {
        const action = policy(position);
        actions.push(action);
        if (position >= -1 && position <= 1) queried.push(position);
        const moved = step(position, action, slips[t]);
        position = moved.position;
        positions.push(position);
        if (moved.failed) {
          failedAt = t + 1;
          break;
        }
      }
    }
    return {
      scheduleId: schedule.id,
      start: schedule.start,
      horizon: schedule.horizon,
      slips,
      positions,
      actions,
      visitedLane: [...new Set(queried)].sort((a, b) => a - b),
      failed: failedAt !== null,
      failedAt,
      end: positions[positions.length - 1],
    };
  }

  // One round: expert labels for lane states this rollout visited. Other states stay unlabeled.
  function aggregate(pairs, trace) {
    const added = [];
    for (const state of trace.visitedLane) {
      if (!LANE.includes(state)) continue;
      added.push({ state, action: expertAction(state) });
    }
    const next = pairs.concat(added);
    return { pairs: next, added, policy: clone(next), support: supportOf(next) };
  }

  function lesson() {
    const demo = demonstrate();
    const initial = clone(demo.pairs);
    const center = rollout(initial, CENTER_SCHEDULE);
    const before = rollout(initial, PLAYER_SCHEDULE);
    const aggregated = aggregate(demo.pairs, before);
    const after = rollout(aggregated.policy, PLAYER_SCHEDULE);
    return { demo, initial, center, before, aggregated, after, policy: aggregated.policy };
  }

  const api = {
    LANE, PLAYER_SCHEDULE, CENTER_SCHEDULE, OUTCOME,
    expertAction, step, demonstrate, clone, rollout, aggregate, sameSchedule, lesson,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBSHIFT = api;
})();
