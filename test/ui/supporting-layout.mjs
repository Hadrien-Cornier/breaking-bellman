// Focused regression: the supporting Notebook must remain clickable below the lab.
// node build.mjs && node test/ui/supporting-layout.mjs EXTERNAL_PROOF_DIR [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
if (!proof) throw Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: process.env.CHROME_DEVTOOLS_AXI_SESSION || 'bb-supporting-layout' };
const cli = (...args) => execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', env, timeout: 60000, maxBuffer: 2 ** 22 });
const click = selector => execFileSync('chrome-devtools-axi', ['run'], {
  input: `await page.click(${JSON.stringify(selector)});`, encoding: 'utf8', env, timeout: 60000,
});
function evaluate(fn) {
  const output = cli('eval', String(fn)), match = output.match(/^result: (.+)$/m);
  if (!match) throw Error(output);
  const value = JSON.parse(match[1]);
  return typeof value === 'string' ? JSON.parse(value) : value;
}
cli('open', url);
evaluate(() => { localStorage.setItem('breaking-bellman-v1', JSON.stringify({ intro: 1, level: 'cliff' })); return true; });
cli('open', url);
const results = [];
for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
  const name = `${width}-${theme}`;
  cli('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
  // Mobile emulation may reload the page, so establish an actual run in each case.
  evaluate(() => { localStorage.setItem('breaking-bellman-v1', JSON.stringify({ intro: 1, level: 'cliff' })); return true; });
  cli('open', url);
  click('#tabs [data-mode="workbench"]');
  evaluate(() => {
    bellman.world('mirage');
    bellman.words({ store: 'net', data: 'latest', picker: 'live', scorer: 'live', nstep: 4, eps: false, step: 'avg' });
    document.querySelector('#run-mode').value = 'live';
    return true;
  });
  click('#run-btn');
  const began = Date.now(), timeout = Number(process.env.BB_UI_RUN_TIMEOUT_MS) || 3600000;
  while (!evaluate(() => !!bellman.record() && !document.querySelector('#run-btn').disabled)) {
    if (Date.now() - began > timeout) throw Error('Mirage measured run timed out');
    cli('wait', '1000');
  }
  // A first discovery queues its celebration after 120ms. Dismiss it through
  // normal keyboard input before testing the layout underneath.
  cli('wait', '250');
  cli('press', 'Escape');
  const dismissBegan = Date.now();
  while (evaluate(() => !!document.querySelector('.dc'))) {
    if (Date.now() - dismissBegan > 5000) throw Error('Discovery celebration did not close');
    cli('wait', '50');
  }
  const hit = evaluate(() => {
    const button = [...document.querySelectorAll('#wonder button')].find(e => e.textContent === 'Show me the chart');
    if (!button) throw Error('Measured Mirage run must produce the chart question');
    button.id = 'supporting-chart-link';
    button.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const record = bellman.record();
    return { hit: target === button || button.contains(target), target: target?.id, rect: rect.toJSON(),
      overflow: document.documentElement.scrollWidth > innerWidth,
      record: record.id, world: record.world, source: record.source,
      result: document.querySelector('#run-result').textContent,
      text: document.querySelector('#wonder').innerText };
  });
  cli('screenshot', path.join(proof, name + '-before-click.png'));
  // Avoid a long click timeout on the known broken baseline; retain the failed hit-test.
  if (hit.hit) click('#supporting-chart-link');
  const chart = evaluate(() => {
    const wrap = document.querySelector('.chart-wrap.look'), rect = wrap?.getBoundingClientRect();
    return { activated: !!wrap, visible: !!rect && rect.top < innerHeight && rect.bottom > 0,
      sameRecord: bellman.record().id === document.querySelector('#stage').dataset.run };
  });
  cli('screenshot', path.join(proof, name + '-chart.png'));
  const consoleErrors = cli('console', '--type', 'error');
  fs.writeFileSync(path.join(proof, name + '-console.txt'), consoleErrors);
  results.push({ name, ...hit, chart, consoleErrors });
  fs.writeFileSync(path.join(proof, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
  // Each case must activate the chart itself, rather than inherit the previous case.
  evaluate(() => { document.querySelectorAll('.chart-wrap.look').forEach(e => e.classList.remove('look')); return true; });
}
fs.writeFileSync(path.join(proof, 'console.txt'), cli('console'));
for (const result of results) {
  assert.ok(result.hit, result.name + ': chart link center must receive real input');
  assert.ok(result.chart.activated && result.chart.visible, result.name + ': real click reveals the measured chart');
  assert.ok(result.chart.sameRecord, result.name + ': measured stage identity survives chart navigation');
  assert.ok(result.rect.height >= 44 && result.rect.width >= 44, result.name + ': touch target');
  assert.ok(!result.overflow, result.name + ': no horizontal overflow');
  assert.ok(result.consoleErrors.includes('<no console messages found>'), result.name + ': no application console errors');
}
console.log('PASS supporting Notebook chart clicks at desktop/phone in both themes');
