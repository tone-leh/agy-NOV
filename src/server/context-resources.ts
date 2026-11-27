import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NovConfig } from '../core/config.js';
import { isMemoryRecordStale, redactFeedText } from '../core/feed.js';
import {
  canonicalRealpathSync,
  hasUnsafeSymlinkAncestor,
  isPathInsideDir,
} from '../core/fs-safe.js';
import { redactSecretsLinear, truncateUtf16Safe } from '../core/sanitize.js';
import type { NovRuntimeOptions } from '../core/types.js';

export const NOV_CONTEXT_RESOURCE_URIS = {
  review: 'agy-nov://context/review',
  mem: 'agy-nov://context/mem',
  turbo: 'agy-nov://context/turbo',
  xray: 'agy-nov://context/xray',
} as const;

export type NovContextResourceModuleId = keyof typeof NOV_CONTEXT_RESOURCE_URIS;

export const MAX_CONTEXT_RESOURCE_BYTES = 32 * 1024;
export const MAX_CONTEXT_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

const MAX_REVIEW_SESSION_FILES = 8;
const MAX_REVIEW_OPEN_ANNOTATIONS = 15;
const MAX_MEM_ITEMS = 20;
const MAX_TURBO_HOTSPOTS = 10;
const MAX_XRAY_RECENT_EVENTS = 12;

