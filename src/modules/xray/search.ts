import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { searchDemoSessions } from './demo-data.js';
import { discoverTranscriptEntries, type DiscoveryOptions } from './discovery.js';
import { redactSecrets } from './sanitize.js';
import type { SearchHit } from './types.js';

interface IndexedDocument {
  sessionId: string;
  sessionTitle: string;
  updatedAt: string;
  sourceKind: 'transcript' | 'artifact';
  sourceLabel: string;
  filePath: string;
  uri: string;
  text: string;
  tokens: string[];
}

function tokenize(text: string): string[] {
  // Supports both English/code identifiers and CJK bigrams for bilingual search
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_./-]{2,}/g) ?? [];
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const cjkTokens: string[] = [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      cjkTokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        cjkTokens.push(run.slice(i, i + 2));
      }
    }
  }
  return [...latin, ...cjkTokens];
}

function extractSnippet(text: string, query: string, maxLen = 220): string {
  const clean = redactSecrets(text.replace(/\s+/g, ' ').trim());
  const lower = clean.toLowerCase();
  const qLower = query.toLowerCase().trim();
  let idx = lower.indexOf(qLower);
  if (idx < 0) {
    for (const tok of tokenize(qLower)) {
      const pos = lower.indexOf(tok);
      if (pos >= 0) {
        idx = pos;
        break;
      }
    }
  }
  if (idx < 0) return clean.slice(0, maxLen);
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, start + maxLen);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

const MAX_SEARCH_TRANSCRIPT_SLICE_BYTES = 512 * 1024;
const MAX_SEARCH_ARTIFACT_BYTES = 64 * 1024;
const MAX_SEARCH_ARTIFACTS_PER_SESSION = 20;
const MAX_TOTAL_SEARCH_READ_BYTES = 32 * 1024 * 1024;

function readBoundedSearchSlice(
  filePath: string,
  maxBytes: number,
  includeTailIfOversized: boolean,
): { text: string; bytesRead: number } {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size <= 0) {
      return { text: '', bytesRead: 0 };
    }
    if (st.size <= maxBytes) {
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) {
        const n = fs.readSync(fd, buf, off, st.size - off, off);
        if (n <= 0) break;
        off += n;
      }
      return { text: buf.subarray(0, off).toString('utf8'), bytesRead: off };
    }

    const headBuf = Buffer.alloc(maxBytes);
    let headOff = 0;
    while (headOff < maxBytes) {
      const n = fs.readSync(fd, headBuf, headOff, maxBytes - headOff, headOff);
      if (n <= 0) break;
      headOff += n;
    }
    let headText = headBuf.subarray(0, headOff).toString('utf8');
    if (!includeTailIfOversized) {
      return { text: headText, bytesRead: headOff };
    }

    const lastHeadNl = headText.lastIndexOf('\n');
    if (lastHeadNl >= 0) headText = headText.slice(0, lastHeadNl);

    const tailLen = Math.min(maxBytes, Math.max(0, st.size - headOff));
    const tailStart = st.size - tailLen;
    const tailBuf = Buffer.alloc(tailLen);
    let tailOff = 0;
    while (tailOff < tailLen) {
      const n = fs.readSync(fd, tailBuf, tailOff, tailLen - tailOff, tailStart + tailOff);
      if (n <= 0) break;
      tailOff += n;
    }
    let tailText = tailBuf.subarray(0, tailOff).toString('utf8');
    const firstTailNl = tailText.indexOf('\n');
    if (firstTailNl >= 0) tailText = tailText.slice(firstTailNl + 1);

    return {
      text: `${headText}\n${tailText}`,
      bytesRead: headOff + tailOff,
    };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
}

