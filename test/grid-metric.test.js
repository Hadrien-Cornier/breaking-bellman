// The "Try every combination" table must show the same metric, in the same unit, as the autopsy
// and the level goal (bb-table-metric bug: cells read "0.868 +-0.478" while the autopsy said 1%).
// The cell carries a % sign on a percent metric, its +- is the standard error of the number the
// cell shows, and the swept words that do nothing in the sentence are named under the table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
for (const f of ['src/core/rng.js', 'src/core/nn.js', 'src/worlds/mirage.js', 'src/agents/value.js', 'src/sim/run.js', 'src/sim/autopsy.js']) require('../' + f);
const RLA = globalThis.RLA;
require('../src/sim/exact.js');
const app = read('web/app.js');

// Run the real sentence words (wordText, SHORT, recognize, idleWords) and the real
// try-every-combination code (metricOf, metricSE, runGrid, gridMatrix, gridList) in a vm,
// with runs replaced by finished results. This drives the code a player's table is drawn from.
function harness() {
  const ctx = vm.createContext({ window: {}, RLA, performance: { now: () => 0 } });
  for (const f of ['web/content.js', 'web/content2.js', 'web/content3.js']) vm.runInContext(read(f), ctx);
  const C = ctx.window.CONTENT;
  const els = {};
  const el = (s) => (els[s] = els[s] || { value: s === '#seeds' ? '2' : '600', disabled: false, textContent: '' });
  const h = (tag, attrs = {}, kids = []) => ({ tag, attrs: attrs || {}, kids: [].concat(kids || []).filter(Boolean),
    append(...children) { this.kids.push(...children); },
    replaceChildren(...children) { this.kids = children.filter(Boolean); } });
  const S = { running: false, parts: C.cfg({}), knobs: {}, world: 'mirage', found: [], seen: [], given: [] };
  Object.assign(ctx, {
    C, S, h, W: C.words, $: el,
    toast() {}, onPartsChanged() {},
    hyperNow: () => ({}),
    runIdentity: () => 'fixed test settings',
    range: (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; },
    short: (x) => String(x),
    runSeeds: () => Promise.resolve(ctx.__results || []),
    fastClient: { save:async()=>true,lookup: async () => ({ record: { results: ctx.__results || [] } }) },
  });
  ctx.window.BB_FAST = { versions: { engine: 'test' }, base: 'fast/test' };
  vm.runInContext(read('web/aggregate.js'), ctx);
  vm.runInContext(app.slice(app.indexOf('  const fmt = (x) => {'), app.indexOf('\n  };', app.indexOf('  const fmt = (x) => {')) + 5), ctx);
  vm.runInContext(app.slice(app.indexOf('  // ---------------------------------------------------------------- the sentence: words, recognizer'),
    app.indexOf('  // ---------------------------------------------------------------- sentence component')), ctx);
  vm.runInContext(app.slice(app.indexOf('  // ---------------------------------------------------------------- try every combination'),
    app.indexOf('  // ---------------------------------------------------------------- watch one update')), ctx);
  const nodes = (e) => [e, ...(e.kids || []).flatMap(nodes)];
  const text = (e) => nodes(e).map((n) => (typeof n === 'string' ? n : (n.attrs && (n.attrs.text || n.attrs.html)) || '')).join('\n');
  return {
    ctx, S, C, text,
    async run(world, parts, keys, results) {
      S.world = world; S.parts = C.cfg(parts || {});
      ctx.__results = results;
      vm.runInContext('G.keys = ' + JSON.stringify(keys) + '; G.world = ' + JSON.stringify(world) +
        "; G.family = C.famOf(S.parts); G.base = S.parts;", ctx);
      await ctx.runGrid();
      return { matrix: text(ctx.gridMatrix()), list: text(ctx.gridList()) };
    },
  };
}

// one finished mirage run whose left-door share is wins[j] in window j (10-20%, 20-30%, 30-40%
// of its episodes)
function mirageRun(wins, seed) {
  const left = new Array(100).fill(0);
  [[10, 20], [20, 30], [30, 40]].forEach(([a, b], j) => {
    const k = Math.round(wins[j] * (b - a));
    for (let i = a; i < a + k; i++) left[i] = 1;
  });
  return { world: 'mirage', parts: { family: 'value', nstep: 4 }, knobs: { mean: -0.1, maxSteps: 2, machines: 10, noise: 1 },
    ep: { left, t: left.map((x, i) => (i + 1) * 2) }, final: { qA: [-0.1, -0.1] }, diag: [{ t: 15, loss: 0.1, eps: 0.1, updates: 1 }], seed, steps: 1200 };
}
function banditRun(seed) {
  const optimal = new Array(200).fill(0);
  for (let i = 160; i < 200; i++) optimal[i] = i % 2; // last 20%: half the pulls on the best machine
  return { world: 'bandit', parts: { family: 'value' }, knobs: {}, bandit: { optimal, reward: optimal.slice(), regret: optimal.slice() },
    ep: { left: [], ret: [] }, final: {}, diag: [], seed, steps: 200 };
}
function cartpoleRun(seed) {
  return { world: 'cartpole', parts: { family: 'value' }, knobs: { maxSteps: 200 },
    evals: [{ ret: 100, maxQ: 20 }, { ret: 120, maxQ: 20 }, { ret: 140, maxQ: 20 }, { ret: 160, maxQ: 20 }],
    ep: { left: [], ret: [] }, final: {}, diag: [], seed, steps: 200 };
}

