// Desktop and phone proof for the latent lesson.
// node test/ui/latent.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8906/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-latent200',
  CHROME_DEVTOOLS_AXI_PORT: '9528',
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
const OLD_SAVE = {
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

function installOldSave() {
  return evaluate(`() => {
    localStorage.setItem('breaking-bellman-v1', ${JSON.stringify(JSON.stringify(OLD_SAVE))});
    return true;
  }`);
}
function clickText(selector, text) {
  return evaluate(`() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  }`);
}
function readout() {
  return evaluate(`() => {
    const el = document.querySelector('#latent-readout');
    const text = el ? el.innerText : '';
    return {
      commit: el && el.dataset.commit,
      tie: el && el.dataset.tie,
      copper: el && el.dataset.copper,
      glass: el && el.dataset.glass,
      history: el && el.dataset.history,
      mode: el && el.dataset.mode,
      mark: el && el.dataset.mark,
      same: el && el.dataset.same,
      skipped: el && el.dataset.skipped,
      oracleCopper: el && el.dataset.oracleCopper,
      oracleGlass: el && el.dataset.oracleGlass,
      overflow: document.documentElement.scrollWidth <= innerWidth,
      clean: !text.includes('NaN') && !text.includes('undefined') && !text.includes('null'),
    };
  }`);
}

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  check(evaluate(`() => {
    const map = document.querySelector('details.map-card');
    if (map) map.open = true;
    const node = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('Read the payload from the history'));
    if (!node) return false;
    node.click();
    if (map) map.open = false;
    return true;
  }`), 'title opens the latent lesson at ' + width);
  const started = evaluate(`() => {
    const root = document.querySelector('#latent-lesson');
    const rules = document.querySelector('#latent-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'latent').goal.text;
    const help = bellman.help();
    return {
      title: !!(root && root.innerText.includes('Read the payload from the history')),
      notVpo: !document.querySelector('#vpo-lesson'),
      notReplan: !document.querySelector('#replan-lesson'),
      notSupermimic: !document.querySelector('#supermimic-lesson'),
      goal: !!(rules && rules.innerText.includes(goal)),
      hidden: !!(rules && rules.innerText.includes('Hidden payload')),
      runHidden: !document.querySelector('#latent-run'),
      help: help.includes('payload id is not an input'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(started.title && started.notVpo && started.notReplan && started.notSupermimic, 'latent mounts its own lesson at ' + width);
  check(started.goal && started.hidden && started.runHidden && started.help && started.overflow, 'rules, hidden payload, and no overflow before the run at ' + width);

  check(clickText('#latent-p .opt', 'Stay a tie.'), 'predict answer clicked at ' + width);
  check(clickText('#latent-run', 'Score the sealed history'), 'sealed history scored at ' + width);
  const tie = readout();
  check(tie.commit === 'tie' && tie.tie === 'yes' && tie.copper === '0.5000' && tie.glass === '0.5000', 'pre-probe posterior stays one half and does not pick at ' + width);
  check(tie.history === 'sealed' && tie.mark === 'sealed' && tie.same === 'yes', 'sealed history and mark copy stay on the mark at ' + width);
  check(tie.oracleCopper === 'copper' && tie.oracleGlass === 'glass' && tie.clean && tie.overflow, 'id planner is shown and not used at ' + width);

  check(clickText('#latent-d .opt', 'Only the sealed mark.'), 'diagnose answer clicked at ' + width);
  check(clickText('#latent-probe-red', 'Probe returns red'), 'red probe clicked at ' + width);
  const red = readout();
  check(red.commit === 'copper' && red.copper === '1.0000' && red.glass === '0.0000' && red.history === 'sealed,red', 'red commits the lesson payload at ' + width);
  check(red.mark === 'red' && red.mark !== red.commit && red.same === 'yes' && red.overflow, 'the current mark is not the commit at ' + width);

  evaluate(`() => { document.querySelector('#latent-fit-swap').focus(); return true; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  const swapped = readout();
  check(swapped.mode === 'swapped' && swapped.commit === 'glass' && swapped.copper === '0.0000' && swapped.glass === '1.0000', 'keyboard swap moves the commit at ' + width);
  check(swapped.mark === 'red' && swapped.history === 'sealed,red' && swapped.clean, 'the same red history keeps the mark and changes the payload at ' + width);

  if (touch) {
    const touched = evaluate(`() => {
      const button = document.querySelector('#latent-fit-unseen');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: rect.x + 4, clientY: rect.y + 4 }));
      button.click();
      const el = document.querySelector('#latent-readout');
      return { mode: el.dataset.mode, commit: el.dataset.commit, skipped: el.dataset.skipped, copper: el.dataset.copper };
    }`);
    check(touched.mode === 'unseen' && touched.commit === 'tie' && touched.skipped === 'red' && touched.copper === '0.5000', 'touch on an unseen red leaves the posterior mixed at ' + width);
  } else {
    check(clickText('#latent-fit-unseen', 'Fit never saw red'), 'unseen fit clicked at ' + width);
    const unseen = readout();
    check(unseen.mode === 'unseen' && unseen.commit === 'tie' && unseen.skipped === 'red' && unseen.copper === '0.5000' && unseen.glass === '0.5000', 'red the fit never saw stays mixed at ' + width);
  }

  check(clickText('#latent-fit-ambiguous', 'Both payloads probe red'), 'shared probe clicked at ' + width);
  const shared = readout();
  check(shared.mode === 'ambiguous' && shared.commit === 'tie' && shared.skipped === '' && shared.copper === '0.5000' && shared.glass === '0.5000', 'a shared probe stays mixed at ' + width);

  check(clickText('#latent-fit-lesson', 'Lesson fit'), 'lesson fit restored at ' + width);
  const restored = readout();
  check(restored.mode === 'lesson' && restored.commit === 'copper' && restored.history === 'sealed,red', 'lesson fit commits copper again at ' + width);
  const flags = evaluate(`() => document.querySelector('#latent-flags').innerText`);
  check(!flags.includes('not yet'), 'every mixed and matched case has been scored at ' + width);

  const blocked = evaluate(`() => document.querySelector('#latent-complete').disabled`);
  check(blocked === true, 'complete stays blocked before the explanation at ' + width);
  check(clickText('#latent-x .opt', 'The current mark.'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#latent-complete').disabled`) === true, 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#latent-x .opt', 'The posterior from the fitted counts'), 'explanation clicked at ' + width);
  check(clickText('#latent-complete', 'Finish lesson'), 'lesson finished at ' + width);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'latent').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.latent,
      cliffStep: saved.lstep.cliff,
      doneIds: saved.done,
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2, 'completion appends latent and keeps the old save at ' + width);
  check(gated.doneIds.filter((id) => id === 'latent').length === 1 && gated.doneIds.includes('slots'), 'the new id is appended once at ' + width);

  evaluate(`() => { document.querySelector('#latent-readout').scrollIntoView({ block: 'start' }); return true; }`);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#latent-next', 'Next level: Plan once, or replan'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'latent') + 1];
    const rules = document.querySelector('#replan-rules');
    return {
      id: next && next.id,
      latentGone: !document.querySelector('#latent-lesson'),
      replan: !!document.querySelector('#replan-lesson'),
      notVpo: !document.querySelector('#vpo-lesson'),
      notSupermimic: !document.querySelector('#supermimic-lesson'),
      title: document.querySelector('#replan-lesson') && document.querySelector('#replan-lesson').innerText.includes('Plan once, or replan'),
      rules: rules ? rules.innerText : '',
      goal: next.goal.text,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.id === 'replan' && nextWorld.latentGone && nextWorld.replan && nextWorld.notVpo && nextWorld.notSupermimic, 'next level leaves latent and opens replan at ' + width);
  check(nextWorld.title && nextWorld.rules.includes(nextWorld.goal) && nextWorld.overflow, 'replan keeps its own rules at ' + width);
  return { started, gated };
}

cli('open', url);
installOldSave();
cli('open', url);
const preserved = evaluate(`() => {
  document.querySelector('dialog.intro button')?.click();
  const levels = bellman.levels();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  return {
    level: saved.level,
    slots: levels.find((l) => l.id === 'slots').done,
    latent: levels.find((l) => l.id === 'latent').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    latentMounted: !!document.querySelector('#latent-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.latent, 'old save keeps its current level and does not invent latent');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.latentMounted, 'opening the saved level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'latent');
      saved.lstep.latent = 0;
      for (const id of ['latent-p', 'latent-d', 'latent-x']) delete saved.answers[id];
      saved.level = 'latent';
      localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
      return true;
    }`);
    cli('open', url);
  }
  results.push({ width, ...walk(width, width === 390) });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}

