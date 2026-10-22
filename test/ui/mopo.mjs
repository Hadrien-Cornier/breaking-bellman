// Desktop and phone proof for the disagreement penalty lesson.
// node test/ui/mopo.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8907/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-mopo200',
  CHROME_DEVTOOLS_AXI_PORT: '9591',
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
    const node = [...document.querySelectorAll('#mode-pane .node')].find((el) => el.innerText.includes('Subtract the disagreement'));
    if (!node) return { ok: false };
    node.click();
    if (map) map.open = false;
    const root = document.querySelector('#mopo-lesson');
    const rules = document.querySelector('#mopo-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'mopo').goal.text;
    return {
      ok: !!(root && root.innerText.includes('Subtract the disagreement')),
      notVpo: !document.querySelector('#vpo-lesson'),
      rules: !!(rules && rules.innerText.includes(goal) && rules.innerText.includes('absolute disagreement')),
      heading: root.innerText.includes('MOPO: Model-Based Offline Policy Optimization'),
      frozen: root.innerText.includes('cannot add a transition') || (rules && rules.innerText.includes('cannot add a transition')),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(opened.ok && opened.notVpo && opened.rules && opened.heading && opened.frozen && opened.overflow, 'title navigation opens the disagreement lesson at ' + width);

  evaluate(`() => { document.querySelector('#mopo-p-0').focus(); return true; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  check(evaluate(`() => !!document.querySelector('#mopo-run')`), 'keyboard predict opens the average at ' + width);
  check(clickText('#mopo-run', 'Score the average'), 'average scored at ' + width);
  const ran = evaluate(`() => {
    const live = BBMOPO.plan({ policy: 'average', coefficient: 0, models: BBMOPO.LESSON_MODELS });
    const el = document.querySelector('#mopo-run-readout');
    return {
      chosen: el.dataset.chosen === 'hole' && live.action.chosen === 'hole',
      truth: el.dataset.true === '0' && live.action.trueReward === 0,
      finite: !el.innerText.includes('NaN'),
    };
  }`);
  check(ran.chosen && ran.truth && ran.finite, 'the average enters the hole at ' + width);
  check(clickText('#mopo-d .opt', 'The average is high where the tables disagree'), 'diagnose answered at ' + width);

  evaluate(`() => { document.querySelector('#mopo-zero').focus(); return true; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  const zero = evaluate(`() => {
    const live = BBMOPO.plan({ policy: 'penalty', coefficient: 0, models: BBMOPO.LESSON_MODELS });
    const el = document.querySelector('#mopo-readout');
    return {
      coefficient: el.dataset.coefficient === '0' && live.coefficient === 0,
      chosen: el.dataset.chosen === live.plans.penalty.chosen && live.plans.penalty.chosen === 'hole',
      truth: el.dataset.true === '0',
      box: document.querySelector('#mopo-coefficient').value === '0',
    };
  }`);
  check(zero.coefficient && zero.chosen && zero.truth && zero.box, 'keyboard coefficient 0 enters the hole at ' + width);

  check(clickText('#mopo-lesson-tables', 'Lesson tables'), 'lesson tables restored at ' + width);
  const lesson = evaluate(`() => {
    const live = BBMOPO.plan({ policy: 'penalty', coefficient: 1, models: BBMOPO.LESSON_MODELS });
    const el = document.querySelector('#mopo-readout');
    return {
      chosen: el.dataset.chosen === 'span' && live.plans.penalty.chosen === 'span',
      truth: el.dataset.true === '3' && live.plans.penalty.trueReward === 3,
      mask: el.dataset.mask === 'home' && live.plans.mask.chosen === 'home' && live.plans.mask.refused.includes('span'),
      average: el.dataset.average === 'hole',
      frozen: el.dataset.new === '0' && live.newTransitions === 0 && live.learnedDynamics === false && el.dataset.learned === 'no',
      combo: live.comboLoss === false && el.dataset.combo === 'no',
      units: el.innerText.includes('reward points of penalty per reward point of absolute disagreement'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(lesson.chosen && lesson.truth && lesson.mask && lesson.average, 'the penalty takes Span and the mask misses it at ' + width);
  check(lesson.frozen && lesson.combo && lesson.units && lesson.overflow, 'frozen tables, units, and no overflow at ' + width);

  const edited = evaluate(`() => {
    document.querySelector('#mopo-a-span').value = '0';
    document.querySelector('#mopo-b-span').value = '0';
    document.querySelector('#mopo-a-span').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#mopo-plan').click();
    const models = {
      home: { modelA: document.querySelector('#mopo-a-home').value, modelB: document.querySelector('#mopo-b-home').value },
      hole: { modelA: document.querySelector('#mopo-a-hole').value, modelB: document.querySelector('#mopo-b-hole').value },
      span: { modelA: document.querySelector('#mopo-a-span').value, modelB: document.querySelector('#mopo-b-span').value },
    };
    const live = BBMOPO.plan({ policy: 'penalty', coefficient: document.querySelector('#mopo-coefficient').value, models });
    const el = document.querySelector('#mopo-readout');
    return {
      match: el.dataset.chosen === live.plans.penalty.chosen,
      notSpan: live.plans.penalty.chosen !== 'span',
      span: models.span.modelA === '0' && models.span.modelB === '0',
    };
  }`);
  check(edited.match && edited.notSpan && edited.span, 'the plan reads the edited model boxes at ' + width);

  if (touch) {
    const touched = evaluate(`() => {
      const button = document.querySelector('#mopo-agree-hole');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: rect.x + 8, clientY: rect.y + 8 }));
      button.click();
      const live = BBMOPO.plan({
        policy: 'penalty', coefficient: 1,
        models: {
          home: BBMOPO.LESSON_MODELS.home,
          hole: { modelA: 6, modelB: 6 },
          span: BBMOPO.LESSON_MODELS.span,
        },
      });
      const el = document.querySelector('#mopo-readout');
      return {
        chosen: el.dataset.chosen === 'hole' && live.plans.penalty.chosen === 'hole',
        truth: el.dataset.true === '0' && live.plans.penalty.trueReward === 0,
        gap: live.plans.penalty.disagreement === 0,
        limit: el.innerText.includes('Limitation'),
      };
    }`);
    check(touched.chosen && touched.truth && touched.gap && touched.limit, 'touch shows confident agreement still enters at ' + width);
  } else {
    check(clickText('#mopo-agree-hole', 'Both models agree on the Hole'), 'confident agreement preset at ' + width);
    const wrong = evaluate(`() => {
      const el = document.querySelector('#mopo-readout');
      return el.dataset.chosen === 'hole' && el.dataset.true === '0' && el.innerText.includes('Limitation');
    }`);
    check(wrong, 'confident agreement still enters at ' + width);
  }

  check(clickText('#mopo-x .opt', 'It refuses every cell'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#mopo-complete').disabled`), 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#mopo-x .opt', 'It uses the gap, not the dataset bit'), 'explanation clicked at ' + width);
  check(clickText('#mopo-complete', 'Record this plan'), 'lesson finished at ' + width);
  cli('wait', '400');
  evaluate(`() => { document.querySelector('#unlock-dismiss')?.click(); return true; }`);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'mopo').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.mopo,
      cliffStep: saved.lstep.cliff,
      offline: !!levels.find((l) => l.id === 'offline'),
      thaw: !!levels.find((l) => l.id === 'thaw'),
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2, 'completion appends mopo and keeps the old save at ' + width);
  check(gated.offline && gated.thaw, 'offline and thaw stay on the map at ' + width);

  check(clickText('#mopo-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'mopo') + 1];
    const root = document.querySelector('#mode-pane');
    return {
      id: next.id,
      title: next.title,
      custom: !!next.custom,
      mopoGone: !document.querySelector('#mopo-lesson'),
      shown: root.innerText.includes(next.title),
      labHidden: document.querySelector('#lab').hidden,
      customHidden: document.querySelector('#vpo-lab').hidden,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.id && nextWorld.id !== 'mopo' && nextWorld.mopoGone && nextWorld.shown && nextWorld.overflow, 'next level is the campaign neighbor at ' + width);
  if (nextWorld.custom) check(nextWorld.labHidden && !nextWorld.customHidden, 'custom neighbor keeps its own lab at ' + width);
  else check(!nextWorld.labHidden && nextWorld.customHidden, 'standard neighbor restores the main lab at ' + width);
  return gated;
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
    mopo: levels.find((l) => l.id === 'mopo').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    mopoMounted: !!document.querySelector('#mopo-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.mopo, 'old save keeps its current level and does not invent mopo');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.mopoMounted, 'opening the saved level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'mopo');
      saved.lstep.mopo = 0;
      for (const id of ['mopo-p', 'mopo-d', 'mopo-x']) delete saved.answers[id];
      if (Array.isArray(saved.given)) saved.given = saved.given.filter((id) => id !== 'mopo');
      saved.level = 'mopo';
      localStorage.setItem('breaking-bellman-v1', JSON.stringify(saved));
      return true;
    }`);
    cli('open', url);
    evaluate(`() => { document.querySelector('#unlock-dismiss')?.click(); return true; }`);
  }
  results.push({ width, ...walk(width, width === 390) });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}

const peers = evaluate(`() => {
  bellman.level('thaw');
  const thaw = {
    mounted: !!document.querySelector('#thaw-lesson'),
    notMopo: !document.querySelector('#mopo-lesson'),
    title: document.querySelector('#thaw-lesson') && document.querySelector('#thaw-lesson').innerText.includes('A few fresh steps'),
  };
  bellman.level('messages');
  const messages = {
    mounted: !!document.querySelector('#messages-lesson'),
    notMopo: !document.querySelector('#mopo-lesson'),
    title: document.querySelector('#messages-lesson') && document.querySelector('#messages-lesson').innerText.includes('Pass the message back'),
  };
  bellman.level('goals');
  const goals = {
    mounted: !!document.querySelector('#goals-lesson'),
    notMopo: !document.querySelector('#mopo-lesson'),
    title: document.querySelector('#goals-lesson') && document.querySelector('#goals-lesson').innerText.includes('Tell it the goal'),
  };
  bellman.level('mopo');
  const math = bellman.math();
  return {
    thaw, messages, goals,
    mopo: !!document.querySelector('#mopo-lesson') && !document.querySelector('#vpo-lesson'),
    math: math.some((line) => line.label === 'Penalized reward'),
    help: bellman.help().includes('dataset bit'),
  };
}`);
check(peers.thaw.mounted && peers.thaw.notMopo && peers.thaw.title, 'thaw still mounts after mopo');
check(peers.messages.mounted && peers.messages.notMopo && peers.messages.title, 'messages still mounts after mopo');
check(peers.goals.mounted && peers.goals.notMopo && peers.goals.title, 'goals still mounts after mopo');
check(peers.mopo && peers.math && peers.help, 'mopo mounts again with its own penalty formula');

const exported = evaluate(`async () => {
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"mopo"'), 'download control writes a save that contains mopo');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'mopo-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('mopo')`), 'cleared storage does not keep mopo');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'mopo-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Mopo save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Mopo save file'));
const uid = line && (line.match(/uid=(\S+)/) || [])[1];
if (!uid) throw new Error('load control did not expose a file input\n' + snap.slice(0, 2500));
cli('upload', '@' + uid, uploadPath);
fs.unlinkSync(uploadPath);
cli('wait', '2000');
const imported = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    mopo: levels.find((l) => l.id === 'mopo').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    mopoStep: saved.lstep.mopo,
    mopoAnswer: saved.answers['mopo-p'] && typeof saved.answers['mopo-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.mopo && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.mopoStep === 5 && imported.mopoAnswer, 'mopo completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  document.querySelector('#unlock-dismiss')?.click();
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    mopo: levels.find((l) => l.id === 'mopo').done,
    cliffStep: saved.lstep.cliff,
    mopoStep: saved.lstep.mopo,
  };
}`);
check(second.slots && second.mopo && second.cliffStep === 2 && second.mopoStep === 5, 'a second reload keeps the loaded save');
cli('screenshot', path.join(proof, 'reloaded.png'));
const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
if (/pageerror|Error/.test(consoleText) && !/Download the React DevTools/.test(consoleText)) {
  const errors = consoleText.split('\n').filter((row) => /error|Error|pageerror/i.test(row) && !/Download the React DevTools/.test(row));
  if (errors.length) throw new Error(errors.join('\n'));
}
console.log('mopo ui proof written to ' + proof);
