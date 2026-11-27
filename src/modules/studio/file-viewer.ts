import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathInsideDir, isSamePath } from '../../core/utils.js';
import {
  createDemoOpenApiSpec,
  inspectStudioData,
  isSensitiveStudioPath,
  parseStudioOpenApiFile,
  resolveStudioWorkspaceFile,
  STUDIO_MAX_DATA_ROWS,
  STUDIO_MAX_FILE_BYTES,
  type DemoStudioService,
  type ParsedOpenApiSpec,
  type StudioDataResult,
} from './core.js';

export const FILE_VIEWER_EXTENSIONS = [
  '.sqlite',
  '.sqlite3',
  '.db',
  '.csv',
  '.tsv',
  '.svg',
  '.openapi.yaml',
  '.openapi.yml',
] as const;

export type FileViewerExtension = (typeof FILE_VIEWER_EXTENSIONS)[number];
export type FileViewerTargetTab = 'studio' | 'canvas';
export type FileViewerKind = 'opaque-uri' | 'svg' | 'data' | 'openapi';
export type FileViewerOpaqueFileKind = 'csv' | 'tsv' | 'svg' | 'openapi' | 'sqlite' | 'unknown';

const DOUBLE_SUFFIX_EXTENSIONS: readonly FileViewerExtension[] = [
  '.openapi.yaml',
  '.openapi.yml',
];

const SINGLE_SUFFIX_EXTENSIONS: readonly FileViewerExtension[] = [
  '.sqlite',
  '.sqlite3',
  '.db',
  '.csv',
  '.tsv',
  '.svg',
];

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;
const SCHEME_PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const TRAVERSAL_SEGMENT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

// Strict SVG security deny-list patterns (linear single-pass regexes, namespace-aware)
const SVG_ROOT_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?svg\b/i;
const SVG_SCRIPT_TAG_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?script\b/i;
const SVG_FOREIGN_OBJECT_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?foreignobject\b/i;
const SVG_ACTIVE_EMBED_TAG_RE =
  /<\s*(?:[a-zA-Z_][\w.-]*:)?(?:iframe|object|embed|applet|base|meta|handler|listener)\b/i;
