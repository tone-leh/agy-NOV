import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RETRYABLE_WIN_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WIN_RETRY_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function syncSleepMs(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(WIN_RETRY_SLEEP_BUF, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback spin when Atomics.wait is unavailable
    }
  }
}

/**
 * Canonical realpath resolution using `fs.realpathSync.native` when available so
 * Windows 8.3 short paths (e.g. `RUNNER~1`) and drive-letter casing are normalized.
 */
export function canonicalRealpathSync(targetPath: string): string {
  const nativeFn = fs.realpathSync.native;
  return typeof nativeFn === 'function' ? nativeFn(targetPath) : fs.realpathSync(targetPath);
}

/**
 * Normalize a resolved path for equality / containment comparison across platforms.
 * Windows paths are case-insensitive, strip `\\?\` / `\\?\UNC\` extended prefixes, and
 * normalize `/` to `\`; POSIX paths stay case-sensitive.
 */
export function normalizePathForCompare(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!p) return '';
  if (platform === 'win32') {
    let winPath = p.replace(/\//g, '\\');
    if (/^\\\\\?\\UNC\\/i.test(winPath)) {
      winPath = `\\\\${winPath.slice(8)}`;
    } else if (/^\\\\\?\\[A-Za-z]:\\/.test(winPath)) {
      winPath = winPath.slice(4);
    }
    const norm = path.win32.normalize(winPath);
    const isDriveRoot = /^[A-Za-z]:\\$/.test(norm);
    const trimmed =
      !isDriveRoot && norm.length > 1 && norm.endsWith('\\')
        ? norm.replace(/\\+$/, '')
        : norm;
    return trimmed.toLowerCase();
  }
  const norm = path.posix.normalize(p);
  return norm.length > 1 && norm.endsWith('/') ? norm.replace(/\/+$/, '') : norm;
}

export function isSamePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return normalizePathForCompare(a, platform) === normalizePathForCompare(b, platform);
}

/**
 * Cross-platform directory containment check (`targetReal` is equal to or strictly inside `rootReal`).
 */
export function isPathInsideDir(
  rootReal: string,
  targetReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normRoot = normalizePathForCompare(rootReal, platform);
  const normTarget = normalizePathForCompare(targetReal, platform);
  if (!normRoot || !normTarget) return false;
  if (normTarget === normRoot) return true;
  const sep = platform === 'win32' ? '\\' : '/';
  const prefix = normRoot.endsWith(sep) ? normRoot : `${normRoot}${sep}`;
  return normTarget.startsWith(prefix);
}

/**
 * Recognize legitimate OS-level root symlinks so ancestor symlink checks do not
 * false-positive on macOS (`/var`, `/tmp`, `/etc`), Linux (`/home -> /var/home`,
 * `/var/run -> /run`, `/var/lock`, `/tmp`, `/bin`, `/sbin`, `/lib`, `/lib64`),
 * or Windows drive roots (`C:\`).
 */
export function isPlatformSystemSymlink(
  segmentPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'darwin') {
    return /^\/(?:var|tmp|etc)$/.test(segmentPath);
  }
  if (platform === 'linux') {
    return /^\/(?:home|tmp|var\/run|var\/lock|bin|sbin|lib|lib64)$/.test(segmentPath);
  }
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]?$/.test(segmentPath);
  }
  return false;
}

/**
 * Check whether `targetPath` or any non-system ancestor is a symlink.
 * Stops safely at filesystem root (never triggers false positives on `C:\` or Linux system symlinks).
 */
export function hasUnsafeSymlinkAncestor(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  let cur = path.resolve(targetPath);
  const root = path.parse(cur).root;
  while (true) {
    if (cur === root) return false;
    if (!isPlatformSystemSymlink(cur, platform)) {
      try {
        const st = fs.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') return true;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * Cross-platform atomic rename with bounded short retries on Windows NTFS transient
 * `EPERM` / `EBUSY` / `EACCES` locks (e.g. concurrent reader or AV scan). Cleans up
 * `tmpPath` best-effort if all attempts fail (unless `cleanupSourceOnError` is false).
 */
export function atomicRenameSync(
  tmpPath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
  cleanupSourceOnError = true,
): void {
  const retryDelays = platform === 'win32' ? [10, 20, 40, 60, 80] : [];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code ?? '';
      if (attempt < retryDelays.length && RETRYABLE_WIN_RENAME_CODES.has(code)) {
        syncSleepMs(retryDelays[attempt]);
        continue;
      }
      break;
    }
  }
  if (cleanupSourceOnError) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
  }
  throw lastErr;
}

export function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore on platforms that don't support POSIX mode bits
  }
}

