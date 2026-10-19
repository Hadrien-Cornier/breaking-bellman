// A25d integration checks, REV 2 (per 178): ACTUAL M public-export invocation checks.
// Uses exactly the M.finetune / M.evaluate exports of exp/vpo-a25d.js (featuresA25d, FDIM 1761),
// with hidden-64 base/ref nets matching the production parameter shapes (the finetune shape guard
// refuses hidden8->64 silent prefix copies). All 4 arms with approved actual G_single=12 /
// G_chain=4 / K=8 / m=3, at most 2 generations each; M.evaluate single+chain on one map, one rep.
// Asserts every prob/parameter finite + normalized, asserts sawCoverage with the known bit,
// records measured per-arm and eval wallMs. Cumulative first-stage budget 120 s, no BC.
'use strict';
const path = require('path');
const T0 = Date.now();
const BUDGET_MS = 120000;
const bail = (m) => { console.log('CHECK-FAIL:', m); process.exit(1); };
const left = () => { const l = BUDGET_MS - (Date.now() - T0); if (l < 0) bail('120s budget exceeded'); return l; };
const M = require(path.join(__dirname, 'vpo-a25d.js')); // ACTUAL public exports
const A25 = require(path.join(__dirname, 'vpo-a25.js'));
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
require(path.join(__dirname, '..', 'src', 'core', 'nn.js'));
const RLA = globalThis.RLA;
const ok = (m) => console.log('CHECK PASS:', m);

// ---- 1) exports + dims
for (const k of ['finetune', 'evaluate', 'route', 'chain', 'buildBase']) if (typeof M[k] !== 'function') bail('export missing: M.' + k);
if (M.FDIM !== 1761) bail('M.FDIM != 1761: ' + M.FDIM);
ok('ACTUAL exports finetune/evaluate/route/chain/buildBase exist; FDIM=1761');

