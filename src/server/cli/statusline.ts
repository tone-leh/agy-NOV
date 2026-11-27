import path from 'node:path';
import {
  countEnabledModelTools,
  getModuleDataDir,
  loadNovConfigReadOnly,
  MODULE_IDS,
} from '../../core/config.js';
import { getFeedSnapshotPath, redactFeedText } from '../../core/feed.js';
import {
  asPlainRecord,
  CLI_VERSION,
  pickFiniteNonNegNumber,
  pickFinitePositiveNumber,
  readJsonAnySilent,
  readJsonSilent,
} from './helpers.js';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const MAX_HOST_STDIN_BYTES = 256 * 1024;
const DEFAULT_HOST_STDIN_TIMEOUT_MS = 120;

export const STATUSLINE_SEGMENTS = [
  'brand',
  'model',
  'context',
  'burn',
  'quota',
  'cache',
  'spec',
  'verify',
  'guard',
  'radar',
  'network',
] as const;

export type StatusLineSegmentId = (typeof STATUSLINE_SEGMENTS)[number];

const STATUSLINE_SEGMENT_SET: ReadonlySet<string> = new Set(STATUSLINE_SEGMENTS);

export function parseStatusLineSegments(raw: string | undefined): StatusLineSegmentId[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const result: StatusLineSegmentId[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(',')) {
    const normalized = part.trim().toLowerCase();
    if (!normalized || !STATUSLINE_SEGMENT_SET.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized as StatusLineSegmentId);
  }
  return result;
}

export interface StatusLineHostStdinPayload {
  model?: string;
  contextPercent?: number;
  costUsd?: number;
  quotaRemainingPercent?: number;
  runningSubagents?: number;
  workspaceName?: string;
  sessionId?: string;
}

function clampPercent(val: number): number {
  return Math.max(0, Math.min(100, Math.round(val)));
}

function sanitizeShortLabel(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = redactFeedText(raw, maxLen).trim();
  return cleaned || undefined;
}

/**
 * Pure read-only parser for Antigravity 2.35 CLI `statusLine` stdin JSON telemetry.
 * Tolerates partial payloads, nested model/context_window/cost/quota/subagents/workspace shapes,
 * and rejects malformed or oversized text without ever throwing.
 */
