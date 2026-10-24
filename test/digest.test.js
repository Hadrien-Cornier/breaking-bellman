'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../web/digest.js'), 'utf8');
function browser(crypto) {
  const context = vm.createContext({ TextEncoder, crypto });
  vm.runInContext(source, context);
  return context;
}
test('HTTP fallback matches known SHA-256 vectors without Web Crypto', async () => {
  const { BB_DIGEST } = browser(undefined);
  assert.equal(await BB_DIGEST.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await BB_DIGEST.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await BB_DIGEST.sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
test('fallback equals native SHA-256 for UTF-8, padding boundaries, and byte views', async () => {
  const fallback = browser({}).BB_DIGEST;
  const native = browser(webcrypto).BB_DIGEST;
  const cases = ['πθ → sample 🤖', ...[1, 55, 56, 63, 64, 65, 127, 128, 257].map(n => new Uint8Array(Array.from({ length: n }, (_, i) => i % 256)))];
  const data = new Uint8Array([99, 1, 2, 3, 88]);
  cases.push(data.subarray(1, 4), new DataView(data.buffer, 1, 3), data.buffer);
  for (const input of cases) {
    const bytes = typeof input === 'string' ? Buffer.from(input) : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input);
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(await fallback.sha256(input), expected);
    assert.equal(await native.sha256(input), expected);
  }
});
test('HTTP run identity uses the exact existing serialization and SHA-256', async () => {
  const context = browser(undefined);
  vm.runInContext(fs.readFileSync(require.resolve('../src/sim/exact.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../web/run-record.js'), 'utf8'), context);
  const config = { world: 'bandit', seeds: [101], steps: 1 };
  const results = [{ seed: 101, world: 'bandit', steps: 1, final: { terminal: 'terminated' }, data: { fresh: { steps: 1, attempts: 1 } }, events: [] }];
  const record = await context.RLA.runRecord.create({ level: 'slots', config, results, source: 'live', label: 'test' });
  const expected = createHash('sha256').update(context.RLA.runRecord.identity('slots', config)).digest('hex');
  assert.equal(record.id, expected);
});
