// A25d final-campaign manifest builder (per 179): ONE machine-readable manifest with the complete
// frozen numeric gates/config, full runtime commit + SHA256 of driver/worker/gates/launcher/imports,
// 256 actual train IDs and 32 test IDs. Built WITHOUT BC or training (map scan is deterministic).
'use strict';
const path = require('path');
const { execSync } = require('child_process');
const FILES = ['a25d-campaign.js', 'a25d-campaign-seed.js', 'a25d-gates.js', 'a25d-manifest.js', 'a25d-timing-smoke.js', 'vpo-a25d.js', 'vpo-a25.js'];
function build() {
  const M = require(path.join(__dirname, 'vpo-a25d.js'));
  const commit = execSync('git -C ' + __dirname + ' rev-parse HEAD').toString().trim();
  const sha = {}; for (const f of FILES) sha[f] = execSync('shasum -a 256 ' + path.join(__dirname, f)).toString().split(' ')[0];
  const train = []; let scannedFail = 0;
  for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
  const test = []; let testScanFail = 0;
  for (let s = 4242; test.length < 32 && s < 4242 + 800; s++) { try { test.push(M.makeMaze(s)); } catch (e) { testScanFail++; } }
  if (train.length !== 256 || test.length !== 32) throw new Error('map split incomplete: train ' + train.length + ' test ' + test.length);
  const kValues = [1, 3, 5, 10, 30];
  return {
    kind: 'a25d-final-campaign', rev: '179-frozen', builtAtEpoch: Math.floor(Date.now() / 1000),
    gitCommitFull: commit, sha256: sha,
    fdim: M.FDIM, modelSize: { hidden: 64, output: 4, totalParams: (M.FDIM + 1) * 64 + (64 + 1) * 4 },
    seeds: { discovery: [2, 4, 6, 8, 10], confirmation: [31, 33, 35, 37, 39, 41, 43, 45, 47, 49] },
    caps: { globalMs: 86400000, perSeedMs: 14400000, sigtermGraceMs: 2000, sigkillEscalation: 'driver SIGKILLs after the grace; preserved evidence on a kill = last pre-stage partial, never claimed as a post-stage flush', globalDeadlineStart: 'driver entry, including manifest setup', maxHeavyProcesses: 2, lanes: 2, noRetry: true, noResume: true, noSeedReplacement: true, failurePolicy: 'failure/timeout/missing data/unmet gates => honest failure or INCONCLUSIVE; never truncate a claim to a passing subset', testOnlyOverrides: 'A25D_ALLOW_TEST_CAPS=1 + A25D_TEST_CAPS/A25D_WORKER_OVERRIDE are for bounded orchestration tests ONLY; production launch commands never set them' },
    trainMaps: { count: 256, source: 'first 256 surviving seeds from 42 (deterministic scan)', scannedSeedFailures: scannedFail, ids: train.map((m) => m.seed) },
    testMaps: { count: 32, source: 'first 32 surviving seeds from 4242 (deterministic scan; designated development maps, no gate selected on their outcomes)', scannedSeedFailures: testScanFail, ids: test.map((m) => m.seed) },
    bc: { epochs: 8, seedPolicy: 'BC base built with the TRAINING seed itself; all 4 trained arms share that base' },
    training: { generations: 12000, updatesPerGen: 2, candidatesPerGen: 12, arms: { 'grpo-single': { m: 1, G: 12 }, 'multi-rlvr': { m: 3, G: 4 }, 'vpo': { m: 3, G: 4 }, 'random-w': { m: 1, G: 12, descriptiveOnly: true } }, candidateCountsPerArm: { 'grpo-single': 12000 * 1 * 12, 'multi-rlvr': 12000 * 3 * 4, 'vpo': 12000 * 3 * 4, 'random-w': 12000 * 1 * 12 } },
    learner: { m: 3, K: 8, lr: 0.001, trainEps: 0, evalEps: 0, clip: 0.2, dualClip: '3A floor for adv<0', kl: 'forward KL(new||ref) 1e-3 exact sum (not paper k3 estimator), disclosed', entropyBonus: 0, optimizer: 'Adam WITHOUT weight decay (not AdamW), grad-norm clip 1.0', minibatches: '2 deterministic-shuffled WHOLE-rollout minibatches per generation, one epoch, advantages frozen from full group, logits recomputed after step 1, oldP frozen at collection' },
    eval: { reps: 6, kValues, sampling: 'stochastic softmax eps=0', evalUnitsPerArm: { problemRepetitionUnits: 32 * 6, candidateRoutes: 32 * 6 * 30 } },
    baseEval: { included: true, descriptive: 'descriptive only, excluded from gate numerics', arm: 'BC base evaluated on the same 32 test maps, 6 reps, single' },
    gates: {
      reference: 'a25-protocol.md rev5 (per 145); UNCHANGED margins/counts',
      kValues, uncertaintyUnit: 'training seed',
      primary: { vpoMinusGrpoMeanK30: '>= +0.05', vpoGrowthMeanK30minusK3: '>= +0.05', grpoGrowthMeanK30minusK3: '<= +0.02 (positive upper tolerance)' },
      perSeedDiscovery: { vpoMinusGrpoStrictPositives: '>= 4/5 (ties not wins)', vpoGrowthStrictPositives: '>= 4/5 (ties not wins)', grpoGrowthWithinTolerance: '>= 4/5 (<= +0.02, ties allowed)' },
      confirmation: { seeds: [31, 33, 35, 37, 39, 41, 43, 45, 47, 49], required: 'SAME numeric margins and ALL THREE separate per-seed counts as discovery, each >= 8/10: strict vpoMinusGrpo(k30) > 0, strict vpoGrowth(k30-k3) > 0, grpoGrowth(k30-k3) <= +0.02; PLUS the same primary mean margins, attribution (MultiRLVR flat <= +0.02 AND VPO-Multi(k30) >= +0.03) and saturation guard; condition runs ONLY if ALL discovery gates pass AND global time remains; incomplete confirmation => unmet gate, honest INCONCLUSIVE, never a partial claim; no new joint count, never weakened' },
      attribution: { required: true, multiRlvrGrowth: '<= +0.02', vpoMinusMultiK30: '>= +0.03', elseInconclusive: true },
      saturationGuard: { rule: 'BOTH grpo and vpo at the finite-menu top on > 80% of problem-seed units (32 problems x 5 seeds = 160 discovery, x10 = 320 confirmation) at k=30 => INCONCLUSIVE; primary never moved to lower k', atTopDefinition: 'per-problem mean best@k30 >= finite-menu reference top (exact equality at recorded float precision, tolerance 1e-9)', menuReference: 'ESTABLISHED finite-menu reference definition: the MAXIMUM dot(WSTAR, replayVec) over the enumerated planner route menu (all orderings of reachable gold and diamond items with BFS-shortest legs, the SAME enumeration that builds the BC demos), per problem, via A25 plan()+replayVec; plan() is an argmax over this enumeration (exp/vpo-a25.js: best = argmax over orders(...) by s = dot(WSTAR, vec)), NOT one BC planner route; NOT claimed to be a global optimum' }
    },
    identity: { attemptIdScheme: 'a25d-final-<UTC-ISO-dashsafe>-<pid>', uniqueDirRefusal: 'driver refuses an existing attempt directory (exit 5); workers refuse a missing/inconsistent manifest (exit 6)', logs: 'append-only per-seed and campaign logs; atomic per-stage/seed incremental partials (temp+rename) BEFORE each expensive stage and AFTER each stage; SIGTERM handler flushes an interrupted partial', trueRc: 'outermost frozen command captures TRUE rc BEFORE the date in the end marker; spawnSync statuses/signals recorded per seed' }
  };
}
module.exports = { build, FILES };
if (require.main === module) { const m = build(); process.stdout.write(JSON.stringify({ keys: Object.keys(m), trainCount: m.trainMaps.count, testCount: m.testMaps.count })); }
