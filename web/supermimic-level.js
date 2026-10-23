// Live, seeded pendulum lesson. Its three learners share one fitted dynamics model.
(function (C, M) {
  'use strict';
  C.phases.push({ n: 8, title: 'Learning through a world model' });
  C.worldNames.supermimic = 'Tracking pendulum';
  C.levels.push({
    id: 'supermimic', custom: true, phase: 8, world: 'supermimic', title: 'Trust, then verify, your model',
    intro: 'Compare PPO in physics, PPO in a learned world model, and direct backpropagation through that same model.',
    goal: { text: 'Separate rollout speed from gradient efficiency, then find where a policy exploits model error.' },
  });
  const SUPERMIMIC_CARD = C.cards.supermimic = {
    name: 'SuperMimic', status: 'checked',
    fixes: 'Whole-body reference-motion tracking on a Unitree G1. One differentiable model learns from MuJoCo Warp transitions and trains a goal-conditioned humanoid policy.',
    stillWrong: 'The game has one pendulum joint, no contact model, no motion corpus, no domain randomization, and no hardware transfer. Rankings can change with seed and budget.',
    paper: 'Qiayuan Liao, Yiyang Shao, Junfeng Long, Kevin Zakka, Roberto Horowitz, Pieter Abbeel, and Koushil Sreenath (UC Berkeley), <i>SuperMimic: Scaling Humanoid Whole-Body Control with One Differentiable World Model</i>, arXiv:2610.28480v1, submitted 20 October 2026, accepted at CoRL 2026.',
    evidence: '<p>Sections 3.1 to 3.3 define the alternating data, model-fit, and short-horizon policy loop. Section 3.3 states that “BPTT computes a first-order gradient” and uses a terminal critic. Sections 4.1 to 4.3 report the evaluation, rollout-throughput, PPO-WM, and critic ablations.</p><p>The headline is not a matched rerun. It compares 3 hours on one H100 with SONIC’s reported 7 days on 128 L40 GPUs, with different motion-data sizes and unknown utilization.</p>',
  };
  const SUPERMIMIC_LINKS = C.paperLinks.supermimic = [
    { t: 'arXiv abstract', u: 'https://arxiv.org/abs/2610.28480' },
    { t: 'Primary PDF', u: 'https://arxiv.org/pdf/2610.28480' },
  ];
  const state = { seed: 178, scale: 1, result: null, busy: false, answer: '', inspected: false, error: null };
  const SHARED_SOURCE = {
    algo: {
      label: 'SuperMimic', re: [/\bSuperMimic\b/g],
      idea: 'Fit one differentiable dynamics model from simulator transitions, then improve the tracking policy through short imagined rollouts.',
      math: 'J_H = sum from t=0 to H-1 of gamma^t r_t + gamma^H V(s_H)',
      symbols: [['H', 'the imagined horizon'], ['V(s_H)', 'the terminal critic bootstrap after the imagined steps'], ['gamma', 'the discount on later rewards']],
      note: 'The paper uses 32 imagined steps. It reports model rollouts over 10 times faster and about 64 times fewer imagined steps than PPO on that model.',
      gameNote: 'This game uses one pendulum, one small fitted linear feature model, and bounded CPU budgets. It is not a humanoid or paper replication.',
    },
    discovery: {
      discovered: false, card: SUPERMIMIC_CARD, links: SUPERMIMIC_LINKS,
      blurb: 'The lesson compares PPO in physics, PPO in one fitted model, and direct gradients through that same model. Every policy is evaluated in true physics.',
    },
  };
  M.sharedSource = SHARED_SOURCE;
  let sourceKnown = () => false, revealSource = () => {};
  M.discoveryFor = () => Object.assign({}, SHARED_SOURCE.discovery, { discovered: sourceKnown('supermimic') });
  let currentRun = null, redraw = null, replay = null, record = null;
  M.reset = () => { M.cancel(); state.result = null; record = null; };
  const f = (x, n = 3) => Number(x).toFixed(n);
  const count = x => x >= 1e6 ? f(x / 1e6, 2) + 'M' : x >= 1e3 ? f(x / 1e3, 1) + 'k' : String(x);
  M.cancel = () => {
    const ticket = currentRun; currentRun = null;
    if (ticket) {
      if (ticket.worker) ticket.worker.terminate();
      if (ticket.resolve) ticket.resolve(null);
    }
    state.busy = false;
  };
  M.state = () => ({
    world: 'supermimic', sentenceName: 'SuperMimic-inspired three-method comparison', mode: 'campaign',
    level: 'Trust, then verify, your model', knobs: { seed: state.seed, budget: state.scale === 1 ? 'full' : 'compact' },
    words: {}, idleWords: {}, discovered: [],
    lastRun: state.result ? {
      seeds: 1, steps: state.result.methods.reduce((s, x) => s + x.trainingSteps, 0), symptoms: [],
      summary: Object.fromEntries(state.result.methods.map(x => [x.name, x.physicsScore])),
    } : null,
    comparison: state.result, version: window.BB_SUPERMIMIC_VERSION,
  });
  M.run = async () => {
    if (state.busy) return null;
    const ticket = { worker: null, resolve: null };
    if (replay) replay.clear(); record = null;
    currentRun = ticket; state.busy = true; state.error = null; state.result = null; state.answer = ''; state.inspected = false;
    if (redraw) redraw();
    try {
      const result = await new Promise((resolve, reject) => {
        ticket.resolve = resolve;
        const src = document.querySelector('#supermimic-engine-src').textContent +
          '\nonmessage=e=>{try{postMessage({result:BBSUPERMIMIC.compare(e.data.seed,e.data.scale)})}catch(e){postMessage({error:String(e&&e.stack||e)})}};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const worker = ticket.worker = new Worker(url); URL.revokeObjectURL(url);
        worker.onmessage = e => e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
        worker.onerror = e => reject(Error(e.message));
        worker.postMessage({ seed: state.seed, scale: state.scale });
      });
      if (currentRun !== ticket) return null;
      const measured = await BB.customRecord.create('supermimic', result, window.BB_SUPERMIMIC_VERSION);
      if (currentRun !== ticket) return null;
      record = measured; state.result = record.results;
      revealSource('supermimic');
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      if (currentRun === ticket) {
        M.cancel();
        if (redraw) redraw();
      }
    }
  };
  function table(h, headings, rows, label) {
    const head = h('thead', null, h('tr', null, headings.map(text => h('th', { scope: 'col', text }))));
    const body = h('tbody', null, rows.map(row => h('tr', null, row.map(text => h('td', { text })))));
    return h('div.vpo-table', { tabindex: '0', role: 'region', 'aria-label': label || headings.join(', ') },
      h('table', null, [head, body]));
  }
  function sourceContext(h) {
    const A = window.ALGO_HELP;
    if (!A || !A.ALGOS || !A.makeTrigger) {
      return h('p.small', { id: 'supermimic-source-context', text: 'Source and context use the shared method panel once the method-panel change lands.' });
    }
    A.ALGOS.supermimic = SHARED_SOURCE.algo;
    return h('div.row', { id: 'supermimic-source-context' }, [
      h('span.small', { text: 'Verified paper source and toy adaptation:' }),
      A.makeTrigger('supermimic', 'SuperMimic source and context'),
    ]);
  }
  function rolloutSection(h, r) {
    const x = r.rollout;
    return h('section.stack', { id: 'supermimic-rollout' }, [
      h('h3', { text: 'Measure 1: rollout throughput' }),
      h('p', { text: 'This times state transitions only. It does not measure gradient quality.' }),
      table(h, ['Rollout engine', 'Timed steps', 'Wall time', 'Throughput'], [
        ['Four-substep physics', count(x.steps), f(x.physicsMs, 2) + ' ms', count(x.physicsStepsPerSecond) + ' steps/s'],
        ['Learned model', count(x.steps), f(x.modelMs, 2) + ' ms', count(x.modelStepsPerSecond) + ' steps/s'],
      ], 'Measured rollout throughput'),
      h('p.small', { text: 'Measured by this browser worker with a monotonic clock. Short timings are noisy and include JavaScript overhead. The paper measured H100 GPU batches, not this CPU loop.' }),
    ]);
  }
  function gradientSection(h, r) {
    return h('section.stack', { id: 'supermimic-gradients' }, [
      h('h3', { text: 'Measure 2: gradient and update efficiency' }),
      h('p', { text: 'All final scores below come from true physics. Gain per 1,000 training steps separates learning signal from raw rollout speed.' }),
      table(h, ['Method', 'Steps / updates', 'Wall time', 'True score', 'Gain / 1k'], r.methods.map(x => [
        x.name, count(x.trainingSteps) + ' / ' + x.updates, x.trainMs + ' ms', f(x.physicsScore), f(x.trueGainPer1000Steps, 3),
      ]), 'Gradient efficiency measured in true physics'),
      h('p.small', { text: 'Steps count every policy or critic rollout transition. The 2,400 transitions used to fit the model are reported separately. PPO uses sampled likelihood-ratio gradients. Backpropagation uses action and state derivatives through 12 imagined steps. Budgets are fixed, so this reports observed efficiency, not time to a claimed universal target.' }),
    ]);
  }
  function exploitSection(h, r) {
    const x = r.exploit;
    return h('section.stack', { id: 'supermimic-exploit' }, [
      h('h3', { text: 'The model can be a loophole' }),
      table(h, ['Policy', 'Model score', 'Physics score', 'Gap'], [[x.method, f(x.surrogateScore), f(x.physicsScore), (x.gap >= 0 ? '+' : '') + f(x.gap)]]),
      h('p', { text: f(100 * x.outsideSupport, 1) + '% of this policy’s test actions leave the model-fit range. ' + x.cause }),
      h('p.small', { text: 'The high surrogate score is not a physics result. The policy found actions where the learned model is too optimistic. This controlled support mismatch makes exploitation reproducible; it does not prove that backpropagation always exploits models more than PPO.' }),
      h('button.btn.ghost', { id: 'supermimic-inspect', type: 'button', onclick: () => { state.inspected = true; redraw(); } }, state.inspected ? 'Model error inspected' : 'I compared surrogate and physics scores'),
    ]);
  }
  function shortHorizon(h) {
    return h('details', { id: 'supermimic-horizon' }, [
      h('summary', { text: 'Why short horizons need a terminal critic' }),
      h('p', { text: 'Backpropagation follows model derivatives for 12 steps in this game. Short rollouts reduce compounding model error, exploding or vanishing gradients, and browser cost.' }),
      h('p', { text: 'The terminal critic estimates rewards after step 12. Its value lets an early action receive credit for effects beyond the differentiable window.' }),
      h('p', { text: 'This is a trade-off. A shorter horizon relies more on a biased critic. A longer horizon relies more on an imperfect model and can make gradients unstable. The paper uses 32 imagined steps and shows that its critic supports shorter horizons and better push recovery.' }),
    ]);
  }
  function quiz(h) {
    const options = [
      ['throughput', 'The learned model wins only because each rollout step is faster.'],
      ['matched', 'The paper reran both methods on identical data and identical GPUs, proving a matched 1,000× speedup.'],
      ['separate', 'Rollout throughput and gradient efficiency are distinct; every policy must still be checked in true physics.'],
    ];
    const feedback = {
      throughput: 'Faster rollouts reduce the cost of collecting imagined steps, but they do not explain how much each gradient learns from those steps.',
      matched: 'The headline compares SuperMimic on H100 GPUs with SONIC’s reported L40 run. The paper also notes different motion-data sizes and unknown hardware utilization.',
      separate: 'The comparison keeps transition speed, learning efficiency, and true-physics evaluation as separate measurements.',
    };
    return h('section.stack', null, [
      h('h3', { text: 'Choose the claim the evidence supports' }),
      h('div.mc', null, options.map(([value, text]) => h('button.opt' + (state.answer === value ? '.picked' : ''), {
        type: 'button', onclick: () => { state.answer = value; redraw(); },
      }, [h('span', { text }), state.answer === value ? h('span.why', { role: 'status', text: feedback[value] }) : null]))),
    ]);
  }
  M.mount = (pane, lab, { h, complete, done, known, reveal, replay: sharedReplay, shell }) => {
    replay = sharedReplay;
    sourceKnown = known || (() => false);
    revealSource = reveal || (() => {});
    const lesson = C.levels.find(l => l.id === 'supermimic'), body = h('div.card.stack', { id: 'supermimic-lesson' });
    pane.append(body);
    redraw = () => {
      if (!body.isConnected) return;
      window.ALGO_HELP?.closeReminder();
      const select = (id, label, values, value, change) => h('label.field', { for: id }, [
        h('span.small', { text: label }),
        h('select', { id, style:'min-height:44px;min-width:44px;max-width:100%', disabled: state.busy, onchange: e => { change(+e.target.value); redraw(); } },
          values.map(([v, text]) => h('option', { value: v, selected: v === value, text }))),
      ]);
      body.dataset.customResult = '';
      body.replaceChildren(
        h('div.eyebrow', { text: 'Level ' + C.levels.length + ' · SuperMimic-inspired' }),
        h('h2', { text: lesson.title }), h('p', { text: lesson.intro }), sourceContext(h),
        h('p', { text: 'The learned model is fitted once from 2,400 true-physics transitions. Both model-based learners receive that exact model object. PPO in physics never trains on model rollouts.' }),
        h('div.row', null, [
          select('supermimic-seed', 'Seed', [[178, '178'], [279, '279'], [380, '380']], state.seed, v => { state.seed = v; }),
          select('supermimic-budget', 'Browser budget', [[0.4, 'Compact'], [1, 'Full']], state.scale, v => { state.scale = v; }),
          h('button.btn', { id: 'supermimic-run', type: 'button', disabled: state.busy, onclick: () => M.run().catch(() => redraw()) }, state.busy ? 'Training three policies…' : 'Run all three methods'),
        ]),
        h('p.small', { id: 'supermimic-status', role: 'status', text: state.error || (state.result
          ? 'Live seeded run complete. Model fit: ' + state.result.model.fitTransitions + ' physics transitions, ' + state.result.model.fitMs + ' ms. Policy training costs are reported separately.'
          : 'Live computation in a worker. Results are measured, not canned. Full uses one seed and bounded toy budgets.') }),
      );
      if (state.result) {
        body.append(rolloutSection(h, state.result), gradientSection(h, state.result), exploitSection(h, state.result), shortHorizon(h), quiz(h),
          h('p.small', { text: 'The paper’s headline is not a matched version of this three-way game. It compares 3 hours on one H100 with SONIC’s reported 7 days on 128 L40 GPUs, with different data sizes and unknown utilization.' }),
          h('button.btn', {
            id: 'supermimic-complete', type: 'button',
            disabled: !state.inspected || state.answer !== 'separate',
            onclick: () => { complete(); redraw(); },
          }, done() ? 'Lesson complete' : 'Finish lesson'),
          h('p.small', { text: 'To finish, inspect the surrogate gap and choose the supported conclusion.' }));
      }
      replay.park();
      const scene = BB.customScenes.panel(h, 'supermimic');
      lab.replaceChildren(scene,
        h('section.card.game-rules', { id: 'supermimic-rules' }, [
          h('h3', { text: 'Game rules · Tracking pendulum' }),
          h('dl', null, [
            h('div.rules-row', null, [h('dt', { text: 'Goal' }), h('dd', { text: 'Track the same moving reference in every method.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Reward each step' }), h('dd', { text: 'Exponential angle and velocity tracking, minus 0.01 × torque².' })]),
            h('div.rules-row', null, [h('dt', { text: 'Episode ends' }), h('dd', { text: 'After 100 evaluation steps.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Score' }), h('dd', { text: 'Mean reward per step, always measured in true physics for the main comparison.' })]),
            h('div.rules-row', null, [h('dt', { text: 'Pass this challenge' }), h('dd', { text: lesson.goal.text })]),
          ]),
        ]));
      if (shell) {
        body.classList.add('teaching-card');
        shell.notebook('rule').replaceChildren(lab.querySelector('#supermimic-rules'));
        shell.notebook('notes').replaceChildren(shortHorizon(h));
        if (state.result) {
          shell.notebook('curve').replaceChildren(body.querySelector('#supermimic-rollout'), body.querySelector('#supermimic-gradients'));
          body.querySelector('#supermimic-horizon')?.remove();
          const runButton = body.querySelector('#supermimic-run'); runButton.classList.add('ghost');
          shell.notebook('rule').append(runButton.parentElement);
          const exploit = body.querySelector('#supermimic-exploit');
          if (state.inspected) shell.notebook('autopsy').replaceChildren(exploit);
          else {
            shell.notebook('autopsy').replaceChildren(h('p', { text: state.result.exploit.cause }));
            exploit.querySelector('button').classList.remove('ghost');
            const quiz = exploit.nextElementSibling;
            if (quiz) shell.notebook('notes').append(quiz);
            const finish = body.querySelector('#supermimic-complete'); shell.notebook('notes').append(finish);
          }
        } else {
          shell.notebook('curve').replaceChildren(h('p.small', { text: 'Run the comparison to train and evaluate all three policies.' }));
          shell.notebook('autopsy').replaceChildren(h('p.small', { text: 'Run the comparison to train and evaluate all three policies.' }));
        }
      }
      replay.mount(scene, record, { seed: state.seed, scale: state.scale });
    };
    redraw();
  };
})(window.CONTENT, window.BBSUPERMIMIC);
