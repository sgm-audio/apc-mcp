// Template-correctness regression tests.
//
// These exist because the scaffold templates shipped broken for two releases:
// they emitted unparseable CMake, called JUCE functions that do not exist, used
// ${PROJECT_NAME} without a project() call, and linked no JUCE modules at all.
// The old suite passed throughout, because it only asserted that the tool's
// reply *mentioned* a filename — never that the generated project was valid.
//
// Everything here is verified structurally, so it runs with no cmake, no JUCE
// and no CLAP toolchain present. API shapes were checked against JUCE 9.0.3 and
// free-audio/clap sources; see docs/archive/AUDIT.md.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, listTools } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-tpl-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');

// Valid juce_add_plugin FORMATS values, from JUCE's _juce_get_plugin_kind_name.
const JUCE_FORMATS = ['AU', 'AUv3', 'AAX', 'LV2', 'Standalone', 'Unity', 'VST', 'VST3'];

// Every scaffold permutation the schema can produce.
const PERMUTATIONS = [
  { name: 'ClapA',     type: 'clap',  ui: 'generic' },
  { name: 'JuceGen',   type: 'juce',  ui: 'generic' },
  { name: 'JuceWv',    type: 'juce',  ui: 'webview' },
  { name: 'AraFx',     type: 'ara',   ui: 'jive' },
  { name: 'Vst3Gen',   type: 'vst3',  ui: 'generic' },
  { name: 'Vst3Wv',    type: 'vst3',  ui: 'webview' },
  { name: 'my-delay',  type: 'juce',  ui: 'webview' },
  { name: 'X',         type: 'clap',  ui: 'generic' },
  // A standalone *application*, and a snake_case one at that — so it exercises
  // both the gui_app template and the displayName() divergence (PRODUCT_NAME
  // "Tone Gen" inside a directory called tone_gen). `ui` is deliberately
  // 'webview' on the second to prove the app template ignores it.
  { name: 'Lv2Gain',   type: 'lv2',   ui: 'generic' },
  { name: 'lv2_gain',  type: 'lv2',   ui: 'webview' },
  { name: 'ToneGen',   type: 'standalone', ui: 'generic' },
  { name: 'tone_gen',  type: 'standalone', ui: 'webview' },
];

const scaffolded = new Map(); // name -> { dir, files: Map<relPath, content> }

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

