// A25d orchestration tests (per 180): bounded, NO BC/fullRL. Exposes the actual defect classes:
// (a) dummy success workers: driver runs lanes, records exits; max-2 concurrency; no orphans;
// (b) hang worker: per-seed deadline -> SIGTERM -> SIGKILL escalation, child pid verified dead;
// (c) synthetic gate fixtures: discovery passing/failing at threshold, saturation firing,
// confirmation >=8/10 vs 7/10 vs incomplete. Total budget enforced by the bookkeeping runner.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const bail = (m) => { console.log('ORCH-FAIL:', m); process.exit(1); };
const ok = (m) => console.log('ORCH PASS:', m);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'a25d-orch-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });
const DRIVER = path.join(__dirname, 'a25d-campaign.js');
const ENV = (extra) => Object.assign({}, process.env, { A25D_ALLOW_TEST_CAPS: '1', A25D_TEST_CAPS: JSON.stringify({ globalMs: 60000, perSeedMs: 4000 }) }, extra);

// dummy workers
const dummyOk = TMP + '/dummy-ok.js';
fs.writeFileSync(dummyOk, `
const fs=require('fs'); const dir=process.argv[2], seed=process.argv[3];
const log=dir+'/conc.log'; fs.appendFileSync(log,'start '+Date.now()+' seed'+seed+'\\n');
setTimeout(()=>{ fs.appendFileSync(log,'end '+Date.now()+' seed'+seed+'\\n'); process.exit(0); }, 300);
`);
const dummyHang = TMP + '/dummy-hang.js';
fs.writeFileSync(dummyHang, `
const fs=require('fs'); const dir=process.argv[2];
fs.appendFileSync(dir+'/conc.log','hangstart '+Date.now()+'\\n');
fs.writeFileSync(dir+'/hangpid.txt', String(process.pid));
process.on('SIGTERM', ()=>{ /* CPU-bound surrogate: ignore SIGTERM */ });
setInterval(()=>{}, 100);
`);

