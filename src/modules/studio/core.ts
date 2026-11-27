import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createDemoOpenApiSpec,
  isLikelyOpenApiDocument,
  OPENAPI_MAX_FILE_BYTES,
  parseOpenApiSpecFromContent,
  type ParsedOpenApiSpec,
} from './openapi.js';

export {
  createDemoOpenApiSpec,
  OPENAPI_DEFAULT_LOOPBACK_BASE,
  OPENAPI_MAX_DEPTH,
  OPENAPI_MAX_ENDPOINTS,
  OPENAPI_MAX_FILE_BYTES,
  OPENAPI_MAX_YAML_LINES,
  parseOpenApiSpecFromContent,
  parseSafeYamlSubset,
  parseStudioOpenApiFile,
  type OpenApiEndpointItem,
  type OpenApiEndpointParameter,
  type OpenApiHttpMethod,
  type OpenApiServerEntry,
  type ParsedOpenApiSpec,
} from './openapi.js';

// ============================================================================
// Constants & Security Limits
// ============================================================================

export const STUDIO_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap per inspected file
export const STUDIO_MAX_SCAN_FILES = 500;
export const STUDIO_MAX_SCAN_DEPTH = 6;

export const STUDIO_MAX_DATA_ROWS = 100;
export const STUDIO_DEFAULT_DATA_ROWS = 50;
export const STUDIO_MAX_DOC_LINES = 200;
export const STUDIO_DEFAULT_DOC_LINES = 80;

export const STUDIO_ZIP_MAX_ENTRIES = 512;
export const STUDIO_ZIP_MAX_ENTRY_BYTES = 4 * 1024 * 1024; // 4 MiB per ZIP entry
export const STUDIO_ZIP_MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 6 MiB total inflated per ZIP
export const STUDIO_PDF_MAX_STREAM_BYTES = 2 * 1024 * 1024; // 2 MiB total inflated PDF streams

export const STUDIO_HTTP_MAX_BODY_BYTES = 64 * 1024; // 64 KiB cap for HTTP probe response body
export const STUDIO_HTTP_MIN_TIMEOUT_MS = 1000;
export const STUDIO_HTTP_MAX_TIMEOUT_MS = 15000;
export const STUDIO_HTTP_DEFAULT_TIMEOUT_MS = 5000;

export const STUDIO_SQLITE_TIMEOUT_MS = 4000;
export const STUDIO_SQLITE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

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

const ALLOWED_LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
  '::1',
]);

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-secret-key',
  'x-session-token',
  'private-token',
]);

const SENSITIVE_HEADER_SUBSTRINGS = [
  'authorization',
  'auth',
  'cookie',
  'session',
  'jwt',
  'api-key',
  'apikey',
  'auth-token',
  'access-token',
  'secret',
  'token',
  'password',
  'credential',
];

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
]);

const ALLOWED_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

// ============================================================================
// Public Types
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
    note?: string;
  };
}

export interface StudioDocumentOutlineItem {
  level: number;
  title: string;
  line: number;
  kind: string;
}

export interface StudioDocumentSheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
}

export interface StudioDocumentResult {
  mode: 'live' | 'demo';
  filePath: string;
  format: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json' | 'docx' | 'xlsx' | 'pdf';
  bytes: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  outline: StudioDocumentOutlineItem[];
  content: string;
  lines: string[];
  metadata: Record<string, unknown>;
  sheets?: StudioDocumentSheetPreview[];
  openApiSpec?: ParsedOpenApiSpec;
}

export interface StudioHttpProbeOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface StudioHttpProbeResult {
  mode: 'live' | 'demo';
  url: string;
  method: string;
  status: number;
  statusText: string;
  ok: boolean;
  elapsedMs: number;
  redirected: boolean;
  location?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  contentType: string;
  bodyText: string;
  bodyBytes: number;
  truncated: boolean;
}

export interface StudioInspectDataOptions {
  filePath: string;
  query?: string;
  filter?: string;
  limit?: number;
  /** Internal override for testing sqlite3 CLI absence without touching PATH */
  sqliteBin?: string;
}

export interface StudioInspectDocumentOptions {
  filePath: string;
  startLine?: number;
  maxLines?: number;
}

// ============================================================================
// Secret Redaction & Path Security
// ============================================================================

export function redactStudioSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  // PEM private key blocks (full or header-only)
  out = out.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    '[REDACTED:PRIVATE_KEY]',
  );
  out = out.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    '[REDACTED:PRIVATE_KEY]',
  );

  // Cloud / VCS / LLM / SaaS tokens
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

  // Authorization header tokens inside text payloads
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[REDACTED]');
  out = out.replace(/(\bBasic\s+)[A-Za-z0-9+/]{8,}={0,2}/gi, '$1[REDACTED]');

  // JSON secret fields
  out = out.replace(
    /("(?:[^"\r\n]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|access[_-]?key|auth[_-]?token|cookie|authorization|session)[^"\r\n]*)"\s*:\s*")([^"\r\n]{4,})(")/gi,
    '$1[REDACTED]$3',
  );

  // URL query parameter secrets
  out = out.replace(
    /([?&](?:access[_-]?token|auth[_-]?token|token|api[_-]?key|key|secret|password|sig|signature)=)([^&#\s"']+)/gi,
    '$1[REDACTED]',
  );

  // Generic key=value secret assignments
  out = out.replace(
    /(\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_TOKEN|DB_PASSWORD|DATABASE_PASSWORD|CLIENT_SECRET)\s*[:=]\s*['"`]?)(?!\[REDACTED)([^\s'"`,;}&\r\n]{6,})(['"`]?)/gi,
    '$1[REDACTED]$3',
  );

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

  return false;
}

export interface ResolvedStudioFile {
  realRoot: string;
  realTarget: string;
  relPath: string;
  stat: fs.Stats;
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

  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
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
    realTarget = fs.realpathSync(candidate);
  } catch {
    throw new Error(`File does not exist or cannot be resolved: ${cleanedTarget}`);
  }

  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realTarget === realRoot || !realTarget.startsWith(prefix)) {
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
  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  const isInsideRoot = (realCandidate: string): boolean =>
    realCandidate === realRoot || realCandidate.startsWith(rootPrefix);

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
      realDir = fs.realpathSync(dir);
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
          realFilePath = fs.realpathSync(fullPath);
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
        realFilePath = fs.realpathSync(realFilePath);
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
        ...(stat.size > STUDIO_MAX_FILE_BYTES ? { oversized: true } : {}),
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

// ============================================================================
// Data Inspector (CSV / TSV / JSON / NDJSON / SQLite Read-Only)
// ============================================================================

const SQLITE_FORBIDDEN_KEYWORDS_RE =
  /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE|LOAD_EXTENSION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|TRIGGER)\b/i;

const SQLITE_FORBIDDEN_FUNCTIONS_AND_VTABLES_RE =
  /\b(?:readfile|writefile|edit|fts3_tokenizer|load_extension|shell_putsnl|shell_temp_filename|shell_add_schema|shell_format_schema|shell_module_schema|shell_prompt_test|sqlar_compress|sqlar_uncompress|realpath|sha1_query|sha3_query|sqlite_compileoption_get|sqlite_compileoption_used|sqlite_log|usleep|fsdir|zipfile|zipfile_cds|sqlite_dbpage|sqlite_dbptr|sqlite_dbdata|sqlite_stmt|dbstat|completion|bytecode|tables_used|generate_series)\b/i;

const SQLITE_FORBIDDEN_PRAGMA_TVF_RE = /\bpragma_[a-z0-9_]+\b/i;

const SQLITE_ALLOWED_PREFIX_RE =
  /^(?:SELECT\b|EXPLAIN\s+QUERY\s+PLAN\s+SELECT\b|PRAGMA\s+table_info\s*\()/i;

const SQLITE_STRICT_PRAGMA_TABLE_INFO_RE =
  /^PRAGMA\s+table_info\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*|"[A-Za-z_][A-Za-z0-9_]*")\s*\)$/i;

/**
 * Lexes a SQLite query to strip single-quoted string literals ('...' with '' escapes)
 * and unwrap all SQLite identifier quotes ("...", [...], `...`) into whitespace-separated
 * tokens so quoted function/table-valued-function bypasses cannot evade inspection.
 */
function extractNormalizedSqliteIdentifiers(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted string literal: '...' (with '' escape) -> replace with space boundary
    if (ch === "'") {
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (i + 1 < sql.length && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        throw new Error('SQLite query contains an unterminated single-quoted string literal');
      }
      out += ' ';
      continue;
    }

    // Double-quoted identifier: "..." (with "" escape) -> unwrap with word boundaries
    if (ch === '"') {
      i += 1;
      let ident = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (i + 1 < sql.length && sql[i + 1] === '"') {
            ident += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        ident += sql[i];
        i += 1;
      }
      if (!closed) {
        throw new Error('SQLite query contains an unterminated double-quoted identifier');
      }
      out += ` ${ident.replace(/["[\]`]/g, '')} `;
      continue;
    }

    // Bracket-quoted identifier: [...] -> unwrap with word boundaries
    if (ch === '[') {
      i += 1;
      let ident = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === ']') {
          i += 1;
          closed = true;
          break;
        }
        ident += sql[i];
        i += 1;
      }
      if (!closed) {
        throw new Error('SQLite query contains an unterminated bracket-quoted identifier');
      }
      out += ` ${ident.replace(/["[\]`]/g, '')} `;
      continue;
    }

    // Backtick-quoted identifier: `...` (with `` escape) -> unwrap with word boundaries
    if (ch === '`') {
      i += 1;
      let ident = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '`') {
          if (i + 1 < sql.length && sql[i + 1] === '`') {
            ident += '`';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        ident += sql[i];
        i += 1;
      }
      if (!closed) {
        throw new Error('SQLite query contains an unterminated backtick-quoted identifier');
      }
      out += ` ${ident.replace(/["[\]`]/g, '')} `;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out.replace(/["[\]`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Strictly validates that a SQLite query is a single read-only statement.
 * Rejects multi-statements, comments, CLI dot-commands, write/DDL/transaction keywords,
 * quoted or unquoted host I/O & shell functions, virtual/internal page tables, and pragma_* TVFs.
 */
