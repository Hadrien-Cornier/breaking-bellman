// Bounded owner regression. Uses the real shell when present, legacy Notes otherwise.
// node test/ui/ensemble-notes.mjs EXTERNAL_PROOF_DIR [URL] [--expect-empty]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [out, target = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
if (!out) throw Error('Pass an external proof directory');
fs.mkdirSync(out, { recursive: true });
const baseline = process.argv.includes('--expect-empty');
const script = async () => {
  const check = (value, label) => { if (!value) throw Error(label); };
  await page.open(TARGET);
  await page.eval(() => { localStorage.removeItem('breaking-bellman-v1'); });
  await page.open(TARGET);
  await page.eval(() => { document.querySelector('dialog.intro button')?.click(); bellman.level('ensemble'); });
  const openNotes = async () => {
    await page.eval(() => {
      const shell = document.querySelector('#custom-notebook');
      if (shell) { shell.open = true; document.querySelector('#custom-notebook-tab-notes').click(); }
      else [...document.querySelectorAll('#ensemble-lesson details')].find(d => d.querySelector('summary').textContent === 'notes').open = true;
    });
  };
  const observe = () => page.eval(() => {
    const panel = document.querySelector('#custom-notebook-notes') || [...document.querySelectorAll('#ensemble-lesson details')].find(d => d.querySelector('summary').textContent === 'notes').lastElementChild;
    return { text: panel.innerText, height: panel.getBoundingClientRect().height, hidden: panel.hidden,
      selected: document.querySelector('#custom-notebook-tab-notes')?.getAttribute('aria-selected') || 'legacy-open',
      cards: [...panel.querySelectorAll('.step')].map(e => e.id), record: BBENSEMBLE_LEVEL.record() };
  });
  await openNotes();
  const initial = await observe();
  check(!initial.record && !initial.hidden, 'initial Notes has no measured record');
  if (BASELINE) {
    check(initial.height === 0 && initial.text === '', 'original empty Notes reproduced');
    await page.eval(() => {
      const panel = document.querySelector('#custom-notebook-notes') || [...document.querySelectorAll('#ensemble-lesson details')].find(d => d.querySelector('summary').textContent === 'notes').lastElementChild;
      const p = document.createElement('p'); p.id = 'notes-counterfactual'; p.className = 'small'; p.textContent = 'Lesson notes appear here.'; panel.append(p);
    });
    const added = await observe();
    check(added.height > 0 && added.text === 'Lesson notes appear here.' && !added.record, 'placeholder alone restores visible Notes');
    await page.eval(() => document.querySelector('#notes-counterfactual').remove());
    const removed = await observe();
    check(removed.height === 0 && removed.text === '' && !removed.record, 'removing placeholder restores original failure');
    console.log(JSON.stringify({ initial, added, removed })); return;
  }
  const rows = [];
  const notes = async (phase, cards, record) => {
    await openNotes(); const row = await observe();
    check(row.height > 0 && !row.hidden && (row.selected === 'true' || row.selected === 'legacy-open'), phase + ': Notes visible');
    check(JSON.stringify(row.cards) === JSON.stringify(cards), phase + ': actual completed cards only');
    check(cards.length ? !row.text.includes('Lesson notes appear here.') : row.text === 'Lesson notes appear here.', phase + ': guidance replaced by completed content');
    check(JSON.stringify(row.record) === JSON.stringify(record), phase + ': record unchanged');
    rows.push({ phase, ...row });
  };
  await notes('initial', [], null);
  await page.eval(() => { bellman.level('cliff'); bellman.level('ensemble'); });
  await notes('re-entry before completion', [], null);
  await page.click('#ensemble-p-0');
  await notes('incorrect prediction', [], null);
  await page.fill('#ensemble-coefficient', '0.5');
  await notes('settings before completion', [], null);
  await page.click('#ensemble-p-1');
  const predict = ['ensemble-step-predict'];
  await notes('correct prediction', predict, null);
  await page.click('#ensemble-run');
  const record = await page.eval(() => BBENSEMBLE_LEVEL.record());
  check(record.metrics.mean.trueReturn === 0 && record.metrics.penalty.trueReturn === 1, 'real Run outcomes');
  const ran = [...predict, 'ensemble-step-run'];
  await notes('Run', ran, record);
  await page.fill('#ensemble-coefficient', '0');
  check(await page.eval(() => BBENSEMBLE_LEVEL.replay().stale), 'setting marks record stale');
  await notes('stale settings', ran, record);
  await page.click('#ensemble-recompute');
  const fresh = await page.eval(() => BBENSEMBLE_LEVEL.record());
  check(fresh.id !== record.id && fresh.metrics.penalty.trueReturn === 0, 'rerun executes changed setting');
  await notes('rerun', ran, fresh);
  await page.click('#ensemble-restore'); await page.click('#ensemble-recompute');
  await page.click('#ensemble-d-0');
  await page.click('#ensemble-wrong'); await page.click('#ensemble-high');
  await page.click('#ensemble-x-1'); await page.click('#ensemble-complete');
  const all = [...ran, 'ensemble-step-diagnose', 'ensemble-step-repair', 'ensemble-step-explain'];
  await notes('completed', all, await page.eval(() => BBENSEMBLE_LEVEL.record()));
  await page.eval(() => { bellman.level('cliff'); bellman.level('ensemble'); });
  await notes('re-entry with completed progress', all, null);
  console.log(JSON.stringify({ scope: documentLabel(rows[0]), rows }));
  function documentLabel(row) { return row.selected === 'legacy-open' ? 'legacy Notes fallback; integrated shell gate pending' : 'canonical shell Notes'; }
};
const input = `const TARGET = ${JSON.stringify(target)}; const BASELINE = ${baseline};\nawait (${script})();`;
const result = execFileSync('chrome-devtools-axi', ['run'], {
  input, encoding: 'utf8', timeout: 60000,
  env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: process.env.CHROME_DEVTOOLS_AXI_SESSION || 'bb-phase2-ensemble226-notes' },
});
fs.writeFileSync(path.join(out, baseline ? 'baseline-counterfactual.json' : 'notes-lifecycle.json'), result);
console.log(baseline ? 'Original empty Notes and add/remove counterfactual passed.' : 'Ensemble Notes lifecycle passed; full integrated shell/smoke remains pending.');
