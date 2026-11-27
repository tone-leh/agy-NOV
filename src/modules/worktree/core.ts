import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WORKTREE_MANAGED_DIR = '.agy-worktrees';

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const GIT_REF_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const DIR_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ZERO_SHA_REGEX = /^0+$/;

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
}

export interface CreateWorktreeResult {
  created: WorktreeEntry;
  carriedUncommitted: boolean;
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

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface ParsedPorcelainWorktree {
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

/**
 * Strictly validate a Git branch or ref name to prevent option injection,
 * path traversal, shell metacharacters, and invalid git-check-ref-format patterns.
 */
export function validateGitRef(ref: string): string {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error('Invalid Git ref: must be a non-empty string.');
  }
  if (ref.length > 120) {
    throw new Error('Invalid Git ref: exceeds maximum length of 120 characters.');
  }
  if (ref.startsWith('-')) {
    throw new Error(`Invalid Git ref "${ref}": leading hyphen is disallowed.`);
  }
  if (/[\s\0\\]/.test(ref)) {
    throw new Error(`Invalid Git ref "${ref}": whitespace, NUL, and backslashes are disallowed.`);
  }
  if (ref.includes('..') || ref.includes('@{') || ref.includes('//')) {
    throw new Error(`Invalid Git ref "${ref}": sequences "..", "@{", and "//" are disallowed.`);
  }
  if (ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock')) {
    throw new Error(`Invalid Git ref "${ref}": cannot end with "/", ".", or ".lock".`);
  }
  if (!GIT_REF_REGEX.test(ref)) {
    throw new Error(
      `Invalid Git ref "${ref}": must match /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.`,
    );
  }
  const segments = ref.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.') || seg.endsWith('.lock')) {
      throw new Error(`Invalid Git ref "${ref}": contains disallowed ref path segment "${seg}".`);
    }
  }
  return ref;
}

/**
 * Strictly validate a single directory slug under `.agy-worktrees/`.
 * Rejects path traversal (`..`, `/`, `\`), flags (`-`), whitespace, and control chars.
 */
export function validateWorktreeDirName(dirName: string): string {
  if (typeof dirName !== 'string' || dirName.length === 0) {
    throw new Error('Invalid worktree dirName: must be a non-empty directory name.');
  }
  if (
    dirName === '.' ||
    dirName === '..' ||
    dirName.includes('..') ||
    dirName.includes('/') ||
    dirName.includes('\\') ||
    /[\s\0]/.test(dirName)
  ) {
    throw new Error(
      `Invalid worktree dirName "${dirName}": path traversal, separators, and whitespace are disallowed.`,
    );
  }
  if (dirName.startsWith('-') || dirName.startsWith('.') || dirName.endsWith('.')) {
    throw new Error(
      `Invalid worktree dirName "${dirName}": cannot start with "-" or "." or end with ".".`,
    );
  }
  if (!DIR_NAME_REGEX.test(dirName)) {
    throw new Error(
      `Invalid worktree dirName "${dirName}": must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.`,
    );
  }
  return dirName;
}

/**
 * Convert an already-validated Git branch name into a safe single-level directory slug.
 */
export function deriveSafeWorktreeSlug(branch: string): string {
  const safeBranch = validateGitRef(branch);
  let slug = safeBranch
    .replace(/\//g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  if (!slug || !/^[A-Za-z0-9]/.test(slug)) {
    slug = `wt-${slug || 'branch'}`;
  }
  slug = slug.slice(0, 80).replace(/[.-]+$/, '');
  if (!slug) {
    slug = 'wt-branch';
  }
  return validateWorktreeDirName(slug);
}

/**
 * Check whether `childReal` is strictly nested inside `parentReal`.
 */
export function isPathInside(parentReal: string, childReal: string): boolean {
  const rel = path.relative(parentReal, childReal);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Canonicalize a filesystem path via `fs.realpathSync`.
 * If the leaf no longer exists (e.g. an orphaned/prunable worktree directory),
 * resolve the deepest existing ancestor via `realpathSync` and re-attach remaining segments.
 */
export function canonicalizePath(inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) {
    throw new Error('Invalid path: must be a non-empty string without NUL bytes.');
  }
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    const missingSegments: string[] = [];
    let cursor = resolved;
    while (true) {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return resolved;
      }
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
      try {
        const realAncestor = fs.realpathSync(cursor);
        return path.join(realAncestor, ...missingSegments);
      } catch {
        // Walk up until an existing ancestor is found
      }
    }
  }
}

