// Campaign metadata and advisory progress, independent of rendering and saves.
// level.world remains the simulation id; campaignWorld groups lessons on the map.
(function (root) {
  'use strict';
  const worlds = [
    { id: 'w1', name: 'Trial and error', phases: [1, 11] },
    { id: 'w2', name: 'Push the policy', phases: [2, 6] },
    { id: 'w3', name: 'Smooth moves', phases: [3] },
    { id: 'w4', name: 'Learn from data', phases: [0, 4, 4.5] },
    { id: 'w5', name: 'Robot frontier', phases: [5] },
    { id: 'w6', name: 'Plans and goals', phases: [7, 8, 9, 10, 10.5] },
  ];
  // All 30 settled links, including endpoints whose lessons are not registered yet.
  const edges = [
    ['slots', 'cliff', 'many steps'],
    ['cliff', 'careful', 'falls'],
    ['cliff', 'cells', 'too many cells'],
    ['cells', 'explode', 'triad'],
    ['cliff', 'mirage', 'max bias'],
    ['slots', 'rare', 'bonus for few tries'],
    ['cliff', 'rare', 'sparse reward'],
    ['cliff', 'credit', 'learn the policy'],
    ['credit', 'bigsteps', 'big steps'],
    ['bigsteps', 'passfail', 'end reward'],
    ['credit', 'fetch', 'shape the reward'],
    ['explode', 'continuous', 'continuous actions'],
    ['mirage', 'continuous', 'the min of two'],
    ['continuous', 'explore', 'stops exploring'],
    ['explore', 'elbo', 'soft optimality'],
    ['elbo', 'messages', 'infer the plan'],
    ['continuous', 'offline', 'extrapolation'],
    ['goals', 'mixed', 'bad demos'],
    ['offline', 'mixed', 'unseen actions'],
    ['mixed', 'thaw', 'a few fresh steps'],
    ['goals', 'rewardfit', 'no reward given'],
    ['goals', 'twoways', 'two ways'],
    ['twoways', 'pick', 'no reward'],
    ['explore', 'residual', 'from scratch'],
    ['fetch', 'vpo', 'many rewards'],
    ['bigsteps', 'supermimic', 'learn the physics'],
    ['supermimic', 'replan', 'model errors add up'],
    ['goals', 'hindsight', 'missed goals'],
    ['hindsight', 'hierarchy', 'long goals'],
    ['rare', 'skills', 'reward without a task'],
  ].map(([from, to, label]) => ({ from, to, label }));

  // Called after lesson registration. Rebuilding with a returning lesson activates
  // its settled edges without changing metadata or saved progress.
  function create(registered) {
    const levels = registered.map(level => {
      const world = worlds.find(w => w.phases.includes(level.phase ?? 1)).id;
      const improves = edges.filter(e => e.to === level.id).map(({ from, label }) => ({ from, label }));
      Object.assign(level, { campaignWorld: world, improves });
      return { id: level.id, world, improves };
    });
    const ids = new Set(levels.map(l => l.id));
    const activeEdges = edges.filter(e => ids.has(e.from) && ids.has(e.to));
    const parents = id => activeEdges.filter(e => e.to === id).map(e => e.from);
    const missing = (id, done) => parents(id).filter(parent => !done.includes(parent));
    const next = done => {
      const open = levels.filter(l => !done.includes(l.id) && missing(l.id, done).length === 0);
      return (open.find(l => l.id !== 'goals') || open[0])?.id ?? null;
    };
    // Unknown ids are retained by saves but have no displayed graph state.
    function status(id, done) {
      if (!ids.has(id)) return null;
      if (done.includes(id)) return 'cleared';
      if (missing(id, done).length) return 'locked';
      return next(done) === id ? 'next' : 'open';
    }
    return { worlds, edges, levels, activeEdges, parents, missing, next, status };
  }

  const api = { worlds, edges, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.CONTENT) root.CONTENT.graph = create(root.CONTENT.levels);
})(typeof window === 'object' ? window : globalThis);
