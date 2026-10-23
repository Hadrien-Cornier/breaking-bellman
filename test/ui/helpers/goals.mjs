// Used by both the all-level matrix and the focused goals acceptance test.
export async function goalsReplayContract(page, proof, verify) {
  const state = () => page.evaluate(() => ({ record: bellman.record(), replay: bellman.replay(),
    linked: ['#goals-stage', '#goals-scene', '#goals-chart', '#goals-result', '#goals-evidence'].every(selector => {
      const node = document.querySelector(selector); return node.dataset.run === bellman.record()?.id && node.dataset.stale === String(bellman.replay().stale);
    }) }));
  const frames = () => page.locator('#goals-scene canvas').evaluateAll(es => es.map(e => e.toDataURL()));
  await page.waitForFunction(() => bellman.record() && !document.querySelector('#goals-run').disabled);
  const initial = await state(); proof.record = initial.record;
  verify(initial.linked && !initial.replay.stale && initial.record.level === 'goals', 'one goals record links scene, chart, result and evidence');
  verify(initial.record.policies.map(p => p.label).join(',') === 'Hidden goal,Named goal', 'methods have explicit non-color names');
  verify(!await page.locator('body').innerText().then(text => text.includes(initial.record.id)), 'internal identity is not visible');
  verify(initial.record.series.hidden.map(s => s.obs).join(',') === 'start,west-hall,west-room', 'hidden path follows the measured west majority');
  verify(initial.record.series.named.map(s => s.obs).join(',') === 'start,east-hall,east-room', 'named path follows the measured east request');
  const before = JSON.stringify(initial.record), zero = await frames();
  await page.locator('#goals-step').click();
  const one = await frames();
  verify((await state()).replay.time === 1 && one[0] !== zero[0], 'Step draws the next measured state');
  await page.locator('#goals-replay').click();
  verify(JSON.stringify(await frames()) === JSON.stringify(zero), 'Replay restores the exact first frame');
  await page.locator('#goals-watch').click();
  await page.waitForFunction(() => bellman.replay().time === 1);
  await page.locator('#goals-watch').click();
  const paused = await state();
  await page.waitForTimeout(800);
  verify(!paused.replay.watching && (await state()).replay.time === paused.replay.time, 'Pause stops automatic progression');
  await page.locator('#goals-replay').click(); await page.locator('#goals-step').click();
  verify(JSON.stringify(await frames()) === JSON.stringify(one), 'same record and time produce the same pixels');
  verify(JSON.stringify((await state()).record) === before, 'drawing preserves all recorded measurements');
  await page.locator('#goals-step').click();
  const ends = await page.locator('#goals-scene canvas').evaluateAll(es => es.map(e => e.dataset.position));
  verify(ends[0] === initial.record.metrics.hidden.end && ends[1] === initial.record.metrics.named.end, 'last frame equals both measured endpoints');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#goals-watch').disabled);
  verify(await page.locator('#goals-watch').isDisabled(), 'reduced motion uses manual stepping');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const sizes = await page.locator('#goals-controls button, #goals-settings select, #goals-lesson button').evaluateAll(es => es.map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  verify(sizes.every(s => s.w >= 44 && s.h >= 44), 'goals controls have at least 44px targets'); proof.targets = sizes;
  await page.locator('#goals-goal').selectOption('west-room');
  const stale = await state();
  verify(stale.record.id === initial.record.id && stale.replay.stale && stale.linked, 'goal change retains and labels every previous measurement stale');
  verify(await page.locator('#goals-run').isEnabled() && await page.locator('#goals-stale').innerText().then(t => t.includes('Rerun')), 'changed goal offers a real rerun');
  await page.locator('#goals-run').click();
  await page.waitForFunction(() => !bellman.replay().stale && !document.querySelector('#goals-run').disabled);
  const west = await state(); proof.west = west.record;
  verify(west.record.id !== initial.record.id && west.linked && west.record.metrics.hidden.arrived && west.record.metrics.named.arrived, 'new goal produces new linked results');
  await page.locator('#goals-majority').selectOption('east'); await page.locator('#goals-run').click();
  await page.waitForFunction(() => !bellman.replay().stale && !document.querySelector('#goals-run').disabled);
  const reversed = await state(); proof.reversed = reversed.record;
  verify(reversed.record.metrics.hidden.end === 'east-room' && reversed.record.metrics.named.end === 'west-room', 'reversing the demonstration majority changes the hidden walk only');
  await page.locator('#goals-explain-open').click(); await page.locator('#goals-explain-count').click();
  verify(await page.locator('#goals-complete').isEnabled(), 'both measured goal requests and an explanation enable completion');
  await page.locator('#goals-complete').click();
  verify(await page.evaluate(() => JSON.parse(localStorage.getItem('breaking-bellman-v1')).done.includes('goals')), 'completion saves the stable goals id');
  proof.rendered = await page.locator('#goals-lesson').innerText();
  proof.result = await page.locator('#goals-result').textContent();
}