export function validateReadOnlySqliteQuery(rawSql: string): string {
  if (typeof rawSql !== 'string') {
    throw new Error('SQLite query must be a string');
  }
  if (rawSql.includes('\0')) {
    throw new Error('SQLite query must not contain null bytes');
  }
  const trimmed = rawSql.trim();
  if (!trimmed) {
    throw new Error('SQLite query must not be empty');
  }
  if (trimmed.length > 4000) {
    throw new Error('SQLite query exceeds maximum length (4000 characters)');
  }

  // Strip at most ONE trailing semicolon
  const stripped = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed;
  if (!stripped) {
    throw new Error('SQLite query must not be empty');
  }

  // Disallow any remaining semicolon anywhere (prevents stacked statements)
  if (stripped.includes(';')) {
    throw new Error('SQLite read-only policy blocks multiple statements or embedded semicolons');
  }

  // Disallow SQL comments that can mask stacked statements or bypass inspection
  if (stripped.includes('--') || stripped.includes('/*') || stripped.includes('*/')) {
    throw new Error('SQLite read-only policy blocks SQL comments (-- or /* */)');
  }

  // Disallow sqlite3 CLI dot-commands on any line (including Unicode line breaks)
  if (/(?:^|[\r\n\u0085\u2028\u2029])\s*\./.test(stripped)) {
    throw new Error('SQLite read-only policy blocks sqlite3 CLI dot-commands');
  }

  // Collapse line breaks into single spaces so CLI cannot treat any line as a dot-command
  const normalized = stripped
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!SQLITE_ALLOWED_PREFIX_RE.test(normalized)) {
    throw new Error(
      'SQLite query must start with SELECT, EXPLAIN QUERY PLAN SELECT, or PRAGMA table_info(...)',
    );
  }

  const isTopLevelPragma = /^PRAGMA\b/i.test(normalized);
  if (isTopLevelPragma && !SQLITE_STRICT_PRAGMA_TABLE_INFO_RE.test(normalized)) {
    throw new Error('Only PRAGMA table_info(<table_name>) is permitted in read-only mode');
  }

  // Normalize identifiers by stripping single-quoted literals and removing identifier quotes
  const normalizedIdentifiers = extractNormalizedSqliteIdentifiers(normalized);
  const inspectionViews = [normalized, normalizedIdentifiers];

  for (const view of inspectionViews) {
    if (SQLITE_FORBIDDEN_KEYWORDS_RE.test(view)) {
      throw new Error(
        'SQLite read-only policy blocked a write, DDL, transaction, or extension keyword',
      );
    }

    if (SQLITE_FORBIDDEN_FUNCTIONS_AND_VTABLES_RE.test(view)) {
      throw new Error(
        'SQLite read-only policy blocked a restricted host I/O function, virtual table, or internal diagnostic table',
      );
    }

    if (SQLITE_FORBIDDEN_PRAGMA_TVF_RE.test(view)) {
      throw new Error('SQLite read-only policy blocked pragma_* table-valued function');
    }

    // Block any PRAGMA keyword inside SELECT / EXPLAIN QUERY PLAN statements
    if (!isTopLevelPragma && /\bPRAGMA\b/i.test(view)) {
      throw new Error('SQLite read-only policy blocked embedded PRAGMA');
    }
  }

  return normalized;
}

function clampDataLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return STUDIO_DEFAULT_DATA_ROWS;
  return Math.max(1, Math.min(Math.floor(limit), STUDIO_MAX_DATA_ROWS));
}

function sanitizeCellValue(value: unknown): unknown {
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

function sanitizeRowRecord(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCellValue(v);
  }
  return out;
}

function rowMatchesFilter(row: Record<string, unknown>, needleLower: string): boolean {
  for (const val of Object.values(row)) {
    if (val === null || val === undefined) continue;
    const text = typeof val === 'string' ? val : JSON.stringify(val);
    if (text.toLowerCase().includes(needleLower)) return true;
  }
  return false;
}

/**
 * Linear-time RFC-4180 CSV/TSV parser supporting quoted fields, embedded commas/newlines,
 * and escaped double-quotes (""). Zero regex backtracking.
 */
export function parseDelimitedRecords(rawText: string, delimiter: ',' | '\t'): string[][] {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      i += i + 1 < text.length && text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // Drop trailing single empty line from final newline
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') {
      records.pop();
    } else {
      break;
    }
  }

  return records;
}

function inspectCsvOrTsv(
  relPath: string,
  format: 'csv' | 'tsv',
  buf: Buffer,
  bytes: number,
  filter: string | undefined,
  limit: number,
): StudioDataResult {
  const delimiter = format === 'tsv' ? '\t' : ',';
  const records = parseDelimitedRecords(buf.toString('utf8'), delimiter);
  if (records.length === 0) {
    return {
      mode: 'live',
      filePath: relPath,
      format,
      bytes,
      columns: [],
      rows: [],
      totalRows: 0,
      returnedRows: 0,
      truncated: false,
      filter,
      summary: `${relPath} (${format.toUpperCase()}): empty file (0 rows).`,
    };
  }

  // Deduplicate and normalize header columns
  const rawHeader = records[0];
  const usedHeaders = new Map<string, number>();
  const columns: string[] = rawHeader.map((h, idx) => {
    const base = h.trim() || `col_${idx + 1}`;
    const prev = usedHeaders.get(base) ?? 0;
    usedHeaders.set(base, prev + 1);
    return prev === 0 ? base : `${base}_${prev + 1}`;
  });

  const needle = filter?.trim().toLowerCase() || '';
  let totalRows = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let rIdx = 1; rIdx < records.length; rIdx += 1) {
    const rec = records[rIdx];
    const obj: Record<string, unknown> = {};
    const maxCols = Math.max(columns.length, rec.length);
    for (let cIdx = 0; cIdx < maxCols; cIdx += 1) {
      if (cIdx >= columns.length) {
        columns.push(`col_${cIdx + 1}`);
      }
      obj[columns[cIdx]] = sanitizeCellValue(rec[cIdx] ?? '');
    }

    if (needle && !rowMatchesFilter(obj, needle)) {
      continue;
    }
    totalRows += 1;
    if (rows.length < limit) {
      rows.push(obj);
    }
  }

  return {
    mode: 'live',
    filePath: relPath,
    format,
    bytes,
    columns,
    rows,
    totalRows,
    returnedRows: rows.length,
    truncated: totalRows > rows.length,
    filter: filter?.trim() || undefined,
    summary: `${relPath} (${format.toUpperCase()}): ${columns.length} column(s), ${totalRows} matching row(s), showing ${rows.length}.`,
  };
}

function inspectJsonOrNdjson(
  relPath: string,
  format: 'json' | 'ndjson',
  buf: Buffer,
  bytes: number,
  filter: string | undefined,
  limit: number,
): StudioDataResult {
  const text = buf.toString('utf8');
  const needle = filter?.trim().toLowerCase() || '';

  if (format === 'ndjson') {
    const rawLines = text.split(/\r?\n/);
    const colSet = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let totalValidItems = 0;
    let totalMatched = 0;
    let parseErrors = 0;

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parseErrors += 1;
        continue;
      }
      totalValidItems += 1;
      const record: Record<string, unknown> =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? sanitizeRowRecord(parsed as Record<string, unknown>)
          : { value: sanitizeCellValue(parsed) };

      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        for (const key of Object.keys(record)) colSet.add(key);
        rows.push(record);
      }
    }

    const columns = Array.from(colSet);
    return {
      mode: 'live',
      filePath: relPath,
      format: 'ndjson',
      bytes,
      columns,
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (NDJSON): ${totalValidItems} record(s), ${totalMatched} matched, showing ${rows.length}${parseErrors > 0 ? ` (${parseErrors} parse errors skipped)` : ''}.`,
      jsonSummary: {
        rootType: 'ndjson',
        itemCount: totalValidItems,
        parseErrors,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (Array.isArray(parsed)) {
    const colSet = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let totalMatched = 0;

    for (let i = 0; i < parsed.length; i += 1) {
      const item = parsed[i];
      const record: Record<string, unknown> =
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeRowRecord(item as Record<string, unknown>)
          : { index: i, value: sanitizeCellValue(item) };

      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        for (const key of Object.keys(record)) colSet.add(key);
        rows.push(record);
      }
    }

    return {
      mode: 'live',
      filePath: relPath,
      format: 'json',
      bytes,
      columns: Array.from(colSet),
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (JSON Array): ${parsed.length} item(s), ${totalMatched} matched, showing ${rows.length}.`,
      jsonSummary: {
        rootType: 'array',
        itemCount: parsed.length,
      },
    };
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const topLevelKeys = Object.keys(obj);
    const rows: Array<Record<string, unknown>> = [];
    let totalMatched = 0;

    for (const key of topLevelKeys) {
      const val = obj[key];
      const valType = Array.isArray(val)
        ? `array(${val.length})`
        : val === null
          ? 'null'
          : typeof val;
      const preview = sanitizeCellValue(val);
      const record: Record<string, unknown> = { key, type: valType, preview };
      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        rows.push(record);
      }
    }

    return {
      mode: 'live',
      filePath: relPath,
      format: 'json',
      bytes,
      columns: ['key', 'type', 'preview'],
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (JSON Object): ${topLevelKeys.length} top-level key(s), showing ${rows.length}.`,
      jsonSummary: {
        rootType: 'object',
        topLevelKeys: topLevelKeys.slice(0, 100),
        itemCount: topLevelKeys.length,
      },
    };
  }

  return {
    mode: 'live',
    filePath: relPath,
    format: 'json',
    bytes,
    columns: ['value'],
    rows: [{ value: sanitizeCellValue(parsed) }],
    totalRows: 1,
    returnedRows: 1,
    truncated: false,
    filter: filter?.trim() || undefined,
    summary: `${relPath} (JSON Primitive): 1 value.`,
    jsonSummary: {
      rootType: 'primitive',
      itemCount: 1,
    },
  };
}

function readSqliteHeaderMetadata(realFilePath: string): {
  validHeader: boolean;
  headerFormat: string;
  pageSize?: number;
} {
  let fd: number | null = null;
  try {
    fd = fs.openSync(realFilePath, 'r');
    const header = Buffer.alloc(100);
    const bytesRead = fs.readSync(fd, header, 0, 100, 0);
    if (bytesRead < 16) {
      return { validHeader: false, headerFormat: 'unknown' };
    }
    const magic = header.subarray(0, 16).toString('ascii');
    if (magic !== 'SQLite format 3\0') {
      return { validHeader: false, headerFormat: magic.replace(/\0/g, '') || 'unknown' };
    }
    const rawPageSize = bytesRead >= 18 ? header.readUInt16BE(16) : 0;
    const pageSize = rawPageSize === 1 ? 65536 : rawPageSize || undefined;
    return { validHeader: true, headerFormat: 'SQLite format 3', pageSize };
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

const SQLITE_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

function assertSafeSqliteCompanionFiles(realRoot: string, realDbPath: string): void {
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;

  for (const suffix of SQLITE_COMPANION_SUFFIXES) {
    const companionPath = `${realDbPath}${suffix}`;
    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(companionPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      throw new Error(
        `Refused to open SQLite database: companion file (${suffix}) could not be inspected: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (lstat.isSymbolicLink()) {
      throw new Error(
        `Refused to open SQLite database: companion file "${path.basename(companionPath)}" is a symbolic link`,
      );
    }
    if (!lstat.isFile()) {
      throw new Error(
        `Refused to open SQLite database: companion file "${path.basename(companionPath)}" is not a regular file`,
      );
    }

    let realCompanion: string;
    try {
      realCompanion = fs.realpathSync(companionPath);
    } catch (err) {
      throw new Error(
        `Refused to open SQLite database: companion file "${path.basename(companionPath)}" could not be resolved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (realCompanion === realRoot || !realCompanion.startsWith(rootPrefix)) {
      throw new Error(
        `Refused to open SQLite database: companion file "${path.basename(companionPath)}" escapes workspace boundary`,
      );
    }

    const companionRel = path.relative(realRoot, realCompanion).replace(/\\/g, '/');
    if (isSensitiveStudioPath(companionRel)) {
      throw new Error(
        `Refused to open SQLite database: companion file "${companionRel}" points to a sensitive path`,
      );
    }
  }
}

function execSqliteJson(
  sqliteBin: string,
  realRoot: string,
  realPath: string,
  sql: string,
): Promise<{ cliAvailable: boolean; rows: Array<Record<string, unknown>> }> {
  assertSafeSqliteCompanionFiles(realRoot, realPath);

  const runExec = (
    useSafeFlag: boolean,
  ): Promise<{ cliAvailable: boolean; rows: Array<Record<string, unknown>> }> =>
    new Promise((resolve, reject) => {
      const args = useSafeFlag
        ? ['-safe', '-readonly', '-json', '-cmd', '.timeout 3000', '--', realPath, sql]
        : ['-readonly', '-json', '-cmd', '.timeout 3000', '--', realPath, sql];

      execFile(
        sqliteBin,
        args,
        {
          shell: false,
          timeout: STUDIO_SQLITE_TIMEOUT_MS,
          maxBuffer: STUDIO_SQLITE_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (err, stdout, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
              resolve({ cliAvailable: false, rows: [] });
              return;
            }
            const detail = (stderr || err.message || 'sqlite3 execution failed').trim();
            // Graceful fallback for older sqlite3 binaries (< 3.42) that do not support -safe;
            // validateReadOnlySqliteQuery has already blocked all dangerous functions/vtables.
            if (useSafeFlag && /unknown option:\s*-{1,2}safe\b/i.test(detail)) {
              runExec(false).then(resolve, reject);
              return;
            }
            reject(new Error(`SQLite query failed: ${redactStudioSecrets(detail)}`));
            return;
          }
          const trimmed = (stdout || '').trim();
          if (!trimmed) {
            resolve({ cliAvailable: true, rows: [] });
            return;
          }
          try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) {
              resolve({ cliAvailable: true, rows: [] });
              return;
            }
            resolve({
              cliAvailable: true,
              rows: parsed.filter(
                (item): item is Record<string, unknown> =>
                  Boolean(item) && typeof item === 'object' && !Array.isArray(item),
              ),
            });
          } catch (parseErr) {
            // sqlite3 CLI formats EXPLAIN QUERY PLAN as plain tree text even under -json
            if (/^EXPLAIN\s+QUERY\s+PLAN\b/i.test(sql)) {
              const planLines = trimmed
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.length > 0 && line !== 'QUERY PLAN');
              resolve({
                cliAvailable: true,
                rows: planLines.map((detail, idx) => ({ step: idx + 1, detail })),
              });
              return;
            }
            reject(
              new Error(
                `Failed to parse sqlite3 JSON output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
              ),
            );
          }
        },
      );
    });

  return runExec(true);
}

