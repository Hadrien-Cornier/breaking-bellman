// Focused desktop/phone matrix, also called for these levels by levels.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { inferenceContract } from '../inference-ui.mjs';
const [out = path.join(os.tmpdir(), 'bb-inference'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath });
const records = [];
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) for (const progress of ['clean', 'newer']) for (const id of ['elbo', 'messages']) {
    const name = `${width}-${progress}-${id}`, proof = { id, name, checks: [] }, errors = [];
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 390 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    const verify = (value, text) => { proof.checks.push({ text, passed: !!value }); assert.ok(value, name + ': ' + text); };
    try {
      await page.goto(url);
      if (progress === 'newer') { await page.evaluate(f => localStorage.setItem('breaking-bellman-v1', JSON.stringify(f)), fixture); await page.reload(); }
      if (await page.locator('dialog.intro button').count()) await page.locator('dialog.intro button').first().click();
      await page.evaluate(id => bellman.level(id), id);
      verify(await page.evaluate(() => document.querySelector('main.layout').firstElementChild.id === 'campaign-strip'), 'map strip is first in DOM');
      await page.locator('#tabs button').last().focus(); await page.keyboard.press('Tab');
      verify(await page.locator('#campaign-strip').evaluate(e => e.contains(document.activeElement)), 'map strip is first in lesson keyboard order');
      await inferenceContract(page, proof, verify, out);
      await page.reload();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
      verify(saved.level === id, 'stable selection survives reload');
      if (progress === 'newer') {
        assert.deepEqual(saved.recapDismissed, fixture.recapDismissed);
        assert.deepEqual(saved.answers.skew, fixture.answers.skew);
        for (const oldId of fixture.done) verify(saved.done.includes(oldId), 'retains saved completion ' + oldId);
      }
      verify(errors.length === 0, 'no application console or page errors: ' + errors.join('; '));
      proof.passed = true; console.log('ok ' + name);
    } catch (error) {
      proof.passed = false; proof.failure = error.stack;
      await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true });
      console.error(proof.failure);
    } finally { records.push(proof); await context.close(); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(records, null, 2)); }
  }
} finally { await browser.close(); }
assert.ok(records.every(r => r.passed), 'all inference matrix cases pass');
console.log(records.length + ' inference cases passed');
