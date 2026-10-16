# Learning by doing: what the evidence supports (read 15 Oct 2026)

OpenResearch was not reachable (laptop tunnel down), so the abstracts were read directly from Semantic Scholar and
OpenAlex (`*.json` in this folder). Numbers below are only those printed in the abstracts I read.

| Idea | Source (meta-analysis unless stated) | Measured result in the abstract | Limit |
|---|---|---|---|
| Free discovery hurts; guided discovery helps | Alfieri et al. 2011, J. Educ. Psych., 164 studies | Unassisted discovery vs explicit teaching d = -0.38; enhanced discovery (feedback, worked examples, scaffolding, elicited explanations) d = +0.30 | Mostly school students |
| Try first, then be taught (productive failure) | Sinha and Kapur 2021, Rev. Educ. Res., 53 studies | Problem solving then instruction vs the reverse: g = 0.36; 0.37 to 0.58 with high fidelity to productive failure | Reversed for young children and domain-general skills |
| Invent with contrasting cases, told afterwards | Schwartz et al. 2011, J. Educ. Psych. (2 experiments, N = 128, 120) | Equal procedure skill, better deep structure and more transfer than tell-then-practice | Two studies, physics, adolescents |
| Practice testing and spacing | Dunlosky et al. 2013, Psych. Sci. Public Interest (review of 10 techniques) | Only practice testing and distributed practice rated high utility; self-explanation and interleaving moderate; rereading and highlighting low | Narrative rating, not one effect size |
| Recall beats recognition | Rowland 2014, Psych. Bull. | Recall tests give larger testing benefits than recognition tests | Effect size not in the abstract |
| Spacing gap should grow with the retention interval | Cepeda et al. 2006, Psych. Bull., 317 experiments | The best gap between sessions grows as the retention interval grows | Verbal recall tasks |
| Interleave similar categories | Brunmair and Richter 2019, Psych. Bull., 59 studies | g = 0.42 overall; stronger when categories look alike | Words favored blocking (g = -0.39) |
| Elaborated feedback | Van der Kleij et al. 2015, Rev. Educ. Res., 40 studies | Explanation feedback 0.49; right/wrong only 0.05; correct answer 0.32; EF best for higher-order outcomes | Computer-based item feedback |
| Predict before a demo | Crouch et al. 2004, Am. J. Phys. (classroom study) | Watching a demo passively gives no better understanding than no demo; predicting first gives significantly greater understanding | One course |
| Games | Wouters et al. 2013 (d = 0.29); Clark et al. 2016 (g = 0.33; augmented designs +0.34) | Games help more with other instruction, several sessions, and good design | Mostly K-16 |
| Active learning | Freeman et al. 2014, PNAS, 225 studies | +0.47 SD on exams and concept inventories | University STEM courses |

## Top three for Breaking Bellman

1. Guided invention, then consolidation (Alfieri 2011; Sinha and Kapur 2021; Schwartz 2011): free building is kept, but with
   contrasting cases (two sentences that differ by one word, run side by side) and a consolidation step that compares
   the learner's sentence with the published one, word by word.
2. Spaced, interleaved retrieval by rebuilding (Dunlosky 2013; Rowland 2014; Cepeda 2006; Brunmair and Richter 2019):
   a Review mode that shows a failure curve and a blank sentence; the learner rebuilds the method from memory, mixed
   across worlds. The page orders items by time since last practice and does not set due dates; a
   spaced-repetition tool can keep the schedule.
3. Predict, then explain, with elaborated feedback (Crouch 2004; Van der Kleij 2015; Dunlosky 2013 moderate): after each
   run, a "why did this word change the curve" question whose feedback is the one-update replay with real numbers.

Weakest point: almost all evidence comes from classrooms with school or university students, not from one adult who
learns alone on a phone. Self-explanation has the weakest support of the three in real educational settings.
