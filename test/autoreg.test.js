// Two-bit counts: marginal product versus the conditional row.
// Invalid probabilities below are computed from the counts in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../src/agents/autoreg.js');

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1;
}
function frac(num, den) {
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}
function add(a, b) { return frac(a.num * b.den + b.num * a.den, a.den * b.den); }

function handInvalid(counts, method) {
  const total = counts['00'] + counts['01'] + counts['10'] + counts['11'];
  const n1 = { 0: counts['00'] + counts['01'], 1: counts['10'] + counts['11'] };
  const n2 = { 0: counts['00'] + counts['10'], 1: counts['01'] + counts['11'] };
  const pairs = {};
  let invalid = frac(0, 1);
  for (const bit1 of [0, 1]) {
    for (const bit2 of [0, 1]) {
      const key = '' + bit1 + bit2;
      let p;
      if (method === 'independent') p = frac(n1[bit1] * n2[bit2], total * total);
      else {
        const prefix = n1[bit1];
        p = prefix === 0 ? frac(0, 1) : frac(n1[bit1] * counts[key], total * prefix);
      }
      pairs[key] = p;
      if (counts[key] === 0) invalid = add(invalid, p);
    }
  }
  return { pairs, invalid };
}

function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function drawBit(count0, count1, next) {
  const total = count0 + count1;
  const bucket = Math.floor(next() * total);
  return bucket < count0 ? 0 : 1;
}
function handSamples(counts, method, draws, seed) {
  const n1 = { 0: counts['00'] + counts['01'], 1: counts['10'] + counts['11'] };
  const n2 = { 0: counts['00'] + counts['10'], 1: counts['01'] + counts['11'] };
  const next = mulberry32(seed);
  const out = [];
  for (let i = 0; i < draws; i++) {
    const bit1 = drawBit(n1[0], n1[1], next);
    const bit2 = method === 'independent'
      ? drawBit(n2[0], n2[1], next)
      : drawBit(counts['' + bit1 + '0'], counts['' + bit1 + '1'], next);
    out.push('' + bit1 + bit2);
  }
  return out;
}

function value(p) { return p.num / p.den; }

test('lesson counts give independent invalid 1/2 and conditional invalid 0, with both legal pairs at 1/2', () => {
  const counts = { '00': 3, '01': 0, '10': 0, '11': 3 };
  const handInd = handInvalid(counts, 'independent');
  const handCond = handInvalid(counts, 'conditional');
  assert.equal(value(handInd.invalid), 1 / 2);
  assert.equal(value(handCond.invalid), 0);
  assert.equal(value(handCond.pairs['00']), 1 / 2);
  assert.equal(value(handCond.pairs['11']), 1 / 2);
  assert.equal(handCond.pairs['01'].num, 0);
  assert.equal(handCond.pairs['10'].num, 0);

  const pack = A.compare(A.LESSON);
  assert.deepEqual(A.LESSON.counts, counts);
  assert.deepEqual(pack.theoretical.independent.invalid, handInd.invalid);
  assert.deepEqual(pack.theoretical.conditional.invalid, handCond.invalid);
  assert.deepEqual(pack.theoretical.independent.pairs, handInd.pairs);
  assert.deepEqual(pack.theoretical.conditional.pairs, handCond.pairs);
  assert.deepEqual(pack.model.marginal.first[0].p, { num: 1, den: 2 });
  assert.deepEqual(pack.model.marginal.second[0].p, { num: 1, den: 2 });
  assert.equal(pack.theoretical.independent.invalid === pack.empirical.independent.counts, false);
  assert.equal(pack.empirical.independent.invalid, undefined);
  assert.equal(pack.empirical.conditional.invalid, undefined);

  const draws = pack.empirical.conditional.draws;
  const cond = pack.empirical.conditional.counts;
  const ind = pack.empirical.independent.counts;
  assert.equal(cond['00'] + cond['01'] + cond['10'] + cond['11'], draws);
  assert.equal(ind['00'] + ind['01'] + ind['10'] + ind['11'], draws);
  assert.notDeepEqual(cond, { '00': draws, '01': 0, '10': 0, '11': 0 });
  assert.notDeepEqual(cond, { '00': 0, '01': draws, '10': 0, '11': 0 });
  assert.notDeepEqual(cond, { '00': 0, '01': 0, '10': draws, '11': 0 });
  assert.equal(cond['01'], 0);
  assert.equal(cond['10'], 0);
  assert.ok(cond['00'] > 0 && cond['11'] > 0);
  assert.ok(Math.abs(cond['00'] / draws - 0.5) < 0.05);
  assert.ok(Math.abs(cond['11'] / draws - 0.5) < 0.05);
  assert.ok(ind['01'] > 0 && ind['10'] > 0);
  assert.ok(Math.abs((ind['01'] + ind['10']) / draws - 0.5) < 0.05);
  assert.deepEqual(pack.empirical.conditional.samples, handSamples(counts, 'conditional', draws, A.LESSON.seed));
  assert.deepEqual(pack.empirical.independent.samples, handSamples(counts, 'independent', draws, A.LESSON.seed));
  assert.equal(pack.claims.argmax, false);
  assert.equal(pack.claims.perBitTieBreak, false);
  assert.equal(pack.claims.neuralTokenizer, false);
  assert.equal(pack.claims.sequenceModel, false);
  assert.equal(JSON.stringify(pack).includes('NaN'), false);
  assert.equal(JSON.stringify(pack).includes('Infinity'), false);
});

