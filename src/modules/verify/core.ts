import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import { atomicWriteJson } from '../../core/utils.js';

export const ALLOWED_VERIFY_EXECUTABLES: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'tsc',
  'vitest',
  'jest',
  'pytest',
  'python3',
  'cargo',
  'go',
  'ruff',
  'eslint',
  'git',
]);

export const ALLOWED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'diff',
  'status',
  'rev-parse',
  'check-ignore',
]);

export const ALLOWED_PYTHON_MODULES: ReadonlySet<string> = new Set([
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

export const MAX_VERIFY_COMMANDS = 20;
export const MAX_VERIFY_ARGS = 20;
export const MAX_VERIFY_ARG_LENGTH = 256;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
export const STOP_HOOK_SINGLE_TIMEOUT_MS = 8_000;
export const STOP_HOOK_TOTAL_BUDGET_MS = 14_000;
export const MAX_CAPTURE_BYTES = 64 * 1024;
export const MAX_STORED_OUTPUT_TAIL_CHARS = 4_096;
export const MAX_STORED_SESSIONS = 100;
export const MAX_STORED_EVIDENCE = 60;
export const DEFAULT_MAX_CONSECUTIVE_BLOCKS = 3;
export const MIN_CONSECUTIVE_BLOCKS = 1;
export const MAX_CONSECUTIVE_BLOCKS = 10;

const COMMAND_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_SYMLINK_DEPTH = 20;

export interface VerifyCommandSpec {
  id: string;
  label: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  enabled: boolean;
}

export interface VerifyPolicy {
  enforceOnStop: boolean;
  autoRunOnStop: boolean;
  blockEmptyWrites: boolean;
  maxConsecutiveBlocks: number;
  commands: VerifyCommandSpec[];
}

export interface VerifyPolicyPatch {
  enforceOnStop?: boolean;
  autoRunOnStop?: boolean;
  blockEmptyWrites?: boolean;
  maxConsecutiveBlocks?: number;
  commands?: Array<{
    id: string;
    label: string;
    executable: string;
    args: string[];
    timeoutMs?: number;
    enabled?: boolean;
  }>;
}

export interface VerifySessionRecord {
  conversationId: string;
  workspaceRoot?: string;
  dirtyFiles: string[];
  emptyFiles: string[];
  lastEditAt?: string;
  lastVerifiedAt?: string;
  lastVerifiedPassed?: boolean;
  consecutiveBlocks: number;
  totalBlocks: number;
  lastGuardrailReleaseAt?: string;
  updatedAt: string;
}

export interface VerifyCommandRunResult {
  commandId: string;
  label: string;
  executable: string;
  args: string[];
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
  outputTruncated: boolean;
  error?: string;
}

export type VerifyTrigger = 'manual' | 'stop-hook' | 'app-ui';
export type VerifyOutcome = 'pass' | 'fail' | 'blocked' | 'guardrail-allow';

export interface VerifyEvidenceRecord {
  id: string;
  conversationId: string;
  trigger: VerifyTrigger;
  outcome: VerifyOutcome;
  passed: boolean;
  timestamp: string;
  durationMs: number;
  dirtyFiles: string[];
  emptyFiles: string[];
  results: VerifyCommandRunResult[];
  summary: string;
  reason?: string;
  targetBranch?: string;
  targetWorktree?: string;
}

export interface VerifyStats {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  blockedStops: number;
}

export interface VerifyStateFile {
  schemaVersion: 1;
  policy: VerifyPolicy;
  sessions: Record<string, VerifySessionRecord>;
  evidence: VerifyEvidenceRecord[];
  blockedStops: number;
  updatedAt: string;
}

export interface VerifyStateView {
  mode: 'live' | 'demo';
  policy: VerifyPolicy;
  sessions: VerifySessionRecord[];
  evidence: VerifyEvidenceRecord[];
  stats: VerifyStats;
  updatedAt: string;
}

export const DEFAULT_VERIFY_POLICY: VerifyPolicy = {
  enforceOnStop: true,
  autoRunOnStop: true,
  blockEmptyWrites: true,
  maxConsecutiveBlocks: DEFAULT_MAX_CONSECUTIVE_BLOCKS,
  commands: [
    {
      id: 'typecheck',
      label: 'TypeScript Typecheck',
      executable: 'npm',
      args: ['run', 'typecheck'],
      timeoutMs: 15_000,
      enabled: false,
    },
    {
      id: 'unit-tests',
      label: 'Unit Tests',
      executable: 'npm',
      args: ['test'],
      timeoutMs: 30_000,
      enabled: false,
    },
  ],
};

function findTagCloseBeforeNextOpen(
  input: string,
  from: number,
): { gt: number; nextLt: number } {
  const n = input.length;
  for (let k = from; k < n; k += 1) {
    const code = input.charCodeAt(k);
    if (code === 0x3e /* '>' */) return { gt: k, nextLt: -1 };
    if (code === 0x3c /* '<' */) return { gt: -1, nextLt: k };
  }
  return { gt: -1, nextLt: n };
}

function stripPrivateBlocksLinear(input: string): string {
  if (!input || !input.includes('<')) return input;
  const lower = input.toLowerCase();
  if (!lower.includes('<private')) return input;

  let out = '';
  let cursor = 0;
  let depth = 0;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt < 0) {
      if (depth === 0) out += input.slice(cursor);
      cursor = n;
      break;
    }
    if (lower.startsWith('<private', lt)) {
      const after = lt + 8;
      if (after < n && (input[after] === '>' || /\s/.test(input[after]))) {
        const { gt, nextLt } = findTagCloseBeforeNextOpen(input, after);
        if (gt >= 0) {
          if (depth === 0) {
            out += input.slice(cursor, lt);
            out += '[REDACTED_PRIVATE]';
          }
          depth += 1;
          i = gt + 1;
          cursor = i;
          continue;
        }
        // Unclosed `<private ...`: abandon immediately at next `<` (or end) to preserve strict O(n)
        i = nextLt;
        continue;
      }
    } else if (lower.startsWith('</private', lt)) {
      const after = lt + 9;
      if (after < n && (input[after] === '>' || /\s/.test(input[after]))) {
        const { gt, nextLt } = findTagCloseBeforeNextOpen(input, after);
        if (gt >= 0) {
          if (depth > 0) {
            depth -= 1;
          }
          i = gt + 1;
          if (depth === 0) {
            cursor = i;
          }
          continue;
        }
        // Unclosed `</private ...`: abandon immediately at next `<` (or end) to preserve strict O(n)
        i = nextLt;
        continue;
      }
    }
    i = lt + 1;
  }

  if (depth === 0 && cursor < n) {
    out += input.slice(cursor);
  }

  return out;
}

function redactPemBlocksLinear(input: string): string {
  if (!input || !input.includes('-----')) return input;
  const upper = input.toUpperCase();
  const marker = '-----BEGIN ';
  if (!upper.includes(marker)) return input;

  let out = '';
  let pos = 0;
  while (pos < input.length) {
    const start = upper.indexOf(marker, pos);
    if (start < 0) {
      out += input.slice(pos);
      break;
    }
    const headerEnd = upper.indexOf('-----', start + marker.length);
    if (headerEnd < 0 || headerEnd - start > 96) {
      out += input.slice(pos, start + marker.length);
      pos = start + marker.length;
      continue;
    }
    const headerText = upper.slice(start + marker.length, headerEnd);
    if (!headerText.includes('PRIVATE KEY')) {
      out += input.slice(pos, headerEnd + 5);
      pos = headerEnd + 5;
      continue;
    }

    out += input.slice(pos, start);
    out += '[REDACTED_PRIVATE_KEY]';

    const endMarker = '-----END ';
    let searchPos = headerEnd + 5;
    let foundEnd = -1;
    while (searchPos < input.length) {
      const eStart = upper.indexOf(endMarker, searchPos);
      if (eStart < 0) break;
      const eEnd = upper.indexOf('-----', eStart + endMarker.length);
      if (eEnd < 0 || eEnd - eStart > 96) {
        searchPos = eStart + endMarker.length;
        continue;
      }
      const endLabel = upper.slice(eStart + endMarker.length, eEnd);
      if (endLabel.includes('PRIVATE KEY')) {
        foundEnd = eEnd + 5;
        break;
      }
      searchPos = eEnd + 5;
    }

    if (foundEnd >= 0) {
      pos = foundEnd;
    } else {
      // Unclosed/truncated PEM private key -> redact remainder of text safely
      pos = input.length;
    }
  }
  return out;
}

