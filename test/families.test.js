// Phases 2 to 5: every word of the policy-gradient and actor-critic sentences builds a learner that runs without NaN,
// the probe's numbers obey the update rule the page shows, and a few small runs learn.
const test = require('node:test');
const assert = require('node:assert');
const RLA = require('../src/sim/run.js');
require('../src/sim/autopsy.js');
const finite = (x, msg) => assert.ok(typeof x === 'number' && Number.isFinite(x), `${msg}: ${x}`);

test('policy gradient: every word value runs on CartPole and the goal grid without NaN', () => {
  const words = { batch: [1, 4], group: ['none', 'same'], credit: ['total', 'togo'], baseline: ['none', 'avg', 'critic', 'group'], adv: ['mc', 'td', 'gae'], scale: ['none', 'std'], ratio: ['plain', 'clip'], epochs: [1, 4], bonus: [0, 0.01] };
  for (const world of ['cartpole', 'goalgrid', 'pendulum']) for (const k in words) for (const v of words[k]) {
    const r = RLA.run({ world, parts: { family: 'pg', [k]: v }, steps: 1500, seed: 3 });
    for (const d of r.diag) { finite(d.loss === undefined ? 0 : d.loss, `${world} ${k}=${v} loss`); }
    finite(r.evals[r.evals.length - 1].ret, `${world} ${k}=${v} return`);
  }
});

test('policy gradient: the clip stops paying once the ratio leaves [0.8, 1.2]', () => {
  const s = RLA.session({ world: 'cartpole', parts: { family: 'pg', batch: 4, baseline: 'critic', ratio: 'clip', epochs: 10, lr: 0.03 }, seed: 5, knobs: { maxSteps: 500 } });
  let p = null;
  for (let i = 0; i < 6; i++) p = s.untilUpdate().probe;
  assert.ok(p && p.rows.length, 'probe rows');
  for (const row of p.rows) {
    const outside = row.adv > 0 ? row.ratio > 1.2 : row.ratio < 0.8;
    if (row.clipped) assert.ok(outside, `clipped row must be outside the band in the helpful direction: ratio ${row.ratio}, adv ${row.adv}`);
  }
});

test('policy gradient: a group with the same score in every try has zero advantages', () => {
  const s = RLA.session({ world: 'goalgrid', parts: { family: 'pg', batch: 8, group: 'same', baseline: 'group' }, seed: 2, knobs: { size: 11, maxSteps: 6 } });
  const p = s.untilUpdate().probe;
  assert.ok(p, 'probe');
  if (p.gStd === 0) for (const row of p.rows) assert.equal(row.adv, 0);
});

test('REINFORCE with rewards-to-go learns CartPole (500 steps limit) within 15000 steps', () => {
  const r = RLA.run({ world: 'cartpole', knobs: { maxSteps: 500 }, parts: { family: 'pg', batch: 1, credit: 'togo' }, steps: 15000, seed: 101 });
  const best = Math.max(...r.evals.map((e) => e.ret));
  assert.ok(best > 150, `best greedy score ${best}`);
});

test('actor-critic: every word value runs on pendulum, reach and fork without NaN', () => {
  const words = { source: ['own', 'fixed', 'both'], demos: ['expert', 'mixed', 'noisy'], base: ['none', 'classical'], head: ['det', 'gauss', 'flow'], chunk: [1, 5],
    aim: ['q', 'qclose', 'copy', 'copybest', 'weighted', 'cond', 'none'], critics: ['none', 'one', 'two'], target: ['live', 'slow'], next: ['policy', 'smooth', 'expectile', 'data'],
    penalty: ['none', 'cql'], delay: [1, 2], entropy: ['none', 'fixed', 'auto'], pick: ['one', 'best', 'qavg', 'edit'], wait: [0, 3000] };
  for (const world of ['pendulum', 'reach', 'fork']) for (const k in words) for (const v of words[k]) {
    const parts = { family: 'ac', [k]: v };
    if (k === 'demos' || k === 'aim' || k === 'next' || k === 'penalty') parts.source = 'fixed';
    const r = RLA.run({ world, parts, steps: 300, seed: 7, hyper: { warmup: 100, pretrain: 50, demoEpisodes: 6 } });
    const d = r.diag[r.diag.length - 1] || {};
    for (const key of ['qData', 'qPolicy']) if (d[key] !== undefined && d[key] !== null) finite(d[key], `${world} ${k}=${v} ${key}`);
    finite(r.final.meanRet, `${world} ${k}=${v} test return`);
  }
});

