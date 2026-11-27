import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isSamePath } from '../../core/utils.js';
import { isPathInside, resolveGitContext } from './git.js';
import {
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_CONFIG_BYTES,
  WORKTREE_INCLUDE_MAX_FILES,
  WORKTREE_INCLUDE_MAX_FILE_BYTES,
  WORKTREE_INCLUDE_MAX_TOTAL_BYTES,
  WORKTREE_MANAGED_DIR,
  type WorktreeIncludeEntry,
  type WorktreeIncludePreviewResult,
  type WorktreeIncludeSkippedItem,
} from './types.js';

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
export function applyWorktreeIncludeFiles(
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
