#!/bin/bash
# A21b continuation: ONLY the two nonstarted seeds 19 and 29, one unchanged exp/vpo-a21.js
# invocation per seed via VPO_SEEDS (single-seed lists), timeout 1200s each, max 2 heavy processes.
cd "$(dirname "$0")"
rm -f a21b-STATUS-success a21b-STATUS-failed
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(
  VPO_SEEDS=19 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 1200 node exp/vpo-a21.js frozen a21b-seed19.json > a21b-seed19.log 2>&1
  echo "$?" > /tmp/a21b-exit1
) &
P1=$!
(
  VPO_SEEDS=29 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 1200 node exp/vpo-a21.js frozen a21b-seed29.json > a21b-seed29.log 2>&1
  echo "$?" > /tmp/a21b-exit2
) &
P2=$!
wait $P1; E1=$(cat /tmp/a21b-exit1)
wait $P2; E2=$(cat /tmp/a21b-exit2)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$E1" = "0" ] && [ "$E2" = "0" ] && [ -s a21b-seed19.json ] && [ -s a21b-seed29.json ]; then
  printf "success start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a21b-STATUS-success
else
  printf "failed start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a21b-STATUS-failed
fi
