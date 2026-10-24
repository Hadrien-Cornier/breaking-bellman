// Breaking Bellman algorithm reminders.
// One consistent content source per algorithm name. Whenever a name renders (level prose,
// questions, method labels, Codex and the family tree) it offers a short reminder: the expanded
// name, one line of idea, and the defining math with the symbols spelled out. The reminder opens
// only on a deliberate action: click, tap or keyboard activation (Enter or Space). Hovering the
// pointer or moving focus never opens it. It dismisses with accessible semantics: an explicit
// close button, Escape, or a click outside.
// The reminder never states the game's word recipe, so it cannot leak an undiscovered solution.
(function (root) {
  // ---------------------------------------------------------------- one content source per name
  // label: the expanded name shown as the reminder title.
  // re:    RegExp list that matches the name where it renders (longest form first is enough; the
  //        matcher keeps the longest match at each position and drops the ones it overlaps).
  // idea:  one short sentence of general idea.
  // math:  the defining math. One common form is shown, never as the only possible variant.
  // symbols: [symbol, meaning] pairs for every symbol in the math line.
  // The math is written to be faithful to the cited papers. Where a paper defines a family rather
  // than one equation, the line says so ("one common form", "the target takes", "often").

  const F = (lit) => new RegExp('(?<![A-Za-z0-9])' + lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'g');
  const Fi = (lit) => new RegExp('(?<![A-Za-z0-9])' + lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi');

  const ALGOS = {
    // ---- value learning
    qlearning: {
      label: 'Q-learning',
      re: [Fi('Q-learning')],
      idea: 'Move each estimate toward the reward plus the best next estimate. It learns the value of the best path, not of the path it walks.',
      math: 'Q(s,a) <- Q(s,a) + alpha * ( r + gamma * max_a\' Q(s\',a\') - Q(s,a) )',
      symbols: [['Q(s,a)', 'the estimate of the value of action a in state s'], ['alpha', 'the step size: how far one update moves the estimate'], ['r', 'the reward just seen'], ['gamma', 'the discount, 0 to 1: how much later rewards count'], ['max_a\' Q(s\',a\')', 'the best next estimate: the guess of what follows']],
    },
    sarsa: {
      label: 'Sarsa',
      re: [F('Sarsa')],
      idea: 'Move toward the reward plus the estimate of the action really taken next, random tries included. On-policy.',
      math: 'Q(s,a) <- Q(s,a) + alpha * ( r + gamma * Q(s\',a\') - Q(s,a) )',
      symbols: [['Q(s,a)', 'the estimate of taking a in s'], ['a\'', 'the action really taken next'], ['alpha', 'the step size'], ['gamma', 'the discount']],
    },
    expsarsa: {
      label: 'Expected Sarsa',
      re: [Fi('Expected Sarsa'), Fi('Exp. Sarsa')],
      idea: 'Like Sarsa, but the guess averages over the next actions instead of sampling one.',
      math: 'Q(s,a) <- Q(s,a) + alpha * ( r + gamma * sum_a\' pi(a\'|s\') Q(s\',a\') - Q(s,a) )',
      symbols: [['pi(a\'|s\')', 'how likely each next action is under the current policy'], ['sum_a\'', 'the average over all next actions'], ['alpha', 'the step size'], ['gamma', 'the discount']],
    },
    nstep: {
      label: 'n-step TD',
      re: [Fi('n-step TD'), Fi('n-step')],
      idea: 'Use n real rewards, then one guess. Sits between one-step guesses and the full return.',
      math: 'G = r + gamma r\' + ... + gamma^(n-1) r_n + gamma^n Q(s_n, a_n);  Q <- Q + alpha ( G - Q )',
      symbols: [['n', 'how many real rewards before the guess'], ['r .. r_n', 'the next n rewards'], ['gamma^n Q(s_n,a_n)', 'the guess after those rewards'], ['G', 'the n-step target'], ['alpha', 'the step size']],
    },
    montecarlo: {
      label: 'Monte Carlo control',
      re: [Fi('Monte Carlo')],
      idea: 'Wait for the episode to end, then move each estimate toward the full return that followed it.',
      math: 'G = r + gamma r\' + gamma^2 r\'\' + ... ;  Q(s,a) <- Q(s,a) + alpha ( G - Q(s,a) )',
      symbols: [['G', 'the full return: every reward from here to the end'], ['gamma', 'the discount'], ['alpha', 'the step size']],
    },
    dqn: {
      label: 'Deep Q-Network (DQN)',
      re: [Fi('Deep Q-Network'), F('Deep Q-network'), Fi('Deep Q-Network (DQN)'), F('DQN')],
      idea: 'A neural network estimates Q, held steady by random old moves (replay) and a frozen target copy.',
      math: 'y = r + gamma * max_a\' Q_target(s\',a\');  loss = ( Q(s,a) - y )^2',
      symbols: [['Q(s,a)', 'the network that estimates the value of a in s'], ['Q_target', 'a frozen copy of Q, refreshed every few hundred updates'], ['y', 'the target value the estimate is moved toward'], ['gamma', 'the discount']],
    },
    ddqn: {
      label: 'Double DQN',
      re: [Fi('Double DQN')],
      idea: 'The live network chooses the next action; the frozen copy scores it. This cuts DQN overestimation.',
      math: 'y = r + gamma * Q_target( s\', argmax_a\' Q(s\',a\') )',
      symbols: [['Q(s\',a\')', 'the live network: it picks the next action'], ['Q_target', 'the frozen copy: it scores that action'], ['gamma', 'the discount']],
    },
    doubleq: {
      label: 'Double Q-learning',
      re: [Fi('Double Q-learning'), Fi('Double Q')],
      idea: 'One estimate chooses the next action, the other, trained on other updates, scores it. Cuts maximization bias.',
      math: 'y = r + gamma * Q_B( s\', argmax_a\' Q_A(s\',a\') )',
      symbols: [['Q_A, Q_B', 'two estimates, trained on different updates'], ['argmax Q_A', 'Q_A chooses the next action'], ['Q_B', 'Q_B scores that action'], ['gamma', 'the discount']],
    },
    clippedq: {
      label: 'Clipped double Q',
      re: [Fi('Clipped double Q'), Fi('Clipped Q'), Fi('Clipped double Q-learning')],
      idea: 'The target takes the smaller of two estimates (pessimism). It can underestimate; the paper prefers that to overestimation.',
      math: 'y = r + gamma * min_i Q_i(s\', a\')',
      symbols: [['Q_i', 'two critics'], ['min_i', 'keep the smaller estimate for the target'], ['a\'', 'the next action from the policy or target policy'], ['gamma', 'the discount']],
    },
    ucb: {
      label: 'Upper confidence bound (UCB)',
      re: [Fi('Upper confidence bound (UCB)'), Fi('Upper confidence bound'), F('UCB')],
      idea: 'Add a bonus for actions tried few times, so every action keeps being tried.',
      math: 'a = argmax_a ( Q(a) + c * sqrt( ln t / n(a) ) )',
      symbols: [['Q(a)', 'the average payout of action a'], ['c', 'how much the bonus counts'], ['t', 'the number of tries so far'], ['n(a)', 'how many times a was tried'], ['sqrt( ln t / n(a) )', 'the bonus for few tries']],
    },
    egreedy: {
      label: 'epsilon-greedy',
      re: [Fi('epsilon-greedy'), Fi('ε-greedy')],
      idea: 'Take the best-looking action most of the time; with probability epsilon take a random one instead.',
      math: 'a = best action with probability 1 - epsilon, a random action with probability epsilon',
      symbols: [['epsilon', 'the chance of a random try, 0 to 1'], ['best action', 'the one with the highest estimate']],
    },
    optimism: {
      label: 'Optimistic initial values',
      re: [Fi('Optimistic initial values')],
      idea: 'Start every estimate high, so each untried action looks worth a try until it is tried.',
      math: 'Q_0(a) = +5 (a high start); then a normal average update',
      symbols: [['Q_0(a)', 'the start value of each estimate'], ['+5', 'a start above any real payout, so untried actions look good']],
    },

    // ---- policy gradients
    reinforce: {
      label: 'REINFORCE',
      re: [F('REINFORCE')],
      idea: 'Push each action up or down in proportion to the return that followed it. A Monte Carlo policy gradient.',
      math: 'theta <- theta + alpha * G_t * grad_theta log pi_theta(a_t|s_t)',
      symbols: [['theta', 'the policy parameters'], ['G_t', 'the return from this step to the end'], ['log pi_theta(a_t|s_t)', 'how much more or less likely the action becomes'], ['grad_theta', 'the direction that raises the probability'], ['alpha', 'the step size']],
    },
    reinforcebase: {
      label: 'REINFORCE with baseline',
      re: [Fi('REINFORCE with a learned baseline'), Fi('REINFORCE with baseline'), Fi('REINFORCE with a baseline')],
      idea: 'Subtract a baseline from the return, so better than usual pushes up and worse than usual pushes down. Lower variance, same expected update.',
      math: 'theta <- theta + alpha * ( G_t - b ) * grad_theta log pi_theta(a_t|s_t)',
      symbols: [['b', 'the baseline: the average return, or a learned value of the state'], ['G_t - b', 'the advantage: how much better than usual'], ['theta', 'the policy parameters'], ['alpha', 'the step size']],
    },
    actorcritic: {
      label: 'Actor-critic (A2C)',
      re: [Fi('Actor-critic (A2C)'), Fi('actor-critic'), Fi('Actor-critic'), F('A2C')],
      idea: 'A critic replaces the full return with a short target of real rewards plus its own guess, so the actor learns from each step.',
      math: 'advantage = r + gamma * V(s\') - V(s);  theta <- theta + alpha * advantage * grad_theta log pi_theta(a|s)',
      symbols: [['V(s)', 'the critic: the value of the state'], ['r + gamma V(s\')', 'a one-step target for the critic'], ['advantage', 'how much better the action was than the critic expected'], ['theta', 'the actor parameters'], ['alpha', 'the step size']],
    },
    ppo: {
      label: 'Proximal policy optimization (PPO)',
      re: [Fi('Proximal policy optimization (PPO)'), Fi('Proximal policy optimization'), F('PPO')],
      idea: 'Reuse each batch for several passes, but clip the probability ratio so the policy cannot jump too far in one update.',
      math: 'ratio = pi_new(a|s) / pi_old(a|s);  L = E[ min( ratio * A, clip(ratio, 1-eps, 1+eps) * A ) ]',
      symbols: [['ratio', 'how much the action probability changed since the data'], ['A', 'the advantage from the critic'], ['clip(ratio, 1-eps, 1+eps)', 'cap the ratio, often at 0.8 to 1.2'], ['eps', 'the clip size, often 0.2'], ['L', 'the clipped objective the actor maximizes']],
    },
    grpo: {
      label: 'Group relative policy optimization (GRPO)',
      re: [Fi('Group relative policy optimization (GRPO)'), Fi('Group relative policy optimization'), F('GRPO')],
      idea: 'No critic. Try the same prompt several times and judge each try against the mean of its group.',
      math: 'A_i = ( r_i - mean(r_group) ) / std(r_group)',
      symbols: [['r_i', 'the reward of try i'], ['mean(r_group)', 'the average reward over the group of tries'], ['std(r_group)', 'the spread of the group rewards'], ['A_i', 'the advantage of try i against its group']],
    },

    // ---- continuous control
    ddpg: {
      label: 'Deep deterministic policy gradient (DDPG)',
      re: [Fi('Deep deterministic policy gradient (DDPG)'), Fi('Deep deterministic policy gradient'), Fi('DDPG without slow copies'), F('DDPG')],
      idea: 'The actor outputs one continuous action mu(s) and climbs the critic slope; slow target copies keep the targets steady.',
      math: 'critic target y = r + gamma * Q_target(s\', mu_target(s\'));  actor maximizes Q(s, mu(s))',
      symbols: [['mu(s)', 'the actor: one continuous action for state s'], ['Q(s,a)', 'the critic: value of taking a in s'], ['Q_target, mu_target', 'slow target copies of the critic and actor'], ['y', 'the critic target'], ['gamma', 'the discount']],
    },
    td3: {
      label: 'Twin delayed DDPG (TD3)',
      re: [Fi('Twin delayed DDPG (TD3)'), Fi('Twin delayed DDPG'), Fi('DDPG with two critics'), F('TD3')],
      idea: 'DDPG overestimates, so TD3 keeps two critics and uses the smaller, adds noise to the target action, and updates the actor less often.',
      math: 'y = r + gamma * min_i Q_target_i( s\', mu_target(s\') + clip(eps) );  the actor updates every d critic updates',
      symbols: [['Q_target_1, Q_target_2', 'two target critics; the target uses the smaller'], ['mu_target(s\') + clip(eps)', 'the target action plus clipped smoothing noise'], ['min_i', 'pessimism: keep the smaller estimate'], ['d', 'the delay: the actor updates every d critic updates, often 2'], ['gamma', 'the discount']],
    },
    sac: {
      label: 'Soft actor-critic (SAC)',
      re: [Fi('Soft actor-critic (SAC)'), Fi('Soft actor-critic'), F('SAC')],
      idea: 'A stochastic actor maximizes reward plus entropy, so it stays random on purpose. Soft means entropy-regularized values and objectives, not slow target copies or two critics.',
      math: 'soft value V(s) = E_{a~pi}[ Q(s,a) - alpha * log pi(a|s) ];  soft target y = r + gamma * V_target(s\');  actor maximizes E[ alpha * log pi(a|s) - Q(s,a) ]',
      symbols: [['pi(a|s)', 'the stochastic actor: a distribution over actions'], ['alpha', 'the temperature: how much the entropy counts, often auto-tuned to a target'], ['log pi(a|s)', 'the entropy bonus: higher when the policy stays random'], ['V(s)', 'the soft value: reward minus alpha times entropy'], ['soft', 'entropy-regularized values and objectives, not slow copies or twin critics']],
    },

    // ---- offline learning
    bc: {
      label: 'Behavior cloning',
      re: [Fi('Behavior cloning'), F('BC')],
      idea: 'No reward and no new tries: copy the actions in the data with supervised learning.',
      math: 'minimize E_data[ -log pi(a_data|s) ]  (or a regression on the action)',
      symbols: [['a_data', 'the action the data took in state s'], ['pi(a_data|s)', 'how likely the policy is to take that action'], ['-log pi', 'the loss: raise the probability of the data actions']],
    },
    filtbc: {
      label: 'Filtered behavior cloning',
      re: [Fi('Filtered behavior cloning'), Fi('Filtered BC')],
      idea: 'Copy only the episodes with the highest returns, so bad demonstrations are dropped.',
      math: 'minimize E_{best episodes}[ -log pi(a_data|s) ]',
      symbols: [['best episodes', 'the episodes with the highest return, e.g. the top 10%'], ['a_data', 'the action in the kept data']],
    },
    awr: {
      label: 'Advantage-weighted regression (AWR)',
      re: [Fi('Advantage-weighted regression (AWR)'), Fi('Advantage-weighted regression'), F('AWR')],
      idea: 'Weighted imitation of the recorded actions: regress the policy toward the data actions, each weighted by exp(advantage / beta). This is not direct optimization of actions through the critic gradient.',
      math: 'minimize E_data[ w * (-log pi(a_data|s)) ],  w = exp( A / beta )',
      symbols: [['A', 'the advantage of the recorded action: how much better than expected'], ['w = exp(A/beta)', 'the weight: big for good actions, small for bad'], ['beta', 'how sharp the weighting is'], ['a_data', 'the action the data took in s']],
      note: 'Advantage here is a return estimate minus V(s). Original AWR (Peng et al. 2019) uses a Monte Carlo or TD(lambda) return minus V(s). This game screen uses Qbar(s,a) minus V(s), which is an AWAC or CRR style variant. The teaching point stands for both: weighted imitation of recorded actions, not critic-gradient action optimization.',
    },
    td3bc: {
      label: 'TD3+BC',
      re: [Fi('TD3+BC'), Fi('TD3 with a behavior cloning term')],
      idea: 'Offline TD3: climb the critic, but pay a penalty for leaving the actions the data took.',
      math: 'actor loss = -Q(s, pi(s)) + lambda * || pi(s) - a_data ||^2',
      symbols: [['Q(s, pi(s))', 'the critic the actor climbs'], ['lambda', 'the behavior-cloning penalty weight'], ['a_data', 'the action the data took in s'], ['|| pi(s) - a_data ||^2', 'how far the policy leaves the data']],
    },
    iql: {
      label: 'Implicit Q-learning (IQL)',
      re: [Fi('Implicit Q-learning (IQL)'), Fi('Implicit Q-learning'), F('IQL')],
      idea: 'The critic never asks about an action outside the data. A high expectile of the data own values stands in for the best action.',
      math: 'V fits a high expectile of Q(s,a_data);  Q target y = r + gamma * V(s\');  policy weight exp( (Q - V) / beta )',
      symbols: [['V(s)', 'a state value fitted to a high expectile of the data values'], ['expectile', 'like a quantile, but weighted by squared error'], ['Q(s,a_data)', 'the critic, evaluated only on data actions'], ['exp((Q-V)/beta)', 'the weight that copies better-than-expected actions']],
    },
    cql: {
      label: 'Conservative Q-learning (CQL)',
      re: [Fi('Conservative Q-learning (CQL)'), Fi('Conservative Q-learning'), F('CQL')],
      idea: 'Push down the critic values of actions the data did not take, and push up the data actions, so the policy cannot exploit a wrong critic.',
      math: 'L = E[ alpha * ( logsumexp_a Q(s,a) - Q(s,a_data) ) ] + TD loss',
      symbols: [['logsumexp_a Q(s,a)', 'a soft max over actions: pushes down actions the data did not take'], ['Q(s,a_data)', 'the value of the data action: pushed up'], ['alpha', 'how much the conservative term counts'], ['TD loss', 'the usual value-learning loss on data transitions']],
    },

    // ---- the robotics frontier
    qplan: {
      label: 'Q-planning',
      re: [Fi('Q-planning')],
      idea: 'Improve a frozen copying policy without changing its weights: train only a critic from its own tries and act with a Q-weighted average of several policy samples.',
      math: 'a = sum_n w_n a^(n),  w_n proportional to exp( Q(s, a^(n)) / lambda )',
      symbols: [['a^(n)', 'one action sample from the frozen policy'], ['w_n', 'the weight of sample n, from its Q value'], ['lambda', 'how sharp the Q weighting is'], ['Q(s,a)', 'the critic, trained online']],
    },
    expo: {
      label: 'Expressive policy optimization (EXPO)',
      re: [Fi('Expressive policy optimization (EXPO)'), Fi('Expressive policy optimization'), F('EXPO')],
      idea: 'A flow base policy stays an imitation policy; a small Gaussian edit policy moves its samples toward higher value, and the critic picks the best.',
      math: 'a* = argmax over { base sample, edited sample } of Q(s,a);  the edit is a small Gaussian shift toward higher Q',
      symbols: [['base sample', 'an action from the expressive imitation policy'], ['edited sample', 'the base action moved by a small Gaussian edit policy'], ['Q(s,a)', 'the critic that scores and picks the action']],
    },
    flow: {
      label: 'Flow-matching policy',
      re: [Fi('Flow-matching policy'), Fi('Flow-matching'), Fi('flow-matching'), Fi('Flow policy')],
      idea: 'Start from noise and move it in small learned steps to an action. Different noise can end at different modes, so it avoids averaging two good plans into a bad one.',
      math: 'a = noise + integral of v_theta(noise_t, t) over t, in a few learned steps',
      symbols: [['v_theta', 'the learned velocity field that moves noise toward an action'], ['noise', 'a random start point'], ['t', 'the step of the flow, 0 to 1']],
    },
    act: {
      label: 'Action chunking (ACT)',
      re: [Fi('Action chunking (ACT)'), Fi('Action chunks (ACT-like)'), Fi('Action chunking'), Fi('Action chunks'), F('ACT')],
      idea: 'Predict k commands at once, so the policy decides k times less often and errors compound more slowly.',
      math: 'the policy outputs (a_t, a_{t+1}, ..., a_{t+k-1}) and plays them open loop',
      symbols: [['k', 'how many commands per decision (the chunk size)'], ['a_t .. a_{t+k-1}', 'the chunk of future commands']],
    },
    residual: {
      label: 'Residual RL',
      re: [Fi('Residual RL')],
      idea: 'A classical controller acts; the learner adds a small correction on top of it.',
      math: 'a = pi_base(s) + delta_theta(s),  with a small correction delta',
      symbols: [['pi_base(s)', 'the classical controller action'], ['delta_theta(s)', 'the learned residual correction'], ['a', 'the action actually taken']],
    },
    bestofn: {
      label: 'Best-of-N with a critic',
      re: [Fi('Best-of-N')],
      idea: 'A copying policy cannot beat its data alone: sample N actions and let a critic pick one.',
      math: 'a = argmax_{n} Q(s, a^(n)) over N policy samples a^(n)',
      symbols: [['a^(n)', 'one of N action samples from the policy'], ['Q(s,a)', 'the critic that scores each sample'], ['argmax', 'keep the sample with the highest value']],
    },
    recap: {
      label: 'Advantage conditioning (RECAP-like)',
      re: [Fi('Advantage conditioning (RECAP-like)'), Fi('Advantage conditioning (RECAP, π*0.6)'), Fi('Advantage conditioning'), F('RECAP')],
      idea: 'Copy every action, told whether it was better than usual; at test time ask for better.',
      math: 'pi(a | s, c), with c = better or worse than usual; at test time condition on c = better',
      symbols: [['c', 'the conditioning signal: was this action better than usual'], ['pi(a|s,c)', 'the policy, told the advantage class of the action']],
      gameNote: 'The game borrows only the advantage-label conditioning: it labels each recorded action as better or worse than usual, trains the policy on that label, then asks for better at test time. The published method (Physical Intelligence, \u03c0*0.6, 2025) is a full robot vision-language-action model that learns from experience, with a robot, a large model and an experience loop. The game does not implement those. This is why the game says RECAP-like. Provenance verified against the arXiv record (arXiv:2511.14759, Physical Intelligence, 2025).',
    },
  };

  // ---------------------------------------------------------------- map to the game's cards
  // One consistent link per algorithm from its reminder to its discovery card in CONTENT, so the
  // shared panel can reuse the card (what it fixes, how it helps, where it fails, source quotes).
  const CARD = {
    qlearning: 'qlearning', sarsa: 'sarsa', expsarsa: 'expsarsa', nstep: 'nstep', montecarlo: 'mc',
    dqn: 'dqn', ddqn: 'ddqn', doubleq: 'doubleq', clippedq: 'clipped', ucb: 'ucb', egreedy: 'egreedy',
    optimism: 'optimism', reinforce: 'reinforce', reinforcebase: 'baseline', actorcritic: 'a2c',
    ppo: 'ppo', grpo: 'grpo', ddpg: 'ddpg', td3: 'td3', sac: 'sac', bc: 'bc', filtbc: 'filtbc',
    awr: 'awr', td3bc: 'td3bc', iql: 'iql', cql: 'cql', qplan: 'qplan', expo: 'expo', flow: 'flow',
    act: 'act', residual: 'residual', bestofn: 'bestofn', recap: 'recap',
  };
  const cardOf = (id) => CARD[id] || null;

  // ---------------------------------------------------------------- pure matcher (no DOM)
  // Find every name in a string. Returns [{ id, label, start, end }] with the longest match kept
  // at each position and every overlap dropped, so "Twin delayed DDPG (TD3)" is one name and
  // "Expected Sarsa" is Expected Sarsa rather than Sarsa. This is what tests check for coverage.
  function findNames(text) {
    const src = String(text == null ? '' : text);
    const all = [];
    for (const id in ALGOS) {
      for (const re of ALGOS[id].re) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          all.push({ id, label: m[0], start: m.index, end: m.index + m[0].length });
        }
      }
    }
    all.sort((a, b) => a.start - b.start || b.end - a.end);   // longest first at a shared start
    const kept = [];
    let lastEnd = -1;
    for (const n of all) {
      if (n.start >= lastEnd) { kept.push(n); lastEnd = n.end; }
    }
    return kept;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Plain-text reminder for one algorithm. Used by the popover and by the accessible description.
  function reminderText(id) {
    const a = ALGOS[id];
    if (!a) return '';
    return a.label + '. ' + a.idea + ' Defining math: ' + a.math + ' Symbols: '
      + a.symbols.map(([s, m]) => s + ': ' + m).join('; ') + '.' + (a.note ? ' ' + a.note : '');
  }

  // ---------------------------------------------------------------- shared reminder popover
  const POP_ID = 'algo-rem-popover';
  function ensurePop() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(POP_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = POP_ID;
    el.className = 'metric-help-pop algo-rem-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('popover', 'manual');
    el.setAttribute('aria-labelledby', 'algo-rem-title');
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  let openTrigger = null;        // the element the popover is anchored to

  function closeReminder(refocus) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(POP_ID);
    if (el) {
      if (el.matches(':popover-open')) el.hidePopover();
      el.hidden = true;
    }
    if (openTrigger) {
      openTrigger.setAttribute('aria-expanded', 'false');
      const t = openTrigger;
      openTrigger = null;
      // Return focus for keyboard users. Focus alone never reopens the reminder.
      if (refocus && t.focus) t.focus();
    }
  }

  // The shared method panel body: the reminder (idea, math, symbols) plus, only for a method the
  // player has discovered, the discovery-card content (what it fixes, where it fails, source,
  // evidence quotes) and the provenance / game-adaptation context. One component, no duplicate copy.
  function discoveryBlock(id, a) {
    const info = API.discoveryFor ? API.discoveryFor(id) : null;
    if (!info || !info.discovered || !info.card) return null;
    const card = info.card;
    const wrap = document.createElement('div');
    wrap.className = 'algo-discovery';
    const h = document.createElement('div');
    h.className = 'algo-discovery-h';
    h.textContent = 'Method panel';
    wrap.append(h);
    const line = (label, html) => {
      const p = document.createElement('p');
      p.innerHTML = '<b>' + label + ' </b>' + html;
      wrap.append(p);
    };
    if (card.fixes) line('What it fixes:', card.fixes);
    if (card.stillWrong) line('Where it still fails:', card.stillWrong);
    if (card.paper) line('Source \u00b7 who \u00b7 where:', card.paper);
    const game = a.gameNote || info.blurb;
    if (game) line('Game adaptation:', game);
    if (info.links && info.links.length) {
      const ul = document.createElement('ul');
      ul.className = 'algo-links';
      for (const l of info.links) {
        const li = document.createElement('li');
        const la = document.createElement('a');
        la.href = l.u; la.target = '_blank'; la.rel = 'noopener'; la.textContent = l.t;
        li.append(la); ul.append(li);
      }
      wrap.append(ul);
    }
    if (card.status === 'unchecked') {
      const u = document.createElement('p');
      u.className = 'algo-prov algo-unverified';
      u.textContent = 'Provenance note: this source was not checked against the original. Treat the history as unverified.';
      wrap.append(u);
    }
    if (card.evidence) {
      const det = document.createElement('details');
      det.className = 'algo-evidence';
      const sum = document.createElement('summary');
      sum.textContent = 'Evidence (source quotes)';
      const ev = document.createElement('div');
      ev.innerHTML = card.evidence;
      det.append(sum, ev);
      wrap.append(det);
    }
    return wrap;
  }

  function openReminder(id, anchorEl) {
    if (typeof document === 'undefined') return;
    const a = ALGOS[id];
    if (!a) return;
    if (openTrigger && openTrigger !== anchorEl) closeReminder(false);
    const el = ensurePop();
    // A modal dialog makes body siblings inert. Keep the reminder in the trigger's
    // dialog, and lift it into the top layer so the briefing cannot clip it.
    const host = anchorEl?.closest('dialog') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.replaceChildren();

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'metric-help-close';
    close.setAttribute('aria-label', 'Close reminder');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => closeReminder(true));

    const title = document.createElement('div');
    title.className = 'metric-help-title';
    title.id = 'algo-rem-title';
    title.textContent = a.label;

    const body = document.createElement('div');
    body.className = 'metric-help-body';
    const idea = document.createElement('p');
    idea.className = 'algo-idea';
    idea.textContent = a.idea;
    const math = document.createElement('div');
    math.className = 'algo-math';
    const code = document.createElement('code');
    code.textContent = a.math;
    math.append(code);
    const syms = document.createElement('p');
    syms.className = 'algo-symbols';
    const b = document.createElement('b');
    b.textContent = 'Symbols: ';
    syms.append(b, document.createTextNode(a.symbols.map(([s, m]) => s + ': ' + m).join('; ')));
    body.append(idea, math, syms);
    if (a.note) {
      const note = document.createElement('p');
      note.className = 'algo-note';
      note.textContent = a.note;
      body.append(note);
    }
    const disc = discoveryBlock(id, a);
    if (disc) body.append(disc);

    el.append(close, title, body);
    el.hidden = false;
    if (!el.matches(':popover-open')) el.showPopover();
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(root.innerWidth - 8 - el.offsetWidth, r.left)) + 'px';
      el.style.top = (r.bottom + 8 + el.offsetHeight > root.innerHeight
        ? Math.max(8, r.top - 8 - el.offsetHeight) : r.bottom + 8) + 'px';
      anchorEl.setAttribute('aria-expanded', 'true');
      openTrigger = anchorEl;
    }
    close.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- inline name trigger
  // The name itself is the control. A real button: focusable, tappable, activatable with Enter or
  // Space. It opens the reminder only on that deliberate activation, never on hover or focus alone.
  // Never nested inside another control (see attachControl for the nested case).
  function makeTrigger(id, label) {
    const a = ALGOS[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'algo-name';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const pop = document.getElementById(POP_ID);
      const open = pop && !pop.hidden && openTrigger === b;
      if (open) closeReminder(true); else openReminder(id, b);
    });
    if (a) b.setAttribute('aria-label', a.label + ': show the reminder');
    return b;
  }

  // ---------------------------------------------------------------- accessible equivalent
  // For a name inside an interactive control (button, link, tree node, select, option, disabled
  // control) we never nest a control. Instead the control gets an aria-describedby pointing at a
  // hidden span with the same reminder, so keyboard and screen-reader users get the explanation.
  function hiddenDesc(id) {
    if (typeof document === 'undefined') return null;
    let host = document.getElementById('algo-a11y-descriptions');
    if (!host) {
      host = document.createElement('div');
      host.id = 'algo-a11y-descriptions';
      host.className = 'algo-sr';
      host.setAttribute('aria-hidden', 'false');
      document.body.appendChild(host);
    }
    const span = document.createElement('span');
    span.className = 'algo-sr-item';
    span.textContent = reminderText(id);
    host.appendChild(span);
    return span;
  }

  const INTERACTIVE = 'button,a[href],select,option,input,textarea,summary,[role=button],[role=link],[role=option],[role=tab],[role=menuitem],[disabled],[aria-disabled="true"]';

  function attachControl(controlEl, id) {
    const span = hiddenDesc(id);
    if (!span) return;
    if (!span.id) span.id = 'algo-desc-' + id + '-' + Math.random().toString(36).slice(2, 8);
    const cur = controlEl.getAttribute('aria-describedby');
    const ids = cur ? cur.split(/\s+/).filter(Boolean) : [];
    if (!ids.includes(span.id)) {
      ids.push(span.id);
      controlEl.setAttribute('aria-describedby', ids.join(' '));
    }
  }

  // ---------------------------------------------------------------- enhancer
  const SKIP = '.algo-rem-pop,.algo-name,.algo-sr,.metric-help-pop,.metric-help-btn,script,style,noscript,textarea';

  function enhanceText(node) {
    if (!node || node.nodeType !== 3) return 0;
    if (node.__algoDone) return 0;
    const text = node.nodeValue;
    if (!text || !text.trim()) return 0;
    const parent = node.parentElement;
    if (!parent) return 0;
    if (parent.closest && parent.closest(SKIP)) { node.__algoDone = true; return 0; }

    const names = findNames(text);
    if (!names.length) { node.__algoDone = true; return 0; }

    // Inside an interactive control: no nested control. Hand the control an accessible equivalent.
    const control = parent.closest && parent.closest(INTERACTIVE);
    if (control) {
      // An <option> cannot carry a reliable description, so the <select> that owns it does.
      const target = (control.tagName === 'OPTION' && control.parentElement) ? control.parentElement : control;
      for (const n of names) attachControl(target, n.id);
      node.__algoDone = true;
      return 0;
    }
    // Inside SVG but not in a control (for example a tree arrow label): a <button> cannot live
    // here. Leave the text as it is.
    if (parent.closest && parent.closest('svg')) { node.__algoDone = true; return 0; }

    // Plain text: wrap each name in its own trigger button.
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const n of names) {
      const before = text.slice(cursor, n.start);
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(makeTrigger(n.id, n.label));
      cursor = n.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    for (const c of frag.childNodes) if (c.nodeType === 3) c.__algoDone = true;
    node.parentNode.replaceChild(frag, node);
    return names.length;
  }

  function enhance(rootEl) {
    if (typeof document === 'undefined' || !rootEl) return 0;
    if (rootEl.nodeType === 3) return enhanceText(rootEl);
    if (rootEl.closest && rootEl.closest(SKIP)) return 0;
    let placed = 0;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) placed += enhanceText(n) ? 1 : 0;
    return placed;
  }

  // ---------------------------------------------------------------- auto-skip, auto-enhance
  // Every surface that renders a name ends up in the DOM. A guarded observer enhances new and
  // changed text as it appears, so prose, questions, method labels, Codex and the family tree all
  // get reminders without touching each render path. Re-entrancy is guarded because enhancement
  // itself rewrites text nodes.
  function installAuto(root) {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const target = root || document.body;
    if (!target || target.__algoObserver) return;
    let busy = false;
    const obs = new MutationObserver((muts) => {
      if (busy) return;
      busy = true;
      try {
        for (const m of muts) {
          if (m.type === 'characterData') { enhanceText(m.target); continue; }
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) enhance(node);
            else if (node.nodeType === 3) enhanceText(node);
          }
        }
      } finally { busy = false; }
    });
    obs.observe(target, { childList: true, subtree: true, characterData: true });
    target.__algoObserver = obs;
    enhance(target);   // anything already on screen
  }

  if (typeof document !== 'undefined') {
    // Dismiss reliably: Escape closes and returns focus; a click outside closes.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const pop = document.getElementById(POP_ID);
        if (pop && !pop.hidden) { e.preventDefault(); e.stopPropagation(); closeReminder(true); }
      }
    }, true);
    document.addEventListener('pointerdown', (e) => {
      const pop = document.getElementById(POP_ID);
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (openTrigger && openTrigger.contains(e.target)) return;
      closeReminder(false);
    }, true);
  }

  // ---------------------------------------------------------------- pure preset planning (scope 175)
  // Reuses the recipe catalog (the caller passes C.recipes entries) as the single source of
  // algorithm settings. Pure, so tests can check the diff, the compatibility reason and the
  // unlocked filter without a browser. app.js calls these and only handles the DOM + state.
  function presetPlan(cur, keys) {
    const next = Object.assign({}, cur);
    const changes = [];
    for (const k in keys) {
      const want = keys[k];
      const val = Array.isArray(want) ? (want.includes(cur[k]) ? cur[k] : want[0]) : want;
      if (cur[k] !== val) changes.push({ key: k, from: cur[k], to: val });
      next[k] = val;
    }
    return { next, changes };
  }
  function presetReason(famOf, families, r, p, world) {
    const fam = famOf(p);
    if ((r.family || 'value') !== fam) return 'Needs the ' + ((families[r.family || 'value'] || {}).name || (r.family || 'value')) + ' sentence.';
    if (fam === 'value' && (r.world === 'bandit') !== (world === 'bandit')) return 'Needs a ' + (r.world === 'bandit' ? 'slot-machine' : 'grid or CartPole') + ' world.';
    if (r.worlds && !r.worlds.includes(world)) return 'Works only in: ' + r.worlds.join(', ') + '.';
    return null;
  }
  function presetUnlocked(r, found, given) {
    return !!(r.card && (found.indexOf(r.card) >= 0 || given.indexOf(r.card) >= 0));
  }

  const API = {
    ALGOS,
    findNames,
    reminderText,
    enhance,
    enhanceText,
    installAuto,
    openReminder,
    closeReminder,
    makeTrigger,
    attachControl,
    cardOf,
    presetPlan,
    presetReason,
    presetUnlocked,
  };
  root.ALGO_HELP = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
