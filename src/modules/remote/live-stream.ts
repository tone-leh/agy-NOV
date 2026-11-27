import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalRealpathSync,
  getDefaultAntigravityBrainDirs,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import { matchSensitivePath, redactText } from './config.js';

export const MAX_LIVE_STREAM_TAIL_BYTES = 256 * 1024; // 256 KiB hard cap
export const MAX_LIVE_STREAM_SUMMARY_CHARS = 320;
export const MAX_LIVE_STREAM_TIMESTAMP_CHARS = 40;
export const DEFAULT_LIVE_STREAM_LIMIT = 20;
export const MIN_LIVE_STREAM_LIMIT = 1;
export const MAX_LIVE_STREAM_LIMIT = 40;
export const TUNNEL_PROBE_TIMEOUT_MS = 1500;
export const MAX_TUNNEL_VERSION_CHARS = 120;

const CONVERSATION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_TOOL_NAME_RE = /^[A-Za-z0-9._:/-]{1,80}$/;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_EPOCH_RE = /^\d{10,16}$/;

const FILE_ARG_KEYS = [
  'Path',
  'path',
  'AbsolutePath',
  'TargetFile',
  'target_file',
  'file_path',
  'filePath',
  'DirectoryPath',
  'uri',
  'Uri',
];

const EXTRA_SENSITIVE_BASENAME_RE =
  /(?:^\.env(?:\.|$)|\.(?:pem|key|p12|pfx|jks|keystore|kdbx|crt|der)$|^id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$|^(?:authorized_keys|known_hosts|\.npmrc|\.netrc|\.pypirc|kubeconfig)$|(?:secret|credential|password|passwd|private[_-]?key|token))/i;

function findTagCloseBeforeNextOpen(
  input: string,
  from: number,
): { gt: number; nextLt: number } {
  const n = input.length;
  for (let k = from; k < n; k += 1) {
    const code = input.charCodeAt(k);
    if (code === 0x3e /* '>' */) return { gt: k, nextLt: -1 };
    if (code === 0x3c /* '<' */) return { gt: -1, nextLt: k };
  }
  return { gt: -1, nextLt: n };
}

function stripRemotePrivateBlocksLinear(input: string): string {
  if (!input || !input.includes('<')) return input;
  const lower = input.toLowerCase();
  if (!lower.includes('<private')) return input;

  let out = '';
  let cursor = 0;
  let depth = 0;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt < 0) {
      if (depth === 0) out += input.slice(cursor);
      cursor = n;
      break;
    }
    if (lower.startsWith('<private', lt)) {
      const after = lt + 8;
      if (after < n && (input[after] === '>' || /\s/.test(input[after]))) {
        const { gt, nextLt } = findTagCloseBeforeNextOpen(input, after);
        if (gt >= 0) {
          if (depth === 0) {
            out += input.slice(cursor, lt);
            out += '[REDACTED_PRIVATE]';
          }
          depth += 1;
          i = gt + 1;
          cursor = i;
          continue;
        }
        // Unclosed `<private ...`: abandon immediately at next `<` (or end) to preserve strict O(n)
        i = nextLt;
        continue;
      }
    } else if (lower.startsWith('</private', lt)) {
      const after = lt + 9;
      if (after < n && (input[after] === '>' || /\s/.test(input[after]))) {
        const { gt, nextLt } = findTagCloseBeforeNextOpen(input, after);
        if (gt >= 0) {
          if (depth > 0) depth -= 1;
          i = gt + 1;
          if (depth === 0) cursor = i;
          continue;
        }
        // Unclosed `</private ...`: abandon immediately at next `<` (or end) to preserve strict O(n)
        i = nextLt;
        continue;
      }
    }
    i = lt + 1;
  }

  if (depth === 0 && cursor < n) {
    out += input.slice(cursor);
  }
  return out;
}

