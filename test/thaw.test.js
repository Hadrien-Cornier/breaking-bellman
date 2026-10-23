'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../src/agents/thaw.js');

function solve(matrix, target) {
  const n = target.length;
  const rows = matrix.map((row, i) => row.concat(target[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    const swap = rows[col];
    rows[col] = rows[pivot];
    rows[pivot] = swap;
    const scale = rows[col][col];
    for (let c = col; c <= n; c++) rows[col][c] /= scale;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = rows[row][col];
      for (let c = col; c <= n; c++) rows[row][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row) => row[n]);
}

function independentPolicy(transitions) {
  const gram = [[0, 0], [0, 0]];
  const rhs = [0, 0];
  for (const row of transitions) {
    const x = [T.assumptions.target - row.th, row.w];
    for (let i = 0; i < 2; i++) {
      rhs[i] += x[i] * row.action;
      for (let j = 0; j < 2; j++) gram[i][j] += x[i] * x[j];
    }
  }
  return solve(gram, rhs);
}

function near(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, actual + ' vs ' + expected);
}

test('frozen fit adds no transitions and follows the recorded actions', () => {
  const data = T.collectFrozen();
  const before = data.transitions.length;
  const fit = T.fitPolicy(data.transitions);
  const model = T.fitModel(data.transitions);
  const value = T.fitValue(data.transitions);
  assert.equal(data.transitions.length, before);
  assert.equal(before, T.assumptions.horizon);
  assert.equal(data.inertia, T.assumptions.inertiaOld);
  const again = independentPolicy(data.transitions);
  near(fit.weights[0], again[0], 1e-9);
  near(fit.weights[1], again[1], 1e-9);
  const shifted = data.transitions.map((row) => Object.assign({}, row, { action: row.action + 0.2 }));
  const moved = T.fitPolicy(shifted);
  assert.ok(Math.abs(moved.weights[0] - fit.weights[0]) > 0.05);
  const rewarded = data.transitions.map((row) => Object.assign({}, row, { returnToGo: row.returnToGo + 1 }));
  assert.ok(Math.abs(T.fitValue(rewarded).weights[0] - value.weights[0]) > 0.5);
  const oldScale = 1 / T.assumptions.inertiaOld;
  const newScale = 1 / T.assumptions.inertiaNew;
  assert.ok(Math.abs(model.torqueCoefficient - oldScale) < Math.abs(model.torqueCoefficient - newScale));
  assert.equal(model.usedForAction, false);
  assert.equal(value.usedForAction, false);
  assert.equal(fit.usedForAction, true);
});

test('one online update matches a finite difference of evaluated returns and stores the probe transitions', () => {
  const start = T.fitPolicy(T.collectFrozen().transitions).weights.slice();
  const delta = T.assumptions.probe;
  const gradient = [0, 0];
  for (let i = 0; i < 2; i++) {
    const up = start.slice();
    const down = start.slice();
    up[i] += delta;
    down[i] -= delta;
    gradient[i] = (T.evaluate(up, T.assumptions.inertiaNew).totalReward - T.evaluate(down, T.assumptions.inertiaNew).totalReward) / (2 * delta);
  }
  const norm = Math.hypot(gradient[0], gradient[1]);
  const moved = T.online(start, { updates: 1, inertia: T.assumptions.inertiaNew, apply: true });
  near(moved.weights[0], start[0] + T.assumptions.stepLength * gradient[0] / norm, 1e-9);
  near(moved.weights[1], start[1] + T.assumptions.stepLength * gradient[1] / norm, 1e-9);
  assert.equal(moved.onlineTransitions, T.assumptions.probesPerUpdate * T.assumptions.horizon);
  assert.deepEqual(start, T.fitPolicy(T.collectFrozen().transitions).weights);
  const held = T.online(start, { updates: 1, inertia: T.assumptions.inertiaNew, apply: false });
  assert.deepEqual(held.weights, start);
  assert.equal(held.onlineTransitions, moved.onlineTransitions);
  assert.equal(held.totalReward, T.evaluate(start, T.assumptions.inertiaNew).totalReward);
});

test('short fine-tune beats frozen and the same budget from scratch; a longer scratch closes the gap', () => {
  const run = T.compare();
  assert.equal(run.dataset.transitions, T.assumptions.horizon);
  assert.equal(run.frozen.onlineTransitions, 0);
  assert.equal(run.frozen.updates, 0);
  assert.equal(run.finetune.onlineTransitions, run.scratch.onlineTransitions);
  assert.equal(run.finetune.updates, run.scratch.updates);
  assert.equal(run.finetune.updates, T.assumptions.updates);
  assert.equal(run.finetune.inertia, run.scratch.inertia);
  assert.equal(run.finetune.inertia, T.assumptions.inertiaNew);
  assert.notEqual(run.dataset.inertia, run.finetune.inertia);
  assert.equal(run.finetune.totalReward, T.evaluate(run.finetune.weights, T.assumptions.inertiaNew).totalReward);
  assert.equal(run.frozen.totalReward, T.evaluate(run.frozen.weights, T.assumptions.inertiaNew).totalReward);
  assert.equal(run.scratch.totalReward, T.evaluate(run.scratch.weights, T.assumptions.inertiaNew).totalReward);
  assert.ok(run.light.terminalError < 0.15);
  assert.ok(run.frozen.terminalError > 0.4);
  assert.ok(run.finetune.totalReward > run.frozen.totalReward + 2);
  assert.ok(run.finetune.totalReward > run.scratch.totalReward + 2);
  assert.notDeepEqual(run.finetune.weights, run.frozen.weights);
  assert.notDeepEqual(run.scratch.weights, [0, 0]);
  assert.deepEqual(run.held.weights, run.frozen.weights);
  assert.equal(run.held.onlineTransitions, run.finetune.onlineTransitions);
  assert.equal(run.held.totalReward, run.frozen.totalReward);
  assert.ok(run.longScratch.updates > run.scratch.updates);
  assert.equal(run.longScratch.onlineTransitions, run.longScratch.updates * T.assumptions.probesPerUpdate * T.assumptions.horizon);
  assert.ok(run.scratch.terminalError > 0.3);
  assert.ok(run.longScratch.terminalError < 0.05);
  assert.ok(run.longScratch.totalReward > run.scratch.totalReward + 3);
  const repeat = T.compare(run.seed);
  assert.deepEqual(run, repeat);
  const other = T.compare(run.seed + 1);
  assert.equal(other.seed, run.seed + 1);
  assert.equal(other.seedAffectsSampling, false);
  other.seed = run.seed;
  assert.deepEqual(run, other);
});

test('thaw is its own custom level immediately after mixed', () => {
  const api = Object.assign({}, T);
  const context = vm.createContext({ window: { BBTHAW: api } });
  for (const name of ['content', 'content2', 'content3', 'fetch-level', 'thaw-level']) {
    vm.runInContext(fs.readFileSync('web/' + name + '.js', 'utf8'), context);
  }
  const levels = context.window.CONTENT.levels;
  const index = levels.findIndex((level) => level.id === 'thaw');
  assert.ok(index > 0);
  assert.equal(levels[index - 1].id, 'mixed');
  assert.equal(levels[index + 1].id, 'twoways');
  assert.equal(levels[index].custom, true);
  assert.equal(levels[index].phase, 4);
  assert.equal(levels.filter((level) => level.id === 'thaw').length, 1);
  assert.equal(levels.some((level) => level.id === 'offline'), true);
  assert.equal(typeof api.mount, 'function');
  assert.equal(api.compare, T.compare);
});
