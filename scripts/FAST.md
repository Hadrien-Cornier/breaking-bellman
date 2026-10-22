# Stored simulations

`src/sim/exact.js` owns the canonical settings and lossless result codec.
Keys hash the fully resolved configuration, including typed values, hidden knobs and hyperparameters, evaluation settings, ordered seeds, budget and semantic versions.
Object key order is immaterial; seed order is significant.
The codec retains complete curves, every seed, final policies, traces, replay, typed arrays, undefined, nonfinite numbers and negative zero.

`fast-source.js` owns version dependencies.
Its engine list is also the build's engine list, including RNG, worlds, learners, simulation and autopsy.
Content settings, rules, autopsy scoring and codec have explicit hashes.
The web display files, loader, build and styles are excluded because they do not change measured simulation outputs.
Engine files are hashed in full, conservatively including any renderer colocated with a world.
Changing semantic source requires a new version and matching simulations.

`fast-publish.js` accepts a derived exact manifest and a campaign directory with full records.
It verifies every supplied key, resolved configuration and complete ordered seed set before replacing the external index atomically.
Existing records are immutable, including their compressed bytes.
Only derived configurations and simulation outputs belong in public assets; keep campaign logs and selection provenance outside the repository.

```sh
node scripts/fast-publish.js MANIFEST CAMPAIGN fast > SIZES.json
npm run build
```

The external layout is `fast/VERSION/index.json` and `fast/VERSION/records/KEY.json.gz`.
Derived reproducibility manifests live at `fast/VERSION/manifests/phase1.json.gz` and `remaining-ac.json.gz`; decompress either into a `bb-campaign-v1` manifest for the runner and publisher.
The remaining actor-critic manifest is disjoint from phase one and carries no result claims until its simulations are complete.
The published set keeps existing keys that the game's first-match recognizer links to a recipe with a Codex card, across all published settings. Other settings use the local cache or Live. The reproducibility manifests retain the original configurations, including keys with no published record.
The report gives per-shard and aggregate raw/gzip bytes plus index bytes.
`build.mjs` copies assets to `dist/fast`; Pages stages that directory beside its HTML.
HTML embeds only version metadata, and the standalone file remains fully usable without fetching data.
`node --test test/fast-assets.test.js` checks that each current published key matches a recipe with a Codex card, plus shard integrity, ordered seeds and lossless round trips, and passes every current-version shard through the production consumer validator without training again.

Fast is the default; the browser fetches the index on Run, then loads one matching shard and checks its size, SHA-256, exact configuration and complete seeds.
Invalid versions, missing keys, corruption, timeout, fetch failure and file URLs fall through to the local IndexedDB cache, then actual Live settings.
The local cache uses the same full-record codec and validation, keyed by the canonical configuration including engine versions.
Live results save without rounding; explicit Live bypasses both caches and the choice resets to Fast on reload.
Storage failures and bounded open/transaction timeouts behave as misses; Settings clears the persisted result store.
Settings changes cancel pending main runs; stale results cannot paint a later request.
Missing keys revalidate the index, allowing later publication to append compatible shards without regenerating earlier results.

`fast-manifest.js CURATED OUTPUT` deterministically selects the curated non-actor-critic memberships and actor-critic anchors.
With `--remaining-ac` it selects the disjoint remaining curated actor-critic keys, without running them.
The selector retains global deduplication and lesson membership and checks resolved settings against its input.
The derived manifest contains no private selection provenance.
The separate selection evidence is for private verification only.

`fast-run-one.js` takes one JSON argument with `manifestPath`, `output` and `key`.
It verifies current semantic versions, checkpoints each seed atomically and emits one full compressed record only after all seeds finish.
`fast-campaign.py` is the bounded phase-one campaign driver for the designated Linux scope, with aggregate cgroup CPU accounting, owned-child termination, a wall cap and no automatic budget-stop retry.
Its limits and accounting are exercised by `python3 test/fast-budget.py` on the development machine.

Exact shard and codec fidelity is separate from rerunning floating point training on another JavaScript runtime.
`test/ui/fast.mjs MANIFEST CAMPAIGN PROOF_DIR [URL]` uses a named chrome-devtools-axi session to compare raw stored hashes, consumer rendering and representative Live reruns.
Its disclosed finite numeric check is absolute tolerance `1e-8` plus relative tolerance `1e-10`, with discrete values, nonnumeric values and symptom conclusions unchanged.
This is a check for those measured examples, not a universal error bound; no stored values are rounded or thinned.

The VPO lesson is a separate Live engine (`src/agents/vpo.js`), not a new arm of `RLA.run`.
`scripts/vpo-source.js` versions its exact dependency closure: shared RNG, its route/reward/optimizer engine, lesson controls/rules and frozen reference data.
`build.mjs` embeds that independent engine for its own worker and exposes its version through `bellman.state()`.
It does not use the Fast loader or the original content settings, engine or rules files.
Thus adding this lesson leaves the original 17 lessons' semantic versions and published phase-one/remaining-AC corpus unchanged.
Changes to any original semantic dependencies still require their normal new Fast version and matching measurements; changing the shared RNG also changes the VPO version.
No old corpus is relabeled, regenerated or represented as VPO data.