function redactRemotePemBlocksLinear(input: string): string {
  if (!input || !input.includes('-----')) return input;
  const upper = input.toUpperCase();
  const marker = '-----BEGIN ';
  if (!upper.includes(marker)) return input;

  let out = '';
  let pos = 0;
  while (pos < input.length) {
    const start = upper.indexOf(marker, pos);
    if (start < 0) {
      out += input.slice(pos);
      break;
    }
    const headerEnd = upper.indexOf('-----', start + marker.length);
    if (headerEnd < 0 || headerEnd - start > 96) {
      out += input.slice(pos, start + marker.length);
      pos = start + marker.length;
      continue;
    }
    const headerText = upper.slice(start + marker.length, headerEnd);
    if (!headerText.includes('PRIVATE KEY')) {
      out += input.slice(pos, headerEnd + 5);
      pos = headerEnd + 5;
      continue;
    }

    out += input.slice(pos, start);
    out += '[REDACTED_PRIVATE_KEY]';

    const endMarker = '-----END ';
    let searchPos = headerEnd + 5;
    let foundEnd = -1;
    while (searchPos < input.length) {
      const eStart = upper.indexOf(endMarker, searchPos);
      if (eStart < 0) break;
      const eEnd = upper.indexOf('-----', eStart + endMarker.length);
      if (eEnd < 0 || eEnd - eStart > 96) {
        searchPos = eStart + endMarker.length;
        continue;
      }
      const endLabel = upper.slice(eStart + endMarker.length, eEnd);
      if (endLabel.includes('PRIVATE KEY')) {
        foundEnd = eEnd + 5;
        break;
      }
      searchPos = eEnd + 5;
    }

    if (foundEnd >= 0) {
      pos = foundEnd;
    } else {
      pos = input.length;
    }
  }
  return out;
}

const STRONG_SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Bearer / Basic credentials
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  // JWT tokens (covers underscore-prefixed or standalone forms)
  [/(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  // Provider & cloud tokens (lookbehind prevents underscore-glued bypasses like prefix_sk_live_...)
  [
    /(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{16,}|pypi-[A-Za-z0-9_-]{16,})/g,
    '[REDACTED_KEY]',
  ],
];

// Single-pass anchored key=value candidate scanner (O(n) linear; avoids O(n^3) backtracking on long non-kv strings)
const KV_CANDIDATE_RE =
  /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]{1,80})(["']?[ \t]*[:=][ \t]*["']?)(?!\[REDACTED)([^\s"',;}{]{4,})(["']?)/g;
const SENSITIVE_KV_KEY_RE =
  /(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|password|passwd|pwd|authorization|credential)/i;

function redactKeyValueSecrets(text: string): string {
  if (!text.includes('=') && !text.includes(':')) return text;
  return text.replace(
    KV_CANDIDATE_RE,
    (fullMatch, q1: string, key: string, sep: string, _val: string, q2: string) => {
      if (!SENSITIVE_KV_KEY_RE.test(key)) return fullMatch;
      return `${q1}${key}${sep}[REDACTED]${q2}`;
    },
  );
}

export type LiveStreamRole = 'user' | 'assistant' | 'tool' | 'system' | 'error';

export interface LiveStreamEvent {
  stepIndex: number;
  timestamp: string;
  role: LiveStreamRole;
  toolNames: string[];
  summary: string;
  truncated: boolean;
}

export interface ConversationLiveStreamResult {
  conversationId: string;
  mode: 'live' | 'demo';
  readOnly: true;
  found: boolean;
  totalSteps: number;
  events: LiveStreamEvent[];
}

export interface ReadConversationLiveStreamOptions {
  demoMode?: boolean;
  limit?: number;
  brainDirs?: string[];
}

export interface BinaryProbeResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
}

export type BinaryProbeFn = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<BinaryProbeResult>;

export interface TunnelToolStatus {
  id: 'tailscale' | 'cloudflared';
  name: string;
  binary: string;
  installed: boolean;
  version: string | null;
  recommendedCommand: string;
  docsUrl: string;
}

export interface DetectLocalTunnelToolsOptions {
  port?: number;
  demoMode?: boolean;
  probeBinary?: BinaryProbeFn;
}

export interface DetectLocalTunnelToolsResult {
  readOnly: true;
  autoStart: false;
  localTargetUrl: string;
  tools: TunnelToolStatus[];
}

export class InvalidConversationIdError extends Error {
  constructor(message = 'Invalid conversationId: must match /^[A-Za-z0-9._-]{1,128}$/ without ".."') {
    super(message);
    this.name = 'InvalidConversationIdError';
  }
}

export function isValidConversationId(conversationId: string): boolean {
  if (typeof conversationId !== 'string') return false;
  if (conversationId === '.' || conversationId === '..') return false;
  if (!CONVERSATION_ID_RE.test(conversationId)) return false;
  if (conversationId.includes('..')) return false;
  return true;
}

export function validateConversationId(conversationId: string): string {
  if (!isValidConversationId(conversationId)) {
    throw new InvalidConversationIdError();
  }
  return conversationId;
}

export function clampLiveStreamLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIVE_STREAM_LIMIT;
  }
  return Math.min(MAX_LIVE_STREAM_LIMIT, Math.max(MIN_LIVE_STREAM_LIMIT, Math.floor(limit)));
}

