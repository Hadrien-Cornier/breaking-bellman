// One bright reading. The bound is computed in src/agents/elbo.js from the tables on the page.
(function (C, E) {
  'use strict';
  if (!E || !E.evaluate) throw new Error('BBELBO missing');
  C.worldNames.elbo = 'One bright reading';
  const elboLevel = {
    id: 'elbo', custom: true, phase: 3, world: 'elbo', title: 'A bound that is tight only when the guess matches', focus: [],
    intro: 'The sensor reads bright. The hidden cause is a hall, a lamp, or glare. Glare almost always reads bright, and the prior says glare is rare. A guess that piles onto glare reconstructs the reading and still lowers the bound.',
    goal: { text: 'Score a narrow guess and a different guess, raise the bound with an update that includes KL(q || prior), and name the gap as KL(q || posterior).' },
  };
  const exploreAt = C.levels.findIndex((l) => l.id === 'explore');
  if (exploreAt >= 0) C.levels.splice(exploreAt + 1, 0, elboLevel);
  else C.levels.push(elboLevel);

  const state = {
    weights: E.evenWeights(), nudged: false, predict: null, scores: [], posterior: null,
    diagnose: null, repair: null, bad: null, explain: null, error: '',
  };
  let redraw = null;
  const num = (x) => {
    if (x === Infinity) return 'infinity';
    if (x === -Infinity) return 'negative infinity';
    if (!Number.isFinite(x)) return 'undefined';
    return (Math.round(x * 10000) / 10000).toFixed(4);
  };
  const qText = (q) => E.CAUSES.map((z) => z + ' ' + num(q[z])).join(', ');

  function bump(z, d) {
    const next = Math.max(0, Math.min(60, state.weights[z] + d));
    if (next === state.weights[z]) return;
    state.weights[z] = next;
    state.nudged = true;
    state.error = '';
    redraw();
  }
  function setWeights(map) {
    state.weights = Object.assign({}, map);
    state.nudged = true;
    state.error = '';
    redraw();
  }
  function currentQ() { return E.distribution(state.weights, E.LESSON.causes); }
  function score() {
    let q;
    try { q = currentQ(); }
    catch (e) { state.error = e.message; redraw(); return; }
    state.error = '';
    state.scores.push(E.evaluate(E.LESSON, q));
    if (state.scores.length > 12) state.scores.shift();
    redraw();
  }
  function showPosterior() {
    state.posterior = E.evaluate(E.LESSON, E.posterior(E.LESSON));
    redraw();
  }
  function repair() {
    try { state.repair = E.optimize(E.LESSON, currentQ(), E.REPAIR); state.error = ''; }
    catch (e) { state.error = e.message; }
    redraw();
  }
  function badUpdate() {
    try { state.bad = E.optimize(E.LESSON, currentQ(), E.RECONSTRUCTION_ONLY); state.error = ''; }
    catch (e) { state.error = e.message; }
    redraw();
  }

  const api = {
    cancel() {},
    state: () => ({
      world: 'elbo', sentenceName: 'Evidence lower bound on one bright reading', mode: 'campaign',
      level: elboLevel.title, knobs: Object.assign({}, state.weights), words: {}, idleWords: {}, discovered: [],
      lastRun: state.repair ? {
        seeds: 1, steps: state.repair.rounds,
        symptoms: [],
        summary: 'ELBO ' + num(state.repair.steps[0].elbo) + ' to ' + num(state.repair.steps.at(-1).elbo) + '.',
      } : null,
    }),
    run() {
      state.weights = E.narrowWeights();
      state.scores = [E.evaluate(E.LESSON, currentQ())];
      state.weights = E.evenWeights();
      state.scores.push(E.evaluate(E.LESSON, currentQ()));
      state.weights = E.narrowWeights();
      const narrowQ = currentQ();
      state.repair = E.optimize(E.LESSON, narrowQ, E.REPAIR);
      state.bad = E.optimize(E.LESSON, narrowQ, E.RECONSTRUCTION_ONLY);
      state.posterior = E.evaluate(E.LESSON, E.posterior(E.LESSON));
      state.nudged = true;
      state.error = '';
      if (redraw) redraw();
      return { scores: state.scores, repair: state.repair, bad: state.bad, posterior: state.posterior };
    },
    mount(pane, lab, { h, complete, done }) {
      const lesson = C.levels.find((l) => l.id === 'elbo');
      const body = h('div.card.stack', { id: 'elbo-lesson' });
      pane.append(body);
      redraw = () => {
        if (!body.isConnected) return;
        const m = E.LESSON;
        const n = C.levels.findIndex((l) => l.id === 'elbo') + 1;
        const next = C.levels[C.levels.findIndex((l) => l.id === 'elbo') + 1];
        const predicted = state.predict === 'loose';
        const narrowScore = [...state.scores].reverse().find((s) => E.isNarrow(s.q));
        const otherScore = [...state.scores].reverse().find((s) => !E.isNarrow(s.q) && !E.isHardGlare(s.q));
        const diagnosed = state.diagnose === 'klprior';
        const repairRun = state.repair;
        const badRun = state.bad;
        const repairOk = !!(repairRun && repairRun.objective === 'elbo' && repairRun.steps.at(-1).elbo > repairRun.steps[0].elbo + 1e-4 && repairRun.steps.at(-1).gap < repairRun.steps[0].gap - 1e-4 && repairRun.steps.every((s) => s.identity));
        const badOk = !!(badRun && badRun.objective === 'reconstruction' && badRun.steps.at(-1).reconstruction + 1e-9 >= badRun.steps[0].reconstruction && badRun.steps.at(-1).gap > 0.05 && badRun.steps.at(-1).elbo < badRun.steps.at(-1).logPx - 0.05);
        const explained = state.explain === 'match';
        const choices = (id, picked, correct, options, onPick, open) => h('div.mc', { id }, options.map((o) => {
          const locked = picked === correct;
          const tag = 'button.opt' + (picked === o.id ? (o.id === correct ? '.right' : '.wrong') : '');
          return h(tag, { type: 'button', id: id + '-' + o.id, disabled: !open || locked, onclick: () => { if (open) onPick(o.id); } }, [
            h('span', { text: o.label }),
            picked === o.id ? h('span.why', { text: o.why }) : null,
          ]);
        }));
        const meter = (p) => h('span.meter', { 'aria-hidden': 'true' }, [
          h('span', { style: 'width:' + Math.max(0, Math.min(100, p * 100)) + '%' }),
        ]);
        const causeLine = (z) => h('div.row', { id: 'elbo-cause-' + z }, [
          h('b', { text: z }),
          meter(m.prior[z]),
          h('span.small', { text: 'prior ' + num(m.prior[z]) + ', p(bright | ' + z + ') ' + num(m.likelihood[z]) + ', weight ' + state.weights[z] }),
          h('button.btn.ghost', { type: 'button', id: 'elbo-dec-' + z, disabled: !predicted, onclick: () => bump(z, -1) }, 'Less'),
          h('button.btn.ghost', { type: 'button', id: 'elbo-inc-' + z, disabled: !predicted, onclick: () => bump(z, 1) }, 'More'),
        ]);
        const klBlock = (id, row) => h('div', { id }, [
          h('p.small', { text: 'Guess q: ' + qText(row.q) + '.' }),
          h('p.small', { text: 'Reconstruction E_q log p(bright | cause): ' + num(row.reconstruction) + '. KL(q || prior): ' + num(row.klPrior) + '. KL(prior || q): ' + num(row.klPriorReverse) + '.' }),
          h('p.small', { text: 'Bound ELBO = reconstruction minus KL(q || prior): ' + num(row.elbo) + '. log p(bright): ' + num(row.logPx) + '.' }),
          h('p.small', { text: 'Gap log p(bright) minus ELBO: ' + num(row.gap) + '. KL(q || posterior): ' + num(row.klPosterior) + '. KL(posterior || q): ' + num(row.klPosteriorReverse) + '. Identity holds: ' + (row.identity ? 'yes' : 'no') + '.' }),
          row.notes.length ? h('p.small', { text: row.notes.join(' ') }) : null,
        ]);
        const show = (el, nodes) => el.replaceChildren(...nodes.filter((node) => node != null && node !== false));
        const runBlock = (id, run) => run ? h('div.vpo-table', { id }, [
          h('table', null, [
            h('thead', null, [h('tr', null, ['Step', 'ELBO', 'Gap', 'Reconstruction', 'q glare'].map((t) => h('th', { text: t })))]),
            h('tbody', null, run.steps.map((s, i) => h('tr', null, [
              h('td', { text: String(i) }),
              h('td', { text: num(s.elbo) }),
              h('td', { text: num(s.gap) }),
              h('td', { text: num(s.reconstruction) }),
              h('td', { text: num(s.q.glare) }),
            ]))),
          ]),
        ]) : null;
        show(body, [
          h('div.eyebrow', { text: 'Phase 3 · Level ' + n + ' · One bright reading' }),
          h('h2', { text: lesson.title }),
          h('p', { text: lesson.intro }),
          h('p', { text: 'This sits after the entropy lesson because the bound spends a KL. It does not change the pendulum sentence. The tables below are the whole model. p(bright) is the sum of prior times likelihood. The posterior divides that joint by p(bright). You may inspect that posterior as a diagnostic. The repair does not copy it.' }),
          h('p.small', { text: 'CS 285 lecture 11, Spring 2026, headings: Estimating the log-likelihood, The variational approximation, and What\'s the problem? The same deck titles Jensen\'s inequality and KL-Divergence. This page does not copy the slide wording.' }),
          h('ul', null, E.LIMITS.map((line) => h('li.small', { text: line }))),
          h('h3', { text: '1. Predict' }),
          h('p', { text: 'A narrow guess puts almost all of its weight on glare. What should the bound do?' }),
          choices('elbo-predict', state.predict, 'loose', [
            { id: 'loose', label: 'It stays below log p(bright). It matches that number only when the guess matches the posterior.', why: 'The gap is KL(q || posterior). Glare is the sharp cause, not the whole posterior.' },
            { id: 'tight', label: 'It equals log p(bright), because glare is the best single explanation.', why: 'A high likelihood is not the posterior. The prior still gives hall and lamp some of the credit.' },
            { id: 'recon', label: 'The bound is the reconstruction score, so the narrow guess wins.', why: 'The reconstruction score can prefer glare. The bound subtracts KL(q || prior), so that preference can lose.' },
          ], (id) => { state.predict = id; redraw(); }, true),
          h('h3', { text: '2. Set q and compute the bound' }),
          h('p', { text: 'Weights are unnormalized. q is the weights divided by their sum. Less can reach zero. A zero stays zero if you update, and 0 log 0 counts as 0.' }),
          ...E.CAUSES.map(causeLine),
          h('div.row', null, [
            h('button.btn', { type: 'button', id: 'elbo-narrow', disabled: !predicted, onclick: () => setWeights(E.narrowWeights()) }, 'Narrow guess'),
            h('button.btn.ghost', { type: 'button', id: 'elbo-even', disabled: !predicted, onclick: () => setWeights(E.evenWeights()) }, 'Even guess'),
            h('button.btn.ghost', { type: 'button', id: 'elbo-hard', disabled: !predicted, onclick: () => setWeights(E.hardGlareWeights()) }, 'All weight on glare'),
          ]),
          h('div.row', null, [
            h('button.btn', { type: 'button', id: 'elbo-score', disabled: !predicted, onclick: score }, 'Compute the bound'),
            h('button.btn.ghost', { type: 'button', id: 'elbo-posterior', disabled: !predicted, onclick: showPosterior }, 'Compute the posterior from the tables'),
          ]),
          state.error ? h('p.small', { id: 'elbo-error', role: 'status', text: state.error }) : null,
          state.scores.length ? klBlock('elbo-score-readout', state.scores.at(-1)) : null,
          narrowScore && otherScore ? h('p', { id: 'elbo-compare', text: 'Narrow reconstruction ' + num(narrowScore.reconstruction) + ' against the other guess ' + num(otherScore.reconstruction) + '. Narrow bound ' + num(narrowScore.elbo) + ' against the other guess ' + num(otherScore.elbo) + '. log p(bright) is ' + num(narrowScore.logPx) + ' for both, because the tables did not change.' }) : null,
          state.posterior ? h('div', { id: 'elbo-posterior-readout' }, [
            h('p', { text: 'Diagnostic target, computed as prior times likelihood, divided by p(bright). It is not a free observation and it is not a training run.' }),
            klBlock('elbo-posterior-numbers', state.posterior),
          ]) : null,
          h('h3', { text: '3. Diagnose' }),
          h('p', { text: 'The reconstruction score prefers the narrow guess. The bound does not. What did the reconstruction leave out?' }),
          choices('elbo-diagnose', state.diagnose, 'klprior', [
            { id: 'klprior', label: 'KL(q || prior). The bound subtracts that. The gap up to log p(bright) is KL(q || posterior).', why: 'The first arguments are both q. The second argument is the prior inside the bound, and the posterior in the gap. Swapping either pair is a different number on the narrow guess.' },
            { id: 'swap', label: 'KL(prior || q). Swapping the arguments does not change the number.', why: 'On the narrow guess those two numbers differ. On a hard zero, KL(prior || q) is infinite while KL(q || prior) stays finite.' },
            { id: 'none', label: 'Nothing. A higher reconstruction is always a higher bound.', why: 'The narrow reconstruction is higher and the narrow bound is lower. The missing term is the KL.' },
          ], (id) => { state.diagnose = id; redraw(); }, !!(predicted && narrowScore && otherScore && state.posterior)),
          h('h3', { text: '4. Repair' }),
          h('p', { text: 'Both updates start from the weights on screen. Set the narrow guess first so both buttons leave from that q. One button updates q with the KL included: each step mixes the current guess with the joint p(bright, cause). The other button climbs the reconstruction only. Neither button pastes in the posterior. A hard zero cannot leave zero, so the narrow guess keeps a little weight on every cause.' }),
          h('div.row', null, [
            h('button.btn', { type: 'button', id: 'elbo-repair', disabled: !diagnosed, onclick: repair }, 'Update q, KL included'),
            h('button.btn.ghost', { type: 'button', id: 'elbo-bad', disabled: !diagnosed, onclick: badUpdate }, 'Update q, reconstruction only'),
          ]),
          repairRun ? h('p', { id: 'elbo-repair-readout', role: 'status', text: 'KL included, ' + repairRun.rounds + ' steps of size ' + repairRun.step + '. ELBO ' + num(repairRun.steps[0].elbo) + ' to ' + num(repairRun.steps.at(-1).elbo) + '. Gap ' + num(repairRun.steps[0].gap) + ' to ' + num(repairRun.steps.at(-1).gap) + '. Improved: ' + (repairOk ? 'yes' : 'no') + '.' }) : null,
          runBlock('elbo-repair-table', repairRun),
          badRun ? h('p', { id: 'elbo-bad-readout', role: 'status', text: 'Reconstruction only, same step size. Reconstruction ' + num(badRun.steps[0].reconstruction) + ' to ' + num(badRun.steps.at(-1).reconstruction) + '. ELBO ' + num(badRun.steps[0].elbo) + ' to ' + num(badRun.steps.at(-1).elbo) + '. Gap at the end ' + num(badRun.steps.at(-1).gap) + '. Still loose: ' + (badOk ? 'yes' : 'no') + '.' }) : null,
          runBlock('elbo-bad-table', badRun),
          h('h3', { text: '5. Explain' }),
          h('p', { text: 'Why can the gap reach zero?' }),
          choices('elbo-explain', state.explain, 'match', [
            { id: 'match', label: 'The gap equals KL(q || posterior). It is zero when the guess matches the posterior. The update mixes q with the joint. It does not paste a stored table.', why: 'log p(bright) minus the bound equals that KL on every row above, including the narrow start. A variational autoencoder is a later lecture, and this page does not train one.' },
            { id: 'vae', label: 'Because this finite table is a variational autoencoder, and that training always finishes tight.', why: 'There is no encoder, no decoder network, and no reparameterization. The heading What\'s the problem? is about models where this table would be impossible. This page stays on the table.' },
            { id: 'klpriorzero', label: 'Because the gap is KL(q || prior), and that KL is zero at the posterior.', why: 'KL(q || prior) is the term inside the bound. At the posterior it is still positive. The gap is KL(q || posterior).' },
          ], (id) => { state.explain = id; redraw(); }, !!(repairOk && badOk)),
          h('button.btn', { type: 'button', id: 'elbo-complete', disabled: !(explained && repairOk && badOk), onclick: () => { complete(); redraw(); } }, done() ? 'Lesson complete' : 'The gap is KL(q || posterior)'),
          done() && next ? h('button.btn.ghost', { type: 'button', id: 'elbo-next', onclick: () => { window.bellman.level(next.id); window.scrollTo({ top: 0 }); } }, 'Next level: ' + next.title) : null,
        ]);
        show(lab, [h('section.card.game-rules', { id: 'elbo-rules' }, [
          h('h3', { text: 'Game rules · One bright reading' }),
          h('p', { text: 'Goal: make the bound match log p(bright) by moving q, not by editing the tables. Reward each step: none. This lesson has no reward. Equation: ELBO(q) = E_q[log p(bright | cause)] - KL(q || prior). Gap = log p(bright) - ELBO(q) = KL(q || posterior). Episode ends: when the narrow bound, the KL update, and the explanation are done. Score: 1 if the KL update raises the bound and the reconstruction-only update leaves a gap, otherwise 0. Pass this challenge: ' + lesson.goal.text }),
        ])]);
      };
      redraw();
    },
  };
  window.BBELBO_LEVEL = api;
})(window.CONTENT, window.BBELBO);
