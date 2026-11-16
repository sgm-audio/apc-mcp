#!/usr/bin/env node
// End-to-end proof that `audio_plugin_validate` works against a REAL validator.
//
// The rest of the suite drives PATH shims, which proves the argv shape and the
// reporting logic but says nothing about whether upstream's binary accepts the
// invocation, or whether a freshly scaffolded plugin actually passes. This
// script closes that gap: it scaffolds one plugin, builds it with real cmake,
// then calls the real audio_plugin_validate and requires a PASS.
//
// That is the only way the sentence "pluginval / clap-validator support works"
// can be substantiated, so this script FAILS (exit 1) when a dependency is
// missing rather than skipping — a silent skip reading as a pass is the exact
// anti-pattern the 2.0.0 audit was written about. It is deliberately not part of
// `npm run check`; CI runs it in the `scaffold-clap-validate` and
// `scaffold-juce-validate` jobs.
//
// Usage:
//   APC_CLAP_DIR=/path/to/clap node scripts/smoke-validate.mjs --type=clap
//   APC_JUCE_DIR=/path/to/JUCE node scripts/smoke-validate.mjs --type=juce
//
// Requirements per type:
//   clap: cmake + ninja (or make), a free-audio/clap checkout, `clap-validator` on PATH
//   juce: cmake + ninja (or make), a JUCE 9 checkout, `pluginval` on PATH,
//         and a display on Linux (xvfb-run -a ...)

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call } from '../tests/helpers/mcp-client.mjs';

const argv = process.argv.slice(2);
const TYPE = argv.find(a => a.startsWith('--type='))?.slice('--type='.length) ?? 'clap';

const CONFIG = {
  clap: {
    validator: 'clap-validator',
    sdkEnv: 'APC_CLAP_DIR',
    sdkDirName: 'clap',
    pluginType: 'clap',
    format: 'CLAP',
    artefact: { dir: 'CLAP', suffix: '.clap' },
  },
  juce: {
    validator: 'pluginval',
    sdkEnv: 'APC_JUCE_DIR',
    sdkDirName: 'JUCE',
    pluginType: 'juce',
    format: 'VST3',
    artefact: { dir: 'VST3', suffix: '.vst3' },
  },
}[TYPE];

if (!CONFIG) {
  console.error(`smoke-validate: unknown --type=${TYPE} (expected "clap" or "juce")`);
  process.exit(2);
}

let failures = 0;
const ok = label => console.log(`  ok   ${label}`);
const fail = (label, detail = '') => {
  failures++;
  console.error(`  FAIL ${label}${detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''}`);
};

// ── Dependency checks: every one of these is mandatory ─────────────
// A PATH scan, not `which` and not spawning the binary: pluginval is a GUI app,
// so executing it just to see whether it exists is both slow and wrong.
function binaryOnPath(bin) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase())
    : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}
const whichStatus = bin => (binaryOnPath(bin) ? 'present' : 'missing');

