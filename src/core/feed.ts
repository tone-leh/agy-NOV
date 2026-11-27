import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  countEnabledModelTools,
  MAX_MCP_TOOL_BUDGET,
  MODULE_IDS,
  normalizeConfig,
  type ModuleId,
  type NovConfig,
  type NovLocale,
  type NovStartupView,
  type PresetId,
} from './config.js';

export const FEED_SNAPSHOT_VERSION = '1.0.0' as const;
export const FEED_SNAPSHOT_FILENAME = 'feed-snapshot.json' as const;
export const MAX_FEED_SNAPSHOT_BYTES = 64 * 1024;
export const MAX_FEED_ALERTS = 6;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

export interface NovFeedPaths {
  configFile: 'config.json';
  feedFile: 'feed-snapshot.json';
  modulesRoot: 'modules';
  moduleFiles: {
    opsPrompts: 'modules/ops/prompts.json';
    guardAudit: 'modules/guard/audit.json';
    radarCapsule: 'modules/radar/status-capsule.json';
    memStore: 'modules/mem/memories.json';
    specState: 'modules/spec/state.json';
    verifyState: 'modules/verify/state.json';
    xrayLive: 'modules/xray/live-state.json';
  };
}

export const STANDARD_FEED_PATHS: NovFeedPaths = {
  configFile: 'config.json',
  feedFile: 'feed-snapshot.json',
  modulesRoot: 'modules',
  moduleFiles: {
    opsPrompts: 'modules/ops/prompts.json',
    guardAudit: 'modules/guard/audit.json',
    radarCapsule: 'modules/radar/status-capsule.json',
    memStore: 'modules/mem/memories.json',
    specState: 'modules/spec/state.json',
    verifyState: 'modules/verify/state.json',
    xrayLive: 'modules/xray/live-state.json',
  },
};

export interface NovFeedGuardLastEvent {
  decision: string;
  toolName: string;
  reason: string;
  timestamp: string;
}

export interface NovFeedGuardSummary {
  enabled: boolean;
  blockedCount: number;
  askCount: number;
  lastEvent?: NovFeedGuardLastEvent;
}

export interface NovFeedSpecSummary {
  enabled: boolean;
  activeSpecId: string | null;
  title: string | null;
  status: string | null;
  writeLockActive: boolean;
  doneTasks: number;
  totalTasks: number;
  readyTasks: number;
}

export interface NovFeedVerifySummary {
  enabled: boolean;
  enforceOnStop: boolean;
  lastStatus?: 'pass' | 'fail' | 'blocked' | 'idle';
  dirtyFilesCount: number;
}

export interface NovFeedMemSummary {
  enabled: boolean;
  totalMemories: number;
  staleCount: number;
}

export interface NovFeedRadarSummary {
  enabled: boolean;
  runningCount: number;
  awaitingCount: number;
  stalledCount: number;
  unreadCount: number;
}

export interface NovFeedXraySummary {
  enabled: boolean;
  activeModel: string | null;
  peakContextTokens: number;
  estimatedCostUsd: number;
}

export interface NovFeedTurboSummary {
  enabled: boolean;
}

export interface NovFeedRemoteSummary {
  enabled: boolean;
  running: boolean;
}

export interface NovFeedSummary {
  guard: NovFeedGuardSummary;
  spec: NovFeedSpecSummary;
  verify: NovFeedVerifySummary;
  mem: NovFeedMemSummary;
  radar: NovFeedRadarSummary;
  xray: NovFeedXraySummary;
  turbo: NovFeedTurboSummary;
  remote: NovFeedRemoteSummary;
}

export interface NovFeedAlert {
  level: 'info' | 'warn' | 'danger';
  moduleId: ModuleId;
  code: string;
  message: string;
}

export interface NovFeedSnapshot {
  schemaVersion: 1;
  version: typeof FEED_SNAPSHOT_VERSION;
  generatedAt: string;
  preset: PresetId | 'custom';
  locale: NovLocale;
  startupView: NovStartupView;
  enabledCount: number;
  totalModules: 13;
  exposedModelTools: number;
  toolBudgetLimit: 100;
  modules: Record<ModuleId, boolean>;
  paths: NovFeedPaths;
  summary: NovFeedSummary;
  alerts: NovFeedAlert[];
}

export interface BuildFeedSnapshotOptions {
  remoteRunning?: boolean;
  now?: Date;
  estimatedTotalTools?: number;
}

export function getFeedSnapshotPath(rootDataDir: string): string {
  return path.join(rootDataDir, FEED_SNAPSHOT_FILENAME);
}

// ---------------------------------------------------------------------------
// Strict O(n) linear-time redaction helpers (zero ReDoS risk)
// ---------------------------------------------------------------------------

function isAsciiSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
}

function asciiLower(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

function startsWithAsciiCI(input: string, idx: number, lowerPrefix: string): boolean {
  if (idx + lowerPrefix.length > input.length) return false;
  for (let i = 0; i < lowerPrefix.length; i += 1) {
    if (asciiLower(input.charCodeAt(idx + i)) !== lowerPrefix.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function matchPrivateOpenEnd(input: string, idx: number): number {
  if (!startsWithAsciiCI(input, idx, '<private')) return -1;
  let cur = idx + 8;
  if (cur >= input.length) return -1;
  const ch = input.charCodeAt(cur);
  if (ch === 0x3e) return cur;
  if (!isAsciiSpace(ch)) return -1;
  cur += 1;
  while (cur < input.length) {
    const code = input.charCodeAt(cur);
    if (code === 0x3e) return cur;
    if (code === 0x3c) return -1;
    cur += 1;
  }
  return -1;
}

function matchPrivateCloseEnd(input: string, idx: number): number {
  if (!startsWithAsciiCI(input, idx, '</private')) return -1;
  let cur = idx + 9;
  while (cur < input.length && isAsciiSpace(input.charCodeAt(cur))) {
    cur += 1;
  }
  return cur < input.length && input.charCodeAt(cur) === 0x3e ? cur : -1;
}

function stripPrivateBlocksLinear(input: string): string {
  if (!input.includes('<')) return input;
  const chunks: string[] = [];
  let cur = 0;
  while (cur < input.length) {
    const lt = input.indexOf('<', cur);
    if (lt === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const openEnd = matchPrivateOpenEnd(input, lt);
    if (openEnd === -1) {
      chunks.push(input.slice(cur, lt + 1));
      cur = lt + 1;
      continue;
    }
    if (lt > cur) chunks.push(input.slice(cur, lt));
    let depth = 1;
    let scan = openEnd + 1;
    while (scan < input.length && depth > 0) {
      const nextLt = input.indexOf('<', scan);
      if (nextLt === -1) {
        scan = input.length;
        break;
      }
      const nestedOpen = matchPrivateOpenEnd(input, nextLt);
      if (nestedOpen !== -1) {
        depth += 1;
        scan = nestedOpen + 1;
        continue;
      }
      const closeEnd = matchPrivateCloseEnd(input, nextLt);
      if (closeEnd !== -1) {
        depth -= 1;
        scan = closeEnd + 1;
        continue;
      }
      scan = nextLt + 1;
    }
    chunks.push('[REDACTED_PRIVATE]');
    cur = depth > 0 ? input.length : scan;
  }
  return chunks.join('');
}

function stripPemPrivateKeysLinear(input: string): string {
  const beginMarker = '-----BEGIN ';
  if (!input.includes(beginMarker)) return input;

  const chunks: string[] = [];
  let cur = 0;
  while (cur < input.length) {
    const start = input.indexOf(beginMarker, cur);
    if (start === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const headerEnd = input.indexOf('-----', start + beginMarker.length);
    if (headerEnd === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const label = input.slice(start + beginMarker.length, headerEnd);
    if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(label)) {
      chunks.push(input.slice(cur, headerEnd + 5));
      cur = headerEnd + 5;
      continue;
    }

    if (start > cur) chunks.push(input.slice(cur, start));
    chunks.push('[REDACTED_PRIVATE_KEY]');

    const endPrefix = '-----END ';
    const searchFrom = headerEnd + 5;
    let endIdx = input.indexOf(endPrefix, searchFrom);
    let closedAt = -1;
    while (endIdx !== -1) {
      const footerEnd = input.indexOf('-----', endIdx + endPrefix.length);
      if (footerEnd === -1) break;
      const endLabel = input.slice(endIdx + endPrefix.length, footerEnd);
      if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(endLabel)) {
        closedAt = footerEnd + 5;
        break;
      }
      endIdx = input.indexOf(endPrefix, footerEnd + 5);
    }

    // Truncated PEM private key: redact through end of input to prevent leaking key material
    cur = closedAt === -1 ? input.length : closedAt;
  }
  return chunks.join('');
}

const LINEAR_REDACT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // IM webhook URLs
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  // URL embedded credentials and sensitive query params
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, '$1[REDACTED]$3'],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig|pin|code)=)([^&#\s"'<>]+)/gi, '$1[REDACTED]'],
  // Authorization headers (including custom schemes like Token / ApiKey / Digest / HMAC) & JWTs
  [
    /\b(Authorization[ \t]*:[ \t]*(?:Bearer|Basic|Token|ApiKey|Digest|HMAC)[ \t]+)([^\s"',;}{]+)/gi,
    '$1[REDACTED]',
  ],
  [/\bBearer[ \t]+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic[ \t]+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  // Telegram bot tokens & cloud/provider API keys
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]'],
  [
    /\b(?:sk-proj-|sk-ant-|sk_(?:live|test)_|sk-|AIza|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|npm_|hf_|pypi-)[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_KEY]',
  ],
  // Uppercase environment variable secret assignments (e.g. OPENAI_API_KEY=..., MY_TOKEN=...)
  [
    /\b([A-Z][A-Z0-9_]{1,40}_(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|WEBHOOK|PIN|AUTH|CREDENTIAL|CREDENTIALS)[ \t]*=[ \t]*["']?)([^\s"',;}{]+)(["']?)/g,
    '$1[REDACTED]$3',
  ],
  // Key-value secret/token/pairing-code assignments
  [
    /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bot[_-]?token|pairing[_-]?token|pairing[_-]?pin|pairing[_ -]?code|pair[_-]?code|passcode|signing[_-]?secret|client[_-]?secret|private[_-]?key|csrf[_-]?token|webhook[_-]?url|webhook|secret|token|password|passwd|authorization|pin)["']?[ \t]*[:=][ \t]*["']?)([^\s"',;}{]{4,})(["']?)/gi,
    '$1[REDACTED]$3',
  ],
];

function redactGenericWebhookUrlsLinear(input: string): string {
  // Single-pass O(n) URL matcher: never backtracks across repeated "https://" sequences
  return input.replace(/https?:\/\/[^\s"'<>]+/gi, (match) =>
    match.toLowerCase().includes('webhook') ? '[REDACTED_WEBHOOK]' : match,
  );
}

function truncateUtf16Safe(input: string, maxLen: number): string {
  if (maxLen <= 0 || input.length <= maxLen) return input;
  let end = Math.max(1, maxLen - 1);
  if (end > 0) {
    const code = input.charCodeAt(end - 1);
    // Avoid slicing in the middle of a UTF-16 surrogate pair (high surrogate 0xD800..0xDBFF)
    if (code >= 0xd800 && code <= 0xdbff) {
      end = Math.max(0, end - 1);
    }
  }
  return `${input.slice(0, end).trimEnd()}…`;
}

/**
 * Redacts credentials, API keys, webhooks, PEM/PGP private keys, pairing codes, env values,
 * and `<private>` blocks in strict O(n) linear time without splitting UTF-16 surrogate pairs.
 */
export function redactFeedText(input: string, maxLen = 180): string {
  if (typeof input !== 'string' || !input) return '';
  let out = stripPrivateBlocksLinear(input);
  out = stripPemPrivateKeysLinear(out);
  out = redactGenericWebhookUrlsLinear(out);
  for (const [pattern, replacement] of LINEAR_REDACT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateUtf16Safe(out, maxLen);
}

// ---------------------------------------------------------------------------
// Safe strictly-read-only JSON file reader (zero writes, zero symlink follow)
// ---------------------------------------------------------------------------

function isPlatformSystemRootSymlink(segmentPath: string): boolean {
  return process.platform === 'darwin' && /^\/(?:var|tmp|etc)$/.test(segmentPath);
}

function hasUnsafeSymlinkAncestor(targetPath: string): boolean {
  let cur = path.resolve(targetPath);
  const root = path.parse(cur).root;
  while (true) {
    if (!isPlatformSystemRootSymlink(cur)) {
      try {
        const st = fs.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') return true;
      }
    }
    if (cur === root) return false;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

function isWithinRealBase(childReal: string, baseReal: string): boolean {
  if (childReal === baseReal) return true;
  const prefix = baseReal.endsWith(path.sep) ? baseReal : `${baseReal}${path.sep}`;
  return childReal.startsWith(prefix);
}

function resolveSafeRealDir(dirPath: string): string | null {
  if (hasUnsafeSymlinkAncestor(dirPath)) return null;
  try {
    const st = fs.lstatSync(dirPath);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return fs.realpathSync(dirPath);
  } catch {
    return null;
  }
}

function isSafeNonSymlinkDir(dirPath: string): boolean {
  return resolveSafeRealDir(dirPath) !== null;
}

function readSafeModuleJson(
  rootDataDir: string,
  moduleId: ModuleId,
  fileName: string,
): unknown | null {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) return null;
  const modulesRoot = path.join(realRoot, 'modules');
  const realModules = resolveSafeRealDir(modulesRoot);
  if (!realModules || !isWithinRealBase(realModules, realRoot)) return null;
  const modDir = path.join(realModules, moduleId);
  const realMod = resolveSafeRealDir(modDir);
  if (!realMod || !isWithinRealBase(realMod, realModules)) return null;

  const targetPath = path.join(realMod, fileName);
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_SOURCE_FILE_BYTES) return null;
    const realTarget = fs.realpathSync(targetPath);
    if (!isWithinRealBase(realTarget, realMod)) return null;
    const raw = fs.readFileSync(realTarget, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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

function toNonNegFloat(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 10000) / 10000 : 0;
}

function extractGuardSummary(rootDataDir: string, enabled: boolean): NovFeedGuardSummary {
  if (!enabled) {
    return { enabled: false, blockedCount: 0, askCount: 0 };
  }
  const raw = readSafeModuleJson(rootDataDir, 'guard', 'audit.json');
  const rawObj = asRecord(raw);
  const eventsRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.events)
      ? rawObj.events
      : [];

  let blockedCount = 0;
  let askCount = 0;
  let lastEvent: NovFeedGuardLastEvent | undefined;
  let lastEventTs = -Infinity;

  for (const item of eventsRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const rawDecision = String(rec.decision ?? rec.action ?? rec.outcome ?? '')
      .trim()
      .toLowerCase();
    if (rawDecision === 'deny' || rawDecision === 'denied' || rawDecision === 'block' || rawDecision === 'blocked') {
      blockedCount += 1;
    } else if (rawDecision === 'ask' || rawDecision === 'force_ask') {
      askCount += 1;
    }

    const tsStr = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    const parsedTs = tsStr ? Date.parse(tsStr) : Number.NaN;
    const scoreTs = Number.isFinite(parsedTs) ? parsedTs : -Infinity;
    const candidate: NovFeedGuardLastEvent = {
      decision: redactFeedText(rawDecision || 'unknown', 24),
      toolName: redactFeedText(String(rec.toolName ?? rec.tool_name ?? 'tool'), 64),
      reason: redactFeedText(String(rec.reason ?? rec.summary ?? ''), 140),
      timestamp: redactFeedText(tsStr, 40),
    };

    if (!lastEvent || scoreTs > lastEventTs) {
      lastEvent = candidate;
      lastEventTs = scoreTs;
    }
  }

  return {
    enabled: true,
    blockedCount,
    askCount,
    ...(lastEvent ? { lastEvent } : {}),
  };
}

function extractSpecSummary(rootDataDir: string, enabled: boolean): NovFeedSpecSummary {
  if (!enabled) {
    return {
      enabled: false,
      activeSpecId: null,
      title: null,
      status: null,
      writeLockActive: false,
      doneTasks: 0,
      totalTasks: 0,
      readyTasks: 0,
    };
  }
  const state = asRecord(readSafeModuleJson(rootDataDir, 'spec', 'state.json'));
  const activeId = typeof state?.activeSpecId === 'string' && state.activeSpecId.trim()
    ? state.activeSpecId.trim()
    : null;

  let activeDoc: Record<string, unknown> | null = null;
  if (activeId && Array.isArray(state?.specs)) {
    for (const item of state.specs) {
      const rec = asRecord(item);
      if (rec && rec.id === activeId) {
        activeDoc = rec;
        break;
      }
    }
  } else if (activeId) {
    const specsObj = asRecord(state?.specs);
    if (specsObj) {
      activeDoc = asRecord(specsObj[activeId]);
    }
  }

  if (!activeDoc) {
    return {
      enabled: true,
      activeSpecId: activeId ? redactFeedText(activeId, 64) : null,
      title: null,
      status: null,
      writeLockActive: false,
      doneTasks: 0,
      totalTasks: 0,
      readyTasks: 0,
    };
  }

  const rawTasks = Array.isArray(activeDoc.tasks) ? activeDoc.tasks : [];
  const tasks: Array<{ id: string; status: string; dependsOn: string[]; computedState?: string }> = [];
  const statusById = new Map<string, string>();
  for (const rawTask of rawTasks) {
    const rec = asRecord(rawTask);
    if (!rec || typeof rec.id !== 'string') continue;
    const status = typeof rec.status === 'string' ? rec.status : 'pending';
    const dependsOn = Array.isArray(rec.dependsOn)
      ? rec.dependsOn.filter((d): d is string => typeof d === 'string')
      : [];
    const computedState = typeof rec.computedState === 'string' ? rec.computedState : undefined;
    tasks.push({ id: rec.id, status, dependsOn, computedState });
    statusById.set(rec.id, status);
  }

  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const readyTasks = tasks.filter((t) => {
    if (t.computedState === 'ready') return true;
    if (t.status !== 'pending') return false;
    return t.dependsOn.every((depId) => statusById.get(depId) === 'done');
  }).length;

  const status = typeof activeDoc.status === 'string' ? redactFeedText(activeDoc.status, 32) : null;
  const writeLockActive = Boolean(status === 'draft' && activeDoc.enforcePlanBeforeWrite === true);
  const title = typeof activeDoc.title === 'string' && activeDoc.title.trim()
    ? redactFeedText(activeDoc.title, 100)
    : null;

  return {
    enabled: true,
    activeSpecId: redactFeedText(String(activeDoc.id ?? activeId ?? ''), 64) || null,
    title,
    status,
    writeLockActive,
    doneTasks,
    totalTasks: tasks.length,
    readyTasks,
  };
}

function extractVerifySummary(rootDataDir: string, enabled: boolean): NovFeedVerifySummary {
  if (!enabled) {
    return {
      enabled: false,
      enforceOnStop: false,
      lastStatus: 'idle',
      dirtyFilesCount: 0,
    };
  }
  const state = asRecord(readSafeModuleJson(rootDataDir, 'verify', 'state.json'));
  const policy = asRecord(state?.policy);
  const enforceOnStop = typeof policy?.enforceOnStop === 'boolean' ? policy.enforceOnStop : false;

  const evidenceRaw = Array.isArray(state?.evidence) ? state.evidence : [];
  const latest = evidenceRaw.map((e) => asRecord(e)).find((e): e is Record<string, unknown> => e !== null);

  let lastStatus: 'pass' | 'fail' | 'blocked' | 'idle' = 'idle';
  if (latest) {
    const outcome = typeof latest.outcome === 'string' ? latest.outcome : '';
    if (outcome === 'blocked' || latest.blocked === true) {
      lastStatus = 'blocked';
    } else if (outcome === 'pass' || outcome === 'guardrail-allow' || latest.passed === true) {
      lastStatus = 'pass';
    } else {
      lastStatus = 'fail';
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
    enabled: true,
    enforceOnStop,
    lastStatus,
    dirtyFilesCount: dirtySet.size,
  };
}

export function isMemoryRecordStale(rec: Record<string, unknown>): boolean {
  if (rec.stale === true || rec.drifted === true) return true;
  if (Array.isArray(rec.anchors)) {
    for (const anchor of rec.anchors) {
      const a = asRecord(anchor);
      if (a && (a.driftStatus === 'drifted' || a.driftStatus === 'missing')) {
        return true;
      }
    }
  }
  return false;
}

function extractMemSummary(rootDataDir: string, enabled: boolean): NovFeedMemSummary {
  if (!enabled) {
    return { enabled: false, totalMemories: 0, staleCount: 0 };
  }
  const raw = readSafeModuleJson(rootDataDir, 'mem', 'memories.json');
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
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    totalMemories += 1;
    if (isMemoryRecordStale(rec)) {
      staleCount += 1;
    }
  }

  return {
    enabled: true,
    totalMemories,
    staleCount,
  };
}

function extractRadarSummary(rootDataDir: string, enabled: boolean): NovFeedRadarSummary {
  if (!enabled) {
    return {
      enabled: false,
      runningCount: 0,
      awaitingCount: 0,
      stalledCount: 0,
      unreadCount: 0,
    };
  }
  const capsule = asRecord(readSafeModuleJson(rootDataDir, 'radar', 'status-capsule.json'));
  const counts = asRecord(capsule?.counts);
  if (counts) {
    return {
      enabled: true,
      runningCount: toNonNegInt(counts.running),
      awaitingCount: toNonNegInt(counts.awaiting_approval ?? counts.awaiting),
      stalledCount: toNonNegInt(counts.stalled),
      unreadCount: toNonNegInt(counts.unread),
    };
  }

  const board = asRecord(readSafeModuleJson(rootDataDir, 'radar', 'board.json'));
  const sessionsObj = asRecord(board?.sessions);
  const sessions = sessionsObj ? Object.values(sessionsObj).map(asRecord).filter((s): s is Record<string, unknown> => s !== null) : [];
  return {
    enabled: true,
    runningCount: sessions.filter((s) => s.status === 'running').length,
    awaitingCount: sessions.filter((s) => s.status === 'awaiting_approval').length,
    stalledCount: sessions.filter((s) => s.status === 'stalled').length,
    unreadCount: sessions.filter((s) => s.unread === true).length,
  };
}

function extractXraySummary(rootDataDir: string, enabled: boolean): NovFeedXraySummary {
  if (!enabled) {
    return {
      enabled: false,
      activeModel: null,
      peakContextTokens: 0,
      estimatedCostUsd: 0,
    };
  }
  const live = asRecord(readSafeModuleJson(rootDataDir, 'xray', 'live-state.json'));
  const rawModel =
    typeof live?.activeModel === 'string' && live.activeModel.trim()
      ? live.activeModel.trim()
      : typeof live?.model === 'string' && live.model.trim()
        ? live.model.trim()
        : null;

  return {
    enabled: true,
    activeModel: rawModel ? redactFeedText(rawModel, 80) : null,
    peakContextTokens: toNonNegInt(live?.peakContextTokens),
    estimatedCostUsd: toNonNegFloat(live?.estimatedCostUsd ?? live?.estimatedUsd),
  };
}

function extractRemoteRunningReadOnly(
  rootDataDir: string,
  enabled: boolean,
  overrideRunning?: boolean,
): boolean {
  if (!enabled) return false;
  if (typeof overrideRunning === 'boolean') return overrideRunning;
  const runtime = asRecord(readSafeModuleJson(rootDataDir, 'remote', 'runtime.json'));
  const port = Number(runtime?.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

const ALERT_PRIORITY: Record<NovFeedAlert['level'], number> = {
  danger: 0,
  warn: 1,
  info: 2,
};

function buildFeedAlerts(
  summary: NovFeedSummary,
  exposedModelTools: number,
  estimatedTotalTools?: number,
): NovFeedAlert[] {
  const alerts: NovFeedAlert[] = [];

  if (summary.guard.enabled && summary.guard.blockedCount > 0) {
    const lastReason = summary.guard.lastEvent?.reason
      ? `: ${summary.guard.lastEvent.reason}`
      : '';
    alerts.push({
      level: 'danger',
      moduleId: 'guard',
      code: 'GUARD_BLOCKED',
      message: redactFeedText(
        `Guard blocked ${summary.guard.blockedCount} risky tool call(s)${lastReason}`,
        160,
      ),
    });
  }

  if (summary.verify.enabled && summary.verify.lastStatus === 'blocked') {
    alerts.push({
      level: 'danger',
      moduleId: 'verify',
      code: 'VERIFY_STOP_BLOCKED',
      message: redactFeedText(
        `Verify Gate blocked the latest Stop attempt (${summary.verify.dirtyFilesCount} dirty file(s)).`,
        160,
      ),
    });
  } else if (summary.verify.enabled && summary.verify.lastStatus === 'fail') {
    alerts.push({
      level: 'warn',
      moduleId: 'verify',
      code: 'VERIFY_CHECK_FAILED',
      message: redactFeedText(
        `Latest Verify Gate run failed (${summary.verify.dirtyFilesCount} dirty file(s)).`,
        160,
      ),
    });
  }

  if (summary.spec.enabled && summary.spec.writeLockActive) {
    const specLabel = summary.spec.title ?? summary.spec.activeSpecId ?? 'active spec';
    alerts.push({
      level: 'warn',
      moduleId: 'spec',
      code: 'SPEC_WRITE_LOCK',
      message: redactFeedText(
        `Spec "${specLabel}" is in DRAFT with write lock active; approve before editing files.`,
        160,
      ),
    });
  }

  if (summary.mem.enabled && summary.mem.staleCount > 0) {
    alerts.push({
      level: 'warn',
      moduleId: 'mem',
      code: 'MEM_STALE_DRIFT',
      message: redactFeedText(
        `${summary.mem.staleCount} anchored memory item(s) drifted or stale out of ${summary.mem.totalMemories}.`,
        160,
      ),
    });
  }

  const effectiveTools = Math.max(exposedModelTools, toNonNegInt(estimatedTotalTools));
  if (effectiveTools >= 75) {
    alerts.push({
      level: effectiveTools >= 90 ? 'danger' : 'warn',
      moduleId: 'ops',
      code: 'TOOL_BUDGET_HIGH',
      message: redactFeedText(
        `Active MCP tool footprint (${effectiveTools}/${MAX_MCP_TOOL_BUDGET}) is approaching the 100-tool budget cap.`,
        160,
      ),
    });
  }

  if (summary.radar.enabled && (summary.radar.awaitingCount > 0 || summary.radar.stalledCount > 0)) {
    alerts.push({
      level: 'info',
      moduleId: 'radar',
      code: 'RADAR_ATTENTION',
      message: redactFeedText(
        `Radar attention: ${summary.radar.awaitingCount} awaiting approval, ${summary.radar.stalledCount} stalled.`,
        160,
      ),
    });
  }

  return alerts
    .sort((a, b) => ALERT_PRIORITY[a.level] - ALERT_PRIORITY[b.level])
    .slice(0, MAX_FEED_ALERTS);
}

function cloneStandardPaths(): NovFeedPaths {
  return {
    configFile: STANDARD_FEED_PATHS.configFile,
    feedFile: STANDARD_FEED_PATHS.feedFile,
    modulesRoot: STANDARD_FEED_PATHS.modulesRoot,
    moduleFiles: { ...STANDARD_FEED_PATHS.moduleFiles },
  };
}

function enforceFeedSizeCap(snapshot: NovFeedSnapshot): NovFeedSnapshot {
  const byteSize = (s: NovFeedSnapshot): number => Buffer.byteLength(JSON.stringify(s), 'utf8');
  if (byteSize(snapshot) <= MAX_FEED_SNAPSHOT_BYTES) {
    return snapshot;
  }

  const trimmed: NovFeedSnapshot = {
    ...snapshot,
    paths: cloneStandardPaths(),
    modules: { ...snapshot.modules },
    summary: {
      ...snapshot.summary,
      guard: {
        ...snapshot.summary.guard,
        ...(snapshot.summary.guard.lastEvent
          ? {
              lastEvent: {
                ...snapshot.summary.guard.lastEvent,
                toolName: redactFeedText(snapshot.summary.guard.lastEvent.toolName, 32),
                reason: redactFeedText(snapshot.summary.guard.lastEvent.reason, 64),
              },
            }
          : {}),
      },
      spec: {
        ...snapshot.summary.spec,
        title: snapshot.summary.spec.title ? redactFeedText(snapshot.summary.spec.title, 64) : null,
      },
      xray: {
        ...snapshot.summary.xray,
        activeModel: snapshot.summary.xray.activeModel
          ? redactFeedText(snapshot.summary.xray.activeModel, 48)
          : null,
      },
    },
    alerts: snapshot.alerts.map((a) => ({
      ...a,
      message: redactFeedText(a.message, 80),
    })),
  };

  while (trimmed.alerts.length > 0 && byteSize(trimmed) > MAX_FEED_SNAPSHOT_BYTES) {
    trimmed.alerts.pop();
  }

  if (byteSize(trimmed) > MAX_FEED_SNAPSHOT_BYTES && trimmed.summary.guard.lastEvent) {
    delete trimmed.summary.guard.lastEvent;
  }

  return trimmed;
}

/**
 * Pure 100% read-only builder for agy-NOV's aggregated dual-star feed snapshot.
 * Never creates directories, never writes files, and never follows symlinks.
 */
export function buildFeedSnapshot(
  rootDataDir: string,
  config: NovConfig,
  options: BuildFeedSnapshotOptions = {},
): NovFeedSnapshot {
  const normalized = normalizeConfig(config);
  const enabledCount = MODULE_IDS.filter((id) => normalized.modules[id]).length;
  const exposedModelTools = countEnabledModelTools(normalized.modules);
  const generatedAt = (options.now ?? new Date()).toISOString();

  const summary: NovFeedSummary = {
    guard: extractGuardSummary(rootDataDir, normalized.modules.guard),
    spec: extractSpecSummary(rootDataDir, normalized.modules.spec),
    verify: extractVerifySummary(rootDataDir, normalized.modules.verify),
    mem: extractMemSummary(rootDataDir, normalized.modules.mem),
    radar: extractRadarSummary(rootDataDir, normalized.modules.radar),
    xray: extractXraySummary(rootDataDir, normalized.modules.xray),
    turbo: { enabled: normalized.modules.turbo },
    remote: {
      enabled: normalized.modules.remote,
      running: extractRemoteRunningReadOnly(
        rootDataDir,
        normalized.modules.remote,
        options.remoteRunning,
      ),
    },
  };

  const alerts = buildFeedAlerts(summary, exposedModelTools, options.estimatedTotalTools);

  const snapshot: NovFeedSnapshot = {
    schemaVersion: 1,
    version: FEED_SNAPSHOT_VERSION,
    generatedAt,
    preset: normalized.preset,
    locale: normalized.locale,
    startupView: normalized.startupView ?? 'hub',
    enabledCount,
    totalModules: 13,
    exposedModelTools,
    toolBudgetLimit: 100,
    modules: { ...normalized.modules },
    paths: cloneStandardPaths(),
    summary,
    alerts,
  };

  return enforceFeedSizeCap(snapshot);
}

/**
 * Safe synthetic feed snapshot for `--demo` mode. Strictly zero disk reads and zero disk writes.
 */
export function buildDemoFeedSnapshot(
  config: NovConfig,
  options: BuildFeedSnapshotOptions = {},
): NovFeedSnapshot {
  const normalized = normalizeConfig(config);
  const enabledCount = MODULE_IDS.filter((id) => normalized.modules[id]).length;
  const exposedModelTools = countEnabledModelTools(normalized.modules);
  const generatedAt = (options.now ?? new Date()).toISOString();

  const summary: NovFeedSummary = {
    guard: normalized.modules.guard
      ? {
          enabled: true,
          blockedCount: 2,
          askCount: 1,
          lastEvent: {
            decision: 'deny',
            toolName: 'read_file',
            reason: 'Blocked secret access to .env (demo preview)',
            timestamp: generatedAt,
          },
        }
      : { enabled: false, blockedCount: 0, askCount: 0 },
    spec: normalized.modules.spec
      ? {
          enabled: true,
          activeSpecId: 'spec-demo-v07',
          title: 'Dual-Star Hub & PreInvocation Architecture',
          status: 'approved',
          writeLockActive: false,
          doneTasks: 3,
          totalTasks: 5,
          readyTasks: 1,
        }
      : {
          enabled: false,
          activeSpecId: null,
          title: null,
          status: null,
          writeLockActive: false,
          doneTasks: 0,
          totalTasks: 0,
          readyTasks: 0,
        },
    verify: normalized.modules.verify
      ? {
          enabled: true,
          enforceOnStop: true,
          lastStatus: 'pass',
          dirtyFilesCount: 2,
        }
      : {
          enabled: false,
          enforceOnStop: false,
          lastStatus: 'idle',
          dirtyFilesCount: 0,
        },
    mem: normalized.modules.mem
      ? {
          enabled: true,
          totalMemories: 6,
          staleCount: 1,
        }
      : { enabled: false, totalMemories: 0, staleCount: 0 },
    radar: normalized.modules.radar
      ? {
          enabled: true,
          runningCount: 1,
          awaitingCount: 1,
          stalledCount: 0,
          unreadCount: 1,
        }
      : {
          enabled: false,
          runningCount: 0,
          awaitingCount: 0,
          stalledCount: 0,
          unreadCount: 0,
        },
    xray: normalized.modules.xray
      ? {
          enabled: true,
          activeModel: 'gemini-2.5-pro',
          peakContextTokens: 64200,
          estimatedCostUsd: 0.42,
        }
      : {
          enabled: false,
          activeModel: null,
          peakContextTokens: 0,
          estimatedCostUsd: 0,
        },
    turbo: { enabled: normalized.modules.turbo },
    remote: {
      enabled: normalized.modules.remote,
      running: normalized.modules.remote ? Boolean(options.remoteRunning) : false,
    },
  };

  const alerts = buildFeedAlerts(summary, exposedModelTools, options.estimatedTotalTools);

  return enforceFeedSizeCap({
    schemaVersion: 1,
    version: FEED_SNAPSHOT_VERSION,
    generatedAt,
    preset: normalized.preset,
    locale: normalized.locale,
    startupView: normalized.startupView ?? 'hub',
    enabledCount,
    totalModules: 13,
    exposedModelTools,
    toolBudgetLimit: 100,
    modules: { ...normalized.modules },
    paths: cloneStandardPaths(),
    summary,
    alerts,
  });
}

/**
 * Atomically persists `feed-snapshot.json` (mode 0600, tmp + rename) ONLY when `rootDataDir`
 * already exists as a real non-symlink directory. Strictly zero dir creation and zero writes
 * when `rootDataDir` is missing or unsafe.
 */
export function writeFeedSnapshotIfDataDirExists(
  rootDataDir: string,
  config: NovConfig,
  options: BuildFeedSnapshotOptions = {},
): boolean {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) {
    return false;
  }

  const targetPath = path.join(realRoot, FEED_SNAPSHOT_FILENAME);
  if (path.relative(realRoot, targetPath) !== FEED_SNAPSHOT_FILENAME) {
    return false;
  }
  try {
    const existing = fs.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      return false;
    }
    const realTarget = fs.realpathSync(targetPath);
    if (!isWithinRealBase(realTarget, realRoot)) {
      return false;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return false;
    }
  }

  const snapshot = buildFeedSnapshot(realRoot, config, options);
  let serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FEED_SNAPSHOT_BYTES) {
    serialized = `${JSON.stringify(snapshot)}\n`;
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FEED_SNAPSHOT_BYTES) {
    return false;
  }

  const tmpPath = path.join(
    realRoot,
    `.${FEED_SNAPSHOT_FILENAME}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`,
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
        return false;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        fs.unlinkSync(tmpPath);
        return false;
      }
    }
    fs.renameSync(tmpPath, targetPath);
    return true;
  } catch {
    try {
      const tmpStat = fs.lstatSync(tmpPath);
      if (!tmpStat.isSymbolicLink() && tmpStat.isFile()) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup failure
    }
    return false;
  }
}
