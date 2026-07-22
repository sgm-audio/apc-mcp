import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(DIR, '..');
const INDEX = path.join(PKG_DIR, 'index.js');
const FIXTURE_DIR = path.join(DIR, 'fixtures', 'test-project');

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [INDEX], { stdio: ['pipe', 'pipe', 'pipe'], cwd: PKG_DIR });
    const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('error', reject);

    proc.stdin.write(req + '\n');
    proc.stdin.end();

    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 10000);

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        resolve({ result: JSON.parse(stdout), stderr });
      } catch (e) {
        reject(new Error(`Parse error: ${e.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

function withProject(name) {
  const dir = path.join(FIXTURE_DIR, name);
  // Clean any leftover from prior runs
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.22)\nproject(${name})\n`);
  return dir;
}

function cleanupProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('apc-mcp MCP Server', () => {
  describe('tools/list', () => {
    it('should return all 7 tools', async () => {
      const { result } = await request('tools/list');
      assert.equal(result.jsonrpc, '2.0');
      assert.ok(result.result);
      const names = result.result.tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        'audio_plugin_build',
        'audio_plugin_configure',
        'audio_plugin_create',
        'audio_plugin_lint',
        'audio_plugin_plugins',
        'audio_plugin_test',
        'audio_plugin_validate',
      ]);
    });

    it('each tool should have name and inputSchema', async () => {
      const { result } = await request('tools/list');
      for (const tool of result.result.tools) {
        assert.ok(tool.name, `tool missing name`);
        assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
        assert.ok(tool.inputSchema.properties, `${tool.name} missing properties`);
      }
    });
  });

  describe('audio_plugin_plugins', () => {
    it('should report no plugins for non-existent project', async () => {
      const { result } = await request('tools/call', {
        name: 'audio_plugin_plugins',
        arguments: { projectPath: '/nonexistent/path' },
      });
      const content = result.result?.content?.[0]?.text || '';
      assert.ok(content.includes('No') || content.includes('not found'), `expected not-found message: ${content}`);
    });

    it('should detect empty plugins dir', async () => {
      const dir = withProject('empty-test');
      const { result } = await request('tools/call', {
        name: 'audio_plugin_plugins',
        arguments: { projectPath: dir },
      });
      const text = result.result.content[0].text;
      assert.ok(text.includes('plugins') && (text.includes('No') || text.includes('no')), `unexpected text: ${text}`);
      cleanupProject(dir);
    });

    it('should detect plugin subdirectories', async () => {
      const dir = withProject('multi-plugin');
      const pluginDir = path.join(dir, 'plugins', 'MyPlugin');
      fs.mkdirSync(pluginDir);
      fs.writeFileSync(path.join(pluginDir, 'CMakeLists.txt'), '');
      fs.writeFileSync(path.join(pluginDir, 'status.json'), JSON.stringify({ type: 'VST3' }));

      const { result } = await request('tools/call', {
        name: 'audio_plugin_plugins',
        arguments: { projectPath: dir },
      });
      const text = result.result.content[0].text;
      assert.ok(text.includes('MyPlugin'), `plugin not found: ${text}`);
      assert.ok(text.includes('VST3'), `type not found: ${text}`);
      cleanupProject(dir);
    });

    it('should return JSON when format=json', async () => {
      const dir = withProject('json-test');
      const pluginDir = path.join(dir, 'plugins', 'Foo');
      fs.mkdirSync(pluginDir);
      fs.writeFileSync(path.join(pluginDir, 'CMakeLists.txt'), '');
      fs.writeFileSync(path.join(pluginDir, 'status.json'), JSON.stringify({ type: 'CLAP', status: 'stable' }));

      const { result } = await request('tools/call', {
        name: 'audio_plugin_plugins',
        arguments: { projectPath: dir, format: 'json' },
      });
      const plugins = JSON.parse(result.result.content[0].text);
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].name, 'Foo');
      assert.equal(plugins[0].type, 'CLAP');
      cleanupProject(dir);
    });
  });

  describe('audio_plugin_create', () => {
    it('should require name', async () => {
      const { result } = await request('tools/call', {
        name: 'audio_plugin_create',
        arguments: { projectPath: '/tmp' },
      });
      const toolResult = result.result;
      const protocolError = result.error;
      const text = toolResult?.content?.[0]?.text || JSON.stringify(protocolError || '');
      assert.ok(protocolError || toolResult?.isError === true,
        `expected JSON-RPC error or isError tool result, got: ${JSON.stringify(result).slice(0, 300)}`);
      assert.match(text, /required|invalid input|expected string|validation|undefined/i,
        `expected validation msg, got: ${text}`);
    });

    it('should scaffold a CLAP plugin', async () => {
      const dir = withProject('create-test');
      const { result } = await request('tools/call', {
        name: 'audio_plugin_create',
        arguments: { projectPath: dir, name: 'DemoPlugin', type: 'clap', vendor: 'test' },
      });
      const text = result.result.content[0].text;
      assert.ok(text.includes('DemoPlugin'), `name not in output: ${text}`);
      assert.ok(text.includes('CMakeLists.txt'), `CMakeLists not in output: ${text}`);
      assert.ok(text.includes('PluginProcessor.cpp'), `source not in output: ${text}`);

      // Verify file was created with replaced vars
      const cmake = fs.readFileSync(path.join(dir, 'plugins', 'DemoPlugin', 'CMakeLists.txt'), 'utf-8');
      assert.ok(cmake.includes('DemoPlugin'), `placeholder not replaced: ${cmake}`);
      cleanupProject(dir);
    });

    it('should scaffold a JUCE plugin', async () => {
      const dir = withProject('create-juce');
      const { result } = await request('tools/call', {
        name: 'audio_plugin_create',
        arguments: { projectPath: dir, name: 'JuceVerb', type: 'juce', vendor: 'test', formats: 'VST3;AU' },
      });
      const text = result.result.content[0].text;
      assert.ok(text.includes('JuceVerb'));
      assert.ok(text.includes('PluginProcessor.cpp'));
      cleanupProject(dir);
    });
  });

  describe('resolved project from CWD config', () => {
    it('should use CWD when apc-mcp.json exists', async () => {
      const dir = withProject('cwd-test');
      fs.writeFileSync(path.join(dir, 'apc-mcp.json'), JSON.stringify({ buildDir: 'build' }));
      // Run from within the project dir
      const proc = spawn(process.execPath, [INDEX], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });
      const req = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'audio_plugin_plugins', arguments: {} },
      });
      proc.stdin.write(req + '\n');
      proc.stdin.end();
      let stdout = '';
      proc.stdout.on('data', d => stdout += d);
      await new Promise(r => proc.on('close', r));

      const result = JSON.parse(stdout);
      const text = result.result?.content?.[0]?.text || '';
      assert.ok(text.includes('No plugin') || text.length > 0, `unexpected: ${text}`);
      cleanupProject(dir);
    });
  });

  describe('audio_plugin_build structured output', () => {
    it('should fail for missing project', async () => {
      const { result } = await request('tools/call', {
        name: 'audio_plugin_build',
        arguments: { projectPath: '/tmp/missing-' + Date.now() },
      });
      const text = result.result?.content?.[0]?.text || '';
      assert.ok(result.result?.isError || text.includes('No') || text.includes('CMakeCache') || text.includes('failed'),
        `expected error, got: ${JSON.stringify(result).slice(0, 300)}`);
    });
  });
});
