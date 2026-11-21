# Release signing & distribution (macOS + Windows)

This page is the difference between a plugin that **loads on your machine** and a plugin
that **installs on a customer's machine**. Everything apc-mcp does by default — the
`apc-ship` pipeline, the CMake `package` target, the `INSTALL.txt` in `dist/` —
produces a **local** artifact. This page describes how to produce a **distribution**
artifact instead.

If you take one thing away:

> `codesign --force --deep --sign - MyPlugin.vst3` is **local-only**. An ad-hoc signature
> confers no Gatekeeper trust, has no hardened runtime, carries no timestamp and no
> notarization ticket. It is never valid for distribution — not for direct download, not
> for a store, not for a friend's machine.

## The two signatures

| | Local testing (ad-hoc) | Distribution (release) |
|---|---|---|
| macOS | `codesign --force --deep --sign - MyPlugin.vst3` | Developer ID Application certificate, `--options runtime`, `--timestamp`, `xcrun notarytool submit --wait`, `xcrun stapler staple` |
| Windows | unsigned is fine for dev | Trusted code-signing certificate (EV preferred), `signtool sign /fd sha256 /tr <timestamp> /td sha256` |
| Valid for | this machine, right now | any customer machine, after the certificate expires |
| Gatekeeper / SmartScreen | typically blocks or warns on other machines | accepted (macOS) / SmartScreen reputation accrues or is immediate (Windows EV) |

Ad-hoc signing exists so you can iterate quickly on your own DAW without an Apple
Developer account. Ship it to anyone else and it fails exactly like an unsigned build.

## What apc-mcp does today

- `apc-ship` (and the slash command `/apc:ship`) run `codesign --force --deep -s -`
  on macOS `dist/` bundles as the last step. **That signature is local-only.** The pipeline
  is a build/validate/staging gate, not a release process.
- The `package` target in the scaffolded JUCE templates does the same ad-hoc signature for
  the same reason. `dist/INSTALL.txt` says the bundles are ad-hoc signed for local testing.
- Nothing in apc-mcp signs for distribution automatically, and nothing should: release
  signing needs credentials that belong in your CI secrets store, not in a scaffold.

