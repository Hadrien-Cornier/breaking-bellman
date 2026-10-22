// Algorithm-name reminders: the single content source must be complete and consistent, and the
// name matcher must cover the names the game actually renders (level prose, questions, method
// labels, Codex and the family tree) without splitting one name into two or leaking an
// undiscovered solution recipe. Pure content checks with no DOM. Run: node --test test/algos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ALGO_HELP = require(path.join(__dirname, '..', 'web', 'algos.js'));
const ALGOS = ALGO_HELP.ALGOS;
const findNames = ALGO_HELP.findNames;
const reminderText = ALGO_HELP.reminderText;

// Load the real content so coverage is checked against the names that actually render.
global.window = global.window || {};
require(path.join(__dirname, '..', 'web', 'content.js'));
require(path.join(__dirname, '..', 'web', 'content2.js'));
require(path.join(__dirname, '..', 'web', 'content3.js'));
const C = global.window.CONTENT;

// ---- one consistent content source per algorithm --------------------------------------------
test('every algorithm has a label, an idea, defining math and explained symbols', () => {
  const ids = Object.keys(ALGOS);
  assert.ok(ids.length >= 20, 'a full set of named methods is covered (' + ids.length + ')');
  for (const id of ids) {
    const a = ALGOS[id];
    assert.equal(typeof a.label, 'string', id + ' has a label');
    assert.ok(a.label.trim().length > 0, id + ' label is not empty');
    assert.ok(a.idea && a.idea.trim().length > 0, id + ' has an idea');
    assert.ok(a.math && a.math.trim().length > 0, id + ' has defining math');
    assert.ok(Array.isArray(a.symbols) && a.symbols.length > 0, id + ' has symbols');
    for (const s of a.symbols) {
      assert.ok(Array.isArray(s) && s.length === 2, id + ' symbol is a [symbol, meaning] pair');
      assert.ok(String(s[0]).trim().length > 0 && String(s[1]).trim().length > 0, id + ' symbol parts are non-empty');
    }
    assert.ok(Array.isArray(a.re) && a.re.length > 0, id + ' has name patterns');
  }
});

test('reminderText carries the expanded name, idea, math and every symbol', () => {
  for (const id of Object.keys(ALGOS)) {
    const a = ALGOS[id];
    const t = reminderText(id);
    assert.ok(t.includes(a.label), id + ' reminder repeats the expanded name');
    assert.ok(t.includes(a.idea), id + ' reminder carries the idea');
    assert.ok(t.includes(a.math), id + ' reminder carries the math');
    for (const [sym, meaning] of a.symbols) {
      assert.ok(t.includes(sym), id + ' reminder explains the symbol ' + sym);
      assert.ok(t.includes(meaning), id + ' reminder gives the meaning of ' + sym);
    }
  }
});

// ---- name coverage: every algorithm label is recognized, and so are its surface forms --------
test('each algorithm expanded name is recognized and maps to itself', () => {
  for (const id of Object.keys(ALGOS)) {
    const hits = findNames(ALGOS[id].label);
    assert.ok(hits.length >= 1, id + ' label is found in itself');
    assert.equal(hits[0].id, id, id + ' label maps to ' + id);
    assert.equal(hits.length, 1, id + ' label is one name, not several');
  }
});

test('the intent names DDPG, TD3 and SAC expand consistently across forms', () => {
  const same = (forms, id) => {
    for (const f of forms) {
      const hits = findNames(f);
      assert.equal(hits.length, 1, '"' + f + '" is one name');
      assert.equal(hits[0].id, id, '"' + f + '" maps to ' + id);
    }
  };
  same(['DDPG', 'Deep deterministic policy gradient', 'Deep deterministic policy gradient (DDPG)'], 'ddpg');
  same(['TD3', 'Twin delayed DDPG (TD3)'], 'td3');
  same(['SAC', 'Soft actor-critic', 'Soft actor-critic (SAC)'], 'sac');
});

test('a full name with its acronym is one reminder, and longer forms win', () => {
  const one = (s, id) => {
    const hits = findNames(s);
    assert.equal(hits.length, 1, '"' + s + '" collapses to one name');
    assert.equal(hits[0].id, id, '"' + s + '" maps to ' + id);
  };
  one('Deep Q-Network (DQN)', 'dqn');
  one('Twin delayed DDPG (TD3)', 'td3');
  one('Soft actor-critic (SAC)', 'sac');
  one('Implicit Q-learning (IQL)', 'iql');
  one('Expected Sarsa', 'expsarsa');     // not Sarsa
  one('Double DQN', 'ddqn');             // not DQN
  one('Double Q-learning', 'doubleq');   // not Q-learning
  one('TD3+BC', 'td3bc');                // not TD3
  one('Filtered BC', 'filtbc');          // not BC
});