// ---- 2) hidden-64 base/ref nets with EXACT production shapes
left();
const mkBase64 = (rngSeed) => { const net = RLA.nn.mlp({ sizes: [M.FDIM, 64, 4], act: 'tanh', rng: RLA.rng.make(rngSeed) }); return net; };
const probsOf = (net) => (obs) => { if (obs.length !== M.FDIM) bail('obs length ' + obs.length + ' != 1761'); const z = Array.from(net.forward(obs)); const mx = Math.max(...z); const e = z.map((x) => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
const baseNet = mkBase64(7), refNet = mkBase64(7); // identical clone, matching launcher usage
const assertNetFinite = (net, tag) => { for (let i = 0; i < net.params.length; i++) for (const x of net.params[i]) if (!Number.isFinite(x)) bail(tag + ' param ' + i + ' non-finite'); };
assertNetFinite(baseNet, 'base64');
const p0 = probsOf(baseNet)(new Float32Array(M.FDIM)); // zeros input
if (p0.length !== 4) bail('base probs not length 4');
if (!p0.every(Number.isFinite)) bail('base probs non-finite (NaN can pass naive comparison)');
if (Math.abs(p0.reduce((a, b) => a + b, 0) - 1) > 1e-9) bail('base probs not normalized');
ok('hidden-64 base/ref nets (production shapes): params finite, probs finite + normalized');

// ---- 3) shape guard refuses hidden8->64 mismatch (guards the production finetune path)
left();
const net8 = RLA.nn.mlp({ sizes: [M.FDIM, 8, 4], act: 'tanh', rng: RLA.rng.make(1) });
let refused = false; try { M.finetune(net8, net8, 2, 'grpo-single', [], 1, 0.001, 0, 1, 8, 12); } catch (e) { refused = true; }
if (!refused) bail('hidden8->64 mismatch was NOT refused (silent prefix copy risk)');
ok('base/ref parameter-shape guard: hidden8->64 mismatch refused with error');

// ---- 4) maps (tiny set, no BC)
const maps = []; for (let s = 42; maps.length < 8 && s < 42 + 400; s++) { try { maps.push(M.makeMaze(s)); } catch (e) {} }
if (maps.length < 8) bail('maps < 8');

// ---- 5) M.finetune ALL 4 ARMS with ACTUAL approved G values, K=8, m=3, 2 generations
left();
const armSpecs = [['grpo-single', 1, 12], ['multi-rlvr', 3, 4], ['vpo', 3, 4], ['random-w', 1, 12]];
const trained = {};
for (const [method, m, G] of armSpecs) {
  left();
  const tA = Date.now();
  const f = M.finetune(baseNet, refNet, 2, method, maps, 2, 0.001, 0, m, 8, G); // m, K=8, actual G
  const wallMs = Date.now() - tA;
  trained[method] = f;
  assertNetFinite(f.net, method + '-net');
  const p = f.probs(new Float32Array(M.FDIM));
  if (!p.every(Number.isFinite)) bail('arm ' + method + ' probs non-finite');
  if (Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-9) bail('arm ' + method + ' probs not normalized');
  console.log('CHECK PASS: ACTUAL M.finetune arm', method, '(m=' + m + ', K=8, G=' + G + ', 2 generations) finite+normalized | wallMs', wallMs);
}

// ---- 6) M.evaluate single + chain, one map, one rep; feature dims inside eval
left();
const polS = { probs: probsOf(trained['grpo-single'].net) }, polC = { probs: probsOf(trained['vpo'].net) };
const tE1 = Date.now(); const evS = M.evaluate(polS, [maps[0]], 2, 3, true, 1); const wS = Date.now() - tE1;
const tE2 = Date.now(); const evC = M.evaluate(polC, [maps[0]], 2, 3, false, 1); const wC = Date.now() - tE2;
for (const [tag, e] of [['single', evS], ['chain', evC]]) {
  for (const k of [1, 3, 5, 10, 30]) { if (!(k in e.mean)) bail(tag + ' missing k=' + k); const v = e.mean[k]; if (!Number.isFinite(v)) bail(tag + ' mean k=' + k + ' non-finite'); if (v < -1e-9 || v > 1.000001) bail(tag + ' mean k=' + k + ' out of range ' + v); }
  if (!Number.isFinite(e.spread) || e.spread < 0) bail(tag + ' spread invalid');
}
ok('ACTUAL M.evaluate single+chain (1 map, 1 rep): k keys, finite in-range means/spread | wallMs single ' + wS + ', chain ' + wC);

// ---- 7) chain prior-candidate conditioning: assert sawCoverage with the KNOWN bit
left();
// candidate 1 coverage cell: run one route deterministically, take its first moved-to cell;
// candidate 2's obs at offset (0,0) of the coverage channel (bit 27 + (8*17+8)*6 + 4) must be 1 there.
const COV_BIT = 27 + (8 * 17 + 8) * 6 + 4;
const detPol = { probs: (o) => [0.25, 0.25, 0.25, 0.25] };
// stub rng: next()=0.1 -> sampled action 0 (down) every step under uniform probs (u=0.1 < 0.25 at j=0)
const rngStub = { next: () => 0.1, int: () => 0 };
const rt1 = M.route(maps[0], detPol, rngStub, true, 0, []);
// derive first non-S covered cell from rt1.cover vs maze start
const Skey = maps[0].S.join(',');
const covered = rt1.cover.filter((k) => k !== Skey);
if (!covered.length) bail('deterministic route covered nothing new (cannot assert conditioning)');
const cc = covered[0].split(',').map(Number);
// candidate 2 must see candidate 1's coverage at the relative offset (cc - S):
const dr = cc[0] - maps[0].S[0], dc = cc[1] - maps[0].S[1];
const BIT_AT = 27 + ((dr + 8) * 17 + (dc + 8)) * 6 + 4;
let sawCoverage = false;
const ch2 = M.chain(maps[0], { probs: (o) => { if (o[BIT_AT] === 1) sawCoverage = true; return [0.25, 0.25, 0.25, 0.25]; } }, rngStub, true, 0, 2);
if (ch2.length !== 2) bail('chain m!=2');
if (!sawCoverage) bail('sawCoverage NOT asserted: candidate 2 did not see candidate 1 coverage at known bit (dr=' + dr + ',dc=' + dc + ',bit=' + BIT_AT + ')');
ok('sawCoverage ASSERTED with known bit: candidate 2 obs[' + BIT_AT + ']=1 at covered cell ' + covered[0]);

// ---- 8) determinism of ACTUAL M.finetune
left();
const a1 = M.finetune(baseNet, refNet, 5, 'vpo', maps, 1, 0.001, 0, 3, 8, 4);
const a2 = M.finetune(baseNet, refNet, 5, 'vpo', maps, 1, 0.001, 0, 3, 8, 4);
const pa = a1.probs(new Float32Array(M.FDIM)), pb = a2.probs(new Float32Array(M.FDIM));
for (let i = 0; i < 4; i++) if (!(pa[i] === pb[i])) bail('same-seed M.finetune(vpo) not deterministic (exact bit equality expected)');
ok('same-seed ACTUAL M.finetune(vpo) deterministic');

// ---- 9) original-432 regression with MATCHING hidden-64 shapes
left();
const net432 = RLA.nn.mlp({ sizes: [A25.FDIM, 64, 4], act: 'tanh', rng: RLA.rng.make(9) });
const f432 = A25.finetune(net432, net432, 3, 'vpo', maps, 1, 0.001, 0, 3, 8, 4);
const p432 = f432.probs(new Float32Array(A25.FDIM));
if (!p432.every(Number.isFinite) || Math.abs(p432.reduce((a, b) => a + b, 0) - 1) > 1e-9) bail('432 path probs invalid');
const ev432 = A25.evaluate({ probs: (o) => [0.25, 0.25, 0.25, 0.25] }, [maps[0]], 3, 3, true, 1);
if (!Number.isFinite(ev432.mean[1])) bail('432 path evaluate broken');
ok('original-432 regression MATCHING hidden-64: finetune+evaluate OK (FDIM=' + A25.FDIM + ')');

console.log('ALL A25d INTEGRATION CHECKS (rev2) PASS | total wallMs', Date.now() - T0, '(budget', BUDGET_MS, ')');
