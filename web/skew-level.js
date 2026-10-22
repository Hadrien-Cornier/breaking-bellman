// Lecture 23 goal weights on a 3-bin histogram. The grid and the sampler live here.
// Goal cloning is a different lesson and is not imported.
(function (C, K) {
  'use strict';
  if (!C || !K || !K.practice) throw new Error('BBSKEW missing');
  if (!C.phases.some((p) => p.n === 10.5)) {
    const skillsPhase = C.phases.findIndex((p) => p.n === 10);
    const goalsPhase = C.phases.findIndex((p) => p.n === 9);
    const at = skillsPhase >= 0 ? skillsPhase + 1 : goalsPhase >= 0 ? goalsPhase : C.phases.length;
    C.phases.splice(at, 0, { n: 10.5, title: 'Goal coverage' });
  }
  C.worldNames.skew = 'Three rooms';
  const goalText = 'Fit the anchor visits, refuse the unsmoothed inverse, then sample add-one weights on one shared budget and leave the sealed room unentered.';
  const lesson = {
    id: 'skew', custom: true, phase: 10.5, world: 'skew', title: 'Rare goals need support', focus: [],
    intro: 'Three rooms. The notes record 8 visits in A and none in B or C. Inverse-density goal weights are undefined on a room with count zero. Add-one smoothing gives those rooms a prior, not a visit. A sealed door still does not open.',
    goal: { text: goalText },
  };
  const skillsAt = C.levels.findIndex((l) => l.id === 'skills');
  const sm = C.levels.findIndex((l) => l.id === 'supermimic');
  C.levels.splice(skillsAt >= 0 ? skillsAt + 1 : sm >= 0 ? sm : C.levels.length, 0, lesson);

  const state = {
    pred: null, diag: null, explain: null,
    fitted: null, preview: null, applied: null, pretend: null, custom: null,
    controls: { visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, sealed: 'C', budget: 627, seed: 23 },
    controlError: '',
  };
  let redraw = null;
  const css = '#skew-lesson,#skew-rules{max-width:100%;overflow-wrap:anywhere}#skew-lesson .btn,#skew-lesson .opt,#skew-lesson input,#skew-lesson select,#skew-rules .btn{min-height:44px}#skew-lesson .map{width:100%;height:auto;display:block}#skew-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#skew-lesson .arm{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);min-width:0}#skew-lesson .arms{display:grid;grid-template-columns:1fr;gap:8px}@media (min-width:800px){#skew-lesson .arms{grid-template-columns:1fr 1fr 1fr}}#skew-lesson .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}#skew-lesson .controls label{flex:1 1 120px;min-width:0;display:flex;flex-direction:column;gap:4px;font-size:.85rem}#skew-lesson .controls input,#skew-lesson .controls select{width:100%;box-sizing:border-box}#skew-lesson .track{display:block;height:8px;background:var(--sunk);border-radius:4px;overflow:hidden}#skew-lesson .fill{display:block;height:8px;background:var(--accent)}';

  function ensureCss() {
    if (document.getElementById('skew-css')) return;
    const style = document.createElement('style');
    style.id = 'skew-css';
    style.textContent = css;
    document.head.append(style);
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { html: (o.correct ? '<b>Sound chain.</b> ' : '<b>Not this one.</b> ') + o.why }) : null,
    ]))));
  }

  const PREDICT = {
    id: 'skew-p',
    prompt: 'Visits are 8 in A, 0 in B, and 0 in C. The unsmoothed density is 1, 0, 0. You want weights proportional to one over that density. What can you sample?',
    options: [
      { result: 'B and C, almost surely. A zero density is the rare goal the inverse is for.', correct: false, why: 'One over zero is not a probability. The inverse is undefined on B and C, so this page draws nothing from it.' },
      { result: 'Nothing from the inverse. B and C have no support, and the page must not invent a number for them.', correct: true, why: 'The unsmoothed counts are 8, 0, 0. Inverse weights need a positive count. Uniform, which is a different sampler, still names each room with probability 1/3.' },
      { result: 'Uniform already almost never asks for B, so only the inverse can practice B.', correct: false, why: 'Uniform over the three room names gives B probability 1/3. At 627 attempts the expectation is 209, which is not almost never.' },
    ],
  };
  const DIAGNOSE = {
    id: 'skew-d',
    prompt: 'Add-one makes the inverse defined, and C is requested. C\'s achieved count stays 0, and the reason says the door is sealed. What happened?',
    options: [
      { result: 'The pseudo-count is evidence that C was reached, so the sealed line is a display bug.', correct: false, why: 'Add-one adds a prior to every room, including rooms with no visits. It is not a visit and not a transition.' },
      { result: 'The expectation is how many times the agent entered. If the expectation is high, C was entered.', correct: false, why: 'An expectation is budget times a probability. The observed count is the seeded draw. Achieved counts come from the doors, not from the expectation.' },
      { result: 'The pseudo-count is not a transition. Requests for C were spent in the hall. Reweighting did not open the door.', correct: true, why: 'Smoothing defines the weights. The sealed door still has no transition, so achieved C stays 0 while the request count can be positive.' },
    ],
  };

  function explainQuestion(pack) {
    const a = pack.arms.inverse;
    const u = pack.arms.uniform;
    const p = pack.arms.proportional;
    return {
      id: 'skew-x',
      prompt: 'Which account matches the anchor sample you just ran?',
      options: [
        { result: 'The B row is the expectation ' + a.expected.B.whole + ', so the learner searched and reached B that many times.', correct: false, why: 'The expectation is ' + a.expected.B.whole + '. This seed observed ' + a.draw.observed.B + ' requests for B. Those are different objects, and the successes are the known reset, not a search.' },
        { result: 'Density, then weights, then one seeded draw. Open rooms were resets. C was requested and not entered. The no-update table is still empty. A generative model is not in this page.', correct: true, why: 'Inverse weights ' + a.weights.integers.A + '/' + a.weights.sum + ', ' + a.weights.integers.B + '/' + a.weights.sum + ', ' + a.weights.integers.C + '/' + a.weights.sum + '. Observed B ' + a.draw.observed.B + ' against expectation ' + a.expected.B.whole + '. Uniform observed B ' + u.draw.observed.B + ' against expectation ' + u.expected.B.whole + '. Exponent +1 observed B ' + p.draw.observed.B + ' against expectation ' + p.expected.B.whole + '. Achieved C is ' + a.achieved.C + '. No-update B attempts are ' + a.noUpdate.B.attempts + '.' },
        { result: 'Smoothing put C in the support, so the door opened and coverage of C increased.', correct: false, why: 'C was requested ' + a.draw.observed.C + ' times and achieved ' + a.achieved.C + '. The hall got those attempts. A refit on achieved rooms still has no visits in C.' },
      ],
    };
  }

  function ratio(part) { return part.num + '/' + part.den; }
  function expText(part) { return part.whole != null ? String(part.whole) : part.num + '/' + part.den; }

  function mapSvg(sealed) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 340 150');
    svg.setAttribute('class', 'map');
    svg.setAttribute('role', 'img');
    const door = (room) => (sealed === room ? 'sealed' : 'open');
    svg.setAttribute('aria-label', 'Hall. Door A is ' + door('A') + '. Door B is ' + door('B') + '. Door C is ' + door('C') + '.');
    const el = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (text) node.textContent = text;
      svg.append(node);
    };
    const rooms = [
      { id: 'A', x: 16, label: 'A' },
      { id: 'B', x: 130, label: 'B' },
      { id: 'C', x: 244, label: 'C' },
    ];
    el('rect', { x: 130, y: 102, width: 80, height: 36, rx: 6, fill: 'var(--surface)', stroke: 'var(--line)' });
    el('text', { x: 170, y: 125, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': '13' }, 'Hall');
    rooms.forEach((room) => {
      const shut = sealed === room.id;
      el('line', { x1: 170, y1: 102, x2: room.x + 40, y2: 64, stroke: shut ? 'var(--bad)' : 'var(--accent)', 'stroke-width': 4 });
      el('rect', { x: room.x, y: 16, width: 80, height: 48, rx: 6, fill: 'var(--surface)', stroke: shut ? 'var(--bad)' : 'var(--line)', 'stroke-width': shut ? 3 : 1 });
      el('text', { x: room.x + 40, y: 38, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': '16' }, room.label);
      el('text', { x: room.x + 40, y: 54, 'text-anchor': 'middle', fill: shut ? 'var(--bad)' : 'var(--muted)', 'font-size': '11' }, shut ? 'sealed' : 'open');
    });
    return svg;
  }

  function weightPreview(h) {
    const c = controls();
    const density = K.fitDensity(c.visits, c.smoothing);
    const weight = density.ok ? K.weights(density, c.exponent) : { defined: false, reason: density.reason };
    const kids = [h('h4', { text: 'Weights for the controls, before any new sample' })];
    if (!density.ok || !density.defined) kids.push(h('p.nums', { text: density.reason || 'Density undefined.' }));
    else kids.push(h('p.nums', { text: 'Density A ' + ratio(density.p.A) + ', B ' + ratio(density.p.B) + ', C ' + ratio(density.p.C) + '.' }));
    if (!weight.defined) kids.push(h('p', { id: 'skew-live-undefined', text: weight.reason + ' No probability was drawn.' }));
    else kids.push(h('p.nums', { id: 'skew-live-weights', text: 'Exponent ' + weight.exponent + '. Weights A ' + weight.integers.A + '/' + weight.sum + ', B ' + weight.integers.B + '/' + weight.sum + ', C ' + weight.integers.C + '/' + weight.sum + '. ' + weight.note }));
    return h('div.arm', { id: 'skew-live' }, kids);
  }

  function runBlock(h, run, id) {
    const lines = [];
    lines.push('Visits A ' + run.visits.A + ', B ' + run.visits.B + ', C ' + run.visits.C + '. Smoothing ' + run.smoothing + '. Exponent ' + run.exponent + '. Sealed: ' + (run.sealed || 'none') + '.');
    if (run.density && run.density.defined) lines.push('1. Density A ' + ratio(run.density.p.A) + ', B ' + ratio(run.density.p.B) + ', C ' + ratio(run.density.p.C) + '.');
    else lines.push('1. Density. ' + ((run.density && run.density.reason) || 'Undefined.'));
    if (!run.weights || !run.weights.defined) {
      lines.push('2. Weights. ' + ((run.weights && run.weights.reason) || run.reason));
      lines.push('No probability was drawn.');
    } else {
      lines.push('2. Weights A ' + run.weights.integers.A + '/' + run.weights.sum + ', B ' + run.weights.integers.B + '/' + run.weights.sum + ', C ' + run.weights.integers.C + '/' + run.weights.sum + '.');
      if (run.expected) lines.push('3. Expectation A ' + expText(run.expected.A) + ', B ' + expText(run.expected.B) + ', C ' + expText(run.expected.C) + '. An expectation is not an observed count.');
      if (run.draw && run.draw.ok) {
        lines.push('3. Observed requests A ' + run.draw.observed.A + ', B ' + run.draw.observed.B + ', C ' + run.draw.observed.C + '. Seed ' + run.seed + '. Budget ' + run.budget + '.');
        lines.push('Achieved A ' + run.achieved.A + ', B ' + run.achieved.B + ', C ' + run.achieved.C + ', hall ' + run.achieved.Hall + '.');
        lines.push('4. Table successes A ' + run.table.A.successes + ', B ' + run.table.B.successes + ', C ' + run.table.C.successes + '. No-update successes A ' + run.noUpdate.A.successes + ', B ' + run.noUpdate.B.successes + ', C ' + run.noUpdate.C.successes + '.');
        const polB = K.policy(run.table, 'B');
        const noneB = K.policy(run.noUpdate, 'B');
        lines.push('Policy on B: ' + (polB.action || 'no action') + '. No-update policy on B: ' + (noneB.action || 'no action') + '.');
      } else lines.push(run.reason || 'No sample was kept.');
    }
    if (run.failureReason) lines.push(run.failureReason);
    else if (run.draw && run.draw.ok && run.sealed == null) lines.push('No door is sealed. Every request entered by construction. These counts are allocation, not discovery.');
    return h('div.arm.nums', { id: id }, lines.map((text) => h('p', { text: text })));
  }

  function honestOk(pack) {
    if (!pack || !pack.arms || !pack.swap) return false;
    const a = pack.arms.inverse;
    const u = pack.arms.uniform;
    const p = pack.arms.proportional;
    const s = pack.swap;
    return !!(a.draw.ok && a.weights.integers && a.weights.integers.A === 11 && a.weights.integers.B === 99 && a.weights.integers.C === 99 && a.weights.sum === 209
      && a.expected.B.whole === 297 && u.expected.B.whole === 209 && p.expected.B.whole === 57
      && a.draw.observed.C > 0 && a.achieved.C === 0 && a.achieved.Hall === a.draw.observed.C
      && a.table.B.successes === a.draw.observed.B && a.table.C.successes === 0 && a.noUpdate.B.attempts === 0
      && a.claims.generativeModel === false && a.claims.knownRoomReset === true
      && u.draw.requested.length === a.budget && p.draw.requested.length === a.budget && u.draw.observed.B > 0
      && s.sealed === 'B' && s.visits.B === 4 && s.visits.C === 0 && s.draw.observed.B > 0 && s.achieved.B === 0
      && s.draw.observed.C > 0 && s.achieved.C === s.draw.observed.C && s.table.B.successes === 0);
  }

  function controls() {
    return {
      visits: { A: state.controls.visits.A, B: state.controls.visits.B, C: state.controls.visits.C },
      smoothing: state.controls.smoothing,
      exponent: state.controls.exponent,
      sealed: state.controls.sealed === 'none' ? null : state.controls.sealed,
      budget: state.controls.budget,
      seed: state.controls.seed,
    };
  }

  function setNumber(key, raw, min, max) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      state.controlError = 'Use an integer from ' + min + ' to ' + max + '.';
      return;
    }
    state.controlError = '';
    if (key === 'A' || key === 'B' || key === 'C') state.controls.visits[key] = n;
    else state.controls[key] = n;
    state.custom = null;
  }

  function controlForm(h) {
    const num = (key, label, min, max) => h('label', null, [
      label,
      h('input', {
        id: 'skew-' + key, type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric',
        value: String(key === 'A' || key === 'B' || key === 'C' ? state.controls.visits[key] : state.controls[key]),
        onchange: (e) => { setNumber(key, e.target.value, min, max); redraw(); },
      }),
    ]);
    const select = (key, label, options) => h('label', null, [
      label,
      h('select', {
        id: 'skew-' + key, onchange: (e) => {
          state.controls[key] = key === 'smoothing' || key === 'exponent' ? Number(e.target.value) : e.target.value;
          state.custom = null;
          state.controlError = '';
          redraw();
        },
      }, options.map((opt) => h('option', { value: String(opt[0]), selected: String(state.controls[key]) === String(opt[0]) ? 'selected' : null }, opt[1]))),
    ]);
    return h('div.stack', null, [
      h('div.controls', null, [
        num('A', 'Visits in A', 0, 40),
        num('B', 'Visits in B', 0, 40),
        num('C', 'Visits in C', 0, 40),
        select('smoothing', 'Smoothing', [[0, '0, unsmoothed'], [1, '1, add-one'], [2, '2 pseudo-counts']]),
        select('exponent', 'Exponent', [[-1, '-1, inverse'], [0, '0, uniform names'], [1, '+1, follow the density']]),
        select('sealed', 'Sealed door', [['none', 'none'], ['A', 'A'], ['B', 'B'], ['C', 'C']]),
        num('budget', 'Budget', 1, 20000),
        num('seed', 'Seed', 0, 1000000),
      ]),
      state.controlError ? h('p.small', { text: state.controlError }) : null,
      weightPreview(h),
      h('button.btn', { id: 'skew-sample-custom', type: 'button', onclick: () => { state.custom = K.practice(controls()); redraw(); } }, 'Sample this setting'),
    ]);
  }

  K.cancel = function () {};
  K.state = function () {
    const run = state.applied ? state.applied.arms.inverse : state.preview;
    return {
      world: 'skew', sentenceName: 'Powered density on three rooms', mode: 'campaign', level: lesson.title,
      knobs: { smoothing: state.controls.smoothing, exponent: state.controls.exponent, budget: state.controls.budget, seed: state.controls.seed },
      words: {}, idleWords: {}, discovered: [],
      lastRun: run ? { seeds: 1, steps: run.budget, symptoms: [], summary: run.draw.ok ? { observedB: run.draw.observed.B, achievedC: run.achieved.C } : { refused: true } } : null,
    };
  };
  K.run = function () {
    state.applied = K.lesson();
    state.fitted = state.applied.unsmoothed;
    state.preview = state.applied.arms.inverse;
    if (redraw) redraw();
    return state.applied;
  };

  K.mount = function (pane, lab, api) {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('skew-p'); const d0 = saved('skew-d'); const x0 = saved('skew-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step0 = api.step ? api.step() : 0;
    if (step0 >= 2 && !state.fitted) state.fitted = K.lesson().unsmoothed;
    if (step0 >= 2 && !state.preview) state.preview = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, sealed: 'C', budget: K.ANCHOR.budget, seed: K.ANCHOR.seed });
    if (step0 >= 4 && !state.applied) state.applied = K.lesson();
    const h = api.h;
    const body = h('div.card.stack', { id: 'skew-lesson' });
    pane.append(body);
    function advance(n) { if (api.markStep) api.markStep(n); }
    redraw = function () {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'skew') + 1;
      const step = api.step ? api.step() : 0;
      const explain = state.applied ? explainQuestion(state.applied) : null;
      const repairOk = honestOk(state.applied);
      const explainOk = !!(explain && state.explain != null && explain.options[state.explain].correct && repairOk);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Three rooms' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        mapSvg('C'),
        h('p.small', { text: 'Lecture 23, slides "Goal reaching as MI maximization" and "Example: Skew-Fit". The Skew-Fit slide asks what might be suboptimal about the method. This lesson answers one bounded case: a density with a hole cannot be inverted, and a weight cannot create a missing transition.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-23.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 23 slides'),
          ' · ',
          h('a', { href: 'https://arxiv.org/abs/1903.03698', target: '_blank', rel: 'noopener' }, 'Dalal, Pong, Lin, Nair, Bahl, Levine, Skew-Fit, 2019'),
        ]),
        h('p.small', { text: 'Equation 2 of that paper weights a state by the goal-model density to a negative power. Equation 3 keeps the weight on states that were sampled. Alpha -1 is inverse density when the model matches. Alpha 0 does not skew. They then fit a generative model that is kept off zero and train with RIG. This page is a 3-bin histogram and a known reset. The generative model, RIG, and the robot results stay open.' }),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if (step >= 1 || state.pred != null) {
        kids.push(h('h3', { text: '2. Run' }),
          h('p', { text: 'Fit the anchor visits 8, 0, 0 with no smoothing. Then sample the add-one inverse once. The budget is 627 and the seed is fixed. C\'s door is sealed.' }),
          h('button.btn', { id: 'skew-fit', type: 'button', onclick: () => { state.fitted = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 0, exponent: -1, sealed: 'C', budget: 627, seed: 23 }); if (state.preview) advance(2); redraw(); } }, 'Fit the unsmoothed density'),
          state.fitted ? runBlock(h, state.fitted, 'skew-undefined') : null,
          h('button.btn', { id: 'skew-sample', type: 'button', onclick: () => { state.preview = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, sealed: 'C', budget: 627, seed: 23 }); if (state.fitted) advance(2); redraw(); } }, 'Sample add-one, exponent -1'));
        if (state.preview) kids.push(runBlock(h, state.preview, 'skew-preview'));
      }
      if ((step >= 2 || (state.fitted && state.preview)) && state.fitted && state.preview) {
        kids.push(h('h3', { text: '3. Diagnose' }),
          choice(h, DIAGNOSE, state.diag, (i) => { state.diag = i; if (api.recordAnswer) api.recordAnswer(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct); advance(3); redraw(); }));
      }
      if (state.diag != null && state.preview) {
        kids.push(h('h3', { text: '4. Repair' }),
          h('p', { text: 'Change the visits, the exponent, or the smoothing, then sample. The weights update before the draw. The draw spends the budget you set. The recorded measurement is the anchor, not a path written by hand.' }),
          controlForm(h),
          state.custom ? runBlock(h, state.custom, 'skew-custom') : null,
          h('div.row', { id: 'skew-repairs' }, [
            h('button.btn.ghost', { id: 'skew-repair-undefined', type: 'button', onclick: () => { state.fitted = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 0, exponent: -1, sealed: 'C', budget: 627, seed: 23 }); redraw(); } }, 'Try the unsmoothed inverse'),
            h('button.btn.ghost', { id: 'skew-repair-pretend', type: 'button', onclick: () => { state.pretend = K.practice({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, exponent: -1, sealed: 'C', budget: 627, seed: 23, pretend: true }); redraw(); } }, 'Pretend the sealed door opens'),
            h('button.btn', { id: 'skew-repair-honest', type: 'button', onclick: () => { state.applied = K.lesson(); if (honestOk(state.applied)) advance(4); redraw(); } }, 'Sample the anchor honestly'),
          ]));
        if (state.pretend) kids.push(h('div.stack', null, [
          h('h4', { text: 'Pretend reset' }),
          h('p', { text: 'This mode writes a success on the sealed room. It is not the repair. The number is not reachability.' }),
          runBlock(h, state.pretend, 'skew-pretend'),
        ]));
        if (state.applied) {
          const pack = state.applied;
          kids.push(h('div.stack', { id: 'skew-anchor' }, [
            h('h4', { text: 'Anchor, same 627 attempts, seed 23, visits 8, 0, 0, add-one, door C sealed' }),
            h('p', { text: 'B expectations: inverse ' + pack.arms.inverse.expected.B.whole + ', uniform ' + pack.arms.uniform.expected.B.whole + ', exponent +1 ' + pack.arms.proportional.expected.B.whole + '. Those are expectations. The observed lines under each arm are this seed.' }),
            h('div.arms', null, [
              runBlock(h, pack.arms.inverse, 'skew-arm-inverse'),
              runBlock(h, pack.arms.uniform, 'skew-arm-uniform'),
              runBlock(h, pack.arms.proportional, 'skew-arm-proportional'),
            ]),
            h('h4', { text: 'Counterexample: seal B, which has 4 visits, and leave C open, which has none' }),
            mapSvg('B'),
            runBlock(h, pack.swap, 'skew-swap'),
            h('p.small', { text: 'Uniform does not almost never ask for B. On the anchor its probability is 1/3 and its expectation is 209 of 627. This seed observed ' + pack.arms.uniform.draw.observed.B + '.' }),
          ]));
        }
      }
      if (repairOk && explain) {
        kids.push(h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', { id: 'skew-complete', type: 'button', disabled: explainOk ? null : 'disabled', onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); } }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [h('summary', { text: 'Toy assumptions' }), h('div.nums', null, state.applied.arms.inverse.assumptions.map((line) => h('p.small', { text: line })))]));
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'skew-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids.filter((node) => node != null));
    };
    const rules = h('section.card.game-rules', { id: 'skew-rules' }, [
      h('h3', { text: 'Game rules · Three rooms' }),
      h('dl', null, [
        row(h, 'Goal', 'Name a room as the goal. A is open. B is open on the anchor and sealed on the counterexample. C is sealed on the anchor.'),
        row(h, 'Reward each step', 'No reward is paid for a request. An open door records a reset into that room. A sealed door records a miss in the hall.'),
        row(h, 'Equation', 'The goal weight is the room density raised to the exponent, then normalized. Exponent -1 is undefined on a zero count. Exponent 0 is uniform over the three names. Exponent +1 is the density.'),
        row(h, 'Episode ends', 'Each attempt spends one try from a finite budget. The three exponents share that budget. A sealed attempt is still spent.'),
        row(h, 'Score', 'Observed request counts, expected counts, achieved rooms, and the goal-conditioned table against an empty no-update table.'),
        row(h, 'Pass this challenge', goalText),
      ]),
    ]);
    lab.replaceChildren(rules, h('section.card', null, [
      h('h3', { text: 'The three doors' }),
      mapSvg('C'),
      h('p.small', { text: 'On the anchor, A and B are open and C is sealed. A later counterexample seals B instead. The histogram does not decide which door exists.' }),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBSKEW);
