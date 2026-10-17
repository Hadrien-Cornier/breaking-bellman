// The shared value-learner consolidation of the three article example levels links the article.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('web/app.js');

const PARA = 'How much data can the learner use before an estimate? Read the short article: ';
const LINK_TEXT = 'Observations and estimates in reinforcement learning';
const LINK_URL = 'https://hadrien-cornier.github.io/robotics/what-information-can-a-reinforcement-learner-use/';
const WITH_LINK = ['cells', 'explode', 'mirage'];

function harness(levelId) {
  const ctx = vm.createContext({ window: {} });
  for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js']) vm.runInContext(read(file), ctx);
  const C = ctx.window.CONTENT;
  const lv = C.levels.find((l) => l.id === levelId);
  const h = (tag, attrs = {}, kids = []) => ({ tag, attrs: attrs || {}, kids: [].concat(kids || []).filter(Boolean),
    append(...children) { this.kids.push(...children); } });
  const S = { found: [], done: [], given: [], lstep: { [levelId]: 5 }, made: {}, parts: C.cfg({ store: 'net' }),
    level: levelId, world: lv.world, knobs: {} };
  Object.assign(ctx, { C, S, h, MODES: {}, fam: (p) => p.family || 'value',
    save() {}, render() {}, enterLevel() {}, setWorld() {}, mcBlock() {}, replayView() {}, mainSentence() {},
    downloadSave() {}, loadSave() {}, copyBrief() {},
    setStep: (l, n) => { S.lstep[l.id] = n; },
    recognize: (p) => C.recipes.find((r) => (!r.family || r.family === 'value') && r.world !== 'bandit'
      && Object.entries(r.keys).every(([k, v]) => Array.isArray(v) ? v.includes(p[k]) : v === p[k])),
    keysMatch: (p, keys) => Object.entries(keys).every(([k, v]) => Array.isArray(v) ? v.includes(p[k]) : v === p[k]),
    compareTable: (p, r) => h('table', { text: r.name }),
    cardView: (id) => h('article', { text: 'CARD:' + id }),
    groupOf: (id) => id || 'methods', discoveryMap: (group) => h('aside', { text: 'MAP:' + group }),
    nextLevelButton: () => h('button', { text: 'Next level' }),
  });
  vm.runInContext(app.slice(app.indexOf('  function consolidation('), app.indexOf('  function compareTable(')), ctx);
  const nodes = (e) => [e, ...(e.kids || []).flatMap(nodes)];
  return { C, S, lv, ctx, nodes, box: ctx.consolidation(lv) };
}
const paragraphs = (h) => h.nodes(h.box).filter((n) => n.tag === 'p' && n.kids.includes(PARA));
const links = (h) => h.nodes(h.box).filter((n) => n.tag === 'a');

for (const id of WITH_LINK) {
  test('article link: ' + id + ' consolidation shows the article paragraph exactly once', () => {
    const h = harness(id);
    const ps = paragraphs(h);
    assert.equal(ps.length, 1, 'expected one article paragraph');
    assert.equal(h.nodes(h.box).filter((n) => n.tag === 'a' && n.kids.includes(LINK_TEXT)).length, 1, 'expected one article link');
  });
}

test('article link: the paragraph is not in any other level\'s consolidation', () => {
  const ctx = vm.createContext({ window: {} });
  for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js']) vm.runInContext(read(file), ctx);
  for (const lv of ctx.window.CONTENT.levels) {
    if (WITH_LINK.includes(lv.id)) continue;
    const h = harness(lv.id);
    assert.equal(paragraphs(h).length, 0, 'level ' + lv.id + ' must not show the article paragraph');
    assert.equal(links(h).length, 0, 'level ' + lv.id + ' must not show the article link');
  }
});

test('article link: the link carries the exact text and URL with the game external-link behavior', () => {
  for (const id of WITH_LINK) {
    const h = harness(id);
    const a = links(h)[0];
    assert.equal(a.kids.includes(LINK_TEXT), true, 'link text');
    assert.equal(a.attrs.href, LINK_URL, 'link URL');
    assert.equal(a.attrs.target, '_blank', 'target');
    assert.equal(a.attrs.rel, 'noopener', 'rel');
  }
});

test('article link: the paragraph sits between the discovery map and the closing line', () => {
  for (const id of WITH_LINK) {
    const h = harness(id);
    const flat = h.nodes(h.box);
    const map = flat.findIndex((n) => String(n.attrs?.text || '').startsWith('MAP:'));
    const para = flat.findIndex((n) => n.tag === 'p' && n.kids.includes(PARA));
    const robot = flat.findIndex((n) => n.tag === 'p' && String(n.attrs.html || '').startsWith('<b>On a real robot:</b>'));
    assert.ok(map >= 0 && map < para, id + ': paragraph after the discovery map');
    assert.ok(para < robot, id + ': paragraph before the closing line');
  }
});