/**
 * Dual-pass secret redaction:
 * 1. Existing remote config `redactText`
 * 2. Hardened secret patterns (PKCS#8 & truncated PEM, JWT, Bearer, cloud/provider keys, key=value passwords)
 */
export function redactLiveStreamText(raw: string): string {
  if (!raw) return '';
  let out = stripRemotePrivateBlocksLinear(raw);
  out = redactRemotePemBlocksLinear(out);
  out = redactText(out);
  for (const [pattern, replacement] of STRONG_SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return redactKeyValueSecrets(out);
}

function finalizeSummary(raw: string): { summary: string; truncated: boolean } {
  const redacted = redactLiveStreamText(raw);
  const normalized = redacted.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_LIVE_STREAM_SUMMARY_CHARS) {
    return { summary: normalized, truncated: false };
  }
  const sliced = normalized.slice(0, MAX_LIVE_STREAM_SUMMARY_CHARS - 1).trimEnd();
  const rechecked = redactLiveStreamText(sliced);
  const capped =
    rechecked.length >= MAX_LIVE_STREAM_SUMMARY_CHARS
      ? rechecked.slice(0, MAX_LIVE_STREAM_SUMMARY_CHARS - 1).trimEnd()
      : rechecked;
  return { summary: `${capped}…`, truncated: true };
}

function isPathStrictlyInside(targetRealPath: string, rootRealDir: string): boolean {
  return !isSamePath(rootRealDir, targetRealPath) && isPathInsideDir(rootRealDir, targetRealPath);
}

function resolveSafeTranscriptPath(conversationId: string, brainDirs: string[]): string | null {
  for (const rawRoot of brainDirs) {
    if (!rawRoot || typeof rawRoot !== 'string') continue;
    let realRoot: string;
    try {
      realRoot = canonicalRealpathSync(rawRoot);
      if (!fs.statSync(realRoot).isDirectory()) continue;
    } catch {
      continue;
    }

    const convDir = path.join(realRoot, conversationId);
    const candidatePath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');

    let realConvDir: string;
    let realTarget: string;
    try {
      realConvDir = canonicalRealpathSync(convDir);
      if (!isPathStrictlyInside(realConvDir, realRoot)) continue;
      if (!fs.statSync(realConvDir).isDirectory()) continue;

      realTarget = canonicalRealpathSync(candidatePath);
      if (!isPathStrictlyInside(realTarget, realRoot)) continue;
      if (!isPathStrictlyInside(realTarget, realConvDir)) continue;
      if (!fs.statSync(realTarget).isFile()) continue;
    } catch {
      continue;
    }

    return realTarget;
  }
  return null;
}

