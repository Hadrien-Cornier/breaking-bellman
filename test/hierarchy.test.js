// Mechanism checks for one goal-conditioned option. Values are the online backup of the
// executed transitions, recomputed here, not a stored prize path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/agents/hierarchy.js');

function independentFold(moves) {
  const q = {};
  const get = (k) => Object.prototype.hasOwnProperty.call(q, k) ? q[k] : H.INIT;
  for (const m of moves) {
    const cont = m.terminal ? 0 : H.GAMMA * Math.max(get(m.spKey + '|L'), get(m.spKey + '|R'));
    q[m.key + '|' + m.action] = m.reward + cont;
  }
  return q;
}

function independentExecute(q, subgoals, dynamics) {
  let pos = 0;
  const actions = [];
  const nexts = [];
  for (const goal of subgoals) {
    let steps = 0;
    while (steps < 8 && pos !== goal && pos !== H.PIT) {
      const key = H.keyOf('relative', pos, goal);
      const action = H.greedy(q, key);
      const next = H.step(dynamics, pos, action);
      actions.push(action);
      nexts.push(next);
      pos = next;
      steps += 1;
    }
  }
  return { actions: actions, nexts: nexts, pos: pos };
}

test('door training updates only from its own transitions, and the empty table does not walk right', () => {
  const report = H.compare();
  const again = H.compare();
  assert.deepEqual(again.skill.q, report.skill.q);
  assert.equal(report.extra, 0);
  assert.equal(report.extraRun, null);
  assert.equal(report.highLevel.learned, false);
  assert.equal(report.highLevel.source, 'given');
  assert.equal(report.highLevel.updates, 0);
  assert.deepEqual(report.highLevel.subgoals, [H.DOOR, H.PRIZE]);
  assert.equal(report.skill.goal, H.DOOR);
  assert.equal(report.skill.shaping, false);
  assert.ok(report.skill.moves.every((m) => m.goal === H.DOOR && m.behavior === true));
  assert.ok(report.skill.moves.some((m) => m.action === 'L'));
  assert.ok(report.skill.log.some((ev) => ev.kind === 'reset'));
  assert.equal(report.skill.updates, report.skill.moves.length);
  assert.equal(report.skill.steps + report.skill.resets, report.S);
  assert.equal(report.S, H.BUDGET);
  const own = independentFold(report.skill.moves);
  assert.deepEqual(own, report.skill.q);
  assert.equal(own['1|R'], 1);
  assert.equal(own['2|R'], H.GAMMA * own['1|R']);
  const warm = H.learn(Object.assign(H.lesson(), { goal: H.DOOR }), { '2|R': 99, '1|R': 99 });
  const cold = H.interact(Object.assign(H.lesson(), { goal: H.DOOR }));
  assert.deepEqual(warm.moves.map((m) => [m.pos, m.action, m.next]), cold.moves.map((m) => [m.pos, m.action, m.next]));
  assert.equal(report.none.moves[0].action, 'L');
  assert.equal(report.none.reachedPrize, false);
  const cleared = Object.assign({}, report.skill.q);
  Object.keys(cleared).forEach((k) => delete cleared[k]);
  const wiped = H.execute(cleared, report.opts);
  assert.equal(wiped.moves[0].action, 'L');
  assert.equal(wiped.reachedPrize, false);
  assert.notEqual(wiped.moves[0].action, report.execution.moves[0].action);
  assert.throws(() => H.step('repeat', 0, 'U'), /illegal action/);
});

test('the second call reuses the door offset, and the flat budget is S plus H', () => {
  const report = H.compare();
  assert.equal(report.execution.updates, 0);
  assert.equal(report.execution.calls, report.highLevel.subgoals.length);
  assert.notEqual(report.execution.calls, report.execution.primitive);
  assert.equal(report.H, report.execution.primitive + report.execution.calls);
  assert.equal(report.execution.options[1].atPrimitive, report.execution.options[0].steps);
  assert.equal(report.execution.options[0].terminated, true);
  assert.equal(report.execution.options[0].final, H.DOOR);
  assert.equal(report.flat.interactions, report.S + report.H);
  assert.equal(report.flat.steps + report.flat.resets, report.flat.interactions);
  assert.equal(report.flat.updates, report.flat.moves.length);
  assert.ok(report.flat.moves.every((m) => m.goal === H.PRIZE));
  assert.ok(report.flat.goalEntries > 0);
  assert.equal(report.flat.goalEntries, report.flat.moves.filter((m) => m.reached).length);
  assert.equal(report.flat.greedy.reached, false);
  assert.equal(report.execution.reachedPrize, true);
  const rolled = independentExecute(report.skill.q, [H.DOOR, H.PRIZE], 'repeat');
  assert.deepEqual(rolled.actions, report.execution.moves.map((m) => m.action));
  assert.equal(rolled.pos, H.PRIZE);
  assert.equal(H.greedy(report.skill.q, H.keyOf('relative', H.DOOR, H.PRIZE)), 'R');
  assert.equal(H.keyOf('relative', 0, H.DOOR), H.keyOf('relative', H.DOOR, H.PRIZE));
  for (const m of report.skill.moves.concat(report.execution.moves, report.flat.moves)) {
    assert.equal(H.step(report.dynamics, m.pos, m.action), m.next);
    assert.ok(m.action === 'L' || m.action === 'R');
    assert.ok(Math.abs(m.next - m.pos) <= 1);
    const base = m.next === m.goal ? 1 : 0;
    assert.equal(m.reward, base + (m.doorBonus || 0));
  }
  const shapedDoor = report.shaped.moves.filter((m) => m.next === H.DOOR && m.pos !== H.DOOR);
  const plainDoor = report.flat.moves.filter((m) => m.next === H.DOOR && m.pos !== H.DOOR);
  assert.ok(shapedDoor.length > 0 && plainDoor.length > 0);
  assert.ok(shapedDoor.every((m) => m.reward === 1));
  assert.ok(plainDoor.every((m) => m.reward === 0));
  assert.notDeepEqual(report.flat.q, report.shaped.q);
  assert.deepEqual(independentFold(report.flat.moves), report.flat.q);
  assert.deepEqual(independentFold(report.shaped.moves), report.shaped.q);
  assert.equal(report.shaped.greedy.reached, false);
  assert.equal(report.shaped.interactions, report.S + report.H);
});

