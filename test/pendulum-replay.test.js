const test = require('node:test');
const assert = require('node:assert/strict');
const RLA = require('../src/sim/run.js');

test('level 10 replays swing-up from hanging without changing its random-start scores', () => {
  // The actual first run: its random test starts 6.9 degrees from upright and
  // barely moves, which made a working renderer look frozen on desktop and phone.
  const r = RLA.run({ world: 'pendulum', seed: 101, steps: 10000, parts: {
    family: 'ac', source: 'own', demos: 'mixed', base: 'none', head: 'det', chunk: 1,
    aim: 'q', critics: 'one', target: 'live', next: 'policy', penalty: 'none',
    delay: 1, entropy: 'none', pick: 'one', wait: 0,
  } });
  const span = (trace) => Math.max(...trace.map((t) => t.s[0])) - Math.min(...trace.map((t) => t.s[0]));
  assert.ok(span(r.trace) < 0.14, 'retain the original almost-upright test episode');
  assert.ok(Math.abs(r.traceStart[0] - 0.12064034986338212) < 1e-10);
  assert.ok(Math.abs(r.final.ret - (-0.2098049927837492)) < 1e-7);
  assert.ok(Math.abs(r.final.meanRet - (-223.66364130042348)) < 1e-6);
  assert.equal(r.final.n, 20);

  assert.deepEqual(r.replay.start, [Math.PI, 0]);
  assert.equal(r.replay.trace.length, 200);
  assert.ok(span(r.replay.trace) > Math.PI, 'show the swing, not just upright balancing');
  // Every drawn state and the replay score must come from actual physics under
  // the recorded policy commands, rather than manufactured visual motion.
  const world = RLA.worlds.pendulum.make(r.knobs, RLA.rng.make(1));
  world.reset(r.replay.start);
  let ret = 0;
  for (const frame of r.replay.trace) {
    ret += world.step(frame.a).reward;
    assert.deepEqual(world.getState(), frame.s);
  }
  assert.equal(ret, r.replay.ret);
});
