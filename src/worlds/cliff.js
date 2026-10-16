(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('../core/rng.js'); }
  RLA.worlds = RLA.worlds || {};

  const HEIGHT = 4;

  function knobValue(knobs, key, fallback, min, max, integer) {
    const value = knobs[key] === undefined ? fallback : knobs[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new RangeError(`Invalid cliff knob ${key}: ${value}`);
    }
    return value;
  }

  function make(knobs, rng) {
    knobs = knobs || {};
    const width = knobValue(knobs, 'width', 12, 5, 12, true);
    const slip = knobValue(knobs, 'slip', 0, 0, 0.3, false);
    const cliffPenalty = knobValue(knobs, 'cliffPenalty', -100, -200, -10, false);
    const sparseReward = knobValue(knobs, 'sparseReward', 0, 0, 1, true);
    const maxSteps = knobValue(knobs, 'maxSteps', 200, 50, 500, true);
    if (slip > 0 && (!rng || typeof rng.next !== 'function' || typeof rng.int !== 'function')) {
      throw new TypeError('cliff with slip requires an RNG with next() and int()');
    }

    const startRow = HEIGHT - 1;
    const startCol = 0;
    const goalCol = width - 1;
    const nStates = HEIGHT * width;
    const spec = { name: 'cliff', obsDim: 2, nActions: 4, maxSteps, gamma: 0.99, nStates };
    let row = startRow;
    let col = startCol;
    let steps = 0;

    function observation() {
      return new Float32Array([row / (HEIGHT - 1), col / (width - 1)]);
    }

    function reset() {
      row = startRow;
      col = startCol;
      steps = 0;
      return observation();
    }

    function step(action) {
      if (!Number.isInteger(action) || action < 0 || action >= 4) {
        throw new RangeError(`Invalid cliff action: ${action}`);
      }
      let move = action;
      if (slip > 0 && rng.next() < slip) { move = rng.int(4); }

      let nextRow = row;
      let nextCol = col;
      if (move === 0) { nextRow--; }
      else if (move === 1) { nextCol++; }
      else if (move === 2) { nextRow++; }
      else { nextCol--; }
      if (nextRow < 0 || nextRow >= HEIGHT || nextCol < 0 || nextCol >= width) {
        nextRow = row;
        nextCol = col;
      }

      let reward = sparseReward ? 0 : -1;
      let done = false;
      let fell = false;
      if (nextRow === startRow && nextCol > startCol && nextCol < goalCol) {
        fell = true;
        nextRow = startRow;
        nextCol = startCol;
        reward = sparseReward ? 0 : cliffPenalty;
      } else if (nextRow === startRow && nextCol === goalCol) {
        done = true;
        reward = sparseReward ? 10 : -1;
      }
      row = nextRow;
      col = nextCol;
      steps++;

      return {
        obs: observation(),
        reward,
        done,
        truncated: !done && steps >= maxSteps,
        info: { pos: [row, col], fell },
      };
    }

    function stateIndex(obs) {
      if (!obs) { return row * width + col; }
      const stateRow = Math.round(obs[0] * (HEIGHT - 1));
      const stateCol = Math.round(obs[1] * (width - 1));
      return stateRow * width + stateCol;
    }

    function render(ctx, canvasWidth, canvasHeight, colors, overlay) {
      const palette = colors || {};
      const background = palette.background || palette.bg || '#ffffff';
      const gridColor = palette.grid || '#64748b';
      const cliffColor = palette.cliff || '#475569';
      const startColor = palette.start || '#22c55e';
      const goalColor = palette.goal || '#facc15';
      const agentColor = palette.agent || '#ef4444';
      const cellWidth = canvasWidth / width;
      const cellHeight = canvasHeight / HEIGHT;

      if (overlay && overlay.values !== undefined && (!(overlay.values instanceof Float32Array) || overlay.values.length !== nStates)) {
        throw new TypeError(`cliff overlay values must be Float32Array(${nStates})`);
      }
      if (overlay && overlay.arrows !== undefined && (!(overlay.arrows instanceof Int8Array) || overlay.arrows.length !== nStates)) {
        throw new TypeError(`cliff overlay arrows must be Int8Array(${nStates})`);
      }
      let valueScale = 0;
      if (overlay && overlay.values) {
        for (let i = 0; i < nStates; i++) {
          if (Number.isFinite(overlay.values[i])) { valueScale = Math.max(valueScale, Math.abs(overlay.values[i])); }
        }
      }

      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      for (let r = 0; r < HEIGHT; r++) {
        for (let c = 0; c < width; c++) {
          const index = r * width + c;
          const x = c * cellWidth;
          const y = r * cellHeight;
          ctx.fillStyle = background;
          ctx.fillRect(x, y, cellWidth, cellHeight);
          if (overlay && overlay.values && Number.isFinite(overlay.values[index]) && valueScale > 0) {
            const value = overlay.values[index];
            const alpha = 0.15 + 0.65 * Math.abs(value) / valueScale;
            ctx.fillStyle = value >= 0
              ? `rgba(37, 99, 235, ${alpha})`
              : `rgba(239, 68, 68, ${alpha})`;
            ctx.fillRect(x, y, cellWidth, cellHeight);
          }
          if (r === startRow && c > startCol && c < goalCol) {
            ctx.fillStyle = cliffColor;
            ctx.fillRect(x, y, cellWidth, cellHeight);
          }
        }
      }

      ctx.fillStyle = startColor;
      ctx.fillRect(startCol * cellWidth, startRow * cellHeight, cellWidth, cellHeight);
      ctx.fillStyle = goalColor;
      ctx.fillRect(goalCol * cellWidth, startRow * cellHeight, cellWidth, cellHeight);

      if (overlay && overlay.arrows) {
        const cx = cellWidth / 2;
        const cy = cellHeight / 2;
        const inset = Math.min(cellWidth, cellHeight) * 0.2;
        for (let r = 0; r < HEIGHT; r++) {
          for (let c = 0; c < width; c++) {
            const action = overlay.arrows[r * width + c];
            if (r === startRow && c > startCol) { continue; } // cliff cells and the goal: no decision there
            if (action === -1) {
              // never tried here: all estimates equal, so there is no preferred action yet
              ctx.fillStyle = palette.arrow || palette.fg || '#0f172a';
              ctx.beginPath(); ctx.arc(c * cellWidth + cx, r * cellHeight + cy, Math.max(1.5, Math.min(cellWidth, cellHeight) * 0.05), 0, 7); ctx.fill();
              continue;
            }
            if (action < 0 || action > 3) { continue; }
            const centerX = c * cellWidth + cx;
            const centerY = r * cellHeight + cy;
            let dx = 0;
            let dy = 0;
            if (action === 0) { dy = -1; }
            else if (action === 1) { dx = 1; }
            else if (action === 2) { dy = 1; }
            else { dx = -1; }
            const tipX = centerX + dx * inset;
            const tipY = centerY + dy * inset;
            const tailX = centerX - dx * inset;
            const tailY = centerY - dy * inset;
            const head = inset * 0.55;
            const lw = Math.max(1, Math.min(cellWidth, cellHeight) * 0.05);
            const arrowPath = () => {
              ctx.beginPath();
              ctx.moveTo(tailX, tailY);
              ctx.lineTo(tipX, tipY);
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX - dx * head - dy * head, tipY - dy * head + dx * head);
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX - dx * head + dy * head, tipY - dy * head - dx * head);
            };
            // a halo in the background color keeps the arrow visible on any shade, in light and dark themes
            ctx.lineCap = 'round';
            ctx.strokeStyle = background; ctx.lineWidth = lw + 3; arrowPath(); ctx.stroke();
            ctx.strokeStyle = palette.arrow || palette.fg || '#0f172a'; ctx.lineWidth = lw; arrowPath(); ctx.stroke();
            ctx.lineCap = 'butt';
          }
        }
      }

      ctx.fillStyle = agentColor;
      const agentInsetX = cellWidth * 0.22;
      const agentInsetY = cellHeight * 0.22;
      ctx.fillRect(col * cellWidth + agentInsetX, row * cellHeight + agentInsetY, cellWidth - 2 * agentInsetX, cellHeight - 2 * agentInsetY);

      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= width; c++) {
        const x = c * cellWidth;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
      }
      for (let r = 0; r <= HEIGHT; r++) {
        const y = r * cellHeight;
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
      }
      ctx.stroke();
    }

    return { spec, reset, step, stateIndex, render };
  }

  RLA.worlds.cliff = {
    make,
    knobs: [
      { key: 'width', label: 'Grid width', min: 5, max: 12, step: 1, default: 12, help: 'Number of grid columns.' },
      { key: 'slip', label: 'Action slip', min: 0, max: 0.3, step: 0.01, default: 0, help: 'Probability of replacing an action with a random action.' },
      { key: 'cliffPenalty', label: 'Cliff penalty', min: -200, max: -10, step: 1, default: -100, help: 'Reward for stepping into the cliff.' },
      { key: 'sparseReward', label: 'Sparse reward', min: 0, max: 1, step: 1, default: 0, help: 'Give zero for each step and ten for reaching the goal.' },
      { key: 'maxSteps', label: 'Step limit', min: 50, max: 500, step: 1, default: 200, help: 'Maximum steps before truncation.' },
    ],
    info: {
      title: 'Cliff walking is a grid-world control task.',
      teaches: 'It teaches the trade-off between a short risky route and a longer safe route.',
      cannotTeach: 'It cannot teach continuous control or high-dimensional observations.',
    },
  };
  if (typeof module === 'object' && module.exports) { module.exports = RLA.worlds.cliff; }
})();
