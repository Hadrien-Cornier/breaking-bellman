// Focused full replay matrix for the two returning goal-execution lessons.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { goalExecutionContract, goalExecutionLessonFlow } from './lib/goal-execution.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright-core');
const [out = path.join(os.tmpdir(), 'bb-goal-execution'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
const results = [];
try {
  for (const id of ['hindsight', 'hierarchy']) for (const width of [1280, 390]) for (const progress of ['clean', 'newer']) {
    const name = id + '-' + width + '-' + progress;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, colorScheme: 'light' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(url);
      await page.evaluate(value => localStorage.setItem('breaking-bellman-v1', JSON.stringify(value)), progress === 'newer' ? fixture : { intro: 1, level: 'cliff' });
      await page.reload();
      if (await page.locator('dialog.intro').count()) await page.getByRole('button', { name: 'Open the campaign map', exact: true }).click();
      const proof = await goalExecutionContract(page, id, out, name);
      if (progress === 'newer') {
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
        for (const key of ['recapDismissed', 'future']) if (key in fixture) assert.deepEqual(saved[key], fixture[key]);
        assert.deepEqual(saved.answers, fixture.answers);
        for (const unknown of fixture.done.filter(id => !['hindsight', 'hierarchy'].includes(id))) assert.ok(saved.done.includes(unknown));
      }
      await goalExecutionLessonFlow(page, id, out, name);
      assert.deepEqual(errors, []);
      results.push({ name, passed: true, proof }); console.log('ok ' + name);
    } catch (error) {
      results.push({ name, passed: false, error: error.stack, errors });
      await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true });
      throw error;
    } finally {
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); await context.close();
    }
  }
} finally { await browser.close(); }
console.log(results.length + '/8 goal-execution cases passed');
