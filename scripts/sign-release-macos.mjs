#!/usr/bin/env node
// Release signing + notarization for macOS plugin bundles.
//
// THIS IS THE DISTRIBUTION PATH. It exists so that `codesign --sign -` never
// leaks into a release: the script refuses to run without a Developer ID
// Application identity, always signs with the hardened runtime and a secure
// timestamp, notarizes with `xcrun notarytool submit --wait` and staples with
// `xcrun stapler staple`.
//
// LOCAL testing does not belong here. For a bundle that stays on your own
// machine, ad-hoc signing is enough:
//
//   codesign --force --deep --sign - MyPlugin.vst3
//
// That signature is LOCAL-ONLY: it confers no Gatekeeper trust, no hardened
// runtime and no notarization ticket, and this script treats `-` as an error.
//
// Ad-hoc:        codesign --force --deep --sign - MyPlugin.vst3   (local only)
// Distribution:  this script (Developer ID Application + hardened runtime +
//                notarization + stapling)
//
// Usage:
//   node scripts/sign-release-macos.mjs --dist <dir>           # sign every bundle in a dist/ folder
//   node scripts/sign-release-macos.mjs <bundle> [...]         # sign explicit bundles (.vst3, .component, .clap, .aaxplugin, .app)
//
// Options:
//   --identity <name>          "Developer ID Application: <Name> (<TEAMID>)"
//                              (or $APC_DEVELOPER_IDENTITY)
//   --keychain-profile <name>  notarytool keychain profile created with
//                              `xcrun notarytool store-credentials`
//                              (or $APC_NOTARY_PROFILE)
//   --api-key <path.p8>        App Store Connect API key for notarization
//   --api-key-id <id>          (or $APC_NOTARY_API_KEY_ID)
//   --api-issuer <uuid>        (or $APC_NOTARY_API_ISSUER)
//   --keep-zip                 keep the notarization .zip instead of deleting it
//   --allow-unstapled          do not fail when `stapler staple` rejects the
//                              bundle (bare .vst3/.component cannot always be
//                              stapled; see docs/release.md). Off by default:
//                              a release gate must not half-pass silently.
//   --help
//
// Notarization credentials: pass EITHER --keychain-profile (or
// $APC_NOTARY_PROFILE), OR the App Store Connect API key trio --api-key /
// --api-key-id / --api-issuer (or $APC_NOTARY_API_KEY_P8 /
// $APC_NOTARY_API_KEY_ID / $APC_NOTARY_API_ISSUER).
//
// Exit codes: 0 success, 1 a step failed, 2 usage error.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);

const USAGE = `usage: node scripts/sign-release-macos.mjs [--dist <dir> | <bundle> ...] [options]
  --identity <name>          Developer ID Application identity (or $APC_DEVELOPER_IDENTITY)
  --keychain-profile <name>  notarytool keychain profile (or $APC_NOTARY_PROFILE)
  --api-key <path.p8>        App Store Connect API key (or $APC_NOTARY_API_KEY_P8)
  --api-key-id <id>          (or $APC_NOTARY_API_KEY_ID)
  --api-issuer <uuid>        (or $APC_NOTARY_API_ISSUER)
  --keep-zip                 keep the notarization .zip
  --allow-unstapled          tolerate an unstapleable bundle (not recommended)
  --help                     show this help`;

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

const flagsWithValues = new Set(['--identity', '--keychain-profile', '--api-key', '--api-key-id', '--api-issuer', '--dist']);
const booleanFlags = new Set(['--keep-zip', '--allow-unstapled']);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (flagsWithValues.has(arg)) {
    // The value of a flag may legitimately be "-" (the ad-hoc identity), so the
    // only invalid value is another KNOWN flag or no token at all.
    const next = argv[i + 1];
    if (next === undefined || [...flagsWithValues, ...booleanFlags].includes(next)) {
      console.error(`sign-release-macos: ${arg} requires a value`);
      process.exit(2);
    }
    i++;
    continue;
  }
  if (arg.startsWith('-')) {
    const known = [...flagsWithValues].some(f => arg.startsWith(`${f}=`)) || booleanFlags.has(arg);
    if (!known) {
      console.error(`sign-release-macos: unknown option ${arg}`);
      console.error(USAGE);
      process.exit(2);
    }
  }
}

