#!/usr/bin/env node
// Turns `node --test` TAP output into GitHub check annotations.
//
// Why this exists: a `test (*, macos-latest)` job failed seven times on `main`
// between 20:09 and 21:42 on 2026-11-20, always on exactly one of the two Node
// legs and never on Linux. The macOS legs failed at the *alternating* Node
// version across consecutive commits (macOS 24 on e2f5d2d, macOS 22 on
// 1255b52 — one commit later, skills only), which is the signature of a timing
// flake rather than a code defect. It could not be diagnosed because the only
// thing GitHub exposed was "Process completed with exit code 1": the `Test`
// step's stdout is not retrievable through the API and the HTML log view
// requires authentication. So the failing test name was lost.
//
// This script closes that hole. It reads the TAP stream, prints a one-line
// annotation per failing test, and passes the raw TAP through unchanged so the
// job log is still complete. The annotation carries the test name, the suite
// path, the file:line and the assertion message, all of which are visible on the
// check run through `repos/{owner}/{repo}/check-runs/{id}/annotations` — the one
// diagnostic channel that survives without auth.
//
// Usage in CI:  set -o pipefail; npm test 2>&1 | node scripts/report-tests.mjs
// Locally:      npm test 2>&1 | node scripts/report-tests.mjs
//
// Annotations are only emitted when GITHUB_ACTIONS is set; locally the script
// prints a readable summary instead, because raw `::error` lines are noise.
//
// Not a test file itself — `node --test` only picks up *.test.js.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Long enough for a real assertion diff, short enough to stay under the
// runner's per-annotation limit. Mirrors the 3000-byte cap the smoke-validate
// steps already use when they surface a build log.
const MAX_MESSAGE = 3000;

// GitHub renders at most 10 annotations per step; anything beyond is silently
// dropped. Emitting a hundred lines for one root cause (a missing dependency
// makes every spawn-based test fail with the same "server exited" message) would
// hide the interesting ones behind that limit, so only the first ten are
// annotated and the rest are counted in the summary.
const MAX_ANNOTATIONS = 10;

/**
 * One failing test, as recovered from the TAP stream.
 * @typedef {object} TapFailure
 * @property {number} depth indentation of the `not ok` line, used for ordering
 * @property {string} name the test's own name, without its suite path
 * @property {string} type `test` or `suite`
 * @property {string} failureType TAP `failureType`, e.g. `testCodeFailure`
 * @property {string} file absolute path from the TAP `location` field, or ''
 * @property {number} line 1-based row from `location`, or 0
 * @property {string} error the assertion message, de-indented
 * @property {string[]} suite enclosing suite names, outermost first
 */

/**
 * Parse the TAP stream emitted by `node --test` into failure records.
 * @param {string} tap
 * @returns {TapFailure[]}
 */
export function parseTap(tap) {
  const lines = tap.split('\n');
  const failures = [];
  // Indent depth of each enclosing `# Subtest:` / `not ok` line, so a leaf can
  // be reported with the suite path that gives it meaning ("FUNC-01 · …").
  /** @type {{ depth: number, name: string }[]} */
  const stack = [];
  /**
   * @type {null | { depth: number, name: string, fields: Map<string, string>,
   *   block: null | { key: string, indent: number, lines: string[] } }} }
   */
  let current = null;

  const finish = () => {
    if (!current) return;
    const { depth, name, fields, block } = current;
    current = null;

    // Materialise a trailing block scalar (`error: |-`, `stack: |-`) into its
    // field, stripping the common indentation so the message reads naturally.
    if (block) {
      const body = block.lines.filter(l => l.trim() !== '');
      const indent = body.length
        ? Math.min(...body.map(l => l.length - l.trimStart().length))
        : 0;
      fields.set(block.key, body.map(l => l.slice(indent)).join('\n'));
    }

    // TAP wraps plain scalars in single quotes: `type: 'suite'`. Strip only a
    // matching pair so a message that legitimately starts with a quote keeps it.
    const value = key => {
      const raw = fields.get(key) ?? '';
      const quoted = /^'(.*)'$/.exec(raw) ?? /^"(.*)"$/.exec(raw);
      return quoted ? quoted[1] : raw;
    };

    const type = value('type');
    const failureType = value('failureType');
    // A suite reports the same failure its children already reported; annotating
    // it would duplicate every real failure once per enclosing describe().
    if (type === 'suite' && failureType === 'subtestsFailed') return;

    let file = '';
    let line = 0;
    const location = value('location');
    // `location: '/repo/tests/x.test.js:6:5'` — strip the trailing row/column.
    const locMatch = /^(.*):(\d+):\d+$/.exec(location);
    if (locMatch) {
      file = locMatch[1];
      line = Number(locMatch[2]);
    }

    failures.push({
      depth,
      name,
      type,
      failureType,
      file,
      line,
      error: value('error').trim(),
      suite: stack.filter(entry => entry.depth < depth).map(entry => entry.name),
    });
  };

  for (const raw of lines) {
    const depth = raw.length - raw.trimStart().length;
    const line = raw.trim();

    // `# Subtest: name` opens a suite; `not ok N - name` closes nothing by
    // itself, but any sibling/ancestor at the same or shallower depth does.
    const subtest = /^# Subtest:\s*(.*)$/.exec(line);
    if (subtest) {
      finish();
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      stack.push({ depth, name: subtest[1] });
      continue;
    }

    const notOk = /^not ok\s+\d+\s+-\s+(.*)$/.exec(line);
    if (notOk) {
      finish();
      current = { depth, name: notOk[1], fields: new Map(), block: null };
      continue;
    }

    if (current) {
      // End of this test's YAML block.
      if (/^\.\.\.$/.test(line)) { finish(); continue; }

      // Inside a block scalar, any line indented deeper than the `key:` line is
      // body — including lines that look like `failureType: '…'` or `...`.
      if (current.block && depth > current.block.indent) {
        current.block.lines.push(raw);
        continue;
      }
      // A shallower line ends the block scalar and is re-examined as a field.
      if (current.block) {
        const { key, lines: body } = current.block;
        const kept = body.filter(l => l.trim() !== '');
        const indent = kept.length
          ? Math.min(...kept.map(l => l.length - l.trimStart().length))
          : 0;
        current.fields.set(key, kept.map(l => l.slice(indent)).join('\n'));
        current.block = null;
      }

      const field = /^([A-Za-z_]+):\s?(.*)$/.exec(line);
      if (field) {
        const [, key, rest] = field;
        current.fields.set(key, rest);
        // `|-` starts a block scalar whose lines follow, indented further.
        if (rest === '|-' || rest === '|') current.block = { key, indent: depth, lines: [] };
        continue;
      }
    }
  }
  finish();

  return failures;
}

