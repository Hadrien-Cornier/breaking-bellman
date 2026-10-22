// Frozen reward tables. The planner subtracts model disagreement. It does not read a dataset bit.
(function (C, M) {
  'use strict';
  if (!C || !M || !M.plan) throw new Error('mopo lesson requires CONTENT and BBMOPO');
  C.worldNames.mopo = 'Three reward cells';
  const GOAL = 'See the average enter the Hole. Then plan with the mean minus a coefficient times the absolute disagreement, and take Span, the agreed cell that was not in the dataset. Coefficient 0 must be allowed to enter the Hole. Agreement on a wrong reward must be allowed to fail. The planner does not read a dataset bit.';
  const predict = {
    id: 'mopo-p',
    prompt: 'The frozen dataset contains only Home. The two tables agree on Home at 1 reward point and on Span at 3 reward points. On the Hole they say 8 and 0. You enter the cell with the highest average of the two tables. Which cell is that?',
    options: [
      {
        steps: ['The Hole average is (8 + 0) / 2 = 4 reward points.', 'Span averages to 3, and Home averages to 1.', '4 is the largest average, so the average enters the Hole.'],
        result: 'The Hole. Its average is 4 reward points.',
        correct: true,
        why: 'The true reward on the Hole is 0. The average does not subtract the gap of 8 reward points.',
      },
      {
        steps: ['The tables agree on Span.', 'Agreement is treated as a filter.', 'So the average enters Span.'],
        result: 'Span. Agreement makes the average skip the Hole.',
        correct: false,
        why: 'Agreement is not what the average maximizes. The Hole average is higher.',
      },
      {
        steps: ['Home is the only dataset cell.', 'The average reads that bit.', 'So it stays on Home.'],
        result: 'Home. The average refuses every cell that is not in the dataset.',
        correct: false,
        why: 'That is a mask. The average does not read the dataset bit.',
      },
    ],
  };
  const diagnose = {
    id: 'mopo-d',
    prompt: 'The average entered the Hole. The true reward there is 0 reward points. What failed?',
    options: [
      {
        steps: ['Model A says 8 and model B says 0.', 'The average is 4, and nothing subtracts the gap of 8.', 'The true reward on that cell is 0.'],
        result: 'The average is high where the tables disagree, and the true reward is 0.',
        correct: true,
        why: 'A penalty subtracts a coefficient times that gap. The dataset bit is a different rule.',
      },
      {
        steps: ['Home is the only dataset cell.', 'Leaving Home is required.', 'So the average had to enter the Hole.'],
        result: 'The average had to leave Home because of the dataset bit.',
        correct: false,
        why: 'The average does not read the dataset bit. Span was also available, and its average is 3.',
      },
      {
        steps: ['The tables are a live network.', 'Planning updates that network.', 'So the Hole prediction changed during the plan.'],
        result: 'The tables were still learning during the plan.',
        correct: false,
        why: 'Both tables are already fitted and fixed. This page does not train them, and it cannot add a transition.',
      },
    ],
  };
  const explain = {
    id: 'mopo-x',
    prompt: 'The penalty is the mean minus a coefficient times the absolute gap, in reward points. What does that planner use, and what does confident agreement miss?',
    options: [
      {
        steps: ['It reads the two model tables and the coefficient.', 'It does not read the dataset bit, so an agreed unseen cell can win.', 'If both tables agree on a high reward and the true reward is 0, the gap is 0 and the penalty does not help.'],
        result: 'It uses the gap, not the dataset bit. Confident wrong agreement still enters.',
        correct: true,
        why: 'Coefficient 0 removes the penalty and enters the Hole. A positive coefficient does not catch a gap of 0.',
      },
      {
        steps: ['Unseen cells are refused.', 'The gap is never read.', 'So the plan stays on Home.'],
        result: 'It refuses every cell that was not in the frozen dataset.',
        correct: false,
        why: 'That is the mask comparison. The penalty planner takes Span, which is not in the dataset.',
      },
      {
        steps: ['A dynamics network is trained on the dataset.', 'The paper estimator supplies the penalty.', 'So this page is that estimator.'],
        result: 'It trains a dynamics network and uses the paper uncertainty estimator.',
        correct: false,
        why: 'The two tables are fixed. The lecture heading is MOPO: Model-Based Offline Policy Optimization. This page is only the penalty form on two reward tables.',
      },
    ],
  };
  const level = {
    id: 'mopo', custom: true, phase: 4, world: 'mopo', title: 'Subtract the disagreement', focus: [],
    intro: 'Three cells, and a dataset that stays frozen. Two fixed tables already predict the reward of entering each cell, in reward points. On the dataset cell they agree. Past the data they can disagree, and their average can be high inside the Hole while the true reward there is 0. The planner enters the cell with the highest mean minus a coefficient times the absolute disagreement. It does not read a bit that says the cell was in the data.',
    goal: { text: GOAL },
    predict: predict,
    diagnose: diagnose,
    explain: explain,
    soWhat: 'When two reward models agree on a cell the data never showed, a penalty for disagreement can still take it. A mask that refuses every unseen cell cannot. When both models agree and both are wrong, the gap is 0 and the penalty does not save you.',
    cannotTeach: 'A learned dynamics network, the paper uncertainty estimator, and the COMBO value loss. Lecture 18 next heads COMBO: Conservative Model-Based RL. This page does not compute that loss. The same penalty can be used while an agent is still allowed to collect data. This lesson cannot add a transition.',
  };
  const thawAt = C.levels.findIndex((item) => item.id === 'thaw');
  const mixedAt = C.levels.findIndex((item) => item.id === 'mixed');
  if (!C.levels.some((item) => item.id === 'mopo')) {
    if (thawAt >= 0) C.levels.splice(thawAt + 1, 0, level);
    else if (mixedAt >= 0) C.levels.splice(mixedAt + 1, 0, level);
    else C.levels.push(level);
  }
  C.cards.mopo = {
    name: 'Reward penalty from two tables',
    status: 'checked',
    fixes: 'Subtract a coefficient times the absolute gap of two fixed reward tables. The planner can take an agreed cell that was not in the frozen dataset.',
    stillWrong: 'If both tables agree on a high reward and the true reward is 0, the gap is 0 and the penalty does not help. This is not a learned dynamics model and not the COMBO value loss.',
    paper: 'CS 285 lecture 18, slide heading MOPO: Model-Based Offline Policy Optimization. The slide includes the words uncertainty penalty. This page uses the absolute gap of two already fitted reward tables as that penalty. It does not train a dynamics network and it does not compute the COMBO loss.',
  };
  C.paperLinks = C.paperLinks || {};
  C.paperLinks.mopo = [
    { t: 'Lecture 18 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-18.pdf' },
  ];

  function lessonModels() {
    const models = {};
    for (const id of M.IDS) models[id] = { modelA: String(M.LESSON_MODELS[id].modelA), modelB: String(M.LESSON_MODELS[id].modelB) };
    return models;
  }
  const state = {
    picked: {},
    coefficient: String(M.LESSON_COEFFICIENT),
    models: lessonModels(),
    average: null,
    last: null,
    error: '',
    sawAverageHole: false,
    sawPenaltySpan: false,
    sawZeroHole: false,
    sawMaskMiss: false,
    sawConfidentWrong: false,
  };
  let hooks = {};
  let redraw = null;

  function advance(n) {
    if (hooks.mark) hooks.mark(n);
  }
  function num(value) {
    if (value == null || !Number.isFinite(value)) return 'undefined';
    return String(Math.round(value * 10000) / 10000);
  }
  function nameOf(id) {
    return M.ENVIRONMENT[id] ? M.ENVIRONMENT[id].name : id;
  }
  function sameLesson(models) {
    return M.IDS.every((id) => models[id].modelA === M.LESSON_MODELS[id].modelA && models[id].modelB === M.LESSON_MODELS[id].modelB);
  }
  function note(result) {
    if (!result || !result.ok || result.policy !== 'penalty') return;
    const penalty = result.plans.penalty;
    const mask = result.plans.mask;
    if (sameLesson(result.models) && result.coefficient === M.LESSON_COEFFICIENT && penalty.chosen === 'span' && penalty.trueReward === 3 && mask.chosen === 'home' && mask.refused.indexOf('span') >= 0) {
      state.sawPenaltySpan = true;
      state.sawMaskMiss = true;
    }
    if (sameLesson(result.models) && result.coefficient === 0 && penalty.chosen === 'hole' && penalty.trueReward === 0) state.sawZeroHole = true;
    if (result.coefficient > 0 && result.models.hole.modelA === result.models.hole.modelB && penalty.chosen === 'hole' && penalty.trueReward === 0 && penalty.disagreement === 0 && penalty.mean > 0) state.sawConfidentWrong = true;
  }
  function repairReady() {
    return state.sawAverageHole && state.sawPenaltySpan && state.sawZeroHole && state.sawMaskMiss && state.sawConfidentWrong;
  }
  function explainCorrect() {
    const picked = state.picked[explain.id];
    return picked != null && !!explain.options[picked].correct;
  }
  function runPlan(policy, coefficient, models) {
    const result = M.plan({ policy: policy, coefficient: coefficient, models: models });
    state.last = result;
    state.error = result.ok ? '' : result.error;
    note(result);
    if (repairReady() && (!hooks.step || hooks.step() < 4)) advance(4);
    return result;
  }
  function scoreAverage() {
    state.average = M.plan({ policy: 'average', coefficient: 0, models: M.LESSON_MODELS });
    state.sawAverageHole = !!(state.average.ok && state.average.action.chosen === 'hole' && state.average.action.trueReward === 0);
    advance(2);
    if (redraw) redraw();
    return state.average;
  }
  function readBoxes() {
    const coefficientEl = document.getElementById('mopo-coefficient');
    if (!coefficientEl) return null;
    const models = {};
    for (const id of M.IDS) {
      const modelA = document.getElementById('mopo-a-' + id);
      const modelB = document.getElementById('mopo-b-' + id);
      if (!modelA || !modelB) return null;
      models[id] = { modelA: modelA.value, modelB: modelB.value };
    }
    return { coefficient: coefficientEl.value, models: models };
  }
  function planFromBoxes() {
    const boxes = readBoxes();
    if (!boxes) {
      state.error = 'The model tables are not on the page.';
      if (redraw) redraw();
      return;
    }
    state.coefficient = boxes.coefficient;
    state.models = boxes.models;
    runPlan('penalty', boxes.coefficient, boxes.models);
    if (redraw) redraw();
  }
  function applyPreset(coefficient, models) {
    state.coefficient = coefficient;
    state.models = models;
    runPlan('penalty', coefficient, models);
    if (redraw) redraw();
  }
  function ensureCss() {
    if (typeof document === 'undefined' || !document.head || !document.getElementById) return;
    if (document.getElementById('mopo-css')) return;
    const style = document.createElement('style');
    style.id = 'mopo-css';
    style.textContent = '#mopo-lesson,#mopo-rules{max-width:100%;overflow-wrap:anywhere}#mopo-lesson .btn,#mopo-lesson .opt,#mopo-rules .btn{min-height:44px}#mopo-lesson input{min-height:44px;font-size:16px;max-width:8rem}#mopo-lesson .controls,#mopo-lesson .cells{display:flex;flex-wrap:wrap;gap:8px}#mopo-lesson .cell{flex:1 1 180px;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--surface)}#mopo-lesson .cell.on{border-color:var(--accent)}#mopo-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#mopo-lesson label{display:flex;flex-wrap:wrap;gap:6px;align-items:center}';
    document.head.append(style);
  }

  const api = {
    cancel() { state.error = ''; },
    state: () => ({
      world: 'mopo',
      sentenceName: 'Mean minus absolute disagreement',
      mode: 'campaign',
      level: level.title,
      knobs: { coefficient: state.coefficient, frozen: true },
      words: {},
      idleWords: {},
      discovered: [],
      lastRun: state.last && state.last.ok ? {
        seeds: 1,
        steps: 1,
        symptoms: [],
        summary: 'Penalty enters ' + nameOf(state.last.plans.penalty.chosen) + '.',
      } : null,
    }),
    run: scoreAverage,
    mount(pane, lab, passed) {
      hooks = passed || {};
      ensureCss();
      for (const question of [predict, diagnose, explain]) {
        const saved = hooks.answer ? hooks.answer(question.id) : null;
        if (saved && state.picked[question.id] == null) state.picked[question.id] = saved.choice;
      }
      const h = hooks.h;
      const body = h('div.card.stack', { id: 'mopo-lesson' });
      pane.append(body);
      function pick(question, index, nextStep) {
        state.picked[question.id] = index;
        if (hooks.record) hooks.record(question.id, index, !!question.options[index].correct);
        if (nextStep != null) advance(nextStep);
        redraw();
      }
      function questionBlock(question, nextStep) {
        const picked = state.picked[question.id];
        return h('div.mc', { id: question.id }, [
          h('p', { text: question.prompt }),
          ...question.options.map((option, index) => h('button.opt' + (picked === index ? '.picked' : '') + (picked == null ? '' : option.correct ? '.right' : '.wrong'), {
            type: 'button',
            id: question.id + '-' + index,
            onclick: () => pick(question, index, nextStep),
          }, [
            h('ol', null, option.steps.map((line) => h('li', { text: line }))),
            h('span.res', { text: option.result }),
            picked == null ? null : h('span.why', { text: (option.correct ? 'Sound chain. ' : '') + option.why }),
          ])),
        ]);
      }
      function rowLine(row) {
        return nameOf(row.id) + ': mean ' + num(row.mean) + ', gap ' + num(row.disagreement) + ', penalty ' + num(row.penalty) + ', score ' + num(row.score) + ', true reward ' + num(row.trueReward) + '.';
      }
      function planText(result) {
        if (!result || !result.ok) return result && result.error ? result.error : 'No plan yet.';
        const penalty = result.plans.penalty;
        const average = result.plans.average;
        const mask = result.plans.mask;
        const chosen = penalty.rows.find((row) => row.id === penalty.chosen);
        const confident = !!(chosen && result.coefficient > 0 && chosen.disagreement === 0 && chosen.trueReward === 0 && chosen.mean > 0);
        return [
          'Penalty planner. Coefficient ' + num(result.coefficient) + ' (' + result.units.coefficient + ').',
          result.formula + '.',
          penalty.rows.map(rowLine).join(' '),
          'Chosen cell: ' + nameOf(penalty.chosen) + '. Realized true reward: ' + num(penalty.trueReward) + ' reward points. New transitions: ' + result.newTransitions + '.',
          'The penalty score does not read the dataset bit.',
          'Average, which ignores the coefficient: ' + nameOf(average.chosen) + ', true reward ' + num(average.trueReward) + '.',
          'Mask comparison, not the planner: it keeps dataset cells and ranks them by the average. It does not read the gap. Chosen ' + (mask.chosen ? nameOf(mask.chosen) : 'none') + ', true reward ' + num(mask.trueReward) + '. Refused: ' + (mask.refused.map(nameOf).join(', ') || 'none') + '.',
          confident ? 'Limitation: both tables agree, so the penalty is 0 reward points, and the true reward is 0. The plan still enters.' : '',
        ].filter(Boolean).join(' ');
      }
      function checksText() {
        const bit = (flag, label) => (flag ? 'Seen: ' : 'Not yet: ') + label;
        return [
          bit(state.sawAverageHole, 'the average enters the Hole.'),
          bit(state.sawPenaltySpan, 'coefficient 1 takes Span.'),
          bit(state.sawMaskMiss, 'the mask misses Span.'),
          bit(state.sawZeroHole, 'coefficient 0 enters the Hole.'),
          bit(state.sawConfidentWrong, 'confident agreement on the Hole still enters.'),
        ].join(' ');
      }
      function cellCard(id, acted) {
        const env = M.ENVIRONMENT[id];
        const on = acted && acted.ok && acted.plans.penalty.chosen === id;
        return h('div.cell' + (on ? '.on' : ''), { id: 'mopo-cell-' + id }, [
          h('b', { text: env.name }),
          h('p.small', { text: (env.inDataset ? 'In the frozen dataset.' : 'Not in the frozen dataset.') + ' True reward ' + num(env.trueReward) + ' reward points. That bit and that true reward are not inputs to the penalty.' }),
          h('label', { for: 'mopo-a-' + id }, [env.name + ' model A', h('input', {
            id: 'mopo-a-' + id, type: 'number', inputmode: 'decimal', step: 'any', autocomplete: 'off',
            'aria-label': env.name + ' model A reward points', value: state.models[id].modelA,
          })]),
          h('label', { for: 'mopo-b-' + id }, [env.name + ' model B', h('input', {
            id: 'mopo-b-' + id, type: 'number', inputmode: 'decimal', step: 'any', autocomplete: 'off',
            'aria-label': env.name + ' model B reward points', value: state.models[id].modelB,
          })]),
        ]);
      }
      redraw = () => {
        if (body.isConnected === false) return;
        const step = hooks.step ? hooks.step() : 0;
        const index = C.levels.findIndex((item) => item.id === 'mopo');
        const next = hooks.next ? hooks.next() : null;
        const done = hooks.done && hooks.done();
        const kids = [
          h('div.eyebrow', { text: 'Level ' + (index + 1) + ' · Offline reward tables' }),
          h('h2', { text: level.title }),
          h('p', { text: level.intro }),
          h('p.small', { text: 'Lecture 18, slide heading MOPO: Model-Based Offline Policy Optimization. The slide includes the words uncertainty penalty. These two tables are already fitted. This page does not train a dynamics network and does not run the paper estimator.' }),
          h('p.small', null, [
            h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-18.pdf', target: '_blank', rel: 'noopener' }, 'Lecture 18 slides'),
          ]),
        ];
        const block = (n, title, content) => h('div.step' + (step === n ? '.active' : step > n ? '.done' : ''), { id: 'mopo-step-' + n }, [
          h('span.num', { text: 'Step ' + (n + 1) }),
          h('h3', { text: title }),
          content,
        ]);
        kids.push(block(0, 'Predict before you score', questionBlock(predict, 1)));
        if (step >= 1) kids.push(block(1, 'Score the average', h('div.stack', null, [
          h('p', { text: 'Score the lesson tables by their average. Coefficient 0. The dataset stays the file you were given. This page cannot add a transition.' }),
          h('button.btn', { id: 'mopo-run', type: 'button', onclick: () => api.run() }, 'Score the average'),
          h('p.nums', {
            id: 'mopo-run-readout',
            'data-chosen': state.average && state.average.ok ? state.average.action.chosen : '',
            'data-true': state.average && state.average.ok ? num(state.average.action.trueReward) : '',
            text: state.average && state.average.ok ? 'Average enters ' + nameOf(state.average.action.chosen) + '. True reward ' + num(state.average.action.trueReward) + ' reward points. Gap on the chosen cell ' + num(state.average.action.disagreement) + ' reward points.' : 'Nothing is scored until you run the average.',
          }),
        ])));
        if (step >= 2 && state.average) kids.push(block(2, 'Diagnose', questionBlock(diagnose, 3)));
        if (step >= 3) kids.push(block(3, 'Repair: subtract the disagreement', h('div.stack', null, [
          h('p', { text: 'Type the two model tables and the coefficient. The plan reads those boxes. The dataset bit is shown on the card and is not a box. The coefficient is in reward points of penalty per reward point of absolute disagreement. Both the mean and the gap are in reward points, so the coefficient is a pure number.' }),
          h('div.cells', { id: 'mopo-cells' }, M.IDS.map((id) => cellCard(id, state.last))),
          h('label', { for: 'mopo-coefficient' }, ['Coefficient', h('input', {
            id: 'mopo-coefficient', type: 'number', inputmode: 'decimal', step: 'any', min: '0', autocomplete: 'off',
            'aria-label': 'Penalty coefficient, reward points per reward point of absolute disagreement',
            value: state.coefficient,
          })]),
          h('div.controls', { id: 'mopo-controls' }, [
            h('button.btn', { id: 'mopo-lesson-tables', type: 'button', onclick: () => applyPreset(String(M.LESSON_COEFFICIENT), lessonModels()) }, 'Lesson tables'),
            h('button.btn', { id: 'mopo-zero', type: 'button', onclick: () => applyPreset('0', lessonModels()) }, 'Coefficient 0'),
            h('button.btn', { id: 'mopo-agree-hole', type: 'button', onclick: () => applyPreset(String(M.LESSON_COEFFICIENT), Object.assign(lessonModels(), { hole: { modelA: '6', modelB: '6' } })) }, 'Both models agree on the Hole'),
            h('button.btn', { id: 'mopo-plan', type: 'button', onclick: planFromBoxes }, 'Plan with these tables'),
          ]),
          h('p.nums', {
            id: 'mopo-readout',
            role: 'status',
            'data-ok': state.last && state.last.ok ? 'yes' : 'no',
            'data-coefficient': state.last && state.last.ok ? num(state.last.coefficient) : '',
            'data-chosen': state.last && state.last.ok && state.last.plans.penalty.chosen ? state.last.plans.penalty.chosen : '',
            'data-true': state.last && state.last.ok ? num(state.last.plans.penalty.trueReward) : '',
            'data-average': state.last && state.last.ok && state.last.plans.average.chosen ? state.last.plans.average.chosen : '',
            'data-mask': state.last && state.last.ok && state.last.plans.mask.chosen ? state.last.plans.mask.chosen : '',
            'data-new': state.last && state.last.ok ? String(state.last.newTransitions) : '',
            'data-learned': state.last && state.last.ok && state.last.learnedDynamics ? 'yes' : 'no',
            'data-combo': state.last && state.last.ok && state.last.comboLoss ? 'yes' : 'no',
            text: planText(state.last),
          }),
          h('p.small', { id: 'mopo-checks', text: checksText() }),
          state.error ? h('p.small', { id: 'mopo-error', text: state.error }) : null,
        ])));
        if (step >= 4 && state.sawAverageHole) kids.push(block(4, 'Explain the limit', h('div.stack', null, [
          questionBlock(explain, null),
          h('button.btn', {
            id: 'mopo-complete', type: 'button', disabled: !done && !(explainCorrect() && repairReady()),
            onclick: () => {
              if (done || !explainCorrect() || !repairReady()) return;
              if (hooks.reveal) hooks.reveal('mopo');
              if (hooks.complete) hooks.complete();
              if (hooks.refresh) hooks.refresh();
              else redraw();
            },
          }, done ? 'Lesson complete' : 'Record this plan'),
        ])));
        if (done && next) kids.push(h('button.btn', { id: 'mopo-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title));
        else if (done) kids.push(h('p.small', { id: 'mopo-next', text: 'This is the last level in the campaign list.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'mopo-rules' }, [
          h('h3', { text: 'Game rules · Three reward cells' }),
          h('dl', null, [
            h('div.rules-row', null, [h('dt', { text: 'Goal' }), h('dd', { text: 'Enter the agreed cell whose true reward is high, without using a dataset mask.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Reward' }), h('dd', { text: 'The true reward is 1 on Home, 0 on the Hole, and 3 on Span. The tables predict those rewards. They are not the true reward.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Equation' }), h('dd', { text: 'penalized reward points = (model A + model B) / 2 - coefficient * |model A - model B|.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Coefficient' }), h('dd', { text: 'Reward points of penalty per reward point of absolute disagreement. The lesson value is 1. Zero leaves the plain average.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Dataset' }), h('dd', { text: 'Home is in the frozen file. The Hole and Span are not. The penalty planner does not read that bit, and this page cannot add a transition.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Score' }), h('dd', { text: 'The acted cell earns its true reward, in reward points. The mask comparison is not the planner.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Pass this challenge' }), h('dd', { text: GOAL })]),
          ]),
          h('p', { html: '<b>On a real robot:</b> ' + level.soWhat }),
          h('p.small', { html: '<b>What this toy world cannot teach:</b> ' + level.cannotTeach }),
        ]));
      };
      if ((hooks.step ? hooks.step() : 0) >= 2 && !state.average) scoreAverage();
      else redraw();
    },
  };
  window.BBMOPO_LEVEL = api;
})(window.CONTENT, window.BBMOPO);
