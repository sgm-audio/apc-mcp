import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call } from './helpers/mcp-client.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
const TEMP_DIRS = [];

after(() => {
  for (const dir of TEMP_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const DSP_FILES = [
  'apc_dsp.h',
  'ParamSmoother.h',
  'DenormalGuard.h',
  'LockFreeFifo.h',
  'Biquad.h',
  'Svf.h',
  'SoftClipper.h',
  'DryWet.h',
  'Oversampler2x.h',
  'CMakeLists.txt',
  'README.md',
];

const LICENSING_FILES = [
  'ApcLicense.h',
  'ApcCanonicalJson.h',
  'README.md',
];

const JUCE_TEMPLATES = ['juce', 'juce-jive', 'juce-webview', 'ara'];

describe('vendored DSP kit and licensing seam', () => {
  it('all vendored DSP and licensing files exist with attribution', () => {
    for (const file of DSP_FILES) {
      const full = path.join(TEMPLATES_DIR, 'common', 'dsp', file);
      assert.ok(fs.existsSync(full), `Missing vendored DSP file: ${full}`);
      const content = fs.readFileSync(full, 'utf8');
      assert.match(content, /Vendored from Noizefield\/audio-plugin-coder \(MIT\)/,
        `${file} is missing upstream attribution`);
    }
    for (const file of LICENSING_FILES) {
      const full = path.join(TEMPLATES_DIR, 'common', 'licensing', file);
      assert.ok(fs.existsSync(full), `Missing vendored licensing file: ${full}`);
      const content = fs.readFileSync(full, 'utf8');
      assert.match(content, /Vendored from Noizefield\/audio-plugin-coder \(MIT\)/,
        `${file} is missing upstream attribution`);
    }
  });

  it('every JUCE template CMakeLists wires APC_USE_DSP_KIT and APC_USE_LICENSE_SEAM', () => {
    for (const tpl of JUCE_TEMPLATES) {
      const cmakePath = path.join(TEMPLATES_DIR, tpl, 'CMakeLists.txt');
      const content = fs.readFileSync(cmakePath, 'utf8');
      assert.match(content, /option\(\s*APC_USE_DSP_KIT\s+"[^"]*"\s+ON\s*\)/,
        `${tpl}/CMakeLists.txt missing APC_USE_DSP_KIT option (default ON)`);
      assert.match(content, /option\(\s*APC_USE_LICENSE_SEAM\s+"[^"]*"\s+OFF\s*\)/,
        `${tpl}/CMakeLists.txt missing APC_USE_LICENSE_SEAM option (default OFF)`);
      assert.match(content, /add_subdirectory\(\s*"\$\{APC_DSP_DIR\}"/,
        `${tpl}/CMakeLists.txt missing add_subdirectory for APC_DSP_DIR`);
      assert.match(content, /target_link_libraries\(\s*\{\{PLUGIN_NAME\}\}\s+PRIVATE\s+APC::dsp\s*\)/,
        `${tpl}/CMakeLists.txt missing target_link_libraries PRIVATE APC::dsp`);
      assert.match(content, /APC_HAS_DSP_KIT=1/,
        `${tpl}/CMakeLists.txt missing APC_HAS_DSP_KIT=1`);
      assert.match(content, /APC_HAS_LICENSE_SEAM=1/,
        `${tpl}/CMakeLists.txt missing APC_HAS_LICENSE_SEAM=1`);
    }
  });

  it('scaffolded JUCE project includes common/dsp, common/licensing, and CMake options', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-dsp-scaffold-'));
    TEMP_DIRS.push(root);
    fs.writeFileSync(path.join(root, 'apc-mcp.json'), '{}\n');

    const res = await call('apc', {
      projectPath: root,
      name: 'DspCheckPlugin',
      type: 'juce',
      ui: 'generic',
      vendor: 'Acme',
    });
    assert.equal(res.isError, false, res.text);

    const pluginCmake = fs.readFileSync(
      path.join(root, 'plugins', 'DspCheckPlugin', 'CMakeLists.txt'),
      'utf8'
    );
    assert.match(pluginCmake, /option\(\s*APC_USE_DSP_KIT\s+"[^"]*"\s+ON\s*\)/);
    assert.match(pluginCmake, /option\(\s*APC_USE_LICENSE_SEAM\s+"[^"]*"\s+OFF\s*\)/);
    assert.match(pluginCmake, /target_link_libraries\(\s*DspCheckPlugin\s+PRIVATE\s+APC::dsp\s*\)/);
    assert.ok(fs.existsSync(path.join(root, 'common', 'dsp', 'CMakeLists.txt')));
    assert.ok(fs.existsSync(path.join(root, 'common', 'dsp', 'apc_dsp.h')));
    assert.ok(fs.existsSync(path.join(root, 'common', 'licensing', 'ApcLicense.h')));
    assert.ok(fs.existsSync(path.join(root, 'common', 'licensing', 'ApcCanonicalJson.h')));
  });

  it('vendored headers compile cleanly under C++20 when a compiler is available', (t) => {
    const compiler = ['c++', 'g++', 'clang++'].find((cmd) => {
      const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      return !probe.error && probe.status === 0;
    });
    if (!compiler) {
      return t.skip('No C++ compiler found on PATH');
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-dsp-cxx-'));
    TEMP_DIRS.push(root);
    const src = path.join(root, 'smoke.cpp');
    const obj = path.join(root, 'smoke.o');
    fs.writeFileSync(src, [
      '#include "apc_dsp.h"',
      '#include "ApcLicense.h"',
      'int main() {',
      '  apc::dsp::ParamSmoother smoother;',
      '  smoother.prepare(48000.0, 0.01);',
      '  return 0;',
      '}',
      '',
    ].join('\n'));

    const res = spawnSync(compiler, [
      '-std=c++20',
      '-Wall',
      '-Wextra',
      '-Werror',
      `-I${path.join(TEMPLATES_DIR, 'common', 'dsp')}`,
      `-I${path.join(TEMPLATES_DIR, 'common', 'licensing')}`,
      '-c',
      src,
      '-o',
      obj,
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0, `${compiler} failed:\n${res.stdout}\n${res.stderr}`);
  });
});
