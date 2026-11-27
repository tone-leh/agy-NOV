import fs from 'node:fs';
import path from 'node:path';
import {
  isModuleId,
  isPresetId,
  type ModuleId,
  type PresetId,
} from './catalog.js';

export const TEAM_CONFIG_FILENAME = '.agy-nov.json';
export const MAX_TEAM_CONFIG_BYTES = 64 * 1024; // 64 KiB hard cap
export const MAX_TEAM_VERIFY_COMMANDS = 20;
export const MAX_TEAM_VERIFY_ARGS = 24;
export const MAX_TEAM_VERIFY_ARG_LENGTH = 256;
export const MAX_TEAM_SPEC_TEMPLATES = 10;

/**
 * Pure static allowlist of verification executables (arbitrary script runners like
 * make/tsx/shells are intentionally excluded). Every executable is paired with a
 * strict per-tool subcommand & argument validator below.
 */
export const TEAM_VERIFY_ALLOWED_EXECUTABLES: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'tsc',
  'vitest',
  'jest',
  'eslint',
  'prettier',
  'biome',
  'pytest',
  'ruff',
  'mypy',
  'python',
  'python3',
  'go',
  'cargo',
  'rustc',
  'gradle',
  'mvn',
  'dotnet',
  'git',
]);

const FORBIDDEN_SHELL_EXECUTABLES: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  'ash',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'wsl',
  'wsl.exe',
]);

const PROTO_POLLUTION_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'preset',
  'enableModules',
  'verifyCommands',
  'specTemplates',
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
  'eslint',
  'prettier',
  'biome',
  'pytest',
  'ruff',
  'mypy',
]);

const SAFE_SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;

const FORBIDDEN_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  'exec',
  'x',
  'dlx',
  'eval',
  'init',
  'create',
  'explore',
]);

const FORBIDDEN_PM_ARG_TOKENS: ReadonlySet<string> = new Set([
  'exec',
  'x',
  'dlx',
  'eval',
  'init',
  'create',
  'explore',
  'install',
  'i',
  'add',
  'config',
  'publish',
  'set',
  'login',
  'adduser',
  'link',
]);

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
  '--eval',
  '--print',
]);

const ALLOWED_PYTHON_MODULES: ReadonlySet<string> = new Set([
  'pytest',
  'unittest',
  'mypy',
  'ruff',
  'compileall',
  'py_compile',
]);

const ALLOWED_GO_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'vet',
  'build',
  'version',
]);

const FORBIDDEN_GO_FLAGS: ReadonlySet<string> = new Set([
  'exec',
  'toolexec',
  'vettool',
  'overlay',
  'modfile',
  'ldflags',
  'gcflags',
  'asmflags',
  'gccgoflags',
  'pkgdir',
  'o',
  'c',
]);

const ALLOWED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'diff',
  'rev-parse',
  'check-ignore',
]);

const FORBIDDEN_GIT_FLAGS: ReadonlySet<string> = new Set([
  '-c',
  '--config',
  '--config-env',
  '--output',
  '--ext-diff',
  '--no-index',
  '--textconv',
  '--git-dir',
  '--work-tree',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--exec-path',
  '--extcmd',
  '--pager',
  '--tool',
]);

const ALLOWED_CARGO_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'check',
  'clippy',
  'fmt',
  '--version',
  '-V',
]);

const FORBIDDEN_NODE_LONG_FLAGS: ReadonlySet<string> = new Set([
  '--eval',
  '--print',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--preload',
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
  '--test-reporter',
  '--test-reporter-destination',
  '--node-options',
  '--conditions',
  '--redirect-warnings',
  '--diagnostic-dir',
  '--cpu-prof',
  '--heap-prof',
]);

const FORBIDDEN_NODE_SHORT_FLAGS: ReadonlySet<string> = new Set([
  '-e',
  '-p',
  '-c',
  '-r',
  '-i',
  '-C',
]);

const ALLOWED_NODE_TEST_FLAGS: ReadonlySet<string> = new Set([
  '--test',
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-concurrency',
  '--test-only',
  '--test-timeout',
  '--test-force-exit',
  '--test-shard',
  '--experimental-test-coverage',
]);

function normalizeCanonicalFlag(arg: string): string {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf('=');
  const flag = eqIdx >= 0 ? lower.slice(0, eqIdx) : lower;
  if (flag.startsWith('--')) {
    return `--${flag.slice(2).replace(/[-_]/g, '')}`;
  }
  return flag.replace(/_/g, '-');
}

