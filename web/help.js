// Shared metric help for Breaking Bellman. One registry of what each RL number means, one
// accessible popover that opens from the number, and one phrase-scoped enhancer that attaches the
// popover to a metric wherever its number is printed. Pure numeric scale anchors live here too, so
// tests can check them without a browser. This module never touches RLA: every call site passes its
// own world and action context in (see the world factory spec for nActions / actDim / continuous).
//
// Copy rules: one or two plain sentences per metric, no em dashes, a reference point and a good vs
// bad read for the level. Anchors use the actual displayed value (for example KL 1.50), never a
// reconstruction of the policy behind the number.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- numeric scale anchors (pure)
  // KL between a 50/50 two-action choice (old) and a new choice that puts q on the first action:
  //   KL(old || new) = 0.5 * ln(0.25 / (q * (1 - q)))
  // Inverting for q gives the "how big is this step" feel. The game measures old -> new (it averages
  // log p_old - log p_new over the actions the old policy tried), so old is the 50/50 side and q is
  // the new share. This is a feel for the size, not a rebuild of the real policy.
  function klMove(k) {
    if (!isFinite(k) || k <= 0) return 0.5;
    var d = 1 - Math.exp(-2 * k);
    if (!(d > 0)) return 0.5;
    return (1 + Math.sqrt(d)) / 2;
  }
  // "57/43" style split of a 50/50 choice after a KL step of size k. Whole percents for ordinary
  // steps, more decimals once the small side drops under half a percent (so 6.2 reads 99.9999/0.0001).
  function klRatioText(k) {
    var q = klMove(k), bot = 1 - q;
    if (bot >= 0.005) {
      var t = Math.round(q * 100);
      return t + '/' + (100 - t);
    }
    var dec = Math.max(0, Math.ceil(-Math.log10(bot * 100)));
    return (q * 100).toFixed(dec) + '/' + (bot * 100).toFixed(dec);
  }
  // Discrete entropy: the most a policy over A actions can spread is ln(A) nats (even spread).
  function entropyMax(A) {
    A = Math.max(2, Math.floor(A || 2));
    return Math.log(A);
  }
  // Top-action share for a discrete entropy H over A actions, in the "one action dominates and the
  // rest are even" reading. H = ln(A) -> 1/A (even); H = 0 -> 1 (all one action). Solved by bisection.
  function entropyTopShare(H, A) {
    A = Math.max(2, Math.floor(A || 2));
    if (!isFinite(H)) return 1 / A;
    var maxH = Math.log(A);
    // a value that rounds to the max (ln A) is an even spread; snap so "0.693" reads 50/50, not 51/49
    if (H >= maxH - 0.0005) return 1 / A;
    if (H <= 0) return 1;
    // H_of(p) is the entropy when the top action has probability p and the rest share (1-p) evenly.
    function H_of(p) {
      if (p <= 0) return maxH;
      if (p >= 1) return 0;
      var q = (1 - p) / (A - 1), t = -p * Math.log(p);
      if (q > 0) t -= (1 - p) * Math.log(q);
      return t;
    }
    var lo = 1 / A, hi = 1;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (H_of(mid) > H) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // A one-dimensional Gaussian with standard deviation s has differential entropy ln(s) + 1.4189385332
  // nats (the constant is 0.5 * ln(2 * pi * e)). Inverting: s = exp(H - 1.4189). The game sums this
  // over the action dimensions, so for D equal dimensions s = exp(H / D - 1.4189).
  function gaussStdFromEntropy(H, dims) {
    dims = Math.max(1, Math.floor(dims || 1));
    if (!isFinite(H)) return NaN;
    return Math.exp(H / dims - 1.4189385332);
  }
  // Differential entropy of a Gaussian with the given standard deviation, per dimension.
  function gaussEntropyFromStd(s, dims) {
    dims = Math.max(1, Math.floor(dims || 1));
    if (!(s > 0) || !isFinite(s)) return NaN;
    return dims * (Math.log(s) + 1.4189385332);
  }

  function pct(x) {
    if (!isFinite(x)) return String(x);
    var p = x * 100, r = Math.round(p);
    // keep a decimal when rounding would falsely read 0 or 100 (for example a 99.5% top-action share)
    if ((r === 100 && p < 100) || (r === 0 && p > 0)) return p.toFixed(1) + '%';
    return (Math.abs(p) >= 10 || p === 0 ? r : p.toFixed(1)) + '%';
  }
  function num(x) {
    if (!isFinite(x)) return String(x);
    if (x !== 0 && (Math.abs(x) >= 10000 || Math.abs(x) < 0.001)) return x.toExponential(1);
    return String(Math.round(x * 1000) / 1000);
  }
  // How a value is printed in an anchor line: prefer the exact text the page displayed (so KL 1.50
  // stays 1.50 and not 1.5), else the plain rounded number.
  function shown(value, ctx) {
    return ctx && ctx.displayValue != null ? String(ctx.displayValue) : num(value);
  }

  // ---------------------------------------------------------------- the shared metrics registry
  // Each metric: label (the popover title), what (what it measures + unit/range + why RL uses it),
  // goodBad(value, ctx) (a good vs bad read for the level), anchor(value, ctx) (the value-specific
  // scale feel). Keep what/goodBad to a sentence or two in plain words.
  // ctx: { actions, dims, continuous, world, family, label } and optional per-metric extras.
  var METRICS = {
    kl: {
      label: 'KL divergence per update',
      what: 'How far the policy moved in one update: the average gap between the log chance it gave each action before and after. It is in nats (natural-log units), it has no top value, and 0 means the policy did not change. RL watches it because a step that is too large can wreck a policy that was already working, and PPO clips updates to keep it small.',
      goodBad: function () {
        return 'In this level a step near 0.01 to 0.02 is a careful update, while a step above about 0.05 is a big move and one above 0.2 usually smashes what it had. There is no single right value: small steady steps are usually safer than one huge one.';
      },
      anchor: function (k, ctx) {
        if (!isFinite(k)) return null;
        if (k <= 0) return 'KL ' + shown(k, ctx) + ': no measured move at all, the policy gave the same odds before and after.';
        return 'KL ' + shown(k, ctx) + ' is like a 50/50 choice becoming ' + klRatioText(k) + ' in one update (PPO-sized steps are often about 0.01).';
      },
      patterns: [
        /mean kl (?:between the policy before and after an update:?\s*)?(-?\d+(?:\.\d+)?)/i,
        /kl divergence\)?:?\s*:?(?:<\/?b>)?\s*(-?\d+(?:\.\d+)?)/i,
      ],
    },

    entropy: {
      label: 'Policy entropy (randomness)',
      what: function (ctx) {
        if (ctx && ctx.continuous) {
          return 'How spread out the policy\'s continuous action bell is, in nats. For a bell curve this is a differential entropy: it has no fixed top and can go below zero, and a bigger value means a wider spread of moves. RL tracks it to see the policy is still trying varied moves instead of repeating one.';
        }
        var A = ctx && ctx.actions ? ctx.actions : 2;
        return 'How random the policy\'s choice over ' + A + ' actions is, in nats. It runs from 0 (always one action) up to ln ' + A + ' = ' + num(entropyMax(A)) + ' (all actions equally likely). RL tracks it to see the policy is still exploring instead of settling on one move.';
      },
      goodBad: function (ctx) {
        if (ctx && ctx.continuous) {
          return 'In this level a very low value means the move is almost fixed and exploration has stopped; a value that keeps the bell reasonably wide keeps trying new moves. The useful range depends on the task, so there is no single good number.';
        }
        return 'In this level a value near 0 means it almost always picks the same action and has stopped exploring, while a value near the top means it is still trying everything. The best value sits in between: enough randomness to keep discovering, not so much that it never commits.';
      },
      anchor: function (H, ctx) {
        if (!isFinite(H)) return null;
        if (ctx && ctx.continuous) {
          var s = gaussStdFromEntropy(H, ctx.dims || 1);
          return 'Entropy ' + shown(H, ctx) + ' nats is like a bell curve with a standard deviation of about ' + num(s) + ' on each action (differential entropy has no fixed top).';
        }
        var A = ctx && ctx.actions ? ctx.actions : 2;
        return 'Entropy ' + shown(H, ctx) + ' nats is like one action picked about ' + pct(entropyTopShare(H, A)) + ' of the time (the most this can reach for ' + A + ' actions is ' + num(entropyMax(A)) + ', an even split).';
      },
      patterns: [
        /mean entropy\s*(-?\d+(?:\.\d+)?)\s*nats/i,
        /entropy[^.\d]{0,20}(-?\d+(?:\.\d+)?)\s*nats/i,
      ],
    },

    std: {
      label: 'Policy standard deviation',
      what: 'How wide the bell curve over the action is, in the same units as the action. A bigger standard deviation means noisier, more varied moves; 0 means the move is fixed. For a bell-curve policy RL watches it because a spread that collapses to 0 ends exploration.',
      goodBad: function () {
        return 'In this level a value near 0 means every try is almost the same move and the policy has stopped exploring; a healthy value keeps some spread so it still discovers. The right spread depends on the task, so there is no single good number.';
      },
      anchor: function (s, ctx) {
        if (!isFinite(s)) return null;
        return 'Standard deviation ' + shown(s, ctx) + ': its moves vary by about that much around the mean action.';
      },
      patterns: [/mean standard deviation of the policy:?\s*(-?\d+(?:\.\d+)?)/i],
    },

    qvalue: {
      label: 'Value estimate (Q or V)',
      what: 'What the learner expects to earn from here, counted in reward with future steps worth a little less each step. It is in the same units as the reward and its range follows the task. RL uses it to rank actions and to give each action its weight.',
      goodBad: function (ctx) {
        return 'There is no universal good value: it should match what a run from here really earns. When it reads far above what any run can earn (see the gap against the test run) the values have blown up or are over-optimistic.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Value ' + shown(v, ctx) + ': the learner expects about that much reward from here, with later steps counting a little less.';
      },
      patterns: [
        /q\(a, left\)\s*=\s*(-?\d+(?:\.\d+)?)/i,
        /q\(s,\s*[\w'′ ]+\)\s*=\s*(-?\d+(?:\.\d+)?)/i,
        /largest \|q\|\s*(-?[\d.e+]+)/i,
        /q says\s*(-?\d+(?:\.\d+)?)/i,
        /y − q\s*=\s*(-?\d+(?:\.\d+)?)/i,
        /v\(s\)\s*=\s*(-?\d+(?:\.\d+)?)/i,
        /advantage of the row's action a\s*=\s*(-?\d+(?:\.\d+)?)/i,
        /before → after one step:\s*(-?\d+(?:\.\d+)?)/i,
        /rates the row's action at\s*(-?\d+(?:\.\d+)?)/i,
      ],
    },

    score: {
      label: 'Return / score',
      what: 'What a run actually earned: the total reward, or the test score over a fixed number of steps. It is in the units of the reward and its range follows the task. RL uses it to judge whether the policy is any good.',
      goodBad: function () {
        return 'There is no universal good value: compare it to the best this task allows and to the same run across seeds. Higher is better except where the level says a lower number is better.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Score ' + shown(v, ctx) + ': a run earned about that much reward.';
      },
      patterns: [
        /final (?:greedy |test )?score\s*(-?\d+(?:\.\d+)?)/i,
        /test score\s*(-?\d+(?:\.\d+)?)/i,
        /score\s*(-?\d+(?:\.\d+)?)\s*(?:of|,|\()/i,
      ],
    },

    advantage: {
      label: 'Action weight (advantage)',
      what: 'How much better or worse one action was than the learner expected, in reward units. Positive weights push the action to be more likely, negative weights push it down. It is the core signal of a policy-gradient update.',
      goodBad: function () {
        return 'There is no single good value: the sign matters most, because it decides which way the policy moves. If every weight is 0 the update teaches nothing.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Weight ' + shown(v, ctx) + ': this action was about that much better than expected (' + (v >= 0 ? 'pushed more likely' : 'pushed less likely') + ').';
      },
      patterns: [/weight a[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i, /advantage[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i],
    },

    clipfrac: {
      label: 'Share of steps clipped',
      what: 'The share of actions that PPO refused to push further because they had already moved its allowed amount this update. It is a fraction from 0 to 1. RL watches it to see how often the trust-region clip is doing work.',
      goodBad: function () {
        return 'In this level a very high share means the clip is blocking most of the update, while a low share means updates move freely. Neither is universally good, but a share that stays near 1 means the steps are being held back a lot.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Clip fraction ' + shown(v, ctx) + ': about ' + pct(v) + ' of the actions were already at their limit this update.';
      },
      patterns: [/share of steps clipped:?\s*(-?\d+(?:\.\d+)?)/i, /clip(?:ped| fraction)?[^-\d]{0,12}(-?\d+(?:\.\d+)?)/i],
    },

    regret: {
      label: 'Total regret',
      what: 'How much reward was lost by not always picking the best machine, summed over all pulls, in reward units. Lower is better; 0 means it always picked the best. RL uses it to measure how well a bandit learner balances trying against sticking.',
      goodBad: function () {
        return 'Lower is better: a small total regret means it found the best machine quickly and stayed. There is no fixed good number, so compare it to the number of pulls and to other runs.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Regret ' + shown(v, ctx) + ': that much reward was lost to picking worse machines.';
      },
      patterns: [/total regret[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i, /regret[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i],
    },

    successrate: {
      label: 'Success rate',
      what: 'The share of test runs that solved the task, as a percentage from 0 to 100. RL uses it to judge how reliably the finished policy works on new starts.',
      goodBad: function () {
        return 'Higher is better: near 100% means it solves the task almost every time, near 0 means it rarely does. The pass mark for this level is set by the level test.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Success rate ' + shown(v, ctx) + ': it solved about ' + pct(v / 100) + ' of the test runs.';
      },
      patterns: [
        /(\d+(?:\.\d+)?)% of (?:tests|new prompts|late pulls|the last [\d]+ pulls|episodes)/i,
        /(\d+(?:\.\d+)?)% of [\d]+ test (?:starts|throws)/i,
        /(\d+(?:\.\d+)?)% of [\d]+ new prompts/i,
        /in\s*(\d+(?:\.\d+)?)% of/i,
      ],
    },

    crashrate: {
      label: 'Obstacle hits per test',
      what: 'How many times the robot drove into the obstacle in each test run, on average. It is a count per test, so it has no fixed top. Lower is better; RL uses it to see how safely the policy drives.',
      goodBad: function () {
        return 'Lower is better: 0 means it never hits the obstacle, and a value at or above 1 means it usually crashes. Compare it to the success rate for the full picture.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Obstacle hits ' + shown(v, ctx) + ': about that many crashes per test run.';
      },
      patterns: [/(\d+(?:\.\d+)?) obstacle hits per test/i],
    },

    falls: {
      label: 'Falls per episode',
      what: 'How many times the robot fell off the cliff in each episode while learning, on average. It is a count per episode. RL uses it to see how risky the policy is during training.',
      goodBad: function () {
        return 'Lower is better: 0 means it crossed safely every time, while a value above about 0.3 means it keeps falling while it learns. A cautious route may score a little less but fall far less.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Falls ' + shown(v, ctx) + ': about that many drops off the cliff per episode.';
      },
      patterns: [/(\d+(?:\.\d+)?) falls per episode/i],
    },

    emptygroups: {
      label: 'Groups that teach nothing',
      what: 'The share of attempt groups where every run scored the same, so every advantage came out 0 and the update taught nothing. It is a fraction from 0 to 1. RL uses it to spot a baseline that cannot tell good tries from bad.',
      goodBad: function () {
        return 'Lower is better: a share near 0 means the groups can still rank tries, while a share above about 0.3 means many updates are wasted. A high share often calls for a different baseline.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Empty groups ' + shown(v, ctx) + ': about ' + pct(v) + ' of the updates taught nothing.';
      },
      patterns: [/(\d+(?:\.\d+)?)% of the groups had the same score/i],
    },

    overestimate: {
      label: 'Prediction gap (overestimate)',
      what: 'How much higher the learner\'s predicted value at the start was than what the test run then earned, in reward units. A positive gap means it over-promised. RL uses it to catch a critic or Q table that is too optimistic.',
      goodBad: function () {
        return 'Closer to 0 is better: a large positive gap means the values are inflated and the policy chases reward that is not there. A gap near 0 means the predictions match reality.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Gap ' + shown(v, ctx) + ': it predicted about that much more reward than it earned.';
      },
      patterns: [/gap\s*(-?\d+(?:\.\d+)?)/i],
    },

    seedspread: {
      label: 'Spread across seeds',
      what: 'How much the final score varied across random seeds, in reward units (one standard deviation). It shows how much luck in the starting conditions changes the result. RL uses it to tell a reliable method from one that only works sometimes.',
      goodBad: function () {
        return 'Lower is better: a small spread means every seed lands near the same score, while a large spread means the method is unreliable. Judge it next to the mean score.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Spread ' + shown(v, ctx) + ': seeds landed about that far from the average score.';
      },
      patterns: [/plus or minus\s*(-?\d+(?:\.\d+)?)/i, /spread \(standard deviation\)\s*(-?\d+(?:\.\d+)?)/i],
    },

    distance: {
      label: 'Distance to target',
      what: 'How far the arm ended from the target, in meters at the end of a test run. Lower is better; 0 is exactly on target. RL uses it to score how precisely the arm reaches.',
      goodBad: function () {
        return 'Lower is better: under about 0.03 m counts as reaching and holding, while above about 0.1 m means it misses. Compare it to the classical controller alone on the same starts.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Distance ' + shown(v, ctx) + ' m: the arm ended about that far from the target.';
      },
      patterns: [/distance to the target[^.\d]{0,20}(-?\d+(?:\.\d+)?)\s*m/i, /final distance\s*(-?\d+(?:\.\d+)?)\s*m/i],
    },

    ratio: {
      label: 'Probability ratio (new / old)',
      what: 'How many times more likely an action is after the update than before, so 1 means no change. RL (PPO) clips this ratio to stop any one action from moving too far in a single update.',
      goodBad: function () {
        return 'Values near 1 mean the update nudged the action gently; values far above or below 1 mean it moved a lot. PPO keeps most ratios inside about 0.8 to 1.2 by clipping.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Ratio ' + shown(v, ctx) + ': this action is about ' + num(v) + ' times as likely as before.';
      },
      patterns: [/ratio = new \/ old[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i],
    },

    // The result metric of a result table (the grid): the cell value is the level's own measure,
    // named by its column header, so the header trigger explains the measure and its direction.
    gridmetric: {
      label: 'The result metric of this level',
      what: function (ctx) {
        return 'The number each cell of this table reports: this level\'s own result measure, "' + (ctx && ctx.label ? ctx.label : 'its measure') + '". Its unit and range follow that measure, and the ± after each number is its standard error across seeds.';
      },
      goodBad: function (ctx) {
        return ctx && ctx.up === false
          ? 'In this level lower reads better, so prefer cells with a smaller number. Judge a gap against the ± error before trusting it.'
          : 'In this level higher reads better, so prefer cells with a bigger number. Judge a gap against the ± error before trusting it.';
      },
      anchor: null,
      patterns: [],
    },

    probability: {
      label: 'Action probability',
      what: 'The chance the policy gives to one action in a state, from 0 to 1. RL uses it to see how the policy splits its odds across actions as it learns.',
      goodBad: function () {
        return 'There is no single good value: it depends on how good the action is. Watch how it changes after an update, because that shows what the learner took away.';
      },
      anchor: function (v, ctx) {
        if (!isFinite(v)) return null;
        return 'Probability ' + shown(v, ctx) + ': about ' + pct(v) + ' chance of that action.';
      },
      patterns: [/probability of each action[^-\d]{0,10}(-?\d+(?:\.\d+)?)/i],
    },
  };

  // Resolve a metric's explanation into plain strings (no DOM), so tests can check the copy and the
  // numbers. Returns { label, what, goodBad, anchor } with the value-specific anchor line (or null).
  function explain(metricId, value, ctx) {
    var m = METRICS[metricId];
    if (!m) return null;
    var what = typeof m.what === 'function' ? m.what(ctx) : m.what;
    var goodBad = typeof m.goodBad === 'function' ? m.goodBad(ctx) : m.goodBad;
    var anchor = value === undefined || value === null ? null : (m.anchor ? m.anchor(value, ctx) : null);
    return { label: m.label, what: what, goodBad: goodBad, anchor: anchor };
  }

  var API = {
    METRICS: METRICS,
    explain: explain,
    anchors: {
      klMove: klMove, klRatioText: klRatioText,
      entropyMax: entropyMax, entropyTopShare: entropyTopShare,
      gaussStdFromEntropy: gaussStdFromEntropy, gaussEntropyFromStd: gaussEntropyFromStd,
      pct: pct, num: num,
    },
    // DOM pieces are attached below only where a document exists.
  };

  // ---------------------------------------------------------------- one shared popover + trigger
  var POPOVER_ID = 'metric-help-popover';
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ensurePopover() {
    if (typeof document === 'undefined') return null;
    var el = document.getElementById(POPOVER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = POPOVER_ID;
    el.className = 'metric-help-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }
  var lastTrigger = null;
  function closeHelp() {
    if (typeof document === 'undefined') return;
    var el = document.getElementById(POPOVER_ID);
    if (el) el.hidden = true;
    if (lastTrigger) {
      lastTrigger.setAttribute('aria-expanded', 'false');
      if (lastTrigger.focus) lastTrigger.focus();
      lastTrigger = null;
    }
  }
  // Open the shared popover from a trigger button. Positions it just under the trigger so the
  // explanation reads next to the number it explains.
  function openHelp(metricId, value, ctx, triggerEl) {
    if (typeof document === 'undefined') return;
    var info = explain(metricId, value, ctx);
    if (!info) return;
    var el = ensurePopover();
    el.replaceChildren();
    var title = document.createElement('div');
    title.className = 'metric-help-title';
    title.textContent = info.label;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'metric-help-close';
    close.setAttribute('aria-label', 'Close metric help');
    close.textContent = '\u00d7';
    close.addEventListener('click', function () { closeHelp(); });
    var body = document.createElement('div');
    body.className = 'metric-help-body';
    var p1 = document.createElement('p');
    p1.textContent = info.what;
    var p2 = document.createElement('p');
    p2.textContent = info.goodBad;
    body.append(p1, p2);
    if (info.anchor) {
      var p3 = document.createElement('p');
      p3.className = 'metric-help-anchor';
      p3.textContent = info.anchor;
      body.append(p3);
    }
    el.append(title, close, body);
    el.hidden = false;
    if (triggerEl) {
      var r = triggerEl.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(window.innerWidth - 8 - el.offsetWidth, r.left)) + 'px';
      el.style.top = Math.min(window.innerHeight - 8 - el.offsetHeight, r.bottom + 8) + 'px';
      triggerEl.setAttribute('aria-expanded', 'true');
      lastTrigger = triggerEl;
    }
    if (close.focus) close.focus();
    return el;
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeHelp();
    });
    document.addEventListener('click', function (e) {
      var pop = document.getElementById(POPOVER_ID);
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (lastTrigger && lastTrigger.contains(e.target)) return;
      closeHelp();
    });
  }

  // The shared trigger button. One small accessible control placed next to the number.
  function trigger(metricId, value, ctx, labelText) {
    if (typeof document === 'undefined') return null;
    var info = explain(metricId, value, ctx);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'metric-help-btn';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'What is ' + (info ? info.label : 'this metric') + '?');
    b.textContent = '?';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var pop = document.getElementById(POPOVER_ID);
      var open = pop && !pop.hidden && lastTrigger === b;
      if (open) closeHelp(); else openHelp(metricId, value, ctx, b);
    });
    return b;
  }

  // ---------------------------------------------------------------- phrase-scoped enhancer
  // Walk the text nodes under root, find each known metric phrase, and insert the shared trigger
  // right after the number it explains. The visible words are left unchanged. Uses the hasIndices
  // (d) flag so the trigger can sit exactly at the captured value.
  function enhance(rootEl, ctx) {
    if (typeof document === 'undefined' || !rootEl) return 0;
    var placed = 0;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (node.parentElement && node.parentElement.closest('.metric-help-btn,.metric-help-pop')) continue;
      if (node.__rlhelpDone) continue;   // a node this pass already split: a second scan would duplicate the trigger
      placed += enhanceTextNode(node, ctx) ? 1 : 0;
    }
    return placed;
  }
  function enhanceTextNode(node, ctx) {
    // a detached text node (no parent) cannot be rebuilt: skip it instead of crashing
    if (!node.parentNode) return false;
    var text = node.nodeValue, matches = [];
    for (var id in METRICS) {
      var pats = METRICS[id].patterns || [];
      for (var p = 0; p < pats.length; p++) {
        var re = pats[p];
        if (!re.__d) {
          re.__d = true;
          try {
            var fl = re.flags;
            if (fl.indexOf('g') < 0) fl += 'g';   // g: so exec() advances in the loop instead of repeating
            if (fl.indexOf('d') < 0) fl += 'd';   // d: match.indices gives the value's exact span
            re.compile(re.source, fl);
          } catch (e) {
            try { re.compile(re.source, re.flags.indexOf('g') < 0 ? re.flags + 'g' : re.flags); } catch (e2) { /* keep as-is */ }
          }
        }
        re.lastIndex = 0;
        var mm;
        while ((mm = re.exec(text))) {
          var val = mm[1] !== undefined ? parseFloat(mm[1]) : null;
          // a sentence period can stick to the captured number: strip it so the anchor quotes the value
          var raw = mm[1] != null ? String(mm[1]).replace(/\.+$/, '') : null;
          var end;
          if (mm.indices && mm.indices[1]) end = mm.indices[1][1];
          else end = mm.index + mm[0].length;
          matches.push({ id: id, value: val, raw: raw, start: mm.index, end: end, spanStart: mm.index, spanEnd: end });
          if (mm[0].length === 0) re.lastIndex++;
        }
      }
    }
    if (!matches.length) return false;
    // sort by start; drop overlaps (keep the first)
    matches.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var kept = [], lastEnd = -1;
    for (var k = 0; k < matches.length; k++) {
      if (matches[k].spanStart >= lastEnd) { kept.push(matches[k]); lastEnd = matches[k].spanEnd; }
    }
    // rebuild the node as: text, trigger, text, trigger, ...
    var frag = document.createDocumentFragment();
    var cursor = 0;
    for (var j = 0; j < kept.length; j++) {
      var m = kept[j];
      var before = text.slice(cursor, m.end);
      if (before) frag.appendChild(document.createTextNode(before));
      var btn = trigger(m.id, m.value, m.raw != null ? Object.assign({}, ctx, { displayValue: m.raw }) : ctx);
      if (btn) frag.appendChild(btn);
      cursor = m.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    for (var c = 0; c < frag.childNodes.length; c++) {
      if (frag.childNodes[c].nodeType === 3) frag.childNodes[c].__rlhelpDone = true;
    }
    node.parentNode.replaceChild(frag, node);
    return true;
  }

  API.trigger = trigger;
  API.openHelp = openHelp;
  API.closeHelp = closeHelp;
  API.enhance = enhance;

  root.RLHELP = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
