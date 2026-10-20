'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), z = require('node:zlib');
const { RLA, exact, hash, source, content } = require('../scripts/fast-source.js');
require('../src/sim/autopsy.js');
const C = content();
function config(id, patch = {}) {
  const l = C.levels.find(l => l.id === id);
  return exact.resolve({ world:l.world, parts:l.start, knobs:l.knobs, hyper:{...C.hyperOf(l.start,l.world),...l.hyper}, steps:l.steps, ...patch },[101,202,303],source().versions,C);
}
test('exact canonical keys preserve types, hidden knobs, ordered seeds and versions', () => {
  const a = config('twoways'), key = x => hash(exact.stringify(x));
  assert.equal(a.hyper.batch,128); assert.equal(a.hyper.lr,.003); assert.deepEqual(Array.from(a.hyper.hidden),[64,64]); assert.equal(a.hyper.pretrain,8000);
  const shuffled = Object.fromEntries(Object.entries(a).reverse()); assert.equal(key(a),key(shuffled));
  for (const change of [b=>b.seeds.reverse(),b=>b.seeds.pop(),b=>b.steps++,b=>b.knobs.spread+=.000001,b=>b.parts.chunk=String(b.parts.chunk),b=>b.parts.demos=b.parts.demos==='expert'?'mixed':'expert',b=>b.hyper.batch++,b=>b.versions.engine+='x',b=>b.versions.rules+='x',b=>b.evaluation.episodes++]) {
    const b = exact.parse(exact.stringify(a)); change(b); assert.notEqual(key(a),key(b));
  }
});
test('lossless codec preserves every engine numeric/container type and undefined fields', () => {
  const a = { x:NaN, y:Infinity, z:-Infinity, negativeZero:-0, missing:undefined, array:[undefined,NaN], f:new Float32Array([.3,NaN,Infinity]), d:new Float64Array([1/3,-0]), u:new Uint8Array([0,255]) };
  assert.deepEqual(exact.parse(exact.stringify(a)),a);
});
test('version dependencies cover simulation, rules and codec while UI/loader edits do not invalidate results', () => {
  const dependencies=Object.keys(source().files);
  for(const f of ['src/core/rng.js','src/core/nn.js','src/worlds/pendulum.js','src/sim/run.js','src/sim/autopsy.js','web/content3.js','web/fetch-level.js','web/rules.js'])assert(dependencies.includes(f));
  for(const f of ['web/app.js','web/fast.js','web/style.css','web/page.html','build.mjs'])assert(!dependencies.includes(f));
  assert.equal(source().versions.codec,hash(fs.readFileSync(path.resolve(__dirname,'../src/sim/exact.js'))));
});
test('full stored results equal current Live including all autopsy and representative consumer inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'bb-fast-test-'));
  try {
    for (const id of ['slots','cells','fetch','continuous','residual']) {
      const c = config(id,{ steps: id==='slots'?1000:30 }), key=hash(exact.stringify(c));
      const manifestPath=path.join(dir,'manifest.json');
      fs.writeFileSync(manifestPath,exact.stringify({versions:source().versions,entries:[{key,config:c}]}));
      cp.execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/fast-run-one.js'),JSON.stringify({manifestPath,output:dir,key})],{timeout:60000});
      const record=exact.parse(z.gunzipSync(fs.readFileSync(path.join(dir,'records',key+'.json.gz'))).toString());
      const live=c.seeds.map(seed=>RLA.run(exact.runConfig(c,seed)));
      assert.deepEqual(record.results,live,id+' full engine output');
      assert.deepEqual(RLA.autopsy(record.results),RLA.autopsy(live),id+' all-seed autopsy');
      assert.equal(record.results.length,c.seeds.length);
      if(id==='continuous') assert(record.results[0].replay.trace.length>0);
      if(id==='fetch') assert(record.results[0].policy.params.length>0);
      if(id==='residual') assert('baseRet' in record.results[0].final);
      const file=path.join(dir,'records',key+'.json.gz'), before=fs.readFileSync(file);
      // Seed checkpoints allow deterministic crash recovery without training completed seeds again.
      cp.execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/fast-run-one.js'),JSON.stringify({manifestPath,output:dir,key})],{timeout:60000});
      assert.deepEqual(fs.readFileSync(file),before);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
