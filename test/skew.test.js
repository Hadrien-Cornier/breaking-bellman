// Density support, powered weights, seeded allocation, and a sealed door.
// Expected counts below are budget times the probability, computed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const K = require('../src/agents/skew.js');

function independentInverse(counts) {
  const total = counts.A + counts.B + counts.C;
  const prod = counts.A * counts.B * counts.C;
  const integers = {
    A: total * (prod / counts.A),
    B: total * (prod / counts.B),
    C: total * (prod / counts.C),
  };
  return { integers, sum: integers.A + integers.B + integers.C };
}

test('the anchor inverse is undefined without smoothing and is (11, 99, 99) / 209 with add-one', () => {
  const raw = K.fitDensity({ A: 8, B: 0, C: 0 }, 0);
  assert.equal(raw.defined, true);
  assert.equal(raw.total, 8);
  assert.deepEqual(raw.p.A, { num: 1, den: 1 });
  assert.equal(raw.p.B.num, 0);
  assert.equal(raw.p.C.num, 0);
  const blocked = K.weights(raw, -1);
  assert.equal(blocked.defined, false);
  assert.deepEqual(blocked.holes, ['B', 'C']);
  assert.equal(blocked.integers, null);
  const refused = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 0, exponent: -1, budget: 627, seed: 23, sealed: 'C' });
  assert.equal(refused.draw.ok, false);
  assert.equal(refused.draw.requested.length, 0);
  assert.equal(refused.table.B.attempts, 0);
  assert.equal(refused.expected, null);
  assert.equal(JSON.stringify(refused).includes('NaN'), false);
  assert.equal(JSON.stringify(refused).includes('Infinity'), false);

  const smooth = K.fitDensity({ A: 8, B: 0, C: 0 }, 1);
  assert.deepEqual(smooth.counts, { A: 9, B: 1, C: 1 });
  assert.equal(smooth.total, 11);
  assert.deepEqual(smooth.p, { A: { num: 9, den: 11 }, B: { num: 1, den: 11 }, C: { num: 1, den: 11 } });
  const inv = K.weights(smooth, -1);
  const hand = independentInverse(smooth.counts);
  assert.deepEqual(inv.integers, hand.integers);
  assert.equal(inv.sum, hand.sum);
  assert.deepEqual(inv.integers, { A: 11, B: 99, C: 99 });
  assert.equal(inv.sum, 209);
  const uniform = K.weights(smooth, 0);
  assert.deepEqual(uniform.integers, { A: 1, B: 1, C: 1 });
  assert.equal(uniform.sum, 3);
  const high = K.weights(smooth, 1);
  assert.deepEqual(high.integers, { A: 9, B: 1, C: 1 });
  assert.equal(high.sum, 11);

  assert.equal(627 * 11 / 209, 33);
  assert.equal(627 * 99 / 209, 297);
  assert.equal(627 / 3, 209);
  assert.equal(627 * 9 / 11, 513);
  assert.equal(627 / 11, 57);
  const arms = K.compare({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 });
  assert.deepEqual([arms.inverse.expected.A.whole, arms.inverse.expected.B.whole, arms.inverse.expected.C.whole], [33, 297, 297]);
  assert.deepEqual([arms.uniform.expected.A.whole, arms.uniform.expected.B.whole, arms.uniform.expected.C.whole], [209, 209, 209]);
  assert.deepEqual([arms.proportional.expected.A.whole, arms.proportional.expected.B.whole, arms.proportional.expected.C.whole], [513, 57, 57]);
  for (const arm of [arms.inverse, arms.uniform, arms.proportional]) {
    assert.equal(arm.draw.requested.length, 627);
    assert.equal(arm.draw.observed.A + arm.draw.observed.B + arm.draw.observed.C, 627);
    assert.equal(arm.claims.generativeModel, false);
    assert.equal(arm.claims.skewFitProcedure, false);
  }
});

