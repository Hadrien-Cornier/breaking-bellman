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
    intro: 'The notes record visits to room A, but none to B or C. Can changing goal weights help with an unvisited room or a sealed door?',
    introMore: 'Three rooms. The notes record 8 visits in A and none in B or C. Inverse-density goal weights are undefined on a room with count zero. Add-one smoothing gives those rooms a prior, not a visit. A sealed door still does not open.',
    goal: { text: goalText },
  };
  const skillsAt = C.levels.findIndex((l) => l.id === 'skills');
  const sm = C.levels.findIndex((l) => l.id === 'supermimic');
  C.levels.splice(skillsAt >= 0 ? skillsAt + 1 : sm >= 0 ? sm : C.levels.length, 0, lesson);

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

  const state = {
    controls: { visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 },
    record: null, stale: false, time: 0, method: 'inverse', watching: false,
    pred: null, diag: null, explain: null, step: 0, busy: false, error: '',
  };
  let redraw = null, paint = null, timer = null, generation = 0, adapter = null, mounted = false;
  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const length = () => state.record ? state.record.events[state.method].length : 0;
  const stop = () => { clearTimeout(timer); timer = null; state.watching = false; };
  const change = () => { stop(); generation++; state.busy = false; state.stale = !!state.record; state.error = ''; redraw?.(); };
  K.cancel = function () {
    stop(); generation++; mounted = false; state.record = null; state.stale = false;
    state.busy = false; state.time = 0; adapter = null; redraw = null; paint = null;
  };
  K.record = () => state.record;
  K.replay = () => ({ time: state.time, length: length(), watching: state.watching, stale: state.stale, world: 'skew', method: state.method });
  K.state = () => ({ world: 'skew', sentenceName: 'Goal requests on three rooms', mode: 'campaign', level: lesson.title,
    knobs: clone(state.controls), lastRun: state.record ? { steps: state.record.data.fresh.steps, summary: state.record.metrics } : null });
  K.run = async function () {
    if (!mounted) return null;
    stop(); const token = ++generation; state.busy = true; state.error = ''; redraw?.();
    try {
      const record = await K.records.create(clone(state.controls));
      if (token !== generation || !mounted) return null;
      state.record = record; state.time = 0; state.stale = false; state.busy = false;
      if (state.step === 1 && state.controls.smoothing === 1) state.step = 2;
      redraw?.(); return record;
    } catch (error) {
      if (token === generation) { state.busy = false; state.error = error.message; redraw?.(); }
      throw error;
    }
  };
  function ensureCss() {
    if (document.getElementById('skew-css')) return;
    const style = document.createElement('style'); style.id = 'skew-css';
    style.textContent = `#skew-lesson,#skew-lab{min-width:0;max-width:100%;overflow-wrap:anywhere}
      #skew-lesson button,#skew-lab button,#skew-lab select,#skew-lab input{min-width:44px;min-height:44px}
      #skew-stage{display:block;width:100%;height:auto;aspect-ratio:340/195}
      #skew-lab .skew-controls{display:flex;flex-wrap:wrap;gap:8px}
      #skew-lab label{display:flex;flex:1 1 110px;flex-direction:column;gap:4px;min-width:0}
      #skew-lab input,#skew-lab select{box-sizing:border-box;width:100%}
      .skew-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:12px}
      #skew-curve .skew-bar{height:12px;max-width:100%;background:var(--accent)}
      #skew-curve .skew-track{background:var(--sunk);width:100%}
      #skew-curve p{margin:6px 0}`;
    document.head.append(style);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paint?.());
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { stop(); paint?.(); });
  }
  function drawScene(canvas, record, t, settings, method) {
    const width = 340, height = 195, scale = window.devicePixelRatio || 1;
    canvas.width = width * scale; canvas.height = height * scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const css = getComputedStyle(canvas), ink = css.getPropertyValue('--ink').trim(), surface = css.getPropertyValue('--surface').trim();
    const muted = css.getPropertyValue('--muted').trim(), accent = css.getPropertyValue('--accent').trim();
    const frame = record ? K.records.frame(record, method, t) : null, event = frame?.event;
    const config = record ? record.settings : settings;
    ctx.fillStyle = surface; ctx.fillRect(0, 0, width, height);
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    const xs = { A: 55, B: 170, C: 285, Hall: 170 };
    for (const room of K.ROOMS) {
      const sealed = config.sealed === room, selected = event?.goal === room;
      ctx.strokeStyle = ink; ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeRect(xs[room] - 43, 10, 86, 87);
      ctx.fillStyle = ink; ctx.fillText(room + (selected ? ' · goal' : ''), xs[room], 30);
      ctx.font = '12px sans-serif'; ctx.fillStyle = muted; ctx.fillText(sealed ? 'sealed ×' : 'open', xs[room], 48); ctx.font = '14px sans-serif';
      if (sealed) { ctx.beginPath(); ctx.moveTo(xs[room] - 12, 93); ctx.lineTo(xs[room] + 12, 101); ctx.moveTo(xs[room] - 12, 101); ctx.lineTo(xs[room] + 12, 93); ctx.stroke(); }
    }
    ctx.strokeStyle = muted; ctx.strokeRect(12, 112, 316, 68);
    ctx.fillStyle = ink; ctx.fillText('Hall · each request starts here', 170, 172);
    const location = event?.state || 'Hall';
    BB.scenes.robot(ctx, xs[location], location === 'Hall' ? 153 : 88, 35,
      { mood: event?.kind === 'outcome' ? event.success ? 'happy' : 'sad' : 'normal', blink: false, bob: 0, antenna: accent });
    canvas.setAttribute('aria-label', 'Three rooms. ' + K.ROOMS.map(r => 'Door ' + r + ' ' + (config.sealed === r ? 'sealed' : 'open')).join('. ') +
      '. Robot in ' + location + (event ? '. Request ' + event.attempt + ' for ' + event.goal + ', ' + event.kind + (event.kind === 'outcome' ? event.success ? ', success' : ', failure' : '') : '. No sampled request shown.'));
    return frame;
  }
  K.mount = function (pane, lab, api) {
    ensureCss(); stop(); mounted = true;
    state.step = Math.max(state.step, api.step?.() || 0);
    for (const [key, id] of [['pred', 'skew-p'], ['diag', 'skew-d'], ['explain', 'skew-x']]) {
      const saved = api.answer?.(id); if (state[key] == null && saved) state[key] = saved.choice;
    }
    const h = api.h, body = h('section.card.stack.teaching-card', { id: 'skew-lesson' });
    pane.append(body);
    const scene = h('section.card.stack', { id: 'skew-lab' }); lab.replaceChildren(scene);
    const chart = h('section', { id: 'skew-curve' }), results = h('section', { id: 'skew-results' }), evidence = h('section', { id: 'skew-evidence' });
    const fallback = {};
    const notebook = (name, node) => {
      const target = api.shell?.notebook(name);
      if (target) target.replaceChildren(node);
      else { fallback[name]?.remove(); fallback[name] = node; lab.append(node); }
    };
    function advance(n) { state.step = n; api.markStep?.(n); redraw(); }
    function answer(q, key, next) { return choice(h, q, state[key], i => { state[key] = i; api.recordAnswer?.(q.id, i, !!q.options[i].correct); if (next != null) advance(next); else redraw(); }); }
    function setControls(values) { state.controls = { ...clone(state.controls), ...clone(values) }; change(); }
    function runButton(id = 'skew-run', label = 'Run') {
      return h('button.btn', { id, type: 'button', disabled: state.busy, onclick: () => K.run() }, state.busy ? 'Running…' : label);
    }
    function number(key, label, min, max) {
      const value = K.ROOMS.includes(key) ? state.controls.visits[key] : state.controls[key];
      return h('label', null, [label, h('input', { id: 'skew-' + key, type: 'number', min, max, step: 1, value,
        onchange: e => {
          const n = Number(e.target.value);
          if (!Number.isInteger(n) || n < min || n > max) { e.target.value = value; state.error = 'Use an integer from ' + min + ' to ' + max + '.'; redraw(); return; }
          if (K.ROOMS.includes(key)) state.controls.visits[key] = n; else state.controls[key] = n;
          change();
        } })]);
    }
    function select(key, label, options) { return h('label', null, [label, h('select', { id: 'skew-' + key, onchange: e => {
      state.controls[key] = key === 'smoothing' ? Number(e.target.value) : e.target.value || null; change();
    } }, options.map(([value, text]) => h('option', { value, text, selected: String(state.controls[key] || '') === String(value || '') }))) ]); }
    function tick() {
      if (!state.watching || !scene.isConnected || !mounted) return stop();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { stop(); paint(); return; }
      state.time = Math.min(state.time + 1, length() - 1);
      if (state.time >= length() - 1) stop();
      paint(); if (state.watching) timer = setTimeout(tick, 260);
    }
    redraw = function () {
      if (!body.isConnected) return;
      api.markStep?.(state.step);
      const canvas = h('canvas', { id: 'skew-stage', role: 'img' });
      const status = h('p.small', { id: 'skew-event', 'aria-live': 'polite' });
      const time = h('input', { id: 'skew-time', type: 'range', min: 0, max: Math.max(0, length() - 1), value: state.time, 'aria-label': 'Recorded event',
        disabled: !length(), oninput: e => { stop(); state.time = Number(e.target.value); paint(); } });
      const watch = h('button.btn.ghost', { id: 'skew-watch', type: 'button', disabled: !length() || state.stale,
        onclick: () => {
          if (state.watching) stop();
          else if (matchMedia('(prefers-reduced-motion: reduce)').matches) { state.time = Math.min(state.time + 1, length() - 1); }
          else { if (state.time >= length() - 1) state.time = 0; state.watching = true; timer = setTimeout(tick, 260); }
          paint();
        } }, 'Watch');
      const method = h('select', { id: 'skew-method', onchange: e => { stop(); state.method = e.target.value; state.time = Math.min(state.time, Math.max(0, length() - 1)); redraw(); } },
        K.records.policies.map(p => h('option', { value: p.name, text: p.label, selected: state.method === p.name })));
      scene.replaceChildren(h('h3', { text: 'Request a room, observe the door' }),
        h('p.small', { text: 'An open door places the robot in that room by a known reset. A sealed door leaves it in the hall. This experiment allocates practice; it does not search for a path.' }),
        h('label', null, ['Method to watch', method]), canvas, status,
        h('div.row', null, [watch,
          h('button.btn.ghost', { id: 'skew-step', type: 'button', disabled: !length() || state.stale, onclick: () => { stop(); state.time = Math.min(state.time + 1, length() - 1); paint(); } }, 'Step'),
          h('button.btn.ghost', { id: 'skew-replay', type: 'button', disabled: !length(), onclick: () => { stop(); state.time = 0; paint(); } }, 'Replay')]),
        h('label', null, ['Recorded request / outcome', time]),
        h('p.small', { id: 'skew-stale', hidden: !state.stale, text: 'Settings changed. This is the previous run. Run again to measure the new setting.' }),
        h('details', null, [h('summary', { text: 'Change the experiment' }), h('div.skew-controls', null, [
          number('A', 'Prior visits in A', 0, 40), number('B', 'Prior visits in B', 0, 40), number('C', 'Prior visits in C', 0, 40),
          select('smoothing', 'Smoothing per room', [[0, '0, no prior added'], [1, '1, add-one'], [2, '2 pseudo-counts']]),
          select('sealed', 'Sealed door', [['', 'None'], ['A', 'A'], ['B', 'B'], ['C', 'C']]), number('budget', 'Attempts per method', 1, 20000),
        ])]), h('p.small', { role: 'status', text: state.error }),
        state.step !== 1 ? runButton() : h('p.small', { text: 'Use Run in the current teaching step.' }));
      adapter = BB.sceneAdapter.create({ world: 'skew', settings: ['visits', 'smoothing', 'sealed', 'budget'],
        render: (element, record, t) => {
          if (t === null) return record.events[state.method].length;
          return drawScene(element, record, t, state.controls, state.method);
        } });
      adapter.mount(canvas);
      paint = function () {
        if (!scene.isConnected) return stop();
        if (state.record) adapter.draw(state.record, state.time);
        const frame = state.record ? K.records.frame(state.record, state.method, state.time) : null;
        const e = frame?.event;
        status.textContent = !frame ? 'Before Run: no goal requests have been sampled.' : !e ? frame.terminal :
          'Attempt ' + e.attempt + ' of ' + state.record.settings.budget + ': ' + (e.kind === 'request' ? 'request ' + e.goal + ', starting in Hall.' : e.success ? 'success, reset into ' + e.state + '.' : 'failure, still in Hall. Door ' + e.goal + ' is sealed.');
        watch.textContent = state.watching ? 'Pause' : 'Watch'; time.value = state.time;
        chart.replaceChildren(h('h3', { text: 'Measured requests and outcomes so far' }),
          h('p.small', { text: state.record ? state.record.policies.find(p => p.name === state.method).label + ' · event ' + (e ? state.time + 1 : 0) + ' of ' + length() : 'Run to collect measurements.' }));
        if (frame) for (const room of ['A', 'B', 'C', 'Hall']) {
          chart.append(h('p.small', { text: room + ': ' + (frame.requests[room] ?? 0) + ' requests; ' + frame.counts[room] + ' outcomes here' }),
            h('div.skew-track', null, [h('div.skew-bar', { style: 'width:' + (100 * frame.counts[room] / state.record.settings.budget) + '%' })]));
        }
        for (const node of [canvas, chart, results, evidence]) {
          if (state.record) node.dataset.run = state.record.id; else delete node.dataset.run;
          node.dataset.stale = String(state.stale);
        }
      };
      const cards = [h('div.eyebrow', { text: 'Three rooms · Step ' + (Math.min(state.step, 4) + 1) + ' of 5' }), h('h2', { text: lesson.title })];
      if (state.step === 0) cards.push(h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })]),
        h('p', { text: 'Compare Inverse density, which favors low positive counts; Uniform names, which asks for each room equally; and Follow density, which favors high counts.' }), answer(PREDICT, 'pred', 1));
      else if (state.step === 1) cards.push(h('h3', { text: 'Run the request experiment' }),
        h('p', { text: 'First try no smoothing: the inverse must refuse to draw. Then add one pseudo-count per room and run again. A pseudo-count defines a weight; it is not a visit.' }),
        h('button.btn.ghost', { id: 'skew-fit', type: 'button', onclick: async () => { setControls({ smoothing: 0 }); await K.run(); } }, 'Run without smoothing'),
        h('button.btn', { id: 'skew-sample', type: 'button', disabled: state.busy, onclick: async () => { setControls({ smoothing: 1 }); await K.run(); } }, 'Run with add-one'));
      else if (state.step === 2) cards.push(h('h3', { text: 'Watch a sealed-door attempt' }),
        state.record && !state.stale && state.record.settings.sealed === 'C' && state.record.results.inverse.draw.observed.C > 0 ? answer(DIAGNOSE, 'diag', 3) : h('div', null, [h('p', { text: 'Run the C-sealed anchor before diagnosing its requests.' }), h('button.btn', { type: 'button', onclick: async () => { setControls({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 }); await K.run(); } }, 'Run the C-sealed anchor')]));
      else if (state.step === 3) cards.push(h('h3', { text: 'Change what the counts cannot change' }),
        h('p', { text: 'Try sealing B, which has four prior visits, while leaving C open with no visits. Watch a request for each. Then restore the anchor to compare the three methods at 627 attempts each.' }),
        h('button.btn.ghost', { id: 'skew-swap', type: 'button', onclick: async () => { setControls({ visits: { A: 5, B: 4, C: 0 }, smoothing: 1, sealed: 'B', budget: 300 }); await K.run(); } }, 'Run with B sealed'),
        h('button.btn', { id: 'skew-repair-honest', type: 'button', onclick: async () => {
          setControls({ visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 });
          if (await K.run()) advance(4);
        } }, 'Run the anchor comparison'));
      else {
        const anchor = state.record && !state.stale && same(state.record.settings, { visits: { A: 8, B: 0, C: 0 }, smoothing: 1, sealed: 'C', budget: 627, seed: 23 });
        if (!anchor) cards.push(h('p', { text: 'Run the anchor comparison again before explaining its measurements.' }), h('button.btn', { type: 'button', onclick: () => advance(3) }, 'Return to anchor'));
        else {
          const q = explainQuestion({ arms: state.record.results });
          cards.push(answer(q, 'explain', null), h('button.btn', { id: 'skew-complete', type: 'button', disabled: state.explain == null || !q.options[state.explain]?.correct,
            onclick: () => { api.complete?.(); redraw(); } }, api.done?.() ? 'Lesson complete' : 'Record this measurement'));
          if (api.done?.() && api.next?.()) cards.push(h('button.btn', { id: 'skew-next', type: 'button', onclick: () => api.openNext?.() }, 'Next level: ' + api.next().title));
        }
      }
      if (api.shell) cards.push(api.shell.conceptSketch({ label: 'Counts set requests, doors set outcomes',
        nodes: [{ id: 'counts', label: 'Counts', x: 45, y: 35 }, { id: 'requests', label: 'Requests', x: 160, y: 35 }, { id: 'doors', label: 'Doors', x: 160, y: 95 }, { id: 'outcomes', label: 'Outcomes', x: 275, y: 95 }],
        edges: [{ from: 'counts', to: 'requests' }, { from: 'requests', to: 'outcomes' }, { from: 'doors', to: 'outcomes' }] }));
      cards.push(h('p.small', null, ['Idea adapted from ', h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-23.pdf', target: '_blank', rel: 'noopener' }, 'Berkeley CS 285'), '.']));
      body.replaceChildren(...cards);
      results.replaceChildren(h('h3', { text: 'Final measured comparison' }));
      if (state.record) {
        const r = state.record;
        results.append(h('p.small', { text: 'Prior data: ' + r.data.prior.visits + ' recorded room visits, shared by the methods. Original step and episode counts are unknown. Pseudo-counts add no visits. Fresh: ' + r.data.fresh.attempts + ' total one-step reset attempts across the three methods.' }));
        const grid = h('div.skew-result-grid'); results.append(grid);
        for (const policy of r.policies) {
          const run = r.results[policy.name], m = r.metrics[policy.name];
          grid.append(h('div', null, [h('h4', { text: policy.label }),
            h('p.small', { text: 'Fresh attempts: ' + m.fresh.attempts + '. Successes: ' + m.successes + '. End: ' + r.terminal[policy.name] + '.' }),
            ...K.ROOMS.map(room => h('p.small', { text: room + ': expected requests ' + (run.expected ? (run.expected[room].whole ?? (run.expected[room].num + '/' + run.expected[room].den)) : 'undefined') + ', observed ' + m.requested[room] + ', achieved ' + m.achieved[room] + '.' })),
            h('p.small', { text: 'No-update table: 0 attempts, 0 successes. It receives no new data.' })]));
        }
      } else results.append(h('p.small', { text: 'Run to collect a comparison.' }));
      evidence.replaceChildren(h('h3', { text: 'What this experiment measures' }),
        h('p', { text: 'Requests come from a finite random sample, so observed counts can differ from expectations. Open-door successes use known resets. Sealed attempts spend a try in the hall. Neither smoothing nor reweighting creates a transition.' }),
        h('p', { text: 'This is a three-bin histogram experiment. It does not train a generative model or establish the Skew-Fit paper’s robot results.' }),
        h('a', { href: 'https://arxiv.org/abs/1903.03698', target: '_blank', rel: 'noopener' }, 'Skew-Fit paper, equations 2 and 3'));
      const rules = h('section', { id: 'skew-rules' }, [h('h3', { text: 'Rule: weights request, doors decide' }), h('p', { text: 'Pass this challenge: ' + goalText }),
        h('p', { text: 'Density is (visits + smoothing) divided by the total. Inverse density uses exponent -1 and is undefined on zero. Uniform names uses equal weights. Follow density uses exponent +1. Each method gets the same attempt budget when its weights are defined.' }),
        h('p', { text: 'Each attempt ends after a known reset or sealed-door failure. No task reward is paid; the measured score is requested and achieved room counts.' })]);
      notebook('rule', rules); notebook('curve', h('div.stack', null, [chart, results])); notebook('autopsy', evidence);
      const notes = h('section', { id: 'skew-notes' }, [h('h3', { text: 'Your questions' })]);
      for (const [q, key] of [[PREDICT, 'pred'], [DIAGNOSE, 'diag']]) if (state[key] != null) notes.append(h('p', { text: q.prompt }), h('p.small', { text: q.options[state[key]]?.result || '' }));
      if (api.shell) notebook('notes', notes);
      paint();
    };
    redraw();
  };
})(window.CONTENT, window.BBSKEW);
