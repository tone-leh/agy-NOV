import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { ensurePrivateDir } from '../../core/utils.js';
import type { LiveHookState } from './types.js';

function formatErrorValue(err: unknown): string | undefined {
  if (err === undefined || err === null || err === '') return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Pure fail-open hook handler: records active conversation metadata and recent tool events
 * into `<rootDataDir>/modules/xray/live-state.json`.
 */
export function handleXrayHook(payload: NormalizedHookPayload, rootDataDir: string): void {
  const moduleDataDir = getModuleDataDir(rootDataDir, 'xray');
  const event = payload.event;
  const now = new Date().toISOString();

  try {
    ensurePrivateDir(moduleDataDir);
    const statePath = path.join(moduleDataDir, 'live-state.json');
    let state: LiveHookState = { recentEvents: [] };
    if (fs.existsSync(statePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<LiveHookState>;
        state = {
          ...parsed,
          recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
        };
      } catch {
        state = { recentEvents: [] };
      }
    }

    if (payload.conversationId) state.activeConversationId = payload.conversationId;
    if (payload.transcriptPath) state.activeTranscriptPath = payload.transcriptPath;
    if (payload.workspacePaths.length > 0) state.activeWorkspacePaths = payload.workspacePaths;
    if (payload.toolName) state.lastToolName = payload.toolName;
    state.lastEvent = event;
    state.updatedAt = now;

    state.recentEvents.push({
      event,
      conversationId: payload.conversationId ?? 'unknown',
      toolName: payload.toolName,
      stepIdx: payload.stepIdx,
      timestamp: now,
      error: formatErrorValue(payload.error),
    });
    if (state.recentEvents.length > 50) {
      state.recentEvents = state.recentEvents.slice(-50);
    }

    const tmpPath = `${statePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, statePath);
  } catch {
    // Fail-open on filesystem issues
  }
}
