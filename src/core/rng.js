(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});

  // mulberry32: small, fast, deterministic. Good enough for toy RL, not for crypto.
  function make(seed) {
    let s = (seed >>> 0) || 1;
    let spare = null;
    function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function normal() {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0;
      while (u === 0) u = next();
      v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    }
    return {
      seed,
      next,
      normal,
      int: (n) => Math.floor(next() * n),
      uniform: (a, b) => a + (b - a) * next(),
      choice: (arr) => arr[Math.floor(next() * arr.length)],
    };
  }

  RLA.rng = { make };
  if (typeof module === 'object' && module.exports) module.exports = RLA.rng;
})();
