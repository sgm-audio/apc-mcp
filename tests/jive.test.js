// TDD tests for production-ready JUCE scaffolds, dist/ packaging, pinned
// deterministic dependencies, strict warnings, and first-class JIVE UI support.
//
// Runs with no network and no SDK checkouts (structural + schema + C++20 stub
// compile/link checks). For full CMake + real JUCE/JIVE + pluginval binary
// verification, run `scripts/smoke-jive.mjs`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, listTools } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-jive-test-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');

function readTree(dir) {
  const files = new Map();
  (function walk(d, rel = '') {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else files.set(r, fs.readFileSync(abs, 'utf8'));
    }
  })(dir);
  return files;
}

function cmakeCode(text) {
  return text.split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

function cppCode(text) {
  return text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

before(() => {
  fs.mkdirSync(PLUGINS, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(jive_test_host)\n');
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('audio_plugin_create JIVE tool schema', () => {
  it('advertises ui="jive" in the audio_plugin_create inputSchema', async () => {
    const tools = await listTools();
    const create = tools.find(t => t.name === 'audio_plugin_create');
    assert.ok(create, 'audio_plugin_create tool missing');
    const uiEnum = create.inputSchema?.properties?.ui?.enum ?? [];
    assert.ok(uiEnum.includes('jive'),
      `audio_plugin_create ui enum must include "jive", got: ${JSON.stringify(uiEnum)}`);
    assert.ok(uiEnum.includes('generic') && uiEnum.includes('webview'),
      `existing ui options must remain intact, got: ${JSON.stringify(uiEnum)}`);
  });
});

describe('plain JUCE scaffold: deterministic deps, warnings-as-errors, portability & dist/ packaging', () => {
  /** @type {Map<string, string>} */
  let files;

  before(async () => {
    const r = await call('audio_plugin_create', {
      projectPath: PROJ, name: 'PlainJucePkg', type: 'juce', ui: 'generic', vendor: 'Acme',
    });
    assert.equal(r.isError, false, `plain JUCE scaffold failed: ${r.text}`);
    files = readTree(path.join(PLUGINS, 'PlainJucePkg'));
  });

  it('pins JUCE to an exact 40-char commit SHA with local _tools/JUCE & FETCHCONTENT_FULLY_DISCONNECTED support', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.match(cm, /_tools\/JUCE\/CMakeLists\.txt/, 'must support local _tools/JUCE override');
    assert.match(cm, /FetchContent_Declare\s*\(\s*JUCE\b/, 'must support FetchContent fallback for JUCE');
    assert.match(cm, /\b[0-9a-f]{40}\b/, 'JUCE FetchContent must be pinned to a 40-char commit SHA');
    assert.doesNotMatch(cm, /GIT_TAG\s+"?(?:main|master|develop|HEAD)"?/i,
      'must never fetch unpinned branch names');
    assert.match(cm, /FETCHCONTENT_FULLY_DISCONNECTED/,
      'must explicitly support FETCHCONTENT_FULLY_DISCONNECTED');
  });

  it('keeps JIVE disabled without linking JIVE or clobbering sibling plugins\' APC_USE_JIVE cache', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.match(cm, /\bAPC_USE_JIVE=0\b/,
      'plain JUCE template must define APC_USE_JIVE=0 on its target');
    assert.doesNotMatch(cm, /option\s*\(\s*APC_USE_JIVE\b/,
      'plain JUCE template must not set a global APC_USE_JIVE cache option that overrides sibling JIVE plugins');
    assert.ok(!cm.includes('jive::jive_layouts') && !cm.includes('jive::jive_style_sheets'),
      'JIVE must never be linked in plain JUCE scaffolds');
  });

  it('enables warnings-as-errors (-Wall -Wextra -Werror / /W4 /WX) on generated plugin sources', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.ok(cm.includes('-Wall') && cm.includes('-Wextra') && cm.includes('-Werror'),
      'plain JUCE CMakeLists must enable -Wall -Wextra -Werror on generated sources');
    assert.ok(cm.includes('/W4') && cm.includes('/WX'),
      'plain JUCE CMakeLists must enable /W4 /WX on MSVC');
  });

  it('configures static MSVC runtime (/MT), macOS universal support, and dist/ packaging target', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.match(cm, /CMAKE_MSVC_RUNTIME_LIBRARY[\s\S]*MultiThreaded\$</,
      'Release builds must statically link MSVC runtime (/MT via MultiThreaded$<$<CONFIG:Debug>:Debug>)');
    assert.match(cm, /CMAKE_OSX_ARCHITECTURES/,
      'must support universal macOS binaries via CMAKE_OSX_ARCHITECTURES');
    assert.match(cm, /dist/, 'must stage clean plugin bundles into a predictable dist/ directory');
    assert.match(cm, /PlainJucePkg_package/, 'must expose a <PluginName>_package target');
  });
});

describe('JUCE + JIVE scaffold (ui="jive"): template files, CMake plumbing, hot-reload & binary data', () => {
  /** @type {Map<string, string>} */
  let files;

  before(async () => {
    const r = await call('audio_plugin_create', {
      projectPath: PROJ,
      name: 'JiveGain',
      type: 'juce',
      ui: 'jive',
      vendor: 'Acme Audio',
      description: 'Declarative JIVE gain plugin',
    });
    assert.equal(r.isError, false, `JIVE scaffold failed: ${r.text}`);
    files = readTree(path.join(PLUGINS, 'JiveGain'));
  });

  it('scaffolds the required source and UI files with zero unresolved placeholders', () => {
    for (const rel of [
      'CMakeLists.txt',
      'Source/PluginProcessor.h',
      'Source/PluginProcessor.cpp',
      'Source/PluginEditor.h',
      'Source/PluginEditor.cpp',
      'Source/UI/MainView.xml',
      'Source/UI/Styles.json',
    ]) {
      assert.ok(files.has(rel), `missing expected JIVE scaffold file: ${rel}`);
    }
    for (const [rel, content] of files) {
      const left = content.match(/\{\{[^}]*\}\}/g);
      assert.equal(left, null, `${rel} contains unresolved placeholders: ${JSON.stringify(left)}`);
    }
  });

  it('resolves JIVE via _tools/JIVE or JIVE_DIR before pinned FetchContent and guards on APC_USE_JIVE', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.match(cm, /option\s*\(\s*APC_USE_JIVE\b[\s\S]*?\bON\s*\)/,
      'JIVE scaffold must default option(APC_USE_JIVE ... ON)');
    assert.match(cm, /if\s*\(\s*APC_USE_JIVE\s*\)/, 'JIVE integration must be guarded by if(APC_USE_JIVE)');
    assert.match(cm, /_tools\/JIVE\/CMakeLists\.txt/, 'must support local _tools/JIVE override');
    assert.match(cm, /ENV\{JIVE_DIR\}/, 'must support JIVE_DIR environment variable override');
    assert.match(cm, /FetchContent_Declare\s*\(\s*JIVE\b/, 'must support pinned FetchContent fallback for JIVE');
    const shas = cm.match(/\b[0-9a-f]{40}\b/g) ?? [];
    assert.ok(shas.length >= 2, `expected pinned 40-char SHAs for both JUCE and JIVE, found ${shas.length}`);
    assert.doesNotMatch(cm, /GIT_TAG\s+"?(?:main|master|develop|HEAD)"?/i,
      'must never fetch unpinned branch names');
    assert.match(cm, /jive::jive_layouts/, 'must link jive::jive_layouts when APC_USE_JIVE=ON');
    assert.match(cm, /jive::jive_style_sheets/, 'must link jive::jive_style_sheets when APC_USE_JIVE=ON');
    assert.match(cm, /JIVE_IS_PLUGIN_PROJECT=1/, 'must define JIVE_IS_PLUGIN_PROJECT=1 when JIVE is enabled');
    assert.match(cm, /juce_add_binary_data\s*\(\s*JiveGain_JiveData\b/,
      'must embed MainView.xml and Styles.json via juce_add_binary_data for Release builds');
    assert.match(cm, /Source\/UI\/MainView\.xml/, 'BinaryData must include Source/UI/MainView.xml');
    assert.match(cm, /Source\/UI\/Styles\.json/, 'BinaryData must include Source/UI/Styles.json');
  });

  it('enables warnings-as-errors, MSVC static runtime, macOS universal support, and dist/ packaging', () => {
    const cm = cmakeCode(files.get('CMakeLists.txt'));
    assert.ok(cm.includes('-Wall') && cm.includes('-Wextra') && cm.includes('-Werror'),
      'JIVE CMakeLists must enable -Wall -Wextra -Werror on generated sources');
    assert.ok(cm.includes('/W4') && cm.includes('/WX'),
      'JIVE CMakeLists must enable /W4 /WX on MSVC');
    assert.match(cm, /CMAKE_MSVC_RUNTIME_LIBRARY[\s\S]*MultiThreaded\$</,
      'Release builds must statically link MSVC runtime');
    assert.match(cm, /CMAKE_OSX_ARCHITECTURES/,
      'must support universal macOS binaries via CMAKE_OSX_ARCHITECTURES');
    assert.match(cm, /JiveGain_package/, 'must expose a JiveGain_package target for dist/');
  });

  it('ships valid MainView.xml with root <Component>, title label, and APVTS-bound <Slider>', () => {
    const xml = files.get('Source/UI/MainView.xml');
    assert.match(xml, /<Component\b/, 'MainView.xml must have a <Component> root');
    assert.match(xml, /style\s*=\s*"Styles\.json"/, 'MainView.xml must reference Styles.json');
    assert.match(xml, /<Text\b[^>]*id="title"[^>]*>JiveGain<\/Text>/, 'MainView.xml must render the plugin title');
    assert.match(xml, /<Slider\b[^>]*parameter\s*=\s*"gain"/,
      'MainView.xml must bind a <Slider> to the APVTS "gain" parameter');
  });

  it('ships valid parseable Styles.json defining colors and typography', () => {
    const raw = files.get('Source/UI/Styles.json');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, 'Styles.json must be valid JSON');
    assert.ok(parsed && typeof parsed === 'object', 'Styles.json must parse to an object');
    assert.ok('background' in parsed && 'foreground' in parsed,
      'Styles.json must define background and foreground colors');
    assert.ok('font-size' in parsed, 'Styles.json must define typography');
  });

  it('wires PluginEditor with jive::Interpreter, autoAttachParameters, Debug SourceRoot hot-reload, and Release BinaryData', () => {
    const procH = cppCode(files.get('Source/PluginProcessor.h'));
    const procCpp = cppCode(files.get('Source/PluginProcessor.cpp'));
    const edH = cppCode(files.get('Source/PluginEditor.h'));
    const edCpp = cppCode(files.get('Source/PluginEditor.cpp'));

    assert.match(procH, /juce::AudioProcessorValueTreeState/, 'Processor must own an APVTS');
    assert.match(procCpp, /juce::ParameterID\s*\{\s*"gain"\s*,\s*1\s*\}/,
      'APVTS must declare gain parameter with ParameterID version hint 1');
    assert.match(procCpp, /#if\s+APC_USE_JIVE/, 'Processor must gate JIVE editor behind APC_USE_JIVE');

    assert.match(edH, /jive::Interpreter/, 'PluginEditor must own a jive::Interpreter');
    assert.match(edH, /jive::LookAndFeel/, 'PluginEditor must attach a jive::LookAndFeel');
    assert.match(edH, /jive::GuiItem/, 'PluginEditor must manage a jive::GuiItem view');
    assert.match(edCpp, /autoAttachParameters\s*\(/, 'PluginEditor must bind parameters via autoAttachParameters');
    assert.match(edCpp, /#if\s+JUCE_DEBUG/, 'PluginEditor must gate disk hot-reload under #if JUCE_DEBUG');
    assert.match(edCpp, /jive::SourceRoot/, 'Debug builds must configure jive::SourceRoot for hot-reload');
    assert.match(edCpp, /#include\s+[<"]BinaryData\.h[>"]/, 'Release builds must embed UI via BinaryData.h');
    assert.match(edCpp, /MainView_xml/, 'Release builds must load embedded MainView_xml');
    assert.match(edCpp, /Styles_json/, 'Release builds must load embedded Styles_json');
  });
});
