'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../src/agents/mopo.js');

function hand(modelA, modelB, coefficient) {
  const mean = (modelA + modelB) / 2;
  const disagreement = Math.abs(modelA - modelB);
  return { mean, disagreement, penalty: coefficient * disagreement, score: mean - coefficient * disagreement };
}

function row(result, id) {
  return result.plans.penalty.rows.find((item) => item.id === id);
}

function lesson(overrides) {
  return Object.assign({
    policy: 'penalty',
    coefficient: M.LESSON_COEFFICIENT,
    models: M.LESSON_MODELS,
  }, overrides || {});
}

test('the lesson tables penalize the hole and take the agreed unseen cell', () => {
  const result = M.plan(lesson());
  assert.equal(result.ok, true);
  assert.equal(result.formula, 'mean reward points - coefficient * absolute disagreement reward points');
  assert.equal(result.units.reward, 'reward points');
  assert.equal(result.units.disagreement, 'reward points');
  assert.equal(result.units.coefficient, 'reward points of penalty per reward point of absolute disagreement');
  assert.equal(result.coefficient, 1);
  assert.equal(result.learnedDynamics, false);
  assert.equal(result.uncertaintyEstimator, null);
  assert.equal(result.comboLoss, false);
  assert.equal(result.fixedTables, true);
  assert.equal(result.datasetFrozen, true);
  assert.equal(result.canCollect, false);
  assert.equal(result.newTransitions, 0);
  for (const id of M.IDS) {
    const got = row(result, id);
    const want = hand(M.LESSON_MODELS[id].modelA, M.LESSON_MODELS[id].modelB, 1);
    assert.equal(got.mean, want.mean, id);
    assert.equal(got.disagreement, want.disagreement, id);
    assert.equal(got.penalty, want.penalty, id);
    assert.equal(got.score, want.score, id);
    assert.equal(got.inDataset, M.ENVIRONMENT[id].inDataset);
    assert.equal(got.trueReward, M.ENVIRONMENT[id].trueReward);
  }
  assert.equal(result.plans.penalty.chosen, 'span');
  assert.equal(result.plans.penalty.trueReward, 3);
  assert.equal(result.action.chosen, 'span');
  assert.equal(result.plans.average.chosen, 'hole');
  assert.equal(result.plans.average.trueReward, 0);
  assert.equal(result.plans.mask.chosen, 'home');
  assert.deepEqual(result.plans.mask.candidates, ['home']);
  assert.deepEqual(result.plans.mask.refused, ['hole', 'span']);
  assert.equal(JSON.stringify(result).includes('NaN'), false);
});

test('coefficient 0 enters the hole and a small coefficient is not a switch', () => {
  const zero = M.plan(lesson({ coefficient: 0 }));
  assert.equal(zero.plans.penalty.chosen, 'hole');
  assert.equal(zero.plans.penalty.trueReward, 0);
  assert.equal(zero.plans.penalty.score, 4);
  assert.equal(zero.action.chosen, zero.plans.average.chosen);
  const stringZero = M.plan(lesson({ coefficient: '0' }));
  assert.equal(stringZero.plans.penalty.chosen, 'hole');
  const small = M.plan(lesson({ coefficient: 0.0625 }));
  assert.equal(row(small, 'hole').score, 3.5);
  assert.equal(small.plans.penalty.chosen, 'hole');
  const tie = M.plan(lesson({ coefficient: 0.125 }));
  assert.equal(row(tie, 'hole').score, 3);
  assert.equal(row(tie, 'span').score, 3);
  assert.equal(tie.plans.penalty.chosen, 'span');
});

test('a dataset bit is not the planner, and the mask does not read the gap', () => {
  const flipped = M.plan(lesson({
    environment: {
      home: { inDataset: false, trueReward: 1 },
      hole: { inDataset: true, trueReward: 0 },
      span: { inDataset: false, trueReward: 3 },
    },
  }));
  assert.equal(flipped.plans.penalty.chosen, 'span');
  assert.equal(flipped.plans.mask.chosen, 'hole');
  const tagged = M.plan(lesson({
    models: {
      home: { modelA: 1, modelB: 1, inDataset: false },
      hole: { modelA: 8, modelB: 0, inDataset: true },
      span: { modelA: 3, modelB: 3, inDataset: false },
    },
  }));
  assert.equal(tagged.plans.penalty.chosen, 'span');
  assert.equal(tagged.plans.mask.chosen, 'home');

  const wide = {
    home: { modelA: 1, modelB: 1 },
    hole: { modelA: 8, modelB: 0 },
    span: { modelA: 9, modelB: -3 },
  };
  const agreed = {
    home: { modelA: 1, modelB: 1 },
    hole: { modelA: 8, modelB: 0 },
    span: { modelA: 3, modelB: 3 },
  };
  const environment = {
    home: { inDataset: true, trueReward: 1 },
    hole: { inDataset: false, trueReward: 0 },
    span: { inDataset: true, trueReward: 3 },
  };
  const noisy = M.plan(lesson({ models: wide, environment }));
  const calm = M.plan(lesson({ models: agreed, environment }));
  assert.equal(hand(9, -3, 0).mean, hand(3, 3, 0).mean);
  assert.equal(noisy.plans.mask.chosen, 'span');
  assert.equal(calm.plans.mask.chosen, 'span');
  assert.equal(noisy.plans.penalty.chosen, 'home');
  assert.equal(calm.plans.penalty.chosen, 'span');
});

