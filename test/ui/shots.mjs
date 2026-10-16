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
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  if (opts.state) await page.addInitScript((st) => { try { localStorage.setItem('breaking-bellman-v1', JSON.stringify(st)); } catch (e) {} }, opts.state);
  await page.goto('file://' + page0);
  await page.waitForTimeout(400);
  if (fn) await fn(page);
  await page.screenshot({ path: out + '/' + name + '.png', fullPage: !!opts.full });
  console.log('shot', name);
  await ctx.close();
}
const runDone = (page) => page.waitForFunction(() => !document.querySelector('#run-btn').disabled && document.querySelector('#run-result').textContent.length > 0, null, { timeout: 240000 });
const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const want = (n) => !only || only.includes(n);
const seen = { intro: 1 };
if (want('intro')) await shot('intro', 1280, 800, null);
if (want('campaign')) await shot('campaign', 1280, 860, async (p) => { await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(800); }, { state: seen });
if (want('workbench')) await shot('workbench', 1280, 860, async (p) => {
  await p.click('#tabs button[data-mode="workbench"]'); await p.waitForTimeout(300);
  await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(800);
}, { state: Object.assign({ mode: 'workbench' }, seen) });
if (want('settings')) await shot('settings', 1280, 860, async (p) => { await p.click('#settings-btn'); await p.selectOption('#ai-provider', 'anthropic'); await p.waitForTimeout(200); }, { state: seen });
if (want('phone')) await shot('phone', 390, 844, async (p) => { await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(600); }, { state: seen, dark: true });
if (want('codex')) await shot('codex', 1280, 860, async (p) => { await p.click('#tabs button[data-mode="codex"]'); await p.waitForTimeout(400); },
  { state: Object.assign({ mode: 'codex', found: ['egreedy', 'lockin', 'qlearning', 'sarsa', 'triad', 'dqn', 'maxbias', 'doubleq', 'ppo', 'grpo', 'sac', 'iql', 'expo', 'recap'] }, seen) });
if (want('fetch')) await shot('fetch', 1280, 860, async (p) => {
  await p.evaluate(() => window.__bbGoto && window.__bbGoto('fetch')); await p.waitForTimeout(300);
  await p.click('#run-btn'); await runDone(p); await p.waitForTimeout(1500);
}, { state: seen });
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
