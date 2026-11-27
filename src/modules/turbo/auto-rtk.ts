import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactFeedText } from '../../core/feed.js';
import {
  atomicRenameSync,
  canonicalRealpathSync,
  hasUnsafeSymlinkAncestor,
  isPathInsideDir,
  resolveSafeSpawnTarget,
} from '../../core/utils.js';
import { CompactedChunkStore } from './core.js';

export interface TurboPrefs {
  schemaVersion: 1;
  autoRtk: boolean;
  updatedAt: string;
}

export interface TurboHotspotRecord {
  commandPrefix: string;
  count: number;
  lastCommand: string;
  estimatedWasteTokens: number;
  lastSeenAt: string;
}

export type AutoRtkPreset = 'test' | 'build' | 'git';

export type ParsedSafeAutoRtkCommand =
  | {
      ok: true;
      executable: string;
      args: string[];
      preset: AutoRtkPreset;
      commandPrefix: string;
    }
  | {
      ok: false;
      reason?: string;
    };

export interface SafeCompactRunInput {
  payloadB64: string;
  cwd?: string;
  dataDir?: string;
}

export interface SafeCompactRunResult {
  exitCode: number;
  output: string;
  rawTokens: number;
  summaryTokens: number;
  savedTokens: number;
  rawLogPath?: string;
}

const PREFS_FILENAME = 'prefs.json';
const HOTSPOTS_FILENAME = 'hotspots.json';
const LAST_RAW_LOG_FILENAME = 'last-raw.log';

const MAX_PREFS_BYTES = 64 * 1024;
const MAX_HOTSPOTS_BYTES = 256 * 1024;
const MAX_HOTSPOTS_ITEMS = 20;
const MAX_RAW_LOG_BYTES = 128 * 1024;
const MAX_COMMAND_LENGTH = 512;
const MAX_COMMAND_ARGS = 24;
const MAX_PAYLOAD_B64_LENGTH = 4096;
const COMPACT_RUN_TIMEOUT_MS = 120_000;
const COMPACT_RUN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const FAILURE_TAIL_MIN_LINES = 60;

// Hard-deny any Shell control / metacharacters or control bytes (including \r, \n, \0, backticks, pipes, redirects, subshells, escapes)
const SHELL_META_NO_BACKSLASH_RE = /[;&|`$><\r\n()\x00-\x1f\x7f]/;
const WIN_EXTRA_SHELL_META_RE = /[%!^]/;
const SHELL_META_HARD_DENY_RE = /[;&|`$><\r\n()\\\x00-\x1f\x7f]/;
// Path arguments are always quoted by quoteSafeShellPathArg; allow () in paths while hard-denying all shell metacharacters, quotes, expansions ($ -> rejects $(), %, !, ^), and control bytes
const PATH_META_HARD_DENY_RE = /[%!^"';&|`$><\r\n\x00-\x1f\x7f]/;
const UNQUOTED_SHELL_SYNTAX_RE = /[*?[\]{}#]/;
const SAFE_EXECUTABLE_RE = /^[a-z][a-z0-9-]*$/;
const SAFE_SHELL_PATH_RE = /^[\p{L}\p{M}\p{N}._/@:+ ()-]+$/u;
const SAFE_WIN_PATH_BODY_RE = /^[\p{L}\p{M}\p{N}._/@\\+ ~()-]+$/u;
const SAFE_B64URL_RE = /^[A-Za-z0-9_-]+$/;
const ENV_ASSIGN_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

const FORBIDDEN_SHELL_EXECUTABLES = new Set([
  'eval',
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
  'env',
  'exec',
  'source',
  'node',
  'agy-nov',
]);

const GIT_ALLOWED_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'branch', 'show']);
const GIT_DANGEROUS_SHORT_FLAGS = new Set(['-c', '-C', '-o', '-O']);
const GIT_DANGEROUS_LONG_FLAG_PREFIXES = [
  '--config',
  '--config-env',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--exec-path',
  '--ext-diff',
  '--external-diff',
  '--textconv',
  '--no-index',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--output',
  '--paginate',
  '--pager',
  '--difftool',
  '--alias',
];

// Strictly flags that ALWAYS consume a separate following value argument (never PARSE_OPT_OPTARG)
const GIT_BRANCH_REQUIRED_VALUE_FLAGS = new Set([
  '--contains',
  '--no-contains',
  '--format',
  '--sort',
  '--points-at',
]);

// Flags with optional value in Git (PARSE_OPT_OPTARG): space-separated arg becomes a branch name!
// Must ONLY be accepted bare (no value) or with `=value`, NEVER consuming the next token.
const GIT_BRANCH_OPTIONAL_VALUE_FLAGS = new Set([
  '--merged',
  '--no-merged',
  '--color',
  '--abbrev',
]);

const GIT_BRANCH_READONLY_BOOL_FLAGS = new Set([
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-v',
  '-vv',
  '--verbose',
  '-l',
  '--list',
  '--show-current',
  '--no-color',
  '--no-abbrev',
  '-q',
  '--quiet',
  '--column',
  '--no-column',
  '-i',
  '--ignore-case',
]);

const NPM_ALLOWED_RUN_SCRIPTS = new Set(['test', 'build', 'typecheck', 'lint']);
const NPM_DANGEROUS_FLAGS = new Set([
  '--script-shell',
  '--prefix',
  '--userconfig',
  '--globalconfig',
  '--cache',
  '--registry',
  '--eval',
  '-e',
  '-C',
  '--cwd',
  '--before',
  '--shell',
]);

const PNPM_YARN_ALLOWED_SCRIPTS = new Set(['test', 'build', 'typecheck', 'lint']);
const PNPM_YARN_DANGEROUS_FLAGS = new Set([
  '--config',
  '--dir',
  '-C',
  '--prefix',
  '--cwd',
  '--script-shell',
  '--registry',
  '--global',
  '-g',
  '--shell',
]);

