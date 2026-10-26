// Lecture 24 successor features. The expectation lives in src/agents/successor.js.
// This file does not import hindsight or goal cloning.
(function (C, SF) {
  'use strict';
  if (!C || !SF || !SF.build) throw new Error('successor lesson requires CONTENT and BBSUCCESSOR');
  if (!C.phases.some((p) => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.successor = 'Door path';
  const lesson = {
    id: 'successor', custom: true, phase: 9, world: 'successor', title: 'Change the reward, keep the features', focus: [],
    intro: 'One fixed policy walks Start, Door, Bonus, and Goal. Each transition has a step feature and a door feature. The successor vector is how much of each feature that policy will see. A new reward is the dot product of that vector with new weights.',
    goal: { text: 'Change the weights, recompute the dot product, and match the separate discounted return with no new environment step. Then lock the door and see the old vector miss.' },
  };
  const hindsightAt = C.levels.findIndex((l) => l.id === 'hindsight');
  const hierarchyAt = C.levels.findIndex((l) => l.id === 'hierarchy');
  const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
  let insertAt = C.levels.length;
  if (hierarchyAt >= 0) insertAt = hierarchyAt;
  else if (hindsightAt >= 0) insertAt = hindsightAt + 1;
  else if (goalsAt >= 0) insertAt = goalsAt + 1;
  C.levels.splice(insertAt, 0, lesson);

  const NAME = { S: 'Start', D: 'Door', B: 'Bonus', A: 'Alley', M: 'Mid', G: 'Goal' };
  const name = (id) => NAME[id] || id;
  const css = '#successor-lesson,#successor-rules{max-width:100%;overflow-wrap:anywhere}#successor-lesson .btn,#successor-lesson .opt,#successor-lesson input,#successor-rules .btn{min-height:44px}#successor-lesson .controls,#successor-lesson .weights{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}#successor-lesson .rooms{display:flex;flex-wrap:wrap;gap:6px}#successor-lesson .cell{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:4px 6px;background:var(--surface)}#successor-lesson .cell.on{border-color:var(--accent)}#successor-lesson .tuple{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}#successor-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#successor-lesson input{max-width:8rem;font:inherit;padding:8px}#successor-lesson label{display:flex;flex-direction:column;gap:4px;font-size:.85rem}';
  const state = {
    pred: null, diag: null, explain: null, stored: null, scalar: null, live: null, ranked: null,
    weights: { step: SF.WEIGHTS.base.step, door: SF.WEIGHTS.base.door },
    policy: 'take', dynamics: 'open', gamma: SF.GAMMA, horizon: SF.HORIZON,
    sawTradeoff: false, sawAgree: false, sawStale: false, sawGap: false,
  };
  let redraw = null;

  function ensureCss() {
    if (document.getElementById('successor-css')) return;
    const style = document.createElement('style');
    style.id = 'successor-css';
    style.textContent = css;
    document.head.append(style);
  }

  function num(x) {
    if (!Number.isFinite(x)) return 'undefined';
    return String(Math.round(x * 1000) / 1000);
  }

  function vec(psi) {
    return 'step ' + num(psi[0]) + ', door ' + num(psi[1]);
  }

  function baseSpec() {
    return { policy: 'take', dynamics: 'open', gamma: SF.GAMMA, horizon: SF.HORIZON, weights: SF.WEIGHTS.base, state: 'S' };
  }

  function ready() {
    return state.sawTradeoff && state.sawAgree && state.sawStale && state.sawGap;
  }

  function note(result) {
    const stored = state.stored;
    if (!stored || !result) return;
    const original = result.policy === 'take' && result.dynamics === 'open' && result.gamma === SF.GAMMA && result.horizon === SF.HORIZON;
    if (result.mode === 'weights' && original && result.match && result.newModelReads === 0 && result.newEnvInteractions === 0) {
      if (result.doorScale.defined && result.stepScale.defined && result.doorScale.q < 0 && result.stepScale.q < 0 && result.q > 0) state.sawTradeoff = true;
      if (result.doorScale.defined && result.stepScale.defined && result.doorScale.q === result.q && result.stepScale.q === result.q && (result.weights.step !== stored.weights.step || result.weights.door !== stored.weights.door)) state.sawAgree = true;
    }
    if (result.mode === 'rebuild' && result.dynamics === 'locked' && result.policy === 'take' && result.gamma === SF.GAMMA && result.horizon === SF.HORIZON && result.staleMatch === false && result.match && result.newEnvInteractions === 0) state.sawStale = true;
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'data-key': o.key, 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { text: (o.correct ? 'Sound chain. ' : 'Not this one. ') + o.why }) : null,
    ]))));
  }

  const PREDICT = {
    id: 'successor-p',
    prompt: 'The take policy will store its successor features, and you could instead store only its value under step weight -2 and door weight 2. The door weight then becomes 8 and the step weight becomes -1. What can that one stored value tell you?',
    options: [
      { key: 'tradeoff', result: 'Those weights are not a rescaling of -2 and 2, so a ratio times the old value is not the new return.', correct: true, why: 'Door goes from 2 to 8, a factor of 4. Step goes from -2 to -1, a factor of 1/2. One stored number cannot apply two factors.' },
      { key: 'scale', result: 'Multiply the old value by 8/2. That product is the new return.', correct: false, why: '8/2 uses only the door weights. The step weight did not use that factor.' },
      { key: 'optimal', result: 'The take policy becomes optimal for the new weights, because it collected the features.', correct: false, why: 'The vector is the take policy. A new weight does not change which action that policy takes.' },
    ],
  };

  function diagnoseQuestion(scalar) {
    return {
      id: 'successor-d',
      prompt: 'The door-weight rescaling gives ' + num(scalar.doorScale.q) + '. The step-weight rescaling gives ' + num(scalar.stepScale.q) + '. The dot product and the separate discounted return both give ' + num(scalar.q) + '. New environment steps: ' + scalar.newEnvInteractions + '. New table reads: ' + scalar.newModelReads + '. Why is the rescaling wrong?',
      options: [
        { key: 'trade', result: 'The two features traded off. The stored vector still has the step count and the door count, so the dot product can use both. No new environment step was required.', correct: true, why: 'Original table reads stay ' + scalar.originalModelReads + '. The new return is positive and both rescalings stay negative. The separate sum of discounted rewards matches the dot product.' },
        { key: 'samples', result: 'The dot product is wrong until the policy walks the path again.', correct: false, why: 'New environment steps are ' + scalar.newEnvInteractions + '. The features were already on the stored transitions.' },
        { key: 'reread', result: 'The weight change read the transition table again.', correct: false, why: 'New table reads are ' + scalar.newModelReads + '. Reading the table was the cost of building the vector, and that count stays ' + scalar.originalModelReads + '.' },
      ],
    };
  }

  function explainQuestion() {
    const toll = SF.comparePolicies({ weights: SF.WEIGHTS.toll, dynamics: 'open', gamma: SF.GAMMA, horizon: SF.HORIZON });
    return {
      id: 'successor-x',
      prompt: 'Changing the weights changed the take policy\'s value. Is that policy now optimal?',
      options: [
        { key: 'fixed', result: 'No. The vector belongs to the take policy and to the dynamics that built it. Under the toll weights, skip scores ' + num(toll.runs.skip.q) + ' and take scores ' + num(toll.runs.take.q) + '. This page does not run generalized policy improvement.', correct: true, why: 'The slide Using successor features, Idea 1, says this recovery is equivalent to one step of policy iteration: better than nothing, but not optimal. Idea 2, the Barreto et al. policy that picks the best stored action in each state, is not computed here. C-learning is a different heading and is not this page.' },
        { key: 'optimal', result: 'Yes. The dot product is the optimal value of the new reward.', correct: false, why: 'The dot product is the take policy\'s value. Skip\'s return under the toll is ' + num(toll.runs.skip.q) + ', which is higher than take\'s ' + num(toll.runs.take.q) + '.' },
        { key: 'gpi', result: 'Yes. Idea 2 already chose the best action in each state.', correct: false, why: 'comparePolicies reports gpi ' + toll.gpi + '. Ranking three stored policies is not the policy in equation (7) of Barreto et al.' },
      ],
    };
  }

  function stepText(step, weights) {
    const r = step.phi[0] * weights.step + step.phi[1] * weights.door;
    return name(step.s) + ', ' + step.a + ', ' + name(step.sp) + '. Features step ' + num(step.phi[0]) + ', door ' + num(step.phi[1]) + '. Discount ' + num(step.discount) + '. Reward ' + num(r) + '. Discounted reward ' + num(step.discount * r) + '. ' + (step.terminal ? 'Terminal. The sum stops.' : 'Not terminal.');
  }

  function counterText(result) {
    const env = result.newEnvInteractions === undefined ? result.envInteractions : result.newEnvInteractions;
    const reads = result.newModelReads === undefined ? result.modelReads : result.newModelReads;
    return 'Environment steps: ' + env + '. New table reads: ' + reads + '. Original vector table reads: ' + result.originalModelReads + '. Original environment steps: ' + (result.originalEnvInteractions || 0) + '.';
  }

  function cellsOf(steps) {
    const cells = ['S'];
    (steps || []).forEach((step) => cells.push(step.sp));
    return cells;
  }

  SF.cancel = () => {};
  SF.state = () => ({
    world: 'successor', sentenceName: 'Successor features of a fixed policy', mode: 'campaign', level: lesson.title,
    knobs: { gamma: state.gamma, horizon: state.horizon, dynamics: state.dynamics, policy: state.policy },
    words: {}, idleWords: {}, discovered: [],
    lastRun: state.stored ? { seeds: 1, steps: state.stored.modelReads, symptoms: [], summary: 'psi ' + vec(state.stored.psi) + ', value ' + num(state.stored.q) } : null,
  });
  SF.run = () => {
    state.stored = SF.build(baseSpec());
    state.policy = 'take';
    state.dynamics = 'open';
    state.gamma = SF.GAMMA;
    state.horizon = SF.HORIZON;
    state.weights = { step: SF.WEIGHTS.base.step, door: SF.WEIGHTS.base.door };
    if (redraw) redraw();
    return state.stored;
  };

  SF.mount = (pane, lab, api) => {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('successor-p');
    const d0 = saved('successor-d');
    const x0 = saved('successor-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step0 = api.step ? api.step() : 0;
    if (step0 >= 2 && !state.stored) state.stored = SF.build(baseSpec());
    if (step0 >= 3 && state.stored && !state.scalar) state.scalar = SF.transfer(state.stored, SF.WEIGHTS.tradeoff);
    if ((step0 >= 4 || (api.done && api.done())) && state.stored) {
      state.sawTradeoff = true;
      state.sawAgree = true;
      state.sawStale = true;
      state.sawGap = true;
      if (!state.live) state.live = SF.transfer(state.stored, SF.WEIGHTS.tradeoff);
    }
    const h = api.h;
    const body = h('div.card.stack', { id: 'successor-lesson' });
    pane.append(body);
    function advance(n) { if (api.markStep) api.markStep(n); }

    function specNow() {
      return {
        policy: state.policy,
        dynamics: state.dynamics,
        gamma: state.gamma,
        horizon: state.horizon,
        weights: { step: state.weights.step, door: state.weights.door },
        state: 'S',
      };
    }

    function recompute() {
      if (!state.stored) return;
      state.live = SF.apply(state.stored, specNow());
      note(state.live);
      if (ready()) advance(4);
      redraw();
    }

    function compare() {
      state.ranked = SF.comparePolicies(specNow());
      if (state.dynamics === 'open' && state.gamma === SF.GAMMA && state.horizon === SF.HORIZON && state.ranked.runs.skip.q > state.ranked.runs.take.q && state.stored && state.stored.policy === 'take') state.sawGap = true;
      if (ready()) advance(4);
      redraw();
    }

    function setWeights(w) {
      state.weights = { step: w.step, door: w.door };
      redraw();
    }

    function press(id, on, label, fn) {
      return h('button.btn' + (on ? '' : '.ghost'), {
        type: 'button', id: id, 'aria-pressed': on ? 'true' : 'false', onclick: fn,
      }, label);
    }

    redraw = () => {
      const n = C.levels.findIndex((l) => l.id === 'successor') + 1;
      const stored = state.stored;
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Door path' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('p.small', { text: 'Lecture 24. The slide Successor features says: "If the number of features is much less than the number of states, learning them is much easier!" This page does not learn them. It sums the known table. The slide Successor representations names Dayan, Improving Generalisation for Temporal Difference Learning: The Successor Representation, 1993. These features are step and door, not a one-hot over states, so this is not that representation.' }),
        h('p.small', { text: 'Barreto, Dabney, Munos, Hunt, Schaul, van Hasselt, and Silver, Successor Features for Transfer in Reinforcement Learning, arXiv:1606.05312. Equation (2) writes the one-step reward as the features dotted with the weights. Equation (3) writes the action value as the successor features dotted with the same weights. The paper\'s transfer setting keeps the dynamics fixed. This expectation is planning on a known table, not their learned update.' }),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if (state.pred != null) {
        kids.push(
          h('h3', { text: '2. Run' }),
          h('p', { text: 'Read the open door table under the take policy. Gamma is 1/2. The horizon is 8. The goal ends the sum. Environment steps stay 0, because the transitions are given.' }),
          h('button.btn', { id: 'successor-run', type: 'button', onclick: () => { SF.run(); advance(2); redraw(); } }, 'Read the known table'),
        );
      }
      if (stored) {
        const path = cellsOf(stored.steps);
        kids.push(
          h('div.rooms', { id: 'successor-map', role: 'img', 'aria-label': 'Take policy from Start to Goal' }, ['S', 'D', 'B', 'G'].map((id) => h('div.cell' + (path.indexOf(id) >= 0 ? '.on' : ''), { id: 'successor-cell-' + id }, name(id)))),
          h('p.nums', { id: 'successor-psi', text: 'psi conditioned on state ' + name(stored.conditionedOn.state) + ', action ' + stored.conditionedOn.action + ', policy ' + stored.conditionedOn.policy + ': ' + vec(stored.psi) + '. Value ' + num(stored.q) + '. Separate return ' + num(stored.direct) + '. Match: ' + (stored.match ? 'yes' : 'no') + '.' }),
          h('p.small', { id: 'successor-cost', text: 'Building the vector read ' + stored.modelReads + ' transitions. Environment steps: ' + stored.envInteractions + '. Method: ' + stored.method + '. Learned: ' + (stored.learned ? 'yes' : 'no') + '.' }),
          h('div.stack', { id: 'successor-steps' }, stored.steps.map((step) => h('div.tuple', { text: stepText(step, stored.weights) }))),
        );
        kids.push(
          h('h3', { text: '3. Diagnose' }),
          h('p', { text: 'Keep that vector. Raise the door weight from 2 to 8 and lower the step weight from -2 to -1. Compare a rescaling of the old value with the dot product.' }),
          h('button.btn', { id: 'successor-scalar', type: 'button', onclick: () => { state.scalar = SF.transfer(stored, SF.WEIGHTS.tradeoff); advance(3); redraw(); } }, 'Rescale the stored value'),
        );
      }
      if (state.scalar) {
        const scalar = state.scalar;
        kids.push(
          h('p.nums', { id: 'successor-scalar-readout', text: 'Old value ' + num(stored.q) + '. Door rescaling ' + num(scalar.doorScale.q) + '. Step rescaling ' + num(scalar.stepScale.q) + '. Dot product ' + num(scalar.q) + '. Separate return ' + num(scalar.direct) + '. ' + counterText(scalar) }),
          choice(h, diagnoseQuestion(scalar), state.diag, (i) => {
            const q = diagnoseQuestion(scalar);
            state.diag = i;
            if (api.recordAnswer) api.recordAnswer(q.id, i, !!q.options[i].correct);
            advance(3);
            redraw();
          }),
        );
      }
      if (state.diag != null && stored) {
        const left = [];
        if (!state.sawTradeoff) left.push('a tradeoff on the original vector, where both rescalings stay negative and the dot product becomes positive');
        if (!state.sawAgree) left.push('a pure scale of the old weights, where both rescalings match the dot product');
        if (!state.sawStale) left.push('the locked door, where the old vector\'s dot product misses the new return');
        if (!state.sawGap) left.push('a comparison under the toll, where skip beats take');
        kids.push(
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Set the weights, the policy, or the dynamics, then recompute. A weight change on the same policy and the same open door reuses the vector. Anything else rebuilds it and shows the stale dot product beside the fresh return.' }),
          h('div.weights', { id: 'successor-weights' }, [
            h('label', null, ['Step weight', h('input', { id: 'successor-step', type: 'number', step: '1', value: String(state.weights.step), 'aria-label': 'Step weight', oninput: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) state.weights.step = v; } })]),
            h('label', null, ['Door weight', h('input', { id: 'successor-door', type: 'number', step: '1', value: String(state.weights.door), 'aria-label': 'Door weight', oninput: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) state.weights.door = v; } })]),
          ]),
          h('div.controls', { id: 'successor-presets' }, [
            press('successor-base', state.weights.step === SF.WEIGHTS.base.step && state.weights.door === SF.WEIGHTS.base.door && state.policy === 'take' && state.dynamics === 'open', 'Base weights', () => { state.policy = 'take'; state.dynamics = 'open'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; setWeights(SF.WEIGHTS.base); }),
            press('successor-tradeoff', state.weights.step === SF.WEIGHTS.tradeoff.step && state.weights.door === SF.WEIGHTS.tradeoff.door, 'Tradeoff weights', () => { state.policy = 'take'; state.dynamics = 'open'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; setWeights(SF.WEIGHTS.tradeoff); }),
            press('successor-scale', state.weights.step === SF.WEIGHTS.proportional.step && state.weights.door === SF.WEIGHTS.proportional.door, 'Pure scale', () => { state.policy = 'take'; state.dynamics = 'open'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; setWeights(SF.WEIGHTS.proportional); }),
            press('successor-toll', state.weights.step === SF.WEIGHTS.toll.step && state.weights.door === SF.WEIGHTS.toll.door, 'Toll weights', () => { state.policy = 'take'; state.dynamics = 'open'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; setWeights(SF.WEIGHTS.toll); }),
            press('successor-locked', state.dynamics === 'locked', 'Lock the door', () => { state.policy = 'take'; state.dynamics = 'locked'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; redraw(); }),
            press('successor-skip', state.policy === 'skip' && state.dynamics === 'open', 'Skip policy', () => { state.policy = 'skip'; state.dynamics = 'open'; state.gamma = SF.GAMMA; state.horizon = SF.HORIZON; redraw(); }),
            press('successor-gamma0', state.gamma === 0, 'Gamma 0', () => { state.gamma = 0; redraw(); }),
            press('successor-horizon1', state.horizon === 1, 'Horizon 1', () => { state.horizon = 1; redraw(); }),
          ]),
          h('p.small', { id: 'successor-controls-now', text: 'Now: policy ' + state.policy + ', dynamics ' + state.dynamics + ', gamma ' + num(state.gamma) + ', horizon ' + state.horizon + ', step weight ' + num(state.weights.step) + ', door weight ' + num(state.weights.door) + '.' }),
          h('div.controls', null, [
            h('button.btn', { id: 'successor-recompute', type: 'button', onclick: recompute }, 'Recompute'),
            h('button.btn', { id: 'successor-compare', type: 'button', onclick: compare }, 'Compare the three policies'),
          ]),
          h('p.small', { id: 'successor-left', text: left.length ? 'Still needed: ' + left.join('; ') + '.' : 'The four checks are in. The take policy\'s vector was not replaced by another policy.' }),
        );
        if (state.live) {
          const live = state.live;
          const livePath = cellsOf(live.steps);
          kids.push(
            h('div.rooms', { id: 'successor-live-map', role: 'img', 'aria-label': 'Path for the latest recompute' }, ['S', 'D', 'B', 'A', 'M', 'G'].map((id) => h('div.cell' + (livePath.indexOf(id) >= 0 ? '.on' : ''), { id: 'successor-live-' + id }, name(id)))),
            h('p.nums', { id: 'successor-live', text: (live.mode === 'weights' ? 'Weight change. Stored psi ' : 'Rebuilt psi ') + vec(live.psi) + '. Dot product ' + num(live.q) + '. Separate return ' + num(live.direct) + '. Match: ' + (live.match ? 'yes' : 'no') + '.' }),
            h('p.small', { id: 'successor-live-counts', text: counterText(live) + (live.mode === 'weights' ? ' Door rescaling ' + num(live.doorScale.q) + '. Step rescaling ' + num(live.stepScale.q) + '.' : ' Stale dot product ' + num(live.staleQ) + '. Stale match: ' + (live.staleMatch ? 'yes' : 'no') + '.') }),
            h('div.stack', { id: 'successor-live-steps' }, live.steps.map((step) => h('div.tuple', { text: stepText(step, live.weights) }))),
          );
        }
        if (state.ranked) {
          const ranked = state.ranked;
          kids.push(h('p.nums', { id: 'successor-ranked', text: 'Take ' + num(ranked.runs.take.q) + '. Skip ' + num(ranked.runs.skip.q) + '. Alley ' + num(ranked.runs.alley.q) + '. Best stored policy: ' + ranked.best + '. Comparison table reads: ' + ranked.modelReads + '. Environment steps: ' + ranked.envInteractions + '. GPI: ' + (ranked.gpi ? 'yes' : 'no') + '. The original psi is still ' + vec(stored.psi) + '.' }));
        }
      }
      if (ready() && state.diag != null) {
        const explain = explainQuestion();
        const explainOk = state.explain != null && explain.options[state.explain].correct;
        kids.push(
          h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', { id: 'successor-complete', type: 'button', disabled: explainOk ? null : true, onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); } }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [
            h('summary', { text: 'What this run is, and what it is not' }),
            h('p.small', { text: 'psi is an expectation under the stated policy and the stated dynamics. The policy here is deterministic, so the expectation is one path. The reward is the transition features dotted with the weights. The first feature is not extra-discounted. Discount gamma is 1/2 unless you change it. Horizon 8 is long enough to reach the goal. Horizon 1 keeps only the first transition. Gamma 0 does the same. The goal is terminal, so later features are zero and the sum stops. Gamma 1 is finite for that reason.' }),
            h('p.small', { text: 'A weight change does not read the table again and does not take an environment step. Locking the door changes the dynamics, so the old psi is invalid. The slide Using successor features, Idea 1, asks "Is this the optimal Q-function?" and answers "Better than nothing, but not optimal". Idea 2 cites Barreto et al. 2016 and says it finds the highest reward policy in each state. Theorem 1 of the paper defines that policy as the action with the best stored value in each state, with a bound that uses the approximation error. This page does not build that policy, so the guarantee is not claimed. The slide The C-Learning algorithm is a different method and is not implemented.' }),
          ]),
        );
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'successor-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };

    lab.replaceChildren(h('section.card.game-rules', { id: 'successor-rules' }, [
      h('h3', { text: 'Game rules · Door path' }),
      h('dl', null, [
        row(h, 'Goal', 'Match a new reward\'s return with the stored successor features, then see a dynamics change invalidate that vector.'),
        row(h, 'Reward each step', 'Step weight times the step feature, plus door weight times the door feature. Step is 1 on every transition. Door is 1 only on Door, take, Bonus.'),
        row(h, 'Equation', 'psi is the discounted sum of those features under the fixed policy. The value is psi dotted with the weights. The separate return sums the same discounted rewards without using psi.'),
        row(h, 'Dynamics', 'Known table. Open: Start, door, Door. Locked: Start, door, Alley. This is an expectation, not a sample and not a learned update.'),
        row(h, 'Episode ends', 'At the goal, or at the horizon if that comes first. No feature is added after the goal.'),
        row(h, 'Score', 'The dot product equals the separate return when policy, dynamics, discount, and horizon are unchanged. A rescaled scalar does not, once the features trade off.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBSUCCESSOR);
