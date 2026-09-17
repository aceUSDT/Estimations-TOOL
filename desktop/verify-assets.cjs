const fs = require('node:fs');
const path = require('node:path');

const requiredAssets = [
  'index.html',
  'assets/app-redesign.css',
  'assets/hager-logo.png',
  'assets/fonts/ibm-plex/IBMPlexSans-Regular.woff2',
  'assets/fonts/ibm-plex/IBMPlexSans-Medium.woff2',
  'assets/fonts/ibm-plex/IBMPlexSans-SemiBold.woff2',
  'assets/fonts/ibm-plex/IBMPlexMono-Regular.woff2',
  'assets/fonts/ibm-plex/IBMPlexMono-Medium.woff2',
  'assets/fonts/ibm-plex/LICENSE.txt',
  'desktop/build/icon.png',
  'vendor/exceljs.min.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/lang-data/eng.traineddata.gz',
];

function localScriptPaths(html) {
  const scripts = new Set();
  const origin = 'https://desktop.invalid';
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const [, attributes] of withoutComments.matchAll(/<script\b([^>]*)>/gi)) {
    const source = attributes.match(/(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    if (!source) continue;
    const value = source[1] ?? source[2] ?? source[3];
    const url = new URL(value, `${origin}/index.html`);
    if (url.origin !== origin) throw new Error(`External desktop script dependency: ${value}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || relative.split('/').includes('..') || relative.includes('\\')) {
      throw new Error(`Invalid desktop script path: ${value}`);
    }
    scripts.add(relative);
  }
  return [...scripts];
}

function resourceIncludes(root, resource, relative) {
  // The current package uses explicit files and complete directories. Fail closed
  // if a future filtered/glob resource needs rules this verifier cannot evaluate.
  if (!resource || typeof resource !== 'object' || resource.filter
      || typeof resource.from !== 'string' || typeof resource.to !== 'string') return false;
  const source = path.resolve(root, 'desktop', resource.from);
  if (!fs.existsSync(source)) return false;
  const destination = path.posix.normalize(resource.to.replaceAll('\\', '/'));
  if (fs.statSync(source).isFile()) {
    return path.resolve(root, relative) === source && destination === `web/${relative}`;
  }
  const within = path.relative(source, path.resolve(root, relative));
  if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) return false;
  return path.posix.join(destination, within.split(path.sep).join('/')) === `web/${relative}`;
}

function verifyDesktopAssets({
  root = path.resolve(__dirname, '..'),
  extraResources = require('./electron-builder.config.cjs').extraResources,
  html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
} = {}) {
  const scripts = localScriptPaths(html);
  const required = [...new Set([...requiredAssets, ...scripts])];
  const missing = required.filter((relative) => {
    const file = path.join(root, relative);
    return !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0;
  });
  if (missing.length) throw new Error(`Missing desktop assets: ${missing.join(', ')}`);

  const unpackaged = required.filter((relative) => relative !== 'desktop/build/icon.png'
    && !extraResources.some((resource) => resourceIncludes(root, resource, relative)));
  if (unpackaged.length) {
    throw new Error(`Desktop assets not packaged at their web paths: ${unpackaged.join(', ')}`);
  }

  for (const externalEngine of ['cdnjs.cloudflare.com/ajax/libs/pdf.js', 'cdn.jsdelivr.net/npm/tesseract.js']) {
    if (html.includes(externalEngine)) throw new Error(`External runtime dependency remains in index.html: ${externalEngine}`);
  }
  for (const localEngine of ['./vendor/pdf.min.js', './vendor/tesseract/tesseract.min.js']) {
    if (!html.includes(localEngine)) throw new Error(`Local runtime dependency is not wired: ${localEngine}`);
  }

  const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  if (!main.includes("APP_SCHEME = 'estimation'") || !main.includes('APP_ORIGIN')) {
    throw new Error('Desktop entry point does not use the local application origin');
  }
  if (/loadURL\([^)]*netlify/i.test(main)) throw new Error('Desktop entry point still loads the remote Netlify application');
  return { requiredCount: required.length, scriptCount: scripts.length };
}

if (require.main === module) {
  const { requiredCount, scriptCount } = verifyDesktopAssets();
  console.log(`Desktop asset verification passed (${requiredCount} required files; ${scriptCount} HTML scripts packaged).`);
}

module.exports = { verifyDesktopAssets, localScriptPaths };
