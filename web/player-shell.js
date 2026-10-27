// Shared campaign shell for every layout variant.
// Owns entry, stage bitmap sizing, concealed run defaults, empty-curve copy, and the prediction popup.
// Layout variants place #stage, #run-btn, #rule, and #charts. They do not reimplement this behavior.
(function () {
  'use strict';

  function mapOnEntry(mode) { return mode === 'campaign'; }

  function aspectRatio(cssValue, attrW, attrH) {
    const fallback = attrW > 0 && attrH > 0 ? attrW / attrH : 16 / 7;
    if (!cssValue || cssValue === 'auto' || cssValue === 'none') return fallback;
    const parts = String(cssValue).trim().split(/\s*\/\s*|\s+/);
    const a = Number(parts[0]), b = Number(parts[1] || 1);
    if (!(a > 0) || !(b > 0)) return fallback;
    return a / b;
  }

  // Return the CSS pixel box to draw into, or null to keep the canvas bitmap unchanged.
  // A hidden stage used to fall through to 200 by 180. That 10/9 bitmap is then stretched
  // by the 16/7 (or 4/3) CSS box, and a window resize was the only later correction.
  function stageBitmap(w, h, ratio, unavailable) {
    if (!(ratio > 0)) return null;
    if (unavailable || !(w > 1) || !(h > 1)) return null;
    return { w, h };
  }

  function emptyCurves(world, family) {
    const performance = world === 'bandit'
      ? { title: 'Best machine chosen', status: 'No pulls recorded yet. After Run, this curve is the share of recent pulls on the best machine, averaged across seeds.' }
      : world === 'mirage'
        ? { title: 'Left door from A', status: 'No episodes recorded yet. After Run, this curve is the share of episodes that take the left door.' }
        : { title: 'Score per test episode', status: 'No tests recorded yet. After Run, this curve is the score. It is not a training loss.' };
    const recordsLoss = family === 'value' || family === 'pg' || family === 'ac';
    const loss = recordsLoss
      ? { title: 'Training loss', status: 'No updates recorded yet. After Run, this curve is the squared update error. It is not the score.' }
      : { title: 'Training loss', status: 'This sentence does not record a separate training loss. The score curve is the learning measure.' };
    return [performance, loss];
  }

  const claimed = new Set();
  function claimPrediction(id) {
    if (!id || claimed.has(id)) return false;
    claimed.add(id);
    return true;
  }

  let dlg = null, opener = null;

  function parkPrediction(node) {
    if (!node) return;
    const doc = node.ownerDocument;
    let park = doc.getElementById('prediction-park');
    if (!park) {
      park = doc.createElement('div');
      park.id = 'prediction-park';
      park.hidden = true;
      doc.body.append(park);
    }
    park.append(node);
  }

  function closePrediction(restore, reason) {
    const current = dlg;
    if (!current) return;
    dlg = null;
    const back = opener;
    opener = null;
    parkPrediction(current.querySelector('.predict-live'));
    if (current.open) current.close();
    current.remove();
    if (reason === 'dismiss') {
      const root = typeof document !== 'undefined' ? document : current.ownerDocument;
      root.dispatchEvent(new CustomEvent('bb-prediction-closed'));
    }
    if (restore && back && back.isConnected) back.focus();
  }

  function focusable(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
  }

  function openPrediction({ title, node, anchor, returnLabel }) {
    closePrediction(false);
    const doc = anchor && anchor.ownerDocument;
    if (!doc || !anchor || !node) return null;
    opener = doc.activeElement;
    dlg = doc.createElement('dialog');
    dlg.className = 'prediction-pop';
    dlg.id = 'prediction-pop';
    dlg.setAttribute('aria-labelledby', 'prediction-title');
    const head = doc.createElement('div');
    head.className = 'prediction-head';
    const h = doc.createElement('h3');
    h.id = 'prediction-title';
    h.tabIndex = -1;
    h.textContent = title || 'Predict before you run';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'btn ghost';
    back.textContent = returnLabel || 'Back to the experiment';
    back.addEventListener('click', () => {
      const launch = doc.querySelector('[data-prediction]');
      closePrediction(false, 'dismiss');
      if (launch && launch.isConnected) launch.focus();
      else if (opener && opener.isConnected) opener.focus();
    });
    head.append(h, back);
    const body = doc.createElement('div');
    body.className = 'prediction-body';
    body.append(node);
    dlg.append(head, body);
    dlg.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        back.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(dlg);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('cancel', (event) => { event.preventDefault(); back.click(); });
    anchor.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.show();
    h.focus();
    return dlg;
  }

  // A saved or already used choice does not authorize another simulation.
  // Playback never calls this: Watch, Step, and Replay are not fresh runs.
  function blocksFreshRun(questionId, grant, signature) {
    if (!questionId) return false;
    if (!grant || grant.used || grant.id !== questionId || grant.signature !== signature) return true;
    return false;
  }

  const api = { mapOnEntry, aspectRatio, stageBitmap, emptyCurves, claimPrediction, openPrediction, closePrediction, blocksFreshRun };
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BBPLAYER = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
