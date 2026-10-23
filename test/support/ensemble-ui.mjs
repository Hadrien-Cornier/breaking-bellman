import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function ensembleContract(page, out, name, newer, check) {
    const initial=await page.evaluate(()=>({scene:!!document.querySelector('#ensemble-stage svg'),record:BBENSEMBLE_LEVEL.record(),mapBefore:!!(document.querySelector('#campaign-strip').compareDocumentPosition(document.querySelector('#ensemble-lesson'))&Node.DOCUMENT_POSITION_FOLLOWING),overflow:document.documentElement.scrollWidth>innerWidth}));
    check(initial.scene&&!initial.record&&initial.mapBefore&&!initial.overflow,name+' initial scene and map, no prior record');
    await page.screenshot({path:path.join(out,name+'-before.png'),fullPage:true});
    // Returning progress may already place the teaching card later in the lesson.
    await page.evaluate(()=>{document.querySelector('#ensemble-p-1')?.click();});
    await page.locator('#ensemble-recompute').click();
    const record=await page.evaluate(()=>BBENSEMBLE_LEVEL.record());
    check(record.metrics.mean.trueReturn===0&&record.metrics.penalty.trueReturn===1,name+' actual engine return');
    fs.writeFileSync(path.join(out,name+'-record.json'),JSON.stringify(record,null,2));
    const exact=JSON.stringify(record);
    const first=await page.locator('#ensemble-stage').innerHTML();
    await page.locator('#ensemble-step').click();
    const one=await page.locator('#ensemble-stage').innerHTML();
    check(first!==one&&(await page.evaluate(()=>BBENSEMBLE_LEVEL.replay().time))===1,name+' measured step');
    await page.locator('#ensemble-replay').click();
    check(await page.locator('#ensemble-stage').innerHTML()===first,name+' pure replay start');
    await page.locator('#ensemble-step').click();
    check(await page.locator('#ensemble-stage').innerHTML()===one,name+' pure replay sample');
    await page.locator('#ensemble-replay').click();
    await page.locator('#ensemble-watch').click();
    await page.waitForFunction(()=>BBENSEMBLE_LEVEL.replay().time===1);
    await page.locator('#ensemble-watch').click();
    const paused=await page.locator('#ensemble-stage').innerHTML();
    await page.waitForTimeout(750);
    check(await page.locator('#ensemble-stage').innerHTML()===paused&&!await page.evaluate(()=>BBENSEMBLE_LEVEL.replay().watching),name+' pause holds measured frame');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#ensemble-watch').click();
    check(!await page.evaluate(()=>BBENSEMBLE_LEVEL.replay().watching),name+' reduced motion');
    check(JSON.stringify(await page.evaluate(()=>BBENSEMBLE_LEVEL.record()))===exact,name+' draw does not mutate record');
    const identity=await page.evaluate(()=>{const r=BBENSEMBLE_LEVEL.record();return {linked:['#ensemble-scene','#ensemble-stage','#ensemble-chart','#ensemble-result'].every(s=>document.querySelector(s).dataset.run===r.id),visible:document.body.innerText.includes(r.id),sizes:[...document.querySelectorAll('#ensemble-lesson button, #ensemble-lesson input, #ensemble-controls button')].filter(e=>e.getBoundingClientRect().width).map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))};});
    check(identity.linked&&!identity.visible,name+' internal record linkage');
    check(identity.sizes.every(s=>s.w>=44&&s.h>=44),name+' 44px targets');
    await page.locator('#ensemble-coefficient').fill('0');
    check(await page.evaluate(()=>BBENSEMBLE_LEVEL.replay().stale),name+' setting marks stale');
    check(await page.locator('#ensemble-stale').innerText()!==''&&await page.locator('#ensemble-watch').isDisabled(),name+' stale disables old replay');
    await page.locator('#ensemble-recompute').click();
    const fresh=await page.evaluate(()=>BBENSEMBLE_LEVEL.record());
    check(fresh.id!==record.id&&fresh.metrics.penalty.trueReturn===0,name+' changed coefficient changes real outcome');
    await page.locator('#ensemble-step').click();await page.locator('#ensemble-step').click();
    check((await page.locator('#ensemble-frame').innerText()).includes('true return so far 0'),name+' reward cursor');
    check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),name+' no overflow');
    const text=await page.locator('#ensemble-lesson').textContent();
    check(!text.includes('—'),name+' no em dash');
    fs.writeFileSync(path.join(out,name+'-text.txt'),text+'\n'+await page.locator('#ensemble-scene').innerText());
    await page.screenshot({path:path.join(out,name+'-after.png'),fullPage:true});
    if(!newer) {
      await page.locator('#ensemble-restore').click();
      // Use the real current-step controls through completion, retaining all teaching surfaces.
      await page.locator('#ensemble-run').click();
      await page.locator('#ensemble-d-0').click();
      await page.locator('#ensemble-wrong').click();
      check((await page.evaluate(()=>bellman.record())).metrics.penalty.trueReturn===0,name+' confident miss measured');
      await page.screenshot({path:path.join(out,name+'-confident-miss.png'),fullPage:true});
      await page.locator('#ensemble-high').click();
      check((await page.evaluate(()=>bellman.record())).metrics.penalty.trueReturn===5,name+' unsupported vault measured');
      await page.locator('#ensemble-x-1').click();
      await page.locator('#ensemble-complete').click();
      check(await page.evaluate(()=>bellman.levels().find(l=>l.id==='ensemble').done),name+' actual completion');
      fs.writeFileSync(path.join(out,name+'-all-surfaces.txt'),await page.locator('#ensemble-lesson').textContent());
      await page.screenshot({path:path.join(out,name+'-complete.png'),fullPage:true});
    }
    await page.evaluate(()=>bellman.level('cliff'));
    check(await page.evaluate(()=>BBENSEMBLE_LEVEL.record()===null&&bellman.state().world==='cliff'),name+' switching clears record and world');
    return {name,initial,record:record.id,rerun:fresh.id};
}
