// A deterministic clock around the existing scene factories. No learner runs during replay.
(function () {
  'use strict';
  const create = ({ world, settings, render }) => {
    let element = null;
    const lengths = new WeakMap();
    return {
      world, settings,
      mount(el) { element = el; render(element, null, 0); },
      draw(record, t) {
        if (!element) throw Error('Mount the scene before drawing');
        if (record.world !== world) throw Error('Cannot replay a different world');
        render(element, record, Math.max(0, Math.floor(t)));
      },
      length(record) {
        if (!record || record.world !== world) return 0;
        if (!lengths.has(record)) lengths.set(record, render(element, record, null));
        return lengths.get(record);
      },
    };
  };
  globalThis.BB = globalThis.BB || {};
  globalThis.BB.sceneAdapter = { create };
  if (typeof module === 'object' && module.exports) module.exports = { create };
})();
