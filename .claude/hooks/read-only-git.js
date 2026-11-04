#!/usr/bin/env node
// PreToolUse hook for the project-reviewer subagent's Bash calls: allows only read-only git
// commands. It's an allowlist, so anything it can't parse is denied. Repo-level git config, such
// as diff.external, is out of scope: this catches an agent's mistakes rather than hostile repos.
const fs = require('node:fs');

const READ_ONLY = new Set([
  'blame', 'describe', 'diff', 'diff-tree', 'grep', 'log', 'ls-files',
  'ls-tree', 'merge-base', 'rev-list', 'rev-parse', 'show', 'status',
]);

// Options of those subcommands that write files or run programs. Git accepts unique abbreviations,
// so `min` is the shortest prefix to treat as the option. `--output-indicator-new` isn't a prefix
// of `--output`, so it stays allowed.
const UNSAFE_OPTIONS = [
  { name: '--output', min: '--ou' },
  { name: '--ext-diff', min: '--ext' },
  { name: '--open-files-in-pager', min: '--op' },
  { name: '--help', min: '--he' },
];

const UNQUOTED_SAFE = /[\w./:@^~=,+%-]/;

/**
 * Splits a command line into commands, each an array of arguments with the quotes removed.
 * Returns a reason string for shell syntax that could hide what actually runs.
 */
function parse(command) {
  const commands = [];
  let args = [];
  let arg = null;
  let quote = null;
  const endArg = () => {
    if (arg !== null) args.push(arg);
    arg = null;
  };
  const endCommand = () => {
    endArg();
    if (args.length) commands.push(args);
    args = [];
  };

  for (const c of command) {
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && '$`\\'.includes(c)) return `\`${c}\` inside double quotes`;
      else arg += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      arg ??= '';
    } else if (c === ' ' || c === '\t') {
      endArg();
    } else if ('&|;\n'.includes(c)) {
      endCommand();
    } else if (UNQUOTED_SAFE.test(c)) {
      arg = (arg ?? '') + c;
    } else {
      return `unquoted \`${c}\``;
    }
  }
  if (quote) return 'an unclosed quote';
  endCommand();
  return commands;
}

function unsafeOption(subcommand, arg) {
  if (subcommand === 'grep' && /^-[^-]*O/.test(arg)) return true;
  const option = arg.split('=')[0];
  return UNSAFE_OPTIONS.some(({ name, min }) => option.length >= min.length && name.startsWith(option));
}

/** The reason to block `command`, or null to allow it. */
function check(command) {
  if (typeof command !== 'string') return 'The command is missing.';
  const commands = parse(command);
  if (typeof commands === 'string') return `The command uses ${commands}.`;
  if (!commands.length) return 'The command is empty.';

  for (const args of commands) {
    if (args[0] !== 'git') return `\`${args[0]}\` isn't git.`;
    const rest = args[1] === '--no-pager' ? args.slice(2) : args.slice(1);
    const [subcommand, ...options] = rest;
    if (!READ_ONLY.has(subcommand)) return `\`git ${subcommand ?? ''}\` isn't on the read-only list.`;
    const unsafe = options.find((arg) => unsafeOption(subcommand, arg));
    if (unsafe) return `\`${unsafe}\` can write files or run programs.`;
  }
  return null;
}

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${reason} project-reviewer may run only read-only git commands (${[...READ_ONLY].join(', ')}), without pipes or redirects. Use Read and Grep for everything else.`,
    },
  }));
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  deny(`The hook could not read its input: ${e.message}.`);
  process.exit(0);
}

const reason = check(input.tool_input?.command);
if (reason) deny(reason);
