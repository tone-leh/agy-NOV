import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../core/utils.js';

export type RadarSessionStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'stalled'
  | 'error';

export type RadarStoredStatus = Exclude<RadarSessionStatus, 'stalled'>;

export interface RadarPrefs {
  desktopNotify: boolean;
  soundChime: boolean;
  stallMinutes: number;
}

export interface RadarSessionRecord {
  conversationId: string;
  status: RadarStoredStatus;
  workspaceName: string;
  workspaceRoot?: string;
  lastToolName?: string;
  lastEvent: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'manual';
  stepCount: number;
  unread: boolean;
  summary?: string;
  errorMessage?: string;
  startedAt: string;
  lastActiveAt: string;
  completedAt?: string;
}

export interface RadarSessionView extends Omit<RadarSessionRecord, 'status'> {
  status: RadarSessionStatus;
  rawStatus: RadarStoredStatus;
  idleMinutes: number;
}

export interface RadarBoardFile {
  schemaVersion: 1;
  prefs: RadarPrefs;
  sessions: Record<string, RadarSessionRecord>;
  updatedAt: string;
}

export interface RadarBoardCounts {
  total: number;
  running: number;
  awaiting_approval: number;
  completed: number;
  stalled: number;
  error: number;
  unread: number;
}

export interface RadarBoardView {
  mode: 'live' | 'demo';
  prefs: RadarPrefs;
  counts: RadarBoardCounts;
  sessions: RadarSessionView[];
  updatedAt: string;
}

export interface SafeNotifyInvocation {
  command: string;
  args: string[];
}

export interface NotifyDispatchResult {
  dispatched: boolean;
  reason?: string;
  invocation?: SafeNotifyInvocation;
}

export const DEFAULT_RADAR_PREFS: RadarPrefs = {
  desktopNotify: false,
  soundChime: false,
  stallMinutes: 5,
};

const MAX_STORED_SESSIONS = 100;
const STATUS_PRIORITY: Record<RadarSessionStatus, number> = {
  awaiting_approval: 0,
  error: 1,
  stalled: 2,
  completed: 3,
  running: 4,
};

export function getRadarBoardPath(moduleDataDir: string): string {
  return path.join(moduleDataDir, 'board.json');
}

export function normalizeRadarPrefs(raw: unknown): RadarPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_RADAR_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const rawStall =
    typeof obj.stallMinutes === 'number' && Number.isFinite(obj.stallMinutes)
      ? Math.round(obj.stallMinutes)
      : DEFAULT_RADAR_PREFS.stallMinutes;
  return {
    desktopNotify: typeof obj.desktopNotify === 'boolean' ? obj.desktopNotify : false,
    soundChime: typeof obj.soundChime === 'boolean' ? obj.soundChime : false,
    stallMinutes: Math.max(1, Math.min(rawStall, 120)),
  };
}

function createEmptyBoard(): RadarBoardFile {
  return {
    schemaVersion: 1,
    prefs: { ...DEFAULT_RADAR_PREFS },
    sessions: {},
    updatedAt: new Date().toISOString(),
  };
}

function isStoredStatus(value: unknown): value is RadarStoredStatus {
  return (
    value === 'running' ||
    value === 'awaiting_approval' ||
    value === 'completed' ||
    value === 'error'
  );
}

function normalizeSessionRecord(id: string, raw: unknown): RadarSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const status: RadarStoredStatus = isStoredStatus(obj.status) ? obj.status : 'running';
  const lastEvent =
    obj.lastEvent === 'PreToolUse' ||
    obj.lastEvent === 'PostToolUse' ||
    obj.lastEvent === 'Stop' ||
    obj.lastEvent === 'manual'
      ? obj.lastEvent
      : 'manual';

  return {
    conversationId: typeof obj.conversationId === 'string' && obj.conversationId ? obj.conversationId : id,
    status,
    workspaceName: typeof obj.workspaceName === 'string' && obj.workspaceName ? obj.workspaceName : 'workspace',
    workspaceRoot: typeof obj.workspaceRoot === 'string' ? obj.workspaceRoot : undefined,
    lastToolName: typeof obj.lastToolName === 'string' ? obj.lastToolName : undefined,
    lastEvent,
    stepCount: typeof obj.stepCount === 'number' && Number.isFinite(obj.stepCount) ? Math.max(0, Math.floor(obj.stepCount)) : 0,
    unread: Boolean(obj.unread),
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : undefined,
    startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : nowIso,
    lastActiveAt: typeof obj.lastActiveAt === 'string' ? obj.lastActiveAt : nowIso,
    completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : undefined,
  };
}