test('a different visit table and a different smoothing do not reuse the anchor integers', () => {
  const density = K.fitDensity({ A: 1, B: 3, C: 0 }, 1);
  assert.deepEqual(density.counts, { A: 2, B: 4, C: 1 });
  const inv = K.weights(density, -1);
  assert.deepEqual(inv.integers, independentInverse(density.counts).integers);
  assert.deepEqual(inv.integers, { A: 28, B: 14, C: 56 });
  assert.equal(inv.sum, 98);
  assert.notDeepEqual(inv.integers, { A: 11, B: 99, C: 99 });
  const wider = K.fitDensity({ A: 8, B: 0, C: 0 }, 2);
  assert.deepEqual(wider.counts, { A: 10, B: 2, C: 2 });
  const w2 = K.weights(wider, -1);
  assert.deepEqual(w2.integers, independentInverse(wider.counts).integers);
  assert.notEqual(w2.sum, 209);
  const equal = K.practice({ visits: { A: 2, B: 2, C: 2 }, smoothing: 0, exponent: -1, budget: 627, seed: 4, sealed: null });
  assert.equal(equal.expected.B.whole, 209);
  assert.notEqual(equal.expected.B.whole, 297);
  assert.equal(equal.weights.integers.A, equal.weights.integers.B);
});

test('uniform names B with probability 1/3, and a constant-B list is not the density-proportional sample', () => {
  const smooth = K.fitDensity({ A: 8, B: 0, C: 0 }, 1);
  assert.equal(K.weights(smooth, 0).integers.B / K.weights(smooth, 0).sum, 1 / 3);
  let named = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const one = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 0, budget: 1, seed, sealed: null });
    if (one.draw.requested[0] === 'B') named += 1;
  }
  assert.ok(named > 800 && named < 1200, 'uniform named B ' + named + ' times in 3000 draws');
  const prop = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 1, budget: 627, seed: 23, sealed: 'C' });
  const alwaysB = { A: 0, B: 627, C: 0 };
  assert.notDeepEqual(prop.draw.observed, alwaysB);
  assert.ok(prop.draw.observed.B < 200);
  assert.ok(prop.draw.observed.A > prop.draw.observed.B);
  let differed = false;
  for (let seed = 1; seed <= 12; seed++) {
    const run = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 627, seed, sealed: 'C' });
    assert.equal(run.expected.B.whole, 297);
    if (run.draw.observed.B !== 297) differed = true;
    assert.notEqual(run.draw.observed.B, 627);
  }
  assert.equal(differed, true);
});

test('seeded draws are reproducible, share one budget, and sit near the probabilities at a large budget', () => {
  const opts = { visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 627, seed: 23, sealed: 'C' };
  const a = K.practice(opts);
  const b = K.practice(opts);
  assert.deepEqual(a.draw.requested, b.draw.requested);
  const arms = K.compare({ visits: opts.visits, smoothing: 1, sealed: 'C', budget: 627, seed: 23 });
  assert.equal(arms.inverse.budget, arms.uniform.budget);
  assert.equal(arms.uniform.budget, arms.proportional.budget);
  assert.notDeepEqual(arms.inverse.draw.observed, arms.proportional.draw.observed);
  assert.ok(arms.inverse.draw.observed.B > arms.uniform.draw.observed.B);
  assert.ok(arms.uniform.draw.observed.B > arms.proportional.draw.observed.B);
  const big = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 20000, seed: 99, sealed: 'C' });
  assert.ok(Math.abs(big.draw.observed.B / 20000 - 99 / 209) < 0.02);
  assert.ok(Math.abs(big.draw.observed.A / 20000 - 11 / 209) < 0.02);
  const bigHigh = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 1, budget: 20000, seed: 99, sealed: 'C' });
  assert.ok(Math.abs(bigHigh.draw.observed.B / 20000 - 1 / 11) < 0.02);
});

