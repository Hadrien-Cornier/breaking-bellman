// Lecture 24 relabeling only. The grid and the Q table live in this file. Goal cloning is not imported.
(function (C, H) {
  'use strict';
  if (!C.phases.some(p => p.n === 9)) C.phases.push({ n: 9, title: 'Multi-task goals' });
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
  const state = { pred: null, diag: null, explain: null, report: null };
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

  let view = null;
  H.cancel = () => { if (view) view.cancel(); view = null; state.report = null; };
  H.record = () => view?.record() || null;
  H.replay = () => view?.replay() || { time: 0, watching: false, stale: false, world: null, length: 0 };
  H.state = () => ({ world: 'hindsight', mode: 'campaign', level: lesson.title, knobs: H.record()?.settings || {}, words: {}, idleWords: {}, discovered: [], lastRun: H.record() });
  H.mount = (pane, lab, api) => {
    const retained = view?.record(), playback = view?.replay();
    if (view) view.cancel();
    ensureCss();
    state.pred = api.answer?.('hindsight-p')?.choice ?? null;
    state.diag = api.answer?.('hindsight-d')?.choice ?? null;
    state.explain = api.answer?.('hindsight-x')?.choice ?? null;
    const h = api.h, body = h('div.card.stack', { id: 'hindsight-lesson' }); pane.append(body);
    let sweeps = playback?.setting || '2';
    const advance = n => api.markStep?.(n);
    H.run = () => {
      state.report = H.compare({ sweeps: Number(sweeps) });
      const record = BB.goalExecution.record('hindsight', { sweeps: Number(sweeps) }, state.report);
      view.accept(record); advance(2); redraw(); return record;
    };
    view = BB.goalExecution.mount(lab, api, {
      id: 'hindsight', sceneTitle: 'Replay a missed goal', sceneLabel: 'Start connects to Mid, then West or East. Far has no cell.',
      before: 'The stored actions aimed at Far. Far has no reachable cell. Run to replay the recorded failures and the learned goal requests.',
      value: sweeps, settingLabel: 'Replay sweeps', choices: [['2', 'Two sweeps'], ['1', 'One sweep']], change: value => { sweeps = value; redraw(); }, run: H.run,
      metric: m => m.solved + ' of 2 held-out goals solved; Far ' + (m.far ? 'solved' : 'unsolved') + '; ' + m.updates + ' Q updates; ' + m.evaluationSteps + ' check steps',
      accounting: r => 'Earlier data: ' + r.data.prior.steps + ' stored steps in ' + r.data.prior.attempts + ' episodes, shared by all methods. No fresh training interactions. Evaluation: ' + r.data.fresh.steps + ' actual moves in ' + r.data.fresh.attempts + ' goal checks across the five methods. Rewriting a goal adds Q updates, not environment steps.',
    });
    const rules = h('section', { id: 'hindsight-rules' }, [h('h3', { text: 'Fork rules' }),
      h('p', { text: 'A policy chooses an action from the current cell and requested goal. Its Q table scores those actions. Reward is 0 when the next cell is the requested goal, otherwise -1. A reached goal terminates; two unsuccessful moves reach the time limit. A tied greedy choice stops without taking a step.' }),
      h('p', { text: 'Discount 0.5, update size 1, initial value -2. Original goals only replays Far. New goal, old reward leaves rewards wrong. Recompute, no goal input merges West and East. Recompute, one sweep stops before the values reach Start. The selected-sweeps method recomputes rewards and keeps the goal input.' })]);
    (api.shell?.notebook('rule') || lab).append(rules);
    redraw = () => {
      if (!body.isConnected) return;
      const r = H.record(), report = r?.report, stale = H.replay().stale;
      const explain = report ? explainQuestion(report) : null;
      const step = api.step?.() || 0;
      const children = [h('h2', { text: lesson.title }), h('p', { text: lesson.intro }), h('p.small', null, [h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-24.pdf', target: '_blank', rel: 'noopener', text: 'Idea adapted from Berkeley CS 285' })])];
      if (!report) {
        children.push(h('p', { text: 'Original goals only keeps Far. New goal, old reward changes the label alone. Recompute, no goal input removes the goal from the table. The two remaining methods recompute rewards and keep the goal input, using one sweep or the selected sweep count.' }), h('h3', { text: '1. Predict' }), choice(h, PREDICT, state.pred, i => { state.pred = i; api.recordAnswer?.(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
          h('p', { text: 'Use Run above to build the tuples and compare all five replay rules. Then select Stored failed episodes or a named method and use Watch or Step.' }));
      } else if (stale) children.push(h('p', { text: 'The sweep count changed. Run again before interpreting the values.' }));
      else if (state.diag == null || step < 3) {
        children.push(h('h3', { text: '3. Diagnose' }), choice(h, DIAGNOSE, state.diag, i => { state.diag = i; api.recordAnswer?.(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct); advance(3); redraw(); }));
      } else {
        children.push(h('h3', { text: '4. Change and explain' }), h('p', { text: 'Compare one and two sweeps with the setting above. Select each named method to replay its actual greedy checks for West, East and Far. A stopped tie takes no action. Two sweeps carry the reached-goal values back to Start.' }),
          r.settings.sweeps === 2 ? choice(h, explain, state.explain, i => { state.explain = i; api.recordAnswer?.(explain.id, i, !!explain.options[i].correct); redraw(); }) : h('p', { text: 'Run Two sweeps to see values reach Start, then explain that result.' }),
          h('button.btn', { id: 'hindsight-complete', type: 'button', disabled: !(r.settings.sweeps === 2 && state.explain != null && explain.options[state.explain].correct), onclick: () => { advance(5); api.complete?.(); redraw(); } }, api.done?.() ? 'Lesson complete' : 'Record this measurement'));
      }
      if (api.shell) children.push(api.shell.conceptSketch({ label: 'The same transition can answer a different goal', nodes: [{ id: 'miss', label: 'Missed Far', x: 65, y: 35 }, { id: 'goal', label: 'Achieved West', x: 240, y: 35 }, { id: 'reward', label: 'Recompute reward', x: 240, y: 95 }], edges: [{ from: 'miss', to: 'goal', label: 'relabel' }, { from: 'goal', to: 'reward' }] }));
      if (api.done?.() && api.next?.()) children.push(h('button.btn', { type: 'button', onclick: api.openNext }, 'Next level: ' + api.next().title));
      body.replaceChildren(...children);
      if (api.shell) {
        api.shell.notebook('notes').replaceChildren(h('p', { text: lesson.intro }), h('p', { text: 'Prediction: ' + PREDICT.prompt }), h('p', { text: 'Diagnosis: ' + DIAGNOSE.prompt }));
        api.shell.notebook('autopsy').replaceChildren(...(report ? [h('h3', { text: 'Stored and relabeled transitions' }), ...report.original.map(tr => h('p.small', { text: tupleText(tr) })), ...report.rewritten.map(tr => h('p.small', { text: tupleText(tr) }))] : [h('p', { text: 'Run to inspect the measured transitions.' })]));
      }
    };
    if (retained) view.accept(retained, playback);
    redraw();
  };
})(window.CONTENT, window.BBHINDSIGHT);
