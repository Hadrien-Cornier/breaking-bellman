// Two real corridor steps, then one-step backups from a given model.
// The backup is src/agents/dyna.js. This file does not import SuperMimic or replan.
(function (C, D) {
  'use strict';
  if (!C || !D || !D.run || !D.trueStep) throw new Error('dyna lesson requires CONTENT and BBDYNA');
  C.worldNames.dyna = 'Four-cell corridor';
  const lessonGoal = 'See two real steps leave the far cell empty, then fill it with one-step backups from the given model. A flipped model entry must change that written value, while the corridor still shows its own transition.';
  const level = {
    id: 'dyna', custom: true, phase: 8, world: 'dyna', title: 'Two steps, then the model', focus: [],
    intro: 'Four cells: start, mid, far, and goal. The real budget is two steps. Those steps update start and mid only. A known one-step table can still back up the far cell.',
    goal: { text: lessonGoal },
  };
  const replanAt = C.levels.findIndex((item) => item.id === 'replan');
  const supermimicAt = C.levels.findIndex((item) => item.id === 'supermimic');
  let insertAt = C.levels.length;
  if (replanAt >= 0) insertAt = replanAt;
  else if (supermimicAt >= 0) insertAt = supermimicAt + 1;
  C.levels.splice(insertAt, 0, level);

  const QUESTIONS = {
    predict: {
      id: 'dyna-p',
      prompt: 'You may take two real steps from the start cell. A step updates the cell you leave. A tie, including two empty values, selects right. What is the far cell\'s right-action value afterward?',
      options: [
        { text: 'Empty. The two steps write start and mid. They never write the far cell.', correct: true },
        { text: '1. The goal reward is copied into every cell before any step.', correct: false },
        { text: '0.25. Discount 0.5 moves the goal reward back two cells without an update.', correct: false },
      ],
    },
    diagnose: {
      id: 'dyna-d',
      prompt: 'Real-only leaves the far cell empty. The accurate model writes 1 there. The same sweep with the far-right reward flipped to 0 writes 0. What did those extra updates read?',
      options: [
        { text: 'Rows from the given one-step table, including a far-cell action the real steps never took.', correct: true },
        { text: 'A dynamics network fit on the two real transitions.', correct: false },
        { text: 'The true optimal values. The model row is ignored, so a flip cannot change the write.', correct: false },
      ],
    },
    explain: {
      id: 'dyna-x',
      prompt: 'What is true of this page\'s model updates?',
      options: [
        { text: 'They are one-step backups from a table that was given. A wrong row writes a wrong value. Model updates 0 leaves the far cell empty. This does not train a dynamics model, and it does not show that model updates help in general.', correct: true },
        { text: 'They retrain a neural model on the two real steps, so a flipped row is ignored.', correct: false },
        { text: 'They copy the true corridor values, so the far cell is 1 for every model.', correct: false },
      ],
    },
  };

  const state = {
    step: 0, picks: {}, finished: false, ran: false,
    reward: 1, next: D.GOAL, modelBudget: D.LESSON.modelBudget, order: D.FAR_TO_NEAR, gamma: D.LESSON.gamma,
    sawReal: false, sawAccurate: false, sawWrong: false, sawEdit: false,
  };
  let hooks = {}, redraw = null;

  function show(value) {
    if (value == null || !Number.isFinite(value)) return 'empty';
    const rounded = Math.round(value * 10000) / 10000;
    return String(rounded);
  }
  function name(cell) { return D.NAMES[cell] || String(cell); }
  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function currentSpec() {
    return {
      gamma: state.gamma,
      modelBudget: state.modelBudget,
      order: state.order,
      edit: { state: D.FAR, action: 'right', reward: state.reward, next: state.next },
    };
  }
  function matched() {
    return {
      realOnly: D.run({ modelBudget: 0 }),
      accurate: D.run({}),
      wrong: D.run({ edit: { state: D.FAR, action: 'right', reward: D.LESSON.wrongReward } }),
    };
  }
  function noteMatched(pack) {
    const real = pack.realOnly;
    const accurate = pack.accurate;
    const wrong = pack.wrong;
    if (real.far.empty && real.realSteps === 2 && real.modelUpdates === 0) state.sawReal = true;
    if (!accurate.far.empty && accurate.far.value === 1 && accurate.modelUpdates === 6 && accurate.realSteps === 2) state.sawAccurate = true;
    if (!wrong.far.empty && wrong.far.value === 0 && wrong.probe.envReward === 1 && wrong.probe.modelReward === 0) state.sawWrong = true;
  }
  function noteEdit(current, accurate) {
    const edited = state.reward !== 1 || state.next !== D.GOAL;
    const followed = !current.far.empty && current.far.value !== accurate.far.value;
    if (edited && followed) state.sawEdit = true;
  }

  const api = {
    cancel() {},
    state: () => {
      const current = state.ran ? D.run(currentSpec()) : null;
      return {
        world: 'dyna', sentenceName: 'Real steps plus given-model backups', mode: 'campaign',
        level: level.title,
        knobs: {
          realSteps: D.REAL_BUDGET,
          modelUpdates: state.modelBudget,
          gamma: state.gamma,
          alpha: D.LESSON.alpha,
          order: state.order,
          farReward: state.reward,
          farNext: state.next,
        },
        words: {}, idleWords: {}, discovered: [],
        lastRun: current ? {
          seeds: 1,
          steps: current.realSteps + current.modelUpdates,
          symptoms: [],
          summary: 'Real steps ' + current.realSteps + '. Model updates ' + current.modelUpdates + '. Far right ' + show(current.far.value) + '.',
        } : null,
      };
    },
    run() {
      state.ran = true;
      advance(2);
      if (redraw) redraw();
      return D.run(currentSpec());
    },
    mount(pane, lab, passed) {
      hooks = passed || {};
      state.step = hooks.step ? hooks.step() : 0;
      state.finished = hooks.done ? hooks.done() : false;
      state.ran = state.step >= 2;
      if (state.finished) state.sawEdit = true;
      state.picks = {};
      for (const q of Object.values(QUESTIONS)) {
        const prev = hooks.answer ? hooks.answer(q.id) : null;
        if (prev) state.picks[q.id] = prev.choice;
      }
      const body = hWrap(hooks.h);
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const lessonNow = C.levels.find((item) => item.id === 'dyna');
        const n = C.levels.indexOf(lessonNow) + 1;
        const preview = D.run({ modelBudget: 0 });
        const pack = state.ran ? matched() : null;
        const current = state.ran ? D.run(currentSpec()) : null;
        if (pack && current) {
          noteMatched(pack);
          noteEdit(current, pack.accurate);
        }
        const why = {
          predict: [
            'The real trace writes ' + name(preview.real[0].state) + ' then ' + name(preview.real[1].state) + '. Far right stays ' + show(preview.far.value) + '.',
            'No update copies the goal reward into a cell that was not backed up.',
            'Discount changes a target only when a backup reads it. The far cell has no real backup yet.',
          ],
          diagnose: pack ? [
            'Accurate model updates: ' + pack.accurate.modelUpdates + '. Far right writes ' + show(pack.accurate.far.value) + '. The flipped reward writes ' + show(pack.wrong.far.value) + '. Real steps stay ' + pack.accurate.realSteps + '.',
            'The model rows for the far cell were already in the given table. The two real steps did not create them.',
            'The flipped row writes ' + show(pack.wrong.far.value) + ', so the update is not a copy of the true value 1.',
          ] : null,
          explain: pack ? [
            'Model updates 0 matches the real-only far cell: ' + show(pack.realOnly.far.value) + '. The reward-0 model writes ' + show(pack.wrong.far.value) + ' while the corridor probe still pays ' + pack.wrong.probe.envReward + '.',
            'Nothing in this run fits a network. The table you edit is the table the backup reads.',
            'A copy of the true corridor would keep far right at 1 after the reward flip. This backup does not.',
          ] : null,
        };
        function questionBlock(q, key, onAnswer) {
          const picked = state.picks[q.id];
          return h('div.mc', { id: q.id }, [
            h('p', { text: q.prompt }),
            ...q.options.map((opt, index) => h('button.opt' + (picked === index ? '.picked' : '') + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
              type: 'button',
              onclick: () => {
                state.picks[q.id] = index;
                if (hooks.record) hooks.record(q.id, index, !!opt.correct);
                onAnswer();
                redraw();
              },
            }, [
              h('span', { text: opt.text }),
              picked === index && why[key] ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + why[key][index] }) : null,
            ])),
          ]);
        }
        function control(id, label, pressed, onclick) {
          return h('button.btn' + (pressed ? '' : '.ghost'), {
            id: id, type: 'button', 'aria-pressed': pressed ? 'true' : 'false', onclick: onclick,
          }, label);
        }
        function summary(run, id, title) {
          return h('div.dyna-readout', {
            id: id,
            role: 'status',
            tabindex: '0',
            'data-far-empty': run.far.empty ? 'yes' : 'no',
            'data-far-value': show(run.far.value),
            'data-real-steps': String(run.realSteps),
            'data-model-updates': String(run.modelUpdates),
            'data-model-reward': String(run.probe.modelReward),
            'data-env-reward': String(run.probe.envReward),
            'data-env-next': name(run.probe.envNext),
            'data-model-next': name(run.probe.modelNext),
            'data-agrees': run.probe.agrees ? 'yes' : 'no',
            'data-learned': 'no',
            'data-order': run.order,
          }, [
            h('p', { text: title }),
            h('p', { text: 'Real steps ' + run.realSteps + '. Model updates ' + run.modelUpdates + '. Far right ' + show(run.far.value) + '. Model far-right reward ' + run.probe.modelReward + ', next ' + name(run.probe.modelNext) + '. Corridor far-right reward ' + run.probe.envReward + ', next ' + name(run.probe.envNext) + '. Agree: ' + (run.probe.agrees ? 'yes' : 'no') + '.' }),
          ]);
        }
        function board(run) {
          return h('div.dyna-track', { id: 'dyna-board' }, D.STATES.map((cell) => h('div.dyna-cell' + (cell === run.endState ? '.end' : '') + (cell === D.FAR ? '.far' : ''), {
            text: name(cell) + '\nright ' + show(run.values[cell].right) + '\nleft ' + show(run.values[cell].left),
          })));
        }
        function trace(run) {
          const rows = run.real.concat(run.modelTrace);
          return h('div.vpo-table', { id: 'dyna-trace', tabindex: '0', role: 'region', 'aria-label': 'Real steps and model updates' }, [
            h('table', null, [
              h('caption', { text: 'Initial values are empty. ' + run.realSteps + ' real steps, then ' + run.modelUpdates + ' model updates. Order: ' + run.order + '.' }),
              h('thead', null, h('tr', null, ['Source', 'Index', 'Cell', 'Action', 'Model next', 'Model reward', 'Corridor next', 'Corridor reward', 'Target', 'Written', 'Agree'].map((text) => h('th', { text: text })))),
              h('tbody', null, rows.map((row) => h('tr', null, [
                row.source,
                String(row.index),
                name(row.state),
                row.action,
                name(row.source === 'environment' ? row.modelNext : row.next),
                String(row.source === 'environment' ? row.modelReward : row.reward),
                name(row.source === 'environment' ? row.next : row.envNext),
                String(row.source === 'environment' ? row.reward : row.envReward),
                show(row.target),
                show(row.written),
                row.agrees ? 'yes' : 'no',
              ].map((text) => h('td', { text: text }))))),
            ]),
          ]);
        }
        const kids = [
          h('div.eyebrow', { text: 'Phase 8 · Level ' + n + ' · Four-cell corridor' }),
          h('h2', { text: lessonNow.title }),
          h('p', { text: lessonNow.intro }),
          h('p', { text: 'Right moves one cell toward the goal. Left moves one cell toward the start, and the start cell stays put. The goal pays 1 only when right is taken from the far cell. Every other transition pays 0. The goal ends the transition. Tie-break selects right. Step size is 1, so a backup replaces the cell with its target. Empty cells count as 0 inside a target and stay empty until a backup writes them.' }),
          h('p', { text: 'The one-step table is given. It starts equal to the corridor and then only changes when you edit a cell. Real steps do not train it. Model updates sample that table in a named sweep. The lesson sweep is far-to-near, right then left: far, mid, start, and right before left. One sweep is 6 updates. A second sweep is 12. Model updates 0 leaves the real-only table.' }),
          h('p', null, [
            'Source: CS 285 Spring 2026 lecture 16, ',
            h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-16.pdf', target: '_blank', rel: 'noopener' }, 'slides'),
            '. Heading used here: General Dyna-style model-based RL recipe. That slide says the recipe only requires short rollouts from the model, as few as one step, and still sees diverse states. The previous slide names Sutton\'s Dyna as an online Q-learning algorithm that performs model-free RL with a model. This page is that one-step table. It does not fit a neural dynamics model, it is not model-based policy optimization, and it is not the pendulum lesson that scores short rollouts on true physics.',
          ]),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'dyna-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you run' }),
            questionBlock(QUESTIONS.predict, 'predict', () => advance(1)),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'dyna-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Run the two real steps and the model updates' }),
          h('p', { text: 'The button runs the corridor for two steps, then the model sweep your controls select. The three comparison rows below stay on the lesson settings.' }),
          h('button.btn', { id: 'dyna-run', type: 'button', onclick: () => api.run() }, 'Take two real steps and update from the model'),
        ]));
        if (pack && current && state.step >= 2) {
          const sameReal = JSON.stringify(current.values) === JSON.stringify(pack.realOnly.values);
          const edited = state.reward !== 1 || state.next !== D.GOAL;
          kids.push(
            h('p', { id: 'dyna-counts', text: 'Your run: real steps ' + current.realSteps + ', model updates ' + current.modelUpdates + '. The counts are separate. Learned model: no.' }),
            summary(pack.realOnly, 'dyna-real', 'Real only. Model updates 0. Same two corridor steps.'),
            summary(pack.accurate, 'dyna-accurate', 'Accurate given model. Lesson sweep, 6 updates, discount 0.5.'),
            summary(pack.wrong, 'dyna-wrong', 'Wrong model. The far-right reward is flipped from 1 to 0. The corridor is unchanged.'),
            h('div.dyna-controls', { id: 'dyna-controls' }, [
              control('dyna-budget-0', '0 model updates', state.modelBudget === 0, () => { state.modelBudget = 0; redraw(); }),
              control('dyna-budget-1', '1 model update', state.modelBudget === 1, () => { state.modelBudget = 1; redraw(); }),
              control('dyna-budget-6', '6 model updates', state.modelBudget === 6, () => { state.modelBudget = 6; redraw(); }),
              control('dyna-budget-12', '12 model updates', state.modelBudget === 12, () => { state.modelBudget = 12; redraw(); }),
              control('dyna-order-far', 'Far to near', state.order === D.FAR_TO_NEAR, () => { state.order = D.FAR_TO_NEAR; redraw(); }),
              control('dyna-order-near', 'Near to far', state.order === D.NEAR_TO_FAR, () => { state.order = D.NEAR_TO_FAR; redraw(); }),
              control('dyna-gamma-0', 'Discount 0', state.gamma === 0, () => { state.gamma = 0; redraw(); }),
              control('dyna-gamma-half', 'Discount 0.5', state.gamma === 0.5, () => { state.gamma = 0.5; redraw(); }),
              control('dyna-gamma-1', 'Discount 1', state.gamma === 1, () => { state.gamma = 1; redraw(); }),
              control('dyna-reward-1', 'Far reward 1', state.reward === 1, () => { state.reward = 1; redraw(); }),
              control('dyna-reward-0', 'Far reward 0', state.reward === 0, () => { state.reward = 0; redraw(); }),
              control('dyna-reward-4', 'Far reward 4', state.reward === 4, () => { state.reward = 4; redraw(); }),
              control('dyna-next-goal', 'Far next goal', state.next === D.GOAL, () => { state.next = D.GOAL; redraw(); }),
              control('dyna-next-far', 'Far next far', state.next === D.FAR, () => { state.next = D.FAR; redraw(); }),
              control('dyna-next-mid', 'Far next mid', state.next === 1, () => { state.next = 1; redraw(); }),
            ]),
            h('p.small', { text: 'You control the model-update count, the sweep order, the discount, and the far cell\'s right-action reward and next cell. The corridor transitions and rewards are given. The starting table is given. Tie-break and step size are given.' }),
            summary(current, 'dyna-current', 'Your model. Order: ' + current.order + '. Discount ' + current.gamma + '.'),
            h('p.small', { id: 'dyna-edit-note', text: state.sawEdit
              ? 'Your edit changed the written far value from the accurate model\'s ' + show(pack.accurate.far.value) + ' to ' + show(current.far.value) + '.'
              : (sameReal
                ? 'Model updates 0 matches the real-only values. The far cell stays empty until a model update writes it.'
                : (edited
                  ? 'This edit has not changed the written far value yet. A new next cell whose backed-up value is still 0 leaves the target equal to the reward on the first sweep. Use 12 updates with far next far, or change the reward.'
                  : 'Change the far-right reward or next cell to see the written value follow the model.')) }),
            board(current),
            trace(current),
            h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'dyna-step-diagnose' }, [
              h('span.num', { text: 'Step 3' }),
              h('h3', { text: 'Inspect the update and the flipped model' }),
              questionBlock(QUESTIONS.diagnose, 'diagnose', () => advance(3)),
            ]),
          );
          const diagnose = QUESTIONS.diagnose.options[state.picks[QUESTIONS.diagnose.id]];
          if (state.step >= 3 && diagnose && diagnose.correct && state.sawEdit) {
            const explain = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
            const ready = state.sawReal && state.sawAccurate && state.sawWrong && state.sawEdit && explain && explain.correct;
            kids.push(
              h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'dyna-step-explain' }, [
                h('span.num', { text: 'Step 4' }),
                h('h3', { text: 'Explain the lesson' }),
                questionBlock(QUESTIONS.explain, 'explain', () => advance(4)),
              ]),
              h('button.btn', {
                id: 'dyna-complete', type: 'button',
                disabled: state.finished || !ready ? true : null,
                onclick: () => {
                  if (!ready || !hooks.complete) return;
                  hooks.complete();
                  state.finished = true;
                  state.step = 5;
                  redraw();
                },
              }, state.finished ? 'Lesson complete' : 'Finish lesson'),
            );
          } else if (state.step >= 3) {
            kids.push(h('p', { id: 'dyna-need-edit', text: 'Choose the backup that reads the model, then change a model entry until the written far value moves, before the explanation.' }));
          }
        }
        const next = C.levels[C.levels.indexOf(lessonNow) + 1];
        if (state.step >= 5) kids.push(next
          ? h('button.btn', { id: 'dyna-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
          : h('p.small', { id: 'dyna-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'dyna-rules' }, [
          h('h3', { text: 'Game rules · Four-cell corridor' }),
          h('dl', null, [
            ['Goal', 'Write the far cell from the given model after two real steps, and show that a wrong model entry changes that write.'],
            ['Reward each step', 'The corridor pays 1 for right from the far cell into the goal. Every other transition pays 0. The model can say a different reward. The corridor does not change.'],
            ['Equation', 'A backup writes old + step size * (target - old). Empty counts as old 0 and stays empty until written. The target is reward + discount * max next value, and the target is the reward alone when the next cell is the goal. Step size is 1.'],
            ['Given', 'The corridor, the real budget of two steps, tie-break right, step size 1, and the starting one-step table. That table is not fit from the two steps.'],
            ['Controlled', 'How many model updates you run (0, 1, 6, or 12), the sweep order, the discount, and the far cell\'s right-action reward and next cell in the model.'],
            ['Dynamics', 'Deterministic corridor. Right moves toward the goal. Left moves toward the start. Model updates imagine one step from the table. They do not move the agent and they do not call the corridor for the target.'],
            ['Episode ends', 'After two real steps, on the far cell in the lesson case. The goal is not reached by those two steps. Model updates continue on the table only.'],
            ['Score', 'The far cell\'s right-action value. Empty means no backup wrote it. A written 0 is a value, not an empty cell.'],
            ['Pass this challenge', lessonNow.goal.text],
          ].map(([nameText, text]) => h('div.rules-row', null, [h('dt', { text: nameText }), h('dd', { text: text })]))),
        ]));
      };
      redraw();
    },
  };
  function hWrap(h) { return h('div.card.stack', { id: 'dyna-lesson' }); }
  window.BBDYNA_LEVEL = api;
})(window.CONTENT, window.BBDYNA);
