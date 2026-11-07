#!/usr/bin/env node
// End-to-end scaffold smoke test.
//
// Drives the real MCP server to scaffold every plugin-type x ui combination into
// a throwaway project, then checks the output (including root CMakeLists.txt
// registration). With --configure it runs real cmake configure; with --build it
// also runs `cmake --build` to compile and link every target and verifies the
// resulting plugin/app binaries on disk.
//
// Configure/build dependencies come from the environment, so the script stays
// useful on a laptop with no toolchain:
//   APC_JUCE_DIR   path to a JUCE checkout (symlinked to <proj>/_tools/JUCE)
//   APC_CLAP_DIR   path to a free-audio/clap checkout (symlinked to <proj>/_tools/clap)
//   APC_LV2_DIR    path to an lv2/lv2 include directory (contains lv2/core/lv2.h)
//
// Usage:
//   node scripts/smoke-scaffold.mjs                  # structural checks only
//   node scripts/smoke-scaffold.mjs --configure      # + cmake configure
//   node scripts/smoke-scaffold.mjs --build          # + cmake configure + compile/link + artefact check
//
// Exit code is non-zero if any check fails.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(PKG_DIR, 'index.js');

const BUILD_TARGETS = process.argv.includes('--build');
const CONFIGURE = BUILD_TARGETS || process.argv.includes('--configure');
const JUCE_DIR = process.env.APC_JUCE_DIR || '';
const CLAP_DIR = process.env.APC_CLAP_DIR || '';
const LV2_DIR = process.env.APC_LV2_DIR || '';

const CASES = [
  { name: 'SmokeClap',      type: 'clap', ui: 'generic', family: 'clap' },
  { name: 'SmokeJuceGen',   type: 'juce', ui: 'generic', family: 'juce' },
  { name: 'SmokeJuceWv',    type: 'juce', ui: 'webview', family: 'juce' },
  { name: 'SmokeVst3Gen',   type: 'vst3', ui: 'generic', family: 'juce' },
  { name: 'SmokeVst3Wv',    type: 'vst3', ui: 'webview', family: 'juce' },
  { name: 'smoke-kebab',    type: 'clap', ui: 'generic', family: 'clap' },
  // A standalone application. `family` stays 'juce' because that is what
  // groups it for the optional cmake configure/build step — it needs JUCE, just
  // like the plugin templates.
  { name: 'SmokeStandalone', type: 'standalone', ui: 'generic', family: 'juce' },
  { name: 'smoke_app',       type: 'standalone', ui: 'generic', family: 'juce' },
  // A native LV2 plugin: C, not C++, and it needs the LV2 headers rather than
  // JUCE or CLAP, so it is its own family for the configure/build step.
  { name: 'SmokeLv2',        type: 'lv2', ui: 'generic', family: 'lv2' },
  { name: 'smoke-lv2_gain',  type: 'lv2', ui: 'generic', family: 'lv2' },
];

// The CMake command each scaffold type must define its target with. One table,
// keyed by `type`, so the structural check cannot drift from what the templates
// actually emit.
const CMAKE_COMMAND_FOR_TYPE = {
  clap: 'add_library',            // a MODULE library against free-audio/clap
  juce: 'juce_add_plugin',
  vst3: 'juce_add_plugin',
  standalone: 'juce_add_gui_app', // an executable, not a plugin library
  lv2: 'add_library',             // a MODULE library, dlopen'd by the host
};

let failures = 0;
const fail = (label, detail) => {
  failures++;
  console.error(`  FAIL ${label}\n       ${String(detail).split('\n').join('\n       ')}`);
};
const ok = label => console.log(`  ok   ${label}`);

// ── MCP client (same lifecycle as a real host) ────────────────────
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [INDEX], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', settled = false, stderr = '';
    const send = o => {
      try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch { /* server gone */ }
    };
    const killer = setTimeout(() => proc.kill('SIGKILL'), 60000);
    const done = (fn, arg) => {
      if (settled) return;
      settled = true; clearTimeout(killer);
      try { proc.stdin.end(); } catch { /* already closed */ }
      try { proc.kill(); } catch { /* already exited */ }
      fn(arg);
    };
    proc.stderr.on('data', d => stderr += d);
    proc.on('error', e => done(reject, e));
    proc.on('close', () => { if (!settled) done(reject, new Error(`server exited early: ${stderr.slice(0, 300)}`)); });
    proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method, params });
        } else if (msg.id === 2) done(resolve, msg);
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'apc-smoke', version: '1.0' } } });
  });
}

async function call(toolName, args) {
  const msg = await rpc('tools/call', { name: toolName, arguments: args });
  if (msg.error) return { isError: true, text: JSON.stringify(msg.error) };
  const res = msg.result || {};
  return { isError: !!res.isError, text: res.content?.[0]?.text ?? '' };
}

