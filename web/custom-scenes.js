// SceneAdapter implementations for VPO's route menu and SuperMimic's measured physics.
(function (BB) {
  'use strict';
  function create(world, policy, host) {
    const cv = host.querySelector('canvas'), caption = host.querySelector('[data-caption]');
    const accounting = host.querySelector('[data-accounting]');
    const chart = host.querySelector('[data-chart]'), readout = host.querySelector('[data-readout]');
    const color = key => getComputedStyle(document.documentElement).getPropertyValue(key).trim();
    return BB.sceneAdapter.create({ world, settings: world === 'vpo' ? ['generations'] : ['scale'],
      render(el, record, t) {
        const name = record?.policies[policy]?.name, series = record?.series[name];
        if (t === null) return series?.length || 0;
        const sample = series?.[Math.min(t, series.length - 1)], c = cv.getContext('2d');
        const ink = color('--ink'), accent = color('--accent'), muted = color('--muted');
        c.clearRect(0, 0, cv.width, cv.height); c.fillStyle = color('--surface'); c.fillRect(0, 0, cv.width, cv.height);
        c.font = '26px sans-serif'; c.textAlign = 'left'; c.lineWidth = 2;
        if (world === 'vpo') {
          const V = globalThis.BBVPO, size = 48, left = 42, top = 24;
          V.GRID.forEach((row, y) => [...row].forEach((tile, x) => {
            c.strokeStyle = color('--line'); c.strokeRect(left + x * size, top + y * size, size, size);
            if (tile !== '.') { c.fillStyle = ink; c.fillText(tile, left + x * size + 17, top + y * size + 30); }
          }));
          if (sample) {
            c.strokeStyle = accent; c.lineWidth = 4; c.beginPath();
            series.filter(x => x.episode === sample.episode && x.step <= sample.step).forEach((x, i) => {
              const px = left + (x.obs[0] + .5) * size, py = top + (x.obs[1] + .5) * size;
              if (i) c.lineTo(px, py); else c.moveTo(px, py);
            }); c.stroke();
          }
          const p = sample?.obs || V.START;
          BB.scenes.robot(c, left + (p[0] + .5) * size, top + (p[1] + .85) * size, 30, { noShadow: true });

          caption.textContent = sample
            ? record.policies[policy].label + ' selected ' + sample.routeName + ', candidate ' + (sample.episode + 1) + ' of 30. Predefined route replay, move ' + sample.step + '. ' + (sample.terminal || '')
            : 'Start at S. The learners choose among ten predefined routes. Run measures their selections; replay follows those route actions.';
        } else {
          const q = sample?.obs[0] ?? 0, target = sample?.reference.q ?? globalThis.BBSUPERMIMIC.reference(0).q;
          const arm = (angle, dashed, label) => {
            const x = 210 + 145 * Math.sin(angle), y = 80 + 145 * Math.cos(angle);
            c.strokeStyle = dashed ? muted : accent; c.lineWidth = dashed ? 4 : 9; c.setLineDash(dashed ? [8, 6] : []);
            c.beginPath(); c.moveTo(210, 80); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
            c.fillStyle = dashed ? muted : accent;
            if (dashed) c.strokeRect(x - 10, y - 10, 20, 20); else { c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill(); }

          };
          arm(target, true, 'Dashed + square: reference'); arm(q, false, 'Solid + circle: physics');
          c.fillStyle = ink; c.beginPath(); c.arc(210, 80, 10, 0, Math.PI * 2); c.fill();
          caption.textContent = sample
            ? record.policies[policy].label + ', physics test ' + (sample.episode + 1) + ' of 12, step ' + sample.step + ' of 100. ' + (sample.terminal || (sample.kind === 'reset' ? 'Measured reset.' : ''))
            : 'One joint tracks a moving reference with bounded torque. Setup pose only; Run records each method in true physics.';
        }
        for (const node of [cv, chart, caption, readout, accounting]) {
          node.dataset.world = world; node.dataset.frame = String(t);
          if (record) node.dataset.run = record.id; else delete node.dataset.run;
        }
        const cc = chart.getContext('2d'); cc.clearRect(0, 0, chart.width, chart.height);
        chart.hidden = !sample; readout.hidden = !sample;
        accounting.hidden = !record;
        if (record) {
          const metric = record.metrics[name];
          accounting.textContent = world === 'vpo'
            ? 'This method: ' + metric.training.steps + ' fresh training route selections, no prior training data. Evaluation: ' + metric.evaluation.steps + ' route selections in ' + metric.evaluation.attempts + ' pools. Replay shows the final pool; the table averages all pools.'
            : 'Earlier model-fit data: ' + record.data.prior.steps + ' physics transitions, collected in this run. This method: ' + metric.trainingSteps + (policy === 0 ? ' fresh physics training steps' : ' imagined training steps') + '. Separate physics tests: ' + metric.accounting.evaluation.steps + ' final steps and ' + metric.accounting.diagnostics.steps + ' diagnostic steps. Timing benchmark steps are separate again.';
        }
        if (sample) {
          const data = series.filter(x => x.episode === sample.episode), values = data.map(x => Array.isArray(x.reward) ? x.reward.reduce((s, v) => s + v, 0) / 4 : x.reward);
          const lo = Math.min(0, ...values), hi = Math.max(1, ...values);
          cc.strokeStyle = accent; cc.lineWidth = 2; cc.beginPath();
          values.forEach((v, i) => { const x = 20 + 600 * i / Math.max(1, values.length - 1), y = 100 - 80 * (v - lo) / (hi - lo); if (i) cc.lineTo(x, y); else cc.moveTo(x, y); }); cc.stroke();
          cc.strokeStyle = ink; cc.setLineDash([4, 4]); cc.beginPath(); const x = 20 + 600 * sample.step / Math.max(1, values.length - 1); cc.moveTo(x, 10); cc.lineTo(x, 110); cc.stroke(); cc.setLineDash([]);
          const reward = values[sample.step];
          readout.textContent = world === 'vpo'
            ? 'Recorded route reward (exit, gold, diamond, safe): [' + sample.reward.join(', ') + ']. Fixed mean: ' + reward.toFixed(3) + '. No incremental payment before the route ends.'
            : 'Angle ' + sample.obs[0].toFixed(3) + ', velocity ' + sample.obs[1].toFixed(3) + ', reference angle ' + sample.reference.q.toFixed(3) + ', action ' + (sample.action === null ? 'none at reset' : sample.action.toFixed(3)) + ', reward ' + reward.toFixed(3) + '.';
        }
        return series?.length || 0;
      } });
  }
  function panel(h, world) {
    return h('section.card.custom-scene', { 'data-custom-scene': world }, [
      h('h3', { text: world === 'vpo' ? 'Replay a sampled route' : 'Watch the physics test' }),
      h('canvas.stage', { id: 'custom-stage', width: 420, height: 420, style:'aspect-ratio:1;height:auto', role: 'img', 'aria-label': world === 'vpo' ? 'Predefined treasure route selected by a named policy' : 'Measured pendulum state and reference angle' }),
      h('p.small', { text: world === 'vpo' ? 'S start · E exit · G gold · D diamond · L walkable lava. Rover+ follows the recorded moves.' : 'Solid arm and circle: physics state. Dashed arm and square: reference. No learned-model prediction is drawn here.' }),
      h('p.small', { 'data-caption': '', role: 'status' }),
      h('div', { 'data-replay-controls': '' }),
      h('p.small', { text:'Recorded step reward after Run. The dashed cursor marks the replay frame.' }),
      h('canvas.chart', { width: 640, height: 120, style:'aspect-ratio:640/120;height:auto', 'data-chart': '', role: 'img', 'aria-label': 'Recorded step reward with replay cursor' }),
      h('p.small', { 'data-readout': '' }),
      h('p.small', { 'data-accounting': '' }),
    ]);
  }
  BB.customScenes = { create, panel };
})(globalThis.BB);
