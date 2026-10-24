// Two measured episodes, with the task record carried across the episode reset.
(function (C, M) {
  'use strict';
  if (!C || !M) throw Error('metarl lesson requires CONTENT and BBMETARL');
  if (!C.phases.some(p => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.metarl = 'Probe doors';
  const lesson = {
    id: 'metarl', custom: true, phase: 9, world: 'metarl', focus: [],
    title: 'The second episode reads the first',
    intro: 'Find the paying door. It stays the same for two episodes: can the second attempt use what the first one found?',
    introMore: 'Two doors, two episodes per task. Open one door to earn 1 if it pays, or 0 otherwise. The paying door stays fixed within a task. The first episode always probes left. After a reset, the second choice can use that reward.',
    goal: { text: 'Use the first episode’s reward to choose the second door on two new tasks.' },
  };
  const after = C.levels.findIndex(l => l.id === 'hindsight');
  const before = C.levels.findIndex(l => l.id === 'supermimic');
  C.levels.splice(after >= 0 ? after + 1 : before >= 0 ? before : C.levels.length, 0, lesson);
  const labels = { L: 'left', R: 'right' };
  const settings = { contingency: 'original', held: 'balanced' };
  let record = null, stale = false, time = 0, policy = 'history', timer = null, view = null, adapter = null;
  let redraw = null, ctx = null;
  const door = action => labels[action] || 'unchosen';
  const questions = [
    { id: 'metarl-p', title: 'Predict', prompt: 'Training has more paying-left tasks. On a new task the left probe pays 0. What does a count that ignores that probe do next?', options: [
      ['Open right because the probe failed.', false, 'That response needs the first episode’s record. The memoryless count ignores it.'],
      ['Open left, the majority door in training.', true, 'The memoryless count pools both first-episode outcomes. It keeps the majority door.'],
      ['Look up the new task id.', false, 'The new task id has no training row.'],
    ] },
    { id: 'metarl-d', title: 'Diagnose', prompt: 'After a left probe pays 0, what does the history-conditioned count consult for the second choice?', options: [
      ['The hidden paying door.', false, 'The hidden door only determines the reward. It is not an input to the choice.'],
      ['The training success counts for “left, reward 0”.', true, 'The first reward selects a count row. The new task id is not an input.'],
      ['A recurrent neural network.', false, 'This toy learns a count table. A recurrent network is a different implementation.'],
    ] },
    { id: 'metarl-x', title: 'Explain', prompt: 'Which account matches the original run?', options: [
      ['Trying both doors is the same learning rule.', false, 'Trying both reads new rewards directly. It can work even after the training counts are deleted.'],
      ['History-conditioned counts score 2 of 2; memoryless counts score 1 of 2. Deleted counts leave the second choice unknown.', true, 'The same 12 training interactions supply both fitted counts. No held-out reward updates them. Two episodes are this toy’s horizon.'],
      ['Two episodes solve every new task, and new ids are in the training table.', false, 'The new ids are absent from training. Two episodes are only the horizon of this toy.'],
    ] },
  ];
  let answers = [null, null, null], stage = 0, repaired = false;
  function stop() { if (timer != null) clearInterval(timer); timer = null; }
  function length(r) { return r ? r.events[policy].length : 0; }
  function sync() {
    if (!view?.isConnected) { stop(); return; }
    for (const el of view.querySelectorAll('[data-record-surface]')) {
      el.dataset.run = record?.id || ''; el.dataset.stale = String(stale);
    }
    view.querySelector('#metarl-stale').hidden = !stale;
    for (const id of ['watch', 'step', 'replay']) view.querySelector('#metarl-' + id).disabled = !record;
    view.querySelector('#metarl-watch').textContent = timer == null ? 'Watch' : 'Pause';
    view.querySelector('#metarl-position').textContent = record ? 'Event ' + (time + 1) + ' of ' + length(record) : 'Run to record both episodes';
    if (record) adapter.draw(record, time);
  }
  function draw(canvas, r, t, method) {
    if (t === null) return (r ? r.events[method].length : 0);
    const c = canvas.getContext('2d'), style = getComputedStyle(canvas);
    const ink = style.getPropertyValue('--ink').trim() || '#202c35';
    const surface = style.getPropertyValue('--surface').trim() || '#fff';
    const event = r ? r.events[method][Math.min(t, (r ? r.events[method].length : 0) - 1)] : null;
    c.clearRect(0, 0, 640, 400); c.fillStyle = surface; c.fillRect(0, 0, 640, 400);
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 3;
    c.font = '30px sans-serif'; c.textAlign = 'center';
    ['L', 'R'].forEach((action, i) => {
      const x = 115 + i * 300, open = event && event.action === action && ['open', 'feedback'].includes(event.kind);
      c.strokeRect(x, 90, 110, 200);
      if (open) { c.fillStyle = ink; c.fillRect(x + 10, 100, 90, 180); c.fillStyle = surface; c.fillText('OPEN', x + 55, 200); c.fillStyle = ink; }
      else { c.beginPath(); c.arc(x + 90, 190, 7, 0, Math.PI * 2); c.fill(); }
      c.fillText(action === 'L' ? 'L · Left' : 'R · Right', x + 55, 55);
    });
    const x = event?.action === 'L' ? 170 : event?.action === 'R' ? 470 : 320;
    BB.scenes.robot(c, x, 360, 70, { mood: event?.reward === 1 ? 'happy' : 'neutral' });
    c.textAlign = 'left'; c.font = '18px sans-serif';
    let text = 'Start: two closed doors. First probe: left.';
    if (event?.kind === 'reset') text = 'Reset for episode ' + event.episode + '. Doors closed.';
    if (event?.kind === 'open') text = 'Episode ' + event.episode + ': open ' + door(event.action) + '. Await feedback.';
    if (event?.kind === 'feedback') text = 'Reward ' + event.reward + '. Episode ' + event.episode + ' ended.';
    if (event?.kind === 'stop') text = 'Second action unchosen: ' + event.reason + '.';
    if (event?.kind === 'fit') text = 'Fit completed: ' + event.updates + ' count updates.';
    // The full event caption below the canvas stays readable at phone widths.
    const caption = view?.querySelector('#metarl-feedback');
    if (caption) caption.textContent = event ? (event.phase === 'training' ? 'Training' : 'New task') + (event.task ? ' · ' + event.task : '') + ' · ' + text + (event.episode === 2 ? (method === 'memoryless' ? ' First reward, ignored by this method: ' : ' First-episode memory: ') + (r.training.find(row => row.id === event.task)?.history || event.history) + '.' : '') : text;
    const chart = document.querySelector('#metarl-curve-caption');
    if (chart && r) {
      const observed = r.events[method].slice(0, t + 1).filter(e => e.kind === 'feedback');
      chart.textContent = 'Recorded rewards through this event: ' + (observed.map(e => (e.phase === 'training' ? 'Train' : 'New') + ' ' + e.task + ' E' + e.episode + '=' + e.reward).join(' · ') || 'none yet') + '.';
      const plot = document.querySelector('#metarl-curve-plot'), pc = plot.getContext('2d');
      pc.clearRect(0, 0, 640, 180); pc.fillStyle = surface; pc.fillRect(0, 0, 640, 180);
      pc.strokeStyle = ink; pc.fillStyle = ink; pc.font = '16px sans-serif'; pc.textAlign = 'left';
      pc.fillText('Reward 1', 12, 35); pc.fillText('Reward 0', 12, 115);
      pc.beginPath(); pc.moveTo(100, 130); pc.lineTo(620, 130); pc.stroke();
      const all = r.events[method].filter(e => e.kind === 'feedback');
      observed.forEach((e, i) => {
        const x = 115 + i * 480 / Math.max(1, all.length - 1), y = e.reward === 1 ? 30 : 110;
        pc.strokeStyle = ink; pc.lineWidth = 2;
        if (e.phase === 'training') pc.strokeRect(x - 5, y - 5, 10, 10);
        else { pc.beginPath(); pc.arc(x, y, 6, 0, Math.PI * 2); pc.stroke(); }
      });
      pc.fillStyle = ink; pc.fillText('□ Training   ○ New task · measured opening order →', 12, 165);

    }
  }
  M.cancel = () => { stop(); record = null; stale = false; time = 0; view = null; adapter = null; redraw = null; };
  M.record = () => record;
  M.replay = () => ({ time, watching: timer != null, stale, world: view?.isConnected ? 'metarl' : null, length: length(record) });
  M.state = () => ({ world: 'metarl', level: lesson.title, sentenceName: 'Tabular cross-task adaptation', mode: 'campaign', knobs: { ...settings }, lastRun: record ? { steps: record.data.fresh.steps, summary: record.metrics } : null });
  M.run = () => {
    stop(); record = M.runRecord(settings); stale = false; time = 0; repaired = false;
    stage = answers[1] == null ? 2 : 3; ctx?.markStep?.(2); redraw?.(); sync(); return record;
  };
  M.mount = (pane, lab, api) => {
    stop(); ctx = api; record = null; stale = false; time = 0; policy = 'history'; repaired = false;
    answers = questions.map(q => api.answer?.(q.id)?.choice ?? null);
    // Returning answers survive, but a fresh measured run is still required.
    stage = answers[0] == null ? 0 : 1;
    const h = api.h;
    if (!document.getElementById('metarl-css')) {
      const css = h('style', { id: 'metarl-css', text: '#metarl-scene{width:100%;height:auto;display:block}#metarl-lab,#metarl-lesson{overflow-wrap:anywhere;min-width:0}#metarl-lab .btn,#metarl-lesson .opt,#metarl-lesson .btn,#metarl-lab select{min-height:44px;min-width:44px;max-width:100%;white-space:normal}#metarl-lab label{display:grid;gap:4px}#metarl-lab select{width:100%}#metarl-result table{width:100%;font-size:.85rem}#metarl-result th,#metarl-result td{text-align:left;overflow-wrap:anywhere;padding:6px}#metarl-lab canvas{border-radius:8px}' });
      document.head.append(css);
    }
    const change = (key, value) => { settings[key] = value; stop(); stale = !!record; repaired = false; sync(); redraw(); };
    const select = (key, options) => h('select', { id: 'metarl-' + key, onchange: e => change(key, e.target.value) }, options.map(([value, label]) => h('option', { value, selected: settings[key] === value }, label)));
    const scene = h('canvas', { id: 'metarl-scene', width: 640, height: 400, role: 'img', 'aria-label': 'Two doors and Rover, replaying measured door actions and episode resets', 'data-record-surface': '' });
    view = h('section.card.stack', { id: 'metarl-lab' }, [
      h('div.eyebrow', { text: 'Probe doors · measured simulation' }), h('p', { text: 'Find the paying door. The first episode probes left. Reset, then use its reward to choose again. A new task may pay a different door.' }), scene,
      h('p.small', { id: 'metarl-feedback', role: 'status' }),
      h('div.row', null, [
        h('button.btn.ghost', { id: 'metarl-watch', type: 'button', onclick: () => {
          if (timer != null) stop();
          else if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            if (time >= length(record) - 1) time = 0;
            timer = setInterval(() => { time = Math.min(time + 1, length(record) - 1); if (time >= length(record) - 1) stop(); sync(); }, 450);
          }
          sync();
        } }, 'Watch'),
        h('button.btn.ghost', { id: 'metarl-step', type: 'button', onclick: () => { stop(); time = Math.min(time + 1, length(record) - 1); sync(); } }, 'Step'),
        h('button.btn.ghost', { id: 'metarl-replay', type: 'button', onclick: () => { stop(); time = 0; sync(); } }, 'Replay'),
        h('span.small', { id: 'metarl-position' }),
      ]),
      h('label.small', { for: 'metarl-policy' }, ['Replay comparison', h('select', { id: 'metarl-policy', onchange: e => { stop(); policy = e.target.value; time = 0; createAdapter(); sync(); } }, [['history', 'History-conditioned count'], ['memoryless', 'Memoryless count'], ['deleted', 'Deleted counts']].map(([value, label]) => h('option', { value }, label)))]),
      h('label.small', { for: 'metarl-contingency' }, ['Training rewards', select('contingency', [['original', 'Four left-paying tasks, two right-paying'], ['left', 'All six training tasks pay left']])]),
      h('label.small', { for: 'metarl-held' }, ['New task rewards', select('held', [['balanced', 'One left-paying, one right-paying'], ['none', 'Neither door pays on either task']])]),
      h('p.small', { id: 'metarl-stale', role: 'status', hidden: true, text: 'Settings changed. Replay, rewards and results show the previous run. Run again to measure the change.' }),
      h('div', { id: 'metarl-result', 'data-record-surface': '' }),
    ]);
    lab.replaceChildren(view);
    function createAdapter() {
      const selected = policy;
      adapter = BB.sceneAdapter.create({ world: 'metarl', settings: ['contingency', 'held'], render: (canvas, r, t) => draw(canvas, r, t, selected) });
      adapter.mount(scene); M.adapter = adapter;
    }
    createAdapter();
    const body = h('section.card.stack.teaching-card', { id: 'metarl-lesson' }); pane.append(body);
    const rule = h('div.stack', null, [
      h('h3', { text: 'Rules · Probe doors' }),
      h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })]),
      h('p', { text: 'History-conditioned count: learn second-door success rates separately for each first reward. Memoryless count: pool first rewards. Deleted counts: remove that evidence, leaving the second action unknown. A missing count is unknown; tied rates choose neither door.' }),
      h('p', { text: 'A success rate is the number of rewards equal to 1 divided by the number of openings for that second action. Counts begin at zero, with no added guesses.' }),
      h('p', { text: 'Training opens left first, then follows a fixed second-door collection schedule. Each door opening ends its episode. An episode reset keeps the first reward for episode 2. A new task clears it. No new-task rewards update training counts.' }),
      h('p.small', null, [h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener' }, 'Idea adapted from Berkeley CS 285')]),
    ]);
    const curve = h('figure', { id: 'metarl-curve', 'data-record-surface': '' }, [h('canvas', { id: 'metarl-curve-plot', width: 640, height: 180, role: 'img', 'aria-label': 'Measured door rewards in opening order. Squares are training, circles are new tasks.', style: 'width:100%;height:auto', 'data-record-surface': '' }), h('figcaption.small', { id: 'metarl-curve-caption', text: 'Run to record rewards, then step through their measured order.' })]);
    const autopsy = h('div.stack', { id: 'metarl-autopsy', 'data-record-surface': '' }, [h('p.small', { text: 'Run the lesson to inspect its autopsy.' })]);
    // The shared shell owns the Notebook. Before slice6 lands, these are small local sections.
    if (api.shell) {
      api.shell.notebook('rule').replaceChildren(rule);
      api.shell.notebook('curve').replaceChildren(curve);
      api.shell.notebook('autopsy').replaceChildren(autopsy);
    } else view.append(h('details', null, [h('summary', { text: 'Rules and measured rewards' }), rule, curve, autopsy]));
    redraw = () => {
      if (!body.isConnected) return;
      const result = view.querySelector('#metarl-result');
      if (record) {
        result.replaceChildren(h('h3', { text: 'Second-episode results on new tasks' }), h('table', null, [
          h('thead', null, h('tr', null, ['Method', 'Score', 'New door openings'].map(text => h('th', { text })))),
          h('tbody', null, record.policies.map(p => { const m = record.metrics[p.name]; return h('tr', null, [h('th', { scope: 'row', text: p.label }), h('td', { text: m.score ? m.score.successes + ' / ' + m.score.tasks : 'Unknown second choice' }), h('td', { text: String(m.interactions) })]); })),
        ]), h('p.small', { text: 'Earlier data: 0 openings. Fresh training: 12 openings, 6 second-episode updates per fitted count. New-task evaluation: ' + (record.data.fresh.steps - 12) + ' openings across comparisons, 0 updates. Each opening is one episode. Deleted counts apply 0 updates.' }));
        autopsy.replaceChildren(h('h3', { text: 'Fitted training counts' }), ...record.policies.flatMap(p => record.counts[p.name].map(row => h('p.small', { text: p.label + ' · ' + (row.history === '*' ? 'all first rewards pooled' : row.history) + ': ' + row.actions.map(a => door(a.action) + ' ' + a.s + '/' + a.n + (a.n ? ' successes/openings' : ' (unknown)')).join('; ') + '. Second choice: ' + door(row.decision.action) + '.' }))), h('p.small', { text: 'Terminal reasons: ' + record.policies.map(p => p.label + ': ' + record.terminal[p.name].map(e => e.task + ' ' + e.reason).join(', ')).join('; ') + '.' }));
      }
      const kids = [h('div.eyebrow', { text: 'Probe doors' }), h('h2', { text: lesson.title }), h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })])];
      if (stage === 0) kids.push(h('p', { text: 'History-conditioned count separates first rewards. Memoryless count pools them. Deleted counts removes the training evidence.' }));
      if (stage === 0 || stage === 2 || stage >= 4) {
        const qi = stage === 0 ? 0 : stage === 2 ? 1 : 2, q = questions[qi];
        kids.push(h('h3', { text: q.title }), h('div.mc', { id: q.id }, [h('p', { text: q.prompt }), ...q.options.map(([label, correct, why], i) => h('button.opt' + (answers[qi] === i ? '.picked' : ''), { type: 'button', 'aria-pressed': String(answers[qi] === i), onclick: () => {
          answers[qi] = i; api.recordAnswer?.(q.id, i, correct);
          if (qi === 0) { stage = 1; api.markStep?.(1); }
          else if (qi === 1) { stage = 3; api.markStep?.(3); }
          redraw();
        } }, [h('span.res', { text: label }), answers[qi] === i ? h('span.why', { text: why }) : null]))]));
      }
      if (stage === 1) kids.push(h('h3', { text: 'Run' }), h('p', { text: 'Execute six training tasks, fit both counts from the same rewards, then evaluate two new task ids. Watch training, resets and new choices in order.' }));
      if (stage === 3) kids.push(h('h3', { text: 'Change and compare' }), h('p', { text: 'Replay Memoryless count and Deleted counts. Then change Training rewards to all left and Run again. The failed-left record now has no training evidence. Restore the original rewards and rerun to explain the original comparison.' }), h('button.btn', { id: 'metarl-repair', type: 'button', disabled: !record || stale || settings.contingency !== 'original' || settings.held !== 'balanced', onclick: () => { repaired = true; stage = 4; api.markStep?.(4); redraw(); } }, 'Use the history-conditioned count'));
      if (stage > 0) kids.push(h('button.btn' + (stage !== 1 ? '.ghost' : ''), { id: 'metarl-run', type: 'button', onclick: M.run }, record ? 'Run again' : 'Run'));
      if (stage >= 4) kids.push(h('button.btn', { id: 'metarl-complete', type: 'button', disabled: !repaired || stale || !record || answers[2] == null || !questions[2].options[answers[2]][1], onclick: () => { api.complete?.(); redraw(); } }, api.done?.() ? 'Lesson complete' : 'Record this measurement'));
      if (api.shell) {
        kids.push(api.shell.conceptSketch({ label: 'The first reward selects a training-count row for the second choice', nodes: [{ id: 'probe', label: 'Left probe', x: 50, y: 40 }, { id: 'count', label: 'Reward → count row', x: 165, y: 80 }, { id: 'choice', label: 'Second door', x: 265, y: 40 }], edges: [{ from: 'probe', to: 'count' }, { from: 'count', to: 'choice' }] }));
        api.shell.notebook('notes').replaceChildren(h('p', { text: questions.map((q, i) => q.title + ': ' + (answers[i] == null ? 'unanswered' : q.options[answers[i]][0] + ' ' + q.options[answers[i]][2])).join('\n') }));
      }
      body.replaceChildren(...kids); sync();
      for (const el of [curve, curve.querySelector('canvas'), autopsy]) { el.dataset.run = record?.id || ''; el.dataset.stale = String(stale); }
    };
    redraw();
  };
})(window.CONTENT, window.BBMETARL);
