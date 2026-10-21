// Desktop and phone proof through an isolated chrome-devtools-axi session.
// node test/ui/supermimic.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [proof, url = 'http://127.0.0.1:8766/'] = process.argv.slice(2);
if (!proof) throw Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'bb-supermimic178' };
function cli(...args) {
  return execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', env, timeout: 60000, maxBuffer: 2 ** 22 });
}
function evaluate(js) {
  const text = cli('eval', js), match = text.match(/^result: (.+)$/m);
  if (!match) throw Error(text);
  const result = JSON.parse(match[1]);
  return typeof result === 'string' ? JSON.parse(result) : result;
}
function check(ok, text) {
  if (!ok) throw Error(text);
  console.log('ok ' + text);
}
const results = [];
cli('open', url);
evaluate('() => {document.querySelector("dialog.intro button")?.click();bellman.level("supermimic");return true;}');
for (const width of [1280, 390]) {
  cli('emulate', '--viewport', width + 'x900x1');
  const run = evaluate(`async () => {
    bellman.level('supermimic');
    const result = await bellman.run();
    const root = document.querySelector('#supermimic-lesson');
    const source = document.querySelector('#supermimic-source-context');
    source.open = true;
    return {
      width: innerWidth, scroll: document.documentElement.scrollWidth, result,
      sourceVerified: /Qiayuan Liao/.test(source.innerText) && /20 October 2026/.test(source.innerText) && /UC Berkeley/.test(source.innerText),
      qualified: /not a matched version/.test(root.innerText) && /128 L40/.test(root.innerText),
      separate: !!document.querySelector('#supermimic-rollout') && !!document.querySelector('#supermimic-gradients'),
      completeDisabled: document.querySelector('#supermimic-complete').disabled,
      markdown: bellman.page().includes('SuperMimic-inspired') && bellman.page().includes('surrogate gap'),
      emDash: root.innerText.includes('—'),
    };
  }`);
  check(run.width === width && run.scroll <= width, 'no horizontal overflow at ' + width);
  check(run.result.methods.length === 3, 'three measured training methods at ' + width);
  check(new Set(run.result.methods.map(x => x.modelId)).size === 1, 'one learned model across methods at ' + width);
  check(run.result.methods.every(x => Number.isFinite(x.physicsScore) && Number.isFinite(x.surrogateScore)), 'physics and surrogate scores remain distinct at ' + width);
  check(run.result.exploit.gap > 0.02 && run.result.exploit.outsideSupport > 0.7, 'reproducible model exploitation at ' + width);
  check(run.result.rollout.physicsMs > 0 && run.result.rollout.modelMs > 0 && run.separate, 'rollout and gradient measures are separate at ' + width);
  check(run.sourceVerified, 'verified source context at ' + width);
  check(run.qualified, 'headline comparison is qualified at ' + width);
  check(run.markdown && run.completeDisabled && !run.emDash, 'export, completion gate, and style at ' + width);
  const interaction = evaluate(`() => {
    document.querySelector('#supermimic-inspect').click();
    const answers = [...document.querySelectorAll('#supermimic-lesson .mc .opt')];
    answers[0].click();
    const wrongDisabled = document.querySelector('#supermimic-complete').disabled;
    answers[2].click();
    const ready = !document.querySelector('#supermimic-complete').disabled;
    document.querySelector('#supermimic-complete').click();
    return {
      wrongDisabled, ready, done: bellman.levels().find(x => x.id === 'supermimic').done,
      feedback: /transition speed, learning efficiency/.test(document.querySelector('#supermimic-lesson .mc .picked .why').innerText),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  }`);
  check(interaction.wrongDisabled && interaction.ready && interaction.done, 'causal quiz and completion gate at ' + width);
  check(interaction.feedback && !interaction.overflow, 'quiz feedback explains the distinction at ' + width);
  evaluate('() => {document.querySelector("#supermimic-source-context").open=true;document.querySelector("#supermimic-source-context").scrollIntoView({block:"start"});return true;}');
  cli('screenshot', path.join(proof, 'source-' + width + '.png'));
  evaluate('() => {document.querySelector("#supermimic-gradients").scrollIntoView({block:"start"});return true;}');
  cli('screenshot', path.join(proof, 'measures-' + width + '.png'));
  results.push({ width, run, interaction });
  fs.writeFileSync(path.join(proof, 'ui-results.json'), JSON.stringify(results, null, 2));
}
cli('open', url);
check(evaluate('() => bellman.levels().find(x => x.id === "supermimic").done'), 'completion survives reload');
const consoleText = cli('console');
fs.writeFileSync(path.join(proof, 'console.txt'), consoleText);
check(!/\[error\]/.test(consoleText), 'no browser console errors');
console.log('SuperMimic UI checks passed');