function readTailUtf8(filePath: string, maxTailBytes = MAX_LIVE_STREAM_TAIL_BYTES): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    if (stat.size === 0) return '';

    const bytesToRead = Math.min(stat.size, maxTailBytes);
    const startOffset = stat.size - bytesToRead;
    const buf = Buffer.alloc(bytesToRead);
    let totalRead = 0;

    while (totalRead < bytesToRead) {
      const n = fs.readSync(fd, buf, totalRead, bytesToRead - totalRead, startOffset + totalRead);
      if (n <= 0) break;
      totalRead += n;
    }

    let text = buf.subarray(0, totalRead).toString('utf8');
    if (startOffset > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

interface RawToolCall {
  name?: unknown;
  tool_name?: unknown;
  toolName?: unknown;
  args?: unknown;
  arguments?: unknown;
}

interface RawTranscriptRecord {
  step_index?: unknown;
  stepIndex?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  timestamp?: unknown;
  source?: unknown;
  role?: unknown;
  type?: unknown;
  status?: unknown;
  content?: unknown;
  text?: unknown;
  message?: unknown;
  summary?: unknown;
  parts?: unknown;
  error?: unknown;
  tool_name?: unknown;
  toolName?: unknown;
  tool_calls?: unknown;
  toolCalls?: unknown;
}

function sanitizeToolName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !SAFE_TOOL_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

function isSensitiveBasenameOrPath(rawPath: string, base: string): boolean {
  if (!base || base === '.' || base === '..') return true;
  if (matchSensitivePath(rawPath) || matchSensitivePath(base)) return true;
  if (EXTRA_SENSITIVE_BASENAME_RE.test(base)) return true;
  if (/(?:^|[\\/])\.(?:ssh|aws|gnupg|kube)(?:[\\/]|$)/i.test(rawPath)) return true;
  return false;
}

function decodeFileUriSafe(rawUri: string): string | null {
  try {
    const parsed = new URL(rawUri);
    if (parsed.protocol !== 'file:') return null;
    if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') return null;
    const isWinDrive = /^\/[A-Za-z](?::|%3[Aa])(?:[/%]|$)/.test(parsed.pathname);
    let decoded = fileURLToPath(parsed, { windows: isWinDrive });
    if (isWinDrive && /^\/[A-Za-z]:[\\/]/.test(decoded)) {
      decoded = decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

function extractSafeBasenamesFromArgs(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const rec = args as Record<string, unknown>;
  const basenames = new Set<string>();
  for (const key of FILE_ARG_KEYS) {
    const rawVal = rec[key];
    if (typeof rawVal !== 'string') continue;
    const stripped = rawVal.replace(/^["']|["']$/g, '').trim();
    if (!stripped) continue;
    const cleaned = /^file:\/\//i.test(stripped)
      ? decodeFileUriSafe(stripped) ?? stripped.replace(/^file:\/\//i, '').trim()
      : stripped;
    if (!cleaned) continue;
    const normalized = cleaned.replace(/\\/g, '/');
    const base = path.posix.basename(normalized);
    if (!isSensitiveBasenameOrPath(cleaned, base)) {
      basenames.add(base);
    }
  }
  return Array.from(basenames).slice(0, 4);
}

function extractToolInfo(record: RawTranscriptRecord): {
  toolNames: string[];
  safeBasenames: string[];
} {
  const toolNames = new Set<string>();
  const safeBasenames = new Set<string>();

  const directName = sanitizeToolName(record.tool_name ?? record.toolName);
  if (directName) toolNames.add(directName);

  const rawCalls = Array.isArray(record.tool_calls)
    ? record.tool_calls
    : Array.isArray(record.toolCalls)
      ? record.toolCalls
      : [];

  for (const item of rawCalls) {
    if (!item || typeof item !== 'object') continue;
    const tc = item as RawToolCall;
    const name = sanitizeToolName(tc.name ?? tc.tool_name ?? tc.toolName);
    if (name) toolNames.add(name);
    for (const base of extractSafeBasenamesFromArgs(tc.args ?? tc.arguments)) {
      safeBasenames.add(base);
    }
  }

  return {
    toolNames: Array.from(toolNames).slice(0, 8),
    safeBasenames: Array.from(safeBasenames).slice(0, 4),
  };
}

function extractTextField(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    const parts: string[] = [];
    for (const item of val) {
      if (typeof item === 'string') {
        parts.push(item);
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (typeof obj.text === 'string') parts.push(obj.text);
        else if (typeof obj.content === 'string') parts.push(obj.content);
      }
    }
    return parts.join(' ');
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.content === 'string') return obj.content;
  }
  return '';
}

function cleanUserText(raw: string): string {
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return match ? match[1] : raw;
}

function classifyRole(record: RawTranscriptRecord, toolNames: string[]): LiveStreamRole {
  const status = typeof record.status === 'string' ? record.status.toUpperCase() : '';
  const source = typeof record.source === 'string' ? record.source.toUpperCase() : '';
  const role = typeof record.role === 'string' ? record.role.toLowerCase() : '';
  const type = typeof record.type === 'string' ? record.type.toUpperCase() : '';

  const hasErrorObj =
    record.error !== undefined &&
    record.error !== null &&
    record.error !== false &&
    !(typeof record.error === 'string' && record.error.trim() === '');

  if (
    hasErrorObj ||
    source === 'ERROR' ||
    role === 'error' ||
    status === 'ERROR' ||
    status === 'FAILED' ||
    type === 'ERROR' ||
    type.endsWith('_ERROR')
  ) {
    return 'error';
  }

  if (source === 'USER' || role === 'user' || type === 'USER_INPUT' || type === 'USER') {
    return 'user';
  }

  if (
    source === 'TOOL' ||
    role === 'tool' ||
    type === 'TOOL' ||
    type === 'TOOL_CALL' ||
    type === 'TOOL_RESULT'
  ) {
    return 'tool';
  }

  if (source === 'SYSTEM' || role === 'system' || type === 'SYSTEM' || type === 'SYSTEM_MESSAGE') {
    return 'system';
  }

  if (
    source === 'MODEL' ||
    source === 'ASSISTANT' ||
    role === 'assistant' ||
    role === 'model' ||
    type.includes('MODEL') ||
    type.includes('PLANNER') ||
    type.includes('ASSISTANT')
  ) {
    return 'assistant';
  }

  if (toolNames.length > 0) return 'tool';
  return 'assistant';
}

function sanitizeTimestamp(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_LIVE_STREAM_TIMESTAMP_CHARS) return '';
  if (ISO_TIMESTAMP_RE.test(trimmed)) {
    return Number.isNaN(Date.parse(trimmed)) ? '' : trimmed;
  }
  if (NUMERIC_EPOCH_RE.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function parseTranscriptLine(
  line: string,
  fallbackStepIndex: number,
): LiveStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as RawTranscriptRecord;
  const { toolNames, safeBasenames } = extractToolInfo(record);
  const role = classifyRole(record, toolNames);

  const rawStepIndex =
    typeof record.step_index === 'number' && Number.isFinite(record.step_index)
      ? Math.floor(record.step_index)
      : typeof record.stepIndex === 'number' && Number.isFinite(record.stepIndex)
        ? Math.floor(record.stepIndex)
        : fallbackStepIndex;

  const timestamp =
    sanitizeTimestamp(record.created_at) ||
    sanitizeTimestamp(record.createdAt) ||
    sanitizeTimestamp(record.timestamp);

  const errorText = extractTextField(record.error);
  const bodyText =
    extractTextField(record.content) ||
    extractTextField(record.text) ||
    extractTextField(record.message) ||
    extractTextField(record.summary) ||
    extractTextField(record.parts);

  let rawSummary = '';
  if (role === 'error') {
    rawSummary = errorText || bodyText || (toolNames.length > 0 ? `Tool error: ${toolNames.join(', ')}` : 'Step error');
  } else if (role === 'user') {
    rawSummary = cleanUserText(bodyText);
  } else if (bodyText.trim()) {
    rawSummary = bodyText;
  } else if (toolNames.length > 0) {
    const fileSuffix = safeBasenames.length > 0 ? ` (${safeBasenames.join(', ')})` : '';
    rawSummary = `Tools: ${toolNames.join(', ')}${fileSuffix}`;
  } else {
    const fallbackType = typeof record.type === 'string' ? record.type : '';
    rawSummary = fallbackType ? `Step: ${fallbackType}` : '';
  }

  if (!rawSummary.trim() && toolNames.length === 0) {
    return null;
  }

  const { summary, truncated } = finalizeSummary(rawSummary || `Tools: ${toolNames.join(', ')}`);

  return {
    stepIndex: rawStepIndex,
    timestamp,
    role,
    toolNames,
    summary,
    truncated,
  };
}

function buildDemoLiveStream(
  conversationId: string,
  limit: number,
): ConversationLiveStreamResult {
  const now = Date.now();
  const rawSteps: Array<{
    stepIndex: number;
    offsetMs: number;
    role: LiveStreamRole;
    toolNames: string[];
    rawSummary: string;
  }> = [
    {
      stepIndex: 1,
      offsetMs: 95_000,
      role: 'user',
      toolNames: [],
      rawSummary: `Audit webhook retry idempotency and verify test coverage for session ${conversationId}.`,
    },
    {
      stepIndex: 2,
      offsetMs: 78_000,
      role: 'assistant',
      toolNames: ['read_file', 'grep_search'],
      rawSummary: 'Scanning billing queue handlers and retry key guards in gateway.ts and worker.ts.',
    },
    {
      stepIndex: 3,
      offsetMs: 56_000,
      role: 'tool',
      toolNames: ['edit_file'],
      rawSummary: 'Applied atomic idempotency key check in worker.ts with read-only fallback path.',
    },
    {
      stepIndex: 4,
      offsetMs: 39_000,
      role: 'error',
      toolNames: ['run_command'],
      rawSummary: 'AssertionError in retry backoff test: expected duplicate delivery to return cached 200 status.',
    },
    {
      stepIndex: 5,
      offsetMs: 18_000,
      role: 'tool',
      toolNames: ['edit_file', 'run_command'],
      rawSummary: 'Patched cache lookup order in worker.ts and re-ran unit suite (14/14 passed).',
    },
    {
      stepIndex: 6,
      offsetMs: 4_000,
      role: 'assistant',
      toolNames: [],
      rawSummary: 'All idempotency checks and regression tests pass. Ready for your review on desktop.',
    },
  ];

  const events: LiveStreamEvent[] = rawSteps.map((s) => {
    const { summary, truncated } = finalizeSummary(s.rawSummary);
    return {
      stepIndex: s.stepIndex,
      timestamp: new Date(now - s.offsetMs).toISOString(),
      role: s.role,
      toolNames: s.toolNames,
      summary,
      truncated,
    };
  });

  return {
    conversationId,
    mode: 'demo',
    readOnly: true,
    found: true,
    totalSteps: events.length,
    events: events.slice(-limit),
  };
}

export function readConversationLiveStream(
  conversationId: string,
  opts: ReadConversationLiveStreamOptions = {},
): ConversationLiveStreamResult {
  const safeId = validateConversationId(conversationId);
  const limit = clampLiveStreamLimit(opts.limit);

  if (opts.demoMode === true) {
    return buildDemoLiveStream(safeId, limit);
  }

  const brainDirs = opts.brainDirs ?? getDefaultAntigravityBrainDirs();
  const transcriptPath = resolveSafeTranscriptPath(safeId, brainDirs);
  if (!transcriptPath) {
    return {
      conversationId: safeId,
      mode: 'live',
      readOnly: true,
      found: false,
      totalSteps: 0,
      events: [],
    };
  }

  const tailText = readTailUtf8(transcriptPath, MAX_LIVE_STREAM_TAIL_BYTES);
  if (tailText === null) {
    return {
      conversationId: safeId,
      mode: 'live',
      readOnly: true,
      found: false,
      totalSteps: 0,
      events: [],
    };
  }

  const allEvents: LiveStreamEvent[] = [];
  const lines = tailText.split(/\r?\n/);
  let nextFallbackIndex = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const ev = parseTranscriptLine(trimmed, nextFallbackIndex);
    if (ev) {
      allEvents.push(ev);
      nextFallbackIndex = Math.max(nextFallbackIndex + 1, ev.stepIndex + 1);
    }
  }

  return {
    conversationId: safeId,
    mode: 'live',
    readOnly: true,
    found: true,
    totalSteps: allEvents.length,
    events: allEvents.slice(-limit),
  };
}

function defaultProbeBinary(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<BinaryProbeResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        command,
        args,
        {
          shell: false,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            resolve({
              ok: false,
              stdout: typeof stdout === 'string' ? stdout : '',
              stderr: typeof stderr === 'string' ? stderr : '',
              errorCode: typeof code === 'string' ? code : 'EXEC_FAILED',
            });
            return;
          }
          resolve({
            ok: true,
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
          });
        },
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      resolve({
        ok: false,
        errorCode: typeof code === 'string' ? code : 'SPAWN_THREW',
      });
    }
  });
}

