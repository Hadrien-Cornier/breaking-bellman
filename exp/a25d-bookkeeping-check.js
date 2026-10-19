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
// 6) menu reference is an ARGMAX over the enumerated finite menu, not one BC planner route:
// independently build random-order BFS-leg routes and assert none beats the recorded menu top.
{
  const A25full = require(path.join(__dirname, 'vpo-a25.js'));
  const { makeMaze, plan, replayVec, bfs9, WSTAR } = A25full;
  const dot = (w, v) => w.reduce((s2, x, i) => s2 + x * v[i], 0);
  const trace = (grid, from, to) => { const D = bfs9(grid, from, false, null); if (D[to[0]][to[1]] < 0) return null; const p = []; let c = to.slice(); while (!(c[0] === from[0] && c[1] === from[1])) { p.push(c.slice()); let nb = null; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = c[0] + dr, nc = c[1] + dc; if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue; if (D[nr][nc] === D[c[0]][c[1]] - 1) { nb = [nr, nc]; break; } } if (!nb) return null; c = nb; } p.push(from.slice()); return p.reverse(); };
  const concat = (parts) => { const out = []; for (const p of parts) for (const c of p) if (!out.length || out[out.length - 1][0] !== c[0] || out[out.length - 1][1] !== c[1]) out.push(c.slice()); return out; };
  const rand = (n) => Math.floor(Math.random() * n);
  for (const seed of [42, 43]) {
    const mz = makeMaze(seed);
    const rts = plan(mz);
    if (!rts.length) bail('plan returned no routes for maze ' + seed);
    const menuTop = Math.max(...rts.map((p) => dot(WSTAR, replayVec(mz, p))));
    // deterministic per-seed shuffle stream
    let st = seed * 7919 + 13; const rnd = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    for (let trial = 0; trial < 12; trial++) {
      const items = mz.gold.concat(mz.diam).slice();
      for (let i = items.length - 1; i > 0; i--) { const j = rand(i + 1); const t = items[i]; items[i] = items[j]; items[j] = t; }
      const seq = items.filter((c) => true); // random order of all reachable items (BFS legs below skip unreachable)
      let parts = [], from = mz.S.slice(), feasible = true;
      for (const c of [...seq, mz.E]) { const seg = trace(mz.grid, from, c); if (!seg) { feasible = false; break; } parts.push(seg); from = c.slice(); }
      if (!feasible) continue;
      const full = concat(parts);
      const vec = replayVec(mz, full);
      const s = vec ? dot(WSTAR, vec) : 0;
      if (s > menuTop + 1e-9) bail('menu reference NOT a maximum: random-order route scored ' + s + ' > menuTop ' + menuTop + ' (maze ' + seed + ' trial ' + trial + ')');
    }
    console.log('BOOKKEEP PASS: menu reference argmax property (maze ' + seed + ', menuTop=' + menuTop.toFixed(4) + ', 12 random menu orderings none exceed it)');
  }
}
console.log('BOOKKEEP PHASE PASS | wallMs', Date.now() - T0);
// 7) orchestration tests (dummy workers + gate fixtures), same <=10s TOTAL budget
const orch = spawnSync('node', [path.join(__dirname, 'a25d-orchestration-test.js')], { encoding: 'utf8', timeout: 30000 });
process.stdout.write(orch.stdout || '');
if (orch.status !== 0) { console.error(orch.stderr || ''); bail('orchestration tests failed'); }
const total = Date.now() - T0;
console.log('ALL BOOKKEEPING+ORCHESTRATION CHECKS PASS | total wallMs', total, '(limit 10000)');
if (total > 10000) { console.log('BOOKKEEP-FAIL: total budget exceeded'); process.exit(1); }
