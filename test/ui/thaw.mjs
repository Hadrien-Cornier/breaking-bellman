// Teaching-surface inventory and shell integration for Thaw. Full replay is in levels.mjs.
// node test/ui/thaw.mjs [output directory] [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const [out = path.join(os.tmpdir(), 'bb-thaw'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
const inventory = [];
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390, colorScheme });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    if (await page.locator('dialog.intro').count()) await page.getByRole('button', { name: 'Open the campaign map', exact: true }).click();
    await page.evaluate(() => bellman.level('thaw'));
    check(await page.locator('#thaw-scene').isVisible(), 'scene before prediction');
    check(await page.evaluate(() => bellman.record() === null), 'no fabricated pre-run result');
    check(await page.locator('#thaw-results').count() === 0, 'results absent before Run');
    check(await page.evaluate(() => !!(document.querySelector('#vpo-lab').compareDocumentPosition(document.querySelector('#mode-pane')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'shell mounts scene before teaching card');
    const capture = async stage => {
      const name = `${width}-${colorScheme}-${stage}`;
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no overflow');
      check((await page.locator('#thaw-lesson').innerText()).includes('Concept sketch'), name + ' labeled concept sketch');
      inventory.push({ name, text: await page.locator('#thaw-lesson').innerText(), html: await page.locator('#thaw-lesson').innerHTML() });
      await page.locator('#thaw-lesson').screenshot({ path: path.join(out, name + '-card.png') });
      await page.locator('#thaw-lab').screenshot({ path: path.join(out, name + '-scene.png') });
    };
    await capture('prediction');
    await page.locator('#thaw-lesson button.opt').filter({ hasText: 'Fresh practice may help' }).click();
    await capture('run');
    await page.locator('#thaw-run').click();
    await page.waitForFunction(() => bellman.record()?.level === 'thaw');
    await page.keyboard.press('Escape'); // dismiss the discovery toast through its real keyboard handler
    await capture('diagnose');
    await page.locator('#thaw-lesson button.opt').filter({ hasText: 'How much the arm accelerates' }).click();
    await capture('mechanism');
    await page.locator('#thaw-lesson button.opt').filter({ hasText: 'Fine-tune.' }).click();
    await capture('budget');
    await page.locator('#thaw-budget').selectOption('20');
    await page.locator('#thaw-run').click();
    await page.waitForFunction(() => bellman.record()?.settings.updates === 20 && !bellman.replay().stale);
    await page.locator('#thaw-lesson button.opt').filter({ hasText: 'Fresh attempts and the length' }).click();
    await capture('complete');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes('thaw')), 'stable completion id');
    const sections = await page.evaluate(() => {
      const names = ['thaw-rules', 'thaw-chart', 'thaw-results', 'thaw-evidence'];
      return names.map(id => ({ id, text: document.getElementById(id)?.textContent, html: document.getElementById(id)?.outerHTML }));
    });
    inventory.push({ name: `${width}-${colorScheme}-notebook`, sections });
    await page.getByRole('tab', { name: 'Codex', exact: true }).click();
    inventory.push({ name: `${width}-${colorScheme}-discovery`, card: await page.evaluate(() => CONTENT.cards.thaw) });
    await page.evaluate(() => bellman.level('thaw'));
    check(await page.evaluate(() => bellman.record() === null), 'returning completion does not auto-run or reuse measurements');
    check(await page.locator('#thaw-results').count() === 0, 'returning completion hides results until Run');
    check(errors.length === 0, 'no application console errors: ' + errors.join('; '));
    await context.close();
  }
} finally {
  fs.writeFileSync(path.join(out, 'teaching-inventory.json'), JSON.stringify({ checks, noviceAcceptance: 'Pending single final Phase2 independent reader session under main225.', inventory }, null, 2));
  await browser.close();
}
console.log(`Thaw teaching surfaces: ${checks} checks passed.`);