/**
 * Execute Git strictly without a shell (`shell: false`), non-interactively (`GIT_TERMINAL_PROMPT=0`),
 * with bounded timeout and buffer cap.
 */
function runGit(cwd: string, args: string[], stdinText?: string): Promise<GitExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd,
        shell: false,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            ok: true,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: 0,
          });
          return;
        }
        const err = error as NodeJS.ErrnoException & { code?: number | string };
        const exitCode = typeof err.code === 'number' ? err.code : null;
        resolve({
          ok: false,
          stdout: stdout ?? '',
          stderr: (stderr ?? '') || error.message || 'git command failed',
          exitCode,
        });
      },
    );

    if (child.stdin) {
      if (stdinText !== undefined) {
        child.stdin.end(stdinText, 'utf8');
      } else {
        child.stdin.end();
      }
    }
  });
}

export function parseWorktreeListPorcelain(output: string): ParsedPorcelainWorktree[] {
  const entries: ParsedPorcelainWorktree[] = [];
  const lines = output.split(/\r?\n/);

  let current: {
    rawPath?: string;
    fullHead: string;
    branch: string | null;
    detached: boolean;
    bare: boolean;
    locked: boolean;
    lockReason?: string;
    prunable: boolean;
    pruneReason?: string;
  } | null = null;

  const flush = () => {
    if (!current || !current.rawPath) return;
    const isUnborn = !current.fullHead || ZERO_SHA_REGEX.test(current.fullHead);
    entries.push({
      rawPath: current.rawPath,
      path: canonicalizePath(current.rawPath),
      fullHead: isUnborn ? '' : current.fullHead,
      head: isUnborn ? '' : current.fullHead.slice(0, 7),
      branch: current.branch,
      isMain: entries.length === 0,
      detached: current.detached,
      bare: current.bare,
      locked: current.locked,
      ...(current.lockReason ? { lockReason: current.lockReason } : {}),
      prunable: current.prunable,
      ...(current.pruneReason ? { pruneReason: current.pruneReason } : {}),
    });
    current = null;
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = {
        rawPath: line.slice('worktree '.length),
        fullHead: '',
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('HEAD ')) {
      current.fullHead = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      const refName = line.slice('branch '.length).trim();
      current.branch = refName.replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.detached = true;
      current.branch = null;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'locked') {
      current.locked = true;
    } else if (line.startsWith('locked ')) {
      current.locked = true;
      const reason = line.slice('locked '.length).trim();
      if (reason) current.lockReason = reason;
    } else if (line === 'prunable') {
      current.prunable = true;
    } else if (line.startsWith('prunable ')) {
      current.prunable = true;
      const reason = line.slice('prunable '.length).trim();
      if (reason) current.pruneReason = reason;
    }
  }
  flush();

  return entries;
}

function parsePorcelainStatusEntries(stdout: string): WorktreeDiffFile[] {
  const files: WorktreeDiffFile[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine || rawLine.length < 4) continue;
    const xy = rawLine.slice(0, 2);
    const relPath = rawLine.slice(3);
    // Ignore the managed worktree directory entry (and nested untracked files if showUntrackedFiles=all)
    if (
      xy === '??' &&
      (relPath === WORKTREE_MANAGED_DIR || relPath.startsWith(`${WORKTREE_MANAGED_DIR}/`))
    ) {
      continue;
    }
    const status = xy === '??' ? '??' : xy.trim() || 'M';
    files.push({ status, path: relPath });
  }
  return files;
}

function parseNameStatusOutput(stdout: string): WorktreeDiffFile[] {
  const files: WorktreeDiffFile[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const rawStatus = parts[0].trim();
    const status = rawStatus.charAt(0) || 'M';
    if ((status === 'R' || status === 'C') && parts.length >= 3) {
      files.push({ status, path: `${parts[1]} -> ${parts[2]}` });
    } else {
      files.push({ status, path: parts[1] });
    }
  }
  return files;
}

