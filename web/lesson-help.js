// The setup stays available without occupying the experiment after it has been read.
(function () {
  'use strict';
  const seen = new Set();
  function mount(h, level) {
    const open = () => {
      if (document.querySelector('dialog.lesson-help[open]')) return;
      const restore = button;
      let dialog = null;
      const onKey = (event) => {
        if (event.key !== 'Escape' || !dialog || !dialog.open) return;
        event.preventDefault();
        close();
      };
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        if (dialog) { dialog.close(); dialog.remove(); }
        document.dispatchEvent(new CustomEvent('bb-help-closed'));
        const drawer = restore?.closest('details');
        if (!document.querySelector('#prediction-pop') && restore?.isConnected && (!drawer || drawer.open)) restore.focus({ preventScroll: true });
      };
      dialog = h('dialog.lesson-help', { 'aria-labelledby': 'lesson-help-title' }, [
        h('div.help-head', null, [
          h('h2', { id: 'lesson-help-title', text: level.title }),
          h('button.btn.ghost', { type: 'button', onclick: close }, 'Back to the experiment'),
        ]),
        h('p', { html: level.intro }),
        level.introMore ? h('details', null, [h('summary', { text: 'Rules, numbers and sources' }), h('div', { html: level.introMore })]) : null,
      ]);
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
      document.addEventListener('keydown', onKey);
      document.body.append(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.show();
      dialog.querySelector('button').focus();
    };
    const button = h('button.btn.ghost', { type: 'button', 'data-lesson-help': level.id, onclick: open }, 'About this experiment');
    if (!seen.has(level.id)) {
      seen.add(level.id);
      requestAnimationFrame(() => {
        const live = document.querySelector('[data-lesson-help="' + level.id + '"]');
        if (live && !document.querySelector('dialog[open]')) live.click();
      });
    }
    return button;
  }
  window.BBLESSON_HELP = { mount };
})();
