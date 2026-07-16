# Integration status

Last updated: 16 July 2026.

## Repository

- The former Claude and Codex branches were a linear history and are combined on `main`.
- `main` is the maintained branch; completed agent integration branches are removed.
- The desktop installer and static web app use the same extraction and reporting code.

## Verified behavior

- PDF.js and Tesseract assets load locally. No CDN is required for document reading.
- The Electron app opens from `estimation://app`, not a remote Netlify page.
- Each operating-system user has an independent local IndexedDB workspace.
- Original files are stored separately from project metadata and survive reload and full
  application restart.
- Project backup and restore preserves the original document and analysed result.
- Online extraction is off by default in a browser and disabled in the desktop app.
- Processing progress is shown directly below the top application bar throughout upload,
  OCR, extraction, relationship mapping, and report compilation.
- The supplied 62-page `26CC07` PDF produces 40 boards and 632 countable devices.
- The same result survived page reload, app relaunch, backup, and restore during Electron QA.
- Report totals reconcile before CSV or Excel export is enabled.

## Remaining limits

- Local OCR is useful for clean scans but cannot guarantee correct reconstruction of every
  dense, rotated, or low-resolution schematic. These pages must remain visible for review;
  hosted extraction can be used in the browser when an organisation permits it.
- The PIN prevents casual access to an open app profile. It does not encrypt IndexedDB or
  exported backup files.
- Windows and macOS installers are unsigned until the repository owner supplies signing
  identities. Operating systems will warn users on first launch.
- Hosted extraction endpoints require server-side authentication before broad public use;
  the API key is server-side, but an unauthenticated endpoint can still incur usage.

## Release gate

Before publishing a desktop tag, run `npm test`, `npm run verify` in `desktop`, build the
Windows installer locally, and let the tagged GitHub workflow build both Windows and macOS
artifacts on native runners.
