import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../core/utils.js';

export const TURBO_MAX_QUERIES = 8;
export const TURBO_MAX_QUERY_LENGTH = 128;
export const TURBO_MAX_FILE_BYTES = 512 * 1024; // 512 KiB for batch search
export const TURBO_MAX_OUTLINE_FILE_BYTES = 1024 * 1024; // 1 MiB for outline/slice
export const TURBO_MAX_COMPACTED_CHUNKS = 24;

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
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.wav',
  '.flac',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.class',
  '.jar',
  '.pyc',
  '.o',
  '.a',
  '.lockb',
  '.dmg',
  '.iso',
]);

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);

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
]);

const SENSITIVE_DIR_SEGMENT_RE = /(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/i;

// Heuristic detector for catastrophic backtracking (ReDoS) patterns
const REPEATED_WILDCARD_RE = /(?:\.\*|\.\+){2,}/;
const BACKREFERENCE_RE = /\\[1-9]/;
const LOOKAROUND_RE = /\(\?[=!<]/;
const TURBO_MAX_REGEX_LINE_CHARS = 4096;
const TURBO_DEFAULT_SEARCH_BUDGET_MS = 1500;

function isQuantifierChar(ch: string | undefined): boolean {
  return ch === '+' || ch === '*' || ch === '{';
}

function inspectBraceQuantifier(
  pattern: string,
  startIdx: number,
): { isBrace: boolean; variable: boolean; tooLarge: boolean; endIdx: number } {
  const closeIdx = pattern.indexOf('}', startIdx + 1);
  if (closeIdx < 0) return { isBrace: false, variable: false, tooLarge: false, endIdx: startIdx };
  const inner = pattern.slice(startIdx + 1, closeIdx);
  if (!/^\d+(?:,\d*)?$/.test(inner)) {
    return { isBrace: false, variable: false, tooLarge: false, endIdx: startIdx };
  }
  const commaIdx = inner.indexOf(',');
  if (commaIdx < 0) {
    const exact = Number.parseInt(inner, 10);
    return { isBrace: true, variable: false, tooLarge: exact > 64, endIdx: closeIdx };
  }
  const minVal = Number.parseInt(inner.slice(0, commaIdx), 10);
  const maxStr = inner.slice(commaIdx + 1);
  const maxVal = maxStr === '' ? Number.POSITIVE_INFINITY : Number.parseInt(maxStr, 10);
  const variable = maxVal !== minVal;
  const tooLarge = minVal > 64 || (Number.isFinite(maxVal) && maxVal > 64);
  return { isBrace: true, variable, tooLarge, endIdx: closeIdx };
}

export function isPotentiallyUnsafeRegex(pattern: string): boolean {
  if (pattern.length > TURBO_MAX_QUERY_LENGTH) return true;
  if (REPEATED_WILDCARD_RE.test(pattern)) return true;
  if (BACKREFERENCE_RE.test(pattern)) return true;
  if (LOOKAROUND_RE.test(pattern)) return true;

  // Track quantifier / alternation presence inside groups and bound total/adjacent unbounded quantifiers
  const stack: Array<{ hasQuantifierOrAlt: boolean }> = [];
  let inCharClass = false;
  let escaped = false;
  let unboundedQuantifierCount = 0;
  let wildcardQuantifierCount = 0;
  let prevAtomQuantified = false;
  let lastAtomWasDot = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      lastAtomWasDot = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      lastAtomWasDot = false;
      continue;
    }
    if (inCharClass) {
      if (ch === ']') {
        inCharClass = false;
        lastAtomWasDot = false;
      }
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      lastAtomWasDot = false;
      continue;
    }
    if (ch === '(') {
      stack.push({ hasQuantifierOrAlt: false });
      prevAtomQuantified = false;
      lastAtomWasDot = false;
      continue;
    }
    if (ch === ')') {
      const frame = stack.pop();
      lastAtomWasDot = false;
      if (!frame) continue;
      const next = pattern[i + 1];
      const groupQuantified = isQuantifierChar(next);
      if (groupQuantified && frame.hasQuantifierOrAlt) {
        return true;
      }
      if (stack.length > 0 && (frame.hasQuantifierOrAlt || groupQuantified)) {
        stack[stack.length - 1].hasQuantifierOrAlt = true;
      }
      continue;
    }
    if (ch === '|') {
      prevAtomQuantified = false;
      lastAtomWasDot = false;
      if (stack.length > 0) {
        stack[stack.length - 1].hasQuantifierOrAlt = true;
      }
      continue;
    }
    if (ch === '+' || ch === '*') {
      unboundedQuantifierCount += 1;
      if (lastAtomWasDot) {
        wildcardQuantifierCount += 1;
      }
      if (unboundedQuantifierCount > 2 || wildcardQuantifierCount > 1 || prevAtomQuantified) {
        return true;
      }
      prevAtomQuantified = true;
      lastAtomWasDot = false;
      if (stack.length > 0) {
        stack[stack.length - 1].hasQuantifierOrAlt = true;
      }
      continue;
    }
    if (ch === '{') {
      const brace = inspectBraceQuantifier(pattern, i);
      if (brace.isBrace) {
        if (brace.tooLarge) {
          return true;
        }
        if (brace.variable) {
          unboundedQuantifierCount += 1;
          if (lastAtomWasDot) {
            wildcardQuantifierCount += 1;
          }
          if (unboundedQuantifierCount > 2 || wildcardQuantifierCount > 1 || prevAtomQuantified) {
            return true;
          }
          prevAtomQuantified = true;
        } else {
          prevAtomQuantified = false;
        }
        if (stack.length > 0) {
          stack[stack.length - 1].hasQuantifierOrAlt = true;
        }
        i = brace.endIdx;
        lastAtomWasDot = false;
        continue;
      }
    }
    if (ch === '?') {
      // Lazy modifier or optional quantifier
      lastAtomWasDot = false;
      continue;
    }
    // Plain atom resets consecutive-quantified adjacency only when separated by a non-quantified literal
    if (i + 1 >= pattern.length || !isQuantifierChar(pattern[i + 1])) {
      prevAtomQuantified = false;
    }
    lastAtomWasDot = ch === '.';
  }

  return false;
}

export interface BatchSearchOptions {
  directory?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxMatchesPerQuery?: number;
  maxTotalMatches?: number;
  maxFiles?: number;
  maxSnippetChars?: number;
  maxElapsedMs?: number;
}

export interface BatchSearchMatch {
  file: string;
  line: number;
  column: number;
  snippet: string;
}

export interface BatchQueryResult {
  query: string;
  mode: 'regex' | 'literal';
  fallbackLiteral?: boolean;
  totalHits: number;
  truncated: boolean;
  matches: BatchSearchMatch[];
}

export interface BatchSearchResult {
  scope: string;
  scannedFiles: number;
  skippedFiles: number;
  skippedSensitive: number;
  skippedSymlinks: number;
  totalMatches: number;
  truncated: boolean;
  elapsedMs: number;
  results: BatchQueryResult[];
}

export interface OutlineSymbol {
  kind: string;
  name: string;
  line: number;
  signature: string;
  level?: number;
}

export interface ReadOutlineOptions {
  startLine?: number;
  endLine?: number;
  includeOutline?: boolean;
  maxSliceLines?: number;
  maxOutlineItems?: number;
}

export interface ReadOutlineResult {
  file: string;
  language: string;
  totalLines: number;
  bytes: number;
  outline: OutlineSymbol[];
  outlineTruncated: boolean;
  slice: {
    startLine: number;
    endLine: number;
    truncated: boolean;
    content: string;
  };
  estimatedFullTokens: number;
  estimatedReturnedTokens: number;
  estimatedSavedTokens: number;
}

export type CompactPreset = 'auto' | 'test' | 'build' | 'git' | 'generic';
export type ResolvedCompactPreset = Exclude<CompactPreset, 'auto'>;

