import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeLineDiff } from './diff.js';
import { isSensitivePath, normalizePermissionMode, redactCommand } from './policy.js';
import {
  DEFAULT_POLICY,
  type AuditEvent,
  type GuardDashboardState,
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
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // Ignore on platforms where chmod is unsupported
  }
  fs.renameSync(tmp, filePath);
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
      const realBase = fs.realpathSync(current);
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

  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realTarget !== realRoot && !realTarget.startsWith(rootPrefix)) {
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

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function loadPolicy(dataDir: string): GuardPolicy {
  const stored = readJsonSafe<Partial<GuardPolicy>>(path.join(dataDir, 'policy.json'), {});
  return {
    ...DEFAULT_POLICY,
    ...stored,
    permissionMode: normalizePermissionMode(stored.permissionMode),
  };
}

export function savePolicy(dataDir: string, patch: Partial<GuardPolicy>): GuardPolicy {
  const current = loadPolicy(dataDir);
  const next: GuardPolicy = {
    ...current,
    ...patch,
    permissionMode: normalizePermissionMode(patch.permissionMode ?? current.permissionMode),
  };
  writePrivateJson(path.join(dataDir, 'policy.json'), next);
  return next;
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
  return readJsonSafe<SnapshotRecord[]>(path.join(dataDir, 'snapshots.json'), []);
}

export function saveSnapshots(dataDir: string, records: SnapshotRecord[]): void {
  writePrivateJson(path.join(dataDir, 'snapshots.json'), records);
}

export function loadAuditLog(dataDir: string): AuditEvent[] {
  return readJsonSafe<AuditEvent[]>(path.join(dataDir, 'audit.json'), []);
}

export function appendAuditEvent(
  dataDir: string,
  event: Omit<AuditEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): AuditEvent {
  const existing = loadAuditLog(dataDir);
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
  const next = [full, ...existing].slice(0, 200);
  writePrivateJson(path.join(dataDir, 'audit.json'), next);
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

  if (existed) {
    const stat = fs.statSync(safePath);
    if (!stat.isFile() || stat.size > policy.maxSnapshotFileBytes) {
      return null;
    }
    const raw = fs.readFileSync(safePath);
    if (raw.includes(0)) return null;
    sha256 = sha256Buffer(raw);
    sizeBytes = raw.byteLength;
    lineCount = raw.toString('utf8').split(/\r?\n/).length;

    const targetBlob = blobPath(dataDir, sha256);
    if (!fs.existsSync(targetBlob)) {
      ensureDir(path.dirname(targetBlob));
      fs.writeFileSync(targetBlob, raw, { mode: 0o600 });
      try {
        fs.chmodSync(targetBlob, 0o600);
      } catch {
        // Ignore on platforms where chmod is unsupported
      }
    }
  }

  const isManualCheckpoint = toolName === 'guard_create_checkpoint' || toolName === 'create_checkpoint';
  const all = loadSnapshots(dataDir);
  const latestForFile = all.find((s) => s.filePath === safePath && !s.isDemo);
  const sameTurn = (latestForFile?.turnKey ?? undefined) === (turnKey ?? undefined);
  if (
    latestForFile &&
    sameTurn &&
    latestForFile.sha256 === sha256 &&
    latestForFile.existed === existed &&
    !isManualCheckpoint &&
    !restoredFromId
  ) {
    return latestForFile;
  }

  // Keep snapshot timestamps strictly monotonic within the same millisecond so earliest-in-turn selection is deterministic.
  let createdMs = Date.now();
  const newestPrevMs = all.reduce((max, s) => {
    const t = Date.parse(s.createdAt);
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

  const sameFile = [record, ...all.filter((s) => s.filePath === safePath)].slice(0, policy.maxSnapshotsPerFile);
  const others = all.filter((s) => s.filePath !== safePath);
  const next = [...sameFile, ...others]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 300);

  saveSnapshots(dataDir, next);
  appendAuditEvent(dataDir, {
    event: isManualCheckpoint ? 'Checkpoint' : 'PreToolUse',
    toolName,
    decision: 'snapshot',
    category: 'time-machine',
    target: relPath,
    summary: existed
      ? `Saved pre-edit snapshot (${lineCount} lines, ${sizeBytes} B) before ${toolName}`
      : `Recorded pre-create marker before ${toolName} creates ${relPath}`,
    snapshotId: record.id,
  });

  return record;
}

export function groupSnapshotsByTurn(snapshots: SnapshotRecord[]): TurnCheckpointSummary[] {
  if (!snapshots.length) return [];

  // Sort ascending by creation time (with reverse original index tie-breaker since snapshots are stored newest-first)
  // so that the first encounter of each file in a turn is the earliest (pre-first-edit) snapshot.
  const indexed = snapshots.map((snap, idx) => ({ snap, idx }));
  indexed.sort((a, b) => {
    const ta = Date.parse(a.snap.createdAt);
    const tb = Date.parse(b.snap.createdAt);
    const aValid = Number.isFinite(ta);
    const bValid = Number.isFinite(tb);
    if (aValid && bValid && ta !== tb) return ta - tb;
    if (a.snap.createdAt !== b.snap.createdAt) {
      return a.snap.createdAt.localeCompare(b.snap.createdAt);
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
    const turnKey = snap.turnKey && snap.turnKey.trim() ? snap.turnKey.trim() : `legacy:${snap.id}`;
    let group = groups.get(turnKey);
    if (!group) {
      group = {
        turnKey,
        conversationId: snap.conversationId,
        createdAt: snap.createdAt,
        latestAt: snap.createdAt,
        fileMap: new Map<string, TurnCheckpointFileEntry>(),
        toolSet: new Set<string>(),
      };
      groups.set(turnKey, group);
    }

    if (!group.conversationId && snap.conversationId) {
      group.conversationId = snap.conversationId;
    }
    if (snap.createdAt.localeCompare(group.createdAt) < 0) {
      group.createdAt = snap.createdAt;
    }
    if (snap.createdAt.localeCompare(group.latestAt) > 0) {
      group.latestAt = snap.createdAt;
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
        createdAt: snap.createdAt,
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
    candidate === realRoot || candidate.startsWith(`${realRoot}${path.sep}`)
      ? realRoot
      : candidate === absRoot || candidate.startsWith(`${absRoot}${path.sep}`)
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
        fs.unlinkSync(safePath);
        deletedNewFiles.push(record.relPath);
      }
      continue;
    }

    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, contentToRestore!, 'utf8');
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
      fs.unlinkSync(safePath);
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
  fs.writeFileSync(safePath, contentToRestore!, 'utf8');

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