const FORBIDDEN_LINTER_COMMON_FLAGS: ReadonlySet<string> = new Set(
  [
    '--eval',
    '--config',
    '--config-file',
    '--config-path',
    '--plugin',
    '--plugins',
    '--plugin-search-dir',
    '--require',
    '--import',
    '--loader',
    '--experimental-loader',
    '--preload',
    '--node-options',
    '--exec',
    '--shell',
    '--script-shell',
    '--output',
    '--output-file',
    '--output-dir',
    '--out-file',
    '--out-dir',
    '--ts-build-info-file',
    '--declaration-dir',
    '--rulesdir',
    '--resolve-plugins-relative-to',
    '--parser',
    '--formatter',
    '--format',
    '--setup-files',
    '--setup-files-after-env',
    '--global-setup',
    '--global-teardown',
    '--reporter',
    '--reporters',
    '--runner',
    '--test-runner',
    '--test-environment',
    '--test-sequencer',
    '--snapshot-resolver',
    '--dependency-extractor',
    '--module-name-mapper',
    '--watch-plugins',
    '--haste',
    '--transform',
    '--resolver',
    '--preset',
    '--environment',
    '--projects',
    '--workspace',
    '--override-ini',
    '--confcutdir',
    '--rootdir',
    '--basetemp',
    '--python-executable',
    '--custom-typeshed-dir',
    '--cache-dir',
    '--cache-directory',
    '--coverage-directory',
    '--artifacts-path',
    '--write',
  ].map(normalizeCanonicalFlag),
);

const FORBIDDEN_BUILD_TOOL_CANONICAL_FLAGS: ReadonlySet<string> = new Set(
  [
    '--init-script',
    '--build-file',
    '--settings-file',
    '--settings',
    '--global-settings',
    '--file',
    '--property',
    '--logger',
    '--gradle-user-home',
    '--project-dir',
    '--artifacts-path',
    '--output',
    '--output-dir',
    '--results-directory',
  ].map(normalizeCanonicalFlag),
);

const ALLOWED_GRADLE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'check',
  '--version',
  '-v',
]);

const ALLOWED_MVN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'verify',
  'validate',
  '--version',
  '-v',
]);

const ALLOWED_DOTNET_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test',
  'build',
  '--version',
]);