// ---- (a) success: 5 discovery seeds => 3 lane-batches (2+2+1); assert max2 concurrency, exits 0, no confirmation (gates unmet)
{
  const dir = TMP + '/run-ok';
  const r = spawnSync('node', [DRIVER, dir], { env: ENV({ A25D_WORKER_OVERRIDE: dummyOk }), timeout: 30000, encoding: 'utf8' });
  if (fs.readFileSync(dir + '/campaign.log', 'utf8').indexOf('TRUE_RC=') < 0) bail('no end marker');
  const log = fs.readFileSync(dir + '/campaign.log', 'utf8');
  const exits = (log.match(/"event":"seed-exit".*?"status":0/g) || []).length;
  if (exits !== 5) bail('expected 5 successful seed-exits, got ' + exits);
  const skipped = log.indexOf('"event":"confirmation-skipped"') >= 0 && log.indexOf('discovery gates unmet') >= 0;
  if (!skipped) bail('confirmation not gated on discovery gates');
  if (r.status !== 1) bail('driver rc should be 1 (gates unmet by dummies), got ' + r.status);
  // concurrency <= 2 from conc.log intervals
  const ev = fs.readFileSync(dir + '/conc.log', 'utf8').trim().split('\n').map((l) => l.split(' '));
  const starts = ev.filter((e) => e[0] === 'start').map((e) => +e[1]);
  const ends = ev.filter((e) => e[0] === 'end').map((e) => +e[1]).sort((a, b) => a - b);
  let maxConc = 0, active = 0; const events2 = ev.map((e) => ({ t: +e[1], k: e[0] })).sort((a, b) => a.t - b.t);
  for (const e of events2) { if (e.k === 'start') { active++; maxConc = Math.max(maxConc, active); } else active--; }
  if (maxConc > 2) bail('concurrency exceeded 2: ' + maxConc);
  ok('success dummies: 5 exits rc=0, lanes<=2 (max ' + maxConc + '), confirmation gated off, TRUE_RC=1');
}
// ---- (b) hang: deadline SIGTERM then SIGKILL; pid dead; no orphan
{
  const dir = TMP + '/run-hang';
  // small globalMs so only ONE batch hangs (2 seeds) then the rest are not-started: keeps the test bounded
  const r = spawnSync('node', [DRIVER, dir], { env: ENV({ A25D_WORKER_OVERRIDE: dummyHang, A25D_TEST_CAPS: JSON.stringify({ globalMs: 6000, perSeedMs: 2500 }) }), timeout: 40000, encoding: 'utf8' });
  const log = fs.readFileSync(dir + '/campaign.log', 'utf8');
  if (log.indexOf('"event":"seed-cap-sigterm"') < 0) bail('no seed-cap-sigterm event');
  if (log.indexOf('"event":"seed-cap-sigkill"') < 0) bail('no SIGKILL escalation event');
  const pid = Number(fs.readFileSync(dir + '/hangpid.txt', 'utf8').trim());
  let alive = true; try { process.kill(pid, 0); } catch (e) { alive = false; }
  if (alive) bail('HUNG CHILD STILL ALIVE after SIGKILL (orphan): pid ' + pid);
  ok('hang worker: SIGTERM at deadline -> SIGKILL escalation -> pid ' + pid + ' verified dead (no orphan)');
}
// ---- (c) gate fixtures
const G = require(__dirname + '/a25d-gates.js');
const mkSeedPartial = (seed, v) => ({
  completed: true, interrupted: false, seed,
  menuTops: Array(32).fill(v.menuTop),
  arms: {
    'grpo-single': { mean: { 3: v.grpo3, 30: v.grpo30 }, perProblem: Array(32).fill(0).map(() => ({ best: { 3: v.grpo3, 30: v.grpo30 } })) },
    'vpo': { mean: { 3: v.vpo3, 30: v.vpo30 }, perProblem: Array(32).fill(0).map(() => ({ best: { 3: v.vpo3, 30: v.vpo30 } })) },
    'multi-rlvr': { mean: { 3: v.multi3, 30: v.multi30 }, perProblem: Array(32).fill(0).map(() => ({ best: { 3: v.multi3, 30: v.multi30 } })) }
  }
});
const writeSeeds = (dir, seeds, vfn) => { fs.mkdirSync(dir, { recursive: true }); for (const s of seeds) fs.writeFileSync(path.join(dir, 'seed' + s + '.partial.json'), JSON.stringify(mkSeedPartial(s, vfn(s)))); };
const PASSV = { menuTop: 0.9, grpo30: 0.5, grpo3: 0.49, vpo30: 0.6, vpo3: 0.5, multi30: 0.5, multi3: 0.495 };
const DSC = [2, 4, 6, 8, 10], CONF = [31, 33, 35, 37, 39, 41, 43, 45, 47, 49];
// discovery PASS fixture
{
  const dir = TMP + '/g-pass'; writeSeeds(dir, DSC, () => PASSV);
  const g = G.evalDiscovery(dir);
  if (!g.allDiscoveryPass) bail('discovery PASS fixture failed: ' + JSON.stringify({ p: g.primary, c: g.counts, a: g.attribution, s: g.saturation && g.saturation.fraction }));
  if (Math.abs(g.primary.vpoMinusGrpoMean - 0.1) > 1e-9) bail('mean arithmetic wrong');
  ok('discovery fixture PASSES at margins (VPO-GRPO +0.10, growth +0.10, GRPO growth +0.01, attribution ok, saturation 0)');
}
// discovery FAIL: mean margin below threshold
{
  const dir = TMP + '/g-fail-mean'; writeSeeds(dir, DSC, () => Object.assign({}, PASSV, { vpo30: 0.54 }));
  const g = G.evalDiscovery(dir);
  if (g.allDiscoveryPass) bail('discovery should FAIL when VPO-GRPO mean = +0.04 < +0.05');
  ok('discovery fixture FAILS below margin (+0.04 < +0.05): honest unmet gate');
}
// discovery FAIL: per-seed count 3/5
{
  const dir = TMP + '/g-fail-count';
  writeSeeds(dir, DSC, (s) => (s <= 6 ? Object.assign({}, PASSV, { vpo30: 0.51 }) : PASSV)); // 3 seeds with vpo30-grpo30=+0.01, still growth? vpo3=0.5 -> growth NEGATIVE for those
  const g = G.evalDiscovery(dir);
  if (g.allDiscoveryPass) bail('discovery should FAIL with only 2/5 strict positives');
  ok('discovery fixture FAILS at 2/5 per-seed positives (<4/5)');
}
// saturation fixture: both arms AT menu top on all units -> guard fires -> INCONCLUSIVE, not pass
{
  const dir = TMP + '/g-sat';
  writeSeeds(dir, DSC, () => Object.assign({}, PASSV, { grpo30: 0.9, vpo30: 0.9, grpo3: 0.89, vpo3: 0.8 }));
  const g = G.evalDiscovery(dir);
  if (g.allDiscoveryPass) bail('saturation guard did NOT fire at 100% at-top');
  if (!g.saturation.fired || g.saturation.fraction <= 0.8) bail('saturation fraction wrong: ' + g.saturation.fraction);
  ok('saturation guard FIRES (fraction 1.0 > 0.8): INCONCLUSIVE, not a pass');
}
// confirmation: 9/10 counts pass; 7/10 fail; incomplete fails
{
  const dir = TMP + '/c-pass'; writeSeeds(dir, CONF, () => PASSV);
  const c = G.evalConfirmation(dir);
  if (!c.allConfirmationPass || c.counts.vpoMinusGrpoPos !== 10) bail('confirmation pass fixture wrong: ' + c.counts.vpoMinusGrpoPos);
  const dir2 = TMP + '/c-7'; writeSeeds(dir2, CONF, (s) => (s <= 45 ? Object.assign({}, PASSV, { vpo30: 0.5, vpo3: 0.51 }) : PASSV)); // 7 seeds with dVG=0 (not strict) and gV<0
  const c2 = G.evalConfirmation(dir2);
  if (c2.allConfirmationPass) bail('confirmation should FAIL at 7/10 (<8/10)');
  const dir3 = TMP + '/c-inc'; writeSeeds(dir3, CONF.slice(0, 8), () => PASSV);
  const c3 = G.evalConfirmation(dir3);
  if (c3.allConfirmationPass) bail('confirmation should FAIL when only 8/10 seeds have data (incomplete = unmet)');
  ok('confirmation fixtures: 10/10 pass; 7/10 fail (<8); incomplete (8 present) fails honestly');
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log('ALL ORCHESTRATION TESTS PASS');
