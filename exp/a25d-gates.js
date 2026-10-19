// A25d final-campaign gate evaluation (per 179/180): exact rev5 numeric gates (a25-protocol.md,
// per 145), UNCHANGED margins/counts. Reads seed partials from the attempt dir; missing/incomplete/
// interrupted seeds are failures (no replacement). Pure read-only arithmetic over recorded values.
// Discovery AND confirmation use the SAME mean margins and count rules; confirmation additionally
// requires >=8/10 on all three per-seed counts, plus attribution and saturation (never weakened,
// never a new joint count).
'use strict';
const fs = require('fs');
const path = require('path');
const K30 = 30, K3 = 3;
function readSeed(dir, seed) {
  const p = path.join(dir, 'seed' + seed + '.partial.json');
  if (!fs.existsSync(p)) return { present: false, complete: false, seed };
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { present: true, complete: false, parseError: String(e), seed }; }
  return { present: true, complete: !!j.completed && !j.interrupted, data: j, seed };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
// shared core: compute all gate numerics over a set of completed seed records
function coreGates(records) {
  const arm = (r, meth) => r.data.arms[meth].mean;
  const vpo30 = records.map((r) => arm(r, 'vpo')[K30]), grpo30 = records.map((r) => arm(r, 'grpo-single')[K30]);
  const vpo3 = records.map((r) => arm(r, 'vpo')[K3]), grpo3 = records.map((r) => arm(r, 'grpo-single')[K3]);
  const multi30 = records.map((r) => arm(r, 'multi-rlvr')[K30]), multi3 = records.map((r) => arm(r, 'multi-rlvr')[K3]);
  const dVG = records.map((_, i) => vpo30[i] - grpo30[i]);
  const gV = records.map((_, i) => vpo30[i] - vpo3[i]);
  const gG = records.map((_, i) => grpo30[i] - grpo3[i]);
  const gM = records.map((_, i) => multi30[i] - multi3[i]);
  const dVM = records.map((_, i) => vpo30[i] - multi30[i]);
  const counts = {
    vpoMinusGrpoPos: dVG.filter((x) => x > 0).length,
    vpoGrowthPos: gV.filter((x) => x > 0).length,
    grpoGrowthWithin: gG.filter((x) => x <= 0.02).length
  };
  const primary = {
    vpoMinusGrpoMean: mean(dVG), vpoGrowthMean: mean(gV), grpoGrowthMean: mean(gG),
    pass_vpoMinusGrpo: mean(dVG) >= 0.05, pass_vpoGrowth: mean(gV) >= 0.05, pass_grpoGrowth: mean(gG) <= 0.02
  };
  const perSeedPass = { vpoMinusGrpo: counts.vpoMinusGrpoPos >= 4, vpoGrowth: counts.vpoGrowthPos >= 4, grpoGrowth: counts.grpoGrowthWithin >= 4 };
  const attribution = { multiGrowthMean: mean(gM), vpoMinusMultiMean: mean(dVM), pass: mean(gM) <= 0.02 && mean(dVM) >= 0.03 };
  return { primary, counts, perSeedPass, attribution, seedValues: { vpo30, grpo30, vpo3, grpo3, multi30, multi3, dVG, gV, gG, gM, dVM } };
}
// saturation guard over (problem, seed) units; both arms at the finite-menu top
function saturation(records) {
  let units = 0, satUnits = 0; const perProblemSat = [];
  records.forEach((r) => {
    const tops = r.data.menuTops || [];
    r.data.arms['grpo-single'].perProblem.forEach((pp, pi) => {
      const top = tops[pi];
      if (top === null || top === undefined) { perProblemSat.push({ seed: r.data.seed, problem: pi, atTop: false, noMenu: true }); units++; return; }
      const g = pp.best[K30], v = r.data.arms['vpo'].perProblem[pi].best[K30];
      const atTop = (g >= top - 1e-9) && (v >= top - 1e-9);
      units++; if (atTop) satUnits++;
      perProblemSat.push({ seed: r.data.seed, problem: pi, atTop, grpo30: g, vpo30: v, menuTop: top });
    });
  });
  const fraction = units ? satUnits / units : 0;
  return { units, satUnits, fraction, fired: fraction > 0.8, perProblemSat };
}
function evalDiscovery(dir) {
  const seeds = [2, 4, 6, 8, 10];
  const rs = seeds.map((s) => readSeed(dir, s)); // FIX per 180: explicit (dir, seed) mapping
  const missing = seeds.filter((s, i) => !rs[i].present);
  const incomplete = seeds.filter((s, i) => rs[i].present && !rs[i].complete);
  if (missing.length || incomplete.length) {
    return { allDiscoveryPass: false, reason: 'missing seeds: [' + missing.join(',') + '] incomplete seeds: [' + incomplete.join(',') + ']', seeds: rs.map((r) => ({ seed: r.seed, present: r.present, complete: r.complete })) };
  }
  const core = coreGates(rs);
  const sat = saturation(rs);
  const allDiscoveryPass = core.primary.pass_vpoMinusGrpo && core.primary.pass_vpoGrowth && core.primary.pass_grpoGrowth && core.perSeedPass.vpoMinusGrpo && core.perSeedPass.vpoGrowth && core.perSeedPass.grpoGrowth && core.attribution.pass && !sat.fired;
  return Object.assign({ allDiscoveryPass, saturation: sat, seeds: rs.map((r) => ({ seed: r.seed, present: true, complete: true })) }, core);
}
function evalConfirmation(dir) {
  const seeds = [31, 33, 35, 37, 39, 41, 43, 45, 47, 49];
  const rs = seeds.map((s) => readSeed(dir, s)); // FIX per 180: explicit (dir, seed) mapping
  const missing = seeds.filter((s, i) => !rs[i].present);
  const incomplete = seeds.filter((s, i) => rs[i].present && !rs[i].complete);
  // FIX per 180: SAME numeric margins/counts as discovery (never weakened, no new joint count)
  const countsRequired = 8;
  if (missing.length || incomplete.length) {
    return { allConfirmationPass: false, reason: 'missing seeds: [' + missing.join(',') + '] incomplete seeds: [' + incomplete.join(',') + '] (incomplete => unmet gate, honest INCONCLUSIVE; never truncated to a passing subset)' };
  }
  const core = coreGates(rs);
  const sat = saturation(rs);
  const countsPass = core.counts.vpoMinusGrpoPos >= countsRequired && core.counts.vpoGrowthPos >= countsRequired && core.counts.grpoGrowthWithin >= countsRequired;
  const allConfirmationPass = countsPass && core.primary.pass_vpoMinusGrpo && core.primary.pass_vpoGrowth && core.primary.pass_grpoGrowth && core.attribution.pass && !sat.fired;
  return Object.assign({ allConfirmationPass, countsRequired, countsPass, saturation: sat }, core);
}
module.exports = { evalDiscovery, evalConfirmation, readSeed, coreGates, saturation };
