// Independent finite-route teaching engine. Does not participate in RLA.run or its Fast corpus.
(function () {
  'use strict';
  const rng = typeof module === 'object' && module.exports ? require('../core/rng.js') : globalThis.RLA.rng;
  const GRID = ['.......', '.G...D.', '.G...D.', 'S..L..E', '.G...D.', '...L...', '.......'];
  const START = [0, 3], END = [6, 3], BUDGET = 14;
  const names = ['Direct', 'Gold north', 'Gold south', 'All gold', 'Diamond north', 'Diamond south', 'All diamonds', 'Wide safe', 'Gold then diamond', 'Unfinished'];
  const stops = [[], [[1,1]], [[1,4]], [[1,1],[1,4]], [[5,1]], [[5,4]], [[5,1],[5,4]], [[0,0],[6,0]], [[1,1],[1,4],[5,1],[5,4]], [[1,1],[1,4],[0,6]]];
  const key = p => p.join(',');
  function segment(a, b) {
    const path = [a.slice()], p = a.slice();
    // Horizontal then vertical; a declared finite route menu, no hidden oracle.
    for (const axis of [0, 1]) while (p[axis] !== b[axis]) { p[axis] += Math.sign(b[axis] - p[axis]); path.push(p.slice()); }
    return path;
  }
  function replay(path) {
    const seen = new Set(); let gold = 0, diamond = 0, lava = 0, exit = false;
    const trace = [START.slice()];
    for (const cell of path.slice(1, BUDGET + 1)) {
      const prev = trace[trace.length - 1];
      if (Math.abs(cell[0] - prev[0]) + Math.abs(cell[1] - prev[1]) !== 1 || !GRID[cell[1]] || GRID[cell[1]][cell[0]] === undefined) throw Error('Invalid route');
      trace.push(cell.slice()); const tile = GRID[cell[1]][cell[0]];
      if (!seen.has(key(cell))) { if (tile === 'G') gold++; if (tile === 'D') diamond++; if (tile === 'L') lava++; seen.add(key(cell)); }
      if (key(cell) === key(END)) { exit = true; break; }
    }
    return { path: trace, reward: exit ? [1, gold / 3, diamond / 3, 1 - lava / 2] : [0, 0, 0, 0], exit };
  }
  const routes = stops.map((points, i) => {
    let path = [START];
    for (const dest of [...points, END]) path = path.concat(segment(path[path.length - 1], dest).slice(1));
    return { name: names[i], ...replay(path) };
  });
  const dot = (w, r) => w.reduce((s, x, i) => s + x * r[i], 0);
  function directions(random, count = 8) {
    return Array.from({ length: count }, () => {
      const x = Array.from({ length: 4 }, () => -Math.log(Math.max(Number.MIN_VALUE, random.next()))), sum = x.reduce((s, v) => s + v, 0);
      return x.map(v => v / sum); // Dirichlet(1,1,1,1)
    });
  }
  function setReward(vectors, weights) {
    return weights.reduce((s, w) => s + Math.max(...vectors.map(r => dot(w, r))), 0) / weights.length;
  }
  function advantages(values) {
    if (values.every(v => v === values[0])) return values.map(() => 0);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    return values.map(v => (v - mean) / (sd + 1e-8));
  }
  const uniform = [0.25, 0.25, 0.25, 0.25];
  const policy = () => Array.from({ length: 8 }, () => Array(routes.length).fill(0));
  function probs(logits) {
    const hi = Math.max(...logits), x = logits.map(v => Math.exp(v - hi)), sum = x.reduce((s, v) => s + v, 0);
    return x.map(v => v / sum);
  }
  function sample(p, random) {
    let x = random.next();
    for (let i = 0; i < p.length; i++) { x -= p[i]; if (x <= 0) return i; }
    return p.length - 1;
  }
  function chain(model, random, m) {
    let state = 0; const decisions = [];
    for (let j = 0; j < m; j++) {
      const p = probs(model[state]), action = sample(p, random), reward = routes[action].reward;
      decisions.push({ state, action, old: p[action], reward });
      // Later alternatives see actual earlier coverage. Repeats remain possible.
      state |= (reward[1] > 0 ? 1 : 0) | (reward[2] > 0 ? 2 : 0) | (reward[3] === 1 ? 4 : 0);
    }
    return decisions;
  }
  function update(model, groups, rewards, lr = 0.35) {
    const adv = advantages(rewards), count = groups.flat().length;
    // PPO-like categorical surrogate: two whole-group passes, fixed old probabilities/advantages.
    for (let epoch = 0; epoch < 2; epoch++) {
      const grad = policy();
      groups.forEach((decisions, g) => decisions.forEach(d => {
        const p = probs(model[d.state]), ratio = p[d.action] / d.old, a = adv[g];
        const credit = (a >= 0 && ratio > 1.2) || (a < 0 && ratio < 0.8) ? 0 : a * ratio;
        const kl = p.reduce((s, v) => s + v * Math.log(v * p.length), 0);
        p.forEach((v, i) => { grad[d.state][i] += (credit * ((i === d.action ? 1 : 0) - v) - 0.001 * v * (Math.log(v * p.length) - kl)) / count; });
      }));
      model.forEach((row, s) => row.forEach((v, i) => { row[i] = v + lr * grad[s][i]; }));
    }
  }
  function train(arm, seed, generations = 240) {
    if (!['vpo', 'grpo'].includes(arm)) throw Error('Unknown comparison arm');
    const random = rng.make(seed), model = policy(), events = []; let last;
    for (let step = 0; step < generations; step++) {
      const weights = arm === 'vpo' ? directions(random) : [uniform];
      const groups = Array.from({ length: arm === 'vpo' ? 4 : 12 }, () => chain(model, random, arm === 'vpo' ? 3 : 1));
      const rewards = groups.map(ds => arm === 'vpo' ? setReward(ds.map(d => d.reward), weights) : dot(uniform, ds[0].reward));
      groups.forEach((group, g) => group.forEach((d, i) => events.push({ t: events.length, generation: step, group: g, index: i, kind: 'route selection', ...d })));
      update(model, groups, rewards); last = { weights, groups, rewards, advantages: advantages(rewards) };
    }
    return { arm, model, last, events, candidates: generations * 12, updates: generations * 2 };
  }
  function evaluate(model, arm, seed, repetitions = 64) {
    const random = rng.make(seed), ks = [1,3,5,10,30], curve = ks.map(() => 0), pools = []; let pool;
    for (let rep = 0; rep < repetitions; rep++) {
      pool = [];
      while (pool.length < 30) pool.push(...chain(model, random, arm === 'vpo' ? 3 : 1).map(d => d.action));
      pools.push(pool.slice());
      ks.forEach((k, i) => { curve[i] += Math.max(...pool.slice(0, k).map(a => dot(uniform, routes[a].reward))) / repetitions; });
    }
    return { ks, curve, pool, pools, repetitions };
  }
  function compare(seed = 101, generations = 240) {
    const started = Date.now();
    const arms = ['grpo','vpo'].map(arm => { const trained = train(arm, seed, generations); return { ...trained, evaluation: evaluate(trained.model, arm, seed + 10000) }; });
    return { seed, generations, arms, base: evaluate(policy(), 'base', seed + 10000), milliseconds: Date.now() - started };
  }
  const api = { GRID, START, END, BUDGET, routes, replay, dot, uniform, directions, setReward, advantages, policy, probs, chain, update, train, evaluate, compare };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBVPO = api;
})();
