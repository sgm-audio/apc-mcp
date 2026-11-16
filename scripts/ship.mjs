#!/usr/bin/env node
// Guarded release: tag and push the current version.
//
// `npm run ship` used to be
//   npm run check && git tag v$npm_package_version && git push origin main --tags
// which pushed `main` regardless of what branch you were on. Run it from a
// feature branch and it tagged a commit that was not on main, then pushed a main
// that did not contain it (AUDIT OPS-05). It also happily re-tagged an existing
// version and never noticed that the CHANGELOG still said [Unreleased].
//
// This script refuses to do any of that. Every guard prints why it stopped.
//
// Usage:
//   npm run ship              # runs the checks, then tags and pushes
//   node scripts/ship.mjs --dry-run    # guards only, changes nothing
//   node scripts/ship.mjs --no-check   # skip `npm run check` (not recommended)
//   node scripts/ship.mjs --branch=release/2.x   # tag a branch other than main

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const NO_CHECK = argv.includes('--no-check');
const branchArg = argv.find(a => a.startsWith('--branch='));
const REQUIRED_BRANCH = branchArg ? branchArg.slice('--branch='.length) : 'main';

const unknown = argv.find(a => a.startsWith('-') &&
  !['--dry-run', '--no-check'].includes(a) && !a.startsWith('--branch='));
if (unknown) {
  console.error(`ship: unknown option ${unknown}`);
  console.error('usage: npm run ship [-- --dry-run | --no-check | --branch=<name>]');
  process.exit(2);
}

// Every child gets a deadline and a non-interactive git. Without them a missing
// SSH key or a 2FA-backed push opens a credential prompt on a terminal that may
// not exist (CI) and the release hangs forever instead of failing — the one
// failure mode that looks like "still working".
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' };

function git(args, timeoutMs = 30000) {
  const r = spawnSync('git', args, { cwd: PKG_DIR, encoding: 'utf-8', timeout: timeoutMs, env: GIT_ENV });
  if (r.error?.code === 'ETIMEDOUT') {
    console.error(`\nship: git ${args[0]} timed out after ${timeoutMs / 1000}s — a credential prompt or a hung network?`);
    process.exit(1);
  }
  // status === null without ETIMEDOUT means the signal killed it; the guard
  // checks below treat that as a failure, so say so here rather than after.
  if (r.status === null) {
    console.error(`\nship: git ${args[0]} produced no exit status (${r.signal ?? r.error?.code ?? 'unknown'}).`);
    process.exit(1);
  }
  return r;
}

function run(cmd, args, label, timeoutMs = 900000) {
  console.log(`\n$ ${path.basename(cmd)} ${args.join(' ')}`);
  if (DRY_RUN) { console.log('  (dry run — not executed)'); return { status: 0 }; }
  const r = spawnSync(cmd, args, { cwd: PKG_DIR, stdio: 'inherit', timeout: timeoutMs, env: GIT_ENV });
  if (r.status !== 0) {
    const why = r.error?.code === 'ETIMEDOUT'
      ? `timed out after ${timeoutMs / 1000}s`
      : `exit ${r.status ?? `${r.signal ?? 'unknown signal'}`}`;
    console.error(`\nship: ${label} failed (${why}).`);
    process.exit(r.status ?? 1);
  }
  return r;
}

const stop = reason => {
  console.error(`\nship: refusing to release — ${reason}`);
  process.exit(1);
};

const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const version = pkg.version;

console.log(`ship: ${pkg.name} v${version}${DRY_RUN ? ' (dry run)' : ''}`);

if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(version)) {
  stop(`"${version}" is not a valid semver version.`);
}

// Node refuses to spawn a .cmd shim without `shell: true` (it throws EINVAL),
// and turning on a shell would reintroduce exactly the argument-quoting hazard
// this repo bans in index.js. npm is JS that ships next to node, so run it with
// the same node binary instead of asking Windows to interpret a batch file.
function npmArgs() {
  if (process.platform !== 'win32') return [];
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(cli)) {
    console.error(`ship: cannot find npm's CLI at ${cli}.`);
    console.error('ship: run `npm run check` yourself, then re-run with --no-check.');
    process.exit(1);
  }
  return [cli];
}

const npmCmd = process.platform === 'win32' ? process.execPath : 'npm';

