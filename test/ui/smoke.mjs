// UI smoke test: phone (375) campaign level 1 end to end, desktop (1280) workbench, replay, compare, review.
// node test/ui/smoke.mjs [screenshot dir]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Playwright: `npm i -D playwright && npx playwright install chromium`, or set PW_CORE to a playwright-core folder
// and PW_CHROMIUM to a Chromium binary.
const load = (m) => { try { return require(m); } catch (e) { return null; } };
const pw = (process.env.PW_CORE && load(process.env.PW_CORE)) || load('playwright') || load('playwright-core');
if (!pw) { console.error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
const browserName = process.env.BB_SMOKE_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const engine = pw[browserName];
const fs = await import('fs');
const os = await import('os');
const zlib = await import('zlib');
// Portable Chromium selection: PW_CHROMIUM wins, then a playwright-installed browser,
// then common system installs (GitHub Actions ubuntu runners ship Google Chrome, macOS ships it in /Applications).
const candidates = [process.env.PW_CHROMIUM];
try { if (browserName === 'chromium' && typeof engine.executablePath === 'function') candidates.push(engine.executablePath()); } catch {}
candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const exe = browserName === 'chromium' ? candidates.filter(Boolean).find((p) => fs.existsSync(p)) : '';
console.log(browserName + ':', browserName === 'webkit' ? 'playwright webkit' : (exe || 'playwright default'));
const out = process.argv[2] || (os.tmpdir() + '/breaking-bellman-shots');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(new URL('../../dist/breaking-bellman.html', import.meta.url), out + '/page.html');
const browser = await engine.launch(browserName === 'chromium' ? { executablePath: exe || undefined } : {});
const errors = [];
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
async function clickReplay(page, pattern) {
  let btn = page.locator('#replay-lab .replay button', { hasText: pattern }).first();
  if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
    const drawer = page.locator('#lesson-drawer');
    if (await drawer.count()) await drawer.evaluate((el) => { el.open = true; });
    const open = page.getByRole('button', { name: 'Watch one update of this sentence', exact: true });
    if (await open.count() && await open.isVisible()) await open.click();
    btn = page.locator('#replay-lab .replay button', { hasText: pattern }).first();
  }
  await btn.click();
}
async function clickCampaignRun(page) {
  await page.locator('[data-campaign-run]').evaluate((button) => button.click());
}
async function ensurePrediction(page) {
  const locked = await page.locator('#run-btn').evaluate((el) => {
    const visible = (node) => {
      for (let n = node; n; n = n.parentElement) {
        if (n.hidden) return false;
        const style = getComputedStyle(n);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return visible(el) && (el.disabled || el.textContent.trim() === 'Predict first');
  }).catch(() => false);
  if (locked) await answerChoice(page, 0);
}
async function clickPredictedRun(page) {
  await ensurePrediction(page);
  await page.click('#run-btn');
}
async function clickRepairRun(page) {
  await ensurePrediction(page);
  await page.getByText('Run this sentence').click();
}
async function closePrediction(page) {
  const pop = page.locator('#prediction-pop');
  if (await pop.count() && await pop.evaluate((el) => el.open).catch(() => false)) {
    await pop.getByRole('button', { name: 'Back to the experiment' }).click();
  }
}
async function dismissDialog(page, id, closeId) {
  const dlg = page.locator(id);
  if (await dlg.count() && await dlg.evaluate((el) => el.open).catch(() => false)) await page.locator(closeId).click();
}
// Run opens the simulation. The lesson continues after that dialog is dismissed.
async function runDone(page) {
  await page.waitForFunction(() => {
    const result = document.querySelector('#run-result');
    const text = result ? result.textContent.trim() : '';
    const prog = document.querySelector('#prog');
    return text.length > 0 && text !== 'New run in progress…' && prog && (prog.style.width === '100%' || prog.style.width === '0%');
  }, null, { timeout: Number(process.env.BB_UI_RUN_TIMEOUT_MS) || 3600000 });
  await dismissDialog(page, '#run-simulation', '#run-simulation-close');
}
const fastRoot = new URL('../../fast/', import.meta.url);
const { exact, hash, source, content } = require('../../scripts/fast-source.js');
const fastVersion = hash(exact.stringify(source().versions));
async function preloadFastRecord(page, key) {
  const file = new URL(fastVersion + '/records/' + key + '.json.gz', fastRoot);
  const encoded = zlib.gunzipSync(fs.readFileSync(file)).toString();
  return page.evaluate(async (text) => {
    const record = RLA.exact.parse(text);
    return RLFAST.createLocal(BB_FAST).save(record.config, record.results);
  }, encoded);
}
const onlySession = process.env.BB_SMOKE_SESSION;
async function session(w, h, name, fn) {
  if (onlySession && onlySession !== name) return;
  const gate = name === 'prediction-gate';
  const page = await browser.newPage(gate
    ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto('file://' + out + '/page.html');
  await page.waitForTimeout(500);
  // a first visit opens the welcome dialog; it must close and leave level 1 ready
  check(await page.locator('dialog.intro').isVisible(), name + ' first visit shows the welcome');
  await page.locator('dialog.intro button', { hasText: 'Open the campaign map' }).click();
  check(!(await page.locator('dialog.intro').count()), name + ' the welcome closes');
  // Existing smoke scenarios exercise the original Slots entry by stable id.
  await page.evaluate(() => bellman.level('slots'));
  await revealLesson(page);
  await fn(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, name + ' no horizontal scroll (scrollWidth ' + sw + ', viewport ' + w + ')');
  await page.close();
}
// tap a word chip in the mode pane, then the option with this label
// A first visit opens the lesson explanation on the next frame. That modal covers the question.
async function dismissLessonHelp(page) {
  const help = page.locator('dialog.lesson-help');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!(await help.count())) return;
  const open = await help.evaluate((el) => el.isConnected && el.open).catch(() => false);
  if (!open) return;
  await help.getByRole('button', { name: 'Back to the experiment' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog.lesson-help[open]'));
}
// Campaign, Workbench, and Saboteur keep the lesson in a closed drawer so the world stays on the first screen.
async function revealLesson(page) {
  await dismissLessonHelp(page);
  const lesson = page.locator('#lesson-drawer');
  if (await lesson.count() && await lesson.isVisible() && !(await lesson.evaluate(el => el.open))) {
    const covered = await page.locator('#prediction-pop[open], dialog.lesson-help[open]').count();
    if (covered) await lesson.evaluate((el) => { el.open = true; });
    else await lesson.locator(':scope > summary').click();
  }
}
// Predict and diagnose open on the scene. Explain stays in the lesson step.
// The explanation is supposed to be open on a first visit. Close it, then answer.
async function answerChoice(page, index) {
  await dismissLessonHelp(page);
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await dismissDialog(page, '#run-simulation', '#run-simulation-close');
  const pop = page.locator('#prediction-pop .opt');
  if (!(await pop.count())) {
    await pop.first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
  }
  if (!(await pop.count())) {
    const show = page.getByRole('button', { name: /Show the prediction|Review the prediction/ });
    if (await show.count()) await show.first().click();
  }
  const choice = page.locator('#prediction-pop .opt');
  if (await choice.count()) {
    await choice.nth(index).click();
    return;
  }
  const active = page.locator('#mode-pane .step.active .mc .opt');
  if (await active.count()) {
    await active.nth(index).click();
    return;
  }
  await page.locator('.predict-live .opt, #mode-pane .mc .opt').nth(index).click();
}
// A campaign reload opens the map. The saved lesson, including its notebook, is behind Play.
async function enterSavedLesson(page) {
  if (!(await page.locator('#campaign-map').count())) return;
  const id = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('breaking-bellman-v1')).level; } catch { return null; }
  });
  if (!id) return;
  await page.locator('[data-map-level="' + id + '"]').click();
  await page.locator('[data-open-level="' + id + '"]').click();
  await revealLesson(page);
}
async function openNotebook(page, section) {
  // One Sources control opens the notebook. The experiment does not show a tab strip.
  await dismissLessonHelp(page);
  await closePrediction(page);
  await dismissDialog(page, '#run-simulation', '#run-simulation-close');
  const dlg = page.locator('#reference-dialog');
  const already = await dlg.count() && await dlg.evaluate((el) => el.open).catch(() => false);
  if (!already) {
    const opener = page.locator('#open-sources');
    if (await opener.count()) await opener.click();
    await dlg.waitFor({ state: 'visible' });
  }
  // The Sources dialog stacks every notebook section. The tab strip is not the way in.
  const panel = page.locator('#notebook-' + section);
  await panel.waitFor({ state: 'visible' });
  await panel.scrollIntoViewIfNeeded();
}
// The sentence stays in the editor. Close the explanation, the notebook, and the simulation before changing a word.
// Closing the simulation does not cancel a run; the word change does.
async function returnToEditor(page) {
  await dismissLessonHelp(page);
  await closePrediction(page);
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await dismissDialog(page, '#run-simulation', '#run-simulation-close');
}
async function setWord(page, scope, key, label) {
  await returnToEditor(page);
  const chip = page.locator(scope + ' .w[data-key="' + key + '"]');
  const target = (await chip.count()) ? chip.first() : page.locator('#rule .w[data-key="' + key + '"]').first();
  await target.click();
  await page.locator('.chooser .choice', { hasText: label }).first().click();
}
// A first visit opens the lesson explanation. The intro text lives in that popup, not in the lesson pane.
async function lessonIntro(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const help = page.locator('dialog.lesson-help');
  const open = await help.count() && await help.evaluate((el) => el.isConnected && el.open).catch(() => false);
  if (!open) {
    const drawer = page.locator('#lesson-drawer');
    if (await drawer.count() && await drawer.isVisible() && !(await drawer.evaluate((el) => el.open))) {
      await drawer.locator(':scope > summary').click();
    }
    const about = page.getByRole('button', { name: 'About this experiment' });
    if (await about.count()) await about.click();
  }
  const shown = page.locator('dialog.lesson-help');
  if (await shown.count() && await shown.evaluate((el) => el.open).catch(() => false)) return shown.innerText();
  return page.locator('#mode-pane').innerText();
}
// Seeds, steps, and run mode stay hidden. Set them without waiting for a visible control.
// The campaign map is the player path. A node opens its briefing, then the level.
async function openCampaignLevel(page, id) {
  await dismissLessonHelp(page);
  await closePrediction(page);
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="' + id + '"]').click();
  const open = page.locator('[data-open-level]');
  if (await open.count()) await open.click();
  await dismissLessonHelp(page);
  await page.waitForTimeout(300);
  const pred = page.locator('#prediction-pop');
  if (await pred.count() && await pred.evaluate((el) => el.open).catch(() => false)) {
    await pred.locator('button.opt').first().click();
  } else if (await page.locator('#run-btn').evaluate((el) => el.textContent === 'Predict first').catch(() => false)) {
    await page.locator('.predict-live .opt').first().click();
  }
}
async function chooseHidden(page, selector, value) {
  const applied = await page.locator(selector).evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, String(value));
  if (applied !== String(value)) throw new Error(selector + ' stayed ' + applied + ' after setting ' + value);
}

