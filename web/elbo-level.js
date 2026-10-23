// Restored from the finite bright-reading lesson at 53a5a83, now with measured replay.
(function () {
  'use strict';
  const level = {
    id: 'elbo', custom: true, phase: 3, world: 'elbo', title: 'A bound that is tight only when the guess matches', focus: [],
    intro: 'The sensor reads bright. Hall, lamp and glare are possible hidden causes. A prior is the probability before the reading; a likelihood says how often each cause produces bright. The guess q assigns a probability to each cause.',
    goal: { text: 'Compare two updates from the same guess, change that guess or the update budget, and explain the gap.' },
  };
  CONTENT.worldNames.elbo = 'One bright reading';
  CONTENT.levels.splice(CONTENT.levels.findIndex(l => l.id === 'explore') + 1, 0, level);
  window.BBELBO_LEVEL = BBInferenceLesson.create({
    level, sceneTitle: 'One bright reading', defaults: { weights: BBELBO.narrowWeights(), rounds: 8, step: .5 },
    controls: [
      { key: 'weights', label: 'Starting guess', options: [
        { label: 'Narrow: mostly glare', value: BBELBO.narrowWeights() }, { label: 'Even: equal causes', value: BBELBO.evenWeights() },
        { label: 'Hard zero: glare only', value: BBELBO.hardGlareWeights() },
      ] },
      { key: 'rounds', label: 'Update budget', options: [2, 8, 16].map(value => ({ label: value + ' updates', value })) },
      { key: 'step', id: 'update-size', label: 'Update size', options: [.25, .5, 1].map(value => ({ label: String(value), value })) },
    ],
    instructions: [
      'A good explanation must fit the reading and respect the prior. KL is a measure of how one probability distribution differs from another. The evidence lower bound, or ELBO, subtracts KL(q || prior) from the reconstruction score.',
      'KL included and Reconstruction only start from exactly the same guess. The first updates the bound; the second only rewards explaining bright. Run computes every update, then Watch or Step replays those measurements.',
      'Compare the bound and the gap for both named methods. The reconstruction score rewards assigning weight to causes that often produce bright. What does that score leave out?',
      'Change the starting guess, update size or budget, then Run again. Try Hard zero: glare only. A zero probability stays zero under this multiplicative update, even when another cause remains possible.',
      'The posterior is the probability after observing bright: prior times likelihood, normalized. The gap between log P(bright) and the bound equals KL(q || posterior). Explain why matching the posterior closes it.',
    ],
    questions: [
      { id: 'elbo-predict', prompt: 'A narrow guess puts almost all its weight on glare. Does explaining bright make the bound tight?', options: [
        { id: 'elbo-predict-loose', text: 'No. It is tight only when the guess matches the posterior.', correct: true, why: 'A strong likelihood is only one part of the explanation. The prior also matters.' },
        { id: 'elbo-predict-tight', text: 'Yes. Glare explains bright best, so it must be the whole posterior.', why: 'Hall and lamp can also produce bright, and the prior gives them more weight.' },
        { id: 'elbo-predict-recon', text: 'The bound is just the reconstruction score.', why: 'The bound also subtracts KL(q || prior).' },
      ] },
      { id: 'elbo-diagnose', prompt: 'What did Reconstruction only leave out?', options: [
        { id: 'elbo-diagnose-klprior', text: 'KL(q || prior), the term subtracted inside the bound.', correct: true, why: 'That term penalizes guesses that depart from the prior. The gap to log P(bright) is a different KL: KL(q || posterior).' },
        { id: 'elbo-diagnose-swap', text: 'KL(prior || q). Swapping the arguments gives the same number.', why: 'KL has a direction. Swapping its arguments generally changes the value.' },
        { id: 'elbo-diagnose-none', text: 'Nothing. Better reconstruction always means a higher bound.', why: 'A reconstruction gain can be outweighed by the KL term.' },
      ] },
      { id: 'elbo-explain', prompt: 'Why does matching the posterior make the bound tight?', options: [
        { id: 'elbo-explain-match', text: 'The gap is KL(q || posterior), which is zero when they match.', correct: true, why: 'Each recorded update computes that identity. A hard zero can prevent the guess from reaching the posterior.' },
        { id: 'elbo-explain-klpriorzero', text: 'The gap is KL(q || prior), so matching the prior is enough.', why: 'KL(q || prior) is inside the bound. The gap uses the posterior, after the reading.' },
        { id: 'elbo-explain-vae', text: 'Every update budget is guaranteed to finish with a zero gap.', why: 'A finite update budget or a hard zero can leave a nonzero gap.' },
      ] },
    ],
    rules: [
      'One supplied bright reading, three fixed causes, and no reward. Settings change the starting guess, number of updates or update size, not the sensor table.',
      'Reconstruction = E_q log P(bright | cause). ELBO = reconstruction - KL(q || prior). Gap = log P(bright) - ELBO = KL(q || posterior).',
      'KL included multiplies the current guess by a power of the joint probability and renormalizes. Reconstruction only multiplies by a power of the likelihood. Neither copies a stored posterior.',
      'A zero weight stays zero; 0 log 0 contributes zero. The experiment stops when its chosen update budget is used. These are probability updates, not robot movements or neural-network training.',
    ],
    sketch: { label: 'A guess must account for both the reading and the prior', nodes: [
      { id: 'prior', label: 'Prior', x: 55, y: 30 }, { id: 'reading', label: 'Bright', x: 55, y: 90 }, { id: 'guess', label: 'Guess q', x: 245, y: 60 },
    ], edges: [{ from: 'prior', to: 'guess', label: 'KL' }, { from: 'reading', to: 'guess', label: 'likelihood' }] },
  });
})();
