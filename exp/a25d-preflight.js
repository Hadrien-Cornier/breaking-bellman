// A25d preflight (per 171): ONE MBP BC preflight on the selected 17x17 agent-relative encoding.
// 256 train maps, BC seed 2, 8 epochs, 1024 demos; thresholds heldout>=0.5 AND gap<=0.15;
// 300s TOTAL cap; effective protocol with runtime commit + sha256 of ALL imported changed runners.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const M = require(__dirname + '/vpo-a25d.js');
const t0 = Date.now();
const OUT = process.argv[2] || '/tmp/a25d-preflight.json';
const hashOf = (f) => execSync('shasum -a 256 ' + __dirname + '/' + f).toString().split(' ')[0];
const commit = (() => { try { return execSync('git -C ' + __dirname + ' rev-parse --short HEAD').toString().trim(); } catch (e) { return 'uncommitted'; } })();
const EFFECTIVE = {
  kind: 'a25d-preflight', runner: 'exp/vpo-a25d.js', gitCommit: commit,
  importedSha256: { 'vpo-a25d.js': hashOf('vpo-a25d.js'), 'vpo-a25.js': hashOf('vpo-a25.js') },
  fdim: M.FDIM,
  encoding: 'six 17x17 agent-relative channels [wall, STATIC gold, STATIC diamond, lava, coverage, valid] replacing the five 81-cell spatial blocks; retained: 2 position scalars + 1 budget + 20 collected masks; absolute S/E scalars REPLACED by 4 relative offsets /8; padding!=wall',
  bcSeed: 2, bcEpochs: 8, trainMaps: 256, trainSource: 'first 256 survivors from 42',
  heldoutCompetenceMaps: [4242, 4243, 4244, 4245, 4246, 4247, 4248, 4249],
  trainContrastMaps: [42, 43, 44, 45, 46, 47, 48, 49],
  thresholds: { heldoutExit: 0.5, gap: 0.15 }, capSec: 300,
  learner: { m: 3, K: 8, G_single: 12, G_chain: 4, lr: 0.001, trainEps: 0, evalEps: 0, clip: 0.2, dualClip: '3A floor for adv<0', kl: 'forward KL(new||ref) 1e-3', entropyBonus: 0, optimizer: 'Adam no weight decay', hidden: 64, updatesPerGen: 2, generations: 12000 },
  gates: 'a25-protocol.md rev3 numeric gates unchanged',
  hypothesisScope: 'useful-bias + larger-input encoding test, NOT a pure causal memorization proof; absolute info recoverable via relative S at fixed known corner',
};
const REQUIRED = ['kind', 'runner', 'gitCommit', 'importedSha256', 'fdim', 'encoding', 'bcSeed', 'bcEpochs', 'trainMaps', 'heldoutCompetenceMaps', 'trainContrastMaps', 'thresholds', 'capSec', 'learner', 'gates'];
const missing = REQUIRED.filter((k) => !(k in EFFECTIVE));
if (missing.length) { console.log('EMIT-KEY FAIL: ' + missing.join(',')); process.exit(4); }
console.log('emitted-keys check: PASS (' + REQUIRED.length + ' keys before BC)');
const train = []; let scannedFail = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
if (train.length < 256) { console.log('PREFLIGHT-FAIL: only ' + train.length + ' train maps'); process.exit(2); }
EFFECTIVE.trainMapIds = train.map((m) => m.seed); EFFECTIVE.scannedSeedFailures = scannedFail;
console.log('train maps', train.length, 'scannedFailures', scannedFail);
const base = M.buildBase(2, train);
console.log('BC demos', base.nDemo, 'loss', base.bcLossBefore.toFixed(4), '->', base.bcLossAfter.toFixed(4), 'wallMs', Date.now() - t0);
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
