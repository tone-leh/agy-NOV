import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import {
  isSensitiveStudioPath,
  redactStudioSecrets,
  rowMatchesFilter,
  sanitizeRowRecord,
  type StudioDataResult,
  type StudioSqliteColumnInfo,
  type StudioSqliteTableSchema,
} from './sources.js';

// ============================================================================
// Constants & Strict Read-Only SQLite Policy
// ============================================================================

export const STUDIO_SQLITE_TIMEOUT_MS = 4000;
export const STUDIO_SQLITE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const SQLITE_FORBIDDEN_KEYWORDS_RE =
  /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE|LOAD_EXTENSION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|TRIGGER)\b/i;

const SQLITE_FORBIDDEN_FUNCTIONS_AND_VTABLES_RE =
  /\b(?:readfile|writefile|edit|fts3_tokenizer|load_extension|shell_putsnl|shell_temp_filename|shell_add_schema|shell_format_schema|shell_module_schema|shell_prompt_test|sqlar_compress|sqlar_uncompress|realpath|sha1_query|sha3_query|sqlite_compileoption_get|sqlite_compileoption_used|sqlite_log|usleep|fsdir|zipfile|zipfile_cds|sqlite_dbpage|sqlite_dbptr|sqlite_dbdata|sqlite_stmt|dbstat|completion|bytecode|tables_used|generate_series)\b/i;

const SQLITE_FORBIDDEN_PRAGMA_TVF_RE = /\bpragma_[a-z0-9_]+\b/i;

const SQLITE_ALLOWED_PREFIX_RE =
  /^(?:SELECT\b|EXPLAIN\s+QUERY\s+PLAN\s+SELECT\b|PRAGMA\s+table_info\s*\()/i;

const SQLITE_STRICT_PRAGMA_TABLE_INFO_RE =
  /^PRAGMA\s+table_info\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*|"[A-Za-z_][A-Za-z0-9_]*")\s*\)$/i;

const SQLITE_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

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

