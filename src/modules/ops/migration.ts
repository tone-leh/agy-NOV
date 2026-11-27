import crypto from 'node:crypto';
import { listFilesStrictNoSymlink, readFileStrictNoSymlink } from './paths.js';
import {
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  type OpsMigrationAction,
  type OpsMigrationClient,
  type OpsMigrationEntry,
  type OpsMigrationPreview,
} from './types.js';

export function summarizeMigrationPreview(entries: readonly OpsMigrationEntry[]): OpsMigrationPreview {
  let totalBytes = 0;
  let reclaimableBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.bytes;
    if (entry.action !== 'keep-pointer' && entry.duplicatePercent > 0) {
      const entryReclaim = Math.min(
        entry.bytes,
        Math.round((entry.bytes * entry.duplicatePercent) / 100),
      );
      reclaimableBytes += entryReclaim;
    }
  }
  const estimatedSavingsPercent =
    totalBytes > 0 ? Math.min(100, Math.round((reclaimableBytes / totalBytes) * 100)) : 0;
  return {
    readOnlyPreview: true,
    totalFiles: entries.length,
    totalBytes,
    reclaimableBytes,
    estimatedSavingsPercent,
    estimatedSavedTokens: Math.ceil(reclaimableBytes / 4),
    entries: [...entries],
  };
}

function stripYamlFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length >= 3 && lines[0].trim() === '---') {
    for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
      if (lines[i].trim() === '---') {
        return lines.slice(i + 1).join('\n');
      }
    }
  }
  return text;
}

function normalizeDedupLine(rawLine: string): string {
  let s = rawLine.trim();
  if (!s) return '';
  if (/^[-*_=`~]{3,}$/.test(s)) return '';
  // Strip leading Markdown list / heading / blockquote prefixes
  s = s.replace(/^(?:[>#*+-]+\s+|\d+[.)]\s+)/, '');
  // Strip inline emphasis & code ticks for resilient cross-client matching
  s = s.replace(/[`*_]+/g, '');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  const alphaNumCount = (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alphaNumCount < 4) return '';
  return s;
}

function hashDedupUnit(unit: string): string {
  return crypto.createHash('sha256').update(unit).digest('hex').slice(0, 16);
}

interface NormalizedDocUnits {
  meaningfulLineHashes: string[];
  lineToParaHash: string[];
  paragraphHashes: string[];
  rawLineCount: number;
}

function extractNormalizedDocUnits(text: string): NormalizedDocUnits {
  const body = stripYamlFrontmatter(text);
  const rawLines = body.length === 0 ? [] : body.split(/\r?\n/);
  const meaningfulLineHashes: string[] = [];
  const lineToParaHash: string[] = [];
  const paragraphHashes: string[] = [];

  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const paraHash = paraBuf.length >= 2 ? hashDedupUnit(paraBuf.join('\n')) : '';
    if (paraHash) paragraphHashes.push(paraHash);
    for (const normLine of paraBuf) {
      meaningfulLineHashes.push(hashDedupUnit(normLine));
      lineToParaHash.push(paraHash);
    }
    paraBuf = [];
  };

  for (const raw of rawLines) {
    if (!raw.trim()) {
      flushPara();
      continue;
    }
    const norm = normalizeDedupLine(raw);
    if (!norm) continue;
    paraBuf.push(norm);
  }
  flushPara();

  return {
    meaningfulLineHashes,
    lineToParaHash,
    paragraphHashes,
    rawLineCount: text.length === 0 ? 0 : text.split(/\r?\n/).length,
  };
}

function isThinRulePointer(text: string): boolean {
  const nonEmpty = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (nonEmpty.length === 0 || nonEmpty.length > 3) return false;
  const joined = nonEmpty.join(' ');
  if (joined.length > 220) return false;
  return /(?:^|\s)@(?:AGENTS|GEMINI)\.md\b|\b(?:see|follow|import|source of truth:?)\s+[`"]?(?:AGENTS|GEMINI)\.md[`"]?/i.test(
    joined,
  );
}

