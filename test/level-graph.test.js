'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create, edges, worlds } = require('../web/level-graph.js');
const approved = require('./fixtures/level-graph.json');

// Use the actual build registration order, including both custom lessons.
function content(beforeGraph) {
  const build = fs.readFileSync(require.resolve('../build.mjs'), 'utf8');
  const files = JSON.parse(build.match(/const CONTENT_FILES = (\[[^;]+\]);/)[1].replaceAll("'", '"'));
  const context = vm.createContext({ window: {}, structuredClone });
  context.window = context;
  for (const file of ["src/core/rng.js", "src/agents/vpo.js", "src/agents/supermimic.js", "src/agents/hindsight.js", "src/agents/hierarchy.js"]) {
    vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context, { filename: file });
  }
  for (const file of files) {
    if (file === 'web/level-graph.js' && beforeGraph) beforeGraph(context.window.CONTENT.levels);
    vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context, { filename: file });
  }
  return context.window.CONTENT;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ids = ["goals", "slots", "cliff", "careful", "cells", "explode", "mirage", "credit", "bigsteps", "passfail", "continuous", "explore", "elbo", "messages", "offline", "mixed", "thaw", "rewardfit", "rare", "twoways", "pick", "residual", "fetch", "vpo", "skills", "hindsight", "hierarchy", "supermimic"];

test('build attaches the six campaign worlds and approved metadata to the registered levels', () => {
  const C = content();
  assert.deepEqual(plain(C.levels.map(l => l.id)), ids);
  assert.deepEqual(worlds.map(w => [w.id, w.name]), approved.worlds);
  assert.deepEqual(edges.map(e => [e.from, e.to, e.label]), approved.edges);
  assert.equal(edges.length, 30);
  assert.equal(C.graph.activeEdges.length, 29);
  for (const level of C.levels) {
    const projected = C.graph.levels.find(l => l.id === level.id);
    assert.equal(level.campaignWorld, (['skew', 'metarl', 'ensemble'].includes(level.id) ? 'w6' : approved.levelWorlds[level.id]), level.id);
    assert.equal(projected.world, level.campaignWorld);
    assert.deepEqual(plain(projected.improves), plain(level.improves));
    assert.deepEqual(plain(level.improves), edges.filter(e => e.to === level.id).map(({ from, label }) => ({ from, label })));
  }
  assert.equal(C.levels.find(l => l.id === 'slots').world, 'bandit');
  assert.equal(C.levels.find(l => l.id === 'twoways').world, 'fork');
});

test('dormant parents do not lock roots or require unknown saved ids', () => {
  const graph = create(content().levels.filter(l => l.id !== 'goals'));
  assert.deepEqual(plain(graph.parents('twoways')), []);
  assert.equal(graph.status('twoways', []), 'open');
  assert.deepEqual(plain(graph.parents('mixed')), ['offline']);
  assert.equal(graph.status('mixed', ['goals']), 'locked');
  assert.equal(graph.status('mixed', ['offline']), 'open');
  assert.equal(graph.status('goals', ['goals']), null);
  assert.equal(graph.status('unknown', []), null);
  assert(!graph.activeEdges.some(e => e.from === 'goals'));
  assert.deepEqual(plain(graph.parents('rare')), ['slots', 'cliff']);
});

test('both endpoints must be registered; returning a parent or child wakes only its settled links', () => {
  const C = content(), before = plain(edges);
  const withGoals = create(C.levels);
  assert.deepEqual(withGoals.parents('twoways'), ['goals']);
  assert.equal(withGoals.status('twoways', []), 'locked');
  assert.equal(withGoals.status('twoways', ['goals']), 'open');
  assert.deepEqual(withGoals.missing('mixed', ['offline']), ['goals']);
  assert.equal(withGoals.status('mixed', ['offline', 'goals']), 'open');
  assert.deepEqual(withGoals.parents('rewardfit'), ['goals']);
  const withoutRare = create(C.levels.filter(l => !['rare', 'skills'].includes(l.id)));
  assert(!withoutRare.activeEdges.some(e => e.to === 'rare'));
  const withRare = create([...C.levels.filter(l => !['rare', 'skills'].includes(l.id)), { id: 'rare', phase: 11 }]);
  assert.deepEqual(withRare.parents('rare'), ['slots', 'cliff']);
  assert.equal(withRare.status('rare', ['slots']), 'locked');
  assert.equal(withRare.status('rare', ['slots', 'cliff']), 'open');
  assert(!withRare.activeEdges.some(e => e.to === 'skills'));
  assert.deepEqual(edges, before);
});

test('every registered parent must be cleared, and advisory completion wins over a lock', () => {
  const { graph } = content();
  assert.deepEqual(plain(graph.missing('continuous', [])), ['explode', 'mirage']);
  for (const done of [[], ['explode'], ['mirage']]) assert.equal(graph.status('continuous', done), 'locked');
  assert.equal(graph.status('continuous', ['explode', 'mirage']), 'open');
  assert.equal(graph.status('continuous', ['continuous']), 'cleared');
  assert.equal(graph.status('pick', ['twoways']), 'open');
});

test('next uses course order, skips locked levels, and disappears when all levels are cleared', () => {
  const { graph } = content();
  assert.equal(graph.next([]), 'goals');
  assert.equal(graph.next(['goals']), 'slots');
  assert.equal(graph.next(['goals', 'slots']), 'cliff');
  assert.equal(graph.next(['goals', 'slots', 'cliff']), 'careful');
  // Unknown saved ids do not compete for next.
  assert.equal(graph.next(['slots', 'goals', 'future']), 'cliff');
  const skipped = ids.filter(id => !['cells', 'explode', 'twoways', 'pick'].includes(id));
  assert.equal(graph.next(skipped), 'cells');
  const blocked = create([{ id: 'pick', phase: 5 }, { id: 'twoways', phase: 5 }]);
  assert.equal(blocked.next([]), 'twoways');
  assert.equal(blocked.status('pick', []), 'locked');
  assert.equal(graph.next(ids), null);
  assert(ids.every(id => graph.status(id, ids) === 'cleared'));
  assert.equal(create([]).next([]), null);
});

test('states are derived afresh from done without mutating progress or creating persistence fields', () => {
  const { graph } = content();
  const done = ['future'], snapshot = done.slice();
  for (let i = 0; i <= ids.length; i++) {
    const states = ids.map(id => graph.status(id, done));
    assert.equal(states.filter(s => s === 'next').length, i === ids.length ? 0 : 1);
    const next = graph.next(done);
    if (next) {
      assert.equal(graph.missing(next, done).length, 0);
      assert(!done.includes(next));
      done.push(next);
    }
  }
  const immutable = Object.freeze(snapshot);
  assert.equal(graph.status('goals', immutable), 'next');
  assert.equal(graph.status('cliff', immutable), 'locked');
  assert.deepEqual(immutable, ['future']);
  assert.deepEqual(plain(graph.levels.map(l => l.id)), ids);
});

test('adding campaign metadata leaves every lesson and simulation configuration intact', () => {
  let before;
  const C = content(levels => { before = levels.map(level => ({ ...level })); });
  assert.deepEqual(C.levels.map(({ campaignWorld, improves, ...level }) => level), before);
  const fast = require('../scripts/fast-source.js');
  const version = fast.hash(fast.exact.stringify(fast.source().versions));
  const index = JSON.parse(fs.readFileSync(require.resolve('../fast/' + version + '/index.json')));
  assert.deepEqual(index.versions, fast.source().versions, 'published Fast identity still matches');
});
