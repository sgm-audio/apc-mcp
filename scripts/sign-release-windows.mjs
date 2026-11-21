#!/usr/bin/env node
// Authenticode release signing for Windows plugin binaries.
//
// THIS IS THE DISTRIBUTION PATH. It exists so that unsigned or ad-hoc "inner
// PE" exports never ship by accident. Every file is signed with SHA-256 and a
// trusted timestamp (/fd sha256 /tr <url> /td sha256), which is what keeps the
// signature valid after the certificate expires.
//
// Certificate, in order of preference:
//   1. An EV (extended validation) code-signing certificate — hardware token
//      (SafeNet/USB token) attached to the build machine or a cloud signing
//      service. Selected automatically with /a, or explicitly by thumbprint.
//   2. Any OV code-signing certificate from a trusted CA in the Windows
//      certificate store (/sha1 <thumbprint> or /n <subject>), or a .pfx
//      file (/f <file> [/p <password>], or $APC_SIGN_PFX*).
//   3. /a with no other selector — signtool picks the best cert in the store
//      (an EV cert wins when several are present).
//
// If no certificate is available, signing FAILS. There is no unsigned or
// self-signed fallback: an unsigned plugin loads with a reputation warning, a
// self-signed one is worse than useless on a customer machine.
//
// LOCAL testing does not belong here. Unsigned local builds are fine for
// development; for a trusted distribution build you need the commands in
// docs/release.md.
//
// Usage:
//   node scripts/sign-release-windows.mjs --dist <dir>          # sign every PE binary in a dist/ folder
//   node scripts/sign-release-windows.mjs <file> [<file> ...]   # sign explicit files
//
// Options:
//   --timestamp-url <url>   RFC 3161 timestamp server
//                           (or $APC_TIMESTAMP_URL; default http://timestamp.digicert.com)
//   --cert-sha1 <hex>      thumbprint of the cert in the Windows store
//                           (or $APC_SIGN_CERT_SHA1) — preferred for EV tokens
//   --cert-name <subject>  subject name substring, e.g. "ACME Audio LLC"
//                           (or $APC_SIGN_CERT_NAME)
//   --pfx <path.pfx>       sign with a .pfx file
//   --pfx-password <pw>    password for the .pfx (or $APC_SIGN_PFX_PASSWORD)
//                           Note: the password is visible in the process list
//                           of this machine. Prefer the certificate store on
//                           shared/CI runners (EV tokens cannot export anyway).
//   --description <text>    /d description embedded in the signature
//   --help
//
// A Windows VST3 binary is a PE file renamed to <Name>.vst3 inside the
// <Name>.vst3 bundle (Contents\x86_64-win\<Name>.vst3). This script finds PE
// files by their MZ magic, so bundles of any of those shapes are handled.
//
// Exit codes: 0 success, 1 a step failed, 2 usage error.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

const USAGE = `usage: node scripts/sign-release-windows.mjs [--dist <dir> | <file> ...] [options]
  --timestamp-url <url>   RFC 3161 timestamp server (or $APC_TIMESTAMP_URL)
  --cert-sha1 <hex>       thumbprint in the Windows cert store (or $APC_SIGN_CERT_SHA1)
  --cert-name <subject>   subject substring (or $APC_SIGN_CERT_NAME)
  --pfx <path.pfx>        sign with a .pfx file
  --pfx-password <pw>     .pfx password (or $APC_SIGN_PFX_PASSWORD)
  --description <text>     /d description embedded in the signature
  --help                  show this help`;

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

function optionValue(flag) {
  const inline = argv.find(a => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  if (i !== -1) return argv[i + 1];
  return undefined;
}

const flagsWithValues = new Set(['--timestamp-url', '--cert-sha1', '--cert-name', '--pfx', '--pfx-password', '--description', '--dist']);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (flagsWithValues.has(arg)) {
    // The only invalid value is another known flag or no token at all; values
    // are otherwise taken verbatim (certificate subjects may contain dashes).
    const next = argv[i + 1];
    if (next === undefined || [...flagsWithValues].includes(next)) {
      console.error(`sign-release-windows: ${arg} requires a value`);
      process.exit(2);
    }
    i++;
    continue;
  }
  if (arg.startsWith('--') && ![...flagsWithValues].some(f => arg.startsWith(`${f}=`))) {
    console.error(`sign-release-windows: unknown option ${arg}`);
    console.error(USAGE);
    process.exit(2);
  }
}

const DIST_DIR = optionValue('--dist');
const TIMESTAMP_URL = optionValue('--timestamp-url') ?? process.env.APC_TIMESTAMP_URL ?? 'http://timestamp.digicert.com';
const CERT_SHA1 = optionValue('--cert-sha1') ?? process.env.APC_SIGN_CERT_SHA1;
const CERT_NAME = optionValue('--cert-name') ?? process.env.APC_SIGN_CERT_NAME;
const PFX = optionValue('--pfx') ?? process.env.APC_SIGN_PFX;
const PFX_PASSWORD = optionValue('--pfx-password') ?? process.env.APC_SIGN_PFX_PASSWORD;
const DESCRIPTION = optionValue('--description');

const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (flagsWithValues.has(arg)) { i++; continue; }
  if (arg.startsWith('--')) continue;
  positional.push(arg);
}

