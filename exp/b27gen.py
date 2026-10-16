# Batch 27: the fetch world with a PPO-like sentence and different rewards. Writes exp/b27.json.
import json
ppo = {"family": "pg", "batch": 8, "group": "none", "credit": "togo", "baseline": "critic", "adv": "gae", "scale": "none",
       "ratio": "clip", "epochs": 4, "lr": 0.003, "bonus": 0}
base = dict(maxSteps=60, throwMax=1.2, found=1, timeCost=0.01, shaping=0, closerW=1, facingW=0, spinCost=0, bringBack=0)


def K(**o):
    d = dict(base)
    d.update(o)
    return d


cfgs = []
for steps in (30000, 60000):
    for name, k in [("plain", K()), ("closer1", K(shaping=1, closerW=1)), ("closer1w2", K(shaping=1, closerW=2)),
                    ("pbrs", K(shaping=2, closerW=1)), ("facing05", K(facingW=0.05)), ("facing05t0", K(facingW=0.05, timeCost=0))]:
        cfgs.append({"name": f"f-{name}-{steps // 1000}k", "world": "fetch", "knobs": k, "parts": ppo, "steps": steps, "seeds": 3})
json.dump(cfgs, open('exp/b27.json', 'w'), indent=1)
print(len(cfgs), 'configs')
