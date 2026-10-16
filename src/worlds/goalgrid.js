(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // Each episode gives a new "prompt": a start cell and a goal cell on an N x N grid. The learner moves up, right,
  // down or left. Reward 1 only when it reaches the goal (a pass/fail answer, like a checked math answer), else 0.
  // An optional wall with one gap forces a detour. Observation: goal offset, own position (both / N), the gap row.
  const knobs = [
    { key: 'size', label: 'Grid size', min: 5, max: 11, step: 1, default: 7, help: 'Cells per side.' },
    { key: 'maxSteps', label: 'Time limit (steps)', min: 6, max: 40, step: 2, default: 14, help: 'Moves per attempt. A short limit makes far goals hard.' },
    { key: 'wall', label: 'Wall with one gap', min: 0, max: 1, step: 1, default: 0, help: '1: a wall splits the grid; the only way across is one gap.' },
    { key: 'slip', label: 'Slip', min: 0, max: 0.3, step: 0.05, default: 0, help: 'Probability that a move goes in a random direction.' },
  ];
  const MOVES = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  function make(k, rng) {
    const N = k.size | 0, maxSteps = k.maxSteps | 0, wallX = Math.floor(N / 2), gapY = Math.floor(N / 2);
    const spec = { name: 'goalgrid', obsDim: 5, nActions: 4, maxSteps, gamma: 1 };
    const isWall = (x, y) => k.wall > 0 && x === wallX && y !== gapY;
    let x = 0, y = 0, gx = 0, gy = 0, t = 0, over = true, start = null, trail = [];
    const obs = () => Float32Array.of((gx - x) / N, (gy - y) / N, x / N, y / N, k.wall > 0 ? (gapY - y) / N : 0);
    function freeCell() { for (;;) { const a = rng.int(N), b = rng.int(N); if (!isWall(a, b)) return [a, b]; } }
    function reset(prompt) {
      if (prompt) [x, y, gx, gy] = prompt;
      else { [x, y] = freeCell(); do { [gx, gy] = freeCell(); } while (gx === x && gy === y); }
      start = [x, y, gx, gy]; t = 0; over = false; trail = [[x, y]];
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      const m = k.slip > 0 && rng.next() < k.slip ? rng.int(4) : a;
      const nx = x + MOVES[m][0], ny = y + MOVES[m][1];
      if (nx >= 0 && ny >= 0 && nx < N && ny < N && !isWall(nx, ny)) { x = nx; y = ny; }
      trail.push([x, y]); t++;
      const done = x === gx && y === gy, truncated = !done && t >= maxSteps;
      over = done || truncated;
      return { obs: obs(), reward: done ? 1 : 0, done, truncated, info: { success: done } };
    }
    function render(ctx, W, H, colors, overlay) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33' }, colors || {});
      ctx.clearRect(0, 0, W, H);
      const cs = Math.min(W, H) * 0.9 / N, ox = (W - cs * N) / 2, oy = (H - cs * N) / 2;
      const P = (cx, cy) => [ox + (cx + 0.5) * cs, oy + (N - cy - 0.5) * cs];
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1;
      for (let i = 0; i <= N; i++) { ctx.beginPath(); ctx.moveTo(ox + i * cs, oy); ctx.lineTo(ox + i * cs, oy + N * cs); ctx.moveTo(ox, oy + i * cs); ctx.lineTo(ox + N * cs, oy + i * cs); ctx.stroke(); }
      ctx.fillStyle = c.fg;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (isWall(i, j)) { const [px, py] = P(i, j); ctx.fillRect(px - cs / 2, py - cs / 2, cs, cs); }
      const [gpx, gpy] = P(gx, gy); ctx.strokeStyle = c.accent; ctx.lineWidth = 3; ctx.strokeRect(gpx - cs * 0.35, gpy - cs * 0.35, cs * 0.7, cs * 0.7);
      ctx.strokeStyle = c.bad; ctx.lineWidth = 2; ctx.beginPath();
      trail.forEach(([a, b], i) => { const [px, py] = P(a, b); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      const [px, py] = P(x, y); ctx.fillStyle = c.bad; ctx.beginPath(); ctx.arc(px, py, cs * 0.22, 0, 7); ctx.fill();
      if (overlay && overlay.text) { ctx.fillStyle = c.muted; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(overlay.text, 8, 8); }
    }
    return {
      spec, reset, step, render,
      prompt: () => start.slice(),
      getState: () => [x, y, gx, gy],
      setState: (s) => { if (s[2] !== gx || s[3] !== gy || !trail.length) trail = []; [x, y, gx, gy] = s; trail.push([x, y]); over = false; },
    };
  }

  RLA.worlds.goalgrid = {
    make, knobs, evalHorizon: 40, evalEpisodes: 20,
    info: {
      title: 'Goal grid',
      teaches: 'Pass/fail rewards on many different prompts, like checked answers in LLM training: a whole attempt gets one score at the end.',
      cannotTeach: 'Long reasoning chains, language, or continuous motion.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.goalgrid;
})();
