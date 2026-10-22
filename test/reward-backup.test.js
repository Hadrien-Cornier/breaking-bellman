// Snapshot backup on the fixed 16-action path. The picture's numbers come from these functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const B = require(path.join(__dirname, '..', 'web', 'reward-backup.js'));
const G = 0.95;

test('round 0 leaves every estimate at 0', () => {
  const s = B.roundSummary(0);
  assert.deepEqual(s.litOne, []);
  assert.deepEqual(s.litEight, []);
  assert.ok(s.one.every((v) => v === 0));
  assert.ok(s.eight.every((v) => v === 0));
});

test('round 1 lights 1 one-step entry and 8 eight-step entries', () => {
  const s = B.roundSummary(1);
  assert.deepEqual(s.litOne, [15]);
  assert.equal(s.one[15], 1);
  assert.deepEqual(s.litEight, [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(s.eight[15], 1);
  assert.equal(s.eight[14], G);
  assert.equal(s.eight[8], G ** 7);
  assert.equal(s.eight[7], 0);
  assert.equal(s.one[14], 0);
});

test('round 2 carries the eight-step estimate to S0 and does not chain inside the round', () => {
  const s = B.roundSummary(2);
  assert.equal(s.litEight[0], 0);
  assert.equal(s.litEight.length, 16);
  assert.ok(Math.abs(s.eight[0] - G ** 15) < 1e-12);
  assert.equal(s.one[0], 0);
  assert.equal(s.litOne[0], 14);
  assert.equal(s.one[14], G);
  assert.equal(s.one[13], 0);
  assert.equal(s.one[15], 1);
  assert.equal(s.eight[15], 1);
});

test('one-step reaches S0 at round 16 and not at round 15', () => {
  const earlier = B.roundSummary(15);
  const done = B.roundSummary(16);
  assert.equal(earlier.one[0], 0);
  assert.equal(earlier.litOne[0], 1);
  assert.equal(done.litOne[0], 0);
  assert.ok(Math.abs(done.one[0] - G ** 15) < 1e-12);
  assert.equal(done.one[15], 1);
  assert.ok(Math.abs(done.one[0] - B.roundSummary(2).eight[0]) < 1e-12);
});

test('terminal reward and discount stay on the sparse path', () => {
  for (const n of [1, 8]) {
    const q = B.backup(n, 3);
    assert.equal(q[15], 1);
    assert.ok(q.every((v) => v >= 0 && v <= 1));
  }
  assert.equal(B.ALPHA, 1);
  assert.equal(B.LENGTH, 16);
  assert.equal(B.GAMMA, G);
});

test('return targets share the reference and the stated discount powers', () => {
  const off = B.targets();
  assert.equal(off.ideal, G ** 15);
  assert.equal(off.one, off.ideal);
  assert.equal(off.eight, off.ideal);

  const bias = B.targets({ continuationError: B.CONTINUATION_BIAS, shock: 0 });
  assert.equal(bias.one, bias.ideal + (G ** 1) * 0.4);
  assert.equal(bias.eight, bias.ideal + (G ** 8) * 0.4);
  assert.ok(bias.one > bias.eight);

  const shock = B.targets({ continuationError: 0, shock: B.SHOCK });
  assert.equal(shock.one, shock.ideal);
  assert.equal(shock.eight, shock.ideal + (G ** B.SHOCK_EXPONENT) * -2);
  assert.equal(B.SHOCK_EXPONENT, 3);

  const both = B.targets({ continuationError: 0.4, shock: -2 });
  assert.equal(both.one, both.ideal + G * 0.4);
  assert.equal(both.eight, both.ideal + (G ** 8) * 0.4 + (G ** 3) * -2);
});

test('the picture states the snapshot assumptions and the tradeoff', () => {
  const text = B.staticText();
  assert.match(text, /previous round's table/);
  assert.match(text, /Step size 1/);
  assert.match(text, /α = 1/);
  assert.match(text, /sparse/);
  assert.match(text, /online learning, and replay/);
  assert.match(text, /different order/);
  assert.match(text, /not a speed for credit in ordinary training/);
  assert.match(text, /round 1/);
  assert.match(text, /round 2/);
  assert.match(text, /round 16/);
  assert.match(text, /0\.95\^1/);
  assert.match(text, /0\.95\^8/);
  assert.match(text, /0\.95\^3/);
  assert.match(text, /later outcome/);
  assert.match(text, /bootstrapped continuation/);
  assert.match(text, /not a variance measured over many runs/);
  assert.match(text, /bad action erasing a good one/);
  assert.equal(text.includes('\u2014'), false);
  assert.equal(text.includes('\u2013'), false);
});
