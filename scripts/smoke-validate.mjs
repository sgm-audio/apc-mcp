#!/usr/bin/env node
// End-to-end proof that `audio_plugin_validate` works against a REAL validator.
//
// The rest of the suite drives PATH shims, which proves the argv shape and the
// reporting logic but says nothing about whether upstream's binary accepts the
// invocation, or whether a freshly scaffolded plugin actually passes. This
// script closes that gap: it scaffolds one plugin, builds it with real cmake,
// then calls the real audio_plugin_validate and requires a PASS.
//
// It FAILS (exit 1) when a dependency is missing rather than skipping — a silent
// skip reading as a pass is the exact anti-pattern the 2.0.0 audit was written
// about. It is deliberately not part of `npm run check`; CI runs it in the
// `scaffold-clap-validate` and `scaffold-juce-validate` jobs.
//
// The phases are separable so a CI failure names its own cause instead of
// producing one opaque red step:
//
//   node scripts/smoke-validate.mjs --type=juce --phase=build    --dir=/tmp/x
//   node scripts/smoke-validate.mjs --type=juce --phase=validate --dir=/tmp/x
//
// Usage:
//   APC_CLAP_DIR=/path/to/clap node scripts/smoke-validate.mjs --type=clap
//   APC_JUCE_DIR=/path/to/JUCE node scripts/smoke-validate.mjs --type=juce
//
// Requirements:
//   build phase:    cmake (+ ninja optional), the SDK checkout named by the env var
//   validate phase: `clap-validator` / `pluginval` on PATH
//   juce + Linux:   a display (`xvfb-run -a …`: pluginval is a GUI application)

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call } from '../tests/helpers/mcp-client.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const TYPE = arg('type', 'clap');
const PHASE = arg('phase', 'all');
const EXPLICIT_DIR = arg('dir', '');

const CONFIG = {
  clap: {
    validator: 'clap-validator',
    sdkEnv: 'APC_CLAP_DIR',
    sdkDirName: 'clap',
    pluginType: 'clap',
    format: 'CLAP',
    suffix: '.clap',
  },
  juce: {
    validator: 'pluginval',
    sdkEnv: 'APC_JUCE_DIR',
    sdkDirName: 'JUCE',
    pluginType: 'juce',
    format: 'VST3',
    suffix: '.vst3',
  },
}[TYPE];

if (!CONFIG) {
  console.error(`smoke-validate: unknown --type=${TYPE} (expected "clap" or "juce")`);
  process.exit(2);
}
if (!['all', 'build', 'validate'].includes(PHASE)) {
  console.error(`smoke-validate: unknown --phase=${PHASE} (expected "all", "build" or "validate")`);
  process.exit(2);
}

let failures = 0;
const ok = label => console.log(`  ok   ${label}`);
const fail = (label, detail = '') => {
  failures++;
  console.error(`  FAIL ${label}${detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''}`);
};

// A PATH scan, not `which` and not spawning the binary: pluginval is a GUI app,
// so executing it just to see whether it exists is both slow and wrong.
function binaryOnPath(bin) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase())
    : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

const needBuild = PHASE !== 'validate';
const needValidate = PHASE !== 'build';
const sdkDir = process.env[CONFIG.sdkEnv] ?? '';
const validatorPath = needValidate ? binaryOnPath(CONFIG.validator) : null;

