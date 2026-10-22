// Desktop and phone proof for the history lesson.
// node test/ui/history.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8784/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-history200',
  CHROME_DEVTOOLS_AXI_PORT: '9564',
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
function openMap() {
  return evaluate(`() => {
    const map = document.querySelector('details.map-card');
    if (map) map.open = true;
    return !!map;
  }`);
}
function livePack(swapped) {
  return evaluate(`() => {
    const rows = ${swapped ? 'true' : 'false'} ? BBHISTORY.swapActions(BBHISTORY.lessonRows()) : BBHISTORY.lessonRows();
    const current = BBHISTORY.fit(rows, false);
    const history = BBHISTORY.fit(rows, true);
    const west = history.choose(BBHISTORY.JUNCTION, BBHISTORY.WEST_LANE);
    const east = history.choose(BBHISTORY.JUNCTION, BBHISTORY.EAST_LANE);
    const tied = current.choose(BBHISTORY.JUNCTION, BBHISTORY.EAST_LANE);
    return {
      budget: String(rows.length),
      historyWest: west.action,
      historyEast: east.action,
      historyTie: east.tie ? 'yes' : 'no',
      currentAction: tied.action,
      currentTie: tied.tie ? 'yes' : 'no',
      currentWestCount: String(tied.counts.west),
      currentEastCount: String(tied.counts.east),
      sameBudget: current.budget === history.budget,
    };
  }`);
}
function readOut(id) {
  return evaluate(`() => {
    const el = document.querySelector(${JSON.stringify(id)});
    if (!el) return null;
    return {
      budget: el.dataset.budget,
      usePrevious: el.dataset.usePrevious,
      tie: el.dataset.tie,
      west: el.dataset.westAction,
      east: el.dataset.eastAction,
      westCount: el.dataset.westCount,
      eastCount: el.dataset.eastCount,
      swapped: el.dataset.swapped,
    };
  }`);
}

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  check(openMap(), 'level map is open at ' + width);
  check(clickText('#mode-pane .node', 'The previous room is part of the state'), 'title opens the history lesson at ' + width);
  const started = evaluate(`() => {
    const root = document.querySelector('#history-lesson');
    const rules = document.querySelector('#history-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'history').goal.text;
    const text = root ? root.innerText : '';
    return {
      title: !!(root && text.includes('The previous room is part of the state')),
      heading: text.includes('How can we use the whole history?'),
      toy: text.includes('only for this toy') || text.includes('only in this toy'),
      notNetwork: text.includes('not a recurrent network'),
      notReward: text.includes('not meta-RL'),
      notGoals: !document.querySelector('#goals-lesson'),
      notMetarl: !document.querySelector('#metarl-lesson'),
      notEnsemble: !document.querySelector('#ensemble-lesson'),
      goal: !!(rules && rules.innerText.includes(goal)),
      noReward: !!(rules && rules.innerText.includes('None. The copy counts actions.')),
      runHidden: !document.querySelector('#history-run'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(started.title && started.heading && started.toy && started.notNetwork && started.notReward, 'heading, toy limit, and not a network at ' + width);
  check(started.notGoals && started.notMetarl && started.notEnsemble, 'history does not mount peer lessons at ' + width);
  check(started.goal && started.noReward && started.runHidden && started.overflow, 'rules and no overflow before the run at ' + width);

  check(clickText('#history-p .opt', 'The first action in the list'), 'predict answer clicked at ' + width);
  check(clickText('#history-run', 'Fit the current room'), 'current-room fit clicked at ' + width);
  const lesson = livePack(false);
  const current = readOut('#history-current-readout');
  check(lesson.sameBudget && lesson.currentTie === 'yes', 'live current-only fit ties at ' + width);
  check(current && current.budget === lesson.budget && current.tie === 'yes' && current.east === lesson.currentAction && current.usePrevious === 'no', 'current readout matches the live tie at ' + width);
  check(current.westCount === lesson.currentWestCount && current.eastCount === lesson.currentEastCount, 'junction counts match at ' + width);

  check(clickText('#history-d .opt', 'Both arrivals share one junction count'), 'diagnose answer clicked at ' + width);
  check(clickText('#history-repair', 'Fit the previous room'), 'history fit clicked at ' + width);
  const history = readOut('#history-history-readout');
  check(history && history.usePrevious === 'yes' && history.tie === 'no' && history.west === lesson.historyWest && history.east === lesson.historyEast, 'history readout follows each arrival at ' + width);
  check(history.east !== current.east && history.budget === current.budget, 'history changes the tied arrival and keeps the budget at ' + width);

  evaluate(`() => { document.querySelector('#history-erase').focus(); return document.activeElement.id; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  const erased = evaluate(`() => {
    const button = document.querySelector('#history-erase');
    const el = document.querySelector('#history-erased-readout');
    return {
      pressed: button && button.getAttribute('aria-pressed') === 'true',
      tie: el && el.dataset.tie,
      east: el && el.dataset.eastAction,
      budget: el && el.dataset.budget,
      previous: el && el.dataset.usePrevious,
    };
  }`);
  check(erased.pressed && erased.tie === 'yes' && erased.east === lesson.currentAction && erased.budget === lesson.budget && erased.previous === 'no', 'keyboard erase brings the tie back at ' + width);

  if (touch) {
    const touched = evaluate(`() => {
      const button = document.querySelector('#history-swap');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: rect.x + 4, clientY: rect.y + 4 }));
      button.click();
      const again = document.querySelector('#history-swap');
      return !!(again && again.getAttribute('aria-pressed') === 'true' && again !== button);
    }`);
    check(touched, 'touch swaps the action labels at ' + width);
  } else {
    check(clickText('#history-swap', 'Swap the action labels'), 'swap clicked at ' + width);
  }
  const swappedLive = livePack(true);
  const swappedHistory = readOut('#history-history-readout');
  const swappedCurrent = readOut('#history-current-readout');
  check(swappedHistory.west === swappedLive.historyWest && swappedHistory.east === swappedLive.historyEast && swappedHistory.east !== lesson.historyEast, 'swapped labels change the history actions at ' + width);
  check(swappedCurrent.tie === 'yes' && swappedCurrent.east === swappedLive.currentAction && swappedCurrent.east === lesson.currentAction, 'swapped labels leave the junction tie on the first action at ' + width);

  check(evaluate(`() => document.querySelector('#history-complete').disabled`) === true, 'complete stays blocked before the explanation at ' + width);
  check(clickText('#history-x .opt', 'A recurrent network was pretrained'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#history-complete').disabled`) === true, 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#history-x .opt', 'It splits these two arrivals'), 'explanation clicked at ' + width);
  check(clickText('#history-complete', 'Finish lesson'), 'lesson finished at ' + width);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'history').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.history,
      cliffStep: saved.lstep.cliff,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2 && gated.overflow, 'completion appends history and keeps the old save at ' + width);

  evaluate(`() => { document.querySelector('#history-board').scrollIntoView({ block: 'start' }); return true; }`);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#history-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'history') + 1];
    const heading = document.querySelector('#mode-pane h2');
    return {
      id: next.id,
      title: next.title,
      custom: !!next.custom,
      shown: heading ? heading.textContent : '',
      historyGone: !document.querySelector('#history-lesson'),
      labHidden: document.querySelector('#lab').hidden,
      customHidden: document.querySelector('#vpo-lab').hidden,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.historyGone && nextWorld.shown === nextWorld.title && nextWorld.overflow, 'next opens ' + nextWorld.title + ' at ' + width);
  check(nextWorld.custom ? nextWorld.labHidden && !nextWorld.customHidden : !nextWorld.labHidden && nextWorld.customHidden, 'next keeps that lesson mount at ' + width);
  return { started, history, gated, next: nextWorld.title };
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
    history: levels.find((l) => l.id === 'history').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    historyMounted: !!document.querySelector('#history-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.history, 'old save keeps its current level and does not invent history');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.historyMounted, 'opening the saved level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'history');
      saved.lstep.history = 0;
      for (const id of ['history-p', 'history-d', 'history-x']) delete saved.answers[id];
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
  bellman.level('goals');
  const goals = {
    mounted: !!document.querySelector('#goals-lesson'),
    notHistory: !document.querySelector('#history-lesson'),
    title: document.querySelector('#goals-lesson') && document.querySelector('#goals-lesson').innerText.includes('Tell it the goal'),
  };
  bellman.level('metarl');
  const metarl = {
    mounted: !!document.querySelector('#metarl-lesson'),
    notHistory: !document.querySelector('#history-lesson'),
    title: document.querySelector('#metarl-lesson') && document.querySelector('#metarl-lesson').innerText.includes('The second episode reads the first'),
  };
  bellman.level('ensemble');
  const ensemble = {
    mounted: !!document.querySelector('#ensemble-lesson'),
    notHistory: !document.querySelector('#history-lesson'),
    title: document.querySelector('#ensemble-lesson') && document.querySelector('#ensemble-lesson').innerText.includes('Stop where the tables disagree'),
  };
  bellman.level('history');
  return { goals, metarl, ensemble, history: !!document.querySelector('#history-lesson') && !document.querySelector('#goals-lesson') };
}`);
check(peers.goals.mounted && peers.goals.notHistory && peers.goals.title, 'goals still mounts after history');
check(peers.metarl.mounted && peers.metarl.notHistory && peers.metarl.title, 'metarl still mounts after history');
check(peers.ensemble.mounted && peers.ensemble.notHistory && peers.ensemble.title, 'ensemble still mounts after history');
check(peers.history, 'history mounts again without falling through to another lesson');

const exported = evaluate(`async () => {
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"history"'), 'download control writes a save that contains history');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'history-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('history')`), 'cleared storage does not keep history');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'history-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'History save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('History save file'));
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
    history: levels.find((l) => l.id === 'history').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    historyStep: saved.lstep.history,
    historyAnswer: saved.answers['history-p'] && typeof saved.answers['history-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.history && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.historyStep === 5 && imported.historyAnswer, 'history completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    history: levels.find((l) => l.id === 'history').done,
    cliffStep: saved.lstep.cliff,
    historyStep: saved.lstep.history,
  };
}`);
check(second.slots && second.history && second.cliffStep === 2 && second.historyStep === 5, 'a second reload keeps the loaded save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('history UI checks passed');