const NPX_DANGEROUS_FLAGS = new Set([
  '-c',
  '--call',
  '--package',
  '-p',
  '--shell',
  '-y',
  '--yes',
]);

const TSC_DANGEROUS_FLAGS = new Set([
  '-b',
  '--build',
  '-p',
  '--project',
  '--outDir',
  '--outFile',
  '--declaration',
  '--declarationDir',
  '--emitDeclarationOnly',
  '--tsBuildInfoFile',
  '--generateTrace',
  '--listEmittedFiles',
  '-w',
  '--watch',
  '--init',
]);

const VITEST_DANGEROUS_FLAGS = new Set([
  '-w',
  '--watch',
  '--ui',
  '-c',
  '--config',
  '--configLoader',
  '--config-loader',
  '-r',
  '--root',
  '--dir',
  '--outputFile',
  '--output-file',
  '--reporter',
  '--reporters',
  '--setupFiles',
  '--setup-files',
  '--globalSetup',
  '--global-setup',
  '--execArgv',
  '--exec-argv',
  '--environment',
  '--browser',
  '-u',
  '--update',
]);

const JEST_DANGEROUS_FLAGS = new Set([
  '-w',
  '--watch',
  '--watchAll',
  '--watch-all',
  '-u',
  '--updateSnapshot',
  '--update-snapshot',
  '-c',
  '--config',
  '--outputFile',
  '--output-file',
  '--reporters',
  '--setupFiles',
  '--setup-files',
  '--setupFilesAfterEnv',
  '--setup-files-after-env',
  '--runner',
  '--testRunner',
  '--test-runner',
  '--testEnvironment',
  '--test-environment',
  '--resolver',
  '--transform',
  '--preset',
  '--rootDir',
  '--root-dir',
  '--roots',
  '--projects',
  '--watchPlugins',
  '--watch-plugins',
  '--globalSetup',
  '--global-setup',
  '--globalTeardown',
  '--global-teardown',
]);

const ESLINT_DANGEROUS_FLAGS = new Set([
  '--fix',
  '--fix-dry-run',
  '--fix-type',
  '-o',
  '--output-file',
  '-c',
  '--config',
  '-f',
  '--format',
  '--parser',
  '--plugin',
  '--rulesdir',
  '--resolve-plugins-relative-to',
  '--cache',
  '--cache-location',
  '--cache-file',
]);

const PYTEST_DANGEROUS_FLAGS = new Set([
  '-c',
  '--confcutdir',
  '--rootdir',
  '-o',
  '--override-ini',
  '-p',
  '--basetemp',
  '--junitxml',
  '--junit-xml',
  '--log-file',
  '--resultlog',
  '--result-log',
  '--cache-clear',
  '--import-mode',
]);

const CARGO_ALLOWED_SUBCOMMANDS = new Set(['test', 'check', 'build']);
const CARGO_DANGEROUS_FLAGS = new Set([
  '--config',
  '-Z',
  '--target-dir',
  '--manifest-path',
  '--out-dir',
]);

const GO_ALLOWED_SUBCOMMANDS = new Set(['test', 'vet']);
const GO_DANGEROUS_FLAGS = new Set([
  '-exec',
  '-toolexec',
  '-vettool',
  '-ldflags',
  '-gcflags',
  '-gccgoflags',
  '-asmflags',
  '-pkgdir',
  '-outputdir',
  '-o',
  '-c',
  '-C',
  '-cpuprofile',
  '-memprofile',
  '-coverprofile',
  '-blockprofile',
  '-mutexprofile',
  '-trace',
  '-modfile',
  '-overlay',
  '-test.cpuprofile',
  '-test.memprofile',
  '-test.coverprofile',
  '-test.blockprofile',
  '-test.mutexprofile',
  '-test.trace',
  '-test.outputdir',
]);

const PASSTHROUGH_ALL_DANGEROUS_FLAGS = new Set<string>([
  ...NPM_DANGEROUS_FLAGS,
  ...PNPM_YARN_DANGEROUS_FLAGS,
  ...TSC_DANGEROUS_FLAGS,
  ...VITEST_DANGEROUS_FLAGS,
  ...JEST_DANGEROUS_FLAGS,
  ...ESLINT_DANGEROUS_FLAGS,
  ...PYTEST_DANGEROUS_FLAGS,
  ...CARGO_DANGEROUS_FLAGS,
  ...GO_DANGEROUS_FLAGS,
  ...[...GO_DANGEROUS_FLAGS].map((flag) => (flag.startsWith('-') && !flag.startsWith('--') ? `-${flag}` : flag)),
  '--exec',
  '-e',
  '--eval',
  '-r',
  '--require',
  '--import',
  '--loader',
]);

const ESTIMATED_WASTE_BY_PRESET: Record<AutoRtkPreset, number> = {
  test: 2400,
  build: 1800,
  git: 1200,
};

// ---------------------------------------------------------------------------
// Symlink-safe private file helpers (zero writes on read, 0700/0600 on write)
// ---------------------------------------------------------------------------

function resolveSafeExistingDir(dirPath: string): string | null {
  if (!dirPath || typeof dirPath !== 'string' || dirPath.includes('\0')) return null;
  const resolved = path.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor(resolved)) return null;
  try {
    const st = fs.lstatSync(resolved);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return canonicalRealpathSync(resolved);
  } catch {
    return null;
  }
}

