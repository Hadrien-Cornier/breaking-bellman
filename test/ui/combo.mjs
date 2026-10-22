// Desktop and phone proof for the illustrative conservative backup.
// node test/ui/combo.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8915/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-combo200',
  CHROME_DEVTOOLS_AXI_PORT: '9488',
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

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  const opened = evaluate(`() => {
    const map = document.querySelector('details.map-card');
    if (map) map.open = true;
    const node = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('The imagined leap looks better'));
    if (!node) return { clicked: false };
    node.click();
    const root = document.querySelector('#combo-lesson');
    const rules = document.querySelector('#combo-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'combo').goal.text;
    return {
      clicked: true,
      title: !!(root && root.innerText.includes('The imagined leap looks better')),
      heading: !!(root && root.innerText.includes('COMBO: Conservative Model-Based RL')),
      openPaper: !!(root && root.innerText.includes('The COMBO paper loss is open')),
      notThaw: !document.querySelector('#thaw-lesson'),
      notMetarl: !document.querySelector('#metarl-lesson'),
      notMopo: !document.querySelector('#mopo-lesson'),
      goal: !!(rules && rules.innerText.includes(goal)),
      units: !!(rules && rules.innerText.includes('return per unit total variation')),
      runHidden: !document.querySelector('#combo-run'),
      emDash: (root ? root.innerText : '').includes('\\u2014') || (rules ? rules.innerText : '').includes('\\u2014'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(opened.clicked && opened.title && opened.heading && opened.openPaper, 'title opens the combo lesson at ' + width);
  check(opened.notThaw && opened.notMetarl && opened.notMopo, 'combo does not mount a peer lesson at ' + width);
  check(opened.goal && opened.units && opened.runHidden && !opened.emDash && opened.overflow, 'rules, units, and no overflow before the run at ' + width);

  check(clickText('#combo-p .opt', 'The leap. Coefficient 0 keeps the target 6'), 'predict answer clicked at ' + width);
  check(clickText('#combo-run', 'Back up at coefficient 0'), 'coefficient 0 backup clicked at ' + width);
  const zero = evaluate(`() => {
    const live = BBCOMBO.study(BBCOMBO.lessonData(), 0);
    const el = document.querySelector('#combo-readout');
    const sweep = document.querySelector('#combo-sweep');
    return {
      action: el && el.dataset.action === 'leap' && live.plan.action === 'leap',
      value: el && el.dataset.leapValue === '6' && live.rows.leap.value === 6,
      distance: el && el.dataset.leapDistance === '1' && live.rows.leap.distance === 1,
      stay: el && el.dataset.stayDistance === '0' && el.dataset.stayValue === '2',
      notZeroed: el && el.dataset.leapValue !== '0',
      drop: sweep && sweep.dataset.drop === sweep.dataset.drop2 && sweep.dataset.drop === '2',
      negative: sweep && sweep.dataset.v10 === '-4',
      paper: el.dataset.paper === 'open',
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(zero.action && zero.value && zero.distance && zero.stay, 'coefficient 0 keeps the off-data target at ' + width);
  check(zero.notZeroed && zero.drop && zero.negative && zero.paper && zero.overflow, 'the drop is proportional and coefficient 10 is not clamped at ' + width);

  check(clickText('#combo-d .opt', 'The Bellman target of the model sample'), 'diagnose answer clicked at ' + width);
  check(clickText('#combo-coef-5', 'Coefficient 5'), 'coefficient 5 clicked at ' + width);
  const stayed = evaluate(`() => {
    const live = BBCOMBO.study(BBCOMBO.lessonData(), 5);
    const el = document.querySelector('#combo-readout');
    const limit = document.querySelector('#combo-limit');
    return {
      action: el.dataset.action === 'stay' && live.plan.action === 'stay',
      value: el.dataset.leapValue === '1' && live.rows.leap.value === 1,
      target: el.dataset.leapTarget === '6',
      rejects: limit && limit.dataset.rejects === 'yes',
      higher: live.rows.leap.target > live.rows.stay.target && live.rows.leap.value < live.rows.stay.value,
    };
  }`);
  check(stayed.action && stayed.value && stayed.target && stayed.rejects && stayed.higher, 'coefficient 5 stays and still rejects the higher leap target at ' + width);

  evaluate(`() => { document.querySelector('#combo-coef-4').focus(); return true; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  const tied = evaluate(`() => {
    const live = BBCOMBO.study(BBCOMBO.lessonData(), 4);
    const el = document.querySelector('#combo-readout');
    return {
      action: el && el.dataset.action === 'tie' && live.plan.action === null,
      value: el && el.dataset.leapValue === '2' && el.dataset.stayValue === '2',
      explainHidden: !document.querySelector('#combo-x'),
    };
  }`);
  check(tied.action && tied.value && tied.explainHidden, 'keyboard coefficient 4 is a tie at ' + width);

  check(clickText('#combo-coef-5', 'Coefficient 5'), 'coefficient 5 restored at ' + width);

  if (touch) {
    const touched = evaluate(`() => {
      const button = document.querySelector('#combo-data-half');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: rect.x + 4, clientY: rect.y + 4 }));
      button.click();
      const live = BBCOMBO.study(BBCOMBO.dataset(2, 2), 5);
      const el = document.querySelector('#combo-readout');
      return {
        counts: el.dataset.stayCount === '2' && el.dataset.leapCount === '2',
        distance: el.dataset.leapDistance === '0.5' && live.rows.leap.distance === 0.5,
        action: el.dataset.action === 'leap' && live.plan.action === 'leap',
        value: el.dataset.leapValue === '3.5' && live.rows.leap.value === 3.5,
        onData: live.rows.leap.distance !== 0,
      };
    }`);
    check(touched.counts && touched.distance && touched.action && touched.value && touched.onData, 'touch changes the data frequencies and the planner at ' + width);
    check(clickText('#combo-data-lesson', 'Data: 4 stay, 0 leap'), 'original data restored at ' + width);
    check(clickText('#combo-coef-5', 'Coefficient 5'), 'coefficient 5 restored after the frequency change at ' + width);
  }

  const blocked = evaluate(`() => document.querySelector('#combo-complete').disabled`);
  check(blocked === true, 'complete stays blocked before the explanation at ' + width);
  check(clickText('#combo-x .opt', 'Off-data values are set to 0'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#combo-complete').disabled`) === true, 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#combo-x .opt', 'The value is the target minus the coefficient'), 'explanation clicked at ' + width);
  check(clickText('#combo-complete', 'Record this measurement'), 'lesson finished at ' + width);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'combo').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.combo,
      cliffStep: saved.lstep.cliff,
      firstTry: saved.answers['combo-x'].choice,
      firstCorrect: saved.answers['combo-x'].correct,
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2, 'completion appends combo and keeps the old save at ' + width);
  check(gated.firstTry === 0 && gated.firstCorrect === false, 'the first explanation try stays stored at ' + width);

  evaluate(`() => { document.querySelector('#combo-readout').scrollIntoView({ block: 'start' }); return true; }`);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#combo-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'combo') + 1];
    const root = document.querySelector('#rewardfit-lesson');
    return {
      id: next && next.id,
      title: next && next.title,
      comboGone: !document.querySelector('#combo-lesson'),
      rewardfit: !!(root && root.innerText.includes(next.title)),
      labHidden: document.querySelector('#lab').hidden,
      customShown: !document.querySelector('#vpo-lab').hidden,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.id === 'rewardfit' && nextWorld.title === 'Fit the reward' && nextWorld.comboGone && nextWorld.rewardfit, 'next level is the reward fit at ' + width + ' (' + nextWorld.id + ')');
  check(nextWorld.labHidden && nextWorld.customShown && nextWorld.overflow, 'next level keeps its own mount at ' + width);
  return { opened, zero, stayed, gated };
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
    combo: levels.find((l) => l.id === 'combo').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    comboMounted: !!document.querySelector('#combo-lesson'),
    around: (() => {
      const ids = CONTENT.levels.map((l) => l.id);
      const at = ids.indexOf('combo');
      return ids.slice(at - 1, at + 3);
    })(),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.combo, 'old save keeps its current level and does not invent combo');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.comboMounted, 'opening the saved level shows cliff rules');
