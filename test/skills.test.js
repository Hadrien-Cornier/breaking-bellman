// Mechanism checks for the two-skill discriminator reward.
// Expected rewards are log(smoothed count) - log(prior), recomputed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../src/agents/skills.js');

function qOf(counts, alpha) {
  const out = {};
  for (const room of ['west', 'east']) {
    const den = counts.red[room] + counts.blue[room] + 2 * alpha;
    out[room] = den > 0 ? {
      red: (counts.red[room] + alpha) / den,
      blue: (counts.blue[room] + alpha) / den,
      den,
    } : { red: null, blue: null, den: 0 };
  }
  return out;
}

function rewardOf(q, prior) {
  if (!(q > 0)) return null;
  return Math.log(q) - Math.log(prior);
}

function softmax(west, east) {
  const m = Math.max(west, east);
  const ew = Math.exp(west - m);
  const ee = Math.exp(east - m);
  return { west: ew / (ew + ee), east: ee / (ew + ee) };
}

function independentTrain(counts, alpha, prior, eta, updates) {
  const q = qOf(counts, alpha);
  const reward = {};
  for (const skill of ['red', 'blue']) {
    reward[skill] = {
      west: rewardOf(q.west[skill], prior),
      east: rewardOf(q.east[skill], prior),
    };
  }
  const theta = { red: { west: 0, east: 0 }, blue: { west: 0, east: 0 } };
  for (let step = 0; step < updates; step++) {
    for (const skill of ['red', 'blue']) {
      const rw = reward[skill].west;
      const re = reward[skill].east;
      if (!Number.isFinite(rw) || !Number.isFinite(re)) continue;
      const pi = softmax(theta[skill].west, theta[skill].east);
      const mean = pi.west * rw + pi.east * re;
      theta[skill].west += eta * pi.west * (rw - mean);
      theta[skill].east += eta * pi.east * (re - mean);
    }
  }
  const pi = {
    red: softmax(theta.red.west, theta.red.east),
    blue: softmax(theta.blue.west, theta.blue.east),
  };
  return { q, reward, theta, pi };
}

function entropy(ps) {
  return ps.reduce((sum, p) => (p > 0 ? sum - p * Math.log(p) : sum), 0);
}

function independentMI(counts) {
  const n = counts.red.west + counts.red.east + counts.blue.west + counts.blue.east;
  const ps = ['red', 'blue'].map((skill) => (counts[skill].west + counts[skill].east) / n);
  const hSkill = entropy(ps);
  let hCond = 0;
  for (const room of ['west', 'east']) {
    const roomN = counts.red[room] + counts.blue[room];
    if (!roomN) continue;
    const cond = ['red', 'blue'].map((skill) => counts[skill][room] / roomN);
    hCond += (roomN / n) * entropy(cond);
  }
  return { hSkill, hCond, mutualInformation: hSkill - hCond };
}

function grids() {
  const out = [];
  for (const a of [0, 1, 4, 6]) {
    for (const b of [0, 2, 5]) {
      for (const c of [0, 3]) {
        for (const d of [0, 1, 4]) out.push({ red: { west: a, east: b }, blue: { west: c, east: d } });
      }
    }
  }
  return out;
}

