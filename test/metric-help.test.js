// Numerical scale anchors for the shared metric help (web/help.js). The captain asked for a feel
// for what these units mean, so the anchors must land on the agreed reference points: KL 0.01 is a
// 50/50 choice becoming 57/43, entropy 0.693 nats is 50/50 over 2 actions, and so on. These are
// pure number checks with no DOM: the anchor math must be right before it is shown to a player.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const HELP = require(path.join(__dirname, '..', 'web', 'help.js'));
const A = HELP.anchors;

// ---- KL: the move of a 50/50 two-action choice that gives this KL(old || new) -----------------
test('KL anchors match the agreed reference splits', () => {
  assert.equal(A.klRatioText(0), '50/50');        // no change
  assert.equal(A.klRatioText(0.01), '57/43');     // PPO-sized step
  assert.equal(A.klRatioText(0.02), '60/40');
  assert.equal(A.klRatioText(0.5), '90/10');
  assert.equal(A.klRatioText(1.5), '99/1');       // the cited "Mean KL 1.50" card
  assert.equal(A.klRatioText(6.2), '99.9999/0.0001'); // the cited "Mean KL 6.234" card
});

test('KL move q is the top share of the new 50/50-turned choice', () => {
  assert.ok(Math.abs(A.klMove(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(A.klMove(0.01) - 0.5704) < 1e-3);
  assert.ok(Math.abs(A.klMove(0.5) - 0.8975) < 1e-3);
  assert.ok(Math.abs(A.klMove(1.5) - 0.9874) < 1e-3);
  // q is always in [0.5, 1) and increases with KL
  for (const k of [0, 0.001, 0.01, 0.1, 1, 10]) {
    const q = A.klMove(k);
    assert.ok(q >= 0.5 && q < 1, 'q in range for k=' + k);
  }
  assert.ok(A.klMove(0.2) > A.klMove(0.1), 'bigger KL is a bigger move');
});

test('KL handles the noisy estimator: 0 and negative read as no move', () => {
  assert.equal(A.klRatioText(-0.01), '50/50');
  assert.ok(Math.abs(A.klMove(-5) - 0.5) < 1e-9);
  assert.equal(HELP.explain('kl', -0.01, {}).anchor.includes('no measured move'), true);
});

// The KL direction the game uses is old -> new (mean of log p_old - log p_new). The anchor models a
// 50/50 old choice becoming q, i.e. KL(Bern(0.5) || Bern(q)). Check that against the closed form.
test('KL anchor is consistent with KL(Bern(0.5) || Bern(q))', () => {
  for (const q of [0.55, 0.6, 0.8, 0.95, 0.99]) {
    const kl = 0.5 * Math.log(0.25 / (q * (1 - q)));
    assert.ok(Math.abs(A.klMove(kl) - q) < 1e-6, 'roundtrip q=' + q);
  }
});

// ---- Entropy (discrete): top-action share, real action count ---------------------------------
test('entropy max is ln(actions) and 2 actions gives ln 2 = 0.693', () => {
  assert.ok(Math.abs(A.entropyMax(2) - Math.log(2)) < 1e-12);
  assert.ok(Math.abs(A.entropyMax(2) - 0.693) < 0.001);
  assert.ok(Math.abs(A.entropyMax(4) - Math.log(4)) < 1e-12);
  assert.ok(Math.abs(A.entropyMax(10) - Math.log(10)) < 1e-12);
});

test('entropy top-action share matches the agreed anchors for 2 actions', () => {
  // max entropy (ln 2) is an even 50/50
  assert.ok(Math.abs(A.entropyTopShare(Math.log(2), 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(A.entropyTopShare(0.693, 2) - 0.5) < 0.01); // a value that displays as 0.693
  // 0.031 nats is about 99.5% on one action (the cited "Mean entropy 0.031" card)
  assert.ok(Math.abs(A.entropyTopShare(0.031, 2) - 0.995) < 0.005);
  // zero entropy is all one action
  assert.equal(A.entropyTopShare(0, 2), 1);
});

test('entropy top-action share respects the real action count', () => {
  // at max entropy every action is even: top share is 1/A
  assert.ok(Math.abs(A.entropyTopShare(Math.log(4), 4) - 0.25) < 1e-6);
  assert.ok(Math.abs(A.entropyTopShare(Math.log(10), 10) - 0.1) < 1e-6);
  // below max the top share climbs; for the same entropy more actions means a higher top share
  assert.ok(A.entropyTopShare(0.031, 4) >= A.entropyTopShare(0.031, 2) - 1e-9);
  // monotone: lower entropy is a higher top share
  assert.ok(A.entropyTopShare(0.05, 2) < A.entropyTopShare(0.02, 2));
});

test('entropy boundaries: at or above max reads even, at or below 0 reads single action', () => {
  assert.equal(A.entropyTopShare(Math.log(2) + 0.5, 2), 0.5);   // clamped at max
  assert.equal(A.entropyTopShare(-1, 2), 1);                    // clamped at 0
  assert.equal(A.entropyTopShare(NaN, 2), 0.5);                 // unknown falls back to even
});

// ---- Entropy (continuous Gaussian): differential entropy, no fixed top ------------------------
test('Gaussian differential entropy inverts to the standard deviation', () => {
  // H = ln(s) + 1.4189385332 per dimension. The game sums over the action dimensions.
  const s = 0.5;
  const H = A.gaussEntropyFromStd(s, 1);
  assert.ok(Math.abs(A.gaussStdFromEntropy(H, 1) - s) < 1e-9);
  // for D equal dimensions the sum still recovers the per-dimension std
  assert.ok(Math.abs(A.gaussStdFromEntropy(A.gaussEntropyFromStd(s, 3), 3) - s) < 1e-9);
});

test('continuous entropy can be negative and has no fixed top', () => {
  // a tight bell (std < exp(-1.4189) = 0.242) has negative differential entropy
  assert.ok(A.gaussEntropyFromStd(0.1, 1) < 0);
  assert.ok(isFinite(A.gaussStdFromEntropy(-1, 1))); // still a valid, small std
});

// ---- copy: plain words, no em dashes, uses the displayed value --------------------------------
test('every metric explains itself and never uses an em dash', () => {
  const ids = Object.keys(HELP.METRICS);
  assert.ok(ids.length >= 10, 'covers the metric families');
  for (const id of ids) {
    const e = HELP.explain(id, 1, { actions: 2, dims: 1 });
    assert.ok(e && e.label && e.what, id + ' has a label and explanation');
    for (const field of [e.label, e.what, e.goodBad, e.anchor]) {
      if (field) assert.ok(!/[\u2014\u2013]/.test(field), id + ' copy avoids em/en dashes: ' + field);
    }
  }
});

test('KL and entropy anchors quote the exact displayed value', () => {
  const kl = HELP.explain('kl', 1.5, { displayValue: '1.50' });
  assert.ok(kl.anchor.startsWith('KL 1.50'), kl.anchor);
  assert.ok(kl.anchor.includes('99/1'), kl.anchor);
  const ent = HELP.explain('entropy', 0.031, { actions: 2, displayValue: '0.031' });
  assert.ok(ent.anchor.startsWith('Entropy 0.031'), ent.anchor);
  assert.ok(ent.anchor.includes('99.5%'), ent.anchor);
});

test('discrete and continuous entropy use separate scales', () => {
  const disc = HELP.explain('entropy', 0.031, { actions: 4 });
  assert.ok(disc.what.includes('4 actions'), disc.what);
  assert.ok(disc.anchor.includes('even split'), disc.anchor);
  const cont = HELP.explain('entropy', 0.031, { continuous: true, dims: 2 });
  assert.ok(cont.what.includes('differential entropy') || cont.what.includes('bell'), cont.what);
  assert.ok(cont.anchor.includes('standard deviation'), cont.anchor);
  assert.notEqual(disc.anchor, cont.anchor);
});

// ---- the 2026-10-17 additions: new surfaces and phrase shapes found in the wiring pass -------
const has = (id, text) => {
  for (const re of HELP.METRICS[id].patterns || []) { const m = re.exec(text); if (m) return m[1]; }
  return null;
};
test('the new phrase shapes match: score spread, success shares, replay Q lines', () => {
  assert.equal(has('score', 'Final score 12.3 plus or minus 4.5 across 3 seeds.'), '12.3');
  assert.equal(has('seedspread', 'Final score 12.3 plus or minus 4.5 across 3 seeds.'), '4.5');
  assert.equal(has('successrate', 'Reached the goal in 87% of 20 test starts; 0.4 obstacle hits per test.'), '87');
  assert.equal(has('crashrate', 'Reached the goal in 87% of 20 test starts; 0.4 obstacle hits per test.'), '0.4');
  assert.equal(has('successrate', 'Reached the goal in 62% of 30 new prompts (start and goal).'), '62');
  assert.equal(has('successrate', 'Got the stick in 83% of 20 test throws; each throw paid 1.2 reward on average.'), '83');
  assert.equal(has('kl', 'Mean change of the log-probability of the actions tried (an estimate of the KL divergence): 1.50.'), '1.50');
  assert.equal(has('qvalue', 'Before: Q(s, left) = 0.31. Error: y − Q = 0.12.'), '0.31');
  assert.equal(has('qvalue', 'Value of the state V(s) = 0.44; advantage of the row\'s action A = 0.21.'), '0.44');
  assert.equal(has('qvalue', 'The critic now rates the row\'s action at 3.21 and the policy\'s own command at 4.55.'), '3.21');
  assert.equal(has('clipfrac', 'That is a large step: PPO-sized steps are about 0.01 to 0.02. Share of steps clipped: 0.30.'), '0.30');
  assert.equal(has('probability', 'At the first state, the probability of each action: left 0.55 → 0.60.'), '0.55');
});

test('the grid result-metric entry explains the table header it sits on', () => {
  const g = HELP.explain('gridmetric', undefined, { label: '% of tests solved', up: true, pct: true, actions: 2 });
  assert.ok(g.what.includes('% of tests solved'), g.what);
  assert.ok(g.what.includes('standard error'), 'the what mentions the ± standard error');
  assert.ok(g.goodBad.includes('higher reads better'), g.goodBad);
  const mirage = HELP.explain('gridmetric', undefined, { label: '% left door at the worst point (lower is better)', up: false, pct: true });
  assert.ok(mirage.goodBad.includes('lower reads better'), mirage.goodBad);
  assert.equal(g.anchor, null); // no single value: the header explains the measure, not one number
  for (const field of [g.label, g.what, g.goodBad]) {
    assert.ok(!/[\u2014\u2013]/.test(field), 'gridmetric copy avoids em/en dashes');
  }
});

test('KL 1.50, the cited static card value, anchors on the agreed 99/1 split', () => {
  const e = HELP.explain('kl', 1.5, { actions: 2 });
  assert.ok(/KL 1\.5 is like a 50\/50 choice becoming 99\/1/.test(e.anchor), e.anchor);
  // 6.234 (the cited live card) lands past 99.99 on the top action, as the request describes
  const e6 = HELP.explain('kl', 6.234, {});
  assert.ok(/99\.9{4,}\d*\/0\.0{3,}\d/.test(e6.anchor), e6.anchor);
});