const DIST_DIR = optionValue('--dist');
const IDENTITY = optionValue('--identity') ?? process.env.APC_DEVELOPER_IDENTITY;
const KEYCHAIN_PROFILE = optionValue('--keychain-profile') ?? process.env.APC_NOTARY_PROFILE;
const API_KEY = optionValue('--api-key') ?? process.env.APC_NOTARY_API_KEY_P8;
const API_KEY_ID = optionValue('--api-key-id') ?? process.env.APC_NOTARY_API_KEY_ID;
const API_ISSUER = optionValue('--api-issuer') ?? process.env.APC_NOTARY_API_ISSUER;
const KEEP_ZIP = argv.includes('--keep-zip');
const ALLOW_UNSTAPLED = argv.includes('--allow-unstapled');

// Positional arguments are every argument that is not a flag and not the value
// of a flag that takes one.
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (flagsWithValues.has(arg)) { i++; continue; }
  if (arg.startsWith('--')) continue;
  positional.push(arg);
}

if (!DIST_DIR && positional.length === 0) {
  console.error('sign-release-macos: nothing to sign — pass --dist <dir> or one or more bundles');
  console.error(USAGE);
  process.exit(2);
}

const fail = message => { console.error(`\nsign-release-macos: ${message}`); process.exit(1); };

// ── Validate everything BEFORE touching the filesystem ─────────────

// The distribution identity is a Developer ID Application certificate. The
// ad-hoc identity is `-`; accepting it here would silently turn a release
// into a local test artifact, which is the exact failure this script exists
// to prevent.
if (!IDENTITY) {
  fail('no signing identity.\n'
    + '  Pass --identity "Developer ID Application: <Name> (<TEAMID>)" or set APC_DEVELOPER_IDENTITY.\n'
    + '  Find yours with: security find-identity -v -p codesigning\n'
    + '  (For LOCAL testing only, ad-hoc sign by hand: codesign --force --deep --sign - MyPlugin.vst3)');
}
if (IDENTITY.trim() === '-' || /^ad[- ]?hoc$/i.test(IDENTITY.trim())) {
  fail('"-" is the ad-hoc identity. Ad-hoc signatures are LOCAL-ONLY and are not valid\n'
    + '  for distribution: no Gatekeeper trust, no notarization ticket.\n'
    + '  Use a "Developer ID Application" identity for release builds.');
}
if (!/developer id application/i.test(IDENTITY)) {
  fail(`identity "${IDENTITY}" is not a Developer ID Application certificate.\n`
    + '  Distribution outside the Mac App Store requires a Developer ID Application\n'
    + '  certificate (Xcode → Settings → Accounts → Manage Certificates).');
}

// Notarization needs exactly one credential set. Validate before signing so a
// missing secret cannot be discovered after the bundles are already signed.
const NOTARY_ARGS = [];
let notaryDescription;
if (KEYCHAIN_PROFILE) {
  NOTARY_ARGS.push('--keychain-profile', KEYCHAIN_PROFILE);
  notaryDescription = `keychain profile "${KEYCHAIN_PROFILE}"`;
} else if (API_KEY && API_KEY_ID && API_ISSUER) {
  if (!fs.existsSync(API_KEY)) {
    // Do not echo the path: it is derived from a secret-bearing variable, and
    // logs are not a place for it (CodeQL: clear-text sensitive logging).
    fail('the App Store Connect API key file does not exist.\n'
      + '  Check APC_NOTARY_API_KEY_P8 (or --api-key) points at the AuthKey_*.p8 file.');
  }
  NOTARY_ARGS.push('--api-key', API_KEY, '--api-key-id', API_KEY_ID, '--api-issuer', API_ISSUER);
  // The key ID and issuer UUID are not logged anywhere (the echoed notarytool
  // command line is assembled from non-secret literals; see notaryDisplay);
  // the line below says only that the API-key credential set is in use.
  notaryDescription = 'App Store Connect API key';
} else {
  fail('no notarization credentials.\n'
    + '  Either create a keychain profile once:\n'
    + '    xcrun notarytool store-credentials apc-notary --apple-id <you@example.com> --team-id <TEAMID> --password <app-specific-password>\n'
    + '    then pass --keychain-profile apc-notary (or $APC_NOTARY_PROFILE),\n'
    + '  or set the App Store Connect API key trio:\n'
    + '    APC_NOTARY_API_KEY_P8=/path/to/AuthKey_XXX.p8 APC_NOTARY_API_KEY_ID=XXX APC_NOTARY_API_ISSUER=<uuid>');
}

