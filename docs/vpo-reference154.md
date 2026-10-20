# Frozen synthetic154 reference

The VPO lesson teaches the vector set objective even though this experiment failed its planned scientific gates. Its Live runs are a separate finite-route categorical policy, not these frozen measurements and not an LLM replication. No additional research campaign was run to build the lesson.

Source: `report154.md` and `analysis154.json`, attempt `a26-hard154-v1`, frozen research commit `71510bbbb3777a790077889c7e4bff7b184c2cf5`, manifest SHA256 `f2313135be231ae7ad9934c026f4336e8755e622ce46d39c7339427ed85b6d20`. The original report and raw artifacts are preserved in the project research archive under `data/bb-vpo-design`; they are not bundled into this game repository. The table in `web/vpo-reference.js` is transcribed from that analysis, with full precision retained.

Equal-weight discovery seeds 2, 4, 6, 8, 10; 32 held-out problems, six repetitions, 30 ordered candidates per problem/repetition. Best@k takes the largest *fixed* uniform scalar reward in the first k draws, then averages repetitions, problems and seeds. VPO concatenates fresh three-candidate chains. GRPO samples independent candidates.

| Policy | best@3 | best@30 | Growth |
|---|---:|---:|---:|
| VPO | .644115 | .752552 | .108438 |
| GRPO | .616250 | .729531 | .113281 |
| Base | .615781 | .768229 | .152448 |
| MultiRLVR, mean-chain adaptation | .530625 | .698854 | .168229 |
| Random-weight GRPO | .655417 | .753594 | .098177 |

VPO minus GRPO at 30 was +.023021, below the declared +.05 requirement. VPO beat GRPO in four of five seeds, losing in seed 6. GRPO also improved. GRPO flatness and MultiRLVR flatness gates failed, as did the primary effect-size gate. The set-objective mechanism remains inconclusive. Confirmation was conditional on every discovery gate passing and was correctly not launched.

GRPO and VPO jointly reached the finite planner-menu reference in 0/160 problem-seed units: saturation was zero. That menu used bounded subset/last-treasure planning and two BFS kernels, not a global optimal oracle. Larger reward spread coexisted with lower exit rates for VPO (.600868 versus GRPO .700868); spread alone does not establish useful alternatives.

The synthetic learner was a small MLP navigation policy, not a pretrained language model. Behavioral-cloning data and compute differed from earlier experiment098, so the change did not isolate environment difficulty. Individual candidate paths and per-repetition samples were not retained; the audit verified aggregation, source and prior prefix regression rather than reconstructing each sampled maximum. Training counters overwritten by evaluation counters in final JSON were recovered from original training progress records without changing raw data. No confirmation scores exist.

The method source is [Bahlous-Boldi et al., Vector Policy Optimization, Section 3](https://arxiv.org/html/2605.22817v1#S3); ordered-prefix evaluation is Section 4.3. The lesson uses vector rewards, shared Dirichlet(1) preference draws, max over alternatives per direction and group-relative whole-set credit. Its tabular categorical PPO-like learner, fixed finite route menu, coverage bits and short training are disclosed simplifications. It makes no guaranteed advantage, paper replication or flat-GRPO/rising-VPO claim.
