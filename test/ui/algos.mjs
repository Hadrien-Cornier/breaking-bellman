// UI algorithm-name reminder test: the name itself is the trigger and it must open only on a
// deliberate action (click, tap or keyboard activation), never on mouse hover or keyboard focus
// alone, keep a visible focus indicator, dismiss reliably with accessible semantics, and never
// nest a control in a control (button, select, option, disabled control and tree node get an
// accessible equivalent).
// Runs against the real built game. Run: node build.mjs && node test/ui/algos.mjs [screenshot dir]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const load = (m) => { try { return require(m); } catch (e) { return null; } };
const pw = (process.env.PW_CORE && load(process.env.PW_CORE)) || load('playwright') || load('playwright-core');
if (!pw) { console.error('Playwright not found.'); process.exit(2); }
const { chromium } = pw;
const exe = process.env.PW_CHROMIUM || '';
const fs = await import('fs');
const os = await import('os');
const out = process.argv[2] || os.tmpdir() + '/bb-algo-rem-shots';
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(new URL('../../dist/breaking-bellman.html', import.meta.url), out + '/page.html');
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const errors = [], fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const POP = '#algo-rem-popover';

async function session(w, h, name, opts, fn) {
  const page = await browser.newPage(Object.assign({ viewport: { width: w, height: h } }, opts || {}));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto('file://' + out + '/page.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector('dialog.intro'); if (d && d.close) d.close(); });
  await page.waitForTimeout(200);
  await fn(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, name + ' no horizontal scroll (scrollWidth ' + sw + ', viewport ' + w + ')');
  await page.close();
}

// Build one bed of every surface a name can appear in, from the real content strings, and enhance it.
async function buildBed(page) {
  await page.evaluate(() => {
    const A = window.ALGO_HELP, C = window.CONTENT;
    const lv = C.levels.find((l) => l.id === 'careful');
    const bed = document.createElement('div');
    bed.id = 'algo-bed';
    bed.innerHTML =
      '<p id="a-prose">DDPG is the actor-critic baseline.</p>' +
      '<p id="a-question">' + lv.predict.prompt + '</p>' +
      '<h3 id="a-label">Soft actor-critic (SAC)</h3>' +
      '<button id="a-nested" type="button">Rebuild TD3 from memory</button>' +
      '<select id="a-select"><option id="a-option">Twin delayed DDPG (TD3)</option></select>' +
      '<svg width="200" height="40"><g id="a-node" role="button" tabindex="0"><text x="10" y="20">Q-learning</text></g></svg>';
    document.body.appendChild(bed);
    A.enhance(bed);
  });
  await page.waitForTimeout(150);   // let the auto-enhancer settle too (idempotent)
}

// ---- desktop: prose, question, label, and the nested/select/tree equivalents ----
await session(1280, 800, 'desktop', {}, async (page) => {
  await buildBed(page);

  // every surface that may hold a control-free name got a trigger button
  const counts = await page.evaluate(() => ({
    prose: document.querySelectorAll('#a-prose .algo-name').length,
    question: document.querySelectorAll('#a-question .algo-name').length,
    label: document.querySelectorAll('#a-label .algo-name').length,
  }));
  check(counts.prose >= 1, 'level prose gets a name trigger (' + counts.prose + ')');
  check(counts.question >= 1, 'a question prompt gets a name trigger (' + counts.question + ')');
  check(counts.label === 1, 'a method label is one trigger (' + counts.label + ')');

  // hover and keyboard focus alone never open the reminder (click-only contract)
  await page.hover('#a-prose .algo-name');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => (document.getElementById('algo-rem-popover')?.hidden ?? true)),
    'mouse hover alone does not open the reminder');
  await page.focus('#a-prose .algo-name');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => (document.getElementById('algo-rem-popover')?.hidden ?? true)),
    'keyboard focus alone does not open the reminder');
  // the trigger keeps a visible focus indicator
  const ring = await page.evaluate(() => {
    const b = document.querySelector('#a-prose .algo-name');
    b.focus({ focusVisible: true });
    const s = getComputedStyle(b);
    return { visible: b.matches(':focus-visible'), outline: s.outlineStyle, width: s.outlineWidth };
  });
  check(ring.visible && ring.outline !== 'none' && parseFloat(ring.width) > 0,
    'the trigger shows a visible focus indicator: ' + JSON.stringify(ring));

  // click opens the reminder
  await page.click('#a-prose .algo-name');
  await page.waitForTimeout(120);
  let pop = await page.evaluate(() => {
    const p = document.getElementById('algo-rem-popover');
    return { open: p && !p.hidden, title: p.querySelector('.metric-help-title').textContent,
      idea: p.querySelector('.algo-idea').textContent, math: p.querySelector('.algo-math').textContent,
      symbols: p.querySelector('.algo-symbols').textContent, expanded: document.querySelector('#a-prose .algo-name').getAttribute('aria-expanded') };
  });
  check(pop.open, 'click opens the reminder');
  check(/Deep deterministic policy gradient/.test(pop.title), 'the reminder title is the expanded name: ' + pop.title);
  check(pop.idea.length > 10, 'the reminder has a general idea');
  check(/y = r \+ gamma/.test(pop.math), 'the reminder has the defining math: ' + pop.math);
  check(/mu\(s\)/.test(pop.symbols), 'the reminder explains its symbols: ' + pop.symbols.slice(0, 60));
  check(pop.expanded === 'true', 'the trigger sets aria-expanded while open');

  // Escape dismisses and returns focus to the trigger
  await page.keyboard.press('Escape');
  await page.waitForTimeout(160);
  const dismissed = await page.evaluate(() => ({ hidden: document.getElementById('algo-rem-popover').hidden,
    back: document.activeElement.className }));
  check(dismissed.hidden, 'Escape dismisses the reminder');
  check(/algo-name/.test(dismissed.back), 'Escape returns focus to the name trigger');
  // keyboard activation (Enter, then Space) opens it
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => !(document.getElementById('algo-rem-popover')?.hidden ?? true)), 'Enter opens the reminder');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => !(document.getElementById('algo-rem-popover')?.hidden ?? true)), 'Space opens the reminder');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  // tap / click opens and pins; a click outside dismisses
  await page.click('#a-label .algo-name');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => !(document.getElementById('algo-rem-popover')?.hidden ?? true)), 'tap/click opens the reminder');
  await page.mouse.click(4, 4);
  await page.waitForTimeout(120);
  check(await page.evaluate(() => (document.getElementById('algo-rem-popover')?.hidden ?? true)), 'a click outside dismisses the reminder');

  // close button dismisses too
  await page.click('#a-label .algo-name');
  await page.waitForTimeout(80);
  await page.click(POP + ' .metric-help-close');
  await page.waitForTimeout(80);
  check(await page.evaluate(() => (document.getElementById('algo-rem-popover')?.hidden ?? true)), 'the close button dismisses the reminder');

  // nested / select / option / disabled / tree: no nested control, an accessible equivalent instead
  const a11y = await page.evaluate(() => {
    const desc = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
    return {
      nestedButtons: document.querySelectorAll('#a-nested .algo-name').length,
      nestedDesc: desc(document.getElementById('a-nested')),
      selectDesc: desc(document.getElementById('a-select')),
      nodeDesc: desc(document.getElementById('a-node')),
      svgButtons: document.querySelectorAll('svg .algo-name').length,
    };
  });
  check(a11y.nestedButtons === 0, 'no control is nested inside the rebuild button');
  check(/Twin delayed|TD3/.test(a11y.nestedDesc), 'the rebuild button gets an accessible equivalent: ' + a11y.nestedDesc.slice(0, 50));
  check(/Twin delayed DDPG/.test(a11y.selectDesc), 'the select/option label gets an accessible equivalent');
  check(/Q-learning/.test(a11y.nodeDesc), 'the family-tree node gets an accessible equivalent');
  check(a11y.svgButtons === 0, 'no <button> is injected into SVG');
  await page.screenshot({ path: out + '/desktop-algo.png' });
});

