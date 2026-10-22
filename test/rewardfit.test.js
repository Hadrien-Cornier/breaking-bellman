'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../src/agents/rewardfit.js');

function hole(path) {
  return path.some((p) => p.x === R.HOLE.x && p.y === R.HOLE.y);
}
function goal(path) {
  const last = path[path.length - 1];
  return !!last && last.x === R.GOAL.x && last.y === R.GOAL.y;
}

test('demonstrations are legal moves that avoid the hole', () => {
  for (const demos of [R.NORTH_DEMOS, R.SOUTH_DEMOS]) {
    assert.equal(demos.length, 12);
    for (const step of demos) {
      const next = R.follow(step);
      assert.ok(next.x >= 0 && next.x < R.WIDTH && next.y >= 0 && next.y < R.HEIGHT);
      assert.equal(hole([next]), false);
    }
  }
});

test('proxy weights plan through the hole because that action value is best', () => {
  const path = R.plan(R.PROXY_WEIGHTS);
  assert.equal(hole(path), true);
  assert.equal(goal(path), true);
  const q = R.actionValues(R.PROXY_WEIGHTS, 1, 1);
  assert.ok(q.right > q.up);
  assert.ok(q.right > q.down);
});

test('north fit then plan avoids the hole and beats the proxy likelihood', () => {
  const fit = R.fitReward(R.NORTH_DEMOS);
  const path = R.plan(fit.weights);
  assert.equal(hole(path), false);
  assert.equal(goal(path), true);
  assert.ok(path.some((p) => p.y === 0));
  const fitted = R.actionLogLikelihood(fit.weights, R.NORTH_DEMOS);
  const proxy = R.actionLogLikelihood(R.PROXY_WEIGHTS, R.NORTH_DEMOS);
  assert.ok(Math.abs(fitted - fit.logLikelihood) < 1e-6);
  assert.ok(fitted > proxy);
  assert.ok(fit.weights[R.FEATURE.hole] < 0);
  const atStart = R.actionValues(fit.weights, 0, 1);
  assert.ok(atStart.up > atStart.right);
  const besideHole = R.actionValues(fit.weights, 2, 0);
  assert.ok(besideHole.right > besideHole.down);
});

test('the fitted weights are a local maximum of the demonstration likelihood', () => {
  const fit = R.fitReward(R.NORTH_DEMOS);
  for (let i = 0; i < fit.weights.length; i++) {
    for (const delta of [-0.1, 0.1]) {
      const trial = fit.weights.slice();
      const next = Math.max(-R.BOUND, Math.min(R.BOUND, trial[i] + delta));
      if (next === trial[i]) continue;
      trial[i] = next;
      const alt = R.actionLogLikelihood(trial, R.NORTH_DEMOS);
      assert.ok(alt <= fit.logLikelihood + 1e-5, `feature ${i} delta ${delta} improved the likelihood`);
    }
  }
});

test('south demonstrations move the lane weight and the planned side', () => {
  const north = R.fitReward(R.NORTH_DEMOS);
  const south = R.fitReward(R.SOUTH_DEMOS);
  const northPath = R.plan(north.weights);
  const southPath = R.plan(south.weights);
  assert.equal(hole(northPath), false);
  assert.equal(hole(southPath), false);
  assert.ok(northPath.some((p) => p.y === 0));
  assert.ok(southPath.some((p) => p.y === 2));
  assert.ok(north.weights[R.FEATURE.lane] > 0);
  assert.ok(south.weights[R.FEATURE.lane] < 0);
  assert.ok(south.weights[R.FEATURE.hole] < 0);
  const q = R.actionValues(south.weights, 0, 1);
  assert.ok(q.down > q.up);
  assert.ok(q.down > q.right);
});

test('finite posterior is the normalized likelihood of four different fits', () => {
  const study = R.study(R.NORTH_DEMOS);
  const lls = study.posterior.map((row) => row.logLikelihood);
  const max = Math.max(...lls);
  const terms = lls.map((ll) => Math.exp(ll - max));
  const z = terms.reduce((a, b) => a + b, 0);
  let sum = 0;
  study.posterior.forEach((row, i) => {
    sum += row.posterior;
    assert.ok(Math.abs(row.posterior - terms[i] / z) < 1e-9);
    assert.ok(Math.abs(row.logLikelihood - R.actionLogLikelihood(row.weights, R.NORTH_DEMOS)) < 1e-6);
  });
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const top = study.posterior.reduce((a, b) => a.posterior > b.posterior ? a : b);
  assert.equal(top.id, 'free');
  assert.equal(study.holeLocked.weights[R.FEATURE.hole], 0);
  assert.equal(hole(study.holeLocked.path), false);
  assert.notDeepEqual(study.holeLocked.weights, study.free.weights);
  assert.equal(hole(study.laneLocked.path), true);
  assert.ok(study.proxy.posterior < study.holeLocked.posterior);
});

test('rewardfit is its own mounted lesson after the offline levels', () => {
  const context = vm.createContext({ window: { BBVPO: {}, BBSUPERMIMIC: {} } });
  const files = ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/fetch-level.js', 'web/vpo-level.js', 'web/supermimic-level.js', 'src/agents/rewardfit.js', 'web/rewardfit-level.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const C = context.window.CONTENT;
  const lesson = C.levels.find((l) => l.id === 'rewardfit');
  const mixed = C.levels.findIndex((l) => l.id === 'mixed');
  const at = C.levels.findIndex((l) => l.id === 'rewardfit');
  const phaseAt = C.phases.findIndex((p) => p.n === 4.5);
  assert.ok(lesson.custom);
  assert.equal(lesson.phase, 4.5);
  assert.equal(lesson.world, 'rewardfit');
  assert.ok(at > mixed);
  assert.equal(C.levels[at + 1].id, 'twoways');
  assert.equal(C.phases[phaseAt - 1].n, 4);
  assert.equal(C.phases[phaseAt + 1].n, 5);
  assert.equal(context.window.BBREWARDFIT.plan(context.window.BBREWARDFIT.PROXY_WEIGHTS).some((p) => p.x === 2 && p.y === 1), true);
  const app = fs.readFileSync('web/app.js', 'utf8');
  assert.match(app, /id === 'rewardfit'/);
  assert.doesNotMatch(app, /supermimic' \? BBSUPERMIMIC : BBVPO/);
  function el() {
    return {
      namespaceURI: 'http://www.w3.org/2000/svg', attrs: {}, children: [], className: '', textContent: '', style: {}, isConnected: true,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      append(...kids) { this.children.push(...kids.filter((k) => k != null && k !== false)); },
      replaceChildren(...kids) { this.children = kids.filter((k) => k != null && k !== false); },
      addEventListener() {},
    };
  }
  function h(tag, attrs, kids) {
    const m = String(tag).match(/^([a-z0-9]+)((?:\.[\w-]+)*)$/i);
    const e = el();
    e.tag = m ? m[1] : String(tag);
    if (m && m[2]) e.className = m[2].slice(1).replace(/\./g, ' ');
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = String(v);
      else if (k === 'id') e.id = v;
      else e.attrs[k] = v;
    }
    e.append(...[].concat(kids || []));
    return e;
  }
  context.document = { createElementNS: () => el() };
  const pane = el();
  const lab = el();
  context.window.BBREWARDFIT.mount(pane, lab, { h, progress: () => 0, answerFor: () => null, done: () => false });
  const ids = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.id) ids.push(node.id);
    for (const kid of node.children || []) walk(kid);
  })(pane);
  assert.ok(ids.includes('rewardfit-lesson'));
  assert.ok(ids.includes('rewardfit-p'));
});
