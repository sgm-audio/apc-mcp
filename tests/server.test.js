// Happy-path coverage: the server starts, advertises its tools, and the two
// read-only/scaffolding tools behave.
//
// Refactored onto tests/helpers/mcp-client.mjs. This file previously carried its
// own stdio client that (a) duplicated the other two suites and (b) sent
// `tools/list` and `tools/call` with **no `initialize` handshake**, so it did not
// exercise the path a real MCP client takes. Assertions now use optional
// chaining so a response-shape change fails an assertion with a useful message
// instead of throwing a TypeError (AUDIT HYG-07).
//
// Fixtures live in os.tmpdir() like the rest of the suite, so a test run leaves
// nothing behind in the repo.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { call, listTools } from './helpers/mcp-client.mjs';

const TOOL_NAMES = [
  'audio_plugin_build',
  'audio_plugin_configure',
  'audio_plugin_create',
  'audio_plugin_lint',
  'audio_plugin_plugins',
  'audio_plugin_test',
  'audio_plugin_validate',
];

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-server-'));

// Create a minimal project root under the tmpdir fixture tree, which after()
// removes wholesale.
function withProject(name) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.22)\nproject(${name})\n`);
  return dir;
}

// Pull the first text block out of a tool result, or '' — never a throw.
function textOf(r) {
  return typeof r?.text === 'string' ? r.text : '';
}

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

describe('apc-mcp MCP server', () => {
  describe('tools/list', () => {
    it('advertises all 7 tools', async () => {
      const tools = await listTools();
      assert.ok(Array.isArray(tools) && tools.length > 0,
        `expected a tools array, got: ${JSON.stringify(tools)?.slice(0, 200)}`);
      assert.deepEqual(tools.map(t => t?.name).sort(), TOOL_NAMES);
    });

    it('each tool has a name and a populated inputSchema', async () => {
      const tools = await listTools();
      for (const tool of tools ?? []) {
        assert.ok(tool?.name, `a tool is missing its name: ${JSON.stringify(tool)?.slice(0, 200)}`);
        assert.ok(tool?.inputSchema, `${tool?.name} is missing inputSchema`);
        assert.ok(tool?.inputSchema?.properties, `${tool?.name} is missing inputSchema.properties`);
      }
    });
  });

  describe('audio_plugin_plugins', () => {
    it('reports not-found for a non-existent project', async () => {
      const r = await call('audio_plugin_plugins',
        { projectPath: path.join(ROOT, 'does-not-exist') });
      const text = textOf(r);
      assert.equal(r.isError, true, `expected isError, got: ${text}`);
      assert.match(text, /No|not found/i, `expected a not-found message, got: ${text}`);
    });

    it('detects an empty plugins dir', async () => {
      const dir = withProject('empty-test');
      const r = await call('audio_plugin_plugins', { projectPath: dir });
      const text = textOf(r);
      assert.equal(r.isError, false, text);
      assert.match(text, /plugins/i, `unexpected text: ${text}`);
      assert.match(text, /No|no\b/, `expected a "no plugins" message, got: ${text}`);
    });

    it('detects plugin subdirectories and their type', async () => {
      const dir = withProject('multi-plugin');
      const pluginDir = path.join(dir, 'plugins', 'MyPlugin');
      fs.mkdirSync(pluginDir);
      fs.writeFileSync(path.join(pluginDir, 'CMakeLists.txt'), '');
      fs.writeFileSync(path.join(pluginDir, 'status.json'), JSON.stringify({ type: 'VST3' }));

      const r = await call('audio_plugin_plugins', { projectPath: dir });
      const text = textOf(r);
      assert.equal(r.isError, false, text);
      assert.match(text, /MyPlugin/, `plugin not listed: ${text}`);
      assert.match(text, /VST3/, `type not reported: ${text}`);
    });

    it('reports an unreadable status.json instead of silently dropping it', async () => {
      const dir = withProject('bad-status');
      const pluginDir = path.join(dir, 'plugins', 'Broken');
      fs.mkdirSync(pluginDir);
      fs.writeFileSync(path.join(pluginDir, 'CMakeLists.txt'), '');
      fs.writeFileSync(path.join(pluginDir, 'status.json'), '{ this is not json');

      const r = await call('audio_plugin_plugins', { projectPath: dir, format: 'json' });
      const text = textOf(r);
      assert.equal(r.isError, false, `a malformed status.json must not break the listing: ${text}`);

      const plugins = JSON.parse(text);
      assert.equal(plugins[0]?.name, 'Broken', 'the plugin should still be listed');
      assert.ok(plugins[0]?.statusError,
        `the parse failure should be surfaced, not swallowed. entry: ${JSON.stringify(plugins[0])}`);
      assert.match(plugins[0].statusError, /status\.json/);
    });

    it('returns parseable JSON when format=json', async () => {
      const dir = withProject('json-test');
      const pluginDir = path.join(dir, 'plugins', 'Foo');
      fs.mkdirSync(pluginDir);
      fs.writeFileSync(path.join(pluginDir, 'CMakeLists.txt'), '');
      fs.writeFileSync(path.join(pluginDir, 'status.json'),
        JSON.stringify({ type: 'CLAP', status: 'stable' }));

      const r = await call('audio_plugin_plugins', { projectPath: dir, format: 'json' });
      const text = textOf(r);
      assert.equal(r.isError, false, text);

      let plugins;
      try {
        plugins = JSON.parse(text);
      } catch (e) {
        assert.fail(`format=json did not return valid JSON (${e.message}): ${text.slice(0, 300)}`);
      }
      assert.ok(Array.isArray(plugins), `expected an array, got: ${text.slice(0, 200)}`);
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0]?.name, 'Foo');
      assert.equal(plugins[0]?.type, 'CLAP');
    });
  });

  describe('audio_plugin_create', () => {
    it('rejects a call with no name', async () => {
      const r = await call('audio_plugin_create', { projectPath: ROOT });
      assert.equal(r.isError, true,
        `expected rejection, got: ${JSON.stringify(r)?.slice(0, 300)}`);
      // A zod schema failure surfaces as a JSON-RPC protocol error with empty
      // text; a handler-level rejection surfaces as isError with a message.
      // Either is a rejection — what must never happen is a scaffold.
      const text = textOf(r) || JSON.stringify(r.protocolError ?? '');
      assert.match(text, /required|invalid|expected|validation|undefined|name/i,
        `expected a validation message, got: ${text}`);
      assert.equal(fs.existsSync(path.join(ROOT, 'plugins')), false,
        'a rejected create must not write anything');
    });

    it('scaffolds a CLAP plugin with placeholders substituted', async () => {
      const dir = withProject('create-test');
      const r = await call('audio_plugin_create',
        { projectPath: dir, name: 'DemoPlugin', type: 'clap', vendor: 'test' });
      const text = textOf(r);
      assert.equal(r.isError, false, text);
      assert.match(text, /DemoPlugin/, `name not in output: ${text}`);
      assert.match(text, /CMakeLists\.txt/, `CMakeLists not in output: ${text}`);
      assert.match(text, /PluginProcessor\.cpp/, `source not in output: ${text}`);

      const cmakePath = path.join(dir, 'plugins', 'DemoPlugin', 'CMakeLists.txt');
      assert.ok(fs.existsSync(cmakePath), `${cmakePath} was not created`);
      const cmake = fs.readFileSync(cmakePath, 'utf8');
      assert.match(cmake, /DemoPlugin/, `placeholder not replaced: ${cmake.slice(0, 300)}`);
      assert.equal(cmake.match(/\{\{[^}]*\}\}/g), null,
        `unsubstituted placeholders in the generated CMake: ${cmake.match(/\{\{[^}]*\}\}/g)}`);
    });

    it('scaffolds a JUCE plugin with the requested formats', async () => {
      const dir = withProject('create-juce');
      const r = await call('audio_plugin_create',
        { projectPath: dir, name: 'JuceVerb', type: 'juce', vendor: 'test', formats: 'VST3;AU' });
      const text = textOf(r);
      assert.equal(r.isError, false, text);
      assert.match(text, /JuceVerb/);
      assert.match(text, /PluginProcessor\.cpp/);

      const cmake = fs.readFileSync(
        path.join(dir, 'plugins', 'JuceVerb', 'CMakeLists.txt'), 'utf8');
      assert.match(cmake, /FORMATS VST3;AU/, `requested formats not emitted: ${cmake.slice(0, 400)}`);
    });
  });

  describe('project resolution', () => {
    it('resolves the project from CWD when apc-mcp.json is present', async () => {
      const dir = withProject('cwd-test');
      fs.writeFileSync(path.join(dir, 'apc-mcp.json'), JSON.stringify({ buildDir: 'build' }));
      // No projectPath argument — the server must discover the root from its CWD.
      const r = await call('audio_plugin_plugins', {}, { cwd: dir });
      const text = textOf(r);
      assert.equal(r.isError, false,
        `CWD resolution failed: ${text || JSON.stringify(r)?.slice(0, 300)}`);
      assert.ok(text.length > 0, 'expected some output');
    });
  });

  describe('audio_plugin_build', () => {
    it('rejects a missing project without creating directories', async () => {
      const missing = path.join(ROOT, 'missing-' + Date.now());
      const r = await call('audio_plugin_build', { projectPath: missing });
      const text = textOf(r);
      assert.equal(r.isError, true, `expected failure, got: ${text}`);
      assert.equal(fs.existsSync(missing), false,
        'build must not mkdir a project root that does not exist');
      assert.equal(fs.existsSync(path.join(missing, 'build')), false,
        'build must not create a build directory for a non-existent project');
    });
  });
});
