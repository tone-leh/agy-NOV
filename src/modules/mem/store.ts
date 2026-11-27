import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getModuleDataDir, resolveNovDataDir, sanitizeDataDirCandidate } from '../../core/config.js';
import type {
  CodeAnchor,
  LayeredRecallResult,
  MemoryIndexEntry,
  MemoryItem,
  MemoryKind,
  MemoryProgressiveStats,
  MemoryRecallMode,
  MemoryTimelineEntry,
  StripPrivateTagsResult,
} from './types.js';
import { buildDemoMemories } from './demo-memories.js';

export const MAX_ANCHOR_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_SESSION_START_CHARS = 1200;
export const PRIVATE_CONTENT_PLACEHOLDER = '[PRIVATE_CONTENT_STRIPPED]';
export const PRIVATE_TITLE_PLACEHOLDER = '[PRIVATE_TITLE_STRIPPED]';

const PRIVATE_OPEN_PREFIX = '<private';
const PRIVATE_CLOSE_PREFIX = '</private';

const VALID_MEMORY_KINDS = new Set<MemoryKind>([
  'architecture',
  'decision',
  'pitfall',
  'convention',
  'preference',
]);

const VALID_DRIFT_STATUSES = new Set<NonNullable<CodeAnchor['driftStatus']>>([
  'fresh',
  'drifted',
  'missing',
  'untracked',
  'skipped',
]);

const SECRET_RE: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
    '[REDACTED_PRIVATE_KEY]',
  ],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[^\r\n]*/gi, '[REDACTED_PRIVATE_KEY]'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [
    /(?<![A-Za-z0-9])(sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z\-_]{24,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])/g,
    '[REDACTED_KEY]',
  ],
  [
    /(["']?(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)([^\s"',;}{]{8,})(["']?)/gi,
    '$1[REDACTED]$3',
  ],
];

function isAsciiWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
}

