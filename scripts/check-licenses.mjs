#!/usr/bin/env node
// Dependency license gate.
//
// Reads the allowlist from license_decisions.yml — the same decisions file the
// retired GitLab license_scanning job used, so it stays the single source of
// truth for license policy — and verifies every package in package-lock.json
// against it.
//
// Why the lockfile rather than `npm ls` or a node_modules walk: it is the
// authoritative record of exactly what gets installed, it carries a `license`
// field for every entry, and it works in CI before/without a full install.
//
// Policy: a dependency you *distribute* must be allowed. npm publishes only
// production dependencies, so violations there fail the build; devDependencies
// are never shipped and are reported as warnings.
//
// Usage: node scripts/check-licenses.mjs [--strict-dev]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECISIONS = path.join(ROOT, 'license_decisions.yml');
const LOCKFILE = path.join(ROOT, 'package-lock.json');

const STRICT_DEV = process.argv.includes('--strict-dev');

// ─── Minimal YAML reader ───────────────────────────────────────────
// Parses only the subset license_decisions.yml actually uses: a top-level key
// whose value is a list of scalar strings, plus `#` comments and a leading
// document marker. This is deliberately not a general YAML parser — if the
// decisions file grows nested structures, swap this for a real parser.
function readDecisions(file) {
  if (!fs.existsSync(file)) {
    fail(`license decisions file not found: ${file}`);
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const lists = {};
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#') || line.trim() === '---') continue;

    const listStart = line.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (listStart) { current = listStart[1]; lists[current] ??= []; continue; }

    const inline = line.match(/^([A-Za-z_][\w-]*):\s*\[(.*)\]\s*$/);
    if (inline) {
      lists[inline[1]] = inline[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      current = null;
      continue;
    }

    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (item && current) {
      lists[current].push(item[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }

    current = null; // any other shape ends the current list
  }
  return lists;
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const decisions = readDecisions(DECISIONS);
const allowed = new Set(decisions.allowed_licenses ?? []);
const reviewed = new Set(decisions.reviewed_packages ?? []);

if (allowed.size === 0) {
  fail(`no "allowed_licenses" list found in ${path.relative(ROOT, DECISIONS)}`);
}

// ─── SPDX evaluation ───────────────────────────────────────────────
// "MIT OR Apache-2.0"  -> compliant if EITHER branch is allowed (you pick one)
// "MIT AND CC0-1.0"    -> compliant only if BOTH are allowed (both apply)
// "Apache-2.0 WITH LLVM-exception" -> evaluate the base license
// "SEE LICENSE IN COPYING" / "UNLICENSED" / absent -> indeterminate
function normalize(id) {
  return String(id).trim().replace(/^\((.*)\)$/, '$1').trim();
}

function isAllowed(expr) {
  const e = normalize(expr);
  if (!e) return { ok: false, reason: 'no license field' };
  if (/^SEE LICENSE IN\b/i.test(e) || /^UNLICENSED$/i.test(e)) {
    return { ok: false, reason: `non-SPDX license expression: ${e}` };
  }

  const base = e.split(/\s+WITH\s+/i)[0].trim();

  if (/\s+OR\s+/i.test(base)) {
    const parts = base.split(/\s+OR\s+/i).map(normalize);
    return parts.some(p => allowedHas(p))
      ? { ok: true, reason: `one of "${parts.join('" | "')}" is allowed` }
      : { ok: false, reason: `none of "${parts.join('" | "')}" is allowed` };
  }

  if (/\s+AND\s+/i.test(base)) {
    const parts = base.split(/\s+AND\s+/i).map(normalize);
    const disallowed = parts.filter(p => !allowedHas(p));
    return disallowed.length === 0
      ? { ok: true, reason: `all of "${parts.join('" + "')}" are allowed` }
      : { ok: false, reason: `"${disallowed.join('", "')}" not allowed (AND requires every branch)` };
  }

  return allowedHas(base)
    ? { ok: true, reason: base }
    : { ok: false, reason: `"${base}" is not in the allowlist` };
}

function allowedHas(id) {
  if (allowed.has(id)) return true;
  const lower = id.toLowerCase();
  for (const a of allowed) if (a.toLowerCase() === lower) return true;
  return false;
}

// ─── Scan ──────────────────────────────────────────────────────────
if (!fs.existsSync(LOCKFILE)) fail(`lockfile not found: ${LOCKFILE}`);
let lock;
try {
  lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf-8'));
} catch (e) {
  fail(`could not parse package-lock.json: ${e.message}`);
}

const entries = Object.entries(lock.packages ?? {}).filter(([key]) => key !== '');
if (entries.length === 0) fail('package-lock.json contains no dependency entries');

const tally = new Map();
const violations = [];
const warnings = [];
const skipped = [];

for (const [key, meta] of entries) {
  const name = key.replace(/^.*node_modules\//, '');
  const id = meta.version ? `${name}@${meta.version}` : name;
  const license = meta.license ?? '';
  const isDev = !!meta.dev;

  tally.set(license || '(none)', (tally.get(license || '(none)') ?? 0) + 1);

  if (reviewed.has(id) || reviewed.has(name)) {
    skipped.push({ id, license, reason: 'listed in reviewed_packages' });
    continue;
  }

  const verdict = isAllowed(license);
  if (verdict.ok) continue;

  const record = { id, license: license || '(none)', reason: verdict.reason, dev: isDev };
  if (isDev) warnings.push(record);
  else violations.push(record);
}

// ─── Report ────────────────────────────────────────────────────────
const rel = path.relative(ROOT, DECISIONS);
console.log(`License gate — ${entries.length} packages from package-lock.json`);
console.log(`Allowlist (${rel}): ${[...allowed].join(', ')}`);
console.log('');
console.log('Licenses present:');
for (const [lic, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  const mark = allowedHas(normalize(lic).split(/\s+(?:OR|AND|WITH)\s+/i)[0]) ? '✓' : '✗';
  console.log(`  ${mark} ${String(n).padStart(3)}  ${lic}`);
}

if (skipped.length) {
  console.log(`\nSkipped (explicitly reviewed): ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s.id} (${s.license})`);
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} devDependenc${warnings.length === 1 ? 'y' : 'ies'} outside the allowlist (not distributed, not fatal):`);
  for (const w of warnings) console.log(`  - ${w.id} — ${w.license}: ${w.reason}`);
  console.log('    Re-run with --strict-dev to treat these as failures.');
}

if (violations.length) {
  console.error(`\n❌ ${violations.length} distributed dependenc${violations.length === 1 ? 'y' : 'ies'} outside the allowlist:`);
  for (const v of violations) console.error(`  - ${v.id} — ${v.license}: ${v.reason}`);
  console.error(`\nEither remove/replace the package, or record an explicit decision in ${rel}:`);
  console.error(`  allowed_licenses:\n    - ${violations[0].license}`);
  console.error('  # or, to accept one specific package as reviewed:');
  console.error(`  reviewed_packages:\n    - ${violations[0].id}`);
  process.exit(1);
}

if (STRICT_DEV && warnings.length) {
  console.error(`\n❌ --strict-dev: ${warnings.length} devDependencies outside the allowlist.`);
  process.exit(1);
}

console.log(`\n✅ All distributed dependencies are under an allowed license.`);
