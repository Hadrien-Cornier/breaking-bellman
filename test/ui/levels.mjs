// All registered lessons, with slice 4 map precedence: no replay contract until the level's migration slice.
// npm run build && node test/ui/levels.mjs [proof directory] [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const [out = path.join(os.tmpdir(), 'bb-levels'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
// Full lesson budgets (especially pick) can exceed four minutes on the MBP.
const runTimeout = 600000;
// Optional stable case names for resuming failed/unrun cases on an unchanged product build.
const only = process.env.BB_LEVEL_CASES ? new Set(process.env.BB_LEVEL_CASES.split(',')) : null;
const records = [], failures = [];
let checks = 0;
function check(ok, message) { checks++; assert.ok(ok, message); }
async function stored(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1'))); }
function retained(actual, original, ids, selected = original.level) {
  check(actual.level === selected, 'selected stable level id survives');
  for (const [key, value] of Object.entries(original)) {
    if (key === 'recapDismissed' || key === 'future') assert.deepEqual(actual[key], value);
  }
  for (const id of original.done.filter(id => !ids.includes(id))) check(actual.done.includes(id), 'unknown done id ' + id);
  for (const field of ['lstep', 'answers', 'made']) {
    for (const [id, value] of Object.entries(original[field])) {
      // Answers have stable card/question ids, independent of rendered option order.
      if (field === 'answers' || !ids.includes(id)) assert.deepEqual(actual[field][id], value, field + '.' + id);
    }
  }
}
async function seed(page, progress) {
  await page.goto(url);
  await page.evaluate(value => {
    if (value) localStorage.setItem('breaking-bellman-v1', JSON.stringify(value));
    else localStorage.removeItem('breaking-bellman-v1');
  }, progress);
  await page.reload(); // Never install a reload hook that could conceal a broken save.
}
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    // Persistence through actual UI save actions and reload, before any explicit level choice.
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
    const page = await context.newPage();
    const augmented = structuredClone(fixture);
    augmented.made.skew = { parts: { family: 'future' }, recipe: 'future-recipe' };
    augmented.future = { nested: [null, false, 0, { flag: true }] };
    await seed(page, augmented);
    const ids = await page.evaluate(() => bellman.levels().map(l => l.id));
    await page.getByRole('tab', { name: 'Codex', exact: true }).click();
    retained(await stored(page), augmented, ids);
    await page.reload();
    await page.getByRole('tab', { name: 'Campaign', exact: true }).click();
    retained(await stored(page), augmented, ids);
    await page.reload();
    retained(await stored(page), augmented, ids);
    await page.screenshot({ path: path.join(out, `unknown-level-${width}.png`), fullPage: true });
    // Select through the real map button, not a direct state assignment.
    await page.locator('[data-map-level]').first().click();
    await page.locator('[data-open-level]').click();
    retained(await stored(page), augmented, ids, ids[0]);
    await page.reload();
    retained(await stored(page), augmented, ids, ids[0]);
    fs.writeFileSync(path.join(out, `persistence-${width}.json`), JSON.stringify(await stored(page), null, 2));
    console.log(`ok persistence ${width}: unknown selection until explicit map choice; unknown fields and ids after reload`);
    await context.close();

    for (const progress of ['clean', 'newer']) {
      for (const id of ids) {
        const name = `${width}-${progress}-${id}`;
        if (only && !only.has(name)) continue;
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        const record = { name, id, width, height, progress, errors, stage: 'baseline', checks: [] };
        const verify = (ok, text) => { record.checks.push({ text, passed: !!ok }); check(ok, name + ': ' + text); };
        try {
          await seed(page, progress === 'newer' ? fixture : null);
          if (await page.locator('dialog.intro').count()) await page.locator('dialog.intro button', { hasText: 'Start level 1' }).click();
          // Public API selects by stable id; it uses the same save/enter/render path as the map.
          await page.evaluate(id => bellman.level(id), id);
          const precedence = await page.evaluate(() => {
            const strip = document.querySelector('#campaign-strip'), layout = document.querySelector('main.layout');
            const first = layout.querySelector('button, a[href], input, select, summary, [tabindex="0"]');
            return { firstChild: layout.firstElementChild === strip, firstControl: strip.contains(first), count: strip.textContent.includes('All ' + bellman.levels().length + ' levels') };
          });
          verify(precedence.firstChild && precedence.count, 'All N levels strip precedes all lesson content in DOM');
          verify(precedence.firstControl, 'map strip is first in lesson keyboard order');
          await page.locator('#tabs button').last().focus();
          await page.keyboard.press('Tab');
          verify(await page.locator('#campaign-strip button').evaluate(e => e === document.activeElement), 'Tab from header reaches map strip before lesson controls');
          const custom = ['vpo', 'supermimic'].includes(id);
          const scene = page.locator(custom ? '#vpo-lab svg' : '#stage').first();
          verify(await scene.isVisible(), 'baseline scene visible before Run');
          record.before = await scene.evaluate(e => ({ tag: e.tagName, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, label: e.getAttribute('aria-label') }));
          verify(record.before.width > 0 && record.before.height > 0, 'scene has nonzero dimensions');
          verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow before Run');
          await scene.screenshot({ path: path.join(out, name + '-scene-before.png') });
          const button = custom ? `#${id}-run` : '#run-btn';
          await page.locator(button).click();
          if (id === 'vpo') {
            await page.waitForFunction(() => !document.querySelector('#vpo-run').disabled && document.querySelector('#vpo-source').textContent.includes('Live simulation completed'), null, { timeout: runTimeout });
            record.result = await page.locator('#vpo-source').innerText();
            verify(await page.locator('#vpo-lesson table').count() > 0, 'baseline measured results table exists');
          } else if (id === 'supermimic') {
            await page.waitForSelector('#supermimic-gradients', { timeout: runTimeout });
            record.result = await page.locator('#supermimic-gradients').innerText();
            verify(await page.locator('#supermimic-rollout table').count() > 0, 'baseline rollout and gradient tables exist');
          } else {
            await page.waitForFunction(() => !document.querySelector('#run-btn').disabled && document.querySelector('#run-result').textContent.trim().length > 0, null, { timeout: runTimeout });
            record.result = await page.locator('#run-result').innerText();
            record.source = await page.locator('#run-source').innerText();
            verify(await page.locator('#charts canvas').count() > 0, 'baseline charts appear');
          }
          verify(record.result.length > 0, 'Run produces baseline results');
          verify(await scene.isVisible(), 'baseline scene remains visible after Run');
          verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow after Run');
          await scene.screenshot({ path: path.join(out, name + '-scene-after.png') });
          await page.screenshot({ path: path.join(out, name + '-result.png'), fullPage: true });
          if (progress === 'newer') retained(await stored(page), fixture, ids, id);
          await page.reload();
          const after = await stored(page);
          verify(after.level === id, 'chosen stable id persists on reload');
          if (progress === 'newer') retained(after, fixture, ids, id);
          verify(errors.length === 0, 'no console or page errors');
          record.passed = true;
          console.log('ok ' + name);
        } catch (error) {
          record.passed = false; record.failure = error.stack;
          failures.push(name + ': ' + error.message);
          await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true }).catch(() => {});
          console.error('FAIL ' + failures.at(-1));
        } finally {
          records.push(record);
          fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, failures, records }, null, 2));
          await context.close();
        }
      }
    }
  }
} finally { await browser.close(); }
console.log(`${records.filter(r => r.passed).length}/${records.length} level cases passed; ${checks} checks; ${failures.length} failures`);
if (only) assert.deepEqual(new Set(records.map(r => r.name)), only, 'every requested stable case ran');
if (failures.length) process.exitCode = 1;
