<!--
Migrated from .gitlab/merge_request_templates/Default.md when the GitLab pipeline
was removed. The checklist is kept because it encodes this repo's security model;
the GitLab Ultimate code-quality gate is dropped, since CI runs on GitHub Actions.
-->

## Description

<!-- What does this PR change? Link the finding IDs from AUDIT.md if it closes any. -->

## Type of change

- [ ] Bug fix
- [ ] New tool / feature
- [ ] Refactor / code quality
- [ ] Security fix
- [ ] Documentation
- [ ] Scaffold template change

## Checklist

- [ ] `npm run check` passes — ESLint, tests, scaffold smoke test, `npm audit`,
      license gate. ESLint is a hard gate: an error there blocks the release too,
      because `scripts/ship.mjs` runs the same chain.
- [ ] No new advisory, and no production dependency outside `license_decisions.yml`
- [ ] Every user-facing string parameter has a zod regex constraint
- [ ] New subprocess calls use `spawnSync()` with an **argument array** — never a
      shell string, never `execSync`
- [ ] Anything that writes to disk goes through `assertWithinProject()`
- [ ] A tool that did not succeed returns `isError: true` — reporting success for a
      failed operation is worse than throwing

### If you touched `templates/`

- [ ] `npm run smoke` passes, and `node scripts/smoke-scaffold.mjs --configure` if
      you have cmake plus `APC_JUCE_DIR` / `APC_CLAP_DIR`
- [ ] `APC_CLAP_INCLUDE=<clap>/include node --test tests/cpp-api.test.js` reports
      **0 skipped**
- [ ] Every CMake keyword used actually exists — `juce_add_plugin` has **no
      unparsed-argument check**, so an unknown keyword is silently dropped, not
      reported. Verify against JUCE's `extras/Build/CMake/JUCEUtils.cmake`.
- [ ] `tests/templates.test.js` still passes, and a new test was added for whatever
      invariant this change relies on

### If you touched `index.js` behaviour

- [ ] A test fails against the **pre-change** code. Run it in a throwaway worktree:
      `git worktree add /tmp/red HEAD && cp tests/<new>.test.js /tmp/red/tests/`
      (see `HANDOFF.md` §4). A control with no red phase is not a control.

### If this is a release

- [ ] `version` bumped in `package.json` — that is the **only** copy; `index.js`
      reads it
- [ ] `CHANGELOG.md` `## [Unreleased]` renamed to `## [<version>] — <date>`
      (`scripts/ship.mjs` refuses to release otherwise)
- [ ] Breaking changes called out at the top of the release note, and the major
      version bumped accordingly