export function buildCrossClientMigrationPreviewReadOnly(
  realRoot: string,
): OpsMigrationPreview {
  const seenLineHashes = new Set<string>();
  const seenParaHashes = new Set<string>();

  const hasAgentsMd = readFileStrictNoSymlink(
    realRoot,
    'AGENTS.md',
    MAX_SECURITY_SCAN_FILE_BYTES,
  );
  const hasGeminiMd = readFileStrictNoSymlink(
    realRoot,
    'GEMINI.md',
    MAX_SECURITY_SCAN_FILE_BYTES,
  );
  const defaultRuleTarget = !hasAgentsMd.ok && hasGeminiMd.ok ? 'GEMINI.md' : 'AGENTS.md';

  const indexCanonicalText = (text: string): void => {
    const units = extractNormalizedDocUnits(text);
    for (const lh of units.meaningfulLineHashes) seenLineHashes.add(lh);
    for (const ph of units.paragraphHashes) seenParaHashes.add(ph);
  };

  if (hasAgentsMd.ok) indexCanonicalText(hasAgentsMd.text);
  if (hasGeminiMd.ok) indexCanonicalText(hasGeminiMd.text);

  const canonicalAgentRules = listFilesStrictNoSymlink(
    realRoot,
    '.agents/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  );
  for (const rel of canonicalAgentRules) {
    const read = readFileStrictNoSymlink(realRoot, rel, MAX_SECURITY_SCAN_FILE_BYTES);
    if (read.ok) indexCanonicalText(read.text);
  }

  // Collect cross-client candidates (.claude/, CLAUDE.md, .cursor/rules/*, .codex/)
  const sources: Array<{ client: OpsMigrationClient; relPath: string; isConfig: boolean }> = [];
  const seenSourcePaths = new Set<string>();
  const addSource = (client: OpsMigrationClient, relPath: string, isConfig: boolean): void => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || seenSourcePaths.has(norm) || sources.length >= MAX_SECURITY_SCAN_FILES) return;
    seenSourcePaths.add(norm);
    sources.push({ client, relPath: norm, isConfig });
  };

  // Claude sources
  addSource('claude', 'CLAUDE.md', false);
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.claude/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addSource('claude', rel, false);
  }
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.claude/commands',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addSource('claude', rel, false);
  }
  addSource('claude', '.claude/settings.json', true);
  addSource('claude', '.claude/settings.local.json', true);

  // Cursor sources
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.cursor/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:mdc|md|mdx|txt)$/i.test(name),
  )) {
    addSource('cursor', rel, false);
  }

  // Codex sources
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.codex',
    4,
    MAX_SECURITY_SCAN_FILES,
    (r, name) => {
      const lower = r.toLowerCase();
      return (
        lower === '.codex/config.toml' ||
        /^\.codex\/rules\/.+\.toml$/i.test(lower) ||
        /\.(?:md|mdx|txt)$/i.test(name)
      );
    },
  )) {
    const isCfg = /\.toml$/i.test(rel);
    addSource('codex', rel, isCfg);
  }

  const entries: OpsMigrationEntry[] = [];
  for (const src of sources) {
    const read = readFileStrictNoSymlink(
      realRoot,
      src.relPath,
      MAX_SECURITY_SCAN_FILE_BYTES,
    );
    if (!read.ok) continue;

    const estimatedTokens = Math.ceil(read.text.length / 4);
    const rawLineCount = read.text.length === 0 ? 0 : read.text.split(/\r?\n/).length;

    if (src.isConfig) {
      entries.push({
        client: src.client,
        sourcePath: read.relPath,
        bytes: read.bytes,
        estimatedTokens,
        duplicatePercent: 0,
        duplicateLines: 0,
        totalLines: rawLineCount,
        recommendedTarget: '.agy-nov.json',
        action: 'keep-pointer',
      });
      continue;
    }

    const recommendedTarget = src.relPath.toLowerCase().startsWith('.claude/commands/')
      ? '.agents/skills/'
      : defaultRuleTarget;

    if (isThinRulePointer(read.text)) {
      entries.push({
        client: src.client,
        sourcePath: read.relPath,
        bytes: read.bytes,
        estimatedTokens,
        duplicatePercent: 0,
        duplicateLines: 0,
        totalLines: rawLineCount,
        recommendedTarget,
        action: 'keep-pointer',
      });
      continue;
    }

    const units = extractNormalizedDocUnits(read.text);
    const totalLines = units.meaningfulLineHashes.length > 0 ? units.meaningfulLineHashes.length : rawLineCount;
    let duplicateLines = 0;
    for (let i = 0; i < units.meaningfulLineHashes.length; i += 1) {
      const lh = units.meaningfulLineHashes[i];
      const ph = units.lineToParaHash[i];
      if (seenLineHashes.has(lh) || (ph && seenParaHashes.has(ph))) {
        duplicateLines += 1;
      }
    }

    const duplicatePercent =
      units.meaningfulLineHashes.length > 0
        ? Math.min(100, Math.round((duplicateLines / units.meaningfulLineHashes.length) * 100))
        : 0;

    // Add this source's normalized units to cumulative baseline so duplicate rules across clients are detected
    for (const lh of units.meaningfulLineHashes) seenLineHashes.add(lh);
    for (const ph of units.paragraphHashes) seenParaHashes.add(ph);

    const action: OpsMigrationAction =
      duplicatePercent >= 30 || (duplicateLines >= 2 && duplicatePercent >= 20)
        ? 'dedupe-merge'
        : 'migrate-unique';

    entries.push({
      client: src.client,
      sourcePath: read.relPath,
      bytes: read.bytes,
      estimatedTokens,
      duplicatePercent,
      duplicateLines,
      totalLines,
      recommendedTarget,
      action,
    });
  }

  return summarizeMigrationPreview(entries);
}