/**
 * Escape a value for a GitHub workflow command.
 * @param {string} value
 * @param {boolean} property true for `key=value` properties, which also reserve , and :
 */
export function escapeCommand(value, property = false) {
  let out = String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  if (property) out = out.replace(/:/g, '%3A').replace(/,/g, '%2C');
  return out;
}

/**
 * Render one failure as an `::error` workflow command.
 * @param {TapFailure} failure
 * @param {string} root directory the annotation path is made relative to
 * @returns {string} the command, or '' when it cannot be attributed to a file
 */
export function formatAnnotation(failure, root) {
  if (!failure.file) return '';
  const rel = path.relative(root, failure.file).split(path.sep).join('/');
  // Only annotate files inside the repository; a path outside it cannot be
  // attached to a line of the diff and would make the command malformed.
  if (rel.startsWith('..')) return '';

  const suite = failure.suite.length ? `${failure.suite.join(' > ')} > ` : '';
  const title = `test failed: ${suite}${failure.name}`;
  const message = (failure.error || 'test failed with no message')
    .slice(0, MAX_MESSAGE)
    .replace(/\n{3,}/g, '\n\n');

  const props = [
    `file=${escapeCommand(rel, true)}`,
    failure.line ? `line=${failure.line}` : '',
    `title=${escapeCommand(title, true)}`,
  ].filter(Boolean).join(',');

  return `::error ${props}::${escapeCommand(message)}`;
}

/**
 * A failure that happened only because an earlier one took down the run: a
 * child still in flight when its parent failed is reported as cancelled, and it
 * says nothing about the code. Those are ranked after genuine failures.
 * @param {Pick<TapFailure, 'failureType' | 'error'>} failure
 */
export function isCascade(failure) {
  return /cancelled/i.test(failure.failureType)
    || /did not finish before its parent/i.test(failure.error);
}

/**
 * Order failures so the root causes come first: real assertion/code failures
 * before cascades, and shallower (more general) before deeper within each group.
 * @param {TapFailure[]} failures
 * @returns {TapFailure[]}
 */
export function rankFailures(failures) {
  return [...failures].sort((a, b) => {
    const cascade = Number(isCascade(a)) - Number(isCascade(b));
    if (cascade !== 0) return cascade;
    return a.depth - b.depth;
  });
}

/** True when running inside GitHub Actions. */
export function inActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

/** Read all of stdin as UTF-8. */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const tap = await readStdin();

  // Pass the raw TAP through: CI keeps the complete log, and `--test-reporter`
  // output is the only record of anything the annotations truncate.
  process.stdout.write(tap.endsWith('\n') ? tap : `${tap}\n`);

  const root = process.cwd();
  const failures = rankFailures(parseTap(tap));
  const annotatable = failures.filter(f => formatAnnotation(f, root) !== '');
  const shown = annotatable.slice(0, MAX_ANNOTATIONS);

  for (const failure of shown) console.log(formatAnnotation(failure, root));

  if (annotatable.length > MAX_ANNOTATIONS) {
    const warning = `Only the first ${MAX_ANNOTATIONS} are annotated (GitHub's per-step`
      + ` limit). The remaining ${annotatable.length - MAX_ANNOTATIONS} are in the Test`
      + ' step log; run `npm test` locally to see them all.';
    console.log(`::warning title=${escapeCommand(`test failures: ${annotatable.length} total`, true)}`
      + `::${escapeCommand(warning)}`);
  }

  if (failures.length) {
    // Summary is printed on stderr so it never reads as part of the TAP stream.
    const names = failures.map(f => `  ${f.suite.length ? `${f.suite.join(' > ')} > ` : ''}${f.name}`);
    console.error(`\n${failures.length} failing test(s):\n${names.join('\n')}`);
    if (!inActions()) {
      console.error('\n(set GITHUB_ACTIONS=true to emit ::error annotations instead)');
    }
  }

  // Exit 0 deliberately: the workflow runs this under `set -o pipefail`, so
  // `npm test`'s own exit status is what fails the step. Signalling failure here
  // too would mask a broken reporter as a test failure.
}
