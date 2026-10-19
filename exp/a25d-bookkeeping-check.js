// A25d final-campaign bookkeeping check (per 179): bounded <=10s, NO BC, NO training, NO eval.
// 1) syntax-check all campaign files; 2) build the manifest and assert complete frozen keys,
// 256/32 map IDs, gate numerics present, sha256 of all 7 files; 3) worker integrity: refuses a
// drifted hash; 4) driver refuses an existing attempt dir; 5) worker refuses a missing manifest.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const T0 = Date.now();
const bail = (m) => { console.log('BOOKKEEP-FAIL:', m); process.exit(1); };
const FILES = require(__dirname + '/a25d-manifest.js').FILES;
// 1) syntax
for (const f of FILES) { const r = spawnSync('node', ['--check', path.join(__dirname, f)]); if (r.status !== 0) bail('syntax: ' + f); }
console.log('BOOKKEEP PASS: syntax of ' + FILES.length + ' campaign files');
// 2) manifest
const MAN = require(__dirname + '/a25d-manifest.js').build();
const reqKeys = ['kind', 'gitCommitFull', 'sha256', 'fdim', 'modelSize', 'seeds', 'caps', 'trainMaps', 'testMaps', 'bc', 'training', 'learner', 'eval', 'baseEval', 'gates', 'identity'];
for (const k of reqKeys) if (!(k in MAN)) bail('manifest missing key ' + k);
if (MAN.fdim !== 1761 || MAN.modelSize.totalParams !== 113028) bail('fdim/params wrong: ' + MAN.fdim + '/' + MAN.modelSize.totalParams);
if (MAN.trainMaps.count !== 256 || MAN.trainMaps.ids.length !== 256) bail('train maps != 256');
if (MAN.testMaps.count !== 32 || MAN.testMaps.ids.length !== 32) bail('test maps != 32');
if (JSON.stringify(MAN.seeds.discovery) !== '[2,4,6,8,10]') bail('discovery seeds not frozen');
if (JSON.stringify(MAN.seeds.confirmation) !== JSON.stringify([31, 33, 35, 37, 39, 41, 43, 45, 47, 49])) bail('confirmation seeds not frozen');
const g = MAN.gates;
if (g.primary.vpoMinusGrpoMeanK30.indexOf('0.05') < 0 || g.primary.vpoGrowthMeanK30minusK3.indexOf('0.05') < 0 || g.primary.grpoGrowthMeanK30minusK3.indexOf('0.02') < 0) bail('primary margins not frozen');
if (g.confirmation.required.indexOf('8/10') < 0) bail('confirmation gate not frozen');
if (!g.attribution.required || g.attribution.vpoMinusMultiK30.indexOf('0.03') < 0) bail('attribution gate not frozen');
if (g.saturationGuard.rule.indexOf('80%') < 0 || !g.saturationGuard.menuReference) bail('saturation guard not frozen');
if (MAN.caps.globalMs !== 86400000 || MAN.caps.perSeedMs !== 14400000 || MAN.caps.maxHeavyProcesses !== 2) bail('caps not frozen');
for (const f of FILES) if (!/^[0-9a-f]{64}$/.test(MAN.sha256[f] || '')) bail('sha missing for ' + f);
console.log('BOOKKEEP PASS: manifest complete (keys=' + reqKeys.length + ', train=256, test=32, commit=' + MAN.gitCommitFull.slice(0, 12) + ', 7 sha256, caps 24h/4h/2, gates rev5)');
// 3) integrity refusal: tamper a hash and expect the worker to exit 6 BEFORE any BC
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a25d-bk-'));
  const man2 = JSON.parse(JSON.stringify(MAN)); man2.sha256['vpo-a25d.js'] = '0'.repeat(64);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man2));
  const r = spawnSync('node', [path.join(__dirname, 'a25d-campaign-seed.js'), dir, '2'], { timeout: 8000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 6) bail('worker did NOT refuse drifted manifest (rc=' + r.status + ')');
  console.log('BOOKKEEP PASS: worker refuses drifted sha256 (rc=6, no BC started)');
}
// 4) driver refuses existing attempt dir
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a25d-bk-'));
  const r = spawnSync('node', [path.join(__dirname, 'a25d-campaign.js'), dir], { timeout: 8000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 5) bail('driver did NOT refuse existing dir (rc=' + r.status + ')');
  console.log('BOOKKEEP PASS: driver refuses existing attempt dir (rc=5, nothing launched)');
}
// 5) worker refuses missing manifest
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a25d-bk-'));
  const r = spawnSync('node', [path.join(__dirname, 'a25d-campaign-seed.js'), dir, '2'], { timeout: 8000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 6) bail('worker did NOT refuse missing manifest (rc=' + r.status + ')');
  console.log('BOOKKEEP PASS: worker refuses missing manifest (rc=6)');
}
console.log('ALL BOOKKEEPING CHECKS PASS | wallMs', Date.now() - T0, '(limit 10000)');
if (Date.now() - T0 > 10000) process.exit(1);
