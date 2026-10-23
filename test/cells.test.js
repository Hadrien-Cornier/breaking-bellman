// Level 4 must conclude from the completed run, not from a past discovery.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('web/app.js');

function harness(found = []) {
  const ctx = vm.createContext({ window: {} });
  for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js']) vm.runInContext(read(file), ctx);
  const C = ctx.window.CONTENT;
  const lv = C.levels.find((l) => l.id === 'cells');
  const h = (tag, attrs = {}, kids = []) => ({ tag, attrs: attrs || {}, kids: [].concat(kids || []).filter(Boolean),
    append(...children) { this.kids.push(...children); } });
  const S = { found, done: [], given: [], lstep: { cells: 3 }, made: {}, parts: C.cfg({ store: 'net' }),
    level: 'cells', world: 'cartpole', knobs: {} };
  Object.assign(ctx, { C, S, h, mapOpen: false, MODES: {}, fam: (p) => p.family || 'value',
    save() {}, render() {}, enterLevel() {}, setWorld() {}, mcBlock() {}, replayView() {}, mainSentence() {},
    downloadSave() {}, loadSave() {}, copyBrief() {}, campaignRunRow: () => h('div'),
    setStep: (l, n) => { S.lstep[l.id] = n; },
    recognize: (p) => C.recipes.find((r) => (!r.family || r.family === 'value') && r.world !== 'bandit'
      && Object.entries(r.keys).every(([k, v]) => Array.isArray(v) ? v.includes(p[k]) : v === p[k])),
    keysMatch: (p, keys) => Object.entries(keys).every(([k, v]) => Array.isArray(v) ? v.includes(p[k]) : v === p[k]),
    compareTable: (p, r) => h('table', { text: r.name }),
    cardView: (id) => h('article', { text: 'CARD:' + id }),
    groupOf: (id) => id || 'methods', discoveryMap: (group) => h('aside', { text: 'MAP:' + group }),
    nextLevelButton: () => h('button', { text: 'Next level: Values explode' }),
  });
  vm.runInContext(app.slice(app.indexOf('  MODES.campaign = function'), app.indexOf('  // the reward controls')), ctx);
  vm.runInContext(app.slice(app.indexOf('  function consolidation('), app.indexOf('  function compareTable(')), ctx);
  const nodes = (e) => [e, ...(e.kids || []).flatMap(nodes)];
  const text = (e) => nodes(e).map((n) => typeof n === 'string' ? n : n.attrs?.text || n.attrs?.html || '').join('\n');
  return { C, S, lv, ctx, text, async complete(parts, a) {
    S.parts = C.cfg(parts);
    ctx.run = async () => { S.lastCfg = { world: S.world, parts: { ...S.parts } }; return a; };
    const pane = h('div');
    ctx.MODES.campaign(pane);
    await nodes(pane).find((n) => n.tag === 'button.btn' && n.kids.includes('Run this sentence')).attrs.onclick();
    return text(ctx.consolidation(lv));
  } };
}
const success = { summary: { finalReturn: 196, maxQ: 115.3 }, symptoms: [] };
const divergent = { summary: { finalReturn: 9, maxQ: 5e6 }, symptoms: [{ id: 'diverge', level: 'bad' }] };
const mc = { store: 'net', data: 'replay', memory: 10000, nstep: 0 };

test('cells: Monte Carlo success uses its recipe and nearest published sentence, even after finding the triad', async () => {
  const h = harness(['triad']);
  const text = await h.complete(mc, success);
  assert.match(text, /Your sentence works/);
  assert.match(text, /Monte Carlo with a network/);
  assert.match(text, /closest published sentence/);
  assert.match(text, /Monte Carlo control/);
  assert.doesNotMatch(text, /CARD:triad|new failure|MAP:triad/);
  assert.equal(h.S.made.cells.outcome.works, true);
  assert.equal(h.S.made.cells.outcome.triad, false);
  assert.ok(h.S.done.includes('cells'));
  // A later live sentence or run must not change the saved conclusion.
  h.S.parts = h.C.cfg({ store: 'net' });
  h.S.lastA = divergent;
  h.S.made = JSON.parse(JSON.stringify(h.S.made));
  assert.match(h.text(h.ctx.consolidation(h.lv)), /Your sentence works/);
});

test('cells: a divergent bootstrapped network shows the triad card and preserves progression', async () => {
  const h = harness();
  const text = await h.complete({ store: 'net' }, divergent);
  assert.match(text, /This run showed the deadly triad/);
  assert.match(text, /CARD:triad/);
  assert.match(text, /Next level: Values explode/);
  assert.equal(h.S.lstep.cells, 5);
  assert.equal(h.S.made.cells.outcome.triad, true);
  // A subsequent successful sentence replaces this run's failure, not the discovery history.
  h.S.found.push('triad');
  assert.doesNotMatch(await h.complete(mc, success), /CARD:triad|This run showed the deadly triad/);
});

test('cells: a working published recipe gets its own card', async () => {
  const h = harness(['triad']);
  const text = await h.complete({ store: 'net', data: 'replay', picker: 'frozen', scorer: 'frozen' }, success);
  assert.match(text, /Your sentence is <b>DQN/);
  assert.match(text, /CARD:dqn/);
  assert.doesNotMatch(text, /CARD:triad/);
});

test('cells: unsuccessful and legacy runs do not claim success or a triad', async () => {
  const h = harness(['triad']);
  const text = await h.complete(mc, { summary: { finalReturn: 20, maxQ: 50 }, symptoms: [] });
  assert.match(text, /did not pass CartPole/);
  assert.doesNotMatch(text, /Your sentence works|CARD:triad/);
  delete h.S.made.cells.outcome;
  const legacy = h.text(h.ctx.consolidation(h.lv));
  assert.match(legacy, /Run it again/);
  assert.doesNotMatch(legacy, /Your sentence works|CARD:triad/);
});

test('triad discovery requires divergence, a network, bootstrapping and off-policy data', () => {
  const { C } = harness();
  const when = C.failures.find((f) => f.card === 'triad').when;
  const cfg = (p) => ({ world: 'cartpole', parts: C.cfg(p) });
  assert.equal(when(divergent, cfg({ store: 'net' })), true);
  assert.equal(when(divergent, cfg({ store: 'net', data: 'replay', agg: 'taken' })), true);
  assert.equal(when(success, cfg({ store: 'net', data: 'replay' })), false);
  assert.equal(when(divergent, cfg(mc)), false);
  assert.equal(when(divergent, cfg({ store: 'table' })), false);
  assert.equal(when(divergent, cfg({ store: 'net', agg: 'taken' })), false);
  assert.equal(when(divergent, cfg({ store: 'net', agg: 'mean' })), false);
  assert.equal(when(divergent, cfg({ store: 'net', eps: false })), false);
});
