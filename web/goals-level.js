// Goal-conditioned cloning, restored from 53a5a83 and connected to measured hallway replay.
(function (C, G, Records) {
  'use strict';
  if (!C.phases.some(p => p.n === 0)) C.phases.unshift({ n: 0, title: 'Imitation before reward' });
  C.worldNames.goals = 'Two doors';
  const lesson = { id: 'goals', custom: true, phase: 0, world: 'goals', title: 'Tell it the goal', focus: [],
    intro: 'Send a robot from the middle of the hall to the room you request. Both robots learn by copying the same recorded walks, but only one is told which room you want.',
    introMore: 'Reach the requested room in a five-cell hall. Both policies copy the same four demonstration walks. One room appears three times, the other once. A policy is a rule for choosing an action. Hidden goal counts actions by location only. Named goal also uses the requested room.',
    goal: { text: 'Reach either requested room by keeping the goal in the action count.' } };
  C.levels.unshift(lesson);
  const label = id => id.replaceAll('-', ' ');
  let settings = { goal: 'east-room', majority: 'west' }, record = null, stale = false, time = 0;
  let mediaCleanup = null;
  let timer = null, generation = 0, busy = false, redraw = null, draw = null, adapter = null;
  let predict = null, explain = null, visited = new Set(), step = 0;
  const stop = () => { clearInterval(timer); timer = null; };
  const cancel = () => { stop(); generation++; busy = false; if (mediaCleanup) mediaCleanup(); mediaCleanup = null; };
  function reset() {
    cancel(); record = null; stale = false; time = 0; step = 0; predict = explain = null; visited = new Set();
    redraw = draw = adapter = null; settings = { goal: 'east-room', majority: 'west' };
  }
  function update() { if (redraw) redraw(); }
  async function run() {
    stop(); const request = ++generation; busy = true; update();
    const measured = await Records.create(settings);
    if (request !== generation) return null;
    record = measured; stale = false; time = 0; busy = false; step = 1; explain = null;
    visited.add(record.settings.goal); update(); return record;
  }
  function change(key, value) {
    cancel(); settings = { ...settings, [key]: value };
    if (record) stale = true;
    predict = null; explain = null; step = 0; update();
  }
  function replay() { return { time, watching: timer !== null, stale, world: adapter?.world || null, length: adapter?.length(record) || 0 }; }
  function watch() {
    if (timer) { stop(); draw(); return; }
    if (!record || stale || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (time >= adapter.length(record) - 1) time = 0;
    timer = setInterval(() => {
      time = Math.min(time + 1, adapter.length(record) - 1);
      if (time === adapter.length(record) - 1) stop();
      draw();
    }, 700);
    draw();
  }
  function mount(pane, lab, ctx) {
    const { h, complete, done, shell } = ctx;
    const body = h('section.card.stack.teaching-card', { id: 'goals-lesson' }); pane.append(body);
    lab.replaceChildren();
    const stage = h('section.card.stack', { id: 'goals-stage', 'aria-label': 'Measured hallway comparison' });
    const controls = h('div.stack', { id: 'goals-settings' });
    const scene = h('div', { id: 'goals-scene', 'data-world': 'goals' });
    const canvases = Records.policies.map(policy => {
      const canvas = h('canvas', { width: 600, height: 165, role: 'img', 'aria-label': policy.label + ' in the five-cell hall' });
      scene.append(h('div.goals-lane', null, [h('h3', { text: policy.label }), canvas])); return canvas;
    });
    const positions = h('p.small', { id: 'goals-position', role: 'status' });
    const replayControls = h('div.row', { id: 'goals-controls' });
    const runButton = h('button.btn', { type: 'button', id: 'goals-run', onclick: run }, 'Run comparison');
    const watchButton = h('button.btn.ghost', { type: 'button', id: 'goals-watch', onclick: watch }, 'Watch');
    const stepButton = h('button.btn.ghost', { type: 'button', id: 'goals-step', onclick: () => { stop(); time = Math.min(time + 1, adapter.length(record) - 1); draw(); } }, 'Step');
    const replayButton = h('button.btn.ghost', { type: 'button', id: 'goals-replay', onclick: () => { stop(); time = 0; draw(); } }, 'Replay');
    replayControls.append(runButton, watchButton, stepButton, replayButton);
    const notice = h('p.small', { id: 'goals-stale', role: 'status' });
    stage.append(h('h2', { text: 'One hall, two ways to count' }), controls, scene, positions, replayControls, notice); lab.append(stage);
    const sections = {};
    for (const key of ['rule', 'curve', 'autopsy', 'notes']) {
      sections[key] = shell ? shell.notebook(key) : h('section.card.stack');
      if (!shell) lab.append(sections[key]);
    }
    const rules = h('div', { id: 'goals-rules' }); sections.rule.replaceChildren(rules);
    const result = h('div', { id: 'goals-result' }), chart = h('div', { id: 'goals-chart' }), evidence = h('div', { id: 'goals-evidence' });
    sections.autopsy.replaceChildren(result); sections.curve.replaceChildren(chart); sections.notes.replaceChildren(evidence);
    const linked = [stage, scene, ...canvases, result, chart, evidence];
    adapter = BB.sceneAdapter.create({ world: 'goals', settings: ['goal', 'majority'], render(el, measured, t) {
      if (t === null) return measured ? measured.series.hidden.length : 0;
      const goal = measured ? measured.settings.goal : settings.goal;
      const colors = getComputedStyle(stage), ink = colors.getPropertyValue('--ink').trim() || '#202a35';
      const background = colors.getPropertyValue('--surface').trim() || '#fff';
      Records.policies.forEach((policy, index) => {
        const samples = measured?.series[policy.name], sample = samples?.[Math.min(t, samples.length - 1)];
        const obs = sample ? sample.obs : 'start', canvas = canvases[index], c = canvas.getContext('2d');
        c.clearRect(0, 0, 600, 165); c.fillStyle = background; c.fillRect(0, 0, 600, 165);
        c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 2; c.font = '22px sans-serif'; c.textAlign = 'center';
        G.LINE.forEach((cell, i) => {
          const x = 10 + i * 118;
          c.setLineDash(cell === goal ? [7, 4] : []); c.strokeRect(x, 34, 112, 78); c.setLineDash([]);
          if (cell === goal) c.fillText('GOAL', x + 56, 24);
          const words = label(cell).split(' '); c.fillText(words[0], x + 56, 137); if (words[1]) c.fillText(words[1], x + 56, 161);
        });
        BB.scenes.robot(c, 66 + G.LINE.indexOf(obs) * 118, 105, 63, { noShadow: true });
        canvas.dataset.position = obs; canvas.dataset.time = String(t);
        canvas.setAttribute('aria-label', policy.label + ': ' + label(obs) + '. Requested ' + label(goal) + '. Move ' + t + ' of 2.');
      });
    } });
    adapter.mount(scene);
    draw = () => {
      if (!stage.isConnected) { stop(); return; }
      if (record) adapter.draw(record, time); else adapter.mount(scene);
      for (const node of linked) {
        if (record) node.dataset.run = record.id; else delete node.dataset.run;
        node.dataset.stale = String(stale);
      }
      const available = !!record && !stale && !busy;
      runButton.disabled = busy; runButton.textContent = busy ? 'Running…' : stale ? 'Rerun comparison' : 'Run comparison';
      watchButton.disabled = !available || matchMedia('(prefers-reduced-motion: reduce)').matches;
      watchButton.textContent = timer ? 'Pause' : 'Watch';
      stepButton.disabled = !available || time >= adapter.length(record) - 1; replayButton.disabled = !available;
      positions.textContent = record ? 'Move ' + time + ' of 2. ' + record.policies.map(p => p.label + ': ' + label(record.series[p.name][time].obs)).join('. ') + '.' : 'Both robots start in the middle. The dashed room is the requested goal. Run to measure their walks.';
      notice.textContent = stale ? 'Settings changed. The scene and results still show the previous run. Rerun comparison to measure the new settings.' : 'Each press of Step advances one recorded move. Reduced motion uses Step instead of automatic Watch.';
      chart.querySelectorAll('[data-time]').forEach(node => { node.setAttribute('aria-current', String(Number(node.dataset.time) === time)); });
    };
    redraw = () => {
      if (!body.isConnected) return;
      const select = (id, key, title, options) => h('label.goals-setting', null, [h('span', { text: title }),
        h('select', { id, onchange: e => change(key, e.target.value) }, options.map(([value, text]) => h('option', { value, text, selected: settings[key] === value })))]);
      controls.replaceChildren(select('goals-goal', 'goal', 'Requested room', [['east-room', 'East room'], ['west-room', 'West room']]),
        select('goals-majority', 'majority', 'Demonstration notes', [['west', '3 west walks, 1 east walk'], ['east', '1 west walk, 3 east walks']]));
      const question = (id, picked, options, onPick) => h('div.mc', { id }, options.map(([value, text]) =>
        h('button.opt', { id: id + '-' + value, type: 'button', 'aria-pressed': String(picked === value), onclick: () => onPick(value) }, text)));
      body.replaceChildren(h('div.eyebrow', { text: 'Tell it the goal · Step ' + (step + 1) + ' of 3' }));
      if (step === 0) {
        body.append(h('h2', { text: 'Predict the hidden-goal walk' }), h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })]),
          h('p', { text: 'A demonstration is a recorded example of someone walking to a room. Here, three examples go to the ' + settings.majority + ' room and one goes to the ' + (settings.majority === 'west' ? 'east' : 'west') + ' room. Each starts in the middle and takes two moves.' }),
          h('p', { text: 'A policy is a rule for choosing the next move. The robot labelled Hidden goal sees only its location and copies the move most often recorded there. The robot labelled Named goal also sees your requested room, so it counts only examples that were headed to that room. Both use the same four walks; they group the examples differently.' }),
          h('p', { text: 'Without the requested room, walks to different destinations are mixed together. With it, a robot can distinguish “go west from here” from “go east from here” even at the same starting point. If the action counts are equal, it chooses west.' }),
          h('p', { text: 'You request the ' + label(settings.goal) + '. Where will Hidden goal finish?' }),
          question('goals-predict', predict, [['west', 'West room'], ['east', 'East room']], value => { predict = value; update(); }),
          h('p.small', { text: predict ? 'Prediction saved for this comparison. Press Run comparison above to check it.' : 'Choose a prediction, then use Run comparison above.' }));
        if (shell) body.append(shell.conceptSketch({ label: 'The requested room changes which action counts are used',
          nodes: [{ id: 'notes', label: 'Same notes', x: 55, y: 60 }, { id: 'hidden', label: 'Location', x: 240, y: 25 }, { id: 'named', label: 'Location + goal', x: 240, y: 95 }],
          edges: [{ from: 'notes', to: 'hidden' }, { from: 'notes', to: 'named' }] }));
      } else if (step === 1) {
        const hidden = record.metrics.hidden, named = record.metrics.named;
        body.append(h('h2', { text: 'Watch the same request twice' }),
          h('p', { text: 'Requested ' + label(record.settings.goal) + '. Hidden goal ends in the ' + label(hidden.end) + '; Named goal ends in the ' + label(named.end) + '. Both walks stop after two moves.' }),
          h('p', { text: 'Use Watch, Pause, Step and Replay above. Hidden goal ignores the room request when counting. Named goal uses only demonstrations for the requested room.' }),
          h('p', { text: predict ? (predict === (hidden.end === 'west-room' ? 'west' : 'east') ? 'You predicted it correctly. ' : '') + 'Your prediction for Hidden goal was ' + predict + '. The measured endpoint is ' + label(hidden.end) + '.' : 'Compare the measured endpoints with the requested room.' }),
          h('p', { text: 'Change Requested room and rerun. Then reverse which demonstration is common. Named goal can still use the rarer walk because its room was kept in the notes.' }),
          h('button.btn', { type: 'button', id: 'goals-explain-open', onclick: () => { step = 2; update(); } }, 'Explain the difference'));
        if (shell) body.append(h('button.btn.ghost', { type: 'button', onclick: () => shell.open('curve') }, 'Inspect recorded moves'));
      } else {
        body.append(h('h2', { text: 'What changed in Named goal?' }),
          question('goals-explain', explain, [['count', 'It counts actions separately for each requested room.'], ['reward', 'It adds a reward for reaching the rare room.'], ['more', 'It collects more demonstrations.']], value => { explain = value; update(); }),
          h('p', { text: !explain ? 'Choose the explanation that matches the two policies.' : explain === 'count' ? 'Yes. The same eight demonstration steps serve both policies. Keeping the room changes which actions are counted together.' : 'Both policies use the same notes and no reward. Only the information used for each count changes.' }),
          h('p', { text: visited.size === 2 ? 'You have run both room requests.' : 'Run the other room request before finishing. Use the Requested room setting above.' }),
          h('button.btn', { type: 'button', id: 'goals-complete', disabled: explain !== 'count' || visited.size !== 2 || stale,
            onclick: () => { complete(); update(); } }, done() ? 'Lesson complete' : 'Complete lesson'));
      }
      rules.replaceChildren(h('p', { text: lesson.goal.text }), h('h3', { text: 'Hallway rules' }),
        h('p', { text: 'Start in the middle. Move one cell west or east. Each walk ends after two moves. Score is 1 if the last cell is the requested room, otherwise 0. There is no reward or reward training. Each policy chooses the action with the largest demonstration count; ties choose west.' }),
        h('p', { text: 'Named goal: p(action | location, room) = count(action, location, room) / count(location, room). Hidden goal leaves room out of both counts.' }),
        h('p.small', null, [h('a', { href: 'https://cs285.berkeley.edu/', text: 'Idea adapted from Berkeley CS 285' })]));
      if (record) {
        const table = (headers, rows) => h('table', null, [h('thead', null, h('tr', null, headers.map(text => h('th', { scope: 'col', text })))),
          h('tbody', null, rows.map(row => h('tr', null, row.map(text => h('td', { text: String(text) })))))]);
        result.replaceChildren(h('h3', { text: 'Measured result' }), table(['Policy', 'Last cell', 'Score'], record.policies.map(p => [p.label, label(record.metrics[p.name].end), record.metrics[p.name].score])),
          h('p', { text: 'Both walks end at the two-step limit. Score checks the endpoint; it is not a training reward.' }),
          h('p', { text: 'Prior data shared by both policies: ' + record.data.prior.steps + ' steps in ' + record.data.prior.attempts + ' walks. Fresh training: 0 steps, 0 attempts. Evaluation: ' + record.data.evaluation.steps + ' steps in ' + record.data.evaluation.attempts + ' walks.' }));
        chart.replaceChildren(h('h3', { text: 'Recorded positions' }), h('p.small', { text: 'Columns are measured moves. The outlined column follows replay.' }));
        for (const p of record.policies) chart.append(h('h4', { text: p.label }), h('div.goals-trace', null, record.series[p.name].map(sample => h('span', { 'data-time': sample.t, text: sample.t + ': ' + label(sample.obs) }))));
        evidence.replaceChildren(h('h3', { text: 'Counts behind this run' }));
        for (const p of record.policies) evidence.append(h('h4', { text: p.label }),
          ...record.results[p.name].table.map(row => h('p.small', { text: label(row.state) + (row.goal ? ', ' + label(row.goal) : '') + ': west ' + row.counts.west + ', east ' + row.counts.east + '. Choose ' + row.mode + '.' })));
        evidence.append(h('a', { href: 'https://github.com/Hadrien-Cornier/breaking-bellman/blob/main/src/agents/goals.js', text: 'Hallway engine and count rule' }));
      } else {
        result.replaceChildren(h('p', { text: 'Run to measure the two endpoints.' })); chart.replaceChildren(h('p', { text: 'Run to record each move.' })); evidence.replaceChildren(h('p', { text: 'Run to inspect the fitted counts.' }));
      }
      draw();
    };
    if (mediaCleanup) mediaCleanup();
    const motion = matchMedia('(prefers-reduced-motion: reduce)'), theme = matchMedia('(prefers-color-scheme: dark)');
    const onMedia = () => { if (motion.matches) stop(); draw(); };
    motion.addEventListener('change', onMedia); theme.addEventListener('change', onMedia);
    mediaCleanup = () => { motion.removeEventListener('change', onMedia); theme.removeEventListener('change', onMedia); };
    redraw();
  }
  window.BBGOALS_LEVEL = { mount, run, cancel, reset, record: () => record, replay,
    state: () => ({ world: 'goals', sentenceName: 'Count the action with the room', mode: 'campaign', level: lesson.title,
      knobs: { ...settings }, words: {}, idleWords: {}, discovered: [], lastRun: record ? { steps: 2, symptoms: [], summary: record.policies.map(p => p.label + ': ' + label(record.metrics[p.name].end)).join('. ') } : null }) };
})(window.CONTENT, window.BBGOALS, window.BBGOALS_RECORD);
