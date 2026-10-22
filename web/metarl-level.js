// Lecture 24 meta-RL, as a count. The two-door world lives here. No import from goals, hindsight, or history.
(function (C, M) {
  'use strict';
  if (!C || !M) throw new Error('metarl lesson requires CONTENT and BBMETARL');
  if (!C.phases.some((p) => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
  C.worldNames.metarl = 'Probe doors';
  const lesson = {
    id: 'metarl', custom: true, phase: 9, world: 'metarl', title: 'The second episode reads the first', focus: [],
    intro: 'Two doors. One of them pays, and the paying door is the task. A new task has a new id. Each task is two episodes. The first episode always opens the left door. That probe is given. Training counts the reward of the second episode under the first episode\'s record. A later task reads that count.',
    goal: { text: 'On two new task ids, one for each door, make the second episode follow the training count for the first episode\'s record. A deleted count must leave that second action unchosen.' },
  };
  const hindsightAt = C.levels.findIndex((l) => l.id === 'hindsight');
  const sm = C.levels.findIndex((l) => l.id === 'supermimic');
  let insertAt = C.levels.length;
  if (hindsightAt >= 0) insertAt = hindsightAt + 1;
  else if (sm >= 0) insertAt = sm;
  C.levels.splice(insertAt, 0, lesson);

  const DOOR = { L: 'left', R: 'right' };
  const state = {
    pred: null, diag: null, explain: null, base: null, tasks: null, records: null,
    pack: null, mode: '', edited: false, contingency: 'original',
  };
  let redraw = null;
  const css = '#metarl-lesson,#metarl-rules{max-width:100%;overflow-wrap:anywhere}#metarl-lesson .btn,#metarl-lesson .opt,#metarl-rules .btn{min-height:44px;max-width:100%;white-space:normal}#metarl-lesson .rec{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}#metarl-lesson .doors{width:100%;height:auto;display:block}#metarl-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#metarl-lesson .scroll{overflow:auto;max-width:100%}';

  function ensureCss() {
    if (document.getElementById('metarl-css')) return;
    const style = document.createElement('style');
    style.id = 'metarl-css';
    style.textContent = css;
    document.head.append(style);
  }

  function door(action) { return action ? DOOR[action] || action : 'unchosen'; }

  function frac(rate) {
    if (!rate) return 'unknown';
    if (rate.alpha === 0) return rate.s + '/' + rate.n;
    return '(' + rate.s + '+' + rate.alpha + ')/(' + rate.n + '+' + (2 * rate.alpha) + ')';
  }

  function ratio(box) {
    if (!box) return 'no scored second action';
    return box.successes + ' of ' + box.tasks;
  }

  function historyLabel(history) {
    if (history === '*') return 'pooled episodes, no first-episode record';
    if (history === 'L:1') return 'left door, reward 1';
    if (history === 'L:0') return 'left door, reward 0';
    if (history === 'R:1') return 'right door, reward 1';
    if (history === 'R:0') return 'right door, reward 0';
    return history;
  }

  function doors() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 150');
    svg.setAttribute('class', 'doors');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Two doors. The left door is the given first probe. The right door is the other action.');
    const el = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (text) node.textContent = text;
      svg.append(node);
    };
    el('rect', { x: 36, y: 24, width: 100, height: 100, rx: 8, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 3 });
    el('rect', { x: 184, y: 24, width: 100, height: 100, rx: 8, fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 3 });
    el('circle', { cx: 118, cy: 74, r: 5, fill: 'var(--ink)' });
    el('circle', { cx: 202, cy: 74, r: 5, fill: 'var(--accent)' });
    el('text', { x: 86, y: 146, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 14 }, 'Left');
    el('text', { x: 234, y: 146, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 14 }, 'Right');
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
    id: 'metarl-p',
    prompt: 'Training pays the left door on more tasks than the right door. On a new task the first episode opens the left door and the reward is 0. What does a count that ignores that first episode do on the second episode?',
    options: [
      { key: 'adapt', result: 'It opens the right door, because the probe reward was 0.', correct: false, why: 'That response needs the first-episode record. A pooled count has thrown that record away.' },
      { key: 'majority', result: 'It opens the left door, the door with more episode-2 successes in the pooled count.', correct: true, why: 'The memoryless count keeps the majority training door on every new task. The failed probe is not an input.' },
      { key: 'id', result: 'It looks up the new task id and copies the door stored under that id.', correct: false, why: 'The new id has no training row. An id table cannot answer it.' },
    ],
  };

  function diagnoseQuestion(pack) {
    const failed = pack.heldHistory.rows.find((row) => row.history === 'L:0');
    const action = failed ? door(failed.choice.action) : 'unchosen';
    return {
      id: 'metarl-d',
      prompt: 'hold-L and hold-R are absent from the training ids. On hold-R the second episode opens the ' + action + ' door. What did that choice read?',
      options: [
        { key: 'hidden', result: 'The hidden paying door.', correct: false, why: 'The hidden door is used to pay the reward. It is not an input to the count.' },
        { key: 'count', result: 'The success count for the record "left door, reward 0". The task id is not an input.', correct: true, why: 'hold-R\'s first episode is that record. The mode of the training count for it is the ' + action + ' door. The id table has no hold-R row.' },
        { key: 'net', result: 'A recurrent state trained by a meta-gradient.', correct: false, why: 'This page fits a count. A recurrent network and a meta-gradient are still open.' },
      ],
    };
  }

  function explainQuestion(pack) {
    const hist = ratio(pack.heldHistory.expectation);
    const mem = ratio(pack.heldMemory.expectation);
    const deleted = pack.heldDeleted.rows[0].choice.reason;
    const updates = pack.trainingUpdates;
    const interactions = pack.trainingInteractions;
    return {
      id: 'metarl-x',
      prompt: 'Which account matches the count you just fitted?',
      options: [
        { key: 'copy', result: 'Try-both is the same learning rule, because it also scores on the new tasks.', correct: false, why: 'Try-both reads the held-out rewards and ignores the count. After the counts are deleted its choice is unchanged. The fitted second action becomes ' + deleted + '.' },
        { key: 'fit', result: 'The history-conditioned count scores ' + hist + '. The memoryless count on the same rewards scores ' + mem + '. Deleted counts leave the second action ' + deleted + '.', correct: true, why: interactions + ' training interactions, ' + updates + ' episode-2 updates, and ' + pack.heldoutUpdates + ' held-out updates. A recurrent network, a meta-gradient, and learned exploration are not in this count. Two episodes are the horizon of this toy.' },
        { key: 'always', result: 'Two episodes are enough for every meta-RL problem, and hold-R is already in the id table.', correct: false, why: 'hold-R is absent from the id table. The lecture\'s recurrent learner and a learned probe are open. This toy does not say that two episodes suffice in general.' },
      ],
    };
  }

  function recordLine(h, rec, live) {
    const agree = M.reward(rec.pay, rec.ep2.action) === rec.ep2.reward;
    const note = agree ? 'This reward is the door the environment paid.' : 'This stored reward was edited. The hidden door did not move.';
    const kids = [
      h('p', { text: rec.id + '. Hidden door, scoring only: ' + door(rec.pay) + '. First episode: ' + door(rec.ep1.action) + ', reward ' + rec.ep1.reward + '. Second episode: ' + door(rec.ep2.action) + ', reward ' + rec.ep2.reward + '.' }),
      h('p.small', { text: note }),
    ];
    if (live) {
      const next = rec.ep2.reward === 1 ? 0 : 1;
      kids.push(h('button.btn.ghost', {
        type: 'button', id: 'metarl-reward-' + rec.id,
        onclick: () => {
          state.records = M.withReward(state.records, rec.id, next);
          state.edited = true;
          state.pack = M.study(state.records, M.heldList());
          redraw();
        },
      }, 'Store reward ' + next + ' for this second episode'));
    }
    return h('div.rec', { id: 'metarl-rec-' + rec.id }, kids);
  }

  function countBlock(h, pack) {
    const rows = M.snapshot(pack.history, ['L:1', 'L:0']);
    return h('div.stack', { id: 'metarl-counts' }, rows.map((row) => h('p.nums', {
      text: historyLabel(row.history) + '. Left ' + frac(row.actions[0].rate) + ' (n ' + row.actions[0].n + '). Right ' + frac(row.actions[1].rate) + ' (n ' + row.actions[1].n + '). Second action: ' + door(row.decision.action) + ' (' + row.decision.reason + ').',
    })));
  }

  function heldBlock(h, title, evaluation) {
    return h('div.stack', null, [
      h('h4', { text: title }),
      h('div.stack', null, evaluation.rows.map((row) => h('p.small', {
        text: row.id + '. First episode: ' + door(row.ep1.action) + ', reward ' + row.ep1.reward + '. Record: ' + historyLabel(row.history) + '. Second action: ' + door(row.choice.action) + ' (' + row.choice.reason + '). Reward: ' + (row.ep2 ? row.ep2.reward : 'none') + '.',
      }))),
      h('p.nums', { text: 'Second-episode score ' + ratio(evaluation.expectation) + '. Held-out updates ' + evaluation.updates + '. Observations ' + evaluation.observations + '. Decisions ' + evaluation.decisions + '.' }),
    ]);
  }

  function recomputeOriginal() {
    state.tasks = M.taskList();
    state.records = M.executeTasks(state.tasks);
    state.pack = M.study(state.records, M.heldList());
    state.edited = false;
    state.contingency = 'original';
  }

  function matchesOriginal(records) {
    if (!records) return false;
    const fresh = M.executeTasks(M.taskList());
    if (fresh.length !== records.length) return false;
    for (let i = 0; i < fresh.length; i++) {
      if (fresh[i].id !== records[i].id) return false;
      if (fresh[i].history !== records[i].history) return false;
      if (fresh[i].ep2.action !== records[i].ep2.action) return false;
      if (fresh[i].ep2.reward !== records[i].ep2.reward) return false;
    }
    return true;
  }

  function livePass(pack) {
    return !!(pack && pack.heldHistory.expectation && pack.heldHistory.expectation.successes === pack.heldHistory.expectation.tasks && pack.heldHistory.expectation.tasks === M.heldList().length);
  }

  M.cancel = () => {};
  M.state = () => ({
    world: 'metarl',
    sentenceName: 'Tabular cross-task adaptation',
    mode: 'campaign',
    level: lesson.title,
    knobs: { probe: M.PROBE, alpha: M.ALPHA, episodes: 2 },
    words: {},
    idleWords: {},
    discovered: [],
    lastRun: state.pack ? {
      seeds: 1,
      steps: state.pack.trainingInteractions,
      symptoms: [],
      summary: {
        history: state.pack.heldHistory.expectation,
        memoryless: state.pack.heldMemory.expectation,
        updates: state.pack.trainingUpdates,
      },
    } : null,
  });
  M.run = () => {
    recomputeOriginal();
    state.base = { study: state.pack, records: state.records, tasks: state.tasks };
    if (redraw) redraw();
    return state.pack;
  };

  M.mount = (pane, lab, api) => {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('metarl-p'); const d0 = saved('metarl-d'); const x0 = saved('metarl-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step = api.step ? api.step() : 0;
    if (step >= 2 && !state.pack) {
      recomputeOriginal();
      state.base = { study: state.pack, records: M.cloneRecords(state.records), tasks: state.tasks };
    }
    if (step >= 4 && state.pack && livePass(state.pack)) state.mode = state.mode || 'history';
    const h = api.h;
    const body = h('div.card.stack', { id: 'metarl-lesson' });
    pane.append(body);

    function advance(n) { if (api.markStep) api.markStep(n); }

    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'metarl') + 1;
      const pack = state.pack;
      const base = state.base ? state.base.study : null;
      const diagnose = base ? diagnoseQuestion(base) : null;
      const explain = base ? explainQuestion(base) : null;
      const onOriginal = matchesOriginal(state.records);
      const repairOk = state.mode === 'history' && onOriginal && livePass(pack);
      const explainOk = !!(explain && state.explain != null && explain.options[state.explain].correct && repairOk);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Probe doors' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        doors(),
        h('p.small', { text: 'Lecture 24 headings: "The meta reinforcement learning problem", "Meta-RL with recurrent policies", and "Why recurrent policies learn to explore". This page is a tabular count for that problem. It is not the recurrent learner on those slides.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 24 slides'),
        ]),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if ((api.step ? api.step() : 0) >= 1 || state.pred != null) {
        kids.push(
          h('h3', { text: '2. Run' }),
          h('p', { text: 'Execute the six training tasks. Episode 1 opens the left door. That probe is given. Episode 2 follows a fixed list, left, left, right, right, right, left. That list is data collection. The count stores the reward each of those actions actually received. Then score two new ids, hold-L and hold-R, without adding their rewards to the count.' }),
          h('button.btn', { id: 'metarl-run', type: 'button', onclick: () => { M.run(); advance(2); redraw(); } }, 'Execute the training episodes'),
        );
        if (pack && base) {
          kids.push(h('h4', { text: 'Training records' }));
          kids.push(h('div.stack', { id: 'metarl-training' }, state.records.map((rec) => recordLine(h, rec, false))));
          kids.push(h('p.nums', { id: 'metarl-accounting', text: 'Training interactions ' + pack.trainingInteractions + '. Episode-2 updates ' + pack.trainingUpdates + '. Held-out observations ' + pack.heldoutObservations + '. Held-out updates ' + pack.heldoutUpdates + '. Alpha ' + pack.alpha + '. Counts start at zero.' }));
          kids.push(h('h4', { text: 'Fitted count' }));
          kids.push(countBlock(h, pack));
          kids.push(heldBlock(h, 'New tasks, history-conditioned count', pack.heldHistory));
          kids.push(heldBlock(h, 'Same rewards, memoryless count', pack.heldMemory));
          kids.push(h('p.small', { text: 'A uniform draw over both doors on these two new tasks scores ' + pack.uniform.successes + ' of ' + pack.uniform.trials + '. That average is the no-training baseline. It is not a statement that every draw fails.' }));
        }
      }
      if (base && diagnose && ((api.step ? api.step() : 0) >= 2 || state.base)) {
        kids.push(h('h3', { text: '3. Diagnose' }), choice(h, diagnose, state.diag, (i) => {
          state.diag = i; if (api.recordAnswer) api.recordAnswer(diagnose.id, i, !!diagnose.options[i].correct); advance(3); redraw();
        }));
      }
      if (base && state.diag != null && pack) {
        const unsupported = pack.unsupported;
        kids.push(
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Choose a decision rule. The history-conditioned count, the memoryless count, and the deleted count all read the same training records. Try-both ignores those records and opens both doors on the new task. Changing the training evidence refits the count.' }),
          h('div.row', { id: 'metarl-modes' }, [
            ['history', 'History-conditioned count'],
            ['memoryless', 'Memoryless count'],
            ['deleted', 'Delete the counts'],
            ['copy', 'Try both, copy the winner'],
          ].map(([id, label]) => h('button.btn' + (state.mode === id ? '' : '.ghost'), {
            type: 'button', id: 'metarl-apply-' + id, 'aria-pressed': state.mode === id ? 'true' : 'false',
            onclick: () => {
              state.mode = id;
              if (id === 'history' && matchesOriginal(state.records) && livePass(state.pack)) advance(4);
              redraw();
            },
          }, label))),
          h('div.row', null, [
            h('button.btn.ghost', { id: 'metarl-contingency', type: 'button', onclick: () => {
              state.tasks = M.retargetLeft(M.taskList());
              state.records = M.executeTasks(state.tasks);
              state.pack = M.study(state.records, M.heldList());
              state.edited = false;
              state.contingency = 'left';
              redraw();
            } }, 'Re-execute with every training task paying on the left'),
            h('button.btn.ghost', { id: 'metarl-restore', type: 'button', onclick: () => { recomputeOriginal(); redraw(); } }, 'Re-execute the original training tasks'),
          ]),
          h('p.small', { text: 'Evidence now: ' + (state.edited ? 'a stored reward was edited' : state.contingency === 'left' ? 'every training task pays on the left, re-executed' : 'original executed rewards') + '.' }),
          countBlock(h, pack),
          heldBlock(h, 'Live history-conditioned score', pack.heldHistory),
          heldBlock(h, 'Live memoryless score', pack.heldMemory),
          heldBlock(h, 'Live deleted-count score', pack.heldDeleted),
          h('p.small', { id: 'metarl-copy', text: 'Try-both queries ' + pack.copy.queries + ' held-out rewards and reads the count: ' + (pack.copy.readsCounts ? 'yes' : 'no') + '. Its score is ' + pack.copy.successes + ' of ' + pack.copy.tasks + '. Deleting the counts does not change that rule.' }),
          h('p.small', { id: 'metarl-unsupported', text: 'Unseen record "' + historyLabel('R:1') + '": second action ' + door(unsupported.action) + ' (' + unsupported.reason + '). The training probe never opened the right door first.' }),
          h('p.small', { id: 'metarl-none', text: 'If nothing pays, the same count still selects ' + door(pack.none.rows[0].choice.action) + ' after a failed left probe, and the reward is ' + (pack.none.rows[0].ep2 ? pack.none.rows[0].ep2.reward : 'none') + '. That task id is ' + pack.none.rows[0].id + '. Its reward was not added to the training count.' }),
          h('h4', { text: 'Edit one stored reward' }),
          h('div.stack', { id: 'metarl-editor' }, state.records.map((rec) => recordLine(h, rec, true))),
        );
      }
      if (repairOk && explain) {
        kids.push(
          h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', {
            id: 'metarl-complete', type: 'button', disabled: !explainOk,
            onclick: () => { if (explainOk && api.complete) api.complete(); redraw(); },
          }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [
            h('summary', { text: 'Toy assumptions' }),
            h('p.small', { text: 'The learned object is the table of episode-2 success counts. Initialization is zero. Alpha is 0, so a cell with no executions is unknown, and equal rates are a tie. The tie does not prefer a door. The left-door probe is given. The training schedule of second actions is given. Hidden doors are used only by the reward. Training ids and held-out ids are disjoint, and the count does not read an id. A uniform draw on the two new tasks scores 2 of 4. Two episodes are this toy\'s horizon. A recurrent network, a meta-gradient, and learned exploration remain open. This page does not say that two episodes suffice in general.' }),
          ]),
        );
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'metarl-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };

    const rules = h('section.card.game-rules', { id: 'metarl-rules' }, [
      h('h3', { text: 'Game rules · Probe doors' }),
      h('dl', null, [
        row(h, 'Goal', 'On a new task, open the door the training count prefers for the first episode\'s record.'),
        row(h, 'Reward each step', '1 when the opened door is the hidden paying door, otherwise 0. A task where nothing pays returns 0 for both doors.'),
        row(h, 'Equation', 'The estimated success of a second action is its success sum divided by its count. The action is the unique maximum. Alpha is 0.'),
        row(h, 'Episode ends', 'One door, then the episode ends. The next episode starts over. A new task drops the previous task\'s record.'),
        row(h, 'Score', 'Second-episode rewards on hold-L and hold-R, counted together. Held-out rewards are not written into the training count.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]);
    lab.replaceChildren(rules, h('section.card', null, [
      h('h3', { text: 'The two doors' }),
      doors(),
      h('p.small', { text: 'The first episode opens the left door. That choice is given. The second episode is the action the count selects.' }),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBMETARL);