const SECRET_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer & JWT tokens
  {
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  // Provider API keys & personal access tokens
  {
    pattern:
      /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|sk_live_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghu_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z_-]{24,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    replacement: '[REDACTED_KEY]',
  },
  // Generic secret/token/password assignments
  {
    pattern:
      /(["']?(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?token|auth[_-]?token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;}{]{8,})(["']?)/gi,
    replacement: '$1[REDACTED]$3',
  },
];

export function redactVerifyOutput(input: string): string {
  if (!input) return '';
  let out = stripPrivateBlocksLinear(input);
  out = redactPemBlocksLinear(out);
  for (const { pattern, replacement } of SECRET_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function getVerifyStatePath(moduleDataDir: string): string {
  return path.join(moduleDataDir, 'state.json');
}

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

export interface VerifyCommandValidationResult {
  valid: boolean;
  command?: VerifyCommandSpec;
  error?: string;
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

function validatePythonArgs(id: string, args: string[]): string | null {
  if (args.length === 0) {
    return `Command "${id}" python3 requires explicit arguments (--version, -V, or -m <allowed_module>).`;
  }

  const first = args[0];
  if (first === '--version' || first === '-V') {
    if (args.length !== 1) {
      return `Command "${id}" python3 ${first} does not accept additional arguments.`;
    }
    return null;
  }

  if (first !== '-m') {
    return `Command "${id}" python3 only permits "--version", "-V", or "-m <module>" (disallowed leading arg "${first}").`;
  }

  const modName = args[1];
  if (!modName || !ALLOWED_PYTHON_MODULES.has(modName)) {
    return `Command "${id}" python3 module "${modName ?? ''}" is not in the allowlist (${[...ALLOWED_PYTHON_MODULES].join(', ')}).`;
  }

  for (const arg of args.slice(2)) {
    const lower = arg.toLowerCase();
    if (arg === '-' || arg === '-i' || isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden python3 argument "${arg}".`;
    }
    if (lower === '--eval' || lower.startsWith('--eval=')) {
      return `Command "${id}" uses forbidden python3 option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" python3 argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
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
  } else if (executable === 'python3') {
    toolError = validatePythonArgs(id, args);
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

function cloneDefaultPolicy(): VerifyPolicy {
  return {
    ...DEFAULT_VERIFY_POLICY,
    commands: DEFAULT_VERIFY_POLICY.commands.map((c) => ({ ...c, args: [...c.args] })),
  };
}

export function createDefaultVerifyState(nowIso = new Date().toISOString()): VerifyStateFile {
  return {
    schemaVersion: 1,
    policy: cloneDefaultPolicy(),
    sessions: {},
    evidence: [],
    blockedStops: 0,
    updatedAt: nowIso,
  };
}

function normalizePolicyFromDisk(raw: unknown): VerifyPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneDefaultPolicy();
  }
  const obj = raw as Record<string, unknown>;
  const commands: VerifyCommandSpec[] = [];
  if (Array.isArray(obj.commands)) {
    const seen = new Set<string>();
    for (const item of obj.commands.slice(0, MAX_VERIFY_COMMANDS)) {
      const check = validateVerifyCommand(item);
      if (check.valid && check.command && !seen.has(check.command.id)) {
        seen.add(check.command.id);
        commands.push(check.command);
      }
    }
  } else {
    commands.push(...cloneDefaultPolicy().commands);
  }

  return {
    enforceOnStop:
      typeof obj.enforceOnStop === 'boolean'
        ? obj.enforceOnStop
        : DEFAULT_VERIFY_POLICY.enforceOnStop,
    autoRunOnStop:
      typeof obj.autoRunOnStop === 'boolean'
        ? obj.autoRunOnStop
        : DEFAULT_VERIFY_POLICY.autoRunOnStop,
    blockEmptyWrites:
      typeof obj.blockEmptyWrites === 'boolean'
        ? obj.blockEmptyWrites
        : DEFAULT_VERIFY_POLICY.blockEmptyWrites,
    maxConsecutiveBlocks: clampMaxConsecutiveBlocks(obj.maxConsecutiveBlocks),
    commands,
  };
}

function normalizeStringArray(raw: unknown, maxLen = 200): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() && !seen.has(item)) {
      seen.add(item);
      out.push(item);
      if (out.length >= maxLen) break;
    }
  }
  return out;
}

function normalizeSessionFromDisk(id: string, raw: unknown): VerifySessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const convId =
    typeof obj.conversationId === 'string' && obj.conversationId.trim()
      ? obj.conversationId.trim().slice(0, 120)
      : id;

  return {
    conversationId: convId,
    workspaceRoot: typeof obj.workspaceRoot === 'string' ? obj.workspaceRoot : undefined,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    lastEditAt: typeof obj.lastEditAt === 'string' ? obj.lastEditAt : undefined,
    lastVerifiedAt: typeof obj.lastVerifiedAt === 'string' ? obj.lastVerifiedAt : undefined,
    lastVerifiedPassed:
      typeof obj.lastVerifiedPassed === 'boolean' ? obj.lastVerifiedPassed : undefined,
    consecutiveBlocks:
      typeof obj.consecutiveBlocks === 'number' && Number.isFinite(obj.consecutiveBlocks)
        ? Math.max(0, Math.floor(obj.consecutiveBlocks))
        : 0,
    totalBlocks:
      typeof obj.totalBlocks === 'number' && Number.isFinite(obj.totalBlocks)
        ? Math.max(0, Math.floor(obj.totalBlocks))
        : 0,
    lastGuardrailReleaseAt:
      typeof obj.lastGuardrailReleaseAt === 'string' ? obj.lastGuardrailReleaseAt : undefined,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : nowIso,
  };
}

function normalizeCommandRunResultFromDisk(raw: unknown): VerifyCommandRunResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.commandId !== 'string' || typeof obj.executable !== 'string') return null;
  return {
    commandId: obj.commandId,
    label: typeof obj.label === 'string' ? obj.label : obj.commandId,
    executable: obj.executable,
    args: Array.isArray(obj.args) ? obj.args.filter((a): a is string => typeof a === 'string') : [],
    passed: Boolean(obj.passed),
    exitCode: typeof obj.exitCode === 'number' && Number.isFinite(obj.exitCode) ? obj.exitCode : null,
    timedOut: Boolean(obj.timedOut),
    durationMs:
      typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
        ? Math.max(0, Math.round(obj.durationMs))
        : 0,
    outputTail: typeof obj.outputTail === 'string' ? redactVerifyOutput(obj.outputTail) : '',
    outputTruncated: Boolean(obj.outputTruncated),
    error: typeof obj.error === 'string' ? redactVerifyOutput(obj.error) : undefined,
  };
}

function normalizeEvidenceFromDisk(raw: unknown): VerifyEvidenceRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.timestamp !== 'string') return null;
  const trigger: VerifyTrigger =
    obj.trigger === 'manual' || obj.trigger === 'stop-hook' || obj.trigger === 'app-ui'
      ? obj.trigger
      : 'manual';
  const outcome: VerifyOutcome =
    obj.outcome === 'pass' ||
    obj.outcome === 'fail' ||
    obj.outcome === 'blocked' ||
    obj.outcome === 'guardrail-allow'
      ? obj.outcome
      : obj.passed
        ? 'pass'
        : 'fail';

  const results: VerifyCommandRunResult[] = [];
  if (Array.isArray(obj.results)) {
    for (const r of obj.results) {
      const norm = normalizeCommandRunResultFromDisk(r);
      if (norm) results.push(norm);
    }
  }

  const targetBranch =
    typeof obj.targetBranch === 'string' && obj.targetBranch.trim()
      ? redactVerifyOutput(obj.targetBranch.trim()).slice(0, 160)
      : undefined;
  const targetWorktree =
    typeof obj.targetWorktree === 'string' && obj.targetWorktree.trim()
      ? redactVerifyOutput(obj.targetWorktree.trim()).slice(0, 512)
      : undefined;

  return {
    id: obj.id,
    conversationId: typeof obj.conversationId === 'string' ? obj.conversationId : 'default-session',
    trigger,
    outcome,
    passed: Boolean(obj.passed),
    timestamp: obj.timestamp,
    durationMs:
      typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
        ? Math.max(0, Math.round(obj.durationMs))
        : 0,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    results,
    summary: typeof obj.summary === 'string' ? redactVerifyOutput(obj.summary) : '',
    reason: typeof obj.reason === 'string' ? redactVerifyOutput(obj.reason) : undefined,
    ...(targetBranch ? { targetBranch } : {}),
    ...(targetWorktree ? { targetWorktree } : {}),
  };
}

