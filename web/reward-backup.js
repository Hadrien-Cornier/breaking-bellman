// Snapshot backup of one terminal reward, for the cliff lesson.
// Sixteen states, one action each. The action in S15 pays +1 and stops. Earlier rewards are 0.
// Every round replaces the whole table from the previous round only (step size 1).
// Online play and replay visit states in a different order; this file does not model that order.
(function (root) {
  'use strict';

  const GAMMA = 0.95;
  const LENGTH = 16;
  const ALPHA = 1;
  const CONTINUATION_BIAS = 0.4;
  const SHOCK = -2;
  const SHOCK_EXPONENT = 3; // step 4 on the path from S0, discount power 3
  const EIGHT = 8;

  const COPY = {
    title: 'How a terminal reward moves backward',
    path: 'One fixed path of 16 actions: S0, then S1, and so on to S15, then stop. The action in S15 pays +1. Every earlier action pays 0. Discount 0.95. Step size 1 (α = 1), so the new estimate is the target.',
    assumptions: 'Each completed round updates all 16 entries from the previous round\'s table, together. That snapshot is the only table the targets read. The same round does not feed a newly written value into another state. Rewards are sparse: the only nonzero reward is the terminal +1. Real online learning, and replay, visit states in a different order. This picture is the snapshot calculation. It is not a speed for credit in ordinary training.',
    milestones: 'At round 1 the one-step table lights 1 entry, S15, and the eight-step table lights 8 entries, S8 through S15. At round 2 the eight-step table lights S0. The one-step table lights S0 at round 16.',
    cliff: 'The cliff grid in this level is a different world, with its own step size and visit order.',
    targetsTitle: 'One action, two return targets',
    targetsIntro: 'Same path, same discount, for the action in S0. With an accurate continuation and no later shock, the reference return is 0.95 multiplied across the 15 steps from S0 to the +1.',
    formula: 'one-step = reference + (0.95^1) * continuation error. eight-step = reference + (0.95^8) * continuation error + (0.95^3) * shock at step 4.',
    switches: 'The continuation error is 0.4 when its switch is on, and 0 when it is off. The shock is −2 when its switch is on, and 0 when it is off. Step 4 is inside the eight-step window. The one-step window includes only the first reward, which is 0 on this path, so the shock stays outside that target.',
    tradeoff: 'A longer target counts more rewards that happen later, so a change in a later outcome moves it more. A shorter target puts more of its weight on the bootstrapped continuation, so an error in that continuation moves it more.',
    shockNote: 'The shock switch inserts that fixed −2. It does not draw a random outcome, and it is not a variance measured over many runs.',
    erasure: 'The comparison is that tradeoff: later outcomes on one side, an inaccurate continuation on the other. It does not show a bad action erasing a good one.',
    sliderHelp: 'Previous round, Next round, the round buttons, and the slider all set the same round. Arrow keys move the slider.',
  };

  // view survives a campaign re-render. A reload starts again at round 0. It is not part of the save file.
  const view = { rounds: 0, bias: false, shock: false };

  function backup(n, rounds) {
    let q = Array(LENGTH).fill(0);
    const steps = rounds < 0 ? 0 : rounds;
    for (let k = 0; k < steps; k++) {
      const prev = q;
      q = prev.map((old, i) => {
        let target = 0;
        for (let j = 0; j < n && i + j < LENGTH; j++) {
          if (i + j === LENGTH - 1) target += GAMMA ** j;
        }
        if (i + n < LENGTH) target += (GAMMA ** n) * prev[i + n];
        return (1 - ALPHA) * old + ALPHA * target;
      });
    }
    return q;
  }

  function targets(opts) {
    const o = opts || {};
    const continuationError = +o.continuationError || 0;
    const shock = +o.shock || 0;
    const ideal = GAMMA ** (LENGTH - 1);
    return {
      ideal,
      one: ideal + (GAMMA ** 1) * continuationError,
      eight: ideal + (GAMMA ** EIGHT) * continuationError + (GAMMA ** SHOCK_EXPONENT) * shock,
    };
  }

  function litIndexes(q) {
    const idx = [];
    for (let i = 0; i < q.length; i++) if (q[i] !== 0) idx.push(i);
    return idx;
  }

  function roundSummary(rounds) {
    const one = backup(1, rounds);
    const eight = backup(EIGHT, rounds);
    return { one, eight, litOne: litIndexes(one), litEight: litIndexes(eight) };
  }

  function shown(v) {
    return v === 0 ? '0' : v.toFixed(2);
  }

  function describeLit(idx) {
    if (!idx.length) return 'no lit states';
    const span = idx.length === 1 ? 'S' + idx[0] : 'S' + idx[0] + ' through S' + idx[idx.length - 1];
    const noun = idx.length === 1 ? 'lit state' : 'lit states';
    return idx.length + ' ' + noun + ' (' + span + ')';
  }

  function reachText(summary) {
    return 'Round ' + view.rounds + '. One-step: ' + describeLit(summary.litOne)
      + '. Eight-step: ' + describeLit(summary.litEight)
      + '. S0 is ' + shown(summary.one[0]) + ' with one step and ' + shown(summary.eight[0]) + ' with eight steps.';
  }

  function detailText() {
    const t = targets({
      continuationError: view.bias ? CONTINUATION_BIAS : 0,
      shock: view.shock ? SHOCK : 0,
    });
    return 'Reference ' + t.ideal.toFixed(3)
      + '. One-step target ' + t.one.toFixed(3)
      + '. Eight-step target ' + t.eight.toFixed(3)
      + '. Continuation error ' + (view.bias ? '0.4' : '0')
      + ', multiplied by 0.95^1 and by 0.95^8. Shock '
      + (view.shock ? '−2' : '0')
      + ' at step 4, multiplied by 0.95^3, inside the eight-step window only.';
  }

  function staticText() {
    return Object.keys(COPY).map((k) => COPY[k]).join('\n');
  }

  function mount(h) {
    const roundOut = h('output', { id: 'rb-round-value', role: 'presentation', 'aria-live': 'off', text: String(view.rounds) });
    const range = h('input', {
      type: 'range', id: 'rb-round', min: '0', max: '16', step: '1', value: String(view.rounds),
      'aria-valuemin': '0', 'aria-valuemax': '16', 'aria-valuenow': String(view.rounds),
      oninput: (e) => setRounds(e.target.value),
    });
    const prev = h('button.btn.ghost', { type: 'button', id: 'rb-prev', onclick: () => setRounds(view.rounds - 1) }, 'Previous round');
    const next = h('button.btn.ghost', { type: 'button', id: 'rb-next', onclick: () => setRounds(view.rounds + 1) }, 'Next round');
    const jumps = [0, 1, 2, 16].map((n) => h('button.btn.ghost.tiny', {
      type: 'button', id: 'rb-jump-' + n, 'aria-pressed': 'false', onclick: () => setRounds(n),
    }, 'Round ' + n));
    const oneCells = h('div.cells', { id: 'rb-one', role: 'list', 'aria-label': 'One-step estimates from S0 to S15' });
    const eightCells = h('div.cells', { id: 'rb-eight', role: 'list', 'aria-label': 'Eight-step estimates from S0 to S15' });
    const reach = h('p.small', { id: 'rb-reach', 'aria-live': 'polite' });
    const bias = h('input', { type: 'checkbox', id: 'rb-bias', onchange: (e) => { view.bias = e.target.checked; draw(); } });
    const shock = h('input', { type: 'checkbox', id: 'rb-shock', onchange: (e) => { view.shock = e.target.checked; draw(); } });
    const detail = h('p.small', { id: 'rb-detail', 'aria-live': 'polite' });

    function paint(container, q) {
      container.replaceChildren(...q.map((v, i) => h('div.cell' + (i === LENGTH - 1 ? '.terminal' : '') + (v !== 0 ? '.lit' : ''), {
        role: 'listitem',
        'aria-label': 'S' + i + ', estimate ' + (v === 0 ? '0' : v.toFixed(3)) + (i === LENGTH - 1 ? ', action pays +1' : ''),
      }, [
        h('span.glow', { 'aria-hidden': 'true', style: 'opacity:' + String(v === 0 ? 0 : Math.min(0.5, 0.12 + v * 0.38)) }),
        h('span.name', { text: 'S' + i }),
        h('span.val', { text: shown(v) }),
        h('span.pay', { text: i === LENGTH - 1 ? '+1' : '\u00a0' }),
      ])));
    }

    function draw() {
      const summary = roundSummary(view.rounds);
      const t = targets({
        continuationError: view.bias ? CONTINUATION_BIAS : 0,
        shock: view.shock ? SHOCK : 0,
      });
      roundOut.textContent = String(view.rounds);
      range.value = String(view.rounds);
      range.setAttribute('aria-valuenow', String(view.rounds));
      prev.disabled = view.rounds <= 0;
      next.disabled = view.rounds >= 16;
      jumps.forEach((b, i) => b.setAttribute('aria-pressed', view.rounds === [0, 1, 2, 16][i] ? 'true' : 'false'));
      paint(oneCells, summary.one);
      paint(eightCells, summary.eight);
      reach.textContent = reachText(summary);
      bias.checked = view.bias;
      shock.checked = view.shock;
      detail.textContent = detailText();
      detail.dataset.ideal = t.ideal.toFixed(3);
      detail.dataset.one = t.one.toFixed(3);
      detail.dataset.eight = t.eight.toFixed(3);
    }

    function setRounds(n) {
      const next = Math.max(0, Math.min(16, n | 0));
      view.rounds = next;
      draw();
    }

    const section = h('section.card', { id: 'reward-backup', 'aria-labelledby': 'rb-title' }, [
      h('div.eyebrow', { text: 'Lesson picture · The cliff edge' }),
      h('h3', { id: 'rb-title', text: COPY.title }),
      h('p', { text: COPY.path }),
      h('p.small', { id: 'rb-assumptions', text: COPY.assumptions }),
      h('div.row', null, [prev, next]),
      h('div.row', { id: 'rb-jumps' }, jumps),
      h('div.round-label', null, [h('div.row', null, [h('label', { for: 'rb-round', text: 'Completed rounds' }), roundOut]), range]),
      h('p.small', { text: COPY.sliderHelp }),
      h('div.lanes', null, [
        h('div', null, [h('h4', { text: 'One-step target' }), oneCells]),
        h('div', null, [h('h4', { text: 'Eight-step target' }), eightCells]),
      ]),
      reach,
      h('p.small', { id: 'rb-milestones', text: COPY.milestones }),
      h('p.small', { text: COPY.cliff }),
      h('h3', { id: 'rb-targets-title', text: COPY.targetsTitle }),
      h('p', { text: COPY.targetsIntro }),
      h('p.mono.small', { id: 'rb-formula', text: COPY.formula }),
      h('div.checks', null, [
        h('label', null, [bias, h('span', { text: 'Continuation estimate too high by 0.4' })]),
        h('label', null, [shock, h('span', { text: 'Later reward shock: −2 at step 4' })]),
      ]),
      h('p.small', { text: COPY.switches }),
      detail,
      h('p.small', { text: COPY.tradeoff }),
      h('p.small', { text: COPY.shockNote }),
      h('p.small', { text: COPY.erasure }),
    ]);
    draw();
    return section;
  }

  const API = {
    GAMMA, LENGTH, ALPHA, CONTINUATION_BIAS, SHOCK, SHOCK_EXPONENT, COPY,
    backup, targets, roundSummary, staticText, mount,
  };
  root.BBBACKUP = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
