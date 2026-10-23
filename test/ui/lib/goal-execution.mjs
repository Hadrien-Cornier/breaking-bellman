import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function goalExecutionContract(page, id, out, name) {
  const q = suffix => page.locator('#' + id + '-' + suffix);
  const check = (value, message) => assert.ok(value, name + ': ' + message);
  const snapshot = () => q('scene').evaluate(e => e.toDataURL());
  await page.evaluate(id => bellman.level(id), id);
  check(await q('scene').isVisible(), 'measured scene exists before prediction');
  check(await page.evaluate(() => bellman.record() === null), 'entry clears previous record');
  check(await page.evaluate(() => document.querySelector('main.layout').firstElementChild.id === 'campaign-strip'), 'map comes first');
  await q('run').click();
  const record = await page.evaluate(() => bellman.record());
  check(record?.level === id && record.source === 'live', 'Run returns a measured record');
  const before = JSON.stringify(record);
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, width: viewport.width - 1 });
  await page.waitForTimeout(150);
  await page.setViewportSize(viewport);
  await page.waitForTimeout(150);
  check((await page.evaluate(() => bellman.record()))?.id === record.id, 'responsive remount retains the current measured record');
  const linked = () => page.evaluate(id => {
    const r = bellman.record(), state = bellman.replay();
    return ['scene', 'chart', 'result', 'evidence'].every(s => { const e = document.getElementById(id + '-' + s); return e.dataset.run === r.id && e.dataset.stale === String(state.stale); }) && !document.body.innerText.includes(r.id);
  }, id);
  check(await linked(), 'scene, event strip, result and evidence share an internal identity');
  const targets = await page.locator('#' + id + '-replay-lab button, #' + id + '-replay-lab select').evaluateAll(es => es.map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
  check(targets.every(r => r.width >= 44 && r.height >= 44), 'controls have 44px targets');
  await q('replay').click(); const zero = await snapshot();
  await q('step').click(); const one = await snapshot();
  check((await page.evaluate(() => bellman.replay())).time === 1, 'Step advances exactly one measured event');
  await q('replay').click(); check(await snapshot() === zero, 'Replay restores identical pixels');
  await q('step').click(); check(await snapshot() === one, 'draw is repeatable');
  await q('watch').click();
  await page.waitForFunction(() => bellman.replay().time >= 2);
  await q('watch').click();
  const paused = await page.evaluate(() => bellman.replay()); const pausedImage = await snapshot();
  await page.waitForTimeout(500);
  check(!(await page.evaluate(() => bellman.replay())).watching && await snapshot() === pausedImage, 'Pause stops replay');
  check(paused.time >= 2, 'Watch advanced the clock');
  check(JSON.stringify(await page.evaluate(() => bellman.record())) === before, 'replay leaves record unchanged');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await q('watch').click();
  check(!(await page.evaluate(() => bellman.replay())).watching, 'reduced motion does not autoplay');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const policy of record.policies) {
    await q('policy').selectOption(policy.name);
    const length = await page.evaluate(() => bellman.replay().length);
    for (let i = 1; i < length; i++) await q('step').click();
    const end = await q('frame').innerText();
    check(end.includes('stop') && end.includes('End:'), 'policy replay exposes terminal reason for ' + policy.name);
  }
  const next = id === 'hindsight' ? '1' : 'pit';
  await q('setting').selectOption(next);
  check((await page.evaluate(() => bellman.replay())).stale, 'meaningful setting marks record stale');
  check(await linked(), 'all surfaces mark stale');
  check(await q('run').isEnabled(), 'Run enabled for stale settings');
  await q('run').click();
  const fresh = await page.evaluate(() => bellman.record());
  check(fresh.id !== record.id && !(await page.evaluate(() => bellman.replay())).stale, 'rerun produces matching fresh record');
  check(await linked(), 'rerun keeps record identity linked');
  if (id === 'hindsight') check(fresh.metrics.hindsight.solved !== record.metrics.hindsight.solved, 'sweep setting changes held-out result');
  else check(fresh.report.execution.reachedPrize !== record.report.execution.reachedPrize, 'pit changes second option outcome');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await q('step').click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), theme + ' has no overflow');
    await page.screenshot({ path: path.join(out, name + '-' + theme + '.png'), fullPage: true });
  }
  const surfaces = await page.evaluate(id => {
    const text = {};
    for (const e of document.querySelectorAll('#' + id + '-lesson, #' + id + '-replay-lab, #' + id + '-rules, #' + id + '-result, #' + id + '-evidence')) text[e.id] = e.textContent;
    return text;
  }, id);
  fs.writeFileSync(path.join(out, name + '-record.json'), JSON.stringify({ initial: record, changed: fresh }, null, 2));
  fs.writeFileSync(path.join(out, name + '-teaching.json'), JSON.stringify(surfaces, null, 2));
  await page.evaluate(id => bellman.level(id === 'hindsight' ? 'hierarchy' : 'hindsight'), id);
  check(await page.evaluate(() => bellman.record() === null && bellman.replay().time === 0), 'switch clears previous custom world and record');
  await page.evaluate(() => bellman.level('cliff'));
  check(await page.evaluate(() => bellman.record() === null && bellman.replay().world === 'cliff'), 'switch to shared scene clears custom record');
  await page.evaluate(id => bellman.level(id), id);
  check(await page.evaluate(() => bellman.record() === null), 'return needs a fresh run');
  return { initial: record.id, changed: fresh.id, surfaces };
}