test('table cell: a percent metric prints a % sign on the value and on the +-', async () => {
  // two seeds that peak in different windows: the table shows the worst of the three windows
  // (50%), which is the autopsy's leftPeak, in the autopsy's unit
  const res = [mirageRun([1, 0, 0], 1), mirageRun([0, 1, 0], 2)];
  const h = harness();
  const { matrix, list } = await h.run('mirage', { nstep: 4, picker: 'second', scorer: 'second' }, ['picker', 'scorer'], res);
  const peak = 100 * RLA.autopsy(res).summary.leftPeak;
  assert.equal(peak, 50);
  assert.match(list, /50\.0% ± \d/, 'the list cell shows the autopsy number with a % sign: ' + list.slice(0, 200));
  assert.match(matrix, /50\.0%/, 'the matrix cell shows the autopsy number with a % sign');
  assert.match(matrix, /±\d+\.\d+%/, 'the matrix +- carries the same % sign');
});

test('table cell: the +- is the standard error of the number the cell shows', async () => {
  // the old +- was the standard error of the per-seed maxima ([100, 100] here: zero), while the
  // cell shows the worst of the across-seed window means (50). The +- must belong to that 50.
  const res = [mirageRun([1, 0, 0], 1), mirageRun([0, 1, 0], 2)];
  const h = harness();
  await h.run('mirage', { nstep: 4 }, ['picker'], res);
  const se = h.ctx.metricSE(res, 'mirage');
  assert.ok(se > 5 && se < 50, 'bootstrap standard error of the displayed statistic is ' + se);
  // per-seed values are [100, 100]; their standard error is 0 and must not be shown
  const per = res.map((r) => h.ctx.metricOf(RLA.autopsy([r]), 'mirage').v);
  assert.deepEqual(per, [100, 100]);
});

test('table note: the swept words that do nothing in this sentence are named', async () => {
  // 4 real rewards on this 2-step world: there is no guess, so "chosen by" and "scored by"
  // are idle (the same idle words PR #3 marks in the sentence builder)
  const res = [mirageRun([0.2, 0, 0], 1), mirageRun([0, 0, 0], 2)];
  const h = harness();
  const { matrix } = await h.run('mirage', { nstep: 4, picker: 'second', scorer: 'second' }, ['picker', 'scorer'], res);
  assert.match(matrix, /do nothing in this sentence/);
  assert.match(matrix, /"chosen by" and "scored by"/);
  assert.match(matrix, /name column/);
  // when the swept words matter there is no idle note
  const live = await h.run('mirage', { nstep: 1, agg: 'max' }, ['picker'], [mirageRun([0.2, 0, 0], 1), mirageRun([0, 0, 0], 2)]);
  assert.doesNotMatch(live.matrix, /do nothing in this sentence/);
});

test('table unit: the slots table keeps its % sign and a score world keeps bare numbers', async () => {
  const h = harness();
  const slots = await h.run('bandit', {}, ['eps'], [banditRun(1), banditRun(2)]);
  assert.match(slots.list, /50\.0%/, 'bandit: % of late pulls prints with a % sign');
  const cart = await h.run('cartpole', {}, ['store'], [cartpoleRun(1), cartpoleRun(2)]);
  assert.doesNotMatch(cart.list, /%/, 'cartpole: a score prints without a % sign');
  assert.match(cart.list, /160\.0/, 'cartpole: the score still prints');
});
test('stored full-seed inputs retain identical bootstrap uncertainty, matrix and list values', async () => {
  const results=[mirageRun([1,0,0],101),mirageRun([0,1,0],202)],h=harness();
  const live=await h.run('mirage',{nstep:4},['picker'],results),se=h.ctx.metricSE(results,'mirage');
  h.ctx.$('#run-mode').value='fast';
  const stored=await h.run('mirage',{nstep:4},['picker'],RLA.exact.parse(RLA.exact.stringify(results)));
  assert.equal(h.ctx.metricSE(RLA.exact.parse(RLA.exact.stringify(results)),'mirage'),se);
  assert.equal(stored.matrix.replaceAll('Stored simulation','Live'),live.matrix);
  assert.equal(stored.list,live.list);
});
