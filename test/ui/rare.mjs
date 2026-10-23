// Rare's complete measured replay contract. Also called by the all-level matrix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
export async function rareContract(page, out, name) {
  const status = () => page.evaluate(() => ({ record: bellman.record(), replay: bellman.replay() }));
  const pixels = () => page.locator('#rare-stage').evaluate(e => e.toDataURL());
  const initial = await status();
  assert.equal(initial.record, null);
  assert.ok(await page.locator('#rare-stage').isVisible());
  await page.locator('#rare-run').click();
  await page.waitForFunction(() => bellman.record()?.level === 'rare');
  const first = await status();
  const encoded = JSON.stringify(first.record);
  fs.writeFileSync(path.join(out, name + '-record.json'), encoded);
  const linked = () => page.evaluate(() => [...document.querySelectorAll('#rare-stage, #rare-chart, #rare-results, #rare-evidence')].every(e => e.dataset.run === bellman.record().id && e.dataset.stale === String(bellman.replay().stale)));
  assert.ok(await linked());
  assert.ok(!(await page.locator('body').innerText()).includes(first.record.id));
  assert.equal(first.record.policies.length, 6);
  assert.equal(first.record.data.fresh.steps, 2400);
  const sizes = await page.locator('#rare-experiment button, #rare-experiment select, #rare-lesson button').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  assert.ok(sizes.every(s => s.w >= 44 && s.h >= 44), JSON.stringify(sizes));
  const zero = await pixels();
  await page.locator('#rare-step').click();
  assert.equal((await status()).replay.time, 1);
  const one = await pixels();
  await page.locator('#rare-watch').click();
  await page.waitForFunction(() => bellman.replay().time >= 3);
  await page.locator('#rare-watch').click();
  const paused = await pixels();
  await page.waitForTimeout(250);
  assert.equal(await pixels(), paused);
  assert.equal((await status()).replay.watching, false);
  await page.locator('#rare-replay').click();
  assert.equal(await pixels(), zero);
  await page.locator('#rare-step').click();
  assert.equal(await pixels(), one);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#rare-watch').click();
  await page.waitForTimeout(250);
  assert.equal((await status()).replay.time, 1);
  assert.equal((await status()).replay.watching, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Every measured sample, through the real Step handler, for every named method.
  const evidence = await page.evaluate(() => {
    const r = bellman.record(), frames = [];
    for (const p of r.policies) {
      const selector = document.querySelector('#rare-policy'); selector.value = p.name; selector.dispatchEvent(new Event('change'));
      document.querySelector('#rare-replay').click();
      for (let t = 1; t <= r.settings.steps; t++) {
        document.querySelector('#rare-step').click();
        const e = r.series[p.name][t - 1], f = BBRARE_RECORD.frame(r, p.name, t);
        if (bellman.replay().time !== t || !document.querySelector('#rare-stage').getAttribute('aria-label').includes('Rover at ' + BBRARE.CELL_LABELS[e.state] + '.')) throw Error('Frame mismatch ' + p.name + ' ' + t);
        const displayed = [...document.querySelectorAll('#rare-counts .rare-count span:first-of-type')].map(el => +el.textContent.replace('Visits ', ''));
        if (JSON.stringify(displayed) !== JSON.stringify(f.counts)) throw Error('Count mismatch');
      }
      frames.push({ policy: p.name, end: BBRARE_RECORD.frame(r, p.name, r.settings.steps) });
    }
    return frames;
  });
  assert.equal(JSON.stringify((await status()).record), encoded, 'drawing never mutates recorded evidence');
  await page.locator('#rare-budget').selectOption('28');
  assert.ok((await status()).replay.stale);
  assert.ok(await linked());
  assert.equal((await status()).record.id, first.record.id);
  assert.match(await page.locator('#rare-stale').innerText(), /previous run/);
  await page.locator('#rare-run').click();
  await page.waitForFunction(old => bellman.record()?.id !== old, first.record.id);
  const second = await status();
  assert.equal(second.replay.stale, false); assert.ok(await linked());
  assert.equal(second.record.settings.steps, 28);
  assert.notDeepEqual(second.record.metrics, first.record.metrics);
  await page.locator('#rare-epsilon').selectOption('0.2');
  assert.ok((await status()).replay.stale);
  await page.locator('#rare-run').click();
  await page.waitForFunction(old => bellman.record()?.id !== old, second.record.id);
  assert.equal((await status()).record.settings.eps, 0.2);
  assert.ok(!(await status()).replay.stale);
  await page.screenshot({ path: path.join(out, name + '-result.png'), fullPage: true });
  fs.writeFileSync(path.join(out, name + '-text.txt'), await page.locator('main').innerText());
  fs.writeFileSync(path.join(out, name + '-frames.json'), JSON.stringify(evidence));
  const result = await page.locator('#rare-results').textContent();
  await page.locator('#rare-diagnose button').nth(1).click();
  fs.writeFileSync(path.join(out, name + '-diagnose-feedback.txt'), await page.locator('#rare-lesson').innerText());
  await page.locator('#rare-diagnose button').first().click();
  await page.getByRole('button', { name: 'Explain the counts', exact: true }).click();
  await page.locator('#rare-explain button').nth(1).click();
  fs.writeFileSync(path.join(out, name + '-explain-feedback.txt'), await page.locator('#rare-lesson').innerText());
  await page.locator('#rare-explain button').first().click();
  await page.locator('#rare-complete').click();
  fs.writeFileSync(path.join(out, name + '-complete.txt'), await page.locator('#rare-lesson').innerText());
  await page.screenshot({ path: path.join(out, name + '-complete.png'), fullPage: true });
  await page.evaluate(() => bellman.level('cliff'));
  assert.equal((await status()).record, null);
  assert.equal((await status()).replay.world, 'cliff');
  await page.evaluate(() => bellman.level('rare'));
  assert.equal((await status()).record, null);
  assert.equal((await status()).replay.time, 0);
  assert.ok(await page.locator('#rare-stage').isVisible());
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out = path.join(os.tmpdir(), 'bb-rare'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const exe = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe });
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
  let cases = 0;
  try {
    for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) for (const progress of ['clean', 'newer']) {
      const name = `${width}-${colorScheme}-${progress}`;
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, colorScheme, hasTouch: width === 390 });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url);
      await page.evaluate(progress => localStorage.setItem('breaking-bellman-v1', JSON.stringify(progress)), progress === 'clean' ? { intro: 1 } : fixture);
      await page.reload();
      await page.evaluate(() => bellman.level('rare'));
      assert.ok(await page.evaluate(() => document.querySelector('main').firstElementChild.id === 'campaign-strip'));
      await page.screenshot({ path: path.join(out, name + '-before.png'), fullPage: true });
      fs.writeFileSync(path.join(out, name + '-predict.txt'), await page.locator('#rare-lesson').innerText());
      await page.locator('#rare-predict button').nth(1).click();
      fs.writeFileSync(path.join(out, name + '-predict-feedback.txt'), await page.locator('#rare-lesson').innerText());
      await rareContract(page, out, name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      console.log('ok rare ' + name); cases++;
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(cases + '/8 rare matrix cases passed');
}
