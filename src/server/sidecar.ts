import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  countEnabledModelTools,
  createDefaultConfig,
  getConfigPath,
  loadNovConfigReadOnly,
  MAX_MCP_TOOL_BUDGET,
  MODULE_IDS,
  resolveNovDataDir,
  type ModuleId,
  type NovConfig,
  type PresetId,
} from '../core/config.js';
import {
  FEED_SNAPSHOT_VERSION,
  isMemoryRecordStale,
  redactFeedText,
} from '../core/feed.js';
import {
  atomicRenameSync,
  canonicalRealpathSync,
  hasUnsafeSymlinkAncestor,
  isPathInsideDir,
} from '../core/fs-safe.js';
import { auditWorkspaceReadOnly } from '../modules/ops/core.js';

export const HEALTH_SWEEP_SCHEMA_VERSION = 1 as const;
export const HEALTH_SWEEP_FILENAME = 'health-sweep.json' as const;
export const MAX_HEALTH_SWEEP_BYTES = 64 * 1024;
export const MAX_HEALTH_SWEEP_READ_BYTES = 2 * 1024 * 1024; // 2 MiB cap per read-only JSON file

const MAX_RECOMMENDATIONS = 6;
const MAX_TOP_FINDINGS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_MEM_TTL_DAYS = 1;
const MAX_MEM_TTL_DAYS = 365;

export type HealthSweepOverallStatus = 'healthy' | 'attention' | 'action-required';

export interface HealthSweepOptions {
  workspaceRoot?: string;
  dataDir?: string;
  now?: Date;
}

export interface HealthSweepFindingSummary {
  severity: 'high' | 'medium' | 'low';
  category: string;
  file: string;
  title: string;
}

export interface HealthSweepReport {
  schemaVersion: typeof HEALTH_SWEEP_SCHEMA_VERSION;
  version: string;
  generatedAt: string;
  readOnly: true;
  workspaceName: string;
  overallStatus: HealthSweepOverallStatus;
  config: {
    preset: PresetId | 'custom';
    enabledModulesCount: number;
    totalModules: number;
    exposedModelTools: number;
    remoteEnabled: boolean;
  };
  ops: {
    healthScore: number;
    securityScore: number;
    ruleBloatStatus: 'ok' | 'warn' | 'critical';
    ruleTotalTokens: number;
    toolBudgetStatus: 'ok' | 'warn' | 'critical';
    estimatedTotalTools: number;
    toolBudgetLimit: number;
    highSecurityFindingsCount: number;
    totalSecurityFindingsCount: number;
    topFindings: HealthSweepFindingSummary[];
  };
  mem: {
    totalMemories: number;
    staleCount: number;
    expiredUnpinnedCount: number;
  };
  verify: {
    verifyLastStatus: 'pass' | 'fail' | 'blocked' | 'idle';
    dirtyFilesCount: number;
  };
  guard: {
    guardBlockedCount: number;
  };
  recommendations: string[];
}

export interface WriteHealthSweepReportResult {
  written: boolean;
  path?: string;
  bytes?: number;
  reason?: string;
}

export function getHealthSweepReportPath(dataDir: string): string {
  return path.join(dataDir, HEALTH_SWEEP_FILENAME);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveSafeRealDir(dirPath: string): string | null {
  if (!dirPath || typeof dirPath !== 'string') return null;
  if (hasUnsafeSymlinkAncestor(dirPath)) return null;
  try {
    const st = fs.lstatSync(dirPath);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return canonicalRealpathSync(dirPath);
  } catch {
    return null;
  }
}

function readSafeModuleJsonReadOnly(
  rootDataDir: string,
  moduleId: ModuleId,
  fileName: string,
): unknown | null {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) return null;

  const modulesRoot = path.join(realRoot, 'modules');
  const realModules = resolveSafeRealDir(modulesRoot);
  if (!realModules || !isPathInsideDir(realRoot, realModules)) return null;

  const modDir = path.join(realModules, moduleId);
  const realMod = resolveSafeRealDir(modDir);
  if (!realMod || !isPathInsideDir(realModules, realMod)) return null;

  const targetPath = path.join(realMod, fileName);
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_HEALTH_SWEEP_READ_BYTES) return null;
    const realTarget = canonicalRealpathSync(targetPath);
    if (!isPathInsideDir(realMod, realTarget)) return null;
    const raw = fs.readFileSync(realTarget, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function loadSafeConfigReadOnly(rootDataDir: string): NovConfig {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) {
    return createDefaultConfig();
  }
  const cfgPath = getConfigPath(realRoot);
  try {
    const st = fs.lstatSync(cfgPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_HEALTH_SWEEP_READ_BYTES) {
      return createDefaultConfig();
    }
    const realCfg = canonicalRealpathSync(cfgPath);
    if (!isPathInsideDir(realRoot, realCfg)) {
      return createDefaultConfig();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return createDefaultConfig();
    }
    return createDefaultConfig();
  }
  return loadNovConfigReadOnly(realRoot);
}

