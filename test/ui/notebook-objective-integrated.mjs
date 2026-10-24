// Actual migrated consumers: preserve the shell objective through measured lifecycle changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const [out = path.join(os.tmpdir(), 'bb-objective-integrated'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const settings = { rewardfit: '#rewardfit-demos', rare: '#rare-budget', skills: '#skills-bias', hindsight: '#hindsight-setting', metarl: '#metarl-contingency', hierarchy: '#hierarchy-setting', ensemble: '#ensemble-coefficient' };
const rows = [];
try {
  for (const width of [1280, 390]) for (const id of Object.keys(settings)) {
    const name = `${width}-${id}`, context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, colorScheme: width === 390 ? 'dark' : 'light' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const row = { name, states: [] }; rows.push(row);
    try {
      await page.goto(url); await page.evaluate(() => localStorage.setItem('breaking-bellman-v1', JSON.stringify({ intro: 1 }))); await page.reload();
      await page.evaluate(id => bellman.level(id), id);
      const inspect = async phase => {
        const before = await page.evaluate(() => JSON.stringify(bellman.record()));
        if (!await page.locator('#custom-notebook').evaluate(e => e.open)) await page.locator('#custom-notebook > summary').click();
        await page.locator('#custom-notebook-tab-rule').click();
        const value = await page.evaluate(id => {
          const panel = document.querySelector('#custom-notebook-rule'), objective = document.querySelector('#custom-notebook-objective');
          return { phase: null, goal: CONTENT.levels.find(l => l.id === id).goal.text, text: panel.innerText, objective: objective?.innerText, count: document.querySelectorAll('#custom-notebook-objective').length, height: objective?.getBoundingClientRect().height, record: bellman.record()?.id || null, stale: bellman.replay().stale, overflow: document.documentElement.scrollWidth > innerWidth };
        }, id);
        value.phase = phase; row.states.push(value);
        assert.ok(await page.locator('#custom-notebook-rule').isVisible(), name + ': visible Rule at ' + phase);
        assert.equal(value.count, 1, name + ': single objective at ' + phase);
        assert.ok(value.height > 0 && value.text.includes(value.goal) && value.objective.includes(value.goal), name + ': exact visible objective at ' + phase);
        assert.ok(!value.overflow, name + ': viewport fits at ' + phase);
        assert.equal(await page.evaluate(() => JSON.stringify(bellman.record())), before, name + ': reading Rule preserves the entire record');
        await page.screenshot({ path: path.join(out, `${name}-${phase}.png`), fullPage: true });
        return value;
      };
      assert.equal((await inspect('entry')).record, null);
      const prediction = id === 'ensemble' ? '#ensemble-p-1' : id === 'metarl' ? '#metarl-p button:nth-of-type(2)' : id === 'rewardfit' ? '#rewardfit-p button' : null;
      if (prediction && await page.locator(prediction).count()) await page.locator(prediction).first().click();
      await page.locator(`#${id}-run`).click();
      await page.waitForFunction(id => bellman.record()?.level === id, id);
      const measured = await inspect('run'); assert.ok(measured.record);
      if (id === 'skills') await page.locator('#skills-scene summary').click();
      const setting = page.locator(settings[id]);
      assert.ok(await setting.isVisible(), name + ': experiment setting exposed before change');
      if (id === 'ensemble') await setting.fill(String(Number(await setting.inputValue()) + 0.1));
      else {
        const next = await setting.evaluate(e => [...e.options].find(o => o.value !== e.value).value);
        await setting.selectOption(next);
      }
      const changed = await inspect('settings'); assert.equal(changed.record, measured.record); assert.equal(changed.stale, true);
      await page.locator(id === 'ensemble' ? '#ensemble-recompute' : `#${id}-run`).click();
      await page.waitForFunction(previous => bellman.record()?.id && bellman.record().id !== previous && !bellman.replay().stale, measured.record);
      assert.notEqual((await inspect('rerun')).record, measured.record);
      await page.evaluate(id => { bellman.level('cliff'); bellman.level(id); }, id);
      assert.equal((await inspect('reentry')).record, null);
      assert.deepEqual(errors, [], name + ': no application errors');
      row.passed = true; console.log('ok ' + name);
    } catch (error) { row.failure = error.stack; throw error; }
    finally { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2)); await context.close(); }
  }
} finally { await browser.close(); }
console.log(`PASS ${rows.length} actual lesson objective lifecycles`);
