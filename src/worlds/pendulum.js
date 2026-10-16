(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // Gym Pendulum-v1: swing a pole up from any angle with a weak motor, then hold it up.
  // th'' = 3g/(2l) sin th + 3/(m l^2) u, Euler step dt = 0.05, speed clipped to 8 rad/s, angle 0 = up.
  // Reward -(th^2 + 0.1 th'^2 + 0.001 u^2) per step. Action: one number in [-1, 1], times maxTorque.
  const G = 10, L = 1, DT = 0.05, MAX_SPEED = 8;
  const knobs = [
    { key: 'maxSteps', label: 'Time limit (steps)', min: 100, max: 400, step: 50, default: 200, help: 'Steps per episode (0.05 s each).' },
    { key: 'maxTorque', label: 'Motor torque limit', min: 0.5, max: 4, step: 0.25, default: 2, help: 'Below about 6, the motor cannot lift the pole straight up: it must swing.' },
    { key: 'mass', label: 'Pole mass (payload)', min: 0.5, max: 3, step: 0.25, default: 1, help: 'A heavier pole needs more torque. Like a payload in the gripper.' },
    { key: 'obsNoise', label: 'Sensor noise', min: 0, max: 0.3, step: 0.05, default: 0, help: 'Gaussian noise on each observation, like a noisy encoder.' },
    { key: 'actionNoise', label: 'Actuator noise', min: 0, max: 0.5, step: 0.05, default: 0, help: 'Gaussian noise added to the commanded torque (as a share of the limit).' },
  ];
  const norm = (x) => ((((x + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

  function make(k, rng) {
    const maxSteps = k.maxSteps | 0;
    const spec = { name: 'pendulum', obsDim: 3, nActions: 0, actDim: 1, continuous: true, maxSteps, gamma: 0.99 };
    let th = 0, thd = 0, t = 0, over = true, lastU = 0, start = null;
    function obs() {
      const n = k.obsNoise > 0 ? () => k.obsNoise * rng.normal() : () => 0;
      return Float32Array.of(Math.cos(th) + n(), Math.sin(th) + n(), thd / MAX_SPEED + n());
    }
    function reset(prompt) {
      if (prompt) { th = prompt[0]; thd = prompt[1]; }
      else { th = rng.uniform(-Math.PI, Math.PI); thd = rng.uniform(-1, 1); }
      start = [th, thd]; t = 0; over = false; lastU = 0;
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      let cmd = Math.max(-1, Math.min(1, +a[0]));
      if (k.actionNoise > 0) cmd = Math.max(-1, Math.min(1, cmd + k.actionNoise * rng.normal()));
      const u = cmd * k.maxTorque;
      const cost = norm(th) * norm(th) + 0.1 * thd * thd + 0.001 * u * u;
      thd = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, thd + (3 * G / (2 * L) * Math.sin(th) + 3 / (k.mass * L * L) * u) * DT));
      th = th + thd * DT;
      t++; lastU = cmd;
      const truncated = t >= maxSteps;
      over = truncated;
      return { obs: obs(), reward: -cost, done: false, truncated, info: { upright: Math.abs(norm(th)) < 0.3 } };
    }
    function render(ctx, W, H, colors, overlay) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33' }, colors || {});
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.55, r = Math.min(W, H) * 0.38;
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - r - 8); ctx.stroke();
      const x = cx + r * Math.sin(th), y = cy - r * Math.cos(th);
      ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(5, r * 0.08); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = c.fg; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
      // torque arrow
      if (lastU) {
        ctx.strokeStyle = c.bad; ctx.lineWidth = 3; ctx.beginPath();
        ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + lastU * 2.5, lastU < 0); ctx.stroke();
      }
      if (overlay && overlay.text) { ctx.fillStyle = c.muted; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(overlay.text, 8, 8); }
    }
    return {
      spec, reset, step, render,
      prompt: () => start.slice(),
      getState: () => [th, thd, lastU],
      setState: (s) => { th = s[0]; thd = s[1]; lastU = s[2] || 0; over = false; },
    };
  }

  RLA.worlds.pendulum = {
    make, knobs, evalHorizon: 200, evalEpisodes: 4,
    info: {
      title: 'Pendulum swing-up',
      teaches: 'Continuous torque control: the motor is too weak to lift the pole, so the learner must swing it up, then balance it.',
      cannotTeach: 'Several joints, contact, servo lag, or camera images.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.pendulum;
})();
