// Lecture 13 lesson: fit a reward on a 5 by 3 grid, then plan with the weights.
(function (C, RF) {
  'use strict';
  if (!C.phases.some((p) => p.n === 4.5)) {
    const at = C.phases.findIndex((p) => p.n === 5);
    C.phases.splice(at >= 0 ? at : C.phases.length, 0, { n: 4.5, title: 'Learn the reward from demonstrations' });
  }
  C.worldNames.rewardfit = 'Grid with a traversable hazard';
  const o = (key, steps, result, correct, why) => ({ key, steps, result, correct: !!correct, why });
  const level = {
    id: 'rewardfit', custom: true, phase: 4.5, world: 'rewardfit', title: 'Fit the reward', focus: [],
    intro: 'Guide Rover+ from Start to the flag. Two demonstrations avoid a traversable hazard. Compare Closeness only with Fit from demonstrations, then change which demonstrations the fit sees.',
    goal: { text: 'Fit weights from demonstrations that avoid the hole, plan with those weights, and treat the result as one explanation.' },
    predict: { id: 'rewardfit-p', prompt: 'The proxy weights are closeness 1, hole 0, lane 0, step 0. The planner does not see the demonstrations. Which route does it return?', options: [
      o('through', ['The proxy pays for being close to the goal.', 'The hole sits on the shortest close path, and its weight is 0.', 'A weight of 0 adds nothing. It is not a penalty.'], 'It walks through the hole.', 1,
        'The proxy route is plan([1, 0, 0, 0]). Demonstrations are not an argument of plan.'),
      o('copy', ['The demonstrations walk around the hole.', 'A planner copies the routes it can see.', 'So the proxy matches the demonstrations.'], 'It walks around the hole.', 0,
        'The proxy planner cannot copy the demonstrations. Its only input is the weight vector.'),
      o('stop', ['The hole has no reward term.', 'A missing term is a penalty.', 'So the proxy stops in front of the hole.'], 'It stops before the hole.', 0,
        'A feature with weight 0 contributes 0. The hole cell is still closer to the goal than a detour.'),
    ] },
    diagnose: { id: 'rewardfit-d', prompt: 'The proxy route entered the hole. The demonstrations did not. What failed?', options: [
      o('reward', ['The proxy pays for closeness and pays nothing for the hole.', 'The straight path is closer than a walk around.', 'The planner maximized that reward.'], 'The hand-written reward made the hole a shortcut.', 1,
        'Same grid, same planner, different weights: the fitted route is the comparison.'),
      o('data', ['One demonstration must step on the hole.', 'The fit copied that step.', 'So the route enters the hole.'], 'The demonstrations include the hole.', 0,
        'Every demonstrated action in both sets lands off the hole. The dashed paths are those actions.'),
      o('solver', ['Soft value iteration prefers the center row.', 'The hole is in the center row.', 'So every weight vector enters it.'], 'The solver is biased toward the hole.', 0,
        'The fitted weights use the same solver and produce a different route. The weights changed the action values.'),
    ] },
    explain: { id: 'rewardfit-x', prompt: 'You fit the north demonstrations, then the south demonstrations. Which claim matches this computation?', options: [
      o('one', ['The free fit is a maximum of the demonstration likelihood inside this feature family and these bounds.', 'South demonstrations change the lane weight and the side of the route.', 'The planner receives fitted weights, not demonstration actions.'], 'The weights are one explanation of these demonstrations.', 1,
        'A different dataset is still safe walking, and the fit moves. The finite posterior is only four candidates.'),
      o('true', ['The search recovered the reward the demonstrator truly had.', 'Safe walking has only one reward in this family.', 'South demonstrations must keep the same weights.'], 'The weights are the true human reward.', 0,
        'The south demonstrations also avoid the hole, and the fitted lane weight changes sign.'),
      o('replay', ['The planner stores demonstration cells.', 'The weights are only a label.', 'Both datasets replay the north route.'], 'The route is a replay of the demonstrations.', 0,
        'plan(weights) reads the weights. The proxy weights and the fitted weights are different routes.'),
    ] },
    soWhat: 'A reward fit from a few demonstrated trajectories is one explanation of those trajectories. Another dataset, or another feature story with lower likelihood, can justify a different reward. Check the planned route on the real task before you trust the weights.',
    cannotTeach: 'Continuous actions or a neural reward. This grid has 15 cells, four features, and an exact soft backup.',
  };
  if (!C.levels.some((l) => l.id === 'rewardfit')) {
    const after = C.levels.reduce((at, l, i) => (l.phase === 4 ? i : at), -1);
    if (after >= 0) C.levels.splice(after + 1, 0, level);
    else C.levels.push(level);
  }
  C.cards.maxentirl = {
    name: 'Reward fitting on a small grid', short: 'Fit a reward',
    fixes: 'The proxy pays only for closeness and plans through the hole. Weights that maximize the soft-optimal likelihood of demonstrations, followed by a planner that sees only those weights, can walk around it.',
    stillWrong: 'The fit is one maximum inside a four-feature family on a 5 by 3 grid. It is not a unique human reward. A different set of demonstrations can favor different weights.',
    paper: 'CS 285 Spring 2026 lecture 13, heading Q-learning with soft optimality. The fit sums log pi(a|s) on the demonstrated actions. pi is the discounted soft Bellman policy on this grid. Levine (2018) reviews that backup. Ziebart, Maas, Bagnell, and Dey (2008) normalize a reward over whole trajectories. This page does not compute that partition.',
    evidence: '<p>Spring 2026 lecture 13 PDF, section Inverse reinforcement learning, extracted 2026-10-22: "many reward functions can explain the same behavior." The same deck has a separate heading, The IRL partition function, and later titles Inverse RL as a GAN. This lesson does not sum over trajectories and does not train a discriminator. The soft-backup citation on the slides is Levine (2018), Reinforcement Learning and Control as Probabilistic Inference.</p>',
  };
  C.paperLinks.maxentirl = [
    { t: 'Lecture 13 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-13.pdf' },
    { t: 'Levine 2018', u: 'https://arxiv.org/abs/1805.00909' },
    { t: 'Ziebart et al. 2008, trajectory partition', u: 'https://www.aaai.org/Papers/AAAI/2008/AAAI08-227.pdf' },
  ];

  const state = { settings: { demonstrations: 'north', constraint: 'free' }, record: null, stale: false,
    time: 0, policy: 'closeness', term: null, watching: false, timer: null, busy: false, token: 0, picked: {}, seen: new Set(), step: 0 };
  let hooks = {}, ui = null, adapter = null, redraw = () => {};
  const number = n => n.toFixed(2);
  const stop = () => { clearInterval(state.timer); state.timer = null; state.watching = false; };
  RF.cancel = () => { stop(); state.token++; state.busy = false; state.record = null; state.stale = false; state.time = 0; state.seen.clear(); ui = null; adapter = null; };
  RF.record = () => state.record;
  RF.replay = () => ({ time: state.time, watching: state.watching, stale: state.stale, world: ui ? 'rewardfit' : null, length: state.record && adapter ? adapter.length(state.record) : 0 });
  RF.state = () => ({ world: 'rewardfit', level: level.title, mode: 'campaign', sentenceName: 'Fit a reward, then plan', knobs: { ...state.settings },
    lastRun: state.record ? { summary: state.record.metrics, data: state.record.data } : null });
  function advance(step) { state.step = Math.max(state.step, step); hooks.setProgress?.(state.step); }
  RF.run = async () => {
    if (state.busy || !ui || state.picked[level.predict.id] == null) return null;
    stop(); state.busy = true; const token = ++state.token; redraw();
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      const record = await RF.createRecord(state.settings);
      if (token !== state.token) return null;
      state.record = record; state.stale = false; state.time = 0; state.seen.add(record.settings.demonstrations); advance(2);
      return record;
    } finally { if (token === state.token) { state.busy = false; redraw(); } }
  };
  const terms = [
    ['Closeness', 'Minus the number of grid moves to the flag. The Closeness only planner uses weight 1.'],
    ['Hazard', '1 on the hazard, 0 elsewhere. Weight 0 ignores this feature. A negative weight penalizes entry, but other terms can still favor that route.'],
    ['Lane', '+1 on the north row, −1 on the south row, 0 in the middle.'],
    ['Step', '1 away from the flag, 0 at the flag. A negative weight charges for each move that does not reach the flag.'],
  ];
  function sketch() {
    return hooks.shell?.conceptSketch({ label: 'Demonstrations fit weights; the planner receives only weights.',
      nodes: [{ id: 'demos', label: 'Demos', x: 55, y: 60 }, { id: 'weights', label: 'Weights', x: 160, y: 60 }, { id: 'planner', label: 'Planner', x: 265, y: 60 }],
      edges: [{ from: 'demos', to: 'weights' }, { from: 'weights', to: 'planner' }] });
  }
  function quiz(h, q) {
    const chosen = state.picked[q.id];
    const feedback = !!state.record && !state.stale && chosen != null;
    return h('section.mc', { id: q.id }, [h('p', { text: q.prompt.replaceAll('hole', 'hazard').replaceAll('proxy', 'Closeness only') }),
      ...q.options.map((option, i) => h('button.opt' + (chosen === i ? '.picked' : '') + (feedback ? (option.correct ? '.right' : '.wrong') : ''), {
        type: 'button', 'data-choice': option.key, 'aria-pressed': String(chosen === i),
        onclick: () => { state.picked[q.id] = i; hooks.recordAnswer?.(q.id, i, option.correct); advance(q.id === 'rewardfit-p' ? 1 : 3); redraw(); },
      }, [h('span.res', { text: option.result.replaceAll('hole', 'hazard').replaceAll('proxy', 'Closeness only') }),
        feedback ? h('span.why', { text: option.why.replaceAll('hole', 'hazard').replaceAll('proxy', 'Closeness only') }) : null]),
      ), !state.record ? h('p.small', { text: 'Choose a prediction, then Run to test it. Feedback stays hidden until Run.' }) : null,
    ]);
  }
  function table(h, headings, rows) {
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': 'Measured planner results' }, h('table', null, [
      h('thead', null, h('tr', null, headings.map(text => h('th', { scope: 'col', text })))),
      h('tbody', null, rows.map(row => h('tr', null, row.map(text => h('td', { text }))))),
    ]));
  }
  function paint() {
    if (!ui || !ui.scene.isConnected) { stop(); return; }
    const record = state.record;
    if (record && !state.stale) adapter.draw(record, state.time);
    ui.position.textContent = record && !state.stale ? 'Move ' + state.time + ' of ' + (adapter.length(record) - 1) + '. ' + record.policies.find(p => p.name === state.policy).label +
      (state.time >= record.series[state.policy].length - 1 ? ': ' + record.terminal[state.policy] + '.' : '.') : 'Rover+ at Start. Dashed paths 1 and 2 are demonstrations.';
    ui.watch.textContent = state.watching ? 'Pause' : 'Watch';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ui.watch.disabled = !record || state.stale || reduced;
    document.getElementById('rewardfit-motion').textContent = reduced ? 'Reduced motion: use Step and Replay to inspect measured cells.' : 'Watch replays measured cells. Both planners use the same move counter.';
    ui.step.disabled = !record || state.stale || state.time >= adapter.length(record) - 1;
    ui.replay.disabled = !record || state.stale;
    if (ui.chart) ui.chart.querySelectorAll('[data-time]').forEach(e => e.setAttribute('aria-current', String(+e.dataset.time === state.time)));
  }
  RF.mount = (pane, lab, api) => {
    hooks = api || {}; const h = hooks.h;
    stop();
    state.step = hooks.progress?.() || 0;
    state.picked = {};
    for (const q of [level.predict, level.diagnose, level.explain]) { const saved = hooks.answerFor?.(q.id); if (saved) state.picked[q.id] = saved.choice; }
    const body = h('div.stack.rewardfit.teaching-card', { id: 'rewardfit-lesson' }); pane.append(body);
    redraw = () => {
      if (!body.isConnected) return;
      const record = state.record, current = record && !state.stale;
      const scene = h('canvas.rewardfit-scene', { id: 'rewardfit-scene', width: 720, height: 500, role: 'img' });
      const position = h('p.small', { id: 'rewardfit-position', role: 'status' });
      const watch = h('button.btn.ghost', { id: 'rewardfit-watch', type: 'button', onclick: () => {
        if (state.watching) stop();
        else if (current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          if (state.time >= adapter.length(state.record) - 1) state.time = 0;
          state.watching = true; state.timer = setInterval(() => { state.time++; if (state.time >= adapter.length(state.record) - 1) stop(); paint(); }, 500);
        }
        paint();
      } }, 'Watch');
      const step = h('button.btn.ghost', { id: 'rewardfit-step', type: 'button', onclick: () => { stop(); state.time = Math.min(state.time + 1, adapter.length(state.record) - 1); paint(); } }, 'Step');
      const replay = h('button.btn.ghost', { id: 'rewardfit-replay', type: 'button', onclick: () => { stop(); state.time = 0; paint(); } }, 'Replay');
      const select = (id, label, value, options, change) => h('label.rewardfit-select', { for: id }, [label, h('select', { id, onchange: e => change(e.target.value) }, options.map(([v, text]) => h('option', { value: v, selected: v === value, text })))]);
      const change = key => value => { stop(); state.token++; state.busy = false; state.settings[key] = value; state.stale = !!record; state.time = 0; redraw(); };
      const setup = h('section.card', { id: 'rewardfit-lab', 'aria-label': 'Reward fitting experiment' }, [
        h('h2', { text: level.title }),
        h('p', null, [h('strong', { text: 'Task: ' }), 'guide Rover+ from Start to the flag. The hazard is traversable; entering it does not end the episode.']),
        h('p', null, [h('strong', { text: 'Demonstrations: ' }), 'two numbered dashed routes avoid the hazard. A solid line will show the selected planner after Run.']),
        scene, position,
        select('rewardfit-policy', 'Planner to watch', state.policy, [['closeness', 'Closeness only'], ['fitted', 'Fit from demonstrations']], value => { state.policy = value; redraw(); }),
        h('div.row', null, [watch, step, replay]),
        h('p.small', { id: 'rewardfit-motion', text: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Reduced motion: use Step and Replay to inspect measured cells.' : 'Watch replays measured cells. Both planners use the same move counter.' }),
        h('p', null, [h('strong', { text: 'Your comparison: ' }), 'Closeness only uses fixed weights [1, 0, 0, 0]. Fit from demonstrations searches for weights that make the demonstrated actions more likely. Both planners receive weights, not demonstration actions.']),
        h('div.row', null, [select('rewardfit-demos', 'Demonstrations', state.settings.demonstrations, [['north', 'North detours'], ['south', 'South detours']], change('demonstrations')),
          select('rewardfit-constraint', 'Adjustable choice', state.settings.constraint, [['free', 'Fit all four terms'], ['hazard-zero', 'Fix hazard weight at zero']], change('constraint'))]),
        h('div.rewardfit-terms', null, terms.map(([label, text], i) => h('button.btn.ghost', { type: 'button', 'aria-pressed': String(state.term === i), onclick: () => { state.term = state.term === i ? null : i; redraw(); } }, label))),
        h('p.small', { id: 'rewardfit-term', text: state.term === null ? 'Tap a reward term to see its feature values on the grid. Weight 0 ignores that term; it is not a penalty.' : terms[state.term][1] }),
        h('p.small', { text: 'A move earns the sum of feature values at the entered cell times their weights. A negative hazard weight does not guarantee a detour: all terms and later moves matter.' }),
        h('p.small', { id: 'rewardfit-stale', role: 'status', hidden: !state.stale, text: 'Settings changed. Previous results are stale. Run again to measure these settings; the scene shows the new demonstrations.' }),
      ]);
      const lesson = h('section.card', { id: 'rewardfit-step-card' }, [
        h('h3', { text: current ? 'Compare, then change the demonstrations' : 'Predict before Run' }),
        !current ? quiz(h, level.predict) : state.seen.size === 2 ? quiz(h, level.explain) : state.step === 2 ? quiz(h, level.diagnose) : null,
        h('button.btn' + (current ? '.ghost' : ''), { id: 'rewardfit-run', type: 'button', disabled: state.busy || state.picked[level.predict.id] == null, onclick: () => RF.run().catch(error => { ui.position.textContent = error.message; }) }, state.busy ? 'Fitting…' : state.stale ? 'Run again' : 'Run'),
        current ? h('p', { text: 'Now change North detours to South detours (or back), Run again, and watch Fit from demonstrations. Compare the lane weight and route. You can also fix the hazard weight at zero and fit the other terms.' }) : null,
        current && state.seen.size === 2 ? h('button.btn', { id: 'rewardfit-finish', type: 'button', disabled: !level.explain.options[state.picked[level.explain.id]]?.correct,
          onclick: () => { hooks.reveal?.('maxentirl'); hooks.complete?.(); advance(5); redraw(); } }, hooks.done?.() ? 'Lesson complete' : 'Finish lesson') : null,
        current && hooks.done?.() ? h('button.btn.ghost', { type: 'button', onclick: () => { const next = C.levels[C.levels.findIndex(l => l.id === level.id) + 1]; if (next) hooks.openLevel?.(next.id); } }, 'Next level') : null,
        sketch(),
        h('p.small', null, [h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/', target: '_blank', rel: 'noopener', text: 'Idea adapted from Berkeley CS 285' })]),
      ]);
      const chart = h('section', { id: 'rewardfit-chart', 'aria-label': 'Measured reward at each planned move' });
      const result = h('section', { id: 'rewardfit-results' });
      if (record) {
        chart.append(h('h3', { text: 'Reward at each planned move' }), h('p.small', { text: 'These are model-planned moves, not new environment data. Tap a move to inspect the matching recorded cell. Rewards use different weights, so compare routes as well as totals.' }));
        for (const policy of record.policies) chart.append(h('h4', { text: policy.label }), h('div.rewardfit-rewards', null, record.series[policy.name].map(p => h('button.btn.ghost', {
          type: 'button', 'data-time': p.t, disabled: state.stale, onclick: () => { stop(); state.time = p.t; state.policy = policy.name; redraw(); },
        }, 'Move ' + p.t + ': ' + number(p.reward)))));
        result.append(h('h3', { text: 'Measured planner results' }), table(h, ['Planner', 'Moves', 'Hazard entered', 'Stop reason', 'Demo log likelihood'], record.policies.map(p => {
          const m = record.metrics[p.name]; return [p.label, String(m.moves), m.entersHazard ? 'Yes' : 'No', record.terminal[p.name], number(m.logLikelihood)];
        })), ...record.policies.map(p => h('p.small', { text: p.label + ' weights: ' + ['closeness', 'hazard', 'lane', 'step'].map((f, i) => f + ' ' + number(record.metrics[p.name].weights[i])).join(', ') + '.' })),
        h('p.small', { text: 'Prior data: ' + record.data.prior.steps + ' demonstrated moves in ' + record.data.prior.attempts + ' routes. Fresh environment data: ' + record.data.fresh.steps + ' moves, ' + record.data.fresh.attempts + ' attempts. Fitting and planning use the known grid model.' }), h('p', { text: level.soWhat }));
      }
      if (!record) {
        chart.append(h('p.small', { text: 'Run the lesson to inspect its curve.' }));
        result.append(h('p.small', { text: 'Run the lesson to inspect its autopsy.' }));
      }
      const evidence = h('details', { id: 'rewardfit-evidence' }, [h('summary', { text: 'Rules and evidence' }), h('section.game-rules', { id: 'rewardfit-rules' }, [h('h3', { text: 'Pass this challenge' }), h('p', { text: level.goal.text })]), h('p', { text: 'The planner stops at the flag, a repeated cell, or its move limit. The hazard is not terminal. The discount is 0.9. Fitting searches weights between −4 and 4, scoring the sum of log probabilities of the 12 demonstrated actions.' }),
        h('p', { text: C.cards.maxentirl.paper }), h('a', { href: C.paperLinks.maxentirl[0].u, target: '_blank', rel: 'noopener', text: 'Berkeley source slides' })]);
      body.replaceChildren(lesson); lab.replaceChildren(setup);
      if (hooks.shell) {
        hooks.shell.notebook('rule').replaceChildren(evidence);
        hooks.shell.notebook('curve').replaceChildren(chart);
        hooks.shell.notebook('autopsy').replaceChildren(result);
        hooks.shell.notebook('notes').replaceChildren(...(current ? [quiz(h, level.predict), h('p', { text: level.soWhat })] : [h('p.small', { text: 'Lesson notes appear here.' })]));
      } else {
        // Temporary host on the slice5 base; slice6 supplies the Notebook containers.
        lab.append(chart, result, evidence);
      }
      ui = { scene, position, watch, step, replay, chart };
      adapter = RF.createSceneAdapter({ settings: { ...state.settings }, policy: state.policy, term: state.term }); adapter.mount(scene); paint();
      for (const surface of [scene, chart, result, evidence]) { if (record) surface.dataset.run = record.id; surface.dataset.stale = String(state.stale); }
    };
    redraw();
  };
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { stop(); paint(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!ui || !adapter) return;
      adapter.mount(ui.scene); paint();
      if (state.record) ui.scene.dataset.run = state.record.id;
    });
  }
})(window.CONTENT, window.BBREWARDFIT);
