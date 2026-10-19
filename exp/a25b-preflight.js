// A25b BC/init preflight (per 167): 256 train maps (first survivors from 42), FROZEN BC seed 2,
// 8 BC epochs, unchanged family/pair-context rule; competence = greedy exit on HELD-OUT 8 maps
// [4242..4249] (threshold >= 0.5 frozen before data) with paired train [42..49] contrast.
// Hard 300 s TOTAL cap enforced by the launcher; honest failure reporting; no retries.
'use strict';
const fs = require('fs');
const M = require(__dirname + '/vpo-a25.js');
const t0 = Date.now();
const OUT = process.argv[2] || '/tmp/a25b-preflight.json';
const PROTO = {
  kind: 'a25b-preflight', bcSeed: 2, bcEpochs: 8, trainMaps: 256, trainSource: 'first 256 survivors from 42',
  heldoutCompetenceMaps: [4242, 4243, 4244, 4245, 4246, 4247, 4248, 4249],
  trainContrastMaps: [42, 43, 44, 45, 46, 47, 48, 49],
  threshold: 'greedy heldout base exit >= 0.5 (frozen before data)',
  capSec: 300, confound: 'BC 16x demos at 8 epochs = ~16x BC optimizer updates; map-diversity effect NOT isolated from supervised budget',
  runner: 'exp/vpo-a25.js @ fm/vpo-a25b'
};
console.log('PROTO', JSON.stringify(PROTO));
// scan maps (no outcome inspection)
const train = []; let scannedFail = 0;
for (let s = 42; train.length < 256 && s < 42 + 4000; s++) { try { train.push(M.makeMaze(s)); } catch (e) { scannedFail++; } }
if (train.length < 256) { console.log('PREFLIGHT-FAIL: only ' + train.length + ' train maps survived'); process.exit(2); }
PROTO.trainMapIds = train.map((m) => m.seed);
PROTO.scannedSeedFailures = scannedFail;
console.log('train maps', train.length, 'scannedFailures', scannedFail);
// BC init with the frozen seed
const base = M.buildBase(2, train);
console.log('BC demos', base.nDemo, 'loss', base.bcLossBefore.toFixed(4), '->', base.bcLossAfter.toFixed(4), 'wallMs', Date.now() - t0);
// greedy competence on heldout + paired train contrast
const heldout = PROTO.heldoutCompetenceMaps.map((s) => M.makeMaze(s));
const trainC = PROTO.trainContrastMaps.map((s) => M.makeMaze(s));
const greedy = (mazes) => { let ex = 0, ret = 0; for (const mz of mazes) { const rt = M.route(mz, base, { next: () => 0, int: () => 0 }, false, 0, []); if (rt.vec[0] === 1) ex++; ret += rt.vec.reduce((a, b) => a + b, 0) * 0.25; } return { exitFraction: ex / mazes.length, meanReturn: ret / mazes.length }; };
const out = { PROTO, bc: { nDemo: base.nDemo, bcLossBefore: base.bcLossBefore, bcLossAfter: base.bcLossAfter }, greedy: { heldout8: greedy(heldout), train8: greedy(trainC) }, wallMs: Date.now() - t0 };
out.PASS = out.greedy.heldout8.exitFraction >= 0.5;
console.log('greedy heldout8', JSON.stringify(out.greedy.heldout8), '| train8', JSON.stringify(out.greedy.train8), '| PASS', out.PASS, '| wallMs', out.wallMs);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);
process.exit(out.PASS ? 0 : 3);