// ---- the real game: a campaign level whose prose and question name algorithms ----
await session(1280, 800, 'game', {}, async (page) => {
  await page.evaluate(() => window.bellman.level('careful'));
  await page.waitForSelector('#a-prose, .algo-name', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const found = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.algo-name')).map((b) => b.textContent);
    return names;
  });
  check(found.length >= 1, 'the real level renders name triggers (' + found.join(', ') + ')');
  check(found.some((n) => /Q-learning/.test(n)), 'Q-learning in the level prose is a trigger');

  await page.hover('.lesson-help .algo-name');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => (document.getElementById('algo-rem-popover')?.hidden ?? true)),
    'hover alone does not open a reminder in the real game');
  await page.click('.lesson-help .algo-name');
  await page.waitForTimeout(120);
  const pop = await page.evaluate(() => { const p = document.getElementById('algo-rem-popover');
    return { open: p && !p.hidden, title: p.querySelector('.metric-help-title').textContent }; });
  check(pop.open, 'click opens a reminder in the real game');
  check(/Q-learning/.test(pop.title), 'the real reminder expands the name: ' + pop.title);
  await page.screenshot({ path: out + '/game-algo.png' });
});

// ---- the offline arm: the learned TD3 preset and the learned CQL/AWR method panels (real flows) ----
await session(1280, 900, 'offline', {}, async (page) => {
  await page.evaluate(() => {
    localStorage.setItem('breaking-bellman-v1', JSON.stringify({
      intro: 1, mode: 'campaign', level: 'offline',
      found: ['td3', 'cql', 'awr', 'dqn'], given: [], seen: [], done: [], answers: {}, missions: {},
    }));
  });
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector('dialog.intro'); if (d && d.close) d.close(); });
  await page.evaluate(() => window.bellman.level('offline'));
  await page.waitForTimeout(500);

  if (await page.locator('.lesson-help[open]').count()) await page.getByRole('button', { name: 'Back to the experiment', exact: true }).click();

  // 175: only unlocked (learned) methods are offered; unlearned ones are not listed.
  const opts = await page.evaluate(() => Array.from(document.querySelector('.preset select').options).map((o) => ({ t: o.textContent, disabled: o.disabled })));
  check(opts.some((o) => /TD3/.test(o.t)), 'TD3 is offered once learned');
  check(opts.some((o) => /CQL/.test(o.t)), 'CQL is offered once learned');
  check(opts.some((o) => /AWR/.test(o.t)), 'AWR is offered once learned');
  check(!opts.some((o) => /IQL/.test(o.t)), 'unlearned methods are not offered: ' + opts.map((o) => o.t).join(', '));
  const dqnOpt = opts.find((o) => /DQN/.test(o.t));
  check(dqnOpt && dqnOpt.disabled && /Needs|world/i.test(dqnOpt.t), 'a learned but incompatible method is disabled with a reason: ' + (dqnOpt && dqnOpt.t));

  // 175: load TD3 into the current offline arm. Only its own settings change, and nothing runs.
  const before = await page.evaluate(() => window.bellman.state().words);
  const td3Val = await page.evaluate(() => Array.from(document.querySelector('.preset select').options).find((o) => /TD3/.test(o.textContent)).value);
  if (await page.locator('#notebook').count()) {
    if (!await page.locator('#notebook').evaluate((node) => node.open)) await page.locator('#notebook > summary').click();
    await page.locator('#notebook-tab-rule').click();
  }
  check(await page.locator('.preset select').isVisible(), 'learned preset selector is visible in Notebook Rule');
  await page.selectOption('.preset select', td3Val);
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    words: window.bellman.state().words, label: (document.querySelector('.compound .big') || {}).textContent || '',
    lastRun: window.bellman.state().lastRun, runDisabled: document.getElementById('run-btn').disabled,
    world: window.bellman.state().world, level: window.bellman.state().level,
    diff: Array.from(document.querySelectorAll('.preset-diff')).map((e) => e.textContent).join(' '),
  }));
  const changed = Object.keys(st.words).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(st.words[k]));
  const recipeKeys = await page.evaluate(() => Object.keys(window.CONTENT.recipes.find((r) => r.card === 'td3').keys));
  check(/TD3/.test(st.label), 'the method label now reads TD3: ' + st.label);
  check(changed.length > 0 && changed.every((k) => recipeKeys.includes(k)), 'only TD3 settings changed: ' + changed.join(','));
  check(JSON.stringify(before.source) === JSON.stringify(st.words.source) && JSON.stringify(before.demos) === JSON.stringify(st.words.demos),
    'the offline dataset stays (source ' + st.words.source + ', demos ' + st.words.demos + '), no silent switch');
  check(st.world === 'reach' && /No new tries/.test(st.level), 'the environment and level stay: ' + st.world + ' / ' + st.level);
  check(st.lastRun === null && st.runDisabled === false, 'selecting a preset starts no run');
  check(/Changed settings/.test(st.diff), 'the selector states exactly which settings it changed');

  // 173/176: the learned CQL method panel at its method label: benefits, source, paper link.
  const cqlVal = await page.evaluate(() => Array.from(document.querySelector('.preset select').options).find((o) => /CQL/.test(o.textContent)).value);
  await page.selectOption('.preset select', cqlVal);
  await page.waitForTimeout(250);
  const cql = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.algo-name')).find((b) => /Conservative Q|CQL/.test(b.textContent));
    if (!btn) return { found: false };
    btn.click();
    return new Promise((res) => setTimeout(() => {
      const p = document.getElementById('algo-rem-popover');
      const d = p.querySelector('.algo-discovery');
      res({ found: true, open: !p.hidden, hasPanel: !!d, text: d ? d.textContent : '',
        links: Array.from(p.querySelectorAll('.algo-links a')).map((a) => a.href) });
    }, 150));
  });
  check(cql.found && cql.open && cql.hasPanel, 'the learned CQL name opens its method panel');
  check(/What it fixes/.test(cql.text) && /Where it still fails/.test(cql.text), 'the panel says what it fixes and where it fails');
  check(/Kumar et al/.test(cql.text), 'the panel gives the source: ' + cql.text.slice(0, 100));
  check(cql.links.some((u) => /arxiv/.test(u)), 'the panel links the paper: ' + cql.links.join(', '));
  await page.keyboard.press('Escape');

  // 173/176: the learned AWR method panel, same shared component.
  const awrVal = await page.evaluate(() => Array.from(document.querySelector('.preset select').options).find((o) => /AWR/.test(o.textContent)).value);
  await page.selectOption('.preset select', awrVal);
  await page.waitForTimeout(250);
  const awr = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.algo-name')).find((b) => /Advantage-weighted|AWR/.test(b.textContent));
    if (!btn) return { found: false };
    btn.click();
    return new Promise((res) => setTimeout(() => {
      const p = document.getElementById('algo-rem-popover');
      const d = p.querySelector('.algo-discovery');
      res({ found: true, open: !p.hidden, hasPanel: !!d, text: d ? d.textContent : '' });
    }, 150));
  });
  check(awr.found && awr.open && awr.hasPanel, 'the learned AWR name opens its method panel');
  check(/Peng et al/.test(awr.text), 'the AWR panel gives the source');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: out + '/offline-preset.png' });
  // No spoilers: the Methods map exposes the unlearned SAC name. The old
  // all-phase list is now a compact strip, so it no longer supplies that trigger.
  await page.locator('#campaign-logo').click();
  await page.locator('[data-zoom="methods"]').click();
  await page.waitForSelector('[data-node="explore"] .algo-name');
  const gate = await page.evaluate(() => {
    const btn = document.querySelector('[data-node="explore"] .algo-name');
    if (!btn) return { found: false };
    btn.click();
    return new Promise((res) => setTimeout(() => {
      const p = document.getElementById('algo-rem-popover');
      res({ found: true, open: !p.hidden, hasPanel: !!p.querySelector('.algo-discovery') });
    }, 150));
  });
  check(gate.found && gate.open && !gate.hasPanel, 'an unlearned name shows the reminder but no method panel (no spoiler)');
  await page.screenshot({ path: out + '/unlearned-map-method.png' });
});

