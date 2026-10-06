#!/usr/bin/env node
// apc-mcp — Audio Plugin Coder MCP Server
// Model Context Protocol server for audio plugin development workflows.
// Install: npx github:sgm-audio/apc-mcp
//
// SECURITY: This server uses spawnSync() with argument arrays (never shell strings).
// No user input reaches a shell interpreter — not even for binary discovery.
// No command injection possible. All filesystem writes are confined to the
// resolved project root by assertWithinProject().

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ─── Paths ──────────────────────────────────────────────────────────
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));

// OPS-03: the version was hardcoded here *and* in package.json, so the two could
// drift and `initialize` would report a stale server version. npm always includes
// package.json in the tarball regardless of the "files" allowlist, so reading it at
// runtime is correct both from a checkout and from an installed package.
const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version;
  } catch {
    // Only reachable if index.js is run detached from its package.json. Reporting a
    // placeholder is better than crashing the server at import time.
    return '0.0.0-unknown';
  }
})();
const TEMPLATES_DIR = path.join(PKG_DIR, 'templates');
const CONFIG_FILE = 'apc-mcp.json';

// ─── Input validation patterns ─────────────────────────────────────
// CMake target names: alphanumeric, underscores, hyphens, dots
const SAFE_TARGET = /^[a-zA-Z0-9_.-]+$/;
// CMake generators: alphanumeric, spaces, underscores, hyphens
const SAFE_GENERATOR = /^[a-zA-Z0-9_ -]+$/;
// CMake options flags: -DNAME=VALUE, space-separated
const SAFE_OPTIONS = /^[a-zA-Z0-9_= \/.\-+:@]+$/;
// Plugin names for creation: alphanumeric, underscores, hyphens
const SAFE_PLUGIN_NAME = /^[a-zA-Z0-9_-]+$/;
// Vendor names: alphanumeric, underscores, hyphens, dots
const SAFE_VENDOR = /^[a-zA-Z0-9_.-]+$/;
// Test name regex: printable ASCII only
const SAFE_REGEX = /^[\x20-\x7E]+$/;
// Description: printable ASCII
const SAFE_DESCRIPTION = /^[\x20-\x7E]+$/;
// JUCE format list: semicolon-separated format names
const SAFE_FORMATS = /^[a-zA-Z0-9_;-]+$/;
// Project path: block shell metacharacters
const SAFE_PATH = /^[a-zA-Z0-9_ \/.\-:@~]+$/;

function validatePath(p) {
  if (!SAFE_PATH.test(p)) {
    throw new Error(`Invalid path: contains shell metacharacters`);
  }
  return path.resolve(p);
}

// True when a path contains a ".." segment, on either separator style.
function hasDotDot(p) {
  return String(p).split(/[\\/]/).includes('..');
}

// Authoritative path-boundary guard. Operates on fully resolved absolute paths,
// so it cannot be bypassed by ".." segments, redundant separators, or by an
// absolute path supplied where a relative one was expected.
// Every value that gets joined onto the project root before being read from or
// written to must pass through here.
function assertWithinProject(projectRoot, candidate, label = 'path') {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`${label} escapes project root — rejected: ${candidate}`);
  }
  return resolved;
}

// ─── Prerequisite checking ─────────────────────────────────────────
const REQUIREMENTS = [
  { bin: 'cmake', for: 'build/configure', install: 'brew install cmake / apt install cmake / https://cmake.org/download' },
  { bin: 'ctest', for: 'test', install: 'Part of CMake — install cmake' },
  { bin: 'clang-format', for: 'lint', install: 'brew install clang-format / apt install clang-format' },
  { bin: 'pluginval', for: 'VST3 validation', install: 'https://github.com/Tracktion/pluginval/releases' },
  { bin: 'clap-validator', for: 'CLAP validation', install: 'https://github.com/CLAP-Workspace/clap-validator/releases' },
];

const _prereqCache = new Map();

// Resolve a binary against PATH directly — no subprocess, no shell.
//
// The previous implementation wrapped spawnSync() in try/catch and returned
// `true` unconditionally: spawnSync does NOT throw when a binary is missing, it
// returns { error, status }. That made every prerequisite check report "found",
// silently disabling this whole feature (AUDIT FUNC-04). It also shelled out via
// `sh -c`, contradicting this file's no-shell invariant (AUDIT HYG-01).
function binaryOnPath(bin) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()), '']
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return true;
      } catch {
        // Not present (or not executable) here — keep searching PATH.
      }
    }
  }
  return false;
}

function findBinary(bin) {
  if (_prereqCache.has(bin)) return _prereqCache.get(bin);
  const found = binaryOnPath(bin);
  _prereqCache.set(bin, found);
  return found;
}

function installHint(binName) {
  const req = REQUIREMENTS.find(r => r.bin === binName);
  const purpose = req ? ` (needed for ${req.for})` : '';
  const install = req ? `\n  Install: ${req.install}` : '';
  return `'${binName}' not found on PATH${purpose}.${install}`;
}

function requireTool(binName) {
  if (!findBinary(binName)) {
    throw new Error(installHint(binName));
  }
}

