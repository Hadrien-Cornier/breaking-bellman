// Bonus level: Fetch. A dog learns to get a thrown stick, inspired by Huggy from the Hugging Face Deep RL course.
// The repair is the reward, not the learner. Every number below was measured in Node with the page's engine
// (docs/EXPERIMENTS.md, batch 27: exp/out/b27.json and exp/out/b27b.json; 3 seeds, the PPO-like sentence below). Simulation.
(function (C) {
  'use strict';
  const o = (steps, result, correct, why) => ({ steps, result, correct: !!correct, why });
  const ppo = C.cfg({ family: 'pg', batch: 8, group: 'none', credit: 'togo', baseline: 'critic', adv: 'gae', scale: 'none', ratio: 'clip', epochs: 4, lr: 0.003, bonus: 0 });
  const M = { // batch 27
    hack20: { succ: 0, ret: 2.12 }, hack60: { succ: 0, ret: 2.24 }, plain20: { succ: 100, ret: 0.87 },
    face01: 100, face02: 100, face03: 100, pbrs10: 100, plain10: 98, closer: 100, reinforceHack: 73, back60: 100,
  };
  const NG = 'Ng, Harada and Russell (1999), Policy Invariance Under Reward Transformations: Theory and Application to Reward Shaping, ICML';

  C.phases.push({ n: 6, title: 'Bonus: reward design (a dog that fetches)' });
  C.rewardMethods = ['pbrs'];

  Object.assign(C.cards, {
    rewardhack: { kind: 'failure', name: 'Reward hacking', short: 'Reward hacking', status: 'checked',
      paper: NG + ', section 1 (the bicycle that rides in circles, the robot that vibrates next to the ball).',
      fixes: 'The learner maximizes the reward you wrote, not the behavior you meant. A bonus meant to help (face the stick) became the goal: the dog turns to the stick and sits.',
      stillWrong: `Facing bonus 0.05 per step: the dog got the stick in ${M.hack20.succ}% of test throws and earned about ${M.hack20.ret} per throw, against 1 for the stick (PPO, 3 seeds, 20000 steps). At 0.03 per step it fetched in ${M.face03}% of throws. Simulation.`,
      evidence: '<p>Ng, Harada and Russell (1999), section 1: Randløv and Alstrøm\'s bicycle agent, rewarded for progress toward the goal, “learned to ride in tiny circles near the start state because no penalty was incurred for riding away from the goal.” A soccer robot rewarded for touching the ball “remained next to the ball and vibrated”.</p>' },
    pbrs: { name: 'Potential-based reward shaping', short: 'Shaping', status: 'checked',
      paper: NG + ', Theorem 1.',
      fixes: 'Add γ·Φ(next state) − Φ(state) to the reward, for some function Φ of the state (here Φ = −distance to the stick). Along any path the extra terms cancel in pairs and leave γ<sup>T</sup>·Φ(end) − Φ(start), so a loop earns nothing extra and the best policy stays the same.',
      stillWrong: `You must choose Φ, and a poor Φ can slow learning. In this small field the plain reward learned almost as fast: ${M.plain10}% of throws fetched after 10000 steps, against ${M.pbrs10}% with shaping. Simulation.`,
      evidence: '<p>Theorem 1: F being potential-based “is a necessary and sufficient condition to guarantee consistency with the optimal policy”. Necessary: for any other F there exist transitions and a reward such that no optimal policy of the shaped task is optimal in the original one.</p>' },
  });
  C.paperLinks = C.paperLinks || {};
  const ngLink = { t: 'Ng, Harada and Russell (1999)', u: 'https://people.eecs.berkeley.edu/~russell/papers/icml99-shaping.pdf' };
  const huggy = { t: 'Huggy, Hugging Face Deep RL course', u: 'https://huggingface.co/learn/deep-rl-course/unitbonus1/introduction' };
  C.paperLinks.rewardhack = [ngLink, huggy];
  C.paperLinks.pbrs = [ngLink];

  C.failures.push({ card: 'rewardhack', when: (a, c) => c.world === 'fetch' && a.symptoms.some((s) => s.id === 'hack') });
  // a reward method is found when its reward works (C.knobFinds is checked after each run, like the failures)
  C.knobFinds = (C.knobFinds || []).concat([{ card: 'pbrs', when: (a, c) => c.world === 'fetch' && c.knobs.shaping === 2 && a.summary.successRate >= 0.8 }]);

  C.levels.push({
    id: 'fetch', phase: 6, world: 'fetch', title: 'Fetch!', seeds: 3, steps: 20000,
    knobs: { facingW: 0.05 }, start: ppo, focus: [], repairKnobs: ['facingW', 'shaping', 'closerW', 'timeCost', 'found'],
    intro: 'A dog, a field and a stick. Each throw, the dog must get the stick. It sees where the stick is from its own point of view, and it can walk, turn left, turn right or sit. The learner is the PPO sentence from phase 2, the same algorithm that trains Huggy in the Hugging Face Deep RL course (there for 2 million steps; here for 20000 steps, about 2 seconds). This time you do not change the learner. You change the reward. The reward: 1 for the stick, −0.01 for each step, and a small bonus, 0.05 for each step the dog faces the stick, to help it learn to look first.',
    predict: { id: 'fetch-p', prompt: 'The stick pays 1 and ends the throw. Each step costs 0.01. Each step the dog faces the stick pays 0.05. What does the trained dog do?', options: [
      o(['The bonus points the dog at the stick.', 'A dog that faces the stick walks to it sooner.', 'So it fetches faster than without the bonus.'], 'It fetches faster.', 0,
        `<b>Wrong at step 3.</b> Measured: it got the stick in ${M.hack20.succ}% of test throws (3 seeds). Without the bonus: ${M.plain20.succ}%.`),
      o(['Getting the stick ends the throw, and the bonus with it.', 'Sitting and facing the stick pays 0.05 every step, until the time limit.', 'Over a throw, that adds up to more than the stick.'], 'It turns to the stick and sits.', 1,
        `Measured: ${M.hack20.succ}% of test throws fetched, and each throw paid about ${M.hack20.ret} reward against 1 for the stick (3 seeds, Simulation).`),
      o(['The bonus changes each time the dog turns.', 'So the dog learns to turn.', 'It spins in place.'], 'It spins.', 0,
        '<b>Wrong at step 2.</b> Turning moves the nose away from the stick, which lowers the bonus. The dog that wins the bonus keeps still.'),
    ] },
    runText: 'Run the PPO sentence with this reward: 3 seeds of 20000 steps, about 2 seconds. Then watch the dog on the field.',
    diagnose: { id: 'fetch-d', prompt: `The dog sits and stares at the stick. Each throw pays it about ${M.hack20.ret}, more than the stick is worth. Where does the reward come from?`, options: [
      o(['The facing bonus is paid every step, also while the dog sits.', 'The stick pays 1 once, and then the throw ends.', 'The learner maximizes the total reward, so it keeps the stream of small bonuses.'], 'The bonus pays for staring, not for fetching.', 1,
        'This is <b>reward hacking</b>: the learner does what the reward pays for, not what you meant. Ng, Harada and Russell (1999) open with two cases: a bicycle that rode in tiny circles, and a soccer robot that vibrated next to the ball.'),
      o(['The network has only 2 layers.', 'It is too small to learn to walk to a point.', 'So it gives up and sits.'], 'The network is too small.', 0,
        `<b>Wrong at step 2.</b> The same network and the same PPO, with the bonus removed, fetched in ${M.plain20.succ}% of throws.`),
      o(['PPO clips each update.', 'So it learns too slowly to reach the stick in 20000 steps.', 'With more steps it would fetch.'], 'Too few steps.', 0,
        `<b>Wrong at step 3.</b> With 60000 steps it still fetched in ${M.hack60.succ}% of throws, and earned more per throw (${M.hack60.ret}): more training made it better at staring.`),
    ] },
    repairText: 'Change the reward, not the learner. Use the reward controls below, then run. Several rewards work.',
    hint: 'Ask what the dog can earn without the stick. A reward for getting closer can be safe or unsafe, depending on how it is paid.',
    goal: { text: 'the dog must get the stick in 80% of test throws or more.', test: (a) => a.summary.successRate >= 0.8 },
    notes: [
      { when: (a, p, k) => k && k.shaping === 1, text: () => `“Pay only for getting closer” fetched here (${M.closer}% with weights 1, 2 and 3, Simulation), but it can be gamed: walking away is free and coming back pays again. With the discount 0.97 of this world, the stick still paid more. The test file test/fetch.test.js shows a scripted dog that walks away and back and beats the fetching dog when rewards are not discounted. This is the bicycle that rode in circles.` },
      { when: (a, p, k) => k && k.facingW > 0 && k.facingW <= 0.03, text: () => `A smaller facing bonus did no harm here (0.01, 0.02 and 0.03 per step: ${M.face03}% of throws fetched). The same idea at 0.05 took over. A safe size depends on the world, so you can only find it by testing.` },
    ],
    explain: { id: 'fetch-x', prompt: 'Potential-based shaping adds γ·Φ(next) − Φ(now), with Φ = −(distance to the stick). Why can no loop game it?', options: [
      o(['Along any path, each Φ term appears once with + and once with −.', 'The sum keeps only γ<sup>T</sup>·Φ(end) − Φ(start).', 'A loop that comes back to the same place adds nothing, so the best policy stays the same.'], 'The terms telescope.', 1,
        'Ng, Harada and Russell (1999), Theorem 1: shaping of this form keeps the optimal policy. Any other form can change the best policy in some world.'),
      o(['The shaping reward is small.', 'Small rewards cannot be gamed.', 'So the dog ignores it.'], 'It is small.', 0,
        '<b>Wrong at step 2.</b> Size is not the point. A facing bonus of 0.03 did no harm and 0.05 took over. Potential-based shaping keeps the best policy at any weight.'),
      o(['The shaping is paid only when the dog moves.', 'A dog that sits earns nothing.', 'So sitting is never rewarded.'], 'It needs movement.', 0,
        '<b>Wrong at step 3.</b> A sitting dog earns γ·Φ − Φ = −(1 − γ)·Φ each step, which is not zero. The safety comes from the sum over a path, not from one step.'),
    ] },
    soWhat: 'Every robot reward is a guess at what you want. A bonus for “the gripper is near the object” can teach the arm to hover near it. Write the shaping as a difference of a potential, or test the trained policy on the real goal, not on the reward.',
    cannotTeach: 'Legs, joints and real physics. Huggy moves its legs with joint motors; this dog only turns and walks. Also: a goal you cannot write down as a number.',
  });
})(window.CONTENT);