export interface AtomicWriteJsonOptions {
  /**
   * Optional top-level object keys (e.g. `['updatedAt']`) ignored when checking whether
   * an existing regular 0600 JSON file already holds semantically identical data.
   */
  ignoreTopLevelKeys?: readonly string[];
}

const MAX_DIRTY_CHECK_BYTES = 4 * 1024 * 1024;

function stableCanonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) return JSON.stringify(value);
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCanonicalJson(item, depth + 1)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of keys) {
    if (obj[key] === undefined) continue;
    entries.push(`${JSON.stringify(key)}:${stableCanonicalJson(obj[key], depth + 1)}`);
  }
  return `{${entries.join(',')}}`;
}

function stripTopLevelKeys(
  obj: Record<string, unknown>,
  ignoreKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!ignoreKeys.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function isExistingJsonSemanticallyEqual(
  filePath: string,
  payloadBuf: Buffer,
  serializedText: string,
  ignoreTopLevelKeys?: readonly string[],
): boolean {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_DIRTY_CHECK_BYTES) {
      return false;
    }
    if (process.platform !== 'win32' && (st.mode & 0o777) !== 0o600) {
      return false;
    }

    const hasIgnoreKeys = Boolean(ignoreTopLevelKeys && ignoreTopLevelKeys.length > 0);
    if (!hasIgnoreKeys && st.size !== payloadBuf.byteLength) {
      return false;
    }

    const existingBuf = fs.readFileSync(filePath);
    if (existingBuf.byteLength === payloadBuf.byteLength && existingBuf.equals(payloadBuf)) {
      return true;
    }

    if (!hasIgnoreKeys) {
      return false;
    }

    const existingParsed = JSON.parse(existingBuf.toString('utf8')) as unknown;
    const nextParsed = JSON.parse(serializedText) as unknown;
    if (
      !existingParsed ||
      typeof existingParsed !== 'object' ||
      Array.isArray(existingParsed) ||
      !nextParsed ||
      typeof nextParsed !== 'object' ||
      Array.isArray(nextParsed)
    ) {
      return false;
    }

    const ignoreSet = new Set(ignoreTopLevelKeys);
    return (
      stableCanonicalJson(stripTopLevelKeys(existingParsed as Record<string, unknown>, ignoreSet)) ===
      stableCanonicalJson(stripTopLevelKeys(nextParsed as Record<string, unknown>, ignoreSet))
    );
  } catch {
    return false;
  }
}

export function atomicWriteJson(
  filePath: string,
  data: unknown,
  options?: AtomicWriteJsonOptions,
): boolean {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const payloadBuf = Buffer.from(serialized, 'utf8');

  if (
    isExistingJsonSemanticallyEqual(
      filePath,
      payloadBuf,
      serialized,
      options?.ignoreTopLevelKeys,
    )
  ) {
    return false;
  }

  ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, payloadBuf, { mode: 0o600 });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // ignore on platforms without POSIX mode bits
    }
    atomicRenameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Strictly read-only JSON reader with byte cap and symlink refusal.
 * Never creates directories or files and returns `null` on missing/oversized/malformed files.
 */
export function safeReadJsonReadOnly(filePath: string, maxBytes = 2 * 1024 * 1024): unknown | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const DEFAULT_FILE_LOCK_TIMEOUT_MS = 1500;
const DEFAULT_FILE_LOCK_STALE_MS = 15_000;
const MAX_LOCK_FILE_READ_BYTES = 4096;

export interface FileLockOptions {
  /** Max total milliseconds to wait on lock contention before best-effort fallback (default 1500ms). */
  timeoutMs?: number;
  /** Lock age threshold (ms) after which an existing lock file is considered stale and reclaimed (default 15000ms). */
  staleMs?: number;
}

/**
 * Pure read-only PID liveness probe (`process.kill(pid, 0)`) kept local to Layer 1 `fs-safe.ts`
 * so `fs-safe.ts` avoids a circular import with `process-safe.ts` (which imports `fs-safe.ts`).
 */
function isLockPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM';
  }
}

