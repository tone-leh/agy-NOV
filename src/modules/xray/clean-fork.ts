import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import { renderHandoffSnapshot } from './analytics.js';
import { loadSessionDetail, type DiscoveryOptions } from './discovery.js';
import { redactSecrets } from './sanitize.js';

export const CLEAN_FORK_DEFAULT_MAX_BYTES = 12_000;
export const CLEAN_FORK_HARD_MAX_BYTES = 16_000;
export const CLEAN_FORK_MIN_MAX_BYTES = 256;
export const CLEAN_FORK_MAX_READY_TASKS = 5;
export const CLEAN_FORK_MAX_MEM_ANCHORS = 6;
const MAX_READ_JSON_BYTES = 2 * 1024 * 1024; // 2 MiB guard

export interface CleanForkPackOptions {
  rootDataDir: string;
  workspaceRoot: string;
  brainDir?: string;
  demoMode?: boolean;
  conversationId?: string;
  maxBytes?: number;
}

export interface CleanForkPackSections {
  hasHandoff: boolean;
  activeSpecTitle: string | null;
  readyTasksCount: number;
  memAnchorsCount: number;
}

export interface CleanForkPackResult {
  promptMarkdown: string;
  estimatedTokens: number;
  totalBytes: number;
  truncated: boolean;
  sections: CleanForkPackSections;
}

interface ExtractedSpecData {
  activeSpecTitle: string | null;
  status: string | null;
  goal: string | null;
  readyTasks: Array<{ id: string; title: string; description?: string }>;
}

