'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../src/agents/prefer.js');

function sigmoid(d) {
  if (d >= 0) return 1 / (1 + Math.exp(-d));
  const e = Math.exp(d);
  return e / (1 + e);
}

function independentLikelihood(gap, wins, losses) {
  return wins * Math.log(sigmoid(gap)) + losses * Math.log(sigmoid(-gap));
}

function independentLikelihoodSlope(gap, wins, losses) {
  return wins - (wins + losses) * sigmoid(gap);
}

function independentTilt(rFour, rTwenty, qFour, qTwenty, beta) {
  if (beta === 0) {
    if (Math.abs(rFour - rTwenty) <= 1e-12) return qFour;
    return rFour > rTwenty ? 1 : 0;
  }
  if (!(qFour > 0)) return 0;
  if (!(qTwenty > 0)) return 1;
  const logOdds = Math.log(qFour / qTwenty) + (rFour - rTwenty) / beta;
  return 1 / (1 + Math.exp(-logOdds));
}

function independentKl(p, q) {
  let sum = 0;
  const both = [[p, q], [1 - p, 1 - q]];
  for (let i = 0; i < both.length; i++) {
    const prob = both[i][0];
    const ref = both[i][1];
    if (prob === 0) continue;
    if (!(ref > 0)) return Infinity;
    sum += prob * Math.log(prob / ref);
  }
  return sum;
}

function independentObjective(p, rFour, rTwenty, qFour, qTwenty, beta) {
  const reward = p * rFour + (1 - p) * rTwenty;
  const kl = independentKl(p, qFour);
  return beta > 0 ? reward - beta * kl : reward;
}

test('Bradley-Terry fit maximizes the preference likelihood and rejects a unanimous set', () => {
  const rows = P.PREFERENCES;
  const counts = { four: 0, twenty: 0 };
  for (const row of rows) counts[row.winner] += 1;
  assert.deepEqual(counts, { four: 3, twenty: 1 });
  assert.equal(P.languageModel, false);
  assert.equal(P.ANSWERS.length, 2);
  assert.deepEqual(P.ANSWERS.map((a) => a.text), ['4', '22']);

  const fit = P.fitScores(rows);
  assert.equal(fit.finite, true);
  assert.equal(fit.scores.twenty, 0);
  assert.ok(Math.abs(fit.gap - Math.log(3)) < 1e-10, fit.gap);
  assert.ok(Math.abs(fit.logLikelihood - independentLikelihood(fit.gap, 3, 1)) < 1e-10);
  assert.ok(Math.abs(independentLikelihoodSlope(fit.gap, 3, 1)) < 1e-8);
  assert.ok(fit.logLikelihood > independentLikelihood(0, 3, 1));
  assert.ok(fit.logLikelihood > independentLikelihood(Math.log(3) + 1, 3, 1));

  const flippedRows = rows.map((row) => ({ winner: row.loser, loser: row.winner }));
  const flipped = P.fitScores(flippedRows);
  assert.ok(Math.abs(flipped.gap - Math.log(1 / 3)) < 1e-10);

  const unanimous = P.fitScores([
    { winner: 'four', loser: 'twenty' },
    { winner: 'four', loser: 'twenty' },
  ]);
  assert.equal(unanimous.finite, false);
  assert.equal(unanimous.scores, null);
  assert.equal(unanimous.logLikelihood, Infinity);
});

test('beta 0 is the higher-score vertex, and a tie keeps the reference', () => {
  const fit = P.fitScores(P.PREFERENCES);
  const forward = P.optimizePolicy(fit.scores, P.REFERENCE, 0);
  assert.equal(forward.pi.four, 1);
  assert.equal(forward.pi.twenty, 0);
  assert.equal(forward.klInObjective, false);
  assert.ok(Math.abs(forward.kl - Math.log(2)) < 1e-12);
  assert.equal(forward.objective, forward.expectedReward);
  const neighbor = independentObjective(0.9, fit.scores.four, fit.scores.twenty, 0.5, 0.5, 0);
  assert.ok(forward.objective > neighbor);

  const reversed = P.optimizePolicy({ four: fit.scores.twenty, twenty: fit.scores.four }, P.REFERENCE, 0);
  assert.equal(reversed.pi.four, 0);
  assert.equal(reversed.pi.twenty, 1);

  const skewed = { four: 0.2, twenty: 0.8 };
  const tie = P.optimizePolicy({ four: 1, twenty: 1 }, skewed, 0);
  assert.equal(tie.pi.four, 0.2);
  assert.equal(tie.pi.twenty, 0.8);
});

