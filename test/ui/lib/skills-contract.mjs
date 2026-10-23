import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function skillsContract(page, out, name) {
  const state = () => page.evaluate(() => ({ record: bellman.record(), replay: bellman.replay() }));
  const frame = () => page.locator('#skills-stage').evaluate(e => e.toDataURL());
  const links = async () => assert.ok(await page.evaluate(() => {
    const r = bellman.record(), stale = bellman.replay().stale;
    return [...document.querySelectorAll('#skills-stage, #skills-scene, #skills-chart, #skills-result, #skills-evidence')]
      .every(e => e.dataset.run === r.id && e.dataset.stale === String(stale)) && !document.body.innerText.includes(r.id);
  }), 'scene, chart, result and evidence share hidden record identity and stale state');
  const first = await state(); assert.equal(first.record.level, 'skills'); await links();
  if (await page.locator('#custom-notebook').count()) {
    if (!await page.locator('#custom-notebook').evaluate(e => e.open)) await page.locator('#custom-notebook > summary').click();
    await page.locator('#custom-notebook-tab-curve').click();
  }
  assert.ok(await page.locator('#skills-probabilities').isVisible(), 'measured probabilities are visible before reading replay updates');
  const original = JSON.stringify(first.record);
  fs.writeFileSync(path.join(out, name + '-record.json'), original);
  assert.equal(first.record.data.fresh.steps, 16);
  assert.equal(first.record.data.fresh.attempts, 16);
  await page.locator('#skills-replay').click(); const start = await frame();
  await page.locator('#skills-step').click(); const one = await frame(); assert.notEqual(one, start);
  assert.equal((await state()).replay.time, 1);
  await page.locator('#skills-watch').click();
  await page.waitForFunction(() => bellman.replay().time >= 3);
  await page.locator('#skills-watch').click();
  const paused = await state(); await page.waitForTimeout(500);
  assert.equal((await state()).replay.time, paused.replay.time);
  assert.equal(paused.replay.watching, false);
  await page.locator('#skills-replay').click(); assert.equal(await frame(), start);
  await page.locator('#skills-step').click(); assert.equal(await frame(), one);
  assert.equal(JSON.stringify((await state()).record), original, 'replay is pure');
  // Visit every event and compare its scene description and probability readout to the actual trace.
  for (let t = 2; t < first.replay.length; t++) {
    await page.locator('#skills-step').click();
    const snapshot = await page.evaluate(() => {
      const r = bellman.record(), t = bellman.replay().time, e = r.events.discriminator[t - 1];
      return { t, e, text: document.querySelector('#skills-event').innerText, probs: document.querySelector('#skills-probabilities').innerText };
    });
    assert.equal(snapshot.t, t);
    assert.ok(snapshot.text.includes(snapshot.e.skill.toUpperCase()));
    if (snapshot.e.kind === 'visit') assert.ok(snapshot.text.includes('Start → ' + snapshot.e.room));
    else {
      assert.ok(snapshot.text.includes('No new visit'));
      assert.ok(snapshot.probs.includes(String(Math.round(snapshot.e.piAfter.west * 1000) / 1000)));
    }
  }
  await page.screenshot({ path: path.join(out, name + '-updates.png'), fullPage: true });
  for (const method of ['shared', 'tie', 'novelty', 'discriminator']) {
    await page.locator('#skills-method').selectOption(method);
    assert.equal((await state()).record.id, first.record.id);
    await links();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#skills-replay').click(); await page.locator('#skills-watch').click();
  await page.waitForTimeout(500); assert.equal((await state()).replay.time, 0); assert.equal((await state()).replay.watching, false);
  await page.locator('#skills-step').click(); assert.equal((await state()).replay.time, 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#skills-scene summary').click();
  const sizes = await page.locator('#skills-scene button, #skills-scene select, #skills-scene summary').evaluateAll(es => es.map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  assert.ok(sizes.every(d => d.w >= 44 && d.h >= 44), JSON.stringify(sizes));
  await page.locator('#skills-bias').selectOption('0.5');
  const stale = await state(); assert.ok(stale.replay.stale); assert.equal(stale.record.id, first.record.id); await links();
  assert.ok(await page.locator('#skills-stale').isVisible()); assert.ok(await page.locator('#skills-run').isEnabled());
  await page.locator('#skills-run').click(); const fresh = await state();
  assert.notEqual(fresh.record.id, first.record.id); assert.equal(fresh.replay.stale, false); await links();
  assert.notDeepEqual(fresh.record.sample.counts, first.record.sample.counts);
  await page.locator('#skills-p [data-key="zero"]').click();
  await page.locator('#skills-d [data-key="signal"]').click();
  await page.locator('#skills-x [data-key="mi-policy"]').click(); assert.ok(await page.locator('#skills-complete').isDisabled());
  await page.locator('#skills-x [data-key="split"]').click(); assert.ok(await page.locator('#skills-complete').isEnabled());
  await page.locator('#skills-complete').click();
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes('skills')));
  fs.writeFileSync(path.join(out, name + '-rendered.txt'), await page.locator('main').innerText());
  return { original: first.record.id, rerun: fresh.record.id, events: first.replay.length - 1 };
}
