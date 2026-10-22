# Experiment log (all results are Simulation, run in Node on a 16-core ARM cloud server (AWS m7g.4xlarge) with the page's own engine)

Settings unless stated: CartPole time limit 200, gamma 0.99, net [32, 32] relu, Adam lr 1e-3, clip norm 10, MSE loss,
epsilon 1.0 to 0.05 over 5000 steps, buffer 10000, batch 32, learn start 500, target sync every 250 updates.
Evaluation: 3 greedy episodes every steps/40; "final" = mean of the last 25% of evaluations. Raw output: `exp/out/`. Batch configs are in `exp/config/`, tools in `exp/tools/`, probe logs in `exp/logs/`, figures in `exp/plots/`.

## 15 Oct 2026, batch 1: which parts does CartPole need? (`exp/config/b1.json`, 20k steps, 5 seeds)

Question: does each part of DQN matter on CartPole, and does overestimation show?
Prediction (Opus, before the run): naive net unstable but not divergent to millions; replay alone helps;
DQN best; Double DQN reduces a visible overestimation gap with 5 action copies and reward noise 2.

| Recipe | Final score (mean, sd) | Largest abs(Q) | Pred minus earned | Note |
|---|---|---|---|---|
| Net, bootstrap, epsilon (naive) | 9.4 (0.2) | 4.7e6 | +1.4e6 | diverged in all 5 seeds |
| + replay | 91 (40) | 1.1e5 | +1.1e4 | diverged more slowly, 2 seeds forgot |
| + target copy | 57 (14) | 81 | +25 | values stay bounded, 4 of 5 seeds forgot |
| + replay + target copy (DQN) | 144 (31) | 65 | -20 | stable |
| DQN + double | 142 (25) | 94 | -23 | no difference at this scale |
| Table (6 bins, 1296 cells) | 59 (27) | 40 | -15 | slow |
| DQN, 5 action copies, reward noise 2 | 166 (29) | 156 | -5 | no overestimation |
| Double DQN, same | 151 (16) | 105 | -19 | |

Interpretation: the naive divergence is far stronger than predicted. Replay alone does not stop it; the target copy
does. Overestimation does NOT show on this CartPole at 20k steps: Q is below the earned value (slow value propagation).
So the page cannot use CartPole to teach Double DQN. Decision: teach maximization bias in a tiny MDP (the mirage,
Sutton and Barto Example 6.7) and label the Double DQN card "benefit not visible in this toy CartPole".

## 15 Oct 2026, batch 2 and 3: tabular worlds (`exp/config/b2.json`, `exp/config/b3.json`)

| World, recipe | Result | Runs |
|---|---|---|
| Bandit 10 arms, greedy, sample average | best arm 33% of last 200 pulls | 300 |
| Bandit, epsilon 0.1 | 78% | 300 |
| Bandit, epsilon 1.0 to 0.01 over 500 | 92% (but regret 391 vs 219) | 300 |
| Bandit, optimistic start +5, step 0.1 | 84% | 300 |
| Bandit, UCB c=2 | 84%, lowest regret 152 | 300 |
| Bandit drift 0.03, epsilon 0.1, sample average | 53% (2000 pulls) | 300 |
| Bandit drift 0.03, epsilon 0.1, constant step 0.1 | 71% | 300 |
| Mirage, Q-learning, eps 0.1, alpha 0.1 | left door 82% at worst, 13% at end | 300 |
| Mirage, Double Q-learning (two tables) | 16% at worst, 6% at end | 300 |
| Mirage, Q + lagged target table + double | 72% at worst | 300 |
| Mirage, Monte Carlo | 14% at worst | 300 |
| Cliff, Q-learning, eps 0.1, alpha 0.1, 10k steps | greedy fails (-200): undertrained, loops at start | 10 |
| Cliff, Q-learning, eps 0.1, alpha 0.5, 10k steps | -13 (optimal), 0.32 falls per episode while learning | 20 |
| Cliff, Monte Carlo, alpha 0.5 or 0.1 | -200: the episodes never reach the goal (time limit) | 20 |
| Cliff, Q-learning, greedy, alpha 0.5 | -13, 0 falls (zero start is optimistic when every step costs -1) | 20 |

