// The expected door is the mode of a count this file builds from executed rewards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../src/agents/metarl.js');

function bucket(records, conditionOnHistory) {
  const table = {};
  for (const rec of records) {
    const history = conditionOnHistory ? rec.history : '*';
    const key = history + '|' + rec.ep2.action;
    if (!table[key]) table[key] = { n: 0, s: 0 };
    table[key].n += 1;
    table[key].s += rec.ep2.reward;
  }
  return table;
}

function modeFrom(table, history) {
  const known = M.ACTIONS.map((action) => {
    const cell = table[history + '|' + action];
    return cell && cell.n > 0 ? { action: action, s: cell.s, n: cell.n } : null;
  }).filter(Boolean);
  if (!known.length) return null;
  let best = known[0];
  let tie = false;
  for (let i = 1; i < known.length; i++) {
    const cmp = known[i].s * best.n - best.s * known[i].n;
    if (cmp > 0) { best = known[i]; tie = false; }
    else if (cmp === 0) tie = true;
  }
  return tie ? null : best.action;
}

function heldScores(records, tasks, conditionOnHistory) {
  const table = bucket(records, conditionOnHistory);
  let successes = 0;
  const actions = [];
  for (const task of tasks) {
    const history = 'L:' + M.reward(task.pay, M.PROBE);
    const action = conditionOnHistory ? modeFrom(table, history) : modeFrom(table, '*');
    actions.push(action);
    successes += M.reward(task.pay, action);
  }
  return { successes: successes, tasks: tasks.length, actions: actions };
}

test('episode-2 counts follow executed rewards, and the held-out mode follows that count', () => {
  const tasks = M.taskList();
  const held = M.heldList();
  const records = M.executeTasks(tasks);
  assert.equal(records.length * 2, 12);
  const trainIds = {};
  for (const rec of records) {
    assert.equal(trainIds[rec.id], undefined);
    trainIds[rec.id] = true;
    assert.equal(rec.ep1.action, M.PROBE);
    assert.equal(rec.ep1.terminal, true);
    assert.equal(rec.ep2.terminal, true);
    assert.equal(rec.ep1.reward, M.reward(rec.pay, rec.ep1.action));
    assert.equal(rec.ep2.reward, M.reward(rec.pay, rec.ep2.action));
    assert.equal(rec.history, rec.ep1.action + ':' + rec.ep1.reward);
    assert.equal(ACTIONS_OK(rec.pay), true);
  }
  for (const task of held) assert.equal(trainIds[task.id], undefined);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(records[1].ep1.action, M.PROBE);

  const counts = bucket(records, true);
  const fitted = M.fit(records, { conditionOnHistory: true, alpha: 0 });
  for (const key of Object.keys(counts)) {
    assert.equal(fitted.table[key].n, counts[key].n);
    assert.equal(fitted.table[key].s, counts[key].s);
  }
  assert.equal(fitted.updates, records.length);
  assert.equal(Object.keys(fitted.table).reduce((sum, key) => sum + fitted.table[key].n, 0), records.length);

  const own = heldScores(records, held, true);
  const evalHeld = M.evaluate(fitted, held);
  assert.equal(M.decide(fitted, 'L:0').action, modeFrom(counts, 'L:0'));
  assert.equal(M.decide(fitted, 'L:1').action, modeFrom(counts, 'L:1'));
  assert.equal(evalHeld.updates, 0);
  assert.equal(evalHeld.observations, 2);
  assert.equal(evalHeld.expectation.successes, own.successes);
  assert.equal(evalHeld.expectation.tasks, 2);
  assert.equal(own.successes, 2);
  assert.deepEqual(evalHeld.rows.map((row) => row.choice.action), own.actions);
  assert.deepEqual(evalHeld.rows.map((row) => row.ep2.reward), [1, 1]);
});

function ACTIONS_OK(pay) { return pay === 'L' || pay === 'R'; }

