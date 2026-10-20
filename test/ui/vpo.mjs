// MBP validation through an isolated named chrome-devtools-axi session.
// node test/ui/vpo.mjs PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [proof,url='http://127.0.0.1:8766/']=process.argv.slice(2);
if(!proof)throw Error('Pass an external proof directory');
fs.mkdirSync(proof,{recursive:true});
const env={...process.env,CHROME_DEVTOOLS_AXI_SESSION:'bb-vpo-level156'};
function cli(...args){return execFileSync('chrome-devtools-axi',args,{encoding:'utf8',env,timeout:60000,maxBuffer:2**22});}
function evaluate(js){const t=cli('eval',js),m=t.match(/^result: (.+)$/m);if(!m)throw Error(t);const r=JSON.parse(m[1]);return typeof r==='string'?JSON.parse(r):r;}
function check(ok,text){if(!ok)throw Error(text);console.log('ok '+text);}
const results=[];
cli('open',url);
evaluate('() => {document.querySelector("dialog.intro button")?.click();bellman.level("vpo");return true;}');
for(const width of [1280,390]){
  cli('emulate','--viewport',width+'x900x1');
  const run=evaluate(`async () => {
    bellman.level('vpo');
    const seed=document.querySelector('#vpo-seed');seed.value='202';seed.dispatchEvent(new Event('change'));
    const result=await bellman.run();
    const root=document.querySelector('#vpo-lesson');
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,version:bellman.state().version,
      arms:result.arms.map(a=>({arm:a.arm,candidates:a.candidates,updates:a.updates,curve:a.evaluation.curve})),
      ms:result.milliseconds,source:document.querySelector('#vpo-source').innerText,
      reference:document.querySelector('#vpo-reference').innerText,
      completeDisabled:document.querySelector('#vpo-complete').disabled,
      labs:document.querySelector('#lab').hidden&&!document.querySelector('#vpo-lab').hidden,
      markdown:bellman.page().includes("Frozen reference")&&bellman.page().includes("Two treasures"),emDash:root.innerText.includes('—')};
  }`);
  check(run.width===width&&run.scroll<=width,'no horizontal overflow at '+width);
  check(run.labs&&!run.emDash,'dedicated lab, no em dash in lesson at '+width);
  check(run.arms.length===2&&run.arms.every(a=>a.candidates===2880&&a.updates===480),'actual matched worker training at '+width);
  check(run.reference.includes('+0.023')&&run.reference.includes('+0.050')&&run.reference.includes('Both improved')&&run.reference.includes('Untrained base')&&run.reference.includes('MultiRLVR'),'truthful frozen result and controls at '+width);
  check(run.markdown,'copied page includes custom lesson and lab at '+width);
  check(run.completeDisabled,'completion needs preference inspection and explanation at '+width);
  const interaction=evaluate(`() => {
    const change=(id,value)=>{const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('change'));};
    const before=document.querySelector('#vpo-set-score').innerText;
    change('vpo-k',30);
    change('vpo-alternative-0',3);change('vpo-alternative-1',3);change('vpo-alternative-2',3);
    const duplicate=document.querySelector('#vpo-set-score').innerText;
    change('vpo-alternative-1',6);
    const complement=document.querySelector('#vpo-set-score').innerText;
    document.querySelector('#vpo-preferences').click();
    const fresh=document.querySelector('#vpo-set-score').innerText;
    change('vpo-route',6);
    change('vpo-answer','win');const wrongDisabled=document.querySelector('#vpo-complete').disabled;
    change('vpo-answer','evidence');const ready=!document.querySelector('#vpo-complete').disabled;
    document.querySelector('#vpo-complete').click();
    return {before,duplicate,complement,fresh,wrongDisabled,ready,done:bellman.levels().find(l=>l.id==='vpo').done,
      map:document.querySelector('#vpo-lab svg').getAttribute('aria-label'),
      alternatives:document.querySelectorAll('#vpo-lesson button[aria-pressed]').length,
      overflow:document.documentElement.scrollWidth>innerWidth,
      evidence:document.querySelector('#vpo-evidence').textContent.includes('Confirmation was correctly not run')&&document.querySelector('#vpo-evidence').textContent.includes('finite planner-menu')};
  }`);
  const score=t=>Number(t.match(/scores: (\d+\.\d+)/)[1]);
  check(score(interaction.complement)>score(interaction.duplicate),'complementary actual route changes sampled set score at '+width);
  check(interaction.fresh!==interaction.complement,'resampling changes inspected objective at '+width);
  check(interaction.map.includes('All diamonds')&&interaction.alternatives===60,'30 candidates per arm and selected route replay at '+width);
  check(interaction.wrongDisabled&&interaction.ready&&interaction.done,'truthful explanation gates saved completion at '+width);
  check(!interaction.overflow&&interaction.evidence,'expanded evidence retains limitations at '+width);
  evaluate('() => {document.querySelector("#vpo-evidence").open=true;document.querySelector("#vpo-reference").scrollIntoView({block:"start"});return true;}');
  cli('screenshot',path.join(proof,'reference-'+width+'.png'));
  evaluate('() => {document.querySelector("#vpo-lab").scrollIntoView({block:"start"});return true;}');
  cli('screenshot',path.join(proof,'route-'+width+'.png'));
  evaluate('() => {document.querySelector("#vpo-k").scrollIntoView({block:"center"});return true;}');
  cli('screenshot',path.join(proof,'live-'+width+'.png'));
  results.push({width,run,interaction});fs.writeFileSync(path.join(proof,'ui-results.json'),JSON.stringify(results,null,2));
}
cli('open',url);
check(evaluate('() => bellman.levels().find(l=>l.id==="vpo").done'),'completion survives reload');
const cancellation=evaluate(`async () => {
  bellman.level('vpo');const first=bellman.run();bellman.level('slots');bellman.level('vpo');const second=bellman.run();
  const values=await Promise.all([first,second]);return {cancelled:values[0]===null,second:values[1]?.arms.length,busy:document.querySelector('#vpo-run').disabled};
}`);
check(cancellation.cancelled&&cancellation.second===2&&!cancellation.busy,'cancelled worker cannot terminate a replacement run');
fs.writeFileSync(path.join(proof,'cancellation.json'),JSON.stringify(cancellation,null,2));
const navigation=evaluate(`async () => {
  bellman.world('vpo');const custom=bellman.state().world==='vpo';
  const wordResult=bellman.words({eps:true});
  bellman.level('slots');document.querySelector('#run-mode').value='fast';
  const result=await bellman.run();
  return {custom,wordResult,lab:!document.querySelector('#lab').hidden&&document.querySelector('#vpo-lab').hidden,source:document.querySelector('#run-source').innerText,summary:result.summary};
}`);
check(navigation.custom&&navigation.wordResult.error,'browser API handles custom world and controls honestly');
check(navigation.lab&&navigation.source.startsWith('Stored simulation.'),'old lesson retains exact Fast hit after VPO');
fs.writeFileSync(path.join(proof,'fast-after-vpo.json'),JSON.stringify(navigation,null,2));
const consoleText=cli('console');fs.writeFileSync(path.join(proof,'console.txt'),consoleText);
check(!/\[error\]/.test(consoleText),'no browser console errors');
console.log('VPO UI checks passed');
