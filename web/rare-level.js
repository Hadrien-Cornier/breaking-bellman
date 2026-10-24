// Returned rare lesson: measured hallway playback, with the common shell's teaching surfaces.
(function (C, M) {
  'use strict';
  const level = { id: 'rare', custom: true, phase: 11, world: 'rare', focus: [], title: 'A bonus for a rare cell',
    intro: 'Open the door at the end of an eight-cell hall. The environment pays 1 only for Open at the door. Can a bonus for visiting less familiar cells help the learner find it?',
    goal: { text: 'Compare sampled door openings and explain the difference between environment reward and a visit-count bonus.' } };
  C.phases.splice(C.phases.findIndex(p => p.n === 4) + 1, 0, { n: 11, title: 'Exploration by counts' });
  C.worldNames.rare = 'Sparse hallway';
  const previous = ['rewardfit', 'thaw', 'mixed'].map(id => C.levels.findIndex(l => l.id === id)).find(i => i >= 0);
  C.levels.splice(previous + 1, 0, level);
  const settings = { steps: 80, eps: 0.05 };
  let record = null, stale = false, time = 0, selected = 'on', timer = null, adapter = null;
  let render = null, stage = null, step = 0, request = 0, dispose = () => {};
  const answers = {};
  const num = n => Number(n).toFixed(3);
  const stop = () => { clearInterval(timer); timer = null; };
  function cancel() { stop(); dispose(); request++; record = null; stale = false; time = 0; adapter = null; render = null; stage = null; }
  async function run() {
    stop(); const token = ++request;
    const result = await window.BBRARE_RECORD.create({ ...settings });
    if (token !== request) return null;
    record = result; stale = false; time = 0; step = Math.max(step, 1);
    if (render) render();
    return record;
  }
  const api = window.BBRARELESSON = {
    cancel, run, record: () => record,
    replay: () => ({ time, watching: timer !== null, stale, world: adapter ? 'rare' : null, length: adapter ? adapter.length(record) : 0 }),
    state: () => ({ world: 'rare', level: level.title, mode: 'campaign', knobs: { ...settings },
      lastRun: record ? { steps: record.settings.steps, summary: record.metrics.on } : null }),
  };
  api.mount = (pane, lab, ctx) => {
    stop(); dispose();
    const { h, shell } = ctx;
    const scene = h('section.card.stack', { id: 'rare-experiment', 'aria-label': 'Sparse hallway experiment' });
    const card = h('section.card.stack.teaching-card', { id: 'rare-lesson' });
    pane.append(card); lab.replaceChildren(scene);
    const sections = {};
    for (const name of ['rule', 'curve', 'autopsy', 'notes']) {
      sections[name] = shell ? shell.notebook(name) : h('section.card.stack', { id: 'rare-' + name });
      if (!shell) lab.append(sections[name]);
    }
    function linked(el) { if (record) el.dataset.run = record.id; el.dataset.stale = String(stale); return el; }
    function draw(canvas, value, t) {
      if (t === null) return value ? value.settings.steps + 1 : 0;
      const frame = window.BBRARE_RECORD.frame(value, selected, t);
      const columns = canvas.getBoundingClientRect().width < 500 ? 4 : 8;
      canvas.width = columns * 100; canvas.height = columns === 4 ? 385 : 215;
      const context = canvas.getContext('2d');
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      const ink = dark ? '#f0f3f5' : '#172833', back = dark ? '#192933' : '#edf3f4';
      context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = back; context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '20px sans-serif'; context.textAlign = 'center';
      for (let i = 0; i < 8; i++) {
        const x = 4 + (i % columns) * 100, y = Math.floor(i / columns) * 180;
        context.save(); context.translate(0, y);
        context.strokeStyle = ink; context.lineWidth = frame.state === i ? 4 : 1;
        context.strokeRect(x, 75, 94, 95); context.fillStyle = ink;
        context.fillText(M.CELL_LABELS[i], x + 47, 62);
        context.fillText('n ' + frame.counts[i], x + 47, 198);
        if (i === 6) { context.strokeRect(x + 28, 95, 38, 70); context.fillText('○', x + 57, 141); }
        if (i === 7) { context.beginPath(); context.moveTo(x + 47, 91); context.lineTo(x + 68, 126); context.lineTo(x + 47, 161); context.lineTo(x + 26, 126); context.closePath(); context.stroke(); }
        context.restore();
      }
      window.BB.scenes.robot(context, 51 + (frame.state % columns) * 100, 162 + Math.floor(frame.state / columns) * 180, 72, { mood: frame.last && frame.last.reward ? 'happy' : 'normal', blink: false });
      canvas.setAttribute('aria-label', 'Sparse hallway. Rover at ' + M.CELL_LABELS[frame.state] + '. Measured step ' + frame.time + '.');
    }
    function paint() {
      if (!stage || !stage.isConnected) { stop(); return; }
      if (record) adapter.draw(record, time);
      const f = window.BBRARE_RECORD.frame(record, selected, time);
      scene.querySelector('#rare-clock').textContent = record ? 'Step ' + time + ' of ' + record.settings.steps + ' · ' + record.policies.find(p => p.name === selected).label : 'Start state · Run to collect samples';
      scene.querySelector('#rare-event').textContent = f.last
        ? M.CELL_LABELS[f.last.obs] + ' → ' + M.PROTOCOL.actions[f.last.action] + ' → ' + M.CELL_LABELS[f.state] + '. Environment reward ' + f.last.reward + '. Visit bonus ' + num(f.last.visitBonus) + '; bonus in target ' + num(f.last.intrinsic) + '. ' + (f.last.explored ? 'Sampled random action.' : 'Highest action score.')
        : 'Left and right move along the hall. Open works only at Door. Gem returns to Start on the next step.';
      scene.querySelector('#rare-watch').textContent = timer ? 'Pause' : 'Watch';
      const math = scene.querySelector('#rare-math');
      if (math) {
        const policy = window.BBRARE_RECORD.policies.find((p) => p.name === selected);
        const place = policy.place;
        const withheld = policy.reward === 'none';
        const proto = window.BBRARE.PROTOCOL;
        const hot = (on, text) => h('span' + (on ? '.hot' : ''), { text });
        const showNum = (n) => (isFinite(n) ? num(n) : '∞');
        const scoreTerm = place === 'local'
          ? hot(true, 'Q(s, a) + 1/√n(next)')
          : (place === 'optimism' || place === 'backup')
            ? hot(true, '20 until that action is tried, otherwise Q(s, a)')
            : 'Q(s, a)';
        const lines = [
          h('p', null, [h('b', { text: 'Action. ' }), 'Score = ', scoreTerm, '. Ties pick left.']),
          h('p', null, [h('b', { text: 'Target. ' }), 'y = ', hot(withheld, 'r'), ' + ', hot(place === 'target' || place === 'backup', 'b'), ' + γ max Q(s′, a′). ',
            place === 'local' ? 'b stays 0. 1/√n changes the action score only.' : '',
            place === 'off' || place === 'optimism' ? 'b stays 0.' : '',
            place === 'target' || place === 'backup' ? 'b is 1/√n after the visit.' : '',
            withheld ? ' r is forced to 0.' : '']),
        ];
        if (!f.last) lines.push(h('p', { text: record ? 'Press Step to substitute the recorded values of this sample.' : 'Press Run, then Step. Numbers are copied from the recorded sample.' }));
        else {
          const y = f.last.reward + f.last.intrinsic + proto.gamma * f.last.bootstrap;
          lines.push(h('p', null, [
            'This step: ', M.CELL_LABELS[f.last.obs], ' → ', proto.actions[f.last.action], ' → ', M.CELL_LABELS[f.last.state], '. ',
            f.last.explored ? 'Sampled random action. ' : 'Highest action score. ',
            'Action score ', showNum(f.last.actionScore), '. r ', showNum(f.last.reward), ', b ', showNum(f.last.intrinsic), ', max Q ', showNum(f.last.bootstrap), ', y ', showNum(y), '. ',
            'Q before ', showNum(f.last.qBefore), ', Q after ', showNum(f.last.qAfter), '. ',
            'α ', String(proto.alpha), ', γ ', String(proto.gamma), ', n after the visit ', String(f.last.nAfter), '.',
          ]));
        }
        math.replaceChildren(h('div.eyebrow', { text: 'Update for ' + policy.label }), ...lines);
      }
      const counts = sections.curve.querySelector('#rare-counts');
      if (counts) counts.replaceChildren(...f.counts.map((n, i) => h('div.rare-count', null, [h('strong', { text: M.CELL_LABELS[i] }), h('span', { text: 'Visits ' + n }), h('meter', { min: 0, max: record.settings.steps + 1, value: n, 'aria-label': M.CELL_LABELS[i] + ' visits' }), h('span', { text: n ? '1/√n ' + num(1 / Math.sqrt(n)) : 'Unseen' })])));
      const total = sections.curve.querySelector('#rare-totals');
      if (total) total.textContent = !record ? 'No samples recorded.' : 'Through step ' + time + ': environment reward ' + f.reward + '; sum of visit bonuses ' + num(f.visitBonus) + '. Counts include the initial Start visit.';
    }
    function change(key, value) { stop(); request++; settings[key] = value; if (record) stale = true; render(); }
    function question(id, prompt, options, correct) {
      return h('div.mc', { id }, [h('p', { text: prompt }), ...options.map((text, i) => h('button.opt' + (answers[id] === i ? '.picked' : ''), { type: 'button', onclick: () => { answers[id] = i; render(); } }, text)),
        answers[id] == null ? null : h('p', { role: 'status', text: answers[id] === correct ? 'Yes. Use the measured replay to check that explanation.' : 'Check the rule and the measured visits, then try again.' })]);
    }
    render = () => {
      if (!scene.isConnected) return;
      scene.replaceChildren(
        h('h2', { text: 'Sparse hallway' }),
        h('p', { text: 'Start → 1 → 2 → 3 → 4 → 5 → Door → Gem. Open at Door pays 1; other moves pay 0. Door openings do not end the run.' }),
        stage = linked(h('canvas', { id: 'rare-stage', width: 800, height: 230, role: 'img', 'data-world': 'rare' })),
        h('div.row', null, [
          h('label.field', null, ['Step budget', h('select', { id: 'rare-budget', onchange: e => change('steps', +e.target.value) }, [28, 80].map(n => h('option', { value: n, selected: n === settings.steps, text: n + ' steps per sample' })))]),
          h('label.field', null, ['Random-action chance', h('select', { id: 'rare-epsilon', onchange: e => change('eps', +e.target.value) }, [0.05, 0.2].map(n => h('option', { value: n, selected: n === settings.eps, text: n * 100 + '%' })))]),
          h('button.btn', { id: 'rare-run', type: 'button', onclick: run }, record ? 'Run again' : 'Run'),
        ]),
        h('p.small', { id: 'rare-stale', role: 'status', text: stale ? 'Settings changed. The scene and results show the previous run. Run again to measure these settings.' : 'Six named methods, five internal samples each. No earlier training data. The map is supplied to every method.' }),
        h('label.field', null, ['Watch method', h('select', { id: 'rare-policy', onchange: e => { selected = e.target.value; paint(); } }, window.BBRARE_RECORD.policies.map(p => h('option', { value: p.name, selected: selected === p.name, text: p.label })))]),
        h('div.row', { id: 'rare-controls' }, [
          h('button.btn', { id: 'rare-watch', type: 'button', disabled: !record, onclick: () => {
            if (timer) stop();
            else if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
              if (time >= record.settings.steps) time = 0;
              timer = setInterval(() => { time++; if (time >= record.settings.steps) stop(); paint(); }, 180);
            }
            paint();
          } }, timer ? 'Pause' : 'Watch'),
          h('button.btn', { id: 'rare-step', type: 'button', disabled: !record, onclick: () => { stop(); time = Math.min(record.settings.steps, time + 1); paint(); } }, 'Step'),
          h('button.btn', { id: 'rare-replay', type: 'button', disabled: !record, onclick: () => { stop(); time = 0; paint(); } }, 'Replay'),
        ]),
        h('div', { id: 'rare-math', 'aria-label': 'Action choice and Q update for the selected method' }),
        h('p.small', { id: 'rare-clock' }), h('p.small', { id: 'rare-event' }),
        h('p.small', { text: 'Watch replays one actual training sample per method. Step and Replay work with reduced motion. No path is interpolated.' }),
      );
      adapter = window.BB.sceneAdapter.create({ world: 'rare', settings: ['steps', 'eps'], render: draw });
      adapter.mount(stage);
      const definitions = [
        'No bonus: learn only from the environment reward. Equal scores choose left.',
        'Action-score bonus only: add 1/√n to the next cell’s action score, but never to the learned reward target.',
        'Target bonus only: add 1/√n to the reward target. Equal scores still choose left.',
        'Optimism only: an untried action scores 20 until tried. No count bonus enters the target.',
        'Optimism + target bonus: combine the untried-action score with a count bonus in the target.',
        'Bonus with reward withheld: use that same combination, but force environment reward to 0.',
      ];
      const teaching = [h('h2', { text: level.title }), h('p', { text: level.intro }), h('p.small', null, ['Idea adapted from ', h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-19.pdf', target: '_blank', rel: 'noopener' }, 'Berkeley CS 285'), '.'])];
      if (step === 0) teaching.push(h('h3', { text: 'Predict' }), h('p', { text: 'A policy chooses an action from the current cell. Its Q table stores learned action values. An update moves a value toward a target, which combines reward and an estimate of what comes next. n counts visits, so 1/√n shrinks as a cell becomes familiar.' }), h('ul', null, definitions.map(text => h('li', { text }))), question('rare-predict', 'With no bonus, no reward seen yet, and ties choosing left, what could hold the learner near Start?', ['The zero action values give no preference for right.', 'The door moves away during training.'], 0));
      else if (step === 1) teaching.push(h('h3', { text: 'Watch and diagnose' }), question('rare-diagnose', 'Step through No bonus, then Optimism + target bonus. What changes the target of the Q update?', ['The count bonus is added to the environment reward inside the update.', 'The count bonus is logged as environment reward.'], 0), h('button.btn', { type: 'button', disabled: answers['rare-diagnose'] !== 0, onclick: () => { step = 2; render(); } }, 'Explain the counts'));
      else teaching.push(h('h3', { text: 'Change and explain' }), h('p', { text: 'Try 28 steps or a 20% random-action chance, then Run again. A sampled success is not a guarantee. Reaching the door during training differs from a greedy policy that no longer needs a bonus.' }), question('rare-explain', 'Which kind of count did this experiment use?', ['Exact integer visits to each of eight cells.', 'A density model’s estimate for states that cannot be listed.'], 0), h('button.btn', { id: 'rare-complete', type: 'button', disabled: !record || stale || answers['rare-explain'] !== 0, onclick: () => { ctx.complete(); render(); } }, ctx.done() ? 'Lesson complete' : 'Finish lesson'));
      if (shell) teaching.push(shell.conceptSketch({ label: 'Repeated visits reduce the count bonus', nodes: [{ id: 'visit', label: 'visit a cell', x: 55, y: 45 }, { id: 'count', label: 'n grows', x: 160, y: 45 }, { id: 'bonus', label: '1/√n falls', x: 265, y: 45 }], edges: [{ from: 'visit', to: 'count' }, { from: 'count', to: 'bonus' }] }));
      card.replaceChildren(...teaching);
      sections.rule.replaceChildren(h('h3', { text: 'Rule' }), h('ul', null, definitions.map(text => h('li', { text }))), h('p', { text: 'The known map is deterministic. Randomness comes from action sampling. The same random draws are used for each named method. Q starts at zero; learning rate 0.5, discount 0.95. The visit bonus uses the destination count after the visit. Every run stops at its step budget, even after opening the door.' }));
      sections.curve.replaceChildren(linked(h('div.stack', { id: 'rare-chart' }, [h('h3', { text: 'Measured visits and bonus' }), record ? h('div.rare-counts', { id: 'rare-counts' }) : h('p', { text: 'Run to measure visits.' }), h('p.small', { id: 'rare-totals' })])));
      const results = linked(h('div.stack', { id: 'rare-results' }, [h('h3', { text: 'Observed samples' })]));
      if (record) {
        results.append(h('p', { text: record.data.fresh.steps + ' fresh training steps across ' + record.data.fresh.attempts + ' continuous training runs; ' + record.data.evaluation.steps + ' separate greedy evaluation moves; 0 prior training steps. A Gem reset is part of the same run. All methods stop at the step budget.' }));
        for (const p of record.policies) {
          const runs = record.results[p.name], m = record.metrics[p.name];
          results.append(h('p', { text: p.label + ': observed door crossings [' + runs.map(r => r.crossings).join(', ') + '], mean ' + num(m.meanCrossings) + '; rewarded openings [' + runs.map(r => r.openings).join(', ') + ']'  + '. Completed first sample: environment reward ' + runs[0].discoveredReward + ', sum of visit bonuses ' + num(runs[0].visitBonusSum) + ', Q(Start, right) before reward ' + num(runs[0].qRightBeforeReward) + '. Greedy test ' + (runs[0].greedyOpens ? 'opens the door.' : 'does not open the door.') }));
        }
        const m = record.metrics.on;
        results.append(h('p', { text: 'Random-action selections across five samples: observed ' + m.observedExplorations + '; expected ' + num(m.expectedExplorations) + ' from steps × probability × samples. Expected counts are not measured events or guaranteed outcomes. Door crossings with reward withheld pay 0.' }));
      } else results.append(h('p', { text: 'Run before drawing conclusions.' }));
      sections.autopsy.replaceChildren(results);
      sections.notes.replaceChildren(linked(h('div.stack', { id: 'rare-evidence' }, [h('h3', { text: 'Evidence and limits' }), h('p', { text: 'A pseudo-count estimates novelty from a density model. This experiment counts repeated visits exactly. It does not fit a density model. Six methods share a known map and five internal random samples. Sample lists use the same order for every method.' }), h('p', { text: 'Training paths, count bonuses and rewards come from recorded steps. The greedy test is a separate deterministic evaluation of the final Q table, with optimism removed. It supplies a result, not the displayed training path.' }), h('p', { text: 'The time view shows the first internal sample; results retain all five. A fixed small sample is evidence about this toy, not a general guarantee.' })])));
      paint();
    };
    const redrawScene = () => { if (stage && stage.isConnected) { if (record) paint(); else adapter.mount(stage); } };
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', redrawScene); window.addEventListener('resize', redrawScene);
    dispose = () => { media.removeEventListener('change', redrawScene); window.removeEventListener('resize', redrawScene); };
    render();
  };
})(window.CONTENT, window.BBRARE);
