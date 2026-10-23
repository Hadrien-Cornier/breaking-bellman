'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/agents/goals.js');
const Records = require('../web/goals-record.js');
const fastSource = require('../scripts/fast-source.js');

test('every goals frame, action, count, endpoint and score comes from the matching engine walk', async () => {
  for (const goal of G.ROOMS) for (const majority of G.ACTIONS) {
    const record = await Records.create({ goal, majority });
    assert.equal(record.world, 'goals'); assert.equal(record.level, 'goals'); assert.equal(record.source, 'live');
    assert.deepEqual(record.policies.map(p => p.name), ['hidden', 'named']);
    const rows = G.rowsFor(majority === 'west' ? 3 : 1, majority === 'east' ? 3 : 1);
    assert.deepEqual(record.rows, rows);
    for (const { name } of record.policies) {
      const fitted = G.fit(rows, name === 'named'), walk = G.rollout(fitted, goal);
      assert.deepEqual(record.results[name], { walk, table: fitted.table });
      assert.deepEqual(record.series[name].map(s => s.obs), walk.path);
      assert.deepEqual(record.series[name].slice(1).map(s => s.action), walk.choices.map(c => c.action));
      assert.deepEqual(record.series[name].slice(1).map(s => s.counts), walk.choices.map(c => c.counts));
      assert.deepEqual(record.series[name].map(s => s.t), [0, 1, 2]);
      assert.ok(record.series[name].every(s => s.reward === null), 'no fabricated reward');
      assert.equal(record.metrics[name].score, Number(walk.arrived));
      assert.equal(record.metrics[name].end, walk.end);
      assert.equal(record.terminal[name], 'two-step limit');
    }
    assert.equal(record.metrics.named.arrived, true);
    assert.equal(record.metrics.hidden.arrived, goal === majority + '-room');
    assert.deepEqual(record.data, { prior: { steps: rows.length, attempts: 4 }, fresh: { steps: 0, attempts: 0 }, evaluation: { steps: 4, attempts: 2 } });
  }
});

test('goals identity follows result settings, repeats deterministically, and rejects invalid requests', async () => {
  const first = await Records.create(), repeat = await Records.create();
  assert.deepEqual(first, repeat);
  assert.notEqual(first.id, (await Records.create({ goal: 'west-room' })).id);
  assert.notEqual(first.id, (await Records.create({ majority: 'east' })).id);
  await assert.rejects(Records.create({ goal: 'hall' }));
  await assert.rejects(Records.create({ majority: 'north' }));
});

test('restoring the custom goals engine does not invalidate shared Fast caches', () => {
  assert.ok(!fastSource.engineFiles.includes('src/agents/goals.js'));
  assert.ok(Object.keys(fastSource.source().files).every(file => !file.includes('goals')));
});