const SVG_ENTITY_DECL_RE = /<!\s*entity\b/i;
const SVG_EVENT_HANDLER_ATTR_RE = /(?:^|[\s"'/])on[a-z][a-z0-9_-]{0,31}\s*=/i;
const SVG_UNSAFE_PROTOCOL_RE =
  /(?:javascript|vbscript):|data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i;

export interface NativeFileViewerInput {
  file?: {
    name?: string;
    resourceUri?: string;
    uri?: string;
  };
  path?: string;
  limit?: number;
}

export interface OpenNativeFileViewerOptions {
  workspaceRoot: string | (() => string);
  demoMode?: boolean;
  demoService?: DemoStudioService | null;
}

export interface FileViewerSvgPayload {
  content: string;
  bytes: number;
  lineCount: number;
  width?: string;
  height?: string;
  viewBox?: string;
}

export interface NativeFileViewerResult {
  kind: FileViewerKind;
  targetTab: FileViewerTargetTab;
  fileName: string;
  extension: FileViewerExtension;
  fileKind?: FileViewerOpaqueFileKind;
  supportsHostResourceRead?: boolean;
  relPath?: string;
  resourceUri?: string;
  bytes?: number;
  mode: 'live' | 'demo';
  readOnly: true;
  note?: string;
  svg?: FileViewerSvgPayload;
  data?: StudioDataResult;
  openApi?: ParsedOpenApiSpec;
}

export function inferOpaqueFileKind(ext: FileViewerExtension | null): FileViewerOpaqueFileKind {
  switch (ext) {
    case '.csv':
      return 'csv';
    case '.tsv':
      return 'tsv';
    case '.svg':
      return 'svg';
    case '.openapi.yaml':
    case '.openapi.yml':
      return 'openapi';
    case '.sqlite':
    case '.sqlite3':
    case '.db':
      return 'sqlite';
    default:
      return 'unknown';
  }
}

/**
 * Match supported file viewer extensions case-insensitively.
 * Double suffixes (.openapi.yaml / .openapi.yml) are checked first.
 */
export function matchFileViewerExtension(nameOrPath: string): FileViewerExtension | null {
  const cleaned = nameOrPath.trim().replace(/[?#].*$/, '');
  if (!cleaned) return null;
  const base = path.posix.basename(cleaned.replace(/\\/g, '/')).toLowerCase();
  if (!base) return null;

  for (const ext of DOUBLE_SUFFIX_EXTENSIONS) {
    if (base.endsWith(ext) && base.length > ext.length) {
      return ext;
    }
  }
  for (const ext of SINGLE_SUFFIX_EXTENSIONS) {
    if (base.endsWith(ext) && base.length > ext.length) {
      return ext;
    }
  }
  return null;
}

export function resolveFileViewerTargetTab(ext: FileViewerExtension): FileViewerTargetTab {
  return ext === '.svg' ? 'canvas' : 'studio';
}

const SVG_NAMED_PROTOCOL_ENTITIES: Readonly<Record<string, string>> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
};

function decodeSvgEntitiesAndCssEscapesLinear(input: string): string {
  // Decode HTML5 named entities (&colon;, &tab;, &newline;, &sol;, case-insensitive) before numeric entities
  const namedDecoded = input.replace(
    /&(colon|tab|newline|sol);/gi,
    (_full, name: string) => SVG_NAMED_PROTOCOL_ENTITIES[name.toLowerCase()] ?? '',
  );
  // Decode decimal/hex numeric HTML entities (supporting arbitrary leading zeros) & CSS backslash hex escapes in O(n)
  const entitiesDecoded = namedDecoded.replace(
    /&#(?:x0*([0-9a-fA-F]{1,6})|0*([0-9]{1,7}));?/g,
    (full, hex: string | undefined, dec: string | undefined) => {
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    },
  );
  const cssDecoded = entitiesDecoded.replace(
    /\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g,
    (full, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    },
  );
  // Strip control characters and whitespace so `java&#x09;script:` / `java&Tab;script:` collapses to `javascript:`
  return cssDecoded.replace(/[\x00-\x20\x7f]+/g, '');
}

/**
 * Validate SVG markup before exposing it to the Canvas sandbox preview.
 * Rejects <script> (including XML namespace prefixes), <!ENTITY>, inline on*= handlers,
 * obfuscated javascript:/vbscript:/data:(text/html|application/xhtml+xml|image/svg+xml) URIs,
 * <foreignObject>, and active embedding tags.
 */
export function assertSafeSvgContent(svgContent: string): void {
  if (!svgContent || !svgContent.trim()) {
    throw new Error('SVG file is empty');
  }
  if (!SVG_ROOT_RE.test(svgContent)) {
    throw new Error('File does not contain a valid <svg> root element');
  }
  if (SVG_ENTITY_DECL_RE.test(svgContent)) {
    throw new Error('Rejected unsafe SVG: <!ENTITY> declarations are forbidden');
  }
  if (SVG_SCRIPT_TAG_RE.test(svgContent)) {
    throw new Error('Rejected unsafe SVG: <script> tags are forbidden');
  }
  if (SVG_FOREIGN_OBJECT_RE.test(svgContent)) {
    throw new Error('Rejected unsafe SVG: <foreignObject> elements are forbidden');
  }
  if (SVG_ACTIVE_EMBED_TAG_RE.test(svgContent)) {
    throw new Error('Rejected unsafe SVG: active embedded HTML elements are forbidden');
  }
  if (SVG_EVENT_HANDLER_ATTR_RE.test(svgContent)) {
    throw new Error('Rejected unsafe SVG: inline on*= event handlers are forbidden');
  }
  const normalizedProto = decodeSvgEntitiesAndCssEscapesLinear(svgContent);
  if (SVG_UNSAFE_PROTOCOL_RE.test(normalizedProto)) {
    throw new Error(
      'Rejected unsafe SVG: javascript:, vbscript:, or active data: URIs are forbidden',
    );
  }
}

function extractSvgMetadata(svgContent: string, bytes: number): FileViewerSvgPayload {
  const openTagMatch = svgContent.match(/<svg\b[^>]{0,2048}>/i);
  const openTag = openTagMatch ? openTagMatch[0] : '';
  const pickAttr = (attrName: string): string | undefined => {
    const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]{1,64})"|'([^']{1,64})')`, 'i');
    const m = openTag.match(re);
    const val = (m?.[1] ?? m?.[2] ?? '').trim();
    return val || undefined;
  };
  const lineCount = svgContent.replace(/\r\n/g, '\n').split('\n').length;
  return {
    content: svgContent,
    bytes,
    lineCount,
    ...(pickAttr('width') ? { width: pickAttr('width') } : {}),
    ...(pickAttr('height') ? { height: pickAttr('height') } : {}),
    ...(pickAttr('viewBox') ? { viewBox: pickAttr('viewBox') } : {}),
  };
}

function assertCleanInputString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing ${label}`);
  }
  if (CONTROL_CHARS_RE.test(trimmed)) {
    throw new Error(`Invalid ${label}: control characters are not allowed`);
  }
  return trimmed;
}

function extractOpaqueFileName(rawResourceUri: string, explicitName?: string): string {
  if (explicitName && explicitName.trim()) {
    const cleaned = assertCleanInputString(explicitName, 'file.name');
    return path.posix.basename(cleaned.replace(/\\/g, '/'));
  }
  try {
    const parsed = new URL(rawResourceUri);
    const decodedPath = decodeURIComponent(parsed.pathname || '');
    const base = path.posix.basename(decodedPath);
    if (base) return base;
  } catch {
    // Fallback below
  }
  const stripped = rawResourceUri.replace(/[?#].*$/, '');
  const tail = stripped.split('/').filter(Boolean).pop() ?? '';
  return tail || 'untitled';
}

function buildDemoSvgMarkup(fileName: string): string {
  const safeLabel = fileName.replace(/[<>&"']/g, '');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="220" viewBox="0 0 480 220">',
    '  <rect x="8" y="8" width="464" height="204" rx="14" fill="#111827" stroke="#38bdf8" stroke-width="2" />',
    '  <text x="32" y="64" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="700">agy-NOV Safe SVG Preview (Demo)</text>',
    `  <text x="32" y="102" fill="#94a3b8" font-family="monospace" font-size="13">${safeLabel}</text>`,
    '  <rect x="32" y="132" width="128" height="40" rx="8" fill="#1e293b" stroke="#10b981" />',
    '  <text x="52" y="157" fill="#6ee7b7" font-family="monospace" font-size="12">READ-ONLY</text>',
    '</svg>',
  ].join('\n');
}

function assertNotSensitiveNameOrPath(candidate: string): void {
  if (isSensitiveStudioPath(candidate)) {
    throw new Error(`Refused to open sensitive file: ${candidate}`);
  }
}

/**
 * Open a supported workspace file or opaque host file URI in read-only mode
 * for the MCP Apps `file` entrypoint (`app_nov_file_viewer`).
 * Strictly read-only, zero disk writes, workspace realpath-bounded, <= 10 MiB.
 */
export async function openNativeFileViewer(
  input: NativeFileViewerInput,
  opts: OpenNativeFileViewerOptions,
): Promise<NativeFileViewerResult> {
  const workspaceRoot =
    typeof opts.workspaceRoot === 'function' ? opts.workspaceRoot() : opts.workspaceRoot;
  const isDemo = opts.demoMode === true;
  const mode: 'live' | 'demo' = isDemo ? 'demo' : 'live';
  const rawResourceUri = input.file?.resourceUri?.trim() || input.file?.uri?.trim() || '';
  const rawName = input.file?.name?.trim() || '';
  const rawPath = input.path?.trim() || '';

  if (rawResourceUri) assertCleanInputString(rawResourceUri, 'file.resourceUri');
  if (rawName) assertCleanInputString(rawName, 'file.name');
  if (rawPath) assertCleanInputString(rawPath, 'path');

  // 1. Opaque host resource URI (e.g. antigravity-file://...) — never read local filesystem
  const uriSchemeMatch = rawResourceUri.match(SCHEME_PREFIX_RE);
  if (uriSchemeMatch && uriSchemeMatch[1].toLowerCase() !== 'file') {
    const scheme = uriSchemeMatch[1].toLowerCase();
    const fileName = extractOpaqueFileName(rawResourceUri, rawName);
    if (rawName) assertNotSensitiveNameOrPath(rawName);
    assertNotSensitiveNameOrPath(fileName);
    // Also inspect decoded pathname segments inside the opaque URI to block masked sensitive targets
    try {
      const parsedOpaque = new URL(rawResourceUri);
      const decodedPathname = decodeURIComponent(parsedOpaque.pathname || '');
      if (decodedPathname) assertNotSensitiveNameOrPath(decodedPathname);
    } catch {
      const fallbackPath = rawResourceUri.replace(SCHEME_PREFIX_RE, '').replace(/[?#].*$/, '');
      if (fallbackPath) assertNotSensitiveNameOrPath(fallbackPath);
    }

    const ext =
      (rawName ? matchFileViewerExtension(rawName) : null) ??
      matchFileViewerExtension(fileName) ??
      matchFileViewerExtension(rawResourceUri);

    if (!ext) {
      throw new Error(
        `Unsupported file extension for native viewer: ${fileName} (supported: ${FILE_VIEWER_EXTENSIONS.join(', ')})`,
      );
    }

    const fileKind = inferOpaqueFileKind(ext);
    const supportsHostResourceRead = scheme === 'antigravity-file';
    const targetTab = resolveFileViewerTargetTab(ext);
    return {
      kind: 'opaque-uri',
      targetTab,
      fileName,
      extension: ext,
      fileKind,
      supportsHostResourceRead,
      resourceUri: rawResourceUri,
      mode,
      readOnly: true,
      note: supportsHostResourceRead
        ? `Opaque host resource URI detected (${fileKind}). Read-only metadata shown without local filesystem reads; frontend can read real content via host resources/read.`
        : `Opaque resource URI detected (${fileKind}). Showing read-only metadata without local filesystem reads.`,
    };
  }

  // 2. Local file:// URI or workspace path
  let localCandidate = '';
  if (rawResourceUri && rawResourceUri.toLowerCase().startsWith('file://')) {
    let parsedFileUrl: URL;
    try {
      parsedFileUrl = new URL(rawResourceUri);
    } catch {
      throw new Error(`Invalid file:// URI: ${rawResourceUri}`);
    }
    if (parsedFileUrl.hostname && parsedFileUrl.hostname !== 'localhost') {
      throw new Error(`Remote file:// host is not permitted: ${parsedFileUrl.hostname}`);
    }
    try {
      localCandidate = fileURLToPath(parsedFileUrl);
    } catch {
      throw new Error(`Unable to decode file:// URI: ${rawResourceUri}`);
    }
  } else if (rawPath) {
    localCandidate = rawPath;
  } else if (rawName) {
    localCandidate = rawName;
  } else {
    throw new Error('Either file.resourceUri, path, or file.name is required');
  }

  assertCleanInputString(localCandidate, 'file path');

  // Block explicit parent-directory traversal segments upfront
  if (TRAVERSAL_SEGMENT_RE.test(localCandidate)) {
    throw new Error(`Path traversal ("..") is forbidden: ${localCandidate}`);
  }
  if (rawPath && TRAVERSAL_SEGMENT_RE.test(rawPath)) {
    throw new Error(`Path traversal ("..") is forbidden: ${rawPath}`);
  }

  // Validate sensitive names and supported extension before touching filesystem
  if (rawName) assertNotSensitiveNameOrPath(rawName);
  assertNotSensitiveNameOrPath(localCandidate);

  const logicalExt =
    matchFileViewerExtension(localCandidate) ??
    (rawName ? matchFileViewerExtension(rawName) : null);
  if (!logicalExt) {
    throw new Error(
      `Unsupported file extension for native viewer: ${path.basename(localCandidate)} (supported: ${FILE_VIEWER_EXTENSIONS.join(', ')})`,
    );
  }

  const boundedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(STUDIO_MAX_DATA_ROWS, Math.floor(input.limit)))
      : undefined;

  // 3. Demo mode — strictly zero disk reads/writes
  if (isDemo) {
    const cleanRel = localCandidate.replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.isAbsolute(localCandidate)) {
      const normalizedRoot = path.resolve(workspaceRoot);
      const normalizedTarget = path.resolve(localCandidate);
      if (isSamePath(normalizedRoot, normalizedTarget) || !isPathInsideDir(normalizedRoot, normalizedTarget)) {
        throw new Error(`Path escapes workspace boundary: ${localCandidate}`);
      }
    }
    const fileName = path.posix.basename(cleanRel) || rawName || `sample${logicalExt}`;
    const targetTab = resolveFileViewerTargetTab(logicalExt);

    if (logicalExt === '.svg') {
      const svgContent = buildDemoSvgMarkup(fileName);
      assertSafeSvgContent(svgContent);
      const bytes = Buffer.byteLength(svgContent, 'utf8');
      return {
        kind: 'svg',
        targetTab,
        fileName,
        extension: logicalExt,
        relPath: cleanRel,
        bytes,
        mode: 'demo',
        readOnly: true,
        svg: extractSvgMetadata(svgContent, bytes),
      };
    }

    if (logicalExt === '.openapi.yaml' || logicalExt === '.openapi.yml') {
      const openApi = createDemoOpenApiSpec(cleanRel || 'api/sample.openapi.yaml');
      return {
        kind: 'openapi',
        targetTab,
        fileName,
        extension: logicalExt,
        relPath: cleanRel,
        bytes: 6144,
        mode: 'demo',
        readOnly: true,
        openApi,
      };
    }

    const demoFallbackPath =
      logicalExt === '.sqlite' || logicalExt === '.sqlite3' || logicalExt === '.db'
        ? 'data/app.sqlite'
        : 'data/metrics.csv';
    const data = opts.demoService
      ? opts.demoService.inspectData({ filePath: demoFallbackPath, limit: boundedLimit })
      : {
          mode: 'demo' as const,
          filePath: cleanRel,
          format: logicalExt === '.csv' ? ('csv' as const) : logicalExt === '.tsv' ? ('tsv' as const) : ('sqlite' as const),
          bytes: 1024,
          columns: ['id', 'label'],
          rows: [{ id: 1, label: 'demo' }],
          totalRows: 1,
          returnedRows: 1,
          truncated: false,
          summary: `Demo preview for ${fileName}`,
        };

    return {
      kind: 'data',
      targetTab,
      fileName,
      extension: logicalExt,
      relPath: cleanRel,
      bytes: data.bytes,
      mode: 'demo',
      readOnly: true,
      data,
    };
  }

  // 4. Live mode — realpathSync workspace boundary, sensitive guard, and <= 10 MiB cap
  const resolved = resolveStudioWorkspaceFile(workspaceRoot, localCandidate);
  if (resolved.stat.size > STUDIO_MAX_FILE_BYTES) {
    throw new Error(
      `File exceeds 10 MiB viewer limit (${resolved.stat.size} bytes > ${STUDIO_MAX_FILE_BYTES} bytes): ${resolved.relPath}`,
    );
  }

  // Re-validate extension on the realpath target (blocks symlink spoofing like ok.csv -> secret.txt)
  const realExt = matchFileViewerExtension(resolved.relPath);
  if (!realExt) {
    throw new Error(
      `Resolved target extension is not permitted for native viewer: ${resolved.relPath}`,
    );
  }

  const fileName = path.posix.basename(resolved.relPath);
  const targetTab = resolveFileViewerTargetTab(realExt);

  if (realExt === '.svg') {
    const svgContent = fs.readFileSync(resolved.realTarget, 'utf8');
    assertSafeSvgContent(svgContent);
    return {
      kind: 'svg',
      targetTab: 'canvas',
      fileName,
      extension: '.svg',
      relPath: resolved.relPath,
      bytes: resolved.stat.size,
      mode: 'live',
      readOnly: true,
      svg: extractSvgMetadata(svgContent, resolved.stat.size),
    };
  }

  if (realExt === '.openapi.yaml' || realExt === '.openapi.yml') {
    const openApi = parseStudioOpenApiFile(workspaceRoot, resolved.relPath);
    return {
      kind: 'openapi',
      targetTab: 'studio',
      fileName,
      extension: realExt,
      relPath: resolved.relPath,
      bytes: resolved.stat.size,
      mode: 'live',
      readOnly: true,
      openApi,
    };
  }

  const data = await inspectStudioData(workspaceRoot, {
    filePath: resolved.relPath,
    limit: boundedLimit,
  });

  return {
    kind: 'data',
    targetTab: 'studio',
    fileName,
    extension: realExt,
    relPath: resolved.relPath,
    bytes: resolved.stat.size,
    mode: 'live',
    readOnly: true,
    data,
  };
}
