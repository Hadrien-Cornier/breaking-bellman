// Offline-to-online on one joint. The scores come from src/agents/thaw.js.
(function (C, M) {
  'use strict';
  C.worldNames.thaw = 'One-joint reacher';
  const GOAL = 'On the heavy arm, the short fine-tune must beat both the frozen policy and the same short budget from scratch.';
  const predict = {
    id: 'thaw-p',
    prompt: 'The only dataset was collected on the light arm. You fit a policy on it and take no new steps. The arm is now twice as heavy. Where does the joint end?',
    options: [
      { steps: ['The light-arm data reaches near the target.', 'A copy plays those torques.', 'So the heavy arm ends near the target too.'], result: 'Near the target. The copy keeps the success.', correct: false,
        why: 'The recorded torques were large enough for the light arm. The heavy arm accelerates less under the same torque.' },
      { steps: ['The fit can only copy torques from the light-arm data.', 'Those torques are the wrong size once the inertia doubles.', 'The joint does not end on the target.'], result: 'Off the target. The torques were sized for the light arm.', correct: true,
        why: 'The lab scores that frozen policy on both inertias. Near the target on the light arm is not a result for the heavy arm.' },
      { steps: ['A frozen dataset is a file of numbers.', 'A file cannot turn a joint.', 'The heavy arm stays where it started.'], result: 'It does not move. Frozen data has no torque.', correct: false,
        why: 'The fit reads the recorded torques and plays a linear function of them. Freezing the data stops new collection. It does not delete the actions.' },
    ],
  };
  const diagnose = {
    id: 'thaw-d',
    prompt: 'The same frozen weights end near the target on the light arm and well past it on the heavy arm. What failed?',
    options: [
      { steps: ['Least squares can skip the actions.', 'The weights would then be arbitrary.', 'So the fit ignored the dataset.'], result: 'The fit ignored the recorded actions.', correct: false,
        why: 'Changing the recorded actions changes the fitted weights. The failure is not a fit that skipped the data.' },
      { steps: ['The weights were fit on the light arm.', 'Inertia 2 accelerates less under the same torque.', 'The joint arrives late and swings past the target.'], result: 'The light-arm torques swing past on the heavy arm.', correct: true,
        why: 'Both rollouts use target 1 rad, the same horizon, and the same weights. Only the inertia changes. The fitted one-step model is not used to choose the torque.' },
      { steps: ['A heavier payload is a new task.', 'A new task needs a new target.', 'So the heavy arm aims somewhere else.'], result: 'The heavy arm aims at a different target.', correct: false,
        why: 'The target stays at 1 rad. The episode length stays 50 steps. The payload change is the inertia in the dynamics.' },
    ],
  };
  const repair = {
    id: 'thaw-r',
    prompt: 'Three rows use the heavy arm. Which row is a parameter update, rather than a path drawn by hand?',
    options: [
      { steps: ['The frozen row is already on screen.', 'Its picture shows the miss.', 'Treat that picture as the repaired path.'], result: 'Keep the frozen weights. The picture is the repair.', correct: false,
        why: 'The frozen row takes 0 fresh transitions and does not change its weights. None of the scores is a path typed in by hand.' },
      { steps: ['Start from the frozen weights.', 'Step them by the measured return on fresh heavy-arm rollouts.', 'Score a new rollout of the updated weights.'], result: 'The short fine-tune, scored from its updated weights.', correct: true,
        why: 'Each update rolls out four probes on the heavy arm and moves the two weights along that measured slope. The held-weights check collects the same probes and does not improve, because the weights stay put.' },
      { steps: ['From scratch also rolls out on the heavy arm.', 'Seeing the new inertia is the whole fix.', 'So that row is the repair.'], result: 'The from-scratch row, because it saw the heavy arm.', correct: false,
        why: 'It saw the heavy arm for the same number of transitions. Its weights started at 0 and 0, and its measured return is worse at this short budget.' },
    ],
  };
  const explain = {
    id: 'thaw-x',
    prompt: 'The short from-scratch row had the same heavy-arm budget and did worse. A longer from-scratch run on this same arm catches up. What can you claim?',
    options: [
      { steps: ['The short fine-tune won this table.', 'A win on one table is a win in general.', 'Fine-tuning beats starting over on any arm.'], result: 'Fine-tuning beats starting over on any arm and any budget.', correct: false,
        why: 'The longer from-scratch counterfactual on this arm reaches the target. The short-budget ranking is not a general law, and it is not an IDQL or FQL result.' },
      { steps: ['Both short rows share the inertia, the update, and the transition count.', 'Only the starting weights differ.', 'That is the claim this run supports.'], result: 'On this arm and this short budget, the frozen start scores better.', correct: true,
        why: 'Lecture 18 names IDQL and FQL as offline-to-online diffusion methods. This page does not train them. The Spring 2026 project describes the direct pattern as offline training, then new rollouts, then an update. This is that shape on one joint.' },
      { steps: ['From scratch looks worse.', 'A worse score means a smaller budget.', 'So it saw fewer heavy-arm steps.'], result: 'From scratch saw fewer heavy-arm steps.', correct: false,
        why: 'The table gives both short rows the same update count and the same fresh-transition count.' },
    ],
  };
  const level = {
    id: 'thaw', custom: true, phase: 4, world: 'thaw', title: 'A few fresh steps', focus: [],
    intro: 'One joint reaches for angle 1 rad. The dataset is 50 transitions from a linear controller on a light arm, then the data collection stops. The arm you score is twice as heavy. A short finite-difference update from the fitted weights is compared with the same short budget from zeros.',
    goal: { text: GOAL },
    predict: predict, diagnose: diagnose, explain: explain,
  };
  const mixedAt = C.levels.findIndex((item) => item.id === 'mixed');
  if (mixedAt < 0) throw new Error('thaw requires the mixed level');
  if (!C.levels.some((item) => item.id === 'thaw')) C.levels.splice(mixedAt + 1, 0, level);
  C.cards.thaw = {
    name: 'A short thaw', status: 'checked',
    fixes: 'Fit a policy on data from the old inertia, then take a few fresh steps on the new inertia and update the weights from those returns.',
    stillWrong: 'Two weights, one joint, no action noise, and a finite-difference step. This is not IDQL, not FQL, and not the OGBench project. A longer from-scratch budget on this same arm closes the gap.',
    paper: 'CS 185/285 Spring 2026 lecture 18, and the default final project Offline-to-Online Reinforcement Learning. The project bibliography lists IDQL as Hansen-Estruch, Kostrikov, Janner, Kuba, and Levine, 2023.',
    evidence: '<p><b>Spring 2026 project, Part I:</b> "The most direct approach to offline-to-online RL is to take a policy trained on offline data, roll it out in the environment to collect online data, and then update the policy using this new data."</p><p>The same PDF names SAC+BC and FQL as homework methods that receive that finetuning step. It points IDQL to <b>Hansen-Estruch, Kostrikov, Janner, Kuba, and Levine, 2023</b>, arXiv:2304.10573. Lecture 18 titles those diffusion methods. The update on this page is a centered finite difference of the measured return on two linear weights.</p>',
  };
  C.paperLinks = C.paperLinks || {};
  C.paperLinks.thaw = [
    { t: 'Lecture 18 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-18.pdf' },
    { t: 'Offline-to-online project', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/misc/offline_to_online_rl_default_final_project.pdf' },
    { t: 'IDQL abstract', u: 'https://arxiv.org/abs/2304.10573' },
  ];
  const state = { result: null, error: null };
  const num = (value, digits) => Number(value).toFixed(digits);
  const goalMet = (result) => !!(result && result.finetune.totalReward > result.frozen.totalReward && result.finetune.totalReward > result.scratch.totalReward);
  M.cancel = () => { state.error = null; };
  M.state = () => ({
    world: 'thaw',
    sentenceName: 'Frozen linear policy, short finite-difference fine-tune, same budget from zeros',
    mode: 'campaign',
    level: level.title,
    knobs: {
      seed: state.result ? state.result.seed : M.assumptions.seed,
      inertiaOld: M.assumptions.inertiaOld,
      inertiaNew: M.assumptions.inertiaNew,
      updates: M.assumptions.updates,
    },
    words: {},
    idleWords: {},
    discovered: [],
    lastRun: state.result ? {
      seeds: 1,
      steps: state.result.finetune.onlineTransitions,
      symptoms: [],
      summary: {
        frozen: state.result.frozen.totalReward,
        finetune: state.result.finetune.totalReward,
        scratch: state.result.scratch.totalReward,
      },
    } : null,
    comparison: state.result,
  });
  M.run = () => {
    state.error = null;
    state.result = M.compare();
    return state.result;
  };
  function weights(pair) {
    return num(pair[0], 2) + ', ' + num(pair[1], 2);
  }
  function table(h, headings, rows, label) {
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': label }, h('table', null, [
      h('thead', null, h('tr', null, headings.map((text) => h('th', { scope: 'col', text: text })))),
      h('tbody', null, rows.map((row) => h('tr', null, row.map((text) => h('td', { text: text }))))),
    ]));
  }
  function bars(h, result) {
    const rows = [
      ['Frozen only', result.frozen, 'var(--bad)'],
      ['Short fine-tune', result.finetune, 'var(--good)'],
      ['Short from scratch', result.scratch, 'var(--warn)'],
    ];
    return h('div', { id: 'thaw-bars' }, [
      h('h3', { text: 'Terminal angle error on the heavy arm' }),
      h('p.small', { text: 'Bar length is the absolute error at step 50. Shorter is closer to the target. The axis is 1 rad, the error of a joint that never leaves the start.' }),
      ...rows.map(([label, row, color]) => h('div', null, [
        h('p.small', { text: label + ': ' + num(row.terminalError, 3) + ' rad, return ' + num(row.totalReward, 2) }),
        h('div.thaw-bar', { role: 'img', 'aria-label': label + ' terminal error ' + num(row.terminalError, 3) + ' radians' },
          h('span', { style: 'width:' + Math.max(0, Math.min(100, row.terminalError * 100)) + '%;background:' + color })),
      ])),
    ]);
  }
  function results(h, result) {
    const row = (label, item) => [label, String(item.updates), String(item.onlineTransitions), num(item.terminalError, 3), num(item.totalReward, 2), weights(item.weights)];
    return h('div.stack', { id: 'thaw-compare' }, [
      bars(h, result),
      table(h, ['Policy', 'Updates', 'Fresh transitions', 'Terminal error', 'Return', 'Weights'], [
        row('Frozen only', result.frozen),
        row('Short fine-tune', result.finetune),
        row('Short from scratch', result.scratch),
      ], 'Three policies on the heavy arm'),
      h('p', { text: 'Same frozen weights on the light arm end at ' + num(result.light.endAngle, 3) + ' rad (error ' + num(result.light.terminalError, 3) + '). On the heavy arm they end at ' + num(result.frozen.endAngle, 3) + ' rad.' }),
      h('p', { text: 'The frozen one-step model has torque coefficient ' + num(result.dataset.model.torqueCoefficient, 3) + '. The light inertia implies 1, and the heavy inertia implies 0.5. That model is not used to choose a torque. The value fit is stored and is not used to act or to rank the rows.' }),
      h('h3', { text: 'Checks around the three rows' }),
      table(h, ['Check', 'Updates', 'Fresh transitions', 'Weights moved', 'Terminal error', 'Return'], [
        ['Probes collected, weights held', String(result.held.updates), String(result.held.onlineTransitions), result.held.changed ? 'yes' : 'no', num(result.held.terminalError, 3), num(result.held.totalReward, 2)],
        ['From scratch, longer budget', String(result.longScratch.updates), String(result.longScratch.onlineTransitions), result.longScratch.changed ? 'yes' : 'no', num(result.longScratch.terminalError, 3), num(result.longScratch.totalReward, 2)],
      ], 'Held weights and a longer from-scratch budget'),
      h('p.small', { text: 'Seed ' + result.seed + ' is recorded. These probes do not draw random actions, so a different seed repeats the same numbers. The short rows share inertia ' + result.finetune.inertia + ', ' + result.finetune.updates + ' updates, and ' + result.finetune.onlineTransitions + ' fresh transitions. The frozen dataset stays at ' + result.dataset.transitions + ' light-arm transitions.' }),
    ]);
  }
  function arm(h, result) {
    const target = M.assumptions.target;
    const poses = result ? [
      ['Target', target, 'var(--muted)'],
      ['Frozen', result.frozen.endAngle, 'var(--bad)'],
      ['Fine-tune', result.finetune.endAngle, 'var(--good)'],
      ['From scratch', result.scratch.endAngle, 'var(--warn)'],
    ] : [['Target', target, 'var(--muted)'], ['Start', 0, 'var(--ink)']];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'thaw-arm');
    svg.setAttribute('viewBox', '0 0 360 220');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', result
      ? 'One joint at the frozen, fine-tune, and from-scratch ending angles, with the target marked.'
      : 'One joint at the start, with the target angle marked.');
    const pivot = [70, 150];
    const length = 78;
    const line = (angle, color, width) => {
      const x = pivot[0] + length * Math.cos(angle);
      const y = pivot[1] - length * Math.sin(angle);
      return '<line x1="' + pivot[0] + '" y1="' + pivot[1] + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round"/>';
    };
    svg.innerHTML = '<circle cx="' + pivot[0] + '" cy="' + pivot[1] + '" r="7" fill="var(--ink)"/>' +
      poses.map((pose, index) => line(pose[1], pose[2], index === 0 ? 2 : 5)).join('') +
      poses.map((pose, index) => '<text x="' + (160 + (index % 2) * 90) + '" y="' + (28 + Math.floor(index / 2) * 22) + '" fill="' + pose[2] + '" font-size="13">' + pose[0] + ' ' + num(pose[1], 2) + '</text>').join('');
    return h('section.card', null, [
      h('h3', { text: 'Where the joint ends' }),
      svg,
      h('p.small', { text: result ? 'Angles are the measured end of each rollout, not a path drawn for the lesson.' : 'Run the comparison to place the three heavy-arm endings.' }),
    ]);
  }
  function rules(h) {
    const A = M.assumptions;
    const row = (label, text) => h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
    return h('section.card.game-rules', { id: 'thaw-rules' }, [
      h('h3', { text: 'Game rules · One-joint reacher' }),
      h('dl', null, [
        row('Goal', 'Reach angle 1 rad. The payload then changes, and the frozen policy has to be updated from fresh steps.'),
        row('Reward each step', 'Minus the squared angle error. No discount. Torque is clipped to plus or minus 1.'),
        row('Equation', 'reward = -(angle - 1)^2, speed updates with torque / inertia - 0.02 * speed.'),
        row('Episode ends', 'After ' + A.horizon + ' steps. dt is ' + A.dt + '.'),
        row('Score', 'Sum of rewards, higher is better. The bars show absolute terminal angle error.'),
        row('Data', A.horizon + ' frozen transitions at inertia ' + A.inertiaOld + '. The fit adds none. A linear controller wrote them. The learners read the actions, not that controller.'),
        row('Short budget', A.updates + ' finite-difference updates and ' + (A.updates * A.probesPerUpdate * A.horizon) + ' fresh transitions at inertia ' + A.inertiaNew + '.'),
        row('From scratch', 'The same short budget. Both weights start at 0.'),
        row('Pass this challenge', GOAL),
      ]),
    ]);
  }
  function source(h) {
    return h('div.stack', { id: 'thaw-source' }, [
      h('p', { text: 'Spring 2026 project, Part I: "The most direct approach to offline-to-online RL is to take a policy trained on offline data, roll it out in the environment to collect online data, and then update the policy using this new data."' }),
      h('p', { text: 'Lecture 18 titles IDQL and FQL as offline-to-online diffusion methods. This lesson does not train those methods, and it does not claim that fine-tuning wins in general.' }),
      h('p.small', null, C.paperLinks.thaw.map((link) => h('a', { href: link.u, target: '_blank', rel: 'noopener' }, link.t + '. '))),
    ]);
  }
  M.mount = (pane, lab, opts) => {
    const h = opts.h;
    const stepOf = opts.step || (() => 0);
    const lesson = C.levels.find((item) => item.id === 'thaw');
    const body = h('div.card.stack', { id: 'thaw-lesson' });
    pane.append(body);
    const redraw = () => {
      if (!body.isConnected) return;
      const step = stepOf();
      const index = C.levels.findIndex((item) => item.id === 'thaw');
      const block = (i, title, content) => h('div.step' + (step === i ? '.active' : step > i ? '.done' : ''), null, [
        h('span.num', { text: 'Step ' + (i + 1) }),
        h('h3', { text: title }),
        content,
      ]);
      const ask = (question, advance) => opts.mc(question, () => advance());
      const kids = [
        h('div.eyebrow', { text: 'Level ' + (index + 1) + ' · Offline, then a short thaw' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        source(h),
      ];
      kids.push(block(0, 'Predict before you run', ask(predict, () => opts.setStep(1))));
      if (step >= 1) kids.push(block(1, 'Run it', h('div.stack', null, [
        h('p', { text: 'Fit the policy on the frozen light-arm transitions. Fit a one-step model and a value too, and do not use them to act. Then take the short budget on the heavy arm, once from the fitted weights and once from zeros.' }),
        h('button.btn', { id: 'thaw-run', type: 'button', onclick: () => {
          try { M.run(); }
          catch (error) { state.error = error.message; redraw(); return; }
          if (opts.reveal) opts.reveal('thaw');
          if (stepOf() < 2) opts.setStep(2);
          else redraw();
        } }, 'Measure the three policies'),
        h('p.small', { id: 'thaw-status', role: 'status', text: state.error || (state.result ? 'Measured in this page from the rollouts. The bars are those terminal errors.' : 'Nothing is measured until you run it.') }),
        state.result ? results(h, state.result) : null,
      ])));
      if (step >= 2 && state.result) kids.push(block(2, 'Diagnose', ask(diagnose, () => opts.setStep(3))));
      if (step >= 3 && state.result) kids.push(block(3, 'Repair: name the update', ask(repair, () => opts.setStep(4))));
      if (step >= 4 && state.result) kids.push(block(4, 'Explain why it works', ask(explain, () => {
        if (goalMet(state.result)) opts.complete();
        if (opts.refresh) opts.refresh();
        else redraw();
      })));
      if (step >= 5 && opts.done && opts.done()) {
        const next = C.levels[index + 1];
        kids.push(h('div.stack', null, [
          h('p', { text: 'Lesson complete. The short fine-tune beat the frozen policy and the short from-scratch policy on the measured returns.' }),
          next ? h('button.btn', { id: 'thaw-next', type: 'button', onclick: () => window.bellman.level(next.id) }, 'Next level: ' + next.title) : h('p.small', { text: 'This is the last level.' }),
        ]));
      }
      body.replaceChildren(...kids);
      lab.replaceChildren(arm(h, state.result), rules(h));
    };
    if (stepOf() >= 2 && !state.result) {
      try { M.run(); }
      catch (error) { state.error = error.message; }
    }
    redraw();
  };
})(window.CONTENT, window.BBTHAW);
