import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Also callable alone after integration, without the expensive all-level matrix.
export async function inferencePanels(page, id, measured, verify) {
  const panels = {};
  for (const [section, suffix] of [['curve', 'chart'], ['autopsy', 'evidence']]) {
    const tab = page.locator('#custom-notebook-tab-' + section);
    if (await tab.count()) {
      const drawer = page.locator('#custom-notebook');
      if (!(await drawer.evaluate(e => e.open))) await drawer.locator('summary').click();
      await tab.click();
    }
    const panel = page.locator('#' + id + '-' + suffix);
    const text = await panel.innerText();
    const box = await panel.boundingBox();
    verify(!!box && box.height > 0 && text.trim().length > 0, section + ' has visible content ' + (measured ? 'after' : 'before') + ' Run');
    if (measured) {
      verify(!text.includes('Run the lesson to inspect'), section + ' replaces pre-run guidance with measured content');
      verify(await panel.locator(section === 'curve' ? 'table' : 'button').count() > 0, section + ' exposes measured ' + (section === 'curve' ? 'rows' : 'download'));
    } else {
      verify(text.includes('Run the lesson to inspect'), section + ' explains how to obtain measurements');
      verify(await panel.locator('table,svg,button').count() === 0, section + ' shows no measured output before Run');
    }
    panels[section] = { text, height: box?.height };
  }
  return panels;
}