interface ExtractedMemoryAnchor {
  id: string;
  kind: string;
  title: string;
  summary: string;
  pinned: boolean;
  anchors: string[];
  recallCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Strict O(n) linear-time <private> stripping & secret redaction (zero ReDoS)
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

/**
 * Strip ASCII case-insensitive <private>...</private> blocks in strict O(n) linear time.
 * Unclosed <private> tags strip through EOF to prevent partial secret leakage.
 */
export function stripPrivateTagsLinear(input: string): string {
  if (!input || !input.includes('<')) return input;
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
    if (lt > cur) {
      chunks.push(input.slice(cur, lt));
    }

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

const PEM_DASHES = '-'.repeat(5);
const PEM_BEGIN_LOWER = `${PEM_DASHES}begin `;
const PEM_END_LOWER = `${PEM_DASHES}end `;
const PEM_LABEL_RE = /^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i;

function stripPemPrivateBlocksLinear(input: string): string {
  if (!input || !input.includes(PEM_DASHES)) return input;
  const chunks: string[] = [];
  let cur = 0;

  while (cur < input.length) {
    const dashIdx = input.indexOf(PEM_DASHES, cur);
    if (dashIdx === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    if (!startsWithAsciiCI(input, dashIdx, PEM_BEGIN_LOWER)) {
      chunks.push(input.slice(cur, dashIdx + 5));
      cur = dashIdx + 5;
      continue;
    }
    const headerEnd = input.indexOf(PEM_DASHES, dashIdx + PEM_BEGIN_LOWER.length);
    if (headerEnd === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const label = input.slice(dashIdx + PEM_BEGIN_LOWER.length, headerEnd);
    if (!PEM_LABEL_RE.test(label)) {
      chunks.push(input.slice(cur, headerEnd + 5));
      cur = headerEnd + 5;
      continue;
    }

    if (dashIdx > cur) {
      chunks.push(input.slice(cur, dashIdx));
    }
    chunks.push('[REDACTED_PRIVATE_KEY]');

    let scan = headerEnd + 5;
    let closedAt = -1;
    while (scan < input.length) {
      const nextDash = input.indexOf(PEM_DASHES, scan);
      if (nextDash === -1) break;
      if (startsWithAsciiCI(input, nextDash, PEM_END_LOWER)) {
        const footerEnd = input.indexOf(PEM_DASHES, nextDash + PEM_END_LOWER.length);
        if (footerEnd === -1) break;
        const endLabel = input.slice(nextDash + PEM_END_LOWER.length, footerEnd);
        if (PEM_LABEL_RE.test(endLabel)) {
          closedAt = footerEnd + 5;
          break;
        }
        scan = footerEnd + 5;
        continue;
      }
      scan = nextDash + 5;
    }

    cur = closedAt === -1 ? input.length : closedAt;
  }

  return chunks.join('');
}

const EXTRA_LINEAR_REDACT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, '$1[REDACTED]$3'],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig|pin|code)=)([^&#\s"'<>]+)/gi, '$1[REDACTED]'],
  [/\bBearer[ \t]+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic[ \t]+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  [/(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  [
    /(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{16,}|pypi-[A-Za-z0-9_-]{16,})/g,
    '[REDACTED_KEY]',
  ],
];

const LINEAR_KV_RE =
  /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]{1,80})(["']?[ \t]*[:=][ \t]*["']?)(?!\[REDACTED)([^\s"',;}{]{4,})(["']?)/g;
const SENSITIVE_KV_KEY_RE =
  /(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|password|passwd|pwd|authorization|credential)/i;

function redactKeyValueLinear(input: string): string {
  if (!input.includes('=') && !input.includes(':')) return input;
  return input.replace(
    LINEAR_KV_RE,
    (fullMatch, q1: string, key: string, sep: string, _val: string, q2: string) => {
      if (!SENSITIVE_KV_KEY_RE.test(key)) return fullMatch;
      return `${q1}${key}${sep}[REDACTED]${q2}`;
    },
  );
}

export function redactCleanForkText(input: string): string {
  if (!input) return '';
  let out = stripPrivateTagsLinear(input);
  out = stripPemPrivateBlocksLinear(out);
  out = redactSecrets(out);
  for (const [pattern, replacement] of EXTRA_LINEAR_REDACT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = redactKeyValueLinear(out);
  return out;
}

// ---------------------------------------------------------------------------
// UTF-8 byte-safe truncation & token estimator
// ---------------------------------------------------------------------------

export function estimateCleanForkTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    }
  }
  const nonCjk = text.length - cjk;
  return Math.max(1, Math.ceil(nonCjk / 4 + cjk * 0.7));
}

export function truncateUtf8Safe(
  text: string,
  maxBytes: number,
): { text: string; totalBytes: number; truncated: boolean } {
  const initialBytes = Buffer.byteLength(text, 'utf8');
  if (initialBytes <= maxBytes) {
    return { text, totalBytes: initialBytes, truncated: false };
  }

  const notice = `\n\n[Truncated cleanly at ${maxBytes} UTF-8 bytes]`;
  const suffix = Buffer.byteLength(notice, 'utf8') < maxBytes ? notice : '...';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const budget = Math.max(0, maxBytes - suffixBytes);

  let usedBytes = 0;
  let cutIndex = 0;
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (usedBytes + chBytes > budget) break;
    usedBytes += chBytes;
    cutIndex += ch.length;
  }

  const finalText = `${text.slice(0, cutIndex).trimEnd()}${suffix}`;
  const finalBytes = Buffer.byteLength(finalText, 'utf8');
  if (finalBytes <= maxBytes) {
    return { text: finalText, totalBytes: finalBytes, truncated: true };
  }

  // Fallback for very small maxBytes budgets
  let hardUsed = 0;
  let hardCut = 0;
  for (const ch of finalText) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (hardUsed + chBytes > maxBytes) break;
    hardUsed += chBytes;
    hardCut += ch.length;
  }
  const clipped = finalText.slice(0, hardCut);
  return {
    text: clipped,
    totalBytes: Buffer.byteLength(clipped, 'utf8'),
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Strictly read-only JSON readers (zero mkdir, zero writes, symlink-safe)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function collapseLine(input: string, maxChars: number): string {
  const cleaned = redactCleanForkText(input).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  let cut = Math.max(1, maxChars - 1);
  // Avoid splitting a UTF-16 surrogate pair (e.g. emoji) at the boundary
  const lastCode = cleaned.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    cut = Math.max(0, cut - 1);
  }
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}

function readJsonReadOnlySafe(filePath: string): unknown | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size <= 0 || st.size > MAX_READ_JSON_BYTES) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readActiveSpecReadOnly(rootDataDir: string): ExtractedSpecData {
  const empty: ExtractedSpecData = {
    activeSpecTitle: null,
    status: null,
    goal: null,
    readyTasks: [],
  };
  if (!rootDataDir) return empty;

  const statePath = path.join(getModuleDataDir(rootDataDir, 'spec'), 'state.json');
  const parsed = asRecord(readJsonReadOnlySafe(statePath));
  if (!parsed) return empty;

  const activeSpecId =
    typeof parsed.activeSpecId === 'string' && parsed.activeSpecId.trim()
      ? parsed.activeSpecId.trim()
      : null;

  let activeDoc: Record<string, unknown> | null = null;
  if (activeSpecId && Array.isArray(parsed.specs)) {
    for (const item of parsed.specs) {
      const rec = asRecord(item);
      if (rec && rec.id === activeSpecId) {
        activeDoc = rec;
        break;
      }
    }
  } else if (activeSpecId) {
    const specsMap = asRecord(parsed.specs);
    if (specsMap) {
      activeDoc = asRecord(specsMap[activeSpecId]);
    }
  }

  // Fallback: pick first draft/approved spec when activeSpecId is omitted
  if (!activeDoc && Array.isArray(parsed.specs)) {
    for (const item of parsed.specs) {
      const rec = asRecord(item);
      if (rec && (rec.status === 'approved' || rec.status === 'draft')) {
        activeDoc = rec;
        break;
      }
    }
  }

  if (!activeDoc) return empty;

  const title =
    typeof activeDoc.title === 'string' && activeDoc.title.trim()
      ? collapseLine(activeDoc.title, 120)
      : null;
  const status =
    typeof activeDoc.status === 'string' && activeDoc.status.trim()
      ? collapseLine(activeDoc.status, 32)
      : null;
  const goal =
    typeof activeDoc.goal === 'string' && activeDoc.goal.trim()
      ? collapseLine(activeDoc.goal, 220)
      : null;

  const rawTasks = Array.isArray(activeDoc.tasks) ? activeDoc.tasks : [];
  const tasks: Array<{
    id: string;
    title: string;
    description?: string;
    status: string;
    dependsOn: string[];
    computedState?: string;
  }> = [];
  const statusById = new Map<string, string>();

  for (const rawTask of rawTasks) {
    const rec = asRecord(rawTask);
    if (!rec || typeof rec.id !== 'string' || !rec.id.trim()) continue;
    const id = rec.id.trim();
    const taskTitle =
      typeof rec.title === 'string' && rec.title.trim() ? collapseLine(rec.title, 120) : id;
    const taskDesc =
      typeof rec.description === 'string' && rec.description.trim()
        ? collapseLine(rec.description, 160)
        : undefined;
    const taskStatus = typeof rec.status === 'string' ? rec.status.trim() : 'pending';
    const dependsOn = Array.isArray(rec.dependsOn)
      ? rec.dependsOn.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      : [];
    const computedState =
      typeof rec.computedState === 'string' ? rec.computedState.trim() : undefined;

    tasks.push({
      id,
      title: taskTitle,
      description: taskDesc,
      status: taskStatus,
      dependsOn,
      computedState,
    });
    statusById.set(id, taskStatus);
  }

  const readyTasks = tasks
    .filter((t) => {
      if (t.status === 'done' || t.status === 'blocked' || t.status === 'in_progress') {
        return false;
      }
      if (t.computedState === 'ready') return true;
      if (t.status !== 'pending') return false;
      return t.dependsOn.every((depId) => statusById.get(depId) === 'done');
    })
    .slice(0, CLEAN_FORK_MAX_READY_TASKS)
    .map((t) => ({
      id: t.id,
      title: t.title,
      ...(t.description ? { description: t.description } : {}),
    }));

  return {
    activeSpecTitle: title,
    status,
    goal,
    readyTasks,
  };
}

const HIGH_PRIORITY_KINDS = new Set(['architecture', 'pitfall', 'decision']);

function isMemoryStaleOrExpired(rec: Record<string, unknown>, nowMs: number): boolean {
  if (rec.stale === true || rec.drifted === true) return true;
  if (typeof rec.expiresAt === 'string' && rec.expiresAt.trim()) {
    const expMs = Date.parse(rec.expiresAt);
    if (Number.isFinite(expMs) && expMs <= nowMs) return true;
  }
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

function readCoreMemoriesReadOnly(rootDataDir: string, nowMs: number): ExtractedMemoryAnchor[] {
  if (!rootDataDir) return [];
  const memPath = path.join(getModuleDataDir(rootDataDir, 'mem'), 'memories.json');
  const raw = readJsonReadOnlySafe(memPath);
  if (!raw) return [];

  const rawObj = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.memories)
      ? rawObj.memories
      : Array.isArray(rawObj?.items)
        ? rawObj.items
        : [];

  const candidates: ExtractedMemoryAnchor[] = [];

  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (isMemoryStaleOrExpired(rec, nowMs)) continue;

    const rawTitle = typeof rec.title === 'string' ? rec.title : '';
    const rawContent = typeof rec.content === 'string' ? rec.content : '';
    const cleanedTitle = collapseLine(rawTitle, 96);
    const cleanedSummary = collapseLine(rawContent, 200);
    if (!cleanedTitle && !cleanedSummary) continue;

    const anchors: string[] = [];
    if (Array.isArray(rec.anchors)) {
      for (const anchor of rec.anchors) {
        const a = asRecord(anchor);
        if (!a) continue;
        const base =
          typeof a.basename === 'string' && a.basename.trim()
            ? a.basename.trim()
            : typeof a.filePath === 'string' && a.filePath.trim()
              ? path.basename(a.filePath.trim())
              : '';
        if (!base) continue;
        const sym = typeof a.symbol === 'string' && a.symbol.trim() ? `#${a.symbol.trim()}` : '';
        anchors.push(collapseLine(`${base}${sym}`, 64));
        if (anchors.length >= 3) break;
      }
    }

    candidates.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `mem_${candidates.length + 1}`,
      kind: typeof rec.kind === 'string' && rec.kind.trim() ? rec.kind.trim() : 'decision',
      title: cleanedTitle || '(Untitled memory)',
      summary: cleanedSummary,
      pinned: Boolean(rec.pinned),
      anchors,
      recallCount:
        typeof rec.recallCount === 'number' && Number.isFinite(rec.recallCount)
          ? Math.max(0, Math.floor(rec.recallCount))
          : 0,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
    });
  }

  candidates.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aHasAnchors = a.anchors.length > 0 ? 1 : 0;
    const bHasAnchors = b.anchors.length > 0 ? 1 : 0;
    if (aHasAnchors !== bHasAnchors) return bHasAnchors - aHasAnchors;
    const aHighKind = HIGH_PRIORITY_KINDS.has(a.kind) ? 1 : 0;
    const bHighKind = HIGH_PRIORITY_KINDS.has(b.kind) ? 1 : 0;
    if (aHighKind !== bHighKind) return bHighKind - aHighKind;
    if (a.recallCount !== b.recallCount) return b.recallCount - a.recallCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return candidates.slice(0, CLEAN_FORK_MAX_MEM_ANCHORS);
}

