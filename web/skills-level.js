// Lecture 23 diversity reward. Counts and the policy update live in src/agents/skills.js.
(function (C, S) {
  'use strict';
  if (!S || !S.train) throw new Error('BBSKILLS missing');
  if (!C.phases.some((p) => p.n === 10)) {
    const phase = { n: 10, title: 'Diverse skills' };
    const before = C.phases.findIndex((p) => p.n === 9);
    if (before >= 0) C.phases.splice(before, 0, phase);
    else C.phases.push(phase);
  }
  C.worldNames.skills = 'Two skills';
  const lesson = {
    id: 'skills', custom: true, phase: 10, world: 'skills', title: 'Pay a skill for being identifiable', focus: [],
    intro: 'Red and blue each take one action from the start. West enters the west room. East enters the east room. A smoothed count of those visits is q(skill|room). The reward is log q minus log of a uniform prior. A softmax policy then takes gradient steps on that reward.',
    goal: { text: 'Separate the skills with the discriminator reward when a room identifies the skill, and keep the reward at zero when the visits are symmetric.' },
  };
  if (!C.levels.some((l) => l.id === 'skills')) {
    const hin = C.levels.findIndex((l) => l.id === 'hindsight');
    if (hin >= 0) C.levels.splice(hin, 0, lesson);
    else {
      const sm = C.levels.findIndex((l) => l.id === 'supermimic');
      const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
      let insertAt = sm >= 0 ? sm : C.levels.length;
      if (goalsAt > insertAt) insertAt = goalsAt + 1;
      C.levels.splice(insertAt, 0, lesson);
    }
  }

  const num = x => x == null || !Number.isFinite(x) ? 'undefined' : String(Math.round(x * 1000) / 1000);
  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'data-key': o.key, 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { text: (o.correct ? 'Sound chain. ' : 'Not this one. ') + o.why }) : null,
    ]))));
  }

  const PREDICT = {
    id: 'skills-p',
    prompt: 'Both skills visit west four times and east four times. Smoothing adds one pseudo-count per skill. The prior is 1/2. What is the reward?',
    options: [
      { key: 'zero', result: 'q is 1/2 in every room, and the reward is 0.', correct: true, why: 'The smoothed count is (4+1)/(8+2) = 1/2. log(1/2) - log(1/2) is 0. The room was visited. It does not identify the skill.' },
      { key: 'listed', result: 'The reward sends red west, because west is the first action.', correct: false, why: 'A tie that adds the step to west is a separate rule. This count gives every room the same reward, and that reward is 0.' },
      { key: 'novel', result: 'The reward is 1, because the other skill missed a room.', correct: false, why: 'Both skills visited both rooms. A bonus of 1 for a room the other skill missed is a different reward. It is not log q - log p.' },
    ],
  };
  const DIAGNOSE = {
    id: 'skills-d',
    prompt: 'On the exploration plan, red has 6 west visits and 2 east visits. Blue has the opposite. q(red|west) is 7/10. The policies are still uniform. What is true?',
    options: [
      { key: 'assigned', result: 'Red already owns the west room, so its policy must enter west.', correct: false, why: 'q is a count. The logits are still 0. No update has run, and no room is stored on the skill.' },
      { key: 'signal', result: 'West makes red more probable than the prior, so the reward in west is positive. That number comes from this count.', correct: true, why: '7/10 is larger than 1/2, so log(7/10) - log(1/2) is log(1.4), about 0.336. Blue has the positive reward in east. The fit and the policy update are different steps.' },
      { key: 'miss', result: 'The reward is 1 because blue missed west.', correct: false, why: 'Blue has 2 visits in west. A unique-room bonus would be 0 here. The discriminator reward is not 1.' },
    ],
  };

  function explainQuestion(applied, report) {
    const sym = report.sym;
    const info = S.batchInformation(applied.counts);
    const avg = S.averageReward(applied.counts, applied.rewards.table);
    const red = applied.policies.red;
    const blue = applied.policies.blue;
    return {
      id: 'skills-x',
      prompt: 'Which account matches the tables on this page?',
      options: [
        { key: 'mi-policy', result: 'The average reward is the mutual information of the updated policy.', correct: false, why: 'The count table has mutual information ' + num(info.mutualInformation) + '. The average smoothed reward on those visits is ' + num(avg.value) + '. Red ends at p(west) ' + num(red.pi.west) + '. None of those three numbers is the mutual information of the policy.' },
        { key: 'split', result: 'The discriminator reward moves each skill toward the room where its own q is higher. Symmetric visits keep the reward at 0.', correct: true, why: 'Red greedy action ' + (red.action || 'tie') + ', blue greedy action ' + (blue.action || 'tie') + '. Symmetric q(red|west) is ' + num(sym.rewards.fit.rooms.west.q.red) + ' and its reward is ' + num(sym.rewards.table.red.west.value) + '. The gradient on that table stays 0. The mutual information above is the mutual information of the visits, not of the policy after ' + applied.updates + ' steps.' },
        { key: 'always', result: 'A shared reward of 1 always piles both skills into one room, and that pile-up is this objective.', correct: false, why: 'On the fixed exploration plan of ' + report.interactions + ' visits, shared reward without the tie leaves red at p(west) ' + num(report.shared.policies.red.pi.west) + '. The west tie is a stated rule for equal rewards. After that tie, a new discriminator fit has reward ' + num(report.afterTie.rewards.table.red.west.value) + ' and does not split the skills.' },
      ],
    };
  }

  function passed(applied) {
    if (!applied || applied.mode !== 'discriminator' || applied.tieBreak) return false;
    if (!applied.separated || !applied.rewards.fit) return false;
    return S.SKILLS.every((skill) => {
      const pol = applied.policies[skill];
      return pol.action && pol.action === pol.higherRoom && pol.pi[pol.action] > 0.5;
    });
  }

  const settings = { bias: 0.25, alpha: 1, updates: 4, budgetPerSkill: 8 };
  let record = null, stale = false, time = 0, timer = null, method = 'discriminator';
  let render = null, paint = null, adapter = null, mediaBound = false;
  const pause = () => { if (timer) clearInterval(timer); timer = null; };
  const api = {
    cancel: pause,
    clear() { pause(); record = null; stale = false; time = 0; adapter = null; render = null; paint = null; },
    record: () => record,
    replay: () => ({ time, watching: !!timer, stale, world: 'skills', length: record ? adapter.length(record) : 0 }),
    state: () => ({ world: 'skills', level: lesson.title, mode: 'campaign', knobs: { ...settings },
      sentenceName: 'Sample visits, fit rewards, update policies', words: {}, idleWords: {}, discovered: [],
      lastRun: record ? { steps: record.data.fresh.steps, symptoms: [], summary: record.metrics[method] } : null }),
    run() {
      pause(); record = window.BBSKILLS_RECORD.create(settings); stale = false; time = 0;
      if (render) render();
      return record;
    },
  };
  api.mount = (pane, lab, hooks) => {
    pause();
    if (!mediaBound) {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { pause(); paint?.(); });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paint?.());
      mediaBound = true;
    }
    const h = hooks.h, R = window.BBSKILLS_RECORD;
    if (!document.getElementById('skills-css')) {
      const css = h('style', { id: 'skills-css', text: '#skills-scene,#skills-lesson,#skills-evidence{min-width:0;overflow-wrap:anywhere}#skills-scene canvas{display:block;width:100%;height:auto}#skills-scene button,#skills-scene select,#skills-scene summary,#skills-lesson button,#skills-evidence summary{min-height:44px;min-width:44px}#skills-lesson a,#skills-evidence a{display:inline-flex;align-items:center;min-height:44px;min-width:44px}#skills-scene select{max-width:100%}#skills-chart svg{width:100%;height:auto;max-width:none}#skills-result table{width:100%;font-size:.85rem}#skills-result th,#skills-result td{padding:6px;text-align:left}#skills-lesson .concept{border:1px dashed var(--muted);padding:12px;border-radius:8px}#skills-lesson .concept svg{width:100%;max-width:380px;height:auto}' });
      document.head.append(css);
    }
    const scene = h('section.card.stack', { id: 'skills-scene', 'data-world': 'skills', 'aria-label': 'Measured room visits and policy updates' });
    const body = h('section.card.stack.teaching-card', { id: 'skills-lesson' });
    const evidence = h('section.card.stack', { id: 'skills-evidence' });
    const shell = hooks.shell;
    if (shell) {
      lab.replaceChildren(scene);
      pane.append(body);
      shell.notebook('autopsy').replaceChildren(evidence);
    } else {
      pane.append(scene, body); lab.replaceChildren(evidence);
    }
    let pred = hooks.answer?.('skills-p')?.choice ?? null;
    let diag = hooks.answer?.('skills-d')?.choice ?? null;
    let explain = hooks.answer?.('skills-x')?.choice ?? null;
    const choose = (q, value, setter) => choice(h, q, value, i => {
      setter(i); hooks.recordAnswer?.(q.id, i, !!q.options[i].correct); render();
    });
    const select = (key, title, options) => h('label.stack.small', null, [h('span', { text: title }),
      h('select', { id: 'skills-' + key, onchange: e => {
        pause(); settings[key] = Number(e.target.value); stale = !!record; render();
      } }, options.map(([value, text]) => h('option', { value, selected: settings[key] === value }, text))),
    ]);
    const linked = node => {
      if (record) node.dataset.run = record.id;
      else delete node.dataset.run;
      node.dataset.stale = String(stale);
      return node;
    };
    const sketch = () => {
      if (shell) return shell.conceptSketch({
        label: 'Visits inform a reward; updates change a policy.',
        nodes: [{ id: 'visits', label: 'Visit counts', x: 50, y: 60 },
          { id: 'reward', label: 'Reward', x: 160, y: 60 },
          { id: 'policy', label: 'Action probabilities', x: 270, y: 60 }],
        edges: [{ from: 'visits', to: 'reward' }, { from: 'reward', to: 'policy' }],
      });
      const box = h('figure.concept');
      box.innerHTML = '<svg viewBox="0 0 360 70" role="img" aria-label="Visits inform the reward, which changes action probabilities"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10h85v45H5z M130 10h85v45h-85z M255 10h100v45H255z M92 32h35m-8-6 8 6-8 6 M217 32h35m-8-6 8 6-8 6"/></g><g fill="currentColor" font-size="13" text-anchor="middle"><text x="47" y="37">Visit counts</text><text x="172" y="37">Reward</text><text x="305" y="30">Action</text><text x="305" y="46">probabilities</text></g></svg><figcaption>Concept sketch: visits inform a reward; updates change a policy.</figcaption>';
      return box;
    };
    function draw(canvas, rec, t) {
      if (t === null) return rec.events.discriminator.length + 1;
      const f = rec ? R.frame(rec, t, method) : { room: 'start', skill: null, counts: S.emptyCounts(), event: null };
      const ctx = canvas.getContext('2d'), style = getComputedStyle(canvas);
      ctx.clearRect(0, 0, 600, 240);
      const ink = style.getPropertyValue('--ink').trim() || '#25312f';
      const surface = style.getPropertyValue('--surface').trim() || '#fff';
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(100, 100); ctx.lineTo(500, 100); ctx.stroke();
      for (const [name, x] of [['west', 100], ['start', 300], ['east', 500]]) {
        ctx.fillStyle = surface; ctx.fillRect(x - 65, 35, 130, 130); ctx.strokeRect(x - 65, 35, 130, 130);
        ctx.fillStyle = ink; ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(name[0].toUpperCase() + name.slice(1), x, 28);
        if (name !== 'start') { ctx.font = '24px sans-serif'; ctx.fillText('Red ' + f.counts.red[name] + ' · Blue ' + f.counts.blue[name], x, 190); }
      }
      if (!rec || !f.event || f.event.kind === 'visit') {
        const x = f.room === 'west' ? 100 : f.room === 'east' ? 500 : 300;
        window.BB.scenes.robot(ctx, x, 143, 75, { mood: 'normal', blink: 0 });
        ctx.fillStyle = ink; ctx.font = '24px sans-serif'; ctx.fillText(f.skill ? f.skill.toUpperCase() + ' skill' : 'Ready', x, 220);
      } else {
        ctx.fillStyle = ink; ctx.font = '24px sans-serif'; ctx.fillText('Policy', 300, 92); ctx.fillText('update', 300, 122);
      }
    }
    function chart(rec) {
      const box = linked(h('section', { id: 'skills-chart', 'aria-label': 'Probability of choosing west after each update' }));
      const result = rec.metrics[method];
      const points = skill => [{ step: 0, west: 0.5 }].concat(result.trace.filter(e => e.skill === skill).map(e => ({ step: e.step + 1, west: e.piAfter.west })));
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 400 180'); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Probability of west. Red solid line; Blue dashed line. Horizontal axis: policy updates. Vertical axis: probability zero to one.');
      const el = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
      el('path', { d: 'M40 15V140H370', stroke: 'var(--ink)', fill: 'none' });
      el('text', { x: 10, y: 20, fill: 'var(--ink)', 'font-size': 12 }, '1');
      el('text', { x: 10, y: 140, fill: 'var(--ink)', 'font-size': 12 }, '0');
      for (const skill of S.SKILLS) el('polyline', { points: points(skill).map(p => (40 + p.step / result.updates * 330) + ',' + (140 - p.west * 120)).join(' '), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 3, 'stroke-dasharray': skill === 'blue' ? '7 6' : 'none' });
      el('line', { id: 'skills-cursor', x1: 40, x2: 40, y1: 15, y2: 140, stroke: 'var(--accent)', 'stroke-width': 2 });
      el('text', { x: 40, y: 165, fill: 'var(--ink)', 'font-size': 12 }, '0 updates');
      el('text', { x: 320, y: 165, fill: 'var(--ink)', 'font-size': 12 }, result.updates + ' updates');
      box.append(h('h3', { text: 'Probability of west' }), h('p.small', { text: 'Red: solid. Blue: dashed. These lines show policy updates, not movement.' }), svg, h('p.small', { id: 'skills-probabilities' }));
      return box;
    }
    render = () => {
      if (!scene.isConnected) return;
      linked(scene); linked(evidence);
      const canvas = linked(h('canvas', { id: 'skills-stage', width: 600, height: 240, role: 'img', 'aria-label': 'Start between west and east rooms; each trial ends in one room.' }));
      const watch = h('button.btn.ghost', { id: 'skills-watch', type: 'button', disabled: !record || stale, onclick: () => {
        if (timer) pause();
        else if (!matchMedia('(prefers-reduced-motion: reduce)').matches && time < adapter.length(record) - 1) {
          timer = setInterval(() => {
            if (!scene.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) { pause(); paint(); return; }
            time = Math.min(time + 1, adapter.length(record) - 1);
            if (time === adapter.length(record) - 1) pause();
            paint();
          }, 400);
        }
        paint();
      } }, timer ? 'Pause' : 'Watch');
      scene.replaceChildren(h('h2', { text: 'Two skills, two rooms' }),
        h('p', { text: 'Each trial resets at Start. Red and Blue are skill labels, written on the robot. One action reaches West or East and ends the trial.' }), canvas,
        h('p', { id: 'skills-event', 'aria-live': 'polite' }),
        h('div.row', null, [
          h('button.btn', { id: 'skills-run', type: 'button', onclick: () => { hooks.markStep?.(2); api.run(); } }, stale ? 'Run again' : 'Run'), watch,
          h('button.btn.ghost', { id: 'skills-step', type: 'button', disabled: !record || stale, onclick: () => { pause(); time = Math.min(time + 1, adapter.length(record) - 1); paint(); } }, 'Step'),
          h('button.btn.ghost', { id: 'skills-replay', type: 'button', disabled: !record || stale, onclick: () => { pause(); time = 0; paint(); } }, 'Replay'),
        ]),
        h('p.small', { id: 'skills-stale', hidden: !stale, text: 'Settings changed. The displayed run is stale. Run again to measure these settings.' }),
        h('label.stack', null, [h('span', { text: 'Reward method' }), h('select', { id: 'skills-method', onchange: e => { pause(); method = e.target.value; render(); } }, R.methods.map(m => h('option', { value: m.name, selected: method === m.name }, m.label)))]),
        h('details', null, [h('summary', { text: 'Change experiment settings' }), h('div.row', null, [
          select('bias', 'Exploration bias', [[0, '0: both explore evenly'], [0.25, '0.25: opposite tendencies'], [0.5, '0.5: opposite rooms']]),
          select('budgetPerSkill', 'Trials per skill', [[8, '8'], [16, '16']]),
          select('alpha', 'Smoothing pseudo-count', [[0, '0'], [1, '1'], [8, '8']]),
          select('updates', 'Policy updates per skill', [[1, '1'], [4, '4'], [8, '8']]),
        ])]), h('p.small', { text: 'Watch stays still when reduced motion is enabled. Use Step to inspect each event.' }));
      adapter = window.BB.sceneAdapter.create({ world: 'skills', settings: Object.keys(settings), render: draw });
      adapter.mount(canvas);
      const kids = [h('h2', { text: lesson.title }),
        h('p', { text: 'A policy gives probabilities for choosing West or East. A discriminator guesses the skill label from its room. We fit that guess from sampled visit counts, then reward a skill when the room makes its label more likely than the prior chance of 1/2.' }),
        h('p', { text: 'Identifiability reward uses log q(skill | room) minus log(1/2). Shared reward gives 1 in both rooms. Shared reward with west tie adds a separate rule favoring West when rewards match. Unique-room bonus gives 1 only in a visited room the other skill missed.' }),
        sketch(), h('p.small', null, [h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-23.pdf', target: '_blank', rel: 'noopener' }, 'Idea adapted from Berkeley CS 285')]),
        h('h3', { text: 'Predict on a symmetric count table' }), choose(PREDICT, pred, i => { pred = i; hooks.markStep?.(1); })];
      if (record) {
        const report = S.compare(); // Explicit analytical examples, never used as the measured replay.
        kids.push(h('h3', { text: 'Diagnose an exact example' }), h('p', { text: 'This question uses a fixed six-and-two count table. Your sampled experiment can have different counts.' }),
          choose(DIAGNOSE, diag, i => { diag = i; hooks.markStep?.(3); }));
        const applied = record.metrics.discriminator, q = explainQuestion(applied, report);
        kids.push(h('h3', { text: 'Explain the measured update' }), choose(q, explain, i => { explain = i; }),
          h('button.btn', { id: 'skills-complete', type: 'button', disabled: stale || !passed(applied) || pred !== 0 || diag !== 1 || explain !== 1,
            onclick: () => { hooks.complete?.(); render(); } }, hooks.done?.() ? 'Lesson complete' : 'Record this measurement'));
        const next = hooks.next?.();
        if (hooks.done?.() && next) kids.push(h('button.btn', { type: 'button', id: 'skills-next', onclick: () => hooks.openNext?.() }, 'Next level: ' + next.title));
      }
      if (shell) {
        // Completed teaching stays mounted in Notes with its stable question ids.
        // Only the current question occupies the shell's active teaching card.
        const intro = kids.splice(0, 5);
        shell.notebook('rule').replaceChildren(...intro);
        const prediction = kids.splice(0, 2);
        const diagnosis = record ? kids.splice(0, 3) : [];
        const explanation = kids;
        const notes = shell.notebook('notes');
        notes.replaceChildren();
        if (pred !== 0) body.replaceChildren(...prediction);
        else {
          notes.append(...prediction);
          if (!record) body.replaceChildren(h('h3', { text: 'Sample visits, then update policies' }),
            h('p', { text: 'Use Run in the scene to collect the trials, then Watch or Step through their measured visits and policy updates.' }));
          else if (diag !== 1) body.replaceChildren(...diagnosis);
          else { notes.append(...diagnosis); body.replaceChildren(...explanation); }
        }
        if (!notes.childNodes.length) notes.append(h('p.small', { text: 'Lesson notes appear here.' }));
      } else body.replaceChildren(...kids);
      const result = linked(h('section', { id: 'skills-result' }));
      const details = h('details', null, [h('summary', { text: 'Evidence and assumptions' }),
        h('p', { text: 'Two skills, two rooms, one action per trial. Each trial resets at Start. Visits are sampled from the exploration probabilities, not from the updated policies. There is no external task reward. All methods reuse the same batch. Updates optimize exact expected reward from zero logits, with step size 1 and no action-entropy term.' }),
        h('p', { text: 'Smoothing adds the same pseudo-count to each skill in each room. With zero smoothing, an unsupported room gives no finite reward and the affected update is skipped. The chart shows action probabilities, not a rollout of the updated policies. Count-table mutual information is not policy mutual information.' }),
        h('a', { href: 'https://arxiv.org/abs/1802.06070', target: '_blank', rel: 'noopener' }, 'Diversity is All You Need, equation 3')]);
      evidence.replaceChildren(h('h3', { id: 'skills-rules', text: 'Sample visits, then update policies' }),
        h('p', { text: 'Run samples ' + (settings.budgetPerSkill * 2) + ' one-action trials. Exploration uses p(West) = ' + (0.5 + settings.bias) + ' for Red and ' + (0.5 - settings.bias) + ' for Blue. Updates then change action probabilities without moving the robot.' }));
      if (record) {
        result.append(h('p', { text: 'Earlier data: ' + record.data.prior.steps + ' steps. Fresh data: ' + record.data.fresh.steps + ' steps in ' + record.data.fresh.attempts + ' trials, shared by all four methods. Policy updates add 0 environment steps.' }));
        result.append(h('table', null, [h('caption', { text: 'Measured final probabilities of West' }),
          h('thead', null, h('tr', null, ['Method', 'Red', 'Blue'].map(text => h('th', { scope: 'col', text })))),
          h('tbody', null, record.policies.map(p => h('tr', null, [h('th', { scope: 'row', text: p.label }), ...S.SKILLS.map(skill => h('td', { text: num(record.metrics[p.name].policies[skill].pi.west) }))])))]));
        result.append(h('p.small', { text: 'Terminal: ' + record.terminal[method] + '.' }));
        if (shell) shell.notebook('curve').replaceChildren(chart(record));
        else evidence.append(chart(record));
        evidence.append(result);
        details.append(h('p.small', { text: 'Measured counts: Red West ' + record.sample.counts.red.west + ', East ' + record.sample.counts.red.east + '; Blue West ' + record.sample.counts.blue.west + ', East ' + record.sample.counts.blue.east + '.' }));
      } else {
        if (shell) shell.notebook('curve').replaceChildren(h('p.small', { text: 'Run to collect visits and compare the reward methods.' }));
        evidence.append(h('p.small', { text: 'Run to collect visits and compare the reward methods.' }));
      }
      evidence.append(linked(details));
      paint = () => {
        if (!scene.isConnected) return;
        if (record) adapter.draw(record, time);
        const f = record ? R.frame(record, time, method) : null, e = f?.event;
        document.getElementById('skills-event').textContent = !e ? (record ? 'Event 0: ready at Start. Watch or Step through the recorded trials, then the updates.' : 'Ready at Start. Run to sample visits and compare reward methods.')
          : e.kind === 'visit' ? 'Event ' + time + ': ' + e.skill.toUpperCase() + ' trial ' + e.trial + ', Start → ' + e.room + '. Room reached; this trial ends.'
            : 'Event ' + time + ': ' + e.skill.toUpperCase() + ' policy update ' + (e.step + 1) + ', ' + e.reason + '. No new visit.';
        watch.textContent = timer ? 'Pause' : 'Watch';
        const probs = document.getElementById('skills-probabilities');
        if (probs && f) {
          probs.textContent = 'At this event: Red p(West) ' + num(f.policies.red.west) + '; Blue p(West) ' + num(f.policies.blue.west) + '.';
          const x = 40 + (e?.kind === 'policy-update' ? e.step + 1 : 0) / record.settings.updates * 330;
          const cursor = document.getElementById('skills-cursor'); cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
        }
      };
      paint();
    };
    render();
  };
  window.BBSKILLS_LEVEL = api;
})(window.CONTENT, window.BBSKILLS);
