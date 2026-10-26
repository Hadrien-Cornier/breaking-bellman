// Successor features: discounted feature sums written out from a separate transition list.
// The expected numbers below are those sums, not a copy of the module's return value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../src/agents/successor.js');

const OPEN = {
  'S|door': 'D',
  'S|alley': 'A',
  'D|take': 'B',
  'D|skip': 'G',
  'B|go': 'G',
  'A|go': 'M',
  'M|go': 'G',
};
const LOCKED = Object.assign({}, OPEN, { 'S|door': 'A' });

function actionOf(policy, s) {
  if (s === 'S') return policy === 'alley' ? 'alley' : 'door';
  if (s === 'D') return policy === 'take' ? 'take' : 'skip';
  return 'go';
}

function enumerate(spec) {
  const table = spec.dynamics === 'locked' ? LOCKED : OPEN;
  const gamma = spec.gamma === undefined ? 0.5 : spec.gamma;
  const horizon = spec.horizon === undefined ? 8 : spec.horizon;
  const weights = spec.weights;
  let s = spec.state || 'S';
  const steps = [];
  for (let t = 0; t < horizon && s !== 'G'; t++) {
    const a = t === 0 && spec.firstAction ? spec.firstAction : actionOf(spec.policy, s);
    const sp = table[s + '|' + a];
    const phi = spec.phi ? spec.phi({ s: s, a: a, sp: sp }) : [1, s === 'D' && a === 'take' && sp === 'B' ? 1 : 0];
    steps.push({ t: t, s: s, a: a, sp: sp, phi: phi, terminal: sp === 'G' });
    s = sp;
  }
  const psi = [0, 0];
  let ret = 0;
  steps.forEach((step) => {
    const d = gamma ** step.t;
    psi[0] += d * step.phi[0];
    psi[1] += d * step.phi[1];
    ret += d * (step.phi[0] * weights.step + step.phi[1] * weights.door);
  });
  return { steps: steps, psi: psi, ret: ret };
}

function lesson(over) {
  return Object.assign({
    dynamics: 'open', policy: 'take', gamma: 0.5, horizon: 8, weights: S.WEIGHTS.base, state: 'S',
  }, over || {});
}

test('the door policy sums the three open transitions and stops at the goal', () => {
  const hand = enumerate(lesson());
  const run = S.build(lesson());
  assert.deepEqual(hand.steps.map((s) => [s.s, s.a, s.sp, s.phi[0], s.phi[1], s.terminal]), [
    ['S', 'door', 'D', 1, 0, false],
    ['D', 'take', 'B', 1, 1, false],
    ['B', 'go', 'G', 1, 0, true],
  ]);
  assert.deepEqual(hand.psi, [1.75, 0.5]);
  assert.equal(hand.ret, -2.5);
  assert.deepEqual(run.psi, hand.psi);
  assert.equal(run.q, hand.ret);
  assert.equal(run.direct, hand.ret);
  assert.equal(run.match, true);
  assert.equal(run.modelReads, 3);
  assert.equal(run.envInteractions, 0);
  assert.equal(run.learned, false);
  assert.deepEqual(run.conditionedOn, { state: 'S', action: 'door', policy: 'take' });
  assert.equal(run.steps.length, 3);
  assert.equal(run.steps[2].terminal, true);
});

test('skip and alley collect different features, so a canned vector cannot fit both', () => {
  const skip = enumerate(lesson({ policy: 'skip' }));
  const alley = enumerate(lesson({ policy: 'alley' }));
  assert.deepEqual(skip.psi, [1.5, 0]);
  assert.equal(skip.ret, -3);
  assert.equal(skip.steps.length, 2);
  assert.deepEqual(alley.psi, [1.75, 0]);
  assert.equal(alley.ret, -3.5);
  assert.deepEqual(S.build(lesson({ policy: 'skip' })).psi, skip.psi);
  assert.equal(S.build(lesson({ policy: 'skip' })).q, skip.ret);
  assert.deepEqual(S.build(lesson({ policy: 'alley' })).psi, alley.psi);
  assert.equal(S.build(lesson({ policy: 'alley' })).q, alley.ret);
  assert.notDeepEqual(S.build(lesson()).psi, S.build(lesson({ policy: 'alley' })).psi);
});