function assertSafeSqliteCompanionFiles(realRoot: string, realDbPath: string): void {
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
      realCompanion = canonicalRealpathSync(companionPath);
    } catch (err) {
      throw new Error(
        `Refused to open SQLite database: companion file "${path.basename(companionPath)}" could not be resolved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (isSamePath(realRoot, realCompanion) || !isPathInsideDir(realRoot, realCompanion)) {
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

function buildImmutableSqliteUri(realPath: string): string | null {
  if (!realPath || realPath.includes('\0')) return null;
  let cleaned = realPath;
  if (/^\\\\\?\\UNC\\/i.test(cleaned) || /^\\\\[^?]/.test(cleaned)) {
    return null;
  }
  if (/^\\\\\?\\[A-Za-z]:\\/.test(cleaned)) {
    cleaned = cleaned.slice(4);
  }
  const posixPath = cleaned.replace(/\\/g, '/');
  const prefixed = posixPath.startsWith('/') ? posixPath : `/${posixPath}`;
  const encoded = prefixed
    .split('/')
    .map((seg, idx) => (idx === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return `file:${encoded}?mode=ro&immutable=1`;
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
    useImmutableUri: boolean,
  ): Promise<{ cliAvailable: boolean; rows: Array<Record<string, unknown>> }> =>
    new Promise((resolve, reject) => {
      const targetArg = useImmutableUri ? buildImmutableSqliteUri(realPath) ?? realPath : realPath;
      const args = useSafeFlag
        ? [
            '-safe',
            '-readonly',
            '-json',
            '-cmd',
            '.timeout 3000',
            '-cmd',
            'PRAGMA query_only = ON;',
            '--',
            targetArg,
            sql,
          ]
        : [
            '-readonly',
            '-json',
            '-cmd',
            '.timeout 3000',
            '-cmd',
            'PRAGMA query_only = ON;',
            '--',
            targetArg,
            sql,
          ];

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
              runExec(false, useImmutableUri).then(resolve, reject);
              return;
            }
            // Fallback for WAL-mode SQLite DBs residing in read-only directories where sqlite3 -readonly
            // cannot create a -shm index file: retry with immutable=1 URI (strictly zero locks & zero disk writes).
            if (
              !useImmutableUri &&
              /unable to open database file|attempt to write a readonly database|SQLITE_CANTOPEN/i.test(detail)
            ) {
              runExec(useSafeFlag, true).then(resolve, reject);
              return;
            }
            if (/database disk image is malformed|file is not a database|malformed|corrupt/i.test(detail)) {
              reject(
                new Error(
                  `SQLite database appears corrupted or unreadable (gracefully skipped): ${redactStudioSecrets(detail)}`,
                ),
              );
              return;
            }
            if (/database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(detail)) {
              reject(
                new Error(
                  `SQLite database is temporarily locked by another writer (read-only query timed out cleanly): ${redactStudioSecrets(detail)}`,
                ),
              );
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

  return runExec(true, false);
}

function quoteSqliteIdentifier(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export async function inspectSqliteDatabase(
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
  const tableTargets = masterRes.rows
    .slice(0, 30)
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name : '',
      type: row.type === 'view' ? ('view' as const) : ('table' as const),
    }))
    .filter((t) => Boolean(t.name) && !t.name.includes('\0'));

  // Fast path: fetch all table columns in ONE short-lived read-only sqlite3 process to avoid
  // spawning 30 sequential subprocesses or prolonging read locks against active WAL writers.
  let usedBatchedSchema = false;
  if (tableTargets.length > 0) {
    try {
      const batchRes = await execSqliteJson(
        sqliteBin,
        realRoot,
        realPath,
        "SELECT m.name AS table_name, m.type AS table_type, p.cid, p.name, p.type, p.\"notnull\", p.pk, p.dflt_value FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.type, m.name, p.cid LIMIT 1500",
      );
      if (batchRes.cliAvailable) {
        const colsByTable = new Map<string, StudioSqliteColumnInfo[]>();
        for (const c of batchRes.rows) {
          const tName = typeof c.table_name === 'string' ? c.table_name : '';
          if (!tName) continue;
          const list = colsByTable.get(tName) ?? [];
          list.push({
            cid: Number(c.cid ?? 0),
            name: String(c.name ?? ''),
            type: String(c.type ?? ''),
            notnull: Boolean(c.notnull),
            pk: Boolean(c.pk),
            dfltValue: c.dflt_value === null || c.dflt_value === undefined ? null : String(c.dflt_value),
          });
          colsByTable.set(tName, list);
        }
        if (colsByTable.size > 0) {
          for (const target of tableTargets) {
            tables.push({
              name: target.name,
              type: target.type,
              columns: colsByTable.get(target.name) ?? [],
            });
          }
          usedBatchedSchema = true;
        }
      }
    } catch {
      // Fallback for older SQLite builds without table-valued pragma_table_info
    }
  }

  if (!usedBatchedSchema) {
    for (const target of tableTargets) {
      try {
        const pragmaSql = `PRAGMA table_info(${quoteSqliteIdentifier(target.name)})`;
        const colRes = await execSqliteJson(sqliteBin, realRoot, realPath, pragmaSql);
        const columns: StudioSqliteColumnInfo[] = colRes.rows.map((c) => ({
          cid: Number(c.cid ?? 0),
          name: String(c.name ?? ''),
          type: String(c.type ?? ''),
          notnull: Boolean(c.notnull),
          pk: Boolean(c.pk),
          dfltValue: c.dflt_value === null || c.dflt_value === undefined ? null : String(c.dflt_value),
        }));
        tables.push({ name: target.name, type: target.type, columns });
      } catch {
        // Gracefully skip unreadable/corrupt individual table schema
        tables.push({ name: target.name, type: target.type, columns: [] });
      }
    }
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
