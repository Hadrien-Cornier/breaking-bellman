(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // A point robot must go from the bottom to the goal at the top. A round obstacle sits in the middle, so there are
  // two good routes: around the left or around the right. Demonstrations use both, which makes the data two-modal.
  // Action: a velocity (vx, vy) in [-1, 1]^2, times SPEED per step. Touching the obstacle blocks the move (a crash).
  // Reward per step: -0.05 * distance to goal, -0.5 for each crash; +1 and the episode ends at the goal.
  // Optional mud beside the obstacle on the left (knob 'mud'): an extra cost per step there. The demonstrator ignores it.
  const SPEED = 0.1, R_OBS = 0.5, GOAL = [0, 0.8], GOAL_R = 0.08;
  const knobs = [
    { key: 'maxSteps', label: 'Time limit (steps)', min: 20, max: 60, step: 5, default: 40, help: 'Steps per episode.' },
    { key: 'obstacle', label: 'Obstacle radius', min: 0.1, max: 0.6, step: 0.05, default: R_OBS, help: 'A wider obstacle makes the two routes more different.' },
    { key: 'spread', label: 'Start spread', min: 0, max: 0.4, step: 0.05, default: 0, help: 'Starts are spread this far left and right of the home pose (and twice this far up and down). 0: every episode starts at the home pose.' },
    { key: 'actionNoise', label: 'Actuator noise', min: 0, max: 0.5, step: 0.05, default: 0, help: 'Gaussian noise added to each velocity command.' },
    { key: 'mud', label: 'Mud on the left (cost per step)', min: 0, max: 0.3, step: 0.05, default: 0, help: 'An extra cost for each step in the mud beside the obstacle on the left. The demonstrator still goes left half of the time.' },
  ];
  const clip1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);
  const inMud = (x, y) => x < -0.2 && Math.abs(y) < 0.6;

  // Scripted demonstrator: around the obstacle on one side (side = -1 left, +1 right), then to the goal.
  // Two waypoints beside the obstacle keep the route at least 0.12 from its edge. (An earlier single waypoint skimmed the edge,
  // so the demonstrator itself crashed in about 1 episode in 8 and copies failed from imprecision, not from averaging.)
  function demo(o, side, rng, noise, ro) {
    ro = ro || R_OBS;
    const x = o[0], y = o[1];
    const wx = side * (ro + 0.25), wy = Math.min(1.1 * ro, 0.6);
    const [tx, ty] = y < -wy - 0.05 && side * x < ro + 0.2 ? [wx, -wy] : y < wy - 0.05 ? [wx, wy] : GOAL;
    let vx = tx - x, vy = ty - y; const n = Math.hypot(vx, vy) || 1;
    vx = vx / n; vy = vy / n;
    if (rng && noise) { vx += noise * rng.normal(); vy += noise * rng.normal(); }
    return Float32Array.of(clip1(vx), clip1(vy));
  }

  function make(k, rng) {
    const maxSteps = k.maxSteps | 0, ro = k.obstacle;
    const spec = { name: 'fork', obsDim: 4, nActions: 0, actDim: 2, continuous: true, maxSteps, gamma: 0.97 };
    const p = new Float64Array(2);
    let t = 0, over = true, start = null, crashes = 0, trail = [], nDemos = 0;
    const obs = () => Float32Array.of(p[0], p[1], GOAL[0] - p[0], GOAL[1] - p[1]);
    function reset(prompt) {
      if (prompt) { p[0] = prompt[0]; p[1] = prompt[1]; }
      else { const sp = k.spread === undefined ? 0 : k.spread; p[0] = rng.uniform(-sp, sp); p[1] = -0.8 + rng.uniform(-2 * sp, 2 * sp); }
      start = [p[0], p[1]]; t = 0; over = false; crashes = 0; trail = [[p[0], p[1]]];
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      let vx = clip1(+a[0]), vy = clip1(+a[1]);
      if (k.actionNoise > 0) { vx = clip1(vx + k.actionNoise * rng.normal()); vy = clip1(vy + k.actionNoise * rng.normal()); }
      const nx = Math.max(-1, Math.min(1, p[0] + SPEED * vx)), ny = Math.max(-1, Math.min(1, p[1] + SPEED * vy));
      let crash = false;
      if (Math.hypot(nx, ny) < ro) crash = true; else { p[0] = nx; p[1] = ny; }
      if (crash) crashes++;
      trail.push([p[0], p[1]]);
      const d = Math.hypot(GOAL[0] - p[0], GOAL[1] - p[1]);
      const mud = k.mud > 0 && inMud(p[0], p[1]) ? k.mud : 0;
      t++;
      const done = d < GOAL_R, truncated = !done && t >= maxSteps;
      over = done || truncated;
      return { obs: obs(), reward: -0.05 * d - (crash ? 0.5 : 0) - mud + (done ? 1 : 0), done, truncated, info: { crash, success: done, side: p[0] < 0 ? -1 : 1, mud: mud > 0 } };
    }
    function render(ctx, W, H, colors, overlay) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33' }, colors || {});
      ctx.clearRect(0, 0, W, H);
      const s = Math.min(W, H) * 0.46, cx = W / 2, cy = H / 2, P = (x, y) => [cx + x * s, cy - y * s];
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.strokeRect(cx - s, cy - s, 2 * s, 2 * s);
      if (k.mud > 0) { const [mx, my] = P(-1, 0.6); ctx.fillStyle = '#a0784a'; ctx.globalAlpha = 0.25; ctx.fillRect(mx, my, (1 - 0.2) * s, 1.2 * s); ctx.globalAlpha = 1; }
      ctx.fillStyle = c.muted; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(cx, cy, ro * s, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      const [gx, gy] = P(GOAL[0], GOAL[1]);
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, GOAL_R * s, 0, 7); ctx.stroke();
      const paths = (overlay && overlay.paths) || [trail];
      ctx.lineWidth = 1.5;
      for (const path of paths) {
        ctx.strokeStyle = c.fg; ctx.globalAlpha = paths.length > 1 ? 0.5 : 1; ctx.beginPath();
        path.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const [px, py] = P(p[0], p[1]); ctx.fillStyle = c.bad; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
      if (overlay && overlay.text) { ctx.fillStyle = c.muted; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(overlay.text, 8, 8); }
    }
    return {
      spec, reset, step, render,
      prompt: () => start.slice(),
      trail: () => trail.map((x) => x.slice()),
      // the demonstrator for datasets: it alternates left and right, so the data has two answers in equal numbers
      expertStart: () => ({ side: (nDemos++ % 2) ? 1 : -1 }),
      expert: (o, ctx) => demo(o, ctx.side, null, 0, ro),
      getState: () => [p[0], p[1]],
      setState: (s) => { p[0] = s[0]; p[1] = s[1]; over = false; },
    };
  }

  RLA.worlds.fork = {
    make, knobs, demo, evalHorizon: 40, evalEpisodes: 10,
    info: {
      title: 'Fork in the road',
      teaches: 'Data with two good answers (left or right of the obstacle): an average of the two answers crashes.',
      cannotTeach: 'Joint dynamics, contact forces, or images.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.fork;
})();
