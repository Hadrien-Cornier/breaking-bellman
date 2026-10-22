nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon"}' 20000 5 '{}' > exp/out/b1-1.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","replay":true}' 20000 5 '{}' > exp/out/b1-2.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","targetNet":true}' 20000 5 '{}' > exp/out/b1-3.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","replay":true,"targetNet":true}' 20000 5 '{}' > exp/out/b1-4.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","replay":true,"targetNet":true,"double":true}' 20000 5 '{}' > exp/out/b1-5.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"table","target":"td","explore":"epsilon"}' 20000 5 '{}' > exp/out/b1-6.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","replay":true,"targetNet":true}' 20000 5 '{"actionCopies":5,"rewardNoise":2}' > exp/out/b1-7.txt 2>&1
nice node exp/tools/smoke.js cartpole '{"repr":"net","target":"td","explore":"epsilon","replay":true,"targetNet":true,"double":true}' 20000 5 '{"actionCopies":5,"rewardNoise":2}' > exp/out/b1-8.txt 2>&1
