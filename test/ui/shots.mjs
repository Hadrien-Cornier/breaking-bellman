// Screenshots for the README and quick visual checks: node test/ui/shots.mjs [out dir]
// Needs Playwright (see smoke.mjs). Runs a few short trainings, so it takes a minute or two.
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
const require = createRequire(import.meta.url);
const load = (m) => { try { return require(m); } catch (e) { return null; } };
const pw = (process.env.PW_CORE && load(process.env.PW_CORE)) || load('playwright') || load('playwright-core');
if (!pw) { console.error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
const out = process.argv[2] || (os.tmpdir() + '/breaking-bellman-shots');
fs.mkdirSync(out, { recursive: true });
const page0 = new URL('../../dist/breaking-bellman.html', import.meta.url).pathname;
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const errors = [];
async function shot(name, w, h, fn, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dpr || 2, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(name + ': ' + e.message); console.log('PAGEERROR', name, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  if (opts.state) await page.addInitScript((st) => { try { localStorage.setItem('breaking-bellman-v1', JSON.stringify(st)); } catch (e) {} }, opts.state);
  await page.goto('file://' + page0);
  await page.waitForTimeout(400);
  if (fn) await fn(page);
  await page.screenshot({ path: out + '/' + name + '.png', fullPage: !!opts.full });
  if (opts.stage) { // the square field with its caption line, for the blog
    const b = await page.locator('#stage').boundingBox(), S = Math.min(b.width, b.height) + 24;
    await page.screenshot({ path: out + '/' + name + '-stage.png', clip: { x: b.x + (b.width - S) / 2, y: b.y, width: S, height: b.height } });
  }
  if (opts.scene) await page.locator('#stage').screenshot({ path: out + '/' + opts.scene + '.png' }); // the whole stage
  console.log('shot', name);
  await ctx.close();
}
const runDone = (page) => page.waitForFunction(() => !document.querySelector('#run-btn').disabled && document.querySelector('#run-result').textContent.length > 0, null, { timeout: 240000 });
const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const want = (n) => !only || only.includes(n);
const seen = { intro: 1 };
if (want('intro')) await shot('intro', 1280, 800, null);
// level 1: run, then skip the casino replay to its end (a click on the stage)
const skipToEnd = async (p) => { await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(400); await p.locator('#stage').click(); await p.waitForTimeout(2600); };
if (want('campaign')) await shot('campaign', 1280, 860, skipToEnd, { state: { ...seen, level: 'slots' }, scene: 'casino' });
// the canyon: the first training episode, a few seconds in
// (a scene's clock starts when the stage is on screen)
if (want('canyon')) await shot('canyon', 1280, 860, async (p) => { await p.click('#run-btn'); await runDone(p); await p.locator('#scene-watch').click(); await p.locator('#stage').scrollIntoViewIfNeeded(); await p.waitForTimeout(2800); }, { state: Object.assign({ level: 'cliff' }, seen), scene: 'canyon' });
// the broom: CartPole with too many cells falls fast
if (want('broom')) await shot('broom', 1280, 860, async (p) => { await p.click('#run-btn'); await runDone(p); await p.locator('#scene-watch').click(); await p.locator('#stage').scrollIntoViewIfNeeded(); await p.waitForTimeout(1300); }, { state: Object.assign({ level: 'cells' }, seen), scene: 'broom' });
if (want('workbench')) await shot('workbench', 1280, 860, async (p) => {
  await p.click('#tabs button[data-mode="workbench"]'); await p.waitForTimeout(300);
  await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(800);
}, { state: Object.assign({ mode: 'workbench' }, seen) });
if (want('settings')) await shot('settings', 1280, 860, async (p) => { await p.click('#settings-btn'); await p.selectOption('#ai-provider', 'anthropic'); await p.waitForTimeout(200); }, { state: seen });
if (want('phone')) await shot('phone', 390, 844, async (p) => { await skipToEnd(p); await p.locator('#stage').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -60)); }, { state: { ...seen, level: 'slots' }, dark: true });
if (want('codex')) await shot('codex', 1280, 860, async (p) => { await p.click('#tabs button[data-mode="codex"]'); await p.waitForTimeout(400); },
  { state: Object.assign({ mode: 'codex', found: ['egreedy', 'lockin', 'qlearning', 'sarsa', 'triad', 'dqn', 'maxbias', 'doubleq', 'ppo', 'grpo', 'sac', 'iql', 'expo', 'recap'] }, seen) });
if (want('fetch')) await shot('fetch', 1280, 860, async (p) => {
  await p.locator('[data-campaign-run]').evaluate((button) => button.click()); await runDone(p); await p.waitForTimeout(400);
  const box = await p.locator('#stage').boundingBox();
  await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.2); await p.waitForTimeout(3500);
}, { state: Object.assign({ level: 'fetch', unlockAll: true, lstep: { fetch: 1 } }, seen), stage: true });
if (want('fetchfix')) await shot('fetchfix', 1280, 860, async (p) => {
  await p.selectOption('#rk-shaping', '2');
  await p.evaluate(() => { const e = document.querySelector('#rk-facingW'); e.value = '0'; e.dispatchEvent(new Event('change')); });
  await p.click('text=Run this sentence'); await runDone(p); await p.waitForTimeout(800);
  const box = await p.locator('#stage').boundingBox();
  await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.25); await p.waitForTimeout(3500);
}, { state: Object.assign({ level: 'fetch', unlockAll: true, lstep: { fetch: 3 } }, seen), stage: true });
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
