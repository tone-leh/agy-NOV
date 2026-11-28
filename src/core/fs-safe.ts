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
