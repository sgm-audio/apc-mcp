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
    const names = [...scaffolded.values()]
      .filter(s => s.type !== 'clap')
      .map(s => cmakeFirstArg(cmakeCode(s.files.get('CMakeLists.txt')), 'juce_add_plugin'));
    assert.equal(new Set(names).size, names.length,
      `duplicate CMake target names would break configure: ${names.join(', ')}`);
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
    for (const s of scaffolded.values()) {
      if (s.type === 'clap') continue;
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(!/(^|\s)COPYRIGHT\s/.test(cm),
        `${s.name}: bare COPYRIGHT is silently ignored by juce_add_plugin`);
      assert.ok(cm.includes('COMPANY_COPYRIGHT'), `${s.name}: expected COMPANY_COPYRIGHT`);
    }
  });

  it('links JUCE modules (without this every juce:: symbol is undefined)', () => {
    for (const s of scaffolded.values()) {
      if (s.type === 'clap') continue;
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      assert.ok(cm.includes('target_link_libraries'),
        `${s.name}: no target_link_libraries at all`);
      assert.ok(cm.includes('juce::juce_audio_utils'),
        `${s.name}: does not link juce::juce_audio_utils`);
    }
  });

  it('guards add_subdirectory(JUCE) so multi-plugin repos can configure', () => {
    for (const s of scaffolded.values()) {
      if (s.type === 'clap') continue;
      const cm = cmakeCode(s.files.get('CMakeLists.txt'));
      if (!cm.includes('add_subdirectory')) continue;
      assert.ok(/if\s*\(\s*NOT\s+TARGET\s+juce::/i.test(cm),
        `${s.name}: add_subdirectory(JUCE) is unguarded — a second plugin would define juce::* targets twice`);
    }
  });

  it('declares only JUCE formats juce_add_plugin accepts', () => {
    for (const s of scaffolded.values()) {
      if (s.type === 'clap') continue;
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
    for (const s of scaffolded.values()) {
      if (s.type === 'clap') continue;
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
          const code = content.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
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
    assert.deepEqual(allowed, ['clap', 'vst3', 'juce']);
  });
});