test('a positive beta matches an independent tilted reference and is not the preference rate', () => {
  const fit = P.fitScores(P.PREFERENCES);
  const beta = Math.log(3);
  const policy = P.optimizePolicy(fit.scores, P.REFERENCE, beta);
  const closed = independentTilt(fit.scores.four, fit.scores.twenty, 0.5, 0.5, beta);
  const exact = Math.E / (Math.E + 1);
  assert.ok(Math.abs(policy.pi.four - closed) < 1e-9, policy.pi.four);
  assert.ok(Math.abs(closed - exact) < 1e-12);
  assert.ok(Math.abs(policy.pi.four + policy.pi.twenty - 1) < 1e-12);
  assert.ok(Math.abs(policy.objective - independentObjective(policy.pi.four, fit.scores.four, 0, 0.5, 0.5, beta)) < 1e-9);
  assert.ok(Math.abs(policy.objective - (policy.expectedReward - beta * policy.kl)) < 1e-12);
  for (const p of [0.5, 0.75, 0.9, 0.99]) {
    assert.ok(policy.objective > independentObjective(p, fit.scores.four, 0, 0.5, 0.5, beta) + 1e-6);
  }
  const rate = 0.75;
  assert.ok(Math.abs(policy.pi.four - rate) > 0.01);
  const zero = P.optimizePolicy(fit.scores, P.REFERENCE, 0);
  assert.ok(Math.abs(policy.pi.four - 0.5) < Math.abs(zero.pi.four - 0.5));
});

test('the same preferences and reference trade reward scale against beta, and support is a hard constraint', () => {
  const fit = P.fitScores(P.PREFERENCES);
  const beta = Math.log(3);
  const mild = P.optimizePolicy(fit.scores, P.REFERENCE, beta);
  const hot = P.optimizePolicy(P.scaleScores(fit.scores, 8), P.REFERENCE, beta);
  const divided = P.optimizePolicy(fit.scores, P.REFERENCE, beta / 8);
  assert.ok(hot.pi.four > 0.999);
  assert.ok(hot.beta > 0);
  assert.ok(hot.pi.four > mild.pi.four);
  assert.ok(Math.abs(hot.pi.four - divided.pi.four) < 1e-8);

  const skewed = { four: 0.25, twenty: 0.75 };
  const shifted = P.optimizePolicy(fit.scores, skewed, beta);
  const expectSkew = independentTilt(fit.scores.four, 0, 0.25, 0.75, beta);
  assert.ok(Math.abs(shifted.pi.four - expectSkew) < 1e-9);
  assert.ok(Math.abs(shifted.pi.four - mild.pi.four) > 0.05);

  const hole = P.optimizePolicy(fit.scores, P.HOLE, beta);
  assert.equal(hole.pi.four, 0);
  assert.equal(hole.pi.twenty, 1);
  assert.ok(hole.kl === 0);
  const holeZero = P.optimizePolicy(fit.scores, P.HOLE, 0);
  assert.equal(holeZero.pi.four, 1);
  assert.equal(holeZero.kl, Infinity);
  assert.equal(holeZero.klInObjective, false);
  assert.equal(holeZero.objective, holeZero.expectedReward);

  const tiny = P.optimizePolicy(fit.scores, P.REFERENCE, 1e-6);
  assert.ok(tiny.beta > 0);
  assert.ok(tiny.pi.four > 1 - 1e-9);
});

test('the lesson is its own level after Pass or fail and the slide quote is the evidence slice', () => {
  const root = path.join(__dirname, '..');
  const ctx = vm.createContext({ window: {}, console, globalThis: null });
  ctx.globalThis = ctx;
  ctx.window.window = ctx.window;
  const files = ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/papers.js', 'web/fetch-level.js', 'web/algos.js', 'src/agents/prefer.js', 'web/prefer-level.js', 'web/recap.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  const C = ctx.window.CONTENT;
  const prefer = C.levels.find((level) => level.id === 'prefer');
  const passfail = C.levels.findIndex((level) => level.id === 'passfail');
  assert.ok(prefer && prefer.custom === true);
  assert.equal(C.levels[passfail + 1].id, 'prefer');
  assert.equal(C.levels[passfail + 2].id, 'continuous');
  assert.equal(prefer.world, 'prefer');
  assert.equal(C.worldNames.prefer, 'Two replies');
  assert.ok(!C.levels.some((level) => level.id === 'passfail' && level.world === 'prefer'));
  const note = ctx.RECAP.note('btref', C, ctx.ALGO_HELP);
  assert.equal(note.quote, 'better trajectories are exponentially more likely to be chosen based on their reward');
  assert.match(note.cite, /Bradley-Terry model/);
  assert.equal(note.practice.includes('\u2014'), false);
  assert.equal(note.quote.includes('\u2014'), false);
  assert.ok(note.practice.length > 40);

  function el(tag, attrs, kids) {
    const node = { tag: tag, attrs: attrs || {}, kids: [], text: (attrs && attrs.text) || '', id: attrs && attrs.id, isConnected: true };
    node.append = function () { for (const child of arguments) if (child) node.kids.push(child); };
    node.replaceChildren = function () { node.kids = Array.from(arguments).filter(Boolean); };
    node.addEventListener = function () {};
    for (const child of [].concat(kids || [])) if (child) node.kids.push(child);
    return node;
  }
  const pane = el('div');
  const lab = el('div');
  ctx.window.BBPREFER.mount(pane, lab, { h: el, done: function () { return false; } });
  const flat = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    flat.push(node);
    for (const child of node.kids || []) walk(child);
  })(lab);
  const rules = flat.find((node) => node.id === 'prefer-rules');
  assert.ok(rules, 'mount creates #prefer-rules');
  assert.ok(JSON.stringify(rules).includes(prefer.goal.text));
});
