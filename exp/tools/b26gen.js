// batch 26: what each "which next action" word does to the predicted value (16 Oct 2026, from a page comment).
// Writes exp/config/b26.json for exp/tools/lvcal.js. Hyper as the page uses them (C.hyperOf).
global.window = global; window.CONTENT = {}; const fs = require('fs');
for (const f of ['content.js', 'content2.js']) eval(fs.readFileSync(__dirname + '/../../web/' + f, 'utf8'));
const C = window.CONTENT, out = [];
const add = (name, world, o, steps, seeds) => { const parts = C.cfg(o); out.push({ name, world, parts, hyper: C.hyperOf(parts, world), steps, seeds }); };
for (const agg of ['max', 'taken', 'mean', 'min']) add('cliff-' + agg, 'cliff', { agg }, 10000, 20);
add('cliff-max-second', 'cliff', { agg: 'max', scorer: 'second' }, 10000, 20);
add('cliff-max-minpair', 'cliff', { agg: 'max', scorer: 'minpair' }, 10000, 20);
for (const agg of ['max', 'taken', 'mean', 'min']) add('cart-table-' + agg, 'cartpole', { agg }, 20000, 5);
const dqn = { store: 'net', data: 'replay', picker: 'frozen', scorer: 'frozen' };
for (const agg of ['max', 'mean', 'min']) add('cart-dqn-' + agg, 'cartpole', Object.assign({}, dqn, { agg }), 20000, 3);
const naive = { store: 'net', data: 'latest', picker: 'live', scorer: 'live' };
for (const agg of ['max', 'min']) add('cart-naive-' + agg, 'cartpole', Object.assign({}, naive, { agg }), 20000, 3);
for (const agg of ['max', 'min']) add('mirage-' + agg, 'mirage', { agg }, 600, 300);
fs.writeFileSync(__dirname + '/../config/b26.json', JSON.stringify(out, null, 1));
console.log(out.length + ' configs');
