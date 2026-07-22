#!/usr/bin/env node
// apc-mcp — Audio Plugin Coder MCP Server
// Model Context Protocol server for audio plugin development workflows.
// Install: npx github:sgm-audio/apc-mcp
//
// SECURITY: This server uses spawnSync() with argument arrays (never shell strings).
// No user input reaches a shell interpreter. No command injection possible.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ─── Paths ──────────────────────────────────────────────────────────
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
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

// ─── Prerequisite checking ─────────────────────────────────────────
const REQUIREMENTS = [
  { bin: 'cmake', for: 'build/configure', install: 'brew install cmake / apt install cmake / https://cmake.org/download' },
  { bin: 'ctest', for: 'test', install: 'Part of CMake — install cmake' },
  { bin: 'clang-format', for: 'lint', install: 'brew install clang-format / apt install clang-format' },
  { bin: 'pluginval', for: 'VST3 validation', install: 'https://github.com/Tracktion/pluginval/releases' },
  { bin: 'clap-validator', for: 'CLAP validation', install: 'https://github.com/CLAP-Workspace/clap-validator/releases' },
];

const _prereqCache = new Map();

function findBinary(bin) {
  if (_prereqCache.has(bin)) return _prereqCache.get(bin);
  try {
    // which with no user input — safe to use shell
    spawnSync('sh', ['-c', `which "${bin}" 2>/dev/null || command -v "${bin}" 2>/dev/null`], { stdio: 'pipe', encoding: 'utf-8' });
    _prereqCache.set(bin, true);
    return true;
  } catch {
    _prereqCache.set(bin, false);
    return false;
  }
}

function requireTool(binName) {
  const req = REQUIREMENTS.find(r => r.bin === binName);
  if (!findBinary(binName)) {
    const hint = req ? `\n  Install: ${req.install}` : '';
    throw new Error(`'${binName}' not found.${hint}`);
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
  const result = spawnSync(cmd, args, {
    timeout: (opts.timeout ?? 180) * 1000,
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
    cwd: opts.cwd,
    stdio: 'pipe',
  });
  return result;
}

function trySpawn(cmd, args, opts = {}) {
  try {
    const result = spawn(cmd, args, opts);
    const output = result.stdout || '';
    if (result.status === 0) {
      return { ok: true, output };
    }
    const stderr = result.stderr || '';
    return { ok: false, output, stderr: stderr || `exit code ${result.status}` };
  } catch (e) {
    // ENOENT means command not found
    if (e.code === 'ENOENT') {
      const req = REQUIREMENTS.find(r => r.bin === cmd);
      const hint = req ? `\n  Install: ${req.install}` : '';
      return { ok: false, output: '', stderr: `'${cmd}' not found.${hint}` };
    }
    return { ok: false, output: '', stderr: e.message };
  }
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

function loadProjectConfig(projectPath) {
  const configPath = path.join(projectPath, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
    } catch (e) {
      console.error(`[apc-mcp] Warning: invalid ${CONFIG_FILE}: ${e.message}`);
    }
  }
  return { ...defaultConfig };
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

function requireProjectPath(provided) {
  const proj = resolveProjectPath(provided);
  if (!proj) throw new Error(
    'No project detected. Pass projectPath, create apc-mcp.json, ' +
    'or run from within (or under) a directory with CMakeLists.txt.'
  );
  return proj;
}

// ─── Helpers ────────────────────────────────────────────────────────
function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function parseBuildOutput(text) {
  const clean = stripAnsi(text);
  const lines = clean.split('\n');
  const errors = [];
  const warnings = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes(': error:') || trimmed.match(/: error\d*\s*\(/)) {
      errors.push(trimmed);
    } else if (trimmed.includes(': warning:') || trimmed.match(/^.*warning:/)) {
      warnings.push(trimmed);
    }
  }

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.slice(0, 20),
    warnings: warnings.slice(0, 20),
    truncated: errors.length > 20 || warnings.length > 20,
  };
}