test('a memoryless count of the same rewards keeps the majority door', () => {
  const records = M.executeTasks(M.taskList());
  const held = M.heldList();
  const pooled = bucket(records, false);
  const memory = M.fit(records, { conditionOnHistory: false, alpha: 0 });
  assert.equal(memory.updates, records.length);
  assert.equal(memory.table['*|L'].s, pooled['*|L'].s);
  assert.equal(memory.table['*|R'].n, pooled['*|R'].n);
  assert.equal(pooled['*|L'].s * pooled['*|R'].n > pooled['*|R'].s * pooled['*|L'].n, true);
  const own = heldScores(records, held, false);
  assert.equal(own.actions[0], own.actions[1]);
  assert.equal(own.actions[0], 'L');
  assert.equal(own.successes, 1);
  const scored = M.evaluate(memory, held);
  assert.equal(scored.expectation.successes, 1);
  assert.equal(scored.expectation.tasks, 2);
  assert.equal(scored.updates, 0);
  assert.equal(M.decide(memory, 'L:0').action, 'L');
  assert.equal(M.decide(memory, 'L:1').action, 'L');
});

test('deleting the counts removes the adapted action, and try-both still copies the paying door', () => {
  const records = M.executeTasks(M.taskList());
  const gone = M.fit(records, { conditionOnHistory: true, alpha: 0, dropCounts: true });
  assert.equal(gone.updates, 0);
  assert.deepEqual(gone.table, {});
  const decision = M.decide(gone, 'L:0');
  assert.equal(decision.action, null);
  assert.equal(decision.reason, 'unknown');
  assert.equal(M.tryBothCopyWinner('R').action, 'R');
  assert.equal(M.tryBothCopyWinner('L').action, 'L');
  assert.equal(M.tryBothCopyWinner('R').readsCounts, false);
  assert.notEqual(decision.action, M.tryBothCopyWinner('R').action);
  const smoothed = M.fit(records, { conditionOnHistory: true, alpha: 1, dropCounts: true });
  const tie = M.decide(smoothed, 'L:0');
  assert.equal(tie.action, null);
  assert.equal(tie.reason, 'tie');
  assert.equal(tie.scored[0].rate.s, 0);
  assert.equal(tie.scored[0].rate.n, 0);
  assert.equal(tie.scored[0].rate.alpha, 1);
  assert.equal(tie.scored[1].rate.alpha, 1);
});

test('a uniform policy on the two held-out tasks scores 2 of 4, which is not a claim that every draw fails', () => {
  const held = M.heldList();
  let successes = 0;
  let trials = 0;
  for (const task of held) {
    for (const action of M.ACTIONS) {
      successes += M.reward(task.pay, action);
      trials += 1;
    }
  }
  const exact = M.uniformExpectation(held);
  assert.equal(exact.successes, successes);
  assert.equal(exact.trials, trials);
  assert.equal(successes, 2);
  assert.equal(trials, 4);
});

test('re-executing with a new training contingency changes the held-out action', () => {
  const original = M.executeTasks(M.taskList());
  const changed = M.executeTasks(M.retargetLeft(M.taskList()));
  for (const rec of changed) {
    assert.equal(rec.pay, 'L');
    assert.equal(rec.ep2.reward, M.reward('L', rec.ep2.action));
    assert.equal(rec.history, 'L:1');
  }
  const before = M.fit(original, { conditionOnHistory: true, alpha: 0 });
  const after = M.fit(changed, { conditionOnHistory: true, alpha: 0 });
  const beforeMode = modeFrom(bucket(original, true), 'L:0');
  const afterMode = modeFrom(bucket(changed, true), 'L:0');
  assert.equal(M.decide(before, 'L:0').action, beforeMode);
  assert.equal(M.decide(after, 'L:0').action, afterMode);
  assert.equal(beforeMode, 'R');
  assert.equal(afterMode, null);
  assert.equal(M.decide(after, 'L:0').reason, 'unknown');
  const heldBefore = M.evaluate(before, M.heldList());
  const heldAfter = M.evaluate(after, M.heldList());
  assert.equal(heldBefore.expectation.successes, 2);
  assert.equal(heldAfter.expectation, null);
  assert.equal(before.rate('L:0', 'R').s, 1);
  assert.equal(before.rate('L:0', 'R').n, 1);
  assert.equal(after.rate('L:0', 'R'), null);
});