function readLockHolderMetadata(
  lockPath: string,
  size: number,
): { pid?: number; ts?: number; id?: string } | null {
  if (size <= 0 || size > MAX_LOCK_FILE_READ_BYTES) {
    return null;
  }
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const rec = parsed as Record<string, unknown>;
    const pid =
      typeof rec.pid === 'number' && Number.isInteger(rec.pid) && rec.pid > 0
        ? rec.pid
        : undefined;
    const ts =
      typeof rec.ts === 'number' && Number.isFinite(rec.ts) && rec.ts > 0
        ? rec.ts
        : undefined;
    const id =
      typeof rec.id === 'string' && rec.id.length > 0 && rec.id.length <= 64
        ? rec.id
        : undefined;
    return { pid, ts, id };
  } catch {
    return null;
  }
}

function unlinkFileWithWinRetry(filePath: string): void {
  const maxAttempts = process.platform === 'win32' ? 6 : 1;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        return;
      }
      if (
        process.platform === 'win32' &&
        code &&
        RETRYABLE_WIN_RENAME_CODES.has(code) &&
        i < maxAttempts - 1
      ) {
        syncSleepMs((i + 1) * 5);
        continue;
      }
      return;
    }
  }
}

function reclaimStaleLockSafely(
  lockPath: string,
  expectedSt: fs.Stats,
  staleMs: number,
): boolean {
  const reclaimPath = `${lockPath}.reclaim`;
  try {
    const existingReclaim = fs.lstatSync(reclaimPath);
    if (existingReclaim.isSymbolicLink()) {
      return false;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      return false;
    }
  }

  let reclaimFd: number | null = null;
  try {
    reclaimFd = fs.openSync(reclaimPath, 'wx', 0o600);
    try {
      fs.writeSync(reclaimFd, JSON.stringify({ pid: process.pid, ts: Date.now() }), undefined, 'utf8');
    } catch {
      // best-effort metadata
    }
    try {
      fs.closeSync(reclaimFd);
    } catch {
      // ignore close error
    }
    reclaimFd = null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EEXIST') {
      // Another contender is actively reclaiming; only clear an orphaned reclaim lock if dead/expired
      try {
        const rst = fs.lstatSync(reclaimPath);
        if (!rst.isSymbolicLink() && rst.isFile()) {
          const reclaimMaxAge = Math.max(2000, Math.min(staleMs, 10_000));
          const ageExpired = Date.now() - rst.mtimeMs > reclaimMaxAge;
          const rMeta = !ageExpired ? readLockHolderMetadata(reclaimPath, rst.size) : null;
          const rDead = rMeta?.pid !== undefined && !isLockPidAlive(rMeta.pid);
          if (ageExpired || rDead) {
            unlinkFileWithWinRetry(reclaimPath);
          }
        }
      } catch {
        // ignore inspection race
      }
    }
    return false;
  }

  try {
    const recheck = fs.lstatSync(lockPath);
    if (recheck.isSymbolicLink() || !recheck.isFile()) {
      return false;
    }
    const sameIdentity =
      expectedSt.ino !== 0 && recheck.ino !== 0
        ? recheck.ino === expectedSt.ino && recheck.mtimeMs === expectedSt.mtimeMs
        : recheck.mtimeMs === expectedSt.mtimeMs && recheck.size === expectedSt.size;
    if (!sameIdentity) {
      return false;
    }
    // Re-verify staleness/dead-PID while holding the single-winner reclaim coordinator lock
    const stillAgeStale = Date.now() - recheck.mtimeMs > staleMs;
    const stillDeadPid = !stillAgeStale
      ? (() => {
          const meta = readLockHolderMetadata(lockPath, recheck.size);
          return meta?.pid !== undefined && !isLockPidAlive(meta.pid);
        })()
      : false;
    if (!stillAgeStale && !stillDeadPid) {
      return false;
    }
    unlinkFileWithWinRetry(lockPath);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  } finally {
    if (reclaimFd !== null) {
      try {
        fs.closeSync(reclaimFd);
      } catch {
        // ignore close error
      }
    }
    try {
      const rst = fs.lstatSync(reclaimPath);
      if (!rst.isSymbolicLink() && rst.isFile()) {
        unlinkFileWithWinRetry(reclaimPath);
      }
    } catch {
      // already removed
    }
  }
}

/**
 * Cross-process exclusive advisory file lock (`${targetFilePath}.lock`) using atomic `O_CREAT | O_EXCL` (`wx`).
 *
 * Refuses symlink lock files / unsafe symlink ancestors, uses zero-CPU `Atomics.wait` short backoff
 * (4–25ms), reclaims stale or dead-PID locks via a single-winner `.reclaim` coordinator lock (preventing
 * `lstat -> unlink` TOCTOU races), handles Windows NTFS transient `EPERM`/`EBUSY`/`EACCES`, always cleans
 * up owned locks in `finally`, and degrades to best-effort execution of `fn()` on timeout so hooks never deadlock.
 */