export interface CompactOutputOptions {
  preset?: CompactPreset;
  headLines?: number;
  tailLines?: number;
  maxErrorLines?: number;
  chunkLines?: number;
  persistStats?: boolean;
}

export interface AggregatedDiagnostic {
  line: number;
  severity: 'error' | 'warning';
  count: number;
  text: string;
}

export interface CompactOutputResult {
  chunkId: string;
  label: string;
  createdAt: string;
  totalLines: number;
  rawBytes: number;
  summaryBytes: number;
  estimatedRawTokens: number;
  estimatedSummaryTokens: number;
  estimatedSavedTokens: number;
  compressionRatio: number;
  chunkCount: number;
  errorCount: number;
  warningCount: number;
  diagnostics: AggregatedDiagnostic[];
  summaryText: string;
  detectedPreset: ResolvedCompactPreset;
  linesBefore: number;
  linesAfter: number;
  savedPercent: number;
}

export interface ChunkQueryMatch {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  matchedLine: number;
  snippet: string;
}

export interface ChunkQueryResult {
  found: boolean;
  chunkId: string;
  label?: string;
  totalLines?: number;
  query: string;
  totalHits: number;
  matches: ChunkQueryMatch[];
}

export interface CompactedChunkMeta {
  chunkId: string;
  label: string;
  createdAt: string;
  totalLines: number;
  rawBytes: number;
  estimatedRawTokens: number;
  estimatedSummaryTokens: number;
  estimatedSavedTokens: number;
  chunkCount: number;
  errorCount: number;
  warningCount: number;
  detectedPreset?: ResolvedCompactPreset;
  savedPercent?: number;
}

export interface WorkspaceSnapshot {
  workspaceName: string;
  packageName?: string;
  packageVersion?: string;
  techStack: string[];
  scripts: string[];
  treeLines: string[];
  lineCount: number;
  markdown: string;
  elapsedMs: number;
}

interface StoredChunkEntry {
  meta: CompactedChunkMeta;
  lines: string[];
  chunkLines: number;
  summaryText: string;
}

export function isSensitiveTurboPath(inputPath: string): boolean {
  if (!inputPath) return false;
  const normalized = inputPath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return false;
  if (SENSITIVE_DIR_SEGMENT_RE.test(normalized)) return true;

  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (
      lower === '.ssh' ||
      lower === '.aws' ||
      lower === '.gnupg' ||
      lower === '.kube' ||
      lower.startsWith('.env') ||
      lower.startsWith('credentials') ||
      lower.includes('secret')
    ) {
      return true;
    }
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

  const ext = path.posix.extname(lowerBase);
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;

  return false;
}

export function resolveInsideWorkspaceReal(
  workspaceRoot: string,
  targetPath: string,
): { realRoot: string; realTarget: string; relPath: string } {
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }
  if (!targetPath || targetPath.includes('\0')) {
    throw new Error('Invalid target path');
  }

  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(realRoot, targetPath);

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(candidate);
  } catch {
    throw new Error(`Target path does not exist or cannot be resolved: ${targetPath}`);
  }

  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realTarget !== realRoot && !realTarget.startsWith(prefix)) {
    throw new Error(`Path escapes workspace boundary: ${targetPath}`);
  }

  const relPath =
    realTarget === realRoot ? '.' : path.relative(realRoot, realTarget).replace(/\\/g, '/');
  return { realRoot, realTarget, relPath };
}