test('an edited reward that contradicts the hidden door changes the count, and a tie stays a tie', () => {
  const records = M.executeTasks(M.taskList());
  const edited = M.withReward(M.withReward(records, 'train-R1', 0), 'train-R2', 1);
  assert.equal(edited.find((rec) => rec.id === 'train-R1').pay, 'R');
  assert.equal(edited.find((rec) => rec.id === 'train-R1').ep2.reward, 0);
  const fitted = M.fit(edited, { conditionOnHistory: true, alpha: 0 });
  assert.equal(M.decide(fitted, 'L:0').action, modeFrom(bucket(edited, true), 'L:0'));
  assert.equal(M.decide(fitted, 'L:0').action, 'L');
  const tied = [
    { id: 'a', pay: 'L', history: 'L:0', ep1: { action: 'L', reward: 0, terminal: true }, ep2: { action: 'L', reward: 0, terminal: true } },
    { id: 'b', pay: 'L', history: 'L:0', ep1: { action: 'L', reward: 0, terminal: true }, ep2: { action: 'R', reward: 0, terminal: true } },
  ];
  const tieFit = M.fit(tied, { conditionOnHistory: true, alpha: 0 });
  assert.equal(M.decide(tieFit, 'L:0').reason, 'tie');
  assert.equal(M.decide(tieFit, 'L:0').action, null);
});

test('an unseen first-door history is unknown, and a task where nothing pays scores 0 on the transferred action', () => {
  const records = M.executeTasks(M.taskList());
  const fitted = M.fit(records, { conditionOnHistory: true, alpha: 0 });
  const unseen = M.decide(fitted, 'R:1');
  assert.equal(unseen.action, null);
  assert.equal(unseen.reason, 'unknown');
  const before = JSON.stringify(fitted.table);
  const shifted = M.evaluate(fitted, [{ id: 'hold-none', pay: 'none' }]);
  assert.equal(JSON.stringify(fitted.table), before);
  assert.equal(shifted.updates, 0);
  assert.equal(shifted.rows[0].history, 'L:0');
  assert.equal(shifted.rows[0].choice.action, M.decide(fitted, 'L:0').action);
  assert.equal(shifted.rows[0].ep2.reward, 0);
  assert.equal(shifted.rows[0].id, 'hold-none');
});

test('scrambling the hidden door and the task id leaves the fit in place, so an id table does not transfer', () => {
  const records = M.executeTasks(M.taskList());
  const fitted = M.fit(records, { conditionOnHistory: true, alpha: 0 });
  const scrambled = records.map((rec) => ({
    id: 'other-' + rec.id,
    pay: rec.pay === 'L' ? 'R' : 'L',
    history: rec.history,
    ep1: { action: rec.ep1.action, reward: rec.ep1.reward, terminal: true },
    ep2: { action: rec.ep2.action, reward: rec.ep2.reward, terminal: true },
  }));
  const again = M.fit(scrambled, { conditionOnHistory: true, alpha: 0 });
  assert.equal(again.table['L:0|R'].s, fitted.table['L:0|R'].s);
  assert.equal(again.table['L:1|L'].n, fitted.table['L:1|L'].n);
  assert.equal(M.decide(again, 'L:0').action, M.decide(fitted, 'L:0').action);
  const ids = M.idMemory(records);
  assert.equal(ids['hold-R'], undefined);
  assert.equal(ids['hold-L'], undefined);
  assert.equal(ids['train-R1'], 'R');
  assert.equal(M.decide(fitted, 'L:0').action, 'R');
  assert.equal(Object.prototype.hasOwnProperty.call(ids, 'hold-R'), false);
});

test('the lesson id mounts after hindsight and does not replace a peer', () => {
  const context = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'hindsight' }, { id: 'supermimic' }, { id: 'replan' }], worldNames: {} },
      BBMETARL: M,
    },
  });
  vm.runInContext(fs.readFileSync('web/metarl-level.js', 'utf8'), context);
  const ids = context.window.CONTENT.levels.map((level) => level.id);
  assert.deepEqual(ids, ['hindsight', 'metarl', 'supermimic', 'replan']);
  const alone = vm.createContext({
    window: {
      CONTENT: { phases: [], levels: [{ id: 'supermimic' }], worldNames: {} },
      BBMETARL: M,
    },
  });
  vm.runInContext(fs.readFileSync('web/metarl-level.js', 'utf8'), alone);
  assert.deepEqual(alone.window.CONTENT.levels.map((level) => level.id), ['metarl', 'supermimic']);
  const lesson = context.window.CONTENT.levels.find((level) => level.id === 'metarl');
  assert.equal(lesson.custom, true);
  assert.equal(lesson.world, 'metarl');
  assert.equal(lesson.phase, 9);
  assert.equal(context.window.CONTENT.worldNames.metarl.length > 0, true);
  assert.equal(typeof M.mount, 'function');
  assert.equal(context.window.CONTENT.phases.filter((phase) => phase.n === 9).length, 1);
});

