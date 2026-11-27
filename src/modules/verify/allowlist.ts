import {
  ALLOWED_GIT_SUBCOMMANDS,
  ALLOWED_PYTHON_MODULES,
  ALLOWED_VERIFY_EXECUTABLES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_CONSECUTIVE_BLOCKS,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_CONSECUTIVE_BLOCKS,
  MAX_VERIFY_ARG_LENGTH,
  MAX_VERIFY_ARGS,
  MAX_VERIFY_COMMANDS,
  MIN_COMMAND_TIMEOUT_MS,
  MIN_CONSECUTIVE_BLOCKS,
  type VerifyCommandSpec,
  type VerifyCommandValidationResult,
  type VerifyPolicy,
  type VerifyPolicyPatch,
} from './types.js';

const ALLOWED_GO_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'vet',
  'build',
  'version',
]);

const ALLOWED_CARGO_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'check',
  'clippy',
  'fmt',
  '--version',
  '-V',
]);

const PACKAGE_MANAGER_EXECUTABLES: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
]);

const LINTER_TESTER_EXECUTABLES: ReadonlySet<string> = new Set([
  'tsc',
  'vitest',
  'jest',
  'pytest',
  'ruff',
  'eslint',
]);

const SAFE_SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;

const FORBIDDEN_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  'exec',
  'x',
  'dlx',
  'eval',
]);

const FORBIDDEN_PM_ARG_TOKENS: ReadonlySet<string> = new Set([
  'exec',
  'x',
  'dlx',
  'eval',
  'install',
  'i',
  'add',
  'config',
  'publish',
  'set',
]);

const FORBIDDEN_NODE_LONG_FLAGS: readonly string[] = [
  '--eval',
  '--print',
  '--require',
  '--loader',
  '--experimental-loader',
  '--env-file',
  '--env-file-if-exists',
  '--inspect',
  '--inspect-brk',
  '--inspect-wait',
  '--inspect-port',
  '--debug-port',
  '--interactive',
  '--input-type',
  '--experimental-config-file',
  '--experimental-default-config-file',
  '--openssl-config',
  '--test-global-setup',
];

const ALLOWED_PM_PRE_DASH_FLAGS: ReadonlySet<string> = new Set([
  '--silent',
  '-s',
  '--if-present',
  '--no-color',
  '--color',
  '--quiet',
  '-q',
]);

const FORBIDDEN_PM_LONG_FLAGS: ReadonlySet<string> = new Set([
  '--call',
  '--shell',
  '--script-shell',
  '--onload-script',
  '--preload',
  '--userconfig',
  '--globalconfig',
  '--node-options',
  '--node-gyp',
  '--init-module',
  '--editor',
  '--browser',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
]);

const FORBIDDEN_NODE_SHORT_FLAGS: ReadonlySet<string> = new Set([
  '-e',
  '-p',
  '-c',
  '-r',
  '-i',
]);

const COMMAND_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function clampCommandTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(MIN_COMMAND_TIMEOUT_MS, Math.min(MAX_COMMAND_TIMEOUT_MS, Math.round(raw)));
}

export function clampMaxConsecutiveBlocks(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_MAX_CONSECUTIVE_BLOCKS;
  }
  return Math.max(MIN_CONSECUTIVE_BLOCKS, Math.min(MAX_CONSECUTIVE_BLOCKS, Math.round(raw)));
}

function isForbiddenInterpreterArg(arg: string): boolean {
  const lower = arg.toLowerCase();
  if (
    arg === '-e' ||
    lower === '--eval' ||
    lower.startsWith('--eval=') ||
    arg === '-c' ||
    arg === '-p' ||
    lower === '--print' ||
    lower.startsWith('--print=')
  ) {
    return true;
  }
  // Single-dash short option forms: -e<code>, -c<code>, -p<code>, or bundled short flags like -pe, -uc
  if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
    if (/^-[ecp]/.test(arg)) {
      return true;
    }
    if (/^-[A-Za-z]+$/.test(arg) && /[ecp]/.test(arg.slice(1))) {
      return true;
    }
  }
  return false;
}