/**
 * Extracts only the final workspace folder name using cross-platform `path.posix.basename`
 * so absolute host paths (`/Users/...`, `C:\Users\...`) are never emitted in reports.
 */
function extractSafeWorkspaceName(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = path.posix.basename(normalized);
  if (!base || base === '.' || base === '..' || /^[A-Za-z]:$/.test(base)) {
    return 'workspace';
  }
  return redactFeedText(base, 80) || 'workspace';
}

function stripAbsoluteHostPaths(input: string): string {
  if (!input) return '';
  return input
    .replace(/(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`<>|*?)}\]]+/g, '<path>')
    .replace(
      /(?<!:\/)\/(?:Users|home|private|var|tmp|opt|etc|root|Volumes|mnt)\/[^\s"'`<>)}\]]+/g,
      '<path>',
    );
}

function sanitizeSummaryText(input: string, maxLen = 180): string {
  return redactFeedText(stripAbsoluteHostPaths(input), maxLen);
}

function sanitizeRelativeFindingPath(rawPath: string): string {
  const stripped = stripAbsoluteHostPaths(rawPath);
  if (stripped.includes('<path>')) {
    return sanitizeSummaryText(stripped, 120);
  }
  const unixPath = stripped
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '')
    .replace(/^\/+/, '');
  return sanitizeSummaryText(unixPath || 'workspace', 120);
}

function resolveRecordExpiresMs(rec: Record<string, unknown>): number {
  if (typeof rec.expiresAt === 'string' && rec.expiresAt.trim()) {
    const parsed = Date.parse(rec.expiresAt.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  if (rec.ttlDays === null) return Number.NaN;
  if (typeof rec.ttlDays === 'number' && Number.isFinite(rec.ttlDays) && rec.ttlDays >= MIN_MEM_TTL_DAYS) {
    const baseStr =
      typeof rec.verifiedAt === 'string' && rec.verifiedAt.trim()
        ? rec.verifiedAt
        : typeof rec.updatedAt === 'string' && rec.updatedAt.trim()
          ? rec.updatedAt
          : typeof rec.createdAt === 'string' && rec.createdAt.trim()
            ? rec.createdAt
            : '';
    const baseMs = baseStr ? Date.parse(baseStr) : Number.NaN;
    if (Number.isFinite(baseMs)) {
      const clampedDays = Math.min(MAX_MEM_TTL_DAYS, Math.max(MIN_MEM_TTL_DAYS, Math.floor(rec.ttlDays)));
      return baseMs + clampedDays * MS_PER_DAY;
    }
  }
  return Number.NaN;
}

function inspectMemoriesReadOnly(
  rootDataDir: string,
  nowMs: number,
): HealthSweepReport['mem'] {
  const raw = readSafeModuleJsonReadOnly(rootDataDir, 'mem', 'memories.json');
  const rawObj = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.memories)
      ? rawObj.memories
      : Array.isArray(rawObj?.items)
        ? rawObj.items
        : [];

  let totalMemories = 0;
  let staleCount = 0;
  let expiredUnpinnedCount = 0;

  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    totalMemories += 1;

    if (isMemoryRecordStale(rec) || rec.hygieneStatus === 'drifted') {
      staleCount += 1;
    }

    if (rec.pinned !== true) {
      const expiresMs = resolveRecordExpiresMs(rec);
      if (
        (Number.isFinite(expiresMs) && expiresMs <= nowMs) ||
        rec.hygieneStatus === 'stale_ttl'
      ) {
        expiredUnpinnedCount += 1;
      }
    }
  }

  return {
    totalMemories,
    staleCount,
    expiredUnpinnedCount,
  };
}

