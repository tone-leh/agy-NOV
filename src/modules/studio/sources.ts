import fs from 'node:fs';
import path from 'node:path';
import { redactPemBlocksLinear, redactSecretsLinear } from '../../core/sanitize.js';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';

// ============================================================================
// Constants & Security Limits
// ============================================================================

export const STUDIO_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap per inspected text/data file
const STUDIO_SQLITE_LIST_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB read-only CLI inspection cap for SQLite DBs
export const STUDIO_MAX_SCAN_FILES = 500;
export const STUDIO_MAX_SCAN_DEPTH = 6;

export const STUDIO_MAX_DATA_ROWS = 100;
export const STUDIO_DEFAULT_DATA_ROWS = 50;

const STUDIO_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  'secrets',
  'credentials',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
]);

const SENSITIVE_EXACT_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'master.key',
  'credentials',
  'service-account.json',
  'service_account.json',
]);

const SENSITIVE_DIR_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  'secrets',
  'credentials',
]);

const SKIP_JSON_LOCK_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
]);

// ============================================================================
// Public Types (Sources & Data Inspection Shared Contracts)
// ============================================================================

export type StudioSourceCategory = 'data' | 'document' | 'openapi';
export type StudioSourceFilterCategory = 'all' | StudioSourceCategory;

export type StudioSourceFormat =
  | 'sqlite'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'ndjson'
  | 'markdown'
  | 'text'
  | 'docx'
  | 'xlsx'
  | 'pdf'
  | 'html'
  | 'svg'
  | 'yaml'
  | 'xml'
  | 'openapi';

export interface StudioSourceItem {
  relPath: string;
  name: string;
  category: StudioSourceCategory;
  format: StudioSourceFormat;
  extension: string;
  bytes: number;
  updatedAt: string;
  oversized?: boolean;
}

export interface StudioSourcesResult {
  mode: 'live' | 'demo';
  workspaceRoot: string;
  sources: StudioSourceItem[];
  counts: {
    total: number;
    data: number;
    document: number;
    openapi: number;
  };
  skippedSensitive: number;
  skippedSymlinks: number;
  truncated: boolean;
}

export interface StudioSqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dfltValue: string | null;
}

export interface StudioSqliteTableSchema {
  name: string;
  type: 'table' | 'view';
  columns: StudioSqliteColumnInfo[];
}

export interface StudioDataResult {
  mode: 'live' | 'demo';
  filePath: string;
  format: 'csv' | 'tsv' | 'json' | 'ndjson' | 'sqlite';
  bytes: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  returnedRows: number;
  truncated: boolean;
  filter?: string;
  query?: string;
  summary: string;
  jsonSummary?: {
    rootType: 'array' | 'object' | 'primitive' | 'ndjson';
    topLevelKeys?: string[];
    itemCount: number;
    parseErrors?: number;
  };
  sqlite?: {
    sqliteCliAvailable: boolean;
    headerFormat?: string;
    pageSize?: number;
    tables: StudioSqliteTableSchema[];
    executedSql?: string;
    usedImmutableFallback?: boolean;
    note?: string;
  };
}

export interface StudioInspectDataOptions {
  filePath: string;
  query?: string;
  filter?: string;
  limit?: number;
  /** Internal override for testing sqlite3 CLI absence without touching PATH */
  sqliteBin?: string;
}

export interface ResolvedStudioFile {
  realRoot: string;
  realTarget: string;
  relPath: string;
  stat: fs.Stats;
}

// ============================================================================
// Secret Redaction & Path Security
// ============================================================================

