#!/usr/bin/env node
// Repeats the test suite (or one file) until it fails, to reproduce a flake.
//
// Why this exists: on 2026-11-20 seven `test (*, macos-latest)` runs on main
// failed, always on exactly one Node leg and never on Linux, and the failing test
// name could not be recovered afterwards (see scripts/report-tests.mjs for that
// story). A single 96-second run per platform proves very little about a race
// that fires on roughly one job in a hundred, so the way to settle it is
// repetition on the platform that exhibits it.
//
// Usage:
//   node scripts/stress-tests.mjs                    # whole suite, 10 iterations
//   node scripts/stress-tests.mjs --iterations=50
//   node scripts/stress-tests.mjs tests/security.test.js --iterations=20
//   node scripts/stress-tests.mjs --concurrency=4    # tests in parallel, per run
//   node scripts/stress-tests.mjs --par=3            # three suites at once
//
// Exits 1 on the first failing iteration and prints that run's failing tests
// through the same TAP parser the CI reporter uses, so a reproduction names
// itself. Exits 0 only if every iteration passed — silence is not evidence, but
// a clean 50-iteration run is a far better argument than a single green run.
//
// Not a test file itself — `node --test` only picks up *.test.js.

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTap, rankFailures } from './report-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse `--flag=value`, `--flag value` and bare positional file arguments. */
function parseArgs(argv) {
  const opts = { iterations: 10, concurrency: 0, par: 1, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = /^--([\w-]+)=(.*)$/.exec(arg);
    const key = eq ? eq[1] : (arg.startsWith('--') ? arg.slice(2) : null);
    const inline = eq ? eq[2] : null;
    if (key === null) { opts.files.push(arg); continue; }
    const takeValue = () => (inline !== null ? inline : argv[++i]);

    if (key === 'iterations') opts.iterations = Number(takeValue());
    else if (key === 'concurrency') opts.concurrency = Number(takeValue());
    else if (key === 'par') opts.par = Number(takeValue());
    else if (key === 'help') { opts.help = true; }
    else throw new Error(`unknown option --${key}`);
  }
  for (const k of ['iterations', 'par']) {
    if (!Number.isFinite(opts[k]) || opts[k] < 1) {
      throw new Error(`--${k} must be a positive number, got ${opts[k]}`);
    }
  }
  // 0 means "do not pass --test-concurrency at all", i.e. Node's own default,
  // so it is the one value that is explicitly allowed here.
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 0) {
    throw new Error(`--concurrency must be zero or a positive number, got ${opts.concurrency}`);
  }
  return opts;
}

/**
 * Run `node --test` once, returning its TAP output.
 * @param {string[]} files
 * @param {number} concurrency `--test-concurrency`, or 0 to let Node decide
 */
function runOnce(files, concurrency) {
  const args = ['--test'];
  if (concurrency) args.push(`--test-concurrency=${concurrency}`);
  args.push(...files);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GITHUB_ACTIONS: '' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const USAGE = [
  'Usage: node scripts/stress-tests.mjs [files...] [--iterations=N]',
  '                                   [--concurrency=N] [--par=N]',
  '',
  '  --iterations=N   how many times to run the suite (default 10)',
  '  --concurrency=N  pass --test-concurrency=N to node --test (tests in parallel)',
  '  --par=N          run N suites simultaneously, to load the machine (default 1)',
].join('\n');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }

  console.log(`node ${process.version} on ${os.platform()}/${os.arch()}, `
    + `${os.cpus().length} cpus, ulimit -n ${process.env.APC_ULIMIT ?? 'default'}`);
  console.log(`${opts.iterations} iteration(s), par=${opts.par}, `
    + `concurrency=${opts.concurrency || 'default'}`
    + `${opts.files.length ? `, files: ${opts.files.join(' ')}` : ''}\n`);

  for (let iteration = 1; iteration <= opts.iterations; iteration += 1) {
    const started = Date.now();
    // `--par` suites share the machine, which is the point: a race that needs
    // CPU contention to surface will not appear in a lonely run.
    const runs = await Promise.all(Array.from({ length: opts.par }, async () => runOnce(opts.files, opts.concurrency)));
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const failed = runs.filter(r => r.status !== 0);

    if (failed.length) {
      console.error(`iteration ${iteration} FAILED after ${elapsed}s `
        + `(${failed.length}/${runs.length} parallel run(s))`);
      for (const run of failed) {
        const failures = rankFailures(parseTap(run.stdout));
        if (failures.length) {
          for (const f of failures) {
            const suite = f.suite.length ? `${f.suite.join(' > ')} > ` : '';
            console.error(`\n  ${suite}${f.name}`);
            if (f.file) console.error(`  at ${f.file}:${f.line}`);
            if (f.error) {
              console.error(f.error.split('\n').map(l => `    ${l}`).join('\n'));
            }
          }
        } else {
          // A crash before TAP (bad flag, missing dependency) has no records.
          console.error(`\n  no TAP failures parsed; last output:\n${run.stderr.slice(-2000)}`);
        }
      }
      return 1;
    }

    console.log(`iteration ${iteration}/${opts.iterations} passed (${elapsed}s)`);
  }

  console.log(`\nAll ${opts.iterations} iteration(s) passed. A flake may still need `
    + 'more iterations, a loaded machine (--par) or the platform it was seen on.');
  return 0;
}

main().then(
  code => { process.exitCode = code; },
  error => { console.error(`test-stress: ${error.message}\n\n${USAGE}`); process.exitCode = 2; },
);
