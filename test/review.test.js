// Review transitions and hint gating. The page calls these functions from web/app.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global.window || {};
require(path.join(__dirname, '..', 'web', 'content.js'));
require(path.join(__dirname, '..', 'web', 'content2.js'));
require(path.join(__dirname, '..', 'web', 'content3.js'));
const lessons = require(path.join(__dirname, '..', 'web', 'review-lessons.js'));
const REVIEW = require(path.join(__dirname, '..', 'web', 'review.js'));
const C = global.window.CONTENT;
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

const FIELDS = ['task', 'before', 'failure', 'aim', 'inspect'];

function recipesFor(id) {
  return C.recipes.filter((r) => r.card === id);
}

function chipsFor(id) {
  const chips = [];
  for (const rec of recipesFor(id)) chips.push(...REVIEW.solutionChips(C.words, rec));
  return [...new Set(chips)];
}

test('the review page calls the transition and hint functions', () => {
  assert.match(appSrc, /REVIEW\.plan\(/);
  assert.match(appSrc, /REVIEW\.hintGate\(/);
  assert.match(appSrc, /REVIEW\.sections\(/);
  assert.match(appSrc, /data-review': 'context'/);
  assert.match(appSrc, /data-review': 'solution'/);
  assert.doesNotMatch(appSrc, /aria-label': 'Show the detailed solution'[\s\S]{0,80}uses "/);
});

test('every rebuild exercise has context, a predecessor, a failure, an aim and an inspect line', () => {
  const ids = Object.keys(C.cards).filter((id) => C.cards[id].review);
  assert.ok(ids.length >= 30, 'the review set is the full method list (' + ids.length + ')');
  assert.deepEqual(Object.keys(lessons).sort(), ids.slice().sort());
  for (const id of ids) {
    const lesson = lessons[id];
    for (const field of FIELDS) {
      assert.equal(typeof lesson[field], 'string', id + ' ' + field);
      const min = field === 'before' ? 3 : 40;
      assert.ok(lesson[field].trim().length >= min, id + ' ' + field + ' is filled in');
    }
    assert.ok(recipesFor(id).length > 0, id + ' has a recipe to rebuild');
  }
});

test('context and inspect do not contain the published sentence chips', () => {
  const ids = Object.keys(C.cards).filter((id) => C.cards[id].review);
  const leaks = [];
  for (const id of ids) {
    const text = REVIEW.lessonText(lessons[id]).toLowerCase();
    for (const chip of chipsFor(id)) {
      if (chip.length < 8 && !(chip.includes(' ') && chip.length >= 7)) continue;
      if (text.includes(chip.toLowerCase())) leaks.push(id + ': ' + chip);
    }
  }
  assert.deepEqual(leaks, []);
});

test('Next method resets a cross-world change and a same-world change', () => {
  const cross = REVIEW.plan(
    { id: 'doubleq', world: 'mirage', knobs: {}, running: true },
    { id: 'ddqn', world: 'cartpole', knobs: {} });
  assert.equal(cross.resetTransient, true);
  assert.equal(cross.cancelRun, true);
  assert.equal(cross.world, 'cartpole');
  assert.equal(cross.preservePin, true);
  assert.equal(cross.preserveProgress, true);

  const sameWorld = REVIEW.plan(
    { id: 'clipped', world: 'mirage', knobs: {} },
    { id: 'doubleq', world: 'mirage', knobs: {} });
  assert.equal(sameWorld.resetTransient, true);
  assert.equal(sameWorld.world, 'mirage');
  assert.equal(sameWorld.preservePin, true);

  const same = REVIEW.plan(
    { id: 'ddqn', world: 'cartpole', knobs: { maxSteps: 500 }, running: true },
    { id: 'ddqn', world: 'cartpole', knobs: { maxSteps: 500 } });
  assert.equal(same.resetTransient, false);
  assert.equal(same.cancelRun, false);
  assert.equal(same.preservePin, true);
});

test('the detailed solution stays closed until a check has been recorded and the hint is opened', () => {
  assert.deepEqual(REVIEW.hintGate(null, true), { attempted: false, showSolution: false });
  assert.deepEqual(REVIEW.hintGate({ n: 0 }, true), { attempted: false, showSolution: false });
  assert.deepEqual(REVIEW.hintGate({ n: 1 }, false), { attempted: true, showSolution: false });
  assert.deepEqual(REVIEW.hintGate({ n: 1 }, true), { attempted: true, showSolution: true });

  assert.deepEqual(REVIEW.sections(false, false), ['context', 'rebuild']);
  assert.deepEqual(REVIEW.sections(false, true), ['context', 'rebuild']);
  assert.deepEqual(REVIEW.sections(true, false), ['context', 'rebuild', 'inspect', 'hint']);
  assert.deepEqual(REVIEW.sections(true, true), ['context', 'rebuild', 'inspect', 'solution']);
  const open = REVIEW.sections(true, true);
  assert.ok(open.indexOf('context') < open.indexOf('rebuild'));
  assert.ok(open.indexOf('rebuild') < open.indexOf('inspect'));
  assert.ok(open.indexOf('inspect') < open.indexOf('solution'));
});