const SHELL_METACHAR_RE = /(?:`|&&|\|\||[;|\r\n\0]|\$\(|\$\{)/;
const SECRET_LIKE_VALUE_RE =
  /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/;

export interface TeamVerifyCommand {
  label: string;
  executable: string;
  args: string[];
}

export interface TeamSpecTemplate {
  name: string;
  goal?: string;
  tasks?: string[];
}

export interface TeamPresetAuditResult {
  found: boolean;
  filePath: string;
  valid: boolean;
  preset?: PresetId;
  enableModules: ModuleId[];
  verifyCommands: TeamVerifyCommand[];
  specTemplatesCount: number;
  warnings: string[];
  errors: string[];
}

function emptyNotFoundResult(): TeamPresetAuditResult {
  return {
    found: false,
    filePath: TEAM_CONFIG_FILENAME,
    valid: true,
    enableModules: [],
    verifyCommands: [],
    specTemplatesCount: 0,
    warnings: [],
    errors: [],
  };
}

function sanitizeLabel(raw: string): string {
  const trimmed = raw.replace(/[\r\n\0\t]+/g, ' ').trim();
  if (!trimmed) return 'unnamed';
  if (SECRET_LIKE_VALUE_RE.test(trimmed)) return '<redacted>';
  return trimmed.slice(0, 80);
}

function sanitizeArgForWarning(raw: string): string {
  const cleaned = raw.replace(/[\r\n\0]+/g, ' ').trim();
  if (!cleaned) return '<empty>';
  if (SECRET_LIKE_VALUE_RE.test(cleaned)) return '<redacted>';
  return cleaned.slice(0, 48);
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasAbsolutePathPrefix(value: string): boolean {
  if (!value) return false;
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('~') ||
    /^[A-Za-z]:/.test(value)
  );
}

function hasParentTraversalSegment(value: string): boolean {
  if (!value) return false;
  return value.split(/[/\\]/).some((seg) => seg === '..');
}

function hasAbsoluteOrTraversalPath(value: string): boolean {
  if (!value) return false;
  if (hasAbsolutePathPrefix(value) || hasParentTraversalSegment(value)) {
    return true;
  }
  const eqIdx = value.indexOf('=');
  if (eqIdx > 0) {
    const rhs = value.slice(eqIdx + 1);
    if (hasAbsolutePathPrefix(rhs) || hasParentTraversalSegment(rhs)) {
      return true;
    }
  }
  return false;
}

function hasDisallowedUrlScheme(arg: string): boolean {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf('=');
  const rhs = eqIdx >= 0 ? lower.slice(eqIdx + 1) : '';
  return (
    lower.startsWith('data:') ||
    lower.startsWith('file:') ||
    lower.includes('data:') ||
    lower.includes('file:') ||
    rhs.startsWith('data:') ||
    rhs.startsWith('file:')
  );
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
  if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
    if (/^-[ecp]/.test(arg)) return true;
    if (/^-[A-Za-z]+$/.test(arg) && /[ecp]/.test(arg.slice(1))) return true;
  }
  return false;
}

function normalizeLongFlag(arg: string): string {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf('=');
  return (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, '-');
}

function validatePackageManagerArgs(label: string, executable: string, args: string[]): string | null {
  if (args.length === 0) {
    return `${executable} requires an allowed subcommand (test, run <script>, --version, or -v).`;
  }

  if (executable === 'bun') {
    for (const arg of args) {
      if (isForbiddenInterpreterArg(arg)) {
        return `forbidden bun inline-execution flag "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }

  const sub = args[0];
  let restArgs: string[];

  if (sub === '--version' || sub === '-v') {
    if (args.length !== 1) {
      return `${executable} ${sub} does not accept additional arguments.`;
    }
    return null;
  } else if (sub === 'test') {
    restArgs = args.slice(1);
  } else if (sub === 'run') {
    const scriptName = args[1];
    if (!scriptName || !SAFE_SCRIPT_NAME_RE.test(scriptName)) {
      return `${executable} run requires a safe script name matching ${SAFE_SCRIPT_NAME_RE.source}.`;
    }
    if (FORBIDDEN_SCRIPT_NAMES.has(scriptName.toLowerCase())) {
      return `${executable} run script name "${sanitizeArgForWarning(scriptName)}" is forbidden.`;
    }
    restArgs = args.slice(2);
  } else {
    return `${executable} subcommand "${sanitizeArgForWarning(sub)}" is not allowed (permitted: test, run <script>, --version, -v).`;
  }

  let afterDoubleDash = false;
  for (const arg of restArgs) {
    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    const lower = arg.toLowerCase();
    const normalizedFlag = normalizeLongFlag(arg);

    if (FORBIDDEN_PM_ARG_TOKENS.has(lower)) {
      return `forbidden ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `forbidden ${executable} flag "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (
      FORBIDDEN_PM_LONG_FLAGS.has(normalizedFlag) ||
      (executable === 'bun' && (arg === '-r' || arg.startsWith('-r')))
    ) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
    if (!afterDoubleDash && arg.startsWith('-') && !ALLOWED_PM_PRE_DASH_FLAGS.has(normalizedFlag)) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}" before "--".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  void label;
  return null;
}

