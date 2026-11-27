import path from 'node:path';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  createDemoStudioService,
  inspectStudioData,
  inspectStudioDocument,
  listStudioSources,
  parseStudioOpenApiFile,
  runLoopbackHttpProbe,
  STUDIO_HTTP_MAX_TIMEOUT_MS,
  STUDIO_HTTP_MIN_TIMEOUT_MS,
  STUDIO_MAX_DATA_ROWS,
  STUDIO_MAX_DOC_LINES,
  type DemoStudioService,
  type ParsedOpenApiSpec,
  type StudioDataResult,
  type StudioDocumentResult,
  type StudioHttpProbeOptions,
  type StudioHttpProbeResult,
  type StudioInspectDataOptions,
  type StudioInspectDocumentOptions,
  type StudioSourceFilterCategory,
  type StudioSourcesResult,
} from './core.js';
import {
  FILE_VIEWER_EXTENSIONS,
  openNativeFileViewer,
  type NativeFileViewerResult,
} from './file-viewer.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SOURCE_CATEGORY_ENUM = z.enum(['all', 'data', 'document', 'openapi']);
const HTTP_METHOD_ENUM = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function formatSourcesSummary(result: StudioSourcesResult): string {
  const lines: string[] = [
    `Workspace Studio sources (${result.mode}) — total=${result.counts.total} (data=${result.counts.data}, document=${result.counts.document}, openapi=${result.counts.openapi}), showing ${result.sources.length}`,
  ];
  if (result.sources.length === 0) {
    lines.push('(no matching local data, document, or OpenAPI sources found)');
    return lines.join('\n');
  }
  for (const src of result.sources.slice(0, 40)) {
    const oversizedTag = src.oversized ? ' [>10MiB]' : '';
    lines.push(`- [${src.category}/${src.format}] ${src.relPath} (${src.bytes} B)${oversizedTag}`);
  }
  if (result.sources.length > 40) {
    lines.push(`… and ${result.sources.length - 40} more source(s).`);
  }
  return lines.join('\n');
}

function formatDataSummary(result: StudioDataResult): string {
  const lines: string[] = [result.summary];
  if (result.columns.length > 0) {
    lines.push(`Columns: ${result.columns.join(', ')}`);
  }
  if (result.sqlite && !result.sqlite.sqliteCliAvailable && result.sqlite.note) {
    lines.push(`Note: ${result.sqlite.note}`);
  }
  for (const row of result.rows.slice(0, 10)) {
    lines.push(`  ${JSON.stringify(row)}`);
  }
  if (result.rows.length > 10) {
    lines.push(`  … (${result.rows.length - 10} more row(s) in structuredContent)`);
  }
  return lines.join('\n');
}

function formatDocumentSummary(result: StudioDocumentResult): string {
  const lines: string[] = [
    `${result.filePath} (${result.format}, ${result.bytes} B, lines ${result.startLine}-${result.endLine}/${result.totalLines}${result.truncated ? ', truncated' : ''})`,
  ];
  if (result.openApiSpec) {
    lines.push(
      `OpenAPI ${result.openApiSpec.specVersion}: ${result.openApiSpec.title}${result.openApiSpec.apiVersion ? ` v${result.openApiSpec.apiVersion}` : ''} (${result.openApiSpec.totalEndpoints} endpoint(s))`,
    );
  }
  if (result.outline.length > 0) {
    lines.push(
      `Outline (${result.outline.length}):\n${result.outline
        .slice(0, 20)
        .map((item) => `  L${item.line} [${item.kind}] ${item.title}`)
        .join('\n')}`,
    );
  }
  lines.push(result.content ? `Content:\n${result.content}` : 'Content: (empty)');
  return lines.join('\n');
}

