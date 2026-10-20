// Bounded real IndexedDB acceptance. node test/ui/local-cache.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [proof, url = 'http://localhost:8768/'] = process.argv.slice(2);
fs.mkdirSync(proof, { recursive: true });
function cli(...args) { return execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', timeout: 60000,
  env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'bb-local-cache160' } }); }
function evaluate(js) {
  const out = cli('eval', js), m = out.match(/^result: (.+)$/m);
  if (!m) throw Error(out);
  const value = JSON.parse(m[1]); return typeof value === 'string' ? JSON.parse(value) : value;
}
function check(ok, text) { if (!ok) throw Error(text); console.log('ok ' + text); }
function setup() {
  return evaluate(`() => {
    const intro=document.querySelector('dialog.intro button');if(intro)intro.click();
    bellman.level('slots');bellman.world('bandit',{noise:0.123456789});
    document.querySelector('#budget').value='1000';document.querySelector('#seeds').value='50';
    window.__originalAutopsy=RLA.autopsy;
    RLA.autopsy=rs=>{window.__cacheResults=rs;return window.__originalAutopsy(rs);};
    return {mode:document.querySelector('#run-mode').value};
  }`);
}
function run() {
  return evaluate(`async () => {
    await bellman.run();
    const rs=window.__cacheResults,cfg={world:'bandit',parts:rs[0].parts,knobs:rs[0].knobs,steps:1000,hyper:CONTENT.hyperOf(rs[0].parts,'bandit')};
    const config=RLA.exact.resolve(cfg,rs.map(r=>r.seed),BB_FAST.versions,CONTENT);
    window.__cacheConfig=config;
    return {source:document.querySelector('#run-source').textContent,
      digest:await RLFAST.sha256(RLA.exact.stringify(rs)),key:await RLFAST.sha256(RLA.exact.stringify(config)),config,
      autopsy:document.querySelector('#symptoms').textContent,conclusion:document.querySelector('#run-result').textContent,
      width:document.documentElement.scrollWidth};
  }`);
}
cli('open', url); cli('emulate', '--viewport', '1280x900x1');
check(setup().mode === 'fast', 'automatic Fast is default');
evaluate('async () => ({cleared:await RLFAST.createLocal(BB_FAST).clear()})');
check(evaluate('async () => ({server:!!(await RLFAST.create(BB_FAST).lookup(RLA.exact.resolve({world:"bandit",parts:bellman.words().words,knobs:{noise:0.123456789},steps:1000,hyper:CONTENT.hyperOf(bellman.words().words,"bandit")},Array.from({length:50},(_,i)=>(i+1)*101),BB_FAST.versions,CONTENT))).record})').server === false, 'fixture has no published server match');
const first = run();
check(first.source.includes('Live simulation: trained') && first.source.includes('Saved in this browser for next time.'), 'first automatic miss runs Live and saves');
check(first.width <= 1280, 'desktop has no horizontal overflow');
cli('screenshot', path.join(proof, 'desktop-live.png'));
cli('open', url); check(setup().mode === 'fast', 'reload defaults to automatic Fast');
const second = run();
check(second.source.startsWith('Saved in this browser.'), 'second visit loads IndexedDB with honest provenance');
check(second.digest === first.digest && second.key === first.key, 'all full result fields exactly match across reload');
check(second.conclusion === first.conclusion, 'conclusion preserved');
check(second.autopsy.replace('Saved in this browser. Simulation.', 'Trained in this page. Simulation.') === first.autopsy, 'autopsy preserved');
cli('emulate', '--viewport', '390x844x1');
evaluate('() => {document.querySelector("#run-source").scrollIntoView({block:"center"});return {};}');
check(evaluate('() => document.documentElement.scrollWidth') <= 390, '390px has no horizontal overflow');
cli('screenshot', path.join(proof, 'phone-local.png'));
// Explicit fresh run remains available even while the exact local entry exists.
evaluate('() => {document.querySelector("#run-mode").value="live";return {};}');
const fresh = run();
check(fresh.source.startsWith('Live simulation: trained') && fresh.source.includes('Saved in this browser for next time.'), 'explicit Live retrains and saves');
cli('open', url); check(setup().mode === 'fast', 'fresh override does not persist across reload');
const reused = run(); check(reused.source.startsWith('Saved in this browser.') && reused.digest === fresh.digest, 'fresh result reused next visit');
evaluate('() => {document.querySelector("#settings-btn").click();document.querySelector("#clear-local-cache").click();return {};}');
cli('wait', 'Local simulation cache cleared.');
check(evaluate('async () => ({hit:!!(await RLFAST.createLocal(BB_FAST).lookup(window.__cacheConfig)).record})').hit === false, 'Settings clears actual persisted records');
evaluate('() => {document.querySelector("#settings-dlg").close();return {};}');
const afterClear = run(); check(afterClear.source.startsWith('Live simulation: trained'), 'cleared setting misses and runs Live');
// Real page failure paths must still render Live without claiming a successful save.
evaluate(`() => {window.__idbOpen=indexedDB.open;indexedDB.open=()=>{throw new DOMException('Denied','SecurityError');};return {};}`);
const denied = run();
check(denied.source.startsWith('Live simulation: trained') && !denied.source.includes('Saved in this browser for next time.'), 'denied storage falls back to usable Live without a saved label');
evaluate(`() => {indexedDB.open=window.__idbOpen;window.__idbPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('Full','QuotaExceededError');};document.querySelector('#run-mode').value='live';return {};}`);
const quota = run();
check(quota.source.startsWith('Live simulation: trained') && !quota.source.includes('Saved in this browser for next time.'), 'quota failure preserves usable fresh Live without a saved label');
evaluate('() => {IDBObjectStore.prototype.put=window.__idbPut;return {};}');
const consoleLog = cli('console'); fs.writeFileSync(path.join(proof, 'console.txt'), consoleLog);
fs.writeFileSync(path.join(proof, 'acceptance.json'), JSON.stringify({ url, first, second, fresh, reused, afterClear, denied, quota }, null, 2));
console.log(JSON.stringify({ key: first.key, digest: first.digest, seeds: first.config.seeds, source: second.source }));
