'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const V = require('../src/agents/vpo.js'), { make } = require('../src/core/rng.js');
const fs = require('node:fs'), vm = require('node:vm');
const near = (a,b) => assert(Math.abs(a-b)<1e-10, `${a} != ${b}`);

test('route rewards replay legal moves, unique treasure collection and exit gating', () => {
  assert.equal(V.routes.length,10);
  for (const r of V.routes) {
    assert.deepEqual(V.replay(r.path).reward, r.reward);
    assert(r.path.length <= V.BUDGET+1);
    let g=new Set(),d=new Set(),l=new Set();
    r.path.forEach(([x,y],i)=>{
      if(i){const p=r.path[i-1];assert.equal(Math.abs(x-p[0])+Math.abs(y-p[1]),1);}
      const tile=V.GRID[y][x],key=x+','+y;if(tile==='G')g.add(key);if(tile==='D')d.add(key);if(tile==='L')l.add(key);
    });
    assert.deepEqual(r.reward,r.exit?[1,g.size/3,d.size/3,1-l.size/2]:[0,0,0,0]);
  }
  assert(V.routes.some(r=>!r.exit)); assert(V.routes.some(r=>r.reward[1]>r.reward[2])); assert(V.routes.some(r=>r.reward[2]>r.reward[1]));
});
test('sampled preferences are normalized, positive, reproducible and varied',()=>{
  const a=V.directions(make(8)),b=V.directions(make(8));assert.deepEqual(a,b);assert.notDeepEqual(a,V.directions(make(9)));
  for(const w of a){near(w.reduce((s,v)=>s+v,0),1);assert(w.every(v=>v>0));}
});
test('set reward uses max per preference, rewards complementary alternatives, and ignores duplicates',()=>{
  const gold=[1,1,0,1],diamond=[1,0,1,1],weights=[[0,1,0,0],[0,0,1,0]];
  near(V.setReward([gold],weights),.5);near(V.setReward([gold,diamond],weights),1);
  near(V.setReward([gold,diamond,gold],weights),1);
  near(V.setReward([gold,diamond],[[0,1,0,0]]),1);
  assert.deepEqual(V.advantages([.4,.4,.4]),[0,0,0]);
});
test('VPO conditions later candidates on actual reward coverage, without forcing distinct routes',()=>{
  const p=V.policy(); for(const row of p)row.fill(-100);p[0][3]=100;p[7][6]=100;
  const chain=V.chain(p,make(3),3);assert.equal(chain[0].state,0);assert.equal(chain[1].state,7);assert.equal(chain[1].action,6);
  for(const row of p){row.fill(-100);row[3]=100;}assert.deepEqual(V.chain(p,make(3),3).map(d=>d.action),[3,3,3]);
});
test('actual matched training changes both policies using fixed-scalar versus whole-set credit',()=>{
  const grpo=V.train('grpo',101,30),vpo=V.train('vpo',101,30);
  for(const a of [grpo,vpo]){assert.equal(a.candidates,360);assert.equal(a.updates,60);assert.notDeepEqual(a.model,V.policy());assert(a.model.flat().every(Number.isFinite));}
  assert.equal(grpo.last.groups.length,12);assert(grpo.last.groups.every(g=>g.length===1));
  grpo.last.groups.forEach((g,i)=>near(grpo.last.rewards[i],V.dot(V.uniform,g[0].reward)));
  assert.equal(vpo.last.groups.length,4);assert(vpo.last.groups.every(g=>g.length===3));assert.equal(vpo.last.weights.length,8);
  vpo.last.groups.forEach((g,i)=>near(vpo.last.rewards[i],V.setReward(g.map(d=>d.reward),vpo.last.weights)));
  assert.notDeepEqual(grpo.model,vpo.model);assert.deepEqual(V.train('vpo',101,30),vpo);
});
test('best@k uses ordered prefixes and fixed uniform scores for both arms',()=>{
  for(const arm of ['grpo','vpo']){
    const model=V.train(arm,202,20).model,e=V.evaluate(model,arm,900,1);
    e.ks.forEach((k,i)=>near(e.curve[i],Math.max(...e.pool.slice(0,k).map(a=>V.dot(V.uniform,V.routes[a].reward)))));
    assert(e.curve.every((v,i)=>!i||v>=e.curve[i-1]));assert.equal(e.pool.length,30);
  }
});
test('frozen reference preserves all arms and failed gates with exact values',()=>{
  const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('web/vpo-reference.js','utf8'),ctx);const r=ctx.window.BB_VPO_REFERENCE;
  near(r.aggregates.vpo.best30,.7525520833333333);near(r.aggregates['grpo-single'].best30,.72953125);
  assert.equal(Object.keys(r.aggregates).length,5);assert.equal(r.gateTable.filter(g=>!g.passGate).length,4);
  assert(r.aggregates.base.best30>r.aggregates.vpo.best30);assert(r.aggregates['grpo-single'].growth30_3>.1);
});
test('independent VPO dependency version leaves current original Fast corpus usable',()=>{
  const { source,hash,exact }=require('../scripts/fast-source.js'), addon=require('../scripts/vpo-source.js');
  assert(fs.existsSync('fast/'+hash(exact.stringify(source().versions))+'/index.json'), 'original current corpus must remain available');
  assert.match(addon.version(),/^[a-f0-9]{64}$/);assert(addon.files.includes('src/agents/vpo.js'));assert(addon.files.includes('src/core/rng.js'));
  assert(!require('../scripts/fast-source.js').engineFiles.includes('src/agents/vpo.js'));
});
test('the new lesson keeps chat metadata valid without pretending to be an RLA world',()=>{
  const context=vm.createContext({window:{BBVPO:{}}});
  for(const name of ['content','content2','content3','fetch-level','vpo-reference','vpo-level'])vm.runInContext(fs.readFileSync('web/'+name+'.js','utf8'),context);
  const C=context.window.CONTENT;
  Object.assign(context,{C,W:C.words,RLA:require('../src/sim/run.js'),S:{parts:C.cfg({})},fam:C.famOf,labState:()=>({})});
  const app=fs.readFileSync('web/app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('  function chatSystem()'),app.indexOf('  function chatTools(')),context);
  assert.match(context.chatSystem(),/Separate Live lesson/);
  assert.equal(C.levels.length,18);
  assert.equal(C.levels[C.levels.length-1].world,'vpo');
});