function hasAbsolutePathPrefix(value: string, includeTilde = false): boolean {
  if (!value) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
    return true;
  }
  if (includeTilde && value.startsWith('~')) {
    return true;
  }
  return false;
}

function hasParentTraversalSegment(value: string): boolean {
  if (!value) return false;
  return value.split(/[/\\]/).some((seg) => seg === '..');
}

function hasPathTraversalOrAbsolute(arg: string, includeTilde = true): boolean {
  if (hasAbsolutePathPrefix(arg, includeTilde) || hasParentTraversalSegment(arg)) {
    return true;
  }
  const eqIdx = arg.indexOf('=');
  if (eqIdx > 0) {
    const rhs = arg.slice(eqIdx + 1);
    if (hasAbsolutePathPrefix(rhs, includeTilde) || hasParentTraversalSegment(rhs)) {
      return true;
    }
  }
  return false;
}

function validatePackageManagerArgs(id: string, executable: string, args: string[]): string | null {
  if (args.length === 0) {
    return `Command "${id}" ${executable} requires an allowed subcommand (test, run <script>, --version, or -v).`;
  }

  // bun can also execute inline code via interpreter flags; block across all positions
  if (executable === 'bun') {
    for (const arg of args) {
      if (isForbiddenInterpreterArg(arg)) {
        return `Command "${id}" uses forbidden bun inline-execution flag "${arg}".`;
      }
    }
  }

  const sub = args[0];
  let restArgs: string[];

  if (sub === '--version' || sub === '-v') {
    if (args.length !== 1) {
      return `Command "${id}" ${executable} ${sub} does not accept additional arguments.`;
    }
    return null;
  } else if (sub === 'test') {
    restArgs = args.slice(1);
  } else if (sub === 'run') {
    const scriptName = args[1];
    if (!scriptName || !SAFE_SCRIPT_NAME_RE.test(scriptName)) {
      return `Command "${id}" ${executable} run requires a safe script name matching ${SAFE_SCRIPT_NAME_RE.source}.`;
    }
    if (FORBIDDEN_SCRIPT_NAMES.has(scriptName.toLowerCase())) {
      return `Command "${id}" ${executable} run script name "${scriptName}" is forbidden.`;
    }
    restArgs = args.slice(2);
  } else {
    return `Command "${id}" ${executable} subcommand "${sub}" is not allowed (permitted: test, run <script>, --version, -v).`;
  }

  let afterDoubleDash = false;
  for (const arg of restArgs) {
    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    const lower = arg.toLowerCase();
    const eqIdx = arg.indexOf('=');
    const normalizedFlag = (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, '-');
    const rhsLower = eqIdx >= 0 ? lower.slice(eqIdx + 1) : '';

    if (FORBIDDEN_PM_ARG_TOKENS.has(lower)) {
      return `Command "${id}" uses forbidden ${executable} argument "${arg}".`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden ${executable} flag "${arg}".`;
    }
    if (
      lower.includes('data:') ||
      lower.includes('file:') ||
      rhsLower.startsWith('data:') ||
      rhsLower.startsWith('file:')
    ) {
      return `Command "${id}" uses disallowed URL scheme in ${executable} argument "${arg}".`;
    }
    if (
      FORBIDDEN_PM_LONG_FLAGS.has(normalizedFlag) ||
      (executable === 'bun' && arg === '-r')
    ) {
      return `Command "${id}" uses disallowed ${executable} option "${arg}".`;
    }
    if (!afterDoubleDash && arg.startsWith('-') && !ALLOWED_PM_PRE_DASH_FLAGS.has(normalizedFlag)) {
      return `Command "${id}" uses disallowed ${executable} option "${arg}" before "--".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" ${executable} argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  return null;
}

function validateNodeArgs(id: string, args: string[]): string | null {
  if (args.length === 0) {
    return `Command "${id}" node requires explicit arguments (interactive REPL is disallowed).`;
  }
  if (args[0]?.toLowerCase() === 'inspect') {
    return `Command "${id}" node inspect subcommand is disallowed.`;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const lower = arg.toLowerCase();

    if (arg === '-') {
      return `Command "${id}" node stdin execution "-" is disallowed.`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden node inline-execution flag "${arg}".`;
    }

    if (lower === '--import') {
      const nextArg = args[i + 1];
      if (arg !== '--import' || nextArg !== 'tsx') {
        return `Command "${id}" node --import is restricted strictly to "--import tsx" or "--import=tsx".`;
      }
      i += 1;
      continue;
    }
    if (lower.startsWith('--import=')) {
      if (arg !== '--import=tsx') {
        return `Command "${id}" node --import is restricted strictly to "--import tsx" or "--import=tsx".`;
      }
      continue;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      const rawFlag = (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, '-');
      if (FORBIDDEN_NODE_LONG_FLAGS.includes(rawFlag)) {
        return `Command "${id}" uses forbidden node option "${arg}".`;
      }
      if (eqIdx > 0) {
        const rhs = arg.slice(eqIdx + 1);
        const rhsLower = rhs.toLowerCase();
        if (
          rhsLower.startsWith('data:') ||
          rhsLower.startsWith('file:') ||
          hasAbsolutePathPrefix(rhs, true) ||
          hasParentTraversalSegment(rhs)
        ) {
          return `Command "${id}" node option "${arg}" contains a disallowed URL, absolute path, or parent traversal.`;
        }
      }
      continue;
    }

    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      if (arg.length > 2) {
        return `Command "${id}" uses disallowed bundled or compact node short flag "${arg}".`;
      }
      if (FORBIDDEN_NODE_SHORT_FLAGS.has(arg)) {
        return `Command "${id}" uses forbidden node short flag "${arg}".`;
      }
      continue;
    }

    // Non-flag positional argument
    if (
      lower.startsWith('data:') ||
      lower.startsWith('file:') ||
      hasAbsolutePathPrefix(arg, true) ||
      hasParentTraversalSegment(arg)
    ) {
      return `Command "${id}" node positional argument "${arg}" must be a relative path inside the workspace without ".." segments.`;
    }
  }

  return null;
}

function validatePythonArgs(id: string, args: string[], executable = 'python3'): string | null {
  if (args.length === 0) {
    return `Command "${id}" ${executable} requires explicit arguments (--version, -V, or -m <allowed_module>).`;
  }

  const first = args[0];
  if (first === '--version' || first === '-V') {
    if (args.length !== 1) {
      return `Command "${id}" ${executable} ${first} does not accept additional arguments.`;
    }
    return null;
  }

  if (first !== '-m') {
    return `Command "${id}" ${executable} only permits "--version", "-V", or "-m <module>" (disallowed leading arg "${first}").`;
  }

  const modName = args[1];
  if (!modName || !ALLOWED_PYTHON_MODULES.has(modName)) {
    return `Command "${id}" ${executable} module "${modName ?? ''}" is not in the allowlist (${[...ALLOWED_PYTHON_MODULES].join(', ')}).`;
  }

  for (const arg of args.slice(2)) {
    const lower = arg.toLowerCase();
    if (arg === '-' || arg === '-i' || isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden ${executable} argument "${arg}".`;
    }
    if (lower === '--eval' || lower.startsWith('--eval=')) {
      return `Command "${id}" uses forbidden ${executable} option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" ${executable} argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  return null;
}

function validateGoArgs(id: string, args: string[]): string | null {
  const sub = args[0];
  if (!sub || !ALLOWED_GO_SUBCOMMANDS.has(sub)) {
    return `Command "${id}" go subcommand "${sub ?? ''}" is not allowed (permitted: ${[...ALLOWED_GO_SUBCOMMANDS].join(', ')}).`;
  }

  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (
      lower === '-exec' ||
      lower.startsWith('-exec=') ||
      lower === '--exec' ||
      lower.startsWith('--exec=') ||
      lower === '-toolexec' ||
      lower.startsWith('-toolexec=') ||
      lower === '--toolexec' ||
      lower.startsWith('--toolexec=') ||
      lower === '-vettool' ||
      lower.startsWith('-vettool=') ||
      lower === '--vettool' ||
      lower.startsWith('--vettool=')
    ) {
      return `Command "${id}" uses forbidden go option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" go argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  return null;
}

function validateCargoArgs(id: string, args: string[]): string | null {
  const sub = args[0];
  if (!sub || !ALLOWED_CARGO_SUBCOMMANDS.has(sub)) {
    return `Command "${id}" cargo subcommand "${sub ?? ''}" is not allowed (permitted: ${[...ALLOWED_CARGO_SUBCOMMANDS].join(', ')}).`;
  }

  if ((sub === '--version' || sub === '-V') && args.length !== 1) {
    return `Command "${id}" cargo ${sub} does not accept additional arguments.`;
  }

  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (lower === '--config' || lower.startsWith('--config=')) {
      return `Command "${id}" uses forbidden cargo option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" cargo argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  return null;
}

function validateGitArgs(id: string, args: string[]): string | null {
  const subcommand = args[0];
  if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    return `Command "${id}" git subcommand "${subcommand ?? ''}" is not allowed (permitted read-only subcommands: ${[...ALLOWED_GIT_SUBCOMMANDS].join(', ')}).`;
  }

  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (
      lower === '--output' ||
      lower.startsWith('--output=') ||
      lower === '--ext-diff' ||
      lower === '--no-index' ||
      lower === '--textconv' ||
      lower === '--git-dir' ||
      lower.startsWith('--git-dir=') ||
      lower === '--work-tree' ||
      lower.startsWith('--work-tree=')
    ) {
      return `Command "${id}" uses disallowed git option "${arg}".`;
    }
    if (arg.includes('..')) {
      return `Command "${id}" git argument "${arg}" contains forbidden ".." sequence.`;
    }
    if (
      hasAbsolutePathPrefix(arg, true) ||
      arg.includes(':/') ||
      arg.includes(':\\') ||
      /^:\([^)]*\)[/\\~]/.test(arg)
    ) {
      return `Command "${id}" git argument "${arg}" contains a disallowed absolute or home path.`;
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const rhs = arg.slice(eqIdx + 1);
      if (hasAbsolutePathPrefix(rhs, true)) {
        return `Command "${id}" git option "${arg}" contains a disallowed absolute or home path.`;
      }
    }
  }

  return null;
}

function validateLinterOrTesterArgs(
  id: string,
  executable: string,
  args: string[],
): string | null {
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (
      lower === '--eval' ||
      lower.startsWith('--eval=') ||
      arg === '-c' ||
      lower.startsWith('-c=')
    ) {
      return `Command "${id}" uses disallowed ${executable} option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" ${executable} argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}

/**
 * Strictly validate a verification command against the executable allowlist
 * and per-tool argument safety rules (zero shell interpolation, anti-bypass guards).
 */
export function validateVerifyCommand(raw: unknown): VerifyCommandValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Command specification must be an object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !COMMAND_ID_RE.test(obj.id.trim())) {
    return {
      valid: false,
      error: 'Command id must be 1..64 characters of [a-zA-Z0-9._-].',
    };
  }
  const id = obj.id.trim();

  if (typeof obj.label !== 'string' || !obj.label.trim()) {
    return { valid: false, error: `Command "${id}" must have a non-empty label.` };
  }
  const label = obj.label.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 120);

  if (typeof obj.executable !== 'string' || obj.executable.length === 0) {
    return { valid: false, error: `Command "${id}" must specify an executable name.` };
  }
  const executable = obj.executable;
  if (
    executable.includes('/') ||
    executable.includes('\\') ||
    executable.includes('..') ||
    /[\s\x00-\x1f\x7f]/.test(executable)
  ) {
    return {
      valid: false,
      error: `Command "${id}" executable "${executable}" must be a bare command name without paths, whitespace, or control characters.`,
    };
  }
  if (!ALLOWED_VERIFY_EXECUTABLES.has(executable)) {
    return {
      valid: false,
      error: `Command "${id}" executable "${executable}" is not in the verify allowlist.`,
    };
  }

  if (!Array.isArray(obj.args)) {
    return { valid: false, error: `Command "${id}" args must be an array of strings.` };
  }
  if (obj.args.length > MAX_VERIFY_ARGS) {
    return {
      valid: false,
      error: `Command "${id}" exceeds maximum argument count (${MAX_VERIFY_ARGS}).`,
    };
  }

  const args: string[] = [];
  for (let i = 0; i < obj.args.length; i += 1) {
    const arg = obj.args[i];
    if (typeof arg !== 'string') {
      return { valid: false, error: `Command "${id}" arg[${i}] must be a string.` };
    }
    if (arg.length > MAX_VERIFY_ARG_LENGTH) {
      return {
        valid: false,
        error: `Command "${id}" arg[${i}] exceeds maximum length (${MAX_VERIFY_ARG_LENGTH}).`,
      };
    }
    if (arg.includes('\0')) {
      return {
        valid: false,
        error: `Command "${id}" arg[${i}] contains a forbidden NUL byte.`,
      };
    }
    args.push(arg);
  }

  let toolError: string | null = null;
  if (PACKAGE_MANAGER_EXECUTABLES.has(executable)) {
    toolError = validatePackageManagerArgs(id, executable, args);
  } else if (executable === 'node') {
    toolError = validateNodeArgs(id, args);
  } else if (executable === 'python3' || executable === 'python') {
    toolError = validatePythonArgs(id, args, executable);
  } else if (executable === 'go') {
    toolError = validateGoArgs(id, args);
  } else if (executable === 'cargo') {
    toolError = validateCargoArgs(id, args);
  } else if (executable === 'git') {
    toolError = validateGitArgs(id, args);
  } else if (LINTER_TESTER_EXECUTABLES.has(executable)) {
    toolError = validateLinterOrTesterArgs(id, executable, args);
  } else {
    toolError = `Command "${id}" executable "${executable}" has no registered argument validator.`;
  }

  if (toolError) {
    return { valid: false, error: toolError };
  }

  const timeoutMs = clampCommandTimeout(obj.timeoutMs);
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;

  return {
    valid: true,
    command: {
      id,
      label,
      executable,
      args,
      timeoutMs,
      enabled,
    },
  };
}

export function validateAndBuildPolicy(
  current: VerifyPolicy,
  patch: VerifyPolicyPatch,
): { valid: true; policy: VerifyPolicy } | { valid: false; error: string } {
  let nextCommands = current.commands.map((c) => ({ ...c, args: [...c.args] }));

  if (patch.commands !== undefined) {
    if (!Array.isArray(patch.commands)) {
      return { valid: false, error: 'Policy commands must be an array.' };
    }
    if (patch.commands.length > MAX_VERIFY_COMMANDS) {
      return {
        valid: false,
        error: `Policy exceeds maximum command count (${MAX_VERIFY_COMMANDS}).`,
      };
    }
    const seenIds = new Set<string>();
    const validated: VerifyCommandSpec[] = [];
    for (const rawCmd of patch.commands) {
      const check = validateVerifyCommand(rawCmd);
      if (!check.valid || !check.command) {
        return { valid: false, error: check.error ?? 'Invalid verify command.' };
      }
      if (seenIds.has(check.command.id)) {
        return { valid: false, error: `Duplicate verify command id: "${check.command.id}".` };
      }
      seenIds.add(check.command.id);
      validated.push(check.command);
    }
    nextCommands = validated;
  }

  return {
    valid: true,
    policy: {
      enforceOnStop:
        typeof patch.enforceOnStop === 'boolean' ? patch.enforceOnStop : current.enforceOnStop,
      autoRunOnStop:
        typeof patch.autoRunOnStop === 'boolean' ? patch.autoRunOnStop : current.autoRunOnStop,
      blockEmptyWrites:
        typeof patch.blockEmptyWrites === 'boolean'
          ? patch.blockEmptyWrites
          : current.blockEmptyWrites,
      maxConsecutiveBlocks:
        patch.maxConsecutiveBlocks !== undefined
          ? clampMaxConsecutiveBlocks(patch.maxConsecutiveBlocks)
          : current.maxConsecutiveBlocks,
      commands: nextCommands,
    },
  };
}
