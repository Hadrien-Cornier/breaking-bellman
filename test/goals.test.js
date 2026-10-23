'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/agents/goals.js');

function startRow(fitted, goal) {
  return fitted.table.find((r) => r.state === 'start' && (goal == null || r.goal === goal));
}

test('the lesson notes are three west walks and one east walk', () => {
  const rows = G.lessonRows();
  assert.equal(rows.length, 8);
  assert.equal(rows.filter((r) => r.state === 'start' && r.goal === 'west-room').length, 3);
  assert.equal(rows.filter((r) => r.state === 'start' && r.goal === 'east-room').length, 1);
  assert.equal(G.rowsFor(3, 1).length, rows.length);
});

test('hiding the room follows the majority, and flipping the majority flips the path', () => {
  const westHeavy = G.fit(G.rowsFor(3, 1), false);
  assert.deepEqual(startRow(westHeavy).counts, { west: 3, east: 1 });
  assert.equal(G.rollout(westHeavy, 'east-room').end, 'west-room');
  assert.equal(G.rollout(westHeavy, 'west-room').end, 'west-room');
  assert.deepEqual(G.rollout(westHeavy, 'east-room').path, ['start', 'west-hall', 'west-room']);

  const eastHeavy = G.fit(G.rowsFor(1, 3), false);
  assert.deepEqual(startRow(eastHeavy).counts, { west: 1, east: 3 });
  assert.equal(G.rollout(eastHeavy, 'west-room').end, 'east-room');
  assert.equal(G.rollout(eastHeavy, 'east-room').end, 'east-room');
  assert.deepEqual(G.rollout(eastHeavy, 'west-room').path, ['start', 'east-hall', 'east-room']);
});

test('keeping the room reaches the requested room, including when that room is rare', () => {
  for (const [westN, eastN] of [[3, 1], [1, 3], [4, 2]]) {
    const fitted = G.fit(G.rowsFor(westN, eastN), true);
    const west = startRow(fitted, 'west-room');
    const east = startRow(fitted, 'east-room');
    assert.deepEqual(west.counts, { west: westN, east: 0 });
    assert.deepEqual(east.counts, { west: 0, east: eastN });
    assert.equal(G.rollout(fitted, 'west-room').end, 'west-room');
    assert.equal(G.rollout(fitted, 'east-room').end, 'east-room');
    assert.equal(G.rollout(fitted, 'east-room').arrived, true);
  }
});

test('a tie gives both actions the same likelihood and the walk picks west', () => {
  const fitted = G.fit(G.tieRows(), false);
  const start = startRow(fitted);
  assert.deepEqual(start.counts, { west: 1, east: 1 });
  assert.equal(start.probs.west, start.probs.east);
  const preferWest = G.logLikelihood(start.counts, { west: 0.8, east: 0.2 });
  const preferEast = G.logLikelihood(start.counts, { west: 0.2, east: 0.8 });
  assert.equal(preferWest, preferEast);
  assert.ok(G.logLikelihood(start.counts, start.probs) > preferWest);
  assert.equal(fitted.choose('start', 'east-room').action, 'west');
  assert.equal(fitted.choose('start', 'west-room').action, 'west');
  assert.equal(G.fit([], false).choose('start', 'east-room').action, 'west');
});

test('the counted distribution fits the imbalanced notes better than a flat or swapped one', () => {
  const fitted = G.fit(G.lessonRows(), false);
  const start = startRow(fitted);
  assert.equal(start.probs.west, 0.75);
  assert.equal(start.probs.east, 0.25);
  const counted = G.logLikelihood(start.counts, start.probs);
  const flat = G.logLikelihood(start.counts, { west: 0.5, east: 0.5 });
  const swapped = G.logLikelihood(start.counts, { west: start.probs.east, east: start.probs.west });
  assert.ok(counted > flat);
  assert.ok(counted > swapped);
  assert.equal(fitted.useGoal, false);
  assert.ok(fitted.table.every((r) => r.goal === null));
});
