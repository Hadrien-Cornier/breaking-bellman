// Desktop, phone, keyboard, and save proof for the visit-count lesson.
// node test/ui/rare.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8771/'] = process.argv.slice(2);
if (!proof) throw Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'bb-rare200', CHROME_DEVTOOLS_AXI_PORT: process.env.CHROME_DEVTOOLS_AXI_PORT || '10199' };
function cli(...args) {
  return execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', env, timeout: 60000, maxBuffer: 2 ** 22 });
}
function evaluate(js) {
  const text = cli('eval', js);
  const match = text.match(/^result: (.+)$/m);
  if (!match) throw Error(text);
  const result = JSON.parse(match[1]);
  return typeof result === 'string' ? JSON.parse(result) : result;
}
function check(ok, text) {
  if (!ok) throw Error(text);
  console.log('ok ' + text);
}
const OLD = {
  found: ['egreedy'],
  given: [],
  seen: [],
  done: ['slots', 'cliff'],
  answers: { 'slots-p': { choice: 1, correct: false, ts: '2020-01-01T00:00:00.000Z' } },
  missions: [],
  saved: [],
  mode: 'campaign',
  level: 'cliff',
  lstep: { slots: 5, cliff: 4 },
  made: {},
  reviews: {},
  unlockAll: false,
  discoveries: {},
  recapDismissed: ['egreedy'],
  wondered: {},
  intro: 1,
};

