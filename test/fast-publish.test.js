'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),z=require('node:zlib');
const {publish}=require('../scripts/fast-publish.js');
const {RLA,exact,hash,source,content}=require('../scripts/fast-source.js');
test('publication preserves earlier shard bytes, appends keys and refuses incomplete or changed results',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-fast-publish-'));
  try{
    const campaign=path.join(dir,'campaign'),dest=path.join(dir,'public'),manifest=path.join(dir,'manifest.json');
    fs.mkdirSync(path.join(campaign,'records'),{recursive:true});const C=content(),lv=C.levels[0],versions=source().versions;
    const entry=eps=>{const config=exact.resolve({world:lv.world,parts:{...lv.start,eps},steps:20,knobs:lv.knobs,hyper:C.hyperOf(lv.start,lv.world)},[101,202],versions,C);return {key:hash(exact.stringify(config)),config,levels:['slots']};};
    const a=entry(false),b=entry(true),write=e=>fs.writeFileSync(path.join(campaign,'records',e.key+'.json.gz'),z.gzipSync(exact.stringify({schema:'bb-full-results-v1',key:e.key,config:e.config,results:e.config.seeds.map(s=>RLA.run(exact.runConfig(e.config,s)))})));
    write(a);fs.writeFileSync(manifest,exact.stringify({versions,entries:[a]}));const first=publish(manifest,campaign,dest),root=path.join(dest,first.version);
    const before=fs.readFileSync(path.join(root,'records',a.key+'.json.gz'));
    const published=exact.parse(z.gunzipSync(before).toString());
    assert.equal(published.schema,'bb-seed-aggregate-v1');
    assert.equal(published.view.seedCount,2);
    assert.equal(published.results,undefined);
    publish(manifest,campaign,dest);
    assert.deepEqual(fs.readFileSync(path.join(root,'records',a.key+'.json.gz')),before);
    write(b);fs.writeFileSync(manifest,exact.stringify({versions,entries:[b]}));const next=publish(manifest,campaign,dest);
    assert.equal(next.records,2);assert.deepEqual(fs.readFileSync(path.join(root,'records',a.key+'.json.gz')),before);
    const indexBefore=fs.readFileSync(path.join(root,'index.json'));
    fs.unlinkSync(path.join(campaign,'records',b.key+'.json.gz'));assert.throws(()=>publish(manifest,campaign,dest));assert.deepEqual(fs.readFileSync(path.join(root,'index.json')),indexBefore);
    write(b);const file=path.join(campaign,'records',b.key+'.json.gz'),record=exact.parse(z.gunzipSync(fs.readFileSync(file)).toString());record.results[0].final.best++;
    fs.writeFileSync(file,z.gzipSync(exact.stringify(record)));assert.throws(()=>publish(manifest,campaign,dest),/cannot mutate/);
    assert.deepEqual(fs.readFileSync(path.join(root,'index.json')),indexBefore);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
