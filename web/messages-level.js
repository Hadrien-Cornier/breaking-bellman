// Restored three-cell inference experiment from 53a5a83. No other lesson is restored here.
(function () {
  'use strict';
  const level = { id: 'messages', custom: true, phase: 3, world: 'messages', title: 'Pass the message back', focus: [],
    intro: 'Rover starts in cell 0 and the goal is cell 2. The known transitions move one cell left or right. An action prior is a preference before considering the goal. Compare Prior only with Prior × backward message.',
    goal: { text: 'Compare the two methods, change a real planning setting, and explain how prior times message selects the next action.' },
  };
  CONTENT.worldNames.messages = 'Three cells';
  CONTENT.levels.splice(CONTENT.levels.findIndex(l => l.id === 'elbo') + 1, 0, level);
  window.BBMESSAGES_LEVEL = BBInferenceLesson.create({
    level, sceneTitle: 'Pass the goal information backward',
    defaults: { prior: { left: .7, right: .3 }, horizon: 2, goal: 2, miss: .05 },
    controls: [
      { key: 'prior', label: 'Action prior', options: [
        { label: 'Left 0.70 / right 0.30', value: { left: .7, right: .3 } },
        { label: 'Left 0.95 / right 0.05', value: { left: .95, right: .05 } },
        { label: 'Left 1 / right 0', value: { left: 1, right: 0 } },
      ] },
      { key: 'horizon', label: 'Decision budget', options: [1, 2, 3].map(value => ({ label: value + ' decisions', value })) },
      { key: 'goal', label: 'Goal cell', options: [0, 1, 2].map(value => ({ label: 'Cell ' + value, value })) },
      { key: 'miss', label: 'Final likelihood away from goal', options: [{ label: '0.05: misses remain possible', value: .05 }, { label: '0: require the goal', value: 0 }] },
    ],
    instructions: [
      'Prior only always takes its most probable action. Prior × backward message also considers how the remaining decisions can lead to the goal. The message carries that future information backward through the known transition table.',
      'Run computes the final goal likelihood, the backward messages, and each method’s decisions in that order. Watch or Step follows that chronology. There are no new training examples.',
      'During each decision, compare the displayed action prior, raw message and conditioned probability. The conditioned probability multiplies prior by message, then divides by the sum for both actions.',
      'Change the action prior to 0.95 on left, or reduce the budget to one decision, then Run again. You can also require the goal with likelihood 0 elsewhere. An impossible condition must stop with an undefined distribution.',
      'A message does not erase an action prior. A zero prior cannot become a positive conditioned probability. If all weighted messages are zero, there is no distribution to normalize and no next action.',
    ],
    questions: [
      { id: 'messages-p', prompt: 'With prior 0.70 on left and 0.30 on right, where does Prior only end after two decisions from cell 0?', options: [
        { text: 'Cell 0. Left from cell 0 stays there.', correct: true, why: 'Prior only chooses left at both decisions. The goal does not rewrite the prior.' },
        { text: 'Cell 2. Naming a goal changes the prior.', why: 'The action prior still prefers left.' },
        { text: 'Cell 1. Average the two action probabilities into a move.', why: 'The replay uses the most probable action, not an average of cell coordinates.' },
      ] },
      { id: 'messages-d', prompt: 'What did the Prior only decisions leave out?', options: [
        { text: 'The backward message about the goal.', correct: true, why: 'The conditioned method multiplies the prior by that message and normalizes.' },
        { text: 'The transitions. Only left is legal.', why: 'Both actions are legal. The transition table is known for both.' },
        { text: 'A reward fitted from demonstrations.', why: 'This experiment has no demonstrations and learns no reward.' },
      ] },
      { id: 'messages-x', prompt: 'How does Prior × backward message choose its action?', options: [
        { text: 'Multiply prior by message, normalize, then take the most probable action.', correct: true, why: 'A strong prior can still win; zero total weight stops the conditioned replay as undefined.' },
        { text: 'Erase the prior whenever a message is positive.', why: 'The product still contains the prior. Zero prior means zero product.' },
        { text: 'Use a stored right, right path regardless of settings.', why: 'Every run recomputes the messages and decisions for the selected settings.' },
      ] },
    ],
    rules: [
      'Known three-cell line, start cell 0. Left or right moves one cell; an outside move stays at the end. The goal is checked after the selected number of decisions, not on first arrival.',
      'The final likelihood is 1 at the goal and the chosen miss likelihood elsewhere. Each backward message averages the next state’s message through the known transitions.',
      'Conditioned action probability = prior × raw message / sum of those products. The raw message itself excludes the action prior. If the sum is zero, the distribution is undefined.',
      'The visible path uses each distribution’s most probable action, with left first on ties. Stochastic dynamics can be evaluated by the engine but have no displayed deterministic path. No reward, model or posterior is learned here.',
    ],
    sketch: { label: 'Goal information travels backward before decisions move forward', nodes: [
      { id: 'start', label: 'Start', x: 45, y: 60 }, { id: 'middle', label: 'Next', x: 160, y: 60 }, { id: 'goal', label: 'Goal', x: 275, y: 60 },
    ], edges: [{ from: 'goal', to: 'middle', label: 'message' }, { from: 'middle', to: 'start', label: 'message' }] },
  });
})();
