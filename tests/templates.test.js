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
// free-audio/clap sources; see AUDIT.md.

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
    const r = await call('audio_plugin_create', { projectPath: PROJ, ...p, vendor: 'acme' });
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

  it('asks for a web browser backend', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(/NEEDS_WEB_BROWSER\s+TRUE/.test(cm), `${s.name}: NEEDS_WEB_BROWSER not TRUE`);
      assert.ok(/JUCE_WEB_BROWSER=1/.test(cm), `${s.name}: JUCE_WEB_BROWSER must be 1`);
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

  it('the C++ binary-data namespace matches the CMake NAMESPACE', () => {
    for (const s of juceOnly('webview')) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const ns = cm.match(/NAMESPACE\s+(\S+)/)?.[1];
      const editor = s.files.get('Source/WebViewEditor.cpp');
      assert.ok(ns, `${s.name}: no NAMESPACE`);
      assert.ok(editor.includes(`namespace ${ns}`),
        `${s.name}: WebViewEditor.cpp declares a different BinaryData namespace than CMake's ${ns}`);
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

  it('emits into the artefacts layout audio_plugin_validate scans', () => {
    for (const s of claps()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const expected = `plugins/${s.name}/${s.name}_artefacts/$<CONFIG>/CLAP/${s.name}.clap`;
      assert.ok(cm.includes(expected),
        `${s.name}: validate scans <build>/${expected} — a scaffolded CLAP could never be validated`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('schema rejects format values JUCE cannot build', () => {
  it('rejects formats="ARA"', async () => {
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name: 'AraNope', type: 'juce', formats: 'ARA' });
    assert.equal(r.isError, true, 'ARA is not a juce_add_plugin format');
    assert.match(r.text, /ARA/);
    assert.match(r.text, new RegExp(JUCE_FORMATS.slice(0, 3).join('|')),
      `the error should list valid formats, got: ${r.text}`);
  });

  it('rejects an invented format', async () => {
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name: 'BogusFmt', type: 'juce', formats: 'VST3;NotAFormat' });
    assert.equal(r.isError, true);
    assert.match(r.text, /NotAFormat/);
  });

  it('accepts a valid multi-format list', async () => {
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name: 'OkFormats', type: 'juce', formats: 'VST3;AU;Standalone' });
    assert.equal(r.isError, false, `valid formats were rejected: ${r.text}`);
    assert.ok(fs.existsSync(path.join(PLUGINS, 'OkFormats', 'CMakeLists.txt')));
  });

  it('type "ara" is not offered at all', async () => {
    const tools = await listTools();
    const create = tools.find(t => t.name === 'audio_plugin_create');
    const allowed = create.inputSchema.properties.type.enum ?? [];
    assert.ok(!allowed.includes('ara'), `"ara" is still advertised: ${allowed.join(', ')}`);
    // Exact list on purpose: this is a snapshot of the tool's advertised schema,
    // so adding or removing a type is a deliberate, reviewed change rather than
    // something that slips in. 'standalone' and 'lv2' were added for the
    // application and native-LV2 templates.
    assert.deepEqual(allowed, ['clap', 'vst3', 'juce', 'standalone', 'lv2']);
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
                                'IS_MIDI_EFFECT', 'COPY_PLUGIN_AFTER_BUILD', 'IS_ARA_EFFECT'];
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

  it('does not call start() or stop(), which JUCE 9 removed from AudioAppComponent', () => {
    // Older JUCE (and most tutorials still circulating) start the device with
    // start() and stop it with stop(). Neither exists in JUCE 9: setAudioChannels()
    // starts the callback and shutdownAudio() ends it.
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
    const r = await call('audio_plugin_create',
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

  it('emits the bundle where audio_plugin_validate scans for LV2 artefacts', () => {
    for (const s of lv2Only()) {
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      const expected = `plugins/${s.name}/${s.name}_artefacts/$<CONFIG>/LV2/${s.name}.lv2`;
      assert.ok(cm.includes(expected),
        `${s.name}: LIBRARY_OUTPUT_DIRECTORY must be ${expected} so the built bundle is discoverable`);
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
    const r = await call('audio_plugin_create', {
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

  it('ignores the ui parameter and rejects a formats argument', async () => {
    const generic = scaffolded.get('Lv2Gain');
    const webview = scaffolded.get('lv2_gain');
    assert.ok(generic && webview, 'both LV2 permutations must have scaffolded');
    assert.deepEqual([...generic.files.keys()].sort(), [...webview.files.keys()].sort(),
      'ui changed the file set for a native LV2 plugin');

    const name = 'Lv2WithFormats' + Date.now().toString(36).slice(-4);
    const r = await call('audio_plugin_create',
      { projectPath: PROJ, name, type: 'lv2', formats: 'VST3' });
    assert.equal(r.isError, true, 'a native LV2 plugin has no JUCE FORMATS list');
    assert.match(r.text, /lv2/i, r.text);
    assert.match(r.text, /juce/i,
      'the message should distinguish native LV2 from the LV2 that type="juce" emits');
    assert.ok(!fs.existsSync(path.join(PLUGINS, name)),
      'a rejected scaffold must not leave a directory behind');
  });
});
