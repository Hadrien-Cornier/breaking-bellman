// Draw only recorded cells. No path interpolation or planner runs during playback.
(function () {
  'use strict';
  const RF = window.BBREWARDFIT;
  RF.createSceneAdapter = ({ settings, policy = 'closeness', term = null }) => BB.sceneAdapter.create({
    world: 'rewardfit', settings: ['demonstrations', 'constraint'],
    render(canvas, record, t) {
      if (t === null) return Math.max(...record.policies.map(p => record.series[p.name].length));
      const ctx = canvas.getContext('2d'), css = getComputedStyle(canvas);
      const ink = css.getPropertyValue('--ink').trim(), muted = css.getPropertyValue('--muted').trim();
      const line = css.getPropertyValue('--line').trim(), sunk = css.getPropertyValue('--sunk').trim();
      const bad = css.getPropertyValue('--bad').trim(), good = css.getPropertyValue('--good').trim();
      const scale = canvas.width / 360; ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const cell = 66, px = 15, py = 26;
      const at = p => [px + p.x * cell + cell / 2, py + p.y * cell + cell / 2];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '13px sans-serif';
      for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
        ctx.fillStyle = sunk; ctx.fillRect(px + x * cell + 2, py + y * cell + 2, cell - 4, cell - 4);
        ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.strokeRect(px + x * cell + 2, py + y * cell + 2, cell - 4, cell - 4);
        if (term !== null) {
          const feature = RF.featuresOf(x, y)[term];
          ctx.strokeStyle = ink; ctx.lineWidth = feature ? 2 : 1;
          ctx.strokeRect(px + x * cell + 6, py + y * cell + 6, cell - 12, cell - 12);
          ctx.fillStyle = ink; ctx.fillText(String(feature), px + x * cell + 15, py + y * cell + 15);
        }
      }
      const demos = record ? record.demonstrations : RF.demonstrations(settings.demonstrations);
      RF.trips(demos).forEach((path, i) => {
        ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.setLineDash(i ? [2, 5] : [7, 5]); ctx.beginPath();
        path.forEach((p, n) => { const [x, y] = at(p); n ? ctx.lineTo(x, y + (i ? 7 : -7)) : ctx.moveTo(x, y + (i ? 7 : -7)); });
        ctx.stroke(); ctx.setLineDash([]);
        const [x, y] = at(path[1]); ctx.fillStyle = sunk; ctx.beginPath(); ctx.arc(x - 13, y + (i ? 7 : -7), 10, 0, 7); ctx.fill();
        ctx.fillStyle = ink; ctx.fillText(String(i + 1), x - 13, y + (i ? 7 : -7));
      });
      const [hx, hy] = at(RF.HOLE);
      ctx.strokeStyle = bad; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(hx, hy - 20); ctx.lineTo(hx + 21, hy + 16); ctx.lineTo(hx - 21, hy + 16); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = ink; ctx.fillText('!', hx, hy + 4);
      ctx.fillText('Hazard', hx, hy + 25);
      const [gx, gy] = at(RF.GOAL);
      ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(gx + 13, gy + 12); ctx.lineTo(gx + 13, gy - 23); ctx.stroke();
      ctx.fillStyle = good; ctx.beginPath(); ctx.moveTo(gx + 13, gy - 23); ctx.lineTo(gx + 30, gy - 15); ctx.lineTo(gx + 13, gy - 9); ctx.fill();
      ctx.fillStyle = ink; ctx.fillText('Flag', gx, gy + 26);
      ctx.fillText('Start', at(RF.START)[0], at(RF.START)[1] + 26);
      ctx.fillText('North', 180, 12); ctx.fillText('South', 180, 238);
      const series = record && record.series[policy];
      const slice = series ? series.slice(0, Math.min(t + 1, series.length)) : [];
      if (slice.length) {
        ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.beginPath();
        slice.forEach((s, n) => { const [x, y] = at(s.obs); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      }
      const p = slice.length ? slice.at(-1).obs : RF.START;
      const [rx, ry] = at(p);
      BB.scenes.robot(ctx, rx, ry + 16, 33, { noShadow: true, mood: 'normal' });
      canvas.dataset.world = 'rewardfit'; canvas.dataset.time = String(t); canvas.dataset.policy = policy;
      canvas.dataset.cell = p.x + ',' + p.y;
      if (record) canvas.dataset.run = record.id; else delete canvas.dataset.run;
      canvas.setAttribute('aria-label', 'Start at (0,1), flag at (4,1), traversable nonterminal hazard at (2,1). Two numbered dashed ' +
        (record ? record.settings.demonstrations : settings.demonstrations) + ' demonstrations. ' +
        (record ? record.policies.find(p => p.name === policy).label + ', move ' + Math.min(t, series.length - 1) + ', Rover+ at (' + p.x + ',' + p.y + ').' : 'Rover+ at Start. No measured route until Run.'));
    },
  });
})();
