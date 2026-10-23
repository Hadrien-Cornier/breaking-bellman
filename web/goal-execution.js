// Measured replay for the two goal-execution lessons. No training happens in draw().
(function (root) {
  'use strict';
  const VERSION = 'goal-execution-v1';
  const labels = { original: 'Original goals only', stale: 'New goal, old reward', blind: 'Recompute, no goal input', once: 'Recompute, one sweep', hindsight: 'Recompute, selected sweeps', skill: 'Door skill, given sequence', flat: 'Flat learner', shaped: 'Flat learner with Door bonus', none: 'Empty table', wiped: 'Wiped table' };
  const names = { S: 'Start', M: 'Mid', W: 'West', E: 'East', F: 'Far', 0: 'Start', 1: 'Hall', 2: 'Door', 3: 'Right hall', 4: 'Prize', 5: 'Far', '-1': 'Pit' };
  const name = x => names[x] ?? String(x);
  function identity(level, settings, report) {
    // The complete measured output participates in the identity, including engine changes.
    let hash = 2166136261;
    for (const c of JSON.stringify({ VERSION, level, settings, report })) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    return level + '-' + hash.toString(16);
  }
  const ordered = events => events.map((event, t) => ({ ...event, t }));
  function record(level, settings, report) {
    const r = { id: identity(level, settings, report), version: VERSION, level, world: level, source: 'live', settings: { ...settings }, policies: [],
      data: { prior: { steps: 0, attempts: 0 }, fresh: { steps: 0, attempts: 0 } }, series: {}, events: {}, terminal: {}, metrics: {}, report };
    const add = (key, events, metrics, terminal) => {
      r.policies.push({ name: key, label: labels[key] }); r.events[key] = ordered(events); r.metrics[key] = metrics; r.terminal[key] = terminal;
      r.series[key] = r.events[key].filter(e => e.kind === 'move').map(e => ({ t: e.t, obs: e.from, action: e.action, reward: e.reward, next: e.to, goal: e.goal, phase: e.phase }));
    };
    if (level === 'hindsight') {
      r.data.prior = { steps: report.original.length, attempts: report.episodes.length };
      r.stored = ordered(report.episodes.flatMap(ep => [{ kind: 'start', phase: 'stored', to: ep.transitions[0].s, commanded: ep.commanded, achieved: ep.achieved, episode: ep.id },
        ...ep.transitions.map(tr => ({ kind: 'move', phase: 'stored', from: tr.s, to: tr.sp, action: tr.a, reward: tr.reward, goal: tr.g, commanded: ep.commanded, achieved: ep.achieved, episode: ep.id, terminated: tr.terminated, truncated: tr.truncated }))]));
      for (const [key, mode] of Object.entries(report.modes)) {
        const events = [], terminal = {};
        let steps = 0;
        for (const [goal, roll] of Object.entries(mode.rolls)) {
          events.push({ kind: 'start', phase: 'evaluation', to: roll.path[0], goal });
          roll.actions.forEach((action, i) => events.push({ kind: 'move', phase: 'evaluation', from: roll.path[i], to: roll.path[i + 1], action, reward: roll.path[i + 1] === goal ? 0 : -1, goal }));
          events.push({ kind: 'stop', phase: 'evaluation', to: roll.stopped, goal, reason: roll.reason });
          steps += roll.actions.length; terminal[goal] = roll.reason;
        }
        r.data.fresh.steps += steps; r.data.fresh.attempts += Object.keys(mode.rolls).length;
        add(key, events, { updates: mode.updates, solved: mode.heldout, far: mode.far, evaluationSteps: steps, evaluationAttempts: 3 }, terminal);
      }
    } else {
      const move = (m, phase) => ({ kind: 'move', phase, from: m.pos, to: m.next, action: m.action, reward: m.reward, goal: m.goal, terminated: m.terminal ?? m.reached });
      const training = (run, phase) => [{ kind: 'start', phase, to: 0, goal: run.goal }, ...run.log.map(e => e.kind === 'reset' ? { ...e, phase, goal: run.goal } : move(e, phase))];
      const execution = run => {
        const events = [{ kind: 'start', phase: 'execution', to: 0 }];
        run.options.forEach((op, i) => {
          events.push({ kind: 'call', phase: 'execution', to: op.moves[0]?.pos ?? op.final, goal: op.goal, call: i + 1, atPrimitive: op.atPrimitive });
          events.push(...op.moves.map(m => ({ ...move(m, 'execution'), call: i + 1 })));
          events.push({ kind: 'stop', phase: 'execution', to: op.final, goal: op.goal, call: i + 1, reason: op.terminated ? 'subgoal reached' : op.fell ? 'pit' : 'option cap' });
        });
        return events;
      };
      const prior = report.extraRun;
      r.data.prior = { steps: prior?.steps || 0, attempts: prior ? 1 + prior.resets : 0, resets: prior?.resets || 0, interactions: report.extra };
      r.prior = prior ? ordered(training(prior, 'prior')) : [];
      let freshSteps = 0, freshAttempts = 0, resets = 0;
      for (const key of ['skill', 'flat', 'shaped']) {
        const run = report[key];
        freshSteps += run.steps; freshAttempts += 1 + run.resets; resets += run.resets;
        let events = training(run, 'training'), evaluationSteps, reached, terminal;
        if (key === 'skill') {
          events.push(...execution(report.execution)); evaluationSteps = report.execution.primitive;
          reached = report.execution.reachedPrize;
          terminal = report.execution.options.map(op => op.terminated ? 'subgoal reached' : op.fell ? 'pit' : 'option cap');
        } else {
          const roll = run.greedy;
          terminal = roll.reached ? 'goal reached' : roll.final === -1 ? 'pit' : 'step cap'; reached = roll.reached; evaluationSteps = roll.steps;
          events.push({ kind: 'start', phase: 'evaluation', to: 0, goal: run.goal }, ...roll.moves.map(m => move({ ...m, reward: m.reached ? 1 : 0 }, 'evaluation')),
            { kind: 'stop', phase: 'evaluation', to: roll.final, goal: run.goal, reason: terminal });
        }
        freshSteps += evaluationSteps; freshAttempts++;
        add(key, events, { updates: run.updates, trainingSteps: run.steps, resets: run.resets, interactions: run.interactions, evaluationSteps, reached, calls: key === 'skill' ? report.execution.calls : 0 }, terminal);
      }
      for (const key of ['none', 'wiped']) {
        const run = report[key]; freshSteps += run.primitive; freshAttempts++;
        add(key, execution(run), { updates: 0, evaluationSteps: run.primitive, reached: run.reachedPrize, calls: run.calls }, run.options.map(op => op.terminated ? 'subgoal reached' : op.fell ? 'pit' : 'option cap'));
      }
      r.data.fresh = { steps: freshSteps, attempts: freshAttempts, resets, interactions: freshSteps + resets };
      r.data.optionCalls = report.execution.calls + report.none.calls + report.wiped.calls;
    }
    return r;
  }

  function frame(r, policy, time) {
    const events = policy === 'stored' ? r.stored : policy === 'prior' ? r.prior : r.events[policy];
    const t = Math.min(Math.max(0, Math.floor(time)), events.length - 1);
    return { ...events[t], resets: events.slice(0, t + 1).filter(e => e.kind === 'reset').length };
  }

  function terminalText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((reason, i) => 'call ' + (i + 1) + ': ' + reason).join('; ');
    return Object.entries(value).map(([goal, reason]) => name(goal) + ': ' + reason).join('; ');
  }

  function mount(lab, ctx, spec) {
    const { h } = ctx, id = spec.id;
    let current = null, stale = false, time = 0, timer = null, policy = id === 'hindsight' ? 'stored' : 'skill';
    const controls = h('div.row'), canvas = h('canvas', { id: id + '-scene', width: 640, height: 340, role: 'img', 'aria-label': spec.sceneLabel });
    canvas.style.cssText = 'display:block;width:100%;height:auto';
    const caption = h('p.small', { id: id + '-frame', 'aria-live': 'polite' });
    const selector = h('select', { id: id + '-policy', 'aria-label': 'Measured replay' }, [h('option', { text: 'Run to load measured methods' })]);
    const status = h('p.small', { id: id + '-stale', role: 'status' });
    const settings = h('select', { id: id + '-setting', 'aria-label': spec.settingLabel });
    spec.choices.forEach(([value, label]) => settings.append(h('option', { value, text: label })));
    if (spec.value != null) settings.value = spec.value;
    const run = h('button.btn', { id: id + '-run', type: 'button', onclick: () => spec.run(settings.value) }, 'Run');
    const watch = h('button.btn.ghost', { id: id + '-watch', type: 'button' }, 'Watch');
    const step = h('button.btn.ghost', { id: id + '-step', type: 'button' }, 'Step');
    const replay = h('button.btn.ghost', { id: id + '-replay', type: 'button' }, 'Replay');
    for (const el of [settings, selector, run, watch, step, replay]) el.style.cssText = 'min-width:44px;min-height:44px;max-width:100%';
    controls.append(run, watch, step, replay);
    const chart = h('div', { id: id + '-chart', 'aria-label': 'Measured event strip' });
    const result = h('div', { id: id + '-result' });
    const evidence = h('details', { id: id + '-evidence' }, [h('summary', { text: 'Measured accounting' })]);
    const scene = h('section.card.stack', { id: id + '-replay-lab' }, [h('h2', { text: spec.sceneTitle }), canvas, caption,
      h('label', null, [spec.settingLabel + ' ', settings]), status, h('label', null, ['Measured replay ', selector]), controls]);
    lab.replaceChildren(scene);
    // Curve survives custom lesson remounts; this view owns its measured surfaces.
    if (ctx.shell) ctx.shell.notebook('curve').replaceChildren(chart, result, evidence);
    else lab.append(chart, result, evidence);
    const events = r => policy === 'stored' ? r.stored : policy === 'prior' ? r.prior : r.events[policy];
    const stop = () => { clearInterval(timer); timer = null; watch.textContent = 'Watch'; };
    function render(el, r, t) {
      if (t === null) return events(r).length;
      const f = r ? frame(r, policy, t) : null;
      const g = el.getContext('2d'), style = getComputedStyle(el), ink = style.getPropertyValue('--ink').trim() || '#202629', surface = style.getPropertyValue('--surface').trim() || '#faf7ef';
      const narrow = el.getBoundingClientRect().width < 480, width = narrow ? 360 : 640;
      if (el.width !== width) el.width = width;
      g.clearRect(0, 0, width, 340); g.fillStyle = surface; g.fillRect(0, 0, width, 340); g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 3; g.font = '20px sans-serif'; g.textAlign = 'center';
      const positions = id === 'hindsight' ? { S: [320, 62], M: [320, 158], W: [150, 270], E: [490, 270] } : Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [i, [58 + i * 104, 150]]).concat([[-1, [370, 265]]]));
      if (narrow) {
        if (id === 'hindsight') Object.values(positions).forEach(p => { p[0] *= 360 / 640; });
        else { [0, 1, 2, 3, 4, 5].forEach(i => { positions[i] = [60 + (i % 3) * 120, i < 3 ? 65 : 220]; }); positions[-1] = [60, 310]; }
      }
      const links = id === 'hindsight' ? [['S', 'M'], ['M', 'W'], ['M', 'E']] : [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
      links.forEach(([a, b]) => { g.beginPath(); g.moveTo(...positions[a]); g.lineTo(...positions[b]); g.stroke(); });
      const pit = id === 'hierarchy' && (r ? r.settings.variant : settings.value) === 'pit';
      for (const [cell, [x, y]] of Object.entries(positions)) {
        if (cell === '-1' && !pit) continue;
        g.fillStyle = surface; g.fillRect(x - 39, y - 26, 78, 52); g.strokeRect(x - 39, y - 26, 78, 52);
        g.fillStyle = ink; g.font = '18px sans-serif';
        const beside = id === 'hindsight' && ['S', 'M'].includes(cell);
        g.fillText(name(cell), beside ? x + 68 : x, beside ? y + 6 : y + 48);
      }
      if (pit) { g.setLineDash([6, 6]); g.beginPath(); g.moveTo(...positions[3]); g.lineTo(...positions[-1]); g.stroke(); g.setLineDash([]); }
      const pos = positions[f?.to ?? (id === 'hindsight' ? 'S' : 0)];
      if (pos) root.BB.scenes.robot(g, pos[0], pos[1] + 20, 43, { noShadow: true });
      const detail = !f ? spec.before : (policy === 'stored' ? 'Stored episode ' + f.episode + '. Commanded ' + name(f.commanded) + '; achieved ' + name(f.achieved) + '. ' : '') +
        ({ stored: 'Stored data', evaluation: 'Greedy check', execution: 'Option execution', training: 'Fresh practice', prior: 'Earlier practice' }[f.phase]) + ': ' + f.kind + '. At ' + name(f.to) + (f.goal != null ? '. Goal ' + name(f.goal) : '') + (f.call ? '. Call ' + f.call : '') +
        (f.action ? '. Action ' + f.action + '; reward ' + f.reward : '') + (f.reason ? '. End: ' + f.reason : '') +
        (f.truncated ? '. Time limit; goal missed' : '') + (id === 'hierarchy' ? '. Counted resets so far ' + f.resets : '') + '.';
      caption.textContent = detail; el.setAttribute('aria-label', spec.sceneLabel + ' ' + detail);
    }
    const adapter = root.BB.sceneAdapter.create({ world: id, settings: [spec.settingLabel], render }); adapter.mount(canvas);
    function draw() {
      if (current) adapter.draw(current, time); else render(canvas, null, 0);
      for (const el of [canvas, chart, result, evidence]) { if (current) el.dataset.run = current.id; else delete el.dataset.run; el.dataset.stale = String(stale); }
      canvas.dataset.world = id; selector.disabled = !current; watch.disabled = step.disabled = replay.disabled = !current || stale;
      status.textContent = stale ? 'Settings changed. Run again to update the measured replay.' : current ? 'Measured run ready.' : 'Scene ready. Predict, then Run.';
      if (current) {
        const strip = events(current).map((e, i) => h('span', { text: (i === time ? '▶ ' : '') + i + ': ' + e.kind + ' ' + name(e.to) + (e.goal != null ? ' → ' + name(e.goal) : '') + '; ' }));
        chart.replaceChildren(h('h3', { text: 'Measured events' }), h('p.small', null, strip));
      }
    }
    selector.onchange = () => { stop(); policy = selector.value; time = 0; draw(); };
    settings.onchange = () => { stop(); stale = !!current; spec.change?.(settings.value); draw(); };
    step.onclick = () => { stop(); time = Math.min(time + 1, events(current).length - 1); draw(); };
    replay.onclick = () => { stop(); time = 0; draw(); };
    watch.onclick = () => {
      if (timer) { stop(); return; }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { status.textContent = 'Reduced motion is on. Use Step to inspect each measured event.'; return; }
      if (time >= events(current).length - 1) time = 0;
      watch.textContent = 'Pause';
      timer = setInterval(() => { if (!scene.isConnected) { stop(); return; } time++; draw(); if (time >= events(current).length - 1) stop(); }, 450);
    };
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', draw);
    const resize = () => draw(); window.addEventListener('resize', resize);
    draw();
    return {
      adapter, cancel: () => { stop(); theme.removeEventListener('change', draw); window.removeEventListener('resize', resize); }, record: () => current,
      replay: () => ({ time, watching: !!timer, stale, world: id, length: current ? events(current).length : 0, policy, setting: settings.value }),
      accept(r, saved) {
        stop(); current = r; stale = saved?.stale || false; time = saved?.time || 0;
        if (saved) { policy = saved.policy; settings.value = saved.setting; }
        const options = [...(r.stored ? [{ name: 'stored', label: 'Stored failed episodes' }] : []), ...(r.prior?.length ? [{ name: 'prior', label: 'Earlier Door practice' }] : []), ...r.policies];
        if (!options.some(p => p.name === policy)) policy = options[0].name;
        selector.replaceChildren(...options.map(p => h('option', { value: p.name, text: p.label }))); selector.value = policy;
        result.replaceChildren(h('h3', { text: 'Results from this run' }), ...r.policies.map(p => h('p.small', { text: p.label + ': ' + spec.metric(r.metrics[p.name]) + '. Terminal: ' + terminalText(r.terminal[p.name]) })));
        evidence.replaceChildren(h('summary', { text: 'Measured accounting' }), h('p.small', { text: spec.accounting(r) }));
        draw();
      },
    };
  }
  const api = { record, frame, mount, labels, name, VERSION };
  root.BB = root.BB || {}; root.BB.goalExecution = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
