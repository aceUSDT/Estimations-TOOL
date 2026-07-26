/* Loaders for the application cores under test.
 *
 * extractor-core.js is a browser script that publishes itself on globalThis;
 * report-core.js is evaluated in a vm sandbox so tests never leak its globals
 * into the test process. app-pipeline.cjs is the verbatim copy of index.html's
 * inline extraction path. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { COVERAGE_DIR, ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);

export async function loadExtractorCore() {
  await import(pathToFileURL(path.join(ROOT, 'extractor-core.js')));
  return globalThis.EstimationExtractorCore;
}

export function loadReportCore() {
  const source = fs.readFileSync(path.join(ROOT, 'report-core.js'), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context, { filename: 'report-core.js' });
  return context.EstimationReport;
}

export function loadPipeline() {
  return require(path.join(COVERAGE_DIR, 'app-pipeline.cjs'));
}
