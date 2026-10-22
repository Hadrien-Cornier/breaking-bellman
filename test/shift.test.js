'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Lane = require('../src/agents/shift.js');

test('demonstration support is only the center', () => {
  const demo = Lane.demonstrate();
  assert.deepEqual(demo.support, [0]);
  assert.deepEqual(demo.counts, { '-2': 0, '-1': 0, '0': 4, '1': 0, '2': 0 });
  assert.deepEqual(demo.pairs, [
    { state: 0, action: 0 },
    { state: 0, action: 0 },
    { state: 0, action: 0 },
    { state: 0, action: 0 },
  ]);
});

test('the lookup holds on unseen states and the shared slip-start schedule stays put', () => {
  const demo = Lane.demonstrate();
  const policy = Lane.clone(demo.pairs);
  assert.equal(policy(0), 0);
  assert.equal(policy(1), 0);
  assert.equal(policy(-1), 0);
  assert.equal(policy(2), 0);
  assert.equal(policy.hold, 0);
  const center = Lane.rollout(policy, Lane.CENTER_SCHEDULE);
  const before = Lane.rollout(policy, Lane.PLAYER_SCHEDULE);
  assert.deepEqual(center.positions, [0, 0, 0, 0, 0]);
  assert.equal(center.failed, false);
  assert.deepEqual(before.positions, [1, 1, 1, 1, 1]);
  assert.deepEqual(before.actions, [0, 0, 0, 0]);
  assert.deepEqual(before.visitedLane, [1]);
  assert.deepEqual(before.slips, [0, 0, 0, 0]);
  assert.equal(before.start, 1);
  assert.equal(Lane.sameSchedule(before, Lane.PLAYER_SCHEDULE), true);
  assert.deepEqual(Lane.PLAYER_SCHEDULE.slips, [0, 0, 0, 0]);
});

test('one expert query on the visited state corrects the same schedule and leaves other states unlabeled', () => {
  const story = Lane.lesson();
  const again = Lane.lesson();
  assert.deepEqual(story.before.positions, again.before.positions);
  assert.deepEqual(story.after.positions, again.after.positions);
  assert.deepEqual(story.aggregated.added, [{ state: 1, action: -1 }]);
  assert.deepEqual(story.aggregated.support, [0, 1]);
  assert.equal(story.demo.pairs.length, 4);
  assert.equal(story.policy(1), -1);
  assert.equal(story.policy(0), 0);
  assert.equal(story.policy(-1), 0);
  assert.equal(story.policy.known[-1], undefined);
  assert.deepEqual(story.after.positions, [1, 0, 0, 0, 0]);
  assert.deepEqual(story.after.actions, [-1, 0, 0, 0]);
  assert.deepEqual(story.after.slips, [0, 0, 0, 0]);
  assert.equal(story.after.start, 1);
  assert.equal(story.after.failed, false);
  assert.equal(Lane.sameSchedule(story.before, Lane.PLAYER_SCHEDULE), true);
  assert.equal(Lane.sameSchedule(story.after, Lane.PLAYER_SCHEDULE), true);
  assert.deepEqual(story.center.positions, Lane.OUTCOME.centerPositions);
  assert.deepEqual(story.before.positions, Lane.OUTCOME.beforePositions);
  assert.deepEqual(story.after.positions, Lane.OUTCOME.afterPositions);
  assert.equal(Lane.expertAction(1), -1);
  assert.equal(Lane.expertAction(-1), 1);
  assert.equal(Lane.expertAction(0), 0);
});

test('an extra shove reaches the ditch and is not the repaired schedule', () => {
  const demo = Lane.demonstrate();
  const probe = { id: 'extra-shove', start: 1, horizon: 4, slips: [1, 0, 0, 0] };
  const ditched = Lane.rollout(Lane.clone(demo.pairs), probe);
  assert.equal(ditched.failed, true);
  assert.deepEqual(ditched.positions, [1, 2]);
  assert.equal(Lane.sameSchedule(ditched, Lane.PLAYER_SCHEDULE), false);
  const story = Lane.lesson();
  assert.notDeepEqual(story.after.slips, probe.slips);
  assert.equal(story.after.failed, false);
  const pairs = demo.pairs.slice();
  const aggregated = Lane.aggregate(demo.pairs, ditched);
  assert.deepEqual(demo.pairs, pairs);
  assert.deepEqual(aggregated.added, [{ state: 1, action: -1 }]);
  assert.equal(aggregated.pairs.some((pair) => pair.state === 2), false);
});