// Shared by the complete registered-level matrix and the focused inference matrix.
export async function inferenceContract(page, proof, verify, out) {
  const id = proof.id, sel = suffix => '#' + id + '-' + suffix;
  const status = () => page.evaluate(id => {
    const record = bellman.record(), replay = bellman.replay();
    return { record, replay, linked: !!record && ['scene', 'chart', 'result', 'evidence'].every(s => {
      const e = document.getElementById(id + '-' + s);
      return e?.dataset.run === record.id && e.dataset.stale === String(replay.stale);
    }), visibleId: !!record && document.body.innerText.includes(record.id) };
  }, id);
  const frame = () => page.locator(sel('scene')).evaluate(e => JSON.stringify({ html: e.innerHTML, canvases: [...e.querySelectorAll('canvas')].map(c => c.toDataURL()) }));
  let state = await status();
  verify(state.record === null && state.replay.world === id, 'fresh inference world exists without a previous record');
  verify(await page.locator(sel('scene')).isVisible(), 'sensor or known-line experiment is visible before prediction');
  verify(await page.locator(sel('scene')).locator('svg,canvas').count() > 0, 'the experiment is drawn before Run');
  proof.panelsBefore = await inferencePanels(page, id, false, verify);
  proof.before = await page.locator(sel('scene')).innerText();
  await page.screenshot({ path: path.join(out, proof.name + '-before.png'), fullPage: true });
  // Follow the actual prediction before running on clean progress.
  const predict = page.locator(id === 'elbo' ? '#elbo-predict-loose' : '#messages-p-0');
  if (await predict.count()) await predict.click();
  await page.locator(sel('run')).click();
  await page.waitForFunction(() => bellman.record() !== null);
  state = await status();
  verify(state.record.level === id && state.linked && !state.visibleId, 'scene, charts, result and evidence share one internal identity');
  proof.panelsAfter = await inferencePanels(page, id, true, verify);
  const exactBefore = await page.evaluate(() => RLA.exact.stringify(bellman.record()));
  fs.writeFileSync(path.join(out, proof.name + '-run.json.gz'), gzipSync(exactBefore));
  proof.run = state.record;
  const sizes = await page.locator('#vpo-lab .replay-controls button, #vpo-lab .inference-setting select, #' + id + '-lesson button').evaluateAll(es => es.map(e => ({ id: e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
  verify(sizes.every(e => e.w >= 44 && e.h >= 44), 'settings, replay, Run and answer controls have 44px targets');
  await page.locator(sel('replay')).click(); const zero = await frame();
  await page.locator(sel('step')).click(); const one = await frame();
  verify((await status()).replay.time === 1 && zero !== one, 'Step advances one measured update');
  await page.locator(sel('watch')).click();
  await page.waitForFunction(() => bellman.replay().time >= 2);
  if ((await status()).replay.watching) await page.locator(sel('watch')).click();
  const paused = await frame(); await page.waitForTimeout(700);
  verify(await frame() === paused && !(await status()).replay.watching, 'Pause holds the exact recorded frame');
  await page.locator(sel('replay')).click(); verify(await frame() === zero, 'Replay returns to the identical first measured frame');
  await page.locator(sel('step')).click(); verify(await frame() === one, 'drawing is pure across seeks');
  verify(exactBefore === await page.evaluate(() => RLA.exact.stringify(bellman.record())), 'drawing never alters the measured record');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator(sel('watch')).click(); const reduced = await frame(); await page.waitForTimeout(700);
  verify(!(await status()).replay.watching && reduced === await frame(), 'reduced motion disables autoplay while Step remains available');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    verify((await status()).linked, theme + ' keeps one record identity');
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), theme + ' has no horizontal overflow');
    await page.screenshot({ path: path.join(out, proof.name + '-' + theme + '.png'), fullPage: true });
  }
  const diagnose = page.locator(id === 'elbo' ? '#elbo-diagnose-klprior' : '#messages-d-0');
  if (await diagnose.count()) await diagnose.click();
  const changed = id === 'elbo' ? 'rounds' : 'prior';
  await page.locator(sel(changed)).selectOption(id === 'elbo' ? '0' : '1');
  const stale = await status();
  verify(stale.record.id === state.record.id && stale.replay.stale && stale.linked, 'changed settings mark every previous surface stale');
  verify(await page.locator(sel('stale')).isVisible() && await page.locator(sel('run')).isEnabled(), 'stale explanation enables rerun');
  await page.screenshot({ path: path.join(out, proof.name + '-stale.png'), fullPage: true });
  await page.locator(sel('run')).click();
  await page.waitForFunction(old => bellman.record()?.id !== old && !bellman.replay().stale, state.record.id);
  const fresh = await status();
  verify(fresh.linked && JSON.stringify(fresh.record.metrics) !== JSON.stringify(state.record.metrics), 'rerun changes measured outcomes and replaces every record link');
  proof.rerun = fresh.record;
  const explain = page.getByRole('button', { name: 'Explain the changed result', exact: true });
  if (await explain.count()) await explain.click();
  const correct = page.locator(id === 'elbo' ? '#elbo-explain-match' : '#messages-x-0');
  if (await correct.count()) {
    await correct.click(); await page.locator(sel('complete')).click();
    verify(await page.locator(sel('complete')).innerText() === 'Lesson complete', 'the measured learner flow can complete');
  }
  if (id === 'messages') {
    await page.locator(sel('horizon')).selectOption('0');
    await page.locator(sel('miss')).selectOption('1');
    await page.locator(sel('run')).click();
    await page.waitForFunction(() => !bellman.replay().stale);
    for (let i = 0; i < 4; i++) await page.locator(sel('step')).click();
    const impossible = await status();
    verify(impossible.record.terminal.conditioned === 'undefined-distribution' && impossible.record.series.conditioned.length === 0, 'impossible condition records no invented move');
    verify((await page.locator(sel('scene')).innerText()).includes('STOP: the conditioned distribution is undefined'), 'undefined distribution visibly stops the replay');
    await page.screenshot({ path: path.join(out, proof.name + '-undefined.png'), fullPage: true });
  }
  proof.rendered = await page.locator('#vpo-lab').innerText();
  proof.teaching = await page.locator('#mode-pane').innerText();
  // Every declared setting must invalidate the measured run and actually be passed to the engine.
  const controls = await page.locator('#vpo-lab .inference-setting select').evaluateAll(es => es.map(e => ({ id: e.id, current: e.value, alternative: [...e.options].find(o => o.value !== e.value).value })));
  for (const control of controls) {
    await page.locator('#' + control.id).selectOption(control.alternative);
    verify((await status()).replay.stale, control.id + ' marks the run stale');
    await page.locator(sel('run')).click(); await page.waitForFunction(() => !bellman.replay().stale);
    verify((await status()).linked, control.id + ' reruns with linked measurements');
  }
  await page.evaluate(() => bellman.level('cliff'));
  verify(await page.evaluate(() => bellman.record() === null && bellman.replay().world === 'cliff'), 'switching away clears inference record and mounts the new world');
  await page.evaluate(id => bellman.level(id), id);
  verify((await status()).record === null && (await status()).replay.time === 0, 'returning starts a fresh inference world without an old run');
}
