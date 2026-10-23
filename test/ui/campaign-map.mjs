// D1 navigation acceptance, independent of the all-level simulation baseline matrix.
// npm run build && node test/ui/campaign-map.mjs [external proof directory] [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const [out = path.join(os.tmpdir(), 'bb-campaign-map'), url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json', import.meta.url))).progress;
fs.mkdirSync(out, { recursive: true });
const exe = [process.env.PW_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const records = [];
let checks = 0;
function check(value, text) { checks++; assert.ok(value, text); }
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')));
async function seed(page, value) {
  await page.goto(url);
  await page.evaluate(value => { localStorage.setItem('breaking-bellman-v1', JSON.stringify(value)); sessionStorage.clear(); }, value);
  await page.reload();
}
async function targets(page, selector) {
  const small = await page.locator(selector).evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => ({ text: e.textContent, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(r => r.w < 44 || r.h < 44));
  check(!small.length, '44px map targets: ' + JSON.stringify(small));
}
try {
  for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark']) for (const progress of ['clean', 'newer']) {
    const name = `${width}-${colorScheme}-${progress}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, colorScheme, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const input = progress === 'newer' ? structuredClone(fixture) : { intro: 1, level: 'slots', done: [] };
    if (progress === 'newer') input.level = 'unknown-future';
    input.future = { nested: [false, null, { stable: 'keep' }] };
    input.made = { ...input.made, 'unknown-future': { nested: { rule: 42 } } };
    await seed(page, input);
    if (progress === 'newer') check(await page.locator('#campaign-map').isVisible(), name + ' unknown selected level opens map');
    else check(await page.locator('#campaign-strip').isVisible(), name + ' known lesson retains compact strip');
    await page.locator('#campaign-logo').click();
    const expected = await page.evaluate(() => ({ ids: CONTENT.levels.map(l => l.id), next: CONTENT.graph.next(JSON.parse(localStorage.getItem('breaking-bellman-v1')).done), edges: CONTENT.graph.activeEdges, total: CONTENT.graph.edges.length }));
    check(expected.total === 30, 'all 30 approved edges retained');
    check(await page.locator('[data-map-level]').count() === expected.ids.length, 'all registered levels visible');
    await page.waitForFunction(n => document.querySelectorAll('.map-edges path').length === n, expected.edges.length);
    const edges = await page.locator('.map-edges path').evaluateAll(es => es.map(e => [e.dataset.from, e.dataset.to]));
    assert.deepEqual(edges, expected.edges.map(e => [e.from, e.to])); checks++;
    await targets(page, '#campaign-map button');
    await page.screenshot({ path: path.join(out, name + '-levels.png'), fullPage: true });
    if (width === 390) await page.locator('[data-zoom="worlds"]').tap();
    else await page.locator('[data-zoom="worlds"]').click();
    check(await page.locator('.map-medal').count() === 6, 'six campaign worlds');
    await targets(page, '#campaign-map button');
    await page.screenshot({ path: path.join(out, name + '-worlds.png'), fullPage: true });
    await page.locator('.map-medal').last().click();
    check(await page.locator('#campaign-map').getAttribute('data-zoom') === 'levels', 'world medal opens Levels zoom');
    check(await page.locator('#map-w6 h2').evaluate(e => e === document.activeElement), 'zoom into world moves keyboard focus');
    await page.locator('[data-zoom="methods"]').click();
    check(await page.locator('[data-node="slots"] .map-chips').innerText() === 'ε-greedy\nOptimism\nUCB', 'Methods shows approved named methods');
    check(await page.locator('.map-edge-label').count() === expected.edges.length, 'Methods explains every active link');
    await page.screenshot({ path: path.join(out, name + '-methods.png'), fullPage: true });
    await page.reload();
    await page.locator('#campaign-logo').click();
    check(await page.locator('#campaign-map').getAttribute('data-zoom') === 'methods', 'zoom survives reload in this tab');
    check((await stored(page)).level === input.level, 'map and zoom do not change selected save id');
    await page.getByRole('tab', { name: 'Codex', exact: true }).click();
    await page.reload();
    check((await stored(page)).level === input.level, 'unrelated save and reload preserve unknown selection');
    await page.locator('#campaign-logo').click();
    const next = page.locator('[data-play-next]');
    check(await next.getAttribute('data-play-next') === expected.next, 'Play next follows graph course order');
    if (width === 390) await next.tap(); else await next.click();
    check(await page.locator('.map-brief').getAttribute('data-brief-level') === expected.next, 'Play next opens suggested briefing');
    await page.keyboard.press('Escape');
    check(await next.evaluate(e => e === document.activeElement), 'Escape restores opener focus');
    await page.locator('[data-map-level="continuous"]').click();
    const missing = await page.evaluate(() => CONTENT.graph.missing('continuous', JSON.parse(localStorage.getItem('breaking-bellman-v1')).done).map(id => CONTENT.levels.find(l => l.id === id).title));
    if (missing.length) {
      const lock = await page.locator('.map-lock').innerText();
      for (const title of missing) check(lock.includes(title), 'lock names missing parent ' + title);
      await page.screenshot({ path: path.join(out, name + '-lock.png'), fullPage: true });
      await targets(page, '.map-brief button');
      await page.getByRole('button', { name: 'Go to ' + missing[0], exact: true }).click();
      check(await page.locator('#map-brief-title').innerText() === missing[0], 'Go to parent opens its briefing');
      check((await stored(page)).level === input.level, 'parent briefing is not an explicit lesson selection');
      await page.keyboard.press('Escape');
      await page.locator('[data-map-level="continuous"]').click();
      const skip = page.getByRole('button', { name: 'Open anyway', exact: true });
      if (width === 390) await skip.tap(); else await skip.click();
      check((await stored(page)).level === 'continuous', 'advisory lock allows explicit skip');
      check(await page.locator('#stage').isVisible(), 'skip retains live simulation scene');
    } else await page.keyboard.press('Escape');
    // Every node reaches its actual lesson, including both custom lessons.
    for (const id of expected.ids) {
      await page.locator('#campaign-logo').click();
      await page.locator(`[data-map-level="${id}"]`).click();
      check(await page.locator('.map-brief').getAttribute('data-brief-level') === id, 'briefing reachable ' + id);
      // Native modal keeps keyboard focus inside and closes with Escape.
      await page.keyboard.press('Tab');
      check(await page.locator('.map-brief').evaluate(e => e.contains(document.activeElement)), 'briefing owns keyboard focus');
      await page.locator('[data-open-level]').click();
      check((await stored(page)).level === id, 'lesson reachable ' + id);
      check(await page.locator('#campaign-strip button').innerText() === `All ${expected.ids.length} levels`, 'strip above ' + id);
      check(await page.locator(({"vpo": "#custom-stage", "supermimic": "#custom-stage", "thaw": "#thaw-scene", "rewardfit": "#rewardfit-scene", "goals": "#goals-scene", "rare": "#rare-stage", "elbo": "#elbo-scene", "messages": "#messages-scene", "hindsight": "#hindsight-scene", "hierarchy": "#hierarchy-scene", "skills": "#skills-stage", "skew": "#skew-stage", "metarl": "#metarl-scene", "ensemble": "#ensemble-stage", "replan": "#replan-stage"})[id] || '#stage').first().isVisible(), 'scene retained ' + id);
    }
    await page.reload();
    const actual = await stored(page);
    assert.deepEqual(actual.future, input.future); assert.deepEqual(actual.made['unknown-future'], input.made['unknown-future']); checks += 2;
    if (progress === 'newer') {
      for (const field of ['done', 'lstep', 'answers', 'made', 'recapDismissed']) { assert.deepEqual(actual[field], input[field]); checks++; }
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no lesson overflow');
    await page.locator('#campaign-logo').click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no map overflow');
    check(!errors.length, 'no console/page errors: ' + errors.join('; '));
    records.push({ name, passed: true, errors });
    console.log('ok ' + name);
    await context.close();
  }
  const context = await browser.newContext(); const page = await context.newPage();
  await seed(page, { intro: 1, mode: 'codex', level: 'future-level', done: [] });
  check(await page.locator('#campaign-map').isVisible(), 'unknown selection opens map even when another mode was saved');
  await page.locator('[data-zoom="worlds"]').click();
  const other = await context.newPage(); await other.goto(url);
  check(await other.locator('#campaign-map').getAttribute('data-zoom') === 'levels', 'zoom is isolated per tab');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('breaking-bellman-v1')); s.done = CONTENT.levels.map(l => l.id); localStorage.setItem('breaking-bellman-v1', JSON.stringify(s)); });
  await page.reload();
  check(await page.getByRole('button', { name: 'Every level cleared' }).isDisabled(), 'all cleared has no invented next');
  await context.close();
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, records }, null, 2));
  await browser.close();
}
console.log(`${records.length}/8 map cases passed; ${checks} checks`);
