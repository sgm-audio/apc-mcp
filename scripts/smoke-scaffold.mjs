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
//   APC_JUCE_DIR       path to a JUCE checkout (symlinked to <proj>/_tools/JUCE)
//   APC_ARA_SDK_PATH   path to the external ARA SDK root (initialized ARA_Library/ + ARA_API/)
//   APC_CLAP_DIR       path to a free-audio/clap checkout (symlinked to <proj>/_tools/clap)
//   APC_LV2_DIR        path to an lv2/lv2 include directory (contains lv2/core/lv2.h)
//
// Usage:
//   node scripts/smoke-scaffold.mjs                  # structural checks only
//   node scripts/smoke-scaffold.mjs --configure      # + cmake configure
//   node scripts/smoke-scaffold.mjs --build          # + cmake configure + compile/link + artefact check
//   node scripts/smoke-scaffold.mjs --build --install   # + `cmake --install --prefix` (S-4)
//   node scripts/smoke-scaffold.mjs --build --lv2lint   # + lv2lint on the built bundles (S-13)
//   node scripts/smoke-scaffold.mjs --build --clang-tidy  # + clang-tidy over the C/C++ sources
//   node scripts/smoke-scaffold.mjs --build --family=ara  # only the ARA case (JUCE + ARA SDK required)
//
// The extra flags each need a tool on PATH and every one of them FAILS when the
// tool is missing — a validation step that silently does nothing is worse than
// no step, because the job stays green. For the same reason a --build run fails
// when a family it was asked for has no SDK: use --family=<clap|juce|ara|lv2> (once
// per family, or not at all for all four) when the machine has only some SDKs.
//
// Exit code is non-zero if any check fails.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { call } from '../tests/helpers/mcp-client.mjs';

const INSTALL = process.argv.includes('--install');
const FAMILIES = process.argv.filter(a => a.startsWith('--family='))
  .map(a => a.slice('--family='.length));
const LV2_LINT = process.argv.includes('--lv2lint');
const CLANG_TIDY = process.argv.includes('--clang-tidy');
const BUILD_TARGETS = process.argv.includes('--build') || INSTALL || LV2_LINT || CLANG_TIDY;
const CONFIGURE = BUILD_TARGETS || process.argv.includes('--configure');
const JUCE_DIR = process.env.APC_JUCE_DIR || '';
const ARA_SDK_PATH = process.env.APC_ARA_SDK_PATH || '';
const JIVE_DIR = process.env.APC_JIVE_DIR || '';
const CLAP_DIR = process.env.APC_CLAP_DIR || '';
const LV2_DIR = process.env.APC_LV2_DIR || '';

// The scaffolded project lives in a temp directory, so clang-tidy's own upward
// search never reaches this repo's .clang-tidy. Pass it explicitly, or the run
// silently uses clang-tidy's default (tiny) check set.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLANG_TIDY_CONFIG = path.join(REPO_ROOT, '.clang-tidy');

const CASES = [
  { name: 'SmokeClap',      type: 'clap', ui: 'generic', family: 'clap' },
  { name: 'SmokeJuceGen',   type: 'juce', ui: 'generic', family: 'juce' },
  { name: 'SmokeJuceWv',    type: 'juce', ui: 'webview', family: 'juce' },
  { name: 'SmokeJuceJive',  type: 'juce', ui: 'jive',    family: 'juce' },
  { name: 'SmokeVst3Gen',   type: 'vst3', ui: 'generic', family: 'juce' },
  { name: 'SmokeVst3Wv',    type: 'vst3', ui: 'webview', family: 'juce' },
  { name: 'SmokeVst3Jive',  type: 'vst3', ui: 'jive',    family: 'juce' },
  { name: 'SmokeARA',       type: 'ara',  ui: 'generic', family: 'ara' },
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
  ara: 'juce_add_plugin',
  standalone: 'juce_add_gui_app', // an executable, not a plugin library
  lv2: 'add_library',             // a MODULE library, dlopen'd by the host
};

