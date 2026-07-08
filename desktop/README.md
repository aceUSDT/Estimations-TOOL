# Estimation 101 — desktop app (Windows + macOS)

A native desktop wrapper (Electron) around the deployed web app. It opens a real
application window pointing at the live site (`estimationtoolz.netlify.app`), so:

- **The Anthropic API key is never in the desktop build** — AI extraction still runs on the
  serverless function over HTTPS, exactly as in the browser. Nothing to leak in the installer.
- **Updates are automatic** — a change to the deployed site reaches desktop users with no
  re-install (the shell just loads the current site).
- Users get a Start-menu / Applications entry, their own window, and native menus.

Override the target site with the `ESTIMATION101_URL` env var (e.g. a staging deploy).

## Build the installers

Requires Node 18+. Run from this `desktop/` folder:

```bash
cd desktop
npm install

# Windows installer (.exe / NSIS) — buildable on Windows, or on Linux/macOS via wine:
npm run dist:win        # → desktop/release/Estimation 101 Setup <version>.exe

# macOS installer (.dmg) — must be built ON macOS (Apple toolchain):
npm run dist:mac        # → desktop/release/Estimation 101-<version>.dmg

# Run locally without packaging:
npm start
```

`electron-builder` downloads the Electron binaries on first `npm install`; the produced
installers are unsigned unless you configure signing (below).

## Icons

Add before building (placeholders referenced by `package.json`):

- `desktop/build/icon.ico` — Windows, 256×256 multi-size `.ico`
- `desktop/build/icon.icns` — macOS, from a 1024×1024 master

Without them electron-builder falls back to the default Electron icon.

---

## NEEDS HUMAN ACTION — code signing & store submission

Installers build without these, but "download from a software centre" and no OS security
warnings require signing identities only the account owner can provide:

1. **Windows — Microsoft Store / signed `.exe`:** an Authenticode code-signing certificate
   (OV or EV). For the Microsoft Store you also need a Partner Center account. Configure via
   electron-builder `win.certificateFile` / `certificatePassword` (or Azure Trusted Signing).
   Unsigned `.exe` installs but shows a SmartScreen warning.
2. **macOS — Mac App Store / notarized `.dmg`:** an Apple Developer Program membership
   ($99/yr), a "Developer ID Application" certificate, and notarization (`notarytool`).
   Configure via electron-builder `mac.identity` + `afterSign` notarize hook. Unsigned
   `.dmg` will be blocked by Gatekeeper.
3. **CI to produce both from one place:** a GitHub Actions matrix (windows-latest +
   macos-latest) running `npm run dist:win` / `dist:mac` and uploading the artifacts, with the
   signing secrets stored as repo secrets. Say the word and I'll add the workflow — it needs
   the certificates/credentials from steps 1–2 to actually sign.

Until signing is set up, the installers are usable for internal distribution (users click
through the OS warning), which is the fastest way to get the app in testers' hands.
