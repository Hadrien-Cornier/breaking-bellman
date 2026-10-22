// Seed aggregate of a finished run. Chart means use the same formulas as the drawn curves.
// Quantiles are linear between sorted seed values: position p * (n - 1). p = 0 is the min, p = 1 is the max.
// Spread uses the sample standard deviation (divisor n - 1), the same definition as the autopsy.
(function () {
  'use strict';
  const SCHEMA = 'bb-seed-aggregate-v1';
  let lastMirageGap = 0;

  function engine() {
    const RLA = globalThis.RLA;
    if (!RLA || !RLA.autopsy || !RLA.stats || !RLA.rng) throw Error('aggregate needs the simulation engine');
    return RLA;
  }
  function meanCurve(lists) {
    const L = lists.reduce((m, l) => (l.length > m.length ? l : m), []);
    return { xs: L.map((p) => p.t), ys: L.map((_, i) => { const v = lists.map((l) => l[i] && l[i].v).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }) };
  }
  function movingMean(arr, w) {
    const o = new Float32Array(arr.length); let s = 0;
    for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= w) s -= arr[i - w]; o[i] = s / Math.min(i + 1, w); }
    return Array.from(o);
  }
  function curvesOf(results, world) {
    if (world === 'bandit') {
      const cs = results.map((r) => movingMean(r.bandit.optimal, 50));
      const m = cs[0].map((_, i) => cs.reduce((s, c) => s + c[i], 0) / cs.length);
      return { main: { xs: m.map((_, i) => i + 1), ys: m } };
    }
    if (world === 'mirage') {
      const NB = 100, m = [];
      for (let b = 0; b < NB; b++) {
        let acc = 0;
        for (const r of results) {
          const n = r.ep.left.length, a = Math.floor(n * b / NB), c = Math.max(a + 1, Math.floor(n * (b + 1) / NB));
          const seg = r.ep.left.slice(a, c);
          acc += seg.reduce((s, x) => s + x, 0) / Math.max(1, seg.length);
        }
        m.push(acc / results.length);
      }
      const mm = movingMean(m, 10);
      return { main: { xs: mm.map((_, i) => i + 1), ys: mm } };
    }
    const per = results.map((r) => r.evals);
    const mq = meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: isFinite(e.maxQ) ? e.maxQ : 1e9 }))));
    return {
      main: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.ret })))),
      pred: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.pred })))),
      disc: meanCurve(per.map((ev) => ev.map((e) => ({ t: e.t, v: e.disc })))),
      maxQ: mq,
    };
  }
  function valuesAt(lists, i) {
    const v = [];
    for (const l of lists) {
      const x = l[i] && l[i].v;
      if (x != null && isFinite(x)) v.push(x);
    }
    return v;
  }
  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    const x = p * (sorted.length - 1), i = Math.floor(x), f = x - i;
    const j = Math.min(sorted.length - 1, i + 1);
    return sorted[i] * (1 - f) + sorted[j] * f;
  }
  function statsOf(values) {
    const RLA = engine();
    if (!values.length) return { mean: NaN, std: NaN, min: NaN, p25: NaN, p50: NaN, p75: NaN, max: NaN };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = values.slice().sort((a, b) => a - b);
    return {
      mean, std: RLA.stats.sd(values), min: sorted[0], max: sorted[sorted.length - 1],
      p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75),
    };
  }
  function sameSeries(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  function bandFromLists(lists, plottedYs) {
    const curve = meanCurve(lists);
    const n = curve.xs.length;
    const mean = [], std = [], min = [], p25 = [], p50 = [], p75 = [], max = [];
    for (let i = 0; i < n; i++) {
      const s = statsOf(valuesAt(lists, i));
      mean.push(s.mean); std.push(s.std); min.push(s.min); p25.push(s.p25); p50.push(s.p50); p75.push(s.p75); max.push(s.max);
    }
    const target = plottedYs || curve.ys;
    if (!sameSeries(mean, target)) throw Error('aggregate mean diverged from the chart curve');
    return { xs: curve.xs, mean: target.slice(), std, min, p25, p50, p75, max };
  }
  function bandFromColumns(xs, columns, plottedYs) {
    const padded = columns.map((col) => xs.map((_, i) => ({ t: xs[i], v: col[i] })));
    return bandFromLists(padded, plottedYs);
  }
  function mirageBins(r) {
    const NB = 100, out = [];
    for (let b = 0; b < NB; b++) {
      const n = r.ep.left.length, a = Math.floor(n * b / NB), c = Math.max(a + 1, Math.floor(n * (b + 1) / NB));
      const seg = r.ep.left.slice(a, c);
      out.push(seg.reduce((s, x) => s + x, 0) / Math.max(1, seg.length));
    }
    return out;
  }
  function maxGap(a, b) {
    let g = 0;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = Object.is(a[i], b[i]) ? 0 : Math.abs((a[i] || 0) - (b[i] || 0));
      if (d > g) g = d;
    }
    return g;
  }
  function bandsOf(results, world) {
    const curves = curvesOf(results, world);
    if (world === 'bandit') {
      const columns = results.map((r) => movingMean(r.bandit.optimal, 50));
      return { curves, bands: { main: bandFromColumns(curves.main.xs, columns, curves.main.ys) }, taskRef: null, mirageGap: 0 };
    }
    if (world === 'mirage') {
      // The drawn curve smooths the average of the bins. Smoothing each seed first can differ by Float32 rounding.
      const columns = results.map((r) => movingMean(mirageBins(r), 10));
      const per = bandFromColumns(curves.main.xs, columns, null);
      const gap = maxGap(per.mean, curves.main.ys);
      per.mean = curves.main.ys.slice();
      return { curves, bands: { main: per }, taskRef: null, mirageGap: gap };
    }
    const ret = results.map((r) => r.evals.map((e) => ({ t: e.t, v: e.ret })));
    const pred = results.map((r) => r.evals.map((e) => ({ t: e.t, v: e.pred })));
    const disc = results.map((r) => r.evals.map((e) => ({ t: e.t, v: e.disc })));
    const maxQ = results.map((r) => r.evals.map((e) => ({ t: e.t, v: isFinite(e.maxQ) ? e.maxQ : 1e9 })));
    const bands = {
      ret: bandFromLists(ret, curves.main.ys),
      pred: bandFromLists(pred, curves.pred.ys),
      disc: bandFromLists(disc, curves.disc.ys),
      maxQ: bandFromLists(maxQ, curves.maxQ.ys),
    };
    const taskKey = world === 'goalgrid' || world === 'fork' || world === 'fetch' ? 'success' : world === 'reach' ? 'dist' : null;
    if (taskKey) bands.task = bandFromLists(results.map((r) => r.evals.map((e) => ({ t: e.t, v: e[taskKey] }))));
    const diag = (pick) => results.map((r) => (r.diag || []).map((x) => ({ t: x.t, v: pick(x) })));
    bands.kl = bandFromLists(diag((x) => Math.max(1e-4, Math.abs(x.kl || 0))));
    bands.ent = bandFromLists(diag((x) => x.entropy));
    bands.qPolicy = bandFromLists(diag((x) => x.qPolicy));
    bands.qData = bandFromLists(diag((x) => x.qData));
    const dists = results.map((r) => r.final && r.final.baseDist).filter((x) => typeof x === 'number' && isFinite(x));
    const taskRef = world === 'reach' && dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null;
    return { curves, bands, taskRef, mirageGap: 0 };
  }
  function playbackOf(r) {
    const world = r.world, final = r.final || {}, out = { world, seed: r.seed };
    if (world === 'bandit') {
      out.final = { means: final.means, q: final.q, best: final.best };
      out.bandit = { arm: r.bandit.arm, reward: r.bandit.reward };
    } else if (world === 'mirage') {
      out.final = { qA: final.qA };
      out.ep = { left: r.ep.left, ret: r.ep.ret };
    } else if (world === 'cliff') {
      out.table = r.table; out.peeks = r.peeks; out.trace = r.trace;
      out.ep = { len: r.ep.len, falls: r.ep.falls };
    } else if (world === 'cartpole') out.trace = r.trace;
    else if (world === 'pendulum') out.replay = r.replay;
    else if (world === 'reach') out.trace = r.trace, out.final = { dist: final.dist };
    else if (world === 'goalgrid') out.trace = r.trace, out.traceStart = r.traceStart, out.final = { success: final.success };
    else if (world === 'fetch') {
      out.trace = r.trace;
      out.final = { success: final.success };
      if (r.policy) out.policy = { sizes: r.policy.sizes, params: r.policy.params, act: r.policy.act };
    } else if (world === 'fork') out.final = { paths: final.paths, successRate: final.successRate, crashRate: final.crashRate };
    else out.trace = r.trace, out.final = final;
    return out;
  }
  function metricOf(a, world) {
    const s = a.summary;
    if (world === 'bandit') return { v: 100 * s.optimalLast20, up: true, pct: true, label: '% of late pulls on the best machine' };
    if (world === 'mirage') return { v: 100 * s.leftPeak, up: false, pct: true, label: '% left door at the worst point (lower is better)' };
    if (world === 'cliff') return { v: s.finalReturn, up: true, label: 'greedy score' };
    if (world === 'pendulum') return { v: isFinite(s.pendulumScore) ? s.pendulumScore : s.finalReturn, up: true, label: 'test score (0 is perfect)' };
    if (world === 'reach') return { v: isFinite(s.testReturn) ? s.testReturn : s.finalReturn, up: true, label: 'test score' };
    if (world === 'fork' || world === 'goalgrid' || world === 'fetch') return { v: 100 * s.successRate, up: true, pct: true, label: '% of tests solved' };
    return { v: s.finalReturn, up: true, label: 'score' };
  }
  function metricSE(res, world) {
    const RLA = engine();
    const n = res.length;
    if (n < 2) return NaN;
    const rng = RLA.rng.make(1337), draws = [];
    for (let b = 0; b < 200; b++) {
      const rs = [];
      for (let i = 0; i < n; i++) rs.push(res[Math.floor(rng.next() * n)]);
      const v = metricOf(RLA.autopsy(rs), world).v;
      if (isFinite(v)) draws.push(v);
    }
    if (draws.length < 2) return NaN;
    const m = draws.reduce((s, x) => s + x, 0) / draws.length;
    return Math.sqrt(draws.reduce((s, x) => s + (x - m) ** 2, 0) / (draws.length - 1));
  }
  function viewFromResults(results, spec) {
    if (!results || !results.length) throw Error('aggregate needs at least one seed');
    const world = spec && spec.world ? spec.world : (typeof spec === 'string' ? spec : results[0].world);
    const parts = (spec && spec.parts) || results[0].parts || {};
    const family = (spec && spec.family) || parts.family || (results[0].parts && results[0].parts.family) || 'value';
    const RLA = engine();
    const autopsy = RLA.autopsy(results);
    const drawn = bandsOf(results, world);
    lastMirageGap = drawn.mirageGap || 0;
    const bands = {};
    for (const name of expectedBands({ world, family, parts })) {
      if (!drawn.bands[name]) throw Error('missing aggregate curve ' + name);
      bands[name] = drawn.bands[name];
    }
    const metric = metricOf(autopsy, world);
    metric.se = metricSE(results, world);
    return {
      seedCount: results.length,
      notes: (results[0].notes || []).slice(),
      autopsy, metric,
      curves: drawn.curves,
      bands, taskRef: drawn.taskRef,
      playback: playbackOf(results[0]),
    };
  }
  function aggregateRecord(record) {
    if (!record || record.schema !== 'bb-full-results-v1' || !record.config) throw Error('expected a full result record');
    return { schema: SCHEMA, key: record.key, config: record.config, view: viewFromResults(record.results, record.config) };
  }
  function mirageGapOf(results) {
    if (!results || !results.length || results[0].world !== 'mirage') return 0;
    return bandsOf(results, 'mirage').mirageGap;
  }
  function familyOf(config) {
    return config.family || (config.parts && config.parts.family) || 'value';
  }
  function expectedBands(config) {
    const world = config.world, family = familyOf(config);
    if (world === 'bandit' || world === 'mirage') return ['main'];
    const names = ['ret', 'pred', 'disc', 'maxQ', 'kl', 'ent', 'qPolicy', 'qData'];
    if (world === 'goalgrid' || world === 'fork' || world === 'fetch' || world === 'reach') names.push('task');
    return names.filter((name) => {
      if (name === 'maxQ') return family === 'value';
      if (name === 'kl') return family === 'pg';
      if (name === 'ent') return family === 'pg' && world !== 'pendulum';
      if (name === 'qPolicy' || name === 'qData') return family === 'ac' && config.parts && config.parts.critics !== 'none';
      return true;
    });
  }
  function bandOK(b) {
    if (!b || !Array.isArray(b.xs)) return false;
    const n = b.xs.length;
    return ['mean', 'std', 'min', 'p25', 'p50', 'p75', 'max'].every((k) => Array.isArray(b[k]) && b[k].length === n);
  }
  function playbackOK(p, world) {
    if (!p || p.world !== world || !Number.isFinite(p.seed)) return false;
    if (world === 'bandit') return !!(p.bandit && p.bandit.arm && p.bandit.reward && p.final && p.final.means && p.final.q);
    if (world === 'mirage') return !!(p.ep && p.ep.left && p.ep.ret && p.final && p.final.qA);
    if (world === 'cliff') return !!(p.ep && p.ep.len && p.ep.falls && Array.isArray(p.trace) && Object.hasOwn(p, 'table') && Object.hasOwn(p, 'peeks'));
    if (world === 'cartpole') return Array.isArray(p.trace);
    if (world === 'pendulum') return !!(p.replay && Array.isArray(p.replay.trace));
    if (world === 'reach') return Array.isArray(p.trace) && p.final && Object.hasOwn(p.final, 'dist');
    if (world === 'goalgrid') return Array.isArray(p.trace) && p.final && Object.hasOwn(p.final, 'success') && Object.hasOwn(p, 'traceStart');
    if (world === 'fetch') return Array.isArray(p.trace) && p.policy && p.policy.sizes && p.policy.params && p.final && Object.hasOwn(p.final, 'success');
    if (world === 'fork') return !!(p.final && Array.isArray(p.final.paths) && Object.hasOwn(p.final, 'successRate') && Object.hasOwn(p.final, 'crashRate'));
    return Array.isArray(p.trace);
  }
  function validAggregateRecord(record, config, key) {
    if (!record || record.schema !== SCHEMA || record.key !== key || !config) return false;
    const X = globalThis.RLA && globalThis.RLA.exact;
    if (!X || X.stringify(record.config) !== X.stringify(config)) return false;
    const view = record.view;
    if (!view || view.seedCount !== config.seeds.length || !Array.isArray(view.notes)) return false;
    if (!view.autopsy || !Array.isArray(view.autopsy.symptoms) || !view.autopsy.summary || view.autopsy.summary.seeds !== config.seeds.length) return false;
    if (!view.metric || typeof view.metric.v !== 'number' || typeof view.metric.se !== 'number' || typeof view.metric.label !== 'string' || typeof view.metric.up !== 'boolean') return false;
    if (!view.curves || !view.curves.main || view.curves.main.xs.length !== view.curves.main.ys.length) return false;
    if (config.world !== 'bandit' && config.world !== 'mirage') {
      if (!view.curves.pred || !view.curves.disc || !view.curves.maxQ) return false;
    }
    if (!view.bands) return false;
    for (const name of expectedBands(config)) if (!bandOK(view.bands[name])) return false;
    if (!(view.taskRef == null || typeof view.taskRef === 'number')) return false;
    if (!playbackOK(view.playback, config.world) || view.playback.seed !== config.seeds[0]) return false;
    return true;
  }

  const api = {
    SCHEMA, meanCurve, movingMean, curvesOf, quantile, statsOf, metricOf, metricSE,
    viewFromResults, aggregateRecord, expectedBands, validAggregateRecord, playbackOf, mirageGapOf,
    takenMirageGap: () => lastMirageGap,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  const root = typeof globalThis === 'undefined' ? this : globalThis;
  root.RLAGG = api;
  if (typeof window !== 'undefined') window.RLAGG = api;
})();