function ensureSafePrivateDir(dirPath: string): string {
  if (!dirPath || typeof dirPath !== 'string' || dirPath.includes('\0')) {
    throw new Error('Invalid directory path');
  }
  const resolved = path.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor(resolved)) {
    throw new Error(`Refused symlink directory path: ${dirPath}`);
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Refused unsafe target directory: ${dirPath}`);
  }
  try {
    fs.chmodSync(resolved, 0o700);
  } catch {
    // ignore on platforms without POSIX mode bits
  }
  return canonicalRealpathSync(resolved);
}

function readSafeJsonFile(dirPath: string, fileName: string, maxBytes: number): unknown | null {
  const realDir = resolveSafeExistingDir(dirPath);
  if (!realDir) return null;
  const filePath = path.join(realDir, fileName);
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) {
      return null;
    }
    const realFile = canonicalRealpathSync(filePath);
    if (!isPathInsideDir(realDir, realFile)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(realFile, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function atomicWritePrivateFile(dirPath: string, fileName: string, content: string): string {
  const realDir = ensureSafePrivateDir(dirPath);
  const targetPath = path.join(realDir, fileName);

  try {
    const existing = fs.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Refused to overwrite symlink or non-regular file: ${fileName}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  const nonce = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(realDir, `.${fileName}.tmp.${process.pid}.${Date.now()}.${nonce}`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // ignore on platforms without POSIX mode bits
    }
    atomicRenameSync(tmpPath, targetPath);
    return targetPath;
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Turbo Auto-RTK Preferences & Hotspots (Strict Read-Only Defaults)
// ---------------------------------------------------------------------------

export function createDefaultTurboPrefs(): TurboPrefs {
  return {
    schemaVersion: 1,
    autoRtk: false,
    updatedAt: '',
  };
}

export function loadTurboPrefsReadOnly(moduleDataDir: string): TurboPrefs {
  const raw = readSafeJsonFile(moduleDataDir, PREFS_FILENAME, MAX_PREFS_BYTES);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultTurboPrefs();
  }
  const obj = raw as Record<string, unknown>;
  return {
    schemaVersion: 1,
    autoRtk: obj.autoRtk === true,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
  };
}

export function saveTurboPrefs(
  moduleDataDir: string,
  patch: { autoRtk?: boolean },
): TurboPrefs {
  const current = loadTurboPrefsReadOnly(moduleDataDir);
  const next: TurboPrefs = {
    schemaVersion: 1,
    autoRtk: typeof patch.autoRtk === 'boolean' ? patch.autoRtk : current.autoRtk,
    updatedAt: new Date().toISOString(),
  };
  atomicWritePrivateFile(moduleDataDir, PREFS_FILENAME, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function normalizeHotspotRecord(raw: unknown): TurboHotspotRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const commandPrefix =
    typeof obj.commandPrefix === 'string' ? obj.commandPrefix.trim().slice(0, 64) : '';
  if (!commandPrefix) return null;
  const countNum = Number(obj.count);
  const count = Number.isFinite(countNum) && countNum > 0 ? Math.floor(countNum) : 0;
  if (count <= 0) return null;
  const wasteNum = Number(obj.estimatedWasteTokens);
  const estimatedWasteTokens =
    Number.isFinite(wasteNum) && wasteNum >= 0 ? Math.floor(wasteNum) : 0;
  const lastCommand =
    typeof obj.lastCommand === 'string' ? redactFeedText(obj.lastCommand, 100) : commandPrefix;
  const lastSeenAt = typeof obj.lastSeenAt === 'string' ? obj.lastSeenAt : '';
  return {
    commandPrefix,
    count,
    lastCommand,
    estimatedWasteTokens,
    lastSeenAt,
  };
}

function sortHotspots(items: TurboHotspotRecord[]): TurboHotspotRecord[] {
  return [...items]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    })
    .slice(0, MAX_HOTSPOTS_ITEMS);
}

export function loadTurboHotspotsReadOnly(moduleDataDir: string): TurboHotspotRecord[] {
  const raw = readSafeJsonFile(moduleDataDir, HOTSPOTS_FILENAME, MAX_HOTSPOTS_BYTES);
  if (!raw) return [];
  const rawList = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
      ? ((raw as Record<string, unknown>).items as unknown[])
      : [];
  const normalized: TurboHotspotRecord[] = [];
  for (const item of rawList) {
    const rec = normalizeHotspotRecord(item);
    if (rec) normalized.push(rec);
  }
  return sortHotspots(normalized);
}

// ---------------------------------------------------------------------------
// Strict Whitelist Single-Command Parser & Validator
// ---------------------------------------------------------------------------

function normalizeSafeWindowsRelativePathArg(token: string): string | null {
  if (!token.includes('\\')) return token;
  if (
    token.startsWith('\\') ||
    token.startsWith('/') ||
    token.startsWith('-') ||
    token.includes(':') ||
    token.includes('\\\\') ||
    token.includes('//')
  ) {
    return null;
  }
  if (!/^[A-Za-z0-9._@+][A-Za-z0-9._@+ /\\-]*$/.test(token)) {
    return null;
  }
  const normalized = token.replace(/\\/g, '/');
  if (normalized.split('/').some((seg) => seg === '..')) {
    return null;
  }
  return normalized;
}

export function tokenizeSimpleSingleCommand(
  commandLine: string,
  platform: NodeJS.Platform = process.platform,
): { ok: true; tokens: string[] } | { ok: false; reason: string } {
  if (typeof commandLine !== 'string') {
    return { ok: false, reason: 'non-string command' };
  }
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty command' };
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { ok: false, reason: 'command exceeds max length' };
  }
  if (platform === 'win32') {
    if (SHELL_META_NO_BACKSLASH_RE.test(trimmed) || WIN_EXTRA_SHELL_META_RE.test(trimmed)) {
      return { ok: false, reason: 'disallowed shell metacharacter' };
    }
  } else if (SHELL_META_HARD_DENY_RE.test(trimmed)) {
    return { ok: false, reason: 'disallowed shell metacharacter' };
  }

  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === ' ') {
      if (inToken) {
        if (!current) return { ok: false, reason: 'empty quoted token' };
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }

    if (UNQUOTED_SHELL_SYNTAX_RE.test(ch)) {
      return { ok: false, reason: 'disallowed shell glob or syntax character' };
    }
    if (!inToken && (ch === '~' || ch === '!')) {
      return { ok: false, reason: 'disallowed shell expansion prefix' };
    }

    current += ch;
    inToken = true;
  }

  if (quote !== null) {
    return { ok: false, reason: 'unclosed quote' };
  }
  if (inToken) {
    if (!current) return { ok: false, reason: 'empty quoted token' };
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return { ok: false, reason: 'no tokens' };
  }
  if (tokens.length - 1 > MAX_COMMAND_ARGS) {
    return { ok: false, reason: 'too many arguments' };
  }

  if (platform === 'win32') {
    if (tokens[0].includes('\\')) {
      return { ok: false, reason: 'disallowed backslash in executable' };
    }
    for (let i = 1; i < tokens.length; i += 1) {
      if (tokens[i].includes('\\')) {
        const normalized = normalizeSafeWindowsRelativePathArg(tokens[i]);
        if (normalized === null) {
          return { ok: false, reason: 'disallowed backslash argument' };
        }
        tokens[i] = normalized;
      }
    }
  }

  return { ok: true, tokens };
}

function getFlagName(arg: string): string {
  const eqIdx = arg.indexOf('=');
  return eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
}

function matchesDangerousFlag(
  arg: string,
  blocked: Set<string>,
  caseInsensitive = false,
  normalizeDoubleDash = false,
): boolean {
  let flag = getFlagName(arg);
  if (normalizeDoubleDash && flag.startsWith('--') && flag.length > 2) {
    flag = flag.slice(1);
  }
  const flagLower = flag.toLowerCase();

  for (const item of blocked) {
    // Exact match (case-sensitive or case-insensitive)
    if (caseInsensitive ? item.toLowerCase() === flagLower : item === flag) {
      return true;
    }
    // POSIX single-letter short option attached form (e.g. -c/tmp/evil.js, -pevil, -Zunstable-options)
    // and combined short option clusters (e.g. -qc, -qp, -qf).
    // Disabled for Go-style single-dash long flags (`normalizeDoubleDash === true`) so `-count=1` / `-cover` are never misclassified as `-c`.
    if (!normalizeDoubleDash && item.length === 2 && item[0] === '-' && item[1] !== '-') {
      if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
        const argShort = arg.slice(0, 2);
        if (caseInsensitive ? argShort.toLowerCase() === item.toLowerCase() : argShort === item) {
          return true;
        }
        // Combined POSIX short-flag cluster (pure ASCII letters after single `-`, e.g. `-qc`, `-qp`, `-qf`)
        if (/^-[A-Za-z]{2,}$/.test(arg)) {
          const cluster = caseInsensitive ? arg.slice(1).toLowerCase() : arg.slice(1);
          const targetChar = caseInsensitive ? item[1].toLowerCase() : item[1];
          if (cluster.includes(targetChar)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function validateGitArgs(args: string[]): ParsedSafeAutoRtkCommand {
  if (args.length === 0) {
    return { ok: false, reason: 'missing git subcommand' };
  }
  const sub = args[0];
  if (!GIT_ALLOWED_SUBCOMMANDS.has(sub)) {
    return { ok: false, reason: 'disallowed git subcommand' };
  }

  const rest = args.slice(1);
  for (const arg of rest) {
    const flagName = getFlagName(arg);
    const lowerFlag = flagName.toLowerCase();
    if (GIT_DANGEROUS_SHORT_FLAGS.has(flagName)) {
      return { ok: false, reason: `disallowed git flag ${flagName}` };
    }
    if (/^-[cCoO].+/.test(arg)) {
      return { ok: false, reason: `disallowed git short flag ${arg.slice(0, 2)}` };
    }
    if (
      GIT_DANGEROUS_LONG_FLAG_PREFIXES.some(
        (prefix) => lowerFlag === prefix || lowerFlag.startsWith(`${prefix}=`),
      )
    ) {
      return { ok: false, reason: `disallowed git flag ${flagName}` };
    }
  }

  // `git branch` must remain strictly read-only (no branch creation, deletion, rename, or upstream edits)
  if (sub === 'branch') {
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (!arg.startsWith('-')) {
        return { ok: false, reason: 'git branch positional argument rejected' };
      }
      const eqIdx = arg.indexOf('=');
      const flagName = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
      if (GIT_BRANCH_READONLY_BOOL_FLAGS.has(arg)) {
        continue;
      }
      if (GIT_BRANCH_OPTIONAL_VALUE_FLAGS.has(flagName)) {
        // Optional-value flags MUST NOT consume a following space-separated token (Git treats it as a new branch name!)
        continue;
      }
      if (GIT_BRANCH_REQUIRED_VALUE_FLAGS.has(flagName)) {
        if (eqIdx < 0) {
          if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
            i += 1;
          } else {
            return { ok: false, reason: `git branch ${flagName} missing required value` };
          }
        }
        continue;
      }
      return { ok: false, reason: `disallowed git branch flag ${arg}` };
    }
  }

  return {
    ok: true,
    executable: 'git',
    args: [...args],
    preset: 'git',
    commandPrefix: `git ${sub}`,
  };
}

function validateSafeTokens(executable: string, args: string[]): ParsedSafeAutoRtkCommand {
  if (typeof executable !== 'string' || !Array.isArray(args)) {
    return { ok: false, reason: 'invalid token types' };
  }
  if (args.length > MAX_COMMAND_ARGS) {
    return { ok: false, reason: 'too many arguments' };
  }

  // Re-verify raw character safety across executable and every arg (defense-in-depth for compact-run payload)
  let totalLen = executable.length;
  if (!SAFE_EXECUTABLE_RE.test(executable) || FORBIDDEN_SHELL_EXECUTABLES.has(executable)) {
    return { ok: false, reason: 'disallowed executable' };
  }
  if (ENV_ASSIGN_TOKEN_RE.test(executable) || SHELL_META_HARD_DENY_RE.test(executable)) {
    return { ok: false, reason: 'unsafe executable token' };
  }

  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0) {
      return { ok: false, reason: 'invalid argument token' };
    }
    if (SHELL_META_HARD_DENY_RE.test(arg)) {
      return { ok: false, reason: 'unsafe argument metacharacter' };
    }
    totalLen += 1 + arg.length;
    if (totalLen > MAX_COMMAND_LENGTH) {
      return { ok: false, reason: 'command exceeds max length' };
    }
  }

  if (executable === 'git') {
    return validateGitArgs(args);
  }

  if (executable === 'npm') {
    if (args.length === 0) return { ok: false, reason: 'missing npm subcommand' };
    const startIdx = args[0] === 'run' ? 2 : 1;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (matchesDangerousFlag(arg, NPM_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npm flag ${arg}` };
      }
      if (i >= startIdx && arg !== '--' && matchesDangerousFlag(arg, PASSTHROUGH_ALL_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npm passthrough flag ${arg}` };
      }
    }
    if (args[0] === 'test') {
      return {
        ok: true,
        executable: 'npm',
        args: [...args],
        preset: 'test',
        commandPrefix: 'npm test',
      };
    }
    if (args[0] === 'run' && args.length >= 2 && NPM_ALLOWED_RUN_SCRIPTS.has(args[1])) {
      const script = args[1];
      return {
        ok: true,
        executable: 'npm',
        args: [...args],
        preset: script === 'test' ? 'test' : 'build',
        commandPrefix: `npm run ${script}`,
      };
    }
    return { ok: false, reason: 'disallowed npm subcommand' };
  }

  if (executable === 'pnpm' || executable === 'yarn') {
    if (args.length === 0 || !PNPM_YARN_ALLOWED_SCRIPTS.has(args[0])) {
      return { ok: false, reason: `disallowed ${executable} subcommand` };
    }
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (matchesDangerousFlag(arg, PNPM_YARN_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed ${executable} flag ${arg}` };
      }
      // pnpm/yarn forward unknown script flags even without `--`, so enforce passthrough blacklist on all trailing args
      if (arg !== '--' && matchesDangerousFlag(arg, PASSTHROUGH_ALL_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed ${executable} passthrough flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable,
      args: [...args],
      preset: args[0] === 'test' ? 'test' : 'build',
      commandPrefix: `${executable} ${args[0]}`,
    };
  }

  if (executable === 'npx') {
    if (args.length === 0) return { ok: false, reason: 'missing npx target' };
    const tool = args[0];
    const rest = args.slice(1);
    for (const arg of rest) {
      if (matchesDangerousFlag(arg, NPX_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npx flag ${arg}` };
      }
    }
    if (tool === 'tsc') {
      let hasNoEmitTrue = false;
      for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        const lower = arg.toLowerCase();
        if (lower === '--noemit=false' || lower === '--noemit=0') {
          return { ok: false, reason: 'tsc --noEmit=false is disallowed' };
        }
        if (lower === '--noemit') {
          const next = rest[i + 1]?.toLowerCase();
          if (next === 'false' || next === '0') {
            return { ok: false, reason: 'tsc --noEmit false is disallowed' };
          }
          hasNoEmitTrue = true;
        } else if (lower === '--noemit=true') {
          hasNoEmitTrue = true;
        }
        if (matchesDangerousFlag(arg, TSC_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed tsc flag ${arg}` };
        }
      }
      if (!hasNoEmitTrue) {
        return { ok: false, reason: 'npx tsc requires --noEmit' };
      }
      return {
        ok: true,
        executable: 'npx',
        args: [...args],
        preset: 'build',
        commandPrefix: 'npx tsc --noEmit',
      };
    }
    if (tool === 'vitest') {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, VITEST_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed vitest flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: 'npx',
        args: [...args],
        preset: 'test',
        commandPrefix: 'npx vitest',
      };
    }
    if (tool === 'jest') {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, JEST_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed jest flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: 'npx',
        args: [...args],
        preset: 'test',
        commandPrefix: 'npx jest',
      };
    }
    if (tool === 'eslint') {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, ESLINT_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed eslint flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: 'npx',
        args: [...args],
        preset: 'build',
        commandPrefix: 'npx eslint',
      };
    }
    return { ok: false, reason: 'disallowed npx tool' };
  }

  if (executable === 'pytest') {
    for (const arg of args) {
      if (matchesDangerousFlag(arg, PYTEST_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed pytest flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: 'pytest',
      args: [...args],
      preset: 'test',
      commandPrefix: 'pytest',
    };
  }

  if (executable === 'cargo') {
    if (args.length === 0 || !CARGO_ALLOWED_SUBCOMMANDS.has(args[0])) {
      return { ok: false, reason: 'disallowed cargo subcommand' };
    }
    for (const arg of args.slice(1)) {
      if (matchesDangerousFlag(arg, CARGO_DANGEROUS_FLAGS, false)) {
        return { ok: false, reason: `disallowed cargo flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: 'cargo',
      args: [...args],
      preset: args[0] === 'test' ? 'test' : 'build',
      commandPrefix: `cargo ${args[0]}`,
    };
  }

  if (executable === 'go') {
    if (args.length === 0 || !GO_ALLOWED_SUBCOMMANDS.has(args[0])) {
      return { ok: false, reason: 'disallowed go subcommand' };
    }
    for (const arg of args.slice(1)) {
      if (matchesDangerousFlag(arg, GO_DANGEROUS_FLAGS, false, true)) {
        return { ok: false, reason: `disallowed go flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: 'go',
      args: [...args],
      preset: args[0] === 'test' ? 'test' : 'build',
      commandPrefix: `go ${args[0]}`,
    };
  }

  return { ok: false, reason: 'command not in Auto-RTK whitelist' };
}

export function parseSafeAutoRtkCommand(
  commandLine: string,
  platform: NodeJS.Platform = process.platform,
): ParsedSafeAutoRtkCommand {
  const tokenized = tokenizeSimpleSingleCommand(commandLine, platform);
  if (!tokenized.ok) {
    return { ok: false, reason: tokenized.reason };
  }
  const [executable, ...args] = tokenized.tokens;
  if (ENV_ASSIGN_TOKEN_RE.test(executable)) {
    return { ok: false, reason: 'environment variable prefix rejected' };
  }
  return validateSafeTokens(executable, args);
}

// ---------------------------------------------------------------------------
// Safe PreToolUse.overwrite Command Builder
// ---------------------------------------------------------------------------

export function isSafeAbsolutePathArg(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (typeof candidate !== 'string') return false;
  if (!candidate || candidate.length > 512) return false;
  // Reject leading/trailing whitespace or any control characters (\r, \n, \t, \0, etc.) without trimming
  if (candidate !== candidate.trim() || /[\x00-\x1f\x7f]/.test(candidate)) return false;
  // Hard-deny all Windows and POSIX shell metacharacters
  if (PATH_META_HARD_DENY_RE.test(candidate)) return false;

  if (platform === 'win32') {
    // Reject UNC paths (`\\server\share` / `//server/share`) and require drive-letter absolute path
    if (candidate.startsWith('\\\\') || candidate.startsWith('//')) return false;
    if (!/^[A-Za-z]:[\\/]/.test(candidate)) {
      return false;
    }
    const rest = candidate.slice(2);
    if (rest.includes(':')) return false;
    return SAFE_WIN_PATH_BODY_RE.test(rest);
  }

  if (!candidate.startsWith('/')) return false;
  if (candidate.includes('\\')) return false;
  return SAFE_SHELL_PATH_RE.test(candidate);
}

function resolvePathForPlatform(rawPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return path.win32.resolve(rawPath);
  }
  if (platform === process.platform) {
    return path.resolve(rawPath);
  }
  return path.posix.resolve(rawPath);
}

function quoteSafeShellPathArg(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    // Forward slashes inside double quotes are accepted cleanly by cmd.exe, PowerShell, Git Bash, and Node.js
    const posixSlashPath = value.replace(/\\/g, '/');
    return `"${posixSlashPath}"`;
  }
  return `'${value}'`;
}

export function resolveDefaultCliEntryPath(): string {
  const argvEntry = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : '';
  const argvDir = argvEntry ? path.dirname(path.resolve(argvEntry)) : '';
  const candidates = [
    argvDir ? path.resolve(argvDir, 'cli.cjs') : '',
    argvDir ? path.resolve(argvDir, '../dist/cli.cjs') : '',
    path.resolve(process.cwd(), 'dist/cli.cjs'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // keep trying next candidate
    }
  }
  return path.resolve(process.cwd(), 'dist/cli.cjs');
}

export function buildAutoRtkOverwriteCommand(
  cliEntryPath: string,
  parsed: Extract<ParsedSafeAutoRtkCommand, { ok: true }>,
  rootDataDir?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!isSafeAbsolutePathArg(cliEntryPath, platform)) {
    return null;
  }
  const resolvedCli = resolvePathForPlatform(cliEntryPath, platform);
  if (!isSafeAbsolutePathArg(resolvedCli, platform)) {
    return null;
  }

  // Re-validate parsed tokens before encoding
  const rechecked = validateSafeTokens(parsed.executable, parsed.args);
  if (!rechecked.ok) {
    return null;
  }

  const payloadJson = JSON.stringify({
    v: 1,
    executable: rechecked.executable,
    args: rechecked.args,
    preset: rechecked.preset,
  });
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  if (!SAFE_B64URL_RE.test(payloadB64) || payloadB64.length > MAX_PAYLOAD_B64_LENGTH) {
    return null;
  }

  const parts = [
    'node',
    quoteSafeShellPathArg(resolvedCli, platform),
    'compact-run',
    `--payload=${payloadB64}`,
  ];

  if (rootDataDir !== undefined && rootDataDir !== '') {
    if (!isSafeAbsolutePathArg(rootDataDir, platform)) {
      return null;
    }
    const resolvedDataDir = resolvePathForPlatform(rootDataDir, platform);
    if (!isSafeAbsolutePathArg(resolvedDataDir, platform)) {
      return null;
    }
    parts.push(`--data-dir=${quoteSafeShellPathArg(resolvedDataDir, platform)}`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Linear O(n) Multiline Redaction for Raw Log Tail (<= 128 KiB)
// ---------------------------------------------------------------------------

function stripNestedPrivateBlocksLinear(input: string): string {
  if (!input.includes('<')) return input;
  const openTag = '<private';
  const closeTag = '</private';
  const chunks: string[] = [];
  let cursor = 0;
  let i = 0;
  let depth = 0;
  const len = input.length;

  const isAsciiTagMatch = (pos: number, expected: string): boolean => {
    if (pos + expected.length > len) return false;
    for (let k = 0; k < expected.length; k += 1) {
      let c = input.charCodeAt(pos + k);
      if (c >= 65 && c <= 90) c += 32;
      if (c !== expected.charCodeAt(k)) return false;
    }
    return true;
  };

  while (i < len) {
    if (input.charCodeAt(i) === 60) {
      if (isAsciiTagMatch(i, openTag)) {
        const after = i + openTag.length;
        const ch = after < len ? input.charCodeAt(after) : -1;
        if (ch === 62 || ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 47) {
          const endBracket = input.indexOf('>', after);
          if (endBracket !== -1) {
            const selfClosing = input.charCodeAt(endBracket - 1) === 47;
            if (depth === 0) {
              if (i > cursor) chunks.push(input.slice(cursor, i));
              chunks.push('[REDACTED_PRIVATE]');
            }
            if (!selfClosing) depth += 1;
            else if (depth === 0) cursor = endBracket + 1;
            i = endBracket + 1;
            continue;
          }
        }
      } else if (depth > 0 && isAsciiTagMatch(i, closeTag)) {
        const after = i + closeTag.length;
        const ch = after < len ? input.charCodeAt(after) : -1;
        if (ch === 62 || ch === 32 || ch === 9 || ch === 10 || ch === 13) {
          const endBracket = input.indexOf('>', after);
          if (endBracket !== -1) {
            depth -= 1;
            i = endBracket + 1;
            if (depth === 0) cursor = i;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  if (depth === 0 && cursor < len) {
    chunks.push(input.slice(cursor));
  }
  return chunks.join('');
}

function stripMultilinePemAndPrivateLinear(input: string): string {
  let out = stripNestedPrivateBlocksLinear(input);

  // Strip PEM private key blocks linearly across multiple lines
  const beginMarker = '-----BEGIN ';
  if (out.includes(beginMarker)) {
    const chunks: string[] = [];
    let cur = 0;
    while (cur < out.length) {
      const start = out.indexOf(beginMarker, cur);
      if (start === -1) {
        chunks.push(out.slice(cur));
        break;
      }
      const headerEnd = out.indexOf('-----', start + beginMarker.length);
      if (headerEnd === -1) {
        chunks.push(out.slice(cur));
        break;
      }
      const label = out.slice(start + beginMarker.length, headerEnd);
      if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(label)) {
        chunks.push(out.slice(cur, headerEnd + 5));
        cur = headerEnd + 5;
        continue;
      }
      if (start > cur) chunks.push(out.slice(cur, start));
      chunks.push('[REDACTED_PRIVATE_KEY]');
      const endPrefix = '-----END ';
      let endIdx = out.indexOf(endPrefix, headerEnd + 5);
      let closedAt = -1;
      while (endIdx !== -1) {
        const footerEnd = out.indexOf('-----', endIdx + endPrefix.length);
        if (footerEnd === -1) break;
        const endLabel = out.slice(endIdx + endPrefix.length, footerEnd);
        if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(endLabel)) {
          closedAt = footerEnd + 5;
          break;
        }
        endIdx = out.indexOf(endPrefix, footerEnd + 5);
      }
      cur = closedAt === -1 ? out.length : closedAt;
    }
    out = chunks.join('');
  }

  return out;
}

function stripAnsiEscapeCodes(input: string): string {
  return input
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function sliceTailUtf8Bytes(input: string, maxBytes: number): string {
  const buf = Buffer.from(input, 'utf8');
  if (buf.length <= maxBytes) return input;
  // Slice last maxBytes bytes and skip any leading UTF-8 continuation bytes (0b10xxxxxx)
  let offset = buf.length - maxBytes;
  while (offset < buf.length && (buf[offset] & 0xc0) === 0x80) {
    offset += 1;
  }
  const sliced = buf.subarray(offset).toString('utf8');
  const firstNl = sliced.indexOf('\n');
  if (firstNl > 0 && firstNl < 256) {
    return sliced.slice(firstNl + 1);
  }
  return sliced;
}

function redactRawLogTail(rawText: string, maxBytes = MAX_RAW_LOG_BYTES): string {
  const cleaned = stripAnsiEscapeCodes(rawText);
  // Keep a bounded tail window (up to 2x cap) before multiline redaction so runtime stays strictly linear & bounded
  const windowText = sliceTailUtf8Bytes(cleaned, maxBytes * 2);
  const blockStripped = stripMultilinePemAndPrivateLinear(windowText);
  const lines = blockStripped.split(/\r?\n/);
  const redactedLines = lines.map((line) => (line.length === 0 ? '' : redactFeedText(line, 4096)));
  const joined = `${redactedLines.join('\n')}\n`;
  return sliceTailUtf8Bytes(joined, maxBytes);
}

function writeRedactedRawLogIfDataDirExists(
  rootDataDir: string | undefined,
  rawOutput: string,
): string | undefined {
  if (!rootDataDir) return undefined;
  const realRoot = resolveSafeExistingDir(rootDataDir);
  if (!realRoot) return undefined;

  try {
    const modulesDir = path.join(realRoot, 'modules');
    const turboDir = path.join(modulesDir, 'turbo');
    const redactedTail = redactRawLogTail(rawOutput, MAX_RAW_LOG_BYTES);
    return atomicWritePrivateFile(turboDir, LAST_RAW_LOG_FILENAME, redactedTail);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Safe Compact-Run Executor (strict shell: false + defense-in-depth re-check)
// ---------------------------------------------------------------------------

function decodeAndRevalidatePayload(
  payloadB64: string,
): Extract<ParsedSafeAutoRtkCommand, { ok: true }> | null {
  if (
    typeof payloadB64 !== 'string' ||
    payloadB64.length === 0 ||
    payloadB64.length > MAX_PAYLOAD_B64_LENGTH ||
    !SAFE_B64URL_RE.test(payloadB64)
  ) {
    return null;
  }
  let parsedJson: unknown;
  try {
    const decoded = Buffer.from(payloadB64, 'base64url').toString('utf8');
    parsedJson = JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return null;
  }
  const obj = parsedJson as Record<string, unknown>;
  if (typeof obj.executable !== 'string' || !Array.isArray(obj.args)) {
    return null;
  }
  const rawArgs: string[] = [];
  for (const item of obj.args) {
    if (typeof item !== 'string') return null;
    rawArgs.push(item);
  }

  // Re-run full whitelist validation; never trust preset or args from CLI payload
  const validated = validateSafeTokens(obj.executable, rawArgs);
  if (!validated.ok) {
    return null;
  }
  return validated;
}

export function executeSafeCompactRun(input: SafeCompactRunInput): SafeCompactRunResult {
  const validated = decodeAndRevalidatePayload(input.payloadB64);
  if (!validated) {
    const msg =
      '[agy-NOV Auto-RTK] Rejected unsafe or non-whitelisted compact-run payload.';
    return {
      exitCode: 126,
      output: msg,
      rawTokens: 0,
      summaryTokens: Math.ceil(msg.length / 4),
      savedTokens: 0,
    };
  }

  const execCwd =
    typeof input.cwd === 'string' && input.cwd.trim() ? path.resolve(input.cwd) : process.cwd();
  const cmdLabel = [validated.executable, ...validated.args].join(' ').slice(0, 80);

  const resolvedSpawn = resolveSafeSpawnTarget(validated.executable, validated.args, {
    cwd: execCwd,
  });

  const child = spawnSync(resolvedSpawn.command, resolvedSpawn.args, {
    cwd: execCwd,
    shell: false,
    windowsHide: true,
    timeout: COMPACT_RUN_TIMEOUT_MS,
    maxBuffer: COMPACT_RUN_MAX_BUFFER_BYTES,
    encoding: 'utf8',
  });

  let exitCode: number;
  if (typeof child.status === 'number') {
    exitCode = child.status;
  } else if (child.error) {
    const errCode = (child.error as NodeJS.ErrnoException).code;
    if (errCode === 'ENOENT') exitCode = 127;
    else if (errCode === 'ETIMEDOUT') exitCode = 124;
    else exitCode = 1;
  } else if (child.signal) {
    exitCode = 128;
  } else {
    exitCode = 1;
  }

  const stdout = typeof child.stdout === 'string' ? child.stdout : '';
  const stderr = typeof child.stderr === 'string' ? child.stderr : '';
  let combinedRaw = '';
  if (stdout && stderr) {
    combinedRaw = stdout.endsWith('\n') ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
  } else {
    combinedRaw = stdout || stderr;
  }
  if (!combinedRaw && child.error) {
    combinedRaw = child.error.message;
  }

  const rawTokens = Math.ceil(combinedRaw.length / 4);
  const store = new CompactedChunkStore(1);

  let bodyText: string;
  if (!combinedRaw.trim()) {
    bodyText = `[Turbo Auto-RTK] ${cmdLabel} [preset=${validated.preset}, exit=${exitCode}] (no output)`;
  } else {
    const compacted = store.compact(undefined, cmdLabel, combinedRaw, {
      preset: validated.preset,
      maxErrorLines: 60,
      tailLines: 50,
      persistStats: false,
    });
    bodyText = compacted.summaryText;

    // On non-zero exit code, guarantee at least the last 60 non-trailing-blank lines (error stack / failures) are preserved verbatim
    if (exitCode !== 0) {
      const cleanedLines = stripAnsiEscapeCodes(combinedRaw).split(/\r?\n/);
      let lastNonEmptyIdx = cleanedLines.length - 1;
      while (lastNonEmptyIdx >= 0 && cleanedLines[lastNonEmptyIdx].trim() === '') {
        lastNonEmptyIdx -= 1;
      }
      const effectiveLines = lastNonEmptyIdx >= 0 ? cleanedLines.slice(0, lastNonEmptyIdx + 1) : [];
      const tailSlice = effectiveLines.slice(-FAILURE_TAIL_MIN_LINES);
      const nonEmptyTail = tailSlice.filter((l) => l.trim().length > 0);
      const missingAnyTailLine = nonEmptyTail.some((line) => !bodyText.includes(line));

      if (missingAnyTailLine && tailSlice.length > 0) {
        bodyText = [
          bodyText,
          `--- Preserved Failure Tail (exitCode=${exitCode}, last ${tailSlice.length} lines) ---`,
          ...tailSlice,
        ].join('\n');
      }
    }
  }

  const rawLogPath = writeRedactedRawLogIfDataDirExists(input.dataDir, combinedRaw);
  const footerLine = rawLogPath
    ? `[Auto-RTK] exit=${exitCode} · raw tail (redacted, <=128 KiB): ${rawLogPath}`
    : `[Auto-RTK] exit=${exitCode}`;

  const finalOutput = `${bodyText}\n${footerLine}`;
  const summaryTokens = Math.ceil(finalOutput.length / 4);
  const savedTokens = Math.max(0, rawTokens - summaryTokens);

  return {
    exitCode,
    output: finalOutput,
    rawTokens,
    summaryTokens,
    savedTokens,
    ...(rawLogPath ? { rawLogPath } : {}),
  };
}

// ---------------------------------------------------------------------------
// PostToolUse Hotspot Observer (zero writes when rootDataDir missing)
// ---------------------------------------------------------------------------

export function recordTurboHotspot(
  moduleDataDir: string,
  commandLine: string,
  rootDataDir: string,
): TurboHotspotRecord[] | null {
  if (typeof commandLine !== 'string' || !commandLine.trim()) return null;
  // Ignore already-rewritten compact-run invocations
  if (/\bcompact-run\b/.test(commandLine) && commandLine.includes('--payload=')) {
    return null;
  }

  // Strictly avoid creating missing dataDir on PostToolUse observation
  const realRoot = resolveSafeExistingDir(rootDataDir);
  if (!realRoot) return null;

  const parsed = parseSafeAutoRtkCommand(commandLine);
  if (!parsed.ok) return null;

  const existing = loadTurboHotspotsReadOnly(moduleDataDir);
  const nowIso = new Date().toISOString();
  const safeLastCommand = redactFeedText(commandLine, 100);
  const wasteIncrement = ESTIMATED_WASTE_BY_PRESET[parsed.preset];

  const byPrefix = new Map<string, TurboHotspotRecord>();
  for (const item of existing) {
    byPrefix.set(item.commandPrefix, { ...item });
  }

  const prev = byPrefix.get(parsed.commandPrefix);
  if (prev) {
    prev.count += 1;
    prev.lastCommand = safeLastCommand;
    prev.estimatedWasteTokens += wasteIncrement;
    prev.lastSeenAt = nowIso;
  } else {
    byPrefix.set(parsed.commandPrefix, {
      commandPrefix: parsed.commandPrefix,
      count: 1,
      lastCommand: safeLastCommand,
      estimatedWasteTokens: wasteIncrement,
      lastSeenAt: nowIso,
    });
  }

  const nextItems = sortHotspots(Array.from(byPrefix.values()));
  try {
    atomicWritePrivateFile(
      moduleDataDir,
      HOTSPOTS_FILENAME,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: nowIso, items: nextItems }, null, 2)}\n`,
    );
    return nextItems;
  } catch {
    return null;
  }
}
