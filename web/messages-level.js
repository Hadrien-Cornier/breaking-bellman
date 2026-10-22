// Backward messages on a known three-cell line. The backup is src/agents/messages.js.
// This file does not import the reward-fit, ELBO, or replan lessons.
(function (C, M) {
  'use strict';
  if (!C || !M || !M.solve) throw new Error('messages lesson requires CONTENT and BBMESSAGES');
  C.worldNames.messages = 'Three cells';
  const lessonGoal = 'See the prior-only walk miss the right cell, then recompute the backward messages so the conditioned walk reaches it. A stronger prior, a horizon of 1, or a prior of 0 on right must be allowed to miss.';
  const level = {
    id: 'messages', custom: true, phase: 3, world: 'messages', title: 'Pass the message back', focus: [],
    intro: 'Three cells, a known transition table, and an action prior that prefers left. The goal is the right cell. Planning here is a backward message, then a conditioned action probability that still contains the prior.',
    goal: { text: lessonGoal },
  };
  const exploreAt = C.levels.findIndex((l) => l.id === 'explore');
  if (exploreAt >= 0) C.levels.splice(exploreAt + 1, 0, level);
  else {
    let at = -1;
    C.levels.forEach((item, index) => { if (item.phase === 3) at = index; });
    if (at >= 0) C.levels.splice(at + 1, 0, level);
    else C.levels.push(level);
  }

  const NAMES = ['left', 'mid', 'right'];
  const cellName = (state) => NAMES[state] || String(state);
  const fmt = (x) => (x == null || !Number.isFinite(x) ? 'undefined' : (Math.round(x * 10000) / 10000).toFixed(4));
  const samePrior = (prior, other) => prior.left === other.left && prior.right === other.right;
  const lessonPrior = M.LESSON.prior;
  function isLessonCase(result) {
    return result.goal === M.LESSON.goal && result.horizon === M.LESSON.horizon && result.start === M.LESSON.start
      && samePrior(result.prior, lessonPrior) && result.policy === 'conditioned';
  }
  const QUESTIONS = {
    predict: {
      id: 'messages-p',
      prompt: 'The action prior is 0.70 on left and 0.30 on right. You follow only its mode for 2 steps, from the left cell. The goal is the right cell. Where does that walk end?',
      options: [
        { text: 'The left cell. Left from the left cell stays there, so the mode never takes right.', correct: true },
        { text: 'The right cell. Naming the goal rewrites the prior.', correct: false },
        { text: 'The middle cell. The two prior probabilities are averaged into one move.', correct: false },
      ],
    },
    diagnose: {
      id: 'messages-d',
      prompt: 'The prior-only walk missed the right cell. What did that roll leave out?',
      options: [
        { text: 'The backward message. The roll used the prior mode and did not multiply by the message.', correct: true },
        { text: 'The dynamics. Left is the only legal transition in the table.', correct: false },
        { text: 'A fitted reward. Demonstrations in this lesson prefer left.', correct: false },
      ],
    },
    explain: {
      id: 'messages-x',
      prompt: 'What is the conditioned probability, and what does a prior of 0.95 on left do here?',
      options: [
        { text: 'It multiplies the prior by the raw message and normalizes. With 0.95 on left, the raw message still prefers right and the conditioned mode stays left.', correct: true },
        { text: 'Any prior above zero is erased, so the mode becomes right.', correct: false },
        { text: 'The repair stores the path right, then right, because the goal cell is on the right.', correct: false },
      ],
    },
  };
  const state = {
    step: 0, picks: {}, finished: false, prior: Object.assign({}, lessonPrior), goal: M.LESSON.goal,
    horizon: M.LESSON.horizon, priorRun: null, live: null, sawLesson: false, sawMiss: false,
  };
  let hooks = {}, redraw = null;

  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function currentSpec(policy) {
    return M.lessonModel({
      prior: Object.assign({}, state.prior),
      goal: state.goal,
      horizon: state.horizon,
      policy: policy || 'conditioned',
    });
  }
  function recompute() {
    const result = M.solve(currentSpec('conditioned'));
    state.live = result;
    if (isLessonCase(result) && result.reached) state.sawLesson = true;
    if (!result.reached || result.impossible) state.sawMiss = true;
    advance(4);
    if (redraw) redraw();
    return result;
  }
  function setPrior(prior) {
    state.prior = Object.assign({}, prior);
    recompute();
  }
  function setGoal(goal) {
    state.goal = goal;
    recompute();
  }
  function setHorizon(horizon) {
    state.horizon = horizon;
    recompute();
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'messages', sentenceName: 'Backward message times action prior', mode: 'campaign',
      level: 'Pass the message back',
      knobs: { horizon: state.horizon, goal: state.goal, priorLeft: state.prior.left, miss: M.LESSON.miss },
      words: {}, idleWords: {}, discovered: [],
      lastRun: state.live ? {
        seeds: 1, steps: state.live.horizon, symptoms: [],
        summary: 'Conditioned end ' + (state.live.end == null ? 'undefined' : cellName(state.live.end)) + '.',
      } : null,
    }),
    run() {
      state.priorRun = M.solve(M.lessonModel({ policy: 'prior' }));
      advance(2);
      if (redraw) redraw();
      return state.priorRun;
    },
    mount(pane, lab, passed) {
      hooks = passed || {};
      state.step = hooks.step ? hooks.step() : 0;
      state.finished = hooks.done ? hooks.done() : false;
      state.picks = {};
      for (const q of Object.values(QUESTIONS)) {
        const prev = hooks.answer ? hooks.answer(q.id) : null;
        if (prev) state.picks[q.id] = prev.choice;
      }
      if (state.step >= 2) state.priorRun = M.solve(M.lessonModel({ policy: 'prior' }));
      if (state.step >= 4) {
        state.prior = Object.assign({}, lessonPrior);
        state.goal = M.LESSON.goal;
        state.horizon = M.LESSON.horizon;
        state.live = M.solve(M.lessonModel());
        if (state.live.reached) state.sawLesson = true;
        if (state.finished) state.sawMiss = true;
      }
      const body = hWrap(hooks.h);
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const lesson = C.levels.find((item) => item.id === 'messages');
        const priorWalk = M.solve(M.lessonModel({ policy: 'prior' }));
        const strong = M.solve(M.lessonModel({ prior: M.STRONG_PRIOR }));
        const strongRow = strong.rows.find((item) => item.t === 1 && item.state === 0 && item.action === 'left');
        const why = {
          predict: [
            'The prior mode is left. Left from the left cell stays on the left cell. The walk is ' + priorWalk.path.map(cellName).join(', ') + '. Reached the goal: ' + (priorWalk.reached ? 'yes' : 'no') + '.',
            'The goal is not inside the prior. This roll never reads it.',
            'The mode picks one action. It does not average 0.70 and 0.30 into a move that stops in the middle.',
          ],
          diagnose: [
            'The prior-only policy reads p(a). It does not read beta. Right has prior 0.30, so it is not the mode.',
            'Right from the left cell is in the table. It moves to the middle cell with probability 1.',
            'There are no demonstrations and no reward weights. The prior was given.',
          ],
          explain: [
            'At time 1 on the left cell, the strong prior still has raw message higher on right, and conditioned probability of left is ' + fmt(strongRow.posterior) + '. The mode stays left. Nothing was stored as a path.',
            'The strong-prior roll ends at ' + cellName(strong.end) + '. The message did not delete the prior.',
            'Each repair calls the backup again. Changing the goal, the prior, or the horizon changes that backup.',
          ],
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
                onAnswer(opt);
                redraw();
              },
            }, [
              h('span', { text: opt.text }),
              picked === index ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + why[key][index] }) : null,
            ])),
          ]);
        }
        function control(id, label, pressed, onclick) {
          return h('button.btn' + (pressed ? '' : '.ghost'), {
            id, type: 'button', 'aria-pressed': pressed ? 'true' : 'false', onclick,
          }, label);
        }
        function readout(result, id) {
          const startLeft = result.rows.find((item) => item.t === 1 && item.state === result.start && item.action === 'left');
          const startRight = result.rows.find((item) => item.t === 1 && item.state === result.start && item.action === 'right');
          const defined = startLeft && startLeft.defined;
          return h('div', {
            id,
            role: 'status',
            tabindex: '0',
            'data-reached': result.reached ? 'yes' : 'no',
            'data-impossible': result.impossible ? 'yes' : 'no',
            'data-end': result.end == null ? 'none' : String(result.end),
            'data-path': result.path ? result.path.join(',') : '',
            'data-actions': result.steps.map((step) => step.action || 'none').join(','),
            'data-beta-left': fmt(startLeft && startLeft.beta),
            'data-beta-right': fmt(startRight && startRight.beta),
            'data-pi-left': fmt(startLeft && startLeft.posterior),
            'data-pi-right': fmt(startRight && startRight.posterior),
            'data-defined': defined ? 'yes' : 'no',
            'data-horizon': String(result.horizon),
            'data-goal': String(result.goal),
            'data-prior-left': String(result.prior.left),
            'data-deterministic': result.deterministic ? 'yes' : 'no',
            'data-sequences': String(result.sequences),
            'data-saw-lesson': state.sawLesson ? 'yes' : 'no',
            'data-saw-miss': state.sawMiss ? 'yes' : 'no',
          }, [
            h('p', { text: 'Policy: ' + result.policy + '. Horizon: ' + result.horizon + ' action time' + (result.horizon === 1 ? '' : 's') + '. Goal cell: ' + cellName(result.goal) + '. Prior left ' + fmt(result.prior.left) + ', right ' + fmt(result.prior.right) + '. Sequences in the finite list: ' + result.sequences + '.' }),
            h('p', { text: result.path ? 'Path: ' + result.path.map(cellName).join(', ') + '. Reached the goal: ' + (result.reached ? 'yes' : 'no') + '.' : 'No complete path. A state message is 0, so the conditioned probability is undefined. It is not replaced with the prior or with a path to the goal.' }),
            startLeft ? h('p', { text: 'Time 1 at ' + cellName(result.start) + '. Raw message left ' + fmt(startLeft.beta) + ', right ' + fmt(startRight.beta) + '. Prior left ' + fmt(startLeft.prior) + ', right ' + fmt(startRight.prior) + '. Conditioned left ' + fmt(startLeft.posterior) + ', right ' + fmt(startRight.posterior) + '. State message ' + fmt(startLeft.betaState) + '. Defined: ' + (defined ? 'yes' : 'no') + '.' }) : null,
          ]);
        }
        function board(path) {
          const last = path ? path[path.length - 1] : null;
          return h('div.msg-track', { id: 'messages-board' }, [0, 1, 2].map((index) => h('div.msg-cell' + (index === last ? '.end' : path && path.includes(index) ? '.on' : ''), { text: cellName(index) })));
        }
        function tableOf(result) {
          const undefinedAt = result.normalizers.filter((item) => !item.defined);
          return h('div.vpo-table', { id: 'messages-table', tabindex: '0', role: 'region', 'aria-label': 'Backward messages by time and cell' }, [
            h('table', null, [
              h('caption', { text: 'Backup for the controls above. ' + result.rows.length + ' action rows. ' + result.sequences + ' action sequences from the start.' }),
              h('thead', null, h('tr', null, ['Time', 'Cell', 'Action', 'Next', 'p(O|s,a)', 'Raw message', 'Prior', 'State message', 'Conditioned'].map((text) => h('th', { text })))),
              h('tbody', null, result.rows.map((item) => h('tr', null, [
                String(item.t), cellName(item.state), item.action,
                item.transition.map((next) => cellName(next.state) + ' ' + fmt(next.prob)).join(', '),
                fmt(item.factor), fmt(item.beta), fmt(item.prior), fmt(item.betaState), fmt(item.posterior),
              ].map((text) => h('td', { text }))))),
            ]),
            h('p.small', { text: undefinedAt.length
              ? 'Undefined conditioned distribution at ' + undefinedAt.map((item) => 'time ' + item.t + ' ' + cellName(item.state)).join('; ') + '. The state message is 0. No division is performed.'
              : 'Every conditioned distribution in this table is defined and sums to 1.' }),
          ]);
        }
        const kids = [
          h('div.eyebrow', { text: 'Phase 3 · Level ' + (C.levels.indexOf(lesson) + 1) + ' · Three cells' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', { text: 'The line is deterministic. Left from the left cell stays there. Right moves one cell toward the right, and stops on the right cell. The other direction is symmetric. Each of those outcomes has probability 1. A noisy transition is a different sum, and this page does not claim that sum solves stochastic optimal control.' }),
          h('p', { text: 'The action prior on the lesson case is 0.70 left and 0.30 right at every cell. After the last action, the goal likelihood is 1 on the goal cell and 0.05 on each other cell. At each action, p(O | s, a) is 1. The raw message is that product. The conditioned probability multiplies the raw message by the prior and divides by the state message. A prior of 0 stays 0.' }),
          h('p', null, [
            'Source: CS 285 Spring 2026 lecture 12, ',
            h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-12.pdf', target: '_blank', rel: 'noopener' }, 'slides'),
            '. Headings used here: Inference = planning, Backward messages, The action prior, and Policy computation. The slide A closer look at the backward pass says "optimistic transition (not a good idea!)". This page uses the given table instead. The action-prior slide says a non-uniform prior can be folded into the reward. This page does not fold it. Levine (2018), section 2.3, equation (6), is the backup in probability, with the prior outside the raw message. That paper says the stochastic backup is risk-seeking. This deterministic table is not that case. This is not a variational autoencoder, not the reparameterization trick, and not inverse reinforcement learning.',
          ]),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'messages-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you run' }),
            questionBlock(QUESTIONS.predict, 'predict', () => advance(1)),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'messages-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Run the prior only' }),
          h('p', { text: 'Two action times. The mode of the prior is left. The goal and the messages are not read.' }),
          h('button.btn', { id: 'messages-run', type: 'button', onclick: () => api.run() }, 'Roll the prior-only policy'),
        ]));
        if (state.priorRun && state.step >= 2) kids.push(
          board(state.priorRun.path),
          readout(state.priorRun, 'messages-prior-readout'),
        );
        if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'messages-step-diagnose' }, [
          h('span.num', { text: 'Step 3' }),
          h('h3', { text: 'Diagnose' }),
          questionBlock(QUESTIONS.diagnose, 'diagnose', () => advance(3)),
        ]));
        if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'messages-step-repair' }, [
          h('span.num', { text: 'Step 4' }),
          h('h3', { text: 'Repair: pass the messages, then multiply by the prior' }),
          h('p', { text: 'The button runs the backup on the current prior, goal, and horizon. It does not look up a stored path. The lesson case is prior 0.70, goal on the right, horizon 2.' }),
          h('button.btn', { id: 'messages-repair', type: 'button', onclick: () => recompute() }, 'Recompute the backward messages'),
        ]));
        if (state.live && state.step >= 4) {
          const explainPick = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
          const ready = state.sawLesson && state.sawMiss && explainPick && explainPick.correct;
          kids.push(
            h('div.msg-controls', { id: 'messages-controls' }, [
              control('messages-prior-lesson', 'Prior 0.70 left', samePrior(state.prior, lessonPrior), () => setPrior(lessonPrior)),
              control('messages-prior-strong', 'Prior 0.95 left', samePrior(state.prior, M.STRONG_PRIOR), () => setPrior(M.STRONG_PRIOR)),
              control('messages-prior-zero', 'Prior 0 on right', samePrior(state.prior, M.ZERO_RIGHT), () => setPrior(M.ZERO_RIGHT)),
              control('messages-goal-right', 'Goal on the right', state.goal === 2, () => setGoal(2)),
              control('messages-goal-left', 'Goal on the left', state.goal === 0, () => setGoal(0)),
              control('messages-horizon-2', 'Horizon 2', state.horizon === 2, () => setHorizon(2)),
              control('messages-horizon-1', 'Horizon 1', state.horizon === 1, () => setHorizon(1)),
            ]),
            h('p.small', { text: 'Horizon 1 from the left cell has no transition into the right cell. A prior of 0 on right leaves the raw message unchanged and sets the conditioned probability to 0. A prior of 0.95 on left can keep the conditioned mode on left. Return to the lesson case to see the reach again.' }),
            board(state.live.path),
            readout(state.live, 'messages-readout'),
            tableOf(state.live),
            h('p', { text: 'Lesson case reached: ' + (state.sawLesson ? 'yes' : 'not yet') + '. A setting with no reach, or with an undefined conditioned probability, has been computed: ' + (state.sawMiss ? 'yes' : 'not yet') + '.' }),
            h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'messages-step-explain' }, [
              h('span.num', { text: 'Step 5' }),
              h('h3', { text: 'Explain why it works' }),
              state.sawLesson && state.sawMiss ? questionBlock(QUESTIONS.explain, 'explain', () => {}) : h('p', { text: 'Recompute the lesson case and one setting that misses before answering.' }),
            ]),
            h('button.btn', {
              id: 'messages-complete', type: 'button',
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
        }
        const next = C.levels[C.levels.indexOf(lesson) + 1];
        if (state.step >= 5) kids.push(next
          ? h('button.btn', { id: 'messages-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
          : h('p.small', { id: 'messages-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'messages-rules' }, [
          h('h3', { text: 'Game rules · Three cells' }),
          h('dl', null, [
            ['Goal', 'End on the goal cell after the horizon. The lesson goal is the right cell.'],
            ['Reward each step', 'No reward is learned. p(O | s, a) is 1 at each action. After the last action the goal likelihood is 1 on the goal and 0.05 elsewhere.'],
            ['Equation', 'beta(s, a) = p(O | s, a) * sum over next cells of P(next | s, a) * beta(next). beta(s) = sum over a of prior(a | s) * beta(s, a). Conditioned probability = prior * beta(s, a) / beta(s) when beta(s) > 0.'],
            ['Dynamics', 'Deterministic table. One next cell has probability 1. The stochastic backup from the same equation is a different, optimistic case and is not solved here.'],
            ['Prior', 'Lesson case: 0.70 left, 0.30 right. The mode of the prior is left. A zero prior stays zero in the conditioned probability.'],
            ['Episode ends', 'After 2 actions in the lesson case, or after the horizon you select. The start cell is the left cell.'],
            ['Score', 'Reached the goal, yes or no. The raw message and the conditioned probability are both shown. Their normalizer is shown when it exists.'],
            ['Pass this challenge', lesson.goal.text],
          ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text })]))),
        ]));
      };
      redraw();
    },
  };
  function hWrap(h) { return h('div.card.stack', { id: 'messages-lesson' }); }
  window.BBMESSAGES_LEVEL = api;
})(window.CONTENT, window.BBMESSAGES);