interface DisabledContextPayload {
  moduleId: NovContextResourceModuleId;
  enabled: false;
  note: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toNonNegInt(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function toNonNegFloat(value: unknown, decimals = 4): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function sanitizeInline(value: unknown, maxLen = 180): string {
  if (typeof value !== 'string' || !value) return '';
  return redactFeedText(value, maxLen);
}

function sanitizeExcerpt(value: unknown, maxLen = 220): string {
  if (typeof value !== 'string' || !value) return '';
  const redacted = redactSecretsLinear(value, {
    stripPrivate: true,
    privateReplacement: '[REDACTED_PRIVATE]',
  });
  const collapsed = redacted
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateUtf16Safe(collapsed, maxLen, '…');
}

function resolveSafeDirNoFollow(dirPath: string): string | null {
  if (!dirPath || typeof dirPath !== 'string' || dirPath.includes('\0')) return null;
  if (hasUnsafeSymlinkAncestor(dirPath)) return null;
  try {
    const st = fs.lstatSync(dirPath);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return canonicalRealpathSync(dirPath);
  } catch {
    return null;
  }
}

function resolveSafeModuleDir(
  rootDataDir: string,
  moduleId: NovContextResourceModuleId,
): string | null {
  const realRoot = resolveSafeDirNoFollow(rootDataDir);
  if (!realRoot) return null;

  const modulesDir = path.join(realRoot, 'modules');
  const realModules = resolveSafeDirNoFollow(modulesDir);
  if (!realModules || !isPathInsideDir(realRoot, realModules)) return null;

  const modDir = path.join(realModules, moduleId);
  const realMod = resolveSafeDirNoFollow(modDir);
  if (!realMod || !isPathInsideDir(realModules, realMod)) return null;

  return realMod;
}

function readSafeJsonInDir(
  realBaseDir: string,
  fileName: string,
  maxBytes = MAX_CONTEXT_SOURCE_FILE_BYTES,
): unknown | null {
  if (!fileName || fileName.includes('\0') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }
  const targetPath = path.join(realBaseDir, fileName);
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) {
      return null;
    }
    const realTarget = canonicalRealpathSync(targetPath);
    if (!isPathInsideDir(realBaseDir, realTarget)) return null;
    return JSON.parse(fs.readFileSync(realTarget, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function readSafeModuleJson(
  rootDataDir: string,
  moduleId: NovContextResourceModuleId,
  fileName: string,
): unknown | null {
  const realMod = resolveSafeModuleDir(rootDataDir, moduleId);
  if (!realMod) return null;
  return readSafeJsonInDir(realMod, fileName);
}

function serializeBoundedContextJson<T extends Record<string, unknown>>(
  moduleId: NovContextResourceModuleId,
  uri: string,
  payload: T,
  shrinkers: Array<() => void>,
): string {
  const byteLen = (str: string): number => Buffer.byteLength(str, 'utf8');

  let text = JSON.stringify(payload, null, 2);
  if (byteLen(text) <= MAX_CONTEXT_RESOURCE_BYTES) {
    return text;
  }

  for (const shrink of shrinkers) {
    shrink();
    text = JSON.stringify(payload, null, 2);
    if (byteLen(text) <= MAX_CONTEXT_RESOURCE_BYTES) {
      return text;
    }
  }

  const compact = JSON.stringify(payload);
  if (byteLen(compact) <= MAX_CONTEXT_RESOURCE_BYTES) {
    return compact;
  }

  return JSON.stringify({
    schemaVersion: 1,
    uri,
    moduleId,
    enabled: true,
    truncated: true,
    note: 'Context summary truncated to stay within the 32 KiB resource budget.',
  });
}

function disabledPayload(moduleId: NovContextResourceModuleId): DisabledContextPayload {
  return {
    moduleId,
    enabled: false,
    note: 'Module is disabled; zero context exposed.',
  };
}

// ---------------------------------------------------------------------------
// 1. agy-nov://context/review
// ---------------------------------------------------------------------------

function buildReviewContextJson(options: NovRuntimeOptions): string {
  const uri = NOV_CONTEXT_RESOURCE_URIS.review;
  if (options.demoMode) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        uri,
        moduleId: 'review',
        enabled: true,
        mode: 'demo',
        signal: {
          lastEvent: 'PostToolUse',
          lastToolName: 'edit_file',
          lastWriteAt: '2026-11-26T06:24:00.000Z',
          updatedAt: '2026-11-26T06:24:00.000Z',
          changeCount: 3,
          conversationId: 'demo-session',
        },
        annotationsSummary: {
          sessionsCount: 1,
          openCount: 2,
          resolvedCount: 1,
          byCategory: { security: 1, bug: 1, refactor: 0, question: 0, nit: 0 },
          recentOpen: [
            {
              id: 'demo-ann-1',
              repoKey: 'demo-repo',
              scope: 'working',
              filePath: 'src/auth/rate-limit.ts',
              startLine: 42,
              endLine: 48,
              category: 'security',
              comment: 'Ensure per-IP fallback bucket enforces strict upper bound on burst tokens.',
              updatedAt: '2026-11-26T06:20:00.000Z',
            },
            {
              id: 'demo-ann-2',
              repoKey: 'demo-repo',
              scope: 'working',
              filePath: 'src/checkout/retry.ts',
              startLine: 18,
              endLine: 25,
              category: 'bug',
              comment: 'Guard against NaN backoff delay when Retry-After header is non-numeric.',
              updatedAt: '2026-11-26T06:22:00.000Z',
            },
          ],
        },
        truncated: false,
      },
      null,
      2,
    );
  }

  const realMod = resolveSafeModuleDir(options.dataDir, 'review');
  const rawSignal = realMod ? asRecord(readSafeJsonInDir(realMod, 'review-signal.json')) : null;
  const signal = rawSignal
    ? {
        lastEvent: sanitizeInline(rawSignal.lastEvent, 48) || null,
        lastToolName: sanitizeInline(rawSignal.lastToolName, 64) || null,
        lastWriteAt: sanitizeInline(rawSignal.lastWriteAt, 40) || null,
        updatedAt: sanitizeInline(rawSignal.updatedAt, 40) || null,
        changeCount: toNonNegInt(rawSignal.changeCount),
        conversationId: sanitizeInline(rawSignal.conversationId, 64) || null,
      }
    : null;

  let sessionsCount = 0;
  let openCount = 0;
  let resolvedCount = 0;
  const byCategory: Record<string, number> = {
    security: 0,
    bug: 0,
    refactor: 0,
    question: 0,
    nit: 0,
  };
  const openAnnotations: Array<{
    id: string;
    repoKey: string;
    scope: string;
    filePath: string;
    startLine: number;
    endLine: number;
    category: string;
    comment: string;
    updatedAt: string;
  }> = [];

  if (realMod) {
    const sessionsDir = path.join(realMod, 'sessions');
    const realSessions = resolveSafeDirNoFollow(sessionsDir);
    if (realSessions && isPathInsideDir(realMod, realSessions)) {
      try {
        const entries = fs.readdirSync(realSessions, { withFileTypes: true });
        const candidates: Array<{ name: string; mtimeMs: number }> = [];
        for (const entry of entries) {
          if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
          try {
            const st = fs.lstatSync(path.join(realSessions, entry.name));
            if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_CONTEXT_SOURCE_FILE_BYTES) continue;
            candidates.push({ name: entry.name, mtimeMs: st.mtimeMs });
          } catch {
            // skip unreadable file
          }
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        sessionsCount = candidates.length;

        for (const cand of candidates.slice(0, MAX_REVIEW_SESSION_FILES)) {
          const parsed = asRecord(readSafeJsonInDir(realSessions, cand.name));
          if (!parsed) continue;
          const repoKey = sanitizeInline(parsed.repoKey ?? cand.name.replace(/\.json$/i, ''), 64);
          const scopesObj = asRecord(parsed.scopes);
          if (!scopesObj) continue;
          for (const [scopeName, scopeVal] of Object.entries(scopesObj)) {
            const scopeRec = asRecord(scopeVal);
            const anns = Array.isArray(scopeRec?.annotations) ? scopeRec.annotations : [];
            for (const rawAnn of anns) {
              const ann = asRecord(rawAnn);
              if (!ann) continue;
              if (ann.resolved === true) {
                resolvedCount += 1;
                continue;
              }
              openCount += 1;
              const cat = sanitizeInline(ann.category ?? 'nit', 24) || 'nit';
              if (cat in byCategory) {
                byCategory[cat] += 1;
              }
              openAnnotations.push({
                id: sanitizeInline(ann.id, 64),
                repoKey,
                scope: sanitizeInline(ann.scope ?? scopeName, 32),
                filePath: sanitizeInline(ann.filePath, 160),
                startLine: toNonNegInt(ann.startLine),
                endLine: toNonNegInt(ann.endLine ?? ann.startLine),
                category: cat,
                comment: sanitizeExcerpt(ann.comment, 160),
                updatedAt: sanitizeInline(ann.updatedAt ?? ann.createdAt, 40),
              });
            }
          }
        }
      } catch {
        // fail-safe read-only
      }
    }
  }

  openAnnotations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let truncated = openAnnotations.length > MAX_REVIEW_OPEN_ANNOTATIONS;
  const recentOpen = openAnnotations.slice(0, MAX_REVIEW_OPEN_ANNOTATIONS);

  const payload = {
    schemaVersion: 1 as const,
    uri,
    moduleId: 'review' as const,
    enabled: true as const,
    mode: 'live' as const,
    signal,
    annotationsSummary: {
      sessionsCount,
      openCount,
      resolvedCount,
      byCategory,
      recentOpen,
    },
    truncated,
  };

  return serializeBoundedContextJson('review', uri, payload, [
    () => {
      payload.annotationsSummary.recentOpen = payload.annotationsSummary.recentOpen.slice(0, 6).map((item) => ({
        ...item,
        comment: truncateUtf16Safe(item.comment, 80, '…'),
      }));
      payload.truncated = true;
    },
    () => {
      payload.annotationsSummary.recentOpen = [];
      payload.truncated = true;
    },
  ]);
}

// ---------------------------------------------------------------------------
// 2. agy-nov://context/mem
// ---------------------------------------------------------------------------

function buildMemContextJson(options: NovRuntimeOptions): string {
  const uri = NOV_CONTEXT_RESOURCE_URIS.mem;
  if (options.demoMode) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        uri,
        moduleId: 'mem',
        enabled: true,
        mode: 'demo',
        summary: {
          totalMemories: 3,
          pinnedCount: 1,
          staleCount: 0,
          byKind: { architecture: 1, decision: 1, convention: 1 },
        },
        memories: [
          {
            id: 'demo-mem-1',
            kind: 'architecture',
            title: 'Zero-ASAR native MCP Apps architecture',
            excerpt: 'All workbench modules run over official MCP stdio, hooks, and config.json hot sync.',
            tags: ['architecture', 'mcp'],
            pinned: true,
            stale: false,
            confidence: 'verified',
            hygieneStatus: 'healthy',
            anchors: [{ basename: 'index.ts', symbol: 'createNovServer', driftStatus: 'fresh' }],
            updatedAt: '2026-11-26T06:00:00.000Z',
            recallCount: 5,
          },
        ],
        truncated: false,
      },
      null,
      2,
    );
  }

  const raw = readSafeModuleJson(options.dataDir, 'mem', 'memories.json');
  const rawObj = asRecord(raw);
  const rawList = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.memories)
      ? rawObj.memories
      : Array.isArray(rawObj?.items)
        ? rawObj.items
        : [];

  let totalMemories = 0;
  let pinnedCount = 0;
  let staleCount = 0;
  const byKind: Record<string, number> = {};

  interface CompactMemoryEntry {
    id: string;
    kind: string;
    title: string;
    excerpt: string;
    tags: string[];
    pinned: boolean;
    stale: boolean;
    confidence: string;
    hygieneStatus: string;
    anchors: Array<{ basename: string; symbol?: string; driftStatus?: string }>;
    updatedAt: string;
    recallCount: number;
  }

  const entries: CompactMemoryEntry[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    if (!rec) continue;
    totalMemories += 1;
    const pinned = rec.pinned === true;
    const stale = isMemoryRecordStale(rec);
    if (pinned) pinnedCount += 1;
    if (stale) staleCount += 1;

    const kind = sanitizeInline(rec.kind ?? 'decision', 32) || 'decision';
    byKind[kind] = (byKind[kind] ?? 0) + 1;

    const tags = Array.isArray(rec.tags)
      ? rec.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => sanitizeInline(t, 40))
          .filter(Boolean)
          .slice(0, 8)
      : [];

    const anchors: Array<{ basename: string; symbol?: string; driftStatus?: string }> = [];
    if (Array.isArray(rec.anchors)) {
      for (const rawAnchor of rec.anchors.slice(0, 4)) {
        const a = asRecord(rawAnchor);
        if (!a) continue;
        const baseCandidate =
          typeof a.basename === 'string' && a.basename.trim()
            ? a.basename
            : typeof a.filePath === 'string' && a.filePath.trim()
              ? path.basename(a.filePath.replace(/\\/g, '/'))
              : '';
        const basename = sanitizeInline(baseCandidate, 80);
        if (!basename) continue;
        const symbol = typeof a.symbol === 'string' && a.symbol.trim() ? sanitizeInline(a.symbol, 64) : undefined;
        const driftStatus =
          typeof a.driftStatus === 'string' && a.driftStatus.trim()
            ? sanitizeInline(a.driftStatus, 24)
            : undefined;
        anchors.push({
          basename,
          ...(symbol ? { symbol } : {}),
          ...(driftStatus ? { driftStatus } : {}),
        });
      }
    }

    entries.push({
      id: sanitizeInline(rec.id, 64),
      kind,
      title: sanitizeExcerpt(rec.title, 120) || 'Untitled Memory',
      excerpt: sanitizeExcerpt(rec.content ?? rec.excerpt ?? '', 220),
      tags,
      pinned,
      stale,
      confidence: sanitizeInline(rec.confidence ?? 'normal', 24) || 'normal',
      hygieneStatus: sanitizeInline(rec.hygieneStatus ?? (stale ? 'drifted' : 'healthy'), 24) || 'healthy',
      anchors,
      updatedAt: sanitizeInline(rec.updatedAt ?? rec.createdAt, 40),
      recallCount: toNonNegInt(rec.recallCount),
    });
  }

  entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    if (b.recallCount !== a.recallCount) return b.recallCount - a.recallCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const payload = {
    schemaVersion: 1 as const,
    uri,
    moduleId: 'mem' as const,
    enabled: true as const,
    mode: 'live' as const,
    summary: {
      totalMemories,
      pinnedCount,
      staleCount,
      byKind,
    },
    memories: entries.slice(0, MAX_MEM_ITEMS),
    truncated: entries.length > MAX_MEM_ITEMS,
  };

  return serializeBoundedContextJson('mem', uri, payload, [
    () => {
      payload.memories = payload.memories.slice(0, 10).map((m) => ({
        ...m,
        excerpt: truncateUtf16Safe(m.excerpt, 100, '…'),
      }));
      payload.truncated = true;
    },
    () => {
      payload.memories = payload.memories.slice(0, 5).map((m) => ({
        ...m,
        excerpt: '',
        anchors: [],
      }));
      payload.truncated = true;
    },
    () => {
      payload.memories = [];
      payload.truncated = true;
    },
  ]);
}

