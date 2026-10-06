// Artefact discovery — what `audio_plugin_validate` can actually find in a build
// tree.
//
// The defect this covers is easy to miss because the README's own examples all
// happen to dodge it. `templates/juce/CMakeLists.txt` sets
// `PRODUCT_NAME "{{PLUGIN_DISPLAY_NAME}}"`, and `displayName()` title-cases the
// name and turns `_`/`-` into spaces. JUCE then names the *artefact* after
// PRODUCT_NAME while the *directory* is named after the CMake target, so for
// `name="my_verb"` the tree contains:
//
//     build/plugins/my_verb/my_verb_artefacts/Release/VST3/My Verb.vst3
//
// `findPluginBinaries()` looked for `${dir}.vst3` — `my_verb.vst3` — and found
// nothing, then told the user "No plugin binaries found … run audio_plugin_build
// first". The build was fine; the search was wrong. 4 of 6 plausible names are
// affected (`MyVerb` and `Phaser9000` are not, because displayName() is the
// identity for them).
//
// Ground truth for the layout, from JUCE 9.0.3
// `extras/Build/CMake/JUCEUtils.cmake`:
//   * `_juce_set_plugin_target_properties()` puts each format's output in
//     `<…>_artefacts/<Config>/<Kind>/`.
//   * For `Standalone` specifically it sets JUCE_PLUGIN_ARTEFACT_FILE to
//     `$<TARGET_BUNDLE_DIR>` when the target is a BUNDLE (macOS → `X.app`) and
//     `$<TARGET_FILE>` otherwise (Windows → `X.exe`, Linux → `X`). So the
//     artefact is a *file inside* the directory, not the directory itself.
//   * `_juce_set_output_name()` names every format target after the shared
//     target's JUCE_PRODUCT_NAME, which `juce_add_plugin` defaults to the target
//     name but which a template may override.
//
// Method: plant a build tree on disk and drive the real tool over stdio. No
// cmake needed — discovery is pure filesystem work. PATH is pinned so
// pluginval/clap-validator are deterministically absent; a skipped validation
// still prints the artefact path, which is what these tests assert on.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-artefacts-'));
const EMPTY_BIN = path.join(ROOT, 'bin');
// POSIX-only, like the other PATH fixtures in this suite. Deliberately NOT
// process.env.PATH: pluginval and clap-validator are exactly what an audio
// developer has installed, and "absent" must be deterministic here.
const SYS_PATH = '/usr/bin' + path.delimiter + '/bin';

const ALL_FORMATS = ['VST3', 'CLAP', 'LV2', 'AudioUnit', 'Standalone'];