test('a weight tradeoff flips the sign, and a rescaled scalar stays negative', () => {
  const base = S.build(lesson());
  const moved = S.transfer(base, S.WEIGHTS.tradeoff);
  const hand = enumerate(lesson({ weights: S.WEIGHTS.tradeoff }));
  assert.equal(hand.ret, 2.25);
  assert.equal(moved.q, 2.25);
  assert.equal(moved.direct, 2.25);
  assert.equal(moved.match, true);
  assert.equal(moved.newModelReads, 0);
  assert.equal(moved.newEnvInteractions, 0);
  assert.equal(moved.originalModelReads, 3);
  assert.deepEqual(moved.psi, [1.75, 0.5]);
  assert.equal(moved.doorScale.defined, true);
  assert.equal(moved.doorScale.factor, 4);
  assert.equal(moved.doorScale.q, -10);
  assert.equal(moved.stepScale.factor, 0.5);
  assert.equal(moved.stepScale.q, -1.25);
  assert.ok(moved.doorScale.q < 0 && moved.q > 0);
  assert.ok(moved.stepScale.q < 0 && moved.q > 0);
  assert.notEqual(moved.q, base.q * (S.WEIGHTS.tradeoff.door / S.WEIGHTS.base.door));
});

test('a pure scale of the old weights makes the scalar store and the dot product agree', () => {
  const base = S.build(lesson());
  const moved = S.transfer(base, S.WEIGHTS.proportional);
  const hand = enumerate(lesson({ weights: S.WEIGHTS.proportional }));
  assert.equal(hand.ret, -5);
  assert.equal(moved.q, -5);
  assert.equal(moved.direct, -5);
  assert.equal(moved.doorScale.q, -5);
  assert.equal(moved.stepScale.q, -5);
  assert.equal(moved.newModelReads, 0);
  assert.equal(base.modelReads, 3);
});

test('locked dynamics make the old successor features the wrong return', () => {
  const open = S.build(lesson());
  const hand = enumerate(lesson({ dynamics: 'locked', weights: S.WEIGHTS.tradeoff }));
  assert.deepEqual(hand.steps.map((s) => [s.s, s.a, s.sp]), [
    ['S', 'door', 'A'],
    ['A', 'go', 'M'],
    ['M', 'go', 'G'],
  ]);
  assert.deepEqual(hand.psi, [1.75, 0]);
  assert.equal(hand.ret, -1.75);
  const stale = S.dot(open.psi, S.WEIGHTS.tradeoff);
  assert.equal(stale, 2.25);
  assert.notEqual(stale, hand.ret);
  const fresh = S.apply(open, { dynamics: 'locked', weights: S.WEIGHTS.tradeoff });
  assert.equal(fresh.mode, 'rebuild');
  assert.equal(fresh.staleQ, 2.25);
  assert.equal(fresh.staleMatch, false);
  assert.deepEqual(fresh.psi, hand.psi);
  assert.equal(fresh.q, hand.ret);
  assert.equal(fresh.direct, hand.ret);
  assert.equal(fresh.newEnvInteractions, 0);
  assert.equal(fresh.newModelReads, 3);
  assert.equal(fresh.originalModelReads, 3);
  const weightsOnly = S.apply(open, { weights: S.WEIGHTS.tradeoff });
  assert.equal(weightsOnly.mode, 'weights');
  assert.equal(weightsOnly.newModelReads, 0);
  assert.equal(weightsOnly.q, 2.25);
});

test('the toll weights leave the stored take policy worse than skip', () => {
  const take = enumerate(lesson({ weights: S.WEIGHTS.toll }));
  const skip = enumerate(lesson({ policy: 'skip', weights: S.WEIGHTS.toll }));
  const alley = enumerate(lesson({ policy: 'alley', weights: S.WEIGHTS.toll }));
  assert.equal(take.ret, -5.75);
  assert.equal(skip.ret, -1.5);
  assert.equal(alley.ret, -1.75);
  const ranked = S.comparePolicies({ weights: S.WEIGHTS.toll });
  assert.equal(ranked.gpi, false);
  assert.equal(ranked.best, 'skip');
  assert.equal(ranked.runs.take.q, take.ret);
  assert.equal(ranked.runs.skip.q, skip.ret);
  assert.equal(ranked.runs.alley.q, alley.ret);
  assert.equal(ranked.envInteractions, 0);
  assert.ok(ranked.modelReads > ranked.runs.take.modelReads);
  const base = S.comparePolicies({ weights: S.WEIGHTS.base });
  assert.equal(base.best, 'take');
  assert.equal(base.runs.take.q, -2.5);
});

