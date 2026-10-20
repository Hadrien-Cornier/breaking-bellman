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
The report gives per-shard and aggregate raw/gzip bytes plus index bytes.
`build.mjs` copies assets to `dist/fast`; Pages stages that directory beside its HTML.
HTML embeds only version metadata, and the standalone file remains fully usable without fetching data.

The browser fetches the index only after Fast opt-in, then loads one matching shard and checks its size, SHA-256, exact configuration and complete seeds.
Invalid versions, missing keys, corruption, timeout, fetch failure and file URLs fall through to actual Live settings.
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
