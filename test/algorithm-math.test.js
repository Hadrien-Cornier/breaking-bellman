// The equation panel must describe the learner that actually runs. These checks bind the derived
// TeX to learner code: the constants in the equations are the learner's own hyper defaults, the
// action-generation notation matches the real branches in ac.js, the target/critic/policy lines
// match real probe numbers from RLA.session, and words the learner ignores never fake a change.
// Pure derivation checks with no DOM. Run: node --test test/algorithm-math.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

global.window = global;
for (const f of ['web/content.js', 'web/content2.js', 'web/content3.js']) require(path.join(__dirname, '..', f));
for (const f of ['src/core/rng.js', 'src/core/nn.js', 'src/worlds/bandit.js', 'src/worlds/cliff.js', 'src/worlds/cartpole.js', 'src/worlds/mirage.js', 'src/worlds/pendulum.js', 'src/worlds/fork.js', 'src/agents/value.js', 'src/agents/ac.js', 'src/agents/pg.js', 'src/sim/run.js']) require(path.join(__dirname, '..', f));
require(path.join(__dirname, '..', 'web', 'algorithm-math.js'));

const AM = globalThis.ALGO_MATH;
const RLA = globalThis.RLA;
const AC = RLA.ac, PG = RLA.pg;
const acSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'agents', 'ac.js'), 'utf8');
const pgSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'agents', 'pg.js'), 'utf8');

const line = (p, world, label) => (AM.lines(p, world).find(([l]) => l === label) || [null, null])[1];
const text = (p, world) => AM.lines(p, world).map(([, t]) => t).join('\n');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const ac = (over) => Object.assign({}, AC.DEFAULT_PARTS, over);
const pg = (over) => Object.assign({}, PG.DEFAULT_PARTS, over);
const val = (over) => Object.assign({ family: 'value', store: 'table', eps: true, ucb: false, optimistic: false, data: 'fresh', memory: 2000, step: 'alpha', nstep: 1, agg: 'max', picker: 'live', scorer: 'live', sync: 10 }, over);

// ---- constants in the equations are the learner's own hyper defaults -------------------------
test('every number in the ac equations is the learner hyper value that runs', () => {
  const H = AC.DEFAULT_HYPER;
  const det = text(ac({ head: 'det' }), 'pendulum');
  assert.ok(det.includes(`\\epsilon \\sim \\mathcal{N}(0, ${H.exploreStd}^2)`), 'det exploration noise is exploreStd');
  const smooth = text(ac({ next: 'smooth' }), 'pendulum');
  assert.ok(smooth.includes(`\\mathcal{N}(0, ${H.smoothStd}^2), \\pm ${H.smoothClip}`), 'smooth target noise and clip');
  const edit = text(ac({ pick: 'edit' }), 'pendulum');
  assert.ok(edit.includes(`|\\hat a| \\le ${H.editScale}`), 'edit step bound is editScale');
  assert.ok(text(ac({ pick: 'best' }), 'pendulum').includes(`a_1, \\dots, a_${H.nSamples}`), 'sample count is nSamples');
  const slow = text(ac({ target: 'slow' }), 'pendulum');
  assert.ok(slow.includes(`0.005\\,(Q_j - \\bar{Q}_j)`) || slow.includes(`${H.tau}\\,(Q_j`), 'slow copy rate is tau');
  const exp = text(ac({ next: 'expectile' }), 'pendulum');
  assert.ok(exp.includes(`\\tau = ${H.expectile}`), 'expectile level is the learner value');
  const qc = text(ac({ aim: 'qclose' }), 'pendulum');
  assert.ok(qc.includes(`\\lambda = ${H.bcAlpha} / \\operatorname{mean}|Q|`), 'qclose scale is bcAlpha');
  const base = text(ac({ base: 'classical' }), 'fork');
  assert.ok(base.includes(`+ ${H.residualScale}\\, a_\\theta`), 'base correction scale is residualScale');
  const cond = text(ac({ aim: 'cond' }), 'pendulum');
  assert.ok(cond.includes(`top-${Math.round(H.condTop * 100)}\\%`), 'cond cut is condTop');
  const cbest = text(ac({ aim: 'copybest' }), 'pendulum');
  assert.ok(cbest.includes(`top ${Math.round(H.bestFrac * 100)}\\%`), 'copybest fraction is bestFrac');
});

