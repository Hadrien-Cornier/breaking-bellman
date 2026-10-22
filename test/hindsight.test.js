// Mechanism checks for tabular hindsight. Expected values are the Bellman backup of the
// binary reward, not a pasted expert path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/agents/hindsight.js');

function independentBackup(transitions, sweeps, conditionOnGoal) {
  const Q = {};
  const key = (s, a, g) => conditionOnGoal ? s + '|' + a + '|' + g : s + '|' + a + '|';
  const get = (k) => Object.prototype.hasOwnProperty.call(Q, k) ? Q[k] : H.INIT;
  for (let n = 0; n < sweeps; n++) {
    for (const tr of transitions) {
      let cont = 0;
      if (!tr.terminated) {
        const actions = H.legal(tr.sp);
        const best = actions.length ? Math.max(...actions.map((a) => get(key(tr.sp, a, tr.g)))) : H.INIT;
        cont = H.GAMMA * best;
      }
      Q[key(tr.s, tr.a, tr.g)] = tr.reward + cont;
    }
  }
  return Q;
}

test('relabel recomputes the binary reward and swaps truncation for termination only on a reached goal', () => {
  const eps = H.episodes();
  const before = JSON.stringify(eps);
  const rewritten = H.relabel(eps, true);
  const stale = H.relabel(eps, false);
  assert.equal(JSON.stringify(eps), before);
  assert.equal(rewritten.length, 4);
  assert.equal(stale.length, 4);
  for (const tr of eps.flatMap((ep) => ep.transitions)) {
    assert.equal(tr.g, 'F');
    assert.equal(tr.reward, -1);
    assert.equal(tr.terminated, false);
    assert.equal(tr.sp === 'F', false);
  }
  assert.deepEqual(eps.map((ep) => ep.transitions.map((tr) => tr.truncated)), [[false, true], [false, true]]);
  for (const tr of rewritten) {
    const reached = tr.sp === tr.g;
    assert.equal(tr.reward, reached ? 0 : -1);
    assert.equal(tr.terminated, reached);
    assert.equal(tr.truncated, !reached && tr.last);
    assert.equal(tr.originalGoal, 'F');
    assert.notEqual(tr.g, 'F');
  }
  const westHit = rewritten.find((tr) => tr.s === 'M' && tr.a === 'L');
  assert.equal(westHit.g, 'W');
  assert.equal(westHit.reward, 0);
  assert.equal(westHit.terminated, true);
  assert.equal(westHit.truncated, false);
  const westApproach = rewritten.find((tr) => tr.s === 'S' && tr.g === 'W');
  assert.equal(westApproach.reward, -1);
  assert.equal(westApproach.terminated, false);
  assert.equal(westApproach.truncated, false);
  for (const tr of stale) {
    assert.equal(tr.reward, -1);
    assert.equal(tr.terminated, false);
    assert.notEqual(tr.g, 'F');
    if (tr.last) assert.equal(tr.truncated, true);
  }
});

