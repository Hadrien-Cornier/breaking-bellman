(function () {
  'use strict';
  const X = globalThis.RLA.exact;
  async function sha256(bytes) {
    const sum = await globalThis.crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
    return Array.from(new Uint8Array(sum), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function unpack(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  function create(options) {
    const { versions, base, protocol = location.protocol, fetcher = fetch, digest = sha256, decompress = unpack, timeout = 15000 } = options;
    let index = null, indexAt = 0;
    async function lookup(config, signal) {
      if (protocol === 'file:') return { reason: 'Offline file: running Live.' };
      const controller = new AbortController(), abort = () => controller.abort();
      if (signal) { if (signal.aborted) return { reason: 'Cancelled.' }; signal.addEventListener('abort', abort, { once: true }); }
      const timer = setTimeout(abort, timeout);
      try {
        if (X.stringify(config.versions) !== X.stringify(versions)) throw Error('version mismatch');
        const key = await digest(X.stringify(config));
        if (!index || !index.records[key] || Date.now() - indexAt > 60000) {
          const response = await fetcher(base + '/index.json', { signal: controller.signal, cache: 'no-cache' });
          if (!response.ok) throw Error('index unavailable');
          const candidate = await response.json();
          if (candidate.schema !== 'bb-fast-index-v1' || X.stringify(candidate.versions) !== X.stringify(versions) || !candidate.records || typeof candidate.records !== 'object') throw Error('invalid index');
          index = candidate; indexAt = Date.now();
        }
        const ref = index.records[key];
        if (!ref) return { reason: 'No exact stored match: running Live.' };
        if (ref.path !== 'records/' + key + '.json.gz' || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1) throw Error('invalid shard reference');
        const response = await fetcher(base + '/' + ref.path, { signal: controller.signal });
        if (!response.ok) throw Error('shard unavailable');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== ref.bytes || await digest(bytes) !== ref.sha256) throw Error('shard integrity mismatch');
        const record = X.parse(await decompress(bytes));
        if (record.schema !== 'bb-full-results-v1' || record.key !== key || X.stringify(record.config) !== X.stringify(config) || !Array.isArray(record.results) || record.results.length !== config.seeds.length) throw Error('invalid stored record');
        for (let i = 0; i < record.results.length; i++) {
          const r = record.results[i];
          if (r.seed !== config.seeds[i] || r.world !== config.world || r.steps !== config.steps || !r.final || !r.ep || !Array.isArray(r.evals) || !Array.isArray(r.diag) || !Array.isArray(r.notes)) throw Error('incomplete stored results');
        }
        if (controller.signal.aborted) throw Error('cancelled');
        return { record };
      } catch (error) {
        index = null;
        return { reason: 'Stored results unavailable: running Live.' };
      } finally {
        clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort);
      }
    }
    return { lookup };
  }
  const api = { create, sha256 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.RLFAST = api;
})();
