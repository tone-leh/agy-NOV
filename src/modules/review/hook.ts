import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { atomicWriteJson } from '../../core/utils.js';
import type { ReviewSignal } from './types.js';

const MUTATING_TOOL_RE =
  /(write|edit|replace|patch|create|delete|remove|rename|move|run_command|command|bash|shell|terminal|multi_replace)/i;

const MAX_REVIEW_SIGNAL_BYTES = 1024 * 1024;
const REVIEW_POST_TOOL_COALESCE_MS = 1500;

export function readReviewSignal(moduleDataDir?: string): ReviewSignal | null {
  if (!moduleDataDir) return null;
  const signalPath = path.join(moduleDataDir, 'review-signal.json');
  if (!fs.existsSync(signalPath)) return null;
  try {
    const st = fs.lstatSync(signalPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_REVIEW_SIGNAL_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(signalPath, 'utf8')) as Partial<ReviewSignal>;
    return {
      lastEvent: parsed.lastEvent,
      lastToolName: parsed.lastToolName,
      lastWriteAt: parsed.lastWriteAt,
      updatedAt: parsed.updatedAt,
      changeCount: typeof parsed.changeCount === 'number' ? parsed.changeCount : 0,
      workspacePaths: Array.isArray(parsed.workspacePaths) ? parsed.workspacePaths : undefined,
      conversationId: parsed.conversationId,
    };
  } catch {
    return null;
  }
}

/**
 * Pure fail-open hook handler: records lightweight edit signals to
 * `<rootDataDir>/modules/review/review-signal.json` via atomic write-and-rename.
 *
 * High-frequency read-only PostToolUse calls short-circuit with zero disk writes
 * so 3,000+ step sessions never trigger write storms on non-mutating tools.
 */
export function handleReviewHook(payload: NormalizedHookPayload, rootDataDir: string): void {
  const moduleDataDir = getModuleDataDir(rootDataDir, 'review');
  const event = payload.event;
  const toolName = payload.toolName;
  const isMutating = event === 'Stop' || (toolName ? MUTATING_TOOL_RE.test(toolName) : false);

  try {
    const signalPath = path.join(moduleDataDir, 'review-signal.json');
    const prev = readReviewSignal(moduleDataDir);

    // Zero-write short-circuit for non-mutating PostToolUse calls (read_file/grep_search/etc.).
    // Never rewrite review-signal.json just because concurrent sessions alternate read-only tools.
    if (!isMutating && event === 'PostToolUse') {
      if (!prev) {
        return;
      }
      const hasNewWorkspace =
        payload.workspacePaths.length > 0 &&
        (!prev.workspacePaths || prev.workspacePaths.length === 0);
      if (!hasNewWorkspace) {
        return;
      }
    }

    const nowMs = Date.now();
    // Coalesce high-frequency mutating PostToolUse bursts (e.g. rapid run_command/edit_file loops
    // across concurrent sessions) within 1.5s; Stop hooks always persist cleanly.
    if (isMutating && event === 'PostToolUse' && prev && prev.lastEvent === 'PostToolUse' && prev.updatedAt) {
      const prevMs = Date.parse(prev.updatedAt);
      const hasNewWorkspace =
        payload.workspacePaths.length > 0 &&
        (!prev.workspacePaths || prev.workspacePaths.length === 0);
      if (
        !hasNewWorkspace &&
        Number.isFinite(prevMs) &&
        nowMs - prevMs >= 0 &&
        nowMs - prevMs < REVIEW_POST_TOOL_COALESCE_MS
      ) {
        return;
      }
    }

    const now = new Date(nowMs).toISOString();
    const base = prev ?? { changeCount: 0 };

    const next: ReviewSignal = {
      ...base,
      lastEvent: event,
      lastToolName: toolName ?? base.lastToolName,
      lastWriteAt: isMutating ? now : base.lastWriteAt,
      updatedAt: now,
      changeCount: isMutating ? base.changeCount + 1 : base.changeCount,
      workspacePaths:
        payload.workspacePaths.length > 0
          ? payload.workspacePaths
          : base.workspacePaths,
      conversationId: payload.conversationId ?? base.conversationId,
    };

    atomicWriteJson(signalPath, next, { ignoreTopLevelKeys: ['updatedAt'] });
  } catch {
    // Fail-open on filesystem permissions or transient I/O errors
  }
}
