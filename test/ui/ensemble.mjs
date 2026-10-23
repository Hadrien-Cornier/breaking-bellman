// Focused returned-ensemble contract; the all-level gate remains test/ui/levels.mjs.
// node test/ui/ensemble.mjs EXTERNAL_PROOF_DIR [URL]
import assert from 'node:assert/strict';
import { ensembleContract } from '../support/ensemble-ui.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const [out, url = new URL('../../dist/breaking-bellman.html', import.meta.url).href] = process.argv.slice(2);
if (!out) throw Error('Pass an external proof directory');
fs.mkdirSync(out, { recursive:true });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/newer-main-save.json',import.meta.url))).progress;
const candidates = [process.env.PW_CHROMIUM,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'];
const browser = await chromium.launch({executablePath:candidates.find(p=>p&&fs.existsSync(p))});
const errors=[], cases=[];
let checks=0;
function check(value,label){assert.ok(value,label);checks++;}
try {
  for (const width of [1280,390]) for(const theme of ['light','dark']) for(const newer of [false,true]) {
    const name=`ensemble-${width}-${theme}-${newer?'newer':'clean'}`;
    const context=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:width===390,hasTouch:width===390,colorScheme:theme});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(name+': '+e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(name+': '+m.text());});
    await page.goto(url);
    await page.evaluate(({fixture,newer,theme})=>{
      if(newer)localStorage.setItem('breaking-bellman-v1',JSON.stringify(fixture));else localStorage.removeItem('breaking-bellman-v1');
      localStorage.setItem('bb-theme',theme);
    },{fixture,newer,theme});
    await page.reload();
    await page.evaluate(()=>{document.querySelector('dialog.intro button')?.click();bellman.level('ensemble');});
    const proof = await ensembleContract(page,out,name,newer,check);
    if(newer){const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('breaking-bellman-v1')));for(const key of ['future','recapDismissed'])assert.deepEqual(saved[key],fixture[key]);for(const [id,value]of Object.entries(fixture.answers))assert.deepEqual(saved.answers[id],value);checks++;}
    cases.push(proof);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({checks,cases,errors},null,2));
  console.log(`${checks} checks passed in ${cases.length} cases`);
} finally {await browser.close();}
