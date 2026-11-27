import path from 'node:path';
import {
  countEnabledModelTools,
  getModuleDataDir,
  loadNovConfigReadOnly,
  MODULE_IDS,
} from '../../core/config.js';
import { getFeedSnapshotPath } from '../../core/feed.js';
import {
  asPlainRecord,
  CLI_VERSION,
  pickFiniteNonNegNumber,
  pickFinitePositiveNumber,
  readJsonAnySilent,
  readJsonSilent,
} from './helpers.js';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

export const STATUSLINE_SEGMENTS = [
  'brand',
  'context',
  'burn',
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
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
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
  guard?: {
    enabled: boolean;
    permissionMode: string;
    blockedCount: number;
  };
  telemetry?: {
    contextPercent?: number;
    burn5hUsd?: number;
    cacheHitRate?: number;
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

    let contextPercent: number | undefined;
    if (explicitCtxPct !== undefined) {
      contextPercent = Math.max(0, Math.min(100, Math.round(explicitCtxPct)));
    } else if (peakTokens !== undefined) {
      contextPercent = Math.max(0, Math.min(100, Math.round((peakTokens / contextWindow) * 100)));
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
    const burn5hUsd =
      rawBurn5h !== undefined ? Math.round(rawBurn5h * 10000) / 10000 : undefined;

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
    let cacheHitRate: number | undefined;
    if (rawCacheHit !== undefined) {
      const normalized = rawCacheHit > 1 ? Math.min(1, rawCacheHit / 100) : Math.min(1, rawCacheHit);
      cacheHitRate = Math.round(normalized * 10000) / 10000;
    }

    if (
      contextPercent !== undefined ||
      burn5hUsd !== undefined ||
      cacheHitRate !== undefined
    ) {
      telemetrySummary = {
        ...(contextPercent !== undefined ? { contextPercent } : {}),
        ...(burn5hUsd !== undefined ? { burn5hUsd } : {}),
        ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
      };
    }
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
      } else if (seg === 'context') {
        customParts.push(
          telemetrySummary?.contextPercent !== undefined
            ? formatContextUsageBar(telemetrySummary.contextPercent)
            : 'Ctx:idle',
        );
      } else if (seg === 'burn') {
        const usd = telemetrySummary?.burn5hUsd ?? 0;
        customParts.push(`5h:$${usd.toFixed(2)}`);
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
          if (radarSummary.running > 0) radarBits.push(`${radarSummary.running}run`);
          if (radarSummary.awaitingApproval > 0) radarBits.push(`${radarSummary.awaitingApproval}wait`);
          if (radarSummary.stalled > 0) radarBits.push(`${radarSummary.stalled}stall`);
          if (radarSummary.orphanSubagents > 0) radarBits.push(`${radarSummary.orphanSubagents}orphan`);
          if (radarSummary.error > 0) radarBits.push(`${radarSummary.error}err`);
          if (radarSummary.unread > 0) radarBits.push(`${radarSummary.unread}unread`);
          customParts.push(radarBits.length > 0 ? `Radar:${radarBits.join('/')}` : 'Radar:idle');
        } else {
          customParts.push('Radar:idle');
        }
      } else if (seg === 'network') {
        customParts.push(network === 'offline' ? 'offline' : 'remote:ON');
      }
    }
    line = customParts.join(' · ');
  } else {
    // Preserve exact default format for 100% backwards compatibility
    const parts: string[] = compact
      ? [`NOV ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`]
      : [
          `agy-NOV ${cfg.preset}`,
          `${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`,
          network === 'offline' ? 'offline' : 'remote:ON',
        ];

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
      if (radarSummary.running > 0) radarBits.push(`${radarSummary.running}run`);
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
    ...(guardSummary ? { guard: guardSummary } : {}),
    ...(telemetrySummary ? { telemetry: telemetrySummary } : {}),
    verify: verifySummary,
    spec: specSummary,
    radar: radarSummary,
    xray: xraySummary,
    line,
  };
}