await session(375, 812, 'phone', async (page) => {
  await page.screenshot({ path: out + '/phone-start.png' });
  check((await page.locator('#run-btn').textContent()) === 'Predict first', 'level entry locks Run as Predict first');
  check(await page.locator('#run-btn').isDisabled(), 'Run stays disabled until a prediction');
  check(await page.locator('.predict-live .opt').count() >= 2, 'the prediction question is on screen before Run');
  check(await page.evaluate(() => document.querySelector('#stage') && document.querySelector('#stage').dataset.predictFirst === '1'), 'the world caption waits for a prediction');
  const stageBox = await page.locator('#stage').boundingBox();
  const askBox = await page.locator('.predict-live').boundingBox();
  check(!!stageBox && stageBox.height > 80 && !!askBox && askBox.height > 40, 'the question and the world are both on screen');
  const slides = await page.evaluate(() => {
    const curve = document.querySelector('#phone-curve');
    const note = curve && curve.querySelector('.curve-empty');
    const dots = [...document.querySelectorAll('#phone-dots .phone-dot')].filter((b) => !b.hidden).map((b) => b.textContent);
    return { curve: !!(curve && !curve.hidden && note && !note.hidden && note.textContent === 'No pulls yet.'), dots };
  });
  check(slides.curve && slides.dots.join(',') === 'World,Curve,Math', 'world, curve, and math are available before Run');
  const titles = await page.locator('#prediction-pop').evaluate((el) => [...el.querySelectorAll('h3, .predict-title')].filter((node) => getComputedStyle(node).display !== 'none' && node.getClientRects().length).map((node) => node.textContent.trim()));
  check(titles.filter((text) => text === 'Predict before you run').length === 1, 'the prediction heading appears once');
  const chipFit = await page.locator('#rule .w[data-key="optimistic"]').evaluate((chip) => {
    chip.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = chip.getBoundingClientRect();
    const view = document.querySelector('#experiment-view').getBoundingClientRect();
    const workspace = document.querySelector('#algorithm-workspace').getBoundingClientRect();
    const inWorkspace = rect.top >= workspace.top - 1 && rect.bottom <= workspace.bottom + 1 && rect.left >= workspace.left - 1 && rect.right <= workspace.right + 1;
    const inView = rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1 && rect.left >= -1 && rect.right <= window.innerWidth + 1;
    return rect.width >= 20 && rect.height >= 20 && inWorkspace && inView;
  });
  check(chipFit, 'the update rule chip 0 is fully reachable');
  const gap = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const dots = document.querySelector('#phone-dots').getBoundingClientRect();
    return Math.round(dots.top - stage.bottom);
  });
  check(gap >= 0 && gap < 72, 'the world sits just above the World, Curve and Math tabs (' + gap + 'px)');
  const deck = page.locator('#phone-deck');
  await deck.evaluate((el) => { el.scrollTo({ left: el.clientWidth, behavior: 'instant' }); });
  check(await page.waitForFunction(() => document.querySelector('#phone-dots [data-panel="curve"]').getAttribute('aria-selected') === 'true', null, { timeout: 2000 }).then(() => true, () => false), 'the curve slide can be selected before Run');
  await deck.evaluate((el) => { el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' }); });
  check(await page.waitForFunction(() => document.querySelector('#phone-dots [data-panel="math"]').getAttribute('aria-selected') === 'true', null, { timeout: 2000 }).then(() => true, () => false), 'the math slide can be selected before Run');
  await deck.evaluate((el) => { el.scrollTo({ left: 0, behavior: 'instant' }); });
  const landed = await page.waitForFunction(() => {
    const stage = document.querySelector('#stage');
    const run = document.querySelector('#run-btn');
    const card = document.querySelector('#stage-card');
    const world = document.querySelector('#phone-dots [data-panel="world"]');
    if (!stage || !run || !card || !world || world.getAttribute('aria-selected') !== 'true' || run.hidden) return false;
    const s = stage.getBoundingClientRect();
    const r = run.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const overlaps = r.bottom > s.top + 1 && r.top < s.bottom - 1 && r.right > s.left + 1 && r.left < s.right - 1;
    const inCard = r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.left >= c.left - 1 && r.right <= c.right + 1;
    return inCard && !overlaps && r.height >= 40;
  }, null, { timeout: 2000 }).then(() => true, () => false);
  check(landed, 'Run sits on the simulation without covering the world');
  await page.keyboard.press('Escape');
  check(await page.locator('#run-btn').isDisabled() && (await page.locator('#run-btn').textContent()) === 'Predict first', 'dismissing does not unlock Run');
  await page.locator('#level-title').click();
  const helpBox = await page.locator('dialog.lesson-help').boundingBox();
  const vp = page.viewportSize();
  check(!!helpBox && helpBox.width >= vp.width - 8 && helpBox.height >= vp.height - 8, 'the level explanation fills the screen');
  await page.locator('dialog.lesson-help').getByRole('button', { name: 'Back to the experiment' }).click();
  await answerChoice(page, 1);
  check((await page.locator('#run-btn').textContent()) === 'Run' && !(await page.locator('#run-btn').isDisabled()), 'an answer enables Run');
  await clickCampaignRun(page);
  await runDone(page);
  const card = page.locator('#verdict-card');
  check(await card.isVisible() && /You predicted/.test(await card.innerText()) && /Measured/.test(await card.innerText()), 'the run shows a prediction result card');
  check(await card.evaluate((el) => el.classList.contains('right') || el.classList.contains('wrong')), 'the result card says whether the prediction was right');
  check(await page.locator('#run-btn').evaluate((el) => el.hidden), 'Run hides while the measured result shows');
  check(await page.locator('#mode-pane .step', { hasText: 'Diagnose' }).count() === 1, 'a successful campaign run advances to Diagnose');
  console.log('L1 run:', await page.locator('#run-result').innerText());
  await page.locator('#lesson-drawer').evaluate((el) => { el.open = true; });
  await closePrediction(page);
  await page.getByRole('button', { name: 'Watch one update of this sentence', exact: true }).click();
  await clickReplay(page, /Watch one update|Start again/);
  await page.waitForSelector('#replay-lab .rp-stage', { timeout: 60000 });
  for (let i = 0; i < 4; i++) await page.locator('#replay-lab .replay button', { hasText: /^Next$/ }).click();
  console.log('L1 replay, last stage:', (await page.locator('#replay-lab .rp-stage').innerText()).slice(0, 200));
  await answerChoice(page, 1);
  await setWord(page, '#mode-pane', 'eps', 'sometimes at random');
  check(await page.locator('#run-btn').evaluate((el) => !el.hidden && el.disabled && el.textContent === 'Predict first'), 'an edit asks for a new prediction before Run');
  const mjx = await page.locator('#mode-pane .algorithm-math-panel mjx-container').count();
  console.log('MathJax containers in the repair step:', mjx);
  await page.screenshot({ path: out + '/phone-repair.png', fullPage: false });
  await clickRepairRun(page);
  await runDone(page);
  console.log('L1 repair run:', await page.locator('#run-result').innerText());
  check(await page.locator('#verdict-card').isHidden(), 'a repair shows the new measurement without the old prediction card');
  check(/→|Works:/.test(await page.locator('#run-result').innerText()), 'a repair pairs the old measurement with the new one');
  await page.waitForSelector('text=Explain why it works', { timeout: 10000 });
  await page.locator('#mode-pane .mc').last().locator('.opt').nth(0).click();
  await page.waitForSelector('text=Your sentence and the published one');
  const cons = await page.locator('#mode-pane .step').last().innerText();
  check(/ε-greedy/.test(cons), 'level 1 consolidation names ε-greedy');
  await page.screenshot({ path: out + '/phone-l1-done.png', fullPage: true });
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="slots"]').click();
  const briefBox = await page.locator('.map-brief').boundingBox();
  const mapVp = page.viewportSize();
  check(!!briefBox && briefBox.width >= mapVp.width - 8 && briefBox.height >= mapVp.height - 8, 'the map explanation fills the screen');
  await page.locator('.map-brief').getByRole('button', { name: 'Close briefing' }).click();
});

