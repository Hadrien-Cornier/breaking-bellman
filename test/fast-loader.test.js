'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), z = require('node:zlib');
const { RLA, exact, hash, source, content } = require('../scripts/fast-source.js');
const { create } = require('../web/fast.js');
const C=content(), l=C.levels[0], versions=source().versions;
const config=exact.resolve({world:l.world,parts:l.start,knobs:l.knobs,hyper:C.hyperOf(l.start,l.world),steps:20},[101,202],versions,C);
const key=hash(exact.stringify(config));
const record={schema:'bb-full-results-v1',key,config,results:config.seeds.map(seed=>RLA.run(exact.runConfig(config,seed)))};
const packed=z.gzipSync(exact.stringify(record));
const index={schema:'bb-fast-index-v1',versions,records:{[key]:{path:'records/'+key+'.json.gz',sha256:hash(packed),bytes:packed.length}}};
function fixture(options={}) {
  const calls=[];
  const client=create({versions,base:'fast/test',protocol:'https:',digest:async x=>hash(x),decompress:async b=>z.gunzipSync(b).toString(),
    fetcher:async (url,opts)=>{calls.push(url);return url.endsWith('index.json')?{ok:true,json:async()=>structuredClone(index)}:{ok:true,arrayBuffer:async()=>packed};},...options});
  return {client,calls};
}
test('Fast loads external index and only the exact requested shard, caches index alone',async()=>{
  const {client,calls}=fixture();
  assert.equal(exact.stringify((await client.lookup(config)).record),exact.stringify(record));
  assert.equal(calls.length,2); assert(calls[0].endsWith('/index.json'));assert(calls[1].endsWith('/'+index.records[key].path));
  assert.equal(exact.stringify((await client.lookup(config)).record),exact.stringify(record));assert.equal(calls.length,3);
});
test('one word, hidden knob, budget, seeds and versions miss without substituting a similar run',async()=>{
  for(const change of [c=>c.parts.eps=!c.parts.eps,c=>c.knobs.noise+=.01,c=>c.steps++,c=>c.seeds.reverse(),c=>c.seeds.pop(),c=>c.hyper.lrTable+=.01,c=>c.versions.engine+='x']) {
    const c=exact.parse(exact.stringify(config));change(c);const {client,calls}=fixture();
    const result=await client.lookup(c);assert(!result.record);assert.match(result.reason,/Live/);assert(calls.length<=1);
  }
});
test('an appended phase2 record becomes available after an earlier exact miss',async()=>{
  let available=false;
  const {client,calls}=fixture({fetcher:async url=>url.endsWith('index.json')?{ok:true,json:async()=>available?index:{...index,records:{}}}:{ok:true,arrayBuffer:async()=>packed}});
  assert(!(await client.lookup(config)).record);available=true;assert((await client.lookup(config)).record);
});
test('offline makes no data fetch; missing/corrupt/mismatched assets and network failure fall back',async()=>{
  const off=fixture({protocol:'file:'});assert(!(await off.client.lookup(config)).record);assert.equal(off.calls.length,0);
  for(const fetcher of [async()=>{throw Error('offline');},async()=>({ok:false}),
    async()=>({ok:true,json:async()=>({schema:'wrong',versions,records:{}})}),
    async()=>({ok:true,json:async()=>({...index,versions:{...versions,rules:'wrong'}})}),
    async url=>url.endsWith('index.json')?{ok:true,json:async()=>index}:{ok:true,arrayBuffer:async()=>Buffer.from('corrupt')},
    async url=>url.endsWith('index.json')?{ok:true,json:async()=>({...index,records:{[key]:{...index.records[key],sha256:'0'.repeat(64)}}})}:{ok:true,arrayBuffer:async()=>packed},
  ]) { const {client}=fixture({fetcher});const r=await client.lookup(config);assert(!r.record);assert.match(r.reason,/Live/); }
});
test('a valid compressed payload with the wrong config or incomplete seeds is rejected',async()=>{
  for(const mutate of [r=>r.config.steps++,r=>r.results.pop(),r=>r.results[0].seed++,r=>delete r.results[0].diag,r=>delete r.results[0].ep.ret,r=>delete r.results[0].bandit.arm,r=>r.results[0].bandit.reward=[1,2],r=>r.results[0].knobs.noise++]) {
    const r=exact.parse(exact.stringify(record));mutate(r);const bytes=z.gzipSync(exact.stringify(r));
    const i={...index,records:{[key]:{...index.records[key],sha256:hash(bytes),bytes:bytes.length}}};
    const {client}=fixture({fetcher:async url=>url.endsWith('index.json')?{ok:true,json:async()=>i}:{ok:true,arrayBuffer:async()=>bytes}});
    assert(!(await client.lookup(config)).record);
  }
});
test('full consumer inputs are required for continuous replay, Fetch policy and residual baselines',async()=>{
  for(const [id,mutate] of [['continuous',r=>delete r.replay],['fetch',r=>delete r.policy],['residual',r=>delete r.final.baseRet]]) {
    const l=C.levels.find(l=>l.id===id),c=exact.resolve({world:l.world,parts:l.start,knobs:l.knobs,hyper:{...C.hyperOf(l.start,l.world),...l.hyper},steps:30},[101],versions,C);
    const k=hash(exact.stringify(c)),r={schema:'bb-full-results-v1',key:k,config:c,results:[RLA.run(exact.runConfig(c,101))]};
    let bytes;
    const {client}=fixture({fetcher:async url=>url.endsWith('index.json')?{ok:true,json:async()=>({schema:'bb-fast-index-v1',versions,records:{[k]:{path:'records/'+k+'.json.gz',sha256:hash(bytes),bytes:bytes.length}}})}:{ok:true,arrayBuffer:async()=>bytes}});
    bytes=z.gzipSync(exact.stringify(r));assert((await client.lookup(c)).record,id+' complete full result accepted');
    mutate(r.results[0]);bytes=z.gzipSync(exact.stringify(r));
    // A new client revalidates the deliberately changed index rather than trusting its previous hash.
    const broken=fixture({fetcher:async url=>url.endsWith('index.json')?{ok:true,json:async()=>({schema:'bb-fast-index-v1',versions,records:{[k]:{path:'records/'+k+'.json.gz',sha256:hash(bytes),bytes:bytes.length}}})}:{ok:true,arrayBuffer:async()=>bytes}});
    assert(!(await broken.client.lookup(c)).record,id+' incomplete consumer data rejected');
  }
});
test('abort and timeout never deliver an old stored result',async()=>{
  const controller=new AbortController();controller.abort();const {client,calls}=fixture();assert(!(await client.lookup(config,controller.signal)).record);assert.equal(calls.length,0);
  const delayed=fixture({timeout:5,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
  assert(!(await delayed.client.lookup(config)).record);
  let release;const gate=new Promise(r=>release=r),abort=new AbortController();
  const slow=fixture({decompress:async b=>{await gate;return z.gunzipSync(b).toString();}});
  const waiting=slow.client.lookup(config,abort.signal);abort.abort();release();assert(!(await waiting).record);
});
