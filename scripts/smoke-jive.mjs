#!/usr/bin/env node
// End-to-end verification gate for JUCE (plain + JIVE) scaffolds.
//
// Scaffolds fresh plugins in a clean temporary directory, configures CMake,
// builds Debug and/or Release configurations, verifies dist/ staging, checks
// that JIVE UI symbols/assets are actually linked, and validates built .vst3
// bundles with real `pluginval --strictness-level 5 --validate-in-process`.
//
// Usage:
//   APC_JUCE_DIR=... APC_JIVE_DIR=... node scripts/smoke-jive.mjs [--config=Debug|Release|all] [--dir=/path] [--keep]
//
// Environment variables:
//   APC_JUCE_DIR   path to local JUCE checkout (symlinked to _tools/JUCE)
//   APC_JIVE_DIR   path to local JIVE checkout (symlinked to _tools/JIVE)
//   APC_STRICTNESS pluginval strictness level (default: 5)
//
// Never skips silently: fails non-zero if any required tool/SDK is missing.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call } from '../tests/helpers/mcp-client.mjs';

const argv = process.argv.slice(2);
const argVal = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const JUCE_DIR = process.env.APC_JUCE_DIR || '';
const JIVE_DIR = process.env.APC_JIVE_DIR || '';
const STRICTNESS = process.env.APC_STRICTNESS || '5';
const CONFIG_ARG = argVal('config', 'all');
const EXPLICIT_DIR = argVal('dir', '');
const SKIP_CLEANUP = argv.includes('--keep') || Boolean(EXPLICIT_DIR);

const CONFIGS = CONFIG_ARG === 'all' ? ['Debug', 'Release'] : [CONFIG_ARG];
for (const c of CONFIGS) {
  if (!['Debug', 'Release'].includes(c)) {
    console.error(`smoke-jive: invalid --config=${CONFIG_ARG} (expected Debug, Release, or all)`);
    process.exit(2);
  }
}

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

const problems = [];
if (!JUCE_DIR || !fs.existsSync(JUCE_DIR)) problems.push('APC_JUCE_DIR must point at a JUCE checkout');
if (!JIVE_DIR || !fs.existsSync(JIVE_DIR)) problems.push('APC_JIVE_DIR must point at a JIVE checkout');
if (!binaryOnPath('cmake')) problems.push('cmake is not on PATH');
if (!binaryOnPath('pluginval')) problems.push('pluginval is not on PATH');

if (problems.length) {
  console.error('smoke-jive: cannot run — missing requirements:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const root = EXPLICIT_DIR ? path.resolve(EXPLICIT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'apc-jive-e2e-'));
const proj = path.join(root, 'proj');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'inherit', ...opts });
  console.log(`[exit ${r.status}]`);
  return r;
}

let failures = 0;
const ok = msg => console.log(`  ok   ${msg}`);
const fail = (msg, detail = '') => {
  failures++;
  console.error(`  FAIL ${msg}${detail ? `\n       ${detail}` : ''}`);
};

