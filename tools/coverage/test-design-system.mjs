import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/app-redesign.css'), 'utf8');

assert.ok(html.includes('<link rel="stylesheet" href="./assets/app-redesign.css">'), 'redesign stylesheet is not wired');
assert.ok(html.includes('Stored on this computer'), 'local-first storage wording has regressed');
assert.ok(html.includes('class="brand-accent"'), 'EstimationTools wordmark accent is missing');

const expectedTabs = ['docs', 'viewer', 'analysis', 'review', 'reports', 'compare'];
const actualTabs = [...html.matchAll(/class="ptab[^"\n]*"\s+data-pt="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(actualTabs.slice(0, expectedTabs.length), expectedTabs, 'project navigation order has regressed');

for (const contract of [
  '--font-ui: "IBM Plex Sans"',
  '--mono: "IBM Plex Mono"',
  '--t1: 12px', '--t2: 13px', '--t3: 14px', '--t4: 18px', '--t5: 24px', '--t6: 28px', '--t7: 34px',
  '--s1: 4px', '--s2: 8px', '--s3: 12px', '--s4: 16px', '--s5: 24px', '--s6: 32px', '--s7: 48px',
  '--radius-1: 2px', '--radius-2: 4px', '--radius-3: 8px',
  '--blue: #0079a8', '--brand: #009ee2', '--bg: #eef2f4', '--nav: #12181c',
  ':focus-visible', '@media (max-width: 540px)', '@media (prefers-reduced-motion: reduce)',
  'body[data-project-tab="viewer"]', '.doc-queue-scroll', '.appbar .brand-logo', '.report-board-table .report-spec-row td::before',
]) assert.ok(css.includes(contract), `missing design contract: ${contract}`);

assert.doesNotMatch(css, /letter-spacing:\s*-/, 'negative letter spacing is not allowed');

const fontFiles = [
  'IBMPlexSans-Regular.woff2',
  'IBMPlexSans-Medium.woff2',
  'IBMPlexSans-SemiBold.woff2',
  'IBMPlexMono-Regular.woff2',
  'IBMPlexMono-Medium.woff2',
  'LICENSE.txt',
];
for (const file of fontFiles) {
  const filePath = path.join(root, 'assets/fonts/ibm-plex', file);
  assert.ok(fs.existsSync(filePath) && fs.statSync(filePath).size > 1000, `missing bundled typography asset: ${file}`);
}

console.log('PASS: supplied design tokens, typography, navigation, responsive rules, and local-first wording');
