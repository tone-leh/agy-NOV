import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { atomicWriteJson, redactSecretsLinear } from '../../core/utils.js';
import type { LiveHookState } from './types.js';

const MAX_XRAY_LIVE_STATE_BYTES = 2 * 1024 * 1024;
const MAX_XRAY_ERROR_CHARS = 512;
const MAX_XRAY_RAW_ERROR_CHARS = 16_384;
const XRAY_POST_TOOL_COALESCE_MS = 2000;

function sanitizeHookSummaryField(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const redacted = redactSecretsLinear(trimmed, { stripPrivate: true }).trim();
  return redacted || undefined;
}

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
  const boundedRaw =
    trimmed.length > MAX_XRAY_RAW_ERROR_CHARS ? trimmed.slice(0, MAX_XRAY_RAW_ERROR_CHARS) : trimmed;
  const redacted = redactSecretsLinear(boundedRaw, { stripPrivate: true }).trim();
  if (!redacted) return undefined;
  return redacted.length > MAX_XRAY_ERROR_CHARS
    ? `${redacted.slice(0, MAX_XRAY_ERROR_CHARS - 1)}…`
    : redacted;
}

/**
 * Pure fail-open hook handler: records active conversation metadata and recent tool events
 * into `<rootDataDir>/modules/xray/live-state.json`.
 *
 * Includes linear secret redaction, bounded error truncation, and short-window coalescing for
 * repetitive PostToolUse bursts.
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

    const safeConversationId = sanitizeHookSummaryField(payload.conversationId);
    const safeTranscriptPath = sanitizeHookSummaryField(payload.transcriptPath);
    const safeToolName = sanitizeHookSummaryField(payload.toolName);
    const safeWorkspacePaths = payload.workspacePaths
      .map((p) => sanitizeHookSummaryField(p))
      .filter((p): p is string => Boolean(p));
    const formattedError = formatErrorValue(payload.error);

    if (existed && event === 'PostToolUse' && !formattedError && state.updatedAt) {
      const prevMs = Date.parse(state.updatedAt);
      const sameConv = !safeConversationId || safeConversationId === state.activeConversationId;
      const seenConcurrentConv =
        Boolean(safeConversationId) &&
        state.recentEvents.some((ev) => ev.conversationId === safeConversationId);
      const sameTranscript =
        !safeTranscriptPath || safeTranscriptPath === state.activeTranscriptPath;
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

    if (safeConversationId) state.activeConversationId = safeConversationId;
    if (safeTranscriptPath) state.activeTranscriptPath = safeTranscriptPath;
    if (safeWorkspacePaths.length > 0) state.activeWorkspacePaths = safeWorkspacePaths;
    if (safeToolName) state.lastToolName = safeToolName;
    state.lastEvent = event;
    state.updatedAt = now;

    state.recentEvents.push({
      event,
      conversationId: safeConversationId ?? 'unknown',
      toolName: safeToolName,
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