function checkOptionalTool(binName) {
  const req = REQUIREMENTS.find(r => r.bin === binName);
  const found = findBinary(binName);
  if (!found && req) {
    console.error(`[apc-mcp] Note: '${binName}' not found (needed for ${req.for}). ${req.install}`);
  }
  return found;
}

// ─── Secure process execution ──────────────────────────────────────
// Uses spawnSync with argument arrays — NO shell, NO injection.
// User-controlled values are passed as separate argv entries.

function spawn(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    timeout: (opts.timeout ?? 180) * 1000,
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
    cwd: opts.cwd,
    stdio: 'pipe',
  });
}

// spawnSync reports failures on `result.error` / `result.signal` — it does NOT
// throw. The previous try/catch here was unreachable, so a missing binary or a
// timeout surfaced as the meaningless "exit code null" (AUDIT FUNC-05).
function trySpawn(cmd, args, opts = {}) {
  const timeoutSec = opts.timeout ?? 180;
  const result = spawn(cmd, args, opts);

  if (result.error) {
    const code = result.error.code;
    if (code === 'ENOENT') {
      return { ok: false, output: '', stderr: installHint(cmd) };
    }
    if (code === 'ETIMEDOUT' || result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
      return {
        ok: false,
        output: result.stdout || '',
        stderr: `'${cmd}' timed out after ${timeoutSec}s and was killed.` +
                ` Partial output may be above; consider raising the timeout or narrowing the target.`,
      };
    }
    return { ok: false, output: '', stderr: `'${cmd}' could not be started: ${result.error.message}` };
  }

  const output = result.stdout || '';
  if (result.status === 0) return { ok: true, output };
  const stderr = result.stderr || '';
  return {
    ok: false,
    output,
    stderr: stderr || `'${cmd}' exited with code ${result.status}` +
      (result.signal ? ` after signal ${result.signal}` : ''),
  };
}

// ─── Config ──────────────────────────────────────────────────────────
const defaultConfig = {
  generator: 'Unix Makefiles',
  config: 'Debug',
  buildDir: 'build',
  pluginsDir: 'plugins',
  validateFormats: ['VST3', 'CLAP'],
  validateCommand: 'pluginval',
  clapValidatorCommand: 'clap-validator',
};

// Formats findPluginBinaries() actually knows how to locate.
const KNOWN_FORMATS = ['VST3', 'CLAP', 'LV2', 'AudioUnit', 'Standalone'];

// Per-key validators for apc-mcp.json. Config files are untrusted input in the
// same sense tool arguments are: they reach path.join() and spawnSync() argv.
// Previously the parsed JSON was spread over the defaults with no validation at
// all, so a non-array `validateFormats` crashed on .join() and a `buildDir` of
// "../x" escaped the project root (AUDIT SEC-03).
const RELATIVE_DIR = z.string()
  .regex(SAFE_PATH, 'may contain only letters, digits, spaces and _ / . \\ - : @ ~')
  .refine(p => !hasDotDot(p), 'may not contain ".." segments')
  .refine(p => !path.isAbsolute(p), 'must be relative to the project root');

const CONFIG_SCHEMA = {
  generator: z.string().regex(SAFE_GENERATOR, 'may contain only letters, digits, spaces, _ and -'),
  config: z.enum(['Debug', 'Release']),
  buildDir: RELATIVE_DIR,
  pluginsDir: RELATIVE_DIR,
  validateFormats: z.array(z.enum(KNOWN_FORMATS)).min(1),
  validateCommand: z.string().regex(SAFE_TARGET, 'may contain only letters, digits, _ . and -'),
  clapValidatorCommand: z.string().regex(SAFE_TARGET, 'may contain only letters, digits, _ . and -'),
};

// Validates each key independently so one bad value degrades to its default
// instead of discarding the whole file. Unknown keys are ignored, keeping the
// format forward-compatible.
function loadProjectConfig(projectPath) {
  const cfg = { ...defaultConfig };
  const configPath = path.join(projectPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) return cfg;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error(`[apc-mcp] Warning: ${CONFIG_FILE} is not valid JSON (${e.message}) — using defaults.`);
    return cfg;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error(`[apc-mcp] Warning: ${CONFIG_FILE} must be a JSON object — using defaults.`);
    return cfg;
  }

  for (const [key, value] of Object.entries(raw)) {
    const validator = CONFIG_SCHEMA[key];
    if (!validator) continue; // unknown key: tolerate for forward compatibility
    const result = validator.safeParse(value);
    if (result.success) {
      cfg[key] = result.data;
    } else {
      const issue = result.error.issues[0];
      console.error(`[apc-mcp] Warning: ignoring ${CONFIG_FILE} "${key}" — ${issue.message}. Using "${JSON.stringify(cfg[key])}".`);
    }
  }
  return cfg;
}

// ─── Project discovery ──────────────────────────────────────────────
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function resolveProjectPath(provided) {
  if (provided) return validatePath(provided);
  const detected = findProjectRoot(process.cwd());
  if (detected) return detected;
  return null;
}

