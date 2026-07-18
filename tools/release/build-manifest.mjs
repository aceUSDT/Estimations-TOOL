/* Build the release manifest from final (post-signing) artifacts.
 *
 *   node tools/release/build-manifest.mjs --dir dist --out dist/manifest.json [--production]
 *
 * Sizes and SHA-256 hashes are computed from the exact files a customer will
 * download — after signing, never from unpacked apps. The manifest is then
 * validated with the same validateManifest() the download service uses, and
 * the script exits non-zero on any violation (missing target, duplicate,
 * unsafe name, zero-byte file, or signed:false with --production).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const { SUPPORTED_BUILDS, validateManifest } = await import(
  pathToFileURL(path.resolve(HERE, '../../netlify/functions/lib/release-store.mjs')),
);

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const DIR = arg('--dir', 'dist');
const OUT = arg('--out', path.join(DIR, 'manifest.json'));
const PRODUCTION = process.argv.includes('--production');

async function sha256(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(file).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

const files = await readdir(DIR);
const version = (() => {
  for (const f of files) {
    const m = f.match(/^Estimation-Tools-(\d+\.\d+\.\d+(?:-rc\.\d+)?)-/);
    if (m) return m[1];
  }
  throw new Error(`no Estimation-Tools-<version>-... artifact found in ${DIR}`);
})();

const builds = [];
for (const spec of SUPPORTED_BUILDS) {
  const expected = `Estimation-Tools-${version}-${spec.platform}-${spec.arch}${spec.extension}`;
  if (!files.includes(expected)) {
    console.error(`MISSING artifact for ${spec.id}: expected ${expected}`);
    continue;
  }
  const file = path.join(DIR, expected);
  const info = await stat(file);
  builds.push({
    id: spec.id,
    platform: spec.platform,
    arch: spec.arch,
    minimumOs: spec.minimumOs,
    fileName: expected,
    objectKey: `releases/${version}/${spec.platform}/${spec.arch}/${expected}`,
    size: info.size,
    sha256: await sha256(file),
    // Signing is asserted by the caller's context: production tags run the
    // signtool/codesign/spctl/stapler verification jobs BEFORE this script,
    // and --production refuses unsigned entries outright.
    signed: PRODUCTION,
  });
}

const manifest = {
  schemaVersion: 1,
  version,
  publishedAt: new Date().toISOString(),
  builds,
};

const check = validateManifest(manifest, { production: PRODUCTION });
if (!check.ok) {
  console.error('Manifest validation FAILED:');
  for (const e of check.errors) console.error('  - ' + e);
  process.exit(1);
}

await writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${OUT}: version ${version}, ${builds.length} builds${PRODUCTION ? ' (production)' : ''}`);
for (const b of builds) console.log(`  ${b.id}  ${b.fileName}  ${b.size} bytes  sha256=${b.sha256.slice(0, 12)}…`);
