/* Regression tests: release manifest schema + allow-list resolution.
 * The manifest is the only bridge between built binaries and customer
 * downloads, so its validator must refuse every malformed shape. */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { validateManifest, resolveBuild, SUPPORTED_BUILDS } = await import(
  pathToFileURL(path.resolve(HERE, '../../api/_lib/commerce/release-store.mjs')),
);

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

const goodBuild = (spec, over = {}) => ({
  id: spec.id, platform: spec.platform, arch: spec.arch, minimumOs: spec.minimumOs,
  fileName: `Estimation-Tools-1.2.0-${spec.platform}-${spec.arch}${spec.extension}`,
  objectKey: `releases/1.2.0/${spec.platform}/${spec.arch}/Estimation-Tools-1.2.0-${spec.platform}-${spec.arch}${spec.extension}`,
  size: 87535450, sha256: 'a'.repeat(64), signed: true, ...over,
});
const goodManifest = (over = {}) => ({
  schemaVersion: 1, version: '1.2.0', publishedAt: new Date().toISOString(),
  builds: SUPPORTED_BUILDS.map((s) => goodBuild(s)), ...over,
});

check('valid manifest passes', validateManifest(goodManifest(), { production: true }).ok);
check('four supported builds exactly', SUPPORTED_BUILDS.length === 4);

let m = goodManifest(); m.builds = m.builds.slice(0, 3);
check('missing build refused', !validateManifest(m).ok);

m = goodManifest(); m.builds.push(goodBuild(SUPPORTED_BUILDS[0]));
check('duplicate id refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].fileName = '../../etc/passwd';
check('unsafe fileName refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].objectKey = 'releases/1.2.0/../secrets/key';
check('objectKey traversal refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].objectKey = 'private/other-bucket-key';
check('objectKey outside releases/ refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].size = 0;
check('zero-byte file refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].sha256 = 'ABC123';
check('bad sha256 refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].signed = false;
check('unsigned entry refused in production', !validateManifest(m, { production: true }).ok);
check('unsigned entry allowed for RC (non-production)', validateManifest(m).ok);

m = goodManifest({ schemaVersion: 2 });
check('unknown schemaVersion refused', !validateManifest(m).ok);

m = goodManifest(); m.builds[0].id = 'linux-x64';
check('unknown platform id refused', !validateManifest(m).ok);

/* resolveBuild: strict allow-list, never a path */
const manifest = goodManifest();
check('resolveBuild windows/x64', resolveBuild(manifest, 'windows', 'x64')?.id === 'windows-x64');
check('resolveBuild macos/arm64', resolveBuild(manifest, 'macos', 'arm64')?.id === 'macos-arm64');
check('resolveBuild refuses linux', resolveBuild(manifest, 'linux', 'x64') === null);
check('resolveBuild refuses traversal-ish input', resolveBuild(manifest, '../releases', 'x64') === null);
check('resolveBuild refuses empty', resolveBuild(manifest, '', '') === null);

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: release manifest schema, allow-list resolution, production signing gate.');