test('a second seed changes the coins and the same seed repeats', () => {
  const a = A.compare(A.LESSON);
  const b = A.compare(A.LESSON);
  const other = A.compare({ counts: A.LESSON.counts, seed: A.LESSON.seed + 1, draws: A.LESSON.draws });
  assert.deepEqual(a.empirical.conditional.samples, b.empirical.conditional.samples);
  assert.notDeepEqual(a.empirical.conditional.samples, other.empirical.conditional.samples);
  assert.notDeepEqual(a.empirical.independent.samples, other.empirical.independent.samples);
  assert.deepEqual(a.theoretical.conditional.pairs, other.theoretical.conditional.pairs);
});

test('swapped pair counts keep the same marginals and move the half mass onto 01 and 10', () => {
  const lesson = A.compare(A.LESSON);
  const swap = A.compare(A.SWAP);
  const hand = handInvalid(A.SWAP.counts, 'conditional');
  const handInd = handInvalid(A.SWAP.counts, 'independent');
  assert.deepEqual(swap.model.marginal, lesson.model.marginal);
  assert.deepEqual(swap.theoretical.conditional.pairs, hand.pairs);
  assert.deepEqual(swap.theoretical.independent.invalid, handInd.invalid);
  assert.equal(value(handInd.invalid), 1 / 2);
  assert.equal(value(hand.invalid), 0);
  assert.equal(value(hand.pairs['01']), 1 / 2);
  assert.equal(value(hand.pairs['10']), 1 / 2);
  assert.equal(hand.pairs['00'].num, 0);
  assert.equal(hand.pairs['11'].num, 0);
  assert.notDeepEqual(swap.theoretical.conditional.pairs, lesson.theoretical.conditional.pairs);
  const counts = swap.empirical.conditional.counts;
  assert.equal(counts['00'], 0);
  assert.equal(counts['11'], 0);
  assert.ok(Math.abs(counts['01'] / A.SWAP.draws - 0.5) < 0.05);
  assert.ok(Math.abs(counts['10'] / A.SWAP.draws - 0.5) < 0.05);
  assert.deepEqual(swap.empirical.conditional.samples, handSamples(A.SWAP.counts, 'conditional', A.SWAP.draws, A.SWAP.seed));
});

test('an uneven table is not the lesson half, and a zero prefix draws no second bit', () => {
  const counts = { '00': 2, '01': 2, '10': 2, '11': 0 };
  const pack = A.compare({ counts, seed: 4, draws: 900 });
  const handInd = handInvalid(counts, 'independent');
  const handCond = handInvalid(counts, 'conditional');
  assert.equal(value(handInd.invalid), 1 / 9);
  assert.equal(value(handCond.invalid), 0);
  assert.deepEqual(pack.theoretical.independent.invalid, handInd.invalid);
  assert.deepEqual(pack.theoretical.conditional.pairs, handCond.pairs);
  assert.notEqual(value(handCond.pairs['11']), 1 / 2);
  assert.equal(pack.empirical.conditional.counts['11'], 0);
  assert.deepEqual(pack.empirical.independent.samples, handSamples(counts, 'independent', 900, 4));

  const hole = A.fit(A.UNSUPPORTED.counts);
  assert.equal(hole.conditional[1].defined, false);
  assert.equal(hole.conditional[1][0], null);
  assert.equal(hole.conditional[1][1], null);
  assert.equal(hole.conditional[0].defined, true);
  assert.notDeepEqual(hole.conditional[1], hole.conditional[0]);
  let saw0 = false; let saw1 = false;
  for (let seed = 1; seed <= 40; seed++) {
    const asked = A.querySecond(hole, 1, seed);
    assert.equal(asked.defined, false);
    assert.equal(asked.sample, null);
    assert.match(asked.reason, /unsupported|count zero/);
    const kept = A.querySecond(hole, 0, seed);
    assert.equal(kept.defined, true);
    assert.ok(kept.sample === 0 || kept.sample === 1);
    if (kept.sample === 0) saw0 = true;
    if (kept.sample === 1) saw1 = true;
  }
  assert.equal(saw0 && saw1, true);
  const lesson = A.fit(A.LESSON.counts);
  for (let seed = 1; seed <= 12; seed++) {
    assert.equal(A.querySecond(lesson, 0, seed).sample, 0);
    assert.equal(A.querySecond(lesson, 1, seed).sample, 1);
  }
  const none = A.compare({ counts: { '00': 0, '01': 0, '10': 0, '11': 0 }, seed: 1, draws: 4 });
  assert.equal(none.ok, false);
  assert.equal(none.empirical.conditional.samples.length, 0);
  assert.equal(A.querySecond(none.model, 0, 1).sample, null);
  assert.equal(JSON.stringify(none).includes('NaN'), false);
  const bad = A.fit({ '00': -1, '01': 0, '10': 0, '11': 0 });
  assert.equal(bad.ok, false);
  assert.equal(bad.defined, false);
});

