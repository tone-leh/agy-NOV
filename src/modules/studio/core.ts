import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import { inspectCsvOrTsv, inspectJsonOrNdjson } from './csv.js';
import {
  clampDataLimit,
  isSensitiveStudioPath,
  resolveStudioWorkspaceFile,
  STUDIO_MAX_FILE_BYTES,
  type ResolvedStudioFile,
  type StudioDataResult,
  type StudioInspectDataOptions,
} from './sources.js';
import { inspectSqliteDatabase } from './sqlite.js';

export const STUDIO_SQLITE_MAX_FILE_BYTES = 256 * 1024 * 1024; // 256 MiB read-only CLI cap (never loads whole DB into memory)

// ============================================================================
// Workspace Studio Public Facade (100% Backward-Compatible Re-Exports)
// ============================================================================

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

export {
  isSensitiveStudioPath,
  listStudioSources,
  redactStudioSecrets,
  resolveStudioWorkspaceFile,
  STUDIO_DEFAULT_DATA_ROWS,
  STUDIO_MAX_DATA_ROWS,
  STUDIO_MAX_FILE_BYTES,
  STUDIO_MAX_SCAN_DEPTH,
  STUDIO_MAX_SCAN_FILES,
  type ResolvedStudioFile,
  type StudioDataResult,
  type StudioInspectDataOptions,
  type StudioSourceCategory,
  type StudioSourceFilterCategory,
  type StudioSourceFormat,
  type StudioSourceItem,
  type StudioSourcesResult,
  type StudioSqliteColumnInfo,
  type StudioSqliteTableSchema,
} from './sources.js';

export { parseDelimitedRecords } from './csv.js';

export {
  STUDIO_SQLITE_MAX_BUFFER_BYTES,
  STUDIO_SQLITE_TIMEOUT_MS,
  validateReadOnlySqliteQuery,
} from './sqlite.js';

export {
  inspectStudioDocument,
  STUDIO_DEFAULT_DOC_LINES,
  STUDIO_MAX_DOC_LINES,
  STUDIO_PDF_MAX_STREAM_BYTES,
  STUDIO_ZIP_MAX_ENTRIES,
  STUDIO_ZIP_MAX_ENTRY_BYTES,
  STUDIO_ZIP_MAX_TOTAL_BYTES,
  type StudioDocumentOutlineItem,
  type StudioDocumentResult,
  type StudioDocumentSheetPreview,
  type StudioInspectDocumentOptions,
} from './documents.js';

export {
  runLoopbackHttpProbe,
  sanitizeHeadersMap,
  STUDIO_HTTP_DEFAULT_TIMEOUT_MS,
  STUDIO_HTTP_MAX_BODY_BYTES,
  STUDIO_HTTP_MAX_TIMEOUT_MS,
  STUDIO_HTTP_MIN_TIMEOUT_MS,
  validateLoopbackProbeUrl,
  type StudioHttpProbeOptions,
  type StudioHttpProbeResult,
} from './http-probe.js';

export {
  createDemoStudioService,
  type DemoStudioService,
} from './demo.js';

// ============================================================================
// Top-Level Data Inspection Dispatcher (studio_inspect_data)
// ============================================================================

function isSqliteExtension(ext: string): boolean {
  return ext === '.sqlite' || ext === '.sqlite3' || ext === '.db';
}

function resolveStudioDataFile(
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

  const ext = path.extname(relPath).toLowerCase();
  if (!isSqliteExtension(ext)) {
    // Non-SQLite text/CSV/JSON files keep the existing 10 MiB full-read safety gate
    return resolveStudioWorkspaceFile(workspaceRoot, targetPath);
  }

  const stat = fs.statSync(realTarget);
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${relPath}`);
  }
  if (stat.size > STUDIO_SQLITE_MAX_FILE_BYTES) {
    throw new Error(
      `SQLite file exceeds 256 MiB Studio read-only size limit (${stat.size} bytes > ${STUDIO_SQLITE_MAX_FILE_BYTES} bytes): ${relPath}`,
    );
  }

  return { realRoot, realTarget, relPath, stat };
}

export async function inspectStudioData(
  workspaceRoot: string,
  opts: StudioInspectDataOptions,
): Promise<StudioDataResult> {
  const resolved = resolveStudioDataFile(workspaceRoot, opts.filePath);
  const ext = path.extname(resolved.relPath).toLowerCase();
  const limit = clampDataLimit(opts.limit);

  if (isSqliteExtension(ext)) {
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
