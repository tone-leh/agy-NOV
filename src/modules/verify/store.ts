import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJson,
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/fs-safe.js';
import {
  clampMaxConsecutiveBlocks,
  validateAndBuildPolicy,
  validateVerifyCommand,
} from './allowlist.js';
import { redactVerifyOutput } from './sanitize.js';
import {
  DEFAULT_VERIFY_POLICY,
  MAX_STORED_EVIDENCE,
  MAX_STORED_SESSIONS,
  MAX_VERIFY_COMMANDS,
  type VerifyCommandRunResult,
  type VerifyCommandSpec,
  type VerifyEvidenceRecord,
  type VerifyOutcome,
  type VerifyPolicy,
  type VerifyPolicyPatch,
  type VerifySessionRecord,
  type VerifyStateFile,
  type VerifyStateView,
  type VerifyStats,
  type VerifyTrigger,
  type WorkspaceFileCheck,
} from './types.js';

const MAX_SYMLINK_DEPTH = 20;

export function getVerifyStatePath(moduleDataDir: string): string {
  return path.join(moduleDataDir, 'state.json');
}

function cloneDefaultPolicy(): VerifyPolicy {
  return {
    ...DEFAULT_VERIFY_POLICY,
    commands: DEFAULT_VERIFY_POLICY.commands.map((c) => ({ ...c, args: [...c.args] })),
  };
}

export function createDefaultVerifyState(nowIso = new Date().toISOString()): VerifyStateFile {
  return {
    schemaVersion: 1,
    policy: cloneDefaultPolicy(),
    sessions: {},
    evidence: [],
    blockedStops: 0,
    updatedAt: nowIso,
  };
}

function normalizePolicyFromDisk(raw: unknown): VerifyPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneDefaultPolicy();
  }
  const obj = raw as Record<string, unknown>;
  const commands: VerifyCommandSpec[] = [];
  if (Array.isArray(obj.commands)) {
    const seen = new Set<string>();
    for (const item of obj.commands.slice(0, MAX_VERIFY_COMMANDS)) {
      const check = validateVerifyCommand(item);
      if (check.valid && check.command && !seen.has(check.command.id)) {
        seen.add(check.command.id);
        commands.push(check.command);
      }
    }
  } else {
    commands.push(...cloneDefaultPolicy().commands);
  }

  return {
    enforceOnStop:
      typeof obj.enforceOnStop === 'boolean'
        ? obj.enforceOnStop
        : DEFAULT_VERIFY_POLICY.enforceOnStop,
    autoRunOnStop:
      typeof obj.autoRunOnStop === 'boolean'
        ? obj.autoRunOnStop
        : DEFAULT_VERIFY_POLICY.autoRunOnStop,
    blockEmptyWrites:
      typeof obj.blockEmptyWrites === 'boolean'
        ? obj.blockEmptyWrites
        : DEFAULT_VERIFY_POLICY.blockEmptyWrites,
    maxConsecutiveBlocks: clampMaxConsecutiveBlocks(obj.maxConsecutiveBlocks),
    commands,
  };
}

function normalizeStringArray(raw: unknown, maxLen = 200): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() && !seen.has(item)) {
      seen.add(item);
      out.push(item);
      if (out.length >= maxLen) break;
    }
  }
  return out;
}

function normalizeSessionFromDisk(id: string, raw: unknown): VerifySessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const convId =
    typeof obj.conversationId === 'string' && obj.conversationId.trim()
      ? obj.conversationId.trim().slice(0, 120)
      : id;

  return {
    conversationId: convId,
    workspaceRoot: typeof obj.workspaceRoot === 'string' ? obj.workspaceRoot : undefined,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    lastEditAt: typeof obj.lastEditAt === 'string' ? obj.lastEditAt : undefined,
    lastVerifiedAt: typeof obj.lastVerifiedAt === 'string' ? obj.lastVerifiedAt : undefined,
    lastVerifiedPassed:
      typeof obj.lastVerifiedPassed === 'boolean' ? obj.lastVerifiedPassed : undefined,
    consecutiveBlocks:
      typeof obj.consecutiveBlocks === 'number' && Number.isFinite(obj.consecutiveBlocks)
        ? Math.max(0, Math.floor(obj.consecutiveBlocks))
        : 0,
    totalBlocks:
      typeof obj.totalBlocks === 'number' && Number.isFinite(obj.totalBlocks)
        ? Math.max(0, Math.floor(obj.totalBlocks))
        : 0,
    lastGuardrailReleaseAt:
      typeof obj.lastGuardrailReleaseAt === 'string' ? obj.lastGuardrailReleaseAt : undefined,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : nowIso,
  };
}