test('every number in the pg equations is the learner hyper value that runs', () => {
  const H = PG.DEFAULT_HYPER;
  const clip = text(pg({ ratio: 'clip', epochs: 4 }), 'goalgrid');
  assert.ok(clip.includes(`0.8, 1 + ${H.clipEps}`) || clip.includes(`clip}(\\rho_t, ${1 - H.clipEps}, ${1 + H.clipEps})`), 'clip range is 1 +- clipEps');
  const gae = text(pg({ baseline: 'critic', adv: 'gae' }), 'goalgrid');
  assert.ok(gae.includes(`\\lambda = ${H.lambda}`), 'gae lambda is the learner value');
  const avg = text(pg({ baseline: 'avg' }), 'goalgrid');
  assert.ok(avg.includes(`0.05\\,(G - \\bar{G})`) || avg.includes(`${H.avgRate}\\,(G`), 'running-mean rate is avgRate');
});

// ---- action generation: the real expression, deterministic vs sampled ------------------------
test('action lines match the learner action-generation branches', () => {
  // det: tanh of a direct command plus exploration noise while learning (ac.js sampleOne det)
  assert.ok(acSrc.includes('Math.tanh(z[j]) + (explore ? H.exploreStd * rng.normal() : 0)'), 'learner det branch');
  const det = line(ac({ head: 'det' }), 'pendulum', 'act');
  assert.match(det, /a_t = \\tanh f_\\theta\(s_t\) \+ \\epsilon/);
  // gauss climbing the critic: noise inside the squashing (reparameterized sample)
  assert.ok(acSrc.includes('Math.tanh(explore ? m + Math.exp(ls) * rng.normal() : m)'), 'learner gauss reparameterized branch');
  const gq = line(ac({ head: 'gauss', aim: 'q' }), 'pendulum', 'act');
  assert.match(gq, /= \\tanh\\big\(\\mu_\\theta\(s_t\) \+ \\sigma_\\theta\(s_t\)\\,\\epsilon\\big\)/);
  // gauss copying the data: noise added after the squashing (copyLike branch)
  assert.ok(acSrc.includes('Math.tanh(m) + (explore ? Math.exp(ls) * rng.normal() : 0)'), 'learner gauss copy branch');
  const gc = line(ac({ head: 'gauss', aim: 'copy' }), 'pendulum', 'act');
  assert.match(gc, /= \\tanh \\mu_\\theta\(s_t\) \+ \\sigma_\\theta\(s_t\)\\,\\epsilon/);
  // flow: noise turned into an action in flowSteps steps
  const fl = line(ac({ head: 'flow' }), 'pendulum', 'act');
  assert.ok(fl.includes(`x_{${AC.DEFAULT_HYPER.flowSteps}}`) && fl.includes('v_\\theta'), 'flow uses the real iteration count');
});

// ---- target rule, critic count and fitting bound to real probe numbers -----------------------
// the value learner can hold one update back (stepAndProbe); the ac learner probes its next update
function valProbe(world, parts, hyper, n) {
  const s = RLA.session({ world, parts, hyper, seed: 3 });
  s.advance(n);
  const r = s.stepAndProbe({ wantGuess: true });
  assert.ok(r.probe, 'probe exists');
  return r.probe;
}
function acProbe(parts) {
  const s = RLA.session({ world: 'pendulum', parts, hyper: {}, seed: 3 });
  s.advance(200);
  const r = s.untilUpdate();
  assert.ok(r.probe, 'probe exists');
  return r.probe;
}

test('two critics: the target line shows min of two and the probe uses two estimates', () => {
  const p = ac({ critics: 'two', entropy: 'none' });
  const t = line(p, 'pendulum', 'target');
  assert.ok(t.includes('\\min_{j=1,2}'), 'target takes the smaller of two critics');
  const pr = acProbe(p);
  assert.equal(pr.qNext.length, 2, 'the learner scored the next action with 2 critics');
  if (!pr.done) close(pr.y, pr.r + 0.99 * Math.min(...pr.qNext), 'y = r + gamma min_j Q_j');
});

