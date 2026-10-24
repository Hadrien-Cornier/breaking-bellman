const test = require('node:test');
const assert = require('node:assert/strict');
const shell = require('../web/player-shell.js');

test('campaign entry is the map and does not depend on the saved level', () => {
  assert.equal(shell.mapOnEntry('campaign'), true);
  assert.equal(shell.mapOnEntry('workbench'), false);
});

test('a hidden stage keeps its bitmap instead of the old 200 by 180 fallback', () => {
  const legacy = { w: Math.max(200, 0), h: 0 || 180 };
  assert.ok(Math.abs(legacy.w / legacy.h - 16 / 7) > 0.2, 'the old fallback is not 16/7');
  assert.equal(shell.stageBitmap(0, 0, 16 / 7, true), null);
  assert.equal(shell.aspectRatio('16 / 7', 640, 280), 16 / 7);
  const kept = 640 / 280;
  assert.ok(Math.abs(kept - 16 / 7) < 1e-9);
  const phone = shell.stageBitmap(390, 292.5, shell.aspectRatio('4 / 3', 640, 280), false);
  assert.deepEqual(phone, { w: 390, h: 292.5 });
});

test('empty curves name the real measure and do not call the score a loss', () => {
  const rows = shell.emptyCurves('bandit', 'value');
  assert.equal(rows[0].title, 'Best machine chosen');
  assert.match(rows[0].status, /No pulls recorded yet/);
  assert.equal(rows[1].title, 'Training loss');
  assert.match(rows[1].status, /squared update error/);
  assert.doesNotMatch(rows[0].status, /loss/);
  assert.equal(shell.emptyCurves('cliff', 'value')[0].title, 'Score per test episode');
  assert.match(shell.emptyCurves('cliff', 'other')[1].status, /does not record a separate training loss/);
  for (const row of rows) assert.equal(row.status.includes('\u2014'), false);
});

test('a prediction opens once until the player asks again', () => {
  assert.equal(shell.claimPrediction('slots-p'), true);
  assert.equal(shell.claimPrediction('slots-p'), false);
  assert.equal(shell.claimPrediction('slots-d'), true);
});
