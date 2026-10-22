// Page to Markdown: turns what the player sees in a part of the page into Markdown, for a paste into any AI chat.
// It walks the live DOM, so a new panel needs no code here. It writes only what is on screen (hidden text stays out),
// names collapsed sections without their content (a hint stays hidden), keeps the state of buttons (selected, your pick,
// correct), writes MathJax as its TeX source (data-tex) and writes a chart as a table of its numbers (canvas._md, set by
// lineChart in app.js).
(function () {
  'use strict';
  const BB = (globalThis.BB = globalThis.BB || {});
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'SUMMARY']);
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'FORM', 'FIELDSET', 'FIGURE',
    'UL', 'OL', 'LI', 'TABLE', 'DETAILS', 'DIALOG', 'PRE', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'CANVAS', 'TEXTAREA']);
  const HAS_BLOCKS = 'p, div, ol, ul, table, canvas, svg, h1, h2, h3, h4, h5, h6, pre, details';
  const BR = '\u2028';
  // class names and ARIA states that change what a button means for the reader
  const FLAGS = [['picked', 'your pick'], ['right', 'correct'], ['wrong', 'not correct'], ['on', 'selected'], ['idle', 'does nothing here'], ['done', 'done']];

  const cs = (el) => getComputedStyle(el);
  function shown(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.getAttribute('data-md') === 'skip') return false;
    const s = cs(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }
  const isSvg = (el) => el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() === 'svg';
  function isBlock(el) {
    if (BLOCK_TAGS.has(el.tagName) || isSvg(el) || el.hasAttribute('data-tex')) return true;
    if (el.tagName === 'BUTTON') return !!el.querySelector(HAS_BLOCKS);
    const d = cs(el).display;
    return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table' || d === 'flow-root';
  }
  const clean = (s) => s.replace(/[ \t\n\r\f\v\u00a0]+/g, ' ').replace(/ ([,;:!?)]|\.(?!\.))/g, '$1').replace(/\( /g, '(').split(BR).map((l) => l.trim()).join('  \n').trim();
  const fmtNum = (v) => (v == null || !isFinite(v) ? '' : String(Number(Number(v).toPrecision(3))));

  function flags(el) {
    const out = [];
    for (const [c, w] of FLAGS) if (el.classList.contains(c)) out.push(w);
    if (el.getAttribute('aria-pressed') === 'true' && !out.includes('selected')) out.push('selected');
    const cur = el.getAttribute('aria-current');
    if ((el.getAttribute('aria-selected') === 'true' || (cur && cur !== 'false')) && !out.includes('selected')) out.push('current');
    if (el.disabled) out.push('disabled');
    return out.length ? ' (' + out.join(', ') + ')' : '';
  }

  // inline text of an element, ignoring block structure (for headings, table cells, buttons, flex rows)
  function inline(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || SKIP.has(node.tagName) || !shown(node)) return '';
    const el = node, tag = el.tagName;
    if (el.hasAttribute('data-tex')) return ' $' + el.getAttribute('data-tex') + '$ ';
    if (isSvg(el)) return ' [Diagram: ' + (el.getAttribute('aria-label') || 'drawing') + '] ';
    if (tag === 'CANVAS') return ' [Picture: ' + (el.getAttribute('aria-label') || 'drawing') + '] ';
    if (tag === 'BR') return BR;
    if (tag === 'IMG') return ' [Image: ' + (el.getAttribute('alt') || 'picture') + '] ';
    if (tag === 'SELECT') { const o = el.selectedOptions && el.selectedOptions[0]; return ' [' + (o ? o.textContent.trim() : '') + ' ▾] '; }
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'hidden') return '';
      if (t === 'checkbox' || t === 'radio') return (el.checked ? '[x] ' : '[ ] ');
      // a key never leaves the page, even when the player shows it (type text)
      if (t === 'password' || el.getAttribute('data-md') === 'secret') return el.value ? ' [hidden text] ' : ' [empty box] ';
      return ' [' + (el.value || (el.placeholder ? 'empty: ' + el.placeholder : 'empty box')) + '] ';
    }
    const kids = Array.from(el.childNodes).map((c) => {
      const t = inline(c);
      return c.nodeType === 1 && isBlock(c) ? ' ' + t + ' ' : t;
    }).join('');
    const t = kids.replace(/\s+/g, ' ').trim();
    if (tag === 'BUTTON') return t ? ' [' + t + ']' + flags(el) + ' ' : '';
    if (!t) return kids.includes(BR) ? BR : '';
    if (tag === 'B' || tag === 'STRONG' || el.classList.contains('big')) return wrap(kids, '**');
    if (tag === 'I' || tag === 'EM') return wrap(kids, '*');
    if (tag === 'CODE' || tag === 'KBD') return '`' + t + '`';
    if (tag === 'SUB') return '_' + t;
    if (tag === 'SUP') return '^' + t;
    if (tag === 'A') { const href = el.getAttribute('href') || ''; return /^(https?:|mailto:)/.test(href) ? '[' + t + '](' + href + ')' : kids; }
    return kids;
  }
  // a code block whose fence is longer than any run of backticks inside it
  function fence(s) { const run = Math.max(2, ...(s.match(/`+/g) || []).map((m) => m.length)); const f = '`'.repeat(run + 1); return f + '\n' + s + '\n' + f; }
  // **text** with the spaces outside the markers
  function wrap(s, m) { const a = s.match(/^\s*/)[0], b = s.match(/\s*$/)[0]; return a + m + s.trim() + m + b; }

  // a flex or grid row of small parts (buttons, labels, pills) reads as one line
  function rowLike(el) {
    const s = cs(el);
    if (!(s.display === 'flex' || s.display === 'inline-flex') || s.flexDirection.startsWith('column')) return false;
    return Array.from(el.children).every((c) => !c.matches(HAS_BLOCKS) && !c.querySelector(HAS_BLOCKS));
  }

  // the Markdown blocks of the children of an element
  function blocks(el, depth) {
    const parts = []; let run = '';
    const push = (s) => { s = s && s.trim(); if (s) parts.push(s); };
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { run += c.textContent; continue; }
      if (c.nodeType !== 1 || SKIP.has(c.tagName) || !shown(c)) continue;
      if (isBlock(c)) { push(clean(run)); run = ''; push(block(c, depth)); } else run += inline(c);
    }
    push(clean(run));
    return parts.join('\n\n');
  }

  function block(el, depth) {
    const tag = el.tagName;
    if (el.hasAttribute('data-tex')) return '$$\n' + el.getAttribute('data-tex') + '\n$$';
    if (/^H[1-6]$/.test(tag)) return '#'.repeat(Math.min(6, +tag[1] + depth)) + ' ' + clean(inline(el));
    if (tag === 'UL' || tag === 'OL') return list(el, tag === 'OL', depth);
    if (tag === 'TABLE') return table(el);
    if (tag === 'HR') return '---';
    if (tag === 'PRE') return fence(el.textContent.replace(/\n$/, ''));
    if (tag === 'TEXTAREA') return el.value ? fence(el.value) : '[Empty text box' + (el.placeholder ? ': ' + el.placeholder : '') + ']';
    // text that keeps its line breaks on screen (a chat message) keeps them here, as a quote
    if (!el.children.length && /^(pre|pre-wrap|break-spaces)$/.test(cs(el).whiteSpace)) {
      const who = el.getAttribute('data-md-prefix');
      return (who ? '**' + who + ':**\n' : '') + el.textContent.replace(/\s+$/, '').split('\n').map((l) => '> ' + l).join('\n');
    }
    if (tag === 'CANVAS') return el._md ? chart(el._md) : '[Picture: ' + (el.getAttribute('aria-label') || 'drawing') + ']';
    if (isSvg(el)) return svg(el);
    if (tag === 'DETAILS') {
      const sum = el.querySelector(':scope > summary'), title = (sum && clean(Array.from(sum.childNodes).map(inline).join(''))) || 'More';
      // a closed section stays closed: the player has not read it, and it can hold a hint
      return el.open ? '**' + title + '**\n\n' + blocks(el, depth) : '**' + title + '** (collapsed, not opened)';
    }
    if (tag === 'DIALOG' && !el.open) return '';
    if (tag === 'BUTTON') {
      const sibs = el.parentNode ? Array.from(el.parentNode.children).filter((c) => c.classList.contains('opt')) : [];
      const head = el.classList.contains('opt') ? '**Choice ' + (sibs.indexOf(el) + 1) + '**' : '**Button**';
      return head + flags(el) + '\n\n' + blocks(el, depth);
    }
    if (el.classList.contains('eyebrow')) return '**' + clean(inline(el)) + '**';
    if (el.classList.contains('chart-wrap')) {
      const t = el.querySelector('.chart-title b'), cv = el.querySelector('canvas');
      const legend = Array.from(el.querySelectorAll('.legend > span')).map((s) => clean(inline(s))).filter(Boolean);
      return '**Chart: ' + (t ? clean(t.textContent) : 'untitled') + '**' + (legend.length ? ' (legend: ' + legend.join('; ') + ')' : '')
        + '\n\n' + (cv && cv._md ? chart(cv._md) : '(No data yet: the chart fills in when a run ends.)');
    }
    if (rowLike(el)) return clean(inline(el));
    return blocks(el, depth);
  }

  function list(el, ordered, depth) {
    let i = 0;
    return Array.from(el.children).filter((li) => li.tagName === 'LI' && shown(li)).map((li) => {
      const mark = ordered ? ++i + '. ' : '- ', body = blocks(li, depth) || ' ';
      return mark + body.split('\n').join('\n' + ' '.repeat(mark.length));
    }).join('\n');
  }

  function table(el) {
    const rows = Array.from(el.rows).filter(shown).map((r) => Array.from(r.cells).filter(shown).map((c) => clean(inline(c)).replace(/\|/g, '\\|') || ' '));
    if (!rows.length) return '';
    const n = Math.max(...rows.map((r) => r.length));
    for (const r of rows) while (r.length < n) r.push(' ');
    return ['| ' + rows[0].join(' | ') + ' |', '|' + ' --- |'.repeat(n)].concat(rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |')).join('\n');
  }

  function svg(el) {
    const words = [];
    for (const t of el.querySelectorAll('text')) { const s = clean(t.textContent); if (s && !words.includes(s)) words.push(s); }
    return '[Diagram: ' + (el.getAttribute('aria-label') || 'drawing') + ']' + (words.length ? ' Labels in it: ' + words.join(' · ') + '.' : '');
  }

  // a line chart as tables of numbers. Lines on one x grid share a table (a grid that starts another one, as in a run still
  // going, counts as the same); a line on another grid (a pinned run A with other steps) gets its own table, so no value
  // is ever shown at an x where it was not measured. Each table has up to 11 rows spread over x, then each line's extremes.
  function chart(md) {
    const series = md.series.filter((s) => s.xs && s.xs.length);
    if (!series.length) return '(No data yet: the chart fills in when a run ends.)';
    const o = md.o || {}, xl = o.xlabel || 'x';
    const count = {}, seen = {};
    for (const s of series) { const b = s.label || 'line'; count[b] = (count[b] || 0) + 1; }
    const names = series.map((s) => { const b = s.label || 'line'; return count[b] > 1 ? b + ' ' + (seen[b] = (seen[b] || 0) + 1) : b; });
    const starts = (a, b) => { for (let i = 0, n = Math.min(a.length, b.length); i < n; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false; return true; };
    const groups = [];
    series.forEach((s, j) => {
      const g = groups.find((x) => starts(x.xs, s.xs));
      if (g) { g.items.push(j); if (s.xs.length > g.xs.length) g.xs = s.xs; } else groups.push({ xs: s.xs, items: [j] });
    });
    const fin = (s) => Array.from(s.ys).filter((v) => v != null && isFinite(v));
    const ext = (s, f) => { const v = fin(s); return v.length ? fmtNum(f(...v)) : ' '; };
    const tables = groups.map((g) => {
      const n = g.xs.length, k = Math.min(11, n), its = g.items.map((j) => series[j]);
      const idx = Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, k - 1)));
      const rows = idx.map((i) => '| ' + fmtNum(g.xs[i]) + ' | ' + its.map((s) => (i < s.ys.length && fmtNum(s.ys[i])) || ' ').join(' | ') + ' |');
      return ['| ' + xl + ' | ' + g.items.map((j) => names[j]).join(' | ') + ' |', '|' + ' --- |'.repeat(its.length + 1)].concat(rows,
        ['| lowest | ' + its.map((s) => ext(s, Math.min)).join(' | ') + ' |', '| highest | ' + its.map((s) => ext(s, Math.max)).join(' | ') + ' |']).join('\n');
    });
    const axis = 'x axis: ' + xl + ', 0 to ' + fmtNum(o.xmax) + '. y axis: ' + (o.ymin != null ? fmtNum(o.ymin) : 'auto') + ' to ' + (o.ymax != null ? fmtNum(o.ymax) : 'auto') + (o.log ? ', log scale' : '') + '.'
      + (o.ref != null ? ' Dashed line at y = ' + fmtNum(o.ref) + '.' : '') + (o.note ? ' ' + o.note : '')
      + (groups.length > 1 ? ' The lines were measured at different x values, so each set has its own table.' : '');
    return axis + '\n\n' + tables.join('\n\n');
  }

  // Markdown of everything visible inside root; depth shifts the heading levels (depth 1: an h2 becomes ###)
  BB.pageMd = { fromNode: (root, opts) => (root ? blocks(root, (opts && opts.depth) || 0) : ''), chart };
})();
