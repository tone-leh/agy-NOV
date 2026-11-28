import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { atomicWriteJson } from '../../core/utils.js';
import type { LiveHookState } from './types.js';

const MAX_XRAY_LIVE_STATE_BYTES = 2 * 1024 * 1024;
const MAX_XRAY_ERROR_CHARS = 512;
const XRAY_POST_TOOL_COALESCE_MS = 2000;

function formatErrorValue(err: unknown): string | undefined {
  if (err === undefined || err === null || err === '') return undefined;
  let text: string;
  if (typeof err === 'string') {
    text = err;
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    try {
      text = JSON.stringify(err);
    } catch {
      text = String(err);
    }
  }
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_XRAY_ERROR_CHARS
    ? `${trimmed.slice(0, MAX_XRAY_ERROR_CHARS - 1)}…`
    : trimmed;
}

/**
 * Pure fail-open hook handler: records active conversation metadata and recent tool events
 * into `<rootDataDir>/modules/xray/live-state.json`.
 *
 * Includes bounded error truncation and short-window coalescing for repetitive PostToolUse bursts.
 */
export function handleXrayHook(payload: NormalizedHookPayload, rootDataDir: string): void {
  const moduleDataDir = getModuleDataDir(rootDataDir, 'xray');
  const event = payload.event;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  try {
    const statePath = path.join(moduleDataDir, 'live-state.json');
    let state: LiveHookState = { recentEvents: [] };
    let existed = false;
    if (fs.existsSync(statePath)) {
      try {
        const st = fs.lstatSync(statePath);
        if (!st.isSymbolicLink() && st.isFile() && st.size <= MAX_XRAY_LIVE_STATE_BYTES) {
          const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<LiveHookState>;
          state = {
            ...parsed,
            recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
          };
          existed = true;
        }
      } catch {
        state = { recentEvents: [] };
      }
    }

    const formattedError = formatErrorValue(payload.error);
    if (existed && event === 'PostToolUse' && !formattedError && state.updatedAt) {
      const prevMs = Date.parse(state.updatedAt);
      const sameConv =
        !payload.conversationId || payload.conversationId === state.activeConversationId;
      const seenConcurrentConv =
        Boolean(payload.conversationId) &&
        state.recentEvents.some((ev) => ev.conversationId === payload.conversationId);
      const sameTranscript =
        !payload.transcriptPath || payload.transcriptPath === state.activeTranscriptPath;
      if (
        Number.isFinite(prevMs) &&
        nowMs - prevMs >= 0 &&
        nowMs - prevMs < XRAY_POST_TOOL_COALESCE_MS &&
        (sameConv || seenConcurrentConv) &&
        (sameTranscript || seenConcurrentConv) &&
        state.lastEvent === 'PostToolUse'
      ) {
        return;
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
      error: formattedError,
    });
    if (state.recentEvents.length > 50) {
      state.recentEvents = state.recentEvents.slice(-50);
    }

    atomicWriteJson(statePath, state, { ignoreTopLevelKeys: ['updatedAt'] });
  } catch {
    // Fail-open on filesystem issues
  }
}
