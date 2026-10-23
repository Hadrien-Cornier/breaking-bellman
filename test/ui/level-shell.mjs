// Shell acceptance supplements levels.mjs, which owns full measured replay on every level.
// node test/ui/level-shell.mjs [external proof directory] [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const [out = path.join(os.tmpdir(), 'bb-level-shell'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const inventory = []; let checks = 0;
const check = (ok, label) => { checks++; assert.ok(ok, label); };
try {
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) for (const progress of ['clean', 'newer']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, colorScheme, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(save => localStorage.setItem('breaking-bellman-v1', JSON.stringify(save)), progress === 'newer' ? { ...fixture, intro: 1 } : { intro: 1 });
    await page.reload();
    const levels = await page.evaluate(() => CONTENT.levels.map(({ id, custom }) => ({ id, custom })));
    for (const { id, custom } of levels) {
      const name = `${width}-${colorScheme}-${progress}-${id}`;
      await page.evaluate(id => bellman.level(id), id);
      const notebook = custom ? '#custom-notebook' : '#notebook';
      const scene = custom ? '#vpo-lab svg' : '#stage';
      check(await page.locator(scene).first().isVisible(), name + ': scene before prediction');
      check(await page.locator('#mode-pane > .teaching-card').count() === 1, name + ': one teaching card');
      if (!custom) check(await page.locator('#mode-pane .steps > .step').count() === 1, name + ': one current step');
      check(await page.evaluate(() => {
        const main = document.querySelector('main'), children = [...main.children].filter(e => !e.hidden);
        return children[0].id === 'campaign-strip' && ['lab', 'vpo-lab'].includes(children[1].id) && children[2].id === 'mode-pane';
      }), name + ': map, scene, step in DOM order');
      check(await page.locator(notebook).evaluate(e => !e.open), name + ': Notebook starts closed for a new level');
      await page.locator('#tabs button').last().focus(); await page.keyboard.press('Tab');
      check(await page.locator('#campaign-strip button').evaluate(e => e === document.activeElement), name + ': map first in keyboard order');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': no page overflow');
      const entry = { name, id, step: await page.locator('#mode-pane').innerText(), notebook: {} };
      await page.screenshot({ path: path.join(out, name + '-step.png'), fullPage: true });
      await page.locator(notebook + ' > summary').click();
      for (const section of ['rule', 'curve', 'autopsy', 'notes']) {
        await page.locator(notebook + ` [data-notebook-tab="${section}"]`).click();
        const panel = page.locator(notebook + ` [data-notebook-panel="${section}"]`);
        check(await panel.isVisible(), name + ': ' + section + ' opens');
        check(await page.locator(notebook + ' [role="tabpanel"]:visible').count() === 1, name + ': one Notebook panel');
        entry.notebook[section] = await panel.innerText();
      }
      await page.locator(notebook + ' [data-notebook-tab="notes"]').focus();
      await page.keyboard.press('Home');
      check(await page.locator(notebook + ' [data-notebook-tab="rule"]').evaluate(e => e === document.activeElement && e.getAttribute('aria-selected') === 'true'), name + ': keyboard tab selection');
      await page.keyboard.press('ArrowRight');
      check(await page.locator(notebook + ' [data-notebook-tab="curve"]').evaluate(e => e === document.activeElement), name + ': arrow navigation');
      const small = await page.locator(notebook + ' button, ' + notebook + ' > summary').evaluateAll(es => es.filter(e => e.getClientRects().length).filter(e => e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44).map(e => e.textContent));
      check(!small.length, name + ': 44px Notebook controls ' + small.join(', '));
      if (!custom) {
        await page.locator(notebook + ' [data-notebook-tab="notes"]').click();
        const sketch = page.locator('.concept-sketch');
        check(await sketch.count() === 1 && await sketch.locator('figcaption').innerText() === 'Concept sketch', name + ': drawing explicitly labeled');
        check(await sketch.evaluate(e => !!e.closest('#notebook-notes') && !e.hasAttribute('data-run')), name + ': concept sketch separate from measured scene');
        await sketch.screenshot({ path: path.join(out, name + '-sketch.png') });
      }
      const duplicates = await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((id, i) => ids.indexOf(id) !== i); });
      check(!duplicates.length, name + ': unique DOM identities ' + duplicates.join(', '));
      if (progress === 'newer') {
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
        assert.deepEqual(saved.answers.skew, fixture.answers.skew);
        assert.deepEqual(saved.recapDismissed, fixture.recapDismissed);
      }
      inventory.push(entry);
    }
    check(!errors.length, 'no application console errors: ' + errors.join('; '));
    console.log(`ok ${width} ${colorScheme} ${progress}: ${levels.length} shells`);
    await context.close();
  }
} finally {
  fs.writeFileSync(path.join(out, 'teaching-surfaces.json'), JSON.stringify(inventory, null, 2));
  await browser.close();
}
console.log(`PASS ${checks} shell checks; independent novice acceptance pending final Phase2 session.`);
