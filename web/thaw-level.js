// Offline-to-online on one joint. The scores come from src/agents/thaw.js.
(function (C, M) {
  'use strict';
  C.worldNames.thaw = 'One-joint reacher';
  const GOAL = 'Compare the measured returns after starting from learned weights or zero weights, with the same fresh practice budget.';
  const question = (id, prompt, choices) => ({ id, prompt, options: choices.map(([result, why], i) => ({ steps: [result], result, why, correct: i === 1 })) });
  const predict = question('thaw-p', 'A policy is a rule that turns the current angle and speed into motor torque. Its weights are two adjustable numbers that set how strongly angle error and speed affect that torque. Frozen and Fine-tune start with weights learned from 50 recorded light-arm steps. From scratch starts with both weights at zero. At inertia 2, which prediction would you test?', [
    ['Frozen must reach the target on any arm.', 'The same torque accelerates a heavier arm less. A fit on the light arm does not guarantee the heavy-arm result.'],
    ['Fresh practice may help the learned starting weights adapt.', 'Run to compare Frozen, Fine-tune and From scratch. The measured result depends on inertia and practice budget.'],
    ['Frozen cannot move because its weights stay fixed.', 'Fixed weights still turn the current angle and speed into a torque at every step.'],
  ]);
  const diagnose = question('thaw-d', 'Watch Frozen and Fine-tune at the same replay step. What does changing inertia change?', [
    ['The target angle.', 'The target stays at 1 rad and every scored test lasts 50 steps.'],
    ['How much the arm accelerates under the same motor torque.', 'The motor torque is divided by inertia. Inertia 2 accelerates less than inertia 1.'],
    ['The number of steps in the scored test.', 'Every policy has a separate 50-step scored test at either inertia.'],
  ]);
  const repair = question('thaw-r', 'Which policy updates weights that were already learned from the earlier light-arm data?', [
    ['Frozen.', 'Frozen uses the learned weights without changing them and takes zero fresh practice attempts. Replay Frozen to see what those fixed weights do.'],
    ['Fine-tune.', 'Fine-tune starts from the learned weights. Four fresh 50-step attempts measure each update. It changes those two weights, then takes a separate scored test. Replay Fine-tune to see the result.'],
    ['From scratch.', 'From scratch also updates two weights using fresh attempts, but both start at zero. Replay From scratch to compare the starting points.'],
  ]);
  const explain = question('thaw-x', 'Change the fresh practice budget from 20 to 80 attempts per learning policy, then rerun. What is equal in the Fine-tune and From scratch comparison?', [
    ['All their earlier data and total work.', 'Fine-tune also uses the earlier 50 light-arm steps. From scratch does not. Equal fresh practice is not equal historical data or total work.'],
    ['Fresh attempts and the length of each scored test.', 'Both get 20 or 80 fresh attempts of 50 steps each, plus a separate 50-step scored test. Fine-tune starts with learned weights; From scratch starts at zero. At inertia 2, the longer budget narrows the return gap. Final angle error and total return can rank policies differently.'],
    ['Their starting weights.', 'Fine-tune starts with the learned weights. From scratch starts with 0, 0. Frozen keeps its learned weights and takes no fresh practice.'],
  ]);
  const level = {
    id: 'thaw', custom: true, phase: 4, world: 'thaw', title: 'A few fresh steps', focus: [],
    intro: 'Move one motor-driven arm from angle 0 to the target at 1 rad. Compare three policies at the same inertia and scored test length. Change the payload or fresh practice budget, then rerun.',
    goal: { text: GOAL },
    predict: predict, diagnose: diagnose, explain: explain,
  };
  const mixedAt = C.levels.findIndex((item) => item.id === 'mixed');
  if (mixedAt < 0) throw new Error('thaw requires the mixed level');
  if (!C.levels.some((item) => item.id === 'thaw')) C.levels.splice(mixedAt + 1, 0, level);
  C.cards.thaw = {
    name: 'A short thaw', status: 'checked',
    fixes: 'A policy turns angle and speed into torque. Its weights are the two adjustable numbers in that rule. Fine-tune starts with weights learned from earlier light-arm data and changes them using fresh attempts.',
    stillWrong: 'A useful starting point can save fresh practice on this arm. It does not guarantee the best result at every budget or on another arm.',
    paper: 'Idea adapted from Berkeley CS 285.',
    evidence: '<p>Frozen keeps the learned weights. Fine-tune updates them. From scratch updates weights that start at zero. Each learning policy gets the same fresh attempts, with separate scored tests. Earlier data and total work differ.</p>',
  };
  C.paperLinks = C.paperLinks || {};
  C.paperLinks.thaw = [{ t: 'Idea adapted from Berkeley CS 285', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/' }];
  const settings = { inertia: 2, updates: 5 };
  let recordState, clock = 0, timer = null, drawUI = () => {}, generation = 0, adapter = null, selected = null;
  const store = () => recordState || (recordState = RLA.runRecord.state());
  const labels = [['frozen', 'Frozen'], ['finetune', 'Fine-tune'], ['scratch', 'From scratch']];
  const number = n => Number(n).toFixed(3);
  function pause() { if (timer !== null) clearInterval(timer); timer = null; }
  M.cancel = pause;
  M.clear = () => { pause(); generation++; if (recordState) recordState.clear(); clock = 0; adapter = null; drawUI = () => {}; };
  M.record = () => store().record;
  M.replay = () => ({ time: clock, watching: timer !== null, stale: store().stale, world: 'thaw', length: store().record ? 51 : 0 });
  M.state = () => ({ world: 'thaw', mode: 'campaign', level: 'A few fresh steps', knobs: { ...settings }, comparison: store().record,
    lastRun: store().record ? { steps: store().record.data.fresh.steps, summary: store().record.metrics } : null });
  M.run = async () => {
    pause(); const token = ++generation, chosen = { ...settings };
    const record = await M.createRecord(chosen);
    if (token !== generation) return null;
    store().accept(record); clock = 0; drawUI(); return record;
  };
  const ns = 'http://www.w3.org/2000/svg';
  function svg(label, viewBox, markup) {
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', viewBox); el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); el.innerHTML = markup; return el;
  }
  // draw uses only the record and clock. No interpolation or engine calls occur here.
  function scene(h, host, record, t) {
    if (t === null) return 51;
    const inertia = record ? record.settings.inertia : settings.inertia;
    host.dataset.world = 'thaw';
    const panels = labels.map(([name, label], index) => {
      const sample = record && t > 0 ? record.series[name][Math.min(t, 50) - 1] : null;
      const angle = sample ? sample.state.angle : 0;
      const x = 100 + 77 * Math.cos(angle), y = 118 - 77 * Math.sin(angle);
      const targetX = 100 + 77 * Math.cos(1), targetY = 118 - 77 * Math.sin(1);
      const arm = svg(`${label}: angle ${number(angle)} radians. Start 0, target 1 radian. Inertia ${inertia}.`, '0 0 220 180',
        `<path d="M100 118 L177 118" stroke="var(--muted)" stroke-dasharray="2 4"/><path d="M100 118 L${targetX} ${targetY}" stroke="var(--muted)" stroke-dasharray="6 4"/><circle cx="${targetX}" cy="${targetY}" r="9" fill="none" stroke="var(--ink)"/><text x="126" y="23">Target 1 rad</text><text x="148" y="141">Start 0</text><path d="M80 137 L100 118 L120 137 Z" fill="var(--muted)"/><line x1="100" y1="118" x2="${x}" y2="${y}" stroke="var(--ink)" stroke-width="7"/><circle cx="100" cy="118" r="7" fill="var(--ink)"/><rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="${index === 0 ? 0 : index === 1 ? 4 : 8}" fill="var(--accent)" stroke="var(--ink)"/><text x="12" y="166">Payload: inertia ${inertia}</text>`);
      arm.dataset.angle = String(angle); arm.dataset.policy = name;
      return h('section.thaw-policy', { 'data-policy': name, hidden: selected !== 'all' && selected !== name }, [h('h3', { text: `${index + 1}. ${label}` }), arm,
        h('p.small', { text: `Angle ${number(angle)} rad${sample ? ', torque ' + number(sample.action) : ''}` })]);
    });
    host.replaceChildren(...panels);
  }
  function chart(h, record) {
    const scaleX = t => 32 + t * 5.3, scaleY = angle => 165 - angle * 80;
    const paths = record.policies.map(({ name, label }, i) => {
      const d = record.series[name].map((s, j) => `${j ? 'L' : 'M'}${scaleX(s.t)} ${scaleY(s.state.angle)}`).join(' ');
      return `<path data-policy="${name}" d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="${['none','7 4','2 4'][i]}"/>`;
    }).join('');
    return h('div', { id: 'thaw-chart', 'data-run': record.id }, [
      h('h3', { text: 'Angle through the scored test' }),
      svg('All 50 measured angle samples for each policy. Solid: Frozen. Dashed: Fine-tune. Dotted: From scratch.', '0 0 330 210',
        `<text x="4" y="16">Angle (rad)</text><text x="7" y="168">0</text><text x="7" y="88">1</text><path d="M32 85 H297" stroke="var(--muted)" stroke-dasharray="3 3"/>${paths}<path d="M${scaleX(clock)} 25 V170" stroke="var(--accent)"/><text x="28" y="192">0</text><text x="270" y="192">50 steps</text>`),
      h('p.small', { text: 'Frozen: solid. Fine-tune: dashed. From scratch: dotted. Target: 1 rad. The cursor follows replay.' }),
    ]);
  }
  function results(h, record) {
    return h('div', { id: 'thaw-results', 'data-run': record.id }, labels.map(([name, label]) => {
      const m = record.metrics[name], data = record.data.policies[name];
      return h('section', null, [h('h3', { text: label }), h('p', { text: `Total reward ${number(m.totalReward)}; final angle error ${number(m.terminalError)} rad. End angle ${number(m.endAngle)} rad.` }),
        h('p.small', { text: `Prior data: ${data.prior.steps} light-arm steps. Fresh practice: ${data.fresh.attempts} attempts, ${data.fresh.steps} steps. Scored test: 1 attempt, 50 steps. End reason: 50-step limit.` }),
        h('p.small', { text: `Starting weights: ${m.startWeights.map(number).join(', ')}. Final weights: ${m.weights.map(number).join(', ')}.` })]);
    }));
  }
  M.mount = (pane, lab, ctx) => {
    pause(); const h = ctx.h;
    if (selected === null) selected = matchMedia('(max-width: 600px)').matches ? 'frozen' : 'all';
    const body = h('div.card.stack.teaching-card', { id: 'thaw-lesson' }); pane.append(body);
    const notebooks = {};
    const notebook = section => ctx.shell ? ctx.shell.notebook(section) : (notebooks[section] || (notebooks[section] = h('section.card', { 'data-thaw-notebook': section })));
    const stepOf = ctx.step || (() => 0);
    let frameHost, position, watch, scrub;
    const frame = () => {
      if (!body.isConnected) { pause(); return; }
      const record = store().record;
      if (record) adapter.draw(record, clock);
      position.textContent = record ? `Scored test: step ${clock} of 50${store().stale ? ' · Previous settings, rerun needed' : ''}` : 'Start position. Run to measure the three policies.';
      watch.textContent = timer === null ? 'Watch' : 'Pause';
      scrub.value = String(clock);
      if (record) notebook('curve').replaceChildren(chart(h, record));
      for (const node of [frameHost, notebook('curve'), notebook('autopsy'), notebook('notes'), ...[notebook('curve'), notebook('autopsy'), notebook('notes')].flatMap(el => [...el.querySelectorAll('[data-run]')])]) {
        if (record) node.dataset.run = record.id; else delete node.dataset.run;
        node.dataset.stale = String(store().stale);
      }
    };
    const move = t => { pause(); clock = Math.max(0, Math.min(50, t)); frame(); };
    const change = (key, value) => { pause(); generation++; settings[key] = Number(value); store().change('thaw', settings); redraw(); };
    const run = async () => {
      const button = lab.querySelector('#thaw-run'); button.disabled = true;
      try {
        const record = await M.run(); if (!record) return;
        if (ctx.reveal) ctx.reveal('thaw');
        if (stepOf() < 2 && ctx.setStep) ctx.setStep(2);
      } catch (error) { position.textContent = 'Run failed: ' + error.message; }
      finally { if (button.isConnected) button.disabled = false; }
    };
    const redraw = () => {
      if (!body.isConnected) return;
      const record = store().record, stale = store().stale;
      const select = (id, title, key, options) => h('label.thaw-field', null, [h('span', { text: title }), h('select', { id, onchange: e => change(key, e.target.value) }, options.map(([value, text]) => h('option', { value, selected: settings[key] === value, text })))]);
      frameHost = h('div.thaw-arms', { id: 'thaw-scene', 'aria-label': 'Measured one-joint arm scene' });
      adapter = BB.sceneAdapter.create({ world: 'thaw', settings: ['inertia', 'updates'], render: (el, r, t) => scene(h, el, r, t) });
      adapter.mount(frameHost);
      position = h('p.small', { id: 'thaw-position', role: 'status' });
      watch = h('button.btn.secondary', { id: 'thaw-watch', type: 'button', disabled: !record || stale, onclick: () => {
        if (timer !== null) { pause(); frame(); return; }
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { move(clock + 1); return; }
        if (clock === 50) clock = 0;
        timer = setInterval(() => { clock++; if (clock >= 50) { clock = 50; pause(); } frame(); }, 100);
        frame();
      } }, 'Watch');
      scrub = h('input', { id: 'thaw-scrub', type: 'range', min: 0, max: 50, step: 1, value: clock, disabled: !record || stale, 'aria-label': 'Scored test step', oninput: e => move(Number(e.target.value)) });
      const sceneCard = h('section.card.stack.thaw-lab', { id: 'thaw-lab' }, [
        h('h2', { text: 'One-joint reacher' }),
        h('p', { text: 'Start at 0 rad. Reach the target at 1 rad. All three views use the same scale and replay clock.' }),
        h('div.row', null, [select('thaw-inertia', 'Payload inertia', 'inertia', [[1, '1 · Light arm'], [2, '2 · Heavy arm']]), select('thaw-budget', 'Fresh practice per learning policy', 'updates', [[5, '20 attempts · 1,000 steps'], [20, '80 attempts · 4,000 steps']])]),
        h('label.thaw-field', null, [h('span', { text: 'Policy view' }), h('select', { id: 'thaw-policy', onchange: e => { selected = e.target.value; if (record) frame(); else adapter.mount(frameHost); } }, [['all', 'Compare all three'], ...labels].map(([value, text]) => h('option', { value, text, selected: selected === value })))]),
        frameHost, position,
        h('div.row', { id: 'thaw-controls' }, [watch,
          h('button.btn.secondary', { id: 'thaw-step', type: 'button', disabled: !record || stale, onclick: () => move(clock + 1) }, 'Step'),
          h('button.btn.secondary', { id: 'thaw-replay', type: 'button', disabled: !record || stale, onclick: () => move(0) }, 'Replay'), scrub]),
        h('p.small', { id: 'thaw-stale', hidden: !stale, text: 'Settings changed. The scene, curve and results show the previous run. Run again to measure these settings.' }),
        h('button.btn', { id: 'thaw-run', type: 'button', onclick: run }, record ? 'Run again' : 'Run the three policies'),
      ]);
      lab.replaceChildren(sceneCard);
      notebook('rule').id = 'thaw-rules';
      notebook('rule').replaceChildren(h('p', { text: GOAL }), h('h3', { text: 'Rule and data budget' }), h('p', { text: 'Torque = weight 1 × (1 − angle) + weight 2 × speed, clipped between −1 and 1. Each step earns minus the squared angle error. Total reward adds all 50 rewards; higher is better. Final angle error measures only the last step; lower is better.' }),
        h('p', { text: `Frozen and Fine-tune share one earlier dataset: 50 recorded steps from one light-arm attempt. Fitting weights adds no new arm attempts. Frozen gets zero fresh practice. Fine-tune and From scratch each get ${settings.updates * 4} fresh attempts of 50 steps, or ${settings.updates * 200} steps. Four attempts measure the effect of small weight changes for each update. Each policy then takes its own 50-step scored test. Tests never update weights.` }));
      notebook('curve').replaceChildren(record ? chart(h, record) : h('p', { text: 'Run to see the measured angle curve.' }));
      notebook('autopsy').replaceChildren(record ? results(h, record) : h('p', { text: 'Run to compare total reward, final error, weights and data budgets.' }));
      const evidence = h('div', { id: 'thaw-evidence' }, [h('p.small', { text: record ? 'Live measurements from this page. Replay shows each scored state in order, with no interpolated motion. The episode ends at the 50-step limit.' : 'Run to measure the scored tests. The scene currently shows the starting position.' }), h('a', { href: C.paperLinks.thaw[0].u, target: '_blank', rel: 'noopener', text: C.paperLinks.thaw[0].t })]);
      if (record) evidence.dataset.run = record.id;
      notebook('notes').replaceChildren(evidence);
      for (const [index, q] of [[0, predict], [2, diagnose], [3, repair], [4, explain]]) {
        if (index < stepOf() && ctx.mc) notebook('notes').append(h('section', null, [h('h3', { text: 'Earlier question · Step ' + (index + 1) }), ctx.mc(q)]));
      }
      if (!ctx.shell) lab.append(...Object.values(notebooks));
      const step = Math.min(stepOf(), 5);
      const titles = ['Predict before you run', 'Run the comparison', 'Explain the payload', 'Name the weight update', 'Change the budget', 'What the comparison shows'];
      const questions = { 0: predict, 2: diagnose, 3: repair, 4: explain };
      const kids = [h('div.eyebrow', { text: 'A few fresh steps · Step ' + (step + 1) }), h('h2', { text: titles[step] })];
      if (step === 0) kids.push(h('p', { text: level.intro }));
      if (ctx.shell) kids.push(ctx.shell.conceptSketch({ label: 'Earlier data supplies starting weights; fresh practice changes them.', nodes: [
        { id: 'data', label: 'Earlier data', x: 55, y: 32 }, { id: 'weights', label: 'Weights', x: 220, y: 32 }, { id: 'practice', label: 'Fresh practice', x: 55, y: 93 }, { id: 'updated', label: 'Updated weights', x: 220, y: 93 },
      ], edges: [{ from: 'data', to: 'weights' }, { from: 'weights', to: 'updated' }, { from: 'practice', to: 'updated' }] }));
      if (questions[step] && ctx.mc) kids.push(ctx.mc(questions[step], () => {
        if (step >= 2 && (!store().record || store().stale)) return;
        if (step === 4) { ctx.complete(); if (ctx.refresh) ctx.refresh(); }
        else ctx.setStep(step + 1);
      }));
      if (step === 1 || (step >= 2 && !record)) kids.push(h('p', { text: 'Use Run the three policies in the scene. Nothing is measured until you run, even when returning to a completed lesson.' }));
      if (step === 3 && record) kids.push(h('div.row', null, labels.map(([name, label]) => h('button.btn.secondary', { type: 'button', onclick: () => { selected = name; lab.querySelector('#thaw-policy').value = name; move(0); frameHost.scrollIntoView({ block: 'nearest' }); } }, 'Replay ' + label))));
      if (step >= 2 && record && ctx.shell) kids.push(h('button.btn.secondary', { type: 'button', onclick: () => ctx.shell.open('autopsy') }, 'Inspect this run'));
      if (step === 5) kids.push(h('p', { text: 'Fine-tune updates learned weights. From scratch updates zero starting weights. Compare the measured returns at both practice budgets. Equal fresh attempts do not mean equal earlier data or total work.' }));
      if (step === 5) {
        const next = C.levels[C.levels.indexOf(level) + 1];
        if (next) kids.push(h('button.btn', { id: 'thaw-next', type: 'button', onclick: () => window.bellman.level(next.id) }, 'Next level: ' + next.title));
      }
      body.replaceChildren(...kids); frame();
    };
    drawUI = redraw;
    redraw();
  };
})(window.CONTENT, window.BBTHAW);
