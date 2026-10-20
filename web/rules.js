// Player-facing world rules. Keep these definitions beside reward contract tests in test/rules.test.js.
// Knob values and evaluation horizons come from the engine; level and mission goals come from CONTENT.
(function () {
  'use strict';
  const RLA = (globalThis.RLA = globalThis.RLA || {});
  const definitions = {
    bandit: (k) => ({
      goal: 'Find the machine with the highest current mean payout.',
      reward: `Each pull pays its machine mean plus Gaussian noise (standard deviation ${k.noise}). Means drift by Gaussian steps of standard deviation ${k.drift} after each pull.`,
      equation: `r = mean(machine) + ${k.noise} × Normal(0, 1)`,
      end: 'One pull ends an episode. Reset keeps the machine means; a new Run creates new machines.',
      score: 'The headline is the percentage of pulls choosing the current best machine in the last 20% of training, averaged across seeds. Reward and regret are separate curves.',
      success: 'Works: choose the best machine on at least 70% of late pulls.'
    }),
    mirage: (k) => ({
      goal: k.mean < 0 ? 'Prefer the right door: its certain zero beats the left door on average.' : k.mean > 0 ? 'The left door has the higher expected payout.' : 'Both doors have the same expected payout.',
      reward: `Right pays 0. Going left pays 0, then any machine pays a Gaussian payout with mean ${k.mean} and standard deviation ${k.noise}.`,
      equation: `r(right) = 0; r(left) = 0; r(machine) = ${k.mean} + ${k.noise} × Normal(0, 1)`,
      end: 'Right ends after one step. Left ends after a machine payout on step two.',
      score: 'The headline is the largest left-door share in the 10–20%, 20–30% and 30–40% episode windows. Each window is averaged across seeds before taking the largest. Lower is better for the default negative mean.',
      success: 'Works: that largest left-door share stays below 25%. This teaching test stays fixed even if you change the payout mean.'
    }),
    cliff: (k) => ({
      goal: 'Reach the goal across the cliff without falling.',
      reward: k.sparseReward ? 'Sparse reward: reaching the goal pays 10; every other step, including a fall, pays 0.' : `Every step costs 1, including the goal step. A fall instead costs ${Math.abs(k.cliffPenalty)} and returns you to the start.`,
      equation: k.sparseReward ? 'r = 10 at goal; 0 otherwise' : `r = ${k.cliffPenalty} on a fall; −1 otherwise`,
      end: 'Reaching the goal ends the episode. Falling resets position but does not end it.',
      score: 'Greedy score is the undiscounted reward sum, averaged over test episodes in the final quarter of training, then across seeds. Falls per episode measures training, including random moves.',
      success: 'Works: greedy score at least −20, or fewer than 0.1 training falls per episode with a peak mean test score at least −20. This test stays fixed with sparse reward.'
    }),
    cartpole: (k) => ({
      goal: 'Keep the pole balanced and the cart on the track.',
      reward: (k.sparseReward ? 'Sparse reward: 1 only for surviving to the episode limit, otherwise 0.' : 'Every step pays 1, including the step that fails.') + ` Gaussian reward noise has standard deviation ${k.rewardNoise}.`,
      equation: (k.sparseReward ? 'r = (1 if time limit reached without falling, else 0)' : 'r = 1') + ` + ${k.rewardNoise} × Normal(0, 1)`,
      end: 'Ends if the cart passes ±2.4 m or the pole passes ±12° from upright.',
      score: 'Greedy score is the undiscounted reward sum, averaged over test episodes in the final quarter of training, then across seeds. With dense reward and no noise it counts survived steps.',
      success: 'Works: mean greedy score at least 100 with no divergence symptom. The test stays fixed with sparse or noisy reward.'
    }),
    pendulum: (k) => ({
      goal: 'Swing the pole up and hold it upright with little motion and motor effort.',
      reward: `Each step uses the angle and speed before moving, and penalizes their squares plus squared applied torque. Angle θ is wrapped to [−π, π] radians; ω is rad/s; τ is N·m, limited to ±${k.maxTorque}. This is not tip height.`,
      equation: 'r = −(θ² + 0.1 × ω² + 0.001 × τ²)',
      end: 'No early success or failure ending. Each step is 0.05 s.',
      score: `Test score is the undiscounted reward sum, averaged over 20 starts per seed, then across seeds. Best possible: 0. Hanging at rest with zero torque: about −${Math.round(Math.PI ** 2 * k.maxSteps)} over ${k.maxSteps} scored steps.`,
      success: 'Works: every seed’s mean over its 20 test starts is −250 or better. Being momentarily upright does not pass the test.'
    }),
    reach: (k) => ({
      goal: `Move the arm tip onto the target and hold it there. Payload: ${k.payload} kg, ${k.pickAt > 0 ? 'arriving at step ' + k.pickAt : 'from the start'}; command latency: ${k.latency} steps.`,
      reward: 'Each step penalizes distance after moving (metres) and the two squared clipped speed commands, before command latency. Commands a₁ and a₂ are between −1 and 1.',
      equation: 'r = −distance − 0.01 × (a₁² + a₂²)',
      end: 'No early success or failure ending. Each step is 0.05 s.',
      score: 'Test score is the undiscounted reward sum averaged over 20 starts per seed, then across seeds. Final distance is measured at the last scored step. Controller comparisons use the same starts.',
      success: 'Works: mean final distance below 0.4 m; if a controller comparison exists, score must also be no more than 2.5 below the controller alone.'
    }),
    fork: (k) => ({
      goal: 'Go around the obstacle and reach the goal at (0, 0.8).',
      reward: `Each step costs 0.05 times distance to goal, plus 0.5 for an obstacle hit and ${k.mud} in left-side mud (x < −0.2 and |y| < 0.6). Reaching the goal adds 1. Distance uses field units.`,
      equation: `r = −0.05 × distance − 0.5 × hit − ${k.mud} × inMud + 1 × reachedGoal`,
      end: 'Ends within 0.08 field units of the goal. An obstacle hit blocks movement but does not end the episode.',
      score: 'The headline is the percentage of 20 test starts per seed reaching the goal, averaged across seeds. Reward curves sum undiscounted step rewards. Hits per test counts all obstacle hits.',
      success: 'Works: at least 80% of tests succeed with fewer than 5 obstacle hits per test.'
    }),
    goalgrid: (k) => ({
      goal: `Reach the goal cell in each new start-and-goal prompt on a ${k.size} × ${k.size} grid${k.wall > 0 ? ', through the wall’s single gap' : ''}.`,
      reward: 'Reaching the goal pays 1 once; every other move pays 0. Bumping a boundary or wall keeps you in place.',
      equation: 'r = 1 at goal; 0 otherwise',
      end: 'Reaching the goal ends the attempt. Reset draws a new start-and-goal prompt.',
      score: 'The headline is the percentage of 20 new test prompts per seed solved, averaged across seeds. The reward curve counts only goals reached inside the scored step window.',
      success: 'Works: solve at least 80% of test prompts. A test can succeed after the scored reward window ends.'
    }),
    fetch: (k) => {
      const shaping = k.shaping === 1 ? `${k.closerW} × max(0, dBefore − dAfter)` : k.shaping === 2 ? `${k.closerW} × (dBefore − 0.97 × dAfterNonterminal)` : '0';
      return {
        goal: k.bringBack > 0 ? 'Get the stick, then carry it back to the thrower.' : 'Get the stick. Extra reward alone does not count as fetching.',
        reward: `Each step costs ${k.timeCost}; turning costs ${k.spinCost}. ${k.bringBack > 0 ? 'Pickup pays ' + k.found / 2 + ', return pays ' + k.found : 'Getting the stick pays ' + k.found}. ` +
          (k.shaping === 1 ? 'Closer reward pays only decreases in target distance.' : k.shaping === 2 ? 'Potential shaping pays decreases and charges increases in target distance, using discount 0.97 and zero terminal potential.' : 'No distance shaping.') +
          ` Facing adds ${k.facingW} × cosine of target bearing, except on pickup. Distances are field units, to the stick or the thrower when carrying.` +
          (k.shaping === 2 ? ' Use the same target before and after each move; dAfterNonterminal is zero on completion, otherwise dAfter.' : ''),
        equation: `r = pickupOrFinish − ${k.timeCost} − ${k.spinCost} × turn + ${k.facingW} × cos(bearing) × notPickup + shaping; shaping = ${shaping}`,
        end: `Ends within 0.09 field units of ${k.bringBack > 0 ? 'the thrower while carrying the stick' : 'the stick'}. Clicking the field starts a new manual throw.`,
        score: 'The headline is the percentage of 20 test throws per seed completed, averaged across seeds. Reward per throw is the undiscounted step sum averaged over those same tests. Manual throws illustrate one policy and do not change the test score.',
        success: 'Works: complete at least 80% of test throws.'
      };
    }
  };

  RLA.gameRules = function (world, knobs, objective) {
    if (!definitions[world]) throw new Error('Missing game rules: ' + world);
    const k = Object.assign(RLA.knobDefaults(world), knobs || {}), W = RLA.worlds[world];
    const rule = definitions[world](k);
    if (world !== 'bandit' && world !== 'mirage') {
      const horizon = Math.max(k.maxSteps, W.evalHorizon || 0);
      rule.end += ` Training limit: ${k.maxSteps} steps${world === 'pendulum' || world === 'reach' ? ' (' + Number((k.maxSteps * 0.05).toFixed(2)) + ' s)' : ''}.`;
      rule.end += horizon > k.maxSteps ? ` Tests can run ${horizon} steps; only the first ${k.maxSteps} steps contribute to reward score. Success and hits count the full test.` : ` Tests use the same ${k.maxSteps}-step limit.`;
    }
    rule.objective = objective || rule.success;
    return rule;
  };
})();