function parseTestOutput(text) {
  const clean = stripAnsi(text);
  const passed = (clean.match(/\bPassed\b/gi) || []).length;
  const failed = (clean.match(/\bFailed\b/gi) || []).length;
  const total = (clean.match(/^tests? (\d+)/im) || [])[1] || (passed + failed);
  return { total: parseInt(total) || passed + failed, passed, failed };
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
  // JUCE-based types can choose webview or generic UI
  const isWebView = ui === 'webview';
  switch (type) {
    case 'clap': return { template: 'clap', formats: 'CLAP' };
    case 'vst3': return { template: isWebView ? 'juce-webview' : 'juce', formats: 'VST3' };
    case 'juce': return { template: isWebView ? 'juce-webview' : 'juce', formats: 'VST3;LV2;Standalone' };
    case 'ara': return { template: 'juce', formats: 'ARA' };
    default: return { template: 'juce', formats: 'VST3;LV2;Standalone' };
  }
}

function slugName(name) { return name.replace(/[^a-zA-Z0-9]/g, '').replace(/^(\d)/, '_$1'); }
function displayName(name) { return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim(); }

// Security: ensure plugin dir is within project boundary
function checkPluginPath(projectPath, pluginDir) {
  const resolved = path.resolve(pluginDir);
  if (!resolved.startsWith(path.resolve(projectPath) + path.sep)) {
    throw new Error('Plugin directory escapes project root — rejected.');
  }
}

// ─── Server ─────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'apc-mcp',
  version: '1.5.0',
});

// ─── audio_plugin_build ────────────────────────────────────────────
server.tool(
  'audio_plugin_build',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD if you have apc-mcp.json or CMakeLists.txt in a parent directory.'),
    config: z.enum(['Debug', 'Release']).default('Debug')
      .describe('Build configuration. Debug includes symbols and assertions; Release is optimized.'),
    target: z.string().regex(SAFE_TARGET).optional()
      .describe('Build only this CMake target (e.g. "MyPlugin_VST3", "MyPlugin_Standalone"). Omit to build all.'),
    clean: z.boolean().default(false)
      .describe('Clean build: rebuild everything from scratch.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('cmake');
    const cfg = loadProjectConfig(proj);
    const config = params.config || cfg.config;
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

    const parsed = parseBuildOutput(r.output);
    const text = [
      `## Build ${r.ok ? 'succeeded' : 'failed'}`,
      `Config: ${config}${params.target ? ` | Target: ${params.target}` : ''}`,
      `Errors: ${parsed.errorCount}, Warnings: ${parsed.warningCount}`,
      ...(parsed.errors.length ? ['', '### Errors', ...parsed.errors] : []),
      ...(parsed.warnings.length ? ['', '### Warnings', ...parsed.warnings] : []),
      ...(parsed.truncated ? ['', '_(truncated to first 20 items)_'] : []),
    ].join('\n');

    return { content: [{ type: 'text', text }], isError: !r.ok };
  }
);

// ─── audio_plugin_configure ────────────────────────────────────────
server.tool(
  'audio_plugin_configure',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).default('Debug')
      .describe('Build configuration.'),
    generator: z.string().regex(SAFE_GENERATOR).optional()
      .describe('CMake generator. Defaults to "Unix Makefiles". Common: "Ninja", "Unix Makefiles", "Xcode".'),
    options: z.string().regex(SAFE_OPTIONS).optional()
      .describe('Extra CMake flags. Example: -DAPC_ENABLE_VISAGE=ON -DMY_FLAG=OFF'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('cmake');
    const cfg = loadProjectConfig(proj);
    const config = params.config || cfg.config;
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
server.tool(
  'audio_plugin_test',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).default('Debug')
      .describe('Build configuration for the test executable.'),
    testName: z.string().regex(SAFE_REGEX).optional()
      .describe('Run only tests matching this regex. Example: "MyPluginTest.*" to run a subset.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('ctest');
    const cfg = loadProjectConfig(proj);
    const config = params.config || cfg.config;
    const buildDir = path.join(proj, cfg.buildDir);

    const args = ['--test-dir', buildDir, '-C', config, '--output-on-failure'];
    if (params.testName) args.push('--tests-regex', params.testName);
    const r = trySpawn('ctest', args, { cwd: proj, timeout: 300 });

    const parsed = parseTestOutput(r.output);
    const text = [
      `## Tests ${r.ok ? 'passed' : 'failed'}`,
      `Passed: ${parsed.passed}, Failed: ${parsed.failed}, Total: ${parsed.total}`,
      ...(parsed.failed > 0 ? ['', '### Details', r.output.slice(-2000)] : []),
    ].join('\n');

    return { content: [{ type: 'text', text }], isError: !r.ok };
  }
);

