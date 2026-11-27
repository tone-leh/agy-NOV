import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyRiskTags,
  computeFileFingerprint,
  detectLineRiskHint,
  parseUnifiedDiff,
} from './diff-parser.js';
import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  ReviewScope,
  ReviewWorktreeOption,
} from './types.js';

export interface ScanGitDiffOptions {
  repoPath: string;
  scope?: ReviewScope;
  commitRange?: string;
  ignoreWhitespace?: boolean;
  maxLinesPerFile?: number;
  maxTotalLines?: number;
  maxUntrackedBytes?: number;
  maxGitBuffer?: number;
}

export interface ScanGitDiffResult {
  repoPath: string;
  repoName: string;
  repoKey: string;
  branch: string;
  headCommit?: string;
  scope: ReviewScope;
  commitRange?: string;
  ignoreWhitespace?: boolean;
  isGitRepo: boolean;
  notice?: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  files: DiffFile[];
}

const MAX_GIT_BUFFER = 20 * 1024 * 1024; // 20 MiB raw git stdout guard
const DEFAULT_MAX_LINES_PER_FILE = 600;
const DEFAULT_MAX_TOTAL_LINES = 3500;
const DEFAULT_MAX_UNTRACKED_BYTES = 256 * 1024; // 256 KiB per untracked file read guard

// Strict commit-range validation prevents Git option injection (e.g. --output=..., --exec=...)
const SAFE_REF_TOKEN = /^[A-Za-z0-9._/~^@:{}][A-Za-z0-9._/~^@:{}-]*$/;

export function validateCommitRange(range: string): string {
  const trimmed = range.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new Error('Invalid commitRange: must be a non-empty Git revision expression.');
  }
  if (trimmed.startsWith('-') || /[\0\r\n\s]/.test(trimmed)) {
    throw new Error('Invalid commitRange: flags and whitespace are disallowed.');
  }
  if (trimmed.includes('...')) {
    const parts = trimmed.split('...');
    if (parts.length !== 2 || !parts.every((p) => SAFE_REF_TOKEN.test(p))) {
      throw new Error(`Invalid commitRange syntax: "${trimmed}"`);
    }
    return trimmed;
  }
  if (trimmed.includes('..')) {
    const parts = trimmed.split('..');
    if (parts.length !== 2 || !parts.every((p) => SAFE_REF_TOKEN.test(p))) {
      throw new Error(`Invalid commitRange syntax: "${trimmed}"`);
    }
    return trimmed;
  }
  if (!SAFE_REF_TOKEN.test(trimmed)) {
    throw new Error(`Invalid commitRange syntax: "${trimmed}"`);
  }
  return trimmed;
}

export function computeRepoKey(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: string;
  isMaxBuffer: boolean;
}