// ---------------------------------------------------------------------------
// 3. agy-nov://context/turbo
// ---------------------------------------------------------------------------

function buildTurboContextJson(options: NovRuntimeOptions): string {
  const uri = NOV_CONTEXT_RESOURCE_URIS.turbo;
  if (options.demoMode) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        uri,
        moduleId: 'turbo',
        enabled: true,
        mode: 'demo',
        prefs: {
          autoRtk: false,
          updatedAt: '2026-11-26T06:00:00.000Z',
        },
        compactionStats: {
          totalCompactions: 6,
          totalSavedTokens: 18420,
          totalRawBytes: 98304,
          avgCompressionPercent: 78,
          estimatedSavedUsd: 0.0461,
          updatedAt: '2026-11-26T06:22:00.000Z',
        },
        hotspotsSummary: {
          count: 2,
          totalObservedRuns: 7,
          estimatedWasteTokens: 15000,
          topHotspots: [
            {
              commandPrefix: 'npm test',
              count: 4,
              lastCommand: 'npm test',
              estimatedWasteTokens: 9600,
              lastSeenAt: '2026-11-26T06:21:00.000Z',
            },
            {
              commandPrefix: 'git diff',
              count: 3,
              lastCommand: 'git diff --stat',
              estimatedWasteTokens: 5400,
              lastSeenAt: '2026-11-26T06:18:00.000Z',
            },
          ],
        },
        truncated: false,
      },
      null,
      2,
    );
  }

  const realMod = resolveSafeModuleDir(options.dataDir, 'turbo');
  const rawPrefs = realMod ? asRecord(readSafeJsonInDir(realMod, 'prefs.json')) : null;
  const rawStats = realMod ? asRecord(readSafeJsonInDir(realMod, 'stats.json')) : null;
  const rawGain = realMod ? asRecord(readSafeJsonInDir(realMod, 'gain.json')) : null;
  const rawHotspots = realMod ? readSafeJsonInDir(realMod, 'hotspots.json') : null;

  const prefs = {
    autoRtk: rawPrefs?.autoRtk === true,
    updatedAt: sanitizeInline(rawPrefs?.updatedAt, 40),
  };

  const statsSource = rawStats ?? rawGain;
  const totalCompactions = toNonNegInt(
    statsSource?.totalCompactions ?? statsSource?.totalOperations ?? rawGain?.totalOperations,
  );
  const totalSavedTokens = toNonNegInt(
    statsSource?.totalSavedTokens ?? rawGain?.totalSavedTokens,
  );
  const totalRawBytes = toNonNegInt(statsSource?.totalRawBytes ?? rawGain?.totalRawBytes);
  const avgCompressionPercent = Math.min(
    100,
    toNonNegInt(rawGain?.avgCompressionPercent ?? statsSource?.avgCompressionPercent),
  );
  const estimatedSavedUsd = toNonNegFloat(
    rawGain?.estimatedSavedUsd ?? (totalSavedTokens > 0 ? (totalSavedTokens / 1_000_000) * 2.5 : 0),
  );
  const statsUpdatedAt = sanitizeInline(statsSource?.updatedAt ?? rawGain?.updatedAt, 40) || null;

  const hotspotsObj = asRecord(rawHotspots);
  const hotspotsList = Array.isArray(rawHotspots)
    ? rawHotspots
    : Array.isArray(hotspotsObj?.items)
      ? hotspotsObj.items
      : [];

  let totalObservedRuns = 0;
  let estimatedWasteTokens = 0;
  const normalizedHotspots: Array<{
    commandPrefix: string;
    count: number;
    lastCommand: string;
    estimatedWasteTokens: number;
    lastSeenAt: string;
  }> = [];

  for (const item of hotspotsList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const commandPrefix = sanitizeInline(rec.commandPrefix, 64);
    const count = toNonNegInt(rec.count);
    if (!commandPrefix || count <= 0) continue;
    const waste = toNonNegInt(rec.estimatedWasteTokens);
    totalObservedRuns += count;
    estimatedWasteTokens += waste;
    normalizedHotspots.push({
      commandPrefix,
      count,
      lastCommand: sanitizeInline(rec.lastCommand ?? commandPrefix, 100),
      estimatedWasteTokens: waste,
      lastSeenAt: sanitizeInline(rec.lastSeenAt, 40),
    });
  }

  normalizedHotspots.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  const payload = {
    schemaVersion: 1 as const,
    uri,
    moduleId: 'turbo' as const,
    enabled: true as const,
    mode: 'live' as const,
    prefs,
    compactionStats: {
      totalCompactions,
      totalSavedTokens,
      totalRawBytes,
      avgCompressionPercent,
      estimatedSavedUsd,
      updatedAt: statsUpdatedAt,
    },
    hotspotsSummary: {
      count: normalizedHotspots.length,
      totalObservedRuns,
      estimatedWasteTokens,
      topHotspots: normalizedHotspots.slice(0, MAX_TURBO_HOTSPOTS),
    },
    truncated: normalizedHotspots.length > MAX_TURBO_HOTSPOTS,
  };

  return serializeBoundedContextJson('turbo', uri, payload, [
    () => {
      payload.hotspotsSummary.topHotspots = payload.hotspotsSummary.topHotspots.slice(0, 5);
      payload.truncated = true;
    },
    () => {
      payload.hotspotsSummary.topHotspots = [];
      payload.truncated = true;
    },
  ]);
}

