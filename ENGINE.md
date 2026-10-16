# Breaking Bellman engine: module interfaces

One engine runs every mode (Campaign, Workbench, Saboteur). A learner is one
parameterized agent with part switches, so any combination of parts trains for real.

## File format (every file in `src/`)

Plain JavaScript, no imports, no build step. Each file is an IIFE that registers
into the global namespace `RLA`, so the same file runs in Node (tests), in the page
and in a Web Worker (the build concatenates the files).

```js
(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  if (typeof require === 'function') { require('./rng.js'); } // dependencies, Node only
  // ... code ...
  RLA.nn = { mlp, adam, sgd };
})();
```

Rules: typed arrays (`Float32Array`, `Float64Array`) in hot loops; no allocation per
step in hot loops where it is easy to avoid; no `Math.random` (use `RLA.rng`); no DOM.

## `src/core/rng.js` (done)

`RLA.rng.make(seed)` returns `{ next(), int(n), normal(), uniform(a, b), choice(arr), seed }`.
`next()` is in [0, 1). Deterministic for one seed.

## `src/core/nn.js` (MLP and optimizers)

```js
const net = RLA.nn.mlp({ sizes: [4, 32, 32, 2], act: 'relu' | 'tanh', rng, outScale: 1 });
net.sizes                         // copy of sizes
net.params                        // Array of Float32Array: [W0, b0, W1, b1, ...]; W row-major [out][in]
net.grads                         // Array of Float32Array, same shapes as params
net.forward(x)                    // x: Float32Array(in) -> Float32Array(out), new array, no cache
net.forwardBatch(X, B)            // X: Float32Array(B*in) -> Float32Array(B*out); caches activations
net.backwardBatch(dOut)           // dOut: Float32Array(B*out) = dLoss/dOut for the last forwardBatch;
                                  // ADDS into net.grads (sum over batch; the caller divides by B)
net.zeroGrad()
net.gradNorm()                    // L2 norm over all grads
net.copyFrom(other)               // copy params of a net with the same sizes
net.clone()                       // new net, same params, zero grads
net.nParams()
const opt = RLA.nn.adam(net, { lr: 1e-3, beta1: 0.9, beta2: 0.999, eps: 1e-8, clipNorm: null });
opt.step()                        // clip grads by global norm if clipNorm, apply update, then net.zeroGrad()
const opt2 = RLA.nn.sgd(net, { lr: 1e-2, clipNorm: null });
```

Init: weights normal with std `sqrt(2 / fanIn)` for relu, `sqrt(1 / fanIn)` for tanh; biases 0;
the last layer weights multiplied by `outScale`. The last layer is linear (no activation).

## `src/worlds/*.js` (environments)

Each world file registers `RLA.worlds[name] = { make(knobs, rng), knobs: [...], info }`.

```js
const w = RLA.worlds.cartpole.make({ maxSteps: 200, ... }, rng);
w.spec   // { name, obsDim, nActions, maxSteps, gamma, nStates? }  (nStates if a table can index it)
w.reset()            // -> Float32Array(obsDim)
w.step(a)            // a: integer action -> { obs, reward, done, truncated, info }
                     // done = true at a terminal state; truncated = true at the time limit (not terminal)
w.stateIndex(obs)    // integer in [0, nStates) for tabular learners (cartpole: by binning, knob `bins`)
w.render(ctx, width, height)  // draws the current state on a 2D canvas context (no DOM lookups)
RLA.worlds.cartpole.knobs     // [{ key, label, min, max, step, default, help }]  (sabotage knobs)
RLA.worlds.cartpole.info      // { title, teaches, cannotTeach }
```

## `src/agents/learner.js` (Sonnet/Opus writes this; the coupled part)

`RLA.learner.make(parts, world, rng)` returns `{ act(obs, explore), observe(t), endEpisode(), diagnostics() }`.
`parts` is a plain object of switches (see `RLA.parts`), for example
`{ repr: 'net', target: 'td', explore: 'epsilon', replay: true, targetNet: true, double: false }`.

## `src/sim/run.js`

`RLA.run({ world, knobs, parts, hyper, seed, steps, onProgress })` returns curves
(episode returns, evaluation returns, predicted value vs realized value, loss, max |Q|).

## Tests

`test/*.test.js` with `node:test` and `node:assert`. Run with `nice node --test test/`.

## Phases 2 to 5 (15 Oct 2026)

Three learner families. `parts.family` picks the sentence; word keys are unique across families.

| Family | File | Worlds | Sentence words |
|---|---|---|---|
| `value` (phase 1) | `src/agents/value.js` | bandit, cliff, cartpole, mirage | `store eps ucb optimistic data memory step nstep agg picker scorer sync` |
| `pg` (phase 2) | `src/agents/pg.js` | cartpole, goalgrid, pendulum | `batch group credit baseline adv scale ratio epochs lr bonus` |
| `ac` (phases 3 to 5) | `src/agents/ac.js` | pendulum, reach, fork | `source demos base head chunk aim critics target next penalty delay entropy pick wait` |

Continuous worlds have `spec.continuous = true` and `spec.actDim`. A world can also give `expertStart(rng)` and
`expert(obs, ctx, rng)` (the demonstrator that makes the offline datasets) and `base(obs)` (a classical controller,
used by `base: 'classical'` and by the final test as a reference on the same starts).

Calibration workflow for any number quoted in `web/content3.js`:

1. Put the configs in `exp/bNN.json` (same world, knobs, parts and hyper as the page).
2. `node exp/lvcal.js exp/bNN.json exp/out/bNN.json 14` runs seeds 101, 202, 303 and the page's autopsy.
3. `node exp/mkmeasured.js exp/out/bNN.json` writes `web/measured.js`; `node build.mjs` rebuilds the page.

## Fork world and level settings (15 Oct 2026)

- `src/worlds/fork.js`: the demonstrator goes around the obstacle through two waypoints at `±(r + 0.25)`, at least
  0.12 from the edge, and alternates left and right (`expertStart`). Starts: home pose `(0, −0.8)` plus the `spread`
  knob (default 0). The `mud` knob adds a cost per step in `x < −0.2, |y| < 0.6`.
- `src/sim/run.js`: the final test reports `leftRate`, the share of test paths that pass `x < −0.3`.
- `src/sim/autopsy.js`: pendulum keeps `worstSeed` and warns (`seedStuck`) when the mean passes −250 but a seed does not.
- `web/app.js` `hyperNow()`: a campaign level may add training settings (`lv.hyper`) on top of the world's.
- Tests: `test/families.test.js` checks that the fork demonstrator never hits the obstacle and alternates sides, and
  that mud costs only on the left.

## Replay session and the page panels (15 Oct 2026, version 5)

- `RLA.session(cfg)` (in `src/sim/run.js`) now records the moves: `episode()` returns the moves of the episode that holds the
  latest move, `history()` the last 12 moves. Each move is `{obs, a, r, reward, obs2, done, truncated, st, st2, t}`; `st` and
  `st2` are `world.getState()` before and after, or `null` for worlds without it (cliff, mirage, bandit). The page's
  "Watch one update" finds the replayed row in the episode by matching `obs`, `a` and the rewards, then animates it.
- "Try every combination" (`web/app.js`, `runGrid`) runs every combination of 1 to 4 words (at most 32) with `runSeeds`, one
  combination at a time, and computes per-seed standard errors with `RLA.autopsy([r])`. It never calls `discover()`.
- Notion snapshots (`saveToNotion`) are optional and off by default. They run only when the build reads a `local.config.json`
  with a `notion` data source (see README) and the page runs inside claude.ai with the viewer's Notion connector.