let failures = 0;
const fail = (label, detail) => {
  failures++;
  const text = String(detail);
  console.error(`  FAIL ${label}\n       ${text.split('\n').join('\n       ')}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const compact = text.trim().split('\n').slice(-15).join('%0A').replace(/\r/g, '');
    console.error(`::error title=${label}::${compact}`);
  }
};
const ok = label => console.log(`  ok   ${label}`);

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
  if (JIVE_DIR && fs.existsSync(JIVE_DIR)) {
    fs.symlinkSync(path.resolve(JIVE_DIR), path.join(tools, 'JIVE'), 'dir');
    console.log(`  vendored JIVE from ${JIVE_DIR}`);
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
  if (c.type === 'vst3' || c.type === 'juce' || c.type === 'ara') {
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
    const hasApp = entries.some(e => {
      if (e.isDirectory() && e.name.toLowerCase().endsWith('.app')) return true;
      if (!e.isFile()) return false;
      if (process.platform === 'win32') return e.name.toLowerCase().endsWith('.exe');
      if (path.extname(e.name) !== '') return false;
      try {
        return (fs.statSync(path.join(artBase, e.name)).mode & 0o111) !== 0;
      } catch {
        return false;
      }
    });
    if (!hasApp) {
      fail(`${c.name} artefact`, `no standalone executable/app found in ${artBase}`);
      return;
    }
    ok(`${c.name}: built standalone application verified`);
  }
}

// ── Optional verifiers ─────────────────────────────────────────────
// Each of these is a check a CI job opts into. They are written to FAIL when
// their tool is absent: a green job that validated nothing is the failure mode
// this repository keeps finding in other people's code.

function needTool(name, hint) {
  // Only ENOENT means "not installed": tools differ on whether `--version` exits
  // 0 (most), 1 (clang-tidy prints usage), so the exit status is not the signal.
  const probe = spawnSync(name, ['--version'], { encoding: 'utf-8' });
  const errno = /** @type {NodeJS.ErrnoException | undefined} */ (probe.error);
  if (errno?.code === 'ENOENT') {
    fail(`--${name}`, `${name} is not on PATH. Install it: ${hint}`);
    return false;
  }
  return true;
}

function lv2BundleDir(c, buildDir) {
  return path.join(buildDir, 'plugins', c.name, `${c.name}_artefacts`, 'Debug', 'LV2', `${c.name}.lv2`);
}

// S-4: an install rule with an ABSOLUTE destination bakes the configure-time
// prefix into cmake_install.cmake, so `cmake --install --prefix X` writes
// somewhere else entirely and X stays empty. Only running the install catches it.
function verifyLv2Install(members, buildDir) {
  const prefix = path.join(ROOT, 'installed');
  const defaultBundle = c => path.join('/usr/local/lib/lv2', `${c.name}.lv2`);
  const existedBefore = new Map(members.map(c => [c.name, fs.existsSync(defaultBundle(c))]));

  fs.rmSync(prefix, { recursive: true, force: true });
  const res = spawnSync('cmake', ['--install', buildDir, '--prefix', prefix],
    { encoding: 'utf-8', timeout: 300000 });
  if (res.status !== 0) {
    fail('--install', `cmake --install exited ${res.status}\n${(res.stdout ?? '') + (res.stderr ?? '')}`.slice(0, 2000));
    return;
  }

  for (const c of members) {
    // The destination must be RELATIVE (lib/lv2 or lib64/lv2 depending on the
    // distro), so search under the prefix instead of assuming one spelling.
    const found = [];
    (function walk(d, depth = 0) {
      if (depth > 6 || !fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === `${c.name}.lv2`) found.push(abs);
          else walk(abs, depth + 1);
        }
      }
    })(prefix);
    if (found.length !== 1) {
      fail(`${c.name} --install`, `expected exactly one ${c.name}.lv2 under ${prefix}, found ${found.length}`);
      continue;
    }
    const bundle = found[0];
    const missing = [`${c.name}.so`, 'manifest.ttl', 'plugin.ttl']
      .filter(f => !fs.existsSync(path.join(bundle, f)));
    if (missing.length) {
      fail(`${c.name} --install`, `bundle ${bundle} is missing ${missing.join(', ')}`);
      continue;
    }
    if (!existedBefore.get(c.name) && fs.existsSync(defaultBundle(c))) {
      fail(`${c.name} --install`,
        `install wrote ${defaultBundle(c)} despite --prefix ${prefix} — the DESTINATION is absolute`);
      continue;
    }
    ok(`${c.name}: cmake --install --prefix honoured (${path.relative(prefix, bundle)})`);
  }
}

// S-13: the Turtle is copied into the bundle and never parsed by anything in
// this repo otherwise. lv2lint is the reference validator: it loads the bundle
// through lilv, checks the description against lv2core, loads the plugin and
// exits non-zero when a test fails.
//
// It takes a plugin URI and searches the directories given with -I, not a path;
// and it exits non-zero when the URI cannot be found, so a typo here cannot turn
// into a quiet pass. No distribution packages it (not Debian, not Ubuntu, not
// Homebrew), hence the build-from-source hint.
function verifyLv2Metadata(members) {
  if (!needTool('lv2lint', 'build it from source: git clone https://git.open-music-kontrollers.ch/~hp/lv2lint && meson setup build && meson compile -C build')) return;
  for (const c of members) {
    const bundle = lv2BundleDir(c, BUILD);
    if (!fs.existsSync(bundle)) {
      fail(`${c.name} lv2lint`, `no built bundle at ${bundle}`);
      continue;
    }
    // Read the URI out of the manifest rather than re-deriving it: the bundle is
    // the thing under test.
    const uri = (fs.readFileSync(path.join(bundle, 'manifest.ttl'), 'utf8').match(/^<([^>]+)>/m) ?? [])[1];
    if (!uri) {
      fail(`${c.name} lv2lint`, 'manifest.ttl has no <plugin-uri> subject');
      continue;
    }
    // -I is handed straight to lilv_world_load_bundle(), which treats its
    // argument as the bundle directory (the one holding manifest.ttl), not as a
    // directory of bundles.
    const res = spawnSync('lv2lint', ['-I', bundle, uri],
      { encoding: 'utf-8', timeout: 120000 });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
    if (res.status !== 0) {
      fail(`${c.name} lv2lint`, `lv2lint rejected ${uri} (exit ${res.status}):\n${out.slice(0, 4000)}`);
    } else {
      // Default policy: a failed test exits non-zero, a warning is only reported.
      // Surface the warnings anyway — they are the S-13 class of finding.
      const warn = out.split('\n').filter(l => /WARN/i.test(l)).length;
      ok(`${c.name}: lv2lint accepts ${uri}${warn ? ` (${warn} warning lines)` : ''}`);
    }
  }
}

// The S-14/S-15/S-16 class: static analysis of the code we generate, using the
// compile database CMake emits so clang-tidy sees the same flags the build does.
function verifyClangTidy(members) {
  if (!needTool('clang-tidy', 'apt install clang-tidy, or the LLVM release for your platform')) return;
  const db = path.join(BUILD, 'compile_commands.json');
  if (!fs.existsSync(db)) {
    fail('--clang-tidy', `no compile database at ${db} — configure with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON`);
    return;
  }
  if (!fs.existsSync(CLANG_TIDY_CONFIG)) {
    fail('--clang-tidy', `no clang-tidy configuration at ${CLANG_TIDY_CONFIG}`);
    return;
  }
  for (const c of members) {
    const srcDir = path.join(PLUGINS, c.name, 'Source');
    if (!fs.existsSync(srcDir)) continue;
    for (const f of fs.readdirSync(srcDir).filter(n => /\.(c|cc|cpp)$/.test(n)).sort()) {
      const res = spawnSync('clang-tidy',
        ['-p', BUILD, `--config-file=${CLANG_TIDY_CONFIG}`, '--quiet', path.join(srcDir, f)],
        { encoding: 'utf-8', timeout: 300000 });
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
      if (res.status !== 0) {
        fail(`${c.name} clang-tidy ${f}`, `clang-tidy reported problems (exit ${res.status}):\n${out.slice(0, 4000)}`);
      } else if (/warning:|error:/.test(out)) {
        // .clang-tidy sets WarningsAsErrors, so a warning here means the config was
        // not picked up — which would make this check vacuous.
        fail(`${c.name} clang-tidy ${f}`,
          `.clang-tidy is not being applied (warnings were not promoted to errors):\n${out.slice(0, 2000)}`);
      } else {
        ok(`${c.name}: clang-tidy clean (${f})`);
      }
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────
const created = [];
try {
  fs.mkdirSync(PLUGINS, { recursive: true });
  vendorTools();
  writeRootCMake([]); // create needs an existing root before it will scaffold

  const extras = [INSTALL && 'install', LV2_LINT && 'lv2lint', CLANG_TIDY && 'clang-tidy']
    .filter(Boolean).map(x => ` + ${x}`).join('');
  const modeLabel = BUILD_TARGETS
    ? ` (with cmake configure + build${extras})`
    : (CONFIGURE ? ' (with cmake configure)' : ' (structural only)');
  console.log(`\nsmoke-scaffold${modeLabel}`);
  console.log(`project: ${PROJ}\n`);

  console.log('scaffolding:');
  for (const c of CASES) {
    const r = await call('apc', {
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
      fail(`${c.name}`, 'apc did not register add_subdirectory() in root CMakeLists.txt');
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
      const araSdkReady = ARA_SDK_PATH !== ''
        && fs.existsSync(path.join(ARA_SDK_PATH, 'ARA_Library', 'PlugIn', 'ARAPlug.h'))
        && fs.existsSync(path.join(ARA_SDK_PATH, 'ARA_API', 'ARAInterface.h'));
      const araReady = juceReady && araSdkReady;

      const extraArgsFor = family => {
        if (family === 'lv2') return [`-DLV2_INCLUDE_DIR=${LV2_DIR}`];
        if (family === 'ara') return [`-DAPC_ARA_SDK_PATH=${ARA_SDK_PATH}`];
        return [];
      };

      for (const family of FAMILIES) {
        if (!['clap', 'juce', 'ara', 'lv2'].includes(family)) {
          fail('--family', `unknown family "${family}" (expected clap, juce, ara or lv2)`);
        }
      }

      /** @type {Array<[string, boolean, string]>} */
      const FAMILY_DEPS = [['clap', clapReady, 'APC_CLAP_DIR'],
                           ['juce', juceReady, 'APC_JUCE_DIR'],
                           ['ara', araReady, 'APC_JUCE_DIR + APC_ARA_SDK_PATH'],
                           ['lv2', lv2Ready, 'APC_LV2_DIR']];
      for (const [family, ready, depName] of FAMILY_DEPS) {
        if (FAMILIES.length && !FAMILIES.includes(family)) continue;
        const members = created.filter(c => c.family === family);
        const names = members.map(c => c.name);
        if (names.length === 0) continue;
        if (!ready) {
          // A --build run that silently skips a family reports PASS for work it
          // never did. In CI each job sets its own SDK and names its family with
          // --family=, so a missing one is always a misconfiguration.
          if (BUILD_TARGETS) {
            const reason = family === 'ara'
              ? 'ARA build needs APC_JUCE_DIR and APC_ARA_SDK_PATH; the ARA SDK root must contain initialized ARA_Library/ and ARA_API/ submodules'
              : `cannot build the ${family} family without it — set ${depName}`;
            fail(`${family}: ${depName} missing or invalid`, reason);
          } else {
            console.log(`  skip ${family}: ${depName} missing or invalid (configure-only run)`);
          }
          continue;
        }

        writeRootCMake(names);
        fs.rmSync(BUILD, { recursive: true, force: true });
        const dbArgs = CLANG_TIDY ? ['-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'] : [];
        const res = spawnSync('cmake',
          ['-S', PROJ, '-B', BUILD, ...genArgs, '-DCMAKE_BUILD_TYPE=Debug', ...extraArgsFor(family), ...dbArgs],
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
          if (CLANG_TIDY) verifyClangTidy(members);
          if (family === 'lv2' && LV2_LINT) verifyLv2Metadata(members);
          if (family === 'lv2' && INSTALL) verifyLv2Install(members, BUILD);
        }
      }
    }
  }
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

console.log(failures === 0
  ? `\nsmoke-scaffold: PASS (${created.length}/${CASES.length} scaffolded, ${failures} failures)\n`
  : `\nsmoke-scaffold: FAIL (${failures} failures)\n`);
process.exit(failures === 0 ? 0 : 1);
