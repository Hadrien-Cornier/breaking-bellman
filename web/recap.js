// Unlock notes for discovered methods and failures.
// The short quote is a slice of the Codex evidence already on the card, not a second copy of the paper.
// Practice lines are paraphrases for a person training a policy. They are not quotations.
(function (root) {
  'use strict';

  // [start, end) word indexes into the plain text of the card's existing evidence.
  const SLICE = {
    lockin: [6, 20], egreedy: [13, 27], optimism: [6, 22], ucb: [8, 25], mc: [6, 19],
    noend: [6, 22], qlearning: [21, 38], sarsa: [23, 36], expsarsa: [36, 49], nstep: [25, 35],
    triad: [15, 27], dqn: [50, 63], maxbias: [6, 21], doubleq: [33, 42], ddqn: [21, 39], clipped: [6, 24],
    highvar: [6, 22], reinforce: [6, 26], baseline: [6, 25], a2c: [11, 29], bigsteps: [25, 40], ppo: [6, 16],
    grpo: [39, 58], emptygroups: [33, 41], ddpg: [6, 18], td3: [8, 22], sac: [5, 16], extrap: [8, 24],
    awr: [5, 18], td3bc: [17, 31], iql: [25, 42], cql: [5, 24], modeavg: [6, 26], flow: [28, 42],
    act: [6, 25], bestofn: [7, 23], qplan: [5, 17], expo: [35, 53], criticfirst: [6, 18],
    residual: [41, 52], recap: [2, 19], pi05: [2, 21], pi07: [5, 18], rewardhack: [20, 39], pbrs: [5, 18],
  };

  const GAP = {
    bc: 'No verbatim quote is shown. This card cites Pomerleau 1989, ALVINN, and marks that paper as not read here.',
    filtbc: 'No verbatim quote is shown. This card cites the percent-BC baseline and marks those papers as not read here.',
    timelimit: 'No verbatim quote is shown. This card cites Pardo et al. 2018 and marks that paper as not read here.',
  };

  const PRACTICE = {
    egreedy: 'Keep a small chance of a random action, or a machine that looks bad on the first pulls can be ignored for the rest of the run.',
    optimism: 'Start the estimates high so each action is tried. That push is used up by the first pulls, so a payout that changes later can be missed.',
    ucb: 'Add a bonus that shrinks as an action is tried. It needs a count per action, which is awkward once you cannot count them.',
    mc: 'Update only when the episode ends, using the return you actually got. If the episode never ends, this update never fires.',
    qlearning: 'Learn the best next action, not the action you take while exploring. On a cliff that prefers the short path, including the falls during learning.',
    sarsa: 'Learn the action you will actually take next, so the path you walk while exploring is the path the values describe.',
    expsarsa: 'Average the next actions by how often you take them, instead of using only the single best one or one random sample.',
    nstep: 'Use a few real rewards and then a guess. One reward is fast. The whole episode waits until the end. The useful setting is often between them.',
    dqn: 'A network shares what it learns across similar states. Replay mixes older moves, and a frozen copy of the network holds the target still.',
    doubleq: 'Keep two estimates. One picks the action and the other scores it, so one lucky sample cannot both choose and praise itself.',
    ddqn: 'Let the live network pick the action and a frozen copy score it. The copy is not a fully separate estimate.',
    clipped: 'Use the smaller of two value estimates as the target. That can aim low. The paper that introduced it prefers aiming low to aiming high.',
    reinforce: 'Make an action more likely in proportion to the rewards that followed it. Rewards from before that action are still in the number, and they are noise for it.',
    baseline: 'Subtract a number that does not depend on the action. Better than usual pushes up, worse than usual pushes down, and the average update stays the same.',
    a2c: 'Replace the rest of the return with a critic\'s guess so you can update every step. You also inherit whatever the critic gets wrong.',
    ppo: 'Once an action\'s probability has moved far enough in the helpful direction, stop paying for a still bigger move, so one batch can be used for several passes.',
    grpo: 'When the only reward arrives at the end, skip the critic. Score each try against the other tries of the same prompt.',
    ddpg: 'For a continuous action, output one action and climb the critic. Keep slow copies of both networks so the target does not chase the thing being learned.',
    td3: 'Use the smaller of two critics, add noise to the target action, and update the policy less often than the critic.',
    sac: 'Pay the policy a little for staying random, and move that pay so the randomness stays near a target you chose.',
    bc: 'Copy the actions in the data. You copy the bad ones along with the good ones, and you do not need a reward signal.',
    filtbc: 'Copy only the episodes with the highest returns. Good steps inside a weak episode are discarded with it.',
    awr: 'Copy every action, weighted by how much better than usual it was. The weights are only as steady as the returns you fit.',
    td3bc: 'Climb the critic, and add a penalty for actions far from the data. The size of that penalty is a knob you have to set.',
    iql: 'Do not ask the critic about actions that are missing from the data. Fit a high expectile of the values you did see, then weight the copy by advantage.',
    cql: 'Push the critic down on actions the data never took, and push it up on the actions the data did take.',
    flow: 'Step from noise toward an action, so two different plans in the data can remain two plans instead of their average.',
    act: 'Predict several future commands at once. The policy then decides less often, and has fewer chances to drift off the demonstration.',
    bestofn: 'Draw several actions from a copying policy and play the one a critic scores highest. You still cannot play an action the policy never offers.',
    qplan: 'Leave the copying policy frozen. Train a critic from its own tries, and act with a weighted average of several of its samples.',
    expo: 'Keep a large copying policy, and train a small edit on top of its samples. Play the better of the original sample and the edit.',
    residual: 'Keep a controller that already works, and learn only a correction on top of it. Start that correction at zero and let the critic learn the controller before the policy moves.',
    recap: 'Tell the policy which recorded actions were better than usual, train on that label, and ask for the better label at test time. This page uses one bit, not a full robot model.',
    pi05: 'Train one model on several kinds of data when the goal is behavior in places it has not seen. This page has one small task and no cameras, so it cannot show that.',
    pi07: 'Put extra context in the prompt, including how good the episode was, and ask for high quality at test time. This page has only a one-bit version of that idea.',
    pbrs: 'Add a bonus equal to the change in some function of the state. On a loop those bonuses cancel, so the best policy can stay the same.',
    lockin: 'A greedy learner can stick with a lucky first sample and never go back to try the better option.',
    noend: 'A method that learns only from finished episodes gets no update if the episode does not end.',
    triad: 'A network, bootstrapping, and learning about a different policy than the one that acts can make the estimates run away together.',
    maxbias: 'The same noisy samples that pick the best-looking action also set its value, so a lucky noise spike looks like a good choice.',
    highvar: 'A reward from before an action still pushes that action. Credit the rewards that came after it if you want less of that noise.',
    bigsteps: 'Several passes on one batch keep pushing until the policy is far from the one that collected the data.',
    timelimit: 'If the remaining time is hidden, a critic can treat a timeout as if the episode went on, and the advantages shrink toward zero.',
    emptygroups: 'A group in which every try has the same score has nothing to compare, so it does not move the policy.',
    extrap: 'On a fixed dataset the critic is never corrected on missing actions, and a policy that climbs the critic walks toward those actions.',
    modeavg: 'If demonstrations go left or right around an obstacle, one average action can point through the obstacle.',
    criticfirst: 'A correction that starts at zero matches the controller. A randomly initialized critic does not. Let the critic learn the controller before the policy climbs it.',
    supermimic: 'Fit one model from simulator transitions, then train on short imagined rollouts. Judge the result in the real simulator, because the model can be wrong.',
    rewardhack: 'The learner maximizes the number you wrote. A bonus for facing the stick can be worth more than picking the stick up.',
  };

  function plain(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  }

  function wordsOf(html) {
    const t = plain(html);
    return t ? t.split(/\s+/) : [];
  }

  function showWord(w) {
    return String(w).replace(/[“”]/g, '');
  }

  function paragraphCite(html, start) {
    const chunks = String(html || '').split(/<p\b/i).slice(1);
    let seen = 0;
    for (let i = 0; i < chunks.length; i++) {
      const text = plain('<p' + chunks[i]);
      const n = text ? text.split(/\s+/).length : 0;
      if (start >= seen && start < seen + n) {
        const m = chunks[i].match(/<b>([^<]+)<\/b>/i);
        if (m) return m[1].replace(/:\s*$/, '').trim();
        const head = text.split(/[“"]/)[0].trim();
        const colon = head.match(/^(.*?):/);
        return colon ? colon[1].trim() : head.slice(0, 80);
      }
      seen += n;
    }
    return '';
  }

  function sliceQuote(html, range) {
    if (!html || !range) return null;
    const words = wordsOf(html);
    const part = words.slice(range[0], range[1]).map(showWord);
    const text = part.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { text: text, cite: paragraphCite(html, range[0]), words: text.split(/\s+/).length };
  }

  function ideaFor(id, content, algoHelp) {
    const card = content.cards[id];
    const algos = algoHelp && algoHelp.ALGOS;
    const cardOf = algoHelp && algoHelp.cardOf;
    if (algos && cardOf) {
      const ids = Object.keys(algos);
      for (let i = 0; i < ids.length; i++) {
        if (cardOf(ids[i]) === id && algos[ids[i]].idea) return algos[ids[i]].idea;
      }
    }
    return card && card.fixes ? String(card.fixes) : '';
  }

  function note(id, content, algoHelp) {
    const card = content.cards[id];
    if (!card) return null;
    const quote = sliceQuote(card.evidence, SLICE[id]);
    const idea = ideaFor(id, content, algoHelp);
    return {
      id: id,
      name: card.name,
      kind: card.kind || 'method',
      idea: idea,
      showIdea: !!(idea && idea !== card.fixes),
      quote: quote ? quote.text : '',
      cite: quote ? quote.cite : '',
      quoteWords: quote ? quote.words : 0,
      gap: quote ? '' : (GAP[id] || (card.evidence ? '' : 'No verbatim quote is shown for this card.')),
      practice: PRACTICE[id] || '',
      evidence: card.evidence || '',
    };
  }

  function knownSet(state) {
    const out = [];
    const seen = {};
    const lists = [state.found || [], state.given || []];
    for (let i = 0; i < lists.length; i++) {
      for (let j = 0; j < lists[i].length; j++) {
        const id = lists[i][j];
        if (!seen[id]) { seen[id] = 1; out.push(id); }
      }
    }
    return out;
  }

  // Cards already unlocked whose discovery record, or a level reveal, belongs to this level.
  function cardsForLevel(level, state) {
    if (!level) return [];
    const known = {};
    knownSet(state).forEach((id) => { known[id] = 1; });
    const ids = [];
    const add = (id) => { if (id && known[id] && ids.indexOf(id) < 0) ids.push(id); };
    const discoveries = (state && state.discoveries) || {};
    Object.keys(discoveries).forEach((id) => {
      const d = discoveries[id] || {};
      if (d.levelId === level.id) add(id);
      else if (!d.levelId && d.where && level.title && String(d.where).indexOf('"' + level.title + '"') !== -1) add(id);
    });
    [].concat(level.reveal || [], level.revealOnDone || []).forEach(add);
    return ids;
  }

  // A save from before dismissal existed has no recapDismissed array.
  // Treat every card it already unlocked as dismissed so old pop-ups do not return.
  function unlockState(saved, found, given) {
    const known = knownSet({ found: found, given: given });
    const raw = saved && saved.recapDismissed;
    if (!Array.isArray(raw)) return { legacy: true, dismissed: known.slice(), pending: [] };
    const pending = known.filter((id) => raw.indexOf(id) < 0);
    return { legacy: false, dismissed: raw.slice(), pending: pending };
  }

  function attach(content, algoHelp) {
    Object.keys(content.cards).forEach((id) => {
      const card = content.cards[id];
      const n = note(id, content, algoHelp);
      if (!n) return;
      if (n.practice) card.practice = n.practice;
      if (n.quote) { card.pullQuote = n.quote; card.pullCite = n.cite; }
      else card.quoteGap = n.gap;
      if (n.showIdea) card.ideaLine = n.idea;
    });
  }

  const API = { SLICE: SLICE, PRACTICE: PRACTICE, GAP: GAP, plain: plain, note: note, cardsForLevel: cardsForLevel, unlockState: unlockState, attach: attach, sliceQuote: sliceQuote };
  root.RECAP = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (root.CONTENT && root.ALGO_HELP) attach(root.CONTENT, root.ALGO_HELP);
  else if (typeof window !== 'undefined' && window.CONTENT && window.ALGO_HELP) attach(window.CONTENT, window.ALGO_HELP);
})(typeof globalThis !== 'undefined' ? globalThis : this);