cli('open', url);
evaluate(`() => { localStorage.setItem('breaking-bellman-v1', ${JSON.stringify(JSON.stringify(OLD))}); return true; }`);
cli('open', url);
const restored = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const cliff = bellman.levels().find(l => l.id === 'cliff');
  const rare = bellman.levels().find(l => l.id === 'rare');
  const heading = document.querySelector('#mode-pane h2')?.innerText || '';
  return {
    keys: Object.keys(saved).sort(),
    done: saved.done,
    lstep: saved.lstep,
    answer: saved.answers['slots-p'],
    recap: saved.recapDismissed,
    cliffDone: cliff.done,
    cliffStep: cliff.step,
    rareDone: rare.done,
    heading,
    explain: /Explain why it works/.test(document.querySelector('#mode-pane').innerText),
  };
}`);
check(restored.done.join() === 'slots,cliff' && restored.rareDone === false, 'old save keeps prior completions and does not invent rare');
check(restored.lstep.cliff === 4 && restored.lstep.slots === 5 && !restored.lstep.rare, 'old lstep values stay');
check(restored.answer.choice === 1 && restored.answer.correct === false, 'old answer stays');
check(restored.recap.join() === 'egreedy', 'old unlock dismissal stays');
check(restored.cliffDone && restored.cliffStep === 'explain' && restored.explain, 'cliff reopens on its saved explain step');
fs.writeFileSync(path.join(proof, 'old-save-keys.json'), JSON.stringify(restored.keys, null, 2));

cli('emulate', '--viewport', '1280x900x1', '--color-scheme', 'light');
evaluate(`() => { bellman.level('rare'); return true; }`);
const predict = evaluate(`() => {
  const button = document.querySelector('#rare-predict .opt');
  button.focus();
  return { active: document.activeElement === button, text: button.innerText };
}`);
check(/stays near the start/.test(predict.text) && predict.active, 'predict choice is focused');
cli('press', 'Enter');
const afterKey = evaluate(`() => ({
  run: !!document.querySelector('#rare-run-plain'),
  why: /Sound chain/.test(document.querySelector('#rare-predict .why')?.innerText || ''),
  overflow: document.documentElement.scrollWidth > innerWidth,
  rules: document.querySelector('#rare-rules')?.innerText || '',
  labHidden: document.querySelector('#lab').hidden,
  customHidden: document.querySelector('#vpo-lab').hidden,
  vpo: !!document.querySelector('#vpo-lesson'),
  goal: ${JSON.stringify('Same 80 steps and the same random draws: the door stays shut without the visit bonus, and it opens with the bonus. The environment reward stays separate from 1/sqrt(n(s)).')},
})`);
check(afterKey.run && afterKey.why, 'Enter answers the focused prediction');
check(!afterKey.overflow && afterKey.labHidden && !afterKey.customHidden && !afterKey.vpo, 'rare uses its own lab at 1280');
check(afterKey.rules.includes(afterKey.goal), 'rules state the rare objective');

evaluate(`() => { document.querySelector('#rare-run-plain').click(); return true; }`);
const plain = evaluate(`() => {
  const text = document.querySelector('#rare-plain')?.innerText || '';
  return {
    text,
    map: document.querySelectorAll('#rare-map-off .cell').length,
    bonusHidden: !document.querySelector('#rare-bonus'),
  };
}`);
check(plain.map === 8 && /Door openings: 0/.test(plain.text) && plain.bonusHidden, 'plain run shows eight cells and zero door openings');

evaluate(`() => {
  const choice = [...document.querySelectorAll('#rare-diagnose .opt')].find(b => /still 0/.test(b.innerText));
  choice.click();
  document.querySelector('#rare-run-bonus').focus();
  return document.activeElement === document.querySelector('#rare-run-bonus');
}`);
check(evaluate(`() => document.activeElement?.id === 'rare-run-bonus'`), 'the repair button is focused');
cli('press', 'Enter');
const desktopTable = evaluate(`() => document.querySelector('#rare-rewards')?.innerText || ''`);
check(/No bonus/.test(desktopTable) && /Count bonus in the backup/.test(desktopTable), 'the backup table is on screen before the explanation');

const explain = evaluate(`() => {
  const options = [...document.querySelectorAll('#rare-explain .opt')];
  options.find(b => /same integer/.test(b.innerText)).click();
  const wrong = document.querySelector('#rare-complete').disabled;
  options.find(b => /density model/.test(b.innerText)).click();
  const ready = !document.querySelector('#rare-complete').disabled;
  document.querySelector('#rare-complete').click();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  return {
    wrong, ready,
    done: saved.done,
    lstep: saved.lstep,
    answer: saved.answers['slots-p'],
    keys: Object.keys(saved).sort(),
    next: document.querySelector('#rare-next')?.innerText || '',
  };
}`);
check(explain.wrong && explain.ready, 'only the density-model explanation finishes the lesson');
check(explain.done.join() === 'slots,cliff,rare', 'completion appends rare without dropping old ids');
check(explain.lstep.cliff === 4 && explain.lstep.rare === 5 && explain.lstep.slots === 5, 'new lstep is added beside the old ones');
check(explain.answer.choice === 1 && explain.keys.join() === restored.keys.join(), 'answers stay and the save keeps the same keys');
check(/Next level: Two good ways/.test(explain.next), 'next control names the following level');
evaluate(`() => { document.querySelector('#rare-rewards').scrollIntoView({ block: 'start' }); return true; }`);
cli('screenshot', path.join(proof, 'rare-1280-light.png'));

evaluate(`() => { document.querySelector('#rare-next').click(); return true; }`);
const next = evaluate(`() => ({
  id: bellman.levels().find(l => l.title === 'Two good ways').id,
  world: bellman.state().world,
  title: document.querySelector('#mode-pane h2')?.innerText || '',
  rules: document.querySelector('#game-rules')?.innerText || '',
  inline: document.querySelector('#challenge-rules')?.innerText || '',
  labHidden: document.querySelector('#lab').hidden,
  customHidden: document.querySelector('#vpo-lab').hidden,
  rareLeft: !!document.querySelector('#rare-rules'),
  overflow: document.documentElement.scrollWidth > innerWidth,
})`);
check(next.id === 'twoways' && next.world === 'fork' && next.title === 'Two good ways', 'next level is the fork world');
check(next.rules.includes('keep at least 10 commands per decision') && next.rules === next.inline, 'fork rules replace the hallway rules');
check(!next.labHidden && next.customHidden && !next.rareLeft && !next.overflow, 'the standard lab is back for the next level');

const downloaded = evaluate(`() => {
  const Orig = window.Blob;
  function RecordingBlob(parts, opts) {
    const blob = new Orig(parts, opts);
    if (parts && typeof parts[0] === 'string' && parts[0].includes('"app": "breaking-bellman"')) window.__downloadText = parts[0];
    return blob;
  }
  RecordingBlob.prototype = Orig.prototype;
  window.Blob = RecordingBlob;
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Download save file'));
  button.click();
  return { text: window.__downloadText || '' };
}`);
check(downloaded.text.includes('"app": "breaking-bellman"') && downloaded.text.includes('"rare"'), 'Download save file writes the progress file');
const savePath = path.join(proof, 'exported-save.json');
fs.writeFileSync(savePath, downloaded.text);
evaluate(`() => { localStorage.clear(); return !localStorage.getItem('breaking-bellman-v1'); }`);
cli('open', url);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Load progress file');
  input.style.position = 'fixed';
  input.style.left = '8px';
  input.style.top = '8px';
  input.style.opacity = '1';
  return input.type;
}`);
const snap = cli('snapshot', '--full');
fs.writeFileSync(path.join(proof, 'file-input-snapshot.txt'), snap);
const uidLine = snap.split('\n').find((line) => /uid=/.test(line) && /Load progress file/.test(line));
if (!uidLine) throw Error('file input missing from snapshot');
const uid = uidLine.match(/uid=(g\d+:\S+)/)[1];
cli('upload', '@' + uid, savePath);
cli('wait', '1200');
function savedRare() {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const got = evaluate(`() => {
        const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1') || 'null');
        if (!saved) return { missing: true };
        bellman.level('rare');
        return {
          done: saved.done,
          lstep: saved.lstep,
          answer: saved.answers['slots-p'].choice,
          heading: document.querySelector('#mode-pane h2')?.innerText || '',
          complete: document.querySelector('#rare-complete')?.innerText || '',
        };
      }`);
      if (!got.missing) return got;
    } catch (e) { last = e; }
    cli('wait', '400');
  }
  if (last) throw last;
  return { missing: true };
}
const roundTrip = savedRare();
check(!roundTrip.missing && roundTrip.done.join() === 'slots,cliff,rare' && roundTrip.lstep.rare === 5 && roundTrip.lstep.cliff === 4, 'file input reload keeps old progress and the new completion');
check(roundTrip.answer === 1 && roundTrip.heading === 'A bonus for a rare cell', 'imported save reopens the hallway lesson');
cli('open', url);
const second = savedRare();
check(!second.missing && second.done.join() === 'slots,cliff,rare' && second.lstep.rare === 5 && second.lstep.cliff === 4 && second.answer === 1, 'a second reload keeps the imported completion');
fs.writeFileSync(path.join(proof, 'round-trip.json'), JSON.stringify({ firstReload: roundTrip, secondReload: second }, null, 2));

