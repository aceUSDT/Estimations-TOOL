# Estimation Tools desktop

The Electron package contains the complete application and its PDF/OCR runtimes. It serves
those files from the stable `estimation://app` origin, so it does not load the Netlify site
and does not need a network connection to read supported documents.

Projects and original files are stored in IndexedDB inside the current operating-system
user's application profile. Different Windows or macOS accounts therefore receive separate
workspaces. Users can also create and restore `.estimation-project` backups.

The local PIN is a screen lock, not disk encryption. Backups contain unencrypted source
files. Desktop online extraction is disabled, so no project page is sent to the hosted
extraction service.

## Local development

Node 20 is recommended.

```bash
cd desktop
npm ci
npm run verify
npm start
```

`npm run verify` fails when a required packaged asset is missing or the desktop entry point
regresses to a remote site.

## Build installers

On Windows:

```bash
npm run dist:win
```

On macOS:

```bash
npm run dist:mac
```

Outputs are written to `desktop/release/`. A `desktop-v*` tag runs
`.github/workflows/desktop.yml` on native Windows and macOS runners and attaches the `.exe`,
`.dmg`, and `.zip` files to a GitHub Release.

## Signing and distribution

The current build is unsigned. It is usable for internal testing, but Windows SmartScreen
and macOS Gatekeeper will warn on first launch.

For production distribution:

1. Add an Authenticode certificate or Azure Trusted Signing configuration for Windows.
2. Add an Apple Developer ID certificate and notarisation credentials for macOS.
3. For Microsoft Store or managed company deployment, add the assigned Partner Center or
   Intune identity after the owner provides it.

Signing credentials belong in GitHub Actions secrets. Never commit certificates,
passwords, or notarisation credentials.
