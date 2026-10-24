// Focused returned-lesson acceptance; all-level coverage remains test/ui/levels.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { replayReplan } from '../helpers/replan-ui.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const out = process.argv[2] || '/tmp/bb-replan-ui'; fs.mkdirSync(out, { recursive: true });
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const save of ['clean', 'newer']) for (const theme of ['light', 'dark']) {
    const name = `${width}-${save}-${theme}`;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390, colorScheme: theme });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(new URL('../../dist/breaking-bellman.html', import.meta.url).href);
    if (save === 'newer') { await page.evaluate(p => localStorage.setItem('breaking-bellman-v1', JSON.stringify(p)), fixture); await page.reload(); }
    if (await page.locator('dialog.intro').count()) await page.locator('dialog.intro button').first().click();
    await page.evaluate(() => bellman.level('replan'));
    assert.ok(await page.locator('#replan-stage svg').isVisible());
    assert.equal((await page.evaluate(() => BBREPLAN.state())).record, null);
    assert.ok(await page.locator('#campaign-strip').evaluate(el => el === document.querySelector('main.layout').firstElementChild));
    await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
    await page.locator('#replan-p button').nth(1).click();
    await page.locator('#replan-run').click();
    const record = await replayReplan(page);
    fs.writeFileSync(path.join(out, name + '-record.json'), JSON.stringify(record, null, 2));
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    assert.equal((await page.evaluate(() => BBREPLAN.state())).record.id, record.id, 'theme change keeps record');
    await page.emulateMedia({ colorScheme: theme });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, name + '-after.png'), fullPage: true });
    await page.locator('#replan-schedule').selectOption('lesson');
    await page.locator('#replan-run').click();
    await page.locator('#replan-d button').first().click();
    await page.locator('#replan-repair').click();
    await page.locator('#replan-x button').nth(2).click();
    await page.locator('#replan-complete').click();
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')))).done.includes('replan'));
    fs.writeFileSync(path.join(out, name + '-text.txt'), await page.locator('main').innerText());
    await page.evaluate(() => bellman.level('slots'));
    assert.equal((await page.evaluate(() => BBREPLAN.state())).replay.playing, false);
    await page.evaluate(() => bellman.level('replan'));
    assert.equal((await page.evaluate(() => BBREPLAN.state())).record, null);
    if (save === 'newer') {
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
      assert.deepEqual(stored.future, fixture.future);
      for (const id of fixture.done) assert.ok(stored.done.includes(id));
    }
    assert.deepEqual(errors, []); console.log('ok replan ' + name);
    await context.close();
  }
} finally { await browser.close(); }