try {
  const cases = [
    { name: 'PlainSmoke', ui: 'generic' },
    { name: 'JiveSmoke', ui: 'jive' },
  ];

  if (!fs.existsSync(path.join(proj, 'apc-mcp.json'))) {
    fs.mkdirSync(path.join(proj, '_tools'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'apc-mcp.json'), '{}\n');
    fs.writeFileSync(path.join(proj, 'CMakeLists.txt'),
      'cmake_minimum_required(VERSION 3.22)\nproject(apc_jive_e2e)\n');
    fs.symlinkSync(path.resolve(JUCE_DIR), path.join(proj, '_tools', 'JUCE'), 'dir');
    fs.symlinkSync(path.resolve(JIVE_DIR), path.join(proj, '_tools', 'JIVE'), 'dir');

    console.log(`smoke-jive e2e project: ${proj}`);

    for (const c of cases) {
      const r = await call('audio_plugin_create', {
        projectPath: proj,
        name: c.name,
        type: 'juce',
        ui: c.ui,
        formats: 'VST3',
        vendor: 'Acme Audio',
        description: `E2E ${c.ui} test plugin`,
      }, { timeoutMs: 60000 });
      if (r.isError) {
        fail(`scaffold ${c.name} (${c.ui})`, r.text);
      } else {
        ok(`scaffolded ${c.name} (juce/${c.ui})`);
      }
    }
  } else {
    console.log(`smoke-jive reusing scaffolded project: ${proj}`);
  }

  if (failures > 0) throw new Error('Scaffolding failed');

  const hasNinja = binaryOnPath('ninja') !== null;
  const jobs = String(Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 2));
  const pluginvalBin = binaryOnPath('pluginval');

  for (const config of CONFIGS) {
    const buildDir = path.join(proj, `build-${config.toLowerCase()}`);
    const cfgRes = run('cmake', [
      '-S', proj,
      '-B', buildDir,
      ...(hasNinja ? ['-G', 'Ninja'] : []),
      `-DCMAKE_BUILD_TYPE=${config}`,
    ], { timeout: 600000 });
    if (cfgRes.status !== 0) {
      fail(`cmake configure (${config})`, `exit ${cfgRes.status}`);
      continue;
    }
    ok(`cmake configure (${config})`);

    const cacheTxt = fs.readFileSync(path.join(buildDir, 'CMakeCache.txt'), 'utf8');
    if (!/^APC_USE_JIVE:BOOL=ON$/m.test(cacheTxt)) {
      fail(`cmake cache (${config})`, 'expected APC_USE_JIVE:BOOL=ON in CMakeCache.txt');
      continue;
    }
    ok(`CMakeCache.txt confirmed APC_USE_JIVE:BOOL=ON (${config})`);

    const osName = process.platform === 'darwin'
      ? 'macOS'
      : (process.platform === 'win32' ? 'Windows' : 'Linux');

    const buildRes = run('cmake', [
      '--build', buildDir,
      '--config', config,
      '--target', 'package',
      '--parallel', jobs,
    ], { timeout: 1800000 });
    if (buildRes.status !== 0) {
      fail(`cmake build (${config})`, `exit ${buildRes.status}`);
      continue;
    }
    ok(`cmake build --target package (${config})`);

    for (const c of cases) {
      const displayName = c.name;
      const pkgDir = path.join(buildDir, 'dist', `${c.name}-1.0.0-${osName}`);
      const distVst3 = path.join(pkgDir, `${displayName}.vst3`);
      const installTxt = path.join(pkgDir, 'INSTALL.txt');
      if (!fs.existsSync(distVst3)) {
        fail(`${c.name} dist/ (${config})`, `missing packaged VST3 bundle at ${distVst3}`);
        continue;
      }
      if (!fs.existsSync(installTxt)) {
        fail(`${c.name} INSTALL.txt (${config})`, `missing INSTALL.txt at ${installTxt}`);
        continue;
      }
      ok(`${c.name} packaged in dist/${c.name}-1.0.0-${osName}/ (VST3 + INSTALL.txt)`);

      if (c.ui === 'jive') {
        const soFiles = [];
        (function findSo(d) {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) findSo(p);
            else if (e.name.endsWith('.so') || e.name.endsWith('.vst3') || e.name === displayName) soFiles.push(p);
          }
        })(distVst3);
        const binaryText = soFiles.map(f => fs.readFileSync(f).toString('latin1')).join('\n');
        if (!binaryText.includes('MainView.xml') && !binaryText.includes('gain-readout')) {
          fail(`${c.name} JIVE binary check (${config})`,
            'built JIVE VST3 binary does not contain JIVE UI strings');
        } else {
          ok(`${c.name} verified JIVE UI linked into VST3 binary (${config})`);
        }
      }

      // Copy bundle to an isolated directory before pluginval to prove zero
      // dependency on build tree or local Source/UI paths.
      const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), `apc-iso-${c.name}-`));
      const isoVst3 = path.join(isoDir, `${displayName}.vst3`);
      (function copyDirSync(src, dst) {
        fs.mkdirSync(dst, { recursive: true });
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, e.name);
          const d = path.join(dst, e.name);
          if (e.isDirectory()) copyDirSync(s, d);
          else fs.copyFileSync(s, d);
        }
      })(distVst3, isoVst3);
      try {
        const valArgs = [
          '--strictness-level', STRICTNESS,
          '--validate-in-process',
          '--validate', isoVst3,
        ];
        const pvRes = run(pluginvalBin, valArgs, { timeout: 300000 });
        if (pvRes.status !== 0) {
          fail(`pluginval ${c.name} (${config})`, `exited ${pvRes.status}`);
        } else {
          ok(`pluginval --strictness-level ${STRICTNESS} PASS (isolated): ${c.name} (${config})`);
        }
      } finally {
        fs.rmSync(isoDir, { recursive: true, force: true });
      }
    }
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (!SKIP_CLEANUP) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`\nProject directory preserved at: ${proj}`);
}

console.log(failures === 0 ? '\nsmoke-jive: PASS\n' : `\nsmoke-jive: FAIL (${failures} failure(s))\n`);
process.exit(failures === 0 ? 0 : 1);