test('the same four steps solve the achieved goals only after recomputed hindsight updates propagate', () => {
  const a = H.compare();
  const b = H.compare();
  assert.deepEqual(a.modes, b.modes);
  assert.equal(a.envSteps, 4);
  assert.equal(a.gamma, 0.5);
  assert.equal(a.init, -2);
  assert.equal(a.modes.original.updates, 8);
  assert.equal(a.modes.hindsight.updates, 16);
  assert.ok(a.modes.hindsight.updates > a.modes.original.updates);
  assert.equal(a.modes.original.heldout, 0);
  assert.equal(a.modes.original.far, false);
  assert.equal(a.modes.once.heldout, 0);
  assert.equal(a.modes.once.Q['M|L|W'], 0);
  assert.equal(a.modes.once.Q['S|go|W'], -2);
  assert.equal(a.modes.once.success.W, false);
  assert.equal(a.modes.hindsight.heldout, 2);
  assert.equal(a.modes.hindsight.far, false);
  assert.equal(a.modes.hindsight.Q['M|L|W'], 0);
  assert.equal(a.modes.hindsight.Q['M|R|E'], 0);
  assert.equal(a.modes.hindsight.Q['S|go|W'], -1);
  assert.equal(a.modes.hindsight.Q['S|go|E'], -1);
  assert.equal(a.modes.hindsight.Q['S|go|W'], -1 + a.gamma * a.modes.hindsight.Q['M|L|W']);
  const both = a.original.concat(a.rewritten);
  const own = independentBackup(both, 2, true);
  assert.equal(own['S|go|W'], a.modes.hindsight.Q['S|go|W']);
  assert.equal(own['M|L|W'], a.modes.hindsight.Q['M|L|W']);
  assert.equal(own['M|R|E'], a.modes.hindsight.Q['M|R|E']);
  assert.equal(a.modes.hindsight.policy.M.W, 'L');
  assert.equal(a.modes.hindsight.policy.M.E, 'R');
  assert.notEqual(a.modes.hindsight.policy.M.W, a.modes.hindsight.policy.M.E);
  assert.deepEqual(a.modes.hindsight.rolls.W.path, ['S', 'M', 'W']);
  assert.deepEqual(a.modes.hindsight.rolls.E.path, ['S', 'M', 'E']);
  assert.equal(a.modes.hindsight.rolls.F.success, false);
  assert.equal(a.episodes[0].commanded, 'F');
  assert.equal(a.episodes[0].transitions[1].a, 'L');
  assert.equal(a.episodes[1].transitions[1].a, 'R');
});

test('dropping the goal input or keeping the old reward removes the held-out success', () => {
  const a = H.compare();
  assert.equal(a.modes.blind.conditionOnGoal, false);
  assert.equal(a.modes.blind.Q['M|L|'], 0);
  assert.equal(a.modes.blind.Q['M|R|'], 0);
  assert.equal(a.modes.blind.policy.M.W, null);
  assert.equal(a.modes.blind.policy.M.E, null);
  assert.equal(a.modes.blind.heldout, 0);
  assert.equal(a.modes.stale.heldout, 0);
  assert.equal(a.modes.stale.Q['M|L|W'], -2);
  assert.equal(a.modes.stale.success.W, false);
  assert.equal(a.modes.stale.success.E, false);
  const staleOwn = independentBackup(a.stale, 2, true);
  assert.equal(staleOwn['M|L|W'], -2);
});

test('the lesson id is registered on its own and does not replace the model lesson', () => {
  const context = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'supermimic', custom: true }], worldNames: {}, cards: {} },
      BBHINDSIGHT: H,
    },
  });
  vm.runInContext(fs.readFileSync('web/hindsight-level.js', 'utf8'), context);
  const C = context.window.CONTENT;
  assert.equal(C.levels.map((l) => l.id).join(','), 'hindsight,supermimic');
  const before = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'goals', custom: true }, { id: 'supermimic', custom: true }], worldNames: {}, cards: {} },
      BBHINDSIGHT: H,
    },
  });
  vm.runInContext(fs.readFileSync('web/hindsight-level.js', 'utf8'), before);
  assert.equal(before.window.CONTENT.levels.map((l) => l.id).join(','), 'goals,hindsight,supermimic');
  const later = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'supermimic', custom: true }, { id: 'goals', custom: true }], worldNames: {}, cards: {} },
      BBHINDSIGHT: H,
    },
  });
  vm.runInContext(fs.readFileSync('web/hindsight-level.js', 'utf8'), later);
  assert.equal(later.window.CONTENT.levels.map((l) => l.id).join(','), 'supermimic,goals,hindsight');
  assert.equal(C.levels[0].custom, true);
  assert.equal(C.levels[0].world, 'hindsight');
  assert.equal(C.worldNames.hindsight.length > 0, true);
  assert.equal(C.phases.some((p) => p.n === 9), true);
  assert.equal(typeof context.window.BBHINDSIGHT.mount, 'function');
});
