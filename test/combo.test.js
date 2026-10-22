// The backup is the Bellman target minus coefficient times total variation.
// A clamp or a hard zero on off-data actions fails the coefficient-0 case and the proportional drop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../src/agents/combo.js');

function freqOf(data) {
  const counts = { stay: 0, leap: 0 };
  for (const row of data) counts[row.action] += 1;
  return { total: data.length, share: { stay: counts.stay / data.length, leap: counts.leap / data.length } };
}

function tv(action, data) {
  const freq = freqOf(data);
  const one = { stay: action === 'stay' ? 1 : 0, leap: action === 'leap' ? 1 : 0 };
  return 0.5 * (Math.abs(one.stay - freq.share.stay) + Math.abs(one.leap - freq.share.leap));
}

function targetOf(sample) {
  if (sample.terminal) return sample.reward;
  return sample.reward + sample.gamma * sample.nextValue;
}

function leapSample() { return M.lessonSamples().find((sample) => sample.action === 'leap'); }
function staySample() { return M.lessonSamples().find((sample) => sample.action === 'stay'); }

test('coefficient 0 returns the Bellman target off the data, and the drop stays proportional', () => {
  const data = M.lessonData();
  const leap = leapSample();
  const ownTarget = targetOf(leap);
  const ownDistance = tv('leap', data);
  assert.equal(ownTarget, 6);
  assert.equal(ownDistance, 1);
  assert.equal(Math.abs(1 - freqOf(data).share.leap), ownDistance);
  const zero = M.backup(leap, data, 0);
  assert.equal(zero.target, ownTarget);
  assert.equal(zero.distance, ownDistance);
  assert.equal(zero.penalty, 0);
  assert.equal(zero.value, ownTarget);
  assert.notEqual(zero.value, 0);
  let previous = null;
  for (let coefficient = 0; coefficient <= 10; coefficient++) {
    const row = M.backup(leap, data, coefficient);
    assert.equal(row.value, ownTarget - coefficient * ownDistance);
    assert.equal(row.penalty, coefficient * ownDistance);
    assert.equal(row.value, row.target - row.coefficient * row.distance);
    if (previous) assert.equal(previous.value - row.value, ownDistance);
    previous = row;
  }
  assert.equal(M.backup(leap, data, 10).value, -4);
  assert.notEqual(M.backup(leap, data, 10).value, 0);
  const low = M.backup(leap, data, 1);
  const high = M.backup(leap, data, 3);
  assert.equal(low.value - high.value, 2 * low.distance);
});

test('on-data distance is 0, so a positive coefficient leaves that target alone', () => {
  const data = M.lessonData();
  const stay = staySample();
  assert.equal(tv('stay', data), 0);
  assert.equal(M.distance('stay', M.frequencies(data)), 0);
  for (const coefficient of [0, 1, 5, 10]) {
    const row = M.backup(stay, data, coefficient);
    assert.equal(row.distance, 0);
    assert.equal(row.penalty, 0);
    assert.equal(row.value, targetOf(stay));
    assert.equal(row.value, 2);
  }
  const allLeap = M.dataset(0, 4);
  const leap = leapSample();
  assert.equal(M.distance('leap', M.frequencies(allLeap)), 0);
  const kept = M.backup(leap, allLeap, 9);
  assert.equal(kept.distance, 0);
  assert.equal(kept.value, 6);
  assert.equal(kept.value, targetOf(leap));
});

