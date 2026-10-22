'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/agents/heads.js');

function near(actual, expected, label) {
  assert.equal(typeof actual, 'number', label || 'number');
  assert.ok(Math.abs(actual - expected) <= 1e-9, (label || 'value') + ' ' + actual + ' vs ' + expected);
}

function ownJerk(chunk) {
  const terms = [];
  for (let h = 0; h <= chunk.length - 4; h++) {
    const dx = chunk[h + 3][0] - 3 * chunk[h + 2][0] + 3 * chunk[h + 1][0] - chunk[h][0];
    const dy = chunk[h + 3][1] - 3 * chunk[h + 2][1] + 3 * chunk[h + 1][1] - chunk[h][1];
    terms.push(Math.sqrt(dx * dx + dy * dy));
  }
  return terms.reduce((sum, term) => sum + term, 0) / terms.length;
}

function ownMean(demos) {
  return demos[0].map((_, t) => [
    demos.reduce((sum, demo) => sum + demo[t][0], 0) / demos.length,
    demos.reduce((sum, demo) => sum + demo[t][1], 0) / demos.length,
  ]);
}

function ownProductInvalid(demos, t) {
  const count = (dim) => {
    const map = new Map();
    for (const demo of demos) map.set(demo[t][dim], (map.get(demo[t][dim]) || 0) + 1);
    return [...map.entries()].map(([value, n]) => [value, n / demos.length]);
  };
  const seen = new Set(demos.map((demo) => demo[t][0] + ',' + demo[t][1]));
  let invalid = 0;
  for (const [x, px] of count(0)) {
    for (const [y, py] of count(1)) if (!seen.has(x + ',' + y)) invalid += px * py;
  }
  return invalid;
}

test('shared corners: the average jerk is below both demonstrations and is not 7 percent', () => {
  const score = H.score(H.CORNERS);
  const mean = ownMean(H.CORNERS);
  assert.deepEqual(score.mean, mean);
  assert.equal(score.demonstrations, 2);
  assert.equal(score.commands, 6);
  assert.equal(score.passes, 1);
  assert.equal(score.bins, 8);
  assert.equal(score.paperBins, 512);
  near(score.expertJerks[0], ownJerk(H.CORNERS[0]), 'jerk A');
  near(score.expertJerks[1], ownJerk(H.CORNERS[1]), 'jerk B');
  near(score.meanJerk, ownJerk(mean), 'jerk mean');
  assert.ok(score.expertJerks[0] > score.expertJerks[1]);
  assert.ok(score.meanJerk < score.expertJerks[1]);
  assert.equal(score.meanBelowAll, true);
  near(score.ratios[0], score.meanJerk / score.expertJerks[0], 'ratio A');
  near(score.ratios[1], score.meanJerk / score.expertJerks[1], 'ratio B');
  assert.ok(Math.abs(score.ratios[0] - 0.07) > 0.2);
  assert.ok(Math.abs(score.ratios[1] - 0.07) > 0.2);
  assert.equal(score.binMse, 0);
  assert.ok(score.regressionMse > 0);
  assert.notDeepEqual(score.mean, H.CORNERS[0]);
  assert.notDeepEqual(score.mean, H.CORNERS[1]);
});

test('command 2 pairs a plausible x with a plausible y that no demonstration uses', () => {
  assert.equal(H.individuallyPlausible(H.CORNERS, 1, 1, 1), true);
  assert.equal(H.individuallyPlausible(H.CORNERS, 1, 0, 0), true);
  assert.equal(H.individuallyPlausible(H.CORNERS, 1, 0, 1), false);
  const base = H.refine(H.CORNERS, 'independent', 0);
  assert.equal(base.splitTime, 1);
  near(base.pairInvalid, 0.5, 'pair');
  near(base.pairInvalid, ownProductInvalid(H.CORNERS, 1), 'pair recount');
  const absent = base.splitAtoms.filter((atom) => !atom.demonstrated);
  assert.deepEqual(absent.map((atom) => [atom.x, atom.y]), [[0, 0], [1, 1]]);
  for (const atom of absent) {
    near(atom.p, 0.25, 'miss probability');
    assert.equal(H.individuallyPlausible(H.CORNERS, 1, atom.x, atom.y), true);
  }
  near(base.chunkInvalid, 0.9375, 'chunk');
  near(base.chunkValid, 0.0625, 'valid chunk');
});

test('coordinate conditioning removes the bad pair and leaves a stitched chunk', () => {
  const once = H.refine(H.CORNERS, 'coordinate', 1);
  const again = H.refine(H.CORNERS, 'coordinate', 5);
  assert.equal(once.trace.length, 2);
  assert.equal(again.trace.length, 6);
  near(once.trace[0].pairInvalid, 0.5, 'before');
  near(once.pairInvalid, 0, 'after one');
  near(again.pairInvalid, 0, 'after five');
  near(once.chunkInvalid, 0.75, 'chunk after coordinate');
  near(again.chunkInvalid, once.chunkInvalid, 'extra coordinate steps');
  assert.equal(once.plausibleMiss, null);
  assert.equal(once.demonstrations, 2);
  assert.equal(once.commands, H.score(H.CORNERS).commands);
});