function collectDocuments(opts: DiscoveryOptions & { maxSessions?: number }): IndexedDocument[] {
  const entries = discoverTranscriptEntries(opts).slice(0, opts.maxSessions ?? 80);
  const docs: IndexedDocument[] = [];
  let totalReadBytes = 0;

  for (const entry of entries) {
    if (totalReadBytes >= MAX_TOTAL_SEARCH_READ_BYTES) break;
    let sessionTitle = `Session ${entry.id.slice(0, 8)}`;
    const updatedAt = new Date(entry.mtimeMs).toISOString();
    const transcriptChunks: string[] = [];

    try {
      const slice = readBoundedSearchSlice(
        entry.transcriptPath,
        MAX_SEARCH_TRANSCRIPT_SLICE_BYTES,
        true,
      );
      totalReadBytes += slice.bytesRead;
      const lines = slice.text.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            type?: string;
            content?: string;
            thinking?: string;
            tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
          };
          if (obj.type === 'USER_INPUT' && obj.content) {
            const boundedContent = obj.content.slice(0, 8192);
            const match = boundedContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
            const body = (match ? match[1] : boundedContent).replace(/\s+/g, ' ').trim();
            if (body && sessionTitle.startsWith('Session ')) {
              sessionTitle = body.slice(0, 72) + (body.length > 72 ? '…' : '');
            }
            transcriptChunks.push(body);
          } else if (obj.type === 'PLANNER_RESPONSE') {
            if (obj.content) transcriptChunks.push(obj.content.slice(0, 1200));
            if (obj.tool_calls) {
              for (const tc of obj.tool_calls.slice(0, 20)) {
                if (tc.name) transcriptChunks.push(tc.name);
                if (tc.args && typeof tc.args === 'object') {
                  const argPreviewParts: string[] = [];
                  for (const [k, v] of Object.entries(tc.args).slice(0, 8)) {
                    if (typeof v === 'string') {
                      argPreviewParts.push(`${k}=${v.slice(0, 120)}`);
                    } else if (typeof v === 'number' || typeof v === 'boolean') {
                      argPreviewParts.push(`${k}=${String(v)}`);
                    }
                  }
                  if (argPreviewParts.length > 0) {
                    transcriptChunks.push(argPreviewParts.join(' ').slice(0, 400));
                  }
                }
              }
            }
          }
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore unreadable file
    }

    if (transcriptChunks.length > 0) {
      const text = transcriptChunks.join('\n').slice(0, 40_000);
      docs.push({
        sessionId: entry.id,
        sessionTitle,
        updatedAt,
        sourceKind: 'transcript',
        sourceLabel: 'Transcript',
        filePath: entry.transcriptPath,
        uri: pathToFileURL(entry.transcriptPath).href,
        text,
        tokens: tokenize(text),
      });
    }

    try {
      let artCount = 0;
      for (const dirent of fs.readdirSync(entry.brainDir, { withFileTypes: true })) {
        if (artCount >= MAX_SEARCH_ARTIFACTS_PER_SESSION) break;
        if (totalReadBytes >= MAX_TOTAL_SEARCH_READ_BYTES) break;
        if (!dirent.isFile() || !/\.md$/i.test(dirent.name) || dirent.name.startsWith('.')) continue;
        const artPath = path.join(entry.brainDir, dirent.name);
        try {
          const slice = readBoundedSearchSlice(artPath, MAX_SEARCH_ARTIFACT_BYTES, false);
          totalReadBytes += slice.bytesRead;
          const content = slice.text.slice(0, 40_000);
          artCount += 1;
          docs.push({
            sessionId: entry.id,
            sessionTitle,
            updatedAt: fs.statSync(artPath).mtime.toISOString(),
            sourceKind: 'artifact',
            sourceLabel: dirent.name,
            filePath: artPath,
            uri: pathToFileURL(artPath).href,
            text: `${dirent.name}\n${content}`,
            tokens: tokenize(`${dirent.name} ${content}`),
          });
        } catch {
          // ignore unreadable artifact
        }
      }
    } catch {
      // ignore artifact scan error
    }
  }

  return docs;
}

export function searchSessions(
  query: string,
  opts: DiscoveryOptions & { limit?: number; maxSessions?: number } = {},
): SearchHit[] {
  const limit = opts.limit ?? 20;
  if (opts.demoMode) {
    return searchDemoSessions(query).slice(0, limit);
  }

  const trimmed = query.trim();
  const docs = collectDocuments(opts);
  if (!trimmed) {
    return docs.slice(0, limit).map((d) => ({
      sessionId: d.sessionId,
      sessionTitle: d.sessionTitle,
      updatedAt: d.updatedAt,
      sourceKind: d.sourceKind,
      sourceLabel: d.sourceLabel,
      filePath: d.filePath,
      uri: d.uri,
      score: 1,
      snippet: extractSnippet(d.text, '', 180),
    }));
  }

  const queryTokens = Array.from(new Set(tokenize(trimmed)));
  if (queryTokens.length === 0) return [];

  const N = docs.length || 1;
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / N || 1;
  const df = new Map<string, number>();

  for (const q of queryTokens) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.includes(q)) count += 1;
    }
    df.set(q, count);
  }

  const k1 = 1.5;
  const b = 0.75;
  const qLower = trimmed.toLowerCase();

  const scored: SearchHit[] = [];
  for (const d of docs) {
    const tfMap = new Map<string, number>();
    for (const tok of d.tokens) {
      tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
    }

    let score = 0;
    for (const q of queryTokens) {
      const tf = tfMap.get(q) ?? 0;
      if (tf === 0) continue;
      const docFreq = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.tokens.length) / avgLen)));
    }

    if (d.text.toLowerCase().includes(qLower)) score += 3.5;
    if (d.sessionTitle.toLowerCase().includes(qLower)) score += 2.0;

    if (score > 0) {
      scored.push({
        sessionId: d.sessionId,
        sessionTitle: d.sessionTitle,
        updatedAt: d.updatedAt,
        sourceKind: d.sourceKind,
        sourceLabel: d.sourceLabel,
        filePath: d.filePath,
        uri: d.uri,
        score: Number(score.toFixed(2)),
        snippet: extractSnippet(d.text, trimmed),
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