function parseAheadBehind(stdout: string): { behind: number; ahead: number } {
  const trimmed = stdout.trim();
  if (!trimmed) return { behind: 0, ahead: 0 };
  const parts = trimmed.split(/\s+/);
  const behind = Number.parseInt(parts[0] ?? '0', 10);
  const ahead = Number.parseInt(parts[1] ?? '0', 10);
  return {
    behind: Number.isFinite(behind) && behind >= 0 ? behind : 0,
    ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : 0,
  };
}

function computeCounts(worktrees: WorktreeEntry[]): WorktreeCounts {
  return {
    total: worktrees.length,
    dirty: worktrees.filter((w) => w.isDirty).length,
    merged: worktrees.filter((w) => !w.isMain && w.isMerged).length,
    prunable: worktrees.filter((w) => w.prunable).length,
  };
}

async function resolveGitContext(workspaceRoot: string): Promise<{
  isGitRepo: boolean;
  toplevelReal: string;
  mainRootReal: string;
  rawEntries: ParsedPorcelainWorktree[];
}> {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return {
      isGitRepo: false,
      toplevelReal: workspaceRoot,
      mainRootReal: workspaceRoot,
      rawEntries: [],
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(workspaceRoot);
  } catch {
    return {
      isGitRepo: false,
      toplevelReal: workspaceRoot,
      mainRootReal: workspaceRoot,
      rawEntries: [],
    };
  }
  if (!stat.isDirectory()) {
    return {
      isGitRepo: false,
      toplevelReal: workspaceRoot,
      mainRootReal: workspaceRoot,
      rawEntries: [],
    };
  }

  const topRes = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel']);
  if (!topRes.ok || !topRes.stdout.trim()) {
    return {
      isGitRepo: false,
      toplevelReal: workspaceRoot,
      mainRootReal: workspaceRoot,
      rawEntries: [],
    };
  }

  const toplevelReal = canonicalizePath(topRes.stdout.trim());
  const listRes = await runGit(toplevelReal, ['worktree', 'list', '--porcelain']);
  if (!listRes.ok) {
    return {
      isGitRepo: false,
      toplevelReal: workspaceRoot,
      mainRootReal: workspaceRoot,
      rawEntries: [],
    };
  }

  const rawEntries = parseWorktreeListPorcelain(listRes.stdout);
  const mainRootReal = rawEntries[0]?.path ?? toplevelReal;
  return {
    isGitRepo: true,
    toplevelReal,
    mainRootReal,
    rawEntries,
  };
}

async function commitExists(cwd: string, ref: string): Promise<boolean> {
  const res = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return res.ok && res.stdout.trim().length > 0;
}

