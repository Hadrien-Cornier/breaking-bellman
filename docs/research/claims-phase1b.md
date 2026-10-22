# Phase 1b claims (sentence builder adds Sarsa, Expected Sarsa, n-step, clipped double Q)

For each claim: verbatim quote (at most 40 words) from the .txt, location, verdict (supported, partly, contradicted, not found).
Sources: docs/research/sources/sb2018.txt (already there). Download td3: Fujimoto, van Hoof, Meger 2018, Addressing Function Approximation Error in Actor-Critic Methods, https://arxiv.org/pdf/1802.09477 -> docs/research/sources/td3.txt (pdftotext -layout).

D1 (sb2018 6.4 and chapter notes): Sarsa is on-policy TD control; its update uses the quintuple (S, A, R, S', A'); the name and origin (Rummery and Niranjan 1994).
D2 (sb2018 6.6): Expected Sarsa uses the expected value over next actions under the policy instead of the sampled next action; it moves deterministically in the direction Sarsa moves in expectation and has lower variance. Origin citation in the notes (van Seijen et al. 2009).
D3 (sb2018 Example 6.6): Sarsa takes the longer, safer path through the upper part of the grid and has better online performance than Q-learning; if epsilon were gradually reduced both would converge to the optimal policy.
D4 (sb2018 chapter 7 intro or 7.1): n-step TD methods span a spectrum between one-step TD and Monte Carlo methods.
D5 (td3): Clipped Double Q-learning takes the minimum of two critics' estimates for the target; the paper motivates it by overestimation bias in actor-critic methods and says it may underestimate, which it prefers to overestimation. Quote the target equation text.
Write docs/research/claims-phase1b.json as an array of {id, verdict, quote, location, source, note}.