function quoteSqliteIdentifier(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function inspectSqliteDatabase(
  realRoot: string,
  realPath: string,
  relPath: string,
  bytes: number,
  query: string | undefined,
  filter: string | undefined,
  limit: number,
  sqliteBin: string,
): Promise<StudioDataResult> {
  // Always validate user query first before touching sqlite3 CLI
  const safeSql = query && query.trim() ? validateReadOnlySqliteQuery(query) : undefined;

  // Reject symlinked or out-of-workspace companion files (-wal, -shm, -journal) before opening DB
  assertSafeSqliteCompanionFiles(realRoot, realPath);

  const headerInfo = readSqliteHeaderMetadata(realPath);
  if (!headerInfo.validHeader) {
    throw new Error(`File is not a valid SQLite 3 database: ${relPath}`);
  }

  // Schema discovery via sqlite_master + PRAGMA table_info
  const masterRes = await execSqliteJson(
    sqliteBin,
    realRoot,
    realPath,
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name LIMIT 50",
  );

  if (!masterRes.cliAvailable) {
    return {
      mode: 'live',
      filePath: relPath,
      format: 'sqlite',
      bytes,
      columns: ['property', 'value'],
      rows: [
        { property: 'headerFormat', value: headerInfo.headerFormat },
        { property: 'pageSize', value: headerInfo.pageSize ?? 'unknown' },
        { property: 'bytes', value: bytes },
      ],
      totalRows: 3,
      returnedRows: 3,
      truncated: false,
      query: safeSql,
      summary: `${relPath} (SQLite 3): sqlite3 CLI unavailable on PATH; returned 100-byte header metadata only.`,
      sqlite: {
        sqliteCliAvailable: false,
        headerFormat: headerInfo.headerFormat,
        pageSize: headerInfo.pageSize,
        tables: [],
        note: 'sqlite3 CLI was not found on PATH. Install sqlite3 to inspect table schemas and run read-only SELECT queries.',
      },
    };
  }

  const tables: StudioSqliteTableSchema[] = [];
  for (const row of masterRes.rows.slice(0, 30)) {
    const name = typeof row.name === 'string' ? row.name : '';
    const type = row.type === 'view' ? 'view' : 'table';
    if (!name || name.includes('\0')) continue;
    const pragmaSql = `PRAGMA table_info(${quoteSqliteIdentifier(name)})`;
    const colRes = await execSqliteJson(sqliteBin, realRoot, realPath, pragmaSql);
    const columns: StudioSqliteColumnInfo[] = colRes.rows.map((c) => ({
      cid: Number(c.cid ?? 0),
      name: String(c.name ?? ''),
      type: String(c.type ?? ''),
      notnull: Boolean(c.notnull),
      pk: Boolean(c.pk),
      dfltValue: c.dflt_value === null || c.dflt_value === undefined ? null : String(c.dflt_value),
    }));
    tables.push({ name, type, columns });
  }

  // No custom query -> return schema overview
  if (!safeSql) {
    const needle = filter?.trim().toLowerCase() || '';
    const schemaRows = tables
      .map((t) => ({
        name: t.name,
        type: t.type,
        columnCount: t.columns.length,
        columns: t.columns.map((c) => `${c.name}${c.type ? ` (${c.type})` : ''}${c.pk ? ' PK' : ''}`).join(', '),
      }))
      .filter((r) => (!needle ? true : rowMatchesFilter(r, needle)));

    const sliced = schemaRows.slice(0, limit);
    return {
      mode: 'live',
      filePath: relPath,
      format: 'sqlite',
      bytes,
      columns: ['name', 'type', 'columnCount', 'columns'],
      rows: sliced,
      totalRows: schemaRows.length,
      returnedRows: sliced.length,
      truncated: schemaRows.length > sliced.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (SQLite 3): ${tables.length} table(s)/view(s) discovered (read-only schema view).`,
      sqlite: {
        sqliteCliAvailable: true,
        headerFormat: headerInfo.headerFormat,
        pageSize: headerInfo.pageSize,
        tables,
      },
    };
  }

  // Execute validated read-only SQL with bounded row limit
  const isDirectSelect = /^SELECT\b/i.test(safeSql);
  const wrappedSql = isDirectSelect
    ? `SELECT * FROM (${safeSql}) LIMIT ${limit + 1}`
    : safeSql;

  const queryRes = await execSqliteJson(sqliteBin, realRoot, realPath, wrappedSql);
  const needle = filter?.trim().toLowerCase() || '';

  const sanitizedAll = queryRes.rows.map(sanitizeRowRecord);
  const filteredRows = needle
    ? sanitizedAll.filter((r) => rowMatchesFilter(r, needle))
    : sanitizedAll;

  const truncated = filteredRows.length > limit;
  const rows = filteredRows.slice(0, limit);
  const colSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) colSet.add(k);
  }

  return {
    mode: 'live',
    filePath: relPath,
    format: 'sqlite',
    bytes,
    columns: Array.from(colSet),
    rows,
    totalRows: truncated ? limit + 1 : filteredRows.length,
    returnedRows: rows.length,
    truncated,
    filter: filter?.trim() || undefined,
    query: safeSql,
    summary: `${relPath} (SQLite 3 read-only query): returned ${rows.length} row(s)${truncated ? ` (truncated at limit ${limit})` : ''}.`,
    sqlite: {
      sqliteCliAvailable: true,
      headerFormat: headerInfo.headerFormat,
      pageSize: headerInfo.pageSize,
      tables,
      executedSql: wrappedSql,
    },
  };
}

export async function inspectStudioData(
  workspaceRoot: string,
  opts: StudioInspectDataOptions,
): Promise<StudioDataResult> {
  const resolved = resolveStudioWorkspaceFile(workspaceRoot, opts.filePath);
  const ext = path.extname(resolved.relPath).toLowerCase();
  const limit = clampDataLimit(opts.limit);

  if (ext === '.sqlite' || ext === '.sqlite3' || ext === '.db') {
    return inspectSqliteDatabase(
      resolved.realRoot,
      resolved.realTarget,
      resolved.relPath,
      resolved.stat.size,
      opts.query,
      opts.filter,
      limit,
      opts.sqliteBin ?? 'sqlite3',
    );
  }

  if (ext === '.csv' || ext === '.tsv') {
    const buf = fs.readFileSync(resolved.realTarget);
    return inspectCsvOrTsv(
      resolved.relPath,
      ext === '.tsv' ? 'tsv' : 'csv',
      buf,
      resolved.stat.size,
      opts.filter,
      limit,
    );
  }

  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') {
    const buf = fs.readFileSync(resolved.realTarget);
    return inspectJsonOrNdjson(
      resolved.relPath,
      ext === '.json' ? 'json' : 'ndjson',
      buf,
      resolved.stat.size,
      opts.filter,
      limit,
    );
  }

  throw new Error(
    `Unsupported data format "${ext || '(none)'}" for studio_inspect_data (supported: .csv, .tsv, .json, .ndjson, .jsonl, .sqlite, .sqlite3, .db)`,
  );
}

// ============================================================================
// Pure-Node Zero-Dependency Document Slicer (MD / TXT / HTML / SVG / YAML / XML / DOCX / XLSX / PDF)
// ============================================================================

interface ZipCentralEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

class ReadOnlyZipArchive {
  private readonly buf: Buffer;
  private readonly entries = new Map<string, ZipCentralEntry>();
  private totalInflatedBytes = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.parseCentralDirectory();
  }

  private parseCentralDirectory(): void {
    if (this.buf.length < 22) {
      throw new Error('Invalid ZIP archive: file too small');
    }

    // Locate End of Central Directory (EOCD) signature 0x06054b50 within trailing 64 KiB + 22 bytes
    const minOffset = Math.max(0, this.buf.length - 65557);
    let eocdOffset = -1;
    for (let pos = this.buf.length - 22; pos >= minOffset; pos -= 1) {
      if (this.buf.readUInt32LE(pos) === 0x06054b50) {
        const commentLen = this.buf.readUInt16LE(pos + 20);
        if (pos + 22 + commentLen === this.buf.length) {
          eocdOffset = pos;
          break;
        }
      }
    }

    if (eocdOffset < 0) {
      throw new Error('Invalid ZIP archive: End of Central Directory record not found');
    }

    const entryCount = this.buf.readUInt16LE(eocdOffset + 10);
    const cdSize = this.buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = this.buf.readUInt32LE(eocdOffset + 16);

    if (entryCount > STUDIO_ZIP_MAX_ENTRIES) {
      throw new Error(
        `ZIP security guard rejected archive: entry count ${entryCount} exceeds limit (${STUDIO_ZIP_MAX_ENTRIES})`,
      );
    }

    if (cdOffset + cdSize > eocdOffset) {
      throw new Error('Invalid ZIP archive: central directory bounds exceed file size');
    }

    let offset = cdOffset;
    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > cdOffset + cdSize) {
        throw new Error('Invalid ZIP archive: truncated central directory entry');
      }
      if (this.buf.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('Invalid ZIP archive: corrupt central directory signature');
      }

      const compressionMethod = this.buf.readUInt16LE(offset + 10);
      const compressedSize = this.buf.readUInt32LE(offset + 20);
      const uncompressedSize = this.buf.readUInt32LE(offset + 24);
      const fileNameLen = this.buf.readUInt16LE(offset + 28);
      const extraLen = this.buf.readUInt16LE(offset + 30);
      const commentLen = this.buf.readUInt16LE(offset + 32);
      const localHeaderOffset = this.buf.readUInt32LE(offset + 42);

      if (uncompressedSize > STUDIO_ZIP_MAX_ENTRY_BYTES) {
        throw new Error(
          `ZIP security guard rejected entry exceeding 4 MiB uncompressed limit (${uncompressedSize} bytes)`,
        );
      }

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLen;
      if (nameEnd + extraLen + commentLen > cdOffset + cdSize) {
        throw new Error('Invalid ZIP archive: central directory entry exceeds directory length');
      }

      const name = this.buf.subarray(nameStart, nameEnd).toString('utf8');
      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset = nameEnd + extraLen + commentLen;
    }
  }

  listEntryNames(): string[] {
    return Array.from(this.entries.keys());
  }

  hasEntry(name: string): boolean {
    return this.entries.has(name);
  }

  readEntryBuffer(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`ZIP entry not found: ${name}`);
    }

    const lfh = entry.localHeaderOffset;
    if (lfh + 30 > this.buf.length || this.buf.readUInt32LE(lfh) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local file header for entry: ${name}`);
    }

    const localNameLen = this.buf.readUInt16LE(lfh + 26);
    const localExtraLen = this.buf.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > this.buf.length) {
      throw new Error(`ZIP entry data out of bounds: ${name}`);
    }

    const remainingTotal = STUDIO_ZIP_MAX_TOTAL_BYTES - this.totalInflatedBytes;
    const maxAllowed = Math.min(STUDIO_ZIP_MAX_ENTRY_BYTES, remainingTotal);
    if (maxAllowed <= 0) {
      throw new Error(
        `ZIP security guard rejected archive: total inflated bytes exceeded ${STUDIO_ZIP_MAX_TOTAL_BYTES} bytes`,
      );
    }

    const compressedSlice = this.buf.subarray(dataStart, dataEnd);
    let output: Buffer;

    if (entry.compressionMethod === 0) {
      if (compressedSlice.length > maxAllowed) {
        throw new Error(
          `ZIP security guard rejected stored entry exceeding limit (${compressedSlice.length} > ${maxAllowed})`,
        );
      }
      output = Buffer.from(compressedSlice);
    } else if (entry.compressionMethod === 8) {
      try {
        output = zlib.inflateRawSync(compressedSlice, { maxOutputLength: maxAllowed });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ERR_BUFFER_TOO_LARGE') {
          throw new Error(
            `ZIP bomb protection triggered while inflating "${name}": decompressed output exceeded security cap (${maxAllowed} bytes)`,
          );
        }
        throw new Error(
          `Failed to inflate ZIP entry "${name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${name}"`);
    }

    this.totalInflatedBytes += output.length;
    if (this.totalInflatedBytes > STUDIO_ZIP_MAX_TOTAL_BYTES) {
      throw new Error(
        `ZIP security guard rejected archive: total inflated size exceeded ${STUDIO_ZIP_MAX_TOTAL_BYTES} bytes`,
      );
    }

    return output;
  }

  readEntryText(name: string): string {
    return this.readEntryBuffer(name).toString('utf8');
  }
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function sliceLines(
  allLines: string[],
  startLineInput?: number,
  maxLinesInput?: number,
): { startLine: number; endLine: number; truncated: boolean; lines: string[]; content: string } {
  const total = allLines.length;
  const maxLines = Math.max(
    1,
    Math.min(
      typeof maxLinesInput === 'number' && Number.isFinite(maxLinesInput)
        ? Math.floor(maxLinesInput)
        : STUDIO_DEFAULT_DOC_LINES,
      STUDIO_MAX_DOC_LINES,
    ),
  );
  const startLine = Math.max(
    1,
    typeof startLineInput === 'number' && Number.isFinite(startLineInput)
      ? Math.floor(startLineInput)
      : 1,
  );

  if (total === 0) {
    return { startLine: 1, endLine: 0, truncated: false, lines: [], content: '' };
  }

  const clampedStart = Math.min(startLine, total);
  const sliceEndExclusive = Math.min(total, clampedStart - 1 + maxLines);
  const rawSlice = allLines.slice(clampedStart - 1, sliceEndExclusive);
  const redactedSlice = rawSlice.map((line) => redactStudioSecrets(line));
  const endLine = clampedStart + redactedSlice.length - 1;

  return {
    startLine: clampedStart,
    endLine,
    truncated: sliceEndExclusive < total,
    lines: redactedSlice,
    content: redactedSlice.join('\n'),
  };
}