function asciiLowerCode(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

function startsWithAsciiCaseInsensitive(input: string, idx: number, lowerPrefix: string): boolean {
  if (idx + lowerPrefix.length > input.length) return false;
  for (let i = 0; i < lowerPrefix.length; i++) {
    if (asciiLowerCode(input.charCodeAt(idx + i)) !== lowerPrefix.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function matchOpenPrivateTagEnd(input: string, idx: number): number {
  if (!startsWithAsciiCaseInsensitive(input, idx, PRIVATE_OPEN_PREFIX)) return -1;
  let cursor = idx + PRIVATE_OPEN_PREFIX.length;
  if (cursor >= input.length) return -1;
  const boundary = input.charCodeAt(cursor);
  if (boundary === 0x3e /* '>' */) return cursor;
  if (!isAsciiWhitespaceCode(boundary)) return -1;
  cursor += 1;
  while (cursor < input.length) {
    const code = input.charCodeAt(cursor);
    if (code === 0x3e /* '>' */) return cursor;
    if (code === 0x3c /* '<' */) return -1;
    cursor += 1;
  }
  return -1;
}

function matchClosePrivateTagEnd(input: string, idx: number): number {
  if (!startsWithAsciiCaseInsensitive(input, idx, PRIVATE_CLOSE_PREFIX)) return -1;
  let cursor = idx + PRIVATE_CLOSE_PREFIX.length;
  while (cursor < input.length && isAsciiWhitespaceCode(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor < input.length && input.charCodeAt(cursor) === 0x3e /* '>' */) {
    return cursor;
  }
  return -1;
}

/**
 * Strip all ASCII case-insensitive <private>...</private> blocks in strict O(n) linear time (zero ReDoS).
 * Scans directly on raw UTF-16 indices (never reusing .toLowerCase() offsets) so Unicode case-folding
 * expansion characters (e.g. U+0130 'İ') can never shift offsets or leak secrets.
 * Supports attributes, multiline, multiple, and nested blocks; any unclosed <private> tag strips through EOF.
 */
export function stripPrivateTags(input: string): StripPrivateTagsResult {
  if (!input || !input.includes('<')) return { cleaned: input, strippedCount: 0 };

  const chunks: string[] = [];
  let cursor = 0;
  let strippedCount = 0;

  while (cursor < input.length) {
    const ltIdx = input.indexOf('<', cursor);
    if (ltIdx === -1) {
      chunks.push(input.slice(cursor));
      break;
    }

    const openEnd = matchOpenPrivateTagEnd(input, ltIdx);
    if (openEnd === -1) {
      chunks.push(input.slice(cursor, ltIdx + 1));
      cursor = ltIdx + 1;
      continue;
    }

    if (ltIdx > cursor) {
      chunks.push(input.slice(cursor, ltIdx));
    }

    let depth = 1;
    let scan = openEnd + 1;
    while (scan < input.length && depth > 0) {
      const nextLt = input.indexOf('<', scan);
      if (nextLt === -1) {
        // Unclosed <private>: forcibly strip everything through EOF
        scan = input.length;
        break;
      }

      const nestedOpenEnd = matchOpenPrivateTagEnd(input, nextLt);
      if (nestedOpenEnd !== -1) {
        depth += 1;
        scan = nestedOpenEnd + 1;
        continue;
      }

      const closeEnd = matchClosePrivateTagEnd(input, nextLt);
      if (closeEnd !== -1) {
        depth -= 1;
        scan = closeEnd + 1;
        continue;
      }

      scan = nextLt + 1;
    }

    strippedCount += 1;
    cursor = depth > 0 ? input.length : scan;
  }

  if (strippedCount === 0) {
    return { cleaned: input, strippedCount: 0 };
  }

  const cleaned = chunks
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleaned, strippedCount };
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
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

export function redactSecrets(input: string): string {
  let out = input;
  for (const [re, rep] of SECRET_RE) out = out.replace(re, rep);
  return out;
}

function sanitizeTag(raw: string): string {
  const stripped = stripPrivateTags(raw).cleaned.trim();
  if (!stripped) return '';
  const redacted = redactSecrets(stripped);
  if (redacted === stripped) return stripped.toLowerCase();
  return redacted
    .toLowerCase()
    .replace(/\[redacted(?:_[a-z_]+)?\]/g, (m) => m.toUpperCase());
}

function collapseSingleLine(text: string, maxLen: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function formatCompactAnchorList(anchors: CodeAnchor[], maxFiles = 3): string {
  if (anchors.length === 0) return '';
  const names = anchors.slice(0, maxFiles).map((a) => a.basename);
  const extra = anchors.length > maxFiles ? `, +${anchors.length - maxFiles}` : '';
  return ` [${names.join(', ')}${extra}]`;
}

function toIndexEntry(m: MemoryItem, score?: number): MemoryIndexEntry {
  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    pinned: m.pinned,
    drifted: Boolean(m.drifted),
    tags: [...m.tags],
    anchors: m.anchors.map((a) => ({
      basename: a.basename,
      ...(a.symbol ? { symbol: a.symbol } : {}),
      ...(a.driftStatus ? { driftStatus: a.driftStatus } : {}),
    })),
    updatedAt: m.updatedAt,
    recallCount: m.recallCount,
    ...(typeof score === 'number' ? { score } : {}),
  };
}

function formatCompactIndexLine(entry: MemoryIndexEntry, maxTitleLen = 72): string {
  const title = collapseSingleLine(entry.title, maxTitleLen);
  const pinMark = entry.pinned ? ' ★' : '';
  const driftMark = entry.drifted ? ' · DRIFTED' : '';
  const scoreMark = typeof entry.score === 'number' ? ` (score ${entry.score})` : '';
  const files =
    entry.anchors.length > 0
      ? ` [${entry.anchors
          .slice(0, 3)
          .map((a) => a.basename)
          .join(', ')}${entry.anchors.length > 3 ? `, +${entry.anchors.length - 3}` : ''}]`
      : '';
  return `- [${entry.id}] (${entry.kind.toUpperCase()}${pinMark}${driftMark}) ${title}${files}${scoreMark}`;
}

export function resolveMemDataDir(explicitRootOrDir?: string): string {
  const sanitized = sanitizeDataDirCandidate(explicitRootOrDir);
  if (sanitized) return getModuleDataDir(sanitized, 'mem');
  return getModuleDataDir(resolveNovDataDir(), 'mem');
}

export function isSensitiveFilePath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed) return true;
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return true;

  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === '.ssh') return true;
    if (lower.startsWith('.env')) return true;
  }

  const base = segments[segments.length - 1].toLowerCase();
  if (/\.(pem|key|p12|pfx|jks)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i.test(base)) return true;

  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].toLowerCase() === '.aws' && base === 'credentials') return true;
  }

  return false;
}

