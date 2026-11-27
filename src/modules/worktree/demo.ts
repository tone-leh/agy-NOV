import path from 'node:path';
import { isSamePath } from '../../core/utils.js';
import {
  deriveSafeWorktreeSlug,
  isPathInside,
  validateGitRef,
  validateWorktreeDirName,
} from './git.js';
import {
  WORKTREE_INCLUDE_FILE,
  WORKTREE_MANAGED_DIR,
  computeCounts,
  type CleanupWorktreeOptions,
  type CleanupWorktreeResult,
  type CreateWorktreeOptions,
  type CreateWorktreeResult,
  type DemoWorktreeStore,
  type WorktreeDiffFile,
  type WorktreeDiffSummaryResult,
  type WorktreeEntry,
  type WorktreeIncludePreviewResult,
  type WorktreeInspectResult,
} from './types.js';

interface DemoDiffRecord {
  statText: string;
  files: WorktreeDiffFile[];
}

/**
 * Demo Mode: 100% in-memory synthetic store (zero Git commands, zero disk I/O).
 */
export function createDemoWorktreeStore(workspaceRoot: string): DemoWorktreeStore {
  const repoRoot = path.resolve(workspaceRoot);
  const managedRoot = path.join(repoRoot, WORKTREE_MANAGED_DIR);
  const featPath = path.join(managedRoot, 'feat-verify-gate');
  const fixPath = path.join(managedRoot, 'fix-cache-leak');

  let seq = 1;

  const entries: WorktreeEntry[] = [
    {
      path: repoRoot,
      branch: 'main',
      head: 'a1b2c3d',
      isMain: true,
      detached: false,
      locked: false,
      prunable: false,
      exists: true,
      isDirty: false,
      changedFilesCount: 0,
      ahead: 0,
      behind: 0,
      isMerged: false,
    },
    {
      path: featPath,
      branch: 'feat/verify-gate',
      head: 'd4e5f6a',
      isMain: false,
      detached: false,
      locked: false,
      prunable: false,
      exists: true,
      isDirty: true,
      changedFilesCount: 3,
      ahead: 4,
      behind: 1,
      isMerged: false,
    },
    {
      path: fixPath,
      branch: 'fix/cache-leak',
      head: '9c8b7a6',
      isMain: false,
      detached: false,
      locked: false,
      prunable: false,
      exists: true,
      isDirty: false,
      changedFilesCount: 0,
      ahead: 0,
      behind: 2,
      isMerged: true,
    },
  ];

  const diffMap = new Map<string, DemoDiffRecord>([
    [
      repoRoot,
      {
        statText: 'No committed or uncommitted changes relative to main.',
        files: [],
      },
    ],
    [
      featPath,
      {
        statText: [
          'Committed (main...HEAD):',
          ' src/modules/verify/core.ts      | 118 ++++++++++++++++++++++++',
          ' src/modules/verify/hook.ts      |  42 +++++++++',
          ' test/verify-module.test.ts      |  96 ++++++++++++++++++++',
          ' 3 files changed, 256 insertions(+)',
          '',
          'Uncommitted working tree changes:',
          ' src/modules/verify/core.ts | 14 ++++++++++++--',
          ' 1 file changed, 12 insertions(+), 2 deletions(-)',
        ].join('\n'),
        files: [
          { status: 'M', path: 'src/modules/verify/core.ts' },
          { status: 'A', path: 'src/modules/verify/hook.ts' },
          { status: 'A', path: 'test/verify-module.test.ts' },
        ],
      },
    ],
    [
      fixPath,
      {
        statText: 'No committed or uncommitted changes relative to main (branch already merged).',
        files: [],
      },
    ],
  ]);

  const buildState = (): WorktreeInspectResult => ({
    mode: 'demo',
    isGitRepo: true,
    repoRoot,
    currentBranch: 'main',
    baseBranch: 'main',
    worktreeConfigWarning: false,
    worktrees: entries.map((e) => ({ ...e })),
    counts: computeCounts(entries),
  });

  const buildDemoIncludePreview = (): WorktreeIncludePreviewResult => ({
    mode: 'demo',
    repoRoot,
    hasConfig: true,
    configPath: path.join(repoRoot, WORKTREE_INCLUDE_FILE),
    eligibleFiles: [
      { path: '.env.example', sizeBytes: 428 },
      { path: 'config/local.dev.json', sizeBytes: 1024 },
    ],
    skippedSensitive: [
      {
        entry: '.env.local',
        reason:
          'Sensitive dotenv file ".env.local" is blocked (only .env.example/.env.sample/.env.template are permitted).',
      },
      {
        entry: 'certs/dev-server.pem',
        reason: 'Private key or certificate file "dev-server.pem" is blocked by secret policy.',
      },
    ],
    skippedInvalid: [],
    totalBytes: 1452,
  });

  return {
    list: () => buildState(),

    previewInclude: () => buildDemoIncludePreview(),

    create: (opts: CreateWorktreeOptions): CreateWorktreeResult => {
      const branch = validateGitRef(opts.branch);
      if (opts.baseRef !== undefined && opts.baseRef !== '') {
        validateGitRef(opts.baseRef);
      }
      const safeSlug =
        opts.dirName !== undefined && opts.dirName !== ''
          ? validateWorktreeDirName(opts.dirName)
          : deriveSafeWorktreeSlug(branch);

      const targetPath = path.join(managedRoot, safeSlug);
      if (!isPathInside(managedRoot, targetPath)) {
        throw new Error('Target worktree path escapes controlled worktree root.');
      }
      if (entries.some((e) => e.branch === branch)) {
        throw new Error(`Branch "${branch}" is already checked out in a demo worktree.`);
      }
      if (entries.some((e) => isSamePath(e.path, targetPath))) {
        throw new Error(`Target worktree directory already exists: ${targetPath}`);
      }

      const carried = opts.carryUncommitted === true;
      const syntheticHead = `de${String(seq++).padStart(5, '0')}`;
      const created: WorktreeEntry = {
        path: targetPath,
        branch,
        head: syntheticHead,
        isMain: false,
        detached: false,
        locked: false,
        prunable: false,
        exists: true,
        isDirty: carried,
        changedFilesCount: carried ? 1 : 0,
        ahead: 0,
        behind: 0,
        isMerged: false,
      };
      entries.push(created);
      diffMap.set(targetPath, {
        statText: carried
          ? 'Uncommitted working tree changes:\n src/demo-carried.ts | 8 ++++++++\n 1 file changed, 8 insertions(+)'
          : `No committed or uncommitted changes relative to ${opts.baseRef || 'main'}.`,
        files: carried ? [{ status: 'M', path: 'src/demo-carried.ts' }] : [],
      });

      const includePreview = opts.applyInclude !== false ? buildDemoIncludePreview() : null;
      return {
        created: { ...created },
        carriedUncommitted: carried,
        includedFiles: includePreview ? includePreview.eligibleFiles.map((f) => f.path) : [],
        skippedSensitive: includePreview ? includePreview.skippedSensitive.map((s) => s.entry) : [],
        skippedInvalid: includePreview ? includePreview.skippedInvalid.map((s) => s.entry) : [],
        state: buildState(),
      };
    },

    diffSummary: (worktreePath: string, baseRef?: string): WorktreeDiffSummaryResult => {
      if (typeof worktreePath !== 'string' || !worktreePath.trim() || worktreePath.includes('\0')) {
        throw new Error('Invalid worktreePath: must be a non-empty filesystem path.');
      }
      const resolvedBaseRef =
        baseRef !== undefined && baseRef !== '' ? validateGitRef(baseRef) : 'main';
      const normalized = path.resolve(worktreePath);
      const entry = entries.find((e) => isSamePath(e.path, normalized));
      if (!entry) {
        throw new Error(
          `Refused: "${worktreePath}" is not in the active demo worktree list.`,
        );
      }
      const record = diffMap.get(entry.path) ?? {
        statText: `No committed or uncommitted changes relative to ${resolvedBaseRef}.`,
        files: [],
      };
      return {
        worktreePath: entry.path,
        branch: entry.branch,
        baseRef: resolvedBaseRef,
        statText: record.statText,
        files: record.files.map((f) => ({ ...f })),
        ahead: entry.ahead,
        behind: entry.behind,
      };
    },

    cleanup: (opts: CleanupWorktreeOptions): CleanupWorktreeResult => {
      if (opts.pruneOnly === true) {
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          if (!entries[i].isMain && entries[i].prunable) {
            diffMap.delete(entries[i].path);
            entries.splice(i, 1);
          }
        }
        return {
          pruned: true,
          message: 'Pruned stale demo worktree metadata.',
          state: buildState(),
        };
      }

      if (!opts.worktreePath || !opts.worktreePath.trim()) {
        throw new Error('Either worktreePath or pruneOnly: true must be provided.');
      }
      const normalized = path.resolve(opts.worktreePath);
      const idx = entries.findIndex((e) => isSamePath(e.path, normalized));
      if (idx < 0) {
        throw new Error(
          `Refused: "${opts.worktreePath}" is not in the active demo worktree list.`,
        );
      }
      const target = entries[idx];
      if (target.isMain) {
        throw new Error(`Refused: cannot remove the main worktree (${target.path}).`);
      }
      if (target.locked) {
        const reasonSuffix = target.lockReason ? ` Reason: ${target.lockReason}` : '';
        throw new Error(
          `Worktree is locked; unlock it with "git worktree unlock" before removing.${reasonSuffix}`,
        );
      }
      if (target.isDirty && opts.force !== true) {
        throw new Error(
          `Refused: worktree "${target.path}" has ${target.changedFilesCount} uncommitted change(s). Pass force: true to force removal.`,
        );
      }
      entries.splice(idx, 1);
      diffMap.delete(target.path);
      return {
        removedPath: target.path,
        pruned: true,
        message: `Removed demo worktree ${target.path} and pruned stale metadata.`,
        state: buildState(),
      };
    },
  };
}