test('a sealed door is not a zero count, and smoothing does not create a transition', () => {
  const open = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 627, seed: 23, sealed: null });
  assert.equal(open.achieved.B, open.draw.observed.B);
  assert.equal(open.achieved.C, open.draw.observed.C);
  assert.equal(open.achieved.Hall, 0);
  assert.match(open.assumptions.join(' '), /known-room reset/i);
  assert.equal(open.claims.knownRoomReset, true);

  const honest = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 627, seed: 23, sealed: 'C' });
  assert.ok(honest.draw.observed.C > 0);
  assert.equal(honest.achieved.C, 0);
  assert.equal(honest.achieved.Hall, honest.draw.observed.C);
  assert.equal(honest.achieved.B, honest.draw.observed.B);
  assert.match(honest.failureReason, /sealed/);
  assert.equal(honest.table.C.attempts, honest.draw.observed.C);
  assert.equal(honest.table.C.successes, 0);
  assert.equal(honest.table.B.successes, honest.draw.observed.B);
  assert.equal(honest.noUpdate.B.attempts, 0);
  assert.equal(honest.noUpdate.C.successes, 0);
  assert.equal(K.policy(honest.table, 'C').action, 'none');
  assert.equal(K.policy(honest.noUpdate, 'C').action, null);
  assert.equal(K.policy(honest.table, 'B').action, 'reset-enter');
  assert.equal(K.policy(honest.noUpdate, 'B').action, null);
  const refit = K.fitDensity({ A: honest.achieved.A, B: honest.achieved.B, C: honest.achieved.C }, 0);
  assert.equal(refit.counts.C, 0);
  assert.equal(K.weights(refit, -1).defined, false);
  assert.deepEqual(K.weights(refit, -1).holes, ['C']);

  const rich = K.practice({ visits: { A: 0, B: 0, C: 10 }, smoothing: 0, exponent: 1, budget: 20, seed: 1, sealed: 'C' });
  assert.equal(rich.draw.observed.C, 20);
  assert.equal(rich.achieved.C, 0);
  assert.equal(rich.table.C.successes, 0);
  assert.equal(rich.achieved.Hall, 20);

  const swap = K.practice({
    visits: { A: K.SWAP.visits.A, B: K.SWAP.visits.B, C: K.SWAP.visits.C },
    smoothing: K.SWAP.smoothing, exponent: K.SWAP.exponent, budget: K.SWAP.budget, seed: K.SWAP.seed, sealed: K.SWAP.sealed,
  });
  assert.deepEqual(K.SWAP.visits, { A: 5, B: 4, C: 0 });
  assert.equal(swap.sealed, 'B');
  assert.ok(swap.draw.observed.B > 0);
  assert.equal(swap.achieved.B, 0);
  assert.equal(swap.table.B.successes, 0);
  assert.match(swap.failureReason, /sealed/);
  assert.ok(swap.draw.observed.C > 0);
  assert.equal(swap.achieved.C, swap.draw.observed.C);
  assert.equal(swap.table.C.successes, swap.draw.observed.C);
  assert.equal(swap.visits.C, 0);
  assert.equal(swap.doors.C, 'open');
  assert.equal(swap.doors.B, 'sealed');
});

test('the same request updates the table only from the outcome, and a held-out goal matches no-update', () => {
  let seed = null;
  for (let s = 1; s <= 30; s++) {
    const probe = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 0, budget: 1, seed: s, sealed: null });
    if (probe.draw.requested[0] === 'B') { seed = s; break; }
  }
  assert.ok(seed);
  const open = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 0, budget: 1, seed, sealed: null });
  const shut = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: 0, budget: 1, seed, sealed: 'B' });
  assert.equal(open.draw.requested[0], 'B');
  assert.equal(shut.draw.requested[0], 'B');
  assert.equal(open.table.B.successes, 1);
  assert.equal(shut.table.B.successes, 0);
  assert.equal(shut.table.B.attempts, 1);
  assert.equal(open.noUpdate.B.successes, 0);
  assert.notEqual(K.policy(open.table, 'B').action, K.policy(shut.table, 'B').action);
  assert.equal(K.policy(open.table, 'A').action, null);
  assert.equal(K.policy(open.noUpdate, 'A').action, null);
  assert.equal(K.policy(open.table, 'C').action, null);
  const pretend = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 30, seed: 2, sealed: 'C', pretend: true });
  assert.equal(pretend.claims.pretendReachability, true);
  assert.equal(pretend.claims.knownRoomReset, false);
  assert.ok(pretend.table.C.successes > 0);
  assert.match(pretend.failureReason, /not reachability/);
  const honest = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, budget: 30, seed: 2, sealed: 'C' });
  assert.equal(honest.table.C.successes, 0);
  assert.equal(K.enter('C', 'C', false).success, false);
  assert.equal(K.enter('B', 'C', false).achieved, 'B');
});

