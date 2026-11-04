#!/usr/bin/env node
// Stop hook: type-checks and tests uncommitted changes in src/, test/ and scripts/. esbuild doesn't
// type-check, so type errors otherwise only surface in CI. A failure sends Claude back to fix it.
//
// Each exact state of the code is checked once per session, so a turn that changed nothing doesn't
// re-run the checks or send Claude after unfinished work, and a failure Claude can't fix can't loop.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PATHS = ['src', 'test', 'scripts'];
const MAX_ATTEMPTS = 3;
const OUTPUT_LIMIT = 6000;

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const say = (message) => console.log(JSON.stringify({ systemMessage: message }));

/** A hash of the uncommitted code, or null if nothing has changed (or this isn't a git repo). */
function codeState() {
  const status = run('git', ['status', '--porcelain', '--', ...PATHS]);
  if (status.status !== 0 || !status.stdout.trim()) return null;
  const hash = crypto.createHash('sha256').update(status.stdout);
  hash.update(run('git', ['diff', 'HEAD', '--', ...PATHS]).stdout);
  const untracked = run('git', ['ls-files', '-o', '--exclude-standard', '--', ...PATHS]).stdout;
  for (const file of untracked.split('\n').filter(Boolean)) {
    hash.update(file);
    try {
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {}
  }
  return hash.digest('hex');
}

function runChecks() {
  const failures = [];
  for (const script of [['run', 'typecheck'], ['test']]) {
    const result = run('npm', script);
    if (result.status === 0) continue;
    const output = `${result.stdout}${result.stderr}`.trim();
    failures.push(`\`npm ${script.join(' ')}\` failed:\n${output.slice(-OUTPUT_LIMIT)}`);
  }
  return failures;
}

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {}

const state = codeState();
if (!state) process.exit(0);

if (!fs.existsSync(path.join(root, 'node_modules', '.bin', 'tsc'))) {
  say('Skipped the type-check and tests: run `npm ci` first.');
  process.exit(0);
}

const session = String(input.session_id || 'default').replace(/[^\w-]/g, '');
const stateFile = path.join(os.tmpdir(), `cwinvoicer-stop-check-${session}.json`);
let last = {};
try {
  last = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch {}

if (last.state === state) {
  if (last.failed) say('The type-check or tests are still failing on the uncommitted code.');
  process.exit(0);
}

const failures = runChecks();
const attempts = input.stop_hook_active ? (last.attempts || 0) + 1 : 1;
fs.writeFileSync(stateFile, JSON.stringify({ state, failed: failures.length > 0, attempts }));

if (!failures.length) process.exit(0);
if (attempts > MAX_ATTEMPTS) {
  say(`The type-check or tests are still failing after ${MAX_ATTEMPTS} attempts to fix them.`);
  process.exit(0);
}
console.log(JSON.stringify({
  decision: 'block',
  reason: `The automatic check of the uncommitted code failed. Fix this, or tell the user why it can't be fixed now.\n\n${failures.join('\n\n')}`,
}));
