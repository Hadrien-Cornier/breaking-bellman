'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../src/agents/latent.js');

function near(actual, expected, label) {
  assert.equal(Number.isFinite(actual), true, label || 'finite');
  assert.ok(Math.abs(actual - expected) <= 1e-12, (label || 'value') + ' ' + actual + ' vs ' + expected);
}

function core(result) {
  return {
    posterior: result.posterior,
    commit: result.commit,
    tie: result.tie,
    skipped: result.skipped,
    history: result.history,
  };
}

// A second count, written out here so the test is not a copy of the module's loop body.
function independent(records, history) {
  const payloads = [];
  const counts = {};
  const totals = {};
  for (const rec of records) {
    if (!payloads.includes(rec.payload)) payloads.push(rec.payload);
    counts[rec.payload] = counts[rec.payload] || {};
    totals[rec.payload] = (totals[rec.payload] || 0) + 1;
    for (const obs of rec.observations) counts[rec.payload][obs] = (counts[rec.payload][obs] || 0) + 1;
  }
  const weights = {};
  for (const payload of payloads) weights[payload] = 1;
  const skipped = [];
  for (const obs of history) {
    if (!payloads.some((payload) => counts[payload][obs])) {
      skipped.push(obs);
      continue;
    }
    for (const payload of payloads) weights[payload] *= (counts[payload][obs] || 0) / totals[payload];
  }
  const sum = payloads.reduce((total, payload) => total + weights[payload], 0);
  const posterior = {};
  for (const payload of payloads) posterior[payload] = sum > 0 ? weights[payload] / sum : 1 / payloads.length;
  let best = -1;
  const winners = [];
  for (const payload of payloads) {
    if (posterior[payload] > best + 1e-12) {
      best = posterior[payload];
      winners.length = 0;
      winners.push(payload);
    } else if (Math.abs(posterior[payload] - best) <= 1e-12) winners.push(payload);
  }
  return { posterior, commit: winners.length === 1 ? winners[0] : null, tie: winners.length !== 1, skipped };
}

function matchesIndependent(records, history) {
  const got = L.recommend(records, history);
  const want = independent(records, history);
  assert.equal(got.commit, want.commit);
  assert.equal(got.tie, want.tie);
  assert.deepEqual(got.skipped, want.skipped);
  for (const payload of got.payloads) near(got.posterior[payload], want.posterior[payload], payload);
}

test('lesson records name the payload and the probe, and the query history does not', () => {
  for (const rec of L.lessonRecords()) {
    assert.ok(rec.payload === 'copper' || rec.payload === 'glass');
    assert.ok(rec.observations.includes('sealed'));
    assert.ok(rec.observations.includes('red') || rec.observations.includes('blue'));
  }
  const history = L.historyOf('red');
  assert.deepEqual(history, ['sealed', 'red']);
  assert.equal(history.some((item) => item === 'copper' || item === 'glass'), false);
});

test('a sealed history stays one half each and does not pick a payload', () => {
  const records = L.lessonRecords();
  const result = L.recommend(records, ['sealed']);
  assert.equal(result.tie, true);
  assert.equal(result.commit, null);
  near(result.posterior.copper, 0.5);
  near(result.posterior.glass, 0.5);
  assert.equal(result.commit === 'copper' || result.commit === 'glass', false);
  assert.notEqual(result.commit, L.oracleCommit('copper'));
  assert.equal(L.copyMark(['sealed']), 'sealed');
  matchesIndependent(records, ['sealed']);
});

test('red commits the payload the fit associated with red', () => {
  const records = L.lessonRecords();
  const result = L.recommend(records, L.historyOf('red'));
  assert.equal(L.associated(records, 'red'), 'copper');
  assert.equal(result.commit, 'copper');
  assert.equal(result.tie, false);
  near(result.posterior.copper, 1);
  near(result.posterior.glass, 0);
  assert.notEqual(result.commit, 'red');
  assert.notEqual(result.commit, L.copyMark(L.historyOf('red')));
  assert.equal(L.recommend(records, L.historyOf('blue')).commit, 'glass');
  matchesIndependent(records, L.historyOf('red'));
});

test('a handed payload id does not change the posterior or the commit', () => {
  const records = L.lessonRecords();
  const plain = L.recommend(records, L.historyOf('red'));
  const handedGlass = L.recommend(records, L.historyOf('red'), { payload: 'glass' });
  const handedCopper = L.recommend(records, L.historyOf('red'), { payload: 'copper' });
  assert.deepEqual(core(handedGlass), core(plain));
  assert.deepEqual(core(handedCopper), core(plain));
  assert.equal(handedGlass.commit, 'copper');
  assert.equal(L.oracleCommit('glass'), 'glass');
  assert.notEqual(handedGlass.commit, L.oracleCommit('glass'));
  const tieA = L.recommend(records, ['sealed'], { payload: 'copper' });
  const tieB = L.recommend(records, ['sealed'], { payload: 'glass' });
  assert.equal(tieA.commit, null);
  assert.deepEqual(core(tieA), core(tieB));
  assert.deepEqual(core(tieA), core(L.recommend(records, ['sealed'])));
});

