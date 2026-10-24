'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/agents/elbo.js');
const M = require('../src/agents/messages.js');
const R = require('../web/inference-record.js');
const exact = require('../src/sim/exact.js');

test('ELBO records every engine update for each named method, including hard zeros', async () => {
  for (const weights of [E.narrowWeights(), E.evenWeights(), E.hardGlareWeights()]) {
    for (const rounds of [2, 8, 16]) for (const step of [.25, .5, 1]) {
      const settings = { weights, rounds, step }, record = await R.create('elbo', settings);
      assert.deepEqual(record.settings, settings);
      assert.deepEqual(record.data.fresh, { steps: 0, attempts: 0 });
      assert.equal(record.data.prior.observations, 1);
      assert.deepEqual(record.policies.map(p => p.name), ['elbo', 'reconstruction']);
      for (const { name } of record.policies) {
        const result = E.optimize(E.LESSON, E.distribution(weights, E.CAUSES), { rounds, step, objective: name });
        assert.deepEqual(record.results[name], result);
        assert.deepEqual(record.events[name].map(e => e.measurement), result.steps);
        assert.deepEqual(record.events[name].map(e => e.t), Array.from({ length: rounds + 1 }, (_, i) => i));
        assert.equal(record.metrics[name].elbo, result.steps.at(-1).elbo);
        assert.equal(record.metrics[name].gap, result.steps.at(-1).gap);
        assert.equal(record.terminal[name], 'update-budget');
        for (const event of record.events[name]) assert(Math.abs(event.measurement.gap - event.measurement.klPosterior) < 1e-9);
      }
      assert.equal(R.length(record), rounds + 1);
    }
  }
});

test('Messages records real backward computation before any forward decision', async () => {
  for (const prior of [M.LESSON.prior, M.STRONG_PRIOR, M.ZERO_RIGHT]) {
    for (const horizon of [1, 2, 3]) for (const goal of [0, 1, 2]) for (const miss of [0, .05]) {
      const settings = { prior, horizon, goal, miss }, record = await R.create('messages', settings);
      let moves = 0;
      for (const { name } of record.policies) {
        const result = M.solve({ ...settings, policy: name }), events = record.events[name];
        assert.deepEqual(record.results[name], result);
        assert.equal(events[0].kind, 'terminal');
        assert.deepEqual(events.slice(1, horizon + 1).map(e => e.time), Array.from({ length: horizon }, (_, i) => horizon - i));
        const backups = events.filter(e => e.kind === 'backup');
        for (const event of backups) for (const s of M.STATES) for (const a of M.ACTIONS) {
          const row = result.rows.find(r => r.t === event.time && r.state === s && r.action === a);
          assert.equal(event.actionMessage[s][a], row.beta);
          assert.equal(event.stateMessage[s], row.betaState);
          assert.equal(event.posterior[s]?.[a] ?? null, row.posterior);
        }
        const decisions = events.slice(horizon + 1);
        assert.equal(decisions.length, result.steps.length);
        decisions.forEach((e, i) => {
          const step = result.steps[i];
          assert.equal(e.time, step.t); assert.equal(e.state, step.state); assert.equal(e.action, step.action);
          if (step.defined) assert.equal(e.next, M.LESSON.transitions[step.state][step.action]);
          else assert.equal(e.kind, 'undefined');
        });
        if (result.path) assert.deepEqual([result.start, ...record.series[name].map(s => s.next)], result.path);
        if (result.impossible) {
          assert.equal(record.terminal[name], 'undefined-distribution');
          assert.equal(events.at(-1).action, null);
          assert.equal(record.metrics[name].end, null);
        }
        moves += result.steps.filter(s => s.defined).length;
      }
      assert.deepEqual(record.data.fresh, { steps: 0, attempts: 0 });
      assert.equal(record.data.evaluation.steps, moves);
    }
  }
});

test('undefined and stochastic distributions do not manufacture a trajectory', async () => {
  const impossible = await R.create('messages', { horizon: 1, goal: 2, miss: 0, prior: M.LESSON.prior });
  assert.equal(impossible.series.conditioned.length, 0);
  assert.equal(impossible.events.conditioned.at(-1).kind, 'undefined');
  const transitions = structuredClone(M.LESSON.transitions);
  transitions[0].right = { 0: .5, 1: .5 };
  const stochastic = await R.create('messages', { transitions });
  for (const p of stochastic.policies) {
    assert.equal(stochastic.results[p.name].path, null);
    assert.equal(stochastic.series[p.name].length, 0);
    assert.equal(stochastic.terminal[p.name], 'stochastic-no-path');
    assert(stochastic.events[p.name].every(e => e.kind !== 'move'));
  }
});

test('identity follows meaningful settings and replay cannot mutate or recompute the engine', async () => {
  const settings = { weights: E.narrowWeights(), rounds: 8, step: .5 };
  const a = await R.create('elbo', settings), b = await R.create('elbo', settings);
  assert.equal(a.id, b.id);
  const c = await R.create('elbo', { ...settings, rounds: 2 });
  assert.notEqual(a.id, c.id);
  settings.weights.glare = 0;
  assert.equal(a.settings.weights.glare, 30);
  const snapshot = exact.stringify(a);
  const expected = R.frame(a, 3);
  R.frame(a, 8); R.frame(a, 0);
  assert.deepEqual(R.frame(a, 3), expected);
  assert.equal(exact.stringify(a), snapshot);
  assert.notDeepEqual(a.metrics.elbo, c.metrics.elbo);
  const base = await R.create('messages', { prior: M.LESSON.prior, horizon: 2, goal: 2, miss: .05 });
  const strong = await R.create('messages', { ...base.settings, prior: M.STRONG_PRIOR });
  assert.equal(base.metrics.conditioned.end, 2);
  assert.equal(strong.metrics.conditioned.end, 0);
});
