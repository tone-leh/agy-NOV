import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  atomicRenameSync,
  atomicWriteJson,
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
  withFileLockSync,
} from '../../core/utils.js';
import { computeLineDiff } from './diff.js';
import {
  isSensitivePath,
  normalizeBlockInboundPromptSecrets,
  normalizePermissionMode,
  redactCommand,
} from './policy.js';
import {
  DEFAULT_POLICY,
  type AuditEvent,
  type GuardDashboardState,
  type GuardDecision,
  type GuardPolicy,
  type SnapshotDiff,
  type SnapshotRecord,
  type TurnCheckpointDiff,
  type TurnCheckpointFileEntry,
  type TurnCheckpointSummary,
  type TurnRestoreResult,
  type WorkspaceScanReport,
} from './types.js';

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const MAX_SYMLINK_DEPTH = 20;
const TURN_GROUP_WINDOW_MS = 90_000;
const TURN_STEP_MAX_GAP = 4;
const TURN_STEP_MAX_WINDOW_MS = 5 * 60_000;
const BACKUP_TOOL_NAMES = new Set(['pre_restore_backup', 'pre_rewind_backup']);

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Ignore on platforms where chmod is unsupported
  }
}

function writePrivateJson(filePath: string, data: unknown): void {
  atomicWriteJson(filePath, data);
}

function writeFileWithWinReadonlyFallback(targetPath: string, content: string): void {
  try {
    fs.writeFileSync(targetPath, content, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      try {
        fs.chmodSync(targetPath, 0o666);
      } catch {
        // Ignore chmod failure and let retry surface original error if still unwritable
      }
      fs.writeFileSync(targetPath, content, 'utf8');
      return;
    }
    throw err;
  }
}

function unlinkWithWinReadonlyFallback(targetPath: string): void {
  try {
    fs.unlinkSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      try {
        fs.chmodSync(targetPath, 0o666);
      } catch {
        // Ignore chmod failure and let retry surface original error if still unremovable
      }
      fs.unlinkSync(targetPath);
      return;
    }
    throw err;
  }
}

