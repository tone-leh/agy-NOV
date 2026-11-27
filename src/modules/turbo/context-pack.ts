import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stripPrivateBlocksWithStats } from '../../core/sanitize.js';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/utils.js';
import { isSensitiveTurboPath, resolveInsideWorkspaceReal } from './search.js';

export const CONTEXT_PACK_DEFAULT_MAX_TOKENS = 8_000;
export const CONTEXT_PACK_MIN_TOKENS = 256;
export const CONTEXT_PACK_MAX_TOKENS = 32_000;
export const CONTEXT_PACK_DEFAULT_MAX_FILES = 80;
export const CONTEXT_PACK_MAX_FILES = 300;
export const CONTEXT_PACK_MAX_FILE_BYTES = 256 * 1024; // 256 KiB per file hard cap

const MAX_GLOB_COUNT = 16;
const MAX_GLOB_LEN = 160;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

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

export interface ContextPackOptions {
  scope?: string;
  globs?: string[];
  fromGitDiff?: boolean;
  maxTokens?: number;
  maxFiles?: number;
}

export interface ContextPackFileEntry {
  path: string;
  bytes: number;
  estimatedTokens: number;
  truncated: boolean;
  redactions: number;
}

export interface ContextPackResult {
  mode: 'scope' | 'git_diff';
  scope: string;
  globs: string[];
  maxTokens: number;
  estimatedTokens: number;
  totalChars: number;
  totalFiles: number;
  includedFiles: number;
  skippedSensitive: number;
  skippedBinary: number;
  skippedSymlinks: number;
  skippedOversized: number;
  redactionCount: number;
  truncated: boolean;
  tree: string;
  files: ContextPackFileEntry[];
  markdown: string;
  elapsedMs: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Strict O(n) multiline credential & <private> redactor (preserves code layout)
// ---------------------------------------------------------------------------

function stripPemPrivateKeysLinear(input: string): { text: string; count: number } {
  const beginMarker = '-----BEGIN ';
  if (!input.includes(beginMarker)) return { text: input, count: 0 };

  const chunks: string[] = [];
  let cur = 0;
  let count = 0;
  while (cur < input.length) {
    const start = input.indexOf(beginMarker, cur);
    if (start === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const headerEnd = input.indexOf('-----', start + beginMarker.length);
    if (headerEnd === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const label = input.slice(start + beginMarker.length, headerEnd);
    if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(label)) {
      chunks.push(input.slice(cur, headerEnd + 5));
      cur = headerEnd + 5;
      continue;
    }

    if (start > cur) chunks.push(input.slice(cur, start));
    chunks.push('[REDACTED_PRIVATE_KEY]');
    count += 1;

    const endPrefix = '-----END ';
    const searchFrom = headerEnd + 5;
    let endIdx = input.indexOf(endPrefix, searchFrom);
    let closedAt = -1;
    while (endIdx !== -1) {
      const footerEnd = input.indexOf('-----', endIdx + endPrefix.length);
      if (footerEnd === -1) break;
      const endLabel = input.slice(endIdx + endPrefix.length, footerEnd);
      if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(endLabel)) {
        closedAt = footerEnd + 5;
        break;
      }
      endIdx = input.indexOf(endPrefix, footerEnd + 5);
    }

    // Truncated PEM/PGP private key: redact through end of input
    cur = closedAt === -1 ? input.length : closedAt;
  }
  return { text: chunks.join(''), count };
}

const CODE_REDACT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // IM webhooks
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  // Embedded URL credentials & sensitive query parameters
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, '$1[REDACTED]$3'],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig|pin|code)=)([^&#\s"'<>]+)/gi, '$1[REDACTED]'],
  // Authorization headers, Bearer/Basic tokens, JWTs
  [
    /\b(Authorization[ \t]*:[ \t]*(?:Bearer|Basic|Token|ApiKey|Digest|HMAC)[ \t]+)([^\s"',;}{]+)/gi,
    '$1[REDACTED]',
  ],
  [/\bBearer[ \t]+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic[ \t]+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  // Bot tokens & provider API keys
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]'],
  [
    /\b(?:sk-proj-|sk-ant-|sk_(?:live|test)_|sk-|AIza|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|npm_|hf_|pypi-)[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_KEY]',
  ],
  // Uppercase env-style secret assignments
  [
    /\b([A-Z][A-Z0-9_]{1,40}_(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|WEBHOOK|PIN|AUTH|CREDENTIAL|CREDENTIALS)[ \t]*=[ \t]*["']?)([^\s"',;}{]+)(["']?)/g,
    '$1[REDACTED]$3',
  ],
  // Generic key-value secret/token assignments (quoted)
  [
    /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bot[_-]?token|signing[_-]?secret|client[_-]?secret|private[_-]?key|webhook[_-]?url|password|passwd)["']?[ \t]*[:=][ \t]*["'])([^"'\r\n]{4,})(["'])/gi,
    '$1[REDACTED]$3',
  ],
  // YAML/INI unquoted lowercase sensitive assignments (skipping common TS type names & env placeholders)
  [
    /^([ \t]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bot[_-]?token|signing[_-]?secret|client[_-]?secret|private[_-]?key|webhook[_-]?url|password|passwd)[ \t]*[:=][ \t]*)(?!string\b|number\b|boolean\b|null\b|undefined\b|true\b|false\b|unknown\b|any\b|\$\{?|\{\{|\[REDACTED\])([^\s"'#,;}{]{6,})/gim,
    '$1[REDACTED]',
  ],
];

function redactGenericWebhookUrlsLinear(input: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    if (match.toLowerCase().includes('webhook')) {
      count += 1;
      return '[REDACTED_WEBHOOK]';
    }
    return match;
  });
  return { text, count };
}

export function redactCodeTextLinear(input: string): { text: string; redactions: number } {
  if (typeof input !== 'string' || !input) return { text: '', redactions: 0 };
  let total = 0;

  const priv = stripPrivateBlocksWithStats(input, '[REDACTED_PRIVATE]');
  let out = priv.text;
  total += priv.strippedCount;

  const pem = stripPemPrivateKeysLinear(out);
  out = pem.text;
  total += pem.count;

  const wh = redactGenericWebhookUrlsLinear(out);
  out = wh.text;
  total += wh.count;

  for (const [pattern, replacement] of CODE_REDACT_PATTERNS) {
    out = out.replace(pattern, (...args: unknown[]) => {
      const fullMatch = String(args[0] ?? '');
      // Preserve more specific placeholder tags from earlier passes (e.g. [REDACTED_KEY]) without double-counting
      if (
        replacement.includes('$') &&
        typeof args[2] === 'string' &&
        /^\[REDACTED(?:_[A-Z_]+)?\]$/.test(args[2])
      ) {
        return fullMatch;
      }
      // Rebuild replacement with captured groups if present
      let replaced = replacement;
      if (replacement.includes('$')) {
        replaced = replacement.replace(/\$(\d)/g, (_, idxStr: string) => {
          const groupIdx = Number.parseInt(idxStr, 10);
          return typeof args[groupIdx] === 'string' ? (args[groupIdx] as string) : '';
        });
      }
      if (replaced !== fullMatch) {
        total += 1;
      }
      return replaced;
    });
  }

  return { text: out, redactions: total };
}

// ---------------------------------------------------------------------------
// Linear-time safe glob matcher (ReDoS-proof: two-pointer + segment DP)
// ---------------------------------------------------------------------------

function normalizeGlobPattern(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!trimmed || trimmed.length > MAX_GLOB_LEN || CONTROL_CHAR_RE.test(trimmed)) {
    return null;
  }
  if (trimmed.includes('..')) {
    throw new Error(`Invalid glob pattern rejected by security policy: ${raw}`);
  }
  return trimmed;
}

function matchSingleSegmentLinear(text: string, pat: string): boolean {
  let ti = 0;
  let pi = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (ti < text.length) {
    if (pi < pat.length && (pat[pi] === '?' || pat[pi] === text[ti])) {
      ti += 1;
      pi += 1;
    } else if (pi < pat.length && pat[pi] === '*') {
      starIdx = pi;
      matchIdx = ti;
      pi += 1;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx += 1;
      ti = matchIdx;
    } else {
      return false;
    }
  }
  while (pi < pat.length && pat[pi] === '*') {
    pi += 1;
  }
  return pi === pat.length;
}

export function matchSimpleGlob(relPath: string, pattern: string): boolean {
  const normPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normPat = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normPat) return true;

  // Bare filename glob (no '/') matches basename or full path
  if (!normPat.includes('/')) {
    const base = path.posix.basename(normPath);
    return matchSingleSegmentLinear(base, normPat) || matchSingleSegmentLinear(normPath, normPat);
  }

  const pathSegs = normPath.split('/').filter(Boolean);
  const patSegs = normPat.split('/').filter(Boolean);
  const m = patSegs.length;
  const n = pathSegs.length;

  let prev = new Array<boolean>(n + 1).fill(false);
  prev[0] = true;

  for (let i = 1; i <= m; i += 1) {
    const curr = new Array<boolean>(n + 1).fill(false);
    const pSeg = patSegs[i - 1];
    if (pSeg === '**') {
      curr[0] = prev[0];
      for (let j = 1; j <= n; j += 1) {
        curr[j] = prev[j] || curr[j - 1];
      }
    } else {
      for (let j = 1; j <= n; j += 1) {
        if (prev[j - 1] && matchSingleSegmentLinear(pathSegs[j - 1], pSeg)) {
          curr[j] = true;
        }
      }
    }
    prev = curr;
  }

  return prev[n];
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

function detectCodeFenceLang(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.mts': 'ts',
    '.cts': 'ts',
    '.js': 'js',
    '.jsx': 'jsx',
    '.mjs': 'js',
    '.cjs': 'js',
    '.py': 'python',
    '.pyi': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.sh': 'bash',
    '.sql': 'sql',
  };
  return map[ext] ?? '';
}

function safeCodeFenceFor(content: string): string {
  if (!content.includes('```')) return '```';
  if (!content.includes('````')) return '````';
  return '`````';
}

function sliceUtf16Safe(input: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (input.length <= maxChars) return input;
  let end = maxChars;
  const code = input.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end = Math.max(0, end - 1);
  }
  return input.slice(0, end);
}

function buildDirectoryTree(relPaths: string[], maxLines = 120): string {
  if (relPaths.length === 0) return '(empty)';
  interface TreeNode {
    children: Map<string, TreeNode>;
    isFile: boolean;
  }
  const root: TreeNode = { children: new Map(), isFile: false };
  for (const rel of relPaths) {
    const parts = rel.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      let next = cur.children.get(part);
      if (!next) {
        next = { children: new Map(), isFile: i === parts.length - 1 };
        cur.children.set(part, next);
      }
      cur = next;
    }
  }

  const lines: string[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    const entries = Array.from(node.children.entries()).sort(([aName, aNode], [bName, bNode]) => {
      if (aNode.isFile !== bNode.isFile) return aNode.isFile ? 1 : -1;
      return aName.localeCompare(bName);
    });
    for (const [name, child] of entries) {
      if (lines.length >= maxLines) {
        lines.push(`${'  '.repeat(depth)}... (tree truncated)`);
        return;
      }
      lines.push(`${'  '.repeat(depth)}- ${name}${child.isFile ? '' : '/'}`);
      if (!child.isFile) {
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function collectGitDiffFiles(realRoot: string): { files: string[]; note?: string } {
  const results = new Set<string>();
  let gitAvailable = false;

  const runGit = (args: string[]): string[] => {
    const out = execFileSync('git', args, {
      cwd: realRoot,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    gitAvailable = true;
    return out
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  };

  try {
    for (const f of runGit(['diff', '--name-only'])) {
      results.add(f);
    }
    try {
      for (const f of runGit(['diff', '--cached', '--name-only'])) {
        results.add(f);
      }
    } catch {
      // ignore if HEAD has no commits yet
    }
  } catch (err) {
    if (!gitAvailable) {
      return {
        files: [],
        note: `Git diff unavailable in workspace: ${err instanceof Error ? err.message.split(/\r?\n/)[0] : String(err)}`,
      };
    }
  }

  return { files: Array.from(results).sort((a, b) => a.localeCompare(b)) };
}

/**
 * Builds a token-budgeted, credential-redacted Markdown context pack from either
 * a workspace scope/glob selection or the current `git diff --name-only` working set.
 */
export function buildContextPack(
  workspaceRoot: string,
  options: ContextPackOptions = {},
): ContextPackResult {
  const startedAt = Date.now();
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));

  const maxTokens = Math.max(
    CONTEXT_PACK_MIN_TOKENS,
    Math.min(
      Math.floor(
        Number.isFinite(options.maxTokens)
          ? (options.maxTokens as number)
          : CONTEXT_PACK_DEFAULT_MAX_TOKENS,
      ),
      CONTEXT_PACK_MAX_TOKENS,
    ),
  );
  const maxFiles = Math.max(
    1,
    Math.min(
      Math.floor(
        Number.isFinite(options.maxFiles)
          ? (options.maxFiles as number)
          : CONTEXT_PACK_DEFAULT_MAX_FILES,
      ),
      CONTEXT_PACK_MAX_FILES,
    ),
  );
  const maxChars = maxTokens * 4;

  const globs: string[] = [];
  if (Array.isArray(options.globs)) {
    for (const raw of options.globs.slice(0, MAX_GLOB_COUNT)) {
      if (typeof raw !== 'string') continue;
      const norm = normalizeGlobPattern(raw);
      if (norm) globs.push(norm);
    }
  }

  let searchRoot = realRoot;
  let scope = '.';
  if (options.scope && options.scope.trim()) {
    const scopeInput = options.scope.trim();
    const resolved = resolveInsideWorkspaceReal(realRoot, scopeInput);
    if (
      (!path.isAbsolute(scopeInput) && isSensitiveTurboPath(scopeInput)) ||
      isSensitiveTurboPath(resolved.relPath)
    ) {
      throw new Error(`Refused to pack sensitive scope: ${scopeInput}`);
    }
    searchRoot = resolved.realTarget;
    scope = resolved.relPath;
  }

  const isInsideRealRoot = (candidate: string): boolean =>
    isPathInsideDir(realRoot, candidate);

  const matchesGlobs = (relPath: string): boolean => {
    if (globs.length === 0) return true;
    return globs.some((g) => matchSimpleGlob(relPath, g));
  };

  let skippedSensitive = 0;
  let skippedBinary = 0;
  let skippedSymlinks = 0;
  let skippedOversized = 0;
  let truncated = false;
  let note: string | undefined;

  const mode: 'scope' | 'git_diff' = options.fromGitDiff ? 'git_diff' : 'scope';

  interface CandidateFile {
    relPath: string;
    realPath: string;
    size: number;
  }
  const candidates: CandidateFile[] = [];

  const inspectCandidateFile = (absPath: string, rawRel: string): void => {
    if (isSensitiveTurboPath(rawRel)) {
      skippedSensitive += 1;
      return;
    }

    let lst: fs.Stats;
    try {
      lst = fs.lstatSync(absPath);
    } catch {
      return;
    }

    if (lst.isSymbolicLink()) {
      skippedSymlinks += 1;
      return;
    }
    if (!lst.isFile()) return;

    let realFile: string;
    try {
      realFile = canonicalRealpathSync(absPath);
    } catch {
      skippedSymlinks += 1;
      return;
    }
    if (!isInsideRealRoot(realFile)) {
      skippedSymlinks += 1;
      return;
    }

    const realRel = path.relative(realRoot, realFile).replace(/\\/g, '/');
    if (isSensitiveTurboPath(realRel)) {
      skippedSensitive += 1;
      return;
    }
    if (!matchesGlobs(realRel)) return;

    if (isBinaryFilename(realRel)) {
      skippedBinary += 1;
      return;
    }
    if (lst.size > CONTEXT_PACK_MAX_FILE_BYTES) {
      skippedOversized += 1;
      return;
    }

    candidates.push({ relPath: realRel, realPath: realFile, size: lst.size });
  };

  if (mode === 'git_diff') {
    const gitRes = collectGitDiffFiles(realRoot);
    note = gitRes.note;
    const scopePrefix = scope === '.' ? '' : `${scope.replace(/\/+$/, '')}/`;
    for (const rel of gitRes.files) {
      if (scope !== '.' && rel !== scope && !rel.startsWith(scopePrefix)) {
        continue;
      }
      const abs = path.resolve(realRoot, rel);
      if (!isInsideRealRoot(abs)) {
        skippedSymlinks += 1;
        continue;
      }
      inspectCandidateFile(abs, rel);
    }
  } else {
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(searchRoot);
    } catch {
      rootStat = null as unknown as fs.Stats;
    }

    if (rootStat?.isFile()) {
      const rel = path.relative(realRoot, searchRoot).replace(/\\/g, '/');
      inspectCandidateFile(searchRoot, rel);
    } else if (rootStat?.isDirectory()) {
      const visitedDirs = new Set<string>();
      const stack: string[] = [searchRoot];

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

        const subDirs: string[] = [];
        for (const entry of entries) {
          if (entry.isSymbolicLink()) {
            skippedSymlinks += 1;
            continue;
          }
          const fullPath = path.join(currentDir, entry.name);
          const rawRel = path.relative(realRoot, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            if (isSensitiveTurboPath(rawRel)) {
              skippedSensitive += 1;
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
              subDirs.push(realSub);
            } catch {
              skippedSymlinks += 1;
            }
            continue;
          }

          if (entry.isFile()) {
            inspectCandidateFile(fullPath, rawRel);
          }
        }

        for (let i = subDirs.length - 1; i >= 0; i -= 1) {
          stack.push(subDirs[i]);
        }
      }
    }
  }

  candidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const totalCandidateFiles = candidates.length;
  const boundedCandidates = candidates.slice(0, maxFiles);
  if (totalCandidateFiles > maxFiles) {
    truncated = true;
  }

  // Read, verify non-binary, and redact candidates
  interface PreparedFile {
    relPath: string;
    bytes: number;
    redactedText: string;
    redactions: number;
  }
  const prepared: PreparedFile[] = [];
  for (const cand of boundedCandidates) {
    try {
      const buf = fs.readFileSync(cand.realPath);
      if (isBufferBinary(buf)) {
        skippedBinary += 1;
        continue;
      }
      const rawText = buf.toString('utf8');
      const { text: redactedText, redactions } = redactCodeTextLinear(rawText);
      prepared.push({
        relPath: cand.relPath,
        bytes: buf.length,
        redactedText,
        redactions,
      });
    } catch {
      // skip unreadable file
    }
  }

  // Build tree from candidate non-binary files
  const fullTree = buildDirectoryTree(prepared.map((f) => f.relPath));
  const treeBudget = Math.max(120, Math.floor(maxChars * 0.25));
  let treeText = fullTree;
  if (treeText.length > treeBudget) {
    treeText = `${sliceUtf16Safe(treeText, Math.max(60, treeBudget - 24))}\n... (tree truncated)`;
    truncated = true;
  }

  const headerLines = [
    `# Turbo Context Pack (${mode === 'git_diff' ? 'git-diff' : `scope: ${scope}`})`,
    globs.length > 0 ? `Globs: ${globs.join(', ')}` : null,
    `Budget: <= ${maxTokens.toLocaleString()} tokens | Redacted secrets enabled`,
    '',
    '## Directory Tree',
    treeText,
    '',
    '## Files',
  ].filter((l): l is string => l !== null);

  const headerBase = `${headerLines.join('\n')}\n`;
  let usedChars = headerBase.length;
  const fileSections: string[] = [];
  const includedEntries: ContextPackFileEntry[] = [];
  let totalRedactions = 0;

  const truncationBanner = '\n\n> [Context Pack truncated to stay within maxTokens budget]\n';
  const reserveForFooter = truncationBanner.length + 16;

  for (const pf of prepared) {
    const lang = detectCodeFenceLang(pf.relPath);
    const fence = safeCodeFenceFor(pf.redactedText);
    const sectionPrefix = `\n### ${pf.relPath}\n${fence}${lang}\n`;
    const sectionSuffix = `\n${fence}\n`;
    const fullSection = `${sectionPrefix}${pf.redactedText}${sectionSuffix}`;

    if (usedChars + fullSection.length <= maxChars - reserveForFooter) {
      fileSections.push(fullSection);
      usedChars += fullSection.length;
      totalRedactions += pf.redactions;
      includedEntries.push({
        path: pf.relPath,
        bytes: pf.bytes,
        estimatedTokens: Math.ceil(fullSection.length / 4),
        truncated: false,
        redactions: pf.redactions,
      });
      continue;
    }

    // Attempt partial inclusion if enough room remains for meaningful content
    const truncMarker = '\n... [file truncated to token budget]';
    const overhead = sectionPrefix.length + truncMarker.length + sectionSuffix.length;
    const remainingForBody = maxChars - reserveForFooter - usedChars - overhead;
    if (remainingForBody >= 120) {
      const partialBody = sliceUtf16Safe(pf.redactedText, remainingForBody);
      const partialSection = `${sectionPrefix}${partialBody}${truncMarker}${sectionSuffix}`;
      fileSections.push(partialSection);
      usedChars += partialSection.length;
      totalRedactions += pf.redactions;
      includedEntries.push({
        path: pf.relPath,
        bytes: pf.bytes,
        estimatedTokens: Math.ceil(partialSection.length / 4),
        truncated: true,
        redactions: pf.redactions,
      });
    }

    truncated = true;
    break;
  }

  let markdown = `${headerBase}${fileSections.join('')}${truncated ? truncationBanner : ''}`;
  if (markdown.length > maxChars) {
    markdown = sliceUtf16Safe(markdown, maxChars);
    truncated = true;
  }

  const totalChars = markdown.length;
  const estimatedTokens = Math.ceil(totalChars / 4);

  return {
    mode,
    scope,
    globs,
    maxTokens,
    estimatedTokens,
    totalChars,
    totalFiles: prepared.length,
    includedFiles: includedEntries.length,
    skippedSensitive,
    skippedBinary,
    skippedSymlinks,
    skippedOversized,
    redactionCount: totalRedactions,
    truncated,
    tree: treeText,
    files: includedEntries,
    markdown,
    elapsedMs: Date.now() - startedAt,
    note,
  };
}
