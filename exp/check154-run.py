"""One enforcing 120s TOTAL integration window, child output retained on failure."""
import subprocess,time,sys,os,signal
start=time.monotonic()
commands=[['node','exp/check154.js'],['node','exp/a25d-checks.js'],['node','exp/a25d-integration-checks.js'],['node','exp/orchestration154-test.js']]
for cmd in commands:
    left=120-(time.monotonic()-start)
    print('COMMAND',cmd,'remaining',left,flush=True)
    if left<=0:sys.exit(124)
    p=subprocess.Popen(cmd,start_new_session=True)
    try: rc=p.wait(timeout=left)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,signal.SIGKILL);p.wait();sys.exit(124)
    if rc:sys.exit(rc)
print('ALL154 CHECKS PASS TOTAL_SECONDS',time.monotonic()-start,flush=True)
