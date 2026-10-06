// Phase 3 — correctness of tool output: config precedence, failure reporting,
// and the build/test output parsers.
//
// Every defect here makes the server *report success or wrong numbers* while the
// underlying tool actually failed or disagreed. That is worse than crashing: the
// model acts on the report.
//
// Findings covered: FUNC-06, QA-01, QA-02, QA-03, QA-04, QA-06, QA-07, HYG-12.
// QA-07 was found while writing these tests and is new to AUDIT.md.
//
// Method: the real toolchain is absent, so each test drives PATH shims that emit
// canned output and a chosen exit code. That exercises the real handler code
// paths end to end without needing cmake, ctest or clang-format installed.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-p3-'));
const FAKE_BIN = path.join(ROOT, 'bin');          // all shims present
const NO_CLAPVAL_BIN = path.join(ROOT, 'bin-nocv'); // pluginval but no clap-validator
const PROJ = path.join(ROOT, 'proj');
const BUILD = path.join(PROJ, 'build');

const LOG = path.join(ROOT, 'argv.log');
const SHIM_OUT = path.join(ROOT, 'shim-stdout.txt');
const SHIM_ERR = path.join(ROOT, 'shim-stderr.txt');

const TOOLS = ['cmake', 'ctest', 'clang-format', 'pluginval', 'clap-validator'];

// One shim shape for every tool: record argv (tagged with the tool name), echo
// the canned stdout/stderr files, exit with the requested code.
function writeShim(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, [
    '#!/bin/sh',
    `printf '%s ARGS: %s\\n' "$name" "$*" >> "$APC_SHIM_LOG"`.replace('$name', name),
    'if [ -n "$APC_SHIM_STDOUT" ] && [ -s "$APC_SHIM_STDOUT" ]; then cat "$APC_SHIM_STDOUT"; fi',
    'if [ -n "$APC_SHIM_STDERR" ] && [ -s "$APC_SHIM_STDERR" ]; then cat "$APC_SHIM_STDERR" >&2; fi',
    'exit "${APC_SHIM_EXIT:-0}"',
    '',
  ].join('\n'));
  fs.chmodSync(p, 0o755);
}

// A minimal system PATH for the shims themselves. They are /bin/sh scripts that
// need cat, so a PATH containing only the fake bin dir silently produced no
// output and made tests pass or fail for the wrong reason.
//
// Deliberately NOT process.env.PATH: pluginval and clap-validator are exactly
// the tools an audio developer is likely to have installed, and QA-06 depends on
// clap-validator being genuinely absent. /usr/bin:/bin cannot contain either, and
// cmake/ctest/clang-format in those dirs are shadowed by the fake bin coming
// first. POSIX-only, like the other sh-based fixtures in this suite.
const SYS_PATH = '/usr/bin' + path.delimiter + '/bin';

// Env handed to the server (and therefore inherited by the shims).
function shimEnv(dir = FAKE_BIN, { stdout = '', stderr = '', exit = 0 } = {}) {
  fs.writeFileSync(SHIM_OUT, stdout);
  fs.writeFileSync(SHIM_ERR, stderr);
  return {
    PATH: dir + path.delimiter + SYS_PATH,
    APC_SHIM_LOG: LOG,
    APC_SHIM_STDOUT: SHIM_OUT,
    APC_SHIM_STDERR: SHIM_ERR,
    APC_SHIM_EXIT: String(exit),
  };
}

const log = () => fs.readFileSync(LOG, 'utf8');
const argvOf = tool => log().split('\n')
  .filter(l => l.startsWith(`${tool} ARGS:`))
  .map(l => l.slice(`${tool} ARGS:`.length).trim());

function writeProjectConfig(obj) {
  fs.writeFileSync(path.join(PROJ, 'apc-mcp.json'), JSON.stringify(obj, null, 2));
}

// audio_plugin_build auto-configures when build/CMakeCache.txt is missing and
// returns early if that fails. Tests that target the --build invocation must
// plant the cache first, otherwise the shim's exit code is consumed by the
// configure step instead.
function plantCache() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(path.join(BUILD, 'CMakeCache.txt'), '# stub cache\n');
}

