// "Did you notice?": after a run that shows something surprising, the page asks the player to look at one chart and
// say what they see, before it explains. One moment per run, at most twice per kind (the player can replay any later).
// The explanation names the mechanism; it never gives away a campaign repair. Sources: Sutton and Barto (2018), the PPO,
// DAPO and TD3 papers (see the codex cards). Every number shown comes from the player's own run.
(function (C) {
  'use strict';
  const W = {
    diverge: {
      charts: ['ch-q', 'ch-qq', 'ch-val'], chartName: 'Largest |Q| seen',
      ask: 'Look at the value chart before you read on. What happened to the values?',
      options: [
        ['They grew far beyond any score the agent can earn.', true],
        ['They stayed close to the score the agent earns.', false],
        ['They fell to zero and stayed there.', false],
      ],
      why: 'The learner updates each estimate toward a target that it computes with its own estimates. With a network, one update also moves the targets of other states. With old data and a max (or a policy that climbs the critic), an error that pushes a value up also pushes the next targets up, and the values feed on themselves. Sutton and Barto call this mix of function approximation, bootstrapping and off-policy data the <i>deadly triad</i> (section 11.3).',
    },
    collapse: {
      charts: ['ch-main', 'ch-ret'], chartName: 'the score chart',
      ask: 'Look at the score curve. What happened during training?',
      options: [
        ['It reached a good score, then lost it.', true],
        ['It climbed slowly and never stopped climbing.', false],
        ['It never left the starting score.', false],
      ],
      why: 'One set of weights holds the whole skill. An update that helps the states the learner sees now can damage the states it no longer sees. A good policy stops visiting bad states, so the data stops showing them, the estimates there drift, and the policy walks back into them. A large policy step can do the same in one batch.',
    },
    overestimate: {
      charts: ['ch-val', 'ch-qq'], chartName: 'Predicted value vs value earned',
      ask: 'Look at the two lines on "Predicted value vs value earned" at the end of training. Which is higher?',
      options: [
        ['The prediction is higher than what the agent earns.', true],
        ['The prediction is lower than what the agent earns.', false],
        ['They are the same.', false],
      ],
      why: 'Something picks the best-looking action by its estimate: a max in Q-learning, or a policy trained to climb the critic. The best-looking estimate is often the one with the largest upward error. So the targets are too high on average, and the error flows into the next targets. Sutton and Barto call this <i>maximization bias</i> (section 6.7). Two independent estimates, one to pick and one to score, remove most of it.',
    },
    pessimistic: {
      charts: ['ch-val'], chartName: 'Predicted value vs value earned',
      ask: 'Look at the two lines on "Predicted value vs value earned" at the end of training. Which is higher?',
      options: [
        ['The prediction is lower than what the agent earns.', true],
        ['The prediction is higher than what the agent earns.', false],
        ['They are the same.', false],
      ],
      why: 'The target scores the next state lower than the greedy policy really does. For example: the worst next action instead of the best, the average over the moves of a policy that still explores, or a frozen copy that is refreshed rarely (each refresh lets the values climb only a little). A low prediction alone does not stop learning: to act, the learner uses only the order of its estimates in a state, not their size.',
    },
    noSignal: {
      charts: ['ch-main', 'ch-ret', 'ch-task'], chartName: 'the score chart',
      ask: 'The score did not move. Before you read on: why can the learner not improve?',
      options: [
        ['Almost no training episode got any reward, so there was nothing to learn from.', true],
        ['The network is too small.', false],
        ['The learning rate is too low.', false],
      ],
      why: 'If no episode reaches a reward, every target is 0 and every action looks the same. The learner gets no direction at all. Exploration must find the reward first, or the reward must come earlier (shaping), or the task must start easier.',
    },
    emptyGroups: {
      charts: ['ch-main', 'ch-task'], chartName: 'the score chart',
      ask: 'Each prompt got a group of attempts. Before you read on: why did most groups teach nothing?',
      options: [
        ['Every attempt in the group got the same score, so every advantage was 0.', true],
        ['The groups were too large.', false],
        ['The policy changed too much per update.', false],
      ],
      why: 'GRPO scores each attempt against the mean of its group. If all attempts fail (or all pass), each one equals the mean, the advantage is 0, and the gradient is 0. DAPO (2025) drops such groups and samples new prompts.',
    },
    bigSteps: {
      charts: ['ch-kl'], chartName: 'How far each update moves the policy (KL)',
      ask: 'Look at the KL chart. What does it say about each update?',
      options: [
        ['Each update changes the action probabilities a lot.', true],
        ['The updates barely change the policy.', false],
        ['The policy does not change at all.', false],
      ],
      why: 'The KL divergence measures how much the action probabilities change in one update. A large change can throw away a good policy in one batch, because the batch only shows what the old policy did. PPO clips the ratio of new to old probabilities so that one batch cannot move the policy far.',
    },
    seedStuck: {
      charts: ['ch-main', 'ch-ret'], chartName: 'the score chart',
      ask: 'The mean score looks good. Look at each seed: does the mean tell the whole story?',
      options: [
        ['No: one seed stayed stuck, and the mean hides it.', true],
        ['Yes: every seed did about the same.', false],
        ['No: every seed failed.', false],
      ],
      why: 'Each seed has its own random start and its own random tries, so each run has its own history. A mean over a few seeds can hide one run that never learned. Read every seed, and report the spread, not only the mean.',
    },
    mirage: {
      charts: ['ch-main'], chartName: 'Left door from A',
      ask: 'Look at how often the learner takes the left door. The left door pays less on average. What happened?',
      options: [
        ['It chose the worse door often, for a long time.', true],
        ['It found the better door at once.', false],
        ['It chose the doors at random all the time.', false],
      ],
      why: 'Behind the left door there are many noisy machines. Their average is below 0, but the max over their noisy estimates is above 0, so a target with a max sees a mirage. Sutton and Barto show this with Example 6.7 (maximization bias). Double Q-learning picks with one estimate and scores with another, independent one.',
    },
    lockIn: {
      charts: ['ch-main'], chartName: 'Share of pulls on the best machine',
      ask: 'Look at the share of pulls on the best machine. What happened?',
      options: [
        ['It settled on a worse machine and almost never tried the best one again.', true],
        ['It found the best machine and stayed on it.', false],
        ['It kept switching between all machines.', false],
      ],
      why: 'With greedy choices, an unlucky early result makes the best machine look bad. The learner never tries it again, so its estimate never gets fixed. Some exploration, optimistic starting values, or a bonus for uncertainty (UCB) breaks the lock.',
    },
    falls: {
      charts: ['ch-main'], chartName: 'the score chart',
      ask: 'The learner knows the short path, but it still falls a lot while it learns. Why?',
      options: [
        ['Its random tries happen right next to the cliff, on the path it thinks is best.', true],
        ['It has not found the goal yet.', false],
        ['The cliff moves.', false],
      ],
      why: 'Q-learning learns the values of the greedy path along the edge, but it still takes random actions while it learns, and next to the edge a random step is a fall. Sarsa learns the values of what it really does, random tries included, so it prefers a path farther from the edge (Sutton and Barto, Example 6.6).',
    },
    noExplore: {
      charts: ['ch-ent', 'ch-main'], chartName: 'Randomness of the policy',
      ask: 'Look at the randomness of the policy. What happened to it?',
      options: [
        ['It fell to almost 0: the policy almost always does the same thing.', true],
        ['It stayed high: the policy kept trying different actions.', false],
        ['It went up and down at random.', false],
      ],
      why: 'A policy gradient makes likely actions more likely. Without a counterweight, the policy can become almost certain before it has found the best action, and then it stops discovering. An entropy bonus pays the policy for keeping some randomness.',
    },
  };
  const ORDER = ['diverge', 'collapse', 'overestimate', 'pessimistic', 'noSignal', 'emptyGroups', 'bigSteps', 'seedStuck', 'mirage', 'lockIn', 'falls', 'noExplore'];

  // pick the most important surprise of this run that the player has seen fewer than `limit` times
  C.wonderPick = function (cfg, a, counts, limit) {
    if (!a) return null;
    const lim = limit || 2, have = {};
    for (const s of a.symptoms || []) if (s.level !== 'ok' && W[s.id] && (s.level === 'bad' || s.id !== 'overestimate')) have[s.id] = s.evidence;
    const sm = a.summary || {};
    if (C.famOf(cfg.parts) === 'value' && isFinite(sm.overestimate) && isFinite(sm.realized) && !have.diverge) {
      const w = cfg.world, rel = sm.overestimate / Math.max(w === 'goalgrid' ? 0.2 : 10, Math.abs(sm.realized));
      if (rel < -0.1 && !['bandit', 'mirage'].includes(w)) have.pessimistic = 'At the start, Q predicts ' + (sm.realized + sm.overestimate).toFixed(1) + '. The greedy test earned ' + sm.realized.toFixed(1) + ' (discounted).';
    }
    for (const id of ORDER) if (have[id] && (counts[id] || 0) < lim) return Object.assign({ id, evidence: have[id] }, W[id]);
    return null;
  };
  C.wonder = W;
})(window.CONTENT);