test('the lesson bundle refuses the unsmoothed inverse and keeps the generative claim closed', () => {
  const pack = K.lesson();
  assert.equal(pack.unsmoothed.draw.ok, false);
  assert.deepEqual(pack.unsmoothed.weights.holes, ['B', 'C']);
  assert.equal(pack.arms.inverse.weights.sum, 209);
  assert.equal(pack.arms.inverse.expected.B.whole, 297);
  assert.equal(pack.arms.uniform.expected.B.whole, 209);
  assert.equal(pack.arms.proportional.expected.B.whole, 57);
  assert.equal(pack.arms.inverse.achieved.C, 0);
  assert.equal(pack.swap.achieved.B, 0);
  assert.equal(pack.swap.achieved.C, pack.swap.draw.observed.C);
  assert.equal(pack.arms.inverse.claims.generativeModel, false);
  assert.equal(pack.arms.inverse.claims.robotResults, false);
  assert.match(pack.arms.inverse.assumptions.join(' '), /beta-VAE/);
  const agent = fs.readFileSync('src/agents/skew.js', 'utf8');
  const level = fs.readFileSync('web/skew-level.js', 'utf8');
  assert.doesNotMatch(agent, /require\(|goals\.js|BBGOALS/);
  assert.doesNotMatch(level, /goals\.js|BBGOALS/);
  assert.equal(agent.includes('\u2014'), false);
  assert.equal(level.includes('\u2014'), false);
  assert.equal(agent.includes('\u2013'), false);
  assert.equal(level.includes('\u2013'), false);
});

test('skew registers its own mount before supermimic and stays there when hindsight inserts', () => {
  const skewSrc = fs.readFileSync('web/skew-level.js', 'utf8');
  const context = {
    window: {
      CONTENT: { phases: [{ n: 8, title: 'World models' }], levels: [{ id: 'goals' }, { id: 'vpo' }, { id: 'supermimic' }, { id: 'replan' }], worldNames: {} },
      BBSKEW: K,
    },
  };
  vm.createContext(context);
  vm.runInContext(skewSrc, context);
  assert.equal(context.window.CONTENT.levels.map((l) => l.id).join(','), 'goals,vpo,skew,supermimic,replan');
  assert.equal(context.window.CONTENT.levels.find((l) => l.id === 'skew').world, 'skew');
  assert.equal(context.window.CONTENT.worldNames.skew, 'Three rooms');
  context.window.BBHINDSIGHT = require('../src/agents/hindsight.js');
  vm.runInContext(fs.readFileSync('web/hindsight-level.js', 'utf8'), context);
  assert.equal(context.window.CONTENT.levels.map((l) => l.id).join(','), 'goals,vpo,skew,hindsight,supermimic,replan');
  const app = fs.readFileSync('web/app.js', 'utf8');
  const apiAt = app.indexOf('function customLessonApi');
  const api = app.slice(apiAt, app.indexOf('return null;', apiAt));
  assert.ok(api.includes("id === 'skew'"));
  assert.ok(api.includes('window.BBSKEW'));
  assert.ok(api.includes("id === 'vpo'"));
  assert.ok(api.includes("id === 'rewardfit'"));
  assert.match(app, /const api = customLessonApi\(lv\.id\)/);
  assert.match(fs.readFileSync('build.mjs', 'utf8'), /src\/agents\/skew\.js', 'web\/skew-level\.js'/);
});

test('skew takes its own phase after the skills phase and keeps the skills heading', () => {
  const context = {
    window: {
      CONTENT: {
        phases: [{ n: 8, title: 'World models' }, { n: 10, title: 'Diverse skills' }, { n: 9, title: 'Multi-task goals' }],
        levels: [{ id: 'vpo', phase: 7 }, { id: 'skills', phase: 10 }, { id: 'hindsight', phase: 9 }, { id: 'hierarchy', phase: 9 }, { id: 'supermimic', phase: 8 }],
        worldNames: {},
      },
      BBSKEW: K,
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/skew-level.js', 'utf8'), context);
  const C = context.window.CONTENT;
  assert.equal(C.levels.map((l) => l.id).join(','), 'vpo,skills,skew,hindsight,hierarchy,supermimic');
  assert.equal(C.phases.map((p) => p.n + ' ' + p.title).join('|'), '8 World models|10 Diverse skills|10.5 Goal coverage|9 Multi-task goals');
  assert.equal(C.levels.find((l) => l.id === 'skew').phase, 10.5);
  assert.equal(C.levels.filter((l) => l.phase === 10).map((l) => l.id).join(','), 'skills');
});