// Create a project whose build tree contains the given artefacts.
// `entries` maps "<pluginDir>/<Format>/<relative artefact path>" to 'dir' |
// 'file' | 'exe' (a file with the executable bit).
function plantProject(name, entries) {
  const proj = path.join(ROOT, name);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.22)\nproject(${name})\n`);
  fs.writeFileSync(path.join(proj, 'apc-mcp.json'), JSON.stringify({
    buildDir: 'build',
    config: 'Release',
    validateFormats: ALL_FORMATS,
  }));

  for (const [rel, kind] of Object.entries(entries)) {
    const full = path.join(proj, 'build', 'plugins', rel);
    if (kind === 'dir') {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, kind === 'exe' ? '#!/bin/sh\nexit 0\n' : 'artefact\n');
      if (kind === 'exe') fs.chmodSync(full, 0o755);
    }
  }
  return proj;
}

// Run audio_plugin_validate over a planted project and return its text.
async function validate(proj) {
  const r = await call('audio_plugin_validate',
    { projectPath: proj, config: 'Release', format: 'all' },
    { env: { ...process.env, PATH: EMPTY_BIN + path.delimiter + SYS_PATH } });
  assert.equal(r.protocolError, undefined,
    `protocol error: ${JSON.stringify(r.protocolError)?.slice(0, 300)}`);
  return r.text || '';
}

// The report prints every discovered artefact as `path` in backticks.
function discoveredPaths(text) {
  return [...text.matchAll(/^`(.+)`$/gm)].map(m => m[1]);
}

before(() => { fs.mkdirSync(EMPTY_BIN, { recursive: true }); });
after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

describe('artefact discovery (findPluginBinaries)', () => {
  it('finds a VST3 artefact whose name differs from its directory', async () => {
    // name="my_verb" → PRODUCT_NAME "My Verb" → "My Verb.vst3"
    const proj = plantProject('p-vst3-renamed', {
      'my_verb/my_verb_artefacts/Release/VST3/My Verb.vst3': 'dir',
    });
    const text = await validate(proj);
    const paths = discoveredPaths(text);
    assert.equal(paths.length, 1, `expected exactly one artefact, got: ${text.slice(0, 400)}`);
    assert.ok(paths[0].endsWith(path.join('VST3', 'My Verb.vst3')),
      `wrong artefact path: ${paths[0]}`);
    assert.doesNotMatch(text, /No plugin binaries found/,
      'the build succeeded; the search must not claim otherwise');
  });

  it('finds a kebab-case plugin\'s VST3 artefact', async () => {
    const proj = plantProject('p-vst3-kebab', {
      'my-verb/my-verb_artefacts/Release/VST3/My Verb.vst3': 'dir',
    });
    const paths = discoveredPaths(await validate(proj));
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith('My Verb.vst3'), paths[0]);
  });

  it('still finds a CamelCase artefact that matches its directory', async () => {
    // Regression guard: displayName() is the identity here, so this always worked.
    const proj = plantProject('p-vst3-camel', {
      'MyVerb/MyVerb_artefacts/Release/VST3/MyVerb.vst3': 'dir',
    });
    const paths = discoveredPaths(await validate(proj));
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith(path.join('VST3', 'MyVerb.vst3')), paths[0]);
  });

  it('finds a macOS Standalone .app bundle, not the containing directory', async () => {
    const proj = plantProject('p-standalone-mac', {
      'demo/demo_artefacts/Release/Standalone/Demo.app/Contents/MacOS/Demo': 'exe',
      'demo/demo_artefacts/Release/Standalone/Demo.app/Contents/Info.plist': 'file',
    });
    const paths = discoveredPaths(await validate(proj));
    const standalone = paths.filter(p => p.includes('Standalone'));
    assert.equal(standalone.length, 1, `expected one Standalone artefact, got: ${paths.join(' | ')}`);
    assert.ok(standalone[0].endsWith(path.join('Standalone', 'Demo.app')),
      `JUCE sets the macOS artefact to TARGET_BUNDLE_DIR, so it must be the .app: ${standalone[0]}`);
  });

  it('finds a Windows Standalone .exe', async () => {
    const proj = plantProject('p-standalone-win', {
      'demo/demo_artefacts/Release/Standalone/Demo.exe': 'file',
    });
    const paths = discoveredPaths(await validate(proj));
    const standalone = paths.filter(p => p.includes('Standalone'));
    assert.equal(standalone.length, 1, paths.join(' | '));
    assert.ok(standalone[0].endsWith(path.join('Standalone', 'Demo.exe')), standalone[0]);
  });

  it('finds a Linux Standalone executable with no extension', async () => {
    const proj = plantProject('p-standalone-linux', {
      'demo/demo_artefacts/Release/Standalone/Demo': 'exe',
    });
    const paths = discoveredPaths(await validate(proj));
    const standalone = paths.filter(p => p.includes('Standalone'));
    assert.equal(standalone.length, 1, paths.join(' | '));
    assert.ok(standalone[0].endsWith(path.join('Standalone', 'Demo')), standalone[0]);
  });

  it('does not report a non-executable stray file as a Standalone binary', async () => {
    const proj = plantProject('p-standalone-stray', {
      'demo/demo_artefacts/Release/Standalone/README.txt': 'file',
      'demo/demo_artefacts/Release/Standalone/Demo': 'exe',
    });
    const paths = discoveredPaths(await validate(proj)).filter(p => p.includes('Standalone'));
    assert.equal(paths.length, 1, `only the executable should be reported: ${paths.join(' | ')}`);
    assert.ok(paths[0].endsWith('Demo'), paths[0]);
  });

  it('finds an AudioUnit .component bundle, reported as "AudioUnit"', async () => {
    // JUCE's artefact directory is its own `kind` string `AU` (from
    // `_juce_get_platform_plugin_kinds()`), NOT the user-facing `AudioUnit` that
    // apc-mcp.json's `validateFormats` uses. The previous code looked in an
    // `AudioUnit/` directory that JUCE never creates, so AU artefacts were
    // undiscoverable at all. The fixture below is the real layout.
    const proj = plantProject('p-au', {
      'my_verb/my_verb_artefacts/Release/AU/My Verb.component/Contents/MacOS/My Verb': 'exe',
    });
    const text = await validate(proj);
    const paths = discoveredPaths(text).filter(p => p.includes(path.sep + 'AU' + path.sep));
    assert.equal(paths.length, 1, paths.join(' | '));
    assert.ok(paths[0].endsWith(path.join('AU', 'My Verb.component')),
      'the artefact is the .component bundle: ' + paths[0]);
    // The user-facing label must still be the readable one from validateFormats.
    assert.match(text, /\[AudioUnit\]/,
      'expected the label "AudioUnit", got: ' + text.slice(0, 300));
  });

  it('finds the LV2 bundle inside the LV2 directory, not the directory itself', async () => {
    const proj = plantProject('p-lv2', {
      'my_verb/my_verb_artefacts/Release/LV2/my_verb.lv2/manifest.ttl': 'file',
      'my_verb/my_verb_artefacts/Release/LV2/my_verb.lv2/my_verb.so': 'exe',
    });
    const paths = discoveredPaths(await validate(proj)).filter(p => p.includes('LV2'));
    assert.equal(paths.length, 1, paths.join(' | '));
    assert.ok(paths[0].endsWith(path.join('LV2', 'my_verb.lv2')),
      `the bundle is the .lv2 directory: ${paths[0]}`);
  });

  it('still finds a CLAP bundle', async () => {
    // Regression guard: the CLAP branch already scanned the directory.
    const proj = plantProject('p-clap', {
      'my-clap/my-clap_artefacts/Release/CLAP/my-clap.clap/Contents/MacOS/my-clap': 'exe',
    });
    const paths = discoveredPaths(await validate(proj)).filter(p => p.includes('CLAP'));
    assert.equal(paths.length, 1, paths.join(' | '));
    assert.ok(paths[0].endsWith(path.join('CLAP', 'my-clap.clap')), paths[0]);
  });

  it('finds every format of a multi-format build at once', async () => {
    const proj = plantProject('p-all', {
      'tape_echo/tape_echo_artefacts/Release/VST3/Tape Echo.vst3': 'dir',
      'tape_echo/tape_echo_artefacts/Release/CLAP/tape_echo.clap/manifest.ttl': 'file',
      'tape_echo/tape_echo_artefacts/Release/LV2/tape_echo.lv2/manifest.ttl': 'file',
      'tape_echo/tape_echo_artefacts/Release/AU/Tape Echo.component/Info.plist': 'file',
      'tape_echo/tape_echo_artefacts/Release/Standalone/Tape Echo.app/Contents/Info.plist': 'file',
    });
    const text = await validate(proj);
    const paths = discoveredPaths(text);
    assert.equal(paths.length, ALL_FORMATS.length,
      `expected one artefact per format, got ${paths.length}: ${text.slice(0, 600)}`);
    // JUCE's on-disk directory names differ from apc-mcp's user-facing format
    // labels for Audio Units; assert on both so a rename on either side fails.
    const JUCE_DIR = { VST3: 'VST3', CLAP: 'CLAP', LV2: 'LV2', AudioUnit: 'AU', Standalone: 'Standalone' };
    for (const fmt of ALL_FORMATS) {
      assert.ok(paths.some(p => p.includes(path.sep + JUCE_DIR[fmt] + path.sep)),
        'no ' + fmt + ' artefact discovered under ' + JUCE_DIR[fmt] + '/. paths: ' + paths.join(' | '));
      assert.match(text, new RegExp('\\[' + fmt + '\\]'),
        'format ' + fmt + ' was not reported with its user-facing label');
    }
  });

  it('reports nothing found, without a misleading rebuild hint, when the tree is empty', async () => {
    const proj = plantProject('p-empty', {});
    fs.mkdirSync(path.join(proj, 'build'), { recursive: true });
    const text = await validate(proj);
    assert.match(text, /No plugin binaries found/, text.slice(0, 300));
    assert.doesNotMatch(text, /build directory not found/,
      'the build directory does exist, so the hint would be a lie');
  });

  it('ignores a plugin directory with no artefacts for the requested config', async () => {
    // Built for Debug, validated as Release → nothing to find, and it must not
    // silently pick up the Debug artefact instead.
    const proj = plantProject('p-wrong-config', {
      'demo/demo_artefacts/Debug/VST3/Demo.vst3': 'dir',
    });
    const text = await validate(proj);
    assert.match(text, /No plugin binaries found/, text.slice(0, 300));
    assert.doesNotMatch(text, /Debug/, 'must not fall back to another configuration');
  });
});
