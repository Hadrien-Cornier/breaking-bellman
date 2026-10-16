(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('./rng.js'); }

  function makeNet(sizes, act, rng, outScale, initialize) {
    const nLayers = sizes.length - 1;
    const params = new Array(nLayers * 2);
    const grads = new Array(nLayers * 2);
    let parameterCount = 0;
    for (let layer = 0; layer < nLayers; layer++) {
      const fanIn = sizes[layer];
      const fanOut = sizes[layer + 1];
      const weights = new Float32Array(fanIn * fanOut);
      const biases = new Float32Array(fanOut);
      if (initialize) {
        let std = Math.sqrt((act === 'relu' ? 2 : 1) / fanIn);
        if (layer === nLayers - 1) std *= outScale;
        for (let i = 0; i < weights.length; i++) weights[i] = rng.normal() * std;
      }
      params[layer * 2] = weights;
      params[layer * 2 + 1] = biases;
      grads[layer * 2] = new Float32Array(weights.length);
      grads[layer * 2 + 1] = new Float32Array(biases.length);
      parameterCount += weights.length + biases.length;
    }

    const batchCaches = new Map();
    let lastCache = null;

    function activate(value) {
      return act === 'relu' ? (value > 0 ? value : 0) : Math.tanh(value);
    }

    function getCache(batchSize) {
      let cache = batchCaches.get(batchSize);
      if (cache) return cache;
      const activations = new Array(nLayers + 1);
      const deltas = new Array(nLayers);
      for (let layer = 0; layer <= nLayers; layer++) {
        activations[layer] = new Float32Array(batchSize * sizes[layer]);
        if (layer < nLayers) deltas[layer] = new Float32Array(batchSize * sizes[layer + 1]);
      }
      cache = { activations, deltas, batchSize };
      batchCaches.set(batchSize, cache);
      return cache;
    }

    const net = {
      sizes: sizes.slice(),
      params,
      grads,
      forward(x) {
        if (!x || x.length !== sizes[0]) throw new RangeError('input length does not match network input size');
        let previous = x;
        for (let layer = 0; layer < nLayers; layer++) {
          const weights = params[layer * 2];
          const biases = params[layer * 2 + 1];
          const fanIn = sizes[layer];
          const fanOut = sizes[layer + 1];
          const current = new Float32Array(fanOut);
          for (let o = 0; o < fanOut; o++) {
            let value = biases[o];
            const row = o * fanIn;
            for (let i = 0; i < fanIn; i++) value += weights[row + i] * previous[i];
            current[o] = layer === nLayers - 1 ? value : activate(value);
          }
          previous = current;
        }
        return previous;
      },
      forwardBatch(X, B) {
        if (!Number.isInteger(B) || B < 1) throw new RangeError('B must be a positive integer');
        if (!X || X.length !== B * sizes[0]) throw new RangeError('input length does not match batch size and network input size');
        const cache = getCache(B);
        lastCache = cache;
        cache.activations[0].set(X);
        for (let layer = 0; layer < nLayers; layer++) {
          const weights = params[layer * 2];
          const biases = params[layer * 2 + 1];
          const fanIn = sizes[layer];
          const fanOut = sizes[layer + 1];
          const previous = cache.activations[layer];
          const current = cache.activations[layer + 1];
          for (let b = 0; b < B; b++) {
            const inputOffset = b * fanIn;
            const outputOffset = b * fanOut;
            for (let o = 0; o < fanOut; o++) {
              let value = biases[o];
              const row = o * fanIn;
              for (let i = 0; i < fanIn; i++) value += weights[row + i] * previous[inputOffset + i];
              current[outputOffset + o] = layer === nLayers - 1 ? value : activate(value);
            }
          }
        }
        return cache.activations[nLayers];
      },
      // wantInput: also return dLoss/dInput, Float32Array(B*in), for chaining one net into another (actor through critic)
      backwardBatch(dOut, wantInput) {
        const cache = lastCache;
        if (!cache) throw new Error('forwardBatch must run before backwardBatch');
        const B = cache.batchSize;
        const outputSize = sizes[nLayers];
        if (!dOut || dOut.length !== B * outputSize) throw new RangeError('gradient length does not match last batch');
        const last = nLayers - 1;
        cache.deltas[last].set(dOut);
        for (let layer = last; layer >= 0; layer--) {
          const weights = params[layer * 2];
          const weightGrads = grads[layer * 2];
          const biasGrads = grads[layer * 2 + 1];
          const fanIn = sizes[layer];
          const fanOut = sizes[layer + 1];
          const previous = cache.activations[layer];
          const delta = cache.deltas[layer];
          for (let b = 0; b < B; b++) {
            const inputOffset = b * fanIn;
            const outputOffset = b * fanOut;
            for (let o = 0; o < fanOut; o++) {
              const derivative = delta[outputOffset + o];
              biasGrads[o] += derivative;
              const row = o * fanIn;
              for (let i = 0; i < fanIn; i++) weightGrads[row + i] += derivative * previous[inputOffset + i];
            }
          }
          if (layer > 0) {
            const prior = cache.deltas[layer - 1];
            const priorSize = sizes[layer];
            const activation = cache.activations[layer];
            for (let b = 0; b < B; b++) {
              const priorOffset = b * priorSize;
              const outputOffset = b * fanOut;
              for (let i = 0; i < priorSize; i++) {
                let value = 0;
                for (let o = 0; o < fanOut; o++) value += weights[o * priorSize + i] * delta[outputOffset + o];
                const a = activation[priorOffset + i];
                prior[priorOffset + i] = value * (act === 'relu' ? (a > 0 ? 1 : 0) : 1 - a * a);
              }
            }
          }
        }
        if (!wantInput) return undefined;
        const fanIn0 = sizes[0], fanOut0 = sizes[1], W0 = params[0], d0 = cache.deltas[0];
        const dX = new Float32Array(B * fanIn0);
        for (let b = 0; b < B; b++) {
          for (let i = 0; i < fanIn0; i++) {
            let value = 0;
            for (let o = 0; o < fanOut0; o++) value += W0[o * fanIn0 + i] * d0[b * fanOut0 + o];
            dX[b * fanIn0 + i] = value;
          }
        }
        return dX;
      },
      // params <- (1 - tau) params + tau src (slow target copies)
      softUpdate(src, tau) {
        for (let i = 0; i < params.length; i++) {
          const p = params[i], q = src.params[i];
          for (let j = 0; j < p.length; j++) p[j] += tau * (q[j] - p[j]);
        }
      },
      zeroGrad() {
        for (let i = 0; i < grads.length; i++) grads[i].fill(0);
      },
      gradNorm() {
        let sum = 0;
        for (let i = 0; i < grads.length; i++) {
          const grad = grads[i];
          for (let j = 0; j < grad.length; j++) sum += grad[j] * grad[j];
        }
        return Math.sqrt(sum);
      },
      copyFrom(other) {
        if (!other || !other.sizes || other.sizes.length !== sizes.length) throw new RangeError('network sizes do not match');
        for (let i = 0; i < sizes.length; i++) {
          if (other.sizes[i] !== sizes[i]) throw new RangeError('network sizes do not match');
        }
        if (!other.params || other.params.length !== params.length) throw new RangeError('network parameter shapes do not match');
        for (let i = 0; i < params.length; i++) {
          if (!other.params[i] || other.params[i].length !== params[i].length) throw new RangeError('network parameter shapes do not match');
        }
        for (let i = 0; i < params.length; i++) params[i].set(other.params[i]);
        return net;
      },
      clone() {
        const clone = makeNet(sizes, act, rng, outScale, false);
        clone.copyFrom(net);
        return clone;
      },
      nParams() { return parameterCount; },
    };
    return net;
  }

  function mlp(options) {
    if (!options || !Array.isArray(options.sizes) || options.sizes.length < 2) {
      throw new TypeError("sizes must contain at least an input and output size");
    }
    const sizes = options.sizes.slice();
    for (let i = 0; i < sizes.length; i++) {
      if (!Number.isInteger(sizes[i]) || sizes[i] < 1) throw new RangeError("sizes must be positive integers");
    }
    const act = options.act;
    if (act !== "relu" && act !== "tanh") throw new TypeError("act must be \"relu\" or \"tanh\"");
    const rng = options.rng;
    if (!rng || typeof rng.normal !== "function") throw new TypeError("rng must provide normal()");
    const outScale = options.outScale === undefined ? 1 : options.outScale;
    if (!Number.isFinite(outScale) || outScale < 0) throw new RangeError("outScale must be a finite non-negative number");
    return makeNet(sizes, act, rng, outScale, true);
  }

  function optimizerOptions(options, defaultLr) {
    options = options || {};
    const lr = options.lr === undefined ? defaultLr : options.lr;
    const clipNorm = options.clipNorm === undefined ? null : options.clipNorm;
    if (!Number.isFinite(lr) || lr <= 0) throw new RangeError('lr must be finite and positive');
    if (clipNorm !== null && (!Number.isFinite(clipNorm) || clipNorm <= 0)) throw new RangeError('clipNorm must be finite and positive or null');
    return { lr, clipNorm };
  }

  function clipGradients(net, clipNorm) {
    if (clipNorm === null) return;
    const norm = net.gradNorm();
    if (norm > clipNorm) {
      const scale = clipNorm / norm;
      for (let i = 0; i < net.grads.length; i++) {
        const grad = net.grads[i];
        for (let j = 0; j < grad.length; j++) grad[j] *= scale;
      }
    }
  }

  function adam(net, options) {
    const opts = optimizerOptions(options, 1e-3);
    options = options || {};
    const beta1 = options.beta1 === undefined ? 0.9 : options.beta1;
    const beta2 = options.beta2 === undefined ? 0.999 : options.beta2;
    const eps = options.eps === undefined ? 1e-8 : options.eps;
    if (!Number.isFinite(beta1) || beta1 < 0 || beta1 >= 1) throw new RangeError('beta1 must be in [0, 1)');
    if (!Number.isFinite(beta2) || beta2 < 0 || beta2 >= 1) throw new RangeError('beta2 must be in [0, 1)');
    if (!Number.isFinite(eps) || eps <= 0) throw new RangeError('eps must be finite and positive');
    const first = new Array(net.params.length);
    const second = new Array(net.params.length);
    for (let i = 0; i < net.params.length; i++) {
      first[i] = new Float32Array(net.params[i].length);
      second[i] = new Float32Array(net.params[i].length);
    }
    let step = 0;
    return {
      step() {
        clipGradients(net, opts.clipNorm);
        step++;
        const correction1 = 1 - Math.pow(beta1, step);
        const correction2 = 1 - Math.pow(beta2, step);
        for (let p = 0; p < net.params.length; p++) {
          const params = net.params[p];
          const grads = net.grads[p];
          const m = first[p];
          const v = second[p];
          for (let i = 0; i < params.length; i++) {
            const g = grads[i];
            const mi = m[i] = beta1 * m[i] + (1 - beta1) * g;
            const vi = v[i] = beta2 * v[i] + (1 - beta2) * g * g;
            params[i] -= opts.lr * (mi / correction1) / (Math.sqrt(vi / correction2) + eps);
          }
        }
        net.zeroGrad();
      },
    };
  }

  function sgd(net, options) {
    const opts = optimizerOptions(options, 1e-2);
    return {
      step() {
        clipGradients(net, opts.clipNorm);
        for (let p = 0; p < net.params.length; p++) {
          const params = net.params[p];
          const grads = net.grads[p];
          for (let i = 0; i < params.length; i++) params[i] -= opts.lr * grads[i];
        }
        net.zeroGrad();
      },
    };
  }

  RLA.nn = { mlp, adam, sgd };
  if (typeof module === 'object' && module.exports) module.exports = RLA.nn;
})();
