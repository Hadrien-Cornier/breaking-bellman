// A25d final-campaign seed worker (per 179): ONE training seed per invocation. Builds its OWN BC
// base with that seed, trains all 4 arms sharing it, runs descriptive base eval + 4 arm evals,
// preserves per-problem values + finite-menu reference tops, writes append-only stage log and
// atomic per-stage incremental partials, SIGTERM handler flushes. No retries/resume.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const DIR = process.argv[2];
const SEED = Number(process.argv[3]);
const bail = (code, msg) => { console.error('SEEDFAIL ' + SEED + ' rc' + code + ': ' + msg); process.exit(code); };
if (!DIR || !SEED) bail(2, 'usage: node a25d-campaign-seed.js <dir> <seed>');
let MANIFEST;
try { MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')); } catch (e) { bail(6, 'manifest missing/unreadable'); }
// integrity: refuse drifted code
for (const f of Object.keys(MANIFEST.sha256)) {
  let h; try { h = execSync('shasum -a 256 ' + path.join(__dirname, f)).toString().split(' ')[0]; } catch (e) { bail(6, 'hash fail ' + f); }
  if (h !== MANIFEST.sha256[f]) bail(6, 'sha mismatch for ' + f + ' (code drifted after manifest freeze)');
}
const M = require(__dirname + '/vpo-a25d.js');
const A25 = M.A25;
const t0 = Date.now();
const SEEDCAP = MANIFEST.caps.perSeedMs;
const left = () => SEEDCAP - (Date.now() - t0);
const LOG = path.join(DIR, 'seed' + SEED + '.log');
const PARTIAL = path.join(DIR, 'seed' + SEED + '.partial.json');
const ap = (o) => fs.appendFileSync(LOG, JSON.stringify(Object.assign({ atMs: Date.now() - t0 }, o)) + '\n');
let stages = [];
const state = { manifest: MANIFEST, seed: SEED, stages, completed: false };
const writePartial = (interrupted) => {
  const body = JSON.stringify(Object.assign({}, state, { interrupted: !!interrupted, wallMsSoFar: Date.now() - t0, seedRemainingMs: left() }), (k, v) => (k === 'net' || k === 'probs' ? undefined : v), 1);
  const tmp = PARTIAL + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, body); fs.renameSync(tmp, PARTIAL);
};
// NOTE (per 180): a SIGTERM during a synchronous finetune CANNOT reliably run this handler; the
// preserved evidence on a kill is therefore the LAST PRE-STAGE partial (written before the
// interrupted stage), never claimed as a guaranteed post-stage flush. Driver escalates to SIGKILL.
process.on('SIGTERM', () => { ap({ stage: 'sigterm-best-effort', seedRemainingMs: left() }); try { writePartial(true); } catch (e) {} process.exit(143); });
const mark = (name, extra) => { const s = Object.assign({ stage: name, atMs: Date.now() - t0 }, extra); stages.push(s); ap(s); writePartial(false); return s; };
const timeGuard = (stage) => { if (left() <= 0) { ap({ stage: 'seed-cap-hit', before: stage }); writePartial(false); process.exit(2); } };

// maps (deterministic; IDs must equal the frozen manifest IDs)
const train = []; let sf = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { sf++; } }
const test = [];
for (let s = 4242; test.length < 32 && s < 4242 + 800; s++) { try { test.push(M.makeMaze(s)); } catch (e) {} }
if (JSON.stringify(train.map((m) => m.seed)) !== JSON.stringify(MANIFEST.trainMaps.ids)) bail(6, 'train map IDs differ from frozen manifest');
if (JSON.stringify(test.map((m) => m.seed)) !== JSON.stringify(MANIFEST.testMaps.ids)) bail(6, 'test map IDs differ from frozen manifest');
mark('maps', { train: train.length, test: test.length, scannedFail: sf });

// finite-menu reference tops per test problem (established definition; NOT a global-optimum claim)
timeGuard('menu');
const mT0 = Date.now();
// finite-menu reference tops per test problem (established definition; NOT a global-optimum claim).
// plan() enumerates ALL orderings of reachable golds/diamonds (BFS-shortest legs) and returns the
// ARGMAX route of each family (gold-only, diam-only, hybrid); the menu top = MAX dot(WSTAR, vec)
// over those returned routes = the actual maximum uniform score over the frozen finite menu,
// not one BC planner route (per 180 point 5).
const dotW = (v) => A25.WSTAR.reduce((s2, w, i) => s2 + w * v[i], 0);
const menuTops = test.map((mz) => { const rts = A25.plan(mz); if (!rts || !rts.length) return null; return Math.max(...rts.map((p) => dotW(A25.replayVec(mz, p)))); });
mark('menu-tops', { wallMs: Date.now() - mT0, nullCount: menuTops.filter((x) => x === null).length });
state.menuTops = menuTops;

// BC base with the TRAINING seed (per 179); all arms share it
timeGuard('bc');
const bcT = Date.now();
writePartial(false); // pre-stage checkpoint BEFORE the expensive BC stage
const base = M.buildBase(SEED, train);
state.bc = { nDemo: base.nDemo, bcLossBefore: base.bcLossBefore, bcLossAfter: base.bcLossAfter, wallMs: Date.now() - bcT, bcSeed: SEED, epochs: 8 };
mark('bc', state.bc);

// descriptive base eval (excluded from gate numerics)
timeGuard('base-eval');
writePartial(false);
const ebT = Date.now();
state.baseEval = M.evaluate({ probs: base.probs }, test, SEED, 3, true, MANIFEST.eval.reps);
mark('base-eval', { wallMs: Date.now() - ebT, mean: state.baseEval.mean, exitFraction: state.baseEval.exitFraction });

// train all 4 arms (own BC base shared) + eval each
timeGuard('train');
state.arms = {};
for (const [method, m, G, single] of [['grpo-single', 1, 12, true], ['multi-rlvr', 3, 4, false], ['vpo', 3, 4, false], ['random-w', 1, 12, true]]) {
  timeGuard('train-' + method);
  writePartial(false); // pre-stage checkpoint BEFORE the expensive training stage
  const tA = Date.now();
  const f = M.finetune(base.net, base.net, SEED, method, train, MANIFEST.training.generations, MANIFEST.learner.lr, 0, m, MANIFEST.learner.K, G);
  const trainWall = Date.now() - tA;
  timeGuard('eval-' + method);
  writePartial(false);
  const tE = Date.now();
  const ev = M.evaluate({ probs: f.probs }, test, SEED, 3, single, MANIFEST.eval.reps);
  state.arms[method] = {
    trainWallMs: trainWall, candidatesPlanned: MANIFEST.training.generations * m * G,
    evalWallMs: Date.now() - tE, evalCandidates: MANIFEST.eval.evalUnitsPerArm.candidateRoutes,
    mean: ev.mean, spread: ev.spread, exitFraction: ev.exitFraction, perProblem: ev.perProblem
  };
  mark('arm-' + method, { trainWallMs: trainWall, evalWallMs: Date.now() - tE, meanK30: ev.mean[30] });
}
state.completed = true;
writePartial(false);
ap({ stage: 'done', rc: 0, seedRemainingMs: left() });
console.log('SEED ' + SEED + ' DONE wallMs ' + (Date.now() - t0));
process.exit(0);