function isBinaryFilename(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isBufferBinary(buf: Buffer): boolean {
  const inspectLen = Math.min(buf.length, 8192);
  for (let i = 0; i < inspectLen; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CompiledQuery {
  raw: string;
  mode: 'regex' | 'literal';
  fallbackLiteral: boolean;
  regex?: RegExp;
  needleLower: string;
  caseSensitive: boolean;
}

function compileSearchQuery(rawQuery: string, wantRegex: boolean, caseSensitive: boolean): CompiledQuery {
  const trimmed = rawQuery.slice(0, TURBO_MAX_QUERY_LENGTH);
  if (!wantRegex) {
    return {
      raw: trimmed,
      mode: 'literal',
      fallbackLiteral: false,
      needleLower: trimmed.toLowerCase(),
      caseSensitive,
    };
  }

  const unsafeReDoS = isPotentiallyUnsafeRegex(trimmed);

  if (!unsafeReDoS) {
    try {
      const flags = caseSensitive ? '' : 'i';
      const compiled = new RegExp(trimmed, flags);
      return {
        raw: trimmed,
        mode: 'regex',
        fallbackLiteral: false,
        regex: compiled,
        needleLower: trimmed.toLowerCase(),
        caseSensitive,
      };
    } catch {
      // Fall back to literal search on malformed regex
    }
  }

  return {
    raw: trimmed,
    mode: 'literal',
    fallbackLiteral: true,
    regex: undefined,
    needleLower: trimmed.toLowerCase(),
    caseSensitive,
  };
}

function findMatchColumn(line: string, lowerLine: string, q: CompiledQuery): number {
  if (q.regex) {
    if (line.length > TURBO_MAX_REGEX_LINE_CHARS) {
      return -1;
    }
    q.regex.lastIndex = 0;
    const m = q.regex.exec(line);
    if (!m) return -1;
    return m.index + 1;
  }
  const idx = q.caseSensitive ? line.indexOf(q.raw) : lowerLine.indexOf(q.needleLower);
  return idx >= 0 ? idx + 1 : -1;
}

function buildCompactSnippet(line: string, column: number, maxChars: number): string {
  const trimmedLine = line.replace(/\t/g, '  ');
  if (trimmedLine.length <= maxChars) return trimmedLine.trim();
  const focus = Math.max(0, column - 1);
  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, focus - half);
  let end = Math.min(trimmedLine.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < trimmedLine.length ? '…' : '';
  return `${prefix}${trimmedLine.slice(start, end).trim()}${suffix}`;
}

export function batchSearchWorkspace(
  workspaceRoot: string,
  queries: string[],
  opts: BatchSearchOptions = {},
): BatchSearchResult {
  const startedAt = Date.now();
  const cleanedQueries = Array.from(
    new Set(
      queries
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter((q) => q.length > 0),
    ),
  ).slice(0, TURBO_MAX_QUERIES);

  if (cleanedQueries.length === 0) {
    throw new Error('At least one non-empty query is required');
  }

  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;

  let searchRoot = realRoot;
  let scope = '.';
  if (opts.directory && opts.directory.trim()) {
    const resolved = resolveInsideWorkspaceReal(realRoot, opts.directory.trim());
    if (
      (!path.isAbsolute(opts.directory.trim()) && isSensitiveTurboPath(opts.directory)) ||
      isSensitiveTurboPath(resolved.relPath)
    ) {
      throw new Error(`Refused to search sensitive directory: ${opts.directory}`);
    }
    searchRoot = resolved.realTarget;
    scope = resolved.relPath;
  }

  const maxMatchesPerQuery = Math.max(1, Math.min(opts.maxMatchesPerQuery ?? 25, 100));
  const maxTotalMatches = Math.max(1, Math.min(opts.maxTotalMatches ?? 120, 400));
  const maxFiles = Math.max(1, Math.min(opts.maxFiles ?? 800, 3000));
  const maxSnippetChars = Math.max(40, Math.min(opts.maxSnippetChars ?? 140, 260));
  const maxElapsedMs = Math.max(50, Math.min(opts.maxElapsedMs ?? TURBO_DEFAULT_SEARCH_BUDGET_MS, 10000));
  const caseSensitive = Boolean(opts.caseSensitive);
  const wantRegex = Boolean(opts.regex);

  const compiled = cleanedQueries.map((q) => compileSearchQuery(q, wantRegex, caseSensitive));
  const states: BatchQueryResult[] = compiled.map((c) => ({
    query: c.raw,
    mode: c.mode,
    fallbackLiteral: c.fallbackLiteral || undefined,
    totalHits: 0,
    truncated: false,
    matches: [],
  }));

  let scannedFiles = 0;
  let skippedFiles = 0;
  let skippedSensitive = 0;
  let skippedSymlinks = 0;
  let totalMatches = 0;
  let truncated = false;

  const visitedDirs = new Set<string>();
  const stack: string[] = [searchRoot];

  const isInsideRealRoot = (realCandidate: string): boolean =>
    realCandidate === realRoot || realCandidate.startsWith(rootPrefix);

  while (stack.length > 0) {
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

    for (const entry of entries) {
      if (scannedFiles >= maxFiles || Date.now() - startedAt > maxElapsedMs) {
        truncated = true;
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      const rawRel = path.relative(realRoot, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(rawRel)) {
          if (isSensitiveTurboPath(rawRel)) skippedSensitive += 1;
          continue;
        }
        try {
          const realSub = fs.realpathSync(fullPath);
          if (!isInsideRealRoot(realSub)) {
            skippedSymlinks += 1;
            continue;
          }
          const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
          if (isSensitiveTurboPath(realSubRel)) {
            skippedSensitive += 1;
            continue;
          }
          stack.push(realSub);
        } catch {
          skippedSymlinks += 1;
        }
        continue;
      }

      let realFilePath = fullPath;
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          realFilePath = fs.realpathSync(fullPath);
          if (!isInsideRealRoot(realFilePath)) {
            skippedSymlinks += 1;
            continue;
          }
          const st = fs.statSync(realFilePath);
          if (st.isDirectory()) {
            const realRelDir = path.relative(realRoot, realFilePath).replace(/\\/g, '/');
            if (SKIP_DIRS.has(path.basename(realFilePath)) || isSensitiveTurboPath(realRelDir)) {
              skippedSensitive += 1;
              continue;
            }
            stack.push(realFilePath);
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
      if (!isInsideRealRoot(realFilePath)) {
        skippedSymlinks += 1;
        continue;
      }

      const realRel = path.relative(realRoot, realFilePath).replace(/\\/g, '/');
      if (isSensitiveTurboPath(rawRel) || isSensitiveTurboPath(realRel)) {
        skippedSensitive += 1;
        continue;
      }

      if (isBinaryFilename(realFilePath)) {
        skippedFiles += 1;
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(realFilePath);
      } catch {
        skippedFiles += 1;
        continue;
      }

      if (!stat.isFile() || stat.size === 0 || stat.size > TURBO_MAX_FILE_BYTES) {
        skippedFiles += 1;
        continue;
      }

      let buf: Buffer;
      try {
        buf = fs.readFileSync(realFilePath);
      } catch {
        skippedFiles += 1;
        continue;
      }

      if (isBufferBinary(buf)) {
        skippedFiles += 1;
        continue;
      }

      scannedFiles += 1;
      const text = buf.toString('utf8');
      const lines = text.split(/\r?\n/);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
        const lineText = lines[lineIdx];
        if (!lineText) continue;
        const lowerLine = caseSensitive ? lineText : lineText.toLowerCase();

        for (let qIdx = 0; qIdx < compiled.length; qIdx += 1) {
          const col = findMatchColumn(lineText, lowerLine, compiled[qIdx]);
          if (col < 0) continue;

          const state = states[qIdx];
          state.totalHits += 1;
          totalMatches += 1;

          const totalRecorded = states.reduce((acc, s) => acc + s.matches.length, 0);
          if (state.matches.length < maxMatchesPerQuery && totalRecorded < maxTotalMatches) {
            state.matches.push({
              file: rawRel,
              line: lineIdx + 1,
              column: col,
              snippet: buildCompactSnippet(lineText, col, maxSnippetChars),
            });
          } else {
            state.truncated = true;
            truncated = true;
          }
        }
      }
    }

    if (scannedFiles >= maxFiles || Date.now() - startedAt > maxElapsedMs) {
      truncated = true;
      break;
    }
  }

  return {
    scope,
    scannedFiles,
    skippedFiles,
    skippedSensitive,
    skippedSymlinks,
    totalMatches,
    truncated,
    elapsedMs: Date.now() - startedAt,
    results: states,
  };
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py' || ext === '.pyi') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  return 'text';
}

export function extractOutlineSymbols(
  content: string,
  language: string,
  maxItems = 120,
): { symbols: OutlineSymbol[]; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  const symbols: OutlineSymbol[] = [];
  let truncated = false;

  const push = (sym: OutlineSymbol): boolean => {
    if (symbols.length >= maxItems) {
      truncated = true;
      return false;
    }
    symbols.push(sym);
    return true;
  };

  if (language === 'markdown') {
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (m) {
        const level = m[1].length;
        const heading = m[2].trim();
        if (!push({ kind: `h${level}`, name: heading, line: i + 1, signature: line.trim().slice(0, 120), level })) {
          break;
        }
      }
    }
    return { symbols, truncated };
  }

  if (language === 'typescript' || language === 'javascript') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent > 2) continue;

      let m: RegExpExecArray | null;
      if ((m = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed))) {
        if (!push({ kind: 'function', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      } else if ((m = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed))) {
        if (!push({ kind: 'class', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      } else if ((m = /^(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed))) {
        if (!push({ kind: 'interface', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      } else if ((m = /^(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]+>)?\s*=/.exec(trimmed))) {
        if (!push({ kind: 'type', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      } else if ((m = /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed))) {
        if (!push({ kind: 'enum', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      } else if ((m = /^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed))) {
        if (!push({ kind: 'export', name: m[1], line: i + 1, signature: trimmed.slice(0, 120) })) break;
      }
    }
    return { symbols, truncated };
  }

  if (language === 'python') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      if ((m = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line))) {
        if (!push({ kind: 'function', name: m[1], line: i + 1, signature: line.trim().slice(0, 120) })) break;
      } else if ((m = /^class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line))) {
        if (!push({ kind: 'class', name: m[1], line: i + 1, signature: line.trim().slice(0, 120) })) break;
      }
    }
    return { symbols, truncated };
  }

  if (language === 'go') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      if ((m = /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line))) {
        if (!push({ kind: 'function', name: m[1], line: i + 1, signature: line.trim().slice(0, 120) })) break;
      } else if ((m = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/.exec(line))) {
        if (!push({ kind: m[2], name: m[1], line: i + 1, signature: line.trim().slice(0, 120) })) break;
      }
    }
    return { symbols, truncated };
  }

  if (language === 'rust') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const indent = lines[i].length - lines[i].trimStart().length;
      if (indent > 2) continue;
      let m: RegExpExecArray | null;
      if ((m = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line))) {
        if (!push({ kind: 'fn', name: m[1], line: i + 1, signature: line.slice(0, 120) })) break;
      } else if ((m = /^(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line))) {
        if (!push({ kind: m[1], name: m[2], line: i + 1, signature: line.slice(0, 120) })) break;
      } else if ((m = /^impl(?:<[^>]+>)?\s+([A-Za-z0-9_:<>]+)/.exec(line))) {
        if (!push({ kind: 'impl', name: m[1], line: i + 1, signature: line.slice(0, 120) })) break;
      }
    }
    return { symbols, truncated };
  }

  return { symbols, truncated };
}

