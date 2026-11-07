# Project status

Current-state summary for maintainers. Frozen historical records live in [archive/](archive/README.md); this page is the one to keep updated.

## Current state

- `package.json` is **2.0.0**, not yet tagged or published. The newest git tag is `v1.5.0` and `@sgm-audio/apc-mcp` is not on npm; install from `github:sgm-audio/apc-mcp` until `v2.0.0` ships. See [Getting started](getting-started.md#install-from-github-until-200-is-tagged).
- Seven tools, five scaffold templates (`clap`, `juce`, `juce-webview`, `lv2`, `standalone`), stdio-only transport, one-file server with two runtime dependencies.
- The 2.0.0 work (security hardening, template rewrites, output correctness, CI/release engineering, QA tooling) is **done**. Remaining product work is the [ARA template](roadmap.md); remaining release work is tagging 2.0.0 (see [Development](development.md#release-process)).

## Verification baseline

Reproduce with:

```sh
npm ci
npm run check
```

Verified on **2026-11-07** in this checkout (Node v22.22.3 / npm 10.9.8, Linux):

| Gate | Result |
|---|---|
| `npm run lint` | PASS — ESLint + `node --check index.js` |
| `npm test` | **215 tests**, 207 pass, 0 fail, **8 skipped** — the C/C++ compile+link checks skip when `APC_CLAP_INCLUDE` / `APC_LV2_INCLUDE` are unset; CI sets them and runs them against real upstream headers |
| `npm run smoke` | PASS — 10/10 scaffold cases (structure only; `--configure` / `--build` need CMake + SDKs) |
| `npm audit` | PASS — 0 vulnerabilities |
| `npm run licenses` | PASS — 163 lockfile packages checked against `license_decisions.yml` |
| `npm run check` | PASS (exit 0) |
| `git tag` / npm registry | Latest tag `v1.5.0`; `@sgm-audio/apc-mcp` returns 404 (not published) |

CI additionally configures, compiles and links generated CLAP, LV2 and JUCE targets against real SDKs on GitHub-hosted runners. Treat the table above as a dated snapshot, not a promise: re-run the commands rather than copying the numbers into other docs.

## What 2.0.0 changed

- **Security:** path traversal in `audio_plugin_lint` closed with symlink-aware `assertWithinProject()`; `apc-mcp.json` validated per key; per-grammar escaping of `description` for C++/CMake/Turtle; dependency advisories resolved. See [Security](security.md).
- **Templates:** all five scaffolds rewritten against verified JUCE 9 / CLAP / LV2 APIs. `type="ara"` removed (it produced an unconfigurable plugin); `standalone` and native `lv2` added.
- **Output correctness:** `config` from `apc-mcp.json` is honoured; lint/build/test/validate parsers no longer invent counts or report success on failed commands; missing validators and skips are reported; builds pass `--config` and reconfigure single-config caches when `Debug`/`Release` changes.
- **Release engineering:** version has one source of truth (`package.json`), `npm run ship` guards branch/tree/tag/changelog, CI action pins are immutable with explicit permissions, publish is gated on all verification jobs.

## Known limitations

- **ARA** is not implemented and is absent from the `type` enum; it needs a dedicated `IS_ARA_EFFECT` template plus an external ARA SDK and JUCE API fixture work. See [Roadmap](roadmap.md).
- **Validation coverage:** only VST3 (`pluginval`) and CLAP (`clap-validator`) are validated. LV2, AudioUnit and Standalone artefacts are discovered but reported skipped. macOS CLAP `CFBundle` packaging also needs dedicated platform verification.
- **No host-load test:** CI builds artefacts and runs validators; it does not load a plugin in a real DAW on macOS or Windows.
- **Local SDK-dependent checks skip by default.** Set `APC_CLAP_INCLUDE`, `APC_LV2_INCLUDE`, `APC_JUCE_DIR`, `APC_CLAP_DIR`, `APC_LV2_DIR` (see [Configuration](configuration.md)) to exercise them; otherwise rely on CI.
- **2.0.0 is unreleased**, so `npm install @sgm-audio/apc-mcp` is not yet an option and 1.4.0/1.5.0 remain the only published git tags.

## Maintainer traps

Lessons that cost time; check them before "fixing" something that looks odd:

1. **Verify APIs against real upstream source.** Two of the worst historical defects were plausible-sounding APIs that do not exist (`juce_add_webview_ui()`, `WebBrowserComponent::loadHTMLString`). `juce_add_plugin` has **no unparsed-argument check** — an unknown keyword is silently dropped.
2. **Write the failing test first** and prove it fails against the pre-change code in a throwaway worktree. The original suite was green while scaffolds could neither configure nor compile.
3. **`_tools/` is two directories up** from each plugin's `CMakeLists.txt`; a custom `pluginsDir` breaks the fallback (use `-D` flags or `add_subdirectory()`).
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
