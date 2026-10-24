// Bounded regression: exercise the real renderer against a persistent Notebook Curve.
// Load the working source over the existing build, so this needs no cache/build regeneration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright-core');
const replay = require('../../web/goal-execution.js');
const H = require('../../src/agents/hindsight.js'), O = require('../../src/agents/hierarchy.js');
const [out = path.join(os.tmpdir(), 'bb-goal-reentry')] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const candidates = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)) });
const results = [], failures = [];
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL('../../dist/breaking-bellman.html', import.meta.url).href);
  await page.evaluate(() => { document.querySelector('dialog[open]')?.close(); bellman.level('cliff'); });
  await page.addScriptTag({ path: new URL('../../web/goal-execution.js', import.meta.url).pathname });
  for (const id of ['hindsight', 'hierarchy']) for (const shell of [false, true]) {
    const record = id === 'hindsight' ? replay.record(id, { sweeps: 2 }, H.compare({ sweeps: 2 })) : replay.record(id, {}, O.compare());
    const result = await page.evaluate(({ id, shell, record }) => {
      const host = document.createElement('section'), lab = document.createElement('div'), curve = document.createElement('div');
      host.append(lab, curve); document.body.append(host);
      const h = (tag, attrs, children) => {
        const [name, ...classes] = tag.split('.'), el = document.createElement(name);
        el.classList.add(...classes);
        for (const [key, value] of Object.entries(attrs || {})) {
          if (key === 'text') el.textContent = value;
          else if (key.startsWith('on')) el[key] = value;
          else el.setAttribute(key, value);
        }
        if (children != null) el.append(...(Array.isArray(children) ? children : [children]));
        return el;
      };
      const ctx = { h, ...(shell ? { shell: { notebook: () => curve } } : {}) };
      const spec = { id, choices: [['default', 'Default']], settingLabel: 'Setup', run() {}, metric: () => 'Measured', accounting: () => 'Counted' };
      let view;
      const receipts = [];
      try {
        for (let entry = 0; entry < 3; entry++) {
          view?.cancel();
          view = BB.goalExecution.mount(lab, ctx, spec);
          const suffixes = ['scene', 'chart', 'result', 'evidence'];
          const clean = suffixes.every(s => [...host.querySelectorAll('#' + id + '-' + s)].every(e => !e.dataset.run));
          view.accept(record);
          receipts.push({ entry, clean, surfaces: suffixes.map(s => {
            const nodes = host.querySelectorAll('#' + id + '-' + s);
            return { suffix: s, count: nodes.length, linked: document.getElementById(id + '-' + s)?.dataset.run === record.id };
          }), sameRecord: view.record() === record });
        }
      } finally { view?.cancel(); host.remove(); }
      return { id, shell, receipts };
    }, { id, shell, record });
    results.push(result);
    try {
      for (const receipt of result.receipts) {
        assert.ok(receipt.clean, id + ': remount clears old measured surfaces');
        assert.ok(receipt.sameRecord, id + ': accept retains the exact measured record');
        for (const surface of receipt.surfaces) {
          assert.equal(surface.count, 1, id + ': unique ' + surface.suffix);
          assert.ok(surface.linked, id + ': linked ' + surface.suffix);
        }
      }
      console.log('ok ' + id + ' ' + (shell ? 'persistent Notebook' : 'lab fallback'));
    } catch (error) { failures.push(error.message); console.log('not ok ' + id + ': ' + error.message); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
