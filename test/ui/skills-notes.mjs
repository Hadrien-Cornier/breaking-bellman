// Focused owner regression for Notes before and after completed Skills steps.
// The fixture supplies the early shell containers; it is not integrated-shell acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const [out = path.join(os.tmpdir(), 'bb-skills-notes'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const results = [];
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const wrongFirst of [true, false]) {
    const name = `${width}-${wrongFirst ? 'incorrect-first' : 'correct-first'}`;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(() => {
      document.querySelector('dialog.intro button')?.click();
      const mount = BBSKILLS_LEVEL.mount;
      BBSKILLS_LEVEL.mount = (pane, lab, hooks) => {
        document.getElementById('skills-notes-fixture')?.remove();
        const notebook = document.createElement('aside');
        notebook.id = 'skills-notes-fixture';
        const sections = Object.fromEntries(['rule', 'curve', 'autopsy', 'notes'].map(name => {
          const section = document.createElement('section');
          section.dataset.section = name; notebook.append(section); return [name, section];
        }));
        mount(pane, lab, { ...hooks, shell: {
          notebook: name => sections[name],
          conceptSketch: spec => {
            const figure = document.createElement('figure');
            figure.textContent = 'Concept sketch: ' + spec.label; return figure;
          },
        } });
        pane.after(notebook);
      };
      bellman.level('skills');
    });
    const notes = page.locator('[data-section="notes"]');
    const snapshot = async phase => {
      const data = await notes.evaluate(e => ({ text: e.innerText, height: e.getBoundingClientRect().height }));
      assert.ok(data.height > 0, phase + ': Notes has positive height');
      assert.ok(data.text.trim(), phase + ': Notes has readable content');
      results.push({ name, phase, ...data, record: await page.evaluate(() => bellman.record()?.id ?? null) });
      return data.text;
    };
    assert.equal(await page.evaluate(() => bellman.record()), null);
    assert.equal(await snapshot('initial'), 'Lesson notes appear here.');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: path.join(out, `${name}-${colorScheme}-initial.png`), fullPage: true });
    }
    if (wrongFirst) {
      await page.locator('#skills-p [data-key="listed"]').click();
      assert.equal(await snapshot('incorrect prediction'), 'Lesson notes appear here.');
    }
    // Run and settings must not invent completed notes or alter an existing record.
    await page.locator('#skills-run').click();
    const original = await page.evaluate(() => JSON.stringify(bellman.record()));
    assert.equal(await snapshot('Run before completed prediction'), 'Lesson notes appear here.');
    await page.locator('#skills-scene summary').click();
    await page.locator('#skills-bias').selectOption('0.5');
    assert.ok(await page.evaluate(() => bellman.replay().stale));
    assert.equal(await page.evaluate(() => JSON.stringify(bellman.record())), original);
    assert.equal(await snapshot('settings before completed prediction'), 'Lesson notes appear here.');
    await page.locator('#skills-p [data-key="zero"]').click();
    const completed = await snapshot('completed prediction');
    assert.ok(completed.includes('Sound chain.'));
    assert.ok(!completed.includes('Lesson notes appear here.'));
    assert.equal(await notes.locator('#skills-p').count(), 1);
    await page.locator('#skills-run').click();
    const fresh = await page.evaluate(() => JSON.stringify(bellman.record()));
    assert.notEqual(fresh, original);
    assert.equal(await snapshot('rerun after prediction'), completed);
    await page.locator('#skills-d [data-key="signal"]').click();
    const diagnosed = await snapshot('completed diagnosis');
    assert.ok(diagnosed.includes('log(1.4)'));
    assert.equal(await notes.locator('#skills-d').count(), 1);
    await page.locator('#skills-method').selectOption('shared');
    assert.equal(await snapshot('method setting'), diagnosed);
    await page.locator('#skills-step').click();
    assert.equal(await page.evaluate(() => JSON.stringify(bellman.record())), fresh);
    await page.screenshot({ path: path.join(out, `${name}-completed.png`), fullPage: true });
    await page.evaluate(() => { bellman.level('slots'); bellman.level('skills'); });
    assert.equal(await page.evaluate(() => bellman.record()), null);
    const returning = await snapshot('re-entry');
    // Existing saves retain the first answer, including an incorrect first try.
    if (wrongFirst) assert.equal(returning, 'Lesson notes appear here.');
    else {
      assert.ok(returning.includes('Sound chain.'));
      assert.ok(!returning.includes('Lesson notes appear here.'));
    }
    assert.equal(await notes.locator('#skills-d').count(), 0, 'no diagnosis presented as completed before a new run');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log('Skills Notes lifecycle: desktop and touch phone passed (early shell fixture).');
