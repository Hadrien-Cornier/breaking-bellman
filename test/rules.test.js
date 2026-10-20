// Reward contract checks: the visible rules must follow the actual worlds and scoring window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../src/sim/run.js');
require('../src/sim/autopsy.js');
require('../web/rules.js');
const R = globalThis.RLA;
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ctx = vm.createContext({ window: {} });
for (const f of ['content', 'content2', 'measured', 'content3', 'fetch-level']) vm.runInContext(read('web/' + f + '.js'), ctx);
const C = ctx.window.CONTENT;
const rules = (w, k, g) => R.gameRules(w, k, g);
const world = (w, k = {}, prompt) => {
  const obj = R.worlds[w].make(Object.assign(R.knobDefaults(w), k), R.rng.make(3));
  obj.reset(prompt); return obj;
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);

test('every selectable world, level and mission has complete rules and its actual objective', () => {
  assert.equal(C.levels.length, 17); assert.equal(C.missions.length, 11);
  assert.equal(Object.keys(C.worldNames).length, 9);
  for (const w of Object.keys(C.worldNames)) {
    for (const field of ['goal', 'reward', 'equation', 'end', 'score', 'success', 'objective']) {
      assert.ok(rules(w)[field]?.length > 10, `${w}: ${field}`);
      assert.doesNotMatch(rules(w)[field], /undefined|NaN|—/);
    }
    // Every knob extreme still produces coherent rules, including limits and reward switches.
    for (const knob of R.worlds[w].knobs) for (const v of [knob.min, knob.max]) {
      const k = { [knob.key]: v }, r = rules(w, k);
      assert.doesNotMatch(JSON.stringify(r), /undefined|NaN/);
      if (knob.key === 'maxSteps' && !['mirage', 'bandit'].includes(w)) {
        assert.ok(r.end.includes(`${v} steps`));
        assert.ok(r.end.includes(`${Math.max(v, R.worlds[w].evalHorizon || 0)}`));
      }
    }
  }
  for (const l of C.levels) assert.equal(rules(l.world, l.knobs, l.goal.text).objective, l.goal.text, l.id);
  for (const m of C.missions) assert.equal(rules(m.world, m.knobs, m.goalText).objective, m.goalText, m.id);
});

test('pendulum equation uses pre-step angle/speed and applied torque, not tip height', () => {
  assert.equal(rules('pendulum').equation, 'r = −(θ² + 0.1 × ω² + 0.001 × τ²)');
  for (const maxTorque of [0.5, 2, 4]) {
    const w = world('pendulum', { maxTorque }, [Math.PI + 0.2, 2]);
    near(w.step([0.5]).reward, -((Math.PI - 0.2) ** 2 + 0.1 * 4 + 0.001 * (maxTorque * 0.5) ** 2));
    assert.ok(rules('pendulum', { maxTorque }).reward.includes(`±${maxTorque}`));
  }
  const w = world('pendulum', {}, [Math.PI, 0]); let sum = 0, r;
  for (let i = 0; i < 200; i++) { r = w.step([0]); sum += r.reward; assert.equal(r.done, false); }
  near(sum, -(Math.PI ** 2) * 200); assert.equal(r.truncated, true);
  assert.match(rules('pendulum').score, /−1974/);
  assert.match(rules('pendulum', { maxSteps: 100 }).score, /−987/);
  assert.match(rules('pendulum', { maxSteps: 100 }).end, /Tests can run 200 steps; only the first 100/);
});

test('reach penalizes current distance plus clipped commands, even with command latency', () => {
  const r = world('reach', { latency: 4, payload: 2, pickAt: 15 }).step([3, -0.5]);
  near(r.reward, -r.info.dist - 0.01 * (1 + 0.25));
  assert.match(rules('reach', { latency: 4, payload: 2, pickAt: 15 }).goal, /2 kg, arriving at step 15; command latency: 4/);
  assert.match(rules('reach').equation, /0.01 × \(a₁² \+ a₂²\)/);
});

test('fork includes distance, crash, mud and terminal bonus with matching definitions', () => {
  for (const mud of [0, 0.3]) {
    const w = world('fork', { mud }, [-0.6, 0]);
    const r = w.step([0, 0]); near(r.reward, -0.05 - mud);
    assert.ok(rules('fork', { mud }).equation.includes(`${mud} × inMud`));
  }
  const hit = world('fork', {}, [0, -0.51]).step([0, 1]);
  assert.equal(hit.info.crash, true); near(hit.reward, -0.05 * 1.31 - 0.5); assert.equal(hit.done, false);
  const win = world('fork', {}, [0, 0.75]).step([0, 0]);
  assert.equal(win.done, true); near(win.reward, 1 - 0.05 * 0.05);
  assert.match(rules('fork').end, /0.08/);
});