function extractFirstLineVersion(stdout?: string, stderr?: string): string | null {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  for (const rawLine of combined.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const redacted = redactLiveStreamText(trimmed);
    return redacted.length > MAX_TUNNEL_VERSION_CHARS
      ? `${redacted.slice(0, MAX_TUNNEL_VERSION_CHARS - 1).trimEnd()}…`
      : redacted;
  }
  return null;
}

function normalizeSafePort(port?: number): number {
  if (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535) {
    return port;
  }
  return 4391;
}

export async function detectLocalTunnelTools(
  opts: DetectLocalTunnelToolsOptions = {},
): Promise<DetectLocalTunnelToolsResult> {
  const safePort = normalizeSafePort(opts.port);
  const localTargetUrl = `http://127.0.0.1:${safePort}`;
  const tailscaleCmd = `tailscale serve --bg ${localTargetUrl}`;
  const cloudflaredCmd = `cloudflared tunnel --url ${localTargetUrl}`;

  if (opts.demoMode === true) {
    return {
      readOnly: true,
      autoStart: false,
      localTargetUrl,
      tools: [
        {
          id: 'tailscale',
          name: 'Tailscale Serve',
          binary: 'tailscale',
          installed: true,
          version: '1.80.0 (demo)',
          recommendedCommand: tailscaleCmd,
          docsUrl: 'https://tailscale.com/kb/1312/serve',
        },
        {
          id: 'cloudflared',
          name: 'Cloudflare Quick Tunnel',
          binary: 'cloudflared',
          installed: false,
          version: null,
          recommendedCommand: cloudflaredCmd,
          docsUrl: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
        },
      ],
    };
  }

  const probe = opts.probeBinary ?? defaultProbeBinary;

  const [tsRes, cfRes] = await Promise.all([
    probe('tailscale', ['version'], TUNNEL_PROBE_TIMEOUT_MS),
    probe('cloudflared', ['--version'], TUNNEL_PROBE_TIMEOUT_MS),
  ]);

  const tools: TunnelToolStatus[] = [
    {
      id: 'tailscale',
      name: 'Tailscale Serve',
      binary: 'tailscale',
      installed: Boolean(tsRes.ok),
      version: tsRes.ok ? extractFirstLineVersion(tsRes.stdout, tsRes.stderr) ?? 'installed' : null,
      recommendedCommand: tailscaleCmd,
      docsUrl: 'https://tailscale.com/kb/1312/serve',
    },
    {
      id: 'cloudflared',
      name: 'Cloudflare Quick Tunnel',
      binary: 'cloudflared',
      installed: Boolean(cfRes.ok),
      version: cfRes.ok ? extractFirstLineVersion(cfRes.stdout, cfRes.stderr) ?? 'installed' : null,
      recommendedCommand: cloudflaredCmd,
      docsUrl: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
    },
  ];

  return {
    readOnly: true,
    autoStart: false,
    localTargetUrl,
    tools,
  };
}