const peers = evaluate(`() => {
  const ids = ['goals', 'replan', 'messages', 'skills', 'hierarchy', 'rare', 'elbo', 'hindsight', 'rewardfit', 'thaw', 'vpo', 'supermimic', 'metarl', 'ensemble', 'skew', 'latent'];
  const out = {};
  for (const id of ids) {
    bellman.level(id);
    const root = document.querySelector('#' + id + '-lesson');
    out[id] = !!(root && root.innerText.length > 20);
  }
  bellman.world('latent');
  out.routed = !!document.querySelector('#latent-lesson') && !document.querySelector('#vpo-lesson') && !document.querySelector('#supermimic-lesson') && bellman.state().world === 'latent';
  return out;
}`);
for (const id of ['goals', 'replan', 'messages', 'skills', 'hierarchy', 'rare', 'elbo', 'hindsight', 'rewardfit', 'thaw', 'vpo', 'supermimic', 'metarl', 'ensemble', 'skew', 'latent']) {
  check(peers[id], id + ' still mounts');
}
check(peers.routed, 'set_world latent opens this lesson and does not fall through');

const exported = evaluate(`async () => {
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"latent"'), 'download control writes a save that contains latent');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'latent-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('latent')`), 'cleared storage does not keep latent');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'latent-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Latent save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Latent save file'));
const uid = line && (line.match(/uid=(\S+)/) || [])[1];
if (!uid) throw new Error('load control did not expose a file input\n' + snap.slice(0, 2500));
cli('upload', '@' + uid, uploadPath);
fs.unlinkSync(uploadPath);
cli('wait', '1500');
const imported = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    latent: levels.find((l) => l.id === 'latent').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    latentStep: saved.lstep.latent,
    latentAnswer: saved.answers['latent-p'] && typeof saved.answers['latent-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.latent && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.latentStep === 5 && imported.latentAnswer, 'latent completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    latent: levels.find((l) => l.id === 'latent').done,
    cliffStep: saved.lstep.cliff,
    latentStep: saved.lstep.latent,
  };
}`);
check(second.slots && second.latent && second.cliffStep === 2 && second.latentStep === 5, 'a second reload keeps the loaded save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('latent UI checks passed');