export function parseHostStatusLineStdin(rawText: string): StatusLineHostStdinPayload | undefined {
  if (typeof rawText !== 'string') return undefined;
  const trimmed = rawText.trim();
  if (!trimmed || trimmed.length > MAX_HOST_STDIN_BYTES || !trimmed.startsWith('{')) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const obj = asPlainRecord(parsed);
  if (!obj) return undefined;

  // 1. Model name (string or { display_name | id | name })
  let model: string | undefined;
  if (typeof obj.model === 'string') {
    model = sanitizeShortLabel(obj.model, 48);
  } else {
    const modelObj = asPlainRecord(obj.model);
    if (modelObj) {
      model =
        sanitizeShortLabel(modelObj.display_name, 48) ??
        sanitizeShortLabel(modelObj.name, 48) ??
        sanitizeShortLabel(modelObj.id, 48);
    }
  }

  // 2. Context window usage percent
  const ctxObj = asPlainRecord(obj.context_window) ?? asPlainRecord(obj.contextWindow);
  const currentUsage = asPlainRecord(ctxObj?.current_usage) ?? asPlainRecord(ctxObj?.currentUsage);
  const explicitCtxPct = pickFiniteNonNegNumber(
    ctxObj?.used_percentage,
    ctxObj?.usedPercentage,
    obj.context_percent,
    obj.contextPercent,
  );
  let contextPercent: number | undefined;
  if (explicitCtxPct !== undefined) {
    contextPercent = clampPercent(explicitCtxPct);
  } else {
    const usedTokens = pickFinitePositiveNumber(
      currentUsage?.input_tokens,
      currentUsage?.inputTokens,
      ctxObj?.total_input_tokens,
      ctxObj?.totalInputTokens,
      ctxObj?.used_tokens,
      ctxObj?.usedTokens,
    );
    const windowSize =
      pickFinitePositiveNumber(
        ctxObj?.context_window_size,
        ctxObj?.contextWindowSize,
        ctxObj?.max_tokens,
        ctxObj?.maxTokens,
      ) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    if (usedTokens !== undefined) {
      contextPercent = clampPercent((usedTokens / windowSize) * 100);
    }
  }

  // 3. Cost USD
  const costObj = asPlainRecord(obj.cost);
  const rawCost = pickFiniteNonNegNumber(
    costObj?.total_cost_usd,
    costObj?.totalCostUsd,
    costObj?.session_cost_usd,
    costObj?.usd,
    obj.total_cost_usd,
    obj.cost_usd,
  );
  const costUsd = rawCost !== undefined ? Math.round(rawCost * 10000) / 10000 : undefined;

  // 4. Quota remaining percentage
  const quotaObj = asPlainRecord(obj.quota);
  let quotaRemainingPercent: number | undefined;
  const remPct = pickFiniteNonNegNumber(
    quotaObj?.remaining_percentage,
    quotaObj?.remainingPercentage,
    quotaObj?.remaining_percent,
    obj.quota_remaining_percentage,
  );
  if (remPct !== undefined) {
    quotaRemainingPercent = clampPercent(remPct);
  } else {
    const usedQuota = pickFiniteNonNegNumber(
      quotaObj?.used_percentage,
      quotaObj?.usedPercentage,
      obj.quota_used_percentage,
    );
    if (usedQuota !== undefined) {
      quotaRemainingPercent = clampPercent(100 - usedQuota);
    }
  }

  // 5. Subagents active/running count
  let runningSubagents: number | undefined;
  if (Array.isArray(obj.subagents)) {
    const active = obj.subagents.filter((item) => {
      const rec = asPlainRecord(item);
      if (!rec) return false;
      const st = String(rec.status ?? rec.state ?? '').toLowerCase();
      return st === 'running' || st === 'active' || st === 'working' || st === '';
    }).length;
    runningSubagents = active;
  } else {
    const subObj = asPlainRecord(obj.subagents);
    const count = pickFiniteNonNegNumber(
      subObj?.running,
      subObj?.active,
      subObj?.count,
      obj.running_subagents,
      obj.runningSubagents,
    );
    if (count !== undefined) {
      runningSubagents = Math.floor(count);
    }
  }

  // 6. Workspace basename only (cross-platform normalize '\' -> '/', never leak host path or '..')
  const wsObj = asPlainRecord(obj.workspace);
  const rawWsPath =
    (typeof wsObj?.current_dir === 'string' && wsObj.current_dir.trim()) ||
    (typeof wsObj?.project_dir === 'string' && wsObj.project_dir.trim()) ||
    (typeof obj.cwd === 'string' && obj.cwd.trim()) ||
    '';
  let workspaceName: string | undefined;
  if (rawWsPath) {
    const normalizedPosix = rawWsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const candidateBase = path.posix.basename(normalizedPosix);
    if (
      candidateBase &&
      candidateBase !== '.' &&
      candidateBase !== '..' &&
      !/^[A-Za-z]:$/.test(candidateBase)
    ) {
      workspaceName = sanitizeShortLabel(candidateBase, 40);
    }
  }

  // 7. Session / conversation id
  const sessionId =
    sanitizeShortLabel(obj.session_id, 48) ??
    sanitizeShortLabel(obj.sessionId, 48) ??
    sanitizeShortLabel(obj.conversation_id, 48) ??
    sanitizeShortLabel(obj.conversationId, 48);

  const result: StatusLineHostStdinPayload = {
    ...(model ? { model } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(quotaRemainingPercent !== undefined ? { quotaRemainingPercent } : {}),
    ...(runningSubagents !== undefined ? { runningSubagents } : {}),
    ...(workspaceName ? { workspaceName } : {}),
    ...(sessionId ? { sessionId } : {}),
  };

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Bounded non-blocking stdin reader for CLI `statusline` invocations.
 * Returns immediately on TTY; caps piped stdin by byte count and timeout so CLI never stalls.
 */
export function readHostStatusLineStdinAsync(
  timeoutMs = DEFAULT_HOST_STDIN_TIMEOUT_MS,
  maxBytes = MAX_HOST_STDIN_BYTES,
): Promise<StatusLineHostStdinPayload | undefined> {
  if (process.stdin.isTTY) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      try {
        process.stdin.pause();
      } catch {
        // ignore
      }
      const text = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
      resolve(parseHostStatusLineStdin(text));
    };

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      if (totalBytes + buf.length > maxBytes) {
        const remaining = Math.max(0, maxBytes - totalBytes);
        if (remaining > 0) chunks.push(buf.subarray(0, remaining));
        totalBytes = maxBytes;
        finish();
        return;
      }
      chunks.push(buf);
      totalBytes += buf.length;
    };

    const onEnd = () => finish();
    const onError = () => finish();

    const timer = setTimeout(finish, Math.max(20, Math.min(timeoutMs, 1000)));
    timer.unref?.();

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

function normalizeGuardModeForStatusLine(raw: unknown): 'readonly-audit' | 'balanced-dev' | 'strict-gate' {
  if (raw === 'readonly-audit' || raw === 'strict-gate' || raw === 'balanced-dev') {
    return raw;
  }
  return 'balanced-dev';
}

function formatGuardModeAbbr(mode: string): 'RO' | 'BAL' | 'STRICT' {
  if (mode === 'readonly-audit') return 'RO';
  if (mode === 'strict-gate') return 'STRICT';
  return 'BAL';
}

function formatContextUsageBar(percent: number): string {
  const clamped = clampPercent(percent);
  const filled = Math.max(0, Math.min(5, Math.round(clamped / 20)));
  return `Ctx[${'█'.repeat(filled)}${'░'.repeat(5 - filled)}]${clamped}%`;
}

export interface StatusLineSnapshot {
  version: string;
  preset: string;
  enabledCount: number;
  totalModules: number;
  modelTools: number;
  locale: string;
  network: 'offline' | 'opt-in-remote';
  segments?: string[];
  host?: StatusLineHostStdinPayload;
  guard?: {
    enabled: boolean;
    permissionMode: string;
    blockedCount: number;
  };
  telemetry?: {
    contextPercent?: number;
    burn5hUsd?: number;
    cacheHitRate?: number;
    quotaRemainingPercent?: number;
  };
  verify?: {
    enabled: boolean;
    lastStatus: 'pass' | 'fail' | 'blocked' | 'idle';
    blockedStops: number;
  };
  spec?: {
    enabled: boolean;
    activeTitle?: string;
    status?: string;
    writeLockActive: boolean;
    doneTasks: number;
    totalTasks: number;
  };
  radar?: {
    enabled: boolean;
    running: number;
    awaitingApproval: number;
    stalled: number;
    error: number;
    orphanSubagents: number;
    unread: number;
  };
  xray?: {
    enabled: boolean;
    activeConversationId?: string;
    lastToolName?: string;
  };
  line: string;
}

export interface BuildStatusLineOptions {
  segments?: StatusLineSegmentId[];
  hostStdin?: StatusLineHostStdinPayload;
}

export function buildStatusLine(
  dataDir: string,
  compact: boolean,
  opts: BuildStatusLineOptions = {},
): StatusLineSnapshot {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  const network: 'offline' | 'opt-in-remote' = cfg.modules.remote ? 'opt-in-remote' : 'offline';
  const hostStdin = opts.hostStdin;

  // Read-only optional feed-snapshot.json fallback (rejects symlinks & > 2 MiB, zero writes)
  const feedSnapshot = readJsonSilent(getFeedSnapshotPath(dataDir));
  const feedSummary = asPlainRecord(feedSnapshot?.summary);

  let verifySummary: StatusLineSnapshot['verify'];
  if (cfg.modules.verify) {
    const verifyState = readJsonSilent(path.join(getModuleDataDir(dataDir, 'verify'), 'state.json'));
    if (verifyState) {
      const rawEvidence = Array.isArray(verifyState.evidence) ? verifyState.evidence : [];
      const validEvidence = rawEvidence.filter(
        (e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object' && !Array.isArray(e),
      );
      const latest = validEvidence[0];
      let lastStatus: 'pass' | 'fail' | 'blocked' | 'idle' = 'idle';
      if (latest) {
        const outcome = typeof latest.outcome === 'string' ? latest.outcome : '';
        if (outcome === 'blocked' || latest.blocked === true) lastStatus = 'blocked';
        else if (outcome === 'pass' || outcome === 'guardrail-allow' || latest.passed === true) {
          lastStatus = 'pass';
        } else {
          lastStatus = 'fail';
        }
      }
      const storedBlockedStops =
        typeof verifyState.blockedStops === 'number' && Number.isFinite(verifyState.blockedStops)
          ? Math.max(0, Math.floor(verifyState.blockedStops))
          : 0;
      const countedBlocked = validEvidence.filter(
        (e) => e.outcome === 'blocked' || e.blocked === true,
      ).length;
      const blockedStops = Math.max(storedBlockedStops, countedBlocked);
      verifySummary = { enabled: true, lastStatus, blockedStops };
    } else {
      const feedVerify = asPlainRecord(feedSummary?.verify);
      const rawStatus = typeof feedVerify?.lastStatus === 'string' ? feedVerify.lastStatus : 'idle';
      const lastStatus: 'pass' | 'fail' | 'blocked' | 'idle' =
        rawStatus === 'pass' || rawStatus === 'fail' || rawStatus === 'blocked' ? rawStatus : 'idle';
      const blockedStops =
        typeof feedVerify?.blockedStops === 'number' && Number.isFinite(feedVerify.blockedStops)
          ? Math.max(0, Math.floor(feedVerify.blockedStops))
          : 0;
      verifySummary = { enabled: true, lastStatus, blockedStops };
    }
  }

  let specSummary: StatusLineSnapshot['spec'];
  if (cfg.modules.spec) {
    const specState = readJsonSilent(path.join(getModuleDataDir(dataDir, 'spec'), 'state.json'));
    if (specState) {
      const activeId = typeof specState.activeSpecId === 'string' ? specState.activeSpecId : undefined;
      let activeDoc: Record<string, unknown> | undefined;
      if (activeId && Array.isArray(specState.specs)) {
        activeDoc = (specState.specs as Array<unknown>).find(
          (s): s is Record<string, unknown> =>
            Boolean(s) && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).id === activeId,
        );
      } else if (activeId && specState.specs && typeof specState.specs === 'object') {
        const candidate = (specState.specs as Record<string, unknown>)[activeId];
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          activeDoc = candidate as Record<string, unknown>;
        }
      }
      const tasks = Array.isArray(activeDoc?.tasks)
        ? (activeDoc.tasks as Array<unknown>).filter(
            (t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && !Array.isArray(t),
          )
        : [];
      const doneTasks = tasks.filter((t) => t.status === 'done').length;
      const status = typeof activeDoc?.status === 'string' ? activeDoc.status : undefined;
      const writeLockActive = Boolean(
        activeDoc && status === 'draft' && activeDoc.enforcePlanBeforeWrite === true,
      );
      specSummary = {
        enabled: true,
        activeTitle: typeof activeDoc?.title === 'string' ? activeDoc.title : undefined,
        status,
        writeLockActive,
        doneTasks,
        totalTasks: tasks.length,
      };
    } else {
      const feedSpec = asPlainRecord(feedSummary?.spec);
      const status = typeof feedSpec?.status === 'string' && feedSpec.status.trim() ? feedSpec.status.trim() : undefined;
      const doneTasks = Math.max(0, Math.floor(Number(feedSpec?.doneTasks ?? 0) || 0));
      const totalTasks = Math.max(0, Math.floor(Number(feedSpec?.totalTasks ?? 0) || 0));
      specSummary = {
        enabled: true,
        activeTitle: typeof feedSpec?.title === 'string' ? feedSpec.title : undefined,
        status,
        writeLockActive: feedSpec?.writeLockActive === true,
        doneTasks,
        totalTasks,
      };
    }
  }

  let radarSummary: StatusLineSnapshot['radar'];
  if (cfg.modules.radar) {
    const radarDir = getModuleDataDir(dataDir, 'radar');
    const capsule = readJsonSilent(path.join(radarDir, 'status-capsule.json'));
    const counts =
      capsule && capsule.counts && typeof capsule.counts === 'object'
        ? (capsule.counts as Record<string, unknown>)
        : null;
    if (counts) {
      radarSummary = {
        enabled: true,
        running: Number(counts.running ?? 0) || 0,
        awaitingApproval: Number(counts.awaiting_approval ?? 0) || 0,
        stalled: Number(counts.stalled ?? 0) || 0,
        error: Number(counts.error ?? 0) || 0,
        orphanSubagents: Number(counts.orphanSubagents ?? 0) || 0,
        unread: Number(counts.unread ?? 0) || 0,
      };
    } else {
      const board = readJsonSilent(path.join(radarDir, 'board.json'));
      if (board) {
        const sessionsRaw = board.sessions;
        const list =
          sessionsRaw && typeof sessionsRaw === 'object' && !Array.isArray(sessionsRaw)
            ? Object.values(sessionsRaw as Record<string, unknown>).filter(
                (s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object' && !Array.isArray(s),
              )
            : [];
        radarSummary = {
          enabled: true,
          running: list.filter((s) => s.status === 'running').length,
          awaitingApproval: list.filter((s) => s.status === 'awaiting_approval').length,
          stalled: list.filter((s) => s.status === 'stalled').length,
          error: list.filter((s) => s.status === 'error').length,
          orphanSubagents: 0,
          unread: list.filter((s) => s.unread === true).length,
        };
      } else {
        const feedRadar = asPlainRecord(feedSummary?.radar);
        radarSummary = {
          enabled: true,
          running: Number(feedRadar?.runningCount ?? feedRadar?.running ?? 0) || 0,
          awaitingApproval: Number(feedRadar?.awaitingCount ?? feedRadar?.awaitingApproval ?? 0) || 0,
          stalled: Number(feedRadar?.stalledCount ?? feedRadar?.stalled ?? 0) || 0,
          error: Number(feedRadar?.error ?? 0) || 0,
          orphanSubagents: Number(feedRadar?.orphanSubagents ?? 0) || 0,
          unread: Number(feedRadar?.unreadCount ?? feedRadar?.unread ?? 0) || 0,
        };
      }
    }
  }

  let guardSummary: StatusLineSnapshot['guard'];
  if (cfg.modules.guard) {
    const guardDir = getModuleDataDir(dataDir, 'guard');
    const policy = readJsonSilent(path.join(guardDir, 'policy.json'));
    const permissionMode = normalizeGuardModeForStatusLine(policy?.permissionMode);

    const rawAudit = readJsonAnySilent(path.join(guardDir, 'audit.json'));
    const auditObj = asPlainRecord(rawAudit);
    const auditEvents = Array.isArray(rawAudit)
      ? rawAudit
      : Array.isArray(auditObj?.events)
        ? auditObj.events
        : null;

    let blockedCount = 0;
    if (auditEvents) {
      for (const item of auditEvents) {
        const rec = asPlainRecord(item);
        if (!rec) continue;
        const decision = String(rec.decision ?? rec.action ?? rec.outcome ?? '')
          .trim()
          .toLowerCase();
        if (
          decision === 'deny' ||
          decision === 'denied' ||
          decision === 'block' ||
          decision === 'blocked'
        ) {
          blockedCount += 1;
        }
      }
    } else {
      const feedGuard = asPlainRecord(feedSummary?.guard);
      blockedCount = Math.max(0, Math.floor(Number(feedGuard?.blockedCount ?? 0) || 0));
    }

    guardSummary = {
      enabled: true,
      permissionMode,
      blockedCount,
    };
  }

  let xraySummary: StatusLineSnapshot['xray'];
  let telemetrySummary: StatusLineSnapshot['telemetry'];
  let contextPercent: number | undefined;
  let burn5hUsd: number | undefined;
  let cacheHitRate: number | undefined;

  if (cfg.modules.xray) {
    const live = readJsonSilent(path.join(getModuleDataDir(dataDir, 'xray'), 'live-state.json'));
    const feedXray = asPlainRecord(feedSummary?.xray);
    const liveFiveHour = asPlainRecord(live?.fiveHourWindow);
    const feedFiveHour = asPlainRecord(feedXray?.fiveHourWindow);

    xraySummary = {
      enabled: true,
      activeConversationId:
        typeof live?.activeConversationId === 'string' ? live.activeConversationId : undefined,
      lastToolName: typeof live?.lastToolName === 'string' ? live.lastToolName : undefined,
    };

    const explicitCtxPct = pickFiniteNonNegNumber(
      live?.contextPercent,
      live?.contextUsagePercent,
      feedXray?.contextPercent,
      feedXray?.contextUsagePercent,
    );
    const peakTokens = pickFinitePositiveNumber(
      live?.peakContextTokens,
      live?.contextTokens,
      live?.peakTokens,
      feedXray?.peakContextTokens,
      feedXray?.contextTokens,
      feedXray?.peakTokens,
    );
    const contextWindow =
      pickFinitePositiveNumber(
        live?.contextWindowTokens,
        live?.maxContextTokens,
        feedXray?.contextWindowTokens,
        feedXray?.maxContextTokens,
      ) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;

    if (explicitCtxPct !== undefined) {
      contextPercent = clampPercent(explicitCtxPct);
    } else if (peakTokens !== undefined) {
      contextPercent = clampPercent((peakTokens / contextWindow) * 100);
    }

    const rawBurn5h = pickFiniteNonNegNumber(
      live?.burn5hUsd,
      live?.fiveHourUsd,
      live?.fiveHourBurnUsd,
      liveFiveHour?.estimatedUsd,
      live?.estimatedCostUsd,
      live?.estimatedUsd,
      live?.estCostUsd,
      feedXray?.burn5hUsd,
      feedXray?.fiveHourUsd,
      feedXray?.fiveHourBurnUsd,
      feedFiveHour?.estimatedUsd,
      feedXray?.estimatedCostUsd,
      feedXray?.estimatedUsd,
      feedXray?.estCostUsd,
      feedXray?.todayCostUsd,
    );
    burn5hUsd = rawBurn5h !== undefined ? Math.round(rawBurn5h * 10000) / 10000 : undefined;

    let rawCacheHit = pickFiniteNonNegNumber(
      live?.cacheHitRate,
      live?.cacheHitPercent,
      feedXray?.cacheHitRate,
      feedXray?.cacheHitPercent,
    );
    if (rawCacheHit === undefined) {
      const totalInput = pickFinitePositiveNumber(
        live?.totalInputTokens,
        live?.inputTokens,
        feedXray?.totalInputTokens,
        feedXray?.inputTokens,
      );
      const cacheRead = pickFiniteNonNegNumber(
        live?.totalCacheReadTokens,
        live?.cacheReadTokens,
        feedXray?.totalCacheReadTokens,
        feedXray?.cacheReadTokens,
      );
      if (totalInput !== undefined && cacheRead !== undefined) {
        rawCacheHit = Math.min(1, cacheRead / totalInput);
      }
    }
    if (rawCacheHit !== undefined) {
      const normalized = rawCacheHit > 1 ? Math.min(1, rawCacheHit / 100) : Math.min(1, rawCacheHit);
      cacheHitRate = Math.round(normalized * 10000) / 10000;
    }
  }

  // Live CLI host stdin JSON overrides stale local context/cost estimates when supplied
  if (hostStdin?.contextPercent !== undefined) {
    contextPercent = hostStdin.contextPercent;
  }
  if (hostStdin?.costUsd !== undefined) {
    burn5hUsd = hostStdin.costUsd;
  }
  const quotaRemainingPercent = hostStdin?.quotaRemainingPercent;

  if (
    contextPercent !== undefined ||
    burn5hUsd !== undefined ||
    cacheHitRate !== undefined ||
    quotaRemainingPercent !== undefined
  ) {
    telemetrySummary = {
      ...(contextPercent !== undefined ? { contextPercent } : {}),
      ...(burn5hUsd !== undefined ? { burn5hUsd } : {}),
      ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
      ...(quotaRemainingPercent !== undefined ? { quotaRemainingPercent } : {}),
    };
  }

  let line: string;
  const customSegments = opts.segments;

  if (customSegments && customSegments.length > 0) {
    const customParts: string[] = [];
    for (const seg of customSegments) {
      if (seg === 'brand') {
        customParts.push(
          compact
            ? `NOV ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`
            : `agy-NOV ${cfg.preset} · ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`,
        );
      } else if (seg === 'model') {
        customParts.push(hostStdin?.model ? `Model:${hostStdin.model}` : 'Model:auto');
      } else if (seg === 'context') {
        customParts.push(
          telemetrySummary?.contextPercent !== undefined
            ? formatContextUsageBar(telemetrySummary.contextPercent)
            : 'Ctx:idle',
        );
      } else if (seg === 'burn') {
        const usd = telemetrySummary?.burn5hUsd ?? 0;
        customParts.push(`5h:$${usd.toFixed(2)}`);
      } else if (seg === 'quota') {
        customParts.push(
          telemetrySummary?.quotaRemainingPercent !== undefined
            ? `Quota:${telemetrySummary.quotaRemainingPercent}%`
            : 'Quota:n/a',
        );
      } else if (seg === 'cache') {
        customParts.push(
          telemetrySummary?.cacheHitRate !== undefined
            ? `Cache:${Math.round(telemetrySummary.cacheHitRate * 100)}%`
            : 'Cache:n/a',
        );
      } else if (seg === 'spec') {
        if (specSummary && specSummary.status) {
          const lockTag = specSummary.writeLockActive ? 'LOCK' : specSummary.status.toUpperCase();
          customParts.push(`Spec:${lockTag}(${specSummary.doneTasks}/${specSummary.totalTasks})`);
        } else {
          customParts.push('Spec:IDLE');
        }
      } else if (seg === 'verify') {
        const tag = !verifySummary
          ? 'IDLE'
          : verifySummary.lastStatus === 'pass'
            ? 'PASS'
            : verifySummary.lastStatus === 'blocked'
              ? 'BLOCKED'
              : verifySummary.lastStatus === 'fail'
                ? 'FAIL'
                : 'IDLE';
        customParts.push(`Verify:${tag}`);
      } else if (seg === 'guard') {
        if (guardSummary?.enabled) {
          const abbr = formatGuardModeAbbr(guardSummary.permissionMode);
          customParts.push(`Guard:${abbr}(${guardSummary.blockedCount}blk)`);
        } else {
          customParts.push('Guard:OFF');
        }
      } else if (seg === 'radar') {
        if (radarSummary) {
          const radarBits: string[] = [];
          const running = Math.max(radarSummary.running, hostStdin?.runningSubagents ?? 0);
          if (running > 0) radarBits.push(`${running}run`);
          if (radarSummary.awaitingApproval > 0) radarBits.push(`${radarSummary.awaitingApproval}wait`);
          if (radarSummary.stalled > 0) radarBits.push(`${radarSummary.stalled}stall`);
          if (radarSummary.orphanSubagents > 0) radarBits.push(`${radarSummary.orphanSubagents}orphan`);
          if (radarSummary.error > 0) radarBits.push(`${radarSummary.error}err`);
          if (radarSummary.unread > 0) radarBits.push(`${radarSummary.unread}unread`);
          customParts.push(radarBits.length > 0 ? `Radar:${radarBits.join('/')}` : 'Radar:idle');
        } else if (hostStdin?.runningSubagents && hostStdin.runningSubagents > 0) {
          customParts.push(`Radar:${hostStdin.runningSubagents}run`);
        } else {
          customParts.push('Radar:idle');
        }
      } else if (seg === 'network') {
        customParts.push(network === 'offline' ? 'offline' : 'remote:ON');
      }
    }
    line = customParts.join(' · ');
  } else {
    // Preserve exact default format when hostStdin is absent for 100% backwards compatibility
    const parts: string[] = compact
      ? [`NOV ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`]
      : [
          `agy-NOV ${cfg.preset}`,
          `${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`,
          network === 'offline' ? 'offline' : 'remote:ON',
        ];

    if (hostStdin) {
      if (!compact && hostStdin.model) {
        parts.push(hostStdin.model);
      }
      if (hostStdin.contextPercent !== undefined) {
        parts.push(
          compact ? `Ctx:${hostStdin.contextPercent}%` : formatContextUsageBar(hostStdin.contextPercent),
        );
      }
      if (!compact && hostStdin.costUsd !== undefined) {
        parts.push(`$${hostStdin.costUsd.toFixed(2)}`);
      }
      if (!compact && hostStdin.quotaRemainingPercent !== undefined) {
        parts.push(`Quota:${hostStdin.quotaRemainingPercent}%`);
      }
      if (hostStdin.runningSubagents && hostStdin.runningSubagents > 0 && !radarSummary) {
        parts.push(`Sub:${hostStdin.runningSubagents}`);
      }
    }

    if (verifySummary) {
      const tag =
        verifySummary.lastStatus === 'pass'
          ? 'PASS'
          : verifySummary.lastStatus === 'blocked'
            ? 'BLOCKED'
            : verifySummary.lastStatus === 'fail'
              ? 'FAIL'
              : 'IDLE';
      parts.push(`Verify:${tag}`);
    }

    if (specSummary && specSummary.status) {
      const lockTag = specSummary.writeLockActive ? 'LOCK' : specSummary.status.toUpperCase();
      parts.push(`Spec:${lockTag}(${specSummary.doneTasks}/${specSummary.totalTasks})`);
    }

    if (radarSummary) {
      const radarBits: string[] = [];
      const running = Math.max(radarSummary.running, hostStdin?.runningSubagents ?? 0);
      if (running > 0) radarBits.push(`${running}run`);
      if (radarSummary.awaitingApproval > 0) radarBits.push(`${radarSummary.awaitingApproval}wait`);
      if (radarSummary.stalled > 0) radarBits.push(`${radarSummary.stalled}stall`);
      if (radarSummary.orphanSubagents > 0) radarBits.push(`${radarSummary.orphanSubagents}orphan`);
      if (radarSummary.error > 0) radarBits.push(`${radarSummary.error}err`);
      if (radarBits.length > 0) {
        parts.push(`Radar:${radarBits.join('/')}`);
      }
    }

    line = parts.join(' · ');
  }

  return {
    version: CLI_VERSION,
    preset: cfg.preset,
    enabledCount,
    totalModules: MODULE_IDS.length,
    modelTools,
    locale: cfg.locale,
    network,
    ...(customSegments !== undefined ? { segments: customSegments } : {}),
    ...(hostStdin ? { host: hostStdin } : {}),
    ...(guardSummary ? { guard: guardSummary } : {}),
    ...(telemetrySummary ? { telemetry: telemetrySummary } : {}),
    verify: verifySummary,
    spec: specSummary,
    radar: radarSummary,
    xray: xraySummary,
    line,
  };
}