test('confident agreement on a false high reward is not caught, and the true reward is not an input', () => {
  const wrong = M.plan(lesson({
    models: {
      home: { modelA: 1, modelB: 1 },
      hole: { modelA: 6, modelB: 6 },
      span: { modelA: 3, modelB: 3 },
    },
  }));
  assert.equal(wrong.plans.penalty.chosen, 'hole');
  assert.equal(wrong.plans.penalty.disagreement, 0);
  assert.equal(wrong.plans.penalty.mean, 6);
  assert.equal(wrong.plans.penalty.trueReward, 0);
  assert.equal(wrong.plans.penalty.score, 6);
  const relabeled = M.plan(lesson({
    environment: {
      home: { trueReward: 9 },
      hole: { trueReward: 9 },
      span: { trueReward: 0 },
    },
  }));
  assert.equal(relabeled.plans.penalty.chosen, 'span');
  assert.equal(relabeled.plans.penalty.trueReward, 0);
  const supplied = M.plan(lesson({
    models: {
      home: { modelA: 1, modelB: 1 },
      hole: { modelA: 8, modelB: 0 },
      span: { modelA: 0, modelB: 0 },
    },
  }));
  assert.notEqual(supplied.plans.penalty.chosen, 'span');
  assert.equal(supplied.plans.penalty.chosen, 'home');
});

test('bad tables and a negative coefficient fail closed, and the dataset cannot grow', () => {
  assert.equal(typeof M.collect, 'undefined');
  const before = M.dataset();
  assert.equal(before.frozen, true);
  assert.equal(before.canCollect, false);
  assert.equal(before.newTransitions, 0);
  assert.equal(before.cells.length, 3);
  const grown = M.plan(lesson({ collect: true }));
  assert.equal(grown.newTransitions, 0);
  assert.equal(M.dataset().cells.length, 3);
  assert.deepEqual(M.plan(lesson()), M.plan(lesson()));
  for (const bad of [
    lesson({ coefficient: -1 }),
    lesson({ coefficient: 'nope' }),
    lesson({ models: { home: { modelA: 1, modelB: 1 } } }),
    lesson({ models: { home: { modelA: NaN, modelB: 1 }, hole: { modelA: 0, modelB: 0 }, span: { modelA: 0, modelB: 0 } } }),
    { policy: 'ensemble' },
  ]) {
    const result = M.plan(bad);
    assert.equal(result.ok, false);
    assert.equal(result.newTransitions, 0);
    assert.equal(result.canCollect, false);
    assert.equal(JSON.stringify(result).includes('NaN'), false);
  }
  const copy = M.plan(lesson());
  copy.models.hole.modelA = 100;
  assert.equal(M.LESSON_MODELS.hole.modelA, 8);
  assert.equal(M.plan(lesson()).plans.penalty.chosen, 'span');
});

