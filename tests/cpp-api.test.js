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
// transcription of the JUCE 9 API surface (see the banner in that file).
// CLAP sources are checked against the real free-audio/clap headers when
// APC_CLAP_INCLUDE points at a checkout's include/ directory — CI does this.

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

// Locate a C++20 compiler without spawning a shell.
function findCompiler() {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['g++.exe', 'clang++.exe'] : ['g++', 'clang++'];
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

const CXX = findCompiler();
const HAVE_CLAP = CLAP_INCLUDE !== '' && fs.existsSync(path.join(CLAP_INCLUDE, 'clap', 'clap.h'));

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cxx-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');

const CASES = [
  { name: 'JuceGeneric', type: 'juce', ui: 'generic', family: 'juce' },
  { name: 'JuceWebView', type: 'juce', ui: 'webview', family: 'juce' },
  { name: 'Vst3WebView', type: 'vst3', ui: 'webview', family: 'juce' },
  { name: 'ClapPlugin',  type: 'clap', ui: 'generic', family: 'clap' },
];

function compile(cwd, file, includeDirs) {
  const args = ['-std=c++20', '-fsyntax-only', '-Wall'];
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

describe('scaffolded C++ compiles against the documented API', () => {
  it('a C++ compiler is available', t => {
    if (!CXX) t.skip('no g++/clang++ on PATH — install one to run the compile checks');
    assert.ok(CXX);
  });

  for (const c of CASES) {
    it(`${c.name} (${c.type}/${c.ui}) sources are syntactically valid C++20`, t => {
      if (!CXX) return t.skip('no C++ compiler available');

      const dir = path.join(PLUGINS, c.name, 'Source');
      const sources = fs.readdirSync(dir).filter(f => f.endsWith('.cpp'));
      assert.ok(sources.length > 0, `${c.name}: no .cpp files were scaffolded`);

      // CLAP sources need the real CLAP headers; skip rather than fake them.
      if (c.family === 'clap' && !HAVE_CLAP) {
        return t.skip('set APC_CLAP_INCLUDE to a free-audio/clap include/ dir to check CLAP sources');
      }

      const includes = c.family === 'clap' ? [CLAP_INCLUDE, dir] : [JUCE_STUB, dir];

      for (const src of sources) {
        const res = compile(path.join(PLUGINS, c.name), path.join('Source', src), includes);
        const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
        assert.equal(res.status, 0,
          `${c.name}/${src} failed to compile${res.error ? ` (${res.error.message})` : ''}:\n${output}`);
      }
    });
  }

  it('CLAP headers were available for the CLAP case', t => {
    if (!CXX) return t.skip('no C++ compiler available');
    if (!HAVE_CLAP) {
      return t.skip('APC_CLAP_INCLUDE not set — CI clones free-audio/clap and exports it');
    }
    assert.ok(fs.existsSync(path.join(CLAP_INCLUDE, 'clap', 'entry.h')));
  });
});