Interpretation: greedy 33% matches the Sutton and Barto testbed figure (to check, claim C1). The cliff needs alpha 0.5
(the book's value, to check). Monte Carlo fails on the cliff because no episode ends at the goal; TD learns inside
the episode. A lagged copy is not a second independent estimate, so it does not remove maximization bias in a table.

## 15 Oct 2026, batch 4: alternatives and sabotage (`exp/config/b4.json`)

| Recipe, knobs | Result |
|---|---|
| Net, Monte Carlo, epsilon (no replay) | 34 (14) |
| Net, Monte Carlo, replay | 181 (16), better than DQN at 20k |
| DQN, sparse reward | 0: no signal |
| DQN, actuator slips 0.3 | 165 (24): survives |
| DQN, sensor noise 0.3 | 115 (22), 2 of 3 forgot |
| DQN, motor force 4 N | 161 (8) |
| Table, 12 bins (20736 cells) | 49 (34) |
| Table, 3 bins (81 cells) | 80 (8): coarser learns faster here |
| DQN, 40k steps | 176 (27) |
| Mirage, Q-learning, 20 machines, noise 2 | 98% at worst |
| Mirage, Double Q, 20 machines, noise 2 | 23% at worst |
| Mirage, Q-learning, 1 machine | 15% at worst |

Interpretation: removing the bootstrap (Monte Carlo) plus replay is a valid fix for the CartPole divergence, because
CartPole episodes are short and always end. The campaign accepts it, and the cliff level already showed its limit.

## 15 Oct 2026, batch 5: numbers quoted by the campaign questions (`exp/config/b5.json`, engine v1)

| World, recipe, change | Result | Runs |
|---|---|---|
| Bandit, greedy, payout noise 0 | best machine 24% | 300 |
| CartPole, DQN, sensor noise 0.5 | 44 (17) | 3 |
| Cliff, Q-learning, slip 0.2 | -96 (57), 0.38 falls per episode | 20 |
| CartPole, naive net, learning rate 1e-4 | 9.4, largest abs(Q) 2.3e3: slower, still diverges | 3 |
| Cliff, Monte Carlo, time limit 500 | -500 | 20 |
| Cliff, Monte Carlo, epsilon 0.3 | -199 | 20 |

## 15 Oct 2026, batch 6: engine v2 regression and the new words (`exp/config/b6.json`)

Question: does engine v2 (update rule as words) reproduce v1, and what do the new words do?
Change: v2 adds n-step rows, next-action choice (best, taken, average, worst), picker and scorer (live, frozen, second,
smaller of two). Tie-breaks in targets now use the rng, so CartPole table numbers moved (59 to 50).

| World, words | Result | Runs |
|---|---|---|
| CartPole, network, latest (naive) | 9.5, largest abs(Q) 4.7e6 | 3 |
| CartPole, DQN (replay, frozen chooses and scores) | 143 (34), largest abs(Q) 65 | 5 |
| CartPole, Double DQN (live chooses, frozen scores) | 137 (33) | 5 |
| CartPole, network, replay, all rewards (Monte Carlo) | 196 (6) | 3 |
| CartPole, network, replay, 4 real rewards, frozen | 199 (2) | 3 |
| CartPole, table | 50 (11) | 5 |
| Bandit, greedy, average | 33% | 300 |
| Bandit, epsilon 0.1, average | 78% | 300 |
| Mirage, Q-learning | left 82% at worst, 13% at end | 300 |
| Mirage, Double Q (second scores) | 16% at worst | 300 |
| Mirage, clipped (smaller of live and second) | 14% at worst | 300 |
| Mirage, frozen copy scores (refresh 20) | 71% at worst | 300 |
| Mirage, Expected Sarsa (average next action) | 79% at worst: does not fix the bias | 300 |
| Cliff, Q-learning | -13, 0.32 falls per episode | 20 |
| Cliff, Sarsa (action taken next) | -82 (47), peak -17, 0.06 falls | 20 |
| Cliff, Expected Sarsa (average next action) | -15 (0), 0.04 falls | 20 |
| Cliff, Monte Carlo | -200 | 20 |
| Cliff, 4 real rewards, best next action | -88 (44), 0.07 falls | 20 |

Interpretation: v2 reproduces v1 within noise. Sarsa falls less but its greedy path is unstable; Expected Sarsa is
stable. The new level "Falling while learning" uses this: Sarsa passes the falls goal, and a note points to the
average next action.

## 15 Oct 2026, batch 7: checks for the missions and the explode level (`exp/config/b7.json`, engine v2)

| World, words, change | Result | Runs |
|---|---|---|
| CartPole, table, 12 bins | 46 (23) | 3 |
| CartPole, table, 3 bins | 97 (17) | 3 |
| CartPole, table, 6 bins | 51 (15) | 3 |
| Bandit, drift 0.03, epsilon, average | 53% | 200 |
| Bandit, drift 0.03, epsilon, fixed step 0.1 | 71% | 200 |
| Bandit, start +5, no epsilon, fixed step | 83% | 200 |
| Bandit, start +5, no epsilon, average | 64%: the first pull erases the high start | 200 |
| Bandit, UCB, no epsilon | 82%, regret 152 | 200 |
| Mirage, Q-learning, 20 machines, noise 2 | 98% at worst | 300 |
| CartPole, DQN, sparse reward | 0; 2% to 11% of training episodes had a reward, so no "No reward signal" symptom (threshold 5%) | 3 |
| Cliff, 2 real rewards, best next action | -22 (14), 0.05 falls | 20 |
| CartPole, network, replay only | 94 (43), largest abs(Q) 1.1e5 | 3 |
| CartPole, network, frozen only | 66 (8), bounded, 2 of 3 forgot | 3 |
| CartPole, network, 4 real rewards, latest, live | 9.2, largest abs(Q) 6.1e5 | 3 |
| CartPole, network, all rewards, latest | 28 (14) | 3 |
| CartPole, network, replay, smaller of two (no frozen) | 164 (33) but largest abs(Q) 5.5e3 | 3 |

Interpretation: two mission goals changed to match engine v2. "Starve DQN" now asks for a final score of 0, because
some sparse-reward episodes still reach the limit. "Finer is slower" now asks for less than 50 with more than 6 bins.
Several real rewards also cut the falls on the cliff (0.05 to 0.07), because those rewards come from the moves the
learner really made. Clipped double Q without a frozen copy scores well but still lets the values grow past 1000.

## 15 Oct 2026, batches 8 to 14: first calibration of phases 2 to 5 (`exp/config/b8.json` to `exp/config/b14.json`)

Question: which sentences of the new families (policy gradient `pg`, actor-critic `ac`) fail and which work, at a
budget the browser can run in about one minute? Outputs: `exp/out/b8.jsonl` to `exp/out/b14.jsonl` (per seed,
seeds 101, 202, ...; summarize with `node exp/tools/sum.js FILE`). All results are Simulation.

Findings that shaped the levels:

- CartPole with a 500-step limit, 1 episode per update: the whole-return policy gradient learns, then collapses.
  Rewards-to-go, a running-average baseline or a GAE critic each stop the collapse.
- 10 passes per batch at step size 0.03 without a limit: mean KL above 1 per update, collapse. The 20% clip keeps KL
  near 0.01.
- Goal grid with a pass/fail reward and γ = 1: a critic that bootstraps through the time limit fails (5% to 15%
  solved); real returns, a running average, no baseline at all, or the group mean solve 96% to 100%.
- Pendulum: a live target makes DDPG unreliable; SAC without an entropy bonus lets one seed in three hang.
- Offline reach: naive DDPG on expert data ends 0.9 m from the target (extrapolation error); copying ends near
  0.05 m. On mixed data, copying everything ends near 0.6 m; IQL near 0.23 m.
- The Gaussian behavior-cloning error first came from a log-likelihood in the pre-squash space. Fix: a likelihood in
  action space around tanh(μ) (dist 0.435 m to 0.133 m on expert data).
- The reach base controller was first a damped inverse kinematics, which the copy could not imitate well. It is now
  a Jacobian transpose, a = 12 Jᵀ(target − tip).
- Fork: a Gaussian or single-action copy drives into the obstacle; a flow-matching copy with 2 × 64 hidden units
  goes around it. Action chunks played without looking made it worse.
- EXPO first took 78 s for 1000 steps and collapsed to 0% success; after batching the proposals it runs and works.
- Residual RL on reach with a 3 kg payload never beat the controller: with 3 kg the controller is already at full
  command, so a correction cannot add anything (the residual knob is ±0.5 of a saturated command).

## 15 Oct 2026, batches 15 to 18: level checks, residual RL, missions (`exp/config/b15.json` to `exp/config/b18.json`)

Tooling: `exp/tools/lvcal.js` runs each config with the page's seeds and runs the page's autopsy on the results
(`exp/tools/full.js` per seed). `exp/tools/mkmeasured.js` turns the output into `web/measured.js`, so every number in a level
text comes from a run of the same code.

Changes made because of these batches:

- A new word `wait`: critic updates before the policy may change (a burn-in, Silver et al. 2018). Without it, the
  residual made the controller worse at once (final distance 0.33 m against 0.09 m at step 1500, seed 1).
- The residual base is the world's classical controller (`world.base`), not its demonstrator. The fork demonstrator
  needs a chosen side; called without it, it returned NaN (found by `test/families.test.js`).
- The wide final test now gives each test episode its own random stream, and the classical controller meets the
  same starts. Before, the controller had its own starts, so "beats the controller" compared different targets.
- The autopsy no longer reports "No reward signal" for offline runs (they have no training episodes), and no
  overestimation for learners without a critic.
- Pendulum is now judged by the wide test (20 starts per seed). The training-time score hid a failed seed of DDPG.
- A new knob `gain` for the reach controller. A soft controller (gain 4, 0.23 m) still did not leave room that a
  residual learned to use in 15000 steps (test −18.3 against −18.5). Stopped: kept as a knob for experiments.

Stopped and failed runs: the first batch 17 was stopped by hand (a `pkill` pattern also matched the shell). The
first batch 19 died 45 s after its start while the browser test ran; it was run again.

Interpretation: residual RL in this toy protects the controller (with the wait) and is far better than learning
from scratch, but it did not beat the controller within 30000 steps. The level says so and leaves it as an open
challenge. A Q-weighted average with λ = 1 mixes the two ways around the obstacle, because the critic's values
differ by much less than 1; choosing the best proposal does not.

Probe `exp/tools/qgap.js` (1 seed, 101): after Q-planning training on the fork, the critic's values of the 8 flow proposals
differ by 0.48 at the median step (largest 3.66, at the start, where the proposals split left and right). With
λ = 1, the largest weight at the start was 0.47, so the average still mixes the two sides.

## 15 Oct 2026, batches 19 to 23: the fork world was wrong; two levels rebuilt (`exp/config/b19.json` to `exp/config/b23.json`)

Question: after the paired final test (batch 19), do the level numbers still hold? Prediction: small shifts only.

Result: the training runs were identical, but the fork test numbers moved a lot. Flow copy: 90% success (batch 15)
became 63% (batch 19). A probe with 200 test starts per seed (`exp/tools/forkprobe.js`) gave flow 66 to 71% and Gaussian
45 to 58%: the 20-start test of batch 15 was lucky. A failure probe (`exp/tools/forkdiag.js`) showed where the copies hit
the obstacle: on its lower flanks, after they had already chosen a side. They did not average left and right.

Root cause (`exp/tools/forkexpert.js`): the demonstrator skimmed the obstacle (closest 0.002) and itself hit it in 6 of 50
episodes. Copies failed from imprecision near the edge, not from averaging the two ways. The level text claimed
mode averaging, which the runs did not show. Corrected here; the earlier entries of batches 8 to 18 about the fork
("a Gaussian copy drives into the obstacle"; "a Q-weighted average with λ = 1 mixes the two ways") are wrong for
the reason above.

Changes:
- Demonstrator: two waypoints beside the obstacle, at least 0.12 from its edge; 0 hits in 50 episodes. It now
  alternates left and right, so the data has the two ways in equal numbers.
- Starts: the `spread` knob also sets the height spread; its default is now 0 (every episode starts at the home pose).
- A `mud` knob: an extra cost per step beside the obstacle on the left. The final test counts left routes (`leftRate`).
- Pendulum: the autopsy keeps the worst seed (`worstSeed`), and the two pendulum levels now require every seed to
  reach −250. Under the paired test, SAC without the entropy bonus had a mean of −228 (it passed the old goal) with one
  seed at −433.
- A level can set its own training settings (`hyper`); "Two good ways" uses step size 0.003 and batches of 128.

Probes on the fixed world (`exp/tools/forkprobe2.js`, batches 20 to 22), all Simulation:
- One command per decision: every head (Gaussian, one action, flow) reached 100%, also from one home pose with exactly
  balanced data. After each step the robot sees where it is; a small lean to one side grows. The symmetric point is
  unstable, so the average does not survive feedback.
- 10 commands per decision, played without looking: the Gaussian copy reached 33% (15.0 hits per test), the
  one-action copy 67% (13.7 hits), the flow copy 85% (3.6 hits). With the default settings (step size 0.001, batch
  64) the flow copy reached only 63%, and with 10000 updates the one-action copy reached 100% (3 hits). The
  difference between heads is real but depends on the training budget.
- Q-planning-style picking (one command per decision): with mud on the left, one proposal went left in 48% of tests;
  best-of-8 0%, the Q-weighted average (λ = 1) 1.7%, EXPO's edit 0%. The Q-weighted average did not mix the ways here.
  The paper averages chunks of commands; this lab cannot score chunks with a critic, so that case is untested.

Level changes: "Two good ways" now plays 10 commands per decision and asks to keep 10 (goal: fewer than 5 hits, at
least 75% success). "Choose, do not average" became "Steer a frozen policy" (mud; goal: at most 10% through the mud,
at least 90% success). The mission "When averaging is fine" became "Look more often" (Gaussian copy, default
settings: 10 commands 0%, 5 commands 100%).

Interpretation: in this low-dimensional toy, mode averaging needs open-loop chunks to hurt. That matches the reason
π0 and ACT need an expressive output (flow matching, a CVAE) once they predict chunks. Whether feedback also breaks
the tie on the real arm (camera delay, noise) is not tested.

Figure: `exp/plots/fork-rework.png` (`exp/tools/plot_fork.py`).

Stopped and failed runs: none in batches 20 to 23. Cost: server CPU only, about 25 minutes of 14 parallel jobs.

### Batch 23 (final fork numbers)

| Run | World | Final (eval) | Test | Worst seed | Success | Hits | Left | Dist (m) | Base test | KL | Symptoms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tw-gauss-c10 | fork | -11.5 | -9.5 | - | 0.33 | 15.0 | 0.00 | - | - | - | bad:crash |
| tw-gauss-c1 | fork | -0.4 | -0.3 | - | 1.00 | 0.0 | 0.67 | - | - | - | ok:solved |
| tw-det-c10 | fork | -10.7 | -8.2 | - | 0.67 | 13.7 | 0.33 | - | - | - | bad:crash |
| tw-det-c1 | fork | -0.4 | -0.4 | - | 1.00 | 0.0 | 0.67 | - | - | - | ok:solved |
| tw-flow-c10 | fork | -2.1 | -2.5 | - | 0.85 | 3.6 | 0.50 | - | - | - | bad:crash ok:solved |
| tw-flow-c1 | fork | -0.3 | -0.3 | - | 1.00 | 0.0 | 0.62 | - | - | - | ok:solved |
| pk-one | fork {mud:0.1} | -1.2 | -1.0 | - | 1.00 | 0.0 | 0.48 | - | - | - | ok:solved |
| pk-best | fork {mud:0.1} | -0.1 | -0.1 | - | 1.00 | 0.0 | 0.00 | - | - | - | ok:solved |
| pk-qavg | fork {mud:0.1} | -0.5 | -0.7 | - | 0.98 | 0.5 | 0.02 | - | - | - | ok:solved |
| pk-edit | fork {mud:0.1} | -0.2 | 0.0 | - | 1.00 | 0.0 | 0.00 | - | - | - | ok:solved |
| m-ch-c1 | fork | -0.4 | -0.4 | - | 1.00 | 0.0 | 0.67 | - | - | - | ok:solved |
| m-ch-c3 | fork | -2.3 | -0.5 | - | 1.00 | 0.0 | 0.67 | - | - | - | ok:solved |
| m-ch-c5 | fork | -5.9 | -0.5 | - | 1.00 | 0.0 | 0.67 | - | - | - | ok:solved |
| m-ch-c10 | fork | -16.3 | -18.5 | - | 0.00 | 31.7 | 0.00 | - | - | - | bad:crash |

### Batch 19 (all other levels, paired final test)

The fork rows (`fk-`, `qp-`, `m-fk-`) use the old fork world; batch 23 replaces them. The page does not quote them.

| Run | World | Final (eval) | Test | Worst seed | Success | Hits | Left | Dist (m) | Base test | KL | Symptoms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cr-total-none | cartpole {maxSteps:500} | 9.4 | - | - | - | - | - | - | - | 0.001 | bad:collapse bad:unsolved |
| cr-togo-none | cartpole {maxSteps:500} | 273.3 | - | - | - | - | - | - | - | 0.001 | warn:unsolved |
| cr-total-avg | cartpole {maxSteps:500} | 279.8 | - | - | - | - | - | - | - | 0.001 | warn:unsolved |
| cr-togo-avg | cartpole {maxSteps:500} | 261.8 | - | - | - | - | - | - | - | 0.001 | warn:unsolved |
| cr-togo-crit-mc | cartpole {maxSteps:500} | 225.7 | - | - | - | - | - | - | - | 0.001 | warn:collapse bad:unsolved |
| cr-togo-crit-gae | cartpole {maxSteps:500} | 386.0 | - | - | - | - | - | - | - | 0.001 | warn:spread warn:unsolved |
| cr-togo-none-std | cartpole {maxSteps:500} | 474.7 | - | - | - | - | - | - | - | 0.001 | ok:solved |
| cr-b4-total-none | cartpole {maxSteps:500} | 366.7 | - | - | - | - | - | - | - | 0.001 | warn:unsolved |
| cr-b4-togo-crit | cartpole {maxSteps:500} | 356.6 | - | - | - | - | - | - | - | 0.000 | warn:unsolved |
| st-plain-e10-lr03 | cartpole {maxSteps:500} | 158.2 | - | - | - | - | - | - | - | 1.500 | bad:collapse warn:spread bad:bigSteps warn:noExplore bad:unsolved |
| st-clip-e10-lr03 | cartpole {maxSteps:500} | 395.2 | - | - | - | - | - | - | - | 0.008 | warn:spread warn:unsolved |
| st-plain-e10-lr003 | cartpole {maxSteps:500} | 382.8 | - | - | - | - | - | - | - | 0.132 | warn:spread warn:bigSteps warn:unsolved |
| st-plain-e1-lr03 | cartpole {maxSteps:500} | 370.7 | - | - | - | - | - | - | - | 0.050 | warn:collapse warn:spread warn:unsolved |
| st-clip-e10-lr01 | cartpole {maxSteps:500} | 316.0 | - | - | - | - | - | - | - | 0.005 | warn:collapse warn:spread warn:unsolved |
| st-plain-e10-lr001 | cartpole {maxSteps:500} | 378.6 | - | - | - | - | - | - | - | 0.008 | warn:spread warn:unsolved |
| gg-ppo | goalgrid | 0.1 | 0.1 | - | 0.13 | 0.0 | - | - | - | 0.010 | bad:overestimate bad:unsolved |
| gg-ppo-mc | goalgrid | 1.0 | 0.9 | - | 0.95 | 0.0 | - | - | - | 0.014 | ok:solved |
| gg-ppo-grpo | goalgrid | 1.0 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.000 | bad:emptyGroups ok:solved |
| gg-ppo-avg | goalgrid | 1.0 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.001 | ok:solved |
| gg-ppo-none | goalgrid | 1.0 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.001 | ok:solved |
| gg-ppo-group-mixed | goalgrid | 1.0 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.008 | bad:emptyGroups ok:solved |
| gg-ppo-td | goalgrid | 0.1 | 0.1 | - | 0.08 | 0.0 | - | - | - | 0.039 | bad:overestimate bad:unsolved |
| pd-ddpg-live | pendulum | -771.9 | -481.2 | - | 0.00 | 0.0 | - | - | - | - | warn:unsolved |
| pd-ddpg-slow | pendulum | -200.6 | -277.0 | - | 0.00 | 0.0 | - | - | - | - | warn:overestimate warn:unsolved |
| pd-td3 | pendulum | -198.4 | -142.0 | - | 0.00 | 0.0 | - | - | - | - | bad:overestimate ok:solved |
| pd-sac-none | pendulum | -173.6 | -228.0 | - | 0.00 | 0.0 | - | - | - | - | warn:noExplore ok:solved |
| pd-sac-auto | pendulum | -164.1 | -144.7 | - | 0.00 | 0.0 | - | - | - | - | ok:solved |
| pd-sac-fixed | pendulum | -204.0 | -147.0 | - | 0.00 | 0.0 | - | - | - | - | warn:overestimate ok:solved |
| pd-sac-none5 | pendulum | -260.6 | -269.2 | - | 0.00 | 0.0 | - | - | - | - | warn:overestimate warn:noExplore warn:unsolved |
| ox-naive | reach | -46.4 | -47.0 | - | 0.00 | 0.0 | - | 0.840 | -11.3 | - | bad:overestimate bad:unsolved |
| ox-bc-det | reach | -13.2 | -14.1 | - | 0.00 | 0.0 | - | 0.065 | -11.3 | - | warn:unsolved |
| ox-bc-gauss | reach | -16.1 | -16.5 | - | 0.00 | 0.0 | - | 0.110 | -11.3 | - | bad:unsolved |
| ox-td3bc | reach | -19.4 | -18.3 | - | 0.00 | 0.0 | - | 0.200 | -11.3 | - | bad:overestimate bad:unsolved |
| ox-iql | reach | -18.3 | -16.6 | - | 0.00 | 0.0 | - | 0.121 | -11.3 | - | bad:overestimate bad:unsolved |
| ox-cql | reach | -23.5 | -21.2 | - | 0.00 | 0.0 | - | 0.239 | -11.3 | - | bad:unsolved |
| ox-naive-two | reach | -43.8 | -44.0 | - | 0.00 | 0.0 | - | 0.865 | -11.3 | - | bad:overestimate bad:unsolved |
| om-bc-gauss | reach | -34.7 | -35.6 | - | 0.00 | 0.0 | - | 0.564 | -11.3 | - | bad:unsolved |
| om-bc-det | reach | -35.9 | -39.9 | - | 0.00 | 0.0 | - | 0.720 | -11.3 | - | bad:unsolved |
| om-fbc | reach | -25.7 | -25.1 | - | 0.00 | 0.0 | - | 0.347 | -11.3 | - | bad:unsolved |
| om-awr | reach | -32.4 | -36.0 | - | 0.00 | 0.0 | - | 0.574 | -11.3 | - | bad:overestimate bad:unsolved |
| om-iql | reach | -21.7 | -20.7 | - | 0.00 | 0.0 | - | 0.220 | -11.3 | - | bad:unsolved |
| om-cond | reach | -32.7 | -32.7 | - | 0.00 | 0.0 | - | 0.511 | -11.3 | - | warn:overestimate bad:unsolved |
| om-cql | reach | -22.1 | -22.9 | - | 0.00 | 0.0 | - | 0.330 | -11.3 | - | bad:unsolved |
| om-sac | reach | -22.2 | -22.5 | - | 0.00 | 0.0 | - | 0.330 | -11.3 | - | warn:overestimate bad:unsolved |
| om-td3bc | reach | -31.4 | -33.2 | - | 0.00 | 0.0 | - | 0.497 | -11.3 | - | bad:overestimate bad:unsolved |
| fk-gauss | fork | -10.2 | -10.5 | - | 0.48 | 18.4 | - | - | - | - | bad:crash |
| fk-det | fork | -12.9 | -13.9 | - | 0.30 | 24.2 | - | - | - | - | bad:crash |
| fk-flow | fork | -7.8 | -7.8 | - | 0.63 | 13.6 | - | - | - | - | bad:crash |
| fk-gauss-c5 | fork | -20.5 | -20.2 | - | 0.02 | 35.2 | - | - | - | - | bad:crash |
| qp-qavg | fork | -4.1 | -4.2 | - | 0.80 | 7.5 | - | - | - | - | bad:crash |
| qp-best | fork | -0.1 | -0.0 | - | 1.00 | 0.0 | - | - | - | - | ok:solved |
| qp-edit | fork | -0.4 | -0.2 | - | 0.90 | 0.0 | - | - | - | - | bad:overestimate ok:solved |
| qp-qavg-s | fork | -11.5 | -10.4 | - | 0.50 | 18.3 | - | - | - | - | bad:overestimate bad:crash |
| qp-best-s | fork | -0.7 | -0.4 | - | 0.72 | 0.0 | - | - | - | - | warn:unsolved |
| qp-one-s | fork | -9.9 | -8.2 | - | 0.58 | 14.2 | - | - | - | - | bad:overestimate bad:crash |
| rs-sac | reach {payload:2,pickAt:15} | -24.7 | -24.4 | - | 0.00 | 0.0 | - | 0.395 | -13.0 | - | bad:unsolved |
| rs-res-w0 | reach {payload:2,pickAt:15} | -15.2 | -16.2 | - | 0.00 | 0.0 | - | 0.154 | -13.0 | - | bad:vsBase bad:unsolved |
| rs-res-w3 | reach {payload:2,pickAt:15} | -13.6 | -14.8 | - | 0.00 | 0.0 | - | 0.113 | -13.0 | - | bad:vsBase bad:unsolved |
| rs-res-td3-w3 | reach {payload:2,pickAt:15} | -15.0 | -16.4 | - | 0.00 | 0.0 | - | 0.154 | -13.0 | - | bad:vsBase bad:unsolved |
| m-grpo-7 | goalgrid | 1.0 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.000 | bad:emptyGroups ok:solved |
| m-grpo-11 | goalgrid {size:11} | 0.9 | 1.0 | - | 1.00 | 0.0 | - | - | - | 0.002 | bad:emptyGroups ok:solved |
| m-grpo-11-t10 | goalgrid {size:11,maxSteps:10} | 0.8 | 0.8 | - | 1.00 | 0.0 | - | - | - | 0.003 | bad:emptyGroups ok:solved |
| m-grpo-9-t8 | goalgrid {size:9,maxSteps:8} | 0.5 | 0.6 | - | 0.67 | 0.0 | - | - | - | 0.001 | bad:emptyGroups warn:unsolved |
| m-sac-m2 | pendulum {mass:2} | -340.6 | -277.2 | - | 0.00 | 0.0 | - | - | - | - | warn:overestimate warn:unsolved |
| m-sac-m3 | pendulum {mass:3} | -958.2 | -892.6 | - | 0.00 | 0.0 | - | - | - | - | bad:overestimate bad:unsolved |
| m-sac-t1 | pendulum {maxTorque:1} | -351.4 | -283.6 | - | 0.00 | 0.0 | - | - | - | - | warn:overestimate warn:unsolved |
| m-base-l1 | reach {latency:1} | -11.8 | -13.0 | - | 0.00 | 0.0 | - | 0.027 | -13.0 | - | bad:overestimate warn:vsBase ok:solved |
| m-base-l2 | reach {latency:2} | -15.1 | -16.3 | - | 0.00 | 0.0 | - | 0.106 | -16.3 | - | bad:overestimate warn:vsBase bad:unsolved |
| m-base-l3 | reach {latency:3} | -18.1 | -19.4 | - | 0.00 | 0.0 | - | 0.194 | -19.4 | - | bad:overestimate ok:vsBase bad:unsolved |
| m-base-p0 | reach | -10.1 | -11.3 | - | 0.00 | 0.0 | - | 0.010 | -11.3 | - | bad:overestimate warn:vsBase ok:solved |
| m-fk-o02 | fork {obstacle:0.2} | -0.4 | -0.4 | - | 0.97 | 1.1 | - | - | - | - | bad:crash ok:solved |
| m-fk-o03 | fork {obstacle:0.3} | -1.1 | -1.4 | - | 0.92 | 2.8 | - | - | - | - | bad:crash ok:solved |
| m-fk-o01 | fork {obstacle:0.1} | 0.1 | 0.0 | - | 0.98 | 0.5 | - | - | - | - | ok:solved |
| r-p2-sac | reach {payload:2,pickAt:15} | -24.7 | -24.4 | - | 0.00 | 0.0 | - | 0.395 | -13.0 | - | bad:unsolved |
| r-p2-res-w0 | reach {payload:2,pickAt:15} | -15.2 | -16.2 | - | 0.00 | 0.0 | - | 0.154 | -13.0 | - | bad:vsBase bad:unsolved |
| r-p2-res-w3 | reach {payload:2,pickAt:15} | -13.6 | -14.8 | - | 0.00 | 0.0 | - | 0.113 | -13.0 | - | bad:vsBase bad:unsolved |
| r-p2-res-30k | reach {payload:2,pickAt:15} | -13.1 | -14.3 | - | 0.00 | 0.0 | - | 0.098 | -13.0 | - | warn:vsBase warn:unsolved |

## 15 Oct 2026, batch 24: the 16 bandit combinations, and why the bonus conflicts with a fixed share (`exp/tools/banditgrid.js`, `exp/tools/banditwhy.js`)

Question (from the author's page comments, 14:52 and 14:53 CDT): why is "bonus + fixed share" worse than the fixed share
alone, and why does turning every exploration word on give a poor result? Prediction (agent, before the run): the
effects do not add; ε costs late pulls because it never stops.

Settings: level 1 world (10 machines, means from a unit normal, payout noise 1), 200 seeds (i x 101) x 1000 pulls,
hyper of the level (ε = 0.1, α = 0.1, c = 2, optimistic start +5). Metric: share of the last 200 pulls on the best
machine; standard error over seeds. Simulation. Run time: about 3 s on a 16-core ARM cloud server (AWS m7g.4xlarge) for the 16 combinations.

| ε | bonus | start +5 | step | best machine, late pulls |
|---|---|---|---|---|
| | | yes | fixed share | 83.5% ± 2.3 |
| | yes | | average | 82.0% ± 1.6 |
| | yes | yes | average | 82.0% ± 1.6 |
| yes | | yes | average | 78.3% ± 2.2 |
| yes | yes | | average | 78.0% ± 1.3 |
| yes | yes | yes | average | 78.0% ± 1.3 |
| yes | | | average | 77.5% ± 2.2 |
| yes | | | fixed share | 74.4% ± 2.2 |
| yes | | yes | fixed share | 74.3% ± 2.1 |
| | yes | yes | fixed share | 72.4% ± 2.3 |
| | yes | | fixed share | 67.0% ± 2.5 |
| yes | yes | yes | fixed share | 65.3% ± 2.1 |
| | | yes | average | 63.5% ± 3.4 |
| yes | yes | | fixed share | 62.9% ± 2.1 |
| | | | fixed share | 51.4% ± 3.5 |
| | | | average | 35.5% ± 3.4 |

Second probe (`exp/tools/banditwhy.js`, same seeds): final error of the estimate of the best machine is 0.031 with the
average and 0.292 with the fixed share (bonus on in both); the mean gap between the two best machines is 0.473. With the
bonus and the fixed share, 17.2% of late pulls go to the second-best machine (11.3% with the average), and the learner
changes machine less often (0.040 against 0.084 changes per late pull).

Interpretation: the step word interacts with the others. The fixed share adds 16 to 20 points with no bonus and no ε,
and removes 10 to 15 points with the bonus. Supported mechanism: a fixed share keeps only about the last 20 payouts,
so its error stops falling near 0.3, while the bonus c·√(ln t / N) keeps shrinking as if the estimate kept getting
more precise. ε caps late pulls on the best machine at 91% and every combination with ε scored 63 to 78%. With the
bonus and the average the +5 start changes nothing (82.0% both ways): the bonus pulls each machine once first, and an
average forgets the start value after one payout. Not checked: why the fixed share helps plain greedy (35.5% to
51.4%); a likely cause is that 0.1 x the first payout keeps a negative estimate near 0, so untried machines stay
competitive, but no probe tests it.

Page changes from the same comments (version 5): a "Try every combination" panel runs this table for any 1 to 4
words on any world and lists each word change's effect per context; "Watch one update" plays the episode before the
calculation; a discovery counter; Notion snapshots of each discovery.

## 16 Oct 2026, batch 25: what the mirage looks like, and why Expected Sarsa keeps the bias (`exp/tools/mirageshow.js`)

Question (from the author's page comment, 21:03 CDT 15 Oct): the Expected Sarsa card says "It does not fix the mirage".
What is the mirage, and can the page show it? Prediction (agent, before the run): with ε = 0.1 the Expected Sarsa target
is 0.9 × max + 0.1 × mean of the machine estimates, so it keeps most of the upward bias of Q-learning.

Settings: mirage world (10 machines, mean −0.1, noise 1), level hyper (ε = 0.1, α = 0.1, γ = 1), 300 runs (seeds 1 to
300) x 600 steps. Snapshot of the estimates after episode 30 of each run. Simulation. Run time: about 0.4 s per 300 runs.

| Learner | left door, worst point | left door, end | max Q(B) after 30 episodes | mean Q(B) | Q(A, left) (true −0.1) |
|---|---|---|---|---|---|
| Q-learning | 84.2% | 11.4% | +0.106 | −0.048 | +0.098 |
| Expected Sarsa | 78.1% | 10.9% | +0.084 | −0.031 | +0.056 |
| Expected Sarsa, never at random | 65.8% | 0.0% | +0.085 | −0.053 | +0.095 |
| Double Q-learning | 18.3% | 5.8% | +0.046 | −0.008 | +0.002 |

Interpretation: the prediction holds. Expected Sarsa halves the overestimate of the left door after 30 episodes
(+0.056 against +0.098) but still chases it (78% against 84%). Its guess puts weight 1 − ε + ε/10 = 0.91 on the
best-looking machine. Without random actions its target is exactly Q-learning's (+0.095). The same page run in the
browser (new drawer "What is the mirage? Show it") gave 84% and 78%, the same seeds.

Limits: the mean machine estimate after 30 episodes is −0.048, not −0.1, because the estimates start at 0 and each
machine has few payouts. So early on, part of the pull comes from the zero start, not only from the max over noise. The
max of +0.106 is above every start value, so the max over noise is the larger part. At episode 1 the two doors tie at
0, so about half of the runs go left at random.

## 16 Oct 2026, batch 26: what each "next action" word does to the predicted value (`exp/config/b26.json`, `exp/config/b26b.json`, `exp/tools/minwhy.js`)

Question (from the author's page comment, 21:41 CDT 15 Oct): with "the worst next action" the prediction is far too low,
yet the policy still earns a high score. Why? And why do other sentences predict too high or blow up? The answers feed
the new panel "An expert reads this run" (`web/expert.js`). Prediction (agent, before the runs): "worst" learns the value
of "this action, then the worst moves", far too low, but argmax still ranks actions well on CartPole; it fails where the
goal is next to a trap (the cliff).

Settings: page hyper (`C.hyperOf`), seeds 101, 202, ...; cliff 20 runs x 10000 steps, CartPole table 5 x 20000, DQN and
naive network 3 x 20000, mirage 300 x 600. "Gap" = Q at the start minus the discounted return of the greedy test, mean of
the last 30% of training. Simulation. Run time: 13 s for the 17 configs, 10 in parallel on a 16-core ARM cloud server (AWS m7g.4xlarge).

| Sentence | World | Score | Q at start | Earned (discounted) | Gap | Largest abs Q |
|---|---|---|---|---|---|---|
| best next action (Q-learning) | cliff | −13 | −12.2 | −12.2 | 0.0 | 112 |
| action really taken next (Sarsa) | cliff | −82 ± 47 | −20.0 | −40.9 | +21.0 | 150 |
| average next action (Expected Sarsa) | cliff | −15 | −16.0 | −14.0 | −2.0 | 119 |
| worst next action | cliff | −176 ± 22 | −317 | −86.3 | −231 | 633 |
| best, scored by a second estimate (Double Q) | cliff | −105 ± 86 | −71.5 | −50.3 | −21.2 | 273 |
| best, scored by the smaller of two (clipped) | cliff | −98 ± 87 | −67.0 | −47.6 | −19.4 | 256 |
| best / taken / average / worst | CartPole table | 50 / 67 / 50 / 40 | 23 / 23 / 21 / 5 | 37 / 43 / 37 / 29 | −13 / −21 / −16 / −24 | 35 / 38 / 31 / 8 |
| DQN, best next action | CartPole | 148 | 55.0 | 76.3 | −21.3 | 65 |
| DQN, average next action | CartPole | 161 | 53.6 | 82.6 | −29.0 | 62 |
| DQN, worst next action | CartPole | 157 | 10.1 | 81.0 | −70.9 | 21 |
| naive network, best next action | CartPole | 9 | 1.4 M | 9.1 | +1.4 M | 4.7 M |
| naive network, worst next action | CartPole | 27 (2 of 3 learned then forgot, best 129) | 41.7 | 22.5 | +19.2 | 216 |
| best / worst next action | mirage | left door 82% / 7% at the worst point | | | | |

Probes (`exp/logs/minwhy.out`): the fastest fall of the CartPole pole from a start state, with every push chosen to make it
fall, takes 8.73 steps on average (200 starts, exhaustive search), worth 8.4 discounted. DQN with "worst" predicts 10.1
at the start: close to "one good push, then the worst pushes". On the cliff with "worst", the greedy walk spent 76% of its
steps in the top row, and the greedy test reached the goal in 1 of 20 runs.

Frozen-copy refresh (`exp/config/b26b.json`, DQN on CartPole, 3 runs x 20000 steps, 19 501 updates): the target cannot rise
between refreshes, so after K refreshes a value can reach about (1 − 0.99^K) / 0.01. Refresh every 1000 (K = 19, cap
17.4): Q at the start 16.2, score 169. Every 250 (K = 78, cap 54.3): 55.0, score 148. Every 50 (K = 390, cap 98.0):
151, above the 100 any policy can earn, score 118. With "worst" and every 50: the values blew up downward (largest abs Q
4719, Q at the start −300); every 1000: 8.6, score 191.

Interpretation: the prediction holds for "worst". Acting uses only the order of the estimates, so a large, uniform
pessimism costs nothing on CartPole, where the safest push against later bad pushes is also the good push. It fails
on the cliff, where the goal is next to the trap. A second finding was not predicted: with a frozen copy, the predicted
value of DQN is mostly set by the number of refreshes, not by the "next action" word.

Limits: 3 runs per network config; the cap is approximate (the network generalizes, and "every 50" overshoots it). The
table CartPole learner does not solve the task with any word, so its gaps compare unsolved policies.

## Batch 27: Fetch, a dog that learns what the reward pays for (16 Oct 2026)

Question: in a small fetch world (inspired by Huggy from the Hugging Face Deep RL course), which reward parts does a
PPO-like learner game, and which ones are safe? This is the calibration of the bonus level "Fetch!".

Prediction: a per-step bonus for facing the stick, paid also while the dog sits, beats the stick (1, paid once) when it
is large enough, so the dog turns to the stick and sits. "Pay only for getting closer" can be gamed by walking away and
back. Potential-based shaping (Ng, Harada and Russell 1999) cannot be gamed.

Settings: world `fetch` (field [−1, 1]², dog at the thrower, stick thrown 0.5 to 1.2 away, 60 steps, γ = 0.97,
4 actions: walk 0.07, turn ±0.45 rad with a small step, sit). Sentence: 8 episodes per batch, rewards after the action,
a learned V(s) with GAE (λ = 0.95), 4 passes, clip 20%, step size 0.003. 3 seeds (101, 202, 303); final test: 20 throws
per seed. Configs: `exp/config/b27.json`, `exp/config/b27b.json` (made by `exp/tools/b27gen.py`, `exp/tools/b27bgen.py`). Raw results:
`exp/out/b27.json`, `exp/out/b27b.json`. Run time: 1 to 6 s per config (3 seeds in parallel).

| Reward (stick 1, step cost 0.01 unless stated) | Steps | Stick fetched | Reward per test throw |
|---|---|---|---|
| Plain (no shaping) | 10000 / 20000 / 60000 | 98% / 100% / 100% | 0.84 / 0.87 / 0.87 |
| Plain, no step cost | 30000 | 100% | 1.00 |
| Facing bonus 0.01 / 0.02 / 0.03 per step | 30000 | 100% / 100% / 100% | 0.98 / 1.09 / 1.20 |
| Facing bonus 0.05 per step | 10000 / 20000 / 30000 / 60000 | 2% / 0% / 0% / 0% | 2.12 / 2.12 / 2.16 / 2.24 |
| Facing bonus 0.05, no step cost | 30000 / 60000 | 0% / 0% | 2.75 / 2.84 |
| Pay only for getting closer, weight 1 / 2 / 3 | 30000 | 100% / 100% / 100% | 1.55 / 2.24 / 2.92 |
| Potential-based shaping, weight 1 | 10000 / 20000 / 30000 | 100% / 100% / 100% | 1.79 |
| Bring it back (120 steps), plain / potential-based | 60000 | 100% / 100% | 1.19 / 3.16 |
| REINFORCE (4 episodes, 1 pass), plain / facing 0.05 | 30000 | 92% / 73% | 0.73 / 1.68 |

Interpretation: the facing bonus has a sharp threshold between 0.03 and 0.05 per step. Above it, the trained dog turns
to the stick and sits for the whole throw, and more training makes it better at staring (2.12 at 20000 steps, 2.24 at
60000). "Pay only for getting closer" was not gamed in this world: with γ = 0.97 the discounted value of a loop is
below the stick plus the straight path. The loop exists without discounting: `test/fetch.test.js` has a scripted dog
that walks away and back and earns more than the fetching dog (undiscounted, 120 steps, weight 3). The weaker learner
(REINFORCE) still fetched in 73% of throws with the 0.05 bonus; its policy was still much more random (entropy 1.0 nats against
0.25 for PPO at the same budget), so it had not finished converging to the hack.

Limits: 3 seeds per config; one world; the threshold depends on γ, the time limit and the step cost. A 2D dog that turns
and walks is not Huggy, which moves four legs with joint motors (the course trains it with PPO for 2 million steps).
