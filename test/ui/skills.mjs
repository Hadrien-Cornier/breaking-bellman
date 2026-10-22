// Desktop and phone proof for the skills lesson.
// node test/ui/skills.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:18923/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-cs285-skills200',
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
  app: 'breaking-bellman',
  version: 1,
  exported: '2026-10-18T22:51:18.358Z',
  progress: {
    intro: 1, mode: 'campaign', level: 'cliff',
    done: ['slots'],
    lstep: { slots: 5, cliff: 2 },
    answers: {
      'slots-p': { choice: 1, correct: false, ts: '2020-01-01T00:00:00.000Z' },
      'cliff-p': { choice: 0, correct: true, ts: '2020-01-01T00:00:00.000Z' },
    },
    found: ['egreedy'], given: [], seen: [], missions: [], saved: [], made: {},
    reviews: {}, unlockAll: false, discoveries: {}, wondered: {},
  },
};
const oldPath = path.join(proof, 'old-save.json');
fs.writeFileSync(oldPath, JSON.stringify(OLD_SAVE, null, 2));

function workspaceCopy(filePath) {
  const dest = path.join(process.cwd(), 'dist', 'skills-upload-' + path.basename(filePath));
  fs.copyFileSync(filePath, dest);
  return dest;
}
function loadFile(filePath, label) {
  const uploadPath = workspaceCopy(filePath);
  evaluate(`() => {
    const details = document.querySelector('details.map-card');
    if (details) details.open = true;
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
    button.click();
    const input = document.querySelector('input[type=file]');
    input.id = 'skills-save-file';
    input.hidden = false;
    input.removeAttribute('hidden');
    input.style.position = 'fixed';
    input.style.top = '0';
    input.style.left = '0';
    input.style.opacity = '1';
    input.style.zIndex = '9999';
    input.setAttribute('aria-label', ${JSON.stringify(label)});
    document.body.prepend(input);
    return input.getAttribute('aria-label');
  }`);
  const snap = cli('snapshot');
  const line = snap.split('\n').find((row) => row.includes(label));
  const uid = line && (line.match(/uid=(\S+)/) || [])[1];
  if (!uid) throw new Error('load control did not expose a file input\n' + snap.slice(0, 2000));
  cli('upload', '@' + uid, uploadPath);
  fs.unlinkSync(uploadPath);
  cli('wait', '2000');
}

