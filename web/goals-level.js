// Goal-conditioned cloning on a one-row hall. Counts come from src/agents/goals.js.
(function (C, G) {
  'use strict';
  if (!G || !G.fit) throw new Error('BBGOALS missing');
  if (!C.phases.some((p) => p.n === 0)) C.phases.unshift({ n: 0, title: 'Imitation before reward' });
  C.worldNames.goals = 'Two doors';
  const goalsLevel = {
    id: 'goals', custom: true, phase: 0, world: 'goals', title: 'Tell it the goal', focus: [],
    intro: 'Two rooms sit at the ends of a hall. The notes contain three walks to the west room and one walk to the east room. A copy that drops the room follows the common walk. A copy that keeps the room can be asked for either room.',
    goal: { text: 'Ask for the rare room and reach it by counting the room with the action, using the same notes.' },
  };
  const shiftAt = C.levels.findIndex((l) => l.id === 'shift');
  if (shiftAt >= 0) C.levels.splice(shiftAt + 1, 0, goalsLevel);
  else C.levels.unshift(goalsLevel);

  const LABEL = {
    'west-room': 'west room', 'west-hall': 'west hall', start: 'start',
    'east-hall': 'east hall', 'east-room': 'east room', west: 'west', east: 'east',
  };
  const label = (id) => LABEL[id] || id;
  const num = (x) => (Math.round(x * 100) / 100).toFixed(2);
  const state = { predict: null, hiddenFit: null, hiddenWalks: {}, diagnose: null, repaired: null, asked: {}, explain: null };
  let redraw = null;

  function pathText(path) { return path.map(label).join(', then '); }
  function countLine(row) {
    const room = row.goal ? ', room ' + label(row.goal) : '';
    return label(row.state) + room + ': west ' + row.counts.west + ', east ' + row.counts.east
      + '. Probability of west ' + num(row.probs.west) + '. Walk ' + label(row.mode) + '.';
  }
  function pairLines(rows) {
    return rows.map((r) => label(r.state) + ', action ' + label(r.action));
  }
  function tripleLines(rows) {
    return rows.map((r) => label(r.state) + ', room ' + label(r.goal) + ', action ' + label(r.action));
  }

  function predict(id) { state.predict = id; redraw(); }
  function diagnose(id) { state.diagnose = id; redraw(); }
  function explain(id) { state.explain = id; redraw(); }
  function hideWalk(goal) {
    state.hiddenFit = G.fit(G.lessonRows(), false);
    state.hiddenWalks[goal] = G.rollout(state.hiddenFit, goal);
    redraw();
  }
  function repair() {
    state.repaired = G.fit(G.lessonRows(), true);
    state.asked = {};
    redraw();
  }
  function ask(goal) {
    state.repaired = G.fit(G.lessonRows(), true);
    state.asked[goal] = G.rollout(state.repaired, goal);
    redraw();
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'goals', sentenceName: 'Count the action with the room', mode: 'campaign', level: 'Tell it the goal',
      knobs: {}, words: {}, idleWords: {}, discovered: [],
      lastRun: state.repaired ? {
        seeds: 1, steps: 2, symptoms: [],
        summary: 'Conditioned east ends ' + (state.asked['east-room'] ? state.asked['east-room'].end : 'not asked') + '.',
      } : null,
    }),
    run() {
      state.hiddenFit = G.fit(G.lessonRows(), false);
      state.hiddenWalks['east-room'] = G.rollout(state.hiddenFit, 'east-room');
      state.hiddenWalks['west-room'] = G.rollout(state.hiddenFit, 'west-room');
      state.repaired = G.fit(G.lessonRows(), true);
      state.asked['east-room'] = G.rollout(state.repaired, 'east-room');
      state.asked['west-room'] = G.rollout(state.repaired, 'west-room');
      if (redraw) redraw();
      return { hidden: state.hiddenWalks, conditioned: state.asked };
    },
    mount(pane, lab, { h, complete, done }) {
      const lesson = C.levels.find((l) => l.id === 'goals');
      const body = h('div.card.stack', { id: 'goals-lesson' });
      pane.append(body);
      const tie = G.fit(G.tieRows(), false);
      const tieStart = tie.table.find((r) => r.state === 'start');
      redraw = () => {
        if (!body.isConnected) return;
        const n = C.levels.findIndex((l) => l.id === 'goals') + 1;
        const rows = G.lessonRows();
        const westStarts = rows.filter((r) => r.state === 'start' && r.goal === 'west-room').length;
        const eastStarts = rows.filter((r) => r.state === 'start' && r.goal === 'east-room').length;
        const predicted = state.predict === 'west';
        const bothHidden = state.hiddenWalks['east-room'] && state.hiddenWalks['west-room'];
        const diagnosed = state.diagnose === 'rare';
        const eastAsk = state.asked['east-room'];
        const westAsk = state.asked['west-room'];
        const bothAsked = eastAsk && westAsk && eastAsk.arrived && westAsk.arrived;
        const explained = state.explain === 'count';
        const choices = (id, picked, correct, options, onPick, open) => h('div.mc', { id }, options.map((o) => {
          const locked = picked === correct;
          const tag = 'button.opt' + (picked === o.id ? (o.id === correct ? '.right' : '.wrong') : '');
          return h(tag, { type: 'button', id: id + '-' + o.id, disabled: !open || locked, onclick: () => { if (open) onPick(o.id); } }, [
            h('span', { text: o.label }),
            picked === o.id ? h('span.why', { text: o.why }) : null,
          ]);
        }));
        const walkLine = (id, walk) => walk ? h('p.small', { id, role: 'status', text: 'Requested room: ' + label(walk.goal) + '. Path: ' + pathText(walk.path) + '. Ends in the requested room: ' + (walk.arrived ? 'yes' : 'no') + '.' }) : null;
        const next = C.levels[C.levels.findIndex((l) => l.id === 'goals') + 1];
        body.replaceChildren(
          h('div.eyebrow', { text: 'Phase 0 · Level ' + n + ' · Two doors' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', { text: 'The hall is one row: west room, west hall, start, east hall, east room. Actions are west and east. The copy counts actions. It walks the largest count. Equal counts pick west, the first action in the list. This start is ' + westStarts + ' west against ' + eastStarts + ' east, so the tie rule is not why a hidden copy goes west. This is a count, not a neural net. It is not DAgger. It is not the goal-grid check in a later lesson.' }),
          h('p.small', { text: 'CS 285 lecture 3, Spring 2026, has the heading Goal-conditioned behavioral cloning, then the headings Collect data and Reach goals. This lesson is a count of that idea. The slide wording is not copied here.' }),
          h('h3', { text: 'The notes' }),
          h('p', { text: 'Pairs leave the room off the row. Triples keep it. Both lists are the same ' + rows.length + ' steps.' }),
          h('p.small', { id: 'goals-pairs', text: 'Pairs: ' + pairLines(rows).join('. ') + '.' }),
          h('p.small', { id: 'goals-triples', text: 'Triples: ' + tripleLines(rows).join('. ') + '.' }),
          h('p', { id: 'goals-imbalance', text: 'Walks that start toward the west room: ' + westStarts + '. Walks that start toward the east room: ' + eastStarts + '. The east room is rarer.' }),
          h('p', { id: 'goals-tie', text: 'Tie check, not this lesson start: west ' + tieStart.counts.west + ', east ' + tieStart.counts.east + '. Probability of west ' + num(tieStart.probs.west) + ', probability of east ' + num(tieStart.probs.east) + '. Likelihood of a 0.80 west preference: ' + num(G.logLikelihood(tieStart.counts, { west: 0.8, east: 0.2 })) + '. Likelihood of a 0.80 east preference: ' + num(G.logLikelihood(tieStart.counts, { west: 0.2, east: 0.8 })) + '. They match. The walk picks ' + label(tieStart.mode) + '.' }),
          h('h3', { text: '1. Predict' }),
          h('p', { text: 'You ask for the east room. The copy does not keep the room on the row. Where does the walk end?' }),
          choices('goals-predict', state.predict, 'west', [
            { id: 'west', label: 'The west room. West was chosen more often at the start.', why: 'At the start the hidden count is west ' + westStarts + ', east ' + eastStarts + '. The walk takes west twice.' },
            { id: 'east', label: 'The east room. You asked for it.', why: 'Asking does nothing while the room is left off the row. The three west walks outvote the one east walk.' },
            { id: 'mix', label: 'The middle of the hall. The copy blends the two actions.', why: 'The count picks one action, the larger count. It does not blend west and east. Blending two modes is a different lesson.' },
          ], predict, true),
          h('h3', { text: '2. Run the hidden copy' }),
          h('p', { text: 'Fit the pairs. Then ask for each room. The requested room is shown, and it does not enter the count.' }),
          h('div.row', null, [
            h('button.btn', { id: 'goals-run-hidden-east', type: 'button', disabled: !predicted, onclick: () => hideWalk('east-room') }, 'Ask for the east room'),
            h('button.btn.ghost', { id: 'goals-run-hidden-west', type: 'button', disabled: !predicted, onclick: () => hideWalk('west-room') }, 'Ask for the west room'),
          ]),
          walkLine('goals-hidden-east', state.hiddenWalks['east-room']),
          walkLine('goals-hidden-west', state.hiddenWalks['west-room']),
          state.hiddenFit ? h('div', { id: 'goals-table-hidden' }, state.hiddenFit.table.map((r) => h('p.small', { text: countLine(r) }))) : null,
          h('h3', { text: '3. Diagnose' }),
          h('p', { text: 'Why did the hidden copy miss the east room?' }),
          choices('goals-diagnose', state.diagnose, 'rare', [
            { id: 'rare', label: 'The east room was rarer, and the copy could not tell the walks apart.', why: 'Both requests used the same start count, west ' + westStarts + ' and east ' + eastStarts + '. The room never changed the action.' },
            { id: 'illegal', label: 'The east walk was illegal.', why: 'Both walks are two legal steps from the start. The east notes are in the list.' },
            { id: 'tie', label: 'The counts were tied, so west won the tie.', why: 'The lesson start is ' + westStarts + ' against ' + eastStarts + '. The tie rule picks west only when the counts are equal. It is not what happens here.' },
          ], diagnose, !!bothHidden),
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Fit the triples. The count for a room uses only the rows that name that room.' }),
          h('button.btn', { id: 'goals-repair', type: 'button', disabled: !diagnosed, onclick: repair }, 'Count the room with the action'),
          state.repaired ? h('div', { id: 'goals-table-goal' }, state.repaired.table.map((r) => h('p.small', { text: countLine(r) }))) : null,
          h('h3', { text: '5. Ask for each room' }),
          h('div.row', null, [
            h('button.btn', { id: 'goals-ask-east', type: 'button', disabled: !state.repaired, onclick: () => ask('east-room') }, 'Ask the repaired copy for the east room'),
            h('button.btn.ghost', { id: 'goals-ask-west', type: 'button', disabled: !state.repaired, onclick: () => ask('west-room') }, 'Ask the repaired copy for the west room'),
          ]),
          walkLine('goals-ask-east-result', eastAsk),
          walkLine('goals-ask-west-result', westAsk),
          h('h3', { text: '6. Explain' }),
          h('p', { text: 'What changed when the room stayed on the row?' }),
          choices('goals-explain', state.explain, 'count', [
            { id: 'count', label: 'Each requested room uses only the walks that named that room.', why: 'The same count serves both rooms. The east-room rows contain only east. The west-room rows contain only west. Flipping which room is common would flip the hidden copy only.' },
            { id: 'memorize', label: 'The copy stored the east path as a special case.', why: 'There is no stored path. Each ask fits the triples again and walks the largest count for that room.' },
            { id: 'reward', label: 'A reward was added for the east room.', why: 'There is still no reward. The change is what the count is conditioned on.' },
          ], explain, !!bothAsked),
          h('button.btn', { id: 'goals-complete', type: 'button', disabled: !(explained && bothAsked), onclick: () => { complete(); redraw(); } }, done() ? 'Lesson complete' : 'I asked for both rooms with the room on the row'),
          done() && next ? h('button.btn.ghost', { id: 'goals-next', type: 'button', onclick: () => { window.bellman.level(next.id); window.scrollTo({ top: 0 }); } }, 'Next level: ' + next.title) : null,
        );
        lab.replaceChildren(h('section.card.game-rules', { id: 'goals-rules' }, [
          h('h3', { text: 'Game rules · Two doors' }),
          h('p', { text: 'Goal: reach the room you ask for. Reward each step: none. This lesson has no reward. Equation: p(action | state, room) = count(action, state, room) / count(state, room). The walk takes the largest count. Equal counts pick west. Episode ends: two steps from the start. Score: 1 if the walk ends in the requested room, otherwise 0. Pass this challenge: ' + lesson.goal.text }),
        ]));
      };
      redraw();
    },
  };
  window.BBGOALS_LEVEL = api;
})(window.CONTENT, window.BBGOALS);
