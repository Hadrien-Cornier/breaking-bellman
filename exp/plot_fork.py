# Figure for the fork rework (batches 19 to 23): demonstrator routes, head x chunk, mud pickers. Simulation.
import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
R = json.load(open('exp/tmp/routes.json'))
B = {x['name']: x['summary'] for x in json.load(open('exp/out/b23.json'))}
fig, ax = plt.subplots(1, 4, figsize=(17, 4.2))
for k, (tag, title) in enumerate([('old', f"Old demonstrator: {R['oldCrash']} of 50 episodes hit the obstacle"), ('new', f"New demonstrator: {R['newCrash']} of 50 hit it")]):
    a = ax[k]
    a.add_patch(plt.Circle((0, 0), 0.5, color='0.7'))
    a.add_patch(plt.Circle((0, 0.8), 0.08, fill=False, color='green', lw=2))
    for p in R[tag]:
        xs, ys = zip(*p['path']); a.plot(xs, ys, color='crimson' if p['crashed'] else 'k', lw=1, alpha=0.8)
    a.set_xlim(-1, 1); a.set_ylim(-1, 1); a.set_aspect('equal'); a.set_title(title, fontsize=9)
a = ax[2]
heads = ['gauss', 'det', 'flow']; lab = ['Gaussian', 'one action', 'flow']
import numpy as np
x = np.arange(3); w = 0.38
s1 = [B[f'tw-{h}-c1']['successRate'] * 100 for h in heads]; s10 = [B[f'tw-{h}-c10']['successRate'] * 100 for h in heads]
a.bar(x - w / 2, s1, w, label='1 command per decision', color='0.6'); a.bar(x + w / 2, s10, w, label='10 commands per decision', color='steelblue')
for i, h in enumerate(heads): a.text(x[i] + w / 2, s10[i] + 2, f"{B[f'tw-{h}-c10']['crashRate']:.1f} hits", ha='center', fontsize=8)
a.axhline(75, ls='--', color='k', lw=0.8); a.set_xticks(x, lab); a.set_ylabel('success (%)'); a.set_ylim(0, 115)
a.set_title('Copy from one home pose, 3 seeds x 20 tests', fontsize=9); a.legend(fontsize=7, loc='upper left')
a = ax[3]
picks = ['one', 'best', 'qavg', 'edit']; plab = ['one proposal', 'best of 8', 'Q-weighted avg', 'edit (EXPO)']
v = [B[f'pk-{p}']['leftRate'] * 100 for p in picks]
a.bar(range(4), v, color=['crimson', 'steelblue', 'steelblue', 'steelblue']); a.axhline(10, ls='--', color='k', lw=0.8)
a.set_xticks(range(4), plab, fontsize=8); a.set_ylabel('tests through the mud (%)'); a.set_title('Frozen flow policy + critic, mud on the left', fontsize=9)
fig.suptitle('Fork world rework, 15 Oct 2026 (Simulation)', fontsize=10)
fig.tight_layout(); fig.savefig('exp/plots/fork-rework.png', dpi=110)
print('exp/plots/fork-rework.png')
