(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  function knobValue(knobs, key, fallback, min, max, integer) {
    const value = knobs[key] === undefined ? fallback : knobs[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new RangeError(`Invalid bandit knob ${key}: ${value}`);
    }
    return value;
  }

  function make(knobs, rng) {
    knobs = knobs || {};
    if (!rng || typeof rng.normal !== 'function') { throw new TypeError('bandit requires an RNG with normal()'); }

    const arms = knobValue(knobs, 'arms', 10, 2, 20, true);
    const noise = knobValue(knobs, 'noise', 1, 0, 3, false);
    const drift = knobValue(knobs, 'drift', 0, 0, 0.1, false);
    const means = new Float64Array(arms);
    for (let i = 0; i < arms; i++) { means[i] = rng.normal(); }

    const spec = { name: 'bandit', obsDim: 1, nActions: arms, maxSteps: 1, gamma: 0, nStates: 1 };
    let lastAction = -1;

    function bestArm() {
      let best = 0;
      for (let i = 1; i < arms; i++) {
        if (means[i] > means[best]) { best = i; }
      }
      return best;
    }

    function reset() {
      lastAction = -1;
      return new Float32Array([1]);
    }

    function step(action) {
      if (!Number.isInteger(action) || action < 0 || action >= arms) {
        throw new RangeError(`Invalid bandit action: ${action}`);
      }
      lastAction = action;
      const best = bestArm();
      const regret = means[best] - means[action];
      const reward = means[action] + (noise === 0 ? 0 : noise * rng.normal());
      if (drift !== 0) {
        for (let i = 0; i < arms; i++) { means[i] += drift * rng.normal(); }
      }
      return {
        obs: new Float32Array([1]),
        reward,
        done: true,
        truncated: false,
        info: { optimal: action === best, regret },
      };
    }

    function render(ctx, width, height, colors) {
      const palette = colors || {};
      const background = palette.background || palette.bg || '#ffffff';
      const bar = palette.bar || palette.primary || '#4f46e5';
      const selected = palette.selected || palette.accent || '#f97316';
      const axis = palette.axis || palette.grid || '#64748b';
      const baseline = height / 2;
      const padding = Math.min(8, height / 8);
      let maxAbs = 0;
      for (let i = 0; i < arms; i++) { maxAbs = Math.max(maxAbs, Math.abs(means[i])); }
      maxAbs = maxAbs || 1;

      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = axis;
      ctx.beginPath();
      ctx.moveTo(0, baseline);
      ctx.lineTo(width, baseline);
      ctx.stroke();

      const slot = width / arms;
      const barWidth = slot * 0.68;
      const scale = Math.max(0, baseline - padding) / maxAbs;
      for (let i = 0; i < arms; i++) {
        const barHeight = Math.abs(means[i]) * scale;
        const x = i * slot + (slot - barWidth) / 2;
        const y = means[i] >= 0 ? baseline - barHeight : baseline;
        ctx.fillStyle = i === lastAction ? selected : bar;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    }

    return { spec, means, bestArm, reset, step, stateIndex: () => 0, render };
  }

  RLA.worlds.bandit = {
    make,
    knobs: [
      { key: 'arms', label: 'Arms', min: 2, max: 20, step: 1, default: 10, help: 'Number of actions in the bandit.' },
      { key: 'noise', label: 'Reward noise', min: 0, max: 3, step: 0.1, default: 1, help: 'Standard deviation of reward noise.' },
      { key: 'drift', label: 'Mean drift', min: 0, max: 0.1, step: 0.01, default: 0, help: 'Standard deviation of each arm mean random-walk step.' },
    ],
    info: {
      title: 'The 10-armed bandit.',
      teaches: 'It shows how exploration and reward noise affect action selection.',
      cannotTeach: 'It cannot teach multi-step planning or state-dependent policies.',
    },
  };
  if (typeof module === 'object' && module.exports) { module.exports = RLA.worlds.bandit; }
})();