// A project root must exist, be a directory, and carry one of the markers
// findProjectRoot() looks for. Without this the build tool happily mkdir -p'd a
// tree for a typo'd or attacker-supplied path and then reported on a project
// that never existed (AUDIT QA-05).
function assertProjectRoot(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new Error(`Project path not found: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${dir}`);
  }
  const hasMarker = fs.existsSync(path.join(dir, CONFIG_FILE)) ||
                    fs.existsSync(path.join(dir, 'CMakeLists.txt'));
  if (!hasMarker) {
    throw new Error(
      `Project path not found as a project root (no CMakeLists.txt or ${CONFIG_FILE}): ${dir}`
    );
  }
  return dir;
}

function requireProjectPath(provided) {
  const proj = resolveProjectPath(provided);
  if (!proj) throw new Error(
    'No project detected. Pass projectPath, create apc-mcp.json, ' +
    'or run from within (or under) a directory with CMakeLists.txt.'
  );
  return assertProjectRoot(proj);
}

// ─── Helpers ────────────────────────────────────────────────────────
function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Compiler/linker diagnostic shapes, in priority order. Each captures the
// severity as group 1.
//
// The previous implementation was `includes(': error:')` for errors and
// `/^.*warning:/` for warnings. The warning branch was literally equivalent to
// `includes('warning:')`, so it counted any line containing that substring —
// including source lines the compiler echoes *underneath* a diagnostic — while
// missing every MSVC diagnostic, which uses `error C2065:` / `warning C4244:`
// rather than a trailing colon (AUDIT QA-03, QA-04).
const DIAGNOSTIC_PATTERNS = [
  // clang / gcc:  /src/Foo.cpp:12:34: error: msg   (column optional)
  /^(?:[A-Za-z]:[\\/])?\S+?:\d+(?::\d+)?:\s*(fatal error|error|warning|note|remark)\s*:/i,
  // MSVC:         C:\src\Foo.cpp(12): error C2065: msg
  //               Foo.cpp(12,34): warning C4244: msg
  //               LINK : fatal error LNK1181  (handled by the tool-prefix rule)
  /^[^\s(]+\(\d+(?:,\d+)?\)\s*:\s*(fatal error|error|warning)\s+[A-Z]+\d*\s*:/i,
  // CMake:        CMake Error at CMakeLists.txt:12 (message):
  /^CMake\s+(Error|Warning)\b/i,
  // Tool-prefixed, no file:line — e.g. `ld: error: undefined symbol: foo`.
  // The colon must directly follow a single token, so prose and echoed source
  // lines (which contain spaces before the colon) cannot match.
  /^\S{1,64}:\s*(error|warning)\s*:/i,
];

// Returns 'error' | 'warning' | null. `note`/`remark` lines are context for a
// diagnostic already counted, so counting them would double-report.
function classifyDiagnostic(line) {
  for (const re of DIAGNOSTIC_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    if (kind === 'error' || kind === 'fatal error') return 'error';
    if (kind === 'warning') return 'warning';
    return null;
  }
  return null;
}

function parseBuildOutput(text) {
  const clean = stripAnsi(text);
  const lines = clean.split('\n');
  const errors = [];
  const warnings = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const kind = classifyDiagnostic(trimmed);
    if (kind === 'error') errors.push(trimmed);
    else if (kind === 'warning') warnings.push(trimmed);
  }

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.slice(0, 20),
    warnings: warnings.slice(0, 20),
    truncated: errors.length > 20 || warnings.length > 20,
  };
}

// Parses ctest output.
//
// The previous implementation counted occurrences of the words "passed" and
// "failed" anywhere in the stream, which meant ctest's own summary line
// ("100% tests passed, 0 tests failed out of 3") was counted as an extra pass
// AND an extra fail — a genuinely clean 3/0/3 run was reported as 4/1/5. Its
// total, `/^tests? (\d+)/im`, never matches ctest at all (AUDIT QA-02).
//
// Returns `recognized: false` when neither the summary nor any per-test line is
// found. Inventing numbers was the original bug; the caller reports the counts
// as unknown and lets ctest's exit status drive isError.
function parseTestOutput(text) {
  const clean = stripAnsi(text);

  // ctest's own summary is authoritative when present.
  const summary = clean.match(/(\d+)% tests passed,\s*(\d+) tests? failed out of (\d+)/);
  if (summary) {
    const failed = parseInt(summary[2], 10);
    const total = parseInt(summary[3], 10);
    return { total, passed: Math.max(total - failed, 0), failed, recognized: true };
  }

  // Otherwise count the per-test result lines, e.g.
  //   1/3 Test #1: FooTest ..........   Passed    0.02 sec
  //   2/3 Test #2: BarTest ..........***Failed    0.01 sec
  let passed = 0;
  let failed = 0;
  for (const line of clean.split('\n')) {
    const m = line.match(
      /^\s*\d+\/\d+ Test #\d+:.*?\b(Passed|Failed|\*\*\*Failed|\*\*\*Timeout|\*\*\*Not Run|\*\*\*Subprocess aborted|\*\*\*Exception)\b/
    );
    if (!m) continue;
    if (m[1] === 'Passed') passed++;
    else failed++;
  }
  if (passed + failed > 0) {
    return { total: passed + failed, passed, failed, recognized: true };
  }

  return { total: 0, passed: 0, failed: 0, recognized: false };
}