test('several names in one line are each found and kept apart', () => {
  const hits = findNames('TD3+BC beats TD3 on DDPG, and IQL beats CQL offline.');
  assert.deepEqual(hits.map((h) => h.id), ['td3bc', 'td3', 'ddpg', 'iql', 'cql']);
});

// ---- the specific learning context the captain named ---------------------------------------
test('SAC "soft" is entropy-regularized, not slow copies or two critics', () => {
  const t = reminderText('sac');
  assert.ok(/entropy/i.test(t), 'SAC reminder explains the entropy idea');
  assert.ok(/entropy-regularized/i.test(t), 'soft is defined as entropy-regularized');
  assert.ok(/not slow target copies or two critics|not slow copies or twin critics/i.test(t),
    'soft explicitly disclaims the slow-copy / twin-critic meaning');
});

test('the DDPG reminder matches the reference semantics', () => {
  const t = reminderText('ddpg');
  assert.ok(t.includes('Deep deterministic policy gradient'), 'expanded name');
  assert.ok(/mu\(s\)/.test(t), 'actor outputs mu(s)');
  assert.ok(/Q\(s,a\)/.test(t), 'critic estimates Q(s,a)');
  assert.ok(/y = r \+ gamma/.test(t), 'target y = r + gamma ...');
  assert.ok(/Q_target/.test(t), 'target uses the slow target critic');
  assert.ok(/actor maximizes/i.test(t), 'actor maximizes Q(s, mu(s))');
});

// ---- names the game renders are covered ------------------------------------------------------
test('every algorithm-bearing method label the game renders gets a reminder', () => {
  const names = [];
  for (const r of C.recipes) names.push(r.name);
  for (const id of Object.keys(C.cards)) names.push(C.cards[id].name);
  // The named methods that must be covered. Failure cards (Lock-in, Maximization bias, ...) are
  // concepts, not algorithms, so they are not in scope.
  const mustCover = ['DDPG', 'TD3', 'SAC', 'DQN', 'PPO', 'GRPO', 'IQL', 'CQL', 'AWR', 'TD3+BC',
    'Q-learning', 'Sarsa', 'Expected Sarsa', 'n-step TD', 'Monte Carlo', 'UCB', 'REINFORCE',
    'Double DQN', 'Double Q-learning', 'Clipped double Q', 'Behavior cloning', 'Q-planning', 'EXPO'];
  for (const token of mustCover) {
    const hit = names.find((n) => n.includes(token));
    assert.ok(hit, 'a rendered method label contains ' + token);
    assert.ok(findNames(hit).length >= 1, 'the label "' + hit + '" gets a reminder');
  }
});

// ---- do not expose undiscovered solution recipes through incidental hints -------------------
test('an undiscovered placeholder has no name to leak and no reminder is attached', () => {
  assert.equal(findNames('???').length, 0);
  assert.equal(findNames('Not discovered yet.').length, 0);
  assert.equal(findNames('The hint stops here.').length, 0);
});

test('reminder content states the algorithm math, not the game word recipe', () => {
  // The game's recipe is a set of word choices ("sometimes at random", "a frozen copy", ...). A
  // reminder may describe the real algorithm, but must not present the game's sentence words.
  for (const id of Object.keys(ALGOS)) {
    const t = reminderText(id);
    assert.ok(!/update rule|the sentence|change a word|chip/i.test(t), id + ' reminder avoids game-recipe framing');
  }
});

