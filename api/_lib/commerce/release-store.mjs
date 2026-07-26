/* Release manifest: the ONLY bridge between "files we built" and "files a
 * paying customer may download". The download endpoint never accepts file
 * names or object keys from the browser — it maps {platform, arch} through a
 * manifest that was validated at build time and stored PRIVATELY in R2.
 *
 * validateManifest() is shared by tools/release/build-manifest.mjs (build),
 * tools/release/publish-r2.mjs (publish), the download-link function (serve)
 * and the files.{ROOT_DOMAIN} download-gateway Worker, so one schema governs
 * every stage.
 */

export const SUPPORTED_BUILDS = [
  { id: 'windows-x64', platform: 'windows', arch: 'x64', extension: '.exe', minimumOs: 'Windows 10 64-bit' },
  { id: 'windows-arm64', platform: 'windows', arch: 'arm64', extension: '.exe', minimumOs: 'Windows 11 ARM64' },
  { id: 'macos-x64', platform: 'macos', arch: 'x64', extension: '.dmg', minimumOs: 'macOS 11 (Intel)' },
  { id: 'macos-arm64', platform: 'macos', arch: 'arm64', extension: '.dmg', minimumOs: 'macOS 11 (Apple Silicon)' },
];

const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_OBJECT_KEY = /^releases\/[A-Za-z0-9][A-Za-z0-9./_-]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function validateManifest(manifest, { production = false } = {}) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['manifest is not an object'] };
  if (manifest.schemaVersion !== 1) fail(`unsupported schemaVersion ${manifest.schemaVersion}`);
  if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(String(manifest.version || ''))) fail(`invalid version "${manifest.version}"`);
  if (Number.isNaN(Date.parse(manifest.publishedAt || ''))) fail('publishedAt is not an ISO-8601 timestamp');
  if (!Array.isArray(manifest.builds) || manifest.builds.length === 0) {
    fail('builds missing or empty');
    return { ok: false, errors };
  }

  const seen = new Set();
  const knownIds = new Set(SUPPORTED_BUILDS.map((b) => b.id));
  for (const build of manifest.builds) {
    const label = build && build.id ? build.id : JSON.stringify(build).slice(0, 60);
    if (!build || typeof build !== 'object') { fail(`build entry is not an object: ${label}`); continue; }
    if (!knownIds.has(build.id)) fail(`unknown build id "${build.id}"`);
    if (seen.has(build.id)) fail(`duplicate build id "${build.id}"`);
    seen.add(build.id);
    const spec = SUPPORTED_BUILDS.find((b) => b.id === build.id);
    if (spec) {
      if (build.platform !== spec.platform) fail(`${label}: platform "${build.platform}" ≠ "${spec.platform}"`);
      if (build.arch !== spec.arch) fail(`${label}: arch "${build.arch}" ≠ "${spec.arch}"`);
      if (typeof build.fileName === 'string' && !build.fileName.endsWith(spec.extension)) {
        fail(`${label}: fileName must end with ${spec.extension}`);
      }
    }
    if (!SAFE_FILENAME.test(String(build.fileName || ''))) fail(`${label}: unsafe fileName "${build.fileName}"`);
    if (!SAFE_OBJECT_KEY.test(String(build.objectKey || ''))) fail(`${label}: unsafe objectKey "${build.objectKey}"`);
    if (String(build.objectKey || '').includes('..')) fail(`${label}: objectKey contains ".."`);
    if (!Number.isInteger(build.size) || build.size <= 0) fail(`${label}: size must be a positive integer (zero-byte or missing file?)`);
    if (!SHA256_HEX.test(String(build.sha256 || ''))) fail(`${label}: sha256 must be 64 lowercase hex chars`);
    if (typeof build.minimumOs !== 'string' || !build.minimumOs) fail(`${label}: minimumOs missing`);
    if (typeof build.signed !== 'boolean') fail(`${label}: signed must be boolean`);
    if (production && build.signed !== true) fail(`${label}: signed:false is not allowed in a production manifest`);
  }
  for (const spec of SUPPORTED_BUILDS) {
    if (!seen.has(spec.id)) fail(`required build missing: ${spec.id}`);
  }
  return { ok: errors.length === 0, errors };
}

/* Resolve a customer's {platform, arch} request against the manifest.
 * Returns null (never throws) for anything not on the allow-list. */
export function resolveBuild(manifest, platform, arch) {
  const spec = SUPPORTED_BUILDS.find((b) => b.platform === platform && b.arch === arch);
  if (!spec) return null;
  const build = (manifest && Array.isArray(manifest.builds) ? manifest.builds : []).find((b) => b && b.id === spec.id);
  return build || null;
}

export const MANIFEST_OBJECT_KEY = 'releases/latest/manifest.json';

/* Fetch the private manifest from R2 via an injected S3-compatible client.
 * `deps.getObjectText(key)` keeps this module free of SDK imports so tests
 * can run without AWS credentials or network. */
export async function loadManifest(deps) {
  const text = await deps.getObjectText(MANIFEST_OBJECT_KEY);
  const manifest = JSON.parse(text);
  const check = validateManifest(manifest, { production: true });
  if (!check.ok) throw new Error(`stored manifest failed validation: ${check.errors.join('; ')}`);
  return manifest;
}
