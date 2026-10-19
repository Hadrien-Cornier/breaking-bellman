// A25d timing/execution smoke launcher (per 173 approval + LATEST098 launcher contract):
// seed 2, 60 generations, 4 test maps [4242..4245], 2 eval reps, k=1,3,5,10,30, all arms +
// descriptive base, FDIM 1761, 256 train maps, BC epochs 8, full learner unchanged. 900 s TOTAL
// hard cap enforced by the OUTER timeout wrapper (true rc captured by the wrapper before date).
// Launcher contract: UNIQUE attempt ID + output paths, REFUSE overwrite, append-only stage log,
// atomic incremental JSON checkpoint BEFORE each expensive stage and AFTER each stage, SIGTERM
// handler flushes the checkpoint. Purpose ONLY: verify the unexercised RL/eval path and MEASURE
// per-stage walltime. Outcomes EXCLUDED from discovery evidence.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const M = require(__dirname + '/vpo-a25d.js');
const t0 = Date.now();
const ATTEMPT = 'a25d-smoke-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const OUTDIR = process.argv[2] || '/tmp/' + ATTEMPT;
const OUT = OUTDIR + '/a25d-timing-smoke.json';
const LOG = OUTDIR + '/stage.log';
if (fs.existsSync(OUT)) { console.error('REFUSE overwrite: ' + OUT + ' exists'); process.exit(5); }
fs.mkdirSync(OUTDIR, { recursive: true });
let stages = [];
const writeCheckpoint = (tag) => { // atomic: temp + rename
  const partial = OUTDIR + '/.partial-' + tag + '.json';
  const body = JSON.stringify({ attempt: ATTEMPT, effective: EFFECTIVE, stages, interrupted: tag === 'sigterm', wallMsSoFar: Date.now() - t0 }, (k, v) => k === 'net' || k === 'probs' ? undefined : v, 1);
  const tmp = OUT + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, body); fs.renameSync(tmp, OUT);
  try { fs.writeFileSync(partial, body); } catch (e) {}
};
let flushed = false;
const flush = (tag) => { if (!flushed) { try { writeCheckpoint(tag); flushed = true; } catch (e) { console.error('checkpoint write failed: ' + e.message); } } };
process.on('SIGTERM', () => { flush('sigterm'); process.exit(143); });
const mark = (name, extra) => { const s = { stage: name, atMs: Date.now() - t0, ...extra }; stages.push(s); fs.appendFileSync(LOG, JSON.stringify(s) + '\n'); console.log('STAGE', JSON.stringify(s)); writeCheckpoint('after-' + name); return s; };
const sha = (f) => execSync('shasum -a 256 ' + f).toString().split(' ')[0];
const commit = (() => { try { return execSync('git -C ' + __dirname + ' rev-parse --short HEAD').toString().trim(); } catch (e) { return 'uncommitted'; } })();
const EFFECTIVE = {
  kind: 'a25d-timing-smoke', runner: 'exp/vpo-a25d.js', launcher: 'exp/a25d-timing-smoke.js', attemptId: ATTEMPT, gitCommit: commit,
  importedSha256: { 'vpo-a25d.js': sha(__dirname + '/vpo-a25d.js'), 'vpo-a25.js': sha(__dirname + '/vpo-a25.js'), 'a25d-timing-smoke.js': sha(__dirname + '/a25d-timing-smoke.js') },
  fdim: M.FDIM, modelSize: { hidden: 64, output: 4, totalParams: (M.FDIM + 1) * 64 + (64 + 1) * 4 },
  bcSeed: 2, bcEpochs: 8, trainMaps: 256, trainSource: 'first 256 survivors from 42',
  smoke: { generations: 60, testMaps: [4242, 4243, 4244, 4245], evalReps: 2, kValues: [1, 3, 5, 10, 30] },
  arms: ['base', 'grpo-single', 'multi-rlvr', 'vpo', 'random-w'],
  learner: { m: 3, K: 8, G_single: 12, G_chain: 4, lr: 0.001, trainEps: 0, evalEps: 0, clip: 0.2, dualClip: '3A floor for adv<0', kl: 'forward KL(new||ref) 1e-3', entropyBonus: 0, optimizer: 'Adam no weight decay', updatesPerGen: 2 },
  gates: 'a25-protocol.md rev5 (145) numeric gates; saturation exact values: mean flatness +0.02 / growth +0.05 / VPO-GRPO +0.05 / MultiRLVR attribution flat +0.02 and VPO-Multi +0.03; saturation guard 80% at-menu-top',
  exclusion: 'ALL smoke outcomes excluded from discovery evidence and design selection',
};
const REQUIRED = ['kind', 'runner', 'launcher', 'attemptId', 'gitCommit', 'importedSha256', 'fdim', 'modelSize', 'bcSeed', 'bcEpochs', 'trainMaps', 'smoke', 'arms', 'learner', 'gates'];
const missing = REQUIRED.filter((k) => !(k in EFFECTIVE));
if (missing.length) { console.log('EMIT-KEY FAIL: ' + missing.join(',')); process.exit(4); }
console.log('emitted-keys check: PASS (' + REQUIRED.length + ' keys) | attempt', ATTEMPT);
fs.appendFileSync(LOG, 'attempt ' + ATTEMPT + ' commit ' + commit + '\n');
writeCheckpoint('pre-map');
// maps
const train = []; let scannedFail = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
EFFECTIVE.trainMapIds = train.map((m) => m.seed); EFFECTIVE.scannedSeedFailures = scannedFail;
writeCheckpoint('pre-bc');
mark('map-construction', { count: train.length, scannedFail, candidatesSoFar: 0 });
// BC stage
const bcT0 = Date.now();
writeCheckpoint('pre-bc-expensive');
const base = M.buildBase(2, train);
const bc = { nDemo: base.nDemo, bcLossBefore: base.bcLossBefore, bcLossAfter: base.bcLossAfter, wallMs: Date.now() - bcT0 };
mark('bc', bc);
writeCheckpoint('pre-base-eval');
// descriptive base eval (BEFORE training; descriptive only, excluded from evidence)
const test = EFFECTIVE.smoke.testMaps.map((s) => M.makeMaze(s));
const ebT0 = Date.now();
const baseEval = M.evaluate({ probs: base.probs }, test, 2, 3, true, 2);
mark('base-eval', { wallMs: Date.now() - ebT0, mean: baseEval.mean, spread: baseEval.spread, exitFraction: baseEval.exitFraction });
// training stage: 60 generations per arm, timing each arm; candidates = generations*m*G
writeCheckpoint('pre-train');
const armsOut = {};
const armSpecs = [['grpo-single', 1, 12], ['multi-rlvr', 3, 4], ['vpo', 3, 4], ['random-w', 1, 12]];
for (const [method, m, G] of armSpecs) {
  const tA = Date.now();
  writeCheckpoint('pre-train-' + method);
  const f = M.finetune(base.net, base.net, 2, method, train, 60, 0.001, 0, m, 8, G);
  const wallMs = Date.now() - tA;
  armsOut[method] = { wallMs, net: f.net, probs: f.probs };
  mark('train-' + method, { wallMs, generations: 60, m, G, candidatesPlanned: 60 * m * G, candidates: 60 * m * G });
}
// eval stage: 4 test maps, 2 reps
writeCheckpoint('pre-eval');
const evals = {};
for (const [name, pol, single] of [['grpo', armsOut['grpo-single'], true], ['multi', armsOut['multi-rlvr'], false], ['vpo', armsOut['vpo'], false], ['randw', armsOut['random-w'], true]]) {
  const tE = Date.now();
  writeCheckpoint('pre-eval-' + name);
  const e = M.evaluate(pol, test, 2, 3, single, 2);
  evals[name] = { wallMs: Date.now() - tE, mean: e.mean, spread: e.spread, exitFraction: e.exitFraction };
  mark('eval-' + name, { wallMs: Date.now() - tE });
}
const out = { EFFECTIVE, stages, bc, baseEval: { mean: baseEval.mean, spread: baseEval.spread, exitFraction: baseEval.exitFraction }, training: Object.fromEntries(Object.entries(armsOut).map(([k, v]) => [k, { wallMs: v.wallMs }])), evals, wallMsTotal: Date.now() - t0, trueRc: 0, completed: true };
mark('total', { wallMs: out.wallMsTotal });
const tmp = OUT + '.tmp-' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(out, (k, v) => k === 'net' || k === 'probs' ? undefined : v, 1));
fs.renameSync(tmp, OUT);
console.log('wrote', OUT, '| total wallMs', out.wallMsTotal);
process.exit(0);
