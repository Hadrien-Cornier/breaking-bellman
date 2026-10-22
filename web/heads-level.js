// Discrete bins and continuous regression on one shared chunk.
// The counts live in src/agents/heads.js. This file does not import another lesson.
(function (C, H) {
  'use strict';
  if (!C || !H || !H.score || !H.refine) throw new Error('heads lesson requires CONTENT and BBHEADS');
  C.worldNames.heads = 'Two corners';
  const lessonGoal = 'See the average jerk fall below both demonstrations, a missing pair whose coordinates are each plausible, a conditional pass that removes that pair, a pass that does not, and a straight line whose jerk ratio is undefined.';
  const level = {
    id: 'heads', custom: true, phase: 5, world: 'heads', title: 'Average the corner, or keep it', focus: [],
    intro: 'Two demonstrations share a start. One goes north, then east. The other goes east, then north. Continuous regression returns their coordinate-wise average, the minimizer of squared error. Discrete regression bins each coordinate on its own. This is an illustrative toy with 8 bins. The paper uses 512. The numbers here are computed on these chunks, not copied from a robot benchmark.',
    goal: { text: lessonGoal },
  };
  const at = C.levels.findIndex((item) => item.id === 'twoways');
  if (at >= 0) C.levels.splice(at + 1, 0, level);
  else C.levels.push(level);
  if (!C.phases.some((phase) => phase.n === 5)) C.phases.push({ n: 5, title: 'The robotics frontier (flow policies, Q-planning, residuals)' });

  const QUOTE = 'Thus, jerk ratio of R_jerk = 1 means that the learned policy\u2019s jerk matches the ground-truth jerk on a training example; R_jerk < 1 means jerk is underestimated, so that the policy has oversmoothed the training data with respect to time.';
  const FACTOR = 'We refer to this failure to preserve dependencies between token choices as factorization error. This may occur even when every token marginal is learned correctly, because the product of the marginals need not recover the joint distribution of demonstrated chunks.';
  const QUESTIONS = {
    predict: {
      id: 'heads-p',
      prompt: 'Both heads read the same two chunks. The continuous head outputs their average. What is that average?',
      options: [
        { text: 'The average is a third chunk. Its jerk is lower than both demonstrations, and it is not a coin flip between them.', correct: true },
        { text: 'The average picks one demonstration, so its jerk matches that demonstration.', correct: false },
        { text: 'Eight bins are the paper\u2019s 512-bin robot result, so the average jerk is 7% of an expert.', correct: false },
      ],
    },
    diagnose: {
      id: 'heads-d',
      prompt: 'Command 2 can land on a pair that neither demonstration used. What failed, and what did not?',
      options: [
        { text: 'Command 2 can pair x from one path with y from the other. That product is not the average. The low jerk is a separate fact.', correct: true },
        { text: 'The missing pair is the average. Smoothing and factorization are the same error.', correct: false },
        { text: 'The value 1 sits between bins, so the missing pair is only rounding.', correct: false },
      ],
    },
    explain: {
      id: 'heads-x',
      prompt: 'Which statement matches the passes you ran, including the straight line?',
      options: [
        { text: 'Five more independent passes leave the missing pair. Conditioning on the previous command of the same coordinate also leaves it. Expert jerk 0 makes the ratio undefined. Conditioning y on x removes the pair at that command, and a later pass on the previous pair is what clears the whole chunk.', correct: true },
        { text: 'More independent passes remove the missing pair, and a zero expert jerk is reported as 0.', correct: false },
        { text: 'Conditioning each coordinate on its own previous command removes every missing pair and every stitched chunk.', correct: false },
      ],
    },
  };
  const state = { step: 0, picks: {}, finished: false, score: null, base: null, runs: {}, line: null, smooth: null };
  let hooks = {};
  let redraw = null;

  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function fmt(x) {
    if (x == null || !Number.isFinite(x)) return 'undefined';
    return (Math.round(x * 10000) / 10000).toFixed(4);
  }
  function attr(x) {
    if (x == null || !Number.isFinite(x)) return 'undefined';
    return String(Math.round(x * 1e9) / 1e9);
  }
  function close(a, b) { return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9; }
  function chunkText(chunk) {
    return chunk.map((row) => row.map((value) => Number.isInteger(value) ? String(value) : String(value)).join(',')).join('   ');
  }
  function ready() {
    const base = state.base;
    const coord = state.runs.coordinate;
    const redrawn = state.runs.redraw;
    const time = state.runs.time;
    const pair = state.runs.pair;
    if (!state.score || !state.score.meanBelowAll || !base || !coord || !redrawn || !time || !pair || !state.line || !state.smooth) return false;
    if (!(coord.pairInvalid === 0 && coord.chunkInvalid > 0)) return false;
    if (!(redrawn.steps >= 5 && close(redrawn.pairInvalid, base.pairInvalid) && close(redrawn.chunkInvalid, base.chunkInvalid))) return false;
    if (!(close(time.pairInvalid, base.pairInvalid) && base.pairInvalid > 0 && time.chunkInvalid > 0)) return false;
    if (!(pair.chunkInvalid === 0 && pair.pairInvalid === 0)) return false;
    if (!(state.line.ratios.every((ratio) => ratio === null) && state.line.meanJerk === 0)) return false;
    if (!(state.smooth.binMse > state.smooth.regressionMse && state.smooth.ratios.every((ratio) => ratio === null) && state.smooth.binJerks[0] > 0)) return false;
    const pick = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
    return !!(pick && pick.correct);
  }
  function missing() {
    const items = [];
    if (!state.score) items.push('score the shared chunks');
    if (!state.runs.coordinate) items.push('condition y on x');
    if (!state.runs.redraw) items.push('repeat the independent draw');
    if (!state.runs.time) items.push('condition each coordinate on its own past');
    if (!state.runs.pair) items.push('condition the pair on the previous pair');
    if (!state.line) items.push('score the straight line');
    if (!state.smooth) items.push('score the smooth ramp');
    const pick = QUESTIONS.explain.options[state.picks[QUESTIONS.explain.id]];
    if (!pick || !pick.correct) items.push('answer the explanation');
    return items;
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'heads', sentenceName: 'Average or bin a shared chunk', mode: 'campaign',
      level: 'Average the corner, or keep it',
      knobs: { bins: H.BINS, paperBins: H.PAPER_BINS },
      words: {}, idleWords: {}, discovered: [],
      lastRun: state.score ? { seeds: 1, steps: state.score.commands, symptoms: [], summary: 'Mean jerk ' + fmt(state.score.meanJerk) + '.' } : null,
    }),
    run() {
      state.score = H.score(H.CORNERS);
      state.base = H.refine(H.CORNERS, 'independent', 0);
      advance(2);
      if (redraw) redraw();
      return state.score;
    },
    mount(pane, lab, passed) {
      hooks = passed || {};
      state.step = hooks.step ? hooks.step() : 0;
      state.finished = hooks.done ? hooks.done() : false;
      state.picks = {};
      for (const q of Object.values(QUESTIONS)) {
        const prev = hooks.answer ? hooks.answer(q.id) : null;
        if (prev) state.picks[q.id] = prev.choice;
      }
      if (state.step >= 2 && !state.score) {
        state.score = H.score(H.CORNERS);
        state.base = H.refine(H.CORNERS, 'independent', 0);
      }
      const body = hWrap(hooks.h);
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const h = hooks.h;
        const lessonNow = C.levels.find((item) => item.id === 'heads');
        const liveScore = H.score(H.CORNERS);
        const liveBase = H.refine(H.CORNERS, 'independent', 0);
        function questionBlock(q, onAnswer) {
          const picked = state.picks[q.id];
          return h('div.mc', { id: q.id }, [
            h('p', { text: q.prompt }),
            ...q.options.map((opt, index) => h('button.opt' + (picked === index ? '.picked' : '') + (picked === index ? (opt.correct ? '.right' : '.wrong') : ''), {
              type: 'button',
              onclick: () => {
                state.picks[q.id] = index;
                if (hooks.record) hooks.record(q.id, index, !!opt.correct);
                onAnswer();
                redraw();
              },
            }, [
              h('span', { text: opt.text }),
              picked === index ? h('span.why', { role: 'status', text: (opt.correct ? 'Sound chain. ' : '') + why(q.id, index, liveScore, liveBase) }) : null,
            ])),
          ]);
        }
        function control(id, label, pressed, onclick) {
          return h('button.btn' + (pressed ? '' : '.ghost'), {
            id, type: 'button', 'aria-pressed': pressed ? 'true' : 'false', onclick,
          }, label);
        }
        function runRefine(kind, steps) {
          state.runs[kind] = H.refine(H.CORNERS, kind, steps);
          advance(4);
          redraw();
        }
        const kids = [
          h('div.eyebrow', { text: 'Phase 5 · Level ' + (C.levels.indexOf(lessonNow) + 1) + ' · Two corners' }),
          h('h2', { text: lessonNow.title }),
          h('p', { text: lessonNow.intro }),
          h('p', { text: 'North then east is ' + chunkText(H.CORNERS[0]) + '. East then north is ' + chunkText(H.CORNERS[1]) + '. Command 2 is the second pair. On these values, 8 uniform bins centered on the integers from 0 through 7 reconstruct each demonstration exactly. That is not evidence about precision in general.' }),
          h('p', { id: 'heads-quote', text: QUOTE }),
          h('p', { text: 'Yi, Dasgupta, Zhang, Sreenath, Qu, Chen, Simchowitz, and Shi (2026), When Do Discrete Actions Make Good Continuous Controllers?, arXiv:2610.20429, Section 3, after equation (3.1). ' + FACTOR + ' Section 4.' }),
          h('p', null, [
            'Paper: ',
            h('a', { href: 'https://arxiv.org/abs/2610.20429', target: '_blank', rel: 'noopener' }, 'arXiv:2610.20429'),
            '. Project page: ',
            h('a', { href: 'https://iscoyizj.github.io/discrete-action-website/', target: '_blank', rel: 'noopener' }, 'iscoyizj.github.io/discrete-action-website'),
            '. The project page labels the RoboCasa median jerk ratio of continuous regression as 0.07 on 3,000 held-out chunks. Appendix E.1 reports per-source medians for that head from 0.036 to 0.286 and omits zero target denominators. This page does not print those measurements as its result.',
          ]),
          h('p', { text: 'CS 285 lecture 3 asks whether a continuous action can be discretized, including autoregressive discretization. That count-table lesson is separate. This page does not use its id, and it does not claim to cover the lecture.' }),
          h('div.step' + (state.step === 0 ? '.active' : '.done'), { id: 'heads-step-predict' }, [
            h('span.num', { text: 'Step 1' }),
            h('h3', { text: 'Predict before you score' }),
            questionBlock(QUESTIONS.predict, () => advance(1)),
          ]),
        ];
        if (state.step >= 1) kids.push(h('div.step' + (state.step === 1 ? '.active' : '.done'), { id: 'heads-step-run' }, [
          h('span.num', { text: 'Step 2' }),
          h('h3', { text: 'Score both heads on the shared chunks' }),
          h('p', { text: 'One pass. The continuous head averages the two chunks. The discrete head takes the product of the per-coordinate counts, with 8 bins. Both read the same 2 demonstrations and the same 6 commands.' }),
          h('button.btn', { id: 'heads-run', type: 'button', onclick: () => api.run() }, 'Score both heads'),
        ]));
        if (state.score && state.base) kids.push(readout(h, state.score, state.base, 'corners'));
        if (state.step >= 2) kids.push(h('div.step' + (state.step === 2 ? '.active' : '.done'), { id: 'heads-step-diagnose' }, [
          h('span.num', { text: 'Step 3' }),
          h('h3', { text: 'Diagnose' }),
          questionBlock(QUESTIONS.diagnose, () => advance(3)),
        ]));
        if (state.step >= 3) kids.push(h('div.step' + (state.step === 3 ? '.active' : '.done'), { id: 'heads-step-repair' }, [
          h('span.num', { text: 'Step 4' }),
          h('h3', { text: 'Run a pass, and run one that does not fix the pair' }),
          h('p', { text: 'Each button reads the same two chunks again. The step count is the number of times that pass is applied. A stored improvement is not substituted for the count.' }),
          h('div.heads-controls', { id: 'heads-controls' }, [
            control('heads-coordinate', 'Condition y on x, 1 step', !!state.runs.coordinate, () => runRefine('coordinate', 1)),
            control('heads-redraw', 'Repeat the independent draw, 5 steps', !!state.runs.redraw, () => runRefine('redraw', 5)),
            control('heads-time', 'Condition each coordinate on its own previous command, 1 step', !!state.runs.time, () => runRefine('time', 1)),
            control('heads-pair', 'Condition the pair on the previous pair, 1 step', !!state.runs.pair, () => runRefine('pair', 1)),
            control('heads-line', 'Score the straight line', !!state.line, () => { state.line = H.score(H.LINE); advance(4); redraw(); }),
            control('heads-smooth', 'Score the smooth ramp', !!state.smooth, () => { state.smooth = H.score(H.SMOOTH); advance(4); redraw(); }),
          ]),
        ]));
        if (state.runs.coordinate) kids.push(refineReadout(h, state.runs.coordinate));
        if (state.runs.redraw) kids.push(refineReadout(h, state.runs.redraw));
        if (state.runs.time) kids.push(refineReadout(h, state.runs.time));
        if (state.runs.pair) kids.push(refineReadout(h, state.runs.pair));
        if (state.line) kids.push(caseReadout(h, state.line, 'line'));
        if (state.smooth) kids.push(caseReadout(h, state.smooth, 'smooth'));
        if (state.step >= 4) {
          const done = ready();
          kids.push(
            h('p.small', { id: 'heads-needed', text: done ? 'The required passes are on the page.' : 'Still needed: ' + missing().join(', ') + '.' }),
            h('div.step' + (state.step === 4 ? '.active' : '.done'), { id: 'heads-step-explain' }, [
              h('span.num', { text: 'Step 5' }),
              h('h3', { text: 'Explain what the passes did' }),
              missing().filter((item) => item !== 'answer the explanation').length
                ? h('p', { text: 'Run every pass, including the straight line and the smooth ramp, before answering.' })
                : questionBlock(QUESTIONS.explain, () => {}),
            ]),
            h('button.btn', {
              id: 'heads-complete', type: 'button',
              disabled: state.finished || !done ? true : null,
              onclick: () => {
                if (!ready() || !hooks.complete) return;
                hooks.complete();
                state.finished = true;
                state.step = 5;
                redraw();
              },
            }, state.finished ? 'Lesson complete' : 'Finish lesson'),
          );
        }
        const next = C.levels[C.levels.indexOf(lessonNow) + 1];
        if (state.step >= 5) kids.push(next
          ? h('button.btn', { id: 'heads-next', type: 'button', onclick: () => hooks.openLevel && hooks.openLevel(next.id) }, 'Next level: ' + next.title)
          : h('p.small', { id: 'heads-next', text: 'This is the last level in the campaign list. The other levels stay on the map above.' }));
        body.replaceChildren(...kids);
        lab.replaceChildren(h('section.card.game-rules', { id: 'heads-rules' }, [
          h('h3', { text: 'Game rules · Two corners' }),
          h('dl', null, [
            ['Goal', 'Compare one continuous average with one discrete product on the same two chunks, then run the passes that do and do not repair the product.'],
            ['Reward each step', 'No environment reward. The meter is jerk, and the second meter is the probability of a pair or a chunk that is absent from the demonstrations.'],
            ['Equation', 'J is the average Euclidean norm of a[h+3] - 3 a[h+2] + 3 a[h+1] - a[h], over the 3 windows in a 6-command chunk. No division by time. R = J(prediction) / J(demonstration) when the demonstration jerk is positive. When it is 0, R is undefined and is not computed.'],
            ['Bins', 'Teaching grid: 8 uniform bins on [-0.5, 7.5], centers at the integers 0 through 7. The paper states B = 512 unless otherwise noted. This quantizer does not use 512.'],
            ['Budget', 'The shared input is 2 chunks, 6 commands, 2 coordinates. The average is one pass. Each repair button applies its named conditional the number of times on its label, to that same table.'],
            ['Episode ends', 'There is no episode. A chunk is 6 commands. The straight line and the smooth ramp are separate inputs scored by the same meter.'],
            ['Score', 'Jerk of each demonstration, jerk of the average, the ratio or the word undefined, the missing-pair probability at the worst command, and the probability of a whole chunk that is not one of the demonstrations.'],
            ['Pass this challenge', lessonNow.goal.text],
          ].map(([name, text]) => h('div.rules-row', null, [h('dt', { text: name }), h('dd', { text })]))),
        ]));
      };
      function missingPairs(base) {
        return (base.splitAtoms || []).filter((atom) => !atom.demonstrated && atom.p > 0);
      }
      function readout(h, score, base, name) {
        const misses = missingPairs(base);
        return h('div.heads-readout', {
          id: 'heads-readout', role: 'status', tabindex: '0', 'data-case': name, 'data-illustrative': 'yes',
          'data-mean-jerk': attr(score.meanJerk),
          'data-jerk0': attr(score.expertJerks[0]),
          'data-jerk1': attr(score.expertJerks[1]),
          'data-ratio0': attr(score.ratios[0]),
          'data-ratio1': attr(score.ratios[1]),
          'data-below': score.meanBelowAll ? 'yes' : 'no',
          'data-pair-invalid': attr(base.pairInvalid),
          'data-chunk-invalid': attr(base.chunkInvalid),
          'data-misses': misses.map((atom) => atom.x + ',' + atom.y + '@' + attr(atom.p)).join('|'),
          'data-miss-x': misses[0] ? String(misses[0].x) : 'none',
          'data-miss-y': misses[0] ? String(misses[0].y) : 'none',
          'data-miss-p': misses[0] ? attr(misses[0].p) : 'none',
          'data-bin-mse': attr(score.binMse),
          'data-regression-mse': attr(score.regressionMse),
          'data-bins': String(score.bins),
          'data-demos': String(score.demonstrations),
          'data-commands': String(score.commands),
        }, [
          h('p', { text: 'Illustrative toy. Not a robot benchmark. Bins in this quantizer: ' + score.bins + '. Paper vocabulary, not used here: ' + score.paperBins + '.' }),
          h('p.heads-chunk', { text: 'North then east: ' + chunkText(H.CORNERS[0]) }),
          h('p.heads-chunk', { text: 'East then north: ' + chunkText(H.CORNERS[1]) }),
          h('p.heads-chunk', { text: 'Average: ' + chunkText(score.mean) }),
          h('p', { text: 'Jerk ' + fmt(score.expertJerks[0]) + ' and ' + fmt(score.expertJerks[1]) + '. Average jerk ' + fmt(score.meanJerk) + '. Ratios ' + fmt(score.ratios[0]) + ' and ' + fmt(score.ratios[1]) + '. Lower than both: ' + (score.meanBelowAll ? 'yes' : 'no') + '.' }),
          h('p', { text: 'Squared error of the average against the demonstrations: ' + fmt(score.regressionMse) + '. Squared error of the 8-bin reconstruction: ' + fmt(score.binMse) + '. Zero bin error here means the commands sit on bin centers.' }),
          h('p', { text: misses.length
            ? 'At command ' + (base.splitTime + 1) + ', these pairs are absent from the demonstrations and still have product probability: ' + misses.map((atom) => '(' + atom.x + ', ' + atom.y + ') ' + fmt(atom.p)).join('; ') + '. Each coordinate of each pair appears in a demonstration at that command. Missing-pair probability ' + fmt(base.pairInvalid) + '. Chunk probability outside the two demonstrations: ' + fmt(base.chunkInvalid) + '.'
            : 'No individually plausible missing pair on this input. Missing-pair probability ' + fmt(base.pairInvalid) + '. Chunk probability outside the two demonstrations: ' + fmt(base.chunkInvalid) + '.' }),
        ]);
      }
      function refineReadout(h, result) {
        return h('div.heads-readout', {
          id: 'heads-' + result.kind + '-readout', role: 'status', tabindex: '0',
          'data-kind': result.kind, 'data-steps': String(result.steps), 'data-illustrative': 'yes',
          'data-pair-invalid': attr(result.pairInvalid),
          'data-chunk-invalid': attr(result.chunkInvalid),
          'data-chunk-valid': attr(result.chunkValid),
          'data-demos': String(result.demonstrations),
          'data-commands': String(result.commands),
          'data-trace': String(result.trace.length),
        }, [
          h('p', { text: result.kind + ', ' + result.steps + ' step' + (result.steps === 1 ? '' : 's') + ', same ' + result.demonstrations + ' chunks and ' + result.commands + ' commands. Missing-pair probability ' + fmt(result.pairInvalid) + '. Chunk probability outside the demonstrations: ' + fmt(result.chunkInvalid) + '. Trace length ' + result.trace.length + '.' }),
        ]);
      }
      function caseReadout(h, score, name) {
        return h('div.heads-readout', {
          id: 'heads-' + name + '-readout', role: 'status', tabindex: '0', 'data-case': name, 'data-illustrative': 'yes',
          'data-mean-jerk': attr(score.meanJerk),
          'data-jerk0': attr(score.expertJerks[0]),
          'data-ratio0': attr(score.ratios[0]),
          'data-bin-jerk': attr(score.binJerks[0]),
          'data-bin-mse': attr(score.binMse),
          'data-regression-mse': attr(score.regressionMse),
          'data-bins': String(score.bins),
        }, [
          h('p', { text: name === 'line'
            ? 'Straight line. Expert jerk ' + fmt(score.expertJerks[0]) + '. Average jerk ' + fmt(score.meanJerk) + '. Ratio ' + fmt(score.ratios[0]) + '. Bin jerk ' + fmt(score.binJerks[0]) + '. The ratio is not reported as 0 when the expert jerk is 0.'
            : 'Smooth ramp, off the integer centers. Expert jerk ' + fmt(score.expertJerks[0]) + '. Ratio ' + fmt(score.ratios[0]) + '. Average squared error ' + fmt(score.regressionMse) + '. 8-bin squared error ' + fmt(score.binMse) + '. Bin jerk ' + fmt(score.binJerks[0]) + '. On this ramp the bins are the less precise head, and the ratio stays undefined.' }),
        ]);
      }
      redraw();
    },
  };

  function why(id, index, score, base) {
    const lines = {
      'heads-p': [
        'The average is ' + chunkText(score.mean) + '. Its jerk is ' + fmt(score.meanJerk) + ', below ' + fmt(score.expertJerks[0]) + ' and ' + fmt(score.expertJerks[1]) + '. Those ratios are this toy, not 0.07.',
        'Squared error has one minimizer here, the average. It does not draw a demonstration.',
        'The quantizer uses ' + H.BINS + ' bins. ' + H.PAPER_BINS + ' is the paper\u2019s vocabulary and is not this grid.',
      ],
      'heads-d': [
        'The missing pairs at command ' + (base.splitTime + 1) + ' are ' + (base.splitAtoms || []).filter((atom) => !atom.demonstrated && atom.p > 0).map((atom) => '(' + atom.x + ', ' + atom.y + ') ' + fmt(atom.p)).join('; ') + '. The average is a different chunk, and its jerk ratio is a different meter.',
        'Averaging changes the path. It does not build the product of the two marginals.',
        '1 is a bin center on this grid. The reconstruction error of the demonstrations is ' + fmt(score.binMse) + '.',
      ],
      'heads-x': [
        'The readouts keep the independent missing-pair probability after 5 redraws, keep it after the time pass, drop it after conditioning y on x, and drop the whole-chunk error only after the pair pass. The line ratio reads undefined.',
        'The 5-step readout matches the one-pass product. A zero denominator is not turned into 0.',
        'The time pass still has a missing pair at the split command. It is a real pass, and it is not sufficient here.',
      ],
    };
    return lines[id][index];
  }
  function hWrap(h) { return h('div.card.stack', { id: 'heads-lesson' }); }
  window.BBHEADS_LEVEL = api;
})(window.CONTENT, window.BBHEADS);
