// Illustrative comparison of a continuous regression head and a discrete bin head.
// The meter follows Yi et al. 2026, arXiv:2610.20429, equation (3.1):
//   delta3(h) = a[h+3] - 3 a[h+2] + 3 a[h+1] - a[h]
//   J(a) = average over h of the Euclidean norm of delta3(h)
//   R = J(prediction) / J(target) when J(target) > 0
// The paper's h runs from 1 to H-3. These windows are the same H-3 terms, indexed from 0.
// There is no division by a timestep. A zero target jerk does not produce a ratio.
// Bins are a teaching grid of 8. The paper's vocabulary size is 512 and is not used here.
// Nothing in this file is a RoboCasa, LIBERO, RoboMimic, or real-robot measurement.
(function () {
  'use strict';

  const BINS = 8;
  const PAPER_BINS = 512;
  const LO = -0.5;
  const HI = 7.5;

  const CORNER_A = [[0, 0], [0, 1], [0, 2], [2, 2], [2, 2], [2, 2]];
  const CORNER_B = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [2, 2]];
  const LINE_CHUNK = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  const SMOOTH_CHUNK = [[0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0], [1.25, 0]];

  const CORNERS = [CORNER_A, CORNER_B];
  const LINE = [LINE_CHUNK, LINE_CHUNK.map((row) => row.slice())];
  const SMOOTH = [SMOOTH_CHUNK, SMOOTH_CHUNK.map((row) => row.slice())];

  function fail(message) { throw new Error(message); }

  function validate(demos) {
    if (!Array.isArray(demos) || demos.length < 1) fail('demonstrations are missing');
    const commands = demos[0].length;
    if (commands < 4) fail('a jerk window needs at least 4 commands');
    for (const demo of demos) {
      if (!Array.isArray(demo) || demo.length !== commands) fail('demonstrations must share a command count');
      for (const row of demo) {
        if (!Array.isArray(row) || row.length !== 2) fail('each command needs two coordinates');
        if (typeof row[0] !== 'number' || typeof row[1] !== 'number' || !Number.isFinite(row[0]) || !Number.isFinite(row[1])) {
          fail('a command coordinate is not a finite number');
        }
      }
    }
    return commands;
  }

  function binWidth() { return (HI - LO) / BINS; }

  function binIndex(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('bin input is not a finite number');
    const raw = 1 + Math.floor((value - LO) / binWidth());
    if (raw < 1) return 1;
    if (raw > BINS) return BINS;
    return raw;
  }

  function binCenter(index) {
    return LO + (index - 0.5) * binWidth();
  }

  function quantizeChunk(chunk) {
    validate([chunk]);
    return chunk.map((row) => [binCenter(binIndex(row[0])), binCenter(binIndex(row[1]))]);
  }

  function meanChunk(demos) {
    const commands = validate(demos);
    const out = [];
    for (let t = 0; t < commands; t++) {
      let x = 0;
      let y = 0;
      for (const demo of demos) { x += demo[t][0]; y += demo[t][1]; }
      out.push([x / demos.length, y / demos.length]);
    }
    return out;
  }

  function jerk(chunk) {
    const commands = validate([chunk]);
    const terms = [];
    for (let h = 0; h <= commands - 4; h++) {
      const dx = chunk[h + 3][0] - 3 * chunk[h + 2][0] + 3 * chunk[h + 1][0] - chunk[h][0];
      const dy = chunk[h + 3][1] - 3 * chunk[h + 2][1] + 3 * chunk[h + 1][1] - chunk[h][1];
      terms.push(Math.hypot(dx, dy));
    }
    return { mean: terms.reduce((sum, term) => sum + term, 0) / terms.length, terms, windows: terms.length };
  }

  function jerkRatio(predicted, target) {
    const pred = jerk(predicted).mean;
    const expert = jerk(target).mean;
    if (expert === 0) return { predicted: pred, expert, ratio: null, defined: false };
    return { predicted: pred, expert, ratio: pred / expert, defined: true };
  }

  function squaredError(left, right) {
    let sum = 0;
    let n = 0;
    for (let t = 0; t < left.length; t++) {
      for (let k = 0; k < 2; k++) {
        const delta = left[t][k] - right[t][k];
        sum += delta * delta;
        n += 1;
      }
    }
    return { sum, n };
  }

  function mseAgainst(chunk, demos) {
    validate(demos);
    if (chunk.length !== demos[0].length) fail('prediction length does not match the demonstrations');
    let sum = 0;
    let n = 0;
    for (const demo of demos) {
      const part = squaredError(chunk, demo);
      sum += part.sum;
      n += part.n;
    }
    return sum / n;
  }

  function msePaired(chunks, demos) {
    validate(demos);
    if (chunks.length !== demos.length) fail('paired predictions must match the demonstration count');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < demos.length; i++) {
      const part = squaredError(chunks[i], demos[i]);
      sum += part.sum;
      n += part.n;
    }
    return sum / n;
  }

  function pairKey(x, y) { return x + ',' + y; }

  function chunkKey(chunk) {
    return chunk.map((row) => pairKey(row[0], row[1])).join('|');
  }

  function marginal(demos, t, dim) {
    const counts = new Map();
    for (const demo of demos) counts.set(demo[t][dim], (counts.get(demo[t][dim]) || 0) + 1);
    return [...counts.entries()].map(([value, count]) => ({ value, count, p: count / demos.length }));
  }

  function productAtoms(demos, t) {
    const atoms = [];
    for (const x of marginal(demos, t, 0)) {
      for (const y of marginal(demos, t, 1)) atoms.push({ x: x.value, y: y.value, p: x.p * y.p });
    }
    return atoms;
  }

  function countAtoms(demos, t) {
    const counts = new Map();
    for (const demo of demos) {
      const key = pairKey(demo[t][0], demo[t][1]);
      const prev = counts.get(key) || { x: demo[t][0], y: demo[t][1], count: 0 };
      prev.count += 1;
      counts.set(key, prev);
    }
    return [...counts.values()].map((atom) => ({ x: atom.x, y: atom.y, p: atom.count / demos.length }));
  }

  function mergeAtoms(atoms) {
    const map = new Map();
    for (const atom of atoms) {
      if (atom.p === 0) continue;
      const key = pairKey(atom.x, atom.y);
      const prev = map.get(key);
      if (prev) prev.p += atom.p;
      else map.set(key, { x: atom.x, y: atom.y, p: atom.p });
    }
    return [...map.values()];
  }

  function pairSeen(demos, t) {
    return new Set(demos.map((demo) => pairKey(demo[t][0], demo[t][1])));
  }

  function invalidMass(atoms, demos, t) {
    const seen = pairSeen(demos, t);
    let invalid = 0;
    for (const atom of atoms) if (!seen.has(pairKey(atom.x, atom.y))) invalid += atom.p;
    return invalid;
  }

  function markAtoms(atoms, demos, t) {
    const seen = pairSeen(demos, t);
    return atoms.map((atom) => ({ x: atom.x, y: atom.y, p: atom.p, demonstrated: seen.has(pairKey(atom.x, atom.y)) }));
  }

  function coordinateUpdate(demos, byTime) {
    return byTime.map((atoms, t) => {
      const xMass = new Map();
      for (const atom of atoms) xMass.set(atom.x, (xMass.get(atom.x) || 0) + atom.p);
      const next = [];
      for (const [x, px] of xMass) {
        if (px === 0) continue;
        const rows = demos.filter((demo) => demo[t][0] === x);
        if (!rows.length) fail('no demonstration has this x at the command being updated');
        const yCounts = new Map();
        for (const row of rows) yCounts.set(row[t][1], (yCounts.get(row[t][1]) || 0) + 1);
        for (const [y, count] of yCounts) next.push({ x, y, p: px * (count / rows.length) });
      }
      return mergeAtoms(next);
    });
  }

  function independentChunkMass(byTime, demos) {
    const keys = new Set(demos.map(chunkKey));
    let invalid = 0;
    let valid = 0;
    const commands = byTime.length;
    function walk(t, p, parts) {
      if (p === 0) return;
      if (t === commands) {
        if (keys.has(parts.join('|'))) valid += p;
        else invalid += p;
        return;
      }
      for (const atom of byTime[t]) walk(t + 1, p * atom.p, parts.concat(pairKey(atom.x, atom.y)));
    }
    walk(0, 1, []);
    return { invalid, valid };
  }

  function productLaw(demos) {
    const commands = demos[0].length;
    return Array.from({ length: commands }, (_, t) => productAtoms(demos, t));
  }

  function valueConditional(demos, t, dim, previous) {
    const values = [];
    for (const demo of demos) if (demo[t - 1][dim] === previous) values.push(demo[t][dim]);
    if (!values.length) fail('no demonstration continues this coordinate');
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].map(([value, count]) => ({ value, p: count / values.length }));
  }

  function timeChain(demos) {
    const commands = demos[0].length;
    const marginals = Array.from({ length: commands }, () => new Map());
    const keys = new Set(demos.map(chunkKey));
    let invalid = 0;
    let valid = 0;
    function add(t, x, y, p) {
      const key = pairKey(x, y);
      const prev = marginals[t].get(key);
      if (prev) prev.p += p;
      else marginals[t].set(key, { x, y, p });
    }
    function walk(t, p, parts, prev) {
      if (t === commands) {
        if (keys.has(parts.join('|'))) valid += p;
        else invalid += p;
        return;
      }
      const branches = [];
      if (t === 0) {
        for (const atom of productAtoms(demos, 0)) branches.push(atom);
      } else {
        for (const x of valueConditional(demos, t, 0, prev.x)) {
          for (const y of valueConditional(demos, t, 1, prev.y)) branches.push({ x: x.value, y: y.value, p: x.p * y.p });
        }
      }
      for (const atom of branches) {
        const nextP = p * atom.p;
        add(t, atom.x, atom.y, nextP);
        walk(t + 1, nextP, parts.concat(pairKey(atom.x, atom.y)), atom);
      }
    }
    walk(0, 1, [], null);
    return { byTime: marginals.map((map) => [...map.values()]), chunkInvalid: invalid, chunkValid: valid };
  }

  function pairChain(demos) {
    const commands = demos[0].length;
    const marginals = Array.from({ length: commands }, () => new Map());
    const keys = new Set(demos.map(chunkKey));
    let invalid = 0;
    let valid = 0;
    function add(t, x, y, p) {
      const key = pairKey(x, y);
      const prev = marginals[t].get(key);
      if (prev) prev.p += p;
      else marginals[t].set(key, { x, y, p });
    }
    function walk(t, p, parts, prev) {
      if (t === commands) {
        if (keys.has(parts.join('|'))) valid += p;
        else invalid += p;
        return;
      }
      let branches;
      if (t === 0) branches = countAtoms(demos, 0);
      else {
        const rows = demos.filter((demo) => demo[t - 1][0] === prev.x && demo[t - 1][1] === prev.y);
        if (!rows.length) fail('no demonstration continues this pair');
        const counts = new Map();
        for (const row of rows) {
          const key = pairKey(row[t][0], row[t][1]);
          const item = counts.get(key) || { x: row[t][0], y: row[t][1], count: 0 };
          item.count += 1;
          counts.set(key, item);
        }
        branches = [...counts.values()].map((item) => ({ x: item.x, y: item.y, p: item.count / rows.length }));
      }
      for (const atom of branches) {
        const nextP = p * atom.p;
        add(t, atom.x, atom.y, nextP);
        walk(t + 1, nextP, parts.concat(pairKey(atom.x, atom.y)), atom);
      }
    }
    walk(0, 1, [], null);
    return { byTime: marginals.map((map) => [...map.values()]), chunkInvalid: invalid, chunkValid: valid };
  }

  function splitTime(demos) {
    let best = 0;
    let bestInvalid = -1;
    for (let t = 0; t < demos[0].length; t++) {
      const mass = invalidMass(productAtoms(demos, t), demos, t);
      if (mass > bestInvalid) { best = t; bestInvalid = mass; }
    }
    return best;
  }

  function plausibleMiss(atoms, demos, t) {
    const xs = new Set(demos.map((demo) => demo[t][0]));
    const ys = new Set(demos.map((demo) => demo[t][1]));
    let best = null;
    for (const atom of atoms) {
      if (atom.demonstrated || atom.p <= 0) continue;
      if (!xs.has(atom.x) || !ys.has(atom.y)) continue;
      if (!best || atom.p > best.p) best = { x: atom.x, y: atom.y, p: atom.p };
    }
    return best;
  }

  function summarize(demos, byTime, chainMass) {
    const at = splitTime(demos);
    const atoms = markAtoms(byTime[at], demos, at);
    const chunk = chainMass || independentChunkMass(byTime, demos);
    return {
      pairInvalid: invalidMass(byTime[at], demos, at),
      chunkInvalid: chunk.invalid,
      chunkValid: chunk.valid,
      splitAtoms: atoms,
      plausibleMiss: plausibleMiss(atoms, demos, at),
    };
  }

  function lawAfter(demos, kind, steps) {
    if (kind === 'independent' || kind === 'redraw') return { byTime: productLaw(demos) };
    if (kind === 'coordinate') {
      let byTime = productLaw(demos);
      for (let step = 0; step < steps; step++) byTime = coordinateUpdate(demos, byTime);
      return { byTime };
    }
    if (kind === 'time') return steps < 1 ? { byTime: productLaw(demos) } : timeChain(demos);
    if (kind === 'pair') return steps < 1 ? { byTime: productLaw(demos) } : pairChain(demos);
    fail('unknown refinement');
  }

  function refine(demos, kind, steps) {
    validate(demos);
    if (kind !== 'independent' && kind !== 'redraw' && kind !== 'coordinate' && kind !== 'time' && kind !== 'pair') {
      fail('unknown refinement');
    }
    if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0) fail('steps must be a non-negative integer');
    const at = splitTime(demos);
    const trace = [];
    let last = null;
    for (let step = 0; step <= steps; step++) {
      const law = lawAfter(demos, kind, step);
      const summary = summarize(demos, law.byTime, law.chunkInvalid == null ? null : { invalid: law.chunkInvalid, valid: law.chunkValid });
      last = summary;
      trace.push({ step, pairInvalid: summary.pairInvalid, chunkInvalid: summary.chunkInvalid });
    }
    return {
      illustrative: true,
      kind,
      steps,
      bins: BINS,
      paperBins: PAPER_BINS,
      demonstrations: demos.length,
      commands: demos[0].length,
      coordinates: 2,
      splitTime: at,
      pairInvalid: last.pairInvalid,
      chunkInvalid: last.chunkInvalid,
      chunkValid: last.chunkValid,
      splitAtoms: last.splitAtoms,
      plausibleMiss: last.plausibleMiss,
      trace,
    };
  }

  function score(demos) {
    const mean = meanChunk(demos);
    const ratios = demos.map((demo) => jerkRatio(mean, demo));
    const quantized = demos.map(quantizeChunk);
    const binRatios = demos.map((demo, index) => jerkRatio(quantized[index], demo));
    return {
      illustrative: true,
      bins: BINS,
      paperBins: PAPER_BINS,
      demonstrations: demos.length,
      commands: demos[0].length,
      coordinates: 2,
      passes: 1,
      mean,
      expertJerks: ratios.map((item) => item.expert),
      meanJerk: jerk(mean).mean,
      ratios: ratios.map((item) => item.ratio),
      quantized,
      binJerks: binRatios.map((item) => item.predicted),
      binRatios: binRatios.map((item) => item.ratio),
      regressionMse: mseAgainst(mean, demos),
      binMse: msePaired(quantized, demos),
      meanBelowAll: ratios.every((item) => item.defined && item.ratio < 1),
    };
  }

  function individuallyPlausible(demos, t, x, y) {
    validate(demos);
    const xSeen = demos.some((demo) => demo[t][0] === x);
    const ySeen = demos.some((demo) => demo[t][1] === y);
    const pair = demos.some((demo) => demo[t][0] === x && demo[t][1] === y);
    return xSeen && ySeen && !pair;
  }

  const api = {
    BINS, PAPER_BINS, LO, HI, CORNERS, LINE, SMOOTH,
    binIndex, binCenter, quantizeChunk, meanChunk, jerk, jerkRatio,
    score, refine, individuallyPlausible,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBHEADS = api;
})();
