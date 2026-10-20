'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const M=require('./vpo-hard154.js');
const FILES=['exp/campaign154.js','exp/seed154.js','exp/manifest154.js','exp/launch154.sh','exp/vpo-hard154.js','exp/vpo-a25d.js','exp/vpo-a25.js','exp/a25d-gates.js','src/core/rng.js','src/core/nn.js'];
const root=path.resolve(__dirname,'..');
const shaFile=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
function split(ids) {return ids.map(id=>M.makeMaze(id));}
function summary(mz) {const menu=M.menu(mz);return {id:mz.seed,problemHash:M.hash(mz),menuHash:menu.hash,menuCount:menu.paths.length,rewardVectors:menu.rewardVectors,menuTop:menu.top,directLength:mz.directLength,allLength:mz.allLength,budget:mz.budget,demoCount:M.plan(mz).length};}
function build() {
  const old=require('./a25d-manifest.js').build();
  const train=split(Array.from({length:256},(_,i)=>154000+i)),test=split(Array.from({length:32},(_,i)=>1541000+i));
  const summaries={train:train.map(summary),test:test.map(summary)};
  return {...old,kind:'a26-hard154-v1',rev:'CURRENT154',builtAtEpoch:Math.floor(Date.now()/1000),gitCommitFull:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha256:Object.fromEntries(FILES.map(f=>[f,shaFile(f)])),
    environment:'scattered 5+5 treasures,5 lava on old9x9 wall generator; budget floor(direct+.55*(all-direct)); all IDs fixed, no policy-based selection',
    trainMaps:{count:256,source:'fixed IDs154000..154255',ids:train.map(m=>m.seed),hash:M.hash(train)},testMaps:{count:32,source:'fixed new held-out IDs1541000..1541031',ids:test.map(m=>m.seed),hash:M.hash(test)},
    problemSummaries:summaries,problemSummaryHash:M.hash(summaries),
    bc:{...old.bc,planner:'TRAIN-only two-kernel subset/last menu; gold/diamond/uniform representatives, dedup; cross-route coverage context; eight epochs',checkpoint:'per-seed/base.checkpoint.json with SHA256 of all parameter bytes; all trained arms cloned from these identical bytes'},
    gates:{...old.gates,saturationGuard:{...old.gates.saturationGuard,menuReference:'max uniform score over all replay-valid subset/last DP tours for lava-permitted and lava-forbidden shortest-leg kernels, plus direct exit; finite reference ONLY, no global-optimum claim'}},
    identity:{...old.identity,attemptIdScheme:'a26-hard154-v1 (stable, one launch only)',frozenManifest:'manifest154.json passed by path, byte-copy into unique attempt output; runtime integrity checks every imported file'},
    matching:'same candidates/updates/allocated horizon per arm; early-exit unused horizon counted idle, active steps separately disclosed',
    rng:'BC seed=s; fine-tune rng=s*1000+17, net init1 overwritten by base; eval rng=s*7919+5; environment wall RNG perA25, item RNG=id*17+154',
    command:'bash exp/launch154.sh <unique-absolute-output-dir> <absolute-manifest154.json>',
    accounting:'process.cpuUsage delta and resourceUsage maxRSS per expensive stage; 1000-generation atomic inference-weight checkpoints (not resumable optimizer checkpoints); per-arm actual candidates/activeSteps/allocatedSteps/optimizerSteps/scalarizationDots',
    expected:'7-10h discovery,20-24h if conditional confirmation; bounded24h total/4hseed/2heavy, missing or late=inconclusive',
    caps:{...old.caps,memoryHighGiB:7,memoryMaxGiB:8,swapMax:0,voluntaryAggregateHighGiB:12,voluntaryAggregateMaxGiB:14,globalDeadlineStart:'external launcher timestamp (includes driver manifest checks/setup)'}
  };
}
module.exports={build,FILES,shaFile,summary,split};
if(require.main===module){const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('new manifest path required; refuse overwrite');fs.writeFileSync(out,JSON.stringify(build(),null,2),{flag:'wx'});console.log(out);}
