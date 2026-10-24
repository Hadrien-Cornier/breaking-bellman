const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fixture = require('./fixtures/newer-main-save.json').progress;

// Execute the app's actual load, state initialization and save, without mounting a DOM.
const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
const storage = app.slice(app.indexOf("  const LS = 'breaking-bellman-v1';"), app.indexOf('  // ---------------------------------------------------------------- bring your own AI'));
function boot(raw, blocked = false) {
  let value = raw;
  const context = vm.createContext({
    C: { cfg: () => ({}), levels: [{ id: 'slots' }] },
    RLA: { runRecord: require('../web/run-record.js') },
    localStorage: {
      getItem(key) { assert.equal(key, 'breaking-bellman-v1'); if (blocked) throw Error('blocked'); return value; },
      setItem(key, next) { assert.equal(key, 'breaking-bellman-v1'); if (blocked) throw Error('blocked'); value = next; },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../web/run-record.js'), 'utf8'), context);
  vm.runInContext(storage + '\nglobalThis.state = S; globalThis.persist = save;', context);
  return { state: context.state, save: context.persist, raw: () => value, read: () => JSON.parse(value) };
}

test('newer-main fixture survives load, save and reload with every field intact', () => {
  let app = boot(JSON.stringify(fixture));
  for (let i = 0; i < 3; i++) {
    assert.equal(app.state.level, 'skew');
    app.save();
    assert.deepEqual(app.read(), fixture);
    app = boot(app.raw());
  }
});

test('current progress overrides loaded fields while unknown ids and nested values survive', () => {
  const input = structuredClone(fixture);
  input.made.skew = { parts: { family: 'future', unknown: true }, recipe: 'future-recipe' };
  input.future = { optional: null, flags: [false, 0, { version: 2 }] };
  const app = boot(JSON.stringify(input));
  app.state.done.push('cells');
  app.state.lstep.cells = 3;
  app.state.answers['cells-p'] = { choice: 0, correct: true, ts: 'now' };
  app.state.made.cells = { parts: { store: 'table' }, recipe: 'cells-recipe' };
  app.state.mode = 'workbench';
  app.save();
  const expected = structuredClone(input);
  expected.done.push('cells'); expected.lstep.cells = 3;
  expected.answers['cells-p'] = { choice: 0, correct: true, ts: 'now' };
  expected.made.cells = { parts: { store: 'table' }, recipe: 'cells-recipe' };
  expected.mode = 'workbench';
  assert.deepEqual(app.read(), expected);
  const reloaded = boot(app.raw());
  reloaded.save();
  assert.deepEqual(reloaded.read(), expected);
  // An explicit registered choice replaces only the selected level, never old progress.
  reloaded.state.level = 'slots'; reloaded.save();
  assert.deepEqual(reloaded.read(), { ...expected, level: 'slots' });
});

test('absent and malformed saves still initialize and persist defaults', () => {
  for (const raw of [null, '{broken', 'null']) {
    const app = boot(raw);
    assert.equal(app.state.level, 'slots');
    app.save();
    assert.equal(app.read().mode, 'campaign');
    assert.deepEqual(app.read().done, []);
    const reloaded = boot(app.raw()); reloaded.save();
    assert.deepEqual(reloaded.read(), app.read());
  }
});

test('blocked storage remains nonfatal', () => {
  const app = boot(null, true);
  assert.equal(app.state.level, 'slots');
  assert.doesNotThrow(() => app.save());
});
