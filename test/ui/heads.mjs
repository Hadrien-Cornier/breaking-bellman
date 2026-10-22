// Desktop and phone proof for the action-head lesson.
// node test/ui/heads.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../../src/agents/heads.js');
const [proof, url = 'http://127.0.0.1:8767/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-actionheads203',
  CHROME_DEVTOOLS_AXI_PORT: '9493',
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
const QUOTE = 'oversmoothed the training data with respect to time';

function near(actual, expected) {
  return typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) <= 1e-9;
}
function num(value) {
  return value === 'undefined' ? null : Number(value);
}

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  const started = evaluate(`() => {
    bellman.level('heads');
    const root = document.querySelector('#heads-lesson');
    const rules = document.querySelector('#heads-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'heads').goal.text;
    return {
      title: !!(root && root.innerText.includes('Average the corner, or keep it')),
      notVpo: !document.querySelector('#vpo-lesson'),
      notMessages: !document.querySelector('#messages-lesson'),
      goal: !!(rules && rules.innerText.includes(goal)),
      quote: !!(root && root.innerText.includes(${JSON.stringify(QUOTE)})),
      bins: !!(root && root.innerText.includes('512') && root.innerText.includes('8 bins')),
      illustrative: !!(root && /illustrative/i.test(root.innerText)),
      runHidden: !document.querySelector('#heads-run'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
      labHidden: document.querySelector('#lab').hidden,
      customShown: !document.querySelector('#vpo-lab').hidden,
    };
  }`);
  check(started.title && started.notVpo && started.notMessages && started.labHidden && started.customShown, 'heads mounts its own lesson at ' + width);
  check(started.goal && started.quote && started.bins && started.illustrative && started.runHidden && started.overflow, 'rules, quote, bin disclosure, and no overflow before the run at ' + width);

  check(clickText('#heads-p .opt', 'The average is a third chunk'), 'predict answer clicked at ' + width);
  check(clickText('#heads-run', 'Score both heads'), 'score clicked at ' + width);
  const scored = evaluate(`() => {
    const el = document.querySelector('#heads-readout');
    return {
      ratio0: el.dataset.ratio0, ratio1: el.dataset.ratio1, mean: el.dataset.meanJerk,
      pair: el.dataset.pairInvalid, chunk: el.dataset.chunkInvalid,
      misses: el.dataset.misses,
      bins: el.dataset.bins, demos: el.dataset.demos, commands: el.dataset.commands,
      binMse: el.dataset.binMse, regMse: el.dataset.regressionMse, below: el.dataset.below,
      illustrative: el.dataset.illustrative, text: el.innerText,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  const live = H.score(H.CORNERS);
  const base = H.refine(H.CORNERS, 'independent', 0);
  check(near(num(scored.mean), live.meanJerk) && near(num(scored.ratio0), live.ratios[0]) && near(num(scored.ratio1), live.ratios[1]), 'average jerk ratios match a fresh score at ' + width);
  check(scored.below === 'yes' && scored.bins === '8' && scored.demos === '2' && scored.commands === '6', 'shared budget is on the readout at ' + width);
  const liveMisses = base.splitAtoms.filter((atom) => !atom.demonstrated && atom.p > 0).map((atom) => atom.x + ',' + atom.y + '@' + String(Math.round(atom.p * 1e9) / 1e9)).join('|');
  check(near(num(scored.pair), base.pairInvalid) && near(num(scored.chunk), base.chunkInvalid) && scored.misses === liveMisses && scored.misses.includes('0,0@0.25') && scored.misses.includes('1,1@0.25'), 'both missing pairs are computed at ' + width);
  check(scored.illustrative === 'yes' && /Not a robot benchmark/.test(scored.text) && !/0\.07/.test(scored.text) && scored.overflow, 'the toy readout is not the RoboCasa median at ' + width);
  check(num(scored.binMse) === 0 && num(scored.regMse) > 0, 'bin error is zero only because these commands sit on centers at ' + width);

  check(clickText('#heads-d .opt', 'Command 2 can pair x from one path'), 'diagnose clicked at ' + width);
  check(clickText('#heads-coordinate', 'Condition y on x'), 'coordinate pass clicked at ' + width);
  const coord = evaluate(`() => {
    const el = document.querySelector('#heads-coordinate-readout');
    return { pair: el.dataset.pairInvalid, chunk: el.dataset.chunkInvalid, steps: el.dataset.steps, demos: el.dataset.demos };
  }`);
  const coordLive = H.refine(H.CORNERS, 'coordinate', 1);
  check(num(coord.pair) === 0 && near(num(coord.chunk), coordLive.chunkInvalid) && num(coord.chunk) > 0 && coord.steps === '1' && coord.demos === '2', 'conditioning y on x removes the pair and leaves a stitched chunk at ' + width);

  check(clickText('#heads-redraw', 'Repeat the independent draw'), 'redraw clicked at ' + width);
  const redraw = evaluate(`() => {
    const el = document.querySelector('#heads-redraw-readout');
    return { pair: el.dataset.pairInvalid, chunk: el.dataset.chunkInvalid, steps: el.dataset.steps, trace: el.dataset.trace };
  }`);
  check(redraw.steps === '5' && redraw.trace === '6' && near(num(redraw.pair), base.pairInvalid) && near(num(redraw.chunk), base.chunkInvalid), 'five independent passes leave the product unchanged at ' + width);

  check(clickText('#heads-time', 'Condition each coordinate on its own previous command'), 'time pass clicked at ' + width);
  const time = evaluate(`() => {
    const el = document.querySelector('#heads-time-readout');
    return { pair: el.dataset.pairInvalid, chunk: el.dataset.chunkInvalid };
  }`);
  const timeLive = H.refine(H.CORNERS, 'time', 1);
  check(near(num(time.pair), base.pairInvalid) && near(num(time.chunk), timeLive.chunkInvalid) && num(time.chunk) > 0, 'time-only conditioning leaves the missing pair at ' + width);

  check(clickText('#heads-pair', 'Condition the pair on the previous pair'), 'pair pass clicked at ' + width);
  const pair = evaluate(`() => {
    const el = document.querySelector('#heads-pair-readout');
    return { pair: el.dataset.pairInvalid, chunk: el.dataset.chunkInvalid };
  }`);
  check(num(pair.pair) === 0 && num(pair.chunk) === 0, 'pair conditioning clears the chunk at ' + width);

  evaluate(`() => { document.querySelector('#heads-line').focus(); return true; }`);
  cli('press', 'Enter');
  const line = evaluate(`() => {
    const el = document.querySelector('#heads-line-readout');
    return el && { ratio: el.dataset.ratio0, jerk: el.dataset.jerk0, mean: el.dataset.meanJerk, text: el.innerText };
  }`);
  check(line && line.ratio === 'undefined' && num(line.jerk) === 0 && num(line.mean) === 0 && /undefined/.test(line.text), 'Enter on the straight line leaves the ratio undefined at ' + width);

  check(clickText('#heads-smooth', 'Score the smooth ramp'), 'smooth ramp clicked at ' + width);
  const smooth = evaluate(`() => {
    const el = document.querySelector('#heads-smooth-readout');
    return { ratio: el.dataset.ratio0, bin: el.dataset.binMse, reg: el.dataset.regressionMse, binJerk: el.dataset.binJerk, overflow: document.documentElement.scrollWidth <= innerWidth };
  }`);
  const smoothLive = H.score(H.SMOOTH);
  check(smooth.ratio === 'undefined' && num(smooth.reg) === 0 && near(num(smooth.bin), smoothLive.binMse) && num(smooth.binJerk) > 0 && smooth.overflow, 'the ramp shows bin error with an undefined ratio at ' + width);

  check(evaluate(`() => document.querySelector('#heads-complete').disabled`) === true, 'complete stays blocked before the explanation at ' + width);
  check(clickText('#heads-x .opt', 'More independent passes remove'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#heads-complete').disabled`) === true, 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#heads-x .opt', 'Five more independent passes leave the missing pair'), 'explanation clicked at ' + width);
  check(clickText('#heads-complete', 'Finish lesson'), 'lesson finished at ' + width);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'heads').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.heads,
      cliffStep: saved.lstep.cliff,
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2, 'completion appends heads and keeps the old save at ' + width);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#heads-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'heads') + 1];
    const rules = document.querySelector('#game-rules');
    return {
      id: next.id,
      title: next.title,
      headsGone: !document.querySelector('#heads-lesson'),
      labHidden: document.querySelector('#lab').hidden,
      customHidden: document.querySelector('#vpo-lab').hidden,
      world: document.querySelector('#lab-world').textContent,
      rules: rules ? rules.innerText : '',
      goal: next.goal.text,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.id === 'pick' && nextWorld.headsGone && !nextWorld.labHidden && nextWorld.customHidden, 'next level leaves the heads mount at ' + width);
  check(nextWorld.world === 'Fork in the road' && nextWorld.rules.includes(nextWorld.goal) && nextWorld.overflow, 'next level keeps its world and rules at ' + width);
}

