// Security & robustness regression tests.
//
// These are NEGATIVE tests: they assert that the server *rejects* malicious or
// malformed input. A security control with no negative tests is not a control.
// Every test here maps to a finding in AUDIT.md (SEC-01, FUNC-04/05/07, QA-05, SEC-03).
//
// Fixtures live in os.tmpdir(), never in the repo, and are removed in after().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, listTools } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-sec-'));
const FAKE_BIN = path.join(ROOT, 'bin');      // instrumented fake toolchain
const EMPTY_BIN = path.join(ROOT, 'empty');   // a PATH with nothing in it
const PROJ = path.join(ROOT, 'proj');
const OUTSIDE = path.join(ROOT, 'outside');   // deliberately outside PROJ
const CF_LOG = path.join(ROOT, 'clang-format.log');

// A PATH containing only the instrumented fakes (+ nothing else).
const FAKE_PATH = FAKE_BIN;
const EMPTY_PATH = EMPTY_BIN;

before(() => {
  fs.mkdirSync(FAKE_BIN, { recursive: true });
  fs.mkdirSync(EMPTY_BIN, { recursive: true });
  fs.mkdirSync(path.join(PROJ, 'plugins', 'Foo', 'Source'), { recursive: true });
  fs.mkdirSync(path.join(OUTSIDE, 'Source'), { recursive: true });

  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(secproj)\n');
  fs.writeFileSync(path.join(PROJ, 'plugins', 'Foo', 'Source', 'Foo.cpp'), 'int foo(){return 1;}\n');
  fs.writeFileSync(path.join(OUTSIDE, 'Source', 'victim.cpp'), 'int victim(){return 2;}\n');

  // Fake clang-format records the exact argv it was invoked with, so tests can
  // prove which files the server handed it.
  fs.writeFileSync(path.join(FAKE_BIN, 'clang-format'),
    `#!/bin/sh\necho "ARGS: $*" >> "${CF_LOG}"\nexit 0\n`);
  fs.chmodSync(path.join(FAKE_BIN, 'clang-format'), 0o755);
  for (const t of ['cmake', 'ctest']) {
    fs.writeFileSync(path.join(FAKE_BIN, t), `#!/bin/sh\necho "ARGS: $*" >> "${ROOT}/${t}.log"\nexit 0\n`);
    fs.chmodSync(path.join(FAKE_BIN, t), 0o755);
  }
});

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

const resetCfLog = () => fs.writeFileSync(CF_LOG, '');
const cfLog = () => fs.existsSync(CF_LOG) ? fs.readFileSync(CF_LOG, 'utf8') : '';

