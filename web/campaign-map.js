// D1 Path. Progress and dependencies belong to CONTENT.graph; zoom belongs to this tab.
(function () {
  'use strict';
  const ZOOM_KEY = 'breaking-bellman-map-zoom';
  const ZOOMS = ['worlds', 'levels', 'methods'];
  const WORDS = { cleared: 'Cleared', next: 'Play next', open: 'Open', locked: 'Locked (suggested order)' };
  const ICONS = { cleared: '✓', next: '▶', open: '▶', locked: '🔒' };
  // Method/failure labels from the settled D1 prototype, keyed by stable lesson id.
  const METHODS = {
    slots: ['ε-greedy', 'Optimism', 'UCB'], cliff: ['Monte Carlo', 'Q-learning', 'n-step'],
    careful: ['Sarsa', 'Expected Sarsa'], mirage: ['Double Q', 'Double DQN', 'Clipped Q'],
    cells: ['A network'], explode: ['DQN'], credit: ['REINFORCE', 'Baseline'],
    bigsteps: ['Actor-critic', 'PPO'], fetch: ['Shaping'], passfail: ['GRPO'],
    continuous: ['DDPG', 'TD3'], explore: ['SAC'], offline: ['TD3+BC', 'CQL', 'IQL'],
    mixed: ['Filtered BC', 'AWR', 'RECAP'], residual: ['Residual'],
    twoways: ['Flow policy', 'Chunks', 'π0.5'], pick: ['Best-of-N', 'Q-planning', 'EXPO', 'π0.7'],
    supermimic: ['SuperMimic'], vpo: ['Vector rewards'],
  };
  const FAILURES = { slots: 'Lock-in', cliff: 'No end', mirage: 'Max bias', explode: 'Deadly triad', credit: 'High variance', bigsteps: 'Big steps' };
  const COLORS = ['value', 'policy', 'explore', 'offline', 'robot', 'world'];

  function create({ h, C, S, choose, show, saveActions }) {
    const graph = C.graph, levels = Object.fromEntries(C.levels.map(l => [l.id, l]));
    let zoom = 'levels', observer, sheet, returnFocus;
    try { const z = sessionStorage.getItem(ZOOM_KEY); if (ZOOMS.includes(z)) zoom = z; } catch (e) { /* storage blocked */ }
    const worldOf = id => graph.worlds.find(w => w.id === levels[id].campaignWorld);
    const state = id => graph.status(id, S.done);
    const button = (text, fn, cls = 'btn ghost', attrs = {}) => h('button.' + cls.replaceAll(' ', '.'), { type: 'button', onclick: fn, ...attrs }, text);
    const chips = id => h('div.map-chips', null, (METHODS[id] || []).map(text => h('span.chip', { text })));
    // a short plain line per method name where it appears ("You will build"), so no name is bare
    const plainOf = label => { for (const id in C.cards) { const c = C.cards[id]; if (c.plain && (c.short === label || c.name === label)) return c.plain; } return null; };
    const methodLines = id => {
      const rows = (METHODS[id] || []).map(label => [label, plainOf(label)]).filter(([, plain]) => plain);
      return rows.length ? h('ul.map-methods', null, rows.map(([label, plain]) => h('li', null, [h('b', { text: label + ': ' }), plain]))) : null;
    };
    function playNext() {
      const id = graph.next(S.done);
      return button(id ? 'Play next: ' + levels[id].title : 'Every level cleared', () => { if (id) choose(id); }, 'btn', { disabled: !id, 'data-play-next': id });
    }
    function strip() {
      const lv = levels[S.level], w = worldOf(lv.id);
      return h('nav.campaign-strip', { id: 'campaign-strip', 'aria-label': 'Campaign map' }, [
        button('All ' + C.levels.length + ' levels', show),
        h('span', { text: w.name + ' · ' + lv.title }),
      ]);
    }
    function close() {
      if (!sheet) return;
      sheet.close(); sheet.remove(); sheet = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    function brief(id) {
      if (!levels[id]) return;
      if (!sheet) returnFocus = document.activeElement;
      else { sheet.close(); sheet.remove(); }
      const lv = levels[id], w = worldOf(id), st = state(id), missing = graph.missing(id, S.done);
      const content = h('div.map-brief-body', null, [
        h('p.eyebrow', { text: 'World ' + (graph.worlds.indexOf(w) + 1) + ' · ' + w.name }),
        h('p.map-state', { text: WORDS[st] }),
        h('p.map-learning-intro', { html: lv.intro + ' ' + C.learningPurpose[id] }),
        h('h3', { text: 'You will build' }), chips(id), methodLines(id),
        st === 'locked' ? h('div.map-lock', null, [
          h('b', { text: 'Not ready yet' }),
          h('p', { text: 'It builds on ' + missing.map(p => levels[p].title).join(' and ') + ', not cleared yet. Clear ' + (missing.length > 1 ? 'them' : 'it') + ' first, or open this level anyway: locks only suggest an order.' }),
        ]) : null,
        h('div.map-actions', null, [
          ...missing.map(parent => button('Go to ' + levels[parent].title, () => brief(parent))),
          button(st === 'locked' ? 'Open anyway' : st === 'cleared' ? 'Replay' : 'Play', () => { close(); choose(id); }, 'btn', { 'data-open-level': id }),
        ]),
      ]);
      sheet = h('dialog.map-brief', { 'aria-labelledby': 'map-brief-title', 'data-brief-level': id }, [
        h('div.map-brief-head', null, [h('h2', { id: 'map-brief-title', text: lv.title }), button('Close', close, 'btn ghost', { 'aria-label': 'Close briefing' })]), content,
      ]);
      sheet.addEventListener('cancel', e => { e.preventDefault(); close(); });
      sheet.addEventListener('click', e => { if (e.target === sheet) { const r = sheet.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
      document.body.append(sheet); sheet.showModal();
    }
    function mount(pane) {
      if (observer) observer.disconnect();
      const map = h('section.campaign-map', { id: 'campaign-map', 'aria-label': 'Campaign map' });
      const controls = h('div.map-zoom', { role: 'group', 'aria-label': 'Map zoom' });
      const path = h('div.map-path');
      const dock = h('div.map-playdock', null, playNext());
      function setZoom(z, world) {
        zoom = z;
        try { sessionStorage.setItem(ZOOM_KEY, z); } catch (e) { /* storage blocked */ }
        draw();
        if (world) {
          const heading = path.querySelector('#map-' + world + ' h2');
          heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start' });
        }
      }
      for (const z of ZOOMS) controls.append(button(z[0].toUpperCase() + z.slice(1), () => setZoom(z), 'btn ghost', { 'data-zoom': z }));
      map.append(h('div.map-heading', null, [h('h1', { tabindex: '-1', text: 'Campaign map' }),
        h('p', { text: C.levels.filter(l => S.done.includes(l.id)).length + ' of ' + C.levels.length + ' levels cleared' }), controls,
        h('p.small', { text: 'Start with Ten slot machines. Follow the paths or choose any level. Locks only suggest an order.' }),
      ]), path, dock, saveActions());
      pane.append(map);
      const rows = {};
      function row(id) {
        if (rows[id] != null) return rows[id];
        const parents = graph.parents(id).filter(p => levels[p].campaignWorld === levels[id].campaignWorld);
        return rows[id] = parents.length ? 1 + Math.max(...parents.map(row)) : 0;
      }
      function draw() {
        map.dataset.zoom = zoom;
        for (const b of controls.children) b.setAttribute('aria-pressed', String(b.dataset.zoom === zoom));
        path.replaceChildren();
        graph.worlds.forEach((w, i) => {
          const lv = C.levels.filter(l => l.campaignWorld === w.id);
          const cleared = lv.filter(l => S.done.includes(l.id)).length;
          const band = h('section.map-world', { id: 'map-' + w.id, style: '--world-color: var(--f-' + COLORS[i] + ')' });
          if (zoom === 'worlds') {
            band.append(button('', () => setZoom('levels', w.id), 'map-medal', { 'aria-label': 'World ' + (i + 1) + ', ' + w.name + ': ' + cleared + ' of ' + lv.length + ' cleared. Zoom in.' }));
            band.firstChild.append(h('span.map-disc', { text: i + 1, style: '--progress: ' + (lv.length ? cleared / lv.length * 100 : 0) + '%' }),
              h('span', null, [h('b', { text: w.name }), h('small', { text: cleared + ' of ' + lv.length + ' cleared' })]));
          } else {
            band.append(h('div.map-world-title', null, [h('p.eyebrow', { text: 'World ' + (i + 1) }), h('h2', { tabindex: '-1', text: w.name })]));
            const rowNumbers = [...new Set(lv.map(l => row(l.id)))].sort((a, b) => a - b);
            for (const n of rowNumbers) band.append(h('div.map-row', null, lv.filter(l => row(l.id) === n).map(l => {
              const st = state(l.id);
              const coin = button('', () => brief(l.id), 'map-coin', { 'aria-label': l.title + ': ' + WORDS[st], 'data-map-level': l.id });
              coin.append(h('span', { 'aria-hidden': 'true', text: ICONS[st] }));
              const node = h('div.map-node.' + st, { 'data-node': l.id }, [coin, h('b', { text: l.title }), h('small', { text: WORDS[st] })]);
              if (zoom === 'methods') {
                node.append(chips(l.id));
                if (FAILURES[l.id]) node.append(h('span.chip.map-failure', { text: 'Failure: ' + FAILURES[l.id] }));
                for (const e of graph.activeEdges.filter(e => e.to === l.id)) node.append(h('small.map-edge-label', { text: levels[e.from].title + ': ' + e.label }));
              }
              if (st === 'next') {
                const pin = h('canvas.map-rover', { width: '120', height: '120', 'aria-hidden': 'true' });
                const ctx = pin.getContext('2d'); ctx.scale(2, 2); BB.scenes.robot(ctx, 30, 55, 47, { noShadow: true }); node.append(pin);
              }
              return node;
            })));
          }
          path.append(band);
        });
        requestAnimationFrame(drawEdges);
      }
      function drawEdges() {
        if (!map.isConnected) { observer?.disconnect(); return; }
        path.querySelector('.map-edges')?.remove();
        if (zoom === 'worlds') return;
        const base = path.getBoundingClientRect(), ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg'); svg.classList.add('map-edges'); svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
        const point = id => { const coin = path.querySelector('[data-map-level="' + id + '"]'), r = coin.getBoundingClientRect(), node = coin.parentElement.getBoundingClientRect(); return { x: r.x + r.width / 2 - base.x, top: r.top - base.y, bottom: node.bottom - base.y + 8 }; };
        for (const e of graph.activeEdges) {
          const a = point(e.from), b = point(e.to), cross = worldOf(e.from) !== worldOf(e.to);
          const line = document.createElementNS(ns, 'path'), y = (a.bottom + b.top) / 2;
          line.setAttribute('d', cross ? `M${b.x - 28} ${b.top - 35} Q${b.x - 28} ${b.top - 12} ${b.x} ${b.top}` : `M${a.x} ${a.bottom} C${a.x} ${y} ${b.x} ${y} ${b.x} ${b.top}`);
          line.setAttribute('class', S.done.includes(e.from) ? 'ready' : 'locked');
          line.dataset.from = e.from; line.dataset.to = e.to; svg.append(line);
          if (cross) {
            const label = document.createElementNS(ns, 'text'); label.setAttribute('x', b.x - 28); label.setAttribute('y', b.top - 40); label.setAttribute('text-anchor', 'middle');
            label.textContent = 'W' + (graph.worlds.indexOf(worldOf(e.from)) + 1); svg.append(label);
          }
        }
        path.prepend(svg);
      }
      observer = new ResizeObserver(drawEdges); observer.observe(path);
      draw();
    }
    return { mount, strip, brief };
  }
  window.BBCAMPAIGN = { create };
})();
