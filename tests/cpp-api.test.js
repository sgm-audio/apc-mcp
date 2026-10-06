// Compile-level regression tests for the scaffold templates.
//
// The structural tests in templates.test.js check the generated CMake. This file
// goes one level further and runs a real C++ front end over the generated
// sources, which is what catches calls to JUCE/CLAP API that does not exist.
//
// It skips cleanly when no compiler is available, so `npm test` still works on a
// machine with only Node installed.
//
// JUCE sources are checked against tests/fixtures/juce-api-stub/JuceHeader.h, a
// transcription of the JUCE 9 API surface (see the banner in that file) — stub
// level only, not a real JUCE build.
//
// CLAP and LV2 sources are checked against the **real** upstream headers, so
// those results are genuine: APC_CLAP_INCLUDE points at a free-audio/clap
// checkout's include/, APC_LV2_INCLUDE at an lv2/lv2 checkout's include/. CI
// clones both. The LV2 template is C, not C++, so it is compiled with a C
// compiler and -std=c11.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { call } from './helpers/mcp-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JUCE_STUB = path.join(HERE, 'fixtures', 'juce-api-stub');
const CLAP_INCLUDE = process.env.APC_CLAP_INCLUDE || '';
const LV2_INCLUDE = process.env.APC_LV2_INCLUDE || '';

// Locate a compiler without spawning a shell.
function findCompiler(names) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return name;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

const IS_WIN = process.platform === 'win32';
const CXX = findCompiler(IS_WIN ? ['g++.exe', 'clang++.exe'] : ['g++', 'clang++']);
// The LV2 template is C. Compiling it as C++ would still catch a missing symbol,
// but it would not catch a C-only mistake and would not prove the template builds
// the way its CMakeLists says it does.
const CC = findCompiler(IS_WIN ? ['gcc.exe', 'clang.exe'] : ['gcc', 'clang']);
const HAVE_CLAP = CLAP_INCLUDE !== '' && fs.existsSync(path.join(CLAP_INCLUDE, 'clap', 'clap.h'));
const HAVE_LV2 = LV2_INCLUDE !== '' && fs.existsSync(path.join(LV2_INCLUDE, 'lv2', 'core', 'lv2.h'));

// Per-family compile configuration. Adding a template family means adding a row
// here, not another branch in the test body.
const FAMILY = {
  juce: { bin: () => CXX, std: '-std=c++20', ext: '.cpp', includes: () => [JUCE_STUB],
          ready: () => true, hint: null },
  clap: { bin: () => CXX, std: '-std=c++20', ext: '.cpp', includes: () => [CLAP_INCLUDE],
          ready: () => HAVE_CLAP,
          hint: 'set APC_CLAP_INCLUDE to a free-audio/clap include/ dir to check CLAP sources' },
  lv2:  { bin: () => CC,  std: '-std=c11',   ext: '.c',   includes: () => [LV2_INCLUDE],
          ready: () => HAVE_LV2,
          hint: 'set APC_LV2_INCLUDE to an lv2/lv2 include/ dir to check LV2 sources' },
};

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cxx-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');

const CASES = [
  { name: 'JuceGeneric', type: 'juce', ui: 'generic', family: 'juce' },
  { name: 'JuceWebView', type: 'juce', ui: 'webview', family: 'juce' },
  { name: 'Vst3WebView', type: 'vst3', ui: 'webview', family: 'juce' },
  { name: 'ClapPlugin',  type: 'clap', ui: 'generic', family: 'clap' },
  // A native LV2 plugin: pure C against lv2/core/lv2.h plus Turtle metadata.
  // Checked against the REAL upstream LV2 headers, like the CLAP case.
  { name: 'Lv2Plugin',   type: 'lv2',  ui: 'generic', family: 'lv2' },
  // A standalone *application* (juce_add_gui_app), not a plugin: Main.cpp defines
  // a JUCEApplication and START_JUCE_APPLICATION, and MainComponent.cpp derives
  // from AudioAppComponent. It is checked against the same JUCE stub, which was
  // extended with the application-side API (JUCEApplication, DocumentWindow,
  // Slider, Label, Graphics, AudioAppComponent, MathConstants, ProjectInfo).
  { name: 'StandaloneApp', type: 'standalone', ui: 'generic', family: 'juce' },
];

function compile(cwd, file, includeDirs, std = '-std=c++20') {
  const args = [std, '-fsyntax-only', '-Wall', '-Wextra'];
  for (const d of includeDirs) args.push('-I', d);
  args.push(file);
  return spawnSync(CXX, args, { cwd, encoding: 'utf-8', timeout: 120000 });
}

before(async () => {
  if (!CXX) return;
  fs.mkdirSync(PLUGINS, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(host)\n');

  for (const c of CASES) {
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name: c.name, type: c.type, ui: c.ui, vendor: 'acme',
        description: 'compile check' });
    assert.equal(r.isError, false, `scaffold ${c.name} failed: ${r.text}`);
  }
});

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

describe('scaffolded C/C++ compiles against the documented API', () => {
  it('a C++ compiler is available', t => {
    if (!CXX) t.skip('no g++/clang++ on PATH — install one to run the compile checks');
    assert.ok(CXX);
  });

  for (const c of CASES) {
    const fam = FAMILY[c.family];
    assert.ok(fam, `${c.name}: no compile configuration for family "${c.family}"`);

    it(`${c.name} (${c.type}/${c.ui}) sources compile as ${fam.std.replace('-std=', '')}`, t => {
      const bin = fam.bin();
      if (!bin) return t.skip(`no ${c.family === 'lv2' ? 'C' : 'C++'} compiler available`);

      const dir = path.join(PLUGINS, c.name, 'Source');
      const sources = fs.readdirSync(dir).filter(f => f.endsWith(fam.ext));
      assert.ok(sources.length > 0,
        `${c.name}: no ${fam.ext} files were scaffolded in Source/`);

      // Real upstream headers or nothing: skip rather than fake them, because a
      // stub that is too permissive proves nothing.
      if (!fam.ready()) return t.skip(fam.hint);

      const includes = [...fam.includes(), dir];

      for (const src of sources) {
        const res = compile(path.join(PLUGINS, c.name), path.join('Source', src),
                            includes, fam.std);
        const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
        assert.equal(res.status, 0,
          `${c.name}/${src} failed to compile with ${bin} ${fam.std}`
          + `${res.error ? ` (${res.error.message})` : ''}:\n${output}`);
      }
    });
  }

  // These two guards exist so "the compile checks passed" cannot quietly mean
  // "the compile checks were skipped".
  it('CLAP headers were available for the CLAP case', t => {
    if (!CXX) return t.skip('no C++ compiler available');
    if (!HAVE_CLAP) {
      return t.skip('APC_CLAP_INCLUDE not set — CI clones free-audio/clap and exports it');
    }
    assert.ok(fs.existsSync(path.join(CLAP_INCLUDE, 'clap', 'entry.h')));
  });

  it('LV2 headers were available for the LV2 case', t => {
    if (!CC) return t.skip('no C compiler available');
    if (!HAVE_LV2) {
      return t.skip('APC_LV2_INCLUDE not set — CI clones lv2/lv2 and exports it');
    }
    assert.ok(fs.existsSync(path.join(LV2_INCLUDE, 'lv2', 'core', 'lv2.h')));
  });
});
