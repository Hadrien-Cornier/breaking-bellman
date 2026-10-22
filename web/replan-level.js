// Open-loop search versus replanning on a known noisy corridor.
(function (C, R) {
  'use strict';
  if (!C || !R) throw new Error('replan lesson requires CONTENT and BBREPLAN');
  C.worldNames.replan = 'Noisy corridor';
  const lessonGoal = 'See an open-loop plan hit the wall on one fixed disturbance schedule, and a replan from the observed cell recover, using the same model and the same search on every plan.';
  C.levels.push({
    id: 'replan', custom: true, phase: 8, world: 'replan', title: 'Plan once, or replan',
    intro: 'The mean model of this corridor is given. It is not fitted. Score action sequences on that model, then compare driving the whole sequence with replanning from the cell you actually reach.',
    goal: { text: lessonGoal },
  });
  const QUESTIONS = {
    predict: {
      id: 'replan-p',
      prompt: 'The planner scores every 4-action sequence on the mean model and then drives the winner without looking again. The disturbance schedule is +1, +1, 0, 0 for both controllers. What should you expect?',
      options: [
        { text: 'The model is known, so the open-loop car stays in the corridor.', correct: false, why: 'A known mean model still drops this disturbance. A perfect mean-model score is not the true corridor.' },
        { text: 'The plan can score well on the mean model and still hit the wall, because the schedule is not the mean and the car never looks again.', correct: true, why: 'The search is about the mean model. Open-loop commits to that sequence, so a shove stays in the state.' },
        { text: 'Open-loop is given a larger shove than replan, so only the open-loop car hits the wall.', correct: false, why: 'Both controllers use one schedule, fixed before the comparison. The noise is not chosen separately.' },
      ],
    },
    diagnose: {
      id: 'replan-d',
      prompt: 'The open-loop car reached the wall. What happened?',
      options: [
        { text: 'The search maximized the mean-model score from the start, then drove that sequence without reading the true cell.', correct: true, why: 'The winner was chosen for the start cell. Later actions were not chosen again after the shove.' },
        { text: 'Replan was handed a different disturbance on the same steps.', correct: false, why: 'The schedule is one list. Replan has not even been run yet. The difference is that open-loop does not observe.' },
        { text: 'The sequence was copied from a dataset of crashes.', correct: false, why: 'There is no dataset and no learning update. The one-step mean model was given.' },
      ],
    },
    explain: {
      id: 'replan-x',
      prompt: 'What does replanning change here, and what does it leave open?',
      options: [
        { text: 'Replanning fitted the disturbance, so the model is now correct.', correct: false, why: 'Nothing was fitted. Every plan still uses the same mean model, which treats future disturbances as zero.' },
        { text: 'A longer open-loop horizon would remove the error, because the plan would see further.', correct: false, why: 'A longer horizon commits to more steps of a model that is wrong on this sample. The gap between predicted return and true return is that error.' },
        { text: 'The next plan starts at the observed cell, so a shove that already happened is no longer hidden. Future disturbances are still treated as zero. This one schedule is not every stochastic task.', correct: true, why: 'Replanning folds the past disturbance into the state. It does not make the mean model true for the future, and a shove of +2 still crashes both cars.' },
      ],
    },
  };
  const state = { step: 0, picks: {}, open: null, closed: null, limits: null, finished: false };
  let hooks = {}, redraw = null;

  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function measureRepair() {
    const lesson = R.compare(R.SCHEDULES.lesson);
    state.open = lesson.open;
    state.closed = lesson.closed;
    state.limits = {
      lesson,
      zero: R.compare(R.SCHEDULES.zero),
      uncorrectable: R.compare(R.SCHEDULES.uncorrectable),
    };
  }
  R.cancel = () => {};
  R.run = async () => {
    state.open = R.rollout('open', R.SCHEDULES.lesson);
    advance(2);
    if (redraw) redraw();
    return state.open;
  };
  R.state = () => ({
    world: 'replan', sentenceName: 'Known mean model, open-loop versus replan', mode: 'campaign',
    level: 'Plan once, or replan', knobs: { schedule: '1,1,0,0', horizon: R.HORIZON, candidates: 81 },
    words: {}, idleWords: {}, discovered: [],
    lastRun: state.open ? {
      seeds: 1, steps: R.HORIZON, symptoms: [],
      summary: { openTrueReturn: state.open.trueReturn, replanTrueReturn: state.closed ? state.closed.trueReturn : null },
    } : null,
    comparison: state.limits, version: 'replan-mean-model-1',
  });

  function fmt(n) { return String(n); }
  function pathText(path) {
    return path.map((y) => Math.abs(y) >= R.WALL ? 'wall' : String(y)).join(' ');
  }
  function questionBlock(h, q, onAnswer) {
    const picked = state.picks[q.id];
    return h('div.mc', { id: q.id }, [
      h('p', { text: q.prompt }),
      ...q.options.map((opt, index) => h('button.opt' + (picked === index ? '.picked' : '') + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
        type: 'button',
        onclick: () => {
          state.picks[q.id] = index;
          if (hooks.record) hooks.record(q.id, index, !!opt.correct);
          onAnswer(opt, index);
          redraw();
        },
      }, [
        h('span', { text: opt.text }),
        picked === index ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + opt.why }) : null,
      ])),
    ]);
  }
  function cells(h, path) {
    const shown = path.slice(0, R.HORIZON + 1);
    while (shown.length < R.HORIZON + 1) shown.push(null);
    return h('div.replan-track', null, shown.map((y) => {
      if (y == null) return h('span.replan-cell', { text: '' });
      const wall = Math.abs(y) >= R.WALL;
      const cls = wall ? 'wall' : y === 0 ? 'center' : 'edge';
      return h('span.replan-cell.' + cls, { text: wall ? 'wall' : String(y) });
    }));
  }
  function board(h, open, closed) {
    const rows = [
      h('div', null, [h('p.small', { text: 'Mean-model plan from the start: ' + pathText(open.predictedPath) }), cells(h, open.predictedPath)]),
      h('div', null, [h('p.small', { text: 'Open-loop on this schedule: ' + pathText(open.path) }), cells(h, open.path)]),
    ];
    if (closed) rows.push(h('div', null, [h('p.small', { text: 'Replan on the same schedule: ' + pathText(closed.path) }), cells(h, closed.path)]));
    return h('div', { id: 'replan-board' }, [
      h('h3', { text: 'Corridor cells' }),
      h('p.small', { text: 'Time runs left to right. Center is 0. Cells -1 and 1 are still in the corridor. Wall means -2 or +2, and the episode stops.' }),
      ...rows,
    ]);
  }
  function metrics(h, open, closed) {
    const same = open.budgetPerPlan.candidates === closed.budgetPerPlan.candidates && open.budgetPerPlan.horizon === closed.budgetPerPlan.horizon && open.model === closed.model;
    return h('div.vpo-table', {
      id: 'replan-metrics', tabindex: '0', role: 'region', 'aria-label': 'Planning budget and returns',
      'data-candidates': String(open.budgetPerPlan.candidates),
      'data-horizon': String(open.budgetPerPlan.horizon),
      'data-same-budget': same ? 'yes' : 'no',
      'data-open-return': fmt(open.trueReturn),
      'data-open-predicted': fmt(open.predictedReturn),
      'data-open-plans': String(open.plans),
      'data-open-steps': String(open.modelSteps),
      'data-open-crash': open.crashed ? 'yes' : 'no',
      'data-open-actions': open.actions.join(','),
      'data-replan-return': fmt(closed.trueReturn),
      'data-replan-plans': String(closed.plans),
      'data-replan-steps': String(closed.modelSteps),
      'data-replan-crash': closed.crashed ? 'yes' : 'no',
      'data-replan-actions': closed.actions.join(','),
    }, h('table', null, [
      h('thead', null, h('tr', null, ['', 'Open-loop', 'Replan'].map((text) => h('th', { scope: 'col', text })))),
      h('tbody', null, [
        ['True return', fmt(open.trueReturn), fmt(closed.trueReturn)],
        ['Mean-model return of the first plan', fmt(open.predictedReturn), fmt(closed.predictedReturn)],
        ['Plans', String(open.plans), String(closed.plans)],
        ['Sequences scored per plan', String(open.budgetPerPlan.candidates), String(closed.budgetPerPlan.candidates)],
        ['Horizon per plan', String(open.budgetPerPlan.horizon), String(closed.budgetPerPlan.horizon)],
        ['Mean-model steps, total', String(open.modelSteps), String(closed.modelSteps)],
        ['Hit the wall', open.crashed ? 'yes' : 'no', closed.crashed ? 'yes' : 'no'],
      ].map((row) => h('tr', null, row.map((text) => h('td', { text }))))),
    ]));
  }
  function limits(h) {
    const rows = [
      ['+1, +1, 0, 0', state.limits.lesson],
      ['0, 0, 0, 0', state.limits.zero],
      ['+2, 0, 0, 0', state.limits.uncorrectable],
    ];
    return h('div.vpo-table', { id: 'replan-limits', tabindex: '0', role: 'region', 'aria-label': 'Counterfactual disturbance schedules' }, h('table', null, [
      h('thead', null, h('tr', null, ['Disturbance', 'Open-loop return', 'Replan return', 'Open-loop wall', 'Replan wall'].map((text) => h('th', { scope: 'col', text })))),
      h('tbody', null, rows.map(([name, run]) => h('tr', null, [
        name, fmt(run.open.trueReturn), fmt(run.closed.trueReturn), run.open.crashed ? 'yes' : 'no', run.closed.crashed ? 'yes' : 'no',
      ].map((text) => h('td', { text }))))),
    ]));
  }

  R.mount = (pane, lab, api) => {
    hooks = api || {};
    state.step = hooks.step ? hooks.step() : 0;
    state.finished = hooks.done ? hooks.done() : false;
    state.picks = {};
    for (const q of Object.values(QUESTIONS)) {
      const prev = hooks.answer ? hooks.answer(q.id) : null;
      if (prev) state.picks[q.id] = prev.choice;
    }
    if (state.step >= 2) state.open = R.rollout('open', R.SCHEDULES.lesson);
    if (state.step >= 4) measureRepair();
    const lesson = C.levels.find((l) => l.id === 'replan');
    const body = hWrap(hooks.h);
    pane.append(body);
    redraw = () => {
      if (!body.isConnected) return;
      const h = hooks.h;
      const explainPick = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
      const kids = [
        h('div.eyebrow', { text: 'Level ' + (C.levels.indexOf(lesson) + 1) + ' · Known model' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('p', { text: 'SuperMimic, the previous level, fits a model and can be exploited. This level does not learn. Actions are -1, 0, or +1. The mean model adds only the action. The corridor also adds a disturbance. Safe cells are -1, 0, and 1. The score is 1 minus the absolute cell there, and -5 at a wall, which ends the episode.' }),
        h('p', { text: 'The planner scores all 81 sequences of length 4 under the mean model and keeps the best. Lecture 16 calls a sampling version of that scoring the cross-entropy method, then refits a Gaussian and samples again. This list is small, so the lesson scores every sequence once and does not refit a Gaussian.' }),
        h('p', null, [
          'Source: CS 285 Spring 2026 lecture 16, ',
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-16.pdf', target: '_blank', rel: 'noopener' }, 'slides'),
          '. Titles used here: "The stochastic open-loop case", "The stochastic closed-loop case", "Cross-entropy method (CEM)", and "The curse of long model-based rollouts". Lecture 15, ',
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-15.pdf', target: '_blank', rel: 'noopener' }, 'slides'),
          ', names bootstrap ensembles. This lesson does not implement them. Lecture 16 also has a slide titled "Model-based RL in the real world example". This corridor is not that example.',
        ]),
        h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'replan-step-predict' }, [
          h('span.num', { text: 'Step 1' }),
          h('h3', { text: 'Predict before you run' }),
          questionBlock(h, QUESTIONS.predict, () => advance(1)),
        ]),
      ];
      if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'replan-step-run' }, [
        h('span.num', { text: 'Step 2' }),
        h('h3', { text: 'Run the open-loop plan' }),
        h('p', { text: 'One plan from the start cell. The disturbance schedule is +1, +1, 0, 0. Replan is not running yet.' }),
        h('button.btn', { id: 'replan-run', type: 'button', onclick: () => R.run() }, 'Score every sequence and drive it open-loop'),
      ]));
      if (state.open && state.step >= 2) kids.push(
        board(h, state.open, state.step >= 4 ? state.closed : null),
        h('p.small', { id: 'replan-open-readout', role: 'status', text: 'Open-loop predicted return ' + fmt(state.open.predictedReturn) + ' under the mean model. True return on this schedule ' + fmt(state.open.trueReturn) + '. Plans: ' + state.open.plans + '. Sequences per plan: ' + state.open.budgetPerPlan.candidates + '. Horizon per plan: ' + state.open.budgetPerPlan.horizon + '. Mean-model steps: ' + state.open.modelSteps + '.' }),
      );
      if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'replan-step-diagnose' }, [
        h('span.num', { text: 'Step 3' }),
        h('h3', { text: 'Diagnose' }),
        questionBlock(h, QUESTIONS.diagnose, () => advance(3)),
      ]));
      if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'replan-step-repair' }, [
        h('span.num', { text: 'Step 4' }),
        h('h3', { text: 'Repair: replan from the observed cell' }),
        h('p', { text: 'Same mean model, same 81 sequences, same horizon, same disturbance schedule. Each plan uses only its first action. The next plan starts from the cell the corridor actually reached. This is not a handwritten recovery path and it is not a learning update.' }),
        h('button.btn', { id: 'replan-repair', type: 'button', onclick: () => { measureRepair(); advance(4); redraw(); } }, 'Replan from the observed cell each step'),
      ]));
      if (state.closed && state.step >= 4) kids.push(
        metrics(h, state.open, state.closed),
        h('p', { text: 'Every plan scored ' + state.open.budgetPerPlan.candidates + ' sequences of horizon ' + state.open.budgetPerPlan.horizon + ' on the mean model. Open-loop made ' + state.open.plans + ' plan and ' + state.open.modelSteps + ' mean-model steps. Replan made ' + state.closed.plans + ' plans and ' + state.closed.modelSteps + ' mean-model steps. A plan that starts nearer the wall stops more sequences early, so the measured step count can differ even though the candidate list and the horizon do not.' }),
        h('details', { id: 'replan-horizon', open: true }, [
          h('summary', { text: 'Planning horizon and model error' }),
          h('p', { text: 'The open-loop plan predicts return ' + fmt(state.open.predictedReturn) + ' and stays on the center in the mean model. On this schedule the true return is ' + fmt(state.open.trueReturn) + '. That gap is model error on this sample: each disturbance is a one-step mistake the committed sequence never corrects. A longer open-loop horizon would keep that mistake inside more actions. Replanning throws away the rest of the sequence and searches again from the observed cell, so the mistake that already happened is in the state instead of in the remaining commands. The planner still assumes later disturbances are zero.' }),
          h('p', { text: 'The same code on two other schedules, not a separate noise draw:' }),
          limits(h),
          h('p.small', { text: 'All zeros: the mean model matches the corridor, and the two returns match. A first shove of +2: the action can change the cell by only 1, so both cars hit the wall before a second look. Replanning does not solve every disturbance. Ensembles, Dyna, and latent dynamics are not in this lesson.' }),
        ]),
        h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'replan-step-explain' }, [
          h('span.num', { text: 'Step 5' }),
          h('h3', { text: 'Explain why it works' }),
          questionBlock(h, QUESTIONS.explain, () => {}),
        ]),
        h('button.btn', {
          id: 'replan-complete', type: 'button',
          disabled: state.finished || !(explainPick && explainPick.correct) ? true : null,
          onclick: () => { if (hooks.complete) hooks.complete(); state.finished = true; state.step = 5; redraw(); },
        }, state.finished ? 'Lesson complete' : 'Finish lesson'),
      );
      const next = C.levels[C.levels.indexOf(lesson) + 1];
      if (state.step >= 5) kids.push(next
        ? h('button.btn', { id: 'replan-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
        : h('p.small', { id: 'replan-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
      body.replaceChildren(...kids);
      lab.replaceChildren(h('section.card.game-rules', { id: 'replan-rules' }, [
        h('h3', { text: 'Game rules · Noisy corridor' }),
        h('dl', null, [
          ['Goal', 'Drive four steps in cells -1, 0, and 1. The mean model prefers the center.'],
          ['Reward each step', '1 minus the absolute cell on -1, 0, or 1. A wall at -2 or +2 pays -5 and stops the episode.'],
          ['Model', 'Given, not learned. The planner adds only the action. It does not add the disturbance.'],
          ['Disturbance', 'One fixed list, shared by open-loop and replan. The lesson list is +1, +1, 0, 0.'],
          ['Search', 'All 81 sequences of length 4. Highest mean-model return wins. This is one scoring pass, not a Gaussian refit.'],
          ['Episode ends', 'At a wall, or after 4 actions.'],
          ['Score', 'Sum of true-corridor rewards. The mean-model return is shown beside it.'],
          ['Pass this challenge', lesson.goal.text],
        ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text })]))),
      ]));
    };
    redraw();
  };
  function hWrap(h) { return h('div.card.stack', { id: 'replan-lesson' }); }
})(window.CONTENT, window.BBREPLAN);