function normalizeCommandRunResultFromDisk(raw: unknown): VerifyCommandRunResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.commandId !== 'string' || typeof obj.executable !== 'string') return null;
  return {
    commandId: obj.commandId,
    label: typeof obj.label === 'string' ? obj.label : obj.commandId,
    executable: obj.executable,
    args: Array.isArray(obj.args) ? obj.args.filter((a): a is string => typeof a === 'string') : [],
    passed: Boolean(obj.passed),
    exitCode: typeof obj.exitCode === 'number' && Number.isFinite(obj.exitCode) ? obj.exitCode : null,
    timedOut: Boolean(obj.timedOut),
    durationMs:
      typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
        ? Math.max(0, Math.round(obj.durationMs))
        : 0,
    outputTail: typeof obj.outputTail === 'string' ? redactVerifyOutput(obj.outputTail) : '',
    outputTruncated: Boolean(obj.outputTruncated),
    error: typeof obj.error === 'string' ? redactVerifyOutput(obj.error) : undefined,
  };
}

function normalizeEvidenceFromDisk(raw: unknown): VerifyEvidenceRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.timestamp !== 'string') return null;
  const trigger: VerifyTrigger =
    obj.trigger === 'manual' || obj.trigger === 'stop-hook' || obj.trigger === 'app-ui'
      ? obj.trigger
      : 'manual';
  const outcome: VerifyOutcome =
    obj.outcome === 'pass' ||
    obj.outcome === 'fail' ||
    obj.outcome === 'blocked' ||
    obj.outcome === 'guardrail-allow'
      ? obj.outcome
      : obj.passed
        ? 'pass'
        : 'fail';

  const results: VerifyCommandRunResult[] = [];
  if (Array.isArray(obj.results)) {
    for (const r of obj.results) {
      const norm = normalizeCommandRunResultFromDisk(r);
      if (norm) results.push(norm);
    }
  }

  const targetBranch =
    typeof obj.targetBranch === 'string' && obj.targetBranch.trim()
      ? redactVerifyOutput(obj.targetBranch.trim()).slice(0, 160)
      : undefined;
  const targetWorktree =
    typeof obj.targetWorktree === 'string' && obj.targetWorktree.trim()
      ? redactVerifyOutput(obj.targetWorktree.trim()).slice(0, 512)
      : undefined;

  return {
    id: obj.id,
    conversationId: typeof obj.conversationId === 'string' ? obj.conversationId : 'default-session',
    trigger,
    outcome,
    passed: Boolean(obj.passed),
    timestamp: obj.timestamp,
    durationMs:
      typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
        ? Math.max(0, Math.round(obj.durationMs))
        : 0,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    results,
    summary: typeof obj.summary === 'string' ? redactVerifyOutput(obj.summary) : '',
    reason: typeof obj.reason === 'string' ? redactVerifyOutput(obj.reason) : undefined,
    ...(targetBranch ? { targetBranch } : {}),
    ...(targetWorktree ? { targetWorktree } : {}),
  };
}

/**
 * Pure read-only load. Never creates directories or writes to disk.
 */
