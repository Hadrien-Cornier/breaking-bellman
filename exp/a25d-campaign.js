// A25d final-campaign driver (per 179, corrected per 180): ONE campaign. 2 concurrent lanes (max
// 2 heavy processes), global hard cap 24h elapsed FROM DRIVER ENTRY (includes manifest setup),
// per-seed hard cap 4h enforced by the driver: SIGTERM at the child's 4h deadline, SIGKILL
// escalation after a short grace (a CPU-bound worker cannot guarantee a SIGTERM flush; the
// preserved evidence on a kill is the LAST PRE-STAGE partial, never claimed as a post-stage flush).
// Event-driven via child exit/error events (no synchronous Atomics polling). NO retries/resume/seed
// replacement. Discovery seeds [2,4,6,8,10]; confirmation [31,33,35,37,39,41,43,45,47,49] ONLY if
// ALL discovery gates pass AND global time remains; incomplete confirmation = unmet gate (honest
// INCONCLUSIVE, never a truncated claim). End marker records TRUE rc BEFORE the date.
// TEST-ONLY overrides require A25D_ALLOW_TEST_CAPS=1 AND are documented in the manifest; production
// launch commands never set them.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const DIR = process.argv[2];
if (!DIR) { console.error('usage: node a25d-campaign.js <unique-dir>'); process.exit(2); }
if (fs.existsSync(DIR)) { console.error('REFUSE overwrite: ' + DIR + ' exists'); process.exit(5); }
const T0 = Date.now(); // global deadline starts at entry, BEFORE manifest setup (per 180)
fs.mkdirSync(DIR, { recursive: true });
const TEST_MODE = process.env.A25D_ALLOW_TEST_CAPS === '1';
const WORKER = TEST_MODE && process.env.A25D_WORKER_OVERRIDE ? process.env.A25D_WORKER_OVERRIDE : path.join(__dirname, 'a25d-campaign-seed.js');
const MANIFEST = require(__dirname + '/a25d-manifest.js').build();
const capsOverride = TEST_MODE && process.env.A25D_TEST_CAPS ? JSON.parse(process.env.A25D_TEST_CAPS) : null;
const GLOBALMS = capsOverride ? capsOverride.globalMs : MANIFEST.caps.globalMs;
const SEEDMS = capsOverride ? capsOverride.perSeedMs : MANIFEST.caps.perSeedMs;
const GRACE_MS = 2000; // SIGTERM -> SIGKILL escalation grace
const MIN_START = Math.min(120000, SEEDMS); // do not start a seed without meaningful time (scales down in test mode)
// immutable attempt identity written FIRST
const attemptId = 'a25d-final-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
fs.writeFileSync(path.join(DIR, 'attempt.json'), JSON.stringify({ attemptId, startedAtEpoch: Math.floor(T0 / 1000), launcher: 'exp/a25d-campaign.js', manifestFile: 'manifest.json', immutable: true, testMode: TEST_MODE }, null, 1));
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(MANIFEST, null, 1));
const CLOG = path.join(DIR, 'campaign.log');
const ap = (o) => fs.appendFileSync(CLOG, JSON.stringify(Object.assign({ atEpoch: Math.floor(Date.now() / 1000) }, o)) + '\n');
ap({ event: 'attempt-start', attemptId, commit: MANIFEST.gitCommitFull, globalDeadlineEpoch: Math.floor((T0 + GLOBALMS) / 1000), testMode: TEST_MODE });
const remaining = () => GLOBALMS - (Date.now() - T0);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// one seed child: own start/deadline stored ON the child object; event-driven exit; SIGKILL escalation
function runSeedChild(s, phase) {
  return new Promise((resolve) => {
    if (remaining() < MIN_START) { ap({ event: 'seed-not-started', seed: s, phase, remainingMs: remaining() }); resolve({ s, status: 'not-started', reason: 'global deadline' }); return; }
    const child = { s, phase, start: Date.now(), deadline: Date.now() + SEEDMS, sigtermAt: null, sigkillAt: null, globalKilled: false };
    child.cp = spawn('node', [WORKER, DIR, String(s)], { stdio: ['ignore', 'inherit', 'inherit'] });
    ap({ event: 'seed-launch', seed: s, phase, pid: child.cp.pid, deadlineEpoch: Math.floor(child.deadline / 1000), remainingMs: remaining() });
    const killer = setInterval(() => {
      if (Date.now() >= child.deadline && !child.sigtermAt && !child.globalKilled) {
        child.sigtermAt = Date.now(); try { child.cp.kill('SIGTERM'); } catch (e) {}
        ap({ event: 'seed-cap-sigterm', seed: s, phase, pid: child.cp.pid, note: 'preserved evidence = last pre-stage partial; SIGTERM flush NOT guaranteed for a CPU-bound worker' });
      }
      if (child.sigtermAt && Date.now() - child.sigtermAt >= GRACE_MS && !child.sigkillAt) {
        child.sigkillAt = Date.now(); try { child.cp.kill('SIGKILL'); } catch (e) {}
        ap({ event: 'seed-cap-sigkill', seed: s, phase, pid: child.cp.pid, note: 'escalated after ' + GRACE_MS + 'ms grace; child pid tracked for orphan check' });
      }
      if (remaining() <= 0 && !child.globalKilled && !child.sigtermAt) {
        child.globalKilled = true; child.sigtermAt = Date.now(); try { child.cp.kill('SIGTERM'); } catch (e) {}
        ap({ event: 'global-deadline-kill', seed: s, phase, pid: child.cp.pid });
      } else if (child.globalKilled && child.sigtermAt && Date.now() - child.sigtermAt >= GRACE_MS && !child.sigkillAt) {
        child.sigkillAt = Date.now(); try { child.cp.kill('SIGKILL'); } catch (e) {}
        ap({ event: 'global-deadline-sigkill', seed: s, phase, pid: child.cp.pid });
      }
    }, 250);
    child.cp.on('exit', (code, sig) => {
      clearInterval(killer);
      resolve({ s, status: code, signal: sig || null, pid: child.cp.pid, seedCapHit: child.sigtermAt !== null && code === null, killedBy: child.sigkillAt ? 'SIGKILL' : (child.sigtermAt ? 'SIGTERM' : null) });
    });
    child.cp.on('error', (e) => { clearInterval(killer); resolve({ s, status: null, error: String(e), pid: child.cp.pid }); });
  });
}
async function runSeeds(queue, phase) {
  const results = {};
  const q = queue.slice();
  while (q.length) {
    const batch = q.splice(0, MANIFEST.caps.lanes);
    const outs = await Promise.all(batch.map((s) => runSeedChild(s, phase)));
    for (const r of outs) { results[r.s] = r; ap(Object.assign({ event: 'seed-exit', phase, remainingMs: remaining() }, r)); }
  }
  return results;
}
(async () => {
  // ---- discovery phase
  const disc = await runSeeds(MANIFEST.seeds.discovery, 'discovery');
  const gates = require(__dirname + '/a25d-gates.js').evalDiscovery(DIR);
  fs.writeFileSync(path.join(DIR, 'gates-discovery.json'), JSON.stringify({ attemptId, gates, discoveryLaunch: disc, remainingMsAtGate: remaining() }, null, 1));
  ap({ event: 'discovery-gates', allDiscoveryPass: gates.allDiscoveryPass, primary: gates.primary || null, reason: gates.reason || null, remainingMs: remaining() });
  // ---- confirmation phase: ONLY if ALL discovery gates pass AND time remains for at least one seed
  let conf = null;
  if (gates.allDiscoveryPass && remaining() >= SEEDMS) {
    ap({ event: 'confirmation-start', remainingMs: remaining() });
    conf = await runSeeds(MANIFEST.seeds.confirmation, 'confirmation');
  } else {
    ap({ event: 'confirmation-skipped', reason: gates.allDiscoveryPass ? 'insufficient remaining time' : 'discovery gates unmet', remainingMs: remaining() });
  }
  const confGates = require(__dirname + '/a25d-gates.js').evalConfirmation(DIR);
  fs.writeFileSync(path.join(DIR, 'gates-final.json'), JSON.stringify({ attemptId, discovery: gates, confirmation: confGates, confirmationLaunched: !!conf, remainingMsAtEnd: remaining() }, null, 1));
  ap({ event: 'final-gates', allDiscoveryPass: gates.allDiscoveryPass, confirmation: confGates });
  // ---- end marker: TRUE rc BEFORE the date
  const bad = (r) => r.status !== 0;
  const anyIncomplete = Object.values(disc).some(bad) || (conf && Object.values(conf).some(bad)) || !gates.allDiscoveryPass || !confGates.allConfirmationPass;
  const rc = anyIncomplete ? 1 : 0;
  fs.appendFileSync(CLOG, 'TRUE_RC=' + rc + ' attemptId=' + attemptId + ' END_AT=' + new Date().toISOString() + '\n');
  console.log('CAMPAIGN END rc=' + rc + ' attemptId=' + attemptId);
  process.exit(rc);
})();
