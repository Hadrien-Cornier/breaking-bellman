// Desktop and phone proof for the messages lesson.
// node test/ui/messages.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [proof, url = 'http://127.0.0.1:8892/'] = process.argv.slice(2);
if (!proof) throw new Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: 'bb-messages200',
  CHROME_DEVTOOLS_AXI_PORT: '9477',
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
function fmt(x) {
  if (x == null || !Number.isFinite(x)) return 'undefined';
  return (Math.round(x * 10000) / 10000).toFixed(4);
}

function walk(width, touch) {
  cli('emulate', '--viewport', width + 'x900x1' + (touch ? ',mobile,touch' : ''));
  const started = evaluate(`() => {
    bellman.level('messages');
    const root = document.querySelector('#messages-lesson');
    const rules = document.querySelector('#messages-rules');
    const goal = CONTENT.levels.find((l) => l.id === 'messages').goal.text;
    return {
      title: !!(root && root.innerText.includes('Pass the message back')),
      notVpo: !document.querySelector('#vpo-lesson'),
      notReplan: !document.querySelector('#replan-lesson'),
      notSupermimic: !document.querySelector('#supermimic-lesson'),
      goal: !!(rules && rules.innerText.includes(goal)),
      deterministic: !!(rules && rules.innerText.includes('Deterministic table')),
      runHidden: !document.querySelector('#messages-run'),
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(started.title && started.notVpo && started.notReplan && started.notSupermimic, 'messages mounts its own lesson at ' + width);
  check(started.goal && started.deterministic && started.runHidden && started.overflow, 'rules, deterministic caveat, and no overflow before the run at ' + width);

  check(clickText('#messages-p .opt', 'The left cell. Left from the left cell stays there'), 'predict answer clicked at ' + width);
  check(clickText('#messages-run', 'Roll the prior-only policy'), 'prior roll clicked at ' + width);
  const prior = evaluate(`() => {
    const live = BBMESSAGES.solve(BBMESSAGES.lessonModel({ policy: 'prior' }));
    const el = document.querySelector('#messages-prior-readout');
    return {
      path: el && el.dataset.path === live.path.join(','),
      reached: el && el.dataset.reached === 'no' && live.reached === false,
      end: el && el.dataset.end === '0',
      actions: el && el.dataset.actions === 'left,left',
    };
  }`);
  check(prior.path && prior.reached && prior.end && prior.actions, 'prior-only walk stays on the left cell at ' + width);

  check(clickText('#messages-d .opt', 'The backward message'), 'diagnose answer clicked at ' + width);
  check(clickText('#messages-repair', 'Recompute the backward messages'), 'repair clicked at ' + width);
  const repaired = evaluate(`() => {
    const live = BBMESSAGES.solve(BBMESSAGES.lessonModel());
    const el = document.querySelector('#messages-readout');
    const start = live.rows.filter((row) => row.t === 1 && row.state === live.start);
    const left = start.find((row) => row.action === 'left');
    const right = start.find((row) => row.action === 'right');
    const round = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
    return {
      path: el.dataset.path === live.path.join(','),
      reached: el.dataset.reached === 'yes' && live.reached === true,
      beta: el.dataset.betaLeft === round(left.beta) && el.dataset.betaRight === round(right.beta),
      pi: el.dataset.piLeft === round(left.posterior) && el.dataset.piRight === round(right.posterior),
      priorRemains: Number(el.dataset.piLeft) > 0 && Number(el.dataset.piRight) > 0,
      messagePrefersRight: right.beta > left.beta,
      posteriorPrefersRight: right.posterior > left.posterior,
      sequences: el.dataset.sequences === '4',
      deterministic: el.dataset.deterministic === 'yes',
      rows: document.querySelectorAll('#messages-table tbody tr').length === live.rows.length,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(repaired.path && repaired.reached && repaired.beta && repaired.pi, 'repair readout matches a fresh backup at ' + width);
  check(repaired.priorRemains && repaired.messagePrefersRight && repaired.posteriorPrefersRight, 'the prior is still in the conditioned probability at ' + width);
  check(repaired.sequences && repaired.deterministic && repaired.rows && repaired.overflow, 'finite horizon, full table, and no overflow at ' + width);

  evaluate(`() => { document.querySelector('#messages-horizon-1').focus(); return true; }`);
  cli('press', 'Enter');
  cli('wait', '200');
  const keyed = evaluate(`() => {
    const live = BBMESSAGES.solve(BBMESSAGES.lessonModel({ horizon: 1 }));
    const el = document.querySelector('#messages-readout');
    return {
      horizon: el.dataset.horizon === '1' && live.horizon === 1,
      reached: el.dataset.reached === (live.reached ? 'yes' : 'no'),
      path: el.dataset.path === (live.path ? live.path.join(',') : ''),
      missed: live.reached === false,
    };
  }`);
  check(keyed.horizon && keyed.reached && keyed.path && keyed.missed, 'keyboard horizon 1 recomputes a miss at ' + width);

  if (touch) {
    const touched = evaluate(`() => {
      const button = document.querySelector('#messages-goal-left');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: rect.x + 4, clientY: rect.y + 4 }));
      button.click();
      const live = BBMESSAGES.solve(BBMESSAGES.lessonModel({ horizon: 1, goal: 0 }));
      const el = document.querySelector('#messages-readout');
      return {
        goal: el.dataset.goal === '0',
        matches: el.dataset.reached === (live.reached ? 'yes' : 'no') && el.dataset.path === (live.path ? live.path.join(',') : ''),
        changed: el.dataset.goal !== '2',
      };
    }`);
    check(touched.goal && touched.matches && touched.changed, 'touch changes the goal and recomputes at ' + width);
    check(clickText('#messages-goal-right', 'Goal on the right'), 'goal returned to the right at ' + width);
  }

  check(clickText('#messages-prior-zero', 'Prior 0 on right'), 'zero prior clicked at ' + width);
  const zero = evaluate(`() => {
    const live = BBMESSAGES.solve(BBMESSAGES.lessonModel({ prior: BBMESSAGES.ZERO_RIGHT, horizon: 1 }));
    const el = document.querySelector('#messages-readout');
    const text = document.querySelector('#messages-table').innerText;
    return {
      matches: el.dataset.priorLeft === '1' && el.dataset.reached === (live.reached ? 'yes' : 'no'),
      finite: !text.includes('NaN') && !text.includes('Infinity'),
      blocked: live.reached === false,
    };
  }`);
  check(zero.matches && zero.finite && zero.blocked, 'zero right-prior stays finite and misses at ' + width);

  check(clickText('#messages-horizon-2', 'Horizon 2'), 'horizon returned to 2 at ' + width);
  const zeroLong = evaluate(`() => {
    const live = BBMESSAGES.solve(BBMESSAGES.lessonModel({ prior: BBMESSAGES.ZERO_RIGHT }));
    const mid = live.rows.find((row) => row.t === 2 && row.state === 1 && row.action === 'right');
    const text = document.querySelector('#messages-readout').innerText + document.querySelector('#messages-table').innerText;
    return {
      raw: mid.beta === 1 && mid.posterior === 0,
      shown: text.includes('1.0000') && text.includes('0.0000'),
      undefinedFree: !text.includes('NaN'),
    };
  }`);
  check(zeroLong.raw && zeroLong.shown && zeroLong.undefinedFree, 'raw message stays 1 when the conditioned probability is 0 at ' + width);

  check(clickText('#messages-prior-lesson', 'Prior 0.70 left'), 'lesson prior restored at ' + width);
  const blocked = evaluate(`() => document.querySelector('#messages-complete').disabled`);
  check(blocked === true, 'complete stays blocked before the explanation at ' + width);
  check(clickText('#messages-x .opt', 'Any prior above zero is erased'), 'wrong explanation clicked at ' + width);
  check(evaluate(`() => document.querySelector('#messages-complete').disabled`) === true, 'a wrong explanation does not finish the lesson at ' + width);
  check(clickText('#messages-x .opt', 'It multiplies the prior by the raw message'), 'explanation clicked at ' + width);
  check(clickText('#messages-complete', 'Finish lesson'), 'lesson finished at ' + width);
  const gated = evaluate(`() => {
    const levels = bellman.levels();
    const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
    return {
      done: levels.find((l) => l.id === 'messages').done,
      slots: levels.find((l) => l.id === 'slots').done,
      cliff: levels.find((l) => l.id === 'cliff').done,
      step: saved.lstep.messages,
      cliffStep: saved.lstep.cliff,
    };
  }`);
  check(gated.done && gated.slots && !gated.cliff && gated.step === 5 && gated.cliffStep === 2, 'completion appends messages and keeps the old save at ' + width);

  evaluate(`() => { document.querySelector('#messages-table').scrollIntoView({ block: 'start' }); return true; }`);
  cli('screenshot', path.join(proof, 'lesson-' + width + '.png'));
  check(clickText('#messages-next', 'Next level:'), 'next level clicked at ' + width);
  const nextWorld = evaluate(`() => {
    const next = CONTENT.levels[CONTENT.levels.findIndex((l) => l.id === 'messages') + 1];
    const rules = document.querySelector('#game-rules');
    return {
      id: next.id,
      messagesGone: !document.querySelector('#messages-lesson'),
      labHidden: document.querySelector('#lab').hidden,
      customHidden: document.querySelector('#vpo-lab').hidden,
      world: document.querySelector('#lab-world').textContent,
      rules: rules ? rules.innerText : '',
      goal: next.goal.text,
      overflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }`);
  check(nextWorld.id === 'offline' && nextWorld.messagesGone && !nextWorld.labHidden && nextWorld.customHidden, 'next level leaves the messages mount at ' + width);
  check(nextWorld.world === 'Arm reach' && nextWorld.rules.includes(nextWorld.goal) && nextWorld.overflow, 'next level keeps its world and rules at ' + width);
  return { started, repaired, gated };
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
    messages: levels.find((l) => l.id === 'messages').done,
    cliffStep: saved.lstep.cliff,
    slotsStep: saved.lstep.slots,
    answer: saved.answers['slots-p'].choice,
    rules: document.querySelector('#game-rules') && document.querySelector('#game-rules').innerText,
    messagesMounted: !!document.querySelector('#messages-lesson'),
  };
}`);
check(preserved.level === 'cliff' && preserved.slots && !preserved.messages, 'old save keeps its current level and does not invent messages');
check(preserved.cliffStep === 2 && preserved.slotsStep === 5 && preserved.answer === 1, 'old lstep and first-try answer survive');
check(/Cliff|cliff/.test(preserved.rules) && !preserved.messagesMounted, 'opening the saved level shows cliff rules');

const results = [];
for (const width of [1280, 390]) {
  if (width === 390) {
    evaluate(`() => {
      const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
      saved.done = saved.done.filter((id) => id !== 'messages');
      saved.lstep.messages = 0;
      for (const id of ['messages-p', 'messages-d', 'messages-x']) delete saved.answers[id];
      saved.level = 'messages';
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
    notMessages: !document.querySelector('#messages-lesson'),
    title: document.querySelector('#goals-lesson') && document.querySelector('#goals-lesson').innerText.includes('Tell it the goal'),
  };
  bellman.level('replan');
  const replan = {
    mounted: !!document.querySelector('#replan-lesson'),
    notMessages: !document.querySelector('#messages-lesson'),
    title: document.querySelector('#replan-lesson') && document.querySelector('#replan-lesson').innerText.includes('Plan once, or replan'),
  };
  bellman.level('messages');
  return { goals, replan, messages: !!document.querySelector('#messages-lesson') && !document.querySelector('#vpo-lesson') };
}`);
check(peers.goals.mounted && peers.goals.notMessages && peers.goals.title, 'goals still mounts after messages');
check(peers.replan.mounted && peers.replan.notMessages && peers.replan.title, 'replan still mounts after messages');
check(peers.messages, 'messages mounts again without falling through to VPO');

const exported = evaluate(`async () => {
  document.querySelector('#mode-pane .savebar button').click();
  const link = document.querySelector('a[download]');
  const text = await fetch(link.href).then((response) => response.text());
  const parsed = JSON.parse(text);
  return { name: link.download, text, keys: Object.keys(parsed.progress).sort() };
}`);
check(/breaking-bellman-save-/.test(exported.name) && exported.text.includes('"messages"'), 'download control writes a save that contains messages');
const savePath = path.join(proof, 'roundtrip.json');
const uploadPath = path.join(process.cwd(), 'dist', 'messages-roundtrip.json');
fs.writeFileSync(savePath, exported.text);
fs.writeFileSync(uploadPath, exported.text);
const allowed = ['answers', 'discoveries', 'done', 'found', 'given', 'intro', 'level', 'lstep', 'made', 'missions', 'mode', 'recapDismissed', 'reviews', 'saved', 'seen', 'unlockAll', 'wondered'];
check(exported.keys.every((key) => allowed.includes(key)) && exported.keys.includes('done'), 'save keys stay on the existing schema');

evaluate(`() => { localStorage.clear(); return true; }`);
cli('open', url);
check(evaluate(`() => !JSON.parse(localStorage.getItem('breaking-bellman-v1') || '{"done":[]}').done.includes('messages')`), 'cleared storage does not keep messages');
evaluate(`() => { document.querySelector('dialog.intro button')?.click(); return true; }`);
evaluate(`() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Load save file'));
  button.click();
  const input = document.querySelector('input[type=file]');
  input.id = 'messages-save-file';
  input.hidden = false;
  input.removeAttribute('hidden');
  input.setAttribute('aria-label', 'Messages save file');
  return !!input;
}`);
const snap = cli('snapshot');
fs.writeFileSync(path.join(proof, 'load-snapshot.txt'), snap);
const line = snap.split('\n').find((row) => row.includes('Messages save file'));
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
    messages: levels.find((l) => l.id === 'messages').done,
    cliffStep: saved.lstep.cliff,
    slotsAnswer: saved.answers['slots-p'].choice,
    messagesStep: saved.lstep.messages,
    messagesAnswer: saved.answers['messages-p'] && typeof saved.answers['messages-p'].correct === 'boolean',
  };
}`);
check(imported.slots && imported.messages && imported.cliffStep === 2 && imported.slotsAnswer === 1, 'load control restores old progress and the new completion');
check(imported.messagesStep === 5 && imported.messagesAnswer, 'messages completion and first-try answer reload with the save');
cli('open', url);
const second = evaluate(`() => {
  const saved = JSON.parse(localStorage.getItem('breaking-bellman-v1'));
  const levels = bellman.levels();
  return {
    slots: levels.find((l) => l.id === 'slots').done,
    messages: levels.find((l) => l.id === 'messages').done,
    cliffStep: saved.lstep.cliff,
    messagesStep: saved.lstep.messages,
  };
}`);
check(second.slots && second.messages && second.cliffStep === 2 && second.messagesStep === 5, 'a second reload keeps the loaded save');

const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('messages UI checks passed');
