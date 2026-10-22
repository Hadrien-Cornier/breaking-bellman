// A Live, finite-route lesson, separate from the frozen synthetic154 experiment and RLA.run.
(function (C, V) {
  'use strict';
  C.phases.push({ n: 7, title: 'Vector rewards and search' });
  C.worldNames.vpo = 'Two treasures';
  C.levels.push({ id: 'vpo', custom: true, phase: 7, world: 'vpo', title: 'Keep your alternatives', focus: [],
    intro: 'A route can reach the exit, collect gold, collect diamonds and avoid lava. Keep those four rewards separate. Train two small policies, then see which alternatives they offer.',
    goal: { text: 'Run both learners, inspect sampled preferences and explain why more candidates do not guarantee a VPO win.' } });
  const state = { seed: 101, generations: 240, k: 3, result: null, busy: false, selected: 0, draw: 1, inspected: false, edits: null, answer: '' };
  const f = x => x.toFixed(3), vector = x => '[' + x.map(f).join(', ') + ']';
  let currentRun = null, redraw = null;
  V.cancel = () => {
    const ticket = currentRun; currentRun = null;
    if (ticket) { if (ticket.worker) ticket.worker.terminate(); if (ticket.resolve) ticket.resolve(null); }
    state.busy = false;
  };
  V.state = () => ({ world: 'vpo', sentenceName: 'VPO set reward vs fixed-score GRPO', mode: 'campaign', level: 'Keep your alternatives',
    knobs: { seed: state.seed, generations: state.generations, candidates: state.k }, words: {}, idleWords: {}, discovered: [],
    lastRun: state.result ? { seeds: 1, steps: state.result.generations * 12, symptoms: [], summary: Object.fromEntries(state.result.arms.map(a => [a.arm, a.evaluation.curve])) } : null,
    comparison: state.result, version: window.BB_VPO_VERSION });
  V.run = async () => {
    if (state.busy) return null;
    const ticket = { worker: null, resolve: null }; currentRun = ticket;
    state.busy = true; state.error = null; state.result = null; state.inspected = false; state.edits = null; state.answer = ''; if (redraw) redraw();
    try {
      const result = await new Promise((resolve, reject) => {
        ticket.resolve = resolve;
        const src = document.querySelector('#vpo-engine-src').textContent + '\nonmessage=e=>{try{postMessage({result:BBVPO.compare(e.data.seed,e.data.generations)})}catch(e){postMessage({error:String(e)})}};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const worker = ticket.worker = new Worker(url); URL.revokeObjectURL(url);
        worker.onmessage = e => e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
        worker.onerror = e => reject(Error(e.message));
        worker.postMessage({ seed: state.seed, generations: state.generations });
      });
      if (currentRun !== ticket) return null;
      state.result = result;
      return result;
    } finally { if (currentRun === ticket) { V.cancel(); if (redraw) redraw(); } }
  };
  function table(h, headings, rows) {
    return h('div.vpo-table', { tabindex:'0', role:'region', 'aria-label':headings.join(', ') }, h('table', null, [h('thead', null, h('tr', null, headings.map(text => h('th', { scope: 'col', text })))),
      h('tbody', null, rows.map(row => h('tr', null, row.map(text => h('td', { text })))))]));
  }
  function map(h) {
    const route = V.routes[state.selected];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 350 350'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', route.name + ': ' + vector(route.reward) + ' for exit, gold, diamonds, lava avoidance. ' + (route.exit ? 'Reached exit.' : 'Budget expired.'));
    const element = (tag, attrs, text) => { const e = document.createElementNS(svg.namespaceURI, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; svg.append(e); };
    V.GRID.forEach((row, y) => [...row].forEach((tile, x) => {
      element('rect', { x: x*50+1, y:y*50+1, width:48, height:48, fill:'var(--surface)', stroke:'var(--line)' });
      if (tile !== '.') element('text', { x:x*50+25, y:y*50+32, 'text-anchor':'middle', fill:'var(--ink)', 'font-size':22 }, tile);
    }));
    element('polyline', { points:route.path.map(([x,y]) => (x*50+25)+','+(y*50+25)).join(' '), fill:'none', stroke:'var(--accent)', 'stroke-width':5, 'stroke-opacity':0.65 });
    const end = route.path[route.path.length-1]; element('circle', { cx:end[0]*50+25, cy:end[1]*50+25, r:8, fill:'var(--accent)' });
    return h('div', null, [svg, h('p.small', { text: route.name + ': reward ' + vector(route.reward) + '. ' + (route.path.length-1) + ' moves. ' + (route.exit ? 'Exit reached.' : 'No exit, so every reward is zero.') }),
      h('p.small', { text:'S start · E exit · G gold · D diamond · L walkable lava. The line replays the selected route.' })]);
  }
  V.mount = (pane, lab, { h, complete, done }) => {
    const lesson = C.levels.find(l => l.id === 'vpo');
    const body = h('div.card.stack', { id:'vpo-lesson' }); pane.append(body);
    redraw = () => {
      if (!body.isConnected) return;
      const select = (id, label, values, value, change) => h('label.field', { for:id }, [h('span.small', { text:label }), h('select', { id, disabled:state.busy, onchange:e=>{change(+e.target.value);redraw();} }, values.map(([v,text])=>h('option', { value:v, selected:v===value, text })))]);
      body.replaceChildren(h('div.eyebrow', { text:'Level ' + (C.levels.findIndex((l) => l.id === 'vpo') + 1) + ' · Two treasures' }), h('h2', { text:lesson.title }), h('p', { text:lesson.intro }),
        h('h3', { text:'1. Change what earns credit' }),
        h('p', { text:'GRPO: score each route with the mean of its four rewards, then compare it with 11 other tries. VPO (Vector Policy Optimization): draw eight preference directions, score the best of three alternatives for each direction, then average. Compare four sets and give each whole set its group-relative credit.' }),
        h('p', { text:'The sentence changes from “reward this answer” to “reward this set of alternatives”. A preference direction is four nonnegative weights that sum to one. Gold-heavy and diamond-heavy directions can favor different routes.' }),
        h('p.small', { text:'Both learners start with the same uniform policy and sample 12 routes per generation. Later VPO choices see which reward categories earlier alternatives covered. Repeats are allowed. Neither policy sees the sampled weights. This toy trains probabilities over a finite route menu, not individual navigation actions or a language model.' }),
        h('div.row', null, [select('vpo-seed','Run seed',[[101,'101'],[202,'202'],[303,'303'],[404,'404'],[505,'505']],state.seed,v=>{state.seed=v;state.result=null;}),
          select('vpo-generations','Training generations',[[120,'120'],[240,'240'],[480,'480']],state.generations,v=>{state.generations=v;state.result=null;}),
          h('button.btn', { id:'vpo-run', type:'button', disabled:state.busy, onclick:()=>V.run().catch(e=>{state.error=e.message;redraw();}) }, state.busy?'Training both learners…':'Train GRPO and VPO')]),
        h('p.small', { id:'vpo-source', role:'status', text:state.error || (state.result ? 'Live simulation completed in this page. Seed '+state.result.seed+'. '+state.result.arms[0].candidates+' sampled training routes and '+state.result.arms[0].updates+' optimizer passes per learner. '+state.result.milliseconds+' ms.' : 'Live simulation. Fast stored results belong to the other lessons. No winner is required here.') }),
        h('a', { href:'#vpo-lab', text:'Jump to route map and rules' }),
        h('h3', { text:'2. Inspect alternatives and preferences' }),
        h('p', { text:'After training, compare best@k at the fixed uniform score. Increasing k keeps the first candidates in draw order and adds more. It can improve either learner, or leave a tie. It cannot lower the best score in the same pool.' }));
      if (state.result) {
        const r = state.result;
        body.append(select('vpo-k','Candidates to inspect',[[1,'1'],[3,'3'],[5,'5'],[10,'10'],[30,'30']],state.k,v=>state.k=v),
          table(h,['Live policy','best@1','best@3','best@30'],[['Untrained base',... [0,1,4].map(i=>f(r.base.curve[i]))],...r.arms.map(a=>[a.arm.toUpperCase(),...[0,1,4].map(i=>f(a.evaluation.curve[i]))])]),
          h('p.small', { text:'Means over 64 fresh 30-route pools on this single map. VPO concatenates fresh three-route chains; GRPO and base draw independent routes. Every best@k uses the fixed mean of four rewards. These game scores are separate from synthetic154 below.' }));
        for (const arm of r.arms) {
          const pool = arm.evaluation.pool.slice(0,state.k);
          body.append(h('h4', { text:arm.arm.toUpperCase()+' · one sampled pool, first '+state.k }),h('div.row', null, pool.map((a,i)=>h('button.btn.ghost.tiny', { type:'button', 'aria-pressed':state.selected===a?'true':'false', onclick:()=>{state.selected=a;redraw();} }, (i+1)+'. '+V.routes[a].name))),
            h('p.small', { text:'Best fixed score in this pool: '+f(Math.max(...pool.map(a=>V.dot(V.uniform,V.routes[a].reward))))+'. Repeated names are repeated samples.' }));
        }
        body.append(h('details', null, [h('summary', { text:'How the policy changed' }),table(h,['Route','Base %','GRPO %','VPO %'],V.routes.map((route,i)=>[route.name,f(100/V.routes.length),...r.arms.map(a=>f(100*V.probs(a.model[0])[i]))])),h('p.small', { text:'Probabilities for the first route, before any coverage context. VPO has separate learned probabilities after earlier alternatives. PPO-like updates clip the surrogate objective at ratios 0.8–1.2, take two passes, and penalize forward KL to the uniform base at 0.001. This categorical surrogate is smaller than the paper or synthetic154.' })]));
        const group = r.arms[1].last.groups[0], inspected = state.edits || group.map(d=>d.action), rewards = inspected.map(a=>V.routes[a].reward), weights = V.directions(RLA.rng.make(state.draw));
        body.append(h('h4', { text:'Try the VPO set scorer' }),h('p.small', { text:'Start with one actual three-route set from the last training generation. Replace an alternative to test complementarity or duplicates. These inspection edits and fresh preferences do not retrain the policy.' }),
          h('div.row', null, inspected.map((a,i)=>select('vpo-alternative-'+i,'Inspected alternative '+(i+1),V.routes.map((r,j)=>[j,r.name]),a,v=>{state.edits=inspected.slice();state.edits[i]=v;}))),
          h('button.btn.ghost', { id:'vpo-preferences', type:'button', onclick:()=>{state.draw++;state.inspected=true;redraw();} }, 'Sample eight preference directions'),
          table(h,['Weights: exit, gold, diamond, safe','Winning alternative','Score'],weights.map(w=>{const scores=rewards.map(v=>V.dot(w,v)), best=Math.max(...scores),i=scores.indexOf(best);return [vector(w),V.routes[inspected[i]].name,f(best)];})),
          h('p', { id:'vpo-set-score', text:'Set reward = average of those eight winning scores: '+f(V.setReward(rewards,weights))+'. A duplicate route cannot improve a fixed set reward.' }),
          h('details', null, [h('summary', { text:'Watch one training comparison' }),table(h,['VPO group','Set reward','Advantage'],r.arms[1].last.rewards.map((v,i)=>[String(i+1),f(v),f(r.arms[1].last.advantages[i])])),
            h('p.small', { text:'These four set rewards used the same eight preference draws in training: '+r.arms[1].last.weights.map(vector).join('; ')+'. All three decisions in each set received that group advantage. The inspector above uses fresh draws.' }),
            table(h,['GRPO route','Fixed score','Advantage'],r.arms[0].last.groups.map((g,i)=>[V.routes[g[0].action].name,f(r.arms[0].last.rewards[i]),f(r.arms[0].last.advantages[i])]))]));
      } else body.append(h('p.small', { text:'Train both learners to inspect their actual sampled routes and updates.' }));
      body.append(h('h3', { text:'3. Read the measured comparison' }), reference(h),
        h('p', { text:'Which conclusion follows? More alternatives can help search, but a vector objective alone does not guarantee an advantage. Your game run may tie or favor either learner.' }),
        h('label.field', { for:'vpo-answer' }, [h('span.small', { text:'Explain the result' }), h('select', { id:'vpo-answer', onchange:e=>{state.answer=e.target.value;redraw();} }, [
          ['','Choose a conclusion'],
          ['win','VPO must win: its set objective makes 30 candidates beat fixed-score GRPO'],
          ['none','Neither method improved: a missed effect-size gate makes the measurements uninformative'],
          ['evidence','Both improved with more candidates; the small VPO edge did not establish the mechanism'],
        ].map(([value,text])=>h('option', { value, text, selected:state.answer===value })))]),
        state.answer ? h('p.small', { role:'status', text: state.answer==='win'
          ? 'The decisive error is treating more candidates as a guaranteed VPO advantage. More candidates help either learner only when they add a better route, and GRPO improved slightly more from best@3 to best@30.'
          : state.answer==='none'
            ? 'The decisive error is treating a failed effect-size gate as no evidence at all. Both measured policies improved with more candidates; the gate limits the causal claim about VPO.'
            : 'The measured result supports a search benefit for both learners. It does not establish that the vector set objective caused VPO to outperform GRPO.' }) : null,
        h('button.btn', { id:'vpo-complete', type:'button', disabled:!state.result||!state.inspected||state.answer!=='evidence', onclick:()=>{complete();redraw();} }, done()?'Lesson complete':'I compared both learners and inspected preferences'),
        h('p.small', { text:'To finish, train both learners, sample preference directions and explain the evidence. Completing this lesson does not require VPO to win.' }));
      lab.replaceChildren(h('section.card.game-rules', { id:'vpo-rules' }, [h('h3', { text:'Game rules · Two treasures' }),
        h('p', { text:'Goal: offer useful treasure routes. Reward each step: no incremental payment; score the completed route. Equation: r = [exit, gold/3, diamonds/3, 1 - distinct lava/2], or [0,0,0,0] without exit. Episode ends: exit or 14 moves. Score: fixed mean of the four components. Pass this challenge: '+lesson.goal.text })]),
        h('section.card', null, [h('h3', { text:'Inspect a route' }),map(h), select('vpo-route','Route menu',V.routes.map((r,i)=>[i,r.name]),state.selected,v=>state.selected=v),
          h('p.small', { text:'Ten prewritten routes, including failures. The learner chooses among them. This small menu can saturate; ties here do not reproduce the harder held-out experiment.' })]));
    };
    redraw();
  };
  function reference(h) {
    const A = window.BB_VPO_REFERENCE.aggregates;
    return h('section', { id:'vpo-reference' }, [h('h4', { text:'Frozen reference · synthetic154' }),
      h('p', { text:'Five held-out discovery seeds on harder navigation tasks, using a bounded synthetic neural policy. VPO best@30: 0.753. GRPO: 0.730. The edge was +0.023, below the planned +0.050. Both improved with more candidates.' }),
      table(h,['Policy','best@3','best@30','Growth'],[['VPO',A.vpo],['GRPO',A['grpo-single']],['Untrained base',A.base],['MultiRLVR (mean-chain)',A['multi-rlvr']],['Random-weight GRPO',A['random-w']]].map(([name,a])=>[name,f(a.best3),f(a.best30),'+'+f(a.growth30_3)])),
      h('details', { id:'vpo-evidence' }, [h('summary', { text:'What this evidence supports' }),
        h('p', { text:'Report154, attempt a26-hard154-v1, equal-weight discovery seeds 2, 4, 6, 8, 10. Thirty-two held-out problems, six repetitions each, ordered prefixes at k=1,3,5,10,30. The score is best@k, not pass@k. VPO improved 0.108438; GRPO improved 0.113281. VPO minus GRPO at 30 was 0.023021, below 0.05. VPO beat GRPO in four of five seeds and lost in seed 6.' }),
        h('p', { text:'Several declared scientific gates failed. GRPO was not flat, MultiRLVR also grew 0.168229, and base best@30 of 0.768229 exceeded VPO at 0.752552. Random-weight GRPO reached 0.753594. The set-objective mechanism remains inconclusive. Confirmation was correctly not run.' }),
        h('p', { text:'Neither trained arm reached the finite planner-menu reference in any of 160 problem-seed units. This reference was a bounded menu, not a global optimal oracle. Larger reward spread also included failures; VPO had a lower exit rate. These synthetic policies were not LLMs. Individual evaluation paths were not retained, which limits reconstruction of sampled prefix maxima.' }),
        h('p', null, [h('a', { href:'https://github.com/Hadrien-Cornier/breaking-bellman/blob/main/docs/vpo-reference154.md', target:'_blank', rel:'noopener' }, 'Frozen measurement provenance and limitations'), ' · ',h('a', { href:'https://arxiv.org/html/2605.22817v1#S3',target:'_blank',rel:'noopener' }, 'VPO paper, method section'), '. The game illustrates the set objective with a finite categorical policy; it is not a replication of the paper or synthetic154.'])])]);
  }
})(window.CONTENT, window.BBVPO);
