#!/usr/bin/env node
// Documentation hygiene gate.
//
// Checks relative Markdown/HTML links across EVERY .md file in the repository
// (including docs/, docs/archive/ and .github/), verifies cross-file anchors
// against GitHub-style heading slugs, and makes sure docs/README.md indexes
// every maintained document. No dependencies, no network, no shell.
//
// Usage: node scripts/check-docs.mjs   (or `npm run docs:check`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.arena', '.cache', 'build', 'dist']);

function markdownFiles(dir = ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...markdownFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// Blank out fenced code blocks; line structure is preserved for error messages.
// Anchors are computed from this (headings keep inline code, GitHub keeps the
// enclosed words in the slug), while link extraction additionally strips inline
// code so example snippets are not mistaken for real links.
function withoutFences(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  }).join('\n');
}

function proseOnly(text) {
  return withoutFences(text)
    .split('\n')
    .map((line) => line.replace(/`[^`]*`/g, ''))
    .join('\n');
}

// GitHub renders inline HTML in a heading before deriving its anchor, so tag
// names must not leak into the slug. Scan characters rather than doing a
// single regex replacement: one pass over "<<script>script>" would leave a
// partial tag behind. The result is only compared with link fragments — it is
// never emitted as HTML.
function stripTags(text) {
  let out = '';
  let inTag = false;
  for (const ch of text) {
    if (ch === '<') {
      inTag = true;
    } else if (ch === '>') {
      inTag = false;
    } else if (!inTag) {
      out += ch;
    }
  }
  return out;
}

// GitHub heading anchors: lowercase, strip punctuation, spaces -> hyphens.
function slugify(heading) {
  return stripTags(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of text.split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slugify(heading[1]);
      if (!base) continue;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
      continue;
    }
    // Explicit anchors used by hand-written HTML navigation.
    for (const m of line.matchAll(/<a\s+[^>]*(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
      anchors.add(m[1]);
    }
  }
  return anchors;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i;

function linksIn(file, text) {
  const links = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      links.push(m[1]);
    }
    for (const m of line.matchAll(/\b(?:href|src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
      for (const candidate of m[1].split(',')) {
        const target = candidate.trim().split(/\s+/)[0];
        if (target) links.push(target);
      }
    }
  }
  return links.map((target) => ({ file, target }));
}

const files = markdownFiles();
const failures = [];
let checkedLinks = 0;
let checkedAnchors = 0;

for (const file of files) {
  const rawText = fs.readFileSync(file, 'utf8');
  const text = proseOnly(rawText);
  const fileAnchors = anchorsOf(withoutFences(rawText));
  for (const { target } of linksIn(file, text)) {
    if (EXTERNAL.test(target) && !target.startsWith('#')) continue;
    const hash = target.indexOf('#');
    const rawPath = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? null : decodeURIComponent(target.slice(hash + 1));
    let resolved = file;
    if (rawPath) {
      try {
        resolved = path.resolve(path.dirname(file), decodeURIComponent(rawPath));
      } catch {
        failures.push(`${rel(file)}: malformed link target ${target}`);
        continue;
      }
      checkedLinks += 1;
      if (!fs.existsSync(resolved)) {
        failures.push(`${rel(file)}: broken link -> ${target}`);
        continue;
      }
    }
    if (anchor) {
      checkedAnchors += 1;
      if (anchor.startsWith('/') || anchor.startsWith(':')) continue; // route-style href
      const targetAnchors = resolved === file
        ? fileAnchors
        : anchorsOf(withoutFences(fs.readFileSync(resolved, 'utf8')));
      if (!targetAnchors.has(anchor)) {
        failures.push(`${rel(file)}: missing anchor "#${anchor}" in ${rel(resolved)} -> ${target}`);
      }
    }
  }
}

// The docs index must link every maintained document, so new docs cannot be
// added without a navigation entry.
const docsDir = path.join(ROOT, 'docs');
const indexPath = path.join(docsDir, 'README.md');
const indexText = proseOnly(fs.readFileSync(indexPath, 'utf8'));
const indexed = new Set(linksIn(indexPath, indexText).map(({ target }) => {
  const p = target.split('#')[0];
  return p ? path.resolve(docsDir, p) : null;
}));
for (const file of fs.readdirSync(docsDir, { withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith('.md') || file.name === 'README.md') continue;
  if (!indexed.has(path.join(docsDir, file.name))) {
    failures.push(`docs/README.md does not index docs/${file.name}`);
  }
}
// The root README must link the docs index.
const rootReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
if (!/docs\/README\.md/.test(proseOnly(rootReadme))) {
  failures.push('README.md does not link docs/README.md');
}

const summary = `${files.length} Markdown files, ${checkedLinks} relative paths, ` +
  `${checkedAnchors} anchors, ${fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).length - 1} indexed docs`;
if (failures.length) {
  console.error(`docs: FAIL (${summary})\n` + failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`docs: OK (${summary}) — all links, anchors and index entries resolve`);
}
