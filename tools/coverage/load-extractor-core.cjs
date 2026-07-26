/* Loads extractor-core.js (a globals-attaching script, not an ES module) and
 * returns globalThis.EstimationExtractorCore. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

if (!globalThis.EstimationExtractorCore) {
  const file = path.join(__dirname, '..', '..', 'extractor-core.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

module.exports = globalThis.EstimationExtractorCore;