function validateNodeArgs(args: string[]): string | null {
  if (args.length === 0) {
    return 'node requires explicit arguments (--version, -v, --check <file>, or --test [files]).';
  }

  const first = args[0];
  if (first === '--version' || first === '-v') {
    if (args.length !== 1) {
      return `node ${first} does not accept additional arguments.`;
    }
    return null;
  }

  if (first !== '--check' && first !== '--test') {
    return `node only permits "--version", "-v", "--check", or "--test" (disallowed leading arg "${sanitizeArgForWarning(first)}").`;
  }

  if (first === '--check' && args.length < 2) {
    return 'node --check requires at least one relative file path.';
  }

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const lower = arg.toLowerCase();
    const normalizedFlag = normalizeLongFlag(arg);

    if (arg === '-' || lower === 'inspect') {
      return `node argument "${sanitizeArgForWarning(arg)}" is disallowed.`;
    }
    if (isForbiddenInterpreterArg(arg) || hasDisallowedUrlScheme(arg)) {
      return `forbidden node argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `node argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (arg.startsWith('--')) {
      if (FORBIDDEN_NODE_LONG_FLAGS.has(normalizedFlag)) {
        return `forbidden node option "${sanitizeArgForWarning(arg)}".`;
      }
      if (first === '--test') {
        if (!ALLOWED_NODE_TEST_FLAGS.has(normalizedFlag)) {
          return `disallowed node --test option "${sanitizeArgForWarning(arg)}".`;
        }
        continue;
      }
      return `disallowed node --check option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (arg.length > 2 || FORBIDDEN_NODE_SHORT_FLAGS.has(arg)) {
        return `forbidden node short flag "${sanitizeArgForWarning(arg)}".`;
      }
      return `disallowed node short flag "${sanitizeArgForWarning(arg)}".`;
    }
  }

  return null;
}

function validatePythonArgs(executable: string, args: string[]): string | null {
  if (args.length === 0) {
    return `${executable} requires explicit arguments (--version, -V, or -m <allowed_module>).`;
  }

  const first = args[0];
  if (first === '--version' || first === '-V') {
    if (args.length !== 1) {
      return `${executable} ${first} does not accept additional arguments.`;
    }
    return null;
  }

  if (first !== '-m') {
    return `${executable} only permits "--version", "-V", or "-m <allowed_module>" (disallowed leading arg "${sanitizeArgForWarning(first)}").`;
  }

  const modName = args[1];
  if (!modName || !ALLOWED_PYTHON_MODULES.has(modName)) {
    return `${executable} module "${sanitizeArgForWarning(modName ?? '')}" is not in the safe allowlist (${[...ALLOWED_PYTHON_MODULES].join(', ')}).`;
  }

  const modArgs = args.slice(2);
  for (const arg of modArgs) {
    if (arg === '-' || arg === '-i' || isForbiddenInterpreterArg(arg) || hasDisallowedUrlScheme(arg)) {
      return `forbidden ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  if (modName === 'pytest' || modName === 'ruff' || modName === 'mypy') {
    return validateLinterOrTesterArgs(modName, modArgs);
  }
  return null;
}

function validateGoArgs(args: string[]): string | null {
  const sub = args[0];
  if (!sub || !ALLOWED_GO_SUBCOMMANDS.has(sub)) {
    return `go subcommand "${sanitizeArgForWarning(sub ?? '')}" is not allowed (permitted: ${[...ALLOWED_GO_SUBCOMMANDS].join(', ')}).`;
  }

  if (sub === 'version') {
    if (args.length !== 1) {
      return 'go version does not accept additional arguments.';
    }
    return null;
  }

  for (const arg of args.slice(1)) {
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in go argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `go argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (arg.startsWith('-')) {
      const stripped = arg.replace(/^--?/, '');
      const eqIdx = stripped.indexOf('=');
      const flagName = (eqIdx >= 0 ? stripped.slice(0, eqIdx) : stripped).toLowerCase();
      if (FORBIDDEN_GO_FLAGS.has(flagName)) {
        return `forbidden go option "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }

  return null;
}

function validateCargoArgs(args: string[]): string | null {
  const sub = args[0];
  if (!sub || !ALLOWED_CARGO_SUBCOMMANDS.has(sub)) {
    return `cargo subcommand "${sanitizeArgForWarning(sub ?? '')}" is not allowed (permitted: ${[...ALLOWED_CARGO_SUBCOMMANDS].join(', ')}).`;
  }

  if ((sub === '--version' || sub === '-V') && args.length !== 1) {
    return `cargo ${sub} does not accept additional arguments.`;
  }

  for (const arg of args.slice(1)) {
    const normalizedFlag = normalizeLongFlag(arg);
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in cargo argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (
      normalizedFlag === '--config' ||
      arg === '-Z' ||
      arg.startsWith('-Z') ||
      normalizedFlag === '--unstable-features'
    ) {
      return `forbidden cargo option "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `cargo argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }

  return null;
}

function validateRustcArgs(args: string[]): string | null {
  if (args.length !== 1 || (args[0] !== '--version' && args[0] !== '-V')) {
    return 'rustc in team presets only permits "--version" or "-V" (use cargo check/test for compilation).';
  }
  return null;
}

function validateGitArgs(args: string[]): string | null {
  const sub = args[0];
  if (!sub || !ALLOWED_GIT_SUBCOMMANDS.has(sub)) {
    return `git subcommand "${sanitizeArgForWarning(sub ?? '')}" is not allowed (permitted read-only subcommands: ${[...ALLOWED_GIT_SUBCOMMANDS].join(', ')}).`;
  }

  for (const arg of args.slice(1)) {
    const normalizedFlag = normalizeLongFlag(arg);
    if (
      FORBIDDEN_GIT_FLAGS.has(normalizedFlag) ||
      arg.startsWith('-c') ||
      arg === '-x' ||
      arg === '-t' ||
      arg.startsWith('-t')
    ) {
      return `disallowed git option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.includes('..')) {
      return `git argument "${sanitizeArgForWarning(arg)}" contains forbidden ".." sequence.`;
    }
    if (
      hasAbsolutePathPrefix(arg) ||
      arg.includes(':/') ||
      arg.includes(':\\') ||
      /^:\([^)]*\)[/\\~]/.test(arg)
    ) {
      return `git argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or home path.`;
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0 && hasAbsolutePathPrefix(arg.slice(eqIdx + 1))) {
      return `git option "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or home path.`;
    }
  }

  return null;
}

function validateLinterOrTesterArgs(executable: string, args: string[]): string | null {
  for (const arg of args) {
    const canonicalFlag = normalizeCanonicalFlag(arg);
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (FORBIDDEN_LINTER_COMMON_FLAGS.has(canonicalFlag)) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      if (
        arg === '-c' ||
        arg.startsWith('-c') ||
        arg === '-e' ||
        arg.startsWith('-e') ||
        arg === '-r' ||
        arg.startsWith('-r') ||
        arg === '-o' ||
        arg.startsWith('-o')
      ) {
        return `disallowed ${executable} short option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === 'eslint' && (arg === '-f' || arg.startsWith('-f'))) {
        return `disallowed eslint formatter option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === 'pytest' && (arg === '-p' || arg.startsWith('-p'))) {
        return `disallowed pytest plugin option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === 'prettier' && (arg === '-w' || arg.startsWith('-w'))) {
        return `disallowed prettier write option "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }
  return null;
}

function validateBuildToolArgs(executable: 'gradle' | 'mvn' | 'dotnet', args: string[]): string | null {
  const sub = args[0];
  const allowed =
    executable === 'gradle'
      ? ALLOWED_GRADLE_SUBCOMMANDS
      : executable === 'mvn'
        ? ALLOWED_MVN_SUBCOMMANDS
        : ALLOWED_DOTNET_SUBCOMMANDS;

  if (!sub || !allowed.has(sub)) {
    return `${executable} subcommand "${sanitizeArgForWarning(sub ?? '')}" is not allowed (permitted: ${[...allowed].join(', ')}).`;
  }
  if ((sub === '--version' || sub === '-v') && args.length !== 1) {
    return `${executable} ${sub} does not accept additional arguments.`;
  }

  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    const canonicalFlag = normalizeCanonicalFlag(arg);
    if (hasDisallowedUrlScheme(arg) || hasAbsoluteOrTraversalPath(arg)) {
      return `disallowed ${executable} path/URL argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (
      arg.includes('=') ||
      arg.startsWith('-D') ||
      arg.startsWith('-P') ||
      arg.startsWith('-I') ||
      arg.startsWith('-p:') ||
      arg.startsWith('/p:') ||
      arg.startsWith('-l:') ||
      FORBIDDEN_BUILD_TOOL_CANONICAL_FLAGS.has(canonicalFlag) ||
      lower === '-f' ||
      lower === '-b' ||
      lower === '-c' ||
      lower === '-s' ||
      lower === '-gs' ||
      lower === '-g' ||
      lower === '-p' ||
      lower === '-o' ||
      lower.startsWith('-o')
    ) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
  }

  return null;
}

function validateTeamVerifyCommand(
  rawEntry: unknown,
  index: number,
): { ok: true; command: TeamVerifyCommand } | { ok: false; warning: string } {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return {
      ok: false,
      warning: `Rejected verifyCommands[${index}]: entry must be a JSON object.`,
    };
  }

  const obj = rawEntry as Record<string, unknown>;
  const rawLabel = typeof obj.label === 'string' ? obj.label : '';
  const label = sanitizeLabel(rawLabel);
  if (!rawLabel.trim()) {
    return {
      ok: false,
      warning: `Rejected verifyCommands[${index}]: missing non-empty "label".`,
    };
  }

  const rawExec = typeof obj.executable === 'string' ? obj.executable.trim() : '';
  if (!rawExec) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": missing non-empty "executable".`,
    };
  }
  if (
    rawExec.includes('/') ||
    rawExec.includes('\\') ||
    rawExec.includes('..') ||
    /\s/.test(rawExec) ||
    hasControlChars(rawExec)
  ) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": executable must be a bare command name without path separators or whitespace.`,
    };
  }

  const execLower = rawExec.toLowerCase();
  if (FORBIDDEN_SHELL_EXECUTABLES.has(execLower)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": shell interpreter "${execLower}" is forbidden.`,
    };
  }

  if (!TEAM_VERIFY_ALLOWED_EXECUTABLES.has(execLower)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": executable "${sanitizeArgForWarning(rawExec)}" is not in the safe allowlist.`,
    };
  }

  if (!Array.isArray(obj.args)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": "args" must be an array of strings.`,
    };
  }
  if (obj.args.length > MAX_TEAM_VERIFY_ARGS) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": exceeds max ${MAX_TEAM_VERIFY_ARGS} arguments.`,
    };
  }

  const args: string[] = [];
  for (let i = 0; i < obj.args.length; i += 1) {
    const rawArg = obj.args[i];
    if (typeof rawArg !== 'string') {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] must be a string.`,
      };
    }
    if (rawArg.length === 0 || rawArg.length > MAX_TEAM_VERIFY_ARG_LENGTH) {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] is empty or exceeds ${MAX_TEAM_VERIFY_ARG_LENGTH} chars.`,
      };
    }
    if (hasControlChars(rawArg) || SHELL_METACHAR_RE.test(rawArg)) {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] contains forbidden shell metacharacters or control bytes.`,
      };
    }
    args.push(rawArg);
  }

  let toolError: string | null = null;
  if (PACKAGE_MANAGER_EXECUTABLES.has(execLower)) {
    toolError = validatePackageManagerArgs(label, execLower, args);
  } else if (execLower === 'node') {
    toolError = validateNodeArgs(args);
  } else if (execLower === 'python' || execLower === 'python3') {
    toolError = validatePythonArgs(execLower, args);
  } else if (execLower === 'go') {
    toolError = validateGoArgs(args);
  } else if (execLower === 'cargo') {
    toolError = validateCargoArgs(args);
  } else if (execLower === 'rustc') {
    toolError = validateRustcArgs(args);
  } else if (execLower === 'git') {
    toolError = validateGitArgs(args);
  } else if (execLower === 'gradle' || execLower === 'mvn' || execLower === 'dotnet') {
    toolError = validateBuildToolArgs(execLower, args);
  } else if (LINTER_TESTER_EXECUTABLES.has(execLower)) {
    toolError = validateLinterOrTesterArgs(execLower, args);
  } else {
    toolError = `executable "${execLower}" has no registered argument validator.`;
  }

  if (toolError) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": ${toolError}`,
    };
  }

  return {
    ok: true,
    command: {
      label,
      executable: execLower,
      args,
    },
  };
}

