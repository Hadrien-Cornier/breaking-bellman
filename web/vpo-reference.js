// Frozen synthetic154 discovery measurements. Source scope: docs/vpo-reference154.md.
window.BB_VPO_REFERENCE = {
  "attemptId": "a26-hard154-v1",
  "aggregates": {
    "base": {
      "best1": 0.44666666666666666,
      "best3": 0.61578125,
      "best5": 0.6634895833333333,
      "best10": 0.7159895833333334,
      "best30": 0.7682291666666667,
      "growth30_3": 0.15244791666666674,
      "spreadL1": 0.9644473180076618,
      "exitFraction": 0.629548611111111
    },
    "grpo-single": {
      "best1": 0.5163020833333334,
      "best3": 0.61625,
      "best5": 0.6569791666666667,
      "best10": 0.69375,
      "best30": 0.72953125,
      "growth30_3": 0.11328124999999997,
      "spreadL1": 0.5930713601532556,
      "exitFraction": 0.7008680555555555
    },
    "vpo": {
      "best1": 0.46213541666666663,
      "best3": 0.6441145833333333,
      "best5": 0.6799479166666667,
      "best10": 0.7186458333333333,
      "best30": 0.7525520833333333,
      "growth30_3": 0.10843750000000008,
      "spreadL1": 1.0990842911877403,
      "exitFraction": 0.6008680555555556
    },
    "multi-rlvr": {
      "best1": 0.42671875000000004,
      "best3": 0.530625,
      "best5": 0.5832291666666667,
      "best10": 0.6403125000000001,
      "best30": 0.6988541666666668,
      "growth30_3": 0.1682291666666667,
      "spreadL1": 0.643477011494252,
      "exitFraction": 0.6204166666666666
    },
    "random-w": {
      "best1": 0.5777604166666667,
      "best3": 0.6554166666666668,
      "best5": 0.6858854166666667,
      "best10": 0.7183333333333334,
      "best30": 0.7535937500000001,
      "growth30_3": 0.09817708333333328,
      "spreadL1": 0.5270694444444445,
      "exitFraction": 0.8025347222222223
    }
  },
  "gateTable": [
    {
      "name": "VPO - GRPO @30",
      "value": 0.02302083333333336,
      "threshold": ">= 0.05",
      "passGate": false
    },
    {
      "name": "VPO growth 3 to 30",
      "value": 0.10843750000000008,
      "threshold": ">= 0.05",
      "passGate": true
    },
    {
      "name": "GRPO growth 3 to 30",
      "value": 0.11328124999999997,
      "threshold": "<= 0.02",
      "passGate": false
    },
    {
      "name": "VPO > GRPO seeds",
      "value": 4,
      "threshold": ">= 4/5",
      "passGate": true
    },
    {
      "name": "VPO growth positive seeds",
      "value": 5,
      "threshold": ">= 4/5",
      "passGate": true
    },
    {
      "name": "GRPO flat seeds",
      "value": 0,
      "threshold": ">= 4/5",
      "passGate": false
    },
    {
      "name": "MultiRLVR growth 3 to 30",
      "value": 0.1682291666666667,
      "threshold": "<= 0.02",
      "passGate": false
    },
    {
      "name": "VPO - MultiRLVR @30",
      "value": 0.05369791666666661,
      "threshold": ">= 0.03",
      "passGate": true
    },
    {
      "name": "Both arms at finite reference",
      "value": 0.0,
      "threshold": "<= 0.80",
      "passGate": true
    }
  ]
};
