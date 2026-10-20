'use strict';
// Consume the frozen 151 selection, never re-expand private history or AC neighbors.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { exact, hash, source, content } = require('./fast-source.js');
function select(dir) {
  const prior = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  const anchors = JSON.parse(fs.readFileSync(path.join(dir, 'anchors.json')));
  const C = content(), current = source(), rows = new Map(), mappings = [];
  const nonAC = new Set(C.levels.filter(l => C.famOf(l.start) !== 'ac').map(l => l.id));
  const resolve = (lv, parts, knobs, steps, seeds) => exact.resolve({ world: lv.world, parts,
    knobs: Object.assign({}, lv.knobs, knobs), hyper: Object.assign({}, C.hyperOf(parts, lv.world), lv.hyper), steps }, seeds, current.versions, C);
  function add(config, levels, oldKey) {
    const key = hash(exact.stringify(config));
    if (!rows.has(key)) rows.set(key, { key, config, levels: [] });
    const row = rows.get(key); row.levels = [...new Set([...row.levels, ...levels])].sort();
    if (oldKey) mappings.push({ previous: oldKey, current: key });
  }
  for (const e of prior.entries) {
    const levels = e.levels.filter(l => nonAC.has(l));
    if (!levels.length) continue;
    const c = e.config, lv = C.levels.find(l => l.id === levels[0]);
    const config = resolve(lv, c.parts, c.knobs, c.steps, c.seeds);
    assert.equal(exact.stringify(config.hyper), exact.stringify(c.hyper), '151 hyper changed; explain before compute');
    assert.equal(exact.stringify(config.knobs), exact.stringify(c.knobs), '151 knobs changed; explain before compute');
    add(config, levels, e.key);
  }
  for (const a of anchors) {
    if (nonAC.has(a.level)) continue;
    const lv = C.levels.find(l => l.id === a.level);
    add(resolve(lv, a.parts, a.knobs, lv.steps, Array.from({ length: lv.seeds }, (_, i) => 101 * (i + 1))), [a.level]);
  }
  const entries = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { manifest: { schema: 'bb-campaign-v1', versions: current.versions, entries }, evidence: { source: current,
    selection: 'all151 non-AC memberships; AC anchors only', previousManifestSHA256: hash(fs.readFileSync(path.join(dir,'manifest.json'))),
    anchorsSHA256: hash(fs.readFileSync(path.join(dir,'anchors.json'))), mappings,
    counts: Object.fromEntries(C.levels.map(l => [l.id, entries.filter(e => e.levels.includes(l.id)).length])),
    keys: entries.length, seedRuns: entries.reduce((n, e) => n + e.config.seeds.length, 0) } };
}
if (require.main === module) {
  const { manifest, evidence } = select(process.argv[2]); fs.mkdirSync(process.argv[3], { recursive: true });
  for (const [f, x] of Object.entries({ 'manifest.json': manifest, 'selection-evidence.json': evidence })) fs.writeFileSync(path.join(process.argv[3], f), exact.stringify(x) + '\n');
  console.log(JSON.stringify({ manifestSHA256: hash(exact.stringify(manifest) + '\n'), ...evidence, mappings: evidence.mappings.length }, null, 2));
}
module.exports = { select };