export function withFileLockSync<T>(
  targetFilePath: string,
  fn: () => T,
  opts?: FileLockOptions,
): T {
  const lockPath = `${targetFilePath}.lock`;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? Math.max(0, Math.floor(opts.timeoutMs))
      : DEFAULT_FILE_LOCK_TIMEOUT_MS;
  const staleMs =
    typeof opts?.staleMs === 'number' && Number.isFinite(opts.staleMs)
      ? Math.max(0, Math.floor(opts.staleMs))
      : DEFAULT_FILE_LOCK_STALE_MS;

  // Reject symlink lock files or unsafe symlink ancestors before touching parent directories
  if (hasUnsafeSymlinkAncestor(lockPath)) {
    return fn();
  }
  try {
    const existing = fs.lstatSync(lockPath);
    if (existing.isSymbolicLink()) {
      return fn();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return fn();
    }
  }

  try {
    ensurePrivateDir(path.dirname(lockPath));
  } catch {
    return fn();
  }

  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;
  let acquired = false;
  let lockTs = 0;
  let lockIno: number | null = null;
  let lockNonce = '';
  let wroteMetadata = false;
  let attempt = 0;
  let winTransientErrors = 0;

  while (true) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      acquired = true;
      lockTs = Date.now();
      lockNonce = crypto.randomBytes(6).toString('hex');
      wroteMetadata = false;
      try {
        const payload = JSON.stringify({ pid: process.pid, ts: lockTs, id: lockNonce });
        fs.writeSync(fd, payload, undefined, 'utf8');
        wroteMetadata = true;
      } catch {
        // Exclusive lock file is already created; metadata write failure is non-fatal
      }
      try {
        fs.fchmodSync(fd, 0o600);
      } catch {
        // Ignore on platforms without POSIX mode bits
      }
      try {
        const st = fs.fstatSync(fd);
        lockIno = st.ino !== 0 ? st.ino : null;
      } catch {
        lockIno = null;
      }
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
      fd = null;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (
        process.platform === 'win32' &&
        code &&
        RETRYABLE_WIN_RENAME_CODES.has(code) &&
        winTransientErrors < 6
      ) {
        const remainingWin = deadline - Date.now();
        if (remainingWin > 0) {
          winTransientErrors += 1;
          syncSleepMs(Math.min(remainingWin, 6 * winTransientErrors));
          continue;
        }
      }
      if (code !== 'EEXIST') {
        // Non-contention error (e.g. EACCES, EROFS, ENOSPC, ELOOP): degrade best-effort
        break;
      }

      // Inspect existing lock file safely without following symlinks
      let st: fs.Stats;
      try {
        st = fs.lstatSync(lockPath);
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException)?.code === 'ENOENT') {
          if (Date.now() < deadline) {
            attempt += 1;
            continue;
          }
          break;
        }
        break;
      }

      if (st.isSymbolicLink()) {
        // Refuse to follow or unlink a symlinked lock file; degrade immediately
        break;
      }

      if (st.isFile()) {
        const now = Date.now();
        const ageStale = now - st.mtimeMs > staleMs;
        const deadPid = !ageStale
          ? (() => {
              const meta = readLockHolderMetadata(lockPath, st.size);
              return meta?.pid !== undefined && !isLockPidAlive(meta.pid);
            })()
          : false;
        if (ageStale || deadPid) {
          const reclaimed = reclaimStaleLockSafely(lockPath, st, staleMs);
          if (reclaimed) {
            attempt += 1;
            if (Date.now() <= deadline || attempt <= 2) {
              continue;
            }
            break;
          }
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      const waitMs = Math.min(remaining, Math.min(25, 4 + attempt * 3 + (attempt % 4)));
      attempt += 1;
      syncSleepMs(waitMs);
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
      fd = null;
    }
    if (acquired) {
      try {
        const st = fs.lstatSync(lockPath);
        if (!st.isSymbolicLink() && st.isFile()) {
          let isOurs = false;
          if (lockIno !== null && st.ino !== 0) {
            isOurs = st.ino === lockIno;
          } else {
            const meta = readLockHolderMetadata(lockPath, st.size);
            isOurs =
              (meta !== null &&
                meta.pid === process.pid &&
                meta.ts === lockTs &&
                meta.id === lockNonce) ||
              (!wroteMetadata && st.size === 0);
          }
          if (isOurs) {
            unlinkFileWithWinRetry(lockPath);
          }
        }
      } catch {
        // best-effort unlock
      }
    }
  }
}
