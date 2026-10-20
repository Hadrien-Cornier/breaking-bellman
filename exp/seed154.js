// CURRENT154: one seed, same frozen base bytes for every arm, append-only stage evidence.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=process.argv[2],SEED=Number(process.argv[3]);
const bail=(code,msg)=>{console.error(msg);process.exit(code);};
if(!DIR||!SEED)bail(2,'usage seed154 <dir> <seed>');
let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(DIR,'manifest.json'),'utf8'));}catch(e){bail(6,'missing manifest');}
const {shaFile,split,summary}=require('./manifest154.js');
for(const [f,h] of Object.entries(manifest.sha256))if(shaFile(f)!==h)bail(6,'drift '+f);
if(!manifest.seeds.discovery.concat(manifest.seeds.confirmation).includes(SEED))bail(6,'undeclared seed');
const M=require('./vpo-hard154.js');
const T0=Date.now(),LOG=path.join(DIR,'seed'+SEED+'.log'),PART=path.join(DIR,'seed'+SEED+'.partial.json');
if(fs.existsSync(LOG)||fs.existsSync(PART))bail(5,'REFUSE seed overwrite/resume');
const stageDir=path.join(DIR,'seed'+SEED);fs.mkdirSync(stageDir);
const ap=o=>fs.appendFileSync(LOG,JSON.stringify({atMs:Date.now()-T0,...o})+'\n');
const atomic=(file,o)=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(o));fs.renameSync(tmp,file);};
const state={seed:SEED,completed:false,interrupted:false,stages:[],arms:{},attemptId:manifest.kind};
const partial=()=>atomic(PART,{...state,wallMs:Date.now()-T0,cpuUsage:process.cpuUsage(),resourceUsage:process.resourceUsage()});
const guard=()=>{if(Date.now()-T0>=manifest.caps.perSeedMs){partial();bail(2,'seed wall cap');}};
function checkpoint(name,net){const arrays=net.params.map(p=>Array.from(p));const h=crypto.createHash('sha256');for(const p of net.params)h.update(Buffer.from(p.buffer,p.byteOffset,p.byteLength));const sha256=h.digest('hex');atomic(path.join(stageDir,name+'.checkpoint.json'),{name,seed:SEED,sha256,sizes:[M.FDIM,64,4],params:arrays,resumable:false});return sha256;}
function stage(name,fn){guard();partial();const t=Date.now(),cpu=process.cpuUsage();ap({stage:name,event:'start'});const result=fn();const record={stage:name,event:'end',wallMs:Date.now()-t,cpuUsage:process.cpuUsage(cpu),resourceUsage:process.resourceUsage()};state.stages.push(record);ap(record);partial();return result;}
process.on('SIGTERM',()=>{state.interrupted=true;partial();process.exit(143);}); // best effort; CPU bound JS may not service signal
const train=stage('construct-train',()=>split(manifest.trainMaps.ids)),test=stage('construct-test',()=>split(manifest.testMaps.ids));
if(M.hash(train)!==manifest.trainMaps.hash||M.hash(test)!==manifest.testMaps.hash)bail(6,'problem hash drift');
const references=stage('finite-menu',()=>({train:train.map(summary),test:test.map(summary)}));
if(M.hash(references)!==manifest.problemSummaryHash)bail(6,'reference hash drift');
state.menuTops=references.test.map(s=>s.menuTop);state.menuValid=state.menuTops.every(Number.isFinite);
if(!state.menuValid)bail(2,'invalid menu references');partial();
const base=stage('bc',()=>M.buildBase(SEED,train));
state.bc={nDemo:base.nDemo,lossBefore:base.bcLossBefore,lossAfter:base.bcLossAfter,checkpointHash:checkpoint('base',base.net)};partial();
state.baseEval=stage('base-eval',()=>M.evaluate(base,test,SEED,3,true,manifest.eval.reps));partial();
for(const [method,m,G,single] of [['grpo-single',1,12,true],['multi-rlvr',3,4,false],['vpo',3,4,false],['random-w',1,12,true]]){
  const baseHash=checkpoint('pre-'+method,base.net);if(baseHash!==state.bc.checkpointHash)bail(6,'base mutated');
  const t=Date.now();
  const f=stage('train-'+method,()=>M.finetune(base.net,base.net,SEED,method,train,manifest.training.generations,manifest.learner.lr,0,m,manifest.learner.K,G,progress=>{
    guard();const hash=checkpoint('latest-'+method,progress.net);state.progress={method,generation:progress.generation,counts:progress.counts,checkpointHash:hash};ap({stage:'progress',...state.progress,cpuUsage:process.cpuUsage(),resourceUsage:process.resourceUsage()});partial();
  }));
  const trainWallMs=Date.now()-t;
  if(f.counts.candidates!==manifest.training.candidateCountsPerArm[method]||f.counts.optimizerSteps!==manifest.training.generations*2)bail(6,'budget counters mismatch');
  const finalHash=checkpoint('final-'+method,f.net);state.arms[method]={trainWallMs,counts:f.counts,checkpointHash:finalHash,baseHash};partial();
  const ev=stage('eval-'+method,()=>M.evaluate(f,test,SEED,3,single,manifest.eval.reps));
  if(ev.counts.candidates!==manifest.eval.evalUnitsPerArm.candidateRoutes)bail(6,'eval candidate mismatch');
  Object.assign(state.arms[method],ev);partial();
}
const arms=Object.values(state.arms);if(arms.some(a=>a.counts.allocatedSteps!==arms[0].counts.allocatedSteps))bail(6,'allocated environment budget mismatch');
guard();state.completed=true;partial();ap({stage:'done',rc:0,wallMs:Date.now()-T0,cpuUsage:process.cpuUsage(),resourceUsage:process.resourceUsage()});
