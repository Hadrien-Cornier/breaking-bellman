// Presentation copy lives outside the byte-versioned Fast simulation content.
// Only display fields belong here; simulation settings remain in the content modules.
(function () {
  const C = window.CONTENT;
  const copy = {
    "levels": {
      "skills": {
        "intro": "Teach two skills to reach different rooms. Each skill earns more when its destination makes it easy to tell which skill was used.",
        "introMore": "Red and blue each take one action from the start. West enters the west room. East enters the east room. A smoothed count of those visits is q(skill|room). The reward is log q minus log of a uniform prior. A softmax policy then takes gradient steps on that reward."
      },
      "elbo": {
        "intro": "Work out what caused a bright sensor reading. Compare your guess with three possible causes: the hall, the lamp and glare.",
        "introMore": "A prior is the probability before the reading; a likelihood says how often each cause produces bright. The guess q assigns a probability to each cause."
      },
      "slots": {
        "intro": "You have 1000 pulls to find the best of ten slot machines. A machine’s payout varies from pull to pull, so one lucky result can make a poor choice look promising.",
        "introMore": "Each hidden average is drawn from a normal distribution N(0, 1), and the noise on a payout has standard deviation 1. The learner is greedy: it never picks a machine at random.",
        "learner": "The learner keeps the average payout of each machine and always pulls the machine with the best average (greedy). All averages start at 0."
      },
      "cliff": {
        "intro": "Reach the flag without falling off the cliff. Each move costs 1 point. A fall costs 100 and returns you to START.",
        "introMore": "The grid is 4 rows by 12 columns: start at bottom left, flag at bottom right, and the bottom row between them is the cliff. An episode stops at the flag or after 200 steps. The setup is Example 6.6 in Sutton and Barto (2018), which is undiscounted; here γ = 0.99.",
        "learner": "The learner keeps a table of estimates and takes a random move 10% of the time (ε = 0.1). It waits until the episode ends, then moves each estimate toward the full return: the sum of the rewards that followed."
      },
      "careful": {
        "intro": "Q-learning found the 13-step path along the cliff edge, and it still takes a random move 10% of the time while it learns. On a real arm every fall while learning is a real crash.",
        "introMore": "Measured in this page: 0.32 falls per episode in the second half of training. The learner is Q-learning with random tries (ε = 0.1)."
      },
      "cells": {
        "intro": "Keep the pole up: push the cart left or right. Every step the pole stays up pays +1, and the episode ends when the pole falls or after 200 steps.",
        "introMore": "The 4 sensors are cart position, cart speed, pole angle and pole speed. Budget: 20000 steps.",
        "learner": "The learner keeps a table: each of the 4 sensor numbers is cut into 6 bins, so 6⁴ = 1296 cells, each with its own two estimates."
      },
      "explode": {
        "intro": "You swapped the table for a network, and the values run away: the largest estimate reaches the millions, though no policy can earn more than 100 here.",
        "introMore": "CartPole pays +1 per step with γ = 0.99, so no policy can earn more than 1 / (1 − 0.99) = 100."
      },
      "mirage": {
        "intro": "Choose between two doors. The right door pays nothing; the left leads to machines that lose points on average. A lucky payout can still make the losing route look better.",
        "introMore": "Each machine pays a random amount with mean −0.1 and standard deviation 1, then the episode ends. This is the setup of Example 6.7 in Sutton and Barto (2018); the book says “many” actions in the second state, this page uses 10.",
        "learner": "The learner is Q-learning with random tries (ε = 0.1) and step size 0.1, with no discount."
      },
      "credit": {
        "intro": "Keep the pole up by pushing the cart left or right, now for up to 500 steps. This time the learner changes its action probabilities directly.",
        "introMore": "A new idea: do not estimate values, change the policy itself. The policy is a network that gives a probability to each action. This is a policy gradient. CartPole again, now with a 500-step limit. Budget: 15000 steps, 1 episode per update, step size 0.003. The actions are left and right.",
        "learner": "After each episode, the learner makes every action of that episode more likely, in proportion to the return: good episodes push their actions more."
      },
      "bigsteps": {
        "intro": "Each episode costs real time, so reuse it: collect 8 episodes, then do 10 passes of updates on that batch.",
        "introMore": "Step size 0.03. Budget: 40000 steps.",
        "learner": "A critic V(s) judges each action (actor-critic), with a blend of 1, 2, 3, ... real rewards (GAE, λ = 0.95)."
      },
      "passfail": {
        "intro": "Reach the flag within 14 moves. Each attempt starts somewhere new, and you earn a point only if you reach its goal.",
        "introMore": "The grid is 7 by 7; each prompt allows 14 moves. Budget: 60000 moves. No discount (γ = 1).",
        "learner": "The learner is PPO from the last level: a critic, GAE, the 20% limit, 4 passes."
      },
      "continuous": {
        "intro": "Pendulum: swing the pole up and hold it. The action is a torque, a real number between −2 and 2. The motor is too weak to lift the pole straight up, so it must swing.",
        "introMore": "Here the target uses the live critic. Budget: 10000 steps.",
        "learner": "A max over actions does not work for a real number. The idea of DDPG: a policy network outputs one torque and moves toward higher critic values (the critic’s slope). The critic learns Q(s, a) toward r + γ·Q(s′, policy(s′))."
      },
      "explore": {
        "intro": "A policy can also output a bell curve (a Gaussian) of torques: a mean and a spread. It samples its tries from it. Swing the pole up and hold it.",
        "learner": "The start sentence has two critics, slow copies, a Gaussian policy that climbs the smaller critic, and no reward for staying random."
      },
      "offline": {
        "intro": "Move the arm’s tip to a target and hold it there. Learn only from recorded attempts, with no new tries.",
        "introMore": "A 2-joint arm in a vertical plane, like two joints of a desk robot arm. Put the tip on a random target and hold it. Each action is a pair of joint-speed commands. Now there are no new tries: this is offline learning. The arm is the 2-joint setup of a desk robot arm such as the SO-101. Budget: 8000 updates.",
        "learner": "You get 100 episodes from a good classical controller (with small noise 0.1 on each command), and that is all. The start sentence is DDPG trained on the dataset only."
      },
      "mixed": {
        "intro": "Move the arm’s tip to the target using recordings that mix successful attempts with random movements. Copying every attempt also copies the mistakes.",
        "learner": "The start sentence copies everything with a Gaussian policy."
      },
      "twoways": {
        "intro": "Drive around the obstacle to the goal. Copy demonstrations that go left and right, 50 each way.",
        "introMore": "A point robot drives from its home pose at the bottom to a goal at the top. An obstacle sits in the middle. The demonstrator goes around it, left and right in turn: 50 demonstrations each way. Copy them. All demonstrations start from the same home pose. Budget: 6000 updates (step size 0.003, batches of 128).",
        "learner": "Like π0 (50 commands) and ACT (100), the policy outputs a chunk of 10 commands at a time, and the robot plays them without looking."
      },
      "pick": {
        "intro": "Reach the goal while avoiding the mud on the left. The recorded examples take both routes, even though crossing the mud costs extra.",
        "introMore": "The critic learns first from the dataset (8000 updates), then from 4000 steps of the robot’s own tries. The start plays one proposal of the flow policy. About 1.5 minutes.",
        "learner": "Keep the flow policy frozen, as in Q-planning (2026). Only a critic learns: first from the dataset, then from the robot’s own tries. Its target uses the action taken next in memory (as in Sarsa), so it never asks about a new action."
      },
      "residual": {
        "intro": "Keep the arm on target when it picks up a heavy part. Its existing controller reaches well but sags under the extra weight.",
        "introMore": "The classical controller is Jacobian transpose with gain 12: a = 12 Jᵀ(target − tip). Budget: 15000 steps, about 12 minutes of arm time at 20 Hz.",
        "learner": "The start sentence is SAC learning from scratch, on its own tries."
      },
      "fetch": {
        "intro": "Teach the dog to fetch the stick. It can walk, turn or sit. Keep the learner fixed and change what earns a reward.",
        "introMore": "A dog, a field and a stick. Each throw, the dog must get the stick. It sees where the stick is from its own point of view, and it can walk, turn left, turn right or sit. This time you do not change the learner. You change the reward. The reward: 1 for the stick, −0.01 for each step, and a small bonus, 0.05 for each step the dog faces the stick, to help it learn to look first. The same algorithm trains Huggy in the Hugging Face Deep RL course (there for 2 million steps; here for 20000 steps, about 2 seconds).",
        "learner": "The learner is the PPO sentence from phase 2, and it stays fixed for this level."
      }
    },
    "cards": {
      "lockin": {
        "plain": "The learner sticks to the first choice that looked good and never tries the others again."
      },
      "egreedy": {
        "plain": "Now and then take a random action instead of the best-looking one, so every option keeps being tried."
      },
      "optimism": {
        "plain": "Start every estimate high, so untried options look worth trying until they disappoint."
      },
      "ucb": {
        "plain": "Add a bonus for uncertainty, so promising options with fewer tries get another chance."
      },
      "mc": {
        "plain": "Wait for the episode to end, then learn from the whole score that followed."
      },
      "noend": {
        "plain": "The lesson arrives only at the end of the episode, and here the episode never reaches the goal."
      },
      "qlearning": {
        "plain": "Learn after each step using the estimated value of the best next action."
      },
      "sarsa": {
        "plain": "Learn after every step from the action really taken next, random tries included."
      },
      "expsarsa": {
        "plain": "Like Sarsa, but the guess averages over all the next actions."
      },
      "nstep": {
        "plain": "Use n real rewards, then one guess."
      },
      "triad": {
        "plain": "A network, guesses about the future and off-policy training together can make the values run away."
      },
      "dqn": {
        "plain": "A network for the estimates, held steady by random old moves and a frozen copy."
      },
      "maxbias": {
        "plain": "Taking the best-looking estimate makes the learner chase options that only look good."
      },
      "doubleq": {
        "plain": "One estimate picks the next action; a second estimate, trained on other updates, scores it."
      },
      "ddqn": {
        "plain": "The live network picks the next action; the frozen copy scores it."
      },
      "clipped": {
        "plain": "Ask two estimates and keep the lower answer."
      }
    }
  };
  // Briefing purposes are presentation only, outside the simulation fingerprints.
  C.learningPurpose = {
    goals: 'You will compare copying moves with and without knowing the requested destination.',
    slots: 'You will learn why the learner needs to keep trying machines it has overlooked.',
    cliff: 'You will compare waiting for a whole attempt to finish with learning after each move.',
    careful: 'You will learn how accounting for random moves can favor a safer route.',
    cells: 'You will see why dividing sensor readings into separate cells can make learning slow.',
    explode: 'You will investigate why learning from estimates can become unstable with a network.',
    mirage: 'You will see how choosing the largest noisy estimate can favor the losing door.',
    credit: 'You will learn why improving action probabilities from whole attempts can give a noisy learning signal.',
    bigsteps: 'You will see why repeatedly learning from the same attempts can change a policy too far.',
    passfail: 'You will compare attempts at the same task to learn from a simple success or failure score.',
    continuous: 'You will learn how a policy chooses a motor command when the choices form a continuous range.',
    explore: 'You will test whether rewarding variety helps the learner keep searching for better movements.',
    offline: 'You will see why estimates for actions absent from the recordings can mislead the learner.',
    mixed: 'You will compare ways to favor better examples in a mixed collection of attempts.',
    twoways: 'You will see why averaging two good routes can produce a route that hits the obstacle.',
    pick: 'You will use a learned score to choose among proposals from an unchanged policy.',
    residual: 'You will compare learning from scratch with learning a correction to the existing controller.',
    fetch: 'You will see how a helpful-looking reward can distract the dog from the actual task.',
    vpo: 'You will compare the routes available when different kinds of reward stay separate.',
    supermimic: 'You will test whether a policy that scores well in a learned model also works in the actual environment.',
    thaw: 'You will compare reusing a policy with adapting it through a little fresh practice.',
    rewardfit: 'You will investigate what a reward fitted from demonstrations can and cannot infer.',
    rare: 'You will test whether rewarding unfamiliar visits helps the learner discover the door.',
    elbo: 'You will compare a guess about the hidden cause with the probabilities implied by the sensor reading.',
    messages: 'You will see how information about a future goal can change a choice made now.',
    hindsight: 'You will learn how a failed attempt can still teach the learner about a goal it did reach.',
    hierarchy: 'You will see why repeating a short skill may fail to reach a more distant goal.',
    skills: 'You will learn how rewarding distinguishable outcomes can give two skills different behaviors.',
    skew: 'You will see why changing goal weights cannot supply experience that is missing from the recordings.',
    metarl: 'You will compare a fixed choice with a choice that uses what the previous attempt revealed.',
    ensemble: 'You will see how disagreement between estimates can warn against an unreliable choice.',
    replan: 'You will compare following a complete plan with making a new plan after each move.',
  };
  for (const level of C.levels) {
    if (copy.levels[level.id]) Object.assign(level, copy.levels[level.id]);
  }
  for (const [id, fields] of Object.entries(copy.cards)) Object.assign(C.cards[id], fields);
})();