// Plant the artefacts audio_plugin_validate looks for.
function plantArtefacts(config, { vst3 = true, clap = true } = {}) {
  const art = path.join(BUILD, 'plugins', 'Foo', 'Foo_artefacts', config);
  if (vst3) {
    fs.mkdirSync(path.join(art, 'VST3'), { recursive: true });
    fs.writeFileSync(path.join(art, 'VST3', 'Foo.vst3'), 'stub');
  }
  if (clap) {
    fs.mkdirSync(path.join(art, 'CLAP'), { recursive: true });
    fs.writeFileSync(path.join(art, 'CLAP', 'Foo.clap'), 'stub');
  }
}

before(() => {
  for (const t of TOOLS) writeShim(FAKE_BIN, t);
  for (const t of TOOLS.filter(t => t !== 'clap-validator')) writeShim(NO_CLAPVAL_BIN, t);

  fs.mkdirSync(path.join(PROJ, 'plugins', 'Foo', 'Source'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(p3proj)\n');
  fs.writeFileSync(path.join(PROJ, 'plugins', 'Foo', 'Source', 'Foo.cpp'), 'int foo(){return 1;}\n');
});

beforeEach(() => {
  fs.writeFileSync(LOG, '');
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.rmSync(path.join(PROJ, 'apc-mcp.json'), { force: true });
});

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

// ═══════════════════════════════════════════════════════════════════
// FUNC-06 — zod's .default('Debug') fires whenever the caller omits `config`,
// so params.config is ALWAYS set and `params.config || cfg.config` never falls
// through to the project file. The `config` key of apc-mcp.json is dead.
describe('FUNC-06 · config from apc-mcp.json must be honoured', () => {
  it('audio_plugin_build uses the project config when the caller omits it', async () => {
    writeProjectConfig({ config: 'Release' });
    // No CMakeCache.txt, so build auto-configures and passes the build type.
    const r = await call('audio_plugin_build', { projectPath: PROJ }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    const configureArgs = argvOf('cmake').find(a => a.includes('-DCMAKE_BUILD_TYPE'));
    assert.ok(configureArgs, `cmake was never asked to configure. argv log:\n${log()}`);
    assert.ok(configureArgs.includes('-DCMAKE_BUILD_TYPE=Release'),
      `apc-mcp.json says Release but cmake got: ${configureArgs}`);
  });

  it('audio_plugin_configure uses the project config', async () => {
    writeProjectConfig({ config: 'Release' });
    const r = await call('audio_plugin_configure', { projectPath: PROJ }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    const args = argvOf('cmake')[0] ?? '';
    assert.ok(args.includes('-DCMAKE_BUILD_TYPE=Release'),
      `apc-mcp.json says Release but cmake got: ${args}`);
  });

  it('audio_plugin_test passes the project config to ctest -C', async () => {
    writeProjectConfig({ config: 'Release' });
    const r = await call('audio_plugin_test', { projectPath: PROJ }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    const args = argvOf('ctest')[0] ?? '';
    assert.ok(/(^|\s)-C Release(\s|$)/.test(args),
      `apc-mcp.json says Release but ctest got: ${args}`);
  });

  it('audio_plugin_validate looks in the project config\'s artefact dir', async () => {
    writeProjectConfig({ config: 'Release' });
    plantArtefacts('Release');
    const r = await call('audio_plugin_validate', { projectPath: PROJ }, { env: shimEnv() });
    assert.ok(!/No plugin binaries found/.test(r.text),
      `Release artefacts exist but validate did not find them: ${r.text}`);
  });

  it('an explicit argument still wins over the project config', async () => {
    writeProjectConfig({ config: 'Release' });
    const r = await call('audio_plugin_configure',
      { projectPath: PROJ, config: 'Debug' }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    const args = argvOf('cmake')[0] ?? '';
    assert.ok(args.includes('-DCMAKE_BUILD_TYPE=Debug'),
      `explicit config=Debug must win, cmake got: ${args}`);
  });

  it('falls back to Debug when neither the argument nor the file sets it', async () => {
    const r = await call('audio_plugin_configure', { projectPath: PROJ }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    assert.ok((argvOf('cmake')[0] ?? '').includes('-DCMAKE_BUILD_TYPE=Debug'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// QA-01 — the fix=true branch never inspects clang-format's exit status, so a
// crashing formatter reports "No formatting issues".
describe('QA-01 · lint(fix=true) must report a failing clang-format', () => {
  it('reports failure when clang-format exits non-zero', async () => {
    const r = await call('audio_plugin_lint', { projectPath: PROJ, fix: true },
      { env: shimEnv(FAKE_BIN, { stderr: 'error: invalid style file\n', exit: 1 }) });
    assert.equal(r.isError, true, `clang-format failed but lint reported: ${r.text}`);
    assert.ok(!/No formatting issues/.test(r.text),
      `must not claim success when the formatter failed: ${r.text}`);
  });

  it('still reports success when clang-format exits zero', async () => {
    const r = await call('audio_plugin_lint', { projectPath: PROJ, fix: true },
      { env: shimEnv(FAKE_BIN, { exit: 0 }) });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /No formatting issues/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QA-02 — parseTestOutput word-counts /\bPassed\b/gi and /\bFailed\b/gi over the
// whole stream, so ctest's own summary prose is counted as a test result.
const CTEST_ALL_PASS = [
  'Test project /home/u/proj/build',
  '    Start 1: FooTest',
  '1/3 Test #1: FooTest ..........................   Passed    0.02 sec',
  '    Start 2: BarTest',
  '2/3 Test #2: BarTest ..........................   Passed    0.01 sec',
  '    Start 3: BazTest',
  '3/3 Test #3: BazTest ..........................   Passed    0.03 sec',
  '',
  '100% tests passed, 0 tests failed out of 3',
  '',
  'Total Test time (real) =   0.07 sec',
  '',
].join('\n');

const CTEST_ONE_FAIL = [
  'Test project /home/u/proj/build',
  '1/3 Test #1: FooTest ..........................   Passed    0.02 sec',
  '2/3 Test #2: BarTest ..........................***Failed    0.01 sec',
  '3/3 Test #3: BazTest ..........................   Passed    0.03 sec',
  '',
  '67% tests passed, 1 tests failed out of 3',
  '',
].join('\n');

describe('QA-02 · the ctest parser must not count its own summary prose', () => {
  it('reports 3/0/3 for an all-passing run', async () => {
    const r = await call('audio_plugin_test', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: CTEST_ALL_PASS }) });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Passed: 3, Failed: 0, Total: 3/,
      `word-counting the summary inflates this to 4/1/5. got: ${r.text}`);
  });

  it('reports 2/1/3 when one test fails', async () => {
    const r = await call('audio_plugin_test', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: CTEST_ONE_FAIL, exit: 8 }) });
    assert.equal(r.isError, true, 'ctest exited 8, so the tool must report failure');
    assert.match(r.text, /Passed: 2, Failed: 1, Total: 3/, `got: ${r.text}`);
  });

  it('counts per-test lines when ctest prints no summary', async () => {
    const partial = [
      '1/2 Test #1: A ...   Passed    0.01 sec',
      '2/2 Test #2: B ...***Failed    0.01 sec',
    ].join('\n');
    const r = await call('audio_plugin_test', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: partial, exit: 8 }) });
    assert.match(r.text, /Passed: 1, Failed: 1, Total: 2/, `got: ${r.text}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QA-03 / QA-04 / QA-07 / HYG-12 — parseBuildOutput.
const MSVC_ERRORS = [
  'Foo.cpp',
  'C:\\src\\Foo.cpp(12): error C2065: \'x\': undeclared identifier',
  'C:\\src\\Bar.cpp(17): error C2065: \'y\': undeclared identifier',
  'C:\\src\\Bar.cpp(20): warning C4244: conversion, possible loss of data',
  'Build FAILED.',
].join('\n');

describe('QA-03 · MSVC diagnostics must be counted as errors', () => {
  it('counts both "error C2065" lines', async () => {
    plantCache();
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: MSVC_ERRORS, exit: 1 }) });
    assert.match(r.text, /Errors: 2/,
      `MSVC's "error C2065:" shape is unmatched, so only the clang-style line counts. got: ${r.text}`);
  });

  it('counts the MSVC "warning C4244" line', async () => {
    plantCache();
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: MSVC_ERRORS, exit: 1 }) });
    assert.match(r.text, /Warnings: 1/, `got: ${r.text}`);
  });
});

describe('QA-04 · summary prose must not be counted as a warning', () => {
  it('does not count a line that merely mentions "warning:"', async () => {
    plantCache();
    // Compilers echo the offending source line under a diagnostic, so build
    // output routinely contains non-diagnostic lines with "warning:" in them.
    // /^.*warning:/ is equivalent to includes('warning:') and counts all of them.
    const clean = [
      '[100%] Built target Foo_VST3',
      '0 errors, 0 warnings',
      '    const char *msg = "warning: benign, see #1234";',
      '            ^',
    ].join('\n');
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: clean }) });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Errors: 0, Warnings: 0/,
      `non-diagnostic lines are being counted. got: ${r.text}`);
  });

  it('still counts a real clang warning', async () => {
    plantCache();
    const withWarning = '/src/Foo.cpp:3:7: warning: unused variable \'x\' [-Wunused-variable]';
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: withWarning }) });
    assert.match(r.text, /Warnings: 1/, `got: ${r.text}`);
  });

  it('counts a gcc-style warning (no column number)', async () => {
    plantCache();
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: "/src/Foo.cpp:3:7: warning: unused variable 'x' [-Wunused-variable]" }) });
    assert.match(r.text, /Warnings: 1/, `got: ${r.text}`);
  });

  it('still counts a real clang error', async () => {
    plantCache();
    const withError = '/src/Foo.cpp:9:3: error: use of undeclared identifier \'x\'';
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, { stdout: withError, exit: 1 }) });
    assert.match(r.text, /Errors: 1/, `got: ${r.text}`);
  });
});