test('changed data frequencies change the distance, the value, and the planner', () => {
  const leap = leapSample();
  const lesson = M.lessonData();
  const half = M.dataset(2, 2);
  const allLeap = M.dataset(0, 4);
  assert.equal(freqOf(half).share.leap, 0.5);
  assert.equal(M.distance('leap', M.frequencies(half)), 0.5);
  assert.equal(M.distance('stay', M.frequencies(half)), 0.5);
  assert.equal(M.backup(leap, half, 4).value, 6 - 4 * 0.5);
  assert.notEqual(M.backup(leap, half, 4).value, M.backup(leap, lesson, 4).value);
  assert.equal(M.plan(M.lessonSamples(), lesson, 0).action, 'leap');
  assert.equal(M.plan(M.lessonSamples(), lesson, 4).action, null);
  assert.equal(M.plan(M.lessonSamples(), lesson, 4).reason, 'tie');
  assert.equal(M.plan(M.lessonSamples(), lesson, 5).action, 'stay');
  assert.equal(M.plan(M.lessonSamples(), half, 5).action, 'leap');
  assert.equal(M.plan(M.lessonSamples(), allLeap, 5).action, 'leap');
  assert.notEqual(M.plan(M.lessonSamples(), lesson, 5).action, M.plan(M.lessonSamples(), half, 5).action);
  assert.equal(M.crossover(lesson), 4);
  assert.equal(M.crossover(half), null);
  const stayed = M.study(lesson, 5);
  assert.equal(stayed.plan.action, 'stay');
  assert.ok(stayed.rows.leap.target > stayed.rows.stay.target);
  assert.ok(stayed.rows.leap.value < stayed.rows.stay.value);
  assert.equal(stayed.rows.leap.value, stayed.rows.leap.target - 5 * stayed.rows.leap.distance);
});

test('the lesson hole is the leap the data never takes, and a terminal sample uses only its reward', () => {
  const data = M.lessonData();
  assert.equal(data.length, 4);
  for (const row of data) {
    assert.equal(row.action, 'stay');
    assert.equal(row.next, 'lane');
  }
  const leap = leapSample();
  assert.equal(leap.next, 'hole');
  assert.equal(M.bellmanTarget(leap), 6);
  assert.equal(M.bellmanTarget({ action: 'leap', reward: 3, terminal: true, gamma: 0.5, nextValue: 100 }), 3);
  assert.equal(M.bellmanTarget({ action: 'stay', reward: 1, terminal: false, gamma: 0.5, nextValue: 4 }), 3);
  const terminal = M.backup({ action: 'leap', reward: 3, terminal: true, gamma: 0.5, nextValue: 100 }, data, 2);
  assert.equal(terminal.target, 3);
  assert.equal(terminal.value, 3 - 2 * 1);
  assert.equal(M.HEADING, 'COMBO: Conservative Model-Based RL');
  assert.equal(M.LECTURE, 18);
  assert.equal(M.study(data, 0).paperLoss, 'open');
  assert.equal(M.study(data, 0).illustrative, true);
  assert.equal(M.UNITS.coefficient, 'return per unit total variation');
  assert.equal(M.UNITS.value, 'return');
});

test('the lesson id mounts after thaw and does not replace a peer', () => {
  const context = vm.createContext({
    window: {
      CONTENT: {
        phases: [{ n: 4, title: 'Offline learning (behavior cloning to IQL)' }],
        levels: [
          { id: 'mixed', phase: 4, title: 'Good and bad data' },
          { id: 'thaw', phase: 4, title: 'A few fresh steps' },
          { id: 'rare', phase: 11, title: 'A bonus for a rare cell' },
          { id: 'twoways', phase: 5, title: 'Two good ways' },
        ],
        worldNames: {},
        cards: {},
      },
      BBCOMBO: M,
    },
  });
  vm.runInContext(fs.readFileSync('web/combo-level.js', 'utf8'), context);
  assert.deepEqual(context.window.CONTENT.levels.map((level) => level.id), ['mixed', 'thaw', 'combo', 'rare', 'twoways']);
  const alone = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'mixed', phase: 4 }], worldNames: {} },
      BBCOMBO: M,
    },
  });
  vm.runInContext(fs.readFileSync('web/combo-level.js', 'utf8'), alone);
  assert.deepEqual(alone.window.CONTENT.levels.map((level) => level.id), ['mixed', 'combo']);
  const lesson = context.window.CONTENT.levels.find((level) => level.id === 'combo');
  assert.equal(lesson.custom, true);
  assert.equal(lesson.world, 'combo');
  assert.equal(lesson.phase, 4);
  assert.equal(lesson.title, 'The imagined leap looks better');
  assert.equal(context.window.CONTENT.worldNames.combo, 'One hole');
  assert.equal(typeof M.mount, 'function');
  assert.equal(context.window.CONTENT.levels.filter((level) => level.id === 'thaw').length, 1);
  assert.equal(context.window.CONTENT.levels.filter((level) => level.id === 'rare').length, 1);
});
