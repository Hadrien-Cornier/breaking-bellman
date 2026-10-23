const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/agents/hindsight.js');
const O = require('../src/agents/hierarchy.js');
const replay = require('../web/goal-execution.js');

test('hindsight stored transitions, greedy paths, stops and accounting match every engine output', () => {
  for (const sweeps of [1, 2]) {
    const report = H.compare({ sweeps }), before = JSON.stringify(report);
    const r = replay.record('hindsight', { sweeps }, report);
    assert.equal(JSON.stringify(report), before);
    assert.equal(r.data.prior.steps, 4);
    assert.equal(r.data.prior.attempts, 2);
    assert.equal(r.data.fresh.attempts, 15);
    assert.deepEqual(r.stored.filter(e => e.kind === 'move').map(e => [e.from, e.action, e.to, e.reward, e.goal, e.truncated]), report.original.map(e => [e.s, e.a, e.sp, e.reward, e.g, e.truncated]));
    assert.deepEqual(r.stored.filter(e => e.kind === 'start').map(e => [e.commanded, e.achieved]), report.episodes.map(e => [e.commanded, e.achieved]));
    let totalSteps = 0;
    for (const [key, mode] of Object.entries(report.modes)) {
      for (const [goal, roll] of Object.entries(mode.rolls)) {
        const events = r.events[key].filter(e => e.goal === goal);
        assert.deepEqual(events.filter(e => e.kind !== 'stop').map(e => e.to), roll.path);
        assert.deepEqual(events.filter(e => e.kind === 'move').map(e => e.action), roll.actions);
        assert.equal(events.at(-1).reason, roll.reason);
        assert.equal(r.terminal[key][goal], roll.reason);
        totalSteps += roll.actions.length;
      }
      assert.equal(r.metrics[key].updates, mode.updates);
      assert.equal(r.metrics[key].solved, mode.heldout);
    }
    assert.equal(r.data.fresh.steps, totalSteps);
    if (sweeps === 1) assert.equal(r.metrics.hindsight.solved, 0);
    else assert.equal(r.metrics.hindsight.solved, 2);
  }
});

test('hierarchy chronology retains every reset, option boundary and move, including failed calls', () => {
  for (const settings of [{}, { dynamics: 'pit' }, { representation: 'absolute' }, { budget: 4 }, { budget: 24 }, { subgoals: [2, 5] }, { pretrain: 6 }]) {
    const report = O.compare(settings), r = replay.record('hierarchy', settings, report);
    for (const policy of ['skill', 'flat', 'shaped']) {
      const run = report[policy], training = r.events[policy].filter(e => e.phase === 'training' && e.kind !== 'start');
      assert.deepEqual(training.map(e => e.kind), run.log.map(e => e.kind));
      assert.equal(training.filter(e => e.kind === 'reset').length, run.resets);
      assert.deepEqual(training.filter(e => e.kind === 'move').map(e => [e.from, e.to, e.action, e.reward]), run.moves.map(e => [e.pos, e.next, e.action, e.reward]));
      const final = replay.frame(r, policy, r.events[policy].length - 1);
      assert.equal(final.resets, run.resets);
    }
    for (const [key, engine] of [['skill', report.execution], ['none', report.none], ['wiped', report.wiped]]) {
      const events = r.events[key].filter(e => e.phase === 'execution');
      assert.deepEqual(events.filter(e => e.kind === 'call').map(e => [e.goal, e.atPrimitive]), engine.options.map(e => [e.goal, e.atPrimitive]));
      assert.deepEqual(events.filter(e => e.kind === 'move').map(e => [e.from, e.to, e.action, e.goal, e.reward]), engine.moves.map(e => [e.pos, e.next, e.action, e.goal, e.reward]));
      engine.options.forEach((op, i) => {
        const call = events.filter(e => e.call === i + 1);
        assert.equal(call[0].kind, 'call'); assert.equal(call.at(-1).kind, 'stop');
        assert.equal(call.filter(e => e.kind === 'move').length, op.steps);
        assert.equal(call.at(-1).to, op.final);
        assert.equal(call.at(-1).reason, op.terminated ? 'subgoal reached' : op.fell ? 'pit' : 'option cap');
      });
    }
    const freshEvents = Object.values(r.events).flat();
    assert.equal(r.data.fresh.steps, freshEvents.filter(e => e.kind === 'move').length);
    assert.equal(r.data.fresh.resets, freshEvents.filter(e => e.kind === 'reset').length);
    assert.equal(r.data.fresh.attempts, freshEvents.filter(e => ['start', 'reset'].includes(e.kind)).length);
    assert.equal(r.data.optionCalls, freshEvents.filter(e => e.kind === 'call').length);
    assert.equal(r.data.prior.steps, r.prior.filter(e => e.kind === 'move').length);
    assert.equal(report.flat.interactions, report.S + report.H);
    assert.equal(report.shaped.interactions, report.S + report.H);
  }
});

test('replay frame projection is pure and record identity changes with measured settings', () => {
  const a = replay.record('hindsight', { sweeps: 1 }, H.compare({ sweeps: 1 }));
  const b = replay.record('hindsight', { sweeps: 2 }, H.compare({ sweeps: 2 }));
  assert.notEqual(a.id, b.id);
  assert.deepEqual(b, replay.record('hindsight', { sweeps: 2 }, H.compare({ sweeps: 2 })));
  const before = JSON.stringify(b);
  for (const key of ['stored', ...b.policies.map(p => p.name)]) {
    for (let t = 0; t < 20; t++) assert.deepEqual(replay.frame(b, key, t), replay.frame(b, key, t));
  }
  assert.equal(JSON.stringify(b), before);
});

test('returning lesson engines do not invalidate existing shared Fast source keys', () => {
  const source = require('../scripts/fast-source.js');
  assert.ok(!source.engineFiles.some(f => /hindsight|hierarchy/.test(f)));
  assert.ok(!Object.keys(source.source().files).some(f => /hindsight|hierarchy/.test(f)));
});
