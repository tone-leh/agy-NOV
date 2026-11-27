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

function collectDocuments(opts: DiscoveryOptions & { maxSessions?: number }): IndexedDocument[] {
  const entries = discoverTranscriptEntries(opts).slice(0, opts.maxSessions ?? 80);
  const docs: IndexedDocument[] = [];

  for (const entry of entries) {
    let sessionTitle = `Session ${entry.id.slice(0, 8)}`;
    const updatedAt = new Date(entry.mtimeMs).toISOString();
    const transcriptChunks: string[] = [];

    try {
      const lines = fs.readFileSync(entry.transcriptPath, 'utf8').split(/\r?\n/);
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
            const match = obj.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
            const body = (match ? match[1] : obj.content).replace(/\s+/g, ' ').trim();
            if (body && sessionTitle.startsWith('Session ')) {
              sessionTitle = body.slice(0, 72) + (body.length > 72 ? '…' : '');
            }
            transcriptChunks.push(body);
          } else if (obj.type === 'PLANNER_RESPONSE') {
            if (obj.content) transcriptChunks.push(obj.content.slice(0, 1200));
            if (obj.tool_calls) {
              for (const tc of obj.tool_calls) {
                if (tc.name) transcriptChunks.push(tc.name);
                if (tc.args) transcriptChunks.push(JSON.stringify(tc.args).slice(0, 400));
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
      for (const dirent of fs.readdirSync(entry.brainDir, { withFileTypes: true })) {
        if (!dirent.isFile() || !/\.md$/i.test(dirent.name) || dirent.name.startsWith('.')) continue;
        const artPath = path.join(entry.brainDir, dirent.name);
        const content = fs.readFileSync(artPath, 'utf8').slice(0, 40_000);
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
