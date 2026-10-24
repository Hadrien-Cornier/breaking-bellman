// Bounded renderer regression. Accept an integrated build URL as the second argument.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { inferencePanels } from './inference-ui.mjs';

const [out = path.join(os.tmpdir(), 'bb-inference-panels'), url = new URL('../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const results = [];
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const colorScheme of ['light', 'dark']) for (const id of ['elbo', 'messages']) {
    const name = `${id}-${width}-${colorScheme}`, proof = { name, checks: [] }, errors = [];
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390, colorScheme });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    const verify = (value, text) => { proof.checks.push({ text, passed: !!value }); assert.ok(value, name + ': ' + text); };
    try {
      await page.goto(url);
      if (await page.locator('dialog.intro button').count()) await page.locator('dialog.intro button').first().click();
      await page.evaluate(id => bellman.level(id), id);
      verify(await page.evaluate(() => bellman.record() === null), 'no record before Run');
      proof.before = await inferencePanels(page, id, false, verify);
      await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
      await page.locator('#' + id + '-run').click();
      await page.waitForFunction(() => bellman.record() !== null);
      proof.after = await inferencePanels(page, id, true, verify);
      const record = await page.evaluate(() => bellman.record());
      verify(record.level === id, 'Run creates the correct measured record');
      verify(await page.locator('#' + id + '-chart').getAttribute('data-run') === record.id && await page.locator('#' + id + '-evidence').getAttribute('data-run') === record.id, 'both panels link the same measured record');
      await page.screenshot({ path: path.join(out, name + '-after.png'), fullPage: true });
      verify(errors.length === 0, 'no console or application errors: ' + errors.join('; '));
      proof.passed = true;
      console.log('ok ' + name);
    } catch (error) {
      proof.passed = false; proof.failure = error.stack; console.error(error.stack);
    } finally {
      results.push(proof); await context.close();
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    }
  }
} finally { await browser.close(); }
assert.ok(results.every(r => r.passed), 'all inference panel cases pass');
console.log(results.length + ' inference panel cases passed');
