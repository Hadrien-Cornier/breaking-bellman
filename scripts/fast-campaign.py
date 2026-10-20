#!/usr/bin/env python3
"""Bounded simulation only. cgroup CPU includes the parent, all children and overhead.
Stop 10 CPU seconds before the authorized bound to reserve shutdown/accounting work.
No budget-stop retry; checkpoints survive a crash and valid complete keys are skipped.
"""
import argparse, concurrent.futures, hashlib, json, os, pathlib, signal, subprocess, time, gzip

p = argparse.ArgumentParser()
p.add_argument('manifest'); p.add_argument('output'); p.add_argument('--workers', type=int, default=2)
p.add_argument('--scope', choices=['robot-bb-fast-mode154.scope','robot-bb-fast-neighbors154.scope'], default='robot-bb-fast-mode154.scope')
p.add_argument('--cpu-seconds', type=float, default=108000); p.add_argument('--wall-seconds', type=float, default=86400)
a = p.parse_args()
cpu_max, wall_max = (1080000, 1209600) if a.scope == 'robot-bb-fast-neighbors154.scope' else (108000, 86400)
if not 1 <= a.workers <= 2 or not 10 < a.cpu_seconds <= cpu_max or not 10 < a.wall_seconds <= wall_max: raise SystemExit('invalid limits')
out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
def atomic(name, data):
    target = out / name; temp = target.with_suffix('.tmp'); temp.write_text(json.dumps(data, indent=2)+'\n'); temp.replace(target)
manifest_bytes = pathlib.Path(a.manifest).read_bytes(); manifest = json.loads(manifest_bytes)
scope = pathlib.Path('/sys/fs/cgroup') / next(x.split(':',2)[2].strip().lstrip('/') for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0:'))
if scope.name != a.scope: raise SystemExit('requires own '+a.scope)
def cpu(): return int(dict(line.split() for line in (scope/'cpu.stat').read_text().splitlines())['usage_usec']) / 1e6
def memory(): return int((scope/'memory.current').read_text())
limits = {f: (scope/f).read_text().strip() for f in ['memory.high','memory.max','memory.swap.max']}
if int(limits['memory.high']) > 7516192768 or int(limits['memory.max']) > 8589934592 or limits['memory.swap.max'] != '0': raise SystemExit('scope limits unsafe')
progress_file = out/'progress.json'; previous = json.loads(progress_file.read_text()) if progress_file.exists() else None
if previous and previous['state'] in ['cpu-budget-stop','wall-budget-stop']: raise SystemExit('budget stopped; new instruction required')
digest = hashlib.sha256(manifest_bytes).hexdigest()
if previous and previous['manifestSHA256'] != digest: raise SystemExit('manifest changed')
scope_id = (scope/'cgroup.events').stat().st_ino
carry = (previous['cpuSeconds'] if previous and previous.get('scopeID') != scope_id else 0)
start = previous['startedEpoch'] if previous else time.time()
state = {'state':'running','startedEpoch':start,'startedUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(start)),
         'deadlineUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(start+a.wall_seconds)), 'scope':str(scope),'scopeID':scope_id,
         'manifestSHA256':digest,'pid':os.getpid(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
         'command':__import__('sys').argv,'limits':limits,'cpuCapSeconds':a.cpu_seconds,'wallCapSeconds':a.wall_seconds,
         'workers':a.workers,'completed':{},'failures':{},'active':{},'cpuSeconds':carry+cpu(),'peakBytes':0}
if previous: state['failures'] = previous.get('failures',{})
atomic('launch.json',state)
# Verify compressed records and exact config, never turn a missing/corrupt result into success.
todo = []
for e in manifest['entries']:
    if carry+cpu() >= a.cpu_seconds-10 or time.time()-start >= a.wall_seconds-10:
        state.update(state='cpu-budget-stop' if carry+cpu() >= a.cpu_seconds-10 else 'wall-budget-stop',cpuSeconds=carry+cpu())
        atomic('progress.json',state)
        raise SystemExit('budget stop during recovery; new instruction required')
    f = out/'records'/(e['key']+'.json.gz')
    if f.exists():
        try:
            blob = f.read_bytes(); r = json.loads(gzip.decompress(blob))
            assert r['schema']=='bb-full-results-v1' and r['key']==e['key'] and r['config']==e['config']
            assert [v['seed'] for v in r['results']]==e['config']['seeds']
            state['completed'][e['key']]={'gzipBytes':len(blob),'sha256':hashlib.sha256(blob).hexdigest(),'recovered':True}
            continue
        except Exception as ex: raise SystemExit('corrupt complete record '+str(f)+': '+str(ex))
    if e['key'] not in state['failures']: todo.append(e)
children = {}; stopped = False
def terminate():
    for proc in children.values():
        if proc.poll() is None:
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
def interrupted(sig, frame):
    global stopped
    stopped = True; state['state']='interrupted'; terminate()
signal.signal(signal.SIGTERM,interrupted); signal.signal(signal.SIGINT,interrupted)
runner = pathlib.Path(__file__).with_name('fast-run-one.js')
try:
    while todo or children:
        used = carry + cpu(); elapsed = time.time()-start
        if used >= a.cpu_seconds-10 or elapsed >= a.wall_seconds-10:
            state['state']='cpu-budget-stop' if used >= a.cpu_seconds-10 else 'wall-budget-stop'; stopped=True; terminate()
        if stopped:
            for proc in children.values(): proc.wait()
            break
        # Voluntary documented aggregate bound, even if infrastructure has a higher limit.
        shared = int((scope.parent/'memory.current').read_text())
        slots = a.workers if shared < 12*1024**3 else 1
        while todo and len(children)<slots:
            e = todo.pop(0); key=e['key']
            log = open(out/(key+'.stdout'),'w'); err = open(out/(key+'.stderr'),'w')
            proc = subprocess.Popen(['node',str(runner),json.dumps({'manifestPath':str(pathlib.Path(a.manifest).resolve()),'output':str(out.resolve()),'key':key})],stdout=log,stderr=err,start_new_session=True)
            log.close(); err.close(); children[key]=proc; state['active'][key]=proc.pid
        for key, proc in list(children.items()):
            rc = proc.poll()
            if rc is None: continue
            if rc==0:
                try: state['completed'][key]=dict(json.loads((out/(key+'.stdout')).read_text()), exitCode=rc)
                except Exception as ex: state['failures'][key]={'exitCode':rc,'error':str(ex)}
            else: state['failures'][key]={'exitCode':rc,'stderr':(out/(key+'.stderr')).read_text()[-4000:]}
            del children[key]; del state['active'][key]
        state.update(cpuSeconds=carry+cpu(),wallSeconds=time.time()-start,peakBytes=max(state['peakBytes'],memory()),sharedBytes=shared)
        atomic('progress.json',state)
        time.sleep(.25)
    if not stopped: state['state']='complete' if len(state['completed'])==len(manifest['entries']) else 'incomplete'
finally:
    terminate()
    state.update(cpuSeconds=carry+cpu(),wallSeconds=time.time()-start,peakBytes=max(state['peakBytes'],int((scope/'memory.peak').read_text())),finishedUTC=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    state['missing']=[e['key'] for e in manifest['entries'] if e['key'] not in state['completed']]
    atomic('progress.json',state)
raise SystemExit(0 if state['state']=='complete' else 2)