test('swapped observation associations swap the recommendation', () => {
  const records = L.lessonRecords();
  const history = L.historyOf('red');
  const before = L.recommend(records, history);
  const colors = L.recommend(L.swapObservations(records, 'red', 'blue'), history);
  const names = L.recommend(L.swapPayloadNames(records), history);
  assert.equal(before.commit, 'copper');
  assert.equal(colors.commit, 'glass');
  assert.equal(names.commit, 'glass');
  near(colors.posterior.glass, 1);
  near(names.posterior.glass, before.posterior.copper);
  near(names.posterior.copper, before.posterior.glass);
  assert.equal(L.copyMark(history), 'red');
  assert.equal(L.copyMark(history), L.copyMark(history));
  assert.notEqual(colors.commit, L.copyMark(history));
});

test('unequal counts follow the frequencies and swap with the payloads', () => {
  const records = [
    { payload: 'copper', observations: ['sealed', 'red'] },
    { payload: 'copper', observations: ['sealed', 'red'] },
    { payload: 'glass', observations: ['sealed', 'red'] },
    { payload: 'glass', observations: ['sealed', 'blue'] },
  ];
  const result = L.recommend(records, L.historyOf('red'));
  near(result.posterior.copper, 2 / 3, 'copper');
  near(result.posterior.glass, 1 / 3, 'glass');
  assert.equal(result.commit, 'copper');
  const swapped = L.recommend(L.swapPayloadNames(records), L.historyOf('red'));
  near(swapped.posterior.glass, 2 / 3, 'swapped glass');
  near(swapped.posterior.copper, 1 / 3, 'swapped copper');
  assert.equal(swapped.commit, 'glass');
  matchesIndependent(records, L.historyOf('red'));
  matchesIndependent(L.swapPayloadNames(records), L.historyOf('red'));
});

test('a probe the fit never saw leaves the posterior mixed', () => {
  const records = L.unseenRecords();
  assert.equal(L.associated(records, 'red'), null);
  const result = L.recommend(records, L.historyOf('red'));
  assert.deepEqual(result.skipped, ['red']);
  assert.equal(result.tie, true);
  assert.equal(result.commit, null);
  near(result.posterior.copper, 0.5);
  near(result.posterior.glass, 0.5);
  const green = L.recommend(L.lessonRecords(), L.historyOf('green'));
  assert.deepEqual(green.skipped, ['green']);
  assert.equal(green.commit, null);
  near(green.posterior.copper, 0.5);
  matchesIndependent(records, L.historyOf('red'));
  matchesIndependent(L.lessonRecords(), L.historyOf('green'));
});

test('the same probe observation on both payloads stays mixed', () => {
  const records = L.ambiguousRecords();
  assert.equal(L.associated(records, 'red'), null);
  const result = L.recommend(records, L.historyOf('red'));
  assert.equal(result.tie, true);
  assert.equal(result.commit, null);
  near(result.posterior.copper, 0.5);
  near(result.posterior.glass, 0.5);
  assert.deepEqual(result.skipped, []);
  const again = L.recommend(records, L.historyOf('red'), { payload: 'copper' });
  assert.deepEqual(core(again), core(result));
  matchesIndependent(records, L.historyOf('red'));
});

test('identical histories do not identify different payloads', () => {
  const records = L.lessonRecords();
  const history = ['sealed', 'red'];
  const first = L.recommend(records, history, { payload: 'copper' });
  const second = L.recommend(records, history, { payload: 'glass' });
  assert.deepEqual(first.history, second.history);
  assert.deepEqual(core(first), core(second));
  assert.equal(first.commit, second.commit);
});

test('latent level sits before replan and keeps a single id', () => {
  const src = fs.readFileSync('web/latent-level.js', 'utf8');
  const context = vm.createContext({
    window: {
      CONTENT: {
        phases: [{ n: 8, title: 'Learning through a world model' }],
        levels: [{ id: 'replan', title: 'Plan once, or replan' }, { id: 'goals', title: 'Tell it the goal' }],
        worldNames: { replan: 'Noisy corridor' },
      },
      BBLATENT: L,
    },
  });
  vm.runInContext(src, context);
  vm.runInContext(src, context);
  const ids = context.window.CONTENT.levels.map((level) => level.id);
  assert.deepEqual(ids, ['latent', 'replan', 'goals']);
  assert.equal(context.window.CONTENT.worldNames.latent, 'Two payloads');
  assert.equal(typeof context.window.BBLATENT_LEVEL.mount, 'function');
  assert.equal(context.window.CONTENT.levels.filter((level) => level.id === 'replan').length, 1);
});
