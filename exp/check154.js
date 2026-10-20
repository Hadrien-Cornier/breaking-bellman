// Tiny actual public-path checks; run under check154-run.py's ONE 120s watchdog.
'use strict';
const assert=require('assert'),M=require('./vpo-hard154.js'),A=M.A25;
const crypto=require('crypto');
const ok=x=>console.log('PASS154 '+x);
const mz=M.makeMaze(154000),mn=M.menu(mz);
assert.equal(M.hash(mz),M.hash(M.makeMaze(154000)));assert.equal(mn.hash,M.menu(M.makeMaze(154000)).hash);
assert(mz.budget>=mz.directLength&&mz.budget<mz.allLength);assert.equal(mz.gold.length,5);assert.equal(mz.diam.length,5);
assert(mn.paths.length>3&&mn.rewardVectors>3);assert.equal(mn.top,Math.max(...mn.paths.map(p=>A.dot(A.WSTAR,A.replayVec(mz,p.path)))));
for(const p of M.plan(mz))assert(A.replayVec(mz,p));
ok('deterministic new environment/menu, multiple partial score vectors, reference exact argmax, budget gap');
// Replay production route through each selected demo, same vectors, stop at first exit.
for(const path of M.plan(mz)){
  let i=0;const pol={probs:obs=>{assert.equal(obs.length,1761);const a=path[i],b=path[i+1];const act=b[0]>a[0]?0:b[1]>a[1]?1:b[0]<a[0]?2:3;i++;return [0,1,2,3].map(j=>+(j===act));}};
  const rt=M.route(mz,pol,{next:()=>0.5,int:()=>0},true,0,[]);assert.deepEqual(rt.vec,A.replayVec(mz,path));assert.equal(i,path.length-1);
}
const demo=M.plan(mz)[0],extra=demo.concat([demo[demo.length-2]]);assert.equal(A.replayVec(mz,extra),null);
// A successful loop replays the same collectible at most once.
let loop=null;
for(let i=1;i+1<demo.length;i++)if(mz.gold.concat(mz.diam).some(c=>c.join(',')===demo[i].join(','))){loop=demo.slice(0,i+1).concat([demo[i-1]],demo.slice(i));break;}
if(loop){const more={...mz,budget:mz.budget+2};assert.deepEqual(A.replayVec(more,loop),A.replayVec(more,demo));}else throw Error('nonvacuous collection-loop fixture absent');
ok('actual route=replay, no post-exit demos, repeated-item loop cannot inflate reward');
const draws=[[.1,.1,.7,.1],[.1,.7,.1,.1],[.1,.1,.1,.7]],X=[1,1,0,.8],Y=[1,0,1,.8],Z=[1,.2,.2,1];
const rABC=A.setRewardMean([X,Y,Z],draws),rAAA=A.setRewardMean([X,X,X],draws);
assert(Math.abs(rABC-.8666666666666666)<1e-12);assert(Math.abs(rAAA-.64)<1e-12);assert(rABC>rAAA);assert(A.groupAdv([rABC,rAAA])[0]>0);
// Production 4D function also has nonzero/diverse group signs.
const va=[1,1,0,1],vb=[1,0,1,1],ws=[[.1,.7,.1,.1],[.1,.1,.7,.1]];assert(A.setRewardMean([va,vb],ws)>A.setRewardMean([va,va],ws));
// Independent scalar PPO+KL loss, differentiated against production dZ.
for(const z of [[.2,-.3,.5,-.2],[-7,1,0,-1]])for(const adv of [1,-1]){
  const exp=z.map(Math.exp),p=exp.map(x=>x/exp.reduce((a,b)=>a+b)),ref=[.2,.3,.1,.4],old=p.slice(),a=0;
  const scalar=zz=>{const ex=zz.map(Math.exp),pp=ex.map(x=>x/ex.reduce((a,b)=>a+b)),r=pp[a]/old[a],cl=Math.max(.8,Math.min(1.2,r));let L=Math.min(r*adv,cl*adv);if(adv<0)L=Math.max(L,3*adv);return -L+.001*pp.reduce((s,x,j)=>s+x*Math.log(x/ref[j]),0);};
  const exact=A.ppoKLdZ(z,old,a,adv,ref,1).dZ;
  for(let j=0;j<4;j++){const lo=z.slice(),hi=z.slice();lo[j]-=1e-5;hi[j]+=1e-5;const fd=(scalar(hi)-scalar(lo))/2e-5;assert(Math.abs(fd-exact[j])<2e-5);}
}
ok('production set/group objective signs and PPO+KL finite differences (including rare action)');
const base=M.buildBase(2,[mz]);assert(base.nDemo>0&&Number.isFinite(base.bcLossAfter));
const baseHash=()=>crypto.createHash('sha256').update(Buffer.concat(base.net.params.map(p=>Buffer.from(p.buffer,p.byteOffset,p.byteLength)))).digest('hex'),h=baseHash();
for(const [method,m,G]of[['grpo-single',1,12],['multi-rlvr',3,4],['vpo',3,4],['random-w',1,12]]){
  let cb=false;const f=M.finetune(base.net,base.net,2,method,[mz],2,.001,0,m,8,G,x=>{assert.equal(x.generation,2);cb=true;assert(x.counts.activeSteps<=x.counts.allocatedSteps);});
  assert(cb);assert.equal(baseHash(),h);assert.equal(f.counts.candidates,24);assert.equal(f.counts.optimizerSteps,4);
  assert(f.net.params.every(p=>p.every(Number.isFinite)));const p=f.probs(new Float32Array(M.FDIM));assert(p.every(Number.isFinite));assert(Math.abs(p.reduce((a,b)=>a+b)-1)<1e-8);
  const ev=M.evaluate(f,[mz],2,3,m===1,1);assert.equal(ev.counts.candidates,30);let last=-1;for(const k of [1,3,5,10,30]){assert(ev.mean[k]>=last);last=ev.mean[k];}
}
ok('actual BC planner callback, clone/ref, all4 hidden64 learners, two minibatches, progress/cost counters, evaluation');
// Independent ordered-prefix oracle: deterministic policy stream repeats selected paths, chain reset every3.
const ps=M.plan(mz);let call=0,step=0;const collected=[];
const pol={probs:obs=>{const idx=call%ps.length,path=ps[idx],a=path[step],b=path[step+1];const action=b[0]>a[0]?0:b[1]>a[1]?1:b[0]<a[0]?2:3;step++;if(step===path.length-1){collected.push(A.replayVec(mz,path));call++;step=0;}return [0,1,2,3].map(j=>+(j===action));}};
const ev=M.evaluate(pol,[mz],2,3,false,1);assert.equal(collected.length,30);
for(const k of [1,3,5,10,30])assert(Math.abs(ev.mean[k]-Math.max(...collected.slice(0,k).map(M.score)))<1e-9);
ok('actual evaluator best@1/3/5/10/30 equals unsorted ordered-chain-prefix maxima');