test('fetch rules cover all shaping modes, signed facing, turn cost, pickup and return', () => {
  for (const shaping of [0, 1, 2]) for (const bringBack of [0, 1]) {
    const k = { shaping, bringBack, found: 2, timeCost: 0.025, spinCost: 0.015, closerW: 2, facingW: 0.1 };
    const w = world('fetch', k, [0, 0, 0, 0.5, 0]);
    const r = w.step(1), st = w.getState(), dAfter = Math.hypot(st[0] - 0.5, st[1]);
    const bearing = Math.atan2(-st[1], 0.5 - st[0]) - st[2];
    const shape = shaping === 0 ? 0 : shaping === 1 ? 2 * Math.max(0, 0.5 - dAfter) : 2 * (0.5 - 0.97 * dAfter);
    near(r.reward, -0.025 - 0.015 + 0.1 * Math.cos(bearing) + shape);
    const rule = rules('fetch', k);
    assert.match(rule.equation, /0.025.*0.015.*0.1/);
    assert.equal(rule.equation.includes('max(0, dBefore'), shaping === 1);
    assert.equal(rule.equation.includes('0.97 × dAfterNonterminal'), shaping === 2);
    const pick = world('fetch', k, [0, 0, 0, 0.08, 0]).step(3);
    assert.equal(pick.done, !bringBack); near(pick.info.parts.found, bringBack ? 1 : 2);
    if (bringBack) near(pick.info.parts.facing, 0);
    if (shaping === 2) near(pick.info.parts.closer, 2 * (0.08 - (bringBack ? 0.97 * 0.08 : 0)));
  }
  const w = world('fetch', { bringBack: 1 }, [0, -0.85, 0, 0.08, -0.85]);
  assert.equal(w.step(3).done, false); assert.equal(w.step(3).done, true);
  assert.match(rules('fetch').end, /0.09/);
});

test('bandit and mirage payout noise coefficients and episode endings match rules', () => {
  const b = world('bandit', { noise: 0, drift: 0 }); const mean = b.means[0], r = b.step(0);
  near(r.reward, mean); assert.equal(r.done, true);
  assert.match(rules('bandit', { noise: 2, drift: 0.1 }).reward, /standard deviation 2.*standard deviation 0.1/);
  for (const mean of [-0.5, 0, 0.5]) {
    const m = world('mirage', { noise: 0, mean });
    assert.equal(m.step(1).reward, 0); const r = m.step(0);
    near(r.reward, mean); assert.equal(r.done, true);
    assert.ok(rules('mirage', { mean }).equation.includes(`${mean} +`));
  }
  assert.equal(world('mirage').step(0).done, true);
});

test('cliff and cartpole switch to the actual sparse reward instead of a generic dense formula', () => {
  for (const sparseReward of [0, 1]) {
    const cliff = world('cliff', { sparseReward, cliffPenalty: -60 });
    near(cliff.step(1).reward, sparseReward ? 0 : -60);
    const c = world('cartpole', { sparseReward, maxSteps: 50 }, [0, 0, 0, 0]);
    near(c.step(0).reward, sparseReward ? 0 : 1);
    c.setState([3, 0, 0, 0]); const fail = c.step(0);
    assert.equal(fail.done, true); near(fail.reward, sparseReward ? 0 : 1);
    assert.match(rules('cartpole', { sparseReward }).reward, sparseReward ? /1 only for surviving/ : /Every step pays 1/);
    assert.match(rules('cliff', { sparseReward }).equation, sparseReward ? /10 at goal; 0 otherwise/ : /−1 otherwise/);
  }
  const g = world('goalgrid', {}, [0, 0, 1, 0]); const win = g.step(1);
  assert.equal(win.reward, 1); assert.equal(win.done, true);
  assert.match(rules('goalgrid', { size: 11, wall: 1 }).goal, /11 × 11.*single gap/);
});

test('short-limit pendulum score uses first limit rewards, final test mean and worst seed', () => {
  // A fixed zero-action learner isolates evaluation from learning, using the actual runner.
  R.rulesProbe = { make: () => ({ parts: { family: 'rulesProbe' }, notes: [], act: () => [0], observe() {}, endEpisode() {}, diagnostics: () => ({}) }) };
  const a = R.run({ world: 'pendulum', knobs: { maxSteps: 100 }, parts: { family: 'rulesProbe' }, steps: 100, evalEvery: 100, seed: 7 });
  assert.equal(a.trace.length, 200); assert.equal(a.final.n, 20);
  near(a.final.ret, a.trace.slice(0, 100).reduce((n, x) => n + x.r, 0));
  const b = { ...a, final: { ...a.final, meanRet: a.final.meanRet - 100 } };
  const summary = R.autopsy([a, b]).summary;
  near(summary.pendulumScore, (a.final.meanRet + b.final.meanRet) / 2);
  near(summary.worstSeed, b.final.meanRet);
  const evidence = R.autopsy([a]).symptoms.map(s => s.evidence).join(' ');
  assert.match(evidence, /100 scored steps/); assert.doesNotMatch(evidence, /200 steps|1200/);
  const level = C.levels.find(l => l.id === 'continuous');
  assert.equal(level.goal.test({ summary: { worstSeed: -251, pendulumScore: -100 } }), false);
  assert.equal(level.goal.test({ summary: { worstSeed: -250, pendulumScore: -100 } }), true);
  const heavy = C.missions.find(m => m.id === 'heavy');
  assert.equal(heavy.test({ summary: { pendulumScore: -700 } }), false);
  assert.equal(heavy.test({ summary: { pendulumScore: -701 } }), true);
  delete R.rulesProbe;
});