test('one critic: no min in the target and one estimate in the probe', () => {
  const p = ac({ critics: 'one', entropy: 'none' });
  const t = line(p, 'pendulum', 'target');
  assert.ok(!t.includes('\\min_{j=1,2}'), 'no pessimism with one critic');
  const pr = acProbe(p);
  assert.equal(pr.qNext.length, 1);
  if (!pr.done) close(pr.y, pr.r + 0.99 * pr.qNext[0], 'y = r + gamma Q');
});

test('target copy rule: slow uses the frozen copy, live does not', () => {
  assert.ok(line(ac({ target: 'slow' }), 'pendulum', 'target').includes('\\bar{Q}'), 'slow target reads the copy');
  assert.ok(!line(ac({ target: 'live' }), 'pendulum', 'target').includes('\\bar{Q}'), 'live target reads the live critic');
  assert.ok(line(ac({ target: 'slow' }), 'pendulum', 'slow copy'), 'the copy update is shown only when a copy exists');
  assert.ok(!line(ac({ target: 'live' }), 'pendulum', 'slow copy'));
});

test('next-action rule matches the probe: expectile has no next action, data uses the memory action', () => {
  const pe = acProbe(ac({ next: 'expectile', entropy: 'none' }));
  assert.ok(line(ac({ next: 'expectile' }), 'pendulum', 'target').includes('V_\\psi(s\')'));
  if (!pe.done) close(pe.y, pe.r + 0.99 * pe.vNext, 'expectile target is r + gamma V(s\')');
  const pd = acProbe(ac({ next: 'data', entropy: 'none' }));
  assert.ok(line(ac({ next: 'data' }), 'pendulum', 'target').includes("a'_{\\text{mem}}"));
  assert.equal(pd.logpNext, null, 'no policy log-prob in the data target');
  if (!pd.noNext) close(pd.y, pd.r + 0.99 * Math.min(...pd.qNext), 'data target values the memory action');
});

test('value family targets match the learner probe numbers', () => {
  const H = { epsStart: 0.1, epsEnd: 0.1, lrTable: 0.5 };
  // taken: the action really taken next
  const pt = valProbe('cliff', val({ agg: 'taken' }), H, 1500);
  assert.ok(line(val({ agg: 'taken' }), 'cliff', 'target').includes('a_{t+1}'));
  close(pt.y, pt.R + pt.gk * pt.before.qN.live[pt.aN], 'taken target');
  // max with the same estimate choosing and scoring: argmax collapses to a plain max
  const pm = valProbe('cliff', val({ agg: 'max' }), H, 1500);
  const tmax = line(val({ agg: 'max' }), 'cliff', 'target');
  assert.ok(tmax.includes('\\max_{a\'}') && !tmax.includes('\\arg'), 'picker and scorer agree');
  close(pm.y, pm.R + pm.gk * Math.max(...pm.before.qN.live), 'max target');
  // minpair: the second twin picks the action, the smaller of the twins scores it
  const pairs = valProbe('cliff', val({ agg: 'max', scorer: 'minpair', picker: 'second' }), H, 1500);
  assert.ok(line(val({ agg: 'max', scorer: 'minpair', picker: 'second' }), 'cliff', 'target').includes('\\min\\big('));
  const q1 = pairs.before.qN.live, q2 = pairs.before.qN.second;
  let best = 0; for (let i = 1; i < q2.length; i++) if (q2[i] > q2[best]) best = i;
  close(pairs.y, pairs.R + pairs.gk * Math.min(q1[best], q2[best]), 'min-of-twins target at the second twin\'s best action');
});