function loadLevels(extra) {
  const context = vm.createContext({
    window: Object.assign({
      BBTHAW: require('../src/agents/thaw.js'),
      BBMOPO: require('../src/agents/mopo.js'),
    }, extra || {}),
  });
  const files = ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/thaw-level.js', 'web/mopo-level.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

test('mopo is its own level after thaw and does not edit the offline lessons', () => {
  const context = loadLevels();
  const levels = context.window.CONTENT.levels;
  const ids = levels.map((item) => item.id);
  const mixed = ids.indexOf('mixed');
  const thaw = ids.indexOf('thaw');
  const mopo = ids.indexOf('mopo');
  assert.equal(ids[mixed + 1], 'thaw');
  assert.equal(ids[thaw + 1], 'mopo');
  assert.equal(ids.filter((id) => id === 'mopo').length, 1);
  assert.equal(levels.find((item) => item.id === 'offline').title, 'No new tries');
  assert.equal(levels.find((item) => item.id === 'mixed').title, 'Good and bad data');
  assert.equal(levels.find((item) => item.id === 'thaw').title, 'A few fresh steps');
  assert.equal(levels[mopo].title, 'Subtract the disagreement');
  assert.equal(levels[mopo].custom, true);
  assert.equal(levels[mopo].world, 'mopo');
  assert.equal(levels[mopo].phase, 4);
  assert.match(levels[mopo].goal.text, /does not read a dataset bit/);
  assert.match(context.window.CONTENT.cards.mopo.paper, /MOPO: Model-Based Offline Policy Optimization/);
  assert.doesNotMatch(context.window.CONTENT.cards.mopo.paper, /COMBO value loss is/);
  const prose = JSON.stringify({
    level: levels[mopo],
    card: context.window.CONTENT.cards.mopo,
  });
  assert.equal(prose.includes('\u2014'), false);
  assert.equal(prose.includes('\u2013'), false);
  assert.match(fs.readFileSync('web/app.js', 'utf8'), /id === 'mopo'/);
  const build = fs.readFileSync('build.mjs', 'utf8');
  assert.ok(build.indexOf('web/thaw-level.js') < build.indexOf('src/agents/mopo.js'));
  assert.ok(build.indexOf('src/agents/mopo.js') < build.indexOf('web/mopo-level.js'));
  vm.runInContext(fs.readFileSync('web/mopo-level.js', 'utf8'), context, { filename: 'web/mopo-level.js' });
  assert.equal(context.window.CONTENT.levels.filter((item) => item.id === 'mopo').length, 1);
});

test('the mounted lesson takes Span, rejects coefficient 0 and confident agreement, and keeps a wrong explanation from finishing', () => {
  const context = loadLevels();
  const api = context.window.BBMOPO_LEVEL;
  let step = 0;
  let done = false;
  let revealed = null;
  let opened = null;
  function h(tag, attrs, kids) {
    const el = { tag: tag, attrs: attrs || {}, id: attrs && attrs.id, kids: [], isConnected: true };
    const flat = [].concat(kids || []).filter((kid) => kid != null && kid !== false);
    el.kids = flat;
    el.replaceChildren = (...next) => { el.kids = [].concat(next).filter((kid) => kid != null && kid !== false); };
    return el;
  }
  function walk(node, out) {
    out.push(node);
    for (const kid of node.kids || []) if (kid && typeof kid === 'object') walk(kid, out);
    return out;
  }
  const pane = { kids: [], append(node) { this.kids.push(node); } };
  const lab = { kids: [], replaceChildren(...next) { this.kids = next; } };
  api.mount(pane, lab, {
    h: h,
    step: () => step,
    mark: (n) => { if (step < n) step = n; },
    answer: () => null,
    record: () => {},
    next: () => ({ id: 'after', title: 'After', world: 'reach' }),
    openLevel: (id) => { opened = id; },
    done: () => done,
    complete: () => { done = true; step = 5; },
    reveal: (id) => { revealed = id; },
  });
  const find = (id) => walk(pane, []).find((node) => node.id === id);
  find('mopo-p-0').attrs.onclick();
  assert.equal(step, 1);
  find('mopo-run').attrs.onclick();
  assert.equal(step, 2);
  assert.equal(find('mopo-run-readout').attrs['data-chosen'], 'hole');
  assert.equal(find('mopo-run-readout').attrs['data-true'], '0');
  find('mopo-d-0').attrs.onclick();
  assert.equal(step, 3);
  find('mopo-lesson-tables').attrs.onclick();
  assert.equal(find('mopo-readout').attrs['data-chosen'], 'span');
  assert.equal(find('mopo-readout').attrs['data-mask'], 'home');
  assert.equal(find('mopo-readout').attrs['data-new'], '0');
  assert.equal(find('mopo-readout').attrs['data-learned'], 'no');
  assert.equal(find('mopo-readout').attrs['data-combo'], 'no');
  find('mopo-zero').attrs.onclick();
  assert.equal(find('mopo-readout').attrs['data-coefficient'], '0');
  assert.equal(find('mopo-readout').attrs['data-chosen'], 'hole');
  find('mopo-agree-hole').attrs.onclick();
  assert.equal(step, 4);
  assert.equal(find('mopo-readout').attrs['data-chosen'], 'hole');
  assert.equal(find('mopo-readout').attrs['data-true'], '0');
  assert.match(find('mopo-readout').attrs.text, /Limitation/);
  find('mopo-x-1').attrs.onclick();
  find('mopo-complete').attrs.onclick();
  assert.equal(done, false);
  find('mopo-x-0').attrs.onclick();
  find('mopo-complete').attrs.onclick();
  assert.equal(done, true);
  assert.equal(revealed, 'mopo');
  assert.equal(find('mopo-next').kids.join(''), 'Next level: After');
  find('mopo-next').attrs.onclick();
  assert.equal(opened, 'after');
  const rendered = walk(pane, []).concat(walk(lab, [])).map((node) => (node.attrs && (node.attrs.text || node.attrs.html)) || '').join('\n');
  assert.equal(rendered.includes('\u2014'), false);
  assert.match(rendered, /MOPO: Model-Based Offline Policy Optimization/);
  assert.match(rendered, /cannot add a transition/);
});