const problems = [];
if (needBuild && (!sdkDir || !fs.existsSync(sdkDir))) {
  problems.push(`${CONFIG.sdkEnv} must point at a ${CONFIG.sdkDirName} checkout`);
}
if (needBuild && !binaryOnPath('cmake')) problems.push('cmake is not on PATH');
if (needValidate && !validatorPath) problems.push(`'${CONFIG.validator}' is not on PATH`);
if (problems.length) {
  console.error(`smoke-validate (${TYPE}/${PHASE}): cannot run — required dependency missing:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nThis script does not skip: an unrun validator must not look like a pass.');
  process.exit(1);
}

const ownsDir = !EXPLICIT_DIR;
const root = EXPLICIT_DIR ? path.resolve(EXPLICIT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), `apc-validate-${TYPE}-`));
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

// ─────────────────────────────────────────────────── build ────
async function doBuild() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'apc-mcp.json'), '{}\n');
  fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(apc_validate_host)\n');
  fs.mkdirSync(path.join(proj, '_tools'), { recursive: true });
  fs.symlinkSync(path.resolve(sdkDir), path.join(proj, '_tools', CONFIG.sdkDirName), 'dir');

  console.log(`smoke-validate: ${TYPE} build\nproject: ${proj}`);

  const create = await call('audio_plugin_create', {
    projectPath: proj, name, type: CONFIG.pluginType, ui: 'generic',
    vendor: 'validator-smoke', description: 'validator smoke test',
  }, { timeoutMs: 60000 });
  if (create.isError) throw new Error(`audio_plugin_create failed:\n${create.text}`);
  ok(`scaffolded ${name} (${CONFIG.pluginType})`);

  fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
    'cmake_minimum_required(VERSION 3.22)\nproject(apc_validate_host)\n\n'
    + `add_subdirectory(plugins/${name})\n`);

  const hasNinja = spawnSync('ninja', ['--version'], { encoding: 'utf-8' }).status === 0;
  const configure = sh('cmake', ['-S', proj, '-B', build, ...(hasNinja ? ['-G', 'Ninja'] : []),
    '-DCMAKE_BUILD_TYPE=Debug']);
  if (configure.status !== 0) throw new Error('cmake configure failed (see output above)');
  ok('cmake configure succeeded');

  const jobs = String(Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 2));
  const built = sh('cmake', ['--build', build, '--config', 'Debug', '--parallel', jobs],
    { timeout: 1800000 });
  if (built.status !== 0) throw new Error('cmake --build failed (see output above)');
  ok('cmake --build succeeded');

  // Scan by suffix instead of constructing a path: the tool does the same, and
  // PRODUCT_NAME can legitimately differ from the directory name.
  const found = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.toLowerCase().endsWith(CONFIG.suffix)) found.push(abs); // macOS-style bundle
        else walk(abs);
      } else if (e.name.toLowerCase().endsWith(CONFIG.suffix)) found.push(abs);
    }
  })(build);

  if (found.length === 0) throw new Error(`no ${CONFIG.suffix} artefact anywhere under ${build}`);
  ok(`built artefact(s): ${found.map(f => path.relative(build, f)).join(', ')}`);
}

// ──────────────────────────────────────────────── validate ────
async function doValidate() {
  if (!fs.existsSync(path.join(proj, 'apc-mcp.json'))) {
    throw new Error(`no scaffolded project at ${proj} (run --phase=build first)`);
  }
  console.log(`smoke-validate: ${TYPE} validate\nproject: ${proj}\nvalidator: ${validatorPath}`);

  if (TYPE === 'clap') {
    const v = spawnSync(validatorPath, ['--version'], { encoding: 'utf-8', timeout: 30000 });
    console.log(`clap-validator --version → ${(v.stdout || v.stderr || '').trim().split('\n')[0] || '(none)'}`);
  }

  const res = await call('audio_plugin_validate',
    { projectPath: proj, config: 'Debug', format: CONFIG.format },
    { timeoutMs: 300000 });

  console.log(`\n----- audio_plugin_validate (${CONFIG.format}) -----\n${res.text}\n-----`);

  if (res.isError) fail('audio_plugin_validate reported isError', res.text);
  else ok('audio_plugin_validate reported isError=false');

  if (/—\s*PASS/m.test(res.text)) ok('a real validator run is reported as PASS');
  else fail('no PASS in the validation report', res.text);

  if (/SKIPPED|NOT CHECKABLE|MISSING-VALIDATOR/.test(res.text)) {
    fail('validation was not actually executed',
      'a skip must never satisfy this smoke test — check PATH, the validator binary name, '
      + 'and `validateCommand`/`clapValidatorCommand` in apc-mcp.json');
  } else {
    ok(`${CONFIG.validator} actually ran (nothing skipped)`);
  }
}

try {
  if (needBuild) await doBuild();
  if (needValidate) await doValidate();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  if (ownsDir) fs.rmSync(root, { recursive: true, force: true });
}

if (failures === 0) {
  console.log(`\nsmoke-validate (${TYPE}/${PHASE}): PASS\n`);
  process.exit(0);
}
console.error(`\nsmoke-validate (${TYPE}/${PHASE}): FAIL (${failures} failure(s))\n`);
process.exit(1);