// ---- policy objectives -----------------------------------------------------------------------
test('policy objective lines match the learner update and probe flags', () => {
  const pw = acProbe(ac({ aim: 'weighted' }));
  assert.ok(line(ac({ aim: 'weighted' }), 'pendulum', 'policy').includes('e^{A / \\sigma_A}'));
  assert.ok(pw.w !== undefined, 'the learner computed per-row weights');
  const pc = acProbe(ac({ aim: 'cond' }));
  assert.ok(line(ac({ aim: 'cond' }), 'pendulum', 'policy').includes('\\mathbb{1}'));
  assert.ok(pc.told !== undefined, 'the learner told each row whether it was better than usual');
  assert.ok(line(ac({ aim: 'none' }), 'pendulum', 'policy').includes('\\theta \\text{ frozen}'));
  assert.match(line(ac({ aim: 'copy' }), 'pendulum', 'policy'), /\\max \\log \\pi_\\theta\(a \\mid s\)/);
  // entropy term appears only where the learner pays it
  assert.ok(line(ac({ aim: 'q', head: 'gauss', entropy: 'auto' }), 'pendulum', 'policy').includes('\\alpha \\log \\pi'));
  assert.ok(!line(ac({ aim: 'q', head: 'gauss', entropy: 'none' }), 'pendulum', 'policy').includes('\\alpha \\log \\pi'), 'no entropy bonus is shown when none runs');
  assert.ok(!line(ac({ aim: 'q', head: 'det', entropy: 'auto' }), 'pendulum', 'policy').includes('\\alpha \\log \\pi'), 'the deterministic policy has no entropy term');
});

// ---- words the learner ignores never fake a change -------------------------------------------
test('an idle word produces no changed line and says why', () => {
  // memory is only used with replay
  let ex = AM.explain(val({ memory: 2000 }), val({ memory: 500 }), 'cliff');
  assert.deepEqual(ex.changedLines, [], 'no equation depends on the buffer size here');
  assert.ok(AM.idleWords(val({}), 'cliff').memory, 'and the panel says so');
  // choosing among samples needs a critic
  ex = AM.explain(ac({ critics: 'none', pick: 'best' }), ac({ critics: 'none', pick: 'qavg' }), 'pendulum');
  assert.deepEqual(ex.changedLines, [], 'pick is inert without a critic');
  assert.ok(AM.idleWords(ac({ critics: 'none', pick: 'best' }), 'pendulum').pick);
  // chunking only runs for a copying policy that acts alone with one sample
  ex = AM.explain(ac({ aim: 'q', chunk: 1 }), ac({ aim: 'q', chunk: 5 }), 'pendulum');
  assert.deepEqual(ex.changedLines, [], 'chunk is inert for a climbing policy');
  assert.ok(AM.idleWords(ac({ aim: 'q', chunk: 5 }), 'pendulum').chunk);
  // with one pass the PPO clip never binds
  ex = AM.explain(pg({ epochs: 1, ratio: 'plain' }), pg({ epochs: 1, ratio: 'clip' }), 'goalgrid');
  assert.deepEqual(ex.changedLines, [], 'the clip cannot act after a single pass');
  assert.ok(AM.idleWords(pg({ epochs: 1 }), 'goalgrid').ratio);
  // and it does act with several passes
  ex = AM.explain(pg({ epochs: 4, ratio: 'plain' }), pg({ epochs: 4, ratio: 'clip' }), 'goalgrid');
  assert.ok(ex.changedLines.includes('update'), 'with several passes the clip is real');
});

test('a real change names the affected line', () => {
  assert.ok(AM.explain(val({ agg: 'taken' }), val({ agg: 'max' }), 'cliff').changedLines.includes('target'));
  assert.ok(AM.explain(ac({ head: 'det' }), ac({ head: 'gauss' }), 'pendulum').changedLines.includes('act'));
  assert.ok(AM.explain(ac({ aim: 'q' }), ac({ aim: 'copy' }), 'pendulum').changedLines.includes('policy'));
  assert.ok(AM.explain(ac({ critics: 'two' }), ac({ critics: 'one' }), 'pendulum').changedLines.includes('target'));
  assert.ok(AM.explain(pg({ baseline: 'none' }), pg({ baseline: 'critic' }), 'goalgrid').changedLines.includes('critic'));
});