// ═══════════════════════════════════════════════════════════════════
describe('SEC-01 · lint target must not escape the project root', () => {
  it('rejects target "../outside"', async () => {
    resetCfLog();
    const r = await call('audio_plugin_lint',
      { projectPath: PROJ, target: '../outside' }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `expected rejection, got: ${r.text}`);
    assert.match(r.text, /escape|outside|traversal|rejected|invalid/i);
    assert.ok(!cfLog().includes('victim.cpp'),
      `clang-format must NOT touch files outside the project, but saw: ${cfLog()}`);
  });

  it('rejects target with embedded "../.." segments', async () => {
    resetCfLog();
    const r = await call('audio_plugin_lint',
      { projectPath: PROJ, target: 'plugins/../../outside' }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `expected rejection, got: ${r.text}`);
    assert.ok(!cfLog().includes('victim.cpp'), `escape via nested segments: ${cfLog()}`);
  });

  it('rejects target "../../.." reaching toward the filesystem root', async () => {
    resetCfLog();
    const r = await call('audio_plugin_lint',
      { projectPath: PROJ, target: '../../..' }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `expected rejection, got: ${r.text}`);
    assert.equal(cfLog(), '', 'clang-format must not be invoked at all for an escaping target');
  });

  it('STILL ALLOWS a legitimate in-project target (no regression)', async () => {
    resetCfLog();
    const r = await call('audio_plugin_lint',
      { projectPath: PROJ, target: 'plugins/Foo/Source' }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, false, `legitimate target was rejected: ${r.text}`);
    assert.ok(cfLog().includes('Foo.cpp'), `expected Foo.cpp to be linted, saw: ${cfLog()}`);
    assert.ok(!cfLog().includes('victim.cpp'), 'must not reach outside the project');
  });

  it('rejects an absolute target outside the project', async () => {
    resetCfLog();
    const r = await call('audio_plugin_lint',
      { projectPath: PROJ, target: OUTSIDE }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `expected rejection of absolute outside path, got: ${r.text}`);
    assert.ok(!cfLog().includes('victim.cpp'), `absolute path escape: ${cfLog()}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('SEC-01b · create must not escape via config-supplied pluginsDir', () => {
  it('an escaping pluginsDir never creates files outside the project', async () => {
    const p = path.join(ROOT, 'evilcfg');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'CMakeLists.txt'), 'project(x)\n');
    fs.writeFileSync(path.join(p, 'apc-mcp.json'), JSON.stringify({ pluginsDir: '../pwned' }));
    const r = await call('audio_plugin_create',
      { projectPath: p, name: 'Boom', type: 'clap' }, { env: { PATH: FAKE_PATH } });

    // The invariant that matters: nothing is written outside the project root.
    // Satisfying it by sanitizing the bad config key to its default (preferred)
    // or by rejecting the call outright are both acceptable.
    assert.ok(!fs.existsSync(path.join(ROOT, 'pwned')),
      'a plugin directory must never be created outside the project root');

    if (!r.isError) {
      const created = path.join(p, 'plugins', 'Boom');
      assert.ok(fs.existsSync(created),
        `if the call succeeded it must have used the safe default pluginsDir: ${r.text}`);
      assert.ok(created.startsWith(path.resolve(p) + path.sep), 'created path escaped the project');
    } else {
      assert.match(r.text, /escape|rejected|invalid|pluginsDir/i,
        `rejection should explain itself, got: ${r.text}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('Layer 1 · zod schema rejects shell metacharacters', () => {
  const cases = [
    ['audio_plugin_build',     { target: 'Foo; rm -rf /' }],
    ['audio_plugin_build',     { target: 'Foo$(whoami)' }],
    ['audio_plugin_build',     { target: 'Foo`id`' }],
    ['audio_plugin_configure', { generator: 'Ninja; curl evil' }],
    ['audio_plugin_configure', { options: '-DA=ON; rm -rf /' }],
    ['audio_plugin_configure', { options: '-DA=$(id)' }],
    ['audio_plugin_test',      { testName: 'x\x00y' }],
    ['audio_plugin_create',    { name: '../evil', projectPath: PROJ }],
    ['audio_plugin_create',    { name: 'a;b', projectPath: PROJ }],
    ['audio_plugin_create',    { vendor: 'v`id`', projectPath: PROJ }],
  ];
  for (const [tool, extra] of cases) {
    it(`${tool} rejects ${JSON.stringify(extra)}`, async () => {
      const args = { projectPath: PROJ, ...extra };
      const r = await call(tool, args, { env: { PATH: FAKE_PATH } });
      assert.equal(r.isError, true,
        `metacharacters were accepted by ${tool}: ${JSON.stringify(extra)}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-04/05 · missing toolchain yields an actionable message', () => {
  it('build reports cmake as missing with an install hint', async () => {
    const r = await call('audio_plugin_build', { projectPath: PROJ }, { env: { PATH: EMPTY_PATH } });
    assert.equal(r.isError, true);
    assert.match(r.text, /cmake/, `expected 'cmake' in message, got: ${r.text}`);
    assert.match(r.text, /not found|missing|install/i, `expected actionable hint, got: ${r.text}`);
    assert.ok(!r.text.includes('exit code null'),
      `dead-code ENOENT path leaked "exit code null": ${r.text}`);
  });

  it('build surfaces the documented install command', async () => {
    const r = await call('audio_plugin_build', { projectPath: PROJ }, { env: { PATH: EMPTY_PATH } });
    assert.match(r.text, /cmake\.org|brew install cmake|apt install cmake/i,
      `expected a concrete install instruction, got: ${r.text}`);
  });

  it('test reports ctest as missing', async () => {
    const r = await call('audio_plugin_test', { projectPath: PROJ }, { env: { PATH: EMPTY_PATH } });
    assert.equal(r.isError, true);
    assert.match(r.text, /ctest/);
    assert.ok(!r.text.includes('exit code null'), r.text);
  });

  it('lint reports clang-format as missing', async () => {
    const r = await call('audio_plugin_lint', { projectPath: PROJ }, { env: { PATH: EMPTY_PATH } });
    assert.equal(r.isError, true);
    assert.match(r.text, /clang-format/);
    assert.ok(!r.text.includes('exit code null'), r.text);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('QA-05 · a non-existent projectPath is rejected without side effects', () => {
  it('build does not create directories for a bogus projectPath', async () => {
    const missing = path.join(ROOT, 'does-not-exist-' + Date.now());
    const r = await call('audio_plugin_build', { projectPath: missing }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `expected rejection, got: ${r.text}`);
    assert.match(r.text, /not found|does not exist|no project/i);
    assert.ok(!fs.existsSync(missing),
      'the server must not create a directory tree for a project that does not exist');
  });

  it('plugins rejects a bogus projectPath', async () => {
    const missing = path.join(ROOT, 'nope-' + Date.now());
    const r = await call('audio_plugin_plugins', { projectPath: missing }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true);
    assert.match(r.text, /not found|does not exist/i);
    assert.ok(!fs.existsSync(missing));
  });

  it('accepts a directory that is a real project (has CMakeLists.txt)', async () => {
    const r = await call('audio_plugin_plugins', { projectPath: PROJ }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, false, `a valid project was rejected: ${r.text}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('SEC-03 · apc-mcp.json is validated, never trusted blindly', () => {
  function projectWith(configObj, name) {
    const p = path.join(ROOT, name);
    fs.mkdirSync(path.join(p, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(p, 'CMakeLists.txt'), 'project(x)\n');
    fs.writeFileSync(path.join(p, 'apc-mcp.json'),
      typeof configObj === 'string' ? configObj : JSON.stringify(configObj));
    return p;
  }

  it('malformed JSON falls back to defaults instead of crashing', async () => {
    const p = projectWith('{ this is not json', 'cfg-bad-json');
    const r = await call('audio_plugin_plugins', { projectPath: p }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, false, `server crashed on malformed config: ${r.text}`);
  });

  it('a non-array validateFormats does not crash validate', async () => {
    const p = projectWith({ validateFormats: 'VST3' }, 'cfg-bad-formats');
    const r = await call('audio_plugin_validate', { projectPath: p }, { env: { PATH: FAKE_PATH } });
    assert.ok(r.text.length > 0, 'expected some output');
    assert.ok(!/Cannot read|is not a function|TypeError/.test(r.text),
      `unhandled type error leaked to the user: ${r.text}`);
  });

  it('an out-of-range buildDir escapes nothing', async () => {
    const p = projectWith({ buildDir: '../escaped-build' }, 'cfg-bad-builddir');
    const r = await call('audio_plugin_build', { projectPath: p }, { env: { PATH: FAKE_PATH } });
    assert.ok(!fs.existsSync(path.join(ROOT, 'escaped-build')),
      'buildDir from config must not be allowed to escape the project root');
    assert.ok(r.text !== undefined);
  });

  it('unknown keys are tolerated (forward compatible)', async () => {
    const p = projectWith({ futureKey: 42 }, 'cfg-unknown-key');
    const r = await call('audio_plugin_plugins', { projectPath: p }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, false, `unknown config key broke the server: ${r.text}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-07 · type "ara" is no longer offered (unimplemented template)', () => {
  it('the create schema does not advertise ara', async () => {
    const tools = await listTools();
    const create = tools.find(t => t.name === 'audio_plugin_create');
    assert.ok(create, 'audio_plugin_create not registered');
    const allowed = create.inputSchema.properties.type.enum ?? [];
    assert.ok(!allowed.includes('ara'),
      `"ara" is still advertised but scaffolds an unbuildable plugin: ${allowed.join(', ')}`);
  });

  it('create rejects type "ara"', async () => {
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name: 'AraNope', type: 'ara' }, { env: { PATH: FAKE_PATH } });
    assert.equal(r.isError, true, `"ara" was accepted: ${r.text}`);
    assert.ok(!fs.existsSync(path.join(PROJ, 'plugins', 'AraNope')),
      'no plugin directory should have been created for a rejected type');
  });

  it('create still accepts the supported types', async () => {
    for (const type of ['clap', 'vst3', 'juce']) {
      const name = 'Ok' + type.toUpperCase();
      const r = await call('audio_plugin_create',
        { projectPath: PROJ, name, type }, { env: { PATH: FAKE_PATH } });
      assert.equal(r.isError, false, `supported type "${type}" was rejected: ${r.text}`);
      assert.ok(fs.existsSync(path.join(PROJ, 'plugins', name, 'CMakeLists.txt')));
    }
  });
});
