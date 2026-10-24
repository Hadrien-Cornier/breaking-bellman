// Lecture 24 option: one goal-conditioned table, called for a given subgoal sequence.
// Does not import the goal-cloning or hindsight modules.
(function (C, H) {
  'use strict';
  if (!C || !H || !H.compare) throw new Error('hierarchy lesson requires CONTENT and BBHIERARCHY');
  if (!C.phases.some((p) => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.hierarchy = 'Two rooms';
  const lesson = {
    id: 'hierarchy', custom: true, phase: 9, world: 'hierarchy', title: 'Call the short skill again', focus: [],
    intro: 'Reach the Prize using a skill trained only to reach the Door. What happens when you ask that same skill to go farther?',
    introMore: 'Six cells sit in a line: Start, Hall, Door, Right hall, Prize, and Far. The Door is two steps from Start. The Prize is two steps past the Door. A table trains only on the Door. A given sequence then calls that same table for the Door and for the Prize.',
    goal: { text: 'Train the low-level table on the Door inside the budget, call it for the given sequence, and match the flat budget to S plus H. Then change the room, the coordinates, or the farther goal and watch the second call miss.' },
  };
  const hindsightAt = C.levels.findIndex((l) => l.id === 'hindsight');
  const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
  const smAt = C.levels.findIndex((l) => l.id === 'supermimic');
  let insertAt = C.levels.length;
  if (hindsightAt >= 0) insertAt = hindsightAt + 1;
  else if (goalsAt >= 0) insertAt = goalsAt + 1;
  else if (smAt >= 0) insertAt = smAt;
  C.levels.splice(insertAt, 0, lesson);

  const NAME = { 0: 'Start', 1: 'Hall', 2: 'Door', 3: 'Right hall', 4: 'Prize', 5: 'Far' };
  const name = (id) => id === H.PIT ? 'Pit' : (NAME[id] || String(id));
  const act = (a) => a === 'L' ? 'left' : a === 'R' ? 'right' : a;
  const css = '#hierarchy-lesson,#hierarchy-rules{max-width:100%;overflow-wrap:anywhere}#hierarchy-lesson .btn,#hierarchy-lesson .opt,#hierarchy-rules .btn{min-height:44px}#hierarchy-lesson .controls{display:flex;flex-wrap:wrap;gap:8px}#hierarchy-lesson .rooms{display:flex;flex-wrap:wrap;gap:6px}#hierarchy-lesson .cell{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:4px 6px;background:var(--surface)}#hierarchy-lesson .cell.on{border-color:var(--accent)}#hierarchy-lesson .tuple{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}#hierarchy-lesson .nums{font-family:var(--font-mono);font-size:.82rem}';
  const state = { pred: null, diag: null, explain: null, ran: false, pick: 'lesson', sawFailure: false };
  let redraw = null;
  const FAIL = { pit: true, absolute: true, far: true, short: true };

  function ensureCss() {
    if (document.getElementById('hierarchy-css')) return;
    const style = document.createElement('style');
    style.id = 'hierarchy-css';
    style.textContent = css;
    document.head.append(style);
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'data-key': o.key, 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { text: (o.correct ? 'Sound chain. ' : 'Not this one. ') + o.why }) : null,
    ]))));
  }

  function moveText(m) {
    const where = m.key.indexOf('@') >= 0 ? 'cell ' + m.key : 'offset ' + m.key;
    const end = m.terminal ? ' Terminal.' : ' Not terminal.';
    return name(m.pos) + ', ' + act(m.action) + ', ' + name(m.next) + '. Reward ' + m.reward + '. ' + where + '.' + end;
  }

  function qLines(q) {
    const keys = Object.keys(q).sort();
    if (!keys.length) return 'No entry has been written. Every unseen value is 0. A tie picks left.';
    return keys.map((k) => {
      const parts = k.split('|');
      const where = parts[0].indexOf('@') >= 0 ? 'cell ' + parts[0] : 'offset ' + parts[0];
      return where + ', ' + act(parts[1]) + ': ' + q[k];
    }).join('. ') + '.';
  }

  function measureText(report) {
    const flat = report.flat;
    const shaped = report.shaped;
    return 'S ' + report.S + ' (moves ' + report.skill.steps + ', resets ' + report.skill.resets + '). H ' + report.H + ' (primitive ' + report.execution.primitive + ', option calls ' + report.execution.calls + '). Flat training ' + flat.interactions + '. Skill Q updates ' + report.skill.updates + '. Flat Q updates ' + flat.updates + '. Execution updates ' + report.execution.updates + '. Extra pretraining ' + report.extra + '. Flat goal entries ' + flat.goalEntries + '. Flat greedy reaches: ' + (flat.greedy.reached ? 'yes' : 'no') + ' in ' + flat.evalSteps + ' check steps. Door-bonus greedy reaches: ' + (shaped.greedy.reached ? 'yes' : 'no') + '. Second call reaches: ' + (report.execution.reachedPrize ? 'yes' : 'no') + '.';
  }

  const PREDICT = {
    id: 'hierarchy-p',
    prompt: 'The table is still all zeros. You call it for the Door, with no training pattern. What does the call do?',
    options: [
      { key: 'wall', result: 'It steps left and stays on Start.', correct: true, why: 'Unseen values are 0. Left and right tie, and the tie picks left. Left on Start stays on Start.' },
      { key: 'pattern', result: 'It steps right, because training will use right, right, left.', correct: false, why: 'The pattern is the behavior that collects training transitions. A call reads the table. The table is empty, so the call does not read the pattern.' },
      { key: 'jump', result: 'It appears on the Door in one step.', correct: false, why: 'A call takes one legal step at a time. Nothing in this lesson moves a cell farther than one step, except the pit, which is a different room.' },
    ],
  };

  function diagnoseQuestion(lessonReport) {
    return {
      id: 'hierarchy-d',
      prompt: 'The second call reaches the Prize. The flat greedy check does not. Which account matches the counts?',
      options: [
        { key: 'reuse', result: 'Offset 2 was learned on the Door. The Prize is that same offset, and the step is the same. The flat behavior did enter the Prize. Its greedy table still ties left at the start. The sequence was given.', correct: true, why: 'Skill updates ' + lessonReport.skill.updates + '. Offset 2 right is ' + lessonReport.skill.q['2|R'] + ' and offset 1 right is ' + lessonReport.skill.q['1|R'] + '. Flat goal entries ' + lessonReport.flat.goalEntries + '. Flat greedy reaches: ' + (lessonReport.flat.greedy.reached ? 'yes' : 'no') + '. High-level updates ' + lessonReport.highLevel.updates + ', source ' + lessonReport.highLevel.source + '.' },
        { key: 'high', result: 'The high level learned to ask for the Door and then the Prize.', correct: false, why: 'High-level updates are ' + lessonReport.highLevel.updates + '. The sequence is marked ' + lessonReport.highLevel.source + '. No high-level parameter was updated.' },
        { key: 'never', result: 'The flat behavior never entered the Prize, so its table had no prize signal.', correct: false, why: 'Flat goal entries are ' + lessonReport.flat.goalEntries + ' inside the ' + lessonReport.flat.interactions + ' training interactions. Entering the Prize and finishing the backup to the start are different.' },
      ],
    };
  }

  function explainQuestion(lessonReport, longReport) {
    return {
      id: 'hierarchy-x',
      prompt: 'What kind of hierarchy did this table just implement?',
      options: [
        { key: 'option', result: 'A low-level goal-conditioned table, termination at the subgoal or the cap, and a given high-level sequence. The pit and the farther goal make the second call miss.', correct: true, why: 'Lesson second call reaches: ' + (lessonReport.execution.reachedPrize ? 'yes' : 'no') + '. At training budget ' + longReport.opts.budget + ' the flat greedy check also reaches: ' + (longReport.flat.greedy.reached ? 'yes' : 'no') + '. That longer budget removes the gap. End-to-end option learning and a learned high level are not in this run.' },
        { key: 'any', result: 'The Door table reaches any later goal, in any room.', correct: false, why: 'Absolute cells, the pit, and Far each miss on the second call. The transfer used a shared offset and the same left and right step.' },
        { key: 'both', result: 'Both levels were learned together from one prize reward.', correct: false, why: 'The low-level reward was the Door, not the Prize. The high-level sequence was written down. Joint end-to-end training is the method the lecture warns can remove the benefit, and it is not this run.' },
      ],
    };
  }

  let view = null, baseline = null, longer = null;
  H.cancel = () => { if (view) view.cancel(); view = null; state.ran = false; baseline = null; longer = null; };
  H.record = () => view?.record() || null;
  H.replay = () => view?.replay() || { time: 0, watching: false, stale: false, world: null, length: 0 };
  H.state = () => ({ world: 'hierarchy', mode: 'campaign', level: lesson.title, knobs: H.record()?.settings || {}, words: {}, idleWords: {}, discovered: [], lastRun: H.record() });
  H.mount = (pane, lab, api) => {
    const retained = view?.record(), playback = view?.replay();
    if (view) view.cancel();
    ensureCss();
    state.pred = api.answer?.('hierarchy-p')?.choice ?? null;
    state.diag = api.answer?.('hierarchy-d')?.choice ?? null;
    state.explain = api.answer?.('hierarchy-x')?.choice ?? null;
    state.sawFailure = (api.step?.() || 0) >= 4;
    let variant = playback?.setting || 'lesson';
    const h = api.h, body = h('div.card.stack.teaching-card', { id: 'hierarchy-lesson' }); pane.append(body);
    const advance = n => api.markStep?.(n);
    const variants = { lesson: {}, pit: { dynamics: 'pit' }, absolute: { representation: 'absolute' }, far: { subgoals: [H.DOOR, H.FAR] }, short: { budget: 4 }, long: { budget: 24 }, extra: { pretrain: 6 } };
    H.run = () => {
      const report = H.compare(variants[variant]);
      const r = BB.goalExecution.record('hierarchy', { variant, ...report.opts }, report);
      view.accept(r); state.ran = true; advance(2);
      if (variant === 'lesson') baseline = report;
      if (variant === 'long') longer = report;
      if (FAIL[variant] && !report.execution.reachedPrize) { state.sawFailure = true; advance(4); }
      redraw(); return r;
    };
    view = BB.goalExecution.mount(lab, api, {
      id: 'hierarchy', sceneTitle: 'Call Door, then Prize', sceneLabel: 'Six cells from Start through Door to Prize and Far.',
      before: 'The robot starts at Start. Train a table to reach Door, then call the same table with the next subgoal. Calls and resets will appear as separate measured events.',
      value: variant, settingLabel: 'Room and training setup', choices: [['lesson', 'Repeated rooms'], ['pit', 'Pit after Door'], ['absolute', 'Absolute cells'], ['far', 'Farther goal'], ['short', 'Budget 4'], ['long', 'Budget 24'], ['extra', '6 earlier interactions']], change: value => { variant = value; redraw(); }, run: H.run,
      metric: m => (m.reached ? 'Final goal reached' : 'Final goal missed') + '; ' + (m.trainingSteps || 0) + ' training moves; ' + (m.resets || 0) + ' resets; ' + m.evaluationSteps + ' execution/check moves; ' + m.calls + ' option calls',
      accounting: r => 'Earlier Door practice: ' + r.data.prior.steps + ' moves and ' + r.data.prior.resets + ' resets. Fresh across all five measured methods: ' + r.data.fresh.steps + ' moves and ' + r.data.fresh.resets + ' resets, with ' + r.data.optionCalls + ' option calls counted separately. S = ' + r.report.S + ' training interactions. H = ' + r.report.H + ' primitive moves plus calls. Each flat table receives S + H = ' + r.report.total + ' training interactions. Greedy check moves are additional evaluation, not training. No high-level updates.',
    });
    (api.shell?.notebook('rule') || lab).append(h('section', { id: 'hierarchy-rules' }, [h('h3', { text: 'Two-room rules' }),
      h('p', { text: 'The low-level policy is a table choosing left or right for a requested goal. An option calls that policy until the subgoal, pit or eight-step cap. The high-level sequence is given: Door, then Prize. Only the low-level table learns.' }),
      h('p', { text: 'Training uses right, right, left repeatedly. Unseen values are 0 and ties pick left. Reward is 1 on reaching the subgoal. A reset is an interaction. Relative coordinates use goal minus position, which lets the second room reuse the first room’s table. Absolute coordinates keep each cell and goal separate.' })]));
    redraw = () => {
      if (!body.isConnected) return;
      const r = H.record(), report = r?.report, stale = H.replay().stale;
      const diagnosis = baseline ? diagnoseQuestion(baseline) : null;
      const explanation = baseline && longer ? explainQuestion(baseline, longer) : null;
      const kids = [h('h2', { text: lesson.title }), h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })]), h('p.small', null, [h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener', text: 'Idea adapted from Berkeley CS 285' })])];
      if (!report) kids.push(h('p', { text: 'Door skill learns the short goal, then follows the given sequence. Flat learner trains directly on the final goal; Flat learner with Door bonus also gets reward for entering Door. Empty table has never learned. Wiped table has its learned entries deleted before the same calls.' }), h('h3', { text: '1. Predict' }), choice(h, PREDICT, state.pred, i => { state.pred = i; api.recordAnswer?.(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }), h('p', { text: 'Use Run above, then Watch the training resets and each Door and Prize call. Select Flat learner to compare its own training and greedy check.' }));
      else if (stale) kids.push(h('p', { text: 'The setup changed. Run again to measure it.' }));
      else if ((state.diag == null || (api.step?.() || 0) < 3) && diagnosis && r.settings.variant === 'lesson') kids.push(h('h3', { text: '3. Diagnose' }), choice(h, diagnosis, state.diag, i => { state.diag = i; api.recordAnswer?.(diagnosis.id, i, !!diagnosis.options[i].correct); redraw(); }), h('button.btn', { id: 'hierarchy-continue', type: 'button', disabled: state.diag == null, onclick: () => { advance(3); redraw(); } }, 'Continue'));
      else {
        kids.push(h('h3', { text: '4. Change and explain' }), h('p', { text: 'Run Repeated rooms, then change to a pit, absolute cells, Far, or Budget 4 and rerun. Inspect the second call’s actual stop reason. Finally run Budget 24 to check whether longer flat training closes the gap.' }));
        if (explanation) kids.push(h('p.small', { text: 'Explain the Repeated rooms and Budget 24 runs you measured in this visit.' }), choice(h, explanation, state.explain, i => { state.explain = i; api.recordAnswer?.(explanation.id, i, !!explanation.options[i].correct); redraw(); }), h('button.btn', { id: 'hierarchy-complete', type: 'button', disabled: !(state.sawFailure && state.explain != null && explanation.options[state.explain].correct), onclick: () => { advance(5); api.complete?.(); redraw(); } }, api.done?.() ? 'Lesson complete' : 'Record this measurement'));
      }
      if (api.shell) kids.push(api.shell.conceptSketch({ label: 'A given sequence calls the same learned table twice', nodes: [{ id: 'sequence', label: 'Given sequence', x: 65, y: 60 }, { id: 'door', label: 'Call Door', x: 225, y: 25 }, { id: 'prize', label: 'Call Prize', x: 225, y: 95 }], edges: [{ from: 'sequence', to: 'door' }, { from: 'door', to: 'prize', label: 'same table' }] }));
      if (api.done?.() && api.next?.()) kids.push(h('button.btn', { type: 'button', onclick: api.openNext }, 'Next level: ' + api.next().title));
      body.replaceChildren(...kids);
      if (api.shell) {
        api.shell.notebook('notes').replaceChildren(h('p', { text: lesson.intro }), h('details', null, [h('summary', { text: 'Rules and method' }), h('p', { text: lesson.introMore })]), h('p', { text: PREDICT.prompt }));
        api.shell.notebook('autopsy').replaceChildren(...(report ? [h('p.small', { text: measureText(report) }), h('p.small', { text: qLines(report.skill.q) }), ...report.execution.options.map((op, i) => h('p.small', { text: 'Call ' + (i + 1) + ', goal ' + name(op.goal) + ': ' + op.moves.map(moveText).join(' ') }))] : [h('p', { text: 'Run to inspect the table and option calls.' })]));
      }
    };
    if (retained) view.accept(retained, playback);
    redraw();
  };
})(window.CONTENT, window.BBHIERARCHY);
