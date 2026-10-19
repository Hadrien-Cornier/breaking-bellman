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
// discovery FAIL: per-seed count boundary. 3/5 strict positives (3 seeds dVG=+0.10, 2 seeds
// dVG=0) while ALL other means/counts satisfy: mean dVG=+0.06 >= +0.05, growth 5/5 at +0.10,
// GRPO growth 5/5 at +0.01, attribution ok, saturation 0. Fails ONLY the named count.
{
  const dir = TMP + '/g-fail-count';
  writeSeeds(dir, DSC, (s) => (s <= 6 ? Object.assign({}, PASSV, { vpo30: 0.6 }) : Object.assign({}, PASSV, { vpo30: 0.5, vpo3: 0.4 })));
  const g = G.evalDiscovery(dir);
  if (g.allDiscoveryPass) bail('discovery should FAIL at 3/5 strict positives (<4/5)');
  if (g.counts.vpoMinusGrpoPos !== 3) bail('count assertion wrong: vpoMinusGrpoPos=' + g.counts.vpoMinusGrpoPos + ' != 3');
  if (g.perSeedPass.vpoMinusGrpo !== false) bail('named bool wrong: perSeedPass.vpoMinusGrpo should be false');
  if (!g.primary.pass_vpoMinusGrpo || !g.primary.pass_vpoGrowth || !g.primary.pass_grpoGrowth) bail('means should still pass in the count-boundary fixture');
  if (g.counts.vpoGrowthPos !== 5 || g.counts.grpoGrowthWithin !== 5) bail('other counts should satisfy: ' + JSON.stringify(g.counts));
  if (!g.attribution.pass) bail('attribution should satisfy in the count-boundary fixture');
  ok('discovery count boundary: 3/5 strict positives fails ONLY vpoMinusGrpo count (named bool false; means + other counts 5/5 satisfy)');
}
// discovery PASS: count boundary 4/5 strict positives (4 seeds dVG=+0.10, 1 seed dVG=0), all other
// means/counts satisfy => perSeedPass.vpoMinusGrpo true and allDiscoveryPass true.
{
  const dir = TMP + '/g-pass-count';
  writeSeeds(dir, DSC, (s) => (s <= 8 ? Object.assign({}, PASSV, { vpo30: 0.6 }) : Object.assign({}, PASSV, { vpo30: 0.5, vpo3: 0.4 })));
  const g = G.evalDiscovery(dir);
  if (!g.allDiscoveryPass) bail('discovery should PASS at exactly 4/5 strict positives with passing means: ' + JSON.stringify({ p: g.primary, c: g.counts }));
  if (g.counts.vpoMinusGrpoPos !== 4) bail('count assertion wrong: ' + g.counts.vpoMinusGrpoPos + ' != 4');
  if (g.perSeedPass.vpoMinusGrpo !== true) bail('named bool wrong at 4/5');
  ok('discovery count boundary: exactly 4/5 strict positives PASSES the named count with passing means');
}
// saturation fixture: both arms AT menu top on all units -> guard fires -> INCONCLUSIVE, not pass
{
  const dir = TMP + '/g-sat';
  writeSeeds(dir, DSC, () => Object.assign({}, PASSV, { grpo30: 0.9, vpo30: 0.9, grpo3: 0.89, vpo3: 0.8 }));
  const g = G.evalDiscovery(dir);
  if (g.allDiscoveryPass) bail('saturation guard did NOT fire at 100% at-top');
  if (!g.saturation.fired || g.saturation.fraction <= 0.8 || g.saturation.inconclusive) bail('saturation fraction wrong: ' + JSON.stringify(g.saturation));
  if (g.saturation.units !== 160) bail('saturation units should be 160, got ' + g.saturation.units);
  ok('saturation guard FIRES (fraction 1.0 > 0.8): INCONCLUSIVE, not a pass');
}
// confirmation count boundary: 8/10 strict positives PASSES with sufficient means (8 seeds
// dVG=+0.07 => mean +0.056; all 10 growth +0.07 => 10/10 and mean ok); 7/10 FAILS ONLY the named
// count (7 seeds dVG=+0.08 => mean +0.056, 3 seeds dVG=0; growth 10/10); assert returned counts
// and named bool, not only overall false.
{
  const dir = TMP + '/c-pass'; writeSeeds(dir, CONF, () => PASSV);
  const c = G.evalConfirmation(dir);
  if (!c.allConfirmationPass || c.counts.vpoMinusGrpoPos !== 10) bail('confirmation pass fixture wrong: ' + c.counts.vpoMinusGrpoPos);
  const dir2 = TMP + '/c-8';
  writeSeeds(dir2, CONF, (s) => (CONF.indexOf(s) < 8 ? Object.assign({}, PASSV, { vpo30: 0.57, vpo3: 0.5 }) : Object.assign({}, PASSV, { vpo30: 0.5, vpo3: 0.43 })));
  const c8 = G.evalConfirmation(dir2);
  if (!c8.allConfirmationPass) bail('confirmation should PASS at exactly 8/10 strict positives with sufficient means: ' + JSON.stringify({ c: c8.counts, p: c8.primary }));
  if (c8.counts.vpoMinusGrpoPos !== 8 || c8.counts.vpoGrowthPos !== 10 || c8.counts.grpoGrowthWithin !== 10) bail('8/10 fixture counts wrong: ' + JSON.stringify(c8.counts));
  if (c8.countsPass !== true) bail('8/10 countsPass should be true');
  const dir3 = TMP + '/c-7';
  writeSeeds(dir3, CONF, (s) => (CONF.indexOf(s) < 7 ? Object.assign({}, PASSV, { vpo30: 0.58, vpo3: 0.51 }) : Object.assign({}, PASSV, { vpo30: 0.5, vpo3: 0.43 })));
  const c7 = G.evalConfirmation(dir3);
  if (c7.allConfirmationPass) bail('confirmation should FAIL at exactly 7/10 (<8/10)');
  if (c7.counts.vpoMinusGrpoPos !== 7) bail('7/10 fixture count wrong: ' + c7.counts.vpoMinusGrpoPos);
  if (c7.countsPass !== false || c7.allConfirmationPass !== false) bail('named bools wrong at 7/10');
  if (!(c7.primary.pass_vpoMinusGrpo && c7.primary.pass_vpoGrowth && c7.primary.pass_grpoGrowth && c7.attribution.pass)) bail('7/10 fixture: means/attribution should satisfy so ONLY the named count fails');
  if (c7.counts.vpoGrowthPos !== 10 || c7.counts.grpoGrowthWithin !== 10) bail('7/10 fixture other counts should satisfy');
  const dir4 = TMP + '/c-inc'; writeSeeds(dir4, CONF.slice(0, 8), () => PASSV);
  const c4 = G.evalConfirmation(dir4);
  if (c4.allConfirmationPass) bail('confirmation should FAIL when only 8/10 seeds have data (incomplete = unmet)');
  ok('confirmation count boundaries: 10/10 and exactly 8/10 pass (counts asserted); exactly 7/10 fails ONLY the named count (means/other counts satisfy); incomplete fails honestly');
}
// missing-menu / NaN menu reference: INCONCLUSIVE, never silently unsaturated
{
  const dir = TMP + '/g-menu-null'; writeSeeds(dir, DSC, () => PASSV);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'seed2.partial.json'), 'utf8')); j.menuTops = null;
  fs.writeFileSync(path.join(dir, 'seed2.partial.json'), JSON.stringify(j));
  const g1 = G.evalDiscovery(dir);
  if (g1.allDiscoveryPass || !(g1.reason || '').startsWith('INCONCLUSIVE')) bail('null menuTops must be INCONCLUSIVE, got ' + JSON.stringify(g1.reason || g1.allDiscoveryPass));
  const dir2 = TMP + '/g-menu-nan'; writeSeeds(dir2, DSC, () => PASSV);
  const j2 = JSON.parse(fs.readFileSync(path.join(dir2, 'seed4.partial.json'), 'utf8')); j2.menuTops[7] = NaN;
  fs.writeFileSync(path.join(dir2, 'seed4.partial.json'), JSON.stringify(j2));
  const g2 = G.evalDiscovery(dir2);
  if (g2.allDiscoveryPass || !(g2.reason || '').startsWith('INCONCLUSIVE')) bail('NaN menuTop must be INCONCLUSIVE, got ' + JSON.stringify(g2.reason || g2.allDiscoveryPass));
  ok('missing/null/NaN menu reference => INCONCLUSIVE with reason (never counted as unsaturated)');
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log('ALL ORCHESTRATION TESTS PASS');
