#!/usr/bin/env node
// End-to-end scaffold smoke test.
//
// Drives the real MCP server to scaffold every plugin-type x ui combination into
// a throwaway project, then checks the output. With --configure it also runs real
// cmake, which is the only check that proves a scaffolded plugin actually
// configures.
//
// audio_plugin_create requires an existing project root and never rewrites it, so
// this script supplies a root CMakeLists.txt with project() + add_subdirectory(),
// exactly as a user would.
//
// Configure-time dependencies come from the environment, so the script stays
// useful on a laptop with no toolchain:
//   APC_JUCE_DIR   path to a JUCE checkout (symlinked to <proj>/_tools/JUCE)
//   APC_CLAP_DIR   path to a free-audio/clap checkout (symlinked to <proj>/_tools/clap)
// JUCE cases are scaffolded but only configured when APC_JUCE_DIR is set.
//
// Usage:
//   node scripts/smoke-scaffold.mjs                  # structural checks only
//   node scripts/smoke-scaffold.mjs --configure      # + cmake configure
//
// Exit code is non-zero if any check fails.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(PKG_DIR, 'index.js');

const CONFIGURE = process.argv.includes('--configure');
const JUCE_DIR = process.env.APC_JUCE_DIR || '';
const CLAP_DIR = process.env.APC_CLAP_DIR || '';

const CASES = [
  { name: 'SmokeClap',      type: 'clap', ui: 'generic', family: 'clap' },
  { name: 'SmokeJuceGen',   type: 'juce', ui: 'generic', family: 'juce' },
  { name: 'SmokeJuceWv',    type: 'juce', ui: 'webview', family: 'juce' },
  { name: 'SmokeVst3Wv',    type: 'vst3', ui: 'webview', family: 'juce' },
  { name: 'smoke-kebab',    type: 'clap', ui: 'generic', family: 'clap' },
  // A standalone application. `family` stays 'juce' because that is what
  // groups it for the optional cmake configure step — it needs JUCE, just like
  // the plugin templates. The CMake command it must use is different, and is
  // derived from `type` below rather than from `family`.
  { name: 'SmokeStandalone', type: 'standalone', ui: 'generic', family: 'juce' },
  { name: 'smoke_app',       type: 'standalone', ui: 'generic', family: 'juce' },
];

// The CMake command each scaffold type must define its target with. One table,
// keyed by `type`, so the structural check cannot drift from what the templates
// actually emit.
const CMAKE_COMMAND_FOR_TYPE = {
  clap: 'add_library',            // a plain shared library against free-audio/clap
  juce: 'juce_add_plugin',
  vst3: 'juce_add_plugin',
  standalone: 'juce_add_gui_app', // an executable, not a plugin library
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
      // Best effort: if stdin is already closed the server has exited and the
      // close handler below produces the real error.
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
  // One project() at the root, then every plugin as a subdirectory. Configuring
  // several plugins at once is deliberate: it is the multi-plugin collision case
  // (duplicate juce::* / clap targets) that an unguarded add_subdirectory causes.
  const lines = [
    'cmake_minimum_required(VERSION 3.22)',
    'project(apc_smoke_host CXX)',
    'set(CMAKE_CXX_STANDARD 20)',
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

// ── Run ───────────────────────────────────────────────────────────
fs.mkdirSync(PLUGINS, { recursive: true });
vendorTools();
writeRootCMake([]); // create needs an existing root before it will scaffold

console.log(`\nsmoke-scaffold${CONFIGURE ? ' (with cmake configure)' : ' (structural only)'}`);
console.log(`project: ${PROJ}\n`);

const created = [];

console.log('scaffolding:');
for (const c of CASES) {
  const r = await call('audio_plugin_create', {
    projectPath: PROJ, name: c.name, type: c.type, ui: c.ui,
    vendor: 'smokeco', description: 'smoke test',
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
for (const c of created) {
  for (const [rel, content] of c.files) {
    const left = content.match(/\{\{[^}]*\}\}/g);
    if (left) fail(`${c.name}/${rel}`, `unsubstituted placeholders: ${left.join(', ')}`);
  }
  const cm = c.files.get('CMakeLists.txt');
  const cmd = CMAKE_COMMAND_FOR_TYPE[c.type];
  if (!cmd) { fail(c.name, `no expected CMake command is known for type "${c.type}"`); continue; }
  const target = cm.match(new RegExp(`\\b${cmd}\\s*\\(\\s*([^\\s)]+)`))?.[1];
  if (target !== c.name) {
    fail(`${c.name}`, `${cmd} target is "${target}", expected "${c.name}"`);
  } else {
    ok(`${c.name}: ${cmd} target name is correct`);
  }
}

writeRootCMake(created.map(c => c.name));

if (!CONFIGURE) {
  console.log('\nskipping cmake configure (pass --configure to run it)\n');
} else {
  const cmake = spawnSync('cmake', ['--version'], { encoding: 'utf-8' });
  if (cmake.status !== 0) {
    fail('--configure', 'cmake is not installed or not on PATH');
  } else {
    console.log(`\nconfigure (${cmake.stdout.split('\n')[0]}):`);
    const juceReady = JUCE_DIR !== '' && fs.existsSync(JUCE_DIR);
    const clapReady = CLAP_DIR !== '' && fs.existsSync(CLAP_DIR);

    // Configure the families separately so a missing dependency in one does not
    // hide a real failure in the other.
    for (const [family, ready, depName] of [['clap', clapReady, 'APC_CLAP_DIR'],
                                             ['juce', juceReady, 'APC_JUCE_DIR']]) {
      const names = created.filter(c => c.family === family).map(c => c.name);
      if (names.length === 0) continue;
      if (!ready) { console.log(`  skip ${family}: ${depName} not set`); continue; }

      writeRootCMake(names);
      fs.rmSync(BUILD, { recursive: true, force: true });
      const res = spawnSync('cmake', ['-S', PROJ, '-B', BUILD, '-DCMAKE_BUILD_TYPE=Debug'],
        { encoding: 'utf-8', timeout: 600000 });
      if (res.status === 0) {
        ok(`${family}: configure succeeded (${names.join(', ')})`);
      } else {
        fail(`${family}: cmake configure exited ${res.status}`,
          `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split('\n').slice(-40).join('\n'));
      }
    }
  }
}

fs.rmSync(ROOT, { recursive: true, force: true });

console.log(failures === 0
  ? `\nsmoke-scaffold: PASS (${created.length}/${CASES.length} scaffolded, ${failures} failures)\n`
  : `\nsmoke-scaffold: FAIL (${failures} failures)\n`);
process.exit(failures === 0 ? 0 : 1);
