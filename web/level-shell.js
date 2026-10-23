// Presentation only. Measured scenes and records remain owned by their lesson adapters.
(function () {
  'use strict';
  const sections = ['rule', 'curve', 'autopsy', 'notes'];
  function notebook(root, changed = () => {}) {
    const tabs = [...root.querySelectorAll('[data-notebook-tab]')];
    const panels = [...root.querySelectorAll('[data-notebook-panel]')];
    const select = name => {
      tabs.forEach(tab => {
        const active = tab.dataset.notebookTab === name;
        tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach(panel => { panel.hidden = panel.dataset.notebookPanel !== name; });
      changed(name);
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab.dataset.notebookTab));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); select(tabs[next].dataset.notebookTab); tabs[next].focus();
      });
    });
    root.addEventListener('toggle', () => { if (root.open) changed(tabs.find(t => t.getAttribute('aria-selected') === 'true').dataset.notebookTab); });
    return {
      notebook(name) { return panels.find(panel => panel.dataset.notebookPanel === name); },
      open(name) {
        root.open = true; select(name);
        tabs.find(tab => tab.dataset.notebookTab === name)?.focus();
      },
      reset() { root.open = false; select('rule'); },
      conceptSketch(spec) { return conceptSketch(root.ownerDocument, spec); },
    };
  }
  function createNotebook(document, id) {
    const root = document.createElement('details'); root.id = id; root.className = 'notebook';
    const summary = document.createElement('summary'); summary.textContent = 'Notebook'; root.append(summary);
    const nav = document.createElement('div'); nav.className = 'notebook-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Notebook sections'); root.append(nav);
    for (const name of sections) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.id = id + '-tab-' + name;
      tab.dataset.notebookTab = name; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', id + '-' + name);
      tab.setAttribute('aria-selected', String(name === 'rule')); tab.tabIndex = name === 'rule' ? 0 : -1;
      tab.textContent = name[0].toUpperCase() + name.slice(1); nav.append(tab);
      const panel = document.createElement('section'); panel.id = id + '-' + name; panel.className = 'notebook-panel';
      panel.dataset.notebookPanel = name; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.tabIndex = 0;
      panel.hidden = name !== 'rule'; root.append(panel);
    }
    return root;
  }
  function conceptSketch(document, { label, nodes = [], edges = [] }) {
    const figure = document.createElement('figure'); figure.className = 'concept-sketch';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 120'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
    const add = (tag, attrs, text) => {
      const el = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
      if (text) el.textContent = text; svg.append(el);
    };
    for (const edge of edges) {
      const a = nodes.find(n => n.id === edge.from), b = nodes.find(n => n.id === edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!length) continue;
      const ux = dx / length, uy = dy / length, x = b.x - ux * 38, y = b.y - uy * 20;
      add('path', { d: `M ${a.x + ux * 38} ${a.y + uy * 20} L ${x} ${y} m ${-ux * 7 - uy * 4} ${-uy * 7 + ux * 4} L ${x} ${y} l ${-ux * 7 + uy * 4} ${-uy * 7 - ux * 4}` });
      if (edge.label) add('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12, 'text-anchor': 'middle' }, edge.label);
    }
    for (const node of nodes) {
      add('rect', { x: node.x - 36, y: node.y - 18, width: 72, height: 36, rx: 8 });
      add('text', { x: node.x, y: node.y + 5, 'text-anchor': 'middle' }, node.label);
    }
    const caption = document.createElement('figcaption'); caption.textContent = 'Concept sketch';
    figure.append(svg, caption); return figure;
  }
  globalThis.BB = globalThis.BB || {};
  globalThis.BB.shell = { notebook, createNotebook, conceptSketch };
})();
