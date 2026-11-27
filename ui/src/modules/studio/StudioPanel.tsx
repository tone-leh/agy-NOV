import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n, type ResolvedUiLocale } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type StudioTab = 'data' | 'docs' | 'http';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

interface StudioSourceItem {
  relPath?: string;
  filePath?: string;
  name?: string;
  category?: 'data' | 'document' | 'openapi' | string;
  format?: string;
  kind?: string;
  extension?: string;
  bytes?: number;
  updatedAt?: string;
  oversized?: boolean;
}

interface StudioSourcesResult {
  mode?: string;
  workspaceRoot?: string;
  sources: StudioSourceItem[];
  counts?: {
    total?: number;
    data?: number;
    document?: number;
    openapi?: number;
  };
  skippedSensitive?: number;
  skippedSymlinks?: number;
  truncated?: boolean;
}

interface StudioSqliteColumnInfo {
  cid?: number;
  name: string;
  type?: string;
  notnull?: boolean;
  pk?: boolean;
}

interface StudioSqliteTableSchema {
  name: string;
  type?: string;
  columns?: StudioSqliteColumnInfo[];
}

interface StudioDataResult {
  mode?: string;
  filePath: string;
  format?: string;
  kind?: string;
  bytes?: number;
  columns?: string[];
  rows?: Array<Record<string, unknown> | unknown[]>;
  totalRows?: number;
  returnedRows?: number;
  truncated?: boolean;
  filter?: string;
  query?: string;
  summary?: string;
  previewText?: string;
  warning?: string;
  tables?: Array<string | StudioSqliteTableSchema>;
  jsonSummary?: {
    rootType?: string;
    topLevelKeys?: string[];
    itemCount?: number;
    parseErrors?: number;
  };
  sqlite?: {
    sqliteCliAvailable?: boolean;
    headerFormat?: string;
    pageSize?: number;
    tables?: StudioSqliteTableSchema[];
    executedSql?: string;
    note?: string;
  };
}

interface StudioDocumentOutlineItem {
  level?: number;
  title?: string;
  text?: string;
  line?: number;
  kind?: string;
}

interface StudioDocumentSheetPreview {
  name: string;
  rows: string[][];
  totalRows?: number;
}

interface OpenApiServerEntry {
  url: string;
  description?: string;
  isLoopback: boolean;
}

interface OpenApiEndpointItem {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  path: string;
  summary?: string;
  operationId?: string;
  tags: string[];
  parameters: Array<{ name: string; in: string; required: boolean; example?: string }>;
  sampleHeaders: Record<string, string>;
  sampleBody?: string;
  resolvedLoopbackUrl: string;
}

interface ParsedOpenApiSpec {
  filePath: string;
  specVersion: string;
  title: string;
  apiVersion?: string;
  servers: OpenApiServerEntry[];
  endpoints: OpenApiEndpointItem[];
  totalEndpoints: number;
  truncated: boolean;
  warnings: string[];
}

interface StudioDocumentResult {
  mode?: string;
  filePath: string;
  format?: string;
  kind?: string;
  bytes?: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
  outline?: StudioDocumentOutlineItem[];
  headings?: Array<string | StudioDocumentOutlineItem>;
  content?: string;
  metadata?: Record<string, unknown>;
  sheets?: StudioDocumentSheetPreview[];
  openApiSpec?: ParsedOpenApiSpec;
  warning?: string;
}

interface StudioHttpProbeResult {
  mode?: string;
  url: string;
  method: string;
  status: number;
  statusText?: string;
  ok?: boolean;
  elapsedMs?: number;
  durationMs?: number;
  redirected?: boolean;
  location?: string;
  redirectedLocation?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  headers?: Record<string, string>;
  contentType?: string;
  bodyText?: string;
  body?: string;
  bodyBytes?: number;
  truncated?: boolean;
}

const STUDIO_AUX_LABELS: Record<
  ResolvedUiLocale,
  {
    startLine: string;
    maxLines: string;
    limitRows: string;
    prevSlice: string;
    nextSlice: string;
    outlineTitle: string;
    tablesTitle: string;
    headersTitle: string;
    responseBody: string;
    invalidJsonHeaders: string;
    redirectLabel: string;
    sheetsTitle: string;
    linesRange: string;
  }
