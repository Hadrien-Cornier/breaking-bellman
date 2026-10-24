// Focused owner regression. Open the rewardfit lesson in chrome-devtools-axi first,
// then: chrome-devtools-axi run < test/ui/rewardfit-notebook.chrome.js
// Uses the actual Notebook tabs and Run button; no record or result is injected.
const check = (value, message) => { if (!value) throw Error(message); };
const readPanels = async phase => {
 const panels = [];
 for (const name of ['rule', 'curve', 'autopsy', 'notes']) {
  await page.click('#custom-notebook-tab-' + name);
  const value = await page.eval(`() => {
   const p = document.querySelector('#custom-notebook-${name}');
   return { text:p.innerText, height:p.getBoundingClientRect().height, hidden:p.hidden,
    selected:document.querySelector('#custom-notebook-tab-${name}').getAttribute('aria-selected'),
    record:bellman.record()?.id || null, html:p.innerHTML };
  }`);
  console.log(JSON.stringify({ phase, section:name, ...value }));
  panels.push({ name, ...value });
 }
 return panels;
};
check(await page.eval(() => !!document.querySelector('#rewardfit-scene')), 'Open rewardfit first');
check(await page.eval(() => !bellman.record()), 'Begin with an unmeasured lesson');
await page.click('#custom-notebook > summary');
const initial = await readPanels('prerun');
check(initial.every(p => !p.hidden && p.selected === 'true'), 'All tabs select their visible panel');
check(initial.every(p => p.text.trim() && p.height > 0), 'Pre-run Notebook panels must have visible guidance');
check(initial.every(p => !p.record && !p.html.includes('data-run=')), 'Guidance must not fabricate measured data');
check(!initial.find(p => p.name === 'curve').html.includes('data-time='), 'No measured reward samples before Run');
check(!initial.find(p => p.name === 'autopsy').html.includes('<table'), 'No measured result table before Run');
await page.click('#rewardfit-p button');
const prediction = await readPanels('prediction');
check(prediction.every(p => p.text.trim() && !p.record), 'Prediction redraw preserves guidance and does not run');
check(await page.eval(() => !document.querySelector('#rewardfit-p .why')), 'Feedback stays hidden until Run');
await page.click('#rewardfit-run');
await page.wait(500);
const measured = await readPanels('postrun');
check(measured.every(p => p.text.trim() && p.height > 0 && p.record), 'Run populates every Notebook section');
check(await page.eval(() => {
 const r = bellman.record();
 return ['rewardfit-scene','rewardfit-chart','rewardfit-results','rewardfit-evidence'].every(id => document.getElementById(id).dataset.run === r.id)
  && document.querySelectorAll('#rewardfit-chart [data-time]').length === Object.values(r.series).reduce((n, series) => n + series.length, 0)
  && document.querySelectorAll('#rewardfit-results tbody tr').length === r.policies.length;
}), 'Scene, Curve, Autopsy and Rule use the same real record and measured sample counts');
await page.click('#custom-notebook-tab-notes');
check(await page.eval(() => !!document.querySelector('#custom-notebook-notes #rewardfit-p .why')), 'Measured Notes show prediction feedback');
const identity = await page.eval(() => JSON.stringify(bellman.record()));
await page.click('#rewardfit-step');
await page.click('#rewardfit-replay');
check(await page.eval(() => JSON.stringify(bellman.record())) === identity, 'Replay preserves measured record');
await page.eval(() => {
 const select = document.querySelector('#rewardfit-demos');
 select.value = 'south'; select.dispatchEvent(new Event('change', { bubbles:true }));
});
const stale = await readPanels('stale');
check(stale.every(p => p.text.trim() && p.height > 0), 'Settings redraw keeps every Notebook panel nonempty');
check(await page.eval(() => !document.querySelector('#custom-notebook-notes .why')), 'Stale Notes hide old answer feedback');
check(await page.eval(() => JSON.stringify(bellman.record())) === identity, 'Changing settings does not fabricate a new record');
await page.click('#rewardfit-run');
await page.wait(500);
check(await page.eval(() => JSON.stringify(bellman.record())) !== identity, 'Rerun measures the new settings');
console.log('PASS rewardfit Notebook guidance, prediction redraw, measured identity and replay');