// ---- unnamed and custom combinations ---------------------------------------------------------
test('unnamed combinations derive their own real equations', () => {
  const custom = [
    val({ nstep: 3, agg: 'min', picker: 'second', scorer: 'minpair', data: 'replay', memory: 300 }),
    ac({ head: 'flow', aim: 'weighted', critics: 'one', next: 'smooth', penalty: 'cql', pick: 'qavg' }),
    pg({ baseline: 'group', credit: 'total', ratio: 'clip', epochs: 10, bonus: 0.01, group: 'same' }),
  ];
  for (const p of custom) {
    const lines = AM.lines(p, p.family === 'pg' ? 'goalgrid' : p.family === 'ac' ? 'pendulum' : 'cliff');
    assert.ok(lines.length >= 3, 'an unnamed combination still shows its equations');
  }
  const t = line(custom[0], 'cliff', 'target');
  assert.ok(t.includes('\\gamma^{3}') && t.includes('\\min\\big('), 'the words combine: 3 rewards, scored by the smaller twin');
  assert.ok(text(custom[1], 'pendulum').includes('v_\\theta'), 'flow acting with a weighted copy objective');
  assert.ok(text(custom[2], 'goalgrid').includes('R(\\tau)'), 'group baseline uses whole-episode returns');
});

test('bandit words change the bandit equations', () => {
  const b = (over) => Object.assign({ family: 'value', store: 'table', eps: false, ucb: false, optimistic: false, data: 'fresh', memory: 2000, step: 'alpha', nstep: 0, agg: 'max', picker: 'live', scorer: 'live', sync: 10 }, over);
  assert.ok(line(b({ ucb: true }), 'bandit', 'act').includes('c\\sqrt{\\ln t'), 'ucb adds the few-tries bonus to the score');
  assert.ok(line(b({ optimistic: true }), 'bandit', 'start'), 'optimism shows the high start');
  assert.ok(line(b({ eps: true }), 'bandit', 'explore'), 'epsilon shows the random pulls');
  const ex = AM.explain(b({ ucb: false }), b({ ucb: true }), 'bandit');
  assert.ok(ex.changedLines.includes('act'), 'the score line is what changes');
});
// ==== rare hallway worked case (section#rare-experiment) =====================================
// The equations must come from src/agents/rare.js, the same code that records the steps, and the
// substituted numbers must be the recorded ones. r (environment reward) and b (count bonus) are
// never merged, and no diagnosis answer is leaked.
const BBRARE = require(path.join(__dirname, '..', 'src', 'agents', 'rare.js'));
const BBRARE_RECORD = require(path.join(__dirname, '..', 'web', 'rare-record.js'));
const txt = (html) => [].concat(html).map((c) => (c && c.nodeType ? c.textContent : String(c))).join('');
const rareText = (m) => AM.rareLines(m, BBRARE.PROTOCOL).map(([l, h]) => l + ': ' + txt(h)).join('\n');
const stepText = (m, step) => AM.rareStepLines(m, step, BBRARE.PROTOCOL, { cells: BBRARE.CELL_LABELS, actions: BBRARE.PROTOCOL.actions }).lines.map(([l, h]) => l + ': ' + txt(h)).join('\n');
const method = (name) => BBRARE_RECORD.policies.find((p) => p.name === name);