/**
 * Pure read-only load. Never creates directories or writes to disk.
 */
export function loadVerifyStateReadOnly(moduleDataDir: string): VerifyStateFile {
  const statePath = getVerifyStatePath(moduleDataDir);
  if (!fs.existsSync(statePath)) {
    return createDefaultVerifyState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    const policy = normalizePolicyFromDisk(raw.policy);
    const sessions: Record<string, VerifySessionRecord> = {};
    if (raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
      for (const [id, rec] of Object.entries(raw.sessions as Record<string, unknown>)) {
        const norm = normalizeSessionFromDisk(id, rec);
        if (norm) sessions[norm.conversationId] = norm;
      }
    }
    const evidence: VerifyEvidenceRecord[] = [];
    if (Array.isArray(raw.evidence)) {
      for (const item of raw.evidence.slice(0, MAX_STORED_EVIDENCE)) {
        const norm = normalizeEvidenceFromDisk(item);
        if (norm) evidence.push(norm);
      }
    }
    const blockedStops =
      typeof raw.blockedStops === 'number' && Number.isFinite(raw.blockedStops)
        ? Math.max(0, Math.floor(raw.blockedStops))
        : evidence.filter((e) => e.outcome === 'blocked').length;

    return {
      schemaVersion: 1,
      policy,
      sessions,
      evidence,
      blockedStops,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return createDefaultVerifyState();
  }
}

export function saveVerifyState(moduleDataDir: string, state: VerifyStateFile): VerifyStateFile {
  const sortedSessions = Object.values(state.sessions)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_STORED_SESSIONS);
  const prunedSessions: Record<string, VerifySessionRecord> = {};
  for (const s of sortedSessions) {
    prunedSessions[s.conversationId] = s;
  }

  const next: VerifyStateFile = {
    schemaVersion: 1,
    policy: normalizePolicyFromDisk(state.policy),
    sessions: prunedSessions,
    evidence: state.evidence.slice(0, MAX_STORED_EVIDENCE),
    blockedStops: Math.max(0, Math.floor(state.blockedStops)),
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(getVerifyStatePath(moduleDataDir), next);
  return next;
}

export function computeVerifyStats(state: VerifyStateFile): VerifyStats {
  let passedRuns = 0;
  let failedRuns = 0;
  let blockedInEvidence = 0;
  for (const rec of state.evidence) {
    if (rec.passed) passedRuns += 1;
    else failedRuns += 1;
    if (rec.outcome === 'blocked') blockedInEvidence += 1;
  }
  return {
    totalRuns: state.evidence.length,
    passedRuns,
    failedRuns,
    blockedStops: Math.max(state.blockedStops, blockedInEvidence),
  };
}

export function buildVerifyStateView(
  state: VerifyStateFile,
  mode: 'live' | 'demo' = 'live',
): VerifyStateView {
  const sessions = Object.values(state.sessions)
    .map((s) => ({
      ...s,
      dirtyFiles: [...s.dirtyFiles],
      emptyFiles: [...s.emptyFiles],
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return {
    mode,
    policy: {
      ...state.policy,
      commands: state.policy.commands.map((c) => ({ ...c, args: [...c.args] })),
    },
    sessions,
    evidence: state.evidence.map((e) => ({
      ...e,
      dirtyFiles: [...e.dirtyFiles],
      emptyFiles: [...e.emptyFiles],
      results: e.results.map((r) => ({ ...r, args: [...r.args] })),
    })),
    stats: computeVerifyStats(state),
    updatedAt: state.updatedAt,
  };
}

export function resolveRealPathWithMissingTail(inputPath: string, depth = 0): string {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(`Too many levels of symbolic links: ${inputPath}`);
  }
  const resolved = path.resolve(inputPath);
  const missingSegments: string[] = [];
  let current = resolved;

  while (true) {
    try {
      const realBase = fs.realpathSync(current);
      return missingSegments.length > 0
        ? path.join(realBase, ...missingSegments.reverse())
        : realBase;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw err;
      }

      try {
        const lstat = fs.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(current);
          const resolvedLink = path.resolve(path.dirname(current), linkTarget);
          const nextTarget =
            missingSegments.length > 0
              ? path.join(resolvedLink, ...missingSegments.reverse())
              : resolvedLink;
          return resolveRealPathWithMissingTail(nextTarget, depth + 1);
        }
      } catch {
        // Entry itself does not exist; continue walking to nearest existing parent
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

export interface WorkspaceFileCheck {
  inside: boolean;
  realRoot?: string;
  realTarget?: string;
  relPath?: string;
  exists?: boolean;
  isFile?: boolean;
  isEmpty?: boolean;
}

/**
 * Resolve a target path against workspaceRoot via realpath and inspect emptiness safely.
 * Returns `{ inside: false }` for any path escaping workspaceRoot or unresolvable symlink loops.
 */
export function inspectWorkspaceFile(
  workspaceRoot: string | undefined,
  targetPath: string,
): WorkspaceFileCheck {
  if (!workspaceRoot || workspaceRoot.includes('\0') || !targetPath || targetPath.includes('\0')) {
    return { inside: false };
  }
  try {
    const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
    const candidate = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(workspaceRoot, targetPath);
    const realTarget = resolveRealPathWithMissingTail(candidate);

    const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
    if (realTarget !== realRoot && !realTarget.startsWith(rootPrefix)) {
      return { inside: false };
    }
    if (realTarget === realRoot) {
      return { inside: false };
    }

    const relPath = path.relative(realRoot, realTarget).split(path.sep).join('/');
    if (!relPath || relPath === '.' || relPath.startsWith('../')) {
      return { inside: false };
    }

    let exists = false;
    let isFile = false;
    let isEmpty = false;
    try {
      const stat = fs.statSync(realTarget);
      exists = true;
      isFile = stat.isFile();
      isEmpty = isFile && stat.size === 0;
    } catch {
      exists = false;
    }

    return {
      inside: true,
      realRoot,
      realTarget,
      relPath,
      exists,
      isFile,
      isEmpty,
    };
  } catch {
    return { inside: false };
  }
}

/**
 * Re-scan workspace dirty/empty files and return only those currently inside workspace and 0 bytes.
 */
export function scanEmptyWorkspaceFiles(
  workspaceRoot: string | undefined,
  filePaths: Iterable<string>,
): string[] {
  if (!workspaceRoot) return [];
  const empty: string[] = [];
  const seen = new Set<string>();
  for (const rel of filePaths) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const check = inspectWorkspaceFile(workspaceRoot, rel);
    if (check.inside && check.exists && check.isFile && check.isEmpty && check.relPath) {
      empty.push(check.relPath);
    }
  }
  return empty;
}

function truncateTailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  const sliced = buf.subarray(buf.length - maxBytes);
  return { text: sliced.toString('utf8'), truncated: true };
}

function extractTailOutput(
  combinedRaw: string,
  alreadyTruncated = false,
): { outputTail: string; outputTruncated: boolean } {
  const capped = truncateTailBytes(combinedRaw, MAX_CAPTURE_BYTES);
  const redacted = redactVerifyOutput(capped.text);
  let outputTail = redacted;
  let outputTruncated = alreadyTruncated || capped.truncated;
  if (outputTail.length > MAX_STORED_OUTPUT_TAIL_CHARS) {
    outputTail = outputTail.slice(outputTail.length - MAX_STORED_OUTPUT_TAIL_CHARS);
    outputTruncated = true;
  }
  // Second pass guards against secret tokens partially exposed at a truncation boundary
  outputTail = redactVerifyOutput(outputTail).trim();
  return { outputTail, outputTruncated };
}

/**
 * Execute a single validated verification command strictly via child_process.spawn (shell: false).
 * Streams stdout+stderr into a bounded 64KB rolling tail buffer so verbose passing commands (3MB+)
 * are never killed by execFile maxBuffer, and terminates the entire POSIX process group on timeout.
 */
export function executeVerifyCommand(
  command: VerifyCommandSpec,
  workspaceRoot: string,
  options: { timeoutCapMs?: number } = {},
): Promise<VerifyCommandRunResult> {
  const validation = validateVerifyCommand(command);
  const startedAt = Date.now();
  if (!validation.valid || !validation.command) {
    return Promise.resolve({
      commandId: command.id,
      label: command.label,
      executable: command.executable,
      args: [...command.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      outputTail: '',
      outputTruncated: false,
      error: validation.error ?? 'Command rejected by verify allowlist.',
    });
  }

  const safeCmd = validation.command;
  const effectiveTimeoutMs = Math.max(
    MIN_COMMAND_TIMEOUT_MS,
    Math.min(
      safeCmd.timeoutMs,
      options.timeoutCapMs !== undefined
        ? Math.max(MIN_COMMAND_TIMEOUT_MS, Math.floor(options.timeoutCapMs))
        : MAX_COMMAND_TIMEOUT_MS,
    ),
  );

  let resolvedCwd: string;
  try {
    resolvedCwd = fs.realpathSync(path.resolve(workspaceRoot));
    if (!fs.statSync(resolvedCwd).isDirectory()) {
      throw new Error('Workspace root is not a directory.');
    }
  } catch (err) {
    return Promise.resolve({
      commandId: safeCmd.id,
      label: safeCmd.label,
      executable: safeCmd.executable,
      args: [...safeCmd.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      outputTail: '',
      outputTruncated: false,
      error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
    });
  }

  return new Promise<VerifyCommandRunResult>((resolve) => {
    const isPosix = process.platform !== 'win32';
    let settled = false;
    let timedOut = false;
    let streamTruncated = false;
    let bufferedBytes = 0;
    const chunks: Buffer[] = [];
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let hardKillTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanupTimers = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = null;
      }
    };

    const pushChunk = (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      if (buf.length === 0) return;
      if (buf.length >= MAX_CAPTURE_BYTES) {
        const tailCopy = Buffer.from(buf.subarray(buf.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
        return;
      }
      chunks.push(buf);
      bufferedBytes += buf.length;
      // Compact rolling tail buffer when accumulated size exceeds 2x the 64KB cap
      if (bufferedBytes > MAX_CAPTURE_BYTES * 2) {
        const merged = Buffer.concat(chunks, bufferedBytes);
        const tailCopy = Buffer.from(merged.subarray(merged.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
      }
    };

    const buildOutput = () => {
      const merged = chunks.length > 0 ? Buffer.concat(chunks, bufferedBytes) : Buffer.alloc(0);
      return extractTailOutput(merged.toString('utf8'), streamTruncated);
    };

    const finish = (result: VerifyCommandRunResult) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(safeCmd.executable, safeCmd.args, {
        cwd: resolvedCwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: isPosix,
      });
    } catch (err) {
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        outputTail: '',
        outputTruncated: false,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    const killProcessTree = (signal: NodeJS.Signals) => {
      if (isPosix && typeof child.pid === 'number' && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Process group may not exist or already exited; fall back to direct child kill
        }
      }
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    };

    const destroyPipes = () => {
      try {
        child.stdout?.destroy();
      } catch {
        // ignore
      }
      try {
        child.stderr?.destroy();
      } catch {
        // ignore
      }
    };

    child.stdout?.on('data', pushChunk);
    child.stderr?.on('data', pushChunk);
    child.stdout?.on('error', () => {
      // ignore stream errors during forced pipe teardown
    });
    child.stderr?.on('error', () => {
      // ignore stream errors during forced pipe teardown
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
      });
    });

    child.on('close', (code, signal) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      const exitCode = typeof code === 'number' ? code : null;

      if (!timedOut && exitCode === 0) {
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: true,
          exitCode: 0,
          timedOut: false,
          durationMs,
          outputTail,
          outputTruncated,
        });
        return;
      }

      const errMessage = timedOut
        ? `Command timed out after ${effectiveTimeoutMs}ms`
        : signal
          ? `Command terminated by signal ${signal}`
          : `Command exited with code ${exitCode ?? 'unknown'}`;

      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: errMessage,
      });
    });

    killTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree('SIGTERM');

      hardKillTimer = setTimeout(() => {
        if (settled) return;
        killProcessTree('SIGKILL');
        destroyPipes();
        try {
          child.unref();
        } catch {
          // ignore
        }
        const durationMs = Date.now() - startedAt;
        const { outputTail, outputTruncated } = buildOutput();
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs,
          outputTail,
          outputTruncated,
          error: `Command timed out after ${effectiveTimeoutMs}ms`,
        });
      }, 300);
      hardKillTimer.unref?.();
    }, effectiveTimeoutMs);
    killTimer.unref?.();
  });
}

