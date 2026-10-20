'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {RLA,content}=require('../scripts/fast-source.js');
require('../src/sim/autopsy.js');
function harness({saved=true}={}){
  const C=content(),lv=C.levels.find(l=>l.id==='cells'),S={mode:'campaign',level:'cells',world:lv.world,parts:lv.start,knobs:lv.knobs,results:[],seen:[],found:[]};
  const elements={},paints=[],calls=[];let release;
  const lookup=new Promise(r=>release=r),$=s=>elements[s]??=(s==='#seeds'?{value:'3'}:s==='#budget'?{value:'30'}:s==='#run-mode'?{value:'fast'}:{style:{},replaceChildren(){}});
  const results=[101,202,303].map(seed=>RLA.run({world:lv.world,parts:lv.start,knobs:lv.knobs,steps:30,seed,hyper:C.hyperOf(lv.start,lv.world)}));
  const context=vm.createContext({C,S,RLA,$,AbortController,window:{BB_FAST:{versions:{engine:'test'},base:'fast/test'},RLFAST:{createCache:()=>({save:async(config,results)=>{calls.push({save:true,config,results});return saved;},lookup:(cfg,signal)=>{calls.push({cfg,signal});return lookup;}})}},
    range:(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i),runSeeds:async(cfg,seeds,update)=>{calls.push({live:true,cfg,seeds});update(results.map(r=>({...r,t:30})));return results;},
    renderCharts:()=>paints.push('charts'),renderStage:()=>paints.push('stage'),renderAutopsy:()=>RLA.autopsy(S.results),renderExpert(){},renderWonder(){},
    recognize:()=>null,discover(){},headline:()=>'',h:()=>({}),metricCtx:()=>({}),save(){},refreshSentences(){},drawCompare(){},stopAll(){},toast(){} });
  const src=fs.readFileSync(require.resolve('../web/app.js'),'utf8');vm.runInContext(src.slice(src.indexOf('  function hyperNow()'),src.indexOf('  // ---------------------------------------------------------------- discovery celebration')),context);
  return {context,S,$,paints,calls,release,results};
}
test('exact stored results feed unchanged consumers and a miss invokes Live at the requested settings',async()=>{
  for(const hit of [true,false]){
    const h=harness(),run=h.context.run();h.release(hit?{record:{results:h.results}}:{reason:'No exact stored match: running Live.'});await run;
    assert.deepEqual(h.S.results,h.results);assert.deepEqual(h.paints.slice(-2),['charts','stage']);assert.equal(h.S.stored,hit);
    assert.equal(h.calls.filter(c=>c.live).length,hit?0:1);
    if(!hit){const c=h.calls.find(c=>c.live);assert.equal(c.cfg.steps,30);assert.equal(c.cfg.world,'cartpole');assert.deepEqual(Array.from(c.seeds),[101,202,303]);}
  }
});
test('settings changed during a stored fetch cannot paint results for the old request',async()=>{
  const h=harness(),run=h.context.run();h.S.parts={...h.S.parts,store:'net'};h.release({record:{results:h.results}});await run;
  assert.deepEqual(h.paints,[]);assert.equal(h.S.results.length,0);assert.equal(h.S.running,false);
});
test('cancelling an old fetch cannot paint or reset a newer run',async()=>{
  const h=harness(),old=h.context.run();h.context.cancelRun();assert(h.calls[0].signal.aborted);
  const next=h.context.run();h.release({record:{results:h.results}});await Promise.all([old,next]);
  assert.deepEqual(h.paints,['charts','stage']);assert.equal(h.S.results.length,3);assert.equal(h.S.running,false);
});

test('local provenance is distinct; Live fallback saves exact resolved config and full results',async()=>{
  for(const source of ['local','server']) {
    const h=harness(),pending=h.context.run();h.release({record:{results:h.results},source});await pending;
    assert.equal(h.S.source,source);assert.equal(h.calls.filter(c=>c.save).length,0);
    assert(h.$('#run-source').textContent.startsWith(source==='local'?'Saved in this browser.':'Stored simulation.'));
  }
  const h=harness(),pending=h.context.run();h.release({});await pending;
  const written=h.calls.find(c=>c.save);
  assert.equal(written.results,h.results);
  assert.equal(RLA.exact.stringify(written.config),RLA.exact.stringify(h.calls[0].cfg));
  assert.match(h.$('#run-source').textContent,/Saved in this browser for next time/);
});
test('explicit fresh Live bypasses both lookups; save failure still displays usable Live results',async()=>{
  for(const saved of [true,false]) {
    const h=harness({saved});h.$('#run-mode').value='live';await h.context.run();
    assert.equal(h.calls.filter(c=>c.signal).length,0);
    assert.equal(h.calls.filter(c=>c.live).length,1);assert.equal(h.calls.filter(c=>c.save).length,1);
    assert.equal(h.S.source,'live');assert.equal(h.S.results,h.results);assert.equal(h.S.running,false);
    assert.equal(h.$('#run-source').textContent.includes('Saved in this browser for next time.'),saved);
  }
});