function inspectVerifyReadOnly(rootDataDir: string): HealthSweepReport['verify'] {
  const state = asRecord(readSafeModuleJsonReadOnly(rootDataDir, 'verify', 'state.json'));
  const evidenceRaw = Array.isArray(state?.evidence) ? state.evidence : [];

  let latest: Record<string, unknown> | null = null;
  let latestTs = -Infinity;
  for (const item of evidenceRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const tsStr =
      typeof rec.timestamp === 'string' && rec.timestamp.trim()
        ? rec.timestamp.trim()
        : typeof rec.createdAt === 'string' && rec.createdAt.trim()
          ? rec.createdAt.trim()
          : '';
    const parsedTs = tsStr ? Date.parse(tsStr) : Number.NaN;
    const scoreTs = Number.isFinite(parsedTs) ? parsedTs : -Infinity;
    if (!latest || scoreTs > latestTs) {
      latest = rec;
      latestTs = scoreTs;
    }
  }

  let verifyLastStatus: 'pass' | 'fail' | 'blocked' | 'idle' = 'idle';
  if (latest) {
    const outcome = typeof latest.outcome === 'string' ? latest.outcome.trim().toLowerCase() : '';
    if (outcome === 'blocked' || latest.blocked === true) {
      verifyLastStatus = 'blocked';
    } else if (outcome === 'pass' || outcome === 'guardrail-allow' || latest.passed === true) {
      verifyLastStatus = 'pass';
    } else {
      verifyLastStatus = 'fail';
    }
  }

  const dirtySet = new Set<string>();
  const sessionsRaw = state?.sessions;
  const sessionList = Array.isArray(sessionsRaw)
    ? sessionsRaw
    : sessionsRaw && typeof sessionsRaw === 'object'
      ? Object.values(sessionsRaw as Record<string, unknown>)
      : [];
  for (const session of sessionList) {
    const rec = asRecord(session);
    if (!rec || !Array.isArray(rec.dirtyFiles)) continue;
    for (const file of rec.dirtyFiles) {
      if (typeof file === 'string' && file.trim()) {
        dirtySet.add(file.trim());
      }
    }
  }

  return {
    verifyLastStatus,
    dirtyFilesCount: dirtySet.size,
  };
}

function inspectGuardReadOnly(rootDataDir: string): HealthSweepReport['guard'] {
  const raw = readSafeModuleJsonReadOnly(rootDataDir, 'guard', 'audit.json');
  const rawObj = asRecord(raw);
  const eventsRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.events)
      ? rawObj.events
      : [];

  let guardBlockedCount = 0;
  for (const item of eventsRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const rawDecision = String(rec.decision ?? rec.action ?? rec.outcome ?? '')
      .trim()
      .toLowerCase();
    if (
      rawDecision === 'deny' ||
      rawDecision === 'denied' ||
      rawDecision === 'block' ||
      rawDecision === 'blocked'
    ) {
      guardBlockedCount += 1;
    }
  }

  return { guardBlockedCount };
}

function computeOverallStatus(params: {
  workspaceAccessible: boolean;
  ops: HealthSweepReport['ops'];
  mem: HealthSweepReport['mem'];
  verify: HealthSweepReport['verify'];
  guard: HealthSweepReport['guard'];
}): HealthSweepOverallStatus {
  const { workspaceAccessible, ops, mem, verify, guard } = params;

  if (
    ops.highSecurityFindingsCount > 0 ||
    ops.securityScore < 70 ||
    ops.healthScore < 60 ||
    ops.ruleBloatStatus === 'critical' ||
    ops.toolBudgetStatus === 'critical' ||
    verify.verifyLastStatus === 'blocked' ||
    guard.guardBlockedCount > 0
  ) {
    return 'action-required';
  }

  if (
    !workspaceAccessible ||
    ops.healthScore < 85 ||
    ops.securityScore < 90 ||
    ops.ruleBloatStatus === 'warn' ||
    ops.toolBudgetStatus === 'warn' ||
    ops.totalSecurityFindingsCount > 0 ||
    verify.verifyLastStatus === 'fail' ||
    verify.dirtyFilesCount > 0 ||
    mem.staleCount > 0 ||
    mem.expiredUnpinnedCount > 0
  ) {
    return 'attention';
  }

  return 'healthy';
}

