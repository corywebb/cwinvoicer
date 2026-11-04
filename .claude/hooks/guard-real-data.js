#!/usr/bin/env node
// PreToolUse hook for Bash: blocks commands that would run the app against the user's real
// business data, or touch that folder. It reads command text, so it catches mistakes rather
// than being a security boundary: a script that starts the server indirectly won't be seen.
const fs = require('node:fs');

const REAL_FOLDER = /Application(?:\\ | )Support\/CW(?:\\ | )Invoicer/;

const LAUNCHES = [
  /^npm\s+(?:-\S+\s+)*(?:start|run(?:-script)?\s+(?:-\S+\s+)*(?:start|app))(?=\s|$)/,
  /^npx\s+(?:-\S+\s+)*electron(?=\s|$)/,
  /^(?:\S*\/)?electron(?=\s|$)/,
  /^node\s+(?:-\S+\s+)*(?:\.\/)?out\/server(?:\/index(?:\.js)?)?\/?(?=\s|$)/,
];
// The packaged app doesn't receive CWINVOICER_DATA through `open`, so it's blocked either way.
const PACKAGED_APP = [/^open\s.*CW(?:\\ | )Invoicer/, /^\S*.*CW(?:\\ | )Invoicer\.app\/Contents\/MacOS/];

const WRAPPERS = [/^(?:exec|command|builtin|nohup|time|sudo)\s+/, /^env(?:\s+-\S+)*\s+/, /^timeout\s+\S+\s+/];
const ASSIGNMENT = /^([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S*)(?:\s+|$)/;
const hasValue = (v) => v !== '' && v !== '""' && v !== "''";

/** Removes heredoc bodies, which are text rather than commands. */
const stripHeredocs = (cmd) => cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, ' $3');

/** Splits a command line on shell operators outside quotes. */
function splitCommands(cmd) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && quote !== "'") {
      current += c + (cmd[++i] ?? '');
    } else if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if ('&|;\n()`'.includes(c)) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Strips wrappers and leading assignments, returning the command and whether the data folder is set. */
function normalize(segment) {
  let rest = segment;
  let dataSet = false;
  for (let changed = true; changed; ) {
    changed = false;
    for (const wrapper of WRAPPERS) {
      if (wrapper.test(rest)) {
        rest = rest.replace(wrapper, '');
        changed = true;
      }
    }
    const m = ASSIGNMENT.exec(rest);
    if (m) {
      if (m[1] === 'CWINVOICER_DATA' && hasValue(m[2])) dataSet = true;
      rest = rest.slice(m[0].length);
      changed = true;
    }
  }
  return { rest, dataSet };
}

/** The reason to block `command`, or null to allow it. */
function check(command) {
  const segments = splitCommands(stripHeredocs(command));
  let exported = false;
  for (const segment of segments) {
    if (/^(?:export\s+)?CWINVOICER_DATA=/.test(segment)) {
      const m = /CWINVOICER_DATA=("[^"]*"|'[^']*'|\S*)/.exec(segment);
      exported = hasValue(m[1]);
    }
    const { rest, dataSet } = normalize(segment);

    const nested = /^(?:(?:ba|z|da)?sh\s+-\w*c|eval)\s+(["'])([\s\S]*)\1\s*$/.exec(rest);
    if (nested) {
      const reason = check(nested[2]);
      if (reason) return reason;
    }

    // Commit messages may name the folder without touching it.
    if (!/^git(?:\s|$)/.test(rest) && REAL_FOLDER.test(segment)) {
      return 'This command touches the real CW Invoicer data folder (~/Library/Application Support/CW Invoicer).';
    }
    if (PACKAGED_APP.some((p) => p.test(rest))) {
      return `\`${rest}\` opens the packaged app, which uses the real business data.`;
    }
    if (LAUNCHES.some((p) => p.test(rest)) && !dataSet && !exported) {
      return `\`${rest}\` runs against the real business data unless CWINVOICER_DATA is set.`;
    }
  }
  return null;
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  console.error(`guard-real-data: could not read hook input: ${e.message}`);
  process.exit(1);
}

const command = input.tool_input?.command;
const reason = typeof command === 'string' ? check(command) : null;
if (reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${reason} Use \`npm run demo\` for fictional data, or set CWINVOICER_DATA="$(mktemp -d)" for an empty workspace. If real data is really needed, ask the user to run the command themselves.`,
    },
  }));
}
