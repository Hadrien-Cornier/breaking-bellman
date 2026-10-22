# Phase 1 claims to check (scout reads, Opus checks)

For each claim: find the text in the source, copy a verbatim quote (at most 40 words), give the page or section, and a verdict: supported, partly supported (say what differs), contradicted, or not found.

Sources (download with curl -L, convert with pdftotext -layout, save the .txt under docs/research/sources/ with the short name):
- sb2018: Sutton and Barto, Reinforcement Learning: An Introduction, 2nd ed., 2018. http://incompleteideas.net/book/RLbook2020.pdf
- dqn2015: Mnih et al., Human-level control through deep reinforcement learning, Nature 2015. https://storage.googleapis.com/deepmind-media/dqn/DQNNaturePaper.pdf
- dqn2013: Mnih et al., Playing Atari with Deep Reinforcement Learning, 2013. https://arxiv.org/pdf/1312.5602
- dq2010: van Hasselt, Double Q-learning, NeurIPS 2010. https://papers.nips.cc/paper_files/paper/2010/file/091d584fced301b442654dd8c23b3fc9-Paper.pdf
- ddqn2016: van Hasselt, Guez, Silver, Deep Reinforcement Learning with Double Q-learning, AAAI 2016. https://arxiv.org/pdf/1509.06461

Claims:
C1 (sb2018, ch. 2.3): On the 10-armed testbed, the greedy method gets stuck on suboptimal actions; epsilon-greedy finds the optimal action more often in the long run. Give the numbers the book gives (share of optimal action) if any.
C2 (sb2018, ch. 2.6): Optimistic initial values (Q1 = +5) encourage exploration on stationary problems, and the book says they are not well suited to nonstationary problems.
C3 (sb2018, ch. 2.5): The sample-average method is not appropriate for nonstationary problems; a constant step-size parameter gives more weight to recent rewards.
C4 (sb2018, ch. 2.7): UCB action selection formula and the citation to Auer, Cesa-Bianchi and Fischer (2002). Quote the formula text.
C5 (sb2018, ch. 6.5): Q-learning is attributed to Watkins (1989); it is an off-policy TD control method that learns q* independent of the policy being followed.
C6 (sb2018, Example 6.6, cliff walking): Q-learning learns the optimal path along the cliff edge but its online performance is worse than Sarsa with epsilon-greedy (epsilon = 0.1), because it sometimes falls off.
C7 (sb2018, Example 6.7 and section 6.7): Maximization bias: in the example with states A and B, Q-learning initially takes the left action far more than optimal; Double Q-learning is much less affected. Give the details of the MDP (rewards, mean -0.1, variance 1, epsilon, alpha, number of actions in B) and the citation for Double Q-learning (van Hasselt 2010).
C8 (sb2018, section 11.3): The deadly triad: function approximation, bootstrapping and off-policy training together give the danger of instability and divergence; any two without the third avoid it.
C9 (dqn2015): DQN uses experience replay and a separate target network that is updated every C steps; the paper gives reasons why nonlinear function approximation with Q-learning is unstable (correlations in the sequence, small updates change the policy and the data distribution, correlations between action values and target values). Quote the reasons. Also: number of Atari games, error clipping to [-1, 1].
C10 (dqn2013): The 2013 version uses experience replay; check whether it has a separate target network (expected: no).
C11 (dq2010): Double Q-learning keeps two estimators, QA and QB; one selects the maximizing action and the other evaluates it; the single-estimator max is biased upward (overestimation).
C12 (ddqn2016): DQN overestimates action values on Atari; Double DQN selects the action with the online network and evaluates it with the target network; it reduces overestimation and gives better scores on several games. Quote the target equation text and the main quantitative result in the abstract or results.
C13 (ddqn2016): The paper shows overestimation grows with the number of actions (lower bound or figure). Quote it.
C14 (sb2018 or dqn2015): Experience replay is attributed to Lin (1992 or 1993). Give the exact citation the source uses.

Write the results to docs/research/claims-phase1.json as an array of {id, verdict, quote, location, source, note}.
