// Desktop, phone, keyboard, and save proof for the two-bit conditional lesson.
// node test/ui/autoreg.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8791/'] = process.argv.slice(2);
if (!proof) throw Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'bb-autoreg200', CHROME_DEVTOOLS_AXI_PORT: process.env.CHROME_DEVTOOLS_AXI_PORT || '10221' };
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
  const autoreg = bellman.levels().find(l => l.id === 'autoreg');
  const ids = bellman.levels().map(l => l.id);
  return {
    keys: Object.keys(saved).sort(),
    done: saved.done,
    lstep: saved.lstep,
    answer: saved.answers['slots-p'],
    recap: saved.recapDismissed,
    cliffDone: cliff.done,
    cliffStep: cliff.step,
    autoregDone: autoreg.done,
    order: ids.slice(0, 3),
    last: ids.at(-1),
    bins: (window.CONTENT.missions || []).some(m => m.id === 'bins' && m.world === 'cartpole'),
  };
}`);
check(restored.done.join() === 'slots,cliff' && restored.autoregDone === false, 'old save keeps prior completions and does not invent autoreg');
check(restored.lstep.cliff === 4 && restored.lstep.slots === 5 && !restored.lstep.autoreg, 'old lstep values stay');
check(restored.answer.choice === 1 && restored.answer.correct === false, 'old answer stays');
check(restored.recap.join() === 'egreedy', 'old unlock dismissal stays');
check(restored.cliffDone && restored.cliffStep === 'explain', 'cliff reopens on its saved explain step');
check(restored.order.join() === 'goals,autoreg,slots' && restored.last !== 'autoreg' && restored.bins, 'autoreg sits after goals and bins stays cartpole');
fs.writeFileSync(path.join(proof, 'old-save-keys.json'), JSON.stringify(restored.keys, null, 2));

cli('emulate', '--viewport', '1280x900x1', '--color-scheme', 'light');
evaluate(`() => { bellman.level('autoreg'); return true; }`);
const predict = evaluate(`() => {
  const button = document.querySelector('#autoreg-p .opt');
  button.focus();
  return { active: document.activeElement === button, text: button.innerText };
}`);
check(/Half the time/.test(predict.text) && predict.active, 'predict choice is focused');
cli('press', 'Enter');
const afterKey = evaluate(`() => ({
  run: !!document.querySelector('#autoreg-run') && !document.querySelector('#autoreg-run').disabled,
  why: /Sound chain/.test(document.querySelector('#autoreg-p .why')?.innerText || ''),
  overflow: document.documentElement.scrollWidth > innerWidth,
  rules: document.querySelector('#autoreg-rules')?.innerText || '',
  labHidden: document.querySelector('#lab').hidden,
  customHidden: document.querySelector('#vpo-lab').hidden,
  goal: ${JSON.stringify('Fit these pair counts once. The separate-bit draw puts probability 1/2 on 01 or 10. The conditional draw puts probability 0 on those pairs and keeps probability 1/2 on 11.')},
  conditionalHidden: !document.querySelector('#autoreg-conditional'),
})`);
check(afterKey.run && afterKey.why, 'Enter answers the focused prediction');
check(!afterKey.overflow && afterKey.labHidden && !afterKey.customHidden, 'autoreg uses its own lab at 1280');
check(afterKey.rules.includes(afterKey.goal) && afterKey.conditionalHidden, 'rules state the conditional objective and the repair stays closed');

evaluate(`() => { document.querySelector('#autoreg-run').focus(); return document.activeElement.id; }`);
cli('press', 'Enter');
const independent = evaluate(`() => document.querySelector('#autoreg-independent-theory-independent')?.innerText || ''`);
check(/Unseen-pair probability 1\/2/.test(independent) && /Theoretical independent/.test(independent), 'independent theory is 1/2 from the counts');
const noConditionalYet = evaluate(`() => !document.querySelector('#autoreg-conditional-theory-conditional')`);
check(noConditionalYet, 'the conditional line waits for the repair');

evaluate(`() => {
  const choice = document.querySelector('#autoreg-d .opt');
  choice.focus();
  return /own marginal/.test(choice.innerText);
}`);
cli('press', 'Enter');
evaluate(`() => { document.querySelector('#autoreg-repair').focus(); return document.activeElement.id; }`);
cli('press', 'Enter');
const repaired = evaluate(`() => ({
  conditional: document.querySelector('#autoreg-conditional-theory-conditional')?.innerText || '',
  empirical: document.querySelector('#autoreg-conditional-empirical-conditional')?.innerText || '',
  unsupported: document.querySelector('#autoreg-unsupported-text')?.innerText || '',
  swap: document.querySelector('#autoreg-swap-theory-conditional')?.innerText || '',
})`);
check(/00 1\/2/.test(repaired.conditional) && /11 1\/2/.test(repaired.conditional) && /Unseen-pair probability 0/.test(repaired.conditional), 'conditional theory keeps half on 00 and 11');
check(/11 \d+/.test(repaired.empirical) && !/00 2000, 01 0, 10 0, 11 0/.test(repaired.empirical), 'empirical conditional still emits 11');
check(/No second bit was drawn/.test(repaired.unsupported), 'an unseen first bit draws no second bit');
check(/01 1\/2/.test(repaired.swap) && /10 1\/2/.test(repaired.swap), 'swapped notes move the half mass');

const explain = evaluate(`() => {
  const options = [...document.querySelectorAll('#autoreg-x .opt')];
  options.find(b => /always returns 00/.test(b.innerText)).click();
  const wrong = document.querySelector('#autoreg-complete').disabled;
  options.find(b => /00 and 11 each keep/.test(b.innerText)).click();
  const ready = !document.querySelector('#autoreg-complete').disabled;
  document.querySelector('#autoreg-complete').click();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  return {
    wrong, ready,
    done: saved.done,
    lstep: saved.lstep,
    answer: saved.answers['slots-p'],
    keys: Object.keys(saved).sort(),
    next: document.querySelector('#autoreg-next')?.innerText || '',
  };
}`);
check(explain.wrong && explain.ready, 'only the half-mass explanation finishes the lesson');
check(explain.done.join() === 'slots,cliff,autoreg', 'completion appends autoreg without dropping old ids');
check(explain.lstep.cliff === 4 && explain.lstep.autoreg === 5 && explain.lstep.slots === 5, 'new lstep is added beside the old ones');
check(explain.answer.choice === 1 && explain.keys.join() === restored.keys.join(), 'answers stay and the save keeps the same keys');
check(/Next level: Ten slot machines/.test(explain.next), 'next control names the following level');
cli('screenshot', path.join(proof, 'autoreg-1280-light.png'));

evaluate(`() => { document.querySelector('#autoreg-next').click(); return true; }`);
const next = evaluate(`() => ({
  id: bellman.levels().find(l => l.title === 'Ten slot machines').id,
  world: bellman.state().world,
  title: document.querySelector('#mode-pane h2')?.innerText || '',
  autoregLeft: !!document.querySelector('#autoreg-rules'),
  labHidden: document.querySelector('#lab').hidden,
  customHidden: document.querySelector('#vpo-lab').hidden,
  overflow: document.documentElement.scrollWidth > innerWidth,
})`);
check(next.id === 'slots' && next.world === 'bandit' && next.title === 'Ten slot machines', 'next level is the slot machines');
check(!next.autoregLeft && !next.labHidden && next.customHidden && !next.overflow, 'the standard lab is back for the next level');

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
check(downloaded.text.includes('"app": "breaking-bellman"') && downloaded.text.includes('"autoreg"') && downloaded.text.includes('"cliff"'), 'Download save file writes the progress file');
const savePath = path.join(proof, 'exported-save.json');
fs.writeFileSync(savePath, downloaded.text);
const uploadPath = path.join(process.cwd(), 'dist', 'autoreg-save-upload.json');
fs.writeFileSync(uploadPath, downloaded.text);
evaluate(`() => { localStorage.clear(); return !localStorage.getItem('breaking-bellman-v1'); }`);
cli('open', url);
cli('press', 'Escape');
cli('wait', '400');
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
cli('upload', '@' + uid, uploadPath);
cli('wait', '1200');
function savedLesson() {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const got = evaluate(`() => {
        const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1') || 'null');
        if (!saved) return { missing: true };
        bellman.level('autoreg');
        return {
          done: saved.done,
          lstep: saved.lstep,
          answer: saved.answers['slots-p'].choice,
          heading: document.querySelector('#mode-pane h2')?.innerText || '',
          complete: document.querySelector('#autoreg-complete')?.innerText || '',
        };
      }`);
      if (!got.missing) return got;
    } catch (e) { last = e; }
    cli('wait', '400');
  }
  if (last) throw last;
  return { missing: true };
}
const roundTrip = savedLesson();
check(!roundTrip.missing && roundTrip.done.join() === 'slots,cliff,autoreg' && roundTrip.lstep.autoreg === 5 && roundTrip.lstep.cliff === 4, 'file input reload keeps old progress and the new completion');
check(roundTrip.answer === 1 && roundTrip.heading === 'Sample the second bit given the first' && /Lesson complete/.test(roundTrip.complete), 'imported save reopens the two-bit lesson');
cli('open', url);
const second = savedLesson();
check(!second.missing && second.done.join() === 'slots,cliff,autoreg' && second.lstep.autoreg === 5 && second.lstep.cliff === 4 && second.answer === 1, 'a second reload keeps the imported completion');
fs.writeFileSync(path.join(proof, 'round-trip.json'), JSON.stringify({ firstReload: roundTrip, secondReload: second }, null, 2));

cli('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'dark');
evaluate(`() => { bellman.level('autoreg'); return true; }`);
evaluate(`() => { document.querySelector('#autoreg-p .opt').click(); return true; }`);
evaluate(`() => { document.querySelector('#autoreg-run').click(); return true; }`);
evaluate(`() => { document.querySelector('#autoreg-d .opt').click(); return true; }`);
evaluate(`() => { document.querySelector('#autoreg-repair').focus(); return document.activeElement.id; }`);
check(evaluate(`() => document.activeElement?.id === 'autoreg-repair'`), 'the repair button is focused on the phone');
cli('press', 'Enter');
evaluate(`() => { document.querySelector('#autoreg-pair-00').focus(); return document.activeElement.id; }`);
cli('press', 'Enter');
const phone = evaluate(`() => {
  const root = document.querySelector('#autoreg-lesson').innerText;
  return {
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    read: document.querySelector('#autoreg-pair-read')?.innerText || '',
    rootHasDash: root.includes('\u2014') || root.includes('\u2013'),
    complete: document.querySelector('#autoreg-complete')?.innerText || '',
  };
}`);
check(phone.width === 390 && phone.scroll <= 390, 'no horizontal overflow at 390');
check(/Pair 00 has count 3/.test(phone.read), 'Enter reads a pair count');
check(!phone.rootHasDash && /Lesson complete/.test(phone.complete), 'copy has no em dash and the imported completion is still on the phone');
cli('screenshot', path.join(proof, 'autoreg-390-dark.png'));
const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('autoreg UI checks passed');
