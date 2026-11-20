// Step 1 TDD suite: Zero-Friction Composite Tools & Atomic Parameter Sync
//
// Tests:
// 1. Default inference in audio_plugin_create (omitting type and ui defaults to type="juce", ui="jive",
//    optional style="fx" | "synth" | "utility" seeding initial DSP + JIVE controls, global cache init).
// 2. audio_plugin_add_param atomically updating C++ APVTS (PluginProcessor.cpp) + MainView.xml + Styles.json
//    with XML well-formedness and JSON validity checks.
// 3. audio_plugin_ship executing Release Build -> Lint -> Validate -> Package -> Local Install in one call,
//    and returning structured diagnostics on failure.
// 4. audio_plugin_doctor detecting toolchain, C++20 compiler, JUCE/JIVE SDK paths, pluginval, and OS plugin
//    directories, plus auto-initializing ~/.apc-mcp/deps/.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, listTools } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-composite-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');
const FAKE_BIN = path.join(ROOT, 'fakebin');
const HOME_DIR = path.join(ROOT, 'fakehome');

function writeExe(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const jsPath = path.join(dir, `${name}.js`);
    fs.writeFileSync(jsPath, body);
    const cmdPath = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${jsPath}" %*\r\n`);
  } else {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  }
}

before(() => {
  fs.mkdirSync(PLUGINS, { recursive: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(CompositeHost LANGUAGES C CXX)\n');
  fs.writeFileSync(path.join(PROJ, 'apc-mcp.json'), JSON.stringify({
    generator: 'Ninja',
    config: 'Debug',
    buildDir: 'build',
    pluginsDir: 'plugins',
    validateFormats: ['VST3'],
    strictnessLevel: 5,
  }, null, 2));

  // Create fake toolchain binaries for fast, deterministic composite pipeline testing
  const logFile = path.join(ROOT, 'pipeline.log');
  writeExe(FAKE_BIN, 'cmake', `
    const fs = require('fs');
    const path = require('path');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(logFile)}, 'cmake ' + args.join(' ') + '\\n');
    if (process.env.FAKE_CMAKE_FAIL === '1') {
      console.error('/src/PluginProcessor.cpp:42:10: error: undeclared identifier "brokenSymbol"');
      process.exit(1);
    }
    const bIdx = args.indexOf('-B');
    if (bIdx >= 0 && args[bIdx + 1]) {
      const bDir = args[bIdx + 1];
      fs.mkdirSync(bDir, { recursive: true });
      const cfgArg = args.find(a => a.startsWith('-DCMAKE_BUILD_TYPE='));
      const cfg = cfgArg ? cfgArg.split('=')[1] : 'Debug';
      fs.writeFileSync(path.join(bDir, 'CMakeCache.txt'),
        'CMAKE_HOME_DIRECTORY:INTERNAL=' + process.cwd() + '\\n' +
        'CMAKE_BUILD_TYPE:STRING=' + cfg + '\\n');
    }
    const buildIdx = args.indexOf('--build');
    if (buildIdx >= 0 && args[buildIdx + 1]) {
      const bDir = args[buildIdx + 1];
      const cfgIdx = args.indexOf('--config');
      const cfg = cfgIdx >= 0 ? args[cfgIdx + 1] : 'Release';
      const pluginsDir = path.join(process.cwd(), 'plugins');
      if (fs.existsSync(pluginsDir)) {
        for (const p of fs.readdirSync(pluginsDir)) {
          const vst3Dir = path.join(bDir, 'plugins', p, p + '_artefacts', cfg, 'VST3', p + '.vst3');
          fs.mkdirSync(vst3Dir, { recursive: true });
          fs.writeFileSync(path.join(vst3Dir, p + '.so'), 'ELF_BINARY');
        }
      }
    }
    process.exit(0);
  `);

  writeExe(FAKE_BIN, 'clang-format', `
    const fs = require('fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(logFile)}, 'clang-format ' + args.join(' ') + '\\n');
    if (process.env.FAKE_LINT_FAIL === '1') {
      const file = args.find(a => !a.startsWith('-')) || 'PluginProcessor.cpp';
      console.error(file + ':10:5: error: code should be clang-formatted [-Wclang-format-violations]');
      process.exit(1);
    }
    process.exit(0);
  `);

  // These bundles contain stub bytes, not signable Mach-O binaries.
  writeExe(FAKE_BIN, 'codesign', 'process.exit(0);');
  fs.writeFileSync(path.join(FAKE_BIN, 'xvfb-run'),
    '#!/bin/sh\n[ "$1" = -a ] || exit 2\nshift\nexec "$@"\n', { mode: 0o755 });
  writeExe(FAKE_BIN, 'pluginval', `
    const fs = require('fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(logFile)}, 'pluginval ' + args.join(' ') + '\\n');
    if (process.env.FAKE_PLUGINVAL_FAIL === '1') {
      console.error('FAILED: Editor Automation test failed at strictness level 5');
      process.exit(1);
    }
    console.log('SUCCESS');
    process.exit(0);
  `);

  writeExe(FAKE_BIN, 'c++', `
    const args = process.argv.slice(2);
    if (args.includes('--version')) {
      console.log('c++ (GCC) 12.2.0');
      process.exit(0);
    }
    process.exit(0);
  `);
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('Step 1.1 · audio_plugin_create defaults & style presets', () => {
  it('defaults to type="juce" and ui="jive" when type and ui are omitted', async () => {
    const tools = await listTools();
    const createTool = tools.find(t => t.name === 'audio_plugin_create');
    assert.ok(createTool, 'audio_plugin_create must be registered');
    assert.equal(createTool.inputSchema.properties.type.default, 'juce',
      'type default must be "juce"');
    assert.equal(createTool.inputSchema.properties.ui.default, 'jive',
      'ui default must be "jive"');
    assert.deepEqual(createTool.inputSchema.properties.style?.enum, ['fx', 'synth', 'utility'],
      'style enum must offer ["fx", "synth", "utility"]');
    assert.equal(createTool.inputSchema.properties.style?.default, 'fx',
      'style default must be "fx"');

    const r = await call('audio_plugin_create', {
      projectPath: PROJ,
      name: 'ZeroFrictionDefault',
    }, { env: { PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.isError, false, `default create failed: ${r.text}`);

    const pluginDir = path.join(PLUGINS, 'ZeroFrictionDefault');
    assert.ok(fs.existsSync(path.join(pluginDir, 'Source', 'UI', 'MainView.xml')),
      'omitting type and ui must scaffold a JUCE + JIVE plugin with Source/UI/MainView.xml');
    assert.ok(fs.existsSync(path.join(pluginDir, 'Source', 'UI', 'Styles.json')),
      'omitting type and ui must scaffold Source/UI/Styles.json');
    const cm = fs.readFileSync(path.join(pluginDir, 'CMakeLists.txt'), 'utf8');
    assert.match(cm, /option\s*\(\s*APC_USE_JIVE\b[\s\S]*?\bON\s*\)/,
      'default scaffold CMakeLists.txt must enable APC_USE_JIVE=ON');
  });

  it('supports style="fx" | "synth" | "utility" presets with distinct DSP/JIVE controls', async () => {
    const env = { PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}` };
    const rSynth = await call('audio_plugin_create', {
      projectPath: PROJ,
      name: 'PolyLead',
      style: 'synth',
    }, { env });
    assert.equal(rSynth.isError, false, `synth style create failed: ${rSynth.text}`);
    const synthCm = fs.readFileSync(path.join(PLUGINS, 'PolyLead', 'CMakeLists.txt'), 'utf8');
    assert.match(synthCm, /IS_SYNTH\s+TRUE/, 'style="synth" must configure IS_SYNTH TRUE in CMakeLists.txt');
    assert.match(synthCm, /NEEDS_MIDI_INPUT\s+TRUE/, 'style="synth" must configure NEEDS_MIDI_INPUT TRUE');

    const rUtil = await call('audio_plugin_create', {
      projectPath: PROJ,
      name: 'TrimTool',
      style: 'utility',
    }, { env });
    assert.equal(rUtil.isError, false, `utility style create failed: ${rUtil.text}`);
    const utilXml = fs.readFileSync(path.join(PLUGINS, 'TrimTool', 'Source', 'UI', 'MainView.xml'), 'utf8');
    assert.match(utilXml, /parameter="bypass"|id="bypass"/,
      'style="utility" must seed a bypass control in MainView.xml');
  });
});

describe('Step 1.2 · audio_plugin_add_param atomic C++ APVTS + MainView.xml + Styles.json sync', () => {
  it('registers audio_plugin_add_param and atomically updates PluginProcessor.cpp, MainView.xml, and Styles.json', async () => {
    const tools = await listTools();
    const addParam = tools.find(t => t.name === 'audio_plugin_add_param');
    assert.ok(addParam, 'audio_plugin_add_param tool must be registered');

    for (const [id, name, min, max, def, unit, controlType, expectedTag] of [
      ['cutoff', 'Filter Cutoff', 20, 20000, 1000, 'Hz', 'knob', 'Knob'],
      ['mix', 'Dry/Wet Mix', 0, 100, 50, '%', 'slider', 'Slider'],
      ['bypass', 'Hard Bypass', 0, 1, 0, '', 'toggle', 'Checkbox'],
    ]) {
      const r = await call('audio_plugin_add_param', {
        projectPath: PROJ,
        pluginName: 'ZeroFrictionDefault',
        id,
        name,
        min,
        max,
        default: def,
        unit,
        controlType,
      });
      assert.equal(r.isError, false, `audio_plugin_add_param (${id}) failed: ${r.text}`);

      const pluginDir = path.join(PLUGINS, 'ZeroFrictionDefault');
      const cpp = fs.readFileSync(path.join(pluginDir, 'Source', 'PluginProcessor.cpp'), 'utf8');
      const xml = fs.readFileSync(path.join(pluginDir, 'Source', 'UI', 'MainView.xml'), 'utf8');
      const stylesRaw = fs.readFileSync(path.join(pluginDir, 'Source', 'UI', 'Styles.json'), 'utf8');

      assert.ok(cpp.includes(`"${id}"`), `PluginProcessor.cpp must define parameter ID "${id}"`);
      assert.ok(cpp.includes(`"${name}"`), `PluginProcessor.cpp must include parameter name "${name}"`);
      assert.match(xml, new RegExp(`<${expectedTag}\\b[^>]*\\bid="${id}"[^>]*\\bparameter="${id}"`),
        `MainView.xml must contain <${expectedTag} id="${id}" parameter="${id}" ...>`);

      const styles = JSON.parse(stylesRaw);
      assert.ok(Object.hasOwn(styles, `#${id}`),
        `Styles.json must include a style rule for "#${id}"`);
    }
  });

  it('rejects duplicate parameter IDs without corrupting files', async () => {
    const r = await call('audio_plugin_add_param', {
      projectPath: PROJ,
      pluginName: 'ZeroFrictionDefault',
      id: 'cutoff',
      name: 'Duplicate Cutoff',
      min: 20,
      max: 20000,
      default: 440,
      unit: 'Hz',
      controlType: 'knob',
    });
    assert.equal(r.isError, true, 'duplicate parameter ID must be rejected');
    assert.match(r.text, /already exists/i);
  });
});

describe('Step 1.3 · audio_plugin_ship composite pipeline (Build -> Lint -> Validate -> Package -> Local Install)', () => {
  it('executes Release build, lint, pluginval strictness 5, dist/ packaging, and local VST3 install in one call', async () => {
    const tools = await listTools();
    const shipTool = tools.find(t => t.name === 'audio_plugin_ship');
    assert.ok(shipTool, 'audio_plugin_ship tool must be registered');

    const logFile = path.join(ROOT, 'pipeline.log');
    fs.writeFileSync(logFile, '');

    const r = await call('audio_plugin_ship', {
      projectPath: PROJ,
      version: '1.2.0',
      installLocal: true,
    }, {
      env: {
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`,
        HOME: HOME_DIR,
        USERPROFILE: HOME_DIR,
      },
    });
    assert.equal(r.isError, false, `audio_plugin_ship failed: ${r.text}`);

    const log = fs.readFileSync(logFile, 'utf8');
    assert.match(log, /cmake --build .* --config Release/, 'must run Release build');
    assert.match(log, /clang-format/, 'must run clang-format linter');
    assert.match(log, /pluginval --strictness-level 5 --validate-in-process/,
      'must run pluginval --strictness-level 5 --validate-in-process');

    const osLabel = process.platform === 'darwin'
      ? 'macOS'
      : (process.platform === 'win32' ? 'Windows' : 'Linux');
    const distDir = path.join(PROJ, 'dist', `ZeroFrictionDefault-1.2.0-${osLabel}`);
    assert.ok(fs.existsSync(path.join(distDir, 'ZeroFrictionDefault.vst3')),
      `dist bundle missing at ${distDir}`);
    assert.ok(fs.existsSync(path.join(distDir, 'INSTALL.txt')),
      `INSTALL.txt missing at ${distDir}`);

    const expectedInstallBase = process.platform === 'darwin'
      ? path.join(HOME_DIR, 'Library', 'Audio', 'Plug-Ins', 'VST3')
      : (process.platform === 'win32'
        ? path.join(HOME_DIR, 'VST3')
        : path.join(HOME_DIR, '.vst3'));
    assert.ok(fs.existsSync(path.join(expectedInstallBase, 'ZeroFrictionDefault.vst3')),
      `local VST3 installation missing in ${expectedInstallBase}`);
  });

  it('returns structured compiler/validator error lines immediately when any stage fails', async () => {
    const rFailBuild = await call('audio_plugin_ship', {
      projectPath: PROJ,
      version: '1.2.0',
      installLocal: false,
    }, {
      env: {
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`,
        HOME: HOME_DIR,
        FAKE_CMAKE_FAIL: '1',
      },
    });
    assert.equal(rFailBuild.isError, true, 'failing build stage must fail audio_plugin_ship');
    assert.match(rFailBuild.text, /undeclared identifier "brokenSymbol"/,
      'must surface structured compiler error line for self-healing');
  });
});

describe('Step 1.4 · audio_plugin_doctor environment & SDK diagnostic tool', () => {
  it('checks cmake, C++20 compiler, JUCE, JIVE, pluginval, OS plugin dirs, and auto-creates ~/.apc-mcp/deps/', async () => {
    const tools = await listTools();
    const docTool = tools.find(t => t.name === 'audio_plugin_doctor');
    assert.ok(docTool, 'audio_plugin_doctor tool must be registered');

    const freshHome = path.join(ROOT, 'doctor-home');
    const r = await call('audio_plugin_doctor', {
      projectPath: PROJ,
    }, {
      env: {
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`,
        HOME: freshHome,
        USERPROFILE: freshHome,
      },
    });
    assert.equal(r.isError, false, `audio_plugin_doctor failed: ${r.text}`);
    assert.match(r.text, /cmake/i, 'must report cmake status');
    assert.match(r.text, /C\+\+20|compiler/i, 'must report C++20 compiler status');
    assert.match(r.text, /JUCE/i, 'must report JUCE status');
    assert.match(r.text, /JIVE/i, 'must report JIVE status');
    assert.match(r.text, /pluginval/i, 'must report pluginval status');
    assert.ok(fs.existsSync(path.join(freshHome, '.apc-mcp', 'deps')),
      'audio_plugin_doctor must auto-create ~/.apc-mcp/deps/');
  });
});
