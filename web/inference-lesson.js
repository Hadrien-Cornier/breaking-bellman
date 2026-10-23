// Scene and replay for ELBO and Messages only. The campaign owns layout and Notebook.
(function () {
  'use strict';
  const R = window.BBInferenceRecord;
  const num = x => x == null || !Number.isFinite(x) ? 'undefined' : x.toFixed(4);
  const svgNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const e = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs || {})) e.setAttribute(key, value);
    if (text != null) e.textContent = text;
    return e;
  }
  function create(spec) {
    const id = spec.level.id;
    let settings = structuredClone(spec.defaults), record = null, stale = false, time = 0, timer = null;
    let ctx = null, pane = null, lab = null, adapter = null, stage = 0, generation = 0, running = false;
    let picks = {}, changedRun = false, lastSettings = null;
    const nodes = {};
    const stop = () => { clearInterval(timer); timer = null; };
    const replay = () => ({ time, watching: !!timer, stale, world: adapter ? id : null, length: record ? R.length(record) : 0 });
    function cancel() {
      generation++; stop(); running = false; record = null; stale = false; time = 0; adapter = null;
      ctx = pane = lab = null;
    }
    function mark(n) { stage = Math.max(stage, n); if (ctx?.mark) ctx.mark(stage); }
    function change(key, value) {
      stop(); settings[key] = value; stale = !!record; generation++; running = false;
      draw(); teaching();
    }
    function controls() {
      const h = ctx.h;
      nodes.settings.replaceChildren(...spec.controls.map(c => {
        const select = h('select', { id: id + '-' + (c.id || c.key), onchange: e => change(c.key, structuredClone(c.options[+e.target.value].value)) },
          c.options.map((o, i) => h('option', { value: i, selected: JSON.stringify(settings[c.key]) === JSON.stringify(o.value) }, o.label)));
        return h('label.inference-setting', null, [h('span', { text: c.label }), select]);
      }));
    }
    async function run() {
      const request = ++generation;
      stop(); running = true; draw();
      const next = await R.create(id, settings);
      if (request !== generation || !ctx) return null;
      changedRun ||= lastSettings !== null && lastSettings !== JSON.stringify(next.settings);
      lastSettings = JSON.stringify(next.settings);
      record = next; stale = false; running = false; time = 0; mark(2); draw(); teaching();
      return record;
    }
    function scene(el, value, t) {
      if (t === null) return R.length(value);
      const h = ctx.h;
      el.replaceChildren();
      const frames = value ? R.frame(value, t) : [];
      if (id === 'elbo') {
        const model = value?.model || BBELBO.LESSON;
        const diagram = svg('svg', { viewBox: '0 0 320 140', role: 'img', 'aria-label': 'Hall, lamp and glare can each cause the fixed bright sensor reading' });
        ['hall', 'lamp', 'glare'].forEach((z, i) => {
          const x = 52 + i * 108;
          diagram.append(svg('rect', { x: x - 46, y: 8, width: 92, height: 42, rx: 8, fill: 'none', stroke: 'currentColor' }));
          diagram.append(svg('text', { x, y: 34, 'text-anchor': 'middle', fill: 'currentColor' }, z));
          diagram.append(svg('path', { d: `M ${x} 50 L 160 89`, stroke: 'currentColor', fill: 'none', 'stroke-dasharray': '4 3' }));
        });
        diagram.append(svg('rect', { x: 102, y: 89, width: 116, height: 42, rx: 10, fill: '#fff1a8', stroke: '#594300' }));
        diagram.append(svg('text', { x: 160, y: 115, 'text-anchor': 'middle', fill: '#302600' }, 'Sensor: bright'));
        el.append(diagram, h('p.small', { text: 'One supplied reading. The hidden cause is unknown; only the guess changes.' }));
        const table = h('table', null, [h('thead', null, h('tr', null, ['Cause', 'Prior', 'P(bright | cause)'].map(s => h('th', { text: s })))),
          h('tbody', null, model.causes.map(z => h('tr', null, [z, num(model.prior[z]), num(model.likelihood[z])].map(s => h('td', { text: s })))))]);
        el.append(h('div.inference-table', null, table));
        if (!value) el.append(h('p', { text: 'Run to compare KL included with Reconstruction only from the same starting guess.' }));
        for (const frame of frames) {
          const measurement = frame.event.measurement;
          const box = h('section.inference-policy', { 'data-policy': frame.name }, [
            h('h3', { text: frame.label }), h('p.small', { text: 'Update ' + frame.event.t + ' of ' + value.settings.rounds }),
            ...model.causes.map(z => h('div.inference-probability', null, [h('span', { text: z }),
              h('progress', { max: 1, value: measurement.q[z], 'aria-label': frame.label + ': probability of ' + z }), h('b', { text: num(measurement.q[z]) })])),
            h('p.small', { text: 'Bound ' + num(measurement.elbo) + ' · gap ' + num(measurement.gap) }),
            frame.terminal ? h('p.small', { text: 'Stopped: update budget used.' }) : null,
          ]);
          el.append(box);
        }
      } else {
        const model = value?.model || BBMESSAGES.lessonModel(settings);
        const active = frames.length ? frames : [{ name: 'setup', label: 'Known three-cell line', event: { kind: 'setup' }, index: 0 }];
        for (const frame of active) {
          const event = frame.event;
          let position = model.start;
          if (value) for (const e of value.events[frame.name].slice(0, frame.index + 1)) if (e.kind === 'move') position = e.next;
          const canvas = h('canvas', { width: 640, height: 230, role: 'img', 'aria-label': frame.label + ': Rover at cell ' + position + ', goal cell ' + model.goal });
          const c = canvas.getContext('2d');
          c.fillStyle = '#102433'; c.fillRect(0, 0, 640, 230);
          for (let s = 0; s < 3; s++) {
            c.strokeStyle = '#c9d8e3'; c.lineWidth = 2; c.strokeRect(18 + s * 207, 32, 188, 147);
            c.font = '24px sans-serif'; c.fillStyle = '#f5f9fb'; c.fillText('Cell ' + s, 30 + s * 207, 210);
            if (s === model.goal) { c.fillStyle = '#ffe291'; c.fillText('Goal ⚑', 35 + s * 207, 61); }
          }
          BB.scenes.robot(c, 112 + position * 207, 165, 102, { noShadow: true });
          const description = event.kind === 'setup' ? 'Start at cell 0. Left and right move one cell; an outside move stays at the end.'
            : event.kind === 'terminal' ? 'First set the final goal likelihood: 1 at the goal, ' + model.miss + ' elsewhere.'
            : event.kind === 'backup' ? 'Backward update for decision ' + event.time + '. The rover has not moved.'
            : event.kind === 'undefined' ? 'STOP: the conditioned distribution is undefined at cell ' + event.state + '. No action or path is invented.'
            : 'Decision ' + event.time + ': ' + event.action + ', cell ' + event.state + ' → ' + event.next + '.';
          const box = h('section.inference-policy', { 'data-policy': frame.name }, [h('h3', { text: frame.label }), canvas, h('p', { text: description })]);
          if (event.kind === 'terminal') box.append(h('p.small', { text: Object.entries(event.values).map(([s, v]) => 'Cell ' + s + ': ' + num(v)).join(' · ') }));
          if (event.kind === 'backup') {
            box.append(h('p.small', { text: 'State message: ' + Object.entries(event.stateMessage).map(([s, v]) => 'cell ' + s + ' = ' + num(v)).join(' · ') }));
          }
          if (event.kind === 'move' || event.kind === 'undefined') {
            const rows = value.results[frame.name].rows.filter(r => r.t === event.time && r.state === event.state);
            box.append(h('div.inference-table', null, h('table', null, [
              h('thead', null, h('tr', null, ['Action', 'Prior', 'Message', 'Conditioned'].map(s => h('th', { text: s })))),
              h('tbody', null, rows.map(r => h('tr', null, [r.action, num(r.prior), num(r.beta), num(r.posterior)].map(s => h('td', { text: s }))))),
            ])));
          }
          if (frame.terminal) box.append(h('p.small', { text: 'Stopped: ' + frame.terminal.replaceAll('-', ' ') + '.' }));
          el.append(box);
        }
        el.append(h('p.small', { text: 'Known transitions, no learned dynamics. The replay follows each method’s most probable action, not a random sample.' }));
      }
    }
    function results() {
      const h = ctx.h;
      nodes.result.replaceChildren(); nodes.chart.replaceChildren(); nodes.evidence.replaceChildren();
      if (!record) return;
      nodes.result.append(h('h3', { text: 'Measured results' }));
      for (const { name, label } of record.policies) {
        const m = record.metrics[name];
        nodes.result.append(h('p', { text: label + ': ' + (id === 'elbo'
          ? 'final bound ' + num(m.elbo) + ', gap ' + num(m.gap) + ', ' + m.updates + ' updates.'
          : m.end == null ? 'no defined endpoint.' : m.moves + ' moves, ends at cell ' + m.end + (m.reached ? ', at the goal.' : ', misses the goal.')) }));
      }
      nodes.result.append(h('p.small', { text: id === 'elbo'
        ? 'Prior data: one supplied sensor observation. Fresh environment steps: 0; attempts: 0. Updates reuse the fixed probability table. No reward or physical trajectory.'
        : 'Prior training data: 0. Fresh environment steps: 0; attempts: 0. Known-model replay: ' + record.data.evaluation.steps + ' computed moves across the two methods. No training or reward samples.' }));
      nodes.chart.append(h('h3', { text: id === 'elbo' ? 'Bound at every recorded update' : 'Backward messages and decisions' }));
      if (id === 'elbo') {
        const plot = svg('svg', { viewBox: '0 0 320 180', role: 'img', 'aria-label': 'Measured bound by update. Solid: KL included. Dashed: Reconstruction only.' });
        const values = record.policies.flatMap(p => record.events[p.name].map(e => e.measurement.elbo));
        const lo = Math.min(...values), hi = Math.max(...values), y = v => 145 - (v - lo) / Math.max(.01, hi - lo) * 120;
        plot.append(svg('path', { d: 'M 35 15 V 145 H 305', fill: 'none', stroke: 'currentColor' }));
        record.policies.forEach((p, i) => {
          const points = record.events[p.name].map(e => (35 + e.t / record.settings.rounds * 270) + ',' + y(e.measurement.elbo)).join(' ');
          plot.append(svg('polyline', { points, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-dasharray': i ? '5 4' : 'none' }));
        });
        plot.append(svg('path', { d: 'M ' + (35 + time / record.settings.rounds * 270) + ' 15 V 145', stroke: 'currentColor', opacity: .5 }));
        plot.append(svg('text', { x: 35, y: 173, fill: 'currentColor' }, '0'));
        plot.append(svg('text', { x: 270, y: 173, fill: 'currentColor' }, String(record.settings.rounds)));
        nodes.chart.append(plot, h('p.small', { text: 'Solid: KL included. Dashed: Reconstruction only. Vertical line: current update. Bound range ' + num(lo) + ' to ' + num(hi) + '.' }));
      }
      for (const { name, label } of record.policies) {
        const rows = id === 'elbo' ? record.events[name] : record.results[name].rows;
        const headers = id === 'elbo' ? ['Update', 'Bound', 'Gap', 'Reconstruction'] : ['Decision', 'Cell', 'Action', 'Message', 'Prior', 'Conditioned'];
        nodes.chart.append(h('h4', { text: label }), h('div.inference-table', null, h('table', null, [
          h('thead', null, h('tr', null, headers.map(s => h('th', { text: s })))),
          h('tbody', null, rows.map(r => h('tr', { 'data-time': r.t }, (id === 'elbo'
            ? [r.t, num(r.measurement.elbo), num(r.measurement.gap), num(r.measurement.reconstruction)]
            : [r.t, r.state, r.action, num(r.beta), num(r.prior), num(r.posterior)]).map(s => h('td', { text: String(s) }))))),
        ])));
      }
      nodes.evidence.append(h('p.small', { text: 'Every displayed value and frame comes from this live run. Changing a setting keeps these measurements marked stale until Run.' }),
        h('button.btn.ghost', { type: 'button', onclick: () => {
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([RLA.exact.stringify(record)], { type: 'application/json' }));
          a.download = id + '-measured-run.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, 'Download measured run'));
    }
    function draw() {
      if (!ctx || !nodes.scene?.isConnected) { stop(); return; }
      if (record) adapter.draw(record, time); else adapter.mount(nodes.scene);
      results();
      for (const key of ['scene', 'chart', 'result', 'evidence']) {
        nodes[key].dataset.world = id; nodes[key].dataset.stale = String(stale);
        if (record) nodes[key].dataset.run = record.id; else delete nodes[key].dataset.run;
      }
      nodes.run.disabled = running; nodes.run.textContent = running ? 'Computing…' : stale ? 'Run again' : 'Run';
      nodes.watch.disabled = nodes.step.disabled = nodes.replay.disabled = !record || stale;
      nodes.watch.textContent = timer ? 'Pause' : 'Watch';
      nodes.notice.textContent = stale ? 'Settings changed. Run again to measure them; the scene and results below still show the previous settings.' : '';
      nodes.notice.hidden = !stale;
      nodes.clock.textContent = record ? 'Event ' + (time + 1) + ' of ' + R.length(record) : 'Ready to measure';
    }
    function teaching() {
      if (!ctx || !pane?.isConnected) return;
      const h = ctx.h;
      const qIndex = stage < 1 ? 0 : stage < 3 ? 1 : 2;
      const question = spec.questions[qIndex];
      const showQuestion = stage === 0 || stage === 2 || stage >= 4;
      const card = h('section.card.stack', { id: id + '-lesson' }, [
        h('div.eyebrow', { text: 'Inference experiment · ' + (Math.min(stage, 4) + 1) + ' / 5' }),
        h('h2', { text: spec.level.title }), h('p', { text: spec.level.intro }),
        h('h3', { text: ['Predict', 'Run the comparison', 'Diagnose', 'Change and run again', 'Explain'][Math.min(stage, 4)] }),
        h('p', { text: spec.instructions[Math.min(stage, 4)] }),
      ]);
      if (ctx.shell) card.append(ctx.shell.conceptSketch(spec.sketch));
      if (showQuestion) {
        card.append(h('p', { text: question.prompt }), h('div.mc', { id: question.id }, question.options.map((o, i) =>
          h('button.opt' + (picks[question.id] === i ? o.correct ? '.right' : '.wrong' : ''), {
            id: o.id || question.id + '-' + i, type: 'button', disabled: (stage === 2 || stage >= 4) && (!record || stale), onclick: () => {
              picks[question.id] = i; ctx.record?.(question.id, i, !!o.correct);
              if (o.correct) { if (stage === 0) mark(1); else if (stage === 2) mark(3); }
              teaching();
            },
          }, [h('span', { text: o.text }), picks[question.id] === i ? h('span.why', { text: o.why }) : null]))));
      }
      if (stage === 1) card.append(h('p', { text: 'Use Run beside the scene. Watch or Step then follows the recorded computation.' }));
      if (stage === 3) card.append(h('button.btn', { type: 'button', disabled: !changedRun || stale, onclick: () => { mark(4); teaching(); } }, 'Explain the changed result'));
      if (stage >= 4) card.append(h('button.btn', { type: 'button', id: id + '-complete', disabled: !record || stale || !spec.questions[2].options[picks[spec.questions[2].id]]?.correct,
        onclick: () => { ctx.complete(); teaching(); } }, ctx.done() ? 'Lesson complete' : 'Complete lesson'));
      const next = CONTENT.levels[CONTENT.levels.findIndex(l => l.id === id) + 1];
      if (ctx.done() && next) card.append(h('button.btn.ghost', { type: 'button', onclick: () => bellman.level(next.id) }, 'Next level: ' + next.title));
      card.append(h('p.small', { text: 'Idea adapted from Berkeley CS 285.' }));
      pane.replaceChildren(card);
    }
    function mount(nextPane, nextLab, hooks) {
      stop(); ctx = hooks; pane = nextPane; lab = nextLab;
      const h = ctx.h;
      stage = ctx.step?.() || 0;
      picks = Object.fromEntries(spec.questions.map(q => [q.id, ctx.answer?.(q.id)?.choice]));
      nodes.scene = h('div.inference-scene', { id: id + '-scene', 'data-world': id });
      nodes.settings = h('div.inference-settings');
      nodes.notice = h('p', { id: id + '-stale', role: 'status' });
      nodes.clock = h('span.small', { id: id + '-clock' });
      nodes.run = h('button.btn', { id: id + '-run', type: 'button', onclick: run }, 'Run');
      nodes.watch = h('button.btn.ghost', { id: id + '-watch', type: 'button', onclick: () => {
        if (timer) stop(); else if (!matchMedia('(prefers-reduced-motion: reduce)').matches && record && !stale) {
          if (time >= R.length(record) - 1) time = 0;
          timer = setInterval(() => { if (!nodes.scene.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) { stop(); draw(); return; } time++; if (time >= R.length(record) - 1) stop(); draw(); }, 600);
        }
        draw();
      } }, 'Watch');
      nodes.step = h('button.btn.ghost', { id: id + '-step', type: 'button', onclick: () => { stop(); time = Math.min(R.length(record) - 1, time + 1); draw(); } }, 'Step');
      nodes.replay = h('button.btn.ghost', { id: id + '-replay', type: 'button', onclick: () => { stop(); time = 0; draw(); } }, 'Replay');
      nodes.result = h('section', { id: id + '-result' }); nodes.chart = h('section', { id: id + '-chart' }); nodes.evidence = h('section', { id: id + '-evidence' });
      const rule = h('section', { id: id + '-rules' }, [h('h3', { text: 'Experiment rules' }), h('p', { text: spec.level.goal.text }), ...spec.rules.map(s => h('p', { text: s }))]);
      lab.replaceChildren(h('section.card.stack.inference-lab', null, [h('h2', { text: spec.sceneTitle }), nodes.settings, nodes.notice,
        nodes.scene, h('div.row.replay-controls', null, [nodes.run, nodes.watch, nodes.step, nodes.replay, nodes.clock]), nodes.result]));
      if (ctx.shell) {
        ctx.shell.notebook('rule').replaceChildren(rule);
        ctx.shell.notebook('curve').replaceChildren(nodes.chart);
        ctx.shell.notebook('autopsy').replaceChildren(nodes.evidence);
        ctx.shell.notebook('notes').replaceChildren(...spec.instructions.map(s => h('p', { text: s })));
      } else lab.append(rule, nodes.chart, nodes.evidence);
      adapter = BB.sceneAdapter.create({ world: id, settings: spec.controls.map(c => c.key), render: scene });
      controls(); adapter.mount(nodes.scene); draw(); teaching();
    }
    return { mount, run, cancel, record: () => record, replay, state: () => ({ world: id, mode: 'campaign', level: spec.level.title,
      sentenceName: spec.sceneTitle, knobs: structuredClone(settings), words: {}, idleWords: {}, discovered: [],
      lastRun: record ? { steps: R.length(record), symptoms: [], summary: spec.sceneTitle + ' measured.', stale } : null }) };
  }
  window.BBInferenceLesson = { create };
})();
