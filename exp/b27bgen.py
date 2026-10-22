# Batch 27b: where the facing bonus starts to win, the closer-only reward at larger weights, bring-it-back, short budgets.
import json
ppo = {"family": "pg", "batch": 8, "group": "none", "credit": "togo", "baseline": "critic", "adv": "gae", "scale": "none",
       "ratio": "clip", "epochs": 4, "lr": 0.003, "bonus": 0}
reinforce = {"family": "pg", "batch": 4, "group": "none", "credit": "togo", "baseline": "none", "adv": "gae", "scale": "none",
             "ratio": "plain", "epochs": 1, "lr": 0.003, "bonus": 0}
base = dict(maxSteps=60, throwMax=1.2, found=1, timeCost=0.01, shaping=0, closerW=1, facingW=0, spinCost=0, bringBack=0)


def K(**o):
    d = dict(base)
    d.update(o)
    return d


cfgs = []
for fw in (0.01, 0.02, 0.03):
    cfgs.append({"name": f"f-facing{int(fw * 100):02d}-30k", "world": "fetch", "knobs": K(facingW=fw), "parts": ppo, "steps": 30000, "seeds": 3})
for w in (3,):
    cfgs.append({"name": f"f-closer1w{w}-30k", "world": "fetch", "knobs": K(shaping=1, closerW=w), "parts": ppo, "steps": 30000, "seeds": 3})
    cfgs.append({"name": f"f-closer1w{w}t0-30k", "world": "fetch", "knobs": K(shaping=1, closerW=w, timeCost=0), "parts": ppo, "steps": 30000, "seeds": 3})
cfgs.append({"name": "f-plain-t0-30k", "world": "fetch", "knobs": K(timeCost=0), "parts": ppo, "steps": 30000, "seeds": 3})
cfgs.append({"name": "f-back-60k", "world": "fetch", "knobs": K(bringBack=1, maxSteps=120), "parts": ppo, "steps": 60000, "seeds": 3})
cfgs.append({"name": "f-back-pbrs-60k", "world": "fetch", "knobs": K(bringBack=1, maxSteps=120, shaping=2), "parts": ppo, "steps": 60000, "seeds": 3})
for steps in (10000, 20000):
    cfgs.append({"name": f"f-plain-{steps // 1000}k", "world": "fetch", "knobs": K(), "parts": ppo, "steps": steps, "seeds": 3})
    cfgs.append({"name": f"f-facing05-{steps // 1000}k", "world": "fetch", "knobs": K(facingW=0.05), "parts": ppo, "steps": steps, "seeds": 3})
    cfgs.append({"name": f"f-pbrs-{steps // 1000}k", "world": "fetch", "knobs": K(shaping=2), "parts": ppo, "steps": steps, "seeds": 3})
cfgs.append({"name": "f-reinforce-plain-30k", "world": "fetch", "knobs": K(), "parts": reinforce, "steps": 30000, "seeds": 3})
cfgs.append({"name": "f-reinforce-facing05-30k", "world": "fetch", "knobs": K(facingW=0.05), "parts": reinforce, "steps": 30000, "seeds": 3})
json.dump(cfgs, open('exp/b27b.json', 'w'), indent=1)
print(len(cfgs), 'configs')
