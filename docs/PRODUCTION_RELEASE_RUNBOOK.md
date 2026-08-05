# Production release runbook

How a release goes from a git tag to paid customer downloads. Written for
the repo owner; every command is copy-pasteable. `{ROOT_DOMAIN}` is your
real domain throughout.

## 0. One-time prerequisites

- GitHub Actions secrets (Settings → Secrets → Actions):
  - Windows (Azure Trusted Signing / Microsoft Artifact Signing):
    `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
    `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`
  - macOS (Developer ID + notarisation):
    `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
    `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`
  - Publishing: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
    `R2_BUCKET` (= `estimation-tools-releases`)
- The desktop appId in `desktop/electron-builder.config.cjs` must be an
  identifier you are authorised to sign for — review it before your first
  production tag.

## 1. Cut a release

```bash
git checkout main && git pull
# bump desktop/package.json "version" (e.g. 1.2.0) in a normal PR first
git tag desktop-v1.2.0
git push origin desktop-v1.2.0
```

- Tags matching `desktop-v*` with `-rc.*` are prereleases: unsigned builds
  allowed, GitHub prerelease labelled "UNSIGNED TEST BUILD", never published
  to R2.
- Production tags (no `-rc`): the workflow **fails at preflight** if any
  signing secret is missing. No signed secrets → no release. There is no
  unsigned production path.

## 2. What CI does (`.github/workflows/desktop.yml`)

1. Four isolated jobs build and SIGN: Windows x64 + ARM64 (Azure Trusted
   Signing via electron-builder `azureSignOptions`), macOS x64 + ARM64
   (Developer ID, hardened runtime, notarised, stapled).
2. Each job verifies its own artifact before upload:
   - Windows: `signtool verify /pa /all <exe>`
   - macOS: `codesign --verify --deep --strict`, `spctl -a -vv -t install`,
     `xcrun stapler validate`
3. The manifest job runs `tools/release/build-manifest.mjs --production`,
   which recomputes size + SHA-256 from the actual files and validates all
   four builds are present and signed.
4. Artifacts + `manifest.json` attach to the GitHub release.

## 3. Publish to customers

```bash
# from the release artifacts directory (or CI does this on production tags)
node tools/release/publish-r2.mjs --dir ./artifacts --manifest ./artifacts/manifest.json
```

- Verifies every file's size + sha256 against the manifest BEFORE upload.
- Uploads installers first, `releases/latest/manifest.json` LAST — customers
  never see a manifest pointing at missing files.
- The bucket stays private; nothing here is publicly listable.

## 4. Post-publish verification (do not skip)

```bash
# 1) store shows the new version
curl -s https://www.{ROOT_DOMAIN}/api/store-config | jq .commerceEnabled
# 2) buy a real copy with a live card (refund it afterwards), then:
#    - download each of the 4 builds from the success page
#    - check SHA-256 matches the page:  shasum -a 256 <file>   (macOS)
#                                       Get-FileHash <file>    (Windows)
# 3) Windows SmartScreen check on a CLEAN machine/VM: run the .exe —
#    publisher must show your legal entity, not "Unknown publisher".
# 4) macOS Gatekeeper check: open the .dmg on a clean Mac — no override
#    prompt beyond the standard "downloaded from the internet" dialog.
# 5) refund the test purchase in Stripe; confirm the download page for that
#    purchase now refuses new links.
```

## 5. Rollback

Re-run `publish-r2.mjs` from the previous release's artifacts — the manifest
is the single pointer, and it's uploaded last, so a rollback is one publish.

## SmartScreen reality (honest expectations)

Azure Trusted Signing gives installers a consistent, verified publisher
identity. SmartScreen reputation is still accumulated per-file-hash by
Microsoft; a brand-new release may show a warning on some machines until
reputation builds. Do NOT claim "no SmartScreen warning ever" to customers;
DO verify the publisher name renders correctly (step 4.3) and report
false-positive warnings via the Microsoft security intelligence portal.