test('run record replays actual openings with resets and feedback, without inventing deleted actions', () => {
  for (const contingency of ['original', 'left']) for (const held of ['balanced', 'none']) {
    const settings = { contingency, held };
    const r = M.runRecord(settings);
    assert.equal(r.level, 'metarl'); assert.equal(r.world, 'metarl'); assert.equal(r.source, 'live');
    assert.deepEqual(r.settings, settings);
    assert.deepEqual(r.data.prior, { steps: 0, attempts: 0 });
    const training = M.executeTasks(contingency === 'left' ? M.retargetLeft(M.taskList()) : M.taskList());
    assert.deepEqual(r.training, training);
    const tasks = M.heldList().map(t => held === 'none' ? { ...t, pay: 'none' } : t);
    let interactions = training.length * 2;
    for (const policy of r.policies) {
      const name = policy.name;
      const evaluation = M.evaluate(M.fit(training, { conditionOnHistory: name !== 'memoryless', dropCounts: name === 'deleted' }), tasks);
      assert.deepEqual(r.metrics[name].rows, evaluation.rows);
      assert.deepEqual(r.metrics[name].score, evaluation.expectation);
      assert.equal(r.metrics[name].updates, 0);
      const events = r.events[name];
      assert.deepEqual(events.map(e => e.t), events.map((_, i) => i));
      assert.equal(events.filter(e => e.kind === 'open').length, 12 + evaluation.interactions);
      assert.equal(events.filter(e => e.kind === 'feedback').length, 12 + evaluation.interactions);
      const rows = [...training, ...evaluation.rows];
      for (const row of rows) {
        const observed = events.filter(e => e.task === row.id);
        assert.deepEqual(observed.map(e => e.kind), row.ep2 ? ['reset', 'open', 'feedback', 'reset', 'open', 'feedback'] : ['reset', 'open', 'feedback', 'reset', 'stop']);
        assert.equal(observed[0].action, null); assert.equal(observed[3].action, null);
        assert.equal(observed[0].episode, 1); assert.equal(observed[3].episode, 2);
        for (const event of observed.filter(e => e.kind === 'feedback')) {
          const ep = event.episode === 1 ? row.ep1 : row.ep2;
          assert.equal(event.action, ep.action); assert.equal(event.reward, ep.reward);
          assert.equal(event.reward, M.reward(row.pay, event.action)); assert.equal(event.terminal, true);
        }
      }
      assert.equal(r.series[name].length, events.length);
      assert.equal(r.terminal[name].length, tasks.length);
      if (name === 'deleted') {
        assert.equal(events.filter(e => e.kind === 'stop').length, 2);
        assert.ok(r.terminal[name].every(e => e.reason === 'unknown'));
      }
      interactions += evaluation.interactions;
    }
    assert.deepEqual(r.data.fresh, { steps: interactions, attempts: interactions });
    assert.deepEqual(M.runRecord(settings), r, 'deterministic record identity and measured events');
  }
  assert.equal(M.runRecord().data.fresh.steps, 22);
  assert.notEqual(M.runRecord().id, M.runRecord({ contingency: 'left' }).id);
  assert.throws(() => M.runRecord({ held: 'invalid' }));
});

test('Meta-RL is an open campaign root and does not invalidate the shared Fast engine', () => {
  const context = vm.createContext({ window: { CONTENT: { phases: [], levels: [{ id: 'supermimic' }], worldNames: {} }, BBMETARL: M } });
  vm.runInContext(fs.readFileSync('web/metarl-level.js', 'utf8'), context);
  const graph = require('../web/level-graph.js').create(context.window.CONTENT.levels);
  assert.deepEqual(graph.parents('metarl'), []);
  assert.equal(graph.levels.find(l => l.id === 'metarl').world, 'w6');
  assert.ok(['open', 'next'].includes(graph.status('metarl', [])));
  assert.equal(require('../scripts/fast-source.js').engineFiles.includes('src/agents/metarl.js'), false);
});
