// Lecture 3 two-bit counts. The sampler lives in src/agents/autoreg.js.
// Goal cloning is a different lesson and is not imported.
(function (C, A) {
  'use strict';
  if (!C || !A || !A.compare || !A.querySecond) throw new Error('BBAUTOREG missing');
  if (!C.phases.some((p) => p.n === 0)) C.phases.unshift({ n: 0, title: 'Imitation before reward' });
  C.worldNames.autoreg = 'Two bits';
  const goalText = 'Fit these pair counts once. The separate-bit draw puts probability 1/2 on 01 or 10. The conditional draw puts probability 0 on those pairs and keeps probability 1/2 on 11.';
  const lesson = {
    id: 'autoreg', custom: true, phase: 0, world: 'autoreg', title: 'Sample the second bit given the first', focus: [],
    intro: 'An action is two bits. The notes contain 00 three times and 11 three times. The pairs 01 and 10 have count zero. Each bit, on its own, is one half. Drawing the bits separately spends half the draws on pairs the notes never contain. Drawing the second bit from the row of the first bit does not.',
    goal: { text: goalText },
  };
  if (!C.levels.some((l) => l.id === 'autoreg')) {
    const goalsAt = C.levels.findIndex((l) => l.id === 'goals');
    if (goalsAt >= 0) C.levels.splice(goalsAt + 1, 0, lesson);
    else {
      const shiftAt = C.levels.findIndex((l) => l.id === 'shift');
      if (shiftAt >= 0) C.levels.splice(shiftAt + 1, 0, lesson);
      else C.levels.unshift(lesson);
    }
  }

  const state = {
    pred: null, diag: null, explain: null,
    ran: null, repaired: null, unsupported: null, swap: null, custom: null,
    controls: { '00': 3, '01': 0, '10': 0, '11': 3, seed: 11, draws: 2000 },
    controlError: '', pairRead: '',
  };
  let redraw = null;
  const css = '#autoreg-lesson,#autoreg-rules{max-width:100%;overflow-wrap:anywhere}#autoreg-lesson .btn,#autoreg-lesson .opt,#autoreg-lesson .pair,#autoreg-lesson input,#autoreg-rules .btn{min-height:44px}#autoreg-lesson .nums{font-family:var(--font-mono);font-size:.82rem}#autoreg-lesson .pairs{display:grid;grid-template-columns:1fr 1fr;gap:8px}#autoreg-lesson .pair{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px}#autoreg-lesson .arm{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);min-width:0}#autoreg-lesson .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}#autoreg-lesson .controls label{flex:1 1 120px;min-width:0;display:flex;flex-direction:column;gap:4px;font-size:.85rem}#autoreg-lesson .controls input{width:100%;box-sizing:border-box}#autoreg-lesson .row{display:flex;flex-wrap:wrap;gap:8px}';

  function ensureCss() {
    if (document.getElementById('autoreg-css')) return;
    const style = document.createElement('style');
    style.id = 'autoreg-css';
    style.textContent = css;
    document.head.append(style);
  }

  function choice(h, q, picked, onPick) {
    return h('div.mc', { id: q.id }, [h('p', { text: q.prompt })].concat(q.options.map((o, i) => h('button.opt' + (picked === i ? '.picked' : ''), {
      type: 'button', 'aria-pressed': picked === i ? 'true' : 'false',
      onclick: () => onPick(i),
    }, [
      h('span.res', { text: o.result }),
      picked === i ? h('span.why', { html: (o.correct ? '<b>Sound chain.</b> ' : '<b>Not this one.</b> ') + o.why }) : null,
    ]))));
  }

  const PREDICT = {
    id: 'autoreg-p',
    prompt: 'Each bit is drawn from its own count, ignoring the other bit. The notes are 00 three times and 11 three times. How often is the pair one the notes never contain?',
    options: [
      { result: 'Half the time. 01 and 10 were never written, and each bit is still one half.', correct: true,
        why: 'The marginal of each bit is 3/6. The product puts probability 1/4 on 01 and 1/4 on 10.' },
      { result: 'Never. A bit that is one half can only rebuild 00 and 11.', correct: false,
        why: 'Each marginal is one half, and the two draws do not read each other. Their product includes the empty pairs.' },
      { result: 'Always 00. The two bits are tied, so each bit keeps the value 0.', correct: false,
        why: 'A tie in a marginal is a fair coin. Preferring 0 on one bit and 1 on the other is a different rule, and this page samples instead.' },
    ],
  };
  const DIAGNOSE = {
    id: 'autoreg-d',
    prompt: 'Why do the separate coins write 01 and 10?',
    options: [
      { result: 'Each bit used only its own marginal. Both marginals are one half, so the product spends half its mass on pairs with count zero.', correct: true,
        why: 'The unseen-pair probability is computed from those two marginals. It is 1/2 before any draw is counted.' },
      { result: 'The sampler took an argmax and broke the tie a different way for each bit.', correct: false,
        why: 'Both bits use one bucket rule. Equal counts stay a coin. An argmax that prefers different values would ignore the seed.' },
      { result: 'The notes contain 01 and 10, so those pairs are legal.', correct: false,
        why: 'The notes are 00 three times and 11 three times. The counts of 01 and 10 are zero.' },
    ],
  };
  const EXPLAIN = {
    id: 'autoreg-x',
    prompt: 'What does sampling the second bit from the first bit row keep?',
    options: [
      { result: '00 and 11 each keep probability 1/2. 01 and 10 stay at probability 0.', correct: true,
        why: 'The first bit is still a fair coin. Given 0 the second bit count is 3 and 0. Given 1 it is 0 and 3. The empty pairs get no mass, and 11 is still half.' },
      { result: 'It always returns 00, the first pair in the list.', correct: false,
        why: 'A decoder that always returns 00 drops 11. The conditional draw still emits 11 half the time, because the first bit is sampled.' },
      { result: 'It breaks the tie so the two bits disagree, and that writes 01.', correct: false,
        why: 'The conditional rows are not a disagreement rule. 01 has count zero, so its conditional probability is 0.' },
    ],
  };

  function showFrac(p) {
    if (!p) return 'unsupported';
    if (p.den === 1) return String(p.num);
    return p.num + '/' + p.den;
  }
  function countText(counts) {
    return '00 ' + counts['00'] + ', 01 ' + counts['01'] + ', 10 ' + counts['10'] + ', 11 ' + counts['11'];
  }
  function probText(dist) {
    if (!dist || !dist.ok) return dist && dist.reason || 'unsupported';
    return A.PAIRS.map((key) => key + ' ' + showFrac(dist.pairs[key])).join(', ')
      + '. Unseen-pair probability ' + showFrac(dist.invalid) + '.';
  }
  function marginalText(model) {
    if (!model || !model.defined) return model && model.reason || 'The marginals are undefined.';
    return 'First bit 0 is ' + showFrac(model.marginal.first[0].p)
      + ', first bit 1 is ' + showFrac(model.marginal.first[1].p)
      + '. Second bit 0 is ' + showFrac(model.marginal.second[0].p)
      + ', second bit 1 is ' + showFrac(model.marginal.second[1].p) + '.';
  }

  function arm(h, pack, id, title, parts) {
    if (!pack) return null;
    const showInd = parts !== 'conditional';
    const showCond = parts !== 'independent';
    const kids = [h('h4', { text: title })];
    if (!pack.ok) kids.push(h('p', { id: id + '-error', text: pack.reason || 'This setting was not drawn.' }));
    else {
      kids.push(h('p.nums', { id: id + '-marginal', text: marginalText(pack.model) }));
      if (showInd) {
        kids.push(h('p.nums', { id: id + '-theory-independent', text: 'Theoretical independent, from the counts: ' + probText(pack.theoretical.independent) }));
        kids.push(h('p.nums', { id: id + '-empirical-independent', text: 'Empirical independent, seed ' + pack.empirical.independent.seed + ', ' + pack.empirical.independent.draws + ' draws: ' + countText(pack.empirical.independent.counts) + '.' }));
      }
      if (showCond) {
        kids.push(h('p.nums', { id: id + '-theory-conditional', text: 'Theoretical conditional, from the counts: ' + probText(pack.theoretical.conditional) }));
        kids.push(h('p.nums', { id: id + '-empirical-conditional', text: 'Empirical conditional, seed ' + pack.empirical.conditional.seed + ', ' + pack.empirical.conditional.draws + ' draws: ' + countText(pack.empirical.conditional.counts) + '.' }));
      }
    }
    return h('div.arm', { id }, kids);
  }

  function controlsOf() {
    const c = state.controls;
    return {
      counts: { '00': c['00'], '01': c['01'], '10': c['10'], '11': c['11'] },
      seed: c.seed,
      draws: c.draws,
    };
  }

  function numField(h, key, label, min, max) {
    return h('label', null, [
      label,
      h('input', {
        id: 'autoreg-' + key, type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric',
        value: String(state.controls[key]), 'aria-label': label,
        oninput: (e) => {
          state.controls[key] = Number(e.target.value);
          state.custom = null;
          state.controlError = '';
        },
      }),
    ]);
  }

  function controlForm(h) {
    return h('div.stack', null, [
      h('div.controls', null, [
        numField(h, '00', 'Count of 00', 0, 40),
        numField(h, '01', 'Count of 01', 0, 40),
        numField(h, '10', 'Count of 10', 0, 40),
        numField(h, '11', 'Count of 11', 0, 40),
        numField(h, 'seed', 'Seed', 0, 1000000),
        numField(h, 'draws', 'Draws', 1, 20000),
      ]),
      state.controlError ? h('p.small', { id: 'autoreg-custom-error', text: state.controlError }) : null,
      h('button.btn', {
        id: 'autoreg-sample-custom', type: 'button',
        onclick: () => {
          const pack = A.compare(controlsOf());
          state.custom = pack;
          state.controlError = pack.ok ? '' : (pack.reason || 'This setting was not drawn.');
          redraw();
        },
      }, 'Sample this count table'),
    ]);
  }

  function honestOk(pack, unsupported, swap) {
    if (!pack || !pack.ok || !unsupported || unsupported.defined || unsupported.sample != null) return false;
    if (!swap || !swap.ok) return false;
    const cond = pack.theoretical.conditional;
    const swapped = swap.theoretical.conditional;
    return cond.pairs['00'].num === 1 && cond.pairs['00'].den === 2
      && cond.pairs['11'].num === 1 && cond.pairs['11'].den === 2
      && cond.pairs['01'].num === 0 && cond.pairs['10'].num === 0
      && cond.invalid.num === 0
      && swapped.pairs['01'].num === 1 && swapped.pairs['01'].den === 2
      && swapped.pairs['10'].num === 1 && swapped.pairs['10'].den === 2
      && swapped.invalid.num === 0
      && pack.empirical.conditional.counts['11'] > 0
      && pack.empirical.conditional.counts['00'] > 0
      && pack.empirical.conditional.counts['01'] === 0
      && pack.empirical.conditional.counts['10'] === 0;
  }

  A.cancel = function () {};
  A.state = function () {
    const pack = state.repaired || state.ran;
    return {
      world: 'autoreg', sentenceName: 'Conditional count of the second bit', mode: 'campaign', level: lesson.title,
      knobs: { seed: A.LESSON.seed, draws: A.LESSON.draws },
      words: {}, idleWords: {}, discovered: [],
      lastRun: pack && pack.ok ? {
        seeds: 1, steps: pack.empirical.conditional.draws, symptoms: [],
        summary: {
          conditional11: pack.empirical.conditional.counts['11'],
          conditional00: pack.empirical.conditional.counts['00'],
          independentInvalid: pack.theoretical.independent.invalid,
        },
      } : null,
    };
  };
  A.run = function () {
    const pack = A.lesson();
    state.ran = pack.lesson;
    state.repaired = pack.lesson;
    state.unsupported = pack.unsupported;
    state.swap = pack.swap;
    if (redraw) redraw();
    return pack;
  };

  A.mount = function (pane, lab, api) {
    ensureCss();
    const saved = (id) => api.answer ? api.answer(id) : null;
    const p0 = saved('autoreg-p'); const d0 = saved('autoreg-d'); const x0 = saved('autoreg-x');
    if (p0) state.pred = p0.choice;
    if (d0) state.diag = d0.choice;
    if (x0) state.explain = x0.choice;
    const step0 = api.step ? api.step() : 0;
    if (step0 >= 2 && !state.ran) state.ran = A.compare(A.LESSON);
    if (step0 >= 4 && !state.repaired) {
      const pack = A.lesson();
      state.ran = state.ran || pack.lesson;
      state.repaired = pack.lesson;
      state.unsupported = pack.unsupported;
      state.swap = pack.swap;
    }
    const h = api.h;
    const body = h('div.card.stack', { id: 'autoreg-lesson' });
    pane.append(body);
    function advance(n) { if (api.markStep) api.markStep(n); }
    function readPair(key) {
      state.pairRead = 'Pair ' + key + ' has count ' + A.LESSON.counts[key] + '.';
      redraw();
    }
    redraw = function () {
      if (!body.isConnected) return;
      const n = C.levels.findIndex((l) => l.id === 'autoreg') + 1;
      const step = api.step ? api.step() : 0;
      const predicted = state.pred === 0;
      const diagnosed = state.diag === 0;
      const repairOk = honestOk(state.repaired, state.unsupported, state.swap);
      const explained = state.explain === 0 && repairOk;
      const kids = [
        h('div.eyebrow', { text: 'Phase 0 · Level ' + n + ' · Two bits' }),
        h('h2', { text: lesson.title }),
        h('p', { text: lesson.intro }),
        h('p.small', { text: 'CS 285 lecture 3, Spring 2026, has the heading Can we discretize continuous action spaces? and the heading Autoregressive discretization. This lesson fits a count of two-bit actions and samples the second bit from the first. The slide wording is not copied here. The sequence model drawn on that slide is not this page.' }),
        h('p.small', null, [
          h('a', { href: 'https://rail.eecs.berkeley.edu/deeprlcourse/static/slides/lec-3.pdf', target: '_blank', rel: 'noopener' }, 'CS 285 lecture 3 slides'),
        ]),
        h('p', { text: 'Both bits use the same bucket rule. Equal counts stay a coin. This comparison samples. It does not take an argmax, and it does not break a tie one way for the first bit and another way for the second.' }),
        h('h3', { text: 'The notes' }),
        h('div.pairs', { id: 'autoreg-notes' }, A.PAIRS.map((key) => h('button.pair', {
          type: 'button', id: 'autoreg-pair-' + key, onclick: () => readPair(key),
        }, key + ' count ' + A.LESSON.counts[key]))),
        state.pairRead ? h('p.nums', { id: 'autoreg-pair-read', role: 'status', text: state.pairRead }) : null,
        h('h3', { text: '1. Predict' }),
        choice(h, PREDICT, state.pred, (i) => { state.pred = i; if (api.recordAnswer) api.recordAnswer(PREDICT.id, i, !!PREDICT.options[i].correct); advance(1); redraw(); }),
      ];
      if (step >= 1 || state.pred != null) {
        kids.push(h('h3', { text: '2. Draw each bit from its marginal' }),
          h('p', { text: 'Fit the same six notes. Draw bit 1 from its marginal and bit 2 from its own marginal. The seed is ' + A.LESSON.seed + ' and the draw count is ' + A.LESSON.draws + '. The unseen-pair probability below is the product of the counts. The line under it is what this seed emitted.' }),
          h('button.btn', { id: 'autoreg-run', type: 'button', disabled: predicted ? null : 'disabled', onclick: () => { state.ran = A.compare(A.LESSON); advance(2); redraw(); } }, 'Draw each bit on its own'));
        if (state.ran) kids.push(arm(h, state.ran, 'autoreg-independent', 'Separate bits', 'independent'));
      }
      if (state.ran && state.ran.ok && (step >= 2 || state.ran)) {
        kids.push(h('h3', { text: '3. Diagnose' }),
          choice(h, DIAGNOSE, state.diag, (i) => { state.diag = i; if (api.recordAnswer) api.recordAnswer(DIAGNOSE.id, i, !!DIAGNOSE.options[i].correct); if (state.ran && state.ran.ok) advance(3); redraw(); }));
      }
      if (diagnosed && state.ran && state.ran.ok) {
        kids.push(h('h3', { text: '4. Sample the second bit given the first' }),
          h('p', { text: 'Use the same pair counts. Draw the first bit from its marginal, then the second bit from that bit row. Also ask for a first bit the notes do not contain, and swap which pairs were written.' }),
          h('div.row', { id: 'autoreg-repairs' }, [
            h('button.btn', { id: 'autoreg-repair', type: 'button', onclick: () => {
              const pack = A.lesson();
              state.repaired = pack.lesson;
              state.unsupported = pack.unsupported;
              state.swap = pack.swap;
              if (honestOk(state.repaired, state.unsupported, state.swap)) advance(4);
              redraw();
            } }, 'Sample the second bit given the first'),
          ]),
          controlForm(h),
          state.custom ? arm(h, state.custom, 'autoreg-custom', 'This count table') : null);
        if (state.repaired) {
          kids.push(arm(h, state.repaired, 'autoreg-conditional', 'Second bit given the first, lesson notes'));
          const unsupported = state.unsupported;
          kids.push(h('div.arm', { id: 'autoreg-unsupported' }, [
            h('h4', { text: 'First bit 1 is absent: 00 has 4, 01 has 2, 10 has 0, 11 has 0' }),
            h('p', { id: 'autoreg-unsupported-text', text: unsupported && unsupported.defined
              ? 'A second bit was drawn: ' + unsupported.sample + '. That borrows a row the notes do not have.'
              : 'No second bit was drawn. ' + ((unsupported && unsupported.reason) || 'The prefix is unsupported.') }),
          ]));
          kids.push(arm(h, state.swap, 'autoreg-swap', 'Swapped notes: 01 three times and 10 three times'));
        }
      }
      if (repairOk) {
        kids.push(h('h3', { text: '5. Explain' }),
          choice(h, EXPLAIN, state.explain, (i) => { state.explain = i; if (api.recordAnswer) api.recordAnswer(EXPLAIN.id, i, !!EXPLAIN.options[i].correct); redraw(); }),
          h('button.btn', { id: 'autoreg-complete', type: 'button', disabled: explained ? null : 'disabled', onclick: () => { if (explained && api.complete) api.complete(); redraw(); } }, api.done && api.done() ? 'Lesson complete' : 'Record this measurement'));
        const nxt = api.next ? api.next() : null;
        if (api.done && api.done() && nxt) kids.push(h('button.btn', { id: 'autoreg-next', type: 'button', onclick: () => api.openNext && api.openNext() }, 'Next level: ' + nxt.title));
        else if (api.done && api.done() && !nxt) kids.push(h('p.small', { id: 'autoreg-next', text: 'This is the last level in the campaign list.' }));
      }
      body.replaceChildren.apply(body, kids.filter((node) => node != null));
    };
    lab.replaceChildren(h('section.card.game-rules', { id: 'autoreg-rules' }, [
      h('h3', { text: 'Game rules · Two bits' }),
      h('dl', null, [
        row(h, 'Goal', 'Match the pair counts in the notes. 00 and 11 are written. 01 and 10 are not.'),
        row(h, 'Reward each step', 'No reward. The score is a probability on the four pairs.'),
        row(h, 'Equation', 'Independent: p(b1, b2) = p(b1) p(b2). Conditional: p(b1, b2) = p(b1) p(b2 | b1). Both use the same pair counts. A first bit with count zero has no conditional row.'),
        row(h, 'Episode ends', 'Each method spends the same number of draws from one seed. The theoretical probability is not that draw count.'),
        row(h, 'Score', 'Unseen-pair probability from the counts, then the empirical pair counts from the seed, kept as separate lines.'),
        row(h, 'Pass this challenge', goalText),
      ]),
    ]), h('section.card', null, [
      h('h3', { text: 'What this page is not' }),
      h('p.small', { text: 'A two-bit count. Not a neural tokenizer, not a transformer, and not a comparison of robot action heads. The cartpole bin lesson is a different page.' }),
    ]));
    redraw();
  };

  function row(h, label, text) {
    return h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text: text })]);
  }
})(window.CONTENT, window.BBAUTOREG);