function findFilesByExt(dir, exts) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
        results.push(p);
      }
    }
  }
  walk(dir);
  return results;
}

function findPluginBinaries(projectPath, config, buildDir, formats) {
  const outDir = path.join(buildDir, 'plugins');
  if (!fs.existsSync(outDir)) return [];

  const results = [];
  const plugins = fs.readdirSync(outDir).filter(p =>
    fs.statSync(path.join(outDir, p)).isDirectory()
  );

  for (const plugin of plugins) {
    const artDir = path.join(outDir, plugin, `${plugin}_artefacts`, config);
    if (!fs.existsSync(artDir)) continue;

    for (const fmt of formats) {
      if (fmt === 'VST3') {
        const p = path.join(artDir, 'VST3', `${plugin}.vst3`);
        if (fs.existsSync(p)) results.push({ plugin, format: 'VST3', path: p });
      } else if (fmt === 'CLAP') {
        const d = path.join(artDir, 'CLAP');
        if (fs.existsSync(d)) {
          for (const f of fs.readdirSync(d).filter(f => f.endsWith('.clap')))
            results.push({ plugin, format: 'CLAP', path: path.join(d, f) });
        }
      } else if (fmt === 'LV2') {
        const p = path.join(artDir, 'LV2');
        if (fs.existsSync(p)) results.push({ plugin, format: 'LV2', path: p });
      } else if (fmt === 'AudioUnit') {
        const p = path.join(artDir, 'AudioUnit', `${plugin}.component`);
        if (fs.existsSync(p)) results.push({ plugin, format: 'AudioUnit', path: p });
      } else if (fmt === 'Standalone') {
        const p = path.join(artDir, 'Standalone');
        if (fs.existsSync(p)) results.push({ plugin, format: 'Standalone', path: p });
      }
    }
  }
  return results;
}

function replaceTemplateVars(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars))
    result = result.split(`{{${key}}}`).join(String(value));
  return result;
}

function mapPluginType(type, ui) {
  // JUCE-based types can choose webview or generic UI.
  // NOTE: 'ara' was removed from the schema — it mapped to the plain JUCE
  // template with FORMATS "ARA", which is not a valid juce_add_plugin format
  // and derives from juce::AudioProcessor rather than juce::ARAAudioProcessor.
  // It reported success while scaffolding a plugin that could never configure
  // (AUDIT FUNC-07). Restoring it requires a real ARA template first.
  const isWebView = ui === 'webview';
  switch (type) {
    case 'clap': return { template: 'clap', formats: 'CLAP' };
    case 'vst3': return { template: isWebView ? 'juce-webview' : 'juce', formats: 'VST3' };
    case 'juce':
    default:     return { template: isWebView ? 'juce-webview' : 'juce', formats: 'VST3;LV2;Standalone' };
  }
}

// Falls back to 'Plugin' when the name has no alphanumerics at all, so a name
// like "_" cannot produce an empty PLUGIN_ID and a class called just "Processor".
function slugName(name) {
  const alnum = String(name).replace(/[^a-zA-Z0-9]/g, '');
  return alnum.replace(/^(\d)/, '_$1') || 'Plugin';
}
function displayName(name) { return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim(); }

// JUCE four-character plugin IDs. Left unset, JUCE assigns PLUGIN_CODE
// randomly, which makes builds non-reproducible and can differ between
// configures — so derive stable codes instead.
//   manufacturer: 4 chars, at least one upper-case
//   plugin code:  4 chars, exactly one upper-case (the first), the rest lower —
//                 GarageBand requires that exact shape.
function fourCharCode(str, { exactlyOneUpper = false } = {}) {
  const alnum = String(str).replace(/[^a-zA-Z0-9]/g, '');
  let code = (alnum || 'apcm').slice(0, 4);
  if (code.length < 4) code = code.padEnd(4, exactlyOneUpper ? 'x' : 'X');
  return exactlyOneUpper
    ? code[0].toUpperCase() + code.slice(1).toLowerCase()
    : (/[A-Z]/.test(code) ? code : code[0].toUpperCase() + code.slice(1));
}

// Formats juce_add_plugin() actually accepts (verified against JUCE's
// _juce_get_plugin_kind_name). Rejecting anything else at the schema boundary
// is what stops the FUNC-07 class of bug — an advertised value that scaffolds a
// plugin which can never configure.
const JUCE_FORMATS = ['AU', 'AUv3', 'AAX', 'LV2', 'Standalone', 'Unity', 'VST', 'VST3'];

// Security: ensure plugin dir is within project boundary.
// Delegates to the shared guard so create and lint cannot drift apart.
function checkPluginPath(projectPath, pluginDir) {
  return assertWithinProject(projectPath, pluginDir, 'Plugin directory');
}

// ─── Server ─────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'apc-mcp',
  version: PKG_VERSION,
});

