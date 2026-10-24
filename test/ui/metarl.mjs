// Focused measured replay proof. Also reused by the all-registered-level matrix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function metarlContract(page, out, name, check = (ok, label) => assert.ok(ok, label)) {
  fs.mkdirSync(out, { recursive: true });
  const canvas = page.locator('#metarl-scene');
  const state = () => page.evaluate(() => ({ record: bellman.record(), replay: bellman.replay() }));
  const frame = () => canvas.evaluate(e => e.toDataURL());
  check(await canvas.isVisible(), 'Meta-RL scene visible before prediction');
  check(await page.evaluate(() => !!(document.querySelector('#metarl-scene').compareDocumentPosition(document.querySelector('#metarl-lesson')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'scene precedes prediction in DOM');
  check((await state()).record === null, 'level entry clears the previous record');
  const openAutopsy = async () => {
    if (await page.locator('#custom-notebook').count()) {
      await page.locator('#custom-notebook').evaluate(e => { e.open = true; });
      await page.locator('#custom-notebook-tab-autopsy').click();
    } else await page.locator('#metarl-lab details').evaluate(e => { e.open = true; });
  };
  await openAutopsy();
  check(await page.locator('#metarl-autopsy').isVisible() && (await page.locator('#metarl-autopsy').innerText()) === 'Run the lesson to inspect its autopsy.', 'Autopsy shows guidance before measurement');
  check(await page.locator('#metarl-autopsy').getAttribute('data-run') === '' && (await page.locator('#metarl-result').innerText()) === '', 'pre-run guidance contains no measured identity or results');
  const layout = await page.evaluate(() => {
    const strip = document.querySelector('#campaign-strip'), main = document.querySelector('main.layout');
    return main.firstElementChild === strip && strip.contains(main.querySelector('button, a[href], input, select, summary'));
  });
  check(layout, 'map strip precedes scene and lesson in DOM and keyboard order');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow before prediction');
  await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
  if (await page.locator('#metarl-p').count()) await page.locator('#metarl-p button').nth(1).click();
  await page.locator('#metarl-run').click();
  const first = await state();
  check(first.record?.id && first.record.level === 'metarl' && first.replay.length > 0, 'Run produces the measured Meta-RL record');
  const linked = () => page.evaluate(() => [...document.querySelectorAll('[data-record-surface]')].every(e => e.dataset.run === bellman.record()?.id && e.dataset.stale === String(bellman.replay().stale)));
  check(await linked(), 'scene, reward curve, result and autopsy share the record');
  await openAutopsy();
  const autopsyText = await page.locator('#metarl-autopsy').innerText();
  check(autopsyText.includes('Fitted training counts') && autopsyText.includes('Terminal reasons:') && !autopsyText.includes('Run the lesson'), 'Run replaces Autopsy guidance with measured counts and terminal reasons');
  check(!await page.locator('body').innerText().then(t => t.includes(first.record.id)), 'internal record identity is never visible');
  check(first.record.data.fresh.steps === 22 && first.record.data.prior.steps === 0, 'actual 12 training plus 10 evaluation openings, no prior data');
  const touch = await page.locator('#metarl-lab button, #metarl-lab select, #metarl-lesson button').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  check(touch.every(e => e.w >= 44 && e.h >= 44), 'all lesson and replay controls have 44px targets');
  const exact = JSON.stringify(first.record);
  await page.locator('#metarl-replay').click(); const zero = await frame();
  await page.locator('#metarl-step').click(); const one = await frame();
  check(one !== zero && (await state()).replay.time === 1, 'Step opens the actual first probe after its reset');
  await page.locator('#metarl-step').click();
  check((await page.locator('#metarl-feedback').innerText()).includes('Reward 1'), 'feedback appears only after the open event');
  await page.locator('#metarl-step').click();
  check((await page.locator('#metarl-feedback').innerText()).includes('Reset for episode 2'), 'episode 2 starts with a reset');
  check((await page.locator('#metarl-feedback').innerText()).includes('L:1'), 'first reward survives episode reset');
  await page.locator('#metarl-replay').click(); check(await frame() === zero, 'Replay restores the identical first frame');
  await page.locator('#metarl-step').click(); check(await frame() === one, 'draw is deterministic');
  check(JSON.stringify((await state()).record) === exact, 'drawing leaves the record unchanged');
  await page.locator('#metarl-watch').click();
  await page.waitForFunction(() => bellman.replay().time >= 3);
  await page.locator('#metarl-watch').click();
  const paused = (await state()).replay.time;
  await page.waitForTimeout(550);
  check((await state()).replay.time === paused && !(await state()).replay.watching, 'Pause stops measured playback');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#metarl-watch').click();
  await page.waitForTimeout(550);
  check(!(await state()).replay.watching && (await state()).replay.time === paused, 'reduced motion prevents autoplay');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const method of ['history', 'memoryless', 'deleted']) {
    await page.locator('#metarl-policy').selectOption(method);
    const last = first.record.events[method].length - 1;
    check(await page.evaluate(() => BBMETARL.adapter.length(bellman.record()) === bellman.replay().length), 'adapter length follows selected comparison ' + method);
    await page.evaluate(({ method, last }) => { BBMETARL.adapter.draw(bellman.record(), last); }, { method, last });
    const feedback = await page.locator('#metarl-feedback').innerText();
    check(method === 'deleted' ? feedback.includes('unchosen: unknown') : feedback.includes('Reward'), 'last measured outcome for ' + method);
    const newTaskEvents = first.record.events[method].filter(e => e.phase === 'evaluation');
    check(newTaskEvents[0].kind === 'reset' && newTaskEvents[0].task === 'hold-L', 'new task clears prior task state for ' + method);
    if (method === 'deleted') check(newTaskEvents.filter(e => e.kind === 'open' && e.episode === 2).length === 0, 'deleted counts never invent a second opening');
    await canvas.screenshot({ path: path.join(out, name + '-' + method + '.png') });
  }
  await page.locator('#metarl-policy').selectOption('history');
  // Advance through the actual teaching choices, retaining first-answer ids.
  await page.locator('#metarl-d button').nth(1).click();
  await page.locator('#metarl-contingency').selectOption('left');
  check((await state()).replay.stale && await linked(), 'meaningful reward change marks all previous measurements stale');
  check(await page.locator('#metarl-stale').isVisible() && await page.locator('#metarl-run').isEnabled(), 'stale notice offers Run again');
  await page.screenshot({ path: path.join(out, name + '-stale.png'), fullPage: true });
  await page.locator('#metarl-run').click(); const changed = await state();
  check(changed.record.id !== first.record.id && !changed.replay.stale && await linked(), 'rerun replaces measurements with the changed reward contingency');
  check(changed.record.metrics.history.rows[1].choice.action === null, 'all-left training leaves failed-left new task unsupported');
  await page.locator('#metarl-contingency').selectOption('original');
  await page.locator('#metarl-run').click();
  await page.locator('#metarl-held').selectOption('none');
  await page.locator('#metarl-run').click();
  check((await state()).record.metrics.history.score.successes === 0, 'new task reward setting changes measured outcome');
  await page.locator('#metarl-held').selectOption('balanced');
  await page.locator('#metarl-run').click();
  await page.locator('#metarl-repair').click();
  await page.locator('#metarl-x button').nth(0).click();
  check(await page.locator('#metarl-complete').isDisabled(), 'wrong explanation cannot complete the lesson');
  await page.locator('#metarl-x button').nth(1).click();
  check(await page.locator('#metarl-complete').isEnabled(), 'correct explanation permits completion after original measured run');
  await page.locator('#metarl-complete').click();
  // Close celebration before taking the retained teaching screenshots.
  if (await page.locator('.dc').count()) await page.locator('.dc').click();
  const text = await page.locator('#metarl-lesson').innerText();
  check(!text.includes('—'), 'changed teaching copy has no em dashes');
  const inventory = { name, text, lab: await page.locator('#metarl-lab').innerText(), rules: await page.locator('#metarl-rules').count() ? await page.locator('#metarl-rules').innerText() : null, firstRecord: first.record, changedRecord: changed.record };
  fs.writeFileSync(path.join(out, name + '-proof.json'), JSON.stringify(inventory, null, 2));
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.locator('#metarl-step').click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow in ' + theme);
    await page.screenshot({ path: path.join(out, name + '-' + theme + '.png'), fullPage: true });
  }
  await page.evaluate(() => bellman.level('cliff'));
  check((await state()).record === null && (await state()).replay.world === 'cliff', 'switching away clears Meta-RL record and restores the selected world');
  await page.evaluate(() => bellman.level('metarl'));
  check((await state()).record === null && (await state()).replay.world === 'metarl', 'returning level has its scene and no previous run');
  await page.reload();
  check((await state()).record === null && (await state()).replay.world === 'metarl', 'reload restores stable lesson without inventing a run');
  return inventory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = require(process.env.PW_CORE || 'playwright-core');
  const [out = path.join(os.tmpdir(), 'bb-metarl'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
  const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
  try {
    for (const [width, height] of [[1280, 800], [390, 844]]) for (const save of ['clean', 'newer']) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url);
      await page.evaluate(progress => { if (progress) localStorage.setItem('breaking-bellman-v1', JSON.stringify(progress)); else localStorage.removeItem('breaking-bellman-v1'); }, save === 'newer' ? fixture : null);
      await page.reload();
      if (await page.locator('dialog.intro').count()) await page.locator('dialog.intro button', { hasText: 'Open the campaign map' }).click();
      await page.evaluate(() => bellman.level('metarl'));
      await metarlContract(page, out, width + '-' + save);
      assert.deepEqual(errors, []);
      console.log('ok Meta-RL ' + width + ' ' + save);
      await context.close();
    }
  } finally { await browser.close(); }
}
