/* Publish signed release artifacts to the PRIVATE Cloudflare R2 bucket.
 *
 *   node tools/release/publish-r2.mjs --dir dist --manifest dist/manifest.json
 *
 * Order matters: every artifact is verified (current size + SHA-256 against
 * the manifest) and uploaded FIRST; the manifest itself is uploaded LAST so
 * the download service can never see a manifest that references missing
 * objects. Any mismatch or failed upload aborts with non-zero exit.
 *
 * Env (GitHub `production` environment — manual approval required):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * The bucket must remain private: no public access, no r2.dev URL.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const { validateManifest, MANIFEST_OBJECT_KEY } = await import(
  pathToFileURL(path.resolve(HERE, '../../netlify/functions/lib/release-store.mjs')),
);

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const DIR = arg('--dir', 'dist');
const MANIFEST_PATH = arg('--manifest', path.join(DIR, 'manifest.json'));

for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!process.env[name]) { console.error(`Missing env ${name}`); process.exit(1); }
}

const CONTENT_TYPES = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip',
};

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const check = validateManifest(manifest, { production: true });
if (!check.ok) {
  console.error('Refusing to publish: manifest failed production validation:');
  for (const e of check.errors) console.error('  - ' + e);
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

for (const build of manifest.builds) {
  const file = path.join(DIR, build.fileName);
  const info = await stat(file);
  if (info.size !== build.size) {
    console.error(`ABORT ${build.id}: size ${info.size} ≠ manifest ${build.size}`);
    process.exit(1);
  }
  const body = await readFile(file);
  const digest = createHash('sha256').update(body).digest('hex');
  if (digest !== build.sha256) {
    console.error(`ABORT ${build.id}: sha256 mismatch (file changed after manifest build?)`);
    process.exit(1);
  }
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: build.objectKey,
    Body: body,
    ContentType: CONTENT_TYPES[path.extname(build.fileName)] || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${build.fileName}"`,
  }));
  console.log(`uploaded ${build.objectKey} (${build.size} bytes)`);
}

// Manifest last — the service switches over atomically at this point.
await client.send(new PutObjectCommand({
  Bucket: process.env.R2_BUCKET,
  Key: MANIFEST_OBJECT_KEY,
  Body: JSON.stringify(manifest, null, 2),
  ContentType: 'application/json',
}));
console.log(`uploaded ${MANIFEST_OBJECT_KEY} — release ${manifest.version} is live for the download service`);
