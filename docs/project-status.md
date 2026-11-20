# Project status

Current-state summary for maintainers. Frozen historical records live in [archive/](archive/README.md); this page is the one to keep updated.

## Current state

- `package.json` is **2.0.0**, not yet tagged or published. The newest git tag is `v1.5.0` and `@sgm-audio/apc-mcp` is not on npm; install from `github:sgm-audio/apc-mcp` until `v2.0.0` ships. See [Getting started](getting-started.md#install-from-github-until-200-is-tagged).
- Seven tools and six scaffold types (`clap`, `juce`, `vst3`, `lv2`, `standalone`, `ara`) across seven template directories; the JUCE type includes standard, JIVE and WebView variants, while `vst3` is an alias for standard JUCE. The server uses stdio-only transport and two *direct* runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) — the lockfile resolves 199 packages, because the SDK brings an HTTP stack this stdio server never loads. That is where both 2.0.0 advisories lived, so "two dependencies" is not a security argument.
- The 2.0.0 work (security hardening, template rewrites, output correctness, CI/release engineering, QA tooling) is **done**. The JUCE ARA effect template is implemented; remaining release work is tagging 2.0.0 (see [Development](development.md#release-process)).

## Verification baseline

Reproduce with:

```sh
npm ci
npm run check
```

Verified on **2026-11-20** in this checkout (Node v22.22.3 / npm 10.9.8, Linux):

| Gate | Result |
|---|---|
| `npm run lint` | PASS — ESLint (incl. `eslint-plugin-n`) + `node --check index.js` |
| `npm run typecheck` | PASS — `tsc -p tsconfig.json`, 0 errors |
| `npm test` | **320 tests**, 312 pass, 0 fail, **8 skipped** — the CLAP/LV2 compile+link checks skip when `APC_CLAP_INCLUDE` / `APC_LV2_INCLUDE` are unset. The ARA stub compile/link tests pass. |
| `npm run smoke` | PASS — 13/13 scaffold cases (structural only; full JUCE `--configure` / `--build` requires system dependencies and SDKs) |
| `npm audit` | PASS — 0 vulnerabilities, with **no** `--audit-level` flag: the gate is plain `npm audit`, and CI runs that same command (`npm run audit`) rather than a laxer threshold |
| `npm run licenses` | PASS — 199 lockfile packages checked against `license_decisions.yml` |
| `npm run docs:check` | PASS — 47 Markdown files, 144 relative paths, 55 anchors, 10 indexed docs |
| `npm run check` | PASS (exit 0), including lint, typecheck, tests, smoke, audit, licenses and docs checks |
| `npm run cmake:lint` | PASS — cmakelang 0.6.13, 7 template `CMakeLists.txt` files, 0 findings |
| `git tag` / npm registry | Latest tag `v1.5.0`; `@sgm-audio/apc-mcp` returns 404 (not published) |

The ARA feature branch's first CI run after the CMake-lint fix (run `44827682130`, PR #50) passed the required checks, including cross-platform Node tests, scaffold compile/build and validation jobs, and CMake lint; `publish` was skipped as expected for a pull request. That run predates the merge-base refresh, so consult PR #50's checks for the latest result. Treat the table above as a dated snapshot, not a promise: re-run the commands rather than copying the numbers into other docs.

## What 2.0.0 changed

- **Security:** path traversal in `apc-lint` closed with symlink-aware `assertWithinProject()`; `apc-mcp.json` validated per key; per-grammar escaping of `vendor` *and* `description` for C++/CMake/Turtle/HTML, with non-ASCII metadata accepted instead of being rejected by an ASCII-only regex; dependency advisories resolved. See [Security](security.md).
- **Templates:** CLAP, JUCE/VST3, standalone, native LV2, and JUCE ARA effect scaffolds. The ARA template uses `IS_ARA_EFFECT TRUE`, real `VST3 AU` formats, JUCE ARA processor/editor extensions, a source-region playback renderer, and `createARAFactory()`; it requires the external SDK at configure time.
- **Output correctness:** `config` from `apc-mcp.json` is honoured; lint/build/test/validate parsers no longer invent counts or report success on failed commands; missing validators and skips are reported; builds pass `--config` and reconfigure single-config caches when `Debug`/`Release` changes.
- **Substantiation round (2026-11-17):** an evidence-officer audit ([SUBSTANTIATION-LOG.md](../SUBSTANTIATION-LOG.md)) re-graded every 2.0.0 claim against live reproduction and closed its three blockers and five should-fixes: symlink containment on artefact discovery and the config read, a prototype-key-safe schema lookup, honest lint-failure reporting, space-tolerant compiler diagnostics, ctest skip counting, single-`../` rejection in `-D` values, validator-command regression tests, and the doc-drift batch (including the missing PR #36 changelog entry). Every fix landed with a test proven red on the pre-fix tree.
- **Release engineering:** version has one source of truth (`package.json`), `npm run ship` guards branch/tree/tag/changelog, CI action pins are immutable with explicit permissions, publish is gated on all verification jobs.

## Known limitations

- **ARA requires the external SDK.** `type="ara"` is implemented, but the ARA SDK is not bundled. Clone the SDK with submodules initialized and set `APC_ARA_SDK_PATH` to its root containing `ARA_Library/PlugIn/ARAPlug.h` and `ARA_API/ARAInterface.h`; generated CMake fails early for unset, empty, or incomplete paths. ARA generated sources passed strict syntax-only checks against upstream JUCE 9.0.3 and real ARA SDK headers, but a full CMake build was not completed: JUCE's `juceaide` could not compile here because the Linux FreeType development header `ft2build.h` is missing. No DAW-host load test was performed.
- **Validation coverage:** only VST3 (`pluginval`) and CLAP (`clap-validator`) have validators. Both are exercised in CI against built artefacts (`scaffold-clap-validate`, `scaffold-juce-validate`). LV2, AudioUnit and Standalone artefacts are discovered and reported **`NOT CHECKABLE`** — no validator exists, so they neither pass nor fail the run.
- **No host-load test:** CI builds artefacts and runs validators; it does not load a plugin in a real DAW on macOS or Windows.
- **Windows is unverified.** The server branches on `process.platform` (CMake generator default, `PATHEXT` resolution, bundle-vs-binary artefact discovery) and only the Linux and macOS branches have ever executed. The test suite drives POSIX shebang shims, so a Windows CI job would report on the fixtures rather than the server; it is deliberately absent instead of being green by accident. Treat the Windows paths in [toolchain](toolchain.md#good-to-know-quirks) as untested.
- **macOS CLAP `CFBundle` packaging** is compiled nowhere in CI and needs dedicated platform verification.
- **Local SDK-dependent checks skip by default.** Set `APC_CLAP_INCLUDE`, `APC_LV2_INCLUDE`, `APC_JUCE_DIR`, `APC_CLAP_DIR`, `APC_LV2_DIR`, and, for ARA configure/build validation, `APC_ARA_SDK_PATH` (see [Configuration](configuration.md) and [Toolchain](toolchain.md)) to exercise them; otherwise rely on CI.
- **2.0.0 is unreleased**, so `npm install @sgm-audio/apc-mcp` is not yet an option and 1.4.0/1.5.0 remain the only published git tags.

## Maintainer traps

Lessons that cost time; check them before "fixing" something that looks odd:

1. **Verify APIs against real upstream source.** Two of the worst historical defects were plausible-sounding APIs that do not exist (`juce_add_webview_ui()`, `WebBrowserComponent::loadHTMLString`). `juce_add_plugin` has **no unparsed-argument check** — an unknown keyword is silently dropped.
2. **Write the failing test first** and prove it fails against the pre-change code in a throwaway worktree. The original suite was green while scaffolds could neither configure nor compile.
3. **`_tools/` discovery is root-first.** Templates check `${CMAKE_SOURCE_DIR}/_tools/…` before the legacy two-up fallback, so a custom `pluginsDir` no longer breaks SDK discovery. (It did before PR #36 — that is *why* the root-first hop exists.)
4. **JUCE LV2 builds need a display** on headless Linux (`xvfb-run -a`) and a stack of system dev headers.
5. **Two LV2 implementations exist** (native C11 template vs JUCE's C++ LV2 wrapper). Do not conflate them.
6. **Single- vs multi-config CMake trees** behave differently on `Debug` ↔ `Release` switches; `buildNeedsConfigure()` exists for a reason.
7. **Never reintroduce a shell string**, and never let a failed operation report `isError: false`.
8. **The version lives only in `package.json`**; `scripts/ship.mjs` reads `CHANGELOG.md` at the repo root, so do not move that file without changing the guard.

## Historical records

- [archive/AUDIT.md](archive/AUDIT.md) — the original full build/QA/security audit of v1.5.0 plus the follow-up audit (finding IDs such as SEC-01, FUNC-04, QA-02).
- [archive/HANDOFF.md](archive/HANDOFF.md) — the original completion guide, phase log and traps.
- [CHANGELOG.md](../CHANGELOG.md) — dated release history.

These are snapshots of the tree at the time they were written. They are evidence, not current instructions.
