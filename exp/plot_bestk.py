#!/usr/bin/env python3
"""Plot per-k best@k means for one frozen run JSON.

Guard: asserts the run contains EXACTLY the final seed set [1,3,5,7,9] (n=5)
before any figure is produced (per 031/048 figure-only corrections).
"""
import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

EXACT_SEEDS = [1, 3, 5, 7, 9]
KS = ["1", "2", "4", "8", "16", "30"]
ARMS = [("base", "#1f77b4"), ("grpo-single", "#ff7f0e"), ("vpo", "#2ca02c")]


def main(src, dst):
    with open(src) as f:
        d = json.load(f)
    seeds = [r["seed"] for r in d["runs"]]
    assert seeds == EXACT_SEEDS, f"seed guard failed: {seeds} != {EXACT_SEEDS}"
    assert len(d["runs"]) == 5, f"n=5 guard failed: {len(d['runs'])}"
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    ax = axes[0]
    for arm, color in ARMS:
        ys = [[r["arms"][arm]["mean"][k] for k in KS] for r in d["runs"]]
        mean = [sum(col) / len(col) for col in zip(*ys)]
        lo = [min(col) for col in zip(*ys)]
        hi = [max(col) for col in zip(*ys)]
        ax.plot(range(len(KS)), mean, marker="o", color=color, label=arm)
        ax.fill_between(range(len(KS)), lo, hi, color=color, alpha=0.15)
    ax.set_xticks(range(len(KS)))
    ax.set_xticklabels([f"best@{k}" for k in KS], fontsize=8)
    ax.set_title(f"per-k mean over seeds (n={len(seeds)})")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    ax = axes[1]
    for arm, color in ARMS:
        ys = [r["arms"][arm]["spread"] for r in d["runs"]]
        mean = sum(ys) / len(ys)
        ax.bar(arm, mean, color=color)
    ax.set_title(f"mean spread over seeds (n={len(seeds)})")
    ax.grid(alpha=0.3)
    fig.suptitle(dst.split("/")[-1].replace(".png", "") + f"  seeds={seeds}")
    fig.tight_layout()
    fig.savefig(dst, dpi=120)
    print("wrote", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