const BUNDLE_EXTENSIONS = new Set(['.vst3', '.component', '.clap', '.aaxplugin', '.app']);

function collectBundles(dir, depth = 0) {
  /** @type {string[]} */
  const found = [];
  if (depth > 5) return found;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${dir}: ${error.message}`);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (BUNDLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      } else {
        found.push(...collectBundles(full, depth + 1));
      }
    }
  }
  return found;
}

/** @type {string[]} */
let bundles = [];
if (DIST_DIR) {
  if (!fs.existsSync(DIST_DIR)) fail(`--dist directory not found: ${DIST_DIR}`);
  bundles = collectBundles(DIST_DIR);
  if (bundles.length === 0) {
    fail(`no signable bundles (${[...BUNDLE_EXTENSIONS].join(', ')}) found under ${DIST_DIR}`);
  }
}
for (const p of positional) {
  if (!fs.existsSync(p)) fail(`bundle not found: ${p}`);
  const ext = path.extname(p).toLowerCase();
  if (!BUNDLE_EXTENSIONS.has(ext)) {
    fail(`refusing to sign ${p}: not a recognisable plugin/app bundle (${[...BUNDLE_EXTENSIONS].join(', ')}).\n`
      + '  Release signing is for bundles produced by the build; sign specific files another way.');
  }
  bundles.push(p);
}

// ── Run a step, capture output, fail loudly ───────────────────────

function errno(error) {
  return /** @type {NodeJS.ErrnoException | undefined} */ (error);
}

/**
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ capture?: boolean, display?: string }} [opts]
 */
function step(label, cmd, args, opts = {}) {
  // opts.display is the exact text echoed as the command line. Sensitive
  // arguments are excluded from it by construction — never by filtering the
  // echoed values at this point — so secrets never reach this line.
  console.log(`\n$ ${cmd} ${opts.display ?? args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (errno(result.error)?.code === 'ENOENT') {
    fail(`${cmd} was not found on PATH. This script must run on macOS with the Xcode Command Line Tools installed.`);
  }
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    fail(`${label} failed (exit ${result.status ?? result.signal ?? 'unknown'})${out ? `:\n${out.trim()}` : ''}`);
  }
  return out;
}

// ── Sign, notarize, staple, verify ────────────────────────────────

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-notarize-'));
const zipsToKeep = [];
let stapledCount = 0;

console.log(`sign-release-macos: ${bundles.length} bundle(s), identity "${IDENTITY}", notarization via ${notaryDescription}`);