function extractTextOutline(
  format: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json',
  lines: string[],
): StudioDocumentOutlineItem[] {
  const outline: StudioDocumentOutlineItem[] = [];
  const push = (item: StudioDocumentOutlineItem) => {
    if (outline.length < 100) {
      outline.push({ ...item, title: redactStudioSecrets(item.title).slice(0, 140) });
    }
  };

  if (format === 'json') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const topKey = /^\s{1,2}"([^"]+)"\s*:/.exec(line);
      if (topKey) {
        push({ level: 1, title: topKey[1], line: i + 1, kind: 'key' });
        continue;
      }
      const pathKey = /^\s{3,6}"(\/[^"]+)"\s*:/.exec(line);
      if (pathKey) {
        push({ level: 2, title: pathKey[1], line: i + 1, kind: 'endpoint' });
      }
    }
    return outline;
  }

  if (format === 'markdown') {
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (m) {
        push({ level: m[1].length, title: m[2].trim(), line: i + 1, kind: 'heading' });
      }
    }
    return outline;
  }

  if (format === 'yaml') {
    let inPaths = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const top = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
      if (top) {
        inPaths = top[1] === 'paths';
        push({ level: 1, title: top[1], line: i + 1, kind: 'section' });
        continue;
      }
      if (inPaths) {
        const ep = /^\s{2}('\/[^']+'|"\/[^"]+"|\/[^\s:]+)\s*:/.exec(line);
        if (ep) {
          push({ level: 2, title: ep[1].replace(/^['"]|['"]$/g, ''), line: i + 1, kind: 'endpoint' });
        }
      }
    }
    return outline;
  }

  if (format === 'html') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(line);
      if (titleMatch) {
        push({ level: 1, title: decodeXmlEntities(titleMatch[1].trim()), line: i + 1, kind: 'title' });
      }
      const hMatch = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(line);
      if (hMatch) {
        const clean = decodeXmlEntities(hMatch[2].replace(/<[^>]+>/g, '').trim());
        if (clean) {
          push({ level: Number(hMatch[1]), title: clean, line: i + 1, kind: `h${hMatch[1]}` });
        }
      }
    }
    return outline;
  }

  if (format === 'svg') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const tMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(line);
      if (tMatch) {
        push({ level: 1, title: decodeXmlEntities(tMatch[1].trim()), line: i + 1, kind: 'title' });
      }
      const gMatch = /<(?:svg|g|symbol)\b[^>]*\bid=["']([^"']+)["']/i.exec(line);
      if (gMatch) {
        push({ level: 2, title: `#${gMatch[1]}`, line: i + 1, kind: 'group' });
      }
    }
    return outline;
  }

  if (format === 'xml') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const tagMatch = /^(\s*)<([A-Za-z_][A-Za-z0-9_.:-]*)\b(?![/?!])/.exec(line);
      if (tagMatch && tagMatch[1].length <= 4) {
        const level = tagMatch[1].length === 0 ? 1 : 2;
        push({ level, title: `<${tagMatch[2]}>`, line: i + 1, kind: 'element' });
      }
    }
    return outline;
  }

  // Plain text: detect section-like headings or first non-empty line of paragraphs
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (i === 0 || (lines[i - 1]?.trim() === '' && trimmed.length <= 90)) {
      push({ level: i === 0 ? 1 : 2, title: trimmed, line: i + 1, kind: 'paragraph' });
    }
  }
  return outline;
}

function parseDocxDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const zip = new ReadOnlyZipArchive(buf);
  if (!zip.hasEntry('word/document.xml')) {
    throw new Error(`Invalid DOCX file (missing word/document.xml): ${relPath}`);
  }

  const docXml = zip.readEntryText('word/document.xml');
  const metadata: Record<string, unknown> = {
    entryCount: zip.listEntryNames().length,
  };

  if (zip.hasEntry('docProps/core.xml')) {
    try {
      const coreXml = zip.readEntryText('docProps/core.xml');
      const titleMatch = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreXml);
      const creatorMatch = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(coreXml);
      if (titleMatch) metadata.title = redactStudioSecrets(decodeXmlEntities(titleMatch[1].trim()));
      if (creatorMatch) metadata.author = redactStudioSecrets(decodeXmlEntities(creatorMatch[1].trim()));
    } catch {
      // Optional metadata only
    }
  }

  const paragraphs: string[] = [];
  const outline: StudioDocumentOutlineItem[] = [];

  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let paraMatch: RegExpExecArray | null;
  while ((paraMatch = paraRe.exec(docXml)) !== null) {
    const pBody = paraMatch[1];

    // Replace inline breaks and tabs before extracting w:t text runs
    const normalizedP = pBody
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n');

    const textParts: string[] = [];
    const textRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\n|\t/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = textRe.exec(normalizedP)) !== null) {
      if (tMatch[0] === '\n' || tMatch[0] === '\t') {
        textParts.push(tMatch[0]);
      } else if (tMatch[1] !== undefined) {
        textParts.push(decodeXmlEntities(tMatch[1]));
      }
    }

    const joined = textParts.join('').trim();
    if (!joined) continue;

    const subLines = joined.split('\n').map((l) => l.trimEnd());
    const startIdx = paragraphs.length + 1;
    paragraphs.push(...subLines);

    const styleMatch = /<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i.exec(pBody);
    if (styleMatch) {
      const styleVal = styleMatch[1];
      const headingNum = /^Heading([1-6])$/i.exec(styleVal);
      if (headingNum) {
        outline.push({
          level: Number(headingNum[1]),
          title: redactStudioSecrets(subLines[0]).slice(0, 140),
          line: startIdx,
          kind: 'heading',
        });
      } else if (/^Title$/i.test(styleVal)) {
        outline.push({
          level: 1,
          title: redactStudioSecrets(subLines[0]).slice(0, 140),
          line: startIdx,
          kind: 'title',
        });
      }
    }
  }

  // Fallback if XML has no <w:p> wrappers
  if (paragraphs.length === 0) {
    const stripped = decodeXmlEntities(docXml.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped) paragraphs.push(stripped);
  }

  metadata.paragraphCount = paragraphs.length;
  const sliced = sliceLines(paragraphs, startLine, maxLines);

  return {
    mode: 'live',
    filePath: relPath,
    format: 'docx',
    bytes,
    totalLines: paragraphs.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline: outline.slice(0, 100),
    content: sliced.content,
    lines: sliced.lines,
    metadata,
  };
}

