// Focused Skew replay/teaching proof; full shell ordering is covered by levels.mjs after ordered integration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { skewReplay } from './helpers/skew.mjs';
const [out = path.join(os.tmpdir(), 'bb-skew'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const proofs = []; let checks = 0;
try {
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) for (const progress of ['clean', 'newer']) {
    const name = `${width}-${colorScheme}-${progress}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, colorScheme });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const verify = (ok, message) => { checks++; assert.ok(ok, name + ': ' + message); };
    const capture = async step => {
      fs.writeFileSync(path.join(out, name + '-' + step + '.txt'), await page.locator('main').innerText());
      await page.screenshot({ path: path.join(out, name + '-' + step + '.png'), fullPage: true });
    };
    try {
      await page.goto(url);
      const input = progress === 'newer' ? structuredClone(fixture) : { intro: 1, level: 'skew', mode: 'campaign' };
      input.future = { nested: ['keep', false, null] }; input.answers = { ...input.answers, 'future-q': { choice: 2 } };
      await page.evaluate(value => localStorage.setItem('breaking-bellman-v1', JSON.stringify(value)), input); await page.reload();
      verify(await page.locator('#skew-stage').isVisible() && await page.evaluate(() => !bellman.record()), 'real task scene mounted before prediction or restored progress');
      verify(await page.evaluate(() => CONTENT.graph.parents('skew').length === 0 && CONTENT.graph.edges.length === 30 && CONTENT.graph.status('skew', []) === 'open'), 'Skew is an open root without extra graph links');
      await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
      fs.writeFileSync(path.join(out, name + '-before.txt'), await page.locator('main').innerText());
      if (progress === 'clean') {
        await page.locator('#skew-p .opt').nth(1).click();
        await capture('step2');
        await page.locator('#skew-fit').click(); await page.waitForFunction(() => bellman.record()?.settings.smoothing === 0);
        verify(await page.locator('#skew-watch').isDisabled(), 'first unsmoothed inverse refuses to sample');
        await page.locator('#skew-sample').click();
      } else await page.locator('#skew-run').click();
      await page.waitForFunction(() => bellman.record()?.settings.smoothing === 1);
      if (progress === 'clean') {
        await capture('step3');
        await page.locator('#skew-d .opt').nth(2).click();
        await capture('step4');
        await page.locator('#skew-swap').click();
        await page.waitForFunction(() => bellman.record()?.settings.sealed === 'B');
        verify(await page.evaluate(() => bellman.record().metrics.inverse.achieved.B === 0 && bellman.record().metrics.inverse.achieved.C > 0), 'teaching door swap changes measured outcomes');
        await capture('step4-swapped');
        await page.locator('#skew-repair-honest').click();
        await page.locator('#skew-x').waitFor();
        await capture('step5');
        verify(await page.locator('#skew-complete').isDisabled(), 'measurement explanation is required before completion');
        await page.locator('#skew-x .opt').nth(1).click();
        await page.locator('#skew-complete').click();
        verify(await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes('skew')), 'lesson completion saves the stable Skew id');
        await capture('complete');
      }
      const proof = await skewReplay(page, out, name, verify);
      verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
      await page.evaluate(() => bellman.level('slots'));
      verify(await page.evaluate(() => bellman.record() === null && BBSKEW.record() === null), 'level switch clears Skew record');
      await page.evaluate(() => bellman.level('skew'));
      verify(await page.evaluate(() => bellman.record() === null), 'returning does not silently fabricate a saved run');
      await page.reload();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
      assert.deepEqual(saved.future, input.future); assert.deepEqual(saved.answers['future-q'], input.answers['future-q']);
      if (progress === 'newer') { assert.deepEqual(saved.answers['skew-p'], input.answers['skew-p']); assert.deepEqual(saved.recapDismissed, input.recapDismissed); }
      verify(errors.length === 0, 'no application console errors: ' + errors.join('; '));
      proofs.push({ name, ...proof, errors }); console.log('ok ' + name);
    } catch (error) {
      await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, proofs }, null, 2)); }
console.log(`${proofs.length} cases, ${checks} checks passed`);