// Every handler runs inside this wrapper so that a thrown Error becomes a
// readable isError tool result rather than a bare JSON-RPC protocol error.
// MCP clients surface tool results to the model; protocol errors are often
// shown opaquely, which defeats the actionable install/path messages below.
function registerTool(name, schema, handler) {
  server.tool(name, schema, async (params) => {
    try {
      return await handler(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `## ${name} failed\n${message}` }],
        isError: true,
      };
    }
  });
}

// ─── audio_plugin_build ────────────────────────────────────────────
registerTool(
  'audio_plugin_build',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD if you have apc-mcp.json or CMakeLists.txt in a parent directory.'),
    config: z.enum(['Debug', 'Release']).optional()
      .describe('Build configuration. Debug includes symbols and assertions; Release is optimized. Falls back to "config" in apc-mcp.json, else Debug.'),
    target: z.string().regex(SAFE_TARGET).optional()
      .describe('Build only this CMake target (e.g. "MyPlugin_VST3", "MyPlugin_Standalone"). Omit to build all.'),
    clean: z.boolean().default(false)
      .describe('Clean build: rebuild everything from scratch.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('cmake');
    const cfg = loadProjectConfig(proj);
    const config = params.config ?? cfg.config ?? 'Debug';
    const buildDir = path.join(proj, cfg.buildDir);

    // Auto-configure if needed
    if (!fs.existsSync(path.join(buildDir, 'CMakeCache.txt'))) {
      fs.mkdirSync(buildDir, { recursive: true });
      const r = trySpawn('cmake', ['-B', buildDir, '-G', cfg.generator, `-DCMAKE_BUILD_TYPE=${config}`], { cwd: proj, timeout: 120 });
      if (!r.ok) {
        return { content: [{ type: 'text', text: `Configure failed:\n${r.stderr}` }], isError: true };
      }
    }

    const args = ['--build', buildDir, '--parallel'];
    if (params.clean) args.push('--clean-first');
    if (params.target) args.push('--target', params.target);
    const r = trySpawn('cmake', args, { cwd: proj });

    // Compilers write diagnostics to stderr and trySpawn keeps the streams
    // separate, so parsing only r.output left the "### Errors" section empty
    // precisely on the builds that failed (AUDIT QA-07).
    const parsed = parseBuildOutput(r.output + (r.stderr ? `\n${r.stderr}` : ''));
    const text = [
      `## Build ${r.ok ? 'succeeded' : 'failed'}`,
      `Config: ${config}${params.target ? ` | Target: ${params.target}` : ''}`,
      `Errors: ${parsed.errorCount}, Warnings: ${parsed.warningCount}`,
      ...(parsed.errors.length ? ['', '### Errors', ...parsed.errors] : []),
      ...(parsed.warnings.length ? ['', '### Warnings', ...parsed.warnings] : []),
      ...(parsed.truncated ? ['', '_(truncated to first 20 items)_'] : []),
    ].join('\n');

    // errorCount was already computed and printed above but never reached
    // isError, so a build that emitted compiler errors could report success when
    // cmake itself exited 0 (AUDIT HYG-12).
    return { content: [{ type: 'text', text }], isError: !r.ok || parsed.errorCount > 0 };
  }
);

// ─── audio_plugin_configure ────────────────────────────────────────
registerTool(
  'audio_plugin_configure',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).optional()
      .describe('Build configuration. Falls back to "config" in apc-mcp.json, else Debug.'),
    generator: z.string().regex(SAFE_GENERATOR).optional()
      .describe('CMake generator. Defaults to "Unix Makefiles". Common: "Ninja", "Unix Makefiles", "Xcode".'),
    options: z.string().regex(SAFE_OPTIONS).optional()
      .describe('Extra CMake flags. Example: -DAPC_ENABLE_VISAGE=ON -DMY_FLAG=OFF'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('cmake');
    const cfg = loadProjectConfig(proj);
    const config = params.config ?? cfg.config ?? 'Debug';
    const generator = params.generator || cfg.generator;
    const buildDir = path.join(proj, cfg.buildDir);
    fs.mkdirSync(buildDir, { recursive: true });

    const args = ['-B', buildDir, '-G', generator, `-DCMAKE_BUILD_TYPE=${config}`];
    if (params.options) {
      // Split space-separated flags safely — each token becomes its own argv entry
      for (const flag of params.options.split(/\s+/)) {
        if (flag) args.push(flag);
      }
    }
    const r = trySpawn('cmake', args, { cwd: proj, timeout: 120 });
    return { content: [{ type: 'text', text: r.ok ? 'Configure succeeded.' : r.stderr }], isError: !r.ok };
  }
);

