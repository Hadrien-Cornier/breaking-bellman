(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // Maximization bias (Sutton and Barto 2018, Example 6.7). State A: "right" ends the episode
  // with reward 0; "left" goes to state B with reward 0. In B every action ends the episode with
  // a reward drawn from N(mean, noise^2). With mean -0.1, "left" is worse on average, but the max
  // over many noisy estimates in B looks positive.
  const knobs = [
    { key: 'machines', label: 'Machines behind the left door', min: 1, max: 20, step: 1, default: 10, help: 'Actions in state B. More actions give more chances for a lucky estimate.' },
    { key: 'noise', label: 'Payout noise', min: 0, max: 2, step: 0.1, default: 1, help: 'Standard deviation of each B payout.' },
    { key: 'mean', label: 'Mean payout behind the door', min: -0.5, max: 0.5, step: 0.05, default: -0.1, help: 'True mean of every B payout. Below 0, the left door is a bad deal.' },
    { key: 'maxSteps', label: 'Time limit (steps)', min: 2, max: 2, step: 1, default: 2, help: 'An episode has at most two steps.' },
  ];

  // The episode is 1 or 2 steps long, and the level 6 goal measures the first few hundred episodes.
  // The default learnStart of 500 stored rows lands past that window (about 250-500 episodes here),
  // so a sentence with memory never starts to learn inside the measured stretch. 50 rows is about
  // 30 episodes on this world, well before the window.
  const hyper = { learnStart: 50 };

  function make(k, rng) {
    const nB = Math.max(1, k.machines | 0);
    const A = Math.max(2, nB);
    let st = 0, over = true, t = 0; // 0 = A, 1 = B
    const spec = { name: 'mirage', obsDim: 2, nActions: A, maxSteps: 2, gamma: 1, nStates: 2 };
    const obs = () => Float32Array.from(st === 0 ? [1, 0] : [0, 1]);
    let lastLeft = false;
    return {
      spec,
      hyper,
      reset() { st = 0; over = false; t = 0; return obs(); },
      // number of valid actions in this state: actions 0..n-1
      validActions(o) { return o[0] > 0.5 ? 2 : nB; },
      step(a) {
        if (over) throw new Error('step() after the episode ended; call reset()');
        t++;
        if (st === 0) {
          if (a === 0) { over = true; lastLeft = false; return { obs: obs(), reward: 0, done: true, truncated: false, info: { left: false } }; }
          st = 1; lastLeft = true;
          return { obs: obs(), reward: 0, done: false, truncated: false, info: { left: true } };
        }
        over = true;
        return { obs: obs(), reward: k.mean + k.noise * rng.normal(), done: true, truncated: false, info: { left: true } };
      },
      stateIndex(o) { return o[0] > 0.5 ? 0 : 1; },
      render(ctx, W, H, colors, overlay) {
        const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33' }, colors || {});
        ctx.clearRect(0, 0, W, H);
        const r = Math.min(W, H) * 0.12, yA = H * 0.5, xA = W * 0.5, xB = W * 0.18, xT = W * 0.82;
        ctx.lineWidth = 2; ctx.strokeStyle = c.muted; ctx.fillStyle = c.fg;
        ctx.font = Math.round(r * 0.6) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const node = (x, y, label, on) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.strokeStyle = on ? c.accent : c.muted; ctx.stroke(); ctx.fillStyle = c.fg; ctx.fillText(label, x, y); };
        ctx.strokeStyle = c.muted; ctx.beginPath(); ctx.moveTo(xA - r, yA); ctx.lineTo(xB + r, yA); ctx.moveTo(xA + r, yA); ctx.lineTo(xT - r * 0.6, yA); ctx.stroke();
        node(xA, yA, 'A', st === 0 && !over); node(xB, yA, 'B', st === 1 || lastLeft);
        ctx.fillStyle = c.fg; ctx.fillRect(xT - r * 0.6, yA - r * 0.6, r * 1.2, r * 1.2);
        ctx.font = Math.round(r * 0.42) + 'px sans-serif';
        ctx.fillStyle = c.muted; ctx.fillText('left door', (xA + xB) / 2, yA - r * 0.7); ctx.fillText('right: end, reward 0', (xA + xT) / 2, yA - r * 0.7);
        for (let i = 0; i < nB; i++) {
          const ang = Math.PI * (0.6 + 0.8 * (nB === 1 ? 0.5 : i / (nB - 1)));
          const x2 = xB + Math.cos(ang) * r * 2.4, y2 = yA + Math.sin(ang) * r * 2.4 * (H / W > 0.5 ? 1 : 0.9);
          ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xB + Math.cos(ang) * r, yA + Math.sin(ang) * r); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.fillStyle = overlay && overlay.bq ? (overlay.bq[i] > 0 ? c.accent : c.bad) : c.muted;
          ctx.beginPath(); ctx.arc(x2, y2, 3.5, 0, 7); ctx.fill();
        }
        if (overlay && overlay.text) { ctx.fillStyle = c.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(overlay.text, 8, 8); }
      },
    };
  }

  RLA.worlds.mirage = {
    make, knobs, hyper,
    info: {
      title: 'The mirage',
      teaches: 'Maximization bias: the max of many noisy estimates is too high, so a learner chases a door that loses on average.',
      cannotTeach: 'How large the bias is in a big network on a long task; that needs measurement on the real task.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.mirage;
})();
