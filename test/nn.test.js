'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/nn.js');
const { nn, rng } = globalThis.RLA;

function makeNet(sizes, act, seed, outScale) {
  return nn.mlp({ sizes, act, rng: rng.make(seed), outScale });
}

function objective(net, X, batchSize, act) {
  const sizes = net.sizes;
  const layers = sizes.length - 1;
  let total = 0;
  for (let b = 0; b < batchSize; b++) {
    let values = new Float64Array(sizes[0]);
    for (let i = 0; i < values.length; i++) values[i] = X[b * sizes[0] + i];
    for (let layer = 0; layer < layers; layer++) {
      const fanIn = sizes[layer];
      const fanOut = sizes[layer + 1];
      const weights = net.params[layer * 2];
      const biases = net.params[layer * 2 + 1];
      const next = new Float64Array(fanOut);
      for (let o = 0; o < fanOut; o++) {
        let value = biases[o];
        const row = o * fanIn;
        for (let i = 0; i < fanIn; i++) value += weights[row + i] * values[i];
        next[o] = layer === layers - 1 ? value : (act === 'relu' ? Math.max(0, value) : Math.tanh(value));
      }
      values = next;
    }
    for (let o = 0; o < values.length; o++) total += 0.5 * values[o] * values[o];
  }
  return total;
}

test('backwardBatch gradients match finite differences for relu and tanh', () => {
  for (const act of ['relu', 'tanh']) {
    const net = makeNet([3, 5, 4, 2], act, act === 'relu' ? 410 : 411);
    const random = rng.make(act === 'relu' ? 720 : 721);
    const batchSize = 4;
    const X = new Float32Array(batchSize * 3);
    for (let i = 0; i < X.length; i++) X[i] = random.uniform(-1, 1);
    const outputs = net.forwardBatch(X, batchSize);
    const dOut = new Float32Array(outputs.length);
    dOut.set(outputs);
    net.backwardBatch(dOut);

    const candidates = [];
    for (let p = 0; p < net.params.length; p++) {
      for (let i = 0; i < net.params[p].length; i++) {
        if (Math.abs(net.grads[p][i]) > 1e-3) candidates.push([p, i]);
      }
    }
    assert.ok(candidates.length >= 20, `${act}: expected at least 20 non-trivial parameter gradients`);
    for (let n = 0; n < 20; n++) {
      const selected = random.int(candidates.length);
      const [p, i] = candidates.splice(selected, 1)[0];
      const param = net.params[p];
      const old = param[i];
      const epsilon = 2e-3;
      param[i] = old + epsilon;
      const plus = objective(net, X, batchSize, act);
      param[i] = old - epsilon;
      const minus = objective(net, X, batchSize, act);
      param[i] = old;
      const numeric = (plus - minus) / (2 * epsilon);
      const analytic = net.grads[p][i];
      const relativeError = Math.abs(numeric - analytic) / Math.max(Math.abs(numeric), Math.abs(analytic));
      assert.ok(relativeError < 1e-2, `${act} param ${p}:${i}: numeric=${numeric}, analytic=${analytic}, relative error=${relativeError}`);
    }
  }
});

test('forward matches each row of forwardBatch', () => {
  const net = makeNet([3, 5, 4, 2], 'tanh', 91);
  const batchSize = 4;
  const X = new Float32Array([0.2, -0.5, 1, -0.7, 0.4, 0.1, 0, 0.3, -0.9, 1, 1, -1]);
  const batchOutputs = net.forwardBatch(X, batchSize);
  for (let b = 0; b < batchSize; b++) {
    const row = net.forward(X.subarray(b * 3, (b + 1) * 3));
    for (let o = 0; o < 2; o++) assert.equal(batchOutputs[b * 2 + o], row[o]);
  }
});

test('Adam fits sin(3x) on 64 points', () => {
  const net = makeNet([1, 32, 32, 1], 'tanh', 2026);
  const batchSize = 64;
  const X = new Float32Array(batchSize);
  const target = new Float32Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    const x = -1 + (2 * i) / (batchSize - 1);
    X[i] = x;
    target[i] = Math.sin(3 * x);
  }
  const dOut = new Float32Array(batchSize);
  const optimizer = nn.adam(net, { lr: 0.01 });
  let mse = Infinity;
  for (let step = 0; step < 3000; step++) {
    const output = net.forwardBatch(X, batchSize);
    let squaredError = 0;
    for (let i = 0; i < batchSize; i++) {
      const error = output[i] - target[i];
      squaredError += error * error;
      dOut[i] = (2 * error) / batchSize;
    }
    mse = squaredError / batchSize;
    if (mse < 0.01) break;
    net.backwardBatch(dOut);
    optimizer.step();
  }
  assert.ok(mse < 0.01, `MSE ${mse} did not reach 0.01 within 3000 steps`);
});

test('clipNorm limits the global gradient norm', () => {
  const net = makeNet([2, 2], 'tanh', 12);
  for (const grad of net.grads) grad.fill(10);
  const before = net.gradNorm();
  assert.ok(before > 1);
  const original = net.params.map((param) => param.slice());
  nn.sgd(net, { lr: 1, clipNorm: 1 }).step();
  let updateNormSquared = 0;
  for (let p = 0; p < net.params.length; p++) {
    for (let i = 0; i < net.params[p].length; i++) {
      const update = original[p][i] - net.params[p][i];
      updateNormSquared += update * update;
    }
  }
  assert.ok(Math.sqrt(updateNormSquared) <= 1.00001);
  assert.equal(net.gradNorm(), 0);
});

test('clone and copyFrom preserve outputs and independent parameters', () => {
  const source = makeNet([2, 4, 1], 'tanh', 23);
  const input = new Float32Array([0.25, -0.8]);
  const clone = source.clone();
  const target = makeNet([2, 4, 1], 'tanh', 24);
  target.copyFrom(source);
  assert.deepEqual(Array.from(clone.forward(input)), Array.from(source.forward(input)));
  assert.deepEqual(Array.from(target.forward(input)), Array.from(source.forward(input)));

  const sourceValue = source.params[0][0];
  clone.params[0][0] += 1;
  assert.equal(source.params[0][0], sourceValue);
  const targetValue = target.params[0][0];
  source.params[0][0] += 1;
  assert.equal(target.params[0][0], targetValue);
});
