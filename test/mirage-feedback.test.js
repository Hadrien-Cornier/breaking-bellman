// Regression checks for the 6 findings in the level 6 ("The mirage") investigation report
// (data/bb-mirage/report.md, "Findings (feedback on the page, with file:line)").
const test = require('node:test');
const assert = require('node:assert');
for (const f of ['src/core/rng.js', 'src/core/nn.js', 'src/worlds/mirage.js', 'src/agents/value.js', 'src/sim/run.js', 'src/sim/autopsy.js']) require('../' + f);
const RLA = globalThis.RLA;

const WORDS = { store: 'table', eps: true, ucb: false, optimistic: false, data: 'latest', memory: 10000, step: 'const', nstep: 1, agg: 'max', picker: 'live', scorer: 'live', sync: 250 };
const hyper = { epsStart: 0.1, epsEnd: 0.1, lrTable: 0.1 };

// a finished mirage run, for autopsy tests that need no simulation
function mirageResult(o) {
  const left = o.left;
  return {
    world: 'mirage',
    parts: Object.assign({}, WORDS, o.parts || {}),
    knobs: Object.assign({ mean: -0.1, maxSteps: 2, machines: 10, noise: 1 }, o.knobs || {}),
    ep: { left: left.slice() },
    final: { qA: [-0.1, o.qLeft == null ? -0.1 : o.qLeft] },
    diag: o.diag || [{ t: 15, loss: 0.1, eps: 0.1 }],
    seed: o.seed || 1,
    steps: 600,
  };
}
// a run of n episodes whose left-door rate is `rate` in every episode (deterministic)
const flat = (n, rate, seed) => {
  const rng = RLA.rng.make(seed || 7);
  const out = []; for (let i = 0; i < n; i++) out.push(rng.next() < rate ? 1 : 0); return out;
};
const symptom = (a) => a.symptoms.find((s) => s.id === 'mirage');

// ---------------------------------------------------------------- finding 1
test('finding 1: a target with no max is not labelled "Chases the mirage"', () => {
  // 4 real rewards on a 2-step world: every row is a full return, so there is no guess and no max
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5), parts: { nstep: 4, agg: 'min', picker: 'second', scorer: 'second' } })]);
  const s = symptom(a);
  assert.notEqual(s.label, 'Chases the mirage', s.evidence);
  assert.notEqual(s.label, 'Tempted by the mirage', s.evidence);
});

test('finding 1: a guess that is not a max is not labelled "Chases the mirage"', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5), parts: { nstep: 1, agg: 'min' } })]);
  assert.notEqual(symptom(a).label, 'Chases the mirage');
});

test('finding 1: a max in the target keeps the mirage label', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.65), parts: { nstep: 1, agg: 'max' } })]);
  assert.equal(symptom(a).label, 'Chases the mirage');
});

test('finding 1: the evidence names the real cause when there is no guess', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5), parts: { nstep: 4, agg: 'min' } })]);
  assert.match(symptom(a).evidence, /no guess|not maximization bias/i);
});

// ---------------------------------------------------------------- finding 2
test('finding 2: "at the end" is each run\'s own last 20%, not the shortest run\'s window', () => {
  // seed A: 100 episodes, left for 80 then right for 20. seed B: 50 episodes, left for 40 then right for 10.
  // the old shared window [40, 50) reads A as 1.0 and B as 0.0 -> 50%. The true end of both is 0%.
  const A = mirageResult({ left: [].concat(new Array(80).fill(1), new Array(20).fill(0)) });
  const B = mirageResult({ left: [].concat(new Array(40).fill(1), new Array(10).fill(0)) });
  const a = RLA.autopsy([A, B]);
  assert.ok(Math.abs(a.summary.leftLate - 0) < 1e-9, 'leftLate = ' + a.summary.leftLate);
});

test('finding 2: the late window still reads a run that ends on the left door', () => {
  const A = mirageResult({ left: new Array(100).fill(1) });
  const B = mirageResult({ left: new Array(50).fill(1) });
  assert.ok(Math.abs(RLA.autopsy([A, B]).summary.leftLate - 1) < 1e-9);
});

// ---------------------------------------------------------------- finding 3
test('finding 3: no exploration claim when the sentence never acts at random', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5), parts: { eps: false }, diag: [{ t: 15, loss: 0.1, eps: 0 }] })]);
  assert.doesNotMatch(symptom(a).evidence, /exploration/i);
});

test('finding 3: the exploration share comes from the sentence when it acts at random', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5), parts: { eps: true }, diag: [{ t: 15, loss: 0.1, eps: 0.1 }] })]);
  // epsilon 0.1 over 2 doors in state A: about 5% of episodes take the left door only on a random try
  assert.match(symptom(a).evidence, /about 5% is only exploration/);
});