Use this page — or the runnable helpers in [this repository](#the-scripts-in-this-repository) —
for the distribution path.

## macOS: the full release sequence

Prerequisites:

- An [Apple Developer Program](https://developer.apple.com/programs/) membership.
- A **Developer ID Application** certificate (Xcode → Settings → Accounts → Manage
  Certificates, or developer.apple.com → Certificates). This is the only Mac identity
  accepted for direct distribution outside the Mac App Store; "Apple Development" and
  "Mac Developer" certificates are not.
- Xcode Command Line Tools (`xcode-select --install`).
- Notarization credentials, either:
  - a **keychain profile** created once with
    `xcrun notarytool store-credentials apc-notary --apple-id <you@example.com> --team-id <TEAMID> --password <app-specific-password>`, or
  - an **App Store Connect API key** (three values: `.p8` file, key ID, issuer UUID).

Build for distribution, then sign, notarize and staple **every bundle** the build emitted
(`.vst3`, and `.component` when AU is in `FORMATS`). A universal binary is
`-DAPC_MACOS_UNIVERSAL=ON` (or `CMAKE_OSX_ARCHITECTURES=arm64;x86_64`).

```sh
# 1. Hardened runtime (--options runtime) + secure timestamp (--timestamp) are both
#    mandatory. Without --timestamp the signature silently expires with the certificate.
codesign --force --deep --options runtime --timestamp \
  --sign "Developer ID Application: Acme Audio LLC (TEAMID1234)" \
  MyPlugin.vst3
codesign --force --deep --options runtime --timestamp \
  --sign "Developer ID Application: Acme Audio LLC (TEAMID1234)" \
  MyPlugin.component   # when built

# 2. Verify what was signed.
codesign --verify --deep --strict --verbose=2 MyPlugin.vst3

# 3. Notarytool accepts .zip/.dmg/.pkg — not a bare bundle — so send a ditto archive.
ditto -c -k --keepParent MyPlugin.vst3 MyPlugin.zip

# 4. Notarize. --wait blocks until Apple returns a verdict. The exit code alone is
#    not sufficient; require literally "status: Accepted" in the output.
xcrun notarytool submit MyPlugin.zip \
  --keychain-profile "apc-notary" \
  --wait
# …or, instead of --keychain-profile:
# xcrun notarytool submit MyPlugin.zip \
#   --api-key AuthKey_XXXXXXXX.p8 --api-key-id XXXXXXXX --api-issuer <issuer-uuid> --wait

# 5. Staple the ticket onto the artifact you ship. Stapler only attaches to
#    containers Apple recognises (.app, .pkg, .dmg, and some .plugin types); a bare
#    .vst3/.component usually cannot be stapled — see the note below.
xcrun stapler staple MyPlugin.vst3
xcrun stapler validate MyPlugin.vst3

# 6. Sanity check what Gatekeeper will say (advisory — plugin bundles are assessed
#    online against the notarization log).
spctl --assess --type execute -vv MyPlugin.vst3
```

### Stapling plugin bundles honestly

`xcrun stapler staple` attaches the notarization ticket to the artifact itself, which is
what lets Gatekeeper clear it **without network access**. Apple's stapleable containers are
`.app`, `.pkg` and `.dmg`. A bare `.vst3` / `.component` frequently cannot be stapled
(`The staple and validate action failed`). The correct fixes are:

1. **Ship a `.pkg` (or `.dmg`) that contains the signed bundles, and staple that.** Build
   the installer with `productbuild` / `pkgbuild`, sign it with the same Developer ID
   Application certificate, notarize it, and `xcrun stapler staple MyPlugin.pkg`. The
   plugin bundles keep their Developer ID signature; the package carries the ticket.
2. **Or accept online verification.** A notarized bare bundle clears Gatekeeper on any
   machine that can reach Apple's notarization service — which notarized direct
   distribution relies on anyway. Do not describe an online-checked bundle as "stapled".

Either way, `notarytool submit --wait` must reach `status: Accepted` first. Stapling a
rejected bundle is not a thing.

### Notes and gotchas

- **Hardened runtime is required.** `--options runtime` opts the bundle into the hardened
  runtime; without it, notarization is rejected.
- **Timestamp is required.** Without `--timestamp`, the signature dies with the
  certificate (roughly one year for Developer ID). Timestamps make the signature valid
  indefinitely, as does the notarization ticket.
- **Entitlements.** Plain audio plugins rarely need any. If your plugin loads unsigned
  auxiliary dylibs, you may need a `.entitlements` file with
  `com.apple.security.cs.disable-library-validation` passed via `--entitlements` — but
  reach for it only when the load actually fails; each entitlement is a hole in the
  hardened runtime.
- **AU plugins** (`.component`) are signed, notarized and (usually) shipped the same way.
- **Notarization can fail with `status: Invalid`** — run `xcrun notarytool log <submission-id>`
  and fix what it reports (almost always: a missing hardened runtime, an unsigned nested
  binary, or a stale signature). The build artefact is not a release until this is `Accepted`.
- **Ad-hoc is not a fallback at any point of this sequence.** Every command above requires
  the Developer ID Application identity.

## Windows: timestamped Authenticode

Prerequisites:

- A code-signing certificate from a trusted CA. **EV (extended validation) is preferred**:
  it lives on a hardware token or in a cloud signer, and it gives immediate Microsoft
  SmartScreen publisher reputation. OV certificates work but accrue SmartScreen reputation
  slowly (measured in downloads); an OV build that "has a signature" can still show
  "Windows protected your PC".
- `signtool.exe` from the Windows SDK. It ships at
  `C:\Program Files (x86)\Windows Kits\10\bin\<sdk-version>\x64\signtool.exe`; add the newest
  `x64` directory to PATH.
- SHA-256 throughout. SHA-1 Authenticode signatures are rejected by current Windows builds.

Build `Release`, then sign **every PE binary** in the `dist/` output. A Windows VST3 is a
bundle whose `<Name>.vst3` inner file is a PE renamed with the extension — signing the
*directory* does nothing; the inner PE carries the signature:

```text
Foo.vst3\Contents\x86_64-win\Foo.vst3   ← PE file, this is what signtool signs
```

```cmd
rem EV certificate on a token (preferred) or the best cert in the store: /a auto-selects
rem the best match (an EV cert wins). Explicit selection: /sha1 <thumbprint> or /n <subject>.
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a Info.vst3

rem OV .pfx on a CI runner without a token (password on the command line — prefer the store):
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /f acme.pfx /p "%PFX_PASSWORD%" Info.vst3

rem Verify: /pa is the default Authenticode verification policy.
signtool verify /pa /v Info.vst3
```

- `/fd sha256` — file digest algorithm SHA-256 (required).
- `/tr <url>` — **RFC 3161** timestamp server. Any RFC 3161 authority works
  (`http://timestamp.digicert.com`, `http://timestamp.sectigo.com`, …). Do not use the
  legacy `/t` SHA-1 timestamp switches.
- `/td sha256` — digest algorithm for the timestamp itself. `/tr` without `/td` defaults
  to SHA-1 timestamping on older SDKs; always set it explicitly.
- The timestamp is what keeps the signature valid **after the certificate expires**.
  A signature without a timestamp is treated as invalid the moment the cert lapses.
- `signtool verify /pa /v` must exit 0. Treat it as part of the release gate, not a
  diagnostic.
- **Never** ship an unsigned or self-signed "release". Unsigned builds fire SmartScreen;
  self-signed builds are skipped by Windows entirely. There is no local fallback equivalent
  to ad-hoc signing worth documenting.

## The scripts in this repository

Two runnable helpers encode exactly the sequences above, with admission control so the
wrong thing cannot happen silently. They live in the [apc-mcp](../README.md) repository
(not in the published npm package); run them from a checkout of the plugin generator, or
copy them into your plugin repo:

```sh
# macOS — every bundle under dist/ (or explicit bundle paths)
node scripts/sign-release-macos.mjs --dist dist/
node scripts/sign-release-macos.mjs MyPlugin.vst3 MyPlugin.component

# Windows — every PE binary under dist/ (inner .vst3 PEs found by MZ magic)
node scripts/sign-release-windows.mjs --dist dist/
node scripts/sign-release-windows.mjs Foo.vst3/Contents/x86_64-win/Foo.vst3
```

Both scripts **fail closed**:

| Control | `sign-release-macos.mjs` | `sign-release-windows.mjs` |
|---|---|---|
| Ad-hoc / missing identity refused | `-` and non-Developer-ID identities rejected before any command runs | no unsigned or self-signed path exists |
| Credentials validated up front | notarization credentials checked *before* signing, so nothing is signed and then stuck | `.pfx` existence / thumbprint format checked before signtool runs |
| Hardened runtime + timestamp | always `--options runtime --timestamp` | always `/fd sha256 /tr … /td sha256` |
| Notarization verdict gated | requires literally `status: Accepted` from `notarytool submit --wait`; anything else fails | n/a |
| Stapling | `xcrun stapler staple` + `stapler validate`; failure fails the release (`--allow-unstapled` is the explicit exception, not a default) | n/a |
| Authenticode verify | advisory `spctl` (printed, never gated) | `signtool verify /pa /v` gated per file |
| Exit codes | 0 ok · 1 step failed · 2 usage | 0 ok · 1 step failed · 2 usage |

Configuration via flags or environment: `--identity` / `APC_DEVELOPER_IDENTITY`,
`--keychain-profile` / `APC_NOTARY_PROFILE`, or `--api-key` + `--api-key-id` +
`--api-issuer` / `APC_NOTARY_API_KEY_P8` + `APC_NOTARY_API_KEY_ID` + `APC_NOTARY_API_ISSUER`,
`--timestamp-url` / `APC_TIMESTAMP_URL`, `--cert-sha1` / `APC_SIGN_CERT_SHA1`,
`--cert-name` / `APC_SIGN_CERT_NAME`, `--pfx` (+ `--pfx-password` /
`APC_SIGN_PFX_PASSWORD`). The test suite for both lives in
[`tests/release-sign.test.js`](../tests/release-sign.test.js) and runs them against PATH
shims, so the gate logic is exercised without real certificates.

## CI: wiring it into a release pipeline

A self-contained example workflow for a **scaffolded plugin repository** — build Release on
macOS and Windows, sign, notarize, staple, and attach the `dist/` packages to the GitHub
release — lives at [`docs/examples/plugin-release.yml`](examples/plugin-release.yml). Copy it
to `.github/workflows/release.yml` in the plugin repository and configure these secrets:

| Secret | Platform | Used for |
|---|---|---|
| `MACOS_CERT_P12_BASE64` | macOS | base64 of the Developer ID Application `.p12` |
| `MACOS_CERT_P12_PASSWORD` | macOS | password of that `.p12` |
| `APC_DEVELOPER_IDENTITY` | macOS | `Developer ID Application: <Name> (<TEAMID>)` |
| `APPLE_API_KEY_P8_BASE64` | macOS | base64 of the App Store Connect API key `.p8` |
| `APPLE_API_KEY_ID` | macOS | key ID |
| `APPLE_API_ISSUER` | macOS | issuer UUID |
| `WINDOWS_CERT_SHA1` *(or)* `WINDOWS_CERT_PFX_BASE64` + `WINDOWS_CERT_PFX_PASSWORD` | Windows | thumbprint in store, or PFX + password (OV) |

EV note: an EV certificate cannot be exported to base64 — on GitHub-hosted runners it is
normally used through a cloud signing service (e.g. Azure Trusted Signing, SSL.com eSigner)
or a self-hosted runner with the token attached. The example shows the `signtool` shape;
swap the signing step for your service's action/command and keep `/tr … /td sha256 /fd sha256`.

## Checklist before you call it a release

- [ ] `dist/` was built `Release` (macOS: universal, `arm64;x86_64`, if you target both).
- [ ] macOS: Developer ID Application signature with `--options runtime --timestamp`, verified with `codesign --verify --deep --strict`.
- [ ] macOS: `notarytool submit --wait` printed `status: Accepted`; the submission ID is in the release notes.
- [ ] macOS: `stapler validate` passes on a stapleable container, or you deliberately ship a stapled `.pkg`/`.dmg`, or you knowingly rely on online Gatekeeper checks.
- [ ] Windows: every inner PE (`.vst3`/`.clap` binary) signed `/fd sha256 /tr <RFC3161> /td sha256`; `signtool verify /pa` exits 0.
- [ ] No ad-hoc (`-`) signatures anywhere; no unsigned binaries in the package.
- [ ] The `INSTALL.txt` from `dist/` no longer describes the artifact as local-only (or you removed it from the installer payload).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `notarytool` → `status: Invalid` | `xcrun notarytool log <submission-id>`; nearly always a missing hardened runtime or an unsigned/nested binary |
| `stapler` → `The staple and validate action failed` | the container isn't stapleable — ship a stapled `.pkg`/`.dmg`, or accept online verification (see above) |
| `spctl` → `rejected, source=Unnotarized Developer ID` | notarization hasn't passed, or you tested before `status: Accepted`; re-check the submission |
| signtool → `No certificates were found that met all given criteria` | token not connected, wrong store (use `LocalMachine\My` on CI), or thumbprint mismatch |
| signtool → `This file is not a valid PE file` | you pointed signtool at the `.vst3` *directory*; sign the inner PE or use `--dist` |
| SmartScreen still warns with an OV cert | expected early in the certificate's life; use EV or a cloud signer for immediate reputation |
| Timestamp server errors | retry, or switch `APC_TIMESTAMP_URL` to another RFC 3161 authority; never drop the timestamp to make it pass |