function walk(width) {
  cli('emulate', '--viewport', width + 'x' + (width < 500 ? 844 : 900) + 'x1');
  const started = evaluate(`() => {
    document.querySelector('dialog.intro button')?.click();
    bellman.level('skills');
    const root = document.querySelector('#skills-lesson');
    const rules = document.querySelector('#skills-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'skills').goal.text;
    return {
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      title: root && root.innerText.includes('Pay a skill for being identifiable'),
      notVpo: root && !root.innerText.includes('Keep your alternatives'),
      notSupermimic: root && !root.innerText.includes('Trust, then verify'),
      goal: rules && rules.innerText.includes(goal),
      labHidden: document.querySelector('#lab').hidden,
      customShown: !document.querySelector('#vpo-lab').hidden,
      emDash: root.innerText.includes('\\u2014') || root.innerText.includes('\\u2013'),
      mounted: !root.innerText.includes('This lesson is not mounted'),
    };
  }`);
  check(started.width === width && started.scroll <= width, 'no horizontal overflow before the run at ' + width);
  check(started.title && started.notVpo && started.notSupermimic && started.mounted, 'skills mounts its own lesson at ' + width);
  check(started.goal && started.labHidden && started.customShown && !started.emDash, 'rules, lab, and no em dash at ' + width);

  evaluate(`() => {
    const button = [...document.querySelectorAll('#skills-p .opt')].find((el) => el.innerText.includes('q is 1/2'));
    button.click();
    return true;
  }`);
  const keyed = evaluate(`() => {
    const button = document.querySelector('#skills-run');
    button.focus();
    return { focused: document.activeElement === button, height: button.getBoundingClientRect().height };
  }`);
  check(keyed.focused && keyed.height >= 44, 'fit control is keyboard-focusable and at least 44px at ' + width);
  cli('press', 'Enter');
  const fitted = evaluate(`() => {
    const root = document.querySelector('#skills-lesson').innerText;
    const sym = document.querySelector('#skills-sym-fit').innerText;
    const plan = document.querySelector('#skills-plan-fit').innerText;
    return {
      sym, plan, uniform: root.includes('Policies are still uniform'),
      noUpdate: !document.querySelector('#skills-live'),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  }`);
  check(fitted.sym && fitted.sym.includes('q(red) 5/10 (0.5)') && fitted.sym.includes('reward red 0'), 'symmetric fit is one half and reward 0 at ' + width);
  check(fitted.plan && fitted.plan.includes('q(red) 7/10') && fitted.uniform && fitted.noUpdate, 'exploration plan shows 7/10 before any policy update at ' + width);
  check(fitted.scroll <= fitted.width, 'no horizontal overflow after the fit at ' + width);

  evaluate(`() => {
    const button = [...document.querySelectorAll('#skills-d .opt')].find((el) => el.innerText.includes('more probable than the prior'));
    button.click();
    return true;
  }`);
  const repairHeight = evaluate(`() => {
    const button = document.querySelector('#skills-apply-discriminator');
    return { height: button.getBoundingClientRect().height, text: button.innerText };
  }`);
  check(repairHeight.height >= 44, 'repair control is at least 44px at ' + width);

  evaluate(`() => { document.querySelector('#skills-apply-symmetric').click(); return true; }`);
  const symmetric = evaluate(`() => {
    const live = document.querySelector('#skills-live').innerText;
    const counter = document.querySelector('#skills-counterexample').innerText;
    return { live, counter, scroll: document.documentElement.scrollWidth, width: innerWidth };
  }`);
  check(symmetric.live.includes('do not split') && symmetric.counter.includes('do not split'), 'symmetric data does not split at ' + width);
  check(symmetric.scroll <= symmetric.width, 'no horizontal overflow on the counterexample at ' + width);

  evaluate(`() => { document.querySelector('#skills-apply-discriminator').click(); return true; }`);
  const split = evaluate(`() => {
    const fresh = BBSKILLS.compare().disc;
    const live = document.querySelector('#skills-live').innerText;
    return {
      live,
      redLine: live.split('\\n').map((line) => line.trim()).find((line) => line.startsWith('Red')),
      blueLine: live.split('\\n').map((line) => line.trim()).find((line) => line.startsWith('Blue')),
      red: fresh.policies.red.action,
      blue: fresh.policies.blue.action,
      pi: fresh.policies.red.pi.west,
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  }`);
  check(split.red === 'west' && split.blue === 'east' && split.redLine && split.redLine.includes('Greedy west') && split.blueLine && split.blueLine.includes('Greedy east'), 'plan update separates the skills at ' + width);
  check(split.live.includes(String(Math.round(split.pi * 1000) / 1000)), 'screen probability matches a fresh train() at ' + width);
  check(split.scroll <= split.width, 'no horizontal overflow after separation at ' + width);

  evaluate(`() => {
    const input = document.querySelector('#skills-n-red-west');
    input.value = '9';
    input.dispatchEvent(new Event('change'));
    return true;
  }`);
  const edited = evaluate(`() => document.querySelector('#skills-live-fit').innerText`);
  check(edited.includes('visits red 9') && edited.includes('10/13'), 'editing a visit count refits q at ' + width);
  evaluate(`() => { document.querySelector('#skills-apply-discriminator').click(); return true; }`);
  evaluate(`() => {
    document.querySelector('#skills-alpha').value = '8';
    document.querySelector('#skills-alpha').dispatchEvent(new Event('change'));
    return true;
  }`);
  const smoothed = evaluate(`() => {
    const heavy = BBSKILLS.train({ counts: BBSKILLS.exactPlanCounts({ budgetPerSkill: 8, bias: 0.25 }).counts, mode: 'discriminator', alpha: 8, prior: 0.5, eta: 1, updates: 4, tieBreak: false });
    const live = document.querySelector('#skills-live').innerText;
    const shown = Math.round(heavy.policies.red.pi.west * 1000) / 1000;
    return { live, shown, smaller: heavy.policies.red.pi.west < ${split.pi} };
  }`);
  check(smoothed.smaller && smoothed.live.includes(String(smoothed.shown)), 'smoothing 8 changes the policy probability at ' + width);

  evaluate(`() => { document.querySelector('#skills-apply-discriminator').click(); return true; }`);
  evaluate(`() => { document.querySelector('#skills-swap').click(); return true; }`);
  const swapped = evaluate(`() => {
    const lines = document.querySelector('#skills-live').innerText.split('\\n').map((line) => line.trim());
    const red = lines.find((line) => line.startsWith('Red'));
    const blue = lines.find((line) => line.startsWith('Blue'));
    return { red, blue };
  }`);
  check(swapped.red && swapped.red.includes('Greedy east') && swapped.blue && swapped.blue.includes('Greedy west'), 'swapping the visits swaps the update at ' + width);

  evaluate(`() => { document.querySelector('#skills-apply-shared').click(); return true; }`);
  const shared = evaluate(`() => document.querySelector('#skills-live').innerText`);
  check(shared.includes('do not split') && shared.includes('Mode shared'), 'shared reward on the same visits does not split at ' + width);

  evaluate(`() => { document.querySelector('#skills-apply-discriminator').click(); return true; }`);
  const gated = evaluate(`() => {
    const wrong = [...document.querySelectorAll('#skills-x .opt')].find((el) => el.innerText.includes('mutual information of the updated policy'));
    wrong.click();
    const blocked = document.querySelector('#skills-complete').disabled;
    const right = [...document.querySelectorAll('#skills-x .opt')].find((el) => el.innerText.includes('Symmetric visits keep the reward at 0'));
    right.click();
    const ready = !document.querySelector('#skills-complete').disabled;
    document.querySelector('#skills-complete').click();
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      blocked, ready,
      skills: levels.find((l) => l.id === 'skills').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      cliffStep: saved.lstep.cliff,
      slotsStep: saved.lstep.slots,
      slotsAnswer: saved.answers['slots-p'].choice,
      skillsStep: saved.lstep.skills,
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      next: document.querySelector('#skills-next') && document.querySelector('#skills-next').innerText,
    };
  }`);
  check(gated.blocked && gated.ready && gated.skills && gated.slots && !gated.cliff, 'completion appends skills and keeps the old save at ' + width);
  check(gated.cliffStep === 2 && gated.slotsStep === 5 && gated.slotsAnswer === 1 && gated.skillsStep === 5, 'old lstep and the new completion are both stored at ' + width);
  check(gated.scroll <= gated.width && /A miss is a hit/.test(gated.next), 'next control names the hindsight lesson at ' + width);
  const shot = path.join(process.cwd(), 'dist', 'skills-' + width + '.png');
  cli('screenshot', shot);
  fs.copyFileSync(shot, path.join(proof, 'skills-' + width + '.png'));
  fs.unlinkSync(shot);

  evaluate(`() => { document.querySelector('#skills-next').click(); return true; }`);
  const next = evaluate(`() => {
    const root = document.querySelector('#hindsight-lesson');
    const rules = document.querySelector('#hindsight-rules');
    return {
      skillsGone: !document.querySelector('#skills-lesson'),
      title: root && root.innerText.includes('A miss is a hit for another goal'),
      rules: rules && rules.innerText.includes('Reach the cell you are asked for'),
      customShown: !document.querySelector('#vpo-lab').hidden,
      labHidden: document.querySelector('#lab').hidden,
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  }`);
  check(next.skillsGone && next.title && next.rules && next.customShown && next.labHidden, 'next opens hindsight with its own rules at ' + width);
  check(next.scroll <= next.width, 'no horizontal overflow on the next lesson at ' + width);

  evaluate(`() => {
    const details = document.querySelector('details.map-card');
    if (details) details.open = true;
    const slots = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('Ten slot machines'));
    slots.click();
    return true;
  }`);
  const slots = evaluate(`() => ({
    skillsGone: !document.querySelector('#skills-lesson'),
    hindsightGone: !document.querySelector('#hindsight-lesson'),
    labHidden: document.querySelector('#lab').hidden,
    customHidden: document.querySelector('#vpo-lab').hidden,
    world: document.querySelector('#lab-world').textContent,
    rules: (document.querySelector('#game-rules') || document.querySelector('#challenge-rules') || {}).innerText || '',
  })`);
  check(slots.skillsGone && slots.hindsightGone && !slots.labHidden && slots.customHidden, 'slots restores the standard lab at ' + width);
  check(slots.world === 'Ten slot machines' && /machine|pull/i.test(slots.rules), 'slots keeps its world and rules at ' + width);
  return gated;
}

