(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') {
    require('../core/rng.js');
    require('../worlds/bandit.js'); require('../worlds/cliff.js'); require('../worlds/cartpole.js'); require('../worlds/mirage.js');
    require('../worlds/pendulum.js'); require('../worlds/reach.js'); require('../worlds/fork.js'); require('../worlds/goalgrid.js'); require('../worlds/fetch.js');
    require('../agents/value.js'); require('../agents/pg.js'); require('../agents/ac.js');
  }

  function makeLearner(parts, world, rng, hyper) {
    const fam = parts.family || 'value';
    if (!RLA[fam]) throw new Error('Unknown learner family ' + fam);
    // a world can declare the hyper values this task needs (for example a short learnStart when the
    // episode is only a few steps long); the run's own hyper still wins over the world's
    return RLA[fam].make(parts, world, rng, Object.assign({}, world.hyper || {}, hyper || {}));
  }

  function knobDefaults(name) {
    const out = {};
    for (const k of RLA.worlds[name].knobs) out[k.key] = k.default;
    return out;
  }

  // Greedy evaluation episode. Returns undiscounted return (up to the training limit),
  // the realized discounted return (long horizon), the predicted value (max_a Q(s0), or V(s0)) and a trace.
  function evaluate(learner, W, knobs, rng, limit, wantTrace, start) {
    const ew = W.make(Object.assign({}, knobs, { maxSteps: Math.max(limit, W.evalHorizon || 0) }), rng);
    let obs = ew.reset(start);
    if (learner.beginEpisode) learner.beginEpisode();
    let pred = NaN;
    if (learner.q) { const q0 = learner.q(obs); pred = Math.max.apply(null, q0); }
    else if (learner.value) pred = learner.value(obs);
    let ret = 0, disc = 0, g = 1, t = 0, maxQ = 0, success = 0, crashes = 0, dist = NaN;
    const trace = wantTrace ? [] : null;
    for (;;) {
      if (learner.q && t % 10 === 0) { const q = learner.q(obs); for (const v of q) maxQ = Math.max(maxQ, Math.abs(v)); }
      const a = learner.act(obs, false);
      const r = ew.step(a);
      if (trace && trace.length < 600) {
        const st = r.info && (r.info.state || r.info.pos) ? Array.from(r.info.state || r.info.pos) : (ew.getState ? Array.from(ew.getState()) : null);
        trace.push({ a: typeof a === 'number' ? a : Array.from(a), s: st, r: r.reward, f: r.info && r.info.fell ? 1 : 0 });
      }
      if (t < limit) ret += r.reward;
      disc += g * r.reward; g *= ew.spec.gamma;
      if (r.info) { if (r.info.success) success = 1; if (r.info.crash) crashes++; if (r.info.dist !== undefined && t < limit) dist = r.info.dist; }
      t++;
      obs = r.obs;
      if (r.done || r.truncated) break;
    }
    return { ret, disc, pred, maxQ, len: t, trace, success, crashes, dist, start: ew.prompt ? ew.prompt() : null, path: ew.trail ? ew.trail() : null };
  }

  function run(cfg) {
    const name = cfg.world;
    const W = RLA.worlds[name];
    const knobs = Object.assign(knobDefaults(name), cfg.knobs || {});
    const rng = RLA.rng.make(cfg.seed || 1);
    const world = W.make(knobs, RLA.rng.make((cfg.seed || 1) * 7919 + 13));
    const learner = makeLearner(cfg.parts, world, rng, cfg.hyper);
    const steps = cfg.steps || 20000;
    const evalEvery = cfg.evalEvery || Math.max(1, Math.round(steps / 40));
    const evalRng = RLA.rng.make((cfg.seed || 1) * 104729 + 7);
    const res = {
      world: name, parts: learner.parts, knobs, seed: cfg.seed || 1, steps,
      ep: { t: [], ret: [], len: [], falls: [], left: [], success: [] },
      evals: [], diag: [], notes: learner.notes.slice(), trace: null, bandit: null,
      table: null,
    };
    const isBandit = world.spec.maxSteps === 1;
    if (isBandit) res.bandit = { reward: new Float32Array(steps), optimal: new Uint8Array(steps), regret: new Float32Array(steps), arm: new Uint8Array(steps) };
    // a few training episodes, cell by cell, for the picture of the world (worlds whose step reports info.pos)
    // episodes 1, 2, 3, 5, 10, 20, 50, 100, ... and the last one that ended; at most 200 steps each
    const PEEK_AT = new Set([1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]);
    let epCount = 0, peek = null, lastPeek = null;
    res.peeks = [];

    let nextEval = evalEvery, nextProg = cfg.progressEvery || evalEvery;
    const evalN = cfg.evalEpisodes || W.evalEpisodes || 3;
    function doEval(t) {
      let sr = 0, sd = 0, sp = 0, mq = 0, ss = 0, sc = 0, sdist = 0, nd = 0;
      for (let k = 0; k < evalN; k++) {
        const e = evaluate(learner, W, knobs, evalRng, world.spec.maxSteps, false);
        sr += e.ret; sd += e.disc; sp += e.pred; mq = Math.max(mq, e.maxQ); ss += e.success; sc += e.crashes;
        if (!Number.isNaN(e.dist)) { sdist += e.dist; nd++; }
      }
      const d = learner.diagnostics();
      res.evals.push({ t, ret: sr / evalN, disc: sd / evalN, pred: sp / evalN, maxQ: mq, success: ss / evalN, crashes: sc / evalN, dist: nd ? sdist / nd : null });
      res.diag.push({ t, loss: d.loss, td: d.tdAbs, grad: d.gradNorm, eps: d.eps, updates: d.updates, kl: d.kl, clipFrac: d.clipFrac, entropy: d.entropy, alpha: d.alpha, qData: d.qData, qPolicy: d.qPolicy, std: d.std, zeroFrac: d.zeroFrac });
    }

    if (learner.offline) {
      // Learning from a fixed dataset: no new tries. One "step" is one gradient update; the tests are the only episodes.
      res.dataset = learner.datasetInfo ? learner.datasetInfo() : null;
      for (let t = 1; t <= steps; t++) {
        learner.train();
        if (t >= nextEval) { nextEval += evalEvery; doEval(t); }
        if (cfg.onProgress && t >= nextProg) { nextProg += cfg.progressEvery || evalEvery; cfg.onProgress(res, t); }
      }
    } else {
      // Episodes of a group start from the same prompt (same start state, same goal): the group shares one baseline.
      const groupSize = learner.groupSize || 1;
      let groupLeft = 0, groupPrompt = null;
      const newEpisode = () => {
        if (groupSize > 1 && groupLeft > 0 && world.prompt) { groupLeft--; return world.reset(groupPrompt); }
        const o = world.reset();
        if (groupSize > 1 && world.prompt) { groupPrompt = world.prompt(); groupLeft = groupSize - 1; }
        return o;
      };
      let epLeft = null, epSuccess = 0;
      let obs = newEpisode(), epRet = 0, epLen = 0, falls = 0;
      for (let t = 1; t <= steps; t++) {
        const a = learner.act(obs, true);
        const r = world.step(a);
        learner.observe({ obs, a, r: r.reward, obs2: r.obs, done: r.done, truncated: r.truncated });
        epRet += r.reward; epLen++;
        if (r.info && r.info.pos && !isBandit) {
          if (!peek) peek = { ep: epCount + 1, t, pos: [], fell: [], ret: 0 };
          if (peek.pos.length < 400) { peek.pos.push(r.info.pos[0], r.info.pos[1]); peek.fell.push(r.info.fell ? 1 : 0); }
          peek.ret += r.reward;
        }
        if (r.info && r.info.fell) falls++;
        if (r.info && r.info.success) epSuccess = 1;
        if (epLen === 1 && r.info && r.info.left !== undefined) epLeft = r.info.left ? 1 : 0;
        if (isBandit) {
          res.bandit.reward[t - 1] = r.reward;
          res.bandit.optimal[t - 1] = r.info.optimal ? 1 : 0;
          res.bandit.regret[t - 1] = r.info.regret;
          res.bandit.arm[t - 1] = a;
        }
        if (r.done || r.truncated) {
          learner.endEpisode();
          epCount++;
          if (peek) { peek.done = !!r.done; if (PEEK_AT.has(epCount)) res.peeks.push(peek); lastPeek = peek; peek = null; }
          res.ep.t.push(t); res.ep.ret.push(epRet); res.ep.len.push(epLen); res.ep.falls.push(falls); res.ep.success.push(epSuccess);
          if (epLeft !== null) res.ep.left.push(epLeft);
          epRet = 0; epLen = 0; falls = 0; epLeft = null; epSuccess = 0;
          obs = newEpisode();
        } else obs = r.obs;

        if (!isBandit && t >= nextEval) { nextEval += evalEvery; doEval(t); }
        if (cfg.onProgress && t >= nextProg) { nextProg += cfg.progressEvery || evalEvery; cfg.onProgress(res, t); }
      }
    }
    if (lastPeek && !res.peeks.includes(lastPeek)) res.peeks.push(lastPeek);
    if (!isBandit) {
      const e = evaluate(learner, W, knobs, evalRng, world.spec.maxSteps, true);
      res.trace = e.trace; res.traceStart = e.start;
      res.final = { ret: e.ret, disc: e.disc, pred: e.pred, success: e.success, dist: e.dist };
      if (W.playable && learner.policyNet) res.policy = learner.policyNet();
      if (W.evalEpisodes > 1 || learner.offline) {
        // a wider final test: many starts, and their paths for the picture
        // test episode k uses its own random stream, so the classical controller below meets exactly the same starts
        const m = Math.max(20, cfg.finalEpisodes || 0); let sr = 0, ss = 0, sc = 0, sdist = 0, nd = 0, nl = 0, np = 0; res.final.paths = [];
        const testRng = (k) => RLA.rng.make((cfg.seed || 1) * 31 + 5 + 7919 * (k + 1));
        for (let k = 0; k < m; k++) {
          const f = evaluate(learner, W, knobs, testRng(k), world.spec.maxSteps, false);
          sr += f.ret; ss += f.success; sc += f.crashes; if (!Number.isNaN(f.dist)) { sdist += f.dist; nd++; }
          if (f.path) { np++; if (f.path.some((q) => q[0] < -0.3)) nl++; } // went around on the left (fork)
          if (f.path && res.final.paths.length < 12) res.final.paths.push(f.path);
        }
        Object.assign(res.final, { meanRet: sr / m, successRate: ss / m, crashRate: sc / m, meanDist: nd ? sdist / nd : null, leftRate: np ? nl / np : null, n: m });
        if (W.base) {
          // the classical controller alone on the same test starts
          const baseL = { act: (o) => W.base(o, knobs.gain), diagnostics: () => ({}) };
          let br = 0, bd = 0;
          for (let k = 0; k < m; k++) { const f = evaluate(baseL, W, knobs, testRng(k), world.spec.maxSteps, false); br += f.ret; bd += f.dist; }
          Object.assign(res.final, { baseRet: br / m, baseDist: bd / m });
        }
      }
      if (name === 'mirage') { res.final.qA = learner.q(Float32Array.from([1, 0])).slice(0, 2); res.final.qB = learner.q(Float32Array.from([0, 1])); }
      if (name === 'pendulum') {
        // Show the swing-up task, even when the random test starts almost upright.
        // Keep this demonstration separate from every scored evaluation and its RNG.
        const replay = evaluate(learner, W, knobs, RLA.rng.make((cfg.seed || 1) * 104729 + 11), world.spec.maxSteps, true, [Math.PI, 0]);
        res.replay = { trace: replay.trace, start: replay.start, ret: replay.ret };
      }
    } else {
      res.final = { means: Array.from(world.means), q: learner.q(world.reset()), best: world.bestArm() };
    }
    if (learner.table && learner.table() && world.spec.nStates <= 256) res.table = Array.from(learner.table());
    return res;
  }

  // A learner you can step by hand (main thread only): for the one-update replay.
  function session(cfg) {
    const name = cfg.world, W = RLA.worlds[name];
    const knobs = Object.assign(knobDefaults(name), cfg.knobs || {});
    const rng = RLA.rng.make(cfg.seed || 1);
    const world = W.make(knobs, RLA.rng.make((cfg.seed || 1) * 7919 + 13));
    const learner = makeLearner(cfg.parts, world, rng, cfg.hyper);
    let obs = world.reset(), t = 0, last = null;
    // the moves of the episode that holds the latest move, and the last 12 moves (for the replay's animation)
    let ep = [], lastEp = [];
    const hist = [];
    const stateNow = () => (world.getState ? Array.from(world.getState()) : null);
    function advance(k) {
      for (let i = 0; i < k; i++) {
        const st = stateNow();
        const a = learner.act(obs, true);
        const r = world.step(a);
        learner.observe({ obs, a, r: r.reward, obs2: r.obs, done: r.done, truncated: r.truncated });
        last = { obs: Array.from(obs), a, reward: r.reward, r: r.reward, obs2: Array.from(r.obs), done: r.done, truncated: r.truncated, info: r.info, st, st2: stateNow(), t };
        ep.push(last); lastEp = ep; hist.push(last); if (hist.length > 12) hist.shift();
        if (r.done || r.truncated) ep = [];
        t++;
        obs = r.done || r.truncated ? world.reset() : r.obs;
      }
      return last;
    }
    // Play moves until one makes a row worth replaying; hold back that row's update so probe() shows it from the start.
    // wantGuess: skip rows with no guess (episode end). first: replay the first row (the full return of a whole episode).
    function stepAndProbe(opts) {
      opts = opts || {};
      for (let n = 0; n < (opts.max || 5000); n++) {
        learner.hold(true); const m = advance(1); learner.hold(false);
        const f = learner.fresh();
        if (!f.length) continue;
        let k = opts.first ? 0 : f.length - 1;
        if (opts.wantGuess) { while (k >= 0 && f[k].end) k--; if (k < 0) { learner.flushHeld(); continue; } }
        return { move: m, probe: learner.probe(k), t };
      }
      return { move: last, probe: null, t };
    }
    // Policy-gradient and actor-critic learners: play (or train offline) until the next update, then show it
    function untilUpdate(max) {
      if (learner.offline) { learner.train(); t++; return { probe: learner.probe(), t }; }
      const u0 = learner.diagnostics().updates;
      for (let n = 0; n < (max || 50000); n++) { advance(1); if (learner.diagnostics().updates !== u0) return { probe: learner.probe(), t }; }
      return { probe: null, t };
    }
    function trainOffline(k) { for (let i = 0; i < k; i++) learner.train(); t += k; }
    return { world, learner, knobs, advance, stepAndProbe, untilUpdate, trainOffline, get t() { return t; },
      episode: () => lastEp.slice(), history: () => hist.slice() };
  }

  RLA.run = run;
  RLA.session = session;
  RLA.knobDefaults = knobDefaults;
  if (typeof module === 'object' && module.exports) module.exports = RLA;
})();