export function resolveRealPathWithMissingTail(inputPath: string, depth = 0): string {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(`Too many levels of symbolic links: ${inputPath}`);
  }
  const resolved = path.resolve(inputPath);
  const missingSegments: string[] = [];
  let current = resolved;

  while (true) {
    try {
      const realBase = canonicalRealpathSync(current);
      return missingSegments.length > 0
        ? path.join(realBase, ...missingSegments.reverse())
        : realBase;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw err;
      }

      try {
        const lstat = fs.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(current);
          const resolvedLink = path.resolve(path.dirname(current), linkTarget);
          const nextTarget =
            missingSegments.length > 0
              ? path.join(resolvedLink, ...missingSegments.reverse())
              : resolvedLink;
          return resolveRealPathWithMissingTail(nextTarget, depth + 1);
        }
      } catch {
        // Entry itself does not exist; continue walking to nearest existing parent
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

export function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }
  if (!targetPath || targetPath.includes('\0')) {
    throw new Error('Invalid target path');
  }

  const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
  const candidate = path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath);
  const realTarget = resolveRealPathWithMissingTail(candidate);

  if (!isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Path escapes workspace boundary: ${targetPath}`);
  }

  return realTarget;
}

function assertNotSensitive(
  rawPath: string,
  realPath: string,
  customProtectedPaths: string[],
  action: string,
): void {
  const rawCheck = isSensitivePath(rawPath, customProtectedPaths);
  const realCheck = isSensitivePath(realPath, customProtectedPaths);
  if (rawCheck.sensitive || realCheck.sensitive) {
    const label = rawCheck.label ?? realCheck.label ?? path.basename(realPath);
    throw new Error(`Refused to ${action} sensitive path: ${label}`);
  }
}

const MAX_GUARD_STORE_JSON_BYTES = 16 * 1024 * 1024;
const VALID_GUARD_DECISIONS: ReadonlySet<string> = new Set(['allow', 'ask', 'force_ask', 'deny']);

function policyPath(dataDir: string): string {
  return path.join(dataDir, 'policy.json');
}

function snapshotsPath(dataDir: string): string {
  return path.join(dataDir, 'snapshots.json');
}

function auditPath(dataDir: string): string {
  return path.join(dataDir, 'audit.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeGuardDecision(raw: unknown, fallback: GuardDecision): GuardDecision {
  return typeof raw === 'string' && VALID_GUARD_DECISIONS.has(raw)
    ? (raw as GuardDecision)
    : fallback;
}

function normalizePolicyStringArray(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return raw.filter((item): item is string => typeof item === 'string');
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : fallback;
}

function readJsonSafe(filePath: string): unknown {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_GUARD_STORE_JSON_BYTES) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeGuardPolicy(
  raw: unknown,
  fallback: GuardPolicy = DEFAULT_POLICY,
): GuardPolicy {
  const stored: Partial<Record<keyof GuardPolicy, unknown>> = isPlainObject(raw) ? raw : {};
  return {
    ...fallback,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
    permissionMode: normalizePermissionMode(stored.permissionMode ?? fallback.permissionMode),
    protectEnvAndKeys: normalizeGuardDecision(
      stored.protectEnvAndKeys,
      fallback.protectEnvAndKeys,
    ),
    blockSecretWrites: normalizeGuardDecision(
      stored.blockSecretWrites,
      fallback.blockSecretWrites,
    ),
    blockInboundPromptSecrets: normalizeBlockInboundPromptSecrets(
      stored.blockInboundPromptSecrets !== undefined
        ? stored.blockInboundPromptSecrets
        : fallback.blockInboundPromptSecrets,
    ),
    blockDestructiveCommands: normalizeGuardDecision(
      stored.blockDestructiveCommands,
      fallback.blockDestructiveCommands,
    ),
    askOnNetworkPipes: normalizeGuardDecision(
      stored.askOnNetworkPipes,
      fallback.askOnNetworkPipes,
    ),
    autoSnapshotBeforeEdit:
      typeof stored.autoSnapshotBeforeEdit === 'boolean'
        ? stored.autoSnapshotBeforeEdit
        : fallback.autoSnapshotBeforeEdit,
    maxSnapshotsPerFile: normalizePositiveInt(
      stored.maxSnapshotsPerFile,
      fallback.maxSnapshotsPerFile,
    ),
    maxSnapshotFileBytes: normalizePositiveInt(
      stored.maxSnapshotFileBytes,
      fallback.maxSnapshotFileBytes,
    ),
    customProtectedPaths: normalizePolicyStringArray(
      stored.customProtectedPaths,
      fallback.customProtectedPaths,
    ),
    customBlockedCommands: normalizePolicyStringArray(
      stored.customBlockedCommands,
      fallback.customBlockedCommands,
    ),
  };
}

export function loadPolicy(dataDir: string): GuardPolicy {
  const raw = readJsonSafe(policyPath(dataDir));
  return normalizeGuardPolicy(raw, DEFAULT_POLICY);
}

export function savePolicy(dataDir: string, patch: Partial<GuardPolicy>): GuardPolicy {
  const targetPath = policyPath(dataDir);
  return withFileLockSync(targetPath, () => {
    const current = loadPolicy(dataDir);
    const next = normalizeGuardPolicy(patch, current);
    writePrivateJson(targetPath, next);
    return next;
  });
}

function sanitizeTurnSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64);
  return cleaned || 'session';
}

export function deriveTurnKey(
  dataDir: string,
  params: { conversationId?: string; stepIdx?: number; nowMs?: number } = {},
): string {
  const nowMs = typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const convId = typeof params.conversationId === 'string' && params.conversationId.trim()
    ? params.conversationId.trim()
    : undefined;
  const stepIdx = typeof params.stepIdx === 'number' && Number.isFinite(params.stepIdx)
    ? params.stepIdx
    : undefined;
  const existing = loadSnapshots(dataDir);

  if (convId) {
    const recent = existing.find(
      (s) =>
        !s.isDemo &&
        !s.restoredFromId &&
        !BACKUP_TOOL_NAMES.has(s.toolName) &&
        s.conversationId === convId &&
        typeof s.turnKey === 'string' &&
        s.turnKey.length > 0,
    );
    if (recent?.turnKey) {
      const prevMs = Date.parse(recent.createdAt);
      if (Number.isFinite(prevMs)) {
        const deltaMs = nowMs - prevMs;
        const withinTimeWindow = deltaMs <= TURN_GROUP_WINDOW_MS && deltaMs >= -5_000;
        const withinStepWindow =
          stepIdx !== undefined &&
          typeof recent.stepIdx === 'number' &&
          Math.abs(stepIdx - recent.stepIdx) <= TURN_STEP_MAX_GAP &&
          deltaMs <= TURN_STEP_MAX_WINDOW_MS &&
          deltaMs >= -5_000;
        if (withinTimeWindow || withinStepWindow) {
          return recent.turnKey;
        }
      }
    }
    const windowBucket = Math.floor(nowMs / TURN_GROUP_WINDOW_MS);
    return `turn:${sanitizeTurnSegment(convId)}:${windowBucket}`;
  }

  const recentLocal = existing.find(
    (s) =>
      !s.isDemo &&
      !s.restoredFromId &&
      !BACKUP_TOOL_NAMES.has(s.toolName) &&
      !s.conversationId &&
      typeof s.turnKey === 'string' &&
      s.turnKey.length > 0,
  );
  if (recentLocal?.turnKey) {
    const prevMs = Date.parse(recentLocal.createdAt);
    if (Number.isFinite(prevMs)) {
      const deltaMs = nowMs - prevMs;
      if (deltaMs <= TURN_GROUP_WINDOW_MS && deltaMs >= -5_000) {
        return recentLocal.turnKey;
      }
    }
  }
  const windowBucket = Math.floor(nowMs / TURN_GROUP_WINDOW_MS);
  return `turn:workspace:${windowBucket}`;
}

export function loadSnapshots(dataDir: string): SnapshotRecord[] {
  const raw = readJsonSafe(snapshotsPath(dataDir));
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SnapshotRecord => isPlainObject(item));
}

export function saveSnapshots(dataDir: string, records: SnapshotRecord[]): void {
  writePrivateJson(snapshotsPath(dataDir), records);
}

export function loadAuditLog(dataDir: string): AuditEvent[] {
  const raw = readJsonSafe(auditPath(dataDir));
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AuditEvent => isPlainObject(item));
}

export function appendAuditEvent(
  dataDir: string,
  event: Omit<AuditEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): AuditEvent {
  const full: AuditEvent = {
    id: event.id ?? `evt_${crypto.randomBytes(5).toString('hex')}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    event: event.event,
    toolName: event.toolName,
    decision: event.decision,
    category: event.category,
    target: redactCommand(event.target),
    summary: redactCommand(event.summary),
    ruleId: event.ruleId,
    snapshotId: event.snapshotId,
    isDemo: event.isDemo,
  };
  const targetPath = auditPath(dataDir);
  withFileLockSync(targetPath, () => {
    const existing = loadAuditLog(dataDir);
    const next = [full, ...existing].slice(0, 200);
    writePrivateJson(targetPath, next);
  });
  return full;
}

