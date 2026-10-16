(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // Gym CartPole-v1 dynamics (Barto, Sutton and Anderson 1983 equations, Euler step), plus sabotage knobs.
  const G = 9.8, MC = 1.0, MP = 0.1, TAU = 0.02, THETA_MAX = 12 * 2 * Math.PI / 360, X_MAX = 2.4;
  const SCALE = [2.4, 3.0, THETA_MAX, 3.5];

  const knobs = [
    { key: 'maxSteps', label: 'Time limit (steps)', min: 50, max: 1000, step: 50, default: 200, help: 'The episode stops here even if the pole is still up.' },
    { key: 'poleScale', label: 'Pole length', min: 0.5, max: 2, step: 0.1, default: 1, help: 'Multiplies the pole length. A short pole falls faster.' },
    { key: 'forceMag', label: 'Motor force (N)', min: 2, max: 20, step: 1, default: 10, help: 'The push of each action. A weak motor cannot catch a falling pole.' },
    { key: 'obsNoise', label: 'Sensor noise', min: 0, max: 0.5, step: 0.05, default: 0, help: 'Gaussian noise on each scaled observation, like a noisy encoder.' },
    { key: 'actionNoise', label: 'Actuator slips', min: 0, max: 0.5, step: 0.05, default: 0, help: 'Probability that the motor does a random action instead of the chosen one.' },
    { key: 'rewardNoise', label: 'Reward noise', min: 0, max: 5, step: 0.25, default: 0, help: 'Gaussian noise added to each reward. The mean reward does not change.' },
    { key: 'sparseReward', label: 'Sparse reward', min: 0, max: 1, step: 1, default: 0, help: 'If 1, the only reward is +1 when the pole survives to the time limit.' },
    { key: 'actionCopies', label: 'Copies of each action', min: 1, max: 5, step: 1, default: 1, help: 'Duplicates left and right. Same physics, more actions to choose a maximum from.' },
    { key: 'bins', label: 'Table bins per sensor', min: 2, max: 12, step: 1, default: 6, help: 'How finely a table cuts each of the 4 sensors. Cells = bins to the power 4.' },
  ];

  function make(k, rng) {
    const maxSteps = k.maxSteps | 0, copies = k.actionCopies | 0 || 1, bins = k.bins | 0 || 6;
    const L = 0.5 * k.poleScale, PML = MP * L, TM = MC + MP;
    const s = new Float64Array(4);
    let t = 0, over = true;
    const spec = { name: 'cartpole', obsDim: 4, nActions: 2 * copies, maxSteps, gamma: 0.99, nStates: Math.pow(bins, 4) };

    function obs() {
      const o = new Float32Array(4);
      for (let i = 0; i < 4; i++) o[i] = s[i] / SCALE[i] + (k.obsNoise > 0 ? k.obsNoise * rng.normal() : 0);
      return o;
    }
    let start = null;
    function reset(prompt) {
      for (let i = 0; i < 4; i++) s[i] = prompt ? prompt[i] : rng.uniform(-0.05, 0.05);
      start = Array.from(s); t = 0; over = false;
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      if (k.actionNoise > 0 && rng.next() < k.actionNoise) a = rng.int(2 * copies);
      const force = a % 2 === 0 ? -k.forceMag : k.forceMag;
      const [x, xd, th, thd] = s;
      const c = Math.cos(th), sn = Math.sin(th);
      const temp = (force + PML * thd * thd * sn) / TM;
      const thacc = (G * sn - c * temp) / (L * (4 / 3 - MP * c * c / TM));
      const xacc = temp - PML * thacc * c / TM;
      s[0] = x + TAU * xd; s[1] = xd + TAU * xacc; s[2] = th + TAU * thd; s[3] = thd + TAU * thacc;
      t++;
      const done = s[0] < -X_MAX || s[0] > X_MAX || s[2] < -THETA_MAX || s[2] > THETA_MAX;
      const truncated = !done && t >= maxSteps;
      let reward = k.sparseReward ? (truncated ? 1 : 0) : 1;
      if (k.rewardNoise > 0) reward += k.rewardNoise * rng.normal();
      over = done || truncated;
      return { obs: obs(), reward, done, truncated, info: { state: Float64Array.from(s), t } };
    }
    const lim = [2.4, 3.0, THETA_MAX, 3.5];
    function stateIndex(o) {
      let idx = 0;
      for (let i = 0; i < 4; i++) {
        const v = Math.max(-1, Math.min(1, (o[i] * SCALE[i]) / lim[i]));
        idx = idx * bins + Math.min(bins - 1, Math.floor(((v + 1) / 2) * bins));
      }
      return idx;
    }
    function render(ctx, W, H, colors) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999' }, colors || {});
      const sc = W / (2 * X_MAX * 1.15), cx = W / 2 + s[0] * sc, ground = H * 0.78;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();
      for (const e of [-X_MAX, X_MAX]) { const xx = W / 2 + e * sc; ctx.beginPath(); ctx.moveTo(xx, ground - 8); ctx.lineTo(xx, ground + 8); ctx.stroke(); }
      const cw = 0.5 * sc, ch = 0.3 * sc * 0.6;
      ctx.fillStyle = c.fg; ctx.fillRect(cx - cw / 2, ground - ch, cw, ch);
      const pl = 2 * L * sc * 0.9;
      ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(4, sc * 0.08); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, ground - ch); ctx.lineTo(cx + pl * Math.sin(s[2]), ground - ch - pl * Math.cos(s[2])); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    return {
      spec, reset, step, stateIndex, render,
      prompt: () => start.slice(),
      getState: () => Float64Array.from(s),
      setState: (arr) => { for (let i = 0; i < 4; i++) s[i] = arr[i]; over = false; },
    };
  }

  RLA.worlds.cartpole = {
    make, knobs, evalHorizon: 600,
    info: {
      title: 'CartPole',
      teaches: 'Value learning with a network on a 4-number state, and how that learning becomes unstable.',
      cannotTeach: 'Real contact, motor delay, backlash, camera images, or continuous torques.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.cartpole;
})();