function buildSweepRecommendations(params: {
  workspaceAccessible: boolean;
  ops: HealthSweepReport['ops'];
  mem: HealthSweepReport['mem'];
  verify: HealthSweepReport['verify'];
  guard: HealthSweepReport['guard'];
  opsRecommendationTexts: string[];
}): string[] {
  const { workspaceAccessible, ops, mem, verify, guard, opsRecommendationTexts } = params;
  const recs: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string): void => {
    if (recs.length >= MAX_RECOMMENDATIONS) return;
    const cleaned = sanitizeSummaryText(raw, 180);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recs.push(cleaned);
  };

  if (!workspaceAccessible) {
    pushUnique(
      'Workspace path is missing or blocked by an unsafe symlink ancestor; pass a valid --workspace directory.',
    );
  }

  if (ops.highSecurityFindingsCount > 0) {
    pushUnique(
      `Resolve ${ops.highSecurityFindingsCount} high-severity static security finding(s) via Ops Security Audit.`,
    );
  }

  if (guard.guardBlockedCount > 0) {
    pushUnique(
      `Review ${guard.guardBlockedCount} Guard-blocked tool event(s) in the Guard audit panel.`,
    );
  }

  if (verify.verifyLastStatus === 'blocked') {
    pushUnique(
      `Verify Gate blocked the latest Stop attempt (${verify.dirtyFilesCount} dirty file(s)); run verification checks before finishing.`,
    );
  } else if (verify.verifyLastStatus === 'fail') {
    pushUnique(
      `Latest Verify Gate check failed (${verify.dirtyFilesCount} dirty file(s)); inspect test/typecheck failures.`,
    );
  }

  if (ops.ruleBloatStatus !== 'ok') {
    pushUnique(
      `Rule bloat is ${ops.ruleBloatStatus} (${ops.ruleTotalTokens} est. tokens); keep rule files under 24 KB / 20K tokens.`,
    );
  }

  if (ops.toolBudgetStatus !== 'ok') {
    pushUnique(
      `MCP tool budget is ${ops.toolBudgetStatus} (${ops.estimatedTotalTools}/${ops.toolBudgetLimit}); disable idle modules or switch to the core preset.`,
    );
  }

  if (mem.staleCount > 0 || mem.expiredUnpinnedCount > 0) {
    pushUnique(
      `Clean up Memory hygiene: ${mem.staleCount} drifted/stale item(s) and ${mem.expiredUnpinnedCount} expired unpinned item(s).`,
    );
  }

  for (const text of opsRecommendationTexts) {
    pushUnique(text);
  }

  return recs.slice(0, MAX_RECOMMENDATIONS);
}

/**
 * Pure 100% read-only health sweep across workspace ops audit, memory hygiene,
 * verify gate state, guard audit log, and active agy-NOV configuration.
 * Strictly zero directory creation, zero disk writes, symlink-safe, and fully redacted.
 */
