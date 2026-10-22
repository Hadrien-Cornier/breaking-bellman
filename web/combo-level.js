// Lecture 18, heading "COMBO: Conservative Model-Based RL".
// Illustrative backup only. This file does not import mopo.
(function (C, M) {
  'use strict';
  if (!C || !M || !M.backup) throw new Error('combo lesson requires CONTENT and BBCOMBO');
  C.worldNames.combo = 'One hole';
  const lesson = {
    id: 'combo', custom: true, phase: 4, world: 'combo', title: 'The imagined leap looks better', focus: [],
    intro: 'Four data transitions stay on the lane. The leap is the hole: its frequency in the data is 0. A model sample still has a Bellman target there. The backup adds that target and subtracts a coefficient times how far the sampled action\'s frequency is from the action frequencies in the data. Coefficient 0 is the ordinary backup, including off the data.',
    goal: { text: 'On the original data, coefficient 0 takes the leap. Raise the coefficient on the same samples until the leap value drops below the stay value and the planner stays. The leap target stays higher, so the penalty can reject a valuable novel action.' },
  };
  if (!C.levels.some((item) => item.id === 'combo')) {
    const thawAt = C.levels.findIndex((item) => item.id === 'thaw');
    const mixedAt = C.levels.findIndex((item) => item.id === 'mixed');
    if (thawAt >= 0) C.levels.splice(thawAt + 1, 0, lesson);
    else if (mixedAt >= 0) C.levels.splice(mixedAt + 1, 0, lesson);
    else C.levels.push(lesson);
  }
  C.paperLinks = C.paperLinks || {};
  C.paperLinks.combo = [
    { t: 'Lecture 18 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-18.pdf' },
  ];

  const PREDICT = {
    id: 'combo-p',
    prompt: 'The data is four stay transitions. The leap sample has Bellman target 6. The stay sample has target 2. The coefficient is 0. Which action does the planner take?',
    options: [
      { key: 'zero', result: 'Stay. An action missing from the data is scored 0.', correct: false, why: 'Coefficient 0 subtracts nothing. The leap keeps its target of 6, and 6 is larger than 2.' },
      { key: 'leap', result: 'The leap. Coefficient 0 keeps the target 6, which is larger than 2.', correct: true, why: 'The ordinary backup adds the model target and subtracts 0, including for the hole.' },
      { key: 'mask', result: 'Stay. The planner may choose only an action that appears in the data.', correct: false, why: 'There is no hard mask. At coefficient 0 the leap is a legal imagined action, and its value is 6.' },
    ],
  };
  const DIAGNOSE = {
    id: 'combo-d',
    prompt: 'Coefficient 0 took the leap. What did that update use?',
    options: [
      { key: 'copy', result: 'A leap transition copied from the data.', correct: false, why: 'The four data rows are stay, next lane. The leap sample is the model, and its next state is the hole.' },
      { key: 'target', result: 'The Bellman target of the model sample. Coefficient 0 subtracted nothing.', correct: true, why: 'Leap target is reward 0 plus gamma 1 times the hole continuation 6. The penalty term is 0.' },
      { key: 'clamp', result: 'A clamp that replaced the leap target with 0.', correct: false, why: 'A clamp to 0 would make the leap lose to stay. The measured leap value at coefficient 0 is 6.' },
    ],
  };
  const EXPLAIN = {
    id: 'combo-x',
    prompt: 'Which account matches the backup you measured?',
    options: [
      { key: 'mask', result: 'Off-data values are set to 0 at every coefficient, and that rule is the COMBO loss.', correct: false, why: 'At coefficient 0 the leap value is the target 6. At coefficient 10 it is -4, not 0. The COMBO paper loss is open.' },
      { key: 'flat', result: 'The leap value drops once, then sticks, so the drop is not proportional to the coefficient.', correct: false, why: 'On this data the distance is 1. Each extra 1 of coefficient lowers the leap value by 1, including below 0.' },
      { key: 'penalty', result: 'The value is the target minus the coefficient times the distance. A large coefficient can reject a higher leap target. The COMBO paper loss is still open.', correct: true, why: 'Distance 0 leaves the target unchanged. The lecture heading is COMBO: Conservative Model-Based RL. This page does not compute that paper\'s loss.' },
    ],
  };

  const state = {
    pred: null, diag: null, explain: null, coefficient: 0, stayCount: 4, leapCount: 0, pack: null,
  };
  let redraw = null;
  const css = '#combo-lesson,#combo-rules{max-width:100%;overflow-wrap:anywhere}#combo-lesson .btn,#combo-lesson .opt,#combo-rules .btn{min-height:44px;max-width:100%;white-space:normal}#combo-lesson .nums{font-family:var(--font-mono);font-size:.82rem;overflow-wrap:anywhere}#combo-lesson .hole{width:100%;height:auto;display:block}#combo-lesson .row{flex-wrap:wrap}';

  function ensureCss() {
    if (document.getElementById('combo-css')) return;
    const style = document.createElement('style');
    style.id = 'combo-css';
    style.textContent = css;
    document.head.append(style);
  }

  function fmt(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 'undefined';
    return String(Math.round(x * 1000) / 1000);
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'data-key': o.key, 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', null, [h('b', { text: (o.correct ? 'Sound chain. ' : 'Not this one. ') }), o.why]) : null,
    ]))));
  }

  function hole() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 140');
    svg.setAttribute('class', 'hole');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Start on the left. The lane is in the data. The hole on the right is empty of data.');
    const el = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (text) node.textContent = text;
      svg.append(node);
    };
    el('rect', { x: 16, y: 28, width: 80, height: 64, rx: 8, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 3 });
    el('rect', { x: 120, y: 28, width: 80, height: 64, rx: 8, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 3 });
    el('rect', { x: 224, y: 28, width: 80, height: 64, rx: 8, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '6 4' });
    el('text', { x: 56, y: 66, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 14 }, 'Start');
    el('text', { x: 160, y: 66, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 14 }, 'Lane');
    el('text', { x: 264, y: 66, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 14 }, 'Hole');
    el('text', { x: 56, y: 118, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 12 }, 'now');
    el('text', { x: 160, y: 118, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 12 }, 'stay, in data');
    el('text', { x: 264, y: 118, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 12 }, 'leap, no data');
    return svg;
  }

  function rowLine(row, freq) {
    const count = freq.counts[row.action];
    return row.action + '. Data frequency ' + count + '/' + freq.total + '. Sample frequency 1. Distance ' + fmt(row.distance) + '. Target ' + fmt(row.target) + '. Penalty ' + fmt(row.penalty) + '. Value ' + fmt(row.value) + '.';
  }

  function readout(h, pack) {
    const leap = pack.rows.leap;
    const stay = pack.rows.stay;
    const action = pack.plan.action || 'tie';
    return h('div.stack', {
      id: 'combo-readout',
      'data-coefficient': String(pack.coefficient),
      'data-action': action,
      'data-reason': pack.plan.reason,
      'data-leap-target': fmt(leap.target),
      'data-leap-distance': fmt(leap.distance),
      'data-leap-value': fmt(leap.value),
      'data-leap-penalty': fmt(leap.penalty),
      'data-stay-target': fmt(stay.target),
      'data-stay-distance': fmt(stay.distance),
      'data-stay-value': fmt(stay.value),
      'data-stay-count': String(pack.frequencies.counts.stay),
      'data-leap-count': String(pack.frequencies.counts.leap),
      'data-paper': pack.paperLoss,
    }, [
      h('p.nums', { text: 'Leap target = reward ' + fmt(leap.reward) + ' + gamma ' + fmt(leap.gamma) + ' * hole continuation ' + fmt(leap.nextValue) + '.' }),
      h('p.nums', { text: 'Stay target = reward ' + fmt(stay.reward) + ' + gamma ' + fmt(stay.gamma) + ' * lane continuation ' + fmt(stay.nextValue) + '.' }),
      h('p.nums', { text: rowLine(stay, pack.frequencies) }),
      h('p.nums', { text: rowLine(leap, pack.frequencies) }),
      h('p.nums', { text: 'Planner: ' + action + ' (' + pack.plan.reason + '). Coefficient ' + fmt(pack.coefficient) + '.' }),
    ]);
  }

  function sweepBlock(h, data) {
    const leap = M.lessonSamples()[1];
    const marks = [0, 2, 4, 5, 10];
    const bits = marks.map((coefficient) => {
      const row = M.backup(leap, data, coefficient);
      return 'coefficient ' + coefficient + ' value ' + fmt(row.value);
    });
    const v0 = M.backup(leap, data, 0);
    const v2 = M.backup(leap, data, 2);
    const v4 = M.backup(leap, data, 4);
    return h('p.nums', {
      id: 'combo-sweep',
      'data-v0': fmt(v0.value),
      'data-v2': fmt(v2.value),
      'data-v4': fmt(v4.value),
      'data-v10': fmt(M.backup(leap, data, 10).value),
      'data-drop': fmt(v0.value - v2.value),
      'data-drop2': fmt(v2.value - v4.value),
      'data-distance': fmt(v0.distance),
      text: bits.join('. ') + '. Drop from 0 to 2 is ' + fmt(v0.value - v2.value) + '. Drop from 2 to 4 is ' + fmt(v2.value - v4.value) + '. Distance is ' + fmt(v0.distance) + '. Coefficient 10 is ' + fmt(M.backup(leap, data, 10).value) + ', and it is not clamped to 0.',
    });
  }

  function limitBlock(h, pack) {
    const leap = pack.rows.leap;
    const stay = pack.rows.stay;
    const rejects = leap.target > stay.target && leap.value < stay.value && pack.plan.action === 'stay';
    const text = rejects
      ? 'The leap target is ' + fmt(leap.target) + ' and the stay target is ' + fmt(stay.target) + '. The leap value is ' + fmt(leap.value) + '. The planner stays. If the hole continuation of ' + fmt(leap.nextValue) + ' is real, this coefficient still rejects the leap.'
      : 'The leap target is ' + fmt(leap.target) + ' and the stay value is ' + fmt(stay.value) + '. At this coefficient the planner does not reject a higher leap target.';
    return h('p.small', { id: 'combo-limit', 'data-rejects': rejects ? 'yes' : 'no', text: text });
  }

  function freshPack() {
    return M.study(M.dataset(state.stayCount, state.leapCount), state.coefficient);
  }

  M.cancel = () => {};
  M.state = () => ({
    world: 'combo',
    sentenceName: 'Illustrative conservative imagined backup',
    mode: 'campaign',
    level: lesson.title,
    knobs: { coefficient: state.coefficient, stay: state.stayCount, leap: state.leapCount, gamma: 1 },
    words: {},
    idleWords: {},
    discovered: [],
    lastRun: state.pack ? {
      seeds: 1,
      steps: state.pack.frequencies.total,
      symptoms: [],
      summary: {
        action: state.pack.plan.action,
        coefficient: state.pack.coefficient,
        leap: state.pack.rows.leap.value,
        stay: state.pack.rows.stay.value,
      },
    } : null,
  });
  M.run = () => {
    state.coefficient = 0;
    state.stayCount = 4;
    state.leapCount = 0;
    state.pack = M.study(M.lessonData(), 0);
    if (redraw) redraw();
    return state.pack;
  };

  M.mount = (pane, lab, api) => {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('combo-p'); const d0 = saved('combo-d'); const x0 = saved('combo-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step = api.step ? api.step() : 0;
    if (step >= 2 && !state.pack) state.pack = freshPack();
    const h = api.h;
    const body = h('div.card.stack', { id: 'combo-lesson' });
    pane.append(body);

    function advance(n) { if (api.markStep) api.markStep(n); }

    function apply(coefficient, stayCount, leapCount) {
      state.coefficient = coefficient;
      state.stayCount = stayCount;
      state.leapCount = leapCount;
      state.pack = freshPack();
      if (stayCount === 4 && leapCount === 0 && coefficient > 0 && state.pack.plan.action === 'stay') advance(4);
      redraw();
    }

    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((item) => item.id === 'combo') + 1;
      const pack = state.pack;
      const data = M.dataset(state.stayCount, state.leapCount);
      const onLesson = state.stayCount === 4 && state.leapCount === 0;
      const explainOk = !!(pack && onLesson && state.explain != null && EXPLAIN.options[state.explain].correct
        && pack.coefficient > 0 && pack.plan.action === 'stay'
        && pack.rows.leap.target > pack.rows.stay.target
        && pack.rows.leap.value < pack.rows.stay.value
        && pack.rows.leap.value === pack.rows.leap.target - pack.coefficient * pack.rows.leap.distance);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · One hole' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        hole(),
        h('p.small', { text: 'Lecture 18 heading: ' + M.HEADING + '. This page is an illustrative conservative imagined backup for that heading. The COMBO paper loss is open. This toy does not reproduce that loss.' }),
        h('p.small', null, [
          h('a', { href: C.paperLinks.combo[0].u, target: '_blank', rel: 'noopener' }, 'CS 285 lecture 18 slides'),
        ]),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => {
          state.pred = i;
          if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct);
          advance(1);
          redraw();
        }),
      ];
      if ((api.step ? api.step() : 0) >= 1 || state.pred != null) {
        kids.push(
          h('h3', { text: '2. Run' }),
          h('p', { text: 'Back up both model samples at coefficient 0. The data frequencies stay 4 stay and 0 leap. The hole continuation is an input of the model sample, not a row of the data.' }),
          h('button.btn', { id: 'combo-run', type: 'button', onclick: () => { M.run(); advance(2); redraw(); } }, 'Back up at coefficient 0'),
        );
        if (pack && state.diag == null) {
          kids.push(readout(h, pack));
          kids.push(sweepBlock(h, data));
        }
      }
      if (pack && (api.step ? api.step() : 0) >= 2) {
        kids.push(h('h3', { text: '3. Diagnose' }), choice(h, DIAGNOSE, state.diag, (i) => {
          state.diag = i;
          if (api.recordAnswer) api.recordAnswer(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct);
          advance(3);
          redraw();
        }));
      }
      if (pack && state.diag != null) {
        const coefs = [0, 2, 4, 5];
        kids.push(
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Same two samples. Change the coefficient, or change how often leap appears in the data. The model continuations stay 2 and 6. Distance 0 leaves a target alone. A tie is not a choice.' }),
          h('div.row', { id: 'combo-coefs' }, coefs.map((coefficient) => h('button.btn' + (state.coefficient === coefficient ? '' : '.ghost'), {
            type: 'button', id: 'combo-coef-' + coefficient, 'aria-pressed': state.coefficient === coefficient ? 'true' : 'false',
            onclick: () => apply(coefficient, state.stayCount, state.leapCount),
          }, 'Coefficient ' + coefficient))),
          h('div.row', { id: 'combo-data' }, [
            [4, 0, 'combo-data-lesson', 'Data: 4 stay, 0 leap'],
            [2, 2, 'combo-data-half', 'Data: 2 stay, 2 leap'],
            [0, 4, 'combo-data-leap', 'Data: 0 stay, 4 leap'],
          ].map(([stayCount, leapCount, id, label]) => h('button.btn' + (state.stayCount === stayCount && state.leapCount === leapCount ? '' : '.ghost'), {
            type: 'button', id: id, 'aria-pressed': state.stayCount === stayCount && state.leapCount === leapCount ? 'true' : 'false',
            onclick: () => apply(state.coefficient, stayCount, leapCount),
          }, label))),
          readout(h, pack),
          sweepBlock(h, data),
          limitBlock(h, pack),
          h('p.small', { text: onLesson && pack.crossover != null ? 'On this data the two values meet at coefficient ' + fmt(pack.crossover) + '.' : 'These frequencies do not meet at a positive coefficient that switches the planner to stay.' }),
        );
      }
      if ((api.step ? api.step() : 0) >= 4 && pack && onLesson && pack.plan.action === 'stay') {
        kids.push(
          h('h3', { text: '5. Explain' }),
          choice(h, EXPLAIN, state.explain, (i) => {
            state.explain = i;
            if (api.recordAnswer) api.recordAnswer(EXPLAIN.id, i, !!EXPLAIN.options[i].correct);
            redraw();
          }),
          h('button.btn', {
            id: 'combo-complete', type: 'button', disabled: !explainOk,
            onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); },
          }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [
            h('summary', { text: 'Toy assumptions' }),
            h('p.small', { text: 'Two actions and one imagined step. The model continuations are given. Gamma is 1. The distance is total variation, and with two actions it equals the absolute gap between 1 and the data frequency of the sampled action. A coefficient of 0 returns the Bellman target off the data as well as on it. Values are not clamped. A large coefficient can reject a leap whose target is higher than stay. No neural network and no offline benchmark. The COMBO paper loss remains open.' }),
          ]),
        );
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'combo-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };

    const rules = h('section.card.game-rules', { id: 'combo-rules' }, [
      h('h3', { text: 'Game rules · One hole' }),
      h('dl', null, [
        row(h, 'Goal', lesson.goal.text),
        row(h, 'Reward each step', 'The model sample\'s reward. Both lesson samples use reward 0 and a continuation.'),
        row(h, 'Equation', 'Value = Bellman target - coefficient * distance. A continuing sample has target = reward + gamma * next value. A terminal sample has target = reward.'),
        row(h, 'Distance', M.DISTANCE + '. Sample frequency of the chosen action is 1. Units: ' + M.UNITS.distance + '. Coefficient units: ' + M.UNITS.coefficient + '.'),
        row(h, 'Episode ends', 'One imagined step. The continuation is a number on the sample.'),
        row(h, 'Score', 'The planner takes the unique larger value. Equal values are a tie and not a choice.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]);
    lab.replaceChildren(rules, h('section.card', null, [
      h('h3', { text: 'The lane and the hole' }),
      hole(),
      h('p.small', { text: 'Stay is in the original data. Leap is the hole. The dashed cell has no data row until you add leap counts.' }),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBCOMBO);