function isRelativeInside(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveExistingAncestorRealpath(absTarget: string): string | undefined {
  let cursor = path.dirname(absTarget);
  while (true) {
    try {
      const realAncestor = fs.realpathSync(cursor);
      const tail = path.relative(cursor, absTarget);
      return path.join(realAncestor, tail);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return undefined;
      cursor = parent;
    }
  }
}

export interface AnchorInspectionResult {
  status: 'ok' | 'missing' | 'skipped';
  sha256?: string;
  reason?: 'sensitive' | 'outside-workspace' | 'oversized' | 'non-file' | 'unreadable';
}

export function inspectAnchorFile(
  filePath: string,
  workspacePath?: string,
  maxBytes = MAX_ANCHOR_FILE_BYTES,
): AnchorInspectionResult {
  if (!filePath || !filePath.trim()) {
    return { status: 'skipped', reason: 'unreadable' };
  }

  const absFile = path.resolve(filePath);
  if (isSensitiveFilePath(filePath) || isSensitiveFilePath(absFile)) {
    return { status: 'skipped', reason: 'sensitive' };
  }

  const effectiveWorkspace = workspacePath && workspacePath.trim() ? workspacePath.trim() : process.cwd();
  let realWorkspace: string;
  try {
    realWorkspace = fs.realpathSync(path.resolve(effectiveWorkspace));
  } catch {
    return { status: 'skipped', reason: 'outside-workspace' };
  }

  let realFile: string;
  try {
    realFile = fs.realpathSync(absFile);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      const projected = resolveExistingAncestorRealpath(absFile);
      if (!projected || !isRelativeInside(realWorkspace, projected)) {
        return { status: 'skipped', reason: 'outside-workspace' };
      }
      return { status: 'missing' };
    }
    return { status: 'skipped', reason: 'unreadable' };
  }

  if (isSensitiveFilePath(realFile)) {
    return { status: 'skipped', reason: 'sensitive' };
  }

  if (!isRelativeInside(realWorkspace, realFile)) {
    return { status: 'skipped', reason: 'outside-workspace' };
  }

  let fd: number | undefined;
  try {
    const stat = fs.statSync(realFile);
    if (!stat.isFile()) return { status: 'skipped', reason: 'non-file' };
    if (stat.size > maxBytes) return { status: 'skipped', reason: 'oversized' };

    fd = fs.openSync(realFile, 'r');
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile()) return { status: 'skipped', reason: 'non-file' };
    if (fdStat.size > maxBytes) return { status: 'skipped', reason: 'oversized' };

    const hash = crypto.createHash('sha256');
    const chunkSize = Math.min(64 * 1024, Math.max(1, maxBytes));
    const chunk = Buffer.alloc(chunkSize);
    let totalRead = 0;

    while (true) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n <= 0) break;
      totalRead += n;
      if (totalRead > maxBytes) {
        return { status: 'skipped', reason: 'oversized' };
      }
      hash.update(chunk.subarray(0, n));
    }

    return { status: 'ok', sha256: hash.digest('hex').slice(0, 16) };
  } catch {
    return { status: 'skipped', reason: 'unreadable' };
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

export function hashFileIfExists(
  filePath: string,
  opts?: string | { workspacePath?: string; maxBytes?: number },
): string | undefined {
  const workspacePath = typeof opts === 'string' ? opts : opts?.workspacePath;
  const maxBytes = typeof opts === 'object' && opts?.maxBytes ? opts.maxBytes : MAX_ANCHOR_FILE_BYTES;
  const res = inspectAnchorFile(filePath, workspacePath, maxBytes);
  return res.status === 'ok' ? res.sha256 : undefined;
}

function safePathToFileUri(filePath: string): string {
  try {
    return pathToFileURL(path.resolve(filePath)).href;
  } catch {
    return '';
  }
}

function normalizeAnchor(raw: unknown): CodeAnchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.filePath !== 'string' || !r.filePath.trim()) return null;
  const filePath = r.filePath.trim();
  const basename =
    typeof r.basename === 'string' && r.basename.trim() ? r.basename.trim() : path.basename(filePath);
  const uri = typeof r.uri === 'string' && r.uri.trim() ? r.uri.trim() : safePathToFileUri(filePath);
  const symbol = typeof r.symbol === 'string' && r.symbol.trim() ? r.symbol.trim() : undefined;
  const sha256 = typeof r.sha256 === 'string' && r.sha256.trim() ? r.sha256.trim() : undefined;
  const driftStatus =
    typeof r.driftStatus === 'string' &&
    VALID_DRIFT_STATUSES.has(r.driftStatus as NonNullable<CodeAnchor['driftStatus']>)
      ? (r.driftStatus as CodeAnchor['driftStatus'])
      : undefined;

  return {
    filePath,
    basename,
    uri,
    ...(symbol ? { symbol } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(driftStatus ? { driftStatus } : {}),
  };
}

