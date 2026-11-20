// Integration coverage for the ARA template's external-SDK configure guard.
// The test deliberately supplies no JUCE checkout: the ARA guard must fail
// before compiler discovery, JUCE FetchContent, or juce_add_plugin().

import { after, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { call } from './helpers/mcp-client.mjs';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-ara-cmake-'));
const PROJECT = path.join(ROOT, 'project');
const HOME = path.join(ROOT, 'home');
const CMAKE_PROBE = spawnSync('cmake', ['--version'], { encoding: 'utf8' });
const HAS_CMAKE = !CMAKE_PROBE.error && CMAKE_PROBE.status === 0;

after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

it('configure rejects an unset, empty, or incomplete ARA SDK before JUCE discovery', async t => {
  if (!HAS_CMAKE)
    return t.skip('cmake is not installed; install CMake to run the ARA configure integration test');

  fs.mkdirSync(PROJECT, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(PROJECT, 'CMakeLists.txt'), [
    'cmake_minimum_required(VERSION 3.22)',
    'project(ara_guard LANGUAGES NONE)',
    '',
  ].join('\n'));

  const created = await call('audio_plugin_create', {
    projectPath: PROJECT,
    name: 'GuardedARA',
    type: 'ara',
    ui: 'generic',
  }, {
    env: { HOME, APC_AUTO_CONFIGURE: '0' },
  });
  assert.equal(created.isError, false, created.text);

  fs.writeFileSync(path.join(PROJECT, 'CMakeLists.txt'), [
    'cmake_minimum_required(VERSION 3.22)',
    'project(ara_guard LANGUAGES NONE)',
    'add_subdirectory(plugins/GuardedARA)',
    '',
  ].join('\n'));

  const cases = [
    { label: 'unset', args: [] },
    { label: 'empty', args: ['-DAPC_ARA_SDK_PATH:PATH='] },
  ];
  for (const { label, args } of cases) {
    const configured = spawnSync('cmake', [
      '-S', PROJECT,
      '-B', path.join(ROOT, `build-${label}`),
      ...args,
    ], {
      encoding: 'utf8',
      timeout: 120000,
    });
    const output = `${configured.stdout ?? ''}\n${configured.stderr ?? ''}`;
    assert.notEqual(configured.status, 0,
      `${label} APC_ARA_SDK_PATH unexpectedly configured successfully:\n${output}`);
    assert.match(output,
      /ARA SDK path is required\.\s+Call juce_set_ara_sdk_path\(<path>\)\s+before\s+juce_add_plugin\./,
      `CMake did not report the required ARA SDK guard for ${label} path:\n${output}`);
    assert.doesNotMatch(output, /Failed to clone|Could not find.*JUCE/i,
      `the ${label}-SDK guard should run before JUCE discovery:\n${output}`);
  }

  const incompleteSdk = path.join(ROOT, 'incomplete-sdk');
  fs.mkdirSync(path.join(incompleteSdk, 'ARA_Library'), { recursive: true });
  const invalid = spawnSync('cmake', [
    '-S', PROJECT,
    '-B', path.join(ROOT, 'build-incomplete'),
    `-DAPC_ARA_SDK_PATH:PATH=${incompleteSdk}`,
  ], {
    encoding: 'utf8',
    timeout: 120000,
  });
  const invalidOutput = `${invalid.stdout ?? ''}\n${invalid.stderr ?? ''}`;
  assert.notEqual(invalid.status, 0,
    `an incomplete ARA SDK unexpectedly configured successfully:\n${invalidOutput}`);
  assert.match(invalidOutput,
    /APC_ARA_SDK_PATH must point to the initialized ARA_SDK root containing/,
    `CMake did not explain the required initialized SDK layout:\n${invalidOutput}`);
  assert.doesNotMatch(invalidOutput, /Failed to clone|Could not find.*JUCE/i,
    `the incomplete-SDK guard should run before JUCE discovery:\n${invalidOutput}`);
});