export async function runVerifyCommands(
  commands: readonly VerifyCommandSpec[],
  workspaceRoot: string,
  options: {
    singleTimeoutCapMs?: number;
    totalBudgetMs?: number;
  } = {},
): Promise<{
  passed: boolean;
  results: VerifyCommandRunResult[];
  durationMs: number;
}> {
  const startedAt = Date.now();
  const results: VerifyCommandRunResult[] = [];
  const totalBudgetMs = options.totalBudgetMs;

  for (const cmd of commands) {
    let timeoutCapMs = options.singleTimeoutCapMs;
    if (totalBudgetMs !== undefined) {
      const elapsed = Date.now() - startedAt;
      const remaining = totalBudgetMs - elapsed;
      if (remaining < MIN_COMMAND_TIMEOUT_MS) {
        results.push({
          commandId: cmd.id,
          label: cmd.label,
          executable: cmd.executable,
          args: [...cmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs: 0,
          outputTail: '',
          outputTruncated: false,
          error: `Skipped: total verification time budget (${totalBudgetMs}ms) exhausted.`,
        });
        continue;
      }
      timeoutCapMs =
        timeoutCapMs !== undefined ? Math.min(timeoutCapMs, remaining) : remaining;
    }

    const res = await executeVerifyCommand(cmd, workspaceRoot, { timeoutCapMs });
    results.push(res);
  }

  return {
    passed: results.every((r) => r.passed),
    results,
    durationMs: Date.now() - startedAt,
  };
}

export function createEvidenceId(prefix = 'ver'): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function formatFailureTailSnippet(outputTail: string, maxLines = 4, maxChars = 280): string {
  const lines = redactVerifyOutput(outputTail)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const tail = lines.slice(-maxLines).join(' | ');
  return tail.length > maxChars ? `…${tail.slice(tail.length - (maxChars - 1))}` : tail;
}

export function appendEvidenceToState(
  state: VerifyStateFile,
  record: VerifyEvidenceRecord,
): void {
  state.evidence.unshift(record);
  if (state.evidence.length > MAX_STORED_EVIDENCE) {
    state.evidence = state.evidence.slice(0, MAX_STORED_EVIDENCE);
  }
  state.updatedAt = record.timestamp;
}

export function updateVerifyPolicy(
  moduleDataDir: string,
  patch: VerifyPolicyPatch,
): { valid: true; policy: VerifyPolicy; state: VerifyStateFile } | { valid: false; error: string } {
  const state = loadVerifyStateReadOnly(moduleDataDir);
  const validated = validateAndBuildPolicy(state.policy, patch);
  if (!validated.valid) {
    return validated;
  }
  state.policy = validated.policy;
  const saved = saveVerifyState(moduleDataDir, state);
  return { valid: true, policy: saved.policy, state: saved };
}

export function clearVerifyHistoryInState(state: VerifyStateFile): number {
  const cleared = state.evidence.length + Object.keys(state.sessions).length;
  state.evidence = [];
  state.sessions = {};
  state.blockedStops = 0;
  state.updatedAt = new Date().toISOString();
  return cleared;
}

export function clearVerifyHistory(
  moduleDataDir: string,
): { cleared: number; state: VerifyStateFile } {
  const statePath = getVerifyStatePath(moduleDataDir);
  const state = loadVerifyStateReadOnly(moduleDataDir);
  const cleared = clearVerifyHistoryInState(state);
  if (cleared === 0 && !fs.existsSync(statePath)) {
    return { cleared: 0, state };
  }
  const saved = saveVerifyState(moduleDataDir, state);
  return { cleared, state: saved };
}

export interface VerifyWorktreeOption {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface VerifyTargetResolution {
  targetRoot: string;
  isWorktree: boolean;
  branch?: string;
  worktreePath?: string;
}

function runReadOnlyGitForVerify(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function parseVerifyWorktreePorcelain(
  output: string,
): Array<{ rawPath: string; branch: string | null; isMain: boolean; bare: boolean }> {
  const entries: Array<{ rawPath: string; branch: string | null; isMain: boolean; bare: boolean }> = [];
  let current: { rawPath?: string; branch: string | null; bare: boolean } | null = null;

  const flush = () => {
    if (!current || !current.rawPath) return;
    entries.push({
      rawPath: current.rawPath,
      branch: current.branch,
      isMain: entries.length === 0,
      bare: current.bare,
    });
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { rawPath: line.slice('worktree '.length), branch: null, bare: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.branch = null;
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  flush();
  return entries;
}

/**
 * Pure read-only discovery of active registered Git worktrees belonging to `mainWorkspaceRoot`.
 */
export function listVerifyWorktreesReadOnly(mainWorkspaceRoot: string): VerifyWorktreeOption[] {
  if (!mainWorkspaceRoot || typeof mainWorkspaceRoot !== 'string' || mainWorkspaceRoot.includes('\0')) {
    return [];
  }
  let mainReal: string;
  try {
    mainReal = fs.realpathSync(path.resolve(mainWorkspaceRoot));
    if (!fs.statSync(mainReal).isDirectory()) return [];
  } catch {
    return [];
  }

  const topRes = runReadOnlyGitForVerify(mainReal, ['rev-parse', '--show-toplevel']);
  if (!topRes.ok || !topRes.stdout.trim()) return [];

  let topReal: string;
  try {
    topReal = fs.realpathSync(path.resolve(topRes.stdout.trim()));
  } catch {
    return [];
  }

  const listRes = runReadOnlyGitForVerify(topReal, ['worktree', 'list', '--porcelain']);
  if (!listRes.ok) return [];

  const parsed = parseVerifyWorktreePorcelain(listRes.stdout);
  const out: VerifyWorktreeOption[] = [];
  for (const item of parsed) {
    if (item.bare) continue;
    try {
      const resolved = path.resolve(item.rawPath);
      if (!fs.statSync(resolved).isDirectory()) continue;
      const realPath = fs.realpathSync(resolved);
      out.push({
        path: realPath,
        branch: item.branch,
        isMain: item.isMain,
      });
    } catch {
      // Skip non-existent or inaccessible prunable entries
    }
  }
  return out;
}

function detectGitBranchReadOnly(cwd: string): string | undefined {
  const sym = runReadOnlyGitForVerify(cwd, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.ok && sym.stdout.trim()) {
    return sym.stdout.trim();
  }
  const sha = runReadOnlyGitForVerify(cwd, ['rev-parse', '--short', 'HEAD']);
  if (sha.ok && sha.stdout.trim()) {
    return `detached@${sha.stdout.trim()}`;
  }
  return undefined;
}

/**
 * Resolve and authorize the target execution directory for Verify Gate checks.
 * - When `worktreePath` is omitted, returns the canonicalized `mainWorkspaceRoot`.
 * - When `worktreePath` is provided, verifies it is not a symlink leaf and strictly matches
 *   either `mainWorkspaceRoot` or an active Git worktree listed by `git worktree list --porcelain`
 *   for `mainWorkspaceRoot` (with matching `realpathSync`). Refuses all arbitrary external paths.
 */
export function resolveAllowedVerifyTargetRoot(
  mainWorkspaceRoot: string,
  worktreePath?: string,
): VerifyTargetResolution {
  if (!mainWorkspaceRoot || typeof mainWorkspaceRoot !== 'string' || mainWorkspaceRoot.includes('\0')) {
    throw new Error('Invalid mainWorkspaceRoot: must be a non-empty path without NUL bytes.');
  }

  let mainRealRoot: string;
  try {
    mainRealRoot = fs.realpathSync(path.resolve(mainWorkspaceRoot));
    if (!fs.statSync(mainRealRoot).isDirectory()) {
      throw new Error('Workspace root is not a directory.');
    }
  } catch (err) {
    throw new Error(
      `Invalid workspaceRoot "${mainWorkspaceRoot}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (worktreePath === undefined || worktreePath.trim() === '') {
    const branch = detectGitBranchReadOnly(mainRealRoot);
    return {
      targetRoot: mainRealRoot,
      isWorktree: false,
      ...(branch ? { branch } : {}),
    };
  }

  const trimmed = worktreePath.trim();
  if (trimmed.includes('\0')) {
    throw new Error('Invalid worktreePath: NUL byte is disallowed.');
  }

  const resolvedCandidate = path.resolve(trimmed);
  let candidateLstat: fs.Stats;
  try {
    candidateLstat = fs.lstatSync(resolvedCandidate);
  } catch {
    throw new Error(`Verify target worktree does not exist or is inaccessible: ${trimmed}`);
  }
  if (candidateLstat.isSymbolicLink()) {
    throw new Error(`Refused: verify target worktree "${trimmed}" must not be a symbolic link.`);
  }
  if (!candidateLstat.isDirectory()) {
    throw new Error(`Refused: verify target worktree "${trimmed}" is not a directory.`);
  }

  const realCandidate = fs.realpathSync(resolvedCandidate);
  const worktrees = listVerifyWorktreesReadOnly(mainRealRoot);

  if (realCandidate === mainRealRoot) {
    const matchedMain = worktrees.find((w) => w.path === mainRealRoot);
    const branch = matchedMain?.branch ?? detectGitBranchReadOnly(mainRealRoot);
    return {
      targetRoot: mainRealRoot,
      isWorktree: false,
      ...(branch ? { branch } : {}),
      worktreePath: mainRealRoot,
    };
  }

  const matched = worktrees.find((w) => w.path === realCandidate);
  if (!matched) {
    throw new Error(
      `Refused: "${trimmed}" is not the workspace root or a registered Git worktree for this repository.`,
    );
  }

  const branch = matched.branch ?? detectGitBranchReadOnly(matched.path);
  return {
    targetRoot: matched.path,
    isWorktree: !matched.isMain,
    ...(branch ? { branch } : {}),
    worktreePath: matched.path,
  };
}

export async function runVerifyChecksLive(
  moduleDataDir: string,
  workspaceRoot: string,
  options: {
    commandId?: string;
    conversationId?: string;
    trigger?: VerifyTrigger;
    worktreePath?: string;
  } = {},
): Promise<
  | { ok: true; run: VerifyEvidenceRecord; state: VerifyStateFile }
  | { ok: false; error: string }
> {
  let targetResolution: VerifyTargetResolution;
  try {
    targetResolution = resolveAllowedVerifyTargetRoot(workspaceRoot, options.worktreePath);
  } catch (err) {
    return {
      ok: false,
      error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
    };
  }

  const executionRoot = targetResolution.targetRoot;
  const initialState = loadVerifyStateReadOnly(moduleDataDir);
  let targetCommands: VerifyCommandSpec[];

  if (options.commandId) {
    const match = initialState.policy.commands.find((c) => c.id === options.commandId);
    if (!match) {
      return { ok: false, error: `Verify command not found: "${options.commandId}".` };
    }
    targetCommands = [match];
  } else {
    targetCommands = initialState.policy.commands.filter((c) => c.enabled);
  }

  // Track each session's pre-run lastEditAt so concurrent edits are never marked stale-verified
  const initialLastEditAt = new Map<string, string | undefined>();
  for (const [id, sess] of Object.entries(initialState.sessions)) {
    initialLastEditAt.set(id, sess.lastEditAt);
  }

  const runOut = await runVerifyCommands(targetCommands, executionRoot);
  const nowIso = new Date().toISOString();
  const convId = options.conversationId?.trim() || 'manual';

  // Reload latest state from disk before persisting so concurrent session/policy updates are preserved
  const state = loadVerifyStateReadOnly(moduleDataDir);

  let realWorkspace: string | undefined;
  try {
    realWorkspace = resolveRealPathWithMissingTail(executionRoot);
  } catch {
    realWorkspace = undefined;
  }

  // Update matching session verification timestamps when running full check suite or targeted session
  const targetSessions: VerifySessionRecord[] = [];
  if (options.conversationId && state.sessions[convId]) {
    targetSessions.push(state.sessions[convId]);
  } else if (!options.commandId) {
    for (const s of Object.values(state.sessions)) {
      if (s.dirtyFiles.length === 0 && s.emptyFiles.length === 0) continue;
      if (!s.workspaceRoot || !realWorkspace) {
        targetSessions.push(s);
      } else {
        try {
          if (resolveRealPathWithMissingTail(s.workspaceRoot) === realWorkspace) {
            targetSessions.push(s);
          }
        } catch {
          // ignore unresolvable workspace
        }
      }
    }
  }

  const dirtyFilesSet = new Set<string>();
  const emptyFilesSet = new Set<string>();
  for (const s of targetSessions) {
    const curEmpty = scanEmptyWorkspaceFiles(s.workspaceRoot ?? executionRoot, [
      ...s.dirtyFiles,
      ...s.emptyFiles,
    ]);
    s.emptyFiles = curEmpty;
    for (const f of s.dirtyFiles) dirtyFilesSet.add(f);
    for (const f of curEmpty) emptyFilesSet.add(f);

    const editedDuringRun =
      !initialLastEditAt.has(s.conversationId) ||
      initialLastEditAt.get(s.conversationId) !== s.lastEditAt;

    if (!options.commandId && !editedDuringRun) {
      const lastEditMs = s.lastEditAt ? Date.parse(s.lastEditAt) : Number.NaN;
      const verifiedTs =
        Number.isFinite(lastEditMs) && Date.parse(nowIso) <= lastEditMs
          ? new Date(lastEditMs + 1).toISOString()
          : nowIso;

      s.lastVerifiedAt = verifiedTs;
      s.lastVerifiedPassed = runOut.passed && curEmpty.length === 0;
      if (s.lastVerifiedPassed) {
        s.consecutiveBlocks = 0;
      }
      s.updatedAt = verifiedTs;
    }
  }

  const passedCount = runOut.results.filter((r) => r.passed).length;
  const summary =
    runOut.results.length === 0
      ? 'No enabled verification commands configured; check passed.'
      : runOut.passed
        ? `All ${runOut.results.length} verification command(s) passed in ${runOut.durationMs}ms.`
        : `${runOut.results.length - passedCount}/${runOut.results.length} verification command(s) failed.`;

  const record: VerifyEvidenceRecord = {
    id: createEvidenceId('ver'),
    conversationId: convId,
    trigger: options.trigger ?? 'manual',
    outcome: runOut.passed ? 'pass' : 'fail',
    passed: runOut.passed,
    timestamp: nowIso,
    durationMs: runOut.durationMs,
    dirtyFiles: [...dirtyFilesSet],
    emptyFiles: [...emptyFilesSet],
    results: runOut.results,
    summary,
    ...(targetResolution.branch ? { targetBranch: targetResolution.branch } : {}),
    ...(options.worktreePath || targetResolution.isWorktree
      ? { targetWorktree: executionRoot }
      : {}),
  };

  appendEvidenceToState(state, record);
  const saved = saveVerifyState(moduleDataDir, state);
  return { ok: true, run: record, state: saved };
}

/**
 * Rich synthetic demo state (PASS / BLOCKED / PASS) kept strictly in memory with zero disk writes.
 */
export function createDemoVerifyState(nowMs = Date.now()): VerifyStateFile {
  const isoAgo = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();

  return {
    schemaVersion: 1,
    policy: {
      enforceOnStop: true,
      autoRunOnStop: true,
      blockEmptyWrites: true,
      maxConsecutiveBlocks: 3,
      commands: [
        {
          id: 'typecheck',
          label: 'TypeScript Typecheck',
          executable: 'npm',
          args: ['run', 'typecheck'],
          timeoutMs: 15_000,
          enabled: true,
        },
        {
          id: 'unit-tests',
          label: 'Offline Unit Tests',
          executable: 'npm',
          args: ['test'],
          timeoutMs: 30_000,
          enabled: true,
        },
        {
          id: 'git-status',
          label: 'Git Working Tree Check',
          executable: 'git',
          args: ['status', '--short'],
          timeoutMs: 5_000,
          enabled: true,
        },
      ],
    },
    sessions: {
      'conv-verify-demo-1': {
        conversationId: 'conv-verify-demo-1',
        workspaceRoot: '/demo/agy-NOV',
        dirtyFiles: [],
        emptyFiles: [],
        lastEditAt: isoAgo(5),
        lastVerifiedAt: isoAgo(2),
        lastVerifiedPassed: true,
        consecutiveBlocks: 0,
        totalBlocks: 1,
        updatedAt: isoAgo(2),
      },
    },
    evidence: [
      {
        id: 'ver-demo-3',
        conversationId: 'conv-verify-demo-1',
        trigger: 'stop-hook',
        outcome: 'pass',
        passed: true,
        timestamp: isoAgo(2),
        durationMs: 1840,
        dirtyFiles: ['src/modules/verify/core.ts', 'src/modules/verify/hook.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 920,
            outputTail: 'tsc --noEmit completed with 0 errors.',
            outputTruncated: false,
          },
          {
            commandId: 'unit-tests',
            label: 'Offline Unit Tests',
            executable: 'npm',
            args: ['test'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 920,
            outputTail: 'pass 12 | fail 0 | duration 880ms',
            outputTruncated: false,
          },
        ],
        summary: 'All 2 verification command(s) passed after fix; stop allowed.',
      },
      {
        id: 'ver-demo-2',
        conversationId: 'conv-verify-demo-1',
        trigger: 'stop-hook',
        outcome: 'blocked',
        passed: false,
        timestamp: isoAgo(6),
        durationMs: 1120,
        dirtyFiles: ['src/modules/verify/hook.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: false,
            exitCode: 2,
            timedOut: false,
            durationMs: 1120,
            outputTail:
              "src/modules/verify/hook.ts(42,14): error TS2322: Type 'string' is not assignable to type 'number'.",
            outputTruncated: false,
            error: 'Command exited with code 2',
          },
        ],
        summary: '1/1 verification command(s) failed; Stop blocked pending fix.',
        reason:
          '[agy-NOV Verify Gate] Blocked stop: TypeScript Typecheck exited with code 2 (TS2322).',
      },
      {
        id: 'ver-demo-1',
        conversationId: 'conv-verify-demo-1',
        trigger: 'manual',
        outcome: 'pass',
        passed: true,
        timestamp: isoAgo(18),
        durationMs: 760,
        dirtyFiles: ['src/core/catalog.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 760,
            outputTail: 'tsc --noEmit completed cleanly.',
            outputTruncated: false,
          },
        ],
        summary: 'Baseline typecheck passed cleanly.',
      },
    ],
    blockedStops: 1,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export interface DetectedVerifyCommand {
  id: string;
  label: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  reason: string;
}

export interface DetectedWorkspaceVerifyResult {
  detectedStacks: string[];
  recommendations: DetectedVerifyCommand[];
}

const MAX_DETECT_FILE_BYTES = 256 * 1024;

const COMMON_NODE_VERIFY_SCRIPTS: ReadonlyArray<{
  script: string;
  label: string;
  timeoutMs: number;
}> = [
  { script: 'typecheck', label: 'Typecheck', timeoutMs: 20_000 },
  { script: 'type-check', label: 'Type Check', timeoutMs: 20_000 },
  { script: 'check', label: 'Check', timeoutMs: 20_000 },
  { script: 'lint', label: 'Lint', timeoutMs: 20_000 },
  { script: 'test', label: 'Tests', timeoutMs: 30_000 },
];

function resolveTopLevelWorkspaceFile(
  realRoot: string,
  rootPrefix: string,
  fileName: string,
): { realTarget: string; size: number } | null {
  if (
    !fileName ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..') ||
    fileName.includes('\0')
  ) {
    return null;
  }
  const candidate = path.join(realRoot, fileName);
  try {
    fs.lstatSync(candidate);
    const realTarget = fs.realpathSync(candidate);
    if (!realTarget.startsWith(rootPrefix)) {
      return null;
    }
    const stat = fs.statSync(realTarget);
    if (!stat.isFile()) {
      return null;
    }
    return { realTarget, size: stat.size };
  } catch {
    return null;
  }
}

function readTopLevelWorkspaceFile(
  realRoot: string,
  rootPrefix: string,
  fileName: string,
  maxBytes = MAX_DETECT_FILE_BYTES,
): string | null {
  const resolved = resolveTopLevelWorkspaceFile(realRoot, rootPrefix, fileName);
  if (!resolved) return null;
  const readLen = Math.min(resolved.size, maxBytes);
  const buf = Buffer.alloc(readLen);
  try {
    const fd = fs.openSync(resolved.realTarget, 'r');
    try {
      if (readLen > 0) {
        fs.readSync(fd, buf, 0, readLen, 0);
      }
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Pure read-only project stack detector for Verify Gate.
 * Inspects only top-level workspace manifests inside workspaceRoot (realpath-confined)
 * and passes every candidate through validateVerifyCommand() before returning.
 */
export function detectWorkspaceVerifyCommands(
  workspaceRoot: string,
): DetectedWorkspaceVerifyResult {
  if (!workspaceRoot || typeof workspaceRoot !== 'string' || workspaceRoot.includes('\0')) {
    return { detectedStacks: [], recommendations: [] };
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(workspaceRoot));
    if (!fs.statSync(realRoot).isDirectory()) {
      return { detectedStacks: [], recommendations: [] };
    }
  } catch {
    return { detectedStacks: [], recommendations: [] };
  }

  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  const stacks: string[] = [];
  const stackSet = new Set<string>();
  const recommendations: DetectedVerifyCommand[] = [];
  const seenIds = new Set<string>();

  const addStack = (name: string) => {
    if (!stackSet.has(name)) {
      stackSet.add(name);
      stacks.push(name);
    }
  };

  const pushValidated = (candidate: DetectedVerifyCommand) => {
    const checked = validateVerifyCommand({
      id: candidate.id,
      label: candidate.label,
      executable: candidate.executable,
      args: candidate.args,
      timeoutMs: candidate.timeoutMs,
      enabled: true,
    });
    if (!checked.valid || !checked.command) return;
    if (seenIds.has(checked.command.id)) return;
    seenIds.add(checked.command.id);
    recommendations.push({
      id: checked.command.id,
      label: checked.command.label,
      executable: checked.command.executable,
      args: [...checked.command.args],
      timeoutMs: checked.command.timeoutMs,
      reason: candidate.reason,
    });
  };

  // 1. Node / TypeScript (package.json)
  const pkgRaw = readTopLevelWorkspaceFile(realRoot, rootPrefix, 'package.json');
  if (pkgRaw !== null) {
    addStack('node');
    let pm: 'pnpm' | 'yarn' | 'bun' | 'npm' = 'npm';
    if (resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'pnpm-lock.yaml')) {
      pm = 'pnpm';
    } else if (resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'yarn.lock')) {
      pm = 'yarn';
    } else if (
      resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'bun.lock') ||
      resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'bun.lockb')
    ) {
      pm = 'bun';
    }

    const hasTsConfig = Boolean(resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'tsconfig.json'));
    if (hasTsConfig) {
      addStack('typescript');
    }

    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const deps =
        pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)
          ? (pkg.dependencies as Record<string, unknown>)
          : null;
      const devDeps =
        pkg.devDependencies &&
        typeof pkg.devDependencies === 'object' &&
        !Array.isArray(pkg.devDependencies)
          ? (pkg.devDependencies as Record<string, unknown>)
          : null;
      if (deps?.typescript || devDeps?.typescript) {
        addStack('typescript');
      }

      if (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) {
        const scripts = pkg.scripts as Record<string, unknown>;
        for (const item of COMMON_NODE_VERIFY_SCRIPTS) {
          if (!Object.prototype.hasOwnProperty.call(scripts, item.script)) continue;
          const scriptVal = scripts[item.script];
          if (typeof scriptVal !== 'string' || !scriptVal.trim()) continue;
          pushValidated({
            id: `node-${item.script}`,
            label: `${item.label} (${pm})`,
            executable: pm,
            args: item.script === 'test' ? ['test'] : ['run', item.script],
            timeoutMs: item.timeoutMs,
            reason: `Detected "${item.script}" script in package.json (${pm})`,
          });
        }
      }
    } catch {
      // Malformed package.json: skip scripts safely with zero writes
    }
  }

  // 2. Python (pyproject.toml / pytest.ini)
  const pyprojectRaw = readTopLevelWorkspaceFile(realRoot, rootPrefix, 'pyproject.toml');
  const hasPytestIni = Boolean(resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'pytest.ini'));
  if (pyprojectRaw !== null || hasPytestIni) {
    addStack('python');
    pushValidated({
      id: 'python-pytest',
      label: 'Python Pytest',
      executable: 'python3',
      args: ['-m', 'pytest'],
      timeoutMs: 30_000,
      reason: pyprojectRaw !== null ? 'Detected pyproject.toml' : 'Detected pytest.ini',
    });

    const hasRuff =
      (pyprojectRaw !== null && /\bruff\b/i.test(pyprojectRaw)) ||
      Boolean(resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'ruff.toml')) ||
      Boolean(resolveTopLevelWorkspaceFile(realRoot, rootPrefix, '.ruff.toml'));
    if (hasRuff) {
      pushValidated({
        id: 'python-ruff',
        label: 'Python Ruff Check',
        executable: 'ruff',
        args: ['check', '.'],
        timeoutMs: 15_000,
        reason: 'Detected ruff configuration in Python project',
      });
    }
  }

  // 3. Rust (Cargo.toml)
  if (resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'Cargo.toml')) {
    addStack('rust');
    pushValidated({
      id: 'rust-check',
      label: 'Cargo Check',
      executable: 'cargo',
      args: ['check'],
      timeoutMs: 30_000,
      reason: 'Detected Cargo.toml',
    });
    pushValidated({
      id: 'rust-test',
      label: 'Cargo Test',
      executable: 'cargo',
      args: ['test'],
      timeoutMs: 45_000,
      reason: 'Detected Cargo.toml',
    });
  }

  // 4. Go (go.mod)
  if (resolveTopLevelWorkspaceFile(realRoot, rootPrefix, 'go.mod')) {
    addStack('go');
    pushValidated({
      id: 'go-vet',
      label: 'Go Vet',
      executable: 'go',
      args: ['vet', './...'],
      timeoutMs: 20_000,
      reason: 'Detected go.mod',
    });
    pushValidated({
      id: 'go-test',
      label: 'Go Test',
      executable: 'go',
      args: ['test', './...'],
      timeoutMs: 45_000,
      reason: 'Detected go.mod',
    });
  }

  return {
    detectedStacks: stacks,
    recommendations,
  };
}

/**
 * Pure in-memory synthetic stack detection for demoMode (zero disk reads/writes).
 */
export function createDemoVerifyDetection(): DetectedWorkspaceVerifyResult {
  const candidates: DetectedVerifyCommand[] = [
    {
      id: 'node-typecheck',
      label: 'Typecheck (npm)',
      executable: 'npm',
      args: ['run', 'typecheck'],
      timeoutMs: 20_000,
      reason: '[demo] Detected "typecheck" script in package.json (npm)',
    },
    {
      id: 'node-lint',
      label: 'Lint (npm)',
      executable: 'npm',
      args: ['run', 'lint'],
      timeoutMs: 20_000,
      reason: '[demo] Detected "lint" script in package.json (npm)',
    },
    {
      id: 'node-test',
      label: 'Tests (npm)',
      executable: 'npm',
      args: ['test'],
      timeoutMs: 30_000,
      reason: '[demo] Detected "test" script in package.json (npm)',
    },
  ];
  const recommendations: DetectedVerifyCommand[] = [];
  for (const item of candidates) {
    const checked = validateVerifyCommand({ ...item, enabled: true });
    if (checked.valid && checked.command) {
      recommendations.push({
        id: checked.command.id,
        label: checked.command.label,
        executable: checked.command.executable,
        args: [...checked.command.args],
        timeoutMs: checked.command.timeoutMs,
        reason: item.reason,
      });
    }
  }
  return {
    detectedStacks: ['node', 'typescript'],
    recommendations,
  };
}

export interface PrDeliverySpecSummary {
  specId: string;
  title: string;
  status: string;
  mode?: string;
  totalTasks: number;
  doneTasks: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

export interface BuildPrDeliverySummaryOptions {
  workspaceRoot?: string;
  worktreePath?: string;
  branch?: string;
  specSummary?: PrDeliverySpecSummary | null;
  mode?: 'live' | 'demo';
  evidenceId?: string;
}

export interface PrDeliverySummaryResult {
  mode: 'live' | 'demo';
  markdown: string;
  passed: boolean;
  branch?: string;
  worktreePath?: string;
  evidenceId?: string;
  specId?: string;
  checksTotal: number;
  checksPassed: number;
}

const MAX_PR_SPEC_STATE_BYTES = 2 * 1024 * 1024; // 2 MiB read guard

/**
 * Pure read-only Spec loader for PR delivery evidence summary.
 * Never creates directories or writes to disk; returns null when absent or invalid.
 */
export function loadSpecSummaryForPrReadOnly(rootDataDir: string): PrDeliverySpecSummary | null {
  if (!rootDataDir || typeof rootDataDir !== 'string' || rootDataDir.includes('\0')) {
    return null;
  }
  const specStatePath = path.join(getModuleDataDir(rootDataDir, 'spec'), 'state.json');
  let st: fs.Stats;
  try {
    st = fs.lstatSync(specStatePath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_PR_SPEC_STATE_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(specStatePath, fs.constants.O_RDONLY | noFollow);
    let raw = '';
    try {
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.size > MAX_PR_SPEC_STATE_BYTES) return null;
      const buf = Buffer.alloc(fdStat.size);
      let offset = 0;
      while (offset < fdStat.size) {
        const n = fs.readSync(fd, buf, offset, fdStat.size - offset, offset);
        if (n <= 0) break;
        offset += n;
      }
      raw = buf.subarray(0, offset).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const activeSpecId = typeof obj.activeSpecId === 'string' ? obj.activeSpecId.trim() : '';
  if (!activeSpecId || !Array.isArray(obj.specs)) return null;

  const matched = obj.specs.find(
    (s): s is Record<string, unknown> =>
      Boolean(s && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).id === activeSpecId),
  );
  if (!matched) return null;

  const specId = typeof matched.id === 'string' ? matched.id : activeSpecId;
  const title = redactVerifyOutput(
    typeof matched.title === 'string' && matched.title.trim() ? matched.title.trim() : specId,
  ).slice(0, 180);
  const status = typeof matched.status === 'string' && matched.status.trim() ? matched.status.trim() : 'draft';
  const mode = typeof matched.mode === 'string' && matched.mode.trim() ? matched.mode.trim() : undefined;

  const rawTasks = Array.isArray(matched.tasks) ? matched.tasks : [];
  const tasks: Array<{ id: string; title: string; status: string }> = [];
  for (const rawTask of rawTasks.slice(0, 100)) {
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
    const t = rawTask as Record<string, unknown>;
    const taskId = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : `t-${tasks.length + 1}`;
    const taskTitle = redactVerifyOutput(
      typeof t.title === 'string' && t.title.trim() ? t.title.trim() : taskId,
    ).slice(0, 200);
    const taskStatus =
      typeof t.status === 'string' && t.status.trim() ? t.status.trim() : 'pending';
    tasks.push({ id: taskId, title: taskTitle, status: taskStatus });
  }

  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  return {
    specId,
    title,
    status,
    ...(mode ? { mode } : {}),
    totalTasks: tasks.length,
    doneTasks,
    tasks,
  };
}

export function createDemoSpecSummaryForPr(): PrDeliverySpecSummary {
  const tasks = [
    { id: 't1', title: 'Configure allowlisted typecheck and unit test commands', status: 'done' },
    { id: 't2', title: 'Enforce Stop-hook verification gate with anti-loop guardrail', status: 'done' },
    { id: 't3', title: 'Generate redacted PR delivery evidence summary', status: 'done' },
  ];
  return {
    specId: 'spec-verify-pipeline',
    title: 'Verify Gate & PR Evidence Pipeline',
    status: 'approved',
    mode: 'full',
    totalTasks: tasks.length,
    doneTasks: tasks.length,
    tasks,
  };
}

function formatSafeWorktreeLabel(
  worktreePath: string | undefined,
  workspaceRoot: string | undefined,
): string | undefined {
  if (!worktreePath || !worktreePath.trim()) return undefined;
  if (workspaceRoot && workspaceRoot.trim()) {
    try {
      const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
      const realWt = resolveRealPathWithMissingTail(worktreePath);
      if (realWt === realRoot) return 'workspace root';
      const rel = path.relative(realRoot, realWt).split(path.sep).join('/');
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel;
      }
    } catch {
      // Fall back to basename
    }
  }
  return path.basename(worktreePath) || 'worktree';
}

function escapeMdTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

/**
 * Pure read-only generator for a sanitized Markdown PR delivery evidence block.
 * Combines latest Verify Gate evidence, target branch/worktree metadata, and active Spec progress.
 * Redacts all secret patterns and never performs any disk writes.
 */
export function buildPrDeliverySummary(
  state: VerifyStateFile,
  opts: BuildPrDeliverySummaryOptions = {},
): PrDeliverySummaryResult {
  const mode: 'live' | 'demo' = opts.mode ?? 'live';
  const evidenceList = Array.isArray(state.evidence) ? state.evidence : [];

  let chosen: VerifyEvidenceRecord | undefined;
  if (opts.evidenceId) {
    chosen = evidenceList.find((e) => e.id === opts.evidenceId);
  }
  if (!chosen && opts.worktreePath) {
    let normalizedWanted = opts.worktreePath;
    try {
      normalizedWanted = resolveRealPathWithMissingTail(opts.worktreePath);
    } catch {
      // keep raw
    }
    chosen = evidenceList.find((e) => {
      if (!e.targetWorktree) return false;
      try {
        return resolveRealPathWithMissingTail(e.targetWorktree) === normalizedWanted;
      } catch {
        return e.targetWorktree === normalizedWanted;
      }
    });
  }
  if (!chosen) {
    chosen = evidenceList[0];
  }

  const branch = opts.branch || chosen?.targetBranch;
  const effectiveWorktree = opts.worktreePath || chosen?.targetWorktree;
  const safeWorktreeLabel = formatSafeWorktreeLabel(effectiveWorktree, opts.workspaceRoot);
  const spec = opts.specSummary ?? null;

  const results = chosen?.results ?? [];
  const checksTotal = results.length;
  const checksPassed = results.filter((r) => r.passed).length;
  const passed = Boolean(chosen?.passed);

  const statusBadge = !chosen
    ? 'NOT RUN'
    : chosen.outcome === 'pass'
      ? 'PASS'
      : chosen.outcome === 'blocked'
        ? 'BLOCKED'
        : chosen.outcome === 'guardrail-allow'
          ? 'GUARDRAIL-ALLOW'
          : 'FAIL';

  const lines: string[] = [
    '## PR Delivery Verification Evidence',
    '',
    `- **Verify Gate Status**: \`${statusBadge}\`${chosen ? ` (\`${chosen.id}\`, ${chosen.durationMs}ms, ${chosen.timestamp})` : ''}`,
  ];

  if (branch || safeWorktreeLabel) {
    const targetParts: string[] = [];
    if (branch) targetParts.push(`Branch: \`${branch}\``);
    if (safeWorktreeLabel) targetParts.push(`Worktree: \`${safeWorktreeLabel}\``);
    lines.push(`- **Target**: ${targetParts.join(' · ')}`);
  }

  if (spec) {
    const modeTag = spec.mode ? ` · \`${spec.mode}\`` : '';
    lines.push(
      `- **Active Spec**: \`${spec.specId}\` — ${spec.title} (\`${spec.status}\`${modeTag}, ${spec.doneTasks}/${spec.totalTasks} tasks done)`,
    );
  }

  if (chosen?.summary) {
    lines.push(`- **Summary**: ${redactVerifyOutput(chosen.summary)}`);
  }

  lines.push('');
  lines.push('### Verification Checks');
  lines.push('');

  if (!chosen) {
    lines.push('_No verification runs recorded yet._');
  } else if (results.length === 0) {
    lines.push('_No enabled verification commands were executed in this run._');
  } else {
    lines.push('| Status | Check | Command | Exit | Duration | Notes |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of results) {
      const cmdStr = escapeMdTableCell(`${r.executable} ${r.args.join(' ')}`.trim());
      const exitStr = r.timedOut ? 'TIMEOUT' : r.exitCode === null ? 'ERR' : String(r.exitCode);
      const snippet = formatFailureTailSnippet(r.outputTail || r.error || '', 2, 140);
      const notes = snippet ? escapeMdTableCell(snippet) : '—';
      lines.push(
        `| ${r.passed ? 'PASS' : 'FAIL'} | ${escapeMdTableCell(r.label || r.commandId)} | \`${cmdStr}\` | ${exitStr} | ${r.durationMs}ms | ${notes} |`,
      );
    }
  }

  if (spec && spec.tasks.length > 0) {
    lines.push('');
    lines.push('### Spec Compliance Progress');
    lines.push('');
    for (const t of spec.tasks) {
      const mark = t.status === 'done' ? 'x' : ' ';
      lines.push(`- [${mark}] \`${t.id}\`: ${t.title} _(${t.status})_`);
    }
  }

  if (chosen && chosen.dirtyFiles.length > 0) {
    lines.push('');
    lines.push(
      `### Verified Files (${chosen.dirtyFiles.length})`,
    );
    lines.push('');
    for (const file of chosen.dirtyFiles.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (chosen.dirtyFiles.length > 20) {
      lines.push(`- _... and ${chosen.dirtyFiles.length - 20} more file(s)_`);
    }
  }

  const finalMarkdown = redactVerifyOutput(lines.join('\n'));

  return {
    mode,
    markdown: finalMarkdown,
    passed,
    ...(branch ? { branch } : {}),
    ...(effectiveWorktree ? { worktreePath: effectiveWorktree } : {}),
    ...(chosen?.id ? { evidenceId: chosen.id } : {}),
    ...(spec?.specId ? { specId: spec.specId } : {}),
    checksTotal,
    checksPassed,
  };
}
