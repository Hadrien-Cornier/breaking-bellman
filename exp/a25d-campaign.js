// A25d final-campaign driver (per 179): ONE campaign. 2 concurrent lanes (max 2 heavy processes),
// global hard cap 24h elapsed from launch, per-seed hard cap 4h enforced by a child-side timeout
// kill (SIGTERM -> worker flushes an interrupted partial). NO retries/resume/seed replacement.
// Discovery seeds [2,4,6,8,10]; confirmation [31,33,35,37,39,41,43,45,47,49] ONLY if ALL discovery
// gates pass AND global time remains; unstarted/incomplete confirmation seeds are unmet gates
// (honest INCONCLUSIVE, never a truncated claim). End marker records TRUE rc BEFORE the date.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const DIR = process.argv[2];
if (!DIR) { console.error('usage: node a25d-campaign.js <unique-dir>'); process.exit(2); }
if (fs.existsSync(DIR)) { console.error('REFUSE overwrite: ' + DIR + ' exists'); process.exit(5); }
fs.mkdirSync(DIR, { recursive: true });
const MANIFEST = require(__dirname + '/a25d-manifest.js').build();
// immutable attempt identity written FIRST
const attemptId = 'a25d-final-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
fs.writeFileSync(path.join(DIR, 'attempt.json'), JSON.stringify({ attemptId, startedAtEpoch: Math.floor(Date.now() / 1000), launcher: 'exp/a25d-campaign.js', manifestFile: 'manifest.json', immutable: true }, null, 1));
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(MANIFEST, null, 1));
const CLOG = path.join(DIR, 'campaign.log');
const ap = (o) => fs.appendFileSync(CLOG, JSON.stringify(Object.assign({ atEpoch: Math.floor(Date.now() / 1000) }, o)) + '\n');
ap({ event: 'attempt-start', attemptId, commit: MANIFEST.gitCommitFull });
const T0 = Date.now();
const GLOBALMS = MANIFEST.caps.globalMs, SEEDMS = MANIFEST.caps.perSeedMs;
const remaining = () => GLOBALMS - (Date.now() - T0);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// run a seed queue with at most `lanes` concurrent workers; global deadline kills running workers
function runSeeds(queue, phase) {
  const results = {};
  const q = queue.slice();
  while (q.length) {
    const batch = q.splice(0, MANIFEST.caps.lanes);
    const running = [];
    for (const s of batch) {
      if (remaining() < 120000) { results[s] = { status: 'not-started', reason: 'global deadline' }; ap({ event: 'seed-not-started', seed: s, phase, remainingMs: remaining() }); continue; }
      ap({ event: 'seed-launch', seed: s, phase, remainingMs: remaining() });
      running.push({ s, cp: spawn('node', [path.join(__dirname, 'a25d-campaign-seed.js'), DIR, String(s)], { stdio: ['ignore', 'inherit', 'inherit'] }) });
    }
    // per-child 4h hard cap: kill this child with SIGTERM when its own window elapses
    const starts = running.map((r) => Date.now());
    let live = running.slice();
    while (live.length) {
      for (let i = 0; i < live.length; i++) {
        const { s, cp } = live[i];
        if (Date.now() - starts[i] >= SEEDMS && !cp.signalCode && cp.exitCode === null) { try { cp.kill('SIGTERM'); } catch (e) {} ap({ event: 'seed-cap-kill', seed: s, phase }); }
      }
      const done = live.filter(({ cp }) => cp.exitCode !== null || cp.signalCode);
      for (const { s, cp } of done) {
        results[s] = { status: cp.exitCode, signal: cp.signalCode || null, seedCapHit: cp.signalCode === 'SIGTERM' };
        ap({ event: 'seed-exit', seed: s, phase, status: cp.exitCode, signal: cp.signalCode, remainingMs: remaining() });
      }
      live = live.filter(({ cp }) => !(cp.exitCode !== null || cp.signalCode));
      if (remaining() <= 0) { live.forEach(({ cp }) => { try { cp.kill('SIGTERM'); } catch (e) {} }); }
      if (live.length) sleep(2000);
    }
  }
  return results;
}
// ---- discovery phase
const disc = runSeeds(MANIFEST.seeds.discovery, 'discovery');
const gates = require(__dirname + '/a25d-gates.js').evalDiscovery(DIR);
fs.writeFileSync(path.join(DIR, 'gates-discovery.json'), JSON.stringify({ attemptId, gates, discoveryLaunch: disc, remainingMsAtGate: remaining() }, null, 1));
ap({ event: 'discovery-gates', allDiscoveryPass: gates.allDiscoveryPass, primary: gates.primary, remainingMs: remaining() });
// ---- confirmation phase: ONLY if ALL discovery gates pass AND time remains for at least one seed
let conf = null;
if (gates.allDiscoveryPass && remaining() >= SEEDMS) {
  ap({ event: 'confirmation-start', remainingMs: remaining() });
  conf = runSeeds(MANIFEST.seeds.confirmation, 'confirmation');
} else {
  ap({ event: 'confirmation-skipped', reason: gates.allDiscoveryPass ? 'insufficient remaining time' : 'discovery gates unmet', remainingMs: remaining() });
}
const confGates = require(__dirname + '/a25d-gates.js').evalConfirmation(DIR);
fs.writeFileSync(path.join(DIR, 'gates-final.json'), JSON.stringify({ attemptId, discovery: gates, confirmation: confGates, confirmationLaunched: !!conf, remainingMsAtEnd: remaining() }, null, 1));
ap({ event: 'final-gates', allDiscoveryPass: gates.allDiscoveryPass, confirmation: confGates });
// ---- end marker: TRUE rc BEFORE the date
const anyIncomplete = Object.values(disc).some((r) => r.status !== 0) || (conf && Object.values(conf).some((r) => r.status !== 0)) || !gates.allDiscoveryPass || !confGates.allConfirmationPass;
const rc = anyIncomplete ? 1 : 0;
fs.appendFileSync(CLOG, 'TRUE_RC=' + rc + ' attemptId=' + attemptId + ' END_AT=' + new Date().toISOString() + '\n');
console.log('CAMPAIGN END rc=' + rc + ' attemptId=' + attemptId);
process.exit(rc);
