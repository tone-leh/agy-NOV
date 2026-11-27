import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoSessions } from './demo-data.js';
import { parseTranscriptFile } from './transcript.js';
import type { LiveHookState, SessionDetail, SessionSummary } from './types.js';

export interface DiscoveryOptions {
  brainDirs?: Array<{ dir: string; source: SessionSummary['source'] }>;
  dataDir?: string;
  demoMode?: boolean;
}

export function getDefaultBrainDirs(): Array<{ dir: string; source: SessionSummary['source'] }> {
  const home = os.homedir();
  const candidates: Array<{ dir: string; source: SessionSummary['source'] }> = [
    { dir: path.join(home, '.gemini', 'antigravity', 'brain'), source: 'desktop' },
    { dir: path.join(home, '.gemini', 'antigravity-cli', 'brain'), source: 'cli' },
    { dir: path.join(home, '.gemini', 'antigravity-ide', 'brain'), source: 'ide' },
  ];
  return candidates.filter((c) => fs.existsSync(c.dir));
}

export function readLiveHookState(dataDir?: string): LiveHookState {
  if (!dataDir) return { recentEvents: [] };
  const statePath = path.join(dataDir, 'live-state.json');
  if (!fs.existsSync(statePath)) return { recentEvents: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as LiveHookState;
    return {
      ...parsed,
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
    };
  } catch {
    return { recentEvents: [] };
  }
}

export interface DiscoveredSessionEntry {
  id: string;
  source: SessionSummary['source'];
  brainDir: string;
  transcriptPath: string;
  mtimeMs: number;
}

export function discoverTranscriptEntries(opts: DiscoveryOptions = {}): DiscoveredSessionEntry[] {
  const roots = opts.brainDirs ?? getDefaultBrainDirs();
  const entries: DiscoveredSessionEntry[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const brainDir = path.join(root.dir, child.name);
      const candidates = [
        path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl'),
        path.join(brainDir, 'transcript.jsonl'),
      ];
      for (const transcriptPath of candidates) {
        if (!fs.existsSync(transcriptPath)) continue;
        if (seen.has(transcriptPath)) continue;
        seen.add(transcriptPath);
        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.size === 0) continue;
          entries.push({
            id: child.name,
            source: root.source,
            brainDir,
            transcriptPath,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // ignore unreadable
        }
        break;
      }
    }
  }

  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function listSessions(
  opts: DiscoveryOptions & { limit?: number } = {},
): SessionSummary[] {
  if (opts.demoMode) {
    return buildDemoSessions().summaries.slice(0, opts.limit ?? 30);
  }
  const limit = opts.limit ?? 30;
  const entries = discoverTranscriptEntries(opts).slice(0, limit);
  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    try {
      const detail = parseTranscriptFile(entry.transcriptPath, {
        sessionId: entry.id,
        source: entry.source,
        brainDir: entry.brainDir,
      });
      summaries.push(detail.summary);
    } catch {
      // skip broken transcript
    }
  }
  return summaries;
}

export function loadSessionDetail(
  sessionId?: string,
  opts: DiscoveryOptions = {},
): SessionDetail | null {
  if (opts.demoMode) {
    const demo = buildDemoSessions();
    if (sessionId && demo.details[sessionId]) return demo.details[sessionId];
    return demo.details[demo.summaries[0].id] ?? null;
  }

  const hookState = readLiveHookState(opts.dataDir);
  const targetId = sessionId || hookState.activeConversationId;
  const entries = discoverTranscriptEntries(opts);

  if (targetId) {
    const match = entries.find((e) => e.id === targetId || e.id.startsWith(targetId));
    if (match) {
      return parseTranscriptFile(match.transcriptPath, {
        sessionId: match.id,
        source: match.source,
        brainDir: match.brainDir,
      });
    }
  }

  if (!sessionId && hookState.activeTranscriptPath && fs.existsSync(hookState.activeTranscriptPath)) {
    return parseTranscriptFile(hookState.activeTranscriptPath, {
      sessionId: hookState.activeConversationId ?? 'active',
      source: 'desktop',
    });
  }

  const latest = entries[0];
  if (!latest) return null;
  return parseTranscriptFile(latest.transcriptPath, {
    sessionId: latest.id,
    source: latest.source,
    brainDir: latest.brainDir,
  });
}
