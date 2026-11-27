import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/utils.js';
import {
  isSensitiveTurboPath,
  resolveInsideWorkspaceReal,
  TURBO_MAX_FILE_BYTES,
} from './core.js';

export type SymbolRefKind = 'definition' | 'import' | 'usage';

export interface SymbolReferenceHit {
  file: string;
  line: number;
  column: number;
  kind: SymbolRefKind;
  snippet: string;
}

export interface FindSymbolReferencesOptions {
  scope?: string;
  maxFiles?: number;
  maxHits?: number;
  maxElapsedMs?: number;
}

export interface SymbolReferencesResult {
  symbol: string;
  scope: string;
  scannedFiles: number;
  definitions: SymbolReferenceHit[];
  imports: SymbolReferenceHit[];
  usages: SymbolReferenceHit[];
  totalHits: number;
  truncated: boolean;
  elapsedMs: number;
}

export const VALID_SYMBOL_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

const DEFAULT_MAX_FILES = 800;
const MAX_ALLOWED_FILES = 3000;
const DEFAULT_MAX_HITS = 120;
const MAX_ALLOWED_HITS = 300;
const DEFAULT_MAX_ELAPSED_MS = 2000;
const MAX_SNIPPET_CHARS = 180;
const MAX_LINE_SCAN_CHARS = 8192;

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db',
  '.sqlite', '.sqlite3', '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav',
  '.flac', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.class', '.jar',
  '.pyc', '.o', '.a', '.lockb', '.dmg', '.iso',
]);

const HASH_COMMENT_EXTS = new Set([
  '.py', '.pyi', '.sh', '.bash', '.zsh', '.rb', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.r',
]);

function isIdentCharCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 36 // $
  );
}

