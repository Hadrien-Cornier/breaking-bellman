(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)) : 0; };
  const tail = (a, f) => a.slice(Math.floor(a.length * (1 - f)));

  // Read the results of several seeds and name the symptoms, with the numbers behind each one.
  // Each symptom: { id, level: 'bad'|'warn'|'ok', label, evidence }
  function autopsy(results) {
    const out = { symptoms: [], summary: {} };
    if (!results.length) return out;
    const r0 = results[0];
    const add = (id, level, label, evidence) => out.symptoms.push({ id, level, label, evidence });

    if (r0.bandit) {
      const n = r0.bandit.optimal.length, w = Math.max(1, Math.floor(n * 0.2));
      const opt = results.map((r) => { let s = 0; for (let i = n - w; i < n; i++) s += r.bandit.optimal[i]; return s / w; });
      const rew = results.map((r) => { let s = 0; for (let i = n - w; i < n; i++) s += r.bandit.reward[i]; return s / w; });
      const reg = results.map((r) => { let s = 0; for (let i = 0; i < n; i++) s += r.bandit.regret[i]; return s; });
      const mo = mean(opt);
      out.summary = { optimalLast20: mo, rewardLast20: mean(rew), totalRegret: mean(reg), seeds: results.length };
      if (mo < 0.5) add('lockIn', 'bad', 'Locked in on a worse arm', `Best arm chosen ${(mo * 100).toFixed(0)}% of the last ${w} pulls (mean of ${results.length} seeds).`);
      else if (mo < 0.7) add('lockIn', 'warn', 'Often on a worse arm', `Best arm chosen ${(mo * 100).toFixed(0)}% of the last ${w} pulls.`);
      else add('lockIn', 'ok', 'Finds the best arm', `Best arm chosen ${(mo * 100).toFixed(0)}% of the last ${w} pulls.`);
      return out;
    }

    if (r0.world === 'mirage') {
      // Share of episodes that took the left door. Every window is a fraction of each seed's own
      // episode count, so "at the end" is the end of every run (an episode is 1 step if the agent
      // goes right and 2 if it goes left, so the episode counts differ a lot between seeds).
      const P = r0.parts || {};
      const maxSteps = (r0.knobs && r0.knobs.maxSteps) || 2;
      const nstep = P.nstep == null ? 1 : +P.nstep;
      // a row keeps a guess only when nstep leaves room for one before the episode ends
      const noGuess = !(nstep > 0) || nstep >= maxSteps;
      const hasMax = !noGuess && P.agg === 'max'; // the target can take a max over the machines
      const binOf = (r, f0, f1) => {
        const n = r.ep.left.length, a = Math.floor(n * f0), b = Math.max(a + 1, Math.floor(n * f1));
        return mean(r.ep.left.slice(a, b));
      };
      const e = mean(results.map((r) => binOf(r, 0, 0.1)));
      // the worst of the three early windows, each window measured on the mean curve. A per-seed max
      // over the same three windows lifts a flat coin flip to about 56%; the max of the window means
      // does not, so the number reads as the rate it is.
      const wins = [0.1, 0.2, 0.3].map((f) => mean(results.map((r) => binOf(r, f, f + 0.1))));
      const peakWin = Math.max.apply(null, wins), stretch = mean(wins);
      const late = mean(results.map((r) => binOf(r, 0.8, 1)));
      const qLeft = mean(results.map((r) => (r.final && r.final.qA ? r.final.qA[1] : NaN)));
      const nEp = mean(results.map((r) => r.ep.left.length));
      // a random try takes the left door with probability epsilon / 2 (two doors in state A)
      const epsNow = P.eps ? (r0.diag && r0.diag.length && isFinite(r0.diag[0].eps) ? r0.diag[0].eps : 0.1) : 0;
      const exploreShare = epsNow / 2;
      // on most runs, did any update land before the early stretch ended? Replay can push the first
      // update past the window this goal measures. Only say so when the runs record update counts.
      const knowsUpdates = results.some((r) => r.diag && r.diag.some((x) => x.updates != null));
      const delayed = knowsUpdates && mean(results.map((r) => {
        const n = r.ep.left.length, end = r.ep.t[Math.max(0, Math.floor(n * 0.4) - 1)];
        const first = r.diag && r.diag.find((x) => (x.updates || 0) > 0);
        return first && first.t <= end ? 0 : 1;
      })) > 0.5;
      out.summary = { leftEarly: e, leftPeak: peakWin, leftPeakMean: stretch, leftLate: late, qLeft, trueLeft: r0.knobs.mean, episodes: nEp, seeds: results.length, hasMax, noGuess };
      const endNote = exploreShare > 0
        ? `the last 20% of each run; about ${Math.round(100 * exploreShare)}% is only exploration`
        : 'the last 20% of each run';
      const ev = `Left door in ${(peakWin * 100).toFixed(0)}% of episodes at the worst of three windows (10-20%, 20-30% and 30-40% of each run; mean ${(stretch * 100).toFixed(0)}% there), ${(late * 100).toFixed(0)}% at the end (${endNote}). Q(A, left) = ${qLeft.toFixed(2)}, true value ${r0.knobs.mean}. Mean of ${results.length} runs.`;
      let cause = '';
      if (noGuess) cause = ' This is not maximization bias: the target has no guess, so no max over the machines enters it.';
      else if (!hasMax) cause = ' This is not maximization bias: the target scores the ' + (P.agg === 'min' ? 'worst' : P.agg === 'mean' ? 'average' : 'taken') + ' next action, not the max.';
      if (delayed) cause += ' No update had landed in that window on most runs, so the estimates were still at their start values there.';
      if (r0.knobs.mean < 0 && peakWin > 0.4) add('mirage', 'bad', hasMax ? 'Chases the mirage' : 'Takes the left door too often early', ev + cause);
      else if (r0.knobs.mean < 0 && peakWin > 0.2) add('mirage', 'warn', hasMax ? 'Tempted by the mirage' : 'Often takes the left door early', ev + cause);
      else add('mirage', 'ok', 'Avoids the mirage', ev + cause);
      return out;
    }

    const maxSteps = r0.knobs.maxSteps;
    const isCart = r0.world === 'cartpole';
    const fam = (r0.parts && r0.parts.family) || 'value';
    const finals = results.map((r) => mean(tail(r.evals.map((e) => e.ret), 0.25)));
    const peaks = results.map((r) => Math.max.apply(null, r.evals.map((e) => e.ret).concat([-Infinity])));
    out.summary.finalReturn = mean(finals);
    out.summary.finalSd = sd(finals);
    out.summary.peak = mean(peaks);
    out.summary.seeds = results.length;

    // 1. divergence: values far outside what any policy can earn, or not a number
    const VMAX = { cartpole: 100, cliff: Math.abs(r0.knobs.cliffPenalty || 100) / (1 - 0.99), pendulum: 16.3 / (1 - 0.99), reach: 2.1 / (1 - 0.97), fork: 2 / (1 - 0.97), goalgrid: 1 };
    const vmax = VMAX[r0.world] || 100;
    const maxQ = Math.max.apply(null, results.flatMap((r) => r.evals.map((e) => (isFinite(e.maxQ) ? e.maxQ : 1e9))));
    out.summary.maxQ = maxQ;
    if (fam === 'value' && maxQ > 10 * vmax) add('diverge', 'bad', 'Values blew up', `Largest |Q| ${fmt(maxQ)}; no policy can earn more than about ${fmt(vmax)}.`);
    if (fam === 'ac') {
      const qp = results.map((r) => { const d = r.diag[r.diag.length - 1]; return d ? Math.abs(d.qPolicy) : 0; });
      if (Math.max.apply(null, qp) > 10 * vmax) add('diverge', 'bad', 'Values blew up', `The critic rates the policy's own actions at ${fmt(Math.max.apply(null, qp))}; no policy can earn more than about ${fmt(vmax)} in size.`);
    }

    // 2. overestimation: predicted value at the start versus what the greedy policy then earned
    const hasPred = (e) => typeof e.pred === 'number' && isFinite(e.pred);
    const gaps = results.map((r) => { const t = tail(r.evals, 0.3).filter(hasPred); return t.length ? mean(t.map((e) => e.pred - e.disc)) : NaN; }).filter(isFinite);
    const discs = results.map((r) => mean(tail(r.evals, 0.3).map((e) => e.disc)));
    if (gaps.length) {
      const g = mean(gaps), d = mean(discs);
      out.summary.overestimate = g; out.summary.realized = d;
      const rel = g / Math.max(r0.world === 'reach' || r0.world === 'fork' ? 1 : r0.world === 'goalgrid' ? 0.2 : 10, Math.abs(d));
      const who = fam === 'pg' ? 'The critic V' : fam === 'ac' ? 'The critic' : 'Q';
      if (rel > 0.25) add('overestimate', 'bad', 'Predicts more than it earns', `${who} says ${fmt(d + g)} at the start; the test run earned ${fmt(d)} (discounted). Gap ${fmt(g)}.`);
      else if (rel > 0.1) add('overestimate', 'warn', 'Predicts a bit more than it earns', `${who} says ${fmt(d + g)}; earned ${fmt(d)}. Gap ${fmt(g)}.`);
    }

    // 3. collapse: learned to balance, then forgot
    let nCollapse = 0;
    for (const r of results) {
      const rets = r.evals.map((e) => e.ret);
      const ip = rets.indexOf(Math.max.apply(null, rets));
      const after = rets.slice(ip + 1);
      if (rets[ip] >= 0.6 * maxSteps && after.length >= 3 && mean(after) < 0.5 * rets[ip]) nCollapse++;
    }
    out.summary.collapsedSeeds = nCollapse;
    if (nCollapse) add('collapse', nCollapse * 2 >= results.length ? 'bad' : 'warn', 'Learned, then forgot',
      `${nCollapse} of ${results.length} seeds reached a high score and then fell below half of it.`);

    // 4. no learning signal
    const withEps = results.filter((r) => r.ep && r.ep.ret.length);
    const nonzero = withEps.map((r) => r.ep.ret.filter((x) => x !== 0).length / r.ep.ret.length);
    if (withEps.length && mean(nonzero) < 0.05) add('noSignal', 'bad', 'No reward signal', `Only ${(mean(nonzero) * 100).toFixed(1)}% of training episodes had any reward.`);

    // 5. seed spread
    if (isCart && results.length > 1 && out.summary.finalSd > 0.3 * maxSteps)
      add('spread', 'warn', 'Seeds disagree', `Final score ${fmt(out.summary.finalReturn)} plus or minus ${fmt(out.summary.finalSd)} across ${results.length} seeds.`);

    // 6. cliff: falls while training
    if (r0.world === 'cliff') {
      const f = mean(results.map((r) => mean(tail(r.ep.falls, 0.5))));
      out.summary.fallsPerEpisode = f;
      if (f > 0.3) add('falls', 'warn', 'Falls off while learning', `${f.toFixed(2)} falls per episode in the second half of training.`);
    }

    // 7. policy-gradient health: step size, exploration, empty groups
    if (fam === 'pg') {
      const dl = results.map((r) => tail(r.diag, 0.5));
      const kl = mean(dl.map((d) => mean(d.map((x) => Math.abs(x.kl || 0)))));
      const ent = mean(dl.map((d) => mean(d.map((x) => x.entropy || 0))));
      const zf = mean(results.map((r) => { const d = r.diag[r.diag.length - 1]; return d ? d.zeroFrac || 0 : 0; }));
      Object.assign(out.summary, { kl, entropy: ent, zeroFrac: zf });
      if (kl > 0.05) add('bigSteps', kl > 0.2 ? 'bad' : 'warn', 'Each update moves the policy a lot', `Mean KL between the policy before and after an update: ${kl.toFixed(3)} (PPO-sized steps are about 0.01 to 0.02).`);
      if (r0.parts.baseline === 'group' && zf > 0.3) add('emptyGroups', zf > 0.6 ? 'bad' : 'warn', 'Most groups teach nothing', `${(zf * 100).toFixed(0)}% of the groups had the same score in every attempt, so every advantage was 0.`);
      if (!['pendulum', 'reach', 'fork'].includes(r0.world) && ent < 0.05) add('noExplore', 'warn', 'The policy stopped exploring', `Mean entropy ${ent.toFixed(3)} nats: it almost always picks the same action.`);
    }
    if (fam === 'ac') {
      const dl = results.map((r) => tail(r.diag, 0.5));
      const std = mean(dl.map((d) => mean(d.map((x) => x.std || 0))));
      out.summary.std = std;
      if (r0.parts.head === 'gauss' && r0.parts.entropy === 'none' && std < 0.05) add('noExplore', 'warn', 'The policy stopped exploring', `Mean standard deviation of the policy: ${std.toFixed(3)}. Its tries are almost all the same.`);
      if (r0.dataset) out.summary.dataset = r0.dataset;
    }

    // 8. the wide final test (many starts): success, crashes, distance
    const fins = results.map((r) => r.final || {});
    if (fins[0].n) {
      const fm = (k) => mean(fins.map((f) => f[k]).filter((x) => typeof x === 'number' && isFinite(x)));
      Object.assign(out.summary, { successRate: fm('successRate'), crashRate: fm('crashRate'), meanDist: fm('meanDist'), testReturn: fm('meanRet'), baseDist: fm('baseDist'), baseRet: fm('baseRet'), leftRate: fm('leftRate'), tests: fins[0].n });
    }
    const S_ = out.summary;
    if (r0.world === 'pendulum') {
      // the wide final test (20 starts per seed) decides; the score during training is noisier
      const sc = isFinite(S_.testReturn) ? S_.testReturn : S_.finalReturn, n = S_.tests ? ` (${S_.tests} test starts per seed)` : '';
      out.summary.pendulumScore = sc;
      // the mean of 3 seeds can pass while one seed hangs: keep the worst seed too
      const ws = fins.map((f) => f.meanRet).filter((x) => typeof x === 'number' && isFinite(x));
      out.summary.worstSeed = ws.length ? Math.min.apply(null, ws) : sc;
      if (sc >= -250 && out.summary.worstSeed < -250) add('seedStuck', 'warn', 'One seed did not swing up', `The mean test score is ${fmt(sc)}, but the worst seed scored ${fmt(out.summary.worstSeed)}. The mean hides it.`);
      if (sc >= -250) add('solved', 'ok', 'Swings up and holds', `Final test score ${fmt(sc)} over 200 steps${n}. 0 is perfect; hanging still scores about −1200.`);
      else if (sc >= -700) add('unsolved', 'warn', 'Swings up from some starts', `Final test score ${fmt(sc)} over 200 steps${n}.`);
      else add('unsolved', 'bad', 'Does not swing up', `Final test score ${fmt(sc)} over 200 steps${n}.`);
    }
    if (r0.world === 'reach' && isFinite(S_.baseRet) && r0.parts && r0.parts.base === 'classical') {
      const d = S_.testReturn - S_.baseRet;
      out.summary.vsBase = d;
      add('vsBase', d >= 0 ? 'ok' : d >= -1.5 ? 'warn' : 'bad', d >= 0 ? 'Beats the classical controller' : 'Worse than the classical controller alone',
        `Test score ${fmt(S_.testReturn)} against ${fmt(S_.baseRet)} for the controller alone, on the same ${S_.tests} starts.`);
    }
    if (r0.world === 'reach') {
      const base = isFinite(S_.baseDist) ? ` The classical controller alone: ${S_.baseDist.toFixed(3)} m.` : '';
      const ev = `Mean distance to the target at the end: ${S_.meanDist.toFixed(3)} m over ${S_.tests} test starts.` + base;
      if (S_.meanDist < 0.03) add('solved', 'ok', 'Reaches and holds the target', ev);
      else if (S_.meanDist < 0.1) add('unsolved', 'warn', 'Ends near the target', ev);
      else add('unsolved', 'bad', 'Misses the target', ev);
    }
    if (r0.world === 'fork') {
      const ev = `Reached the goal in ${(S_.successRate * 100).toFixed(0)}% of ${S_.tests} test starts; ${S_.crashRate.toFixed(1)} obstacle hits per test.`;
      if (S_.crashRate >= 1) add('crash', 'bad', 'Drives into the obstacle', ev);
      if (S_.successRate >= 0.8) add('solved', 'ok', 'Goes around and reaches the goal', ev);
      else if (S_.crashRate < 1) add('unsolved', S_.successRate >= 0.4 ? 'warn' : 'bad', 'Does not reach the goal', ev);
    }
    if (r0.world === 'fetch') {
      const found = r0.knobs.found != null ? r0.knobs.found : 1;
      const ev = `Got the stick in ${(S_.successRate * 100).toFixed(0)}% of ${S_.tests} test throws; each throw paid ${fmt(S_.testReturn)} reward on average (the stick alone pays ${fmt(found)}).`;
      if (S_.successRate < 0.5 && S_.testReturn > 0.5 * found) add('hack', 'bad', 'Collects reward without the stick', ev);
      if (S_.successRate >= 0.8) add('solved', 'ok', 'Fetches the stick', ev);
      else if (!(S_.successRate < 0.5 && S_.testReturn > 0.5 * found)) add('unsolved', S_.successRate >= 0.4 ? 'warn' : 'bad', 'Often misses the stick', ev);
    }
    if (r0.world === 'goalgrid') {
      const ev = `Reached the goal in ${(S_.successRate * 100).toFixed(0)}% of ${S_.tests} new prompts (start and goal).`;
      if (S_.successRate >= 0.8) add('solved', 'ok', 'Solves most prompts', ev);
      else add('unsolved', S_.successRate >= 0.4 ? 'warn' : 'bad', 'Fails many prompts', ev);
    }

    // verdict on the task itself
    const target = isCart ? 0.9 * maxSteps : null;
    if (isCart) {
      if (out.summary.finalReturn >= target) add('solved', 'ok', 'Balances to the time limit', `Final greedy score ${fmt(out.summary.finalReturn)} of ${maxSteps}.`);
      else if (out.summary.finalReturn < 0.5 * maxSteps) add('unsolved', 'bad', 'Does not balance', `Final greedy score ${fmt(out.summary.finalReturn)} of ${maxSteps}.`);
      else add('unsolved', 'warn', 'Balances part of the time', `Final greedy score ${fmt(out.summary.finalReturn)} of ${maxSteps}.`);
    }
    return out;
  }

  function fmt(x) { return !isFinite(x) ? String(x) : Math.abs(x) >= 1000 ? x.toExponential(1) : x.toFixed(Math.abs(x) >= 10 ? 0 : 1); }

  RLA.autopsy = autopsy;
  RLA.stats = { mean, sd, tail };
  if (typeof module === 'object' && module.exports) module.exports = RLA;
})();
