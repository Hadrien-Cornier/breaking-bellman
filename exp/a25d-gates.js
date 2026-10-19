// A25d final-campaign gate evaluation (per 179): exact rev5 numeric gates (a25-protocol.md, per 145),
// UNCHANGED margins/counts. Reads seed partials from the attempt dir; missing/incomplete/interrupted
// seeds are failures (no replacement). Pure read-only arithmetic over recorded values.
'use strict';
const fs = require('fs');
const path = require('path');
const K30 = 30, K3 = 3;
function readSeed(dir, seed) {
  const p = path.join(dir, 'seed' + seed + '.partial.json');
  if (!fs.existsSync(p)) return { present: false, complete: false };
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { present: true, complete: false, parseError: String(e) }; }
  return { present: true, complete: !!j.completed && !j.interrupted, data: j };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function evalDiscovery(dir) {
  const seeds = [2, 4, 6, 8, 10];
  const rs = seeds.map(readSeed);
  const missing = rs.filter((r) => !r.present).map((_, i) => seeds[i]);
  const incomplete = rs.map((r, i) => ({ seed: seeds[i], complete: r.complete })).filter((x) => !x.complete).map((x) => x.seed);
  const ok = rs.every((r) => r.complete);
  if (!ok) return { allDiscoveryPass: false, reason: 'missing/incomplete seeds: ' + [...missing, ...incomplete].join(','), seeds: rs.map((r, i) => ({ seed: seeds[i], complete: r.complete })) };
  const arm = (s, meth) => s.data.arms[meth].mean;
  const vpo30 = rs.map((r) => arm(r, 'vpo')[K30]), grpo30 = rs.map((r) => arm(r, 'grpo-single')[K30]);
  const vpo3 = rs.map((r) => arm(r, 'vpo')[K3]), grpo3 = rs.map((r) => arm(r, 'grpo-single')[K3]);
  const multi30 = rs.map((r) => arm(r, 'multi-rlvr')[K30]), multi3 = rs.map((r) => arm(r, 'multi-rlvr')[K3]);
  const dVG = rs.map((_, i) => vpo30[i] - grpo30[i]);
  const gV = rs.map((_, i) => vpo30[i] - vpo3[i]);
  const gG = rs.map((_, i) => grpo30[i] - grpo3[i]);
  const gM = rs.map((_, i) => multi30[i] - multi3[i]);
  const dVM = rs.map((_, i) => vpo30[i] - multi30[i]);
  // saturation guard: per-problem values required; unit = (problem, seed); both arms at finite-menu top
  let units = 0, satUnits = 0, perProblemSat = [];
  rs.forEach((r) => {
    const tops = r.data.menuTops || [];
    r.data.arms['grpo-single'].perProblem.forEach((pp, pi) => {
      const top = tops[pi]; if (top === null || top === undefined) { perProblemSat.push({ seed: r.data.seed, problem: pi, atTop: false, noMenu: true }); units++; return; }
      const g = pp.best[K30], v = r.data.arms['vpo'].perProblem[pi].best[K30];
      const atTop = (g >= top - 1e-9) && (v >= top - 1e-9);
      units++; if (atTop) satUnits++;
      perProblemSat.push({ seed: r.data.seed, problem: pi, atTop, grpo30: g, vpo30: v, menuTop: top });
    });
  });
  const satFrac = units ? satUnits / units : 0;
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
  const saturation = { units, satUnits, fraction: satFrac, fired: satFrac > 0.8 };
  const allDiscoveryPass = primary.pass_vpoMinusGrpo && primary.pass_vpoGrowth && primary.pass_grpoGrowth && perSeedPass.vpoMinusGrpo && perSeedPass.vpoGrowth && perSeedPass.grpoGrowth && attribution.pass && !saturation.fired;
  return { allDiscoveryPass, primary, perSeed: perSeedPass, counts, attribution, saturation, perProblemSat, seedValues: { vpo30, grpo30, vpo3, grpo3, multi30, multi3, dVG, gV, gG, gM, dVM } };
}
function evalConfirmation(dir) {
  const seeds = [31, 33, 35, 37, 39, 41, 43, 45, 47, 49];
  const rs = seeds.map(readSeed);
  const completed = rs.filter((r) => r.complete);
  if (completed.length < seeds.length) return { allConfirmationPass: false, reason: 'only ' + completed.length + '/10 confirmation seeds completed (incomplete => unmet gate, honest INCONCLUSIVE; no truncation to passing subset)' };
  const passCount = completed.filter((r) => {
    const v30 = r.data.arms['vpo'].mean[K30], g30 = r.data.arms['grpo-single'].mean[K30];
    const v3 = r.data.arms['vpo'].mean[K3];
    return (v30 - g30) > 0 && (v30 - v3) > 0;
  }).length;
  return { allConfirmationPass: passCount >= 8, passCount, required: 8 };
}
module.exports = { evalDiscovery, evalConfirmation, readSeed };
