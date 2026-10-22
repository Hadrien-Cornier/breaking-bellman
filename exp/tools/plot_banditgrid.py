# Heatmap of the 16 bandit combinations (exp/logs/banditgrid.out). Simulation.
import re, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
rows = []
for line in open('exp/logs/banditgrid.out'):
    m = re.match(r'(eps |    ) (ucb |    ) (opt |    ) (\w+)\s+best machine ([\d.]+)% ± ([\d.]+)', line)
    if m: rows.append((m.group(1).strip() == 'eps', m.group(2).strip() == 'ucb', m.group(3).strip() == 'opt', m.group(4), float(m.group(5)), float(m.group(6))))
R = [(True, False), (True, True), (False, False), (False, True)]          # (eps, ucb)
Cc = [(False, 'const'), (False, 'avg'), (True, 'const'), (True, 'avg')]  # (opt, step)
rl = ['ε, no bonus', 'ε + bonus', 'greedy, no bonus', 'greedy + bonus']
cl = ['start 0\nfixed share', 'start 0\naverage', 'start +5\nfixed share', 'start +5\naverage']
M = [[next(r for r in rows if (r[0], r[1]) == a and (r[2], r[3]) == b) for b in Cc] for a in R]
fig, ax = plt.subplots(figsize=(7.2, 4.6))
im = ax.imshow([[c[4] for c in row] for row in M], cmap='RdYlGn', vmin=35, vmax=85)
for i, row in enumerate(M):
    for j, c in enumerate(row):
        ax.text(j, i, f'{c[4]:.1f}%\n±{c[5]:.1f}', ha='center', va='center', fontsize=10)
ax.set_xticks(range(4), cl); ax.set_yticks(range(4), rl)
ax.set_title('Ten slot machines: % of the last 200 pulls on the best machine\n200 seeds × 1000 pulls, ± standard error. Simulation.', fontsize=10)
fig.colorbar(im, ax=ax, shrink=0.8)
fig.tight_layout(); fig.savefig('exp/plots/bandit-combos.png', dpi=130)
print('saved')