// Retain every question and feedback surface while exercising the completion path.
export async function goalExecutionLessonFlow(page, id, out, name) {
  const surfaces = [];
  const capture = async label => {
    surfaces.push({ label, text: await page.locator('#' + id + '-lesson').innerText() });
    await page.screenshot({ path: path.join(out, name + '-' + label + '.png'), fullPage: true });
  };
  const choices = async suffix => {
    const question = page.locator('#' + id + '-' + suffix);
    const keys = await question.locator('button').evaluateAll(es => es.map(e => e.dataset.key));
    for (const key of keys) {
      await question.locator('[data-key="' + key + '"]').click();
      await capture(suffix + '-' + key);
    }
  };
  // Reset only this isolated browser case so every initial option can be inspected.
  await page.evaluate(() => localStorage.setItem('breaking-bellman-v1', JSON.stringify({ intro: 1, level: 'cliff' })));
  await page.reload();
  await page.evaluate(id => bellman.level(id), id);
  await capture('prediction');
  await choices('p');
  await page.locator('#' + id + '-run').click();
  await choices('d');
  await page.locator('#' + id + '-continue').click();
  if (id === 'hindsight') {
    await page.locator('#hindsight-setting').selectOption('1');
    await page.locator('#hindsight-run').click();
    assert.equal((await page.evaluate(() => bellman.record())).metrics.hindsight.solved, 0);
    await page.locator('#hindsight-setting').selectOption('2');
    await page.locator('#hindsight-run').click();
  } else {
    for (const variant of ['pit', 'absolute', 'far', 'short', 'extra', 'long']) {
      await page.locator('#hierarchy-setting').selectOption(variant);
      assert.ok((await page.evaluate(() => bellman.replay())).stale);
      await page.locator('#hierarchy-run').click();
      const record = await page.evaluate(() => bellman.record());
      assert.equal(record.settings.variant, variant);
      if (['pit', 'absolute', 'far', 'short'].includes(variant)) assert.equal(record.report.execution.reachedPrize, false);
      if (variant === 'extra') assert.ok(record.data.prior.steps > 0);
      if (variant === 'long') assert.equal(record.report.flat.greedy.reached, true);
      await capture('setup-' + variant);
    }
  }
  await choices('x');
  await page.locator('#' + id + '-x [data-key="' + (id === 'hindsight' ? 'compute' : 'option') + '"]').click();
  await page.locator('#' + id + '-complete').click();
  assert.ok(await page.evaluate(id => JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes(id), id));
  await capture('complete');
  fs.writeFileSync(path.join(out, name + '-all-feedback.json'), JSON.stringify(surfaces, null, 2));
}
