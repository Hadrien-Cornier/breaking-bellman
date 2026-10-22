// Desktop and phone proof for the Dyna lesson.
// node test/ui/dyna.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8777/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-dyna200',
  CHROME_DEVTOOLS_AXI_PORT: '9491',
  CHROME_DEVTOOLS_AXI_USER_DATA_DIR: path.join(proof, 'chrome-profile'),
};
function cli(...args) {
  return execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', env, timeout: 90000, maxBuffer: 2 ** 24 });
}
function evaluate(js) {
  const text = cli('eval', js);
  const match = text.match(/^result: (.+)$/m);
  if (!match) throw new Error(text);
  const result = JSON.parse(match[1]);
  return typeof result === 'string' ? JSON.parse(result) : result;
}
function check(ok, text) {
  if (!ok) throw new Error(text);
  console.log('ok ' + text);
}
function clickText(selector, text) {
  return evaluate(`() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  }`);
}

const OLD_PROGRESS = {
  intro: 1, mode: 'campaign', level: 'cliff',
  done: ['slots'],
  lstep: { slots: 5, cliff: 2 },
  answers: {
    'slots-p': { choice: 1, correct: false, ts: '2020-01-01T00:00:00.000Z' },
    'cliff-p': { choice: 0, correct: true, ts: '2020-01-01T00:00:00.000Z' },
  },
  found: ['egreedy'], given: [], seen: [], missions: [], saved: [], made: {},
  reviews: {}, unlockAll: false, discoveries: {}, wondered: {},
};
const oldText = JSON.stringify({
  app: 'breaking-bellman', version: 1, exported: '2020-01-01T00:00:00.000Z', progress: OLD_PROGRESS,
}, null, 2);
const oldPath = path.join(proof, 'older-progress.json');
const oldUpload = path.join(process.cwd(), 'dist', 'dyna-older-progress.json');
fs.writeFileSync(oldPath, oldText);
fs.writeFileSync(oldUpload, oldText);