test('altered training rewards change the table, and reuse fails when the assumption changes', () => {
  const report = H.compare();
  const altered = report.skill.moves.map((m) => Object.assign({}, m));
  const hits = altered.filter((m) => m.reached);
  assert.ok(hits.length > 1);
  hits.forEach((m) => { m.reward = 0; m.terminal = false; });
  const qHit = independentFold(report.skill.moves);
  const qAlt = independentFold(altered);
  assert.equal(qHit[hits[0].key + '|' + hits[0].action], report.skill.q[hits[0].key + '|' + hits[0].action]);
  assert.notEqual(qAlt[hits[0].key + '|' + hits[0].action], qHit[hits[0].key + '|' + hits[0].action]);
  assert.deepEqual(H.fold(altered, {}).q, qAlt);

  const pit = H.compare({ dynamics: 'pit' });
  assert.equal(pit.execution.options[0].reached, true);
  assert.equal(pit.execution.options[1].fell, true);
  assert.equal(pit.execution.reachedPrize, false);
  assert.equal(H.step('pit', 3, 'R'), H.PIT);
  assert.equal(H.step('repeat', 3, 'R'), 4);
  const pitFall = pit.execution.moves.find((m) => m.next === H.PIT);
  assert.equal(pitFall.pos, 3);
  assert.equal(pitFall.action, 'R');
  assert.equal(pitFall.reward, 0);

  const abs = H.compare({ representation: 'absolute' });
  assert.equal(abs.execution.options[0].reached, true);
  assert.equal(abs.execution.reachedPrize, false);
  assert.equal(H.greedy(abs.skill.q, H.keyOf('absolute', H.DOOR, H.PRIZE)), 'L');
  assert.equal(abs.execution.options[1].moves[0].action, 'L');
  assert.ok(abs.skill.moves.every((m) => m.key.indexOf('@') >= 0));

  const far = H.compare({ subgoals: [H.DOOR, H.FAR] });
  assert.equal(far.execution.reachedPrize, false);
  assert.equal(Object.prototype.hasOwnProperty.call(far.skill.q, '3|R'), false);
  assert.equal(H.greedy(far.skill.q, H.keyOf('relative', H.DOOR, H.FAR)), 'L');

  const short = H.compare({ budget: 4 });
  assert.equal(short.execution.options[0].reached, false);
  assert.equal(short.execution.moves[0].action, 'L');
  assert.equal(short.skill.q['2|R'], 0);
  assert.equal(short.S, 4);
  assert.equal(short.flat.interactions, short.S + short.H);

  const long = H.compare({ budget: 24 });
  assert.equal(long.execution.reachedPrize, true);
  assert.equal(long.flat.greedy.reached, true);
  assert.equal(long.shaped.greedy.reached, false);
  assert.notEqual(long.total, report.total);
  assert.equal(H.greedyRollout(independentFold(long.flat.moves), long.opts, H.PRIZE).reached, true);

  const extra = H.compare({ pretrain: 6 });
  assert.equal(extra.extra, 6);
  assert.equal(extra.S, H.BUDGET);
  assert.equal(extra.flat.interactions, extra.S + extra.H);
  assert.notEqual(extra.skill.q['2|L'], report.skill.q['2|L']);
  assert.ok(extra.extraRun.interactions === 6);
});

test('the lesson id mounts on its own and does not replace neighboring lessons', () => {
  const alone = vm.createContext({
    window: { CONTENT: { phases: [], levels: [], worldNames: {} }, BBHIERARCHY: H },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/hierarchy-level.js', 'utf8'), alone);
  const C = alone.window.CONTENT;
  assert.deepEqual(C.levels.map((l) => l.id), ['hierarchy']);
  assert.equal(C.levels[0].custom, true);
  assert.equal(C.levels[0].world, 'hierarchy');
  assert.equal(C.levels[0].phase, 9);
  assert.equal(C.worldNames.hierarchy, 'Two rooms');
  assert.equal(C.phases.filter((p) => p.n === 9).length, 1);
  assert.equal(typeof H.mount, 'function');

  const after = vm.createContext({
    window: {
      CONTENT: { phases: [{ n: 9, title: 'Multi-task goals' }], levels: [{ id: 'hindsight' }, { id: 'supermimic' }], worldNames: {} },
      BBHIERARCHY: H,
    },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/hierarchy-level.js', 'utf8'), after);
  assert.deepEqual(after.window.CONTENT.levels.map((l) => l.id), ['hindsight', 'hierarchy', 'supermimic']);
  assert.equal(after.window.CONTENT.phases.filter((p) => p.n === 9).length, 1);

  const goalsOnly = vm.createContext({
    window: { CONTENT: { phases: [], levels: [{ id: 'goals' }], worldNames: {} }, BBHIERARCHY: H },
    document: { getElementById: () => null, head: { append: () => {} }, createElement: () => ({}) },
  });
  vm.runInContext(fs.readFileSync('web/hierarchy-level.js', 'utf8'), goalsOnly);
  assert.deepEqual(goalsOnly.window.CONTENT.levels.map((l) => l.id), ['goals', 'hierarchy']);
});
