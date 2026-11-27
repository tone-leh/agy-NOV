import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';

export const WORKTREE_MANAGED_DIR = '.agy-worktrees';
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude';
export const WORKTREE_INCLUDE_MAX_CONFIG_BYTES = 16 * 1024; // 16 KiB
export const WORKTREE_INCLUDE_MAX_FILES = 32;
export const WORKTREE_INCLUDE_MAX_FILE_BYTES = 512 * 1024; // 512 KiB
export const WORKTREE_INCLUDE_MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MiB

const ALLOWED_DOTENV_TEMPLATES: ReadonlySet<string> = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
]);

const SENSITIVE_DOTFILES: ReadonlySet<string> = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  '.pgpass',
  '.envrc',
  'kubeconfig',
]);

const SENSITIVE_EXTENSIONS_RE = /\.(pem|key|p12|pfx|jks|keystore)$/i;
const SENSITIVE_SSH_KEY_RE = /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:$|[._-])/i;
const SENSITIVE_DIRS: ReadonlySet<string> = new Set(['.ssh', '.gnupg', '.aws', '.kube']);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const GIT_REF_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const DIR_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ZERO_SHA_REGEX = /^0+$/;

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
function runGit(cwd: string, args: string[], stdinText?: string): Promise<GitExecResult> {
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

/**
 * Inspect whether a normalized workspace-relative path violates the `.worktreeinclude`
 * secret/credential redline. Returns a descriptive reason when blocked, or null when safe.
 */
export function detectSensitiveIncludePath(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return 'Empty path.';

  const parentSegments = segments.slice(0, -1);
  for (const seg of parentSegments) {
    const lower = seg.toLowerCase();
    if (SENSITIVE_DIRS.has(lower)) {
      return `Sensitive directory "${seg}" is blocked by secret policy.`;
    }
    if (
      lower === '.env' ||
      lower.startsWith('.env.') ||
      lower.endsWith('.env') ||
      lower.includes('.env.')
    ) {
      return `Sensitive dotenv directory "${seg}" is blocked by secret policy.`;
    }
    if (
      lower.includes('secret') ||
      lower.includes('credential') ||
      lower.includes('token') ||
      lower.includes('private_key') ||
      lower.includes('private-key')
    ) {
      return `Sensitive directory name "${seg}" is blocked by secret policy.`;
    }
  }

  const base = segments[segments.length - 1];
  const baseLower = base.toLowerCase();

  if (SENSITIVE_DIRS.has(baseLower)) {
    return `Sensitive directory "${base}" is blocked by secret policy.`;
  }

  if (
    baseLower === '.env' ||
    baseLower.startsWith('.env.') ||
    baseLower.endsWith('.env') ||
    baseLower.includes('.env.')
  ) {
    if (ALLOWED_DOTENV_TEMPLATES.has(baseLower)) {
      return null;
    }
    return `Sensitive dotenv file "${base}" is blocked (only .env.example/.env.sample/.env.template are permitted).`;
  }

  if (SENSITIVE_DOTFILES.has(baseLower)) {
    return `Sensitive credential config "${base}" is blocked by secret policy.`;
  }

  if (SENSITIVE_EXTENSIONS_RE.test(baseLower)) {
    return `Private key or certificate file "${base}" is blocked by secret policy.`;
  }

  if (SENSITIVE_SSH_KEY_RE.test(baseLower)) {
    return `SSH key file "${base}" is blocked by secret policy.`;
  }

  if (/service[-_]?account.*\.json$/i.test(baseLower)) {
    return `Cloud service-account credential "${base}" is blocked by secret policy.`;
  }

  if (
    baseLower.includes('secret') ||
    baseLower.includes('credential') ||
    baseLower.includes('token') ||
    /private[_-]?key|passwd|password/i.test(baseLower)
  ) {
    return `Sensitive filename "${base}" (secret/credential/token/key/password) is blocked by secret policy.`;
  }

  return null;
}

function normalizeIncludeRelPath(rawLine: string): { ok: true; relPath: string } | { ok: false; reason: string } {
  if (/[\x00-\x1f\x7f]/.test(rawLine)) {
    return { ok: false, reason: 'Control characters are disallowed.' };
  }
  if (
    rawLine.startsWith('/') ||
    rawLine.startsWith('\\') ||
    /^[A-Za-z]:/.test(rawLine) ||
    rawLine.startsWith('~')
  ) {
    return { ok: false, reason: 'Absolute or home paths are disallowed.' };
  }
  if (rawLine.includes('*') || rawLine.includes('?')) {
    return { ok: false, reason: 'Wildcards (* or ?) are disallowed.' };
  }
  if (rawLine.includes('\\')) {
    return { ok: false, reason: 'Backslashes are disallowed; use POSIX relative paths.' };
  }
  if (rawLine.endsWith('/')) {
    return { ok: false, reason: 'Directory trailing slash is disallowed; specify explicit files.' };
  }

  let candidate = rawLine;
  while (candidate.startsWith('./')) {
    candidate = candidate.slice(2);
  }
  if (!candidate || candidate === '.') {
    return { ok: false, reason: 'Empty or current-directory entry is disallowed.' };
  }

  const rawSegments = candidate.split('/');
  const cleanSegments: string[] = [];
  for (const seg of rawSegments) {
    if (!seg || seg === '.') {
      return { ok: false, reason: `Malformed path segment in "${rawLine}".` };
    }
    if (seg === '..') {
      return { ok: false, reason: 'Parent path traversal ("..") is disallowed.' };
    }
    cleanSegments.push(seg);
  }

  const relPath = cleanSegments.join('/');
  const firstLower = cleanSegments[0].toLowerCase();
  if (
    firstLower === '.git' ||
    firstLower === WORKTREE_MANAGED_DIR.toLowerCase() ||
    relPath.toLowerCase() === WORKTREE_INCLUDE_FILE
  ) {
    return { ok: false, reason: `Reserved repository path "${relPath}" cannot be included.` };
  }

  return { ok: true, relPath };
}

/**
 * Pure read-only inspection of `<repoRoot>/.worktreeinclude`.
 * Enforces symlink rejection, 16 KiB config cap, secret/dotenv redline,
 * realpath repo boundary, 32-file cap, 512 KiB single-file cap, and 4 MiB total cap.
 * Never executes scripts or modifies any file on disk.
 */
export function previewWorktreeInclude(repoRoot: string): WorktreeIncludePreviewResult {
  const fallbackRoot = repoRoot ? path.resolve(repoRoot) : process.cwd();
  const fallbackConfigPath = path.join(fallbackRoot, WORKTREE_INCLUDE_FILE);

  if (!repoRoot || typeof repoRoot !== 'string' || repoRoot.includes('\0')) {
    return {
      mode: 'live',
      repoRoot: fallbackRoot,
      hasConfig: false,
      configPath: fallbackConfigPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [],
      totalBytes: 0,
    };
  }

  let repoRealRoot: string;
  try {
    repoRealRoot = canonicalRealpathSync(path.resolve(repoRoot));
    if (!fs.statSync(repoRealRoot).isDirectory()) {
      return {
        mode: 'live',
        repoRoot: fallbackRoot,
        hasConfig: false,
        configPath: fallbackConfigPath,
        eligibleFiles: [],
        skippedSensitive: [],
        skippedInvalid: [],
        totalBytes: 0,
      };
    }
  } catch {
    return {
      mode: 'live',
      repoRoot: fallbackRoot,
      hasConfig: false,
      configPath: fallbackConfigPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [],
      totalBytes: 0,
    };
  }

  const configPath = path.join(repoRealRoot, WORKTREE_INCLUDE_FILE);
  let configLstat: fs.Stats;
  try {
    configLstat = fs.lstatSync(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {
        mode: 'live',
        repoRoot: repoRealRoot,
        hasConfig: false,
        configPath,
        eligibleFiles: [],
        skippedSensitive: [],
        skippedInvalid: [],
        totalBytes: 0,
      };
    }
    const warning = `Unable to inspect ${WORKTREE_INCLUDE_FILE}: ${(err as Error).message}`;
    return {
      mode: 'live',
      repoRoot: repoRealRoot,
      hasConfig: true,
      configPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
      totalBytes: 0,
      warning,
    };
  }

  if (configLstat.isSymbolicLink()) {
    const warning = `Refused: ${WORKTREE_INCLUDE_FILE} must not be a symbolic link.`;
    return {
      mode: 'live',
      repoRoot: repoRealRoot,
      hasConfig: true,
      configPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
      totalBytes: 0,
      warning,
    };
  }

  if (!configLstat.isFile()) {
    const warning = `Refused: ${WORKTREE_INCLUDE_FILE} must be a regular file.`;
    return {
      mode: 'live',
      repoRoot: repoRealRoot,
      hasConfig: true,
      configPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
      totalBytes: 0,
      warning,
    };
  }

  if (configLstat.size > WORKTREE_INCLUDE_MAX_CONFIG_BYTES) {
    const warning = `Refused: ${WORKTREE_INCLUDE_FILE} exceeds maximum size of ${WORKTREE_INCLUDE_MAX_CONFIG_BYTES} bytes (16 KiB).`;
    return {
      mode: 'live',
      repoRoot: repoRealRoot,
      hasConfig: true,
      configPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
      totalBytes: 0,
      warning,
    };
  }

  let rawContent: string;
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  try {
    const fd = fs.openSync(configPath, fs.constants.O_RDONLY | noFollow);
    try {
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.size > WORKTREE_INCLUDE_MAX_CONFIG_BYTES) {
        const warning = `Refused: ${WORKTREE_INCLUDE_FILE} failed file type or 16 KiB size check.`;
        return {
          mode: 'live',
          repoRoot: repoRealRoot,
          hasConfig: true,
          configPath,
          eligibleFiles: [],
          skippedSensitive: [],
          skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
          totalBytes: 0,
          warning,
        };
      }
      const buf = Buffer.alloc(fdStat.size);
      let offset = 0;
      while (offset < fdStat.size) {
        const n = fs.readSync(fd, buf, offset, fdStat.size - offset, offset);
        if (n <= 0) break;
        offset += n;
      }
      rawContent = buf.subarray(0, offset).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    const warning = `Failed to read ${WORKTREE_INCLUDE_FILE}: ${(err as Error).message}`;
    return {
      mode: 'live',
      repoRoot: repoRealRoot,
      hasConfig: true,
      configPath,
      eligibleFiles: [],
      skippedSensitive: [],
      skippedInvalid: [{ entry: WORKTREE_INCLUDE_FILE, reason: warning }],
      totalBytes: 0,
      warning,
    };
  }

  const eligibleFiles: WorktreeIncludeEntry[] = [];
  const skippedSensitive: WorktreeIncludeSkippedItem[] = [];
  const skippedInvalid: WorktreeIncludeSkippedItem[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const raw of rawContent.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = normalizeIncludeRelPath(trimmed);
    if (!normalized.ok) {
      skippedInvalid.push({ entry: trimmed, reason: normalized.reason });
      continue;
    }

    const relPath = normalized.relPath;
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const sensitiveReason = detectSensitiveIncludePath(relPath);
    if (sensitiveReason) {
      skippedSensitive.push({ entry: relPath, reason: sensitiveReason });
      continue;
    }

    // Walk every path segment using lstatSync to reject intermediate or leaf symlinks
    const segments = relPath.split('/');
    let cursor = repoRealRoot;
    let segmentError: string | null = null;
    let leafStat: fs.Stats | null = null;

    for (let i = 0; i < segments.length; i += 1) {
      cursor = path.join(cursor, segments[i]);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(cursor);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        segmentError =
          code === 'ENOENT'
            ? 'File does not exist in main repository.'
            : `Unable to inspect path: ${(err as Error).message}`;
        break;
      }
      if (st.isSymbolicLink()) {
        segmentError = 'Symbolic link is refused by .worktreeinclude security boundary.';
        break;
      }
      if (i < segments.length - 1) {
        if (!st.isDirectory()) {
          segmentError = 'Intermediate path segment is not a directory.';
          break;
        }
      } else {
        if (!st.isFile()) {
          segmentError = 'Entry must be a regular file (directories and special files are refused).';
          break;
        }
        leafStat = st;
      }
    }

    if (segmentError || !leafStat) {
      skippedInvalid.push({ entry: relPath, reason: segmentError ?? 'Invalid path.' });
      continue;
    }

    let realCandidate: string;
    try {
      realCandidate = canonicalRealpathSync(cursor);
    } catch {
      skippedInvalid.push({ entry: relPath, reason: 'Unable to resolve realpath inside repository.' });
      continue;
    }

    if (!isPathInside(repoRealRoot, realCandidate)) {
      skippedInvalid.push({ entry: relPath, reason: 'Resolved realpath escapes repository root.' });
      continue;
    }

    const realRel = path.relative(repoRealRoot, realCandidate).split(path.sep).join('/');
    const realSensitiveReason = detectSensitiveIncludePath(realRel);
    if (realSensitiveReason) {
      skippedSensitive.push({ entry: relPath, reason: realSensitiveReason });
      continue;
    }

    if (leafStat.size > WORKTREE_INCLUDE_MAX_FILE_BYTES) {
      skippedInvalid.push({
        entry: relPath,
        reason: `File size (${leafStat.size} bytes) exceeds 512 KiB per-file limit.`,
      });
      continue;
    }

    if (eligibleFiles.length >= WORKTREE_INCLUDE_MAX_FILES) {
      skippedInvalid.push({
        entry: relPath,
        reason: `Exceeds maximum ${WORKTREE_INCLUDE_MAX_FILES} included files limit.`,
      });
      continue;
    }

    if (totalBytes + leafStat.size > WORKTREE_INCLUDE_MAX_TOTAL_BYTES) {
      skippedInvalid.push({
        entry: relPath,
        reason: `Exceeds maximum 4 MiB cumulative size limit.`,
      });
      continue;
    }

    eligibleFiles.push({ path: relPath, sizeBytes: leafStat.size });
    totalBytes += leafStat.size;
  }

  return {
    mode: 'live',
    repoRoot: repoRealRoot,
    hasConfig: true,
    configPath,
    eligibleFiles,
    skippedSensitive,
    skippedInvalid,
    totalBytes,
  };
}

