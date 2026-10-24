'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/agents/elbo.js');

function ref(model, q) {
  let px = 0;
  for (const z of model.causes) px += model.prior[z] * model.likelihood[z];
  const logPx = Math.log(px);
  const post = {};
  for (const z of model.causes) post[z] = model.prior[z] * model.likelihood[z] / px;
  let recon = 0, klPrior = 0, klPost = 0, klPriorSwap = 0;
  for (const z of model.causes) {
    if (q[z] === 0) continue;
    recon += q[z] * Math.log(model.likelihood[z]);
    klPrior += q[z] * Math.log(q[z] / model.prior[z]);
    klPost += q[z] * Math.log(q[z] / post[z]);
  }
  for (const z of model.causes) {
    if (post[z] === 0) continue;
    if (q[z] === 0) { klPriorSwap = Infinity; break; }
    klPriorSwap += model.prior[z] * Math.log(model.prior[z] / q[z]);
  }
  const elbo = recon - klPrior;
  return { px, logPx, post, recon, klPrior, klPost, klPriorSwap, elbo, gap: logPx - elbo };
}

function close(a, b, tol) {
  assert.ok(Math.abs(a - b) <= (tol || 1e-9), a + ' vs ' + b);
}

test('the lesson table is positive and the narrow guess lowers the bound', () => {
  const m = E.LESSON;
  assert.equal(m.positive, true);
  assert.ok(m.causes.every((z) => m.prior[z] > 0 && m.likelihood[z] > 0));
  assert.ok(E.LIMITS.some((line) => /variational autoencoder/i.test(line)));
  assert.ok(E.LIMITS.some((line) => /reparameterization/i.test(line)));
  const narrow = E.evaluate(m, E.distribution(E.narrowWeights(), m.causes));
  const post = E.evaluate(m, E.posterior(m));
  const flat = E.evaluate(m, E.distribution(E.evenWeights(), m.causes));
  assert.ok(E.isNarrow(narrow.q));
  assert.ok(narrow.reconstruction > post.reconstruction);
  assert.ok(narrow.reconstruction > flat.reconstruction);
  assert.ok(narrow.elbo < post.elbo);
  assert.ok(narrow.elbo < flat.elbo);
  assert.ok(narrow.elbo < narrow.logPx - 0.5);
  close(post.elbo, post.logPx);
  close(post.gap, 0);
  close(post.klPosterior, 0);
  assert.notEqual(narrow.elbo, narrow.logPx);
});

test('an independent bound matches the module, including an altered positive table', () => {
  const alt = E.model({
    name: 'dim',
    causes: E.CAUSES,
    prior: { hall: 0.25, lamp: 0.5, glare: 0.25 },
    likelihood: { hall: 0.5, lamp: 0.25, glare: 0.125 },
  });
  assert.equal(alt.positive, true);
  const tables = [E.LESSON, alt];
  const guesses = [
    (m) => E.distribution(E.narrowWeights(), m.causes),
    (m) => E.distribution(E.evenWeights(), m.causes),
    (m) => E.posterior(m),
    (m) => E.distribution({ hall: 4, lamp: 1, glare: 1 }, m.causes),
  ];
  for (const m of tables) {
    const lessonPost = E.posterior(E.LESSON);
    const here = E.posterior(m);
    assert.ok(Math.abs(here.hall - lessonPost.hall) > 1e-6 || m === E.LESSON);
    for (const make of guesses) {
      const q = make(m);
      const got = E.evaluate(m, q);
      const want = ref(m, q);
      close(got.px, want.px);
      close(got.logPx, want.logPx);
      close(got.reconstruction, want.recon);
      close(got.klPrior, want.klPrior);
      close(got.elbo, want.elbo);
      close(got.klPosterior, want.klPost);
      close(got.gap, want.gap);
      close(got.gap, got.klPosterior);
      assert.equal(got.identity, true);
      for (const z of m.causes) close(got.posterior[z], want.post[z]);
    }
  }
});

