// Open-loop search versus replanning on a known noisy corridor.
(function (C, R) {
  'use strict';
  if (!C || !R) throw new Error('replan lesson requires CONTENT and BBREPLAN');
  C.worldNames.replan = 'Noisy corridor';
  const lessonGoal = 'See an open-loop plan hit the wall on one fixed disturbance schedule, and a replan from the observed cell recover, using the same model and the same search on every plan.';
  C.levels.push({
    id: 'replan', custom: true, phase: 8, world: 'replan', title: 'Plan once, or replan',
    intro: 'The mean model of this corridor is given. It is not fitted. Score action sequences on that model, then compare driving the whole sequence with replanning from the cell you actually reach.',
    goal: { text: lessonGoal },
  });
  const QUESTIONS = {
    predict: {
      id: 'replan-p',
      prompt: 'For the +1, +1, 0, 0 lesson schedule, the planner scores every 4-action sequence on the mean model and then drives the winner without looking again. The disturbance schedule is +1, +1, 0, 0 for both controllers. What should you expect?',
      options: [
        { text: 'The model is known, so the open-loop car stays in the corridor.', correct: false, why: 'A known mean model still drops this disturbance. A perfect mean-model score is not the true corridor.' },
        { text: 'The plan can score well on the mean model and still hit the wall, because the schedule is not the mean and the car never looks again.', correct: true, why: 'The search is about the mean model. Open-loop commits to that sequence, so a shove stays in the state.' },
        { text: 'Open-loop is given a larger shove than replan, so only the open-loop car hits the wall.', correct: false, why: 'Both controllers use one schedule, fixed before the comparison. The noise is not chosen separately.' },
      ],
    },
    diagnose: {
      id: 'replan-d',
      prompt: 'The open-loop car reached the wall. What happened?',
      options: [
        { text: 'The search maximized the mean-model score from the start, then drove that sequence without reading the true cell.', correct: true, why: 'The winner was chosen for the start cell. Later actions were not chosen again after the shove.' },
        { text: 'Replan was handed a different disturbance on the same steps.', correct: false, why: 'The schedule is one list. Both controllers are measured together. The difference is that open-loop does not observe.' },
        { text: 'The sequence was copied from a dataset of crashes.', correct: false, why: 'There is no dataset and no learning update. The one-step mean model was given.' },
      ],
    },
    explain: {
      id: 'replan-x',
      prompt: 'What does replanning change here, and what does it leave open?',
      options: [
        { text: 'Replanning fitted the disturbance, so the model is now correct.', correct: false, why: 'Nothing was fitted. Every plan still uses the same mean model, which treats future disturbances as zero.' },
        { text: 'A longer open-loop horizon would remove the error, because the plan would see further.', correct: false, why: 'A longer horizon commits to more steps of a model that is wrong on this sample. The gap between predicted return and true return is that error.' },
        { text: 'The next plan starts at the observed cell, so a shove that already happened is no longer hidden. Future disturbances are still treated as zero. This one schedule is not every stochastic task.', correct: true, why: 'Replanning folds the past disturbance into the state. It does not make the mean model true for the future, and a shove of +2 still crashes both cars.' },
      ],
    },
  };
  const state = { step: 0, picks: {}, open: null, closed: null, limits: null, finished: false,
    schedule: 'lesson', record: null, stale: false, t: 0, mounted: false };
  let hooks = {}, redraw = null, timer = null, scene = null;
  function advance(n) { state.step = Math.max(state.step, n); if (hooks.mark) hooks.mark(n); }
  R.cancel = () => { clearInterval(timer); timer = null; };
  R.unmount = () => { R.cancel(); state.mounted = false; state.record = null; state.t = 0; state.stale = false; };
  R.run = async () => {
    if (state.mounted && state.picks[QUESTIONS.predict.id] == null) return null;
    R.cancel();
    state.record = BBReplanRecord.create(state.schedule);
    state.open = state.record.comparison.open;
    state.closed = state.record.comparison.closed;
    state.limits = null;
    state.stale = false; state.t = 0; advance(2);
    if (redraw) redraw();
    return state.record;
  };
  R.state = () => ({ world: 'replan', level: 'Plan once, or replan', mode: 'campaign',
    knobs: { schedule: state.schedule }, lastRun: state.record, record: state.record, stale: state.stale,
    replay: { t: state.t, playing: !!timer }, version: 'replan-replay-v2' });

  function fmt(n) { return String(n); }
  function pathText(path) {
    return path.map((y) => Math.abs(y) >= R.WALL ? 'wall' : String(y)).join(' ');
  }
  function questionBlock(h, q, onAnswer) {
    const picked = state.picks[q.id];
    return h('div.mc', { id: q.id }, [
      h('p', { text: q.prompt }),
      ...q.options.map((opt, index) => h('button.opt' + (picked === index ? '.picked' : '') + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
        type: 'button',
        onclick: () => {
          state.picks[q.id] = index;
          if (hooks.record) hooks.record(q.id, index, !!opt.correct);
          onAnswer(opt, index);
          redraw();
        },
      }, [
        h('span', { text: opt.text }),
        picked === index ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + opt.why }) : null,
      ])),
    ]);
  }
  function cells(h, path) {
    const shown = path.slice(0, R.HORIZON + 1);
    while (shown.length < R.HORIZON + 1) shown.push(null);
    return h('div.replan-track', { style: 'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px' }, shown.map((y) => {
      if (y == null) return h('span.replan-cell', { text: 'ended' });
      const wall = Math.abs(y) >= R.WALL;
      const cls = wall ? 'wall' : y === 0 ? 'center' : 'edge';
      return h('span.replan-cell.' + cls, { style: 'text-align:center;min-height:26px', text: wall ? 'wall' : String(y) });
    }));
  }
  function board(h, open, closed) {
    const rows = [
      h('div', null, [h('p.small', { text: 'Mean-model plan from the start: ' + pathText(open.predictedPath) }), cells(h, open.predictedPath)]),
      h('div', null, [h('p.small', { text: 'Open-loop on this schedule: ' + pathText(open.path) }), cells(h, open.path)]),
    ];
    if (closed) rows.push(h('div', null, [h('p.small', { text: 'Replan on the same schedule: ' + pathText(closed.path) }), cells(h, closed.path)]));
    return h('div', { id: 'replan-board' }, [
      h('h3', { text: 'Corridor cells' }),
      h('p.small', { text: 'Time runs left to right. Center is 0. Cells -1 and 1 are still in the corridor. Wall means -2 or +2, and the episode stops.' }),
      ...rows,
    ]);
  }
  function metrics(h, open, closed) {
    const same = open.budgetPerPlan.candidates === closed.budgetPerPlan.candidates && open.budgetPerPlan.horizon === closed.budgetPerPlan.horizon && open.model === closed.model;
    return h('div.vpo-table', {
      id: 'replan-metrics', tabindex: '0', role: 'region', 'aria-label': 'Planning budget and returns',
      'data-candidates': String(open.budgetPerPlan.candidates),
      'data-horizon': String(open.budgetPerPlan.horizon),
      'data-same-budget': same ? 'yes' : 'no',
      'data-open-return': fmt(open.trueReturn),
      'data-open-predicted': fmt(open.predictedReturn),
      'data-open-plans': String(open.plans),
      'data-open-steps': String(open.modelSteps),
      'data-open-crash': open.crashed ? 'yes' : 'no',
      'data-open-actions': open.actions.join(','),
      'data-replan-return': fmt(closed.trueReturn),
      'data-replan-plans': String(closed.plans),
      'data-replan-steps': String(closed.modelSteps),
      'data-replan-crash': closed.crashed ? 'yes' : 'no',
      'data-replan-actions': closed.actions.join(','),
    }, h('table', null, [
      h('thead', null, h('tr', null, ['', 'Open-loop', 'Replan'].map((text) => h('th', { scope: 'col', text })))),
      h('tbody', null, [
        ['True return', fmt(open.trueReturn), fmt(closed.trueReturn)],
        ['Mean-model return of the first plan', fmt(open.predictedReturn), fmt(closed.predictedReturn)],
        ['Plans', String(open.plans), String(closed.plans)],
        ['Sequences scored per plan', String(open.budgetPerPlan.candidates), String(closed.budgetPerPlan.candidates)],
        ['Horizon per plan', String(open.budgetPerPlan.horizon), String(closed.budgetPerPlan.horizon)],
        ['Mean-model steps, total', String(open.modelSteps), String(closed.modelSteps)],
        ['Hit the wall', open.crashed ? 'yes' : 'no', closed.crashed ? 'yes' : 'no'],
      ].map((row) => h('tr', null, row.map((text) => h('td', { text }))))),
    ]));
  }
  R.mount = (pane, lab, api) => {
    R.cancel(); hooks = api || {};
    state.step = hooks.step ? hooks.step() : 0;
    state.finished = hooks.done ? hooks.done() : false;
    if (!state.mounted) {
      state.record = null; state.open = null; state.closed = null; state.limits = null;
      state.schedule = 'lesson'; state.t = 0; state.stale = false;
    }
    state.mounted = true; state.picks = {};
    for (const q of Object.values(QUESTIONS)) {
      const prev = hooks.answer ? hooks.answer(q.id) : null;
      if (prev) state.picks[q.id] = prev.choice;
    }
    const h = hooks.h, lesson = C.levels.find(l => l.id === 'replan');
    const body = h('div.card.stack.teaching-card', { id: 'replan-lesson' }); pane.append(body);
    const sceneHost = h('section.card.stack', { id: 'replan-scene', 'aria-label': 'Noisy corridor measured scene' });
    lab.replaceChildren(sceneHost);
    const notebook = section => hooks.shell ? hooks.shell.notebook(section) : null;
    const put = (section, children) => { const node = notebook(section); if (node) node.replaceChildren(...children); };
    const draw = (el, record, t) => {
      if (t === null) return R.HORIZON + 1;
      const frame = record ? BBReplanRecord.frame(record, t) : null;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 340 195'); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Shared corridor clock. Rover+ robots are measured cells; outlined squares are first-plan predictions.');
      function shape(tag, attrs, text) {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        if (text != null) node.textContent = text; svg.append(node);
      }
      for (const [i, label] of ['Open-loop', 'Replan'].entries()) {
        const y = 58 + i * 92;
        shape('text', { x: 8, y: y - 25, fill: 'currentColor', 'font-size': 14 }, label);
        for (let cell = -2; cell <= 2; cell++) {
          const x = 38 + (cell + 2) * 66;
          shape('rect', { x: x - 25, y: y - 15, width: 50, height: 30, fill: 'none', stroke: 'currentColor', 'stroke-dasharray': Math.abs(cell) === 2 ? '3 3' : 'none' });
          shape('text', { x, y: y + 34, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 12 }, Math.abs(cell) === 2 ? 'wall ' + cell : String(cell));
        }
        const policy = frame && frame.policies[i];
        const measured = policy ? policy.obs : 0;
        if (policy) shape('rect', { x: 30 + (policy.prediction + 2) * 66, y: y - 22, width: 16, height: 16,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-dasharray': '3 2' });
        const rover = document.createElement('canvas'); rover.width = 88; rover.height = 88;
        BB.scenes.robot(rover.getContext('2d'), 44, 77, 62, { mood: policy?.terminal === 'wall' && policy.ended ? 'sad' : 'happy', noShadow: true });
        shape('image', { x: 17 + (measured + 2) * 66, y: y - 27, width: 42, height: 42, href: rover.toDataURL() });
        shape('text', { x: 38 + (measured + 2) * 66, y: y + 17, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 11 }, i ? 'R' : 'O');
      }
      el.replaceChildren(svg);
      if (record) el.dataset.run = record.id; else delete el.dataset.run;
    };
    const visual = h('div', { id: 'replan-stage' });
    scene = BB.sceneAdapter.create({ world: 'replan', settings: ['schedule'], render: draw });
    const updateClock = () => {
      if (!body.isConnected) { R.cancel(); return; }
      if (state.record) scene.draw(state.record, state.t);
      const slider = sceneHost.querySelector('#replan-time'); if (slider) slider.value = String(state.t);
      const clock = sceneHost.querySelector('#replan-clock');
      if (clock) clock.textContent = state.record ? 'Shared time ' + state.t + ' / 4. Disturbance: ' + (state.t ? state.record.comparison.disturbance[state.t - 1] : 'not applied yet') + (state.stale ? '. Settings changed. Run again.' : '') : 'Start at cell 0. Run to measure both controllers.';
      for (const cell of [...lab.querySelectorAll('[data-time]'), ...(notebook('curve')?.querySelectorAll('[data-time]') || [])]) {
        cell.setAttribute('aria-current', Number(cell.dataset.time) === state.t ? 'step' : 'false');
        cell.style.outline = Number(cell.dataset.time) === state.t ? '2px solid currentColor' : '';
      }
      const watch = sceneHost.querySelector('#replan-watch'); if (watch) watch.textContent = timer ? 'Pause' : 'Watch';
      const readout = sceneHost.querySelector('#replan-frame');
      if (readout && state.record) readout.textContent = BBReplanRecord.frame(state.record, state.t).policies.map(p => p.label + ': cell ' + p.obs + ', action ' + (p.action == null ? 'none' : p.action) + (p.ended ? ', ended: ' + p.terminal + ' at time ' + p.sampleTime : '')).join('. ');
    };
    redraw = () => {
      if (!body.isConnected) return;
      const disabled = !state.record || state.stale;
      const select = h('select', { id: 'replan-schedule', 'aria-label': 'Disturbance schedule', style: 'min-height:44px;max-width:100%', onchange: e => {
        R.cancel(); state.schedule = e.target.value; state.stale = !!state.record; redraw();
      } }, Object.entries({ lesson: '+1, +1, 0, 0', zero: '0, 0, 0, 0', uncorrectable: '+2, 0, 0, 0' }).map(([value, text]) => h('option', { value, text })));
      select.value = state.schedule;
      const control = (id, text, onclick) => h('button.btn', { id, type: 'button', disabled: disabled ? true : null, onclick, style: 'min-height:44px;min-width:44px' }, text);
      sceneHost.replaceChildren(h('h3', { text: 'Noisy corridor' }),
        h('p.small', { id: 'replan-rules', text: lessonGoal + ' Safe cells: -1, 0, +1. Walls: -2 and +2. Both controllers receive the same disturbance at each shared time. A wall stops that controller.' }),
        visual, h('p.small', { text: 'Rover+ with O or R: measured cell. Dashed square: first plan under the mean model, assuming zero disturbance.' }),
        h('label', null, ['Change disturbance ', select]),
        h('p', { id: 'replan-clock', role: 'status' }),
        h('div.row', null, [h('button.btn', { id: 'replan-run', type: 'button', style: 'min-height:44px', disabled: state.picks[QUESTIONS.predict.id] == null, onclick: () => R.run() }, state.stale ? 'Run again' : 'Run both controllers'),
          control('replan-watch', 'Watch', () => {
            if (timer) R.cancel(); else if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { if (state.t === 4) state.t = 0; timer = setInterval(() => { state.t++; if (state.t >= 4) R.cancel(); updateClock(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1200 : 700); } updateClock();
          }),
          control('replan-step', 'Step', () => { R.cancel(); state.t = Math.min(4, state.t + 1); updateClock(); }),
          control('replan-replay', 'Replay', () => { R.cancel(); state.t = 0; updateClock(); })]),
        h('label', null, ['Shared time ', h('input', { id: 'replan-time', type: 'range', min: 0, max: 4, step: 1, value: state.t,
          disabled: disabled ? true : null, style: 'min-height:44px', oninput: e => { R.cancel(); state.t = Number(e.target.value); updateClock(); } })]),
        h('p.small', { id: 'replan-frame' }));
      scene.mount(visual);
      if (state.record) {
        sceneHost.dataset.run = state.record.id;
        sceneHost.append(h('p.small', { id: 'replan-accounting', text: 'Measured live on schedule ' + state.record.comparison.disturbance.join(', ') + '. Earlier data: 0 steps. Fresh corridor interactions: ' + state.record.data.fresh.steps + ' steps across 2 evaluation attempts. No training updates.' }));
        const strip = board(h, state.open, state.closed); strip.dataset.run = state.record.id;
        for (const row of strip.querySelectorAll('.replan-track')) [...row.children].forEach((cell, t) => { cell.dataset.time = t; });
        if (notebook('curve')) put('curve', [strip]); else sceneHost.append(strip);
        const result = metrics(h, state.open, state.closed); result.dataset.run = state.record.id;
        sceneHost.append(result);
      } else { delete sceneHost.dataset.run; put('curve', [h('p', { text: 'Run to measure the time strip.' })]); }
      const steps = [
        h('div.step.active', { id: 'replan-step-predict' }, [h('h3', { text: 'Predict before you run' }), questionBlock(h, QUESTIONS.predict, () => advance(1))]),
        h('div.step.active', { id: 'replan-step-run' }, [h('h3', { text: 'Run both controllers above' }), h('p', { text: 'Open-loop commits to one sequence. Replan observes the measured cell and searches again before each action. Watch both on the shared clock.' })]),
        h('div.step.active', { id: 'replan-step-diagnose' }, [h('h3', { text: 'Diagnose the lesson schedule' }), state.record && state.record.settings.schedule === 'lesson' && !state.stale ? questionBlock(h, QUESTIONS.diagnose, () => advance(3)) : h('p', { text: 'Select +1, +1, 0, 0 and Run to diagnose the lesson schedule.' })]),
        h('div.step.active', { id: 'replan-step-repair' }, [h('h3', { text: 'Compare prediction and reality' }), h('p', { text: 'Scrub to time 2. The dashed square still shows the first mean-model plan. Replan uses a new plan from the observed cell. Change the disturbance above and Run again to test its limits.' }), h('button.btn', { id: 'replan-repair', onclick: () => { advance(4); redraw(); } }, 'Explain the difference')]),
        h('div.step.active', { id: 'replan-step-explain' }, [h('h3', { text: 'Explain why it works' }), questionBlock(h, QUESTIONS.explain, () => {})]),
      ];
      const current = !state.record && state.step >= 2 ? 1 : Math.min(state.step, 4);
      body.replaceChildren(h('h2', { text: lesson.title }), h('p', { text: lesson.intro }), steps[current]);
      if (current === 4) body.append(h('button.btn', { id: 'replan-complete', disabled: state.finished || !QUESTIONS.explain.options[state.picks['replan-x']]?.correct ? true : null,
        onclick: () => { hooks.complete?.(); state.finished = true; advance(5); redraw(); } }, state.finished ? 'Lesson complete' : 'Finish lesson'));
      put('notes', current ? steps.slice(0, current) : [h('p.small', { text: 'Lesson notes appear here.' })]);
      put('rule', [h('p', { text: 'Given mean model: next cell = cell + action. Reality adds the disturbance too. Actions are -1, 0, +1. Reward is 1 minus the absolute safe cell, or -5 at a wall. Each plan scores all 81 sequences of four actions. No training data and no learning updates.' })]);
      put('autopsy', [h('p', { text: 'Replanning includes the past shove in the next observed state. Future shoves are still absent from the mean model. Planning cost can differ: each replan searches again. A +2 first shove crashes both controllers.' })]);
      if (hooks.shell) {
        const sketch = hooks.shell.conceptSketch({ label: 'Replan uses the measured cell', nodes: [{ id: 'plan', label: 'Plan', x: 40, y: 55 }, { id: 'act', label: 'Act', x: 150, y: 55 }, { id: 'see', label: 'Observe', x: 270, y: 55 }], edges: [{ from: 'plan', to: 'act' }, { from: 'act', to: 'see' }, { from: 'see', to: 'plan', label: 'Replan' }] });
        body.append(sketch);
      }
      body.append(h('p.small', null, ['Idea adapted from ', h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/', target: '_blank', rel: 'noopener' }, 'Berkeley CS 285'), '.']));
      for (const node of [sceneHost, visual, lab.querySelector('#replan-metrics'), notebook('curve')?.querySelector('#replan-board') || lab.querySelector('#replan-board')]) if (node) node.dataset.stale = String(state.stale);
      updateClock();
    };
    redraw();
  };
})(window.CONTENT, window.BBREPLAN);
