(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  // Fetch: a dog on a square field must get a thrown stick. Inspired by Huggy, the dog of the Hugging Face Deep RL
  // course (https://huggingface.co/learn/deep-rl-course/unitbonus1/introduction). Huggy moves its legs with joint motors;
  // this dog only turns and walks, so the lesson is the reward, not the body.
  // The reward is built from parts the player can change, and two of them can be gamed on purpose:
  // "pay only for getting closer" (walk away and come back, forever) and "a bonus for facing the stick" (sit and stare).
  // Potential-based shaping (Ng, Harada and Russell 1999) pays gamma * Phi(s') - Phi(s) with Phi = -distance; along any
  // path its discounted sum is gamma^T * Phi(end) - Phi(start), so no loop can earn more than going straight there.
  const knobs = [
    { key: 'maxSteps', label: 'Time limit (steps)', min: 20, max: 120, step: 10, default: 60, help: 'Steps per throw.' },
    { key: 'throwMax', label: 'Throw length', min: 0.6, max: 1.7, step: 0.1, default: 1.2, help: 'How far the stick can fly.' },
    { key: 'found', label: 'Reward for the stick', min: 0, max: 2, step: 0.25, default: 1, help: 'Paid once, when the dog gets the stick.' },
    { key: 'timeCost', label: 'Cost per step', min: 0, max: 0.05, step: 0.005, default: 0.01, help: 'A small cost every step pushes the dog to hurry.' },
    { key: 'shaping', label: 'Getting-closer reward', min: 0, max: 2, step: 1, default: 0, help: '0 none, 1 pay only for getting closer, 2 potential-based (pays for closer, charges for farther).' },
    { key: 'closerW', label: 'Getting-closer weight', min: 0, max: 3, step: 0.25, default: 1, help: 'Size of the getting-closer reward.' },
    { key: 'facingW', label: 'Facing bonus', min: 0, max: 0.1, step: 0.01, default: 0, help: 'Paid every step the dog faces the stick.' },
    { key: 'spinCost', label: 'Turning cost', min: 0, max: 0.05, step: 0.005, default: 0, help: 'Charged for each turn.' },
    { key: 'bringBack', label: 'Bring it back', min: 0, max: 1, step: 1, default: 0, help: '1: the dog must also carry the stick back to you.' },
  ];
  const TAU = 2 * Math.PI, THROWER = [0, -0.9], REACH = 0.09, LIM = 0.97, SLIM = 0.92;
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function make(k, rng) {
    const maxSteps = k.maxSteps | 0, gamma = 0.97;
    const spec = { name: 'fetch', obsDim: 6, nActions: 4, maxSteps, gamma };
    let x = 0, y = 0, th = 0, sx = 0, sy = 0, carrying = false, t = 0, over = true, start = null, trail = [];
    const target = () => (carrying ? THROWER : [sx, sy]);
    const dist = () => { const [tx, ty] = target(); return Math.hypot(tx - x, ty - y); };
    const bearing = () => { const [tx, ty] = target(); return wrap(Math.atan2(ty - y, tx - x) - th); };
    const obs = () => { const b = bearing(); return Float32Array.of(Math.cos(b), Math.sin(b), dist() / 2, x, y, carrying ? 1 : 0); };
    function throwStick() {
      const ang = Math.PI * (0.15 + 0.7 * rng.next()), d = 0.5 + (k.throwMax - 0.5) * rng.next();
      sx = clamp(THROWER[0] + d * Math.cos(ang), -SLIM, SLIM); sy = clamp(THROWER[1] + d * Math.sin(ang), -SLIM, SLIM);
    }
    function reset(prompt) {
      if (prompt) [x, y, th, sx, sy] = prompt;
      else { x = -0.1 + 0.2 * rng.next(); y = -0.85 + 0.2 * rng.next(); th = -Math.PI + TAU * rng.next(); throwStick(); }
      start = [x, y, th, sx, sy]; carrying = false; t = 0; over = false; trail = [[x, y]];
      return obs();
    }
    function step(a) {
      if (over) throw new Error('step() after the episode ended; call reset()');
      const dPrev = dist();
      if (a === 1) th += 0.45; else if (a === 2) th -= 0.45;
      th = wrap(th);
      const v = a === 0 ? 0.07 : a === 3 ? 0 : 0.025;
      x = clamp(x + v * Math.cos(th), -LIM, LIM); y = clamp(y + v * Math.sin(th), -LIM, LIM);
      t++; trail.push([x, y]);
      const parts = { found: 0, time: -k.timeCost, closer: 0, facing: 0, spin: a === 1 || a === 2 ? -k.spinCost : 0 };
      const dNow = dist(); // to the target of this step (the stick, or the thrower when carrying)
      let done = false, picked = false;
      if (dNow < REACH) {
        if (k.bringBack > 0 && !carrying) { carrying = true; picked = true; parts.found = k.found * 0.5; }
        else { done = true; parts.found = k.found; }
      }
      if (k.shaping === 1) parts.closer = k.closerW * Math.max(0, dPrev - dNow);
      else if (k.shaping === 2) {
        // same target for both potentials within a step; Phi(terminal) = 0. After a pick-up the next step measures
        // dPrev to the thrower: the potential jumps once, like a new episode that starts at the stick.
        parts.closer = k.closerW * ((done ? 0 : gamma * -dNow) + dPrev);
      }
      if (k.facingW > 0 && !picked) parts.facing = k.facingW * Math.cos(bearing());
      if (carrying) { sx = x; sy = y; }
      const reward = parts.found + parts.time + parts.closer + parts.facing + parts.spin;
      const truncated = !done && t >= maxSteps;
      over = done || truncated;
      return { obs: obs(), reward, done, truncated, info: { success: done, parts, d: dist(), carrying } };
    }
    // the square field, below a 20-pixel line for the overlay text
    const fieldBox = (W, H) => { const S = Math.min(W, H - 20) * 0.94; return [S, (W - S) / 2, 20 + (H - 20 - S) / 2]; };
    function render(ctx, W, H, colors, overlay) {
      const c = Object.assign({ fg: '#333', accent: '#2a7', muted: '#999', bad: '#c33', bg: '#eee' }, colors || {});
      ctx.clearRect(0, 0, W, H);
      const [S, ox, oy] = fieldBox(W, H);
      const P = (px, py) => [ox + (px + 1) / 2 * S, oy + (1 - py) / 2 * S];
      const u = S / 2; // pixels per field unit
      // a park: rough lawn around a mowed square with a chalk line; a dark page gets a dusk park
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c.bg).trim());
      const dark = !!m && (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 < 100;
      const G = dark
        ? { lawn: '#2c4528', a: '#3a5e32', b: '#35572e', line: 'rgba(235,240,225,0.6)', tuft: '#243a20', trunk: '#4a3524', leaf: ['#284a26', '#30562d', '#3a6335'], path: 'rgba(240,240,220,0.7)', bench: '#5a4330' }
        : { lawn: '#a3cd7d', a: '#8dc365', b: '#81b859', line: 'rgba(255,255,255,0.9)', tuft: '#6c9f4a', trunk: '#7a5634', leaf: ['#5c9744', '#6aa84f', '#7fbb5e'], path: 'rgba(255,255,255,0.8)', bench: '#9a6b3f' };
      ctx.fillStyle = G.lawn; ctx.fillRect(0, 0, W, H);
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // fixed decoration, same every frame
      const tuft = (tx, ty, h) => { ctx.beginPath(); ctx.moveTo(tx - h * 0.5, ty - h); ctx.lineTo(tx, ty); ctx.lineTo(tx + h * 0.5, ty - h); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - h * 1.2); ctx.stroke(); };
      ctx.strokeStyle = G.tuft; ctx.lineWidth = Math.max(1, u * 0.008); ctx.lineCap = 'round';
      for (let i = 0; i < 40; i++) { const tx = rnd() * W, ty = 20 + rnd() * (H - 20); if (tx < ox - 4 || tx > ox + S + 4) tuft(tx, ty, u * 0.03); }
      // trees and a bench beside the field, when the stage is wider than the field
      const tree = (tx, ty, r) => {
        ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(tx + r * 0.2, ty, r * 0.95, r * 0.28, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = G.trunk; ctx.fillRect(tx - r * 0.12, ty - r * 0.95, r * 0.24, r * 0.95);
        for (const [a, bb, k, i] of [[0, -1.45, 0.8, 0], [-0.5, -1.1, 0.58, 1], [0.5, -1.15, 0.6, 1], [0.05, -1.95, 0.55, 2], [-0.25, -1.6, 0.35, 2]]) { ctx.fillStyle = G.leaf[i]; ctx.beginPath(); ctx.arc(tx + a * r, ty + bb * r, k * r, 0, TAU); ctx.fill(); }
      };
      const side = ox, r = Math.min(side * 0.28, S * 0.09);
      if (side > S * 0.22) {
        tree(side * 0.45, oy + S * 0.38, r); tree(side * 0.72, oy + S * 0.86, r * 0.75); tree(W - side * 0.5, oy + S * 0.5, r * 1.1);
        const bx = W - side * 0.52, by = oy + S * 0.95, bw = r * 1.6; // bench, seen from the front
        ctx.fillStyle = G.bench; ctx.fillRect(bx - bw / 2, by - r * 0.62, bw, r * 0.14); ctx.fillRect(bx - bw / 2, by - r * 0.34, bw, r * 0.12);
        ctx.fillRect(bx - bw * 0.42, by - r * 0.3, r * 0.08, r * 0.3); ctx.fillRect(bx + bw * 0.42 - r * 0.08, by - r * 0.3, r * 0.08, r * 0.3);
      }
      // the mowed field: stripes, a few tufts and daisies, the chalk line
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? G.b : G.a; ctx.fillRect(ox + i * S / 8, oy, S / 8 + 0.5, S); }
      ctx.strokeStyle = G.tuft;
      for (let i = 0; i < 22; i++) tuft(ox + (0.03 + 0.94 * rnd()) * S, oy + (0.05 + 0.92 * rnd()) * S, u * 0.022);
      for (let i = 0; i < 9; i++) {
        const tx = ox + (0.04 + 0.92 * rnd()) * S, ty = oy + (0.04 + 0.92 * rnd()) * S;
        ctx.fillStyle = i % 3 ? '#fffaf0' : '#ffd84d';
        for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.arc(tx + Math.cos(p * 1.2566) * u * 0.011, ty + Math.sin(p * 1.2566) * u * 0.011, u * 0.008, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#f0a030'; ctx.beginPath(); ctx.arc(tx, ty, u * 0.006, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = G.line; ctx.lineWidth = Math.max(1.5, u * 0.012); ctx.strokeRect(ox, oy, S, S);
      // the thrower: the game's robot (web/scenes.js) when the page has it, else a small person
      const [hx, hy] = P(THROWER[0], THROWER[1]);
      const R = globalThis.BB && globalThis.BB.scenes && globalThis.BB.scenes.robot;
      if (R) R(ctx, hx, hy + u * 0.05, u * 0.2, { wave: true });
      else {
        ctx.strokeStyle = c.muted; ctx.fillStyle = c.muted; ctx.lineWidth = Math.max(1.5, u * 0.012); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(hx, hy - u * 0.075, u * 0.022, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(hx, hy - u * 0.05); ctx.lineTo(hx, hy + u * 0.01); ctx.moveTo(hx - u * 0.03, hy - u * 0.03); ctx.lineTo(hx + u * 0.03, hy - u * 0.04);
        ctx.moveTo(hx, hy + u * 0.01); ctx.lineTo(hx - u * 0.02, hy + u * 0.045); ctx.moveTo(hx, hy + u * 0.01); ctx.lineTo(hx + u * 0.02, hy + u * 0.045); ctx.stroke();
      }
      // the dog's path
      if (trail.length > 1) {
        ctx.save(); ctx.strokeStyle = G.path; ctx.lineWidth = Math.max(1.5, u * 0.01); ctx.lineJoin = 'round'; ctx.beginPath();
        trail.forEach(([a, b], i) => { const [px, py] = P(a, b); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke(); ctx.restore();
      }
      if (overlay && overlay.paths) {
        ctx.save(); ctx.globalAlpha = 0.45; ctx.strokeStyle = G.path; ctx.lineWidth = 1;
        for (const p of overlay.paths) { ctx.beginPath(); p.forEach(([a, b], i) => { const [px, py] = P(a, b); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke(); }
        ctx.restore();
      }
      const stick = (px, py, rot) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot); ctx.strokeStyle = '#8a5a2b'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2.5, u * 0.022);
        ctx.beginPath(); ctx.moveTo(-u * 0.05, 0); ctx.lineTo(u * 0.05, 0); ctx.stroke();
        ctx.lineWidth = Math.max(1.5, u * 0.012); ctx.beginPath(); ctx.moveTo(u * 0.015, 0); ctx.lineTo(u * 0.035, -u * 0.02); ctx.stroke(); ctx.restore();
      };
      if (!carrying) { const [px, py] = P(sx, sy); stick(px, py, -Math.PI / 6); }
      const [dx, dy] = P(x, y), ang = -th; // canvas y points down
      ctx.save(); ctx.strokeStyle = G.path; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx, dy);
      ctx.lineTo(dx + Math.cos(ang) * u * 0.22, dy + Math.sin(ang) * u * 0.22); ctx.stroke(); ctx.restore();
      // the dog, drawn along its heading: shadow, tail, body, head, ears, nose
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(ang);
      const b = u * 0.075;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(b * 0.25, b * 0.2, b * 1.45, b * 0.7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#7a4f24'; ctx.lineWidth = Math.max(1.5, b * 0.18); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-b * 0.95, 0); ctx.quadraticCurveTo(-b * 1.45, -b * 0.15, -b * 1.5, -b * 0.55); ctx.stroke();
      ctx.fillStyle = '#c98b4a'; ctx.beginPath(); ctx.ellipse(0, 0, b, b * 0.55, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(b * 1.05, 0, b * 0.48, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5b3a1a';
      ctx.beginPath(); ctx.ellipse(b * 0.85, -b * 0.42, b * 0.2, b * 0.12, -0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(b * 0.85, b * 0.42, b * 0.2, b * 0.12, 0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(b * 1.48, 0, b * 0.1, 0, TAU); ctx.fill();
      if (carrying) stick(b * 1.55, 0, Math.PI / 2);
      ctx.restore();
      if (overlay && overlay.text) {
        ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const tm = ctx.measureText(overlay.text), tw = tm && tm.width ? tm.width : overlay.text.length * 7.2;
        ctx.fillStyle = dark ? 'rgba(16,24,18,0.78)' : 'rgba(255,255,255,0.85)'; ctx.fillRect(3, 3, tw + 10, 19);
        ctx.fillStyle = c.fg; ctx.fillText(overlay.text, 8, 7);
      }
    }
    return {
      spec, reset, step, render,
      prompt: () => start.slice(),
      trail: () => trail.slice(),
      getState: () => [x, y, th, sx, sy, carrying ? 1 : 0, t],
      setState: (s) => {
        if (s[6] === 0 || (!s[5] && (s[3] !== sx || s[4] !== sy))) trail = [];
        [x, y, th, sx, sy] = s; carrying = !!s[5]; t = s[6] | 0; over = false; trail.push([x, y]);
      },
      throwStick: (px, py) => { sx = clamp(px, -SLIM, SLIM); sy = clamp(py, -SLIM, SLIM); carrying = false; t = 0; over = false; trail = [[x, y]]; return obs(); },
      // field coordinates of a canvas pixel (for "click to throw"), same layout as render
      fieldAt: (px, py, W, H) => { const [S, ox, oy] = fieldBox(W, H); return [(px - ox) / S * 2 - 1, 1 - (py - oy) / S * 2]; },
      obs,
    };
  }

  RLA.worlds.fetch = {
    make, knobs, evalHorizon: 60, evalEpisodes: 20, playable: true,
    info: {
      title: 'Fetch',
      teaches: 'Reward design. The dog learns exactly what the reward pays for, which is not always what you meant. Inspired by Huggy, the dog of the Hugging Face Deep RL course.',
      cannotTeach: 'Legs, joints and real physics (Huggy moves its legs with joint motors; this dog only turns and walks), or a reward you cannot write down.',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RLA.worlds.fetch;
})();