export function runReadOnlyHealthSweep(options: HealthSweepOptions = {}): HealthSweepReport {
  const now = options.now ?? new Date();
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  const dataDir = options.dataDir ? path.resolve(options.dataDir) : resolveNovDataDir();
  const safeRealDataDir = resolveSafeRealDir(dataDir);

  const rawWorkspace = path.resolve(options.workspaceRoot ?? process.cwd());
  const safeRealWorkspace = resolveSafeRealDir(rawWorkspace);
  const workspaceAccessible = safeRealWorkspace !== null;
  const workspaceName = extractSafeWorkspaceName(safeRealWorkspace ?? rawWorkspace);

  const cfg = loadSafeConfigReadOnly(dataDir);
  const enabledModulesCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const exposedModelTools = countEnabledModelTools(cfg.modules);

  const severityOrder: Record<'high' | 'medium' | 'low', number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  let opsSummary: HealthSweepReport['ops'];
  let opsRecommendationTexts: string[] = [];

  if (safeRealWorkspace) {
    const audit = auditWorkspaceReadOnly(safeRealWorkspace, safeRealDataDir ?? undefined, {
      enabledNovTools: exposedModelTools,
    });
    const highSecurityFindingsCount = audit.securityFindings.filter(
      (f) => f.severity === 'high',
    ).length;
    const topFindings: HealthSweepFindingSummary[] = [...audit.securityFindings]
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, MAX_TOP_FINDINGS)
      .map((f) => ({
        severity: f.severity,
        category: sanitizeSummaryText(f.category, 40),
        file: sanitizeRelativeFindingPath(f.file),
        title: sanitizeSummaryText(f.title, 120),
      }));

    opsSummary = {
      healthScore: audit.healthScore,
      securityScore: audit.securityScore,
      ruleBloatStatus: audit.ruleBloat.status,
      ruleTotalTokens: audit.ruleBloat.totalRuleTokens,
      toolBudgetStatus: audit.toolBudget.status,
      estimatedTotalTools: audit.toolBudget.estimatedTotalTools,
      toolBudgetLimit: audit.toolBudget.hardLimit,
      highSecurityFindingsCount,
      totalSecurityFindingsCount: audit.securityFindings.length,
      topFindings,
    };

    opsRecommendationTexts = audit.recommendations
      .filter((r) => r.level === 'critical' || r.level === 'warn')
      .map((r) => `${r.title}: ${r.detail}`);
  } else {
    opsSummary = {
      healthScore: 0,
      securityScore: 100,
      ruleBloatStatus: 'ok',
      ruleTotalTokens: 0,
      toolBudgetStatus: exposedModelTools >= 95 ? 'critical' : exposedModelTools >= 75 ? 'warn' : 'ok',
      estimatedTotalTools: exposedModelTools,
      toolBudgetLimit: MAX_MCP_TOOL_BUDGET,
      highSecurityFindingsCount: 0,
      totalSecurityFindingsCount: 0,
      topFindings: [],
    };
  }

  const mem: HealthSweepReport['mem'] = cfg.modules.mem
    ? inspectMemoriesReadOnly(dataDir, nowMs)
    : { totalMemories: 0, staleCount: 0, expiredUnpinnedCount: 0 };
  const verify: HealthSweepReport['verify'] = cfg.modules.verify
    ? inspectVerifyReadOnly(dataDir)
    : { verifyLastStatus: 'idle', dirtyFilesCount: 0 };
  const guard: HealthSweepReport['guard'] = cfg.modules.guard
    ? inspectGuardReadOnly(dataDir)
    : { guardBlockedCount: 0 };

  const overallStatus = computeOverallStatus({
    workspaceAccessible,
    ops: opsSummary,
    mem,
    verify,
    guard,
  });

  const recommendations = buildSweepRecommendations({
    workspaceAccessible,
    ops: opsSummary,
    mem,
    verify,
    guard,
    opsRecommendationTexts,
  });

  return {
    schemaVersion: HEALTH_SWEEP_SCHEMA_VERSION,
    version: FEED_SNAPSHOT_VERSION,
    generatedAt,
    readOnly: true,
    workspaceName,
    overallStatus,
    config: {
      preset: cfg.preset,
      enabledModulesCount,
      totalModules: MODULE_IDS.length,
      exposedModelTools,
      remoteEnabled: cfg.modules.remote,
    },
    ops: opsSummary,
    mem,
    verify,
    guard,
    recommendations,
  };
}

