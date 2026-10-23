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
  function completeResult(r, config, seed) {
    const has = (o, keys) => o && keys.every(k => Object.hasOwn(o, k));
    const lists = (o, keys) => has(o, keys) && keys.every(k => Array.isArray(o[k]));
    if (!has(r, ['world','seed','steps','parts','knobs','ep','evals','diag','notes','trace','bandit','table','peeks','final','dataset','data','events']) ||
        r.seed !== seed || r.world !== config.world || r.steps !== config.steps ||
        X.stringify(r.parts) !== X.stringify(config.parts) || X.stringify(r.knobs) !== X.stringify(config.knobs) ||
        !lists(r, ['evals','diag','notes','peeks']) || !lists(r.ep, ['t','ret','len','falls','left','success'])) return false;
    const counts = c => c && ['steps', 'attempts'].every(k => Number.isSafeInteger(c[k]) && c[k] >= 0);
    if (!['fresh', 'evaluation', 'replay'].every(k => counts(r.data[k])) || !Array.isArray(r.events) ||
        !r.events.every((e, i) => Number.isSafeInteger(e.t) && e.t > (i ? r.events[i - 1].t : 0) && ['terminated', 'time-limit'].includes(e.terminal)) ||
        !['terminated', 'time-limit', 'budget-complete'].includes(r.final.terminal)) return false;
    const offline = config.family === 'ac' && config.parts.source === 'fixed';
    if (r.data.fresh.steps !== (offline ? 0 : config.steps) || r.events.length !== r.ep.t.length ||
        !r.events.every((e, i) => e.t === r.ep.t[i] && e.steps === r.ep.len[i] && e.t <= config.steps) ||
        r.data.fresh.attempts !== r.events.length + (r.ep.len.reduce((sum, n) => sum + n, 0) < r.data.fresh.steps ? 1 : 0)) return false;
    // Worlds without a demonstrator intentionally return no dataset, even for fixed/both.
    // Inspect the same world capability as the engine without consuming its RNG stream.
    if (config.family === 'ac' && ['fixed', 'both'].includes(config.parts.source) && !r.dataset &&
        typeof globalThis.RLA.worlds[config.world].make(config.knobs, globalThis.RLA.rng.make(seed)).expert === 'function') return false;
    if (r.dataset !== null && (!Number.isSafeInteger(r.dataset.steps) || r.dataset.steps < 0 ||
        !Number.isSafeInteger(r.dataset.episodes) || r.dataset.episodes < 0)) return false;
    if (r.bandit !== null) {
      if (!has(r.final, ['means','q','best'])) return false;
      return ['reward','optimal','regret','arm'].every(k => ArrayBuffer.isView(r.bandit[k]) && r.bandit[k].length === config.steps);
    }
    if (!Array.isArray(r.trace) || !has(r, ['traceStart']) || !has(r.final, ['ret','disc','pred','success','dist'])) return false;
    if (!Number.isSafeInteger(r.final.len) || r.final.len < r.trace.length ||
        !r.trace.every(p => Array.isArray(p.obs) && typeof p.done === 'boolean' && typeof p.truncated === 'boolean')) return false;
    if (!r.evals.every(e => has(e, ['t','ret','disc','pred','maxQ','success','crashes','dist'])) ||
        !r.diag.every(d => has(d, ['t','loss','td','grad','eps','updates','kl','clipFrac','entropy','alpha','qData','qPolicy','std','zeroFrac']))) return false;
    const world = globalThis.RLA.worlds[config.world];
    if (world.evalEpisodes > 1 || config.parts.source === 'fixed') {
      if (!has(r.final, ['meanRet','successRate','crashRate','meanDist','leftRate','n','paths']) ||
          r.final.n !== config.evaluation.finalEpisodes || !Array.isArray(r.final.paths)) return false;
      if (world.base && !has(r.final, ['baseRet','baseDist'])) return false;
    }
    if (config.world === 'mirage' && !has(r.final, ['qA','qB'])) return false;
    if (config.world === 'pendulum' && (!has(r.replay, ['ret','start','trace']) || !Array.isArray(r.replay.trace))) return false;
    if (world.playable && config.family === 'pg' && !lists(r.policy, ['sizes','params'])) return false;
    return true;
  }
  function validRecord(record, config, key) {
    return record && record.schema === 'bb-full-results-v1' && record.key === key &&
      X.stringify(record.config) === X.stringify(config) && Array.isArray(record.results) &&
      record.results.length === config.seeds.length &&
      record.results.every((r, i) => completeResult(r, config, config.seeds[i]));
  }
  // Open per operation so another tab can upgrade or clear without a held connection.
  // Every storage failure is a cache miss, including a blocked or silent IDB request.
  function createLocal({ versions, storage = () => globalThis.indexedDB, digest = sha256, timeout = 1500 }) {
    let generation = 0;
    function operation(mode, action) {
      return new Promise(resolve => {
        let db, tx, settled = false;
        const finish = value => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (db) db.close();
          resolve(value);
        };
        const timer = setTimeout(() => { try { if (tx) tx.abort(); } catch (_) {} finish(null); }, timeout);
        try {
          const request = storage().open('breaking-bellman-results', 1);
          request.onerror = request.onblocked = () => finish(null);
          request.onupgradeneeded = () => {
            try {
              if (settled) { request.transaction.abort(); return; }
              request.result.createObjectStore('results');
            } catch (_) {
              try { request.transaction.abort(); } catch (_) {}
              finish(null);
            }
          };
          request.onsuccess = () => {
            db = request.result;
            if (settled) { db.close(); return; }
            db.onversionchange = () => db.close();
            try {
              tx = db.transaction('results', mode);
              const result = action(tx.objectStore('results'));
              tx.oncomplete = () => finish({ value: result.result });
              tx.onabort = tx.onerror = () => finish(null);
            } catch (_) { finish(null); }
          };
        } catch (_) { finish(null); }
      });
    }
    async function keyFor(config) {
      if (X.stringify(config.versions) !== X.stringify(versions)) return null;
      return digest(X.stringify(config));
    }
    async function lookup(config, signal) {
      try {
        if (signal && signal.aborted) return {};
        const key = await keyFor(config);
        if (!key) return {};
        const entry = await operation('readonly', store => store.get(key));
        if (!entry || typeof entry.value !== 'string' || (signal && signal.aborted)) return {};
        const record = X.parse(entry.value);
        return validRecord(record, config, key) ? { record, source: 'local' } : {};
      } catch (_) { return {}; }
    }
    async function save(config, results) {
      const started = generation;
      try {
        const key = await keyFor(config);
        const record = { schema: 'bb-full-results-v1', key, config, results };
        if (!key || !validRecord(record, config, key)) return false;
        const encoded = X.stringify(record);
        if (started !== generation) return false;
        return !!await operation('readwrite', store => store.put(encoded, key));
      } catch (_) { return false; }
    }
    async function clear() {
      generation++;
      return !!await operation('readwrite', store => store.clear());
    }
    return { lookup, save, clear };
  }
  function createCache(options) {
    const server = options.server || create(options), local = options.local || createLocal(options);
    return {
      async lookup(config, signal) {
        const hit = await server.lookup(config, signal);
        if (hit.record) return { ...hit, source: 'server' };
        if (signal && signal.aborted) return {};
        return local.lookup(config, signal);
      },
      save: local.save, clear: local.clear
    };
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
        if (!validRecord(record, config, key)) throw Error('invalid stored record');
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
  const api = { create, createLocal, createCache, sha256 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.RLFAST = api;
})();
