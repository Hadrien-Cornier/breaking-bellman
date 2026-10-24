// Separate Live lesson: no changes to RLA.run or the original Fast semantic closure.
'use strict';
const { hash } = require('./fast-source.js');
const fs = require('node:fs'), path = require('node:path');
const engineFiles = ['src/agents/thaw.js'];
const files = [...engineFiles, 'web/thaw-record.js', 'web/thaw-level.js'];
function version() {
  return hash(JSON.stringify(Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(__dirname, '..', f)))]))));
}
module.exports = { engineFiles, files, version };
