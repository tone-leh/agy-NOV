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
  'python',
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

export interface VerifyCommandValidationResult {
  valid: boolean;
  command?: VerifyCommandSpec;
  error?: string;
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
