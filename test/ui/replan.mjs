// Desktop and phone proof for the replan lesson.
// node test/ui/replan.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8891/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-replan200',
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

function walk(width) {
  cli('emulate', '--viewport', width + 'x900x1');
  const started = evaluate(`() => {
    document.querySelector('dialog.intro button')?.click();
    bellman.level('replan');
    const root = document.querySelector('#replan-lesson');
    const rules = document.querySelector('#replan-rules');
    return {
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      title: root && root.innerText.includes('Plan once, or replan'),
      notVpo: root && !root.innerText.includes('Keep your alternatives'),
      notSupermimic: root && !root.innerText.includes('Trust, then verify'),
      goal: rules && rules.innerText.includes(CONTENT.levels.find((l) => l.id === 'replan').goal.text),
      labHidden: document.querySelector('#lab').hidden,
      customShown: !document.querySelector('#vpo-lab').hidden,
      emDash: root.innerText.includes('\\u2014') || root.innerText.includes('\\u2013'),
      gap: /bootstrap ensembles/.test(root.innerText) && /does not learn/.test(root.innerText),
    };
  }`);
  check(started.width === width && started.scroll <= width, 'no horizontal overflow before the run at ' + width);
  check(started.title && started.notVpo && started.notSupermimic, 'replan mounts its own lesson at ' + width);
  check(started.goal && started.labHidden && started.customShown && !started.emDash && started.gap, 'rules, lab, and gap text at ' + width);

  evaluate(`() => {
    const button = [...document.querySelectorAll('#replan-p .opt')].find((el) => el.innerText.includes('The plan can score well'));
    button.click();
    return true;
  }`);
  const keyed = evaluate(`() => {
    const button = document.querySelector('#replan-run');
    button.focus();
    return { focused: document.activeElement === button, height: button.getBoundingClientRect().height };
  }`);
  check(keyed.focused && keyed.height >= 32, 'run control is keyboard-focusable and tappable at ' + width);
  cli('press', 'Enter');
  const ran = evaluate(`() => {
    const readout = document.querySelector('#replan-open-readout');
    const live = BBREPLAN.rollout('open', BBREPLAN.SCHEDULES.lesson);
    return {
      readout: readout && readout.innerText,
      predicted: readout && readout.innerText.includes(String(live.predictedReturn)),
      truth: readout && readout.innerText.includes(String(live.trueReturn)),
      plans: readout && readout.innerText.includes('Plans: 1'),
      wall: document.querySelector('#replan-board') && /wall/.test(document.querySelector('#replan-board').innerText),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  }`);
  check(ran.predicted && ran.truth && ran.plans && ran.wall, 'open-loop run shows the measured mean-model gap at ' + width);
  check(ran.scroll <= ran.width, 'no horizontal overflow after the open-loop run at ' + width);

  evaluate(`() => {
    const button = [...document.querySelectorAll('#replan-d .opt')].find((el) => el.innerText.includes('without reading the true cell'));
    button.click();
    document.querySelector('#replan-repair').click();
    return true;
  }`);
  const repaired = evaluate(`() => {
    const live = BBREPLAN.compare(BBREPLAN.SCHEDULES.lesson);
    const el = document.querySelector('#replan-metrics');
    const limits = document.querySelector('#replan-limits').innerText;
    const root = document.querySelector('#replan-lesson').innerText;
    return {
      same: el.dataset.sameBudget === 'yes',
      candidates: el.dataset.candidates === String(live.budgetPerPlan.candidates),
      horizon: el.dataset.horizon === String(live.budgetPerPlan.horizon),
      openReturn: el.dataset.openReturn === String(live.open.trueReturn),
      replanReturn: el.dataset.replanReturn === String(live.closed.trueReturn),
      openPlans: el.dataset.openPlans === String(live.open.plans),
      replanPlans: el.dataset.replanPlans === String(live.closed.plans),
      openSteps: el.dataset.openSteps === String(live.open.modelSteps),
      replanSteps: el.dataset.replanSteps === String(live.closed.modelSteps),
      actions: el.dataset.replanActions === live.closed.actions.join(','),
      moreCompute: Number(el.dataset.replanSteps) > Number(el.dataset.openSteps) && Number(el.dataset.replanPlans) > Number(el.dataset.openPlans),
      recovered: live.closed.trueReturn > live.open.trueReturn && live.open.crashed && !live.closed.crashed,
      calm: /0, 0, 0, 0/.test(limits),
      hard: /\\+2, 0, 0, 0/.test(limits),
      horizonText: /Planning horizon and model error/.test(root) && /Future disturbances are still treated as zero|later disturbances are zero/.test(root),
      notSolved: /does not solve every disturbance/.test(root),
      notLearned: /not a learning update/.test(root),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      emDash: root.includes('\\u2014') || root.includes('\\u2013'),
    };
  }`);
  check(repaired.same && repaired.candidates && repaired.horizon, 'both controllers use the same per-plan budget at ' + width);
  check(repaired.openReturn && repaired.replanReturn && repaired.actions && repaired.recovered, 'screen returns match a fresh search at ' + width);
  check(repaired.openPlans && repaired.replanPlans && repaired.openSteps && repaired.replanSteps && repaired.moreCompute, 'total plans and model steps are shown at ' + width);
  check(repaired.calm && repaired.hard && repaired.horizonText && repaired.notSolved && repaired.notLearned, 'counterfactual schedules and horizon explanation at ' + width);
  check(repaired.scroll <= repaired.width && !repaired.emDash, 'no overflow or em dash after repair at ' + width);

  const gated = evaluate(`() => {
    const wrong = [...document.querySelectorAll('#replan-x .opt')].find((el) => el.innerText.includes('fitted the disturbance'));
    wrong.click();
    const blocked = document.querySelector('#replan-complete').disabled;
    const right = [...document.querySelectorAll('#replan-x .opt')].find((el) => el.innerText.includes('The next plan starts'));
    right.click();
    const ready = !document.querySelector('#replan-complete').disabled;
    document.querySelector('#replan-complete').click();
    const levels = bellman.levels();
    return {
      blocked, ready,
      done: levels.find((l) => l.id === 'replan').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  }`);
  check(gated.blocked && gated.ready && gated.done && gated.slots && !gated.cliff, 'completion appends replan and keeps the old save at ' + width);
  check(gated.scroll <= gated.width, 'no horizontal overflow when complete at ' + width);
  evaluate(`() => { document.querySelector('#replan-board').scrollIntoView({ block: 'start' }); return true; }`);
  cli('screenshot', path.join(proof, 'board-' + width + '.png'));
  return { started, ran, repaired, gated };
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
    replan: levels.find((l) => l.id === 'replan').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    replanMounted: !!document.querySelector('#replan-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.replan, 'old save keeps its current level and does not invent replan');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.replanMounted, 'opening the saved level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'replan');
      saved.lstep.replan = 0;
      for (const id of ['replan-p', 'replan-d', 'replan-x']) delete saved.answers[id];
      saved.level = 'replan';
      localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
      return true;
    }`);
    cli('open', url);
  }
  results.push({ width, ...walk(width) });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}

const nextWorld = evaluate(`() => {
  const cliff = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('The cliff edge'));
  cliff.click();
  const rules = document.querySelector('#game-rules').innerText;
  return {
    replanGone: !document.querySelector('#replan-lesson'),
    labHidden: document.querySelector('#lab').hidden,
    customHidden: document.querySelector('#vpo-lab').hidden,
    world: document.querySelector('#lab-world').textContent,
    rules: rules.slice(0, 400),
    replay: !!document.querySelector('#replay-lab'),
  };
}`);
check(nextWorld.replanGone && !nextWorld.labHidden && nextWorld.customHidden, 'leaving replan restores the standard lab');
check(nextWorld.world === 'Cliff walking' && /Goal/.test(nextWorld.rules) && nextWorld.replay, 'cliff keeps its world, rules, and replay panel');

const supermimic = evaluate(`() => {
  bellman.level('supermimic');
  return {
    own: !!document.querySelector('#supermimic-lesson'),
    notReplan: !document.querySelector('#replan-lesson'),
    title: document.querySelector('#supermimic-lesson') && document.querySelector('#supermimic-lesson').innerText.includes('Trust, then verify'),
  };
}`);
check(supermimic.own && supermimic.notReplan && supermimic.title, 'supermimic still mounts its own lesson');

const exported = evaluate(`async () => {
  bellman.level('replan');
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"replan"'), 'download control writes a save that contains replan');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'replan-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('replan')`), 'cleared storage does not keep replan');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'replan-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Replan save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Replan save file'));
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
    replan: levels.find((l) => l.id === 'replan').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    replanStep: saved.lstep.replan,
    replanAnswer: saved.answers['replan-p'] && typeof saved.answers['replan-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.replan && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.replanStep === 5 && imported.replanAnswer, 'replan completion and first-try answer reload with the save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('replan UI checks passed');
