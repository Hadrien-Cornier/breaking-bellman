// Lecture 23 diversity reward. Counts and the policy update live in src/agents/skills.js.
(function (C, S) {
  'use strict';
  if (!S || !S.train) throw new Error('BBSKILLS missing');
  if (!C.phases.some((p) => p.n === 10)) {
    const phase = { n: 10, title: 'Diverse skills' };
    const before = C.phases.findIndex((p) => p.n === 9);
    if (before >= 0) C.phases.splice(before, 0, phase);
    else C.phases.push(phase);
  }
  C.worldNames.skills = 'Two skills';
  const lesson = {
    id: 'skills', custom: true, phase: 10, world: 'skills', title: 'Pay a skill for being identifiable', focus: [],
    intro: 'Red and blue each take one action from the start. West enters the west room. East enters the east room. A smoothed count of those visits is q(skill|room). The reward is log q minus log of a uniform prior. A softmax policy then takes gradient steps on that reward.',
    goal: { text: 'Separate the skills with the discriminator reward when a room identifies the skill, and keep the reward at zero when the visits are symmetric.' },
  };
  if (!C.levels.some((l) => l.id === 'skills')) {
    const hin = C.levels.findIndex((l) => l.id === 'hindsight');
    if (hin >= 0) C.levels.splice(hin, 0, lesson);
    else {
      const sm = C.levels.findIndex((l) => l.id === 'supermimic');
      const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
      let insertAt = sm >= 0 ? sm : C.levels.length;
      if (goalsAt > insertAt) insertAt = goalsAt + 1;
      C.levels.splice(insertAt, 0, lesson);
    }
  }

  const NAME = { red: 'Red', blue: 'Blue', west: 'west', east: 'east' };
  const state = {
    pred: null, diag: null, explain: null, report: null, mode: '', tie: false, applied: null,
    bias: '0.25', source: 'plan', seed: '11', alpha: '1', updates: '4', edited: false, counts: null,
  };
  let redraw = null;
  const css = '#skills-lesson,#skills-rules{max-width:100%;overflow-wrap:anywhere}#skills-lesson .btn,#skills-lesson .opt,#skills-lesson select,#skills-lesson input,#skills-rules .btn{min-height:44px}#skills-lesson .split{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}#skills-lesson .panel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);min-width:0}#skills-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#skills-lesson .bar{height:10px;background:var(--line);border-radius:999px;overflow:hidden}#skills-lesson .bar i{display:block;height:100%;background:var(--accent)}#skills-lesson .map{width:100%;height:auto;display:block}#skills-lesson .count{width:4.5rem}';

  function ensureCss() {
    if (document.getElementById('skills-css')) return;
    const style = document.createElement('style');
    style.id = 'skills-css';
    style.textContent = css;
    document.head.append(style);
  }

  function num(x) {
    if (x == null || !Number.isFinite(x)) return 'none';
    const v = Math.round(x * 1000) / 1000;
    return Object.is(v, -0) ? '0' : String(v);
  }

  function qText(fit, room, skill) {
    const row = fit.rooms[room];
    if (!row.supported || row.q[skill] == null) return 'unsupported';
    return (row.raw[skill] + fit.alpha) + '/' + row.denominator + ' (' + num(row.q[skill]) + ')';
  }

  function mapSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 140');
    svg.setAttribute('class', 'map');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Start sits between a west room and an east room. West enters the west room. East enters the east room.');
    const el = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      if (text) node.textContent = text;
      svg.append(node);
    };
    el('line', { x1: 70, y1: 70, x2: 250, y2: 70, stroke: 'var(--accent)', 'stroke-width': 4 });
    [['West', 50, 70], ['Start', 160, 70], ['East', 270, 70]].forEach(([label, x, y]) => {
      el('circle', { cx: x, cy: y, r: 22, fill: 'var(--surface)', stroke: 'var(--ink)' });
      el('text', { x: x, y: y + 4, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 11 }, label);
    });
    return svg;
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

  const PREDICT = {
    id: 'skills-p',
    prompt: 'Both skills visit west four times and east four times. Smoothing adds one pseudo-count per skill. The prior is 1/2. What is the reward?',
    options: [
      { key: 'zero', result: 'q is 1/2 in every room, and the reward is 0.', correct: true, why: 'The smoothed count is (4+1)/(8+2) = 1/2. log(1/2) - log(1/2) is 0. The room was visited. It does not identify the skill.' },
      { key: 'listed', result: 'The reward sends red west, because west is the first action.', correct: false, why: 'A tie that adds the step to west is a separate rule. This count gives every room the same reward, and that reward is 0.' },
      { key: 'novel', result: 'The reward is 1, because the other skill missed a room.', correct: false, why: 'Both skills visited both rooms. A bonus of 1 for a room the other skill missed is a different reward. It is not log q - log p.' },
    ],
  };
  const DIAGNOSE = {
    id: 'skills-d',
    prompt: 'On the exploration plan, red has 6 west visits and 2 east visits. Blue has the opposite. q(red|west) is 7/10. The policies are still uniform. What is true?',
    options: [
      { key: 'assigned', result: 'Red already owns the west room, so its policy must enter west.', correct: false, why: 'q is a count. The logits are still 0. No update has run, and no room is stored on the skill.' },
      { key: 'signal', result: 'West makes red more probable than the prior, so the reward in west is positive. That number comes from this count.', correct: true, why: '7/10 is larger than 1/2, so log(7/10) - log(1/2) is log(1.4), about 0.336. Blue has the positive reward in east. The fit and the policy update are different steps.' },
      { key: 'miss', result: 'The reward is 1 because blue missed west.', correct: false, why: 'Blue has 2 visits in west. A unique-room bonus would be 0 here. The discriminator reward is not 1.' },
    ],
  };

  function explainQuestion(applied, report) {
    const sym = report.sym;
    const info = S.batchInformation(applied.counts);
    const avg = S.averageReward(applied.counts, applied.rewards.table);
    const red = applied.policies.red;
    const blue = applied.policies.blue;
    return {
      id: 'skills-x',
      prompt: 'Which account matches the tables on this page?',
      options: [
        { key: 'mi-policy', result: 'The average reward is the mutual information of the updated policy.', correct: false, why: 'The count table has mutual information ' + num(info.mutualInformation) + '. The average smoothed reward on those visits is ' + num(avg.value) + '. Red ends at p(west) ' + num(red.pi.west) + '. None of those three numbers is the mutual information of the policy.' },
        { key: 'split', result: 'The discriminator reward moves each skill toward the room where its own q is higher. Symmetric visits keep the reward at 0.', correct: true, why: 'Red greedy action ' + (red.action || 'tie') + ', blue greedy action ' + (blue.action || 'tie') + '. Symmetric q(red|west) is ' + num(sym.rewards.fit.rooms.west.q.red) + ' and its reward is ' + num(sym.rewards.table.red.west.value) + '. The gradient on that table stays 0. The mutual information above is the mutual information of the visits, not of the policy after ' + applied.updates + ' steps.' },
        { key: 'always', result: 'A shared reward of 1 always piles both skills into one room, and that pile-up is this objective.', correct: false, why: 'On the fixed exploration plan of ' + report.interactions + ' visits, shared reward without the tie leaves red at p(west) ' + num(report.shared.policies.red.pi.west) + '. The west tie is a stated rule for equal rewards. After that tie, a new discriminator fit has reward ' + num(report.afterTie.rewards.table.red.west.value) + ' and does not split the skills.' },
      ],
    };
  }

  function passed(applied) {
    if (!applied || applied.mode !== 'discriminator' || applied.tieBreak) return false;
    if (!applied.separated || !applied.rewards.fit) return false;
    return S.SKILLS.every((skill) => {
      const pol = applied.policies[skill];
      return pol.action && pol.action === pol.higherRoom && pol.pi[pol.action] > 0.5;
    });
  }

  function derivedCounts() {
    const bias = Number(state.bias);
    const budget = S.LESSON.budgetPerSkill;
    if (state.source === 'sample') return S.sampleCounts({ budgetPerSkill: budget, bias, seed: Number(state.seed) }).counts;
    return S.exactPlanCounts({ budgetPerSkill: budget, bias }).counts;
  }

  function liveCounts() {
    if (state.edited && state.counts) return S.cloneCounts(state.counts);
    return derivedCounts();
  }

  function fitPanel(h, title, pack, id) {
    const fit = pack.rewards ? pack.rewards.fit : pack;
    const counts = pack.counts;
    const rows = S.ROOMS.map((room) => h('p.nums', {
      text: NAME[room] + ' visits red ' + counts.red[room] + ', blue ' + counts.blue[room]
        + '. q(red) ' + qText(fit, room, 'red') + '. q(blue) ' + qText(fit, room, 'blue')
        + '. reward red ' + num(pack.rewards.table.red[room].value) + ', blue ' + num(pack.rewards.table.blue[room].value) + '.',
    }));
    return h('div.panel', { id: id }, [h('h4', { text: title })].concat(rows));
  }

  function policyPanel(h, title, pack, id) {
    const kids = [h('h4', { text: title }), h('p.nums', { text: 'Mode ' + pack.mode + '. Updates ' + pack.updates + '. Step size ' + pack.eta + '. Visits ' + pack.interactions + '. Tie rule ' + (pack.tieBreak ? 'west when rewards match' : 'off') + '.' })];
    for (const skill of S.SKILLS) {
      const pol = pack.policies[skill];
      const width = Math.max(0, Math.min(100, pol.pi.west * 100));
      kids.push(h('p.nums', { text: NAME[skill] + ' p(west) ' + num(pol.pi.west) + ', p(east) ' + num(pol.pi.east) + '. Greedy ' + (pol.action || 'tie') + '. Higher reward room ' + (pol.higherRoom || 'tie') + '.' }));
      kids.push(h('div.bar', { 'aria-hidden': 'true' }, [h('i', { style: 'width:' + width + '%' })]));
    }
    kids.push(h('p.small', { text: pack.separated ? 'The greedy rooms differ.' : 'The greedy actions do not split the skills.' }));
    return h('div.panel', { id: id }, kids);
  }

  function infoLine(h, counts, table) {
    const info = S.batchInformation(counts);
    const avg = S.averageReward(counts, table);
    if (!info.defined) return h('p.small', { text: 'This count has no visits, so mutual information is undefined.' });
    return h('p.nums', {
      id: 'skills-info',
      text: 'Count-table H(skill) ' + num(info.hSkill) + '. H(skill|room) ' + num(info.hCond) + '. Mutual information of these visits ' + num(info.mutualInformation) + '. Average reward on the same visits ' + num(avg.value) + '. Skill totals match the prior: ' + (info.balanced ? 'yes' : 'no') + '.',
    });
  }

  const api = {
    cancel() {},
    state() {
      return {
        world: 'skills', sentenceName: 'Smoothed count discriminator, softmax policy gradient', mode: 'campaign', level: lesson.title,
        knobs: { alpha: S.LESSON.alpha, prior: S.LESSON.prior, eta: S.LESSON.eta, updates: S.LESSON.updates, budget: S.LESSON.budgetPerSkill },
        words: {}, idleWords: {}, discovered: [],
        lastRun: state.applied ? { seeds: 1, steps: state.applied.interactions, symptoms: [], summary: { separated: state.applied.separated, mode: state.applied.mode } } : null,
      };
    },
    run() {
      state.report = S.compare();
      if (redraw) redraw();
      return state.report;
    },
  };

  api.mount = (pane, lab, hooks) => {
    ensureCss();
    const saved = (id) => hooks.answer ? hooks.answer(id) : null;
    const p0 = saved('skills-p'); const d0 = saved('skills-d'); const x0 = saved('skills-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step = hooks.step ? hooks.step() : 0;
    if (step >= 2) state.report = state.report || S.compare();
    if (step >= 4 && !state.applied) {
      state.report = state.report || S.compare();
      state.mode = 'discriminator';
      state.tie = false;
      state.edited = false;
      state.applied = state.report.disc;
      state.counts = S.cloneCounts(state.report.plan.counts);
    }
    const h = hooks.h;
    const body = h('div.card.stack', { id: 'skills-lesson' });
    pane.append(body);
    function advance(n) { if (hooks.markStep) hooks.markStep(n); }
    function apply(mode, tie, counts, edited) {
      state.mode = mode;
      state.tie = !!tie;
      if (counts) state.counts = S.cloneCounts(counts);
      if (edited != null) state.edited = edited;
      const used = state.edited ? S.cloneCounts(state.counts) : liveCounts();
      state.counts = used;
      state.applied = S.train({
        counts: used, mode, alpha: Number(state.alpha), prior: S.LESSON.prior,
        eta: S.LESSON.eta, updates: Number(state.updates), tieBreak: !!tie,
      });
      state.report = state.report || S.compare();
      if (passed(state.applied)) advance(4);
      redraw();
    }
    redraw = () => {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'skills') + 1;
      const report = state.report;
      const applied = state.applied;
      const explain = applied && report && passed(applied) ? explainQuestion(applied, report) : null;
      const explainOk = !!(explain && state.explain != null && explain.options[state.explain].correct);
      const counts = state.counts || (report ? report.plan.counts : null);
      const kids = [
        h('div.eyebrow', { text: 'Level ' + n + ' · Two skills' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        mapSvg(),
        h('p.small', { text: 'Lecture 23, slide "Learning diverse skills": different skills should visit different state-space regions. The next slide, "Diversity-promoting reward function", draws a discriminator that predicts the skill. Eysenbach, Gupta, Ibarz, and Levine, Diversity is All You Need (2018), equation 3, set that reward to log q(z|s) - log p(z), with p(z) fixed and uniform. Their equation 2 also has an action-entropy term, which they implement with soft actor-critic. This lesson does not.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-23.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 23 slides'),
          ' · ',
          h('a', { href: 'https://arxiv.org/abs/1802.06070', target: '_blank', rel: 'noopener' }, 'Eysenbach et al., 2018'),
        ]),
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (hooks.recordAnswer) hooks.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if ((hooks.step ? hooks.step() : 0) >= 1 || state.pred != null) {
        kids.push(h('h3', { text: '2. Fit the discriminator' }),
          h('p', { text: 'Two visit tables, eight visits per skill. The symmetric plan uses exploration probability 1/2, so each skill has 4 and 4. The exploration plan uses probability 0.75 of west for red and 0.25 for blue, so the integer plan is 6 and 2. That plan is labeled exploration. It is not a room stored in the policy. Fitting q does not move the logits.' }),
          h('button.btn', { id: 'skills-run', type: 'button', onclick: () => { state.report = S.compare(); advance(2); redraw(); } }, 'Fit q on both tables'));
        if (report) {
          kids.push(h('div.split', null, [
            fitPanel(h, 'Symmetric plan, fit only', report.sym, 'skills-sym-fit'),
            fitPanel(h, 'Exploration plan, fit only', report.disc, 'skills-plan-fit'),
          ]));
          kids.push(h('p.small', { text: 'Policies are still uniform: p(west) = 1/2. Interactions in each table: ' + report.interactions + '. Smoothing ' + report.alpha + '. Prior ' + report.prior + '.' }));
        }
      }
      if (report && ((hooks.step ? hooks.step() : 0) >= 2 || state.diag != null)) {
        kids.push(h('h3', { text: '3. Diagnose' }),
          choice(h, DIAGNOSE, state.diag, (i) => { state.diag = i; if (hooks.recordAnswer) hooks.recordAnswer(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct); advance(3); redraw(); }));
      }
      if (report && state.diag != null) {
        const shown = counts || report.plan.counts;
        kids.push(h('h3', { text: '4. Update the policies' }),
          h('p', { text: 'Pick a reward and run the gradient. The objective is the expected reward of the softmax policy. The step is the exact gradient of that objective, from zero logits. Step size 1. Shared reward and the discriminator read the same visits. The west tie is an extra rule, used only when the two rewards match: add the step size to the west logit. It is not a theorem about every shared reward.' }),
          h('div.row', { id: 'skills-controls' }, [
            h('label.small', { for: 'skills-bias', text: 'Exploration bias' }),
            h('select', { id: 'skills-bias', onchange: (e) => { state.bias = e.target.value; state.edited = false; if (state.mode) apply(state.mode, state.tie, null, false); else redraw(); } }, [
              h('option', { value: '0', selected: state.bias === '0' ? 'selected' : null }, '0, uniform'),
              h('option', { value: '0.25', selected: state.bias === '0.25' ? 'selected' : null }, '0.25'),
              h('option', { value: '0.5', selected: state.bias === '0.5' ? 'selected' : null }, '0.5, opposite rooms'),
            ]),
            h('label.small', { for: 'skills-source', text: 'Visits' }),
            h('select', { id: 'skills-source', onchange: (e) => { state.source = e.target.value; state.edited = false; if (state.mode) apply(state.mode, state.tie, null, false); else redraw(); } }, [
              h('option', { value: 'plan', selected: state.source === 'plan' ? 'selected' : null }, 'Exact plan'),
              h('option', { value: 'sample', selected: state.source === 'sample' ? 'selected' : null }, 'Seeded sample'),
            ]),
            h('label.small', { for: 'skills-seed', text: 'Seed' }),
            h('input', { id: 'skills-seed', type: 'number', value: state.seed, onchange: (e) => { state.seed = e.target.value; state.source = 'sample'; state.edited = false; if (state.mode) apply(state.mode, state.tie, null, false); else redraw(); } }),
            h('label.small', { for: 'skills-alpha', text: 'Smoothing' }),
            h('select', { id: 'skills-alpha', onchange: (e) => { state.alpha = e.target.value; if (state.mode) apply(state.mode, state.tie, state.edited ? state.counts : null, state.edited); else redraw(); } }, [
              h('option', { value: '0', selected: state.alpha === '0' ? 'selected' : null }, '0'),
              h('option', { value: '1', selected: state.alpha === '1' ? 'selected' : null }, '1'),
              h('option', { value: '8', selected: state.alpha === '8' ? 'selected' : null }, '8'),
            ]),
            h('label.small', { for: 'skills-updates', text: 'Gradient steps' }),
            h('select', { id: 'skills-updates', onchange: (e) => { state.updates = e.target.value; if (state.mode) apply(state.mode, state.tie, state.edited ? state.counts : null, state.edited); else redraw(); } }, [
              h('option', { value: '1', selected: state.updates === '1' ? 'selected' : null }, '1'),
              h('option', { value: '4', selected: state.updates === '4' ? 'selected' : null }, '4'),
            ]),
          ]),
          h('div.row', null, S.SKILLS.flatMap((skill) => S.ROOMS.map((room) => h('label.small', null, [
            NAME[skill] + ' ' + room + ' ',
            h('input.count', {
              id: 'skills-n-' + skill + '-' + room, type: 'number', min: '0', step: '1', value: String(shown[skill][room]),
              onchange: (e) => {
                const next = S.cloneCounts(shown);
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || value < 0) return;
                next[skill][room] = value;
                state.edited = true;
                state.counts = next;
                if (state.mode) apply(state.mode, state.tie, next, true);
                else redraw();
              },
            }),
          ])))),
          h('div.row', { id: 'skills-repairs' }, [
            h('button.btn' + (state.mode === 'discriminator' && !state.edited && state.bias === '0' ? '' : '.ghost'), { type: 'button', id: 'skills-apply-symmetric', onclick: () => { state.bias = '0'; state.source = 'plan'; apply('discriminator', false, S.exactPlanCounts({ budgetPerSkill: 8, bias: 0 }).counts, true); } }, 'Discriminator, symmetric visits'),
            h('button.btn' + (state.mode === 'shared' && !state.tie ? '' : '.ghost'), { type: 'button', id: 'skills-apply-shared', onclick: () => apply('shared', false, state.edited ? state.counts : null, state.edited) }, 'Shared reward 1'),
            h('button.btn' + (state.mode === 'shared' && state.tie ? '' : '.ghost'), { type: 'button', id: 'skills-apply-tie', onclick: () => apply('shared', true, state.edited ? state.counts : null, state.edited) }, 'Shared reward, west tie'),
            h('button.btn' + (state.mode === 'novelty' ? '' : '.ghost'), { type: 'button', id: 'skills-apply-novelty', onclick: () => apply('novelty', false, state.edited ? state.counts : null, state.edited) }, 'Unique-room bonus'),
            h('button.btn' + (state.mode === 'discriminator' && state.bias === '0.25' && !state.edited ? '' : '.ghost'), { type: 'button', id: 'skills-apply-discriminator', onclick: () => { state.bias = '0.25'; state.source = 'plan'; state.alpha = '1'; state.updates = '4'; apply('discriminator', false, null, false); } }, 'Discriminator on the plan'),
            h('button.btn.ghost', { type: 'button', id: 'skills-swap', onclick: () => apply(state.mode || 'discriminator', state.tie, S.swapSkills(shown), true) }, 'Swap which skill visited'),
          ]));
        if (applied) {
          kids.push(policyPanel(h, 'This update', applied, 'skills-live'));
          if (applied.rewards.fit) kids.push(fitPanel(h, 'Fitted q for this update', applied, 'skills-live-fit'));
          kids.push(infoLine(h, applied.counts, applied.rewards.table));
          if (applied.tieBreak && applied.policies.red.action && applied.policies.blue.action) {
            const follow = S.greedyVisits(applied.policies, S.LESSON.budgetPerSkill);
            if (follow.complete) {
              const again = S.train({ counts: follow.counts, mode: 'discriminator', alpha: Number(state.alpha), prior: S.LESSON.prior, eta: S.LESSON.eta, updates: Number(state.updates), tieBreak: false });
              kids.push(h('p.small', { text: 'Follow-up, labeled separately: ' + follow.interactions + ' new visits from the greedy actions, then a second discriminator fit. These visits are not the ' + applied.interactions + ' visits scored above.' }));
              kids.push(policyPanel(h, 'Discriminator after the follow-up visits', again, 'skills-follow'));
            }
          }
        } else kids.push(h('p.small', { text: 'Choose a reward to update the logits.' }));
        kids.push(h('div.split', null, [
          policyPanel(h, 'Fixed symmetric counterexample', report.sym, 'skills-counterexample'),
          policyPanel(h, 'Fixed plan, discriminator', report.disc, 'skills-default'),
        ]));
        kids.push(h('p.small', { text: 'The symmetric counterexample is the same four-and-four table every time. Its reward is 0, so the gradient does not invent a split. The fixed plan is the lesson default: smoothing 1, four gradient steps, step size 1, 16 visits.' }));
      }
      if (explain) {
        kids.push(h('h3', { text: '5. Explain' }),
          choice(h, explain, state.explain, (i) => { state.explain = i; if (hooks.recordAnswer) hooks.recordAnswer(explain.id, i, !!explain.options[i].correct); redraw(); }),
          h('button.btn', { id: 'skills-complete', type: 'button', disabled: !explainOk, onclick: () => { if (explainOk && hooks.complete) hooks.complete(); redraw(); } }, hooks.done && hooks.done() ? 'Lesson complete' : 'Record this measurement'),
          h('details', null, [h('summary', { text: 'Toy assumptions' }),
            h('p.small', { text: 'Two skills, two rooms, deterministic actions. Natural log. Prior fixed at 1/2. Smoothing adds the same pseudo-count to every skill in every room, including a room with no visits. With smoothing, that empty room has q = 1/2, so a skill can score higher there than in a room the other skill dominates. A room with smoothing 0 and no visits has no finite q, and the update does not move. The policy is a softmax of two logits, initialized at 0. The objective is the expected reward of that softmax. The gradient is exact for that objective. There is no action-entropy bonus. Visits are an exploration plan or a seeded sample, not a rollout of a repaired path. The mutual information on the page is the mutual information of the counted visits. It is not the mutual information of the policy, and a smoothed q makes the average reward a different number. Soft actor-critic, a neural discriminator, and the paper\'s robot skills are not in this table. The slide also names Gregor et al., Variational Intrinsic Control (2016). This lesson does not learn the prior.' })]));
        const nxt = hooks.next ? hooks.next() : null;
        if (hooks.done && hooks.done() && nxt) kids.push(h('button.btn', { id: 'skills-next', type: 'button', onclick: () => hooks.openNext && hooks.openNext() }, 'Next level: ' + nxt.title));
      }
      body.replaceChildren.apply(body, kids);
    };
    const rules = h('section.card.game-rules', { id: 'skills-rules' }, [
      h('h3', { text: 'Game rules · Two skills' }),
      h('dl', null, [
        row(h, 'Skills', 'Red and blue. The prior p(skill) is 1/2.'),
        row(h, 'Rooms', 'West and east. The west action enters west. The east action enters east.'),
        row(h, 'Discriminator', 'q(skill|room) = (visits + smoothing) / (room visits + 2 smoothing).'),
        row(h, 'Reward', 'log q(skill|room) - log p(skill). A shared reward of 1 and a unique-room bonus are other buttons.'),
        row(h, 'Update', 'Softmax policy gradient on the expected reward, from zero logits. The fit does not change the logits.'),
        row(h, 'Pass this challenge', lesson.goal.text),
      ]),
    ]);
    lab.replaceChildren(rules, h('section.card', null, [
      h('h3', { text: 'What is measured' }),
      h('p.small', { text: 'Visits, q, the reward, the logits after the stated steps, and the greedy room. A symmetric count stays at reward 0.' }),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }

  window.BBSKILLS_LEVEL = api;
})(window.CONTENT, window.BBSKILLS);