function normalizeMemoryItem(raw: unknown, index: number): MemoryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const fallbackSeed = `${index}:${String(r.title ?? '')}:${String(r.content ?? '')}`;
  const fallbackId = `mem_rec_${crypto.createHash('sha256').update(fallbackSeed).digest('hex').slice(0, 10)}`;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : fallbackId;
  const kind: MemoryKind =
    typeof r.kind === 'string' && VALID_MEMORY_KINDS.has(r.kind as MemoryKind)
      ? (r.kind as MemoryKind)
      : 'decision';
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '(Untitled memory)';
  const content = typeof r.content === 'string' ? r.content : '';
  const tags = Array.isArray(r.tags)
    ? Array.from(
        new Set(
          r.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const anchors = Array.isArray(r.anchors)
    ? r.anchors.map((a) => normalizeAnchor(a)).filter((a): a is CodeAnchor => a !== null)
    : [];
  const workspacePath =
    typeof r.workspacePath === 'string' && r.workspacePath.trim() ? r.workspacePath.trim() : undefined;
  const sourceConversationId =
    typeof r.sourceConversationId === 'string' && r.sourceConversationId.trim()
      ? r.sourceConversationId.trim()
      : undefined;
  const createdAt =
    typeof r.createdAt === 'string' && r.createdAt.trim()
      ? r.createdAt.trim()
      : new Date(0).toISOString();
  const updatedAt =
    typeof r.updatedAt === 'string' && r.updatedAt.trim() ? r.updatedAt.trim() : createdAt;
  const recallCount =
    typeof r.recallCount === 'number' && Number.isFinite(r.recallCount) && r.recallCount >= 0
      ? Math.floor(r.recallCount)
      : 0;
  const pinned = Boolean(r.pinned);
  const drifted = typeof r.drifted === 'boolean' ? r.drifted : undefined;

  return {
    id,
    kind,
    title,
    content,
    tags,
    ...(workspacePath ? { workspacePath } : {}),
    ...(sourceConversationId ? { sourceConversationId } : {}),
    anchors,
    pinned,
    createdAt,
    updatedAt,
    recallCount,
    ...(drifted !== undefined ? { drifted } : {}),
  };
}

function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore chmod failure on unsupported filesystems
  }
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_./-]{2,}/g) ?? [];
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const cjk: string[] = [];
  for (const run of cjkRuns) {
    if (run.length === 1) cjk.push(run);
    else for (let i = 0; i < run.length - 1; i++) cjk.push(run.slice(i, i + 2));
  }
  return [...latin, ...cjk];
}

