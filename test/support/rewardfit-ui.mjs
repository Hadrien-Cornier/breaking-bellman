// Shared by the all-level matrix and focused rewardfit acceptance.
import fs from 'node:fs';
import path from 'node:path';
export async function rewardfitContract(page, proof, verify, out) {
  const record = () => page.evaluate(() => BBREWARDFIT.record());
  const replay = () => page.evaluate(() => BBREWARDFIT.replay());
  const frame = () => page.locator('#rewardfit-scene').evaluate(e => e.toDataURL());
  await page.waitForFunction(() => BBREWARDFIT.record() && !document.querySelector('#rewardfit-run').disabled);
  const first = await record();
  proof.run = first;
  verify(first.level === 'rewardfit' && first.world === 'rewardfit', 'record belongs to rewardfit');
  verify(first.data.prior.steps === 12 && first.data.prior.attempts === 2 && first.data.fresh.steps === 0 && first.data.fresh.attempts === 0, 'prior demonstrations and fresh interactions are measured separately');
  verify(first.policies.map(p => p.label).join('|') === 'Closeness only|Fit from demonstrations', 'comparisons are named planners');
  const linked = async stale => page.evaluate(stale => {
    const record = BBREWARDFIT.record();
    return ['rewardfit-scene', 'rewardfit-chart', 'rewardfit-results', 'rewardfit-evidence'].every(id => {
      const e = document.getElementById(id); return e.dataset.run === record.id && e.dataset.stale === String(stale);
    }) && !document.body.innerText.includes(record.id);
  }, stale);
  verify(await linked(false), 'all measured surfaces share one internal, invisible identity');
  const dimensions = await page.locator('#rewardfit-lab button, #rewardfit-lab select, #rewardfit-step-card button').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  verify(dimensions.every(d => d.w >= 44 && d.h >= 44), 'all scene and teaching controls are at least 44px');
  const before = JSON.stringify(first);
  for (const policy of first.policies) {
    await page.locator('#rewardfit-policy').selectOption(policy.name);
    await page.locator('#rewardfit-replay').click();
    const zero = await frame();
    for (let t = 0; t < first.series[policy.name].length; t++) {
      if (t) await page.locator('#rewardfit-step').click();
      const expected = first.series[policy.name][t].obs;
      verify(await page.locator('#rewardfit-scene').getAttribute('data-cell') === expected.x + ',' + expected.y, policy.label + ' exact recorded cell at move ' + t);
    }
    await page.locator('#rewardfit-replay').click();
    verify(await frame() === zero, 'replay draws the identical starting frame for ' + policy.label);
  }
  await page.locator('#rewardfit-watch').click();
  await page.waitForFunction(() => BBREWARDFIT.replay().time >= 1);
  await page.locator('#rewardfit-watch').click();
  const paused = await frame(); await page.waitForTimeout(650);
  verify(!(await replay()).watching && await frame() === paused, 'Pause holds the current measured frame');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#rewardfit-watch').disabled);
  verify(await page.locator('#rewardfit-watch').isDisabled(), 'reduced motion disables autoplay');
  await page.locator('#rewardfit-step').click();
  verify(!(await replay()).watching, 'reduced motion permits manual stepping');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  verify(JSON.stringify(await record()) === before, 'replay never mutates engine data');
  const originalSide = first.settings.demonstrations;
  await page.locator('#rewardfit-demos').selectOption(originalSide === 'north' ? 'south' : 'north');
  verify((await replay()).stale && await linked(true), 'changing demonstrations marks every result stale');
  verify(await page.locator('#rewardfit-stale').isVisible() && await page.locator('#rewardfit-watch').isDisabled(), 'stale results require a new Run');
  verify(await page.locator('#rewardfit-scene').getAttribute('data-cell') === '0,1', 'stale scene returns to Start');
  verify(await page.locator('#rewardfit-step-card .why').count() === 0, 'stale answers have no feedback');
  await page.locator('#rewardfit-run').click();
  await page.waitForFunction(() => BBREWARDFIT.record() && !BBREWARDFIT.replay().stale && !document.querySelector('#rewardfit-run').disabled);
  const fresh = await record(); proof.changed = fresh;
  verify(fresh.id !== first.id && await linked(false), 'rerun links the changed settings and record');
  verify(fresh.series.fitted.some(p => p.obs.y === (fresh.settings.demonstrations === 'north' ? 0 : 2)), 'changing demos changes the measured fitted route');
  await page.locator('#rewardfit-constraint').selectOption('hazard-zero');
  verify((await replay()).stale, 'hazard constraint is a real stale-producing setting');
  await page.locator('#rewardfit-run').click();
  await page.waitForFunction(() => BBREWARDFIT.record()?.settings.constraint === 'hazard-zero' && !document.querySelector('#rewardfit-run').disabled);
  const locked = await record(); proof.locked = locked;
  verify(locked.metrics.fitted.weights[1] === 0 && locked.id !== fresh.id, 'constrained fit records a zero hazard weight and new identity');
  proof.result = await page.locator('#rewardfit-results').textContent();
  proof.rendered = await page.locator('#rewardfit-lab').innerText() + '\n' + await page.locator('#rewardfit-step-card').innerText();
  if (out) fs.writeFileSync(path.join(out, proof.name + '-rewardfit-records.json'), JSON.stringify({ first, fresh, locked }, null, 2));
}
