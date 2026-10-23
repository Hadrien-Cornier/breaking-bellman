// Two already-filled reward tables. Planning is in src/agents/ensemble.js.
(function (C, E) {
  'use strict';
  if (!E || !E.plan || !E.rollout) throw new Error('ensemble lesson requires BBENSEMBLE');
  C.worldNames.ensemble = 'Two reward tables';
  const lessonGoal = 'Plan on the average and on the average minus the disagreement penalty, walk both plans in the aisle, and see that agreement is not the same as the true reward.';
  const ensembleLevel = {
    id: 'ensemble', custom: true, phase: 8, world: 'ensemble', title: 'Stop where the tables disagree', focus: [],
    intro: 'Two reward tables are already filled in. On the shelf they agree. On the glare door they do not, and their average is high. The aisle pays nothing for glare. Planning on the average walks in. Planning on the average minus a penalty for the difference stays with the shelf.',
    goal: { text: lessonGoal },
  };
  const replanAt = C.levels.findIndex((l) => l.id === 'replan');
  const superAt = C.levels.findIndex((l) => l.id === 'supermimic');
  if (replanAt >= 0) C.levels.splice(replanAt, 0, ensembleLevel);
  else if (superAt >= 0) C.levels.splice(superAt + 1, 0, ensembleLevel);
  else C.levels.push(ensembleLevel);

  const DOORS = [
    { edge: 'start|walk', key: 'walk', name: 'Walk into the aisle' },
    { edge: 'aisle|shelf', key: 'shelf', name: 'Shelf door' },
    { edge: 'aisle|glare', key: 'glare', name: 'Glare door' },
    { edge: 'aisle|vault', key: 'vault', name: 'Vault door' },
  ];
  const QUESTIONS = {
    predict: {
      id: 'ensemble-p',
      correct: 1,
      prompt: 'Shelf is 1 and 1. Glare is 6 and 0. Vault is 0 and 0. The walk pays 0 in both tables. The planner does not read the true reward or the data column. What does scoring only the average do?',
      options: [
        { text: 'It stays at the shelf, because that door is marked as in the data.', correct: false, why: 'The data column is on the page and is not an input. The average at glare is 3, and the average at the shelf is 1.' },
        { text: 'It enters glare. The average there is 3, which is higher than the shelf.', correct: true, why: 'Coefficient 0 scores the average. Glare wins that comparison. The true reward is applied only after the actions are chosen.' },
        { text: 'It already subtracts the difference, so it stays at the shelf before you pick a coefficient.', correct: false, why: 'The penalty is a separate score. The average plan uses coefficient 0.' },
      ],
    },
    diagnose: {
      id: 'ensemble-d',
      correct: 0,
      prompt: 'The average plan walked into glare and the aisle paid 0. What happened?',
      options: [
        { text: 'Coefficient 0 followed the average. The tables disagree on glare, the average is high, and the true reward, which was not an input, is 0.', correct: true, why: 'The planner score and the true return are different numbers. The walk used the aisle. The plan did not.' },
        { text: 'The penalty refused glare.', correct: false, why: 'The average plan used coefficient 0. The penalty is the other plan.' },
        { text: 'Glare was deleted because it was not in the data.', correct: false, why: 'There is no mask. The average plan chose glare.' },
      ],
    },
    explain: {
      id: 'ensemble-x',
      correct: 1,
      prompt: 'What does this penalty do, and what does a difference of zero not do?',
      options: [
        { text: 'A difference of zero proves the tables are right, so the penalty is a safety guarantee.', correct: false, why: 'The confident glare walk had difference 0, planner score 6, and true return 0. The penalty subtracted nothing.' },
        { text: 'The score is the average minus the coefficient times the absolute difference. It falls only when the tables differ. If both tables are wrong together, the walk can still score 0 in the aisle. These tables were supplied; this experiment did not train them.', correct: true, why: 'The vault walk is the other side: both tables said 5 on a door that was not in the data, the penalty did not mask it, and the aisle paid 5.' },
        { text: 'The repair stored a path to the shelf and plays that path back.', correct: false, why: 'Each button calls the planner on the tables it shows, then walks those actions in the aisle. The shelf path is not saved as the answer.' },
      ],
    },
  };

  const state = {
    step: 0, picks: {}, finished: false, error: '',
    coefficient: E.LESSON_COEFFICIENT,
    modelA: E.copyRewards(E.LESSON_A),
    modelB: E.copyRewards(E.LESSON_B),
    truth: E.copyRewards(E.LESSON_TRUTH),
    lessonRun: null, wrongRun: null, highRun: null, customRun: null,
  };
  let hooks = {};
  let redraw = null;

  function num(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 'undefined';
    const rounded = Math.round(x * 10000) / 10000;
    return String(rounded);
  }
  function pair(modelA, modelB, coefficient, truth) {
    return E.record(modelA, modelB, coefficient, truth);
  }

  function wrongPair() {
    const modelA = E.copyRewards(E.LESSON_A);
    const modelB = E.copyRewards(E.LESSON_B);
    modelA['aisle|glare'] = 6;
    modelB['aisle|glare'] = 6;
    return pair(modelA, modelB, E.LESSON_COEFFICIENT, E.LESSON_TRUTH);
  }
  function highPair() {
    const modelA = E.copyRewards(E.LESSON_A);
    const modelB = E.copyRewards(E.LESSON_B);
    const truth = E.copyRewards(E.LESSON_TRUTH);
    modelA['aisle|vault'] = 5;
    modelB['aisle|vault'] = 5;
    truth['aisle|vault'] = 5;
    return pair(modelA, modelB, E.LESSON_COEFFICIENT, truth);
  }
  function advance(n) {
    state.step = Math.max(state.step, n);
    if (hooks.mark) hooks.mark(n);
  }
  function lessonOk(run) {
    return !!(run && run.meanPlan.actions.join(',') === 'walk,glare' && run.meanRun.trueReturn === 0
      && run.penPlan.actions.join(',') === 'walk,shelf' && run.penRun.trueReturn === 1
      && run.penPlan.plannerScore < run.meanPlan.plannerScore);
  }
  function wrongOk(run) {
    if (!run) return false;
    const glare = run.penPlan.steps.find((step) => step.action === 'glare');
    return !!(glare && glare.disagreement === 0 && glare.score === glare.mean
      && run.penPlan.actions.at(-1) === 'glare' && run.meanPlan.actions.at(-1) === 'glare'
      && run.penRun.trueReturn === 0 && run.penPlan.plannerScore > run.penRun.trueReturn);
  }
  function highOk(run) {
    if (!run) return false;
    const vault = run.penPlan.steps.find((step) => step.action === 'vault');
    return !!(vault && vault.disagreement === 0 && E.LESSON_SUPPORT['aisle|vault'] === false
      && run.penPlan.actions.at(-1) === 'vault' && run.meanPlan.actions.at(-1) === 'vault'
      && run.penRun.trueReturn === 5);
  }
  function restoreLesson() {
    state.modelA = E.copyRewards(E.LESSON_A);
    state.modelB = E.copyRewards(E.LESSON_B);
    state.truth = E.copyRewards(E.LESSON_TRUTH);
    state.coefficient = E.LESSON_COEFFICIENT;
  }
  function runLesson() {
    state.error = '';
    state.lessonRun = pair(state.modelA, state.modelB, state.coefficient, state.truth);
    advance(2);
    return state.lessonRun;
  }
  function runWrong() {
    state.wrongRun = wrongPair();
    state.modelA = E.copyRewards(state.wrongRun.modelA);
    state.modelB = E.copyRewards(state.wrongRun.modelB);
    state.truth = E.copyRewards(state.wrongRun.truth);
    state.coefficient = state.wrongRun.coefficient;
    state.customRun = state.wrongRun;
    state.error = '';
    if (wrongOk(state.wrongRun) && highOk(state.highRun)) advance(4);
  }
  function runHigh() {
    state.highRun = highPair();
    state.modelA = E.copyRewards(state.highRun.modelA);
    state.modelB = E.copyRewards(state.highRun.modelB);
    state.truth = E.copyRewards(state.highRun.truth);
    state.coefficient = state.highRun.coefficient;
    state.customRun = state.highRun;
    state.error = '';
    if (wrongOk(state.wrongRun) && highOk(state.highRun)) advance(4);
  }

  let timer = null, time = 0, current = null, stale = false, adapter = null;
  const pause = () => { clearInterval(timer); timer = null; };
  const accept = record => { pause(); current = record; time = 0; stale = false; };
  const api = {
    cancel() { pause(); current = null; stale = false; time = 0; state.lessonRun = null; state.customRun = null; state.wrongRun = null; state.highRun = null; },
    record: () => current,
    replay: () => ({ time, world: 'ensemble', length: current ? current.series.mean.length : 0, watching: !!timer, stale }),
    state: () => ({ world: 'ensemble', level: ensembleLevel.title, knobs: { coefficient: state.coefficient }, lastRun: current }),
    run() { const record = runLesson(); accept(record); if (redraw) redraw(); return record; },
    mount(pane, lab, apiHooks) {
      pause();
      hooks = apiHooks || {};
      state.step = hooks.step ? hooks.step() : 0;
      state.finished = hooks.done ? hooks.done() : false;
      if (hooks.answer) Object.values(QUESTIONS).forEach(q => {
        const prev = hooks.answer(q.id); if (prev) state.picks[q.id] = prev.choice;
      });
      const h = hooks.h;
      const body = h('div.card.stack.teaching-card', { id: 'ensemble-lesson' });
      pane.append(body);
      const scene = h('section.card.stack', { id: 'ensemble-scene', 'aria-label': 'Measured aisle experiment' });
      lab.replaceChildren(scene);
      const notebook = (section, content) => {
        if (hooks.shell) hooks.shell.notebook(section).replaceChildren(content);
        else body.append(h('details', null, [h('summary', { text: section }), content]));
      };
      function drawScene(el, record, t) {
        if (t === null) return record.series.mean.length;
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 320 220'); svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Two aisle rollouts at move ' + t + '. A is the average plan; P is the penalty plan.');
        svg.style.cssText = 'width:100%;max-width:640px;color:var(--ink);';
        const pos = { start: [35, 110], aisle: [130, 110], shelf: [265, 40], glare: [265, 110], vault: [265, 180] };
        function add(tag, attrs, label) { const node = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k,v)); if (label) node.textContent = label; svg.append(node); return node; }
        [['start','aisle'], ['aisle','shelf'], ['aisle','glare'], ['aisle','vault']].forEach(([a,b]) => {
          add('line', { x1:pos[a][0], y1:pos[a][1], x2:pos[b][0], y2:pos[b][1], stroke:'currentColor', 'stroke-width':2, opacity:0.45 });
        });
        Object.entries(pos).forEach(([name,[x,y]]) => {
          add('circle', { cx:x, cy:y, r:6, fill:'none', stroke:'currentColor' });
          add('text', { x, y:y+25, 'text-anchor':'middle', fill:'currentColor', 'font-size':13 }, name);
        });
        const status = [];
        [{ name:'mean', mark:'A', dy:-10 }, { name:'penalty', mark:'P', dy:10 }].forEach(({name,mark,dy}) => {
          const samples = record ? record.series[name] : [{obs:'start'}];
          const sample = samples[Math.min(t, samples.length-1)], [x,y] = pos[sample.obs];
          if (record && t) add('polyline', { points:samples.slice(0,t+1).map(p => pos[p.obs].join(',')).join(' '), fill:'none', stroke:'currentColor', 'stroke-width':3, 'stroke-dasharray':name==='mean'?'6 4':'1 0' });
          add('rect', { x:x-9, y:y+dy-8, width:18, height:16, rx:name==='mean'?0:8, fill:'var(--surface)', stroke:'currentColor' });
          add('text', { x, y:y+dy+4, 'text-anchor':'middle', fill:'currentColor', 'font-size':12 }, mark);
          const seen = samples.slice(0,t+1);
          status.push((name==='mean'?'A Average':'P Penalty') + ': ' + sample.obs + (record ? '. Predicted reward so far ' + num(seen.reduce((a,p)=>a+p.predictedReward,0)) + '; true return so far ' + num(seen.reduce((a,p)=>a+p.reward,0)) : '. Ready at start.'));
        });
        el.replaceChildren(svg, h('p', { id:'ensemble-frame', role:'status', text:status.join(' ') }));
      }
      redraw = () => {
        if (!body.isConnected) { pause(); return; }
        const predicted = state.picks[QUESTIONS.predict.id] === QUESTIONS.predict.correct;
        const choices = (q, onCorrect) => h('div.mc', { id:q.id }, [h('p', {text:q.prompt}), ...q.options.map((opt,i) => h('button.opt', {
          id:q.id+'-'+i, type:'button', disabled:state.picks[q.id]===q.correct,
          onclick:() => { state.picks[q.id]=i; if(hooks.record) hooks.record(q.id,i,opt.correct); if(opt.correct) onCorrect(); redraw(); }
        }, [h('span', {text:opt.text}), state.picks[q.id]===i ? h('span.why', {role:'status',text:opt.why}) : null]))]);
        body.replaceChildren(h('div.eyebrow', {text:'Two reward tables'}), h('h2', {text:ensembleLevel.title}), h('p', {text:ensembleLevel.intro}),
          h('p.small', null, ['Idea adapted from ', h('a',{href:E.SOURCE.slides,target:'_blank',rel:'noopener'},'Berkeley CS 285'), '.']));
        const cards = [];
        cards.push(h('div.step', {id:'ensemble-step-predict'}, [h('h3',{text:'Predict before you run'}),choices(QUESTIONS.predict,()=>advance(1))]));
        cards.push(h('div.step', {id:'ensemble-step-run'}, [h('h3',{text:'Run both plans in the aisle'}),h('p',{text:'A uses the table average. P subtracts coefficient times absolute disagreement. Each plan walks two actions in the true aisle. Each door ends its episode. Run uses the tables and coefficient shown below.'}),h('button.btn',{id:'ensemble-run',type:'button',disabled:!predicted,onclick:()=>{ try { accept(pair(state.modelA,state.modelB,state.coefficient,state.truth)); state.lessonRun=current; state.error=''; advance(2); } catch(e) { state.error=e.message; } redraw(); }},'Run both plans')]));
        cards.push(h('div.step',{id:'ensemble-step-diagnose'},[h('h3',{text:'Diagnose'}), lessonOk(current) ? choices(QUESTIONS.diagnose,()=>advance(3)) : h('p',{text:'Restore lesson settings and Run both plans to inspect the lesson comparison before diagnosing it.'})]));
        cards.push(h('div.step',{id:'ensemble-step-repair'},[h('h3',{text:'Test what agreement cannot promise'}),h('p',{text:'Both examples run the same planner. One makes both glare predictions 6 while true reward stays 0. The other makes both vault predictions and its true reward 5. The data marker never masks a door.'}),
          h('button.btn',{id:'ensemble-wrong',type:'button',onclick:()=>{runWrong();accept(state.wrongRun);redraw();}},'Both tables agree glare is 6. Walk it.'),
          h('button.btn',{id:'ensemble-high',type:'button',onclick:()=>{runHigh();accept(state.highRun);redraw();}},'Both tables agree the vault is 5, and the aisle pays 5. Walk it.'),
          h('p',{text:(wrongOk(state.wrongRun)?'Confident miss checked. ':'')+(highOk(state.highRun)?'Unseen vault checked.':'')})]));
        cards.push(h('div.step',{id:'ensemble-step-explain'},[h('h3',{text:'Explain the limit'}),choices(QUESTIONS.explain,()=>{}),h('button.btn',{id:'ensemble-complete',type:'button',disabled:state.picks[QUESTIONS.explain.id]!==QUESTIONS.explain.correct || !wrongOk(state.wrongRun) || !highOk(state.highRun),onclick:()=>{if(hooks.complete)hooks.complete();state.finished=true;advance(5);redraw();}},state.finished?'Lesson complete':'Agreement is not the true reward')]));
        body.append(cards[Math.min(state.step,4)]);
        const notes = h('div.stack',null,cards.filter((_,i)=>i<state.step));
        notebook('notes',notes);
        const rule = h('div.stack', {id:'ensemble-rules'}, [h('p',{text:'Supplied tables, no fitting. Score = (A + B) / 2 - coefficient × |A - B|. The planner never reads true rewards. Predicted reward is the table average; planner score includes the penalty; true return is measured by walking the chosen actions.'}),h('p',{text:'Prior interactions: 0. No training or bootstrap samples. Each Run executes two two-action episodes: 4 fresh interactions and 2 attempts.'})]);
        if(hooks.shell) rule.append(hooks.shell.conceptSketch({label:'Prediction and execution',nodes:[{id:'tables',label:'Two tables',x:55,y:35},{id:'plan',label:'Choose actions',x:215,y:35},{id:'truth',label:'Walk true aisle',x:215,y:95}],edges:[{from:'tables',to:'plan',label:'score'},{from:'plan',to:'truth',label:'execute'}]}));
        notebook('rule',rule);
        const settings = h('div.stack',{id:'ensemble-editor'},[h('h3',{text:'Change the supplied tables'}),h('p',{text:'The walk pays 0, shelf pays 1, glare and vault pay 0 in the lesson aisle. Changing predictions changes planning, not these true rewards.'})]);
        const changed=()=>{pause();stale=!!current; redrawStatus();};
        DOORS.forEach(door=>settings.append(h('div.stack',null,[h('span',{text:door.name}),...['A','B'].map(letter=>h('label',null,['Table '+letter,h('input',{id:'ensemble-'+letter.toLowerCase()+'-'+door.key,type:'number',step:'1',value:String(state['model'+letter][door.edge]),oninput:e=>{state['model'+letter][door.edge]=Number(e.target.value);changed();}})]))])));
        settings.append(h('label',null,['Disagreement coefficient',h('input',{id:'ensemble-coefficient',type:'number',min:'0',step:'0.1',value:String(state.coefficient),oninput:e=>{state.coefficient=Number(e.target.value);changed();}})]),
          h('button.btn.ghost',{id:'ensemble-recompute',type:'button',disabled:!predicted,onclick:()=>{try{accept(pair(state.modelA,state.modelB,state.coefficient,state.truth));state.error='';}catch(e){state.error=e.message;}redraw();}},'Run with changed settings'),
          h('button.btn.ghost',{id:'ensemble-restore',type:'button',onclick:()=>{restoreLesson();stale=!!current;redraw();}},'Restore lesson settings'));
        body.append(settings);
        if(state.error)body.append(h('p',{role:'alert',text:state.error}));
        const view = h('div',{id:'ensemble-stage'});
        const watch = h('button.btn',{id:'ensemble-watch',type:'button',disabled:!current||stale,onclick:()=>{
          if(timer)pause();else if(!matchMedia('(prefers-reduced-motion: reduce)').matches){if(time>=adapter.length(current)-1)time=0;timer=setInterval(()=>{if(!scene.isConnected){pause();return;}time++;if(time>=adapter.length(current)-1)pause();paint();watch.textContent=timer?'Pause':'Watch';},650);}watch.textContent=timer?'Pause':'Watch';
        }},timer?'Pause':'Watch');
        const paint=()=>{if(current)adapter.draw(current,time); body.querySelectorAll('[data-ensemble-t]').forEach(row=>row.setAttribute('aria-current',String(Number(row.dataset.ensembleT)===time))); if(hooks.shell)hooks.shell.notebook('curve').querySelectorAll('[data-ensemble-t]').forEach(row=>row.setAttribute('aria-current',String(Number(row.dataset.ensembleT)===time)));};
        const controls=h('div.row',{id:'ensemble-controls'},[watch,h('button.btn',{id:'ensemble-step',type:'button',disabled:!current||stale,onclick:()=>{pause();time=Math.min(time+1,adapter.length(current)-1);paint();watch.textContent='Watch';}},'Step'),h('button.btn',{id:'ensemble-replay',type:'button',disabled:!current||stale,onclick:()=>{pause();time=0;paint();watch.textContent='Watch';}},'Replay')]);
        scene.replaceChildren(h('h3',{text:'Aisle experiment'}),h('p',{text:'A square, dashed path: Average plan. P circle, solid path: Penalty plan. Only returned rollout states are replayed.'}),view,controls,h('p',{id:'ensemble-stale',role:'status'}));
        adapter=BB.sceneAdapter.create({world:'ensemble',settings:['modelA','modelB','coefficient'],render:drawScene});adapter.mount(view);paint();
        const curve=h('div.stack',{id:'ensemble-chart'},[h('h3',{text:'Predicted reward and measured return by move'})]);
        const results=h('div.stack',{id:'ensemble-result'});
        if(current){
          current.policies.forEach(({name,label})=>{
            const m=current.metrics[name];
            results.append(h('p',{text:label+': predicted reward '+num(m.predictedReturn)+'; planner score '+num(m.plannerScore)+'; true return '+num(m.trueReturn)+'. Episode ended: '+current.terminal[name]+'.'}));
            curve.append(h('h4',{text:label}),h('div.vpo-table',null,[h('table',null,[h('thead',null,[h('tr',null,['Move','State','Predicted reward','True reward'].map(text=>h('th',{text})))]),h('tbody',null,current.series[name].map(p=>h('tr',{'data-ensemble-t':String(p.t),'aria-current':String(p.t===time)},[p.t,p.obs,p.predictedReward,p.reward].map(value=>h('td',{text:String(value)})))))]) ]));
          });
          results.append(h('p.small',{text:'Prior interactions '+current.data.prior.steps+'. Fresh interactions '+current.data.fresh.steps+' in '+current.data.fresh.attempts+' attempts. No training.'}));
        }else results.append(h('p',{text:'Run to measure the two chosen paths. Results are hidden until then.'}));
        notebook('curve',curve);notebook('autopsy',results);
        function redrawStatus(){
          for(const el of [scene,view,curve,results]){if(current)el.dataset.run=current.id;else delete el.dataset.run;el.dataset.stale=String(stale);}
          scene.querySelector('#ensemble-stale').textContent=stale?'Settings changed. Run again to replace these previous measurements.':'';
          controls.querySelectorAll('button').forEach(b=>b.disabled=!current||stale);
        }
        redrawStatus();
      };
      redraw();
    },
  };
  window.BBENSEMBLE_LEVEL = api;
})(window.CONTENT, window.BBENSEMBLE);