// ─── audio_plugin_lint ─────────────────────────────────────────────
server.tool(
  'audio_plugin_lint',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    fix: z.boolean().default(false)
      .describe('Auto-fix formatting in place. Without this flag, runs as dry-run and reports files that would change.'),
    target: z.string().regex(SAFE_PATH).optional()
      .describe('Specific file or subdirectory to lint, relative to project root. Example: "plugins/Foo/Source". Lints the whole project if omitted.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    requireTool('clang-format');
    const searchRoot = params.target ? validatePath(path.join(proj, params.target)) : proj;
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

    if (!r.ok && !params.fix) {
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
server.tool(
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
server.tool(
  'audio_plugin_validate',
  {
    projectPath: z.string().optional()
      .describe('Root of a CMake audio plugin project. Auto-detected from CWD.'),
    config: z.enum(['Debug', 'Release']).default('Debug')
      .describe('Build configuration (matches the build you ran).'),
    format: z.enum(['VST3', 'CLAP', 'all']).default('all')
      .describe('Which format to validate. "all" validates every format the project built for.'),
  },
  async (params) => {
    const proj = requireProjectPath(params.projectPath);
    const cfg = loadProjectConfig(proj);
    const config = params.config || cfg.config;
    const buildDir = path.join(proj, cfg.buildDir);

    const formats = params.format === 'all' ? cfg.validateFormats : [params.format];

    for (const fmt of formats) {
      if (fmt === 'VST3') checkOptionalTool('pluginval');
      if (fmt === 'CLAP') checkOptionalTool('clap-validator');
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
      let r;
      if (b.format === 'VST3') {
        requireTool('pluginval');
        r = trySpawn('pluginval', ['--strictness', '10', '--validate-in-new-process', b.path], { timeout: 120 });
      } else if (b.format === 'CLAP') {
        requireTool('clap-validator');
        r = trySpawn('clap-validator', [b.path], { timeout: 120 });
      } else {
        r = { ok: false, output: '', stderr: `No validator for ${b.format}` };
      }
      results.push({
        plugin: b.plugin,
        format: b.format,
        path: b.path,
        passed: r.ok,
        output: r.ok ? '' : (r.stderr || r.output.slice(0, 1000)),
      });
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    const lines = [`## Validation results — ${passed} passed, ${failed} failed`];
    for (const r of results) {
      lines.push(`\n### ${r.plugin} [${r.format}] — ${r.passed ? 'PASS' : 'FAIL'}`);
      lines.push(`\`${r.path}\``);
      if (!r.passed) lines.push(`\`\`\`\n${r.output}\n\`\`\``);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }], isError: failed > 0 };
  }
);

// ─── audio_plugin_create ───────────────────────────────────────────
server.tool(
  'audio_plugin_create',
  {
    projectPath: z.string().optional()
      .describe('Parent project root where the plugins/ directory lives. Auto-detected from CWD.'),
    name: z.string().min(1).regex(SAFE_PLUGIN_NAME)
      .describe('Plugin name. Use kebab-case, snake_case, or CamelCase. Examples: "Phaser9000", "my-delay", "TapeEcho".'),
    type: z.enum(['clap', 'vst3', 'juce', 'ara']).default('clap')
      .describe('Plugin format. "clap" generates a standalone CLAP plugin. "juce" generates a JUCE AudioProcessor.'),
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
    const vars = {
      PLUGIN_NAME: params.name,
      PLUGIN_ID: id,
      PLUGIN_CLASS_NAME: id + 'Processor',
      PLUGIN_DISPLAY_NAME: displayName(params.name),
      PLUGIN_DESCRIPTION: params.description,
      PLUGIN_FORMATS: params.formats || typeInfo.formats,
      VENDOR: params.vendor,
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
