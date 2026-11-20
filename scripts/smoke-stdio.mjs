#!/usr/bin/env node
// Drives the real server over raw stdio and asserts every tool registers.
//
// This replaces an inline `printf … | timeout 5 node index.js | python3 -c …`
// CI step, which failed on macOS for the only reason it could: `timeout` is a
// GNU coreutils program and does not exist there. Doing it in Node also means
// the check runs identically on Linux, macOS and Windows, needs no `python3`,
// and cannot hang the job — the child gets an explicit deadline and its stdin is
// closed after the last message, which is how a stdio MCP server is asked to
// shut down.
//
// Usage: node scripts/smoke-stdio.mjs [--timeout=10000]

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const timeoutMs = Number(process.argv.find(a => a.startsWith('--timeout='))?.slice(10) ?? 10000);
// NOT import.meta.dirname: that is Node >= 22.16 / 24 only, while this package
// supports >= 22.0, where it is undefined and path.join() throws on the first line.
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const EXPECTED = [
  'apc',
  'apc-add-param',
  'apc-build',
  'apc-cfg',
  'apc-doctor',
  'apc-lint',
  'apc-list',
  'apc-ship',
  'apc-test',
  'apc-val',
];

const messages = [
  { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ci-smoke', version: '1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
];

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf-8').on('data', d => { stdout += d; });
child.stderr.setEncoding('utf-8').on('data', d => { stderr += d; });

const fail = msg => {
  console.error(`smoke-stdio: FAIL — ${msg}`);
  if (stdout.trim()) console.error(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) console.error(`stderr:\n${stderr.trim()}`);
  child.kill('SIGKILL');
  process.exit(1);
};

const deadline = setTimeout(
  () => fail(`server did not exit within ${timeoutMs}ms (saw ${stdout.split('\n').filter(Boolean).length} message(s))`),
  timeoutMs);

for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
child.stdin.end();

child.on('exit', code => {
  clearTimeout(deadline);
  const parsed = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try { parsed.push(JSON.parse(line)); } catch { fail(`non-JSON on stdout: ${line.slice(0, 200)}`); }
  }
  const list = parsed.find(m => m.id === 2);
  if (!list) fail(`no tools/list response (ids seen: ${parsed.map(m => m.id).join(', ') || 'none'})`);
  const names = (list.result?.tools ?? []).map(t => t.name);
  if (names.length === 0) fail('tools/list returned no tools');
  const missing = EXPECTED.filter(n => !names.includes(n));
  if (missing.length) fail(`missing tools: ${missing.join(', ')}`);
  const untitled = (list.result.tools ?? []).filter(t => !t.title).map(t => t.name);
  if (untitled.length) fail(`tools without a title: ${untitled.join(', ')}`);

  if (code !== 0) fail(`server exited ${code} on stdin EOF (a stdio server must exit 0)`);
  console.log(`smoke-stdio: PASS (${names.length} tools registered, all titled)`);
});
