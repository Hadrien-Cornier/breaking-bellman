import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function skewReplay(page, out, name, verify = assert.ok) {
  const read = () => page.evaluate(() => ({ record: bellman.record(), replay: bellman.replay(),
    linked: ['skew-stage', 'skew-curve', 'skew-results', 'skew-evidence'].every(id => {
      const e = document.getElementById(id); return e.dataset.run === bellman.record()?.id && e.dataset.stale === String(bellman.replay().stale);
    }), visibleId: document.body.innerText.includes(bellman.record()?.id) }));
  const frame = () => page.locator('#skew-stage').evaluate(e => e.toDataURL());
  await page.waitForFunction(() => bellman.record()?.level === 'skew');
  const first = await read();
  verify(first.linked && !first.visibleId, 'Skew scene, chart, result and evidence share one internal identity');
  verify(first.record.policies.map(p => p.label).join('|') === 'Inverse density|Uniform names|Follow density', 'methods are named, seeds remain internal');
  fs.writeFileSync(path.join(out, name + '-record.json'), JSON.stringify(first.record));
  const original = JSON.stringify(first.record);
  const small = await page.locator('#skew-lab button,#skew-lab select,#skew-lab input').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(d => d.w < 44 || d.h < 44));
  verify(small.length === 0, 'Skew replay targets are 44px: ' + JSON.stringify(small));
  await page.locator('#skew-replay').click(); const zero = await frame();
  await page.locator('#skew-step').click(); const one = await frame();
  verify((await read()).replay.time === 1, 'step advances from actual request to outcome');
  await page.locator('#skew-replay').click(); verify(await frame() === zero, 'replay restores identical initial frame');
  await page.locator('#skew-step').click(); verify(await frame() === one, 'same event produces identical scene');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#skew-watch').click();
  await page.waitForFunction(() => bellman.replay().time > 3);
  await page.locator('#skew-watch').click(); const paused = await read(), still = await frame();
  await page.waitForTimeout(350);
  verify((await read()).replay.time === paused.replay.time && await frame() === still, 'Pause stops playback');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#skew-watch').click(); const reduced = (await read()).replay.time;
  await page.waitForTimeout(350);
  verify((await read()).replay.time === reduced && !(await read()).replay.watching, 'reduced motion only steps on explicit action');
  verify(JSON.stringify((await read()).record) === original, 'replay never modifies the measured record');
  // Inspect every event projected by the same adapter function, including all sealed failures.
  verify(await page.evaluate(() => {
    const r = bellman.record();
    return r.policies.every(({ name }) => {
      const events = r.events[name], fresh = r.metrics[name].fresh;
      if (events.length !== fresh.attempts * 2) return false;
      for (let t = 0; t < events.length; t++) {
        const f = BBSKEW.records.frame(r, name, t), e = events[t];
        if (JSON.stringify(f.event) !== JSON.stringify(e)) return false;
        if (e.goal === r.settings.sealed && e.state !== 'Hall') return false;
      }
      const final = BBSKEW.records.frame(r, name, events.length - 1);
      return JSON.stringify(final.counts) === JSON.stringify(r.metrics[name].achieved);
    });
  }), 'all measured requests/outcomes reconstruct final counts and sealed rooms stay unentered');
  await page.locator('#skew-lab summary').click();
  await page.locator('#skew-budget').fill('30'); await page.locator('#skew-budget').press('Tab');
  const stale = await read(); verify(stale.replay.stale && stale.linked && stale.record.id === first.record.id, 'changing budget marks the retained record stale everywhere');
  verify(await page.locator('#skew-stale').isVisible(), 'stale explanation is visible');
  await page.locator('#skew-run').click(); await page.waitForFunction(() => bellman.record()?.settings.budget === 30 && !bellman.replay().stale);
  verify((await read()).record.id !== first.record.id && (await read()).linked, 'rerun replaces every linked surface');
  await page.locator('#skew-lab summary').click();
  await page.locator('#skew-smoothing').selectOption('0'); await page.locator('#skew-run').click();
  await page.waitForFunction(() => bellman.record()?.settings.smoothing === 0 && !bellman.replay().stale);
  const none = await read();
  verify(none.record.events.inverse.length === 0 && none.record.metrics.inverse.fresh.attempts === 0 && none.replay.length === 0, 'undefined inverse yields no sample or attempt');
  verify(await page.locator('#skew-step').isDisabled() && await page.locator('#skew-watch').isDisabled(), 'undefined inverse cannot animate a fabricated frame');
  verify((await page.locator('#skew-event').innerText()).includes('undefined'), 'no-sample reason is visible');
  await page.locator('#skew-method').selectOption('uniform');
  verify((await read()).replay.length === 60, 'valid uniform requests still replay without smoothing');
  await page.locator('#skew-lab summary').click(); await page.locator('#skew-sealed').selectOption('B');
  await page.locator('#skew-run').click(); await page.waitForFunction(() => bellman.record()?.settings.sealed === 'B' && !bellman.replay().stale);
  const swapped = await read();
  verify(swapped.record.metrics.uniform.achieved.B === 0 && swapped.record.metrics.uniform.achieved.C > 0, 'door setting changes actual outcomes independently of prior counts');
  const failureIndex = swapped.record.events.uniform.findIndex(e => e.kind === 'outcome' && e.goal === 'B');
  await page.locator('#skew-time').evaluate((e, t) => { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, failureIndex);
  verify((await page.locator('#skew-stage').getAttribute('aria-label')).includes('Robot in Hall'), 'sealed failure drawn in Hall');
  await page.screenshot({ path: path.join(out, name + '-sealed.png'), fullPage: true });
  fs.writeFileSync(path.join(out, name + '-rendered.txt'), await page.locator('main').innerText());
  return { first: first.record.id, after: swapped.record.id, attempts: swapped.record.data.fresh.attempts };
}