export function readFileOutlineAndSlice(
  workspaceRoot: string,
  filePath: string,
  opts: ReadOutlineOptions = {},
): ReadOutlineResult {
  const { realTarget, relPath } = resolveInsideWorkspaceReal(workspaceRoot, filePath);

  if ((!path.isAbsolute(filePath) && isSensitiveTurboPath(filePath)) || isSensitiveTurboPath(relPath)) {
    throw new Error(`Refused to read sensitive file: ${path.basename(filePath)}`);
  }

  if (isBinaryFilename(realTarget)) {
    throw new Error(`Refused to read binary file: ${relPath}`);
  }

  const stat = fs.statSync(realTarget);
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${relPath}`);
  }
  if (stat.size > TURBO_MAX_OUTLINE_FILE_BYTES) {
    throw new Error(`File exceeds ${TURBO_MAX_OUTLINE_FILE_BYTES} byte limit: ${relPath}`);
  }

  const buf = fs.readFileSync(realTarget);
  if (isBufferBinary(buf)) {
    throw new Error(`Detected binary content in file: ${relPath}`);
  }

  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const language = detectLanguage(realTarget);

  const includeOutline = opts.includeOutline !== false;
  const maxOutlineItems = Math.max(1, Math.min(opts.maxOutlineItems ?? 120, 300));
  const { symbols, truncated: outlineTruncated } = includeOutline
    ? extractOutlineSymbols(text, language, maxOutlineItems)
    : { symbols: [], truncated: false };

  const maxSliceLines = Math.max(1, Math.min(opts.maxSliceLines ?? 120, 300));
  const startLine = Math.max(1, Math.min(Math.floor(opts.startLine ?? 1), Math.max(1, totalLines)));
  const requestedEnd =
    opts.endLine !== undefined
      ? Math.max(startLine, Math.floor(opts.endLine))
      : Math.min(totalLines, startLine + Math.min(maxSliceLines, 60) - 1);
  const clampedEnd = Math.min(totalLines, startLine + maxSliceLines - 1, requestedEnd);
  const sliceTruncated = clampedEnd < requestedEnd || clampedEnd < totalLines;

  const sliceLines = lines.slice(startLine - 1, clampedEnd);
  const numberedContent = sliceLines
    .map((lineText, idx) => `${startLine + idx} | ${lineText}`)
    .join('\n');

  const estimatedFullTokens = Math.ceil(text.length / 4);
  const outlineChars = symbols.reduce((sum, s) => sum + s.signature.length + 16, 0);
  const estimatedReturnedTokens = Math.ceil((numberedContent.length + outlineChars) / 4);
  const estimatedSavedTokens = Math.max(0, estimatedFullTokens - estimatedReturnedTokens);

  return {
    file: relPath,
    language,
    totalLines,
    bytes: stat.size,
    outline: symbols,
    outlineTruncated,
    slice: {
      startLine,
      endLine: clampedEnd,
      truncated: sliceTruncated,
      content: numberedContent,
    },
    estimatedFullTokens,
    estimatedReturnedTokens,
    estimatedSavedTokens,
  };
}

// LRU store for compacted outputs (in-memory only, max 24 entries)
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const ERROR_LINE_RE =
  /\b(?:error|err!|fail|failed|failure|exception|fatal|panic|traceback|assertionerror|typeerror|syntaxerror|referenceerror|enoent|eacces|ts\d{4})\b|^\s*(?:✗|✖|×|FAIL\b)/i;
const WARN_LINE_RE = /\b(?:warn|warning|deprecated)\b|^\s*⚠/i;

function stripAnsiSequences(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

function cleanLogLine(line: string): string {
  const noAnsi = stripAnsiSequences(line);
  if (!noAnsi.includes('\r')) return noAnsi;
  const segments = noAnsi.split('\r');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].length > 0) return segments[i];
  }
  return '';
}

function normalizeDiagKey(line: string): string {
  return line
    .trim()
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

const TEST_PASS_LINE_RE =
  /^\s*(?:(?:✔|✓)\s+(?!built in\b|\d+\s+modules?\s+transformed\b)\S|ok\s+\d+(?:\s|-|$)|PASS(?:\s+\S|\s*$)|---\s+PASS:|test\s+.+\.\.\.\s+ok\s*$|.+::.+PASSED(?:\s+\[\s*\d+%\])?\s*$)/;
const TEST_FAIL_START_RE =
  /^\s*(?:FAIL(?:\s|:|$)|not ok\s+\d+|---\s+FAIL:|(?:✖|✗|×)\s+|AssertionError\b|Error:|TypeError:|SyntaxError:|ReferenceError:|Traceback\b|FAILURES\b|short test summary|thread '[^']*' panicked|panicked at|E\s{3,})|\.\.\.\s+FAILED\s*$|\bFAILED(?:\s+\[\s*\d+%\])?\s*$/;
const TEST_STACK_OR_DIFF_RE =
  /^\s*(?:at\s+\S|File\s+"|Expected\b|Received\b|Actual\b|expected\b|actual\b|stack:|[-+]\s|\|\s|\d+\s*\||>?\s*\d+\s*\||[~^]{2,}|Difference:)/;
const TEST_SUMMARY_LINE_RE =
  /^\s*(?:Tests:|Test Suites:|Test Files\b|Snapshots:|Time:|Duration\b|Start at\b|Summary:|Ran\s+\d+\s+tests?|test result:|ℹ\s+(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b|={3,}.*(?:passed|failed|error).*={3,}|FAILED\s*\(|exitCode=|exit code\b)/i;
const TEST_VERBOSE_NOISE_RE = /^\s*(?:info\s+\[|debug\s+\[|\[(?:info|debug)\]|#\s*Subtest:)/i;

const BUILD_NOISE_LINE_RE =
  /transforming\s*\(\d+\)|\b\d+\s+modules?\s+transformed\b|^\s*(?:transforming\b|Compiling\s+|Checking\s+|Downloading\s+|Unpacking\s+|Resolving\s+|Fetching\s+|Updating\s+|Fresh\s+|Copying\s+|Bundling\s+|Generating\s+|Rendering\s+chunks|Computing\s+gzip|reify:|npm\s+(?:timing|http)\b|info\s+\[|debug\s+\[|\[(?:info|debug)\]|\[\d+\/\d+\]\s+(?:Building|Compiling|Resolving|Fetching|Linking)|\d{1,3}%\s+(?:building|sealing|emitting|compiling|hashing|asset))/i;
const BUILD_FILE_LOC_RE =
  /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+(?:\(\d+,\d+\)|:\d+:\d+)/;
const BUILD_DIAG_CONTEXT_RE =
  /^\s*(?:\d+\s*\||\|\s|[~^]{2,}|-->\s+|=\s*(?:note|help):|at\s+\S)/;
const BUILD_SUMMARY_LINE_RE =
  /(?:✓|✔)?\s*built in\s+\d|^\s*(?:Finished\s+|Found\s+\d+\s+errors?|Compiled\s+|Build\s+(?:succeeded|failed|complete)|Done in\s+|added\s+\d+\s+packages|found\s+\d+\s+vulnerabilities|Summary:|FAILED\b|dist\/\S+\s+[\d.]+\s*(?:kB|KB|MB|B)\b|webpack\b.*compiled)/i;

const LOCK_OR_GENERATED_PATH_RE =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|Podfile\.lock|uv\.lock|flake\.lock|bun\.lock|bun\.lockb)$|(?:^|\/)(?:dist|build|vendor|generated)\/|\.(?:min\.js|min\.css|bundle\.js|map|snap|pb\.go)$|\.generated\.[^/]+$/i;

export function detectOutputPreset(text: string): ResolvedCompactPreset {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw.trim()) return 'generic';

  const rawLines = raw.split(/\r?\n/);
  const sampleLines: string[] = [];
  if (rawLines.length <= 800) {
    for (const l of rawLines) sampleLines.push(cleanLogLine(l));
  } else {
    for (let i = 0; i < 600; i += 1) sampleLines.push(cleanLogLine(rawLines[i]));
    for (let i = rawLines.length - 200; i < rawLines.length; i += 1) {
      sampleLines.push(cleanLogLine(rawLines[i]));
    }
  }

  let gitScore = 0;
  let testScore = 0;
  let buildScore = 0;

  let gitDiffHeaders = 0;
  let gitHunks = 0;
  let gitMetaHits = 0;
  let testPassHits = 0;
  let testStrongHits = 0;
  let buildNoiseHits = 0;
  let buildStrongHits = 0;

  for (const rawLine of sampleLines) {
    if (!rawLine) continue;
    const line = rawLine.length > 512 ? rawLine.slice(0, 512) : rawLine;

    // Git signatures
    if (/^diff --git\s+/.test(line)) {
      gitDiffHeaders += 1;
      gitScore += 6;
    } else if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line)) {
      gitHunks += 1;
      if (gitHunks <= 4) gitScore += 4;
    } else if (/^commit\s+[0-9a-f]{7,40}\b/.test(line)) {
      gitMetaHits += 1;
      if (gitMetaHits <= 4) gitScore += 3;
    } else if (
      /^(?:index\s+[0-9a-f]{7,}\.\.[0-9a-f]{7,}|---\s+a\/|\+\+\+\s+b\/)/.test(line) ||
      /^\s*(?:modified|new file|deleted|renamed):\s+\S/.test(line) ||
      /\b\d+\s+files?\s+changed,\s+\d+\s+(?:insertions?|deletions?)/.test(line)
    ) {
      gitMetaHits += 1;
      if (gitMetaHits <= 6) gitScore += 2;
    }

    // Test signatures
    if (
      /^\s*(?:---\s+(?:FAIL|PASS):|Tests:|Test Suites:|Test Files\b|TAP version \d+|ℹ\s+(?:pass|fail|tests)\b|test result:\s*(?:ok|FAILED))/.test(
        line,
      ) ||
      /\b(?:pytest|cargo test)\b/i.test(line)
    ) {
      testStrongHits += 1;
      if (testStrongHits <= 6) testScore += 4;
    } else if (/^\s*(?:PASS|FAIL)\s+\S/.test(line) || /^\s*not ok\s+\d+/.test(line)) {
      testStrongHits += 1;
      if (testStrongHits <= 6) testScore += 3;
    } else if (TEST_PASS_LINE_RE.test(line) || /^\s*(?:✖|✗)\s+\S/.test(line)) {
      testPassHits += 1;
      if (testPassHits <= 6) testScore += 2;
    }

    // Build signatures
    if (
      /\berror\s+TS\d{4}\b|\bTS\d{4}:/.test(line) ||
      /transforming\s*\(\d+\)|\b\d+\s+modules?\s+transformed\b|(?:✓|✔)?\s*built in\s+\d/.test(line) ||
      /\b(?:vite|esbuild|webpack|eslint)\b/i.test(line)
    ) {
      buildStrongHits += 1;
      if (buildStrongHits <= 6) buildScore += 4;
    } else if (
      /^\s*(?:Compiling|Checking|Finished|Bundling)\s+\S/.test(line) ||
      /\bwarning:\s+\S/i.test(line) ||
      (BUILD_FILE_LOC_RE.test(line) && /\b(?:error|warning)\b/i.test(line))
    ) {
      buildNoiseHits += 1;
      if (buildNoiseHits <= 6) buildScore += 2;
    }
  }

  // Real top-level `diff --git` header always takes priority over diff body contents
  if (gitDiffHeaders > 0) {
    return 'git';
  }

  const best = Math.max(gitScore, testScore, buildScore);
  if (best < 3) return 'generic';
  if (gitScore >= testScore && gitScore >= buildScore) return 'git';
  if (testScore >= buildScore) return 'test';
  return 'build';
}

export const TURBO_DEFAULT_MAX_COMPACT_LINES = 180;
export const TURBO_MIN_COMPACT_LINES = 20;
export const TURBO_MAX_COMPACT_LINES = 300;
const TURBO_MAX_COMPACT_BYTES = 48 * 1024;

export function capCompactedLines(
  lines: string[],
  maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES,
  maxBytes = TURBO_MAX_COMPACT_BYTES,
): string[] {
  const cap = Math.max(
    TURBO_MIN_COMPACT_LINES,
    Math.min(
      Math.floor(Number.isFinite(maxLines) ? maxLines : TURBO_DEFAULT_MAX_COMPACT_LINES),
      TURBO_MAX_COMPACT_LINES,
    ),
  );
  const byteLimit = Math.max(
    2048,
    Math.floor(Number.isFinite(maxBytes) ? maxBytes : TURBO_MAX_COMPACT_BYTES),
  );
  const clipLine = (l: string): string => (l.length > 240 ? l.slice(0, 240) : l);
  const calcBytes = (arr: string[]): number => Buffer.byteLength(arr.join('\n'), 'utf8');

  if (lines.length <= cap) {
    const bounded = lines.map(clipLine);
    if (calcBytes(bounded) <= byteLimit) {
      return bounded;
    }
  }

  const buildCapped = (budget: number): string[] => {
    const contentBudget = Math.max(2, budget - 1);
    const headKeep = Math.max(1, Math.floor(contentBudget * 0.6));
    const tailKeep = Math.max(1, contentBudget - headKeep);
    const omitted = lines.length - headKeep - tailKeep;
    if (omitted <= 0) {
      return lines.map(clipLine);
    }
    const marker = `... [truncated ${omitted} additional diagnostic lines; query full indexed log via chunkId]`;
    return [
      ...lines.slice(0, headKeep).map(clipLine),
      marker,
      ...lines.slice(lines.length - tailKeep).map(clipLine),
    ];
  };

  let budget = Math.min(cap, Math.max(3, lines.length - 1));
  let result = buildCapped(budget);

  while (calcBytes(result) > byteLimit && budget > 3) {
    const nextBudget = Math.max(3, Math.floor(budget * 0.75));
    if (nextBudget >= budget) break;
    budget = nextBudget;
    result = buildCapped(budget);
  }

  return result;
}

function compactTestOutputLines(
  cleanedLines: string[],
  maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES,
): string[] {
  const out: string[] = [];
  let passingRun: string[] = [];
  let noiseRun: string[] = [];
  let inFailureBlock = false;
  let failureBlankStreak = 0;

  const flushPassing = () => {
    if (passingRun.length === 0) return;
    if (passingRun.length === 1) {
      out.push(passingRun[0].slice(0, 240));
    } else {
      out.push(`... [collapsed ${passingRun.length} passing test lines]`);
    }
    passingRun = [];
  };

  const flushNoise = () => {
    if (noiseRun.length === 0) return;
    if (noiseRun.length <= 2) {
      for (const l of noiseRun) out.push(l.slice(0, 240));
    } else {
      out.push(`... [collapsed ${noiseRun.length} verbose log lines]`);
    }
    noiseRun = [];
  };

  for (let i = 0; i < cleanedLines.length; i += 1) {
    const line = cleanedLines[i];
    const probe = line.length > 512 ? line.slice(0, 512) : line;
    const trimmed = probe.trim();

    if (TEST_SUMMARY_LINE_RE.test(probe)) {
      flushPassing();
      flushNoise();
      inFailureBlock = false;
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }

    if (TEST_FAIL_START_RE.test(probe)) {
      flushPassing();
      flushNoise();
      inFailureBlock = true;
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }

    if (inFailureBlock) {
      if (TEST_PASS_LINE_RE.test(probe)) {
        inFailureBlock = false;
        failureBlankStreak = 0;
        passingRun.push(line);
        continue;
      }
      if (!trimmed) {
        failureBlankStreak += 1;
        if (failureBlankStreak <= 2) {
          out.push('');
        } else {
          inFailureBlock = false;
        }
        continue;
      }
      if (TEST_VERBOSE_NOISE_RE.test(probe) && !ERROR_LINE_RE.test(probe)) {
        inFailureBlock = false;
        failureBlankStreak = 0;
        noiseRun.push(line);
        continue;
      }
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }

    if (TEST_PASS_LINE_RE.test(probe)) {
      flushNoise();
      passingRun.push(line);
      continue;
    }

    if (!trimmed) {
      // Absorb blank lines inside passing runs; preserve outside
      if (passingRun.length === 0 && noiseRun.length === 0 && out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }

    if (ERROR_LINE_RE.test(probe) || WARN_LINE_RE.test(probe) || TEST_STACK_OR_DIFF_RE.test(probe)) {
      flushPassing();
      flushNoise();
      if (ERROR_LINE_RE.test(probe)) {
        inFailureBlock = true;
        failureBlankStreak = 0;
      }
      out.push(line.slice(0, 240));
      continue;
    }

    if (i < 3) {
      flushPassing();
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }

    if (TEST_VERBOSE_NOISE_RE.test(probe)) {
      flushPassing();
      noiseRun.push(line);
      continue;
    }

    // Other ordinary non-passing, non-error lines
    if (passingRun.length > 0) {
      flushPassing();
    }
    noiseRun.push(line);
  }

  flushPassing();
  flushNoise();

  return capCompactedLines(out, maxLines);
}

function compactBuildOutputLines(
  cleanedLines: string[],
  maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES,
): string[] {
  const out: string[] = [];
  let noiseRun: string[] = [];
  let diagFollowRemaining = 0;

  const flushNoise = () => {
    if (noiseRun.length === 0) return;
    if (noiseRun.length === 1) {
      out.push(noiseRun[0].slice(0, 240));
    } else {
      out.push(`... [collapsed ${noiseRun.length} build progress lines]`);
    }
    noiseRun = [];
  };

  for (let i = 0; i < cleanedLines.length; i += 1) {
    const line = cleanedLines[i];
    const probe = line.length > 512 ? line.slice(0, 512) : line;
    const trimmed = probe.trim();

    const isErrorOrWarn =
      ERROR_LINE_RE.test(probe) ||
      WARN_LINE_RE.test(probe) ||
      /^\s*\d+:\d+\s+(?:error|warning)\b/i.test(probe) ||
      (BUILD_FILE_LOC_RE.test(probe) && !BUILD_NOISE_LINE_RE.test(probe));

    if (isErrorOrWarn) {
      flushNoise();
      out.push(line.slice(0, 240));
      diagFollowRemaining = 3;
      continue;
    }

    if (diagFollowRemaining > 0) {
      if (trimmed && (BUILD_DIAG_CONTEXT_RE.test(probe) || /^\s{2,}\S/.test(probe)) && !BUILD_NOISE_LINE_RE.test(probe)) {
        flushNoise();
        out.push(line.slice(0, 240));
        diagFollowRemaining -= 1;
        continue;
      }
      diagFollowRemaining = 0;
    }

    if (BUILD_SUMMARY_LINE_RE.test(probe)) {
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }

    if (BUILD_NOISE_LINE_RE.test(probe)) {
      noiseRun.push(line);
      continue;
    }

    if (!trimmed) {
      if (noiseRun.length === 0 && out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }

    if (i < 2 || i >= cleanedLines.length - 3) {
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }

    noiseRun.push(line);
  }

  flushNoise();
  return capCompactedLines(out, maxLines);
}

function extractGitDiffPath(diffHeaderLine: string): string {
  const m = /^diff --git\s+"?a\/(.+?)"?\s+"?b\/(.+?)"?\s*$/.exec(diffHeaderLine);
  if (m) return m[2];
  return diffHeaderLine;
}

function compactGitOutputLines(
  cleanedLines: string[],
  maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES,
): string[] {
  const hasDiff = cleanedLines.some((l) => l.startsWith('diff --git '));
  if (!hasDiff) {
    // Compact git status / git log output
    const out: string[] = [];
    let listRun: string[] = [];
    const flushList = () => {
      if (listRun.length === 0) return;
      if (listRun.length <= 20) {
        for (const l of listRun) out.push(l.slice(0, 240));
      } else {
        for (const l of listRun.slice(0, 12)) out.push(l.slice(0, 240));
        out.push(`... [collapsed ${listRun.length - 16} git file status lines]`);
        for (const l of listRun.slice(-4)) out.push(l.slice(0, 240));
      }
      listRun = [];
    };
    for (const line of cleanedLines) {
      if (/^\s*(?:modified|new file|deleted|renamed|untracked):\s+/.test(line) || /^\t\S/.test(line)) {
        listRun.push(line);
      } else {
        flushList();
        out.push(line.slice(0, 240));
      }
    }
    flushList();
    return capCompactedLines(out, maxLines);
  }

  const out: string[] = [];
  interface DiffBlock {
    headerLine: string;
    filePath: string;
    metaLines: string[];
    bodyLines: string[];
  }

  const preamble: string[] = [];
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | null = null;
  let inBody = false;

  for (const line of cleanedLines) {
    if (line.startsWith('diff --git ')) {
      current = {
        headerLine: line,
        filePath: extractGitDiffPath(line),
        metaLines: [],
        bodyLines: [],
      };
      blocks.push(current);
      inBody = false;
      continue;
    }

    if (!current) {
      preamble.push(line);
      continue;
    }

    if (
      !inBody &&
      (line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to') ||
        line.startsWith('Binary files'))
    ) {
      current.metaLines.push(line);
    } else {
      inBody = true;
      current.bodyLines.push(line);
    }
  }

  for (const line of preamble.slice(0, 25)) {
    out.push(line.slice(0, 240));
  }
  if (preamble.length > 25) {
    out.push(`... [collapsed ${preamble.length - 25} git preamble lines]`);
  }

  for (let bIdx = 0; bIdx < blocks.length; bIdx += 1) {
    const block = blocks[bIdx];
    out.push(block.headerLine.slice(0, 240));
    for (const m of block.metaLines) {
      out.push(m.slice(0, 240));
    }

    if (block.bodyLines.length === 0) continue;

    let added = 0;
    let removed = 0;
    for (const l of block.bodyLines) {
      if (l.startsWith('+') && !l.startsWith('+++')) added += 1;
      else if (l.startsWith('-') && !l.startsWith('---')) removed += 1;
    }

    const isLockOrGenerated = LOCK_OR_GENERATED_PATH_RE.test(block.filePath);
    if (isLockOrGenerated || block.bodyLines.length > 200 || bIdx >= 35) {
      const kindLabel = isLockOrGenerated ? 'lockfile/generated diff' : 'large file diff';
      out.push(`... [collapsed ${kindLabel}: ${block.bodyLines.length} lines (+${added} / -${removed})]`);
      continue;
    }

    // Split body into hunks and compact oversized hunks while preserving context
    const hunks: string[][] = [];
    let currentHunk: string[] = [];
    for (const l of block.bodyLines) {
      if (l.startsWith('@@ ')) {
        if (currentHunk.length > 0) hunks.push(currentHunk);
        currentHunk = [l];
      } else {
        currentHunk.push(l);
      }
    }
    if (currentHunk.length > 0) hunks.push(currentHunk);

    for (const hunk of hunks) {
      if (hunk.length <= 36) {
        for (const l of hunk) out.push(l.slice(0, 240));
      } else {
        const keepHead = 12;
        const keepTail = 6;
        const middle = hunk.slice(keepHead, hunk.length - keepTail);
        let midAdd = 0;
        let midDel = 0;
        for (const ml of middle) {
          if (ml.startsWith('+')) midAdd += 1;
          else if (ml.startsWith('-')) midDel += 1;
        }
        for (const l of hunk.slice(0, keepHead)) out.push(l.slice(0, 240));
        out.push(`... [collapsed ${middle.length} hunk lines (+${midAdd} / -${midDel})]`);
        for (const l of hunk.slice(-keepTail)) out.push(l.slice(0, 240));
      }
    }
  }

  return capCompactedLines(out, maxLines);
}

export class CompactedChunkStore {
  private readonly entries = new Map<string, StoredChunkEntry>();
  private readonly maxEntries: number;
  private totalCompactions = 0;
  private totalSavedTokens = 0;
  private totalRawBytes = 0;

  constructor(maxEntries = TURBO_MAX_COMPACTED_CHUNKS) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  compact(
    dataDir: string | undefined,
    label: string,
    rawText: string,
    opts: CompactOutputOptions = {},
  ): CompactOutputResult {
    const safeLabel =
      (label || 'output').replace(/[\r\n\t\x00-\x1f]/g, ' ').trim().slice(0, 80) || 'output';
    const raw = typeof rawText === 'string' ? rawText : String(rawText ?? '');
    const rawLines = raw.split(/\r?\n/);
    const lines = rawLines.map(cleanLogLine);
    const totalLines = lines.length;
    const linesBefore = totalLines;
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const estimatedRawTokens = Math.ceil(raw.length / 4);

    const headCount = Math.max(1, Math.min(opts.headLines ?? 12, 50));
    const tailCount = Math.max(1, Math.min(opts.tailLines ?? 15, 50));
    const maxErrorLines = Math.max(1, Math.min(opts.maxErrorLines ?? 20, 60));
    const maxCompactedLines =
      typeof opts.maxErrorLines === 'number' && Number.isFinite(opts.maxErrorLines)
        ? Math.max(
            TURBO_MIN_COMPACT_LINES,
            Math.min(Math.floor(opts.maxErrorLines), TURBO_MAX_COMPACT_LINES),
          )
        : TURBO_DEFAULT_MAX_COMPACT_LINES;
    const chunkLines = Math.max(10, Math.min(opts.chunkLines ?? 40, 200));

    const requestedPreset: CompactPreset = opts.preset ?? 'auto';
    const detectedPreset: ResolvedCompactPreset =
      requestedPreset === 'auto' ? detectOutputPreset(raw) : requestedPreset;

    const diagMap = new Map<string, AggregatedDiagnostic>();
    let errorCount = 0;
    let warningCount = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i].trim();
      if (!text) continue;
      let severity: 'error' | 'warning' | null = null;
      if (ERROR_LINE_RE.test(text)) {
        severity = 'error';
        errorCount += 1;
      } else if (WARN_LINE_RE.test(text)) {
        severity = 'warning';
        warningCount += 1;
      }
      if (!severity) continue;

      const key = `${severity}:${normalizeDiagKey(text)}`;
      const existing = diagMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        diagMap.set(key, {
          line: i + 1,
          severity,
          count: 1,
          text: text.slice(0, 180),
        });
      }
    }

    const diagnostics = Array.from(diagMap.values())
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        if (b.count !== a.count) return b.count - a.count;
        return a.line - b.line;
      })
      .slice(0, maxErrorLines);

    const bodySections: string[] = [];

    if (detectedPreset === 'test') {
      bodySections.push(...compactTestOutputLines(lines, maxCompactedLines));
    } else if (detectedPreset === 'build') {
      bodySections.push(...compactBuildOutputLines(lines, maxCompactedLines));
    } else if (detectedPreset === 'git') {
      bodySections.push(...compactGitOutputLines(lines, maxCompactedLines));
    } else {
      const headSlice = lines.slice(0, Math.min(headCount, totalLines));
      const tailStart = Math.max(headSlice.length, totalLines - tailCount);
      const tailSlice = tailStart < totalLines ? lines.slice(tailStart) : [];
      const omittedMid = Math.max(0, tailStart - headSlice.length);

      if (diagnostics.length > 0) {
        bodySections.push('--- Errors & Warnings (aggregated) ---');
        for (const d of diagnostics) {
          const repeat = d.count > 1 ? ` (x${d.count})` : '';
          bodySections.push(`[${d.severity.toUpperCase()} L${d.line}]${repeat} ${d.text}`);
        }
      }

      bodySections.push(`--- Head (L1-L${headSlice.length}) ---`);
      bodySections.push(
        headSlice
          .map((l, idx) => `${idx + 1} | ${l.slice(0, 220)}`)
          .join('\n'),
      );

      if (omittedMid > 0) {
        bodySections.push(`... (${omittedMid} middle lines indexed in memory; query via chunkId) ...`);
      }

      if (tailSlice.length > 0) {
        bodySections.push(`--- Tail (L${tailStart + 1}-L${totalLines}) ---`);
        bodySections.push(
          tailSlice
            .map((l, idx) => `${tailStart + idx + 1} | ${l.slice(0, 220)}`)
            .join('\n'),
        );
      }
    }

    const buildSummary = (pct: number): string => {
      const header = `[Turbo Compact] ${safeLabel} [preset=${detectedPreset}, saved ${pct}%] — ${totalLines} lines, ${rawBytes} bytes (~${estimatedRawTokens} tokens), errors=${errorCount}, warnings=${warningCount}`;
      return [header, ...bodySections].join('\n');
    };

    const draftText = buildSummary(0);
    const draftBytes = Buffer.byteLength(draftText, 'utf8');
    const draftRatio =
      rawBytes > 0 ? Number((1 - Math.min(draftBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
    const draftSavedPct = Math.max(0, Math.min(100, Math.round(draftRatio * 100)));

    let summaryText = buildSummary(draftSavedPct);
    let summaryBytes = Buffer.byteLength(summaryText, 'utf8');
    let compressionRatio =
      rawBytes > 0 ? Number((1 - Math.min(summaryBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
    let savedPercent = Math.max(0, Math.min(100, Math.round(compressionRatio * 100)));

    if (savedPercent !== draftSavedPct) {
      summaryText = buildSummary(savedPercent);
      summaryBytes = Buffer.byteLength(summaryText, 'utf8');
      compressionRatio =
        rawBytes > 0 ? Number((1 - Math.min(summaryBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
      savedPercent = Math.max(0, Math.min(100, Math.round(compressionRatio * 100)));
    }

    const linesAfter = summaryText.split(/\r?\n/).length;
    const estimatedSummaryTokens = Math.ceil(summaryText.length / 4);
    const estimatedSavedTokens = Math.max(0, estimatedRawTokens - estimatedSummaryTokens);
    const chunkCount = Math.max(1, Math.ceil(totalLines / chunkLines));
    const chunkId = `chk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = new Date().toISOString();

    const meta: CompactedChunkMeta = {
      chunkId,
      label: safeLabel,
      createdAt,
      totalLines,
      rawBytes,
      estimatedRawTokens,
      estimatedSummaryTokens,
      estimatedSavedTokens,
      chunkCount,
      errorCount,
      warningCount,
      detectedPreset,
      savedPercent,
    };

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(chunkId, { meta, lines, chunkLines, summaryText });

    this.totalCompactions += 1;
    this.totalSavedTokens += estimatedSavedTokens;
    this.totalRawBytes += rawBytes;

    if (opts.persistStats && dataDir) {
      try {
        atomicWriteJson(path.join(dataDir, 'stats.json'), {
          schemaVersion: 1,
          totalCompactions: this.totalCompactions,
          totalSavedTokens: this.totalSavedTokens,
          totalRawBytes: this.totalRawBytes,
          updatedAt: createdAt,
        });
      } catch {
        // best-effort optional persistence
      }
    }

    return {
      ...meta,
      summaryBytes,
      compressionRatio,
      diagnostics,
      summaryText,
      detectedPreset,
      linesBefore,
      linesAfter,
      savedPercent,
    };
  }

  query(chunkId: string, query: string, limit = 10): ChunkQueryResult {
    const cleanQuery = (query || '').trim();
    const entry = this.entries.get(chunkId);
    if (!entry) {
      return {
        found: false,
        chunkId,
        query: cleanQuery,
        totalHits: 0,
        matches: [],
      };
    }

    // Refresh LRU order
    this.entries.delete(chunkId);
    this.entries.set(chunkId, entry);

    const maxHits = Math.max(1, Math.min(limit, 50));
    const tokens = cleanQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const matches: ChunkQueryMatch[] = [];
    let totalHits = 0;

    for (let i = 0; i < entry.lines.length; i += 1) {
      const lower = entry.lines[i].toLowerCase();
      const matched =
        tokens.length === 0 ? true : tokens.every((tok) => lower.includes(tok));
      if (!matched) continue;

      totalHits += 1;
      if (matches.length < maxHits) {
        const ctxStart = Math.max(0, i - 1);
        const ctxEnd = Math.min(entry.lines.length - 1, i + 1);
        const snippet = entry.lines
          .slice(ctxStart, ctxEnd + 1)
          .map((l, offset) => `${ctxStart + offset + 1} | ${l.slice(0, 220)}`)
          .join('\n');
        matches.push({
          chunkIndex: Math.floor(i / entry.chunkLines),
          startLine: ctxStart + 1,
          endLine: ctxEnd + 1,
          matchedLine: i + 1,
          snippet,
        });
      }
    }

    return {
      found: true,
      chunkId,
      label: entry.meta.label,
      totalLines: entry.meta.totalLines,
      query: cleanQuery,
      totalHits,
      matches,
    };
  }

  listChunks(): CompactedChunkMeta[] {
    return Array.from(this.entries.values())
      .map((e) => ({ ...e.meta }))
      .reverse();
  }

  getStats(): {
    indexedChunks: number;
    maxChunks: number;
    totalCompactions: number;
    totalSavedTokens: number;
    totalRawBytes: number;
  } {
    return {
      indexedChunks: this.entries.size,
      maxChunks: this.maxEntries,
      totalCompactions: this.totalCompactions,
      totalSavedTokens: this.totalSavedTokens,
      totalRawBytes: this.totalRawBytes,
    };
  }

  clear(): void {
    this.entries.clear();
  }
}