export function blobPath(dataDir: string, hash: string): string {
  if (!SHA256_HEX_RE.test(hash)) {
    throw new Error('Invalid snapshot blob hash: expected 64 lowercase hexadecimal characters');
  }
  return path.join(dataDir, 'blobs', `${hash}.blob`);
}

export function readSnapshotContent(dataDir: string, record: SnapshotRecord): string | null {
  if (!record.existed) return '';
  if (record.isDemo && typeof record.demoContent === 'string') {
    return record.demoContent;
  }
  const p = blobPath(dataDir, record.sha256);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function resolveSafeBlobsDir(dataDir: string, createIfMissing: boolean): string | null {
  try {
    if (createIfMissing) {
      ensureDir(dataDir);
    }
    const dataStat = fs.lstatSync(dataDir);
    if (dataStat.isSymbolicLink() || !dataStat.isDirectory()) {
      return null;
    }
    const realDataDir = canonicalRealpathSync(dataDir);
    const blobsDir = path.join(realDataDir, 'blobs');
    try {
      const st = fs.lstatSync(blobsDir);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        return null;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT' || !createIfMissing) {
        return null;
      }
      ensureDir(blobsDir);
      const st = fs.lstatSync(blobsDir);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        return null;
      }
    }
    const realBlobsDir = canonicalRealpathSync(blobsDir);
    if (!isPathInsideDir(realDataDir, realBlobsDir)) {
      return null;
    }
    return realBlobsDir;
  } catch {
    return null;
  }
}

