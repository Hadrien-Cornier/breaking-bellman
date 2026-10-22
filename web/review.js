// Review transitions and hint gating.
// The page calls these functions. Tests call them without a browser.
// A lesson's context (task, before, failure, aim) and its inspect line must not
// contain the published sentence chips. The detailed solution is a separate hint.
(function (root) {
  function knobsKey(knobs) {
    const src = knobs || {};
    const keys = Object.keys(src).sort();
    const out = {};
    for (const k of keys) out[k] = src[k];
    return JSON.stringify(out);
  }

  // current: { id, world, knobs, running } for the lab already showing a review exercise.
  // next:    { id, world, knobs } for the exercise being shown.
  // resetTransient is true when the selected exercise changed, including a same-world change.
  // Pin and saved progress are never part of this reset.
  function plan(current, next) {
    const cur = current || {};
    const nxt = next || {};
    const same = cur.id === nxt.id && cur.world === nxt.world && knobsKey(cur.knobs) === knobsKey(nxt.knobs);
    return {
      resetTransient: !same,
      cancelRun: !same,
      world: nxt.world,
      knobs: nxt.knobs || {},
      preservePin: true,
      preserveProgress: true,
    };
  }

  // record.n is how many times this exercise was checked. The solution is not shown on entry.
  function hintGate(record, hintOpen) {
    const attempted = !!(record && record.n > 0);
    return { attempted, showSolution: attempted && !!hintOpen };
  }

  // DOM order the review pane follows. Solution never precedes the rebuild.
  function sections(attempted, hintOpen) {
    const out = ['context', 'rebuild'];
    if (attempted) out.push('inspect');
    if (attempted && hintOpen) out.push('solution');
    else if (attempted) out.push('hint');
    return out;
  }

  function lessonText(lesson, fields) {
    const src = lesson || {};
    return (fields || ['task', 'before', 'failure', 'aim', 'inspect']).map((k) => src[k] || '').join('\n');
  }

  // Chips shorter than 8 characters ("0", "no", "1") match ordinary prose.
  function solutionChips(words, recipe) {
    const chips = [];
    const keys = recipe && recipe.keys || {};
    for (const k of Object.keys(keys)) {
      const spec = words && words[k];
      if (!spec || !spec.options) continue;
      const want = Array.isArray(keys[k]) ? keys[k] : [keys[k]];
      for (const v of want) {
        const o = spec.options.find((x) => x[0] === v || String(x[0]) === String(v));
        if (o && String(o[1]).length >= 8) chips.push(String(o[1]));
      }
    }
    return chips;
  }

  function leakedChips(text, chips) {
    const body = String(text || '');
    return (chips || []).filter((chip) => body.indexOf(chip) !== -1);
  }

  const API = { plan, hintGate, sections, lessonText, solutionChips, leakedChips, knobsKey };
  root.REVIEW = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
