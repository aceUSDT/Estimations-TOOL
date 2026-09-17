const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { verifyDesktopAssets, localScriptPaths } = require('./verify-assets.cjs');
const { extraResources } = require('./electron-builder.config.cjs');

test('the current HTML runtime and offline assets have valid package destinations', () => {
  assert.doesNotThrow(() => verifyDesktopAssets());
});

for (const script of ['decision-core.js', 'review-core.js', 'schematic-topology-core.js']) {
  test(`removing ${script} from packaging fails even though its source exists`, () => {
    const resources = extraResources.filter((resource) => resource.from !== `../${script}`);
    assert.throws(() => verifyDesktopAssets({ extraResources: resources }), (error) =>
      error.message.includes('not packaged') && error.message.includes(script));
  });
}

test('a correct source at the wrong destination cannot satisfy the browser URL', () => {
  const resources = extraResources.map((resource) => resource.from === '../review-core.js'
    ? { ...resource, to: 'web/wrong-review-core.js' } : resource);
  assert.throws(() => verifyDesktopAssets({ extraResources: resources }), /not packaged.*review-core\.js/);
});

test('a correct destination with the wrong source cannot satisfy the runtime inventory', () => {
  const resources = extraResources.map((resource) => resource.from === '../review-core.js'
    ? { ...resource, from: '../report-core.js' } : resource);
  assert.throws(() => verifyDesktopAssets({ extraResources: resources }), /not packaged.*review-core\.js/);
});

test('folder resources are checked, including the offline worker', () => {
  const resources = extraResources.filter((resource) => resource.from !== '../vendor');
  assert.throws(() => verifyDesktopAssets({ extraResources: resources }), /not packaged.*vendor\/pdf\.worker\.min\.js/);
});

test('new script references are discovered without updating a hard-coded inventory', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
    + '\n<script src="./future-runtime-does-not-exist.js?v=2"></script>';
  assert.throws(() => verifyDesktopAssets({ html }), /Missing desktop assets: future-runtime-does-not-exist\.js/);
});

test('an existing script outside the packaged web folders is not exempt from verification', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
    + '\n<script src="./desktop/main.cjs"></script>';
  assert.throws(() => verifyDesktopAssets({ html }), /not packaged.*desktop\/main\.cjs/);
});

test('script references support URL suffixes, quoting and comments', () => {
  assert.deepEqual(localScriptPaths(`
    <!-- <script src="https://example.invalid/commented.js"></script> -->
    <script src="./review-core.js?v=2#boot"></script>
    <script defer src='/decision-core.js'></script>
    <script src=./review-core.js></script>
    <script>window.inlineOnly = true;</script>
  `), ['review-core.js', 'decision-core.js']);
  assert.throws(() => localScriptPaths('<script src="https://example.invalid/runtime.js"></script>'),
    /External desktop script dependency/);
});

test('filtered resources cannot silently claim an excluded runtime was packaged', () => {
  const resources = extraResources.map((resource) => resource.from === '../vendor'
    ? { ...resource, filter: ['**/*', '!pdf.worker.min.js'] } : resource);
  assert.throws(() => verifyDesktopAssets({ extraResources: resources }), /not packaged.*vendor\/pdf\.worker\.min\.js/);
});