// Strip CMake comments so paren/keyword checks are not fooled by prose.
function cmakeCode(text) {
  return text.split('\n')
    .map(l => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

// Strip `//` line comments from C++ source. Needed for the same reason
// cmakeCode() exists: the templates explain in comments which removed or
// inapplicable APIs they avoid (START_JUCE_APPLICATION, start(), stop(),
// loadHTMLString), and a raw-text assertion cannot tell an explanation from a
// call.
function cppCode(text) {
  return text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

// First argument of a CMake command invocation, or null.
function cmakeFirstArg(code, command) {
  const m = code.match(new RegExp(`\\b${command}\\s*\\(\\s*([^\\s)]+)`));
  return m ? m[1] : null;
}

// Files listed in a target_sources(...) or juce_add_binary_data(... SOURCES ...) block.
function cmakeListedFiles(code, command) {
  const start = code.indexOf(`${command}(`);
  if (start < 0) return [];
  let depth = 0, end = -1;
  for (let i = start + command.length; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  const body = code.slice(start + command.length + 1, end);
  const fromSources = body.split(/\bSOURCES\b/).pop() ?? '';
  return fromSources
    .split(/[\s;]+/)
    .map(s => s.replace(/["()]/g, ''))
    .filter(s => s && !/^(PRIVATE|PUBLIC|INTERFACE|NAMESPACE|HEADER_NAME)$/.test(s))
    .filter(s => /[./]/.test(s));
}

before(async () => {
  fs.mkdirSync(PLUGINS, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(host)\n');

  for (const p of PERMUTATIONS) {
    const r = await call('apc', { projectPath: PROJ, ...p, vendor: 'acme' });
    assert.equal(r.isError, false, `scaffold ${p.name} (${p.type}/${p.ui}) failed: ${r.text}`);
    const dir = path.join(PLUGINS, p.name);
    assert.ok(fs.existsSync(dir), `scaffold did not create ${dir}`);
    scaffolded.set(p.name, { ...p, dir, files: readTree(dir) });
  }
});

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

// `type: clap` ignores `ui`, so JUCE-specific assertions must select on the
// template family rather than on ui alone.
const isJuce = s => s.type === 'juce' || s.type === 'vst3';
const juceOnly = ui => [...scaffolded.values()].filter(s => isJuce(s) && (!ui || s.ui === ui));
const araOnly = () => [...scaffolded.values()].filter(s => s.type === 'ara');

// `type: standalone` is a JUCE **application** (juce_add_gui_app), not a plugin.
// It has no FORMATS, no PLUGIN_CODE and no PluginProcessor, so every
// plugin-specific assertion must exclude it. Note this is NOT the same as
// excluding `clap`: several checks that used to read `if (s.type === 'clap')
// continue;` mean "JUCE plugin" and must now say so explicitly, or they silently
// assert plugin-only invariants against an app target.
const isApp = s => s.type === 'standalone';
const isLv2 = s => s.type === 'lv2';
const lv2Only = () => [...scaffolded.values()].filter(isLv2);
const appOnly = () => [...scaffolded.values()].filter(isApp);
const jucePluginOnly = () => [...scaffolded.values()].filter(s => isJuce(s));

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-01 · no unresolved template placeholders survive scaffolding', () => {
  it('every generated file is fully substituted', () => {
    for (const s of scaffolded.values()) {
      for (const [rel, content] of s.files) {
        const left = content.match(/\{\{[^}]*\}\}/g);
        assert.equal(left, null,
          `${s.name}/${s.type}/${s.ui}: ${rel} still contains ${JSON.stringify(left)}`);
      }
    }
  });

  it('no Mustache section tags remain (the {{#WEBVIEW}} regression)', () => {
    for (const s of scaffolded.values()) {
      for (const [rel, content] of s.files) {
        assert.ok(!content.includes('{{#') && !content.includes('{{/'),
          `${s.name}: ${rel} contains a Mustache section tag, which replaceTemplateVars cannot process`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-03 · each plugin gets its own CMake target name', () => {
  it('no JUCE template relies on ${PROJECT_NAME} for the plugin target', () => {
    for (const s of juceOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const target = cmakeFirstArg(cm, 'juce_add_plugin');
      assert.ok(target, `${s.name}: no juce_add_plugin call found`);
      assert.ok(!target.includes('PROJECT_NAME'),
        `${s.name}: plugin target is ${target} — it would inherit the host project's name`);
      assert.equal(target, s.name,
        `${s.name}: juce_add_plugin target "${target}" should be the plugin name`);
    }
  });

  it('no CLAP template relies on ${PROJECT_NAME} for the plugin target', () => {
    for (const s of scaffolded.values()) {
      if (s.type !== 'clap') continue;
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const target = cmakeFirstArg(cm, 'add_library');
      assert.equal(target, s.name,
        `${s.name}: add_library target "${target}" should be the plugin name`);
    }
  });

  it('two plugins scaffolded into one project do not collide', () => {
    const names = jucePluginOnly()
      .map(s => cmakeFirstArg(cmakeCode(s.files.get('CMakeLists.txt')), 'juce_add_plugin'));
    assert.ok(names.every(n => n), `every JUCE plugin needs a target name: ${names.join(', ')}`);
    assert.equal(new Set(names).size, names.length,
      `duplicate CMake target names would break configure: ${names.join(', ')}`);
  });

  it('two apps scaffolded into one project do not collide either', () => {
    const names = appOnly()
      .map(s => cmakeFirstArg(cmakeCode(s.files.get('CMakeLists.txt')), 'juce_add_gui_app'));
    assert.ok(names.every(n => n), `every app needs a juce_add_gui_app target: ${names.join(', ')}`);
    assert.equal(new Set(names).size, names.length,
      `duplicate CMake target names would break configure: ${names.join(', ')}`);
    // And an app target must not share a name with a plugin target in the same
    // project — CMake target names are global, not per-kind.
    const pluginNames = jucePluginOnly()
      .map(s => cmakeFirstArg(cmakeCode(s.files.get('CMakeLists.txt')), 'juce_add_plugin'));
    assert.equal(names.filter(n => pluginNames.includes(n)).length, 0,
      'an app and a plugin must not claim the same CMake target name');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-02/08/11/12 · JUCE templates use the real JUCE 9 CMake API', () => {
  it('never calls juce_add_webview_ui (not a JUCE function)', () => {
    for (const s of scaffolded.values()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!cm.includes('juce_add_webview_ui'),
        `${s.name}: juce_add_webview_ui does not exist in JUCE — use juce_add_binary_data`);
    }
  });

  it('never passes BINARY_DATA_ID (not a juce_add_binary_data keyword)', () => {
    for (const s of scaffolded.values()) {
      assert.ok(!cmakeCode(s.files.get('CMakeLists.txt')).includes('BINARY_DATA_ID'),
        `${s.name}: BINARY_DATA_ID is not a valid keyword; juce_add_binary_data takes NAMESPACE`);
    }
  });

  it('uses COMPANY_COPYRIGHT, not bare COPYRIGHT', () => {
    // "not clap" used to mean "JUCE"; with type=lv2 added it no longer does, so
    // select on the family explicitly.
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!/(^|\s)COPYRIGHT\s/.test(cm),
        `${s.name}: bare COPYRIGHT is silently ignored by juce_add_plugin`);
      assert.ok(cm.includes('COMPANY_COPYRIGHT'), `${s.name}: expected COMPANY_COPYRIGHT`);
    }
  });

  it('links JUCE modules (without this every juce:: symbol is undefined)', () => {
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cm.includes('target_link_libraries'),
        `${s.name}: no target_link_libraries at all`);
      assert.ok(cm.includes('juce::juce_audio_utils'),
        `${s.name}: does not link juce::juce_audio_utils`);
    }
  });

  it('passes an explicit, well-formed LV2URI instead of deriving one from COMPANY_WEBSITE', () => {
    // JUCE 9 derives LV2URI from COMPANY_WEBSITE as "<website>/plugins/<name>"
    // (JUCEUtils.cmake: _juce_set_property_if_not_set(... LV2URI ...)). This
    // template deliberately ships no COMPANY_WEBSITE, because any value would be
    // a guessed domain — so the derived default is "/plugins/<Name>", which has
    // no scheme and trips the static_assert in
    // juce_audio_plugin_client_LV2.cpp: "Your configured LV2 URI must include a
    // leading scheme specifier." That is what turned the "Scaffolded JUCE
    // builds" and "apc-val against real pluginval" CI jobs red:
    // the LV2 target is compiled even when only the VST3 artefact is validated.
    //
    // startsWithValidScheme() accepts exactly this set of prefixes.
    const prefixes = ['http://', 'https://', 'urn:'];
    const uris = new Map();
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const uri = cm.match(/(?:^|\s)LV2URI\s+"([^"]+)"/)?.[1];
      assert.ok(uri, `${s.name}: no LV2URI — JUCE would derive "/plugins/${s.name}" from the `
        + 'absent COMPANY_WEBSITE, and the LV2 wrapper refuses to compile that');
      assert.ok(prefixes.some(p => uri.startsWith(p)),
        `${s.name}: LV2URI "${uri}" would fail JUCE's startsWithValidScheme() check`);
      assert.ok(!/\s/.test(uri), `${s.name}: LV2URI "${uri}" contains whitespace`);
      // The scaffolded vendor is "acme" (see before()), so the shared URN helper
      // must have produced exactly this identity — the same one the native LV2
      // template uses for an identically named plugin.
      assert.match(uri, /^urn:[a-z0-9]{2,}:[A-Za-z0-9_]+$/,
        `${s.name}: LV2URI "${uri}" is not the sanitized urn:<vendor>:<plugin> identity`);
      assert.equal(uris.has(uri), false,
        `${s.name}: LV2URI "${uri}" is also used by ${uris.get(uri)} — hosts key sessions on it`);
      uris.set(uri, s.name);
    }
  });

  it('never invents a vendor domain or email for the metadata', () => {
    // https://<vendor-slug>.com is a guess: the slug is lower-cased from a
    // display name, so "ACME, Inc." becomes acmeinc.com, which nobody owns.
    // COMPANY_WEBSITE/COMPANY_EMAIL are rendered verbatim in the DLL properties
    // and VST3/AU metadata, so a guess ships to users. (An LV2URI is required
    // and is supplied explicitly instead — see the test above.)
    for (const s of [...jucePluginOnly(), ...appOnly()]) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!cm.includes('COMPANY_WEBSITE'),
        `${s.name}: COMPANY_WEBSITE is a guessed domain, not an owned address`);
      assert.ok(!cm.includes('COMPANY_EMAIL'),
        `${s.name}: COMPANY_EMAIL is a guessed mailbox, not an owned address`);
      const withoutGitRepo = cm.split('\n')
        .filter(l => !/^\s*GIT_REPOSITORY\s+/.test(l))
        .join('\n');
      assert.ok(!/https?:\/\/[A-Za-z0-9.-]+\.(?:com|net|org)\b/.test(withoutGitRepo),
        `${s.name}: a hard-coded vendor URL is still present in the CMakeLists`);
    }
  });

  it('guards add_subdirectory(JUCE) so multi-plugin repos can configure', () => {
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      if (!cm.includes('add_subdirectory')) continue;
      assert.ok(/if\s*\(\s*NOT\s+TARGET\s+juce::/i.test(cm),
        `${s.name}: add_subdirectory(JUCE) is unguarded — a second plugin would define juce::* targets twice`);
    }
  });

  it('declares only JUCE formats juce_add_plugin accepts', () => {
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const m = cm.match(/FORMATS\s+([A-Za-z0-9_;]+)/);
      assert.ok(m, `${s.name}: no FORMATS found`);
      for (const f of m[1].split(';')) {
        assert.ok(JUCE_FORMATS.includes(f),
          `${s.name}: "${f}" is not a valid JUCE format (valid: ${JUCE_FORMATS.join(', ')})`);
      }
    }
  });

  it('sets deterministic four-character plugin IDs', () => {
    // Plugin IDs are meaningless for an app target: juce_add_gui_app() creates no
    // plugin, so there is nothing for a host to identify.
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const mc = cm.match(/PLUGIN_MANUFACTURER_CODE\s+(\S+)/)?.[1];
      const pc = cm.match(/PLUGIN_CODE\s+(\S+)/)?.[1];
      assert.ok(mc && mc.length === 4 && /[A-Z]/.test(mc),
        `${s.name}: PLUGIN_MANUFACTURER_CODE must be 4 chars with >=1 upper-case, got "${mc}"`);
      assert.ok(pc && pc.length === 4 && pc[0] === pc[0].toUpperCase()
        && pc.slice(1) === pc.slice(1).toLowerCase(),
        `${s.name}: PLUGIN_CODE must be 4 chars, first upper-case and the rest lower, got "${pc}"`);
    }
  });

  it('emits balanced parentheses in CMakeLists.txt', () => {
    for (const s of scaffolded.values()) {
      const code = cmakeCode(s.files.get('CMakeLists.txt'));
      const open = (code.match(/\(/g) ?? []).length;
      const close = (code.match(/\)/g) ?? []).length;
      assert.equal(open, close, `${s.name}: unbalanced parentheses (${open} open, ${close} close)`);
    }
  });

  it('defines createPluginFilter(), isBusesLayoutSupported(), and using AudioProcessor::processBlock in every JUCE plugin', () => {
    for (const s of jucePluginOnly()) {
      const h = cppCode(s.files.get('Source/PluginProcessor.h'));
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /juce::AudioProcessor\s*\*\s*JUCE_CALLTYPE\s+createPluginFilter\s*\(\s*\)/,
        `${s.name}: missing createPluginFilter() — JUCE VST3/AU/LV2/Standalone wrappers cannot link without it`);
      assert.match(h, /using\s+AudioProcessor::processBlock\s*;/,
        `${s.name}: missing using AudioProcessor::processBlock; triggers -Woverloaded-virtual`);
      assert.match(h, /isBusesLayoutSupported\s*\(\s*const\s+BusesLayout\s*&[^)]*\)\s*const\s+override/,
        `${s.name}: missing isBusesLayoutSupported() override`);
      // processBlock gets the input in place, so a "pass-through" has nothing to
      // copy: the copy this assertion used to demand wrote getReadPointer(i) into
      // getWritePointer(i), i.e. one buffer onto itself. What every plugin does
      // need is the clear loop for output channels an asymmetric layout left
      // empty — skip it and those channels replay whatever the host had there.
      assert.ok(cpp.includes('for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)'),
        `${s.name}: processBlock must silence output channels that have no input`);
      assert.ok(cpp.includes('buffer.clear(i, 0, buffer.getNumSamples())'),
        `${s.name}: the clear loop must actually clear the channel it names`);
      assert.ok(!cpp.includes('getReadPointer('),
        `${s.name}: processBlock must not read a channel it is about to write — that is a self-copy`);
      if (s.ui === 'webview') {
        assert.match(cpp, /juce::ParameterID\s*\{\s*"gain"\s*,\s*1\s*\}/,
          `${s.name}: AudioParameterFloat needs ParameterID version hint >= 1 to avoid JUCE 9 AU Debug jassert`);
        // A gain applied as a bare multiply steps once per block; that is zipper
        // noise. The smoother has to be driven from prepareToPlay's sample rate
        // and read once per sample in processBlock.
        assert.ok(cpp.includes('m_gainSmoothed.reset(sampleRate, 0.02)'),
          `${s.name}: the gain smoother must be configured from the host sample rate in prepareToPlay`);
        assert.ok(cpp.includes('m_gainSmoothed.getNextValue()'),
          `${s.name}: processBlock must advance the gain smoother per sample, not read the raw parameter`);
        assert.ok(!cpp.includes('channelData[sample] * gain'),
          `${s.name}: the unsmoothed per-block multiply must be gone`);
      }
    }
  });

  it('makes JUCE plugin and standalone CMakeLists self-contained (C+CXX languages, cxx_std_20, Debug default)', () => {
    for (const s of [...jucePluginOnly(), ...appOnly()]) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(cm, /\benable_language\s*\(\s*C\s+CXX\s*\)/,
        `${s.name}: JUCE compiles C sources (zlib/png/harfbuzz), so CMakeLists must enable C and CXX`);
      assert.match(cm, /\btarget_compile_features\s*\(\s*\S+\s+PRIVATE\s+cxx_std_20\s*\)/,
        `${s.name}: must require cxx_std_20 on the target rather than assuming the root CMake sets it`);
      assert.match(cm, /set\s*\(\s*CMAKE_BUILD_TYPE\s+Debug\b/,
        `${s.name}: single-config builds need a default CMAKE_BUILD_TYPE so artefacts land under <Config>/`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('every file referenced by CMake actually exists in the scaffold', () => {
  it('target_sources entries exist', () => {
    for (const s of scaffolded.values()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      for (const f of cmakeListedFiles(cm, 'target_sources')) {
        assert.ok(s.files.has(f), `${s.name}: target_sources lists ${f} but it was not scaffolded`);
      }
    }
  });

  it('juce_add_binary_data SOURCES entries exist', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const sources = cmakeListedFiles(cm, 'juce_add_binary_data');
      assert.ok(sources.length > 0, `${s.name}: juce_add_binary_data has no SOURCES`);
      for (const f of sources) {
        assert.ok(s.files.has(f), `${s.name}: binary data lists ${f} but it was not scaffolded`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-02/15 · WebView template uses the real JUCE 9 browser API', () => {
  it('uses juce_add_binary_data with a NAMESPACE', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cm.includes('juce_add_binary_data'), `${s.name}: no juce_add_binary_data call`);
      assert.ok(/NAMESPACE\s+\S+/.test(cm), `${s.name}: binary data target has no NAMESPACE`);
    }
  });

  it('asks for a web browser backend, including static WebView2 on Windows', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(/NEEDS_WEB_BROWSER\s+TRUE/.test(cm), `${s.name}: NEEDS_WEB_BROWSER not TRUE`);
      assert.ok(/NEEDS_WEBVIEW2\s+TRUE/.test(cm), `${s.name}: NEEDS_WEBVIEW2 not TRUE`);
      assert.ok(/JUCE_WEB_BROWSER=1/.test(cm), `${s.name}: JUCE_WEB_BROWSER must be 1`);
      assert.ok(/JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1/.test(cm),
        `${s.name}: NEEDS_WEBVIEW2 TRUE requires JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1 on Windows`);
    }
  });

  it('the generic template does NOT enable the web browser', () => {
    for (const s of juceOnly('generic')) {
      if (s.type === 'clap') continue;
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(/NEEDS_WEB_BROWSER\s+FALSE/.test(cm), `${s.name}: generic UI should not need a browser`);
      assert.ok(!cm.includes('juce_add_binary_data'), `${s.name}: generic template should embed no UI assets`);
    }
  });

  it('includes BinaryData.h and references juceaide camelCase *Size constants in the CMake NAMESPACE', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const ns = cm.match(/NAMESPACE\s+(\S+)/)?.[1];
      const editor = cppCode(s.files.get('Source/WebViewEditor.cpp'));
      assert.ok(ns, `${s.name}: no NAMESPACE`);
      assert.match(editor, /#include\s+[<"]BinaryData\.h[>"]/,
        `${s.name}: WebViewEditor.cpp must include BinaryData.h (const int *Size has internal linkage)`);
      assert.ok(!editor.includes('index_html_size') && !editor.includes('extern const int'),
        `${s.name}: manual extern const int *_size forward declarations fail to link against juceaide BinaryData`);
      for (const sym of ['index_html', 'index_htmlSize', 'style_css', 'style_cssSize', 'app_js', 'app_jsSize']) {
        assert.ok(editor.includes(`${ns}::${sym}`),
          `${s.name}: WebViewEditor.cpp missing ${ns}::${sym}`);
      }
    }
  });

  it('does not call WebBrowserComponent methods that do not exist', () => {
    const gone = ['loadHTMLString', 'onPageAboutToLoad', 'storeXmlAsString'];
    for (const s of scaffolded.values()) {
      for (const [rel, content] of s.files) {
        if (!/\.(cpp|h)$/.test(rel)) continue;
        for (const api of gone) {
          // A comment explaining the removal is fine; a call is not.
          const code = cppCode(content);
          assert.ok(!code.includes(api), `${s.name}/${rel}: ${api} is not part of the JUCE 9 API`);
        }
      }
    }
  });

  it('subclasses WebBrowserComponent to override pageAboutToLoad', () => {
    for (const s of juceOnly('webview')) {
      const h = s.files.get('Source/WebViewEditor.h');
      assert.ok(/public\s+juce::WebBrowserComponent/.test(h),
        `${s.name}: pageAboutToLoad is virtual — the bridge needs a subclass`);
      assert.ok(/pageAboutToLoad[^;]*override/.test(h),
        `${s.name}: expected a pageAboutToLoad override`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('FUNC-13/20 · CLAP template targets the modern CLAP API', () => {
  const claps = () => [...scaffolded.values()].filter(s => s.type === 'clap');

  it('find_package uses the real package name (lowercase clap)', () => {
    for (const s of claps()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!/find_package\s*\(\s*CLAP\b/.test(cm),
        `${s.name}: find_package(CLAP) cannot resolve clap-config.cmake on case-sensitive filesystems`);
      assert.ok(/find_package\s*\(\s*clap\b/.test(cm), `${s.name}: expected find_package(clap ...)`);
    }
  });

  it('links the exported target "clap", not the non-existent CLAP::clap', () => {
    for (const s of claps()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!cm.includes('CLAP::clap'),
        `${s.name}: free-audio/clap exports a plain INTERFACE target named "clap"`);
      assert.ok(/target_link_libraries\s*\([^)]*\bclap\b/.test(cm),
        `${s.name}: does not link the clap target`);
    }
  });

  it('exports the clap_entry symbol via a plugin factory', () => {
    for (const s of claps()) {
      const entry = s.files.get('Source/PluginEntry.cpp');
      assert.ok(/CLAP_EXPORT\s+const\s+clap_plugin_entry_t\s+clap_entry/.test(entry),
        `${s.name}: hosts resolve the exported symbol "clap_entry"`);
      assert.ok(entry.includes('CLAP_PLUGIN_FACTORY_ID'),
        `${s.name}: entry must serve the factory via CLAP_PLUGIN_FACTORY_ID`);
      assert.ok(/clap_plugin_factory_t/.test(entry),
        `${s.name}: expected a clap_plugin_factory_t`);
      assert.ok(!/get_plugin_count\s*=\s*\[/.test(entry),
        `${s.name}: get_plugin_count belongs on the factory, not the entry (pre-1.0 API)`);
      assert.ok(entry.includes('<cstring>') || entry.includes('string.h'),
        `${s.name}: uses strcmp without including <cstring>`);
    }
  });

  it('uses clap_process_t::frames_count, not the removed "frames" field', () => {
    for (const s of claps()) {
      const cpp = s.files.get('Source/PluginProcessor.cpp');
      assert.ok(cpp.includes('frames_count'), `${s.name}: expected process->frames_count`);
      assert.ok(!/process->frames\b(?!_)/.test(cpp),
        `${s.name}: clap_process_t has no "frames" member`);
    }
  });

  it('emits a MODULE .clap binary/bundle into the artefacts layout apc-val scans', () => {
    for (const s of claps()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(cm, new RegExp(`add_library\\(\\s*${s.name}\\s+MODULE\\b`),
        `${s.name}: CLAP plugin must be a MODULE library, not SHARED`);
      const expectedDir = `plugins/${s.name}/${s.name}_artefacts/$<CONFIG>/CLAP`;
      assert.ok(cm.includes(expectedDir),
        `${s.name}: validate scans <build>/${expectedDir} — a scaffolded CLAP could never be validated`);
      assert.ok(!cm.includes(`${expectedDir}/${s.name}.clap"`),
        `${s.name}: LIBRARY_OUTPUT_DIRECTORY must not create a ${s.name}.clap/ directory on Linux/Windows`);
      assert.ok(cm.includes('BUNDLE_EXTENSION clap'), `${s.name}: macOS CFBundle needs BUNDLE_EXTENSION clap`);
      assert.ok(cm.includes('PREFIX ""') && cm.includes('SUFFIX ".clap"'),
        `${s.name}: Linux/Windows DSO must have PREFIX "" and SUFFIX ".clap"`);
    }
  });

  it('implements CLAP_EXT_AUDIO_PORTS and returns CLAP_PROCESS_CONTINUE on 0-port transport calls', () => {
    for (const s of claps()) {
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.ok(cpp.includes('CLAP_EXT_AUDIO_PORTS'),
        `${s.name}: stereo audio effect must expose CLAP_EXT_AUDIO_PORTS`);
      assert.ok(cpp.includes('clap_plugin_audio_ports_t'),
        `${s.name}: expected clap_plugin_audio_ports_t vtable`);
      assert.match(cpp, /audio_inputs_count\s*==\s*0[\s\S]{0,120}CLAP_PROCESS_CONTINUE/,
        `${s.name}: 0-port transport calls must return CLAP_PROCESS_CONTINUE, not CLAP_PROCESS_ERROR`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('schema rejects format values JUCE cannot build', () => {
  it('rejects formats="ARA"', async () => {
    const r = await call('apc',
      { projectPath: PROJ, name: 'AraNope', type: 'juce', formats: 'ARA' });
    assert.equal(r.isError, true, 'ARA is not a juce_add_plugin format');
    assert.match(r.text, /ARA/);
    assert.match(r.text, new RegExp(JUCE_FORMATS.slice(0, 3).join('|')),
      `the error should list valid formats, got: ${r.text}`);
  });

  it('rejects an invented format', async () => {
    const r = await call('apc',
      { projectPath: PROJ, name: 'BogusFmt', type: 'juce', formats: 'VST3;NotAFormat' });
    assert.equal(r.isError, true);
    assert.match(r.text, /NotAFormat/);
  });

  it('accepts a valid multi-format list', async () => {
    const r = await call('apc',
      { projectPath: PROJ, name: 'OkFormats', type: 'juce', formats: 'VST3;AU;Standalone' });
    assert.equal(r.isError, false, `valid formats were rejected: ${r.text}`);
    assert.ok(fs.existsSync(path.join(PLUGINS, 'OkFormats', 'CMakeLists.txt')));
  });

  it('advertises the dedicated ARA effect scaffold as a supported type', async () => {
    const tools = await listTools();
    const create = tools.find(t => t.name === 'apc');
    const allowed = create.inputSchema.properties.type.enum ?? [];
    assert.ok(allowed.includes('ara'), `"ara" is missing from the supported type list: ${allowed.join(', ')}`);
    assert.deepEqual(allowed, ['clap', 'vst3', 'juce', 'standalone', 'lv2', 'ara']);
  });
});

describe('JUCE ARA effect template', () => {
  it('emits the required SDK guard, effect-mode CMake block, and stable ARA IDs', () => {
    for (const s of araOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(cm, /if\s*\(\s*NOT DEFINED APC_ARA_SDK_PATH OR APC_ARA_SDK_PATH STREQUAL ""\s*\)/,
        `${s.name}: an unset APC_ARA_SDK_PATH must be rejected`);
      assert.match(cm, /message\s*\(\s*FATAL_ERROR\s+"ARA SDK path is required\. Call "\s+"juce_set_ara_sdk_path\(<path>\) before juce_add_plugin\."\s*\)/,
        `${s.name}: the missing-SDK diagnostic must identify the required JUCE setup`);
      assert.match(cm, /ARA_Library\/PlugIn\/ARAPlug\.h/,
        `${s.name}: reject SDK roots without the initialized ARA_Library submodule`);
      assert.match(cm, /ARA_API\/ARAInterface\.h/,
        `${s.name}: reject SDK roots without the initialized ARA_API submodule`);
      const sdkCall = cm.search(/\n\s*juce_set_ara_sdk_path\(/);
      const pluginCall = cm.indexOf('juce_add_plugin(');
      assert.ok(sdkCall >= 0 && sdkCall < pluginCall,
        `${s.name}: juce_set_ara_sdk_path must precede juce_add_plugin`);
      const call = cm.match(/juce_add_plugin\s*\(\s*AraFx([\s\S]*?)\n\)/)?.[1] ?? '';
      assert.match(call, /FORMATS\s+VST3\s+AU\b/,
        `${s.name}: ARA uses VST3 and AU as formats`);
      assert.match(call, /IS_ARA_EFFECT\s+TRUE/,
        `${s.name}: juce_add_plugin must enable IS_ARA_EFFECT`);
      assert.match(call, /ARA_FACTORY_ID\s+"\\"com\.acme\.AraFx\.factory\.1\\""/,
        `${s.name}: ARA factory ID must be a unique versioned C string literal`);
      assert.match(call, /ARA_DOCUMENT_ARCHIVE_ID\s+"\\"com\.acme\.AraFx\.archive\.1\\""/,
        `${s.name}: ARA document archive ID must be a unique versioned C string literal`);
      assert.doesNotMatch(call, /FORMATS\s+[^\n]*\bARA\b/,
        `${s.name}: ARA must never appear as a JUCE plugin format`);
    }
  });

  it('uses JUCE ARA extension classes and provides a real factory without stubs', () => {
    for (const s of araOnly()) {
      const files = [...s.files.values()].join('\n');
      assert.match(s.files.get('Source/PluginProcessor.h'), /juce::AudioProcessorARAExtension/);
      assert.match(s.files.get('Source/PluginProcessor.cpp'), /getARAClientExtensions\s*\(\)\s*\{\s*return this;/);
      assert.match(s.files.get('Source/PluginEditor.h'), /juce::AudioProcessorEditorARAExtension/);
      assert.match(s.files.get('Source/PluginEditor.cpp'), /juce::AudioProcessorEditorARAExtension\s*\(&processor\)/);
      assert.match(s.files.get('Source/PluginDocumentController.h'), /juce::ARADocumentControllerSpecialisation/);
      assert.match(s.files.get('Source/PluginDocumentController.cpp'), /createARAFactory\s*\(\)/);
      assert.match(s.files.get('Source/PluginDocumentController.cpp'), /ARADocumentControllerSpecialisation::createARAFactory/);
      assert.match(s.files.get('Source/PluginDocumentController.cpp'), /doCreatePlaybackRenderer/);
      assert.match(s.files.get('Source/PluginPlaybackRenderer.h'), /juce::ARAPlaybackRenderer/);
      assert.match(s.files.get('Source/PluginPlaybackRenderer.cpp'), /juce::ARAAudioSourceReader/);
      assert.match(s.files.get('Source/PluginPlaybackRenderer.cpp'), /juce::BufferingAudioReader/);
      assert.match(s.files.get('Source/PluginPlaybackRenderer.cpp'), /interpolat|sourceStep/);
      const listedSources = cmakeListedFiles(cmakeCode(s.files.get('CMakeLists.txt')), 'target_sources');
      for (const file of ['PluginPlaybackRenderer.h', 'PluginPlaybackRenderer.cpp']) {
        assert.ok(s.files.has(`Source/${file}`), `${s.name}: ARA renderer source ${file} is missing`);
        assert.ok(listedSources.includes(`Source/${file}`), `${s.name}: ${file} is absent from target_sources()`);
      }
      assert.doesNotMatch(files, /juce::ARAAudioProcessor|JUCE_ARA_MODULE|FORMATS\s+ARA/);
      assert.doesNotMatch(files, /TODO|FIXME|PLACEHOLDER/i,
        `${s.name}: generated ARA source must not leave implementation placeholders`);
    }
  });

  it('rejects formats overrides and still reports ARA as an effect-mode request', async () => {
    const r = await call('audio_plugin_create', {
      projectPath: PROJ, name: 'AraFormatsOverride', type: 'ara', formats: 'ARA',
    });
    assert.equal(r.isError, true, r.text);
    assert.match(r.text, /fixed JUCE ARA effect formats VST3 and AU/);
    assert.ok(!fs.existsSync(path.join(PLUGINS, 'AraFormatsOverride')),
      'a rejected ARA format override must not create files');
  });
});

// ═══════════════════════════════════════════════════════════════════
// type: 'standalone' scaffolds a JUCE **application** via juce_add_gui_app() —
// one executable that owns its audio device — not a plugin a host loads. Every
// assertion below is either about that difference or about the JUCE 9 API
// changes the template has to get right.
describe('standalone application template (juce_add_gui_app)', () => {
  it('uses juce_add_gui_app and never juce_add_plugin', () => {
    for (const s of appOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cmakeFirstArg(cm, 'juce_add_gui_app'),
        `${s.name}: no juce_add_gui_app() call — an app target must be an executable`);
      assert.ok(!cmakeFirstArg(cm, 'juce_add_plugin'),
        `${s.name}: juce_add_plugin() in an app template would build a plugin library`);
    }
  });

  it('passes no plugin-only keywords, which JUCE would silently drop', () => {
    // juce_add_gui_app() has no UNPARSED_ARGUMENTS check, so a keyword that does
    // not apply is dropped without a warning — the same silent-failure mode that
    // made the original templates look correct while never configuring.
    const pluginOnlyKeywords = ['FORMATS', 'PLUGIN_CODE', 'PLUGIN_MANUFACTURER_CODE',
                                'IS_SYNTH', 'NEEDS_MIDI_INPUT', 'NEEDS_MIDI_OUTPUT',
                                'IS_MIDI_EFFECT', 'COPY_PLUGIN_AFTER_BUILD', 'IS_ARA_EFFECT',
                                'LV2URI'];
    for (const s of appOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      for (const kw of pluginOnlyKeywords) {
        assert.ok(!new RegExp(`(^|\\s)${kw}\\s`).test(cm),
          `${s.name}: ${kw} is a juce_add_plugin keyword and is silently ignored by juce_add_gui_app`);
      }
    }
  });

  it('uses only keywords juce_add_gui_app actually parses', () => {
    // From _juce_initialise_target() in JUCE 9.0.3's JUCEUtils.cmake.
    const VALID = ['VERSION', 'BUILD_VERSION', 'PRODUCT_NAME', 'PLIST_TO_MERGE', 'BUNDLE_ID',
                   'MICROPHONE_PERMISSION_ENABLED', 'MICROPHONE_PERMISSION_TEXT',
                   'COMPANY_COPYRIGHT', 'COMPANY_NAME', 'COMPANY_WEBSITE', 'COMPANY_EMAIL',
                   'NEEDS_CURL', 'NEEDS_WEB_BROWSER', 'NEEDS_WEBVIEW2',
                   'ICON_BIG', 'ICON_SMALL', 'HARDENED_RUNTIME_ENABLED', 'APP_SANDBOX_ENABLED'];
    for (const s of appOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const call = cm.match(/juce_add_gui_app\s*\(([\s\S]*?)\n\)/);
      assert.ok(call, `${s.name}: could not isolate the juce_add_gui_app() argument list`);
      const kws = call[1].split('\n')
        .map(l => l.trim())
        .filter(l => /^[A-Z_][A-Z0-9_]*\s/.test(l))
        .map(l => l.split(/\s+/)[0]);
      assert.ok(kws.length > 0, `${s.name}: no keywords parsed out of juce_add_gui_app()`);
      for (const kw of kws) {
        assert.ok(VALID.includes(kw),
          `${s.name}: "${kw}" is not a keyword juce_add_gui_app parses (it would be silently dropped)`);
      }
    }
  });

  it('generates the JUCE header and links juce_audio_utils', () => {
    for (const s of appOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cm.includes('juce_generate_juce_header'),
        `${s.name}: Source/Main.cpp includes <JuceHeader.h>, which this call generates`);
      assert.ok(cm.includes('juce::juce_audio_utils'),
        `${s.name}: AudioAppComponent lives in juce_audio_utils`);
      assert.ok(cm.includes('target_link_libraries'), `${s.name}: no modules linked`);
    }
  });

  it('names the CMake target after the plugin name, not ${PROJECT_NAME}', () => {
    for (const s of appOnly()) {
      const target = cmakeFirstArg(cmakeCode(s.files.get('CMakeLists.txt')), 'juce_add_gui_app');
      assert.equal(target, s.name,
        `${s.name}: app target is "${target}" — it would inherit the host project's name`);
    }
  });

  it('lists exactly the sources it scaffolds', () => {
    for (const s of appOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const listed = cmakeListedFiles(cm, 'target_sources');
      assert.deepEqual([...listed].sort(), ['Source/Main.cpp', 'Source/MainComponent.cpp', 'Source/MainComponent.h'],
        `${s.name}: target_sources does not match the scaffolded files`);
      for (const f of listed) assert.ok(s.files.has(f), `${s.name}: ${f} is listed but missing`);
    }
  });

  it('START_JUCE_APPLICATION names the class that derives from JUCEApplication', () => {
    for (const s of appOnly()) {
      const main = s.files.get('Source/Main.cpp');
      const started = main.match(/START_JUCE_APPLICATION\((\w+)\)/)?.[1];
      assert.ok(started, `${s.name}: no START_JUCE_APPLICATION — there would be no main()`);
      assert.ok(main.includes(`class ${started} final : public juce::JUCEApplication`),
        `${s.name}: START_JUCE_APPLICATION(${started}) does not match a JUCEApplication subclass`);
      // Exactly one main(); a second definition is a link error. Counted over
      // comment-stripped source, because the template explains in a comment what
      // START_JUCE_APPLICATION() does.
      assert.equal((cppCode(main).match(/START_JUCE_APPLICATION/g) ?? []).length, 1,
        `${s.name}: START_JUCE_APPLICATION appears more than once in code`);
    }
  });

  it('calls shutdownAudio() in the destructor, as JUCE 9 requires', () => {
    // AudioAppComponent's destructor jassert()s with "If you hit this then your
    // derived class must call shutdown audio in destructor!" — so this is not
    // optional cleanup, and a Debug build will abort without it.
    for (const s of appOnly()) {
      const cpp = s.files.get('Source/MainComponent.cpp');
      const dtor = cpp.match(/::~\w+\(\)[\s\S]*?\n\}/)?.[0];
      assert.ok(dtor, `${s.name}: no destructor definition found`);
      assert.ok(dtor.includes('shutdownAudio()'),
        `${s.name}: the destructor must call shutdownAudio() or JUCE asserts on teardown`);
    }
  });

  it('never calls start() or stop() — AudioAppComponent only has setAudioChannels/shutdownAudio', () => {
    // AudioAppComponent has never had start()/stop() in any JUCE release
    // (checked 6.1.6, 7.0.12, 8.0.15 and 9.0.5). setAudioChannels() starts the
    // callback and shutdownAudio() ends it. This guards against a well-meaning
    // edit that adds a tutorial start()/stop() pair, which would not compile.
    for (const s of appOnly()) {
      for (const [rel, content] of s.files) {
        if (!/\.(cpp|h)$/.test(rel)) continue;
        const code = cppCode(content);
        assert.ok(!/\bstart\s*\(\s*\)/.test(code), `${s.name}/${rel}: start() no longer exists on AudioAppComponent`);
        assert.ok(!/\bstop\s*\(\s*\)/.test(code), `${s.name}/${rel}: stop() no longer exists on AudioAppComponent`);
      }
    }
  });

  it('overrides all three pure-virtual AudioSource methods', () => {
    for (const s of appOnly()) {
      const h = s.files.get('Source/MainComponent.h');
      assert.ok(/public\s+juce::AudioAppComponent/.test(h),
        `${s.name}: the component must derive from juce::AudioAppComponent`);
      for (const m of ['prepareToPlay', 'getNextAudioBlock', 'releaseResources']) {
        assert.ok(new RegExp(`${m}[^;]*override`).test(h),
          `${s.name}: ${m}() is pure virtual in AudioSource and must be overridden`);
      }
    }
  });

  it('shares the level between threads through an atomic', () => {
    // The slider writes on the message thread and getNextAudioBlock reads on the
    // audio thread. A plain float there is a data race.
    for (const s of appOnly()) {
      const h = s.files.get('Source/MainComponent.h');
      assert.ok(/std::atomic<\s*float\s*>/.test(h),
        `${s.name}: the shared level must be std::atomic — it crosses the message/audio thread boundary`);
      assert.ok(h.includes('#include <atomic>'), `${s.name}: <atomic> is used but not included`);
    }
  });

  it('ignores the ui parameter — an app ships its own UI', () => {
    const generic = scaffolded.get('ToneGen');
    const webview = scaffolded.get('tone_gen');
    assert.ok(generic && webview, 'both standalone permutations must have scaffolded');
    // Same file set: ui='webview' must not pull in a WebView editor for an app.
    assert.deepEqual([...generic.files.keys()].sort(), [...webview.files.keys()].sort(),
      'ui changed the file set for a standalone app');
    for (const rel of generic.files.keys()) {
      const a = generic.files.get(rel).replace(/ToneGen/g, '@');
      const b = webview.files.get(rel).replace(/tone_gen|Tone Gen|tonegen/g, '@');
      assert.equal(a, b, `${rel} differs between ui=generic and ui=webview`);
    }
  });

  it('rejects a formats argument instead of silently ignoring it', async () => {
    const name = 'AppWithFormats' + Date.now().toString(36).slice(-4);
    const r = await call('apc',
      { projectPath: PROJ, name, type: 'standalone', formats: 'VST3' });
    assert.equal(r.isError, true,
      'an app has no FORMATS, so the argument must be rejected rather than dropped');
    assert.match(r.text, /standalone/i, r.text);
    assert.match(r.text, /formats/i, r.text);
    assert.ok(!fs.existsSync(path.join(PLUGINS, name)),
      'a rejected scaffold must not leave a directory behind');
  });
});

// ═══════════════════════════════════════════════════════════════════
// type: 'lv2' scaffolds a NATIVE LV2 plugin — pure C against lv2/core/lv2.h
// plus Turtle metadata. Unrelated to the LV2 that type='juce' emits from C++.
//
// The failure mode these tests exist to prevent is specific to LV2: the plugin's
// identity and its port wiring live in three files that must agree exactly, and
// when they do not the host loads the plugin with no metadata, or connects a
// gain value to an audio buffer. Nothing errors — it just sounds wrong or plays
// silence. Vocabulary verified against lv2/core.lv2/lv2core.ttl.
describe('native LV2 template', () => {
  // Parse the bracketed port blocks out of plugin.ttl. Ports do not nest, so a
  // non-greedy bracket match is enough.
  function ttlPorts(ttl) {
    return [...ttl.matchAll(/\[([^[]*lv2:index[^\]]*)\]/g)].map(m => {
      const body = m[1];
      const indexMatch = body.match(/lv2:index\s+(\d+)/);
      const symbolMatch = body.match(/lv2:symbol\s+"([^"]+)"/);
      // `a lv2:InputPort , lv2:ControlPort ;` — the type list of this port.
      const typeMatch = body.match(/\ba\s+([^;]+);/);
      return {
        index: indexMatch ? Number(indexMatch[1]) : NaN,
        symbol: symbolMatch ? symbolMatch[1] : undefined,
        names: [...body.matchAll(/lv2:name\s+"([^"]+)"/g)].map(x => x[1]),
        types: typeMatch
          ? typeMatch[1].split(',').map(t => t.trim()).filter(Boolean)
          : [],
        body,
      };
    });
  }

  // The C side: enum constant -> index, and enum constant -> struct field.
  function cPortMaps(c) {
    const enumIdx = {};
    for (const m of c.matchAll(/\b(PORT_[A-Z0-9_]+)\s*=\s*(\d+)/g)) enumIdx[m[1]] = Number(m[2]);
    const caseToField = {};
    for (const m of c.matchAll(/case\s+(PORT_[A-Z0-9_]+)\s*:\s*self->(\w+)/g)) caseToField[m[1]] = m[2];
    return { enumIdx, caseToField };
  }

  it('uses the same plugin URI in the C descriptor, manifest.ttl and plugin.ttl', () => {
    for (const s of lv2Only()) {
      const c = s.files.get('Source/plugin.c');
      const manifest = s.files.get('Source/manifest.ttl');
      const ttl = s.files.get('Source/plugin.ttl');

      const uriInC = (c.match(/#define\s+\w+_URI\s+"([^"]+)"/) ?? [])[1];
      assert.ok(uriInC, `${s.name}: no <id>_URI define in plugin.c`);

      const manifestSubject = (manifest.match(/^<([^>]+)>$/m) ?? [])[1];
      const ttlSubject = (ttl.match(/^<([^>]+)>$/m) ?? [])[1];
      assert.equal(manifestSubject, uriInC,
        `${s.name}: manifest.ttl subject "${manifestSubject}" != plugin.c URI "${uriInC}"`);
      assert.equal(ttlSubject, uriInC,
        `${s.name}: plugin.ttl subject "${ttlSubject}" != plugin.c URI "${uriInC}"`);

      // It must also be a URI, not just a matching string.
      assert.match(uriInC, /^urn:[a-z0-9]+:[A-Za-z0-9_]+$/,
        `${s.name}: "${uriInC}" is not a valid URN — hosts reject a non-URI plugin identity`);
    }
  });

  it('wires every Turtle port index to the matching C struct field', () => {
    for (const s of lv2Only()) {
      const ports = ttlPorts(s.files.get('Source/plugin.ttl'));
      assert.ok(ports.length >= 3, `${s.name}: expected audio in/out plus a control port, got ${ports.length}`);

      const { enumIdx, caseToField } = cPortMaps(s.files.get('Source/plugin.c'));
      const byIndex = {};
      for (const [k, v] of Object.entries(enumIdx)) byIndex[v] = k;

      // Indices must be exactly 0..n-1: a gap or a duplicate makes the host
      // connect the wrong buffer.
      const indices = ports.map(p => p.index).sort((a, b) => a - b);
      assert.deepEqual(indices, ports.map((_, i) => i),
        `${s.name}: lv2:index values must be 0..n-1 contiguous, got [${indices.join(', ')}]`);

      for (const p of ports) {
        const portConst = byIndex[p.index];
        assert.ok(portConst,
          `${s.name}: no C enum constant has value ${p.index} (lv2:symbol "${p.symbol}")`);
        assert.equal(caseToField[portConst], p.symbol,
          `${s.name}: lv2:index ${p.index} is "${p.symbol}" in plugin.ttl but connect_port() `
          + `assigns it to self->${caseToField[portConst]} — the host would connect the wrong buffer`);
      }
    }
  });

  it('gives every port exactly one lv2:symbol and at least one lv2:name', () => {
    // Both are hard requirements in lv2core.ttl: lv2:PortBase restricts
    // lv2:symbol to owl:cardinality 1, and lv2:Port requires
    // lv2:name minCardinality 1.
    for (const s of lv2Only()) {
      for (const p of ttlPorts(s.files.get('Source/plugin.ttl'))) {
        assert.ok(p.symbol, `${s.name}: a port at index ${p.index} has no lv2:symbol`);
        assert.equal((p.body.match(/lv2:symbol/g) ?? []).length, 1,
          `${s.name}: port "${p.symbol}" must have exactly one lv2:symbol`);
        assert.ok(p.names.length >= 1,
          `${s.name}: port "${p.symbol}" needs at least one lv2:name`);
      }
    }
  });

  it('declares a direction and a port type for every port', () => {
    for (const s of lv2Only()) {
      for (const p of ttlPorts(s.files.get('Source/plugin.ttl'))) {
        const hasDir = p.types.includes('lv2:InputPort') || p.types.includes('lv2:OutputPort');
        const hasKind = p.types.includes('lv2:AudioPort') || p.types.includes('lv2:ControlPort');
        assert.ok(hasDir, `${s.name}: port "${p.symbol}" declares no lv2:InputPort/lv2:OutputPort`);
        assert.ok(hasKind, `${s.name}: port "${p.symbol}" declares no lv2:AudioPort/lv2:ControlPort`);
      }
    }
  });

  it('gives control ports the bounds a host needs to draw a widget', () => {
    for (const s of lv2Only()) {
      for (const p of ttlPorts(s.files.get('Source/plugin.ttl'))) {
        if (!p.types.includes('lv2:ControlPort')) continue;
        for (const prop of ['lv2:default', 'lv2:minimum', 'lv2:maximum']) {
          assert.ok(p.body.includes(prop),
            `${s.name}: control port "${p.symbol}" is missing ${prop}`);
        }
      }
    }
  });

  it('declares the metadata lv2core requires of a Plugin', () => {
    for (const s of lv2Only()) {
      const ttl = s.files.get('Source/plugin.ttl');
      for (const prop of ['a lv2:Plugin', 'doap:name', 'lv2:minorVersion', 'lv2:microVersion']) {
        assert.ok(ttl.includes(prop), `${s.name}: plugin.ttl is missing ${prop}`);
      }
      // minor/microVersion are xsd:nonNegativeInteger, not strings.
      assert.match(ttl, /lv2:minorVersion\s+\d+\s*;/, `${s.name}: lv2:minorVersion must be an integer`);
      assert.match(ttl, /lv2:microVersion\s+\d+\s*;/, `${s.name}: lv2:microVersion must be an integer`);
    }
  });

  it('classifies the gain plugin as an AmplifierPlugin and claims no licence', () => {
    // lv2core: AmplifierPlugin is "primarily designed to change the volume of its
    // input"; UtilityPlugin is its superclass and says nothing about what the
    // plugin does, which is what hosts sort menus by.
    for (const s of lv2Only()) {
      const ttl = s.files.get('Source/plugin.ttl');
      assert.ok(ttl.includes('lv2:AmplifierPlugin'),
        `${s.name}: a gain plugin must declare lv2:AmplifierPlugin, not only lv2:UtilityPlugin`);
      // Choosing a licence on the user's behalf is a claim, not a default: the
      // scaffold ships no LICENSE file, so doap:license would assert something
      // untrue in a file hosts display.
      assert.ok(!/^\s*doap:license\s/m.test(ttl),
        `${s.name}: plugin.ttl must not assert a licence the user has not chosen`);
    }
  });

  it('gives the stereo ports an lv2:designation', () => {
    // Without a designation a host cannot pair in_l with out_l, or route a mono
    // host into both sides; it is left guessing from the symbol name.
    for (const s of lv2Only()) {
      const ports = ttlPorts(s.files.get('Source/plugin.ttl'));
      const audio = ports.filter(p => /AudioPort/.test(p.body ?? ''));
      for (const p of audio) {
        const want = /_l$/.test(p.symbol) ? 'lv2:left' : /_r$/.test(p.symbol) ? 'lv2:right' : null;
        assert.ok(want, `${s.name}: unexpected audio port symbol ${p.symbol}`);
        assert.ok((p.body ?? '').includes(`lv2:designation ${want}`),
          `${s.name}: port ${p.symbol} needs \`lv2:designation ${want}\``);
      }
    }
  });

  it('passes LV2URI explicitly instead of deriving it from a company website', () => {
    // JUCE's own comment in juce_audio_plugin_client_LV2.cpp: "it may be because
    // you haven't explicitly set an LV2 URI". With FORMATS including LV2 and no
    // LV2URI, JUCEUtils.cmake falls back to
    //   LV2URI = "<COMPANY_WEBSITE>/plugins/<Name>"
    // so dropping the invented COMPANY_WEBSITE silently produced
    // "/plugins/<Name>" and the LV2 target failed to compile. The URI is also the
    // plugin's permanent identity in saved host sessions, which is not something
    // to inherit from a guessed domain.
    for (const s of jucePluginOnly()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const formats = /FORMATS\s+([^\n)]+)/.exec(cm)?.[1] ?? '';
      const uri = /LV2URI\s+"([^"]+)"/.exec(cm)?.[1];
      // One CMakeLists serves every format combination, so a VST3-only scaffold
      // still carries the keyword; JUCE just never reads it. Only the LV2 case
      // can fail to build.
      if (/\bLV2\b/.test(formats)) {
        assert.ok(uri, `${s.name}: FORMATS includes LV2 but no LV2URI is passed — JUCE then `
          + `derives it from COMPANY_WEBSITE, which this template does not set`);
      }
      if (!uri) continue;
      assert.match(uri, /^(urn:[a-z0-9]{2,}:|https?:\/\/)/,
        `${s.name}: LV2URI "${uri}" needs a urn: or http(s) scheme — JUCE static_asserts on it`);
      // PLUGIN_ID keeps the name's case (JuceGen, mydelay), so compare folded.
      const id = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      assert.ok(uri.toLowerCase().endsWith(`:${id}`),
        `${s.name}: LV2URI "${uri}" does not identify this plugin (expected it to end in ":${id}")`);
    }
  });

  it('keeps the LV2 install destination relative so --prefix still applies', () => {
    // An absolute DESTINATION is expanded at configure time and frozen into
    // cmake_install.cmake, so `cmake --install build --prefix X` installs into
    // the configure-time path and leaves X empty. GNUInstallDirs + a relative
    // path is what makes both --prefix and CMAKE_INSTALL_PREFIX work.
    for (const s of lv2Only()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const dest = /DESTINATION\s+"([^"]+)"/.exec(cm)?.[1];
      assert.ok(dest, `${s.name}: no install(... DESTINATION ...) found`);
      assert.ok(!dest.startsWith('/') && !dest.includes('CMAKE_INSTALL_PREFIX'),
        `${s.name}: DESTINATION "${dest}" is absolute, so --prefix is silently ignored`);
      assert.ok(cm.includes('include(GNUInstallDirs)'),
        `${s.name}: must include(GNUInstallDirs) to derive lib/lv2 instead of hard-coding "lib"`);
    }
  });

  it('names the binary in manifest.ttl exactly as CMake builds it', () => {
    for (const s of lv2Only()) {
      const binary = (s.files.get('Source/manifest.ttl').match(/lv2:binary\s+<([^>]+)>/) ?? [])[1];
      assert.ok(binary, `${s.name}: manifest.ttl has no lv2:binary`);
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cm.includes(`SUFFIX ".so"`),
        `${s.name}: CMake must pin SUFFIX so the built filename matches manifest.ttl on every platform`);
      assert.ok(cm.includes('PREFIX ""'),
        `${s.name}: CMake must clear PREFIX or Linux produces lib<name>.so`);
      assert.equal(binary, `${s.name}.so`,
        `${s.name}: manifest.ttl names "${binary}" but the target is "${s.name}"`);
    }
  });

  it('points rdfs:seeAlso at the plugin.ttl that actually exists', () => {
    for (const s of lv2Only()) {
      const seeAlso = (s.files.get('Source/manifest.ttl').match(/rdfs:seeAlso\s+<([^>]+)>/) ?? [])[1];
      assert.ok(seeAlso, `${s.name}: manifest.ttl has no rdfs:seeAlso`);
      assert.ok(s.files.has(`Source/${seeAlso}`),
        `${s.name}: rdfs:seeAlso points at ${seeAlso}, which was not scaffolded`);
    }
  });

  it('emits the bundle where apc-val scans for LV2 artefacts', () => {
    for (const s of lv2Only()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const expected = `plugins/${s.name}/${s.name}_artefacts/$<CONFIG>/LV2/${s.name}.lv2`;
      // The paths live in LV2_ARTEFACTS_DIR/LV2_BUNDLE_DIR so that no line runs
      // past the length the lint enforces; expand one level of `set(VAR "...")`
      // so this still asserts the path that ends up in the property.
      const vars = new Map([...cm.matchAll(/^\s*set\s*\(\s*(\w+)\s+"([^"]*)"\s*\)/gm)]
        .map(m => [m[1], m[2]]));
      const expand = t => {
        for (let i = 0; i < 5; i++) {
          const next = t.replace(/\$\{(\w+)\}/g, (all, n) => (vars.has(n) ? vars.get(n) : all));
          if (next === t) break;
          t = next;
        }
        return t;
      };
      const outputs = cm.match(/LIBRARY_OUTPUT_DIRECTORY\s+"?([^"\s)]+)/)?.[1];
      assert.ok(outputs, `${s.name}: no LIBRARY_OUTPUT_DIRECTORY set`);
      assert.ok(expand(outputs).endsWith(`/${expected}`),
        `${s.name}: LIBRARY_OUTPUT_DIRECTORY must end in ${expected} so the built bundle is discoverable, got ${expand(outputs)}`);
      // A bundle is a directory holding the binary AND the metadata.
      assert.ok(/copy_if_different[\s\S]*manifest\.ttl[\s\S]*plugin\.ttl/.test(cm),
        `${s.name}: the .ttl files must be copied into the bundle next to the binary`);
    }
  });

  it('builds a MODULE library and locates the LV2 headers with a real error if absent', () => {
    for (const s of lv2Only()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.equal(cmakeFirstArg(cm, 'add_library'), s.name,
        `${s.name}: add_library target should be the plugin name`);
      assert.match(cm, /add_library\(\s*\S+\s+MODULE/,
        `${s.name}: an LV2 binary is dlopen'd and never linked against, so it must be MODULE, not SHARED`);
      assert.ok(cm.includes('lv2/core/lv2.h'),
        `${s.name}: must search for the real header path lv2/core/lv2.h`);
      assert.ok(/FATAL_ERROR/.test(cm),
        `${s.name}: a missing LV2 SDK must fail loudly rather than produce an unbuildable project`);
      // LV2 core is header-only; there is nothing to link.
      assert.ok(!cm.includes('target_link_libraries'),
        `${s.name}: lv2 core is header-only, so linking a library would be wrong`);
    }
  });

  it('initialises the descriptor with designated initialisers, not positional ones', () => {
    const FIELDS = ['URI', 'instantiate', 'connect_port', 'activate', 'run',
                    'deactivate', 'cleanup', 'extension_data'];
    for (const s of lv2Only()) {
      const c = s.files.get('Source/plugin.c');
      for (const f of FIELDS) {
        assert.match(c, new RegExp(`\\.${f}\\s*=`),
          `${s.name}: LV2_Descriptor field .${f} is not set by name — a positional initialiser `
          + 'silently breaks if the field order is misremembered');
      }
      assert.match(c, /LV2_SYMBOL_EXPORT\s+const\s+LV2_Descriptor\s*\*\s*lv2_descriptor\s*\(\s*uint32_t/,
        `${s.name}: hosts resolve the exported symbol "lv2_descriptor"`);
      assert.match(c, /static const LV2_Descriptor descriptor/,
        `${s.name}: the descriptor should be static and const`);
    }
  });

  it('is C, not C++', () => {
    for (const s of lv2Only()) {
      assert.ok(s.files.has('Source/plugin.c'), `${s.name}: expected Source/plugin.c`);
      for (const rel of s.files.keys()) {
        assert.ok(!rel.endsWith('.cpp') && !rel.endsWith('.h'),
          `${s.name}: a native LV2 template should not scaffold ${rel}`);
      }
      const c = s.files.get('Source/plugin.c');
      assert.ok(!/^\s*(class|template|namespace)\b/m.test(cppCode(c)),
        `${s.name}: plugin.c contains C++ constructs`);
      assert.match(c, /#include <stdlib\.h>/, `${s.name}: uses calloc/free without including <stdlib.h>`);
    }
  });

  it('escapes a description that would otherwise break the Turtle literal', async () => {
    const name = 'Lv2Quote' + Date.now().toString(36).slice(-4);
    const r = await call('apc', {
      projectPath: PROJ, name, type: 'lv2', vendor: 'acme',
      description: 'A "quoted" and \\backslashed\\ description',
    });
    assert.equal(r.isError, false, `scaffold failed: ${r.text}`);
    const ttl = fs.readFileSync(path.join(PLUGINS, name, 'Source', 'plugin.ttl'), 'utf8');
    const line = ttl.split('\n').find(l => l.includes('doap:shortdesc'));
    assert.ok(line, 'no doap:shortdesc line');
    // Both the quote and the backslash must be escaped, or the literal ends
    // early and the whole file fails to parse.
    assert.match(line, /doap:shortdesc "A \\"quoted\\" and \\\\backslashed\\\\ description"/,
      `description was not escaped for Turtle: ${line}`);
  });

  it('escapes quotes, backslashes, dollar signs, and avoids cross-variable expansion in CLAP and JUCE descriptions', async () => {
    const desc = 'A "warm" \\delay\\ with ${CMAKE_VAR} and {{VENDOR}}';
    const rClap = await call('apc', {
      projectPath: PROJ, name: 'ClapEscaped', type: 'clap', vendor: 'acme', description: desc,
    });
    assert.equal(rClap.isError, false, rClap.text);
    const clapCpp = fs.readFileSync(path.join(PLUGINS, 'ClapEscaped', 'Source', 'PluginProcessor.cpp'), 'utf8');
    const descLine = clapCpp.split('\n').find(l => l.includes('.description'));
    assert.ok(descLine?.includes('\\"warm\\"') && descLine.includes('\\\\delay\\\\'),
      `CLAP C++ description was not escaped: ${descLine}`);
    assert.ok(descLine.includes('{{VENDOR}}') && !descLine.includes('acme'),
      `replaceTemplateVars cross-expanded {{VENDOR}} inside description: ${descLine}`);

    const rJuce = await call('apc', {
      projectPath: PROJ, name: 'JuceEscaped', type: 'juce', vendor: 'acme', description: desc,
    });
    assert.equal(rJuce.isError, false, rJuce.text);
    const juceCmake = fs.readFileSync(path.join(PLUGINS, 'JuceEscaped', 'CMakeLists.txt'), 'utf8');
    const cmLine = juceCmake.split('\n').find(l => l.trim().startsWith('DESCRIPTION '));
    assert.ok(cmLine?.includes('\\\\\\"warm\\\\\\"') && cmLine.includes('\\${CMAKE_VAR}'),
      `CMake+C++ JucePlugin_Desc DESCRIPTION was not escaped: ${cmLine}`);
    assert.ok(cmLine.includes('{{VENDOR}}') && !cmLine.includes('and acme'),
      `replaceTemplateVars cross-expanded {{VENDOR}} inside CMake DESCRIPTION: ${cmLine}`);
  });

  it('accepts non-ASCII metadata and escapes vendor text per output grammar', async () => {
    // Two things are under test. (1) Non-ASCII metadata used to be rejected by an
    // ASCII-only regex, so "ACME, Inc." was fine but "Café Audio" was not — a
    // validation rule with no failure mode behind it. (2) The vendor name appears
    // in four output grammars, and a quote or an ampersand ends the construct in
    // three of them, so each gets its own escape.
    const vendor = 'ACME, Inc. & "Sons"';
    const description = 'Café <delay> & "warm"';
    const cmQuote = String.raw`\\\"`;   // CMake source: \\" -> \" -> " in the C++ macro
    const cxxQuote = String.raw`\"`;    // C++ / Turtle source: \" -> "
    const read = (name, rel) => fs.readFileSync(path.join(PLUGINS, name, rel), 'utf8');
    const lineWith = (text, needle) => text.split('\n').find(l => l.includes(needle)) ?? '';

    const rJuce = await call('apc', {
      projectPath: PROJ, name: 'MetaJuce', type: 'juce', ui: 'webview', vendor, description,
    });
    assert.equal(rJuce.isError, false, rJuce.text);

    const cm = read('MetaJuce', 'CMakeLists.txt');
    const nameLine = lineWith(cm, 'COMPANY_NAME');
    assert.ok(nameLine.includes(`"ACME, Inc. & ${cmQuote}Sons${cmQuote}"`),
      `CMake COMPANY_NAME must escape the quote for CMake *and* for the C++ macro JUCE derives from it: ${nameLine}`);
    const descLine = lineWith(cm, 'DESCRIPTION ');
    assert.ok(descLine.includes('Café'), `non-ASCII description was mangled or rejected: ${descLine}`);
    assert.ok(descLine.includes(`${cmQuote}warm`), `description quote not escaped for CMake: ${descLine}`);

    const html = read('MetaJuce', 'Source/UI/index.html');
    const vendorSpan = lineWith(html, 'class="vendor"');
    // Quotes are escaped too, not because this use needs it (it is a text node),
    // but so the helper stays safe if a template later interpolates the same
    // value into an attribute (AUDIT SEC-NEW-09).
    assert.ok(vendorSpan.includes('ACME, Inc. &amp; &quot;Sons&quot;'),
      `HTML must escape & and quotes so the helper is attribute-safe: ${vendorSpan}`);
    assert.ok(!vendorSpan.includes('& Sons'), `raw & left in HTML: ${vendorSpan}`);

    const edLine = lineWith(read('MetaJuce', 'Source/WebViewEditor.cpp'), '"vendor"');
    assert.ok(edLine.includes(`"ACME, Inc. & ${cxxQuote}Sons${cxxQuote}"`),
      `C++ string literal must have exactly one backslash per quote: ${edLine}`);

    // The other two grammars need their own scaffold: CLAP holds a C++ literal,
    // LV2 a Turtle one. Same input, different encodings, both must parse.
    const rClap = await call('apc', {
      projectPath: PROJ, name: 'MetaClap', type: 'clap', vendor, description,
    });
    assert.equal(rClap.isError, false, rClap.text);
    const clapVendor = lineWith(read('MetaClap', 'Source/PluginProcessor.cpp'), '.vendor');
    assert.ok(clapVendor.includes(`"ACME, Inc. & ${cxxQuote}Sons${cxxQuote}"`),
      `CLAP descriptor vendor literal was not escaped: ${clapVendor}`);

    const rLv2 = await call('apc', {
      projectPath: PROJ, name: 'MetaLv2', type: 'lv2', vendor, description,
    });
    assert.equal(rLv2.isError, false, rLv2.text);
    const ttl = read('MetaLv2', 'Source/plugin.ttl');
    const ttlVendor = lineWith(ttl, 'foaf:name');
    assert.ok(ttlVendor.includes(`"ACME, Inc. & ${cxxQuote}Sons${cxxQuote}"`),
      `Turtle foaf:name literal was not escaped: ${ttlVendor}`);

    // Control characters stay rejected: a newline ends every one of those
    // constructs, and no amount of escaping fixes that.
    const bad = await call('apc', {
      projectPath: PROJ, name: 'MetaBad', type: 'clap', description: 'two\nlines',
    });
    assert.equal(bad.isError, true, 'a multi-line description must be rejected');
    assert.match(bad.text, /single line without control characters/,
      `the rejection must explain itself rather than leaking a raw regex: ${bad.text}`);
  });

  it('guards null instance pointers in CLAP and LV2 templates and sanitizes bundle/URN vendor IDs', async () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const h = cppCode(s.files.get('Source/PluginProcessor.h'));
      assert.match(h, /plugin\s*!=\s*nullptr/, `${s.name}: CLAP from() must guard plugin == nullptr`);
    }
    for (const s of lv2Only()) {
      const c = cppCode(s.files.get('Source/plugin.c'));
      assert.equal((c.match(/self\s*==\s*NULL/g) ?? []).length >= 3, true,
        `${s.name}: LV2 instantiate/connect_port/run must all guard self == NULL`);
    }

    const rVendor = await call('apc', {
      projectPath: PROJ, name: 'VendorSan', type: 'juce', vendor: 'my_vendor',
    });
    assert.equal(rVendor.isError, false, rVendor.text);
    const vendorCm = fs.readFileSync(path.join(PLUGINS, 'VendorSan', 'CMakeLists.txt'), 'utf8');
    assert.match(vendorCm, /BUNDLE_ID\s+"com\.my-vendor\.VendorSan"/,
      `CFBundleIdentifier must not contain underscores: ${vendorCm}`);

    const rLv2Short = await call('apc', {
      projectPath: PROJ, name: 'ShortNid', type: 'lv2', vendor: 'x',
    });
    assert.equal(rLv2Short.isError, false, rLv2Short.text);
    const ttl = fs.readFileSync(path.join(PLUGINS, 'ShortNid', 'Source', 'manifest.ttl'), 'utf8');
    const nid = ttl.match(/^<urn:([a-z0-9]+):ShortNid>$/m)?.[1] ?? '';
    assert.ok(nid.length >= 2, `RFC 8141 requires URN NID length >= 2, got "${nid}"`);

    const rClapFmt = await call('apc', {
      projectPath: PROJ, name: 'ClapBadFmt', type: 'clap', formats: 'VST3',
    });
    assert.equal(rClapFmt.isError, true, 'type="clap" must reject non-CLAP formats');
  });

  it('enables C in LV2 CMakeLists so C++-only host projects can add_subdirectory it', () => {
    for (const s of lv2Only()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(cm, /\benable_language\s*\(\s*C\s*\)/,
        `${s.name}: missing enable_language(C) breaks host projects with project(... LANGUAGES CXX)`);
    }
  });

  it('ignores the ui parameter and rejects a formats argument', async () => {
    const generic = scaffolded.get('Lv2Gain');
    const webview = scaffolded.get('lv2_gain');
    assert.ok(generic && webview, 'both LV2 permutations must have scaffolded');
    assert.deepEqual([...generic.files.keys()].sort(), [...webview.files.keys()].sort(),
      'ui changed the file set for a native LV2 plugin');

    const name = 'Lv2WithFormats' + Date.now().toString(36).slice(-4);
    const r = await call('apc',
      { projectPath: PROJ, name, type: 'lv2', formats: 'VST3' });
    assert.equal(r.isError, true, 'a native LV2 plugin has no JUCE FORMATS list');
    assert.match(r.text, /lv2/i, r.text);
    assert.match(r.text, /juce/i,
      'the message should distinguish native LV2 from the LV2 that type="juce" emits');
    assert.ok(!fs.existsSync(path.join(PLUGINS, name)),
      'a rejected scaffold must not leave a directory behind');
  });

  it('NODE-03: fourCharCode guarantees >=1 uppercase letter for digit-leading vendors and distinct PLUGIN_CODEs for shared prefixes', async () => {
    const rLead = await call('apc', {
      projectPath: PROJ, name: 'MySynthLead', type: 'juce', vendor: '112dB',
    });
    const rPad = await call('apc', {
      projectPath: PROJ, name: 'MySynthPad', type: 'juce', vendor: '1010',
    });
    assert.equal(rLead.isError, false, rLead.text);
    assert.equal(rPad.isError, false, rPad.text);

    const cmLead = fs.readFileSync(path.join(PLUGINS, 'MySynthLead', 'CMakeLists.txt'), 'utf8');
    const cmPad = fs.readFileSync(path.join(PLUGINS, 'MySynthPad', 'CMakeLists.txt'), 'utf8');
    const mcLead = cmLead.match(/PLUGIN_MANUFACTURER_CODE\s+(\S+)/)?.[1] ?? '';
    const mcPad = cmPad.match(/PLUGIN_MANUFACTURER_CODE\s+(\S+)/)?.[1] ?? '';
    const pcLead = cmLead.match(/PLUGIN_CODE\s+(\S+)/)?.[1] ?? '';
    const pcPad = cmPad.match(/PLUGIN_CODE\s+(\S+)/)?.[1] ?? '';

    assert.ok(mcLead.length === 4 && /[A-Z]/.test(mcLead),
      `digit-leading vendor "112dB" must produce 4-char MANUFACTURER_CODE with >=1 uppercase letter, got "${mcLead}"`);
    assert.ok(mcPad.length === 4 && /[A-Z]/.test(mcPad),
      `all-digit vendor "1010" must produce 4-char MANUFACTURER_CODE with >=1 uppercase letter, got "${mcPad}"`);
    assert.notEqual(pcLead, pcPad,
      `MySynthLead and MySynthPad must not collide on PLUGIN_CODE "${pcLead}"`);
  });

  it('CPP-01, CPP-02, UI-01: juce-webview notifies host on parameter gesture, performs ready handshake, and avoids Math.random meter', () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'juce' && x.ui === 'webview')) {
      const editorCpp = cppCode(s.files.get('Source/WebViewEditor.cpp'));
      assert.match(editorCpp, /beginChangeGesture\s*\(\s*\)/,
        `${s.name}: WebViewEditor must call beginChangeGesture()`);
      assert.match(editorCpp, /setValueNotifyingHost\s*\(/,
        `${s.name}: WebViewEditor must call setValueNotifyingHost()`);
      assert.match(editorCpp, /endChangeGesture\s*\(\s*\)/,
        `${s.name}: WebViewEditor must call endChangeGesture()`);
      assert.match(editorCpp, /jlimit\s*\(\s*0\.0f\s*,\s*1\.0f/,
        `${s.name}: WebViewEditor must clamp gain to [0.0f, 1.0f]`);
      assert.match(editorCpp, /action\s*==\s*"ready"/,
        `${s.name}: WebViewEditor must handle the "ready" handshake from JS`);

      const appJs = s.files.get('Source/UI/app.js');
      assert.doesNotMatch(appJs, /Math\.random\s*\(\s*\)/,
        `${s.name}: app.js must not drive the audio meter with Math.random()`);
      assert.match(appJs, /sendAction\s*\(\s*['"]ready['"]/,
        `${s.name}: app.js must send the "ready" handshake on load`);
    }
  });

  it('CPP-03, CPP-04: clap reset() preserves parameter values, factoryCreatePlugin uses std::nothrow, and standalone uses ScopedNoDenormals', () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const procCpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      const resetBody = procCpp.match(/void\s+\w+::reset\s*\([^)]*\)\s*\{([\s\S]*?)\}/)?.[1] ?? '';
      assert.doesNotMatch(resetBody, /\bm_gain\s*=/,
        `${s.name}: CLAP reset() must not overwrite parameter value m_gain`);

      const entryCpp = cppCode(s.files.get('Source/PluginEntry.cpp'));
      assert.match(entryCpp, /new\s*\(\s*std::nothrow\s*\)/,
        `${s.name}: CLAP factoryCreatePlugin must use new (std::nothrow) across CLAP_ABI`);
    }

    for (const s of [...scaffolded.values()].filter(x => x.type === 'standalone')) {
      const mainCompCpp = cppCode(s.files.get('Source/MainComponent.cpp'));
      assert.match(mainCompCpp, /\bScopedNoDenormals\b/,
        `${s.name}: standalone getNextAudioBlock must guard denormals with ScopedNoDenormals`);
    }
  });

  it('CMAKE-01, CMAKE-02: templates check CMAKE_SOURCE_DIR/_tools first, use {{PLUGIN_NAME}}_WebData target, and honour custom pluginsDir', async () => {
    for (const s of scaffolded.values()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(cm, /\$\{CMAKE_SOURCE_DIR\}\/_tools\//,
        `${s.name}: CMakeLists.txt must check \${CMAKE_SOURCE_DIR}/_tools/ first`);
      if (s.type === 'juce' && s.ui === 'webview') {
        assert.ok(cm.includes(`juce_add_binary_data(${s.name}_WebData`),
          `${s.name}: binary data CMake target must use PLUGIN_NAME (${s.name}_WebData) so hyphen/underscore siblings do not collide`);
      }
    }

    const customProj = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-custom-pluginsdir-'));
    try {
      fs.writeFileSync(path.join(customProj, 'apc-mcp.json'), JSON.stringify({ pluginsDir: 'modules/audio' }));
      const rClap = await call('apc', {
        projectPath: customProj, name: 'CustomClap', type: 'clap',
      });
      assert.equal(rClap.isError, false, rClap.text);
      const clapCm = fs.readFileSync(path.join(customProj, 'modules', 'audio', 'CustomClap', 'CMakeLists.txt'), 'utf8');
      assert.ok(clapCm.includes('modules/audio/CustomClap/CustomClap_artefacts/$<CONFIG>/CLAP'),
        `CLAP CMakeLists.txt must honour custom pluginsDir: ${clapCm}`);
    } finally {
      fs.rmSync(customProj, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('the native templates compile with warnings as errors', () => {
  // These templates generate C/C++ that the user then owns. A scaffold that
  // ships warnings on day one teaches its owner to ignore warnings on day two,
  // so the flags are part of the contract, not a convenenience: CI builds both
  // templates with the real headers on every push (scaffold-clap /
  // scaffold-lv2), and those builds stay green only because the generated code
  // is genuinely warning-free.
  const nativeCmake = () => [
    ...scaffolded.values().filter(s => s.type === 'clap' || s.type === 'lv2'),
  ];

  it('every native template turns on -Wall -Wextra -Wpedantic -Werror', () => {
    const seen = new Set();
    for (const s of nativeCmake()) {
      const code = cmakeCode(s.files.get('CMakeLists.txt'));
      // cmake may receive the flags either as one argument or as a list; assert
      // on the presence of each flag inside a target_compile_options call rather
      // than on one particular spelling.
      const m = code.match(/target_compile_options\s*\(\s*([^\s)]+)[\s\S]*?\)/);
      assert.ok(m, `${s.name}: no target_compile_options() in CMakeLists.txt`);
      assert.equal(m[1], s.name,
        `${s.name}: warning flags must apply to the generated target PRIVATE, not to ${m[1]}`);
      for (const flag of ['-Wall', '-Wextra', '-Wpedantic', '-Werror']) {
        assert.ok(code.includes(flag), `${s.name}: CMakeLists.txt does not pass ${flag}`);
      }
      // MSVC spells these differently and rejects the GCC ones, so the flags
      // have to be behind a compiler switch.
      assert.match(code, /if\s*\(\s*MSVC\s*\)/,
        `${s.name}: -Werror-style flags must be guarded by if(MSVC) or the Windows build breaks`);
      for (const flag of ['/W4', '/WX']) {
        assert.ok(code.includes(flag), `${s.name}: no MSVC equivalent ${flag}`);
      }
      seen.add(s.type);
    }
    assert.deepEqual([...seen].sort(), ['clap', 'lv2'],
      'both native template families must be covered');
  });

  it('LV2 headers are included as SYSTEM so -Werror only judges generated code', () => {
    for (const s of lv2Only()) {
      const code = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.match(code, /target_include_directories\s*\(\s*[^\s)]+\s+SYSTEM\s+PRIVATE\s+\$\{LV2_INCLUDE_DIR\}/,
        `${s.name}: the third-party LV2 headers must be SYSTEM, or a warning inside lv2/lv2 fails a user's build`);
      assert.match(code, /target_include_directories\s*\(\s*[^\s)]+\s+PRIVATE\s+Source\s*\)/,
        `${s.name}: Source/ must NOT be SYSTEM — its warnings are ours to fix`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// VERIFICATION-MATRIX follow-ups (2026-11-17 round 2). Two scaffold
// defects graded by the review are closed here:
//
//   * the CLAP template exposed no parameters — a host could load it but
//     never adjust it, so "gain plugin" was a compile-time constant from
//     the host's point of view (row: "CLAP scaffold is a host-configurable
//     gain plugin"). It now implements clap.params (one automatable gain,
//     0..1, default 0.75 — matching the JUCE templates) and clap.state.
//   * F5: the WebView "Level" bar was driven by the gain slider, not by
//     audio. The processor now measures the output peak and the editor
//     pushes it to JS as `level`.

describe('clap.params and clap.state make the CLAP scaffold host-configurable', () => {
  it('advertises clap.params with one automatable gain parameter', () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const h = s.files.get('Source/PluginProcessor.h');
      assert.match(h, /kGainParamId/,
        `${s.name}: the gain parameter needs a stable id constant`);
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /CLAP_EXT_PARAMS/,
        `${s.name}: getExtension() must advertise clap.params`);
      assert.match(cpp, /clap_plugin_params_t\s+\w+\s*=/,
        `${s.name}: a clap_plugin_params_t vtable must be defined`);
      assert.match(cpp, /CLAP_PARAM_IS_AUTOMATABLE/,
        `${s.name}: the gain parameter must be automatable, or a host will hide it`);
      assert.match(cpp, /info->default_value\s*=\s*kGainParamDefault/,
        `${s.name}: get_info() must publish the default value`);
      assert.match(cpp, /kGainParamDefault\s*=\s*0\.75f/,
        `${s.name}: the default must match the JUCE templates (75 %)`);
      assert.match(cpp, /paramsTextToValue[\s\S]*?strtod/,
        `${s.name}: text_to_value must parse the percent text value_to_text emits`);
    }
  });

  it('applies CLAP_EVENT_PARAM_VALUE in process() and shares the code with flush()', () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const h = s.files.get('Source/PluginProcessor.h');
      assert.match(h, /applyParameterEvents\s*\(\s*const clap_input_events_t\s*\*\s*\w*\s*\)/,
        `${s.name}: event application must be a member so process() and flush() share it`);
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /header->type\s*!=\s*CLAP_EVENT_PARAM_VALUE/,
        `${s.name}: parameter events must be recognised by event type`);
      assert.match(cpp, /->applyParameterEvents\s*\(\s*process->in_events\s*\)/,
        `${s.name}: process() must consume host automation events before applying gain`);
      assert.match(cpp, /->applyParameterEvents\s*\(\s*in\s*\)/,
        `${s.name}: paramsFlush() must apply events like process() does`);
      assert.match(cpp, /m_gain\.store\s*\(/,
        `${s.name}: the audio thread reads the gain through the atomic`);
    }
  });

  it('persists the gain across sessions via clap.state', () => {
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /CLAP_EXT_STATE/,
        `${s.name}: getExtension() must advertise clap.state — without it a host must not remember parameter values`);
      assert.match(cpp, /clap_plugin_state_t\s+\w+\s*=/,
        `${s.name}: a clap_plugin_state_t vtable must be defined`);
      assert.match(cpp, /writeFully\s*\(\s*stream,\s*&version/,
        `${s.name}: save() must write a versioned payload`);
      assert.match(cpp, /version\s*!=\s*1/,
        `${s.name}: load() must reject state it does not understand instead of guessing`);
    }
  });

  it('ignores foreign-namespace events and announces state-loaded values to the host', () => {
    // Constraints from real clap-validator runs (PR #45 CI): param-set-wrong-namespace
    // sends CLAP_EVENT_PARAM_VALUE events with space_id=0xb33f and expects the values
    // NOT to move; state-reproducibility-* loads a state and expects the plugin to
    // request CLAP_PARAM_RESCAN_VALUES, or the host keeps showing stale values.
    for (const s of [...scaffolded.values()].filter(x => x.type === 'clap')) {
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /header->space_id\s*!=\s*CLAP_CORE_EVENT_SPACE_ID/,
        `${s.name}: a type number from another event registry must not be interpreted as a param value`);
      assert.match(cpp, /hostParams->rescan\s*\(\s*m_host,\s*CLAP_PARAM_RESCAN_VALUES\s*\)/,
        `${s.name}: after state load changes values, the host must be told to rescan`);
      assert.match(cpp, /requestParamRescan\s*\(\s*\)\s*;?\s*\n?\s*\/\/|requestParamRescan\(\);/,
        `${s.name}: state load should only rescan when a value actually changed`);
      // CLAP streams may deliver short reads/writes (clap-validator tests 17-byte
      // buffers); single-shot read()/write() comparisons are not contract-safe.
      assert.match(cpp, /bool\s+writeFully\s*\(/, `${s.name}: save must loop over short writes`);
      assert.match(cpp, /bool\s+readFully\s*\(/, `${s.name}: load must loop over short reads`);
    }
  });
});

describe('F5 · the WebView meter shows measured audio level, not the gain knob', () => {
  const webviewPlugins = () =>
    [...scaffolded.values()].filter(x => (x.type === 'juce' || x.type === 'vst3') && x.ui === 'webview');

  it('measures the output peak on the audio thread and shares it atomically', () => {
    for (const s of webviewPlugins()) {
      const h = s.files.get('Source/PluginProcessor.h');
      assert.match(h, /std::atomic<\s*float\s*>\s*m_outputPeak/,
        `${s.name}: the level crosses the audio/message thread boundary and must be atomic`);
      assert.ok(h.includes('#include <atomic>'), `${s.name}: <atomic> is used but not included`);
      const cpp = cppCode(s.files.get('Source/PluginProcessor.cpp'));
      assert.match(cpp, /std::abs\s*\(/,
        `${s.name}: a peak meter needs |sample|, not the raw value`);
      assert.match(cpp, /m_outputPeak\.store\s*\(/,
        `${s.name}: the measured peak must be published for the editor to read`);
      // The measurement must happen AFTER the gain is applied, or the meter
      // reports the input rather than what the listener hears.
      const gainApply = cpp.search(/channels\[channel\]\[sample\]\s*\*=\s*gain/);
      const peakStore = cpp.search(/m_outputPeak\.store\s*\(/);
      assert.ok(gainApply >= 0 && peakStore > gainApply,
        `${s.name}: the peak must be measured after the gain is applied`);
    }
  });

  it('sends the measured level to JS and never derives the meter from the gain slider', () => {
    for (const s of webviewPlugins()) {
      const editorCpp = cppCode(s.files.get('Source/WebViewEditor.cpp'));
      assert.match(editorCpp, /getOutputPeak\s*\(\s*\)/,
        `${s.name}: the editor must read the measured peak from the processor`);
      assert.match(editorCpp, /setProperty\s*\(\s*"level"/,
        `${s.name}: the JS state must carry the level`);
      assert.match(editorCpp, /m_displayLevel\s*\*\s*0\.85f/,
        `${s.name}: the meter needs a decay or it snaps to zero between blocks`);

      const appJs = s.files.get('Source/UI/app.js');
      assert.doesNotMatch(appJs, /meterFill\.style\.width\s*=\s*pct/,
        `${s.name}: the meter must not be driven by the gain slider position`);
      assert.match(appJs, /state\.level/,
        `${s.name}: the meter must be driven by the measured level from C++`);
    }
  });
});
