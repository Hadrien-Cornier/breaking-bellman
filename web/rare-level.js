// Lecture 19 visit-count lesson. Custom mount, separate from VPO and SuperMimic.
(function (C, M) {
  'use strict';
  const phaseAt = C.phases.findIndex((p) => p.n === 4);
  C.phases.splice(phaseAt + 1, 0, { n: 11, title: 'Exploration by counts' });
  C.worldNames.rare = 'Sparse hallway';
  const level = {
    id: 'rare', custom: true, phase: 11, world: 'rare', focus: [],
    title: 'A bonus for a rare cell',
    intro: 'The only environment reward is 1, and only for opening the door at the end of a hallway. Epsilon-greedy Q-learning with a flat table keeps choosing left. The repair writes 1/sqrt(n(s)) into the Q target and treats an untried action as worth 1/(1 - gamma), so the bonus can back up along the hall.',
    goal: { text: 'Same 80 steps and the same random draws: the door stays shut without the visit bonus, and it opens with the bonus. The environment reward stays separate from 1/sqrt(n(s)).' },
  };
  const mixedAt = C.levels.findIndex((l) => l.id === 'mixed');
  C.levels.splice(mixedAt + 1, 0, level);

  const state = {
    seed: M.PROTOCOL.seed,
    step: 0,
    predict: null,
    diagnose: null,
    explain: null,
    off: null,
    full: null,
    table: null,
    pick: '',
    error: '',
  };
  let redraw = null;
  const num = (x) => Number(x).toFixed(3);
  const PREDICT = [
    { result: 'It stays near the start. The door reward is still unseen, so the table has no reason to go right.', correct: true,
      why: 'Ties pick left. With epsilon 0.05, random moves are rare. This run can check that claim.' },
    { result: 'It opens the door. Random actions are enough on a short hall.', correct: false,
      why: 'The hall is short for a person. For this epsilon and this tie-break, 80 steps are not enough. The run counts door openings.' },
    { result: 'The pendulum entropy bonus carries it to the door.', correct: false,
      why: 'That bonus is the SAC lesson on the pendulum. This lesson is a table on a hallway. The two bonuses are different objects.' },
  ];
  const DIAGNOSE = [
    { result: 'Every Q is still 0, so greedy keeps left. Random actions do not cross the hall inside 80 steps.', correct: true,
      why: 'The environment reward never arrived, so the update had nothing to move. The visit map should sit on the first cells.' },
    { result: 'The cells moved, so the door was not in a fixed place.', correct: false,
      why: 'Left, right, and open have fixed successors. The randomness is only in epsilon.' },
    { result: '1/sqrt(n(s)) was added to the reward and pulled the agent backward.', correct: false,
      why: 'The bonus was off on that run. The repair turns it on for the same seed and the same 80 steps.' },
  ];
  const EXPLAIN = [
    { result: 'A pseudo-count is the same integer n(s). Only the name changes.', correct: false,
      why: 'The lecture heading Exploring with pseudo-counts is a different object: a stand-in when you cannot keep a table.' },
    { result: 'n(s) here is an exact count, one integer per cell. A pseudo-count comes from a density model when states cannot be listed. This lesson does not fit that model.', correct: true,
      why: 'Bellemare, Srinivasan, Ostrovski, Schaul, Saxton, and Munos (NeurIPS 2016) define pseudo-counts from a density model. This hallway is small enough to count.' },
    { result: 'A pseudo-count is the slot-machine bonus, c times the square root of ln(t) / n.', correct: false,
      why: 'The slot machines already play that bandit bonus. This bonus is 1/sqrt(n(s)) on hallway cells, and the slots level is unchanged.' },
  ];

  const episode = M.run;
  M.cancel = () => {};
  M.state = () => {
    const on = state.full && state.full.on;
    return {
      world: 'rare',
      sentenceName: 'Tabular Q-learning with a visit-count bonus',
      mode: 'campaign',
      level: level.title,
      knobs: { seed: state.seed, steps: M.PROTOCOL.steps, eps: M.PROTOCOL.eps },
      words: {},
      idleWords: {},
      discovered: [],
      lastRun: on ? {
        seeds: 1,
        steps: on.steps,
        symptoms: [],
        summary: {
          openings: on.openings,
          discoveredReward: on.discoveredReward,
          visitBonusSum: on.visitBonusSum,
          greedyOpens: on.greedyOpens,
          qRightBeforeReward: on.qRightBeforeReward,
        },
      } : null,
    };
  };
  M.run = async () => {
    state.error = '';
    state.full = M.compare(state.seed);
    state.off = state.full.off;
    state.table = M.sensitivity();
    if (state.step < 4) state.step = 4;
    if (redraw) redraw();
    return state.full;
  };

  function quiz(h, id, prompt, options, picked, onPick) {
    return h('div.mc', { id }, [
      h('p', { text: prompt }),
      ...options.map((opt, i) => h('button.opt' + (picked === i ? '.picked' : '') + (picked == null ? '' : opt.correct ? '.right' : '.wrong'), {
        type: 'button',
        onclick: () => onPick(i),
      }, [
        h('span.res', { text: opt.result }),
        picked == null ? null : h('span.why', { text: (opt.correct ? 'Sound chain. ' : '') + opt.why }),
      ])),
    ]);
  }

  function mapOf(h, run, id) {
    const max = Math.max(1, ...run.counts);
    return h('div.cells', { id, role: 'group', 'aria-label': 'Visit counts and 1/sqrt(n)' }, run.counts.map((n, i) => {
      const key = id + ':' + i;
      const label = M.CELL_LABELS[i];
      const bonusText = n > 0 ? num(1 / Math.sqrt(n)) : 'unseen';
      return h('button.cell' + (n ? '.seen' : '.fresh') + (state.pick === key ? '.lit' : ''), {
        type: 'button',
        'aria-pressed': state.pick === key ? 'true' : 'false',
        onclick: () => { state.pick = key; redraw(); },
      }, [
        h('span.bar', { style: 'height:' + Math.round(100 * n / max) + '%' }),
        h('span.name', { text: label }),
        h('span.n', { text: 'n ' + n }),
        h('span.b', { text: bonusText }),
      ]);
    }));
  }

  function pickedLine(h) {
    if (!state.pick) return null;
    const [id, indexText] = state.pick.split(':');
    const run = id === 'rare-map-on' ? (state.full && state.full.on) : state.off;
    if (!run) return null;
    const index = +indexText;
    const n = run.counts[index];
    const text = n > 0
      ? M.CELL_LABELS[index] + ' has ' + n + ' visits. 1/sqrt(n) is ' + num(1 / Math.sqrt(n)) + '. That number is not the environment reward.'
      : M.CELL_LABELS[index] + ' is unseen. The repair does not give an unseen cell an infinite action score.';
    return h('p.small', { id: 'rare-cell', role: 'status', text });
  }

  function rewardTable(h, full) {
    const line = (name, run) => [name, String(run.openings), num(run.discoveredReward), num(run.visitBonusSum), num(run.qRightBeforeReward), run.greedyOpens ? 'opens the door' : 'stays shut'];
    const rows = [
      line('No bonus', full.off),
      line('Action-score bonus only', full.local),
      line('Target bonus, ties pick left', full.targetOnly),
      line('Optimism, no count bonus', full.optimism),
      line('Count bonus in the backup', full.on),
    ];
    return h('div.vpo-table', { id: 'rare-rewards', tabindex: '0', role: 'region', 'aria-label': 'Environment reward and visit bonus' },
      h('table', null, [
        h('thead', null, h('tr', null, ['Run', 'Openings', 'Env reward', 'Sum of 1/sqrt(n)', 'Q before reward', 'Greedy on Q'].map((text) => h('th', { scope: 'col', text })))),
        h('tbody', null, rows.map((row) => h('tr', null, row.map((text) => h('td', { text }))))),
      ]));
  }

  function seedTable(h, rows, caption) {
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': caption }, [
      h('p.small', { text: caption }),
      h('table', null, [
        h('thead', null, h('tr', null, ['Seed', 'Steps', 'Epsilon', 'Openings without', 'Openings with', 'Same draws'].map((text) => h('th', { scope: 'col', text })))),
        h('tbody', null, rows.map((row) => h('tr', null, [
          row.seed, row.steps, row.eps, row.offOpenings, row.onOpenings, row.sameDraws ? 'yes' : 'no',
        ].map((text) => h('td', { text: String(text) }))))),
      ]),
    ]);
  }

  M.mount = (pane, lab, { h, complete, done }) => {
    const body = h('div.card.stack', { id: 'rare-lesson' });
    pane.append(body);
    const at = (n) => state.step === n ? '.active' : state.step > n ? '.done' : '';
    const block = (n, title, kids) => h('div.step' + at(n), null, [h('span.num', { text: 'Step ' + (n + 1) }), h('h3', { text: title }), ...kids]);
    redraw = () => {
      if (!body.isConnected) return;
      const kids = [
        h('div.eyebrow', { text: 'Lecture 19 · Sparse hallway' }),
        h('h2', { text: level.title }),
        h('p', { text: level.intro }),
        h('p.small', null, [
          'Slides: ',
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-19.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 19'),
          '. Slide 19 names MBIE-EB (Strehl and Littman, 2008) and BEB (Kolter and Ng, 2009). Slide 18 names ',
          h('a', { href: 'https://arxiv.org/abs/1606.01868', target: '_blank', rel: 'noopener' }, 'Bellemare et al., NeurIPS 2016'),
          ' for pseudo-counts. This page uses 1/sqrt(n(s)) on a table and does not quote those sources.',
        ]),
        h('label.field', { for: 'rare-seed' }, [
          h('span.small', { text: 'Seed' }),
          h('select', {
            id: 'rare-seed',
            onchange: (e) => {
              state.seed = +e.target.value;
              state.off = null;
              state.full = null;
              state.table = null;
              state.pick = '';
              if (state.step > 1 && state.step < 5) state.step = 1;
              redraw();
            },
          }, M.LESSON_SEEDS.map((seed) => h('option', { value: seed, selected: seed === state.seed, text: String(seed) }))),
        ]),
      ];
      kids.push(block(0, 'Predict before you run', [
        quiz(h, 'rare-predict', 'Estimates start at 0. Equal estimates pick left. Epsilon is 0.05. The visit bonus is off. What does 80 steps find?', PREDICT, state.predict, (i) => {
          state.predict = i;
          if (state.step < 1) state.step = 1;
          redraw();
        }),
      ]));
      if (state.step >= 1) kids.push(block(1, 'Run it', [
        h('p', { text: 'Train one table for 80 steps with the bonus off. The button uses the seed above.' }),
        h('button.btn', { id: 'rare-run-plain', type: 'button', onclick: () => {
          state.error = '';
          state.off = episode({ seed: state.seed, place: 'off' });
          state.pick = '';
          if (state.step < 2) state.step = 2;
          redraw();
        } }, 'Run 80 steps without the bonus'),
        state.off ? h('div.stack', { id: 'rare-plain' }, [
          h('p', { text: 'Door openings: ' + state.off.openings + '. Environment reward: ' + num(state.off.discoveredReward) + '. Sum of 1/sqrt(n) over visits, not added to that reward: ' + num(state.off.visitBonusSum) + '.' }),
          mapOf(h, state.off, 'rare-map-off'),
          pickedLine(h),
        ]) : null,
      ]));
      if (state.step >= 2) kids.push(block(2, 'Diagnose', [
        quiz(h, 'rare-diagnose', 'The visits from the plain run sit on the early cells. Why is the door still shut?', DIAGNOSE, state.diagnose, (i) => {
          state.diagnose = i;
          if (state.step < 3) state.step = 3;
          redraw();
        }),
      ]));
      if (state.step >= 3) kids.push(block(3, 'Repair: back the count bonus up', [
        h('p', { text: 'An action that has never been taken scores 1/(1 - gamma), which is ' + (1 / (1 - M.PROTOCOL.gamma)).toFixed(0) + ' here, until its update replaces that value. The repair also adds 1/sqrt(n(s\')) inside the TD target. The logged environment reward stays 0 or 1. The seed, the 80 steps, and the two random draws per step stay the same.' }),
        h('button.btn', { id: 'rare-run-bonus', type: 'button', onclick: () => {
          state.error = '';
          state.full = M.compare(state.seed);
          state.off = state.full.off;
          state.table = M.sensitivity();
          state.pick = '';
          if (state.step < 4) state.step = 4;
          redraw();
        } }, 'Run the same budget with the bonus in the backup'),
        state.full ? h('div.stack', { id: 'rare-bonus' }, [
          h('h3', { text: 'Visits with the count bonus in the backup' }),
          mapOf(h, state.full.on, 'rare-map-on'),
          pickedLine(h),
          rewardTable(h, state.full),
          h('p', { text: 'Action-score bonus only records ' + state.full.local.openings + ' openings. Q(start, right) before any environment reward is ' + num(state.full.local.qRightBeforeReward) + '. That bonus is not written into Q.' }),
          h('p', { text: 'A count bonus only inside the Q target, with ties still picking left, records ' + state.full.targetOnly.openings + ' openings in this budget.' }),
          h('p', { text: 'Untried actions worth 1/(1 - gamma), and no 1/sqrt(n) in the target, record ' + state.full.optimism.openings + ' openings. Q(start, right) before any environment reward is ' + num(state.full.optimism.qRightBeforeReward) + '.' }),
          h('p', { text: 'The repair uses that same untried-action value and adds 1/sqrt(n(s\')) inside the target. It records ' + state.full.on.openings + ' openings. Q(start, right) before any environment reward is ' + num(state.full.on.qRightBeforeReward) + '.' }),
          h('p', { text: 'Greedy on the learned Q, with the untried-action value removed, ' + (state.full.on.greedyOpens ? 'still opens the door.' : 'does not open the door on this seed.') + ' That playback is the table after both the backed-up bonus and the environment reward of 1. It is not a path written by hand.' }),
          h('p', { text: 'The same backup with the environment reward forced to 0 still crosses the door ' + state.full.withheld.crossings + ' times in the 80 steps. The logged environment reward stays ' + num(state.full.withheld.discoveredReward) + '. Greedy on that table ' + (state.full.withheld.greedyOpens ? 'opens the door.' : 'does not open the door.') + ' Reaching the door during training is not the same as a greedy policy that no longer needs the bonus.' }),
          seedTable(h, state.table.lesson, 'Lesson budget, seeds ' + M.LESSON_SEEDS.join(', ') + '. Each row is one seeded pair of the plain run and the backup. This is not a guarantee for every seed.'),
          seedTable(h, state.table.stress, 'Shorter budget of ' + state.table.stressProtocol.steps + ' steps at epsilon ' + state.table.stressProtocol.eps + '. Some of these seeds miss the door even with the backup. The plain runs still record 0 openings.'),
        ]) : null,
      ]));
      if (state.step >= 4) kids.push(block(4, 'Explain why it works', [
        quiz(h, 'rare-explain', 'The repair used exact visit counts. Lecture 19 also discusses pseudo-counts. Which description matches the two?', EXPLAIN, state.explain, (i) => {
          state.explain = i;
          redraw();
        }),
        h('button.btn', {
          id: 'rare-complete', type: 'button',
          disabled: state.explain !== 1,
          onclick: () => { complete(); state.step = 5; redraw(); },
        }, done() ? 'Lesson complete' : 'Finish lesson'),
        h('p.small', { text: 'Finish stays off until the pseudo-count choice is the density-model one.' }),
      ]));
      if (state.step >= 5 || done()) {
        const i = C.levels.findIndex((l) => l.id === 'rare');
        const nx = C.levels[i + 1];
        kids.push(h('div.stack', { id: 'rare-done' }, [
          h('h3', { text: 'Assumptions this toy is willing to state' }),
          h('ul', { id: 'rare-assumptions' }, M.ASSUMPTIONS.map((text) => h('li', { text }))),
          h('p', { text: 'Slide 16 asks what a count is when the same state is never seen twice. This hallway repeats eight cells, so n(s) is an integer. A robot camera does not repeat states that way. Pseudo-counts are the lecture\'s next step, and this toy does not build them.' }),
          nx ? h('button.btn', { id: 'rare-next', type: 'button', onclick: () => window.bellman.level(nx.id) }, 'Next level: ' + nx.title) : null,
        ]));
      }
      if (state.error) kids.push(h('p.small', { role: 'status', text: state.error }));
      body.replaceChildren(...kids);
      lab.replaceChildren(h('section.card.game-rules', { id: 'rare-rules' }, [
        h('h3', { text: 'Game rules · Sparse hallway' }),
        h('dl', null, [
          h('div.rules-row', null, [h('dt', { text: 'Goal' }), h('dd', { text: 'Open the door by learning a sparse reward of 1, using visit counts only as a bonus.' })]),
          h('div.rules-row', null, [h('dt', { text: 'Reward each step' }), h('dd', { text: 'Environment reward is 1 for Open at the door, otherwise 0. 1/sqrt(n(s)) is shown separately and is not added to that reward.' })]),
          h('div.rules-row', null, [h('dt', { text: 'Equation' }), h('dd.rules-equation', { text: 'An untried action scores 1/(1 - gamma). The repair target is r_env + 1/sqrt(n(s\')) + gamma * max Q-hat(s\'). r_env stays 0 or 1.' })]),
          h('div.rules-row', null, [h('dt', { text: 'Episode ends' }), h('dd', { text: 'The run lasts 80 steps. Opening the door does not end it. Gem sends the agent back to Start.' })]),
          h('div.rules-row', null, [h('dt', { text: 'Score' }), h('dd', { text: 'Door openings, equal to the sum of environment rewards, beside the sum of 1/sqrt(n) over visits.' })]),
          h('div.rules-row', null, [h('dt', { text: 'Pass this challenge' }), h('dd', { text: level.goal.text })]),
        ]),
      ]));
    };
    redraw();
  };
})(window.CONTENT, window.BBRARE);
