import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isSamePath } from '../../core/utils.js';
import {
  canonicalizePath,
  commitExists,
  deriveSafeWorktreeSlug,
  ensureWorktreeDirExcludedInGitInfo,
  isPathInside,
  parseAheadBehind,
  parseNameStatusOutput,
  parsePorcelainStatusEntries,
  resolveDefaultBaseBranch,
  resolveGitContext,
  runGit,
  validateGitRef,
  validateWorktreeDirName,
} from './git.js';
import { applyWorktreeIncludeFiles } from './include.js';
import {
  WORKTREE_MANAGED_DIR,
  computeCounts,
  type CleanupWorktreeOptions,
  type CleanupWorktreeResult,
  type CreateWorktreeOptions,
  type CreateWorktreeResult,
  type WorktreeDiffFile,
  type WorktreeDiffSummaryResult,
  type WorktreeEntry,
  type WorktreeInspectResult,
} from './types.js';

export async function inspectWorktrees(workspaceRoot: string): Promise<WorktreeInspectResult> {
  const ctx = await resolveGitContext(workspaceRoot);
  if (!ctx.isGitRepo) {
    return {
      mode: 'live',
      isGitRepo: false,
      repoRoot: workspaceRoot,
      worktreeConfigWarning: false,
      worktrees: [],
      counts: { total: 0, dirty: 0, merged: 0, prunable: 0 },
    };
  }

  const repoRoot = ctx.mainRootReal;
  const mainEntry = ctx.rawEntries[0];
  const currentEntry =
    ctx.rawEntries.find((e) => isSamePath(e.path, ctx.toplevelReal)) ?? mainEntry;

  const [configRes, baseBranch] = await Promise.all([
    runGit(repoRoot, ['config', '--get', 'extensions.worktreeConfig']),
    resolveDefaultBaseBranch(repoRoot, mainEntry),
  ]);

  const worktreeConfigWarning =
    configRes.ok && configRes.stdout.trim().toLowerCase() === 'true';

  const mergedBranches = new Set<string>();
  if (baseBranch) {
    const mergedRes = await runGit(repoRoot, ['branch', '--merged', baseBranch]);
    if (mergedRes.ok) {
      for (const line of mergedRes.stdout.split(/\r?\n/)) {
        const cleaned = line.replace(/^[*+\s]+/, '').trim();
        if (cleaned && !cleaned.startsWith('(')) {
          mergedBranches.add(cleaned);
        }
      }
    }
  }

  const worktrees: WorktreeEntry[] = await Promise.all(
    ctx.rawEntries.map(async (raw): Promise<WorktreeEntry> => {
      const exists = fs.existsSync(raw.path);
      let isDirty = false;
      let changedFilesCount = 0;

      if (exists && !raw.bare) {
        const statusRes = await runGit(raw.path, ['status', '--porcelain']);
        if (statusRes.ok) {
          const statusEntries = parsePorcelainStatusEntries(statusRes.stdout);
          changedFilesCount = statusEntries.length;
          isDirty = changedFilesCount > 0;
        }
      }

      let ahead = 0;
      let behind = 0;
      let isMerged = false;

      if (baseBranch && raw.fullHead) {
        const isSameAsBase = raw.branch === baseBranch;
        if (!isSameAsBase) {
          let targetRef: string | null = null;
          if (raw.branch) {
            try {
              targetRef = validateGitRef(raw.branch);
            } catch {
              targetRef = raw.fullHead;
            }
          } else if (/^[0-9a-f]{7,40}$/i.test(raw.fullHead)) {
            targetRef = raw.fullHead;
          }

          if (targetRef) {
            const revRes = await runGit(repoRoot, [
              'rev-list',
              '--left-right',
              '--count',
              `${baseBranch}...${targetRef}`,
            ]);
            if (revRes.ok) {
              const counts = parseAheadBehind(revRes.stdout);
              ahead = counts.ahead;
              behind = counts.behind;
            }
          }
        }

        if (!raw.isMain) {
          if (raw.branch) {
            isMerged = mergedBranches.has(raw.branch);
          } else if (/^[0-9a-f]{7,40}$/i.test(raw.fullHead)) {
            const ancRes = await runGit(repoRoot, [
              'merge-base',
              '--is-ancestor',
              raw.fullHead,
              baseBranch,
            ]);
            isMerged = ancRes.ok;
          }
        }
      }

      return {
        path: raw.path,
        branch: raw.branch,
        head: raw.head,
        isMain: raw.isMain,
        detached: raw.detached,
        ...(raw.bare ? { bare: true } : {}),
        locked: raw.locked,
        ...(raw.lockReason ? { lockReason: raw.lockReason } : {}),
        prunable: raw.prunable,
        ...(raw.pruneReason ? { pruneReason: raw.pruneReason } : {}),
        exists,
        isDirty,
        changedFilesCount,
        ahead,
        behind,
        isMerged,
      };
    }),
  );

  return {
    mode: 'live',
    isGitRepo: true,
    repoRoot,
    ...(currentEntry?.branch ? { currentBranch: currentEntry.branch } : {}),
    ...(baseBranch ? { baseBranch } : {}),
    worktreeConfigWarning,
    worktrees,
    counts: computeCounts(worktrees),
  };
}