test('the two KL directions are different numbers, and only one of them is in the bound', () => {
  const m = E.LESSON;
  const narrow = E.evaluate(m, E.distribution(E.narrowWeights(), m.causes));
  assert.ok(Math.abs(narrow.klPrior - narrow.klPriorReverse) > 0.2);
  assert.ok(Number.isFinite(narrow.klPrior) && Number.isFinite(narrow.klPriorReverse));
  assert.ok(Math.abs(narrow.klPosterior - narrow.klPosteriorReverse) > 0.2);
  close(narrow.elbo, narrow.reconstruction - narrow.klPrior);
  const swapped = narrow.reconstruction - narrow.klPriorReverse;
  assert.ok(Number.isFinite(swapped));
  assert.ok(Math.abs(swapped - narrow.elbo) > 0.2);
  close(narrow.logPx - narrow.elbo, narrow.klPosterior);
  const post = E.evaluate(m, E.posterior(m));
  assert.ok(post.klPrior > 1e-3);
  assert.ok(Math.abs(post.klPrior - post.klPriorReverse) > 1e-3);
  close(post.klPosterior, 0);
  assert.ok(post.klPosteriorReverse < 1e-9);
});

test('a hard zero stays finite in one KL direction and infinite in the other', () => {
  const m = E.LESSON;
  const q = E.distribution(E.hardGlareWeights(), m.causes);
  assert.equal(E.isHardGlare(q), true);
  const got = E.evaluate(m, q);
  const want = ref(m, q);
  close(got.elbo, want.elbo);
  close(got.gap, got.klPosterior);
  assert.equal(got.identity, true);
  assert.ok(Number.isFinite(got.klPrior));
  assert.ok(Number.isFinite(got.klPosterior));
  assert.equal(got.klPosteriorReverse, Infinity);
  assert.equal(got.klPriorReverse, Infinity);
  assert.ok(got.zeroCauses.includes('hall') && got.zeroCauses.includes('lamp'));
  assert.ok(got.notes.some((line) => /0 log 0/.test(line)));
  assert.ok(got.elbo < got.logPx - 0.5);
  const moved = E.step(m, q, 0.5, 'elbo');
  assert.equal(moved.hall, 0);
  assert.equal(moved.lamp, 0);
  assert.equal(moved.glare, 1);
});

test('a prior zero under a positive guess makes KL(q || prior) infinite', () => {
  const m = E.model({
    name: 'missing-glare',
    causes: E.CAUSES,
    prior: { hall: 0.5, lamp: 0.5, glare: 0 },
    likelihood: { hall: 0.25, lamp: 0.5, glare: 1 },
  });
  assert.equal(m.positive, false);
  const q = E.distribution(E.evenWeights(), m.causes);
  const got = E.evaluate(m, q);
  assert.equal(got.klPrior, Infinity);
  assert.equal(got.elbo, -Infinity);
  assert.equal(got.klPosterior, Infinity);
  assert.equal(got.gap, Infinity);
  assert.equal(got.identity, true);
  assert.ok(got.posterior.glare === 0);
  assert.ok(Number.isFinite(got.klPosteriorReverse));
  assert.ok(got.notes.some((line) => /Impossible support/.test(line)));
  const dead = E.model({
    name: 'dark-hall',
    causes: E.CAUSES,
    prior: { hall: 0.5, lamp: 0.25, glare: 0.25 },
    likelihood: { hall: 0, lamp: 0.5, glare: 1 },
  });
  const onHall = E.evaluate(dead, E.distribution({ hall: 1, lamp: 0, glare: 0 }, dead.causes));
  assert.equal(onHall.reconstruction, -Infinity);
  assert.equal(onHall.elbo, -Infinity);
  const offHall = E.evaluate(dead, E.distribution({ hall: 0, lamp: 1, glare: 1 }, dead.causes));
  assert.ok(Number.isFinite(offHall.reconstruction));
  assert.equal(offHall.identity, true);
  close(offHall.gap, offHall.klPosterior);
});

