export const WORKTREE_MANAGED_DIR = '.agy-worktrees';
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude';
export const WORKTREE_INCLUDE_MAX_CONFIG_BYTES = 16 * 1024; // 16 KiB
export const WORKTREE_INCLUDE_MAX_FILES = 32;
export const WORKTREE_INCLUDE_MAX_FILE_BYTES = 512 * 1024; // 512 KiB
export const WORKTREE_INCLUDE_MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB

export interface WorktreeIncludeEntry {
  path: string;
  sizeBytes: number;
}

export interface WorktreeIncludeSkippedItem {
  entry: string;
  reason: string;
}

export interface WorktreeIncludePreviewResult {
  mode: 'live' | 'demo';
  repoRoot: string;
  hasConfig: boolean;
  configPath: string;
  eligibleFiles: WorktreeIncludeEntry[];
  skippedSensitive: WorktreeIncludeSkippedItem[];
  skippedInvalid: WorktreeIncludeSkippedItem[];
  totalBytes: number;
  warning?: string;
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  detached: boolean;
  bare?: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
  exists: boolean;
  isDirty: boolean;
  changedFilesCount: number;
  ahead: number;
  behind: number;
  isMerged: boolean;
}

export interface WorktreeCounts {
  total: number;
  dirty: number;
  merged: number;
  prunable: number;
}

export interface WorktreeInspectResult {
  mode: 'live' | 'demo';
  isGitRepo: boolean;
  repoRoot: string;
  currentBranch?: string;
  baseBranch?: string;
  worktreeConfigWarning: boolean;
  worktrees: WorktreeEntry[];
  counts: WorktreeCounts;
}

export interface CreateWorktreeOptions {
  branch: string;
  baseRef?: string;
  dirName?: string;
  carryUncommitted?: boolean;
  applyInclude?: boolean;
}

export interface CreateWorktreeResult {
  created: WorktreeEntry;
  carriedUncommitted: boolean;
  includedFiles: string[];
  skippedSensitive: string[];
  skippedInvalid: string[];
  warning?: string;
  state: WorktreeInspectResult;
}

export interface WorktreeDiffFile {
  status: string;
  path: string;
}

export interface WorktreeDiffSummaryResult {
  worktreePath: string;
  branch: string | null;
  baseRef: string;
  statText: string;
  files: WorktreeDiffFile[];
  ahead: number;
  behind: number;
}

export interface CleanupWorktreeOptions {
  worktreePath?: string;
  pruneOnly?: boolean;
  force?: boolean;
}

export interface CleanupWorktreeResult {
  removedPath?: string;
  pruned: boolean;
  message: string;
  state: WorktreeInspectResult;
}

export interface DemoWorktreeStore {
  list: () => WorktreeInspectResult;
  previewInclude: () => WorktreeIncludePreviewResult;
  create: (opts: CreateWorktreeOptions) => CreateWorktreeResult;
  diffSummary: (worktreePath: string, baseRef?: string) => WorktreeDiffSummaryResult;
  cleanup: (opts: CleanupWorktreeOptions) => CleanupWorktreeResult;
}

export interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ParsedPorcelainWorktree {
  rawPath: string;
  path: string;
  fullHead: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
}

export function computeCounts(worktrees: WorktreeEntry[]): WorktreeCounts {
  return {
    total: worktrees.length,
    dirty: worktrees.filter((w) => w.isDirty).length,
    merged: worktrees.filter((w) => !w.isMain && w.isMerged).length,
    prunable: worktrees.filter((w) => w.prunable).length,
  };
}
