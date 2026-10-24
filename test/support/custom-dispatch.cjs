'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');

// Execute the actual integrated dispatcher rather than requiring a particular spelling.
module.exports = function customDispatch(app, id, expected) {
  const names = ['BBREPLAN', 'BBENSEMBLE_LEVEL', 'BBMETARL', 'BBSKEW', 'BBSKILLS_LEVEL',
    'BBHINDSIGHT', 'BBHIERARCHY', 'BBELBO_LEVEL', 'BBMESSAGES_LEVEL', 'BBRARELESSON',
    'BBGOALS_LEVEL', 'BBREWARDFIT', 'BBTHAW', 'BBSUPERMIMIC', 'BBVPO'];
  const scope = Object.fromEntries(names.map(name => [name, {}]));
  scope.S = { mode: 'campaign', level: id };
  const active = app.match(/^  const \w+Active = \(\) => .+;$/gm);
  const dispatch = app.match(/^  const customApi = \(\) => .+;$/m);
  assert.ok(active && dispatch, 'actual custom dispatch declarations exist');
  const api = vm.runInNewContext(active.join('\n') + '\n' + dispatch[0] + '\ncustomActive() && customApi();', scope);
  assert.equal(api, scope[expected], id + ' mounts its own API');
  assert.match(app, /const api = customApi\(\);\s+api\.mount\(pane,/, 'campaign mounts the same dispatcher');
};
