// UI metric-help test: the shared "?" trigger and popover on every real surface that prints a
// metric: the autopsy cards, the run headline, the KL/entropy chart titles, the replay stages,
// the grid result tables, and the campaign question cards. Also the pure-DOM edge cases the
// enhancer must survive: a detached text node, keyboard open/close, focus return, and phone-size
// rendering. Run: node build.mjs && node test/ui/metric-help.mjs [screenshot dir]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const load = (m) => { try { return require(m); } catch (e) { return null; } };
const pw = (process.env.PW_CORE && load(process.env.PW_CORE)) || load('playwright') || load('playwright-core');
if (!pw) { console.error('Playwright not found.'); process.exit(2); }
const { chromium } = pw;
const exe = process.env.PW_CHROMIUM || '';
const fs = await import('fs');
const os = await import('os');
const out = process.argv[2] || os.tmpdir() + '/bb-metric-help-shots';
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(new URL('../../dist/breaking-bellman.html', import.meta.url), out + '/page.html');
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const errors = [], fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const runDone = (page) => page.waitForFunction(() => !document.querySelector('#run-btn').disabled && document.querySelector('#run-result').textContent.length > 0, null, { timeout: 300000 });
const pickBudget = (page, near) => page.evaluate((near) => {
  const opts = Array.from(document.querySelector('#budget').options).map((o) => +o.value);
  opts.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
  document.querySelector('#budget').value = String(opts[0]);
  return opts[0];
}, near);
async function session(w, h, name, fn) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto('file://' + out + '/page.html');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const d = document.querySelector('dialog.intro'); if (d) d.close && d.close(); const b = document.querySelector('dialog.intro button'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await fn(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, name + ' no horizontal scroll (scrollWidth ' + sw + ', viewport ' + w + ')');
  await page.close();
  return page;
}
async function setWord(page, scope, key, label) {
  await page.locator(scope + ' .w[data-key="' + key + '"]').first().click();
  await page.locator(scope + ' .chooser .choice', { hasText: label }).first().click();
}