cli('open', url);
evaluate(`() => { localStorage.setItem('breaking-bellman-v1', ${JSON.stringify(JSON.stringify(OLD_SAVE))}); return true; }`);
cli('open', url);
const preserved = evaluate(`() => {
  document.querySelector('dialog.intro button')?.click();
  const levels = bellman.levels();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  return {
    level: saved.level,
    slots: levels.find((l) => l.id === 'slots').done,
    heads: levels.find((l) => l.id === 'heads').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    headsMounted: !!document.querySelector('#heads-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.heads, 'old save keeps its current level and does not invent heads');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.headsMounted, 'opening the saved level shows cliff rules');

for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'heads');
      saved.lstep.heads = 0;
      for (const id of ['heads-p', 'heads-d', 'heads-x']) delete saved.answers[id];
      saved.level = 'heads';
      localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
      return true;
    }`);
    cli('open', url);
  }
  walk(width, width === 390);
}

const peers = evaluate(`() => {
  bellman.level('goals');
  const goals = { mounted: !!document.querySelector('#goals-lesson'), notHeads: !document.querySelector('#heads-lesson'), title: document.querySelector('#goals-lesson') && document.querySelector('#goals-lesson').innerText.includes('Tell it the goal') };
  bellman.level('messages');
  const messages = { mounted: !!document.querySelector('#messages-lesson'), notHeads: !document.querySelector('#heads-lesson'), title: document.querySelector('#messages-lesson') && document.querySelector('#messages-lesson').innerText.includes('Pass the message back') };
  bellman.level('twoways');
  const twoways = { id: JSON.parse(localStorage.getItem('breaking-bellman-v1')).level, heads: !!document.querySelector('#heads-lesson'), title: document.body.innerText.includes('Two good ways') };
  bellman.level('heads');
  return { goals, messages, twoways, heads: !!document.querySelector('#heads-lesson') && !document.querySelector('#vpo-lesson') };
}`);
check(peers.goals.mounted && peers.goals.notHeads && peers.goals.title, 'goals still mounts after heads');
check(peers.messages.mounted && peers.messages.notHeads && peers.messages.title, 'messages still mounts after heads');
check(peers.twoways.id === 'twoways' && !peers.twoways.heads && peers.twoways.title, 'two good ways stays the previous level');
check(peers.heads, 'heads mounts again without falling through to VPO');

const exported = evaluate(`async () => {
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"heads"'), 'download control writes a save that contains heads');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'heads-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('heads')`), 'cleared storage does not keep heads');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'heads-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Heads save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Heads save file'));
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
    heads: levels.find((l) => l.id === 'heads').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    headsStep: saved.lstep.heads,
    headsAnswer: saved.answers['heads-p'] && typeof saved.answers['heads-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.heads && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.headsStep === 5 && imported.headsAnswer, 'heads completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    heads: levels.find((l) => l.id === 'heads').done,
    cliffStep: saved.lstep.cliff,
    headsStep: saved.lstep.heads,
    level: saved.level,
  };
}`);
check(second.slots && second.heads && second.cliffStep === 2 && second.headsStep === 5, 'a second reload keeps the loaded save');
const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('heads UI checks passed');
