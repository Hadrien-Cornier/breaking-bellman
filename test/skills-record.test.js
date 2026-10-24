const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/agents/skills.js');
const R = require('../web/skills-record.js');
const { create: adapter } = require('../web/scene-adapter.js');

test('sample events retain each actual trial, cumulative counts and terminal state', () => {
  for (const bias of [0, 0.25, 0.5]) for (const budgetPerSkill of [8, 16]) {
    const sample = S.sampleCounts({ bias, budgetPerSkill, seed: S.LESSON.seed });
    const counts = S.emptyCounts();
    assert.equal(sample.events.length, budgetPerSkill * 2);
    sample.events.forEach((event, i) => {
      assert.equal(event.t, i + 1);
      assert.equal(event.trial, i % budgetPerSkill + 1);
      assert.equal(event.skill, i < budgetPerSkill ? 'red' : 'blue');
      assert.equal(event.from, 'start');
      assert.equal(event.action, event.room);
      assert.equal(event.terminal, 'room reached');
      counts[event.skill][event.room]++;
      assert.deepEqual(event.counts, counts);
    });
    assert.deepEqual(counts, sample.counts);
  }
});

test('every policy event and metric equals an engine run on the same measured batch', () => {
  for (const alpha of [0, 1, 8]) for (const updates of [1, 4, 8]) {
    const r = R.create({ alpha, updates });
    assert.deepEqual(r.data, { prior: { steps: 0, attempts: 0 }, fresh: { steps: 16, attempts: 16 } });
    for (const method of R.methods) {
      const expected = S.train({ counts: r.sample.counts, mode: method.mode, alpha, prior: 0.5, eta: 1, updates, tieBreak: method.tieBreak });
      assert.deepEqual(r.metrics[method.name], expected);
      assert.equal(r.events[method.name].length, 16 + updates * 2);
      assert.deepEqual(r.events[method.name].slice(0, 16), r.sample.events);
      r.events[method.name].slice(16).forEach((e, i) => {
        const { kind, t, ...trace } = e;
        assert.equal(kind, 'policy-update'); assert.equal(t, 17 + i);
        assert.deepEqual(trace, expected.trace[i]);
      });
      assert.equal(r.terminal[method.name], 'update budget complete');
      assert.equal(r.series[method.name].length, 16);
    }
  }
});

test('replay never converts a gradient update to room movement and drawing is pure', () => {
  const r = R.create(), before = JSON.stringify(r);
  let frame;
  const a = adapter({ world: 'skills', settings: ['bias'], render: (_el, record, t) => {
    if (t === null) return record.events.discriminator.length + 1;
    frame = record ? R.frame(record, t) : null;
  } });
  a.mount({}); assert.equal(frame, null); assert.equal(a.length(r), 25);
  for (let t = 1; t < a.length(r); t++) {
    a.draw(r, t);
    if (t <= 16) {
      assert.equal(frame.room, r.sample.events[t - 1].room);
      assert.equal(frame.skill, r.sample.events[t - 1].skill);
    } else {
      assert.equal(frame.room, 'start'); assert.equal(frame.skill, null);
      assert.equal(frame.event.kind, 'policy-update');
    }
    const saved = JSON.stringify(frame); a.draw(r, 0); a.draw(r, t); assert.equal(JSON.stringify(frame), saved);
  }
  assert.deepEqual(frame.policies.red, r.metrics.discriminator.policies.red.pi);
  assert.deepEqual(frame.policies.blue, r.metrics.discriminator.policies.blue.pi);
  assert.equal(JSON.stringify(r), before);
});

test('settings change measured identity and outcome without invalidating shared Fast inputs', () => {
  const fs = require('node:fs'), fast = require('../scripts/fast-source.js');
  assert.ok(!fast.engineFiles.includes('src/agents/skills.js'));
  assert.ok(!Object.keys(fast.source().files).some(f => f.includes('skills')));
  const r = R.create(), changed = R.create({ bias: 0.5 });
  assert.notEqual(r.id, changed.id);
  assert.notDeepEqual(r.sample.counts, changed.sample.counts);
  assert.equal(R.create().id, r.id);
  assert.ok(fs.readFileSync('build.mjs', 'utf8').includes("'src/agents/skills.js'"));
});

test('unsupported sampled rewards report skipped updates and no invented progress', () => {
  const r = R.create({ alpha: 0, bias: 0.5 });
  assert.equal(r.terminal.discriminator, 'unsupported reward; affected updates skipped');
  const updates = r.events.discriminator.filter(e => e.kind === 'policy-update');
  assert.ok(updates.every(e => e.reason === 'non-finite reward'));
  for (const e of updates) assert.deepEqual(e.piBefore, e.piAfter);
  assert.equal(r.data.fresh.steps, 16);
});