// ─── audio_plugin_test ─────────────────────────────────────────────
registerTool(
  'audio_plugin_test',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).optional()
      .describe('Build configuration for the test executable. Falls back to "config" in apc-mcp.json, else Debug.'),
    testName: z.string().regex(SAFE_REGEX).optional()
      .describe('Run only tests matching this regex. Example: "MyPluginTest.*" to run a subset.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('ctest');
    const cfg = loadProjectConfig(proj);
    const config = params.config ?? cfg.config ?? 'Debug';
    const buildDir = path.join(proj, cfg.buildDir);

    const args = ['--test-dir', buildDir, '-C', config, '--output-on-failure'];
    if (params.testName) args.push('--tests-regex', params.testName);
    const r = trySpawn('ctest', args, { cwd: proj, timeout: 300 });

    const parsed = parseTestOutput(r.output);
    const text = [
      `## Tests ${r.ok ? 'passed' : 'failed'}`,
      // Reporting invented counts was the original bug (QA-02). When neither
      // ctest's summary nor its per-test lines are recognized, say so instead.
      parsed.recognized
        ? `Passed: ${parsed.passed}, Failed: ${parsed.failed}, Total: ${parsed.total}`
        : 'Passed: unknown, Failed: unknown, Total: unknown _(ctest output was not in a recognized format)_',
      // Include the raw tail when tests failed, when the run failed, or when the
      // output could not be parsed — otherwise the model has nothing to act on.
      ...((parsed.failed > 0 || !r.ok || !parsed.recognized)
        ? ['', '### Details', r.output.slice(-2000)]
        : []),
    ].join('\n');

    return { content: [{ type: 'text', text }], isError: !r.ok };
  }
);

// ─── audio_plugin_lint ─────────────────────────────────────────────
registerTool(
  'audio_plugin_lint',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    fix: z.boolean().default(false)
      .describe('Auto-fix formatting in place. Without this flag, runs as dry-run and reports files that would change.'),
    target: z.string().regex(SAFE_PATH).optional()
      .describe('Specific file or subdirectory to lint, relative to project root. Example: "plugins/Foo/Source". Must stay inside the project. Lints the whole project if omitted.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);

    // SECURITY (AUDIT SEC-01): `target` is joined onto the project root and then
    // handed to clang-format — with fix=true that is an in-place WRITE. SAFE_PATH
    // allows ".", so "../x" used to pass straight through and let a single tool
    // argument rewrite .cpp/.h files anywhere the user could write.
    // Two independent guards: reject ".." segments outright, then re-check the
    // fully resolved path against the project boundary (which also catches an
    // absolute target that points outside the project).
    let searchRoot = path.resolve(proj);
    if (params.target) {
      if (hasDotDot(params.target)) {
        return {
          content: [{ type: 'text', text:
            `## audio_plugin_lint failed\nInvalid target: ".." segments are not allowed — ` +
            `the path must stay within the project root. Rejected: ${params.target}` }],
          isError: true,
        };
      }
      try {
        searchRoot = assertWithinProject(proj, params.target, 'Lint target');
      } catch (e) {
        return { content: [{ type: 'text', text: `## audio_plugin_lint failed\n${e.message}` }], isError: true };
      }
    }

    // Validate input before touching the toolchain, so a bad path is reported
    // as a bad path rather than masked by an unrelated missing-binary error.
    requireTool('clang-format');

    if (!fs.existsSync(searchRoot)) {
      return { content: [{ type: 'text', text: `Path not found: ${searchRoot}` }], isError: true };
    }

    // Find files via Node.js walk (no shell pipeline needed)
    const files = findFilesByExt(searchRoot, ['.cpp', '.cc', '.cxx', '.h', '.hpp']);

    if (files.length === 0) {
      return { content: [{ type: 'text', text: 'No C++ source files found to lint.' }] };
    }

    const args = params.fix ? ['-i', ...files] : ['--dry-run', '-Werror', ...files];
    const r = trySpawn('clang-format', args, { cwd: proj, timeout: files.length > 100 ? 120 : 60 });

    // QA-01: with fix=true the exit status was never inspected, so a failing
    // clang-format reported "No formatting issues" — after it had already been
    // handed `-i` and rewritten files in place. That is the worst combination:
    // a destructive operation reported as a clean success.
    if (!r.ok && params.fix) {
      const text = [
        '## Lint could not apply fixes',
        `clang-format exited non-zero while writing in place across ${files.length} file(s).`,
        'Files may have been partially reformatted before it failed — review the diff.',
        '',
        '```',
        (r.stderr || r.output).slice(0, 2000),
        '```',
      ].join('\n');
      return { content: [{ type: 'text', text }], isError: true };
    }

    if (!r.ok) {
      // Extract filenames from stderr for the report
      const badFiles = files.filter(f => r.stderr.includes(f) || r.output.includes(f));
      const relative = badFiles.map(f => path.relative(proj, f));
      const text = [
        '## Lint found issues',
        `Files with problems: ${badFiles.length} of ${files.length}`,
        '',
        ...(relative.length ? ['```', ...relative.slice(0, 30), '```'] : []),
        'Run with fix=true to auto-format.',
      ].join('\n');
      return { content: [{ type: 'text', text }], isError: true };
    }

    return { content: [{ type: 'text', text: params.target
      ? `No formatting issues in ${params.target}.`
      : 'No formatting issues found across project.'
    }] };
  }
);