function exposeFileInput(label) {
  return evaluate(`() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
    if (!button) return false;
    button.click();
    const input = document.querySelector('input[type=file]');
    if (!input) return false;
    input.id = 'dyna-save-file';
    input.hidden = false;
    input.removeAttribute('hidden');
    input.setAttribute('aria-label', ${JSON.stringify(label)});
    input.style.position = 'fixed';
    input.style.left = '8px';
    input.style.top = '8px';
    input.style.opacity = '1';
    return true;
  }`);
}
function upload(label, filePath) {
  check(exposeFileInput(label), 'load control created a file input for ' + label);
  const snap = cli('snapshot', '--full');
  fs.writeFileSync(path.join(proof, 'load-' + label.replace(/\s+/g, '-') + '.txt'), snap);
  const line = snap.split('\n').find((row) => row.includes(label));
  const uid = line && (line.match(/uid=(\S+)/) || [])[1];
  if (!uid) throw new Error('file input missing from snapshot for ' + label + '\n' + snap.slice(0, 2500));
  cli('upload', '@' + uid, filePath);
  cli('wait', '1500');
}
function savedState() {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      const got = evaluate(`() => {
        const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1') || 'null');
        if (!saved) return { missing: true };
        const levels = bellman.levels();
        return {
          missing: false,
          level: saved.level,
          done: saved.done,
          lstep: saved.lstep,
          slotsAnswer: saved.answers['slots-p'] && saved.answers['slots-p'].choice,
          dyna: !!(levels.find((l) => l.id === 'dyna') || {}).done,
          slots: !!(levels.find((l) => l.id === 'slots') || {}).done,
          cliff: !!(levels.find((l) => l.id === 'cliff') || {}).done,
        };
      }`);
      if (!got.missing) return got;
    } catch (err) { last = err; }
    cli('wait', '400');
  }
  if (last) throw last;
  return { missing: true };
}

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  evaluate(`() => {
    const details = document.querySelector('details.map-card');
    if (details) details.open = true;
    const button = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('Two steps, then the model'));
    if (!button) return false;
    button.click();
    return true;
  }`);
  const opened = evaluate(`() => {
    const details = document.querySelector('details.map-card');
    if (details) details.open = true;
    const nodes = document.querySelectorAll('#mode-pane .node').length;
    const root = document.querySelector('#dyna-lesson');
    const rules = document.querySelector('#dyna-rules');
    return {
      clicked: !!(root && root.innerText.includes('Two steps, then the model')),
      map: !!(details && details.textContent.includes('Two steps, then the model')),
      nodes,
      levels: CONTENT.levels.length,
      notGoals: !document.querySelector('#goals-lesson'),
      notReplan: !document.querySelector('#replan-lesson'),
      notElbo: !document.querySelector('#elbo-lesson'),
      goal: !!(rules && rules.innerText.includes(CONTENT.levels.find((l) => l.id === 'dyna').goal.text)),
      given: !!(rules && rules.innerText.includes('Given')),
      controlled: !!(rules && rules.innerText.includes('Controlled')),
      runHidden: !document.querySelector('#dyna-run'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
      dash: (root ? root.innerText : '').includes('\\u2014') || (rules ? rules.innerText : '').includes('\\u2014'),
    };
  }`);
  check(opened.clicked && opened.map && opened.nodes === opened.levels, 'map opens the dyna lesson by title at ' + width);
  check(opened.notGoals && opened.notReplan && opened.notElbo, 'dyna does not fall through to another custom lesson at ' + width);
  check(opened.goal && opened.given && opened.controlled && opened.runHidden && opened.overflow && !opened.dash, 'rules, hidden run, and no overflow before the run at ' + width);

  check(clickText('#dyna-p .opt', 'Empty. The two steps write start'), 'prediction chosen at ' + width);
  const predicted = evaluate(`() => ({
    why: (document.querySelector('#dyna-p .why') || {}).innerText || '',
    run: !!document.querySelector('#dyna-run'),
    overflow: document.documentElement.scrollWidth <= innerWidth,
  })`);
  check(/far/i.test(predicted.why) && /empty/.test(predicted.why) && predicted.run && predicted.overflow, 'prediction explains the empty far cell at ' + width);

  check(clickText('#dyna-run', 'Take two real steps'), 'run clicked at ' + width);
  const ran = evaluate(`() => {
    const read = (id) => {
      const el = document.querySelector(id);
      return el ? {
        empty: el.getAttribute('data-far-empty'),
        value: el.getAttribute('data-far-value'),
        real: el.getAttribute('data-real-steps'),
        model: el.getAttribute('data-model-updates'),
        env: el.getAttribute('data-env-reward'),
        modelReward: el.getAttribute('data-model-reward'),
        agrees: el.getAttribute('data-agrees'),
      } : null;
    };
    const trace = (document.querySelector('#dyna-trace') || {}).innerText || '';
    return {
      real: read('#dyna-real'),
      accurate: read('#dyna-accurate'),
      wrong: read('#dyna-wrong'),
      current: read('#dyna-current'),
      trace,
      learned: /Learned model: no/.test((document.querySelector('#dyna-counts') || {}).innerText || ''),
      overflow: document.documentElement.scrollWidth <= innerWidth,
      board: !!document.querySelector('#dyna-board'),
    };
  }`);
  check(ran.real && ran.real.empty === 'yes' && ran.real.real === '2' && ran.real.model === '0', 'real-only leaves the far cell empty at ' + width);
  check(ran.accurate && ran.accurate.value === '1' && ran.accurate.model === '6' && ran.accurate.real === '2' && ran.accurate.agrees === 'yes', 'accurate model fills the far cell at ' + width);
  check(ran.wrong && ran.wrong.value === '0' && ran.wrong.empty === 'no' && ran.wrong.modelReward === '0' && ran.wrong.env === '1' && ran.wrong.agrees === 'no', 'flipped model writes 0 while the corridor pays 1 at ' + width);
  check(ran.current && ran.current.value === '1' && ran.learned && ran.board && ran.overflow, 'the lesson run shows the given model at ' + width);
  check(ran.trace.includes('environment') && ran.trace.includes('right') && ran.trace.includes('Model next') && ran.trace.includes('far'), 'the trace shows real actions and model rows at ' + width);

  evaluate(`() => { document.querySelector('#dyna-reward-0').focus(); return document.activeElement && document.activeElement.id; }`);
  check(evaluate(`() => document.activeElement && document.activeElement.id`) === 'dyna-reward-0', 'far reward control takes focus at ' + width);
  cli('press', 'Enter');
  const edited = evaluate(`() => {
    const el = document.querySelector('#dyna-current');
    const note = (document.querySelector('#dyna-edit-note') || {}).innerText || '';
    return {
      value: el.getAttribute('data-far-value'),
      empty: el.getAttribute('data-far-empty'),
      agrees: el.getAttribute('data-agrees'),
      env: el.getAttribute('data-env-reward'),
      modelReward: el.getAttribute('data-model-reward'),
      pressed: document.querySelector('#dyna-reward-0').getAttribute('aria-pressed'),
      note,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(edited.value === '0' && edited.empty === 'no' && edited.agrees === 'no' && edited.env === '1' && edited.modelReward === '0', 'Enter on the reward control writes the flipped value at ' + width);
  check(edited.pressed === 'true' && /changed the written far value/.test(edited.note) && edited.overflow, 'the edit note and the page width stay honest at ' + width);

  check(clickText('#dyna-d .opt', 'Rows from the given one-step table'), 'diagnose chosen at ' + width);
  check(clickText('#dyna-x .opt', 'They are one-step backups'), 'explanation chosen at ' + width);
  const blocked = evaluate(`() => ({
    finish: document.querySelector('#dyna-complete') && document.querySelector('#dyna-complete').disabled,
  })`);
  check(blocked.finish === false, 'finish is available after the flipped model and the explanation at ' + width);
  check(clickText('#dyna-complete', 'Finish lesson'), 'lesson finished at ' + width);
  const done = evaluate(`() => {
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    const levels = bellman.levels();
    return {
      dyna: levels.find((l) => l.id === 'dyna').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.dyna,
      cliffStep: saved.lstep.cliff,
    };
  }`);
  check(done.dyna && done.slots && !done.cliff && done.step === 5 && done.cliffStep === 2, 'completion appends dyna and keeps the old save at ' + width);

  evaluate(`() => { document.querySelector('#dyna-trace').scrollIntoView({ block: 'nearest' }); return true; }`);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#dyna-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'dyna') + 1];
    const details = document.querySelector('details.map-card');
    if (details) details.open = true;
    const root = document.querySelector('#' + next.id + '-lesson');
    return {
      id: next.id,
      title: next.title,
      custom: !!next.custom,
      dynaGone: !document.querySelector('#dyna-lesson'),
      mounted: !!(root && root.innerText.includes(next.title)),
      overflow: document.documentElement.scrollWidth <= innerWidth,
      map: !!(details && details.textContent.includes(next.title)),
    };
  }`);
  check(nextWorld.dynaGone && nextWorld.mounted && nextWorld.overflow && nextWorld.map, 'next level ' + nextWorld.id + ' replaces dyna at ' + width);
  return nextWorld;
}

