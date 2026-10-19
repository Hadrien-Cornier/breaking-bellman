// A25d timing/execution smoke (per 173 approval): seed 2, 60 generations, 4 test maps [4242..4245],
// 2 eval reps, k=1,3,5,10,30, all arms + descriptive base, FDIM 1761, 256 train maps, BC epochs 8,
// full learner unchanged. 900 s TOTAL hard cap enforced by the launcher. Purpose ONLY: verify the
// unexercised RL/eval path and MEASURE per-stage walltime. Outcomes EXCLUDED from discovery evidence.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const M = require(__dirname + '/vpo-a25d.js');
const t0 = Date.now();
const OUT = process.argv[2] || '/tmp/a25d-timing-smoke.json';
const stages = [];
const mark = (name, extra) => { const s = { stage: name, atMs: Date.now() - t0, ...extra }; stages.push(s); console.log('STAGE', JSON.stringify(s)); return s; };
const sha = (f) => execSync('shasum -a 256 ' + __dirname + '/' + f).toString().split(' ')[0];
const commit = (() => { try { return execSync('git -C ' + __dirname + ' rev-parse --short HEAD').toString().trim(); } catch (e) { return 'uncommitted'; } })();
const EFFECTIVE = {
  kind: 'a25d-timing-smoke', runner: 'exp/vpo-a25d.js', gitCommit: commit,
  importedSha256: { 'vpo-a25d.js': sha('vpo-a25d.js'), 'vpo-a25.js': sha('vpo-a25.js') },
  fdim: M.FDIM, modelSize: { hidden: 64, output: 4, totalParams: (M.FDIM + 1) * 64 + (64 + 1) * 4 },
  bcSeed: 2, bcEpochs: 8, trainMaps: 256, trainSource: 'first 256 survivors from 42',
  smoke: { generations: 60, testMaps: [4242, 4243, 4244, 4245], evalReps: 2, kValues: [1, 3, 5, 10, 30] },
  arms: ['base', 'grpo-single', 'multi-rlvr', 'vpo', 'random-w'],
  learner: { m: 3, K: 8, G_single: 12, G_chain: 4, lr: 0.001, trainEps: 0, evalEps: 0, clip: 0.2, dualClip: '3A floor for adv<0', kl: 'forward KL(new||ref) 1e-3', entropyBonus: 0, optimizer: 'Adam no weight decay', updatesPerGen: 2 },
  gates: 'a25-protocol.md rev5 (145) numeric gates; saturation exact values: mean flatness +0.02 / growth +0.05 / VPO-GRPO +0.05 / MultiRLVR attribution flat +0.02 and VPO-Multi +0.03; saturation guard 80% at-menu-top',
  exclusion: 'ALL smoke outcomes excluded from discovery evidence and design selection',
};
const REQUIRED = ['kind', 'runner', 'gitCommit', 'importedSha256', 'fdim', 'modelSize', 'bcSeed', 'bcEpochs', 'trainMaps', 'smoke', 'arms', 'learner', 'gates'];
const missing = REQUIRED.filter((k) => !(k in EFFECTIVE));
if (missing.length) { console.log('EMIT-KEY FAIL: ' + missing.join(',')); process.exit(4); }
console.log('emitted-keys check: PASS (' + REQUIRED.length + ' keys)');
// maps
const train = []; let scannedFail = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
EFFECTIVE.trainMapIds = train.map((m) => m.seed); EFFECTIVE.scannedSeedFailures = scannedFail;
mark('map-construction', { count: train.length, scannedFail });
// BC stage
const bcT0 = Date.now();
const base = M.buildBase(2, train);
const bc = { nDemo: base.nDemo, bcLossBefore: base.bcLossBefore, bcLossAfter: base.bcLossAfter, wallMs: Date.now() - bcT0 };
mark('bc', bc);
// training stage: 60 generations per arm, timing each arm
const armsOut = {};
for (const [method, G, m] of [['grpo-single', 12, 1], ['multi-rlvr', 4, 3], ['vpo', 4, 3], ['random-w', 12, 1]]) {
  const tA = Date.now();
  const f = M.finetune(base.net, base.net, 2, method, train, 60, 0.001, 0, m, 8, G);
  armsOut[method] = { wallMs: Date.now() - tA, net: f.net, probs: f.probs };
  mark('train-' + method, { wallMs: Date.now() - tA, generations: 60, candidates: 60 * (m === 3 ? 3 : 1) });
}
// eval stage: 4 test maps, 2 reps
const test = EFFECTIVE.smoke.testMaps.map((s) => M.makeMaze(s));
const evT0 = Date.now();
const evals = {};
for (const [name, pol, single] of [['grpo', armsOut['grpo-single'], true], ['multi', armsOut['multi-rlvr'], false], ['vpo', armsOut['vpo'], false], ['randw', armsOut['random-w'], true]]) {
  const tE = Date.now();
  evals[name] = M.evaluate(pol, test, 2, 3, single, 2);
  mark('eval-' + name, { wallMs: Date.now() - tE });
}
const out = { EFFECTIVE, stages, bc, training: Object.fromEntries(Object.entries(armsOut).map(([k, v]) => [k, { wallMs: v.wallMs }])), evals, wallMsTotal: Date.now() - t0 };
mark('total', { wallMs: out.wallMsTotal });
fs.writeFileSync(OUT, JSON.stringify(out, (k, v) => k === 'net' || k === 'probs' ? undefined : v, 1));
console.log('wrote', OUT, '| total wallMs', out.wallMsTotal);
process.exit(0);