> = {
  en: {
    startLine: 'Start Line',
    maxLines: 'Max Lines',
    limitRows: 'Row Limit',
    prevSlice: 'Prev Slice',
    nextSlice: 'Next Slice',
    outlineTitle: 'Outline',
    tablesTitle: 'SQLite Tables',
    headersTitle: 'Redacted Response Headers',
    responseBody: 'Response Body',
    invalidJsonHeaders: 'Headers must be a valid JSON object of string key/value pairs.',
    redirectLabel: 'Redirect (not followed)',
    sheetsTitle: 'Sheet Previews',
    linesRange: 'Lines',
  },
  'zh-CN': {
    startLine: '起始行',
    maxLines: '最大行数',
    limitRows: '行数上限',
    prevSlice: '上一片',
    nextSlice: '下一片',
    outlineTitle: '文档大纲',
    tablesTitle: 'SQLite 数据表',
    headersTitle: '脱敏响应头',
    responseBody: '响应正文',
    invalidJsonHeaders: '请求头必须是合法的 JSON 字符串键值对象。',
    redirectLabel: '重定向目标（未自动跟随）',
    sheetsTitle: '工作表预览',
    linesRange: '行范围',
  },
  'zh-TW': {
    startLine: '起始行',
    maxLines: '最大行數',
    limitRows: '列數上限',
    prevSlice: '上一片',
    nextSlice: '下一片',
    outlineTitle: '文件大綱',
    tablesTitle: 'SQLite 資料表',
    headersTitle: '去敏回應標頭',
    responseBody: '回應內容',
    invalidJsonHeaders: '請求標頭必須是合法的 JSON 字串鍵值物件。',
    redirectLabel: '重新導向目標（未自動跟隨）',
    sheetsTitle: '工作表預覽',
    linesRange: '行範圍',
  },
  ja: {
    startLine: '開始行',
    maxLines: '最大行数',
    limitRows: '最大件数',
    prevSlice: '前のスライス',
    nextSlice: '次のスライス',
    outlineTitle: 'アウトライン',
    tablesTitle: 'SQLite テーブル',
    headersTitle: 'マスク済みレスポンスヘッダー',
    responseBody: 'レスポンス本文',
    invalidJsonHeaders: 'ヘッダーは文字列キー/値の有効な JSON オブジェクトにしてください。',
    redirectLabel: 'リダイレクト先（自動追跡なし）',
    sheetsTitle: 'シートプレビュー',
    linesRange: '行範囲',
  },
  ko: {
    startLine: '시작 행',
    maxLines: '최대 행',
    limitRows: '행 제한',
    prevSlice: '이전 조각',
    nextSlice: '다음 조각',
    outlineTitle: '개요',
    tablesTitle: 'SQLite 테이블',
    headersTitle: '마스킹된 응답 헤더',
    responseBody: '응답 본문',
    invalidJsonHeaders: '헤더는 문자열 키/값으로 이루어진 유효한 JSON 객체여야 합니다.',
    redirectLabel: '리다이렉트 위치 (자동 이동 안 함)',
    sheetsTitle: '시트 미리보기',
    linesRange: '행 범위',
  },
  es: {
    startLine: 'Línea inicial',
    maxLines: 'Máx. líneas',
    limitRows: 'Límite de filas',
    prevSlice: 'Anterior',
    nextSlice: 'Siguiente',
    outlineTitle: 'Esquema',
    tablesTitle: 'Tablas SQLite',
    headersTitle: 'Cabeceras de respuesta redactadas',
    responseBody: 'Cuerpo de respuesta',
    invalidJsonHeaders: 'Las cabeceras deben ser un objeto JSON válido de clave/valor.',
    redirectLabel: 'Redirección (no seguida)',
    sheetsTitle: 'Vista previa de hojas',
    linesRange: 'Líneas',
  },
  fr: {
    startLine: 'Ligne début',
    maxLines: 'Max lignes',
    limitRows: 'Limite lignes',
    prevSlice: 'Précédent',
    nextSlice: 'Suivant',
    outlineTitle: 'Plan',
    tablesTitle: 'Tables SQLite',
    headersTitle: 'En-têtes de réponse expurgés',
    responseBody: 'Corps de réponse',
    invalidJsonHeaders: 'Les en-têtes doivent être un objet JSON valide de paires clé/valeur.',
    redirectLabel: 'Redirection (non suivie)',
    sheetsTitle: 'Aperçu des feuilles',
    linesRange: 'Lignes',
  },
  de: {
    startLine: 'Startzeile',
    maxLines: 'Max. Zeilen',
    limitRows: 'Zeilenlimit',
    prevSlice: 'Vorheriger Auszug',
    nextSlice: 'Nächster Auszug',
    outlineTitle: 'Gliederung',
    tablesTitle: 'SQLite-Tabellen',
    headersTitle: 'Zensierte Antwort-Header',
    responseBody: 'Antworttext',
    invalidJsonHeaders: 'Header müssen ein gültiges JSON-Objekt mit Zeichenketten sein.',
    redirectLabel: 'Weiterleitung (nicht gefolgt)',
    sheetsTitle: 'Tabellenblatt-Vorschau',
    linesRange: 'Zeilen',
  },
};

const DATA_FORMATS = new Set(['sqlite', 'csv', 'tsv', 'json', 'ndjson']);

function getSourcePath(src: StudioSourceItem): string {
  return src.relPath ?? src.filePath ?? src.name ?? '';
}

function getSourceFormat(src: StudioSourceItem): string {
  return (src.format ?? src.kind ?? src.extension?.replace(/^\./, '') ?? 'file').toLowerCase();
}

function isDataSource(src: StudioSourceItem): boolean {
  if (src.category === 'data') return true;
  if (src.category === 'document' || src.category === 'openapi') return false;
  return DATA_FORMATS.has(getSourceFormat(src));
}

function isOpenApiSource(src: StudioSourceItem): boolean {
  return src.category === 'openapi' || getSourceFormat(src) === 'openapi';
}

