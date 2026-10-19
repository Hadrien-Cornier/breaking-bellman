#!/bin/bash
# A21 launcher: two node processes, 5 seeds each; durable markers written only after BOTH exits.
cd "$(dirname "$0")"
rm -f a21-STATUS-success a21-STATUS-failed
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(
  VPO_SEEDS=11,13,15,17,19 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 2400 node exp/vpo-a21.js frozen a21-proc1.json > a21-proc1.log 2>&1
  echo "$?" > /tmp/a21-exit1
) &
P1=$!
(
  VPO_SEEDS=21,23,25,27,29 VPO_EVAL_EPS=0 VPO_K=8 VPO_CONTRACT=paper timeout 2400 node exp/vpo-a21.js frozen a21-proc2.json > a21-proc2.log 2>&1
  echo "$?" > /tmp/a21-exit2
) &
P2=$!
wait $P1; E1=$(cat /tmp/a21-exit1)
wait $P2; E2=$(cat /tmp/a21-exit2)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$E1" = "0" ] && [ "$E2" = "0" ] && [ -s a21-proc1.json ] && [ -s a21-proc2.json ]; then
  printf "success start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a21-STATUS-success
else
  printf "failed start=%s end=%s exit1=%s exit2=%s pids=%s,%s\n" "$START" "$END" "$E1" "$E2" "$P1" "$P2" > a21-STATUS-failed
fi
