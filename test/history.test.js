'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/agents/history.js');

function recount(rows, usePrevious, previous) {
  const counts = {};
  for (const action of H.ACTIONS) counts[action] = 0;
  for (const row of rows) {
    if (row.current !== H.JUNCTION) continue;
    if (usePrevious && row.previous !== previous) continue;
    counts[row.action]++;
  }
  let max = -1;
  for (const action of H.ACTIONS) if (counts[action] > max) max = counts[action];
  const winners = H.ACTIONS.filter((action) => counts[action] === max);
  return { counts, action: winners[0], tie: winners.length > 1 };
}

test('both fits read the same junction notes and the same budget', () => {
  const rows = H.lessonRows();
  const current = H.fit(rows, false);
  const history = H.fit(rows, true);
  assert.equal(current.budget, rows.length);
  assert.equal(history.budget, current.budget);
  assert.equal(rows.filter((row) => row.current === H.JUNCTION && row.previous === H.WEST_LANE && row.action === 'west').length, H.PER_ARRIVAL);
  assert.equal(rows.filter((row) => row.current === H.JUNCTION && row.previous === H.EAST_LANE && row.action === 'east').length, H.PER_ARRIVAL);
  const west = recount(rows, false, H.WEST_LANE);
  const east = recount(rows, true, H.EAST_LANE);
  assert.equal(west.tie, true);
  assert.deepEqual(current.choose(H.JUNCTION, H.WEST_LANE).counts, west.counts);
  assert.deepEqual(history.choose(H.JUNCTION, H.EAST_LANE).counts, east.counts);
  assert.equal(current.choose(H.JUNCTION, H.EAST_LANE).key, H.JUNCTION);
  assert.equal(history.choose(H.JUNCTION, H.EAST_LANE).key, H.EAST_LANE + ' | ' + H.JUNCTION);
});

test('the junction tie picks the first action, so exactly one arrival is wrong', () => {
  const rows = H.lessonRows();
  const current = H.fit(rows, false);
  const history = H.fit(rows, true);
  const tied = current.choose(H.JUNCTION, H.EAST_LANE);
  assert.equal(tied.tie, true);
  assert.equal(tied.counts[H.ACTIONS[0]], tied.counts[H.ACTIONS[1]]);
  assert.equal(tied.action, H.ACTIONS[0]);
  assert.equal(current.choose(H.JUNCTION, H.WEST_LANE).action, tied.action);
  const wrong = H.ARRIVALS.filter((previous) => !H.follows(current, rows, previous));
  assert.equal(wrong.length, 1);
  assert.notEqual(H.demonstratedAction(rows, wrong[0]), H.ACTIONS[0]);
  for (const previous of H.ARRIVALS) {
    assert.equal(history.choose(H.JUNCTION, previous).tie, false);
    assert.equal(history.choose(H.JUNCTION, previous).action, H.demonstratedAction(rows, previous));
    assert.equal(H.follows(history, rows, previous), true);
    assert.equal(H.play(history, previous).end, H.step(H.JUNCTION, H.demonstratedAction(rows, previous)));
  }
});

test('dropping the previous room brings back the tie', () => {
  const rows = H.lessonRows();
  const history = H.fit(rows, true);
  const dropped = H.fit(rows, false);
  const stripped = H.dropPrevious(rows);
  assert.throws(() => H.fit(stripped, true), /missing previous room/);
  const fromStripped = H.fit(stripped, false);
  for (const previous of H.ARRIVALS) {
    assert.equal(history.choose(H.JUNCTION, previous).tie, false);
    assert.equal(dropped.choose(H.JUNCTION, previous).tie, true);
    assert.equal(dropped.choose(H.JUNCTION, previous).action, recount(rows, false, previous).action);
    assert.equal(fromStripped.choose(H.JUNCTION, previous).action, dropped.choose(H.JUNCTION, previous).action);
    assert.equal(fromStripped.budget, history.budget);
  }
});

test('swapped labels change the history action and the tie action stays the first action', () => {
  const rows = H.lessonRows();
  const swapped = H.swapActions(rows);
  const history = H.fit(rows, true);
  const swappedHistory = H.fit(swapped, true);
  const dropped = H.fit(rows, false);
  const swappedDropped = H.fit(swapped, false);
  assert.equal(swappedHistory.budget, history.budget);
  for (const previous of H.ARRIVALS) {
    const before = history.choose(H.JUNCTION, previous).action;
    const after = swappedHistory.choose(H.JUNCTION, previous).action;
    assert.equal(before, recount(rows, true, previous).action);
    assert.equal(after, recount(swapped, true, previous).action);
    assert.notEqual(before, after);
    assert.equal(H.follows(swappedHistory, swapped, previous), true);
    assert.equal(H.follows(history, swapped, previous), false);
  }
  assert.equal(dropped.choose(H.JUNCTION, H.EAST_LANE).tie, true);
  assert.equal(swappedDropped.choose(H.JUNCTION, H.WEST_LANE).tie, true);
  assert.equal(swappedDropped.choose(H.JUNCTION, H.EAST_LANE).action, H.ACTIONS[0]);
  assert.equal(dropped.choose(H.JUNCTION, H.WEST_LANE).action, H.ACTIONS[0]);
  assert.equal(swappedDropped.choose(H.JUNCTION).action, recount(swapped, false).action);
});

