#!/bin/bash
# A22 discovery launcher: two node processes (seeds 2,4,6 / 8,10); durable markers after BOTH exits.
cd "$(dirname "$0")"
rm -f a22-STATUS-success a22-STATUS-failed
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(
  VPO_SEEDS=2,4,6 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 3600 node exp/vpo-a22.js frozen a22-proc1.json > a22-proc1.log 2>&1
  echo "$?" > /tmp/a22-exit1
) &
P1=$!
(
  VPO_SEEDS=8,10 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 3600 node exp/vpo-a22.js frozen a22-proc2.json > a22-proc2.log 2>&1
  echo "$?" > /tmp/a22-exit2
) &
P2=$!
wait $P1; E1=$(cat /tmp/a22-exit1)
wait $P2; E2=$(cat /tmp/a22-exit2)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$E1" = "0" ] && [ "$E2" = "0" ] && [ -s a22-proc1.json ] && [ -s a22-proc2.json ]; then
  printf "success start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a22-STATUS-success
else
  printf "failed start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a22-STATUS-failed
fi
