'use strict';
// Append compatible publication: old compressed result bytes never change.
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib'), assert = require('node:assert/strict');
const { exact, hash, source } = require('./fast-source.js');
function publish(manifestPath, campaign, destination) {
  const manifest = exact.parse(fs.readFileSync(manifestPath,'utf8')), versions=source().versions;
  assert.deepEqual(manifest.versions,versions,'source version mismatch');
  const version = hash(exact.stringify(versions)), dir=path.join(destination,version);
  fs.mkdirSync(path.join(dir,'records'),{recursive:true});
  const indexPath=path.join(dir,'index.json');
  const index=fs.existsSync(indexPath)?JSON.parse(fs.readFileSync(indexPath)):{schema:'bb-fast-index-v1',versions,records:{}};
  assert.deepEqual(index.versions,versions);
  const sizes=[];
  for(const e of manifest.entries) {
    const name=e.key+'.json.gz', packed=fs.readFileSync(path.join(campaign,'records',name));
    const raw=z.gunzipSync(packed), r=exact.parse(raw.toString());
    assert.equal(r.schema,'bb-full-results-v1');assert.equal(r.key,e.key);assert.equal(hash(exact.stringify(r.config)),e.key);
    assert.equal(exact.stringify(r.config),exact.stringify(e.config));
    assert.deepEqual(r.results.map(r=>r.seed),e.config.seeds);
    const ref={path:'records/'+name,sha256:hash(packed),bytes:packed.length};
    if(index.records[e.key]) assert.deepEqual(index.records[e.key],ref,'cannot mutate an existing result');
    const target=path.join(dir,ref.path);
    if(fs.existsSync(target)) assert.equal(hash(fs.readFileSync(target)),ref.sha256); else fs.writeFileSync(target,packed);
    index.records[e.key]=ref;sizes.push({key:e.key,raw:raw.length,gzip:packed.length});
  }
  const bytes=JSON.stringify(index);fs.writeFileSync(indexPath+'.tmp',bytes);fs.renameSync(indexPath+'.tmp',indexPath);
  const report={version,records:Object.keys(index.records).length,added:sizes.length,index:{raw:Buffer.byteLength(bytes),gzip:z.gzipSync(bytes).length},shards:sizes,
    totalShardRaw:sizes.reduce((s,r)=>s+r.raw,0),totalShardGzip:sizes.reduce((s,r)=>s+r.gzip,0)};
  return report;
}
if(require.main===module) console.log(JSON.stringify(publish(...process.argv.slice(2)),null,2));
module.exports={publish};