test('independent redraws and time-only conditioning do not remove the bad pair', () => {
  const base = H.refine(H.CORNERS, 'independent', 0);
  const redraw = H.refine(H.CORNERS, 'redraw', 5);
  const time = H.refine(H.CORNERS, 'time', 1);
  assert.equal(redraw.trace.length, 6);
  redraw.trace.forEach((row) => {
    near(row.pairInvalid, base.pairInvalid, 'redraw pair');
    near(row.chunkInvalid, base.chunkInvalid, 'redraw chunk');
  });
  near(time.pairInvalid, base.pairInvalid, 'time pair');
  near(time.chunkInvalid, 0.5, 'time chunk');
  assert.ok(time.chunkInvalid < base.chunkInvalid);
  assert.ok(time.chunkInvalid > 0);
  const pair = H.refine(H.CORNERS, 'pair', 1);
  near(pair.pairInvalid, 0, 'pair step');
  near(pair.chunkInvalid, 0, 'pair chunk');
  near(pair.chunkValid, 1, 'pair valid');
  near(H.refine(H.CORNERS, 'pair', 4).chunkInvalid, 0, 'more pair steps');
});

test('a changed demonstration changes the product, and a repeated corner does not factorize', () => {
  const altered = [H.CORNERS[0], H.CORNERS[0], H.CORNERS[1]];
  const refined = H.refine(altered, 'independent', 0);
  near(refined.pairInvalid, ownProductInvalid(altered, 1), 'three demonstrations');
  assert.ok(Math.abs(refined.pairInvalid - 0.5) > 0.05);
  const copies = [H.CORNERS[0], H.CORNERS[0].map((row) => row.slice())];
  const same = H.refine(copies, 'independent', 0);
  near(same.pairInvalid, 0, 'copies');
  near(same.chunkInvalid, 0, 'copy chunk');
  const scored = H.score(copies);
  near(scored.ratios[0], 1, 'copy ratio');
  assert.equal(scored.meanBelowAll, false);
});

test('zero expert jerk leaves the ratio undefined, including when bins add jerk', () => {
  const line = H.score(H.LINE);
  assert.equal(line.expertJerks[0], 0);
  assert.equal(line.expertJerks[1], 0);
  assert.equal(line.meanJerk, 0);
  assert.deepEqual(line.ratios, [null, null]);
  assert.deepEqual(line.binRatios, [null, null]);
  assert.equal(line.binJerks[0], 0);
  assert.equal(line.meanBelowAll, false);
  assert.equal(Number.isFinite(line.ratios[0]), false);
  const smooth = H.score(H.SMOOTH);
  assert.equal(smooth.expertJerks[0], 0);
  assert.equal(smooth.ratios[0], null);
  assert.equal(smooth.regressionMse, 0);
  assert.ok(smooth.binMse > 0);
  assert.ok(smooth.binJerks[0] > 0);
  assert.equal(smooth.meanBelowAll, false);
  assert.equal(H.jerkRatio(H.meanChunk(H.LINE), H.LINE[0]).ratio, null);
});

test('the teaching grid is 8 bins and the published 512 is not the quantizer', () => {
  assert.equal(H.BINS, 8);
  assert.notEqual(H.BINS, H.PAPER_BINS);
  assert.equal(H.binIndex(0), 1);
  assert.equal(H.binCenter(H.binIndex(0)), 0);
  assert.equal(H.binCenter(H.binIndex(5)), 5);
  assert.equal(H.binIndex(100), 8);
  assert.equal(H.binIndex(-10), 1);
  assert.deepEqual(H.quantizeChunk(H.CORNERS[0]), H.CORNERS[0]);
});

test('bad inputs fail closed', () => {
  assert.throws(() => H.score([]), /demonstrations/);
  assert.throws(() => H.score([[[0, 0], [1, 0]]]), /4 commands/);
  assert.throws(() => H.jerkRatio([[0, 0], [1, 1], [2, 2]], H.LINE[0]), /4 commands/);
  assert.throws(() => H.refine(H.CORNERS, 'flow', 1), /unknown/);
  assert.throws(() => H.refine(H.CORNERS, 'pair', 1.5), /steps/);
  assert.throws(() => H.refine([[ [0, 0], [1, 0], [2, 0], [3, 0] ], [ [0, 0], [1, 0], [2, 0] ]], 'independent', 0), /command count/);
});

test('the lesson is mounted after two good ways and does not take the autoregressive id', () => {
  const context = vm.createContext({ window: { BBHEADS: H }, console });
  for (const file of ['web/content.js', 'web/content2.js', 'web/content3.js', 'web/heads-level.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  const levels = context.window.CONTENT.levels;
  const at = levels.findIndex((level) => level.id === 'heads');
  assert.ok(at > 0);
  assert.equal(levels[at - 1].id, 'twoways');
  assert.equal(levels[at + 1].id, 'pick');
  assert.equal(levels[at].custom, true);
  assert.equal(levels[at].world, 'heads');
  assert.equal(levels[at].phase, 5);
  assert.equal(context.window.CONTENT.worldNames.heads, 'Two corners');
  assert.equal(levels.some((level) => level.id === 'autoreg' || level.id === 'bins'), false);
  assert.match(levels[at].goal.text, /undefined/);
  assert.match(levels[at].intro, /illustrative/i);
  const lesson = fs.readFileSync('web/heads-level.js', 'utf8');
  const engine = fs.readFileSync('src/agents/heads.js', 'utf8');
  assert.match(lesson, /oversmoothed the training data with respect to time/);
  assert.match(lesson, /factorization error/);
  assert.doesNotMatch(lesson + engine, /—|–/);
  const app = fs.readFileSync('web/app.js', 'utf8');
  assert.match(app, /id === 'heads'/);
  assert.match(fs.readFileSync('build.mjs', 'utf8'), /heads-level\.js/);
});