function getHttpMethodStyle(method: string): React.CSSProperties {
  switch (method.toUpperCase()) {
    case 'GET':
      return {
        background: 'var(--nov-success-soft)',
        color: 'var(--nov-success)',
        borderColor: 'var(--nov-success)',
      };
    case 'POST':
      return {
        background: 'var(--nov-accent-soft)',
        color: 'var(--nov-accent)',
        borderColor: 'var(--nov-accent)',
      };
    case 'PUT':
    case 'PATCH':
      return {
        background: 'var(--nov-warn-soft)',
        color: 'var(--nov-warn)',
        borderColor: 'var(--nov-warn)',
      };
    case 'DELETE':
      return {
        background: 'var(--nov-danger-soft)',
        color: 'var(--nov-danger)',
        borderColor: 'var(--nov-danger)',
      };
    default:
      return {
        background: 'var(--nov-bg-2)',
        color: 'var(--nov-text-1)',
        borderColor: 'var(--nov-border-strong)',
      };
  }
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getHttpStatusStyle(status: number): React.CSSProperties {
  if (status >= 200 && status < 300) {
    return {
      background: 'var(--nov-success-soft)',
      color: 'var(--nov-success)',
      borderColor: 'var(--nov-success)',
    };
  }
  if (status >= 300 && status < 400) {
    return {
      background: 'var(--nov-accent-soft)',
      color: 'var(--nov-accent)',
      borderColor: 'var(--nov-accent)',
    };
  }
  if (status >= 400 && status < 500) {
    return {
      background: 'var(--nov-warn-soft)',
      color: 'var(--nov-warn)',
      borderColor: 'var(--nov-warn)',
    };
  }
  return {
    background: 'var(--nov-danger-soft)',
    color: 'var(--nov-danger)',
    borderColor: 'var(--nov-danger)',
  };
}

function escapeSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export const StudioPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict, locale } = useNovI18n();
  const sDict = dict.panels.studio;
  const aux = STUDIO_AUX_LABELS[locale] ?? STUDIO_AUX_LABELS.en;

  const [tab, setTab] = useState<StudioTab>('data');
  const [sourcesState, setSourcesState] = useState<StudioSourcesResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Local Data tab state
  const [dataPath, setDataPath] = useState('');
  const [sqlQuery, setSqlQuery] = useState('');
  const [dataFilter, setDataFilter] = useState('');
  const [dataLimit, setDataLimit] = useState<number>(50);
  const [dataResult, setDataResult] = useState<StudioDataResult | null>(null);

  // Document Slicer tab state
  const [docPath, setDocPath] = useState('');
  const [docStartLine, setDocStartLine] = useState<number>(1);
  const [docMaxLines, setDocMaxLines] = useState<number>(80);
  const [docResult, setDocResult] = useState<StudioDocumentResult | null>(null);

  // Loopback HTTP Probe + OpenAPI collection state
  const [httpMethod, setHttpMethod] = useState<HttpMethod>('GET');
  const [httpUrl, setHttpUrl] = useState('http://127.0.0.1:3000/health');
  const [httpHeadersText, setHttpHeadersText] = useState('');
  const [httpBodyText, setHttpBodyText] = useState('');
  const [httpTimeoutMs, setHttpTimeoutMs] = useState<number>(5000);
  const [httpResult, setHttpResult] = useState<StudioHttpProbeResult | null>(null);
  const [openApiPath, setOpenApiPath] = useState('');
  const [openApiSpec, setOpenApiSpec] = useState<ParsedOpenApiSpec | null>(null);
  const [openApiFilter, setOpenApiFilter] = useState('');
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);

  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    setBusyAction('sources');
    try {
      const res = await bridge.callTool<StudioSourcesResult>('app_studio_list_sources', {});
      setSourcesState(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction((cur) => (cur === 'sources' ? null : cur));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) {
      void loadSources();
    }
  }, [active, loadSources]);

  useEffect(() => {
    if (!active || !incomingEvent) return;
    const tool = incomingEvent.toolName ?? '';
    const mod = incomingEvent.structuredContent?.novModule;
    if (tool.startsWith('studio_') || tool.startsWith('app_studio_') || mod === 'studio') {
      void loadSources();
    }
  }, [active, incomingEvent, loadSources]);

  const inspectData = useCallback(
    async (opts?: { filePath?: string; query?: string; filter?: string; limit?: number }) => {
      const targetPath = (opts?.filePath ?? dataPath).trim();
      if (!targetPath) return;
      const targetQuery = (opts?.query !== undefined ? opts.query : sqlQuery).trim();
      const targetFilter = (opts?.filter !== undefined ? opts.filter : dataFilter).trim();
      const targetLimit = Math.max(1, Math.min(100, opts?.limit ?? dataLimit));

      setBusyAction('inspect:data');
      try {
        const res = await bridge.callTool<StudioDataResult>('app_studio_inspect_data', {
          filePath: targetPath,
          ...(targetQuery ? { query: targetQuery } : {}),
          ...(targetFilter ? { filter: targetFilter } : {}),
          limit: targetLimit,
        });
        setDataResult(res);
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, dataFilter, dataLimit, dataPath, onNotify, sqlQuery],
  );

  const inspectDocument = useCallback(
    async (opts?: { filePath?: string; startLine?: number; maxLines?: number }) => {
      const targetPath = (opts?.filePath ?? docPath).trim();
      if (!targetPath) return;
      const start = Math.max(1, Math.floor(opts?.startLine ?? docStartLine) || 1);
      const max = Math.max(1, Math.min(200, Math.floor(opts?.maxLines ?? docMaxLines) || 80));

      setBusyAction('inspect:doc');
      try {
        const res = await bridge.callTool<StudioDocumentResult>('app_studio_inspect_document', {
          filePath: targetPath,
          startLine: start,
          maxLines: max,
        });
        setDocResult(res);
        if (res.openApiSpec) {
          setOpenApiPath(res.openApiSpec.filePath || targetPath);
          setOpenApiSpec(res.openApiSpec);
        }
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, docMaxLines, docPath, docStartLine, onNotify],
  );

  const parseOpenApi = useCallback(
    async (filePathInput?: string) => {
      const targetPath = (filePathInput ?? openApiPath).trim();
      if (!targetPath) return;

      setBusyAction('parse:openapi');
      try {
        const res = await bridge.callTool<ParsedOpenApiSpec>('app_studio_parse_openapi', {
          filePath: targetPath,
        });
        setOpenApiPath(targetPath);
        setOpenApiSpec(res);
        setSelectedEndpointId(null);
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, onNotify, openApiPath],
  );

  const handleLoadEndpoint = useCallback((ep: OpenApiEndpointItem) => {
    setHttpMethod(ep.method);
    setHttpUrl(ep.resolvedLoopbackUrl);
    const hasHeaders = ep.sampleHeaders && Object.keys(ep.sampleHeaders).length > 0;
    setHttpHeadersText(hasHeaders ? JSON.stringify(ep.sampleHeaders, null, 2) : '');
    setHttpBodyText(ep.sampleBody ?? '');
    setSelectedEndpointId(ep.id);
    setTab('http');
  }, []);

  const handleSelectSource = (src: StudioSourceItem) => {
    if (busyAction) return;
    const relPath = getSourcePath(src);
    if (!relPath) return;
    if (isOpenApiSource(src)) {
      setTab('http');
      setOpenApiPath(relPath);
      setOpenApiFilter('');
      void parseOpenApi(relPath);
    } else if (isDataSource(src)) {
      setTab('data');
      setDataPath(relPath);
      setSqlQuery('');
      setDataFilter('');
      void inspectData({ filePath: relPath, query: '', filter: '', limit: dataLimit });
    } else {
      setTab('docs');
      setDocPath(relPath);
      setDocStartLine(1);
      void inspectDocument({ filePath: relPath, startLine: 1, maxLines: docMaxLines });
    }
  };

  const handleHttpProbe = async () => {
    const cleanUrl = httpUrl.trim();
    if (!cleanUrl || busyAction) return;

    let parsedHeaders: Record<string, string> | undefined;
    const rawHeaders = httpHeadersText.trim();
    if (rawHeaders) {
      try {
        const obj = JSON.parse(rawHeaders) as unknown;
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          onNotify?.(aux.invalidJsonHeaders);
          return;
        }
        parsedHeaders = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          parsedHeaders[k] = typeof v === 'string' ? v : String(v);
        }
      } catch {
        onNotify?.(aux.invalidJsonHeaders);
        return;
      }
    }

    const canSendBody = httpMethod !== 'GET' && httpMethod !== 'HEAD';
    const cleanBody = canSendBody && httpBodyText.length > 0 ? httpBodyText : undefined;

    setBusyAction('probe:http');
    try {
      const res = await bridge.callTool<StudioHttpProbeResult>('app_studio_http_probe', {
        url: cleanUrl,
        method: httpMethod,
        ...(parsedHeaders ? { headers: parsedHeaders } : {}),
        ...(cleanBody !== undefined ? { body: cleanBody } : {}),
        timeoutMs: httpTimeoutMs,
      });
      setHttpResult(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedTarget(key);
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      // clipboard restricted
    }
  };

  const sources = Array.isArray(sourcesState?.sources) ? sourcesState.sources : [];
  const openApiSources = useMemo(
    () => sources.filter((src) => isOpenApiSource(src) && !src.oversized),
    [sources],
  );
  const filteredOpenApiEndpoints = useMemo(() => {
    if (!openApiSpec || !Array.isArray(openApiSpec.endpoints)) return [];
    const needle = openApiFilter.trim().toLowerCase();
    if (!needle) return openApiSpec.endpoints;
    return openApiSpec.endpoints.filter((ep) => {
      if (ep.method.toLowerCase().includes(needle)) return true;
      if (ep.path.toLowerCase().includes(needle)) return true;
      if (ep.summary?.toLowerCase().includes(needle)) return true;
      if (ep.operationId?.toLowerCase().includes(needle)) return true;
      return ep.tags.some((t) => t.toLowerCase().includes(needle));
    });
  }, [openApiFilter, openApiSpec]);
  const isBusy = busyAction !== null;

  // Normalize SQLite tables from either sqlite.tables or top-level tables
  const sqliteTables = useMemo<StudioSqliteTableSchema[]>(() => {
    if (Array.isArray(dataResult?.sqlite?.tables)) {
      return dataResult.sqlite.tables;
    }
    if (Array.isArray(dataResult?.tables)) {
      return dataResult.tables.map((t) => (typeof t === 'string' ? { name: t } : t));
    }
    return [];
  }, [dataResult]);

  // Normalize tabular columns and rows for both Record[] and unknown[][] shapes
  const normalizedTable = useMemo(() => {
    if (!dataResult) return { columns: [] as string[], rows: [] as string[][] };
    const rawRows = Array.isArray(dataResult.rows) ? dataResult.rows : [];
    let columns = Array.isArray(dataResult.columns) ? [...dataResult.columns] : [];
    if (columns.length === 0 && rawRows.length > 0) {
      const first = rawRows[0];
      if (Array.isArray(first)) {
        columns = first.map((_, idx) => `col_${idx + 1}`);
      } else if (first && typeof first === 'object') {
        columns = Object.keys(first as Record<string, unknown>);
      }
    }
    const rows: string[][] = rawRows.map((row) => {
      if (Array.isArray(row)) {
        return columns.map((_, idx) => formatCellValue(row[idx]));
      }
      const rec = row as Record<string, unknown>;
      return columns.map((col) => formatCellValue(rec[col]));
    });
    return { columns, rows };
  }, [dataResult]);

  // Normalize document outline / headings
  const normalizedOutline = useMemo<StudioDocumentOutlineItem[]>(() => {
    if (Array.isArray(docResult?.outline)) return docResult.outline;
    if (Array.isArray(docResult?.headings)) {
      return docResult.headings.map((h) =>
        typeof h === 'string' ? { level: 1, title: h } : h,
      );
    }
    return [];
  }, [docResult]);

  const docMetadataEntries = useMemo(() => {
    if (!docResult?.metadata || typeof docResult.metadata !== 'object') return [];
    return Object.entries(docResult.metadata).filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim().length > 0,
    );
  }, [docResult]);

  const dataFormat = (dataResult?.format ?? dataResult?.kind ?? '').toUpperCase();
  const dataWarning = dataResult?.warning ?? dataResult?.sqlite?.note;
  const dataPreviewText = dataResult?.previewText ?? dataResult?.summary;
  const docFormat = (docResult?.format ?? docResult?.kind ?? '').toUpperCase();

  const httpElapsed = httpResult?.elapsedMs ?? httpResult?.durationMs;
  const httpRedirect = httpResult?.location ?? httpResult?.redirectedLocation;
  const httpHeadersMap = httpResult?.responseHeaders ?? httpResult?.headers ?? {};
  const httpBodyDisplay = httpResult?.bodyText ?? httpResult?.body ?? '';

  return (
    <div className="nov-p-page">
      {/* Header + Tabs + Discoverable Assets Strip */}
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{sDict.title}</h2>
            <p className="nov-hero-sub">{sDict.subtitle}</p>
          </div>
          <button
            type="button"
            className="nov-p-btn"
            disabled={isBusy}
            onClick={() => void loadSources()}
          >
            {busyAction === 'sources' ? dict.common.loading : sDict.refreshSources}
          </button>
        </div>

        {/* Quick-select workspace assets bar */}
        <div
          className="nov-p-item"
          style={{ background: 'var(--nov-bg-0)', gap: '8px' }}
        >
          <div className="nov-p-row">
            <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
              {sDict.sourcesTitle} ({sourcesState?.counts?.total ?? sources.length})
            </strong>
            {sourcesState?.counts && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <span className="nov-badge is-accent">
                  {sDict.tabData}: {sourcesState.counts.data ?? 0}
                </span>
                <span className="nov-badge is-offline">
                  {sDict.tabDocs}: {sourcesState.counts.document ?? 0}
                </span>
                {(sourcesState.counts.openapi ?? 0) > 0 && (
                  <span className="nov-badge is-network">
                    OpenAPI: {sourcesState.counts.openapi}
                  </span>
                )}
              </div>
            )}
          </div>

          {sources.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--nov-text-2)' }}>
              {sDict.emptySources}
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                maxHeight: '112px',
                overflowY: 'auto',
              }}
            >
              {sources.slice(0, 40).map((src, idx) => {
                const relPath = getSourcePath(src);
                const fmt = getSourceFormat(src).toUpperCase();
                const dataKind = isDataSource(src);
                const openApiKind = isOpenApiSource(src);
                const isSelected =
                  (tab === 'data' && dataPath === relPath) ||
                  (tab === 'docs' && docPath === relPath) ||
                  (tab === 'http' && openApiPath === relPath);
                return (
                  <button
                    key={`${relPath}:${idx}`}
                    type="button"
                    className={`nov-preset-btn ${isSelected ? 'is-active' : ''}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 8px',
                      fontSize: '11.5px',
                    }}
                    disabled={isBusy || src.oversized}
                    title={relPath}
                    onClick={() => handleSelectSource(src)}
                  >
                    <span
                      className={`nov-badge ${
                        openApiKind ? 'is-network' : dataKind ? 'is-accent' : 'is-offline'
                      }`}
                      style={{ fontSize: '10px', padding: '1px 5px' }}
                    >
                      {fmt}
                    </span>
                    <code style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '11px' }}>
                      {relPath}
                    </code>
                    {typeof src.bytes === 'number' && (
                      <span style={{ fontSize: '10.5px', color: 'var(--nov-text-2)' }}>
                        {formatBytes(src.bytes)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="nov-p-tabs">
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'data' ? 'is-active' : ''}`}
            onClick={() => setTab('data')}
          >
            {sDict.tabData}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'docs' ? 'is-active' : ''}`}
            onClick={() => setTab('docs')}
          >
            {sDict.tabDocs}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'http' ? 'is-active' : ''}`}
            onClick={() => setTab('http')}
          >
            {sDict.tabHttp}
          </button>
        </div>
      </section>

      {/* TAB 1: Local Data (SQLite / CSV / JSON) */}
      {tab === 'data' && (
        <section className="nov-p-card">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) 120px auto',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <input
              className="nov-p-input"
              style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
              value={dataPath}
              placeholder={sDict.filePathPlaceholder}
              disabled={isBusy}
              onChange={(e) => setDataPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void inspectData();
                }
              }}
            />
            <select
              className="nov-p-select"
              value={dataLimit}
              disabled={isBusy}
              title={aux.limitRows}
              onChange={(e) => setDataLimit(Number(e.target.value) || 50)}
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {aux.limitRows}: {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy || !dataPath.trim()}
              onClick={() => void inspectData()}
            >
              {busyAction === 'inspect:data' ? dict.common.loading : sDict.inspectBtn}
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '8px',
            }}
          >
            <input
              className="nov-p-input"
              style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
              value={sqlQuery}
              placeholder={sDict.sqlQueryPlaceholder}
              disabled={isBusy}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void inspectData();
                }
              }}
            />
            <input
              className="nov-p-input"
              value={dataFilter}
              placeholder={sDict.filterPlaceholder}
              disabled={isBusy}
              onChange={(e) => setDataFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void inspectData();
                }
              }}
            />
          </div>

          {dataResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="nov-p-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  {dataFormat && <span className="nov-badge is-accent">{dataFormat}</span>}
                  <code style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}>
                    {dataResult.filePath}
                  </code>
                  <span className="nov-badge">
                    {sDict.rowsCount}: {normalizedTable.rows.length}
                    {typeof dataResult.totalRows === 'number' ? ` / ${dataResult.totalRows}` : ''}
                  </span>
                  {typeof dataResult.bytes === 'number' && (
                    <span className="nov-badge">{formatBytes(dataResult.bytes)}</span>
                  )}
                </div>
                {dataResult.truncated && (
                  <span className="nov-badge is-network">{sDict.truncatedNotice}</span>
                )}
              </div>

              {dataWarning && (
                <div
                  className="nov-p-banner"
                  style={{
                    background: 'var(--nov-warn-soft)',
                    borderColor: 'var(--nov-warn)',
                  }}
                >
                  {dataWarning}
                </div>
              )}

              {sqliteTables.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                    {aux.tablesTitle}:
                  </strong>
                  {sqliteTables.map((tbl) => {
                    const colHint = Array.isArray(tbl.columns)
                      ? tbl.columns.map((c) => `${c.name}${c.type ? `:${c.type}` : ''}`).join(', ')
                      : '';
                    return (
                      <button
                        key={tbl.name}
                        type="button"
                        className="nov-cat-pill"
                        disabled={isBusy}
                        title={colHint || tbl.name}
                        onClick={() => {
                          const nextSql = `SELECT * FROM ${escapeSqlIdentifier(tbl.name)} LIMIT ${dataLimit}`;
                          setSqlQuery(nextSql);
                          void inspectData({
                            filePath: dataResult.filePath || dataPath,
                            query: nextSql,
                            filter: dataFilter,
                            limit: dataLimit,
                          });
                        }}
                      >
                        {tbl.name}
                        {Array.isArray(tbl.columns) && tbl.columns.length > 0
                          ? ` (${tbl.columns.length})`
                          : ''}
                      </button>
                    );
                  })}
                </div>
              )}

              {normalizedTable.columns.length > 0 && normalizedTable.rows.length > 0 ? (
                <div
                  style={{
                    overflowX: 'auto',
                    maxHeight: '360px',
                    overflowY: 'auto',
                    border: '1px solid var(--nov-border)',
                    borderRadius: '8px',
                    background: 'var(--nov-bg-0)',
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '11.5px',
                      fontFamily: 'var(--nov-font-mono)',
                    }}
                  >
                    <thead>
                      <tr>
                        {normalizedTable.columns.map((col) => (
                          <th
                            key={col}
                            style={{
                              position: 'sticky',
                              top: 0,
                              textAlign: 'left',
                              padding: '7px 9px',
                              background: 'var(--nov-bg-2)',
                              color: 'var(--nov-text-0)',
                              borderBottom: '1px solid var(--nov-border-strong)',
                              whiteSpace: 'nowrap',
                              fontWeight: 700,
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {normalizedTable.rows.map((cells, rIdx) => (
                        <tr
                          key={rIdx}
                          style={{
                            borderBottom: '1px solid var(--nov-border)',
                          }}
                        >
                          {cells.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              style={{
                                padding: '6px 9px',
                                color: 'var(--nov-text-1)',
                                maxWidth: '320px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={cell}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                dataPreviewText && (
                  <pre className="nov-p-pre" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {dataPreviewText}
                  </pre>
                )
              )}

              {normalizedTable.rows.length > 0 && dataPreviewText && (
                <div style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                  {dataPreviewText}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: Document Slicer (DOCX / XLSX / PDF / MD) */}
      {tab === 'docs' && (
        <section className="nov-p-card">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(200px, 1fr) 95px 115px auto',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <input
              className="nov-p-input"
              style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
              value={docPath}
              placeholder={sDict.filePathPlaceholder}
              disabled={isBusy}
              onChange={(e) => setDocPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void inspectDocument();
                }
              }}
            />
            <input
              type="number"
              min={1}
              className="nov-p-input"
              value={docStartLine}
              title={aux.startLine}
              placeholder={aux.startLine}
              disabled={isBusy}
              onChange={(e) => setDocStartLine(Math.max(1, Number(e.target.value) || 1))}
            />
            <select
              className="nov-p-select"
              value={docMaxLines}
              title={aux.maxLines}
              disabled={isBusy}
              onChange={(e) => setDocMaxLines(Number(e.target.value) || 80)}
            >
              {[40, 80, 120, 200].map((n) => (
                <option key={n} value={n}>
                  {aux.maxLines}: {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy || !docPath.trim()}
              onClick={() => void inspectDocument()}
            >
              {busyAction === 'inspect:doc' ? dict.common.loading : sDict.inspectBtn}
            </button>
          </div>

          {docResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="nov-p-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  {docFormat && <span className="nov-badge is-offline">{docFormat}</span>}
                  <code style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}>
                    {docResult.filePath}
                  </code>
                  {typeof docResult.totalLines === 'number' && (
                    <span className="nov-badge">
                      {aux.linesRange}: {docResult.startLine ?? docStartLine}-
                      {docResult.endLine ?? docResult.totalLines} / {docResult.totalLines}
                    </span>
                  )}
                  {docResult.truncated && (
                    <span className="nov-badge is-network">{sDict.truncatedNotice}</span>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={isBusy || (docResult.startLine ?? docStartLine) <= 1}
                    onClick={() => {
                      const prevStart = Math.max(
                        1,
                        (docResult.startLine ?? docStartLine) - docMaxLines,
                      );
                      setDocStartLine(prevStart);
                      void inspectDocument({
                        filePath: docResult.filePath || docPath,
                        startLine: prevStart,
                        maxLines: docMaxLines,
                      });
                    }}
                  >
                    ← {aux.prevSlice}
                  </button>
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={
                      isBusy ||
                      typeof docResult.totalLines !== 'number' ||
                      (docResult.endLine ?? 0) >= docResult.totalLines
                    }
                    onClick={() => {
                      const nextStart = (docResult.endLine ?? docStartLine) + 1;
                      setDocStartLine(nextStart);
                      void inspectDocument({
                        filePath: docResult.filePath || docPath,
                        startLine: nextStart,
                        maxLines: docMaxLines,
                      });
                    }}
                  >
                    {aux.nextSlice} →
                  </button>
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={!docResult.content}
                    onClick={() => void handleCopyText('doc', docResult.content ?? '')}
                  >
                    {copiedTarget === 'doc' ? dict.common.copied : dict.common.copy}
                  </button>
                </div>
              </div>

              {docResult.warning && (
                <div
                  className="nov-p-banner"
                  style={{
                    background: 'var(--nov-warn-soft)',
                    borderColor: 'var(--nov-warn)',
                  }}
                >
                  {docResult.warning}
                </div>
              )}

              {docMetadataEntries.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {docMetadataEntries.slice(0, 10).map(([k, v]) => (
                    <span key={k} className="nov-badge">
                      {k}: {formatCellValue(v)}
                    </span>
                  ))}
                </div>
              )}

              {normalizedOutline.length > 0 && (
                <div
                  className="nov-p-item"
                  style={{ background: 'var(--nov-bg-0)', gap: '6px' }}
                >
                  <strong style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                    {aux.outlineTitle} ({normalizedOutline.length})
                  </strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {normalizedOutline.slice(0, 30).map((item, idx) => {
                      const label = item.title ?? item.text ?? '';
                      const targetLine = item.line;
                      return (
                        <button
                          key={`${idx}:${label}`}
                          type="button"
                          className="nov-cat-pill"
                          disabled={isBusy || typeof targetLine !== 'number'}
                          onClick={() => {
                            if (typeof targetLine === 'number') {
                              setDocStartLine(targetLine);
                              void inspectDocument({
                                filePath: docResult.filePath || docPath,
                                startLine: targetLine,
                                maxLines: docMaxLines,
                              });
                            }
                          }}
                        >
                          {typeof targetLine === 'number' ? `L${targetLine} · ` : ''}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <pre className="nov-p-pre" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                {docResult.content || dict.common.empty}
              </pre>

              {Array.isArray(docResult.sheets) && docResult.sheets.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {aux.sheetsTitle} ({docResult.sheets.length})
                  </strong>
                  {docResult.sheets.slice(0, 4).map((sheet) => (
                    <div key={sheet.name} className="nov-p-item">
                      <div className="nov-p-row">
                        <strong>{sheet.name}</strong>
                        <span className="nov-badge">
                          {sDict.rowsCount}: {sheet.totalRows ?? sheet.rows.length}
                        </span>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '11px',
                            fontFamily: 'var(--nov-font-mono)',
                          }}
                        >
                          <tbody>
                            {sheet.rows.slice(0, 12).map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                style={{ borderBottom: '1px solid var(--nov-border)' }}
                              >
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    style={{
                                      padding: '4px 7px',
                                      color: rIdx === 0 ? 'var(--nov-text-0)' : 'var(--nov-text-1)',
                                      fontWeight: rIdx === 0 ? 600 : 400,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {docResult.openApiSpec && docResult.openApiSpec.endpoints.length > 0 && (
                <div
                  className="nov-p-item"
                  style={{ background: 'var(--nov-bg-0)', gap: '8px' }}
                >
                  <div className="nov-p-row">
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--nov-text-0)' }}>
                        {sDict.openApiEndpointsTitle}: {docResult.openApiSpec.title}
                      </strong>
                      <span className="nov-badge is-network">
                        OpenAPI {docResult.openApiSpec.specVersion}
                      </span>
                      {docResult.openApiSpec.apiVersion && (
                        <span className="nov-badge">v{docResult.openApiSpec.apiVersion}</span>
                      )}
                    </div>
                    <span className="nov-badge">
                      {docResult.openApiSpec.endpoints.length} / {docResult.openApiSpec.totalEndpoints}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      maxHeight: '220px',
                      overflowY: 'auto',
                    }}
                  >
                    {docResult.openApiSpec.endpoints.slice(0, 20).map((ep) => (
                      <div
                        key={ep.id}
                        className="nov-p-row"
                        style={{
                          padding: '6px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--nov-border)',
                          background: 'var(--nov-bg-1)',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                          <span
                            className="nov-badge"
                            style={{
                              ...getHttpMethodStyle(ep.method),
                              fontFamily: 'var(--nov-font-mono)',
                              fontWeight: 700,
                              minWidth: '52px',
                              justifyContent: 'center',
                            }}
                          >
                            {ep.method}
                          </span>
                          <code style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '11.5px' }}>
                            {ep.path}
                          </code>
                          {ep.summary && (
                            <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                              {ep.summary}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="nov-p-btn is-primary"
                          style={{ flexShrink: 0, padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => handleLoadEndpoint(ep)}
                        >
                          {sDict.loadEndpointBtn}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: Loopback HTTP Probe + OpenAPI Endpoints Collection */}
      {tab === 'http' && (
        <section className="nov-p-card">
          <div
            className="nov-p-banner"
            style={{
              background: 'var(--nov-warn-soft)',
              borderColor: 'var(--nov-warn)',
              color: 'var(--nov-text-0)',
            }}
          >
            <strong style={{ color: 'var(--nov-warn)' }}>🔒 {sDict.loopbackOnlyNote}</strong>
          </div>

          {/* OpenAPI 2.0 / 3.x One-Click Endpoint Collection */}
          <div
            className="nov-p-item"
            style={{ background: 'var(--nov-bg-0)', gap: '10px' }}
          >
            <div className="nov-p-row">
              <strong style={{ fontSize: '12px', color: 'var(--nov-text-0)' }}>
                {sDict.openApiEndpointsTitle}
              </strong>
              {openApiSpec && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  <span className="nov-badge is-network">
                    OpenAPI {openApiSpec.specVersion}
                  </span>
                  {openApiSpec.apiVersion && (
                    <span className="nov-badge">v{openApiSpec.apiVersion}</span>
                  )}
                  <span className="nov-badge">
                    {filteredOpenApiEndpoints.length} / {openApiSpec.totalEndpoints}
                  </span>
                  {openApiSpec.truncated && (
                    <span className="nov-badge is-network">{sDict.truncatedNotice}</span>
                  )}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 1fr) minmax(160px, 1fr) auto',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              <select
                className="nov-p-select"
                style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '11.5px' }}
                value={openApiPath}
                disabled={isBusy || openApiSources.length === 0}
                onChange={(e) => {
                  const nextPath = e.target.value;
                  setOpenApiPath(nextPath);
                  setOpenApiFilter('');
                  if (nextPath) {
                    void parseOpenApi(nextPath);
                  } else {
                    setOpenApiSpec(null);
                    setSelectedEndpointId(null);
                  }
                }}
              >
                <option value="">
                  {openApiSources.length === 0
                    ? sDict.openApiEmpty
                    : `— ${sDict.openApiEndpointsTitle} (${openApiSources.length}) —`}
                </option>
                {openApiSources.map((src, idx) => {
                  const p = getSourcePath(src);
                  return (
                    <option key={`${p}:${idx}`} value={p}>
                      {p}
                    </option>
                  );
                })}
              </select>

              <input
                className="nov-p-input"
                value={openApiFilter}
                placeholder={sDict.filterPlaceholder}
                disabled={isBusy || !openApiSpec}
                onChange={(e) => setOpenApiFilter(e.target.value)}
              />

              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy || !openApiPath}
                onClick={() => void parseOpenApi(openApiPath)}
              >
                {busyAction === 'parse:openapi' ? dict.common.loading : dict.common.refresh}
              </button>
            </div>

            {openApiSpec ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="nov-p-row">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                    <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
                      {openApiSpec.title}
                    </strong>
                    <code style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '11px', color: 'var(--nov-text-2)' }}>
                      {openApiSpec.filePath}
                    </code>
                  </div>
                </div>

                {openApiSpec.warnings.length > 0 && (
                  <div
                    className="nov-p-banner"
                    style={{
                      background: 'var(--nov-warn-soft)',
                      borderColor: 'var(--nov-warn)',
                      fontSize: '11.5px',
                    }}
                  >
                    {openApiSpec.warnings.map((w, wIdx) => (
                      <div key={wIdx}>{w}</div>
                    ))}
                  </div>
                )}

                {openApiSpec.servers.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <strong style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                      {sDict.serversTitle} ({openApiSpec.servers.length})
                    </strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {openApiSpec.servers.map((srv, sIdx) => (
                        <div
                          key={`${srv.url}:${sIdx}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--nov-border)',
                            background: 'var(--nov-bg-1)',
                            fontSize: '11px',
                          }}
                          title={srv.description || srv.url}
                        >
                          <code style={{ fontFamily: 'var(--nov-font-mono)' }}>{srv.url}</code>
                          {srv.description && (
                            <span style={{ color: 'var(--nov-text-2)' }}>· {srv.description}</span>
                          )}
                          <span
                            className="nov-badge"
                            style={
                              srv.isLoopback
                                ? {
                                    background: 'var(--nov-success-soft)',
                                    color: 'var(--nov-success)',
                                    borderColor: 'var(--nov-success)',
                                    fontSize: '10px',
                                  }
                                : {
                                    background: 'var(--nov-danger-soft)',
                                    color: 'var(--nov-danger)',
                                    borderColor: 'var(--nov-danger)',
                                    fontSize: '10px',
                                  }
                            }
                          >
                            {srv.isLoopback ? 'Loopback OK' : 'Blocked (Non-Loopback)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredOpenApiEndpoints.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--nov-text-2)' }}>
                    {sDict.openApiEmpty}
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      maxHeight: '260px',
                      overflowY: 'auto',
                    }}
                  >
                    {filteredOpenApiEndpoints.map((ep) => {
                      const isLoaded = selectedEndpointId === ep.id;
                      return (
                        <div
                          key={ep.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            border: `1px solid ${
                              isLoaded ? 'var(--nov-accent)' : 'var(--nov-border)'
                            }`,
                            background: isLoaded ? 'var(--nov-accent-soft)' : 'var(--nov-bg-1)',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span
                                className="nov-badge"
                                style={{
                                  ...getHttpMethodStyle(ep.method),
                                  fontFamily: 'var(--nov-font-mono)',
                                  fontWeight: 700,
                                  minWidth: '54px',
                                  justifyContent: 'center',
                                }}
                              >
                                {ep.method}
                              </span>
                              <code
                                style={{
                                  fontFamily: 'var(--nov-font-mono)',
                                  fontSize: '12px',
                                  color: 'var(--nov-text-0)',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {ep.path}
                              </code>
                              {ep.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="nov-badge"
                                  style={{ fontSize: '10px', padding: '1px 5px' }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            {ep.summary && (
                              <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                                {ep.summary}
                              </span>
                            )}
                            <code
                              style={{
                                fontFamily: 'var(--nov-font-mono)',
                                fontSize: '10.5px',
                                color: 'var(--nov-text-2)',
                                wordBreak: 'break-all',
                              }}
                            >
                              → {ep.resolvedLoopbackUrl}
                            </code>
                          </div>

                          <button
                            type="button"
                            className={`nov-p-btn ${isLoaded ? '' : 'is-primary'}`}
                            style={{ flexShrink: 0, fontSize: '11.5px', padding: '5px 10px' }}
                            disabled={isBusy}
                            onClick={() => handleLoadEndpoint(ep)}
                          >
                            {sDict.loadEndpointBtn}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--nov-text-2)' }}>
                {sDict.openApiEmpty}
              </p>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '110px minmax(200px, 1fr) 100px auto',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <select
              className="nov-p-select"
              style={{ fontFamily: 'var(--nov-font-mono)', fontWeight: 700 }}
              value={httpMethod}
              disabled={isBusy}
              onChange={(e) => setHttpMethod(e.target.value as HttpMethod)}
            >
              {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <input
              className="nov-p-input"
              style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
              value={httpUrl}
              placeholder={sDict.urlPlaceholder}
              disabled={isBusy}
              onChange={(e) => setHttpUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleHttpProbe();
                }
              }}
            />

            <select
              className="nov-p-select"
              value={httpTimeoutMs}
              disabled={isBusy}
              onChange={(e) => setHttpTimeoutMs(Number(e.target.value) || 5000)}
            >
              {[3000, 5000, 10000, 15000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000}s
                </option>
              ))}
            </select>

            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy || !httpUrl.trim()}
              onClick={() => void handleHttpProbe()}
            >
              {busyAction === 'probe:http' ? dict.common.loading : sDict.probeBtn}
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '8px',
            }}
          >
            <textarea
              className="nov-p-textarea"
              style={{ minHeight: '76px' }}
              value={httpHeadersText}
              placeholder={sDict.headersPlaceholder}
              disabled={isBusy}
              onChange={(e) => setHttpHeadersText(e.target.value)}
            />
            <textarea
              className="nov-p-textarea"
              style={{ minHeight: '76px' }}
              value={httpBodyText}
              placeholder={sDict.bodyPlaceholder}
              disabled={isBusy || httpMethod === 'GET' || httpMethod === 'HEAD'}
              onChange={(e) => setHttpBodyText(e.target.value)}
            />
          </div>

          {httpResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="nov-p-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-2)' }}>
                    {sDict.statusCode}:
                  </span>
                  <span
                    className="nov-badge"
                    style={getHttpStatusStyle(httpResult.status)}
                  >
                    {httpResult.status} {httpResult.statusText ?? ''}
                  </span>
                  {typeof httpElapsed === 'number' && (
                    <span className="nov-badge">{Math.round(httpElapsed)}ms</span>
                  )}
                  {typeof httpResult.bodyBytes === 'number' && (
                    <span className="nov-badge">{formatBytes(httpResult.bodyBytes)}</span>
                  )}
                  {httpResult.contentType && (
                    <span className="nov-badge">{httpResult.contentType}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={!httpBodyDisplay}
                  onClick={() => void handleCopyText('http', httpBodyDisplay)}
                >
                  {copiedTarget === 'http' ? dict.common.copied : dict.common.copy}
                </button>
              </div>

              {httpRedirect && (
                <div className="nov-p-banner">
                  <strong>{aux.redirectLabel}:</strong>{' '}
                  <code style={{ fontFamily: 'var(--nov-font-mono)' }}>{httpRedirect}</code>
                </div>
              )}

              {httpResult.truncated && (
                <div
                  className="nov-p-banner"
                  style={{
                    background: 'var(--nov-warn-soft)',
                    borderColor: 'var(--nov-warn)',
                  }}
                >
                  {sDict.truncatedNotice}
                </div>
              )}

              {Object.keys(httpHeadersMap).length > 0 && (
                <div
                  className="nov-p-item"
                  style={{ background: 'var(--nov-bg-0)', gap: '4px' }}
                >
                  <strong style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                    {aux.headersTitle} ({Object.keys(httpHeadersMap).length})
                  </strong>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(120px, auto) 1fr',
                      gap: '3px 10px',
                      fontSize: '11.5px',
                      fontFamily: 'var(--nov-font-mono)',
                    }}
                  >
                    {Object.entries(httpHeadersMap).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <span style={{ color: 'var(--nov-accent)' }}>{k}</span>
                        <span style={{ color: 'var(--nov-text-1)', wordBreak: 'break-all' }}>
                          {v}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                  {aux.responseBody}
                </strong>
                <pre className="nov-p-pre" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {httpBodyDisplay || dict.common.empty}
                </pre>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
