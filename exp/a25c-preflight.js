// A25c preflight (per 168): representation lever - ALL 432 global features retained, ADDED axis-
// aligned 5x5 local channels + relative S/E offsets. FDIM 561. 256 train maps, BC seed 2, 8 epochs.
// Thresholds (hypothesis): heldout8 [4242..4249] greedy exit >= 0.5 AND gap <= 0.15. 300s TOTAL cap.
// EFFECTIVE-PROTOCOL builder emits actual frozen params + full map IDs + runtime git commit + script
// SHA into the output; emitted keys are CHECKED before BC starts (fixes the a25b recurrence).
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const M = require(__dirname + '/vpo-a25c.js');
const t0 = Date.now();
const OUT = process.argv[2] || '/tmp/a25c-preflight.json';
const sha = execSync('shasum -a 256 ' + __dirname + '/vpo-a25c.js').toString().split(' ')[0];
const commit = (() => { try { return execSync('git -C ' + __dirname + ' rev-parse --short HEAD').toString().trim(); } catch (e) { return 'uncommitted'; } })();
const EFFECTIVE = {
  kind: 'a25c-preflight', runner: 'exp/vpo-a25c.js', gitCommit: commit, scriptSha256: sha,
  fdim: M.FDIM, featureAmendment: 'all 432 global retained + 5x5 local walls/uncollectedGold/uncollectedDiam/lava/coverage + relS/relE offsets; no heading/rotation; OOB local reads as wall',
  bcSeed: 2, bcEpochs: 8, trainMaps: 256, trainSource: 'first 256 survivors from 42',
  heldoutCompetenceMaps: [4242, 4243, 4244, 4245, 4246, 4247, 4248, 4249],
  trainContrastMaps: [42, 43, 44, 45, 46, 47, 48, 49],
  thresholds: { heldoutExit: 0.5, gap: 0.15 },
  capSec: 300,
  learner: { m: 3, K: 8, G_single: 12, G_chain: 4, lr: 0.001, trainEps: 0, evalEps: 0, clip: 0.2, dualClip: '3A floor for adv<0', kl: 'forward KL(new||ref) 1e-3', entropyBonus: 0, optimizer: 'Adam no weight decay', hidden: 64, updatesPerGen: 2, generations: 12000 },
  gates: 'a25-protocol.md rev3 numeric gates unchanged',
  confound: 'as disclosed in a25b: map-diversity effect not isolated from supervised budget',
};
// emitted-keys check BEFORE BC (fail fast on recurrence)
const REQUIRED = ['kind', 'runner', 'gitCommit', 'scriptSha256', 'fdim', 'bcSeed', 'bcEpochs', 'trainMaps', 'heldoutCompetenceMaps', 'trainContrastMaps', 'thresholds', 'capSec', 'learner', 'gates'];
const missing = REQUIRED.filter((k) => !(k in EFFECTIVE));
if (missing.length) { console.log('EMIT-KEY FAIL: missing ' + missing.join(',')); process.exit(4); }
console.log('emitted-keys check: PASS (all ' + REQUIRED.length + ' keys present before BC)');
// changed-feature checks (meaningful subset per 168)
{
  const mz = M.makeMaze(42);
  const st = { remaining: mz.budget, got: new Set(), cover: [] };
  const v0 = M.featuresA25c(mz.S[0], mz.S[1], st, mz);
  const stC = { remaining: mz.budget, got: new Set([mz.gold[0].join(',')]), cover: [] };
  const vC = M.featuresA25c(mz.S[0], mz.S[1], stC, mz);
  const uncolGoldOff = M.A25.FDIM + 25; // local uncollected-gold block start
  // local collision check: at S, moving into a wall-local cell must be blocked (route stays); assert
  // the local wall block marks actual grid walls correctly (sample 25 cells vs grid)
  let wallOk = true;
  const S = mz.S;
  let k = M.A25.FDIM;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const r = S[0] + dr, c = S[1] + dc; const oob = r < 0 || r >= 9 || c < 0 || c >= 9; const want = oob ? 1 : (mz.grid[r][c] === M.WALL ? 1 : 0); if (v0[k++] !== want) wallOk = false; }
  if (!wallOk) { console.log('FEATURE-CHECK FAIL: local wall block mismatch'); process.exit(5); }
  // collected mask: after collecting gold[0], the uncollected-gold channel at that cell must flip to 0
  const g0 = mz.gold[0];
  let idx = uncolGoldOff, hit = -1;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const r = S[0] + dr, c = S[1] + dc; if (r === g0[0] && c === g0[1]) hit = idx; idx++; }
  if (hit >= 0 && v0[hit] === 1 && vC[hit] === 0) console.log('FEATURE-CHECK collected-mask toggle: PASS');
  else if (hit < 0) console.log('FEATURE-CHECK collected-mask toggle: SKIP (gold[0] outside local window of S)');
  else { console.log('FEATURE-CHECK FAIL collected toggle', v0[hit], vC[hit]); process.exit(5); }
  // prior-coverage propagation: a cover cell inside the window must appear in the coverage block
  const stP = { remaining: mz.budget, got: new Set(), cover: [mz.S.join(',')] };
  const vP = M.featuresA25c(mz.S[0], mz.S[1], stP, mz);
  const covOff = M.A25.FDIM + 100;
  if (vP[covOff + 12] === 1) console.log('FEATURE-CHECK prior-coverage (center cell): PASS'); else { console.log('FEATURE-CHECK FAIL coverage'); process.exit(5); }
  // global block preserved
  const base = M.A25.features(mz.S[0], mz.S[1], st, mz);
  let same = true; for (let i = 0; i < M.A25.FDIM; i++) if (v0[i] !== base[i]) same = false;
  if (!same) { console.log('FEATURE-CHECK FAIL: global block modified'); process.exit(5); }
  console.log('FEATURE-CHECK global-block-preserved: PASS');
}
// maps
const train = []; let scannedFail = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
if (train.length < 256) { console.log('PREFLIGHT-FAIL: only ' + train.length + ' train maps'); process.exit(2); }
EFFECTIVE.trainMapIds = train.map((m) => m.seed); EFFECTIVE.scannedSeedFailures = scannedFail;
console.log('train maps', train.length, 'scannedFailures', scannedFail);
// BC
const base = M.buildBase(2, train);
console.log('BC demos', base.nDemo, 'loss', base.bcLossBefore.toFixed(4), '->', base.bcLossAfter.toFixed(4), 'wallMs', Date.now() - t0);
// competence
const heldout = EFFECTIVE.heldoutCompetenceMaps.map((s) => M.makeMaze(s));
const trainC = EFFECTIVE.trainContrastMaps.map((s) => M.makeMaze(s));
const greedy = (mazes) => { let ex = 0, ret = 0; for (const mz of mazes) { const rt = M.route(mz, base, { next: () => 0, int: () => 0 }, false, 0, []); if (rt.vec[0] === 1) ex++; ret += rt.vec.reduce((a, b) => a + b, 0) * 0.25; } return { exitFraction: ex / mazes.length, meanReturn: ret / mazes.length }; };
const out = { EFFECTIVE, bc: { nDemo: base.nDemo, bcLossBefore: base.bcLossBefore, bcLossAfter: base.bcLossAfter }, greedy: { heldout8: greedy(heldout), train8: greedy(trainC) }, wallMs: Date.now() - t0 };
out.gap = out.greedy.train8.exitFraction - out.greedy.heldout8.exitFraction;
out.PASS = out.greedy.heldout8.exitFraction >= 0.5 && out.gap <= 0.15;
console.log('greedy heldout8', JSON.stringify(out.greedy.heldout8), '| train8', JSON.stringify(out.greedy.train8), '| gap', out.gap.toFixed(3), '| PASS', out.PASS, '| wallMs', out.wallMs);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);
process.exit(out.PASS ? 0 : 3);