test('smoothed conditionals are normalized, and a missing room stays finite', () => {
  for (const counts of grids()) {
    for (const alpha of [0, 0.5, 1, 8]) {
      const fit = S.fitDiscriminator(counts, alpha);
      const own = qOf(counts, alpha);
      for (const room of ['west', 'east']) {
        if (!own[room].den) {
          assert.equal(fit.rooms[room].supported, false);
          assert.equal(fit.rooms[room].q.red, null);
          assert.equal(fit.rooms[room].q.blue, null);
          continue;
        }
        assert.ok(Math.abs(fit.rooms[room].q.red + fit.rooms[room].q.blue - 1) < 1e-12, room);
        assert.ok(Math.abs(fit.rooms[room].q.red - own[room].red) < 1e-12);
        assert.ok(Math.abs(fit.rooms[room].q.blue - own[room].blue) < 1e-12);
        assert.ok(fit.rooms[room].q.red >= 0 && fit.rooms[room].q.blue >= 0);
      }
    }
  }
  const missing = { red: { west: 5, east: 0 }, blue: { west: 0, east: 0 } };
  const bare = S.train({ counts: missing, mode: 'discriminator', alpha: 0, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  assert.equal(bare.rewards.table.red.east.value, null);
  assert.equal(bare.policies.red.pi.west, 0.5);
  assert.equal(bare.policies.blue.action, null);
  assert.equal(JSON.stringify(bare).includes('NaN'), false);
  assert.equal(JSON.stringify(bare).includes('Infinity'), false);
  const smooth = S.train({ counts: missing, mode: 'discriminator', alpha: 1, prior: 0.5, eta: 1, updates: 1, tieBreak: false });
  assert.equal(smooth.rewards.fit.rooms.east.q.red, 0.5);
  assert.equal(smooth.rewards.fit.rooms.east.q.blue, 0.5);
  assert.ok(smooth.rewards.table.blue.east.value > smooth.rewards.table.blue.west.value);
  assert.equal(smooth.policies.blue.action, 'east');
  assert.equal(smooth.policies.red.action, 'west');
  assert.notEqual(smooth.policies.red.theta.west, bare.policies.red.theta.west);
});

test('the gradient matches an independent softmax update, and a swap reverses it', () => {
  const plan = S.exactPlanCounts({ budgetPerSkill: 8, bias: 0.25 }).counts;
  const tables = [plan, S.swapSkills(plan), { red: { west: 7, east: 1 }, blue: { west: 1, east: 5 } }, { red: { west: 1, east: 1 }, blue: { west: 4, east: 0 } }];
  for (const counts of tables) {
    for (const alpha of [1, 3]) {
      const got = S.train({ counts, mode: 'discriminator', alpha, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
      const own = independentTrain(counts, alpha, 0.5, 1, 4);
      for (const skill of ['red', 'blue']) {
        assert.ok(Math.abs(got.policies[skill].pi.west - own.pi[skill].west) < 1e-12, skill);
        const higher = own.reward[skill].west === own.reward[skill].east ? null : (own.reward[skill].west > own.reward[skill].east ? 'west' : 'east');
        assert.equal(got.policies[skill].higherRoom, higher);
        if (higher) assert.equal(got.policies[skill].action, higher);
      }
    }
  }
  const forward = S.train({ counts: plan, mode: 'discriminator', alpha: 1, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  const backward = S.train({ counts: S.swapSkills(plan), mode: 'discriminator', alpha: 1, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  assert.equal(forward.policies.red.action, 'west');
  assert.equal(forward.policies.blue.action, 'east');
  assert.equal(backward.policies.red.action, 'east');
  assert.equal(backward.policies.blue.action, 'west');
  assert.ok(Math.abs(forward.policies.red.pi.west - backward.policies.blue.pi.west) < 1e-12);
  assert.ok(Math.abs(forward.rewards.table.red.west.value - backward.rewards.table.blue.west.value) < 1e-12);
  const fixed = { red: 'west', blue: 'east' };
  assert.notEqual(fixed.red, backward.policies.red.action);
  const matched = { red: { west: 6, east: 2 }, blue: { west: 6, east: 2 } };
  const same = S.train({ counts: matched, mode: 'discriminator', alpha: 1, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  assert.equal(same.policies.red.action, null);
  assert.equal(same.rewards.table.red.west.value, 0);
  assert.notEqual('west', same.policies.red.action);
});

test('symmetric visits do not split, and replacing the discriminator changes the same budget', () => {
  const pack = S.compare();
  assert.deepEqual(pack.disc.counts, pack.shared.counts);
  assert.equal(pack.disc.interactions, pack.shared.interactions);
  assert.equal(pack.disc.updates, pack.novelty.updates);
  assert.equal(pack.disc.eta, pack.shared.eta);
  assert.equal(pack.sym.separated, false);
  assert.equal(pack.sym.rewards.fit.rooms.west.q.red, 0.5);
  assert.equal(pack.sym.rewards.table.red.west.value, 0);
  assert.equal(pack.sym.policies.red.pi.west, 0.5);
  assert.equal(pack.sym.policies.blue.pi.west, 0.5);
  assert.equal(pack.sym.trace.every((row) => row.reason === 'equal-reward-zero-gradient'), true);
  assert.equal(pack.disc.separated, true);
  assert.equal(pack.shared.separated, false);
  assert.equal(pack.shared.policies.red.pi.west, 0.5);
  assert.equal(pack.novelty.separated, false);
  assert.equal(pack.novelty.rewards.table.red.west.value, 0);
  assert.notEqual(pack.disc.policies.red.pi.west, pack.shared.policies.red.pi.west);
  assert.equal(pack.sharedTie.policies.red.action, 'west');
  assert.equal(pack.sharedTie.policies.blue.action, 'west');
  assert.equal(pack.sharedTie.separated, false);
  assert.equal(pack.follow.complete, true);
  assert.equal(pack.follow.interactions, pack.interactions);
  assert.equal(pack.afterTie.separated, false);
  assert.equal(pack.afterTie.rewards.table.red.west.value, 0);
  const exclusive = { red: { west: 8, east: 0 }, blue: { west: 0, east: 8 } };
  const disc = S.rewardTable(exclusive, 'discriminator', 1, 0.5);
  const novelty = S.rewardTable(exclusive, 'novelty', 1, 0.5);
  assert.equal(novelty.table.red.west.value, 1);
  assert.notEqual(disc.table.red.west.value, novelty.table.red.west.value);
  for (const n of [0, 1, 3, 10]) {
    const even = { red: { west: n, east: n }, blue: { west: n, east: n } };
    const alpha = n === 0 ? 1 : 0;
    const out = S.train({ counts: even, mode: 'discriminator', alpha, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
    assert.equal(out.separated, false);
    assert.equal(out.rewards.table.red.west.value, 0);
    assert.equal(out.policies.red.action, null);
  }
});

test('smoothing, exploration, and the prior change the reward rather than the labels', () => {
  const mild = S.exactPlanCounts({ budgetPerSkill: 8, bias: 0.25 });
  const sharp = S.exactPlanCounts({ budgetPerSkill: 8, bias: 0.5 });
  assert.notDeepEqual(mild.counts, sharp.counts);
  assert.equal(mild.counts.red.west, 6);
  assert.equal(sharp.counts.blue.east, 8);
  const low = S.train({ counts: mild.counts, mode: 'discriminator', alpha: 1, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  const high = S.train({ counts: mild.counts, mode: 'discriminator', alpha: 8, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
  const otherPrior = S.train({ counts: mild.counts, mode: 'discriminator', alpha: 1, prior: 0.25, eta: 1, updates: 4, tieBreak: false });
  assert.ok(Math.abs(low.rewards.table.red.west.value) > Math.abs(high.rewards.table.red.west.value));
  assert.ok(Math.abs(low.policies.red.pi.west - 0.5) > Math.abs(high.policies.red.pi.west - 0.5));
  assert.notEqual(low.rewards.table.red.west.value, otherPrior.rewards.table.red.west.value);
  assert.ok(high.separated);
  const sample = S.sampleCounts({ budgetPerSkill: 8, bias: 0.5, seed: 11 });
  const again = S.sampleCounts({ budgetPerSkill: 8, bias: 0.5, seed: 11 });
  const other = S.sampleCounts({ budgetPerSkill: 8, bias: 0, seed: 11 });
  assert.deepEqual(sample.counts, again.counts);
  assert.equal(sample.counts.red.west, 8);
  assert.equal(sample.counts.blue.east, 8);
  assert.notDeepEqual(sample.counts, other.counts);
  assert.equal(sample.interactions, 16);
});

test('the count-table mutual information is not the smoothed reward', () => {
  const plan = S.exactPlanCounts({ budgetPerSkill: 8, bias: 0.25 }).counts;
  const info = S.batchInformation(plan);
  const own = independentMI(plan);
  assert.ok(Math.abs(info.mutualInformation - own.mutualInformation) < 1e-12);
  assert.ok(Math.abs(info.hSkill - Math.log(2)) < 1e-12);
  assert.equal(info.balanced, true);
  const unsmoothed = S.rewardTable(plan, 'discriminator', 0, 0.5);
  const smoothed = S.rewardTable(plan, 'discriminator', 1, 0.5);
  const raw = S.averageReward(plan, unsmoothed.table);
  const soft = S.averageReward(plan, smoothed.table);
  assert.ok(Math.abs(raw.value - info.mutualInformation) < 1e-12);
  assert.ok(Math.abs(soft.value - info.mutualInformation) > 1e-4);
  const symmetric = S.exactPlanCounts({ budgetPerSkill: 8, bias: 0 }).counts;
  const symInfo = S.batchInformation(symmetric);
  assert.ok(Math.abs(symInfo.mutualInformation) < 1e-12);
  assert.equal(S.averageReward(symmetric, S.rewardTable(symmetric, 'discriminator', 1, 0.5).table).value, 0);
});

test('the lesson mounts before hindsight and keeps the other levels', () => {
  function load(levels, phases) {
    const context = vm.createContext({
      window: { CONTENT: { phases: phases.slice(), levels: levels.slice(), worldNames: {}, cards: {} }, BBSKILLS: S },
    });
    vm.runInContext(fs.readFileSync('web/skills-level.js', 'utf8'), context);
    return context.window;
  }
  const withHindsight = load(
    [{ id: 'goals' }, { id: 'hindsight' }, { id: 'supermimic' }],
    [{ n: 9, title: 'Multi-task goals' }],
  );
  assert.deepEqual(withHindsight.CONTENT.levels.map((l) => l.id), ['goals', 'skills', 'hindsight', 'supermimic']);
  assert.equal(withHindsight.CONTENT.levels[1].world, 'skills');
  assert.equal(withHindsight.CONTENT.levels[1].custom, true);
  assert.equal(withHindsight.CONTENT.phases[0].n, 10);
  assert.equal(withHindsight.CONTENT.phases[1].n, 9);
  const alone = load([{ id: 'supermimic' }, { id: 'slots' }], []);
  assert.deepEqual(alone.CONTENT.levels.map((l) => l.id), ['skills', 'supermimic', 'slots']);
  assert.equal(typeof withHindsight.BBSKILLS_LEVEL.mount, 'function');
  assert.equal(withHindsight.CONTENT.worldNames.skills, 'Two skills');
});