function runGit(cwd: string, args: string[], maxBuffer = MAX_GIT_BUFFER): GitRunResult {
  try {
    const stdout = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return { ok: true, stdout, stderr: '', isMaxBuffer: false };
  } catch (err) {
    const e = err as {
      code?: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout ? e.stdout.toString('utf8') : '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr ? e.stderr.toString('utf8') : e.message ?? '';
    const isMaxBuffer =
      e.code === 'ENOBUFS' || /maxBuffer/i.test(e.message ?? '') || /maxBuffer/i.test(stderr);
    return {
      ok: false,
      stdout,
      stderr,
      code: e.code,
      isMaxBuffer,
    };
  }
}

export interface ReviewWorktreeContext {
  isGitRepo: boolean;
  toplevelReal: string;
  mainRootReal: string;
  worktrees: ReviewWorktreeOption[];
}

function parseReviewWorktreePorcelain(
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
      current = {
        rawPath: line.slice('worktree '.length),
        branch: null,
        bare: false,
      };
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

function checkWorktreeDirtyReadOnly(worktreeRealPath: string): boolean {
  const res = runGit(worktreeRealPath, ['status', '--porcelain'], 1024 * 1024);
  if (!res.ok) return false;
  for (const rawLine of res.stdout.split(/\r?\n/)) {
    if (!rawLine || rawLine.length < 4) continue;
    const xy = rawLine.slice(0, 2);
    const relPath = rawLine.slice(3);
    if (xy === '??' && (relPath === '.agy-worktrees' || relPath.startsWith('.agy-worktrees/'))) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Pure read-only discovery of all active registered Git worktrees belonging to `workspaceRoot`.
 */
export function listGitWorktreesReadOnly(workspaceRoot: string): ReviewWorktreeContext {
  const fallback = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
  if (!workspaceRoot || workspaceRoot.includes('\0') || !fs.existsSync(fallback)) {
    return { isGitRepo: false, toplevelReal: fallback, mainRootReal: fallback, worktrees: [] };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fallback);
  } catch {
    return { isGitRepo: false, toplevelReal: fallback, mainRootReal: fallback, worktrees: [] };
  }
  if (!stat.isDirectory()) {
    return { isGitRepo: false, toplevelReal: fallback, mainRootReal: fallback, worktrees: [] };
  }

  const topRes = runGit(fallback, ['rev-parse', '--show-toplevel'], 1024 * 1024);
  if (!topRes.ok || !topRes.stdout.trim()) {
    return { isGitRepo: false, toplevelReal: fallback, mainRootReal: fallback, worktrees: [] };
  }

  let toplevelReal: string;
  try {
    toplevelReal = fs.realpathSync(path.resolve(topRes.stdout.trim()));
  } catch {
    toplevelReal = path.resolve(topRes.stdout.trim());
  }

  const listRes = runGit(toplevelReal, ['worktree', 'list', '--porcelain'], 2 * 1024 * 1024);
  if (!listRes.ok) {
    return { isGitRepo: false, toplevelReal, mainRootReal: toplevelReal, worktrees: [] };
  }

  const parsed = parseReviewWorktreePorcelain(listRes.stdout);
  const worktrees: ReviewWorktreeOption[] = [];
  for (const item of parsed) {
    if (item.bare) continue;
    let realPath: string;
    try {
      const resolved = path.resolve(item.rawPath);
      if (!fs.statSync(resolved).isDirectory()) continue;
      realPath = fs.realpathSync(resolved);
    } catch {
      continue;
    }
    worktrees.push({
      path: realPath,
      branch: item.branch,
      isMain: item.isMain,
      isDirty: checkWorktreeDirtyReadOnly(realPath),
    });
  }

  const mainRootReal = worktrees.find((w) => w.isMain)?.path ?? toplevelReal;
  return {
    isGitRepo: true,
    toplevelReal,
    mainRootReal,
    worktrees,
  };
}

/**
 * Strictly validate that an optional requested worktree/repo path matches either the
 * main repository root or an active registered Git worktree of `mainWorkspaceRoot`
 * (using `realpathSync` and refusing symlink leaves or external directories).
 */
export function resolveAllowedReviewTarget(
  mainWorkspaceRoot: string,
  requestedPath?: string,
): { targetRepoPath: string; availableWorktrees: ReviewWorktreeOption[] } {
  const ctx = listGitWorktreesReadOnly(mainWorkspaceRoot);

  if (!requestedPath || !requestedPath.trim()) {
    return {
      targetRepoPath: ctx.isGitRepo ? ctx.toplevelReal : path.resolve(mainWorkspaceRoot),
      availableWorktrees: ctx.worktrees,
    };
  }

  const trimmed = requestedPath.trim();
  if (trimmed.includes('\0')) {
    throw new Error('Invalid worktree path: NUL byte is disallowed.');
  }

  const resolvedRequested = path.resolve(trimmed);
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(resolvedRequested);
  } catch {
    throw new Error(`Review target path does not exist or is not accessible: ${trimmed}`);
  }
  if (lstat.isSymbolicLink()) {
    throw new Error(`Refused: review target path "${trimmed}" must not be a symbolic link.`);
  }
  if (!lstat.isDirectory()) {
    throw new Error(`Refused: review target path "${trimmed}" is not a directory.`);
  }

  const realRequested = fs.realpathSync(resolvedRequested);

  if (!ctx.isGitRepo) {
    let mainReal: string;
    try {
      mainReal = fs.realpathSync(path.resolve(mainWorkspaceRoot));
    } catch {
      mainReal = path.resolve(mainWorkspaceRoot);
    }
    if (realRequested === mainReal) {
      return { targetRepoPath: realRequested, availableWorktrees: [] };
    }
    throw new Error(
      `Refused: "${trimmed}" is outside the active workspace (not a registered Git worktree).`,
    );
  }

  const matched = ctx.worktrees.find((w) => w.path === realRequested);
  if (!matched) {
    throw new Error(
      `Refused: "${trimmed}" is not the main repository or a registered Git worktree for this workspace.`,
    );
  }

  return {
    targetRepoPath: matched.path,
    availableWorktrees: ctx.worktrees,
  };
}

function formatGitDiffFailure(res: GitRunResult, scopeLabel: string, maxBufferBytes: number): {
  notice: string;
  hitTruncate: boolean;
} {
  if (res.isMaxBuffer) {
    const mb = (maxBufferBytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
    return {
      notice: `Git diff output for "${scopeLabel}" exceeded the ${mb} MiB buffer cap. Narrow the scope or filter a smaller commit range.`,
      hitTruncate: true,
    };
  }
  const detail = res.stderr.trim() || res.code || 'unknown git error';
  return {
    notice: `Git diff failed for "${scopeLabel}": ${detail}`,
    hitTruncate: false,
  };
}

function isBinaryBuffer(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function buildUntrackedDiffFile(
  repoRoot: string,
  relPath: string,
  maxLinesPerFile: number,
  remainingGlobalLines: number,
  maxUntrackedBytes: number,
): { file: DiffFile; consumedLines: number; hitTruncate: boolean } {
  const normalizedRel = relPath.replace(/\\/g, '/');
  const absPath = path.resolve(repoRoot, normalizedRel);

  const relativeCheck = path.relative(repoRoot, absPath);
  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    const file: DiffFile = {
      path: normalizedRel,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      isBinary: false,
      isTruncated: true,
      truncationReason: 'Skipped path outside repository root.',
      riskTags: classifyRiskTags(normalizedRel, 0, 0, true),
      fingerprint: computeFileFingerprint(normalizedRel, 'untracked', []),
      hunks: [],
    };
    return { file, consumedLines: 0, hitTruncate: true };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absPath);
  } catch {
    const file: DiffFile = {
      path: normalizedRel,
      absolutePath: absPath,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      isBinary: false,
      isTruncated: true,
      truncationReason: 'File could not be read.',
      riskTags: classifyRiskTags(normalizedRel, 0, 0, true),
      fingerprint: computeFileFingerprint(normalizedRel, 'untracked', []),
      hunks: [],
    };
    return { file, consumedLines: 0, hitTruncate: true };
  }

  if (!stat.isFile()) {
    const file: DiffFile = {
      path: normalizedRel,
      absolutePath: absPath,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      isBinary: true,
      isTruncated: false,
      riskTags: classifyRiskTags(normalizedRel, 0, 0, false),
      fingerprint: computeFileFingerprint(normalizedRel, 'untracked', []),
      hunks: [],
    };
    return { file, consumedLines: 0, hitTruncate: false };
  }

  const readBytes = Math.min(stat.size, maxUntrackedBytes);
  const buf = Buffer.alloc(readBytes);
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      if (readBytes > 0) {
        fs.readSync(fd, buf, 0, readBytes, 0);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    const file: DiffFile = {
      path: normalizedRel,
      absolutePath: absPath,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      isBinary: false,
      isTruncated: true,
      truncationReason: 'File could not be read.',
      riskTags: classifyRiskTags(normalizedRel, 0, 0, true),
      fingerprint: computeFileFingerprint(normalizedRel, 'untracked', []),
      hunks: [],
    };
    return { file, consumedLines: 0, hitTruncate: true };
  }

  if (isBinaryBuffer(buf)) {
    const file: DiffFile = {
      path: normalizedRel,
      absolutePath: absPath,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      isBinary: true,
      isTruncated: false,
      riskTags: classifyRiskTags(normalizedRel, 0, 0, false),
      fingerprint: computeFileFingerprint(normalizedRel, 'untracked', []),
      hunks: [],
    };
    return { file, consumedLines: 0, hitTruncate: false };
  }

  const byteTruncated = stat.size > maxUntrackedBytes;
  const text = buf.toString('utf8').replace(/\r\n/g, '\n');
  const rawLines = text.length === 0 ? [] : text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');

  const allowedLines = Math.max(0, Math.min(maxLinesPerFile, remainingGlobalLines));
  const sliceLen = Math.min(rawLines.length, allowedLines);
  const lineTruncated = byteTruncated || rawLines.length > allowedLines;

  const lines: DiffLine[] = [];
  for (let i = 0; i < sliceLen; i++) {
    const content = rawLines[i];
    const riskHint = detectLineRiskHint(content);
    lines.push({
      type: 'add',
      content,
      oldLine: null,
      newLine: i + 1,
      ...(riskHint ? { riskHint } : {}),
    });
  }

  const hunks: DiffHunk[] =
    lines.length > 0
      ? [
          {
            header: `@@ -0,0 +1,${rawLines.length} @@`,
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: rawLines.length,
            lines,
          },
        ]
      : [];

  const file: DiffFile = {
    path: normalizedRel,
    absolutePath: absPath,
    status: 'untracked',
    additions: rawLines.length,
    deletions: 0,
    isBinary: false,
    isTruncated: lineTruncated,
    truncationReason: lineTruncated
      ? byteTruncated
        ? `Untracked file exceeds ${Math.round(maxUntrackedBytes / 1024)} KB preview cap.`
        : `Untracked file truncated at ${allowedLines} lines for responsive inline review.`
      : undefined,
    riskTags: classifyRiskTags(normalizedRel, rawLines.length, 0, lineTruncated),
    fingerprint: computeFileFingerprint(normalizedRel, 'untracked', hunks),
    hunks,
  };

  return { file, consumedLines: lines.length, hitTruncate: lineTruncated };
}

function listUntrackedFiles(repoRoot: string): string[] {
  const res = runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!res.ok || !res.stdout) return [];
  return res.stdout.split('\0').filter((p) => p.length > 0);
}

export function scanGitDiff(options: ScanGitDiffOptions): ScanGitDiffResult {
  const requestedPath = path.resolve(options.repoPath || process.cwd());
  const scope: ReviewScope = options.scope ?? 'working';
  const ignoreWhitespace = Boolean(options.ignoreWhitespace);
  const wsArgs = ignoreWhitespace ? ['-w'] : [];
  const maxLinesPerFile = options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE;
  const maxTotalLines = options.maxTotalLines ?? DEFAULT_MAX_TOTAL_LINES;
  const maxUntrackedBytes = options.maxUntrackedBytes ?? DEFAULT_MAX_UNTRACKED_BYTES;
  const maxGitBuffer = options.maxGitBuffer ?? MAX_GIT_BUFFER;

  if (!fs.existsSync(requestedPath)) {
    return {
      repoPath: requestedPath,
      repoName: path.basename(requestedPath) || 'workspace',
      repoKey: computeRepoKey(requestedPath),
      branch: 'none',
      scope,
      commitRange: options.commitRange,
      isGitRepo: false,
      notice: `Directory does not exist: ${requestedPath}`,
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      truncated: false,
      files: [],
    };
  }

  const topLevelRes = runGit(requestedPath, ['rev-parse', '--show-toplevel']);
  if (!topLevelRes.ok || !topLevelRes.stdout.trim()) {
    return {
      repoPath: requestedPath,
      repoName: path.basename(requestedPath) || 'workspace',
      repoKey: computeRepoKey(requestedPath),
      branch: 'no-git',
      scope,
      commitRange: options.commitRange,
      isGitRepo: false,
      notice:
        'Current workspace is not a Git repository. Open a Git project folder or launch Demo mode to explore Diff Review.',
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      truncated: false,
      files: [],
    };
  }

  let repoRoot = path.resolve(topLevelRes.stdout.trim());
  try {
    repoRoot = fs.realpathSync(repoRoot);
  } catch {
    // Keep resolved path when realpath fails
  }
  const repoName = path.basename(repoRoot);
  const repoKey = computeRepoKey(repoRoot);

  const branchRes = runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']);
  let branch = branchRes.ok ? branchRes.stdout.trim() : '';
  const headRes = runGit(repoRoot, ['rev-parse', '--short', 'HEAD']);
  const hasHead = headRes.ok && Boolean(headRes.stdout.trim());
  const headCommit = hasHead ? headRes.stdout.trim() : undefined;
  if (!branch) {
    branch = hasHead ? `detached@${headCommit}` : 'unborn';
  }

  let rawDiff = '';
  let includeUntracked = false;
  let effectiveRange = options.commitRange;
  let notice: string | undefined;
  let gitBufferTruncated = false;

  const recordDiffResult = (res: GitRunResult, label: string): string => {
    if (!res.ok) {
      const failure = formatGitDiffFailure(res, label, maxGitBuffer);
      notice = notice ? `${notice} ${failure.notice}` : failure.notice;
      if (failure.hitTruncate) gitBufferTruncated = true;
    }
    return res.stdout;
  };

  if (scope === 'working') {
    includeUntracked = true;
    if (hasHead) {
      const diffRes = runGit(
        repoRoot,
        ['diff', 'HEAD', '--unified=3', '--find-renames', ...wsArgs, '--'],
        maxGitBuffer,
      );
      rawDiff = recordDiffResult(diffRes, 'working');
    } else {
      const stagedRes = runGit(
        repoRoot,
        ['diff', '--cached', '--unified=3', '--find-renames', ...wsArgs, '--'],
        maxGitBuffer,
      );
      const unstagedRes = runGit(
        repoRoot,
        ['diff', '--unified=3', '--find-renames', ...wsArgs, '--'],
        maxGitBuffer,
      );
      rawDiff = [
        recordDiffResult(stagedRes, 'staged'),
        recordDiffResult(unstagedRes, 'unstaged'),
      ]
        .filter(Boolean)
        .join('\n');
    }
  } else if (scope === 'staged') {
    const diffRes = runGit(
      repoRoot,
      ['diff', '--cached', '--unified=3', '--find-renames', ...wsArgs, '--'],
      maxGitBuffer,
    );
    rawDiff = recordDiffResult(diffRes, 'staged');
  } else if (scope === 'unstaged') {
    includeUntracked = true;
    const diffRes = runGit(
      repoRoot,
      ['diff', '--unified=3', '--find-renames', ...wsArgs, '--'],
      maxGitBuffer,
    );
    rawDiff = recordDiffResult(diffRes, 'unstaged');
  } else if (scope === 'head~1') {
    if (!hasHead) {
      notice = 'Repository has no commits yet.';
    } else {
      const parentCheck = runGit(repoRoot, ['rev-parse', '--verify', 'HEAD~1']);
      if (parentCheck.ok) {
        const diffRes = runGit(
          repoRoot,
          ['diff', 'HEAD~1', 'HEAD', '--unified=3', '--find-renames', ...wsArgs, '--'],
          maxGitBuffer,
        );
        rawDiff = recordDiffResult(diffRes, 'head~1');
      } else {
        const diffRes = runGit(
          repoRoot,
          ['show', '--format=', '--unified=3', '--find-renames', ...wsArgs, 'HEAD', '--'],
          maxGitBuffer,
        );
        rawDiff = recordDiffResult(diffRes, 'HEAD');
      }
    }
  } else if (scope === 'commit-range') {
    effectiveRange = validateCommitRange(options.commitRange || 'HEAD~1..HEAD');
    const diffRes = runGit(
      repoRoot,
      ['diff', effectiveRange, '--unified=3', '--find-renames', ...wsArgs, '--'],
      maxGitBuffer,
    );
    rawDiff = recordDiffResult(diffRes, effectiveRange);
  }

  const parsed = parseUnifiedDiff(rawDiff, {
    repoPath: repoRoot,
    maxLinesPerFile,
    maxTotalLines,
  });

  const files: DiffFile[] = [...parsed.files];
  let truncated = parsed.truncated || gitBufferTruncated;
  let consumedGlobalLines = files.reduce(
    (sum, f) => sum + f.hunks.reduce((hs, h) => hs + h.lines.length, 0),
    0,
  );

  if (includeUntracked) {
    const existingPaths = new Set(files.map((f) => f.path));
    const untracked = listUntrackedFiles(repoRoot);
    for (const rel of untracked) {
      const normalized = rel.replace(/\\/g, '/');
      if (existingPaths.has(normalized)) continue;
      const remaining = Math.max(0, maxTotalLines - consumedGlobalLines);
      const { file, consumedLines, hitTruncate } = buildUntrackedDiffFile(
        repoRoot,
        normalized,
        maxLinesPerFile,
        remaining,
        maxUntrackedBytes,
      );
      files.push(file);
      consumedGlobalLines += consumedLines;
      if (hitTruncate) truncated = true;
    }
  }

  files.sort((a, b) => {
    const aSec = a.riskTags.includes('security-sensitive') ? 0 : 1;
    const bSec = b.riskTags.includes('security-sensitive') ? 0 : 1;
    if (aSec !== bSec) return aSec - bSec;
    return a.path.localeCompare(b.path);
  });

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return {
    repoPath: repoRoot,
    repoName,
    repoKey,
    branch,
    headCommit,
    scope,
    commitRange: effectiveRange,
    ignoreWhitespace,
    isGitRepo: true,
    notice,
    totalFiles: files.length,
    totalAdditions,
    totalDeletions,
    truncated,
    files,
  };
}
