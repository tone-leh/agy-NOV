import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';

export const TURBO_MAX_QUERIES = 8;
export const TURBO_MAX_QUERY_LENGTH = 128;
export const TURBO_MAX_FILE_BYTES = 512 * 1024; // 512 KiB for batch search

export const TURBO_SKIP_DIRS = new Set([
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
  scannedBytes?: number;
  skippedFiles: number;
  skippedSensitive: number;
  skippedSymlinks: number;
  totalMatches: number;
  truncated: boolean;
  elapsedMs: number;
  results: BatchQueryResult[];
}

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

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(realRoot, targetPath);

  let realTarget: string;
  try {
    realTarget = canonicalRealpathSync(candidate);
  } catch {
    throw new Error(`Target path does not exist or cannot be resolved: ${targetPath}`);
  }

  if (!isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Path escapes workspace boundary: ${targetPath}`);
  }

  const relPath =
    isSamePath(realTarget, realRoot) ? '.' : path.relative(realRoot, realTarget).replace(/\\/g, '/');
  return { realRoot, realTarget, relPath };
}

export function isBinaryFilename(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isBufferBinary(buf: Buffer): boolean {
  const inspectLen = Math.min(buf.length, 8192);
  for (let i = 0; i < inspectLen; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
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

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));

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
  let scannedBytes = 0;
  let skippedFiles = 0;
  let skippedSensitive = 0;
  let skippedSymlinks = 0;
  let totalMatches = 0;
  let truncated = false;

  const visitedDirs = new Set<string>();
  const stack: string[] = [searchRoot];

  const isInsideRealRoot = (realCandidate: string): boolean =>
    isPathInsideDir(realRoot, realCandidate);

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
        if (TURBO_SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(rawRel)) {
          if (isSensitiveTurboPath(rawRel)) skippedSensitive += 1;
          continue;
        }
        try {
          const realSub = canonicalRealpathSync(fullPath);
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
          realFilePath = canonicalRealpathSync(fullPath);
          if (!isInsideRealRoot(realFilePath)) {
            skippedSymlinks += 1;
            continue;
          }
          const st = fs.statSync(realFilePath);
          if (st.isDirectory()) {
            const realRelDir = path.relative(realRoot, realFilePath).replace(/\\/g, '/');
            if (TURBO_SKIP_DIRS.has(path.basename(realFilePath)) || isSensitiveTurboPath(realRelDir)) {
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
        realFilePath = canonicalRealpathSync(realFilePath);
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
      scannedBytes += buf.length;
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
    scannedBytes,
    skippedFiles,
    skippedSensitive,
    skippedSymlinks,
    totalMatches,
    truncated,
    elapsedMs: Date.now() - startedAt,
    results: states,
  };
}