export async function previewWorktreeIncludeForWorkspace(
  workspaceRoot: string,
): Promise<WorktreeIncludePreviewResult> {
  const ctx = await resolveGitContext(workspaceRoot);
  const root = ctx.isGitRepo ? ctx.mainRootReal : workspaceRoot;
  return previewWorktreeInclude(root);
}

function ensureSafeDestSubdir(targetRealRoot: string, dirSegments: readonly string[]): string | null {
  let cursor = targetRealRoot;
  for (const seg of dirSegments) {
    cursor = path.join(cursor, seg);
    if (!isPathInside(targetRealRoot, cursor)) return null;
    try {
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        return null;
      }
      const realDir = canonicalRealpathSync(cursor);
      if (!isPathInside(targetRealRoot, realDir)) {
        return null;
      }
      cursor = realDir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        return null;
      }
      fs.mkdirSync(cursor, { mode: 0o755 });
      const createdSt = fs.lstatSync(cursor);
      if (createdSt.isSymbolicLink() || !createdSt.isDirectory()) {
        return null;
      }
      const realCreated = canonicalRealpathSync(cursor);
      if (!isPathInside(targetRealRoot, realCreated)) {
        return null;
      }
      cursor = realCreated;
    }
  }
  return cursor;
}

/**
 * Safely copy whitelisted regular files from main repository to a newly created worktree.
 * Never overwrites existing files, never follows symlinks, never executes scripts/hooks.
 */
