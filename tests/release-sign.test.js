// Release-signing regression tests for the plugin distribution scripts.
//
// These drive scripts/sign-release-macos.mjs and scripts/sign-release-windows.mjs
// against PATH shims, so they run anywhere (the repo has no Windows CI job and
// no Apple Developer ID). The shims record argv, which is what these tests are
// actually about: a release signature is only valid if the exact flags were
// used — hardened runtime, secure timestamp, notarization with --wait, stapling,
// and a timestamped Authenticode signature.
//
// Negative tests matter most here: the ad-hoc identity (`-`) must be REFUSED,
// missing notarization credentials must fail before anything is signed, and a
// notarization result other than "Accepted" must fail the release even though
// notarytool exits 0.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MACOS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'sign-release-macos.mjs');
const WINDOWS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'sign-release-windows.mjs');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-release-sign-test-'));
const FAKE_BIN = path.join(SCRATCH, 'bin');
const FAKE_LOG = path.join(SCRATCH, 'argv.log');

before(() => {
  fs.mkdirSync(FAKE_BIN, { recursive: true });

  // A single shared argv log; the tests read it after each invocation. PATH is
  // otherwise restricted to the shims plus the system dirs Node needs.
  const shim = (name, body) => {
    const file = path.join(FAKE_BIN, name);
    fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${FAKE_LOG}"\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };

  shim('codesign', [
    'case " $* " in',
    '  *" --verify "*) exit "${FAKE_VERIFY_FAIL:-0}" ;;',
    'esac',
    'exit "${FAKE_CODESIGN_SIGN_FAIL:-0}"',
  ].join('\n'));

  // ditto always "succeeds"; it must still materialise the zip, because the
  // script passes it to notarytool.
  shim('ditto', 'for last; do :; done\n: > "$last"\nexit 0');

  shim('xcrun', [
    'case "$1" in',
    '  notarytool)',
    '    # Like the real notarytool, the verdict goes to stdout but the arguments do not.',
    '    echo "status: ${FAKE_NOTARY_STATUS:-Accepted}"',
    '    exit "${FAKE_NOTARY_EXIT:-0}" ;;',
    '  stapler)',
    '    if [ "${FAKE_STAPLE_FAIL:-0}" = "1" ]; then',
    '      echo "error: The staple and validate action failed (offline, unstapleable container)."',
    '      exit 1',
    '    fi',
    '    echo "The staple and validate action worked!"',
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'));

  shim('spctl', 'echo "accepted, source=Notarized Developer ID"\nexit 0');

  shim('signtool', [
    'if [ "$1" = "sign" ] && [ "${FAKE_SIGN_FAIL:-0}" = "1" ]; then',
    '  echo "SignTool Error: certificate not found / token not connected"',
    '  exit 1',
    'fi',
    'if [ "$1" = "verify" ] && [ "${FAKE_VERIFY_FAIL:-0}" = "1" ]; then',
    '  echo "SignTool Error: No signature found."',
    '  exit 1',
    'fi',
    'echo "signtool $1 ok"',
    'exit 0',
  ].join('\n'));
});

after(() => { fs.rmSync(SCRATCH, { recursive: true, force: true }); });

/** @param {boolean} [reset] */
const argvLog = () => fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8') : '';
const resetLog = () => fs.writeFileSync(FAKE_LOG, '');

/**
 * @param {string} script
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function run(script, args, extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${FAKE_BIN}:/usr/bin:/bin`, ...extraEnv },
  });
}

const failFastEnv = (script, args, env) => {
  resetLog();
  const r = run(script, args, env);
  return { r, log: argvLog() };
};

/** Make a fake plugin bundle (directory) with a sentinel file inside. */
function makeBundle(root, relativePath) {
  const dir = path.join(root, relativePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'bundle contents');
  return dir;
}

/** A Windows VST3 is a directory whose inner <Name>.vst3 is a PE binary. */
function makeWindowsDist(root) {
  const dist = path.join(root, 'dist', 'Foo-1.0.0-Windows');
  const inner = path.join(dist, 'Foo.vst3', 'Contents', 'x86_64-win');
  fs.mkdirSync(inner, { recursive: true });
  // MZ magic + enough bytes to look like a PE to isPE().
  fs.writeFileSync(path.join(inner, 'Foo.vst3'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]));
  fs.writeFileSync(path.join(dist, 'helper.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
  // A non-PE file with a signable extension: must be ignored, not fail.
  fs.writeFileSync(path.join(dist, 'notes.dll'), 'this is not a PE');
  return dist;
}

// ═══════════════════════════════════════════════════════════════════
describe('sign-release-macos · usage and admission control', () => {
  it('--help exits 0 and documents the local-only ad-hoc rule', () => {
    const r = run(MACOS_SCRIPT, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--dist/);
    assert.match(r.stdout, /--identity/);
  });

  it('no arguments is a usage error (exit 2)', () => {
    const r = run(MACOS_SCRIPT, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /nothing to sign/);
  });

  it('an unknown option is a usage error (exit 2)', () => {
    const { r } = failFastEnv(MACOS_SCRIPT, ['--frobnicate']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown option/);
  });

  it('--identity with no value is a usage error (exit 2)', () => {
    const { r } = failFastEnv(MACOS_SCRIPT, ['--identity']);
    assert.equal(r.status, 2);
  });

  it('REFUSES the ad-hoc identity and never invokes codesign', () => {
    const { r, log } = failFastEnv(MACOS_SCRIPT, ['--identity', '-', 'Foo.vst3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ad-hoc/i);
    assert.doesNotMatch(log, /codesign/, 'codesign must not run for an ad-hoc identity');
  });

  it('refuses a non-Developer-ID identity', () => {
    const { r, log } = failFastEnv(MACOS_SCRIPT,
      ['--identity', 'Mac Development: Someone (TEAMID1234)', 'Foo.vst3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Developer ID Application/i);
    assert.doesNotMatch(log, /codesign/);
  });

  it('fails BEFORE signing when notarization credentials are missing', () => {
    const { r, log } = failFastEnv(MACOS_SCRIPT,
      ['--identity', 'Developer ID Application: Acme (TEAMID1234)', 'Foo.vst3']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /notarization/i);
    assert.doesNotMatch(log, /codesign/, 'signing must not happen before notarization credentials are validated');
  });

  it('refuses to sign paths that are not recognisable bundles', () => {
    const notBundle = path.join(SCRATCH, 'evil.sh');
    fs.writeFileSync(notBundle, '#!/bin/sh\n');
    const { r } = failFastEnv(MACOS_SCRIPT,
      ['--identity', 'Developer ID Application: Acme (TEAMID1234)',
        '--keychain-profile', 'apc-notary', notBundle]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a recognisable plugin\/app bundle/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('sign-release-macos · the full release sequence', () => {
  const root = path.join(SCRATCH, 'macos-cases');
  const IDENTITY = 'Developer ID Application: Acme Audio LLC (TEAMID1234)';

  it('signs with hardened runtime + timestamp, notarizes with --wait, and staples', () => {
    const bundle = makeBundle(root, 'basic/Foo.vst3');
    const { r, log } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', bundle]);
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    assert.match(log, /--options runtime/, 'hardened runtime is mandatory for Developer ID distribution');
    assert.match(log, /--timestamp/, 'a secure timestamp is mandatory so the signature outlives the cert');
    assert.match(log, /--sign/, 'bundles are signed');
    assert.match(log, /notarytool submit .*--wait/, 'notarytool must block until Apple returns a verdict');
    assert.match(log, /stapler staple/, 'stapler must run');
    assert.match(log, /stapler validate/, 'stapler must validate after stapling');
    assert.match(r.stdout, /status: Accepted/);
  });

  it('--dist discovers bundles recursively', () => {
    const distRoot = path.join(root, 'dist-case');
    makeBundle(distRoot, 'dist/Foo-1.0.0-macOS/Nested.vst3');
    const { r, log } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', '--dist', path.join(distRoot, 'dist')]);
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    assert.match(log, /Nested\.vst3/);
  });

  it('fails the release when notarization returns anything but "Accepted"', () => {
    const bundle = makeBundle(root, 'invalid/Bar.vst3');
    const { r } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', bundle],
      { FAKE_NOTARY_STATUS: 'Invalid' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /notarization did not reach "status: Accepted"/);
  });

  it('fails the release when stapler fails, and does NOT silently pass', () => {
    const bundle = makeBundle(root, 'unstapleable/Baz.vst3');
    const { r } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', bundle],
      { FAKE_STAPLE_FAIL: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stapler staple failed/);
  });

  it('--allow-unstapled is the explicit, opt-in exception', () => {
    const bundle = makeBundle(root, 'unstapleable-ok/Qux.vst3');
    const { r } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', '--allow-unstapled', bundle],
      { FAKE_STAPLE_FAIL: '1' });
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /--allow-unstapled/);
  });

  it('fails the release when codesign itself fails', () => {
    const bundle = makeBundle(root, 'badsign/Fail.vst3');
    const { r } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--keychain-profile', 'apc-notary', bundle],
      { FAKE_CODESIGN_SIGN_FAIL: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /codesign failed/);
  });

  it('supports App Store Connect API key credentials instead of a keychain profile', () => {
    const p8 = path.join(SCRATCH, 'AuthKey_TESTKEY123.p8');
    fs.writeFileSync(p8, '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n');
    const bundle = makeBundle(root, 'api-key/Keyed.vst3');
    const { r, log } = failFastEnv(MACOS_SCRIPT,
      ['--identity', IDENTITY, '--api-key', p8, '--api-key-id', 'TESTKEY123', '--api-issuer', '00000000-0000-0000-0000-000000000000', bundle]);
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    // The credential material must NOT appear in the script's own echo (which is
    // what lands in CI logs and gets pasted around); redaction happens there,
    // NOT in the argv handed to notarytool — the process itself needs the real
    // arguments.
    assert.match(r.stdout, /--api-key \*\*\*/);
    assert.match(r.stdout, /--api-key-id \*\*\*/);
    assert.match(r.stdout, /--api-issuer \*\*\*/);
    assert.doesNotMatch(r.stdout, /AuthKey_TESTKEY123/);
    assert.doesNotMatch(r.stdout, /TESTKEY123/);
    assert.doesNotMatch(r.stdout, /00000000-0000-0000-0000-000000000000/);
    assert.match(log, /--api-key .*AuthKey_TESTKEY123\.p8/);
    assert.match(log, /--api-key-id TESTKEY123/);
    assert.match(log, /--api-issuer 00000000-0000-0000-0000-000000000000/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('sign-release-windows · usage and admission control', () => {
  it('--help exits 0 and documents the timestamp requirement', () => {
    const r = run(WINDOWS_SCRIPT, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--timestamp-url/);
  });

  it('no arguments is a usage error (exit 2)', () => {
    const r = run(WINDOWS_SCRIPT, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /nothing to sign/);
  });

  it('an unknown option is a usage error (exit 2)', () => {
    const { r } = failFastEnv(WINDOWS_SCRIPT, ['--wat']);
    assert.equal(r.status, 2);
  });

  it('rejects a non-http(s) timestamp URL', () => {
    const { r } = failFastEnv(WINDOWS_SCRIPT, ['--timestamp-url', 'gopher://nothing', 'x.dll']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /RFC 3161/);
  });

  it('rejects a malformed SHA-1 thumbprint', () => {
    const { r } = failFastEnv(WINDOWS_SCRIPT, ['--cert-sha1', 'not-a-thumbprint', 'x.dll']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /thumbprint/i);
  });

  it('refuses to sign a directory passed as a file (VST3 bundles are directories)', () => {
    const dir = makeBundle(SCRATCH, 'win-dir-case/Dir.vst3');
    const { r } = failFastEnv(WINDOWS_SCRIPT, [dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a file/);
  });

  it('fails when --dist contains no PE binaries', () => {
    const emptyDist = path.join(SCRATCH, 'not-pe');
    fs.mkdirSync(emptyDist, { recursive: true });
    fs.writeFileSync(path.join(emptyDist, 'readme.dll'), 'definitely not a PE');
    const { r } = failFastEnv(WINDOWS_SCRIPT, ['--dist', emptyDist]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no PE binaries/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('sign-release-windows · the full Authenticode sequence', () => {
  const root = path.join(SCRATCH, 'windows-cases');

  it('signs every PE by magic (inner .vst3 included) with SHA-256 + RFC 3161 timestamp, then verifies', () => {
    const dist = makeWindowsDist(root);
    const sha1 = 'a'.repeat(40);
    const { r, log } = failFastEnv(WINDOWS_SCRIPT, ['--dist', dist], { APC_SIGN_CERT_SHA1: sha1 });
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    // /fd sha256 + /td sha256 are the digest algorithms; /tr points at the
    // RFC 3161 timestamp authority. All three are mandatory for a signature
    // that outlives the certificate.
    assert.match(log, /\/fd sha256/);
    assert.match(log, /\/tr http:\/\/timestamp\.digicert\.com/);
    assert.match(log, /\/td sha256/);
    assert.match(log, new RegExp(`/sha1 ${sha1}`));
    assert.match(log, /Foo\.vst3/, 'the inner PE of the VST3 bundle must be signed');
    assert.match(log, /helper\.exe/, 'top-level PE binaries must be signed');
    assert.doesNotMatch(log, /notes\.dll/, 'a non-PE file with a signable extension must be skipped');
    // Verification is part of the gate: /pa is the default Authenticode policy.
    assert.match(log, /verify \/pa \/v/);
  });

  it('uses /a (store auto-select, EV preferred) when no cert is configured', () => {
    const dist = makeWindowsDist(path.join(root, 'auto'));
    const { r, log } = failFastEnv(WINDOWS_SCRIPT, ['--dist', dist]);
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    assert.match(log, / \/a( |$)/m);
  });

  it('redacts the PFX password from the echo but passes it intact to signtool', () => {
    const dist = makeWindowsDist(path.join(root, 'pfx'));
    const pfx = path.join(SCRATCH, 'acme.pfx');
    fs.writeFileSync(pfx, 'fake-pfx-bytes');
    const { r, log } = failFastEnv(WINDOWS_SCRIPT,
      ['--dist', dist, '--pfx', pfx, '--pfx-password', 'hunter2-secret']);
    assert.equal(r.status, 0, `expected success, got:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /\/p \*\*\*/);
    assert.doesNotMatch(r.stdout, /hunter2-secret/);
    // signtool itself still receives the real password — redaction is echo-only.
    assert.match(log, /\/p hunter2-secret/);
  });

  it('fails the release when signtool fails, before any verify step runs for that file', () => {
    const dist = makeWindowsDist(path.join(root, 'signfail'));
    const { r, log } = failFastEnv(WINDOWS_SCRIPT, ['--dist', dist], { FAKE_SIGN_FAIL: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /signtool sign failed/);
    assert.doesNotMatch(log, /verify \/pa/, 'a file that failed to sign must not be reported as verified');
  });

  it('fails the release when the verification policy rejects the signature', () => {
    const dist = makeWindowsDist(path.join(root, 'verifyfail'));
    const { r } = failFastEnv(WINDOWS_SCRIPT, ['--dist', dist], { FAKE_VERIFY_FAIL: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /signtool verify failed/);
  });
});