export function capturePreEditSnapshot(params: {
  dataDir: string;
  filePath: string;
  toolName: string;
  reason: string;
  policy: GuardPolicy;
  workspaceRoot: string;
  restoredFromId?: string;
  turnKey?: string;
  conversationId?: string;
  stepIdx?: number;
}): SnapshotRecord | null {
  const { dataDir, toolName, reason, policy, workspaceRoot, restoredFromId, turnKey, conversationId, stepIdx } = params;
  const realRoot = assertInsideWorkspace(workspaceRoot, workspaceRoot);
  const safePath = assertInsideWorkspace(workspaceRoot, params.filePath);
  assertNotSensitive(params.filePath, safePath, policy.customProtectedPaths, 'snapshot');

  const relPath = path.relative(realRoot, safePath) || path.basename(safePath);

  const existed = fs.existsSync(safePath);
  let sha256 = 'EMPTY_FILE';
  let sizeBytes = 0;
  let lineCount = 0;
  let rawBytes: Buffer | null = null;

  if (existed) {
    const stat = fs.statSync(safePath);
    if (!stat.isFile() || stat.size > policy.maxSnapshotFileBytes) {
      return null;
    }
    const raw = fs.readFileSync(safePath);
    if (raw.includes(0)) return null;
    rawBytes = raw;
    sha256 = sha256Buffer(raw);
    sizeBytes = raw.byteLength;
    lineCount = raw.toString('utf8').split(/\r?\n/).length;
  }

  const isManualCheckpoint = toolName === 'guard_create_checkpoint' || toolName === 'create_checkpoint';

  const outcome = withFileLockSync(snapshotsPath(dataDir), () => {
    const all = loadSnapshots(dataDir);
    const latestForFile = all.find(
      (s) => typeof s.filePath === 'string' && isSamePath(s.filePath, safePath) && !s.isDemo,
    );
    const sameTurn = (latestForFile?.turnKey ?? undefined) === (turnKey ?? undefined);
    if (
      latestForFile &&
      sameTurn &&
      latestForFile.sha256 === sha256 &&
      latestForFile.existed === existed &&
      !isManualCheckpoint &&
      !restoredFromId
    ) {
      return { record: latestForFile, deduplicated: true as const };
    }

    if (existed && rawBytes !== null) {
      const safeBlobsDir = resolveSafeBlobsDir(dataDir, true);
      if (!safeBlobsDir) {
        throw new Error('Refused unsafe or symlinked Guard snapshot blobs directory');
      }
      const targetBlob = path.join(safeBlobsDir, `${sha256}.blob`);
      let blobExists = false;
      try {
        const existingSt = fs.lstatSync(targetBlob);
        if (existingSt.isSymbolicLink() || !existingSt.isFile()) {
          throw new Error('Refused unsafe or symlinked Guard snapshot blob target');
        }
        blobExists = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw err;
        }
      }
      if (!blobExists) {
        const tmpBlob = path.join(
          safeBlobsDir,
          `${sha256}.blob.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
        );
        try {
          fs.writeFileSync(tmpBlob, rawBytes, { mode: 0o600, flag: 'wx' });
          try {
            fs.chmodSync(tmpBlob, 0o600);
          } catch {
            // Ignore on platforms where chmod is unsupported
          }
          atomicRenameSync(tmpBlob, targetBlob);
        } catch (err) {
          try {
            if (fs.existsSync(tmpBlob)) fs.unlinkSync(tmpBlob);
          } catch {
            // ignore cleanup
          }
          throw err;
        }
      }
    }

    // Keep snapshot timestamps strictly monotonic within the same millisecond so earliest-in-turn selection is deterministic.
    let createdMs = Date.now();
    const newestPrevMs = all.reduce((max, s) => {
      const t = typeof s.createdAt === 'string' ? Date.parse(s.createdAt) : Number.NaN;
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    if (newestPrevMs >= createdMs && newestPrevMs - createdMs < 60_000) {
      createdMs = newestPrevMs + 1;
    }

    const record: SnapshotRecord = {
      id: `snap_${createdMs.toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      filePath: safePath,
      relPath,
      toolName,
      reason,
      createdAt: new Date(createdMs).toISOString(),
      sha256,
      sizeBytes,
      lineCount,
      existed,
      ...(turnKey ? { turnKey } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(typeof stepIdx === 'number' && Number.isFinite(stepIdx) ? { stepIdx } : {}),
      ...(restoredFromId ? { restoredFromId } : {}),
    };

    const sameFile = [
      record,
      ...all.filter((s) => typeof s.filePath === 'string' && isSamePath(s.filePath, safePath)),
    ].slice(0, policy.maxSnapshotsPerFile);
    const others = all.filter((s) => typeof s.filePath !== 'string' || !isSamePath(s.filePath, safePath));
    const next = [...sameFile, ...others]
      .sort((a, b) => {
        const bCreated = typeof b.createdAt === 'string' ? b.createdAt : '';
        const aCreated = typeof a.createdAt === 'string' ? a.createdAt : '';
        return bCreated.localeCompare(aCreated);
      })
      .slice(0, 300);

    saveSnapshots(dataDir, next);

    // O(1) targeted GC: unlink ONLY blobs belonging to snapshots explicitly evicted from `all`
    // whose content hash is no longer referenced by either `next` OR the freshest disk snapshot list,
    // strictly inside a verified non-symlink `blobs/` directory (safe under concurrent sessions).
    const keptIds = new Set(next.map((s) => s.id));
    const evicted = all.filter((s) => !keptIds.has(s.id));
    if (evicted.length > 0) {
      try {
        const safeBlobsDir = resolveSafeBlobsDir(dataDir, false);
        if (safeBlobsDir) {
          const latestDisk = loadSnapshots(dataDir);
          const activeHashes = new Set<string>([
            ...next.map((s) => s.sha256),
            ...latestDisk.map((s) => s.sha256),
          ]);
          const candidateHashes = new Set<string>();
          for (const snap of evicted) {
            if (snap.sha256 && /^[a-f0-9]{64}$/i.test(snap.sha256) && !activeHashes.has(snap.sha256)) {
              candidateHashes.add(snap.sha256);
            }
          }
          for (const hash of candidateHashes) {
            const orphanPath = path.join(safeBlobsDir, `${hash}.blob`);
            try {
              const st = fs.lstatSync(orphanPath);
              if (!st.isSymbolicLink() && st.isFile()) {
                const realOrphan = canonicalRealpathSync(orphanPath);
                if (isPathInsideDir(safeBlobsDir, realOrphan)) {
                  fs.unlinkSync(realOrphan);
                }
              }
            } catch {
              // ignore missing or concurrent unlink
            }
          }
        }
      } catch {
        // Best-effort cleanup only
      }
    }

    return { record, deduplicated: false as const };
  });

  if (outcome.deduplicated) {
    return outcome.record;
  }

  appendAuditEvent(dataDir, {
    event: isManualCheckpoint ? 'Checkpoint' : 'PreToolUse',
    toolName,
    decision: 'snapshot',
    category: 'time-machine',
    target: relPath,
    summary: existed
      ? `Saved pre-edit snapshot (${lineCount} lines, ${sizeBytes} B) before ${toolName}`
      : `Recorded pre-create marker before ${toolName} creates ${relPath}`,
    snapshotId: outcome.record.id,
  });

  return outcome.record;
}

export function groupSnapshotsByTurn(snapshots: SnapshotRecord[]): TurnCheckpointSummary[] {
  if (!snapshots.length) return [];

  // Sort ascending by creation time (with reverse original index tie-breaker since snapshots are stored newest-first)
  // so that the first encounter of each file in a turn is the earliest (pre-first-edit) snapshot.
  const indexed = snapshots.map((snap, idx) => ({ snap, idx }));
  indexed.sort((a, b) => {
    const aStr = typeof a.snap.createdAt === 'string' ? a.snap.createdAt : '';
    const bStr = typeof b.snap.createdAt === 'string' ? b.snap.createdAt : '';
    const ta = Date.parse(aStr);
    const tb = Date.parse(bStr);
    const aValid = Number.isFinite(ta);
    const bValid = Number.isFinite(tb);
    if (aValid && bValid && ta !== tb) return ta - tb;
    if (aStr !== bStr) {
      return aStr.localeCompare(bStr);
    }
    return b.idx - a.idx;
  });

  interface MutableTurnGroup {
    turnKey: string;
    conversationId?: string;
    createdAt: string;
    latestAt: string;
    fileMap: Map<string, TurnCheckpointFileEntry>;
    toolSet: Set<string>;
  }

  const groups = new Map<string, MutableTurnGroup>();

  for (const { snap } of indexed) {
    const snapCreatedAt = typeof snap.createdAt === 'string' ? snap.createdAt : '';
    const turnKey =
      typeof snap.turnKey === 'string' && snap.turnKey.trim()
        ? snap.turnKey.trim()
        : `legacy:${snap.id}`;
    let group = groups.get(turnKey);
    if (!group) {
      group = {
        turnKey,
        conversationId: snap.conversationId,
        createdAt: snapCreatedAt,
        latestAt: snapCreatedAt,
        fileMap: new Map<string, TurnCheckpointFileEntry>(),
        toolSet: new Set<string>(),
      };
      groups.set(turnKey, group);
    }

    if (!group.conversationId && snap.conversationId) {
      group.conversationId = snap.conversationId;
    }
    if (snapCreatedAt.localeCompare(group.createdAt) < 0) {
      group.createdAt = snapCreatedAt;
    }
    if (snapCreatedAt.localeCompare(group.latestAt) > 0) {
      group.latestAt = snapCreatedAt;
    }
    group.toolSet.add(snap.toolName);

    const fileKey = snap.filePath || snap.relPath;
    if (!group.fileMap.has(fileKey)) {
      group.fileMap.set(fileKey, {
        snapshotId: snap.id,
        relPath: snap.relPath,
        filePath: snap.filePath,
        existed: snap.existed,
        sizeBytes: snap.sizeBytes,
        toolName: snap.toolName,
        createdAt: snapCreatedAt,
      });
    }
  }

  const summaries: TurnCheckpointSummary[] = [];
  for (const group of groups.values()) {
    const files = [...group.fileMap.values()];
    summaries.push({
      turnKey: group.turnKey,
      ...(group.conversationId ? { conversationId: group.conversationId } : {}),
      createdAt: group.createdAt,
      latestAt: group.latestAt,
      fileCount: files.length,
      files,
      toolNames: [...group.toolSet],
    });
  }

  summaries.sort((a, b) => {
    const tb = Date.parse(b.latestAt);
    const ta = Date.parse(a.latestAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && tb !== ta) {
      return tb - ta;
    }
    return b.latestAt.localeCompare(a.latestAt);
  });

  return summaries;
}

export function diffSnapshotRecord(
  record: SnapshotRecord,
  dataDir: string,
  workspaceRoot: string,
  policyOverride?: GuardPolicy,
): SnapshotDiff {
  let currentExists = false;
  let currentText = '';
  let currentSha256: string | null = null;
  let snapshotText = '';

  if (record.isDemo) {
    snapshotText = readSnapshotContent(dataDir, record) ?? '';
    currentExists = record.demoCurrentExists ?? true;
    currentText = currentExists ? (record.demoCurrentContent ?? snapshotText) : '';
    currentSha256 = currentExists ? sha256Buffer(currentText) : null;
  } else {
    const policy = policyOverride ?? loadPolicy(dataDir);
    const safePath = assertInsideWorkspace(workspaceRoot, record.filePath);
    assertNotSensitive(record.filePath, safePath, policy.customProtectedPaths, 'diff');
    snapshotText = readSnapshotContent(dataDir, record) ?? '';
    if (fs.existsSync(safePath)) {
      currentExists = true;
      currentText = fs.readFileSync(safePath, 'utf8');
      currentSha256 = sha256Buffer(currentText);
    }
  }

  const identical = currentExists === record.existed && snapshotText === currentText;
  const { added, removed, hunks } = computeLineDiff(snapshotText, currentText);

  return {
    snapshotId: record.id,
    filePath: record.filePath,
    relPath: record.relPath,
    snapshotSha256: record.sha256,
    currentSha256,
    currentExists,
    identical,
    added,
    removed,
    hunks,
  };
}

export function diffSnapshot(dataDir: string, snapshotId: string, workspaceRoot: string): SnapshotDiff {
  const snapshots = loadSnapshots(dataDir);
  const record = snapshots.find((s) => s.id === snapshotId);
  if (!record) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  return diffSnapshotRecord(record, dataDir, workspaceRoot);
}

export function computeTurnCheckpointDiffFromRecords(
  snapshots: SnapshotRecord[],
  turnKey: string,
  dataDir: string,
  workspaceRoot: string,
  policyOverride?: GuardPolicy,
): TurnCheckpointDiff {
  const turns = groupSnapshotsByTurn(snapshots);
  const turn = turns.find((t) => t.turnKey === turnKey);
  if (!turn) {
    throw new Error(`Turn checkpoint not found: ${turnKey}`);
  }

  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const files: SnapshotDiff[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let changedFiles = 0;

  for (const entry of turn.files) {
    const rec = byId.get(entry.snapshotId);
    if (!rec) {
      throw new Error(`Snapshot not found: ${entry.snapshotId}`);
    }
    const fileDiff = diffSnapshotRecord(rec, dataDir, workspaceRoot, policyOverride);
    files.push(fileDiff);
    totalAdded += fileDiff.added;
    totalRemoved += fileDiff.removed;
    if (!fileDiff.identical) {
      changedFiles += 1;
    }
  }

  return {
    turnKey: turn.turnKey,
    ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
    createdAt: turn.createdAt,
    latestAt: turn.latestAt,
    fileCount: files.length,
    changedFiles,
    totalAdded,
    totalRemoved,
    identical: changedFiles === 0,
    files,
  };
}

export function getTurnCheckpointDiff(
  dataDir: string,
  turnKey: string,
  workspaceRoot: string,
): TurnCheckpointDiff {
  const snapshots = loadSnapshots(dataDir);
  const policy = loadPolicy(dataDir);
  return computeTurnCheckpointDiffFromRecords(snapshots, turnKey, dataDir, workspaceRoot, policy);
}

function assertSafeRewindTarget(
  workspaceRoot: string,
  rawFilePath: string,
  customProtectedPaths: string[],
): string {
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }
  if (!rawFilePath || rawFilePath.includes('\0')) {
    throw new Error('Invalid target path');
  }

  const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
  const absRoot = path.resolve(workspaceRoot);
  const candidate = path.isAbsolute(rawFilePath)
    ? path.resolve(rawFilePath)
    : path.resolve(workspaceRoot, rawFilePath);

  // Reject if literal path itself is a symlink or non-regular file (e.g. directory/FIFO)
  try {
    const lstat = fs.lstatSync(candidate);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Refused to rewind symbolic link target: ${rawFilePath}`);
    }
    if (!lstat.isFile()) {
      throw new Error(`Refused to rewind non-regular file target: ${rawFilePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  // Reject if any intermediate directory segment inside workspaceRoot is a symlink
  const baseForWalk =
    isPathInsideDir(realRoot, candidate)
      ? realRoot
      : isPathInsideDir(absRoot, candidate)
        ? absRoot
        : null;
  if (baseForWalk) {
    const rel = path.relative(baseForWalk, candidate);
    const segments = rel.split(path.sep).filter(Boolean);
    let cursor = baseForWalk;
    for (const seg of segments) {
      cursor = path.join(cursor, seg);
      try {
        const st = fs.lstatSync(cursor);
        if (st.isSymbolicLink()) {
          throw new Error(`Refused to rewind through symbolic link path: ${rawFilePath}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') break;
        throw err;
      }
    }
  }

  // Enforce realpath workspace boundary
  const safePath = assertInsideWorkspace(workspaceRoot, rawFilePath);

  // Re-verify lstat on resolved safePath (covers OS-level root aliases like /var -> /private/var)
  try {
    const safeLstat = fs.lstatSync(safePath);
    if (safeLstat.isSymbolicLink()) {
      throw new Error(`Refused to rewind symbolic link target: ${rawFilePath}`);
    }
    if (!safeLstat.isFile()) {
      throw new Error(`Refused to rewind non-regular file target: ${rawFilePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  // Enforce protected sensitive path checks (.env, SSH/private keys, custom patterns)
  assertNotSensitive(rawFilePath, safePath, customProtectedPaths, 'restore');

  return safePath;
}

export function restoreTurnCheckpoint(
  dataDir: string,
  turnKey: string,
  workspaceRoot: string,
  policyOverride?: GuardPolicy,
): TurnRestoreResult {
  const snapshots = loadSnapshots(dataDir);
  const turns = groupSnapshotsByTurn(snapshots);
  const turn = turns.find((t) => t.turnKey === turnKey);
  if (!turn) {
    throw new Error(`Turn checkpoint not found: ${turnKey}`);
  }

  const activePolicy = policyOverride ?? loadPolicy(dataDir);
  const byId = new Map(snapshots.map((s) => [s.id, s]));

  // Phase 1: All-or-Nothing atomic preflight validation for EVERY target file before mutating anything.
  const plan: Array<{
    record: SnapshotRecord;
    safePath: string;
    contentToRestore: string | null;
  }> = [];

  for (const entry of turn.files) {
    const record = byId.get(entry.snapshotId);
    if (!record) {
      throw new Error(`Snapshot not found: ${entry.snapshotId}`);
    }
    if (record.isDemo) {
      throw new Error(`Demo turn ${turnKey} must be rewound in-memory without writing to disk`);
    }

    const safePath = assertSafeRewindTarget(
      workspaceRoot,
      record.filePath,
      activePolicy.customProtectedPaths,
    );

    let contentToRestore: string | null = null;
    if (record.existed) {
      contentToRestore = readSnapshotContent(dataDir, record);
      if (contentToRestore === null) {
        throw new Error(`Snapshot blob missing for ${record.id} (${record.relPath})`);
      }
    }

    plan.push({ record, safePath, contentToRestore });
  }

  // Phase 2: All targets passed preflight -> capture pre-rewind backups and restore safely.
  const backupTurnKey = `rewind-backup:${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  const restoredFiles: string[] = [];
  const backupSnapshotIds: string[] = [];
  const deletedNewFiles: string[] = [];

  for (const { record, safePath, contentToRestore } of plan) {
    const backup = capturePreEditSnapshot({
      dataDir,
      filePath: safePath,
      toolName: 'pre_rewind_backup',
      reason: `Automatic pre-rewind safety backup before rewinding turn ${turnKey}`,
      policy: activePolicy,
      workspaceRoot,
      restoredFromId: record.id,
      turnKey: backupTurnKey,
    });
    if (backup) {
      backupSnapshotIds.push(backup.id);
    }

    if (!record.existed) {
      if (fs.existsSync(safePath)) {
        const lstat = fs.lstatSync(safePath);
        if (lstat.isSymbolicLink() || !lstat.isFile()) {
          throw new Error(`Refused to delete non-regular file during turn rewind: ${record.relPath}`);
        }
        assertInsideWorkspace(workspaceRoot, safePath);
        unlinkWithWinReadonlyFallback(safePath);
        deletedNewFiles.push(record.relPath);
      }
      continue;
    }

    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    writeFileWithWinReadonlyFallback(safePath, contentToRestore!);
    restoredFiles.push(record.relPath);
  }

  const summary = `Rewound turn ${turnKey}: restored ${restoredFiles.length} file(s), removed ${deletedNewFiles.length} new file(s) (${backupSnapshotIds.length} pre-rewind backup(s))`;
  appendAuditEvent(dataDir, {
    event: 'Restore',
    toolName: 'app_guard_restore_turn',
    decision: 'restored',
    category: 'time-machine',
    target: turnKey,
    summary,
    snapshotId: turn.files[0]?.snapshotId,
  });

  return {
    restored: true,
    turnKey,
    restoredFiles,
    backupSnapshotIds,
    deletedNewFiles,
    message: summary,
  };
}

export function restoreSnapshot(params: {
  dataDir: string;
  snapshotId: string;
  workspaceRoot: string;
}): { restored: boolean; snapshot: SnapshotRecord; safetyBackupId: string | null; message: string } {
  const { dataDir, snapshotId, workspaceRoot } = params;
  const snapshots = loadSnapshots(dataDir);
  const idx = snapshots.findIndex((s) => s.id === snapshotId);
  if (idx < 0) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  const record = snapshots[idx];
  const policy = loadPolicy(dataDir);

  if (record.isDemo) {
    const updated: SnapshotRecord = {
      ...record,
      demoCurrentContent: record.demoContent ?? '',
    };
    const next = [...snapshots];
    next[idx] = updated;
    saveSnapshots(dataDir, next);
    appendAuditEvent(dataDir, {
      event: 'Restore',
      toolName: 'app_guard_restore_snapshot',
      decision: 'restored',
      category: 'time-machine',
      target: record.relPath,
      summary: `Restored demo file ${record.relPath} to snapshot ${record.id}`,
      snapshotId: record.id,
      isDemo: true,
    });
    return {
      restored: true,
      snapshot: updated,
      safetyBackupId: null,
      message: `Restored demo snapshot ${record.id} for ${record.relPath}.`,
    };
  }

  const safePath = assertInsideWorkspace(workspaceRoot, record.filePath);
  assertNotSensitive(record.filePath, safePath, policy.customProtectedPaths, 'restore');

  let contentToRestore: string | null = null;
  if (record.existed) {
    contentToRestore = readSnapshotContent(dataDir, record);
    if (contentToRestore === null) {
      throw new Error(`Snapshot blob missing for ${record.id}`);
    }
  }

  const safetyBackup = capturePreEditSnapshot({
    dataDir,
    filePath: safePath,
    toolName: 'pre_restore_backup',
    reason: `Automatic safety backup before restoring ${record.id}`,
    policy,
    workspaceRoot,
    restoredFromId: record.id,
  });

  if (!record.existed) {
    if (fs.existsSync(safePath)) {
      unlinkWithWinReadonlyFallback(safePath);
    }
    appendAuditEvent(dataDir, {
      event: 'Restore',
      toolName: 'app_guard_restore_snapshot',
      decision: 'restored',
      category: 'time-machine',
      target: record.relPath,
      summary: `Reverted newly created file ${record.relPath} (safety backup ${safetyBackup?.id ?? 'none'})`,
      snapshotId: record.id,
    });
    return {
      restored: true,
      snapshot: record,
      safetyBackupId: safetyBackup?.id ?? null,
      message: `Reverted newly created file ${record.relPath}. Safety backup saved as ${safetyBackup?.id ?? 'none'}.`,
    };
  }

  fs.mkdirSync(path.dirname(safePath), { recursive: true });
  writeFileWithWinReadonlyFallback(safePath, contentToRestore!);

  appendAuditEvent(dataDir, {
    event: 'Restore',
    toolName: 'app_guard_restore_snapshot',
    decision: 'restored',
    category: 'time-machine',
    target: record.relPath,
    summary: `Restored ${record.relPath} to pre-edit snapshot ${record.id} (safety backup ${safetyBackup?.id ?? 'none'})`,
    snapshotId: record.id,
  });

  return {
    restored: true,
    snapshot: record,
    safetyBackupId: safetyBackup?.id ?? null,
    message: `Restored ${record.relPath} to ${record.id}. Safety backup saved as ${safetyBackup?.id ?? 'none'}.`,
  };
}

export function buildDashboardStateFromMemory(params: {
  dataDir: string;
  workspaceRoot: string;
  mode: 'live' | 'demo';
  policy: GuardPolicy;
  snapshots: SnapshotRecord[];
  auditLog: AuditEvent[];
  lastScan: WorkspaceScanReport | null;
}): GuardDashboardState {
  const { dataDir, workspaceRoot, mode, policy, snapshots, auditLog, lastScan } = params;
  const trackedFiles = new Set(snapshots.map((s) => s.relPath)).size;
  const turns = groupSnapshotsByTurn(snapshots);

  return {
    mode,
    dataDir,
    workspaceRoot,
    policy,
    stats: {
      totalSnapshots: snapshots.length,
      trackedFiles,
      blockedCount: auditLog.filter((e) => e.decision === 'deny').length,
      askCount: auditLog.filter((e) => e.decision === 'ask' || e.decision === 'force_ask').length,
      restoredCount: auditLog.filter((e) => e.decision === 'restored').length,
      secretCatches: auditLog.filter((e) => e.category === 'secret-leak').length,
    },
    snapshots,
    turns,
    auditLog,
    lastScan,
  };
}

export function buildDashboardState(params: {
  dataDir: string;
  workspaceRoot: string;
  mode: 'live' | 'demo';
  lastScan: WorkspaceScanReport | null;
}): GuardDashboardState {
  const { dataDir, workspaceRoot, mode, lastScan } = params;
  const policy = loadPolicy(dataDir);
  const snapshots = loadSnapshots(dataDir);
  const auditLog = loadAuditLog(dataDir);
  return buildDashboardStateFromMemory({
    dataDir,
    workspaceRoot,
    mode,
    policy,
    snapshots,
    auditLog,
    lastScan,
  });
}