async function resolveDefaultBaseBranch(
  repoRoot: string,
  mainEntry?: ParsedPorcelainWorktree,
): Promise<string | undefined> {
  const candidates: string[] = [];
  if (mainEntry?.branch) {
    candidates.push(mainEntry.branch);
  }
  if (!candidates.includes('main')) candidates.push('main');
  if (!candidates.includes('master')) candidates.push('master');

  for (const candidate of candidates) {
    try {
      validateGitRef(candidate);
    } catch {
      continue;
    }
    if (await commitExists(repoRoot, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function ensureWorktreeDirExcludedInGitInfo(repoRoot: string): Promise<void> {
  try {
    const commonRes = await runGit(repoRoot, ['rev-parse', '--git-common-dir']);
    if (!commonRes.ok || !commonRes.stdout.trim()) return;
    const rawCommonDir = commonRes.stdout.trim();
    const commonDir = path.isAbsolute(rawCommonDir)
      ? rawCommonDir
      : path.resolve(repoRoot, rawCommonDir);

    const commonStat = fs.lstatSync(commonDir);
    if (commonStat.isSymbolicLink() || !commonStat.isDirectory()) return;
    const realCommonDir = fs.realpathSync(commonDir);
    if (!fs.statSync(realCommonDir).isDirectory()) return;

    const infoDir = path.join(realCommonDir, 'info');
    if (!isPathInside(realCommonDir, infoDir)) return;

    let infoExists = false;
    try {
      const infoStat = fs.lstatSync(infoDir);
      if (infoStat.isSymbolicLink() || !infoStat.isDirectory()) return;
      infoExists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return;
    }

    if (!infoExists) {
      fs.mkdirSync(infoDir);
      const createdInfoStat = fs.lstatSync(infoDir);
      if (createdInfoStat.isSymbolicLink() || !createdInfoStat.isDirectory()) return;
    }

    const realInfoDir = fs.realpathSync(infoDir);
    if (!isPathInside(realCommonDir, realInfoDir)) return;

    const excludeFile = path.join(realInfoDir, 'exclude');
    if (!isPathInside(realCommonDir, excludeFile) || !isPathInside(realInfoDir, excludeFile)) {
      return;
    }

    let excludeExists = false;
    let realExcludeFile = excludeFile;
    try {
      const excludeStat = fs.lstatSync(excludeFile);
      if (excludeStat.isSymbolicLink() || !excludeStat.isFile()) return;
      realExcludeFile = fs.realpathSync(excludeFile);
      if (
        !isPathInside(realCommonDir, realExcludeFile) ||
        !isPathInside(realInfoDir, realExcludeFile)
      ) {
        return;
      }
      excludeExists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return;
    }

    let existing = '';
    if (excludeExists) {
      existing = fs.readFileSync(realExcludeFile, 'utf8');
    }

    const pattern = `/${WORKTREE_MANAGED_DIR}/`;
    const hasEntry = existing
      .split(/\r?\n/)
      .some((line) => {
        const trimmed = line.trim();
        return (
          trimmed === WORKTREE_MANAGED_DIR ||
          trimmed === `${WORKTREE_MANAGED_DIR}/` ||
          trimmed === pattern
        );
      });
    if (hasEntry) return;

    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    const lineToWrite = `${prefix}${pattern}\n`;
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;

    if (excludeExists) {
      const reStat = fs.lstatSync(realExcludeFile);
      if (reStat.isSymbolicLink() || !reStat.isFile()) return;
      const fd = fs.openSync(
        realExcludeFile,
        fs.constants.O_WRONLY | fs.constants.O_APPEND | noFollow,
      );
      try {
        fs.writeSync(fd, lineToWrite, undefined, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    } else {
      const fd = fs.openSync(
        excludeFile,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o644,
      );
      try {
        fs.writeSync(fd, lineToWrite, undefined, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    // Best-effort only; never block worktree creation
  }
}

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
    ctx.rawEntries.find((e) => e.path === ctx.toplevelReal) ?? mainEntry;

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

  const repoRealRoot = fs.realpathSync(ctx.mainRootReal);

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
    const realManaged = fs.realpathSync(managedRootCandidate);
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
  const realManagedRoot = fs.realpathSync(managedRootCandidate);
  if (!isPathInside(repoRealRoot, realManagedRoot)) {
    throw new Error('Controlled worktree root escapes repository boundary after creation.');
  }

  const targetPath = path.join(realManagedRoot, safeSlug);
  if (path.dirname(targetPath) !== realManagedRoot || !isPathInside(realManagedRoot, targetPath)) {
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

  const state = await inspectWorktrees(workspaceRoot);
  const canonicalTarget = canonicalizePath(targetPath);
  const created = state.worktrees.find((w) => w.path === canonicalTarget);
  if (!created) {
    throw new Error(`Worktree was added at ${canonicalTarget} but could not be verified in worktree list.`);
  }

  return {
    created,
    carriedUncommitted,
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
    normalizedInput = fs.realpathSync(path.resolve(worktreePath));
  } catch {
    throw new Error(`Worktree path does not exist or is not accessible: ${worktreePath}`);
  }

  const matched = ctx.rawEntries.find((w) => w.path === normalizedInput);
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

  const target = currentState.worktrees.find((w) => w.path === normalizedTarget);
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

// ---------------------------------------------------------------------------
// Demo Mode: 100% in-memory synthetic store (zero Git commands, zero disk I/O)
// ---------------------------------------------------------------------------

export interface DemoWorktreeStore {
  list: () => WorktreeInspectResult;
  create: (opts: CreateWorktreeOptions) => CreateWorktreeResult;
  diffSummary: (worktreePath: string, baseRef?: string) => WorktreeDiffSummaryResult;
  cleanup: (opts: CleanupWorktreeOptions) => CleanupWorktreeResult;
}

interface DemoDiffRecord {
  statText: string;
  files: WorktreeDiffFile[];
}

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

  return {
    list: () => buildState(),

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
      if (entries.some((e) => e.path === targetPath)) {
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

      return {
        created: { ...created },
        carriedUncommitted: carried,
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
      const entry = entries.find((e) => e.path === normalized);
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
      const idx = entries.findIndex((e) => e.path === normalized);
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