// ---- pure DOM: the enhancer survives a detached text node and the exact static card strings ----
await session(1280, 800, 'dom', async (page) => {
  const t = await page.evaluate(() => {
    const R = window.RLHELP;
    // detached node: no parent, must skip instead of crashing
    const loose = document.createTextNode('Mean KL 1.50 per update');
    const placed0 = R.enhance(loose, {});
    const detachedRoot = document.createElement('div');
    detachedRoot.textContent = 'Mean entropy 0.031 nats';
    const placed1 = R.enhance(detachedRoot, { actions: 2 });
    // the static bigsteps question card, exactly as the game builds it
    const C = window.CONTENT, lv = C.levels.find((l) => l.id === 'bigsteps');
    const prompt = lv && lv.diagnose && lv.diagnose.prompt;
    const holder = document.createElement('div');
    holder.innerHTML = '<p>' + prompt + '</p>';
    document.body.append(holder);
    R.enhance(holder, { actions: 2 });
    const btns = holder.querySelectorAll('.metric-help-btn');
    const pop = () => document.getElementById('metric-help-popover');
    btns[0].click();
    const popText = pop().textContent;
    const klAnchorOk = /like a 50\/50 choice becoming 99\/1 in one update/.test(popText);
    const expanded = btns[0].getAttribute('aria-expanded');
    // close by Escape: focus must come back to the trigger
    btns[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const focusBack = document.activeElement === btns[0];
    const closed = pop().hidden;
    // the live autopsy card strings, at the cited scale points
    const cards = [
      'Each update moves the policy a lot. Mean KL between the policy before and after an update: 6.234 (PPO-sized steps are about 0.01 to 0.02).',
      'The policy stopped exploring. Mean entropy 0.031 nats: it almost always picks the same action.',
    ];
    const readings = [];
    for (const text of cards) {
      holder.replaceChildren();
      holder.innerHTML = '<p>' + text + '</p>';
      R.enhance(holder, { actions: 2 });
      const b = holder.querySelector('.metric-help-btn');
      b.click();
      readings.push(pop().textContent);
      R.closeHelp();
    }
    const detachedPlaced = detachedRoot.querySelectorAll('.metric-help-btn').length;
    holder.remove();
    return { prompt, placed0, placed1, detachedPlaced, n: btns.length, klAnchorOk, expanded, closed, focusBack,
      kl6: readings[0], ent: readings[1] };
  });
  check(t.placed0 === 0, 'a detached text node is skipped, not crashed (placed ' + t.placed0 + ')');
  check(t.placed1 === 0 || t.placed1 === 1, 'a detached subtree with a parent is handled (placed ' + t.placed1 + ')');
  check(t.prompt && /Mean KL [\d.]+ per update/.test(t.prompt), 'the bigsteps diagnose prompt is the real card string: ' + (t.prompt || '').slice(0, 60));
  check(t.n >= 1, 'the static bigsteps question card gets a trigger (' + t.n + ' buttons)');
  check(t.klAnchorOk, 'the KL 1.50 card opens the 99/1 scale anchor');
  check(t.expanded === 'true', 'the open trigger sets aria-expanded="true"');
  check(t.closed && t.focusBack, 'Escape closes the popover and focus returns to the trigger');
  check(/99\.9{4,}\d*\/0\.0{3,}\d/.test(t.kl6), 'the live KL 6.234 card anchor reads a 99.9.../0.0... split: ' + (t.kl6.match(/KL 6\.234 is like[^.]*\./) || [''])[0]);
  check(/99\.5%|one action picked about 99\.5/.test(t.ent), 'the live entropy 0.031 card anchor reads about 99.5% on one action: ' + (t.ent.match(/Entropy [^ ]+ nats is like[^.]*\./) || [])[0]);
  console.log('   popover copy (KL 6.234):', (t.kl6.match(/KL [^.:]+:?[^.]*\./) || [''])[0]);
});

// ---- a real policy-gradient run: autopsy cards, headline, chart titles, replay, grid tables ----
await session(1280, 800, 'desktop-pg', async (page) => {
  await page.getByRole('tab', { name: 'Workbench' }).click();
  await page.selectOption('#wb-world', 'cartpole');
  await page.evaluate(() => { const s = document.querySelector('select'); }); // noop keep
  // pick the policy-gradient family by its name
  await page.evaluate(() => {
    const sel = Array.from(document.querySelectorAll('#mode-pane select, #lab select, select')).find((s) => Array.from(s.options).some((o) => o.textContent.trim() === 'Policy gradient'));
    sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === 'Policy gradient').value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await setWord(page, '#mode-pane', 'epochs', '10 passes');
  await setWord(page, '#mode-pane', 'lr', '0.01');
  if (!await page.locator('#run-extra').evaluate(e => e.open)) await page.locator('#run-extra > summary').click();
  await page.selectOption('#seeds', '1');
  const budget = await pickBudget(page, 40000);
  console.log('   pg cartpole run budget:', budget, 'steps');
  await page.click('#run-btn');
  await runDone(page);
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => {
    const R = window.RLHELP;
    const sym = document.querySelector('#symptoms');
    const triggers = sym.querySelectorAll('.metric-help-btn');
    // the big-steps card itself
    const klCard = Array.from(sym.querySelectorAll('div.sym')).find((d) => /Mean KL between the policy/.test(d.textContent));
    const btn = klCard && klCard.querySelector('.metric-help-btn');
    if (btn) btn.click();
    const pop = document.getElementById('metric-help-popover');
    const anchor = pop && !pop.hidden ? pop.querySelector('.metric-help-anchor').textContent : '';
    const klVal = klCard ? (klCard.textContent.match(/an update: ([\d.-]+)/) || [])[1] : null;
    if (btn) R.closeHelp();
    return { n: triggers.length, hasKl: !!btn, anchor, klVal,
      runResult: document.querySelector('#run-result').textContent,
      runTriggers: document.querySelectorAll('#run-result .metric-help-btn').length };
  });
  check(a.n >= 1, 'the real autopsy prints help triggers (' + a.n + ')');
  check(a.hasKl, 'the real big-steps autopsy card carries a trigger');
  check(a.klVal && new RegExp('like a 50/50 choice becoming').test(a.anchor || '') && (a.anchor || '').indexOf('KL ' + a.klVal) === 0, 'the real KL card (' + a.klVal + ') opens a scale anchor: ' + a.anchor);
  check(a.runTriggers >= 1, 'the run headline carries a trigger: "' + a.runResult.trim().slice(0, 60) + '"');
  await page.screenshot({ path: out + '/desktop-autopsy.png' });

  // chart titles: the KL and entropy charts get the shared trigger
  const c = await page.evaluate(() => {
    const t1 = document.querySelector('#ch-kl').parentNode.querySelector('.chart-title');
    const b1 = t1.querySelector('.metric-help-btn');
    b1.click();
    const pop = document.getElementById('metric-help-popover');
    const txt1 = pop.textContent;
    const close1 = pop.querySelector('.metric-help-close');
    close1.click();
    const t2 = document.querySelector('#ch-ent') && document.querySelector('#ch-ent').parentNode.querySelector('.chart-title');
    const b2 = t2 && t2.querySelector('.metric-help-btn');
    if (b2) { b2.click(); }
    return { kl: !!b1, ent: !!b2, txt1, expandedBack: b1.getAttribute('aria-expanded') };
  });
  check(c.kl, 'the KL chart title has a trigger');
  check(c.ent, 'the entropy chart title has a trigger');
  check(/KL divergence per update/.test(c.txt1), 'the KL chart trigger opens the KL explanation');
  check(c.expandedBack === 'false', 'closing resets aria-expanded on the chart trigger');
  await page.screenshot({ path: out + '/desktop-charts.png' });

  // the replay of one real update: the KL stage and its table headers
  await page.locator('#mode-pane .replay button', { hasText: /Watch one update|Start again/ }).click();
  await page.waitForSelector('#mode-pane .rp-stage', { timeout: 120000 });
  const stageTxt = await page.locator('#mode-pane .rp-stage').innerText();
  console.log('   replay stage 0:', stageTxt.slice(0, 100).replace(/\n/g, ' '));
  await page.evaluate(() => {
    const R = window.RLHELP;
    // walk to the last stage ("How far it moved") through the real Next buttons
    const go = () => {
      const b = Array.from(document.querySelectorAll('#mode-pane .rp-nav + .row button, #mode-pane button')).filter((x) => x.textContent.trim() === 'Next');
      return b.length ? b : null;
    };
    return go();
  });
  const next = page.locator('#mode-pane button', { hasText: /^Next$/ });
  // stage 2 ("The step") carries the ratio table; its headers get the shared triggers
  for (let i = 0; i < 2; i++) {
    await next.click();
    await page.waitForFunction(() => {
      const s = document.querySelector('#mode-pane .rp-stage');
      return s && (s.textContent.includes('Ratio = new / old') || s.textContent.includes('The weight of each action'));
    }, null, { timeout: 60000 });
  }
  await page.waitForFunction(() => {
    const s = document.querySelector('#mode-pane .rp-stage');
    return s && s.textContent.includes('Ratio = new / old') && s.querySelector('th');
  }, null, { timeout: 60000 });
  const r2 = await page.evaluate(() => {
    const stage = document.querySelector('#mode-pane .rp-stage');
    const ths = Array.from(stage.querySelectorAll('th'));
    const ratioBtn = ths.find((th) => th.textContent.trim().indexOf('ratio') === 0 && th.querySelector('.metric-help-btn'));
    const weightBtn = ths.find((th) => th.textContent.trim().indexOf('weight') === 0 && th.querySelector('.metric-help-btn'));
    return { ratioHeader: !!ratioBtn, weightHeader: !!weightBtn, stage2: stage.textContent.slice(0, 60) };
  });
  check(r2.ratioHeader, 'the replay ratio table header carries a trigger');
  check(r2.weightHeader, 'the replay weight table header carries a trigger');
  // stage 3 ("How far it moved") carries the KL line
  await next.click(); await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const stage = document.querySelector('#mode-pane .rp-stage');
    const paras = Array.from(stage.querySelectorAll('p'));
    const klP = paras.find((p) => /an estimate of the KL divergence/.test(p.textContent));
    const btn = klP && klP.querySelector('.metric-help-btn');
    if (btn) btn.click();
    const pop = document.getElementById('metric-help-popover');
    const anchor = pop && !pop.hidden ? pop.querySelector('.metric-help-anchor') : null;
    return { hasKl: !!btn, klLine: klP ? klP.textContent : '', anchor: anchor ? anchor.textContent : null };
  });
  check(r.hasKl, 'the replay KL stage line carries a trigger');
  check(/like a 50\/50 choice becoming|no measured move/.test(r.anchor || ''), 'the replay KL trigger opens a scale anchor: ' + r.anchor);
  console.log('   replay KL line:', r.klLine.slice(0, 110));

  // the grid: run two combinations, then the result tables carry the metric trigger
  await page.evaluate(() => { const d = document.querySelector('#grid-card'); if (d) d.open = true; });
  if (!await page.locator('#run-extra').evaluate(e => e.open)) await page.locator('#run-extra > summary').click();
  await page.selectOption('#seeds', '1');
  await pickBudget(page, 10000);
  await page.locator('#grid-lab .chip.gw').first().click();
  const runGridBtn = page.locator('#grid-lab button', { hasText: /Run all/ });
  await runGridBtn.click();
  await page.waitForFunction(() => /^(Done|Stopped)/.test((document.querySelector('#grid-status') || {}).textContent || ''), null, { timeout: 300000 });
  const g = await page.evaluate(() => {
    const R = window.RLHELP;
    const lab = document.querySelector('#grid-lab');
    const ths = Array.from(lab.querySelectorAll('th'));
    const metricTh = ths.find((th) => th.querySelector('.metric-help-btn'));
    const btn = metricTh && metricTh.querySelector('.metric-help-btn');
    if (btn) btn.click();
    const pop = document.getElementById('metric-help-popover');
    const label = pop && !pop.hidden ? pop.querySelector('.metric-help-title').textContent : '';
    return { header: metricTh ? metricTh.textContent.trim().slice(0, 40) : null, label };
  });
  check(!!g.header, 'the grid result table header carries the metric trigger (' + g.header + ')');
  check(/result metric/i.test(g.label || ''), 'the grid trigger opens the result-metric explanation');
  await page.screenshot({ path: out + '/desktop-grid.png' });
});

