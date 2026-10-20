"""Exercise the real watchdog on MBP with a virtual cgroup clock and real owned children.
No Linux scope, remote tests or infrastructure changes are needed.
"""
import contextlib, io, json, os, pathlib, runpy, signal, subprocess, sys, tempfile, time, unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
RealPath = pathlib.Path
read_text = RealPath.read_text

class BudgetTest(unittest.TestCase):
    def test_budget_kills_children_and_cannot_be_retried(self):
        with tempfile.TemporaryDirectory(prefix='bb-fast-budget-') as temp:
            root = RealPath(temp); scope = root/'robot-bb-fast-mode154.scope'; scope.mkdir()
            proc = root/'proc'; proc.write_text('0::/robot-bb-fast-mode154.scope\n')
            for name,value in {'memory.high':str(7*1024**3),'memory.max':str(8*1024**3),'memory.swap.max':'0','memory.current':'100000000','memory.peak':'100000000','cgroup.events':'populated 1'}.items(): (scope/name).write_text(value)
            (root/'memory.current').write_text('6000000000')
            fixture = subprocess.check_output(['node','-e', "const s=require('./scripts/fast-source'),C=s.content(),l=C.levels.find(x=>x.id==='fetch'),c=s.exact.resolve({world:l.world,parts:l.start,knobs:l.knobs,hyper:C.hyperOf(l.start,l.world),steps:10000000},[101,202,303],s.source().versions,C);console.log(s.exact.stringify({versions:c.versions,entries:[{key:s.hash(s.exact.stringify(c)),config:c}]}));"],cwd=ROOT,text=True)
            manifest=root/'manifest.json';manifest.write_text(fixture)
            output=root/'out'
            def path(value, *args):
                if value=='/sys/fs/cgroup': return root
                if value=='/proc/self/cgroup': return proc
                return RealPath(value,*args)
            started=time.monotonic()
            def clock_read(p,*args,**kwargs):
                if p==scope/'cpu.stat': return 'usage_usec '+str(int((time.monotonic()-started)*20*1e6))+'\n'
                return read_text(p,*args,**kwargs)
            argv=[str(ROOT/'scripts/fast-campaign.py'),str(manifest),str(output),'--workers','2','--cpu-seconds','20','--wall-seconds','60']
            old_signals={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT)}
            try:
                with patch('pathlib.Path',side_effect=path),patch.object(RealPath,'read_text',clock_read),patch.object(sys,'argv',argv):
                    with self.assertRaises(SystemExit) as exit: runpy.run_path(argv[0],run_name='__main__')
                self.assertEqual(exit.exception.code,2)
                progress=json.loads((output/'progress.json').read_text())
                self.assertEqual(progress['state'],'cpu-budget-stop');self.assertLess(progress['cpuSeconds'],20)
                self.assertEqual(len(progress['active']),1)  # one exact key, not three seed jobs
                self.assertEqual(len(progress['completed']),0);self.assertEqual(len(progress['missing']),1)
                for pid in progress['active'].values():
                    with self.assertRaises(ProcessLookupError): os.kill(pid,0)
                with patch('pathlib.Path',side_effect=path),patch.object(RealPath,'read_text',clock_read),patch.object(sys,'argv',argv),patch('subprocess.Popen') as spawn:
                    with self.assertRaises(SystemExit) as retry: runpy.run_path(argv[0],run_name='__main__')
                    self.assertIn('new instruction',str(retry.exception));spawn.assert_not_called()
            finally:
                for s,handler in old_signals.items(): signal.signal(s,handler)

if __name__=='__main__': unittest.main()