// ---------------------------------------------------------------------------
// 4. agy-nov://context/xray
// ---------------------------------------------------------------------------

function buildXrayContextJson(options: NovRuntimeOptions): string {
  const uri = NOV_CONTEXT_RESOURCE_URIS.xray;
  if (options.demoMode) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        uri,
        moduleId: 'xray',
        enabled: true,
        mode: 'demo',
        liveState: {
          activeConversationId: 'demo-conv-1',
          activeModel: 'gemini-2.5-pro',
          peakContextTokens: 64200,
          contextWindowTokens: 200000,
          cacheHitRate: 0.78,
          estimatedCostUsd: 0.142,
          lastEvent: 'PostToolUse',
          lastToolName: 'read_file',
          updatedAt: '2026-11-26T06:24:00.000Z',
          hasActiveTranscript: true,
          recentEventsCount: 2,
          recentEvents: [
            {
              event: 'PostToolUse',
              conversationId: 'demo-conv-1',
              toolName: 'read_file',
              stepIdx: 12,
              timestamp: '2026-11-26T06:23:45.000Z',
            },
            {
              event: 'PostToolUse',
              conversationId: 'demo-conv-1',
              toolName: 'edit_file',
              stepIdx: 13,
              timestamp: '2026-11-26T06:24:00.000Z',
            },
          ],
        },
        truncated: false,
      },
      null,
      2,
    );
  }

  const rawLive = asRecord(readSafeModuleJson(options.dataDir, 'xray', 'live-state.json'));
  if (!rawLive) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        uri,
        moduleId: 'xray',
        enabled: true,
        mode: 'live',
        liveState: null,
        truncated: false,
      },
      null,
      2,
    );
  }

  const rawModel =
    typeof rawLive.activeModel === 'string' && rawLive.activeModel.trim()
      ? rawLive.activeModel.trim()
      : typeof rawLive.model === 'string' && rawLive.model.trim()
        ? rawLive.model.trim()
        : '';

  const contextWindowCandidate = Number(rawLive.contextWindowTokens ?? rawLive.maxContextTokens);
  const contextWindowTokens =
    Number.isFinite(contextWindowCandidate) && contextWindowCandidate > 0
      ? Math.floor(contextWindowCandidate)
      : null;

  const cacheHitCandidate = Number(rawLive.cacheHitRate);
  const cacheHitRate =
    Number.isFinite(cacheHitCandidate) && cacheHitCandidate >= 0 && cacheHitCandidate <= 1
      ? Math.round(cacheHitCandidate * 10000) / 10000
      : null;

  const rawEvents = Array.isArray(rawLive.recentEvents) ? rawLive.recentEvents : [];
  const normalizedEvents: Array<{
    event: string;
    conversationId: string;
    toolName?: string;
    stepIdx?: number;
    timestamp: string;
    error?: string;
  }> = [];

  for (const item of rawEvents.slice(-MAX_XRAY_RECENT_EVENTS)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const toolName =
      typeof rec.toolName === 'string' && rec.toolName.trim()
        ? sanitizeInline(rec.toolName, 64)
        : undefined;
    const error =
      typeof rec.error === 'string' && rec.error.trim()
        ? sanitizeExcerpt(rec.error, 140)
        : undefined;
    const stepIdx =
      typeof rec.stepIdx === 'number' && Number.isFinite(rec.stepIdx) && rec.stepIdx >= 0
        ? Math.floor(rec.stepIdx)
        : undefined;
    normalizedEvents.push({
      event: sanitizeInline(rec.event ?? 'unknown', 32) || 'unknown',
      conversationId: sanitizeInline(rec.conversationId ?? 'unknown', 64) || 'unknown',
      ...(toolName ? { toolName } : {}),
      ...(stepIdx !== undefined ? { stepIdx } : {}),
      timestamp: sanitizeInline(rec.timestamp, 40),
      ...(error ? { error } : {}),
    });
  }

  const payload = {
    schemaVersion: 1 as const,
    uri,
    moduleId: 'xray' as const,
    enabled: true as const,
    mode: 'live' as const,
    liveState: {
      activeConversationId: sanitizeInline(rawLive.activeConversationId, 64) || null,
      activeModel: rawModel ? sanitizeInline(rawModel, 80) : null,
      peakContextTokens: toNonNegInt(rawLive.peakContextTokens),
      contextWindowTokens,
      cacheHitRate,
      estimatedCostUsd: toNonNegFloat(rawLive.estimatedCostUsd ?? rawLive.estimatedUsd),
      lastEvent: sanitizeInline(rawLive.lastEvent, 48) || null,
      lastToolName: sanitizeInline(rawLive.lastToolName, 64) || null,
      updatedAt: sanitizeInline(rawLive.updatedAt, 40) || null,
      hasActiveTranscript:
        typeof rawLive.activeTranscriptPath === 'string' && rawLive.activeTranscriptPath.trim().length > 0,
      recentEventsCount: rawEvents.length,
      recentEvents: normalizedEvents,
    },
    truncated: rawEvents.length > MAX_XRAY_RECENT_EVENTS,
  };

  return serializeBoundedContextJson('xray', uri, payload, [
    () => {
      payload.liveState.recentEvents = payload.liveState.recentEvents.slice(-5).map((ev) => ({
        ...ev,
        ...(ev.error ? { error: truncateUtf16Safe(ev.error, 64, '…') } : {}),
      }));
      payload.truncated = true;
    },
    () => {
      payload.liveState.recentEvents = [];
      payload.truncated = true;
    },
  ]);
}

