// MCP Prompts protocol tests (`prompts/list` & `prompts/get`)
//
// Verifies that:
// 1. The server advertises the `prompts` capability during `initialize`.
// 2. `prompts/list` returns all 4 slash commands (`apc:new`, `apc:ui`, `apc:ship`, `apc:doctor`)
//    with valid descriptions and argument schemas (`required: true/false`).
// 3. `prompts/get` renders deterministic, context-rich instructions per prompt and rejects
//    missing required arguments per the MCP specification.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeInfo, listPrompts, getPrompt } from './helpers/mcp-client.mjs';

const EXPECTED_PROMPT_NAMES = ['apc:doctor', 'apc:new', 'apc:ship', 'apc:ui'];

describe('MCP Prompts (`prompts/list` & `prompts/get` native slash commands)', () => {
  it('advertises the prompts capability during MCP initialize', async () => {
    const init = await initializeInfo();
    assert.ok(init?.capabilities?.prompts,
      `expected capabilities.prompts in initialize response, got: ${JSON.stringify(init)}`);
  });

  it('prompts/list returns all 4 prompts with valid argument schemas', async () => {
    const prompts = await listPrompts();
    assert.ok(Array.isArray(prompts) && prompts.length === 4,
      `expected 4 prompts, got: ${JSON.stringify(prompts)}`);
    assert.deepEqual(prompts.map(p => p.name).sort(), EXPECTED_PROMPT_NAMES);

    const byName = Object.fromEntries(prompts.map(p => [p.name, p]));

    // 1. apc:new — name (required), style (optional)
    const pNew = byName['apc:new'];
    assert.ok(pNew.description, 'apc:new must have a description');
    const newArgs = Object.fromEntries((pNew.arguments ?? []).map(a => [a.name, a]));
    assert.equal(newArgs.name?.required, true, 'apc:new argument "name" must be required');
    assert.equal(newArgs.style?.required, false, 'apc:new argument "style" must be optional');

    // 2. apc:ui — design (required)
    const pUi = byName['apc:ui'];
    assert.ok(pUi.description, 'apc:ui must have a description');
    const uiArgs = Object.fromEntries((pUi.arguments ?? []).map(a => [a.name, a]));
    assert.equal(uiArgs.design?.required, true, 'apc:ui argument "design" must be required');

    // 3. apc:ship — version (optional)
    const pShip = byName['apc:ship'];
    assert.ok(pShip.description, 'apc:ship must have a description');
    const shipArgs = Object.fromEntries((pShip.arguments ?? []).map(a => [a.name, a]));
    assert.equal(shipArgs.version?.required, false, 'apc:ship argument "version" must be optional');

    // 4. apc:doctor — no required arguments
    const pDoc = byName['apc:doctor'];
    assert.ok(pDoc.description, 'apc:doctor must have a description');
    assert.equal((pDoc.arguments ?? []).filter(a => a.required).length, 0,
      'apc:doctor must have zero required arguments');
  });

  it('prompts/get("apc:new") renders deterministic instructions for doctor, create (juce+jive), hot-reload, and next steps', async () => {
    const r = await getPrompt('apc:new', { name: 'TapeSaturation', style: 'fx' });
    assert.equal(r.isError, false, `prompts/get apc:new failed: ${JSON.stringify(r.protocolError)}`);
    assert.ok(Array.isArray(r.messages) && r.messages.length >= 1, 'must return at least 1 message');
    assert.equal(r.messages[0].role, 'user');
    assert.equal(r.messages[0].content?.type, 'text');

    assert.match(r.text, /audio_plugin_doctor/, 'apc:new must instruct calling audio_plugin_doctor if cache is cold');
    assert.match(r.text, /audio_plugin_create/, 'apc:new must instruct calling audio_plugin_create');
    assert.match(r.text, /TapeSaturation/, 'apc:new must embed the requested plugin name');
    assert.match(r.text, /type="juce"/, 'apc:new must specify type="juce"');
    assert.match(r.text, /ui="jive"/, 'apc:new must specify ui="jive"');
    assert.match(r.text, /style="fx"/, 'apc:new must include the requested style');
    assert.match(r.text, /hot-reload|MainView\.xml/i, 'apc:new must mention the hot-reload path');

    // Deterministic check: calling with identical arguments produces identical output
    const r2 = await getPrompt('apc:new', { name: 'TapeSaturation', style: 'fx' });
    assert.equal(r.text, r2.text, 'apc:new rendering must be deterministic');
  });

  it('prompts/get("apc:ui") renders instructions for MainView.xml, Styles.json, PluginProcessor.cpp, audio_plugin_add_param, Source/UI/Presets/, and Debug compile check', async () => {
    const design = 'Add a vintage drive knob (0 to 24 dB) and output trim slider';
    const r = await getPrompt('apc:ui', { design });
    assert.equal(r.isError, false, `prompts/get apc:ui failed: ${JSON.stringify(r.protocolError)}`);
    assert.equal(r.messages[0]?.role, 'user');
    assert.equal(r.messages[0]?.content?.type, 'text');

    assert.ok(r.text.includes(design), 'apc:ui must embed the user design prompt');
    assert.match(r.text, /Source\/UI\/MainView\.xml/, 'apc:ui must reference Source/UI/MainView.xml');
    assert.match(r.text, /Source\/UI\/Styles\.json/, 'apc:ui must reference Source/UI/Styles.json');
    assert.match(r.text, /Source\/PluginProcessor\.cpp/, 'apc:ui must reference Source/PluginProcessor.cpp');
    assert.match(r.text, /audio_plugin_add_param/, 'apc:ui must instruct using audio_plugin_add_param');
    assert.match(r.text, /Source\/UI\/Presets\//, 'apc:ui must reference Source/UI/Presets/ primitives');
    assert.match(r.text, /Debug/i, 'apc:ui must instruct running a Debug compile check for hot-reload readiness');
  });

  it('prompts/get("apc:ship") defaults version to "0.1.0" and instructs self-healing up to 3 times before reporting dist/ and DAW rescan', async () => {
    const rDefault = await getPrompt('apc:ship', {});
    assert.equal(rDefault.isError, false, `prompts/get apc:ship failed: ${JSON.stringify(rDefault.protocolError)}`);
    assert.match(rDefault.text, /0\.1\.0/, 'apc:ship must default version to "0.1.0" when omitted');
    assert.match(rDefault.text, /audio_plugin_ship/, 'apc:ship must instruct calling audio_plugin_ship');
    assert.match(rDefault.text, /installLocal\s*[:=]\s*true/i, 'apc:ship must pass installLocal=true');
    assert.match(rDefault.text, /3 times/i, 'apc:ship must instruct retrying/self-healing up to 3 times');
    assert.match(rDefault.text, /dist\//, 'apc:ship must mention reporting the final dist/ path');
    assert.match(rDefault.text, /DAW|rescan/i, 'apc:ship must mention DAW rescan instructions');

    const rCustom = await getPrompt('apc:ship', { version: '2.4.0' });
    assert.equal(rCustom.isError, false);
    assert.match(rCustom.text, /2\.4\.0/, 'apc:ship must use explicit version when provided');
  });

  it('prompts/get("apc:doctor") renders instructions to run audio_plugin_doctor and output a readiness matrix', async () => {
    const r = await getPrompt('apc:doctor');
    assert.equal(r.isError, false, `prompts/get apc:doctor failed: ${JSON.stringify(r.protocolError)}`);
    assert.equal(r.messages[0]?.role, 'user');
    assert.equal(r.messages[0]?.content?.type, 'text');
    assert.match(r.text, /audio_plugin_doctor/, 'apc:doctor must instruct calling audio_plugin_doctor');
    assert.match(r.text, /\.apc-mcp\/deps|cache/i, 'apc:doctor must mention resolving missing cache directories');
    assert.match(r.text, /readiness matrix/i, 'apc:doctor must instruct outputting a concise readiness matrix');
  });

  it('rejects missing required arguments on prompts/get with an MCP InvalidParams error', async () => {
    const rMissingName = await getPrompt('apc:new', {});
    assert.equal(rMissingName.isError, true, 'apc:new without required "name" must error');

    const rMissingDesign = await getPrompt('apc:ui', {});
    assert.equal(rMissingDesign.isError, true, 'apc:ui without required "design" must error');
  });
});
