'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/agents/skew.js');
const records = require('../web/skew-record.js');
const { create: adapter } = require('../web/scene-adapter.js');
const opts = { visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 };

test('every recorded request and outcome matches the engine and rebuilds its counts', async () => {
  const record = await records.create(opts), expected = K.compare(opts);
  for (const { name } of record.policies) {
    const events = record.events[name], run = expected[name];
    assert.deepEqual(record.results[name], run);
    assert.equal(events.length, 2 * opts.budget);
    const requested = { A: 0, B: 0, C: 0 }, achieved = { A: 0, B: 0, C: 0, Hall: 0 };
    for (let i = 0; i < opts.budget; i++) {
      const request = events[2 * i], outcome = events[2 * i + 1];
      assert.equal(request.t, 2 * i); assert.equal(outcome.t, 2 * i + 1);
      assert.equal(request.kind, 'request'); assert.equal(outcome.kind, 'outcome');
      assert.equal(request.attempt, i + 1); assert.equal(outcome.attempt, i + 1);
      assert.equal(request.goal, run.draw.requested[i]); assert.equal(outcome.goal, request.goal);
      assert.equal(request.state, 'Hall'); requested[request.goal]++;
      // Independent expected dynamics: a sealed request cannot enter, every other request resets.
      assert.equal(outcome.state, request.goal === opts.sealed ? 'Hall' : request.goal);
      assert.equal(outcome.success, request.goal !== opts.sealed);
      assert.equal(outcome.action, request.goal === opts.sealed ? 'sealed' : 'reset');
      achieved[outcome.state]++;
    }
    assert.deepEqual(requested, run.draw.observed); assert.deepEqual(achieved, run.achieved);
    assert.deepEqual(record.metrics[name].fresh, { steps: 627, attempts: 627 });
    assert.equal(record.terminal[name], 'budget-exhausted');
    assert.deepEqual(records.frame(record, name, events.length - 1).counts, achieved);
  }
  assert.equal(record.data.prior.visits, 8);
  assert.equal(record.data.prior.steps, null); assert.equal(record.data.prior.attempts, null);
  assert.deepEqual(record.data.fresh, { steps: 1881, attempts: 1881 });
});

test('undefined inverse produces no sample, no frames and no spent attempts', async () => {
  const r = await records.create({ ...opts, smoothing: 0 });
  assert.deepEqual(r.events.inverse, []); assert.deepEqual(r.results.inverse.draw.requested, []);
  assert.equal(r.metrics.inverse.fresh.attempts, 0);
  assert.match(r.terminal.inverse, /undefined/);
  assert.equal(records.frame(r, 'inverse', 0).event, null);
  assert.equal(r.data.fresh.attempts, 1254);
  // The other methods still run. No pretend successes leak into measured records.
  for (const name of ['uniform', 'proportional']) assert.equal(r.metrics[name].achieved.C, 0);
  const allZero = await records.create({ ...opts, visits: { A: 0, B: 0, C: 0 }, smoothing: 0 });
  assert.equal(allZero.events.proportional.length, 0);
  assert.equal(allZero.events.uniform.length, 1254);
});

test('changing the door changes outcomes without changing requests, even with historical visits', async () => {
  const open = await records.create({ ...opts, visits: { A: 5, B: 4, C: 0 }, sealed: null });
  const sealed = await records.create({ ...opts, visits: { A: 5, B: 4, C: 0 }, sealed: 'B' });
  for (const { name } of sealed.policies) {
    assert.deepEqual(open.results[name].draw.requested, sealed.results[name].draw.requested);
    assert.ok(open.metrics[name].achieved.B > 0); assert.equal(sealed.metrics[name].achieved.B, 0);
    assert.ok(sealed.metrics[name].achieved.C > 0);
    assert.equal(sealed.metrics[name].achieved.Hall, sealed.metrics[name].requested.B);
  }
  assert.notEqual(open.id, sealed.id);
});

test('stable identity includes meaningful settings, internal sample and code version', async () => {
  const r = await records.create(opts), same = await records.create({ ...opts, pretend: true });
  assert.equal(r.id, same.id); assert.equal(r.version, records.VERSION);
  assert.equal(same.metrics.inverse.achieved.C, 0);
  assert.equal(r.policies.length, 3); assert(!r.policies.some(p => /seed|23/.test(p.label)));
  for (const changes of [{ budget: 1 }, { smoothing: 2 }, { visits: { A: 1, B: 2, C: 3 } }, { seed: 5 }]) {
    assert.notEqual((await records.create({ ...opts, ...changes })).id, r.id);
  }
});

test('scene adapter projections are pure, preserve event chronology and reject another world', async () => {
  const r = await records.create(opts), original = JSON.stringify(r), outputs = [];
  const a = adapter({ world: 'skew', settings: ['visits', 'smoothing', 'sealed', 'budget'],
    render: (el, record, t) => { if (t === null) return record.events.inverse.length;
      const value = records.frame(record, 'inverse', t); outputs.push(value); return value; } });
  a.mount({}); assert.equal(outputs[0], null);
  assert.equal(a.length(r), 1254);
  for (let i = 0; i < a.length(r); i++) {
    a.draw(r, i); assert.deepEqual(outputs.at(-1).event, r.events.inverse[i]);
    if (outputs.at(-1).event.goal === 'C') assert.equal(outputs.at(-1).event.state, 'Hall');
  }
  a.draw(r, 3); const first = outputs.at(-1); a.draw(r, 3); assert.deepEqual(outputs.at(-1), first);
  assert.equal(JSON.stringify(r), original);
  assert.throws(() => a.draw({ ...r, world: 'cliff' }, 0), /different world/);
});