// QA-07 (new) — trySpawn returns stdout as `output` and stderr separately, but
// parseBuildOutput only ever sees `r.output`. Compilers write diagnostics to
// stderr, so on a failing build the "### Errors" section is empty precisely
// when errors happened.
describe('QA-07 · compiler diagnostics on stderr must be parsed', () => {
  it('reports errors that cmake forwarded to stderr', async () => {
    plantCache();
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, {
        stdout: '[ 50%] Building CXX object CMakeFiles/Foo.dir/Foo.cpp.o\n',
        stderr: '/src/Foo.cpp:9:3: error: use of undeclared identifier \'x\'\n',
        exit: 2,
      }) });
    assert.equal(r.isError, true);
    assert.match(r.text, /Errors: 1/,
      `the error went to stderr and was never parsed. got: ${r.text}`);
    assert.match(r.text, /undeclared identifier/,
      `the error text should be quoted back to the model. got: ${r.text}`);
  });
});

// HYG-12 — build computes parsed.errorCount, prints it, then sets
// isError: !r.ok and ignores it.
describe('HYG-12 · a build that emitted errors is not a success', () => {
  it('reports isError when cmake exits 0 but errors were emitted', async () => {
    plantCache();
    const r = await call('audio_plugin_build', { projectPath: PROJ },
      { env: shimEnv(FAKE_BIN, {
        stdout: '/src/Foo.cpp:9:3: error: use of undeclared identifier \'x\'\n[100%] Built target Foo\n',
        exit: 0,
      }) });
    assert.match(r.text, /Errors: 1/);
    assert.equal(r.isError, true,
      `errorCount was computed and printed but never affected isError: ${r.text}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QA-06 — checkOptionalTool()'s return value is discarded, then requireTool()
// throws from inside the results loop, so already-computed results are lost.
describe('QA-06 · a missing optional validator must not abort the report', () => {
  it('reports the VST3 result and names the missing CLAP validator', async () => {
    writeProjectConfig({ validateFormats: ['VST3', 'CLAP'] });
    plantArtefacts('Debug');
    // PATH has pluginval but no clap-validator.
    const r = await call('audio_plugin_validate', { projectPath: PROJ },
      { env: shimEnv(NO_CLAPVAL_BIN) });

    assert.match(r.text, /Foo \[VST3\]/,
      `the VST3 result was discarded when the loop threw. got: ${r.text}`);
    assert.match(r.text, /clap-validator/,
      `the report should say which validator is missing. got: ${r.text}`);
    assert.match(r.text, /SKIP|not installed|not found/i,
      `the CLAP entry should be reported as skipped, not silently dropped. got: ${r.text}`);
  });

  it('does not claim success when a validator was missing', async () => {
    writeProjectConfig({ validateFormats: ['VST3', 'CLAP'] });
    plantArtefacts('Debug');
    const r = await call('audio_plugin_validate', { projectPath: PROJ },
      { env: shimEnv(NO_CLAPVAL_BIN) });
    assert.equal(r.isError, true,
      `validation was incomplete, so it must not report success: ${r.text}`);
  });

  it('validates cleanly when both validators are present', async () => {
    writeProjectConfig({ validateFormats: ['VST3', 'CLAP'] });
    plantArtefacts('Debug');
    const r = await call('audio_plugin_validate', { projectPath: PROJ }, { env: shimEnv() });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /2 passed, 0 failed/);
  });
});