test('aggregation skips a non-lane state even if a trace names one', () => {
  const demo = Lane.demonstrate();
  const aggregated = Lane.aggregate(demo.pairs, { visitedLane: [2, 1, -3] });
  assert.deepEqual(aggregated.added, [{ state: 1, action: -1 }]);
  assert.equal(aggregated.policy(2), 0);
  assert.equal(aggregated.policy(-1), 0);
});

test('the new level keeps old level ids and prepends phase 0', () => {
  const context = vm.createContext({ window: { BBVPO: {}, BBSUPERMIMIC: {}, BBSHIFT: Lane } });
  const files = ['content', 'content2', 'content3', 'fetch-level', 'vpo-level', 'supermimic-level', 'shift-level'];
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', name + '.js'), 'utf8'), context);
  }
  const levels = context.window.CONTENT.levels;
  const phases = context.window.CONTENT.phases;
  assert.equal(levels.length, 20);
  assert.equal(levels.slice(0, 3).map((level) => level.id).join(','), 'shift,slots,cliff');
  assert.equal(levels.find((level) => level.id === 'slots').title, 'Ten slot machines');
  assert.equal(levels[levels.length - 1].id, 'supermimic');
  assert.equal(new Set(levels.map((level) => level.id)).size, levels.length);
  assert.equal(phases.map((phase) => phase.n).join(','), '0,1,2,3,4,5,6,7,8');
  assert.equal(phases[0].title, 'Imitation before reward');
  const phaseOf = (level) => (level.phase == null ? 1 : level.phase);
  assert.equal(phaseOf(levels[0]), 0);
  assert.equal(levels.filter((level) => phaseOf(level) === 0).map((level) => level.id).join(','), 'shift');
  assert.equal(levels.filter((level) => phaseOf(level) === 1)[0].id, 'slots');
  const app = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.match(app, /l\.phase == null \? 1 : l\.phase/);
  assert.equal(context.window.CONTENT.cards.dagger.name, 'DAgger');
  assert.equal(context.window.CONTENT.levels.find((level) => level.id === 'shift').custom, true);
  for (const name of ['algos', 'recap']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', name + '.js'), 'utf8'), context);
  }
  const note = context.RECAP.note('dagger', context.window.CONTENT, context.ALGO_HELP);
  assert.equal(note.quote, '');
  assert.match(note.gap, /No verbatim quote/);
  assert.match(note.gap, /not read here/);
  assert.equal(note.practice.includes('\u2014'), false);
  assert.match(note.practice, /visits/);
  context.RECAP.attach(context.window.CONTENT, context.ALGO_HELP);
  const card = context.window.CONTENT.cards.dagger;
  assert.equal(card.quoteGap, note.gap);
  assert.equal(card.pullQuote, undefined);
  assert.equal(card.status, 'unchecked');
});

test('the lane lesson stays ahead of goal-conditioned cloning in phase 0', () => {
  const context = vm.createContext({ window: { BBVPO: {}, BBSUPERMIMIC: {}, BBSHIFT: Lane } });
  const files = ['content', 'content2', 'content3', 'fetch-level', 'vpo-level', 'supermimic-level', 'shift-level'];
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', name + '.js'), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'agents', 'goals.js'), 'utf8'), context);
  context.window.BBGOALS = context.BBGOALS;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'goals-level.js'), 'utf8'), context);
  const levels = context.window.CONTENT.levels;
  const phaseOf = (level) => (level.phase == null ? 1 : level.phase);
  assert.equal(levels.length, 21);
  assert.equal(levels.slice(0, 3).map((level) => level.id).join(','), 'shift,goals,slots');
  assert.equal(levels.filter((level) => phaseOf(level) === 0).map((level) => level.id).join(','), 'shift,goals');
  assert.equal(context.window.CONTENT.phases.filter((phase) => phase.n === 0).length, 1);
  assert.equal(levels.find((level) => level.id === 'goals').title, 'Tell it the goal');
});