// ---- phone: tap access and the popover fits the small screen ----
await session(390, 844, 'phone', { hasTouch: true }, async (page) => {
  await page.evaluate(() => window.bellman.level('careful'));
  await page.waitForTimeout(500);
  const has = await page.evaluate(() => document.querySelectorAll('.algo-name').length);
  check(has >= 1, 'the phone layout renders name triggers (' + has + ')');
  await page.locator('.lesson-help .algo-name').first().tap();
  await page.waitForTimeout(150);
  const p = await page.evaluate(() => {
    const el = document.getElementById('algo-rem-popover');
    const r = el.getBoundingClientRect();
    return { open: !el.hidden, fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 };
  });
  check(p.open, 'tap opens the reminder on the phone');
  check(p.fits, 'the open reminder fits the 390px viewport');
  await page.screenshot({ path: out + '/phone-algo.png' });
});

// Regression: a body-level reminder used to open behind the modal briefing and stay inert.
for (const [w, h] of [[1348, 898], [1186, 835], [390, 844]]) {
  await session(w, h, 'briefing-' + w, {}, async page => {
    await page.locator('#campaign-logo').click();
    await page.locator('[data-map-level="slots"]').click();
    const trigger = page.locator('.map-methods .algo-name').first();
    await trigger.hover();
    await trigger.focus();
    check(await trigger.getAttribute('aria-expanded') === 'false', 'briefing hover/focus does not open a reminder at ' + w);
    await page.keyboard.press('Enter');
    const visible = await page.locator(POP).evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.matches(':popover-open') && !!el.closest('dialog[open]') &&
        el.contains(document.elementFromPoint(r.left + 20, r.top + 20)) &&
        r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    });
    check(visible, 'briefing reminder is visible, interactive and within the viewport at ' + w);
    await page.keyboard.press('Escape');
    check(await page.locator('.map-brief[open]').count() === 1 && await trigger.evaluate(el => el === document.activeElement), 'Escape keeps the briefing open and restores trigger focus at ' + w);
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Close reminder', exact: true }).click();
    await trigger.click();
    check(await page.locator(POP).isVisible(), 'briefing click opens the reminder at ' + w);
    await page.screenshot({ path: out + '/briefing-' + w + '.png' });
  });
}

console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
await browser.close();
if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('algorithm reminder UI checks passed');