// ─── audio_plugin_plugins ──────────────────────────────────────────
registerTool(
  'audio_plugin_plugins',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    format: z.enum(['text', 'json']).default('text')
      .describe('Output format. "json" returns structured data the LLM can process. "text" is human-readable.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    const cfg = loadProjectConfig(proj);
    const pluginsDir = path.join(proj, cfg.pluginsDir);
    if (!fs.existsSync(pluginsDir)) {
      return { content: [{ type: 'text', text: `No ${cfg.pluginsDir}/ directory found in project.` }] };
    }

    const plugins = fs.readdirSync(pluginsDir).filter(p => {
      const pdir = path.join(pluginsDir, p);
      return fs.statSync(pdir).isDirectory() && fs.existsSync(path.join(pdir, 'CMakeLists.txt'));
    });

    const details = plugins.map(name => {
      const statusPath = path.join(pluginsDir, name, 'status.json');
      let meta = { name };
      if (fs.existsSync(statusPath)) {
        try { meta = { ...meta, ...JSON.parse(fs.readFileSync(statusPath, 'utf-8')) }; } catch {}
      }
      return meta;
    });

    if (params.format === 'json') {
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
    }

    if (!details.length) {
      return { content: [{ type: 'text', text: `Found ${cfg.pluginsDir}/ directory but no subdirectories with CMakeLists.txt.` }] };
    }

    const text = details.map(d => {
      const parts = [`- **${d.name}**`];
      if (d.type) parts.push(`type: ${d.type}`);
      if (d.status) parts.push(`status: ${d.status}`);
      return parts.join(' — ');
    }).join('\n');

    return { content: [{ type: 'text', text: `${details.length} plugin(s):\n${text}` }] };
  }
);

// ─── audio_plugin_validate ─────────────────────────────────────────
registerTool(
  'audio_plugin_validate',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).optional()
      .describe('Build configuration (matches the build you ran). Falls back to "config" in apc-mcp.json, else Debug.'),
    format: z.enum(['VST3', 'CLAP', 'all']).default('all')
      .describe('Which format to validate. "all" validates every format the project built for.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    const cfg = loadProjectConfig(proj);
    const config = params.config ?? cfg.config ?? 'Debug';
    const buildDir = path.join(proj, cfg.buildDir);

    const formats = params.format === 'all' ? cfg.validateFormats : [params.format];

    // QA-06 + HYG-03: the validator binaries come from the project config —
    // validateCommand and clapValidatorCommand were previously schema-validated
    // and then ignored in favour of hardcoded names. Availability is checked
    // ONCE, up front: the old code discarded checkOptionalTool()'s return value
    // and then called requireTool() from *inside* the results loop, so one
    // missing optional validator threw away every result already computed and
    // surfaced as an opaque tool error.
    const validatorFor = { VST3: cfg.validateCommand, CLAP: cfg.clapValidatorCommand };
    const validatorPresent = {};
    for (const fmt of formats) {
      const bin = validatorFor[fmt];
      if (bin && validatorPresent[bin] === undefined) {
        validatorPresent[bin] = checkOptionalTool(bin);
      }
    }

    const binaries = findPluginBinaries(proj, config, buildDir, formats);
    if (!binaries.length) {
      const hint = fs.existsSync(buildDir) ? '' : ' (build directory not found — run audio_plugin_build first)';
      return {
        content: [{ type: 'text', text: `No plugin binaries found for format(s): ${formats.join(', ')}.${hint}` }],
        isError: true,
      };
    }

    const results = [];
    for (const b of binaries) {
      const bin = validatorFor[b.format];

      // No validator configured for this format at all (LV2, AudioUnit,
      // Standalone). Report it as skipped rather than as a failure — the binary
      // is not bad, we simply cannot check it.
      if (!bin) {
        results.push({ ...b, passed: null, skipped: true,
          reason: `No validator is configured for ${b.format}.` });
        continue;
      }

      if (!validatorPresent[bin]) {
        results.push({ ...b, passed: null, skipped: true, reason: installHint(bin) });
        continue;
      }

      const args = b.format === 'VST3'
        ? ['--strictness', '10', '--validate-in-new-process', b.path]
        : [b.path];
      const r = trySpawn(bin, args, { timeout: 120 });
      results.push({
        ...b,
        passed: r.ok,
        output: r.ok ? '' : (r.stderr || r.output.slice(0, 1000)),
      });
    }

    const passed = results.filter(r => r.passed === true).length;
    const failed = results.filter(r => r.passed === false).length;
    const skipped = results.filter(r => r.skipped).length;

    const lines = [
      `## Validation results — ${passed} passed, ${failed} failed` +
        (skipped ? `, ${skipped} skipped` : ''),
    ];
    for (const r of results) {
      const status = r.skipped ? 'SKIPPED' : (r.passed ? 'PASS' : 'FAIL');
      lines.push(`\n### ${r.plugin} [${r.format}] — ${status}`);
      lines.push(`\`${r.path}\``);
      if (r.skipped) lines.push(`_${r.reason}_`);
      else if (!r.passed) lines.push(`\`\`\`\n${r.output}\n\`\`\``);
    }
    if (skipped > 0) {
      lines.push('', 'Validation is **incomplete** — install the missing validator(s) above and re-run.');
    }

    // An incomplete validation must never read as a clean one.
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      isError: failed > 0 || skipped > 0,
    };
  }
);

