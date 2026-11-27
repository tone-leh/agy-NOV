import path from 'node:path';
import {
  extractTextOutline,
  sliceDocumentLines,
  type StudioDocumentResult,
  type StudioInspectDocumentOptions,
} from './documents.js';
import {
  ALLOWED_HTTP_METHODS,
  sanitizeHeadersMap,
  validateLoopbackProbeUrl,
  type StudioHttpProbeOptions,
  type StudioHttpProbeResult,
} from './http-probe.js';
import {
  createDemoOpenApiSpec,
  type ParsedOpenApiSpec,
} from './openapi.js';
import {
  clampDataLimit,
  isSensitiveStudioPath,
  redactStudioSecrets,
  rowMatchesFilter,
  type StudioDataResult,
  type StudioInspectDataOptions,
  type StudioSourceFilterCategory,
  type StudioSourceItem,
  type StudioSourcesResult,
  type StudioSqliteTableSchema,
} from './sources.js';
import { validateReadOnlySqliteQuery } from './sqlite.js';

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
      const sliced = sliceDocumentLines(allLines, opts.startLine, opts.maxLines);
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
      const sliced = sliceDocumentLines(allLines, opts.startLine, opts.maxLines);
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
      const sliced = sliceDocumentLines(allLines, opts.startLine, opts.maxLines);
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
      const sliced = sliceDocumentLines(allLines, opts.startLine, opts.maxLines);
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
