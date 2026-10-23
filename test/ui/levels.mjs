// All registered lessons: full shared RunRecord replay contract; custom lessons retain their baseline.
// npm run build && node test/ui/levels.mjs [proof directory] [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const thawContract = require('./thaw-contract.js');
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const [out = path.join(os.tmpdir(), 'bb-levels'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
// Full lesson budgets (especially pick) can exceed four minutes on the MBP.
const runTimeout = Number(process.env.BB_UI_RUN_TIMEOUT_MS) || 3600000;
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
async function replayContract(page, proof, verify) {
  const status = () => page.evaluate(() => {
    const r = bellman.record(), state = bellman.replay();
    const surfaces = [...document.querySelectorAll('#stage, #charts, #charts canvas, #run-result, #symptoms, #expert, #wonder, #run-source')];
    return { id: r?.id, level: r?.level, world: r?.world, source: r?.source, state,
      linked: !!r && surfaces.every(e => e.dataset.run === r.id && e.dataset.stale === String(state.stale)),
      policy: document.querySelector('#scene-policy').textContent, seed: document.querySelector('#scene-seed').selectedOptions[0]?.textContent,
      visibleId: !!r && document.body.innerText.includes(r.id) };
  });
  const frame = () => page.locator('#stage').evaluate(async e => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e.toDataURL()));
    return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
  });
  const first = await status(); proof.run = first;
  verify(first.id && first.level === proof.id && first.linked && !first.state.stale, 'scene, charts, results and evidence share the current internal record');
  verify(!first.visibleId, 'record identity is never learner-visible');
  verify(first.policy.length > 0 && first.seed.length > 0, 'method and replay seed have text labels independent of color');
  const exactBefore = await page.evaluate(() => RLA.exact.stringify(bellman.record()));
  fs.writeFileSync(path.join(out, proof.name + '-run.json.gz'), gzipSync(exactBefore));
  const dimensions = await page.locator('#scene-controls button, #scene-seed, #run-btn, #seeds, #budget, #run-mode, #rule .w').evaluateAll(es => es.map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  verify(dimensions.every(d => d.w >= 44 && d.h >= 44), 'Run, replay and result settings have 44px touch targets');
  await page.locator('#scene-replay').click();
  const zero = await frame();
  await page.locator('#scene-step').click();
  const one = await frame();
  verify((await status()).state.time === 1, 'Step advances one replay frame');
  await page.locator('#scene-watch').click();
  await page.waitForFunction(() => bellman.replay().time >= Math.min(4, bellman.replay().length - 1));
  if ((await status()).state.watching) await page.locator('#scene-watch').click();
  const paused = await status(); const pausedFrame = await frame();
  await page.waitForTimeout(150);
  verify(!(await status()).state.watching && await frame() === pausedFrame, 'Pause keeps the measured scene still');
  await page.locator('#scene-replay').click();
  verify(await frame() === zero, 'Replay returns to exactly the same starting frame');
  await page.locator('#scene-step').click();
  verify(await frame() === one, 'the same record and replay time draw exactly the same frame');
  verify(await page.evaluate(() => RLA.exact.stringify(bellman.record())) === exactBefore, 'drawing never changes the record');
  proof.frames = { zero, one, paused: pausedFrame, time: paused.state.time };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#scene-watch').click();
  const reduced = await frame();
  await page.waitForTimeout(150);
  verify(!(await status()).state.watching && await frame() === reduced, 'reduced motion does not autoplay');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const nextSeeds = await page.locator('#seeds').evaluate(e => [...e.options].find(o => o.value !== e.value).value);
  await page.locator('#seeds').selectOption(nextSeeds);
  const stale = await status();
  verify(stale.id === first.id && stale.state.stale && stale.linked, 'changed settings retain and mark the previous record stale on every surface');
  verify(await page.locator('#run-stale').isVisible() && await page.locator('#run-btn').isEnabled(), 'stale notice explains rerun and Run is enabled');
  proof.staleWording = await page.locator('#run-stale').innerText();
  await page.screenshot({ path: path.join(out, proof.name + '-stale.png'), fullPage: true });
  await page.locator('#run-btn').click();
  await page.waitForFunction(() => bellman.record() && !document.querySelector('#run-btn').disabled, null, { timeout: runTimeout });
  const fresh = await status(); proof.rerun = fresh;
  verify(fresh.id !== first.id && !fresh.state.stale && fresh.linked, 'rerun replaces stale measurements everywhere with the new settings');
  proof.rendered = await page.locator('#lab').innerText();

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
        const record = { name, id, width, height, progress, errors, stage: id === 'thaw' ? 'thaw-replay' : ['vpo', 'supermimic'].includes(id) ? 'custom-baseline' : 'shared-replay', checks: [] };
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
          const custom = ['vpo', 'supermimic', 'thaw'].includes(id);
          const scene = page.locator(id === 'thaw' ? '#thaw-scene' : custom ? '#vpo-lab svg' : '#stage').first();
          verify(await scene.isVisible(), 'baseline scene visible before Run');
          record.before = await scene.evaluate(e => ({ tag: e.tagName, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, label: e.getAttribute('aria-label') }));
          verify(record.before.width > 0 && record.before.height > 0, 'scene has nonzero dimensions');
          verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow before Run');
          await scene.screenshot({ path: path.join(out, name + '-scene-before.png') });
          if (!custom) verify(await page.evaluate(() => bellman.record() === null && document.querySelector('#stage').dataset.world === bellman.state().world), 'fresh level has its actual world and no previous record');
          const button = custom ? `#${id}-run` : '#run-btn';
          await page.locator(button).click();
          if (id === 'vpo') {
            await page.waitForFunction(() => !document.querySelector('#vpo-run').disabled && document.querySelector('#vpo-source').textContent.includes('Live simulation completed'), null, { timeout: runTimeout });
            record.result = await page.locator('#vpo-source').innerText();
            verify(await page.locator('#vpo-lesson table').count() > 0, 'baseline measured results table exists');
          } else if (id === 'thaw') {
            await page.waitForFunction(() => bellman.record()?.level === 'thaw');
            await thawContract(page, record, verify);
          } else if (id === 'supermimic') {
            await page.waitForSelector('#supermimic-gradients', { timeout: runTimeout });
            record.result = await page.locator('#supermimic-gradients').innerText();
            verify(await page.locator('#supermimic-rollout table').count() > 0, 'baseline rollout and gradient tables exist');
          } else {
            await page.waitForFunction(() => !document.querySelector('#run-btn').disabled && document.querySelector('#run-result').textContent.trim().length > 0, null, { timeout: runTimeout });
            record.result = await page.locator('#run-result').innerText();
            record.source = await page.locator('#run-source').innerText();
            verify(await page.locator('#charts canvas').count() > 0, 'record charts appear');
            await replayContract(page, record, verify);
          }
          verify(record.result.length > 0, 'Run produces baseline results');
          verify(await scene.isVisible(), 'baseline scene remains visible after Run');
          verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow after Run');
          await scene.screenshot({ path: path.join(out, name + '-scene-after.png') });
          await page.screenshot({ path: path.join(out, name + '-result.png'), fullPage: true });
          await page.emulateMedia({ colorScheme: 'dark' });
          if (!custom) {
            verify(await page.evaluate(() => document.querySelector('#stage').dataset.run === bellman.record().id), 'theme redraw retains record identity');
            await page.locator('#scene-step').click();
          }
          verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'dark theme has no overflow');
          await scene.screenshot({ path: path.join(out, name + '-scene-dark.png') });
          await page.screenshot({ path: path.join(out, name + '-result-dark.png'), fullPage: true });
          await page.emulateMedia({ colorScheme: 'light' });
          if (progress === 'newer') retained(await stored(page), fixture, ids, id);
          if (id === 'thaw') {
            await page.evaluate(() => bellman.level('cliff'));
            verify(await page.evaluate(() => bellman.record() === null && bellman.state().world === 'cliff'), 'leaving Thaw clears its world and record');
            await page.evaluate(() => bellman.level('thaw'));
            verify(await page.evaluate(() => bellman.record() === null && bellman.replay().time === 0), 'returning to Thaw does not reuse a scored test');
          }
          if (!custom) {
            const sibling = await page.evaluate(id => bellman.levels().find(l => l.id !== id && l.world === bellman.record().world)?.id, id);
            if (sibling) {
              await page.evaluate(id => bellman.level(id), sibling);
              verify(await page.evaluate(() => bellman.record() === null && bellman.replay().time === 0), 'another level in the same world drops the previous record');
            }
            await page.evaluate(() => bellman.level('vpo'));
            verify(await page.evaluate(() => bellman.record() === null && bellman.replay().world === null && !document.querySelector('#stage').dataset.world), 'custom transition drops shared record and world');
            await page.evaluate(id => bellman.level(id), id);
            verify(await page.evaluate(() => bellman.record() === null && bellman.replay().world === bellman.state().world), 'return from custom mounts a fresh world without a record');
          }
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
