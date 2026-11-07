// Compile-checks every scaffolded C/C++ source file with a real compiler front end.
//
// Structural assertions in tests/templates.test.js catch CMake mistakes and
// missing files, but they cannot prove that the generated C/C++ actually calls
// APIs that exist with signatures that match. This file runs gcc/clang (C11)
// and g++/clang++ (C++20) `-fsyntax-only -Wall -Wextra` over every scaffolded
// translation unit.
//
// Header sources:
//   JUCE + standalone: tests/fixtures/juce-api-stub/JuceHeader.h (transcribed
//                      from JUCE 9.0.3 headers, including Windows WebView2 gating)
//   CLAP:              APC_CLAP_INCLUDE -> free-audio/clap include/
//   LV2:               APC_LV2_INCLUDE  -> lv2/lv2 include/

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, PROJECT_ROOT } from './helpers/mcp-client.mjs';

const JUCE_STUB = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'juce-api-stub');
const CLAP_INCLUDE = process.env.APC_CLAP_INCLUDE || '';
const LV2_INCLUDE = process.env.APC_LV2_INCLUDE || '';

function findCompiler(candidates) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const name of candidates) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) return full;
      } catch {
        // try next
      }
    }
  }
  return null;
}

const IS_WIN = process.platform === 'win32';
const CXX = findCompiler(IS_WIN ? ['g++.exe', 'clang++.exe'] : ['g++', 'clang++']);
// The LV2 template is C. Compiling it as C++ would not catch C-only mistakes or
// prove the template builds under `-std=c11` as its CMakeLists specifies.
const CC = findCompiler(IS_WIN ? ['gcc.exe', 'clang.exe'] : ['gcc', 'clang']);
const HAVE_CLAP = CLAP_INCLUDE !== '' && fs.existsSync(path.join(CLAP_INCLUDE, 'clap', 'clap.h'));
const HAVE_LV2 = LV2_INCLUDE !== '' && fs.existsSync(path.join(LV2_INCLUDE, 'lv2', 'core', 'lv2.h'));

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
  { name: 'JuceGeneric',   type: 'juce',       ui: 'generic', family: 'juce' },
  { name: 'JuceWebView',   type: 'juce',       ui: 'webview', family: 'juce' },
  { name: 'Vst3Generic',   type: 'vst3',       ui: 'generic', family: 'juce' },
  { name: 'Vst3WebView',   type: 'vst3',       ui: 'webview', family: 'juce' },
  { name: 'ClapPlugin',    type: 'clap',       ui: 'generic', family: 'clap' },
  { name: 'ClapQuoted',    type: 'clap',       ui: 'generic', family: 'clap',
    description: 'A "warm" delay\\reverb effect' },
  { name: 'Lv2Plugin',     type: 'lv2',        ui: 'generic', family: 'lv2' },
  { name: 'StandaloneApp', type: 'standalone', ui: 'generic', family: 'juce' },
];

function compile(compilerBin, cwd, file, includeDirs, std = '-std=c++20', extraDefines = []) {
  const args = [std, '-fsyntax-only', '-Wall', '-Wextra', ...extraDefines];
  for (const d of includeDirs) args.push('-I', d);
  args.push(file);
  return spawnSync(compilerBin, args, { cwd, encoding: 'utf-8', timeout: 120000 });
}

before(async () => {
  if (!CXX && !CC) return;
  fs.mkdirSync(PLUGINS, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(host)\n');

  for (const c of CASES) {
    const r = await call('audio_plugin_create', {
      projectPath: PROJ, name: c.name, type: c.type, ui: c.ui, vendor: 'acme',
      description: c.description ?? 'compile check',
    });
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

      if (!fam.ready()) return t.skip(fam.hint);

      const includes = [...fam.includes(), dir];

      for (const src of sources) {
        const res = compile(bin, path.join(PLUGINS, c.name), path.join('Source', src),
                            includes, fam.std);
        const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
        assert.equal(res.status, 0,
          `${c.name}/${src} failed to compile with ${bin} ${fam.std}`
          + `${res.error ? ` (${res.error.message})` : ''}:\n${output}`);
      }
    });
  }

  it('JuceWebView also compiles under simulated Windows (JUCE_WINDOWS=1) using its CMake compile definitions', t => {
    if (!CXX) return t.skip('no C++ compiler available');
    const pluginDir = path.join(PLUGINS, 'JuceWebView');
    const cmake = fs.readFileSync(path.join(pluginDir, 'CMakeLists.txt'), 'utf8');
    const defs = [...cmake.matchAll(/^\s*(JUCE_[A-Z0-9_]+=\S+)/gm)].map(m => `-D${m[1]}`);
    assert.ok(defs.includes('-DJUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1'),
      `expected JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1 in CMakeLists.txt, got: ${defs.join(', ')}`);

    const res = compile(
      CXX,
      pluginDir,
      path.join('Source', 'WebViewEditor.cpp'),
      [JUCE_STUB, path.join(pluginDir, 'Source')],
      '-std=c++20',
      ['-DJUCE_WINDOWS=1', ...defs]
    );
    const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    assert.equal(res.status, 0,
      `WebViewEditor.cpp failed under JUCE_WINDOWS=1:\n${output}`);
  });

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