// ---------------------------------------------------------------------------
// Demo fixtures (strictly in-memory, zero disk I/O)
// ---------------------------------------------------------------------------

function buildDemoSpecData(): ExtractedSpecData {
  return {
    activeSpecTitle: 'v0.9.0 Clean Fork & Native File Viewer',
    status: 'approved',
    goal: 'Eliminate long-session context rot with one-click clean session forks and zero-ASAR file viewers.',
    readyTasks: [
      {
        id: 'T9.2',
        title: 'Wire Clean Fork aggregator into X-Ray and Hub panels',
        description: 'Aggregate handoff, Spec ready tasks, and Mem anchors within a 12 KB UTF-8 budget.',
      },
      {
        id: 'T9.4',
        title: 'Register native MCP Apps file viewer entrypoint',
        description: 'Support SQLite, CSV, TSV, SVG, and OpenAPI YAML with strict workspace realpath guards.',
      },
      {
        id: 'T9.5',
        title: 'Render structured approval risk cards in Remote PWA',
        description: 'Display risk level, affected file count, and Verify status using DOM APIs without innerHTML.',
      },
    ],
  };
}

function buildDemoMemAnchors(): ExtractedMemoryAnchor[] {
  return [
    {
      id: 'mem_demo_zero_asar',
      kind: 'architecture',
      title: 'Zero ASAR / Zero CDP Architectural Boundary',
      summary: 'All features use official MCP Apps tools, hooks, and config.json sync with zero host patching.',
      pinned: true,
      anchors: ['register.ts#registerXrayModule', 'bridge.ts#startCleanFork'],
      recallCount: 9,
      updatedAt: '2026-11-27T09:00:00.000Z',
    },
    {
      id: 'mem_demo_tool_budget',
      kind: 'convention',
      title: 'Strict Model Tool Budget Invariant (+0 tools)',
      summary: 'UI-triggered helpers register with visibility: ["app"] and read-only queries belong in exemptReadOnlyAppTools.',
      pinned: true,
      anchors: ['register.ts#registerStudioModule'],
      recallCount: 7,
      updatedAt: '2026-11-27T08:30:00.000Z',
    },
    {
      id: 'mem_demo_remote_isolation',
      kind: 'pitfall',
      title: 'Remote Default-Off Four-Zero Isolation',
      summary: 'Keep Remote strictly off by default with zero listening sockets, zero early disk writes, zero polling, and zero outbound calls.',
      pinned: false,
      anchors: ['gateway.ts#RemoteGateway', 'hook.ts#handleRemotePreToolHook'],
      recallCount: 5,
      updatedAt: '2026-11-27T08:00:00.000Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// Public aggregator: buildCleanForkPack
// ---------------------------------------------------------------------------

function clampMaxBytes(raw?: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return CLEAN_FORK_DEFAULT_MAX_BYTES;
  }
  return Math.min(
    CLEAN_FORK_HARD_MAX_BYTES,
    Math.max(CLEAN_FORK_MIN_MAX_BYTES, Math.floor(raw)),
  );
}

/**
 * Pure read-only Clean Fork context pack builder.
 * Combines:
 *  1) Redacted session handoff snapshot from X-Ray
 *  2) Active Spec title, status & up to 5 unblocked ready tasks from modules/spec/state.json
 *  3) Up to 6 high-priority, non-stale code-anchor memories from modules/mem/memories.json
 * Applies O(n) linear secret + <private> redaction and UTF-8 safe byte truncation.
 * Never creates directories or writes files in either live or demo mode.
 */
export function buildCleanForkPack(opts: CleanForkPackOptions): CleanForkPackResult {
  const maxBytes = clampMaxBytes(opts.maxBytes);
  const isDemo = opts.demoMode === true;
  const nowMs = Date.now();

  const discoveryOpts: DiscoveryOptions = isDemo
    ? { demoMode: true }
    : {
        dataDir: opts.rootDataDir ? getModuleDataDir(opts.rootDataDir, 'xray') : undefined,
        brainDirs: opts.brainDir
          ? [{ dir: path.resolve(opts.brainDir), source: 'custom' }]
          : undefined,
        demoMode: false,
      };

  const detail = loadSessionDetail(opts.conversationId, discoveryOpts);
  const hasHandoff = Boolean(detail);
  const handoffRaw = detail ? renderHandoffSnapshot(detail) : '';
  const handoffClean = handoffRaw ? redactCleanForkText(handoffRaw) : '';

  const specData = isDemo ? buildDemoSpecData() : readActiveSpecReadOnly(opts.rootDataDir);
  const memAnchors = isDemo
    ? buildDemoMemAnchors()
    : readCoreMemoriesReadOnly(opts.rootDataDir, nowMs);

  const workspaceLabel = opts.workspaceRoot ? path.basename(path.resolve(opts.workspaceRoot)) : 'workspace';
  const lines: string[] = [
    `# Clean Fork Context Pack — ${collapseLine(workspaceLabel, 80)}`,
    '',
    '> Continue cleanly in a fresh Antigravity session using the verified checkpoints below.',
    '',
  ];

  // Section 1: Spec & Ready Tasks (placed early so truncation never drops immediate next tasks)
  lines.push('## Active Spec & Ready Tasks');
  if (specData.activeSpecTitle) {
    lines.push(
      `- **Spec**: ${specData.activeSpecTitle}${specData.status ? ` (\`${specData.status}\`)` : ''}`,
    );
    if (specData.goal) {
      lines.push(`- **Goal**: ${specData.goal}`);
    }
    if (specData.readyTasks.length > 0) {
      lines.push('- **Ready Unblocked Tasks**:');
      for (const task of specData.readyTasks) {
        lines.push(
          `  - \`${task.id}\` ${task.title}${task.description ? ` — ${task.description}` : ''}`,
        );
      }
    } else {
      lines.push('- **Ready Unblocked Tasks**: None currently queued.');
    }
  } else {
    lines.push('- No active Spec recorded.');
  }
  lines.push('');

  // Section 2: Core Memory & Code Anchors
  lines.push('## Core Memory & Code Anchors');
  if (memAnchors.length > 0) {
    for (const mem of memAnchors) {
      const pinBadge = mem.pinned ? ' [PINNED]' : '';
      const anchorTag = mem.anchors.length > 0 ? ` (${mem.anchors.join(', ')})` : '';
      lines.push(
        `- **[${mem.kind.toUpperCase()}]${pinBadge} ${mem.title}**${anchorTag}: ${mem.summary}`,
      );
    }
  } else {
    lines.push('- No active code-anchor memories recorded.');
  }
  lines.push('');

  // Section 3: Compact Redacted Session Handoff
  lines.push('## Session Handoff Summary');
  if (hasHandoff && handoffClean) {
    lines.push(handoffClean);
  } else {
    lines.push('- No local session transcript available; starting from workspace Spec and Memory context.');
  }

  const redactedFull = redactCleanForkText(lines.join('\n'));
  const { text: promptMarkdown, totalBytes, truncated } = truncateUtf8Safe(redactedFull, maxBytes);
  const estimatedTokens = estimateCleanForkTokens(promptMarkdown);

  return {
    promptMarkdown,
    estimatedTokens,
    totalBytes,
    truncated,
    sections: {
      hasHandoff,
      activeSpecTitle: specData.activeSpecTitle,
      readyTasksCount: specData.readyTasks.length,
      memAnchorsCount: memAnchors.length,
    },
  };
}
