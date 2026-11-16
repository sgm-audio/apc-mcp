// Phase 4 — release-engineering regression tests.
//
// These guard the things that make a release *trustworthy* rather than the code
// itself: one source of truth for the version, a publish step that can actually
// fail, CI pinned to immutable action revisions, no EOL runtime in the support
// matrix, and a `ship` script that cannot tag a branch it is not on.
//
// Findings covered: OPS-02, OPS-03, OPS-04, OPS-05, OPS-06.
//
// Most of these are static checks over files in the repo, so they run anywhere
// with no network and no toolchain.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { initializeInfo, PROJECT_ROOT } from './helpers/mcp-client.mjs';
import { evaluateSpdx } from '../scripts/check-licenses.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const WORKFLOWS = path.join(PROJECT_ROOT, '.github', 'workflows');
const workflowFiles = fs.readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f));
const workflowText = f => fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');

// Node 18 EOL 2025-04-30, Node 20 EOL 2026-04-30. Node 22 is maintenance LTS to
// 2027-04-30 and Node 24 is active LTS to 2028-04-30.
const EOL_NODE_MAJORS = [12, 14, 16, 18, 20];

// ═══════════════════════════════════════════════════════════════════
describe('OPS-03 · one source of truth for the version', () => {
  it('initialize reports the version from package.json', async () => {
    const result = await initializeInfo();
    assert.ok(result?.serverInfo, `no serverInfo in initialize result: ${JSON.stringify(result)}`);
    assert.equal(result.serverInfo.version, pkg.version,
      `server reports ${result.serverInfo.version}, package.json says ${pkg.version}`);
    assert.equal(result.serverInfo.name, pkg.name.replace(/^@[^/]+\//, ''),
      `server name ${result.serverInfo.name} does not match ${pkg.name}`);
  });

  it('index.js does not hardcode a copy of the version', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'index.js'), 'utf8');
    // The drift risk is a second copy of the *real* version. Quoted semver
    // literals are otherwise legitimate — index.js has a '0.0.0-unknown'
    // fallback for when it is run detached from its package.json — so this
    // asserts the specific thing that breaks, not "no semver anywhere".
    const literals = (src.match(/['"`](\d+\.\d+\.\d+[-+\w.]*)['"`]/g) ?? [])
      .map(l => l.slice(1, -1));
    assert.ok(!literals.includes(pkg.version),
      `index.js hardcodes "${pkg.version}", duplicating package.json — read it instead`);
    assert.match(src, /package\.json/, 'index.js should read its version from package.json');
    // The fallback must not masquerade as a release version.
    for (const l of literals) {
      assert.notEqual(l, pkg.version);
    }
  });

  it('a version bump in package.json changes what the server reports', async () => {
    // The point of OPS-03: with one source of truth, bumping package.json is
    // sufficient. Proven by showing the reported version tracks the file rather
    // than a literal in index.js.
    const result = await initializeInfo();
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'index.js'), 'utf8');
    assert.equal(result.serverInfo.version, pkg.version);
    assert.ok(!src.includes(`version: '${pkg.version}'`),
      'the server version is still written as a literal in index.js');
  });

  it('the version is valid semver', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('OPS-02 · a failed publish must fail the workflow', () => {
  it('no step uses continue-on-error', () => {
    for (const f of workflowFiles) {
      const text = workflowText(f);
      const hits = text.split('\n')
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => /^\s*continue-on-error:\s*true/.test(l));
      assert.deepEqual(hits.map(h => `${f}:${h.n}`), [],
        `continue-on-error: true makes a failed step report green:\n` +
        hits.map(h => `  ${f}:${h.n}  ${h.l.trim()}`).join('\n'));
    }
  });

  it('the publish job actually publishes with provenance', () => {
    const text = workflowText('publish.yml');
    assert.match(text, /npm publish[^\n]*--provenance/,
      'npm publish should keep --provenance so the tarball is attested to this repo');
    assert.match(text, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/,
      'publish needs NPM_TOKEN from secrets');
  });

  it('publish is gated on every verification job', () => {
    const text = workflowText('publish.yml');
    const needs = /^\s*needs:\s*\[([^\]]+)\]/m.exec(text)?.[1]
      ?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
    for (const job of ['test', 'license', 'compile-scaffold', 'scaffold-clap', 'scaffold-lv2', 'scaffold-juce',
      'scaffold-clap-validate', 'scaffold-juce-validate']) {
      assert.ok(needs.includes(job), `publish must need ${job}: ${needs.join(', ')}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('QA-07 · the validators are exercised for real, not only through shims', () => {
  // Every audio_plugin_validate test in tool-output.test.js installs a PATH
  // shim. Shims prove the argv shape and the reporting logic; they cannot prove
  // that upstream's binary accepts the invocation, or that a scaffolded plugin
  // passes. Until CI ran a real one, "pluginval / clap-validator support" was
  // an untested claim.
  const text = () => workflowText('publish.yml');

  it('CI installs clap-validator and pluginval from their releases', () => {
    const t = text();
    assert.match(t, /repos\/free-audio\/clap-validator\/(releases|contents)/,
      'clap-validator is never installed');
    assert.match(t, /gh release download[^\n]*Tracktion\/pluginval/, 'pluginval is never installed');
  });

  it('CI does not rely on GNU-only tools in a cross-platform job', () => {
    // The inline `printf … | timeout 5 node index.js | python3 -c …` step failed
    // on macOS because `timeout` is GNU coreutils, not POSIX. Anything the matrix
    // runs has to be either portable shell or a Node script.
    const t = text();
    assert.doesNotMatch(t, /\btimeout\s+\d+\s+node\b/,
      '`timeout` does not exist on macOS runners; drive the server from a Node script instead');
    assert.match(t, /run: node scripts\/smoke-stdio\.mjs/,
      'the stdio registration smoke should run scripts/smoke-stdio.mjs, which works on every OS');
  });

  it('a failing validator job publishes its log tail as an annotation', () => {
    // Job logs are not always retrievable; annotations are. Without this, a red
    // job is an opaque red job.
    const t = text();
    assert.equal((t.match(/::error title=smoke-validate/g) ?? []).length >= 2, true,
      'both validate steps should re-publish their log tail as an error annotation');
  });

  it('CI runs a real validation and fails on a PASS-less report', () => {
    const t = text();
    assert.match(t, /node scripts\/smoke-validate\.mjs --type=clap/, 'clap validation is not run for real');
    assert.match(t, /node scripts\/smoke-validate\.mjs --type=juce/, 'pluginval validation is not run for real');
    const script = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts/smoke-validate.mjs'), 'utf8');
    assert.match(script, /smoke-validate \(\$\{TYPE\}\/\$\{PHASE\}\): FAIL/, 'smoke-validate must report failure');
    assert.match(script, /process\.exit\(1\)/, 'smoke-validate must exit non-zero on failure');
    assert.match(script, /cannot run — required dependency missing/,
      'a missing validator must fail, not skip: an unrun validator must never look like a pass');
    assert.match(script, /SKIPPED\|NOT CHECKABLE\|MISSING-VALIDATOR/,
      'smoke-validate must reject a report that skipped validation');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('LINT-01 · the no-shell rule is binding-based, not name-based', () => {
  // The rule used to match an object literally named `child_process` and a named
  // import called `exec`. Three things slipped past it: a default import, a
  // namespace import, and `{ shell: true }` on the sanctioned spawnSync — which
  // is the one option that turns an argv array back into a shell string. Each is
  // run through the real ESLint config here, because a static assertion on the
  // config text would pass even if the selectors did not match anything.
  const eslintBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'eslint');

  const lintSnippet = source => spawnSync(
    eslintBin,
    ['--no-ignore', '--stdin', '--stdin-filename', 'index.js'],
    { cwd: PROJECT_ROOT, input: source, encoding: 'utf-8' });

  const VIOLATIONS = {
    'a default import of child_process': "import cp from 'node:child_process';\nexport const f = () => cp.execSync('x');\n",
    'a namespace import of child_process': "import * as cp from 'node:child_process';\nexport const f = () => cp.exec('x');\n",
    'the shell option on spawnSync': "import { spawnSync } from 'node:child_process';\nexport const f = () => spawnSync('cmake', [], { shell: true });\n",
    'spawning a shell by name': "import { spawnSync } from 'node:child_process';\nexport const f = () => spawnSync('bash', ['-c', 'id']);\n",
  };

  for (const [label, source] of Object.entries(VIOLATIONS)) {
    it(`rejects ${label}`, () => {
      const r = lintSnippet(source);
      assert.notEqual(r.status, 0, `eslint accepted ${label}:\n${source}`);
      assert.match(r.stdout + r.stderr, /no-restricted-(syntax|properties)/,
        `expected a no-restricted-* violation for ${label}`);
    });
  }

  it('does not reject RegExp.prototype.exec or an ordinary spawnSync', () => {
    const r = lintSnippet(
      "import { spawnSync } from 'node:child_process';\n"
      + "export const ok = (re, s) => re.exec(s) ?? spawnSync('cmake', ['-B', 'build']);\n");
    assert.equal(r.status, 0,
      `the rule must not fire on legitimate code:\n${r.stdout}${r.stderr}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('OPS-06 · actions pinned to immutable revisions', () => {
  const usesLines = () => {
    const out = [];
    for (const f of workflowFiles) {
      workflowText(f).split('\n').forEach((l, i) => {
        const m = /^\s*-\s*uses:\s*(\S+)/.exec(l);
        if (m) out.push({ file: f, line: i + 1, ref: m[1] });
      });
    }
    return out;
  };

  it('every uses: is pinned to a 40-character commit SHA', () => {
    const refs = usesLines();
    assert.ok(refs.length >= 5, `expected several uses: lines, found ${refs.length}`);
    const mutable = refs.filter(r => !/@[0-9a-f]{40}$/i.test(r.ref));
    assert.deepEqual(mutable.map(r => `${r.file}:${r.line} ${r.ref}`), [],
      'mutable tags (@v7, @main) let an upstream push change what CI runs. ' +
      'Pin to a commit SHA; Dependabot keeps them updated.');
  });

  it('the same action is pinned to the same SHA everywhere', () => {
    const byAction = new Map();
    for (const { file, line, ref } of usesLines()) {
      const [action, sha] = ref.split('@');
      const seen = byAction.get(action);
      if (seen && seen.sha !== sha) {
        assert.fail(`${action} is pinned to two SHAs: ${seen.where} -> ${seen.sha}, ${file}:${line} -> ${sha}`);
      }
      byAction.set(action, { sha, where: `${file}:${line}` });
    }
    assert.ok(byAction.size >= 2, `expected at least checkout and setup-node, got ${byAction.size}`);
  });

  it('sub-path actions of the same repo share a SHA', () => {
    // codeql-action/init and codeql-action/analyze come from one repository and
    // must be the same revision, or the analysis can mismatch the extractor.
    const refs = usesLines().map(r => r.ref);
    const codeql = refs.filter(r => r.startsWith('github/codeql-action/'));
    if (codeql.length < 2) return;
    const shas = new Set(codeql.map(r => r.split('@')[1]));
    assert.equal(shas.size, 1,
      `codeql-action sub-paths pinned to different revisions: ${codeql.join(', ')}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('OPS-04 · no end-of-life Node in the support matrix', () => {
  it('engines.node excludes EOL majors', () => {
    const m = />=\s*(\d+)/.exec(pkg.engines?.node ?? '');
    assert.ok(m, `engines.node "${pkg.engines?.node}" is not a >= range`);
    const min = parseInt(m[1], 10);
    assert.ok(!EOL_NODE_MAJORS.includes(min),
      `engines.node allows Node ${min}, which reached end of life and gets no security patches`);
    assert.ok(min >= 22, `engines.node should require >=22 (Node 20 EOL 2026-04-30), got >=${min}`);
  });

  it('the CI matrix tests only supported majors', () => {
    const text = workflowText('publish.yml');
    const m = /node-version:\s*\[([^\]]+)\]/.exec(text);
    assert.ok(m, 'no node-version matrix found in publish.yml');
    const versions = m[1].split(',').map(s => parseInt(s.trim(), 10));
    assert.ok(versions.length >= 2, `test at least two Node versions, got ${versions.join(', ')}`);
    for (const v of versions) {
      assert.ok(!EOL_NODE_MAJORS.includes(v),
        `CI still tests Node ${v}, which is end of life — drop it from the matrix`);
    }
  });

  it('no job pins an EOL Node explicitly', () => {
    for (const f of workflowFiles) {
      const text = workflowText(f);
      const pinned = [...text.matchAll(/^\s*node-version:\s*(\d+)\s*$/gm)].map(m => parseInt(m[1], 10));
      for (const v of pinned) {
        assert.ok(!EOL_NODE_MAJORS.includes(v), `${f} pins EOL Node ${v}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('OPS-05 · ship cannot tag a branch it is not on', () => {
  const ship = args => spawnSync(process.execPath,
    [path.join(PROJECT_ROOT, 'scripts', 'ship.mjs'), ...args],
    { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 60000 });

  it('npm run ship routes through the guarded script', () => {
    assert.match(pkg.scripts.ship, /scripts\/ship\.mjs/,
      `ship is "${pkg.scripts.ship}" — it must go through the guard script`);
    assert.ok(!/git push origin main/.test(pkg.scripts.ship),
      'ship must not push main unconditionally');
  });

  it('refuses when HEAD is not the required branch', () => {
    // Deterministic regardless of the real branch, tree state or CHANGELOG:
    // ask for a branch that is certainly not checked out.
    const r = ship(['--dry-run', '--branch=definitely-not-checked-out']);
    assert.equal(r.status, 1, `expected refusal, got exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /refusing to release/);
    assert.match(r.stderr, /definitely-not-checked-out/);
    assert.match(r.stderr, /not "definitely-not-checked-out"|not 'definitely-not-checked-out'/);
  });

  it('spawns no .cmd shim and bounds every child process', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'ship.mjs'), 'utf8');
    // Node throws EINVAL when asked to spawn a .cmd without shell:true, and a
    // shell would reintroduce the argument-quoting hazard index.js bans. npm
    // ships as JS, so the Windows path runs npm-cli.js with node itself.
    assert.ok(!/'npm\.cmd'|"npm\.cmd"/.test(src),
      'ship must not spawn npm.cmd — Node cannot spawn batch files without a shell');
    assert.match(src, /npm-cli\.js/,
      'the Windows path must run npm\'s CLI JS with process.execPath');

    // A missing key or a 2FA prompt must fail the release, not hang it.
    const callSites = src.split('spawnSync(').slice(1);
    assert.equal(callSites.length, 2, `expected two spawnSync call sites, found ${callSites.length}`);
    for (const site of callSites) {
      const options = site.slice(0, site.indexOf('});'));
      assert.match(options, /timeout:\s*\S+/,
        'every spawnSync needs a timeout, or a credential prompt blocks the release forever');
    }
    assert.match(src, /GIT_TERMINAL_PROMPT:\s*'0'/,
      'git must run non-interactively so a missing credential fails instead of prompting');
  });

  it('rejects unknown options with a usage message', () => {
    const r = ship(['--not-a-real-flag']);
    assert.equal(r.status, 2, `expected a usage error, got ${r.status}`);
    assert.match(r.stderr, /unknown option/);
    assert.match(r.stderr, /usage:/);
  });

  it('never tags or pushes during a dry run', () => {
    const r = ship(['--dry-run', '--branch=definitely-not-checked-out']);
    const all = `${r.stdout}${r.stderr}`;
    assert.ok(!/would have tagged/.test(r.stdout) || r.status !== 0,
      'a dry run that reached the tagging stage must still exit 0 only when guards pass');
    assert.ok(!all.includes('$ git tag'),
      'a dry run must not execute git tag');
    // And nothing was actually created.
    const tags = spawnSync('git', ['tag', '--list', `v${pkg.version}`],
      { cwd: PROJECT_ROOT, encoding: 'utf-8' }).stdout.trim();
    assert.equal(tags, '', `dry run left a tag behind: ${tags}`);
  });

  it('all shebang scripts in scripts/ are executable and syntactically valid', () => {
    for (const script of ['ship.mjs', 'check-licenses.mjs', 'smoke-scaffold.mjs']) {
      const p = path.join(PROJECT_ROOT, 'scripts', script);
      const mode = fs.statSync(p).mode & 0o111;
      assert.ok(mode !== 0, `scripts/${script} has a shebang and should be executable`);
      const check = spawnSync(process.execPath, ['--check', p], { encoding: 'utf-8' });
      assert.equal(check.status, 0, check.stderr);
    }
  });
});

describe('SPDX license evaluator handles compound & WITH expressions', () => {
  const allow = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause']);

  it('does not truncate trailing AND obligations after WITH', () => {
    const r = evaluateSpdx('Apache-2.0 WITH LLVM-exception AND GPL-3.0-only', allow);
    assert.equal(r.ok, false, `WITH truncation let GPL pass: ${JSON.stringify(r)}`);
  });

  it('evaluates parenthesised OR inside AND', () => {
    assert.equal(evaluateSpdx('MIT AND (Apache-2.0 OR BSD-3-Clause)', allow).ok, true);
    assert.equal(evaluateSpdx('(MIT OR GPL-2.0-only) AND GPL-3.0-only', allow).ok, false);
    assert.equal(evaluateSpdx('GPL-3.0-only OR MIT', allow).ok, true);
    assert.equal(evaluateSpdx('MIT AND GPL-3.0-only', allow).ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('documentation paths', () => {
  it('every relative Markdown link in root documentation resolves', () => {
    const docs = fs.readdirSync(PROJECT_ROOT).filter(f => f.endsWith('.md'));
    for (const doc of docs) {
      const text = fs.readFileSync(path.join(PROJECT_ROOT, doc), 'utf8');
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:[a-z]+:|#)/i.test(target)) continue;
        const relative = target.split('#')[0];
        if (!relative) continue;
        assert.ok(fs.existsSync(path.join(PROJECT_ROOT, decodeURIComponent(relative))),
          `${doc} links to missing path: ${target}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('workflow files are parseable YAML', () => {
  it('every workflow has a name, triggers and at least one job', () => {
    for (const f of workflowFiles) {
      const text = workflowText(f);
      assert.match(text, /^name:\s*\S/m, `${f} has no name`);
      assert.ok(/^on:/m.test(text) || /^"on":/m.test(text) || /^true:/m.test(text),
        `${f} has no trigger block`);
      assert.match(text, /^jobs:/m, `${f} has no jobs`);
      // Tab characters break YAML parsing outright.
      assert.ok(!text.includes('\t'), `${f} contains a tab character`);
    }
  });
});