function excelColRefToIndex(cellRef: string): number {
  const lettersMatch = /^([A-Za-z]+)/.exec(cellRef);
  if (!lettersMatch) return -1;
  const letters = lettersMatch[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseSharedStringsXml(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(xml)) !== null) {
    const body = siMatch[1];
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(body)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    out.push(parts.join(''));
  }
  return out;
}

function resolveXlsxSheets(zip: ReadOnlyZipArchive): Array<{ name: string; path: string }> {
  const sheets: Array<{ name: string; path: string }> = [];
  const relMap = new Map<string, string>();

  if (zip.hasEntry('xl/_rels/workbook.xml.rels')) {
    try {
      const relsXml = zip.readEntryText('xl/_rels/workbook.xml.rels');
      const relRe = /<Relationship\b([^>]+)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = relRe.exec(relsXml)) !== null) {
        const attrs = m[1];
        const idM = /\bId=["']([^"']+)["']/.exec(attrs);
        const targetM = /\bTarget=["']([^"']+)["']/.exec(attrs);
        if (idM && targetM) {
          let target = targetM[1].replace(/^\/+/, '');
          if (!target.startsWith('xl/')) {
            target = `xl/${target}`;
          }
          relMap.set(idM[1], target);
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (zip.hasEntry('xl/workbook.xml')) {
    try {
      const wbXml = zip.readEntryText('xl/workbook.xml');
      const sheetRe = /<sheet\b([^>]+)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = sheetRe.exec(wbXml)) !== null) {
        const attrs = m[1];
        const nameM = /\bname=["']([^"']+)["']/.exec(attrs);
        const ridM = /\br:id=["']([^"']+)["']/.exec(attrs);
        const name = nameM ? decodeXmlEntities(nameM[1]) : `Sheet${sheets.length + 1}`;
        const mapped = ridM ? relMap.get(ridM[1]) : undefined;
        const fallbackPath = `xl/worksheets/sheet${sheets.length + 1}.xml`;
        const resolvedPath = mapped && zip.hasEntry(mapped) ? mapped : fallbackPath;
        if (zip.hasEntry(resolvedPath)) {
          sheets.push({ name, path: resolvedPath });
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (sheets.length === 0) {
    const candidates = zip
      .listEntryNames()
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = 0; i < candidates.length; i += 1) {
      sheets.push({ name: `Sheet${i + 1}`, path: candidates[i] });
    }
  }

  return sheets;
}

function parseWorksheetRows(
  sheetXml: string,
  sharedStrings: string[],
): { rows: string[][]; totalRows: number } {
  const MAX_XLSX_ROWS = 500;
  const MAX_XLSX_COLS = 64;
  const rows: string[][] = [];
  let totalRows = 0;

  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    totalRows += 1;
    if (rows.length >= MAX_XLSX_ROWS) continue;

    const rowBody = rowMatch[1];
    const cells: string[] = [];
    let nextColIdx = 0;

    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowBody)) !== null) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const refM = /\br=["']([^"']+)["']/.exec(attrs);
      const typeM = /\bt=["']([^"']+)["']/.exec(attrs);
      const cellType = typeM ? typeM[1] : '';

      let colIdx = refM ? excelColRefToIndex(refM[1]) : nextColIdx;
      if (colIdx < 0) colIdx = nextColIdx;
      nextColIdx = colIdx + 1;

      if (colIdx >= MAX_XLSX_COLS) continue;
      while (cells.length <= colIdx) cells.push('');

      let value = '';
      if (cellType === 's') {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const idx = vM ? Number.parseInt(vM[1].trim(), 10) : -1;
        value = idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '';
      } else if (cellType === 'inlineStr') {
        const tParts: string[] = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tM: RegExpExecArray | null;
        while ((tM = tRe.exec(inner)) !== null) {
          tParts.push(decodeXmlEntities(tM[1]));
        }
        value = tParts.join('');
      } else if (cellType === 'b') {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = vM && vM[1].trim() === '1' ? 'TRUE' : 'FALSE';
      } else {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = vM ? decodeXmlEntities(vM[1].trim()) : '';
      }

      cells[colIdx] = redactStudioSecrets(value);
    }

    if (cells.some((c) => c !== '')) {
      rows.push(cells);
    }
  }

  return { rows, totalRows };
}

function parseXlsxDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const zip = new ReadOnlyZipArchive(buf);
  const sheetDefs = resolveXlsxSheets(zip);
  if (sheetDefs.length === 0) {
    throw new Error(`Invalid XLSX file (no worksheets found): ${relPath}`);
  }

  const sharedStrings = zip.hasEntry('xl/sharedStrings.xml')
    ? parseSharedStringsXml(zip.readEntryText('xl/sharedStrings.xml'))
    : [];

  const primarySheet = sheetDefs[0];
  const parsedPrimary = parseWorksheetRows(zip.readEntryText(primarySheet.path), sharedStrings);

  const previewLines: string[] = [`# Sheet: ${primarySheet.name}`];
  for (let i = 0; i < parsedPrimary.rows.length; i += 1) {
    const row = parsedPrimary.rows[i];
    previewLines.push(row.join('\t'));
  }

  const outline: StudioDocumentOutlineItem[] = sheetDefs.map((s, idx) => ({
    level: 1,
    title: s.name,
    line: idx === 0 ? 1 : previewLines.length,
    kind: 'sheet',
  }));

  const sliced = sliceLines(previewLines, startLine, maxLines);
  const sheets: StudioDocumentSheetPreview[] = [
    {
      name: primarySheet.name,
      rows: parsedPrimary.rows.slice(0, 100),
      totalRows: parsedPrimary.totalRows,
    },
  ];

  return {
    mode: 'live',
    filePath: relPath,
    format: 'xlsx',
    bytes,
    totalLines: previewLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata: {
      sheetNames: sheetDefs.map((s) => s.name),
      activeSheet: primarySheet.name,
      sharedStringCount: sharedStrings.length,
      rowCount: parsedPrimary.totalRows,
      entryCount: zip.listEntryNames().length,
    },
    sheets,
  };
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= raw.length) break;
    const next = raw[i + 1];
    switch (next) {
      case 'n':
        out += '\n';
        i += 1;
        break;
      case 'r':
        out += '\r';
        i += 1;
        break;
      case 't':
        out += '\t';
        i += 1;
        break;
      case 'b':
        out += '\b';
        i += 1;
        break;
      case 'f':
        out += '\f';
        i += 1;
        break;
      case '(':
      case ')':
      case '\\':
        out += next;
        i += 1;
        break;
      case '\r':
        i += raw[i + 2] === '\n' ? 2 : 1;
        break;
      case '\n':
        i += 1;
        break;
      default: {
        // Octal escape \ddd
        if (next >= '0' && next <= '7') {
          let oct = next;
          let j = i + 2;
          while (j < raw.length && oct.length < 3 && raw[j] >= '0' && raw[j] <= '7') {
            oct += raw[j];
            j += 1;
          }
          out += String.fromCharCode(Number.parseInt(oct, 8));
          i = j - 1;
        } else {
          out += next;
          i += 1;
        }
      }
    }
  }
  return out;
}

function decodePdfHexString(hexRaw: string): string {
  const cleaned = hexRaw.replace(/\s+/g, '');
  const padded = cleaned.length % 2 === 1 ? `${cleaned}0` : cleaned;
  const bytes = Buffer.from(padded, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE with BOM
    const chars: string[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
    }
    return chars.join('');
  }
  return bytes.toString('latin1');
}

