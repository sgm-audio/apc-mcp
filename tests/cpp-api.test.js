// Compile- and link-checks every scaffolded C/C++ source file with a real compiler.
//
// Structural assertions in tests/templates.test.js catch CMake mistakes and
// missing files, while `-fsyntax-only` alone misses linker-level bugs such as a
// missing `createPluginFilter()` factory or mismatched `juceaide` BinaryData
// symbol names/linkages. This suite compiles every translation unit under strict
// warnings (`-Wall -Wextra -Woverloaded-virtual -Wzero-as-null-pointer-constant -Werror`)
// AND links each target (against a `createPluginFilter()` host harness for JUCE
// plugins, `START_JUCE_APPLICATION` for standalone apps, and `-shared -fPIC`
// MODULE libraries for CLAP and LV2).
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

const CXX_WARNINGS = [
  '-Wall',
  '-Wextra',
  '-Woverloaded-virtual',
  '-Wzero-as-null-pointer-constant',
  '-Werror',
];
const CC_WARNINGS = ['-Wall', '-Wextra', '-Werror'];

const FAMILY = {
  juce: { bin: () => CXX, std: '-std=c++20', ext: '.cpp', warnings: CXX_WARNINGS,
          includes: () => [JUCE_STUB], ready: () => true, hint: null },
  clap: { bin: () => CXX, std: '-std=c++20', ext: '.cpp', warnings: CXX_WARNINGS,
          includes: () => [CLAP_INCLUDE], ready: () => HAVE_CLAP,
          hint: 'set APC_CLAP_INCLUDE to a free-audio/clap include/ dir to check CLAP sources' },
  lv2:  { bin: () => CC,  std: '-std=c11',   ext: '.c',   warnings: CC_WARNINGS,
          includes: () => [LV2_INCLUDE], ready: () => HAVE_LV2,
          hint: 'set APC_LV2_INCLUDE to an lv2/lv2 include/ dir to check LV2 sources' },
};

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cxx-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');
const GEN = path.join(ROOT, 'generated');

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

