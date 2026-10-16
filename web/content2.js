// Breaking Bellman content, phases 2 to 5: policy gradients, continuous control, offline learning, the robotics frontier.
// It extends window.CONTENT (content.js). Every number quoted here comes from a run logged in EXPERIMENTS.md (Simulation).
(function (C) {
  // ---- words of the policy-gradient sentence (family 'pg'). options: [value, chip text, one-line meaning]
  const pgWords = {
    batch: { q: 'How many episodes before each update?', options: [
      [1, '1 episode', 'Update after every episode.'], [4, '4 episodes', 'Collect 4 episodes, then update once.'],
      [8, '8 episodes', 'Collect 8 episodes, then update.'], [16, '16 episodes', 'Collect 16 episodes, then update.'],
    ] },
    group: { q: 'Do the episodes of a batch share a start?', options: [
      ['none', 'each from its own start', 'Every episode gets a new random start (a new prompt).'],
      ['same', 'all from the same start', 'All episodes of a batch try the same prompt: a group.'],
    ] },
    credit: { q: 'Which rewards push each action?', options: [
      ['total', 'all rewards of the episode', 'Every action gets the return of the whole episode, also the rewards that came before it.'],
      ['togo', 'only the rewards after it', 'An action can only change what happens after it (the reward to go).'],
    ] },
    baseline: { q: 'What do you subtract from the return?', options: [
      ['none', 'nothing', 'The raw return pushes every action.'],
      ['avg', 'a running average of returns', 'Subtract the average return so far: better than usual pushes up, worse pushes down.'],
      ['critic', 'a learned value V(s)', 'A second network (a critic) learns how much each state is worth; subtract it.'],
      ['group', 'the mean of its group', 'Subtract the mean return of the episodes in the same batch.'],
    ] },
    adv: { q: 'How does the critic judge an action?', options: [
      ['mc', 'real return minus V(s)', 'All real rewards that followed, minus the critic\'s value of the state.'],
      ['td', 'one reward plus V(s′), minus V(s)', 'One real reward, then the critic\'s guess for the next state.'],
      ['gae', 'a blend of both (λ = 0.95)', 'A weighted mix of 1, 2, 3, ... real rewards, each followed by a guess.'],
    ] },
    scale: { q: 'Do you divide by the spread?', options: [
      ['none', 'no', 'Use the weights as they are.'],
      ['std', 'yes, by the standard deviation', 'Divide by the spread of the batch (or of the group), so every update has a similar size.'],
    ] },
    ratio: { q: 'How far may one update move the policy?', options: [
      ['plain', 'as far as the gradient says', 'Each pass follows the gradient of probability ratio × weight, with no limit.'],
      ['clip', 'at most 20% change per action', 'When an action\'s probability has already changed by 20% in the helpful direction, stop pushing it.'],
    ] },
    epochs: { q: 'How many passes over each batch?', options: [
      [1, '1 pass', 'Use each batch once.'], [4, '4 passes', 'Reuse each batch 4 times.'], [10, '10 passes', 'Reuse each batch 10 times.'],
    ] },
    lr: { q: 'How large is each step (learning rate)?', options: [
      [0.001, '0.001', 'Small steps.'], [0.003, '0.003', 'The default.'], [0.01, '0.01', 'Large steps.'], [0.03, '0.03', 'Very large steps.'],
    ] },
    bonus: { q: 'Is there a reward for staying random?', options: [
      [0, 'no bonus', 'Only the return counts.'],
      [0.01, 'a small entropy bonus', 'Adds 0.01 × entropy: the policy is paid a little for keeping its choices open.'],
    ] },
  };
  const pgBase = { family: 'pg', batch: 4, group: 'none', credit: 'togo', baseline: 'none', adv: 'gae', scale: 'none', ratio: 'plain', epochs: 1, lr: 0.003, bonus: 0 };

  // ---- words of the actor-critic sentence (family 'ac'), for continuous actions
  const acWords = {
    source: { q: 'Where do the experiences come from?', options: [
      ['own', 'its own tries', 'It acts, stores what happened in a memory and learns from random batches of it.'],
      ['fixed', 'a fixed dataset only', 'Offline: a dataset recorded by someone else. No new tries, ever.'],
      ['both', 'a dataset first, then its own tries', 'It learns from the dataset first, then keeps learning while it acts. Batches mix both halves.'],
    ] },
    demos: { q: 'What is in the dataset?', options: [
      ['expert', 'a good controller, small noise', '100 episodes of a good controller with noise 0.1 on each command.'],
      ['mixed', 'half good, half random', '50 episodes of the good controller and 50 episodes of random commands.'],
      ['noisy', 'a good controller, large noise', '100 episodes of the good controller with noise 0.8 on each command.'],
    ] },
    base: { q: 'Does the policy act alone?', options: [
      ['none', 'alone', 'The policy gives the whole command.'],
      ['classical', 'as a correction to the classical controller', 'The command is the classical controller\'s command plus 0.5 × the policy\'s output.'],
    ] },
    head: { q: 'What does the policy output?', options: [
      ['det', 'one action', 'One command per state. While learning, small random noise is added.'],
      ['gauss', 'a bell curve of actions', 'A Gaussian: a mean command and a spread. It samples from it.'],
      ['flow', 'noise turned into an action', 'Starts from random noise and moves it in 10 small learned steps to a command (flow matching). It can make two different answers for one state.'],
    ] },
    chunk: { q: 'How many commands per decision?', options: [
      [1, '1 command', 'Decide again at every step.'],
      [3, '3 commands', 'Output the next 3 commands at once, then play them without looking.'],
      [5, '5 commands', 'Output the next 5 commands at once, then play them without looking.'],
      [10, '10 commands', 'Output the next 10 commands at once, then play them without looking.'],
    ] },
    aim: { q: 'How does the policy learn?', options: [
      ['q', 'climb the critic', 'Change the action in the direction where the critic\'s value Q(s, a) goes up.'],
      ['qclose', 'climb the critic, stay near the data', 'Climb the critic, plus a penalty for moving away from the action in the data.'],
      ['copy', 'copy the actions in memory', 'Imitation (behavior cloning): make the actions in memory more likely.'],
      ['copybest', 'copy only the best episodes', 'Imitate only the episodes in the top 25% by return.'],
      ['weighted', 'copy, weighted by how much better', 'Imitate every action, with weight exp(advantage): better than usual counts much more.'],
      ['cond', 'copy, told which actions were better', 'Imitate every action, with an extra input that says "better than usual" or not. When it acts, the input says "better".'],
      ['none', 'do not learn (frozen)', 'The policy never changes after the dataset phase.'],
    ] },
    critics: { q: 'How many critics?', options: [
      ['none', 'no critic', 'Nothing estimates values.'],
      ['one', 'one critic Q(s, a)', 'A network learns the value of an action in a state.'],
      ['two', 'two critics, use the smaller', 'Two independent critics; every target uses the smaller of their two values.'],
    ] },
    target: { q: 'Which critic makes the target?', options: [
      ['live', 'the live critic', 'The target uses the critic that is being trained.'],
      ['slow', 'a slow copy', 'The target uses a copy that moves only 0.5% of the way to the live critic after each update.'],
    ] },
    next: { q: 'Which next action goes into the target?', options: [
      ['policy', 'the policy\'s next action', 'y = r + γ · Q(s′, the action the policy would take in s′).'],
      ['smooth', 'the policy\'s next action plus noise', 'Adds clipped noise to that next action, so a sharp lucky peak of the critic counts less.'],
      ['expectile', 'no action: a high average of the data', 'y = r + γ · V(s′). V learns a high expectile (τ = 0.7) of the critic\'s values for the actions in the data. No unseen action is ever asked about.'],
      ['data', 'the action taken next in memory', 'y = r + γ · Q(s′, a′), with a′ the action really taken next in the stored episode (as in Sarsa). No new action is asked about.'],
    ] },
    penalty: { q: 'Push down actions the data never took?', options: [
      ['none', 'no penalty for unseen actions', 'The critic learns only from the targets.'],
      ['cql', 'push down actions the data never took', 'Also push down the critic\'s values of random and policy actions, and push up the values of the data\'s actions.'],
    ] },
    delay: { q: 'How many critic updates per policy update?', options: [
      [1, '1', 'Update the policy after every critic update.'], [2, '2', 'Update the policy after every second critic update.'],
    ] },
    entropy: { q: 'Is there a reward for staying random?', options: [
      ['none', 'no bonus', 'Only the critic\'s value counts.'],
      ['fixed', 'a fixed bonus (α = 0.2)', 'Adds 0.2 × entropy to the value: random choices are worth a little.'],
      ['auto', 'a bonus tuned to a target randomness', 'α adjusts itself so that the policy keeps a set amount of randomness.'],
    ] },
    wait: { q: 'Does the policy wait for the critic?', options: [
      [0, 'no, it learns from the first update', 'The policy climbs the critic from the first update, while the critic is still a guess.'],
      [3000, 'yes, 3000 critic updates first', 'Only the critic learns for the first 3000 updates; then the policy starts to change (a "burn-in").'],
    ] },
    pick: { q: 'How is the action chosen?', options: [
      ['one', 'one sample from the policy', 'Ask the policy once.'],
      ['best', 'the best of 8 samples, by the critic', 'Ask the policy 8 times; play the sample with the highest critic value.'],
      ['qavg', 'the average of 8 samples, weighted by the critic', 'Ask 8 times; play the average, each sample weighted by exp(Q).'],
      ['edit', 'the best of 8 samples and 8 small edits', 'Ask 8 times; a small second policy proposes a small change to each; play the best of the 16 by the critic.'],
    ] },
  };
  const acBase = { family: 'ac', source: 'own', demos: 'mixed', base: 'none', head: 'gauss', chunk: 1, aim: 'q', critics: 'two', target: 'slow', next: 'policy', penalty: 'none', delay: 1, entropy: 'auto', pick: 'one', wait: 0 };

  // ---- families: the value family is phase 1
  const valueKeys = Object.keys(C.words);
  C.families = {
    value: { name: 'Value learning', keys: valueKeys, base: Object.assign({}, C.base), worlds: ['bandit', 'cliff', 'cartpole', 'mirage'] },
    pg: { name: 'Policy gradient', keys: Object.keys(pgWords), base: pgBase, worlds: ['cartpole', 'goalgrid', 'pendulum'] },
    ac: { name: 'Actor-critic, continuous actions', keys: Object.keys(acWords), base: acBase, worlds: ['pendulum', 'reach', 'fork'] },
  };
  Object.assign(C.words, pgWords, acWords);
  const valueCfg = C.cfg;
  C.cfg = (o) => {
    o = o || {};
    const f = o.family || 'value';
    if (f === 'value') { const v = valueCfg(o); delete v.family; return v; }
    return Object.assign({}, C.families[f].base, o, { family: f });
  };
  C.famOf = (p) => (p && p.family) || 'value';

  Object.assign(C.worldNames, { goalgrid: 'Goal grid', pendulum: 'Pendulum swing-up', reach: 'Arm reach', fork: 'Fork in the road' });
  Object.assign(C.budgets, { goalgrid: [30000, 60000], pendulum: [6000, 10000, 15000], reach: [4000, 8000, 15000], fork: [3000, 6000] });
  Object.assign(C.budgetDefault, { goalgrid: 1, pendulum: 1, reach: 1, fork: 1 });
  Object.assign(C.seedOptions, { goalgrid: [1, 3, 5], pendulum: [1, 3, 5], reach: [1, 3, 5], fork: [1, 3, 5] });
  // hyper-parameters per family and world ("family:world" first, then the world)
  C.hyperOf = (p, world) => Object.assign({}, C.hyper[world] || {}, C.hyper[C.famOf(p) + ':' + world] || {});
  // budgets per family and world (offline steps are gradient updates)
  C.budgetsOf = (p, world) => C.budgets[C.famOf(p) + ':' + world] || C.budgets[world];
  Object.assign(C.budgets, { 'pg:cartpole': [20000, 40000], 'pg:pendulum': [20000, 50000] });
})(window.CONTENT);
