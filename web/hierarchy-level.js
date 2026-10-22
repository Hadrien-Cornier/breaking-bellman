// Lecture 24 option: one goal-conditioned table, called for a given subgoal sequence.
// Does not import the goal-cloning or hindsight modules.
(function (C, H) {
  'use strict';
  if (!C || !H || !H.compare) throw new Error('hierarchy lesson requires CONTENT and BBHIERARCHY');
  if (!C.phases.some((p) => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.hierarchy = 'Two rooms';
  const lesson = {
    id: 'hierarchy', custom: true, phase: 9, world: 'hierarchy', title: 'Call the short skill again', focus: [],
    intro: 'Six cells sit in a line: Start, Hall, Door, Right hall, Prize, and Far. The Door is two steps from Start. The Prize is two steps past the Door. A table trains only on the Door. A given sequence then calls that same table for the Door and for the Prize.',
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
  const cache = {};
  let redraw = null;
  const FAIL = { pit: true, absolute: true, far: true, short: true };

  function ensureCss() {
    if (document.getElementById('hierarchy-css')) return;
    const style = document.createElement('style');
    style.id = 'hierarchy-css';
    style.textContent = css;
    document.head.append(style);
  }

  function cached(over) {
    const key = JSON.stringify(over || {});
    if (!cache[key]) cache[key] = H.compare(over || {});
    return cache[key];
  }

  function pickReport() {
    if (state.pick === 'pit') return cached({ dynamics: 'pit' });
    if (state.pick === 'absolute') return cached({ representation: 'absolute' });
    if (state.pick === 'far') return cached({ subgoals: [H.DOOR, H.FAR] });
    if (state.pick === 'short') return cached({ budget: 4 });
    if (state.pick === 'long') return cached({ budget: 24 });
    if (state.pick === 'extra') return cached({ pretrain: 6 });
    return cached({});
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

  function pathCells(report) {
    const cells = [0];
    report.execution.moves.forEach((m) => { if (m.next >= 0) cells.push(m.next); });
    return cells;
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

  H.cancel = () => {};
  H.state = () => ({
    world: 'hierarchy', sentenceName: 'Goal-conditioned table called as an option', mode: 'campaign', level: lesson.title,
    knobs: { gamma: H.GAMMA, alpha: H.ALPHA, init: H.INIT, budget: H.BUDGET }, words: {}, idleWords: {}, discovered: [],
    lastRun: state.ran ? { seeds: 1, steps: cached({}).total, symptoms: [], summary: measureText(cached({})) } : null,
  });
  H.run = () => {
    state.ran = true;
    state.pick = 'lesson';
    const report = cached({});
    if (redraw) redraw();
    return report;
  };

  H.mount = (pane, lab, api) => {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('hierarchy-p');
    const d0 = saved('hierarchy-d');
    const x0 = saved('hierarchy-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step0 = api.step ? api.step() : 0;
    if (step0 >= 2) state.ran = true;
    if (step0 >= 4) { state.sawFailure = true; if (state.pick === 'lesson') state.pick = 'pit'; }
    const h = api.h;
    const body = h('div.card.stack', { id: 'hierarchy-lesson' });
    pane.append(body);
    function advance(n) { if (api.markStep) api.markStep(n); }
    function choosePick(id) {
      state.pick = id;
      const report = pickReport();
      if (FAIL[id] && !report.execution.reachedPrize) { state.sawFailure = true; advance(4); }
      redraw();
    }
    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'hierarchy') + 1;
      const lessonReport = state.ran ? cached({}) : null;
      const report = state.ran ? pickReport() : null;
      const longReport = state.ran ? cached({ budget: 24 }) : null;
      const diagnose = lessonReport ? diagnoseQuestion(lessonReport) : null;
      const explain = lessonReport && longReport ? explainQuestion(lessonReport, longReport) : null;
      const explainOk = !!(explain && state.explain != null && explain.options[state.explain].correct && state.sawFailure);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Two rooms' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('p', { text: 'Actions are left and right. A wall stays put. Unseen table values are 0, and a tie picks left. Training actions come from the pattern right, right, left. That pattern does not read the table. Discount ' + H.GAMMA + ', step size ' + H.ALPHA + ', one update per move. The high-level sequence is given.' }),
        h('p.small', { text: 'Lecture 24. The slide "A classical perspective on hierarchy" names an initiation set, a termination set, and an option policy. The slide "Hierarchical RL with multi-task policies" says "options are a multi-task policy". The slide "Hierarchies with goals" says "This works really well if we have a good goal-conditioned policy!" This lesson is a finite version of that picture. The high-level goals here are written down, not proposed by a learned high level.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 24 slides'),
          ' · ',
          h('a', { href: 'https://arxiv.org/abs/1609.05140', target: '_blank', rel: 'noopener' }, 'Bacon, Harb, and Precup, The Option-Critic Architecture'),
          ' · ',
          h('a', { href: 'https://arxiv.org/abs/1805.08296', target: '_blank', rel: 'noopener' }, 'Nachum, Gu, Lee, and Levine, Data-Efficient Hierarchical Reinforcement Learning'),
        ]),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if (state.pred != null) {
        kids.push(
          h('h3', { text: '2. Run' }),
          h('p', { text: 'Train on the Door for ' + H.BUDGET + ' interactions, counting resets. Then call the table for the Door and for the Prize. Each call is primitive steps, and each call itself counts in H. The flat learner trains for S plus H on the Prize only, from its own empty table.' }),
          h('button.btn', { id: 'hierarchy-run', type: 'button', onclick: () => { state.ran = true; state.pick = 'lesson'; advance(2); redraw(); } }, 'Train on the Door and call the sequence'),
        );
      }
      if (lessonReport && report) {
        const cells = pathCells(report);
        kids.push(
          h('div.rooms', { id: 'hierarchy-map', role: 'img', 'aria-label': 'Cells from Start to Far' }, [0, 1, 2, 3, 4, 5].map((i) => h('div.cell' + (cells.indexOf(i) >= 0 ? '.on' : ''), { id: 'hierarchy-cell-' + i }, name(i)))),
          h('p.nums', { id: 'hierarchy-measure', text: measureText(report) }),
          h('p.small', { id: 'hierarchy-lesson-counts', text: 'Lesson comparison, repeated rooms, relative offsets, budget ' + H.BUDGET + ', extra 0: ' + measureText(lessonReport) }),
          h('p.small', { id: 'hierarchy-active', text: 'Showing ' + state.pick + '. Dynamics ' + report.dynamics + '. Representation ' + report.representation + '. Second subgoal ' + name(report.opts.subgoals[1]) + '. Training budget ' + report.opts.budget + '. Extra ' + report.extra + '.' }),
          h('h4', { text: 'Initial table' }),
          h('p.small', { id: 'hierarchy-init', text: 'Every unseen value is 0. A call before any update steps left.' }),
          h('h4', { text: 'Door training, in order' }),
          h('div.stack', { id: 'hierarchy-skill-log' }, report.skill.log.map((ev) => h('div.tuple', { text: ev.kind === 'reset' ? 'Reset from ' + name(ev.from) + ' to ' + name(ev.to) + '. This reset counts in S.' : moveText(ev) }))),
          h('h4', { text: 'Table after those updates' }),
          h('p.small', { id: 'hierarchy-q', text: qLines(report.skill.q) }),
          h('h4', { text: 'Calls, primitive steps only' }),
          h('div.stack', { id: 'hierarchy-exec' }, report.execution.options.map((op, i) => h('div.tuple', { text: 'Call ' + (i + 1) + ' at primitive ' + op.atPrimitive + '. Given goal ' + name(op.goal) + '. ' + (op.moves.length ? op.moves.map(moveText).join(' ') : 'No step.') + ' Ends at ' + name(op.final) + '. ' + (op.terminated ? 'Terminated on the subgoal.' : op.fell ? 'Ended in the pit.' : 'Stopped at the cap.') }))),
          h('p.small', { id: 'hierarchy-flat', text: 'Flat training uses ' + report.flat.interactions + ' interactions and does not receive the Door transitions. Goal entries: ' + report.flat.goalEntries + '. Greedy check from Start: ' + (report.flat.greedy.reached ? 'reaches ' + name(report.flat.goal) : 'misses') + ' in ' + report.flat.evalSteps + ' steps. Those check steps are not added to the flat budget.' }),
          h('p.small', { id: 'hierarchy-shaped', text: 'Same flat budget with an added reward of 1 for entering the Door. Goal entries: ' + report.shaped.goalEntries + '. Greedy check: ' + (report.shaped.greedy.reached ? 'reaches' : 'misses') + ' in ' + report.shaped.evalSteps + ' steps. The two flat tables are ' + (JSON.stringify(report.flat.q) === JSON.stringify(report.shaped.q) ? 'the same' : 'different') + '.' }),
          h('p.small', { id: 'hierarchy-none', text: 'Initial table, same calls: first action ' + act(report.none.moves[0].action) + ', second call reaches: ' + (report.none.reachedPrize ? 'yes' : 'no') + '. After deleting every learned entry, first action ' + act(report.wiped.moves[0].action) + ', second call reaches: ' + (report.wiped.reachedPrize ? 'yes' : 'no') + '.' }),
        );
        kids.push(h('h3', { text: '3. Diagnose' }), choice(h, diagnose, state.diag, (i) => {
          state.diag = i;
          if (api.recordAnswer) api.recordAnswer(diagnose.id, i, !!diagnose.options[i].correct);
          advance(3);
          redraw();
        }));
      }
      if (lessonReport && state.diag != null) {
        kids.push(
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Change a real property and read the line again. The pit, absolute cells, Far, and the short budget each make the second call miss. The longer budget is the case where the plain flat greedy check also reaches. Extra pretraining is labeled and is not the comparison above.' }),
          h('div.controls', { id: 'hierarchy-controls' }, [
            ['lesson', 'Repeated rooms'],
            ['pit', 'Pit after the Door'],
            ['absolute', 'Absolute cells'],
            ['far', 'Farther goal'],
            ['short', 'Budget 4'],
            ['long', 'Budget 24'],
            ['extra', '6 extra interactions'],
          ].map(([id, label]) => h('button.btn' + (state.pick === id ? '' : '.ghost'), {
            type: 'button', id: 'hierarchy-pick-' + id, 'aria-pressed': state.pick === id ? 'true' : 'false',
            onclick: () => choosePick(id),
          }, label))),
        );
      }
      if (state.sawFailure && explain) {
        kids.push(
          h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', { id: 'hierarchy-complete', type: 'button', disabled: !explainOk, onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); } }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [
            h('summary', { text: 'What this run is, and what it is not' }),
            h('p.small', { text: 'The low-level state is the offset, goal minus cell, unless you switch to absolute cells. Both rooms use the same deterministic step unless you switch on the pit. Right from Right hall then goes to the pit, a transition the Door training never took. The behavior pattern is hand-specified and spends two of every three steps going right. It is not a stored Prize path: the Door log includes a left and a reset. Calls do not read the pattern.' }),
            h('p.small', { text: 'S counts training moves and resets. H counts primitive call steps and one option call per given subgoal. The flat learner gets S plus H and starts empty. Its greedy check, the initial-table call, and the deleted-table call are extra simulations. Their step counts are on the measure line and are not given to the flat learner. A loaded run with 6 earlier interactions keeps those 6 out of S and labels them extra. That row is not the pass comparison.' }),
            h('p.small', { text: 'The slide "Why is this a bad idea?" says "Where do these come from? Learning options end-to-end together with the policy might negate much of the benefit!" and cites Bacon et al., The Option-Critic Architecture. This run does not learn termination or the high level. Termination is the subgoal, the pit, or 8 steps. Nachum et al. learn a high level that proposes goals and add an off-policy correction. Those pieces stay open, along with continuous actions and a claim that one budget holds for every pattern.' }),
          ]),
        );
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'hierarchy-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };
    lab.replaceChildren(h('section.card.game-rules', { id: 'hierarchy-rules' }, [
      h('h3', { text: 'Game rules · Two rooms' }),
      h('dl', null, [
        row(h, 'Goal', 'Train a table that reaches the Door, then call it for the given Prize.'),
        row(h, 'Reward each step', '1 if the next cell is the commanded goal, otherwise 0. The flat ablation also adds 1 for entering the Door.'),
        row(h, 'Equation', 'Q(offset, action) becomes reward plus discount times the best next value. The next value is 0 when the transition is terminal.'),
        row(h, 'Episode ends', 'Training resets at the goal, the pit, or 8 steps. A call ends at the subgoal, the pit, or 8 steps.'),
        row(h, 'Score', '1 if the second call ends on its goal. Flat goal entries and the flat greedy check are reported beside that score.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBHIERARCHY);