/**
 * Pure read-only load. Never creates directories or files on disk.
 */
export function loadRadarBoardReadOnly(moduleDataDir: string): RadarBoardFile {
  const boardPath = getRadarBoardPath(moduleDataDir);
  if (!fs.existsSync(boardPath)) {
    return createEmptyBoard();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(boardPath, 'utf8')) as Record<string, unknown>;
    const prefs = normalizeRadarPrefs(raw.prefs);
    const sessions: Record<string, RadarSessionRecord> = {};
    if (raw.sessions && typeof raw.sessions === 'object') {
      for (const [id, rec] of Object.entries(raw.sessions as Record<string, unknown>)) {
        const normalized = normalizeSessionRecord(id, rec);
        if (normalized) {
          sessions[normalized.conversationId] = normalized;
        }
      }
    }
    return {
      schemaVersion: 1,
      prefs,
      sessions,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return createEmptyBoard();
  }
}

export function saveRadarBoard(moduleDataDir: string, board: RadarBoardFile): RadarBoardFile {
  const entries = Object.values(board.sessions).sort(
    (a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt),
  );
  const pruned: Record<string, RadarSessionRecord> = {};
  for (const rec of entries.slice(0, MAX_STORED_SESSIONS)) {
    pruned[rec.conversationId] = rec;
  }

  const next: RadarBoardFile = {
    schemaVersion: 1,
    prefs: normalizeRadarPrefs(board.prefs),
    sessions: pruned,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(getRadarBoardPath(moduleDataDir), next);
  return next;
}

export function computeRadarBoardView(
  board: RadarBoardFile,
  opts: {
    mode?: 'live' | 'demo';
    nowMs?: number;
    statusFilter?: RadarSessionStatus;
    onlyUnread?: boolean;
  } = {},
): RadarBoardView {
  const nowMs = opts.nowMs ?? Date.now();
  const stallThresholdMs = Math.max(1, board.prefs.stallMinutes) * 60_000;

  const counts: RadarBoardCounts = {
    total: 0,
    running: 0,
    awaiting_approval: 0,
    completed: 0,
    stalled: 0,
    error: 0,
    unread: 0,
  };

  const allViews: RadarSessionView[] = Object.values(board.sessions).map((rec) => {
    const activeMs = Date.parse(rec.lastActiveAt);
    const idleMs = Number.isFinite(activeMs) ? Math.max(0, nowMs - activeMs) : 0;
    const idleMinutes = Number((idleMs / 60_000).toFixed(1));
    const effectiveStatus: RadarSessionStatus =
      rec.status === 'running' && idleMs >= stallThresholdMs ? 'stalled' : rec.status;

    counts.total += 1;
    counts[effectiveStatus] += 1;
    if (rec.unread) counts.unread += 1;

    return {
      ...rec,
      status: effectiveStatus,
      rawStatus: rec.status,
      idleMinutes,
    };
  });

  allViews.sort((a, b) => {
    // Unread completed sessions bubble ahead of read completed and normal running sessions
    const aWeight =
      a.status === 'completed' && !a.unread ? 5 : STATUS_PRIORITY[a.status];
    const bWeight =
      b.status === 'completed' && !b.unread ? 5 : STATUS_PRIORITY[b.status];
    if (aWeight !== bWeight) return aWeight - bWeight;
    return Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
  });

  const filtered = allViews.filter((item) => {
    if (opts.statusFilter && item.status !== opts.statusFilter) return false;
    if (opts.onlyUnread && !item.unread) return false;
    return true;
  });

  return {
    mode: opts.mode ?? 'live',
    prefs: { ...board.prefs },
    counts,
    sessions: filtered,
    updatedAt: board.updatedAt,
  };
}

export interface RadarEventUpdate {
  conversationId: string;
  event: 'PreToolUse' | 'PostToolUse' | 'Stop';
  workspaceRoot?: string;
  toolName?: string;
  awaitingApproval?: boolean;
  errorMessage?: string;
  summary?: string;
  timestampIso?: string;
}

export function cleanBriefText(raw: string | undefined, maxLen = 160): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[\r\n\t\x00-\x1f]+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export function recordRadarSessionEvent(
  moduleDataDir: string,
  input: RadarEventUpdate,
): { board: RadarBoardFile; session: RadarSessionRecord } {
  const board = loadRadarBoardReadOnly(moduleDataDir);
  const nowIso = input.timestampIso ?? new Date().toISOString();
  const convId = input.conversationId.trim().slice(0, 120) || 'default-session';
  const existing = board.sessions[convId];
  const workspaceName = input.workspaceRoot
    ? path.basename(path.resolve(input.workspaceRoot)) || existing?.workspaceName || 'workspace'
    : existing?.workspaceName ?? 'workspace';

  let nextStatus: RadarStoredStatus = existing?.status ?? 'running';
  let nextUnread = existing?.unread ?? false;
  let completedAt = existing?.completedAt;
  let errorMessage = existing?.errorMessage;

  if (input.event === 'PreToolUse') {
    if (input.awaitingApproval) {
      nextStatus = 'awaiting_approval';
      nextUnread = true;
    } else {
      nextStatus = 'running';
    }
    completedAt = undefined;
    errorMessage = undefined;
  } else if (input.event === 'PostToolUse') {
    nextStatus = 'running';
    if (existing?.status === 'awaiting_approval') {
      nextUnread = false;
    }
    completedAt = undefined;
    errorMessage = undefined;
  } else if (input.event === 'Stop') {
    if (input.errorMessage) {
      nextStatus = 'error';
      errorMessage = cleanBriefText(input.errorMessage, 160);
    } else {
      nextStatus = 'completed';
      errorMessage = undefined;
    }
    nextUnread = true;
    completedAt = nowIso;
  }

  const nextSession: RadarSessionRecord = {
    conversationId: convId,
    status: nextStatus,
    workspaceName,
    workspaceRoot: input.workspaceRoot ?? existing?.workspaceRoot,
    lastToolName: input.toolName ?? existing?.lastToolName,
    lastEvent: input.event,
    stepCount: (existing?.stepCount ?? 0) + 1,
    unread: nextUnread,
    summary: cleanBriefText(input.summary, 140) ?? existing?.summary,
    errorMessage,
    startedAt: existing?.startedAt ?? nowIso,
    lastActiveAt: nowIso,
    completedAt,
  };

  board.sessions[convId] = nextSession;
  const saved = saveRadarBoard(moduleDataDir, board);
  return { board: saved, session: nextSession };
}

export function ackRadarSessionsInBoard(
  board: RadarBoardFile,
  conversationId?: string,
): { changed: boolean; acknowledgedCount: number } {
  let acknowledgedCount = 0;
  if (conversationId && conversationId !== 'all') {
    const rec = board.sessions[conversationId];
    if (rec && rec.unread) {
      rec.unread = false;
      acknowledgedCount = 1;
    }
    return { changed: acknowledgedCount > 0, acknowledgedCount };
  }

  for (const rec of Object.values(board.sessions)) {
    if (rec.unread) {
      rec.unread = false;
      acknowledgedCount += 1;
    }
  }
  return { changed: acknowledgedCount > 0, acknowledgedCount };
}

export function ackRadarSession(
  moduleDataDir: string,
  conversationId?: string,
): { board: RadarBoardFile; acknowledgedCount: number } {
  const board = loadRadarBoardReadOnly(moduleDataDir);
  const { changed, acknowledgedCount } = ackRadarSessionsInBoard(board, conversationId);
  if (!changed) {
    return { board, acknowledgedCount: 0 };
  }
  const saved = saveRadarBoard(moduleDataDir, board);
  return { board: saved, acknowledgedCount };
}

export function updateRadarPrefs(
  moduleDataDir: string,
  patch: Partial<RadarPrefs>,
): RadarBoardFile {
  const board = loadRadarBoardReadOnly(moduleDataDir);
  board.prefs = normalizeRadarPrefs({
    ...board.prefs,
    ...patch,
  });
  return saveRadarBoard(moduleDataDir, board);
}

export function clearCompletedInBoard(board: RadarBoardFile): { removedCount: number } {
  let removedCount = 0;
  for (const [id, rec] of Object.entries(board.sessions)) {
    if (rec.status === 'completed' || rec.status === 'error') {
      delete board.sessions[id];
      removedCount += 1;
    }
  }
  return { removedCount };
}

export function clearCompletedRadarSessions(
  moduleDataDir: string,
): { board: RadarBoardFile; removedCount: number } {
  const board = loadRadarBoardReadOnly(moduleDataDir);
  const { removedCount } = clearCompletedInBoard(board);
  if (removedCount === 0) {
    return { board, removedCount: 0 };
  }
  const saved = saveRadarBoard(moduleDataDir, board);
  return { board: saved, removedCount };
}

/**
 * Strip control chars, quotes, backslashes, shell metacharacters, and truncate safely.
 */
export function sanitizeNotificationText(text: string, maxLen = 120): string {
  const stripped = String(text ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/["'`\\$<>|;&{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'agy-NOV';
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen - 1)}…` : stripped;
}

/**
 * Pure builder for OS notification command using execFile argument arrays (no shell interpolation).
 */
export function buildSafeNotifyInvocation(
  platform: NodeJS.Platform,
  title: string,
  message: string,
  prefs: RadarPrefs,
): SafeNotifyInvocation | null {
  if (!prefs.desktopNotify && !prefs.soundChime) {
    return null;
  }

  const safeTitle = sanitizeNotificationText(title, 64);
  const safeMsg = sanitizeNotificationText(message, 140);

  if (platform === 'darwin') {
    if (prefs.desktopNotify) {
      const displayLine = prefs.soundChime
        ? 'display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"'
        : 'display notification (item 1 of argv) with title (item 2 of argv)';
      return {
        command: 'osascript',
        args: ['-e', 'on run argv', '-e', displayLine, '-e', 'end run', '--', safeMsg, safeTitle],
      };
    }
    if (prefs.soundChime) {
      return {
        command: 'afplay',
        args: ['/System/Library/Sounds/Glass.aiff'],
      };
    }
  }

  if (platform === 'linux' && prefs.desktopNotify) {
    return {
      command: 'notify-send',
      args: ['--', safeTitle, safeMsg],
    };
  }

  return null;
}

export function triggerRadarNotification(
  title: string,
  message: string,
  prefs: RadarPrefs,
  platform: NodeJS.Platform = process.platform,
): NotifyDispatchResult {
  if (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    Boolean(process.env.AGY_NOV_NO_NOTIFY)
  ) {
    return { dispatched: false, reason: 'suppressed-by-env' };
  }
  if (!prefs.desktopNotify && !prefs.soundChime) {
    return { dispatched: false, reason: 'disabled-in-prefs' };
  }
  const invocation = buildSafeNotifyInvocation(platform, title, message, prefs);
  if (!invocation) {
    return { dispatched: false, reason: 'unsupported-platform' };
  }

  try {
    const child = execFile(
      invocation.command,
      invocation.args,
      { timeout: 3000, windowsHide: true },
      () => {
        // Ignore notification errors silently
      },
    );
    child.unref?.();
    return { dispatched: true, invocation };
  } catch {
    return { dispatched: false, reason: 'exec-failed' };
  }
}

export function createDemoRadarBoard(nowMs = Date.now()): RadarBoardFile {
  const isoAgo = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  return {
    schemaVersion: 1,
    prefs: {
      desktopNotify: false,
      soundChime: false,
      stallMinutes: 5,
    },
    sessions: {
      'conv-auth-migration': {
        conversationId: 'conv-auth-migration',
        status: 'awaiting_approval',
        workspaceName: 'payments-api',
        lastToolName: 'run_command',
        lastEvent: 'PreToolUse',
        stepCount: 14,
        unread: true,
        summary: 'Waiting for confirmation before applying Prisma migration on staging',
        startedAt: isoAgo(18),
        lastActiveAt: isoAgo(0.8),
      },
      'conv-ui-polish': {
        conversationId: 'conv-ui-polish',
        status: 'running',
        workspaceName: 'agy-NOV',
        lastToolName: 'edit_file',
        lastEvent: 'PostToolUse',
        stepCount: 9,
        unread: false,
        summary: 'Implementing Turbo & Radar tabs in single-file MCP App UI',
        startedAt: isoAgo(6),
        lastActiveAt: isoAgo(0.4),
      },
      'conv-unit-tests': {
        conversationId: 'conv-unit-tests',
        status: 'completed',
        workspaceName: 'agy-NOV',
        lastToolName: 'run_command',
        lastEvent: 'Stop',
        stepCount: 11,
        unread: true,
        summary: 'All 42 offline unit tests passed with zero warnings',
        startedAt: isoAgo(22),
        lastActiveAt: isoAgo(2),
        completedAt: isoAgo(2),
      },
      'conv-dep-upgrade': {
        conversationId: 'conv-dep-upgrade',
        status: 'running',
        workspaceName: 'docs-site',
        lastToolName: 'run_command',
        lastEvent: 'PreToolUse',
        stepCount: 5,
        unread: false,
        summary: 'Long-running build step appears unresponsive (>5 min idle)',
        startedAt: isoAgo(20),
        lastActiveAt: isoAgo(11.5),
      },
    },
    updatedAt: new Date(nowMs).toISOString(),
  };
}
