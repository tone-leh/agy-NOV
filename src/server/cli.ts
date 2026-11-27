import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPresetConfig,
  countEnabledModelTools,
  getConfigPath,
  getModuleDataDir,
  isModuleId,
  isNovLocale,
  isPresetId,
  LOCALE_IDS,
  loadNovConfigReadOnly,
  loadTeamPresetReadOnly,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  setNovLocale,
  TEAM_CONFIG_FILENAME,
  TEAM_VERIFY_ALLOWED_EXECUTABLES,
  type ModuleId,
  type PresetId,
  type TeamVerifyCommand,
} from '../core/config.js';
import { getFeedSnapshotPath, MAX_FEED_SNAPSHOT_BYTES } from '../core/feed.js';
import {
  atomicRenameSync,
  canonicalRealpathSync,
  hasCliFlag,
  isPathInsideDir,
  parseCliFlag,
} from '../core/utils.js';
import { executeSafeCompactRun, loadTurboPrefsReadOnly } from '../modules/turbo/auto-rtk.js';

const CLI_VERSION = '1.0.1';
const MAX_READ_JSON_BYTES = 2 * 1024 * 1024; // 2 MiB hard cap for silent read-only JSON loading
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

function printHelp(): void {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) — The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                                                   Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                                          Enable a module (${MODULE_IDS.join(' | ')})
  agy-nov disable <module> [--data-dir=<dir>]                                         Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                                            Apply preset (${PRESET_IDS.join(' | ')})
  agy-nov locale <lang> [--data-dir=<dir>]                                            Set UI language (${LOCALE_IDS.join(' | ')})
  agy-nov statusline [--json] [--compact] [--segments=<list>] [--data-dir=<dir>]      Zero-token read-only status line for Antigravity CLI
  agy-nov recommend [--workspace=<dir>] [--json] [--export-preset [--confirm] [--force]]  Read-only project scanner & .agy-nov.json scaffold
  agy-nov doctor [--data-dir=<dir>]                                                   Verify plugin bundle, manifests & config health (read-only)
  agy-nov compact-run --payload=<b64> [--data-dir=<dir>]                              Auto-RTK whitelisted shell-free compact command runner
`);
}

function readJsonAnySilent(filePath: string): unknown | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_READ_JSON_BYTES) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function readJsonSilent(filePath: string): Record<string, unknown> | null {
  const raw = readJsonAnySilent(filePath);
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickFiniteNonNegNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
      return c;
    }
  }
  return undefined;
}

function pickFinitePositiveNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      return c;
    }
  }
  return undefined;
}

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

function printStatus(dataDir: string): void {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV v${CLI_VERSION} Status`);
  console.log(`  Architecture:   100% Native MCP Apps & Hooks (Zero ASAR / Zero CDP)`);
  console.log(`  Data Dir:       ${dataDir}`);
  console.log(`  Config File:    ${getConfigPath(dataDir)} (${fs.existsSync(getConfigPath(dataDir)) ? 'persisted' : 'defaults'})`);
  console.log(`  Preset:         ${cfg.preset}`);
  console.log(`  UI Locale:      ${cfg.locale}`);
  console.log(`  Modules:        ${enabledCount}/${MODULE_IDS.length} enabled (${modelTools} model tools)`);
  console.log(`  Network:        ${cfg.modules.remote ? 'Remote Hub enabled (opt-in)' : '100% offline'}`);
  console.log('');

  for (const catId of MODULE_CATEGORY_IDS) {
    const cat = MODULE_CATEGORY_META[catId];
    console.log(`  [${cat.label}]`);
    for (const id of MODULE_IDS.filter((m) => MODULE_CATALOG[m].category === catId)) {
      const meta = MODULE_CATALOG[id];
      const flag = cfg.modules[id] ? 'ON ' : 'OFF';
      const tier = meta.isolationTier === 'offline' ? 'offline' : 'opt-in-net';
      console.log(
        `    [${flag}] ${id.padEnd(8)} ${meta.name.padEnd(24)} (${meta.modelToolNames.length} tools · ${tier})`,
      );
    }
  }
}