// ─── audio_plugin_create ───────────────────────────────────────────
registerTool(
  'audio_plugin_create',
  {
    projectPath: z.string().optional()
      .describe('Parent project root where the plugins/ directory lives. Auto-detected from CWD.'),
    name: z.string().min(1).regex(SAFE_PLUGIN_NAME)
      .describe('Plugin name. Use kebab-case, snake_case, or CamelCase. Examples: "Phaser9000", "my-delay", "TapeEcho".'),
    type: z.enum(['clap', 'vst3', 'juce']).default('clap')
      .describe('Plugin format. "clap" generates a standalone CLAP plugin. "vst3" generates a JUCE plugin targeting VST3 only. "juce" generates a JUCE AudioProcessor for VST3;LV2;Standalone. (ARA is not offered yet — it needs a dedicated template.)'),
    ui: z.enum(['generic', 'webview']).default('generic')
      .describe('UI style for JUCE/VST3 plugins. "generic" (default) uses JUCE\'s GenericAudioProcessorEditor. "webview" uses an HTML/CSS/JS WebView with parameter controls embedded via BinaryData.'),
    vendor: z.string().regex(SAFE_VENDOR).default('apc-mcp')
      .describe('Vendor/company name embedded in plugin metadata.'),
    description: z.string().regex(SAFE_DESCRIPTION).default('An audio plugin')
      .describe('Short description for plugin metadata.'),
    formats: z.string().regex(SAFE_FORMATS).optional()
      .describe('JUCE plugin formats override. Only for juce/vst3/ara types. Default: "VST3;LV2;Standalone".'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    const cfg = loadProjectConfig(proj);
    const typeInfo = mapPluginType(params.type, params.ui);
    const pluginDir = path.join(proj, cfg.pluginsDir, params.name);

    // SECURITY: Ensure plugin dir stays within project boundary
    checkPluginPath(proj, pluginDir);

    if (fs.existsSync(pluginDir)) {
      return { content: [{ type: 'text', text: `Already exists: ${pluginDir}` }], isError: true };
    }

    const templateDir = path.join(TEMPLATES_DIR, typeInfo.template);
    if (!fs.existsSync(templateDir)) {
      return { content: [{ type: 'text', text: `Template missing: ${typeInfo.template}. Reinstall apc-mcp.` }], isError: true };
    }

    const id = slugName(params.name);

    // Validate the JUCE format list before writing anything to disk. `formats`
    // reaches juce_add_plugin(FORMATS ...) verbatim, and an unknown value is a
    // configure-time failure the user would otherwise discover much later.
    const formats = params.formats || typeInfo.formats;
    if (typeInfo.template !== 'clap') {
      const requested = String(formats).split(';').map(s => s.trim()).filter(Boolean);
      if (requested.length === 0) {
        return { content: [{ type: 'text', text:
          `## audio_plugin_create failed\nformats must list at least one format. Valid: ${JUCE_FORMATS.join(', ')}` }],
          isError: true };
      }
      const unknown = requested.filter(f => !JUCE_FORMATS.includes(f));
      if (unknown.length) {
        return { content: [{ type: 'text', text:
          `## audio_plugin_create failed\nUnknown JUCE format${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.\n` +
          `Valid formats: ${JUCE_FORMATS.join(', ')}.` }], isError: true };
      }
    }

    const vars = {
      PLUGIN_NAME: params.name,
      PLUGIN_ID: id,
      PLUGIN_CLASS_NAME: id + 'Processor',
      PLUGIN_DISPLAY_NAME: displayName(params.name),
      PLUGIN_DESCRIPTION: params.description,
      PLUGIN_FORMATS: formats,
      VENDOR: params.vendor,
      MANUFACTURER_CODE: fourCharCode(params.vendor),
      PLUGIN_CODE: fourCharCode(params.name, { exactlyOneUpper: true }),
    };

    function copyDir(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, destPath);
        else if (entry.isFile()) {
          const content = replaceTemplateVars(fs.readFileSync(srcPath, 'utf-8'), vars);
          fs.writeFileSync(destPath, content, 'utf-8');
        }
      }
    }

    try { copyDir(templateDir, pluginDir); }
    catch (e) {
      return { content: [{ type: 'text', text: `Failed to create plugin: ${e.message}` }], isError: true };
    }

    const tree = [];
    function listDir(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        tree.push(`${prefix}${entry.isDirectory() ? '📁 ' : '📄 '}${entry.name}`);
        if (entry.isDirectory()) listDir(path.join(dir, entry.name), prefix + '  ');
      }
    }
    listDir(pluginDir);

    const text = [`## Created ${params.type} plugin: ${params.name}`, `Location: ${pluginDir}`, '', ...tree].join('\n');
    return { content: [{ type: 'text', text }] };
  }
);

// ─── Start ─────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[apc-mcp] Fatal:', err);
  process.exit(1);
});
