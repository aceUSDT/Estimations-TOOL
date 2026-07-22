/* electron-builder configuration (moved from package.json "build" so signing
 * can be switched on by ENVIRONMENT PRESENCE, never by committed values).
 *
 * Unsigned dev/RC builds: no signing env → no signing attempted.
 * Production builds (CI, desktop-v* tags without -rc.): the workflow injects
 *   - Azure Trusted Signing env (AZURE_*) for Windows
 *   - Developer ID cert (CSC_LINK/CSC_KEY_PASSWORD) + App Store Connect API
 *     key (APPLE_API_*) for macOS signing and notarisation
 *   - ESTIMATION_FORCE_CODESIGN=true so packaging FAILS rather than produce
 *     an unsigned production binary.
 * Secrets live only in the GitHub `production` environment. Nothing here.
 *
 * NOTE (owner decision pending): appId `com.hager.estimationtools` and the
 * Hager branding must not ship in a signed, independently sold product until
 * the owner supplies written authorisation or a legally owned identity
 * (docs/OWNER_LAUNCH_CHECKLIST.md).
 *
 * Filenames are stable, space-free, and customer-facing:
 *   Estimation-Tools-<version>-windows-x64.exe
 *   Estimation-Tools-<version>-macos-arm64.dmg
 */
const haveAzureSigning = Boolean(
  process.env.AZURE_TENANT_ID
  && process.env.AZURE_CODE_SIGNING_ACCOUNT
  && process.env.AZURE_CERTIFICATE_PROFILE
  && process.env.AZURE_SIGNING_ENDPOINT,
);
const haveMacNotarize = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER);
const forceCodeSigning = process.env.ESTIMATION_FORCE_CODESIGN === 'true';

module.exports = {
  appId: 'com.hager.estimationtools',
  productName: 'Estimation Tools',
  files: ['main.cjs'],
  extraResources: [
    { from: '../index.html', to: 'web/index.html' },
    { from: '../extractor-core.js', to: 'web/extractor-core.js' },
    { from: '../report-core.js', to: 'web/report-core.js' },
    { from: '../assets', to: 'web/assets' },
    { from: '../vendor', to: 'web/vendor' },
  ],
  directories: { output: 'release' },
  forceCodeSigning,
  win: {
    icon: 'build/icon.png',
    target: ['nsis'],
    artifactName: 'Estimation-Tools-${version}-windows-${arch}.${ext}',
    ...(haveAzureSigning ? {
      azureSignOptions: {
        publisherName: process.env.AZURE_PUBLISHER_NAME,
        endpoint: process.env.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: process.env.AZURE_CODE_SIGNING_ACCOUNT,
        certificateProfileName: process.env.AZURE_CERTIFICATE_PROFILE,
      },
    } : {}),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
  mac: {
    icon: 'build/icon.png',
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity',
    artifactName: 'Estimation-Tools-${version}-macos-${arch}.${ext}',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: haveMacNotarize,
  },
  dmg: { title: 'Estimation Tools' },
  asar: true,
};