test('each of the six methods derives its own real equations', () => {
  const P = BBRARE.PROTOCOL;
  assert.equal(P.alpha, 0.5); assert.equal(P.gamma, 0.95); assert.equal(P.eps, 0.05);
  const off = rareText(method('off'));
  assert.ok(off.includes('Score(s, a) = Q(s, a)') && off.includes('b = 0 at every step'), 'no bonus anywhere');
  const local = rareText(method('local'));
  assert.ok(local.includes('1/√n(s′)') && local.includes('+∞') && local.includes('before this visit'), 'score bonus uses the destination count before the visit, unseen means +∞');
  assert.ok(local.includes('b = 0 at every step'), 'score-only keeps the bonus out of the target');
  const target = rareText(method('targetOnly'));
  assert.ok(target.includes('Score(s, a) = Q(s, a)') && target.includes('b = 1/√n(s′)') && target.includes('after this visit'), 'target-only puts the bonus in the target, counted after the visit');
  const opt = rareText(method('optimism'));
  assert.ok(opt.includes('untried-action start') && opt.includes('20') && opt.includes('b = 0 at every step'), 'optimism changes only untried scores');
  const both = rareText(method('on'));
  assert.ok(both.includes('untried-action start') && both.includes('b = 1/√n(s′)'), 'the combination uses both');
  const wh = rareText(method('withheld'));
  assert.ok(wh.includes('withheld'), 'withheld reward is named, and never relabeled as the bonus');
  // the update line and the constants are the learner's own
  for (const name of ['off', 'local', 'targetOnly', 'optimism', 'on', 'withheld']) {
    const t = rareText(method(name));
    assert.ok(t.includes('α = ' + P.alpha) && t.includes(P.gamma), name + ' shows the real alpha and gamma');
    assert.ok(t.includes('ties pick the lowest action index'), name + ' states the tie rule');
  }
});

test('the equations never leak the diagnosis answer', () => {
  for (const name of ['off', 'local', 'targetOnly', 'optimism', 'on', 'withheld']) {
    const t = rareText(method(name));
    assert.ok(!t.includes('added to the environment reward'), name + ' does not answer the question');
    assert.ok(!t.includes('logged as environment reward'), name + ' does not answer the question');
  }
});

test('changing the method names exactly the term that changed', () => {
  let ex = AM.rareExplain(method('targetOnly'), method('local'));
  assert.ok(ex.lines.includes('act') && ex.lines.includes('b'), 'score and target terms both move');
  ex = AM.rareExplain(method('off'), method('targetOnly'));
  assert.deepEqual(ex.lines, ['target', 'b'], 'target-only touches only the target bonus');
  ex = AM.rareExplain(method('on'), method('withheld'));
  assert.deepEqual(ex.lines, ['r'], 'withheld touches only the environment reward');
  ex = AM.rareExplain(method('off'), method('optimism'));
  assert.ok(ex.lines.includes('act') && ex.lines.includes('boot'), 'optimism touches the score and the bootstrap');
});

test('the substituted step is the recorded update, nothing invented', () => {
  // the screenshot case: 28 steps, target bonus only, Start -> left -> Start, r = 0, bonus 0.186
  const run = BBRARE.run({ seed: 19, place: 'target', steps: 28 });
  const hit = run.trace.find((e) => e.s === 0 && e.a === 0 && e.nAfter === 29);
  assert.ok(hit, 'the step exists in the real trace');
  assert.equal(Math.round(hit.visitBonus * 1000) / 1000, 0.186);
  assert.equal(hit.env, 0);
  assert.equal(hit.intrinsic, hit.visitBonus);
  // the level feeds the recorded row (record shape) to the panel
  const step = { obs: hit.s, action: hit.a, state: hit.s2, reward: hit.env, visitBonus: hit.visitBonus,
    intrinsic: hit.intrinsic, nAfter: hit.nAfter, qBefore: hit.qBefore, qAfter: hit.qAfter,
    bootstrap: hit.bootstrap, actionScore: hit.actionScore, triedBefore: hit.triedBefore, explored: hit.explored };
  const t = stepText(method('targetOnly'), step);
  const r3 = (x) => String(Math.round(x * 1000) / 1000);
  assert.ok(t.includes('Start --left--> Start'), 'the transition is the recorded one');
  assert.ok(t.includes('r + b + γ · boot = 0 + 0.186 + 0.95 · ' + r3(hit.bootstrap)) , 'substituted values are the recorded ones');
  assert.ok(t.includes(r3(hit.qBefore) + ' → ' + r3(hit.qAfter)), 'Q before and after are shown');
  assert.ok(t.includes('n(s′) after this visit = 29'), 'the count is the recorded one');
  assert.ok(t.includes('1/√n(s′) = 0.186'), 'the bonus uses the recorded count');
  // the numbers are consistent with the update the learner applied
  const y = hit.env + hit.intrinsic + BBRARE.PROTOCOL.gamma * hit.bootstrap;
  assert.ok(Math.abs(hit.qAfter - (hit.qBefore + BBRARE.PROTOCOL.alpha * (y - hit.qBefore))) < 1e-12);
});