// ---- phone: a real campaign run, the autopsy card opens and fits the small screen ----
await session(390, 844, 'phone-campaign', async (page) => {
  await page.evaluate(() => window.bellman.level('slots'));
  check(await page.locator('#mode-pane').innerText().then((text) => /Ten slot machines/.test(text)), 'phone campaign metric flow opens the intended slot-machine lesson');
  await page.locator('.mc .opt').nth(1).click();
  await page.getByText('Run the starting sentence').click();
  await runDone(page);
  await page.waitForTimeout(400);
  await page.locator('#notebook > summary').click();
  await page.locator('#notebook-tab-autopsy').click();
  await page.locator('#symptoms .metric-help-btn').first().click();
  const p = await page.evaluate(() => {
    const sym = document.querySelector('#symptoms');
    const btn = sym.querySelector('.metric-help-btn');
    if (!btn) return { ok: false };
    const pop = document.getElementById('metric-help-popover');
    const r = pop.getBoundingClientRect();
    return { ok: true, text: pop.textContent.slice(0, 90),
      fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 1,
      runResult: document.querySelector('#run-result').textContent.trim() };
  });
  check(p.ok, 'the campaign autopsy card carries a trigger on the phone');
  check(p.fits !== false, 'the open popover fits the 390px viewport');
  console.log('   phone run result:', p.runResult);
  await page.screenshot({ path: out + '/phone-autopsy-help.png' });
});

console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
await browser.close();
if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
console.log('metric-help UI checks passed');