// ── Guard 1: quality gates ────────────────────────────────────────
// Run here rather than only via `npm run ship &&`, so invoking this file
// directly cannot bypass them.
if (NO_CHECK) {
  console.log('\nship: --no-check given, skipping `npm run check`.');
} else if (DRY_RUN) {
  console.log('\nship: dry run — skipping `npm run check` (it would run for real).');
} else {
  run(npmCmd, [...npmArgs(), 'run', 'check'], 'npm run check');
}

// ── Guard 2: git state ────────────────────────────────────────────
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim();
if (!branch || branch === 'HEAD') {
  stop(`HEAD is detached, not "${REQUIRED_BRANCH}". Check out ${REQUIRED_BRANCH} first.`);
}
if (branch !== REQUIRED_BRANCH) {
  stop(`you are on "${branch}", not "${REQUIRED_BRANCH}".\n` +
       `  The old script pushed "main" from here, tagging a commit main does not have.\n` +
       `  Merge or fast-forward "${branch}" into ${REQUIRED_BRANCH} and ship from there,\n` +
       `  or pass --branch=${branch} if you really mean to tag this branch.`);
}

const dirty = git(['status', '--porcelain']).stdout?.trim();
if (dirty) {
  const n = dirty.split('\n').length;
  stop(`the working tree has ${n} uncommitted change(s):\n` +
       dirty.split('\n').slice(0, 10).map(l => `    ${l}`).join('\n') +
       (n > 10 ? `\n    … and ${n - 10} more` : '') +
       '\n  Commit or stash them; a release tag must point at committed work.');
}

const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
if (upstream.status !== 0) {
  console.log(`\nship: note — "${branch}" has no upstream; pushing will create it.`);
} else {
  const ahead = git(['rev-list', '--count', '@{u}..HEAD']).stdout?.trim();
  const behind = git(['rev-list', '--count', 'HEAD..@{u}']).stdout?.trim();
  if (behind && behind !== '0') {
    stop(`"${branch}" is ${behind} commit(s) behind its upstream. Pull first.`);
  }
  if (ahead && ahead !== '0') {
    console.log(`\nship: note — "${branch}" is ${ahead} commit(s) ahead of its upstream.`);
  }
}

// ── Guard 3: the tag must not already exist ───────────────────────
const tagName = `v${version}`;
const existing = git(['rev-parse', '-q', '--verify', `refs/tags/${tagName}`]);
if (existing.status === 0) {
  stop(`tag ${tagName} already exists and points at ${existing.stdout?.trim()}.\n` +
       '  Bump the version in package.json before shipping again.');
}
const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`], 120000);
if (remoteTag.status === 0 && remoteTag.stdout?.trim()) {
  stop(`tag ${tagName} already exists on origin (${remoteTag.stdout.trim().split(/\s+/)[0]}).\n` +
       '  Bump the version in package.json before shipping again.');
}

// ── Guard 4: the CHANGELOG must document this version ─────────────
// Catches the common mistake of tagging while the entry is still [Unreleased].
const changelogPath = path.join(PKG_DIR, 'CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  stop('CHANGELOG.md is missing.');
}
const changelog = fs.readFileSync(changelogPath, 'utf8');
const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
if (!heading.test(changelog)) {
  const unreleased = /^## \[Unreleased\][^\n]*/m.exec(changelog)?.[0];
  stop(`CHANGELOG.md has no "## [${version}]" heading.\n` +
       (unreleased
         ? `  It still says "${unreleased}" — rename that heading to\n` +
           `  "## [${version}] — <date>" so the release notes are attached to the version.`
         : '  Add a release section for this version.'));
}
if (/^## \[Unreleased\]/m.test(changelog) && DRY_RUN) {
  console.log('ship: note — an [Unreleased] section still exists alongside the release heading.');
}

// ── All guards passed ─────────────────────────────────────────────
// Push the branch BEFORE creating the local tag so a failed branch push does
// not leave an unpushed local tag blocking a retry.
console.log('\nship: all guards passed.');
run('git', ['push', 'origin', branch], `git push origin ${branch}`, 300000);
run('git', ['tag', '-a', tagName, '-m', `${pkg.name} ${tagName}`], `git tag ${tagName}`);
run('git', ['push', 'origin', tagName], `git push origin ${tagName}`, 300000);

console.log(DRY_RUN
  ? `\nship: dry run complete — would have tagged ${tagName} and pushed ${branch}.\n`
  : `\nship: tagged ${tagName} and pushed ${branch}.\n` +
    `  The publish workflow runs on v* tags. Watch it with:\n` +
    `    gh run watch\n`);
