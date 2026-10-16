(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // A 2-link arm in a vertical plane, driven like hobby-arm servos (for example the SO-101): each action is a joint-speed command in [-1, 1]
  // (times VMAX rad/s). Each joint follows its command with a first-order lag (time constant TAU0). The servos hold
  // the arm's own weight. A payload in the gripper pulls the tip down: its torque J^T (0, -m) makes each joint sag
  // at SAG rad/s per N m, so a proportional controller settles below the target. It also makes the servos a little
  // slower. The payload can arrive mid-episode (kitting).
  // Task: put the tip on a random target and hold it there. Reward per step: -(distance) - 0.01 |a|^2.
  const L1 = 0.5, L2 = 0.5, DT = 0.05, VMAX = 2, TAU0 = 0.08, Q2MAX = 2.8, SAG = 0.4;
  const knobs = [
    { key: 'maxSteps', label: 'Time limit (steps)', min: 30, max: 100, step: 10, default: 50, help: 'Steps per episode (0.05 s each).' },
    { key: 'payload', label: 'Payload (kg)', min: 0, max: 3, step: 0.25, default: 0, help: 'Mass in the gripper. Its weight pulls the arm down, and the servos get a little slower.' },
    { key: 'pickAt', label: 'Payload arrives at step', min: 0, max: 40, step: 5, default: 0, help: '0: from the start. Later: the arm picks up the part in the middle of the move, like kitting.' },
    { key: 'latency', label: 'Command latency (steps)', min: 0, max: 4, step: 1, default: 0, help: 'Each command reaches the servos this many steps late, like a slow USB or camera loop.' },
    { key: 'obsNoise', label: 'Sensor noise', min: 0, max: 0.1, step: 0.01, default: 0, help: 'Gaussian noise on each observation.' },
    { key: 'gain', label: 'Classical controller gain', min: 2, max: 12, step: 1, default: 12, help: 'The gain k of the classical controller a = k J^T (target − tip). A low gain is smooth and slow, like a low P gain on a servo.' },
  ];
  const wrap = (x) => ((((x + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const clip1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

  // Classical controller: Jacobian transpose. It turns the tip error into joint-speed commands, a = k J^T (target - tip).
  // It reads only the observation (cos and sin of the joints, tip minus target), so it is a smooth function of it.
  // Measured over 200 starts (Simulation): final distance 0.012 m without payload, 0.062 m with a 2 kg payload at step 15.
  function base(o, k) {
    k = k || 12;
    const c1 = o[0], s1 = o[1], c2 = o[2], s2 = o[3], c12 = c1 * c2 - s1 * s2, s12 = s1 * c2 + c1 * s2, ex = -o[6], ey = -o[7];
    const g1 = (-L1 * s1 - L2 * s12) * ex + (L1 * c1 + L2 * c12) * ey, g2 = -L2 * s12 * ex + L2 * c12 * ey;
    return Float32Array.of(clip1(k * g1), clip1(k * g2));
  }

  function make(k, rng) {
    const maxSteps = k.maxSteps | 0, lat = k.latency | 0;
    const spec = { name: 'reach', obsDim: 11, nActions: 0, actDim: 2, continuous: true, maxSteps, gamma: 0.97 };
    const q = new Float64Array(2), dq = new Float64Array(2), tgt = new Float64Array(2);
    let t = 0, over = true, holding = 0, start = null, queue = [], lastA = [0, 0];
    const tip = () => [L1 * Math.cos(q[0]) + L2 * Math.cos(q[0] + q[1]), L1 * Math.sin(q[0]) + L2 * Math.sin(q[0] + q[1])];
    function obs() {
      const n = k.obsNoise > 0 ? () => k.obsNoise * rng.normal() : () => 0;
      const [ex, ey] = tip();
      return Float32Array.of(Math.cos(q[0]) + n(), Math.sin(q[0]) + n(), Math.cos(q[1]) + n(), Math.sin(q[1]) + n(),
        dq[0] / VMAX + n(), dq[1] / VMAX + n(), ex - tgt[0] + n(), ey - tgt[1] + n(), tgt[0], tgt[1], holding);
    }
    function reset(prompt) {
      if (prompt) { q[0] = prompt[0]; q[1] = prompt[1]; tgt[0] = prompt[2]; tgt[1] = prompt[3]; }
      else {
        q[0] = rng.uniform(-Math.PI, Math.PI); q[1] = rng.uniform(0.3, 2.4) * (rng.next() < 0.5 ? -1 : 1);
        const r = rng.uniform(0.3, 0.95), a = rng.uniform(-Math.PI, Math.PI);
        tgt[0] = r * Math.cos(a); tgt[1] = r * Math.sin(a);
      }
      dq[0] = dq[1] = 0; t = 0; over = false; holding = k.pickAt > 0 ? 0 : (k.payload > 0 ? 1 : 0);
      start = [q[0], q[1], tgt[0], tgt[1]];
      queue = []; for (let i = 0; i < lat; i++) queue.push([0, 0]);
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      const cmd = [clip1(+a[0]), clip1(+a[1])];
      queue.push(cmd);
      const applied = queue.shift();
      if (k.pickAt > 0 && t === (k.pickAt | 0) && k.payload > 0) holding = 1;
      const m = holding ? k.payload : 0;
      const tau = TAU0 * (1 + m), vs = VMAX / (1 + 0.2 * m), f = Math.min(1, DT / tau);
      // gravity torque of the payload at each joint: J^T (0, -m); joint 1 sees both links' lever arms
      const c1 = Math.cos(q[0]), c12 = Math.cos(q[0] + q[1]);
      const g1 = -m * (L1 * c1 + L2 * c12), g2 = -m * L2 * c12;
      const sag = [SAG * g1, SAG * g2];
      for (let i = 0; i < 2; i++) { dq[i] += (applied[i] * vs + sag[i] - dq[i]) * f; q[i] += dq[i] * DT; }
      q[0] = wrap(q[0]);
      if (q[1] > Q2MAX) { q[1] = Q2MAX; dq[1] = 0; } else if (q[1] < -Q2MAX) { q[1] = -Q2MAX; dq[1] = 0; }
      const [ex, ey] = tip();
      const dist = Math.hypot(ex - tgt[0], ey - tgt[1]);
      t++; lastA = cmd;
      const truncated = t >= maxSteps;
      over = truncated;
      return { obs: obs(), reward: -dist - 0.01 * (cmd[0] * cmd[0] + cmd[1] * cmd[1]), done: false, truncated, info: { dist, holding } };
    }
    function render(ctx, W, H, colors, overlay) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33' }, colors || {});
      ctx.clearRect(0, 0, W, H);
      const s = Math.min(W, H) * 0.45, cx = W / 2, cy = H / 2;
      const P = (x, y) => [cx + x * s, cy - y * s];
      ctx.strokeStyle = c.muted; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (overlay && overlay.trail) {
        ctx.strokeStyle = c.muted; ctx.beginPath();
        overlay.trail.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      }
      const [tx, ty] = P(tgt[0], tgt[1]);
      ctx.strokeStyle = c.bad; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 7, 0, 7); ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty); ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10); ctx.stroke();
      const e1 = P(L1 * Math.cos(q[0]), L1 * Math.sin(q[0])), e2 = P(...tip());
      ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(5, s * 0.06); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = c.fg; for (const p of [[cx, cy], e1]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); }
      if (holding) { ctx.fillStyle = c.bad; ctx.fillRect(e2[0] - 6, e2[1] - 6, 12, 12); }
      if (overlay && overlay.text) { ctx.fillStyle = c.muted; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(overlay.text, 8, 8); }
    }
    return {
      spec, reset, step, render,
      prompt: () => start.slice(),
      tip,
      expertStart: () => ({}),
      expert: (o) => base(o),
      base: (o) => base(o, k.gain),
      getState: () => [q[0], q[1], dq[0], dq[1], tgt[0], tgt[1], holding],
      setState: (s) => { q[0] = s[0]; q[1] = s[1]; dq[0] = s[2]; dq[1] = s[3]; tgt[0] = s[4]; tgt[1] = s[5]; holding = s[6] || 0; over = false; },
    };
  }

  RLA.worlds.reach = {
    make, knobs, base, evalHorizon: 50, evalEpisodes: 10,
    info: {
      title: 'Arm reach',
      teaches: 'A 2-joint arm with servo-like speed commands, lag and payload: continuous control close to the SO-101, with a strong classical controller to beat.',
      cannotTeach: 'Gravity, contact, backlash, a third dimension, or camera images.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.reach;
})();
