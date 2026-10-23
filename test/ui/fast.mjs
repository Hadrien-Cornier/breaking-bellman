// Named chrome-devtools-axi session; run on MBP against served external assets.
// node test/ui/fast.mjs MANIFEST CAMPAIGN PROOF_DIR [URL]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{exact,hash}=require('../../scripts/fast-source.js'),z=require('node:zlib');
const [manifestPath,campaign,proof,url='http://localhost:8764/']=process.argv.slice(2);
fs.mkdirSync(proof,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(manifestPath)),seen=new Set();
const entries=manifest.entries.filter(e=>!seen.has(e.config.world)&&seen.add(e.config.world));
const runTimeout=Number(process.env.BB_UI_RUN_TIMEOUT_MS)||240000;
function cli(...args){return execFileSync('chrome-devtools-axi',args,{encoding:'utf8',timeout:240000,maxBuffer:2**22,env:{...process.env,CHROME_DEVTOOLS_AXI_SESSION:process.env.CHROME_DEVTOOLS_AXI_SESSION||'bb-fast-mode154'}});}
function evaluate(js){const text=cli('eval',js),m=text.match(/^result: (.+)$/m);if(!m)throw Error(text);const result=JSON.parse(m[1]);return typeof result==='string'?JSON.parse(result):result;}
function evaluateLong(js){
  evaluate(`() => {window.__longCheck={pending:true}; (${js})().then(value=>window.__longCheck={value},error=>window.__longCheck={error:String(error)});return {started:true};}`);
  const started=Date.now();
  for(;;){
    const state=evaluate('() => window.__longCheck');
    if(state.error)throw Error(state.error);
    if(!state.pending)return state.value;
    if(Date.now()-started>runTimeout)throw Error('browser validation exceeded '+runTimeout/1000+' seconds');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
  }
}
function check(ok,message){if(!ok)throw Error(message);console.log('ok '+message);}
cli('open',url);cli('emulate','--viewport','1280x900x1');
check(evaluate('() => { const intro=document.querySelector("dialog.intro button");if(intro)intro.click();return {mode:document.querySelector("#run-mode").value,fetches:performance.getEntriesByType("resource").filter(r=>r.name.includes("/fast/")).length}; }').mode==='fast','Fast is default');
const results=[];
for(const e of entries){
  const r=exact.parse(z.gunzipSync(fs.readFileSync(path.join(campaign,'records',e.key+'.json.gz'))).toString());
  const expected=hash(exact.stringify(r.results));
  evaluate(`() => { window.__fixture=${JSON.stringify(e)};if(!window.__originalAutopsy){window.__originalAutopsy=RLA.autopsy;RLA.autopsy=rs=>{window.__lastResults=rs;return window.__originalAutopsy(rs);};}return {}; }`);
  const setup=`const e=window.__fixture;bellman.level(e.levels[0]);bellman.world(e.config.world,e.config.knobs);bellman.words(e.config.parts);document.querySelector('#budget').value=String(e.config.steps);document.querySelector('#seeds').value=String(e.config.seeds.length);`;
  const stored=evaluate(`async () => { ${setup} document.querySelector('#run-mode').value='fast';const a=await bellman.run();return {a,digest:await RLFAST.sha256(RLA.exact.stringify(window.__lastResults)),source:document.querySelector('#run-source').textContent,charts:document.querySelectorAll('#charts canvas').length,autopsy:document.querySelector('#symptoms').textContent,caption:document.querySelector('#stage-caption').textContent,conclusion:document.querySelector('#run-result').textContent}; }`);
  check(stored.source.startsWith('Stored simulation.'),e.config.world+' exact hit labeled stored');
  check(stored.digest===expected,e.config.world+' all stored result fields match the remote shard');
  check(stored.charts>0&&stored.autopsy.includes('Stored simulation.'),e.config.world+' curves and autopsy render');
  if(e.config.world==='pendulum')check(stored.caption.includes('hanging still'), 'pendulum replays the hanging start');
  if(e.config.world==='fetch'){
    check(evaluate('() => ({policy:!!window.__lastResults[0].policy,interactive:typeof document.querySelector("#stage").onclick==="function"})').interactive,'Fetch retains interactive trained policy');
    evaluate('() => {const c=document.querySelector("#stage"),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent("click",{clientX:r.left+r.width*.7,clientY:r.top+r.height*.5}));return {}; }');
  }
  if(['fetch','pendulum','reach'].includes(e.config.world)){
    cli('emulate','--viewport','390x844x1');evaluate('() => {document.querySelector("#run-source").scrollIntoView({block:"center"});return {}; }');
    check(evaluate('() => ({width:document.documentElement.scrollWidth})').width<=390,e.config.world+' phone has no horizontal overflow');
    cli('screenshot',path.join(proof,e.config.world+'-390.png'));cli('emulate','--viewport','1280x900x1');
  }
  const live=evaluateLong(`async () => { document.querySelector('#run-mode').value='live';const a=await bellman.run(); const stored=(await RLFAST.create(BB_FAST).lookup(window.__fixture.config)).record.results;const stats={absoluteTolerance:1e-8,relativeTolerance:1e-10,numberDifferences:0,maxAbsolute:0,maxRelative:0,aboveTolerance:0,otherDifferences:0,discreteDifferences:0,examples:[]};function diff(x,y,p){if(Object.is(x,y))return;if(typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)&&Number.isFinite(y)){stats.numberDifferences++;const d=Math.abs(x-y),scale=Math.max(Math.abs(x),Math.abs(y));stats.maxAbsolute=Math.max(stats.maxAbsolute,d);stats.maxRelative=Math.max(stats.maxRelative,d/Math.max(1,scale));if(d>stats.absoluteTolerance+stats.relativeTolerance*scale)stats.aboveTolerance++;if(Number.isInteger(x)&&Number.isInteger(y))stats.discreteDifferences++;if(stats.examples.length<5)stats.examples.push({p,stored:x,live:y});}else if(x&&y&&typeof x==='object'&&typeof y==='object'){if(x.constructor.name!==y.constructor.name||Object.keys(x).sort().join('|')!==Object.keys(y).sort().join('|'))stats.otherDifferences++;for(const k of new Set([...Object.keys(x),...Object.keys(y)]))diff(x[k],y[k],p+'.'+k);}else stats.otherDifferences++;}diff(stored,window.__lastResults,'results');return {a,stats,digest:await RLFAST.sha256(RLA.exact.stringify(window.__lastResults)),source:document.querySelector('#run-source').textContent,conclusion:document.querySelector('#run-result').textContent,expert:document.querySelector('#expert').textContent,autopsy:document.querySelector('#symptoms').textContent,caption:document.querySelector('#stage-caption').textContent}; }`);
  console.log(e.config.world+' cross-runtime comparison '+JSON.stringify({rawIdentical:live.digest===stored.digest,autopsyIdentical:exact.stringify(live.a)===exact.stringify(stored.a),...live.stats}));
  results.push({key:e.key,world:e.config.world,expected,stored,live});
  fs.writeFileSync(path.join(proof,'results.json'),JSON.stringify(results,null,2));
  check(live.stats.aboveTolerance===0&&live.stats.otherDifferences===0&&live.stats.discreteDifferences===0,e.config.world+' rerun satisfies disclosed numeric tolerance and exact discrete values');
  check(exact.stringify(live.a.symptoms)===exact.stringify(stored.a.symptoms),e.config.world+' identical symptom classifications and explanations');
  check(live.autopsy.replace('Trained in this page. Simulation.','Stored simulation.')===stored.autopsy&&live.caption===stored.caption&&live.conclusion===stored.conclusion,e.config.world+' rendered score, autopsy and replay conclusion unchanged');
}
cli('screenshot',path.join(proof,'desktop-1280.png'));
console.log(cli('console'));
console.log('Cross-runtime checks use abs1e-8 + rel1e-10 for these measured examples only. Raw stored data is checked separately with exact hashes; no values are rounded or changed.');
