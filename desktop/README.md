# Estimation 101 — desktop app (Windows first, plus macOS)

A native desktop wrapper (Electron) around the deployed web app. It opens a real
application window pointing at the live site (`estimationtoolz.netlify.app`), so:

- **The Anthropic API key is never in the desktop build** — AI extraction still runs on the
  serverless function over HTTPS, exactly as in the browser. Nothing to leak in the installer.
- **Updates are automatic** — a change to the deployed site reaches desktop users with no
  re-install (the shell just loads the current site).
- Users get a Start-menu / Applications entry, their own window, and native menus.

Override the target site with the `ESTIMATION101_URL` env var (e.g. a staging deploy).

## Build the installers — CI (recommended)

The repo has a GitHub Actions workflow (`.github/workflows/desktop.yml`) that builds
both installers on native runners — no local toolchain needed:

- **On demand:** GitHub → Actions → *Desktop installers* → *Run workflow*, then download
  `estimation101-Windows` / `estimation101-macOS` from the run's artifacts.
- **Release:** push a tag like `desktop-v1.0.0` — the `.exe`, `.dmg` and mac `.zip` are
  attached to a GitHub Release automatically, giving users a permanent download page.

## Build locally (alternative)

Requires Node 18+. Run from this `desktop/` folder:

```bash
cd desktop
npm install

# Windows installer (.exe / NSIS) — buildable on Windows, or on Linux/macOS via wine:
npm run dist:win        # → desktop/release/Estimation 101-<version>-win-x64.exe

# macOS installer (.dmg + .zip) — must be built ON macOS (Apple toolchain):
npm run dist:mac        # → desktop/release/Estimation 101-<version>-mac-*.dmg

# Run locally without packaging:
npm start
```

`electron-builder` downloads the Electron binaries on first `npm install`; the produced
installers are unsigned unless you configure signing (below).

## Windows distribution — getting into the "software centre"

Three routes, in increasing order of polish. The priority platform is Windows.

1. **Now (no accounts needed):** the CI `.exe` from a GitHub Release. Users download and
   install; SmartScreen shows a one-time "unrecognised app" warning ("More info" → "Run
   anyway") because the build is unsigned.
2. **Signed `.exe` (removes the warning):** buy an Authenticode code-signing certificate
   (OV/EV, or Azure Trusted Signing), add it as repo secrets (`CSC_LINK`,
   `CSC_KEY_PASSWORD`), and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the
   workflow. Same download flow, no scare page.
3. **Microsoft Store (searchable, one-click install — the true "software centre"):**
   needs a **Partner Center developer account** (one-off ~$19 individual / $99 company).
   Then electron-builder's `appx` target produces the Store package:
   `npx electron-builder --win appx` with `win.appx.identityName` / `publisher` /
   `publisherDisplayName` set to the values Partner Center assigns. Store packages are
   signed by Microsoft on ingestion — no certificate purchase required. Submit the
   `.appx` in Partner Center → certification → users find it by searching the Store.
   (For corporate SCCM/Intune "Software Center", IT deploys either the signed `.exe`
   or the Store package via Intune — both work.)

## Icons

Optional — the default Electron icon is used until you add branded ones. To brand the app,
add the files below **and** point `win.icon` / `mac.icon` at them in `desktop/package.json`:

- `desktop/build/icon.ico` — Windows, 256×256 multi-size `.ico`
- `desktop/build/icon.icns` — macOS, from a 1024×1024 master

---

## NEEDS HUMAN ACTION — code signing & store submission

Installers build without these, but "download from a software centre" and no OS security
warnings require identities only the account owner can provide:

1. **Windows — Microsoft Store:** a Partner Center account (route 3 above). Once you have
   the `identityName` / `publisher` values, I can add the `appx` target + a Store build to
   the CI workflow.
2. **Windows — signed `.exe`:** an Authenticode certificate (route 2 above), added as
   `CSC_LINK` / `CSC_KEY_PASSWORD` repo secrets.
3. **macOS — notarized `.dmg`:** Apple Developer Program ($99/yr), a "Developer ID
   Application" certificate, and notarization (`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
   `APPLE_TEAM_ID` secrets + `mac.identity` and an `afterSign` notarize hook). Unsigned
   `.dmg` needs right-click → Open on first launch.

Until signing is set up, the CI installers are usable for internal distribution (users click
through the OS warning), which is the fastest way to get the app in testers' hands.
