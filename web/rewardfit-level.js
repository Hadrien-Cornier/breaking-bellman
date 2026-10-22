// Lecture 13 lesson: fit a reward on a 5 by 3 grid, then plan with the weights.
(function (C, RF) {
  'use strict';
  if (!C.phases.some((p) => p.n === 4.5)) {
    const at = C.phases.findIndex((p) => p.n === 5);
    C.phases.splice(at >= 0 ? at : C.phases.length, 0, { n: 4.5, title: 'Learn the reward from demonstrations' });
  }
  C.worldNames.rewardfit = 'Grid with a hole';
  const o = (key, steps, result, correct, why) => ({ key, steps, result, correct: !!correct, why });
  const level = {
    id: 'rewardfit', custom: true, phase: 4.5, world: 'rewardfit', title: 'Fit the reward', focus: [],
    intro: 'A 5 by 3 grid has a start on the left, a goal on the right, and a hole on the straight line between them. Two demonstrations walk around the hole. A hand-written proxy pays only for closeness to the goal. You then maximize the likelihood of the demonstrated actions under a soft-optimal policy and plan with the fitted weights. The planner never receives the demonstration actions. Fetch stays the lesson where a hand-written reward is wrong.',
    goal: { text: 'Fit weights from demonstrations that avoid the hole, plan with those weights, and treat the result as one explanation.' },
    predict: { id: 'rewardfit-p', prompt: 'The proxy weights are closeness 1, hole 0, lane 0, step 0. The planner does not see the demonstrations. Which route does it return?', options: [
      o('through', ['The proxy pays for being close to the goal.', 'The hole sits on the shortest close path, and its weight is 0.', 'A weight of 0 adds nothing. It is not a penalty.'], 'It walks through the hole.', 1,
        'The proxy route is plan([1, 0, 0, 0]). Demonstrations are not an argument of plan.'),
      o('copy', ['The demonstrations walk around the hole.', 'A planner copies the routes it can see.', 'So the proxy matches the demonstrations.'], 'It walks around the hole.', 0,
        'The proxy planner cannot copy the demonstrations. Its only input is the weight vector.'),
      o('stop', ['The hole has no reward term.', 'A missing term is a penalty.', 'So the proxy stops in front of the hole.'], 'It stops before the hole.', 0,
        'A feature with weight 0 contributes 0. The hole cell is still closer to the goal than a detour.'),
    ] },
    diagnose: { id: 'rewardfit-d', prompt: 'The proxy route entered the hole. The demonstrations did not. What failed?', options: [
      o('reward', ['The proxy pays for closeness and pays nothing for the hole.', 'The straight path is closer than a walk around.', 'The planner maximized that reward.'], 'The hand-written reward made the hole a shortcut.', 1,
        'Same grid, same planner, different weights: the fitted route is the comparison.'),
      o('data', ['One demonstration must step on the hole.', 'The fit copied that step.', 'So the route enters the hole.'], 'The demonstrations include the hole.', 0,
        'Every demonstrated action in both sets lands off the hole. The dashed paths are those actions.'),
      o('solver', ['Soft value iteration prefers the center row.', 'The hole is in the center row.', 'So every weight vector enters it.'], 'The solver is biased toward the hole.', 0,
        'The fitted weights use the same solver and produce a different route. The weights changed the action values.'),
    ] },
    explain: { id: 'rewardfit-x', prompt: 'You fit the north demonstrations, then the south demonstrations. Which claim matches this computation?', options: [
      o('one', ['The free fit is a maximum of the demonstration likelihood inside this feature family and these bounds.', 'South demonstrations change the lane weight and the side of the route.', 'The lecture slide Inverse RL as a GAN is an adversarial method. This toy does not train a discriminator.'], 'The weights are one explanation of these demonstrations.', 1,
        'A different dataset is still safe walking, and the fit moves. The finite posterior is only four candidates.'),
      o('true', ['The search recovered the reward the demonstrator truly had.', 'Safe walking has only one reward in this family.', 'South demonstrations must keep the same weights.'], 'The weights are the true human reward.', 0,
        'The south demonstrations also avoid the hole, and the fitted lane weight changes sign.'),
      o('replay', ['The planner stores demonstration cells.', 'The weights are only a label.', 'Both datasets replay the north route.'], 'The route is a replay of the demonstrations.', 0,
        'plan(weights) reads the weights. The proxy weights and the fitted weights are different routes.'),
    ] },
    soWhat: 'A reward fit from a few demonstrated trajectories is one explanation of those trajectories. Another dataset, or another feature story with lower likelihood, can justify a different reward. Check the planned route on the real task before you trust the weights.',
    cannotTeach: 'Continuous actions, a neural reward, a discriminator, or the adversarial training titled Inverse RL as a GAN. This grid has 15 cells, four features, and an exact soft backup.',
  };
  if (!C.levels.some((l) => l.id === 'rewardfit')) {
    const after = C.levels.reduce((at, l, i) => (l.phase === 4 ? i : at), -1);
    if (after >= 0) C.levels.splice(after + 1, 0, level);
    else C.levels.push(level);
  }
  C.cards.maxentirl = {
    name: 'Reward fitting on a small grid', short: 'Fit a reward',
    fixes: 'The proxy pays only for closeness and plans through the hole. Weights that maximize the soft-optimal likelihood of demonstrations, followed by a planner that sees only those weights, can walk around it.',
    stillWrong: 'The fit is one maximum inside a four-feature family on a 5 by 3 grid. It is not a unique human reward. Lecture 13 also titles an adversarial method Inverse RL as a GAN. This toy does not train that method.',
    paper: 'CS 285 Spring 2026 lecture 13, heading Q-learning with soft optimality. The fit sums log pi(a|s) on the demonstrated actions. pi is the discounted soft Bellman policy on this grid. Levine (2018) reviews that backup. Ziebart, Maas, Bagnell, and Dey (2008) normalize a reward over whole trajectories. This page does not compute that partition.',
    evidence: '<p>Spring 2026 lecture 13 PDF, section Inverse reinforcement learning, extracted 2026-10-22: "many reward functions can explain the same behavior." The same deck has a separate heading, The IRL partition function, and later titles Inverse RL as a GAN. This lesson does not sum over trajectories and does not train a discriminator. The soft-backup citation on the slides is Levine (2018), Reinforcement Learning and Control as Probabilistic Inference.</p>',
  };
  C.paperLinks.maxentirl = [
    { t: 'Lecture 13 slides', u: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-13.pdf' },
    { t: 'Levine 2018', u: 'https://arxiv.org/abs/1805.00909' },
    { t: 'Ziebart et al. 2008, trajectory partition', u: 'https://www.aaai.org/Papers/AAAI/2008/AAAI08-227.pdf' },
  ];

  const state = {
    step: 0, busy: false, error: '', timer: null, token: 0, view: 'north',
    north: null, south: null, picked: {}, plans: {},
  };
  let hooks = {}, redraw = null;
  const num = (x) => (Math.round(x * 100) / 100).toFixed(2);
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const weightsText = (w) => RF.FEATURES.map((name, i) => name + ' ' + num(w[i])).join(', ');
  const pathText = (path) => path.map((p) => '(' + p.x + ',' + p.y + ')').join(' to ');
  function trips(demos) {
    const groups = [];
    let cur = [];
    for (const step of demos) {
      if (cur.length && step.x === RF.START.x && step.y === RF.START.y) { groups.push(cur); cur = []; }
      cur.push(step);
    }
    if (cur.length) groups.push(cur);
    return groups.map((group) => {
      const path = [{ x: group[0].x, y: group[0].y }];
      for (const step of group) path.push(RF.follow(step));
      return path;
    });
  }
  function routeWords(row) {
    const side = row.visitsNorth ? 'north' : row.visitsSouth ? 'south' : 'middle only';
    return (row.entersHole ? 'enters the hole' : 'avoids the hole') + ', ' + (row.reachesGoal ? 'reaches the goal' : 'misses the goal') + ', ' + side;
  }
  function ambiguity(study) {
    const avoid = study.posterior.filter((row) => row.reachesGoal && !row.entersHole);
    const top = study.posterior.reduce((a, b) => a.posterior >= b.posterior ? a : b);
    const names = avoid.map((row) => row.id + ' at ' + pct(row.posterior)).join('; ');
    return avoid.length + ' of ' + study.posterior.length + ' candidates reach the goal and avoid the hole'
      + (names ? ' (' + names + ')' : '') + '. The highest posterior on this list is ' + top.id + ' at ' + pct(top.posterior)
      + '. The list has four explanations. It is not every reward a person could have.';
  }
  function go(n) {
    if (state.step < n) {
      state.step = n;
      if (hooks.setProgress) hooks.setProgress(n);
    }
    if (redraw) redraw();
  }
  function later(work) {
    const token = ++state.token;
    state.busy = true;
    state.error = '';
    if (redraw) redraw();
    state.timer = setTimeout(() => {
      if (token !== state.token) return;
      try { work(); } catch (e) { state.error = String(e && e.message || e); }
      state.busy = false;
      if (redraw) redraw();
    }, 30);
  }
  let pendingReject = null;
  RF.cancel = () => {
    state.token++;
    state.busy = false;
    if (state.timer) clearTimeout(state.timer);
    if (pendingReject) { const reject = pendingReject; pendingReject = null; reject(Error('cancelled')); }
  };
  RF.state = () => ({
    world: 'rewardfit', sentenceName: 'Soft-optimal reward likelihood', mode: 'campaign', level: level.title,
    knobs: { view: state.view }, words: {}, idleWords: {}, discovered: [],
    lastRun: state.north ? {
      seeds: 1, steps: state.north.free.evaluations, symptoms: [],
      summary: {
        proxyLogLikelihood: state.north.proxy.logLikelihood,
        fittedLogLikelihood: state.north.free.logLikelihood,
        proxyEntersHole: state.north.proxy.entersHole,
        fittedEntersHole: state.north.free.entersHole,
      },
    } : null,
    comparison: state.view === 'south' && state.south ? state.south : state.north,
  });
  RF.run = () => new Promise((resolve, reject) => {
    pendingReject = reject;
    later(() => {
      try {
        state.north = RF.study(RF.NORTH_DEMOS);
        state.view = 'north';
        if (state.step < 2) {
          state.step = 2;
          if (hooks.setProgress) hooks.setProgress(2);
        }
        pendingReject = null;
        resolve(state.north);
      } catch (e) {
        pendingReject = null;
        reject(e);
        throw e;
      }
    });
  });

  function table(h, headings, rows, label) {
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': label }, h('table', null, [
      h('thead', null, h('tr', null, headings.map((text) => h('th', { scope: 'col', text })))),
      h('tbody', null, rows.map((row) => h('tr', null, row.map((text) => h('td', { text }))))),
    ]));
  }
  function quiz(h, q, advance) {
    const shift = [...q.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % q.options.length;
    const entries = q.options.map((opt, i) => ({ opt, i }));
    entries.push(...entries.splice(0, shift));
    const choice = state.picked[q.id];
    const known = choice != null;
    return h('div.mc', { id: q.id }, [
      h('p', { text: q.prompt }),
      ...entries.map(({ opt, i }) => h('button.opt' + (known && choice === i ? '.picked' : '') + (known ? (opt.correct ? '.right' : '.wrong') : ''), {
        type: 'button', 'data-choice': opt.key,
        onclick: () => {
          state.picked[q.id] = i;
          if (hooks.recordAnswer) hooks.recordAnswer(q.id, i, !!opt.correct);
          if (advance) advance();
          else if (redraw) redraw();
        },
      }, [
        h('ol', null, opt.steps.map((s) => h('li', { text: s }))),
        h('span.res', { text: opt.result }),
        known ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + opt.why }) : null,
      ])),
    ]);
  }
  function grid(h, study) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const CELL = 64, PAD = 16;
    svg.setAttribute('viewBox', '0 0 ' + (PAD * 2 + RF.WIDTH * CELL) + ' ' + (PAD * 2 + RF.HEIGHT * CELL));
    svg.setAttribute('role', 'img');
    const hole = study ? (study.proxy.entersHole ? 'Proxy route enters the hole.' : 'Proxy route misses the hole.') : 'No route yet.';
    const fitted = study ? (study.free.entersHole ? ' Fitted route enters the hole.' : ' Fitted route avoids the hole.') : '';
    svg.setAttribute('aria-label', '5 by 3 grid. Start on the left, goal on the right, hole in the center. ' + hole + fitted);
    const element = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (text) node.textContent = text;
      svg.append(node);
    };
    const center = (p) => (PAD + p.x * CELL + CELL / 2) + ',' + (PAD + p.y * CELL + CELL / 2);
    for (let y = 0; y < RF.HEIGHT; y++) for (let x = 0; x < RF.WIDTH; x++) {
      const holeCell = x === RF.HOLE.x && y === RF.HOLE.y;
      const goalCell = x === RF.GOAL.x && y === RF.GOAL.y;
      element('rect', {
        x: PAD + x * CELL + 3, y: PAD + y * CELL + 3, width: CELL - 6, height: CELL - 6, rx: 8,
        fill: 'var(--sunk)', stroke: holeCell ? 'var(--bad)' : goalCell ? 'var(--good)' : 'var(--line)', 'stroke-width': holeCell || goalCell ? 3 : 1,
      });
    }
    const line = (path, attrs) => element('polyline', Object.assign({ points: path.map(center).join(' '), fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, attrs));
    if (study) {
      const demos = study === state.south ? RF.SOUTH_DEMOS : RF.NORTH_DEMOS;
      for (const path of trips(demos)) line(path, { stroke: 'var(--muted)', 'stroke-dasharray': '7 6', 'stroke-width': 3 });
      line(study.proxy.path, { stroke: 'var(--bad)' });
      line(study.free.path, { stroke: 'var(--good)' });
    }
    for (let y = 0; y < RF.HEIGHT; y++) for (let x = 0; x < RF.WIDTH; x++) {
      const holeCell = x === RF.HOLE.x && y === RF.HOLE.y;
      const goalCell = x === RF.GOAL.x && y === RF.GOAL.y;
      const label = x === RF.START.x && y === RF.START.y ? 'S' : goalCell ? 'G' : holeCell ? 'hole' : '';
      if (label) element('text', { x: PAD + x * CELL + CELL / 2, y: PAD + y * CELL + CELL / 2 + 5, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': holeCell ? 14 : 18 }, label);
    }
    return svg;
  }
  function candidateRows(study) {
    return study.posterior.map((row) => [row.id, weightsText(row.weights), num(row.logLikelihood), pct(row.posterior), routeWords(row)]);
  }
  function nextLevel() {
    const at = C.phases.findIndex((p) => p.n === 4.5);
    for (let i = at + 1; i < C.phases.length; i++) {
      const found = C.levels.find((l) => l.phase === C.phases[i].n);
      if (found) return found;
    }
    return null;
  }

  RF.mount = (pane, lab, api) => {
    hooks = api || {};
    const h = hooks.h;
    state.step = hooks.progress ? hooks.progress() : 0;
    for (const q of [level.predict, level.diagnose, level.explain]) {
      const saved = hooks.answerFor ? hooks.answerFor(q.id) : null;
      if (saved) state.picked[q.id] = saved.choice;
    }
    const body = h('div.card.stack', { id: 'rewardfit-lesson' });
    pane.append(body);
    const restore = () => {
      if (state.step >= 2 && !state.north && !state.busy) {
        later(() => { state.north = RF.study(RF.NORTH_DEMOS); });
      }
    };
    redraw = () => {
      if (!body.isConnected) return;
      const study = state.view === 'south' && state.south ? state.south : state.north;
      const choice = (id) => {
        const q = [level.predict, level.diagnose, level.explain].find((item) => item.id === id);
        return q && state.picked[id] != null ? q.options[state.picked[id]] : null;
      };
      const explain = choice('rewardfit-x');
      body.replaceChildren(
        h('div.eyebrow', { text: 'Lecture 13 · ' + C.worldNames.rewardfit }),
        h('h2', { text: level.title }),
        h('p', { text: level.intro }),
        h('p.small', { text: 'Placed after the offline levels. Lecture 13 is Control as Inference. The first slide heading in the Spring 2026 deck is Control as Variational Inference.' }),
        h('details', { id: 'rewardfit-assumptions', open: true }, [
          h('summary', { text: 'Toy assumptions, objective, and what this is not' }),
          h('ul', null, RF.ASSUMPTIONS.map((text) => h('li', { text }))),
          h('p.small', null, [
            'Slides: ',
            h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-13.pdf', target: '_blank', rel: 'noopener' }, 'lecture 13'),
            ', heading Q-learning with soft optimality. Soft backup review: ',
            h('a', { href: 'https://arxiv.org/abs/1805.00909', target: '_blank', rel: 'noopener' }, 'Levine (2018)'),
            '. Trajectory partition, not computed here: ',
            h('a', { href: 'https://www.aaai.org/Papers/AAAI/2008/AAAI08-227.pdf', target: '_blank', rel: 'noopener' }, 'Ziebart, Maas, Bagnell, and Dey (2008)'),
            '.',
          ]),
        ]),
        h('a', { href: '#rewardfit-lab', text: 'Jump to the grid and the rules' }),
      );
      const steps = h('div.steps');
      const block = (i, title, kids) => h('div.step' + (state.step === i ? '.active' : state.step > i ? '.done' : ''), null, [
        h('span.num', { text: 'Step ' + (i + 1) }), h('h3', { text: title }), ...kids,
      ]);
      steps.append(block(0, 'Predict before you fit', [quiz(h, level.predict, () => go(1))]));
      if (state.step >= 1) steps.append(block(1, 'Run the fit', [
        h('p', { text: 'North demonstrations walk around the hole. The button fits weights on those actions, then plans with the proxy weights and with the fitted weights.' }),
        h('button.btn', {
          id: 'rewardfit-fit', type: 'button', disabled: state.busy,
          onclick: () => later(() => { state.view = 'north'; state.north = RF.study(RF.NORTH_DEMOS); go(2); }),
        }, state.busy ? 'Fitting weights…' : 'Fit the north demonstrations'),
        h('p.small', { id: 'rewardfit-status', role: 'status', text: state.error || (state.north
          ? 'Searched ' + state.north.free.evaluations + ' free weight vectors. Proxy log likelihood ' + num(state.north.proxy.logLikelihood) + '. Fitted log likelihood ' + num(state.north.free.logLikelihood) + '.'
          : 'The fit is a search, not a stored route.') }),
        state.north ? table(h, ['Candidate', 'Weights', 'Log likelihood', 'Posterior', 'Greedy route'], candidateRows(state.north), 'North demonstration fit') : null,
        state.north ? h('div', { id: 'rewardfit-inline-map' }, [
          grid(h, state.north),
          h('p.small', { text: 'Dashed lines are the demonstrations. Red is the proxy plan. Green is the plan from the free fit.' }),
        ]) : null,
        state.north ? h('p', { text: ambiguity(state.north) }) : null,
      ]));
      if (state.step >= 2 && state.north) steps.append(block(2, 'Diagnose the proxy', [
        h('p', { text: 'At the cell just left of the hole, the proxy action values are ' + Object.entries(state.north.decision.proxyQ).map(([a, v]) => a + ' ' + num(v)).join(', ') + '. The fitted values are ' + Object.entries(state.north.decision.fittedQ).map(([a, v]) => a + ' ' + num(v)).join(', ') + '.' }),
        quiz(h, level.diagnose, () => go(3)),
      ]));
      if (state.step >= 3 && state.north) steps.append(block(3, 'Repair: plan from weights', [
        h('p', { text: 'The repair is to plan from the fitted weights. Each button calls the planner on a weight vector. Demonstration actions are not passed in.' }),
        h('p.small', { text: 'Free fit: ' + weightsText(state.north.free.weights) + '. Hole-locked fit: ' + weightsText(state.north.holeLocked.weights) + '.' }),
        h('div.row', null, [
          h('button.btn', { id: 'rewardfit-plan-free', type: 'button', onclick: () => { state.plans.free = RF.plan(state.north.free.weights); if (state.plans.hole && !RF.entersHole(state.plans.free)) go(4); else redraw(); } }, 'Plan with the free fit'),
          h('button.btn.ghost', { id: 'rewardfit-plan-hole', type: 'button', onclick: () => { state.plans.hole = RF.plan(state.north.holeLocked.weights); if (state.plans.free && !RF.entersHole(state.plans.free)) go(4); else redraw(); } }, 'Plan with the hole weight locked at 0'),
          h('button.btn.ghost', { id: 'rewardfit-plan-proxy', type: 'button', onclick: () => { state.plans.proxy = RF.plan(RF.PROXY_WEIGHTS); redraw(); } }, 'Plan with the proxy'),
        ]),
        state.plans.free ? h('p', { text: 'Free-fit plan: ' + pathText(state.plans.free) + '. ' + (RF.entersHole(state.plans.free) ? 'It enters the hole.' : 'It avoids the hole.') }) : null,
        state.plans.hole ? h('p', { text: 'Hole-locked plan: ' + pathText(state.plans.hole) + '. ' + (RF.entersHole(state.plans.hole) ? 'It enters the hole.' : 'It avoids the hole.') + ' Its weights differ from the free fit.' }) : null,
        state.plans.proxy ? h('p', { text: 'Proxy plan: ' + pathText(state.plans.proxy) + '. ' + (RF.entersHole(state.plans.proxy) ? 'It enters the hole.' : 'It avoids the hole.') }) : null,
      ]));
      if (state.step >= 4 && state.north) steps.append(block(4, 'Explain what the fit does not identify', [
        h('p', { text: 'The north fit is one explanation. A lecture 13 bullet under Inverse reinforcement learning says "many reward functions can explain the same behavior." Fit the south demonstrations, which also avoid the hole, and compare the lane weight and the route.' }),
        h('button.btn', {
          id: 'rewardfit-south', type: 'button', disabled: state.busy,
          onclick: () => later(() => { state.south = RF.study(RF.SOUTH_DEMOS); state.view = 'south'; }),
        }, state.busy ? 'Fitting the south set…' : 'Fit the south demonstrations'),
        state.south ? h('p', { text: 'North lane weight ' + num(state.north.free.weights[RF.FEATURE.lane]) + ', route ' + pathText(state.north.free.path) + '. South lane weight ' + num(state.south.free.weights[RF.FEATURE.lane]) + ', route ' + pathText(state.south.free.path) + '.' }) : null,
        state.south ? h('div', { id: 'rewardfit-south-map' }, [
          grid(h, state.south),
          h('p.small', { text: 'South dataset. Dashed lines avoid the hole on the south side. Green is the new free-fit plan.' }),
        ]) : null,
        state.south ? table(h, ['Candidate', 'Weights', 'Log likelihood', 'Posterior', 'Greedy route'], candidateRows(state.south), 'South demonstration fit') : null,
        state.south ? h('p', { text: ambiguity(state.south) }) : null,
        quiz(h, level.explain, null),
        h('button.btn', {
          id: 'rewardfit-finish', type: 'button',
          disabled: !(hooks.done && hooks.done()) && !(state.south && explain && explain.correct && state.plans.free && !RF.entersHole(state.plans.free)),
          onclick: () => {
            if (hooks.reveal) hooks.reveal('maxentirl');
            if (hooks.complete) hooks.complete();
            state.step = 5;
            redraw();
          },
        }, hooks.done && hooks.done() ? 'Lesson complete' : 'Finish lesson'),
        h('p.small', { text: hooks.done && hooks.done()
          ? 'This lesson is already in the save. Fitting the south demonstrations again is optional.'
          : 'Finish stays off until the south fit has run, the free-fit plan avoids the hole, and the selected claim matches the computation.' }),
        h('p', { text: level.soWhat }),
        h('p.small', { text: 'What this toy cannot teach: ' + level.cannotTeach }),
      ]));
      if (state.step >= 5) {
        const nx = nextLevel();
        steps.append(block(5, 'Next level', [
          nx ? h('button.btn', { id: 'rewardfit-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(nx.id) }, 'Next level: ' + nx.title) : h('p', { text: 'This is the last level in the campaign list.' }),
        ]));
      }
      body.append(steps);
      lab.replaceChildren(
        h('section.card', { id: 'rewardfit-lab' }, [
          h('h3', { text: 'The grid' }),
          grid(h, study),
          h('p.small', { text: (study
            ? 'Showing the ' + state.view + ' dataset. Proxy: ' + routeWords(study.proxy) + '. Free fit: ' + routeWords(study.free) + '. '
            : 'S is the start. G is the goal. The outlined center cell is the hole. ')
            + 'Dashed lines are demonstrations. Red is the proxy plan. Green is the free-fit plan.' }),
        ]),
        h('section.card.game-rules', { id: 'rewardfit-rules', 'aria-label': 'Level rules' }, [
          h('h3', { text: 'Game rules · Grid with a hole' }),
          h('dl', null, [
            h('div.rules-row', null, [h('dt', { text: 'Goal' }), h('dd', { text: 'Reach the goal without treating the hole as a free shortcut.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Reward' }), h('dd', { text: 'A dot product of closeness, hole, lane, and step. The proxy uses closeness only.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Objective' }), h('dd', { text: 'Sum of log pi(a|s) on the demonstrated actions. pi is the discounted soft Bellman policy. This is not a sum over whole trajectories.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Episode ends' }), h('dd', { text: 'When the plan enters the goal, or if it loops.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Score' }), h('dd', { text: 'Log likelihood of the demonstrations, then the cells of the greedy plan.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Pass this challenge' }), h('dd', { text: level.goal.text })]),
          ]),
        ]),
      );
    };
    redraw();
    restore();
  };
})(window.CONTENT, window.BBREWARDFIT);
