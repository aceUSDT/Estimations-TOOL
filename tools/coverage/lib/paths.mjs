/* Shared filesystem layout for the coverage harness and regression tests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = path.resolve(COVERAGE_DIR, '..', '..');
export const WORK = path.join(COVERAGE_DIR, 'work');
export const REPORTS = path.join(ROOT, 'reports');
export const EXAMPLES = path.join(ROOT, 'examples');
export const DEFAULT_FIXTURE = path.join(EXAMPLES, 'db-schedules/simple/BC250847-E13_Distribution.pdf');

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export const loadGroundTruth = () => readJson(path.join(COVERAGE_DIR, 'ground-truth.json'));

export const loadWorkIndex = () => readJson(path.join(WORK, 'index.json'));

export const loadWorkMeta = (slug) => readJson(path.join(WORK, slug, 'meta.json'));

export const pagePath = (slug, prefix, page, ext) =>
  path.join(WORK, slug, `${prefix}-${String(page).padStart(3, '0')}.${ext}`);
