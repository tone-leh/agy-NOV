import fs from 'node:fs';
import path from 'node:path';
import { inspectCsvOrTsv, inspectJsonOrNdjson } from './csv.js';
import {
  clampDataLimit,
  resolveStudioWorkspaceFile,
  type StudioDataResult,
  type StudioInspectDataOptions,
} from './sources.js';
import { inspectSqliteDatabase } from './sqlite.js';

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