for (const bundle of bundles) {
  console.log(`\n=== ${path.basename(bundle)} ===`);

  // Hardened runtime (--options runtime) and a secure timestamp are mandatory
  // for Developer ID distribution; without either, notarization is rejected or
  // the signature rots when the certificate expires.
  step('codesign', 'codesign',
    ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', IDENTITY, bundle]);

  step('codesign --verify', 'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', bundle]);

  // notarytool accepts .zip, .dmg or .pkg — not a bare bundle — so the signed
  // bundle travels as a ditto archive (keeps symlinks and metadata intact).
  const zipPath = path.join(workDir, `${path.basename(bundle)}-${process.pid}.zip`);
  step('ditto (notarize payload)', 'ditto', ['-c', '-k', '--keepParent', bundle, zipPath]);

  // --wait blocks until Apple finishes and prints the verdict; the exit code is
  // not a sufficient gate on its own, so the "status: Accepted" line is checked
  // explicitly below. The echoed command line contains no credential material at
  // all — it is assembled from literals and the (non-secret) zip path.
  const notaryDisplay = (KEYCHAIN_PROFILE
    ? `notarytool submit ${zipPath} --keychain-profile ${KEYCHAIN_PROFILE} --wait`
    : `notarytool submit ${zipPath} --api-key *** --api-key-id *** --api-issuer *** --wait`);
  const submitOut = step('notarytool submit', 'xcrun',
    ['notarytool', 'submit', zipPath, ...NOTARY_ARGS, '--wait'],
    { capture: true, display: notaryDisplay });
  process.stdout.write(submitOut.endsWith('\n') ? submitOut : `${submitOut}\n`);
  if (!/status:\s*Accepted/i.test(submitOut)) {
    fail(`notarization did not reach "status: Accepted" for ${path.basename(bundle)}.\n`
      + '  Read the log with: xcrun notarytool log <submission-id>\n'
      + '  The bundle is signed but NOT notarized — do not ship it.');
  }

  // stapler attaches the ticket to stapleable containers (.app, .pkg, .dmg,
  // some .plugin types). A bare .vst3/.component frequently cannot be stapled:
  // Gatekeeper then checks the ticket online (which works because the bundle
  // was notarized). Either way, a failure here must be a decision, not a
  // surprise — so it stops the release unless --allow-unstapled was passed.
  const staple = spawnSync('xcrun', ['stapler', 'staple', bundle], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (errno(staple.error)?.code === 'ENOENT') {
    fail('xcrun was not found on PATH. This script must run on macOS with the Xcode Command Line Tools installed.');
  }
  const stapleOut = `${staple.stdout ?? ''}${staple.stderr ?? ''}`;
  console.log(`\n$ xcrun stapler staple ${bundle}\n${stapleOut}`.trimEnd());
  const stapled = staple.status === 0 && !staple.error;
  if (stapled) stapledCount += 1;
  if (!stapled && ALLOW_UNSTAPLED) {
    console.log('\nsign-release-macos: WARNING — stapler failed and --allow-unstapled was given; continuing.');
    console.log('  The bundle relies on Gatekeeper\'s online check: it will clear on machines with');
    console.log('  network access, but ships with no offline ticket. Prefer a stapled .pkg/.dmg.');
  } else if (!stapled) {
    fail(`xcrun stapler staple failed for ${bundle} (exit ${staple.status ?? staple.signal ?? 'unknown'}).\n`
      + '  stapler can only attach a ticket to containers Apple recognises (.app, .pkg, .dmg).\n'
      + '  A bare plugin bundle usually cannot be stapled; Gatekeeper will verify it\n'
      + '  online against the notarization log instead.\n'
      + '  - Ship a signed .pkg or .dmg that contains the bundles and staple THAT, or\n'
      + '  - re-run with --allow-unstapled to accept online-only Gatekeeper checks.');
  }

  if (stapled) {
    step('stapler validate', 'xcrun', ['stapler', 'validate', bundle], { capture: true });
  }

  // spctl semantics for plugin bundles vary; this is printed for the record and
  // never fails the build.
  const spctl = spawnSync('spctl', ['--assess', '--type', 'execute', '-vv', bundle], { encoding: 'utf8' });
  console.log(`\n[advisory] spctl --assess: ${(`${spctl.stdout ?? ''}${spctl.stderr ?? ''}`).trim() || '(no output)'}`);

  zipsToKeep.push(zipPath);
}

// ── Clean up ──────────────────────────────────────────────────────

if (KEEP_ZIP) {
  console.log(`\nsign-release-macos: notarization payload(s) kept:\n${zipsToKeep.map(z => `  ${z}`).join('\n')}`);
} else {
  fs.rmSync(workDir, { recursive: true, force: true });
}

console.log(`\nsign-release-macos: done — ${bundles.length} bundle(s) signed and notarized; ${stapledCount} stapled.`);
console.log('  Local ad-hoc signatures (codesign --sign -) remain valid ONLY on this machine;');
console.log('  these bundles carry a Developer ID signature and a notarization ticket instead.');
