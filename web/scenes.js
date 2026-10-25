// Illustrated stages: a small robot plays the worlds (a casino for the slot machines, a canyon for the cliff, ...).
// The app hands each scene run 1's recorded data. A scene keeps its own clock: frame(ts) draws one frame,
// click() skips ahead (or replays at the end), busy() is true while something moves that the eye should follow.
(function () {
  'use strict';
  const BB = (globalThis.BB = globalThis.BB || {});
  const SC = (BB.scenes = {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const signed = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  let replayClock = null;
  const now = () => replayClock == null ? (typeof performance === 'object' ? performance.now() : Date.now()) : replayClock;
  // The same renderer and decorative clock are used for replay, screenshots and reduced motion.
  SC.atTime = (t, draw) => { const previous = replayClock; replayClock = t; try { return draw(); } finally { replayClock = previous; } };

  function rr(ctx, x, y, w, h, r) {
    const R = Array.isArray(r) ? r : [r, r, r, r];
    ctx.beginPath();
    ctx.moveTo(x + R[0], y);
    ctx.lineTo(x + w - R[1], y); ctx.quadraticCurveTo(x + w, y, x + w, y + R[1]);
    ctx.lineTo(x + w, y + h - R[2]); ctx.quadraticCurveTo(x + w, y + h, x + w - R[2], y + h);
    ctx.lineTo(x + R[3], y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - R[3]);
    ctx.lineTo(x, y + R[0]); ctx.quadraticCurveTo(x, y, x + R[0], y);
    ctx.closePath();
  }
  // the parts of a scene that never move, painted once into their own canvas
  function layer(ctx, W, H, paint) {
    const dpr = ctx.getTransform ? ctx.getTransform().a : 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); paint(c);
    return cv;
  }
  function text(ctx, s, x, y, o) {
    ctx.font = o.font; ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle';
    if (o.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = o.lw || 3; ctx.strokeStyle = o.stroke; ctx.strokeText(s, x, y); }
    ctx.fillStyle = o.color; ctx.fillText(s, x, y);
  }
  // a dark label with rounded ends; returns its width
  function pill(ctx, s, x, y, px, font, align) {
    ctx.font = px + 'px ' + font;
    const w = ctx.measureText(s).width + px * 1.2, h = px * 1.75, x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    rr(ctx, x0, y, w, h, h / 2); ctx.fillStyle = 'rgba(8, 10, 14, 0.66)'; ctx.fill();
    text(ctx, s, x0 + w / 2, y + h / 2 + 0.5, { font: px + 'px ' + font, color: '#f4f1ea' });
    return w;
  }
  // a row of labels at the top (or bottom) edge: left ones in order, the right one only if it still fits
  function hud(ctx, left, right, y, px, font, W) {
    let x = 8;
    for (const s of left) {
      if (!s) continue;
      ctx.font = px + 'px ' + font;
      const need = ctx.measureText(s).width + px * 1.2, room = W - 8 - x;
      if (need > room && x > 8) break;
      x += pill(ctx, s, x, y, need > room ? Math.max(7, px * room / need) : px, font) + 6;
    }
    if (right) { ctx.font = px + 'px ' + font; if (x + ctx.measureText(right).width + px * 1.2 < W - 8) pill(ctx, right, W - 8, y, px, font, 'right'); }
  }
  // a speech bubble whose tail points down at (x, y)
  function bubble(ctx, s, x, y, px, font, W) {
    ctx.font = '600 ' + px + 'px ' + font;
    const w = ctx.measureText(s).width + px * 1.4, h = px * 2, bx = clamp(x - w / 2, 4, W - w - 4), by = y - h - px * 0.7;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    rr(ctx, bx, by, w, h, px * 0.6); ctx.fillStyle = '#fffdf6'; ctx.fill(); ctx.restore();
    const tx = clamp(x, bx + px, bx + w - px);
    ctx.beginPath(); ctx.moveTo(tx - px * 0.45, by + h - 1); ctx.lineTo(tx + px * 0.1, y - px * 0.1); ctx.lineTo(tx + px * 0.45, by + h - 1); ctx.closePath();
    ctx.fillStyle = '#fffdf6'; ctx.fill();
    text(ctx, s, bx + w / 2, by + h / 2 + 0.5, { font: '600 ' + px + 'px ' + font, color: '#1d1a24' });
  }
  // a speech bubble beside a head that spans xl..xr at height y: on the right if it fits, else on the left
  function bubbleSide(ctx, s, xl, xr, y, px, font, W) {
    ctx.font = '600 ' + px + 'px ' + font;
    const w = ctx.measureText(s).width + px * 1.4, h = px * 2, gap = px * 0.9, right = xr + gap + w < W - 4;
    const bx = right ? xr + gap : Math.max(4, xl - gap - w), by = y - h / 2;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    rr(ctx, bx, by, w, h, px * 0.6); ctx.fillStyle = '#fffdf6'; ctx.fill(); ctx.restore();
    const ex = right ? bx + 1 : bx + w - 1, tip = right ? xr + px * 0.15 : xl - px * 0.15;
    ctx.beginPath(); ctx.moveTo(ex, y - px * 0.4); ctx.lineTo(tip, y + px * 0.15); ctx.lineTo(ex, y + px * 0.35); ctx.closePath();
    ctx.fillStyle = '#fffdf6'; ctx.fill();
    text(ctx, s, bx + w / 2, by + h / 2 + 0.5, { font: '600 ' + px + 'px ' + font, color: '#1d1a24' });
  }

  // ---------------------------------------------------------------- the robot
  // Front view, feet at (x, y), about s tall. o: { mood: normal|happy|sad|wow|dizzy, blink, look (-1..1), bob,
  // reach: [x, y] for the right hand, wave, arms: 'out' (with tilt), scale, rot, alpha, antenna (color), noShadow }
  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
  const vgrad = (ctx, y0, y1, a, b) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  function begin(ctx, x, y, o) {
    const k = o.scale == null ? 1 : o.scale;
    if (k <= 0.01) return false;
    ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); ctx.scale(k, k);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    return k;
  }
  function spiral(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 4; a += 0.25) { const q = r * a / (Math.PI * 4); const px = cx + Math.cos(a) * q, py = cy + Math.sin(a) * q; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  }
  // big glossy eyes, a small mouth and LED cheeks on a dark face screen
  function face(ctx, s, o, f) {
    const mood = o.mood || 'normal', lk = clamp(o.look || 0, -1, 1) * s * 0.03;
    const { ex, ey, er, my, eye } = f;
    ctx.save();
    ctx.strokeStyle = eye; ctx.fillStyle = eye; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = eye; ctx.shadowBlur = s * 0.06;
    for (const sx of [-1, 1]) {
      const cx = sx * ex + lk;
      ctx.lineWidth = s * 0.032;
      if (mood === 'happy') { ctx.beginPath(); ctx.arc(cx, ey + er * 0.45, er * 0.95, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke(); }
      else if (mood === 'dizzy') { ctx.lineWidth = s * 0.02; spiral(ctx, cx, ey, er * 1.05); }
      else if (mood === 'wow') { ctx.lineWidth = s * 0.024; circle(ctx, cx, ey, er * 1.2); ctx.stroke(); circle(ctx, cx, ey, er * 0.45); ctx.fill(); }
      else if (o.blink) { ctx.beginPath(); ctx.arc(cx, ey - er * 0.35, er * 0.85, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); }
      else if (mood === 'sad') {
        ctx.beginPath(); ctx.ellipse(cx, ey + er * 0.15, er * 0.8, er * 0.75, 0, 0, Math.PI); ctx.fill();
        ctx.lineWidth = s * 0.02; ctx.beginPath(); ctx.moveTo(cx - sx * er * 1.0, ey - er * 0.55); ctx.lineTo(cx + sx * er * 0.7, ey - er * 1.15); ctx.stroke();
      } else { ctx.beginPath(); ctx.ellipse(cx, ey, er * 0.86, er * 1.08, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
    // mouth
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    if (mood === 'happy') { ctx.moveTo(lk - s * 0.05, my - s * 0.012); ctx.quadraticCurveTo(lk, my + s * 0.06, lk + s * 0.05, my - s * 0.012); ctx.closePath(); ctx.fill(); }
    else if (mood === 'sad' || mood === 'dizzy') { ctx.arc(lk, my + s * 0.03, s * 0.032, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
    else if (mood === 'wow') { ctx.ellipse(lk, my, s * 0.02, s * 0.026, 0, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.arc(lk, my - s * 0.018, s * 0.03, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke(); }
    // catchlights make the eyes read as eyes at 30 px
    if (mood === 'normal' && !o.blink) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const sx of [-1, 1]) { const cx = sx * ex + lk; circle(ctx, cx - er * 0.32, ey - er * 0.42, er * 0.3); ctx.fill(); circle(ctx, cx + er * 0.3, ey + er * 0.36, er * 0.13); ctx.fill(); }
    }
    // cheeks
    if (mood !== 'sad') {
      ctx.fillStyle = mood === 'happy' ? 'rgba(255,120,165,0.7)' : 'rgba(255,120,165,0.42)';
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * f.cx + lk, f.cy, s * 0.036, s * 0.019, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
  // arm and hand placement shared by the three: default, wave (left hand up), reach (right hand to a point), arms out with tilt
  function hands(s, o, x, y, k, b, sh, rest, out) {
    const t = now(), wave = o.wave ? Math.sin(t / 140) * 0.12 * s : 0, tilt = (o.tilt || 0) * s * 0.5;
    if (o.arms === 'out') return [[-sh[0], sh[1], -out[0], out[1] + tilt], [sh[0], sh[1], out[0], out[1] - tilt]];
    const left = [-sh[0], sh[1], -rest[0], o.wave ? -s * 0.56 + wave : rest[1]];
    const right = o.reach ? [sh[0], sh[1], (o.reach[0] - x) / k, (o.reach[1] - y) / k - b] : [sh[0], sh[1], rest[0], rest[1]];
    return [left, right];
  }

  function robot(ctx, x, y, s, o) {
    o = o || {}; const k = begin(ctx, x, y, o); if (!k) return;
    const ink = '#24303a', lw = Math.max(1, s * 0.022), accent = o.antenna || '#ff8b3d', eye = '#72f1ff';
    if (!o.noShadow) { ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.beginPath(); ctx.ellipse(0, s * 0.01, s * 0.3, s * 0.055, 0, 0, 7); ctx.fill(); }
    rr(ctx, -s * 0.23, -s * 0.125, s * 0.46, s * 0.12, s * 0.06); ctx.fillStyle = '#3d4a54'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    ctx.fillStyle = '#a7b5bd'; for (const i of [-1, 0, 1]) { circle(ctx, i * s * 0.13, -s * 0.065, s * 0.032); ctx.fill(); }
    const b = o.bob || 0; ctx.translate(0, b);
    const arm = ([sx, sy, hx, hy]) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = ink; ctx.lineWidth = s * 0.075; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = '#e4eaee'; ctx.lineWidth = s * 0.045; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      circle(ctx, hx, hy, s * 0.05); ctx.fillStyle = '#e4eaee'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke(); ctx.lineCap = 'butt';
    };
    hands(s, o, x, y, k, b, [s * 0.16, -s * 0.27], [s * 0.29, -s * 0.16], [s * 0.42, -s * 0.4]).forEach(arm);
    rr(ctx, -s * 0.18, -s * 0.34, s * 0.36, s * 0.23, s * 0.09); ctx.fillStyle = vgrad(ctx, -s * 0.34, -s * 0.11, '#fafcfc', '#c4d0d6'); ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    circle(ctx, 0, -s * 0.225, s * 0.048); ctx.fillStyle = accent; ctx.fill();
    circle(ctx, -s * 0.016, -s * 0.24, s * 0.016); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
    rr(ctx, -s * 0.045, -s * 0.385, s * 0.09, s * 0.05, s * 0.02); ctx.fillStyle = '#8d9ca6'; ctx.fill();
    rr(ctx, -s * 0.32, -s * 0.86, s * 0.64, s * 0.48, s * 0.19); ctx.fillStyle = vgrad(ctx, -s * 0.86, -s * 0.38, '#fbfdfd', '#c3cfd5'); ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    for (const sx of [-1, 1]) {
      circle(ctx, sx * s * 0.325, -s * 0.62, s * 0.055); ctx.fillStyle = '#a9b8c1'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
      circle(ctx, sx * s * 0.325, -s * 0.62, s * 0.022); ctx.fillStyle = '#4fc0a8'; ctx.fill();
    }
    rr(ctx, -s * 0.25, -s * 0.8, s * 0.5, s * 0.35, s * 0.14); ctx.fillStyle = '#13202a'; ctx.fill();
    rr(ctx, -s * 0.22, -s * 0.78, s * 0.44, s * 0.1, s * 0.08); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    face(ctx, s, o, { ex: s * 0.105, ey: -s * 0.635, er: s * 0.062, my: -s * 0.52, eye, cx: s * 0.18, cy: -s * 0.552 });
    ctx.strokeStyle = ink; ctx.lineWidth = lw * 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -s * 0.86); ctx.quadraticCurveTo(0, -s * 0.93, s * 0.03, -s * 0.96); ctx.stroke();
    circle(ctx, s * 0.035, -s * 0.982, s * 0.045); ctx.fillStyle = accent; ctx.fill(); ctx.lineWidth = lw; ctx.stroke();
    circle(ctx, s * 0.022, -s * 0.995, s * 0.014); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.restore();
  }

  SC.robot = robot;
  const blinkAt = (t) => t % 3400 < 130;

  // ---------------------------------------------------------------- casino: the slot machines
  const HUES = [350, 42, 186, 276, 140, 18, 214, 318, 86, 252, 4, 160, 300, 58, 230, 30, 118, 200, 340, 100];
  // reel symbols: 0 cherry, 1 seven, 2 bell, 3 diamond, 4 lemon
  function symbol(ctx, k, cx, cy, s) {
    ctx.save(); ctx.lineJoin = 'round';
    if (k === 0) {
      ctx.strokeStyle = '#2f8a3a'; ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath(); ctx.moveTo(cx - s * 0.18, cy + s * 0.05); ctx.quadraticCurveTo(cx - s * 0.05, cy - s * 0.28, cx + s * 0.12, cy - s * 0.32); ctx.moveTo(cx + s * 0.2, cy + s * 0.1); ctx.quadraticCurveTo(cx + s * 0.2, cy - s * 0.2, cx + s * 0.12, cy - s * 0.32); ctx.stroke();
      ctx.fillStyle = '#e2283a';
      ctx.beginPath(); ctx.arc(cx - s * 0.18, cy + s * 0.17, s * 0.17, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + s * 0.2, cy + s * 0.21, s * 0.17, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(cx - s * 0.23, cy + s * 0.12, s * 0.05, 0, 7); ctx.fill();
    } else if (k === 1) {
      ctx.font = '900 ' + Math.round(s * 0.9) + 'px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = '#5a0b14'; ctx.strokeText('7', cx, cy + s * 0.04);
      ctx.fillStyle = '#e8243c'; ctx.fillText('7', cx, cy + s * 0.04);
    } else if (k === 2) {
      ctx.fillStyle = '#f2b51f'; ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - s * 0.32, cy + s * 0.22); ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.12, cx - s * 0.2, cy - s * 0.08);
      ctx.quadraticCurveTo(cx - s * 0.2, cy - s * 0.32, cx, cy - s * 0.32); ctx.quadraticCurveTo(cx + s * 0.2, cy - s * 0.32, cx + s * 0.2, cy - s * 0.08);
      ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.12, cx + s * 0.32, cy + s * 0.22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + s * 0.27, s * 0.07, 0, 7); ctx.fill(); ctx.stroke();
    } else if (k === 3) {
      ctx.fillStyle = '#3aa7ff'; ctx.strokeStyle = '#0d4f8a'; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.32); ctx.lineTo(cx + s * 0.3, cy - s * 0.05); ctx.lineTo(cx, cy + s * 0.34); ctx.lineTo(cx - s * 0.3, cy - s * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy - s * 0.05); ctx.lineTo(cx + s * 0.3, cy - s * 0.05); ctx.moveTo(cx, cy - s * 0.32); ctx.lineTo(cx, cy + s * 0.34); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    } else {
      ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#a88a00'; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.3, s * 0.22, -0.3, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // one machine standing on the floor at (x, yb). st: { i, hue, glow, lever (0..1), spin: [0..1 per reel] | null, syms,
  // count, reveal: { mean, q } | null, lights (time) }. Returns where the lever knob is.
  function machine(ctx, x, yb, mw, mh, st, fonts) {
    const hue = st.hue, top = yb - mh;
    ctx.save();
    if (st.glow > 0) { ctx.shadowColor = 'hsla(' + hue + ', 100%, 62%, ' + (0.85 * st.glow) + ')'; ctx.shadowBlur = 28 * st.glow; }
    const g = ctx.createLinearGradient(x, 0, x + mw, 0);
    g.addColorStop(0, 'hsl(' + hue + ', 62%, 26%)'); g.addColorStop(0.3, 'hsl(' + hue + ', 70%, 50%)'); g.addColorStop(0.55, 'hsl(' + hue + ', 72%, 44%)'); g.addColorStop(1, 'hsl(' + hue + ', 62%, 22%)');
    rr(ctx, x, top, mw, mh, [mw * 0.34, mw * 0.34, mw * 0.05, mw * 0.05]); ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, mw * 0.022); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    // chrome trim along the dome
    ctx.strokeStyle = 'hsla(' + hue + ', 90%, 82%, 0.55)'; ctx.lineWidth = Math.max(1, mw * 0.02);
    rr(ctx, x + mw * 0.06, top + mh * 0.025, mw * 0.88, mh * 0.2, [mw * 0.28, mw * 0.28, 2, 2]); ctx.stroke();
    // bulbs on the dome
    const nb = 7, t = st.lights || 0;
    for (let j = 0; j < nb; j++) {
      const a = Math.PI * (1.12 + 0.76 * j / (nb - 1)), bx = x + mw / 2 + Math.cos(a) * mw * 0.4, by = top + mw * 0.36 + Math.sin(a) * mw * 0.3;
      const on = st.glow > 0.2 ? (j + Math.floor(t / 90)) % 2 === 0 : (j + Math.floor(t / 600) + st.i) % 4 === 0;
      ctx.fillStyle = on ? '#fff3b0' : 'hsl(' + hue + ', 40%, 22%)';
      if (on) { ctx.save(); ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = mw * 0.12; }
      ctx.beginPath(); ctx.arc(bx, Math.max(top + mw * 0.05, by), Math.max(1.2, mw * 0.035), 0, 7); ctx.fill();
      if (on) ctx.restore();
    }
    // number plate
    const pw = mw * 0.46, ph = mh * 0.1, py = top + mh * 0.12;
    rr(ctx, x + (mw - pw) / 2, py, pw, ph, ph * 0.35); ctx.fillStyle = '#170d1b'; ctx.fill();
    ctx.save(); ctx.shadowColor = 'hsl(' + hue + ', 100%, 70%)'; ctx.shadowBlur = mw * 0.08;
    text(ctx, String(st.i + 1), x + mw / 2, py + ph / 2 + 0.5, { font: '700 ' + Math.max(7, Math.round(ph * 0.78)) + 'px ' + fonts.display, color: 'hsl(' + hue + ', 100%, 84%)' });
    ctx.restore();
    // screen with three reels (or, at the end, the truth and the robot's belief)
    const sx = x + mw * 0.1, sy = top + mh * 0.27, sw = mw * 0.8, sh = mh * 0.27;
    rr(ctx, sx - mw * 0.03, sy - mw * 0.03, sw + mw * 0.06, sh + mw * 0.06, mw * 0.06); ctx.fillStyle = 'hsl(' + hue + ', 35%, 78%)'; ctx.fill();
    rr(ctx, sx, sy, sw, sh, mw * 0.04); ctx.fillStyle = '#120a14'; ctx.fill();
    if (st.reveal) {
      const fs = Math.max(6, Math.min(sh * 0.36, sw * 0.24));
      text(ctx, signed(st.reveal.mean), sx + sw / 2, sy + sh * 0.3, { font: '700 ' + fs + 'px ' + fonts.mono, color: '#ffd166' });
      text(ctx, signed(st.reveal.q), sx + sw / 2, sy + sh * 0.72, { font: '600 ' + fs + 'px ' + fonts.mono, color: '#7ee8ff' });
    } else {
      const rw = sw * 0.29, gap = (sw - 3 * rw) / 4;
      for (let r = 0; r < 3; r++) {
        const rx = sx + gap + r * (rw + gap), ry = sy + sh * 0.1, rh = sh * 0.8;
        ctx.save(); rr(ctx, rx, ry, rw, rh, rw * 0.15); ctx.clip();
        ctx.fillStyle = '#fff7e6'; ctx.fillRect(rx, ry, rw, rh);
        const spin = st.spin ? st.spin[r] : 1, ss = Math.min(rw, rh) * 0.95;
        if (spin < 1) {
          const off = ((st.lights || 0) / 30 + r * 0.37) % 1;
          for (let q = -1; q <= 1; q++) symbol(ctx, (st.i + r + q + 5) % 5, rx + rw / 2, ry + rh / 2 + (q + off) * rh, ss);
          ctx.fillStyle = 'rgba(255,247,230,0.45)'; ctx.fillRect(rx, ry, rw, rh);
        } else symbol(ctx, st.syms ? st.syms[r] : (st.i * 3 + r) % 5, rx + rw / 2, ry + rh / 2, ss);
        const sg = ctx.createLinearGradient(0, ry, 0, ry + rh);
        sg.addColorStop(0, 'rgba(0,0,0,0.35)'); sg.addColorStop(0.25, 'rgba(0,0,0,0)'); sg.addColorStop(0.75, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = sg; ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
      }
    }
    // pull counter
    const cy = top + mh * 0.6, ch = mh * 0.095, cw = mw * 0.58;
    rr(ctx, x + (mw - cw) / 2, cy, cw, ch, ch * 0.25); ctx.fillStyle = '#0c0808'; ctx.fill();
    text(ctx, String(st.count || 0), x + mw / 2, cy + ch / 2 + 0.5, { font: '600 ' + Math.max(6, Math.round(ch * 0.78)) + 'px ' + fonts.mono, color: '#ffb547' });
    // buttons and the coin tray
    for (let j = 0; j < 3; j++) { ctx.fillStyle = ['#ff5a5a', '#ffd34d', '#5ad1ff'][j]; ctx.beginPath(); ctx.arc(x + mw * (0.32 + 0.18 * j), top + mh * 0.75, Math.max(1.2, mw * 0.04), 0, 7); ctx.fill(); }
    rr(ctx, x + mw * 0.18, top + mh * 0.83, mw * 0.64, mh * 0.09, mw * 0.04); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    if (st.coins) { ctx.fillStyle = '#ffcf40'; for (let j = 0; j < Math.min(5, st.coins); j++) { ctx.beginPath(); ctx.ellipse(x + mw * (0.3 + 0.1 * j), top + mh * 0.885, mw * 0.05, mw * 0.025, 0, 0, 7); ctx.fill(); } }
    // the lever: pulling it brings the knob down along the side (toward the viewer)
    const lx = x + mw + mw * 0.02, ly = top + mh * 0.5, len = mh * 0.26, a = Math.PI * 0.92 * (st.lever || 0);
    const kx = lx + mw * 0.07, ky = ly - Math.cos(a) * len;
    ctx.fillStyle = '#5d646b'; rr(ctx, lx - mw * 0.03, ly - mh * 0.04, mw * 0.07, mh * 0.08, mw * 0.02); ctx.fill();
    ctx.lineCap = 'round'; ctx.strokeStyle = '#c9d1d8'; ctx.lineWidth = Math.max(1.5, mw * 0.045);
    ctx.beginPath(); ctx.moveTo(lx + mw * 0.02, ly); ctx.lineTo(kx, ky); ctx.stroke(); ctx.lineCap = 'butt';
    const kg = ctx.createRadialGradient(kx - mw * 0.03, ky - mw * 0.03, 1, kx, ky, mw * 0.09);
    kg.addColorStop(0, '#ff9a9a'); kg.addColorStop(1, '#c0141f');
    ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, Math.max(2, mw * 0.085), 0, 7); ctx.fill();
    return [kx, ky];
  }
  function crown(ctx, cx, cy, s) {
    ctx.save(); ctx.shadowColor = '#ffd166'; ctx.shadowBlur = s * 0.5;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.5, cy + s * 0.25); ctx.lineTo(cx - s * 0.55, cy - s * 0.25); ctx.lineTo(cx - s * 0.25, cy); ctx.lineTo(cx, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.25, cy); ctx.lineTo(cx + s * 0.55, cy - s * 0.25); ctx.lineTo(cx + s * 0.5, cy + s * 0.25); ctx.closePath();
    ctx.fillStyle = '#ffcf3f'; ctx.fill(); ctx.restore(); ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.stroke();
    ctx.fillStyle = '#e8243c'; ctx.beginPath(); ctx.arc(cx, cy + s * 0.08, s * 0.07, 0, 7); ctx.fill();
  }

  // d: { means, q (robot's final estimates), arms, rewards (run 1's training pulls), n, fonts }
  SC.casino = function (ctx, W, H, d) {
    const fonts = d.fonts, n = d.means ? d.means.length : d.n, N = d.arms ? d.arms.length : 0;
    const rows = W < 560 && n > 5 ? 2 : 1, per = Math.ceil(n / rows);
    const topH = Math.max(26, H * 0.09), rowH = (H - topH) / rows;
    const mx = W * 0.03, slot = (W - 2 * mx) / per, mw = slot * 0.74, mh = Math.min(rowH * 0.62, mw * 2.15);
    const rs = Math.min(rowH * 0.34, slot * 0.82);
    const base = (r) => topH + r * rowH + rowH * (rows === 1 ? 0.8 : 0.76);
    const feet = (r) => base(r) + rs * 0.3;
    const mX = (i) => mx + (i % per) * slot + (slot - mw) / 2 - slot * 0.04;
    const rowOf = (i) => Math.floor(i / per);
    const spotX = (i) => mX(i) + mw * 0.86;
    const best = d.means ? d.means.reduce((b, v, i, a) => (v > a[b] ? i : b), 0) : -1;
    const pick = d.q ? Array.from(d.q).reduce((b, v, i, a) => (v > a[b] ? i : b), 0) : -1;
    const bg = layer(ctx, W, H, (c) => {
      const wall = c.createLinearGradient(0, 0, 0, base(0));
      wall.addColorStop(0, '#150a1f'); wall.addColorStop(1, '#2d1340');
      c.fillStyle = wall; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.025)';
      for (let x = 0; x < W; x += 22) c.fillRect(x, 0, 9, base(0));
      // carpet
      const fy = base(0) - 2, cg = c.createLinearGradient(0, fy, 0, H);
      cg.addColorStop(0, '#3d0a1d'); cg.addColorStop(1, '#5e1229');
      c.fillStyle = cg; c.fillRect(0, fy, W, H - fy);
      for (let y = fy + 8, row = 0; y < H + 10; y += 12 + row * 1.5, row++) {
        for (let x = (row % 2) * 14; x < W + 20; x += 28) {
          c.fillStyle = row % 3 === 0 ? 'rgba(255, 196, 80, 0.16)' : 'rgba(80, 220, 200, 0.10)';
          c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 5, y); c.lineTo(x, y + 4); c.lineTo(x - 5, y); c.closePath(); c.fill();
        }
      }
      c.fillStyle = '#26110c'; c.fillRect(0, fy - 4, W, 6); c.fillStyle = 'rgba(255, 200, 90, 0.5)'; c.fillRect(0, fy - 4, W, 1);
      // the string of lights across the ceiling (wire only; bulbs twinkle in the frame)
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.2; c.beginPath();
      for (let x = 0; x <= W; x += 4) { const y = topH * 0.35 + Math.abs(Math.sin((x / W) * Math.PI * 3)) * topH * 0.45; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      // the neon sign, if the wall has room
      const room = base(0) - mh - topH;
      if (rows === 1 && room > 46) {
        const fs = Math.min(room * 0.42, W * 0.05), sy = topH + room * 0.42;
        c.save(); c.shadowColor = '#ff4fd8'; c.shadowBlur = fs * 0.5;
        text(c, 'SLOTS', W / 2, sy, { font: '800 ' + fs + 'px ' + fonts.display, color: '#ffd1f4' });
        c.shadowColor = '#4ff2ff'; c.shadowBlur = fs * 0.3;
        text(c, 'average payout: a secret', W / 2, sy + fs * 0.85, { font: '500 ' + Math.max(9, fs * 0.32) + 'px ' + fonts.mono, color: '#c9fbff' });
        c.restore();
      }
    });
    // the replay schedule: the first pulls slowly, then faster, then fast-forward
    const SLOW = Math.min(N, 8), MID = Math.min(N, 48), FAST = Math.max(0.35, 3200 / Math.max(1, N - MID));
    const dur = (i) => (i < SLOW ? 640 : i < MID ? 115 : FAST);
    const start = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) start[i + 1] = start[i] + dur(i);
    const T = start[N], END = T + 1600;
    const counts = new Int32Array(n), lastPull = new Float64Array(n).fill(-1e9), lastIdx = new Int32Array(n);
    let counted = 0, t0 = null, popups = [], coins = [], rx = spotX(Math.floor((n - 1) / 2)), rRow = 0, ry = feet(0), mood = 'normal', moodUntil = 0;
    const syms = (j) => { const r = d.rewards[j]; if (r > 1.2) return [1, 1, 1]; if (r > 0.4) return [0, 0, 2 + (j % 3)]; return [(j * 7) % 5, (j * 3 + 1) % 5, (j * 11 + 4) % 5].map((s, q, a) => (q === 2 && s === a[0] && s === a[1] ? (s + 1) % 5 : s)); };
    function reset() { counts.fill(0); lastPull.fill(-1e9); counted = 0; popups = []; coins = []; }
    function advance(e) {
      // count the pulls that finished before e; slow and medium pulls make a popup
      while (counted < N && start[counted + 1] <= e) {
        const j = counted, a = d.arms[j], r = d.rewards[j];
        counts[a]++; lastPull[a] = start[j + 1]; lastIdx[a] = j; counted++;
        if (j < MID) {
          const kx = mX(a) + mw / 2, ky = base(rowOf(a)) - mh;
          popups = popups.filter((q) => q.m !== a);
          popups.push({ m: a, x: kx, y: ky, s: signed(r), c: r >= 0 ? '#6dff9b' : '#ff7a7a', born: start[j + 1] });
          if (j < SLOW && r > 0) for (let q = 0; q < Math.min(6, 1 + Math.round(r * 3)); q++) coins.push({ x: kx, y: base(rowOf(a)) - mh * 0.12, vx: (hash(j * 13 + q) - 0.5) * 0.12, vy: -0.18 - hash(j * 7 + q) * 0.12, born: start[j + 1] });
          mood = r > 0 ? 'happy' : 'sad'; moodUntil = start[j + 1] + (j < SLOW ? 420 : 90);
        }
      }
    }
    function draw(e) {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      // twinkling bulbs on the ceiling wire
      for (let x = 10, j = 0; x < W; x += 24, j++) {
        const y = topH * 0.35 + Math.abs(Math.sin((x / W) * Math.PI * 3)) * topH * 0.45 + 3;
        const tw = 0.55 + 0.45 * Math.sin(t / 380 + j * 1.7);
        ctx.fillStyle = 'rgba(255, ' + (190 + 40 * (j % 3)) + ', 120, ' + tw + ')';
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill();
      }
      const replay = N > 0 && e != null;
      const done = replay && e >= T;
      const cur = replay && !done ? Math.max(0, Math.min(N - 1, upper(start, e) - 1)) : -1;
      const p = cur >= 0 ? (e - start[cur]) / dur(cur) : 1;
      const target = cur >= 0 ? d.arms[cur] : done ? pick : -1;
      // where the robot goes
      if (cur >= 0 && cur < MID) {
        const from = cur > 0 ? d.arms[cur - 1] : Math.floor((n - 1) / 2), q = ease(clamp(p / 0.35, 0, 1));
        const fRow = rowOf(from), tRow = rowOf(target);
        rx = lerp(spotX(from), spotX(target), q); ry = lerp(feet(fRow), feet(tRow), q); rRow = q < 0.5 ? fRow : tRow;
      } else if (target >= 0) {
        const k = done ? 0.08 : 0.4;
        rx += (spotX(target) - rx) * k; ry += (feet(rowOf(target)) - ry) * k; rRow = Math.abs(ry - feet(rowOf(target))) < rs * 0.5 ? rowOf(target) : rRow;
      }
      // spotlight on the machine being played
      if (target >= 0) {
        const sxx = mX(target) + mw / 2, syy = base(rowOf(target));
        const sg = ctx.createRadialGradient(sxx, syy, 2, sxx, syy, mw * 1.4);
        sg.addColorStop(0, 'rgba(255, 230, 160, 0.28)'); sg.addColorStop(1, 'rgba(255, 230, 160, 0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(sxx, syy, mw * 1.4, mw * 0.5, 0, 0, 7); ctx.fill();
      }
      let knob = null;
      const drawRow = (r) => {
        for (let i = r * per; i < Math.min(n, (r + 1) * per); i++) {
          const active = i === target && !done;
          let lever = 0, spin = null, glow = 0;
          if (active && cur < MID) {
            lever = p < 0.5 ? 0 : p < 0.65 ? (p - 0.5) / 0.15 : p < 0.78 ? 1 - (p - 0.65) / 0.13 : 0;
            if (p > 0.55) spin = [0, 1, 2].map((q) => clamp((p - 0.55) / (0.25 + 0.1 * q), 0, 1));
            glow = p > 0.3 ? 1 : p / 0.3;
          } else if (replay) {
            const since = e - lastPull[i];
            lever = clamp(1 - since / 90, 0, 1); glow = clamp(1 - since / 350, 0, 1) * 0.8;
          }
          if (done && i === pick) glow = 0.5 + 0.3 * Math.sin(t / 300);
          const showSyms = active && cur < MID ? syms(cur) : counts[i] ? syms(lastIdx[i]) : null;
          const k = machine(ctx, mX(i), base(r), mw, mh, { i, hue: HUES[i % HUES.length], glow, lever, spin, syms: showSyms, count: counts[i], lights: t,
            reveal: done && d.means && d.q ? { mean: d.means[i], q: d.q[i] } : null }, fonts);
          if (active && cur < SLOW) knob = k;
          if (done && i === best && e > T + 500) crown(ctx, mX(i) + mw / 2, base(r) - mh - mw * 0.2, mw * 0.42);
        }
      };
      // the robot's arm reaches for the knob during a slow pull
      const reach = () => {
        if (!knob || p < 0.35 || p > 0.8) return null;
        const hx = rx + rs * 0.34, hy = ry - rs * 0.2, q = p < 0.5 ? ease((p - 0.35) / 0.15) : p < 0.65 ? 1 : 1 - ease((p - 0.65) / 0.15);
        return [lerp(hx, knob[0], q), lerp(hy, knob[1], q)];
      };
      const drawBot = () => {
        const m = done && e > T + 900 ? (pick === best ? 'happy' : 'normal') : e != null && e < moodUntil ? mood : 'normal';
        const walking = cur >= 0 && cur < MID && p < 0.35;
        robot(ctx, rx, ry, rs, { mood: m, blink: blinkAt(t), bob: walking ? -Math.abs(Math.sin(t / 70)) * rs * 0.04 : 0, look: target >= 0 ? clamp((spotX(target) - rx) / slot, -1, 1) : 0, reach: reach(),
          antenna: replay && !done && cur >= MID ? (Math.floor(t / 120) % 2 ? '#ff4f4f' : '#ffd34d') : undefined });
      };
      for (let r = 0; r < rows; r++) { drawRow(r); if (rRow === r) drawBot(); }
      // coins and payouts in the air
      const at = e == null ? 0 : e;
      coins = coins.filter((c) => at - c.born < 800);
      for (const c of coins) {
        const dt = at - c.born; if (dt < 0) continue;
        ctx.fillStyle = '#ffcf40'; ctx.beginPath(); ctx.ellipse(c.x + c.vx * dt, c.y + c.vy * dt + 0.0006 * dt * dt, 3, 2.2, 0, 0, 7); ctx.fill();
      }
      popups = popups.filter((q) => at - q.born < 900);
      for (const q of popups) {
        const dt = at - q.born; if (dt < 0) continue;
        ctx.globalAlpha = clamp(1.4 - dt / 650, 0, 1);
        text(ctx, q.s, q.x, q.y - dt * 0.04, { font: '800 ' + Math.max(11, Math.round(mw * 0.22)) + 'px ' + fonts.mono, color: q.c, stroke: 'rgba(0,0,0,0.75)', lw: 3 });
        ctx.globalAlpha = 1;
      }
      // the label strip
      const px = Math.max(10, Math.min(13, H * 0.034)), narrow = W < 480;
      if (!replay) hud(ctx, [narrow ? 'Press Run: a robot plays.' : 'Hidden average payouts. Press Run: a robot plays.'], null, 6, px, fonts.mono, W);
      else if (!done) {
        const sp = cur < SLOW ? '' : cur < MID ? ' ▶▶' : ' ▶▶▶';
        hud(ctx, [(narrow ? 'Pull ' : (d.label || 'Run 1') + ', training pull ') + (cur + 1).toLocaleString('en-US') + ' of ' + N.toLocaleString('en-US') + sp + (narrow || cur < SLOW ? '' : cur < MID ? ' faster' : ' fast-forward')], 'skip ▶', 6, px, fonts.mono, W);
      } else {
        hud(ctx, narrow ? ['gold: true · blue: believed'] : ['gold: true average', 'blue: what the robot believes'], 'replay', 6, px, fonts.mono, W);
        if (e > T + 1000 && pick >= 0) {
          const said = W < 900 ? 'I pick #' + (pick + 1) + '!' + (pick === best ? '' : ' (Wrong.)') : pick === best ? 'Machine ' + (pick + 1) + ' is the best!' : 'Machine ' + (pick + 1) + ' is the best! (It is not.)';
          bubbleSide(ctx, said, rx - rs * 0.32, rx + rs * 0.32, ry - rs * 0.62, Math.max(10, Math.min(14, rs * 0.17)), fonts.display, W);
        }
      }
      if (!replay) bubbleSide(ctx, 'Which one pays best?', rx - rs * 0.32, rx + rs * 0.32, ry - rs * 0.62, Math.max(10, Math.min(14, rs * 0.17)), fonts.display, W);
    }
    return {
      frame(ts) {
        if (!N) { draw(null); return; }
        if (ts === Infinity) { t0 = now() - END - 1000; ts = now(); }
        if (t0 == null) t0 = ts;
        const e = Math.max(0, ts - t0);
        if (e < (counted ? start[counted] : 0)) reset();
        advance(e); draw(e);
      },
      click() {
        if (!N) return;
        const e = now() - (t0 == null ? now() : t0);
        if (e < T) { t0 = now() - T; advance(T); } else { t0 = now(); reset(); rx = spotX(Math.floor((n - 1) / 2)); }
      },
      busy() { return N > 0 && t0 != null && now() - t0 < END + 1200; },
      pick, best, duration: END + 1200,
    };
  };
  function upper(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; }

  // ---------------------------------------------------------------- canyon: cliff walking
  // d: { cols, peeks: [{ ep, pos, fell, done }], epLen, epFalls, test: [{ s: [row, col], f, r }], arrows: Int8Array | null, fonts, dark }
  SC.canyon = function (ctx, W, H, d) {
    const fonts = d.fonts, cols = d.cols, ROWS = 4;
    const cell = Math.min((W * 0.95) / cols, (H * 0.8) / ROWS), gw = cell * cols, gh = cell * ROWS;
    const below = Math.max(cell * 1.05, H * 0.2), ox = (W - gw) / 2, oy = Math.max(4, H - below - gh), rimY = oy + 3 * cell;
    const cx = (c) => ox + (c + 0.5) * cell, cyy = (r) => oy + (r + 0.5) * cell;
    const rs = cell * 0.78, feetY = (r) => cyy(r) + cell * 0.3;
    const START = [3, 0], GOAL = [3, cols - 1];
    const isCliff = (r, c) => r === 3 && c > 0 && c < cols - 1;
    const bg = layer(ctx, W, H, (c) => {
      // the plateau
      c.fillStyle = '#6fa653'; c.fillRect(0, 0, W, rimY + 2);
      for (let i = 0; i < 260; i++) { // grass texture outside and inside the grid
        const x = hash(i * 3.1) * W, y = hash(i * 7.7) * rimY;
        c.strokeStyle = 'rgba(30, 70, 20, ' + (0.15 + 0.15 * hash(i)) + ')'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x - 2, y + 3); c.lineTo(x, y - 1); c.lineTo(x + 2, y + 3); c.stroke();
      }
      for (let r = 0; r < 3; r++) for (let k = 0; k < cols; k++) {
        c.fillStyle = (r + k) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.035)';
        c.fillRect(ox + k * cell, oy + r * cell, cell, cell);
        if (hash(r * 31 + k) > 0.72) { // a small flower
          const fx = ox + (k + 0.2 + 0.6 * hash(k * 5 + r)) * cell, fy = oy + (r + 0.2 + 0.6 * hash(r * 9 + k)) * cell;
          c.fillStyle = hash(k + r * 2) > 0.5 ? '#fff6c2' : '#ffd0e4';
          for (let q = 0; q < 4; q++) { c.beginPath(); c.arc(fx + Math.cos(q * 1.57) * 2, fy + Math.sin(q * 1.57) * 2, 1.6, 0, 7); c.fill(); }
          c.fillStyle = '#f2b51f'; c.beginPath(); c.arc(fx, fy, 1.3, 0, 7); c.fill();
        }
      }
      c.strokeStyle = 'rgba(20, 50, 10, 0.12)'; c.lineWidth = 1;
      for (let k = 0; k <= cols; k++) { c.beginPath(); c.moveTo(ox + k * cell, oy); c.lineTo(ox + k * cell, rimY); c.stroke(); }
      for (let r = 0; r <= 3; r++) { c.beginPath(); c.moveTo(ox, oy + r * cell); c.lineTo(ox + gw, oy + r * cell); c.stroke(); }
      // trees in the margins (never on a cell)
      const tree = (x, y, s) => {
        c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(x + s * 0.15, y + s * 0.35, s * 0.55, s * 0.22, 0, 0, 7); c.fill();
        c.fillStyle = '#3f7a3a'; c.beginPath(); c.arc(x, y, s * 0.5, 0, 7); c.fill();
        c.fillStyle = '#4f9447'; c.beginPath(); c.arc(x - s * 0.12, y - s * 0.12, s * 0.33, 0, 7); c.fill();
      };
      for (let i = 0; i < 40; i++) {
        const s = cell * (0.35 + 0.3 * hash(i * 1.3)), x = hash(i * 2.9) * W, y = hash(i * 4.3) * (rimY - s * 0.6);
        const inGrid = x > ox - s * 0.5 && x < ox + gw + s * 0.5 && y > oy - s * 0.5;
        if (!inGrid) tree(x, y, s);
      }
      // the canyon below the rim: strata, depth and a river
      const g = c.createLinearGradient(0, rimY, 0, H);
      g.addColorStop(0, '#a37a52'); g.addColorStop(0.12, '#835e3f'); g.addColorStop(0.45, '#4a3326'); g.addColorStop(0.8, '#21160f'); g.addColorStop(1, '#140d09');
      c.fillStyle = g; c.fillRect(0, rimY, W, H - rimY);
      for (let i = 0; i < 9; i++) {
        const y0 = rimY + (H - rimY) * (0.08 + i * 0.09);
        c.strokeStyle = i % 2 ? 'rgba(255, 210, 160, 0.08)' : 'rgba(0, 0, 0, 0.16)'; c.lineWidth = 2 + (i % 3);
        c.beginPath(); for (let x = 0; x <= W; x += 8) { const y = y0 + Math.sin(x / (40 + i * 7) + i) * 3; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
      }
      const rv = H - Math.max(6, (H - rimY) * 0.14);
      c.fillStyle = '#245b78'; c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) c.lineTo(x, rv + Math.sin(x / 55) * 3);
      c.lineTo(W, H); c.closePath(); c.fill();
      // the shadow under the grass lip and a jagged rim
      const sh = c.createLinearGradient(0, rimY, 0, rimY + cell * 0.35); sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sh; c.fillRect(0, rimY, W, cell * 0.35);
      c.fillStyle = '#5f9448'; c.beginPath(); c.moveTo(0, rimY - 1);
      for (let x = 0; x <= W; x += 6) c.lineTo(x, rimY + 1 + hash(x * 0.37) * cell * 0.07);
      c.lineTo(W, rimY - 1); c.closePath(); c.fill();
      // the two rock pillars: start and goal
      for (const k of [0, cols - 1]) {
        const x0 = ox + k * cell, pg = c.createLinearGradient(x0, 0, x0 + cell, 0);
        pg.addColorStop(0, '#6b4e37'); pg.addColorStop(0.5, '#9a7a58'); pg.addColorStop(1, '#5a412e');
        c.fillStyle = pg; c.beginPath(); c.moveTo(x0 + cell * 0.04, rimY);
        for (let y = rimY; y <= H; y += 10) c.lineTo(x0 + cell * (0.02 + 0.06 * hash(y + k)) + (y - rimY) * 0.06, y);
        for (let y = H; y >= rimY; y -= 10) c.lineTo(x0 + cell * (0.98 - 0.06 * hash(y * 1.7 + k)) - (y - rimY) * 0.06, y);
        c.closePath(); c.fill();
        const tg = c.createLinearGradient(0, rimY, 0, rimY + cell);
        tg.addColorStop(0, '#d9c8a3'); tg.addColorStop(1, '#bba57f');
        rr(c, x0 + cell * 0.03, rimY - cell * 0.02, cell * 0.94, cell * 0.97, cell * 0.12); c.fillStyle = tg; c.fill();
        c.strokeStyle = 'rgba(70, 50, 30, 0.45)'; c.lineWidth = 1.2; c.stroke();
        for (let q = 0; q < 4; q++) { c.fillStyle = 'rgba(90, 70, 45, 0.25)'; c.beginPath(); c.arc(x0 + cell * (0.2 + 0.6 * hash(q * 3 + k)), rimY + cell * (0.2 + 0.6 * hash(q * 5 + k)), cell * 0.035, 0, 7); c.fill(); }
      }
      // the start pad
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = Math.max(1.5, cell * 0.035); c.setLineDash([cell * 0.08, cell * 0.06]);
      c.beginPath(); c.ellipse(cx(0), cyy(3) + cell * 0.22, cell * 0.36, cell * 0.14, 0, 0, 7); c.stroke(); c.setLineDash([]);
      const labY = H > rimY + cell * 1.35 ? rimY + cell * 1.18 : cyy(3) - cell * 0.32;
      text(c, 'START', cx(0), labY, { font: '700 ' + Math.max(8, cell * 0.16) + 'px ' + fonts.display, color: '#fff', stroke: 'rgba(40,25,10,0.85)', lw: 3 });
      text(c, 'GOAL', cx(cols - 1), labY, { font: '700 ' + Math.max(8, cell * 0.16) + 'px ' + fonts.display, color: '#fff', stroke: 'rgba(40,25,10,0.85)', lw: 3 });
      // a warning sign in the margin
      if (ox > cell * 0.35) {
        const sx = ox * 0.5, sy = rimY - cell * 0.35, ss = Math.min(ox * 0.7, cell * 0.5);
        c.fillStyle = '#5b4632'; c.fillRect(sx - 1.5, sy, 3, ss * 0.7);
        c.fillStyle = '#ffcf3f'; c.beginPath(); c.moveTo(sx, sy - ss * 0.55); c.lineTo(sx + ss * 0.5, sy + ss * 0.25); c.lineTo(sx - ss * 0.5, sy + ss * 0.25); c.closePath(); c.fill();
        c.strokeStyle = '#3b2b10'; c.lineWidth = 1.2; c.stroke();
        text(c, '!', sx, sy - ss * 0.02, { font: '800 ' + Math.round(ss * 0.5) + 'px ' + fonts.display, color: '#3b2b10' });
      }
      if (d.dark) { c.fillStyle = 'rgba(8, 16, 36, 0.38)'; c.fillRect(0, 0, W, H); }
    });
    // the replay: a few training episodes, then one test run with no random moves
    const segs = [];
    const peeks = (d.peeks || []).slice().sort((a, b) => a.ep - b.ep);
    const choose = [];
    if (peeks.length) {
      const want = [1, 10];
      for (const w of want) { const p = peeks.find((q) => q.ep >= w); if (p && !choose.includes(p)) choose.push(p); }
      const last = peeks[peeks.length - 1]; if (!choose.includes(last)) choose.push(last);
    }
    const fallCell = (prev) => (prev[0] === 2 ? [3, prev[1]] : [3, 1]);
    const lastEp = peeks.length ? peeks[peeks.length - 1].ep : 0;
    for (const pk of choose) {
      const nS = pk.pos.length / 2, len = d.epLen ? d.epLen[pk.ep - 1] : nS, falls = d.epFalls ? d.epFalls[pk.ep - 1] : pk.fell.reduce((s, v) => s + v, 0);
      const title = pk.ep === 1 ? 'Training episode 1. It has never seen a cliff.' : pk === peeks[peeks.length - 1] ? 'Episode ' + pk.ep + ', the last one of training.' : 'Training episode ' + pk.ep + '.';
      const sub = len + ' steps, ' + (falls ? 'fell ' + falls + (falls === 1 ? ' time' : ' times') + (falls >= 3 ? '. Ouch.' : '.') : 'no falls.') + (nS < len ? ' (Showing the first ' + nS + '.)' : '');
      // about 2.4 s of walking and at most 2.4 s of falling per episode, however long it was
      const nF = pk.fell.reduce((s, v) => s + v, 0), dt = clamp(2400 / Math.max(1, nS), 22, 170), fd = clamp(2400 / Math.max(1, nF), 240, 700), steps = [];
      let prev = START;
      for (let j = 0; j < nS; j++) {
        const to = [pk.pos[2 * j], pk.pos[2 * j + 1]], fell = !!pk.fell[j];
        steps.push({ from: prev, to, fell, via: fell ? fallCell(prev) : null, dur: fell ? dt + fd : dt, fd: fell ? fd : 0 });
        prev = to;
      }
      segs.push({ kind: 'train', ep: pk.ep, title, sub, steps, reached: !!pk.done && nS >= len });
    }
    if (d.test && d.test.length) {
      const steps = []; let prev = START;
      for (const st of d.test.slice(0, 80)) { const to = [st.s[0], st.s[1]], fell = !!st.f; steps.push({ from: prev, to, fell, via: fell ? fallCell(prev) : null, dur: fell ? 890 : 190, fd: fell ? 700 : 0 }); prev = to; }
      const reached = prev[0] === GOAL[0] && prev[1] === GOAL[1];
      segs.push({ kind: 'test', title: 'Test run: no random moves.', sub: reached ? 'Reached the goal in ' + d.test.length + ' steps.' : 'No goal after ' + d.test.length + ' steps.', steps, reached });
    }
    const TITLE = 1150, OUTRO = 650;
    let T = 0;
    for (const s of segs) {
      s.t0 = T; s.t1 = T + TITLE; s.starts = new Float64Array(s.steps.length);
      let u = s.t1; s.steps.forEach((st, j) => { st.t0 = u; s.starts[j] = u; u += st.dur; });
      s.t2 = u; T = u + OUTRO; s.t3 = T;
    }
    const ouch = d.sparse ? 'fell' : String(d.cliffPenalty == null ? -100 : d.cliffPenalty).replace('-', '−');
    const visits = new Float32Array(ROWS * cols);
    let t0 = null, pointer = { s: 0, k: 0 }, puffs = [];
    function resetVisits() { visits.fill(0); pointer = { s: 0, k: 0 }; puffs = []; }
    function advance(e) {
      while (pointer.s < segs.length) {
        const s = segs[pointer.s];
        if (s.kind === 'test') { pointer.s++; continue; }
        if (pointer.k >= s.steps.length) { pointer.s++; pointer.k = 0; continue; }
        const st = s.steps[pointer.k];
        if (st.t0 + st.dur > e) break;
        visits[st.to[0] * cols + st.to[1]] += 1; if (st.via) visits[st.via[0] * cols + st.via[1]] += 1;
        pointer.k++;
      }
    }
    function flag(x, y, s, t) {
      ctx.strokeStyle = '#3b2b20'; ctx.lineWidth = Math.max(1.5, s * 0.05); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s); ctx.stroke();
      ctx.fillStyle = '#ff7a2f'; ctx.beginPath(); ctx.moveTo(x, y - s);
      for (let q = 0; q <= 8; q++) ctx.lineTo(x + q * s * 0.07, y - s + Math.sin(t / 180 + q * 0.8) * s * 0.04);
      for (let q = 8; q >= 0; q--) ctx.lineTo(x + q * s * 0.07, y - s * 0.62 + Math.sin(t / 180 + q * 0.8) * s * 0.04);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + s * 0.28, y - s * 0.81 + Math.sin(t / 180 + 3.2) * s * 0.04, s * 0.07, 0, 7); ctx.fill();
    }
    function arrow(x, y, a, s) {
      const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][a];
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(s * 0.5, 0); ctx.lineTo(-s * 0.15, -s * 0.42); ctx.lineTo(-s * 0.15, -s * 0.16); ctx.lineTo(-s * 0.5, -s * 0.16); ctx.lineTo(-s * 0.5, s * 0.16); ctx.lineTo(-s * 0.15, s * 0.16); ctx.lineTo(-s * 0.15, s * 0.42); ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(30, 50, 30, 0.55)'; ctx.stroke();
      ctx.restore();
    }
    function draw(e) {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      // trodden ground: where the robot has walked in the episodes shown so far
      for (let r = 0; r < ROWS; r++) for (let k = 0; k < cols; k++) {
        const v = visits[r * cols + k]; if (!v || isCliff(r, k)) continue;
        ctx.fillStyle = 'rgba(214, 178, 118, ' + Math.min(0.62, 0.16 + 0.12 * Math.log(1 + v)) + ')';
        rr(ctx, ox + k * cell + cell * 0.08, oy + r * cell + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.2); ctx.fill();
      }
      const seg = e == null ? null : segs.find((s) => e < s.t3) || segs[segs.length - 1];
      const ended = e != null && (!segs.length || e >= T);
      if (d.arrows && (ended || (seg && seg.kind === 'test'))) {
        for (let r = 0; r < ROWS; r++) for (let k = 0; k < cols; k++) {
          if (isCliff(r, k) || (r === GOAL[0] && k === GOAL[1])) continue;
          const a = d.arrows[r * cols + k];
          if (a < 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(cx(k), cyy(r), cell * 0.04, 0, 7); ctx.fill(); }
          else arrow(cx(k), cyy(r) - cell * 0.12, a, cell * 0.28);
        }
      }
      flag(cx(cols - 1) + cell * 0.08, cyy(3) + cell * 0.18, cell * 0.62, t);
      // the robot
      let pos = [START[1], START[0]], o = { mood: 'normal', blink: blinkAt(t) }, fallY = 0;
      if (seg && e >= seg.t1) {
        const k = Math.max(0, upper(seg.starts, e) - 1), st = seg.steps[k];
        if (st) {
          const u = e - st.t0, mv = st.dur - st.fd, fall = st.fd * 0.75;
          if (!st.fell || u < mv) {
            const dest = st.fell ? st.via : st.to, q = ease(clamp(u / (mv * 0.85), 0, 1));
            pos = [lerp(st.from[1], dest[1], q), lerp(st.from[0], dest[0], q)];
            o.bob = -Math.abs(Math.sin((u / mv) * Math.PI)) * rs * 0.05;
            if (u >= st.dur) pos = [st.to[1], st.to[0]];
          } else if (u < mv + fall) { // falling
            const f = (u - mv) / fall;
            pos = [st.via[1], st.via[0]]; o.mood = 'wow'; o.scale = 1 - 0.85 * f; o.rot = f * 5; o.alpha = 1 - f * 0.6; o.noShadow = true; fallY = f * f * cell * 1.4;
            if (!puffs.some((p) => p.id === st)) puffs.push({ id: st, x: cx(st.via[1]), y: cyy(3) - cell * 0.4, born: e });
          } else { // back at the start
            const f = clamp((u - mv - fall) / (st.fd - fall), 0, 1);
            pos = [START[1], START[0]]; o.mood = 'dizzy'; o.scale = f < 1 ? 0.3 + 0.8 * f : 1;
          }
          if (u >= st.dur && k === seg.steps.length - 1 && seg.reached) o.mood = 'happy';
        }
      } else if (seg && e < seg.t1 && segs.indexOf(seg) > 0) {
        const prevSeg = segs[segs.indexOf(seg) - 1];
        if (e < seg.t0 + 300 && prevSeg.steps.length) { const l = prevSeg.steps[prevSeg.steps.length - 1].to; pos = [l[1], l[0]]; if (prevSeg.reached) o.mood = 'happy'; }
      }
      if (seg && e >= seg.t2 && seg.steps.length) { const l = seg.steps[seg.steps.length - 1].to; pos = [l[1], l[0]]; o.mood = seg.reached ? 'happy' : 'sad'; if (seg.reached && seg.kind === 'test') o.wave = true; }
      robot(ctx, ox + (pos[0] + 0.5) * cell, oy + (pos[1] + 0.5) * cell + cell * 0.3 + fallY, rs, o);
      // the penalty pops up where it fell
      puffs = puffs.filter((p) => e != null && e - p.born < 1000 && e >= p.born);
      for (const p of puffs) {
        const dt = e - p.born;
        ctx.globalAlpha = clamp(1.5 - dt / 700, 0, 1);
        text(ctx, ouch, p.x, p.y - dt * 0.035, { font: '800 ' + Math.max(12, cell * 0.3) + 'px ' + fonts.mono, color: '#ff6b6b', stroke: 'rgba(0,0,0,0.75)', lw: 3 });
        for (let q = 0; q < 6; q++) { const a = q * 1.05 + 0.3; ctx.fillStyle = 'rgba(200, 170, 130, 0.7)'; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * dt * 0.03, rimY + Math.sin(a) * dt * 0.012, 2.4, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      // labels in the canyon
      const px = Math.max(10, Math.min(13, below * 0.17)), ly = H - px * 1.75 - 6;
      if (!segs.length) pill(ctx, 'Press Run: the robot learns this map.', 8, ly, px, fonts.mono);
      else if (seg) {
        const lab = seg.kind === 'test' ? seg.title + ' ' + (e >= seg.t2 ? seg.sub : '') : 'Episode ' + seg.ep + ' of ' + lastEp.toLocaleString('en-US') + (e >= seg.t2 ? '. ' + seg.sub : '');
        hud(ctx, [lab.trim()], ended ? 'replay' : 'next ▶', ly, px, fonts.mono, W);
        if (e < seg.t1) { // a title card over the map
          const a = clamp(Math.min((e - seg.t0) / 200, (seg.t1 - e) / 200), 0, 1), fs = Math.max(13, Math.min(22, cell * 0.36));
          ctx.globalAlpha = a;
          ctx.font = '700 ' + fs + 'px ' + fonts.display; const tw = Math.max(ctx.measureText(seg.title).width, (ctx.font = '500 ' + fs * 0.62 + 'px ' + fonts.mono, ctx.measureText(seg.kind === 'test' ? 'Arrows: its favorite move in each cell.' : seg.sub).width)) + fs * 1.6;
          rr(ctx, W / 2 - tw / 2, oy + cell * 0.55, tw, fs * 2.9, fs * 0.5); ctx.fillStyle = 'rgba(12, 16, 12, 0.78)'; ctx.fill();
          text(ctx, seg.title, W / 2, oy + cell * 0.55 + fs * 1.0, { font: '700 ' + fs + 'px ' + fonts.display, color: '#fff' });
          text(ctx, seg.kind === 'test' ? 'Arrows: its favorite move in each cell.' : seg.sub, W / 2, oy + cell * 0.55 + fs * 2.1, { font: '500 ' + fs * 0.62 + 'px ' + fonts.mono, color: '#d9e8cf' });
          ctx.globalAlpha = 1;
        }
      }
    }
    return {
      frame(ts) {
        if (!segs.length) { draw(null); return; }
        if (ts === Infinity) { t0 = now() - T - 10; resetVisits(); advance(T); draw(T + 5); return; }
        if (t0 == null) t0 = ts;
        const e = ts - t0;
        advance(e); draw(e);
      },
      click() {
        if (!segs.length) return;
        const e = now() - (t0 == null ? now() : t0);
        if (e >= T) { t0 = now(); resetVisits(); return; }
        const s = segs.find((q) => e < q.t3);
        const next = segs[segs.indexOf(s) + 1];
        const to = next ? next.t0 : T;
        t0 = now() - to; advance(to);
      },
      busy() { return segs.length > 0 && t0 != null && now() - t0 < T + 400; },
      duration: T + 400,
    };
  };

  // a looping replay of n steps of `step` ms, then `hold` ms on the last frame
  function loopAt(e, n, step, hold) {
    const T = n * step + hold, u = ((e % T) + T) % T;
    return { k: Math.min(n - 1, Math.floor(u / step)), f: Math.min(1, (u % step) / step), end: u >= n * step, after: u - n * step };
  }
  // the common shell of a looping scene: draw(e) with e in ms since the start; a click restarts it
  function looping(draw, has, duration) {
    let t0 = null;
    return {
      frame(ts) { if (!has) { draw(null); return; } if (ts === Infinity) { draw(Infinity); return; } if (t0 == null) t0 = ts; draw(Math.max(0, ts - t0)); },
      click() { t0 = now(); },
      busy() { return has; }, duration,
    };
  }
  // a workshop wall: pegboard, a shelf and a few tool outlines
  function workshop(c, W, H, fonts, dark, benchY) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d9cdb8'); g.addColorStop(1, '#c4b498');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // tool outlines on the board
    c.strokeStyle = 'rgba(60, 45, 30, 0.28)'; c.lineWidth = 3; c.lineCap = 'round';
    const tools = [[0.07, 0.2], [0.12, 0.28], [0.88, 0.22], [0.93, 0.3]];
    tools.forEach(([fx, fy], i) => {
      const x = fx * W, y = fy * H, s = Math.min(W, H) * 0.14;
      c.beginPath();
      if (i % 2 === 0) { c.moveTo(x, y); c.lineTo(x, y + s); c.moveTo(x - s * 0.12, y + s * 0.08); c.arc(x, y + s * 0.08, s * 0.12, Math.PI, 0); }
      else { c.moveTo(x, y); c.lineTo(x, y + s * 0.6); c.lineWidth = 6; c.stroke(); c.beginPath(); c.lineWidth = 3; c.moveTo(x, y + s * 0.6); c.lineTo(x, y + s); }
      c.stroke();
    });
    c.lineCap = 'butt';
    // the bench
    const bg = c.createLinearGradient(0, benchY, 0, H);
    bg.addColorStop(0, '#9a6b43'); bg.addColorStop(0.12, '#7d5233'); bg.addColorStop(1, '#5c3a22');
    c.fillStyle = bg; c.fillRect(0, benchY, W, H - benchY);
    c.fillStyle = 'rgba(255, 220, 170, 0.35)'; c.fillRect(0, benchY, W, 2);
    for (let i = 0; i < 6; i++) { c.strokeStyle = 'rgba(40, 20, 10, 0.18)'; c.lineWidth = 1; c.beginPath(); const y = benchY + 6 + i * (H - benchY) / 6; c.moveTo(0, y); c.bezierCurveTo(W * 0.3, y + 3, W * 0.7, y - 3, W, y + 1); c.stroke(); }
    if (dark) { c.fillStyle = 'rgba(8, 12, 24, 0.45)'; c.fillRect(0, 0, W, H); }
  }

  // ---------------------------------------------------------------- balance: CartPole as a robot with a broom on its head
  // d: { trace: [{ s: [x, x', angle, angle'] }], xMax, thMax, pole (length factor), fonts, dark }
  SC.balance = function (ctx, W, H, d) {
    const fonts = d.fonts, tr = d.trace || [], n = tr.length, STEP = 20;
    const floorY = H * 0.84, rs = Math.min(H * 0.3, W * 0.11), span = W * 0.8;
    const sx = (x) => W / 2 + (x / d.xMax) * (span / 2);
    const poleLen = Math.min(H * 0.38, rs * 1.45) * (d.pole || 1) ** 0.5;
    const last = n ? tr[n - 1].s : null;
    const fell = !!last && (Math.abs(last[2]) > d.thMax || Math.abs(last[0]) > d.xMax);
    const bg = layer(ctx, W, H, (c) => {
      // the back curtain
      const g = c.createLinearGradient(0, 0, 0, floorY);
      g.addColorStop(0, '#3b0b14'); g.addColorStop(1, '#7a1626');
      c.fillStyle = g; c.fillRect(0, 0, W, floorY);
      for (let x = 0; x < W; x += 26) {
        const fg = c.createLinearGradient(x, 0, x + 26, 0);
        fg.addColorStop(0, 'rgba(0,0,0,0.28)'); fg.addColorStop(0.5, 'rgba(255,180,180,0.08)'); fg.addColorStop(1, 'rgba(0,0,0,0.28)');
        c.fillStyle = fg; c.fillRect(x, 0, 26, floorY);
      }
      // side curtains
      for (const side of [0, 1]) {
        const x0 = side ? W : 0, w = W * 0.07;
        c.fillStyle = '#5a0d1a'; c.beginPath(); c.moveTo(x0, 0); c.lineTo(side ? W - w : w, 0);
        c.quadraticCurveTo(side ? W - w * 0.3 : w * 0.3, floorY * 0.55, side ? W - w * 1.1 : w * 1.1, floorY); c.lineTo(x0, floorY); c.closePath(); c.fill();
      }
      c.fillStyle = '#c99a2e'; c.fillRect(0, 0, W, H * 0.035);
      for (let x = 10; x < W; x += 30) { c.fillStyle = '#e8bd4a'; c.beginPath(); c.arc(x, H * 0.035, 5, 0, Math.PI); c.fill(); }
      // the stage floor
      const fl = c.createLinearGradient(0, floorY, 0, H);
      fl.addColorStop(0, '#a87543'); fl.addColorStop(1, '#6e4524');
      c.fillStyle = fl; c.fillRect(0, floorY, W, H - floorY);
      c.strokeStyle = 'rgba(40, 20, 8, 0.3)'; c.lineWidth = 1;
      for (let i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(W / 2 + i * W * 0.05, floorY); c.lineTo(W / 2 + i * W * 0.09, H); c.stroke(); }
      // the rail and its end stops
      c.fillStyle = '#4d5359'; c.fillRect(sx(-d.xMax) - 6, floorY - 3, sx(d.xMax) - sx(-d.xMax) + 12, 5);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(sx(-d.xMax) - 6, floorY - 3, sx(d.xMax) - sx(-d.xMax) + 12, 1);
      for (const e of [-1, 1]) {
        const x = sx(e * d.xMax) + e * rs * 0.42, h = rs * 0.5;
        for (let q = 0; q < 5; q++) { c.fillStyle = q % 2 ? '#1e1e1e' : '#ffcf3f'; c.fillRect(x - 5, floorY - h + q * h / 5, 10, h / 5); }
      }
      if (d.dark) { c.fillStyle = 'rgba(6, 8, 20, 0.35)'; c.fillRect(0, 0, W, H); }
    });
    function broom(px, py, th) {
      const tx = px + Math.sin(th) * poleLen, ty = py - Math.cos(th) * poleLen;
      ctx.lineCap = 'round'; ctx.strokeStyle = '#6b3f1f'; ctx.lineWidth = Math.max(3, rs * 0.07);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = '#a0683a'; ctx.lineWidth = Math.max(1, rs * 0.025);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke(); ctx.lineCap = 'butt';
      // the bristles at the top: the heavy end
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(th);
      const bw = rs * 0.34, bh = rs * 0.42;
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-bw * 0.32, -bh * 0.12, bw * 0.64, bh * 0.16);
      ctx.fillStyle = '#e9c46a'; ctx.beginPath(); ctx.moveTo(-bw * 0.32, -bh * 0.12); ctx.lineTo(-bw * 0.6, -bh); ctx.lineTo(bw * 0.6, -bh); ctx.lineTo(bw * 0.32, -bh * 0.12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 20, 0.6)'; ctx.lineWidth = 1;
      for (let q = -4; q <= 4; q++) { ctx.beginPath(); ctx.moveTo(q * bw * 0.07, -bh * 0.14); ctx.lineTo(q * bw * 0.13, -bh); ctx.stroke(); }
      ctx.restore();
    }
    const draw = (e) => {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      let s = [0, 0, 0, 0], mood = 'normal', k = 0, end = false, after = 0;
      if (n && e != null) {
        const L = e === Infinity ? { k: n - 1, end: true, after: 2000 } : loopAt(e, n, STEP, 2400);
        k = L.k; end = L.end; after = L.after; s = tr[k].s.slice();
        mood = Math.abs(s[2]) < 0.05 ? 'happy' : Math.abs(s[2]) < 0.13 ? 'normal' : 'wow';
        if (end && fell) { s[2] = Math.sign(s[2] || 1) * Math.min(1.45, Math.abs(s[2]) + (after / 450) ** 2 * 1.3); mood = after > 350 ? 'dizzy' : 'wow'; }
        else if (end) mood = 'happy';
      }
      const rx = sx(s[0]);
      // a spotlight that follows the robot
      const sg = ctx.createRadialGradient(rx, floorY, 4, rx, floorY, rs * 1.6);
      sg.addColorStop(0, 'rgba(255, 240, 200, 0.4)'); sg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(rx, floorY, rs * 1.6, rs * 0.35, 0, 0, 7); ctx.fill();
      const beam = ctx.createLinearGradient(0, 0, 0, floorY);
      beam.addColorStop(0, 'rgba(255, 240, 200, 0.0)'); beam.addColorStop(1, 'rgba(255, 240, 200, 0.12)');
      ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(rx - rs * 0.25, 0); ctx.lineTo(rx + rs * 0.25, 0); ctx.lineTo(rx + rs * 1.4, floorY); ctx.lineTo(rx - rs * 1.4, floorY); ctx.closePath(); ctx.fill();
      // dust behind the wheels when it moves fast
      if (Math.abs(s[1]) > 0.6) for (let q = 0; q < 3; q++) { ctx.fillStyle = 'rgba(230, 210, 180, ' + (0.35 - q * 0.1) + ')'; ctx.beginPath(); ctx.arc(rx - Math.sign(s[1]) * rs * (0.35 + q * 0.14), floorY - rs * 0.05 - q * 2, rs * (0.05 + q * 0.02), 0, 7); ctx.fill(); }
      robot(ctx, rx, floorY, rs, { mood, blink: blinkAt(t), arms: 'out', tilt: clamp(s[2] * 2.5, -0.5, 0.5), look: clamp(Math.sin(s[2]) * 6, -1, 1) });
      broom(rx, floorY - rs * 0.95, s[2]);
      const px = Math.max(10, Math.min(13, H * 0.034)), secs = (k + 1) * 0.02;
      if (!n) hud(ctx, ['Press Run: the robot learns to balance a broom.'], null, H * 0.05, px, fonts.mono, W);
      else hud(ctx, [end ? (fell ? 'Fell after ' + secs.toFixed(1) + ' s.' : 'Still up after ' + secs.toFixed(1) + ' s, the end of the test.') : 'Test run, ' + secs.toFixed(1) + ' s'], 'replay', H * 0.05, px, fonts.mono, W);
      if (!n) bubbleSide(ctx, 'Hold my broom.', rx - rs * 0.32, rx + rs * 0.32, floorY - rs * 0.6, Math.max(10, Math.min(14, rs * 0.16)), fonts.display, W);
    };
    return looping(draw, n > 0, n * STEP + 2400);
  };

  // ---------------------------------------------------------------- doors: the mirage (two doors, machines behind the left one)
  // d: { left: 0/1 per training episode, ret: return per episode, qA: [right door, left door] | null, mean, nB, fonts, dark }
  SC.doors = function (ctx, W, H, d) {
    const fonts = d.fonts, L = d.left || [], N = L.length;
    const floorY = H * 0.86, rs = Math.min(H * 0.3, W * 0.11);
    const leftDoor = { x: W * 0.2, w: W * 0.24 }, exitDoor = { x: W * 0.8, w: W * 0.13 }, home = W * 0.52;
    const doorH = H * 0.56, doorTop = floorY - doorH;
    const bg = layer(ctx, W, H, (c) => {
      // hallway wall
      const g = c.createLinearGradient(0, 0, 0, floorY);
      g.addColorStop(0, '#e7dcc6'); g.addColorStop(1, '#d6c6a8');
      c.fillStyle = g; c.fillRect(0, 0, W, floorY);
      c.fillStyle = 'rgba(120, 90, 50, 0.08)';
      for (let x = 0; x < W; x += 30) c.fillRect(x, 0, 14, floorY);
      c.fillStyle = '#8c6a46'; c.fillRect(0, floorY - H * 0.06, W, H * 0.06);
      // floor tiles
      for (let x = 0, i = 0; x < W; x += 28, i++) for (let y = floorY, j = 0; y < H; y += 12, j++) { c.fillStyle = (i + j) % 2 ? '#3f4652' : '#e9e4d8'; c.fillRect(x, y, 28, 12); }
      // the casino through the left door
      const ax = leftDoor.x - leftDoor.w / 2;
      c.save(); rr(c, ax, doorTop, leftDoor.w, doorH + 2, [leftDoor.w * 0.5, leftDoor.w * 0.5, 0, 0]); c.clip();
      const cg = c.createLinearGradient(0, doorTop, 0, floorY);
      cg.addColorStop(0, '#1a0b24'); cg.addColorStop(1, '#3a1436');
      c.fillStyle = cg; c.fillRect(ax, doorTop, leftDoor.w, doorH + 2);
      const nm = Math.min(3, Math.max(1, d.nB || 10)), slotW = leftDoor.w * 0.84 / nm, mw = slotW * 0.72, mh = Math.min(doorH * 0.62, mw * 1.9);
      for (let i = 0; i < nm; i++) machine(c, ax + leftDoor.w * 0.08 + i * slotW + (slotW - mw) / 2 - slotW * 0.05, floorY - doorH * 0.1, mw, mh, { i, hue: HUES[i], glow: 0, lever: 0, count: '', lights: i * 300 }, fonts);
      c.fillStyle = '#4a0f1f'; c.fillRect(ax, floorY - doorH * 0.1, leftDoor.w, doorH * 0.1 + 2);
      c.restore();
      c.lineWidth = 6; c.strokeStyle = '#6b4a2b'; rr(c, ax, doorTop, leftDoor.w, doorH + 2, [leftDoor.w * 0.5, leftDoor.w * 0.5, 0, 0]); c.stroke();
      // the exit door
      const ex = exitDoor.x - exitDoor.w / 2, eh = doorH * 0.86;
      c.fillStyle = '#5d7f5a'; rr(c, ex, floorY - eh, exitDoor.w, eh, 4); c.fill();
      c.strokeStyle = '#3c5639'; c.lineWidth = 3; c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 2; c.strokeRect(ex + exitDoor.w * 0.15, floorY - eh * 0.9, exitDoor.w * 0.7, eh * 0.35); c.strokeRect(ex + exitDoor.w * 0.15, floorY - eh * 0.48, exitDoor.w * 0.7, eh * 0.4);
      c.fillStyle = '#e9c46a'; c.beginPath(); c.arc(ex + exitDoor.w * 0.82, floorY - eh * 0.5, 3.5, 0, 7); c.fill();
      // signs above the doors
      const sgn = (x, y, s, bgc, fg) => { c.font = '800 ' + Math.max(10, H * 0.045) + 'px ' + fonts.display; const w = c.measureText(s).width + 16; rr(c, x - w / 2, y, w, H * 0.075, 5); c.fillStyle = bgc; c.fill(); text(c, s, x, y + H * 0.04, { font: c.font, color: fg }); };
      sgn(exitDoor.x, floorY - eh - H * 0.11, 'EXIT', '#2f7d4f', '#eafff0');
      c.save(); c.shadowColor = '#ff4fd8'; c.shadowBlur = 10; sgn(leftDoor.x, doorTop - H * 0.12, 'MACHINES', '#2a0f33', '#ffd1f4'); c.restore();
      if (d.dark) { c.fillStyle = 'rgba(6, 8, 20, 0.35)'; c.fillRect(0, 0, W, H); }
    });
    // replay schedule: a few slow episodes, then faster, then fast-forward
    const SLOW = Math.min(N, 5), MID = Math.min(N, 30), FAST = Math.max(0.5, 2600 / Math.max(1, N - MID));
    const dur = (i) => (i < SLOW ? 1300 : i < MID ? 160 : FAST);
    const start = new Float64Array(N + 1); for (let i = 0; i < N; i++) start[i + 1] = start[i] + dur(i);
    const T = start[N];
    let t0 = null, popups = [], seen = 0, nLeft = 0;
    const doorX = (left) => (left ? leftDoor.x : exitDoor.x);
    function advance(e) {
      if (e < start[seen]) { seen = 0; nLeft = 0; popups = []; }
      while (seen < N && start[seen + 1] <= e) {
        const i = seen; if (L[i]) nLeft++; seen++;
        if (i < MID) { popups = popups.filter((p) => p.left !== !!L[i]); popups.push({ left: !!L[i], s: L[i] ? signed(d.ret[i]) : '0', c: L[i] ? (d.ret[i] >= 0 ? '#2e9d57' : '#c0392b') : '#56636b', born: start[i] + dur(i) * 0.62 }); }
      }
    }
    function draw(e) {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      const done = N > 0 && e != null && e >= T;
      let rx = home, alpha = 1, mood = 'normal';
      const cur = N && e != null && !done ? Math.max(0, upper(start, e) - 1) : -1;
      if (cur >= 0) {
        const p = (e - start[cur]) / dur(cur), dx = doorX(!!L[cur]);
        if (p < 0.45) rx = lerp(home, dx, ease(p / 0.45));
        else if (p < 0.8) { rx = dx; alpha = clamp(1 - (p - 0.45) / 0.12, 0, 1); }
        else { rx = home; alpha = clamp((p - 0.8) / 0.15, 0, 1); }
        if (cur >= MID) { alpha = 1; rx = home + (L[cur] ? -1 : 1) * W * 0.04; }
        const last = popups[popups.length - 1];
        if (cur < SLOW && last && e - last.born < 600 && e > last.born) mood = last.s.startsWith('+') ? 'happy' : last.s === '0' ? 'normal' : 'sad';
      }
      if (done && d.qA) mood = d.qA[1] > d.qA[0] ? 'happy' : 'normal';
      robot(ctx, rx, floorY - H * 0.01, rs, { mood, blink: blinkAt(t), alpha, look: cur >= 0 ? (L[cur] ? -1 : 1) : 0 });
      // payouts over the doors
      const at = e == null ? 0 : e;
      popups = popups.filter((q) => at - q.born < 900);
      for (const q of popups) {
        const dt = at - q.born; if (dt < 0) continue;
        ctx.globalAlpha = clamp(1.4 - dt / 650, 0, 1);
        text(ctx, q.s, doorX(q.left), (q.left ? doorTop + doorH * 0.32 : floorY - doorH * 0.86 * 0.55) - dt * 0.03, { font: '800 ' + Math.max(13, H * 0.06) + 'px ' + fonts.mono, color: q.c, stroke: 'rgba(255,255,255,0.85)', lw: 3 });
        ctx.globalAlpha = 1;
      }
      // the tally board under each sign
      const px = Math.max(10, Math.min(13, H * 0.034));
      if (N && e != null && seen) {
        const share = nLeft / seen;
        pill(ctx, 'chosen ' + Math.round(100 * share) + '%', leftDoor.x, doorTop + doorH * 0.04, px, fonts.mono, 'center');
        pill(ctx, 'chosen ' + Math.round(100 * (1 - share)) + '%', exitDoor.x, floorY - doorH * 0.86 + doorH * 0.04, px, fonts.mono, 'center');
      }
      if (done && d.qA) {
        const lines = (x, y, truth, belief) => { pill(ctx, 'true average ' + truth, x, y, px, fonts.mono, 'center'); pill(ctx, 'robot thinks ' + signed(belief), x, y + px * 2.1, px, fonts.mono, 'center'); };
        lines(leftDoor.x, doorTop + doorH * 0.04 + px * 2.3, signed(d.mean), d.qA[1]);
        lines(exitDoor.x, floorY - doorH * 0.86 + doorH * 0.04 + px * 2.3, '+0.00', d.qA[0]);
      }
      if (!N) hud(ctx, ['Press Run: the robot picks a door, many times.'], null, 6, px, fonts.mono, W);
      else if (!done) hud(ctx, [(d.label || 'Run 1') + ', training episode ' + (cur + 1).toLocaleString('en-US') + ' of ' + N.toLocaleString('en-US') + (cur < SLOW ? '' : cur < MID ? ' ▶▶' : ' ▶▶▶')], 'skip ▶', 6, px, fonts.mono, W);
      else hud(ctx, ['After training. Behind the left door, every machine pays ' + signed(d.mean) + ' on average.'], 'replay', 6, px, fonts.mono, W);
      if (done && d.qA) bubbleSide(ctx, d.qA[1] > d.qA[0] ? 'Left door. Feeling lucky!' : 'Exit. Not falling for it.', rx - rs * 0.32, rx + rs * 0.32, floorY - rs * 0.6, Math.max(10, Math.min(14, rs * 0.16)), fonts.display, W);
    }
    return {
      frame(ts) { if (!N) { draw(null); return; } if (ts === Infinity) { advance(T + 1); draw(T + 1); return; } if (t0 == null) t0 = ts; const e = Math.max(0, ts - t0); advance(e); draw(e); },
      click() { if (!N) return; const e = now() - (t0 == null ? now() : t0); if (e < T) { t0 = now() - T; } else t0 = now(); },
      busy() { return N > 0 && t0 != null && now() - t0 < T + 400; }, duration: T + 400,
    };
  };

  // ---------------------------------------------------------------- lab: the goal grid (a robot finds its charger)
  // d: { N, wall (0/1), trace: [{ s: [x, y, gx, gy] }], start: [x, y, gx, gy] | null, fonts, dark }
  SC.lab = function (ctx, W, H, d) {
    const fonts = d.fonts, N = d.N, tr = d.trace || [], n = tr.length;
    const cell = Math.min(W * 0.9, H * 0.88) / N, gw = cell * N, ox = (W - gw) / 2, oy = (H - gw) / 2;
    const wallX = Math.floor(N / 2), gapY = Math.floor(N / 2), isWall = (x, y) => d.wall && x === wallX && y !== gapY;
    const P = (x, y) => [ox + (x + 0.5) * cell, oy + (N - y - 0.5) * cell];
    const bg = layer(ctx, W, H, (c) => {
      c.fillStyle = '#b9c3c9'; c.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 34) for (let y = 0; y < H; y += 34) { c.fillStyle = ((x + y) / 34) % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.03)'; c.fillRect(x, y, 34, 34); }
      // shelves along the sides, outside the taped area
      for (const side of [0, 1]) {
        const x0 = side ? ox + gw + 14 : 8, x1 = side ? W - 8 : ox - 14;
        if (x1 - x0 < 30) continue;
        for (let y = 12; y < H - 30; y += 46) {
          c.fillStyle = '#7b8a93'; c.fillRect(x0, y + 30, x1 - x0, 5);
          for (let x = x0 + 4; x < x1 - 18; x += 24) { const h = 14 + 12 * hash(x + y); c.fillStyle = ['#d98c3f', '#4f8fbf', '#9bbf5a', '#c75b5b'][Math.floor(hash(x * 3 + y) * 4)]; c.fillRect(x, y + 30 - h, 18, h); }
        }
      }
      // the taped area
      c.fillStyle = '#dfe5e8'; c.fillRect(ox, oy, gw, gw);
      c.strokeStyle = 'rgba(70, 90, 100, 0.25)'; c.lineWidth = 1;
      for (let i = 1; i < N; i++) { c.beginPath(); c.moveTo(ox + i * cell, oy); c.lineTo(ox + i * cell, oy + gw); c.moveTo(ox, oy + i * cell); c.lineTo(ox + gw, oy + i * cell); c.stroke(); }
      const tape = Math.max(4, cell * 0.12);
      c.save(); c.beginPath(); c.rect(ox - tape, oy - tape, gw + 2 * tape, gw + 2 * tape); c.rect(ox, oy, gw, gw); c.clip('evenodd');
      for (let k = -H; k < W + H; k += tape * 2) { c.fillStyle = '#f2c230'; c.beginPath(); c.moveTo(k, 0); c.lineTo(k + tape, 0); c.lineTo(k + tape + H, H); c.lineTo(k + H, H); c.closePath(); c.fill(); }
      c.fillStyle = 'rgba(30,30,30,0.85)';
      for (let k = -H + tape; k < W + H; k += tape * 2) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + tape, 0); c.lineTo(k + tape + H, H); c.lineTo(k + H, H); c.closePath(); c.fill(); }
      c.restore();
      // the wall: a stack of crates with one gap
      for (let y = 0; y < N; y++) if (isWall(wallX, y)) {
        const [px, py] = P(wallX, y), s = cell * 0.92;
        c.fillStyle = '#b07a45'; c.fillRect(px - s / 2, py - s / 2, s, s);
        c.strokeStyle = '#6e4724'; c.lineWidth = Math.max(1.5, cell * 0.05); c.strokeRect(px - s / 2, py - s / 2, s, s);
        c.beginPath(); c.moveTo(px - s / 2, py - s / 2); c.lineTo(px + s / 2, py + s / 2); c.moveTo(px + s / 2, py - s / 2); c.lineTo(px - s / 2, py + s / 2); c.stroke();
      }
      if (d.dark) { c.fillStyle = 'rgba(6, 10, 22, 0.4)'; c.fillRect(0, 0, W, H); }
    });
    function charger(x, y, t, on) {
      const r = cell * 0.36, pulse = 0.5 + 0.5 * Math.sin(t / 260);
      ctx.save(); ctx.shadowColor = '#46e88a'; ctx.shadowBlur = cell * (0.2 + 0.25 * pulse);
      ctx.fillStyle = on ? '#46e88a' : '#2fbf6a'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#1d5c38'; ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe14d'; ctx.beginPath();
      ctx.moveTo(x + r * 0.12, y - r * 0.55); ctx.lineTo(x - r * 0.28, y + r * 0.08); ctx.lineTo(x - r * 0.02, y + r * 0.08); ctx.lineTo(x - r * 0.12, y + r * 0.55); ctx.lineTo(x + r * 0.28, y - r * 0.08); ctx.lineTo(x + r * 0.02, y - r * 0.08); ctx.closePath(); ctx.fill();
    }
    const draw = (e) => {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      const st0 = d.start || (n ? tr[0].s : [0, 0, N - 1, N - 1]);
    const at = (j) => (j < 0 || !n ? st0 : tr[j].s);
      let k = -1, end = false, f = 0;
      if (n && e != null) { const Lp = e === Infinity ? { k: n - 1, end: true, f: 1 } : loopAt(e, n + 1, 230, 1600); k = Lp.k - 1; end = Lp.end; f = Lp.f; }
      const goal = [at(Math.max(0, k))[2], at(Math.max(0, k))[3]];
      const reached = n > 0 && tr[n - 1].s[0] === tr[n - 1].s[2] && tr[n - 1].s[1] === tr[n - 1].s[3];
      charger(...P(goal[0], goal[1]), t, end && reached);
      // footprints of this attempt
      ctx.fillStyle = 'rgba(70, 90, 110, 0.35)';
      for (let j = -1; j < k; j++) { const [px, py] = P(at(j)[0], at(j)[1]); ctx.beginPath(); ctx.arc(px, py + cell * 0.18, cell * 0.06, 0, 7); ctx.fill(); }
      const a = at(Math.max(-1, k - 1)), b = at(k), q = end ? 1 : ease(clamp(f * 1.4, 0, 1));
      const [ax, ay] = P(a[0], a[1]), [bx, by] = P(b[0], b[1]);
      const mood = end ? (reached ? 'happy' : 'sad') : 'normal';
      robot(ctx, lerp(ax, bx, q), lerp(ay, by, q) + cell * 0.3, cell * 0.85, { mood, blink: blinkAt(t), wave: end && reached, look: clamp(bx - ax, -1, 1) });
      const px = Math.max(10, Math.min(13, H * 0.034));
      if (!n) hud(ctx, ['Press Run: new start, new charger, every attempt.'], null, 6, px, fonts.mono, W);
      else hud(ctx, [end ? (reached ? 'Test: charger reached in ' + n + ' steps.' : 'Test: out of time after ' + n + ' steps.') : 'Test run, step ' + Math.max(0, k + 1) + ' of ' + n], 'replay', 6, px, fonts.mono, W);
    };
    return looping(draw, n > 0, (n + 1) * 230 + 1600);
  };

  // ---------------------------------------------------------------- joint: the pendulum as one servo with a weight
  // d: { trace: [{ s: [angle, speed, torque] }], mass, fonts, dark }
  SC.joint = function (ctx, W, H, d) {
    const fonts = d.fonts, tr = d.trace || [], n = tr.length, STEP = 50;
    const benchY = H * 0.9, cx = W / 2, cy = H * 0.52, r = Math.min(W, H) * 0.36;
    const bg = layer(ctx, W, H, (c) => {
      workshop(c, W, H, fonts, d.dark, benchY);
      // the wall plate that holds the servo
      rr(c, cx - r * 0.26, cy - r * 0.22, r * 0.52, r * 0.44, r * 0.05); c.fillStyle = '#7d8790'; c.fill(); c.strokeStyle = '#4a535b'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#4a535b'; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.arc(cx + a * r * 0.19, cy + b * r * 0.15, r * 0.025, 0, 7); c.fill(); }
      // the goal: straight up
      c.setLineDash([4, 6]); c.strokeStyle = 'rgba(46, 125, 50, 0.7)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - r * 1.15); c.stroke(); c.setLineDash([]);
      text(c, 'up here', cx + r * 0.08, cy - r * 1.1, { align: 'left', font: '700 ' + Math.max(10, r * 0.1) + 'px ' + fonts.display, color: '#2e7d32', stroke: 'rgba(255,255,255,0.7)', lw: 3 });
    });
    const draw = (e) => {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      let k = 0, end = false, s = [Math.PI, 0, 0];
      if (n && e != null) { const L = e === Infinity ? { k: n - 1, end: true } : loopAt(e, n, STEP, 1500); k = L.k; end = L.end; s = tr[k].s; }
      const th = s[0], tip = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
      // a fading trail of the weight
      for (let j = Math.max(0, k - 14); j < k; j++) { const [x, y] = tip(tr[j].s[0]); ctx.fillStyle = 'rgba(220, 120, 40, ' + (0.04 + 0.03 * (j - k + 14)) + ')'; ctx.beginPath(); ctx.arc(x, y, r * 0.06, 0, 7); ctx.fill(); }
      // the link: an aluminium bar with holes
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(th);
      const lg = ctx.createLinearGradient(-r * 0.06, 0, r * 0.06, 0); lg.addColorStop(0, '#9aa5ad'); lg.addColorStop(0.5, '#e9eef1'); lg.addColorStop(1, '#8a959d');
      rr(ctx, -r * 0.055, -r, r * 0.11, r * 1.05, r * 0.05); ctx.fillStyle = lg; ctx.fill(); ctx.strokeStyle = '#59646c'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#59646c'; for (let q = 1; q < 6; q++) { ctx.beginPath(); ctx.arc(0, -r * q / 6.3, r * 0.018, 0, 7); ctx.fill(); }
      const wr = r * (0.08 + 0.03 * (d.mass || 1));
      const wg = ctx.createRadialGradient(-wr * 0.3, -r - wr * 0.3, 1, 0, -r, wr); wg.addColorStop(0, '#ffb070'); wg.addColorStop(1, '#c4561c');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(0, -r, wr, 0, 7); ctx.fill(); ctx.strokeStyle = '#7a3410'; ctx.stroke();
      ctx.restore();
      // the servo, with the torque it applies as an arc
      rr(ctx, cx - r * 0.16, cy - r * 0.12, r * 0.32, r * 0.24, r * 0.04); ctx.fillStyle = '#23292e'; ctx.fill();
      text(ctx, 'servo', cx, cy + r * 0.07, { font: '600 ' + Math.max(7, r * 0.06) + 'px ' + fonts.mono, color: '#9aa5ad' });
      ctx.fillStyle = '#c9d1d8'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.05, 0, 7); ctx.fill();
      if (s[2]) {
        ctx.strokeStyle = 'rgba(255, 120, 40, 0.9)'; ctx.lineWidth = Math.max(3, r * 0.035); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.26, -Math.PI / 2, -Math.PI / 2 + s[2] * 2.2, s[2] < 0); ctx.stroke(); ctx.lineCap = 'butt';
      }
      // a small robot fan by the bench
      const up = Math.abs(((th + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.3;
      robot(ctx, W * 0.16, benchY + H * 0.02, Math.min(H * 0.3, W * 0.1), { mood: up ? 'happy' : 'normal', wave: up && n > 0, blink: blinkAt(t), look: 1 });
      const px = Math.max(10, Math.min(13, H * 0.034));
      if (!n) hud(ctx, ['Press Run: a weak motor learns to swing the weight up.'], null, 6, px, fonts.mono, W);
      else hud(ctx, ['Replay, ' + ((k + 1) * 0.05).toFixed(1) + ' s' + (up ? ', up!' : '') + (end ? ' (end)' : '')], 'replay', 6, px, fonts.mono, W);
    };
    return looping(draw, n > 0, n * STEP + 1500);
  };

  // ---------------------------------------------------------------- arm: the 2-joint reach (side view, with payload)
  // d: { trace: [{ s: [q1, q2, dq1, dq2, tx, ty, holding] }], state (before a run), L1, L2, fonts, dark }
  SC.arm = function (ctx, W, H, d) {
    const fonts = d.fonts, tr = d.trace || [], n = tr.length, STEP = 50, L1 = d.L1, L2 = d.L2;
    const benchY = H * 0.94, s = Math.min(W, H) * 0.44, cx = W / 2, cy = H * 0.5, P = (x, y) => [cx + x * s, cy - y * s];
    const bg = layer(ctx, W, H, (c) => {
      workshop(c, W, H, fonts, d.dark, benchY);
      c.setLineDash([3, 6]); c.strokeStyle = 'rgba(60, 45, 30, 0.35)'; c.lineWidth = 1.2; c.beginPath(); c.arc(cx, cy, s * (L1 + L2), 0, 7); c.stroke(); c.setLineDash([]);
      // the wall plate
      rr(c, cx - s * 0.14, cy - s * 0.14, s * 0.28, s * 0.28, s * 0.03); c.fillStyle = '#7d8790'; c.fill(); c.strokeStyle = '#4a535b'; c.stroke();
      c.fillStyle = '#4a535b'; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.arc(cx + a * s * 0.1, cy + b * s * 0.1, s * 0.015, 0, 7); c.fill(); }
    });
    function link(x0, y0, x1, y1, w, col) {
      const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, -w, 0, w); g.addColorStop(0, col[0]); g.addColorStop(0.5, col[1]); g.addColorStop(1, col[2]);
      rr(ctx, -w * 0.4, -w / 2, len + w * 0.8, w, w * 0.45); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    function servo(x, y, w) { rr(ctx, x - w / 2, y - w / 2, w, w, w * 0.2); ctx.fillStyle = '#22282d'; ctx.fill(); ctx.fillStyle = '#c9d1d8'; ctx.beginPath(); ctx.arc(x, y, w * 0.18, 0, 7); ctx.fill(); }
    const draw = (e) => {
      const t = now();
      ctx.drawImage(bg, 0, 0, W, H);
      let k = 0, end = false, st = d.state || [Math.PI / 2, -1, 0, 0, 0.4, 0.3, 0];
      if (n && e != null) { const L = e === Infinity ? { k: n - 1, end: true } : loopAt(e, n, STEP, 1500); k = L.k; end = L.end; st = tr[k].s; }
      const [q1, q2, , , tx, ty, hold] = st;
      const e1 = [L1 * Math.cos(q1), L1 * Math.sin(q1)], tip = [e1[0] + L2 * Math.cos(q1 + q2), e1[1] + L2 * Math.sin(q1 + q2)];
      // the target
      const [gx, gy] = P(tx, ty), pulse = 0.5 + 0.5 * Math.sin(t / 250);
      ctx.strokeStyle = 'rgba(214, 60, 40, ' + (0.5 + 0.4 * pulse) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, s * 0.06 + pulse * 2, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, gy, s * 0.025, 0, 7); ctx.fillStyle = '#d63c28'; ctx.fill();
      // the tip's path in this test run
      if (n && e != null) {
        ctx.strokeStyle = 'rgba(40, 90, 160, 0.45)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let j = 0; j <= k; j++) { const a = tr[j].s, p = P(L1 * Math.cos(a[0]) + L2 * Math.cos(a[0] + a[1]), L1 * Math.sin(a[0]) + L2 * Math.sin(a[0] + a[1])); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.stroke();
      }
      const [b0, b1] = [P(0, 0), P(e1[0], e1[1])], b2 = P(tip[0], tip[1]), w = s * 0.11;
      link(b0[0], b0[1], b1[0], b1[1], w, ['#f6a04d', '#ffd29e', '#d9772a']);
      link(b1[0], b1[1], b2[0], b2[1], w * 0.85, ['#f2f4f5', '#ffffff', '#c9d1d8']);
      servo(b0[0], b0[1], w * 1.35); servo(b1[0], b1[1], w * 1.1);
      // the gripper, and the payload box when it holds one
      const ga = q1 + q2;
      ctx.save(); ctx.translate(b2[0], b2[1]); ctx.rotate(-ga);
      ctx.fillStyle = '#3a434a'; for (const sgn of [-1, 1]) { rr(ctx, 0, sgn * w * 0.32 - w * 0.09, w * 0.7, w * 0.18, w * 0.06); ctx.fill(); }
      if (hold) { ctx.fillStyle = '#b07a45'; ctx.fillRect(w * 0.15, -w * 0.25, w * 0.5, w * 0.5); ctx.strokeStyle = '#6e4724'; ctx.lineWidth = 1; ctx.strokeRect(w * 0.15, -w * 0.25, w * 0.5, w * 0.5); }
      ctx.restore();
      const dist = Math.hypot(tip[0] - tx, tip[1] - ty), px = Math.max(10, Math.min(13, H * 0.034));
      if (!n) hud(ctx, ['Press Run: move the gripper to the red dot.'], null, 6, px, fonts.mono, W);
      else hud(ctx, ['Test run, ' + ((k + 1) * 0.05).toFixed(1) + ' s, ' + dist.toFixed(2) + ' m from the dot' + (hold ? ', holding the payload' : '')], 'replay', 6, px, fonts.mono, W);
    };
    return looping(draw, n > 0, n * STEP + 1500);
  };

  // ---------------------------------------------------------------- table: the fork (around a coffee mug, top view)
  // d: { paths: [[[x, y], ...], ...], obstacle (radius), goal: [x, y], goalR, mud (0/1), fonts, dark }
  SC.table = function (ctx, W, H, d) {
    const fonts = d.fonts, paths = d.paths || [], np = paths.length;
    const s = Math.min(W, H) * 0.46, cx = W / 2, cy = H / 2, P = (x, y) => [cx + x * s, cy - y * s];
    const bg = layer(ctx, W, H, (c) => {
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#c89664'); g.addColorStop(1, '#a8743f');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) { c.strokeStyle = 'rgba(90, 50, 20, ' + (0.06 + 0.06 * hash(i)) + ')'; c.lineWidth = 1 + hash(i * 3) * 2; c.beginPath(); const y = hash(i * 7) * H; c.moveTo(0, y); c.bezierCurveTo(W * 0.3, y + 6 * hash(i), W * 0.6, y - 6, W, y + 3); c.stroke(); }
      // the work area: a cutting mat
      const [mx, my] = P(-1, 1);
      rr(c, mx, my, 2 * s, 2 * s, 8); c.fillStyle = '#2f6b57'; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
      for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo(mx + i * s / 5, my); c.lineTo(mx + i * s / 5, my + 2 * s); c.moveTo(mx, my + i * s / 5); c.lineTo(mx + 2 * s, my + i * s / 5); c.stroke(); }
      if (d.mud) { const [ux, uy] = P(-1, 0.6); c.fillStyle = 'rgba(110, 70, 30, 0.75)'; rr(c, ux, uy, 0.8 * s, 1.2 * s, s * 0.12); c.fill(); text(c, 'spill', ux + 0.4 * s, uy + 0.6 * s, { font: '600 ' + Math.max(10, s * 0.08) + 'px ' + fonts.mono, color: 'rgba(255,230,200,0.8)' }); }
      // the mug, seen from above
      const [ox, oy] = P(0, 0), R = d.obstacle * s;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.arc(ox + R * 0.08, oy + R * 0.1, R * 1.02, 0, 7); c.fill();
      c.strokeStyle = '#f4f1ea'; c.lineWidth = R * 0.22; c.beginPath(); c.arc(ox + R * 1.05, oy, R * 0.32, -1.2, 1.2); c.stroke();
      c.fillStyle = '#f4f1ea'; c.beginPath(); c.arc(ox, oy, R, 0, 7); c.fill();
      const cg = c.createRadialGradient(ox - R * 0.2, oy - R * 0.2, 1, ox, oy, R * 0.82); cg.addColorStop(0, '#7a4a26'); cg.addColorStop(1, '#3b2212');
      c.fillStyle = cg; c.beginPath(); c.arc(ox, oy, R * 0.82, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255, 240, 220, 0.35)'; c.lineWidth = 1.5; c.beginPath(); c.arc(ox, oy, R * 0.45, 0.6, 2.2); c.stroke();
      // goal and start markers
      const [gx, gy] = P(d.goal[0], d.goal[1]), gr = Math.max(8, d.goalR * s);
      for (let q = 3; q >= 1; q--) { c.fillStyle = q % 2 ? '#ffcf3f' : '#d63c28'; c.beginPath(); c.arc(gx, gy, gr * q / 2, 0, 7); c.fill(); }
      const [hx, hy] = P(0, -0.8); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(hx, hy, gr, 0, 7); c.stroke(); c.setLineDash([]);
      text(c, 'home', hx, hy + gr + 10, { font: '600 ' + Math.max(9, s * 0.06) + 'px ' + fonts.mono, color: 'rgba(255,255,255,0.8)' });
      if (d.dark) { c.fillStyle = 'rgba(6, 10, 22, 0.35)'; c.fillRect(0, 0, W, H); }
    });
    const len = paths.reduce((m, p) => Math.max(m, p.length), 0), STEP = 60;
    function gripper(x, y, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#1d2327'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#1d2327'; ctx.fillRect(x - 6, y - 10, 3, 6); ctx.fillRect(x + 3, y - 10, 3, 6); }
    const draw = (e) => {
      ctx.drawImage(bg, 0, 0, W, H);
      let k = len;
      if (np && e != null && e !== Infinity) { const L = loopAt(e, len, STEP, 1800); k = L.end ? len : L.k + 1; }
      paths.forEach((p, i) => {
        const left = p.some((q) => q[0] < -0.3), col = left ? '#7fc8ff' : '#ffb36b';
        ctx.strokeStyle = col; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
        p.slice(0, Math.max(1, k)).forEach(([x, y], j) => { const [px, py] = P(x, y); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); ctx.globalAlpha = 1;
        const h = p[Math.min(p.length - 1, Math.max(0, k - 1))], [hx, hy] = P(h[0], h[1]);
        gripper(hx, hy, col);
      });
      if (!np) { const [hx, hy] = P(0, -0.8); gripper(hx, hy, '#ffffff'); }
      const px = Math.max(10, Math.min(13, H * 0.034));
      if (!np) hud(ctx, ['Press Run: get the gripper to the target. Do not hit the mug.'], null, 6, px, fonts.mono, W);
      else hud(ctx, [np + ' test runs. Blue: around the left. Orange: around the right.'], 'replay', 6, px, fonts.mono, W);
    };
    return looping(draw, np > 0, len * STEP + 1800);
  };
})();
