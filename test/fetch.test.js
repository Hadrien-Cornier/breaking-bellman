// Fetch world: dynamics, reward parts, and the two reward hacks it is built to show.
const test = require('node:test');
const assert = require('node:assert');
require('../src/core/rng.js');
require('../src/worlds/fetch.js');
const RLA = globalThis.RLA;
const F = RLA.worlds.fetch;
const knob = (o) => Object.assign(Object.fromEntries(F.knobs.map((k) => [k.key, k.default])), o);
const greedy = (o) => (Math.abs(Math.atan2(o[1], o[0])) > 0.3 ? (o[1] > 0 ? 1 : 2) : 0);
function play(w, policy, start) {
  let o = w.reset(start), tot = 0, n = 0, disc = 0, g = 1, end = null;
  for (;;) {
    const r = w.step(policy(o, n)); tot += r.reward; disc += g * r.reward; g *= w.spec.gamma; n++; o = r.obs;
    if (r.done || r.truncated) { end = r; break; }
  }
  return { tot, disc, n, end };
}

test('same seed and actions give the same run', () => {
  const run = () => {
    const w = F.make(knob({}), RLA.rng.make(7)); w.reset(); const out = [];
    for (let i = 0; i < 30; i++) { const r = w.step(i % 4); out.push(r.reward, ...r.obs); if (r.done || r.truncated) break; }
    return out;
  };
  assert.deepStrictEqual(run(), run());
});

test('observation: bearing and distance from the dog', () => {
  const w = F.make(knob({}), RLA.rng.make(1));
  const o = w.reset([0, 0, 0, 0.5, 0]);
  assert.ok(Math.abs(o[0] - 1) < 1e-6 && Math.abs(o[1]) < 1e-6 && Math.abs(o[2] - 0.25) < 1e-6);
  const o2 = w.reset([0, 0, Math.PI / 2, 0.5, 0]);
  assert.ok(Math.abs(o2[1] + 1) < 1e-6, 'stick on the right of a dog that faces up');
});

test('a scripted greedy dog gets the stick, and its return is found - cost * steps', () => {
  const w = F.make(knob({}), RLA.rng.make(3));
  let ok = 0, steps = 0;
  for (let i = 0; i < 100; i++) {
    const r = play(w, greedy); steps += r.n;
    if (r.end.done) { ok++; assert.ok(Math.abs(r.tot - (1 - 0.01 * r.n)) < 1e-6); }
  }
  assert.ok(ok >= 95, 'reached ' + ok + ' of 100');
  assert.ok(steps / 100 < 60);
});

// walk to distance 0.3, then turn away, walk off, and come back, forever
function zigzag() {
  let phase = 0, k = 0;
  return (o) => {
    const d = o[2] * 2;
    if (phase === 0) { if (d < 0.3) { phase = 1; k = 0; } else return greedy(o); }
    if (phase === 1) { k++; if (k <= 7) return Math.abs(Math.atan2(o[1], o[0])) < 2.8 ? 1 : 0; if (k <= 11) return 0; phase = 2; }
    if (d > 0.3) return greedy(o);
    phase = 1; k = 0; return 1;
  };
}
const far = [0, -0.8, Math.PI / 2, 0, 0.6];

test('"pay only for getting closer" can be gamed: walking away and back pays more than the stick', () => {
  const k = knob({ shaping: 1, closerW: 3, timeCost: 0, found: 1, maxSteps: 120 });
  const g = play(F.make(k, RLA.rng.make(1)), greedy, far), z = play(F.make(k, RLA.rng.make(1)), zigzag(), far);
  assert.ok(!z.end.done && z.tot > g.tot, 'zigzag ' + z.tot.toFixed(2) + ' vs fetch ' + g.tot.toFixed(2));
});

test('potential-based shaping cannot be gamed, and its discounted sum telescopes', () => {
  const k = knob({ shaping: 2, closerW: 3, timeCost: 0, found: 1, maxSteps: 120 });
  const g = play(F.make(k, RLA.rng.make(1)), greedy, far), z = play(F.make(k, RLA.rng.make(1)), zigzag(), far);
  assert.ok(z.disc < g.disc, 'zigzag ' + z.disc.toFixed(3) + ' vs fetch ' + g.disc.toFixed(3));
  // the shaping part alone: sum_t gamma^t F_t = 0 - Phi(s0) = closerW * d0 for an episode that ends at the stick
  const w = F.make(k, RLA.rng.make(1)); let o = w.reset(far), s = 0, gm = 1; const d0 = o[2] * 2;
  for (;;) {
    const r = w.step(greedy(o)); s += gm * r.info.parts.closer; gm *= w.spec.gamma; o = r.obs;
    if (r.done || r.truncated) { assert.ok(r.done); break; }
  }
  assert.ok(Math.abs(s - 3 * d0) < 1e-5, s + ' vs ' + 3 * d0);
});

test('a facing bonus can be gamed: turn to the stick and sit pays more than fetching', () => {
  const k = knob({ facingW: 0.1, timeCost: 0, found: 1, maxSteps: 120 });
  const sit = (o) => (Math.abs(Math.atan2(o[1], o[0])) > 0.3 ? (o[1] > 0 ? 1 : 2) : 3);
  const g = play(F.make(k, RLA.rng.make(1)), greedy, far), s = play(F.make(k, RLA.rng.make(1)), sit, far);
  assert.ok(!s.end.done && s.tot > g.tot, 'sit ' + s.tot.toFixed(2) + ' vs fetch ' + g.tot.toFixed(2));
});

test('bring it back: half the reward at the stick, the rest at the thrower', () => {
  const w = F.make(knob({ bringBack: 1, timeCost: 0, maxSteps: 120 }), RLA.rng.make(2));
  let o = w.reset(far); const got = [];
  for (;;) {
    const r = w.step(greedy(o)); if (r.info.parts.found) got.push([r.info.parts.found, r.obs[5], r.done]); o = r.obs;
    if (r.done || r.truncated) break;
  }
  assert.deepStrictEqual(got, [[0.5, 1, false], [1, 1, true]]);
});

test('throwStick, state round trip, and no step after the end', () => {
  const w = F.make(knob({}), RLA.rng.make(4)); w.reset();
  w.throwStick(0.4, 0.5); const s = w.getState();
  assert.deepStrictEqual([s[3], s[4], s[5], s[6]], [0.4, 0.5, 0, 0]);
  w.step(0); const s2 = w.getState(); w.step(0); w.setState(s2); assert.deepStrictEqual(w.getState(), s2);
  const w2 = F.make(knob({ maxSteps: 20 }), RLA.rng.make(4)); w2.reset(); let r;
  do { r = w2.step(3); } while (!r.done && !r.truncated);
  assert.throws(() => w2.step(0));
});

test('render runs on a fake canvas', () => {
  const ctx = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const w = F.make(knob({ bringBack: 1 }), RLA.rng.make(5)); w.reset(); w.step(0);
  w.render(ctx, 640, 280); w.render(ctx, 300, 300, null, { text: 'hi', paths: [[[0, 0], [0.1, 0.1]]] });
  assert.deepStrictEqual(w.fieldAt(320, 150, 640, 280).map((v) => Math.round(v * 1e6) / 1e6), [0, 0]);
});
