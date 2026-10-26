// Breaking Bellman: the algorithm equation panel.
//
// ONE reusable equation component for every layout variant. It derives the CURRENT algorithm's
// equations from the CURRENT word configuration (the same `parts` object the learner is built from),
// so it always reflects the actual combination, including unnamed and custom sentences. It is not a
// lookup of a named method's stock formula.
//
// It renders into a stable element (default id `algorithm-math-panel`) that a layout places beside or
// below the editable update-rule sentence, visible by default. On every option change it re-derives
// the equations, briefly highlights the line(s) whose math actually changed, explains the change in
// plain language, defines unfamiliar symbols, and lists the options that have no effect here.
//
// The derivation is the single source of truth for the math. Layout workers mount this component and
// must not write their own equations. See data/bb-equation-impact245/integration-contract.md.
(function (root) {
  'use strict';
  const RLA = (root.RLA = root.RLA || {});
  const C = root.CONTENT;
  const W = C.words;
  const fam = (p) => C.famOf(p);
  const optOf = (key, val) => (W[key] ? W[key].options.find((o) => o[0] === val) : null);
  const wordText = (key, val) => (Array.isArray(val) ? val.map((v) => wordText(key, v)).join(' or ') : ((optOf(key, val) || [0, String(val)])[1]));

  // ---------------------------------------------------------------- which words do nothing here
  // Mirrors the learner's own idle rules (src/agents/value.js, ac.js, pg.js). A word that is idle must
  // never fake a mathematical change: the panel shows it as having no effect in this combination.
  function idleWords(p, world) {
    const o = {};
    if (fam(p) === 'pg') return idlePg(p, world);
    if (fam(p) === 'ac') return idleAc(p, world);
    if (world === 'bandit') return o;
    if (p.data !== 'replay') o.memory = 'the memory is used only with "random old moves from memory".';
    if (p.store === 'net') o.step = 'a network always moves by small gradient steps (Adam, learning rate 0.001).';
    const maxSteps = (RLA.knobDefaults(world) || {}).maxSteps || 1;
    const noGuess = p.nstep === 0 || p.nstep >= maxSteps;
    if (noGuess) {
      const r = p.nstep === 0 ? 'with all rewards to the end there is no guess.' : p.nstep + ' real rewards is the whole episode here, so there is no guess.';
      o.agg = o.picker = o.scorer = o.sync = r;
    } else {
      if (p.agg === 'taken') o.picker = 'the action really taken next is not chosen by any estimate.';
      if (p.picker !== 'frozen' && p.scorer !== 'frozen') o.sync = 'no frozen copy is used in this sentence.';
    }
    return o;
  }
  function idlePg(p) {
    const o = {};
    if (p.baseline !== 'critic') o.adv = 'only a critic judges actions this way.';
    if (p.baseline === 'group') o.credit = 'the group baseline compares whole episodes, so every action gets its episode\'s return.';
    if (p.epochs === 1) o.ratio = 'with 1 pass the policy has not moved yet when it computes the step, so the ratio is 1 and the limit never acts.';
    if (p.group === 'same' && p.baseline !== 'group') o.group = 'the shared start matters only for "the mean of its group".';
    return o;
  }
  function idleAc(p, world) {
    const o = {};
    const crit = p.critics !== 'none';
    if (p.source === 'own') o.demos = 'there is no dataset: it learns from its own tries.';
    if (!crit) { const r = 'there is no critic.'; o.target = o.next = o.penalty = o.delay = r; if (p.pick !== 'one') o.pick = 'choosing among samples needs a critic.'; }
    if (p.head !== 'gauss' || !['q', 'qclose'].includes(p.aim)) o.entropy = p.head !== 'gauss' ? 'only the bell-curve policy has an entropy bonus here.' : 'the bonus acts only when the policy climbs the critic.';
    if (p.base === 'classical' && !RLA.worlds[world].base) o.base = 'this world has no classical controller.';
    if (p.chunk > 1 && (['q', 'qclose'].includes(p.aim) || p.base !== 'none' || p.pick !== 'one')) o.chunk = 'this lab plays chunks only for a policy that copies, acts alone and takes one sample.';
    if (p.aim === 'none' && p.source !== 'both') o.delay = 'the policy does not learn.';
    if (p.source === 'fixed') o.wait = 'with a fixed dataset there are no own tries to wait for.';
    else if (!['q', 'qclose'].includes(p.aim) && p.pick !== 'edit') o.wait = 'the policy does not climb the critic.';
    return o;
  }

  // ---------------------------------------------------------------- MathJax rendering (inlined by the build; else cdnjs; falls back to TeX source)
  let MJ = null;
  function loadMathJax() {
    if (MJ) return MJ;
    MJ = new Promise((resolve) => {
      const done = (v) => { resolve(v); };
      root.MathJax = { tex: { inlineMath: [] }, svg: { fontCache: 'local' }, startup: { typeset: false, ready() { root.MathJax.startup.defaultReady(); root.MathJax.startup.promise.then(() => { try { document.head.append(root.MathJax.svgStylesheet()); } catch (e) { /* older build */ } done(root.MathJax); }); } } };
      const s = document.createElement('script');
      const local = document.getElementById('mathjax-src');
      s.src = local && local.textContent.length > 1000 ? URL.createObjectURL(new Blob([local.textContent], { type: 'text/javascript' }))
        : 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js';
      s.async = true;
      s.onerror = () => done(null);
      document.head.append(s);
      setTimeout(() => done(null), 15000);
    });
    return MJ;
  }
  function texInto(el, tex, display) {
    el.textContent = tex; el.classList.add('tex-src'); el.setAttribute('data-tex', tex);
    loadMathJax().then((M) => {
      if (!M || !el.isConnected) return;
      try { el.replaceChildren(M.tex2svg(tex, { display: display !== false })); el.classList.remove('tex-src'); } catch (e) { /* keep the source */ }
    });
  }
  // Turn a glossary label into TeX plus an optional spoken name, so the symbol is the same
  // renderer as the equations rather than a raw unicode string.
  function symbolTex(label) {
    const named = String(label).match(/^(.*?)(?:\s+\(([^)]*)\))\s*$/);
    let math = (named ? named[1] : String(label)).trim();
    const aside = named ? named[2] : '';
    const reps = [
      ['Q̄_j', '\\bar{Q}_j'], ['Q̄', '\\bar{Q}'],
      ['μ_θ', '\\mu_\\theta'], ['σ_θ', '\\sigma_\\theta'], ['π_θ', '\\pi_\\theta'],
      ['V_φ', 'V_\\phi'], ['V_ψ', 'V_\\psi'], ['∇_θ', '\\nabla_\\theta'], ['ρ_t', '\\rho_t'],
      ['s′', "s'"], ['a′', "a'"],
      ['π', '\\pi'], ['θ', '\\theta'], ['φ', '\\phi'], ['ψ', '\\psi'], ['τ', '\\tau'],
      ['ρ', '\\rho'], ['γ', '\\gamma'], ['α', '\\alpha'], ['ε', '\\epsilon'], ['λ', '\\lambda'],
      ['μ', '\\mu'], ['σ', '\\sigma'], ['∇', '\\nabla'], ['√', '\\sqrt'], ['∞', '\\infty'], ['−', '-'],
    ];
    for (const [from, to] of reps) math = math.split(from).join(to);
    math = math.replace(/\b(tanh|max|min|log|exp)\b/g, '\\$1');
    math = math.split(/(\\[a-zA-Z]+)/).map((part) => {
      if (part.charAt(0) === '\\') return part;
      return part.replace(/\b[A-Za-z]{3,}\b/g, (w) => '\\text{' + w + '}');
    }).join('');
    math = math.replace(/\|/g, '\\mid ');
    return { tex: math, aside };
  }
  function glossTerm(sym) {
    const parsed = symbolTex(sym);
    const dt = h('dt');
    const math = h('span.gloss-math');
    math.setAttribute('data-symbol', sym);
    texInto(math, parsed.tex, false);
    dt.append(math);
    if (parsed.aside) dt.append(document.createTextNode(' (' + parsed.aside + ')'));
    return dt;
  }

  // ---------------------------------------------------------------- the derivation (source of truth)
  function epsText(world) {
    const H = C.hyper[world] || {}, a = H.epsStart !== undefined ? H.epsStart : 1, b = H.epsEnd !== undefined ? H.epsEnd : 0.05;
    return a === b ? String(a) : `${a} \\to ${b} \\text{ over the first } ${H.epsDecaySteps || 5000} \\text{ steps}`;
  }
  function texPg(p) {
    const out = [];
    const grp = p.group === 'same';
    out.push(['collect', `\\tau_1, \\dots, \\tau_{${p.batch}} \\sim \\pi_\\theta${grp ? '\\ \\text{ from one prompt}' : ''}`]);
    const G = p.baseline === 'group' || p.credit === 'total' ? 'R(\\tau)' : 'G_t';
    if (p.baseline === 'group' || p.credit === 'total') out.push(['credit', 'R(\\tau) = \\textstyle\\sum_{k} \\gamma^{k} r_{k+1} \\quad \\text{(the whole episode, for every step)}']);
    else out.push(['credit', 'G_t = \\textstyle\\sum_{k \\ge t} \\gamma^{k-t} r_{k+1} \\quad \\text{(only the rewards after step } t)']);
    let A;
    if (p.baseline === 'none') A = `A_t = ${G}`;
    else if (p.baseline === 'avg') A = `A_t = ${G} - \\bar{G},\\quad \\bar{G} \\leftarrow \\bar{G} + 0.05\\,(G - \\bar{G})`;
    else if (p.baseline === 'group') A = 'A_i = R(\\tau_i) - \\operatorname{mean}_j R(\\tau_j)';
    else if (p.adv === 'mc') A = 'A_t = G_t - V_\\phi(s_t)';
    else if (p.adv === 'td') A = 'A_t = r_{t+1} + \\gamma V_\\phi(s_{t+1}) - V_\\phi(s_t)';
    else A = 'A_t = \\textstyle\\sum_k (\\gamma\\lambda)^k \\delta_{t+k},\\ \\ \\delta_t = r_{t+1} + \\gamma V_\\phi(s_{t+1}) - V_\\phi(s_t),\\ \\lambda = 0.95';
    out.push(['weight', A]);
    if (p.scale === 'std') out.push(['spread', p.baseline === 'group' ? 'A_i \\leftarrow A_i \\,/\\, \\operatorname{std}_j R(\\tau_j)' : 'A_t \\leftarrow (A_t - \\operatorname{mean} A) \\,/\\, \\operatorname{std} A']);
    const r = '\\rho_t = \\frac{\\pi_\\theta(a_t \\mid s_t)}{\\pi_{\\text{old}}(a_t \\mid s_t)}';
    // with one pass the ratio is 1 at the update, so the clip never binds (pg.js); show it only when it can act
    const obj = p.ratio === 'clip' && p.epochs !== 1 ? '\\min\\big(\\rho_t A_t,\\ \\operatorname{clip}(\\rho_t, 0.8, 1.2)\\, A_t\\big)' : '\\rho_t A_t';
    out.push(['update', `\\theta \\leftarrow \\theta + ${p.lr}\\, \\nabla_\\theta \\textstyle\\frac{1}{N}\\sum_t ${obj}${p.bonus ? ' + 0.01\\, H(\\pi_\\theta(\\cdot \\mid s_t))' : ''} \\quad \\times ${p.epochs} \\text{ pass${p.epochs > 1 ? 'es' : ''} (Adam)}`]);
    out.push(['ratio', `${r}${p.epochs === 1 ? ' = 1 \\text{ at the only pass, so } \\nabla \\rho_t = \\nabla \\log \\pi_\\theta(a_t \\mid s_t)' : ''}`]);
    if (p.baseline === 'critic') out.push(['critic', `V_\\phi(s_t) \\leftarrow \\text{regress to } ${p.adv === 'mc' ? 'G_t' : 'A_t + V_\\phi(s_t)'}`]);
    return out;
  }
  function texAc(p, world) {
    const out = [];
    const crit = p.critics !== 'none', two = p.critics === 'two';
    const Qmin = (s, a, bar) => (two ? `\\min_{j=1,2} ${bar ? '\\bar{Q}' : 'Q'}_j(${s}, ${a})` : `${bar ? '\\bar{Q}' : 'Q'}(${s}, ${a})`);
    // the learner ignores chunking unless the policy copies, acts alone and takes one sample (ac.js)
    const chunkIdle = ['q', 'qclose'].includes(p.aim) || p.base !== 'none' || p.pick !== 'one';
    const K = p.chunk > 1 && !chunkIdle ? p.chunk : 1;
    const aT = K > 1 ? `a_{t:t+${K - 1}}` : 'a_t';
    let act;
    if (p.head === 'det') act = `${aT} = \\tanh f_\\theta(s_t) + \\epsilon,\\ \\epsilon \\sim \\mathcal{N}(0, 0.1^2) \\text{ while learning}`;
    else if (p.head === 'gauss') act = ['q', 'qclose'].includes(p.aim) ? `${aT} = \\tanh\\big(\\mu_\\theta(s_t) + \\sigma_\\theta(s_t)\\,\\epsilon\\big),\\ \\epsilon \\sim \\mathcal{N}(0, 1)` : `${aT} = \\tanh \\mu_\\theta(s_t) + \\sigma_\\theta(s_t)\\,\\epsilon`;
    else act = `x_0 \\sim \\mathcal{N}(0, I),\\ \\ x_{k+1} = x_k + \\tfrac{1}{10} v_\\theta(s_t, x_k, \\tfrac{k}{10}),\\ \\ ${aT} = x_{10}`;
    out.push(['act', act]);
    if (K > 1) out.push(['chunk', `\\text{play } a_t, \\dots, a_{t+${K - 1}} \\text{ in order, then decide again}`]);
    if (p.base === 'classical') out.push(['base', 'a = a_{\\text{classical}}(s) + 0.5\\, a_\\theta(s, a_{\\text{classical}})']);
    if (crit && p.pick === 'best') out.push(['pick', `a^* = \\arg\\max_{a_i} ${Qmin('s', 'a_i')},\\ \\ a_1, \\dots, a_8 \\sim \\pi_\\theta(\\cdot \\mid s)`]);
    if (crit && p.pick === 'qavg') out.push(['pick', `\\bar{a} = \\textstyle\\sum_i w_i a_i,\\ \\ w_i \\propto \\exp ${Qmin('s', 'a_i')},\\ \\ a_1, \\dots, a_8 \\sim \\pi_\\theta`]);
    if (crit && p.pick === 'edit') out.push(['pick', `a^* = \\arg\\max_{a \\in \\{a_i,\\, a_i + \\hat a_i\\}} ${Qmin('s', 'a')},\\ \\ \\hat a_i \\sim \\pi_{\\text{edit}}(\\cdot \\mid s, a_i),\\ |\\hat a| \\le 0.3`]);
    if (crit) {
      const ent = p.head === 'gauss' && p.entropy !== 'none' && ['q', 'qclose'].includes(p.aim) && p.pick === 'one' ? ' - \\alpha \\log \\pi_\\theta(a\' \\mid s\')' : '';
      const bar = p.target === 'slow';
      if (p.next === 'expectile') out.push(['target', 'y = r + \\gamma\\, V_\\psi(s\')']);
      else if (p.next === 'data') out.push(['target', `y = r + \\gamma\\, ${Qmin("s'", "a'_{\\text{mem}}", bar)},\\ \\ a'_{\\text{mem}} = \\text{the action really taken next in memory}`]);
      else out.push(['target', `y = r + \\gamma \\big( ${Qmin("s'", "a'", bar)}${ent} \\big),\\ \\ a' ${p.pick !== 'one' ? '= \\text{the chosen action at } s\'' : '\\sim \\pi_\\theta(s\')'}${p.next === 'smooth' ? ' + \\operatorname{clip}(\\mathcal{N}(0, 0.2^2), \\pm 0.5)' : ''}`]);
      out.push(['critic', `Q_j \\leftarrow \\text{min } \\big(Q_j(s, a) - y\\big)^2${p.penalty === 'cql' ? ' + \\big(\\log \\textstyle\\sum_{a\' \\in \\text{random, policy}} e^{Q_j(s, a\')} - Q_j(s, a)\\big)' : ''}`]);
      if (p.next === 'expectile' || p.aim === 'weighted' || p.aim === 'cond') out.push(['value', `V_\\psi(s) \\leftarrow \\text{expectile } \\tau = ${p.next === 'expectile' ? '0.7' : '0.5'} \\text{ of } ${Qmin('s', 'a', bar)},\\ (s, a) \\text{ from the data}`]);
      if (bar) out.push(['slow copy', '\\bar{Q}_j \\leftarrow \\bar{Q}_j + 0.005\\,(Q_j - \\bar{Q}_j)']);
    } else if (p.aim === 'weighted' || p.aim === 'cond') out.push(['value', 'V_\\psi(s_t) \\leftarrow \\text{regress to } G_t \\text{ (the real discounted return that followed)}']);
    const Adv = crit ? `${Qmin('s', 'a', p.target === 'slow')} - V_\\psi(s)` : 'G_t - V_\\psi(s_t)';
    const like = p.head === 'flow' ? (w) => `\\min ${w}\\, \\big\\| v_\\theta(s, x_\\tau, \\tau) - (a - x_0) \\big\\|^2,\\ x_\\tau = (1-\\tau) x_0 + \\tau a` : (w) => `\\max ${w}\\log \\pi_\\theta(a \\mid s)`;
    let pol = null;
    // the entropy term is only paid by the bell-curve policy climbing the critic (ac.js useEntropy)
    const entPol = p.head === 'gauss' && p.entropy !== 'none' && ['q', 'qclose'].includes(p.aim);
    if (p.aim === 'q') pol = p.head === 'det' ? `\\max_\\theta Q_1\\big(s, \\pi_\\theta(s)\\big)` : `\\max_\\theta ${Qmin('s', '\\tilde a')}${entPol ? ' - \\alpha \\log \\pi_\\theta(\\tilde a \\mid s)' : ''},\\ \\tilde a \\sim \\pi_\\theta(s)`;
    else if (p.aim === 'qclose') pol = '\\max_\\theta \\lambda\\, Q\\big(s, \\pi_\\theta(s)\\big) - \\big(\\pi_\\theta(s) - a\\big)^2,\\ \\lambda = 2.5 / \\operatorname{mean}|Q|';
    else if (p.aim === 'copy') pol = like('');
    else if (p.aim === 'copybest') pol = like('') + '\\ \\text{ on the top 25\\% of episodes}';
    else if (p.aim === 'weighted') pol = like('e^{A / \\sigma_A}') + `,\\ A = ${Adv}`;
    else if (p.aim === 'cond') pol = like('').replace('\\mid s)', '\\mid s, I)') + `,\\ I = \\mathbb{1}[A > \\text{top-30\\% cut}],\\ A = ${Adv}`;
    else pol = '\\theta \\text{ frozen}';
    out.push(['policy', pol]);
    if (p.aim === 'cond') out.push(['acting', 'I = 1 \\text{ ("better than usual") whenever it acts}']);
    if (p.pick === 'edit' && crit) out.push(['edit', '\\max\\ Q(s, a_i + \\hat a_i) - \\alpha \\log \\pi_{\\text{edit}}(\\hat a_i \\mid s, a_i)']);
    return out;
  }
  function texLines(p, world) {
    if (fam(p) === 'pg') return texPg(p, world);
    if (fam(p) === 'ac') return texAc(p, world);
    const out = [];
    if (world === 'bandit') {
      const bonus = p.ucb ? ' + c\\sqrt{\\ln t \\,/\\, N(a)}' : '';
      out.push(['act', `a_t = \\arg\\max_a \\big[\\, Q(a)${bonus} \\,\\big]${p.ucb ? '\\quad \\text{(a machine never pulled goes first)}' : ''}`]);
      if (p.eps) out.push(['explore', `\\text{with prob. } \\varepsilon = ${epsText(world)}\\text{: a random machine instead}`]);
      if (p.optimistic) out.push(['start', 'Q_0(a) = 5']);
      const st = p.step === 'avg' ? '\\tfrac{1}{N(a_t)}' : '\\alpha';
      out.push(['update', `Q(a_t) \\leftarrow Q(a_t) + ${st}\\,\\big[\\, r_t - Q(a_t) \\,\\big]`]);
      return out;
    }
    const n = p.nstep;
    const twins = n !== 0 && (p.picker === 'second' || p.scorer === 'second' || p.scorer === 'minpair');
    const live = twins ? 'Q_A' : 'Q', frozen = twins ? '\\bar{Q}_A' : '\\bar{Q}';
    const E = (k) => (k === 'live' ? live : k === 'frozen' ? frozen : 'Q_B');
    const qa = twins ? '\\tfrac12(Q_A+Q_B)' : 'Q';
    out.push(['act', `a_t = \\arg\\max_a \\big[\\, ${qa}(s_t,a)${p.ucb ? ' + c\\sqrt{\\ln N(s_t) / N(s_t,a)}' : ''} \\,\\big]`]);
    if (p.eps) out.push(['explore', `\\text{with prob. } \\varepsilon = ${epsText(world)}\\text{: a random action instead}`]);
    if (p.optimistic) out.push(['start', 'Q_0(s,a) = 5']);
    let rewards;
    if (n === 0) rewards = 'r_{t+1} + \\gamma\\, r_{t+2} + \\dots + \\gamma^{T-t-1} r_T';
    else if (n === 1) rewards = 'r_{t+1}';
    else if (n === 2) rewards = 'r_{t+1} + \\gamma\\, r_{t+2}';
    else rewards = `r_{t+1} + \\gamma\\, r_{t+2} + \\dots + \\gamma^{${n - 1}} r_{t+${n}}`;
    if (n === 0) out.push(['target', `y = ${rewards} \\quad \\text{(no guess)}`]);
    else {
      const sN = `s_{t+${n}}`, aN = `a_{t+${n}}`, g = n === 1 ? '\\gamma' : `\\gamma^{${n}}`;
      const score = (arg) => (p.scorer === 'minpair' ? `\\min\\big(Q_A(${sN},${arg}),\\, Q_B(${sN},${arg})\\big)` : `${E(p.scorer)}(${sN},${arg})`);
      let G;
      if (p.agg === 'taken') G = score(aN);
      else if (p.agg === 'mean') G = `\\sum_{a'} \\pi(a' \\mid ${sN})\\, ${score("a'")}`;
      else {
        const op = p.agg === 'min' ? 'min' : 'max';
        G = p.scorer !== 'minpair' && p.picker === p.scorer ? `\\${op}_{a'} ${E(p.scorer)}(${sN},a')` : score(`\\arg\\${op}_{a'} ${E(p.picker)}(${sN},a')`);
      }
      out.push(['target', `y = ${rewards} + ${g}\\, ${G}`]);
      if (p.agg === 'mean') out.push(['policy', p.eps
        ? `\\pi = 1-\\varepsilon+\\tfrac{\\varepsilon}{|A|} \\text{ on } \\arg\\max_{a'} ${E(p.picker)},\\ \\ \\tfrac{\\varepsilon}{|A|} \\text{ on each other action}\\ \\ (\\varepsilon = ${epsText(world)}, \\text{ as when it acts})`
        : `\\pi = 1 \\text{ on } \\arg\\max_{a'} ${E(p.picker)},\\ 0 \\text{ on the others: it never acts at random, so the average is the best action (as in Q-learning)}`]);
    }
    const Lq = twins ? 'Q_A' : 'Q';
    if (p.store === 'net') out.push(['update', twins
      ? `\\theta_A \\leftarrow \\theta_A - \\eta\\, \\nabla_{\\theta_A} \\big(Q_A(s_t,a_t) - y\\big)^2 \\quad \\text{(Adam; } \\theta_A \\text{: the weights of } Q_A \\text{)}`
      : `\\theta \\leftarrow \\theta - \\eta\\, \\nabla_\\theta \\big(Q_\\theta(s_t,a_t) - y\\big)^2 \\quad \\text{(Adam)}`]);
    else { const st = p.step === 'avg' ? '\\tfrac{1}{N(s_t,a_t)}' : '\\alpha'; out.push(['update', `${Lq}(s_t,a_t) \\leftarrow ${Lq}(s_t,a_t) + ${st}\\,\\big[\\, y - ${Lq}(s_t,a_t) \\,\\big]`]); }
    if (twins) out.push(['twins', '\\text{each update, a coin flip picks which twin is } Q_A \\text{ (it learns); the other is } Q_B']);
    if (p.data === 'replay') {
      const rs = n === 1 ? 'r_{t+1}' : n === 0 ? 'r_{t+1}, \\dots, r_T' : `r_{t+1}, \\dots, r_{t+${n}}`;
      out.push(['data', `(s_t, a_t, ${rs}${n === 0 ? '' : `, s_{t+${n}}`}) \\text{ sampled from the last } ${p.memory} \\text{ moves, 32 at a time}`]);
    }
    if (n !== 0 && (p.picker === 'frozen' || p.scorer === 'frozen')) out.push(['frozen', `${twins ? '\\bar{Q}_A \\leftarrow Q_A,\\ \\bar{Q}_B \\leftarrow Q_B' : '\\bar{Q} \\leftarrow Q'} \\text{ every } ${p.sync} \\text{ updates}`]);
    return out;
  }

  // ---------------------------------------------------------------- grouping: acting / target / fit / policy / copies / data
  const GROUPS = [
    ['acting', 'Acting: how actions are chosen'],
    ['target', 'Target: what the estimate moves toward'],
    ['fit', 'Fitting the estimates (critic / value)'],
    ['policy', 'Policy update: how the behavior changes'],
    ['copies', 'Frozen copies and twins'],
    ['data', 'What it learns from'],
    ['notes', 'Notes'],
  ];
  const GROUP = {
    value: { act: 'acting', explore: 'acting', start: 'acting', target: 'target', policy: 'target', update: 'fit', data: 'data', frozen: 'copies', twins: 'copies' },
    pg: { collect: 'data', credit: 'target', weight: 'target', spread: 'target', update: 'policy', ratio: 'policy', critic: 'fit' },
    ac: { act: 'acting', chunk: 'acting', base: 'acting', pick: 'acting', edit: 'acting', acting: 'acting', target: 'target', critic: 'fit', value: 'fit', 'slow copy': 'copies', policy: 'policy' },
  };
  const groupOf = (f, label) => (GROUP[f] && GROUP[f][label]) || 'notes';

  // ---------------------------------------------------------------- symbol legend and glossary
  function legend(p, world, hyper) {
    hyper = hyper || {};
    return fam(p) === 'pg' ? 'π_θ: the policy (a network θ). τ: one episode. A: the weight of each action. ρ: how much more likely the action is now than when it was tried. H: entropy. V_φ: the critic. γ = ' + (RLA.worlds[world] ? (world === 'goalgrid' ? '1' : '0.99') : '0.99') + '.'
      : fam(p) === 'ac' ? 'Q: a critic, the value of action a in state s. Q̄: its slow copy. V_ψ: the value of a state. π_θ: the policy. y: the target. γ = ' + (world === 'pendulum' ? '0.99' : '0.97') + '. α: the entropy weight. All networks learn with Adam, step size ' + (hyper.lr || 0.001) + ', batches of ' + (hyper.batch || 64) + '.'
        : world === 'bandit' ? 't: the pull number, counting the pulls of all machines (1, 2, 3, ...). a_t: the machine pulled at pull t; r_t: its payout. Q(a): the estimate of machine a. N(a): how many times machine a was pulled so far. c = 2: the weight of the bonus for few pulls. α = 0.1: the step size.'
          : 't: the step number inside the episode (0, 1, 2, ...). T: the last step of the episode. s_t, a_t: the state and the action at step t; r_{t+1}: the reward that follows. Q: live estimate. Q̄: frozen copy. Q_A, Q_B: the two twins. N(s), N(s,a): visits of state s, and tries of action a in it. c = 2. γ = ' + (world === 'mirage' ? '1' : '0.99') + ': discount. α = ' + ((C.hyper[world] || {}).lrTable || 0.1) + ': step size. y: target.';
  }
  // Short definitions for the symbols the player is least likely to know. Every entry is a symbol
  // that actually appears in the derived lines above; nothing here is decorative.
  function glossary(p, world) {
    const f = fam(p);
    const common = [
      ['s, s′', 'a state now, and the state that follows it'],
      ['a, a′', 'an action now, and the next action'],
      ['r', 'the reward just seen'],
      ['γ (gamma)', 'the discount, 0 to 1: how much a later reward counts compared with one now'],
      ['y', 'the target: the value this update moves the estimate toward'],
    ];
    if (f === 'pg') return [
      ['θ (theta)', 'the policy network\'s numbers (its weights); changing them changes the behavior'],
      ['π_θ(a | s)', 'the policy: how likely action a is in state s'],
      ['τ (tau)', 'one whole episode (a run from start to finish)'],
      ['G_t', 'the return from step t: the discounted rewards after step t'],
      ['R(τ)', 'the total discounted reward of a whole episode'],
      ['A_t', 'the weight of an action: how much better it was than usual'],
      ['ρ_t (rho)', 'how much more likely the action is now than when it was tried'],
      ['V_φ(s)', 'the critic: a network that estimates how much a state is worth'],
      ['H', 'entropy: how spread out and random the policy stays'],
      ['∇_θ', 'the direction that raises the objective when the weights nudge that way'],
    ];
    if (f === 'ac') return [
      ['π_θ(a | s)', 'the policy: how the action is chosen in state s'],
      ['μ_θ, σ_θ', 'the policy\'s mean command and its spread (the bell curve it samples from)'],
      ['ε (epsilon)', 'random noise from a standard bell curve, drawn fresh each time'],
      ['Q_j(s, a)', 'critic j: a network that estimates the value of action a in state s'],
      ['Q̄_j', 'a slow (frozen) copy of critic j, used only to build targets'],
      ['V_ψ(s)', 'a network that estimates how much the state itself is worth (no action)'],
      ['min_{j=1,2}', 'with two critics, use the smaller of the two estimates (pessimism)'],
      ['α (alpha)', 'the entropy weight: how much the policy is paid for staying random'],
      ['τ (tau)', 'the expectile level (how high an average) or the soft-update rate, as labelled'],
      ['λ (lambda)', 'the scale that balances climbing the critic against staying near the data'],
      ['tanh', 'squashes a command into the range −1 to 1'],
    ];
    return [
      ['Q(s, a), Q(a)', 'the estimate of taking action a in state s (of machine a, in a casino)'],
      ['Q̄', 'a frozen copy of the estimate, refreshed only every few updates'],
      ['Q_A, Q_B', 'two twin estimates (used when one picks and the other scores)'],
      ['N(s, a), N(a)', 'how many times this state-action (this machine) has been tried'],
      ['α (alpha)', 'the step size: how far one update moves the estimate'],
      ['ε (epsilon)', 'the chance of taking a random action instead of the best one'],
      ['max / min over a′', 'the best (or worst) next action according to the estimate'],
      ['π(a′ | s′)', 'how likely each next action is under the current behavior'],
      ['n', 'how many real rewards are used before the guess'],
    ];
  }
  function splitAlts(sym) {
    const parts = [];
    let cur = '', depth = 0;
    for (const c of String(sym)) {
      if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') depth--;
      else if (depth === 0 && (c === ',' || c === '/')) { if (cur.trim()) parts.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.length ? parts : [String(sym)];
  }
  const GLOSS_KEYS = ['\\bar{Q}_j', '\\bar{Q}', '\\bar{G}', 'Q_A', 'Q_B', 'Q_j', 'Q(', 'N(', '\\varepsilon', '\\epsilon', '\\alpha', '\\gamma', '\\pi_\\theta', '\\pi', '\\nabla_\\theta', '\\theta', '\\tau', '\\rho_t', '\\rho', '\\lambda', '\\mu_\\theta', '\\mu', '\\sigma_\\theta', '\\sigma', '\\nabla', 'V_\\phi', 'V_\\psi', 'r_t', 'r_{', 'G_t', 'A_t', 'R(', '\\tanh', '\\max', '\\min', '\\log'];
  function altInEquation(alt, tex) {
    const parsed = symbolTex(alt).tex.trim();
    if (parsed === 'n') return /(^|[^A-Za-z\\])n([^A-Za-z_]|$)/.test(tex);
    if (parsed === 'H') return /(^|[^A-Za-z\\])H([^A-Za-z_]|$)/.test(tex);
    if (parsed === 'y') return /(^|[^A-Za-z\\])y([^A-Za-z_]|$)/.test(tex);
    const hit = GLOSS_KEYS.filter((k) => parsed.includes(k));
    if (!hit.length) return tex.includes(parsed);
    return hit.every((k) => {
      if (k === '\\epsilon' || k === '\\varepsilon') return /\\epsilon|\\varepsilon/.test(tex);
      if (k === 'Q(') return /Q\(/.test(tex);
      if (k === 'N(') return /N\(/.test(tex);
      if (k === 'r_{') return /r_\{/.test(tex);
      if (k === '\\pi' && hit.includes('\\pi_\\theta')) return tex.includes('\\pi_\\theta');
      if (k === '\\theta' && hit.some((h) => h.includes('\\theta') && h !== '\\theta')) return tex.includes('\\theta');
      if (k === '\\mu' && hit.includes('\\mu_\\theta')) return tex.includes('\\mu_\\theta');
      if (k === '\\sigma' && hit.includes('\\sigma_\\theta')) return tex.includes('\\sigma_\\theta');
      if (k === '\\rho' && hit.includes('\\rho_t')) return tex.includes('\\rho_t');
      if (k === '\\nabla' && hit.includes('\\nabla_\\theta')) return tex.includes('\\nabla_\\theta');
      if (k === '\\bar{Q}' && hit.includes('\\bar{Q}_j')) return tex.includes('\\bar{Q}_j');
      return tex.includes(k);
    });
  }
  function piecesOf(sym) {
    if (sym === 'max / min over a′') return ['max', 'min', 'a′'];
    return splitAlts(sym);
  }
  function pieceInEquation(piece, tex) {
    if (piece === 'Q(s, a)') return /Q\(s/.test(tex);
    if (piece === 'Q(a)') return /Q\(a/.test(tex);
    if (piece === 'N(s, a)') return /N\(s/.test(tex);
    if (piece === 'N(a)') return /N\(a/.test(tex);
    if (piece === 'max') return tex.includes('\\max');
    if (piece === 'min') return tex.includes('\\min');
    if (piece === 'a′') return tex.includes("a'");
    return altInEquation(piece, tex);
  }
  const pieceDef = {
    'Q(a)': 'the estimate of machine a',
    'Q(s, a)': 'the estimate of taking action a in state s',
    'N(a)': 'how many times this machine has been tried',
    'N(s, a)': 'how many times this action has been tried in this state',
    max: 'the best action according to the estimate',
    min: 'the worst action according to the estimate',
    'a′': 'a next action',
  };
  function visibleGlossary(parts, world) {
    const tex = texLines(parts, world).map((row) => row[1]).join(' ');
    const rows = [];
    for (const [sym, def] of glossary(parts, world)) {
      const pieces = piecesOf(sym);
      const hit = pieces.filter((piece) => pieceInEquation(piece, tex));
      if (!hit.length) continue;
      if (hit.length === pieces.length) rows.push([sym, def]);
      else if (hit.length === 1) rows.push([hit[0], pieceDef[hit[0]] || def]);
      else rows.push([hit.join(', '), def]);
    }
    if (tex.includes('r_t') && !rows.some(([sym]) => String(sym).includes('r_t'))) rows.push(['r_t', 'the payout received for the action just taken']);
    else if (/r_\{/.test(tex) && !rows.some(([sym]) => sym === 'r' || String(sym).includes('r_'))) rows.push(['r_{t+1}', 'the reward that follows the action']);
    if (/(^|[^A-Za-z\\])y([^A-Za-z_]|$)/.test(tex) && !rows.some(([sym]) => sym === 'y')) rows.push(['y', 'the target: the value this update moves the estimate toward']);
    return rows;
  }

  // ---------------------------------------------------------------- what changed (plain language)
  // Compare two configurations. Returns the changed words plus the labels of the equation lines whose
  // math actually changed. A word that is idle in both states is not reported as a mathematical change.
  function explain(prev, next, world) {
    if (!prev) return null;
    const f = fam(next);
    const keys = world === 'bandit' && f === 'value' ? ['eps', 'ucb', 'optimistic', 'step'] : (C.families[f] ? C.families[f].keys : Object.keys(next));
    const changed = [];
    for (const k of keys) {
      if (prev[k] === next[k]) continue;
      const to = optOf(k, next[k]), from = optOf(k, prev[k]);
      changed.push({ key: k, question: (W[k] && W[k].q) || k, from: wordText(k, prev[k]), to: wordText(k, next[k]), meaning: (to && to[2]) || '' });
    }
    const before = new Map(texLines(prev, world).map(([l, t]) => [l, t]));
    const after = texLines(next, world);
    const changedLines = [];
    for (const [l, t] of after) if (!before.has(l) || before.get(l) !== t) changedLines.push(l);
    for (const l of before.keys()) if (!after.some(([ll]) => ll === l)) changedLines.push(l);
    return { changed, changedLines };
  }

  // ---------------------------------------------------------------- the component
  function render(container, parts, world, opts) {
    opts = opts || {};
    const defsOpen = !!(container.querySelector && container.querySelector('details.math-defs') && container.querySelector('details.math-defs').open);
    const lines = texLines(parts, world);
    const f = fam(parts);
    const idle = idleWords(parts, world);
    const highlight = opts.highlightLines || [];
    const kids = [];
    kids.push(h('p.math-title', { text: 'The math this sentence runs' }));

    // group the lines, keeping their derivation order inside each group
    const buckets = new Map();
    for (const [label, tex] of lines) {
      const g = groupOf(f, label);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push([label, tex]);
    }
    for (const [g, title] of GROUPS) {
      if (!buckets.has(g)) continue;
      kids.push(h('p.math-group', { text: title }));
      for (const [label, tex] of buckets.get(g)) {
        const t = h('div.tex'); texInto(t, tex);
        kids.push(h('div.mrow' + (highlight.includes(label) ? '.math-changed' : ''), { 'data-line': label }, [h('span.ml', { text: label }), t]));
      }
    }

    // the plain-language explanation of the last change
    if (opts.explain && opts.explain.changed && opts.explain.changed.length) {
      const ex = opts.explain;
      const box = h('div.math-explain', { role: 'status' });
      box.append(h('p.math-explain-title', { text: ex.changedLines.length ? 'What changed in the math' : 'This change does not alter the math here' }));
      for (const c of ex.changed) {
        const why = idle[c.key];
        box.append(h('p.math-explain-line', null, [h('b', { text: c.question + ': ' }), document.createTextNode(c.from + ' → ' + c.to + '. ' + c.meaning + (why ? ' No effect in this combination: ' + why : ''))]));
      }
      if (!ex.changedLines.length) {
        const reasons = ex.changed.map((c) => idle[c.key]).filter(Boolean);
        box.append(h('p.small', { text: reasons.length ? 'Reason: ' + reasons.join(' ') : 'No equation line depends on this word in the current combination.' }));
      }
      kids.push(box);
    }

    // options that do nothing in this combination
    const idleKeys = Object.keys(idle);
    if (idleKeys.length) {
      kids.push(h('p.math-group', { text: 'No effect in this combination' }));
      const ul = h('ul.math-idle');
      for (const k of idleKeys) ul.append(h('li', null, [h('b', { text: wordText(k, parts[k]) + ': ' }), document.createTextNode(idle[k])]));
      kids.push(ul);
    }

    const dl = h('dl.math-gloss');
    for (const [sym, def] of visibleGlossary(parts, world)) { dl.append(glossTerm(sym)); dl.append(h('dd', { text: def })); }
    kids.push(h('details.math-defs', { open: defsOpen }, [
      h('summary', { text: 'Click for symbol definitions' }),
      dl,
    ]));

    container.replaceChildren(...kids);
    // re-render any TeX that MathJax has not touched yet (replaceChildren above reset them)
    return container;
  }

  function h(tag, attrs, kids) {
    const m = tag.match(/^([a-z0-9]+)((?:\.[\w-]+)*)$/i);
    const e = document.createElement(m ? m[1] : tag);
    if (m && m[2]) e.className = m[2].slice(1).replace(/\./g, ' ');
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }

  // mount({ getParts, world, hyper, id }) -> { el, update(parts, world) }
  // update() re-derives, highlights the changed lines briefly and explains the change. The component
  // keeps its own previous render so it can diff; callers just call update() after any option change.
  // The stable id is 'algorithm-math-panel'; pass id to set it (only the primary panel should).
  function mount(opts) {
    opts = opts || {};
    const attrs = { 'aria-label': 'The update rule as equations' };
    if (opts.id) attrs.id = opts.id;
    const el = h('div.algorithm-math-panel', attrs);
    const state = { prev: null, w: null, ex: null, hl: null, deadline: 0, timer: null };
    function update(parts, world) {
      const p = parts || (opts.getParts ? opts.getParts() : null);
      const w = world || (opts.world ? opts.world() : null);
      if (!p || !w) return;
      // a family switch is not "changing one option": start fresh rather than diffing across families
      const famChanged = state.prev && fam(state.prev) !== fam(p);
      const ex = famChanged ? null : explain(state.prev, p, w);
      if (famChanged) { state.ex = null; state.hl = null; }
      const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (ex && ex.changed && ex.changed.length) { state.ex = ex; state.hl = reduceMotion ? [] : ex.changedLines; state.deadline = Date.now() + (reduceMotion ? 0 : 1000); }
      const highlight = (state.hl && Date.now() < state.deadline) ? state.hl : [];
      render(el, p, w, { highlightLines: highlight, explain: state.ex, hyper: opts.hyper ? opts.hyper() : null });
      state.prev = Object.assign({}, p);
      // the highlight is brief: drop the class after its window, without disturbing the explanation
      clearTimeout(state.timer);
      if (highlight.length) {
        state.timer = setTimeout(() => {
          for (const r of el.querySelectorAll('.mrow.math-changed')) r.classList.remove('math-changed');
        }, Math.max(0, state.deadline - Date.now()));
      }
    }
    update();
    return { el, update };
  }

  // ---------------------------------------------------------------- rare hallway worked case
  // The first worked case of this panel: the sparse hallway (#rare-experiment). The equations come
  // from src/agents/rare.js, the same code that produces the recorded steps: the action score, the
  // target y = r + b + gamma * boot, and the tabular update. r (environment reward) and b (count
  // bonus) are never the same symbol: visiting a rare cell pays b, opening the door pays r.
  //
  // method: { place: 'off'|'local'|'target'|'optimism'|'backup', reward: 'env'|'none', label? }
  // step:   one recorded trace row (qBefore, qAfter, bootstrap, actionScore, visitBonus,
  //         intrinsic, nAfter, reward, explored) or null before a run.
  // proto:  { alpha, gamma, eps } (defaults to BBRARE.PROTOCOL in the page).
  function rareProto(proto) {
    return proto || (root.BBRARE && root.BBRARE.PROTOCOL) || { alpha: 0.5, gamma: 0.95, eps: 0.05, actions: ['left', 'right', 'open'] };
  }
  const rarePlace = (m) => (m && m.place) || 'off';
  const rareWithheld = (m) => !!(m && m.reward === 'none');
  const rareOptimistic = (m) => ['optimism', 'backup'].includes(rarePlace(m));
  const rareBonusTarget = (m) => ['target', 'backup'].includes(rarePlace(m));
  const rareBonusScore = (m) => rarePlace(m) === 'local';
  function rareFacts(m, proto) {
    const P = rareProto(proto), vopt = 1 / (1 - P.gamma);
    return {
      bonusScore: rareBonusScore(m), bonusTarget: rareBonusTarget(m), optimistic: rareOptimistic(m), withheld: rareWithheld(m),
      vopt, voptText: String(Math.round(vopt * 1000) / 1000),
      score: rareBonusScore(m) ? 'bonus-score' : rareOptimistic(m) ? 'optimistic' : 'plain',
    };
  }
  // one [label, html] per line; the html may contain .sym spans so r, b, Score, Q and y are
  // visually distinct everywhere they appear.
  function rareLines(m, proto) {
    const P = rareProto(proto), f = rareFacts(m, P);
    const out = [];
    const scoreExpr = f.score === 'bonus-score'
      ? [e('span.sym-q', 'Q(s, a)'), ' + ', e('span.sym-b', '1/√n(s′)'), ', where n(s′) is the visit count of the cell this action leads to, counted before this visit. If n(s′) = 0 the score is +∞.']
      : f.score === 'optimistic'
        ? [e('span.sym-q', 'Q(s, a)'), ', or ', e('b', f.voptText), ' (the untried-action start, 1/(1 − γ)) if this action was never tried at s']
        : [e('span.sym-q', 'Q(s, a)')];
    out.push(['act', [e('span.sym-score', 'Score(s, a)'), ' = ', ...scoreExpr]]);
    out.push(['choose', ['a = argmax over a of ', e('span.sym-score', 'Score(s, a)'), ', ties pick the lowest action index (left). With probability ε = ', String(P.eps), ' a random action instead.']]);
    out.push(['target', [e('span.sym-y', 'y'), ' = ', e('span.sym-r', 'r'), ' + ', e('span.sym-b', 'b'), ' + ', String(P.gamma), ' · ', e('span.sym-q', 'boot')]]);
    out.push(['r', f.withheld
      ? [e('span.sym-r', 'r'), ' = 0 at every step: the environment reward is withheld in this method']
      : [e('span.sym-r', 'r'), ' = 1 only for Open at the door, 0 at every other step (the reward of the rare cell bonus is not r)']]);
    out.push(['b', f.bonusTarget
      ? [e('span.sym-b', 'b'), ' = ', e('span.sym-b', '1/√n(s′)'), ', the visit count of the destination after this visit']
      : [e('span.sym-b', 'b'), ' = 0 at every step: this method keeps the count bonus out of the target']]);
    out.push(['boot', f.optimistic
      ? [e('span.sym-q', 'boot'), ' = max over a′ of Q̃(s′, a′), where Q̃ = ', f.voptText, ' for an untried action and Q(s′, a′) otherwise']
      : [e('span.sym-q', 'boot'), ' = max over a′ of Q(s′, a′)']]);
    out.push(['update', [e('span.sym-q', 'Q(s, a)'), ' ← ', e('span.sym-q', 'Q(s, a)'), ' + α (', e('span.sym-y', 'y'), ' − ', e('span.sym-q', 'Q(s, a)'), '), α = ', String(P.alpha), '. Q starts at 0.']]);
    out.push(['counts', ['n(s) grows by 1 on every arrival at s (Start begins at 1). n(s, a) grows by 1 when a is taken at s. The bonus uses n(s′), the destination count: ', e('span.sym-b', 'b'), ' reads it after the visit, ', e('span.sym-score', 'Score(s, a)'), ' reads it before.']]);
    return out;
  }
  function e(tag, text) {
    const m = tag.match(/^([a-z0-9]+)((?:\.[\w-]+)*)$/i);
    if (typeof document === 'undefined') return { nodeType: 1, tagName: m ? m[1] : tag, className: m && m[2] ? m[2].slice(1).replace(/\./g, ' ') : '', textContent: text == null ? '' : String(text) };
    const node = document.createElement(m ? m[1] : tag);
    if (m && m[2]) node.className = m[2].slice(1).replace(/\./g, ' ');
    if (text != null) node.textContent = text;
    return node;
  }
  // what changes between two methods, in words, with the lines whose math really changed
  function rareExplain(prev, next, proto) {
    if (!prev) return null;
    const a = rareFacts(prev, proto), b = rareFacts(next, proto), lines = [], changed = [];
    if (a.score !== b.score) {
      lines.push('act');
      changed.push('Action score: ' + (a.score === 'plain' ? 'Q(s, a)' : a.score === 'bonus-score' ? 'Q(s, a) + 1/√n(s′)' : 'Q(s, a) with the untried-action start')
        + ' becomes ' + (b.score === 'plain' ? 'Q(s, a)' : b.score === 'bonus-score' ? 'Q(s, a) + 1/√n(s′)' : 'Q(s, a) with the untried-action start') + '.');
    }
    if (a.bonusTarget !== b.bonusTarget) {
      lines.push('target', 'b');
      changed.push(b.bonusTarget ? 'Target: the count bonus now enters the target (b = 1/√n(s′)).' : 'Target: the count bonus leaves the target (b = 0).');
    }
    if (a.optimistic !== b.optimistic) {
      lines.push('boot');
      changed.push(b.optimistic ? 'Bootstrap: untried next actions now count ' + b.voptText + ' instead of their Q.' : 'Bootstrap: every next action now counts its Q.');
    }
    if (a.withheld !== b.withheld) {
      lines.push('r');
      changed.push(b.withheld ? 'Environment reward: forced to 0 in this method.' : 'Environment reward: back to 1 only for Open at the door.');
    }
    return { lines, changed };
  }
  // one recorded transition substituted into the equations. Every number comes from the record.
  function rareStepLines(m, step, proto, labels) {
    if (!step) return { lines: [], notes: [] };
    const P = rareProto(proto), f = rareFacts(m, P);
    const L = labels || (root.BBRARE ? { cells: root.BBRARE.CELL_LABELS, actions: root.BBRARE.PROTOCOL.actions } : { cells: [], actions: [] });
    const cell = (i) => (L.cells && L.cells[i] != null ? L.cells[i] : String(i));
    const act = (i) => (L.actions && L.actions[i] != null ? L.actions[i] : String(i));
    const num = (x) => (isFinite(x) ? String(Math.round(x * 1000) / 1000) : '+∞');
    const y = step.reward + step.intrinsic + P.gamma * step.bootstrap;
    const nBefore = step.nAfter - 1; // the score reads the destination count before this visit
    const out = [];
    out.push(['step', [cell(step.obs), ' --', act(step.action), '--> ', cell(step.state), '. ', step.explored ? 'Sampled random action.' : 'Highest action score.']]);
    out.push(['step score', [e('span.sym-score', 'Score(s, a)'), ' = ', num(step.actionScore),
      f.bonusScore ? (nBefore > 0
        ? ' (Q(s, a) + 1/√n(s′) with n(s′) = ' + String(nBefore) + ' before this visit)'
        : ' (the destination was unseen before this visit, n(s′) = 0, so the score is +∞)')
        : f.optimistic ? (step.triedBefore
          ? ' (this action was already tried here, so its plain Q)'
          : ' (this action was never tried here, so the untried-action start of ' + f.voptText + ')')
          : ' (plain Q(s, a))']]);
    out.push(['step target', [e('span.sym-y', 'y'), ' = ', e('span.sym-r', 'r'), ' + ', e('span.sym-b', 'b'), ' + γ · ', e('span.sym-q', 'boot'), ' = ', e('span.sym-r', num(step.reward)), ' + ', e('span.sym-b', num(step.intrinsic)), ' + ', String(P.gamma), ' · ', e('span.sym-q', num(step.bootstrap)), ' = ', e('span.sym-y', num(y))]]);
    out.push(['step update', [e('span.sym-q', 'Q(s, a)'), ': ', num(step.qBefore), ' → ', num(step.qAfter), ' (Q + α (', e('span.sym-y', 'y'), ' − Q) = ', num(step.qBefore), ' + ', String(P.alpha), ' · ', num(y - step.qBefore), ')']]);
    out.push(['step counts', ['n(s′) after this visit = ', String(step.nAfter), ', so 1/√n(s′) = ', num(step.visitBonus), '. n(s, a) for this pair grows by 1.']]);
    const notes = [];
    if (f.withheld) notes.push('r = 0 here because this method withholds the environment reward.');
    else if (!step.reward) notes.push('The environment reward of this step is 0: only Open at the door pays r = 1.');
    if (!f.bonusTarget && step.visitBonus) notes.push('The bonus 1/√n(s′) = ' + num(step.visitBonus) + ' exists, but this method keeps it out of the target (b = 0).');
    if (!f.bonusScore && !f.bonusTarget && !f.optimistic) notes.push('No count bonus and no optimism are used in this method.');
    return { lines: out, notes };
  }
  function rareGlossary(m) {
    const f = rareFacts(m);
    return [
      ['r', f.withheld
        ? 'the environment reward. This method forces r to 0. The visit bonus is not r.'
        : 'the environment reward: 1 only for Open at the door, otherwise 0. The visit bonus is not r.'],
      ['b', f.bonusTarget
        ? 'the count bonus inside the target: 1/√n(s′) using the destination count after this visit'
        : 'the count-bonus slot in the target. This method sets b to 0, so that bonus does not move y'],
      ['Score(s, a)', f.bonusScore
        ? 'the number compared to choose an action. Here it is Q(s, a) plus 1/√n(s′) before the visit, or +∞ if that cell is unseen'
        : f.optimistic
          ? 'the number compared to choose an action. An untried action scores 1/(1 − γ) until it is tried'
          : 'the number compared to choose an action. Here it is plain Q(s, a)'],
      ['Q(s, a)', 'the learned value of taking action a at s; starts at 0'],
      ['y', 'the target: the number Q(s, a) moves toward in one update'],
      ['boot', f.optimistic
        ? 'the guess for everything after this step. An untried next action counts as 1/(1 − γ); a tried one counts as its Q'
        : 'the guess for everything after this step: the best next-action value at s′'],
      ['n(s), n(s, a)', 'how often s was visited, and how often a was taken at s'],
      ['α (alpha)', 'the step size of one update: Q moves α of the way to y'],
      ['γ (gamma)', 'the discount: how much a later value counts compared with a reward now'],
      ['ε (epsilon)', 'the chance of taking a random action instead of the best-scoring one'],
    ];
  }
  function renderRare(container, m, step, opts, state) {
    opts = opts || {}; state = state || {};
    const defsOpen = !!(container.querySelector && container.querySelector('details.math-defs') && container.querySelector('details.math-defs').open);
    const highlight = state.highlight || [];
    const groups = { 'Choosing an action': [], 'The target and the update': [], 'This recorded step': [], 'No effect in this method': [] };
    const gOf = (label) => (['act', 'choose'].includes(label) ? 'Choosing an action'
      : ['target', 'r', 'b', 'boot', 'update', 'counts'].includes(label) ? 'The target and the update'
        : label.startsWith('step') ? 'This recorded step' : 'No effect in this method');
    for (const [label, html] of rareLines(m, opts.proto)) groups[gOf(label)].push([label, html]);
    const stepInfo = rareStepLines(m, step, opts.proto, opts.labels ? opts.labels() : null);
    if (step) for (const [label, html] of stepInfo.lines) groups['This recorded step'].push([label, html]);
    else groups['This recorded step'].push(['step', 'Press Run, then Watch or Step. The recorded values of the current step are substituted into the equations above.']);
    const methodNotes = {
      off: 'No count bonus and no optimism are used anywhere in this method: the score and the target see only Q and r.',
      local: 'The count bonus never enters the target here (b = 0). It changes only which action is chosen.',
      target: 'The count bonus changes only the target here. The action score is plain Q(s, a).',
      optimism: 'No count bonus anywhere. Only untried actions get the high start of ' + rareFacts(m, opts.proto).voptText + '.',
      backup: 'Both mechanisms are active: the untried-action start in the score and the bootstrap, and the count bonus in the target.',
    };
    if (rarePlace(m) !== 'backup' || rareWithheld(m)) groups['No effect in this method'].push(['note', methodNotes[rarePlace(m)]]);
    if (rareWithheld(m)) groups['No effect in this method'].push(['note', 'The environment reward is forced to 0: only the count bonus moves the target.']);
    if (stepInfo.notes) for (const n of stepInfo.notes) groups['No effect in this method'].push(['note', n]);
    const factsNow = rareFacts(m, opts.proto);
    const legend = 'r: environment reward (Open at the door)' + (factsNow.withheld ? ', forced to 0 in this method' : '')
      + '. b: ' + (factsNow.bonusTarget ? 'count bonus 1/√n(s′) inside the target' : '0 in this method, so the count bonus does not move the target')
      + '. Score: the number compared to choose an action. Q: the learned value of a state-action pair. y: the target of one update. α = ' + String(rareProto(opts.proto).alpha) + ': the step size. γ = ' + String(rareProto(opts.proto).gamma) + ': the discount. n(s), n(s, a): visit counts.';
    const gdl = h('dl.math-gloss');
    for (const [sym, def] of rareGlossary(m)) { gdl.append(glossTerm(sym)); gdl.append(h('dd', { text: def })); }
    const defs = h('details.math-defs', { open: defsOpen }, [
      h('summary', { text: 'Click for symbol definitions' }),
      h('p.math-legend', { text: legend }),
      gdl,
    ]);
    const kids = [];
    kids.push(h('p.math-title', { text: 'The math this method runs' }));
    for (const [g, title] of [['Choosing an action', 'Choosing an action'], ['The target and the update', 'The target and the update'], ['This recorded step', 'This recorded step'], ['No effect in this method', 'No effect in this method']]) {
      const rows = groups[g];
      if (!rows.length) continue;
      kids.push(h('p.math-group', { text: title }));
      for (const [label, html] of rows) {
        const body = h('div.eq');
        for (const c of [].concat(html)) body.append(c && c.nodeType ? c : document.createTextNode(String(c)));
        kids.push(h('div.mrow' + (highlight.includes(label) ? '.math-changed' : ''), { 'data-line': label }, [h('span.ml', { text: label }), body]));
      }
    }
    if (state.explain && state.explain.changed && state.explain.changed.length) {
      const box = h('div.math-explain', { role: 'status' });
      box.append(h('p.math-explain-title', { text: 'What changed in the math' }));
      for (const c of state.explain.changed) box.append(h('p.math-explain-line', { text: c }));
      kids.splice(1, 0, box);
    }
    kids.push(defs);
    container.replaceChildren(...kids);
    return container;
  }
  // mountRare({ id, proto, labels }) -> { el, update(method, step) }
  function mountRare(opts) {
    opts = opts || {};
    const attrs = { 'aria-label': 'The action rule and Q update of the selected method' };
    if (opts.id) attrs.id = opts.id;
    const el = h('div.algorithm-math-panel.rare-math', attrs);
    const state = { prev: null, hl: null, deadline: 0, timer: null, ex: null };
    function update(method, step) {
      if (!method) return el;
      const ex = state.prev ? rareExplain(state.prev, method, opts.proto) : null;
      const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (ex && ex.lines.length) { state.ex = ex; state.hl = reduceMotion ? [] : ex.lines; state.deadline = Date.now() + (reduceMotion ? 0 : 1000); }
      const highlight = (state.hl && Date.now() < state.deadline) ? state.hl : [];
      renderRare(el, method, step || null, opts, { highlight, explain: state.ex });
      state.prev = Object.assign({}, method);
      clearTimeout(state.timer);
      if (highlight.length) state.timer = setTimeout(() => {
        for (const r of el.querySelectorAll('.mrow.math-changed')) r.classList.remove('math-changed');
      }, Math.max(0, state.deadline - Date.now()));
      return el;
    }
    return { el, update };
  }

  root.ALGO_MATH = {
    mount, render, explain, lines: texLines, legend, glossary, visibleGlossary, symbolTex,
    idleWords, idlePg, idleAc, groupOf, texInto, wordText, optOf,
    rareLines, rareStepLines, rareExplain, rareGlossary, rareFacts, mountRare,
  };
})(typeof window !== 'undefined' ? window : globalThis);