export {
  WORKTREE_MANAGED_DIR,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_CONFIG_BYTES,
  WORKTREE_INCLUDE_MAX_FILES,
  WORKTREE_INCLUDE_MAX_FILE_BYTES,
  WORKTREE_INCLUDE_MAX_TOTAL_BYTES,
  type WorktreeIncludeEntry,
  type WorktreeIncludeSkippedItem,
  type WorktreeIncludePreviewResult,
  type WorktreeEntry,
  type WorktreeCounts,
  type WorktreeInspectResult,
  type CreateWorktreeOptions,
  type CreateWorktreeResult,
  type WorktreeDiffFile,
  type WorktreeDiffSummaryResult,
  type CleanupWorktreeOptions,
  type CleanupWorktreeResult,
  type DemoWorktreeStore,
} from './types.js';

export {
  validateGitRef,
  validateWorktreeDirName,
  deriveSafeWorktreeSlug,
  isPathInside,
  canonicalizePath,
  parseWorktreeListPorcelain,
} from './git.js';

export {
  detectSensitiveIncludePath,
  previewWorktreeInclude,
  previewWorktreeIncludeForWorkspace,
} from './include.js';

export {
  inspectWorktrees,
  createWorktree,
  getWorktreeDiffSummary,
  cleanupWorktree,
} from './lifecycle.js';

export { createDemoWorktreeStore } from './demo.js';