// ---------------------------------------------------------------- finding 4
test('finding 4: a flat 50% reads as 50%, not as the max of three noisy windows', () => {
  const rs = [];
  for (let i = 0; i < 300; i++) rs.push(mirageResult({ left: flat(400, 0.5, 1000 + i), seed: i + 1 }));
  const peak = RLA.autopsy(rs).summary.leftPeak;
  assert.ok(peak > 0.45 && peak < 0.55, 'leftPeak on a flat coin flip = ' + peak);
});

test('finding 4: the evidence says the worst point is the worst of three windows, and gives the mean too', () => {
  const a = RLA.autopsy([mirageResult({ left: flat(200, 0.5) })]);
  assert.match(symptom(a).evidence, /worst of three windows/i);
  assert.match(symptom(a).evidence, /mean/i);
  assert.ok(isFinite(a.summary.leftPeakMean), 'summary.leftPeakMean is filled in');
});

// ---------------------------------------------------------------- finding 5
test('finding 5: nstep at least the episode length kills the guess, and the learner says so', () => {
  const knobs = RLA.knobDefaults('mirage');
  const world = RLA.worlds.mirage.make(knobs, RLA.rng.make(1));
  const L = RLA.value.make({ nstep: 4, agg: 'min', picker: 'second', scorer: 'second' }, world, RLA.rng.make(2), {});
  assert.ok(L.notes.some((n) => /no guess/i.test(n)), JSON.stringify(L.notes));
  const L2 = RLA.value.make({ nstep: 1, agg: 'min', picker: 'second', scorer: 'second' }, world, RLA.rng.make(2), {});
  assert.ok(!L2.notes.some((n) => /no guess/i.test(n)), 'nstep 1 still has a guess');
});

test('finding 5: with no guess the next-action words really are idle (no twin, no frozen copy)', () => {
  // nstep 4 on a 2-step world: every row ends the episode, so a twin or a frozen copy would never
  // score anything. The sentence must behave exactly like one without those words.
  const quiet = Object.assign({}, WORDS, { nstep: 4, agg: 'min', picker: 'live', scorer: 'live', sync: 250 });
  const loud = Object.assign({}, WORDS, { nstep: 4, agg: 'min', picker: 'second', scorer: 'frozen', sync: 50 });
  const r1 = RLA.run({ world: 'mirage', parts: quiet, hyper, steps: 300, seed: 11 });
  const r2 = RLA.run({ world: 'mirage', parts: loud, hyper, steps: 300, seed: 11 });
  assert.deepEqual(Array.from(r1.final.qA), Array.from(r2.final.qA), 'the estimates must match');
  assert.deepEqual(r1.ep.left, r2.ep.left, 'the episode choices must match');
});

// ---------------------------------------------------------------- finding 6
test('finding 6: replay on the mirage starts learning inside the goal window', () => {
  const parts = Object.assign({}, WORDS, { scorer: 'second', data: 'replay', memory: 1000 });
  const r = RLA.run({ world: 'mirage', parts, hyper, steps: 600, seed: 101 });
  const nE = r.ep.left.length;
  const winEnd = r.ep.t[Math.max(0, Math.floor(nE * 0.4) - 1)]; // end of the 30-40% window
  const first = r.diag.find((d) => d.loss > 0);
  assert.ok(first, 'some update happened');
  assert.ok(first.t < winEnd, 'learning starts at step ' + first.t + ', the goal window ends at step ' + winEnd);
});

test('finding 6: a sentence with memory can pass the level goal', () => {
  // a no-guess sentence that learns from memory: full returns of the left door, averaged
  const parts = Object.assign({}, WORDS, { nstep: 4, agg: 'min', step: 'avg', data: 'replay', memory: 1000 });
  const rs = [];
  for (let i = 0; i < 100; i++) rs.push(RLA.run({ world: 'mirage', parts, hyper, steps: 600, seed: 101 * (i + 1) }));
  const a = RLA.autopsy(rs);
  assert.ok(a.summary.leftPeak < 0.25, 'leftPeak = ' + a.summary.leftPeak);
});

// ---------------------------------------------------------------- the pass and fail the level needs
test('level 6 keeps its lesson: Double Q passes, the frozen-copy trap fails', () => {
  const doubleq = Object.assign({}, WORDS, { scorer: 'second' });
  const frozen = Object.assign({}, WORDS, { scorer: 'frozen' });
  const rs1 = [], rs2 = [];
  for (let i = 0; i < 100; i++) { const s = 101 * (i + 1); rs1.push(RLA.run({ world: 'mirage', parts: doubleq, hyper, steps: 600, seed: s })); rs2.push(RLA.run({ world: 'mirage', parts: frozen, hyper, steps: 600, seed: s })); }
  const a1 = RLA.autopsy(rs1), a2 = RLA.autopsy(rs2);
  assert.ok(a1.summary.leftPeak < 0.25, 'Double Q must pass, leftPeak = ' + a1.summary.leftPeak);
  assert.ok(a2.summary.leftPeak >= 0.25, 'the frozen-copy trap must fail, leftPeak = ' + a2.summary.leftPeak);
});