// Emits BinaryData.h and BinaryData1.cpp with the exact linkage & naming rules
// of JUCE 9's juce_BinaryResourceFile.cpp:
//   - `extern const char* <var>;` (defined in BinaryData1.cpp)
//   - `const int <var>Size = <bytes>;` in BinaryData.h ONLY (internal linkage!)
// Any manual `extern const int <var>_size;` or `extern const int <var>Size;` in
// template code therefore fails to link here, matching real juceaide.
function generateStubBinaryData(pluginDir, outDir) {
  const cm = fs.readFileSync(path.join(pluginDir, 'CMakeLists.txt'), 'utf8')
    .split('\n')
    .map(l => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  const ns = cm.match(/\bNAMESPACE\s+(\S+)/)?.[1] ?? 'BinaryData';
  fs.mkdirSync(outDir, { recursive: true });

  const uiDir = path.join(pluginDir, 'Source', 'UI');
  const assets = fs.existsSync(uiDir) ? fs.readdirSync(uiDir).sort() : [];

  const hLines = ['#pragma once', `namespace ${ns}`, '{'];
  const cppLines = ['#include "BinaryData.h"', `namespace ${ns}`, '{'];

  for (const file of assets) {
    const raw = fs.readFileSync(path.join(uiDir, file));
    const varName = file.replace(/[^a-zA-Z0-9]/g, '_');
    hLines.push(`    extern const char* ${varName};`);
    hLines.push(`    const int ${varName}Size = ${raw.length};`);
    const hexBytes = [...raw].map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
    cppLines.push(`    static const unsigned char temp_${varName}[] = { ${hexBytes || '0x00'}, 0x00 };`);
    cppLines.push(`    const char* ${varName} = reinterpret_cast<const char*> (temp_${varName});`);
  }

  hLines.push('}', '');
  cppLines.push('}', '');

  fs.writeFileSync(path.join(outDir, 'BinaryData.h'), hLines.join('\n'));
  const cppPath = path.join(outDir, 'BinaryData1.cpp');
  fs.writeFileSync(cppPath, cppLines.join('\n'));
  return { includeDir: outDir, cppPath };
}

function compile(compilerBin, cwd, file, includeDirs, std = '-std=c++20', warnings = CXX_WARNINGS, extraDefines = []) {
  const args = [std, '-fsyntax-only', ...warnings, ...extraDefines];
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

describe('scaffolded C/C++ compiles and links against the documented API', () => {
  it('a C++ compiler is available', t => {
    if (!CXX) t.skip('no g++/clang++ on PATH — install one to run the compile checks');
    assert.ok(CXX);
  });

  for (const c of CASES) {
    const fam = FAMILY[c.family];
    assert.ok(fam, `${c.name}: no compile configuration for family "${c.family}"`);

    it(`${c.name} (${c.type}/${c.ui}) sources compile cleanly as ${fam.std.replace('-std=', '')}`, t => {
      const bin = fam.bin();
      if (!bin) return t.skip(`no ${c.family === 'lv2' ? 'C' : 'C++'} compiler available`);

      const pluginDir = path.join(PLUGINS, c.name);
      const dir = path.join(pluginDir, 'Source');
      const sources = fs.readdirSync(dir).filter(f => f.endsWith(fam.ext));
      assert.ok(sources.length > 0,
        `${c.name}: no ${fam.ext} files were scaffolded in Source/`);

      if (!fam.ready()) return t.skip(fam.hint);

      const includes = [...fam.includes(), dir];
      if (c.ui === 'webview' && c.family === 'juce' && c.type !== 'standalone') {
        const bd = generateStubBinaryData(pluginDir, path.join(GEN, c.name));
        includes.push(bd.includeDir);
      }

      for (const src of sources) {
        const res = compile(bin, pluginDir, path.join('Source', src),
                            includes, fam.std, fam.warnings);
        const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
        assert.equal(res.status, 0,
          `${c.name}/${src} failed to compile with ${bin} ${fam.std}`
          + `${res.error ? ` (${res.error.message})` : ''}:\n${output}`);
      }
    });

    it(`${c.name} (${c.type}/${c.ui}) links its entry point with zero unresolved symbols`, t => {
      const bin = fam.bin();
      if (!bin) return t.skip(`no ${c.family === 'lv2' ? 'C' : 'C++'} compiler available`);
      if (!fam.ready()) return t.skip(fam.hint);

      const pluginDir = path.join(PLUGINS, c.name);
      const srcDir = path.join(pluginDir, 'Source');
      const sources = fs.readdirSync(srcDir)
        .filter(f => f.endsWith(fam.ext))
        .map(f => path.join(srcDir, f));
      const includes = [...fam.includes(), srcDir];
      const outDir = path.join(GEN, `${c.name}-link`);
      fs.mkdirSync(outDir, { recursive: true });

      const args = [fam.std, ...fam.warnings];

      if (c.family === 'juce' && c.type !== 'standalone') {
        if (c.ui === 'webview') {
          const bd = generateStubBinaryData(pluginDir, path.join(GEN, c.name));
          includes.push(bd.includeDir);
          sources.push(bd.cppPath);
        }
        // Mirror JUCE's plugin client wrapper: calls createPluginFilter() and
        // exercises prepareToPlay / processBlock / createEditor / state methods.
        const harness = path.join(outDir, 'juce_wrapper_harness.cpp');
        fs.writeFileSync(harness, [
          '#include <JuceHeader.h>',
          '#include <memory>',
          'extern juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter();',
          'int main() {',
          '    std::unique_ptr<juce::AudioProcessor> proc(createPluginFilter());',
          '    if (!proc) return 1;',
          '    juce::AudioProcessor::BusesLayout layout;',
          '    if (!proc->isBusesLayoutSupported(layout)) return 2;',
          '    proc->prepareToPlay(48000.0, 64);',
          '    juce::AudioBuffer<float> buf;',
          '    juce::MidiBuffer midi;',
          '    proc->processBlock(buf, midi);',
          '    std::unique_ptr<juce::AudioProcessorEditor> ed(proc->createEditor());',
          '    proc->releaseResources();',
          '    return ed ? 0 : 3;',
          '}',
          '',
        ].join('\n'));
        sources.push(harness);
        const outExe = path.join(outDir, c.name + (IS_WIN ? '.exe' : ''));
        for (const d of includes) args.push('-I', d);
        args.push(...sources, '-o', outExe);

        const linkRes = spawnSync(bin, args, { cwd: pluginDir, encoding: 'utf-8', timeout: 120000 });
        assert.equal(linkRes.status, 0,
          `${c.name} failed to link:\n${linkRes.stdout ?? ''}${linkRes.stderr ?? ''}`);

        const runRes = spawnSync(outExe, [], { encoding: 'utf-8', timeout: 15000 });
        assert.equal(runRes.status, 0,
          `${c.name} linked harness exited ${runRes.status}: ${runRes.stderr ?? ''}`);
      } else if (c.type === 'standalone') {
        const outExe = path.join(outDir, c.name + (IS_WIN ? '.exe' : ''));
        for (const d of includes) args.push('-I', d);
        args.push(...sources, '-o', outExe);

        const linkRes = spawnSync(bin, args, { cwd: pluginDir, encoding: 'utf-8', timeout: 120000 });
        assert.equal(linkRes.status, 0,
          `${c.name} standalone failed to link:\n${linkRes.stdout ?? ''}${linkRes.stderr ?? ''}`);

        const runRes = spawnSync(outExe, [], { encoding: 'utf-8', timeout: 15000 });
        assert.equal(runRes.status, 0,
          `${c.name} standalone exited ${runRes.status}: ${runRes.stderr ?? ''}`);
      } else {
        // CLAP & LV2: build an actual shared MODULE library (-shared -fPIC).
        const outSo = path.join(outDir, c.name + (c.family === 'clap' ? '.clap' : '.so'));
        if (!IS_WIN) args.push('-fPIC');
        args.push('-shared');
        for (const d of includes) args.push('-I', d);
        args.push(...sources, '-o', outSo);

        const linkRes = spawnSync(bin, args, { cwd: pluginDir, encoding: 'utf-8', timeout: 120000 });
        assert.equal(linkRes.status, 0,
          `${c.name} MODULE failed to link:\n${linkRes.stdout ?? ''}${linkRes.stderr ?? ''}`);
        assert.ok(fs.existsSync(outSo), `${c.name}: expected shared library at ${outSo}`);
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

    const bd = generateStubBinaryData(pluginDir, path.join(GEN, 'JuceWebView'));
    const res = compile(
      CXX,
      pluginDir,
      path.join('Source', 'WebViewEditor.cpp'),
      [JUCE_STUB, path.join(pluginDir, 'Source'), bd.includeDir],
      '-std=c++20',
      CXX_WARNINGS,
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
