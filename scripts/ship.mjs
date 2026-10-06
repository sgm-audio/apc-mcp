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

function git(args) {
  return spawnSync('git', args, { cwd: PKG_DIR, encoding: 'utf-8' });
}

function run(cmd, args, label) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  if (DRY_RUN) { console.log('  (dry run — not executed)'); return { status: 0 }; }
  const r = spawnSync(cmd, args, { cwd: PKG_DIR, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nship: ${label} failed (exit ${r.status}).`);
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

// ── Guard 1: quality gates ────────────────────────────────────────
// Run here rather than only via `npm run ship &&`, so invoking this file
// directly cannot bypass them.
if (NO_CHECK) {
  console.log('\nship: --no-check given, skipping `npm run check`.');
} else if (DRY_RUN) {
  console.log('\nship: dry run — skipping `npm run check` (it would run for real).');
} else {
  run('npm', ['run', 'check'], 'npm run check');
}

// ── Guard 2: git state ────────────────────────────────────────────
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim();
if (!branch || branch === 'HEAD') {
  stop('HEAD is detached. Check out a branch first.');
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
console.log('\nship: all guards passed.');
run('git', ['tag', '-a', tagName, '-m', `${pkg.name} ${tagName}`], `git tag ${tagName}`);
run('git', ['push', 'origin', branch], `git push origin ${branch}`);
run('git', ['push', 'origin', tagName], `git push origin ${tagName}`);

console.log(DRY_RUN
  ? `\nship: dry run complete — would have tagged ${tagName} and pushed ${branch}.\n`
  : `\nship: tagged ${tagName} and pushed ${branch}.\n` +
    `  The publish workflow runs on v* tags. Watch it with:\n` +
    `    gh run watch\n`);