test('actor-critic: the policy does not change while it waits for the critic', () => {
  const s = RLA.session({ world: 'reach', parts: { family: 'ac', base: 'classical', wait: 3000 }, seed: 4, hyper: { warmup: 0 } });
  const o = s.world.reset();
  const before = Array.from(s.learner.act(o, false));
  s.advance(800);
  assert.ok(s.learner.diagnostics().updates > 100, 'critic updates happened');
  const after = Array.from(s.learner.act(o, false));
  assert.deepStrictEqual(after, before);
});

test('offline behavior cloning on expert reach data ends near the target; naive offline critic-climbing does not', () => {
  const bc = RLA.run({ world: 'reach', parts: { family: 'ac', source: 'fixed', demos: 'expert', head: 'det', critics: 'none', aim: 'copy', entropy: 'none' }, steps: 3000, seed: 101 });
  const naive = RLA.run({ world: 'reach', parts: { family: 'ac', source: 'fixed', demos: 'expert', head: 'det', critics: 'one', aim: 'q', entropy: 'none' }, steps: 3000, seed: 101 });
  assert.ok(bc.final.meanDist < naive.final.meanDist, `BC ${bc.final.meanDist} vs naive ${naive.final.meanDist}`);
});

test('fork: the demonstrator reaches the goal without touching the obstacle, and alternates sides', () => {
  const W = RLA.worlds.fork;
  for (const obstacle of [0.1, 0.3, 0.5, 0.6]) for (const spread of [0, 0.1]) {
    const w = W.make(Object.assign(RLA.knobDefaults('fork'), { obstacle, spread }), RLA.rng.make(3));
    const sides = [];
    for (let e = 0; e < 6; e++) {
      let o = w.reset(); const ctx = w.expertStart(); sides.push(ctx.side);
      let ok = false;
      for (let t = 0; t < 40; t++) { const r = w.step(w.expert(o, ctx)); o = r.obs; assert.ok(!r.info.crash, `obstacle ${obstacle} spread ${spread}: crash`); if (r.done) { ok = true; break; } }
      assert.ok(ok, `obstacle ${obstacle} spread ${spread}: no goal in 40 steps`);
    }
    assert.deepStrictEqual(sides, [-1, 1, -1, 1, -1, 1]);
  }
});

test('fork: mud costs only on the left, and the final test counts left routes', () => {
  const w = RLA.worlds.fork.make(Object.assign(RLA.knobDefaults('fork'), { mud: 0.1 }), RLA.rng.make(1));
  w.reset(); w.setState([-0.7, 0]); const left = w.step(Float32Array.of(0, 0.5));
  w.reset(); w.setState([0.7, 0]); const right = w.step(Float32Array.of(0, 0.5));
  assert.ok(left.info.mud && !right.info.mud);
  assert.ok(Math.abs(left.reward - right.reward + 0.1) < 1e-9, `left ${left.reward} right ${right.reward}`);
  const r = RLA.run({ world: 'fork', parts: { family: 'ac', source: 'fixed', demos: 'expert', head: 'det', critics: 'none', aim: 'copy', entropy: 'none' }, steps: 200, seed: 2, hyper: { demoEpisodes: 6 } });
  assert.ok(typeof r.final.leftRate === 'number' && r.final.leftRate >= 0 && r.final.leftRate <= 1);
});