if (!DIST_DIR && positional.length === 0) {
  console.error('sign-release-windows: nothing to sign — pass --dist <dir> or one or more files');
  console.error(USAGE);
  process.exit(2);
}

const fail = message => { console.error(`\nsign-release-windows: ${message}`); process.exit(1); };

// ── Validate inputs before invoking signtool ───────────────────────

if (!/^https?:\/\//i.test(TIMESTAMP_URL)) {
  fail(`timestamp URL "${TIMESTAMP_URL}" is not an http(s) URL — the RFC 3161 server is required for a signature that outlives the certificate.`);
}

/** @type {string[]} */
const CERT_ARGS = [];
/** @type {string} */
let certDescription;
if (PFX) {
  if (!fs.existsSync(PFX)) fail(`--pfx file not found: ${PFX}`);
  CERT_ARGS.push('/f', PFX);
  if (PFX_PASSWORD) CERT_ARGS.push('/p', PFX_PASSWORD);
  certDescription = `.pfx file "${PFX}"`;
} else if (CERT_SHA1) {
  const normalized = CERT_SHA1.replace(/[^0-9a-f]/gi, '');
  if (normalized.length !== 40) {
    fail(`--cert-sha1 "${CERT_SHA1}" is not a 40-hex-character SHA-1 thumbprint.`);
  }
  CERT_ARGS.push('/sha1', normalized);
  certDescription = `certificate store thumbprint ${normalized}`;
} else if (CERT_NAME) {
  CERT_ARGS.push('/n', CERT_NAME);
  certDescription = `certificate store subject "${CERT_NAME}"`;
} else {
  // signtool /a auto-selects the best certificate in the store; an EV
  // certificate is preferred when several are valid for code signing.
  CERT_ARGS.push('/a');
  certDescription = 'best certificate in the Windows store (/a; an EV cert wins when present)';
}

const MZ = Buffer.from('MZ');
const SIGN_EXTENSIONS = new Set(['.exe', '.dll', '.vst3', '.clap', '.sys']);
const MAX_FILES = 5000;
const MAX_DEPTH = 8;

/** @param {string} file */
function isPE(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    return head.equals(MZ);
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @param {number} depth
 * @returns {string[]}
 */
function collectPEs(dir, depth = 0) {
  /** @type {string[]} */
  const found = [];
  if (depth > MAX_DEPTH) return found;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${dir}: ${/** @type {Error} */ (error).message}`);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectPEs(full, depth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SIGN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (isPE(full)) found.push(full);
    if (found.length > MAX_FILES) fail(`more than ${MAX_FILES} PE files under ${DIST_DIR} — refusing to walk further`);
  }
  return found;
}

/** @type {string[]} */
let files = [];
if (DIST_DIR) {
  if (!fs.existsSync(DIST_DIR)) fail(`--dist directory not found: ${DIST_DIR}`);
  files = collectPEs(DIST_DIR);
  if (files.length === 0) {
    fail(`no PE binaries found under ${DIST_DIR} (expected .exe/.dll, or the inner .vst3 of a VST3 bundle)`);
  }
}
for (const p of positional) {
  if (!fs.existsSync(p)) fail(`file not found: ${p}`);
  if (!fs.statSync(p).isFile()) {
    fail(`${p} is not a file. A Windows VST3 bundle (*.vst3) is a directory — point this\n`
      + '  script at the PE inside it (Contents\\x86_64-win\\<Name>.vst3) or pass --dist <dir>.');
  }
  if (!isPE(p)) fail(`${p} is not a PE (MZ) binary — refusing to sign it.`);
  files.push(p);
}

// ── Sign and verify every binary ───────────────────────────────────

function errno(error) {
  return /** @type {NodeJS.ErrnoException | undefined} */ (error);
}

/**
 * @param {string} file
 * @returns {string[]}
 */
function signArgs(file) {
  const args = ['sign', '/fd', 'sha256', '/tr', TIMESTAMP_URL, '/td', 'sha256', ...CERT_ARGS];
  if (DESCRIPTION) args.push('/d', DESCRIPTION);
  args.push(file);
  return args;
}

/**
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 */
function step(label, cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (out) console.log(out);
  if (errno(result.error)?.code === 'ENOENT') {
    fail(`${cmd} was not found on PATH.\n`
      + '  signtool ships with the Windows SDK ("C:\\Program Files (x86)\\Windows Kits\\10\\bin\\<sdk-version>\\x64\\signtool.exe").\n'
      + '  Install the Windows SDK or add that directory to PATH.');
  }
  if (result.error) fail(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${label} failed (exit ${result.status ?? result.signal ?? 'unknown'})${out ? `:\n${out}` : ''}`);
  }
}

console.log(`sign-release-windows: ${files.length} file(s), cert ${certDescription}, timestamp ${TIMESTAMP_URL}`);

for (const file of files) {
  step('signtool sign', 'signtool', signArgs(file));
  // /pa selects the default Authenticode verification policy; an untrusted or
  // untimestamped chain fails here even if the sign call reported success.
  step('signtool verify', 'signtool', ['verify', '/pa', '/v', file]);
}

console.log(`\nsign-release-windows: done — ${files.length} file(s) signed with SHA-256 + RFC 3161 timestamp and verified.`);
console.log('  EV certificates give immediate publisher reputation in SmartScreen; OV certificates');
console.log('  accrue reputation over downloads. Unsigned or self-signed builds are never valid for distribution.');