function parseJsonSafelyWithoutProtoPollution(rawText: string): {
  parsed: unknown;
  protoKeysDetected: string[];
} {
  const protoKeys = new Set<string>();
  const parsed = JSON.parse(rawText, (key, value) => {
    if (key && PROTO_POLLUTION_KEYS.has(key)) {
      protoKeys.add(key);
      return undefined;
    }
    return value;
  });

  const stripNested = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(stripNested);
    }
    if (node && typeof node === 'object') {
      const clean = Object.create(null) as Record<string, unknown>;
      for (const k of Object.getOwnPropertyNames(node)) {
        if (PROTO_POLLUTION_KEYS.has(k)) {
          protoKeys.add(k);
          continue;
        }
        clean[k] = stripNested((node as Record<string, unknown>)[k]);
      }
      return clean;
    }
    return node;
  };

  return {
    parsed: stripNested(parsed),
    protoKeysDetected: Array.from(protoKeys),
  };
}

const SENSITIVE_TARGET_SEG_RE =
  /^(?:\.env(?:\.|$)|\.ssh$|\.aws$|\.gnupg$|\.kube$|credentials|.*secret.*)/i;

const SENSITIVE_TARGET_BASENAMES: ReadonlySet<string> = new Set([
  'auth.json',
  'oauth.json',
  'token.json',
  'tokens.json',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'master.key',
]);

