import crypto from 'node:crypto';
import path from 'node:path';
import type { DiffFile, DiffHunk, DiffLine, FileStatus, RiskTag } from './types.js';
export { buildSplitRows, extractCodeSnippet } from './diff-helpers.js';

export interface ParseDiffOptions {
  repoPath?: string;
  maxLinesPerFile?: number;
  maxTotalLines?: number;
}

export interface ParseDiffResult {
  files: DiffFile[];
  truncated: boolean;
}

const DEFAULT_MAX_LINES_PER_FILE = 600;
const DEFAULT_MAX_TOTAL_LINES = 3500;
const LARGE_CHANGE_THRESHOLD = 250;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const SECURITY_PATH_PATTERNS = [
  /(?:^|\/|\.)(auth|oauth|jwt|token|secret|secrets|crypto|cipher|security|permission|permissions|rbac|acl|policy|policies|password|passwd|session|cookie|cors|csrf|sanitize|middleware)(?:\/|\.|-|_|$)/i,
  /(?:^|\/)\.env(?:\.|$)/i,
  /\.(pem|key|crt|p12|jks)$/i,
];

const CONFIG_PATH_PATTERNS = [
  /(?:^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|Dockerfile(?:\.[^/]+)?|docker-compose\.[^/]+|Makefile|hooks\.json|mcp_config\.json|plugin\.json)$/i,
  /(?:^|\/)\.github\/workflows\/.+\.ya?ml$/i,
  /\.(ya?ml|toml|ini|conf|cfg|jsonc?)$/i,
];

const TEST_PATH_PATTERNS = [
  /(?:^|\/)(test|tests|__tests__|spec|specs)\//i,
  /\.(test|spec)\.[^/]+$/i,
  /_test\.[^/]+$/i,
];

/**
 * Decode a Git C-quoted path (e.g. "\"dir/\344\270\255\346\226\207 file.ts\"") into a UTF-8 string.
 */
export function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      const buf = Buffer.from(ch, 'utf8');
      for (const b of buf) bytes.push(b);
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      break;
    }
    if (next >= '0' && next <= '7') {
      const oct = inner.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) {
        bytes.push(parseInt(oct, 8));
        i += 3;
        continue;
      }
    }
    i += 1;
    switch (next) {
      case 'n':
        bytes.push(0x0a);
        break;
      case 'r':
        bytes.push(0x0d);
        break;
      case 't':
        bytes.push(0x09);
        break;
      case '\\':
        bytes.push(0x5c);
        break;
      case '"':
        bytes.push(0x22);
        break;
      default: {
        const buf = Buffer.from(next, 'utf8');
        for (const b of buf) bytes.push(b);
        break;
      }
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripDiffPrefix(p: string): string {
  const unquoted = unquoteGitPath(p);
  if (unquoted === '/dev/null') return unquoted;
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) {
    return unquoted.slice(2);
  }
  return unquoted;
}

/**
 * Parse the `diff --git a/... b/...` header, safely handling spaces and quoted paths.
 */
function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const prefix = 'diff --git ';
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length);

  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length) {
      if (rest[i] === '\\') {
        i += 2;
        continue;
      }
      if (rest[i] === '"') {
        i += 1;
        break;
      }
      i += 1;
    }
    const first = rest.slice(0, i);
    const second = rest.slice(i).trim();
    return {
      oldPath: stripDiffPrefix(first),
      newPath: stripDiffPrefix(second),
    };
  }

  const sepIdx = rest.lastIndexOf(' b/');
  if (sepIdx > 0) {
    const first = rest.slice(0, sepIdx);
    const second = rest.slice(sepIdx + 1);
    return {
      oldPath: stripDiffPrefix(first),
      newPath: stripDiffPrefix(second),
    };
  }

  const sp = rest.indexOf(' ');
  if (sp > 0) {
    return {
      oldPath: stripDiffPrefix(rest.slice(0, sp)),
      newPath: stripDiffPrefix(rest.slice(sp + 1)),
    };
  }
  return null;
}

export function classifyRiskTags(
  filePath: string,
  additions: number,
  deletions: number,
  isTruncated = false,
): RiskTag[] {
  const tags: RiskTag[] = [];
  const normalized = filePath.replace(/\\/g, '/');
  const isTest = TEST_PATH_PATTERNS.some((re) => re.test(normalized));

  if (!isTest && SECURITY_PATH_PATTERNS.some((re) => re.test(normalized))) {
    tags.push('security-sensitive');
  }
  if (isTest) {
    tags.push('test');
  } else if (CONFIG_PATH_PATTERNS.some((re) => re.test(normalized))) {
    tags.push('config');
  }
  if (isTruncated || additions + deletions >= LARGE_CHANGE_THRESHOLD) {
    tags.push('large');
  }

  return tags;
}