export function loadVerifyStateReadOnly(moduleDataDir: string): VerifyStateFile {
  const statePath = getVerifyStatePath(moduleDataDir);
  if (!fs.existsSync(statePath)) {
    return createDefaultVerifyState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    const policy = normalizePolicyFromDisk(raw.policy);
    const sessions: Record<string, VerifySessionRecord> = {};
    if (raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
      for (const [id, rec] of Object.entries(raw.sessions as Record<string, unknown>)) {
        const norm = normalizeSessionFromDisk(id, rec);
        if (norm) sessions[norm.conversationId] = norm;
      }
    }
    const evidence: VerifyEvidenceRecord[] = [];
    if (Array.isArray(raw.evidence)) {
      for (const item of raw.evidence.slice(0, MAX_STORED_EVIDENCE)) {
        const norm = normalizeEvidenceFromDisk(item);
        if (norm) evidence.push(norm);
      }
    }
    const blockedStops =
      typeof raw.blockedStops === 'number' && Number.isFinite(raw.blockedStops)
        ? Math.max(0, Math.floor(raw.blockedStops))
        : evidence.filter((e) => e.outcome === 'blocked').length;

    return {
      schemaVersion: 1,
      policy,
      sessions,
      evidence,
      blockedStops,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return createDefaultVerifyState();
  }
}

export function saveVerifyState(moduleDataDir: string, state: VerifyStateFile): VerifyStateFile {
  const sortedSessions = Object.values(state.sessions)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_STORED_SESSIONS);
  const prunedSessions: Record<string, VerifySessionRecord> = {};
  for (const s of sortedSessions) {
    prunedSessions[s.conversationId] = s;
  }

  const next: VerifyStateFile = {
    schemaVersion: 1,
    policy: normalizePolicyFromDisk(state.policy),
    sessions: prunedSessions,
    evidence: state.evidence.slice(0, MAX_STORED_EVIDENCE),
    blockedStops: Math.max(0, Math.floor(state.blockedStops)),
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(getVerifyStatePath(moduleDataDir), next, { ignoreTopLevelKeys: ['updatedAt'] });
  return next;
}

export function computeVerifyStats(state: VerifyStateFile): VerifyStats {
  let passedRuns = 0;
  let failedRuns = 0;
  let blockedInEvidence = 0;
  for (const rec of state.evidence) {
    if (rec.passed) passedRuns += 1;
    else failedRuns += 1;
    if (rec.outcome === 'blocked') blockedInEvidence += 1;
  }
  return {
    totalRuns: state.evidence.length,
    passedRuns,
    failedRuns,
    blockedStops: Math.max(state.blockedStops, blockedInEvidence),
  };
}

export function buildVerifyStateView(
  state: VerifyStateFile,
  mode: 'live' | 'demo' = 'live',
): VerifyStateView {
  const sessions = Object.values(state.sessions)
    .map((s) => ({
      ...s,
      dirtyFiles: [...s.dirtyFiles],
      emptyFiles: [...s.emptyFiles],
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return {
    mode,
    policy: {
      ...state.policy,
      commands: state.policy.commands.map((c) => ({ ...c, args: [...c.args] })),
    },
    sessions,
    evidence: state.evidence.map((e) => ({
      ...e,
      dirtyFiles: [...e.dirtyFiles],
      emptyFiles: [...e.emptyFiles],
      results: e.results.map((r) => ({ ...r, args: [...r.args] })),
    })),
    stats: computeVerifyStats(state),
    updatedAt: state.updatedAt,
  };
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

/**
 * Resolve a target path against workspaceRoot via realpath and inspect emptiness safely.
 * Returns `{ inside: false }` for any path escaping workspaceRoot or unresolvable symlink loops.
 */
export function inspectWorkspaceFile(
  workspaceRoot: string | undefined,
  targetPath: string,
): WorkspaceFileCheck {
  if (!workspaceRoot || workspaceRoot.includes('\0') || !targetPath || targetPath.includes('\0')) {
    return { inside: false };
  }
  try {
    const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
    const candidate = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(workspaceRoot, targetPath);
    const realTarget = resolveRealPathWithMissingTail(candidate);

    if (!isPathInsideDir(realRoot, realTarget) || isSamePath(realRoot, realTarget)) {
      return { inside: false };
    }

    const relPath = path.relative(realRoot, realTarget).split(path.sep).join('/');
    if (!relPath || relPath === '.' || relPath.startsWith('../')) {
      return { inside: false };
    }

    let exists = false;
    let isFile = false;
    let isEmpty = false;
    try {
      const stat = fs.statSync(realTarget);
      exists = true;
      isFile = stat.isFile();
      isEmpty = isFile && stat.size === 0;
    } catch {
      exists = false;
    }

    return {
      inside: true,
      realRoot,
      realTarget,
      relPath,
      exists,
      isFile,
      isEmpty,
    };
  } catch {
    return { inside: false };
  }
}

/**
 * Re-scan workspace dirty/empty files and return only those currently inside workspace and 0 bytes.
 */
export function scanEmptyWorkspaceFiles(
  workspaceRoot: string | undefined,
  filePaths: Iterable<string>,
): string[] {
  if (!workspaceRoot) return [];
  const empty: string[] = [];
  const seen = new Set<string>();
  for (const rel of filePaths) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const check = inspectWorkspaceFile(workspaceRoot, rel);
    if (check.inside && check.exists && check.isFile && check.isEmpty && check.relPath) {
      empty.push(check.relPath);
    }
  }
  return empty;
}

export function createEvidenceId(prefix = 'ver'): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function appendEvidenceToState(
  state: VerifyStateFile,
  record: VerifyEvidenceRecord,
): void {
  state.evidence.unshift(record);
  if (state.evidence.length > MAX_STORED_EVIDENCE) {
    state.evidence = state.evidence.slice(0, MAX_STORED_EVIDENCE);
  }
  state.updatedAt = record.timestamp;
}

export function updateVerifyPolicy(
  moduleDataDir: string,
  patch: VerifyPolicyPatch,
): { valid: true; policy: VerifyPolicy; state: VerifyStateFile } | { valid: false; error: string } {
  const state = loadVerifyStateReadOnly(moduleDataDir);
  const validated = validateAndBuildPolicy(state.policy, patch);
  if (!validated.valid) {
    return validated;
  }
  state.policy = validated.policy;
  const saved = saveVerifyState(moduleDataDir, state);
  return { valid: true, policy: saved.policy, state: saved };
}

export function clearVerifyHistoryInState(state: VerifyStateFile): number {
  const cleared = state.evidence.length + Object.keys(state.sessions).length;
  state.evidence = [];
  state.sessions = {};
  state.blockedStops = 0;
  state.updatedAt = new Date().toISOString();
  return cleared;
}

export function clearVerifyHistory(
  moduleDataDir: string,
): { cleared: number; state: VerifyStateFile } {
  const statePath = getVerifyStatePath(moduleDataDir);
  const state = loadVerifyStateReadOnly(moduleDataDir);
  const cleared = clearVerifyHistoryInState(state);
  if (cleared === 0 && !fs.existsSync(statePath)) {
    return { cleared: 0, state };
  }
  const saved = saveVerifyState(moduleDataDir, state);
  return { cleared, state: saved };
}