test('discount, horizon, termination, state, action, and features each change the sum', () => {
  const undiscounted = enumerate(lesson({ gamma: 1 }));
  assert.deepEqual(undiscounted.psi, [3, 1]);
  assert.equal(undiscounted.ret, -4);
  assert.deepEqual(S.build(lesson({ gamma: 1 })).psi, [3, 1]);
  assert.equal(S.build(lesson({ gamma: 1 })).q, -4);

  const cut = enumerate(lesson({ horizon: 1 }));
  assert.deepEqual(cut.psi, [1, 0]);
  assert.equal(cut.ret, -2);
  assert.equal(cut.steps.length, 1);
  assert.equal(cut.steps[0].terminal, false);
  assert.deepEqual(S.build(lesson({ horizon: 1 })).psi, [1, 0]);

  const dead = enumerate(lesson({ gamma: 0 }));
  assert.deepEqual(dead.psi, [1, 0]);
  assert.deepEqual(S.build(lesson({ gamma: 0 })).psi, [1, 0]);

  const none = S.build(lesson({ horizon: 0 }));
  assert.deepEqual(none.psi, [0, 0]);
  assert.equal(none.q, 0);
  assert.equal(none.modelReads, 0);
  assert.equal(none.envInteractions, 0);

  const atDoor = enumerate(lesson({ state: 'D' }));
  assert.deepEqual(atDoor.steps.map((s) => [s.s, s.a, s.sp]), [
    ['D', 'take', 'B'],
    ['B', 'go', 'G'],
  ]);
  assert.deepEqual(atDoor.psi, [1.5, 1]);
  assert.equal(atDoor.ret, -1);
  assert.deepEqual(S.build(lesson({ state: 'D' })).psi, atDoor.psi);
  assert.deepEqual(S.build(lesson({ state: 'D' })).conditionedOn, { state: 'D', action: 'take', policy: 'take' });

  const forced = enumerate(lesson({ firstAction: 'alley' }));
  assert.deepEqual(forced.psi, [1.75, 0]);
  assert.deepEqual(S.build(lesson({ firstAction: 'alley' })).psi, forced.psi);
  assert.equal(S.build(lesson({ firstAction: 'alley' })).conditionedOn.action, 'alley');
  const other = enumerate(lesson({ policy: 'alley', firstAction: 'door' }));
  assert.deepEqual(other.steps.map((s) => [s.s, s.a, s.sp]), [
    ['S', 'door', 'D'],
    ['D', 'skip', 'G'],
  ]);
  assert.deepEqual(other.psi, [1.5, 0]);
  assert.deepEqual(S.build(lesson({ policy: 'alley', firstAction: 'door' })).psi, other.psi);

  const fat = (step) => [1, step.s === 'D' && step.a === 'take' ? 5 : 0];
  const bumped = enumerate(lesson({ phi: fat }));
  assert.deepEqual(bumped.psi, [1.75, 2.5]);
  assert.equal(bumped.ret, 1.75 * -2 + 2.5 * 2);
  assert.deepEqual(S.build(lesson({ phi: fat })).psi, bumped.psi);
  assert.equal(S.build(lesson({ phi: fat })).q, bumped.ret);
});

test('a zero old weight does not invent a scale, and illegal controls throw', () => {
  const base = S.build(lesson());
  const scaled = S.rescale(base.q, { step: -2, door: 0 }, { step: -1, door: 3 }, 'door');
  assert.equal(scaled.defined, false);
  assert.throws(() => S.build({ dynamics: 'shut' }));
  assert.throws(() => S.build({ policy: 'wander' }));
  assert.throws(() => S.build({ gamma: -0.1 }));
  assert.throws(() => S.build({ state: 'Z' }));
  assert.throws(() => S.nextOf('open', 'S', 'take'));
});

test('the lesson id mounts on its own and keeps hindsight and hierarchy', () => {
  const alone = vm.createContext({
    window: { CONTENT: { phases: [], levels: [], worldNames: {} }, BBSUCCESSOR: S },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/successor-level.js', 'utf8'), alone);
  const C = alone.window.CONTENT;
  assert.deepEqual(C.levels.map((l) => l.id), ['successor']);
  assert.equal(C.levels[0].custom, true);
  assert.equal(C.levels[0].world, 'successor');
  assert.equal(C.levels[0].phase, 9);
  assert.equal(C.worldNames.successor, 'Door path');
  assert.equal(C.phases.filter((p) => p.n === 9).length, 1);
  assert.equal(typeof S.mount, 'function');

  const between = vm.createContext({
    window: {
      CONTENT: {
        phases: [{ n: 9, title: 'Multi-task goals' }],
        levels: [{ id: 'hindsight' }, { id: 'hierarchy' }],
        worldNames: {},
      },
      BBSUCCESSOR: S,
    },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/successor-level.js', 'utf8'), between);
  assert.deepEqual(between.window.CONTENT.levels.map((l) => l.id), ['hindsight', 'successor', 'hierarchy']);
  assert.equal(between.window.CONTENT.phases.filter((p) => p.n === 9).length, 1);

  const withMeta = vm.createContext({
    window: {
      CONTENT: {
        phases: [{ n: 9, title: 'Multi-task goals' }],
        levels: [{ id: 'hindsight' }, { id: 'metarl' }, { id: 'hierarchy' }],
        worldNames: {},
      },
      BBSUCCESSOR: S,
    },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/successor-level.js', 'utf8'), withMeta);
  assert.deepEqual(withMeta.window.CONTENT.levels.map((l) => l.id), ['hindsight', 'metarl', 'successor', 'hierarchy']);
});
