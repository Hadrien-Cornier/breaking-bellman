'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const fast = require('../scripts/fast-source.js');

test('player copy preserves every simulation field and the published Fast version', () => {
  const C = fast.content();
  const snapshot = () => JSON.parse(JSON.stringify({
    levels: C.levels.map(({ intro, introMore, learner, ...level }) => level),
    cards: Object.fromEntries(Object.entries(C.cards).map(([id, { plain, ...card }]) => [id, card])),
  }));
  const before = snapshot(), versions = fast.source().versions;
  vm.runInNewContext(fs.readFileSync('web/player-copy.js', 'utf8'), { window: { CONTENT: C } });
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(fast.source().versions, versions);
  assert(fs.existsSync('fast/' + fast.hash(fast.exact.stringify(versions)) + '/index.json'));
  assert.match(C.levels.find(l => l.id === 'cliff').intro, /^Reach the flag/);
  assert(C.levels.find(l => l.id === 'cliff').introMore);
  assert.match(C.cards.mc.plain, /episode to end/);
  const build = fs.readFileSync('build.mjs', 'utf8');
  assert(build.indexOf("'web/player-copy.js'") < build.indexOf("'web/app.js'"));
});