// ── Project setup ─────────────────────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-smoke-'));
const PROJ = path.join(ROOT, 'proj');
const PLUGINS = path.join(PROJ, 'plugins');
const BUILD = path.join(ROOT, 'build');

function vendorTools() {
  const tools = path.join(PROJ, '_tools');
  fs.mkdirSync(tools, { recursive: true });
  if (JUCE_DIR && fs.existsSync(JUCE_DIR)) {
    fs.symlinkSync(path.resolve(JUCE_DIR), path.join(tools, 'JUCE'), 'dir');
    console.log(`  vendored JUCE from ${JUCE_DIR}`);
  }
  if (CLAP_DIR && fs.existsSync(CLAP_DIR)) {
    fs.symlinkSync(path.resolve(CLAP_DIR), path.join(tools, 'clap'), 'dir');
    console.log(`  vendored clap from ${CLAP_DIR}`);
  }
}

function writeRootCMake(names) {
  // Deliberately minimal: NO explicit LANGUAGES and NO CMAKE_CXX_STANDARD here,
  // proving each plugin/app template enables C/CXX and C++20 on its own.
  const lines = [
    'cmake_minimum_required(VERSION 3.22)',
    'project(apc_smoke_host)',
    '',
  ];
  for (const n of names) lines.push(`add_subdirectory(plugins/${n})`);
  fs.writeFileSync(path.join(PROJ, 'CMakeLists.txt'), lines.join('\n') + '\n');
}

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

function verifyBuiltArtefacts(c, buildDir) {
  const artBase = path.join(buildDir, 'plugins', c.name, `${c.name}_artefacts`, 'Debug');
  if (c.type === 'clap') {
    const clapPath = path.join(artBase, 'CLAP', `${c.name}.clap`);
    if (!fs.existsSync(clapPath)) {
      fail(`${c.name} artefact`, `missing built CLAP binary at ${clapPath}`);
      return;
    }
    ok(`${c.name}: built CLAP artefact verified`);
    return;
  }
  if (c.type === 'lv2') {
    const bundleDir = path.join(artBase, 'LV2', `${c.name}.lv2`);
    for (const f of [`${c.name}.so`, 'manifest.ttl', 'plugin.ttl']) {
      if (!fs.existsSync(path.join(bundleDir, f))) {
        fail(`${c.name} artefact`, `missing ${f} inside ${bundleDir}`);
        return;
      }
    }
    ok(`${c.name}: built LV2 bundle verified (.so + manifest.ttl + plugin.ttl)`);
    return;
  }
  if (c.type === 'vst3' || c.type === 'juce') {
    const vst3Dir = path.join(artBase, 'VST3');
    const vst3s = fs.existsSync(vst3Dir)
      ? fs.readdirSync(vst3Dir).filter(n => n.toLowerCase().endsWith('.vst3'))
      : [];
    if (vst3s.length === 0) {
      fail(`${c.name} artefact`, `no .vst3 produced in ${vst3Dir}`);
      return;
    }
    if (c.type === 'juce') {
      const lv2Dir = path.join(artBase, 'LV2');
      const lv2s = fs.existsSync(lv2Dir)
        ? fs.readdirSync(lv2Dir).filter(n => n.toLowerCase().endsWith('.lv2'))
        : [];
      if (lv2s.length === 0) {
        fail(`${c.name} artefact`, `no .lv2 bundle produced in ${lv2Dir}`);
        return;
      }
    }
    ok(`${c.name}: built JUCE plugin artefact(s) verified`);
    return;
  }
  if (c.type === 'standalone') {
    const entries = fs.existsSync(artBase) ? fs.readdirSync(artBase, { withFileTypes: true }) : [];
    const hasApp = entries.some(e =>
      (e.isDirectory() && e.name.toLowerCase().endsWith('.app'))
      || (e.isFile() && e.name !== 'JuceLibraryCode')
    );
    if (!hasApp) {
      fail(`${c.name} artefact`, `no standalone executable/app found in ${artBase}`);
      return;
    }
    ok(`${c.name}: built standalone application verified`);
  }
}

// ── Run ───────────────────────────────────────────────────────────
fs.mkdirSync(PLUGINS, { recursive: true });
vendorTools();
writeRootCMake([]); // create needs an existing root before it will scaffold

const modeLabel = BUILD_TARGETS
  ? ' (with cmake configure + build)'
  : (CONFIGURE ? ' (with cmake configure)' : ' (structural only)');
console.log(`\nsmoke-scaffold${modeLabel}`);
console.log(`project: ${PROJ}\n`);

const created = [];