await session(1280, 900, 'desktop', async (page) => {
  await closePrediction(page);
  await dismissLessonHelp(page);
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="slots"]').click();
  const deskBrief = await page.locator('.map-brief').boundingBox();
  const deskVp = page.viewportSize();
  check(!!deskBrief && deskBrief.width >= deskVp.width - 8 && deskBrief.height >= deskVp.height - 8, 'desktop map explanation fills the screen');
  await page.locator('.map-brief').getByRole('button', { name: 'Close briefing' }).click();
  await openCampaignLevel(page, 'explode');
  await setWord(page, '#mode-pane', 'store', 'a network');
  await setWord(page, '#mode-pane', 'data', 'random old moves');
  await setWord(page, '#mode-pane', 'picker', 'a frozen copy');
  await setWord(page, '#mode-pane', 'scorer', 'a frozen copy');
  await page.waitForTimeout(1500);
  console.log('math rows:', await page.locator('#mode-pane .algorithm-math-panel .mrow').count(), 'MathJax containers:', await page.locator('#mode-pane .algorithm-math-panel mjx-container').count());
  // every word combination of every family, on every world: each unique TeX line typesets without a MathJax error
  // (a twin network once wrote Q_A_\theta: "Double subscripts: use braces to clarify")
  await page.waitForFunction(() => window.MathJax && window.MathJax.tex2svg, null, { timeout: 30000 });
  const tex = await page.evaluate(() => {
    const C = window.CONTENT, worlds = Object.keys(C.worldNames), seen = new Set(), bad = [];
    let combos = 0;
    for (const f of Object.keys(C.families)) {
      const keys = C.families[f].keys, opts = keys.map((k) => C.words[k].options.map((o) => o[0])), idx = keys.map(() => 0);
      for (;;) {
        const parts = { family: f }; keys.forEach((k, i) => { parts[k] = opts[i][idx[i]]; }); combos++;
        for (const w of worlds) for (const { tex } of bellman.math(parts, w)) {
          if (seen.has(tex)) continue;
          seen.add(tex);
          const m = MathJax.tex2svg(tex, { display: true }).querySelector('[data-mjx-error]');
          if (m) bad.push(m.getAttribute('data-mjx-error') + ': ' + tex);
        }
        let i = 0; while (i < keys.length && ++idx[i] === opts[i].length) { idx[i] = 0; i++; }
        if (i === keys.length) break;
      }
    }
    return { combos, unique: seen.size, bad };
  });
  check(tex.unique > 100 && !tex.bad.length, 'the TeX of all ' + tex.combos + ' word combinations typesets (' + tex.unique + ' unique lines)' + (tex.bad.length ? ': ' + tex.bad.slice(0, 3).join(' | ') : ''));
  await chooseHidden(page, '#seeds', '1'); await chooseHidden(page, '#budget', '10000');
  const t0 = Date.now();
  await clickPredictedRun(page);
  await runDone(page);
  console.log('DQN 10k 1 seed in', ((Date.now() - t0) / 1000).toFixed(1), 's:', await page.locator('#run-result').innerText());
  // The expert card lives in Autopsy. Opening that dialog is how a player reads it; the run still has to leave the card open.
  await openNotebook(page, 'autopsy');
  const expert = page.locator('#expert-card');
  if (await expert.count() && !(await expert.evaluate((d) => d.open))) await expert.locator('summary').click();
  check(await expert.isVisible() && await expert.evaluate((d) => d.open), 'the expert card opens after the run');
  check(/The frozen copy sets how fast the values can grow/.test(await page.locator('#expert').innerText()), 'the expert explains the frozen copy for DQN');
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  check(await page.locator('#charts button', { hasText: 'Why this gap?' }).count() === 1, 'the value chart has a "Why this gap?" button');
  // "Copy page": the whole page as Markdown, with the numbers behind each chart
  const pmd = await page.evaluate(() => window.bellman.page());
  check(pmd.startsWith('# Breaking Bellman: the campaign page') && pmd.includes('## Lab') && pmd.includes('## Words of the current sentence'), 'the page export has its sections');
  check(pmd.includes('**Chart: Score per test episode**') && pmd.includes('| training steps | seed 1 | mean |') && /\| lowest \| -?[\d.]+/.test(pmd), 'the page export writes each chart as a table of numbers');
  check(pmd.includes('$$\n') && pmd.includes('[a network]') && !/\*\*\*\*|\bnull\b/.test(pmd), 'the page export keeps the TeX, the word chips, and no empty labels or "null"');
  // review cases: a pinned run on another x grid gets its own table; a code fence inside a text box cannot end the export's fence
  const rc = await page.evaluate(() => {
    const xsA = Array.from({ length: 41 }, (_, i) => i * 250), xsB = Array.from({ length: 41 }, (_, i) => i * 500);
    const ch = BB.pageMd.chart({ series: [{ label: 'A (pinned)', xs: xsA, ys: xsA }, { label: 'mean', xs: xsB, ys: xsB }], o: { xmax: 20000, xlabel: 'training steps' } });
    const box = document.createElement('div'), ta = document.createElement('textarea'); ta.value = 'a\n```\nb\n```'; box.append(ta); document.body.append(box);
    const md = BB.pageMd.fromNode(box); box.remove();
    return { tables: (ch.match(/\| training steps \|/g) || []).length, end: /\| 20000 \| 20000 \|/.test(ch), wrong: /\| 1250 \| 1250 \| 1000 \|/.test(ch), fence: md.startsWith('````\n') && md.endsWith('\n````') };
  });
  check(rc.tables === 2 && rc.end && !rc.wrong && rc.fence, 'the export keeps each x grid in its own table and fences code safely ' + JSON.stringify(rc));
  const nulls = await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n = 0; while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') n++; return n; });
  check(nulls === 0, 'no "null" text on the page after a run (found ' + nulls + ')');
  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.click('#copy-page-btn');
  const copied = await page.waitForFunction(() => /as Markdown/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 }).then(() => true, () => false);
  check(copied, 'Copy page copies or downloads the page as Markdown');
  console.log('name box:', (await page.locator('#rule .compound').innerText()).replace(/\n/g, ' | '));
  await clickReplay(page, /Watch one update|Start again/);
  await page.waitForSelector('#replay-lab .rp-stage', { timeout: 60000 });
  await page.locator('#replay-lab .rp-tab').nth(4).click();
  console.log('DQN replay verdict:', await page.locator('#replay-lab .rp-verdict').innerText());
  await page.screenshot({ path: out + '/desktop-wb.png' });
  // Pin lives with the other comparisons in Sources.
  await openNotebook(page, 'curve');
  await page.getByText('Pin this run as A').click();
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await setWord(page, '#mode-pane', 'picker', 'the live estimate');
  await setWord(page, '#mode-pane', 'scorer', 'the live estimate');
  await setWord(page, '#mode-pane', 'data', 'the move just made');
  console.log('compare:', (await page.locator('#compare').innerText()).replace(/\n/g, ' | '));
  await clickPredictedRun(page);
  await runDone(page);
  console.log('naive net run:', await page.locator('#run-result').innerText());
  await clickReplay(page, /Watch one update|Start again/);
  await page.waitForSelector('#replay-lab .rp-stage', { timeout: 60000 });
  await page.locator('#replay-lab .rp-tab').nth(4).click();
  console.log('naive replay verdict:', await page.locator('#replay-lab .rp-verdict').innerText());
  await page.screenshot({ path: out + '/desktop-compare.png' });
  await openCampaignLevel(page, 'mirage');
  await page.waitForTimeout(300);
  // The campaign opens on Q-learning. That run chases the left door, and the wonder card belongs to it.
  // Changing the reward count first removes the surprise, so the card never opens.
  await clickPredictedRun(page);
  await runDone(page);
  console.log('mirage run:', await page.locator('#run-result').innerText());
  await page.screenshot({ path: out + '/desktop-mirage.png' });
  // "Did you notice?" lives in Sources. Open that dialog, then the chart and one of the 3 choices.
  await openNotebook(page, 'curve');
  const wq = page.locator('#wonder');
  check(await wq.isVisible(), 'the wonder card shows after the mirage run');
  await wq.locator('button', { hasText: 'Show me the chart' }).click();
  const choice = wq.locator('button.wopt').first();
  await choice.click();
  const revealed = await wq.locator('text=What your run shows').isVisible();
  const marked = await choice.evaluate((el) => el.classList.contains('right') || el.classList.contains('wrong'));
  check(revealed && marked && /Why:/.test(await wq.innerText()), 'the wonder card reveals the measured evidence after a choice');
  console.log('wonder reveal:', (await wq.innerText()).trim().split('\n').slice(-3).join(' | '));
  const stray = await wq.evaluate((el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n = 0;
    while (w.nextNode()) { const t = w.currentNode.textContent.trim(); if (t === 'null' || t === 'undefined') n++; }
    return n;
  });
  check(stray === 0, 'the wonder card shows no standalone "null" or "undefined" after a choice (found ' + stray + ')');
  await wq.screenshot({ path: out + '/desktop-wonder.png' });
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  // finding 5: on this 2-step world "4 real rewards" is the whole episode, so the guess words are idle
  await setWord(page, '#mode-pane', 'nstep', '4 real rewards');
  const idleAll = await page.evaluate(() => ['agg', 'picker', 'scorer', 'sync'].every((k) => {
    const el = document.querySelector('#rule .w[data-key="' + k + '"]') || document.querySelector('#mode-pane .w[data-key="' + k + '"]');
    return !!el && el.classList.contains('idle') && /no guess/.test(el.getAttribute('title') || '');
  }));
  check(idleAll, 'finding 5: with 4 real rewards the guess words are idle and say there is no guess');
  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.getByRole('tab', { name: 'Review' }).click();
  await page.screenshot({ path: out + '/desktop-review.png' });
  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.screenshot({ path: out + '/desktop-codex.png' });
  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.getByRole('tab', { name: 'Saboteur' }).click();
  await page.screenshot({ path: out + '/desktop-sab.png' });
  // an API key never reaches the page export, even when the player shows it
  await page.click('#settings-btn');
  await page.evaluate(() => { const p = document.querySelector('#ai-provider'); p.value = p.options[1].value; p.dispatchEvent(new Event('change')); const k = document.querySelector('#ai-key'); k.value = 'sk-test-NOT-A-REAL-KEY'; k.type = 'text'; });
  const smd = await page.evaluate(() => window.bellman.page());
  check(smd.includes('## Open dialog') && smd.includes('[hidden text]') && !smd.includes('NOT-A-REAL-KEY'), 'the page export includes the open dialog but never the API key');
  await page.keyboard.press('Escape');
});
// phases 2 to 5: a policy-gradient level end to end, actor-critic runs and replays, the family trees
await session(1280, 900, 'phases', async (page) => {
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('#campaign-logo').click();
  // Every advisory node remains selectable; the save bar and agent hooks are there.
  const registeredLevels = await page.evaluate(() => CONTENT.levels.length);
  check(await page.locator('[data-map-level]').count() === registeredLevels && !(await page.locator('[data-map-level][disabled]').count()), 'all registered levels are open');
  check(await page.locator('#mode-pane .savebar button', { hasText: 'Download save file' }).count() === 1, 'the level map offers a save file');
  const brief = await page.evaluate(() => window.bellman.help());
  check(new RegExp('Level \\d+ of ' + registeredLevels).test(brief) && /bellman\.run\(\)/.test(brief), 'window.bellman gives a brief for an AI helper');
  const wr = await page.evaluate(() => {
    const b = window.bellman, w0 = Object.assign({}, b.words().words);
    const a = b.words({ eps: true }), ae = a.words.eps, ar = a.rejected;
    const t = b.words({ eps: 'false' }).words.eps, bad = b.words({ eps: 'sometimes', nope: 1 }).rejected;
    b.words(w0);
    return { ae, ar: ar || null, t, bad: bad || null };
  });
  check(wr.ae === true && wr.ar === null && wr.t === false && JSON.stringify(wr.bad) === '{"eps":"sometimes","nope":1}', 'bellman.words takes true or "false" and returns bad words as rejected');
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level][aria-label^="Learn the policy itself"]').click();
  await page.locator('[data-open-level]').click();
  await answerChoice(page, 1);
  await clickCampaignRun(page);
  await runDone(page);
  const r1 = await page.locator('#run-result').innerText();
  console.log('credit start run:', r1);
  check(/Not yet:/.test(r1), 'the simplest policy gradient does not reach the goal');
  await page.locator('#lesson-drawer').evaluate((el) => { el.open = true; });
  await closePrediction(page);
  await page.getByRole('button', { name: 'Watch one update of this sentence', exact: true }).click();
  await clickReplay(page, /Watch one update|Start again/);
  await page.waitForSelector('#replay-lab .rp-stage', { timeout: 60000 });
  for (let i = 0; i < 3; i++) await page.locator('#replay-lab .replay button', { hasText: /^Next$/ }).click();
  console.log('pg replay stage:', (await page.locator('#replay-lab .rp-stage').innerText()).slice(0, 160).replace(/\n/g, ' | '));
  await answerChoice(page, 0);
  await setWord(page, '#mode-pane', 'credit', 'only the rewards after it');
  await setWord(page, '#mode-pane', 'scale', 'yes, by the standard deviation');
  await page.waitForSelector('#mode-pane .algorithm-math-panel mjx-container', { timeout: 15000 }).catch(() => {});
  check(await page.locator('#mode-pane .algorithm-math-panel mjx-container').count() > 0, 'policy-gradient sentence renders its math');
  await clickRepairRun(page);
  await runDone(page);
  console.log('credit repair run:', await page.locator('#run-result').innerText());
  await page.waitForSelector('text=Explain why it works', { timeout: 10000 });
  await page.locator('#mode-pane .mc').last().locator('.opt').nth(0).click();
  await page.waitForSelector('text=On a real robot', { timeout: 10000 });
  const cons = await page.locator('#mode-pane .step').last().innerText();
  check(/REINFORCE/.test(cons), 'credit consolidation names REINFORCE');
  await page.screenshot({ path: out + '/phases-credit-done.png', fullPage: true });

  await openCampaignLevel(page, 'continuous');
  await chooseHidden(page, '#seeds', '1'); await chooseHidden(page, '#budget', '6000');
  let t0 = Date.now();
  await clickPredictedRun(page);
  await runDone(page);
  console.log('SAC pendulum 6k 1 seed in', ((Date.now() - t0) / 1000).toFixed(1), 's:', await page.locator('#run-result').innerText());
  check(await page.locator('#charts canvas, #charts svg').count() >= 3, 'actor-critic charts drawn');
  await clickReplay(page, /Watch one update|Start again/);
  await page.waitForSelector('#replay-lab .rp-stage', { timeout: 60000 });
  for (let i = 0; i < 4; i++) await page.locator('#replay-lab .replay button', { hasText: /^Next$/ }).click();
  console.log('ac replay stage:', (await page.locator('#replay-lab .rp-stage').innerText()).slice(0, 160).replace(/\n/g, ' | '));
  await page.screenshot({ path: out + '/phases-sac.png' });

  await openCampaignLevel(page, 'twoways');
  await setWord(page, '#mode-pane', 'source', 'a fixed dataset only');
  await setWord(page, '#mode-pane', 'aim', 'copy the actions in memory');
  await setWord(page, '#mode-pane', 'head', 'noise turned into an action');
  await chooseHidden(page, '#seeds', '1'); await chooseHidden(page, '#budget', '4000');
  t0 = Date.now();
  await clickPredictedRun(page);
  await runDone(page);
  console.log('flow BC fork 4k in', ((Date.now() - t0) / 1000).toFixed(1), 's:', await page.locator('#run-result').innerText());
  console.log('name box:', (await page.locator('#rule .compound').innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: out + '/phases-fork.png' });

  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.getByRole('tab', { name: 'Codex' }).click();
  const trees = await page.locator('#mode-pane .genealogy svg').count();
  check(trees === 5, 'codex shows 5 family trees (got ' + trees + ')');
  await page.screenshot({ path: out + '/phases-codex.png', fullPage: true });
  await page.locator('#more-tools').evaluate(el => { el.open = true; });
  await page.getByRole('tab', { name: 'Saboteur' }).click();
  await page.locator('#mode-pane .mission', { hasText: 'Look more often' }).click();
  await page.waitForTimeout(300);
  check(await page.locator('#k-obstacle').count() === 1, 'fork mission shows the obstacle knob');
  check(/10 commands/.test(await page.locator('#rule').innerText()), 'fork mission starts with 10 commands per decision');
});
await session(1280, 900, 'twoways', async (page) => {
  // phase 5 end to end: the 10-command Gaussian copy fails, the flow copy reaches the goal (level hyper: lr 0.003, batch 128)
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level][aria-label^="Two good ways"]').click();
  await page.locator('[data-open-level]').click();
  await answerChoice(page, 0);
  let t0 = Date.now();
  await clickCampaignRun(page);
  await runDone(page);
  const r1 = await page.locator('#run-result').innerText();
  console.log('twoways start run in', ((Date.now() - t0) / 1000).toFixed(0), 's:', r1);
  check(/Not yet:/.test(r1), 'the 10-command Gaussian copy does not pass');
  await answerChoice(page, 0);
  await setWord(page, '#mode-pane', 'head', 'noise turned into an action');
  t0 = Date.now();
  await clickRepairRun(page);
  await runDone(page);
  console.log('twoways flow run in', ((Date.now() - t0) / 1000).toFixed(0), 's:', await page.locator('#run-result').innerText());
  const ok = await page.waitForSelector('text=Explain why it works', { timeout: 10000 }).then(() => true, () => false);
  check(ok, 'the 10-command flow copy passes the goal');
  await page.screenshot({ path: out + '/twoways-done.png', fullPage: true });
});
await session(375, 812, 'phone-frontier', async (page) => {
  // Slots opens the prediction sheet, and its backdrop covers the header. Close it, then use the map.
  await dismissLessonHelp(page);
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level][aria-label^="Steer a frozen policy"]').click();
  await page.locator('[data-open-level]').click();
  await page.waitForTimeout(500);
  check(/mud/.test(await lessonIntro(page)), 'mud level shows its intro');
  await answerChoice(page, 0);
  await setWord(page, '#rule', 'pick', 'the best of 8 samples, by the critic');
  const requested = await page.evaluate(() => ({ ...bellman.state(), steps: +document.querySelector('#budget').value,
    seeds: Array.from({ length: +document.querySelector('#seeds').value }, (_, i) => 101 * (i + 1)) }));
  const C = content(), lv = C.levels.find(l => l.title === requested.level);
  const best8MemoryKey = hash(exact.stringify(exact.resolve({ world: requested.world, knobs: requested.knobs,
    parts: requested.words, hyper: { ...C.hyperOf(requested.words, requested.world), ...lv.hyper }, steps: requested.steps }, requested.seeds, source().versions, C)));
  check(await preloadFastRecord(page, best8MemoryKey), 'the exact best-of-8 memory result is available to the browser regression');
  await clickPredictedRun(page);
  await runDone(page);
  const storedBest8 = {
    source: await page.locator('#run-source').evaluate((el) => el.textContent),
    result: await page.locator('#run-result').innerText(),
    charts: await page.locator('#charts canvas').count(),
  };
  console.log('best-of-8 memory fixture:', storedBest8);
  const showsHundredPercent = (text) => /100\??%/.test(text);
  check(/Saved in this browser/.test(storedBest8.source) && showsHundredPercent(storedBest8.result) &&
    storedBest8.charts >= 4, 'best-of-8 with the memory action reuses its exact 100% result');
  await setWord(page, '#rule', 'next', "the policy's next action");
  await clickPredictedRun(page);
  await page.waitForFunction(() => /Live simulation: training/.test(document.querySelector('#run-source').textContent));
  const pending = await page.evaluate(() => ({
    result: document.querySelector('#run-result').textContent,
    charts: document.querySelector('#charts').textContent,
    autopsy: document.querySelector('#symptoms').textContent,
    caption: document.querySelector('#stage-caption').textContent,
    chartChildren: document.querySelector('#charts').children.length,
  }));
  check(/New run in progress/.test(pending.result) && /Preparing this run/.test(pending.charts) &&
    /New run in progress/.test(pending.autopsy) && /New run in progress/.test(pending.caption) &&
    pending.chartChildren === 1 && !showsHundredPercent(Object.values(pending).join(' ')),
  'a Fast miss replaces the prior 100% result with an explicit pending state');
  await page.screenshot({ path: out + '/phone-mud-pending.png', fullPage: true });
  await setWord(page, '#rule', 'next', 'the action taken next in memory');
  check(/Settings changed/.test(await page.locator('#run-source').evaluate((el) => el.textContent)), 'changing the running sentence cancels the Live fallback');
  await page.evaluate(() => {
    window.__workerPosts = 0;
    window.Worker = class {
      constructor() { this.timers = []; }
      postMessage() {
        window.__workerPosts++;
        this.timers.push(setTimeout(() => {
          if (this.onerror) this.onerror({ message: 'forced startup failure' });
        }, 4000));
      }
      terminate() { for (const timer of this.timers) clearTimeout(timer); }
    };
  });
  await chooseHidden(page, '#run-mode', 'live');
  const frontierRun = page.locator('[data-campaign-run="pick"]');
  await ensurePrediction(page);
  await frontierRun.evaluate((button) => button.click());
  check(await frontierRun.isDisabled(), 'mud level disables its campaign run button as training starts');
  const frontierText = await frontierRun.evaluate((button) => button.textContent + ' ' + button.parentElement.textContent);
  check(/Running the starting sentence/.test(frontierText) && /Training started/.test(frontierText), 'mud level reports startup beside the initiating button');
  // Fast lookup yields before the workers exist. Count posts only after that first start.
  await page.waitForFunction(() => window.__workerPosts > 0);
  const posts = await page.evaluate(() => window.__workerPosts);
  // The simulation covers the page. Closing it leaves this run in progress.
  // The map logo cancels that run. Re-opening this level is the rebuild that has to keep the running label.
  await dismissDialog(page, '#run-simulation', '#run-simulation-close');
  await closePrediction(page);
  await page.evaluate(() => bellman.level('pick'));
  check(await frontierRun.isDisabled() && /Running the starting sentence/.test(await frontierRun.evaluate((button) => button.textContent)),
    'campaign run feedback survives a mode-panel rebuild');
  await frontierRun.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(50);
  check(await page.evaluate(() => window.__workerPosts) === posts, 'repeated campaign clicks cannot start another run');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-campaign-run="pick"]');
    const status = document.querySelector('[data-campaign-run-status="pick"]');
    return button && !button.disabled && /Run the starting sentence/.test(button.textContent) && /did not finish/.test(status.textContent);
  });
  const labRun = () => page.locator('#run-btn').evaluate((el) => ({
    disabled: el.disabled,
    text: (el.textContent || '').trim(),
  }));
  check(/forced startup failure/.test(await page.locator('#run-source').innerText()), 'a failed startup keeps the worker error');
  check((await labRun()).disabled && (await labRun()).text === 'Predict first', 'a changed sentence after the failed start asks again');
  await answerChoice(page, 0);
  const campaignReady = await frontierRun.evaluate((button) => !button.disabled && /Run the starting sentence/.test(button.textContent));
  check(campaignReady && !(await labRun()).disabled && (await labRun()).text === 'Run',
    'a fresh choice after a failed startup restores both campaign and Lab controls');
  await page.screenshot({ path: out + '/phone-mud.png', fullPage: true });
  await closePrediction(page);
  await dismissLessonHelp(page);
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level][aria-label^="Keep the controller"]').click();
  await page.locator('[data-open-level]').click();
  await page.waitForTimeout(500);
  // The published intro says the arm picks up a heavy part. The older briefing said "kitting".
  check(/heavy part/.test(await lessonIntro(page)), 'residual level shows its intro');
  await answerChoice(page, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/phone-residual.png', fullPage: true });
});
// comment fixes of 15 Oct: the combination table, the episode animation, the discovery map
await session(375, 812, 'comments', async (page) => {
  await openNotebook(page, 'rule');
  await page.locator('#grid-card summary').click();
  check(await page.locator('#grid-lab .chip.gw.on').count() === 4, 'slots: the four bandit words are picked by default');
  await page.locator('#grid-lab button', { hasText: /^Run all 16/ }).click();
  await page.waitForFunction(() => /Done|failed/.test(document.querySelector('#grid-status').textContent), null, { timeout: 120000 });
  check(/Done: 16/.test(await page.locator('#grid-status').innerText()), 'the combination table runs all 16 bandit combinations');
  check(await page.locator('#grid-lab .gcell').count() === 16, 'the matrix has 16 cells');
  check(/depending on the other words/.test(await page.locator('#grid-lab').innerText()), 'the effects list finds an interaction');
  await page.locator('#grid-card').screenshot({ path: out + '/comments-grid.png' });
  await openNotebook(page, 'autopsy');
  const det = page.locator('#notebook details.card-details', { hasText: 'Watch one update' });
  await det.locator('summary').click();
  await det.locator('button', { hasText: /^Watch one update$/ }).click();
  await page.waitForSelector('#replay-lab .rp-canvas', { timeout: 60000 });
  check(/last 12 pulls/.test(await page.locator('#replay-lab .rp-ep').innerText()), 'the replay shows the pulls before the update');
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('breaking-bellman-v1')) || {}; v.found = ['egreedy', 'expsarsa']; v.mode = 'codex'; localStorage.setItem('breaking-bellman-v1', JSON.stringify(v)); });
  await page.reload(); await page.waitForTimeout(500);
  check(/2\/34 methods/.test(await page.locator('#score').innerText()), 'the score counts methods out of 34');
  check(/1 of 9 found, 8 left/.test(await page.locator('.dmap').innerText()), 'the discovery map counts the grid-world methods');
  const mp = page.locator('details.mp');
  check(await mp.count() === 1, 'the Expected Sarsa card has one mirage drawer');
  await mp.locator('summary').click();
  await mp.locator('button', { hasText: 'Play 40 episodes: Q-learning' }).click();
  await page.waitForFunction(() => /episode 8:/.test(document.querySelector('details.mp').innerText), null, { timeout: 20000 });
  check(/Guess for the left door \(the best estimate\)/.test(await mp.innerText()), 'the mirage animation explains the Q-learning guess');
  await mp.locator('button', { hasText: /^Run 300 learners/ }).click();
  await page.waitForFunction(() => /Left door at the worst point/.test(document.querySelector('details.mp').innerText), null, { timeout: 60000 });
  const mt = await mp.innerText();
  console.log('mirage drawer:', (mt.match(/Left door at the worst point[^\n]*/) || [''])[0]);
  const pk = (mt.match(/Q-learning (\d+)%, Expected Sarsa (\d+)%/) || []).slice(1).map(Number);
  check(pk.length === 2 && pk[0] > 50 && pk[1] > 50, 'both learners chase the mirage in the 300-run chart');
  await mp.screenshot({ path: out + '/comments-mirage.png' });
});
await session(375, 812, 'expert', async (page) => {
  await openCampaignLevel(page, 'cliff');
  await setWord(page, '#mode-pane', 'nstep', '1 real reward');
  await setWord(page, '#mode-pane', 'agg', 'the worst next action');
  await chooseHidden(page, '#seeds', '5');
  await clickPredictedRun(page);
  await runDone(page);
  console.log('cliff worst next action:', await page.locator('#run-result').innerText());
  const ex = await page.locator('#expert').innerText();
  console.log('expert first note:', ex.split('\n').slice(0, 2).join(' | '));
  check(/Q predicts less than the policy earns/.test(ex), 'the expert reads a pessimistic value chart');
  check(/Why it fails here/.test(ex) && /Where it works/.test(ex), 'the worst-next-action note says why it fails on the cliff and where it works');
  await openNotebook(page, 'autopsy');
  await page.locator('#expert-card').screenshot({ path: out + '/expert-cliff-min.png' });
});
await session(390, 844, 'pendulum', async (page) => {
  await dismissLessonHelp(page);
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="continuous"]').click();
  await page.locator('[data-open-level]').click();
  await page.evaluate(() => {
    const joint = BB.scenes.joint;
    window.pendulumAngles = []; window.pendulumTaskAngles = [];
    BB.scenes.joint = (ctx, w, h, d) => {
      if (d.trace) window.pendulumTrace = d.trace;
      const scene = joint(ctx, w, h, d);
      // Each draw owns its probe. Mount's untrained task pose is not a measured replay state.
      return { ...scene, frame(ts) {
        const rotate = ctx.rotate;
        ctx.rotate = function (a) {
          const t = this.getTransform();
          if (Math.abs(t.e - w / 2) < 1 && Math.abs(t.f - h * 0.52) < 1) {
            (d.trace ? window.pendulumAngles : window.pendulumTaskAngles).push(a);
          }
          return rotate.call(this, a);
        };
        try { return scene.frame(ts); } finally { ctx.rotate = rotate; }
      } };
    };
  });
  await dismissLessonHelp(page);
  await page.waitForTimeout(400);
  const pred = page.locator('#prediction-pop');
  if (await pred.count() && await pred.evaluate((el) => el.open).catch(() => false)) await pred.locator('button.opt').first().click();
  else if (await page.locator('#run-btn').evaluate((el) => el.textContent === 'Predict first').catch(() => false)) await page.locator('.predict-live .opt').first().click();
  await clickPredictedRun(page);
  await runDone(page);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  await page.locator('#scene-replay').evaluate((el) => el.click());
  await page.locator('#scene-watch').evaluate((el) => el.click());
  await page.waitForTimeout(2200);
  await page.locator('#scene-watch').evaluate((el) => el.click());
  const motion = await page.evaluate(() => ({
    count: pendulumAngles.length,
    span: Math.max(...pendulumAngles) - Math.min(...pendulumAngles),
    mismatch: Math.max(...pendulumAngles.map((a) => Math.min(...pendulumTrace.map((t) => Math.abs(a - t.s[0]))))),
    first: pendulumTrace[0].s[0],
    taskCount: pendulumTaskAngles.length,
    taskMismatch: Math.max(...pendulumTaskAngles.map(a => Math.abs(a - Math.PI))),
    watching: bellman.replay().watching,
  }));
  console.log('pendulum measured motion:', JSON.stringify(motion));
  check(motion.taskCount > 0 && motion.taskMismatch < 1e-9, 'pendulum task pose is hanging still before the measured replay');
  check(motion.count > 10 && motion.span > 1, 'pendulum swings visibly in the phone canvas over time');
  check(motion.first > 3 && motion.mismatch < 1e-9, 'the rendered rod follows the hanging-start physics trace');
  check(!motion.watching, 'pendulum Pause stops the recorded replay');
  check(/replay from hanging still/.test(await page.locator('#stage-caption').evaluate((el) => el.textContent)), 'caption identifies the separate replay');
  await page.locator('#stage').screenshot({ path: out + '/phone-pendulum.png' });
});
// Rules remain available before the first move through Notebook Rule in the campaign.
await session(390, 844, 'rules', async (page) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const missing = await page.evaluate(() => {
      const failures = [];
      const inspect = (name, objective) => {
        const panel = document.querySelector('#game-rules');
        const inNotebook = !!panel.closest('#notebook');
        if (inNotebook) { document.querySelector('#notebook').open = true; document.querySelector('#notebook-tab-rule').click(); }
        const text = panel.innerText;
        for (const label of ['Goal', 'Reward each step', 'Equation', 'Episode ends', 'Score', 'Pass this challenge']) {
          if (!text.includes(label)) failures.push(name + ': missing ' + label);
        }
        if (objective && !text.includes(objective)) failures.push(name + ': wrong challenge');
        if (!inNotebook && !(panel.compareDocumentPosition(document.querySelector('#stage')) & Node.DOCUMENT_POSITION_FOLLOWING)) failures.push(name + ': rules follow manual play');
        if (!inNotebook && !(panel.compareDocumentPosition(document.querySelector('#run-btn')) & Node.DOCUMENT_POSITION_FOLLOWING)) failures.push(name + ': rules follow Run');
        if (inNotebook && (!panel.closest('#notebook-rule') || document.querySelector('#notebook-rule').hidden)) failures.push(name + ': Rule tab does not expose rules');
        if (document.documentElement.scrollWidth > innerWidth) failures.push(name + ': overflow');
      };
      for (const l of CONTENT.levels) {
        bellman.level(l.id);
        if (l.custom) {
          document.querySelector('#custom-notebook').open = true; document.querySelector('#custom-notebook-tab-rule').click();
          const rules = document.querySelector('#custom-notebook-rule');
          if (!rules || rules.hidden || !rules.innerText.includes(l.goal.text)) failures.push(l.id + ': missing custom objective');
          if (!document.querySelector('#lab').hidden || document.querySelector('#vpo-lab').hidden) failures.push(l.id + ': wrong lab');
          if (document.documentElement.scrollWidth > innerWidth) failures.push(l.id + ': overflow');
        } else inspect('level ' + l.id, l.goal.text);
      }
      document.querySelector('[data-mode="saboteur"]').click();
      for (let i = 0; i < CONTENT.missions.length; i++) {
        document.querySelectorAll('.mission')[i].click();
        inspect('mission ' + CONTENT.missions[i].id, CONTENT.missions[i].goalText);
        for (const input of document.querySelectorAll('.knobs input')) {
          input.value = input.max; input.dispatchEvent(new Event('input'));
          inspect('mission knob ' + input.id, CONTENT.missions[i].goalText);
        }
      }
      bellman.mode('workbench');
      for (const [family, f] of Object.entries(CONTENT.families)) for (const world of f.worlds) {
        bellman.words({ family }); bellman.world(world);
        inspect('workbench ' + family + ':' + world);
      }
      return failures;
    });
    check(!missing.length, 'all registered levels, 11 missions, knob updates and family/world selections have pre-play rules at ' + width + 'px: ' + missing.join('; '));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => bellman.level('continuous'));
  await openNotebook(page, 'rule');
  await page.locator('#game-rules').screenshot({ path: out + '/rules-pendulum-phone-dark.png' });
  // Enter Fetch's reward-repair step to exercise its live controls without an expensive training run.
  await page.evaluate(() => {
    const key = 'breaking-bellman-v1', saved = JSON.parse(localStorage.getItem(key));
    saved.mode = 'campaign'; saved.level = 'fetch'; saved.lstep = { fetch: 3 };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await enterSavedLesson(page);
  await page.selectOption('#rk-shaping', '2');
  await openNotebook(page, 'rule');
  check(/0.97 × dAfterNonterminal/.test(await page.locator('#game-rules').innerText()), 'Fetch repair updates potential shaping equation before Run');
  await openNotebook(page, 'rule');
  check(await page.locator('#game-rules').isVisible() && /0.97 × dAfterNonterminal/.test(await page.locator('#game-rules').innerText()), 'Notebook exposes Fetch live reward rules after editing');
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await dismissLessonHelp(page);
  await page.locator('#mode-pane button', { hasText: 'Back to the starting reward' }).click();
  await openNotebook(page, 'rule');
  check(/0.05 × cos/.test(await page.locator('#game-rules').innerText()), 'Fetch reward reset restores facing bonus in rules');
  await dismissDialog(page, '#reference-dialog', '#reference-close');
  await page.evaluate(() => {
    bellman.mode('workbench'); bellman.words({ family: 'ac' });
    bellman.world('pendulum', { maxSteps: 100, maxTorque: 0.5 });
  });
  await openNotebook(page, 'rule');
  const shortRule = await page.locator('#game-rules').innerText();
  check(/Tests can run 200 steps; only the first 100/.test(shortRule) && /±0.5/.test(shortRule), 'short horizon and weaker motor appear accurately');
  await page.locator('#game-rules').screenshot({ path: out + '/rules-short-pendulum-phone-dark.png' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#game-rules').screenshot({ path: out + '/rules-pendulum-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
});
// Cliff lesson picture: snapshot rounds, keyboard, both viewports, and an old save left intact.
async function backupPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push('backup pageerror: ' + e.message));
  const save = {
    intro: 1, mode: 'campaign', level: 'cliff', lstep: { slots: 5, cliff: 0 },
    done: ['slots'], answers: { 'cliff-p': { choice: 1, correct: true, ts: '2026-01-01T00:00:00.000Z' } },
    found: ['egreedy'], given: ['mc'], seen: [], missions: [], saved: [], made: {},
    reviews: {}, unlockAll: false, discoveries: {}, wondered: {},
  };
  await page.addInitScript((st) => {
    if (sessionStorage.getItem('bb-backup-hold')) return;
    localStorage.setItem('breaking-bellman-v1', JSON.stringify(st));
  }, save);
  await page.goto('file://' + out + '/page.html');
  await page.waitForTimeout(400);
  await revealLesson(page);
  return page;
}
const backupPage1280 = await backupPage(1280, 900);
check(await backupPage1280.locator('dialog.intro').count() === 0, 'backup: a saved intro does not open the welcome');
check(await backupPage1280.locator('#reward-backup').count() === 0, 'backup: round picture stays hidden before the diagnose step');
const hiddenSave = await backupPage1280.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
check(hiddenSave.done.join() === 'slots' && hiddenSave.lstep.cliff === 0 && hiddenSave.answers['cliff-p'].choice === 1, 'backup: early cliff visit keeps the saved progress');
await backupPage1280.evaluate(() => {
  sessionStorage.setItem('bb-backup-hold', '1');
  const key = 'breaking-bellman-v1';
  const saved = JSON.parse(localStorage.getItem(key));
  saved.lstep.cliff = 2;
  localStorage.setItem(key, JSON.stringify(saved));
});
await backupPage1280.reload();
await enterSavedLesson(backupPage1280);
await openNotebook(backupPage1280, 'notes');
await backupPage1280.waitForSelector('#reward-backup');
const readBackup = () => backupPage1280.evaluate(() => {
  const text = (id) => document.getElementById(id).innerText;
  const vals = (id) => Array.from(document.querySelectorAll('#' + id + ' .val')).map((n) => n.textContent);
  return {
    round: document.getElementById('rb-round-value').textContent,
    one: vals('rb-one'), eight: vals('rb-eight'),
    assumptions: text('rb-assumptions'), milestones: text('rb-milestones'),
    formula: text('rb-formula'), body: document.getElementById('reward-backup').innerText,
    scroll: document.documentElement.scrollWidth, width: window.innerWidth,
    lanes: getComputedStyle(document.querySelector('#reward-backup .lanes')).gridTemplateColumns,
  };
});
let snap = await readBackup();
check(snap.round === '0' && snap.one.every((v) => v === '0') && snap.eight.every((v) => v === '0'), 'backup: round 0 shows zeros');
check(/previous round/.test(snap.assumptions) && /Step size 1/.test(snap.body) && /replay/.test(snap.assumptions), 'backup: assumptions are on the picture');
check(/not a variance measured/.test(snap.body) && /bad action erasing/.test(snap.body) && !snap.body.includes('\u2014'), 'backup: tradeoff copy is on the picture');
check(snap.lanes.split(' ').length === 2, 'backup: 1280 lays the two tables side by side (' + snap.lanes + ')');
await backupPage1280.locator('#rb-round').focus();
await backupPage1280.keyboard.press('ArrowRight');
snap = await readBackup();
check(snap.round === '1' && snap.one.filter((v) => v !== '0').length === 1 && snap.one[15] === '1.00' && snap.eight.filter((v) => v !== '0').length === 8, 'backup: keyboard round 1 lights 1 and 8 entries');
await backupPage1280.keyboard.press('ArrowRight');
snap = await readBackup();
check(snap.round === '2' && snap.eight[0] !== '0' && snap.one[0] === '0', 'backup: keyboard round 2 lights S0 for eight steps only');
await backupPage1280.locator('#rb-jump-16').focus();
await backupPage1280.keyboard.press('Enter');
snap = await readBackup();
check(snap.round === '16' && snap.one[0] !== '0' && snap.eight[0] !== '0', 'backup: round 16 lights S0 for one step');
await backupPage1280.locator('#rb-bias').focus();
await backupPage1280.keyboard.press('Space');
await backupPage1280.locator('#rb-shock').focus();
await backupPage1280.keyboard.press('Space');
const targets = await backupPage1280.evaluate(() => document.getElementById('rb-detail').textContent);
check(/0\.95\^1/.test(targets) && /0\.95\^8/.test(targets) && /0\.95\^3/.test(targets) && /−2/.test(targets), 'backup: both switches keep the discount powers (' + targets + ')');
const progress = await backupPage1280.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
check(progress.done.join() === 'slots' && progress.lstep.cliff === 2 && progress.lstep.slots === 5 && progress.answers['cliff-p'].choice === 1 && progress.found.join() === 'egreedy', 'backup: using the picture does not rewrite the save');
await backupPage1280.reload();
await enterSavedLesson(backupPage1280);
await openNotebook(backupPage1280, 'notes');
await backupPage1280.waitForSelector('#rb-round-value');
check(await backupPage1280.locator('#rb-round-value').innerText() === '0', 'backup: a reload returns the picture to round 0 and leaves progress');
check((await backupPage1280.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')).lstep.cliff)) === 2, 'backup: reload keeps cliff at the diagnose step');
check(snap.scroll <= 1280, 'backup: 1280 has no horizontal page scroll (' + snap.scroll + ')');
await backupPage1280.screenshot({ path: out + '/reward-backup-1280.png' });
await backupPage1280.setViewportSize({ width: 390, height: 844 });
await backupPage1280.waitForTimeout(200);
const phone = await readBackup();
check(phone.lanes.split(' ').length === 1, 'backup: 390 stacks the two tables (' + phone.lanes + ')');
check(phone.scroll <= 390, 'backup: 390 has no horizontal page scroll (' + phone.scroll + ')');
await backupPage1280.locator('#rb-next').focus();
await backupPage1280.keyboard.press('Enter');
check(await backupPage1280.locator('#rb-round-value').innerText() === '1', 'backup: 390 Next round responds to Enter');
await backupPage1280.screenshot({ path: out + '/reward-backup-390.png' });
await backupPage1280.close();

await session(430, 739, 'prediction-gate', async (page) => {
  const runState = () => page.locator('#run-btn').evaluate((el) => ({
    text: (el.textContent || '').trim(),
    disabled: el.disabled,
    hidden: el.hidden,
  }));
  const resultText = () => page.locator('#run-result').evaluate((el) => (el.textContent || '').trim());
  check((await runState()).text === 'Predict first' && (await runState()).disabled, 'gate: level 1 starts as Predict first');
  const playbackHidden = await page.locator('#scene-watch, #scene-step, #scene-replay').evaluateAll((els) => els.every((el) => {
    for (let node = el; node; node = node.parentElement) {
      if (node.hidden) return true;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    const box = el.getBoundingClientRect();
    return box.width === 0 || box.height === 0;
  }));
  check(playbackHidden && (await resultText()) === '', 'gate: Watch, Step, and Replay are not a fresh run');
  await page.locator('#prediction-pop').getByRole('button', { name: 'Back to the experiment' }).click();
  check((await runState()).disabled && (await runState()).text === 'Predict first', 'gate: Back to the experiment does not authorize a run');
  await page.locator('#prediction-reopen').click();
  check(await page.locator('#prediction-pop').evaluate((el) => el.open) && (await runState()).disabled, 'gate: Show the prediction does not authorize a run');
  await page.locator('#prediction-pop').getByRole('button', { name: 'Back to the experiment' }).click();
  await answerChoice(page, 0);
  check((await runState()).text === 'Run' && !(await runState()).disabled, 'gate: a choice enables the predicted experiment');
  await dismissLessonHelp(page);
  const before = (await page.locator('#rule .w[data-key="ucb"]').innerText()).trim();
  await page.locator('#rule .w[data-key="ucb"]').click();
  const alternate = (await page.locator('.chooser .choice[aria-pressed="false"]').first().innerText()).trim();
  await page.locator('.chooser .choice[aria-pressed="false"]').first().click();
  const changed = (await page.locator('#rule .w[data-key="ucb"]').innerText()).trim();
  check(changed !== before && alternate.length > 0, 'gate: the method word changed (' + before + ' → ' + changed + ')');
  check((await runState()).disabled && (await runState()).text === 'Predict first', 'gate: a method change asks again');
  await page.screenshot({ path: out + '/gate-method-locked.png' });
  if ((await runState()).disabled) {
    await page.locator('#run-btn').click({ force: true });
    await page.waitForTimeout(300);
    check(!/Live simulation|Measured|late pulls/.test(await resultText()), 'gate: the locked method change does not start training');
    await closePrediction(page);
  }
  await page.locator('#rule .w[data-key="ucb"]').click();
  await page.locator('.chooser .choice', { hasText: before }).first().click();
  check((await page.locator('#rule .w[data-key="ucb"]').innerText()).trim() === before, 'gate: the original method word is restored');
  check((await runState()).text === 'Run' && !(await runState()).disabled, 'gate: the predicted experiment stays authorized');
  await clickPredictedRun(page);
  await runDone(page);
  check(/You predicted|Measured|late pulls/.test(await page.locator('#verdict-card').innerText() + '\n' + await page.locator('#run-result').innerText()), 'gate: the authorized run finishes');
  check(await page.locator('#run-btn').evaluate((el) => el.hidden), 'gate: Run hides when that result is showing');
  await dismissLessonHelp(page);
  await setWord(page, '#mode-pane', 'eps', 'sometimes at random');
  check((await runState()).disabled && (await runState()).text === 'Predict first' && (await resultText()).length > 0, 'gate: a second run after completion asks again');
  await page.reload();
  await enterSavedLesson(page);
  await page.waitForTimeout(400);
  check((await runState()).disabled && (await runState()).text === 'Predict first', 'gate: a reload asks again');
  await page.screenshot({ path: out + '/gate-reload-locked.png' });
  if ((await runState()).disabled) {
    await page.locator('#run-btn').click({ force: true });
    await page.waitForTimeout(400);
    check(!/Live simulation/.test(await page.locator('#run-source').innerText()), 'gate: a reload does not start training');
  }
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="cliff"]').click();
  if (await page.locator('[data-open-level="cliff"]').count()) await page.locator('[data-open-level="cliff"]').click();
  await dismissLessonHelp(page);
  check((await runState()).disabled && (await runState()).text === 'Predict first', 'gate: a later level asks before its first run');
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
  await page.locator('[data-map-level="thaw"]').click();
  if (await page.locator('[data-open-level="thaw"]').count()) await page.locator('[data-open-level="thaw"]').click();
  await dismissLessonHelp(page);
  const thawRun = page.locator('#thaw-run');
  check(await thawRun.isDisabled(), 'gate: thaw stays locked before a choice');
  check(await page.locator('#thaw-watch').isDisabled(), 'gate: thaw playback waits for a recorded run');
  await page.locator('#mode-pane button.opt').first().click();
  check(!(await thawRun.isDisabled()), 'gate: a thaw choice enables its run');
  const nextInertia = await page.locator('#thaw-inertia').evaluate((el) => [...el.options].map((option) => option.value).find((value) => value !== el.value));
  check(!!nextInertia, 'gate: thaw has another inertia setting');
  await page.locator('#thaw-inertia').selectOption(nextInertia);
  check(await thawRun.isDisabled(), 'gate: a thaw setting change asks again');
  await page.screenshot({ path: out + '/gate-thaw-locked.png' });
  if (await thawRun.isDisabled()) {
    const reopen = page.locator('#prediction-reopen');
    if (await reopen.count() && await reopen.isVisible()) await reopen.click();
    const opt = page.locator('#prediction-pop[open] button.opt').first();
    const found = await opt.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    if (found) await opt.click();
    check(found && !(await thawRun.isDisabled()), 'gate: a new thaw choice enables the changed experiment');
  }
  await closePrediction(page);
  await page.locator('#campaign-logo').click();
});

console.log('errors:', errors.length ? errors.join('\n') : 'none');
if (errors.length) fails.push('page errors');
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'ALL CHECKS PASSED');
await browser.close();
process.exit(fails.length ? 1 : 0);