test('a history policy that always goes west fails the east-arrival test', () => {
  const rows = H.lessonRows();
  const history = H.fit(rows, true);
  const alwaysWest = H.constantPolicy('west');
  assert.notEqual(H.demonstratedAction(rows, H.EAST_LANE), 'west');
  assert.equal(H.follows(history, rows, H.EAST_LANE), true);
  assert.equal(H.follows(history, rows, H.WEST_LANE), true);
  assert.equal(H.follows(alwaysWest, rows, H.EAST_LANE), false);
  assert.equal(H.play(alwaysWest, H.EAST_LANE).action, 'west');
  assert.notEqual(H.play(alwaysWest, H.EAST_LANE).end, H.play(history, H.EAST_LANE).end);
});

test('unequal counts are a majority, and one previous room still ties a longer disagreement', () => {
  const rows = H.rowsFor(3, 1);
  const current = H.fit(rows, false);
  const counted = recount(rows, false);
  assert.equal(counted.tie, false);
  assert.equal(current.choose(H.JUNCTION, H.EAST_LANE).tie, false);
  assert.equal(current.choose(H.JUNCTION, H.EAST_LANE).action, counted.action);
  assert.equal(current.budget, H.fit(rows, true).budget);
  const alias = H.fit(H.longerAliasRows(), true);
  const choice = alias.choose(H.JUNCTION, H.WEST_LANE);
  assert.equal(choice.tie, true);
  assert.equal(choice.counts.west, choice.counts.east);
  assert.equal(choice.action, H.ACTIONS[0]);
  assert.equal(choice.key, H.WEST_LANE + ' | ' + H.JUNCTION);
});

test('the lecture heading is the history heading, and the count is not a network or a reward', () => {
  assert.equal(H.SOURCE.slides, 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-3.pdf');
  assert.equal(H.SOURCE.heading, 'How can we use the whole history?');
  assert.match(H.SOURCE.note, /sequence model/);
  assert.equal(H.LIMITS.some((line) => /only for this toy/.test(line)), true);
  assert.equal(H.LIMITS.some((line) => /aliases the two arrivals/.test(line)), true);
  assert.equal(H.LIMITS.some((line) => /not a recurrent network/.test(line)), true);
  assert.equal(H.LIMITS.some((line) => /not meta-RL/.test(line)), true);
  assert.throws(() => H.step(H.JUNCTION, 'north'), /unknown action/);
  assert.throws(() => H.fit([{ previous: H.WEST_LANE, current: H.JUNCTION, action: 'north' }], true), /unknown action/);
});

function mount(levels, phases) {
  const context = vm.createContext({
    window: {
      CONTENT: { phases: phases, levels: levels, worldNames: {} },
      BBHISTORY: H,
    },
  });
  vm.runInContext(fs.readFileSync('web/history-level.js', 'utf8'), context);
  return context;
}

test('the lesson sits after goals and leaves peer levels in place', () => {
  const context = mount([
    { id: 'goals', custom: true, title: 'Tell it the goal' },
    { id: 'slots', title: 'Ten slot machines' },
    { id: 'metarl', custom: true, title: 'The second episode reads the first' },
    { id: 'ensemble', custom: true, title: 'Stop where the tables disagree' },
  ], [{ n: 0, title: 'Imitation before reward' }]);
  const ids = context.window.CONTENT.levels.map((level) => level.id);
  assert.deepEqual(ids, ['goals', 'history', 'slots', 'metarl', 'ensemble']);
  const lesson = context.window.CONTENT.levels[1];
  assert.equal(lesson.custom, true);
  assert.equal(lesson.id, 'history');
  assert.equal(lesson.phase, 0);
  assert.equal(lesson.title, 'The previous room is part of the state');
  assert.equal(context.window.CONTENT.worldNames.history.length > 0, true);
  const ran = context.window.BBHISTORY_LEVEL.run();
  assert.equal(ran.current.usePrevious, false);
  assert.equal(ran.history.usePrevious, true);
  assert.equal(ran.current.budget, ran.history.budget);
  assert.equal(ran.history.choose(H.JUNCTION, H.EAST_LANE).action, H.demonstratedAction(H.lessonRows(), H.EAST_LANE));
  assert.equal(ran.current.choose(H.JUNCTION, H.EAST_LANE).tie, true);
});

test('the lesson still mounts when goals is absent', () => {
  const context = mount([
    { id: 'slots', title: 'Ten slot machines' },
    { id: 'ensemble', custom: true },
  ], []);
  assert.deepEqual(context.window.CONTENT.levels.map((level) => level.id), ['history', 'slots', 'ensemble']);
  assert.equal(context.window.CONTENT.phases.some((phase) => phase.n === 0), true);
});
