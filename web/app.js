(function () {
  'use strict';
  const C = window.CONTENT;
  const W = C.words;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // h('div.card', {onclick}, [children]) -> element
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
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2800);
  }
  const fmt = (x) => {
    if (x == null || !isFinite(x)) return String(x);
    const a = Math.abs(x);
    return a >= 1e4 ? x.toExponential(2) : a >= 100 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3);
  };

  // ---------------------------------------------------------------- storage (per viewer convenience)
  const LS = 'breaking-bellman-v1';
  function load() {
    try {
      return JSON.parse(localStorage.getItem(LS)) || {};
    } catch (e) { return {}; }
  }
  function save() {
    try {
      // A newer version may have saved fields this build does not know yet.
      localStorage.setItem(LS, JSON.stringify({ ...saved, found: S.found, given: S.given, seen: S.seen, done: S.done, answers: S.answers, missions: S.missions,
        saved: S.saved, mode: S.mode, level: S.level, lstep: S.lstep, made: S.made, reviews: S.reviews, unlockAll: S.unlockAll,
        discoveries: S.discoveries, wondered: S.wondered, intro: S.intro }));
    } catch (e) { /* storage blocked */ }
  }

  const saved = load();
  const S = {
    mode: saved.mode === 'review' || MODES_OK(saved.mode) ? saved.mode : 'campaign',
    world: 'cartpole',
    parts: C.cfg({}),
    knobs: {},
    results: [], running: false, lastCfg: null, lastA: null,
    found: saved.found || [],        // card ids discovered (built and working, or failures seen)
    given: saved.given || [],        // card ids shown by a level, not built
    seen: saved.seen || [],          // recipe ids run at least once (names of recipes with no card)
    done: saved.done || [],          // level ids completed
    answers: saved.answers || {},    // question id -> {choice, correct, ts}
    missions: saved.missions || [],
    saved: saved.saved || [],
    level: saved.level || C.levels[0].id,
    lstep: saved.lstep || {},        // level id -> step reached
    made: saved.made || {},          // level id -> { parts, recipe }
    reviews: saved.reviews || {},    // card id -> { last, n, right }
    pinA: null,
    mission: null,
    unlockAll: !!saved.unlockAll,
    wondered: saved.wondered || {},        // surprise id -> times shown ("Did you notice?")
    intro: saved.intro || 0,               // 1 after the first-visit welcome
    discoveries: saved.discoveries || {},  // card id -> what the discovery looked like (time, world, sentence, result, level answers)
  };
  const runState = RLA.runRecord.state();
  function MODES_OK(m) { return ['campaign', 'workbench', 'saboteur', 'codex', 'chat'].includes(m); }

  // ---------------------------------------------------------------- bring your own AI key (optional)
  // The key stays in this browser. By default it lives in sessionStorage (gone when the tab closes); the player can
  // choose localStorage. The page sends it only to the provider the player picks (web/llm.js). There is no server.
  const AIK = 'breaking-bellman-ai';
  function loadAI() {
    for (const store of ['localStorage', 'sessionStorage']) {
      try { const v = JSON.parse(window[store].getItem(AIK)); if (v && v.provider) return Object.assign(v, { remember: store === 'localStorage' }); } catch (e) { /* storage blocked */ }
    }
    return { provider: '', apiKey: '', model: '', baseUrl: '', remember: false };
  }
  function saveAI(v) {
    try { localStorage.removeItem(AIK); sessionStorage.removeItem(AIK); } catch (e) { /* storage blocked */ }
    if (!v.provider) return;
    try { (v.remember ? localStorage : sessionStorage).setItem(AIK, JSON.stringify({ provider: v.provider, apiKey: v.apiKey, model: v.model, baseUrl: v.baseUrl })); } catch (e) { /* storage blocked */ }
  }
  let AI = loadAI();
  const aiReady = () => !!(AI.provider && window.BB && BB.llm && BB.llm.PROVIDERS[AI.provider] && (AI.apiKey || !BB.llm.PROVIDERS[AI.provider].needsKey) && (AI.model || BB.llm.PROVIDERS[AI.provider].defaultModel));
  // the chat calls this: fn(history, { system, tools, onText, signal }) -> { text }
  function tutorSampler() {
    if (!aiReady()) return null;
    return { fn: BB.llm.makeSampler(AI) };
  }
  function aiLabel() {
    if (!aiReady()) return 'off';
    const p = BB.llm.PROVIDERS[AI.provider];
    return p.label + ', ' + (AI.model || p.defaultModel);
  }
  function recordAnswer(qid, choice, correct) {
    if (S.answers[qid]) return; // first attempt only
    S.answers[qid] = { choice, correct, ts: new Date().toISOString() };
    save(); updateScore();
  }
  function recordReview(card, wrong) {
    const r = S.reviews[card] || { n: 0, right: 0 };
    S.reviews[card] = { last: Date.now(), n: r.n + 1, right: r.right + (wrong.length ? 0 : 1) };
    save(); updateScore();
  }

  // ---------------------------------------------------------------- engine workers
  const ENGINE_SRC = $('#engine-src').textContent;
  const WORKER_MAIN = `
    onmessage = (e) => {
      const { cfg, seeds, idx, live } = e.data;
      for (let k = 0; k < seeds.length; k++) {
        try {
          const res = RLA.run(Object.assign({}, cfg, { seed: seeds[k],
            onProgress: live ? (r, t) => postMessage({ type: 'progress', i: idx[k], t, evals: r.evals.slice(), diag: r.diag.slice() }) : undefined }));
          postMessage({ type: 'done', i: idx[k], res });
        } catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); return; }
      }
    };`;
  let workerUrl = null;
  function newWorker() {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([ENGINE_SRC, WORKER_MAIN], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  }
  let active = [];
  let activeReject = null;
  function stopAll(error) {
    for (const w of active) w.terminate(); active = [];
    const reject = activeReject; activeReject = null;
    if (error && reject) reject(error);
  }

  // Run one config over several seeds, split across parallel workers. onUpdate(partials) streams evals.
  function runSeeds(cfg, seeds, onUpdate) {
    stopAll(new Error('cancelled'));
    const pool = Math.max(1, Math.min(seeds.length, (navigator.hardwareConcurrency || 4) - 1, 6));
    const live = seeds.length <= 6;
    const partial = seeds.map(() => ({ evals: [], t: 0 }));
    const results = new Array(seeds.length);
    let finished = 0;
    return new Promise((resolve, reject) => {
      activeReject = reject;
      const groups = range(0, pool - 1).map(() => ({ seeds: [], idx: [] }));
      seeds.forEach((sd, i) => { groups[i % pool].seeds.push(sd); groups[i % pool].idx.push(i); });
      const doneOne = (i, res) => {
        results[i] = res; partial[i] = { evals: res.evals, diag: res.diag, t: cfg.steps };
        finished++;
        if (live || finished % Math.max(1, Math.floor(seeds.length / 20)) === 0 || finished === seeds.length) onUpdate(partial);
        if (finished === seeds.length) { stopAll(); resolve(results); }
      };
      let w0;
      try { w0 = newWorker(); } catch (err) { w0 = null; }
      if (!w0) {
        // no workers in this view: run inline (blocks the page, still real training)
        seeds.forEach((sd, i) => doneOne(i, RLA.run(Object.assign({}, cfg, { seed: sd }))));
        return;
      }
      groups.forEach((g, gi) => {
        const w = gi === 0 ? w0 : newWorker();
        active.push(w);
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'progress') { partial[m.i] = { evals: m.evals, diag: m.diag, t: m.t }; onUpdate(partial); }
          else if (m.type === 'done') doneOne(m.i, m.res);
          else if (m.type === 'error') { stopAll(); reject(new Error(m.message)); }
        };
        w.onerror = (ev) => { stopAll(); reject(new Error(ev.message || 'worker error')); };
        w.postMessage({ cfg, seeds: g.seeds, idx: g.idx, live });
      });
    });
  }

  // ---------------------------------------------------------------- the sentence: words, recognizer
  const optOf = (key, val) => W[key].options.find((o) => o[0] === val);
  const wordText = (key, val) => (Array.isArray(val) ? val.map((v) => wordText(key, v)).join(' or ') : (optOf(key, val) || [0, String(val)])[1]);
  function keysMatch(p, keys) {
    for (const k in keys) { const v = keys[k]; if (Array.isArray(v) ? !v.includes(p[k]) : p[k] !== v) return false; }
    return true;
  }
  const fam = (p) => C.famOf(p);
  function recognize(p, world) {
    for (const r of C.recipes) {
      if ((r.family || 'value') !== fam(p)) continue;
      if (fam(p) === 'value' && (r.world === 'bandit') !== (world === 'bandit')) continue;
      if (r.worlds && !r.worlds.includes(world)) continue;
      if (keysMatch(p, r.keys)) return r;
    }
    return null;
  }
  const recipeOfCard = (id) => C.recipes.find((r) => r.card === id);
  // words that do nothing in this sentence, with the reason
  function idleWords(p, world) {
    const o = {};
    if (fam(p) === 'pg') return idlePg(p, world);
    if (fam(p) === 'ac') return idleAc(p, world);
    if (world === 'bandit') return o;
    if (p.data !== 'replay') o.memory = 'the memory is used only with "random old moves from memory".';
    if (p.store === 'net') o.step = 'a network always moves by small gradient steps (Adam, learning rate 0.001).';
    // a row keeps a guess only when nstep leaves room for one before the episode ends
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
  // the words that differ between two sentences (only words that matter in either)
  function wordDiff(a, b, world) {
    if (fam(a) !== fam(b)) return [{ key: 'family', from: C.families[fam(a)].name, to: C.families[fam(b)].name }];
    const keys = world === 'bandit' && fam(a) === 'value' ? ['eps', 'ucb', 'optimistic', 'step'] : C.families[fam(a)].keys;
    const ia = idleWords(a, world), ib = idleWords(b, world);
    return keys.filter((k) => a[k] !== b[k] && !(ia[k] && ib[k])).map((k) => ({ key: k, from: wordText(k, a[k]), to: wordText(k, b[k]) }));
  }
  const SHORT = { store: 'store', eps: 'random tries', ucb: 'bonus', optimistic: 'start values', data: 'learn from', memory: 'memory', step: 'step', nstep: 'real rewards', agg: 'next action', picker: 'chosen by', scorer: 'scored by', sync: 'refresh',
    family: 'family', batch: 'batch', group: 'start', credit: 'credit', baseline: 'subtract', adv: 'critic judges', scale: 'spread', ratio: 'limit', epochs: 'passes', lr: 'step size', bonus: 'entropy bonus',
    source: 'experiences', demos: 'dataset', base: 'acts', head: 'output', chunk: 'commands per decision', aim: 'policy learns', critics: 'critics', target: 'target critic', next: 'next action', penalty: 'penalty', delay: 'delay', entropy: 'entropy bonus', pick: 'choice', wait: 'policy waits' };
  function diffText(d) {
    return d.map((x) => SHORT[x.key] + ' "' + x.from + '" → "' + x.to + '"').join('; ');
  }

  // ---------------------------------------------------------------- sentence component
  let mounts = [];   // { el, opts, open, permanent }
  function mountSentence(opts) {
    const m = { el: h('div.sentence'), opts, open: null, permanent: !!opts.permanent };
    mounts.push(m); drawSentence(m);
    return m.el;
  }
  function refreshSentences() { if (!RLA.worlds[S.world]) return; for (const m of mounts) drawSentence(m); }
  function drawSentence(m) {
    const o = m.opts, p = o.getParts(), world = o.world(), focus = o.focus ? o.focus() : [];
    const idle = idleWords(p, world);
    const chip = (key) => h('button.w' + (focus.includes(key) ? '.focus' : '') + (idle[key] ? '.idle' : '') + (m.open === key ? '.open' : ''), {
      type: 'button', 'aria-expanded': m.open === key ? 'true' : 'false', 'data-key': key,
      title: W[key].q + (idle[key] ? ' (does nothing here: ' + idle[key] + ')' : ''),
      onclick: () => { m.open = m.open === key ? null : key; drawSentence(m); },
    }, wordText(key, p[key]));
    const line = (label, parts) => h('p.sl', null, [h('b', { text: label })].concat(parts.map((x) => (typeof x === 'string' && W[x] && x.length < 12 && !x.includes(' ') ? chip(x) : x))));
    const L = fam(p) === 'pg' ? [
      [['batch', 'group'], line('Collect', [' ', 'batch', ', ', 'group', '.'])],
      [['credit', 'baseline', 'adv', 'scale'], line('Weigh', [' each action by ', 'credit', ', minus ', 'baseline'].concat(p.baseline === 'critic' ? [' (judged by ', 'adv', ')'] : [], ['; divide by the spread: ', 'scale', '.']))],
      [['epochs', 'lr', 'ratio', 'bonus'], line('Update', [' the policy with ', 'epochs', ', step size ', 'lr', ', moving ', 'ratio', '; ', 'bonus', '.'])],
    ] : fam(p) === 'ac' ? [
      [['source', 'demos'], line('Learn from', [' ', 'source'].concat(p.source !== 'own' ? [' (dataset: ', 'demos', ')'] : [], ['.']))],
      [['head', 'chunk', 'base', 'pick'], line('Act', [' with ', 'head', ', ', 'chunk', ', ', 'base', '; play ', 'pick', '.'])],
      [['critics', 'target', 'next', 'penalty'], line('Critic', [' ', 'critics', '; target from ', 'target', ', with ', 'next', '; ', 'penalty', '.'])],
      [['aim', 'delay', 'entropy', 'wait'], line('Policy', [' ', 'aim', ', after every ', 'delay', ' critic update(s); ', 'entropy', '; waits: ', 'wait', '.'])],
    ] : world === 'bandit' ? [
      [['eps', 'ucb', 'optimistic'], line('Act', [' pull the machine with the best estimate, ', 'eps', ', ', 'ucb', '; estimates start at ', 'optimistic', '.'])],
      [['step'], line('Learn', [' after each pull, move that machine\'s estimate ', 'step', ' toward the payout.'])],
    ] : [
      [['store'], line('Store', [' the estimates in ', 'store', '.'])],
      [['eps', 'ucb', 'optimistic'], line('Act', [' take the action with the best estimate, ', 'eps', ', ', 'ucb', '; estimates start at ', 'optimistic', '.'])],
      [['data', 'memory'], line('Learn from', [' ', 'data', ' (memory ', 'memory', ' moves).'])],
      [['step', 'nstep'], line('Move', [' each estimate ', 'step', ' toward a target: ', 'nstep', p.nstep === 0 ? '.' : ', then a guess:'])],
      [['agg', 'picker', 'scorer'], line('Guess', [' the value of ', 'agg', ', chosen by ', 'picker', ' and scored by ', 'scorer', '.'])],
    ].concat(p.nstep === 0 ? [] : [[[], h('p.small.gloss', { text: 'The guess: the learner does not wait for the rest of the episode. After the rewards it saw, it uses its own current estimate of the next state as a stand-in for everything that comes later. This is called bootstrapping. The guess is often wrong early on; each update copies part of that error into the estimate it moves.' })]], [
      [['sync'], line('Refresh', [' the frozen copy ', 'sync', '.'])],
    ]);
    const kids = [];
    for (const [keys, el] of L) {
      kids.push(el);
      if (m.open && keys.includes(m.open)) kids.push(chooser(m, m.open, p, idle));
    }
    if (o.withName) kids.push(nameBox(p, world));
    if (o.withMath) kids.push(mathBox(p, world));
    if (o.preset) kids.push(presetRow(p, world, m));
    m.el.replaceChildren(...kids);
  }
  function chooser(m, key, p, idle) {
    return h('div.chooser', { role: 'group', 'aria-label': W[key].q }, [
      h('p', null, [h('b', { text: W[key].q })]),
      idle[key] ? h('p.small', { text: 'In this sentence this word does nothing: ' + idle[key] }) : null,
      ...W[key].options.map(([v, label, meaning]) => h('button.choice' + (p[key] === v ? '.on' : ''), {
        type: 'button', 'aria-pressed': p[key] === v ? 'true' : 'false',
        onclick: () => { m.open = null; m.opts.setPart(key, v); },
      }, [h('b', { text: label }), meaning ? h('span.small', { text: meaning }) : null])),
    ]);
  }
  function setMainPart(key, v) { S.parts[key] = v; onPartsChanged(); }
  function onPartsChanged() { cancelRun(); markRunStale(); refreshSentences(); drawCompare(); drawGrid(); if (S.onPartsChange) S.onPartsChange(); }
  const mainSentence = (extra) => mountSentence(Object.assign({ getParts: () => S.parts, setPart: setMainPart, world: () => S.world, preset: true }, extra || {}));

  // ---------------------------------------------------------------- unlocked-technique preset loader (scope 175)
  // Fill the update-rule editor with a learned method's defining settings. Reuses the recipe
  // catalog (C.recipes) as the single source of algorithm settings; no second catalog here.
  // Loading only changes the editor. It never runs anything: the player must press Run.
  const optLabel = (key, val) => wordText(key, val);
  const presetReason = (r, p, world) => window.ALGO_HELP.presetReason(fam, C.families, r, p, world);
  const presetUnlocked = (r) => window.ALGO_HELP.presetUnlocked(r, S.found, S.given);
  function applyPreset(rec, m) {
    const plan = window.ALGO_HELP.presetPlan(S.parts, rec.keys);
    S.parts = C.cfg(plan.next);
    if (m) m.presetInfo = { name: rec.name, changes: plan.changes };
    onPartsChanged();  // refresh + cancel any run; nothing is started
    return plan.changes;
  }
  function presetRow(p, world, m) {
    const rows = C.recipes.map((r, i) => ({ r, i, reason: presetReason(r, p, world) })).filter((x) => presetUnlocked(x.r));
    const sel = h('select', {
      'aria-label': 'Load a learned method preset into the editor',
      onchange: (e) => {
        const v = e.target.value;
        if (v === '') { m.presetInfo = null; drawSentence(m); return; }
        const rec = C.recipes[parseInt(v, 10)];
        const reason = presetReason(rec, p, world);
        if (reason) { m.presetInfo = { name: rec.name, blocked: reason }; drawSentence(m); return; }
        applyPreset(rec, m);
      },
    }, [h('option', { value: '', text: 'Load a learned method\u2026' })].concat(rows.map(({ r, i, reason }) =>
      h('option', { value: String(i), disabled: !!reason, text: r.name + (reason ? ' (' + reason + ')' : '') }))));
    const out = [h('div.preset', null, [h('span.small', { text: 'Load a learned method preset: ' }), sel])];
    const info = m.presetInfo;
    if (info) {
      if (info.blocked) out.push(h('p.small.preset-diff', { text: 'Cannot load ' + info.name + ' here: ' + info.blocked }));
      else {
        out.push(h('p.small.preset-diff', { text: 'Loaded ' + info.name + '. Changed settings (the editor only; nothing ran):' }));
        out.push(h('ul.small.preset-diff', null, (info.changes.length ? info.changes.map((c) =>
          h('li', { text: c.key + ': ' + optLabel(c.key, c.from) + ' \u2192 ' + optLabel(c.key, c.to) }))
          : [h('li', { text: 'No settings changed; the editor already matched ' + info.name + '.' })])));
      }
    }
    return h('div.preset-wrap', null, out);
  }

  function nameBox(p, world) {
    const rec = recognize(p, world);
    let big, small;
    if (rec && rec.card && S.found.includes(rec.card)) { big = rec.name; small = rec.blurb; }
    else if (rec && rec.card && S.given.includes(rec.card)) { big = rec.name; small = 'Given by a level. ' + rec.blurb; }
    else if (rec && !rec.card && S.seen.includes(rec.id)) { big = rec.name; small = rec.blurb; }
    else { big = 'Unnamed sentence'; small = 'Run it. If it works, the codex names it.'; }
    return h('div.compound', null, [h('span.big', { text: big }), h('span.small', { text: small })]);
  }

  // ---------------------------------------------------------------- math (MathJax 3, inlined by the build; else from cdnjs; falls back to the TeX source)
  let MJ = null;
  function loadMathJax() {
    if (MJ) return MJ;
    MJ = new Promise((resolve) => {
      const done = (v) => { resolve(v); };
      window.MathJax = { tex: { inlineMath: [] }, svg: { fontCache: 'local' }, startup: { typeset: false, ready() { window.MathJax.startup.defaultReady(); window.MathJax.startup.promise.then(() => { try { document.head.append(window.MathJax.svgStylesheet()); } catch (e) { /* older build */ } done(window.MathJax); }); } } };
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
  function texInto(el, tex) {
    el.textContent = tex; el.classList.add('tex-src'); el.setAttribute('data-tex', tex);
    loadMathJax().then((M) => {
      if (!M || !el.isConnected) return;
      try { el.replaceChildren(M.tex2svg(tex, { display: true })); el.classList.remove('tex-src'); } catch (e) { /* keep the source */ }
    });
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
    else if (p.baseline === 'avg') A = `A_t = ${G} - \\bar{G}, \\quad \\bar{G} \\leftarrow \\bar{G} + 0.05\\,(G - \\bar{G})`;
    else if (p.baseline === 'group') A = 'A_i = R(\\tau_i) - \\operatorname{mean}_j R(\\tau_j)';
    else if (p.adv === 'mc') A = 'A_t = G_t - V_\\phi(s_t)';
    else if (p.adv === 'td') A = 'A_t = r_{t+1} + \\gamma V_\\phi(s_{t+1}) - V_\\phi(s_t)';
    else A = 'A_t = \\textstyle\\sum_k (\\gamma\\lambda)^k \\delta_{t+k},\\ \\ \\delta_t = r_{t+1} + \\gamma V_\\phi(s_{t+1}) - V_\\phi(s_t),\\ \\lambda = 0.95';
    out.push(['weight', A]);
    if (p.scale === 'std') out.push(['spread', p.baseline === 'group' ? 'A_i \\leftarrow A_i \\,/\\, \\operatorname{std}_j R(\\tau_j)' : 'A_t \\leftarrow (A_t - \\operatorname{mean} A) \\,/\\, \\operatorname{std} A']);
    const r = '\\rho_t = \\frac{\\pi_\\theta(a_t \\mid s_t)}{\\pi_{\\text{old}}(a_t \\mid s_t)}';
    const obj = p.ratio === 'clip' ? '\\min\\big(\\rho_t A_t,\\ \\operatorname{clip}(\\rho_t, 0.8, 1.2)\\, A_t\\big)' : '\\rho_t A_t';
    out.push(['update', `\\theta \\leftarrow \\theta + ${p.lr}\\, \\nabla_\\theta \\textstyle\\frac{1}{N}\\sum_t ${obj}${p.bonus ? ' + 0.01\\, H(\\pi_\\theta(\\cdot \\mid s_t))' : ''} \\quad \\times ${p.epochs} \\text{ pass${p.epochs > 1 ? 'es' : ''} (Adam)}`]);
    out.push(['ratio', `${r}${p.epochs === 1 ? ' = 1 \\text{ at the only pass, so } \\nabla \\rho_t = \\nabla \\log \\pi_\\theta(a_t \\mid s_t)' : ''}`]);
    if (p.baseline === 'critic') out.push(['critic', `V_\\phi(s_t) \\leftarrow \\text{regress to } ${p.adv === 'mc' ? 'G_t' : 'A_t + V_\\phi(s_t)'}`]);
    return out;
  }
  function texAc(p, world) {
    const out = [];
    const crit = p.critics !== 'none', two = p.critics === 'two';
    const Qmin = (s, a, bar) => (two ? `\\min_{j=1,2} ${bar ? '\\bar{Q}' : 'Q'}_j(${s}, ${a})` : `${bar ? '\\bar{Q}' : 'Q'}(${s}, ${a})`);
    const K = p.chunk > 1 ? p.chunk : 1;
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
      else out.push(['target', `y = r + \\gamma \\big( ${Qmin("s'", "a'", bar)}${ent} \\big),\\ \\ a' ${p.pick !== 'one' ? '= \\text{the chosen action at } s\'' : '\\sim \\pi_\\theta(s\')'}${p.next === 'smooth' ? ' + \\operatorname{clip}(\\mathcal{N}(0, 0.2^2), \\pm 0.5)' : ''}`]);
      out.push(['critic', `Q_j \\leftarrow \\text{min } \\big(Q_j(s, a) - y\\big)^2${p.penalty === 'cql' ? ' + \\big(\\log \\textstyle\\sum_{a\' \\in \\text{random, policy}} e^{Q_j(s, a\')} - Q_j(s, a)\\big)' : ''}`]);
      if (p.next === 'expectile' || p.aim === 'weighted' || p.aim === 'cond') out.push(['value', `V_\\psi(s) \\leftarrow \\text{expectile } \\tau = ${p.next === 'expectile' ? '0.7' : '0.5'} \\text{ of } ${Qmin('s', 'a', bar)},\\ (s, a) \\text{ from the data}`]);
      if (bar) out.push(['slow copy', '\\bar{Q}_j \\leftarrow \\bar{Q}_j + 0.005\\,(Q_j - \\bar{Q}_j)']);
    } else if (p.aim === 'weighted' || p.aim === 'cond') out.push(['value', 'V_\\psi(s_t) \\leftarrow \\text{regress to } G_t \\text{ (the real discounted return that followed)}']);
    const Adv = crit ? `${Qmin('s', 'a', p.target === 'slow')} - V_\\psi(s)` : 'G_t - V_\\psi(s_t)';
    const like = p.head === 'flow' ? (w) => `\\min ${w}\\, \\big\\| v_\\theta(s, x_\\tau, \\tau) - (a - x_0) \\big\\|^2,\\ x_\\tau = (1-\\tau) x_0 + \\tau a` : (w) => `\\max ${w}\\log \\pi_\\theta(a \\mid s)`;
    let pol = null;
    if (p.aim === 'q') pol = p.head === 'det' ? `\\max_\\theta Q_1\\big(s, \\pi_\\theta(s)\\big)` : `\\max_\\theta ${Qmin('s', '\\tilde a')} - \\alpha \\log \\pi_\\theta(\\tilde a \\mid s),\\ \\tilde a \\sim \\pi_\\theta(s)`;
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
  // the exploration rate of a value learner in this world, as the engine uses it (src/agents/value.js epsilon())
  function epsText(world) {
    const H = C.hyper[world] || {}, a = H.epsStart !== undefined ? H.epsStart : 1, b = H.epsEnd !== undefined ? H.epsEnd : 0.05;
    return a === b ? String(a) : `${a} \\to ${b} \\text{ over the first } ${H.epsDecaySteps || 5000} \\text{ steps}`;
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
    // each twin is its own network: Q_A has weights theta_A (Q_A_theta would be a double subscript, a TeX error)
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
  function mathBox(p, world) {
    const lines = texLines(p, world);
    const legend = fam(p) === 'pg' ? 'π_θ: the policy (a network θ). τ: one episode. A: the weight of each action. ρ: how much more likely the action is now than when it was tried. H: entropy. V_φ: the critic. γ = ' + (RLA.worlds[world] ? (world === 'goalgrid' ? '1' : '0.99') : '0.99') + '.'
      : fam(p) === 'ac' ? 'Q: a critic, the value of action a in state s. Q̄: its slow copy. V_ψ: the value of a state. π_θ: the policy. y: the target. γ = ' + (world === 'pendulum' ? '0.99' : '0.97') + '. α: the entropy weight. All networks learn with Adam, step size ' + (hyperNow().lr || 0.001) + ', batches of ' + (hyperNow().batch || 64) + '.'
      : world === 'bandit' ? 't: the pull number, counting the pulls of all machines (1, 2, 3, ...). a_t: the machine pulled at pull t; r_t: its payout. Q(a): the estimate of machine a. N(a): how many times machine a was pulled so far. c = 2: the weight of the bonus for few pulls. α = 0.1: the step size.'
      : 't: the step number inside the episode (0, 1, 2, ...). T: the last step of the episode. s_t, a_t: the state and the action at step t; r_{t+1}: the reward that follows. Q: live estimate. Q̄: frozen copy. Q_A, Q_B: the two twins. N(s), N(s,a): visits of state s, and tries of action a in it. c = 2. γ = ' + (world === 'mirage' ? '1' : '0.99') + ': discount. α = ' + ((C.hyper[world] || {}).lrTable || 0.1) + ': step size. y: target.';
    return h('div.math', { 'aria-label': 'The update rule as equations' }, [
      ...lines.map(([label, tex]) => { const t = h('div.tex'); texInto(t, tex); return h('div.mrow', null, [h('span.ml', { text: label }), t]); }),
      h('p.small', { text: legend }),
    ]);
  }

  // ---------------------------------------------------------------- charts (canvas, own scales)
  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const w = Math.max(200, r.width), hgt = r.height || 180;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hgt };
  }
  // series: [{ xs, ys, color, width, dash, alpha, label }]; o.xlabel names the x axis in the page export
  function lineChart(cv, series, o) {
    cv._md = { series: series.map((s) => ({ label: s.label, xs: s.xs, ys: s.ys })), o };
    const { ctx, w, h: H } = setupCanvas(cv);
    const padL = 44, padR = 8, padT = 8, padB = 22;
    ctx.clearRect(0, 0, w, H);
    let xmax = o.xmax || 1, ymin = o.ymin, ymax = o.ymax;
    const ys = series.flatMap((s) => s.ys.filter(isFinite));
    if (ymin == null) ymin = Math.min(0, ...ys);
    if (ymax == null) ymax = Math.max(1, ...ys);
    if (o.log) { ymin = Math.max(1, ymin); ymax = Math.max(ymin * 10, ymax); }
    const tf = (v) => (o.log ? Math.log10(Math.max(1, v)) : v);
    const y0 = tf(ymin), y1 = tf(ymax) === y0 ? y0 + 1 : tf(ymax);
    const X = (x) => padL + (x / xmax) * (w - padL - padR);
    const Y = (y) => padT + (1 - (tf(Math.min(Math.max(y, ymin), ymax)) - y0) / (y1 - y0)) * (H - padT - padB);
    ctx.font = '11px ' + css('--font-mono'); ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--chart-grid'); ctx.lineWidth = 1;
    const ticks = o.log ? range(Math.ceil(y0), Math.floor(y1)).map((p) => Math.pow(10, p)) : niceTicks(ymin, ymax, 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of ticks) { const y = Y(t); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillText(short(t), padL - 4, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of niceTicks(0, xmax, 4)) ctx.fillText(short(t), X(t), H - padB + 5);
    if (o.ref != null) { ctx.setLineDash([4, 4]); ctx.strokeStyle = css('--muted'); ctx.beginPath(); ctx.moveTo(padL, Y(o.ref)); ctx.lineTo(w - padR, Y(o.ref)); ctx.stroke(); ctx.setLineDash([]); }
    for (const s of series) {
      if (!s.xs.length) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.globalAlpha = s.alpha == null ? 1 : s.alpha;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      let started = false;
      s.xs.forEach((x, i) => { const y = s.ys[i]; if (!isFinite(y)) return; if (started) ctx.lineTo(X(x), Y(y)); else { ctx.moveTo(X(x), Y(y)); started = true; } });
      ctx.stroke();
      if (s.end) { const i = s.xs.length - 1; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X(s.xs[i]), Y(s.ys[i]), 3, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
  }
  function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }
  function niceTicks(a, b, n) {
    const span = b - a || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
    const out = []; for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(+t.toFixed(10));
    return out;
  }
  function short(x) { const a = Math.abs(x); return a >= 1e6 ? (x / 1e6).toFixed(0) + 'M' : a >= 1e3 ? (x / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a < 1 && a > 0 ? x.toFixed(2) : String(Math.round(x * 10) / 10); }
  function meanCurve(lists) {
    // lists: arrays of {t, v}; average at the t of the longest list
    const L = lists.reduce((m, l) => (l.length > m.length ? l : m), []);
    return { xs: L.map((p) => p.t), ys: L.map((_, i) => { const v = lists.map((l) => l[i] && l[i].v).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }) };
  }
  function movingMean(arr, w) { const o = new Float32Array(arr.length); let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= w) s -= arr[i - w]; o[i] = s / Math.min(i + 1, w); } return Array.from(o); }

  // the mean curves of a finished run (also kept for a pinned run A)
  function curvesOf(results, world) {
    if (world === 'bandit') {
      const cs = results.map((r) => movingMean(r.bandit.optimal, 50));
      const m = cs[0].map((_, i) => cs.reduce((s, c) => s + c[i], 0) / cs.length);
      return { main: { xs: m.map((_, i) => i + 1), ys: m } };
    }
    if (world === 'mirage') {
      // an episode is 1 step if the agent goes right and 2 if it goes left, so run lengths differ a
      // lot. The curve is the left-door rate against the share of each run's own episodes (0 to 100%),
      // so its right edge is the end of every run and it matches the "at the end" figure.
      const NB = 100;
      const m = [];
      for (let b = 0; b < NB; b++) {
        let acc = 0;
        for (const r of results) {
          const n = r.ep.left.length, a = Math.floor(n * b / NB), c = Math.max(a + 1, Math.floor(n * (b + 1) / NB));
          const seg = r.ep.left.slice(a, c);
          acc += seg.reduce((s, x) => s + x, 0) / Math.max(1, seg.length);
        }
        m.push(acc / results.length);
      }
      const mm = movingMean(m, 10);
      return { main: { xs: mm.map((_, i) => i + 1), ys: mm } };
    }
    const per = results.map((r) => r.evals);
    const mq = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: isFinite(e.maxQ) ? e.maxQ : 1e9 }))));
    return {
      main: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.ret })))),
      pred: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.pred })))),
      disc: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.disc })))),
      maxQ: mq,
    };
  }
  function chartBox(id, title, legend) {
    return h('div.chart-wrap', null, [
      h('div.chart-title', null, [h('b', { text: title }), h('span.legend', null, legend.map(([c, t, dash]) => h('span', null, [h('i' + (dash ? '.dash' : ''), { style: (dash ? 'border-top:2px dashed ' : 'background:') + c }), t])))]),
      h('canvas.chart', { id, 'aria-label': title, 'data-run': runState.record && runState.record.id }),
    ]);
  }
  function renderCharts(partials, done, record = runState.record) {
    if (done && record) partials = record.results.map(r => ({ evals: r.evals, diag: r.diag }));
    const box = $('#charts'); const steps = (S.lastCfg && S.lastCfg.steps) || 1;
    const ink = css('--ink'), acc = css('--accent'), val = css('--f-value'), pol = css('--f-policy'), muted = css('--muted');
    const prior = record && record.comparison;
    const A = S.pinA && prior ? { steps: prior.settings.steps, curves: curvesOf(prior.results, prior.world) } : null;
    const aLeg = A ? [[muted, 'A (pinned)', true]] : [];
    const aSer = (c, label) => (c ? [{ xs: c.xs, ys: c.ys, color: muted, width: 2, dash: [6, 4], label: label || 'A (pinned)' }] : []);
    if (S.world === 'bandit' || S.world === 'mirage') {
      const isB = S.world === 'bandit';
      box.replaceChildren(h('div.eyebrow', { text: isB ? 'Share of pulls on the best machine' : 'Share of episodes that take the left door' }),
        chartBox('ch-main', isB ? 'Best machine chosen (moving mean of 50 pulls, mean of runs)' : 'Left door from A (mean of runs, window 10% of each run)', [[ink, 'this run']].concat(aLeg, isB ? [] : [[muted, '5%: random tries alone']])));
      if (!done) return;
      const c = curvesOf(S.results, S.world).main;
      lineChart($('#ch-main'), aSer(A && A.curves.main).concat([{ xs: c.xs, ys: c.ys, color: ink, width: 2.2, end: true, label: 'this run' }]),
        { xmax: isB ? Math.max(c.xs.length, A ? A.curves.main.xs.length : 0) : 100, ymin: 0, ymax: 1, ref: isB ? null : 0.05, xlabel: isB ? 'pulls' : "share of each run's episodes (%)" });
      return;
    }
    const F = fam(S.lastCfg ? S.lastCfg.parts : S.parts), P_ = S.lastCfg ? S.lastCfg.parts : S.parts;
    const key = S.world + ':' + F + ':' + (A ? 'A' : '');
    const hasCritic = F === 'value' || (F === 'pg' && P_.baseline === 'critic') || (F === 'ac' && P_.critics !== 'none');
    const task = S.world === 'goalgrid' || S.world === 'fork' || S.world === 'fetch' ? 'success' : S.world === 'reach' ? 'dist' : null;
    if (box.dataset.key !== key || !$('#ch-ret')) {
      box.dataset.key = key;
      const who = F === 'value' ? 'Q' : F === 'pg' ? 'V (the critic)' : 'the critic';
      box.replaceChildren(...[
        h('div.eyebrow', { text: (F === 'ac' && P_.source === 'fixed' ? 'Learning from a fixed dataset: each step is one update. ' : '') + 'Test runs every ' + short(Math.round(steps / 40)) + ' steps' }),
        chartBox('ch-ret', 'Score per test episode', [[acc, 'each seed'], [ink, 'mean']].concat(aLeg)),
        task ? chartBox('ch-task', task === 'success' ? 'Share of tests that reach the goal' : 'Distance to the target at the end (m)', [[ink, 'mean']].concat(task === 'dist' ? [[muted, 'classical controller', true]] : [])) : null,
        hasCritic ? chartBox('ch-val', 'Predicted value vs value earned', [[val, who + ' predicts at start'], [ink, 'earned (discounted)']].concat(aLeg.length ? [[muted, 'A: predicted', true]] : [])) : null,
        F === 'value' ? chartBox('ch-q', 'Largest |Q| seen (log scale)', [[pol, 'each seed']].concat(aLeg)) : null,
        F === 'pg' ? chartBox('ch-kl', 'How far each update moves the policy (KL)', [[pol, 'each seed'], [muted, '0.02', true]]) : null,
        F === 'pg' && !['pendulum'].includes(S.world) ? chartBox('ch-ent', 'Randomness of the policy (entropy, nats)', [[pol, 'each seed']]) : null,
        F === 'ac' && P_.critics !== 'none' ? chartBox('ch-qq', 'Critic: value of the policy\'s actions vs the memory\'s actions', [[pol, 'policy\'s actions'], [val, 'actions in memory']]) : null,
      ].filter(Boolean));  // a null child would show as the text "null"
      if (F === 'value' && $('#ch-val')) $('#ch-val').parentNode.querySelector('.chart-title').append(h('button.btn.tiny.ghost', { type: 'button', onclick: openExpert }, 'Why this gap?'));
    // the KL and entropy charts show policy-gradient metrics: their titles carry the shared help trigger
    if (window.RLHELP && F === 'pg') {
      const kT = $('#ch-kl');
      if (kT) { const t = kT.parentNode.querySelector('.chart-title'); if (t) t.append(window.RLHELP.trigger('kl', undefined, metricCtx())); }
      const eT = $('#ch-ent');
      if (eT) { const t = eT.parentNode.querySelector('.chart-title'); if (t) t.append(window.RLHELP.trigger('entropy', undefined, metricCtx())); }
    }
    }
    const maxSteps = (S.lastCfg && S.lastCfg.knobs && S.lastCfg.knobs.maxSteps) || RLA.knobDefaults(S.world).maxSteps;
    const per = partials.map((p) => p.evals);
    const isCliff = S.world === 'cliff', isCart = S.world === 'cartpole';
    const xmax = Math.max(steps, A ? A.steps : 0), xlabel = F === 'ac' && P_.source === 'fixed' ? 'updates' : 'training steps';
    const ret = per.map((ev, i) => ({ xs: ev.map((e) => e.t), ys: ev.map((e) => e.ret), color: acc, alpha: 0.35, width: 1, label: 'seed ' + (i + 1) }));
    const mr = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.ret }))));
    const allR = per.flatMap((ev) => ev.map((e) => e.ret)).concat(A ? A.curves.main.ys : []).filter(isFinite);
    const yl = isCliff ? [-200, 0] : isCart ? [0, maxSteps] : S.world === 'goalgrid' ? [0, 1] : S.world === 'pendulum' ? [Math.min(-1600, ...allR), 0] : [Math.min(0, ...allR), Math.max(0, ...allR)];
    lineChart($('#ch-ret'), aSer(A && A.curves.main).concat(ret, [{ xs: mr.xs, ys: mr.ys, color: ink, width: 2.2, end: true, label: 'mean' }]),
      { xmax, ymin: yl[0], ymax: yl[1], ref: isCliff ? -13 : null, xlabel, note: isCliff ? 'The dashed line at -13 is the score of the shortest path.' : null });
    if (task && $('#ch-task')) {
      const k = task === 'success' ? 'success' : 'dist';
      const mt = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e[k] }))));
      const fin = done && S.results.length ? S.results.map((r) => r.final && r.final.baseDist).filter(isFinite) : [];
      const ref = task === 'dist' && fin.length ? fin.reduce((a, b) => a + b, 0) / fin.length : null;
      lineChart($('#ch-task'), [{ xs: mt.xs, ys: mt.ys, color: ink, width: 2.2, end: true, label: 'mean' }],
        { xmax, ymin: 0, ymax: task === 'success' ? 1 : Math.max(0.3, ...mt.ys.filter(isFinite)), ref, xlabel, note: ref != null ? 'The dashed line is the classical controller.' : null });
    }
    if (hasCritic && $('#ch-val')) {
      const mp = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.pred }))));
      const md = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.disc }))));
      const vals = mp.ys.concat(md.ys).filter(isFinite);
      const cap = F === 'value' ? 1e4 : 1e6;
      lineChart($('#ch-val'), aSer(A && A.curves.pred, 'A: predicted').concat([{ xs: mp.xs, ys: mp.ys, color: val, width: 2, end: true, label: 'predicted at start' }, { xs: md.xs, ys: md.ys, color: ink, width: 2, end: true, label: 'earned (discounted)' }]),
        { xmax, ymin: Math.min(0, ...vals.map((v) => Math.max(v, -cap))), ymax: Math.max(F === 'value' ? 10 : 0.1, ...vals.map((v) => Math.min(v, cap))), xlabel });
    }
    if (F === 'value') {
      const qs = per.map((ev, i) => ({ xs: ev.map((e) => e.t), ys: ev.map((e) => (isFinite(e.maxQ) ? e.maxQ : 1e9)), color: pol, width: 1.4, label: 'seed ' + (i + 1) }));
      lineChart($('#ch-q'), aSer(A && A.curves.maxQ).concat(qs),
        { xmax, log: true, xlabel, note: 'A value of 1000000000 stands for infinity (the estimate overflowed).', ymin: 1, ymax: Math.max(1000, ...per.flatMap((ev) => ev.map((e) => (isFinite(e.maxQ) ? e.maxQ : 1e9))), ...(A ? A.curves.maxQ.ys.filter(isFinite) : [])) });
    }
    const dg = partials.map((p) => p.diag || []);
    if (F === 'pg') {
      const kl = dg.map((d, i) => ({ xs: d.map((x) => x.t), ys: d.map((x) => Math.max(1e-4, Math.abs(x.kl || 0))), color: pol, width: 1.4, label: 'seed ' + (i + 1) }));
      lineChart($('#ch-kl'), kl, { xmax, ymin: 0, ymax: Math.max(0.05, ...kl.flatMap((k) => k.ys).filter(isFinite).map((v) => Math.min(v, 5))), ref: 0.02, xlabel });
      if ($('#ch-ent')) {
        const en = dg.map((d, i) => ({ xs: d.map((x) => x.t), ys: d.map((x) => x.entropy), color: pol, width: 1.4, label: 'seed ' + (i + 1) }));
        lineChart($('#ch-ent'), en, { xmax, ymin: 0, ymax: Math.max(0.1, ...en.flatMap((k) => k.ys).filter(isFinite)), xlabel });
      }
    }
    if (F === 'ac' && $('#ch-qq')) {
      const mp = meanCurve(dg.map((d) => d.map((x) => ({ t: x.t, v: x.qPolicy }))));
      const md = meanCurve(dg.map((d) => d.map((x) => ({ t: x.t, v: x.qData }))));
      const vals = mp.ys.concat(md.ys).filter(isFinite).map((v) => Math.max(-1e6, Math.min(1e6, v)));
      lineChart($('#ch-qq'), [{ xs: md.xs, ys: md.ys, color: val, width: 2, end: true, label: 'actions in memory' }, { xs: mp.xs, ys: mp.ys, color: pol, width: 2, end: true, label: "policy's actions" }],
        { xmax, ymin: Math.min(0, ...vals), ymax: Math.max(0.1, ...vals), xlabel });
    }
  }

  // ---------------------------------------------------------------- stage (the world, replaying a trained policy)
  let anim = null;
  // Fetch: replay one test throw of run 1, then let the player throw the stick (a click or a tap on the field)
  function policyOf(pn) {
    if (!pn) return null;
    const net = RLA.nn.mlp({ sizes: pn.sizes, act: pn.act, rng: RLA.rng.make(1) });
    net.params.forEach((p, i) => p.set(pn.params[i]));
    return (obs) => { const z = net.forward(obs); let b = 0; for (let j = 1; j < z.length; j++) if (z[j] > z[b]) b = j; return b; };
  }
  function renderFetch(cv, ctx, w, H, colors, knobs, world, r0, playTrace) {
    const pol = policyOf(r0 && r0.policy), rnd = RLA.rng.make(9);
    const act = pol || (() => rnd.int(4));
    const cap = $('#stage-caption');
    const tr = r0 && r0.trace;
    if (tr && tr.length) {
      playTrace(tr, '', (k) => ({ text: 'test throw, step ' + (k + 1) + ' / ' + tr.length }));
      cap.textContent = 'Run 1 after training, one test throw: ' + (r0.final && r0.final.success ? 'it got the stick.' : 'it did not get the stick.') + ' Click or tap the field to throw the stick yourself. Simulation.';
    } else {
      world.render(ctx, w, H, colors, { text: 'click the field to throw' });
      cap.textContent = 'Fetch. Click or tap the field to throw the stick. Before training, the dog moves at random.';
    }
    cv.onclick = (e) => {
      const rect = cv.getBoundingClientRect();
      const [fx, fy] = world.fieldAt(e.clientX - rect.left, e.clientY - rect.top, w, H);
      if (fx < -1 || fx > 1 || fy < -1 || fy > 1) return;
      pauseScene(); delete cv.dataset.run; cv.dataset.interactive = 'true';
      cap.textContent = 'Live throw. This is a new interaction, separate from the recorded test. Replay returns to that test.';
      const g = world.getState();
      world.setState([g[0], g[1], g[2], g[3], g[4], 0, 0]);
      let o = world.throwStick(fx, fy), n = 0, last = 0, end = null;
      const limit = Math.max(60, knobs.maxSteps || 60);
      const tick = (ts) => {
        if (!end && ts - last > 45) {
          last = ts; const r = world.step(act(o)); o = r.obs; n++;
          if (r.done) end = 'Got it in ' + n + ' steps!'; else if (n >= limit) end = 'No stick after ' + n + ' steps.';
          world.render(ctx, w, H, colors, { text: (pol ? 'trained dog' : 'untrained dog, random moves') + '  step ' + n + (end ? '  ' + end : '') });
          if (end) cap.textContent = end + (pol ? ' This is seed ' + r0.seed + '\'s greedy policy (it always takes its most likely action).' : ' Train the dog first: press Run.') + ' Click again to throw again.' + (r0 ? ' Replay returns to the recorded test.' : '');
        }
        if (!end) anim = requestAnimationFrame(tick);
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { while (!end) tick(last + 1000); } else anim = requestAnimationFrame(tick);
    };
    cv.style.cursor = 'crosshair';
  }
  // Watch advances a deterministic replay clock only while the stage is on screen.
  let stageSeen = !window.IntersectionObserver;
  if (window.IntersectionObserver) new IntersectionObserver((es) => { stageSeen = es[es.length - 1].intersectionRatio >= 0.4; }, { threshold: [0, 0.4, 1] }).observe($('#stage'));
  let stageFrame = null;
  function playScene(cv, sc) {
    stageFrame.length = Math.max(1, Math.ceil((sc.duration || 0) / 40));
    if (stageFrame.measure) return;
    const ms = stageFrame.t * 40;
    BB.scenes.atTime(0, () => sc.frame(0));
    BB.scenes.atTime(ms, () => sc.frame(ms));
  }
  let adapter = null, sceneTime = 0, scenePolicy = 0, watching = false, replayAnimation = null;
  function pauseScene() {
    watching = false; cancelAnimationFrame(replayAnimation); cancelAnimationFrame(anim);
    $('#scene-watch').textContent = 'Watch';
  }
  function scenePosition() {
    const n = adapter && runState.record ? adapter.length(runState.record) : 0;
    $('#scene-position').textContent = n ? 'Replay frame ' + (sceneTime + 1) + ' of ' + n : '';
    $('#stage').dataset.frame = String(sceneTime);
  }
  function makeSceneAdapter() {
    const world = S.world, policy = scenePolicy;
    return BB.sceneAdapter.create({ world, settings: ['parts', 'knobs', 'hyper', 'steps', 'seeds'],
      render: (el, record, t) => {
        const previous = stageFrame;
        stageFrame = { t: t || 0, measure: t === null, length: 0 };
        try {
          BB.scenes.atTime((t || 0) * 40, () => drawStage(record, t || 0, policy, t === null));
          if (t !== null) {
            delete el.dataset.interactive;
            if (record) {
              el.dataset.run = record.id;
              $('#stage-caption').textContent = $('#stage-caption').textContent.replace(/Run 1|Seed 1/g, 'Seed ' + record.results[policy].seed);
              if (world !== 'fetch') {
                el.style.cursor = 'pointer';
                el.onclick = () => {
                  pauseScene();
                  const last = adapter.length(record) - 1;
                  sceneTime = sceneTime >= last ? 0 : last;
                  adapter.draw(record, sceneTime); scenePosition();
                };
              }
            } else delete el.dataset.run;
            el.dataset.world = world;
          }
          return stageFrame.length;
        } finally { stageFrame = previous; }
      } });
  }
  function renderStage() {
    markRunStale(); pauseScene();
    if (!RLA.worlds[S.world]) return;
    renderRules();
    adapter = makeSceneAdapter(); adapter.mount($('#stage'));
    const record = runState.record;
    if (record) {
      sceneTime = Math.min(sceneTime, Math.max(0, adapter.length(record) - 1));
      adapter.draw(record, sceneTime);
    }
    $('#scene-controls').hidden = !record;
    scenePosition();
  }
  function watchScene() {
    if (watching) { pauseScene(); return; }
    if (!runState.record || !adapter) return;
    const n = adapter.length(runState.record);
    if (sceneTime >= n - 1) sceneTime = 0;
    // Reduced motion uses explicit steps; Watch reveals the last recorded frame without autoplay.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sceneTime = n - 1; adapter.draw(runState.record, sceneTime); scenePosition(); return;
    }
    watching = true; $('#scene-watch').textContent = 'Pause';
    let last = 0;
    const tick = ts => {
      if (!watching) return;
      if (stageSeen && ts - last >= 40) {
        last = ts; sceneTime = Math.min(n - 1, sceneTime + 1);
        adapter.draw(runState.record, sceneTime); scenePosition();
        if (sceneTime === n - 1) { pauseScene(); return; }
      }
      replayAnimation = requestAnimationFrame(tick);
    };
    replayAnimation = requestAnimationFrame(tick);
  }

  const sceneFonts = () => ({ display: css('--font-display'), mono: css('--font-mono'), body: css('--font-body') });
  const isDark = () => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css('--bg')); return !!m && (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 < 100; };
  function drawStage(record, t, policy = 0, measure = false) {
    const viewWorld = record ? record.world : S.world;
    if (!RLA.worlds[viewWorld]) return 0;
    const viewKnobs = record ? record.settings.knobs : S.knobs;
    if (!measure) { $('#stage').onclick = null; $('#stage').style.cursor = ''; }
    const cv = $('#stage'); const { ctx, w, h: H } = measure
      ? { ctx: cv.getContext('2d'), w: cv.getBoundingClientRect().width, h: cv.getBoundingClientRect().height } : setupCanvas(cv);
    const colors = { fg: css('--ink'), accent: css('--accent'), muted: css('--muted'), bad: css('--bad'), bg: css('--sunk') };
    const knobs = Object.assign(RLA.knobDefaults(viewWorld), viewKnobs);
    const world = RLA.worlds[viewWorld].make(knobs, RLA.rng.make(5));
    world.reset();
    $('#lab-world').textContent = C.worldNames[viewWorld];
    const r0 = record && record.results[policy];
    // replay a trace of states: set each state, draw, add the overlay
    const playTrace = (tr, label, overlayAt) => {
      stageFrame.length = tr.length;
      if (measure) return;
      const k = Math.min(tr.length - 1, t), st = tr[k];
      if (st && st.s) world.setState(st.s);
      world.render(ctx, w, H, colors, overlayAt ? overlayAt(k) : null);
    };
    const fonts = sceneFonts(), dark = isDark(), label = r0 ? 'Seed ' + r0.seed : null;
    if (['pendulum', 'reach', 'goalgrid'].includes(viewWorld)) {
      const replay = viewWorld === 'pendulum' && r0 && r0.replay;
      const trace = replay ? replay.trace : r0 && r0.trace;
      const tr = trace && trace.length ? trace : null;
      const sc = viewWorld === 'pendulum' ? BB.scenes.joint(ctx, w, H, { trace: tr, mass: knobs.mass, fonts, dark, label })
        // reach.js: two links of 0.5 m
        : viewWorld === 'reach' ? BB.scenes.arm(ctx, w, H, { trace: tr, state: world.getState(), L1: 0.5, L2: 0.5, fonts, dark, label })
        : BB.scenes.lab(ctx, w, H, { N: knobs.size, wall: knobs.wall > 0, trace: tr, start: tr ? r0.traceStart : world.getState(), fonts, dark, label });
      playScene(cv, sc);
      if (!tr) { $('#stage-caption').textContent = RLA.worlds[viewWorld].info.title + '. The trained policy plays here after a run.'; return; }
      const f = r0.final || {};
      $('#stage-caption').textContent = replay
        ? 'Run 1 after training, replay from hanging still. Replay score ' + fmt(replay.ret) + ' (0 is perfect). The test score uses random starts. Simulation.'
        : 'Run 1 after training, one test episode. ' + (viewWorld === 'pendulum' ? 'Score ' + fmt(f.ret) + ' (0 is perfect).' : viewWorld === 'reach' ? 'Final distance ' + fmt(f.dist) + ' m.' : (f.success ? 'It reached the goal.' : 'It did not reach the goal.')) + ' Simulation.';
      return;
    }
    if (viewWorld === 'fetch') { if (measure) { stageFrame.length = r0 && r0.trace ? r0.trace.length : 0; return; } renderFetch(cv, ctx, w, H, colors, knobs, world, r0, playTrace); return; }
    if (viewWorld === 'fork') {
      const f = r0 && r0.final;
      // fork.js: the goal is a disc of radius 0.08 at (0, 0.8)
      playScene(cv, BB.scenes.table(ctx, w, H, { paths: f && f.paths, obstacle: knobs.obstacle, goal: [0, 0.8], goalR: 0.08, mud: knobs.mud > 0, fonts, dark, label }));
      $('#stage-caption').textContent = f && f.paths ? 'Run 1 after training: ' + f.paths.length + (f.paths.every((q) => q[0][0] === f.paths[0][0][0] && q[0][1] === f.paths[0][0][1]) ? ' test paths from the home pose. ' : ' test paths from different starts. ') + Math.round(100 * f.successRate) + '% reached the goal, ' + fmt(f.crashRate) + ' obstacle hits per test. Simulation.' : 'Fork in the road: go around the obstacle, on either side, to the goal at the top.';
      return;
    }
    if (viewWorld === 'cartpole') {
      const tr = r0 && r0.trace;
      // cartpole.js: the cart stays within 2.4 m, the pole within 12 degrees
      playScene(cv, BB.scenes.balance(ctx, w, H, { trace: tr, xMax: 2.4, thMax: (12 * Math.PI) / 180, pole: knobs.poleScale, fonts, dark, label }));
      if (!tr) { $('#stage-caption').textContent = 'CartPole: a robot on a rail keeps a broom upright by moving left and right. The trained policy plays here after a run.'; return; }
      $('#stage-caption').textContent = 'Seed 1 after training: its greedy policy (no random moves) for ' + tr.length + ' steps of 0.02 s, until the broom fell or the test ended. Simulation.';
    } else if (viewWorld === 'cliff') {
      // a canyon: a few of run 1's training episodes, then its test run with arrows for its favorite move per cell
      let arrows = null;
      if (r0 && r0.table) {
        const A = 4, n = r0.table.length / A; arrows = new Int8Array(n);
        for (let s = 0; s < n; s++) {
          let b = 0, same = true;
          for (let a = 1; a < A; a++) { if (r0.table[s * A + a] !== r0.table[s * A]) same = false; if (r0.table[s * A + a] > r0.table[s * A + b]) b = a; }
          arrows[s] = same ? -1 : b;
        }
      }
      playScene(cv, BB.scenes.canyon(ctx, w, H, { cols: knobs.width, peeks: r0 && r0.peeks, epLen: r0 && r0.ep && r0.ep.len, epFalls: r0 && r0.ep && r0.ep.falls,
        test: r0 && r0.trace, arrows, cliffPenalty: knobs.cliffPenalty, sparse: !!knobs.sparseReward, fonts, dark, label }));
      $('#stage-caption').textContent = r0 ? 'Run 1, replayed: a few training episodes, then a test run with no random moves.' + (arrows ? ' Arrows: the move with the best estimate in each cell (a dot: never tried).' : '') + ' Simulation.'
        : 'Cliff walking: get from START to the flag. Each step costs 1. A fall costs ' + Math.abs(knobs.cliffPenalty) + ' and sends the robot back to START.';
    } else if (viewWorld === 'mirage') {
      // the hallway is state A; the machines behind the left door are state B
      const f = r0 && r0.final, signedMean = (knobs.mean < 0 ? '−' : '') + Math.abs(knobs.mean).toFixed(2);
      playScene(cv, BB.scenes.doors(ctx, w, H, { left: r0 && r0.ep && r0.ep.left, ret: r0 && r0.ep && r0.ep.ret, qA: f && f.qA, mean: knobs.mean, nB: knobs.machines, fonts, dark, label }));
      $('#stage-caption').textContent = f ? 'Run 1, replayed: one door per training episode. Right ends with 0. Left leads to the machines, which pay ' + signedMean + ' on average. At the end, the signs show the truth and what the robot believes. Simulation.'
        : 'The mirage. The right door ends the episode with 0. The left door leads to machines that pay ' + signedMean + ' on average, with noise.';
    } else {
      // a casino: the robot replays run 1's training pulls, then the screens show the truth and its beliefs
      const f = r0 && r0.final, b = r0 && r0.bandit;
      const sc = BB.scenes.casino(ctx, w, H, { means: f ? f.means : null, q: f ? f.q : null, arms: b && b.arm, rewards: b && b.reward, n: world.means.length, fonts, label });
      playScene(cv, sc);
      $('#stage-caption').textContent = f ? 'Run 1, replayed: its ' + b.arm.length.toLocaleString('en-US') + ' training pulls. At the end, gold is each machine\'s true average payout and blue is what the robot believes. The crown marks the best machine. Simulation.'
        : 'Ten slot machines. Each one pays a hidden average plus noise.';
    }
  }


  // ---------------------------------------------------------------- autopsy and headline numbers
  // The metric-help context: the world's action space, so entropy anchors use the real action count
  // and can tell a discrete softmax from a continuous bell curve. Derived from the world factory spec.
  const _specCache = {};
  function worldSpecOf(w, kn) {
    const key = w + ':' + JSON.stringify(kn || {});
    if (_specCache[key]) return _specCache[key];
    let spec = null;
    try { spec = RLA.worlds[w].make(Object.assign({}, kn || {}), RLA.rng.make(1)).spec; } catch (e) { spec = null; }
    return (_specCache[key] = spec);
  }
  function metricCtx() {
    const spec = worldSpecOf(S.world, S.knobs);
    const cont = spec ? !!spec.continuous : false;
    return {
      continuous: cont,
      actions: spec ? (cont ? 0 : (spec.nActions || 2)) : 2,
      dims: spec ? (spec.actDim || spec.nActions || 1) : 1,
      world: S.world,
      family: fam(S.parts),
    };
  }
  function renderAutopsy(record = runState.record) {
    const box = $('#symptoms'); box.replaceChildren();
    if (!S.results.length) { box.append(h('p.small', { text: 'No run yet.' })); return null; }
    const a = RLA.autopsy(record ? record.results : S.results);
    if (!a.symptoms.length) box.append(h('p.small', { text: 'No symptom found.' }));
    for (const s of a.symptoms) box.append(h('div.sym.' + s.level, null, [h('span.dot'), h('div', null, [h('b', { text: s.label }), h('p', { text: s.evidence })])]));
    for (const n of S.results[0].notes || []) box.append(h('p.small', { text: 'Note: ' + n }));
    box.append(h('p.small', { text: 'Measured on ' + S.results.length + ' run' + (S.results.length > 1 ? 's' : '') + '. ' + (S.source === 'local' ? 'Saved in this browser. Simulation.' : S.stored ? 'Stored simulation.' : 'Trained in this page. Simulation.') }));
    if (window.RLHELP) window.RLHELP.enhance(box, metricCtx());
    return a;
  }
  // an expert reads the finished run: what the value chart shows and why the words cause it (web/expert.js)
  function renderExpert(cfg, a) {
    const card = $('#expert-card'), box = $('#expert');
    const notes = a && C.expert ? C.expert(cfg, a, S.pinA) : null;
    if (!notes || !notes.length) { card.hidden = true; return; }
    box.replaceChildren(...notes.map((n) => h('div.xnote', null, [h('b', { text: n.title }), h('div', { html: n.html })])),
      h('p.small.muted', { text: 'The first note reads your run. The others quote runs logged in this page\'s experiment log, with their settings. Simulation.' }));
    card.hidden = false;
    card.open = S.mode !== 'campaign';
    if (window.RLHELP) window.RLHELP.enhance(box, metricCtx());
  }
  // "Did you notice?": ask the player to read one chart before the page explains the surprise
  function renderWonder(cfg, a) {
    const box = $('#wonder');
    const wq = C.wonderPick ? C.wonderPick(cfg, a, S.wondered) : null;
    if (!wq) { box.hidden = true; return; }
    S.wondered[wq.id] = (S.wondered[wq.id] || 0) + 1; save();
    const chartEl = wq.charts.map((id) => document.getElementById(id)).find(Boolean);
    const box2 = chartEl ? chartEl.closest('.chart-wrap') || chartEl.parentNode : null;
    const look = () => { if (!box2) return; box2.classList.remove('look'); void box2.offsetWidth; box2.classList.add('look'); box2.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const opts = wq.options.map(([t, ok], i) => [t, ok, i]).sort((x, y) => ((x[2] * 7 + S.found.length) % 3) - ((y[2] * 7 + S.found.length) % 3));
    const reveal = h('div.stack', { hidden: true }, [
      h('p', { html: '<b>What your run shows:</b> ' + wq.evidence }),
      h('p', { html: '<b>Why:</b> ' + wq.why }),
      // the expert notes button only when the expert card is there (h() drops a null child; raw append would print "null")
      $('#expert-card').hidden ? null : h('div.row', null, [h('button.btn.ghost.tiny', { type: 'button', onclick: openExpert }, 'Read the expert notes on this run')]),
    ]);
    const btns = opts.map(([t, ok]) => h('button.btn.ghost.wopt', { type: 'button', onclick: (e) => {
      for (const b of btns) { b.disabled = true; }
      e.currentTarget.classList.add(ok ? 'right' : 'wrong');
      if (!ok) btns[opts.findIndex((o) => o[1])].classList.add('right');
      recordAnswer('wonder:' + wq.id + ':' + S.wondered[wq.id], t, ok);
      reveal.hidden = false;
    } }, t));
    box.replaceChildren(
      h('div.row', { style: 'justify-content:space-between' }, [h('div.eyebrow', { text: 'Did you notice?' }), box2 ? h('button.btn.ghost.tiny', { type: 'button', onclick: look }, 'Show me the chart') : null]),
      h('h3', { text: 'Something surprising happened in this run' }),
      h('p', { text: wq.ask }), h('div.wopts', null, btns), reveal);
    box.hidden = false;
    if (window.RLHELP) window.RLHELP.enhance(box, metricCtx());
  }
  function openExpert() {
    const d = $('#expert-card');
    if (d.hidden) { toast('Run a sentence first: the expert reads a finished run.'); return; }
    d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function headline(a, world) {
    const s = a.summary;
    if (world === 'bandit') return 'best machine in ' + Math.round(100 * s.optimalLast20) + '% of late pulls';
    if (world === 'mirage') return 'left door in ' + Math.round(100 * s.leftPeak) + '% of episodes at the worst point';
    if (world === 'cliff') return 'score ' + fmt(s.finalReturn) + ', ' + fmt(s.fallsPerEpisode) + ' falls per episode while learning';
    if (world === 'pendulum') return 'test score ' + Math.round(isFinite(s.pendulumScore) ? s.pendulumScore : s.finalReturn) + (isFinite(s.worstSeed) ? ', worst seed ' + Math.round(s.worstSeed) : '') + ' (0 is perfect)';
    if (world === 'reach') return 'final distance ' + fmt(s.meanDist) + ' m, test score ' + fmt(isFinite(s.testReturn) ? s.testReturn : s.finalReturn) + (isFinite(s.baseRet) ? ' (classical controller alone, same starts: ' + fmt(s.baseDist) + ' m, ' + fmt(s.baseRet) + ')' : '');
    if (world === 'fork') return Math.round(100 * s.successRate) + '% of tests reach the goal, ' + fmt(s.crashRate) + ' obstacle hits per test';
    if (world === 'goalgrid') return Math.round(100 * s.successRate) + '% of new prompts solved';
    if (world === 'fetch') return 'got the stick in ' + Math.round(100 * s.successRate) + '% of test throws, ' + fmt(s.testReturn) + ' reward per throw';
    if (world === 'cartpole' && S.lastCfg && S.lastCfg.knobs && S.lastCfg.knobs.maxSteps) return 'score ' + Math.round(s.finalReturn) + ' of ' + S.lastCfg.knobs.maxSteps + (fam(S.lastCfg.parts) === 'value' ? ', largest |Q| ' + short(s.maxQ) : '');
    return 'score ' + Math.round(s.finalReturn) + ' of 200' + (S.lastCfg && fam(S.lastCfg.parts) !== 'value' ? '' : ', largest |Q| ' + short(s.maxQ));
  }

  // ---------------------------------------------------------------- run
  function budgetOptions() {
    const ss = $('#seeds'), so = C.seedOptions[S.world], curS = +ss.value;
    ss.replaceChildren(...so.map((n, i) => h('option', { value: n, text: String(n), selected: so.includes(curS) ? n === curS : i === Math.min(1, so.length - 1) })));
    const sel = $('#budget'); const opts = C.budgetsOf(S.parts, S.world);
    const cur = +sel.value;
    sel.replaceChildren(...opts.map((n) => h('option', { value: n, text: short(n), selected: n === (opts.includes(cur) ? cur : opts[C.budgetDefault[S.world]]) })));
  }
  // the training settings: the world's, plus a level's own (a level may set a step size or a batch for its lesson)
  function hyperNow() {
    const lv = S.mode === 'campaign' ? C.levels.find((l) => l.id === S.level) : null;
    return Object.assign(C.hyperOf(S.parts, S.world), lv && lv.world === S.world && lv.hyper ? lv.hyper : {});
  }
  const fastClient = window.RLFAST.createCache(window.BB_FAST);
  let activeRun = null;
  let campaignRunLevel = null;
  function runIdentity() {
    return RLA.exact.stringify({ mode: S.mode, level: S.level, world: S.world, parts: S.parts, knobs: S.knobs,
      hyper: hyperNow(), steps: +$('#budget').value, seeds: +$('#seeds').value, runMode: $('#run-mode').value });
  }
  function recordConfig() {
    return RLA.exact.resolve({ world: S.world, knobs: S.knobs, parts: S.parts, hyper: hyperNow(), steps: +$('#budget').value },
      range(1, +$('#seeds').value).map(i => i * 101), window.BB_FAST.versions, C);
  }
  function linkRun() {
    const record = runState.record;
    for (const el of $$('#stage, #charts, #charts canvas, #run-result, #symptoms, #expert, #wonder, #run-source')) {
      if (record) { if (!el.dataset.interactive) el.dataset.run = record.id; el.dataset.stale = String(runState.stale); }
      else { delete el.dataset.run; delete el.dataset.stale; }
    }
    $('#run-stale').hidden = !runState.stale;
    $('#scene-controls').hidden = !record;
  }
  function markRunStale() {
    if (!runState.record || !RLA.worlds[S.world]) return;
    runState.change(S.mode === 'campaign' ? S.level : S.mode, recordConfig());
    if (runState.stale) { pauseScene(); $('#run-btn').disabled = false; }
    linkRun();
  }
  function dropRun() {
    pauseScene(); runState.clear(); S.results = []; S.lastCfg = null; S.lastA = null;
    sceneTime = 0; scenePolicy = 0; adapter = null; linkRun();
    const cv = $('#stage'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    delete cv.dataset.world; delete cv.dataset.frame; delete cv.dataset.interactive; cv.onclick = null;
    $('#scene-policy').textContent = ''; $('#scene-seed').replaceChildren(); $('#run-source').textContent = '';
    $('#run-result').textContent = ''; $('#expert-card').hidden = true; $('#wonder').hidden = true;
    $('#charts').replaceChildren(h('p.small', { text: 'Curves appear here while a run trains.' }));
    $('#symptoms').replaceChildren(h('p.small', { text: 'No run yet.' }));
  }
  function showRunPending() {
    $('#run-result').textContent = 'New run in progress…';
    $('#charts').replaceChildren(h('p.small', { role: 'status', text: 'Preparing this run. Curves appear when training reports progress.' }));
    $('#symptoms').replaceChildren(h('p.small', { role: 'status', text: 'New run in progress. The autopsy appears when it finishes.' }));
    renderStage();
    $('#stage-caption').textContent = 'New run in progress. The replay appears when it finishes.';
    drawCompare();
  }
  function showRunStopped(message) {
    $('#run-result').textContent = message;
    $('#charts').replaceChildren(h('p.small', { text: 'No curves are available because this run did not finish.' }));
    $('#symptoms').replaceChildren(h('p.small', { text: 'No autopsy is available because this run did not finish.' }));
    $('#stage-caption').textContent = message + ' Run the sentence again to see a replay.';
    drawCompare();
  }
  function cancelRun() {
    if (!activeRun) return;
    activeRun.controller.abort(); activeRun = null;
    stopAll(new Error('cancelled'));
    S.running = false; $('#run-btn').disabled = false;
    $('#prog').style.width = '0%';
    $('#run-source').textContent = 'Settings changed. Run this sentence to measure it.';
    showRunStopped('Run canceled after the settings changed.');
  }
  const vpoActive = () => S.mode === 'campaign' && S.level === 'vpo';
  const supermimicActive = () => S.mode === 'campaign' && S.level === 'supermimic';
  const customActive = () => vpoActive() || supermimicActive();
  const customApi = () => supermimicActive() ? BBSUPERMIMIC : BBVPO;
  async function run() {
    if (customActive()) return customApi().run();
    if (S.running) return null;
    S.running = true; $('#run-btn').disabled = true;
    const nSeeds = +$('#seeds').value, steps = +$('#budget').value;
    const cfg = { world: S.world, knobs: Object.assign({}, S.knobs), parts: Object.assign({}, S.parts), hyper: hyperNow(), steps };
    const ticket = { controller: new AbortController(), identity: runIdentity() }; activeRun = ticket;
    const current = () => activeRun === ticket && !ticket.controller.signal.aborted && runIdentity() === ticket.identity;
    dropRun(); S.lastCfg = cfg;
    $('#expert-card').hidden = true; $('#wonder').hidden = true;
    const seeds = range(1, nSeeds).map((i) => i * 101);
    S.results = [];
    S.lastA = null;
    showRunPending();
    const prog = $('#prog'); prog.style.width = '2%';
    S.stored = false; S.source = 'live';
    $('#run-source').textContent = $('#run-mode').value === 'fast' ? 'Looking for an exact stored simulation…' : 'Live simulation: training in this page.';
    let completed = false;
    try {
      const config = RLA.exact.resolve(cfg, seeds, window.BB_FAST.versions, C);
      let stored = null;
      if ($('#run-mode').value === 'fast') {
        stored = await fastClient.lookup(config, ticket.controller.signal);
        if (!current()) return null;
        $('#run-source').textContent = stored.record
          ? (stored.source === 'local' ? 'Saved in this browser: loading measured results.' : 'Stored simulation: loading measured results.')
          : 'Live simulation: training in this page.';
      }
      const results = stored && stored.record ? stored.record.results : await runSeeds(cfg, seeds, (partials) => {
        if (!current()) return;
        const done = partials.reduce((s, p) => s + p.t, 0) / (steps * seeds.length);
        prog.style.width = Math.round(100 * done) + '%';
        if (S.world !== 'bandit' && S.world !== 'mirage') renderCharts(partials, false);
      });
      if (!current()) return null;
      const savedLocally = !(stored && stored.record) && await fastClient.save(config, results);
      if (!current()) return null;
      S.stored = !!(stored && stored.record);
      S.source = S.stored ? stored.source : 'live';
      $('#run-source').textContent = S.stored
        ? (S.source === 'local' ? 'Saved in this browser. Simulation. Ordered seeds: ' : 'Stored simulation. Ordered seeds: ') + seeds.join(', ') + '. Budget: ' + steps + ' steps per seed. Version: ' + window.BB_FAST.base.split('/').pop() + '. Recorded replay seed: ' + seeds[0] + '. Live reruns can vary numerically across browsers.'
        : 'Live simulation: trained in this page. Replay seed: ' + seeds[0] + '.' + (savedLocally ? ' Saved in this browser for next time.' : '');
      const record = await RLA.runRecord.create({ level: S.mode === 'campaign' ? S.level : S.mode, config, results,
        source: S.source, label: nameOf(cfg.parts, cfg.world), name: (recognize(cfg.parts, cfg.world) || {}).id || 'current',
        comparison: S.pinA && S.pinA.world === cfg.world ? S.pinA.record : null });
      if (!current()) return null;
      runState.accept(record); S.results = record.results;
      $('#scene-policy').textContent = record.policies[0].label;
      $('#scene-seed').replaceChildren(...record.results.map((r, i) => h('option', { value: i, text: String(r.seed) })));
      renderCharts(results.map((r) => ({ evals: r.evals, diag: r.diag })), true);
      renderStage();
      const a = renderAutopsy();
      S.lastA = a;
      renderExpert(cfg, a);
      renderWonder(cfg, a);
      const rec = recognize(cfg.parts, cfg.world);
      if (rec && !S.seen.includes(rec.id)) S.seen.push(rec.id);
      const works = C.works[cfg.world](a);
      if (rec && rec.card && works) discover(rec.card, cfg, a);
      for (const f of C.failures) if (!S.found.includes(f.card) && f.when(a, cfg)) discover(f.card, cfg, a);
      for (const f of C.knobFinds || []) if (!S.found.includes(f.card) && f.when(a, cfg)) discover(f.card, cfg, a);
      $('#run-result').replaceChildren(h('b', { text: works ? 'Works on ' + C.worldNames[cfg.world] + ': ' : 'Does not work yet: ' }), headline(a, cfg.world) + '.');
    if (window.RLHELP) window.RLHELP.enhance($('#run-result'), metricCtx());
      save(); refreshSentences(); drawCompare();
      linkRun();
      if (S.afterRun) S.afterRun(a);
      completed = true;
      return a;
    } catch (err) {
      if (current()) {
        const message = 'Run failed: ' + err.message;
        toast(message);
        $('#run-source').textContent = message + '.';
        showRunStopped('The run did not finish.');
      }
      return null;
    } finally {
      if (activeRun === ticket) { activeRun = null; S.running = false; $('#run-btn').disabled = false; prog.style.width = completed ? '100%' : '0%'; }
    }
  }
  // ---------------------------------------------------------------- discovery celebration
  // One short burst + name reveal for any card the player sees for the first time. Every true
  // discovery funnels here: discover() below (methods built and working, failures seen, knob finds),
  // and a level's genuine first reveal (reveal / revealOnDone). A known card, a reload or revisiting
  // a node never queues, so nothing replays.
  const freshNodes = new Set();          // cards revealed this session: their tree node lights up once
  let celQueue = [], celTimer = null, celActive = null;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function queueCelebration(cardId) {
    if (!C.cards[cardId]) return;
    freshNodes.add(cardId);
    celQueue.push(cardId);
    // debounce so one run's discoveries (a method plus failures, or a run plus a level reveal) land together
    clearTimeout(celTimer); celTimer = setTimeout(flushCelebration, 120);
  }
  function flushCelebration() {
    const ids = celQueue; celQueue = [];
    if (ids.length) showCelebration(ids);
  }
  function dcItem(id) {
    const c = C.cards[id];
    const kind = c.kind === 'failure' ? 'Failure' : c.kind === 'frontier' ? 'Frontier model'
      : S.found.includes(id) ? 'Method, built by you' : 'Method, given by a level';
    return h('div.dc-item', null, [
      h('div.dc-kind', { text: kind }),
      h('div.dc-name', null, [h('span.dc-q', { 'aria-hidden': 'true', text: '???' }), h('span.dc-real', { text: c.name })]),
      h('div.dc-node', { 'aria-hidden': 'true' }, [h('span', { text: c.short || c.name })]),
    ]);
  }
  function showCelebration(ids) {
    if (celActive && celActive._dismiss) celActive._dismiss();
    let done = false, onKey = null;
    const overlay = h('div.dc', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [
      h('div.dc-burst', { 'aria-hidden': 'true' }),
      h('div.dc-card', null, [
        h('div.dc-eyebrow', { text: ids.length > 1 ? ids.length + ' new discoveries' : 'New discovery' }),
        h('div.dc-items', null, ids.map(dcItem)),
        h('div.dc-skip', { 'aria-hidden': 'true', text: 'click or press any key to continue' }),
      ]),
    ]);
    const dismiss = () => {
      if (done) return; done = true;
      if (onKey) window.removeEventListener('keydown', onKey);
      overlay.classList.add('dc-out');
      if (celActive === overlay) celActive = null;
      setTimeout(() => overlay.remove(), reducedMotion() ? 130 : 220);
    };
    // a deliberate click or key dismisses the celebration (it does not activate anything behind it);
    // focus is never moved and no key is swallowed, so the game keeps working underneath
    onKey = (e) => { if (e.key === 'Tab' || /^(Shift|Control|Alt|Meta)$/.test(e.key)) return; dismiss(); };
    overlay._dismiss = dismiss;
    celActive = overlay;
    document.body.append(overlay);
    overlay.addEventListener('click', dismiss);
    window.addEventListener('keydown', onKey);
    setTimeout(dismiss, 1900); // short: the reveal plays, then it gets out of the way
  }
  function discover(cardId, cfg, a) {
    if (S.found.includes(cardId)) return;
    const alreadyKnown = S.given.includes(cardId); // already on the tree as a level's gift
    S.found.push(cardId);
    S.discoveries[cardId] = discoveryRecord(cfg, a);
    save(); updateScore();
    if (!alreadyKnown) queueCelebration(cardId); // only a first-ever card celebrates
  }
  // the words that matter in a sentence, as text
  function sentenceText(p, world) {
    const idle = idleWords(p, world);
    return gridKeys(p, world).filter((k) => !idle[k]).map((k) => SHORT[k] + ': ' + wordText(k, p[k])).join('; ');
  }
  function discoveryRecord(cfg, a) {
    const lv = S.mode === 'campaign' ? C.levels.find((l) => l.id === S.level) : null;
    const qs = lv ? [['predict', lv.predict], ['diagnose', lv.diagnose], ['explain', lv.explain]].filter((x) => x[1] && x[1].id) : [];
    return {
      run: runState.record && runState.record.id,
      ts: new Date().toISOString(), world: C.worldNames[cfg.world], family: C.families[fam(cfg.parts)].name,
      sentence: sentenceText(cfg.parts, cfg.world), result: headline(a, cfg.world) + ' (' + cfg.steps + ' steps, ' + S.results.length + ' seeds)',
      where: lv ? 'Campaign level "' + lv.title + '"' : S.mode === 'workbench' ? 'Workbench' : S.mode,
      predictions: qs.length ? qs.map(([k, q]) => k + ' ' + (S.answers[q.id] ? (S.answers[q.id].correct ? 'right' : 'wrong') : 'not answered')).join(', ') + ' (first tries)' : 'no level questions',
    };
  }

  const plainText = (html) => { const d = document.createElement('div'); d.innerHTML = String(html || ''); return d.textContent.replace(/\s+/g, ' ').trim(); };
  // ranks: one per stretch of the campaign (levels done)
  const RANKS = [[0, 'Newcomer'], [1, 'Bandit tamer'], [3, 'Cliff walker'], [5, 'Value wrangler'], [7, 'Policy climber'], [9, 'Gradient pilot'],
    [11, 'Swing-up artist'], [13, 'Offline archivist'], [15, 'Frontier roboticist'], [17, 'Bellman breaker']];
  function rankOf(n) { let r = RANKS[0][1]; for (const [k, name] of RANKS) if (n >= k) r = name; return r; }
  function updateScore() {
    const q = Object.values(S.answers), right = q.filter((x) => x.correct).length;
    const rv = Object.values(S.reviews).reduce((s, r) => s + r.right, 0);
    const ms = allMethodCards(), fs = failCards();
    const nm = ms.filter((id) => S.found.includes(id)).length, nf = fs.filter((id) => S.found.includes(id)).length;
    const done = S.done.filter((id) => C.levels.some((l) => l.id === id)).length;
    const pill = (label, value, title) => h('span.pill', { title }, [h('b', { text: value }), ' ' + label]);
    $('#score').replaceChildren(
      h('span.rank', { title: 'Your rank grows with the campaign levels you finish' }, rankOf(done)),
      pill('levels', done + '/' + C.levels.length, 'Campaign levels finished'),
      pill('methods', nm + '/' + ms.length, 'Methods you built and saw work'),
      pill('failures', nf + '/' + fs.length, 'Failures you caused and saw'),
      pill('predictions', right + '/' + q.length, 'Predictions right on the first try'),
      ...(rv ? [pill('rebuilt', String(rv), 'Methods rebuilt from memory in Review')] : []));
    $('#xp').style.width = (100 * done / Math.max(1, C.levels.length)).toFixed(1) + '%';
  }


  // ---------------------------------------------------------------- how many discoveries are left: a map by group
  function methodCards(family, world) {
    const ids = [];
    for (const r of C.recipes) {
      if (!r.card || (r.family || 'value') !== family || ids.includes(r.card)) continue;
      if (world && family === 'value' && (r.world === 'bandit') !== (world === 'bandit')) continue;
      ids.push(r.card);
    }
    return ids;
  }
  const allMethodCards = () => ['value', 'pg', 'ac'].flatMap((f) => methodCards(f)).concat(C.rewardMethods || []);
  const failCards = () => Object.keys(C.cards).filter((id) => C.cards[id].kind === 'failure');
  const MAP_GROUPS = () => [
    { title: 'Slot machines (value learning)', ids: methodCards('value', 'bandit') },
    { title: 'Grid worlds and CartPole (value learning)', ids: methodCards('value', 'cliff') },
    { title: 'Policy gradient', ids: methodCards('pg') },
    { title: 'Actor-critic, offline learning and the frontier', ids: methodCards('ac') },
    { title: 'Failures', ids: failCards() },
    { title: 'Reward design', ids: C.rewardMethods || [] },
  ];
  function groupOf(cardId, world, family) {
    if (cardId && C.cards[cardId] && C.cards[cardId].kind === 'failure') return 4;
    if (cardId && (C.rewardMethods || []).includes(cardId)) return 5;
    if (family === 'pg') return 2;
    if (family === 'ac') return 3;
    return world === 'bandit' ? 0 : 1;
  }
  let showHints = false;
  // only: index of one group to show (with a total line), or undefined for every group
  function discoveryMap(only) {
    const groups = MAP_GROUPS(), box = h('div.stack.dmap');
    const draw = () => {
      const ms = allMethodCards(), fs = failCards(), mf = ms.filter((id) => S.found.includes(id)).length, ff = fs.filter((id) => S.found.includes(id)).length;
      const rows = groups.map((g, i) => ({ g, i })).filter(({ i }) => only === undefined || i === only).map(({ g }) => {
        const got = g.ids.filter((id) => S.found.includes(id)), left = g.ids.length - got.length;
        const recOf = (id) => recipeOfCard(id);
        return h('div.dgroup', null, [
          h('p', { html: '<b>' + g.title + '</b>: ' + got.length + ' of ' + g.ids.length + ' found' + (left ? ', ' + left + ' left.' : '. All found.') }),
          h('div.row.dchips', null, got.concat(g.ids.filter((id) => !S.found.includes(id))).map((id) => S.found.includes(id)
            ? h('span.chip.dfound', { text: C.cards[id].short || C.cards[id].name })
            : h('span.chip.dleft', { title: 'Not found yet' }, showHints && recOf(id) ? '? ' + recOf(id).blurb : '?'))),
        ]);
      });
      const hintBtn = h('button.btn.ghost.tiny', { type: 'button', onclick: () => { showHints = !showHints; draw(); } }, showHints ? 'Hide the hints' : 'Show a one-line hint for each method left');
      box.replaceChildren(
        h('div.eyebrow', { text: 'What is left to discover' }),
        h('p.small', { text: 'In the whole game: ' + mf + ' of ' + ms.length + ' methods and ' + ff + ' of ' + fs.length + ' failures. A method opens when you write its sentence and it passes the world\'s test; a failure opens when a run shows it. Two more cards (π0.5 and π0.7) are readings that the last levels give you.' }),
        ...rows, h('div.row', null, [hintBtn]));
    };
    draw();
    return box;
  }

  // ---------------------------------------------------------------- contrasting cases: pin run A, compare with the next run
  function pinA() {
    if (!S.results.length) return;
    S.pinA = { record: runState.record, world: S.world, parts: Object.assign({}, S.lastCfg.parts), knobs: Object.assign({}, S.lastCfg.knobs), steps: S.lastCfg.steps,
      curves: curvesOf(S.results, S.world), head: headline(S.lastA, S.world), name: nameOf(S.lastCfg.parts, S.world), summary: S.lastA ? S.lastA.summary : null };
    drawCompare(); $('#charts').replaceChildren(); renderCharts(S.results.map((r) => ({ evals: r.evals, diag: r.diag })), true);
    toast('Pinned as A. Change one word, run, and compare.');
  }
  function nameOf(p, world) {
    const rec = recognize(p, world);
    return rec && ((rec.card && (S.found.includes(rec.card) || S.given.includes(rec.card))) || (!rec.card && S.seen.includes(rec.id))) ? rec.name : 'unnamed sentence';
  }
  function drawCompare() {
    const box = $('#compare'); box.replaceChildren();
    const A = S.pinA;
    const pinBtn = h('button.btn.ghost', { type: 'button', disabled: !S.results.length, onclick: pinA }, A ? 'Pin this run as A instead' : 'Pin this run as A');
    if (!A) { box.append(h('div.row', null, [pinBtn, h('span.small', { text: 'Compare two sentences that differ by one word.' })])); return; }
    const diff = wordDiff(A.parts, S.parts, S.world);
    const sameWorld = A.world === S.world;
    box.append(
      h('p.small', { html: '<b>A</b> (dashed after the next run): ' + A.name + ' on ' + C.worldNames[A.world] + ': ' + A.head + '.' }),
      h('p.small', null, [h('b', { text: 'Now: ' }), diff.length ? 'the sentence differs from A in ' + diff.length + ' word' + (diff.length > 1 ? 's' : '') + ': ' + diffText(diff) + '.' : 'the same words as A.',
        sameWorld ? '' : ' A ran on another world, so the charts do not show it.']),
      h('div.row', null, [pinBtn,
        h('button.btn.ghost', { type: 'button', onclick: () => { S.parts = Object.assign({}, A.parts); onPartsChanged(); drawCompare(); } }, 'Restore A\'s words'),
        h('button.btn.ghost', { type: 'button', onclick: () => { S.pinA = null; drawCompare(); $('#charts').replaceChildren(); if (S.results.length) renderCharts(S.results.map((r) => ({ evals: r.evals, diag: r.diag })), true); } }, 'Clear A')]),
    );
    if (window.RLHELP) window.RLHELP.enhance(box, metricCtx());
  }

  // ---------------------------------------------------------------- try every combination of a few words (a full factorial table)
  // One number per run, with its direction. Lower is better only in the mirage.
  function metricOf(a, world) {
    const s = a.summary;
    if (world === 'bandit') return { v: 100 * s.optimalLast20, up: true, pct: true, label: '% of late pulls on the best machine' };
    if (world === 'mirage') return { v: 100 * s.leftPeak, up: false, pct: true, label: '% left door at the worst point (lower is better)' };
    if (world === 'cliff') return { v: s.finalReturn, up: true, label: 'greedy score' };
    if (world === 'pendulum') return { v: isFinite(s.pendulumScore) ? s.pendulumScore : s.finalReturn, up: true, label: 'test score (0 is perfect)' };
    if (world === 'reach') return { v: isFinite(s.testReturn) ? s.testReturn : s.finalReturn, up: true, label: 'test score' };
    if (world === 'fork' || world === 'goalgrid' || world === 'fetch') return { v: 100 * s.successRate, up: true, pct: true, label: '% of tests solved' };
    return { v: s.finalReturn, up: true, label: 'score' };
  }
  // The grid's metric header cell: the level's measure name plus the shared metric-help trigger
  function gridMetricHead(m) {
    const th = h('th', null, [m.label]);
    if (window.RLHELP) th.append(window.RLHELP.trigger('gridmetric', undefined, Object.assign(metricCtx(), { label: m.label, pct: m.pct, up: m.up })));
    return th;
  }
  // The +- on a cell: the standard error of the very number the cell shows. The number is
  // recomputed on bootstrap samples of the seeds (drawn again, with replacement), so the error
  // belongs to the same statistic as the center even when that statistic is not a plain mean
  // over seeds (the mirage shows the worst of three windows). A fixed stream keeps every cell
  // reproducible.
  function metricSE(res, world) {
    const n = res.length;
    if (n < 2) return NaN;
    const rng = RLA.rng.make(1337), draws = [];
    for (let b = 0; b < 200; b++) {
      const rs = [];
      for (let i = 0; i < n; i++) rs.push(res[Math.floor(rng.next() * n)]);
      const v = metricOf(RLA.autopsy(rs), world).v;
      if (isFinite(v)) draws.push(v);
    }
    if (draws.length < 2) return NaN;
    const m = draws.reduce((s, x) => s + x, 0) / draws.length;
    return Math.sqrt(draws.reduce((s, x) => s + (x - m) ** 2, 0) / (draws.length - 1));
  }
  const gridKeys = (p, world) => (world === 'bandit' && fam(p) === 'value' ? ['eps', 'ucb', 'optimistic', 'step'] : C.families[fam(p)].keys);
  const optVals = (k) => W[k].options.map((o) => o[0]);
  const GRID_MAX = 32;
  const G = { world: null, family: null, keys: [], rows: [], running: false, stop: false, combos: 0, cfgText: '', metric: null };
  function gridDefaults() {
    G.world = S.world; G.family = fam(S.parts); G.rows = []; G.metric = null;
    const ks = gridKeys(S.parts, S.world), focus = (S.mode === 'campaign' ? S.focus || [] : []).filter((k) => ks.includes(k));
    G.keys = S.world === 'bandit' ? ks.slice() : focus.slice(0, 3);
    while (G.keys.length && nCombos(G.keys) > GRID_MAX) G.keys.pop();
  }
  const nCombos = (keys) => keys.reduce((n, k) => n * optVals(k).length, 1);
  function cartesian(lists) { return lists.reduce((acc, l) => acc.flatMap((c) => l.map((v) => c.concat([v]))), [[]]); }
  const sameVal = (a, b) => a === b;
  function gridView() {
    const box = h('div.stack', { id: 'grid-box' });
    gridDefaults();
    drawGrid._box = box;
    return box;
  }
  function drawGrid() {
    const box = drawGrid._box; if (!box) return;
    if (!G.running && (G.world !== S.world || G.family !== fam(S.parts))) gridDefaults();
    const ks = gridKeys(S.parts, S.world), n = nCombos(G.keys), seeds = +$('#seeds').value, steps = +$('#budget').value;
    const chips = h('div.row.grid-words', null, ks.map((k) => h('button.chip.gw' + (G.keys.includes(k) ? '.on' : ''), {
      type: 'button', disabled: G.running, 'aria-pressed': G.keys.includes(k) ? 'true' : 'false', title: W[k].q + ' (' + optVals(k).length + ' options)',
      onclick: () => { G.keys = G.keys.includes(k) ? G.keys.filter((x) => x !== k) : G.keys.concat([k]); G.keys.sort((a, b) => ks.indexOf(a) - ks.indexOf(b)); drawGrid(); } },
      SHORT[k] + ' ×' + optVals(k).length)));
    const tooMany = n > GRID_MAX, none = !G.keys.length;
    const runBtn = h('button.btn', { type: 'button', disabled: G.running || tooMany || none, onclick: runGrid }, none ? 'Pick words first' : 'Run all ' + n + ' combinations');
    const stopBtn = G.running ? h('button.btn.ghost', { type: 'button', onclick: () => { G.stop = true; } }, 'Stop after this one') : null;
    box.replaceChildren(
      h('p.small', { text: 'Pick 1 to 4 words. Every combination of their options runs with the other words as in your sentence, on the same seeds (' + seeds + ') and steps (' + short(steps) + ') as Run. Running here does not count as a discovery: to name a method, put its words in your sentence and press Run.' }),
      chips,
      h('div.row', null, [runBtn, stopBtn, h('span.small', { text: tooMany ? n + ' combinations: too many (at most ' + GRID_MAX + '). Remove a word.' : none ? '' : n + ' combinations × ' + seeds + ' seeds = ' + (n * seeds) + ' runs.' })]),
      h('p.small', { id: 'grid-status', text: G.status || '' }),
    );
    if (G.rows.length) box.append(gridMatrix(), gridEffects(), gridList());
  }
  async function runGrid() {
    if (S.running) { toast('Wait for the current run to finish.'); return; }
    const keys = G.keys.slice(), combos = cartesian(keys.map(optVals));
    const nSeeds = +$('#seeds').value, steps = +$('#budget').value, seeds = range(1, nSeeds).map((i) => i * 101);
    const base = Object.assign({}, S.parts), knobs = Object.assign({}, S.knobs), hyper = hyperNow(), world = S.world;
    const fast = $('#run-mode').value === 'fast', identity = runIdentity();
    S.running = true; G.running = true; G.stop = false; G.rows = []; G.runKeys = keys; G.base = base; G.metric = null;
    G.cfgText = C.worldNames[world] + ', ' + nSeeds + ' seed' + (nSeeds > 1 ? 's' : '') + ', ' + short(steps) + ' steps';
    $('#run-btn').disabled = true;
    const t0 = performance.now();
    try {
      for (let i = 0; i < combos.length && !G.stop; i++) {
        const parts = Object.assign({}, base); keys.forEach((k, j) => { parts[k] = combos[i][j]; });
        const left = i ? Math.round((performance.now() - t0) / i * (combos.length - i) / 1000) : null;
        G.status = 'Running combination ' + (i + 1) + ' of ' + combos.length + (left != null ? ', about ' + left + ' s left' : '') + '…'; drawGrid();
        const cfg = { world, knobs, parts, hyper, steps };
        const config = RLA.exact.resolve(cfg, seeds, window.BB_FAST.versions, C);
        const stored = fast ? await fastClient.lookup(config) : null;
        if (runIdentity() !== identity) throw new Error('Settings changed. Run the table again.');
        const res = stored && stored.record ? stored.record.results : await runSeeds(cfg, seeds, () => {});
        if (runIdentity() !== identity) throw new Error('Settings changed. Run the table again.');
        if (!(stored && stored.record)) await fastClient.save(config, res);
        if (runIdentity() !== identity) throw new Error('Settings changed. Run the table again.');
        const a = RLA.autopsy(res), m = metricOf(a, world);
        const se = metricSE(res, world);
        G.metric = m;
        G.rows.push({ vals: combos[i], parts, v: m.v, se, works: C.works[world](a), rec: recognize(parts, world), stored: !!(stored && stored.record), source: stored && stored.source });
      }
      G.status = (G.stop ? 'Stopped after ' + G.rows.length + ' of ' + combos.length + ' combinations. ' : 'Done: ' + combos.length + ' combinations in ' + Math.round((performance.now() - t0) / 1000) + ' s. ') + G.cfgText + '. Simulation.';
      if (fast) G.status += ' ' + G.rows.filter(r => r.stored).length + ' stored simulations (' + G.rows.filter(r => r.source === 'local').length + ' saved in this browser); the others ran Live. Ordered seeds: ' + seeds.join(', ') + '. Version: ' + window.BB_FAST.base.split('/').pop() + '.';
    } catch (err) {
      G.status = 'A combination failed: ' + err.message;
    } finally {
      S.running = false; G.running = false; $('#run-btn').disabled = false; drawGrid();
    }
  }
  const gfmt = (x) => (isFinite(x) && Math.abs(x) >= 1 ? x.toFixed(1) : fmt(x));
  // a percent metric prints a % sign on its numbers; a score stays bare
  const gunit = (m) => (m && m.pct ? '%' : '');
  function rowName(r) {
    const rec = r.rec;
    if (!rec) return '';
    if (rec.card) return S.found.includes(rec.card) || S.given.includes(rec.card) ? rec.name : '? a method you have not found yet';
    return S.seen.includes(rec.id) ? rec.name : '';
  }
  function useRow(r) {
    S.parts = Object.assign({}, r.parts); onPartsChanged();
    toast('Your sentence now has these words. Press Run to test it.');
  }
  // The table as a matrix: half of the words on the rows, the others on the columns. Shade: better (green) or worse (red) than the median.
  function gridMatrix() {
    const keys = G.runKeys, m = G.metric, rk = keys.slice(0, Math.ceil(keys.length / 2)), ck = keys.slice(rk.length);
    const rCombos = cartesian(rk.map(optVals)), cCombos = cartesian(ck.map(optVals));
    const find = (rv, cv) => G.rows.find((r) => rk.every((k, j) => sameVal(r.vals[keys.indexOf(k)], rv[j])) && ck.every((k, j) => sameVal(r.vals[keys.indexOf(k)], cv[j])));
    const vs = G.rows.map((r) => r.v).sort((a, b) => a - b), med = vs[Math.floor(vs.length / 2)], spread = Math.max(1e-9, vs[vs.length - 1] - vs[0]);
    const nowKey = keys.map((k) => S.parts[k]);
    const cell = (r) => {
      if (!r) return h('td.gcell', { text: '…' });
      const gain = (m.up ? 1 : -1) * (r.v - med) / spread;
      const isNow = keys.every((k, j) => sameVal(r.vals[j], nowKey[j]));
      const name = rowName(r);
      const g = Math.max(-1, Math.min(1, gain * 2)), shade = 'background: color-mix(in srgb, var(--' + (g >= 0 ? 'good' : 'bad') + ') ' + Math.round(Math.abs(g) * 28) + '%, transparent)';
      return h('td.gcell' + (isNow ? '.now' : ''), { style: shade, title: (name ? name + '. ' : '') + 'Click to put these words in your sentence.' }, [
        h('button.gbtn', { type: 'button', onclick: () => useRow(r) }, [
          h('b', { text: gfmt(r.v) + gunit(m) }), isFinite(r.se) ? h('span.small', { text: ' ±' + gfmt(r.se) + gunit(m) }) : null,
          r.works ? h('span.gok', { text: ' ✓' }) : null,
          h('span.gname', { text: r.source === 'local' ? 'Saved in this browser' : r.stored ? 'Stored simulation' : 'Live' }),
          name ? h('span.gname', { text: name }) : null, isNow ? h('span.gname', { text: '(your sentence)' }) : null])]);
    };
    const head = h('tr', null, [h('th', { text: rk.map((k) => SHORT[k]).join(' / ') + (ck.length ? ' ↓   ' + ck.map((k) => SHORT[k]).join(' / ') + ' →' : '') })]
      .concat(ck.length ? cCombos.map((cv) => h('th', { text: cv.map((v, j) => wordText(ck[j], v)).join(' / ') })) : [gridMetricHead(m)]));
    const rows = rCombos.map((rv) => h('tr', null, [h('th', { text: rv.map((v, j) => wordText(rk[j], v)).join(' / ') })]
      .concat(ck.length ? cCombos.map((cv) => cell(find(rv, cv))) : [cell(find(rv, []))])));
    const idle = idleWords(G.base || S.parts, G.world), swept = G.runKeys.filter((k) => idle[k]);
    const why = [];
    for (const k of swept) {
      const r = idle[k], g = why.find((x) => x.r === r);
      if (g) g.ks.push('"' + SHORT[k] + '"'); else why.push({ r, ks: ['"' + SHORT[k] + '"'] });
    }
    const idleNote = swept.length
      ? 'Swept words that do nothing in this sentence: ' + why.map((x) => x.ks.join(' and ') + ' (' + x.r + ')').join('; ')
        + (swept.length === G.runKeys.length ? ' So every combination runs the same method: the name column repeats it, and the cells can differ only by the seeds.' : '')
      : '';
    return h('div.stack', null, [
      h('div.eyebrow', { text: 'The table: ' + m.label }),
      h('div.rp-scroll', null, [h('table.rp-table.gtable', null, [h('thead', null, head), h('tbody', null, rows)])]),
      h('p.small', { text: '± is the standard error over seeds of the number in the cell: two cells closer than about twice that are a tie. ✓: passes this world\'s test. Green: better than the middle of the table; red: worse. Click a cell to put its words in your sentence.' }),
      idleNote ? h('p.small', { text: idleNote }) : null,
    ]);
  }
  // For each word change: its effect in every context (the other words fixed), and which other word changes that effect most.
  function gridEffects() {
    const keys = G.runKeys, m = G.metric, out = [];
    keys.forEach((k, j) => {
      const opts = optVals(k);
      for (let o = 1; o < opts.length; o++) {
        const d = [];
        for (const r of G.rows) {
          if (!sameVal(r.vals[j], opts[0])) continue;
          const r2 = G.rows.find((x) => sameVal(x.vals[j], opts[o]) && x.vals.every((v, i) => i === j || sameVal(v, r.vals[i])));
          if (!r2) continue;
          const gain = (m.up ? 1 : -1) * (r2.v - r.v), noise = 2 * Math.hypot(r.se || 0, r2.se || 0);
          d.push({ gain, noise, ctx: r.vals });
        }
        if (!d.length) continue;
        const helps = d.filter((x) => x.gain > x.noise).length, hurts = d.filter((x) => x.gain < -x.noise).length;
        let partner = null;
        keys.forEach((k2, j2) => {
          if (j2 === j) return;
          const groups = optVals(k2).map((v) => { const g = d.filter((x) => sameVal(x.ctx[j2], v)); return { v, mean: g.length ? g.reduce((s, x) => s + x.gain, 0) / g.length : NaN }; }).filter((g) => isFinite(g.mean));
          if (groups.length < 2) return;
          const sp = Math.max(...groups.map((g) => g.mean)) - Math.min(...groups.map((g) => g.mean));
          if (!partner || sp > partner.sp) partner = { k: k2, sp, groups };
        });
        const lo = Math.min(...d.map((x) => x.gain)), hi = Math.max(...d.map((x) => x.gain));
        const verdict = helps && hurts ? 'helps or hurts, depending on the other words' : helps === d.length ? 'helps every time' : hurts === d.length ? 'hurts every time' : helps ? 'helps sometimes, otherwise no clear effect' : hurts ? 'hurts sometimes, otherwise no clear effect' : 'no clear effect';
        const sgn = (x) => (x > 0 ? '+' : '') + gfmt(x);
        out.push({ size: Math.max(Math.abs(lo), Math.abs(hi)), el: h('div.geff', null, [
          h('p', { html: '<b>' + SHORT[k] + ': "' + wordText(k, opts[0]) + '" → "' + wordText(k, opts[o]) + '"</b>: ' + verdict + ' (' + d.length + ' context' + (d.length > 1 ? 's' : '') + ', change ' + (d.length > 1 ? 'from ' + sgn(lo) + ' to ' + sgn(hi) : sgn(lo)) + ').' }),
          partner && keys.length > 1 && partner.sp > 0 ? h('p.small', { text: 'Depends most on ' + SHORT[partner.k] + ': ' + partner.groups.map((g) => 'with "' + wordText(partner.k, g.v) + '" ' + sgn(g.mean)).join('; ') + ' (mean change).' }) : null]) });
      }
    });
    out.sort((a, b) => b.size - a.size);
    return h('div.stack', null, [h('div.eyebrow', { text: 'What each change does (positive = better)' }), ...out.map((x) => x.el),
      h('p.small', { text: 'A context is one setting of the other words. "No clear effect": the change is smaller than twice its standard error. When a change helps in one context and hurts in another, the words interact: their effects do not add up.' })]);
  }
  function gridList() {
    const keys = G.runKeys, m = G.metric;
    const rows = G.rows.slice().sort((a, b) => (m.up ? b.v - a.v : a.v - b.v));
    return h('details.gsub', null, [h('summary', { text: 'The same results as a list, best first' }),
      h('div.rp-scroll', null, [h('table.rp-table', null, [
        h('thead', null, h('tr', null, keys.map((k) => h('th', { text: SHORT[k] })).concat([gridMetricHead(m), h('th', { text: 'test' }), h('th', { text: 'name' }), h('th')]))),
        h('tbody', null, rows.map((r) => h('tr', null, r.vals.map((v, j) => h('td', { text: wordText(keys[j], v) })).concat([
          h('td.num', { text: gfmt(r.v) + gunit(m) + (isFinite(r.se) ? ' ± ' + gfmt(r.se) + gunit(m) : '') }), h('td', { text: r.works ? '✓' : '' }), h('td', { text: rowName(r) }),
          h('td', null, [h('button.btn.ghost.tiny', { type: 'button', onclick: () => useRow(r) }, 'Use')])])))),
      ])])]);
  }

  // ---------------------------------------------------------------- watch one update (the replay of one real update)
  const ACT = { cliff: ['up', 'right', 'down', 'left'] };
  function fmtState(world, s, knobs) {
    if (!s) return 'the end';
    if (world === 'bandit') return 'the one state';
    if (world === 'mirage') return s[0] > 0.5 ? 'A (the two doors)' : 'B (the machines)';
    if (world === 'cliff') {
      const width = (knobs && knobs.width) || 12, r = Math.round(s[0] * 3) + 1, c = Math.round(s[1] * (width - 1)) + 1;
      return 'row ' + r + (r === 4 ? ' (bottom)' : '') + ', column ' + c;
    }
    if (world === 'pendulum') return 'angle ' + Math.round(Math.atan2(s[1], s[0]) * 180 / Math.PI) + '° from upright, speed ' + fmt(s[2] * 8) + ' rad/s';
    if (world === 'reach') return 'tip ' + fmt(Math.hypot(s[6], s[7])) + ' m from the target' + (s[10] > 0 ? ', holding the payload' : '');
    if (world === 'fork') return 'position (' + fmt(s[0]) + ', ' + fmt(s[1]) + ')';
    if (world === 'fetch') return 'stick ' + fmt(s[2] * 2) + ' away, ' + Math.round(Math.atan2(s[1], s[0]) * 180 / Math.PI) + '° from the nose' + (s[5] > 0 ? ', carrying it' : '');
    if (world === 'goalgrid') { const n = (knobs && knobs.size) || 7; return 'cell (' + Math.round(s[2] * n) + ', ' + Math.round(s[3] * n) + '), goal (' + Math.round((s[0] + s[2]) * n) + ', ' + Math.round((s[1] + s[3]) * n) + ')'; }
    return 'cart ' + fmt(s[0]) + ', cart speed ' + fmt(s[1]) + ', pole angle ' + fmt(s[2]) + ', pole speed ' + fmt(s[3]) + ' (scaled)';
  }
  function fmtAction(world, a, s, knobs) {
    if (a && typeof a === 'object') return '[' + Array.from(a).map(fmt).join(', ') + ']';
    if (world === 'goalgrid') return ['up', 'right', 'down', 'left'][a];
    if (world === 'fetch') return ['walk', 'turn left', 'turn right', 'sit'][a];
    if (a == null || a < 0) return '?';
    if (world === 'cliff') return ACT.cliff[a];
    if (world === 'bandit') return 'machine ' + (a + 1);
    if (world === 'mirage') return s && s[0] > 0.5 ? ['the right door', 'the left door'][a] : 'machine ' + (a + 1);
    const copies = (knobs && knobs.actionCopies) || 1;
    return (a % 2 === 0 ? 'push left' : 'push right') + (copies > 1 ? ' (copy ' + (Math.floor(a / 2) + 1) + ')' : '');
  }
  function rewardList(rs) {
    const f = (x) => fmt(x);
    if (rs.length <= 12) return rs.map(f).join(', ');
    return rs.slice(0, 5).map(f).join(', ') + ', … (' + (rs.length - 8) + ' more) …, ' + rs.slice(-3).map(f).join(', ');
  }
  function replayView() {
    const st = { sess: null, pr: null, stage: 0, busy: false, cfg: null, t: 0 };
    const out = h('div.rp-body');
    const startBtn = h('button.btn.ghost', { type: 'button' }, 'Watch one update');
    startBtn.addEventListener('click', () => start());
    const box = h('div.replay', null, [
      h('p.small', { text: 'Trains a fresh learner with the current sentence for a short time (one run, in this tab), then stops on one real update and shows it piece by piece.' }),
      h('div.row', null, [startBtn]), out]);
    function budget(cfg) {
      const F = fam(cfg.parts);
      if (F === 'pg') return 3000;
      if (F === 'ac') return cfg.parts.source === 'fixed' ? 500 : cfg.parts.source === 'both' ? 300 : 1500;
      return cfg.world === 'bandit' ? 200 : cfg.world === 'mirage' ? 60 : cfg.world === 'cliff' ? 2000 : cfg.parts.store === 'net' ? 2000 : 3000;
    }
    async function start() {
      if (st.busy) return; st.busy = true; startBtn.disabled = true;
      const cfg = { world: S.world, knobs: Object.assign({}, S.knobs), parts: Object.assign({}, S.parts), hyper: hyperNow(), seed: 1 };
      let sess;
      try { sess = RLA.session(cfg); }
      catch (e) { out.replaceChildren(h('p.small', { text: 'Cannot replay this sentence: ' + e.message })); st.busy = false; startBtn.disabled = false; return; }
      const N = budget(cfg); let done = 0;
      while (done < N) {
        const k = Math.min(200, N - done); if (sess.learner.offline) sess.trainOffline(k); else sess.advance(k); done += k;
        out.replaceChildren(h('p.small', { text: 'Training ' + done + ' of ' + N + ' moves…' }));
        await new Promise((r) => setTimeout(r, 0));
      }
      st.sess = sess; st.cfg = cfg;
      next(0);
      st.busy = false; startBtn.disabled = false; startBtn.textContent = 'Start again with the current sentence';
    }
    function next(skip) {
      if (fam(st.cfg.parts) !== 'value') {
        if (skip) { if (st.sess.learner.offline) st.sess.trainOffline(skip); else st.sess.advance(skip); }
        const r = st.sess.untilUpdate();
        st.pr = r.probe; st.t = r.t; st.stage = 0; draw(); return;
      }
      if (skip) st.sess.advance(skip);
      const r = st.sess.stepAndProbe({ wantGuess: st.cfg.world !== 'bandit' && st.cfg.parts.nstep !== 0, first: st.cfg.parts.nstep === 0 });
      st.pr = r.probe; st.t = r.t; st.stage = 0;
      st.ep = st.sess.episode(); st.hist = st.sess.history(); st.seg = st.pr ? locate(st.pr, st.ep, st.cfg) : null; st.animFor = null;
      draw();
    }

    // ---- the episode behind the update, as an animation (value family). Then the tabs show the calculation.
    const epCanvas = h('canvas.rp-canvas', { 'aria-label': 'The episode that this update comes from' });
    const epCaption = h('p.small');
    const epBtn = h('button.btn.ghost.tiny', { type: 'button', onclick: () => playEpisode(true) }, 'Play the episode again');
    const epBox = h('div.rp-ep', null, [epCanvas, h('div.row', null, [epBtn]), epCaption]);
    let epAnim = 0;
    // where the update's row sits in the episode: j = index of its first move, k = number of real rewards
    function locate(p, ep, cfg) {
      const k = p.rewards.length, near = (x, y) => x && y && x.length === y.length && Array.from(x).every((v, i) => Math.abs(v - y[i]) < 1e-6);
      const fits = (j) => j + k <= ep.length && near(ep[j].obs, p.s) && ep[j].a === p.a && p.rewards.every((r, m) => Math.abs(ep[j + m].r - r) < 1e-6);
      if (cfg.parts.nstep === 0) { for (let j = 0; j < ep.length; j++) if (fits(j)) return { j, k }; }
      else for (let j = ep.length - 1; j >= 0; j--) if (fits(j)) return { j, k };
      return null;
    }
    function epColors() {
      return { ink: css('--ink'), muted: css('--muted'), line: css('--line'), acc: css('--accent'), warn: css('--warn'), bad: css('--bad'), good: css('--good'), bg: css('--sunk'), surf: css('--surface'), mono: css('--font-mono') };
    }
    // f: moves shown so far (0..n); fin: show the update's parts
    function drawEpisode(f, fin) {
      const { ctx, w, h: H } = setupCanvas(epCanvas), c = epColors(), wd = st.cfg.world;
      ctx.clearRect(0, 0, w, H); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, H);
      if (wd === 'bandit') return drawBanditEp(ctx, w, H, c, f, fin);
      const ep = st.ep, n = ep.length, sg = st.seg, TL = 26;
      if (wd === 'cliff') drawCliffEp(ctx, w, H - TL, c, f, fin);
      else if (wd === 'cartpole') drawCartEp(ctx, w, H - TL, c, f, fin);
      else if (wd === 'mirage') drawMirageEp(ctx, w, H - TL, c, f, fin);
      // the timeline: one tick per move; the update's moves in orange, s and s′ marked
      const y0 = H - TL + 6, x0 = 8, x1 = w - 8, X = (m) => x0 + (x1 - x0) * m / Math.max(1, n);
      ctx.fillStyle = c.line; ctx.fillRect(x0, y0 + 6, x1 - x0, 4);
      ctx.fillStyle = c.muted; ctx.fillRect(x0, y0 + 6, X(f) - x0, 4);
      if (fin && sg) {
        ctx.fillStyle = c.warn; ctx.fillRect(X(sg.j), y0 + 3, Math.max(3, X(sg.j + sg.k) - X(sg.j)), 10);
        ctx.font = '11px ' + c.mono; ctx.textBaseline = 'top'; ctx.fillStyle = c.ink; ctx.textAlign = 'center';
        const close = X(sg.j + sg.k) - X(sg.j) < 16, xs = Math.max(x0 + 4, Math.min(x1 - 4, X(sg.j))), xn = Math.max(x0 + 4, Math.min(x1 - 4, X(sg.j + sg.k)));
        if (st.pr.end) ctx.fillText('s', xs, y0 - 8);
        else if (close) { ctx.textAlign = 'right'; ctx.fillText('s → s′', xn, y0 - 8); }
        else { ctx.fillText('s', xs, y0 - 8); ctx.fillText('s′', xn, y0 - 8); }
      }
      ctx.font = '11px ' + c.mono; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = c.muted;
      ctx.fillText('move ' + f + ' of ' + n + (ep.length && (ep[n - 1].done || ep[n - 1].truncated) ? ' (episode over)' : ' (episode still running)'), 8, 6);
    }
    const cliffCell = (o, width) => [Math.round(o[0] * 3), Math.round(o[1] * (width - 1))];
    function drawCliffEp(ctx, w, H, c, f, fin) {
      const width = (st.sess.knobs && st.sess.knobs.width) || 12, top = 20, cw = w / width, ch = (H - top) / 4, ep = st.ep, sg = st.seg;
      const cx = (cell) => cell[1] * cw + cw / 2, cy = (cell) => top + cell[0] * ch + ch / 2;
      for (let r = 0; r < 4; r++) for (let q = 0; q < width; q++) {
        const cliff = r === 3 && q > 0 && q < width - 1;
        ctx.fillStyle = cliff ? c.bad : r === 3 && q === 0 ? c.good : r === 3 && q === width - 1 ? c.warn : c.surf;
        ctx.globalAlpha = cliff ? 0.35 : r === 3 && (q === 0 || q === width - 1) ? 0.45 : 1;
        ctx.fillRect(q * cw + 1, top + r * ch + 1, cw - 2, ch - 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.ink; ctx.font = Math.round(Math.min(ch, cw) * 0.36) + 'px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('start', cw / 2, top + 3.5 * ch); ctx.fillText('goal', (width - 0.5) * cw, top + 3.5 * ch);
      ctx.fillStyle = c.muted; ctx.fillText('cliff', w / 2, top + 3.5 * ch);
      const P = [ep[0].obs].concat(ep.map((m) => m.obs2)).map((o) => cliffCell(o, width));
      const inSeg = (m) => fin && sg && m >= sg.j && m < sg.j + sg.k;
      for (let m = 0; m < f; m++) {
        const a = P[m], b = P[m + 1], jump = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1 || ep[m].r <= -50;
        ctx.strokeStyle = inSeg(m) ? c.warn : c.ink; ctx.globalAlpha = inSeg(m) ? 1 : 0.45; ctx.lineWidth = inSeg(m) ? 4 : 2; ctx.setLineDash(jump ? [4, 4] : []);
        if (jump) { ctx.strokeStyle = c.bad; ctx.globalAlpha = 0.8; }
        ctx.beginPath(); ctx.moveTo(cx(a), cy(a)); ctx.lineTo(cx(b), cy(b)); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const mark = (cell, label, color) => { ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(cell[1] * cw + 3, top + cell[0] * ch + 3, cw - 6, ch - 6); ctx.fillStyle = color; ctx.font = 'bold 12px ' + c.mono; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(label, cell[1] * cw + 6, top + cell[0] * ch + 5); };
      if (fin && sg) { mark(P[sg.j], 's', c.acc); if (!st.pr.end) mark(P[sg.j + sg.k], 's′', c.warn); }
      const ag = P[Math.min(f, P.length - 1)];
      ctx.fillStyle = c.acc; ctx.beginPath(); ctx.arc(cx(ag), cy(ag), Math.min(cw, ch) * 0.22, 0, 7); ctx.fill();
    }
    let cartWorld = null;
    function drawCartEp(ctx, w, H, c, f, fin) {
      const ep = st.ep, sg = st.seg;
      if (!cartWorld || cartWorld._k !== st.sess.knobs) { cartWorld = RLA.worlds.cartpole.make(st.sess.knobs, RLA.rng.make(1)); cartWorld._k = st.sess.knobs; cartWorld.reset(); }
      const s = f === 0 ? ep[0].st : ep[f - 1].st2;
      if (s) cartWorld.setState(s);
      ctx.save(); ctx.translate(0, 16);
      cartWorld.render(ctx, w, H - 16, { fg: c.ink, accent: c.acc, muted: c.muted, bad: c.bad, bg: c.bg });
      ctx.restore();
      if (fin && sg) {
        ctx.fillStyle = c.warn; ctx.font = '11px ' + c.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('the update: ' + (sg.k > 1 ? 'moves ' + (sg.j + 1) + ' to ' + (sg.j + sg.k) : 'move ' + (sg.j + 1)), w - 8, 6);
      }
    }
    function drawMirageEp(ctx, w, H, c, f, fin) {
      const ep = st.ep, sg = st.seg, top = 18, y = top + (H - top) / 2, r = Math.min(26, (H - top) / 4);
      const xA = w * 0.5, xB = w * 0.2, xE = w * 0.8;
      const node = (x, label, on, hi) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = on ? c.acc : c.surf; ctx.fill(); ctx.lineWidth = hi ? 4 : 1.5; ctx.strokeStyle = hi || c.muted; ctx.stroke(); ctx.fillStyle = on ? c.surf : c.ink; ctx.font = 'bold 14px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y); };
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xB + r, y); ctx.lineTo(xA - r, y); ctx.moveTo(xA + r, y); ctx.lineTo(xE - r, y); ctx.stroke();
      ctx.fillStyle = c.muted; ctx.font = '11px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('left door', (xA + xB) / 2, y - 6); ctx.fillText('right: end, 0', (xA + xE) / 2, y - 6);
      const at = f === 0 ? 'A' : ep[f - 1].done ? (ep[0].a === 0 ? 'E' : 'M') : 'B';
      const segS = fin && sg ? (sg.j === 0 ? 'A' : 'B') : null;
      node(xA, 'A', at === 'A', segS === 'A' ? c.acc : null); node(xB, 'B', at === 'B' || at === 'M', segS === 'B' ? c.acc : fin && sg && !st.pr.end && sg.j === 0 ? c.warn : null); node(xE, 'end', at === 'E', null);
      if (at === 'M') { ctx.fillStyle = ep[f - 1].r >= 0 ? c.good : c.bad; ctx.font = 'bold 13px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('machine ' + (ep[f - 1].a + 1) + ' paid ' + fmt(ep[f - 1].r), xB, y + r + 6); }
    }
    function drawBanditEp(ctx, w, H, c, f, fin) {
      const hist = st.hist, n = hist.length, p = st.pr, q = p.before.qS, A = q.length, top = 40, rowH = 30;
      const slot = w / A, mx = Math.max(1e-9, ...q.map(Math.abs)), base = top + (H - top - rowH - 16) / 2, sc = (H - top - rowH - 16) / 2 / mx * 0.9;
      const cur = f > 0 ? hist[f - 1] : null;
      ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, base); ctx.stroke();
      for (let a = 0; a < A; a++) {
        const on = cur && cur.a === a;
        ctx.fillStyle = on ? c.acc : c.surf; ctx.fillRect(a * slot + 3, base - 3, slot - 6, 6);
        ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a * slot + slot * 0.2, base - q[a] * sc); ctx.lineTo(a * slot + slot * 0.8, base - q[a] * sc); ctx.stroke();
        ctx.fillStyle = on ? c.acc : c.muted; ctx.font = (on ? 'bold ' : '') + '11px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(String(a + 1), a * slot + slot / 2, base + 6);
        if (on) { ctx.fillStyle = cur.r >= 0 ? c.good : c.bad; ctx.font = 'bold 12px ' + c.mono; ctx.textBaseline = 'bottom'; ctx.fillText(fmt(cur.r), a * slot + slot / 2, base - Math.max(0, q[a]) * sc - 6); }
      }
      // the strip of recent pulls
      const y = H - rowH - 4, cw = Math.min(56, (w - 16) / n);
      for (let m = 0; m < f; m++) {
        const last = m === n - 1, x = 8 + m * cw;
        ctx.fillStyle = last && fin ? c.warn : c.surf; ctx.fillRect(x, y, cw - 2, rowH);
        ctx.fillStyle = c.ink; ctx.font = '10px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        if (cw > 18) ctx.fillText(String(hist[m].a + 1), x + cw / 2 - 1, y + 3);
        if (cw > 34) ctx.fillText(fmt(hist[m].r), x + cw / 2 - 1, y + 16);
      }
      ctx.fillStyle = c.muted; ctx.font = '11px ' + c.mono; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('lines: the estimates just before this update; boxes below: the last ' + n + ' pulls (machine, payout)', 8, 4);
    }
    function playEpisode(force) {
      cancelAnimationFrame(epAnim);
      const n = st.cfg.world === 'bandit' ? st.hist.length : st.ep.length;
      if (!n) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced && !force) { drawEpisode(n, true); return; }
      // at most about 100 frames: a long episode skips moves so that it plays in a few seconds
      const frames = Math.min(n, 100), dt = Math.max(40, Math.min(350, 4000 / frames)); let i = 0, last = 0;
      const tick = (ts) => {
        if (!epCanvas.isConnected) return;
        if (ts - last >= dt) { last = ts; const f = Math.round(i * n / frames); drawEpisode(f, f === n); i++; if (i > frames) return; }
        epAnim = requestAnimationFrame(tick);
      };
      epAnim = requestAnimationFrame(tick);
    }
    function epText() {
      const p = st.pr, sg = st.seg, w = st.cfg.world, k = p.rewards.length;
      if (w === 'bandit') return 'One pull is one whole episode. The animation shows the last ' + st.hist.length + ' pulls, one by one; the last one (orange) is the pull this update learns from. Then the tabs below show the calculation, piece by piece.';
      if (!sg) return 'This update uses a move from the memory of old moves, not a move of the episode shown. The tabs below show its calculation.';
      return 'The episode this update comes from, played move by move (training moves, random tries included). Orange: the ' + (k > 1 ? k + ' moves whose real rewards enter' : 'move whose real reward enters') + ' the update. s: the state whose estimate moves. ' + (p.end ? 'The episode ended there, so there is no guess.' : 's′: the state where the guess is read.') + ' Then the tabs below show the calculation, piece by piece.';
    }
    const STAGES = ['The move', 'The guess', 'The target', 'The update', 'What else moved'];
    function draw() {
      if (fam(st.cfg.parts) === 'pg') return drawPg();
      if (fam(st.cfg.parts) === 'ac') return drawAc();
      const p = st.pr, cfg = st.cfg, w = cfg.world, P = cfg.parts, kn = st.sess.knobs;
      if (!p) { out.replaceChildren(h('p.small', { text: 'No update to show yet. Press "Another update".' })); return; }
      const nav = h('div.rp-nav', { role: 'tablist' }, STAGES.map((t, i) => h('button.rp-tab' + (i === st.stage ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': i === st.stage ? 'true' : 'false', onclick: () => { st.stage = i; draw(); } }, (i + 1) + '. ' + t)));
      const k = p.rewards.length, g = p.gamma;
      const body = h('div.rp-stage');
      const P_ = (html) => h('p', { html });
      const sName = fmtState(w, p.s, kn), aName = fmtAction(w, p.a, p.s, kn);
      if (st.stage === 0) {
        body.append(P_('Sentence: <b>' + nameOf(P, w) + '</b>, after ' + st.t + ' moves of training on ' + C.worldNames[w] + '.'),
          P_('In state <b>' + sName + '</b> the learner took <b>' + aName + '</b>.'));
        if (P.nstep === 0) body.append(P_('The episode ended after ' + k + ' moves. The full return uses every reward that followed: ' + rewardList(p.rewards) + '.'));
        else if (p.end) body.append(P_('Real reward' + (k > 1 ? 's' : '') + ': ' + rewardList(p.rewards) + '. Then the episode ended: no next state, so no guess.'));
        else body.append(P_(k + ' real reward' + (k > 1 ? 's' : '') + ': ' + rewardList(p.rewards) + '. Then the next state <b>s′</b> = ' + fmtState(w, p.sN, kn) + (P.agg === 'taken' ? ', where the learner really took <b>' + fmtAction(w, p.aN, p.sN, kn) + '</b>' : '') + '.'));
        body.append(P_('Discounted sum of the real rewards: R = ' + fmt(p.R) + (k > 1 && g !== 1 ? ' (each later reward counts γ = ' + g + ' times less)' : '') + '.'));
      } else if (st.stage === 1) {
        if (p.end) body.append(P_(P.nstep === 0 ? 'No guess: this sentence waits for the end of the episode and uses only real rewards.' : 'No guess: the episode ended, so the future is worth 0.'));
        else {
          const d = p.detail, qN = p.before.qN, n = p.nValidN;
          const cols = [['live', 'live']].concat(qN.frozen ? [['frozen', 'frozen copy']] : [], qN.second ? [['second', 'second']] : []);
          const role = (c) => [P.agg !== 'taken' && P.picker === c ? 'chooses' : null, P.scorer === c || (P.scorer === 'minpair' && (c === 'live' || c === 'second')) ? 'scores' : null].filter(Boolean).join(', ');
          const tbl = h('table.rp-table', null, [
            h('thead', null, h('tr', null, [h('th', { text: 'next action a′' })].concat(cols.map(([c, lab]) => h('th', { text: lab + (role(c) ? ' (' + role(c) + ')' : '') }))))),
            h('tbody', null, range(0, n - 1).map((a) => h('tr' + (a === d.aStar ? '.hi' : ''), null,
              [h('td', { text: fmtAction(w, a, p.sN, kn) + (a === d.aStar ? (P.agg === 'taken' ? '  ← taken' : P.agg === 'mean' ? '  ← greedy' : '  ← chosen') : '') })].concat(cols.map(([c]) => h('td.num', { text: fmt(qN[c][a]) })))))),
          ]);
          body.append(h('div.rp-scroll', null, [tbl]));
          const pw = wordText('picker', P.picker), sw = wordText('scorer', P.scorer);
          if (P.agg === 'taken') body.append(P_('The learner really took ' + fmtAction(w, p.aN, p.sN, kn) + ' next. ' + cap(sw) + ' gives it the value <b>' + fmt(d.v) + '</b>.'));
          else if (P.agg === 'mean') {
            const e = d.eps || 0;
            body.append(P_('Average over the next actions, weighted the way the learner acts (ε = ' + fmt(e) + '): the greedy action of ' + pw + ' gets weight ' + fmt(1 - e + e / n) + ', each other action ' + fmt(e / n) + '. Values from ' + sw + '. Guess = <b>' + fmt(d.v) + '</b>.'));
          } else {
            body.append(P_(cap(pw) + ' chooses ' + fmtAction(w, d.aStar, p.sN, kn) + ' (the ' + (P.agg === 'min' ? 'lowest' : 'highest') + ' value in its column). ' + cap(sw) + ' gives it the value <b>' + fmt(d.v) + '</b>.'));
            if (P.picker === P.scorer) body.append(h('p.small', { text: 'The same estimate chooses and scores. If its value for that action is too high by luck, the guess keeps the luck.' }));
          }
        }
      } else if (st.stage === 2) {
        if (p.end) body.append(P_('Target <b>y = R = ' + fmt(p.y) + '</b>.'));
        else body.append(P_('Target <b>y</b> = R + γ' + (k > 1 ? '<sup>' + k + '</sup>' : '') + ' · guess = ' + fmt(p.R) + ' + ' + fmt(p.gk) + ' × ' + fmt(p.detail.v) + ' = <b>' + fmt(p.y) + '</b>.'));
        body.append(h('p.small', { text: 'Real rewards are facts. The guess is the learner\'s own estimate, so the target is only as good as that estimate.' }));
      } else if (st.stage === 3) {
        const b = p.before.qS[p.a], a2 = p.after.qS[p.a];
        body.append(P_('Before: Q(s, ' + aName + ') = ' + fmt(b) + '. Error: y − Q = ' + fmt(p.y - b) + '.'));
        if (p.store === 'net') body.append(P_('One Adam gradient step on (Q(s,a) − y)² moves it to <b>' + fmt(a2) + '</b>.'));
        else body.append(P_((P.step === 'avg' ? 'Step "to the average of its targets"' : 'Step α = ' + ((C.hyper[w] || {}).lrTable || 0.1)) + ': ' + fmt(b) + ' → <b>' + fmt(a2) + '</b>.'));
        if (!p.end) {
          const moved = Math.abs(p.yAfter - p.y) > 1e-9 * Math.max(1, Math.abs(p.y));
          body.append(P_('Compute the same target again after the update: ' + fmt(p.yAfter) + (moved ? ' (it moved by ' + fmt(p.yAfter - p.y) + ').' : ' (unchanged).')));
        }
      } else {
        if (!p.sN) body.append(P_('No next state in this row, so no guess can move.'));
        else {
          const qb = p.before.qN, qa = p.after.qN, n = p.nValidN, lines = [];
          for (const [c, lab] of [['live', 'Live estimate'], ['frozen', 'Frozen copy'], ['second', 'Second estimate']]) {
            if (!qb[c]) continue;
            const ch = range(0, n - 1).some((a) => Math.abs(qa[c][a] - qb[c][a]) > 1e-12);
            lines.push(P_(lab + ' at s′: ' + (ch ? range(0, n - 1).map((a) => fmt(qb[c][a]) + ' → ' + fmt(qa[c][a])).join(', ') : '<b>unchanged</b>') + '.'));
          }
          body.append(...lines);
          if (p.store === 'net') {
            const others = range(0, p.before.qS.length - 1).filter((a) => a !== p.a && Math.abs(p.after.qS[a] - p.before.qS[a]) > 1e-12);
            if (others.length) body.append(P_('Q at s for the other action' + (others.length > 1 ? 's' : '') + ' also moved: ' + others.map((a) => fmt(p.before.qS[a]) + ' → ' + fmt(p.after.qS[a])).join(', ') + ' (shared weights).'));
          }
          const moved = Math.abs(p.yAfter - p.y) > 1e-9 * Math.max(1, Math.abs(p.y));
          body.append(h('p.rp-verdict', { html: moved
            ? '<b>The target moved.</b> The estimate that makes the guess also learned in this update, so the next update chases a target it just pushed.' + (p.store === 'net' ? ' With a network, nearby states move together, so this can repeat without limit.' : '')
            : '<b>The target did not move.</b> The guess comes from an estimate this update does not change' + (p.store === 'table' ? ' (the cell at s′ is separate from the cell at s)' : '') + '.' }));
        }
      }
      const ctrls = h('div.row', null, [
        h('button.btn.ghost', { type: 'button', disabled: st.stage === 0, onclick: () => { st.stage--; draw(); } }, 'Back'),
        h('button.btn', { type: 'button', disabled: st.stage === STAGES.length - 1, onclick: () => { st.stage++; draw(); } }, 'Next'),
        h('button.btn.ghost', { type: 'button', onclick: () => next(0) }, 'Another update'),
        h('button.btn.ghost', { type: 'button', onclick: () => next(500) }, 'Train 500 more moves'),
      ]);
      epCaption.textContent = epText();
      out.replaceChildren(epBox, nav, body, ctrls);
      if (st.animFor !== p) { st.animFor = p; playEpisode(false); }
    }
    // shared frame for the policy-gradient and actor-critic replays
    function frame(stages, body) {
      const nav = h('div.rp-nav', { role: 'tablist' }, stages.map((t, i) => h('button.rp-tab' + (i === st.stage ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': i === st.stage ? 'true' : 'false', onclick: () => { st.stage = i; draw(); } }, (i + 1) + '. ' + t)));
      const off = st.sess.learner.offline;
      const ctrls = h('div.row', null, [
        h('button.btn.ghost', { type: 'button', disabled: st.stage === 0, onclick: () => { st.stage--; draw(); } }, 'Back'),
        h('button.btn', { type: 'button', disabled: st.stage === stages.length - 1, onclick: () => { st.stage++; draw(); } }, 'Next'),
        h('button.btn.ghost', { type: 'button', onclick: () => next(0) }, 'Another update'),
        h('button.btn.ghost', { type: 'button', onclick: () => next(off ? 500 : 1000) }, off ? 'Train 500 more updates' : 'Train 1000 more moves'),
      ]);
      out.replaceChildren(nav, body, ctrls);
      if (window.RLHELP) window.RLHELP.enhance(body, metricCtx());
    }
    const tbl = (head, rows, hi) => h('div.rp-scroll', null, [h('table.rp-table', null, [
      h('thead', null, h('tr', null, head.map((x) => h('th', { text: x })))),
      h('tbody', null, rows.map((r, i) => h('tr' + (hi && hi(i) ? '.hi' : ''), null, r.map((x, j) => h(j ? 'td.num' : 'td', { text: typeof x === 'number' ? fmt(x) : String(x) }))))),
    ])]);
    const P_ = (html) => h('p', { html });
    function drawPg() {
      const p = st.pr, P = st.cfg.parts, w = st.cfg.world, kn = st.sess.knobs;
      if (!p) { out.replaceChildren(h('p.small', { text: 'No update to show yet. Press "Another update".' })); return; }
      const body = h('div.rp-stage'), rows = p.rows;
      const act = (a) => fmtAction(w, a, null, kn);
      if (st.stage === 0) {
        body.append(P_('Sentence: <b>' + nameOf(P, w) + '</b>, update number ' + p.update + ', after ' + st.t + ' moves on ' + C.worldNames[w] + '.'),
          P_('This update uses <b>' + p.episodes + ' episode' + (p.episodes > 1 ? 's' : '') + '</b> (' + p.steps + ' steps)' + (P.group === 'same' ? ', all from the same prompt' : '') + '. Their returns: ' + p.totals.map(fmt).join(', ') + '.'),
          P_('Mean ' + fmt(p.gMean) + ', spread (standard deviation) ' + fmt(p.gStd) + '.' + (P.baseline === 'group' && p.gStd === 0 ? ' <b>Every return is the same, so every advantage is 0: this update teaches nothing.</b>' : '')));
        if (P.baseline === 'avg') body.append(P_('Running average of earlier returns: ' + fmt(p.avgB) + '.'));
      } else if (st.stage === 1) {
        body.append(P_('The weight of each action of episode 1. ' + (P.baseline === 'none' ? 'Nothing is subtracted, so every weight has the sign of the return.' : 'Weight = credit − baseline' + (P.scale === 'std' ? ', then divided by the spread.' : '.'))));
        body.append(tbl(['step', 'action', 'reward', 'credit', 'baseline', 'weight A'].concat(P.scale === 'std' ? ['A scaled'] : []),
          rows.slice(0, 14).map((r, i) => [i + 1, act(r.a), r.r, r.w, r.base, r.adv].concat(P.scale === 'std' ? [r.advScaled] : []))));
        if (rows.length > 14) body.append(h('p.small', { text: (rows.length - 14) + ' more steps in this episode are not shown.' }));
      } else if (st.stage === 2) {
        const right = rows.filter((r) => (r.advScaled > 0 && r.pNew > r.pOld) || (r.advScaled < 0 && r.pNew < r.pOld)).length;
        body.append(P_('After ' + p.epochs + ' pass' + (p.epochs > 1 ? 'es' : '') + ', how likely is each action of episode 1 now? Ratio = new / old probability.' + (P.ratio === 'clip' ? ' A highlighted row was clipped: it already moved 20% in the helpful direction, so it got no more push.' : '')));
        body.append(tbl(['step', 'action', 'weight', p.cont ? 'density before' : 'prob. before', p.cont ? 'after' : 'prob. after', 'ratio'],
          rows.slice(0, 14).map((r, i) => [i + 1, act(r.a), r.advScaled, r.pOld, r.pNew, r.ratio]), (i) => rows[i] && rows[i].clipped));
        // the bare table numbers have no phrase: attach the shared help to their column headers
        if (window.RLHELP) body.querySelectorAll('th').forEach((th) => {
          if (th.textContent.trim() === 'ratio') th.append(window.RLHELP.trigger('ratio', undefined, metricCtx()));
          else if (th.textContent.trim().indexOf('weight') === 0) th.append(window.RLHELP.trigger('advantage', undefined, metricCtx()));
        });
        body.append(P_(right + ' of ' + rows.length + ' actions moved in the direction of their weight (more likely when the weight is above 0).'));
      } else {
        body.append(P_('Mean change of the log-probability of the actions tried (an estimate of the KL divergence): ' + fmt(p.kl) + '.' + (Math.abs(p.kl) > 0.05 ? ' That is a large step: PPO-sized steps are about 0.01 to 0.02.' : '') + (P.ratio === 'clip' ? ' Share of steps clipped: ' + fmt(p.clipFrac) + '.' : '')));
        const r0 = rows[0];
        if (r0 && r0.probsOld) body.append(P_('At the first state, the probability of each action: ' + r0.probsOld.map((x, a) => act(a) + ' ' + fmt(x) + ' → <b>' + fmt(r0.probsNew[a]) + '</b>').join(', ') + '.'));
        body.append(h('p.rp-verdict', { html: '<b>Only the policy moved.</b> A policy-gradient update has no target to chase: it makes actions with a positive weight more likely and the others less likely. The weights decide whether that helps.' }));
      }
      frame(['The episodes', 'The weights', 'The step', 'How far it moved'], body);
    }
    function drawAc() {
      const p = st.pr, P = st.cfg.parts, w = st.cfg.world, kn = st.sess.knobs, L = st.sess.learner;
      if (!p) { out.replaceChildren(h('p.small', { text: 'No update to show yet. Press "Another update".' })); return; }
      const body = h('div.rp-stage'), v = (a) => '[' + a.map(fmt).join(', ') + ']';
      if (st.stage === 0) {
        body.append(P_('Sentence: <b>' + nameOf(P, w) + '</b>, after ' + st.t + (L.offline ? ' updates on a fixed dataset' : ' moves') + ' on ' + C.worldNames[w] + '.'),
          P_('One row drawn from ' + (P.source === 'own' ? 'its memory of its own tries' : P.source === 'fixed' ? 'the dataset' : 'the dataset and its own tries') + ': in state <b>' + fmtState(w, p.s, kn) + '</b> the command was <b>' + v(p.a) + '</b>, the reward ' + fmt(p.r) + ', then the state ' + fmtState(w, p.s2, kn) + (p.done ? ' (the episode ended)' : '') + '.'),
          h('p.small', { text: 'The update uses a batch of 64 such rows; this page follows the first one.' }));
      } else if (st.stage === 1) {
        if (P.critics === 'none') body.append(P_('No critic, so no target. This sentence learns only by copying.'));
        else if (P.next === 'expectile') body.append(P_('No next action: the target uses V(s′) = ' + fmt(p.vNext) + ', a high expectile of what the critic says about the data\'s own actions. Target y = r + γ V(s′) = <b>' + fmt(p.y) + '</b>.'));
        else body.append(P_('Next action a′ = ' + v(p.a2) + ' (' + (P.pick !== 'one' ? 'the one the picker chooses' : P.next === 'smooth' ? 'the policy\'s action plus clipped noise' : 'the policy\'s action') + '). ' + (P.target === 'slow' ? 'The slow copies' : 'The live critics') + ' say ' + p.qNext.map(fmt).join(' and ') + (p.qNext.length > 1 ? '; the target uses the smaller' : '') + '.' + (p.logpNext != null ? ' Entropy term −α log π = ' + fmt(-p.alpha * p.logpNext) + '.' : '') + ' Target y = <b>' + fmt(p.y) + '</b>.'),
          h('p.small', { text: 'a′ is an action nobody tried in s′. If the critic is wrong about such actions, the target inherits the error.' }));
      } else if (st.stage === 2) {
        if (P.critics === 'none') body.append(P_('No critic to update.'));
        else body.append(P_('Critic value of the row\'s own action, before → after one step: ' + p.qBefore.map((q, i) => fmt(q) + ' → <b>' + fmt(p.qAfter[i]) + '</b>').join(', ') + ' (target ' + fmt(p.y) + ').' + (P.penalty === 'cql' ? ' The conservative penalty also pushed down random and policy actions at this state.' : '')));
        if (p.v != null) body.append(P_('Value of the state V(s) = ' + fmt(p.v) + '; advantage of the row\'s action A = ' + fmt(p.adv) + '.'));
      } else if (st.stage === 3) {
        if (!p.aBefore) body.append(P_(P.aim === 'none' ? 'The policy is frozen.' : 'No policy update in this step (it waits for the critic: delay ' + P.delay + ').'));
        else {
          body.append(P_('The policy\'s command at s, before → after: ' + v(p.aBefore.slice(0, 2 * (p.a.length || 1))) + ' → <b>' + v(p.aAfter.slice(0, 2 * (p.a.length || 1))) + '</b>.'));
          if (p.dQda) body.append(P_('Slope of the critic with respect to the command, dQ/da = ' + v(p.dQda) + ': the policy moves its command that way.'));
          if (p.w != null) body.append(P_('Copy weight of this row: ' + fmt(p.w) + (P.aim === 'copybest' ? (p.w ? ' (its episode is in the top group)' : ' (its episode is not in the top group: ignored)') : '') + '.'));
          if (p.told != null) body.append(P_('Flag for this row: ' + (p.told === 1 ? '"better than usual"' : p.told === -1 ? '"not better than usual"' : 'not given (the policy also learns without the flag)') + '.'));
        }
      } else {
        if (L.qOf && p.aAfter) {
          const qa = L.qOf(Float32Array.from(p.s), Float32Array.from(p.a)), qp = L.qOf(Float32Array.from(p.s), Float32Array.from(p.aAfter.slice(0, p.a.length)));
          body.append(P_('The critic now rates the row\'s action at ' + fmt(qa) + ' and the policy\'s own command at ' + fmt(qp) + '.'));
          body.append(h('p.rp-verdict', { html: L.offline && qp > qa + 0.1 * Math.max(1, Math.abs(qa))
            ? '<b>The critic prefers an action the data never shows.</b> Nothing can correct that value: there are no new tries. The policy follows it anyway.'
            : '<b>Policy and critic learn from each other.</b> The critic rates actions; the policy moves toward the actions it rates high; the next targets use the policy\'s actions.' }));
        } else body.append(P_('There is no critic: the policy copies the data, weighted as the sentence says.'));
      }
      frame(['The row', 'The target', 'The critic step', 'The policy step', 'What the critic believes'], body);
    }
    return box;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------------------------------------------------------------- multiple choice with derivations
  // q = { id, prompt, options: [{ steps: [..], result, correct, why }] }
  function mcBlock(q, onAnswer) {
    const prev = S.answers[q.id];
    const wrap = h('div.mc');
    wrap.append(h('p', { html: q.prompt }));
    // Rotate only the rendered order; saved choice indices stay canonical for existing progress.
    const shift = [...q.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % q.options.length;
    const entries = q.options.map((o, i) => ({ o, i }));
    entries.push(...entries.splice(0, shift));
    const btns = entries.map(({ o, i }) => {
      const b = h('button.opt', { type: 'button' }, [
        h('ol', null, o.steps.map((s) => h('li', { html: s }))),
        h('span.res', { html: '→ ' + o.result }),
        h('span.why', { hidden: true }),
      ]);
      b.addEventListener('click', () => choose(i));
      return b;
    });
    wrap.append(...btns);
    if (window.RLHELP) window.RLHELP.enhance(wrap, metricCtx());
    function show(i) {
      btns.forEach((b, j) => {
        const { o, i: source } = entries[j];
        b.classList.toggle('picked', source === i);
        b.classList.toggle(o.correct ? 'right' : 'wrong', true);
        const why = b.querySelector('.why'); why.hidden = false; why.innerHTML = (o.correct ? '<b>Sound chain.</b> ' : '') + o.why;
      });
      if (window.RLHELP) window.RLHELP.enhance(wrap, metricCtx());
    }
    function choose(i) {
      if (!S.answers[q.id]) recordAnswer(q.id, i, !!q.options[i].correct);
      show(i);
      if (onAnswer) onAnswer(i);
    }
    if (prev) show(prev.choice);
    return wrap;
  }

  // Always visible before Run, including when knobs change without a full page render.
  function renderRules() {
    const lv = S.mode === 'campaign' ? C.levels.find((l) => l.id === S.level && l.world === S.world) : null;
    const mission = S.mode === 'saboteur' ? C.missions.find((m) => m.id === S.mission && m.world === S.world) : null;
    const objective = lv ? lv.goal.text : mission ? mission.goalText : null;
    for (const panel of $$('#game-rules, #challenge-rules')) panel.replaceChildren(rulesPanel(S.world, S.knobs, objective));
  }
  function rulesPanel(world, knobs, objective) {
    const r = RLA.gameRules(world, knobs, objective);
    const row = (label, text) => h('div.rules-row', null, [h('dt', { text: label }), h('dd', { text })]);
    return h('div', null, [
      h('h3', { text: 'Game rules · ' + C.worldNames[world] }),
      h('dl', null, [row('Goal', r.goal), row('Reward each step', r.reward),
        h('div.rules-row', null, [h('dt', { text: 'Equation' }), h('dd.rules-equation', { text: r.equation })]),
        row('Episode ends', r.end), row('Score', r.score), row('Pass this challenge', r.objective)])
    ]);
  }

  // ---------------------------------------------------------------- world and sentence setters
  function setWorld(w, knobs) {
    cancelRun();
    dropRun(); S.world = w; S.knobs = Object.assign({}, knobs || {});
    budgetOptions(); renderStage(); renderAutopsy(); refreshSentences(); drawCompare(); drawGrid();
    $('#run-result').textContent = '';
    $('#charts').replaceChildren(h('p.small', { text: 'Curves appear here while a run trains.' }));
  }
  function setParts(p) { const f0 = fam(S.parts); S.parts = C.cfg(p || {}); if (fam(S.parts) !== f0) budgetOptions(); onPartsChanged(); }

  const MODES = {};
  const shell = BB.shell.notebook($('#notebook'), section => {
    if (section === 'curve' && S.results.length) { renderCharts(null, true); linkRun(); }
  });
  const customNotebook = BB.shell.createNotebook(document, 'custom-notebook');
  document.querySelector('main.layout').append(customNotebook);
  const customShell = BB.shell.notebook(customNotebook);
  let notebookLevel = null;

  let mapOpen = !C.levels.some(l => l.id === S.level);
  if (mapOpen) S.mode = 'campaign';
  const campaignMap = BBCAMPAIGN.create({ h, C, S, choose: chooseLevel, show: showMap,
    saveActions: () => h('div.row.savebar', null, [
      h('span.small', { text: 'Progress saves in this browser.' }),
      h('button.btn.ghost', { type: 'button', onclick: downloadSave }, 'Download save file'),
      h('button.btn.ghost', { type: 'button', onclick: loadSave }, 'Load save file'),
      h('button.btn.ghost', { type: 'button', onclick: copyBrief }, 'Copy for your AI'),
    ]) });
  function chooseLevel(id) {
    const lv = C.levels.find(l => l.id === id);
    if (!lv) return;
    mapOpen = false; S.mode = 'campaign'; S.level = id; save(); enterLevel(lv); render();
    const button = document.querySelector('#campaign-strip button');
    if (button) button.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  function showMap() {
    cancelRun(); S.mode = 'campaign'; mapOpen = true; save(); render();
    document.querySelector('#campaign-map h1').focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  // --- Campaign: a failure, a diagnosis, a repair in words, an explanation, the published sentence
  const setStep = (lv, n) => {
    if ((S.lstep[lv.id] || 0) < n) {
      S.lstep[lv.id] = n; save(); render();
      const heading = $('#mode-pane .step.active h3');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  };
  function setCampaignRunView(lv, state) {
    const button = $('[data-campaign-run="' + lv.id + '"]');
    const status = $('[data-campaign-run-status="' + lv.id + '"]');
    if (!button || !status) return;
    const busy = state === 'running';
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.textContent = busy ? 'Running the starting sentence…' : 'Run the starting sentence';
    status.textContent = busy ? 'Training started. This button unlocks when the run finishes.'
      : state === 'failed' ? 'The run did not finish. Try again.'
        : 'Real training in your browser, ' + lv.seeds + ' runs.';
  }
  async function runCampaignStart(lv) {
    if (campaignRunLevel) return;
    campaignRunLevel = lv.id;
    setCampaignRunView(lv, 'running');
    enterLevel(lv, true);
    const a = await run();
    if (campaignRunLevel === lv.id) campaignRunLevel = null;
    setCampaignRunView(lv, a ? 'idle' : 'failed');
    if (!a) return;
    for (const id of [].concat(lv.reveal || [])) if (!S.given.includes(id)) {
      const alreadyKnown = S.found.includes(id); S.given.push(id); if (!alreadyKnown) queueCelebration(id);
    }
    save(); setStep(lv, 2);
  }
  function campaignRunRow(lv) {
    const busy = campaignRunLevel === lv.id;
    return h('div.row', null, [
      h('button.btn', { type: 'button', disabled: busy, 'aria-busy': busy ? 'true' : 'false', 'data-campaign-run': lv.id, onclick: () => runCampaignStart(lv) },
        busy ? 'Running the starting sentence…' : 'Run the starting sentence'),
      h('span.small', { role: 'status', 'data-campaign-run-status': lv.id,
        text: busy ? 'Training started. This button unlocks when the run finishes.' : 'Real training in your browser, ' + lv.seeds + ' runs.' }),
    ]);
  }
  function arrangeLessonSteps(lv, steps) {
    const history = $('#lesson-notes');
    history.replaceChildren();
    for (const previous of [...steps.children].slice(0, -1)) {
      const title = previous.querySelector('h3').textContent;
      previous.querySelectorAll('.btn').forEach(button => button.classList.add('ghost'));
      history.append(h('details', null, [h('summary', { text: previous.querySelector('.num').textContent + ': ' + title }), previous]));
    }
    steps.lastElementChild.classList.add('active');
    history.append(shell.conceptSketch({ label: 'Predict before you run, then diagnose.',
      nodes: [{ id: 'predict', label: 'Predict', x: 45, y: 60 }, { id: 'run', label: 'Run', x: 160, y: 60 }, { id: 'diagnose', label: 'Diagnose', x: 275, y: 60 }],
      edges: [{ from: 'predict', to: 'run' }, { from: 'run', to: 'diagnose' }] }));
    if (lv.id === 'cliff' && (S.lstep[lv.id] || 0) >= 2 && window.BBBACKUP) {
      history.append(window.BBBACKUP.mount(h));
    }
  }
  MODES.campaign = function (pane) {
    if (mapOpen) { campaignMap.mount(pane); return; }
    const lv = C.levels.find((l) => l.id === S.level);
    S.focus = lv.focus;
    if (lv.custom) {
      const api = lv.id === 'supermimic' ? BBSUPERMIMIC : BBVPO;
      api.mount(pane, $('#vpo-lab'), { h, shell: customShell, done: () => S.done.includes(lv.id), complete: () => {
        if (!S.done.includes(lv.id)) S.done.push(lv.id); S.lstep[lv.id] = 5; save(); updateScore();
      }, known: id => S.found.includes(id) || S.given.includes(id), reveal: id => {
        if (!S.given.includes(id)) {
          const alreadyKnown = S.found.includes(id);
          S.given.push(id); save(); updateScore();
          if (!alreadyKnown) queueCelebration(id);
        }
      } });
      return;
    }
    const st = S.lstep[lv.id] || 0;
    const card = h('div.card.teaching-card', null, [h('div.eyebrow', { text: C.worldNames[lv.world] }), h('h2', { text: lv.title }), h('p', { html: lv.intro })]);
    const steps = h('div.steps');
    const mk = (i, title, body) => h('div.step' + (st === i ? '.active' : st > i ? '.done' : ''), null, [h('span.num', { text: 'Step ' + (i + 1) }), h('h3', { text: title }), body]);

    steps.append(mk(0, 'Predict before you run', mcBlock(lv.predict, () => setStep(lv, 1))));
    if (st >= 1) steps.append(mk(1, 'Run it', h('div.stack', null, [
      h('p', { html: lv.runText }),
      campaignRunRow(lv),
    ])));
    if (st >= 2) steps.append(mk(2, 'Diagnose', h('div.stack', null, [
      h('button.btn.ghost', { type: 'button', onclick: () => { $('#replay-lab').closest('details').open = true; shell.open('autopsy'); } }, 'Watch one update of this sentence'),
      mcBlock(lv.diagnose, () => setStep(lv, 3)),
    ])));
    if (st >= 3) {
      const status = h('p.small', { text: 'Tap a word to see the choices. Words in a dashed box do nothing in this sentence.' });
      steps.append(mk(3, lv.repairKnobs ? 'Repair: change the reward' : 'Repair: change the words', h('div.stack', null, [
        h('p', { html: lv.repairText }),
        lv.repairKnobs ? rewardPanel(lv) : mainSentence({ focus: () => lv.focus, withName: true, withMath: true }),
        h('div.row', null, [h('button.btn', { type: 'button', onclick: async () => {
          if (S.world !== lv.world || (!lv.repairKnobs && JSON.stringify(S.knobs) !== JSON.stringify(lv.knobs || {}))) setWorld(lv.world, lv.knobs || {});
          const a = await run(); if (!a) return;
          const ok = lv.goal.test(a, S.parts);
          const notes = (lv.notes || []).filter((n) => n.when(a, S.parts, S.knobs)).map((n) => (typeof n.text === 'function' ? n.text(a, S.parts, S.knobs) : n.text.replace('{final}', fmt(a.summary.finalReturn))));
          if (ok) {
            if (!S.done.includes(lv.id)) S.done.push(lv.id);
            for (const id of [].concat(lv.revealOnDone || [])) if (!S.given.includes(id)) { const alreadyKnown = S.found.includes(id); S.given.push(id); if (!alreadyKnown) queueCelebration(id); }
            const rec = recognize(S.parts, S.world);
            S.made[lv.id] = { parts: Object.assign({}, S.parts), recipe: rec ? rec.id : null, notes, knobs: lv.repairKnobs ? Object.assign({}, S.knobs) : undefined };
            if (lv.id === 'cells') S.made[lv.id].outcome = {
              works: C.works[lv.world](a),
              triad: C.failures.find((f) => f.card === 'triad').when(a, S.lastCfg),
            };
            setStep(lv, lv.explain ? 4 : 5); save(); render();
          } else status.textContent = (notes.length ? notes.join(' ') + ' ' : '') + 'Not fixed yet: ' + lv.goal.text + ' Read the autopsy, or pin this run as A and change one word.';
        } }, 'Run this sentence')]),
        status,
        h('details', null, [h('summary', { text: 'Hint' }), h('p', { html: lv.hint })]),
      ])));
    }
    if (st >= 4 && lv.explain) steps.append(mk(4, 'Explain why it works', mcBlock(lv.explain, () => setStep(lv, 5))));
    if (st >= 5) steps.append(mk(5, 'Your sentence and the published one', consolidation(lv)));
    arrangeLessonSteps(lv, steps);
    card.append(steps);
    pane.append(card);
  };
  // the reward controls of a level whose repair is the reward
  function rewardPanel(lv) {
    const box = h('div.stack.reward-panel');
    const meta = RLA.worlds[lv.world].knobs;
    const draw = () => {
      const cur = Object.assign(RLA.knobDefaults(lv.world), S.knobs);
      box.replaceChildren(...lv.repairKnobs.map((key) => {
        const m = meta.find((k) => k.key === key);
        if (key === 'shaping') {
          const sel = h('select', { id: 'rk-' + key, onchange: (e) => { S.knobs = Object.assign({}, S.knobs, { shaping: +e.target.value }); renderStage(); draw(); } },
            [['0', 'none'], ['1', 'pay only for getting closer'], ['2', 'potential-based: γ·Φ(next) − Φ(now), Φ = −distance']].map(([v, t]) => h('option', { value: v, selected: String(cur.shaping) === v }, t)));
          return h('label.field', null, [h('span.small', { text: m.label }), sel]);
        }
        const val = h('b.mono', { text: String(cur[key]) });
        const inp = h('input', { type: 'range', id: 'rk-' + key, min: m.min, max: m.max, step: m.step, value: cur[key],
          oninput: (e) => { val.textContent = e.target.value; }, onchange: (e) => { S.knobs = Object.assign({}, S.knobs, { [key]: +e.target.value }); renderStage(); } });
        return h('label.field', null, [h('span.small', null, [m.label + ': ', val]), inp, h('span.small.muted', { text: m.help })]);
      }), h('div.row', null, [h('button.btn.ghost.tiny', { type: 'button', onclick: () => { S.knobs = Object.assign({}, lv.knobs || {}); renderStage(); draw(); } }, 'Back to the starting reward')]));
    };
    draw();
    return box;
  }
  function consolidation(lv) {
    const made = S.made[lv.id] || { parts: S.parts, recipe: null };
    if (lv.repairKnobs) {
      const box = h('div.stack');
      const k = Object.assign(RLA.knobDefaults(lv.world), made.knobs || S.knobs);
      box.append(h('p', { html: 'Your reward: stick ' + k.found + ', step cost ' + k.timeCost + ', facing bonus ' + k.facingW + ', getting-closer reward: ' + ['none', 'paid only for getting closer', 'potential-based'][k.shaping] + (k.shaping ? ' (weight ' + k.closerW + ')' : '') + '. The dog fetches.' }));
      for (const id of ['rewardhack', 'pbrs']) if (S.found.includes(id)) box.append(cardView(id, true));
      if (!S.found.includes('pbrs')) box.append(h('p.small', { text: 'One reward method is still hidden in this level: a getting-closer reward that no loop can game.' }));
      for (const n of made.notes || []) box.append(h('p.small', { text: n }));
      box.append(h('p', { text: 'Now play: click or tap the field to throw the stick, and watch the trained dog fetch it.' }));
      box.append(h('p', { html: '<b>On a real robot:</b> ' + lv.soWhat }), h('p.small', { html: '<b>What this toy world cannot teach:</b> ' + lv.cannotTeach }), nextLevelButton(lv));
      return box;
    }
    const rec = C.recipes.find((r) => r.id === made.recipe);
    const box = h('div.stack');
    // Discoveries last across runs; this conclusion belongs only to the completed sentence.
    const triad = lv.id === 'cells' && made.outcome && made.outcome.triad;
    if (triad) {
      box.append(h('p', { text: 'This run showed the deadly triad. The next level asks you to stop it.' }));
      box.append(cardView('triad', true));
    } else if (lv.id === 'cells' && !(made.outcome && made.outcome.works)) {
      box.append(h('p', { text: made.outcome
        ? 'Your network shares estimates across similar states, but this run did not pass CartPole\'s test. Try another sentence, or continue to the next level.'
        : 'Your saved sentence uses a network. Run it again to see whether it passes CartPole\'s test or shows a failure.' }));
    } else if (rec && rec.card) {
      box.append(h('p', { html: 'Your sentence is <b>' + rec.name + '</b>. Here are the words that define it, next to yours.' }), compareTable(made.parts, rec, lv.world));
      box.append(cardView(rec.card, true));
    } else {
      const near = nearest(made.parts, lv.world);
      box.append(h('p', { html: 'Your sentence works, and the codex has no paper for exactly these words' + (rec ? ' (' + rec.name + ')' : '') + '.' + (near ? ' The closest published sentence is <b>' + near.rec.name + '</b>:' : '') }));
      if (near) box.append(compareTable(made.parts, near.rec, lv.world));
    }
    for (const n of made.notes || []) box.append(h('p.small', { text: n }));
    box.append(discoveryMap(groupOf(triad ? 'triad' : rec && rec.card, lv.world, fam(made.parts))));
    if (['cells', 'explode', 'mirage'].includes(lv.id)) box.append(h('p', null, ['For the trade-offs behind these settings, read: ', h('a', { href: 'https://hadrien-cornier.github.io/robotics/recipes-for-choosing-a-learning-target/', target: '_blank', rel: 'noopener' }, 'Recipes for choosing a learning target')]));
    box.append(h('p', { html: '<b>On a real robot:</b> ' + lv.soWhat }), h('p.small', { html: '<b>What this toy world cannot teach:</b> ' + lv.cannotTeach }), nextLevelButton(lv));
    return box;
  }
  function nearest(p, world) {
    let best = null;
    for (const r of C.recipes) {
      if (!r.card || (r.family || 'value') !== fam(p) || (r.worlds && !r.worlds.includes(world))) continue;
      if (fam(p) === 'value' && (r.world === 'bandit') !== (world === 'bandit')) continue;
      const miss = Object.keys(r.keys).filter((k) => !keysMatch(p, { [k]: r.keys[k] })).length;
      if (!best || miss < best.miss) best = { rec: r, miss };
    }
    return best;
  }
  function compareTable(p, rec, world) {
    const keys = Object.keys(rec.keys);
    const extra = wordDiff(C.families[fam(p)].base, p, world).filter((d) => !keys.includes(d.key));
    return h('div.stack', null, [
      h('div.rp-scroll', null, [h('table.rp-table', null, [
        h('thead', null, h('tr', null, [h('th', { text: 'question' }), h('th', { text: 'your word' }), h('th', { text: rec.name })])),
        h('tbody', null, keys.map((k) => {
          const ok = keysMatch(p, { [k]: rec.keys[k] });
          return h('tr' + (ok ? '' : '.miss'), null, [h('td', { text: W[k].q }), h('td', { text: (ok ? '✓ ' : '✗ ') + wordText(k, p[k]) }), h('td', { text: wordText(k, rec.keys[k]) })]);
        })),
      ])]),
      extra.length ? h('p.small', { text: 'Your other changes from the plain sentence: ' + extra.map((d) => d.to).join(', ') + '. The published method does not need them.' }) : null,
    ]);
  }
  function nextLevelButton(lv) {
    const i = C.levels.indexOf(lv), nx = C.levels[i + 1];
    if (!nx) return h('p.small', { text: 'This is the last level of this phase. Try the Review tab: rebuild what you found from memory.' });
    return h('button.btn', { type: 'button', onclick: () => { chooseLevel(nx.id); } }, 'Next level: ' + nx.title);
  }
  let enteredLevel = null;
  function enterLevel(lv, forceStart) {
    if (enteredLevel !== lv.id) {
      cancelRun(); dropRun(); S.pinA = null; enteredLevel = lv.id;
      S.world = lv.world; S.knobs = Object.assign({}, lv.knobs || {});
      if (!lv.custom) { budgetOptions(); renderStage(); }
    }
    if (lv.custom) { cancelRun(); return; }
    if (!forceStart && campaignRunLevel === lv.id && S.running) {
      $('#seeds').value = String(lv.seeds); if (lv.steps) $('#budget').value = String(lv.steps);
      return;
    }
    if (S.world !== lv.world || JSON.stringify(S.knobs) !== JSON.stringify(lv.knobs || {})) setWorld(lv.world, lv.knobs || {});
    const step = S.lstep[lv.id] || 0;
    // a repair in progress keeps the player's words, unless they belong to another kind of learner (a reload, another level)
    if (forceStart || step < 3 || (!S.made[lv.id] && fam(S.parts) !== fam(lv.start))) setParts(lv.start);
    else if (S.made[lv.id]) { setParts(S.made[lv.id].parts); if (lv.repairKnobs && S.made[lv.id].knobs) { S.knobs = Object.assign({}, S.made[lv.id].knobs); renderStage(); } }
    $('#seeds').value = String(lv.seeds); if (lv.steps) $('#budget').value = String(lv.steps);
    markRunStale();
  }

  // --- Workbench: any sentence, any world
  MODES.workbench = function (pane) {
    S.focus = [];
    const F = fam(S.parts), fworlds = C.families[F].worlds;
    if (!fworlds.includes(S.world)) setWorld(fworlds[0]);
    const famSel = h('select', { id: 'wb-family', onchange: (e) => {
      const f = e.target.value; S.parts = C.cfg({ family: f });
      if (!C.families[f].worlds.includes(S.world)) setWorld(C.families[f].worlds[0]); else budgetOptions();
      onPartsChanged(); render();
    } }, Object.keys(C.families).map((f) => h('option', { value: f, text: C.families[f].name, selected: f === F })));
    const worldSel = h('select', { id: 'wb-world', onchange: (e) => { setWorld(e.target.value); render(); } },
      fworlds.map((w) => h('option', { value: w, text: C.worldNames[w], selected: w === S.world })));
    pane.append(h('div.card', null, [
      h('div.eyebrow', { text: 'Workbench' }), h('h2', { text: 'Write any update rule, on any world' }),
      h('p', { text: 'Every sentence trains for real. When a sentence works and matches a published method, the codex names it. Most sentences have no name: run them anyway and read the autopsy.' }),
      h('div.row', null, [h('label', { for: 'wb-family', text: 'Kind of learner' }), famSel, h('label', { for: 'wb-world', text: 'World' }), worldSel]),
      h('p.small', { html: '<b>This world teaches:</b> ' + RLA.worlds[S.world].info.teaches + ' <b>It cannot teach:</b> ' + RLA.worlds[S.world].info.cannotTeach }),
    ]));
    pane.append(h('div.card', null, [h('div.eyebrow', { text: 'The update rule' }), mainSentence({ withName: true, withMath: true })]));
    pane.append(h('div.card', null, [h('div.eyebrow', { text: 'Watch one update' }), replayView()]));
    pane.append(h('details', null, [h('summary', { text: 'Save, export and import sentences' }), savePanel()]));
  };
  function savePanel() {
    const list = h('div.stack');
    const draw = () => {
      list.replaceChildren(...S.saved.map((r, i) => h('div.row', null, [
        h('button.btn.ghost', { type: 'button', onclick: () => { setWorld(r.world, r.knobs); setParts(r.parts); render(); } }, r.name),
        h('button.btn.ghost', { type: 'button', 'aria-label': 'Delete ' + r.name, onclick: () => { S.saved.splice(i, 1); save(); draw(); } }, '×'),
      ])));
    };
    draw();
    const ta = h('textarea', { id: 'io', 'aria-label': 'Sentence JSON', placeholder: 'Paste a sentence JSON here, then press Import.' });
    return h('div.stack', null, [
      h('div.row', null, [
        h('button.btn', { type: 'button', onclick: () => {
          S.saved.push({ name: cap(nameOf(S.parts, S.world)) + ' on ' + C.worldNames[S.world], world: S.world, knobs: S.knobs, parts: Object.assign({}, S.parts) }); save(); draw();
        } }, 'Save this sentence'),
        h('button.btn.ghost', { type: 'button', onclick: () => {
          const json = JSON.stringify({ world: S.world, knobs: S.knobs, parts: S.parts });
          ta.value = json; ta.select();
          if (navigator.clipboard) navigator.clipboard.writeText(json).then(() => toast('Copied.'), () => toast('Select the text and copy it.'));
        } }, 'Export JSON'),
        h('button.btn.ghost', { type: 'button', onclick: () => {
          try {
            const r = JSON.parse(ta.value); if (!C.worldNames[r.world]) throw new Error('unknown world');
            const f = r.parts && C.families[r.parts.family] ? r.parts.family : 'value';
            const parts = { family: f }; for (const k of C.families[f].keys) if (r.parts && r.parts[k] !== undefined && optOf(k, r.parts[k])) parts[k] = r.parts[k];
            setWorld(r.world, r.knobs); setParts(parts); render(); toast('Imported.');
          } catch (e) { toast('That is not a sentence JSON: ' + e.message); }
        } }, 'Import JSON'),
      ]),
      ta, list,
    ]);
  }

  // --- Saboteur: turn the world's knobs until a method breaks
  MODES.saboteur = function (pane) {
    S.focus = [];
    const ms = C.missions;
    const cur = ms.find((m) => m.id === S.mission) || ms[0];
    const enter = (m) => { S.mission = m.id; setWorld(m.world, m.knobs || {}); setParts(m.parts); };
    pane.append(h('div.card', null, [
      h('div.eyebrow', { text: 'Saboteur' }), h('h2', { text: 'Break a working method' }),
      h('p', { text: 'Pick a mission. Turn the knobs of the world until the run shows what the mission asks for. Each knob is a real property of real robots.' }),
      h('div.stack', null, ms.map((m) => h('button.mission' + (S.missions.includes(m.id) ? '.done' : ''), {
        type: 'button', 'aria-current': m.id === cur.id ? 'true' : 'false',
        onclick: () => { enter(m); render(); },
      }, [h('b', { text: (S.missions.includes(m.id) ? 'Done · ' : '') + m.title }), h('span.small', { text: m.goalText })]))),
    ]));
    if (S.mission !== cur.id || S.world !== cur.world) enter(cur);
    const knobsBox = h('div.knobs');
    for (const k of RLA.worlds[S.world].knobs) {
      const v = S.knobs[k.key] != null ? S.knobs[k.key] : k.default;
      const out = h('output', { text: String(v) });
      const inp = h('input', { type: 'range', id: 'k-' + k.key, min: k.min, max: k.max, step: k.step, value: v,
        oninput: (e) => { S.knobs[k.key] = +e.target.value; out.textContent = e.target.value; renderRules(); },
        onchange: () => { renderStage(); } });
      knobsBox.append(h('div.knob', null, [h('label', { for: 'k-' + k.key, text: k.label }), out, inp, h('p', { text: k.help })]));
    }
    const status = h('p.small', { text: cur.goalText });
    pane.append(h('div.card', null, [
      h('div.eyebrow', { text: 'Mission: ' + cur.title }), h('p', { html: cur.text }),
      h('p.small', { html: '<b>Sentence:</b> ' + nameOf(S.parts, S.world) + '. You can change its words in the lab panel.' }),
      h('section.game-rules', { id: 'challenge-rules', 'aria-label': 'Mission rules' }),
      knobsBox,
      h('div.row', null, [
        h('button.btn', { type: 'button', onclick: async () => {
          const a = await run(); if (!a) return;
          const k = Object.assign(RLA.knobDefaults(S.world), S.knobs);
          if (cur.test(a, k)) { if (!S.missions.includes(cur.id)) S.missions.push(cur.id); save(); status.innerHTML = '<b>Broken.</b> ' + cur.lesson; toast('Mission done: ' + cur.title); }
          else status.textContent = 'Not broken in the way the mission asks: ' + headline(a, S.world) + '. Change a knob and run again.';
        } }, 'Run with these knobs'),
        h('button.btn.ghost', { type: 'button', onclick: () => { S.knobs = Object.assign({}, cur.knobs || {}); render(); renderStage(); } }, 'Reset knobs'),
      ]),
      status,
      S.missions.includes(cur.id) ? h('p', { html: '<b>Lesson:</b> ' + cur.lesson }) : null,
    ]));
  };

  // --- Review: rebuild a discovered method from memory, mixed across worlds
  function reviewQueue() {
    const ids = Object.keys(C.cards).filter((id) => C.cards[id].review && S.found.includes(id));
    ids.sort((a, b) => ((S.reviews[a] || {}).last || 0) - ((S.reviews[b] || {}).last || 0));
    const out = [];
    while (ids.length) {
      const prevW = out.length ? C.cards[out[out.length - 1]].review : null;
      const i = Math.max(0, ids.findIndex((id) => C.cards[id].review !== prevW));
      out.push(ids.splice(i, 1)[0]);
    }
    return out;
  }
  MODES.review = function (pane) {
    S.focus = [];
    const q = reviewQueue();
    const intro = h('div.card', null, [
      h('div.eyebrow', { text: 'Review' }), h('h2', { text: 'Rebuild from memory' }),
      h('p', { text: 'Pick up a method you discovered and rebuild its sentence from a plain one, without the codex. Recall is harder than recognition, and that is why it sticks.' }),
      h('p.small', { text: 'Order: the method you practiced longest ago comes first, mixed across worlds. This page sets no due dates. If you want a schedule, use a spaced-repetition tool (for example Anki).' }),
    ]);
    pane.append(intro);
    if (!q.length) { pane.append(h('div.card', null, [h('p', { text: 'Nothing to review yet. Each method you discover in the Campaign or the Workbench comes back here.' })])); return; }
    const plain = (cid) => C.cfg({ family: (recipeOfCard(cid) || {}).family || 'value' });
    if (!S.rv || !q.includes(S.rv.id)) S.rv = { id: q[0], parts: plain(q[0]), checked: null };
    const id = S.rv.id, c = C.cards[id], rec = recipeOfCard(id), world = c.review;
    const m = mountSentence({ getParts: () => S.rv.parts, setPart: (k, v) => { S.rv.parts[k] = v; S.rv.checked = null; refreshSentences(); fb.replaceChildren(); }, world: () => world, withMath: true });
    const fb = h('div.stack');
    const check = () => {
      const keys = Object.keys(rec.keys), wrong = keys.filter((k) => !keysMatch(S.rv.parts, { [k]: rec.keys[k] }));
      S.rv.checked = wrong;
      recordReview(id, wrong);
      fb.replaceChildren(
        h('p', { html: wrong.length ? '<b>Not yet: ' + wrong.length + ' word' + (wrong.length > 1 ? 's' : '') + ' differ.</b>' : '<b>Rebuilt from memory.</b>' }),
        ...keys.map((k) => {
          const ok = !wrong.includes(k), pub = rec.keys[k];
          const meaning = Array.isArray(pub) ? '' : (optOf(k, pub) || [])[2] || '';
          return h('p.small' + (ok ? '' : '.miss'), { html: (ok ? '✓ ' : '✗ ') + '<b>' + W[k].q + '</b> ' + (ok ? wordText(k, S.rv.parts[k]) + '.' : 'You chose "' + wordText(k, S.rv.parts[k]) + '". ' + c.name + ' uses "' + wordText(k, pub) + '". ' + meaning) });
        }),
        h('p', { html: '<b>Why it works:</b> ' + c.fixes }),
        h('p.small', { html: '<b>How it still fails:</b> ' + c.stillWrong }),
        peekFor(id),
        h('section.game-rules', { 'aria-label': 'Review game rules' }, rulesPanel(world, c.reviewKnobs || {})),
        h('div.row', null, [
          h('button.btn.ghost', { type: 'button', onclick: async () => { setWorld(world, c.reviewKnobs || {}); S.parts = Object.assign({}, S.rv.parts); budgetOptions(); onPartsChanged(); await run(); } }, 'Run my sentence on ' + C.worldNames[world]),
          h('button.btn', { type: 'button', onclick: () => { const nq = reviewQueue().filter((x) => x !== id); S.rv = { id: nq[0] || id, parts: plain(nq[0] || id), checked: null }; render(); } }, 'Next method'),
        ]),
      );
    };
    pane.append(h('div.card', null, [
      h('div.eyebrow', { text: C.worldNames[world] + ' · practiced ' + ((S.reviews[id] || {}).n || 0) + ' times' }),
      h('h2', { text: 'Rebuild ' + c.name }),
      h('p', { text: 'Start from the plain sentence below and set the words that make ' + c.name + '. Then check.' }),
      m,
      h('div.row', null, [h('button.btn', { type: 'button', onclick: check }, 'Check my sentence'),
        h('button.btn.ghost', { type: 'button', onclick: () => { S.rv.parts = plain(id); refreshSentences(); fb.replaceChildren(); } }, 'Reset to the plain sentence')]),
      fb,
    ]));
  };

  // --- a card can name a world you have not played yet: show that world in place (16 Oct 2026, from a page comment)
  function peekFor(id) {
    const c = C.cards[id];
    if (!c || c.review === 'mirage' || !/mirage/i.test(c.stillWrong || '')) return null;
    return miragePeek();
  }
  const MIRAGE_LEARNERS = [
    { name: 'Q-learning', parts: () => C.cfg({}), guessText: 'the best estimate' },
    { name: 'Expected Sarsa', parts: () => C.cfg({ agg: 'mean', scorer: 'live' }), guessText: '0.9 × best + 0.1 × average' },
  ];
  let miragePeekN = 0;
  function miragePeek() {
    const lvN = C.levels.findIndex((l) => l.id === 'mirage') + 1;
    const hyper = C.hyperOf(C.cfg({}), 'mirage'), eps = hyper.epsStart != null ? hyper.epsStart : 0.1;
    const K = RLA.knobDefaults('mirage'), nM = K.machines, EPISODES = 40;
    const st = { qA: [0, 0], qB: new Array(nM).fill(0), last: null, n: 0, left: 0, L: null };
    const guessOf = (L, q) => { const best = Math.max(...q), avg = q.reduce((x, y) => x + y, 0) / q.length; return L && L.name === 'Expected Sarsa' ? (1 - eps) * best + eps * avg : best; };
    const cv = h('canvas.rp-canvas.mp-canvas', { 'aria-label': 'The mirage: state A, its two doors, and the estimates of the ' + nM + ' machines behind the left door' });
    const cap = h('p.small', { text: 'Press a button to play ' + EPISODES + ' episodes of one learner. Each bar is its estimate of one machine. The orange line is its guess for the left door. One run varies a lot: press again for a new run, or use the chart below for the mean of 300 runs.' });
    function draw() {
      const { ctx, w, h: H } = setupCanvas(cv);
      const c = { ink: css('--ink'), muted: css('--muted'), line: css('--line'), acc: css('--accent'), warn: css('--warn'), bad: css('--bad'), good: css('--good'), surf: css('--surface'), mono: css('--font-mono') };
      ctx.clearRect(0, 0, w, H);
      const L = st.last, y1 = 30, r = 15, xE = Math.max(24, w * 0.1), xA = w * 0.46, xB = w - Math.max(24, w * 0.1);
      const edge = (x0, x1, on) => { ctx.strokeStyle = on ? c.acc : c.muted; ctx.lineWidth = on ? 3 : 1.5; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke(); };
      edge(xE + r, xA - r, L && !L.left); edge(xA + r, xB - r, L && L.left);
      ctx.font = '11px ' + c.mono; ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(w < 300 ? 'right: 0' : 'right door: 0', (xE + xA) / 2, y1 - 5); ctx.fillText('left door', (xA + xB) / 2, y1 - 5);
      ctx.textBaseline = 'top'; ctx.fillStyle = c.ink;
      ctx.fillText('Q = ' + st.qA[0].toFixed(2), (xE + xA) / 2, y1 + 5); ctx.fillText('Q = ' + (st.qA[1] >= 0 ? '+' : '') + st.qA[1].toFixed(2), (xA + xB) / 2, y1 + 5);
      const node = (x, label, on) => { ctx.beginPath(); ctx.arc(x, y1, r, 0, 7); ctx.fillStyle = on ? c.acc : c.surf; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = c.muted; ctx.stroke(); ctx.fillStyle = on ? c.surf : c.ink; ctx.font = 'bold 12px ' + c.mono; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y1); };
      node(xE, 'end', L && !L.left); node(xA, 'A', false); node(xB, 'B', L && L.left);
      // the machines behind the left door
      const top = 74, bot = H - 22, lo = -0.3, hi = 0.3, cl = (v) => Math.max(lo, Math.min(hi, v));
      const Y = (v) => top + (hi - cl(v)) / (hi - lo) * (bot - top), slot = (w - 16) / nM, x0 = 8;
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xB, y1 + r); ctx.lineTo(xB, top - 10); ctx.stroke();
      ctx.font = '11px ' + c.mono; ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('behind B: ' + nM + ' machines', xB - 6, top - 10);
      ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(w - 8, Y(0)); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('0', 0, Y(0));
      const best = st.qB.indexOf(Math.max(...st.qB));
      for (let a = 0; a < nM; a++) {
        const q = st.qB[a], yq = Y(q), y0 = Y(0), on = st.n > 0 && a === best && q > -1e9;
        ctx.fillStyle = on ? c.acc : c.muted; ctx.globalAlpha = on ? 0.9 : 0.55;
        ctx.fillRect(x0 + a * slot + slot * 0.18, Math.min(yq, y0), slot * 0.64, Math.max(1.5, Math.abs(yq - y0)));
        ctx.globalAlpha = 1;
        if (L && L.left && L.m === a) { ctx.strokeStyle = c.warn; ctx.lineWidth = 2; ctx.strokeRect(x0 + a * slot + slot * 0.12, Math.min(yq, y0) - 3, slot * 0.76, Math.max(1.5, Math.abs(yq - y0)) + 6); }
        ctx.fillStyle = on ? c.acc : c.muted; ctx.font = (on ? 'bold ' : '') + '11px ' + c.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(String(a + 1), x0 + a * slot + slot / 2, bot + 6);
      }
      // the true mean of every machine, and the learner's guess for the left door
      ctx.setLineDash([5, 4]); ctx.strokeStyle = c.bad; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, Y(K.mean)); ctx.lineTo(w - 8, Y(K.mean)); ctx.stroke();
      ctx.fillStyle = c.bad; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = '11px ' + c.mono; ctx.fillText('true mean ' + K.mean.toFixed(2).replace('-', '−'), w - 10, Y(K.mean) + 3);
      if (st.n > 0) {
        const g = guessOf(st.L, st.qB);
        ctx.strokeStyle = c.warn; ctx.beginPath(); ctx.moveTo(x0, Y(g)); ctx.lineTo(w - 8, Y(g)); ctx.stroke();
        ctx.fillStyle = c.warn; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('guess for the left door ' + (g >= 0 ? '+' : '') + g.toFixed(2), x0 + 14, Y(g) - 3);
      }
      ctx.setLineDash([]);
    }
    let tok = 0;
    async function play(L) {
      const my = ++tok, seed = 1 + Math.floor(Math.random() * 1e6);
      const s = RLA.session({ world: 'mirage', parts: L.parts(), hyper, seed });
      const read = () => { st.qA = Array.from(s.learner.q(Float32Array.from([1, 0]))).slice(0, 2); st.qB = Array.from(s.learner.q(Float32Array.from([0, 1]))).slice(0, nM); };
      Object.assign(st, { L, n: 0, left: 0, last: null }); read(); draw();
      for (let e = 0; e < EPISODES; e++) {
        const before = st.qB.slice(), moves = [];
        let m; do { m = s.advance(1); moves.push(m); } while (!(m.done || m.truncated));
        read(); st.n++;
        const left = !!(moves[0].info && moves[0].info.left), mv = moves[1];
        if (left) st.left++;
        st.last = left ? { left, m: mv.a, pay: mv.r, b: before[mv.a], a2: st.qB[mv.a] } : { left };
        const g = guessOf(L, st.qB), bi = st.qB.indexOf(Math.max(...st.qB)), sg = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
        cap.textContent = L.name + ', episode ' + st.n + ': ' + (left
          ? 'left door, then machine ' + (mv.a + 1) + ' paid ' + sg(mv.r) + '. Its estimate moves from ' + sg(st.last.b) + ' to ' + sg(st.last.a2) + '.'
          : 'right door, reward 0. The machines do not change.') +
          ' Best estimate: machine ' + (bi + 1) + ', ' + sg(st.qB[bi]) + '. Guess for the left door (' + L.guessText + '): ' + sg(g) + '; its true value is ' + sg(K.mean) + '. Left door so far: ' + st.left + ' of ' + st.n + ' episodes.';
        draw();
        await new Promise((res) => setTimeout(res, 260));
        if (my !== tok || !cv.isConnected) return;
      }
    }
    // many runs: the share of episodes that take the left door
    const chartId = 'ch-mirage-' + (++miragePeekN);
    const chart = chartBox(chartId, 'Left door from A (mean of 300 runs, window 10% of each run)', [[css('--ink'), 'Q-learning'], [css('--accent'), 'Expected Sarsa'], [css('--muted'), '5%: random tries alone']]);
    const res = h('p.small');
    const runBtn = h('button.btn.ghost', { type: 'button', onclick: runMany }, 'Run 300 learners of each (about 2 s)');
    async function runMany() {
      runBtn.disabled = true; res.textContent = 'Running in your browser...';
      const out = [];
      for (const L of MIRAGE_LEARNERS) {
        const rs = [];
        for (let i = 0; i < 300; i++) { rs.push(RLA.run({ world: 'mirage', parts: L.parts(), hyper, steps: 600, seed: 1 + i })); if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0)); }
        out.push({ L, a: RLA.autopsy(rs), c: curvesOf(rs, 'mirage').main });
      }
      lineChart(chart.querySelector('canvas'), out.map((o, k) => ({ xs: o.c.xs, ys: o.c.ys, color: k ? css('--accent') : css('--ink'), width: 2.2, label: o.L.name })), { xmax: 100, ymin: 0, ymax: 1, ref: 0.05, xlabel: "share of each run's episodes (%)" });
      res.textContent = 'Left door at the worst point: ' + out.map((o) => o.L.name + ' ' + Math.round(100 * o.a.summary.leftPeak) + '%').join(', ') +
        '. At the end: ' + out.map((o) => o.L.name + ' ' + Math.round(100 * o.a.summary.leftLate) + '%').join(', ') + '. 300 runs each, seeds 1 to 300, run in your browser now (Simulation).';
      runBtn.disabled = false;
    }
    const eq = '0.91 × best + 0.01 × each of the other 9  =  0.9 × best + 0.1 × average';
    const det = h('details.card-details.mp', null, [
      h('summary', { text: 'What is the mirage? Show it' }),
      h('p.small.muted', { text: 'This drawer shows the start of level ' + lvN + ', "The mirage". To predict it yourself first, play that level before you press the buttons.' }),
      h('p', { text: 'The mirage is a tiny world with two states, A and B. It is built to show one failure: maximization bias.' }),
      h('p', { text: 'From A, the right door ends the episode with reward 0. The left door leads to B. In B there are ' + nM + ' machines. Each one pays a random amount, with mean ' + String(K.mean).replace('-', '−') + ' and standard deviation ' + K.noise + ', and the episode ends. So the left door loses 0.1 on average, and the right door is the better choice.' }),
      h('p', { text: 'Each machine estimate comes from a few noisy payouts, so some estimates are above 0 by luck. The guess for the left door uses the best of the ' + nM + ' estimates, and the best one is usually a lucky one. So the left door looks good, and the learner chases it: that is the mirage.' }),
      h('section.game-rules', { 'aria-label': 'Mirage demo rules' }, rulesPanel('mirage', K)),
      cv,
      h('div.row', null, MIRAGE_LEARNERS.map((L) => h('button.btn.ghost', { type: 'button', onclick: () => play(L) }, 'Play ' + EPISODES + ' episodes: ' + L.name))),
      cap,
      h('h4', { text: 'Why Expected Sarsa does not fix it' }),
      h('p', { text: 'Expected Sarsa does not use only the best next action. It averages the next actions, each one weighted by how often the learner takes it. With ε = ' + eps + ' and ' + nM + ' machines, the learner takes the best-looking machine 91% of the time (0.9 + 0.1 / 10) and each other machine 1% of the time. So its guess is still mostly the lucky best estimate:' }),
      h('p.tex-src', { text: 'guess = ' + eq }),
      h('p', { text: 'After 30 episodes, the mean learned value of the left door was +0.10 with Q-learning and +0.06 with Expected Sarsa. Its true value is −0.10 (300 runs each, Simulation).' }),
      h('p', { text: 'The average makes the bias a little smaller, but it keeps its cause: the same noisy estimates choose the best machine and also give its value. Level ' + lvN + ' asks you to find the words that remove this cause.' }),
      runBtn, chart, res,
    ]);
    det.addEventListener('toggle', () => { if (det.open) requestAnimationFrame(draw); });
    return det;
  }

  // --- Codex: the family tree fills in as you discover
  function paperLinks(id) {
    const ls = (C.paperLinks || {})[id];
    if (!ls || !ls.length) return null;
    return h('span.plinks', null, ls.map((l) => h('a.plink', { href: l.u, target: '_blank', rel: 'noopener' }, l.t)));
  }
  function cardView(id, open) {
    const c = C.cards[id], known = S.found.includes(id) || S.given.includes(id);
    const kindName = c.kind === 'failure' ? 'Failure' : c.kind === 'frontier' ? 'Frontier model' : 'Method';
    if (!known && !open) return h('div.entry.hidden-card', null, [h('div.eyebrow', { text: kindName }), h('h3', { text: '???' }), h('p.small', { text: c.kind === 'frontier' ? 'Opens in phase 5.' : 'Not discovered yet.' })]);
    const tag = c.status === 'checked' ? h('span.tag.checked', { text: 'Checked against the source' }) : h('span.tag.unchecked', { text: 'Not checked' });
    const rec = recipeOfCard(id);
    return h('div.entry' + (open ? '.discovery' : ''), null, [
      h('div.row', { style: 'justify-content:space-between' }, [h('div.eyebrow', { text: c.kind ? kindName : S.found.includes(id) ? 'Method, built by you' : 'Method, given by a level' }), tag]),
      h('h3', { text: c.name }),
      h('dl', null, [
        h('dt', { text: 'Source' }), h('dd', null, [h('span', { html: c.paper }), paperLinks(id)]),
        rec ? h('dt', { text: 'Words' }) : null, rec ? h('dd', { text: Object.keys(rec.keys).map((k) => wordText(k, rec.keys[k])).join(' · ') }) : null,
        h('dt', { text: c.kind === 'failure' ? 'What' : c.kind === 'frontier' ? 'What it adds' : 'Fixes' }), h('dd', { html: c.fixes }),
        h('dt', { text: c.kind === 'failure' ? 'Measured' : c.kind === 'frontier' ? 'Limits' : 'Still fails' }), h('dd', { html: c.stillWrong }),
      ]),
      peekFor(id),
      c.evidence ? h('details', null, [h('summary', { text: 'Evidence from the source' }), h('div', { html: c.evidence })]) : null,
    ]);
  }
  MODES.codex = function (pane) {
    S.focus = [];
    pane.append(h('div.card', null, [
      h('div.eyebrow', { text: 'Codex' }), h('h2', { text: 'The family tree of what you built' }),
      h('p', { text: 'A method card opens when you write its sentence and it works. A failure card opens when a run shows it. Each card says which paper the idea comes from, which failure it fixed, and how it still fails. "Checked" means its quotes were compared with the source text.' }),
      h('p', { text: 'Click a box in the tree: a discovered method opens its card, and one you have not found yet gives a short hint. The label on each arrow is the problem or reason that led to the next method.' }),
      genealogy(),
    ]));
    pane.append(h('div.card', null, [discoveryMap()]));
    pane.append(h('div.codex', null, Object.keys(C.cards).map((id) => cardView(id, false))));
    freshNodes.clear(); // the freshly discovered tree nodes light up once, then settle
  };
  function genealogy() {
    return h('div.stack', null, [C.tree].concat(C.trees || []).map((t) => h('div', null, [t.title ? h('div.eyebrow', { text: t.title }) : null, genealogyOf(t)])));
  }
  // a method you have not found yet: a short hint only, never the full card
  function hintView(id, T) {
    const c = C.cards[id] || {};
    const kindName = c.kind === 'failure' ? 'Failure' : c.kind === 'frontier' ? 'Frontier model' : 'Method';
    const why = T.edges.filter(([, b]) => b === id).map(([, , l]) => l).filter(Boolean).join('; ');
    const rec = recipeOfCard(id);
    return h('div.entry.hidden-card', null, [
      h('div.eyebrow', { text: kindName + ', not discovered yet' }),
      h('h3', { text: '???' }),
      h('p.small', { text: (why ? 'The tree above says why it was added: ' + why + '. ' : '') + (rec ? 'One-line hint: ' + rec.blurb : 'A failure card opens when a run shows it.') }),
      h('p.small.muted', { text: 'The hint stops here. The full card opens when you discover it: the quotes, where the idea comes from, what it fixes and how it still fails.' }),
    ]);
  }
  function genealogyOf(T) {
    const pos = T.nodes, isKnown = (id) => id === 'root' || S.found.includes(id) || S.given.includes(id);
    const set = (el, o) => { for (const k in o) el.setAttribute(k, o[k]); return el; };
    // the viewBox must hold the widest node box: the browser clips anything outside it
    const Wd = Math.max(640, ...Object.values(pos).map((p) => p.x + 58)) + 12, Hh = T.height;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${Wd} ${Hh}`); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Genealogy of the methods discovered so far');
    const ink = css('--ink'), muted = css('--muted'), line = css('--line'), acc = css('--accent'), surf = css('--surface');
    const detail = h('div.stack.tree-detail', { 'aria-live': 'polite' });
    const show = (id) => detail.replaceChildren(isKnown(id) ? cardView(id, true) : hintView(id, T));
    for (const [a, b, label, lf] of T.edges) {
      const p = pos[a], q = pos[b]; const known = isKnown(b);
      svg.append(set(document.createElementNS(NS, 'line'), { x1: p.x, y1: p.y + 14, x2: q.x, y2: q.y - 14, stroke: known ? acc : line, 'stroke-width': known ? 2 : 1.2, 'stroke-dasharray': known ? '' : '4 4' }));
      // the label is the problem or reason that led to the next method; it is also the hint for what you miss
      // lf moves the label along its arrow when the midpoint would touch another label
      const f = lf == null ? 0.5 : lf;
      const t = set(document.createElementNS(NS, 'text'), { x: p.x + (q.x - p.x) * f + 4, y: p.y + (q.y - p.y) * f, fill: muted, 'font-size': 10, 'font-family': 'IBM Plex Mono, monospace' });
      t.textContent = label; svg.append(t);
    }
    for (const id in pos) {
      const p = pos[id], known = isKnown(id);
      const g = document.createElementNS(NS, 'g');
      if (id !== 'root') {
        g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', (known ? (C.cards[id].short || C.cards[id].name) : 'Not discovered yet') + (known ? ': open the card' : ': open a hint'));
        g.classList.add('tnode');
        if (freshNodes.has(id)) g.classList.add('lit');
        const open = () => show(id);
        g.addEventListener('click', open);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      }
      g.append(set(document.createElementNS(NS, 'rect'), { x: p.x - 58, y: p.y - 14, width: 116, height: 28, rx: 6, fill: surf, stroke: known ? ink : line, 'stroke-width': known ? 1.5 : 1 }));
      const t = set(document.createElementNS(NS, 'text'), { x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: known ? ink : muted, 'font-size': 11, 'font-family': 'IBM Plex Sans, sans-serif', 'font-weight': known ? 600 : 400 });
      t.textContent = known ? (id === 'root' ? 'Trial and error' : C.cards[id].short || C.cards[id].name) : '???';
      g.append(t); svg.append(g);
    }
    return h('div.stack', null, [h('div.genealogy', null, [svg]), detail]);
  }

  // --- Chat: ask Claude, who can change words and run experiments through page tools
  const chatLog = [];
  MODES.chat = function (pane) {
    S.focus = [];
    const tutor = tutorSampler();
    const msgs = h('div.msgs', { id: 'msgs' });
    const drawMsgs = () => msgs.replaceChildren(...(chatLog.length ? chatLog : [{ role: 'assistant', text: C.chatHello }]).map((m) => h('div.msg' + (m.role === 'user' ? '.me' : m.role === 'tool' ? '.tool' : ''), { text: m.text, 'data-md-prefix': m.role === 'user' ? 'Me' : m.role === 'tool' ? 'Tool' : 'Tutor' })));
    drawMsgs();
    const ta = h('textarea', { id: 'chat-in', 'aria-label': 'Message', placeholder: 'For example: why does my network blow up? or: use random old moves from memory and run 3 seeds.' });
    const send = h('button.btn', { type: 'button' }, 'Send');
    const stopB = h('button.btn.ghost', { type: 'button', hidden: true }, 'Stop');
    let ctl = null;
    const go = async () => {
      const text = ta.value.trim(); if (!text || !tutor) return;
      ta.value = ''; chatLog.push({ role: 'user', text }); const reply = { role: 'assistant', text: '…' }; chatLog.push(reply); drawMsgs();
      send.disabled = true; stopB.hidden = false; ctl = new AbortController();
      const history = chatLog.filter((m) => m.role !== 'tool' && m !== reply).map((m) => ({ role: m.role, content: m.text }));
      const opts = { signal: ctl.signal, cache: false, tools: chatTools(drawMsgs), onText: ({ text }) => { reply.text = text; drawMsgs(); msgs.scrollTop = msgs.scrollHeight; } };
      opts.system = chatSystem();
      try {
        const out = await tutor.fn(history, opts);
        reply.text = out.text || '(no text)';
      } catch (e) {
        const code = e && e.code;
        reply.text = code === 'not_granted' ? 'Chat is not allowed in this view.' : code === 'rate_limited' ? 'Too many messages. Wait a minute and try again.'
          : code === 'auth' ? 'The provider refused the key. Check it in Settings.' : code === 'aborted' ? 'Stopped.' : 'The chat stopped: ' + (e && (e.message || code));
      }
      send.disabled = false; stopB.hidden = true; drawMsgs(); msgs.scrollTop = msgs.scrollHeight;
    };
    send.addEventListener('click', go);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
    stopB.addEventListener('click', () => ctl && ctl.abort());
    pane.append(h('div.card.chat', null, [
      h('div.eyebrow', { text: 'Chat with the lab' }), h('h2', { text: 'Ask a tutor that can change the words and run experiments' }),
      tutor ? h('p.small', { text: 'Tutor: ' + aiLabel() + '. It sees the sentence, the knobs and the last autopsy. It can change words, set knobs and start runs. It asks you to predict before it explains.' })
        : h('div.stack', null, [
          h('p.small', { text: 'The tutor is optional. It needs your own AI key (Anthropic, OpenAI, OpenRouter) or a model on your computer (Ollama). The key stays in this browser and goes only to the provider you pick.' }),
          h('div.row', null, [h('button.btn', { type: 'button', onclick: openSettings }, 'Set up the tutor')])]),
      msgs, ta, h('div.row', null, [send, stopB, tutor ? h('span.small', { text: 'Ctrl+Enter sends.' }) : null]),
    ]));
    if (!tutor) { send.disabled = true; ta.disabled = true; }
  };
  function labState() {
    if (customActive()) return customApi().state();
    const a = S.results.length ? RLA.autopsy(S.results) : null;
    return {
      world: S.world, knobs: Object.assign(RLA.knobDefaults(S.world), S.knobs),
      words: S.parts, sentenceName: nameOf(S.parts, S.world), idleWords: idleWords(S.parts, S.world),
      lastRun: a ? { seeds: S.results.length, steps: S.lastCfg.steps, words: S.lastCfg.parts, symptoms: a.symptoms.map((s) => s.label + ': ' + s.evidence), summary: a.summary } : null,
      discovered: S.found.map((id) => C.cards[id].name), mode: S.mode,
      level: S.mode === 'campaign' ? (C.levels.find((l) => l.id === S.level) || {}).title : null,
    };
  }
  function chatSystem() {
    return [
      'You are the lab assistant inside Breaking Bellman, a game where the player learns reinforcement learning by breaking methods and rebuilding them: they change the words of an update rule, run real training in the page, and watch what fails.',
      'Teaching rules: Socratic. Before you explain a result, ask the player to predict it, then run it with the tools, then explain the mismatch. Do not give away a campaign repair; give a hint that points at the symptom. One idea per message.',
      'Writing rules: plain, simple English. Short sentences (20 words or fewer), active voice, present tense, no idioms, no em dashes. Say "for example", not "e.g.". Define a term at first use.',
      'Facts: every run in this page is a toy Simulation; say so. Only state paper facts that appear on a codex card marked checked: ' + JSON.stringify(Object.values(C.cards).filter((c) => c.status === 'checked').map((c) => ({ name: c.name, source: c.paper.replace(/<[^>]+>/g, ''), fixes: c.fixes }))) + '. For anything else, say it is not checked.',
      'Kinds of learner (family): ' + Object.keys(C.families).map((f) => f + ' = ' + C.families[f].name + ' (worlds: ' + C.families[f].worlds.join(', ') + ')').join('; ') + '. The current family is ' + fam(S.parts) + '.',
      'The words of the current sentence (key: question: allowed values and meanings): ' + C.families[fam(S.parts)].keys.map((k) => k + ': ' + W[k].q + ' ' + W[k].options.map((o) => JSON.stringify(o[0]) + ' = ' + o[1]).join('; ')).join(' | ') + '. To change the family, call set_words with family first.',
      'Worlds: ' + Object.keys(C.worldNames).join(', ') + '. Knobs per world: ' + JSON.stringify(Object.fromEntries(Object.keys(C.worldNames).map((w) => [w, RLA.worlds[w] ? RLA.worlds[w].knobs.map((k) => k.key + ' ' + k.min + '..' + k.max) : ['Separate Live lesson with its own controls']]))) + '.',
      'Current lab state: ' + JSON.stringify(labState()),
    ].join('\n');
  }
  function chatTools(redraw, quiet) {
    const note = quiet ? () => {} : (t) => { chatLog.splice(chatLog.length - 1, 0, { role: 'tool', text: t }); redraw(); };
    const props = { family: { enum: Object.keys(C.families), description: 'The kind of learner. Changing it resets the other words to that family\'s plain sentence.' } };
    for (const k in W) props[k] = { enum: W[k].options.map((o) => o[0]), description: W[k].q };
    return [
      { name: 'get_lab', description: 'Read the current world, knobs, sentence words and the last autopsy.', inputSchema: { type: 'object', properties: {} },
        execute: () => labState() },
      { name: 'set_words', description: 'Change some words of the update-rule sentence. Words not given keep their value.', inputSchema: { type: 'object', properties: props },
        execute: (ws) => {
          if (customActive()) return { error: 'Use this comparison lesson’s own controls.' };
          if (ws.family && C.families[ws.family] && ws.family !== fam(S.parts)) { S.parts = C.cfg({ family: ws.family }); if (!C.families[ws.family].worlds.includes(S.world)) setWorld(C.families[ws.family].worlds[0]); else budgetOptions(); }
          // a value may also come as its text ('true', '4'), as the brief prints it; anything else is returned as rejected, never dropped silently
          const keys = C.families[fam(S.parts)].keys, rejected = {};
          for (const k in ws) {
            if (k === 'family') continue;
            const o = keys.includes(k) && (optOf(k, ws[k]) || W[k].options.find((x) => String(x[0]) === String(ws[k])));
            if (o) S.parts[k] = o[0]; else rejected[k] = ws[k];
          }
          onPartsChanged(); note('words → ' + JSON.stringify(ws));
          const out = { words: S.parts, name: nameOf(S.parts, S.world), idle: idleWords(S.parts, S.world) };
          if (Object.keys(rejected).length) { out.rejected = rejected; out.hint = 'Unknown word or value for this sentence. bellman.help() lists each word and its values.'; }
          return out;
        } },
      { name: 'set_world', description: 'Change the world and its knobs (knobs not given keep their defaults).', inputSchema: { type: 'object', properties: { world: { type: 'string', enum: Object.keys(C.worldNames) }, knobs: { type: 'object' } }, required: ['world'] },
        execute: ({ world, knobs }) => { if (world === 'vpo' || world === 'supermimic') return window.bellman.level(world); if (customActive()) S.mode = 'workbench'; setWorld(world, knobs || {}); note('world → ' + world + ' ' + JSON.stringify(knobs || {})); return { world: S.world, knobs: S.knobs }; } },
      { name: 'run_experiment', description: 'Train the current sentence on the current world for real (seconds) and return the autopsy. seeds applies to CartPole only (1, 3 or 5); the other worlds use many runs.', inputSchema: { type: 'object', properties: { seeds: { type: 'integer', minimum: 1, maximum: 5 } } },
        execute: async ({ seeds }) => { if (customActive()) return customApi().run(); const so = C.seedOptions[S.world]; if (seeds && S.world === 'cartpole') $('#seeds').value = String(so.reduce((b, n) => (Math.abs(n - seeds) < Math.abs(b - seeds) ? n : b), so[0])); note('running ' + $('#seeds').value + ' runs…'); const a = await run(); if (!a) throw new Error('run failed'); note('done'); return { symptoms: a.symptoms, summary: a.summary }; } },
    ];
  }

  // ---------------------------------------------------------------- for an AI helper (a browser agent, or a chat the player pastes into)
  // window.bellman drives the page with the same tools as the Chat tab; aiBrief() says where the player is, as Markdown.
  const STEP_NAMES = ['predict', 'run', 'diagnose', 'repair', 'explain', 'done'];
  function levelInfo(l) {
    const i = C.levels.indexOf(l), st = S.lstep[l.id] || 0;
    const q = st === 0 ? l.predict : st === 2 ? l.diagnose : st === 4 ? l.explain : null;
    return {
      n: i + 1, id: l.id, title: l.title, world: l.world, done: S.done.includes(l.id), step: STEP_NAMES[Math.min(st, 5)], intro: plainText(l.intro),
      question: q ? { prompt: plainText(q.prompt), options: q.options.map((o, j) => ({ choice: j + 1, reasoning: o.steps.map(plainText), result: plainText(o.result) })) } : null,
      goal: st === 3 ? l.goal.text : null,
    };
  }
  const GAME_ABOUT = 'Breaking Bellman is a small browser game about reinforcement learning. Each level shows a learner (an update rule written as a sentence) that fails in a toy world. The player predicts what happens, runs real training in the page, diagnoses the failure, then fixes it by changing words of the sentence. Every result is a small simulation.';
  function whereLines() {
    const lv = S.mode === 'campaign' ? C.levels.find((l) => l.id === S.level) : null, info = lv ? levelInfo(lv) : null, lab = labState();
    return [
      info ? '- Level ' + info.n + ' of ' + C.levels.length + ': ' + info.title + ' (world: ' + C.worldNames[info.world] + '). Step: ' + info.step + '.' : '- Mode: ' + S.mode + ' (not a campaign level).',
      info ? '- Level text: ' + info.intro : null,
      info && info.question ? '- Open question: ' + info.question.prompt + ' Choices: ' + info.question.options.map((o) => '(' + o.choice + ') ' + o.result).join(' ') : null,
      info && info.goal ? '- Repair goal: ' + info.goal : null,
      '- Levels done: ' + S.done.length + ' of ' + C.levels.length + '. Methods found: ' + S.found.length + '.',
      '- Current sentence: ' + lab.sentenceName + '. World: ' + C.worldNames[lab.world] + ', knobs ' + JSON.stringify(lab.knobs) + '.',
      lab.lastRun ? '- Last run (' + lab.lastRun.seeds + ' runs, ' + lab.lastRun.steps + ' steps): ' + (lab.lastRun.symptoms.join(' ') || 'no symptoms') : '- No run yet in this world.',
    ].filter((x) => x !== null);
  }
  const wordLines = () => vpoActive() ? ['VPO: mean over eight preferences of the best score in a three-route set. GRPO: fixed mean reward for each route. Use the level controls and bellman.run().']
    : supermimicActive() ? ['SuperMimic-inspired: compare PPO in physics, PPO in one fitted model, and backpropagation through that same model. Use the level controls and bellman.run().']
      : C.families[fam(S.parts)].keys.map((k) => '- `' + k + '` (' + W[k].q + '): ' + W[k].options.map((o) => '`' + o[0] + '` = ' + plainText(o[1])).join('; ') + '. Now: `' + S.parts[k] + '`.');
  function aiBrief() {
    return [
      '# Breaking Bellman: a brief for an AI helper',
      '',
      GAME_ABOUT,
      '',
      'How to help: ask the player to predict before you explain. Do not hand over the repair; point at the symptom. Keep it short.',
      '',
      '## Where the player is',
      '',
      ...whereLines(),
      '',
      '## Words of the current sentence',
      '',
      ...wordLines(),
      '',
      '## Drive the page (optional)',
      '',
      'In the browser console, or with a browser agent:',
      '',
      '```js',
      'bellman.help()            // this brief, fresh',
      'bellman.page()            // everything on the screen now, as Markdown',
      'bellman.math()            // the update rule as TeX equations',
      'bellman.state()           // world, knobs, words, last run',
      'bellman.levels()          // all levels; any order is fine',
      'bellman.level(3)          // open level 3 (or its id)',
      "bellman.words({ eps: true })     // change words (keys and values above)",
      "bellman.world('cliff', { slip: 0.1 })",
      'await bellman.run()       // train for real; returns the autopsy',
      '```',
    ].filter((x) => x !== null).join('\n');
  }
  async function copyBrief() {
    const t = aiBrief();
    try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into your AI chat.'); }
    catch (e) { download('breaking-bellman-brief.md', t, 'text/markdown'); toast('Clipboard blocked: downloaded the brief instead.'); }
  }
  // the whole page as Markdown (window.BB.pageMd walks what is on screen): the open tab, the lab, an open dialog, the words
  function pageMarkdown() {
    const md = (el) => window.BB.pageMd.fromNode(el, { depth: 2 });
    const tab = ($('#tabs button[data-mode="' + S.mode + '"]') || {}).textContent || S.mode;
    const dialogs = $$('dialog[open]').map((d) => md(d)).filter(Boolean);
    const now = new Date(), stamp = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return [
      '# Breaking Bellman: the ' + tab + ' page',
      '',
      'I am playing Breaking Bellman (https://hadrien-cornier.github.io/breaking-bellman/). Below is everything on my screen, copied as Markdown on ' + stamp + '. Explain this page to me: what it shows, what the numbers and charts mean, and what to notice. If a level question is still open, help me reason before you give the answer.',
      '',
      '## About the game',
      '',
      GAME_ABOUT,
      '',
      '## Where I am',
      '',
      ...whereLines(),
      '',
      '## ' + tab + ' (main panel)',
      '',
      md($('#mode-pane')),
      '',
      '## Lab (the world, the update rule and the results of the last run)',
      '',
      md($(customActive() ? '#vpo-lab' : '#lab')),
      '',
      '## Notebook',
      '',
      md($(customActive() ? '#custom-notebook' : '#notebook')),
      '',
      ...(dialogs.length ? ['## Open dialog', '', ...dialogs, ''] : []),
      '## Words of the current sentence (each word, its values, and the value now)',
      '',
      ...wordLines(),
      '',
    ].join('\n').replace(/\n{3,}/g, '\n\n');
  }
  async function copyPage() {
    const t = pageMarkdown();
    try { await navigator.clipboard.writeText(t); toast('Copied this page as Markdown. Paste it into your AI chat.'); }
    catch (e) { download('breaking-bellman-' + S.mode + '.md', t, 'text/markdown'); toast('Clipboard blocked: downloaded the page as Markdown instead.'); }
  }
  {
    const tool = (name) => chatTools(null, true).find((t) => t.name === name).execute;
    window.bellman = {
      help: () => aiBrief(),
      page: () => pageMarkdown(),
      math: (parts, world) => vpoActive() ? [{ label: 'VPO set reward', tex: 'R(S) = mean_w max_y dot(w,r(y))' }]
        : supermimicActive() ? [{ label: 'Short-horizon objective', tex: 'J_H = sum_{t=0}^{H-1} gamma^t r_t + gamma^H V(s_H)' }]
          : texLines(Object.assign({}, S.parts, parts || {}), world || S.world).map(([label, tex]) => ({ label, tex })),
      state: () => labState(),
      record: () => runState.record,
      replay: () => ({ time: sceneTime, watching, stale: runState.stale, world: adapter && adapter.world,
        length: adapter && runState.record ? adapter.length(runState.record) : 0 }),
      levels: () => C.levels.map((l) => { const i = levelInfo(l); return { n: i.n, id: i.id, title: i.title, world: i.world, done: i.done, step: i.step }; }),
      level: (which) => {
        const l = C.levels.find((x, i) => x.id === which || i + 1 === which);
        if (!l) throw new Error('No level ' + which + '. See bellman.levels().');
        chooseLevel(l.id);
        return levelInfo(l);
      },
      words: (ws) => (ws ? tool('set_words')(ws) : { words: S.parts, name: nameOf(S.parts, S.world) }),
      world: (name, knobs) => { const r = tool('set_world')({ world: name, knobs }); if (S.mode === 'workbench') render(); return r; },  // a Saboteur mission sets its own world on render
      run: (opts) => tool('run_experiment')(opts || {}),
    };
  }

  // ---------------------------------------------------------------- settings: the AI tutor and your learning log
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function learningLogMarkdown() {
    const day = new Date().toISOString().slice(0, 10);
    const q = Object.values(S.answers), right = q.filter((x) => x.correct).length;
    const lines = ['# My Breaking Bellman learning log', '', 'Exported ' + day + '. Every result is a toy simulation that ran in the page.', '',
      '## Summary', '', '- Methods and failures discovered: ' + S.found.length, '- Campaign levels done: ' + S.done.length + ' of ' + C.levels.length,
      '- Predictions right on the first try: ' + right + ' of ' + q.length, '', '## Discoveries', ''];
    const ids = S.found.filter((id) => C.cards[id]).sort((x, y) => String((S.discoveries[x] || {}).ts || '').localeCompare(String((S.discoveries[y] || {}).ts || '')));
    for (const id of ids) {
      const c = C.cards[id], d = S.discoveries[id] || {};
      lines.push('### ' + c.name + (c.kind === 'failure' ? ' (failure)' : ''), '');
      if (d.ts) lines.push('- When: ' + d.ts.slice(0, 16).replace('T', ' ') + ' UTC');
      if (d.where) lines.push('- Where: ' + d.where);
      if (d.world) lines.push('- World: ' + d.world);
      if (d.sentence) lines.push('- My sentence: ' + d.sentence);
      if (d.result) lines.push('- Result: ' + d.result);
      if (d.predictions) lines.push('- Level questions: ' + d.predictions);
      lines.push('- ' + (c.kind === 'failure' ? 'What it is' : 'What it fixes') + ': ' + plainText(c.fixes));
      lines.push('- ' + (c.kind === 'failure' ? 'Measured' : 'How it still fails') + ': ' + plainText(c.stillWrong));
      const ls = (C.paperLinks || {})[id] || [];
      lines.push('- Source: ' + plainText(c.paper) + (ls.length ? ' ' + ls.map((l) => '[' + l.t + '](' + l.u + ')').join(', ') : ''), '');
    }
    if (!ids.length) lines.push('Nothing yet. Play the first level.', '');
    lines.push('## Levels done', '', ...(S.done.length ? S.done.map((id) => '- ' + ((C.levels.find((l) => l.id === id) || {}).title || id)) : ['None yet.']), '');
    return lines.join('\n');
  }
  function progressJSON() {
    let raw = {}; try { raw = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { /* storage blocked */ }
    return JSON.stringify({ app: 'breaking-bellman', version: 1, exported: new Date().toISOString(), progress: raw }, null, 2);
  }
  const downloadSave = () => download('breaking-bellman-save-' + new Date().toISOString().slice(0, 10) + '.json', progressJSON(), 'application/json');
  function loadSave() {
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => e.target.files[0] && importProgress(e.target.files[0]) });
    document.body.append(fileIn); fileIn.click(); setTimeout(() => fileIn.remove(), 60000);
  }
  function importProgress(file) {
    file.text().then((t) => {
      const v = JSON.parse(t);
      if (!v || v.app !== 'breaking-bellman' || !v.progress) throw new Error('not a Breaking Bellman progress file');
      localStorage.setItem(LS, JSON.stringify(v.progress)); location.reload();
    }).catch((e) => toast('Import failed: ' + e.message));
  }
  let settingsDlg = null;
  function openSettings() {
    if (settingsDlg) settingsDlg.remove();
    const P = window.BB && BB.llm ? BB.llm.PROVIDERS : {};
    const v = Object.assign({}, AI);
    const prov = h('select', { id: 'ai-provider', 'aria-label': 'AI provider' }, [h('option', { value: '' }, 'No tutor (the game works without one)'), ...Object.keys(P).map((k) => h('option', { value: k, selected: v.provider === k }, P[k].label))]);
    const key = h('input', { id: 'ai-key', type: 'password', 'data-md': 'secret', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste your API key', value: v.apiKey || '' });
    const showKey = h('button.btn.ghost.tiny', { type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'Show');
    const model = h('input', { id: 'ai-model', list: 'ai-models', autocomplete: 'off', spellcheck: 'false', value: v.model || '' });
    const models = h('datalist', { id: 'ai-models' });
    const base = h('input', { id: 'ai-base', autocomplete: 'off', spellcheck: 'false', value: v.baseUrl || '' });
    const remember = h('input', { type: 'checkbox', id: 'ai-remember', checked: !!v.remember });
    const status = h('p.small', { id: 'ai-status', 'aria-live': 'polite' });
    const hint = h('p.small.ai-only', { id: 'ai-hint' });
    const HINTS = {
      anthropic: 'Make a key at console.anthropic.com. Give the key a spending limit.',
      openai: 'Make a key at platform.openai.com. Give the key a spending limit, and type a model name or use "List models".',
      openrouter: 'Make a key at openrouter.ai. One key reaches many models. Give the key a credit limit.',
      ollama: 'Ollama runs a model on your own computer, with no key and no cost per message. Start it with OLLAMA_ORIGINS=* ollama serve so this page may call it.',
      custom: 'Any server with an OpenAI-compatible /chat/completions endpoint. It must allow requests from this page (CORS).',
    };
    const read = () => ({ provider: prov.value, apiKey: key.value.trim(), model: model.value.trim(), baseUrl: base.value.trim(), remember: remember.checked });
    const sync = () => {
      const p = P[prov.value];
      for (const el of settingsDlg.querySelectorAll('.ai-only')) el.hidden = !p;
      if (!p) return;
      hint.textContent = HINTS[prov.value] || '';
      key.closest('.field').hidden = !p.needsKey && prov.value !== 'custom';
      model.placeholder = p.defaultModel ? 'Default: ' + p.defaultModel : 'Model name, for example from "List models"';
      base.placeholder = p.baseUrl || 'https://your-server/v1';
      base.closest('.field').hidden = !(prov.value === 'ollama' || prov.value === 'custom' || base.value);
    };
    const listBtn = h('button.btn.ghost.tiny', { type: 'button', onclick: async () => {
      status.textContent = 'Asking the provider for its models…';
      try { const ids = await BB.llm.listModels(read()); models.replaceChildren(...ids.map((id) => h('option', { value: id }))); status.textContent = ids.length + ' models. Click the model box to pick one.'; }
      catch (e) { status.textContent = 'Could not list models: ' + e.message; }
    } }, 'List models');
    const testBtn = h('button.btn.ghost', { type: 'button', onclick: async () => {
      const t = read(); status.textContent = 'Sending one short test message…';
      try { const out = await BB.llm.makeSampler(Object.assign({}, t, { maxTokens: 20 }))('Reply with the single word OK.', {}); status.textContent = 'It works. The model said: ' + String(out.text).slice(0, 80); }
      catch (e) { status.textContent = 'It did not work: ' + e.message; }
    } }, 'Test');
    const field = (label, input, extra, cls) => h('label.field' + (cls ? '.' + cls : ''), null, [h('span.small', { text: label }), h('div.row', null, [input, extra || null])]);
    settingsDlg = h('dialog.settings', { id: 'settings-dlg', 'aria-label': 'Settings' }, [
      h('form', { method: 'dialog', class: 'stack' }, [
        h('div.row', { style: 'justify-content:space-between' }, [h('h2', { text: 'Settings' }), h('button.btn.ghost.tiny', { value: 'close', 'aria-label': 'Close' }, 'Close')]),
        h('section.stack', null, [
          h('h3', { text: 'AI tutor (optional)' }),
          h('p.small', { text: 'Every level, run and chart works without AI. The tutor only powers the Chat tab. Bring your own key: it stays in this browser and the page sends it only to the provider you pick. There is no Breaking Bellman server, so nobody else sees it and nobody else spends it.' }),
          field('Provider', prov),
          field('API key', key, showKey, 'ai-only'),
          field('Model', model, listBtn, 'ai-only'), models,
          field('Server address', base, null, 'ai-only'),
          h('label.small.ai-only', null, [remember, ' Remember the key on this computer (off: it is forgotten when you close the tab)']),
          hint,
          h('div.row.ai-only', null, [testBtn]), status,
          h('div.row', null, [
            h('button.btn', { type: 'button', onclick: () => { AI = read(); saveAI(AI); toast(AI.provider ? 'Tutor saved: ' + aiLabel() : 'Tutor off'); settingsDlg.close(); if (S.mode === 'chat') render(); } }, 'Save'),
            h('button.btn.ghost', { type: 'button', onclick: () => { AI = { provider: '', apiKey: '', model: '', baseUrl: '', remember: false }; saveAI(AI); key.value = ''; prov.value = ''; sync(); toast('Key forgotten'); if (S.mode === 'chat') render(); } }, 'Forget the key'),
          ]),
        ]),
        h('section.stack', null, [
          h('h3', { text: 'Local simulation cache' }),
          h('p.small', { text: 'Fast checks published results, then exact results saved in this browser. Live always trains fresh and saves for next time. Storage limits or private windows may prevent saving.' }),
          h('button.btn.ghost', { type: 'button', id: 'clear-local-cache', onclick: async () => {
            const cleared = await fastClient.clear();
            toast(cleared ? 'Local simulation cache cleared.' : 'Local storage unavailable. You can still run Live.');
          } }, 'Clear local simulation cache'),
          h('h3', { text: 'Your progress' }),
          h('p.small', { text: 'Progress saves in this browser (local storage), so a private window or cleared site data forgets it. Download a save file to keep it, or to continue in another browser or on another computer.' }),
          h('div.row', null, [
            h('button.btn.ghost', { type: 'button', onclick: downloadSave }, 'Download save file'),
            h('button.btn.ghost', { type: 'button', onclick: loadSave }, 'Load save file'),
            h('button.btn.ghost', { type: 'button', onclick: () => download('breaking-bellman-log-' + new Date().toISOString().slice(0, 10) + '.md', learningLogMarkdown(), 'text/markdown') }, 'Export the log (Markdown)'),
          ]),
          h('h3', { text: 'Play with your own AI' }),
          h('p.small', { text: 'Using an AI in your browser (for example Codex, Claude or Gemini)? "Copy for your AI" gives it a short brief: where you are and the words you can change. A browser agent can also drive the page with the bellman object (type bellman.help() in the console).' }),
          h('div.row', null, [h('button.btn.ghost', { type: 'button', onclick: copyBrief }, 'Copy for your AI')]),
          h('div.row', null, [h('button.btn.ghost.tiny.danger', { type: 'button', onclick: () => { if (confirm('Erase all progress in this browser? This cannot be undone.')) { try { localStorage.removeItem(LS); } catch (e) { /* storage blocked */ } location.reload(); } } }, 'Erase my progress')]),
        ]),
        h('p.small', null, ['Breaking Bellman is open source (MIT). ', h('a', { href: 'https://github.com/Hadrien-Cornier/breaking-bellman', target: '_blank', rel: 'noopener' }, 'Source code and how it works'), '.']),
      ]),
    ]);
    document.body.append(settingsDlg);
    prov.addEventListener('change', () => { const p = P[prov.value]; if (p && !model.value) model.value = ''; base.value = ''; models.replaceChildren(); sync(); });
    sync();
    settingsDlg.showModal();
  }
  $('#settings-btn').addEventListener('click', openSettings);

  // first visit: what this is, in four lines
  function showIntro() {
    const close = (mode) => { S.intro = 1; save(); dlg.close(); dlg.remove(); if (mode && mode !== S.mode) { S.mode = mode; save(); if (mode === 'campaign') enterLevel(C.levels.find((l) => l.id === S.level) || C.levels[0]); render(); } };
    const step = (n, t, d) => h('li', null, [h('span.num', { text: n }), h('div', null, [h('b', { text: t }), h('p.small', { text: d })])]);
    const dlg = h('dialog.intro', { 'aria-label': 'Welcome' }, [h('div.stack', null, [
      h('div.eyebrow', { text: 'A small game about reinforcement learning' }),
      h('h1', { text: 'Breaking Bellman' }),
      h('p.lead', { text: 'Real RL algorithms train in this page and fail in front of you. You figure out why, then fix them by changing a word.' }),
      h('ol.steps', null, [
        step('1', 'Predict', 'Guess what the learner will do. Be honest.'),
        step('2', 'Run', 'Real training, in your browser, in seconds.'),
        step('3', 'Fix', 'Change one word of its update rule. Get it right and you have reinvented a published method.'),
      ]),
      h('p.small', { text: C.levels.length + ' levels, any order. Progress saves in this browser; Settings has a save file you can take anywhere. No account, no server. The AI tutor is optional.' }),
      h('div.row', null, [h('button.btn', { type: 'button', onclick: () => close('campaign') }, 'Start level 1'), h('button.btn.ghost', { type: 'button', onclick: () => close('workbench') }, 'Open the workbench')]),
    ])]);
    dlg.addEventListener('cancel', () => { S.intro = 1; save(); });
    document.body.append(dlg); dlg.showModal();
  }

  // ---------------------------------------------------------------- top level
  function render() {
    const oldStrip = document.getElementById('campaign-strip');
    if (oldStrip) oldStrip.remove();
    const oldBackup = document.getElementById('reward-backup');
    if (oldBackup) oldBackup.remove();
    $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === S.mode ? 'true' : 'false'));
    mounts = mounts.filter((m) => m.permanent);
    const pane = $('#mode-pane'); pane.replaceChildren();
    S.afterRun = null; S.onPartsChange = null;
    if (!vpoActive()) BBVPO.cancel();
    if (!supermimicActive()) BBSUPERMIMIC.cancel();
    const mapping = S.mode === 'campaign' && mapOpen;
    if (!mapping && !customActive() && !RLA.worlds[S.world]) setWorld(C.families[fam(S.parts)].worlds[0]);
    document.querySelector('main.layout').classList.toggle('mapping', mapping);
    $('#lab').hidden = mapping || customActive(); $('#vpo-lab').hidden = mapping || !customActive();
    $('#notebook').hidden = mapping || customActive(); customNotebook.hidden = mapping || !customActive();
    const campaign = S.mode === 'campaign' && !mapping;
    const layout = document.querySelector('main.layout');
    layout.classList.toggle('lesson-shell', campaign);
    $('#run-btn').classList.toggle('ghost', campaign);
    // DOM, visual and keyboard order agree: map, measured scene, teaching step, Notebook.
    if (campaign) layout.insertBefore(customActive() ? $('#vpo-lab') : $('#lab'), pane);
    else layout.prepend(pane);
    const key = campaign ? S.level : S.mode;
    if (notebookLevel !== key) {
      notebookLevel = key; shell.reset(); customShell.reset(); $('#lesson-notes').replaceChildren();
      for (const name of ['rule', 'curve', 'autopsy', 'notes']) {
        customShell.notebook(name).replaceChildren(h('p.small', { text: name === 'notes' ? 'Lesson notes appear here.' : 'Run the lesson to inspect its ' + name + '.' }));
      }
    }
    $('#notebook').classList.toggle('supporting-lab', !campaign);
    if (!campaign) {
      $('#notebook').open = true;
      $$('#notebook [data-notebook-panel]').forEach(panel => { panel.hidden = false; });
      $('#lab').prepend($('#game-rules'));
    } else $('#notebook-rule').prepend($('#game-rules'));
    if (S.mode === 'campaign' && !mapping) document.querySelector('main.layout').prepend(campaignMap.strip());
    if (customActive() && !mapping) customShell.objective(C.levels.find(l => l.id === S.level).goal.text);
    MODES[S.mode](pane);
    refreshSentences();
    if (!customActive()) renderRules();
    updateScore();
  }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    S.mode = b.dataset.mode; save();
    if (S.mode === 'campaign' && !mapOpen) enterLevel(C.levels.find((l) => l.id === S.level));
    render();
  }));
  // The header uses the same Rover+ as the simulations, without an animation clock.
  const logoCanvas = $('#logo-robot'), logoContext = logoCanvas.getContext('2d');
  logoContext.scale(2, 2);
  BB.scenes.robot(logoContext, 24, 44, 39, { noShadow: true });
  $('#campaign-logo').addEventListener('click', (event) => {
    event.preventDefault();
    showMap();
  });
  $('#run-btn').addEventListener('click', () => run());
  $('#scene-watch').addEventListener('click', watchScene);
  $('#scene-step').addEventListener('click', () => {
    pauseScene(); if (!runState.record) return;
    sceneTime = Math.min(adapter.length(runState.record) - 1, sceneTime + 1);
    adapter.draw(runState.record, sceneTime); scenePosition();
  });
  $('#scene-replay').addEventListener('click', () => {
    pauseScene(); sceneTime = 0;
    if (runState.record) { adapter.draw(runState.record, sceneTime); scenePosition(); }
  });
  $('#scene-seed').addEventListener('change', e => { scenePolicy = +e.target.value; sceneTime = 0; renderStage(); });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => pauseScene());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    renderStage();
    if (runState.record) renderCharts(null, true);
  });
  $('#copy-page-btn').addEventListener('click', copyPage);
  // redraw on a real width change only: phones fire resize when the address bar hides, and a redraw restarts the replay
  let stageW = 0;
  window.addEventListener('resize', () => {
    const w = Math.round($('#stage').getBoundingClientRect().width);
    if (w === stageW) return;
    stageW = w;
    if (S.results.length) renderCharts(S.results.map((r) => ({ evals: r.evals, diag: r.diag })), true);
    renderStage();
  });

  // the lab's own sentence (always present)
  $('#rule').append(mountSentence({ getParts: () => S.parts, setPart: setMainPart, world: () => S.world, focus: () => (S.mode === 'campaign' ? S.focus || [] : []), withName: true, permanent: true, preset: true }));
  $('#replay-lab').append(replayView());
  $('#grid-lab').append(gridView());
  $('#grid-card').addEventListener('toggle', () => { if ($('#grid-card').open) drawGrid(); });
  $('#run-mode').value = 'fast'; // A fresh-Live override lasts only for this page visit.
  for (const sel of ['#seeds', '#budget', '#run-mode']) $(sel).addEventListener('change', () => { cancelRun(); if (!G.running) drawGrid(); });
  document.addEventListener('change', () => { markRunStale(); if (activeRun && runIdentity() !== activeRun.identity) cancelRun(); });

  budgetOptions();
  if (S.mode === 'campaign' && !mapOpen) enterLevel(C.levels.find((l) => l.id === S.level));
  else setWorld(S.world);
  renderStage(); drawCompare();
  render();
  // Algorithm-name reminders: enhance the whole page once, then keep up with every surface that
  // renders a name (prose, questions, method labels, Codex and the family tree) as it appears.
  if (window.ALGO_HELP) {
    // Shared method-panel provider: gate discovery so undiscovered methods show no spoilers,
    // and hand the panel the discovery card + source links + the recipe blurb (game adaptation).
    window.ALGO_HELP.discoveryFor = (algoId) => {
      if (algoId === 'supermimic' && window.BBSUPERMIMIC) return window.BBSUPERMIMIC.discoveryFor();
      const cid = window.ALGO_HELP.cardOf(algoId);
      if (!cid) return { discovered: false };
      const discovered = S.found.includes(cid) || S.given.includes(cid);
      const rec = recipeOfCard(cid);
      return { discovered, card: C.cards[cid], links: (C.paperLinks || {})[cid] || [], blurb: rec ? rec.blurb : '' };
    };
    window.ALGO_HELP.installAuto(document.body);
  }
  if (!S.intro && !mapOpen) showIntro();
})();
