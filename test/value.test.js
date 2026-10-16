// Engine v2 targets: each sentence word must build the target the page shows in "Watch one update".
// The probe replays one real update; these tests recompute that target by hand from the probe's own numbers.
const test = require('node:test');
const assert = require('node:assert');
for (const f of ['src/core/rng.js', 'src/core/nn.js', 'src/worlds/bandit.js', 'src/worlds/cliff.js', 'src/worlds/cartpole.js', 'src/worlds/mirage.js', 'src/agents/value.js', 'src/sim/run.js']) require('../' + f);
const RLA = globalThis.RLA;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const cliffH = { epsStart: 0.1, epsEnd: 0.1, lrTable: 0.5 };

function probeOf(world, parts, hyper, n, opts) {
  const s = RLA.session({ world, parts, hyper, seed: 3 });
  s.advance(n);
  const r = s.stepAndProbe(opts || { wantGuess: true });
  assert.ok(r.probe, 'probe exists');
  return r.probe;
}
const isMax = (q, a) => q.every((v) => v <= q[a] + 1e-12);

test('Q-learning: best next action, live chooses and scores; table step alpha', () => {
  const p = probeOf('cliff', {}, cliffH, 1500);
  assert.equal(p.end, false);
  const q = p.before.qN.live;
  assert.ok(isMax(q, p.detail.aStar), 'chosen action is a max of the live estimate');
  close(p.y, p.R + p.gk * q[p.detail.aStar], 'target');
  close(p.after.qS[p.a], p.before.qS[p.a] + 0.5 * (p.y - p.before.qS[p.a]), 'table update');
});

test('Sarsa: the action really taken next', () => {
  const p = probeOf('cliff', { agg: 'taken' }, cliffH, 1500);
  assert.ok(p.aN >= 0, 'row knows the next action');
  close(p.y, p.R + p.gk * p.before.qN.live[p.aN], 'target');
});

test('Expected Sarsa: average under epsilon-greedy of the live estimate', () => {
  const p = probeOf('cliff', { agg: 'mean' }, cliffH, 1500);
  const q = p.before.qN.live, n = q.length, e = p.detail.eps;
  assert.ok(isMax(q, p.detail.aStar));
  const mean = q.reduce((s, v) => s + v, 0) / n;
  close(p.y, p.R + p.gk * ((1 - e) * q[p.detail.aStar] + e * mean), 'target');
});

test('Double Q: live chooses, second scores; second is not trained by this update', () => {
  const p = probeOf('mirage', { scorer: 'second' }, { epsStart: 0.1, epsEnd: 0.1 }, 80);
  assert.equal(p.end, false);
  assert.ok(isMax(p.before.qN.live, p.detail.aStar));
  close(p.y, p.R + p.gk * p.before.qN.second[p.detail.aStar], 'target');
  assert.deepStrictEqual(p.after.qN.second, p.before.qN.second);
});

test('Clipped double Q: smaller of live and second', () => {
  const p = probeOf('mirage', { scorer: 'minpair' }, { epsStart: 0.1, epsEnd: 0.1 }, 80);
  const a = p.detail.aStar;
  close(p.y, p.R + p.gk * Math.min(p.before.qN.live[a], p.before.qN.second[a]), 'target');
});

test('DQN: frozen copy chooses and scores, and does not move in an update', () => {
  const p = probeOf('cartpole', { store: 'net', data: 'replay', picker: 'frozen', scorer: 'frozen' }, {}, 800);
  const f = p.before.qN.frozen;
  assert.ok(isMax(f, p.detail.aStar));
  close(p.y, p.R + p.gk * f[p.detail.aStar], 'target');
  assert.deepStrictEqual(p.after.qN.frozen, f, 'frozen copy unchanged');
  close(p.yAfter, p.y, 'target unchanged after the update');
});

test('Naive network: the target moves with the update', () => {
  const p = probeOf('cartpole', { store: 'net' }, {}, 300);
  assert.ok(Math.abs(p.yAfter - p.y) > 0, 'shared weights move the guess');
});

test('Monte Carlo: no guess, full discounted return of the episode', () => {
  const p = probeOf('cliff', { nstep: 0 }, cliffH, 500, { first: true });
  assert.equal(p.end, true);
  let R = 0, g = 1; for (const r of p.rewards) { R += g * r; g *= p.gamma; }
  close(p.R, R, 'return');
  close(p.y, p.R, 'target');
});

test('4 real rewards, then a guess with gamma^4', () => {
  const p = probeOf('cliff', { nstep: 4 }, cliffH, 1500);
  assert.equal(p.rewards.length, 4);
  let R = 0, g = 1; for (const r of p.rewards) { R += g * r; g *= p.gamma; }
  close(p.R, R, 'discounted rewards');
  close(p.gk, Math.pow(p.gamma, 4), 'gamma^4');
  close(p.y, p.R + p.gk * Math.max(...p.before.qN.live), 'target');
});

test('hold: a held update does not change the estimates until probe()', () => {
  const s = RLA.session({ world: 'cliff', parts: {}, hyper: cliffH, seed: 5 });
  s.advance(300);
  const before = Array.from(s.learner.table());
  s.learner.hold(true); s.advance(1); s.learner.hold(false);
  assert.deepStrictEqual(Array.from(s.learner.table()), before);
});
