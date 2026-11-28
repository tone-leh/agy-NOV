import fs from 'node:fs';
import path from 'node:path';
import { getDefaultAntigravityBrainDirs, isSamePath } from '../../core/utils.js';
import { buildDemoSessions } from './demo-data.js';
import { loadPricingOverrides } from './pricing.js';
import { parseTranscriptFile } from './transcript.js';
import type { LiveHookState, SessionDetail, SessionSummary } from './types.js';

export interface DiscoveryOptions {
  brainDirs?: Array<{ dir: string; source: SessionSummary['source'] }>;
  dataDir?: string;
  demoMode?: boolean;
}

function inferBrainDirSource(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionSummary['source'] {
  const norm = dir.replace(/\\/g, '/').toLowerCase();
  if (/(?:^|\/)antigravity-cli\/brain\/?$/.test(norm)) return 'cli';
  if (/(?:^|\/)antigravity-ide\/brain\/?$/.test(norm)) return 'ide';
  if (/(?:^|\/)(?:antigravity|\.?gemini)\/brain\/?$/.test(norm)) return 'desktop';
  const envOverrides = [env.AGY_BRAIN_DIR, env.ANTIGRAVITY_BRAIN_DIR].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (envOverrides.some((v) => isSamePath(path.resolve(v.trim()), dir))) {
    return 'custom';
  }
  return 'desktop';
}

export function getDefaultBrainDirs(): Array<{ dir: string; source: SessionSummary['source'] }> {
  return getDefaultAntigravityBrainDirs()
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => ({ dir, source: inferBrainDirSource(dir) }));
}

const MAX_LIVE_HOOK_STATE_BYTES = 2 * 1024 * 1024;

export function readLiveHookState(dataDir?: string): LiveHookState {
  if (!dataDir) return { recentEvents: [] };
  const statePath = path.join(dataDir, 'live-state.json');
  try {
    const st = fs.lstatSync(statePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size <= 0 || st.size > MAX_LIVE_HOOK_STATE_BYTES) {
      return { recentEvents: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<LiveHookState>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { recentEvents: [] };
    }
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

const MAX_DISCOVER_DIRS_PER_ROOT = 2000;
const MAX_DISCOVERED_ENTRIES = 500;

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
    let scannedDirs = 0;
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (scannedDirs >= MAX_DISCOVER_DIRS_PER_ROOT) break;
      scannedDirs += 1;
      const brainDir = path.join(root.dir, child.name);
      const candidates = [
        path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl'),
        path.join(brainDir, 'transcript.jsonl'),
      ];
      for (const transcriptPath of candidates) {
        if (seen.has(transcriptPath)) continue;
        try {
          const stat = fs.lstatSync(transcriptPath);
          if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) continue;
          seen.add(transcriptPath);
          entries.push({
            id: child.name,
            source: root.source,
            brainDir,
            transcriptPath,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // ignore missing or unreadable
          continue;
        }
        break;
      }
    }
  }

  return entries
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_DISCOVERED_ENTRIES);
}

const MAX_LIST_SESSIONS_FULL_BYTES = 2 * 1024 * 1024;
const MAX_LIST_SESSIONS_TOTAL_READ_BYTES = 24 * 1024 * 1024;

export function listSessions(
  opts: DiscoveryOptions & { limit?: number } = {},
): SessionSummary[] {
  if (opts.demoMode) {
    return buildDemoSessions().summaries.slice(0, opts.limit ?? 30);
  }
  const limit = opts.limit ?? 30;
  const entries = discoverTranscriptEntries(opts).slice(0, limit);
  const pricingOverrides = loadPricingOverrides(opts.dataDir);
  const summaries: SessionSummary[] = [];
  let totalReadBudget = 0;
  for (const entry of entries) {
    if (totalReadBudget >= MAX_LIST_SESSIONS_TOTAL_READ_BYTES) break;
    try {
      const st = fs.lstatSync(entry.transcriptPath);
      if (st.isSymbolicLink() || !st.isFile() || st.size === 0) continue;
      // Only summary metadata is needed here; sample files > 2 MiB to prevent event-loop stalls
      const estimatedRead = Math.min(st.size, MAX_LIST_SESSIONS_FULL_BYTES);
      totalReadBudget += estimatedRead;
      const detail = parseTranscriptFile(entry.transcriptPath, {
        sessionId: entry.id,
        source: entry.source,
        brainDir: entry.brainDir,
        pricingOverrides,
        maxFullBytes: MAX_LIST_SESSIONS_FULL_BYTES,
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
  const pricingOverrides = loadPricingOverrides(opts.dataDir);
  const targetId = sessionId || hookState.activeConversationId;
  const entries = discoverTranscriptEntries(opts);

  if (targetId) {
    const match = entries.find((e) => e.id === targetId || e.id.startsWith(targetId));
    if (match) {
      try {
        return parseTranscriptFile(match.transcriptPath, {
          sessionId: match.id,
          source: match.source,
          brainDir: match.brainDir,
          siblingBrainRoot: path.dirname(match.brainDir),
          pricingOverrides,
        });
      } catch {
        return null;
      }
    }
  }

  if (!sessionId && hookState.activeTranscriptPath) {
    let activeRegularFile = false;
    try {
      const lst = fs.lstatSync(hookState.activeTranscriptPath);
      activeRegularFile = !lst.isSymbolicLink() && lst.isFile() && lst.size > 0;
    } catch {
      activeRegularFile = false;
    }
    if (activeRegularFile) {
      const parentDir = path.dirname(hookState.activeTranscriptPath);
      const activeBrainDir =
        path.basename(parentDir) === 'logs' && path.basename(path.dirname(parentDir)) === '.system_generated'
          ? path.resolve(parentDir, '..', '..')
          : parentDir;
      try {
        return parseTranscriptFile(hookState.activeTranscriptPath, {
          sessionId: hookState.activeConversationId ?? path.basename(activeBrainDir) ?? 'active',
          source: 'desktop',
          brainDir: activeBrainDir,
          siblingBrainRoot: path.dirname(activeBrainDir),
          pricingOverrides,
        });
      } catch {
        // fall through to latest readable entry
      }
    }
  }

  for (const candidate of entries.slice(0, 5)) {
    try {
      return parseTranscriptFile(candidate.transcriptPath, {
        sessionId: candidate.id,
        source: candidate.source,
        brainDir: candidate.brainDir,
        siblingBrainRoot: path.dirname(candidate.brainDir),
        pricingOverrides,
      });
    } catch {
      // skip corrupt or vanished transcript and try next recent session
    }
  }
  return null;
}
