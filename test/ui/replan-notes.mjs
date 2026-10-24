// Bounded owner regression on the pre-shell branch. The fixture supplies only
// ctx.shell's mounted content containers; integrated tabs remain a shell gate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const url = new URL('../../dist/breaking-bellman.html', import.meta.url).href;
const script = `
const check = (ok, message) => { if (!ok) throw new Error(message); };
await page.open(${JSON.stringify(url)});
await page.eval(() => {
  localStorage.removeItem('breaking-bellman-v1');
});
await page.open(${JSON.stringify(url)});
await page.eval(() => {
  document.querySelector('dialog.intro button')?.click();
  const mount = BBREPLAN.mount;
  BBREPLAN.mount = (pane, lab, api) => {
    document.querySelector('#notes-contract-fixture')?.remove();
    const host = document.createElement('section');
    host.id = 'notes-contract-fixture';
    const panels = {};
    for (const section of ['notes', 'curve', 'rule', 'autopsy']) {
      const panel = document.createElement('div');
      panel.id = 'fixture-' + section;
      host.append(panel); panels[section] = panel;
    }
    pane.after(host);
    mount(pane, lab, { ...api, shell: {
      notebook: section => panels[section],
      conceptSketch: () => document.createElement('figure'),
    } });
  };
  bellman.level('replan');
});
const observations = [];
async function inspect(phase) {
  const value = await page.eval(() => {
    const notes = document.querySelector('#fixture-notes');
    const s = BBREPLAN.state();
    return { text: notes.innerText, height: notes.getBoundingClientRect().height,
      ids: [...notes.children].map(n => n.id), record: s.record,
      stale: s.stale, schedule: s.knobs.schedule };
  });
  observations.push({ phase, ...value });
  console.log(JSON.stringify({ phase, ...value }));
  return value;
}
const initial = await inspect('initial');
check(initial.record === null, 'initial state must be unmeasured');
check(initial.text === 'Lesson notes appear here.' && initial.height > 0,
  'initial Notes must retain visible shell guidance');
await page.click('#replan-p button:nth-of-type(2)');
const prediction = await inspect('prediction');
check(!prediction.text.includes('Lesson notes appear here.'), 'completed prediction replaces guidance');
check(prediction.ids.join() === 'replan-step-predict', 'only completed prediction belongs in Notes');
check(prediction.text.includes('Sound chain.'), 'existing answer feedback survives');
check(prediction.record === null, 'prediction must not fabricate measurement');
await page.click('#replan-run');
const run = await inspect('Run');
check(run.record && run.ids.join() === 'replan-step-predict,replan-step-run', 'Run adds completed step');
const exact = JSON.stringify(run.record);
await page.eval(() => {
  const select = document.querySelector('#replan-schedule');
  select.value = 'zero'; select.dispatchEvent(new Event('change', { bubbles: true }));
});
const settings = await inspect('settings');
check(settings.stale && settings.schedule === 'zero', 'settings must mark measured run stale');
check(JSON.stringify(settings.record) === exact, 'settings preserve original measured record');
check(settings.text === run.text, 'settings preserve completed content');
await page.click('#replan-run');
const rerun = await inspect('rerun');
check(!rerun.stale && rerun.record.id !== run.record.id, 'rerun creates fresh measurement');
check(rerun.text === run.text, 'rerun preserves completed content');
await page.eval(() => { bellman.level('slots'); bellman.level('replan'); });
const reentry = await inspect('re-entry');
check(reentry.record === null && !reentry.stale, 're-entry clears old measurement');
check(reentry.ids.join() === 'replan-step-predict', 're-entry retains only completed prediction before fresh Run');
check(reentry.text.includes('Sound chain.'), 'saved answer feedback survives re-entry');
console.log('PASS Replan Notes initial/prediction/Run/settings/rerun/re-entry');
`;
const result = spawnSync('chrome-devtools-axi', ['run'], {
  input: script, encoding: 'utf8', timeout: 120000,
  env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'bb-phase2-replan236' },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
assert.ifError(result.error);
assert.equal(result.status, 0, 'Chrome Notes regression failed');
assert.match(result.stdout, /PASS Replan Notes/);
