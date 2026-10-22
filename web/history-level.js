// One junction, two arrivals. Counts come from src/agents/history.js.
// This file does not import the goals lesson, the shift lesson, or meta-RL.
(function (C, H) {
  'use strict';
  if (!C || !H || !H.fit) throw new Error('history lesson requires CONTENT and BBHISTORY');
  if (!C.phases.some((phase) => phase.n === 0)) C.phases.unshift({ n: 0, title: 'Imitation before reward' });
  C.worldNames.history = 'Two lanes';
  const lessonGoal = 'See the junction tie send one arrival the wrong way, then count the previous room so each arrival follows its own notes. Erasing that room must bring the tie back.';
  const historyLevel = {
    id: 'history', custom: true, phase: 0, world: 'history', title: 'The previous room is part of the state', focus: [],
    intro: 'Two lanes enter one junction. Notes that arrived from the west then go west. Notes that arrived from the east then go east. The two junction counts are equal.',
    goal: { text: lessonGoal },
  };
  if (!C.levels.some((level) => level.id === 'history')) {
    const goalsAt = C.levels.findIndex((level) => level.id === 'goals');
    if (goalsAt >= 0) C.levels.splice(goalsAt + 1, 0, historyLevel);
    else C.levels.unshift(historyLevel);
  }

  const LABEL = {
    'west-door': 'west door', 'west-lane': 'west lane', junction: 'junction',
    'east-lane': 'east lane', 'east-door': 'east door', 'west-exit': 'west exit', 'east-exit': 'east exit',
    west: 'west', east: 'east',
  };
  const label = (id) => LABEL[id] || id;
  const QUESTIONS = {
    predict: {
      id: 'history-p',
      prompt: 'You are at the junction. The count can see the junction and not the previous room. The notes from each lane are equal. Which action does it take?',
      options: [
        { text: 'The first action in the list. The counts tie, so that rule picks, and one arrival is wrong.', correct: true },
        { text: 'The action from the lane you arrived on. The junction count can already see that lane.', correct: false },
        { text: 'No action. Equal counts mean the copy refuses to move.', correct: false },
      ],
    },
    diagnose: {
      id: 'history-d',
      prompt: 'Why is one arrival wrong when the previous room is left off the key?',
      options: [
        { text: 'Both arrivals share one junction count. The counts tie, and the first action is taken.', correct: true },
        { text: 'The east notes were fewer, so the west notes outvoted them.', correct: false },
        { text: 'A second-episode reward changed the action. The copy adapted to a new task.', correct: false },
      ],
    },
    explain: {
      id: 'history-x',
      prompt: 'What does one previous room do here, and what does it not do?',
      options: [
        { text: 'It splits these two arrivals. Erasing it aliases them again. A longer hidden room can still tie. This is a count, not a sequence model and not a reward.', correct: true },
        { text: 'A recurrent network was pretrained on the notes, so the junction remembers the lane.', correct: false },
        { text: 'The repair stores the east path as a special case and ignores the counts.', correct: false },
      ],
    },
  };
  const state = { step: 0, picks: {}, finished: false, ran: false, swapped: false, sawErase: false, sawHistory: false };
  let hooks = {};
  let redraw = null;

  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function rowsNow() {
    return state.swapped ? H.swapActions(H.lessonRows()) : H.lessonRows();
  }
  function fitsNow() {
    const rows = rowsNow();
    return { rows: rows, current: H.fit(rows, false), history: H.fit(rows, true), alias: H.fit(H.longerAliasRows(), true) };
  }
  function followsBoth(fitted, rows) {
    return H.ARRIVALS.every((previous) => H.follows(fitted, rows, previous));
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'history',
      sentenceName: 'Count the previous room with the junction',
      mode: 'campaign',
      level: historyLevel.title,
      knobs: {},
      words: {},
      idleWords: {},
      discovered: [],
      lastRun: state.ran ? { seeds: 1, steps: state.step, symptoms: [], summary: 'Junction budget ' + rowsNow().length + '.' } : null,
    }),
    run() {
      state.ran = true;
      advance(2);
      const pack = fitsNow();
      if (redraw) redraw();
      return pack;
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
      if (state.step >= 2) state.ran = true;
      if (state.step >= 4) state.sawHistory = true;
      if (state.finished) state.sawErase = true;
      const body = hWrap(hooks.h);
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const lesson = C.levels.find((level) => level.id === 'history');
        const pack = state.ran ? fitsNow() : null;
        const lessonRows = H.lessonRows();
        const lessonCurrent = H.fit(lessonRows, false);
        const lessonTie = lessonCurrent.choose(H.JUNCTION, H.EAST_LANE);
        const aliasChoice = H.fit(H.longerAliasRows(), true).choose(H.JUNCTION, H.WEST_LANE);
        const first = H.ACTIONS[0];
        const wrongName = H.ARRIVALS.filter((previous) => !H.follows(lessonCurrent, lessonRows, previous)).map(label).join(' and ');
        function whyFor(key) {
          return {
            predict: [
              'The junction counts are west ' + lessonTie.counts.west + ' and east ' + lessonTie.counts.east + '. They match, so the walk takes ' + label(first) + ', the first action. ' + wrongName + ' does not match its notes.',
              'The current room is only the junction. The lane is not in that key, so asking where you came from does not change the count.',
              'A tie still returns an action. The rule does not leave the junction with no move.',
            ],
            diagnose: [
              'West ' + lessonTie.counts.west + ', east ' + lessonTie.counts.east + '. One key, one tie, first action ' + label(first) + '. ' + wrongName + ' is the arrival that disagrees with that action.',
              'The lesson notes use the same number of walks from each lane. A smaller east count is a different lesson.',
              'These notes have no reward. Nothing here reads a second episode or adapts a task.',
            ],
            explain: [
              'The history key is the previous room and the junction. Each lesson arrival then has one action. Drop the previous room and the tie returns. The longer pair still ties, because both rows use the west lane: west ' + aliasChoice.counts.west + ', east ' + aliasChoice.counts.east + '.',
              'No network is trained. The action is the largest count, and a tie uses the first action in the list.',
              'Each press fits the rows again. There is no stored path.',
            ],
          }[key];
        }
        function questionBlock(q, key, onCorrect) {
          const picked = state.picks[q.id];
          const locked = picked != null && q.options[picked] && q.options[picked].correct;
          const why = whyFor(key);
          return h('div.mc', { id: q.id }, [
            h('p', { text: q.prompt }),
            ...q.options.map((opt, index) => h('button.opt' + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
              type: 'button',
              disabled: locked && picked !== index ? true : null,
              onclick: () => {
                if (locked) return;
                state.picks[q.id] = index;
                if (hooks.record) hooks.record(q.id, index, !!opt.correct);
                if (opt.correct) onCorrect();
                redraw();
              },
            }, [
              h('span', { text: opt.text }),
              picked === index ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + why[index] }) : null,
            ])),
          ]);
        }
        function countText(choice) {
          return 'west ' + choice.counts.west + ', east ' + choice.counts.east;
        }
        function readout(fitted, id, title) {
          const west = fitted.choose(H.JUNCTION, H.WEST_LANE);
          const east = fitted.choose(H.JUNCTION, H.EAST_LANE);
          return h('div', {
            id: id,
            role: 'status',
            tabindex: '0',
            'data-budget': String(fitted.budget),
            'data-use-previous': fitted.usePrevious ? 'yes' : 'no',
            'data-tie': east.tie ? 'yes' : 'no',
            'data-action': east.action,
            'data-west-action': west.action,
            'data-east-action': east.action,
            'data-west-count': String(west.counts.west),
            'data-east-count': String(east.counts.east),
            'data-swapped': state.swapped ? 'yes' : 'no',
          }, [
            h('p', { text: title + ' Budget ' + fitted.budget + ' transitions.' }),
            h('p', { text: 'West lane at the junction: ' + countText(west) + '. Tie: ' + (west.tie ? 'yes' : 'no') + '. Walk ' + label(west.action) + ', end ' + label(H.step(H.JUNCTION, west.action)) + '.' }),
            h('p', { text: 'East lane at the junction: ' + countText(east) + '. Tie: ' + (east.tie ? 'yes' : 'no') + '. Walk ' + label(east.action) + ', end ' + label(H.step(H.JUNCTION, east.action)) + '.' }),
          ]);
        }
        const chosenRight = (q) => {
          const index = state.picks[q.id];
          return index != null && !!q.options[index].correct;
        };
        const predictCorrect = chosenRight(QUESTIONS.predict);
        const diagnoseCorrect = chosenRight(QUESTIONS.diagnose);
        const explainCorrect = chosenRight(QUESTIONS.explain);
        const ready = state.sawHistory && state.sawErase && explainCorrect;
        const kids = [
          h('div.eyebrow', { text: 'Phase 0 · Level ' + (C.levels.indexOf(lesson) + 1) + ' · Two lanes' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', { text: 'Each arrival is walked ' + H.PER_ARRIVAL + ' times. A walk from the west door goes east into the west lane, then into the junction, and the note says west. A walk from the east door goes west into the east lane, then into the junction, and the note says east. Actions are listed ' + H.ACTIONS.join(', then ') + '. Equal counts pick ' + label(first) + '.' }),
          h('p', { text: 'The same rows are counted twice: once by the current room, once by the previous room and the current room. The budget is the number of those rows. This is a count of demonstrated actions. It is not a reward, not a second-episode adaptation, and not a network.' }),
          h('p', null, [
            'Source: CS 285 lecture 3, ',
            h('a', { href: H.SOURCE.slides, target: '_blank', rel: 'noopener' }, 'slides'),
            '. Heading: ' + H.SOURCE.heading + ' ' + H.SOURCE.note + ' ' + H.LIMITS.join(' '),
          ]),
          h('div.history-track', { id: 'history-board' }, [H.WEST_DOOR, H.WEST_LANE, H.JUNCTION, H.EAST_LANE, H.EAST_DOOR].map((room) => h('div.history-cell' + (room === H.JUNCTION ? '.end' : ''), { text: label(room) }))),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'history-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you run' }),
            questionBlock(QUESTIONS.predict, 'predict', () => advance(1)),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'history-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Count the junction alone' }),
          h('p', { text: 'Fit the current room only. Both arrivals use that one key.' }),
          h('button.btn', { id: 'history-run', type: 'button', disabled: predictCorrect ? null : true, onclick: () => api.run() }, 'Fit the current room'),
        ]));
        if (pack && state.step >= 2) kids.push(readout(pack.current, 'history-current-readout', 'Current room only.'));
        if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'history-step-diagnose' }, [
          h('span.num', { text: 'Step 3' }),
          h('h3', { text: 'Diagnose' }),
          questionBlock(QUESTIONS.diagnose, 'diagnose', () => advance(3)),
        ]));
        if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'history-step-repair' }, [
          h('span.num', { text: 'Step 4' }),
          h('h3', { text: 'Count the previous room with the junction' }),
          h('p', { text: 'Fit the same rows again. The key is the previous room and the junction. Then erase that room, and the tie is the junction count from the same budget.' }),
          h('button.btn', {
            id: 'history-repair', type: 'button', disabled: diagnoseCorrect ? null : true,
            onclick: () => {
              const fitted = fitsNow();
              state.sawHistory = followsBoth(fitted.history, fitted.rows);
              state.ran = true;
              advance(4);
              redraw();
            },
          }, 'Fit the previous room'),
        ]));
        if (pack && state.step >= 4) {
          kids.push(
            readout(pack.history, 'history-history-readout', state.swapped ? 'Previous room kept, labels swapped.' : 'Previous room kept.'),
            h('div.history-controls', { id: 'history-controls' }, [
              h('button.btn' + (state.sawErase ? '' : '.ghost'), {
                id: 'history-erase', type: 'button', 'aria-pressed': state.sawErase ? 'true' : 'false',
                onclick: () => { state.sawErase = true; redraw(); },
              }, 'Erase the previous room'),
              h('button.btn' + (state.swapped ? '' : '.ghost'), {
                id: 'history-swap', type: 'button', 'aria-pressed': state.swapped ? 'true' : 'false',
                onclick: () => { state.swapped = !state.swapped; redraw(); },
              }, 'Swap the action labels'),
            ]),
          );
          if (state.sawErase) kids.push(readout(pack.current, 'history-erased-readout', 'Previous room erased. Same rows, same budget.'));
          kids.push(h('div', {
            id: 'history-alias',
            role: 'status',
            'data-tie': aliasChoice.tie ? 'yes' : 'no',
            'data-action': aliasChoice.action,
            'data-west-count': String(aliasChoice.counts.west),
            'data-east-count': String(aliasChoice.counts.east),
          }, [
            h('p', { text: 'One previous room is enough only in this toy: each lesson lane has one action. Two notes that share the west lane and disagree still tie under that window. West ' + aliasChoice.counts.west + ', east ' + aliasChoice.counts.east + '. Tie: ' + (aliasChoice.tie ? 'yes' : 'no') + '. Walk ' + label(aliasChoice.action) + '.' }),
          ]));
          kids.push(h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'history-step-explain' }, [
            h('span.num', { text: 'Step 5' }),
            h('h3', { text: 'Explain why it works' }),
            state.sawHistory && state.sawErase
              ? questionBlock(QUESTIONS.explain, 'explain', () => {})
              : h('p', { text: 'Fit the previous room, then erase it, before answering.' }),
          ]));
          kids.push(h('button.btn', {
            id: 'history-complete', type: 'button',
            disabled: state.finished || !ready ? true : null,
            onclick: () => {
              if (!ready || !hooks.complete) return;
              hooks.complete();
              state.finished = true;
              state.step = 5;
              redraw();
            },
          }, state.finished ? 'Lesson complete' : 'Finish lesson'));
        }
        const next = hooks.next ? hooks.next() : null;
        if (state.step >= 5) kids.push(next
          ? h('button.btn', { id: 'history-next', type: 'button', onclick: () => { if (hooks.openNext) hooks.openNext(); } }, 'Next level: ' + next.title)
          : h('p.small', { id: 'history-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'history-rules' }, [
          h('h3', { text: 'Game rules · Two lanes' }),
          h('dl', null, [
            ['Goal', 'At the junction, take the action in the notes for the lane you arrived from.'],
            ['Reward each step', 'None. The copy counts actions. It does not learn a reward and it does not adapt a task.'],
            ['Equation', 'p(action | room) = count(action, room) / count(room). p(action | previous, room) = count(action, previous, room) / count(previous, room). Equal counts pick the first action in the list: ' + H.ACTIONS.join(', ') + '.'],
            ['Notes', H.PER_ARRIVAL + ' walks from the west lane and ' + H.PER_ARRIVAL + ' walks from the east lane. Both fits use that same list and the same budget.'],
            ['Episode ends', 'One action at the junction. West ends in the west exit. East ends in the east exit.'],
            ['Score', '1 when the action matches the notes for that arrival, otherwise 0. A tie that picks the other action scores 0 for that arrival.'],
            ['Pass this challenge', lesson.goal.text],
          ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text: text })]))),
        ]));
      };
      redraw();
    },
  };

  function hWrap(h) { return h('div.card.stack', { id: 'history-lesson' }); }
  window.BBHISTORY_LEVEL = api;
})(window.CONTENT, window.BBHISTORY);