export class MemoryStore {
  private readonly filePath: string;
  private demoItems: MemoryItem[] | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly demoMode = false,
    private readonly defaultWorkspaceRoot?: string,
  ) {
    this.filePath = path.join(dataDir, 'memories.json');
  }

  private cloneItems(items: MemoryItem[]): MemoryItem[] {
    return items.map((m) => ({
      ...m,
      tags: [...m.tags],
      anchors: m.anchors.map((a) => ({ ...a })),
    }));
  }

  private backupCorruptFile(reason: string): void {
    const base = `${this.filePath}.corrupt.${Date.now()}`;
    const backupPath = fs.existsSync(base)
      ? `${base}.${crypto.randomBytes(2).toString('hex')}`
      : base;
    try {
      fs.renameSync(this.filePath, backupPath);
      try {
        fs.chmodSync(backupPath, 0o600);
      } catch {
        // ignore chmod failure
      }
      console.error(`[agy-nov:mem] Corrupt memories store backed up to ${backupPath}: ${reason}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agy-nov:mem] Corrupt memories store detected (${reason}), backup failed: ${msg}`);
    }
  }

  private readRaw(): MemoryItem[] {
    if (this.demoMode) {
      if (!this.demoItems) {
        this.demoItems = buildDemoMemories();
      }
      return this.cloneItems(this.demoItems);
    }
    if (!fs.existsSync(this.filePath)) return [];
    let rawText: string;
    try {
      rawText = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agy-nov:mem] Failed to read ${this.filePath}: ${msg}`);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.backupCorruptFile(`invalid JSON (${msg})`);
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.backupCorruptFile('root JSON value must be an array');
      return [];
    }

    return parsed
      .map((entry, idx) => normalizeMemoryItem(entry, idx))
      .filter((item): item is MemoryItem => item !== null);
  }

  private writeAll(items: MemoryItem[]): void {
    if (this.demoMode) {
      this.demoItems = this.cloneItems(items);
      return;
    }
    ensurePrivateDir(this.dataDir);
    const tmp = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(tmp, 0o600);
      } catch {
        // ignore chmod failure
      }
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }
  }

  private evaluateDrift(item: MemoryItem): MemoryItem {
    if (this.demoMode && item.id.startsWith('mem_demo_')) {
      return item;
    }
    let anyDrifted = false;
    const effectiveWs = item.workspacePath ?? this.defaultWorkspaceRoot;
    const rawAnchors = Array.isArray(item.anchors) ? item.anchors : [];
    const anchors: CodeAnchor[] = rawAnchors.map((a) => {
      if (!a.sha256) return { ...a, driftStatus: a.driftStatus ?? 'untracked' };
      const inspected = inspectAnchorFile(a.filePath, effectiveWs);
      if (inspected.status === 'skipped') {
        return { ...a, driftStatus: 'skipped' };
      }
      if (inspected.status === 'missing' || !inspected.sha256) {
        anyDrifted = true;
        return { ...a, driftStatus: 'missing' };
      }
      if (inspected.sha256 !== a.sha256) {
        anyDrifted = true;
        return { ...a, driftStatus: 'drifted' };
      }
      return { ...a, driftStatus: 'fresh' };
    });
    return { ...item, anchors, drifted: anyDrifted };
  }

  list(opts: { workspacePath?: string; kind?: MemoryKind; pinnedOnly?: boolean } = {}): MemoryItem[] {
    let items = this.readRaw().map((m) => this.evaluateDrift(m));
    if (opts.workspacePath) {
      const target = path.resolve(opts.workspacePath);
      items = items.filter((m) => !m.workspacePath || path.resolve(m.workspacePath) === target);
    }
    if (opts.kind) items = items.filter((m) => m.kind === opts.kind);
    if (opts.pinnedOnly) items = items.filter((m) => m.pinned);
    return items.sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  remember(input: {
    id?: string;
    kind: MemoryKind;
    title: string;
    content: string;
    tags?: string[];
    workspacePath?: string;
    sourceConversationId?: string;
    anchors?: Array<{ filePath: string; symbol?: string }>;
    pinned?: boolean;
  }): MemoryItem {
    const items = this.readRaw();
    const now = new Date().toISOString();
    const requestedWorkspace = input.workspacePath ? path.resolve(input.workspacePath) : undefined;
    // Enforce defaultWorkspaceRoot security boundary when configured: never allow model-supplied workspacePath to widen anchor inspection outside workspaceRoot.
    let inspectWorkspace = this.defaultWorkspaceRoot
      ? path.resolve(this.defaultWorkspaceRoot)
      : requestedWorkspace;
    let resolvedWorkspace = inspectWorkspace;
    if (requestedWorkspace && this.defaultWorkspaceRoot) {
      const trustedRoot = path.resolve(this.defaultWorkspaceRoot);
      const realTrusted = (() => {
        try {
          return fs.realpathSync(trustedRoot);
        } catch {
          return trustedRoot;
        }
      })();
      let realReq: string;
      try {
        realReq = fs.realpathSync(requestedWorkspace);
      } catch {
        realReq = resolveExistingAncestorRealpath(requestedWorkspace) ?? requestedWorkspace;
      }
      if (realReq === realTrusted || isRelativeInside(realTrusted, realReq)) {
        inspectWorkspace = realReq;
        resolvedWorkspace = requestedWorkspace;
      }
    }

    const anchors: CodeAnchor[] = (input.anchors ?? [])
      .filter((a) => a && typeof a.filePath === 'string' && a.filePath.trim().length > 0)
      .map((a) => {
        const rawPath = a.filePath.trim();
        const abs = path.isAbsolute(rawPath)
          ? path.resolve(rawPath)
          : path.resolve(inspectWorkspace ?? process.cwd(), rawPath);
        const strippedSymbol = a.symbol ? stripPrivateTags(a.symbol).cleaned.trim() : '';
        const cleanSymbol = strippedSymbol ? redactSecrets(strippedSymbol) : undefined;
        const inspected = inspectAnchorFile(abs, inspectWorkspace);
        const driftStatus: CodeAnchor['driftStatus'] =
          inspected.status === 'ok'
            ? 'fresh'
            : inspected.status === 'skipped'
              ? 'skipped'
              : 'untracked';
        return {
          filePath: abs,
          basename: path.basename(abs),
          uri: safePathToFileUri(abs),
          ...(cleanSymbol ? { symbol: cleanSymbol } : {}),
          ...(inspected.sha256 ? { sha256: inspected.sha256 } : {}),
          driftStatus,
        };
      });

    const titleStripped = stripPrivateTags(input.title);
    const cleanTitle = redactSecrets(
      titleStripped.cleaned.trim() ||
        (titleStripped.strippedCount > 0 ? PRIVATE_TITLE_PLACEHOLDER : '(Untitled memory)'),
    );
    const contentStripped = stripPrivateTags(input.content);
    const cleanContent = redactSecrets(
      contentStripped.cleaned.trim() ||
        (contentStripped.strippedCount > 0 ? PRIVATE_CONTENT_PLACEHOLDER : ''),
    );
    const tags = Array.from(new Set((input.tags ?? []).map((t) => sanitizeTag(t)).filter(Boolean)));

    const existingIdx = input.id
      ? items.findIndex((m) => m.id === input.id)
      : items.findIndex(
          (m) =>
            m.title.toLowerCase() === cleanTitle.toLowerCase() &&
            (m.workspacePath ?? '') === (resolvedWorkspace ?? ''),
        );

    if (existingIdx >= 0) {
      const updated: MemoryItem = {
        ...items[existingIdx],
        kind: input.kind,
        title: cleanTitle,
        content: cleanContent,
        tags,
        anchors: anchors.length ? anchors : items[existingIdx].anchors,
        pinned: input.pinned ?? items[existingIdx].pinned,
        updatedAt: now,
      };
      items[existingIdx] = updated;
      this.writeAll(items);
      return this.evaluateDrift(updated);
    }

    const created: MemoryItem = {
      id: input.id || `mem_${crypto.randomBytes(5).toString('hex')}`,
      kind: input.kind,
      title: cleanTitle,
      content: cleanContent,
      tags,
      workspacePath: resolvedWorkspace,
      sourceConversationId: input.sourceConversationId,
      anchors,
      pinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
      recallCount: 0,
    };
    items.unshift(created);
    this.writeAll(items);
    return this.evaluateDrift(created);
  }

  reverifyAnchorHashes(id: string): MemoryItem | null {
    const items = this.readRaw();
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    const ws = items[idx].workspacePath ?? this.defaultWorkspaceRoot;
    items[idx].anchors = items[idx].anchors.map((a) => {
      const inspected = inspectAnchorFile(a.filePath, ws);
      if (inspected.status === 'ok' && inspected.sha256) {
        return { ...a, sha256: inspected.sha256, driftStatus: 'fresh' };
      }
      if (inspected.status === 'skipped') {
        const { sha256: _ignored, ...rest } = a;
        return { ...rest, driftStatus: 'skipped' };
      }
      return { ...a, driftStatus: 'missing' };
    });
    items[idx].drifted = false;
    items[idx].updatedAt = new Date().toISOString();
    this.writeAll(items);
    return this.evaluateDrift(items[idx]);
  }

  togglePin(id: string, pinned?: boolean): MemoryItem | null {
    const items = this.readRaw();
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    items[idx].pinned = pinned ?? !items[idx].pinned;
    items[idx].updatedAt = new Date().toISOString();
    this.writeAll(items);
    return this.evaluateDrift(items[idx]);
  }

  forget(id: string): boolean {
    const items = this.readRaw();
    const next = items.filter((m) => m.id !== id);
    if (next.length === items.length) return false;
    this.writeAll(next);
    return true;
  }

  getByIds(
    ids: string[],
    opts: { workspacePath?: string; incrementRecall?: boolean } = {},
  ): MemoryItem[] {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return [];

    const all = this.list({ workspacePath: opts.workspacePath });
    const byId = new Map(all.map((m) => [m.id, m]));
    const matched = uniqueIds
      .map((id) => byId.get(id))
      .filter((m): m is MemoryItem => m !== undefined);

    if (opts.incrementRecall && matched.length > 0) {
      const raw = this.readRaw();
      const matchedSet = new Set(matched.map((m) => m.id));
      for (const m of raw) {
        if (matchedSet.has(m.id)) {
          m.recallCount = (m.recallCount ?? 0) + 1;
        }
      }
      this.writeAll(raw);
      return matched.map((m) => ({ ...m, recallCount: (m.recallCount ?? 0) + 1 }));
    }

    return matched;
  }

  recall(
    query: string,
    opts: { workspacePath?: string; limit?: number; incrementRecall?: boolean } = {},
  ): Array<MemoryItem & { score: number }> {
    const limit = opts.limit ?? 10;
    const all = this.list({ workspacePath: opts.workspacePath });
    const trimmed = query.trim();
    if (!trimmed) {
      return all.slice(0, limit).map((m) => ({ ...m, score: m.pinned ? 2 : 1 }));
    }

    const qTokens = Array.from(new Set(tokenize(trimmed)));
    if (qTokens.length === 0) return [];

    const docTokens = all.map((m) =>
      tokenize(
        `${m.title} ${m.content} ${m.tags.join(' ')} ${m.anchors.map((a) => `${a.basename} ${a.symbol ?? ''}`).join(' ')}`,
      ),
    );
    const N = all.length || 1;
    const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N || 1;
    const df = new Map<string, number>();
    for (const q of qTokens) {
      let c = 0;
      for (const dt of docTokens) if (dt.includes(q)) c += 1;
      df.set(q, c);
    }

    const k1 = 1.5;
    const b = 0.75;
    const qLower = trimmed.toLowerCase();

    const hits = all
      .map((m, i) => {
        const tfMap = new Map<string, number>();
        for (const t of docTokens[i]) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
        let score = 0;
        for (const q of qTokens) {
          const tf = tfMap.get(q) ?? 0;
          if (!tf) continue;
          const docFreq = df.get(q) ?? 0;
          const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docTokens[i].length) / avgLen)));
        }
        if (m.title.toLowerCase().includes(qLower)) score += 3.0;
        if (m.content.toLowerCase().includes(qLower)) score += 2.0;
        if (m.pinned && score > 0) score += 0.6;
        return { ...m, score: Number(score.toFixed(2)) };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (opts.incrementRecall && hits.length > 0) {
      const raw = this.readRaw();
      const hitIds = new Set(hits.map((h) => h.id));
      for (const m of raw) {
        if (hitIds.has(m.id)) m.recallCount = (m.recallCount ?? 0) + 1;
      }
      this.writeAll(raw);
      return hits.map((h) => ({ ...h, recallCount: (h.recallCount ?? 0) + 1 }));
    }

    return hits;
  }

  buildCompactIndexEntries(workspacePaths: string[] = [], maxItems = 12): MemoryIndexEntry[] {
    const ws = workspacePaths[0];
    return this.list({ workspacePath: ws })
      .filter((m) => !m.drifted)
      .slice(0, maxItems)
      .map((m) => toIndexEntry(m));
  }

  buildSessionStartInjection(workspacePaths: string[] = [], maxItems = 12): string {
    const entries = this.buildCompactIndexEntries(workspacePaths, maxItems);
    if (entries.length === 0) return '';

    const header = `[Agy Mem — Progressive Index (${entries.length} active · L1)]`;
    const footer =
      'Call mem_recall(mode="detail", ids=["<id>"]) for full content or mode="timeline" for nearby context.';

    const lines: string[] = [header];
    let usedLen = header.length + 1 + footer.length;
    let included = 0;

    for (const entry of entries) {
      const line = formatCompactIndexLine(entry);
      const nextLen = usedLen + 1 + line.length;
      if (nextLen <= MAX_SESSION_START_CHARS) {
        lines.push(line);
        usedLen = nextLen;
        included += 1;
      } else if (included === 0) {
        const available = Math.max(24, MAX_SESSION_START_CHARS - usedLen - 1);
        lines.push(collapseSingleLine(line, available));
        included += 1;
        break;
      } else {
        break;
      }
    }

    const omitted = entries.length - included;
    if (omitted > 0) {
      const moreLine = `(+${omitted} more indexed; query with mem_recall(mode="index", query="..."))`;
      if (usedLen + 1 + moreLine.length <= MAX_SESSION_START_CHARS) {
        lines.push(moreLine);
      }
    }

    lines.push(footer);
    const out = lines.join('\n');
    return out.length <= MAX_SESSION_START_CHARS ? out : out.slice(0, MAX_SESSION_START_CHARS);
  }

  buildProgressiveStats(workspacePaths?: string[], maxItems = 12): MemoryProgressiveStats {
    const ws = workspacePaths?.[0];
    const active = this.list({ workspacePath: ws }).filter((m) => !m.drifted);
    if (active.length === 0) {
      return {
        activeCount: 0,
        compactIndexChars: 0,
        compactIndexTokens: 0,
        fullDumpTokens: 0,
        savedTokens: 0,
        savedPercent: 0,
      };
    }

    const compactIndex = this.buildSessionStartInjection(workspacePaths ?? [], maxItems);
    const fullDumpText = [
      `[Agy Mem — Persistent Workspace Memory (${active.length} active)]`,
      ...active.map((m) => {
        const anchorTxt = formatCompactAnchorList(m.anchors, m.anchors.length);
        const tagTxt = m.tags.length ? ` [tags: ${m.tags.join(', ')}]` : '';
        return `- [${m.id}] (${m.kind.toUpperCase()}${m.pinned ? ' ★' : ''}) **${m.title}**: ${m.content}${anchorTxt}${tagTxt}`;
      }),
    ].join('\n');

    const compactIndexChars = compactIndex.length;
    const compactIndexTokens = estimateTokenCount(compactIndex);
    const fullDumpTokens = estimateTokenCount(fullDumpText);
    const savedTokens = Math.max(0, fullDumpTokens - compactIndexTokens);
    const savedPercent = fullDumpTokens > 0 ? Math.round((savedTokens / fullDumpTokens) * 100) : 0;

    return {
      activeCount: active.length,
      compactIndexChars,
      compactIndexTokens,
      fullDumpTokens,
      savedTokens,
      savedPercent,
    };
  }

  recallLayered(opts: {
    query?: string;
    mode?: MemoryRecallMode;
    ids?: string[];
    workspacePath?: string;
    limit?: number;
    window?: number;
    incrementRecall?: boolean;
  } = {}): LayeredRecallResult {
    const mode: MemoryRecallMode = opts.mode ?? 'detail';
    const query = (opts.query ?? '').trim();
    const ids = Array.from(new Set((opts.ids ?? []).map((id) => id.trim()).filter(Boolean)));
    const limit = opts.limit ?? 8;
    const windowSize = Math.min(5, Math.max(1, Math.floor(opts.window ?? 2)));

    if (mode === 'index') {
      const entries: MemoryIndexEntry[] =
        ids.length > 0
          ? this.getByIds(ids, { workspacePath: opts.workspacePath, incrementRecall: false }).map((m) =>
              toIndexEntry(m),
            )
          : this.recall(query, {
              workspacePath: opts.workspacePath,
              limit,
              incrementRecall: false,
            }).map((m) => toIndexEntry(m, m.score));

      const text = entries.length
        ? [
            `[Agy Mem · L1 Index (${entries.length} ${entries.length === 1 ? 'match' : 'matches'})]`,
            ...entries.map((entry) => formatCompactIndexLine(entry)),
            'Call mem_recall(mode="detail", ids=["<id>"]) to load full memory content.',
          ].join('\n')
        : ids.length > 0
          ? `No memories found for ids: ${ids.join(', ')}.`
          : `No memories matched "${query}".`;

      return {
        mode,
        query,
        ids,
        window: windowSize,
        totalHits: entries.length,
        text,
        indexEntries: entries,
        timelineEntries: [],
        detailItems: [],
      };
    }

    if (mode === 'timeline') {
      const chronological = this.list({ workspacePath: opts.workspacePath }).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
      const indexById = new Map<string, number>();
      chronological.forEach((m, idx) => indexById.set(m.id, idx));

      const anchorIndices = new Set<number>();
      const anchorHitIds = new Set<string>();
      const scoreMap = new Map<string, number>();

      if (ids.length > 0) {
        for (const id of ids) {
          const idx = indexById.get(id);
          if (idx !== undefined) {
            anchorIndices.add(idx);
            anchorHitIds.add(id);
          }
        }
      } else if (query) {
        const hits = this.recall(query, {
          workspacePath: opts.workspacePath,
          limit,
          incrementRecall: false,
        });
        for (const h of hits) {
          const idx = indexById.get(h.id);
          if (idx !== undefined) {
            anchorIndices.add(idx);
            anchorHitIds.add(h.id);
            scoreMap.set(h.id, h.score);
          }
        }
      } else {
        const count = Math.min(limit, chronological.length);
        for (let i = 0; i < count; i++) {
          anchorIndices.add(i);
        }
      }

      const includedIndices = new Set<number>();
      if (ids.length > 0 || query) {
        for (const anchorIdx of anchorIndices) {
          const start = Math.max(0, anchorIdx - windowSize);
          const end = Math.min(chronological.length - 1, anchorIdx + windowSize);
          for (let i = start; i <= end; i++) {
            includedIndices.add(i);
          }
        }
      } else {
        for (const idx of anchorIndices) {
          includedIndices.add(idx);
        }
      }

      const orderedIndices = Array.from(includedIndices).sort((a, b) => a - b);
      const timelineEntries: MemoryTimelineEntry[] = orderedIndices.map((idx) => {
        const m = chronological[idx];
        const score = scoreMap.get(m.id);
        return {
          id: m.id,
          kind: m.kind,
          title: m.title,
          excerpt: collapseSingleLine(m.content, 120),
          pinned: m.pinned,
          drifted: Boolean(m.drifted),
          tags: [...m.tags],
          anchorFiles: m.anchors.map((a) => a.basename),
          ...(m.sourceConversationId ? { sourceConversationId: m.sourceConversationId } : {}),
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          recallCount: m.recallCount,
          isAnchorHit: anchorHitIds.has(m.id),
          ...(typeof score === 'number' ? { score } : {}),
        };
      });

      const text = timelineEntries.length
        ? [
            `[Agy Mem · L2 Timeline (${timelineEntries.length} items, window=±${windowSize})]`,
            ...timelineEntries.map((entry) => {
              const marker = entry.isAnchorHit ? '★ HIT' : '· ctx';
              const filesTxt = entry.anchorFiles.length
                ? ` [files: ${entry.anchorFiles.slice(0, 3).join(', ')}]`
                : '';
              const convTxt = entry.sourceConversationId
                ? ` (session:${entry.sourceConversationId.slice(0, 12)})`
                : '';
              const scoreTxt = typeof entry.score === 'number' ? ` score=${entry.score}` : '';
              return `- ${entry.updatedAt} ${marker} [${entry.id}] (${entry.kind.toUpperCase()}${entry.pinned ? ' ★' : ''}${entry.drifted ? ' · DRIFTED' : ''}) ${entry.title}${filesTxt}${convTxt}${scoreTxt}\n  ${entry.excerpt}`;
            }),
            'Call mem_recall(mode="detail", ids=["<id>"]) to load full memory content.',
          ].join('\n')
        : ids.length > 0
          ? `No memories found for ids: ${ids.join(', ')}.`
          : `No memories matched "${query}".`;

      return {
        mode,
        query,
        ids,
        window: windowSize,
        totalHits: timelineEntries.length,
        text,
        indexEntries: [],
        timelineEntries,
        detailItems: [],
      };
    }

    // Layer 3: detail
    const detailItems: Array<MemoryItem & { score?: number }> =
      ids.length > 0
        ? this.getByIds(ids, {
            workspacePath: opts.workspacePath,
            incrementRecall: Boolean(opts.incrementRecall),
          }).map((m) => ({ ...m, score: 1 }))
        : this.recall(query, {
            workspacePath: opts.workspacePath,
            limit,
            incrementRecall: Boolean(opts.incrementRecall),
          });

    const text = detailItems.length
      ? detailItems
          .map((m, i) => {
            const anchorTxt = formatCompactAnchorList(m.anchors, 4);
            const scoreTxt = typeof m.score === 'number' ? ` (score ${m.score})` : '';
            return `${i + 1}. [${m.id}] [${m.kind.toUpperCase()}${m.pinned ? ' ★' : ''}${m.drifted ? ' · DRIFTED' : ''}] ${m.title}${anchorTxt}${scoreTxt}\n   ${m.content}`;
          })
          .join('\n')
      : ids.length > 0
        ? `No memories found for ids: ${ids.join(', ')}.`
        : `No memories matched "${query}".`;

    return {
      mode,
      query,
      ids,
      window: windowSize,
      totalHits: detailItems.length,
      text,
      indexEntries: [],
      timelineEntries: [],
      detailItems,
    };
  }
}
