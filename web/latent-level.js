// Lecture 16 latent read. The posterior is src/agents/latent.js.
// This file does not import the replan or Dyna lessons.
(function (C, L) {
  'use strict';
  if (!C || !L || !L.recommend) throw new Error('latent lesson requires CONTENT and BBLATENT');
  if (!C.phases.some((phase) => phase.n === 8)) C.phases.push({ n: 8, title: 'Learning through a world model' });
  C.worldNames.latent = 'Two payloads';
  const lessonGoal = 'On the sealed mark alone, leave the commit as a tie. When the probe returns red, commit the payload the fit associates with red. Swapping that association swaps the commit. A color the fit never saw, or a color both payloads share, stays a tie.';
  const level = {
    id: 'latent', custom: true, phase: 8, world: 'latent', title: 'Read the payload from the history', focus: [],
    intro: 'Two payloads, copper and glass, show the same sealed mark before any probe. Records used for the fit name the payload and the probe color. At test time the payload is hidden. The commit is the mode of the posterior of the history under that fitted table.',
    goal: { text: lessonGoal },
  };
  if (!C.levels.some((item) => item.id === 'latent')) {
    const replanAt = C.levels.findIndex((item) => item.id === 'replan');
    if (replanAt >= 0) C.levels.splice(replanAt, 0, level);
    else C.levels.push(level);
  }

  const QUESTIONS = {
    predict: {
      id: 'latent-p',
      prompt: 'Both payloads have shown only the sealed mark. The fit has seen red with copper and blue with glass. What should the commit do?',
      options: [
        { text: 'Stay a tie. The posterior is one half each, and this lesson does not pick a payload.', correct: true },
        { text: 'Pick copper, because copper is the first payload in the table.', correct: false },
        { text: 'Pick the payload a planner was handed. The sealed mark is enough once that id is known.', correct: false },
      ],
    },
    diagnose: {
      id: 'latent-d',
      prompt: 'The commit stayed a tie. What did that history contain?',
      options: [
        { text: 'Only the sealed mark. That mark is in every fitted record, so the two payloads stay one half each.', correct: true },
        { text: 'The probe color red. Red already names copper, and the tie is a display bug.', correct: false },
        { text: 'The payload id. The planner received it and chose the tie on purpose.', correct: false },
      ],
    },
    explain: {
      id: 'latent-x',
      prompt: 'The probe returns red. What does a correct commit use, and what does it refuse?',
      options: [
        { text: 'The posterior from the fitted counts and this history. The payload id is not an input. Copying the mark would still say red. This table is not a neural state-space model, and it is not replanning on an observed corridor.', correct: true },
        { text: 'The current mark. The latent is red, so the commit is red.', correct: false },
        { text: 'A neural state-space model of the whole course. The table is only a check that the network trained.', correct: false },
      ],
    },
  };

  const state = {
    step: 0, picks: {}, finished: false, mode: 'lesson', probe: 'sealed',
    sawTie: false, sawMatch: false, sawSwap: false, sawUnseen: false, sawAmbiguous: false,
  };
  let hooks = {}, redraw = null;

  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function recordsFor(mode) {
    if (mode === 'swapped') return L.swapObservations(L.lessonRecords(), 'red', 'blue');
    if (mode === 'ambiguous') return L.ambiguousRecords();
    if (mode === 'unseen') return L.unseenRecords();
    return L.lessonRecords();
  }
  function fmt(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 'missing';
    return (Math.round(x * 10000) / 10000).toFixed(4);
  }
  function commitName(result) { return result.commit == null ? 'tie' : result.commit; }
  function noteFlags(records, history, result) {
    const other = L.recommend(records, history, { payload: 'glass' });
    const same = result.commit === other.commit
      && result.posterior.copper === other.posterior.copper
      && result.posterior.glass === other.posterior.glass;
    if (result.tie && history.length === 1 && history[0] === 'sealed' && state.mode === 'lesson') state.sawTie = true;
    if (state.mode === 'lesson' && state.probe === 'red' && result.commit === 'copper' && L.associated(records, 'red') === 'copper') state.sawMatch = true;
    if (state.mode === 'swapped' && state.probe === 'red' && result.commit === 'glass') state.sawSwap = true;
    if (state.mode === 'unseen' && state.probe === 'red' && result.tie && result.skipped.indexOf('red') >= 0) state.sawUnseen = true;
    if (state.mode === 'ambiguous' && state.probe === 'red' && result.tie) state.sawAmbiguous = true;
    return same;
  }
  function setMode(mode) {
    state.mode = mode;
    if (mode === 'unseen' || mode === 'ambiguous') state.probe = 'red';
    advance(4);
    if (redraw) redraw();
  }
  function setProbe(probe) {
    state.probe = probe;
    advance(4);
    if (redraw) redraw();
  }

  const api = {
    cancel() {},
    state: () => {
      const records = recordsFor(state.mode);
      const history = L.historyOf(state.probe);
      const result = state.step >= 2 ? L.recommend(records, history) : null;
      return {
        world: 'latent', sentenceName: 'Posterior from a fitted observation table', mode: 'campaign',
        level: 'Read the payload from the history',
        knobs: { mode: state.mode, probe: state.probe },
        words: {}, idleWords: {}, discovered: [],
        lastRun: result ? {
          seeds: 1, steps: history.length, symptoms: [],
          summary: 'Commit ' + commitName(result) + '.',
        } : null,
      };
    },
    run() {
      state.mode = 'lesson';
      state.probe = 'sealed';
      const result = L.recommend(L.lessonRecords(), ['sealed'], { payload: 'copper' });
      if (result.tie && result.commit == null) state.sawTie = true;
      advance(2);
      if (redraw) redraw();
      return result;
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
      if (state.finished) {
        state.sawTie = true;
        state.sawMatch = true;
        state.sawSwap = true;
        state.sawUnseen = true;
        state.sawAmbiguous = true;
        state.mode = 'lesson';
        state.probe = 'red';
      }
      const body = hWrap(hooks.h);
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const lesson = C.levels.find((item) => item.id === 'latent');
        const records = recordsFor(state.mode);
        const history = L.historyOf(state.probe);
        const live = state.step >= 2 ? L.recommend(records, history, { payload: 'copper' }) : null;
        const same = live ? noteFlags(records, history, live) : false;
        const mark = L.copyMark(history);
        const oracleCopper = L.oracleCommit('copper');
        const oracleGlass = L.oracleCommit('glass');
        const redLesson = L.recommend(L.lessonRecords(), L.historyOf('red'));
        const redSwap = L.recommend(L.swapObservations(L.lessonRecords(), 'red', 'blue'), L.historyOf('red'));
        const redUnseen = L.recommend(L.unseenRecords(), L.historyOf('red'));
        const redAmbiguous = L.recommend(L.ambiguousRecords(), L.historyOf('red'));
        const tie = L.recommend(L.lessonRecords(), ['sealed'], { payload: 'glass' });
        const why = {
          predict: [
            'Fresh posterior on the sealed mark: copper ' + fmt(tie.posterior.copper) + ', glass ' + fmt(tie.posterior.glass) + '. Commit ' + commitName(tie) + '. A handed payload of glass does not change it.',
            'The first row is not a commit rule. The mode of a tie is not copper.',
            'Handed copper, the id planner would commit ' + oracleCopper + '. Handed glass, it would commit ' + oracleGlass + '. Neither call is the history posterior.',
          ],
          diagnose: [
            'The history is ' + tie.history.join(', ') + '. Both fitted rows contain sealed, so the likelihoods match and the posterior stays one half each.',
            'Red is not in this history. On the lesson fit, red commits ' + commitName(redLesson) + ', which is a later query.',
            'The run calls the history posterior. It does not call the id planner.',
          ],
          explain: [
            'Lesson fit, history sealed then red: commit ' + commitName(redLesson) + ', posterior copper ' + fmt(redLesson.posterior.copper) + '. Swapped colors, same history: commit ' + commitName(redSwap) + '. The current mark is ' + L.copyMark(L.historyOf('red')) + ', which is not that commit. Unseen red stays ' + commitName(redUnseen) + '. Shared red stays ' + commitName(redAmbiguous) + '.',
            'Copying the mark returns red. The payload names are copper and glass. Red is an observation.',
            'Nothing on this page trains a network. The posterior is the normalized product of the fitted frequencies.',
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
        function readout(result) {
          const name = commitName(result);
          return h('div', {
            id: 'latent-readout',
            role: 'status',
            tabindex: '0',
            'data-commit': name,
            'data-tie': result.tie ? 'yes' : 'no',
            'data-copper': fmt(result.posterior.copper),
            'data-glass': fmt(result.posterior.glass),
            'data-history': result.history.join(','),
            'data-mode': state.mode,
            'data-probe': state.probe,
            'data-skipped': result.skipped.join(','),
            'data-mark': mark == null ? 'none' : mark,
            'data-same': same ? 'yes' : 'no',
            'data-oracle-copper': oracleCopper,
            'data-oracle-glass': oracleGlass,
            'data-associated': L.associated(records, state.probe === 'sealed' ? 'sealed' : state.probe) || 'none',
          }, [
            h('p', { text: 'History: ' + result.history.join(', ') + '. Posterior copper ' + fmt(result.posterior.copper) + ', glass ' + fmt(result.posterior.glass) + '. Commit: ' + name + '.' }),
            h('p', { text: 'The same history with a handed payload of glass gives commit ' + commitName(L.recommend(records, history, { payload: 'glass' })) + '. The two history commits agree: ' + (same ? 'yes' : 'no') + '.' }),
            h('p', { text: 'A planner handed copper would commit ' + oracleCopper + '. A planner handed glass would commit ' + oracleGlass + '. Those commits are not used.' }),
            h('p', { text: 'A latent that copies the current mark reads ' + mark + '. That string is the latest observation, not the commit ' + name + '.' }),
            result.skipped.length ? h('p', { text: 'Skipped, because the fit has no count: ' + result.skipped.join(', ') + '.' }) : null,
          ]);
        }
        function tableOf() {
          const observations = ['sealed', 'red', 'blue', 'green'];
          return h('div.vpo-table', { id: 'latent-table', tabindex: '0', role: 'region', 'aria-label': 'Fitted observation counts' }, [
            h('table', null, [
              h('caption', { text: 'Counts in the fit selected above. The query does not add the hidden payload.' }),
              h('thead', null, h('tr', null, ['Payload', 'Sealed', 'Red', 'Blue', 'Green'].map((text) => h('th', { text })))),
              h('tbody', null, L.PAYLOADS.map((payload) => h('tr', null, [
                payload,
                ...observations.map((obs) => {
                  const cell = L.counts(records, obs)[payload];
                  return cell.count + '/' + cell.total;
                }),
              ].map((text) => h('td', { text }))))),
            ]),
          ]);
        }
        const readyFlags = state.sawTie && state.sawMatch && state.sawSwap && state.sawUnseen && state.sawAmbiguous;
        const explainPick = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
        const ready = readyFlags && explainPick && explainPick.correct;
        const kids = [
          h('div.eyebrow', { text: 'Phase 8 · Level ' + (C.levels.indexOf(lesson) + 1) + ' · Two payloads' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', { text: 'Each lesson record is one payload plus the observations sealed and one probe color. Copper is recorded with red twice. Glass is recorded with blue twice. The prior is uniform. A color with count 0 on both payloads is left out of the product, so it does not move the posterior.' }),
          h('p', null, [
            'Source: CS 285 Spring 2026 lecture 16, ',
            h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-16.pdf', target: '_blank', rel: 'noopener' }, 'slides'),
            '. Headings used here: Latent state space models, and State space (latent space) models. This page computes a discrete posterior from the fitted counts. It does not train a neural state-space model. It does not replan a corridor whose cell is already observed. It does not cover the rest of lecture 16.',
          ]),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'latent-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you run' }),
            questionBlock(QUESTIONS.predict, 'predict', () => advance(1)),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'latent-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Run the sealed history' }),
          h('p', { text: 'The history is only the sealed mark. The payload id is not passed into the commit.' }),
          h('button.btn', { id: 'latent-run', type: 'button', onclick: () => api.run() }, 'Score the sealed history'),
        ]));
        if (live && state.step >= 2 && state.step < 4) kids.push(readout(live));
        if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'latent-step-diagnose' }, [
          h('span.num', { text: 'Step 3' }),
          h('h3', { text: 'Diagnose' }),
          questionBlock(QUESTIONS.diagnose, 'diagnose', () => advance(3)),
        ]));
        if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'latent-step-repair' }, [
          h('span.num', { text: 'Step 4' }),
          h('h3', { text: 'Repair: commit from the fitted table' }),
          h('p', { text: 'Each button scores the current records and the current history. Swap red and blue, drop red from the fit, or give both payloads red, and the commit follows those counts.' }),
          h('div.latent-controls', { id: 'latent-controls' }, [
            control('latent-probe-sealed', 'Sealed mark only', state.probe === 'sealed', () => setProbe('sealed')),
            control('latent-probe-red', 'Probe returns red', state.probe === 'red', () => setProbe('red')),
            control('latent-probe-blue', 'Probe returns blue', state.probe === 'blue', () => setProbe('blue')),
            control('latent-probe-green', 'Probe returns green', state.probe === 'green', () => setProbe('green')),
            control('latent-fit-lesson', 'Lesson fit', state.mode === 'lesson', () => setMode('lesson')),
            control('latent-fit-swap', 'Swap red and blue', state.mode === 'swapped', () => setMode('swapped')),
            control('latent-fit-unseen', 'Fit never saw red', state.mode === 'unseen', () => setMode('unseen')),
            control('latent-fit-ambiguous', 'Both payloads probe red', state.mode === 'ambiguous', () => setMode('ambiguous')),
          ]),
        ]));
        if (live && state.step >= 4) {
          kids.push(
            readout(live),
            tableOf(),
            h('p', { id: 'latent-flags', text: 'Tie on the sealed mark: ' + (state.sawTie ? 'yes' : 'not yet') + '. Red matched the lesson fit: ' + (state.sawMatch ? 'yes' : 'not yet') + '. Swap changed the commit: ' + (state.sawSwap ? 'yes' : 'not yet') + '. Unseen red stayed mixed: ' + (state.sawUnseen ? 'yes' : 'not yet') + '. Shared red stayed mixed: ' + (state.sawAmbiguous ? 'yes' : 'not yet') + '.' }),
            h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'latent-step-explain' }, [
              h('span.num', { text: 'Step 5' }),
              h('h3', { text: 'Explain why it works' }),
              readyFlags ? questionBlock(QUESTIONS.explain, 'explain', () => {}) : h('p', { text: 'Score red on the lesson fit, swap the colors, score a fit that never saw red, and score a fit where both payloads probe red before answering.' }),
            ]),
            h('button.btn', {
              id: 'latent-complete', type: 'button',
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
          ? h('button.btn', { id: 'latent-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
          : h('p.small', { id: 'latent-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'latent-rules' }, [
          h('h3', { text: 'Game rules · Two payloads' }),
          h('dl', null, [
            ['Goal', 'Name the payload only when the history posterior has a single mode. A tie commits to neither payload.'],
            ['Reward each step', 'No reward is learned. The fit is a count of observations per payload.'],
            ['Equation', 'Posterior proportional to the uniform prior times the fitted frequency of each observation in the history. A frequency of 0 on every payload skips that observation.'],
            ['Observations', 'Before a probe, both payloads show sealed. Lesson probes: red with copper, blue with glass, two records each.'],
            ['Hidden payload', 'The commit reads the history and the counts. A payload id handed to the planner is ignored.'],
            ['Episode ends', 'After the sealed mark, or after one probe color. There is no corridor and no second plan.'],
            ['Score', 'The posterior and the commit. Tie, or the payload name the counts support.'],
            ['Pass this challenge', lesson.goal.text],
          ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text })]))),
        ]));
      };
      redraw();
    },
  };
  function hWrap(h) { return h('div.card.stack', { id: 'latent-lesson' }); }
  window.BBLATENT_LEVEL = api;
})(window.CONTENT, window.BBLATENT);