export const defaultCompactedChunkStore = new CompactedChunkStore(TURBO_MAX_COMPACTED_CHUNKS);

export function compactLargeOutput(
  dataDir: string | undefined,
  label: string,
  rawText: string,
  opts: CompactOutputOptions = {},
): CompactOutputResult {
  return defaultCompactedChunkStore.compact(dataDir, label, rawText, opts);
}

export function queryCompactedChunk(
  chunkId: string,
  query: string,
  limit = 10,
): ChunkQueryResult {
  return defaultCompactedChunkStore.query(chunkId, query, limit);
}

const SNAPSHOT_EXPAND_DIRS = new Set(['src', 'app', 'apps', 'packages', 'lib', 'ui', 'test', 'tests', 'scripts', 'cmd', 'pkg', 'internal']);

export function buildWorkspaceSnapshot(workspaceRoot: string): WorkspaceSnapshot {
  const startedAt = Date.now();
  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  const workspaceName = path.basename(realRoot) || 'workspace';

  const techStack: string[] = [];
  const scripts: string[] = [];
  let packageName: string | undefined;
  let packageVersion: string | undefined;

  const hasFile = (name: string): boolean => {
    try {
      const candidate = path.join(realRoot, name);
      const real = fs.realpathSync(candidate);
      return real.startsWith(rootPrefix) && fs.statSync(real).isFile();
    } catch {
      return false;
    }
  };

  if (hasFile('package.json')) {
    techStack.push('Node.js');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(realRoot, 'package.json'), 'utf8')) as {
        name?: unknown;
        version?: unknown;
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      if (typeof pkg.name === 'string') packageName = pkg.name.slice(0, 64);
      if (typeof pkg.version === 'string') packageVersion = pkg.version.slice(0, 32);
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        scripts.push(...Object.keys(pkg.scripts).slice(0, 8));
      }
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if ('typescript' in allDeps) techStack.push('TypeScript');
      if ('react' in allDeps) techStack.push('React');
      if ('vite' in allDeps) techStack.push('Vite');
      if ('next' in allDeps) techStack.push('Next.js');
      if ('vue' in allDeps) techStack.push('Vue');
    } catch {
      // ignore invalid package.json
    }
  }
  if (hasFile('tsconfig.json') && !techStack.includes('TypeScript')) techStack.push('TypeScript');
  if (hasFile('pyproject.toml') || hasFile('requirements.txt')) techStack.push('Python');
  if (hasFile('go.mod')) techStack.push('Go');
  if (hasFile('Cargo.toml')) techStack.push('Rust');
  if (hasFile('Dockerfile') || hasFile('docker-compose.yml') || hasFile('compose.yaml')) {
    techStack.push('Docker');
  }
  if (hasFile('AGENTS.md')) techStack.push('AGENTS.md');
  if (hasFile('CLAUDE.md')) techStack.push('CLAUDE.md');

  const treeLines: string[] = [];
  const maxTreeLines = 28;
  let extraEntries = 0;

  try {
    const entries = fs
      .readdirSync(realRoot, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        try {
          const realEntry = fs.realpathSync(path.join(realRoot, entry.name));
          const realEntryRel = path.relative(realRoot, realEntry).replace(/\\/g, '/');
          if (!realEntry.startsWith(rootPrefix) || isSensitiveTurboPath(realEntryRel)) continue;
        } catch {
          continue;
        }
      }

      if (treeLines.length >= maxTreeLines) {
        extraEntries += 1;
        continue;
      }

      if (entry.isDirectory()) {
        treeLines.push(`- ${entry.name}/`);
        if (SNAPSHOT_EXPAND_DIRS.has(entry.name) && treeLines.length < maxTreeLines) {
          try {
            const subEntries = fs
              .readdirSync(path.join(realRoot, entry.name), { withFileTypes: true })
              .filter((sub) => {
                if (SKIP_DIRS.has(sub.name) || isSensitiveTurboPath(`${entry.name}/${sub.name}`)) {
                  return false;
                }
                if (sub.isSymbolicLink()) {
                  try {
                    const realSub = fs.realpathSync(path.join(realRoot, entry.name, sub.name));
                    const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
                    return realSub.startsWith(rootPrefix) && !isSensitiveTurboPath(realSubRel);
                  } catch {
                    return false;
                  }
                }
                return true;
              })
              .sort((a, b) => a.name.localeCompare(b.name));
            const shown = subEntries.slice(0, 5);
            for (const sub of shown) {
              if (treeLines.length >= maxTreeLines) break;
              treeLines.push(`  - ${sub.name}${sub.isDirectory() ? '/' : ''}`);
            }
            if (subEntries.length > shown.length && treeLines.length < maxTreeLines) {
              treeLines.push(`  - ... (+${subEntries.length - shown.length} more)`);
            }
          } catch {
            // ignore unreadable subdir
          }
        }
      } else {
        treeLines.push(`- ${entry.name}`);
      }
    }
  } catch {
    // ignore unreadable root
  }

  if (extraEntries > 0) {
    treeLines.push(`- ... (+${extraEntries} more entries)`);
  }

  const lines: string[] = [
    `Workspace: ${packageName ? `${packageName}${packageVersion ? `@${packageVersion}` : ''}` : workspaceName}`,
    `Stack: ${techStack.length > 0 ? techStack.join(', ') : 'Generic'}`,
  ];
  if (scripts.length > 0) {
    lines.push(`Scripts: ${scripts.join(', ')}`);
  }
  lines.push('Structure:');
  lines.push(...treeLines);

  // Enforce strict <= 40 lines budget
  const finalLines = lines.slice(0, 40);
  if (lines.length > 40) {
    finalLines[39] = '... (truncated to 40-line budget)';
  }

  return {
    workspaceName,
    packageName,
    packageVersion,
    techStack,
    scripts,
    treeLines,
    lineCount: finalLines.length,
    markdown: finalLines.join('\n'),
    elapsedMs: Date.now() - startedAt,
  };
}