export function computeFileFingerprint(filePath: string, status: FileStatus, hunks: DiffHunk[]): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${filePath}\0${status}\0`);
  for (const h of hunks) {
    hash.update(`${h.header}\n`);
    for (const l of h.lines) {
      hash.update(`${l.type}:${l.oldLine ?? ''}:${l.newLine ?? ''}:${l.content}\n`);
    }
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Parse a git unified diff text into structured DiffFile entries with exact old/new line numbers.
 */
export function parseUnifiedDiff(rawDiff: string, options: ParseDiffOptions = {}): ParseDiffResult {
  const maxLinesPerFile = options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE;
  const maxTotalLines = options.maxTotalLines ?? DEFAULT_MAX_TOTAL_LINES;

  if (!rawDiff || !rawDiff.trim()) {
    return { files: [], truncated: false };
  }

  const normalized = rawDiff.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  const files: DiffFile[] = [];
  let totalEmittedLines = 0;
  let globalTruncated = false;

  interface Builder {
    oldPath: string;
    newPath: string;
    status: FileStatus;
    isBinary: boolean;
    isTruncated: boolean;
    truncationReason?: string;
    additions: number;
    deletions: number;
    emittedLines: number;
    hunks: DiffHunk[];
    currentHunk: DiffHunk | null;
    oldCursor: number;
    newCursor: number;
  }

  let current: Builder | null = null;

  const finalizeCurrent = () => {
    if (!current) return;
    const effectivePath =
      current.status === 'deleted'
        ? current.oldPath || current.newPath
        : current.newPath || current.oldPath;

    const absolutePath =
      options.repoPath && effectivePath && effectivePath !== '/dev/null'
        ? path.resolve(options.repoPath, effectivePath)
        : undefined;

    const riskTags = classifyRiskTags(
      effectivePath,
      current.additions,
      current.deletions,
      current.isTruncated,
    );
    const fingerprint = computeFileFingerprint(effectivePath, current.status, current.hunks);

    const file: DiffFile = {
      path: effectivePath,
      oldPath:
        current.status === 'renamed' || current.status === 'copied'
          ? current.oldPath
          : undefined,
      absolutePath,
      status: current.status,
      additions: current.additions,
      deletions: current.deletions,
      isBinary: current.isBinary,
      isTruncated: current.isTruncated,
      truncationReason: current.truncationReason,
      riskTags,
      fingerprint,
      hunks: current.hunks,
    };

    files.push(file);
    current = null;
  };

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];

    if (line.startsWith('diff --git ')) {
      finalizeCurrent();
      const parsed = parseDiffGitHeader(line);
      current = {
        oldPath: parsed?.oldPath ?? '',
        newPath: parsed?.newPath ?? '',
        status: 'modified',
        isBinary: false,
        isTruncated: false,
        additions: 0,
        deletions: 0,
        emittedLines: 0,
        hunks: [],
        currentHunk: null,
        oldCursor: 0,
        newCursor: 0,
      };
      continue;
    }

    if (!current) continue;

    if (!current.currentHunk) {
      if (line.startsWith('new file mode ')) {
        current.status = 'added';
        continue;
      }
      if (line.startsWith('deleted file mode ')) {
        current.status = 'deleted';
        continue;
      }
      if (line.startsWith('rename from ')) {
        current.status = 'renamed';
        current.oldPath = unquoteGitPath(line.slice('rename from '.length));
        continue;
      }
      if (line.startsWith('rename to ')) {
        current.status = 'renamed';
        current.newPath = unquoteGitPath(line.slice('rename to '.length));
        continue;
      }
      if (line.startsWith('copy from ')) {
        current.status = 'copied';
        current.oldPath = unquoteGitPath(line.slice('copy from '.length));
        continue;
      }
      if (line.startsWith('copy to ')) {
        current.status = 'copied';
        current.newPath = unquoteGitPath(line.slice('copy to '.length));
        continue;
      }
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
        current.isBinary = true;
        continue;
      }
      if (line.startsWith('--- ')) {
        const p = stripDiffPrefix(line.slice(4));
        if (p === '/dev/null') {
          current.status = 'added';
        } else if (p) {
          current.oldPath = p;
        }
        continue;
      }
      if (line.startsWith('+++ ')) {
        const p = stripDiffPrefix(line.slice(4));
        if (p === '/dev/null') {
          current.status = 'deleted';
        } else if (p) {
          current.newPath = p;
        }
        continue;
      }
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldCount = hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1;
      const newStart = Number(hunkMatch[3]);
      const newCount = hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1;
      const sectionHeading = hunkMatch[5]?.trim() || undefined;

      const hunk: DiffHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        sectionHeading,
        lines: [],
      };
      current.currentHunk = hunk;
      current.oldCursor = oldStart;
      current.newCursor = newStart;
      if (!current.isTruncated) {
        current.hunks.push(hunk);
      }
      continue;
    }

    if (!current.currentHunk) continue;

    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    if (idx === rawLines.length - 1 && line === '') {
      continue;
    }

    const prefix = line[0];
    if (prefix === '+' || prefix === '-' || prefix === ' ') {
      const content = line.slice(1);
      let diffLine: DiffLine;

      if (prefix === '+') {
        current.additions += 1;
        diffLine = {
          type: 'add',
          content,
          oldLine: null,
          newLine: current.newCursor,
        };
        current.newCursor += 1;
      } else if (prefix === '-') {
        current.deletions += 1;
        diffLine = {
          type: 'del',
          content,
          oldLine: current.oldCursor,
          newLine: null,
        };
        current.oldCursor += 1;
      } else {
        diffLine = {
          type: 'context',
          content,
          oldLine: current.oldCursor,
          newLine: current.newCursor,
        };
        current.oldCursor += 1;
        current.newCursor += 1;
      }

      if (current.emittedLines < maxLinesPerFile && totalEmittedLines < maxTotalLines) {
        current.currentHunk.lines.push(diffLine);
        current.emittedLines += 1;
        totalEmittedLines += 1;
      } else if (!current.isTruncated) {
        current.isTruncated = true;
        globalTruncated = true;
        current.truncationReason =
          totalEmittedLines >= maxTotalLines
            ? `Diff truncated at global limit (${maxTotalLines} lines) to keep MCP payloads fast.`
            : `File diff truncated at ${maxLinesPerFile} lines for responsive inline review.`;
      }
    }
  }

  finalizeCurrent();

  return { files, truncated: globalTruncated };
}
