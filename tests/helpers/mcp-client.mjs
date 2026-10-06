// Shared MCP stdio client for the test suite.
//
// Spawns index.js as a real subprocess and performs the full MCP lifecycle
// (initialize -> notifications/initialized -> request) so the tests exercise the
// same path a real client does. Advances on responses rather than fixed timers.
//
// Not a test file itself — `node --test` only picks up *.test.js.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX = path.join(PKG_DIR, 'index.js');
export const PROJECT_ROOT = PKG_DIR;

export function rpc(method, params, { env, cwd, wantId = 2, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [INDEX], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd ?? PKG_DIR,
      env: { ...process.env, ...(env || {}) },
    });

    let stderr = '';
    let buf = '';
    let settled = false;
    const send = o => { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    const killer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      try { proc.stdin.end(); } catch {}
      try { proc.kill(); } catch {}
      fn(arg);
    };

    proc.stderr.on('data', d => stderr += d);
    proc.on('error', e => done(reject, e));
    proc.on('close', () => {
      if (!settled) {
        done(reject, new Error(`server exited before answering ${method}. stderr=${stderr.slice(0, 400)}`));
      }
    });

    proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;

        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: wantId, method, params });
        } else if (msg.id === wantId) {
          done(resolve, { msg, stderr });
        }
      }
    });

    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'apc-mcp-tests', version: '1.0' },
      },
    });
  });
}

export async function call(toolName, args, opts = {}) {
  const { msg, stderr } = await rpc('tools/call', { name: toolName, arguments: args }, opts);
  if (msg.error) return { protocolError: msg.error, isError: true, text: '', stderr };
  const res = msg.result || {};
  return { isError: !!res.isError, text: res.content?.[0]?.text ?? '', stderr };
}

export async function listTools(opts = {}) {
  const { msg } = await rpc('tools/list', {}, opts);
  return msg.result?.tools ?? [];
}
