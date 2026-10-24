// Bounded shell lifecycle fixture, not acceptance of the integrated lesson adapters.
// node build.mjs && node test/ui/notebook-objective.mjs EXTERNAL_PROOF_DIR [URL]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { exact, source, content } = require('../../scripts/fast-source.js');
const C = content(), lesson = C.levels.find(l => l.id === 'slots');
const config = exact.resolve({ world: lesson.world, parts: lesson.start, knobs: lesson.knobs,
  steps: 12, hyper: C.hyperOf(lesson.start, lesson.world) }, [101], source().versions, C);
const [proof, url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
if (!proof) throw Error('Pass an external proof directory');
fs.mkdirSync(proof, { recursive: true });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: process.env.CHROME_DEVTOOLS_AXI_SESSION || 'bb-notebook-objective' };
const cli = (...args) => execFileSync('chrome-devtools-axi', args, { encoding: 'utf8', env, timeout: 60000, maxBuffer: 2 ** 22 });
const click = selector => execFileSync('chrome-devtools-axi', ['run'], {
  input: `await page.click(${JSON.stringify(selector)});`, encoding: 'utf8', env, timeout: 60000,
});
const evaluate = fn => {
  const output = cli('eval', String(fn)), match = output.match(/^result: (.+)$/m);
  if (!match) throw Error(output);
  const value = JSON.parse(match[1]);
  return typeof value === 'string' ? JSON.parse(value) : value;
};
cli('open', url);
evaluate(() => { localStorage.setItem('breaking-bellman-v1', JSON.stringify({ intro: 1 })); return true; });
cli('open', url);
const results = [];
for (const width of [1280, 390]) {
  cli('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1');
  cli('open', url);
  for (const id of ['vpo', 'supermimic']) {
    evaluate(`() => { bellman.level(${JSON.stringify(id)}); return true; }`);
    click('#custom-notebook > summary'); click('#custom-notebook-tab-rule');
    const surface = evaluate(() => ({
      text: document.querySelector('#custom-notebook-rule').innerText,
      objective: document.querySelector('#custom-notebook-objective')?.innerText,
      count: document.querySelectorAll('#custom-notebook-objective').length,
    }));
    const goal = evaluate(`() => CONTENT.levels.find(l => l.id === ${JSON.stringify(id)}).goal.text`);
    surface.level = id; surface.goal = goal;
    assert.equal(surface.count, 1, id + ': one objective at actual entry');
    assert.ok(surface.objective.includes(goal), id + ': actual existing objective');
    fs.writeFileSync(path.join(proof, `${width}-${id}-surface.json`), JSON.stringify(surface, null, 2));
    cli('screenshot', path.join(proof, `${width}-${id}-rule.png`));
  }
  // Mimic the integrated consumers' replacement redraws, nested evidence and
  // append-only rules. The Run below uses the actual engine and RunRecord API.
  evaluate(`() => {
    window.objectiveFixture = { config: ${JSON.stringify(config)}, record: null };
    BBVPO.mount = (pane, lab, { h, shell }) => {
      const fixture = window.objectiveFixture;
      const scene = h('p', { id: 'objective-scene' }); lab.replaceChildren(scene);
      const adapter = BB.sceneAdapter.create({ world: fixture.config.world, settings: fixture.config,
        render: (el, record) => { el.dataset.run = record?.id || ''; el.textContent = record ? record.events.current.length + ' measured pull events' : 'Scene before prediction'; } });
      adapter.mount(scene);
      const draw = () => {
        const rules = h('details', null, [h('summary', { text: 'Existing substantive rules' }), h('p', { text: 'Fixture rule text stays inside its original disclosure.' })]);
        shell.notebook('rule').replaceChildren(rules);
        shell.notebook('rule').append(h('p', { text: 'Appended evidence stays available.' }));
        pane.replaceChildren(h('button', { id: 'objective-run', onclick: async () => {
          const output = RLA.run(RLA.exact.runConfig(fixture.config, 101));
          fixture.record = await RLA.runRecord.create({ level: 'vpo', config: fixture.config, results: [output], source: 'live', label: 'Fixture measured policy' });
          draw();
        } }, 'Run'), h('button', { id: 'objective-settings', onclick: draw }, 'Redraw settings'));
        if (fixture.record) adapter.draw(fixture.record, 0);
      };
      draw();
    };
    bellman.level('cliff'); bellman.level('vpo'); return true;
  }`);
  const inspect = phase => {
    const observation = evaluate(() => {
      const panel = document.querySelector('#custom-notebook-rule');
      const objective = document.querySelector('#custom-notebook-objective');
      const fixture = window.objectiveFixture;
      return { text: panel.innerText, goal: CONTENT.levels.find(l => l.id === 'vpo').goal.text,
        count: document.querySelectorAll('#custom-notebook-objective').length,
        objectiveVisible: !!objective?.innerText, nestedOpen: panel.querySelector('details').open,
        originalRule: panel.textContent.includes('Fixture rule text stays inside its original disclosure.'),
        summaryHeight: panel.querySelector('summary').getBoundingClientRect().height,
        record: fixture.record?.id, sceneRecord: document.querySelector('#objective-scene').dataset.run,
        fresh: fixture.record?.data.fresh.steps, events: fixture.record?.events.current.length,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    results.push({ width, phase, ...observation });
    fs.writeFileSync(path.join(proof, 'results.json'), JSON.stringify(results, null, 2));
    assert.equal(observation.count, 1, `${width}/${phase}: one shell objective`);
    assert.ok(observation.objectiveVisible && observation.text.includes(observation.goal), `${width}/${phase}: exact visible challenge`);
    assert.ok(observation.text.includes('Appended evidence stays available.'), 'lesson append preserved');
    assert.equal(observation.nestedOpen, false, 'objective visible without opening original disclosure');
    assert.ok(observation.originalRule, 'original substantive rule text preserved');
    assert.ok(observation.summaryHeight >= 44, 'nested disclosure keeps its touch target');
    assert.equal(observation.overflow, false, 'viewport fit');
    if (observation.record) {
      assert.equal(observation.sceneRecord, observation.record, 'same measured record after redraw');
      assert.equal(observation.fresh, 12); assert.ok(observation.events > 0);
    }
    return observation;
  };
  click('#custom-notebook > summary'); click('#custom-notebook-tab-rule');
  inspect('entry');
  click('#objective-run');
  cli('wait', '250');
  const measured = inspect('run'); assert.ok(measured.record, 'real engine run completed');
  click('#objective-settings');
  assert.equal(inspect('settings').record, measured.record, 'settings redraw retains record');
  evaluate(() => { bellman.level('cliff'); bellman.level('vpo'); return true; });
  click('#custom-notebook > summary'); click('#custom-notebook-tab-rule');
  inspect('reentry');
  cli('screenshot', path.join(proof, width + '-rule.png'));
}
fs.writeFileSync(path.join(proof, 'console.txt'), cli('console'));
assert.ok(cli('console', '--type', 'error').includes('<no console messages found>'), 'no application errors');
console.log('PASS shell objective: entry, engine Run, settings redraw, reentry; desktop and touch phone');
