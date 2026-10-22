// Early imitation lesson: a lookup clone leaves the demonstration, then one DAgger round labels visited states.
(function (C, Lane) {
  'use strict';
  if (!Lane || typeof Lane.rollout !== 'function') throw new Error('shift lesson requires BBSHIFT');
  if (!C.phases.some((phase) => phase.n === 0)) C.phases.unshift({ n: 0, title: 'Imitation before reward' });
  C.worldNames.lane = 'A narrow lane';
  C.levels.unshift({
    id: 'shift', custom: true, phase: 0, world: 'lane', title: 'Stay in the lane', focus: [],
    intro: 'A driver is recorded only at the center. Behavior cloning copies those actions. On a state the recording never visited, the copy holds. One slip leaves the recording. You then ask the expert for labels on the states the copy actually visits.',
    goal: { text: 'Show the clone holding off the demonstration, then bring the same slip back to center with one expert label on a visited state.' },
  });
  C.paperLinks = C.paperLinks || {};
  C.cards.dagger = {
    name: 'DAgger', short: 'DAgger', status: 'unchecked',
    paper: 'Ross, Gordon, and Bagnell, AISTATS 2011. CS 285 Spring 2026 lecture 2, page 35, titles the slide DAgger: Dataset Aggregation and names Ross et al. 2011. The author names and the AISTATS line are the arXiv record 1011.0686, not a sentence from the paper. No sentence from the paper is quoted here.',
    fixes: 'Distributional shift: the cloned lookup visits a state the demonstration never covered, and it holds there. DAgger appends an expert label on each lane state that rollout visited, then refits the same lookup.',
    stillWrong: 'This lane labels only visited lane states. Position -1 stays unlabeled, so the lookup still holds there. The lecture also lists very powerful models, smarter data collection and augmentation, and multi-task learning. This lane does not contain those.',
    evidence: '<p>Checked against the lecture slides fetched for this lesson, not against a paper sentence. Page 35 is titled DAgger: Dataset Aggregation and names Ross et al. 2011. Page 31 names the paper title A Reduction of Imitation Learning and Structured Prediction to No-Regret Online Learning. Page 39 says behavioral cloning is not guaranteed to work because the i.i.d. assumption does not hold, and lists DAgger, very powerful models, smarter data collection and augmentation, and multi-task learning. The arXiv record 1011.0686 lists Stephane Ross, Geoffrey J. Gordon, and J. Andrew Bagnell, and its comment says the paper appears at AISTATS 2011. No sentence from the paper is quoted here.</p>',
  };
  C.paperLinks.dagger = [
    { t: 'CS 285 Spring 2026 lecture 2', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-2.pdf' },
    { t: 'arXiv:1011.0686', u: 'https://arxiv.org/abs/1011.0686' },
  ];

  const view = {
    prediction: '', center: null, before: null, diagnosis: '', asked: null, after: null, explanation: '',
  };
  const pos = (n) => (n > 0 ? '+' + n : String(n));
  const list = (xs) => xs.map(pos).join(', ');
  const show = (...nodes) => nodes.filter((node) => node != null && node !== false);
  function scheduleText(script) {
    return 'start ' + pos(script.start) + ', ' + script.horizon + ' steps, extra shoves ' + script.slips.join(', ');
  }

  Lane.state = () => ({
    world: 'lane',
    sentenceName: 'Lookup clone, then one DAgger round',
    mode: 'campaign',
    level: 'Stay in the lane',
    knobs: {
      schedule: Lane.PLAYER_SCHEDULE.id,
      start: Lane.PLAYER_SCHEDULE.start,
      horizon: Lane.PLAYER_SCHEDULE.horizon,
      slips: Lane.PLAYER_SCHEDULE.slips.slice(),
    },
    words: {}, idleWords: {}, discovered: [],
    lastRun: view.before ? {
      seeds: 1,
      steps: view.before.actions.length,
      symptoms: [],
      summary: { before: view.before.positions, after: view.after ? view.after.positions : null },
    } : null,
  });
  Lane.cancel = () => {};
  // A plain run never asks the expert and never drops the start at +1.
  Lane.run = () => {
    const demo = Lane.demonstrate();
    return Lane.rollout(Lane.clone(demo.pairs), Lane.PLAYER_SCHEDULE);
  };

  let redraw = null;
  let revealed = false;
  Lane.mount = (pane, lab, { h, complete, done, reveal, openNext }) => {
    const lesson = C.levels.find((level) => level.id === 'shift');
    const demo = Lane.demonstrate();
    const body = h('div.card.stack', { id: 'shift-lesson' });
    pane.append(body);
    const choose = (name, options, picked, onPick) => h('div.mc', { id: 'shift-' + name }, options.map((option) => h(
      'button.opt' + (picked === option.id ? '.picked' : '') + (picked === option.id ? (option.ok ? '.right' : '.wrong') : ''),
      {
        type: 'button', id: 'shift-' + name + '-' + option.id,
        'aria-pressed': picked === option.id ? 'true' : 'false',
        onclick: () => onPick(option.id),
      },
      [h('span', { text: option.text }), picked === option.id ? h('span.why', { role: 'status', text: option.why }) : null],
    )));
    function laneSvg(trace, label) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 360 132');
      svg.setAttribute('role', 'img');
      svg.setAttribute('id', 'shift-lane');
      svg.setAttribute('aria-label', label);
      const element = (tag, attrs, text) => {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const key in attrs) node.setAttribute(key, attrs[key]);
        if (text != null) node.textContent = text;
        svg.append(node);
      };
      [-2, -1, 0, 1, 2].forEach((cell, index) => {
        const x = 16 + index * 68;
        const ditch = cell === -2 || cell === 2;
        element('rect', {
          x, y: 36, width: 60, height: 56, rx: 8,
          fill: 'var(--surface)',
          stroke: cell === 0 ? 'var(--accent)' : ditch ? 'var(--bad)' : 'var(--line)',
          'stroke-width': 2,
        });
        element('text', { x: x + 30, y: 70, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 18 }, pos(cell));
        element('text', { x: x + 30, y: 112, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, ditch ? 'ditch' : cell === 0 ? 'demo' : 'open');
      });
      if (trace && trace.positions.length) {
        const point = (cell) => {
          const index = [-2, -1, 0, 1, 2].indexOf(cell);
          return (16 + index * 68 + 30) + ',' + 64;
        };
        element('polyline', {
          points: trace.positions.map(point).join(' '),
          fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4, 'stroke-linecap': 'round',
        });
        const end = point(trace.positions[trace.positions.length - 1]).split(',');
        element('circle', { cx: end[0], cy: end[1], r: 7, fill: 'var(--accent)' });
      }
      return svg;
    }
    redraw = () => {
      if (!body.isConnected) return;
      // A redraw replaces every control. Keep keyboard focus on the control with the same id.
      const focusId = body.contains(document.activeElement) ? document.activeElement.id : '';
      const n = C.levels.findIndex((level) => level.id === 'shift') + 1;
      const repairOk = view.before && view.after
        && Lane.sameSchedule(view.before, Lane.PLAYER_SCHEDULE)
        && Lane.sameSchedule(view.after, Lane.PLAYER_SCHEDULE)
        && view.before.positions.join(',') === Lane.OUTCOME.beforePositions.join(',')
        && view.after.positions.join(',') === Lane.OUTCOME.afterPositions.join(',');
      const runsReady = view.center && view.before;
      body.replaceChildren(...show(
        h('div.eyebrow', { text: 'Level ' + n + ' · A narrow lane' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('h3', { text: '1. Watch the demonstration' }),
        h('p', { text: 'Four recorded pairs, all from a start at 0, all following the expert. The count is ' + demo.counts['0'] + ' at 0, and 0 everywhere else. Support is {' + demo.support.map(pos).join(', ') + '}.' }),
        h('div.row', { id: 'shift-histogram', role: 'img', 'aria-label': 'Demonstration counts. Only position 0 is above zero.' },
          [-2, -1, 0, 1, 2].map((cell) => h('span.chip', { text: pos(cell) + ': ' + (demo.counts[String(cell)] || 0) }))),
        h('p', { text: 'Lookup rule, on screen and in the clone: if the state is in the data, play the recorded action. If it is not, play 0 (hold). The expert is not asked during a plain run.' }),
        h('p.small', { text: 'Expert rule: -1 when the position is positive, +1 when it is negative, and 0 at the center. Next position = current + action + that step\'s extra shove, then clamped to -2 through +2. Positions -2 and +2 are the ditch and end the rollout.' }),
        h('h3', { text: '2. Predict' }),
        h('p', { text: 'The slip-start schedule starts at +1 and then adds no extra shove for 4 steps. What does the clone do?' }),
        choose('predict', [
          { id: 'return', ok: false, text: 'It copied a perfect driver, so from +1 it steers back to 0.', why: 'The recording has no action at +1. Copying the driver does not invent a recovery the data never showed.' },
          { id: 'hold', ok: true, text: 'The data has no action at +1, so the clone holds and stays at +1 for 4 steps.', why: 'The lookup plays 0 on an unseen state. This schedule adds no extra shove, so +1 stays +1.' },
          { id: 'ditch', ok: false, text: 'With no label at +1, the clone drives itself into the ditch at +2.', why: 'Hold is action 0. It does not shove the car toward +2. The ditch needs another +1, and this schedule\'s extra shoves are 0, 0, 0, 0.' },
        ], view.prediction, (id) => { view.prediction = id; redraw(); }),
        h('h3', { text: '3. Run' }),
        h('p', { text: 'Both buttons use a fixed schedule. Center starts at 0. Slip-start starts at +1. Neither button asks the expert, and neither changes the shoves.' }),
        h('div.row', null, [
          h('button.btn', { id: 'shift-run-center', type: 'button', disabled: !view.prediction, onclick: () => { view.center = Lane.rollout(Lane.clone(demo.pairs), Lane.CENTER_SCHEDULE); redraw(); } }, 'Run from the center'),
          h('button.btn', { id: 'shift-run-slip', type: 'button', disabled: !view.prediction, onclick: () => { view.before = Lane.rollout(Lane.clone(demo.pairs), Lane.PLAYER_SCHEDULE); redraw(); } }, 'Run the slip-start schedule'),
        ]),
        view.center ? h('p', { id: 'shift-center', role: 'status', text: 'Center schedule (' + scheduleText(Lane.CENTER_SCHEDULE) + '). Positions: ' + list(view.center.positions) + '. Same schedule object: ' + (Lane.sameSchedule(view.center, Lane.CENTER_SCHEDULE) ? 'yes' : 'no') + '.' }) : null,
        view.before ? h('p', { id: 'shift-before', role: 'status', text: 'Slip-start (' + scheduleText(Lane.PLAYER_SCHEDULE) + '). Positions: ' + list(view.before.positions) + '. Actions: ' + list(view.before.actions) + '. Visited lane states: ' + (view.before.visitedLane.map(pos).join(', ') || 'none') + '. Same schedule object: ' + (Lane.sameSchedule(view.before, Lane.PLAYER_SCHEDULE) ? 'yes' : 'no') + '.' }) : null,
        h('h3', { text: '4. Diagnose' }),
        runsReady ? choose('diagnose', [
          { id: 'copied', ok: false, text: 'The expert\'s recovery was copied at +1, and it points away from the center.', why: 'The only recorded state is 0. The action at +1 was not copied from the expert. It is the hold used for unseen states.' },
          { id: 'unseen', ok: true, text: 'Position +1 was never in the demonstration, so the clone has no recovery there and holds.', why: 'The test state was produced by the slip, not drawn from the demonstration. The i.i.d. assumption of supervised learning does not hold for that state.' },
          { id: 'removed', ok: false, text: 'The slip was removed, so the car never left 0.', why: 'The slip-start schedule still starts at +1. The positions above are the ones the clone actually visited.' },
        ], view.diagnosis, (id) => { view.diagnosis = id; redraw(); }) : h('p.small', { text: 'Run both schedules to compare a start inside the demonstration with a start outside it.' }),
        h('h3', { text: '5. Repair' }),
        h('p', { text: 'Ask the expert for the action at each lane state this slip-start rollout visited. Append those pairs and refit the same lookup. Do not ask about states the rollout did not visit, and do not change the schedule.' }),
        h('button.btn', {
          id: 'shift-ask', type: 'button', disabled: view.diagnosis !== 'unseen' || !view.before,
          onclick: () => {
            view.asked = Lane.aggregate(demo.pairs, view.before);
            view.after = null;
            if (!revealed && reveal) { revealed = true; reveal('dagger'); }
            redraw();
          },
        }, 'Ask the expert on the states you visit, and add them'),
        view.asked ? h('div.stack', { id: 'shift-asked' }, [
          h('p', { role: 'status', text: 'Expert queried on visited lane states: ' + (view.asked.added.map((pair) => pos(pair.state) + ' -> ' + pos(pair.action)).join(', ') || 'none') + '. Appended pairs: ' + view.asked.added.length + '. Support is now {' + view.asked.support.map(pos).join(', ') + '}.' }),
          h('p', { text: 'Position -1 was not visited, so the expert was not asked. The lookup there still returns ' + pos(view.asked.policy(Lane.OUTCOME.unlabeledState)) + ', the hold. The slip-start shoves are still ' + Lane.PLAYER_SCHEDULE.slips.join(', ') + '.' }),
          h('button.btn', { id: 'shift-run-again', type: 'button', onclick: () => { view.after = Lane.rollout(view.asked.policy, Lane.PLAYER_SCHEDULE); redraw(); } }, 'Run the same slip-start schedule'),
        ]) : h('p.small', { text: 'The ask button waits until the diagnosis says the missing state is the cause.' }),
        view.after ? h('p', { id: 'shift-after', role: 'status', text: 'Same schedule (' + scheduleText(Lane.PLAYER_SCHEDULE) + '). This run\'s shoves: ' + view.after.slips.join(', ') + '. Positions: ' + list(view.after.positions) + '. Actions: ' + list(view.after.actions) + '. Schedule unchanged: ' + (Lane.sameSchedule(view.after, Lane.PLAYER_SCHEDULE) ? 'yes' : 'no') + '. Returned to 0 and stayed there: ' + (repairOk ? 'yes' : 'no') + '.' }) : null,
        h('h3', { text: '6. Explain' }),
        view.after ? choose('explain', [
          { id: 'everywhere', ok: false, text: 'DAgger labels every lane state, including ones the learner never visited.', why: 'This round appended a label only for a visited lane state. Position -1 is still unlabeled, and the lookup still holds there.' },
          { id: 'dagger', ok: true, text: 'The learner produced the test state, so the i.i.d. assumption failed. DAgger (dataset aggregation) adds expert labels on visited states. The lecture also lists powerful models, smarter data collection and augmentation, and multi-task learning, which this lane does not contain.', why: 'The dataset changed by one pair, (+1, -1). The start is still +1, and the extra shoves are still 0, 0, 0, 0. The new label is what lets the same schedule return to 0.' },
          { id: 'erased', ok: false, text: 'The second run worked because the repair removed the slip.', why: 'The second run uses the same slip-start schedule. Removing the start at +1 would be a different experiment. This page does not do that.' },
        ], view.explanation, (id) => { view.explanation = id; redraw(); }) : h('p.small', { text: 'Run the repaired lookup on the same schedule before choosing an explanation.' }),
        h('p.small', null, [
          'Source: ',
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-2.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 Spring 2026 lecture 2'),
          '. Page 35 titles the slide DAgger: Dataset Aggregation and names Ross et al. 2011. No sentence from that paper is quoted here.',
        ]),
        h('button.btn', {
          id: 'shift-complete', type: 'button',
          disabled: !repairOk || view.explanation !== 'dagger',
          onclick: () => { complete(); redraw(); },
        }, done() ? 'Lesson complete' : 'Finish lesson'),
        h('p.small', { text: 'To finish, run the slip, name the unseen state, add the expert label, run the same schedule, and choose the matching explanation.' }),
        h('button.btn.ghost', { id: 'shift-next', type: 'button', onclick: () => { if (openNext) openNext(); } }, 'Next level: ' + ((C.levels[C.levels.findIndex((level) => level.id === 'shift') + 1] || {}).title || 'none')),
      ));
      const trace = view.after || view.before || view.center;
      const label = trace
        ? 'Lane positions ' + list(trace.positions) + '.'
        : 'Lane from -2 to +2. The demonstration sits at 0. The ditches are -2 and +2.';
      lab.replaceChildren(
        h('section.card', null, [
          h('h3', { text: 'The lane' }),
          laneSvg(trace, label),
          h('p.small', { text: 'The accent stroke marks the demonstration at 0. The line is the latest rollout, and the dot is where it ended. A ditch ends the rollout. This schedule does not enter one.' }),
        ]),
        h('section.card.game-rules', { id: 'shift-rules' }, [
          h('h3', { text: 'Game rules · A narrow lane' }),
          h('dl', null, [
            h('div.rules-row', null, [h('dt', { text: 'Goal' }), h('dd', { text: 'Stay out of the ditch, and get back to the center after a slip.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Reward each step' }), h('dd', { text: 'None. This lesson has no reward and no learned network.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Equation' }), h('dd', { text: 'next = clamp(position + action + shove, -2, 2)' })]),
            h('div.rules-row', null, [h('dt', { text: 'Episode ends' }), h('dd', { text: 'At the ditch (-2 or +2), or after 4 steps.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Score' }), h('dd', { text: 'The position list for the shared schedule. No success rate is computed.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Pass this challenge' }), h('dd', { text: lesson.goal.text })]),
          ]),
        ]),
      );
      const again = focusId && document.getElementById(focusId);
      if (again && !again.disabled) again.focus();
    };
    redraw();
  };
})(window.CONTENT, window.BBSHIFT);