export async function createWorktree(
  workspaceRoot: string,
  opts: CreateWorktreeOptions,
): Promise<CreateWorktreeResult> {
  const ctx = await resolveGitContext(workspaceRoot);
  if (!ctx.isGitRepo) {
    throw new Error(`Not a Git repository: ${workspaceRoot}`);
  }

  const branch = validateGitRef(opts.branch);
  const baseRef =
    opts.baseRef !== undefined && opts.baseRef !== ''
      ? validateGitRef(opts.baseRef)
      : undefined;
  const safeSlug =
    opts.dirName !== undefined && opts.dirName !== ''
      ? validateWorktreeDirName(opts.dirName)
      : deriveSafeWorktreeSlug(branch);

  const repoRealRoot = canonicalRealpathSync(ctx.mainRootReal);

  // Refuse if branch is already checked out in any active worktree
  const alreadyCheckedOut = ctx.rawEntries.find((w) => w.branch === branch);
  if (alreadyCheckedOut) {
    throw new Error(
      `Branch "${branch}" is already checked out in worktree: ${alreadyCheckedOut.path}`,
    );
  }

  // Validate controlled `.agy-worktrees` parent directory without creating it prematurely
  const managedRootCandidate = path.join(repoRealRoot, WORKTREE_MANAGED_DIR);
  if (!isPathInside(repoRealRoot, managedRootCandidate)) {
    throw new Error('Controlled worktree root escapes repository boundary.');
  }

  if (fs.existsSync(managedRootCandidate)) {
    const lstat = fs.lstatSync(managedRootCandidate);
    if (lstat.isSymbolicLink() || !lstat.isDirectory()) {
      throw new Error(
        `Controlled worktree root "${managedRootCandidate}" must be a real directory (not a symlink or file).`,
      );
    }
    const realManaged = canonicalRealpathSync(managedRootCandidate);
    if (!isPathInside(repoRealRoot, realManaged)) {
      throw new Error('Controlled worktree root symlink escapes repository boundary.');
    }
  }

  const preTargetPath = path.join(managedRootCandidate, safeSlug);
  if (!isPathInside(managedRootCandidate, preTargetPath)) {
    throw new Error(`Target worktree path escapes controlled directory "${WORKTREE_MANAGED_DIR}".`);
  }
  try {
    fs.lstatSync(preTargetPath);
    throw new Error(
      `Target worktree directory already exists (refusing to overwrite): ${preTargetPath}`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  if (baseRef) {
    const validBase = await commitExists(repoRealRoot, baseRef);
    if (!validBase) {
      throw new Error(`Base ref "${baseRef}" does not resolve to a valid commit.`);
    }
  }

  const branchRefRes = await runGit(repoRealRoot, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]);
  const branchExists = branchRefRes.ok;

  // Create controlled parent directory only after all validations pass
  fs.mkdirSync(managedRootCandidate, { recursive: true });
  const realManagedRoot = canonicalRealpathSync(managedRootCandidate);
  if (!isPathInside(repoRealRoot, realManagedRoot)) {
    throw new Error('Controlled worktree root escapes repository boundary after creation.');
  }

  const targetPath = path.join(realManagedRoot, safeSlug);
  if (
    !isSamePath(path.dirname(targetPath), realManagedRoot) ||
    !isPathInside(realManagedRoot, targetPath)
  ) {
    throw new Error('Resolved target worktree path escapes controlled worktree root.');
  }

  // Ensure `.agy-worktrees/` is ignored via local `.git/info/exclude` without touching tracked `.gitignore`
  await ensureWorktreeDirExcludedInGitInfo(repoRealRoot);

  const addArgs = branchExists
    ? ['worktree', 'add', '--', targetPath, branch]
    : baseRef
      ? ['worktree', 'add', '-b', branch, '--', targetPath, baseRef]
      : ['worktree', 'add', '-b', branch, '--', targetPath];

  const addRes = await runGit(repoRealRoot, addArgs);
  if (!addRes.ok) {
    throw new Error(`Failed to create worktree for branch "${branch}": ${addRes.stderr.trim()}`);
  }

  let carriedUncommitted = false;
  let warning: string | undefined;

  if (opts.carryUncommitted === true) {
    const sourceRoot = ctx.toplevelReal;
    const diffRes = await runGit(sourceRoot, ['diff', '--binary', 'HEAD']);
    if (!diffRes.ok) {
      warning = `Worktree created, but could not extract uncommitted diff from source worktree: ${diffRes.stderr.trim()}`;
    } else if (diffRes.stdout.length > 0) {
      const rollbackFailedCarry = async (): Promise<string> => {
        const resetRes = await runGit(targetPath, ['reset', '--hard', 'HEAD']);
        const cleanRes = await runGit(targetPath, ['clean', '-fd']);
        const rollbackErrors: string[] = [];
        if (!resetRes.ok) {
          rollbackErrors.push(`git reset --hard HEAD failed: ${resetRes.stderr.trim()}`);
        }
        if (!cleanRes.ok) {
          rollbackErrors.push(`git clean -fd failed: ${cleanRes.stderr.trim()}`);
        }
        return rollbackErrors.length > 0
          ? ` Rollback warning: ${rollbackErrors.join('; ')}.`
          : '';
      };

      // Try clean direct apply first (zero index side effects), then fall back to 3-way merge
      const checkPlain = await runGit(targetPath, ['apply', '--check', '-'], diffRes.stdout);
      if (checkPlain.ok) {
        const applyPlain = await runGit(targetPath, ['apply', '-'], diffRes.stdout);
        if (applyPlain.ok) {
          carriedUncommitted = true;
        } else {
          const rollbackNote = await rollbackFailedCarry();
          warning = `Worktree created, but applying uncommitted changes failed (target worktree rolled back to clean HEAD; main worktree untouched): ${applyPlain.stderr.trim()}${rollbackNote}`;
        }
      } else {
        const apply3Way = await runGit(targetPath, ['apply', '--3way', '-'], diffRes.stdout);
        if (apply3Way.ok) {
          carriedUncommitted = true;
        } else {
          const rollbackNote = await rollbackFailedCarry();
          warning = `Worktree created, but applying uncommitted changes encountered conflicts or errors (target worktree rolled back to clean HEAD; main worktree untouched): ${apply3Way.stderr.trim() || checkPlain.stderr.trim()}${rollbackNote}`;
        }
      }
    }
  }

  let includedFiles: string[] = [];
  let skippedSensitive: string[] = [];
  let skippedInvalid: string[] = [];

  if (opts.applyInclude !== false) {
    const includeRes = applyWorktreeIncludeFiles(repoRealRoot, targetPath);
    includedFiles = includeRes.includedFiles;
    skippedSensitive = includeRes.skippedSensitive;
    skippedInvalid = includeRes.skippedInvalid;
    if (includeRes.warning) {
      warning = warning ? `${warning} ${includeRes.warning}` : includeRes.warning;
    }
  }

  const state = await inspectWorktrees(workspaceRoot);
  const canonicalTarget = canonicalizePath(targetPath);
  const created = state.worktrees.find((w) => isSamePath(w.path, canonicalTarget));
  if (!created) {
    throw new Error(`Worktree was added at ${canonicalTarget} but could not be verified in worktree list.`);
  }

  return {
    created,
    carriedUncommitted,
    includedFiles,
    skippedSensitive,
    skippedInvalid,
    ...(warning ? { warning } : {}),
    state,
  };
}

export async function getWorktreeDiffSummary(
  workspaceRoot: string,
  worktreePath: string,
  baseRef?: string,
): Promise<WorktreeDiffSummaryResult> {
  const ctx = await resolveGitContext(workspaceRoot);
  if (!ctx.isGitRepo) {
    throw new Error(`Not a Git repository: ${workspaceRoot}`);
  }
  if (typeof worktreePath !== 'string' || !worktreePath.trim() || worktreePath.includes('\0')) {
    throw new Error('Invalid worktreePath: must be a non-empty filesystem path.');
  }

  let normalizedInput: string;
  try {
    normalizedInput = canonicalRealpathSync(path.resolve(worktreePath));
  } catch {
    throw new Error(`Worktree path does not exist or is not accessible: ${worktreePath}`);
  }

  const matched = ctx.rawEntries.find((w) => isSamePath(w.path, normalizedInput));
  if (!matched) {
    throw new Error(
      `Refused: "${worktreePath}" is not in the active git worktree list for this repository.`,
    );
  }
  if (matched.bare) {
    throw new Error(`Cannot compute diff summary for bare worktree: ${matched.path}`);
  }

  const repoRoot = ctx.mainRootReal;
  const mainEntry = ctx.rawEntries[0];

  let resolvedBaseRef: string;
  if (baseRef !== undefined && baseRef !== '') {
    resolvedBaseRef = validateGitRef(baseRef);
    const exists = await commitExists(repoRoot, resolvedBaseRef);
    if (!exists) {
      throw new Error(`Base ref "${resolvedBaseRef}" does not resolve to a valid commit.`);
    }
  } else {
    resolvedBaseRef = (await resolveDefaultBaseBranch(repoRoot, mainEntry)) ?? 'HEAD';
  }

  const [revRes, committedStatRes, committedFilesRes, dirtyStatRes, dirtyStatusRes] =
    await Promise.all([
      runGit(matched.path, [
        'rev-list',
        '--left-right',
        '--count',
        `${resolvedBaseRef}...HEAD`,
      ]),
      runGit(matched.path, ['diff', '--stat', `${resolvedBaseRef}...HEAD`]),
      runGit(matched.path, ['diff', '--name-status', `${resolvedBaseRef}...HEAD`]),
      runGit(matched.path, ['diff', '--stat', 'HEAD']),
      runGit(matched.path, ['status', '--porcelain']),
    ]);

  const { ahead, behind } = revRes.ok ? parseAheadBehind(revRes.stdout) : { ahead: 0, behind: 0 };

  const fileMap = new Map<string, WorktreeDiffFile>();
  if (committedFilesRes.ok) {
    for (const f of parseNameStatusOutput(committedFilesRes.stdout)) {
      fileMap.set(f.path, f);
    }
  }

  const dirtyEntries = dirtyStatusRes.ok ? parsePorcelainStatusEntries(dirtyStatusRes.stdout) : [];
  for (const f of dirtyEntries) {
    fileMap.set(f.path, f);
  }

  const statSections: string[] = [];
  const committedStat = committedStatRes.ok ? committedStatRes.stdout.trim() : '';
  if (committedStat) {
    statSections.push(`Committed (${resolvedBaseRef}...HEAD):\n${committedStat}`);
  }

  const dirtyStat = dirtyStatRes.ok ? dirtyStatRes.stdout.trim() : '';
  const untrackedLines = dirtyEntries
    .filter((f) => f.status === '??')
    .map((f) => ` ?? ${f.path}`);

  if (dirtyStat || untrackedLines.length > 0) {
    const parts: string[] = [];
    if (dirtyStat) parts.push(dirtyStat);
    if (untrackedLines.length > 0) {
      parts.push(`Untracked files:\n${untrackedLines.join('\n')}`);
    }
    statSections.push(`Uncommitted working tree changes:\n${parts.join('\n')}`);
  }

  const statText =
    statSections.length > 0
      ? statSections.join('\n\n')
      : `No committed or uncommitted changes relative to ${resolvedBaseRef}.`;

  return {
    worktreePath: matched.path,
    branch: matched.branch,
    baseRef: resolvedBaseRef,
    statText,
    files: Array.from(fileMap.values()),
    ahead,
    behind,
  };
}

export async function cleanupWorktree(
  workspaceRoot: string,
  opts: CleanupWorktreeOptions,
): Promise<CleanupWorktreeResult> {
  const ctx = await resolveGitContext(workspaceRoot);
  if (!ctx.isGitRepo) {
    throw new Error(`Not a Git repository: ${workspaceRoot}`);
  }

  const repoRoot = ctx.mainRootReal;

  if (opts.pruneOnly === true) {
    const pruneRes = await runGit(repoRoot, ['worktree', 'prune']);
    if (!pruneRes.ok) {
      throw new Error(`Failed to prune worktrees: ${pruneRes.stderr.trim()}`);
    }
    const state = await inspectWorktrees(workspaceRoot);
    return {
      pruned: true,
      message: 'Pruned stale git worktree metadata.',
      state,
    };
  }

  if (!opts.worktreePath || !opts.worktreePath.trim()) {
    throw new Error('Either worktreePath or pruneOnly: true must be provided.');
  }

  const currentState = await inspectWorktrees(workspaceRoot);
  const normalizedTarget = canonicalizePath(opts.worktreePath);

  const target = currentState.worktrees.find((w) => isSamePath(w.path, normalizedTarget));
  if (!target) {
    throw new Error(
      `Refused: "${opts.worktreePath}" is not in the active git worktree list for this repository.`,
    );
  }

  if (target.isMain) {
    throw new Error(
      `Refused: cannot remove the main worktree (${target.path}).`,
    );
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

  if (target.exists) {
    const removeArgs = opts.force
      ? ['worktree', 'remove', '--force', '--', target.path]
      : ['worktree', 'remove', '--', target.path];
    const removeRes = await runGit(repoRoot, removeArgs);
    if (!removeRes.ok) {
      throw new Error(`Failed to remove worktree "${target.path}": ${removeRes.stderr.trim()}`);
    }
  }

  const pruneRes = await runGit(repoRoot, ['worktree', 'prune']);
  if (!pruneRes.ok) {
    throw new Error(
      `Worktree removed but git worktree prune failed: ${pruneRes.stderr.trim()}`,
    );
  }

  const state = await inspectWorktrees(workspaceRoot);
  return {
    removedPath: target.path,
    pruned: true,
    message: `Removed worktree ${target.path} and pruned stale metadata.`,
    state,
  };
}