test('the lesson bundle keeps the cartpole bin id elsewhere and leaves the fast engine alone', () => {
  const pack = A.lesson();
  assert.equal(pack.lesson.theoretical.conditional.pairs['11'].num, 1);
  assert.equal(pack.unsupported.sample, null);
  assert.equal(pack.swap.theoretical.conditional.pairs['01'].den, 2);
  assert.equal(pack.claims.actionHeadPaper, false);
  const agent = fs.readFileSync('src/agents/autoreg.js', 'utf8');
  const level = fs.readFileSync('web/autoreg-level.js', 'utf8');
  assert.doesNotMatch(agent, /require\(|Math\.max|goals\.js|BBGOALS/);
  assert.doesNotMatch(level, /goals\.js|BBGOALS|actionheads/);
  assert.equal(agent.includes('\u2014'), false);
  assert.equal(level.includes('\u2014'), false);
  assert.equal(agent.includes('\u2013'), false);
  assert.equal(level.includes('\u2013'), false);
  assert.match(level, /Can we discretize continuous action spaces\?/);
  assert.match(level, /Autoregressive discretization/);
  assert.match(fs.readFileSync('web/content.js', 'utf8'), /id: 'bins', world: 'cartpole'/);
  assert.equal(require('../scripts/fast-source.js').engineFiles.includes('src/agents/autoreg.js'), false);
});

test('autoreg mounts after goals, keeps its id, and stays off the last slot when skew inserts', () => {
  const context = {
    window: {
      CONTENT: {
        phases: [{ n: 0, title: 'Imitation before reward' }, { n: 10, title: 'Diverse skills' }],
        levels: [
          { id: 'goals', phase: 0, title: 'Tell it the goal' },
          { id: 'slots', phase: 1, title: 'Ten slot machines' },
          { id: 'skills', phase: 10, title: 'Pay a skill for being identifiable' },
          { id: 'supermimic', phase: 8, title: 'Trust, then verify, your model' },
          { id: 'rare', phase: 11, title: 'A bonus for a rare cell' },
        ],
        worldNames: { goals: 'Two doors' },
      },
      BBAUTOREG: A,
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/autoreg-level.js', 'utf8'), context);
  assert.deepEqual(context.window.CONTENT.levels.map((l) => l.id), ['goals', 'autoreg', 'slots', 'skills', 'supermimic', 'rare']);
  const mounted = context.window.CONTENT.levels.find((l) => l.id === 'autoreg');
  assert.equal(mounted.world, 'autoreg');
  assert.notEqual(mounted.id, 'bins');
  assert.equal(mounted.phase, 0);
  assert.equal(context.window.CONTENT.worldNames.autoreg, 'Two bits');
  context.window.BBSKEW = require('../src/agents/skew.js');
  vm.runInContext(fs.readFileSync('web/skew-level.js', 'utf8'), context);
  const ids = context.window.CONTENT.levels.map((l) => l.id);
  assert.equal(ids[0], 'goals');
  assert.equal(ids[1], 'autoreg');
  assert.equal(ids[ids.indexOf('skills') + 1], 'skew');
  assert.equal(ids.at(-1), 'rare');
  assert.equal(context.window.CONTENT.phases.filter((p) => p.n === 0).length, 1);
  assert.equal(context.window.CONTENT.phases.find((p) => p.n === 0).title, 'Imitation before reward');
  const app = fs.readFileSync('web/app.js', 'utf8');
  const apiAt = app.indexOf('function customLessonApi');
  const api = app.slice(apiAt, app.indexOf('return null;', apiAt));
  assert.ok(api.includes("id === 'autoreg'"));
  assert.ok(api.includes('window.BBAUTOREG'));
  assert.ok(api.includes("id === 'skew'"));
  assert.ok(api.includes("id === 'goals'"));
  assert.match(fs.readFileSync('build.mjs', 'utf8'), /src\/agents\/autoreg\.js', 'web\/autoreg-level\.js'/);
});
