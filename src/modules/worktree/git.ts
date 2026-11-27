import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import {
  WORKTREE_MANAGED_DIR,
  type GitExecResult,
  type ParsedPorcelainWorktree,
  type WorktreeDiffFile,
} from './types.js';

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const GIT_REF_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const DIR_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ZERO_SHA_REGEX = /^0+$/;

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
  return isPathInsideDir(parentReal, childReal) && !isSamePath(parentReal, childReal);
}

/**
 * Canonicalize a filesystem path via `canonicalRealpathSync`.
 * If the leaf no longer exists (e.g. an orphaned/prunable worktree directory),
 * resolve the deepest existing ancestor via `canonicalRealpathSync` and re-attach remaining segments.
 */
export function canonicalizePath(inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) {
    throw new Error('Invalid path: must be a non-empty string without NUL bytes.');
  }
  const resolved = path.resolve(inputPath);
  try {
    return canonicalRealpathSync(resolved);
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
        const realAncestor = canonicalRealpathSync(cursor);
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
export function runGit(cwd: string, args: string[], stdinText?: string): Promise<GitExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd,
        shell: false,
        windowsHide: true,
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

export function parsePorcelainStatusEntries(stdout: string): WorktreeDiffFile[] {
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

export function parseNameStatusOutput(stdout: string): WorktreeDiffFile[] {
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

export function parseAheadBehind(stdout: string): { behind: number; ahead: number } {
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

export async function resolveGitContext(workspaceRoot: string): Promise<{
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

export async function commitExists(cwd: string, ref: string): Promise<boolean> {
  const res = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return res.ok && res.stdout.trim().length > 0;
}

export async function resolveDefaultBaseBranch(
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

export async function ensureWorktreeDirExcludedInGitInfo(repoRoot: string): Promise<void> {
  try {
    const commonRes = await runGit(repoRoot, ['rev-parse', '--git-common-dir']);
    if (!commonRes.ok || !commonRes.stdout.trim()) return;
    const rawCommonDir = commonRes.stdout.trim();
    const commonDir = path.isAbsolute(rawCommonDir)
      ? rawCommonDir
      : path.resolve(repoRoot, rawCommonDir);

    const commonStat = fs.lstatSync(commonDir);
    if (commonStat.isSymbolicLink() || !commonStat.isDirectory()) return;
    const realCommonDir = canonicalRealpathSync(commonDir);
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

    const realInfoDir = canonicalRealpathSync(infoDir);
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
      realExcludeFile = canonicalRealpathSync(excludeFile);
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