const STUDIO_TAGGED_SECRET_RE = /\[REDACTED:[A-Z0-9_]+\]/g;
const STUDIO_URL_QUERY_RE = /(https?:\/\/[^\s"'<>?]+)(\?[^\s"'<>]+)/gi;

export function redactStudioSecrets(input: string): string {
  if (!input) return input;

  // Linear O(n) PEM private key block redaction shared from core sanitize kernel
  let out = redactPemBlocksLinear(input, '[REDACTED:PRIVATE_KEY]');

  // Cloud / VCS / LLM / SaaS tokens with Studio-specific typed redaction labels
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED:AWS_KEY]');
  out = out.replace(
    /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,})\b/g,
    '[REDACTED:GITHUB_TOKEN]',
  );
  out = out.replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:GOOGLE_API_KEY]');
  out = out.replace(
    /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{24,})\b/g,
    '[REDACTED:API_SECRET]',
  );
  out = out.replace(/\bxox[baprs]-[0-9A-Za-z-]{14,}\b/g, '[REDACTED:SLACK_TOKEN]');

  // Authorization header tokens inside text payloads (retains Studio's 8-char Basic floor)
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[REDACTED]');
  out = out.replace(/(\bBasic\s+)[A-Za-z0-9+/]{8,}={0,2}/gi, '$1[REDACTED]');

  // JSON secret fields (includes cookie / authorization / session field names)
  out = out.replace(
    /("(?:[^"\r\n]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|access[_-]?key|auth[_-]?token|cookie|authorization|session)[^"\r\n]*)"\s*:\s*")([^"\r\n]{4,})(")/gi,
    '$1[REDACTED]$3',
  );

  // URL query parameter secrets (includes signature & auth_token; preserves non-secret params & fragments)
  out = out.replace(
    /([?&](?:access[_-]?token|auth[_-]?token|token|api[_-]?key|key|secret|password|sig|signature)=)([^&#\s"']+)/gi,
    '$1[REDACTED]',
  );

  // Generic uppercase key=value secret assignments
  out = out.replace(
    /(\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_TOKEN|DB_PASSWORD|DATABASE_PASSWORD|CLIENT_SECRET)\s*[:=]\s*['"`]?)(?!\[REDACTED)([^\s'"`,;}&\r\n]{6,})(['"`]?)/gi,
    '$1[REDACTED]$3',
  );

  // Delegate remaining shared secret classes (webhooks, URL basic-auth, JWT, Telegram, generic KV)
  // to the unified linear kernel while preserving Studio-specific [REDACTED:*] tags and
  // already-sanitized non-webhook URL query strings (so non-secret params & #fragments stay intact).
  const sentinel = !out.includes('\x1e') ? '\x1e' : !out.includes('\x1f') ? '\x1f' : '';
  if (sentinel) {
    const saved: string[] = [];
    const stash = (value: string): string => {
      const idx = saved.push(value) - 1;
      return `;${sentinel}${idx}${sentinel};`;
    };
    let guarded = out.replace(STUDIO_URL_QUERY_RE, (full, base: string, query: string) => {
      if (full.toLowerCase().includes('webhook')) return full;
      const safeQuery = query
        .split(/([?&#])/)
        .map((part) => {
          if (!part || part === '?' || part === '&' || part === '#' || part.includes('[REDACTED')) {
            return part;
          }
          return redactSecretsLinear(part);
        })
        .join('');
      return `${base}${stash(safeQuery)}`;
    });
    guarded = guarded.replace(STUDIO_TAGGED_SECRET_RE, (tag) => stash(tag));
    const fallbackRedacted = redactSecretsLinear(guarded);
    if (saved.length > 0) {
      const restoreRe = new RegExp(`;${sentinel}(\\d+)${sentinel};`, 'g');
      out = fallbackRedacted.replace(restoreRe, (_m, idxStr: string) => {
        const idx = Number.parseInt(idxStr, 10);
        return saved[idx] ?? '[REDACTED]';
      });
    } else {
      out = fallbackRedacted;
    }
  } else {
    out = redactSecretsLinear(out);
  }

  return out;
}

export function isSensitiveStudioPath(relPathInput: string): boolean {
  if (!relPathInput) return false;
  const normalized = relPathInput.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return false;

  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (SENSITIVE_DIR_SEGMENTS.has(lower)) return true;
    if (lower.startsWith('.env')) return true;
    if (lower.startsWith('credentials')) return true;
    if (lower.includes('secret')) return true;
  }

  const base = path.posix.basename(normalized);
  const lowerBase = base.toLowerCase();
  if (SENSITIVE_EXACT_BASENAMES.has(lowerBase)) return true;
  if (
    lowerBase.startsWith('id_rsa.') ||
    lowerBase.startsWith('id_ed25519.') ||
    lowerBase.startsWith('id_dsa.') ||
    lowerBase.startsWith('id_ecdsa.')
  ) {
    return true;
  }
  if (/service[-_]?account.*\.json$/i.test(lowerBase)) return true;

  const ext = path.posix.extname(lowerBase);
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  // Catch double-extension sensitive files such as `config.env.csv` or `cert.pem.csv`
  if (/(?:\.env(?:$|\.)|\.(?:pem|key|p12|pfx|jks|keystore)(?:$|\.))/.test(lowerBase)) {
    return true;
  }

  return false;
}

export function resolveStudioWorkspaceFile(
  workspaceRoot: string,
  targetPath: string,
): ResolvedStudioFile {
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }
  if (!targetPath || !targetPath.trim() || targetPath.includes('\0')) {
    throw new Error('Invalid file path');
  }

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const cleanedTarget = targetPath.trim();
  const candidate = path.isAbsolute(cleanedTarget)
    ? path.resolve(cleanedTarget)
    : path.resolve(realRoot, cleanedTarget);

  // Check logical relative path before resolving symlinks
  if (!path.isAbsolute(cleanedTarget) && isSensitiveStudioPath(cleanedTarget)) {
    throw new Error(`Refused to access sensitive or restricted path: ${cleanedTarget}`);
  }
  const logicalRel = path.relative(realRoot, candidate).replace(/\\/g, '/');
  if (logicalRel && !logicalRel.startsWith('..') && isSensitiveStudioPath(logicalRel)) {
    throw new Error(`Refused to access sensitive or restricted path: ${logicalRel}`);
  }

  let realTarget: string;
  try {
    realTarget = canonicalRealpathSync(candidate);
  } catch {
    throw new Error(`File does not exist or cannot be resolved: ${cleanedTarget}`);
  }

  if (isSamePath(realRoot, realTarget) || !isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Path escapes workspace boundary: ${cleanedTarget}`);
  }

  const relPath = path.relative(realRoot, realTarget).replace(/\\/g, '/');
  if (isSensitiveStudioPath(relPath)) {
    throw new Error(`Refused to access sensitive or restricted path: ${relPath}`);
  }

  const stat = fs.statSync(realTarget);
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${relPath}`);
  }
  if (stat.size > STUDIO_MAX_FILE_BYTES) {
    throw new Error(
      `File exceeds 10 MiB Studio size limit (${stat.size} bytes > ${STUDIO_MAX_FILE_BYTES} bytes): ${relPath}`,
    );
  }

  return { realRoot, realTarget, relPath, stat };
}

// ============================================================================
// Shared Data Row Helpers (used by CSV/JSON/SQLite/Demo)
// ============================================================================

export function clampDataLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return STUDIO_DEFAULT_DATA_ROWS;
  return Math.max(1, Math.min(Math.floor(limit), STUDIO_MAX_DATA_ROWS));
}

export function sanitizeCellValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const clipped = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    return redactStudioSecrets(clipped);
  }
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    const clipped = serialized.length > 2000 ? `${serialized.slice(0, 2000)}…` : serialized;
    return redactStudioSecrets(clipped);
  } catch {
    return String(value);
  }
}

export function sanitizeRowRecord(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCellValue(v);
  }
  return out;
}

export function rowMatchesFilter(row: Record<string, unknown>, needleLower: string): boolean {
  for (const val of Object.values(row)) {
    if (val === null || val === undefined) continue;
    const text = typeof val === 'string' ? val : JSON.stringify(val);
    if (text.toLowerCase().includes(needleLower)) return true;
  }
  return false;
}

// ============================================================================
// Source Discovery (studio_list_sources)
// ============================================================================

function looksLikeOpenApiFile(realFilePath: string, baseLower: string, ext: string, bytes: number): boolean {
  if (ext !== '.yaml' && ext !== '.yml' && ext !== '.json') return false;
  if (/(?:^|[-_./])(?:openapi|swagger)(?:[-_.]|$)/i.test(baseLower)) {
    return true;
  }
  if (bytes === 0 || bytes > 256 * 1024) return false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(realFilePath, 'r');
    const probe = Buffer.alloc(Math.min(bytes, 2048));
    const n = fs.readSync(fd, probe, 0, probe.length, 0);
    const head = probe.subarray(0, n).toString('utf8');
    if (ext === '.json') {
      return /"(?:openapi|swagger)"\s*:\s*"[23]\./i.test(head);
    }
    return /^(?:openapi|swagger)\s*:\s*['"]?[23]\./m.test(head);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

function classifyStudioSource(
  realFilePath: string,
  baseName: string,
  bytes: number,
): { category: StudioSourceCategory; format: StudioSourceFormat; extension: string } | null {
  const lower = baseName.toLowerCase();
  const ext = path.extname(lower);
  if (!ext) return null;

  if (ext === '.json' && SKIP_JSON_LOCK_BASENAMES.has(lower)) {
    return null;
  }

  if (looksLikeOpenApiFile(realFilePath, lower, ext, bytes)) {
    return { category: 'openapi', format: 'openapi', extension: ext };
  }

  switch (ext) {
    case '.sqlite':
    case '.sqlite3':
    case '.db':
      return { category: 'data', format: 'sqlite', extension: ext };
    case '.csv':
      return { category: 'data', format: 'csv', extension: ext };
    case '.tsv':
      return { category: 'data', format: 'tsv', extension: ext };
    case '.json':
      return { category: 'data', format: 'json', extension: ext };
    case '.ndjson':
    case '.jsonl':
      return { category: 'data', format: 'ndjson', extension: ext };
    case '.md':
    case '.mdx':
      return { category: 'document', format: 'markdown', extension: ext };
    case '.txt':
      return { category: 'document', format: 'text', extension: ext };
    case '.docx':
      return { category: 'document', format: 'docx', extension: ext };
    case '.xlsx':
      return { category: 'document', format: 'xlsx', extension: ext };
    case '.pdf':
      return { category: 'document', format: 'pdf', extension: ext };
    case '.html':
    case '.htm':
      return { category: 'document', format: 'html', extension: ext };
    case '.svg':
      return { category: 'document', format: 'svg', extension: ext };
    case '.yaml':
    case '.yml':
      return { category: 'document', format: 'yaml', extension: ext };
    case '.xml':
      return { category: 'document', format: 'xml', extension: ext };
    default:
      return null;
  }
}

export function listStudioSources(
  workspaceRoot: string,
  opts: { category?: StudioSourceFilterCategory } = {},
): StudioSourcesResult {
  const category = opts.category ?? 'all';
  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const isInsideRoot = (realCandidate: string): boolean =>
    isPathInsideDir(realRoot, realCandidate);

  const allSources: StudioSourceItem[] = [];
  const visitedDirs = new Set<string>();
  const seenRealFiles = new Set<string>();
  let skippedSensitive = 0;
  let skippedSymlinks = 0;
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > STUDIO_MAX_SCAN_DEPTH || allSources.length >= STUDIO_MAX_SCAN_FILES) {
      if (allSources.length >= STUDIO_MAX_SCAN_FILES) truncated = true;
      return;
    }

    let realDir: string;
    try {
      realDir = canonicalRealpathSync(dir);
    } catch {
      skippedSymlinks += 1;
      return;
    }
    if (!isInsideRoot(realDir)) {
      skippedSymlinks += 1;
      return;
    }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (allSources.length >= STUDIO_MAX_SCAN_FILES) {
        truncated = true;
        break;
      }

      const fullPath = path.join(dir, entry.name);
      const rawRel = path.relative(realRoot, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (STUDIO_SKIP_DIRS.has(entry.name) || isSensitiveStudioPath(rawRel)) {
          if (isSensitiveStudioPath(rawRel)) skippedSensitive += 1;
          continue;
        }
        walk(fullPath, depth + 1);
        continue;
      }

      let realFilePath = fullPath;
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          realFilePath = canonicalRealpathSync(fullPath);
          if (!isInsideRoot(realFilePath)) {
            skippedSymlinks += 1;
            continue;
          }
          const st = fs.statSync(realFilePath);
          if (st.isDirectory()) {
            const realRelDir = path.relative(realRoot, realFilePath).replace(/\\/g, '/');
            if (
              STUDIO_SKIP_DIRS.has(path.basename(realFilePath)) ||
              isSensitiveStudioPath(rawRel) ||
              isSensitiveStudioPath(realRelDir)
            ) {
              skippedSensitive += 1;
              continue;
            }
            walk(realFilePath, depth + 1);
            continue;
          }
          isFile = st.isFile();
        } catch {
          skippedSymlinks += 1;
          continue;
        }
      }

      if (!isFile) continue;

      try {
        realFilePath = canonicalRealpathSync(realFilePath);
      } catch {
        skippedSymlinks += 1;
        continue;
      }
      if (!isInsideRoot(realFilePath)) {
        skippedSymlinks += 1;
        continue;
      }

      const realRel = path.relative(realRoot, realFilePath).replace(/\\/g, '/');
      if (isSensitiveStudioPath(rawRel) || isSensitiveStudioPath(realRel)) {
        skippedSensitive += 1;
        continue;
      }

      if (seenRealFiles.has(realFilePath)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(realFilePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const classified = classifyStudioSource(realFilePath, entry.name, stat.size);
      if (!classified) continue;

      seenRealFiles.add(realFilePath);
      allSources.push({
        relPath: rawRel,
        name: entry.name,
        category: classified.category,
        format: classified.format,
        extension: classified.extension,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        ...(stat.size >
        (classified.format === 'sqlite' ? STUDIO_SQLITE_LIST_MAX_BYTES : STUDIO_MAX_FILE_BYTES)
          ? { oversized: true }
          : {}),
      });
    }
  };

  walk(realRoot, 0);
  allSources.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const counts = {
    total: allSources.length,
    data: allSources.filter((s) => s.category === 'data').length,
    document: allSources.filter((s) => s.category === 'document').length,
    openapi: allSources.filter((s) => s.category === 'openapi').length,
  };

  const filtered =
    category === 'all' ? allSources : allSources.filter((s) => s.category === category);

  return {
    mode: 'live',
    workspaceRoot: realRoot,
    sources: filtered,
    counts,
    skippedSensitive,
    skippedSymlinks,
    truncated,
  };
}