cli('open', url);
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
loadFile(oldPath, 'Skills import start');
const preserved = evaluate(`() => {
  document.querySelector('dialog.intro button')?.click();
  const levels = bellman.levels();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  return {
    level: saved.level,
    slots: levels.find((l) => l.id === 'slots').done,
    skills: levels.find((l) => l.id === 'skills').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    skillsMounted: !!document.querySelector('#skills-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.skills, 'loaded save keeps cliff and does not invent skills');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'loaded lstep and first-try answer survive');
check(/Cliff|cliff|goal/i.test(preserved.rules) && !preserved.skillsMounted, 'loaded level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) loadFile(oldPath, 'Skills import phone');
  results.push({ width, ...walk(width) });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}

const exported = evaluate(`async () => {
  bellman.level('skills');
  const details = document.querySelector('details.map-card');
  if (details) details.open = true;
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"skills"'), 'download control writes a save that contains skills');
const roundPath = path.join(proof, 'roundtrip.json');
fs.writeFileSync(roundPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

loadFile(oldPath, 'Skills import reset');
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes('skills')`), 'loading the old file removes the new completion');
loadFile(roundPath, 'Skills import roundtrip');
cli('open', url);
const imported = evaluate(`() => {
  document.querySelector('dialog.intro button')?.click();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    skills: levels.find((l) => l.id === 'skills').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    skillsStep: saved.lstep.skills,
    skillsAnswer: saved.answers['skills-p'] && typeof saved.answers['skills-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.skills && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.skillsStep === 5 && imported.skillsAnswer, 'skills completion and first-try answer reload with the save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('skills UI checks passed');