function enforceReportSizeCap(report: HealthSweepReport): HealthSweepReport {
  const byteSize = (r: HealthSweepReport): number => Buffer.byteLength(JSON.stringify(r), 'utf8');
  if (byteSize(report) <= MAX_HEALTH_SWEEP_BYTES) {
    return report;
  }

  const trimmed: HealthSweepReport = {
    ...report,
    ops: {
      ...report.ops,
      topFindings: report.ops.topFindings.map((f) => ({
        ...f,
        file: sanitizeSummaryText(f.file, 80),
        title: sanitizeSummaryText(f.title, 80),
      })),
    },
    recommendations: report.recommendations.map((r) => sanitizeSummaryText(r, 100)),
  };

  while (trimmed.recommendations.length > 0 && byteSize(trimmed) > MAX_HEALTH_SWEEP_BYTES) {
    trimmed.recommendations.pop();
  }
  while (trimmed.ops.topFindings.length > 0 && byteSize(trimmed) > MAX_HEALTH_SWEEP_BYTES) {
    trimmed.ops.topFindings.pop();
  }
  return trimmed;
}

/**
 * Atomically writes `health-sweep.json` (mode `0600`, `flag: 'wx'` tmp + atomic rename)
 * ONLY when `dataDir` already exists as a safe non-symlink directory and the serialized
 * JSON stays within the 64 KiB ceiling. Never creates any directory.
 */
export function writeHealthSweepReportIfPermitted(
  dataDir: string,
  report: HealthSweepReport,
): WriteHealthSweepReportResult {
  if (!dataDir || typeof dataDir !== 'string') {
    return { written: false, reason: 'dataDir is empty' };
  }
  if (hasUnsafeSymlinkAncestor(dataDir)) {
    return { written: false, reason: 'dataDir has an unsafe symlink ancestor' };
  }

  let dirStat: fs.Stats;
  try {
    dirStat = fs.lstatSync(dataDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {
        written: false,
        reason: 'dataDir does not exist (refusing to create directories)',
      };
    }
    return { written: false, reason: 'dataDir is not accessible' };
  }

  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    return { written: false, reason: 'dataDir is a symlink or not a directory' };
  }

  let realDataDir: string;
  try {
    realDataDir = canonicalRealpathSync(dataDir);
  } catch {
    return { written: false, reason: 'failed to resolve canonical dataDir' };
  }

  const targetPath = path.join(realDataDir, HEALTH_SWEEP_FILENAME);
  if (path.relative(realDataDir, targetPath) !== HEALTH_SWEEP_FILENAME) {
    return { written: false, reason: 'resolved target path escapes dataDir' };
  }

  try {
    const existing = fs.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      return {
        written: false,
        reason: 'target health-sweep.json is a symlink or non-regular file',
      };
    }
    const realTarget = canonicalRealpathSync(targetPath);
    if (!isPathInsideDir(realDataDir, realTarget)) {
      return { written: false, reason: 'target health-sweep.json escapes dataDir' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return { written: false, reason: 'target health-sweep.json is unreadable' };
    }
  }

  const capped = enforceReportSizeCap(report);
  let serialized = `${JSON.stringify(capped, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HEALTH_SWEEP_BYTES) {
    serialized = `${JSON.stringify(capped)}\n`;
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_HEALTH_SWEEP_BYTES) {
    return { written: false, reason: 'serialized health-sweep report exceeds 64 KiB cap' };
  }

  const tmpPath = path.join(
    realDataDir,
    `.${HEALTH_SWEEP_FILENAME}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`,
  );
  try {
    // O_CREAT | O_EXCL prevents following any pre-planted symlink at tmpPath
    fs.writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // ignore chmod failures on filesystems without POSIX permissions
    }
    // Re-check targetPath right before atomic swap
    try {
      const postCheck = fs.lstatSync(targetPath);
      if (postCheck.isSymbolicLink() || !postCheck.isFile()) {
        fs.unlinkSync(tmpPath);
        return {
          written: false,
          reason: 'target health-sweep.json changed to a symlink or non-regular file',
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        fs.unlinkSync(tmpPath);
        return { written: false, reason: 'target health-sweep.json could not be verified' };
      }
    }
    atomicRenameSync(tmpPath, targetPath);
    return { written: true, path: targetPath, bytes };
  } catch {
    try {
      const tmpStat = fs.lstatSync(tmpPath);
      if (!tmpStat.isSymbolicLink() && tmpStat.isFile()) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup failure
    }
    return { written: false, reason: 'failed to write health-sweep.json atomically' };
  }
}