test('the ELBO update improves the bound and reads the table it is given', () => {
  const m = E.LESSON;
  const narrow = E.distribution(E.narrowWeights(), m.causes);
  const even = E.distribution(E.evenWeights(), m.causes);
  const partial = E.optimize(m, narrow, { step: 0.5, rounds: 1, objective: 'elbo' });
  assert.ok(partial.steps[1].elbo > partial.steps[0].elbo);
  assert.ok(partial.steps[1].klPosterior > 1e-3);
  const full = E.optimize(m, narrow, { step: 1, rounds: 1, objective: 'elbo' });
  for (const z of m.causes) close(full.steps[1].q[z], full.steps[1].posterior[z], 1e-12);
  const fromEven = E.step(m, even, 0.5, 'elbo');
  const fromNarrow = E.step(m, narrow, 0.5, 'elbo');
  assert.ok(Math.abs(fromEven.glare - fromNarrow.glare) > 1e-4);
  const alt = E.model({
    name: 'glare-heavier',
    causes: E.CAUSES,
    prior: { hall: 0.25, lamp: 0.25, glare: 0.5 },
    likelihood: m.likelihood,
  });
  const altStep = E.step(alt, narrow, 0.5, 'elbo');
  assert.ok(Math.abs(altStep.glare - fromNarrow.glare) > 1e-4);
  const run = E.optimize(alt, even, E.REPAIR);
  let previous = run.steps[0].elbo;
  for (const row of run.steps) {
    assert.equal(row.identity, true);
    assert.ok(row.elbo <= row.logPx + 1e-9);
    assert.ok(row.elbo + 1e-9 >= previous);
    previous = row.elbo;
  }
  assert.ok(run.steps.at(-1).elbo > run.steps[0].elbo + 1e-3);
  assert.ok(run.steps.at(-1).gap < run.steps[0].gap);
  const landed = E.optimize(alt, even, { step: 1, rounds: 1, objective: 'elbo' });
  const altPost = E.posterior(alt);
  const lessonPost = E.posterior(m);
  let toAlt = 0, toLesson = 0;
  for (const z of m.causes) {
    toAlt += Math.abs(landed.steps[1].q[z] - altPost[z]);
    toLesson += Math.abs(landed.steps[1].q[z] - lessonPost[z]);
  }
  assert.ok(toAlt < 1e-9);
  assert.ok(toLesson > 1e-3);
});

test('reconstruction only prefers the sharp cause and does not tighten the bound', () => {
  const m = E.LESSON;
  const even = E.distribution(E.evenWeights(), m.causes);
  const bad = E.optimize(m, even, E.RECONSTRUCTION_ONLY);
  const good = E.optimize(m, even, E.REPAIR);
  const endBad = bad.steps.at(-1), endGood = good.steps.at(-1), start = bad.steps[0];
  assert.equal(bad.objective, 'reconstruction');
  assert.equal(good.objective, 'elbo');
  assert.ok(endBad.reconstruction > start.reconstruction);
  assert.ok(endBad.q.glare > start.q.glare);
  assert.ok(endBad.q.glare > endGood.q.glare);
  assert.ok(endBad.elbo < endGood.elbo);
  assert.ok(endBad.gap > 0.05);
  assert.ok(endBad.elbo < endBad.logPx - 0.05);
  assert.equal(endBad.identity, true);
  const sharpHall = E.model({
    name: 'hall-sharp',
    causes: E.CAUSES,
    prior: { hall: 0.2, lamp: 0.4, glare: 0.4 },
    likelihood: { hall: 1, lamp: 0.25, glare: 0.125 },
  });
  const moved = E.optimize(sharpHall, E.distribution(E.evenWeights(), sharpHall.causes), E.RECONSTRUCTION_ONLY);
  assert.ok(moved.steps.at(-1).q.hall > moved.steps[0].q.hall);
  assert.ok(moved.steps.at(-1).q.hall > moved.steps.at(-1).q.glare);
  const narrowOnGlare = E.evaluate(sharpHall, E.distribution(E.narrowWeights(), sharpHall.causes));
  const onHall = E.evaluate(sharpHall, E.distribution({ hall: 30, lamp: 1, glare: 1 }, sharpHall.causes));
  assert.ok(onHall.reconstruction > narrowOnGlare.reconstruction);
  assert.ok(narrowOnGlare.elbo < narrowOnGlare.logPx - 0.2);
});