// ---------------------------------------------------------------------------
// Public MCP Resource Registration (+0 Model Tools)
// ---------------------------------------------------------------------------

export function registerNovContextResources(
  server: McpServer,
  options: NovRuntimeOptions,
  getConfig: () => Promise<NovConfig> | NovConfig,
): void {
  const specs: ReadonlyArray<{
    name: string;
    moduleId: NovContextResourceModuleId;
    uri: string;
    title: string;
    description: string;
    build: () => string;
  }> = [
    {
      name: 'agy-nov-context-review',
      moduleId: 'review',
      uri: NOV_CONTEXT_RESOURCE_URIS.review,
      title: 'agy-NOV Review Context Summary',
      description:
        'Read-only on-demand JSON summary of Review edit signals and open annotations (zero prompt injection tax; respects module toggle).',
      build: () => buildReviewContextJson(options),
    },
    {
      name: 'agy-nov-context-mem',
      moduleId: 'mem',
      uri: NOV_CONTEXT_RESOURCE_URIS.mem,
      title: 'agy-NOV Memory Context Index',
      description:
        'Read-only on-demand sanitized JSON index of project memories and code anchors (zero prompt injection tax; strips <private> blocks and secrets).',
      build: () => buildMemContextJson(options),
    },
    {
      name: 'agy-nov-context-turbo',
      moduleId: 'turbo',
      uri: NOV_CONTEXT_RESOURCE_URIS.turbo,
      title: 'agy-NOV Turbo Context Telemetry',
      description:
        'Read-only on-demand JSON summary of Turbo Auto-RTK preferences, compaction savings, and noisy command hotspots (zero prompt injection tax).',
      build: () => buildTurboContextJson(options),
    },
    {
      name: 'agy-nov-context-xray',
      moduleId: 'xray',
      uri: NOV_CONTEXT_RESOURCE_URIS.xray,
      title: 'agy-NOV X-Ray Live Telemetry Context',
      description:
        'Read-only on-demand sanitized JSON summary of X-Ray live context tokens, cost, and recent tool events (zero prompt injection tax).',
      build: () => buildXrayContextJson(options),
    },
  ];

  for (const spec of specs) {
    server.registerResource(
      spec.name,
      spec.uri,
      {
        title: spec.title,
        description: spec.description,
        mimeType: 'application/json',
      },
      async () => {
        const cfg = await getConfig();
        const text = cfg.modules[spec.moduleId]
          ? spec.build()
          : JSON.stringify(disabledPayload(spec.moduleId), null, 2);
        return {
          contents: [
            {
              uri: spec.uri,
              mimeType: 'application/json',
              text,
            },
          ],
        };
      },
    );
  }
}
