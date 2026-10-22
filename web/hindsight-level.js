// Lecture 24 relabeling only. The grid and the Q table live in this file. Goal cloning is not imported.
(function (C, H) {
  'use strict';
  C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.hindsight = 'Fork of goals';
  const lesson = {
    id: 'hindsight', custom: true, phase: 9, world: 'hindsight', title: 'A miss is a hit for another goal', focus: [],
    intro: 'Four cells, and a goal called Far that the agent never reaches. One episode stops at West. The other stops at East. The same four steps can teach West and East if the reward is recomputed for the cell where the episode actually ended.',
    goal: { text: 'Solve West and East from the same four steps by recomputing the reward for the final cell, and leave Far unsolved.' },
  };
  const sm = C.levels.findIndex((l) => l.id === 'supermimic');
  const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
  let insertAt = sm >= 0 ? sm : C.levels.length;
  if (goalsAt > insertAt) insertAt = goalsAt + 1;
  C.levels.splice(insertAt, 0, lesson);

  const NAME = { S: 'Start', M: 'Mid', W: 'West', E: 'East', F: 'Far', stay: 'stay', go: 'go', L: 'left', R: 'right' };
  const state = { pred: null, diag: null, explain: null, report: null, mode: '', applied: null };
  let redraw = null;
  const css = '#hindsight-lesson,#hindsight-rules{max-width:100%;overflow-wrap:anywhere}#hindsight-lesson .btn,#hindsight-lesson .opt,#hindsight-rules .btn{min-height:44px}#hindsight-lesson .tuple{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}#hindsight-lesson .fork{width:100%;height:auto;display:block}#hindsight-lesson .nums{font-family:var(--font-mono);font-size:.82rem}';

  function ensureCss() {
    if (document.getElementById('hindsight-css')) return;
    const style = document.createElement('style');
    style.id = 'hindsight-css';
    style.textContent = css;
    document.head.append(style);
  }

  function tupleText(tr) {
    const end = tr.terminated ? 'Terminal.' : 'Not terminal.';
    const cut = tr.truncated ? 'Truncated by the time limit.' : 'Not truncated.';
    return NAME[tr.s] + ' , ' + NAME[tr.a] + ' , ' + NAME[tr.sp] + '. Goal ' + NAME[tr.g] + '. Reward ' + tr.reward + '. ' + end + ' ' + cut;
  }

  function fork() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 210');
    svg.setAttribute('class', 'fork');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Start leads to Mid. Left from Mid ends at West. Right from Mid ends at East. Far is not a cell.');
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(svg.namespaceURI, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text) e.textContent = text;
      svg.append(e);
    };
    el('line', { x1: 160, y1: 48, x2: 160, y2: 92, stroke: 'var(--accent)', 'stroke-width': 4 });
    el('line', { x1: 160, y1: 128, x2: 70, y2: 168, stroke: 'var(--good)', 'stroke-width': 4 });
    el('line', { x1: 160, y1: 128, x2: 250, y2: 168, stroke: 'var(--warn)', 'stroke-width': 4 });
    [['S', 160, 36], ['M', 160, 112], ['W', 70, 184], ['E', 250, 184]].forEach(([id, x, y]) => {
      el('circle', { cx: x, cy: y, r: 16, fill: 'var(--surface)', stroke: 'var(--ink)' });
      el('text', { x: x, y: y + 4, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 12 }, NAME[id]);
    });
    return svg;
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'data-key': o.key, 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { html: (o.correct ? '<b>Sound chain.</b> ' : '<b>Not this one.</b> ') + o.why }) : null,
    ]))));
  }

  const PREDICT = {
    id: 'hindsight-p',
    prompt: 'Both episodes are stored under the goal Far. What does that table know about West, before any goal is rewritten?',
    options: [
      { key: 'filled', result: 'West fills in, because the agent stood on West.', correct: false, why: 'Standing on West is not the stored goal. The reward function still sees Far, and Far was missed, so the reward stays -1.' },
      { key: 'empty', result: 'Nothing that favors West. Every stored reward is the miss for Far.', correct: true, why: 'The four rewards are -1. West and East are not inputs yet, so their action values stay at the initial -2.' },
      { key: 'copy', result: 'The table copies the path that ended on West and calls it the policy.', correct: false, why: 'The path is training data. The learned action is the strict best entry in the Q table after an update. No update has run.' },
    ],
  };
  const DIAGNOSE = {
    id: 'hindsight-d',
    prompt: 'The last step of the West episode is stored with goal Far. Which flags match that tuple?',
    options: [
      { key: 'done', result: 'Reward 0 and terminal, because the episode ended.', correct: false, why: 'The time limit is truncation. Far was not the next cell, so the reward stays -1 and the transition is not terminal.' },
      { key: 'truncated', result: 'Reward -1, not terminal, truncated.', correct: true, why: 'The next cell is West, the commanded goal is Far, and the horizon stopped the episode. A later backup may still continue from West.' },
      { key: 'plus', result: 'Reward +1 for West, because that is where it stopped.', correct: false, why: 'The reward is recomputed only when the goal argument changes. This tuple still says Far. The binary reward is 0 or -1, not +1.' },
    ],
  };

  function explainQuestion(report) {
    const hin = report.modes.hindsight;
    const once = report.modes.once;
    const orig = report.modes.original;
    return {
      id: 'hindsight-x',
      prompt: 'Which account matches the table you just updated?',
      options: [
        { key: 'equal', result: 'Hindsight used the same compute and solved Far as well.', correct: false, why: 'Far is still unsolved (' + (hin.far ? 'solved' : 'not solved') + '). Hindsight used ' + hin.updates + ' Q updates. The original replay used ' + orig.updates + '. The environment steps stayed ' + report.envSteps + '.' },
        { key: 'compute', result: 'Same ' + report.envSteps + ' steps, more Q updates. Sweep 2 is what moves Start. Far stays unsolved.', correct: true, why: 'Original: ' + orig.updates + ' updates, ' + orig.heldout + ' of 2 held-out goals. One hindsight sweep: the West action at Mid is ' + once.Q['M|L|W'] + ' and held-out success is ' + once.heldout + ' of 2, because Start is still ' + once.Q['S|go|W'] + '. Two sweeps: ' + hin.updates + ' updates, Start is ' + hin.Q['S|go|W'] + ', held-out success is ' + hin.heldout + ' of 2. Far is not solved.' },
        { key: 'once', result: 'Filling Mid on sweep 1 is enough to leave Start.', correct: false, why: 'After one sweep the West value at Mid is ' + once.Q['M|L|W'] + ', and Start is still ' + once.Q['S|go|W'] + '. The rollout ties at Start and does not move. Sweep 2 writes ' + hin.Q['S|go|W'] + ' into Start, which is -1 plus discount times the Mid value.' },
      ],
    };
  }

  function measure(h, pack) {
    if (!pack) return h('p.small', { text: 'No table yet.' });
    const s = pack.success;
    return h('div.stack', null, [
      h('p.nums', { id: 'hindsight-measure', text: 'Q updates ' + pack.updates + '. Sweeps ' + pack.sweeps + '. Goal is an input: ' + (pack.conditionOnGoal ? 'yes' : 'no') + '. Held-out goals solved: ' + pack.heldout + ' of 2. Far solved: ' + (s.F ? 'yes' : 'no') + '.' }),
      h('p.small', { text: 'West from Start: value ' + fmt(pack.Q['S|go|W']) + ', action ' + (pack.policy.S.W ? NAME[pack.policy.S.W] : 'tie') + ', then at Mid ' + (pack.policy.M.W ? NAME[pack.policy.M.W] : 'tie') + '. Path ' + pack.rolls.W.path.map((id) => NAME[id]).join(' to ') + '.' }),
      h('p.small', { text: 'East from Start: value ' + fmt(pack.Q['S|go|E']) + ', action ' + (pack.policy.S.E ? NAME[pack.policy.S.E] : 'tie') + ', then at Mid ' + (pack.policy.M.E ? NAME[pack.policy.M.E] : 'tie') + '. Path ' + pack.rolls.E.path.map((id) => NAME[id]).join(' to ') + '.' }),
    ]);
  }
  function fmt(v) { return v == null ? 'initial -2' : String(v); }

  H.cancel = () => {};
  H.state = () => ({
    world: 'hindsight', sentenceName: 'Tabular goal-conditioned Q, final-state relabel', mode: 'campaign', level: lesson.title,
    knobs: { gamma: H.GAMMA, alpha: H.ALPHA, init: H.INIT, sweeps: 2 }, words: {}, idleWords: {}, discovered: [],
    lastRun: state.report ? { seeds: 1, steps: state.report.envSteps, symptoms: [], summary: { heldout: state.applied ? state.applied.heldout : null, updates: state.applied ? state.applied.updates : null } } : null,
  });
  H.run = () => { state.report = H.compare(); if (redraw) redraw(); return state.report; };

  H.mount = (pane, lab, api) => {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('hindsight-p'); const d0 = saved('hindsight-d'); const x0 = saved('hindsight-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step = api.step ? api.step() : 0;
    if (step >= 2) state.report = state.report || H.compare();
    if (step >= 4) { state.mode = 'hindsight'; state.applied = state.report.modes.hindsight; }
    const h = api.h;
    const body = h('div.card.stack', { id: 'hindsight-lesson' });
    pane.append(body);
    function advance(n) { if (api.markStep) api.markStep(n); }
    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'hindsight') + 1;
      const report = state.report;
      const explain = report ? explainQuestion(report) : null;
      const repairOk = !!(state.applied && state.mode === 'hindsight' && state.applied.heldout === 2 && state.applied.far === false && report && state.applied.updates > report.modes.original.updates);
      const explainOk = !!(explain && state.explain != null && explain.options[state.explain].correct && repairOk);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Fork of goals' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        fork(),
        h('p.small', { text: 'Lecture 24, slide "Relabeling goals": "trajectories that fail for the goal that was commanded still succeed for some other goal!" This lesson is that slide. It is not lecture 23, and it does not train skills to be different.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 24 slides'),
          ' · ',
          h('a', { href: 'https://arxiv.org/abs/1707.01495', target: '_blank', rel: 'noopener' }, 'Andrychowicz et al., 2017, Hindsight Experience Replay'),
        ]),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if ((api.step ? api.step() : 0) >= 1 || state.pred != null) {
        kids.push(h('h3', { text: '2. Run' }),
          h('p', { text: 'Build the four stored tuples, then the four rewritten ones. The behavior always aimed at Far. Rewriting uses the final cell of that episode and recomputes the reward. Nothing is updated yet.' }),
          h('button.btn', { id: 'hindsight-run', type: 'button', onclick: () => { state.report = H.compare(); advance(2); redraw(); } }, 'Build the eight tuples'));
        if (report) {
          kids.push(h('h4', { text: 'Original, goal Far' }), h('div.stack', { id: 'hindsight-original' }, report.original.map((tr) => h('div.tuple', { text: tupleText(tr) }))));
          kids.push(h('h4', { text: 'Relabeled, final cell, reward recomputed' }), h('div.stack', { id: 'hindsight-rewritten' }, report.rewritten.map((tr) => h('div.tuple', { text: tupleText(tr) }))));
          kids.push(h('p.small', { text: 'Environment steps in both lists: ' + report.envSteps + '. The second list is extra replay, not extra interaction.' }));
        }
      }
      if (report && ((api.step ? api.step() : 0) >= 2 || state.report)) {
        kids.push(h('h3', { text: '3. Diagnose' }),
          choice(h, DIAGNOSE, state.diag, (i) => { state.diag = i; if (api.recordAnswer) api.recordAnswer(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct); advance(3); redraw(); }));
      }
      if (report && state.diag != null) {
        kids.push(h('h3', { text: '4. Repair' }),
          h('p', { text: 'Pick a replay rule and update the table. Watch held-out success, whether Far is solved, and how many Q updates ran. The environment steps do not change.' }),
          h('div.row', { id: 'hindsight-repairs' }, [
            ['original', 'Original goals only'],
            ['stale', 'New goal, old reward'],
            ['blind', 'Recompute, no goal input'],
            ['once', 'Recompute, one sweep'],
            ['hindsight', 'Recompute, two sweeps'],
          ].map(([id, label]) => h('button.btn' + (state.mode === id ? '' : '.ghost'), {
            type: 'button', id: 'hindsight-apply-' + id, 'aria-pressed': state.mode === id ? 'true' : 'false',
            onclick: () => { state.mode = id; state.applied = report.modes[id]; if (id === 'hindsight' && report.modes[id].heldout === 2 && report.modes[id].far === false) advance(4); redraw(); },
          }, label))),
          state.applied ? measure(h, state.applied) : h('p.small', { text: 'Apply a rule to see the updated values and the rollouts.' }));
      }
      if (repairOk && explain) {
        kids.push(h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', { id: 'hindsight-complete', type: 'button', disabled: !explainOk, onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); } }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [h('summary', { text: 'Toy assumptions' }),
            h('p.small', { text: 'Discount 0.5, step size 1, initial value -2 (fail forever). Reward 0 if the next cell is the goal, otherwise -1. That binary reward is the one in Andrychowicz et al. 2017, section 4.1. The added goal is the final cell of the episode, the simplest strategy in section 3.3, named final in section 4.5. Actions were chosen for Far, so the update is off-policy: it does not require the behavior to have aimed at West or East. A tie is not an action. This is not DDPG, not a robot arm, and not a claim about the paper\'s Fetch success rates. Successor features, hierarchy, and meta-RL are later in the same lecture and are not in this table.' })]));
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'hindsight-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };
    const rules = h('section.card.game-rules', { id: 'hindsight-rules' }, [
      h('h3', { text: 'Game rules · Fork of goals' }),
      h('dl', null, [
        row(h, 'Goal', 'Reach the cell you are asked for. Training only asked for Far.'),
        row(h, 'Reward each step', '0 if the next cell is the goal, otherwise -1.'),
        row(h, 'Equation', 'Q(s, a, g) replaces itself with reward plus discount times the best next value, and the next value is 0 when the goal transition is terminal.'),
        row(h, 'Episode ends', 'Terminal when the next cell is the goal. Truncated at 2 steps when it is not.'),
        row(h, 'Score', 'Held-out success on West and East after the Q update. Far is reported separately.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]);
    lab.replaceChildren(rules, h('section.card', null, [h('h3', { text: 'The fork' }), fork(), h('p.small', { text: 'Start, Mid, West, and East are cells. Far is a goal name with no cell, so these episodes cannot achieve it.' })]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBHINDSIGHT);