check(preserved.around[0] === 'thaw' && preserved.around[1] === 'combo' && preserved.around[2] === 'rewardfit', 'combo sits after thaw and before the reward fit');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'combo');
      saved.lstep.combo = 0;
      for (const id of ['combo-p', 'combo-d', 'combo-x']) delete saved.answers[id];
      saved.level = 'cliff';
      localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
      return true;
    }`);
    cli('open', url);
  }
  results.push({ width, ...walk(width, width === 390) });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}

const peers = evaluate(`() => {
  bellman.level('thaw');
  const thaw = {
    mounted: !!document.querySelector('#thaw-lesson'),
    notCombo: !document.querySelector('#combo-lesson'),
    title: document.querySelector('#thaw-lesson') && document.querySelector('#thaw-lesson').innerText.includes('A few fresh steps'),
  };
  bellman.level('metarl');
  const metarl = {
    mounted: !!document.querySelector('#metarl-lesson'),
    notCombo: !document.querySelector('#combo-lesson'),
    title: document.querySelector('#metarl-lesson') && document.querySelector('#metarl-lesson').innerText.includes('The second episode reads the first'),
  };
  bellman.level('messages');
  const messages = {
    mounted: !!document.querySelector('#messages-lesson'),
    notCombo: !document.querySelector('#combo-lesson'),
    title: document.querySelector('#messages-lesson') && document.querySelector('#messages-lesson').innerText.includes('Pass the message back'),
  };
  bellman.level('combo');
  return { thaw, metarl, messages, combo: !!document.querySelector('#combo-lesson') && !document.querySelector('#thaw-lesson') };
}`);
check(peers.thaw.mounted && peers.thaw.notCombo && peers.thaw.title, 'thaw still mounts after combo');
check(peers.metarl.mounted && peers.metarl.notCombo && peers.metarl.title, 'metarl still mounts after combo');
check(peers.messages.mounted && peers.messages.notCombo && peers.messages.title, 'messages still mounts after combo');
check(peers.combo, 'combo mounts again without falling through to thaw');

const exported = evaluate(`async () => {
  const map = document.querySelector('details.map-card');
  if (map) map.open = true;
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"combo"'), 'download control writes a save that contains combo');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'combo-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('combo')`), 'cleared storage does not keep combo');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'combo-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Combo save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Combo save file'));
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
    combo: levels.find((l) => l.id === 'combo').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    comboStep: saved.lstep.combo,
    comboAnswer: saved.answers['combo-p'] && typeof saved.answers['combo-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.combo && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.comboStep === 5 && imported.comboAnswer, 'combo completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    combo: levels.find((l) => l.id === 'combo').done,
    cliffStep: saved.lstep.cliff,
    comboStep: saved.lstep.combo,
  };
}`);
check(second.slots && second.combo && second.cliffStep === 2 && second.comboStep === 5, 'a second reload keeps the loaded save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('combo UI checks passed');