const sdkDir = process.env[CONFIG.sdkEnv] ?? '';
const problems = [];
if (!sdkDir || !fs.existsSync(sdkDir)) {
  problems.push(`${CONFIG.sdkEnv} must point at a ${CONFIG.sdkDirName} checkout`);
}
if (whichStatus('cmake') === 'missing') problems.push('cmake is not on PATH');
if (whichStatus(CONFIG.validator) === 'missing') problems.push(`'${CONFIG.validator}' is not on PATH`);
if (problems.length) {
  console.error(`smoke-validate (${TYPE}): cannot run — required dependency missing:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nThis script does not skip: an unrun validator must not look like a pass.');
  process.exit(1);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), `apc-validate-${TYPE}-`));
const proj = path.join(root, 'proj');
const build = path.join(root, 'build');
const name = TYPE === 'clap' ? 'ValidateClap' : 'ValidateJuce';

function sh(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe', ...opts });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r;
}

try {
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'apc-mcp.json'), '{}\n');
  fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(apc_validate_host)\n');
  fs.mkdirSync(path.join(proj, '_tools'), { recursive: true });
  fs.symlinkSync(path.resolve(sdkDir), path.join(proj, '_tools', CONFIG.sdkDirName), 'dir');

  console.log(`smoke-validate: ${TYPE} with a real ${CONFIG.validator}\nproject: ${proj}`);

  // 1. Scaffold through the real MCP server.
  const create = await call('audio_plugin_create', {
    projectPath: proj, name, type: CONFIG.pluginType, ui: 'generic',
    vendor: 'validator-smoke', description: 'validator smoke test',
  }, { timeoutMs: 60000 });
  if (create.isError) throw new Error(`audio_plugin_create failed:\n${create.text}`);
  ok(`scaffolded ${name} (${CONFIG.pluginType})`);

  // 2. Wire the plugin into the root project and build it for real.
  fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(apc_validate_host)\n\n'
    + `add_subdirectory(plugins/${name})\n`);

  const hasNinja = spawnSync('ninja', ['--version'], { encoding: 'utf-8' }).status === 0;
  const configure = sh('cmake', ['-S', proj, '-B', build, ...(hasNinja ? ['-G', 'Ninja'] : []),
    '-DCMAKE_BUILD_TYPE=Debug']);
  if (configure.status !== 0) throw new Error('cmake configure failed');
  ok('cmake configure succeeded');

  const jobs = String(Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 2));
  const built = sh('cmake', ['--build', build, '--config', 'Debug', '--parallel', jobs],
    { timeout: 1800000 });
  if (built.status !== 0) throw new Error('cmake --build failed');
  ok('cmake --build succeeded');

  // 3. The artefact the validator will be pointed at must exist.
  const artDir = path.join(build, 'plugins', name, `${name}_artefacts`, 'Debug', CONFIG.artefact.dir);
  const artefacts = fs.existsSync(artDir)
    ? fs.readdirSync(artDir).filter(n => n.toLowerCase().endsWith(CONFIG.artefact.suffix))
    : [];
  if (artefacts.length === 0) {
    throw new Error(`no ${CONFIG.artefact.suffix} artefact in ${artDir}`);
  }
  ok(`built artefact: ${artefacts.join(', ')}`);

  // 4. The actual subject of this script: the tool, the real validator, a PASS.
  // Best effort only — pluginval is a GUI app and may ignore --version.
  const version = spawnSync(CONFIG.validator, ['--version'], { encoding: 'utf-8', timeout: 30000 });
  const versionLine = (version.stdout || version.stderr || '').trim().split('\n')[0];
  console.log(`\n${CONFIG.validator} --version → ${versionLine || '(no version output)'}`);

  const res = await call('audio_plugin_validate',
    { projectPath: proj, config: 'Debug', format: CONFIG.format },
    { timeoutMs: 300000 });

  console.log(`\n----- audio_plugin_validate (${CONFIG.format}) -----\n${res.text}\n-----`);

  if (res.isError) {
    fail('audio_plugin_validate reported isError', res.text.slice(0, 4000));
  } else {
    ok('audio_plugin_validate reported isError=false');
  }
  if (/—\s*PASS/m.test(res.text)) {
    ok('a real validator run is reported as PASS');
  } else {
    fail('no PASS in the validation report', res.text.slice(0, 2000));
  }
  if (/SKIPPED|NOT CHECKABLE/.test(res.text)) {
    fail('validation was skipped, not executed',
      'a skip must never satisfy this smoke test — check PATH and the validator binary name');
  } else {
    ok(`${CONFIG.validator} actually ran (nothing skipped)`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0
  ? `\nsmoke-validate (${TYPE}): PASS\n`
  : `\nsmoke-validate (${TYPE}): FAIL (${failures} failure(s))\n`);
process.exit(failures === 0 ? 0 : 1);
