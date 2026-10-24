// The setup stays available without occupying the experiment after it has been read.
(function () {
  'use strict';
  const seen = new Set();
  function mount(h, level) {
    const open = () => {
      if (document.querySelector('dialog.lesson-help[open]')) return;
      const restore = button;
      const close = () => {
        dialog.close(); dialog.remove();
        const drawer = restore?.closest('details');
        if (drawer && !drawer.open) drawer.open = true;
        if (restore?.isConnected) restore.focus({ preventScroll: true });
      };
      const dialog = h('dialog.lesson-help', { 'aria-labelledby': 'lesson-help-title' }, [
        h('h2', { id: 'lesson-help-title', text: level.title }),
        h('p', { html: level.intro }),
        level.introMore ? h('details', null, [h('summary', { text: 'Rules, numbers and sources' }), h('div', { html: level.introMore })]) : null,
        h('button.btn', { type: 'button', onclick: close }, 'Back to the experiment'),
      ]);
      dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
      document.body.append(dialog); dialog.showModal();
    };
    const button = h('button.btn.ghost', { type: 'button', 'data-lesson-help': level.id, onclick: open }, 'About this experiment');
    if (!seen.has(level.id)) {
      seen.add(level.id);
      requestAnimationFrame(() => {
        if (button.isConnected && !document.querySelector('dialog[open]')) open();
      });
    }
    return button;
  }
  window.BBLESSON_HELP = { mount };
})();
