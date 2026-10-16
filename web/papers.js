// Links to the sources of each codex card. Every arXiv id here was checked against the arXiv API (title match),
// and every other link was opened once (16 Oct 2026). The book is free online from its authors.
(function (C) {
  'use strict';
  const ax = (id, t) => ({ t: t + ' (arXiv ' + id + ')', u: 'https://arxiv.org/abs/' + id });
  const SB = { t: 'Sutton and Barto, the book (free online)', u: 'http://incompleteideas.net/book/the-book-2nd.html' };
  const DOI = (d, t) => ({ t, u: 'https://doi.org/' + d });
  C.paperLinks = {
    lockin: [SB], egreedy: [SB], optimism: [SB], mc: [SB], noend: [SB], expsarsa: [SB], nstep: [SB], triad: [SB], maxbias: [SB], highvar: [SB], baseline: [SB],
    ucb: [SB, DOI('10.1023/A:1013689704352', 'Auer, Cesa-Bianchi and Fischer (2002), UCB')],
    qlearning: [SB, DOI('10.1007/BF00992698', 'Watkins and Dayan (1992), Q-learning')],
    sarsa: [SB],
    dqn: [{ t: 'Mnih et al. (2015), Nature', u: 'https://www.nature.com/articles/nature14236' }, ax('1312.5602', 'Mnih et al. (2013), the first DQN paper')],
    doubleq: [{ t: 'van Hasselt (2010), Double Q-learning', u: 'https://proceedings.neurips.cc/paper/2010/hash/091d584fced301b442654dd8c23b3fc9-Abstract.html' }],
    ddqn: [ax('1509.06461', 'Double DQN')],
    clipped: [ax('1802.09477', 'TD3')],
    reinforce: [SB, DOI('10.1007/BF00992696', 'Williams (1992), REINFORCE')],
    a2c: [SB, ax('1506.02438', 'GAE')],
    bigsteps: [ax('1707.06347', 'PPO')], ppo: [ax('1707.06347', 'PPO')],
    timelimit: [ax('1712.00378', 'Time Limits in RL')],
    grpo: [ax('2402.03300', 'DeepSeekMath (GRPO)')],
    emptygroups: [ax('2503.14476', 'DAPO'), ax('2503.20783', 'Dr. GRPO')],
    ddpg: [ax('1509.02971', 'DDPG')], td3: [ax('1802.09477', 'TD3')],
    sac: [ax('1801.01290', 'SAC'), ax('1812.05905', 'SAC with automatic temperature')],
    extrap: [ax('1812.02900', 'BCQ')],
    bc: [{ t: 'Pomerleau (1989), ALVINN', u: 'https://proceedings.neurips.cc/paper/1988/hash/812b4ba287f5ee0bc9d43bbf5bbe87fb-Abstract.html' }],
    filtbc: [ax('2106.01345', 'Decision Transformer'), ax('2110.06169', 'IQL')],
    awr: [ax('1910.00177', 'AWR')], td3bc: [ax('2106.06860', 'TD3+BC')], iql: [ax('2110.06169', 'IQL')], cql: [ax('2006.04779', 'CQL')],
    modeavg: [ax('2410.24164', 'π0')], flow: [ax('2410.24164', 'π0')], act: [ax('2304.13705', 'ACT')],
    bestofn: [ax('2608.21204', 'Off-Policy Q-Planning')], qplan: [ax('2608.21204', 'Off-Policy Q-Planning')],
    expo: [ax('2507.07986', 'EXPO')],
    criticfirst: [ax('1812.06298', 'Residual Policy Learning')],
    residual: [ax('1812.03201', 'Residual RL for robot control'), ax('1812.06298', 'Residual Policy Learning'), ax('2509.19301', 'ResFiT')],
    recap: [ax('2511.14759', 'π*0.6 (RECAP)')], pi05: [ax('2504.16054', 'π0.5')], pi07: [ax('2604.15483', 'π0.7')],
  };
})(window.CONTENT);
