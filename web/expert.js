// "An expert reads this run": short notes that tie the words of a value-learning sentence to what the charts show.
// Added 16 Oct 2026 from a page comment. Every number below is measured in this page (docs/EXPERIMENTS.md, batches 24 to 26).
// Simulation. A note says what you see, why the words cause it, and what would change it.
(function (C) {
  'use strict';
  // measured values (batch 26 unless marked)
  const M = {
    cliffMax: -13, cliffMaxFalls: 0.32, cliffTaken: -82, cliffTakenSd: 47, cliffTakenFalls: 0.06, cliffTakenGap: 21,
    cliffMean: -15, cliffMeanGap: 2, cliffMin: -176, cliffMinTopRow: 76, cliffMinReach: 1, cliffSecond: -105, cliffMinpair: -98, cliffSecondGap: 21, cliffMinpairGap: 19,
    dqnMinPred: 10, dqnMinEarned: 81, dqnMinScore: 157, dqnMaxPred: 55, dqnMaxEarned: 76, dqnMaxScore: 148, fastestFall: 8.7,
    naiveMaxQ: '4.7 million', naiveMinQ: 216, naiveMinPeak: 129, naiveMinEnd: 27,
    mirageMax: 82, mirageMin: 7, mirageMean: 78, mirageSecond: 16, mirageMinpair: 14, // mirage mean: batch 25; second, minpair: level runs
    sync1000Pred: 16, sync1000Cap: 17, sync250Pred: 55, sync250Cap: 54, sync50Pred: 151, sync50MinQ: 4719,
    greedyAvg: 35.5, // batch 24: greedy with averages, best machine in late pulls
  };
  const neg = (x) => String(x).replace('-', '−');
  const word = (key, val) => '“' + ((C.words[key].options.find((o) => o[0] === val) || [0, String(val)])[1]) + '”';
  const P = (html) => '<p>' + html + '</p>';
  const fmtV = (x) => neg(Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10);

  // the pattern on "Predicted value vs value earned" in this run
  function pattern(cfg, a) {
    const s = a.summary, w = cfg.world;
    if (a.symptoms.some((x) => x.id === 'diverge')) return { kind: 'diverging', title: 'The values blew up',
      html: P('The largest |Q| is ' + fmtV(s.maxQ) + ', far above anything a policy can earn here. Each update raised the targets of the next updates, so the values fed on themselves.') };
    if (!isFinite(s.overestimate) || !isFinite(s.realized)) return null;
    const pred = s.realized + s.overestimate, gap = s.overestimate;
    const rel = gap / Math.max(w === 'goalgrid' ? 0.2 : w === 'reach' || w === 'fork' ? 1 : 10, Math.abs(s.realized));
    const nums = 'At the start, Q predicts <b>' + fmtV(pred) + '</b>. The greedy test earned <b>' + fmtV(s.realized) + '</b> (discounted, mean of the last 30% of training).';
    if (rel > 0.1) return { kind: 'optimistic', title: 'Q predicts more than the policy earns', html: P(nums + ' The values are too high by ' + fmtV(gap) + '.') };
    if (rel < -0.1) return { kind: 'pessimistic', title: 'Q predicts less than the policy earns', html: P(nums + ' The values are too low by ' + fmtV(-gap) + '.') +
      P('A low prediction alone does not stop learning. To act, the learner uses only the order of its estimates in a state, not their size. Whether that order is right decides the score.') };
    return { kind: 'close', title: 'The prediction matches what the policy earns', html: P(nums + ' The values are about right for the path the greedy policy takes.') };
  }

  // notes about the words of the sentence
  function wordNotes(cfg, a) {
    const p = cfg.parts, w = cfg.world, out = [];
    const naive = p.store === 'net' && p.data === 'latest' && p.picker === 'live' && p.scorer === 'live';
    const frozen = p.picker === 'frozen' || p.scorer === 'frozen';
    if (p.nstep === 0) {
      out.push({ title: 'You chose ' + word('nstep', 0) + ': no guess', html:
        P('Q is the average of the real returns, so no wrong estimate leaks into a target. But a value changes only when an episode ends, and real returns are noisy.') +
        P('On the cliff, no episode reached the goal within 200 steps, so it never learned (20 runs).') });
      return out;
    }
    if (p.agg === 'min') {
      out.push({ title: 'You chose ' + word('agg', 'min') + ': a pessimist that can still act well', html:
        P('Each update moves Q(s, a) toward r + γ × the lowest estimate in the next state. So Q(s, a) learns what happens if you take a now and then make the worst move at every later step. That is why the prediction sits below what the agent earns.') +
        (w === 'cartpole' ? P('In CartPole the worst pushes drop the pole fast: the fastest fall from the start takes ' + M.fastestFall + ' steps. DQN with this word predicted ' + M.dqnMinPred + ' at the start and earned ' + M.dqnMinEarned + ' (discounted; ' + M.dqnMinScore + ' of 200 steps; 3 runs). With ' + word('agg', 'max') + ': ' + M.dqnMaxPred + ' and ' + M.dqnMaxEarned + '.') : '') +
        (w === 'cliff'
          ? P('<b>Why it fails here:</b> a good place sits next to a trap. The worst move from an edge cell is a jump, so every cell near the edge looks terrible, and the goal is next to the edge. In 20 runs of 10000 steps with ε = 0.1, the greedy walk spent ' + M.cliffMinTopRow + '% of its steps in the top row and reached the goal in ' + M.cliffMinReach + ' run (score ' + neg(M.cliffMin) + ', against ' + neg(M.cliffMax) + ' with ' + word('agg', 'max') + ').') +
            P('<b>Where it works:</b> CartPole. There the push that buys the most time against the worst later pushes is also the push a good controller makes. DQN with this word scored ' + M.dqnMinScore + ' of 200 while it predicted ' + M.dqnMinPred + ' (3 runs).')
          : P('<b>Why it still learns.</b> The learner still takes the action with the highest estimate. This word ranks an action by how the episode goes if every later move is the worst one. In CartPole, the push that buys the most time against the worst later pushes is also the push a good controller makes. So the order of the actions stays right while every number is too low.') +
            P('<b>When it breaks:</b> when a good place sits next to a trap. On the cliff, the worst move from an edge cell is a jump, so every cell near the edge looks terrible, and the goal is next to the edge. In 20 runs of 10000 steps with ε = 0.1, the greedy walk spent ' + M.cliffMinTopRow + '% of its steps in the top row and reached the goal in ' + M.cliffMinReach + ' run (score ' + neg(M.cliffMin) + ', against ' + neg(M.cliffMax) + ' with ' + word('agg', 'max') + ').')) +
        P('Pessimism also cures the mirage: left door in ' + M.mirageMin + '% of episodes at the worst point, against ' + M.mirageMax + '% with ' + word('agg', 'max') + ' (300 runs). It removes an upward bias by adding a downward one.') +
        (naive ? P('With a network that makes its own targets, this word did not blow up (largest |Q| ' + M.naiveMinQ + '), but 2 of 3 runs learned and then forgot (best ' + M.naiveMinPeak + ', end ' + M.naiveMinEnd + ' of 200).') : '') });
    } else if (p.agg === 'max' && p.picker === 'live' && p.scorer === 'live') {
      if (naive) out.push({ title: 'A network that makes its own targets', html:
        P('The estimate that is being trained also makes the target, and the network spreads each change to nearby states. A raised value raises the next targets, and they raise the value again. With ' + word('agg', 'max') + ', the guess also picks the luckiest estimate.') +
        P('Measured: largest |Q| ' + M.naiveMaxQ + ' after 20000 steps (3 runs), while no policy can earn more than 100. The cure in this page: a frozen copy for the target and random old moves from memory (DQN).') });
      else out.push({ title: 'You chose ' + word('agg', 'max'), html:
        P('The guess takes the highest of the next estimates. When those estimates are noisy, the highest one is often a lucky one, so the guess is biased up. On the mirage, this sent the learner through the losing door in ' + M.mirageMax + '% of episodes at the worst point (300 runs).') +
        P(w === 'cliff' ? 'On the cliff the step rewards are not noisy, so the bias is small: Q matches what it earns. The cost here is elsewhere: Q values the edge path as if it never acted at random, so it falls ' + M.cliffMaxFalls + ' times per episode while learning (20 runs).' : 'Without noise in the rewards the bias is small.') });
    } else if (p.agg === 'taken') {
      out.push({ title: 'You chose ' + word('agg', 'taken'), html:
        P('Q values the policy that the learner really follows, random tries included. On the cliff that keeps it away from the edge while it learns: ' + M.cliffTakenFalls + ' falls per episode, against ' + M.cliffMaxFalls + ' with ' + word('agg', 'max') + ' (20 runs).') +
        P('The greedy test then walks without random tries, on a path Q did not value directly. In some runs it wanders (score ' + neg(M.cliffTaken) + ' ± ' + M.cliffTakenSd + ', 20 runs), so Q predicts more than the test earns (by ' + M.cliffTakenGap + ' on the cliff). The target also depends on one random next action, so it is noisy.') });
    } else if (p.agg === 'mean') {
      out.push({ title: 'You chose ' + word('agg', 'mean'), html:
        P('The guess averages the next actions, each weighted by how often the learner takes it. With ε = 0.1 that is 0.9 × best + 0.1 × average: almost the best next action, without the noise of one random next action.') +
        P('On the cliff: score ' + neg(M.cliffMean) + ', and Q within ' + M.cliffMeanGap + ' of what it earns (20 runs). It keeps most of the mirage: ' + M.mirageMean + '% left door, because 91% of its weight is still on the best-looking action.') });
    }
    if (p.scorer === 'second' || p.scorer === 'minpair') {
      out.push({ title: 'Two estimates score the guess', html:
        P(p.scorer === 'second' ? 'One estimate chooses the next action and an independent twin scores it. The luck that chose the action does not also score it, so the upward bias of the max goes away (mirage: ' + M.mirageSecond + '% left door).' :
          'The target keeps the smaller of two estimates. That cancels the upward bias of the max and can push the values below the truth (mirage: ' + M.mirageMinpair + '% left door).') +
        P('The cost: each twin learns from half of the updates, so it learns more slowly. On the cliff at 10000 steps: score ' + neg(p.scorer === 'second' ? M.cliffSecond : M.cliffMinpair) + ' against ' + neg(M.cliffMax) + ' with one estimate, and Q below what it earns by ' + (p.scorer === 'second' ? M.cliffSecondGap : M.cliffMinpairGap) + ' (20 runs).') });
    }
    if (frozen && p.store === 'net') {
      const k = Math.floor((cfg.steps || 0) / Math.max(1, p.sync)), cap = (1 - Math.pow(0.99, k)) / 0.01;
      out.push({ title: 'The frozen copy sets how fast the values can grow', html:
        P('The target reads a copy that is refreshed every ' + p.sync + ' updates. Between two refreshes the target cannot rise, so a value climbs by about one more step of the future per refresh. With about one update per step, this run had about ' + k + ' refreshes, so no value could go much above 1 + 0.99 + … ≈ ' + fmtV(cap) + '.') +
        P('Measured on CartPole, DQN, 20000 steps, 3 runs: refresh every 1000 updates, Q at the start ' + M.sync1000Pred + ' (cap ' + M.sync1000Cap + '); every 250, ' + M.sync250Pred + ' (cap ' + M.sync250Cap + '); every 50, ' + M.sync50Pred + ', above the 100 that any policy can earn. A rare refresh keeps the values low and steady. A frequent one brings the chase back: with ' + word('agg', 'min') + ' and a refresh every 50 updates, the values blew up downward (largest |Q| ' + M.sync50MinQ + ').') });
    }
    if (p.nstep > 1) out.push({ title: 'You chose ' + word('nstep', p.nstep), html:
      P('Each target uses ' + p.nstep + ' real rewards before the guess. A wrong estimate then counts only γ<sup>' + p.nstep + '</sup> as much, and news travels ' + p.nstep + ' steps back per update. The price: the target waits ' + p.nstep + ' steps, and with random old moves those rewards come from an older policy.') });
    if (p.eps === false) out.push({ title: 'You chose ' + word('eps', false), html:
      P('The learner never tries an action whose estimate is low, so a wrong low estimate is never corrected. On the slot machines, greedy with averages chose the best machine in only ' + M.greedyAvg + '% of the late pulls (200 runs).') });
    return out;
  }

  // compared with the pinned run A
  function compare(cfg, a, A) {
    if (!A || A.world !== cfg.world || !A.summary || !isFinite(A.summary.overestimate) || !isFinite(a.summary.overestimate)) return null;
    const keys = Object.keys(cfg.parts).filter((k) => C.words[k] && A.parts[k] !== cfg.parts[k]);
    if (!keys.length) return null;
    const pa = A.summary.realized + A.summary.overestimate, pn = a.summary.realized + a.summary.overestimate;
    return { title: 'Compared with A', html: P('You changed ' + keys.map((k) => word(k, A.parts[k]) + ' → ' + word(k, cfg.parts[k])).join(', ') + '. ' +
      'A predicted ' + fmtV(pa) + ' and earned ' + fmtV(A.summary.realized) + '. This run predicts ' + fmtV(pn) + ' and earns ' + fmtV(a.summary.realized) + '. ' +
      'The gap between prediction and earning moved from ' + fmtV(A.summary.overestimate) + ' to ' + fmtV(a.summary.overestimate) + '.') };
  }

  C.expert = function (cfg, a, A) {
    if (!cfg || C.famOf(cfg.parts) !== 'value' || cfg.world === 'bandit' || cfg.world === 'mirage') return null;
    const notes = [];
    const pt = pattern(cfg, a); if (pt) notes.push(pt);
    const cp = compare(cfg, a, A); if (cp) notes.push(cp);
    return notes.concat(wordNotes(cfg, a));
  };
})(window.CONTENT);