console.log('scaffolding:');
for (const c of CASES) {
  const r = await call('audio_plugin_create', {
    projectPath: PROJ, name: c.name, type: c.type, ui: c.ui,
    vendor: 'smokeco', description: 'smoke "quoted" test',
  });
  if (r.isError) { fail(`create ${c.name}`, r.text); continue; }

  const dir = path.join(PLUGINS, c.name);
  if (!fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
    fail(`create ${c.name}`, 'no CMakeLists.txt was written'); continue;
  }
  created.push({ ...c, dir, files: readTree(dir) });
  ok(`${c.name} (${c.type}/${c.ui})`);
}

console.log('\nstructural checks:');
const rootCmakeAfterCreate = fs.readFileSync(path.join(PROJ, 'CMakeLists.txt'), 'utf8');
for (const c of created) {
  for (const [rel, content] of c.files) {
    const left = content.match(/\{\{[^}]*\}\}/g);
    if (left) fail(`${c.name}/${rel}`, `unsubstituted placeholders: ${left.join(', ')}`);
  }
  if (!rootCmakeAfterCreate.includes(`add_subdirectory(plugins/${c.name})`)) {
    fail(`${c.name}`, 'audio_plugin_create did not register add_subdirectory() in root CMakeLists.txt');
  }
  const cm = c.files.get('CMakeLists.txt');
  const cmd = CMAKE_COMMAND_FOR_TYPE[c.type];
  if (!cmd) { fail(c.name, `no expected CMake command is known for type "${c.type}"`); continue; }
  const target = cm.match(new RegExp(`\\b${cmd}\\s*\\(\\s*([^\\s)]+)`))?.[1];
  if (target !== c.name) {
    fail(`${c.name}`, `${cmd} target is "${target}", expected "${c.name}"`);
  } else {
    ok(`${c.name}: ${cmd} target name & root CMake wiring verified`);
  }
}

if (!CONFIGURE) {
  console.log('\nskipping cmake configure/build (pass --configure or --build to run it)\n');
} else {
  const cmake = spawnSync('cmake', ['--version'], { encoding: 'utf-8' });
  if (cmake.status !== 0) {
    fail('--configure', 'cmake is not installed or not on PATH');
  } else {
    const hasNinja = spawnSync('ninja', ['--version'], { encoding: 'utf-8' }).status === 0;
    const genArgs = hasNinja ? ['-G', 'Ninja'] : [];
    const jobs = String(Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 2));

    console.log(`\nconfigure${BUILD_TARGETS ? ' + build' : ''} (${cmake.stdout.split('\n')[0]}${hasNinja ? ', Ninja' : ''}):`);
    const juceReady = JUCE_DIR !== '' && fs.existsSync(JUCE_DIR);
    const clapReady = CLAP_DIR !== '' && fs.existsSync(CLAP_DIR);
    const lv2Ready = LV2_DIR !== '' && fs.existsSync(LV2_DIR);

    const extraArgsFor = family =>
      family === 'lv2' ? [`-DLV2_INCLUDE_DIR=${LV2_DIR}`] : [];

    for (const [family, ready, depName] of [['clap', clapReady, 'APC_CLAP_DIR'],
                                             ['juce', juceReady, 'APC_JUCE_DIR'],
                                             ['lv2', lv2Ready, 'APC_LV2_DIR']]) {
      const members = created.filter(c => c.family === family);
      const names = members.map(c => c.name);
      if (names.length === 0) continue;
      if (!ready) { console.log(`  skip ${family}: ${depName} not set`); continue; }

      writeRootCMake(names);
      fs.rmSync(BUILD, { recursive: true, force: true });
      const res = spawnSync('cmake',
        ['-S', PROJ, '-B', BUILD, ...genArgs, '-DCMAKE_BUILD_TYPE=Debug', ...extraArgsFor(family)],
        { encoding: 'utf-8', timeout: 600000 });
      if (res.status !== 0) {
        fail(`${family}: cmake configure exited ${res.status}`,
          `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split('\n').slice(-40).join('\n'));
        continue;
      }
      ok(`${family}: configure succeeded (${names.join(', ')})`);

      if (BUILD_TARGETS) {
        const buildRes = spawnSync('cmake',
          ['--build', BUILD, '--config', 'Debug', '--parallel', jobs],
          { encoding: 'utf-8', timeout: 1800000 });
        if (buildRes.status !== 0) {
          fail(`${family}: cmake --build exited ${buildRes.status}`,
            `${buildRes.stdout ?? ''}\n${buildRes.stderr ?? ''}`.split('\n').slice(-60).join('\n'));
          continue;
        }
        ok(`${family}: cmake --build succeeded (${names.join(', ')})`);
        for (const c of members) verifyBuiltArtefacts(c, BUILD);
      }
    }
  }
}

fs.rmSync(ROOT, { recursive: true, force: true });

console.log(failures === 0
  ? `\nsmoke-scaffold: PASS (${created.length}/${CASES.length} scaffolded, ${failures} failures)\n`
  : `\nsmoke-scaffold: FAIL (${failures} failures)\n`);
process.exit(failures === 0 ? 0 : 1);