cli('open', url);
evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
cli('emulate', '--viewport', '1280x900x1');
upload('Older progress file', oldUpload);
const preserved = savedState();
check(!preserved.missing && preserved.level === 'cliff' && preserved.slots && !preserved.dyna, 'older file keeps cliff and does not invent dyna');
check(preserved.cliffStep === undefined ? preserved.lstep.cliff === 2 : preserved.lstep.cliff === 2, 'older cliff step survives');
check(preserved.slotsAnswer === 1 && preserved.lstep.slots === 5, 'older slots answer survives');
const cliffRules = evaluate(`() => {
  const rules = document.querySelector('#game-rules');
  return { text: rules ? rules.innerText : '', dyna: !!document.querySelector('#dyna-lesson') };
}`);
check(/Cliff|cliff|grid/i.test(cliffRules.text) && !cliffRules.dyna, 'the loaded level shows its own rules');

const desktop = walk(1280, false);
fs.writeFileSync(path.join(proof, 'desktop.json'), JSON.stringify(desktop, null, 2));

evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  saved.done = saved.done.filter((id) => id !== 'dyna');
  saved.lstep.dyna = 0;
  for (const id of ['dyna-p', 'dyna-d', 'dyna-x']) delete saved.answers[id];
  saved.level = 'cliff';
  localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
  return true;
}`);
cli('open', url);
const phoneReady = savedState();
check(!phoneReady.missing && phoneReady.level === 'cliff' && phoneReady.slots && !phoneReady.dyna, 'phone reload keeps the older save and clears dyna');
const phone = walk(390, true);
fs.writeFileSync(path.join(proof, 'phone.json'), JSON.stringify(phone, null, 2));

const peers = evaluate(`() => {
  function look(id, title) {
    bellman.level(id);
    const root = document.querySelector('#' + id + '-lesson');
    return {
      mounted: !!(root && root.innerText.includes(title)),
      notDyna: !document.querySelector('#dyna-lesson'),
    };
  }
  const goals = look('goals', 'Tell it the goal');
  const replan = look('replan', 'Plan once, or replan');
  const hindsight = look('hindsight', 'A miss is a hit for another goal');
  const elbo = look('elbo', 'A bound that is tight only when the guess matches');
  bellman.level('dyna');
  return {
    goals, replan, hindsight, elbo,
    dyna: !!document.querySelector('#dyna-lesson') && !document.querySelector('#replan-lesson'),
  };
}`);
check(peers.goals.mounted && peers.goals.notDyna, 'goals still mounts');
check(peers.replan.mounted && peers.replan.notDyna, 'replan still mounts');
check(peers.hindsight.mounted && peers.hindsight.notDyna, 'hindsight still mounts');
check(peers.elbo.mounted && peers.elbo.notDyna, 'ELBO still mounts');
check(peers.dyna, 'dyna mounts again without the replan lesson');

const exported = evaluate(`async () => {
  const details = document.querySelector('details.map-card');
  if (details) details.open = true;
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Download save file'));
  button.click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"dyna"') && exported.text.includes('"slots"'), 'download control writes a save that contains dyna and the older progress');
const savePath = path.join(proof, 'downloaded-save.json');
const saveUpload = path.join(process.cwd(), 'dist', 'dyna-downloaded-save.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(saveUpload, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
upload('Downloaded progress file', saveUpload);
fs.unlinkSync(oldUpload);
fs.unlinkSync(saveUpload);
const imported = savedState();
check(!imported.missing && imported.slots && imported.dyna && imported.lstep.cliff === 2 && imported.lstep.dyna === 5, 'file input reloads the downloaded save');
check(imported.slotsAnswer === 1, 'the downloaded save keeps the older slots answer');
cli('open', url);
const second = savedState();
check(!second.missing && second.slots && second.dyna && second.lstep.cliff === 2 && second.lstep.dyna === 5 && second.slotsAnswer === 1, 'a second reload keeps the downloaded save');
fs.writeFileSync(path.join(proof, 'round-trip.json'), JSON.stringify({ imported, second }, null, 2));

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('dyna UI checks passed');
