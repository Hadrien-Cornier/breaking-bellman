// Lecture 14 preference lesson. Two fixed replies, a Bradley-Terry fit, then expected score with and without KL.
(function (C, P) {
  'use strict';
  if (!C || !P) throw new Error('prefer lesson needs CONTENT and BBPREFER');

  C.worldNames.prefer = 'Two replies';
  const GOAL = 'Compare beta 0 with a positive beta on the same preferences and the same reference, including a larger reward scale and a reference that cannot say 4.';
  if (!C.levels.some((level) => level.id === 'prefer')) {
    const level = {
      id: 'prefer', custom: true, phase: 2, world: 'prefer', title: 'Tilt the reference', focus: [],
      reveal: 'btref',
      intro: 'One prompt has two fixed replies, 4 and 22. Four preference rows are the whole dataset. Three prefer 4. One prefers 22. Fit a Bradley-Terry score, then maximize that score. Beta can subtract KL to a reference policy. This page has no language model.',
      goal: { text: GOAL },
    };
    const at = C.levels.findIndex((item) => item.id === 'passfail');
    if (at < 0) C.levels.push(level);
    else C.levels.splice(at + 1, 0, level);
  }

  const EVIDENCE = '<p><b>CS 285 Spring 2026 lecture 14, Bradley-Terry model:</b> better trajectories are exponentially more likely to be chosen based on their reward</p>'
    + '<p><b>CS 285 Spring 2026 lecture 14, Reference model regularization:</b> avoid producing nonsense text (must be valid English)</p>'
    + '<p><b>Same slide:</b> avoids exploiting imperfect reward models</p>'
    + '<p class="small muted">Checked against slide text extracted with pypdf 6.21.2 on 22 Oct 2026 from the 51-page lecture 14 PDF. The deck equations did not extract as text, so the tilted-reference formula in the lesson is derived for this two-reply objective. It is not a copied slide equation.</p>';
  C.cards.btref = {
    name: 'Bradley-Terry reference', short: 'Preferences', status: 'checked',
    paper: 'CS 285 Spring 2026 lecture 14, Sergey Levine. Slide titles: Bradley-Terry model, and Reference model regularization. <a href="https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-14.pdf">Lecture 14 slides</a>.',
    fixes: 'Learn a score from which reply a person preferred. Then maximize that score with a penalty for leaving a reference policy.',
    stillWrong: 'This toy has two fixed replies and four preference rows. It does not train a language model. A positive finite beta is the reward-tilted reference. A larger score scale can still put almost all of the probability on one reply. Pass or fail remains the verifier and GRPO lesson.',
    evidence: EVIDENCE,
  };
  C.paperLinks.btref = [
    { t: 'CS 285 lecture 14 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-14.pdf' },
  ];

  const state = {
    step: 0,
    picks: {},
    ran: null,
    rows: [],
    got: {},
    controls: { beta: 'ln3', scale: '1', ref: 'uniform' },
    finished: false,
  };
  let redraw = null;
  let hooks = null;

  function num(x) {
    if (x === Infinity) return 'infinite';
    if (x == null || !isFinite(x)) return 'not finite';
    const digits = Math.abs(x) > 0 && Math.abs(x) < 0.001 ? 8 : 6;
    return Number(x).toFixed(digits);
  }

  function betaValue(name) {
    return name === '0' ? 0 : Math.log(3);
  }

  function refOf(name) {
    return name === 'hole' ? P.HOLE : P.REFERENCE;
  }

  function measure(controls) {
    const fit = P.fitScores(P.PREFERENCES);
    if (!fit.finite) throw new Error(fit.reason);
    const beta = betaValue(controls.beta);
    const scale = Number(controls.scale);
    const ref = refOf(controls.ref);
    const scores = P.scaleScores(fit.scores, scale);
    const policy = P.optimizePolicy(scores, ref, beta);
    const closed = beta > 0 ? P.tiltedReference(scores, ref, beta) : null;
    return {
      fitGap: fit.gap,
      fit: fit,
      scores: scores,
      policy: policy,
      closed: closed,
      beta: beta,
      scale: scale,
      refName: controls.ref,
      ref: { four: ref.four, twenty: ref.twenty },
    };
  }

  function tagOf(row) {
    const p = row.policy.pi.four;
    const gapOk = Math.abs(row.scores.four - row.scale * row.fitGap) < 1e-8;
    if (!gapOk) return 'extra';
    if (row.refName === 'uniform' && row.scale === 1 && row.beta === 0 && p === 1) return 'base';
    if (row.refName === 'uniform' && row.scale === 1 && row.beta > 0 && p > 0.7 && p < 0.8 && row.closed && Math.abs(row.closed.four - p) < 1e-8) return 'tilt';
    if (row.refName === 'uniform' && row.scale === 8 && row.beta > 0 && p > 0.999) return 'hot';
    if (row.refName === 'hole' && row.scale === 1 && row.beta > 0 && p === 0) return 'hole';
    if (row.refName === 'hole' && row.scale === 1 && row.beta === 0 && p === 1 && row.policy.kl === Infinity) return 'hole0';
    return 'extra';
  }

  const NEED = ['tilt', 'hot', 'hole', 'hole0'];

  function remember(row) {
    const tag = tagOf(row);
    row.tag = tag;
    state.rows.unshift(row);
    if (tag !== 'extra') state.got[tag] = row;
    return tag;
  }

  P.cancel = () => {};
  P.state = () => ({
    world: 'prefer',
    sentenceName: 'Bradley-Terry score, then expected score minus beta times KL',
    mode: 'campaign',
    level: 'Tilt the reference',
    knobs: { beta: state.controls.beta, scale: state.controls.scale, reference: state.controls.ref },
    words: {},
    languageModel: false,
    lastRun: state.ran ? { seeds: 1, steps: P.PREFERENCES.length, symptoms: [], summary: { probabilityOfFour: state.ran.policy.pi.four } } : null,
  });
  P.run = async () => {
    const row = measure({ beta: '0', scale: '1', ref: 'uniform' });
    state.ran = row;
    remember(row);
    if (redraw) redraw();
    return row;
  };

  function ask(h, q) {
    const wrap = h('div.mc', { id: q.id });
    wrap.append(h('p', { text: q.prompt }));
    const prior = hooks.prior ? hooks.prior(q.id) : null;
    q.options.forEach((option, index) => {
      const why = h('span.why', { hidden: true, text: (option.correct ? 'Sound chain. ' : '') + option.why });
      const button = h('button.opt', { type: 'button' }, [
        h('ol', null, option.steps.map((step) => h('li', { text: step }))),
        h('span.res', { text: option.result }),
        why,
      ]);
      button.addEventListener('click', () => {
        if (hooks.record) hooks.record(q.id, index, !!option.correct);
        state.picks[q.id] = index;
        if (state.step === q.step) state.step = q.step + 1;
        redraw();
      });
      if (prior) {
        button.classList.add(option.correct ? 'right' : 'wrong');
        if (prior.choice === index) button.classList.add('picked');
        why.hidden = false;
      }
      wrap.append(button);
    });
    return wrap;
  }

  function preferenceTable(h) {
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': 'Preference rows' }, h('table', null, [
      h('thead', null, h('tr', null, ['Row', 'Preferred', 'Other'].map((text) => h('th', { scope: 'col', text: text })))),
      h('tbody', null, P.PREFERENCES.map((row, index) => h('tr', null, [
        h('td', { text: String(index + 1) }),
        h('td', { text: row.winner === 'four' ? '4' : '22' }),
        h('td', { text: row.loser === 'four' ? '4' : '22' }),
      ]))),
    ]));
  }

  function policyTable(h, rows) {
    const head = ['Setting', 'P(4)', 'P(22)', 'Expected score', 'KL', 'Objective', 'KL in objective'];
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': 'Policy measurements' }, h('table', null, [
      h('thead', null, h('tr', null, head.map((text) => h('th', { scope: 'col', text: text })))),
      h('tbody', null, rows.map((row) => h('tr', null, [
        h('td', { text: row.refName + ', scale ' + row.scale + ', beta ' + (row.beta === 0 ? '0' : 'ln 3') }),
        h('td', { text: num(row.policy.pi.four) }),
        h('td', { text: num(row.policy.pi.twenty) }),
        h('td', { text: num(row.policy.expectedReward) }),
        h('td', { text: num(row.policy.kl) }),
        h('td', { text: num(row.policy.objective) }),
        h('td', { text: row.policy.klInObjective ? 'yes' : 'no' }),
      ]))),
    ]));
  }

  function meters(h, pi) {
    const bar = (label, value) => h('div', null, [
      h('span.small', { text: label + ' ' + num(value) }),
      h('div.prefer-track', null, h('div.prefer-fill', { style: 'width:' + Math.max(0, Math.min(100, value * 100)).toFixed(2) + '%' })),
    ]);
    return h('div.prefer-meter', { role: 'img', 'aria-label': 'Probability of 4 is ' + num(pi.four) + ' and probability of 22 is ' + num(pi.twenty) }, [
      bar('4', pi.four),
      bar('22', pi.twenty),
    ]);
  }

  function rules(h) {
    const row = (label, text) => h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
    return h('section.card.game-rules', { id: 'prefer-rules' }, [
      h('h3', { text: 'Game rules · Two replies' }),
      h('dl', null, [
        row('Goal', 'Choose one of the two fixed replies under a policy you optimized.'),
        row('Reward each step', 'There is no environment step. The score of a reply is the fitted Bradley-Terry score, scaled by the reward scale you set. The score of 22 starts at 0.'),
        row('Equation', 'J = expected score - beta * KL(policy || reference). At beta 0 the KL term is not in J. For beta > 0 the optimum is reference(a) * exp(score(a) / beta), then normalized.'),
        row('Episode ends', 'One reply is chosen. The reference support is the replies whose reference probability is positive.'),
        row('Score', 'Show probability, expected score, KL, and the objective as separate numbers. KL is ln 2 when probability 1 sits on one reply of a uniform reference.'),
        row('Pass this challenge', GOAL),
      ]),
    ]);
  }

  const PREDICT = {
    id: 'prefer-p', step: 0,
    prompt: 'The reference gives each reply probability 1/2. You fit scores from the four rows, then maximize expected score with beta at 0. What does the optimal policy do?',
    options: [
      {
        steps: ['The reference is uniform, so each reply starts at one half.', 'Beta multiplies the KL term in the objective.', 'Removing that term still leaves the uniform reference in charge.'],
        result: 'It stays at one half.', correct: false,
        why: 'Beta 0 removes the KL term. The reference does not constrain that objective. The higher score gets probability 1.',
      },
      {
        steps: ['Three of the four rows prefer 4.', 'The Bradley-Terry win rate on this set is 3/4.', 'The optimal policy copies that win rate as its probability.'],
        result: '4 gets probability 3/4.', correct: false,
        why: '3/4 is how often 4 wins a comparison in this dataset. It is not the policy that maximizes expected score.',
      },
      {
        steps: ['Beta 0 drops the KL term from the objective.', 'The fitted score of 4 is higher than the score of 22.', 'Expected score is linear in the probabilities, so a corner wins.'],
        result: 'Probability 1 on 4.', correct: true,
        why: 'With beta at 0 the optimum is a vertex on the higher score. The reference does not enter. The win rate 3/4 is a different number.',
      },
    ],
  };
  const DIAGNOSE = {
    id: 'prefer-d', step: 2,
    prompt: 'The beta 0 run put probability 1 on 4. KL to the uniform reference is finite and was not subtracted. What happened?',
    options: [
      {
        steps: ['The scores were fit by the preference likelihood.', 'Beta 0 means the objective is only expected score.', 'A linear objective over a probability is largest at a corner.'],
        result: 'Beta 0 ignores the reference.', correct: true,
        why: 'KL is shown so you can see the distance. It is not part of the beta 0 objective. Probability 1 is the score maximizer. No language model was sampled.',
      },
      {
        steps: ['The table reports probability 1.', 'Three quarters of the rows prefer 4.', 'A displayed 1.0 is just a rounded 3/4.'],
        result: 'The 1 is a rounded 3/4.', correct: false,
        why: 'The measured probability is exactly 1, not 0.75. The preference rate and the optimal policy are different objects.',
      },
      {
        steps: ['A language model generated both replies.', 'Training collapsed onto the preferred string.', 'This replaces the Pass or fail verifier.'],
        result: 'A language model collapsed.', correct: false,
        why: 'The replies are the fixed strings 4 and 22. Pass or fail is still the verifier lesson. Nothing here samples text.',
      },
    ],
  };
  const EXPLAIN = {
    id: 'prefer-x', step: 4,
    prompt: 'Beta approaches 0 from above, and the reference gives both replies positive probability. Where does that positive-beta optimum go?',
    options: [
      {
        steps: ['Any positive beta forbids a probability near 1.', 'The reference is uniform, so the optimum stays there.', 'Reward scale cannot change that.'],
        result: 'It stays at the reference.', correct: false,
        why: 'You measured scale 8 at the same positive beta. Probability of 4 went above 0.999. A positive beta does not forbid concentration.',
      },
      {
        steps: ['For beta above 0, a reply with reference probability 0 stays at 0.', 'Inside the support, the weights are reference times exp(score / beta).', 'As beta shrinks, that mass concentrates on the higher score inside the support.'],
        result: 'Onto the higher score inside the support.', correct: true,
        why: 'That is the limit of the tilted reference. The beta 0 objective is a different boundary: the KL term is absent, so your hole measurement at beta 0 put probability 1 on 4 even though the reference never says it.',
      },
      {
        steps: ['A positive beta still allows every reply.', 'The hole in the reference is only a suggestion.', 'The limit can select a reply the reference gives probability 0.'],
        result: 'It can leave the support while beta is positive.', correct: false,
        why: 'For every positive beta, KL is infinite if the policy uses a reply the reference gives probability 0. Your positive-beta hole row kept 4 at probability 0.',
      },
    ],
  };

  P.mount = (pane, lab, api) => {
    hooks = api;
    if (api.done && api.done()) state.finished = true;
    if (state.finished) state.step = 5;
    const lesson = C.levels.find((level) => level.id === 'prefer');
    const h = api.h;
    const body = h('div.card.stack', { id: 'prefer-lesson' });
    pane.append(body);
    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((level) => level.id === 'prefer') + 1;
      const ready = NEED.every((id) => state.got[id]);
      const select = (id, label, value, options, change) => h('label.field', { for: id }, [
        h('span.small', { text: label }),
        h('select', { id: id, onchange: (event) => { change(event.target.value); redraw(); } }, options.map((item) => h('option', { value: item[0], selected: item[0] === value, text: item[1] }))),
      ]);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Two replies' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('p.small.prefer-note', { text: 'Prompt: ' + P.PROMPT + ' Replies: 4 and 22. Language model: none. Dataset: the four rows below, not a sample. Gauge: the score of 22 is fixed at 0. Objective: expected fitted score, minus beta times KL to the reference you set. Completion is saved. These tables are computed again when you optimize. They are not stored in the save file.' }),
        h('h3', { text: '1. Predict before you fit' }),
        preferenceTable(h),
        h('p.small', { text: 'Reference for the first comparison: probability 1/2 on each reply. The lecture 14 slide titled Bradley-Terry model says better trajectories are exponentially more likely to be chosen based on their reward. Here that is a sigmoid of the score gap.' }),
        ask(h, PREDICT),
      ];
      if (state.step >= 1) {
        kids.push(
          h('h3', { text: '2. Fit the scores and maximize them at beta 0' }),
          h('p', { text: 'Maximize the Bradley-Terry likelihood of these four rows. Then maximize expected score with beta at 0. KL is computed and shown. It is not subtracted.' }),
          h('button.btn', { id: 'prefer-run', type: 'button', onclick: () => { const row = measure({ beta: '0', scale: '1', ref: 'uniform' }); state.ran = row; remember(row); if (state.step < 2) state.step = 2; redraw(); } }, 'Fit scores and optimize at beta 0'),
        );
        if (state.ran) {
          const exactNote = Math.abs(state.ran.fit.gap - Math.log(3)) < 1e-8 ? ' The gap matches ln 3, which is log(3/1) for these counts.' : '';
          kids.push(
            h('p.small', { id: 'prefer-fit', role: 'status', text: 'Wins: 4 three times, 22 once. Score of 4: ' + num(state.ran.fit.scores.four) + '. Score of 22: 0. Log likelihood: ' + num(state.ran.fit.logLikelihood) + '.' + exactNote }),
            meters(h, state.ran.policy.pi),
            policyTable(h, [state.ran]),
          );
        }
      }
      if (state.step >= 2 && state.ran) kids.push(h('h3', { text: '3. Diagnose the beta 0 result' }), ask(h, DIAGNOSE));
      if (state.step >= 3) {
        kids.push(
          h('h3', { text: '4. Repair by optimizing the same scores again' }),
          h('p', { text: 'Keep the same four rows. A positive beta uses the reward-tilted reference: probability proportional to reference times exp(score / beta). That is not a promise against concentration. Collect the four measurements. The controls move to the next one after each accepted row.' }),
          select('prefer-beta', 'Beta', state.controls.beta, [['ln3', 'beta = ln 3'], ['0', 'beta = 0']], (value) => { state.controls.beta = value; }),
          select('prefer-scale', 'Reward scale', state.controls.scale, [['1', 'scale 1'], ['2', 'scale 2'], ['4', 'scale 4'], ['8', 'scale 8']], (value) => { state.controls.scale = value; }),
          select('prefer-ref', 'Reference', state.controls.ref, [['uniform', 'Uniform reference'], ['hole', 'Reference never says 4']], (value) => { state.controls.ref = value; }),
          h('button.btn', { id: 'prefer-optimize', type: 'button', onclick: () => {
            const row = measure(state.controls);
            const tag = remember(row);
            const next = NEED.find((id) => !state.got[id]);
            const plan = { tilt: { beta: 'ln3', scale: '1', ref: 'uniform' }, hot: { beta: 'ln3', scale: '8', ref: 'uniform' }, hole: { beta: 'ln3', scale: '1', ref: 'hole' }, hole0: { beta: '0', scale: '1', ref: 'hole' } };
            if (next) state.controls = Object.assign({}, plan[next]);
            if (NEED.every((id) => state.got[id]) && state.step < 4) state.step = 4;
            state.lastTag = tag;
            redraw();
          } }, 'Optimize this policy'),
          h('ul.prefer-check', null, [
            ['tilt', 'Positive beta, scale 1, uniform reference: tilted, nearer one half than probability 1.'],
            ['hot', 'Same positive beta, scale 8, same uniform reference: probability of 4 above 0.999.'],
            ['hole', 'Same positive beta, scale 1, reference that never says 4: probability of 4 is 0.'],
            ['hole0', 'Beta 0, scale 1, that same hole: probability of 4 is 1, and KL is infinite.'],
          ].map((item) => h('li', { text: (state.got[item[0]] ? 'Measured. ' : 'Still needed. ') + item[1] }))),
        );
        if (state.rows.length) {
          const latest = state.rows[0];
          const formula = latest.closed ? ' Tilted-reference formula for 4: ' + num(latest.closed.four) + '. Numerical optimum: ' + num(latest.policy.pi.four) + '.' : '';
          kids.push(
            h('p.small', { id: 'prefer-status', role: 'status', text: 'Latest row tag: ' + latest.tag + '.' + formula + (latest.policy.klInObjective ? ' Objective subtracts beta times KL.' : ' Objective does not subtract KL.') }),
            meters(h, latest.policy.pi),
            policyTable(h, state.rows.slice(0, 6)),
          );
        }
      }
      if (state.step >= 4 && ready) {
        kids.push(
          h('h3', { text: '5. Explain the beta limit and the support' }),
          h('p.small', { text: 'The slide titled Reference model regularization says the regularizer is there to avoid nonsense text and to avoid exploiting an imperfect reward model. In this toy the positive-beta optimum is the tilted reference. It keeps probability 0 on a reply the reference never says. It does not, by itself, stop a large score-to-beta ratio from concentrating. Multiplying the scores by 8 at beta = ln 3 is the same tradeoff as dividing beta by 8. Pass or fail is still the verifier lesson. These rows do not train a language model.' }),
          ask(h, EXPLAIN),
        );
      }
      if (state.step >= 5 || state.finished) {
        const next = C.levels[C.levels.findIndex((level) => level.id === 'prefer') + 1];
        kids.push(
          h('button.btn', {
            id: 'prefer-complete', type: 'button',
            disabled: !(state.picks['prefer-x'] != null || (hooks.prior && hooks.prior('prefer-x'))),
            onclick: () => {
              state.finished = true;
              state.step = 5;
              if (hooks.complete) hooks.complete();
              if (hooks.reveal) hooks.reveal('btref');
              redraw();
            },
          }, state.finished || (hooks.done && hooks.done()) ? 'Lesson complete' : 'Record this comparison'),
          next ? h('button.btn.ghost', { id: 'prefer-next', type: 'button', onclick: () => hooks.openNext && hooks.openNext() }, 'Next level: ' + next.title) : null,
        );
      }
      body.replaceChildren.apply(body, kids);
      lab.replaceChildren(rules(h), h('section.card', null, [
        h('h3', { text: 'What this toy is' }),
        h('p.small', { text: 'Two actions. Fixed pairwise preferences. A computed Bradley-Terry score. Then the exact optimum of expected score with and without KL. A hand-written probability is not the result. The numbers on the left are the optimizer output.' }),
      ]));
    };
    redraw();
  };
})(window.CONTENT, window.BBPREFER);