function extractPdfInfoMetadata(latin1Text: string): Record<string, string> {
  const info: Record<string, string> = {};
  const keys = ['Title', 'Author', 'Subject', 'Creator', 'Producer', 'CreationDate'] as const;
  for (const key of keys) {
    const litRe = new RegExp(`/${key}\\s*\\(([^\\\\()]*(?:\\\\.[^\\\\()]*)*)\\)`);
    const litM = litRe.exec(latin1Text);
    if (litM) {
      const val = redactStudioSecrets(decodePdfLiteralString(litM[1]).trim());
      if (val) info[key.toLowerCase()] = val;
      continue;
    }
    const hexRe = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`);
    const hexM = hexRe.exec(latin1Text);
    if (hexM) {
      const val = redactStudioSecrets(decodePdfHexString(hexM[1]).trim());
      if (val) info[key.toLowerCase()] = val;
    }
  }
  return info;
}

function extractPdfTextFromContentStream(streamText: string): string[] {
  const lines: string[] = [];
  const btEtRe = /\bBT\b([\s\S]*?)\bET\b/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = btEtRe.exec(streamText)) !== null) {
    const block = blockMatch[1];
    let currentLine = '';
    let i = 0;

    const flushLine = () => {
      const cleaned = currentLine.replace(/\s+/g, ' ').trim();
      if (cleaned) lines.push(cleaned);
      currentLine = '';
    };

    while (i < block.length) {
      const ch = block[i];

      // Literal PDF string (...)
      if (ch === '(') {
        let depth = 1;
        let j = i + 1;
        let escaped = false;
        while (j < block.length && depth > 0) {
          const c = block[j];
          if (escaped) {
            escaped = false;
          } else if (c === '\\') {
            escaped = true;
          } else if (c === '(') {
            depth += 1;
          } else if (c === ')') {
            depth -= 1;
          }
          j += 1;
        }
        const literalRaw = block.slice(i + 1, j - 1);
        const after = block.slice(j, j + 12).trimStart();
        if (after.startsWith('Tj') || after.startsWith("'") || after.startsWith('"')) {
          currentLine += decodePdfLiteralString(literalRaw);
          if (after.startsWith("'") || after.startsWith('"')) {
            flushLine();
          }
        }
        i = j;
        continue;
      }

      // TJ array [ (Hello) -120 (World) ] TJ
      if (ch === '[') {
        let j = i + 1;
        let parts = '';
        let inParen = false;
        let parenDepth = 0;
        let escaped = false;
        let tokenStart = -1;

        while (j < block.length) {
          const c = block[j];
          if (inParen) {
            if (escaped) {
              escaped = false;
            } else if (c === '\\') {
              escaped = true;
            } else if (c === '(') {
              parenDepth += 1;
            } else if (c === ')') {
              parenDepth -= 1;
              if (parenDepth === 0) {
                parts += decodePdfLiteralString(block.slice(tokenStart, j));
                inParen = false;
              }
            }
          } else if (c === '(') {
            inParen = true;
            parenDepth = 1;
            tokenStart = j + 1;
          } else if (c === ']') {
            j += 1;
            break;
          } else if (c === '-' && j + 1 < block.length && /\d/.test(block[j + 1])) {
            const numMatch = /^-(\d+(?:\.\d+)?)/.exec(block.slice(j));
            if (numMatch && Number(numMatch[1]) >= 120 && parts && !parts.endsWith(' ')) {
              parts += ' ';
            }
          }
          j += 1;
        }
        const after = block.slice(j, j + 12).trimStart();
        if (after.startsWith('TJ') && parts) {
          currentLine += parts;
        }
        i = j;
        continue;
      }

      // Line breaks on T* / Td / TD
      if (
        (ch === 'T' && (block[i + 1] === '*' || block[i + 1] === 'd' || block[i + 1] === 'D')) &&
        (i === 0 || /\s/.test(block[i - 1]))
      ) {
        flushLine();
        i += 2;
        continue;
      }

      i += 1;
    }

    flushLine();
  }

  return lines;
}

function parsePdfDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const headText = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1');
  const versionMatch = /%PDF-(\d+\.\d+)/.exec(headText);
  if (!versionMatch) {
    throw new Error(`Invalid PDF file (missing %PDF header): ${relPath}`);
  }
  const pdfVersion = versionMatch[1];

  const fullLatin1 = buf.toString('latin1');
  const pageMatches = fullLatin1.match(/\/Type\s*\/Page(?![A-Za-z])/g);
  let estimatedPages = pageMatches ? pageMatches.length : 0;
  if (estimatedPages === 0) {
    const countMatch = /\/Count\s+(\d+)/.exec(fullLatin1);
    if (countMatch) estimatedPages = Number.parseInt(countMatch[1], 10) || 0;
  }

  const info = extractPdfInfoMetadata(fullLatin1);

  const streamKeyword = Buffer.from('stream');
  const endstreamKeyword = Buffer.from('endstream');
  const extractedLines: string[] = [];
  let totalDecompressed = 0;
  let streamsInspected = 0;
  let searchPos = 0;

  while (searchPos < buf.length && streamsInspected < 256) {
    const kwIdx = buf.indexOf(streamKeyword, searchPos);
    if (kwIdx < 0) break;
    searchPos = kwIdx + streamKeyword.length;

    // Validate token boundary before and newline after 'stream'
    if (kwIdx > 0) {
      const prevByte = buf[kwIdx - 1];
      const validPrev =
        prevByte === 0x0a ||
        prevByte === 0x0d ||
        prevByte === 0x20 ||
        prevByte === 0x09 ||
        prevByte === 0x3e || // '>'
        prevByte === 0x5d; // ']'
      if (!validPrev) continue;
    }

    let dataStart = kwIdx + streamKeyword.length;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buf[dataStart] === 0x0a) {
      dataStart += 1;
    } else {
      continue;
    }

    const endIdx = buf.indexOf(endstreamKeyword, dataStart);
    if (endIdx < 0) break;
    searchPos = endIdx + endstreamKeyword.length;
    streamsInspected += 1;

    let dataEnd = endIdx;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0d) dataEnd -= 1;

    const dictWindowStart = Math.max(0, kwIdx - 512);
    const dictText = buf.subarray(dictWindowStart, kwIdx).toString('latin1');
    const rawStream = buf.subarray(dataStart, dataEnd);

    // Skip image/binary filters that never hold text operators
    if (/\/(?:DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b/.test(dictText)) {
      continue;
    }

    let decodedText: string | null = null;
    if (/\/FlateDecode\b/.test(dictText)) {
      const remaining = STUDIO_PDF_MAX_STREAM_BYTES - totalDecompressed;
      if (remaining <= 0) continue;
      try {
        const inflated = zlib.inflateSync(rawStream, { maxOutputLength: remaining });
        totalDecompressed += inflated.length;
        decodedText = inflated.toString('latin1');
      } catch {
        // Gracefully skip non-standard predictor or oversized compressed stream
        continue;
      }
    } else if (rawStream.length <= STUDIO_PDF_MAX_STREAM_BYTES - totalDecompressed) {
      const textCandidate = rawStream.toString('latin1');
      if (textCandidate.includes('BT') && textCandidate.includes('ET')) {
        totalDecompressed += rawStream.length;
        decodedText = textCandidate;
      }
    }

    if (decodedText && decodedText.includes('BT')) {
      const streamLines = extractPdfTextFromContentStream(decodedText);
      extractedLines.push(...streamLines);
    }
  }

  const outline: StudioDocumentOutlineItem[] = [];
  if (info.title) {
    outline.push({ level: 1, title: info.title, line: 1, kind: 'title' });
  }
  for (let i = 0; i < extractedLines.length && outline.length < 30; i += 1) {
    const line = extractedLines[i];
    if (line.length >= 3 && line.length <= 90 && (i === 0 || /^\d+(?:\.\d+)*\s+\S/.test(line))) {
      outline.push({
        level: i === 0 ? 1 : 2,
        title: redactStudioSecrets(line),
        line: i + 1,
        kind: 'section',
      });
    }
  }

  const sliced = sliceLines(extractedLines, startLine, maxLines);

  return {
    mode: 'live',
    filePath: relPath,
    format: 'pdf',
    bytes,
    totalLines: extractedLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata: {
      pdfVersion,
      estimatedPages,
      info,
      streamsInspected,
      decompressedStreamBytes: totalDecompressed,
    },
  };
}

export function inspectStudioDocument(
  workspaceRoot: string,
  opts: StudioInspectDocumentOptions,
): StudioDocumentResult {
  const resolved = resolveStudioWorkspaceFile(workspaceRoot, opts.filePath);
  const ext = path.extname(resolved.relPath).toLowerCase();
  const buf = fs.readFileSync(resolved.realTarget);

  if (ext === '.docx') {
    return parseDocxDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }
  if (ext === '.xlsx') {
    return parseXlsxDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }
  if (ext === '.pdf') {
    return parsePdfDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }

  let textFormat: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json';
  switch (ext) {
    case '.md':
    case '.mdx':
      textFormat = 'markdown';
      break;
    case '.txt':
      textFormat = 'text';
      break;
    case '.html':
    case '.htm':
      textFormat = 'html';
      break;
    case '.svg':
      textFormat = 'svg';
      break;
    case '.yaml':
    case '.yml':
      textFormat = 'yaml';
      break;
    case '.xml':
      textFormat = 'xml';
      break;
    case '.json':
      textFormat = 'json';
      break;
    default:
      throw new Error(
        `Unsupported document format "${ext || '(none)'}" for studio_inspect_document (supported: .md, .txt, .html, .svg, .yaml, .yml, .xml, .json, .docx, .xlsx, .pdf)`,
      );
  }

  const rawText = buf.toString('utf8');
  const allLines = rawText.split(/\r?\n/);
  const outline = extractTextOutline(textFormat, allLines);
  const sliced = sliceLines(allLines, opts.startLine, opts.maxLines);

  const metadata: Record<string, unknown> = {
    extension: ext,
    lineCount: allLines.length,
    charCount: rawText.length,
  };

  if (textFormat === 'svg') {
    const vbMatch = /\bviewBox=["']([^"']+)["']/i.exec(rawText);
    if (vbMatch) metadata.viewBox = vbMatch[1];
  }

  let openApiSpec: ParsedOpenApiSpec | undefined;
  if (
    (textFormat === 'yaml' || textFormat === 'json') &&
    resolved.stat.size <= OPENAPI_MAX_FILE_BYTES &&
    isLikelyOpenApiDocument(resolved.relPath, rawText, textFormat)
  ) {
    try {
      const openApiExt: '.json' | '.yaml' | '.yml' =
        ext === '.json' ? '.json' : ext === '.yml' ? '.yml' : '.yaml';
      openApiSpec = parseOpenApiSpecFromContent(resolved.relPath, rawText, openApiExt);
      metadata.openapi = openApiSpec.specVersion;
      metadata.openApiEndpoints = openApiSpec.totalEndpoints;
    } catch {
      // Preserve offline document slicing even if OpenAPI parsing rejects malformed/unsafe input
    }
  }

  return {
    mode: 'live',
    filePath: resolved.relPath,
    format: textFormat,
    bytes: resolved.stat.size,
    totalLines: allLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata,
    ...(openApiSpec ? { openApiSpec } : {}),
  };
}

// ============================================================================
// Strict Loopback-Only Anti-SSRF HTTP Probe (studio_http_probe)
// ============================================================================

const STRICT_LOOPBACK_URL_PREFIX_RE =
  /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?(?:[/?#]|$)/i;

export function validateLoopbackProbeUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('HTTP probe URL is required');
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    throw new Error('HTTP probe URL exceeds maximum length (2048)');
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('HTTP probe URL contains forbidden control characters');
  }
  // Conservatively reject "#@" fragment-authority confusion across downstream parsers
  if (trimmed.includes('#@')) {
    throw new Error('HTTP probe URL must not contain "#@" confusion sequence');
  }

  // Strictly validate scheme & authority on the raw string BEFORE calling new URL()
  const schemeSepIdx = trimmed.indexOf('://');
  if (schemeSepIdx <= 0) {
    throw new Error(
      'HTTP probe URL must start with strict http:// or https:// followed by a loopback host',
    );
  }
  const rawScheme = trimmed.slice(0, schemeSepIdx);
  if (/[\s\\]/.test(rawScheme)) {
    throw new Error('HTTP probe URL scheme contains forbidden whitespace or backslash');
  }

  const afterScheme = trimmed.slice(schemeSepIdx + 3);
  const rawAuthority = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  if (!rawAuthority || /[\s\\@]/.test(rawAuthority)) {
    throw new Error(
      'HTTP probe URL authority must not contain whitespace, backslashes, or "@" credentials',
    );
  }

  const prefixMatch = STRICT_LOOPBACK_URL_PREFIX_RE.exec(trimmed);
  if (!prefixMatch) {
    throw new Error(
      'SSRF guard blocked non-canonical or non-loopback URL (strictly limited to http(s)://127.0.0.1, localhost, or [::1])',
    );
  }

  const matchedHostLower = prefixMatch[2].toLowerCase();
  const rawPort = prefixMatch[3];
  let expectedPortNum: number | null = null;
  if (rawPort !== undefined) {
    if (rawPort.startsWith('0')) {
      throw new Error(`HTTP probe URL contains invalid port "${rawPort}"`);
    }
    expectedPortNum = Number(rawPort);
    if (!Number.isInteger(expectedPortNum) || expectedPortNum < 1 || expectedPortNum > 65535) {
      throw new Error(`HTTP probe URL port "${rawPort}" is out of range (1..65535)`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid HTTP probe URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `HTTP probe protocol "${parsed.protocol}" is forbidden (only http: and https: are allowed)`,
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('HTTP probe URL must not contain embedded username or password credentials');
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(hostLower)) {
    throw new Error(
      `SSRF guard blocked non-loopback host "${parsed.hostname}" (strictly limited to 127.0.0.1, localhost, or [::1])`,
    );
  }

  // Re-verify parsed host agrees with raw canonical prefix match
  const matchedHostUnbracketed = matchedHostLower.replace(/^\[|\]$/g, '');
  if (hostLower !== matchedHostLower && hostLower !== matchedHostUnbracketed) {
    throw new Error(
      `SSRF guard rejected URL host mismatch between raw authority "${matchedHostLower}" and parsed host "${hostLower}"`,
    );
  }

  if (expectedPortNum !== null && parsed.port !== '' && parsed.port !== String(expectedPortNum)) {
    throw new Error(
      `HTTP probe URL port mismatch between raw authority "${expectedPortNum}" and parsed port "${parsed.port}"`,
    );
  }

  return parsed;
}

function isSensitiveHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(lower)) return true;
  return SENSITIVE_HEADER_SUBSTRINGS.some((sub) => lower.includes(sub));
}

export function sanitizeHeadersMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeaderName(k) ? '[REDACTED]' : redactStudioSecrets(v);
  }
  return out;
}

export async function runLoopbackHttpProbe(
  opts: StudioHttpProbeOptions,
): Promise<StudioHttpProbeResult> {
  const parsedUrl = validateLoopbackProbeUrl(opts.url);
  const method = (opts.method ?? 'GET').toUpperCase();
  if (!ALLOWED_HTTP_METHODS.has(method)) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  const rawTimeout =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? Math.round(opts.timeoutMs)
      : STUDIO_HTTP_DEFAULT_TIMEOUT_MS;
  const clampedTimeoutMs = Math.max(
    STUDIO_HTTP_MIN_TIMEOUT_MS,
    Math.min(rawTimeout, STUDIO_HTTP_MAX_TIMEOUT_MS),
  );

  const outgoingHeaders: Record<string, string> = {};
  if (opts.headers && typeof opts.headers === 'object') {
    for (const [rawKey, rawVal] of Object.entries(opts.headers)) {
      const key = rawKey.trim();
      if (!key || /[\r\n:]/.test(key)) continue;
      if (FORBIDDEN_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      const val = String(rawVal ?? '');
      if (/[\r\n]/.test(val)) {
        throw new Error(`Invalid newline character in request header "${key}"`);
      }
      outgoingHeaders[key] = val;
    }
  }

  const canSendBody = method !== 'GET' && method !== 'HEAD' && typeof opts.body === 'string';
  const requestBody = canSendBody ? opts.body : undefined;

  const startedAt = Date.now();
  const response = await fetch(parsedUrl.toString(), {
    method,
    headers: outgoingHeaders,
    body: requestBody,
    redirect: 'manual',
    signal: AbortSignal.timeout(clampedTimeoutMs),
  });

  // Stream response body with strict 64 KiB cap
  const chunks: Uint8Array[] = [];
  let collectedBytes = 0;
  let truncated = false;

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const remaining = STUDIO_HTTP_MAX_BODY_BYTES - collectedBytes;
        if (value.byteLength <= remaining) {
          chunks.push(value);
          collectedBytes += value.byteLength;
        } else {
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining));
            collectedBytes += remaining;
          }
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const rawBodyBuf = Buffer.concat(chunks, collectedBytes);
  const bodyText = redactStudioSecrets(rawBodyBuf.toString('utf8'));

  const rawResponseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    rawResponseHeaders[key] = value;
  });

  const locationRaw = response.headers.get('location');
  const redirected = response.status >= 300 && response.status < 400;
  const redirectedLocation = locationRaw ? redactStudioSecrets(locationRaw) : undefined;

  return {
    mode: 'live',
    url: redactStudioSecrets(parsedUrl.toString()),
    method,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    elapsedMs,
    redirected,
    ...(redirectedLocation ? { location: redirectedLocation } : {}),
    requestHeaders: sanitizeHeadersMap(outgoingHeaders),
    responseHeaders: sanitizeHeadersMap(rawResponseHeaders),
    contentType: response.headers.get('content-type') ?? '',
    bodyText,
    bodyBytes: collectedBytes,
    truncated,
  };
}

// ============================================================================
// Pure In-Memory Demo Mode Fixtures (Zero Disk I/O, Zero Network Calls)
// ============================================================================

const DEMO_UPDATED_AT = '2026-11-27T06:00:00.000Z';

const DEMO_SOURCES: readonly StudioSourceItem[] = [
  {
    relPath: 'data/analytics.sqlite',
    name: 'analytics.sqlite',
    category: 'data',
    format: 'sqlite',
    extension: '.sqlite',
    bytes: 184320,
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    relPath: 'data/metrics.csv',
    name: 'metrics.csv',
    category: 'data',
    format: 'csv',
    extension: '.csv',
    bytes: 4280,
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    relPath: 'docs/architecture.docx',
    name: 'architecture.docx',
    category: 'document',
    format: 'docx',
    extension: '.docx',
    bytes: 38912,
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    relPath: 'docs/q4-budget.xlsx',
    name: 'q4-budget.xlsx',
    category: 'document',
    format: 'xlsx',
    extension: '.xlsx',
    bytes: 24576,
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    relPath: 'docs/spec.pdf',
    name: 'spec.pdf',
    category: 'document',
    format: 'pdf',
    extension: '.pdf',
    bytes: 142848,
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    relPath: 'api/openapi.yaml',
    name: 'openapi.yaml',
    category: 'openapi',
    format: 'openapi',
    extension: '.yaml',
    bytes: 6144,
    updatedAt: DEMO_UPDATED_AT,
  },
];

const DEMO_SQLITE_TABLES: StudioSqliteTableSchema[] = [
  {
    name: 'events',
    type: 'table',
    columns: [
      { cid: 0, name: 'id', type: 'INTEGER', notnull: true, pk: true, dfltValue: null },
      { cid: 1, name: 'service', type: 'TEXT', notnull: true, pk: false, dfltValue: null },
      { cid: 2, name: 'status', type: 'TEXT', notnull: true, pk: false, dfltValue: null },
      { cid: 3, name: 'latency_ms', type: 'REAL', notnull: true, pk: false, dfltValue: null },
      { cid: 4, name: 'created_at', type: 'TEXT', notnull: true, pk: false, dfltValue: null },
    ],
  },
  {
    name: 'sessions',
    type: 'table',
    columns: [
      { cid: 0, name: 'session_id', type: 'TEXT', notnull: true, pk: true, dfltValue: null },
      { cid: 1, name: 'preset', type: 'TEXT', notnull: true, pk: false, dfltValue: "'core'" },
      { cid: 2, name: 'cached_ratio', type: 'REAL', notnull: false, pk: false, dfltValue: null },
    ],
  },
];

const DEMO_SQLITE_EVENT_ROWS: Array<Record<string, unknown>> = [
  { id: 101, service: 'mcp-gateway', status: 'ok', latency_ms: 14.2, created_at: '2026-11-27T05:50:00Z' },
  { id: 102, service: 'studio-slicer', status: 'ok', latency_ms: 8.7, created_at: '2026-11-27T05:52:10Z' },
  { id: 103, service: 'guard-hook', status: 'blocked', latency_ms: 1.9, created_at: '2026-11-27T05:54:45Z' },
  { id: 104, service: 'xray-indexer', status: 'ok', latency_ms: 21.6, created_at: '2026-11-27T05:58:12Z' },
];

const DEMO_METRICS_ROWS: Array<Record<string, unknown>> = [
  { date: '2026-11-24', module: 'review', p95_ms: 18, tool_calls: 142, cache_hit_pct: 91.4 },
  { date: '2026-11-25', module: 'guard', p95_ms: 4, tool_calls: 318, cache_hit_pct: 96.2 },
  { date: '2026-11-26', module: 'studio', p95_ms: 24, tool_calls: 67, cache_hit_pct: 88.9 },
  { date: '2026-11-27', module: 'xray', p95_ms: 15, tool_calls: 205, cache_hit_pct: 94.1 },
];

export interface DemoStudioService {
  listSources: (category?: StudioSourceFilterCategory) => StudioSourcesResult;
  inspectData: (opts: StudioInspectDataOptions) => StudioDataResult;
  inspectDocument: (opts: StudioInspectDocumentOptions) => StudioDocumentResult;
  httpProbe: (opts: StudioHttpProbeOptions) => StudioHttpProbeResult;
  parseOpenApi: (filePath: string) => ParsedOpenApiSpec;
}

export function createDemoStudioService(workspaceRoot: string): DemoStudioService {
  const listSources = (category: StudioSourceFilterCategory = 'all'): StudioSourcesResult => {
    const all = DEMO_SOURCES.map((s) => ({ ...s }));
    const filtered = category === 'all' ? all : all.filter((s) => s.category === category);
    return {
      mode: 'demo',
      workspaceRoot,
      sources: filtered,
      counts: {
        total: all.length,
        data: all.filter((s) => s.category === 'data').length,
        document: all.filter((s) => s.category === 'document').length,
        openapi: all.filter((s) => s.category === 'openapi').length,
      },
      skippedSensitive: 2,
      skippedSymlinks: 0,
      truncated: false,
    };
  };

  const inspectData = (opts: StudioInspectDataOptions): StudioDataResult => {
    const filePath = (opts.filePath ?? '').trim();
    if (!filePath || isSensitiveStudioPath(filePath)) {
      throw new Error(`Refused to access sensitive or invalid path: ${filePath}`);
    }
    const limit = clampDataLimit(opts.limit);
    const needle = opts.filter?.trim().toLowerCase() || '';
    const base = path.posix.basename(filePath.replace(/\\/g, '/')).toLowerCase();

    if (base === 'analytics.sqlite' || base.endsWith('.sqlite') || base.endsWith('.db')) {
      const safeSql = opts.query && opts.query.trim() ? validateReadOnlySqliteQuery(opts.query) : undefined;
      if (!safeSql) {
        const schemaRows = DEMO_SQLITE_TABLES.map((t) => ({
          name: t.name,
          type: t.type,
          columnCount: t.columns.length,
          columns: t.columns.map((c) => `${c.name} (${c.type})${c.pk ? ' PK' : ''}`).join(', '),
        })).filter((r) => (!needle ? true : rowMatchesFilter(r, needle)));
        const sliced = schemaRows.slice(0, limit);
        return {
          mode: 'demo',
          filePath: 'data/analytics.sqlite',
          format: 'sqlite',
          bytes: 184320,
          columns: ['name', 'type', 'columnCount', 'columns'],
          rows: sliced,
          totalRows: schemaRows.length,
          returnedRows: sliced.length,
          truncated: schemaRows.length > sliced.length,
          filter: opts.filter?.trim() || undefined,
          summary: 'data/analytics.sqlite (demo SQLite 3): 2 tables discovered (read-only schema view).',
          sqlite: {
            sqliteCliAvailable: true,
            headerFormat: 'SQLite format 3',
            pageSize: 4096,
            tables: DEMO_SQLITE_TABLES.map((t) => ({
              ...t,
              columns: t.columns.map((c) => ({ ...c })),
            })),
          },
        };
      }

      const matched = DEMO_SQLITE_EVENT_ROWS.filter((r) => (!needle ? true : rowMatchesFilter(r, needle)));
      const sliced = matched.slice(0, limit);
      return {
        mode: 'demo',
        filePath: 'data/analytics.sqlite',
        format: 'sqlite',
        bytes: 184320,
        columns: ['id', 'service', 'status', 'latency_ms', 'created_at'],
        rows: sliced,
        totalRows: matched.length,
        returnedRows: sliced.length,
        truncated: matched.length > sliced.length,
        filter: opts.filter?.trim() || undefined,
        query: safeSql,
        summary: `data/analytics.sqlite (demo read-only query): returned ${sliced.length} synthetic row(s).`,
        sqlite: {
          sqliteCliAvailable: true,
          headerFormat: 'SQLite format 3',
          pageSize: 4096,
          tables: DEMO_SQLITE_TABLES.map((t) => ({
            ...t,
            columns: t.columns.map((c) => ({ ...c })),
          })),
          executedSql: safeSql,
        },
      };
    }

    if (base === 'metrics.csv' || base.endsWith('.csv') || base.endsWith('.tsv')) {
      const matched = DEMO_METRICS_ROWS.filter((r) => (!needle ? true : rowMatchesFilter(r, needle)));
      const sliced = matched.slice(0, limit);
      return {
        mode: 'demo',
        filePath: 'data/metrics.csv',
        format: base.endsWith('.tsv') ? 'tsv' : 'csv',
        bytes: 4280,
        columns: ['date', 'module', 'p95_ms', 'tool_calls', 'cache_hit_pct'],
        rows: sliced,
        totalRows: matched.length,
        returnedRows: sliced.length,
        truncated: matched.length > sliced.length,
        filter: opts.filter?.trim() || undefined,
        summary: `data/metrics.csv (demo CSV): 5 columns, ${matched.length} matching rows, showing ${sliced.length}.`,
      };
    }

    throw new Error(`Demo data source not found: ${filePath} (available: data/analytics.sqlite, data/metrics.csv)`);
  };

  const inspectDocument = (opts: StudioInspectDocumentOptions): StudioDocumentResult => {
    const filePath = (opts.filePath ?? '').trim();
    if (!filePath || isSensitiveStudioPath(filePath)) {
      throw new Error(`Refused to access sensitive or invalid path: ${filePath}`);
    }
    const base = path.posix.basename(filePath.replace(/\\/g, '/')).toLowerCase();

    if (base === 'architecture.docx' || base.endsWith('.docx')) {
      const allLines = [
        'agy-NOV v0.4.0 Workspace Studio Architecture',
        '1. Offline-First Design',
        'All parsers run inside Node.js without invoking external binaries or network services.',
        '2. Security Boundaries',
        'Every file path is verified with realpathSync against workspaceRoot before any read.',
        'ZIP bomb caps enforce <= 512 entries, <= 4 MiB per entry, and <= 6 MiB total inflated.',
      ];
      const sliced = sliceLines(allLines, opts.startLine, opts.maxLines);
      return {
        mode: 'demo',
        filePath: 'docs/architecture.docx',
        format: 'docx',
        bytes: 38912,
        totalLines: allLines.length,
        startLine: sliced.startLine,
        endLine: sliced.endLine,
        truncated: sliced.truncated,
        outline: [
          { level: 1, title: 'agy-NOV v0.4.0 Workspace Studio Architecture', line: 1, kind: 'title' },
          { level: 2, title: '1. Offline-First Design', line: 2, kind: 'heading' },
          { level: 2, title: '2. Security Boundaries', line: 4, kind: 'heading' },
        ],
        content: sliced.content,
        lines: sliced.lines,
        metadata: { title: 'Workspace Studio Architecture', author: 'agy-NOV Team', paragraphCount: allLines.length },
      };
    }

    if (base === 'q4-budget.xlsx' || base.endsWith('.xlsx')) {
      const sheetRows = [
        ['Department', 'Q4 Planned (USD)', 'Q4 Actual (USD)', 'Status'],
        ['Core Runtime', '42000', '39800', 'On Track'],
        ['Security Audit', '18500', '18200', 'Completed'],
        ['Local UI Polish', '12000', '11450', 'On Track'],
      ];
      const allLines = ['# Sheet: Q4 Summary', ...sheetRows.map((r) => r.join('\t'))];
      const sliced = sliceLines(allLines, opts.startLine, opts.maxLines);
      return {
        mode: 'demo',
        filePath: 'docs/q4-budget.xlsx',
        format: 'xlsx',
        bytes: 24576,
        totalLines: allLines.length,
        startLine: sliced.startLine,
        endLine: sliced.endLine,
        truncated: sliced.truncated,
        outline: [
          { level: 1, title: 'Q4 Summary', line: 1, kind: 'sheet' },
          { level: 1, title: 'Vendor Breakdown', line: allLines.length, kind: 'sheet' },
        ],
        content: sliced.content,
        lines: sliced.lines,
        metadata: {
          sheetNames: ['Q4 Summary', 'Vendor Breakdown'],
          activeSheet: 'Q4 Summary',
          rowCount: sheetRows.length,
        },
        sheets: [{ name: 'Q4 Summary', rows: sheetRows, totalRows: sheetRows.length }],
      };
    }

    if (base === 'spec.pdf' || base.endsWith('.pdf')) {
      const allLines = [
        'agy-NOV Modular Workbench Technical Specification',
        '1.1 Zero ASAR and Zero CDP Invariant',
        'Plugins operate exclusively over official MCP Apps and lifecycle hooks.',
        '1.2 Loopback HTTP Probe Safety',
        'Only 127.0.0.1, localhost, and [::1] targets are permitted with redirect: manual.',
      ];
      const sliced = sliceLines(allLines, opts.startLine, opts.maxLines);
      return {
        mode: 'demo',
        filePath: 'docs/spec.pdf',
        format: 'pdf',
        bytes: 142848,
        totalLines: allLines.length,
        startLine: sliced.startLine,
        endLine: sliced.endLine,
        truncated: sliced.truncated,
        outline: [
          { level: 1, title: 'agy-NOV Modular Workbench Technical Specification', line: 1, kind: 'title' },
          { level: 2, title: '1.1 Zero ASAR and Zero CDP Invariant', line: 2, kind: 'section' },
          { level: 2, title: '1.2 Loopback HTTP Probe Safety', line: 4, kind: 'section' },
        ],
        content: sliced.content,
        lines: sliced.lines,
        metadata: {
          pdfVersion: '1.7',
          estimatedPages: 8,
          info: { title: 'agy-NOV Technical Specification', author: 'agy-NOV Engineering' },
          decompressedStreamBytes: 12480,
        },
      };
    }

    if (base === 'openapi.yaml' || base.endsWith('.yaml') || base.endsWith('.yml')) {
      const allLines = [
        'openapi: 3.1.0',
        'info:',
        '  title: Local Sandbox Dev API',
        '  version: 0.6.0',
        'servers:',
        '  - url: http://127.0.0.1:4399',
        '    description: Local Loopback Dev Server',
        '  - url: https://api.example.com/v1',
        '    description: Production (Blocked by Loopback-Only Guard)',
        'paths:',
        '  /api/health:',
        '    get:',
        '      summary: Loopback service health and readiness check',
        '  /api/projects/{id}:',
        '    get:',
        '      summary: Fetch workspace project metadata by identifier',
        '  /api/reviews:',
        '    post:',
        '      summary: Create a local code review annotation batch',
        '  /api/cache:',
        '    delete:',
        '      summary: Evict local loopback preview cache entries',
      ];
      const sliced = sliceLines(allLines, opts.startLine, opts.maxLines);
      const demoSpec = createDemoOpenApiSpec('api/openapi.yaml');
      return {
        mode: 'demo',
        filePath: 'api/openapi.yaml',
        format: 'yaml',
        bytes: 6144,
        totalLines: allLines.length,
        startLine: sliced.startLine,
        endLine: sliced.endLine,
        truncated: sliced.truncated,
        outline: extractTextOutline('yaml', allLines),
        content: sliced.content,
        lines: sliced.lines,
        metadata: {
          extension: '.yaml',
          lineCount: allLines.length,
          openapi: '3.1.0',
          openApiEndpoints: demoSpec.totalEndpoints,
        },
        openApiSpec: demoSpec,
      };
    }

    throw new Error(
      `Demo document not found: ${filePath} (available: docs/architecture.docx, docs/q4-budget.xlsx, docs/spec.pdf, api/openapi.yaml)`,
    );
  };

  const httpProbe = (opts: StudioHttpProbeOptions): StudioHttpProbeResult => {
    // Enforce exact same strict loopback SSRF guard in demo mode
    const parsed = validateLoopbackProbeUrl(opts.url);
    const method = (opts.method ?? 'GET').toUpperCase();
    if (!ALLOWED_HTTP_METHODS.has(method)) {
      throw new Error(`Unsupported HTTP method: ${method}`);
    }

    const demoPayload = JSON.stringify(
      {
        status: 'ok',
        service: 'agy-nov-demo-loopback',
        version: '0.4.0',
        path: parsed.pathname,
        method,
        timestamp: DEMO_UPDATED_AT,
        checks: { sqlite: 'ready', slicer: 'ready', ssrfGuard: 'loopback-only' },
      },
      null,
      2,
    );

    const requestHeaders = sanitizeHeadersMap(opts.headers ?? {});
    const responseHeaders = sanitizeHeadersMap({
      'content-type': 'application/json; charset=utf-8',
      'x-studio-mode': 'demo',
      'cache-control': 'no-store',
    });

    return {
      mode: 'demo',
      url: redactStudioSecrets(parsed.toString()),
      method,
      status: 200,
      statusText: 'OK',
      ok: true,
      elapsedMs: 6,
      redirected: false,
      requestHeaders,
      responseHeaders,
      contentType: 'application/json; charset=utf-8',
      bodyText: demoPayload,
      bodyBytes: Buffer.byteLength(demoPayload, 'utf8'),
      truncated: false,
    };
  };

  const parseOpenApi = (rawFilePath: string): ParsedOpenApiSpec => {
    const filePath = (rawFilePath ?? '').trim();
    if (!filePath || isSensitiveStudioPath(filePath)) {
      throw new Error(`Refused to access sensitive or invalid path: ${filePath}`);
    }
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const base = path.posix.basename(normalized).toLowerCase();
    if (
      normalized === 'api/openapi.yaml' ||
      base === 'openapi.yaml' ||
      base === 'openapi.yml' ||
      base === 'openapi.json'
    ) {
      return createDemoOpenApiSpec('api/openapi.yaml');
    }
    throw new Error(
      `Demo OpenAPI spec not found: ${filePath} (available: api/openapi.yaml)`,
    );
  };

  return {
    listSources,
    inspectData,
    inspectDocument,
    httpProbe,
    parseOpenApi,
  };
}