function isBinaryFilename(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isBufferBinary(buf: Buffer): boolean {
  const inspectLen = Math.min(buf.length, 8192);
  for (let i = 0; i < inspectLen; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function usesHashComments(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (HASH_COMMENT_EXTS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return base === 'makefile' || base === 'dockerfile';
}

interface LineScanResult {
  codeOnly: string;
  matchOffsets: number[];
  nextInBlockComment: boolean;
}

/**
 * Strict O(n) single-pass lexical scanner over a single source line.
 * Strips single-line/block comments, skips string literal interiors,
 * and collects exact identifier-boundary matches for `symbol`.
 */
function scanLineForSymbolLinear(
  line: string,
  symbol: string,
  inBlockComment: boolean,
  hashComments: boolean,
  isRust: boolean,
): LineScanResult {
  const bounded = line.length > MAX_LINE_SCAN_CHARS ? line.slice(0, MAX_LINE_SCAN_CHARS) : line;
  const symLen = symbol.length;
  const len = bounded.length;
  const codeChars: string[] = [];
  const matchOffsets: number[] = [];

  let i = 0;
  let block = inBlockComment;
  let quote: string | null = null;

  while (i < len) {
    const ch = bounded[i];
    const next = i + 1 < len ? bounded[i + 1] : '';

    if (block) {
      if (ch === '*' && next === '/') {
        block = false;
        codeChars.push(' ', ' ');
        i += 2;
      } else {
        codeChars.push(' ');
        i += 1;
      }
      continue;
    }

    if (quote) {
      codeChars.push(ch);
      if (ch === '\\' && i + 1 < len) {
        codeChars.push(bounded[i + 1]);
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (hashComments && ch === '#') {
      break;
    }
    if (!hashComments && ch === '/' && next === '/') {
      break;
    }
    if (!hashComments && ch === '/' && next === '*') {
      block = true;
      codeChars.push(' ', ' ');
      i += 2;
      continue;
    }

    if (ch === '"' || ch === '`') {
      quote = ch;
      codeChars.push(ch);
      i += 1;
      continue;
    }
    if (ch === "'") {
      // Avoid misreading Rust lifetimes (e.g. 'a, 'static) as single-quoted strings
      if (isRust && i + 1 < len && /[A-Za-z_]/.test(bounded[i + 1])) {
        const afterNext = i + 2 < len ? bounded[i + 2] : '';
        if (afterNext !== "'") {
          codeChars.push(ch);
          i += 1;
          continue;
        }
      }
      quote = ch;
      codeChars.push(ch);
      i += 1;
      continue;
    }

    // Check exact identifier match at boundary
    if (ch === symbol[0] && i + symLen <= len) {
      const prevOk = i === 0 || !isIdentCharCode(bounded.charCodeAt(i - 1));
      const nextOk = i + symLen === len || !isIdentCharCode(bounded.charCodeAt(i + symLen));
      if (prevOk && nextOk && bounded.startsWith(symbol, i)) {
        matchOffsets.push(i);
        for (let k = 0; k < symLen; k += 1) {
          codeChars.push(bounded[i + k]);
        }
        i += symLen;
        continue;
      }
    }

    codeChars.push(ch);
    i += 1;
  }

  return {
    codeOnly: codeChars.join(''),
    matchOffsets,
    nextInBlockComment: block,
  };
}

const TS_DECL_PREFIX_RE =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|const\s+enum|enum|namespace)\s+$/;
const TS_VAR_DECL_PREFIX_RE = /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+$/;
const TS_MEMBER_MOD_PREFIX_RE =
  /^(?:public|private|protected|static|readonly|override|async|get|set)(?:\s+(?:public|private|protected|static|readonly|override|async|get|set))*\s+$/;
const PY_DECL_PREFIX_RE = /^(?:async\s+)?(?:def|class)\s+$/;
const RUST_DECL_PREFIX_RE =
  /^(?:pub(?:\([^)]{0,40}\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(?:fn|struct|enum|trait|type|mod|static)\s+$/;
const GO_DECL_PREFIX_RE = /^(?:func\s+(?:\([^)]{0,80}\)\s+)?|type\s+|var\s+|const\s+)$/;

function isImportLine(trimmedCode: string): boolean {
  if (/^import\b/.test(trimmedCode)) return true;
  if (/^from\s+\S+\s+import\b/.test(trimmedCode)) return true;
  if (/^use\s+/.test(trimmedCode)) return true;
  if (/\brequire\s*\(/.test(trimmedCode)) return true;
  return false;
}

function isDefinitionAtOffset(codeOnly: string, offset: number, symbolLen: number): boolean {
  const prefixRaw = codeOnly.slice(0, offset);
  const trimmedPrefix = prefixRaw.trimStart();
  if (!trimmedPrefix) return false;
  // Normalize internal spaces in prefix while preserving trailing space
  const normalizedPrefix = trimmedPrefix.replace(/[ \t]+/g, ' ');
  if (!normalizedPrefix.endsWith(' ')) return false;

  if (
    TS_DECL_PREFIX_RE.test(normalizedPrefix) ||
    TS_VAR_DECL_PREFIX_RE.test(normalizedPrefix) ||
    PY_DECL_PREFIX_RE.test(normalizedPrefix) ||
    RUST_DECL_PREFIX_RE.test(normalizedPrefix) ||
    GO_DECL_PREFIX_RE.test(normalizedPrefix)
  ) {
    return true;
  }

  if (TS_MEMBER_MOD_PREFIX_RE.test(normalizedPrefix)) {
    const after = codeOnly.slice(offset + symbolLen).trimStart();
    if (/^[<(?:=]/.test(after)) {
      return true;
    }
  }

  return false;
}

function classifyReference(
  codeOnly: string,
  matchOffsets: number[],
  symbolLen: number,
): { kind: SymbolRefKind; column: number } {
  const trimmed = codeOnly.trim();
  if (isImportLine(trimmed)) {
    return { kind: 'import', column: matchOffsets[0] + 1 };
  }
  for (const offset of matchOffsets) {
    if (isDefinitionAtOffset(codeOnly, offset, symbolLen)) {
      return { kind: 'definition', column: offset + 1 };
    }
  }
  return { kind: 'usage', column: matchOffsets[0] + 1 };
}

function compactSnippet(line: string): string {
  const cleaned = line.replace(/\t/g, '  ').trim();
  if (cleaned.length <= MAX_SNIPPET_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_SNIPPET_CHARS - 1)}…`;
}

/**
 * Lightweight zero-LSP cross-file symbol reference finder with strict linear-time
 * lexical boundary scanning and workspace realpath/sensitive-path security guardrails.
 */
export function findSymbolReferences(
  workspaceRoot: string,
  symbol: string,
  options: FindSymbolReferencesOptions = {},
): SymbolReferencesResult {
  const startedAt = Date.now();
  if (typeof symbol !== 'string' || !VALID_SYMBOL_IDENTIFIER_RE.test(symbol)) {
    throw new Error(
      'Invalid symbol identifier: must match /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/',
    );
  }
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));

  let searchRoot = realRoot;
  let scope = '.';
  if (options.scope && options.scope.trim()) {
    const scopeInput = options.scope.trim();
    const resolved = resolveInsideWorkspaceReal(realRoot, scopeInput);
    if (
      (!path.isAbsolute(scopeInput) && isSensitiveTurboPath(scopeInput)) ||
      isSensitiveTurboPath(resolved.relPath)
    ) {
      throw new Error(`Refused to scan sensitive scope: ${scopeInput}`);
    }
    searchRoot = resolved.realTarget;
    scope = resolved.relPath;
  }

  const maxFiles = Math.max(
    1,
    Math.min(
      Math.floor(Number.isFinite(options.maxFiles) ? (options.maxFiles as number) : DEFAULT_MAX_FILES),
      MAX_ALLOWED_FILES,
    ),
  );
  const maxHits = Math.max(
    1,
    Math.min(
      Math.floor(Number.isFinite(options.maxHits) ? (options.maxHits as number) : DEFAULT_MAX_HITS),
      MAX_ALLOWED_HITS,
    ),
  );
  const maxElapsedMs = Math.max(
    50,
    Math.min(
      Math.floor(
        Number.isFinite(options.maxElapsedMs) ? (options.maxElapsedMs as number) : DEFAULT_MAX_ELAPSED_MS,
      ),
      10_000,
    ),
  );

  const definitions: SymbolReferenceHit[] = [];
  const imports: SymbolReferenceHit[] = [];
  const usages: SymbolReferenceHit[] = [];
  let scannedFiles = 0;
  let totalHits = 0;
  let truncated = false;

  const isInsideRealRoot = (candidate: string): boolean =>
    isPathInsideDir(realRoot, candidate);

  const scanFile = (filePath: string, relPath: string): void => {
    if (scannedFiles >= maxFiles || totalHits >= maxHits || Date.now() - startedAt > maxElapsedMs) {
      truncated = true;
      return;
    }
    if (isSensitiveTurboPath(relPath) || isBinaryFilename(relPath)) return;

    let st: fs.Stats;
    try {
      const lst = fs.lstatSync(filePath);
      if (lst.isSymbolicLink() || !lst.isFile()) return;
      const realFile = canonicalRealpathSync(filePath);
      if (!isInsideRealRoot(realFile)) return;
      const realRel = path.relative(realRoot, realFile).replace(/\\/g, '/');
      if (isSensitiveTurboPath(realRel)) return;
      st = fs.statSync(realFile);
      if (!st.isFile() || st.size > TURBO_MAX_FILE_BYTES) return;

      const buf = fs.readFileSync(realFile);
      if (isBufferBinary(buf)) return;
      scannedFiles += 1;

      const text = buf.toString('utf8');
      // Fast pre-check before splitting lines
      if (!text.includes(symbol)) return;

      const hashComments = usesHashComments(realRel);
      const isRust = path.extname(realRel).toLowerCase() === '.rs';
      const lines = text.split(/\r?\n/);
      let inBlockComment = false;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const rawLine = lines[idx];
        const scan = scanLineForSymbolLinear(rawLine, symbol, inBlockComment, hashComments, isRust);
        inBlockComment = scan.nextInBlockComment;

        if (scan.matchOffsets.length === 0) continue;

        if (totalHits >= maxHits) {
          truncated = true;
          return;
        }

        const classified = classifyReference(scan.codeOnly, scan.matchOffsets, symbol.length);
        const hit: SymbolReferenceHit = {
          file: realRel,
          line: idx + 1,
          column: classified.column,
          kind: classified.kind,
          snippet: compactSnippet(rawLine),
        };
        if (hit.kind === 'definition') {
          definitions.push(hit);
        } else if (hit.kind === 'import') {
          imports.push(hit);
        } else {
          usages.push(hit);
        }
        totalHits += 1;
      }
    } catch {
      // skip unreadable files
    }
  };

  // Support scanning either a single file or a directory tree
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(searchRoot);
  } catch {
    return {
      symbol,
      scope,
      scannedFiles: 0,
      definitions: [],
      imports: [],
      usages: [],
      totalHits: 0,
      truncated: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  if (rootStat.isFile()) {
    const rel = path.relative(realRoot, searchRoot).replace(/\\/g, '/');
    scanFile(searchRoot, rel);
  } else if (rootStat.isDirectory()) {
    const visitedDirs = new Set<string>();
    const stack: string[] = [searchRoot];

    while (stack.length > 0) {
      if (scannedFiles >= maxFiles || totalHits >= maxHits || Date.now() - startedAt > maxElapsedMs) {
        truncated = true;
        break;
      }
      const currentDir = stack.pop()!;
      if (visitedDirs.has(currentDir)) continue;
      visitedDirs.add(currentDir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));

      const subDirs: string[] = [];
      for (const entry of entries) {
        if (scannedFiles >= maxFiles || totalHits >= maxHits || Date.now() - startedAt > maxElapsedMs) {
          truncated = true;
          break;
        }
        // Strictly skip all symlinks
        if (entry.isSymbolicLink()) continue;

        const fullPath = path.join(currentDir, entry.name);
        const rawRel = path.relative(realRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(rawRel)) continue;
          try {
            const realSub = canonicalRealpathSync(fullPath);
            if (!isInsideRealRoot(realSub)) continue;
            const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
            if (isSensitiveTurboPath(realSubRel)) continue;
            subDirs.push(realSub);
          } catch {
            continue;
          }
          continue;
        }

        if (entry.isFile()) {
          scanFile(fullPath, rawRel);
        }
      }

      // Push subDirs in reverse alphabetical order so DFS visits in deterministic alphabetical order
      for (let i = subDirs.length - 1; i >= 0; i -= 1) {
        stack.push(subDirs[i]);
      }
    }
  }

  return {
    symbol,
    scope,
    scannedFiles,
    definitions,
    imports,
    usages,
    totalHits,
    truncated,
    elapsedMs: Date.now() - startedAt,
  };
}