function applyWorktreeIncludeFiles(
  repoRealRoot: string,
  targetWorktreePath: string,
): {
  includedFiles: string[];
  skippedSensitive: string[];
  skippedInvalid: string[];
  warning?: string;
} {
  const preview = previewWorktreeInclude(repoRealRoot);
  if (!preview.hasConfig) {
    return { includedFiles: [], skippedSensitive: [], skippedInvalid: [] };
  }

  const includedFiles: string[] = [];
  const skippedSensitive = preview.skippedSensitive.map((s) => s.entry);
  const skippedInvalid = preview.skippedInvalid.map((s) => s.entry);

  if (preview.eligibleFiles.length === 0) {
    return {
      includedFiles,
      skippedSensitive,
      skippedInvalid,
      ...(preview.warning ? { warning: preview.warning } : {}),
    };
  }

  const targetRealRoot = canonicalRealpathSync(targetWorktreePath);
  if (isSamePath(targetRealRoot, repoRealRoot)) {
    return {
      includedFiles,
      skippedSensitive,
      skippedInvalid: [...skippedInvalid, ...preview.eligibleFiles.map((e) => e.path)],
      warning: 'Refused to copy .worktreeinclude files onto the main repository.',
    };
  }

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let copiedBytes = 0;

  for (const item of preview.eligibleFiles) {
    const segments = item.path.split('/');
    const srcPath = path.join(repoRealRoot, ...segments);
    const parentSegments = segments.slice(0, -1);
    const fileName = segments[segments.length - 1];

    try {
      const realSrc = canonicalRealpathSync(srcPath);
      if (!isPathInside(repoRealRoot, realSrc)) {
        skippedInvalid.push(item.path);
        continue;
      }

      const safeDestDir = ensureSafeDestSubdir(targetRealRoot, parentSegments);
      if (!safeDestDir) {
        skippedInvalid.push(item.path);
        continue;
      }

      const destPath = path.join(safeDestDir, fileName);
      if (!isPathInside(targetRealRoot, destPath)) {
        skippedInvalid.push(item.path);
        continue;
      }

      // Never overwrite any existing file or symlink in the new worktree
      try {
        fs.lstatSync(destPath);
        skippedInvalid.push(item.path);
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          skippedInvalid.push(item.path);
          continue;
        }
      }

      // Read source via O_NOFOLLOW + fstat cap validation
      const srcFd = fs.openSync(srcPath, fs.constants.O_RDONLY | noFollow);
      let fileBuf: Buffer;
      try {
        const srcStat = fs.fstatSync(srcFd);
        if (
          !srcStat.isFile() ||
          srcStat.size > WORKTREE_INCLUDE_MAX_FILE_BYTES ||
          copiedBytes + srcStat.size > WORKTREE_INCLUDE_MAX_TOTAL_BYTES
        ) {
          skippedInvalid.push(item.path);
          continue;
        }
        fileBuf = Buffer.alloc(srcStat.size);
        let offset = 0;
        while (offset < srcStat.size) {
          const n = fs.readSync(srcFd, fileBuf, offset, srcStat.size - offset, offset);
          if (n <= 0) break;
          offset += n;
        }
        fileBuf = fileBuf.subarray(0, offset);
      } finally {
        fs.closeSync(srcFd);
      }

      // Create destination exclusively without execute bits and without following symlinks
      const destFd = fs.openSync(
        destPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o644,
      );
      try {
        if (fileBuf.length > 0) {
          fs.writeSync(destFd, fileBuf, 0, fileBuf.length, 0);
        }
      } finally {
        fs.closeSync(destFd);
      }

      // Post-write containment verification (critical on Windows where O_NOFOLLOW is 0)
      const destPostStat = fs.lstatSync(destPath);
      const realDest = canonicalRealpathSync(destPath);
      if (destPostStat.isSymbolicLink() || !isPathInside(targetRealRoot, realDest)) {
        try {
          if (!destPostStat.isSymbolicLink() && isPathInside(targetRealRoot, destPath)) {
            fs.unlinkSync(destPath);
          }
        } catch {
          // best-effort cleanup
        }
        skippedInvalid.push(item.path);
        continue;
      }

      copiedBytes += fileBuf.length;
      includedFiles.push(item.path);
    } catch {
      skippedInvalid.push(item.path);
    }
  }

  return {
    includedFiles,
    skippedSensitive,
    skippedInvalid,
    ...(preview.warning ? { warning: preview.warning } : {}),
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

// ---------------------------------------------------------------------------
// Demo Mode: 100% in-memory synthetic store (zero Git commands, zero disk I/O)
// ---------------------------------------------------------------------------

export interface DemoWorktreeStore {
  list: () => WorktreeInspectResult;
  previewInclude: () => WorktreeIncludePreviewResult;
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