function formatHttpProbeSummary(result: StudioHttpProbeResult): string {
  const lines: string[] = [
    `Loopback HTTP Probe (${result.mode}): ${result.method} ${result.url} -> ${result.status} ${result.statusText} (${result.elapsedMs}ms, ${result.bodyBytes} B${result.truncated ? ', truncated at 64 KiB' : ''})`,
  ];
  if (result.redirected && result.location) {
    lines.push(`Redirect (not followed): Location -> ${result.location}`);
  }
  if (result.bodyText) {
    const preview =
      result.bodyText.length > 1200 ? `${result.bodyText.slice(0, 1200)}…` : result.bodyText;
    lines.push(`Body:\n${preview}`);
  }
  return lines.join('\n');
}

export function registerStudioModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const getWorkspaceRoot = () => path.resolve(options.workspaceRoot);
  const isDemo = options.demoMode === true;

  // Strictly zero disk I/O and zero network calls during registration.
  const demoService: DemoStudioService | null = isDemo
    ? createDemoStudioService(getWorkspaceRoot())
    : null;

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const runListSources = (category?: StudioSourceFilterCategory): StudioSourcesResult =>
    isDemo && demoService
      ? demoService.listSources(category)
      : listStudioSources(getWorkspaceRoot(), { category });

  const runInspectData = async (opts: StudioInspectDataOptions): Promise<StudioDataResult> =>
    isDemo && demoService
      ? demoService.inspectData(opts)
      : inspectStudioData(getWorkspaceRoot(), opts);

  const runInspectDocument = (opts: StudioInspectDocumentOptions): StudioDocumentResult =>
    isDemo && demoService
      ? demoService.inspectDocument(opts)
      : inspectStudioDocument(getWorkspaceRoot(), opts);

  const runHttpProbe = async (opts: StudioHttpProbeOptions): Promise<StudioHttpProbeResult> =>
    isDemo && demoService ? demoService.httpProbe(opts) : runLoopbackHttpProbe(opts);

  const runParseOpenApi = (filePath: string): ParsedOpenApiSpec =>
    isDemo && demoService
      ? demoService.parseOpenApi(filePath)
      : parseStudioOpenApiFile(getWorkspaceRoot(), filePath);

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: studio_list_sources
  const listSourcesTool = server.registerTool(
    'studio_list_sources',
    {
      title: 'List Workspace Studio Sources',
      description:
        'Discover local data files (SQLite/CSV/TSV/JSON/NDJSON), offline documents (DOCX/XLSX/PDF/Markdown/HTML/SVG/YAML/XML), and OpenAPI specs inside the workspace while strictly skipping sensitive paths and escaping symlinks.',
      inputSchema: {
        category: SOURCE_CATEGORY_ENUM.optional().describe(
          'Optional category filter: all, data, document, or openapi',
        ),
      },
    },
    async ({ category }) => {
      try {
        const result = runListSources(category);
        return {
          content: [{ type: 'text', text: formatSourcesSummary(result) }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('studio_list_sources', listSourcesTool));

  // 2. Model-visible: studio_inspect_data
  const inspectDataTool = server.registerTool(
    'studio_inspect_data',
    {
      title: 'Inspect Local Dataset or SQLite (Read-Only)',
      description:
        'Inspect CSV/TSV, JSON/NDJSON, or SQLite (.sqlite/.db/.sqlite3) files inside the workspace (<= 10 MiB). For SQLite, returns schema overview by default or executes strictly validated single-statement read-only SELECT / EXPLAIN QUERY PLAN SELECT / PRAGMA table_info(...) queries.',
      inputSchema: {
        filePath: z.string().min(1).describe('Relative or workspace-scoped data file path'),
        query: z
          .string()
          .max(4000)
          .optional()
          .describe('Optional read-only SQLite query (SELECT / EXPLAIN QUERY PLAN SELECT / PRAGMA table_info)'),
        filter: z
          .string()
          .max(200)
          .optional()
          .describe('Optional case-insensitive substring filter applied to rows'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(STUDIO_MAX_DATA_ROWS)
          .optional()
          .describe('Maximum rows to return (1-100, default 50)'),
      },
    },
    async ({ filePath, query, filter, limit }) => {
      try {
        const result = await runInspectData({ filePath, query, filter, limit });
        return {
          content: [{ type: 'text', text: formatDataSummary(result) }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('studio_inspect_data', inspectDataTool));

  // 3. Model-visible: studio_inspect_document
  const inspectDocumentTool = server.registerTool(
    'studio_inspect_document',
    {
      title: 'Inspect & Slice Document Offline',
      description:
        'Extract outlines, metadata, and bounded line slices (<= 200 lines) from Markdown, TXT, HTML, SVG, YAML, XML, DOCX, XLSX, or PDF files purely in Node.js with zero external binaries and ZIP-bomb protection.',
      inputSchema: {
        filePath: z.string().min(1).describe('Relative or workspace-scoped document file path'),
        startLine: z.number().int().min(1).optional().describe('1-based starting line number (default 1)'),
        maxLines: z
          .number()
          .int()
          .min(1)
          .max(STUDIO_MAX_DOC_LINES)
          .optional()
          .describe('Maximum lines to return (1-200, default 80)'),
      },
    },
    async ({ filePath, startLine, maxLines }) => {
      try {
        const result = runInspectDocument({ filePath, startLine, maxLines });
        return {
          content: [{ type: 'text', text: formatDocumentSummary(result) }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('studio_inspect_document', inspectDocumentTool));

  // 4. Model-visible: studio_http_probe
  const httpProbeTool = server.registerTool(
    'studio_http_probe',
    {
      title: 'Loopback-Only HTTP Probe',
      description:
        'Send a bounded HTTP probe strictly to local loopback targets (127.0.0.1, localhost, or [::1]) with redirect: manual, 64 KiB response cap, and automatic header/body secret redaction.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .max(2048)
          .describe('Loopback URL (http/https to 127.0.0.1, localhost, or [::1] only)'),
        method: HTTP_METHOD_ENUM.optional().describe('HTTP method (default GET)'),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional HTTP request headers (sensitive values are redacted in results)'),
        body: z.string().max(128 * 1024).optional().describe('Optional request body for non-GET/HEAD requests'),
        timeoutMs: z
          .number()
          .int()
          .min(STUDIO_HTTP_MIN_TIMEOUT_MS)
          .max(STUDIO_HTTP_MAX_TIMEOUT_MS)
          .optional()
          .describe('Request timeout in milliseconds (1000-15000, default 5000)'),
      },
    },
    async ({ url, method, headers, body, timeoutMs }) => {
      try {
        const result = await runHttpProbe({ url, method, headers, body, timeoutMs });
        return {
          content: [{ type: 'text', text: formatHttpProbeSummary(result) }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('studio_http_probe', httpProbeTool));

  // App-only tools (4)
  server.registerTool(
    'app_studio_list_sources',
    {
      title: 'List Workspace Studio Sources (App Only)',
      description: 'Fetch categorized workspace data, document, and OpenAPI assets for the Studio UI tab.',
      inputSchema: {
        category: SOURCE_CATEGORY_ENUM.optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ category }) => {
      try {
        const result = runListSources(category);
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_studio_inspect_data',
    {
      title: 'Inspect Local Dataset (App Only)',
      description: 'Inspect CSV/TSV/JSON/NDJSON or run a read-only SQLite query from the Studio UI.',
      inputSchema: {
        filePath: z.string().min(1),
        query: z.string().max(4000).optional(),
        filter: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(STUDIO_MAX_DATA_ROWS).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ filePath, query, filter, limit }) => {
      try {
        const result = await runInspectData({ filePath, query, filter, limit });
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_studio_inspect_document',
    {
      title: 'Inspect Document Offline (App Only)',
      description: 'Slice Markdown/TXT/HTML/SVG/YAML/XML/DOCX/XLSX/PDF documents from the Studio UI.',
      inputSchema: {
        filePath: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        maxLines: z.number().int().min(1).max(STUDIO_MAX_DOC_LINES).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ filePath, startLine, maxLines }) => {
      try {
        const result = runInspectDocument({ filePath, startLine, maxLines });
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_studio_http_probe',
    {
      title: 'Loopback HTTP Probe (App Only)',
      description: 'Execute a strict loopback-only HTTP probe from the Studio UI.',
      inputSchema: {
        url: z.string().min(1).max(2048),
        method: HTTP_METHOD_ENUM.optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().max(128 * 1024).optional(),
        timeoutMs: z
          .number()
          .int()
          .min(STUDIO_HTTP_MIN_TIMEOUT_MS)
          .max(STUDIO_HTTP_MAX_TIMEOUT_MS)
          .optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ url, method, headers, body, timeoutMs }) => {
      try {
        const result = await runHttpProbe({ url, method, headers, body, timeoutMs });
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_studio_parse_openapi',
    {
      title: 'Parse OpenAPI Spec (App Only)',
      description:
        'Parse a local OpenAPI 3.x or Swagger 2.0 JSON/YAML specification into structured loopback-ready endpoints for the Studio UI.',
      inputSchema: {
        filePath: z.string().min(1),
      },
      _meta: APP_ONLY_META,
    },
    async ({ filePath }) => {
      try {
        const result = runParseOpenApi(filePath);
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  const FILE_VIEWER_META = {
    ui: { resourceUri: uiResourceUri, visibility: ['app'] as ['app'] },
    'com.google.antigravity/ui': {
      entrypoints: [
        {
          type: 'file',
          extensions: [...FILE_VIEWER_EXTENSIONS],
          title: 'agy-NOV File Viewer',
        },
      ],
    },
  };

  const formatFileViewerText = (res: NativeFileViewerResult): string => {
    if (res.kind === 'opaque-uri') {
      return `agy-NOV File Viewer (opaque URI): ${res.fileName} -> ${res.targetTab} (${res.note ?? 'read-only metadata'})`;
    }
    if (res.kind === 'svg') {
      return `agy-NOV File Viewer (SVG): ${res.fileName} -> canvas (${res.bytes ?? 0} B, ${res.svg?.lineCount ?? 0} lines)`;
    }
    if (res.kind === 'openapi') {
      return `agy-NOV File Viewer (OpenAPI): ${res.fileName} -> studio (${res.openApi?.totalEndpoints ?? 0} endpoints)`;
    }
    return `agy-NOV File Viewer (Data): ${res.fileName} -> studio (${res.data?.returnedRows ?? 0} rows)`;
  };

  server.registerTool(
    'app_nov_file_viewer',
    {
      title: 'agy-NOV Native File Viewer (App Only)',
      description:
        'Read-only MCP Apps file entrypoint for SQLite, CSV/TSV, SVG, and OpenAPI YAML files with strict workspace realpath boundaries and SVG sanitization.',
      inputSchema: {
        file: z
          .object({
            name: z.string().optional(),
            resourceUri: z.string().optional(),
            uri: z.string().optional(),
          })
          .optional(),
        path: z.string().optional(),
        limit: z.number().int().min(1).max(STUDIO_MAX_DATA_ROWS).optional(),
      },
      _meta: FILE_VIEWER_META,
    },
    async ({ file, path: filePath, limit }) => {
      try {
        const result = await openNativeFileViewer(
          { file, path: filePath, limit },
          { workspaceRoot: getWorkspaceRoot, demoMode: isDemo, demoService },
        );
        return {
          content: [{ type: 'text', text: formatFileViewerText(result) }],
          structuredContent: {
            novModule: result.targetTab,
            fileViewer: result,
          },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  return {
    moduleId: 'studio',
    modelTools,
    exemptReadOnlyAppTools: ['app_studio_list_sources', 'app_nov_file_viewer'],
  };
}
