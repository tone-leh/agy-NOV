import crypto from 'node:crypto';
import path from 'node:path';
import { atomicWriteJson } from '../../core/utils.js';

// ============================================================================
// RTK-Style Log / Diff / Build / Test Compaction & In-Memory LRU Chunk Store
// ============================================================================

export const TURBO_MAX_COMPACTED_CHUNKS = 24;
export const TURBO_DEFAULT_MAX_COMPACT_LINES = 180;
export const TURBO_MIN_COMPACT_LINES = 20;
export const TURBO_MAX_COMPACT_LINES = 300;
const TURBO_MAX_COMPACT_BYTES = 48 * 1024;

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

interface StoredChunkEntry {
  meta: CompactedChunkMeta;
  lines: string[];
  chunkLines: number;
  summaryText: string;
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
        atomicWriteJson(
          path.join(dataDir, 'stats.json'),
          {
            schemaVersion: 1,
            totalCompactions: this.totalCompactions,
            totalSavedTokens: this.totalSavedTokens,
            totalRawBytes: this.totalRawBytes,
            updatedAt: createdAt,
          },
          { ignoreTopLevelKeys: ['updatedAt'] },
        );
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