test('zero counts and withheld reward are explained, not hidden', () => {
  const localRun = BBRARE.run({ seed: 19, place: 'local', steps: 28 });
  const unseen = localRun.trace.find((e) => e.actionScore === Infinity);
  assert.ok(unseen, 'the score-only run meets an unseen destination');
  const rec = { obs: unseen.s, action: unseen.a, state: unseen.s2, reward: unseen.env, visitBonus: unseen.visitBonus,
    intrinsic: unseen.intrinsic, nAfter: unseen.nAfter, qBefore: unseen.qBefore, qAfter: unseen.qAfter,
    bootstrap: unseen.bootstrap, actionScore: unseen.actionScore, triedBefore: unseen.triedBefore, explored: unseen.explored };
  const t = stepText(method('local'), rec);
  assert.ok(t.includes('+∞') && t.includes('unseen before this visit'), 'the +∞ score is named');
  const info = AM.rareStepLines(method('local'), rec, BBRARE.PROTOCOL);
  assert.ok(info.notes.some((n) => n.includes('out of the target')), 'the bonus staying out of the target is said in words');
  const whRun = BBRARE.run({ seed: 19, place: 'backup', reward: 'none', steps: 28 });
  const whRec = Object.assign({}, rec, { obs: whRun.trace[0].s, action: whRun.trace[0].a, state: whRun.trace[0].s2,
    reward: whRun.trace[0].env, visitBonus: whRun.trace[0].visitBonus, intrinsic: whRun.trace[0].intrinsic,
    nAfter: whRun.trace[0].nAfter, qBefore: whRun.trace[0].qBefore, qAfter: whRun.trace[0].qAfter,
    bootstrap: whRun.trace[0].bootstrap, actionScore: whRun.trace[0].actionScore });
  const wh = AM.rareStepLines(method('withheld'), whRec, BBRARE.PROTOCOL);
  assert.ok(wh.notes.some((n) => n.includes('withhold')), 'r = 0 because the reward is withheld');
  assert.ok(txt(wh.lines.find(([l]) => l === 'step target')[1]).includes('r + b'), 'the target still shows r and b as separate terms');
});

test('the glossary follows the method, and definitions stay behind a click', () => {
  const gloss = (name) => Object.fromEntries(AM.rareGlossary(method(name)));
  assert.match(gloss('targetOnly').b, /inside the target/);
  assert.match(gloss('local').b, /sets b to 0/);
  assert.match(gloss('local')['Score(s, a)'], /\+∞/);
  assert.match(gloss('optimism')['Score(s, a)'], /untried/);
  assert.match(gloss('withheld').r, /forces r to 0/);
  assert.ok(!gloss('off').b.includes('paid inside the target'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'algorithm-math.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'algorithm-math.css'), 'utf8');
  assert.ok(src.includes('Click for symbol definitions'), 'definitions are a click, not a second always-open block');
  assert.equal(AM.symbolTex('γ (gamma)').tex, '\\gamma');
  assert.equal(AM.symbolTex('γ (gamma)').aside, 'gamma');
  assert.equal(AM.symbolTex('Q̄').tex, '\\bar{Q}');
  assert.match(AM.symbolTex('π_θ(a | s)').tex, /\\pi_\\theta\(a \\mid\s*s\)/);
  assert.ok(!css.includes('max-width: 100%'), 'wide formulas scroll at natural size instead of shrinking');
});

test('score-only never sees its bonus in the target, and the record agrees', () => {
  const run = BBRARE.run({ seed: 19, place: 'local', steps: 28 });
  assert.ok(run.trace.every((e) => e.intrinsic === 0 && e.visitBonus > 0), 'bonus measured, never in the target');
  const run2 = BBRARE.run({ seed: 19, place: 'target', steps: 28 });
  assert.ok(run2.trace.every((e) => e.intrinsic === e.visitBonus), 'target bonus is the visit bonus');
});