// ---------------------------------------------------------------- scope 175: unlocked presets
// The preset loader must reuse the recipe catalog (C.recipes) and keep the current environment,
// dataset and budget when compatible. These pure checks cover the filtering, the compatibility
// reasons and the TD3 settings diff with the offline-arm context preserved. "Zero runs on
// select" is a UI behavior and is covered in test/ui/algos.mjs.
test('preset (175): TD3 diff changes only its defining keys and keeps the offline-arm context', () => {
  const td3 = C.recipes.find((r) => r.card === 'td3');
  assert.ok(td3, 'the TD3 recipe exists in the shared catalog');
  // A current offline arm: actor-critic, offline dataset (source: fixed), not yet TD3.
  const cur = {
    family: 'ac', source: 'fixed', demos: 'reachdata', world: 'reach',
    head: 'gauss', aim: 'actor', critics: 'one', target: 'live', next: 'none', delay: 1,
    penalty: 'none', pick: 'one', chunk: 1, base: 'none', entropy: 'none', wait: 0,
  };
  const plan = ALGO_HELP.presetPlan(cur, td3.keys);
  // Every changed setting is one of the recipe's defining keys, and each is set to the preset value.
  const changed = plan.changes.map((c) => c.key);
  for (const k of changed) assert.ok(k in td3.keys, k + ' is a recipe (algorithm) key');
  for (const k in td3.keys) {
    const want = td3.keys[k];
    const expected = Array.isArray(want) ? (want.includes(cur[k]) ? cur[k] : want[0]) : want;
    assert.equal(plan.next[k], expected, k + ' is set to the preset value');
  }
  // The current task, dataset and budget survive: those are not recipe keys.
  assert.equal(plan.next.source, 'fixed', 'dataset (source) preserved, no silent switch');
  assert.equal(plan.next.demos, 'reachdata', 'dataset detail preserved');
  assert.equal(plan.next.world, 'reach', 'environment preserved');
  assert.ok(!('source' in td3.keys) && !('world' in td3.keys), 'the preset does not touch task or dataset');
});

test('preset (175): compatibility reasons name the mismatch before any change', () => {
  const famOf = C.famOf, families = C.families;
  const td3 = C.recipes.find((r) => r.card === 'td3');
  // TD3 (actor-critic) into an actor-critic offline arm: compatible (no reason).
  assert.equal(ALGO_HELP.presetReason(famOf, families, td3, { family: 'ac' }, 'reach'), null);
  // TD3 into a value-learning sentence: a clear reason, never a silent load.
  assert.match(ALGO_HELP.presetReason(famOf, families, td3, { family: 'value' }, 'grid'), /Needs the/i);
  // A slot-machine-only recipe into a grid world: a clear world reason.
  const bandit = C.recipes.find((r) => r.world === 'bandit');
  assert.ok(bandit, 'a bandit-only recipe exists');
  assert.match(ALGO_HELP.presetReason(famOf, families, bandit, { family: 'value' }, 'grid'), /world/i);
});

test('preset (175): only unlocked (found or given) methods are offered', () => {
  const r = C.recipes.find((x) => x.card === 'td3');
  assert.equal(ALGO_HELP.presetUnlocked(r, ['td3'], []), true, 'a built method is unlocked');
  assert.equal(ALGO_HELP.presetUnlocked(r, [], ['td3']), true, 'a level-given method is unlocked');
  assert.equal(ALGO_HELP.presetUnlocked(r, ['cql'], ['awr']), false, 'locked when not found or given');
});

test('preset (175): the plan is pure and starts nothing (zero runs on select)', () => {
  const td3 = C.recipes.find((r) => r.card === 'td3');
  const cur = { family: 'ac', source: 'fixed', head: 'gauss' };
  const snapshot = JSON.stringify(cur);
  const plan = ALGO_HELP.presetPlan(cur, td3.keys);
  assert.equal(JSON.stringify(cur), snapshot, 'the current settings are not mutated');
  assert.deepEqual(Object.keys(plan).sort(), ['changes', 'next'], 'the plan only describes settings, it does not run');
});

// ---------------------------------------------------------------- scope 173/176: method panel content
test('panel (176): RECAP separates the game mechanism from the published method, with verified source', () => {
  const g = ALGOS.recap.gameNote;
  assert.ok(g, 'RECAP carries a game-adaptation note');
  assert.match(g, /advantage-label/i, 'names the mechanism the game implements');
  assert.match(g, /Physical Intelligence/i, 'names the organization');
  assert.match(g, /arXiv:2511\.14759/i, 'cites the verified primary source id');
  assert.match(g, /does not implement|only the/i, 'states the game is a simplification of the full method');
});

test('panel (173): AWR note flags the return-estimate variant, not a new UI', () => {
  const n = ALGOS.awr.note;
  assert.ok(n, 'AWR carries an accuracy note');
  assert.match(n, /Qbar\(s,a\)|Qbar/i, 'states what this screen shows');
  assert.match(n, /Monte Carlo|TD\(lambda\)/i, 'states the original AWR return estimate');
});
