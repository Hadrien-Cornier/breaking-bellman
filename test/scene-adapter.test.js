'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { createHash } = require('node:crypto');
const { create } = require('../web/scene-adapter.js');
const { RLA, exact, content } = require('../scripts/fast-source.js');
// Record canvas drawing operations, including offscreen layers and gradients. This lets the
// real scene factories run without replacing them with a fake renderer or a second simulator.
function canvas() {
  const calls = [], cv = { calls };
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'getTransform') return () => ({ a: 1 });
      if (key === 'measureText') return s => ({ width: String(s).length * 6 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => {
        const gradient = { args, stops: [] }; gradient.addColorStop = (...s) => gradient.stops.push(s); return gradient;
      };
      return (...args) => calls.push([key, ...args.map(a => a && a.calls ? a.calls : a)]);
    },
    set(_, key, value) { calls.push(['set', key, value]); return true; },
  });
  cv.getContext = () => ctx;
  return cv;
}
function scenes(source = fs.readFileSync(require.resolve('../web/scenes.js'), 'utf8')) {
  let clock = 0;
  const context = vm.createContext({ document: { createElement: canvas }, performance: { now: () => clock } });
  vm.runInContext(source, context);
  const SC = context.BB.scenes;
  if (!SC.atTime) SC.atTime = (t, fn) => { const before = clock; clock = t; try { return fn(); } finally { clock = before; } };
  return SC;
}
function cases() {
  const C = content();
  const run = world => {
    const l = C.levels.find(l => l.world === world);
    return RLA.run({ world, parts: l.start, knobs: l.knobs, steps: 12, seed: 101,
      hyper: { ...C.hyperOf(l.start, world), ...l.hyper, hidden: [4], demoEpisodes: 2, pretrain: 2 } });
  };
  const b = run('bandit'), c = run('cliff'), m = run('mirage'), f = run('fork');
  return {
    casino: { means: b.final.means, q: b.final.q, arms: b.bandit.arm, rewards: b.bandit.reward, n: 10 },
    canyon: { cols: 12, peeks: c.peeks, epLen: c.ep.len, epFalls: c.ep.falls, test: c.trace, cliffPenalty: -100 },
    doors: { left: m.ep.left, ret: m.ep.ret, qA: m.final.qA, mean: -0.1, nB: 10 },
    balance: { trace: run('cartpole').trace, xMax: 2.4, thMax: 12 * Math.PI / 180, pole: 1 },
    lab: { trace: run('goalgrid').trace, N: 5, wall: false },
    joint: { trace: run('pendulum').replay.trace, mass: 1 },
    arm: { trace: run('reach').trace, L1: 0.5, L2: 0.5 },
    table: { paths: f.final.paths, obstacle: 0.25, goal: [0, 0.8], goalR: 0.08, mud: false },
  };
}
function draw(SC, kind, data, time, width, dark) {
  const cv = canvas(), options = { ...data, fonts: { display: 'sans-serif', mono: 'monospace', body: 'sans-serif' }, dark };
  const scene = SC[kind](cv.getContext('2d'), width, 300, options);
  const at = (t, fn) => SC.atTime ? SC.atTime(t, fn) : fn();
  at(0, () => scene.frame(0));
  at(time, () => scene.frame(time));
  return { digest: createHash('sha256').update(JSON.stringify(cv.calls)).digest('hex'), duration: scene.duration };
}

test('actual illustrated scenes draw the same operations for a record/time regardless of prior seeks', () => {
  const SC = scenes();
  for (const [kind, data] of Object.entries(cases())) for (const width of [360, 760]) for (const dark of [false, true]) {
    const record = { world: kind, data }, before = exact.stringify(record), el = {};
    let frame;
    const adapter = create({ world: kind, settings: [], render(element, value, time) {
      assert.equal(element, el);
      const result = draw(SC, kind, value ? value.data : { ...data, trace: null, paths: null, arms: null, rewards: null, peeks: null, test: null, left: null, ret: null }, time || 0, width, dark);
      if (time !== null) frame = result.digest;
      return Math.ceil(result.duration / 40);
    } });
    // Mount draws the task, then real measured data supplies every replay frame.
    // Casino's untrained scene needs the number of machines; its task is still actual world data.
    adapter.mount(el);
    adapter.draw(record, 1200); const wanted = frame;
    adapter.draw(record, 0); const start = frame;
    adapter.draw(record, 3000); adapter.draw(record, 1200);
    assert.equal(frame, wanted, kind + ': seek history cannot affect drawing');
    assert.notEqual(frame, start, kind + ': replay draws a changed frame');
    assert.equal(exact.stringify(record), before, kind + ': drawing never changes measured data');
    assert(adapter.length(record) > 0, kind + ': finite replay duration');
    assert.equal(adapter.length({ world: 'wrong' }), 0);
    assert.throws(() => adapter.draw({ world: 'wrong' }, 0), /different world/);
  }
});
test('draw requires mount and mount paints the task before any run', () => {
  const paints = [], adapter = create({ world: 'cliff', settings: ['width'], render: (...args) => paints.push(args) });
  assert.throws(() => adapter.draw({ world: 'cliff' }, 0), /Mount/);
  const el = {}; adapter.mount(el);
  assert.deepEqual(paints, [[el, null, 0]]);
});
module.exports = { scenes, cases, draw };

test('Watch preserves elapsed replay time across delayed browser frames and pauses offscreen', () => {
  const source = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  const watch = source.slice(source.indexOf('  function watchScene()'), source.indexOf('  const sceneFonts ='));
  const frames = [], record = {}, button = {}; let tick;
  const context = vm.createContext({
    watching: false, sceneTime: 0, stageSeen: true, replayAnimation: null,
    runState: { record }, adapter: { length: () => 100, draw: (r, t) => { assert.equal(r, record); frames.push(t); } },
    window: { matchMedia: () => ({ matches: false }) }, $: () => button,
    requestAnimationFrame: fn => { tick = fn; return 1; }, scenePosition() {},
  });
  vm.runInContext('function pauseScene() { watching = false; }\n' + watch + '\nwatchScene();', context);
  tick(100); tick(140); tick(300);
  assert.deepEqual(frames, [1, 2, 6], 'a delayed callback catches up four measured replay frames');
  context.stageSeen = false; tick(1000);
  context.stageSeen = true; tick(1040);
  assert.equal(frames.at(-1), 7, 'time offscreen does not skip the replay');
  vm.runInContext('watchScene();', context); tick(1080);
  assert.equal(frames.at(-1), 7, 'Pause prevents another draw');
});
