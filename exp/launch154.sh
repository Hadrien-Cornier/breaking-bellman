#!/usr/bin/env bash
# One authorized campaign, in fm-overflow's task scope; external process-group wall watchdog.
set -u
out=$1
manifest=$2
if [[ -e "$out" || -e "$out.launch.log" ]]; then echo 'REFUSE existing output/log' >&2; exit 5; fi
export VPO154_LAUNCH_EPOCH_MS=$(node -e 'process.stdout.write(String(Date.now()))')
printf 'LAUNCH_EPOCH_MS=%s WRAPPER_PID=%s\n' "$VPO154_LAUNCH_EPOCH_MS" "$$" >> "$out.launch.log"
env -u A25D_ALLOW_TEST_CAPS -u A25D_WORKER_OVERRIDE -u A25D_TEST_CAPS timeout --kill-after=5s 86400s node exp/campaign154.js "$out" "$manifest" &
owned_pid=$!
printf 'TIMEOUT_PID=%s\n' "$owned_pid" >> "$out.launch.log"
ps -o pid,ppid,pgid,args -p "$owned_pid" >> "$out.launch.log"
wait "$owned_pid"
rc=$?
printf 'TRUE_RC=%s END_AT=%s\n' "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$out.launch.log"
exit "$rc"
