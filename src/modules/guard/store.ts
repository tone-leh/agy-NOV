import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeLineDiff } from './diff.js';
import { isSensitivePath, redactCommand } from './policy.js';
import {
  DEFAULT_POLICY,
  type AuditEvent,
  type GuardDashboardState,
  type GuardPolicy,
  type SnapshotDiff,
  type SnapshotRecord,
  type WorkspaceScanReport,
} from './types.js';

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const MAX_SYMLINK_DEPTH = 20;

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
  return { ...DEFAULT_POLICY, ...stored };
}

export function savePolicy(dataDir: string, patch: Partial<GuardPolicy>): GuardPolicy {
  const next: GuardPolicy = {
    ...loadPolicy(dataDir),
    ...patch,
  };
  writePrivateJson(path.join(dataDir, 'policy.json'), next);
  return next;
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
}): SnapshotRecord | null {
  const { dataDir, toolName, reason, policy, workspaceRoot, restoredFromId } = params;
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
  if (
    latestForFile &&
    latestForFile.sha256 === sha256 &&
    latestForFile.existed === existed &&
    !isManualCheckpoint &&
    !restoredFromId
  ) {
    return latestForFile;
  }

  const record: SnapshotRecord = {
    id: `snap_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    filePath: safePath,
    relPath,
    toolName,
    reason,
    createdAt: new Date().toISOString(),
    sha256,
    sizeBytes,
    lineCount,
    existed,
    restoredFromId,
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

export function diffSnapshot(dataDir: string, snapshotId: string, workspaceRoot: string): SnapshotDiff {
  const snapshots = loadSnapshots(dataDir);
  const record = snapshots.find((s) => s.id === snapshotId);
  if (!record) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  let currentExists = false;
  let currentText = '';
  let currentSha256: string | null = null;
  let snapshotText = '';

  if (record.isDemo) {
    snapshotText = readSnapshotContent(dataDir, record) ?? '';
    currentExists = true;
    currentText = record.demoCurrentContent ?? snapshotText;
    currentSha256 = sha256Buffer(currentText);
  } else {
    const policy = loadPolicy(dataDir);
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
  const trackedFiles = new Set(snapshots.map((s) => s.relPath)).size;

  return {
    mode,
    dataDir,
    workspaceRoot,
    policy,
    stats: {
      totalSnapshots: snapshots.length,
      trackedFiles,
      blockedCount: auditLog.filter((e) => e.decision === 'deny').length,
      askCount: auditLog.filter((e) => e.decision === 'ask').length,
      restoredCount: auditLog.filter((e) => e.decision === 'restored').length,
      secretCatches: auditLog.filter((e) => e.category === 'secret-leak').length,
    },
    snapshots,
    auditLog,
    lastScan,
  };
}
