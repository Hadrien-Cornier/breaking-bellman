// Focused Skills replay and teaching-surface acceptance. Full matrix also calls this contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { skillsContract } from './lib/skills-contract.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [out = path.join(os.tmpdir(), 'bb-skills'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
const results = [];
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const progress of ['clean', 'newer']) {
    const name = width + '-' + progress;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(p => { if (p) localStorage.setItem('breaking-bellman-v1', JSON.stringify(p)); else localStorage.removeItem('breaking-bellman-v1'); }, progress === 'newer' ? fixture : null);
    await page.reload();
    await page.evaluate(() => { document.querySelector('dialog.intro button')?.click(); bellman.level('skills'); });
    assert.equal(await page.evaluate(() => bellman.record()), null);
    assert.ok(await page.locator('#skills-stage').isVisible());
    assert.ok(await page.evaluate(() => document.querySelector('main.layout').firstElementChild.id === 'campaign-strip'));
    await page.locator('#tabs button').last().focus(); await page.keyboard.press('Tab');
    assert.ok(await page.locator('#campaign-strip button').evaluate(e => e === document.activeElement));
    await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
    await page.locator('#skills-run').click();
    const result = await skillsContract(page, out, name);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme }); await page.locator('#skills-step').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, name + '-' + theme + '.png'), fullPage: true });
    }
    await page.evaluate(() => bellman.level('slots'));
    assert.equal(await page.evaluate(() => bellman.record()), null);
    assert.ok(await page.locator('#stage').isVisible());
    await page.evaluate(() => bellman.level('skills'));
    assert.equal(await page.evaluate(() => bellman.record()), null);
    assert.equal(await page.evaluate(() => bellman.replay().time), 0);
    await page.reload();
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
    assert.ok(save.done.includes('skills'));
    if (progress === 'newer') {
      for (const id of fixture.done) assert.ok(save.done.includes(id));
      assert.deepEqual(save.recapDismissed, fixture.recapDismissed);
      assert.deepEqual(save.answers['skew-p'], fixture.answers['skew-p']);
    }
    assert.deepEqual(errors, []);
    results.push({ name, ...result, passed: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    await context.close(); console.log('ok ' + name);
  }
} finally { await browser.close(); }
console.log('Skills: 4/4 desktop/phone clean/newer cases passed');