const SENSITIVE_TARGET_EXTS: ReadonlySet<string> = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
]);

function isSensitiveRelativeTarget(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').trim();
  if (!normalized) return false;
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    if (SENSITIVE_TARGET_SEG_RE.test(seg)) return true;
  }
  const base = segments[segments.length - 1]?.toLowerCase() ?? '';
  if (SENSITIVE_TARGET_BASENAMES.has(base)) return true;
  if (
    base.startsWith('id_rsa.') ||
    base.startsWith('id_ed25519.') ||
    base.startsWith('id_ecdsa.') ||
    base.startsWith('id_dsa.')
  ) {
    return true;
  }
  return SENSITIVE_TARGET_EXTS.has(path.posix.extname(base));
}

/**
 * Strictly read-only loader & static security auditor for optional workspace `.agy-nov.json`.
 * Never creates files or directories, enforces realpath workspace containment, 64 KiB cap,
 * prototype-pollution key rejection, opt-in `remote`/`full` downgrade, and strict per-tool
 * static verifyCommand allowlisting (never executes any command).
 */
export function loadTeamPresetReadOnly(workspaceRoot: string): TeamPresetAuditResult {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    return emptyNotFoundResult();
  }

  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  const candidatePath = path.join(realRoot, TEAM_CONFIG_FILENAME);

  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(candidatePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return emptyNotFoundResult();
    }
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Unable to inspect ${TEAM_CONFIG_FILENAME}: ${code ?? 'read error'}`],
    };
  }

  let realFile: string;
  try {
    realFile = fs.realpathSync(candidatePath);
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [
        `Refused to read ${TEAM_CONFIG_FILENAME}: unable to resolve real path (broken symlink or inaccessible target).`,
      ],
    };
  }

  if (realFile !== realRoot && !realFile.startsWith(rootPrefix)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Refused to read ${TEAM_CONFIG_FILENAME}: symlink escapes workspace boundary.`],
    };
  }

  const realRel = path.relative(realRoot, realFile).replace(/\\/g, '/');
  if (lstat.isSymbolicLink() && isSensitiveRelativeTarget(realRel)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Refused to read ${TEAM_CONFIG_FILENAME}: symlink targets a sensitive file.`],
    };
  }

  let stat: fs.Stats;
  try {
    stat = lstat.isSymbolicLink() ? fs.statSync(realFile) : lstat;
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Unable to stat ${TEAM_CONFIG_FILENAME}.`],
    };
  }

  if (!stat.isFile()) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`${TEAM_CONFIG_FILENAME} must be a regular file.`],
    };
  }

  if (stat.size > MAX_TEAM_CONFIG_BYTES) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [
        `${TEAM_CONFIG_FILENAME} exceeds maximum allowed size (${stat.size} bytes > ${MAX_TEAM_CONFIG_BYTES} bytes / 64 KiB).`,
      ],
    };
  }

  let rawText: string;
  try {
    rawText = fs.readFileSync(realFile, 'utf8');
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Failed to read ${TEAM_CONFIG_FILENAME}.`],
    };
  }

  let parsedUnknown: unknown;
  let protoKeysDetected: string[] = [];
  try {
    const res = parseJsonSafelyWithoutProtoPollution(rawText);
    parsedUnknown = res.parsed;
    protoKeysDetected = res.protoKeysDetected;
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Invalid JSON syntax in ${TEAM_CONFIG_FILENAME}.`],
    };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`${TEAM_CONFIG_FILENAME} root must be a JSON object.`],
    };
  }

  const rootObj = parsedUnknown as Record<string, unknown>;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (protoKeysDetected.length > 0) {
    warnings.push(
      `Ignored dangerous prototype-pollution key(s) in ${TEAM_CONFIG_FILENAME}: ${protoKeysDetected.join(', ')}.`,
    );
  }

  for (const key of Object.keys(rootObj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(
        `Ignored unrecognized top-level field "${sanitizeArgForWarning(key)}" in ${TEAM_CONFIG_FILENAME}.`,
      );
    }
  }

  // 1. schemaVersion?: 1
  if (rootObj.schemaVersion !== undefined && rootObj.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion in ${TEAM_CONFIG_FILENAME}: expected 1.`);
  }

  // 2. preset?: PresetId ("full" is immediately downgraded to offline "local-all" at loader level)
  let preset: PresetId | undefined;
  if (rootObj.preset !== undefined) {
    if (isPresetId(rootObj.preset)) {
      if (rootObj.preset === 'full') {
        preset = 'local-all';
        warnings.push(
          'Preset "full" includes opt-in network module "remote"; downgraded to offline "local-all" because "remote" must be enabled manually by each developer.',
        );
      } else {
        preset = rootObj.preset;
      }
    } else {
      errors.push(
        `Invalid preset "${sanitizeArgForWarning(String(rootObj.preset))}" in ${TEAM_CONFIG_FILENAME}.`,
      );
    }
  }

  // 3. enableModules?: ModuleId[]
  const enableModules: ModuleId[] = [];
  const seenModules = new Set<ModuleId>();
  if (rootObj.enableModules !== undefined) {
    if (!Array.isArray(rootObj.enableModules)) {
      errors.push(`Field "enableModules" in ${TEAM_CONFIG_FILENAME} must be an array of module IDs.`);
    } else {
      let strippedRemote = false;
      for (const item of rootObj.enableModules) {
        if (!isModuleId(item)) {
          warnings.push(
            `Ignored unknown module ID "${sanitizeArgForWarning(String(item))}" in enableModules.`,
          );
          continue;
        }
        if (item === 'remote') {
          if (!strippedRemote) {
            strippedRemote = true;
            warnings.push(
              'Stripped "remote" from enableModules: opt-in network module must be enabled manually by each user.',
            );
          }
          continue;
        }
        if (!seenModules.has(item)) {
          seenModules.add(item);
          enableModules.push(item);
        }
      }
    }
  }

  // 4. verifyCommands?: Array<{ label: string; executable: string; args: string[] }> (static inspection ONLY)
  const verifyCommands: TeamVerifyCommand[] = [];
  if (rootObj.verifyCommands !== undefined) {
    if (!Array.isArray(rootObj.verifyCommands)) {
      errors.push(`Field "verifyCommands" in ${TEAM_CONFIG_FILENAME} must be an array.`);
    } else {
      const capped = rootObj.verifyCommands.slice(0, MAX_TEAM_VERIFY_COMMANDS);
      if (rootObj.verifyCommands.length > MAX_TEAM_VERIFY_COMMANDS) {
        warnings.push(
          `Truncated verifyCommands to ${MAX_TEAM_VERIFY_COMMANDS} entries (received ${rootObj.verifyCommands.length}).`,
        );
      }
      for (let i = 0; i < capped.length; i += 1) {
        const checked = validateTeamVerifyCommand(capped[i], i);
        if (checked.ok) {
          verifyCommands.push(checked.command);
        } else {
          warnings.push(checked.warning);
        }
      }
    }
  }

  // 5. specTemplates?: Array<{ name: string; goal?: string; tasks?: string[] }> (max 10, clamped lengths)
  const specTemplates: TeamSpecTemplate[] = [];
  if (rootObj.specTemplates !== undefined) {
    if (!Array.isArray(rootObj.specTemplates)) {
      warnings.push(`Ignored non-array "specTemplates" field in ${TEAM_CONFIG_FILENAME}.`);
    } else {
      if (rootObj.specTemplates.length > MAX_TEAM_SPEC_TEMPLATES) {
        warnings.push(
          `Truncated specTemplates to ${MAX_TEAM_SPEC_TEMPLATES} entries (received ${rootObj.specTemplates.length}).`,
        );
      }
      for (const rawTpl of rootObj.specTemplates.slice(0, MAX_TEAM_SPEC_TEMPLATES)) {
        if (!rawTpl || typeof rawTpl !== 'object' || Array.isArray(rawTpl)) {
          warnings.push('Ignored malformed entry in specTemplates (expected object with "name").');
          continue;
        }
        const tplObj = rawTpl as Record<string, unknown>;
        const name = typeof tplObj.name === 'string' ? tplObj.name.trim().slice(0, 100) : '';
        if (!name) {
          warnings.push('Ignored specTemplates entry missing non-empty "name".');
          continue;
        }
        const goal =
          typeof tplObj.goal === 'string' && tplObj.goal.trim()
            ? tplObj.goal.trim().slice(0, 400)
            : undefined;
        const tasks = Array.isArray(tplObj.tasks)
          ? tplObj.tasks
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .slice(0, 20)
              .map((t) => t.trim().slice(0, 160))
          : undefined;
        specTemplates.push({
          name,
          ...(goal ? { goal } : {}),
          ...(tasks && tasks.length > 0 ? { tasks } : {}),
        });
      }
    }
  }

  return {
    found: true,
    filePath: TEAM_CONFIG_FILENAME,
    valid: errors.length === 0,
    ...(preset ? { preset } : {}),
    enableModules,
    verifyCommands,
    specTemplatesCount: specTemplates.length,
    warnings,
    errors,
  };
}
