// Two already-filled reward tables. Planning is in src/agents/ensemble.js.
(function (C, E) {
  'use strict';
  if (!E || !E.plan || !E.rollout) throw new Error('ensemble lesson requires BBENSEMBLE');
  C.worldNames.ensemble = 'Two reward tables';
  const lessonGoal = 'Plan on the average and on the average minus the disagreement penalty, walk both plans in the aisle, and see that agreement is not the same as the true reward.';
  const ensembleLevel = {
    id: 'ensemble', custom: true, phase: 8, world: 'ensemble', title: 'Stop where the tables disagree', focus: [],
    intro: 'Two reward tables are already filled in. On the shelf they agree. On the glare door they do not, and their average is high. The aisle pays nothing for glare. Planning on the average walks in. Planning on the average minus a penalty for the difference stays with the shelf.',
    goal: { text: lessonGoal },
  };
  const replanAt = C.levels.findIndex((l) => l.id === 'replan');
  const superAt = C.levels.findIndex((l) => l.id === 'supermimic');
  if (replanAt >= 0) C.levels.splice(replanAt, 0, ensembleLevel);
  else if (superAt >= 0) C.levels.splice(superAt + 1, 0, ensembleLevel);
  else C.levels.push(ensembleLevel);

  const DOORS = [
    { edge: 'start|walk', key: 'walk', name: 'Walk into the aisle' },
    { edge: 'aisle|shelf', key: 'shelf', name: 'Shelf door' },
    { edge: 'aisle|glare', key: 'glare', name: 'Glare door' },
    { edge: 'aisle|vault', key: 'vault', name: 'Vault door' },
  ];
  const QUESTIONS = {
    predict: {
      id: 'ensemble-p',
      correct: 1,
      prompt: 'Shelf is 1 and 1. Glare is 6 and 0. Vault is 0 and 0. The walk pays 0 in both tables. The planner does not read the true reward or the data column. What does scoring only the average do?',
      options: [
        { text: 'It stays at the shelf, because that door is marked as in the data.', correct: false, why: 'The data column is on the page and is not an input. The average at glare is 3, and the average at the shelf is 1.' },
        { text: 'It enters glare. The average there is 3, which is higher than the shelf.', correct: true, why: 'Coefficient 0 scores the average. Glare wins that comparison. The true reward is applied only after the actions are chosen.' },
        { text: 'It already subtracts the difference, so it stays at the shelf before you pick a coefficient.', correct: false, why: 'The penalty is a separate score. The average plan uses coefficient 0.' },
      ],
    },
    diagnose: {
      id: 'ensemble-d',
      correct: 0,
      prompt: 'The average plan walked into glare and the aisle paid 0. What happened?',
      options: [
        { text: 'Coefficient 0 followed the average. The tables disagree on glare, the average is high, and the true reward, which was not an input, is 0.', correct: true, why: 'The planner score and the true return are different numbers. The walk used the aisle. The plan did not.' },
        { text: 'The penalty refused glare.', correct: false, why: 'The average plan used coefficient 0. The penalty is the other plan.' },
        { text: 'Glare was deleted because it was not in the data.', correct: false, why: 'There is no mask. The average plan chose glare.' },
      ],
    },
    explain: {
      id: 'ensemble-x',
      correct: 1,
      prompt: 'What does this penalty do, and what does a difference of zero not do?',
      options: [
        { text: 'A difference of zero proves the tables are right, so the penalty is a safety guarantee.', correct: false, why: 'The confident glare walk had difference 0, planner score 6, and true return 0. The penalty subtracted nothing.' },
        { text: 'The score is the average minus the coefficient times the absolute difference. It falls only when the tables differ. If both tables are wrong together, the walk can still score 0 in the aisle. This page did not resample data or train a network, and it is not MOPO or COMBO.', correct: true, why: 'The vault walk is the other side: both tables said 5 on a door that was not in the data, the penalty did not mask it, and the aisle paid 5.' },
        { text: 'The repair stored a path to the shelf and plays that path back.', correct: false, why: 'Each button calls the planner on the tables it shows, then walks those actions in the aisle. The shelf path is not saved as the answer.' },
      ],
    },
  };

  const state = {
    step: 0, picks: {}, finished: false, error: '',
    coefficient: E.LESSON_COEFFICIENT,
    modelA: E.copyRewards(E.LESSON_A),
    modelB: E.copyRewards(E.LESSON_B),
    truth: E.copyRewards(E.LESSON_TRUTH),
    lessonRun: null, wrongRun: null, highRun: null, customRun: null,
  };
  let hooks = {};
  let redraw = null;

  function num(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 'undefined';
    const rounded = Math.round(x * 10000) / 10000;
    return String(rounded);
  }
  function pair(modelA, modelB, coefficient, truth) {
    const meanPlan = E.plan(modelA, modelB, 0, E.GRAPH);
    const meanRun = E.rollout(meanPlan.actions, truth, E.GRAPH);
    const penPlan = E.plan(modelA, modelB, coefficient, E.GRAPH);
    const penRun = E.rollout(penPlan.actions, truth, E.GRAPH);
    return {
      coefficient,
      modelA: E.copyRewards(modelA),
      modelB: E.copyRewards(modelB),
      truth: E.copyRewards(truth),
      meanPlan, meanRun, penPlan, penRun,
    };
  }
  function lessonPair() {
    return pair(E.LESSON_A, E.LESSON_B, E.LESSON_COEFFICIENT, E.LESSON_TRUTH);
  }
  function wrongPair() {
    const modelA = E.copyRewards(E.LESSON_A);
    const modelB = E.copyRewards(E.LESSON_B);
    modelA['aisle|glare'] = 6;
    modelB['aisle|glare'] = 6;
    return pair(modelA, modelB, E.LESSON_COEFFICIENT, E.LESSON_TRUTH);
  }
  function highPair() {
    const modelA = E.copyRewards(E.LESSON_A);
    const modelB = E.copyRewards(E.LESSON_B);
    const truth = E.copyRewards(E.LESSON_TRUTH);
    modelA['aisle|vault'] = 5;
    modelB['aisle|vault'] = 5;
    truth['aisle|vault'] = 5;
    return pair(modelA, modelB, E.LESSON_COEFFICIENT, truth);
  }
  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function lessonOk(run) {
    return !!(run && run.meanPlan.actions.join(',') === 'walk,glare' && run.meanRun.trueReturn === 0
      && run.penPlan.actions.join(',') === 'walk,shelf' && run.penRun.trueReturn === 1
      && run.penPlan.plannerScore < run.meanPlan.plannerScore);
  }
  function wrongOk(run) {
    if (!run) return false;
    const glare = run.penPlan.steps.find((step) => step.action === 'glare');
    return !!(glare && glare.disagreement === 0 && glare.score === glare.mean
      && run.penPlan.actions.at(-1) === 'glare' && run.meanPlan.actions.at(-1) === 'glare'
      && run.penRun.trueReturn === 0 && run.penPlan.plannerScore > run.penRun.trueReturn);
  }
  function highOk(run) {
    if (!run) return false;
    const vault = run.penPlan.steps.find((step) => step.action === 'vault');
    return !!(vault && vault.disagreement === 0 && E.LESSON_SUPPORT['aisle|vault'] === false
      && run.penPlan.actions.at(-1) === 'vault' && run.meanPlan.actions.at(-1) === 'vault'
      && run.penRun.trueReturn === 5);
  }
  function restoreLesson() {
    state.modelA = E.copyRewards(E.LESSON_A);
    state.modelB = E.copyRewards(E.LESSON_B);
    state.truth = E.copyRewards(E.LESSON_TRUTH);
    state.coefficient = E.LESSON_COEFFICIENT;
  }
  function runLesson() {
    restoreLesson();
    state.error = '';
    state.lessonRun = lessonPair();
    advance(2);
    if (redraw) redraw();
    return state.lessonRun;
  }
  function recompute() {
    try {
      state.customRun = pair(state.modelA, state.modelB, state.coefficient, state.truth);
      state.error = '';
    } catch (err) {
      state.error = err.message;
    }
    if (redraw) redraw();
  }
  function runWrong() {
    state.wrongRun = wrongPair();
    state.modelA = E.copyRewards(state.wrongRun.modelA);
    state.modelB = E.copyRewards(state.wrongRun.modelB);
    state.truth = E.copyRewards(state.wrongRun.truth);
    state.coefficient = state.wrongRun.coefficient;
    state.customRun = state.wrongRun;
    state.error = '';
    if (wrongOk(state.wrongRun) && highOk(state.highRun)) advance(4);
    if (redraw) redraw();
  }
  function runHigh() {
    state.highRun = highPair();
    state.modelA = E.copyRewards(state.highRun.modelA);
    state.modelB = E.copyRewards(state.highRun.modelB);
    state.truth = E.copyRewards(state.highRun.truth);
    state.coefficient = state.highRun.coefficient;
    state.customRun = state.highRun;
    state.error = '';
    if (wrongOk(state.wrongRun) && highOk(state.highRun)) advance(4);
    if (redraw) redraw();
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'ensemble', sentenceName: 'Average minus absolute disagreement', mode: 'campaign',
      level: ensembleLevel.title, knobs: { coefficient: state.coefficient }, words: {}, idleWords: {}, discovered: [],
      lastRun: state.lessonRun ? {
        seeds: 1, steps: state.lessonRun.meanPlan.actions.length,
        symptoms: [],
        summary: 'Average plan true return ' + num(state.lessonRun.meanRun.trueReturn) + '. Penalty plan true return ' + num(state.lessonRun.penRun.trueReturn) + '.',
      } : null,
    }),
    run() { return runLesson(); },
    mount(pane, lab, apiHooks) {
      hooks = apiHooks || {};
      state.step = hooks.step ? hooks.step() : 0;
      state.finished = hooks.done ? hooks.done() : false;
      if (hooks.answer) {
        Object.values(QUESTIONS).forEach((q) => {
          const prev = hooks.answer(q.id);
          if (prev && state.picks[q.id] == null) state.picks[q.id] = prev.choice;
        });
      }
      if (state.step >= 2 && !state.lessonRun) state.lessonRun = lessonPair();
      if (state.step >= 4) {
        if (!state.wrongRun) state.wrongRun = wrongPair();
        if (!state.highRun) state.highRun = highPair();
      }
      const h = hooks.h;
      const lesson = C.levels.find((l) => l.id === 'ensemble');
      const body = h('div.card.stack', { id: 'ensemble-lesson' });
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const n = C.levels.findIndex((l) => l.id === 'ensemble') + 1;
        const next = C.levels[C.levels.findIndex((l) => l.id === 'ensemble') + 1];
        const predicted = state.picks[QUESTIONS.predict.id] === QUESTIONS.predict.correct;
        const diagnosed = state.picks[QUESTIONS.diagnose.id] === QUESTIONS.diagnose.correct;
        const explained = state.picks[QUESTIONS.explain.id] === QUESTIONS.explain.correct;
        const lessonGood = lessonOk(state.lessonRun);
        const wrongGood = wrongOk(state.wrongRun);
        const highGood = highOk(state.highRun);
        const repairGood = lessonGood && wrongGood && highGood;
        const choices = (q, onCorrect, open) => h('div.mc', { id: q.id }, [
          h('p', { text: q.prompt }),
          ...q.options.map((opt, index) => {
            const picked = state.picks[q.id];
            const locked = picked === q.correct;
            return h('button.opt' + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
              type: 'button', id: q.id + '-' + index, disabled: !open || locked,
              onclick: () => {
                if (!open || locked) return;
                state.picks[q.id] = index;
                if (hooks.record) hooks.record(q.id, index, !!opt.correct);
                if (opt.correct) onCorrect();
                redraw();
              },
            }, [
              h('span', { text: opt.text }),
              picked === index ? h('span.why', { role: 'status', text: opt.why }) : null,
            ]);
          }),
        ]);
        const formula = (step, coefficient) => step.action + ': (' + num(step.modelA) + ' + ' + num(step.modelB) + ') / 2 = ' + num(step.mean)
          + '. Absolute difference ' + num(step.disagreement) + '. Score ' + num(step.mean) + ' - ' + num(coefficient) + ' * ' + num(step.disagreement) + ' = ' + num(step.score) + '.';
        const planLine = (label, plan, run) => label + ' actions ' + plan.actions.join(', ') + '. Planner score ' + num(plan.plannerScore) + '. Mean of the tables along that path ' + num(plan.meanReturn) + '. True aisle return ' + num(run.trueReturn) + '.';
        const doorBoard = (run, id) => h('div.ensemble-doors', { id }, ['shelf', 'glare', 'vault'].map((door) => {
          const mean = run.meanPlan.state === door;
          const pen = run.penPlan.state === door;
          const cls = mean && pen ? 'both' : mean ? 'mean' : pen ? 'penalty' : '';
          const tag = cls === 'both' ? 'both plans' : cls === 'mean' ? 'average plan' : cls === 'penalty' ? 'penalty plan' : 'not chosen';
          return h('div.ensemble-door' + (cls ? '.' + cls : ''), { text: door + ' · ' + tag });
        }));
        const tableFor = (run, id) => h('div.vpo-table', { id, tabindex: '0', role: 'region', 'aria-label': 'Model tables, averages, disagreement, and true rewards' }, [
          h('table', null, [
            h('thead', null, [h('tr', null, ['Transition', 'Table A', 'Table B', 'Average', 'Absolute difference', 'Score at 0', 'Score at coefficient', 'In the lesson data', 'True reward'].map((text) => h('th', { text })))]),
            h('tbody', null, DOORS.map((door) => {
              const at0 = E.cellStats(run.modelA[door.edge], run.modelB[door.edge], 0);
              const atC = E.cellStats(run.modelA[door.edge], run.modelB[door.edge], run.coefficient);
              return h('tr', null, [
                h('td', { text: door.name }),
                h('td', { text: num(run.modelA[door.edge]) }),
                h('td', { text: num(run.modelB[door.edge]) }),
                h('td', { text: num(atC.mean) }),
                h('td', { text: num(atC.disagreement) }),
                h('td', { text: num(at0.score) }),
                h('td', { text: num(atC.score) }),
                h('td', { text: E.LESSON_SUPPORT[door.edge] ? 'yes' : 'no' }),
                h('td', { text: num(run.truth[door.edge]) }),
              ]);
            })),
          ]),
        ]);
        const readout = (run, id) => h('div', { id }, [
          doorBoard(run, id + '-doors'),
          h('p', {
            id: id + '-mean', role: 'status',
            'data-ensemble-actions': run.meanPlan.actions.join(','),
            'data-ensemble-score': num(run.meanPlan.plannerScore),
            'data-ensemble-true': num(run.meanRun.trueReturn),
            text: planLine('Average plan.', run.meanPlan, run.meanRun),
          }),
          h('p', {
            id: id + '-penalty', role: 'status',
            'data-ensemble-actions': run.penPlan.actions.join(','),
            'data-ensemble-score': num(run.penPlan.plannerScore),
            'data-ensemble-true': num(run.penRun.trueReturn),
            'data-ensemble-coefficient': num(run.coefficient),
            text: planLine('Penalty plan, coefficient ' + num(run.coefficient) + '.', run.penPlan, run.penRun),
          }),
          h('p.small', { text: run.penPlan.steps.map((step) => formula(step, run.coefficient)).join(' ') }),
          tableFor(run, id + '-table'),
        ]);
        const editor = h('div.stack', { id: 'ensemble-editor' }, [
          h('p', { text: 'Change either table or the coefficient, then recompute. The planner still does not receive the true reward or the data column. The true reward stays at the last aisle you loaded.' }),
          ...DOORS.map((door) => h('div.row', { id: 'ensemble-edit-' + door.key }, [
            h('label.small', { text: door.name + '. Table A' }),
            h('input', { type: 'number', id: 'ensemble-a-' + door.key, step: '1', value: String(state.modelA[door.edge]), 'aria-label': door.name + ' table A', oninput: (e) => { state.modelA[door.edge] = Number(e.target.value); } }),
            h('label.small', { text: 'Table B' }),
            h('input', { type: 'number', id: 'ensemble-b-' + door.key, step: '1', value: String(state.modelB[door.edge]), 'aria-label': door.name + ' table B', oninput: (e) => { state.modelB[door.edge] = Number(e.target.value); } }),
            h('span.small', { text: E.LESSON_SUPPORT[door.edge] ? 'In the lesson data.' : 'Not in the lesson data.' }),
          ])),
          h('div.row', null, [
            h('label.small', { for: 'ensemble-coefficient', text: 'Coefficient' }),
            h('input', { type: 'number', id: 'ensemble-coefficient', min: '0', step: '0.1', value: String(state.coefficient), 'aria-label': 'Disagreement coefficient', oninput: (e) => { state.coefficient = Number(e.target.value); } }),
          ]),
          h('button.btn', { type: 'button', id: 'ensemble-recompute', onclick: recompute }, 'Recompute from these tables'),
          h('button.btn.ghost', { type: 'button', id: 'ensemble-restore', onclick: () => { restoreLesson(); state.customRun = null; state.error = ''; redraw(); } }, 'Restore the lesson tables'),
          state.error ? h('p.small', { id: 'ensemble-error', role: 'status', text: state.error }) : null,
          state.customRun ? readout(state.customRun, 'ensemble-custom') : null,
        ]);
        const kids = [
          h('div.eyebrow', { text: 'Level ' + n + ' · Two reward tables' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', null, [
            'Source: ',
            E.SOURCE.course,
            ', ',
            h('a', { href: E.SOURCE.slides, target: '_blank', rel: 'noopener' }, 'slides'),
            '. Slide ' + E.SOURCE.pages.penalty + ' says: ' + E.SOURCE.lines[0] + '. Slide ' + E.SOURCE.pages.highVariance + ' says: ' + E.SOURCE.lines[1] + '. Slide ' + E.SOURCE.pages.pessimistic + ' says: ' + E.SOURCE.lines[2] + '. Slide ' + E.SOURCE.pages.bootstrap + ' says: ' + E.SOURCE.lines[3] + '. This page does not train those models. The score is this lesson\'s penalty on two tables that are already filled in.',
          ]),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'ensemble-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you run' }),
            choices(QUESTIONS.predict, () => advance(1), true),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'ensemble-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Run both plans in the aisle' }),
          h('p', { text: 'The search lists every legal path from the start to a door. There are 3. The walk is the only legal first action. Each door then ends the episode. The average plan uses coefficient 0. The penalty plan uses coefficient ' + num(E.LESSON_COEFFICIENT) + '. Both plans are walked in the true aisle after the actions are chosen.' }),
          h('button.btn', { type: 'button', id: 'ensemble-run', disabled: !predicted, onclick: runLesson }, 'Score the average and the penalty, then walk both'),
        ]));
        if (state.lessonRun && state.step >= 2) kids.push(
          h('p.small', { text: 'In the lesson data, and the true reward, are shown so you can compare. Neither column is given to the planner.' }),
          readout(state.lessonRun, 'ensemble-lesson-run'),
          lessonGood ? h('p', { id: 'ensemble-lesson-check', text: 'On these tables the average plan\'s true return is 0 and the penalty plan\'s true return is 1.' }) : h('p', { id: 'ensemble-lesson-check', text: 'These tables did not produce the lesson\'s 0 versus 1 result. Restore the lesson tables and walk them again.' }),
          editor,
        );
        if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'ensemble-step-diagnose' }, [
          h('span.num', { text: 'Step 3' }),
          h('h3', { text: 'Diagnose' }),
          choices(QUESTIONS.diagnose, () => advance(3), !!(state.lessonRun && lessonGood)),
        ]));
        if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'ensemble-step-repair' }, [
          h('span.num', { text: 'Step 4' }),
          h('h3', { text: 'Repair is the penalty, and it is not a certificate' }),
          h('p', { text: 'The lesson walk already compared coefficient 0 with coefficient 0.5. Two more aisles use the same planner. One sets both glare tables to 6 and leaves the true glare reward at 0. The other sets both vault tables to 5 and sets the true vault reward to 5. Vault stays marked as not in the lesson data. The planner call does not receive that mark or the true reward.' }),
          h('button.btn', { type: 'button', id: 'ensemble-wrong', disabled: !diagnosed, onclick: runWrong }, 'Both tables agree glare is 6. Walk it.'),
          h('button.btn.ghost', { type: 'button', id: 'ensemble-high', disabled: !diagnosed, onclick: runHigh }, 'Both tables agree the vault is 5, and the aisle pays 5. Walk it.'),
          state.wrongRun ? h('div', { id: 'ensemble-wrong-readout' }, [
            h('h3', { text: 'Agree, and still wrong' }),
            readout(state.wrongRun, 'ensemble-wrong-run'),
            h('p', { text: wrongGood ? 'Difference 0. The penalty subtracted nothing. Planner score stays at the average. True return is 0. This is not a veto, and it is not a safety guarantee.' : 'This walk did not show a confident miss. The difference should be 0 and the true return should be 0.' }),
          ]) : null,
          state.highRun ? h('div', { id: 'ensemble-high-readout' }, [
            h('h3', { text: 'Agree on a door the data never saw' }),
            readout(state.highRun, 'ensemble-high-run'),
            h('p', { text: highGood ? 'The vault was not in the lesson data. Both tables said 5, the difference was 0, and the plan entered it. The aisle paid 5. A mask that refuses every unseen door would have stayed at the shelf.' : 'This walk did not enter a vault both tables rate at 5.' }),
          ]) : null,
        ]));
        if (repairGood && state.step >= 4) kids.push(h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'ensemble-step-explain' }, [
          h('span.num', { text: 'Step 5' }),
          h('h3', { text: 'Explain the limit' }),
          choices(QUESTIONS.explain, () => {}, true),
          h('button.btn', {
            type: 'button', id: 'ensemble-complete', disabled: !(explained && repairGood) || state.finished,
            onclick: () => { if (hooks.complete) hooks.complete(); state.finished = true; state.step = 5; redraw(); },
          }, state.finished ? 'Lesson complete' : 'Agreement is not the true reward'),
        ]));
        if (state.step >= 5 && state.finished) kids.push(next
          ? h('button.btn.ghost', { type: 'button', id: 'ensemble-next', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
          : h('p.small', { id: 'ensemble-next', text: 'This is the last level in the campaign list.' }));
        body.replaceChildren(...kids.filter((node) => node != null && node !== false));
        lab.replaceChildren(h('section.card.game-rules', { id: 'ensemble-rules' }, [
          h('h3', { text: 'Game rules · Two reward tables' }),
          h('dl', null, [
            ['Goal', lesson.goal.text],
            ['Reward each step', 'The aisle pays the true reward of the transition you walk. The lesson aisle pays 0 for the walk, 1 for the shelf, and 0 for glare and the vault.'],
            ['Equation', 'Score = (table A + table B) / 2 - coefficient * |table A - table B|. Coefficient 0 is the average. The lesson penalty uses 0.5.'],
            ['Episode ends', 'At the shelf, the glare door, or the vault. A later action is illegal. Reset returns to the start with return 0.'],
            ['Score', 'The planner score is the sum of transition scores. The true return is the sum of aisle rewards along the same actions. They are shown separately.'],
            ['Pass this challenge', lesson.goal.text],
          ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text })]))),
          h('div', null, E.LIMITS.map((line) => h('p.small', { text: line }))),
        ]));
      };
      redraw();
    },
  };
  window.BBENSEMBLE_LEVEL = api;
})(window.CONTENT, window.BBENSEMBLE);