export type SafeRecommendedPreset = Exclude<PresetId, 'full'>;
export type OfflineModuleId = Exclude<ModuleId, 'remote'>;

export interface TeamPresetDraft {
  schemaVersion: 1;
  preset: SafeRecommendedPreset;
  enableModules: OfflineModuleId[];
  verifyCommands: TeamVerifyCommand[];
}

interface TeamPresetRecommendationSummary {
  found: boolean;
  valid: boolean;
  preset?: PresetId;
  enableModules: ModuleId[];
  verifyCommandCount: number;
  warningCount: number;
  errorCount: number;
}

export interface WorkspaceRecommendation {
  version: string;
  workspaceRoot: string;
  detectedStacks: string[];
  signals: {
    isGitRepo: boolean;
    hasRulesOrMcp: boolean;
    hasDataOrOpenApi: boolean;
    hasMultipleTestsOrScripts: boolean;
  };
  teamPreset: TeamPresetRecommendationSummary;
  recommendedPreset: SafeRecommendedPreset;
  suggestedExtraModules: string[];
  reasons: string[];
  applyCommand: string;
}

export function buildWorkspaceRecommendation(workspaceRoot: string): WorkspaceRecommendation {
  const resolvedRoot = path.resolve(workspaceRoot);
  let realRoot = resolvedRoot;
  try {
    realRoot = canonicalRealpathSync(resolvedRoot);
  } catch {
    // keep resolvedRoot when directory does not exist
  }

  const exists = (rel: string): boolean => {
    try {
      return fs.existsSync(path.join(realRoot, rel));
    } catch {
      return false;
    }
  };

  const detectedStacks: string[] = [];
  let hasMultipleTestsOrScripts = false;
  if (exists('package.json')) {
    detectedStacks.push('Node.js / TypeScript');
    const pkg = readJsonSilent(path.join(realRoot, 'package.json'));
    const scripts =
      pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
        ? Object.keys(pkg.scripts as Record<string, unknown>)
        : [];
    if (scripts.some((s) => /test|typecheck|lint|check|build/i.test(s))) {
      hasMultipleTestsOrScripts = true;
    }
  }
  if (exists('pyproject.toml') || exists('pytest.ini') || exists('requirements.txt')) {
    detectedStacks.push('Python');
    hasMultipleTestsOrScripts = true;
  }
  if (exists('Cargo.toml')) {
    detectedStacks.push('Rust');
    hasMultipleTestsOrScripts = true;
  }
  if (exists('go.mod')) {
    detectedStacks.push('Go');
    hasMultipleTestsOrScripts = true;
  }

  const isGitRepo = exists('.git');
  const hasRulesOrMcp =
    exists('GEMINI.md') ||
    exists('AGENTS.md') ||
    exists('CLAUDE.md') ||
    exists('.mcp.json') ||
    exists('mcp_config.json') ||
    exists('.agents/rules');

  let hasDataOrOpenApi = false;
  try {
    const entries = fs.readdirSync(realRoot, { withFileTypes: true }).slice(0, 120);
    for (const ent of entries) {
      if (ent.isFile() && /\.(?:sqlite|sqlite3|db|csv|openapi\.ya?ml|openapi\.json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
      if (ent.isFile() && /^(?:openapi|swagger)\.(?:ya?ml|json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
    }
  } catch {
    // read-only best effort
  }

  const teamAudit = loadTeamPresetReadOnly(realRoot);
  const teamPresetSummary: TeamPresetRecommendationSummary = {
    found: teamAudit.found,
    valid: teamAudit.valid,
    ...(teamAudit.preset ? { preset: teamAudit.preset } : {}),
    enableModules: [...teamAudit.enableModules],
    verifyCommandCount: teamAudit.verifyCommands.length,
    warningCount: teamAudit.warnings.length,
    errorCount: teamAudit.errors.length,
  };

  const reasons: string[] = [];
  const rawExtraModules: ModuleId[] = [];
  let recommendedPreset: SafeRecommendedPreset = 'core';

  if (isGitRepo && hasMultipleTestsOrScripts) {
    recommendedPreset = 'power';
    reasons.push(
      `Detected Git repository + ${detectedStacks.join(', ')} test/build setup -> "power" preset enables Verify Gate, Worktree Orchestrator, Spec Flow, Turbo RTK & Ops Budget Doctor (100% offline).`,
    );
  } else {
    reasons.push(
      'Lightweight workspace detected -> "core" preset keeps tool footprint minimal (12 tools: Review, Guard & X-Ray, 100% offline).',
    );
  }

  if (hasRulesOrMcp) {
    reasons.push('Found workspace rules or MCP configuration -> Ops Budget Doctor helps prevent 24KB rule bloat & 100-tool limit overflows.');
    if (recommendedPreset === 'core') rawExtraModules.push('ops');
  }
  if (hasDataOrOpenApi) {
    reasons.push('Found local database, CSV, or OpenAPI files -> enable Workspace Studio on demand for offline inspection & loopback API probing.');
    rawExtraModules.push('studio');
  }

  if (teamAudit.found) {
    if (teamAudit.valid && teamAudit.errors.length === 0) {
      if (teamAudit.preset) {
        if (teamAudit.preset === 'full') {
          recommendedPreset = 'local-all';
          reasons.unshift(
            'Found .agy-nov.json preset "full" -> downgraded to offline "local-all" because opt-in network module "remote" must be enabled manually.',
          );
        } else {
          recommendedPreset = teamAudit.preset;
          reasons.unshift(
            `Adopted team preset "${teamAudit.preset}" from .agy-nov.json (read-only).`,
          );
        }
      }
      const safeTeamExtras = teamAudit.enableModules.filter((m) => m !== 'remote');
      if (safeTeamExtras.length > 0) {
        for (const m of safeTeamExtras) {
          rawExtraModules.push(m);
        }
        reasons.push(
          `Team preset (.agy-nov.json) requests additional offline module(s): ${safeTeamExtras.join(', ')}.`,
        );
      }
    } else {
      reasons.unshift(
        `Ignored invalid .agy-nov.json: ${teamAudit.errors.join(' ')}`,
      );
    }

    if (teamAudit.warnings.length > 0) {
      for (const warn of teamAudit.warnings.slice(0, 8)) {
        reasons.push(`[.agy-nov.json warning] ${warn}`);
      }
    }
  }

  const presetModules = PRESET_DEFINITIONS[recommendedPreset].modules;
  const suggestedExtraModules: string[] = [];
  for (const mod of rawExtraModules) {
    if (mod === 'remote') continue;
    if (presetModules[mod]) continue;
    if (!suggestedExtraModules.includes(mod)) {
      suggestedExtraModules.push(mod);
    }
  }

  const applyCommand =
    suggestedExtraModules.length > 0
      ? `agy-nov preset ${recommendedPreset} && ${suggestedExtraModules.map((m) => `agy-nov enable ${m}`).join(' && ')}`
      : `agy-nov preset ${recommendedPreset}`;

  return {
    version: CLI_VERSION,
    workspaceRoot: resolvedRoot,
    detectedStacks,
    signals: {
      isGitRepo,
      hasRulesOrMcp,
      hasDataOrOpenApi,
      hasMultipleTestsOrScripts,
    },
    teamPreset: teamPresetSummary,
    recommendedPreset,
    suggestedExtraModules,
    reasons,
    applyCommand,
  };
}

function isWithinRealDir(targetReal: string, rootReal: string): boolean {
  return isPathInsideDir(rootReal, targetReal);
}

function hasSafeRegularFileInWorkspace(realRoot: string, relPath: string): boolean {
  try {
    const candidate = path.join(realRoot, relPath);
    const st = fs.lstatSync(candidate);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    const realTarget = canonicalRealpathSync(candidate);
    return isWithinRealDir(realTarget, realRoot);
  } catch {
    return false;
  }
}

function detectSafeVerifyCommandsReadOnly(
  realRoot: string,
  isGitRepo: boolean,
): TeamVerifyCommand[] {
  const commands: TeamVerifyCommand[] = [];
  const seenKeys = new Set<string>();

  const pushVerified = (label: string, executable: string, args: string[]): void => {
    const execLower = executable.toLowerCase();
    if (!TEAM_VERIFY_ALLOWED_EXECUTABLES.has(execLower)) return;
    if (commands.length >= 10) return;
    const key = `${execLower}\0${args.join('\0')}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    commands.push({ label, executable: execLower, args: [...args] });
  };

  if (hasSafeRegularFileInWorkspace(realRoot, 'package.json')) {
    const pm = hasSafeRegularFileInWorkspace(realRoot, 'pnpm-lock.yaml')
      ? 'pnpm'
      : hasSafeRegularFileInWorkspace(realRoot, 'yarn.lock')
        ? 'yarn'
        : hasSafeRegularFileInWorkspace(realRoot, 'bun.lock') ||
            hasSafeRegularFileInWorkspace(realRoot, 'bun.lockb')
          ? 'bun'
          : 'npm';

    const pkg = readJsonSilent(path.join(realRoot, 'package.json'));
    const scriptsObj = asPlainRecord(pkg?.scripts);
    const RISKY_SCRIPT_BODY_RE =
      /(?:\b(?:curl|wget)\b[^|\r\n]{0,240}\|\s*(?:sh|bash|zsh)\b|\brm\s+-[a-zA-Z]{0,16}r[a-zA-Z]{0,16}f?\s+\/(?:\s|$|;)|\beval\s+["'`$])/i;
    const hasScript = (name: string): boolean => {
      if (!scriptsObj || typeof scriptsObj[name] !== 'string') return false;
      const body = scriptsObj[name].trim();
      if (!body || body.length > 4096 || RISKY_SCRIPT_BODY_RE.test(body)) return false;
      return true;
    };

    if (hasScript('typecheck')) {
      pushVerified('Typecheck', pm, ['run', 'typecheck']);
    } else if (hasSafeRegularFileInWorkspace(realRoot, 'tsconfig.json')) {
      pushVerified('Typecheck', 'tsc', ['--noEmit']);
    }

    if (hasScript('lint')) {
      pushVerified('Lint', pm, ['run', 'lint']);
    }

    if (hasScript('test')) {
      const testBody = String(scriptsObj?.test ?? '');
      if (!/no test specified/i.test(testBody)) {
        pushVerified('Tests', pm, ['test']);
      }
    }

    if (hasScript('build') && commands.length < 3) {
      pushVerified('Build', pm, ['run', 'build']);
    }
  }

  if (
    hasSafeRegularFileInWorkspace(realRoot, 'pyproject.toml') ||
    hasSafeRegularFileInWorkspace(realRoot, 'pytest.ini') ||
    hasSafeRegularFileInWorkspace(realRoot, 'requirements.txt')
  ) {
    pushVerified('Python Tests', 'pytest', ['-q']);
    if (
      hasSafeRegularFileInWorkspace(realRoot, 'ruff.toml') ||
      hasSafeRegularFileInWorkspace(realRoot, '.ruff.toml')
    ) {
      pushVerified('Ruff Lint', 'ruff', ['check', '.']);
    }
  }

  if (hasSafeRegularFileInWorkspace(realRoot, 'Cargo.toml')) {
    pushVerified('Cargo Check', 'cargo', ['check']);
    pushVerified('Cargo Test', 'cargo', ['test']);
  }

  if (hasSafeRegularFileInWorkspace(realRoot, 'go.mod')) {
    pushVerified('Go Vet', 'go', ['vet', './...']);
    pushVerified('Go Test', 'go', ['test', './...']);
  }

  if (commands.length === 0 && isGitRepo) {
    pushVerified('Git Status', 'git', ['status', '--short']);
  }

  return commands;
}

/**
 * Pure read-only scaffold builder for `.agy-nov.json`.
 * Never writes files, never recommends `full` or `remote`, and emits only
 * whitelisted verifyCommands guaranteed to pass `loadTeamPresetReadOnly`.
 */
export function buildTeamPresetDraft(
  rec: WorkspaceRecommendation,
  workspaceRoot: string,
): TeamPresetDraft {
  const rawPreset = rec.recommendedPreset as PresetId;
  const preset: SafeRecommendedPreset =
    rawPreset === 'full'
      ? 'local-all'
      : isPresetId(rawPreset)
        ? rawPreset
        : 'core';

  const presetModules = PRESET_DEFINITIONS[preset].modules;
  const enableModules: OfflineModuleId[] = [];
  const seen = new Set<string>();
  for (const mod of rec.suggestedExtraModules) {
    if (!isModuleId(mod) || mod === 'remote') continue;
    if (presetModules[mod]) continue;
    if (seen.has(mod)) continue;
    seen.add(mod);
    enableModules.push(mod);
  }

  let verifyCommands: TeamVerifyCommand[] = [];
  try {
    const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
    if (fs.statSync(realRoot).isDirectory()) {
      verifyCommands = detectSafeVerifyCommandsReadOnly(realRoot, rec.signals.isGitRepo);
    }
  } catch {
    verifyCommands = [];
  }

  return {
    schemaVersion: 1,
    preset,
    enableModules,
    verifyCommands,
  };
}

interface WriteTeamPresetResult {
  ok: true;
  path: string;
  existed: boolean;
  audit: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

interface WriteTeamPresetFailure {
  ok: false;
  path: string;
  error: string;
}

function writeTeamPresetDraft(
  workspaceRoot: string,
  draft: TeamPresetDraft,
  force: boolean,
): WriteTeamPresetResult | WriteTeamPresetFailure {
  const resolvedRoot = path.resolve(workspaceRoot);
  const fallbackTarget = path.join(resolvedRoot, TEAM_CONFIG_FILENAME);

  let realRoot: string;
  try {
    realRoot = canonicalRealpathSync(resolvedRoot);
    if (!fs.statSync(realRoot).isDirectory()) {
      return {
        ok: false,
        path: fallbackTarget,
        error: `Workspace path is not a directory: ${resolvedRoot}`,
      };
    }
  } catch {
    return {
      ok: false,
      path: fallbackTarget,
      error: `Workspace directory does not exist: ${resolvedRoot}`,
    };
  }

  if ((draft.preset as string) === 'full') {
    return {
      ok: false,
      path: path.join(realRoot, TEAM_CONFIG_FILENAME),
      error: 'Refused to write .agy-nov.json: preset "full" is disallowed (opt-in remote must be enabled manually).',
    };
  }
  if ((draft.enableModules as string[]).includes('remote')) {
    return {
      ok: false,
      path: path.join(realRoot, TEAM_CONFIG_FILENAME),
      error: 'Refused to write .agy-nov.json: opt-in "remote" module is forbidden in team presets.',
    };
  }

  const targetPath = path.join(realRoot, TEAM_CONFIG_FILENAME);
  let existed = false;

  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: target path is a symbolic link (symlink escape protection).`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: target path exists and is not a regular file.`,
      };
    }
    existed = true;
    if (!force) {
      return {
        ok: false,
        path: targetPath,
        error: `${TEAM_CONFIG_FILENAME} already exists at ${targetPath}. Re-run with --export-preset --confirm --force to overwrite.`,
      };
    }
    const realExisting = canonicalRealpathSync(targetPath);
    if (!isWithinRealDir(realExisting, realRoot)) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: resolved target escapes workspace boundary.`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      return {
        ok: false,
        path: targetPath,
        error: `Unable to inspect ${TEAM_CONFIG_FILENAME}: ${code ?? 'unknown error'}`,
      };
    }
  }

  const serialized = `${JSON.stringify(draft, null, 2)}\n`;
  const tmpPath = path.join(
    realRoot,
    `.${TEAM_CONFIG_FILENAME}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`,
  );

  try {
    fs.writeFileSync(tmpPath, serialized, {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    });

    // Re-check target symlink right before atomic rename
    try {
      const preRenameStat = fs.lstatSync(targetPath);
      if (preRenameStat.isSymbolicLink()) {
        throw new Error(
          `Refused to write ${TEAM_CONFIG_FILENAME}: target path is a symbolic link.`,
        );
      }
      if (!force) {
        throw new Error(
          `${TEAM_CONFIG_FILENAME} already exists at ${targetPath}. Re-run with --export-preset --confirm --force to overwrite.`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }

    atomicRenameSync(tmpPath, targetPath);
    try {
      fs.chmodSync(targetPath, 0o644);
    } catch {
      // ignore chmod failures on filesystems without POSIX modes
    }

    const realWritten = canonicalRealpathSync(targetPath);
    if (!isWithinRealDir(realWritten, realRoot)) {
      return {
        ok: false,
        path: targetPath,
        error: `Written ${TEAM_CONFIG_FILENAME} failed realpath containment verification.`,
      };
    }
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    return {
      ok: false,
      path: targetPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const audit = loadTeamPresetReadOnly(realRoot);
  if (!audit.found || !audit.valid || audit.errors.length > 0) {
    return {
      ok: false,
      path: targetPath,
      error: `Self-check failed for written ${TEAM_CONFIG_FILENAME}: ${audit.errors.join('; ') || 'invalid preset'}`,
    };
  }

  return {
    ok: true,
    path: targetPath,
    existed,
    audit: {
      valid: audit.valid,
      errors: audit.errors,
      warnings: audit.warnings,
    },
  };
}

function resolvePluginRootDir(): string {
  const scriptDir = path.dirname(process.argv[1] || process.cwd());
  const candidates = [
    path.resolve(scriptDir, '..'),
    path.resolve(scriptDir, '../..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'plugin.json'))) {
      return dir;
    }
  }
  return candidates[0];
}

function runDoctor(dataDir: string): number {
  const rootDir = resolvePluginRootDir();
  const requiredFiles = [
    'plugin.json',
    'mcp_config.json',
    'hooks.json',
    'skills/agy-nov/SKILL.md',
    'skills/nov-spec/SKILL.md',
    'skills/nov-debug/SKILL.md',
    'skills/nov-review/SKILL.md',
    'skills/nov-handoff/SKILL.md',
    'agents/nov-blind-reviewer.md',
    'agents/nov-security-auditor.md',
    'assets/logo.svg',
    'dist/server.cjs',
    'dist/hook.cjs',
    'dist/cli.cjs',
    'dist/ui/app.html',
  ];

  let ok = true;
  console.log(`agy-NOV Doctor (v${CLI_VERSION} · Zero ASAR / Zero CDP)`);
  for (const rel of requiredFiles) {
    const abs = path.join(rootDir, rel);
    const exists = fs.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(fs.statSync(abs).size / 1024).toFixed(1)} KB` : 'MISSING';
    console.log(`  ${exists ? 'OK  ' : 'FAIL'} ${rel.padEnd(28)} ${size}`);
  }

  // Validate plugin.json official schema fields
  const pluginPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginPath)) {
    const allowedKeys = new Set([
      'name',
      'displayName',
      'description',
      'version',
      'logo',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'disabled',
    ]);
    const manifest = JSON.parse(fs.readFileSync(pluginPath, 'utf8')) as Record<string, unknown>;
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(', ')}`);
    } else {
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`);
    }
  }

  // Verify UI bundle stays well under Antigravity 10 MiB resource limit
  const uiPath = path.join(rootDir, 'dist/ui/app.html');
  if (fs.existsSync(uiPath)) {
    const bytes = fs.statSync(uiPath).size;
    if (bytes >= 10 * 1024 * 1024) {
      ok = false;
      console.log(`  FAIL dist/ui/app.html exceeds 10 MiB limit (${bytes} bytes)`);
    } else {
      console.log(`  OK   dist/ui/app.html well below 10 MiB cap (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }

  const cfg = loadNovConfigReadOnly(dataDir);
  console.log(
    `  OK   config readable (preset=${cfg.preset}, locale=${cfg.locale}, remote=${cfg.modules.remote ? 'ON' : 'OFF'})`,
  );

  // Read-only Auto-RTK proxy status (default OFF, zero disk writes)
  const turboPrefs = loadTurboPrefsReadOnly(getModuleDataDir(dataDir, 'turbo'));
  const autoRtkActive = cfg.modules.turbo && turboPrefs.autoRtk;
  console.log(
    `  OK   Auto-RTK: ${turboPrefs.autoRtk ? (autoRtkActive ? 'ON (active)' : 'ON (waiting for turbo module)') : 'OFF (default safe passive mode)'}`,
  );

  // Read-only dual-star feed snapshot status check (never writes or creates directories)
  const feedPath = getFeedSnapshotPath(dataDir);
  let feedStatusTag = 'OK  ';
  let feedNote = 'not generated yet (lazy read-only until first write)';
  try {
    const feedStat = fs.lstatSync(feedPath);
    if (feedStat.isSymbolicLink() || !feedStat.isFile()) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = 'unsafe symlink or non-regular file';
    } else if (feedStat.size > MAX_FEED_SNAPSHOT_BYTES) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = `exceeds 64 KB cap (${feedStat.size} bytes)`;
    } else {
      feedNote = `ready (${(feedStat.size / 1024).toFixed(1)} KB)`;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      feedNote = 'unreadable';
    }
  }
  console.log(`  ${feedStatusTag} Feed Snapshot: ${feedPath} (${feedNote})`);

  return ok ? 0 : 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith('-')) ?? 'status';
  const positional = argv.filter((a) => !a.startsWith('-'));
  const dataDir = resolveNovDataDir(parseCliFlag(argv, '--data-dir'));

  if (cmd === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (cmd === 'status') {
    printStatus(dataDir);
    return;
  }

  if (cmd === 'enable' || cmd === 'disable') {
    const target = positional[1];
    if (!isModuleId(target)) {
      console.error(`Unknown module "${target ?? ''}". Valid modules: ${MODULE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setModuleEnabled(dataDir, target, cmd === 'enable');
    console.log(
      `${cmd === 'enable' ? 'Enabled' : 'Disabled'} module "${target}". Preset is now "${next.preset}".`,
    );
    return;
  }

  if (cmd === 'preset') {
    const target = positional[1];
    if (!isPresetId(target)) {
      console.error(`Unknown preset "${target ?? ''}". Valid presets: ${PRESET_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = applyPresetConfig(dataDir, target);
    const def = PRESET_DEFINITIONS[target];
    console.log(`Applied preset "${def.label}" (${next.preset}).`);
    printStatus(dataDir);
    return;
  }

  if (cmd === 'locale') {
    const target = positional[1];
    if (!isNovLocale(target)) {
      console.error(`Unknown locale "${target ?? ''}". Valid locales: ${LOCALE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setNovLocale(dataDir, target);
    console.log(`Updated agy-NOV UI locale to "${next.locale}".`);
    return;
  }

  if (cmd === 'statusline') {
    const asJson = hasCliFlag(argv, '--json');
    const compact = hasCliFlag(argv, '--compact');
    const rawSegmentsFlag = parseCliFlag(argv, '--segments');
    const rawSegments =
      rawSegmentsFlag !== undefined ? rawSegmentsFlag : process.env.AGY_NOV_STATUSLINE_SEGMENTS;
    const segments = parseStatusLineSegments(rawSegments);
    const snap = buildStatusLine(dataDir, compact, { segments });
    console.log(asJson ? JSON.stringify(snap) : snap.line);
    return;
  }

  if (cmd === 'recommend') {
    const ws = parseCliFlag(argv, '--workspace') ?? process.cwd();
    const asJson = hasCliFlag(argv, '--json');
    const exportPreset = hasCliFlag(argv, '--export-preset');
    const confirmWrite = hasCliFlag(argv, '--confirm');
    const forceOverwrite = hasCliFlag(argv, '--force');
    const rec = buildWorkspaceRecommendation(ws);

    if (exportPreset) {
      const draft = buildTeamPresetDraft(rec, ws);
      const targetPath = path.join(rec.workspaceRoot, TEAM_CONFIG_FILENAME);
      let exists = false;
      try {
        fs.lstatSync(targetPath);
        exists = true;
      } catch {
        exists = false;
      }

      if (!confirmWrite) {
        if (asJson) {
          console.log(
            JSON.stringify(
              {
                ...rec,
                exportPreset: {
                  written: false,
                  path: targetPath,
                  exists,
                  draft,
                },
              },
              null,
              2,
            ),
          );
        } else {
          console.log(
            'Preview only (no file written). Re-run with --export-preset --confirm to write .agy-nov.json',
          );
          console.log(`Target: ${targetPath}${exists ? ' (already exists; add --force to overwrite)' : ''}`);
          console.log(JSON.stringify(draft, null, 2));
        }
        return;
      }

      const writeRes = writeTeamPresetDraft(ws, draft, forceOverwrite);
      if (!writeRes.ok) {
        console.error(`[agy-NOV] ${writeRes.error}`);
        process.exit(1);
      }

      if (asJson) {
        console.log(
          JSON.stringify(
            {
              ...rec,
              exportPreset: {
                written: true,
                path: writeRes.path,
                exists: writeRes.existed,
                draft,
                audit: writeRes.audit,
              },
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `Wrote ${TEAM_CONFIG_FILENAME} to ${writeRes.path} (validated via loadTeamPresetReadOnly: valid=${String(writeRes.audit.valid)}, errors=${writeRes.audit.errors.length}).`,
        );
        console.log(JSON.stringify(draft, null, 2));
      }
      return;
    }

    if (asJson) {
      console.log(JSON.stringify(rec, null, 2));
    } else {
      console.log(`agy-NOV v${CLI_VERSION} Workspace Recommendation (Read-Only)`);
      console.log(`  Workspace:   ${rec.workspaceRoot}`);
      console.log(`  Stacks:      ${rec.detectedStacks.length > 0 ? rec.detectedStacks.join(', ') : 'Generic'}`);
      if (rec.teamPreset.found) {
        console.log(
          `  Team Preset: .agy-nov.json (${rec.teamPreset.valid ? 'valid' : 'invalid'}${rec.teamPreset.preset ? ` · preset=${rec.teamPreset.preset}` : ''} · ${rec.teamPreset.verifyCommandCount} verify cmd(s) · ${rec.teamPreset.warningCount} warn(s))`,
        );
      }
      console.log(`  Recommended: preset "${rec.recommendedPreset}"${rec.suggestedExtraModules.length > 0 ? ` + [${rec.suggestedExtraModules.join(', ')}]` : ''}`);
      for (const r of rec.reasons) {
        console.log(`  - ${r}`);
      }
      console.log(`  Apply:       ${rec.applyCommand}`);
    }
    return;
  }

  if (cmd === 'doctor') {
    process.exit(runDoctor(dataDir));
  }

  if (cmd === 'compact-run') {
    const payloadB64 = parseCliFlag(argv, '--payload');
    if (!payloadB64) {
      console.error('[agy-NOV Auto-RTK] Missing required --payload=<base64url> argument.');
      process.exit(2);
    }
    const result = executeSafeCompactRun({
      payloadB64,
      cwd: process.cwd(),
      dataDir,
    });
    if (result.output) {
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
    process.exit(result.exitCode);
  }

  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}

function isCliEntrypoint(): boolean {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const base = path.basename(argv1).toLowerCase();
    if (
      base === 'cli.ts' ||
      base === 'cli.cjs' ||
      base === 'cli.js' ||
      base === 'agy-nov-cli' ||
      base === 'agy-nov'
    ) {
      return true;
    }
    const realBase = path.basename(canonicalRealpathSync(argv1)).toLowerCase();
    return (
      realBase === 'cli.ts' ||
      realBase === 'cli.cjs' ||
      realBase === 'cli.js' ||
      realBase === 'agy-nov-cli'
    );
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main();
}