cli('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'dark');
evaluate(`() => { bellman.level('rare'); return true; }`);
evaluate(`() => {
  document.querySelector('#rare-predict .opt').click();
  return true;
}`);
evaluate(`() => { document.querySelector('#rare-run-plain').click(); return true; }`);
evaluate(`() => {
  const choice = [...document.querySelectorAll('#rare-diagnose .opt')].find(b => /still 0/.test(b.innerText));
  choice.click();
  document.querySelector('#rare-run-bonus').focus();
  return document.activeElement === document.querySelector('#rare-run-bonus');
}`);
check(evaluate(`() => document.activeElement?.id === 'rare-run-bonus'`), 'the repair button is focused on the phone');
cli('press', 'Enter');
const phone = evaluate(`() => {
  const cell = document.querySelector('#rare-map-on .cell');
  cell.focus();
  return { active: document.activeElement === cell };
}`);
check(phone.active, 'a visit cell can take focus on the phone');
cli('press', 'Enter');
const measured = evaluate(`() => {
  const root = document.querySelector('#rare-lesson').innerText;
  const rewards = document.querySelector('#rare-rewards').innerText;
  return {
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    cell: document.querySelector('#rare-cell')?.innerText || '',
    rewards,
    rootHasDash: root.includes('—'),
    finishDisabled: document.querySelector('#rare-complete')?.disabled,
  };
}`);
check(measured.width === 390 && measured.scroll <= 390, 'no horizontal overflow at 390');
check(/not the environment reward|unseen/.test(measured.cell), 'Enter reads a cell count');
check(/No bonus/.test(measured.rewards) && /Action-score bonus only/.test(measured.rewards) && /Count bonus in the backup/.test(measured.rewards), 'reward table separates the backup from the side score');
check(!measured.rootHasDash && measured.finishDisabled, 'copy has no em dash and finish waits for the explanation');
fs.writeFileSync(path.join(proof, 'phone-rewards.txt'), measured.rewards);
cli('screenshot', path.join(proof, 'rare-390-dark.png'));
const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('rare UI checks passed');
