// Unlock notes: quote slices stay inside the existing Codex evidence, dismissal remembers
// a legacy save, and a locked card does not appear on a campaign level.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ctx = vm.createContext({ window: {}, console, globalThis: null });
ctx.globalThis = ctx;
for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/papers.js', 'web/fetch-level.js', 'web/algos.js', 'web/recap.js']) {
  vm.runInContext(read(file), ctx);
}
const C = ctx.window.CONTENT;
const RECAP = ctx.RECAP;
const norm = (s) => String(s).replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();

test('the reported failure keeps its Codex name', () => {
  assert.equal(C.cards.criticfirst.name, 'A good policy, a bad critic');
  assert.equal(C.cards.criticfirst.kind, 'failure');
  const when = C.failures.find((f) => f.card === 'criticfirst');
  assert.equal(when.when({ summary: {} }, { world: 'reach', parts: { base: 'classical', wait: 0 } }), true);
  assert.equal(when.when({ summary: {} }, { world: 'reach', parts: { base: 'classical', wait: 3000 } }), false);
  assert.equal(when.when({ summary: {} }, { world: 'pendulum', parts: { base: 'classical', wait: 0 } }), false);
});

test('a discovered failure is listed on its campaign level and a locked card is not', () => {
  const same = (got, expect) => assert.deepEqual(Array.from(got), expect);
  const level = C.levels.find((l) => l.id === 'residual');
  const hidden = RECAP.cardsForLevel(level, {
    found: [], given: [],
    discoveries: { criticfirst: { levelId: 'residual', where: 'Campaign level "' + level.title + '"' } },
  });
  same(hidden, []);
  const shown = RECAP.cardsForLevel(level, {
    found: ['criticfirst', 'residual', 'td3'], given: [],
    discoveries: {
      criticfirst: { levelId: 'residual' },
      residual: { where: 'Campaign level "' + level.title + '"' },
      td3: { levelId: 'continuous' },
    },
  });
  same(shown, ['criticfirst', 'residual']);
  const legacyWhere = RECAP.cardsForLevel(level, {
    found: ['criticfirst'], given: [],
    discoveries: { criticfirst: { where: 'Campaign level "Keep the controller"' } },
  });
  same(legacyWhere, ['criticfirst']);
});

test('a level reveal is shown only after it is given', () => {
  const same = (got, expect) => assert.deepEqual(Array.from(got), expect);
  const level = { id: 'continuous', title: 'Actions that are numbers', reveal: 'ddpg' };
  same(RECAP.cardsForLevel(level, { found: [], given: [], discoveries: {} }), []);
  same(RECAP.cardsForLevel(level, { found: [], given: ['ddpg'], discoveries: {} }), ['ddpg']);
});

test('legacy saves without dismissal state do not reopen every old unlock', () => {
  const same = (got, expect) => assert.deepEqual(Array.from(got), expect);
  const legacy = RECAP.unlockState({ found: ['residual'] }, ['residual', 'criticfirst'], []);
  assert.equal(legacy.legacy, true);
  same(legacy.pending, []);
  same(legacy.dismissed, ['residual', 'criticfirst']);
  const kept = RECAP.unlockState({ recapDismissed: ['residual'] }, ['residual', 'criticfirst'], []);
  assert.equal(kept.legacy, false);
  same(kept.pending, ['criticfirst']);
});

test('every card has a short evidence quote or an explicit gap, and practice has no em dash', () => {
  for (const id of Object.keys(C.cards)) {
    const n = RECAP.note(id, C, ctx.ALGO_HELP);
    assert.ok(n.practice, id + ' has a practice line');
    assert.equal(n.practice.includes('\u2014'), false, id + ' practice has an em dash');
    assert.equal(n.quote.includes('\u2014'), false, id + ' quote slice has an em dash');
    if (n.quote) {
      assert.ok(n.quoteWords >= 8 && n.quoteWords <= 25, id + ' quote is ' + n.quoteWords + ' words: ' + n.quote);
      assert.ok(norm(RECAP.plain(C.cards[id].evidence)).includes(norm(n.quote)), id + ' quote is not inside its evidence');
      assert.ok(n.cite, id + ' quote names its source line');
    } else {
      assert.ok(n.gap && /not read here|No verbatim quote/.test(n.gap), id + ' gap: ' + n.gap);
    }
  }
});

test('residual and the bad-critic failure use the checked source lines', () => {
  const residual = RECAP.note('residual', C, ctx.ALGO_HELP);
  const failure = RECAP.note('criticfirst', C, ctx.ALGO_HELP);
  assert.equal(residual.quote, 'The final control policy is a superposition of both control signals.');
  assert.match(residual.cite, /Johannink et al\. 2019, abstract/);
  assert.equal(failure.quote, 'If we begin with a perfect initial policy and a poor critic,');
  assert.match(failure.cite, /Silver et al\. 2018, section IV-B/);
  assert.match(residual.practice, /correction/i);
  assert.match(failure.practice, /critic/i);
});
